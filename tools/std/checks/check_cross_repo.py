# -*- coding: utf-8 -*-
"""多仓系统的工件分布（01 §3.8）。

执行 §3.8 的七条机械可判定要求：承载仓唯一、各仓可定位、各仓有自己的入口、
入口是投影（两跳内到达系统级权威）、各仓状态在系统级入口登记、退役仓的规则已失效、
跨仓引用可达。判不了的一律 UNDETERMINED，不降级为通过（契约 §1）。

只用标准库。契约见 ../CONTRACT.md。
"""
from __future__ import annotations

import io
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from stdlib import (  # noqa: E402
    FAIL, PASS, SKIP, UNDETERMINED,
    cfg_get, finding, is_tailored_out, undetermined_from_exception,
)

NAME = "cross-repo"
STANDARD_REFS = ["01 §3.8"]

# 退役仓里"可被当作现行规则读入"的默认清单；项目可用 project.yaml 的 rule_files 覆盖。
_DEFAULT_RULE_FILES = [".harness/rules/", ".claude/", "AGENTS.md", "CLAUDE.md"]

# 失效标记：出现在文件前若干行即认为已标为失效。
_MARKER_HEAD_LINES = 20
_MARKERS_CN = ("已退役", "失效", "不再生效", "已归档", "已停用")
_MARKERS_EN = ("retired", "archived", "deprecated")

_ROLES = ("system", "app", "retired", "archived")
_DEAD_ROLES = ("retired", "archived")

# 系统级入口里"登记了状态"的词。§3.8 要求登记的是状态，不只是名字。
_STATUS_TOKENS = (
    "active", "retired", "archived", "现行", "在用", "已退役", "退役", "已归档", "归档", "停用",
    "system", "应用仓", "控制平面",
)

# 扫描上限：超出即记未定，不假装扫全了。
_MAX_MD_FILES = 6000
_MAX_RULE_FILES = 300
_MAX_HOP2_LINKS = 60
_MAX_LISTED = 10

_SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", "__pycache__",
    "dist", "build", ".next", ".mypy_cache", ".pytest_cache", ".idea",
}

_INLINE_LINK = re.compile(r"\]\(\s*<?([^)\s>]+)>?[^)]*\)")
_REF_LINK = re.compile(r"^\s*\[[^\]]+\]:\s*<?([^\s>]+)", re.M)
_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.\-]*:")


# --------------------------------------------------------------------------
# 小工具（stdlib 里没有的一律在本模块实现，不改公共库）
# --------------------------------------------------------------------------

def _read(path, limit_bytes=2 * 1024 * 1024):
    with io.open(path, "rb") as fh:
        raw = fh.read(limit_bytes)
    return raw.decode("utf-8", "replace")


def _head_lines(path, n=_MARKER_HEAD_LINES):
    out = []
    with io.open(path, "rb") as fh:
        for i, raw in enumerate(fh):
            if i >= n:
                break
            out.append(raw.decode("utf-8", "replace"))
    return "".join(out)


def _has_invalidation_marker(text):
    low = text.lower()
    for m in _MARKERS_CN:
        if m in text:
            return m
    for m in _MARKERS_EN:
        if m in low:
            return m
    return None


def _name_appears(text, name):
    """仓名是否作为独立记号出现。不能用裸子串——嵌套命名下 NFBY_CMS 会被
    NFBY_CMS_Backend 假命中，那会把'未登记'误判成通过。"""
    pat = r"(?<![0-9A-Za-z_\-])%s(?![0-9A-Za-z_\-])" % re.escape(name)
    return re.search(pat, text, re.IGNORECASE) is not None


def _has_status_token(line):
    """这一行上有没有把仓的状态写出来。只认状态词本身，不解读句意。"""
    low = line.lower()
    for t in _STATUS_TOKENS:
        if t.isascii():
            if t.lower() in low:
                return True
        elif t in line:
            return True
    return False


def _norm(path):
    return os.path.normcase(os.path.normpath(os.path.abspath(path))).replace("\\", "/")


def _is_git_repo(path):
    return os.path.exists(os.path.join(path, ".git"))


def _link_targets(text):
    """抽出 markdown 链接目标。只认链接语法，不猜正文里的裸路径。"""
    seen, out = set(), []
    for m in list(_INLINE_LINK.finditer(text)) + list(_REF_LINK.finditer(text)):
        t = m.group(1).strip()
        if not t or t.startswith("#"):
            continue
        t = t.split("#", 1)[0].split("?", 1)[0].strip()
        if not t or _SCHEME.match(t):
            continue
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out


