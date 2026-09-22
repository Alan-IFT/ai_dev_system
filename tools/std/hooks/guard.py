# -*- coding: utf-8 -*-
"""Claude Code 拦截层：内嵌标准目录只读 + 提交前必过 check_all。不是标准正文。

三条判据：① Edit/Write/MultiEdit/NotebookEdit 写进内嵌标准目录 → deny，写本项目
`.claude/settings*.json`（拦截层自己的开关）→ ask；② Bash 某段既是写形态又落在受保护前缀上
→ ask（命令串只是代理指标，判不准就问人不自作主张）；③ Bash 里有 `git commit`（含
`--no-verify`、`git -c … commit`）→ 先跑 check_all，非 0 不放行，**跑不成也不放行**（契约 §1：
不得把「没检查」当成检查过了）。项目根与受保护目录由 CLAUDE_PLUGIN_ROOT 推导，内嵌目录名
代码里不写死；无意见即退出 0 且不输出。
"""

import hashlib
import io
import json
import os
import re
import subprocess
import sys
import time

TIMEOUT = 300
GIT_OPT2 = {"-c", "-C", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"}
GIT_HEAD = re.compile(r"^\s*(?:[A-Za-z_][A-Za-z_0-9]*=\S*\s+)*git\b(.*)$", re.S)
ASSIGN = re.compile(r"^(?:[A-Za-z_][A-Za-z_0-9]*=\S*\s+)*")
SPLIT = re.compile(r"&&|\|\||[;|]|\n")
REDIR = re.compile(r">>?\s*['\"]?((?:\./)?[^\s'\"|&;<>]+)")
SUBTREE = re.compile(r"^git\s+subtree\b")
CMDWRITE = re.compile(r"\b(?:tee|rm|mv|cp)\b|\bsed\b[^|]*?-i|\bgit\s+checkout\b[^|]*--")
INTERP = re.compile(r"\b(?:python3?|node)\b[^|]*\s-[ce]\b[^|]*(?:\bopen\s*\(|write)")
TAIL = u"不要修改 %s 内的判据；要改标准走合并回标准仓再 pull；未定项按 governance/exceptions.md 逐条登记"

def _rel(target, base):
    try:    # 跨盘符 relpath 会抛（契约 §4 为此踩过一次），按"不在其下"算，不崩
        return os.path.relpath(target, base).replace("\\", "/")
    except ValueError:
        return ""

def _norm(path):
    """反斜杠→正斜杠 + realpath（Windows 上顺带归一盘符与大小写）。"""
    if not path:
        return ""
    try:
        return os.path.realpath(path.replace("\\", "/")).replace("\\", "/")
    except (OSError, ValueError):
        return os.path.abspath(path.replace("\\", "/")).replace("\\", "/")

def _segments(cmd):
    return [s.strip() for s in SPLIT.split(cmd or "") if s.strip()]

def _strip_assign(seg):
    return ASSIGN.sub("", seg, count=1).strip()

def _write_hit(seg, prefixes):
    """段是写形态且落在受保护前缀上。重定向要求**目标本身**在前缀下（`… --json >
    report.json` 里的内嵌目录是读对象，整段判 ask 会把每次跑检查都变成一次打扰）；其余写
    形态（rm/mv/cp/tee/sed -i/git checkout --/python 与 python3 的 -c/node -e）按段内出现前缀判。"""
    for m in REDIR.finditer(seg):
        tgt = m.group(1)[2:] if m.group(1).startswith("./") else m.group(1)
        if any(tgt.startswith(p) for p in prefixes):
            return True
    return (any(p in seg for p in prefixes)
            and bool(CMDWRITE.search(seg) or INTERP.search(seg)))

def _is_git_commit(seg):
    """token 扫描：跳过 git 全局选项，首个非选项 token 必须**精确等于** commit。"""
    m = GIT_HEAD.match(seg)
    if not m:
        return False
    toks, i = m.group(1).split(), 0
    while i < len(toks):
        if toks[i] in GIT_OPT2:
            i += 2
        elif toks[i].startswith("-"):
            i += 1
        else:
            return toks[i] == "commit"
    return False

def _check_all(std, root, fake=None):
    """返回 (verdict, reason)，verdict ∈ {pass, deny, skip}。fake 只由 --selftest 按参数
    注入；生产路径不读任何 STD_GUARD_* 环境变量——那种开关本身就是一条绕过面。"""
    name = os.path.basename(std)
    script = os.path.join(std, "tools", "std", "check_all.py")
    if fake is None and not os.path.isfile(script):
        return "skip", u""
    try:
        if fake is None:
            env = dict(os.environ)
            env["PYTHONIOENCODING"] = "utf-8"   # 子进程默认按 locale 编码，cp936 会炸
            proc = subprocess.run(
                [sys.executable, script, ".", "--no-scope"], cwd=root, env=env,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=TIMEOUT)
            code, out = proc.returncode, proc.stdout.decode("utf-8", "replace")
        elif isinstance(fake, BaseException):
            raise fake
        else:
            code, out = fake
    except subprocess.TimeoutExpired:
        return "deny", u"检查没跑成（超时 %d s），未定不放行。%s" % (TIMEOUT, TAIL % name)
    except Exception as exc:  # noqa: BLE001
        return "deny", u"检查没跑成（%s：%s），未定不放行。%s" % (
            type(exc).__name__, exc, TAIL % name)
    if code == 0:
        return "pass", u""
    if code not in (1, 2):
        return "deny", u"检查没跑成（退出码 %r 不在 {0,1,2}），未定不放行。%s" % (code, TAIL % name)
    lines = (out or u"").splitlines()                      # 计数行 + 结论行 + 前 8 条 id
    body = [l for l in lines if l.startswith(u"  通过 ")][:1]
    body += [l for l in lines if l.startswith(u"结论：")][:1]
    body += [l.strip() for l in lines if l.strip().startswith(u"id：")][:8]
    return "deny", u"提交前检查未过（退出码 %d）：\n%s\n%s" % (
        code, u"\n".join(body), TAIL % name)

def _bash(cmd, std, root, fake=None):
    name = os.path.basename(std)
    prefixes = (name + "/", ".claude/settings.json", ".claude/settings.local.json")
    write_seg, commit = None, False
    for raw in _segments(cmd):
        seg = _strip_assign(raw)
        if SUBTREE.match(seg) and ">" not in raw:
            continue        # subtree 是升级通道；带重定向的那种不在白名单里
        if write_seg is None and _write_hit(raw, prefixes):
            write_seg = raw[:200]
        if _is_git_commit(seg):
            commit = True
    if commit:
        verdict, reason = _check_all(std, root, fake)
        if verdict == "deny":
            return "deny", reason, u"git commit", u""
        if verdict == "skip":
            return None, u"", u"git commit", u"skip"
        if write_seg is None:
            return None, u"", u"git commit", u"allow-with-check"
    if write_seg:
        return "ask", (u"这段像在写受保护路径（%s 只读 · .claude/settings*.json 是拦截层"
                       u"自己的开关），命令串判不准，先问人：%s" % (name, write_seg)), \
            write_seg, u""
    return None, u"", u"", u""

def decide(payload, std, fake=None):
    """返回 (decision, reason, subject, note)。decision 为 None 即无意见。"""
    std = _norm(std)
    root = _norm(os.path.dirname(std))
    name = os.path.basename(std)
    tin = payload.get("tool_input") or {}
    tool = payload.get("tool_name") or ""
    if tool == "Bash":
        return _bash(tin.get("command") or "", std, root, fake)
    key = "notebook_path" if tool == "NotebookEdit" else "file_path"
    raw = (tin.get(key) or "").replace("\\", "/")
    if not raw:
        return None, u"", u"", u""
    base = _norm(payload.get("cwd") or root)
    target = _norm(raw if os.path.isabs(raw) else os.path.join(base, raw))
    rel, srel = _rel(target, root), _rel(target, std)
    if srel and srel != ".." and not srel.startswith("../"):
        return "deny", (u"%s/ 是内嵌的标准目录，只读：改标准走合并回标准仓再 subtree pull；"
                        u"就地改下次升级会被覆盖，合规结论也不再可复算。目标：%s"
                        % (name, rel or target)), target, u""
    if rel in (".claude/settings.json", ".claude/settings.local.json"):
        return "ask", (u"这是本项目的 Claude Code 设置，拦截层自己的开关就在里面，改它可能"
                       u"把守卫关掉，先问人：%s" % rel), target, u""
    return None, u"", u"", u""

def _receipt(session, root, event, tool, subject, decision):
    """回执落 ${CLAUDE_PLUGIN_DATA}/receipts.log：仓外、由拦截层写，不是被约束者自述。"""
    data = os.environ.get("CLAUDE_PLUGIN_DATA")
    if not data:
        return
    try:
        os.makedirs(data, exist_ok=True)
        cols = [time.strftime("%Y-%m-%d %H:%M:%S"), session or "-", root or "-", event or "-",
                tool or "-", (subject or "-").replace("\t", " ").replace("\n", " ")[:160], decision]
        with io.open(os.path.join(data, "receipts.log"), "a", encoding="utf-8") as fh:
            fh.write(u"\t".join(cols) + u"\n")
    except Exception:  # noqa: BLE001
        pass            # 回执写不成不影响决定，否则回执自己就成了绕过面

def _emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")

def main(argv):
    if "--selftest" in argv:
        return selftest()
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except ValueError:
        return 0
    std = os.environ.get("CLAUDE_PLUGIN_ROOT")
    if not std:
        sys.stderr.write("guard：没有 CLAUDE_PLUGIN_ROOT，本次不表态\n")
        return 0
    std, session = _norm(std), payload.get("session_id") or ""
    root, event = _norm(os.path.dirname(std)), payload.get("hook_event_name") or ""
    if event == "SessionStart":
        has = os.path.isfile(os.path.join(std, "tools", "std", "check_all.py"))
        with io.open(os.path.abspath(__file__), "rb") as fh:   # 自报版本，与回执同一枚
            body = fh.read().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
        sha = hashlib.sha256(body).hexdigest()[:8]
        _emit({"hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": u"std 拦截层已加载 · guard %s · %s 只读 · %s" % (
                sha, os.path.basename(std), u"提交前跑 check_all" if has
                else u"但本项目没有内嵌标准，提交门不生效")}})
        _receipt(session, root, "SessionStart", "-",
                 u"guard %s · check_all %s" % (sha, u"在位" if has else u"不在位"), "present")
        return 0
    decision, reason, subject, note = decide(payload, std)
    if decision:
        _emit({"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                      "permissionDecision": decision,
                                      "permissionDecisionReason": reason}})
    if decision or note:
        _receipt(session, root, event, payload.get("tool_name") or "", subject, decision or note)
    return 0

