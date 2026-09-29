# -*- coding: utf-8 -*-
"""检查器公共库：三态 Finding、严格配置加载、路径工具。

契约见同目录 CONTRACT.md。本模块只用标准库——目标项目不应为了跑检查而先装依赖。
"""
from __future__ import annotations

import datetime
import hashlib
import io
import os
import re
import stat
import subprocess

# git 跑钩子时给子进程注入的仓库定位变量，取自 `git rev-parse --local-env-vars`（git 自己
# 进入另一个仓库前清掉的就是这张表）。显式的 GIT_DIR 压过 `-C`：从 worktree 提交时钩子里
# 的 GIT_DIR 是绝对路径，检查器的夹具 `git -C <临时目录> init/add/commit` 会整批落进真实仓，
# 写出垃圾提交、把 core.bare 改成 true。GIT_CEILING_DIRECTORIES 不在表里：它只挡
# 上溯、不改定位，自检还要自己设它。
GIT_LOCAL_ENV = (
    "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CONFIG", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT",
    "GIT_OBJECT_DIRECTORY", "GIT_DIR", "GIT_WORK_TREE", "GIT_IMPLICIT_WORK_TREE", "GIT_GRAFT_FILE",
    "GIT_INDEX_FILE", "GIT_NO_REPLACE_OBJECTS", "GIT_REPLACE_REF_BASE", "GIT_PREFIX",
    "GIT_SHALLOW_FILE", "GIT_COMMON_DIR",
)


# 被扫仓的 .git/config 是被扫方写的：压缩包、共享目录带进来的仓，配置里可以写任何命令，
# 本工具的每个 `git -C <被扫仓>` 都会照它执行（实测 core.fsmonitor、blame 的 textconv、
# clean 过滤器都会跑）。经 GIT_CONFIG_COUNT 注入的是命令行级配置（git ≥ 2.31），优先级高于
# 任何配置文件，一处设好全部子进程生效。过滤器的驱动名是被扫方起的，这里列不全，
# 会读工作区的调用（blame、status）另经 `filter_env` 按仓逐个置空。
GIT_HARDEN_CONFIG = (
    ("core.fsmonitor", "false"), ("core.hooksPath", "/dev/null"), ("core.sshCommand", ""),
    ("core.gitProxy", ""), ("core.askPass", ""), ("diff.external", ""), ("core.pager", "cat"),
    # log.showSignature=true 时 `git log` 会对签名提交调 gpg.program（被扫方可指定任意程序）
    ("log.showSignature", "false"),
)
# GIT_OPTIONAL_LOCKS=0：扫描不刷新、不回写被扫仓的 index（只读扫描不该有写入）。
GIT_HARDEN_ENV = (("GIT_PAGER", "cat"), ("GIT_TERMINAL_PROMPT", "0"), ("GIT_OPTIONAL_LOCKS", "0"))


# GIT_CONFIG_COUNT 注入要 git ≥ 2.31；更老的 git 静默忽略这些变量，上面的加固全部失效。
GIT_MIN_VERSION = (2, 31)


def git_version_problem(out=None):
    """git 低于 GIT_MIN_VERSION 或认不出版本时返回原因串，否则 None（git 跑不起来也返回 None——
    那时每个 git 读点各自记未定）。out 只为自检注入 `git version` 的输出。"""
    if out is None:
        try:
            out = subprocess.run(["git", "version"], capture_output=True, text=True,
                                 encoding="utf-8", timeout=60).stdout
        except (OSError, subprocess.SubprocessError):
            return None
    m = re.search(r"(\d+)\.(\d+)", out or "")
    if not m:
        return "认不出 git 版本（%r）；加固配置要 git ≥ %d.%d 才生效" % (((out or "").strip()[:40],) + GIT_MIN_VERSION)
    if (int(m.group(1)), int(m.group(2))) < GIT_MIN_VERSION:
        return ("git %s.%s 低于 %d.%d：经 GIT_CONFIG_COUNT 注入的加固（fsmonitor、过滤器、pager 等）"
                "会被静默忽略，被扫仓配置里的外部程序可能被执行；请升级 git" % ((m.group(1), m.group(2)) + GIT_MIN_VERSION))
    return None


def scrub_git_env():
    """从本进程环境去掉 GIT_LOCAL_ENV，再注入 GIT_HARDEN_CONFIG／GIT_HARDEN_ENV。

    入口一次调用（重复调用无害），此后所有 git 子进程（夹具与目标仓）都靠 `-C`／cwd 定位，
    不再被调用方（钩子）的仓库劫持，也不执行被扫仓配置里的外部程序。"""
    for key in GIT_LOCAL_ENV:
        os.environ.pop(key, None)
    for i in range(64):
        if os.environ.pop("GIT_CONFIG_KEY_%d" % i, None) is None:
            break
        os.environ.pop("GIT_CONFIG_VALUE_%d" % i, None)
    os.environ["GIT_CONFIG_COUNT"] = str(len(GIT_HARDEN_CONFIG))
    for i, (key, value) in enumerate(GIT_HARDEN_CONFIG):
        os.environ["GIT_CONFIG_KEY_%d" % i] = key
        os.environ["GIT_CONFIG_VALUE_%d" % i] = value
    os.environ.update(GIT_HARDEN_ENV)


_FILTER_ENV = {}   # 按仓（真实路径）缓存：一次扫描里 blame 要对每份文档跑一遍，不必每次都起子进程读配置


