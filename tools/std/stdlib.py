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


def undetermined_from_exception(check, exc, what):
    """检查器内部异常一律转 UNDETERMINED，绝不吞掉记 PASS。"""
    return finding(
        check, UNDETERMINED,
        "%s 时检查器自身出错" % what,
        reason="%s: %s" % (type(exc).__name__, exc),
        evidence="检查器故障时其结论作废；按 01 §5.6 判检查器故障，不按通过记。",
    )


# --------------------------------------------------------------------------
# 日期
# --------------------------------------------------------------------------

def parse_date(raw):
    """支持 YYYY-MM-DD 与 ISO8601。返回 (date, None) 或 (None, 原因)。解析不了不猜。

    从 `check_freshness._parse_date` 提上来：新鲜度与例外登记的到期都要解析日期，
    留两份必然漂（01 §1 G2）。`*` 与反引号是 markdown 的加粗/行内代码标记，先剥掉。
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
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
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
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        body = s[1:-1]
        if "\\" in body:
            raise ConfigError("第 %d 行的引号字符串含转义，本解析器不处理" % lineno)
        return body
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
    out, in_q, q = [], False, ""
    for i, ch in enumerate(line):
        if in_q:
            out.append(ch)
            if ch == q:
                in_q = False
            continue
        if ch in "\"'":
            before = "".join(out).rstrip()
            if not before or before.endswith((":", "-")):
                in_q, q = True, ch
            out.append(ch)
            continue
        if ch == "#" and (i == 0 or line[i - 1] in " \t"):
            break
        out.append(ch)
    return "".join(out).rstrip()


# 映射行：键（裸词或整体加引号）后跟冒号，冒号后是空白或行尾——YAML 的写法；`https://x` 不是映射
_MAP_LINE = re.compile(r"""^(?:"([^"]*)"|'([^']*)'|([^\s"'#:][^:]*?))\s*:(?:\s+(.*)|)$""")


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
                        if not v2.strip():
                            sub, idx = block(idx + 1, child_indent + 2)
                            item[k2] = sub
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
        line = next((i for i, ln in enumerate(text.splitlines(), 1)
                     if re.match(r"\s*%s\s*:" % key, ln)), 0)
        return "第 %d 行 budgets.%s 须是 ≥%d 的整数；写错不取默认值" % (line, key, low)
    return None


def _read_config(root, p, shown):
    """读并解析一份配置。返回 (cfg, problem)；报错只给路径与行号，不回显文件内容。"""
    try:
        with io.open(p, encoding="utf-8-sig") as fh:   # 带 BOM 的首键不许读成 \ufeffcompatibility
            text = fh.read()
        cfg = parse_yaml_subset(text)
    except ConfigError as exc:
        return {}, "%s 无法无歧义解析：%s" % (shown, exc)
    except UnicodeDecodeError as exc:
        return {}, "%s 不是 UTF-8 编码（第 %d 字节起解不开）；本工具只读 UTF-8" % (shown, exc.start)
    except OSError as exc:
        return {}, "%s 读不了：%s" % (shown, type(exc).__name__)
    if not isinstance(cfg, dict):
        return {}, "%s 的顶层不是映射" % shown
    bad_budget = _bad_dup_budgets(cfg, text)
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

# 表头按「包含」匹配，先命中者为准。`id` 不区分大小写。
_EX_HEADERS = ((u"id", "ex_id"), (u"编号", "ex_id"), (u"规则", "rule"),
               (u"理由", "reason"), (u"范围", "scope"), (u"批准", "approver"),
               (u"到期", "expires"), (u"状态", "status"))

# 关闭态先判：关闭行不登记、不报过期、不参与有效性校验。**某一段以关闭词开头**才算关闭——
# 含词即关闭会把「没关闭」「not yet closed」「open (to be closed)」这类尚在生效的例外当成历史行放过；
# 按否定前缀排除又列不全（D-123）。
_EX_CLOSED = (u"关闭", u"已关闭", u"closed", u"done", u"已处理")


