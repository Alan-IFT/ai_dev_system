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
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from stdlib import (  # noqa: E402
    FAIL, PASS, SKIP, UNDETERMINED,
    cfg_get, finding, in_frozen, is_tailored_out, undetermined_from_exception,
)

NAME = "cross-repo"
STANDARD_REFS = ["01 §3.8"]

# 退役仓里"可被当作现行规则读入"的默认清单；项目可用 project.yaml 的
# layout.rule_files 覆盖。**只认这一种拼法**：此处曾另有一个顶层 rule_files 的回退，
# 同一事实两种写法本身就是 01 §2 N2 的副本缺陷，已删。契约 §5 也只文档化 layout.rule_files。
_DEFAULT_RULE_FILES = [".harness/rules/", ".claude/", "AGENTS.md", "CLAUDE.md"]

# 失效标记：出现在文件前若干行即认为已标为失效。
_MARKER_HEAD_LINES = 20
_MARKERS_CN = ("已退役", "失效", "不再生效", "已归档", "已停用")
_MARKERS_EN = ("retired", "archived", "deprecated")

_ROLES = ("system", "app", "retired", "archived")
_DEAD_ROLES = ("retired", "archived")

# 01 §3.8 对 archived 的定义就是"已移出工作区，只在远端"。所以这类条目的 path 可省略，
# 且本地目录不存在不是缺陷——要求它在本机有检出才是把定义读反了（那会逼项目在配置里
# 写一条随机器漂移的本机绝对路径副本）。凡需读该仓本地文件的判据对它一律记不适用。
_ARCHIVED_ABSENT = "archived 仓按 01 §3.8 不在工作区，未核本地检出"

# 判据八的唯一豁免：同一行上写了改名标记词。豁免写在被检查的那一行上，不设清单。
_RENAME_MARKERS = ("前身", "曾用名", "改名", "更名", "formerly", "renamed")

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
    """仓名是否作为独立记号出现。不能用裸子串——嵌套命名下 RCMS 会被
    RCMS_Backend 假命中，那会把'未登记'误判成通过。"""
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