def filter_env(root):
    """把被扫仓配置里声明的过滤器驱动逐个置空的子进程环境（会读工作区的 git 调用传它）。

    过滤器由 .gitattributes 与配置合起来触发，驱动名由被扫方起，无法事先列全；读配置本身不执行
    任何东西，所以先列出名字再逐个置空。经 GIT_CONFIG_KEY_n/VALUE_n 传，键值分开——名字里带
    `=` 也不会像 `-c k=v` 那样被切错。列不出（git 失败、超时）返回 None，调用方记未定，不照常执行。
    """
    key = os.path.realpath(str(root))
    if key in _FILTER_ENV:
        return _FILTER_ENV[key]
    try:
        out = subprocess.run(["git", "-C", root, "config", "-z", "--name-only", "--get-regexp",
                              r"^filter\."], capture_output=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode not in (0, 1):      # 1 = 一个过滤器都没配，是正常出口
        return None
    names = set()
    for k in (out.stdout or b"").decode("utf-8", "surrogateescape").split("\0"):
        head, _dot, _tail = k.rpartition(".")
        if head.startswith("filter."):
            names.add(head)
    env = dict(os.environ)
    n = int(env.get("GIT_CONFIG_COUNT") or 0)
    for head in sorted(names):
        for sub, val in (("clean", ""), ("smudge", ""), ("process", ""), ("required", "false")):
            env["GIT_CONFIG_KEY_%d" % n] = "%s.%s" % (head, sub)
            env["GIT_CONFIG_VALUE_%d" % n] = val
            n += 1
    env["GIT_CONFIG_COUNT"] = str(n)
    _FILTER_ENV[key] = env
    return env


PASS = "PASS"
FAIL = "FAIL"
UNDETERMINED = "UNDETERMINED"
SKIP = "SKIP"

STATUSES = (PASS, FAIL, UNDETERMINED, SKIP)

# 01 §3.5 的「状态」字段在文档头部叫什么。中英两写都算。
#
# 放进 stdlib 是因为它此前有三份不一致的副本：`check_layout` 只认英文单值
# `"status"`，`check_freshness` 与 `check_evidence` 各持一份 ("状态","status","state")。
# 同一事实三份副本违反 01 §1 G2；更要紧的是那份英文单值已经产出过一条假 FAIL
# （本仓 `PROJECT_STATUS.md` 头部写的是「状态：进行中」，被报成"缺状态字段"），
# 那是 01 §2 N1 禁止的确定性错误结论。**新增写法只在这里加，不在检查器里另起一张表。**
STATUS_FIELDS = (u"状态", u"status", u"state")

# 01 §3.5 的日期字段名缺省（`metadata_fields` 未配时取它，契约 §5）。此前 layout 与 freshness
# 各持一份、解析写法也不同（freshness 另认一种契约里没有的映射写法），解析只在 `date_fields_of` 一处。
DEFAULT_DATE_FIELDS = (u"updated_at",)


def normalize_key(key):
    """Finding id 里 key 段的归一化：去首尾空白、内部空白与换行折成 `_`、`|` 换成 `｜`。

    `|` 要换掉是因为 id 会被人抄进 markdown 表格的「规则」列，裸竖线会把那一行拆成两格。
    """
    return re.sub(r"\s+", u"_", str(key).strip()).replace(u"|", u"｜")


def finding_id(check, title, kind=None, key=None):
    """Finding 的稳定标识（契约 §9）。

    `kind` 给了 → `check/kind[/归一化 key]`，判据不变它就不变，标题怎么改都不影响；
    没给 → `check/` + `sha1(title)[:8]`，只在同一工具身份内稳定（标题一改就换）。
    """
    if kind:
        out = u"%s/%s" % (check, kind)
        if key is not None and str(key).strip():
            out += u"/" + normalize_key(key)
        return out
    # surrogateescape：非 UTF-8 文件名经 git ls-files 解码后带代理字符，严格编码会让整个检查器崩掉
    return u"%s/%s" % (check, hashlib.sha1(title.encode("utf-8", "surrogateescape")).hexdigest()[:8])


def finding(check, status, title, where=None, why="", reason="", evidence="",
            kind=None, key=None):
    """构造一条 Finding。status 非法即抛——不允许悄悄产生第四种状态。"""
    if status not in STATUSES:
        raise ValueError("非法状态 %r" % (status,))
    if status in (UNDETERMINED, SKIP) and not reason:
        raise ValueError("%s 必须给 reason（契约 §1）" % status)
    return {
        "check": check,
        "id": finding_id(check, title, kind, key),
        "status": status,
        "title": title,
        "where": where,
        "why": why,
        "reason": reason,
        "evidence": evidence,
        # 例外登记由 check_all 在全部检查跑完之后贴上（契约 §9）；检查器自己不填。
        "registered": None,
    }


# 检查器自身出错（崩溃、自检闸门不过）的 kind。这类未定**不可登记**（契约 §9）：崩溃会顶掉该检查器
# （或某条判据）本次的 FAIL，登记它等于登记 FAIL。只用于真正的崩溃：读不了文件用 unreadable，
# 配置错误给专门 kind。load_exceptions 按规则列的第二段认它。
INTERNAL_ERROR_KIND = "internal-error"


def undetermined_from_exception(check, exc, what):
    """检查器内部异常一律转 UNDETERMINED，绝不吞掉记 PASS。"""
    return finding(
        check, UNDETERMINED,
        "%s 时检查器自身出错" % what,
        reason="%s: %s" % (type(exc).__name__, exc),
        evidence="检查器故障时其结论作废；按 01 §5.6 判检查器故障，不按通过记。",
        kind=INTERNAL_ERROR_KIND,
    )


# --------------------------------------------------------------------------
# 日期
# --------------------------------------------------------------------------

def parse_date(raw, strict=False):
    """支持 YYYY-MM-DD 与 ISO8601。返回 (date, None) 或 (None, 原因)。解析不了不猜。

    从 `check_freshness._parse_date` 提上来：新鲜度与例外登记的到期都要解析日期，
    留两份必然漂（01 §1 G2）。`*` 与反引号是 markdown 的加粗/行内代码标记，先剥掉。
    strict：只收纯日期，不认「日期 + 任意文字」（例外登记的到期，契约 §9）。
    """
    s = str(raw).replace("*", "").replace("`", "").strip()
    if not s:
        return None, "值为空"
    try:
        return datetime.date.fromisoformat(s), None
    except ValueError:
        pass
    t = s.replace("Z", "+00:00").replace("z", "+00:00")
    try:
        return datetime.datetime.fromisoformat(t).date(), None
    except ValueError:
        pass
    m = None if strict else re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        try:
            return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3))), None
        except ValueError:
            return None, "不是合法日期：%r" % s
    return None, "既不是 YYYY-MM-DD 也不是 ISO8601：%r" % s


# --------------------------------------------------------------------------
# 严格 YAML 子集
# --------------------------------------------------------------------------

class ConfigError(Exception):
    """配置无法被无歧义地解析。歧义即拒绝，不猜。"""


_SCALAR_TRUE = {"true", "yes", "on"}
_SCALAR_FALSE = {"false", "no", "off"}


def _scalar(raw, lineno):
    s = raw.strip()
    if not s:
        return ""
    if s == "[]":
        # 唯一接受的流式写法：空列表没有歧义，且 metadata_required 靠它区分
        # "声明一类都没有"与"没声明"（契约 §5）
        return []
    if s[0] in "[{&*|>!%@`":
        raise ConfigError(
            "第 %d 行用了本解析器不支持的 YAML 语法 %r。"
            "本工具只接受最简子集（缩进映射、短横线列表、纯量），"
            "看不懂即拒绝而不是猜。" % (lineno, s[0])
        )
    if s[0] in "\"'":
        if len(s) < 2 or s[-1] != s[0] or s[0] in s[1:-1]:
            raise ConfigError("第 %d 行的引号没有成对闭合（或引号里又有同种引号），本解析器不处理" % lineno)
        body = s[1:-1]
        if "\\" in body:
            raise ConfigError("第 %d 行的引号字符串含转义，本解析器不处理" % lineno)
        return body
    if ": " in s:
        raise ConfigError("第 %d 行的值里有「: 」：YAML 不收这种写法（`a: b: c`），值里要带冒号请整体加引号" % lineno)
    low = s.lower()
    if low in _SCALAR_TRUE:
        return True
    if low in _SCALAR_FALSE:
        return False
    if low in ("null", "~"):
        return None
    if re.fullmatch(r"-?\d+", s):
        return int(s)
    if re.fullmatch(r"-?\d+\.\d+", s):
        return float(s)
    return s


def _strip_comment(line):
    """去行尾注释。只在 # 前有空白或位于行首时才算注释，避免吃掉值里的 #。

    引号只在值的开头（行首、`:` 或 `- ` 之后）才开启引用：`don't # 注释` 里的撇号是正文，
    不许把后面的注释吞进值里。
    """
    out, in_q, q, last = [], False, "", ""     # last：已收下的最后一个非空白字符（不每次 join，免平方级）
    for i, ch in enumerate(line):
        if in_q:
            out.append(ch)
            if ch == q:
                in_q = False
        elif ch in "\"'":
            if last in ("", ":", "-"):
                in_q, q = True, ch
            out.append(ch)
        elif ch == "#" and (i == 0 or line[i - 1] in " \t"):
            break
        else:
            out.append(ch)
        if not ch.isspace():
            last = ch
    return "".join(out).rstrip()


# 映射行：键（裸词或整体加引号）后跟冒号，冒号后是空白或行尾——YAML 的写法；`https://x` 不是映射。
# 裸键不带 `\s*` 接冒号（键尾空白由 _split_kv 去掉）：`[^:]*?\s*:` 在长空白行上是平方级回溯。
_MAP_LINE = re.compile(r"""^(?:"([^"]*)"\s*|'([^']*)'\s*|([^\s"'#:][^:]*)):(?:\s+(.*)|)$""")