def _list_md(repo, known):
    """列本仓自己的 *.md。嵌套在本仓里的其它声明仓整棵跳过——它们的文件不归本仓。

    归属按"最深的包含它的声明仓"算，所以本仓被别的仓套着（子仓与父仓并列声明）时不会被误跳。
    """
    files, truncated = [], False
    for dirpath, dirnames, filenames in os.walk(repo["_real"]):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
        owner = _owner_repo(dirpath, known)
        if owner is not None and owner["_abs"] != repo["_abs"]:
            dirnames[:] = []
            continue
        for fn in filenames:
            if fn.lower().endswith(".md"):
                files.append(os.path.join(dirpath, fn))
                if len(files) >= _MAX_MD_FILES:
                    return files, True
    return files, truncated


def _expand_rule_files(repo_abs, patterns):
    """把 rule_files 的条目展开成实际存在的文件路径。以 / 结尾的按目录递归。"""
    out, truncated = [], False
    for pat in patterns:
        pat = str(pat).replace("\\", "/").strip()
        if not pat:
            continue
        target = os.path.join(repo_abs, pat.rstrip("/"))
        if pat.endswith("/") or os.path.isdir(target):
            if not os.path.isdir(target):
                continue
            for dirpath, dirnames, filenames in os.walk(target):
                dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
                for fn in sorted(filenames):
                    out.append(os.path.join(dirpath, fn))
                    if len(out) >= _MAX_RULE_FILES:
                        return out, True
        elif os.path.isfile(target):
            out.append(target)
    # 去重，保序
    seen, uniq = set(), []
    for p in out:
        k = _norm(p)
        if k not in seen:
            seen.add(k)
            uniq.append(p)
    return uniq, truncated


def _owner_repo(abs_path, repos):
    """一个路径归哪个仓：取最深的包含它的声明仓（应付嵌套检出）。"""
    p = _norm(abs_path)
    best = None
    for r in repos:
        if not r.get("_abs"):
            continue
        base = r["_abs"].rstrip("/") + "/"
        if p == r["_abs"] or p.startswith(base):
            if best is None or len(r["_abs"]) > len(best["_abs"]):
                best = r
    return best


# --------------------------------------------------------------------------
# 配置解析
# --------------------------------------------------------------------------

def _load_repos(cfg):
    """返回 (repos, problem)。repos 元素带 _abs / _exists / _is_git。"""
    raw = cfg_get(cfg, "repos")
    if not raw:
        return None, "repos 未声明"
    if not isinstance(raw, list):
        return None, "repos 不是列表，取值有歧义"
    if len(raw) < 2:
        return None, "repos 只有 %d 个条目" % len(raw)
    root = cfg.get("_root") or "."
    repos = []
    for i, item in enumerate(raw, 1):
        if not isinstance(item, dict):
            return None, "repos 第 %d 项不是映射" % i
        name = str(item.get("name") or "").strip()
        path = str(item.get("path") or "").strip()
        role = str(item.get("role") or "").strip()
        if not name or not path:
            return None, "repos 第 %d 项缺 name 或 path" % i
        abspath = os.path.abspath(os.path.join(root, path))
        repos.append({
            "name": name,
            "path": path,
            "role": role,
            "_abs": _norm(abspath),
            "_real": abspath,
            "_exists": os.path.isdir(abspath),
            "_is_git": os.path.isdir(abspath) and _is_git_repo(abspath),
        })
    return repos, None


def _find_entry(repo, entry_names):
    for nm in entry_names:
        p = os.path.join(repo["_real"], str(nm))
        if os.path.isfile(p):
            return p, str(nm)
    return None, None


# --------------------------------------------------------------------------
# 契约接口
# --------------------------------------------------------------------------