def _archived_absent(r):
    """这个条目是不是「声明为 archived 且本机没有检出」。见 _ARCHIVED_ABSENT。"""
    return r["role"] == "archived" and not r["_exists"]


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
    """把 layout.rule_files 的条目展开成实际存在的文件路径。以 / 结尾的按目录递归。"""
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
        if not name:
            return None, "repos 第 %d 项缺 name" % i
        if not path and role != "archived":
            return None, "repos 第 %d 项缺 path（只有 role: archived 可省略：%s）" % (i, _ARCHIVED_ABSENT)
        abspath = os.path.abspath(os.path.join(root, path)) if path else None
        exists = bool(abspath) and os.path.isdir(abspath)
        repos.append({
            "name": name,
            "path": path,
            "_where": path or "（未声明 path）",
            "role": role,
            "_abs": _norm(abspath) if abspath else None,
            "_real": abspath,
            "_exists": exists,
            "_is_git": exists and _is_git_repo(abspath),
            "former_names": item.get("former_names"),
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
    rule_files = cfg_get(cfg, "layout.rule_files") or _DEFAULT_RULE_FILES
    al = ["%s 的旧名 %s" % (i.get("name"), a) for i in (cfg_get(cfg, "repos") or [])
          if isinstance(i, dict) and isinstance(i.get("former_names"), list)
          for a in i["former_names"]]
    former = (
        "repos[].former_names 声明的历史别名（%s）：是否仍以独立记号出现在**别的仓**的 git 跟踪文本里"
        "（判据八）。它补的正是本检查器判据四声明不看的那一片——判据四只看 *.md 里的 markdown 链接语法，"
        "判据八用 git grep 扫全部跟踪文件里的裸词，两条判据在此互相指认" % "、".join(al)) if al else None
    return {
        "covered": [
            "repos 里声明的每个仓：路径是否存在、根下有没有 .git、有没有 layout.entry 里的入口文件（%s）"
            % (", ".join(map(str, entries)) or "（未配置）"),
            "role: system 的条目是不是恰好一个（01 §3.8 指定一个承载系统级工件的仓）",
            "各应用仓的入口能否在两跳内出现指向系统仓的引用（系统仓 name、其目录名、或解析进系统仓的相对链接）",
            "系统仓的入口里有没有出现每个 repos 条目的 name，且该名字所在行上有没有状态词"
            "（01 §3.8 各仓状态在系统级入口登记）",
            "role 为 retired/archived 的仓根下，layout.rule_files（%s）展开出的文件前 %d 行有没有失效标记"
            % (", ".join(map(str, rule_files)), _MARKER_HEAD_LINES),
            "各仓 *.md 里 markdown 链接语法写的跨仓相对路径，解析后是否存在",
        ] + ([former] if former else []),
        "not_covered": ([] if former else [
            "repos[].former_names 未声明，仓的历史别名一字未查——不声明就不猜哪个名字是旧名（判据八）",
        ]) + [
            "role: archived 的条目按 01 §3.8 的定义（已移出工作区，只在远端）可不给 path；"
            "省略 path 或 path 在本机不存在时，判据二按定义记通过，凡需读该仓本地文件的各条"
            "（入口、失效头、跨仓引用）对它记不适用——不核远端那一份里有什么。"
            "给了 path 且目录在，则照读照判；role: retired 不享受这条",
            "判据八不判某处指称是历史记述还是当现称用——那是人的裁定（契约 §7）；只按'出现在谁的仓里'"
            "机械分层，自仓那一层一律记未定",
            "判据八只扫根下有 .git 的仓的 git 跟踪文件，layout.frozen 下的路径不扫；"
            "同一行上写了改名标记词（%s）即豁免，豁免只认同一行、不设可以偷偷加东西的清单"
            % "/".join(_RENAME_MARKERS),
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
            "退役仓的规则文件清单以 layout.rule_files 为准；清单外的位置（如仓内子目录的另一套 agents）不看",
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
    out.extend(_check_former_names(cfg, repos))
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
            kind="bad-role",
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
        if _archived_absent(r):
            out.append(finding(
                NAME, PASS, "仓 %s 声明 role: archived，本机无检出即符合定义" % r["name"],
                where=r["_where"],
                evidence="%s（%s）" % (
                    _ARCHIVED_ABSENT,
                    "条目未给 path" if not r["path"] else "给了 path %s 但本机没有这个目录" % r["path"]),
            ))
        elif not r["_exists"]:
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
        if _archived_absent(r):
            out.append(finding(
                NAME, SKIP, "仓 %s 的入口记不适用（archived，本地无检出）" % r["name"],
                where=r["_where"], reason=_ARCHIVED_ABSENT,
                why="01 §3.8 要求每个仓有自己的入口；该仓的入口只在远端，本机读不到，"
                    "既不记通过也不记未定",
            ))
            continue
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
            where=where, kind="name-only",
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
    patterns = cfg_get(cfg, "layout.rule_files")
    used_default = patterns is None
    if used_default:
        patterns = list(_DEFAULT_RULE_FILES)
    if not isinstance(patterns, list):
        return [finding(
            NAME, UNDETERMINED, "layout.rule_files 不是列表，退役仓一条判不了",
            reason="layout.rule_files = %r" % (patterns,),
            why="01 §3.8'退役仓在停止使用的同一次变更里，其入口与规则文件必须被标为失效或删除'",
        )]
    patterns = [str(p) for p in patterns] + [str(e) for e in entry_names]
    note = "layout.rule_files 用的是缺省清单 %s（项目未在 project.yaml 里校准）" % _DEFAULT_RULE_FILES \
        if used_default else "layout.rule_files 取自 project.yaml"

    for r in dead:
        if _archived_absent(r):
            out.append(finding(
                NAME, SKIP, "退役仓 %s 的失效标记记不适用（archived，本地无检出）" % r["name"],
                where=r["_where"], reason=_ARCHIVED_ABSENT,
                why="01 §3.8 要求退役仓的入口与规则文件已标失效或删除；本机没有这些文件可读，"
                    "既不记通过也不记未定",
            ))
            continue
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
                where=r["path"], kind="unreadable-rules", key=r["name"],
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
    for r in repos:
        if _archived_absent(r):
            out.append(finding(
                NAME, SKIP, "仓 %s 的跨仓引用记不适用（archived，本地无检出）" % r["name"],
                where=r["_where"], reason=_ARCHIVED_ABSENT,
                why="01 §3.8'跨仓引用按契约处理'：本机没有它的 *.md 可扫；"
                    "别的仓指向它的引用仍按那些仓自己那一条判",
            ))
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
                where=where, kind="abs-refs", key=r["name"],
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
# 判据八：仓的历史别名还在被别的仓当作现称使用
# --------------------------------------------------------------------------

def _git_grep(repo_real, needle):
    """一次子进程召回。返回 (命中列表, 错误)；命中项为 (相对路径, 行号, 行文)。"""
    cmd = ["git", "-C", repo_real, "--no-optional-locks", "-c", "core.quotepath=false",
           "grep", "-I", "-n", "-F", "-e", needle, "--", "."]
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as exc:
        return None, "跑不了 git grep：%s" % exc
    if p.returncode not in (0, 1):   # 1 = 一条都没命中，是正常出口
        return None, "git grep 退出码 %d：%s" % (
            p.returncode, (p.stderr or b"").decode("utf-8", "replace").strip()[:160])
    rows = [ln.split(":", 2) for ln in (p.stdout or b"").decode("utf-8", "replace").splitlines()]
    return [(h[0].replace("\\", "/"), h[1], h[2].strip()[:120]) for h in rows if len(h) == 3], None


def _check_former_names(cfg, repos):
    """未声明 former_names 则一字不查（见 scope）。声明了才召回、才分层。"""
    out, names, todo = [], set(r["name"] for r in repos), []
    for r in repos:
        fn = r["former_names"]
        if fn is None:
            continue
        if not isinstance(fn, list):
            out.append(finding(NAME, UNDETERMINED, "仓 %s 的历史别名读不出来" % r["name"],
                               reason="former_names = %r，不是列表；契约 §5：取值有歧义时不猜" % (fn,),
                               why="01 §3.8'跨仓引用按契约处理'"))
            continue
        for a in [str(x).strip() for x in fn if str(x).strip()]:
            if a in names:        # ←—— 挡住大批误报的四行，不许省
                out.append(finding(
                    NAME, UNDETERMINED, "仓 %s 的历史别名 %r 与在册仓名相撞，本项不扫描" % (r["name"], a),
                    reason="repos 里已有一个仓就叫 %r：按它召回，命中的是现名的正常引用而不是旧名的死指针" % a,
                    why="契约 §1.1：召回前提不成立时记未定，绝不产出 FAIL"))
                continue
            todo.append((r, a))
    if not todo:
        return out
    cross, mine, errs = [], [], []
    for owner, alias in todo:
        for r in [x for x in repos if x["_is_git"]]:
            hits, err = _git_grep(r["_real"], alias)
            if err:
                errs.append("%s / %s：%s" % (r["name"], alias, err))
                continue
            for rel, no, line in hits:
                if in_frozen(cfg, rel) or not _name_appears(line, alias):
                    continue
                if any((m in line) or (m in line.lower()) for m in _RENAME_MARKERS):
                    continue
                (mine if r["_abs"] == owner["_abs"] else cross).append(
                    "%s/%s:%s（%s 的旧名 %s）" % (r["name"], rel, no, owner["name"], alias))
    al = "、".join("%s←%s" % (o["name"], a) for o, a in todo)
    how = "（逐仓一次 git grep -I -n -F，命中行再过 _name_appears 词边界复核；同行写了 %s 任一改名标记的" \
          "已豁免；layout.frozen 下的路径与根下没有 .git 的仓不扫）" % "/".join(_RENAME_MARKERS)
    if errs:
        out.append(finding(NAME, UNDETERMINED, "有 %d 次历史别名召回没跑成" % len(errs),
                           kind="alias-recall-failed",
                           reason="；".join(errs[:_MAX_LISTED]),
                           why="契约 §2：召回跑不成是'没看'，不推定'没有命中'"))
    if cross:
        out.append(finding(
            NAME, FAIL, "历史别名仍被别的仓当作现称使用：%d 文件 / %d 行"
                        % (len(set(x.split(":")[0] for x in cross)), len(cross)),
            where=cross[0].split("（")[0],
            why="01 §3.8'跨仓引用按契约处理'：仓改名之后，别的仓里写着旧名的那一行就是一条指向不存在的仓的"
                "指针，顺着它走的人和会话到不了目标；改名方要么同批改掉全部引用方、要么留一个转发指针",
            evidence="别名：%s；共 %d 行，列前 %d：%s%s"
                     % (al, len(cross), min(len(cross), _MAX_LISTED),
                        "；".join(cross[:_MAX_LISTED]), how)))
    elif not errs:
        out.append(finding(NAME, PASS, "%d 个历史别名在别的仓里都不再被当作现称使用" % len(todo),
                           evidence="别名：%s；扫了 %d 个仓%s"
                                    % (al, len([r for r in repos if r["_is_git"]]), how)))
    if mine:
        out.append(finding(
            NAME, UNDETERMINED, "历史别名在它自己那个仓里还出现 %d 行" % len(mine),
            kind="alias-residue",
            reason="自己仓里写自己的旧名，是历史记述还是当现称用机械分不了——这一层的裁定归读报告的人（契约 §7）",
            why="01 §3.8：只有'别的仓写旧名'才是确定的断指针；自仓这一层按 01 §2 N1 记未定，不记失败",
            evidence="共 %d 行，列前 %d：%s" % (len(mine), min(len(mine), _MAX_LISTED),
                                            "；".join(mine[:_MAX_LISTED]))))
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


def _sample_archived(tmp):
    """archived 且不给 path 的样本：本机只有 sys 与 app 两个检出，arch 只在远端。"""
    for nm in ("sys", "app"):
        _mk_repo(tmp, nm)
    _mk(os.path.join(tmp, "sys", "CLAUDE.md"),
        "# 系统仓\n\n本系统由这几个仓组成：sys（system）、app（active）、arch（archived，已移出工作区）。\n")
    _mk(os.path.join(tmp, "app", "CLAUDE.md"),
        "# 应用仓 app\n\n本仓特有约束见下。系统级权威在 [系统仓](../sys/CLAUDE.md)。\n")
    return {
        "_root": tmp,
        "layout": {"entry": ["CLAUDE.md"]},
        "repos": [
            {"name": "sys", "path": "sys", "role": "system"},
            {"name": "app", "path": "app", "role": "app"},
            {"name": "arch", "role": "archived"},
        ],
    }


def _alias_probe(body, former):
    """判据八的两仓样本，必须是**真** git 仓（git grep 只看索引）。只取判据八那几条。"""
    with tempfile.TemporaryDirectory() as tmp:
        for nm in ("sys", "app"):
            d = os.path.join(tmp, nm)
            _mk(os.path.join(d, "CLAUDE.md"), u"# %s\n\n权威见 [系统仓](../sys/CLAUDE.md)。\n" % nm)
            if nm == "app":
                _mk(os.path.join(d, "docs", "note.md"), body + u"\n")
            for arg in (["init", "-q"], ["add", "-A"]):
                subprocess.run(["git", "-C", d] + arg, capture_output=True, timeout=60)
        got = [f for f in run({
            "_root": tmp, "layout": {"entry": ["CLAUDE.md"]},
            "repos": [{"name": "sys", "path": "sys", "role": "system", "former_names": former},
                      {"name": "app", "path": "app", "role": "app"}],
        }) if u"历史别名" in f["title"]]
    return [f["status"] for f in got], " | ".join(f["title"] for f in got) or "无"


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

        with tempfile.TemporaryDirectory() as tmp:
            arch_dir = os.path.join(tmp, "arch")
            os.makedirs(arch_dir)
            got = run(_sample_archived(arch_dir))
            und = [f for f in got if f["status"] == UNDETERMINED]
            bad = [f for f in got if f["status"] == FAIL]
            reach = [f for f in got if f["status"] == PASS and "arch" in f["title"]
                     and "archived" in f["title"]]
            skips = [f for f in got if f["status"] == SKIP and "arch" in f["title"]]
            # 入口、失效头、跨仓引用三条对它都得记不适用
            ok = bool(reach) and len(skips) >= 3 and not und and not bad
            results.append(finding(
                NAME, PASS if ok else FAIL,
                "archived 无 path 夹具：判据二应 PASS，需读其本地文件的各条应记不适用，全程不得出现未定",
                evidence="实得 %d 条：判据二 PASS %d 条、不适用 %d 条、未定 %d 条、失败 %d 条；"
                         "非 PASS/SKIP 明细：%s"
                         % (len(got), len(reach), len(skips), len(und), len(bad),
                            "；".join("%s/%s（%s）" % (f["status"], f["title"],
                                                    f.get("reason") or f.get("evidence"))
                                     for f in und + bad) or "无"),
                why="01 §3.8 把 archived 定义为'已移出工作区，只在远端'；"
                    "要求它在本机有检出才算过，就是把定义读反（契约 §1.1 的反向："
                    "把定义允许的状态记成判不了，会逼项目写一条随机器漂移的本机绝对路径）",
            ))

        for want, title, probes in (
            ([FAIL], "判据八反例：历史别名出现在别的仓里，应判 FAIL",
             [(u"现行清单见 SYS_OLD/docs/list.md。", ["SYS_OLD"])]),
            ([PASS], "判据八正例：别的仓里没有出现历史别名，应判 PASS",
             [(u"现行清单见 ../sys/docs/list.md。", ["SYS_OLD"])]),
            ([PASS, UNDETERMINED],
             "判据八收窄反例：同行带改名标记不得报；别名撞在册仓名必须记未定且不扫描",
             [(u"SYS_OLD 已更名为 sys，清单见 ../sys/docs/list.md。", ["SYS_OLD"]),
              (u"现行清单见 app/docs/list.md。", ["app"])]),
        ):
            got = [_alias_probe(b, f) for b, f in probes]
            results.append(finding(
                NAME, PASS if [g[0] for g in got] == [[w] for w in want] else FAIL, title,
                evidence="期望 %s，实得 %s" % (want, "；".join("%s：%s" % g for g in got)),
                why="契约 §3 静默失效探测：抓不出违规、或对正例误报的检查器，其结论作废；"
                    "契约 §1.1：召回前提不成立时记未定不产 FAIL，豁免只认被检查的那一行、不设清单",
            ))

        # id 的区分力（契约 §9）：两个仓各有一处指向绝对路径的引用，两条未定的 id
        # 必须按仓名分开。key 不带仓名的话两条 id 相同，登记一行会把两个仓一起静音。
        with tempfile.TemporaryDirectory() as tmp:
            abs_dir = os.path.join(tmp, "abs")
            os.makedirs(abs_dir)
            cfg = _sample(abs_dir, bad=False)
            for nm in ("sys", "app"):
                _mk(os.path.join(abs_dir, nm, "docs", "ref.md"),
                    "# 引用\n\n见 [部署目录](/srv/deploy/notes.md)。\n")
            got = [f for f in run(cfg) if (f.get("id") or "").startswith(NAME + "/abs-refs/")]
            ids = sorted(f["id"] for f in got)
            ok = ids == [NAME + "/abs-refs/app", NAME + "/abs-refs/sys"]
            results.append(finding(
                NAME, PASS if ok else FAIL,
                "id 区分力：两个仓各有一处绝对路径引用，两条未定的 id 须按仓名分开",
                evidence="实得 %d 条：%s" % (len(got), "、".join(ids) or "无"),
                why="契约 §9：id 是例外登记的地址，两个仓共用一个地址就会被一行登记一起静音",
            ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(
            NAME, FAIL, "自检自身出错", evidence="%s: %s" % (type(exc).__name__, exc),
            why="契约 §3：自检不过则本检查器结论作废",
        ))
    return results