def _not_kv(body, lineno):
    """不是 `键: 值` 行时的拒收信息：带行号，指明是哪种写法不支持（不回显内容）。"""
    if body.startswith(("---", "...")):
        what = "YAML 文档分隔符（--- / ...）"
    elif body[:1] in "[{":
        what = "流式写法（[...] / {...}）"
    elif ":" in body:
        what = "冒号后没有空格（须写成 `键: 值`），或键里带引号、冒号"
    else:
        what = "没有 `键: 值` 的冒号"
    return ConfigError("第 %d 行不是 `键: 值`：本解析器不支持%s" % (lineno, what))


def _split_kv(body, lineno):
    """`键: 值` → (键, 值文本)；不是映射行返回 None。键两侧的引号剥掉。"""
    m = _MAP_LINE.match(body)
    if not m:
        return None
    key = next(g for g in m.groups()[:3] if g is not None).strip()
    if not key:
        raise ConfigError("第 %d 行的键为空" % lineno)
    return key, (m.group(4) or "")


def parse_yaml_subset(text):
    """解析 CONTRACT.md §5 所述结构。不支持的语法一律抛 ConfigError，不静默误读。"""
    lines = []
    for n, raw in enumerate(text.splitlines(), 1):
        if "\t" in raw.split("#")[0]:
            raise ConfigError("第 %d 行含制表符；请用空格缩进" % n)
        body = _strip_comment(raw)
        if body.strip():
            lines.append((n, len(body) - len(body.lstrip(" ")), body.strip()))

    def block(idx, indent):
        """返回 (value, next_idx)。indent 是本块的缩进量。"""
        if idx >= len(lines):
            return None, idx
        if lines[idx][2].startswith("- "):
            items = []
            while idx < len(lines) and lines[idx][1] == indent and lines[idx][2].startswith("- "):
                n, _, body = lines[idx]
                rest = body[2:].strip()
                kv = _split_kv(rest, n)
                if kv and kv[1].strip():
                    # 列表项是行内起始的映射：- name: x
                    k, v = kv
                    item = {k: _scalar(v, n)}
                    idx += 1
                    child_indent = indent + 2
                    while idx < len(lines) and lines[idx][1] >= child_indent and not lines[idx][2].startswith("- "):
                        n2, ind2, b2 = lines[idx]
                        if ind2 != child_indent:
                            raise ConfigError("第 %d 行缩进不一致" % n2)
                        kv2 = _split_kv(b2, n2)
                        if kv2 is None:
                            raise _not_kv(b2, n2)
                        k2, v2 = kv2
                        if k2 in item:
                            raise ConfigError("第 %d 行的键 %r 在同一列表项里重复；重复键的取值有歧义" % (n2, k2))
                        if not v2.strip():      # 空值：下一行更深才是子块，否则取 None（与映射分支一致）
                            if idx + 1 < len(lines) and lines[idx + 1][1] > child_indent:
                                item[k2], idx = block(idx + 1, lines[idx + 1][1])
                            else:
                                item[k2], idx = None, idx + 1
                            continue
                        item[k2] = _scalar(v2, n2)
                        idx += 1
                    items.append(item)
                elif kv and rest.endswith(":"):
                    raise ConfigError("第 %d 行的列表项 %s 后面没有值；本解析器不支持这种嵌套写法" % (n, "- key:"))
                elif rest == "[]":
                    # 空列表只作键的值才有意义（区分"声明没有"与"没声明"）；
                    # 作列表项是嵌套空列表，没有哪个键收这个形状
                    raise ConfigError("第 %d 行的列表项是空列表 []；只有键的值可以写 []" % n)
                elif rest:
                    items.append(_scalar(rest, n))
                    idx += 1
                else:
                    raise ConfigError("第 %d 行是空列表项" % n)
            return items, idx
        mapping = {}
        while idx < len(lines) and lines[idx][1] == indent:
            n, _, body = lines[idx]
            if body.startswith("- "):
                break
            kv = _split_kv(body, n)
            if kv is None:
                raise _not_kv(body, n)
            k, v = kv
            if k in mapping:
                raise ConfigError("第 %d 行的键 %r 重复；重复键的取值有歧义" % (n, k))
            if v.strip():
                mapping[k] = _scalar(v, n)
                idx += 1
                continue
            if idx + 1 < len(lines) and lines[idx + 1][1] > indent:
                sub, idx = block(idx + 1, lines[idx + 1][1])
                mapping[k] = sub
            else:
                mapping[k] = None
                idx += 1
        return mapping, idx

    if not lines:
        return {}
    try:
        value, end = block(0, lines[0][1])
    except RecursionError:
        raise ConfigError("嵌套层数超出本解析器的递归上限；本工具的配置只需两三层")
    if end != len(lines):
        if lines[end][2].startswith("- "):
            raise ConfigError("第 %d 行的列表项与它的键同列：本解析器要求列表项比键多缩进"
                              "（`键:` 下一行写 `  - 值`）" % lines[end][0])
        raise ConfigError("第 %d 行缩进层级无法归属" % lines[end][0])
    return value


CONFIG_CANDIDATES = ("governance/project.yaml", "governance/project.yml")


class OutsideRoot(OSError):
    """路径的真实位置（跟随符号链接后）不在被扫项目之内。继承 OSError：各读点已有的
    `except OSError` 照常把它转成未定。"""


def _under(p, r):
    return p == r or p.startswith(r.rstrip(os.sep) + os.sep)


def inside(root, path):
    """path 跟随符号链接后是否仍在 root 之内（含 root 本身）。判不了按"不在"算。

    先按字面（abspath）判：字面就在 root 之外的路径直接返回 False，**不碰文件系统**——
    realpath 会逐段 lstat，那本身就是对项目之外路径的探测。字面在内的再按真实位置判（符号链接出仓）。
    """
    try:
        if not _under(os.path.abspath(str(path)), os.path.abspath(str(root or "."))):
            return False
        return _under(os.path.realpath(str(path)), os.path.realpath(str(root or ".")))
    except (OSError, ValueError):
        return False


def guard(root, path):
    """读被扫项目里的文件之前调用：真实位置在 root 之外即抛 OutsideRoot，不读、不回显内容。

    被扫项目里的符号链接可以指向仓外任意文件；跟随它读，就是把仓外内容（与其存在性）带进报告。
    """
    if not inside(root, path):
        raise OutsideRoot("%s 的真实位置在被扫项目之外（符号链接或 ..），未读" % path)
    return path


# 值是项目内路径的配置键。写 `..` 段或绝对路径就是让检查器去读项目之外的文件，拒收整份配置。
# `repos[].path` 不在此列：多仓系统的兄弟仓本来就在项目之外（01 §3.8），由 cross-repo 按仓读。
_PATH_KEYS = ("layout.entry", "layout.docs_root", "layout.work_root", "layout.frozen",
              "layout.rule_files", "metadata_required")


def _escaping_paths(cfg):
    vals = []
    for key in _PATH_KEYS:
        v = cfg_get(cfg, key)
        vals += [(key, x) for x in (v if isinstance(v, list) else [v])]
    arts = cfg_get(cfg, "layout.artifacts")
    if isinstance(arts, dict):
        vals += [("layout.artifacts." + str(k), v) for k, v in arts.items()]
    for i, item in enumerate(cfg_get(cfg, "derived") or []):
        if isinstance(item, dict):
            vals += [("derived[%d].%s" % (i, k), item.get(k)) for k in ("artifact", "source")]
    bad = []
    for key, v in vals:
        if not isinstance(v, str) or not v.strip():
            continue
        p = v.strip().replace("\\", "/")
        if os.path.isabs(p) or re.match(r"^[A-Za-z]:/", p) or ".." in p.split("/"):
            bad.append(key)
    return bad