def scope(cfg):
    entries = cfg_get(cfg, "layout.entry", []) or []
    rule_files = cfg_get(cfg, "rule_files") or cfg_get(cfg, "layout.rule_files") or _DEFAULT_RULE_FILES
    return {
        "covered": [
            "repos 里声明的每个仓：路径是否存在、根下有没有 .git、有没有 layout.entry 里的入口文件（%s）"
            % (", ".join(map(str, entries)) or "（未配置）"),
            "role: system 的条目是不是恰好一个（01 §3.8 指定一个承载系统级工件的仓）",
            "各应用仓的入口能否在两跳内出现指向系统仓的引用（系统仓 name、其目录名、或解析进系统仓的相对链接）",
            "系统仓的入口里有没有出现每个 repos 条目的 name，且该名字所在行上有没有状态词"
            "（01 §3.8 各仓状态在系统级入口登记）",
            "role 为 retired/archived 的仓根下，rule_files（%s）展开出的文件前 %d 行有没有失效标记"
            % (", ".join(map(str, rule_files)), _MARKER_HEAD_LINES),
            "各仓 *.md 里 markdown 链接语法写的跨仓相对路径，解析后是否存在",
        ],
        "not_covered": [
            "不判断工件归属得对不对——'这条事实该放哪个仓'是人的判断（01 §3.8 归属判据、契约 §7）",
            "不判断入口内容是否真的只是投影：只判有没有指向系统仓，不判系统级规则正文有没有被抄进来",
            "登记一条只按'名字 + 同一行的状态词'判：名字出现但同行没有状态词一律记未定（不记通过也不记失败），"
            "写的那个状态与 repos 里的 role 一不一致也不判",
            "不做跨仓同名文档的重复检测（M-26 观察一的 1614 个同名文件），那是另一条判据",
            "不跨机器解析部署主机路径：以 / 开头的绝对路径一律记未定，不判存在性",
            "'两跳'判到第二跳为止——入口本身算第一跳，入口里指向本仓内文件的链接算第二跳；"
            "不展开第三跳，也不跟随外链与 http 链接",
            "只按仓根下有没有 .git 认仓库身份，不校验 git 元数据、远端、submodule 关系",
            "跨仓引用只扫 *.md，且只认 markdown 链接语法；不看 *.sh、*.json、*.yaml、*.service 里的路径，也不看正文裸路径",
            "失效标记只看文件前 %d 行；写在更后面的失效说明本检查器看不见" % _MARKER_HEAD_LINES,
            "退役仓的规则文件清单以 rule_files 为准；清单外的位置（如仓内子目录的另一套 agents）不看",
            "不读 git 历史，不判断某个仓是不是事实上已经停更",
        ],
    }


def run(cfg):
    try:
        return _run(cfg)
    except Exception as exc:  # noqa: BLE001 —— 内部异常一律未定，绝不吞掉记 PASS
        return [undetermined_from_exception(NAME, exc, "跑 %s" % NAME)]


def _run(cfg):
    tailored, reason = is_tailored_out(cfg, NAME)
    if tailored:
        return [finding(NAME, SKIP, "项目已裁剪本检查", reason=reason or "project.yaml 未写理由")]

    repos, problem = _load_repos(cfg)
    if repos is None:
        if problem in ("repos 未声明",) or problem.startswith("repos 只有"):
            return [finding(
                NAME, SKIP, "单仓项目，§3.8 记不适用",
                reason="%s；01 §3.8 明写'单仓项目记不适用'" % problem,
                why="01 §3.8 的适用条件是系统跨越两个以上代码仓",
            )]
        return [finding(
            NAME, UNDETERMINED, "repos 配置读不出来",
            reason="%s（契约 §5：缺配置不取默认值当事实）" % problem,
            why="01 §3.8 的每一条都要先知道系统由哪几个仓组成",
        )]

    out = []
    out.extend(_check_roles(repos))
    out.extend(_check_reachable(repos))

    entry_names = cfg_get(cfg, "layout.entry")
    if not entry_names:
        out.append(finding(
            NAME, UNDETERMINED, "未配置入口文件，入口相关的四条判不了",
            reason="governance/project.yaml 缺 layout.entry；本工具不猜哪个文件是入口",
            why="01 §3.8 要求每个仓必须有自己的入口，先要说清哪份是入口",
        ))
    else:
        entry_names = [str(x) for x in entry_names]
        entries = {}
        for r in repos:
            if not r["_exists"]:
                continue
            path, nm = _find_entry(r, entry_names)
            entries[r["name"]] = (path, nm)
        out.extend(_check_entry_exists(repos, entries, entry_names))
        out.extend(_check_projection(repos, entries))
        out.extend(_check_registration(repos, entries))

    out.extend(_check_retired(cfg, repos, entry_names if entry_names else []))
    out.extend(_check_links(repos))
    return out


# --------------------------------------------------------------------------
# 判据一：恰好一个 role: system
# --------------------------------------------------------------------------