# 反例自检（契约 §3）。{N} = 内嵌目录名；21 条语料同 e/bashrule2.py，heredoc 一条期望「漏」
BASH_CASES = [
    ("echo zz > {N}/tools/std/w.md", "ask"), ("rm -rf {N}/tools", "ask"),
    ("sed -i 's/a/b/' {N}/标准/01.md", "ask"), ("git checkout HEAD~1 -- {N}/", "ask"),
    ("git subtree pull --prefix={N} https://x main --squash", None),
    ("git stash push && git subtree pull --prefix={N} . main --squash && git stash pop", None),
    ("git stash push && rm -rf {N}/x && git stash pop", "ask"),
    ("cat {N}/标准/README.md", None), ("python3 {N}/tools/std/check_all.py .", None),
    ("python3 {N}/tools/std/check_all.py . --json > report.json", None),
    ("grep -rn 'x' {N}/", None), ("ls -R {N}", None), ("git log --oneline -- {N}", None),
    ("git diff {N}", None), ("python - <<'P'\nopen('{N}/x.md','w').write('y')\nP", None),
    ("python -c \"open('{N}/x.md','w').write('y')\"", "ask"),
    ("python3 -c \"open('{N}/x.md','w').write('y')\"", "ask"),
    ("rm -rf build && cp -r dist {N}_out/", None), ("echo ok > out/.stdout.log", None),
    ("node -e \"require('fs').writeFileSync('{N}/a','b')\"", "ask"),
    ("npm run build && python3 {N}/tools/std/check_all.py .", None),
]
COMMIT_CASES = [
    ("git commit", True), ("git commit -m x", True), ("git commit --no-verify -m x", True),
    ("git commit --amend", True), ("git -c a=b commit -m y", True),
    ("git -c user.name=x -c user.email=y commit -m z", True), ("git -C sub commit -m t", True),
    ("GIT_EDITOR=true git commit", True), ("  git commit -m x", True),
    ("echo hi && git commit -m x", True), ("git --no-pager commit", True),
    ("git commit-tree", False), ("gitk", False), ("git committer", False),
    ("git status", False), ("git log", False), ("git subtree add --prefix=x . HEAD", False),
]
FAKE2 = (u"  通过 3   失败 0   未定 17（已登记 0 · 未登记 17）   不适用 1\n"
         u"      id：links/broken/a\n结论：有未登记的判不了项。\n")