# 值必须是整数的阈值键与下限。写错不许静默换成默认值（与「不许静默误读」同一条规则），整份配置拒收。
_DUP_BUDGETS = (("duplicate_min_lines", 2), ("duplicate_min_chars", 1))


def _key_line(text, key):
    """键 key 首次出现的行号（报错定位用，不回显内容）；找不到给 0。"""
    return next((i for i, ln in enumerate(text.splitlines(), 1)
                 if re.match(r"""\s*(?:-\s+)?["']?%s["']?\s*:""" % re.escape(key), ln)), 0)


def _bad_dup_budgets(cfg, text):
    budgets = cfg.get("budgets")
    if not isinstance(budgets, dict):
        return None
    for key, low in _DUP_BUDGETS:
        if key not in budgets:
            continue
        v = budgets[key]
        if isinstance(v, int) and not isinstance(v, bool) and v >= low:
            continue
        line = _key_line(text, key)
        return "第 %d 行 budgets.%s 须是 ≥%d 的整数；写错不取默认值" % (line, key, low)
    return None


# 配置键的形状（契约 §5 类型表）。写成别的形状不许静默误读——frozen 写成字符串被逐字符迭代、
# tailoring 写成映射静默不生效、layout.entry: 5 让两个检查器崩溃——整份拒收，报键名与行号。空值＝没写。
_SHAPES = (("tier", "str"), ("layout.docs_root", "str"), ("layout.work_root", "str"),
           ("layout", "map"), ("layout.artifacts", "map"), ("budgets", "map"),
           ("tailoring", "maps"), ("derived", "maps"), ("repos", "maps"),
           ("layout.frozen", "strs"), ("layout.rule_files", "strs"), ("metadata_required", "strs"),
           ("layout.entry", "str|strs"), ("metadata_fields", "str|strs"),
           ("work_item_done_states", "str|strs"), ("work_item_in_progress_states", "str|strs"))
_SHAPE_NAMES = {"str": "字符串", "map": "映射", "maps": "映射组成的列表", "strs": "字符串列表", "str|strs": "字符串或字符串列表"}


def _shape_ok(v, shape):
    if v is None or (shape == "str|strs" and isinstance(v, str)):
        return True
    if shape == "str":
        return isinstance(v, (str, int, float)) and not isinstance(v, bool)
    if shape == "map":
        return isinstance(v, dict)
    return isinstance(v, list) and all(
        isinstance(x, dict) if shape == "maps" else
        isinstance(x, (str, int, float)) and not isinstance(x, bool) for x in v)


def _bad_shape(cfg, text):
    items = [(key, cfg_get(cfg, key), shape) for key, shape in _SHAPES]
    for lst, subs in (("repos", (("name", "str"), ("path", "str"), ("role", "str"), ("former_names", "strs"))),
                      ("derived", (("artifact", "str"), ("source", "str"), ("regen", "str"))),
                      ("tailoring", (("check", "str"), ("reason", "str")))):
        items += [("%s[%d].%s" % (lst, i, k), r.get(k), shape)
                  for i, r in enumerate(cfg_get(cfg, lst) or []) if isinstance(r, dict) for k, shape in subs]
    arts = cfg_get(cfg, "layout.artifacts")
    items += [("layout.artifacts." + str(k), v, "str|strs" if k == "entry" else "str")
              for k, v in (arts.items() if isinstance(arts, dict) else ())]
    for key, v, shape in items:
        if not _shape_ok(v, shape):
            return "第 %d 行 %s 须是%s；写成别的形状不猜" % (
                _key_line(text, key.rsplit(".", 1)[-1]), key, _SHAPE_NAMES[shape])
    return None


def _read_config(root, p, shown):
    """读并解析一份配置。返回 (cfg, problem)；报错只给路径与行号，不回显文件内容。"""
    try:
        text = read_bytes(p).decode("utf-8-sig")   # 带 BOM 的首键不许读成 \ufeffcompatibility
        cfg = parse_yaml_subset(text)
    except ConfigError as exc:
        return {}, "%s 无法无歧义解析：%s" % (shown, exc)
    except UnicodeDecodeError as exc:
        return {}, "%s 不是 UTF-8 编码（第 %d 字节起解不开）；本工具只读 UTF-8" % (shown, exc.start)
    except OSError as exc:
        return {}, "%s 读不了：%s" % (shown, type(exc).__name__)
    if not isinstance(cfg, dict):
        return {}, "%s 的顶层不是映射" % shown
    injected = sorted(k for k in cfg if str(k).startswith("_"))
    if injected:      # 下划线键是代码注入口（契约 §4），写进配置等于让被检查方指定检查范围
        return {}, "%s 第 %d 行的顶层键以 _ 开头；这类键只由代码注入，项目配置写了整份拒收" % (
            shown, _key_line(text, injected[0]))
    bad_budget = _bad_shape(cfg, text) or _bad_dup_budgets(cfg, text)
    if bad_budget:
        return {}, "%s 无法无歧义解析：%s" % (shown, bad_budget)
    bad = _escaping_paths(cfg)
    if bad:
        return {}, ("%s 里 %s 的路径含 .. 段或是绝对路径，指向项目之外；本工具只读被扫项目之内的文件"
                    % (shown, "、".join(bad)))
    return cfg, None


def load_config(root, config_path=None):
    """读配置。默认读 <root>/governance/project.yaml。

    config_path 给了就读那个文件，可以在被扫描项目之外——这样才能在不往被测项目
    写任何东西的前提下扫只读项目。此时 cfg["_root"] 仍是被扫描的 root，
    cfg["_path"] 记配置文件的真实路径。

    返回 (cfg, problem)。problem 非 None 时 cfg 为 {}，调用方据此记 UNDETERMINED，
    不得取默认值当事实（契约 §5）。
    """
    if config_path is not None:
        p = os.path.abspath(config_path)
        if not os.path.isfile(p):
            return {}, "指定的外部配置 %s 不存在（--config）；本工具不回退去猜项目布局" % p
        cfg, problem = _read_config(root, p, "指定的外部配置 %s" % p)
        if problem:
            return {}, problem
        cfg["_path"] = p
        cfg["_root"] = root
        return cfg, None

    for rel in CONFIG_CANDIDATES:
        p = os.path.join(root, rel)
        if os.path.lexists(p):               # lstat，不跟随：先判真实位置再探测目标
            if not inside(root, p):
                return {}, "%s 的真实位置在被扫项目之外（符号链接），未读" % rel
            if not os.path.isfile(p):
                continue
            cfg, problem = _read_config(root, p, rel)
            if problem:
                return {}, problem
            cfg["_path"] = rel
            cfg["_root"] = root
            return cfg, None
    return {}, "未找到 %s；本工具不猜项目布局" % " 或 ".join(CONFIG_CANDIDATES)


# --------------------------------------------------------------------------
# 例外登记（契约 §9）
# --------------------------------------------------------------------------

EXCEPTIONS_FILE = "exceptions.md"

# 表头按「包含」匹配，先命中者为准；`id` 只认整格（不区分大小写）——按包含，「到期 / valid until」
# 「Rule ID」「Provider」都会被当成编号列，到期或规则列随之丢失。
_EX_HEADERS = ((u"编号", "ex_id"), (u"规则", "rule"),
               (u"理由", "reason"), (u"范围", "scope"), (u"批准", "approver"),
               (u"到期", "expires"), (u"状态", "status"))