def _check_roles(repos):
    out = []
    bad_role = [r for r in repos if r["role"] not in _ROLES]
    if bad_role:
        out.append(finding(
            NAME, UNDETERMINED, "有 %d 个仓的 role 不是 system/app/retired/archived" % len(bad_role),
            reason="；".join("%s 的 role = %r" % (r["name"], r["role"]) for r in bad_role[:_MAX_LISTED]),
            why="01 §3.8 只定义了这四种角色；角色不明时它的义务是哪一套判不了",
        ))
    systems = [r for r in repos if r["role"] == "system"]
    if len(systems) == 1:
        out.append(finding(
            NAME, PASS, "承载系统级工件的仓恰好一个：%s" % systems[0]["name"],
            where=systems[0]["path"],
            evidence="repos 共 %d 个，role: system 的 1 个" % len(repos),
        ))
    elif not systems:
        out.append(finding(
            NAME, FAIL, "没有任何仓声明 role: system",
            why="01 §3.8'指定一个承载系统级工件的仓'：跨仓才成立的事实在整个系统里只有一处权威。"
                "没有这个仓，产品意图、系统全景、跨仓契约与系统级状态就没有唯一维护位置",
            evidence="repos 的 role 取值：%s" % ", ".join("%s=%s" % (r["name"], r["role"] or "（空）") for r in repos),
        ))
    else:
        out.append(finding(
            NAME, FAIL, "有 %d 个仓声明 role: system：%s" % (len(systems), "、".join(r["name"] for r in systems)),
            where=systems[0]["path"],
            why="01 §3.8'指定一个承载系统级工件的仓'是单数。多于一个即系统级事实有两处权威，"
                "按 §3.8 归属判据出现第二处文本按 N2 判缺陷",
            evidence="role: system 的条目：%s" % "、".join("%s（%s）" % (r["name"], r["path"]) for r in systems),
        ))
    return out


# --------------------------------------------------------------------------
# 判据二：各仓 path 存在且是 git 仓库
# --------------------------------------------------------------------------

def _check_reachable(repos):
    out = []
    for r in repos:
        if not r["_exists"]:
            out.append(finding(
                NAME, UNDETERMINED, "仓 %s 的 path 在本机不存在：%s" % (r["name"], r["path"]),
                where=r["path"],
                reason="本机没有这个目录；可能是别人机器上的检出布局，也可能是配置过期，本工具分不清",
                why="01 §3.8 的其余各条都要读该仓的文件；仓不可定位时其结论一律未定，不推定合规",
                evidence="解析后的绝对路径：%s" % r["_real"],
            ))
        elif not r["_is_git"]:
            out.append(finding(
                NAME, UNDETERMINED, "仓 %s 的目录存在但根下没有 .git" % r["name"],
                where=r["path"],
                reason="目录在，但没有 .git；可能是 worktree/submodule 的别样布局或尚未初始化，本工具只按 .git 认",
                why="01 §3.8 讲的是代码仓之间的工件分布；这个对象是不是一个仓判不了",
                evidence="解析后的绝对路径：%s" % r["_real"],
            ))
        else:
            out.append(finding(
                NAME, PASS, "仓 %s 可定位且是 git 仓库" % r["name"],
                where=r["path"], evidence=r["_real"],
            ))
    return out


# --------------------------------------------------------------------------
# 判据三：每个仓必须有自己的入口文件
# --------------------------------------------------------------------------

def _check_entry_exists(repos, entries, entry_names):
    out = []
    for r in repos:
        if not r["_exists"]:
            continue
        path, nm = entries.get(r["name"], (None, None))
        if path:
            out.append(finding(
                NAME, PASS, "仓 %s 有自己的入口：%s" % (r["name"], nm),
                where="%s/%s" % (r["path"].rstrip("/"), nm),
            ))
        else:
            out.append(finding(
                NAME, FAIL, "仓 %s 没有自己的入口文件" % r["name"],
                where=r["path"],
                why="01 §3.8'每个仓必须有自己的入口文件'：入口是投影不是副本，"
                    "但先得有——没有入口，在这个仓里起会话就读不到本仓约束，也读不到系统级权威在哪",
                evidence="在 %s 下找过：%s，都不存在" % (r["_real"], "、".join(entry_names)),
            ))
    return out


# --------------------------------------------------------------------------
# 判据四：入口是投影不是副本（两跳内到达系统级权威）
# --------------------------------------------------------------------------

def _system_tokens(sysrepo):
    toks = [sysrepo["name"]]
    base = os.path.basename(sysrepo["_real"].rstrip("/\\"))
    if base and base not in toks:
        toks.append(base)
    return [t for t in toks if t and t not in (".", "..")]


def _mentions_system(text, sysrepo, src_file):
    """文本里有没有指向系统仓的引用。返回命中的证据串，没有返回 None。"""
    for tok in _system_tokens(sysrepo):
        if _name_appears(text, tok):
            return "出现记号 %r" % tok
    # 相对链接解析进系统仓根
    base = sysrepo["_abs"].rstrip("/") + "/"
    for t in _link_targets(text):
        if t.startswith("/") or os.path.isabs(t):
            continue
        resolved = _norm(os.path.join(os.path.dirname(src_file), t))
        if resolved == sysrepo["_abs"] or resolved.startswith(base):
            return "链接 %r 解析进系统仓" % t
    return None