def _ex_closed(status):
    """按逗号、分号、顿号、斜杠切段，任一段（去首尾加粗与反引号）以关闭词开头即关闭：
    「**已过期，已处理**（…）」是关闭行，「not yet closed」「open (to be closed)」不是。"""
    for seg in re.split(u"[，,;；、/|]+", status.lower()):
        if seg.strip().strip(u"*`").strip().startswith(_EX_CLOSED):
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
    for token, field in _EX_HEADERS:
        if token in header_cell or token in header_cell.lower():
            return field
    return None


def load_exceptions(config_dir, root=None):
    """读例外登记册：配置文件**同目录**的 `exceptions.md`（契约 §9）。

    不带 `--config` 时就是 `<项目根>/governance/exceptions.md`。
    返回 `(rows, problems, source_path, own)`：

    - `rows`：本工具认领且五项齐全的登记行（rule 含 `/`，即 Finding id 的形态）。
      与项目自己的门号例外（`G6` 之类）共用一张表，**不含 `/` 的行本工具不登记、不校验五项**
      ——那是项目的门，不是本工具的发现，拿它去匹配发现只会成批报孤儿。
    - `problems`：本工具认领但不合格的行（行号 + 缺什么）。
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
        with io.open(path, encoding="utf-8-sig") as fh:
            text = fh.read()
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
            day, err = parse_date(expires_raw)
            own.append({"ex_id": ex_id, "rule": rule, "expires": expires_raw, "expires_date": day,
                        "error": err, "lineno": lineno})
            continue
        missing = [n for n, v in ((u"规则", rule), (u"理由", reason),
                                  (u"范围", scope), (u"批准人", approver)) if not v]
        day, err = parse_date(expires_raw)
        if day is None:
            missing.append(u"到期（%s）" % err)
        if missing:
            problems.append(u"第 %d 行%s缺：%s"
                            % (lineno, (u"（%s）" % ex_id) if ex_id else u"",
                               u"、".join(missing)))
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


def tracked_files(root, patterns=None, tool_root=None):
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


def read_text(path, root=None):
    """读文本。给了 root 就先判真实位置在不在 root 之内（`guard`），不在抛 OutsideRoot。"""
    with io.open(guard(root, path) if root is not None else path, encoding="utf-8-sig", errors="replace") as fh:
        return fh.read()


def count_lines(path, root=None):
    with io.open(guard(root, path) if root is not None else path, encoding="utf-8", errors="replace") as fh:
        return sum(1 for _ in fh)


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
    hits = [c for c in ENTRY_CANDIDATES if os.path.isfile(os.path.join(root, c))]
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


def work_root_absent(check, cfg):
    """工作项目录不在时返回一条 SKIP，在则返回 None。给以工作项为对象的检查器用。

    「目录在不在」是 01 §3.1 的存在性事实，由 layout 报一次（契约 §1「同一事实只报一次」）；
    evidence / freshness 从前各报一条未定，采用方得为同一件事登记两行。
    """
    rel, note = work_root(cfg)
    if os.path.isdir(os.path.join(cfg.get("_root") or ".", rel.replace("\\", "/").strip())):
        return None
    return finding(
        check, SKIP, "本检查只扫工作项目录，它不在：%s" % rel, where=rel, kind="work-root-absent",
        reason="目录在不在由 layout 报：01 §3.1 的存在性判定归它（L1 起的「实时状态源」"
               "work_current 一项，未声明 layout.artifacts.work_current 时认的就是这个目录；"
               "L0 档的工作项按模板合在状态工件里，不要求这个目录）。本检查不再另记一条未定",
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
    """
    for name in names:
        pat = r"(?:^|[\s　|*>-])[*_`]*" + re.escape(str(name)) + r"[*_`]*\s*[:：]\s*([^\n　|]*)"
        m = re.search(pat, text, re.M | re.I)
        if m:
            return m.group(1).strip(), str(name)
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