# 关闭态先判：关闭行不登记、不报过期、不参与有效性校验。**某一段以关闭词整词开头**才算关闭——
# 含词即关闭会把「没关闭」「not yet closed」「open (to be closed)」这类尚在生效的例外当成历史行放过；
# 按否定前缀排除又列不全（D-123）；只看前缀又会把「已处理中」「done? 否」「closed-loop 待复核」当成关闭。
# 关闭词后面只许是段尾、空白、加粗/反引号、括号或冒号、句号。
_EX_CLOSED_RE = re.compile(u"(?:关闭|已关闭|closed|done|已处理)(?=$|[\\s*`（(【\\[：:。.])")


def _ex_closed(status):
    """按逗号、分号、顿号、斜杠切段，任一段（去首尾加粗与反引号）以关闭词整词开头即关闭：
    「**已过期，已处理**（…）」「已关闭（09-01）」是关闭行，「not yet closed」「已处理中」不是。"""
    for seg in re.split(u"[，,;；、/|]+", status.lower()):
        if _EX_CLOSED_RE.match(seg.strip().strip(u"*`").strip()):
            return True
    return False

_MD_SEP_RE = re.compile(r"^\|(?:\s*:?-+:?\s*\|)+$")


def _md_cells(line):
    """拆一行 markdown 表格的单元格。`\\|` 是转义的竖线，不拆。"""
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|") and not s.endswith("\\|"):
        s = s[:-1]
    cells, cur, esc = [], [], False
    for ch in s:
        if esc:
            cur.append(ch if ch == "|" else "\\" + ch)
            esc = False
        elif ch == "\\":
            esc = True
        elif ch == "|":
            cells.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    if esc:
        cur.append("\\")
    cells.append("".join(cur).strip())
    return cells


def _first_md_table(text):
    """第一张 markdown 表。返回 (表头行号, 表头单元格, [(行号, 单元格), ...]) 或 None。"""
    lines = text.splitlines()
    for i in range(len(lines) - 1):
        if not lines[i].strip().startswith("|"):
            continue
        if not _MD_SEP_RE.match(lines[i + 1].strip()):
            continue
        rows, j = [], i + 2
        while j < len(lines) and lines[j].strip().startswith("|"):
            rows.append((j + 1, _md_cells(lines[j])))
            j += 1
        return i + 1, _md_cells(lines[i]), rows
    return None


def _ex_field(header_cell):
    if header_cell.strip().lower() == u"id":
        return "ex_id"
    for token, field in _EX_HEADERS:
        if token in header_cell or token in header_cell.lower():
            return field
    return None


# 登记到期的上限：运行日起一年（契约 §9）。更远的到期等于长期静音，按不合格行处置。
EXCEPTION_MAX_DAYS = 365


def load_exceptions(config_dir, root=None, today=None):
    """读例外登记册：配置文件**同目录**的 `exceptions.md`（契约 §9）。

    不带 `--config` 时就是 `<项目根>/governance/exceptions.md`。
    返回 `(rows, problems, source_path, own)`：

    - `rows`：本工具认领且五项齐全的登记行（rule 含 `/`，即 Finding id 的形态）。
      与项目自己的门号例外（`G6` 之类）共用一张表，**不含 `/` 的行本工具不登记、不校验五项**
      ——那是项目的门，不是本工具的发现，拿它去匹配发现只会成批报孤儿。
    - `problems`：本工具认领但不合格的行（行号 + 缺什么；到期晚于 today + 一年、或规则是检查器自身出错
      `<检查器>/internal-error` 的，同样不合格）。today 缺省取运行日。
    - `source_path`：文件路径；文件不存在时为 None。
    - `own`：未关闭的项目自有例外行（rule 不含 `/`），只取到期：`expires_date` 解析不了时为 None。
      02 §4「到期未清理 CI 转红」对它们同样成立，到期由调用方按运行日判。
    """
    path = os.path.join(config_dir, EXCEPTIONS_FILE)
    if not os.path.lexists(path):            # 只 lstat 这一处，先不跟随链接
        return [], [], None, []
    # 护栏：配置在项目内时登记册须在项目内，外部配置（--config）时须在配置目录内；越界不读、不回显
    base = root if (root and inside(root, config_dir)) else config_dir
    try:
        guard(base, path)
        if not os.path.isfile(path):
            return [], [], None, []
        text = read_bytes(path, base).decode("utf-8-sig")
    except (OSError, UnicodeDecodeError) as exc:
        return [], [u"%s 读不了：%s" % (EXCEPTIONS_FILE, exc)], path, []
    table = _first_md_table(text)
    if table is None:
        return [], [u"%s 里没有 markdown 表；本工具只读第一张表" % EXCEPTIONS_FILE], path, []

    hdr_lineno, header, raw_rows = table
    cols, dup, problems = {}, [], []
    for idx, cell in enumerate(header):
        field = _ex_field(cell)
        if field is None:
            continue
        if field in cols:
            dup.append(field)
            continue
        cols[field] = idx
    if dup:
        problems.append(u"第 %d 行（表头）有多列都命中 %s，按先命中者为准"
                        % (hdr_lineno, u"、".join(sorted(set(dup)))))

    rows, own = [], []
    for lineno, cells in raw_rows:
        if not any(c for c in cells):
            continue

        def get(field, _cells=cells):
            i = cols.get(field)
            return _cells[i].strip() if i is not None and i < len(_cells) else u""

        status = get("status")
        if _ex_closed(status):
            continue                                  # 先判关闭
        rule = get("rule").strip().strip(u"`").strip()
        ex_id, reason, scope = get("ex_id"), get("reason"), get("scope")
        approver, expires_raw = get("approver"), get("expires")
        if u"/" not in rule:                          # 项目自己的例外：只取到期
            day, err = parse_date(expires_raw, strict=True)
            own.append({"ex_id": ex_id, "rule": rule, "expires": expires_raw, "expires_date": day,
                        "error": err, "lineno": lineno})
            continue
        missing = [n for n, v in ((u"规则", rule), (u"理由", reason),
                                  (u"范围", scope), (u"批准人", approver)) if not v]
        day, err = parse_date(expires_raw, strict=True)
        if day is None:
            missing.append(u"到期（%s）" % err)
        tag = (u"（%s）" % ex_id) if ex_id else u""
        if missing:
            problems.append(u"第 %d 行%s缺：%s" % (lineno, tag, u"、".join(missing)))
            continue
        if rule.split(u"/")[1:2] == [INTERNAL_ERROR_KIND]:
            problems.append(u"第 %d 行%s登记的是检查器自身出错（%s），不可登记：崩溃顶掉了该检查器（或某条判据）"
                            u"本次的结论，登记它等于登记 FAIL；修好检查器或它的输入" % (lineno, tag, rule))
            continue
        limit = (today or datetime.date.today()) + datetime.timedelta(days=EXCEPTION_MAX_DAYS)
        if day > limit:
            problems.append(u"第 %d 行%s到期 %s 晚于上限 %s（运行日起 %d 天）"
                            % (lineno, tag, day.isoformat(), limit.isoformat(), EXCEPTION_MAX_DAYS))
            continue
        rows.append({"ex_id": ex_id, "rule": rule, "reason": reason, "scope": scope,
                     "approver": approver, "expires": day.isoformat(), "expires_date": day,
                     "status": status, "lineno": lineno})
    return rows, problems, path, own


def cfg_get(cfg, path, default=None):
    """按 'budgets.entry_lines' 取值，缺失返回 default。"""
    cur = cfg
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return default
        cur = cur[part]
    return cur