def _check_projection(repos, entries):
    out = []
    systems = [r for r in repos if r["role"] == "system"]
    if len(systems) != 1:
        out.append(finding(
            NAME, UNDETERMINED, "系统仓不唯一，'两跳内到达系统级权威'判不了",
            reason="role: system 的条目有 %d 个，无法确定'系统级权威'指向哪里" % len(systems),
            why="01 §3.8'从任一仓的入口出发，两跳内到达系统级权威'",
        ))
        return out
    sysrepo = systems[0]

    for r in repos:
        if r["role"] != "app" or not r["_exists"]:
            continue
        entry_path, nm = entries.get(r["name"], (None, None))
        if not entry_path:
            continue  # 入口缺失已在判据三报过，不重复
        try:
            text = _read(entry_path)
        except OSError as exc:
            out.append(undetermined_from_exception(NAME, exc, "读 %s 的入口" % r["name"]))
            continue
        hit = _mentions_system(text, sysrepo, entry_path)
        if hit:
            out.append(finding(
                NAME, PASS, "仓 %s 的入口第一跳即指向系统仓 %s" % (r["name"], sysrepo["name"]),
                where="%s/%s" % (r["path"].rstrip("/"), nm),
                evidence=hit,
            ))
            continue
        # 第二跳：跟随入口里指向本仓内已存在文件的链接
        hop2, followed = None, 0
        for t in _link_targets(text):
            if followed >= _MAX_HOP2_LINKS:
                break
            if t.startswith("/") or os.path.isabs(t) or _SCHEME.match(t):
                continue
            nxt = os.path.normpath(os.path.join(os.path.dirname(entry_path), t))
            if not os.path.isfile(nxt):
                continue
            followed += 1
            try:
                hop2 = _mentions_system(_read(nxt), sysrepo, nxt)
            except OSError:
                continue
            if hop2:
                hop2 = "第二跳 %s：%s" % (t, hop2)
                break
        if hop2:
            out.append(finding(
                NAME, PASS, "仓 %s 的入口第二跳到达系统仓 %s" % (r["name"], sysrepo["name"]),
                where="%s/%s" % (r["path"].rstrip("/"), nm),
                evidence=hop2,
            ))
        else:
            out.append(finding(
                NAME, FAIL, "仓 %s 的入口两跳内到不了系统仓 %s" % (r["name"], sysrepo["name"]),
                where="%s/%s" % (r["path"].rstrip("/"), nm),
                why="01 §3.8'各仓入口是投影不是副本'，验收是'从任一仓的入口出发，两跳内到达系统级权威，"
                    "并能读出系统由哪几个仓组成、各自状态'。到不了，本仓的会话就只能拿本仓这一份文本当全部事实",
                evidence="入口 %s 里没有 %s，也没有解析进系统仓的相对链接；"
                         "跟随了 %d 个本仓内链接做第二跳，仍未命中"
                         % (nm, "/".join(_system_tokens(sysrepo)), followed),
            ))
    return out


# --------------------------------------------------------------------------
# 判据五：各仓状态在系统级入口登记
# --------------------------------------------------------------------------