def selftest():
    import shutil, tempfile  # noqa: E401
    root = _norm(tempfile.mkdtemp(prefix="stdguard-"))
    std, fails, total, G = root + "/.std", [], 0, "git commit -m x"
    try:
        os.makedirs(std + "/tools/std")   # 只有内嵌目录必须真实存在：大小写归一要靠它
        with io.open(std + "/tools/std/check_all.py", "w", encoding="utf-8") as fh:
            fh.write(u"# 占位\n")

        def ed(tool, path, key="file_path"):
            return decide({"tool_name": tool, "cwd": root, "tool_input": {key: path}}, std)[0]

        def bs(cmd, fake=None, s=None):
            return decide({"tool_name": "Bash", "cwd": root,
                           "tool_input": {"command": cmd}}, s or std, fake)

        cases = [(u"Edit 内嵌目录", ed("Edit", std + "/x.md"), "deny"),
                 (u"Edit docs", ed("Edit", root + "/docs/x.md"), None),
                 (u"Edit settings", ed("Edit", root + "/.claude/settings.json"), "ask"),
                 (u"Notebook 内嵌目录",
                  ed("NotebookEdit", std + "/n.ipynb", "notebook_path"), "deny"),
                 (u"假门 退出 0", bs(G, (0, u""))[0], None),
                 (u"假门 退出 1", bs(G, (1, u"结论：有失败。\n"))[0], "deny"),
                 (u"假门 退出 2", bs(G, (2, FAKE2))[0], "deny"),
                 (u"假门 崩", bs(G, RuntimeError("boom"))[0], "deny"),
                 (u"假门 超时", bs(G, subprocess.TimeoutExpired("x", TIMEOUT))[0], "deny"),
                 (u"假门 2 的理由含未登记或 id：",
                  any(k in bs(G, (2, FAKE2))[1] for k in (u"未登记", u"id：")), True),
                 (u"echo hi && git commit 跑门", bs(u"echo hi && " + G, (1, u""))[0], "deny"),
                 (u"subtree 带重定向不白名单",
                  bs("git subtree pull --prefix=.std . main > .std/log")[0], "ask"),
                 (u"check_all 不在位记 skip", bs(G, None, root + "/nostd")[3], u"skip")]
        if os.name == "nt":
            cases.append((u"Write 大小写 .STD", ed("Write", root + "/.STD/x.md"), "deny"))
        else:
            sys.stdout.write(u"跳过「Write 大小写 .STD」：非 Windows，realpath 不归一大小写\n")
        cases += [(u"Bash %s" % t.replace("\n", u"⏎")[:46], bs(t.format(N=".std"))[0], w)
                  for t, w in BASH_CASES]
        cases += [(u"commit? %s" % c,
                   any(_is_git_commit(_strip_assign(s)) for s in _segments(c)), w)
                  for c, w in COMMIT_CASES]
        total = len(cases)
        fails = [u"%s：期望 %r 得到 %r" % (c[0], c[2], c[1]) for c in cases if c[1] != c[2]]
    finally:
        shutil.rmtree(root, ignore_errors=True)
    if fails:
        sys.stdout.write(u"FAIL %d/%d 条：\n" % (len(fails), total))
        for line in fails:
            sys.stdout.write(u"  · %s\n" % line)
        return 1
    sys.stdout.write(u"PASS %d 条\n" % total)
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