def is_tailored_out(cfg, check_name):
    """项目是否把该检查裁剪掉了。返回 (是否裁剪, 理由)。"""
    for item in cfg_get(cfg, "tailoring", []) or []:
        if isinstance(item, dict) and item.get("check") == check_name:
            if item.get("applicable") is False:
                return True, str(item.get("reason") or "").strip() or None
    return False, None


def date_fields_of(cfg):
    """文档日期字段名：`metadata_fields`（字符串列表，也接受单个字符串）。返回 (名字列表, 是否用的默认值)。"""
    raw = cfg_get(cfg, "metadata_fields")
    raw = [raw] if isinstance(raw, str) else raw
    names = [str(x).strip() for x in raw if str(x).strip()] if isinstance(raw, list) else []
    return (names, False) if names else (list(DEFAULT_DATE_FIELDS), True)


# --------------------------------------------------------------------------
# 文件与仓库
# --------------------------------------------------------------------------

# 本工具自身的仓根：`tools/std/stdlib.py` 上溯三层。采用项目按 subtree 把标准内嵌成
# `.std/` 之后，这个目录里的东西是**上游的内容**，不是本项目的判定对象（契约 §2）。
TOOL_ROOT = os.path.realpath(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def embedded_std_rel(root, tool_root=None):
    """工具自身所在的内嵌目录相对 root 的路径（如 `.std`）；不构成内嵌则 None。

    tool_root 只为自检注入，生产路径不传。在标准仓自己身上跑时 tool_root == root，
    返回 None——那时标准就是本项目的内容，照扫。
    """
    try:
        tr = os.path.realpath(str(tool_root or TOOL_ROOT))
        r = os.path.realpath(str(root or "."))
        if tr == r:
            return None
        rel = os.path.relpath(tr, r).replace("\\", "/")
    except (OSError, ValueError):   # realpath 遇坏路径（如含 NUL）会抛，按"不在其下"算，不崩
        return None
    if rel == ".." or rel.startswith("../") or os.path.isabs(rel):
        return None
    return rel


_LS_MEMO = [None]   # (扫描根的真实路径, {(模式, tool_root): 结果})；None＝没开


class scan_memo(object):
    """run_all 跑检查器那一段开启：扫描根上同一组模式的 `git ls-files` 一次扫描只跑一次。

    只缓存扫描根本身——检查器自检在临时仓里建夹具、改完再列，缓存它们会读到旧列表。
    退出即恢复外层（自检里嵌套跑的 run_all 各用各的），不跨扫描、不跨嵌套。
    """

    def __init__(self, root):
        self.key = os.path.realpath(str(root))

    def __enter__(self):
        self.prev, _LS_MEMO[0] = _LS_MEMO[0], (self.key, {})

    def __exit__(self, *_exc):
        _LS_MEMO[0] = self.prev


def tracked_files(root, patterns=None, tool_root=None):
    memo = _LS_MEMO[0]
    if memo and memo[0] == os.path.realpath(str(root)):
        key = (tuple(patterns or ()), tool_root)
        if key not in memo[1]:
            memo[1][key] = _tracked_files(root, patterns, tool_root)
        files, problem = memo[1][key]
        return (None if files is None else list(files)), problem
    return _tracked_files(root, patterns, tool_root)


def _tracked_files(root, patterns=None, tool_root=None):
    """git 跟踪的文件；不在 git 仓库时返回 (None, 原因)。

    用 `-z`：git 默认开 core.quotepath，会把非 ASCII 路径输出成
    `"docs/\\345\\275\\222..."` 这种转义形式。不还原就会把中文路径当成不存在，
    成批产生假 FAIL。`-z` 走 NUL 分隔、原样输出，从源头绕开这件事。

    工具自身所在的内嵌目录（`embedded_std_rel`）从**扫描面**里去掉：那是上游的内容。
    只影响扫描面——链接目标、layout 候选路径都走文件系统，不经本函数，不受影响。
    """
    cmd = ["git", "-C", root, "ls-files", "-z"]
    if patterns:
        cmd += list(patterns)
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as exc:
        return None, "跑不了 git ls-files：%s" % exc
    if out.returncode != 0:
        err = (out.stderr or b"").decode("utf-8", "replace").strip()[:200]
        return None, "git ls-files 退出码 %d：%s" % (out.returncode, err)
    raw = (out.stdout or b"").decode("utf-8", "surrogateescape")
    files = [p for p in raw.split("\0") if p.strip()]
    rel = embedded_std_rel(root, tool_root)
    if rel:
        files = [p for p in files if not p.startswith(rel + "/")]
    return files, None


def shallow_problem(root):
    """浅克隆下「最后一次提交」取的是边界提交、时间等于克隆那一刻，按它判新旧会把 FAIL 翻成 PASS。

    返回 None（不是浅克隆，可以用提交时间）或原因串（浅克隆、或探测不了）——调用方据此记未定。
    """
    try:
        out = subprocess.run(["git", "-C", root, "rev-parse", "--is-shallow-repository"],
                             capture_output=True, text=True, encoding="utf-8", timeout=60)
    except (OSError, subprocess.SubprocessError) as exc:
        return "跑不了 git rev-parse：%s" % exc
    if out.returncode != 0:
        return "git rev-parse --is-shallow-repository 退出码 %d" % out.returncode
    if out.stdout.strip().lower() == "true":
        return "浅克隆：git log 取到的是边界提交，时间等于克隆时刻，不是该文件真实的最后提交"
    return None


# 读被扫项目文件的唯一上限（此前 cross-repo 与 single-authority 各持一份 2MB，read_text 没有上限，
# 一份 4GB 稀疏文件就能把机器撑爆）。超限抛 TooLarge，各读点照常按 OSError 记未定。
MAX_READ_BYTES = 2 * 1024 * 1024


class TooLarge(OSError):
    """文件超过 MAX_READ_BYTES，未读。"""


class NotRegular(OSError):
    """不是常规文件（FIFO、设备、socket、目录），未读：FIFO 会让 open/read 永久阻塞。"""


def read_bytes(path, root=None, head=None):
    """读被扫项目文件的唯一入口：护栏 → 非阻塞打开 → 只收常规文件 → 大小上限。

    head=None 时超过 MAX_READ_BYTES 抛 TooLarge；给了 head 就只读前 head 字节、不因体量拒读。
    给了 root：先按字面、再按真实位置判（与 `guard` 同一规则，字面出仓不碰文件系统），打开后再核
    一次——真实路径仍是它自己（中间目录没被换成链接）、且与打开的 fd 是同一个文件（st_dev/st_ino，
    换出去又换回来也拦得下）。O_NOFOLLOW 挡住末段被换成符号链接。每读一份只做 3 次 realpath。
    """
    if root is not None and not _under(os.path.abspath(str(path)), os.path.abspath(str(root))):
        raise OutsideRoot("%s 的真实位置在被扫项目之外（符号链接或 ..），未读" % path)
    real = os.path.realpath(path)
    if root is not None and not _under(real, os.path.realpath(str(root))):
        raise OutsideRoot("%s 的真实位置在被扫项目之外（符号链接或 ..），未读" % path)
    fd = os.open(real, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0))
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise NotRegular("%s 不是常规文件，未读" % path)
        if root is not None:
            again = os.stat(real)
            if os.path.realpath(real) != real or (again.st_dev, again.st_ino) != (st.st_dev, st.st_ino):
                raise OutsideRoot("%s 在读取期间被换位，未读" % path)
        if head is None and st.st_size > MAX_READ_BYTES:
            raise TooLarge("%s 超过 %d 字节，未读" % (path, MAX_READ_BYTES))
        with os.fdopen(fd, "rb") as fh:
            fd = None
            data = fh.read(MAX_READ_BYTES + 1 if head is None else head)
    finally:
        if fd is not None:
            os.close(fd)
    if head is None and len(data) > MAX_READ_BYTES:     # 读的过程中长大了
        raise TooLarge("%s 超过 %d 字节，未读" % (path, MAX_READ_BYTES))
    return data