def _check_registration(repos, entries):
    out = []
    systems = [r for r in repos if r["role"] == "system"]
    if len(systems) != 1:
        return out  # 判据四已记未定
    sysrepo = systems[0]
    if not sysrepo["_exists"]:
        return out  # 判据二已记未定
    entry_path, nm = entries.get(sysrepo["name"], (None, None))
    if not entry_path:
        out.append(finding(
            NAME, UNDETERMINED, "系统仓 %s 没有入口，'各仓状态在系统级入口登记'判不了" % sysrepo["name"],
            reason="系统仓根下找不到 layout.entry 列出的任何入口文件",
            why="01 §3.8'每个仓的状态在系统级入口登记'",
        ))
        return out
    try:
        text = _read(entry_path)
    except OSError as exc:
        return [undetermined_from_exception(NAME, exc, "读系统仓入口")]

    lines = text.splitlines()
    missing, bare, ok = [], [], []
    for r in repos:
        hits = [ln for ln in lines if _name_appears(ln, r["name"])]
        if not hits:
            missing.append(r)
        elif any(_has_status_token(ln) for ln in hits):
            ok.append(r)
        else:
            bare.append((r, hits[0].strip()[:160]))

    where = "%s/%s" % (sysrepo["path"].rstrip("/"), nm)
    if missing:
        out.append(finding(
            NAME, FAIL, "系统级入口未登记 %d 个仓：%s"
                        % (len(missing), "、".join(r["name"] for r in missing)),
            where=where,
            why="01 §3.8'每个仓的状态在系统级入口登记（active / retired / archived）'。"
                "后果是从入口出发发现不了它——读入口的人和会话不知道这个仓存在，"
                "它的规则、文档与未了结的状态都在覆盖范围之外（M-26 观察三）",
            evidence="在 %s（%d 字符 / %d 行）里逐个查 repos 的 name，缺：%s"
                     % (nm, len(text), len(lines),
                        "、".join("%s（role=%s）" % (r["name"], r["role"] or "（空）") for r in missing)),
        ))
    if bare:
        out.append(finding(
            NAME, UNDETERMINED, "系统级入口里有 %d 个仓只出现了名字，看不出登记了什么状态：%s"
                                % (len(bare), "、".join(r["name"] for r, _ in bare)),
            where=where,
            reason="名字所在的行上没有 %s 之类的状态词。它是被当作一个仓登记并写明状态，"
                   "还是只在正文里顺带被提到（比如某条链接的说明文字），机械判不了——"
                   "**按名字出现即记通过会造成假通过**，故记未定" % "/".join(_STATUS_TOKENS[:6]),
            why="01 §3.8'每个仓的状态在系统级入口登记（active / retired / archived）'："
                "要求登记的是状态，不只是名字。状态没登记时后果同 M-26 观察三——"
                "从入口出发看不出这个仓还在不在用，它的过期规则是否仍会被读入",
            evidence="；".join("%s → 命中行：%s" % (r["name"], ln) for r, ln in bare[:_MAX_LISTED]),
        ))
    if ok and not missing and not bare:
        out.append(finding(
            NAME, PASS, "系统级入口里 %d 个仓都带状态词登记" % len(ok),
            where=where,
            evidence="只判名字所在行上有没有状态词，不判写的那个状态与 repos 里的 role 是否一致",
        ))
    return out


# --------------------------------------------------------------------------
# 判据六：退役仓的规则必须已失效
# --------------------------------------------------------------------------

def _check_retired(cfg, repos, entry_names):
    out = []
    dead = [r for r in repos if r["role"] in _DEAD_ROLES]
    if not dead:
        return out
    patterns = cfg_get(cfg, "rule_files") or cfg_get(cfg, "layout.rule_files")
    used_default = patterns is None
    if used_default:
        patterns = list(_DEFAULT_RULE_FILES)
    if not isinstance(patterns, list):
        return [finding(
            NAME, UNDETERMINED, "rule_files 不是列表，退役仓一条判不了",
            reason="rule_files = %r" % (patterns,),
            why="01 §3.8'退役仓在停止使用的同一次变更里，其入口与规则文件必须被标为失效或删除'",
        )]
    patterns = [str(p) for p in patterns] + [str(e) for e in entry_names]
    note = "rule_files 用的是缺省清单 %s（项目未在 project.yaml 里校准）" % _DEFAULT_RULE_FILES \
        if used_default else "rule_files 取自 project.yaml"

    for r in dead:
        if not r["_exists"]:
            continue  # 判据二已记未定
        try:
            files, truncated = _expand_rule_files(r["_real"], patterns)
        except OSError as exc:
            out.append(undetermined_from_exception(NAME, exc, "枚举 %s 的规则文件" % r["name"]))
            continue
        live, unreadable = [], []
        for p in files:
            try:
                head = _head_lines(p)
            except OSError as exc:
                unreadable.append("%s（%s）" % (os.path.relpath(p, r["_real"]), exc))
                continue
            if not _has_invalidation_marker(head):
                live.append(os.path.relpath(p, r["_real"]).replace("\\", "/"))
        if unreadable:
            out.append(finding(
                NAME, UNDETERMINED, "退役仓 %s 有 %d 份规则文件读不了" % (r["name"], len(unreadable)),
                where=r["path"],
                reason="；".join(unreadable[:_MAX_LISTED]),
                why="01 §3.8：退役仓保留着可被读入的规则时按 N1 记未定，不推定无害",
            ))
        if truncated:
            out.append(finding(
                NAME, UNDETERMINED, "退役仓 %s 的规则文件超过扫描上限 %d，未扫全" % (r["name"], _MAX_RULE_FILES),
                where=r["path"],
                reason="只查了前 %d 份；未查的部分是没看，不是没问题（契约 §2）" % _MAX_RULE_FILES,
                why="01 §3.8 退役仓一条",
            ))
        if live:
            out.append(finding(
                NAME, FAIL, "退役仓 %s（role=%s）仍有 %d 份文件可被当作现行规则读入"
                            % (r["name"], r["role"], len(live)),
                where="%s/%s" % (r["path"].rstrip("/"), live[0]),
                why="01 §3.8'退役仓在停止使用的同一次变更里，其入口与规则文件必须被标为失效或删除'——"
                    "退役不是'不再提交'，是'不再被读'。失效是双向的：一面是从系统级入口发现不了这个仓，"
                    "另一面是在它的目录里起一次会话，就会把这些过期规则当作现行规则整份读入，"
                    "与系统仓的现行规则直接冲突，中间没有任何检查（M-26 观察二、三）",
                evidence="前 %d 行内没有 %s 任一失效标记的文件（共 %d 份，列前 %d）：%s；%s"
                         % (_MARKER_HEAD_LINES,
                            "/".join(_MARKERS_CN + _MARKERS_EN),
                            len(live), min(len(live), _MAX_LISTED),
                            "、".join(live[:_MAX_LISTED]), note),
            ))
        else:
            out.append(finding(
                NAME, PASS, "退役仓 %s 的 %d 份规则文件都带失效标记" % (r["name"], len(files)),
                where=r["path"],
                evidence="扫描清单：%s；%s" % ("、".join(patterns), note),
            ))
    return out