def read_text(path, root=None, head=None):
    """读文本（UTF-8，解不开的字节替换，行尾归一为 \\n）。走 read_bytes，同一套护栏与上限。"""
    text = read_bytes(path, root, head).decode("utf-8-sig", "replace")
    return text.replace("\r\n", "\n").replace("\r", "\n")


def count_lines(path, root=None):
    """行数。超过 MAX_READ_BYTES 的文件只数前 MAX_READ_BYTES 字节，得到的是**下界**：下界超预算
    照判超预算——入口撑过上限不许从确定的 FAIL 变成未定（R1-06）。"""
    text = read_text(path, root, head=MAX_READ_BYTES)
    return text.count("\n") + (1 if text and not text.endswith("\n") else 0)


def in_frozen(cfg, relpath):
    """是否落在只读归档区（不承担更新义务，见 01 §3.1）。"""
    rel = relpath.replace("\\", "/")
    for prefix in cfg_get(cfg, "layout.frozen", []) or []:
        pre = str(prefix).replace("\\", "/").rstrip("/")
        if rel == pre or rel.startswith(pre + "/"):
            return True
    return False


# --------------------------------------------------------------------------
# 工件落点：多个检查器都要找的同一件工件，候选与缺省只在这里写一处（01 §1 G2）
#
# 此前工作项目录的缺省在 evidence / freshness / drift 各写一份，状态工件的候选在
# layout 与 drift 各写一份且两份不一致（一份照模板树、一份照标准仓自己的文件名），
# 同一个项目会被两个检查器说成"有状态工件"和"没有状态工件"。文档根的缺省同理：
# layout 与候选改基取 `docs`，freshness 与 drift 却记未定，同一份配置两种读法。
# 入口同理：未配 layout.entry 时 layout 按候选找到了入口，entry-budget 却记「未配置入口文件」。
# --------------------------------------------------------------------------

# 01 §3.1 文档树的根。契约 §5：`layout.docs_root` 缺省取它并在证据里注明。
DEFAULT_DOCS_ROOT = "docs"

# 01 §3.1 大项目树的 `docs/state/work/`（工作项，一件一文件）。契约 §5：缺省取它并在证据里注明。
DEFAULT_WORK_ROOT = "docs/state/work"

# ★ 状态工件没在 layout.artifacts.status 声明落点时的候选。只取两处依据：
# templates/文件树与落地路径.md §2 的 L0 摆法 `WORK.md`，与 01 §3.1 的 `docs/state/STATUS.md`。
# 模板文件名（templates/PROJECT_STATUS.md）不是落点——PRD.md 落成 ACCEPTANCE.md 也是同一回事。
STATUS_CANDIDATES = ("WORK.md", "docs/state/STATUS.md")

# 会话交接没在 layout.artifacts.handoff 声明落点时的候选：模板 L1 树的 `work/handoff.md` 与
# 01 §3.1 的 `docs/state/handoff/`。layout（存在性）与 entry-budget（篇幅）共用。
HANDOFF_CANDIDATES = ("work/handoff.md", "docs/state/handoff")

# ★ 入口没在 layout.entry 声明时的候选，按此顺序取第一个存在的。`AGENTS.md` 是模板 L0 树的入口，
# `CLAUDE.md` 是 Claude Code 默认读的文件名，`CONTEXT.md` 不在现行树里、保留它是兼容按旧模板
# 落地的项目（删了它们的入口会无故变未定）。
ENTRY_CANDIDATES = ("CONTEXT.md", "AGENTS.md", "CLAUDE.md")


def docs_root_of(cfg):
    """文档根：`layout.docs_root`，未配则取 DEFAULT_DOCS_ROOT。

    返回 (相对路径, 证据注记)。配了原样返回、注记为空（它会进 finding 标题，契约 §4）；
    取了默认，注记写明——契约 §5 要求取了默认就得说。
    """
    raw = cfg_get(cfg, "layout.docs_root")
    if raw:
        return str(raw), ""
    return DEFAULT_DOCS_ROOT, "docs_root 用的是默认 %s（未配 layout.docs_root）" % DEFAULT_DOCS_ROOT


def entry_files(cfg):
    """入口文件：项目声明优先，未声明则取 ENTRY_CANDIDATES 里第一个存在的。

    返回 (相对路径列表, 注记)。注记为空＝取自项目声明（`layout.entry`，未配时认
    `layout.artifacts.entry`），原样返回、不判存在；注记非空＝取自候选，列表只含命中的那一个，
    候选全不在时为空。候选是工具约定：据此只许出 PASS 或未定，不许出 FAIL（契约 §1.1）。
    """
    declared = cfg_get(cfg, "layout.entry") or cfg_get(cfg, "layout.artifacts.entry")
    if declared:
        return [str(x) for x in ([declared] if isinstance(declared, str) else declared)], ""
    root = cfg.get("_root") or "."
    # 出仓的候选不探测、照算命中（由读它的检查器记 outside-root），结论不随仓外文件在不在而变
    hits = [c for c in ENTRY_CANDIDATES
            if not inside(root, os.path.join(root, c)) or os.path.isfile(os.path.join(root, c))]
    note = "未配 layout.entry，按候选 %s 的顺序取第一个存在的" % "、".join(ENTRY_CANDIDATES)
    if not hits:
        return [], note + "：都不存在"
    return hits[:1], note + "：%s%s" % (
        hits[0], "（同时存在 %s，未取）" % "、".join(hits[1:]) if hits[1:] else "")


def note_default(findings, note):
    """给一组依赖某项缺省的 finding 在 `evidence` 末尾统一补上注记（契约 §5：取了默认就得说）。

    只改证据不改标题，finding id 不变。注记为空或已含时不动。返回原列表。
    """
    for f in findings if note else ():
        ev = f.get("evidence") or ""
        if note not in ev:
            f["evidence"] = ev + ("；" if ev else "") + note
    return findings


def rebase_docs(rel, docs_root):
    """以 `docs/` 开头的候选/缺省路径，按项目的 layout.docs_root 改基（缺省 docs 即不改）。"""
    rel = str(rel).replace("\\", "/").strip().rstrip("/")
    docs_root = str(docs_root or DEFAULT_DOCS_ROOT).replace("\\", "/").strip().rstrip("/")
    if rel.startswith("docs/") and docs_root != "docs":
        return docs_root + rel[4:]
    return rel


def work_root(cfg):
    """工作项目录：`layout.work_root`，未配则取 DEFAULT_WORK_ROOT（随 docs_root 改基）。

    返回 (相对路径, 证据注记)。注记写明取的是配置还是默认——契约 §5 要求取了默认就得说。
    """
    raw = cfg_get(cfg, "layout.work_root")
    if raw:       # 原样返回不归一：它会进 finding 标题，标题变了兜底 id 就变（契约 §4）
        return str(raw), "work_root 取自 layout.work_root：%s" % raw
    rel = rebase_docs(DEFAULT_WORK_ROOT, docs_root_of(cfg)[0])
    return rel, "work_root 用的是默认 %s（未配 layout.work_root）" % rel


def unreadable(check, rel, exc):
    """读不了的文件（超限、不是常规文件、出仓、IO 错）：是对象的事，不是检查器故障，不落兜底 id。
    每个检查器内同一文件只报一次（同一 id，调用方去重）。"""
    return finding(check, UNDETERMINED, "%s 读不了（%s），依赖它的判据未判" % (rel, type(exc).__name__),
                   where=rel, kind="unreadable", key=rel,
                   reason="读不了、不是常规文件、超过读取上限或真实位置在项目之外；没读的文件不是没有问题",
                   why="01 §2 N1：依赖不可用记未定，不记通过")


def once(findings):
    """同一 id 只留第一条（契约 §1 同一事实只报一次）：一份文件被几条判据读、各自读不了时用。"""
    seen = set()
    return [f for f in findings if not (f["id"] in seen or seen.add(f["id"]))]


def outside_root(check, rel):
    """字面在项目内、真实位置出仓的路径：记未定，不判缺失、不探测目标在不在（契约 §5）。"""
    return finding(check, UNDETERMINED, "%s 的真实位置在被扫项目之外，未读" % rel, where=rel,
                   kind="outside-root", key=rel,
                   reason="它是指向项目之外的符号链接；本工具不读、不探测项目之外的路径",
                   why="契约 §5：只读被扫项目之内的文件")


def work_root_absent(check, cfg):
    """工作项目录不在时返回一条 SKIP，在则返回 None。给以工作项为对象的检查器用。

    「目录在不在」是 01 §3.1 的存在性事实，由 layout 报一次（契约 §1「同一事实只报一次」）；
    evidence / freshness 从前各报一条未定，采用方得为同一件事登记两行。
    """
    rel, note = work_root(cfg)
    root = cfg.get("_root") or "."
    path = os.path.join(root, rel.replace("\\", "/").strip())
    if inside(root, path) and os.path.isdir(path):   # 出仓的符号链接也回 SKIP，由 layout 记未定
        return None
    return finding(
        check, SKIP, "本检查只扫工作项目录，它不在：%s" % rel, where=rel, kind="work-root-absent",
        reason="目录在不在由 layout 报：01 §3.1 的存在性判定归它（声明了 layout.work_root 时任何档"
               "由 layout 判 FAIL，出仓记未定；没声明时 L1 起由 work_current 认这个缺省目录，L0 不要求它）。"
               "本检查不再另记一条未定",
        evidence="%s；负责报告的检查器：layout" % note,
    )


# --------------------------------------------------------------------------
# 工作项扫描：evidence 与 freshness 都要「列工作项目录下的 markdown → 读头部状态字段 → 聚合跳过项」，
# 此前两边各持一份逐字相同的小工具（drift 另有路径两件），同一写法三处副本（01 §1 G2）。
# --------------------------------------------------------------------------

HEAD_CHARS = 4000   # 元信息只在文件头找；正文里再出现同名字段不算
LIST_CAP = 12       # 聚合类 Finding 的证据里最多列几条路径


def norm_rel(p):
    return str(p).replace("\\", "/").strip()


def under(rel, sub):
    """rel 是否落在 sub 目录下。sub 为空或 '.' 视为整仓。"""
    sub = norm_rel(sub).rstrip("/")
    if sub in ("", "."):
        return True
    return rel == sub or rel.startswith(sub + "/")


def markdown_under(root, sub):
    """sub 目录下 git 跟踪的 markdown。返回 (相对路径列表, 问题)。"""
    files, problem = tracked_files(root)
    if problem:
        return None, problem
    return sorted(r for r in map(norm_rel, files) if r.lower().endswith(".md") and under(r, sub)), None


# 工作项文件的命名：01 §3.2 职责卡与 §3.3 阅读路径写作 `state/work/WI-*`（01 §3.1 树里是
# 「工作项，一件一文件」）；与 drift 认 ID 的 `WI-<三位以上数字>` 同一形式。
WORK_ITEM_NAME = re.compile(r"^WI-\d{3,}")


def is_work_item_name(rel):
    return WORK_ITEM_NAME.match(os.path.basename(str(rel))) is not None


def work_items(root, wroot):
    """工作项目录**直接一层**里 git 跟踪的 markdown。返回 (相对路径列表, 问题)。

    子目录（L1 的 work/artifacts/ 之类）放的是留证与产物，不是工作项——与 drift 的
    D-118 裁定同一条规则，evidence 与 freshness 共用这一处。
    """
    files, problem = markdown_under(root, wroot)
    if problem:
        return None, problem
    base = norm_rel(wroot).rstrip("/")
    return [r for r in files if os.path.dirname(r) == base or (base in ("", ".") and "/" not in r)], None


def clean(value):
    return str(value).replace("*", "").replace("`", "").strip()


def find_field(text, names):
    """在文本里找 `名字: 值` 或 `名字：值`。返回 (值, 命中的名字)，找不到返回 (None, None)。

    值以换行、表格竖线或全角空格为界——示例项目把三个字段写在同一行，用全角空格分隔。
    字段名两侧可带加粗、斜体或反引号（`**状态**：done`、`` `status`: done ``）。
    冒号两侧只认同一行的空白：`状态：` 后面是空行时不许把下一行吞成值——值为空等于没写这个字段。
    名字前不认 `-`：`build-status: passing` 不是 `status`（列表项 `- status:` 靠空白分隔照认）。
    只取第一次出现：它的值为空就是缺字段，不往后文找同名字段（R1-05）；冒号后的全角空格照跳过。
    线性：名字只在行首或空白、`|`、`>` 之后起算，两侧装饰限 4 个——满行 `*` 曾是平方级（R1-01、R2-11）。
    """
    for name in names:
        pat = (r"(?:^|(?<=[\s　|>]))[*_`]{0,4}" + re.escape(str(name))
               + r"[*_`]{0,4}[ \t　]*[:：][ \t　]*([^\n　|]*)")
        m = re.search(pat, text, re.M | re.I)
        if m:
            val = m.group(1).strip()
            return (val, str(name)) if val else (None, None)
    return None, None


def item_status(text):
    """工作项头部的状态值（去装饰、去括注、小写）；没有状态字段返回 None。"""
    raw, _hit = find_field(text[:HEAD_CHARS], STATUS_FIELDS)
    return None if raw is None else re.split(r"[（(]", clean(raw))[0].strip().lower()


def state_list(cfg, path, default):
    """状态词表配置（列表或单个字符串），未配取 default。归一为去空白小写的列表。"""
    states = cfg_get(cfg, path) or list(default)
    if isinstance(states, str):
        states = [states]
    return [str(s).strip().lower() for s in states if str(s).strip()]


def agg(check, status, title, paths, reason, why="", *, kind):
    """把一批同类路径聚成一条 Finding，证据最多列 LIST_CAP 条。

    `kind` 必填：标题带份数，不给 kind 时兜底 id 随份数变，登记行就成孤儿（契约 §4、§9；D-123）。
    """
    more = "" if len(paths) <= LIST_CAP else "；另有 %d 份未列出" % (len(paths) - LIST_CAP)
    return finding(check, status, "%s（%d 份）" % (title, len(paths)), kind=kind,
                   reason=reason, why=why, evidence="；".join(paths[:LIST_CAP]) + more)


# 自检样本：写文件、让 git 跟踪（evidence / freshness / drift 的自检共用）

def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def git_track(tmp):
    """自检样本要被 git 跟踪才进得了扫描范围。返回 None 或错误串。"""
    for cmd in (["git", "-c", "init.defaultBranch=main", "init", "-q", tmp],
                ["git", "-C", tmp, "-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "add", "-A", "-f"]):
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=60)
        except (OSError, subprocess.SubprocessError) as exc:
            return "%s 跑不了：%s" % (cmd[0], exc)
        if out.returncode != 0:
            return "%s 退出码 %d：%s" % (" ".join(cmd[:3]), out.returncode,
                                        (out.stderr or "").strip()[:200])
    return None