# --------------------------------------------------------------------------
# 判据七：跨仓引用可达
# --------------------------------------------------------------------------

def _check_links(repos):
    out = []
    known = [r for r in repos if r["_exists"]]
    if len(known) < 2:
        out.append(finding(
            NAME, UNDETERMINED, "本机可读的仓不足两个，跨仓引用判不了",
            reason="repos 里在本机存在的目录只有 %d 个" % len(known),
            why="01 §3.8'跨仓引用按契约处理'，验收是跨仓链接可机械检查",
        ))
        return out

    for r in known:
        try:
            mds, truncated = _list_md(r, known)
        except OSError as exc:
            out.append(undetermined_from_exception(NAME, exc, "枚举 %s 的 md 文件" % r["name"]))
            continue
        broken, host_abs, total = [], [], 0
        for f in mds:
            try:
                text = _read(f)
            except OSError:
                continue
            rel_f = os.path.relpath(f, r["_real"]).replace("\\", "/")
            for t in _link_targets(text):
                if t.startswith("/"):
                    host_abs.append("%s -> %s" % (rel_f, t))
                    continue
                if os.path.isabs(t):
                    host_abs.append("%s -> %s" % (rel_f, t))
                    continue
                resolved = os.path.normpath(os.path.join(os.path.dirname(f), t))
                owner = _owner_repo(resolved, known)
                if owner is None:
                    # 解析到所有声明仓之外：也算跨出本仓的引用
                    if _norm(resolved).startswith(r["_abs"].rstrip("/") + "/"):
                        continue
                elif owner["_abs"] == r["_abs"]:
                    continue  # 仍在本仓内，不归本检查器
                total += 1
                if not os.path.exists(resolved):
                    broken.append("%s -> %s" % (rel_f, t))

        where = r["path"]
        if truncated:
            out.append(finding(
                NAME, UNDETERMINED, "仓 %s 的 md 文件超过扫描上限 %d，跨仓引用未扫全" % (r["name"], _MAX_MD_FILES),
                where=where,
                reason="只扫了前 %d 份 *.md；未扫的部分是没看，不是没问题（契约 §2）" % _MAX_MD_FILES,
                why="01 §3.8'跨仓引用按契约处理'",
            ))
        if host_abs:
            out.append(finding(
                NAME, UNDETERMINED, "仓 %s 有 %d 处引用指向绝对路径，本机不可判" % (r["name"], len(host_abs)),
                where=where,
                reason="指向部署主机路径（或站点根路径），本机不可判存在性；不判存在性也不推定它成立",
                why="01 §3.8'跨仓引用按契约处理'：这些路径同样是契约，但其存在性要在目标主机上验",
                evidence="共 %d 处，列前 %d：%s" % (len(host_abs), min(len(host_abs), _MAX_LISTED),
                                                 "；".join(host_abs[:_MAX_LISTED])),
            ))
        if broken:
            out.append(finding(
                NAME, FAIL, "仓 %s 有 %d 处跨仓引用解析后不存在" % (r["name"], len(broken)),
                where="%s/%s" % (r["path"].rstrip("/"), broken[0].split(" -> ")[0]),
                why="01 §3.8'跨仓引用按契约处理'：一个仓的文档指向另一个仓的路径时该路径是契约，"
                    "移动前先改全部引用方或保留指针。断掉的引用意味着契约已被单方面破坏，"
                    "顺着它走的人和会话到不了目标",
                evidence="共 %d 处，列前 %d：%s（扫描范围：本仓 %d 份 *.md 的 markdown 链接）"
                         % (len(broken), min(len(broken), _MAX_LISTED),
                            "；".join(broken[:_MAX_LISTED]), len(mds)),
            ))
        else:
            out.append(finding(
                NAME, PASS, "仓 %s 的 %d 处跨仓引用全部可达" % (r["name"], total),
                where=where,
                evidence="扫了 %d 份 *.md" % len(mds),
            ))
    return out


# --------------------------------------------------------------------------
# 自检：反例与正例各一（契约 §3）
# --------------------------------------------------------------------------

def _mk(path, text):
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def _mk_repo(root, name):
    """造一个最小的仓目录。只按 .git 是否存在认仓库身份，故不依赖 git 可执行文件。"""
    d = os.path.join(root, name)
    os.makedirs(os.path.join(d, ".git"), exist_ok=True)
    return d


def _sample(tmp, bad):
    """造三仓样本。bad=True 时：退役仓规则未失效，且系统入口未登记它。"""
    for nm in ("sys", "app", "old"):
        _mk_repo(tmp, nm)
    if bad:
        _mk(os.path.join(tmp, "sys", "CLAUDE.md"),
            "# 系统仓\n\n本系统由这几个仓组成：sys、app。\n")
        _mk(os.path.join(tmp, "old", "CLAUDE.md"),
            "# 老仓入口\n\n七阶段流水线由 PM 调度，子 agent 不自路由。\n")
        _mk(os.path.join(tmp, "old", ".harness", "rules", "00-core.md"),
            "# 核心规则\n\n每次开工先跑流水线。\n")
    else:
        _mk(os.path.join(tmp, "sys", "CLAUDE.md"),
            "# 系统仓\n\n本系统由这几个仓组成：sys（system）、app（active）、old（retired）。\n"
            "各仓状态见本文件。\n")
        _mk(os.path.join(tmp, "old", "CLAUDE.md"),
            "# 老仓入口（已退役）\n\n本仓已退役，以下内容不再生效，现行规则见 ../sys/CLAUDE.md。\n")
    _mk(os.path.join(tmp, "app", "CLAUDE.md"),
        "# 应用仓 app\n\n本仓特有约束见下。系统级权威在 [系统仓](../sys/CLAUDE.md)。\n")
    return {
        "_root": tmp,
        "layout": {"entry": ["CLAUDE.md", "AGENTS.md"]},
        "repos": [
            {"name": "sys", "path": "sys", "role": "system"},
            {"name": "app", "path": "app", "role": "app"},
            {"name": "old", "path": "old", "role": "retired"},
        ],
    }


def selftest():
    results = []
    try:
        with tempfile.TemporaryDirectory() as tmp:
            bad_dir = os.path.join(tmp, "bad")
            os.makedirs(bad_dir)
            got = run(_sample(bad_dir, bad=True))
            fails = [f for f in got if f["status"] == FAIL]
            titles = " | ".join(f["title"] for f in fails)
            want_retired = any("仍有" in f["title"] and "现行规则读入" in f["title"] for f in fails)
            want_unreg = any("系统级入口未登记" in f["title"] for f in fails)
            ok = bool(fails) and want_retired and want_unreg
            results.append(finding(
                NAME, PASS if ok else FAIL,
                "反例：退役仓规则未失效 + 系统入口未登记该仓，应判 FAIL",
                evidence="实得 FAIL %d 条：%s（退役仓一条命中=%s，未登记一条命中=%s）"
                         % (len(fails), titles or "无", want_retired, want_unreg),
                why="契约 §3 静默失效探测：抓不出违规的检查器，其结论作废",
            ))

        with tempfile.TemporaryDirectory() as tmp:
            good_dir = os.path.join(tmp, "good")
            os.makedirs(good_dir)
            got = run(_sample(good_dir, bad=False))
            other = [f for f in got if f["status"] != PASS]
            ok = bool(got) and not other
            results.append(finding(
                NAME, PASS if ok else FAIL,
                "正例：承载仓唯一、各仓有入口、投影可达、状态已登记、退役仓已标失效，应判 PASS",
                evidence="实得 %d 条，非 PASS %d 条：%s"
                         % (len(got), len(other),
                            "；".join("%s/%s（%s）" % (f["status"], f["title"], f.get("reason") or f.get("evidence"))
                                     for f in other) or "无"),
                why="契约 §3 静默失效探测：正例误报 FAIL 的检查器同样不可用",
            ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(
            NAME, FAIL, "自检自身出错", evidence="%s: %s" % (type(exc).__name__, exc),
            why="契约 §3：自检不过则本检查器结论作废",
        ))
    return results
