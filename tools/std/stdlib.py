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
    return u"%s/%s" % (check, hashlib.sha1(title.encode("utf-8")).hexdigest()[:8])


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
    """去行尾注释。只在 # 前有空白或位于行首时才算注释，避免吃掉值里的 #。"""
    out, in_q, q = [], False, ""
    for i, ch in enumerate(line):
        if in_q:
            out.append(ch)
            if ch == q:
                in_q = False
            continue
        if ch in "\"'":
            in_q, q = True, ch
            out.append(ch)
            continue
        if ch == "#" and (i == 0 or line[i - 1] in " \t"):
            break
        out.append(ch)
    return "".join(out).rstrip()


def parse_yaml_subset(text):
    """解析 CONTRACT.md §5 所述结构。不支持的语法一律抛 ConfigError。"""
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
                if ":" in rest and not rest.endswith(":"):
                    # 列表项是行内起始的映射：- name: x
                    k, v = rest.split(":", 1)
                    item = {k.strip(): _scalar(v, n)}
                    idx += 1
                    child_indent = indent + 2
                    while idx < len(lines) and lines[idx][1] >= child_indent and not lines[idx][2].startswith("- "):
                        n2, ind2, b2 = lines[idx]
                        if ind2 != child_indent:
                            raise ConfigError("第 %d 行缩进不一致" % n2)
                        if ":" not in b2:
                            raise ConfigError("第 %d 行不是 key: value" % n2)
                        k2, v2 = b2.split(":", 1)
                        if not v2.strip():
                            sub, idx = block(idx + 1, child_indent + 2)
                            item[k2.strip()] = sub
                            continue
                        item[k2.strip()] = _scalar(v2, n2)
                        idx += 1
                    items.append(item)
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
            if ":" not in body:
                raise ConfigError("第 %d 行不是 key: value：%r" % (n, body))
            k, v = body.split(":", 1)
            k = k.strip()
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
    value, end = block(0, lines[0][1])
    if end != len(lines):
        raise ConfigError("第 %d 行缩进层级无法归属" % lines[end][0])
    return value


CONFIG_CANDIDATES = ("governance/project.yaml", "governance/project.yml")


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
        try:
            with io.open(p, encoding="utf-8") as fh:
                cfg = parse_yaml_subset(fh.read())
        except ConfigError as exc:
            return {}, "指定的外部配置 %s 无法无歧义解析：%s" % (p, exc)
        except OSError as exc:
            return {}, "指定的外部配置 %s 读不了：%s" % (p, exc)
        if not isinstance(cfg, dict):
            return {}, "指定的外部配置 %s 的顶层不是映射" % p
        cfg["_path"] = p
        cfg["_root"] = root
        return cfg, None

    for rel in CONFIG_CANDIDATES:
        p = os.path.join(root, rel)
        if os.path.isfile(p):
            try:
                with io.open(p, encoding="utf-8") as fh:
                    cfg = parse_yaml_subset(fh.read())
            except ConfigError as exc:
                return {}, "%s 无法无歧义解析：%s" % (rel, exc)
            except OSError as exc:
                return {}, "%s 读不了：%s" % (rel, exc)
            if not isinstance(cfg, dict):
                return {}, "%s 的顶层不是映射" % rel
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

# 关闭态先判：关闭行不登记、不报过期、不参与有效性校验。
_EX_CLOSED = (u"关闭", u"closed", u"done", u"已处理")

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


def load_exceptions(config_dir):
    """读例外登记册：配置文件**同目录**的 `exceptions.md`（契约 §9）。

    不带 `--config` 时就是 `<项目根>/governance/exceptions.md`。
    返回 `(rows, problems, source_path)`：

    - `rows`：本工具认领且五项齐全的登记行（rule 含 `/`，即 Finding id 的形态）。
      与项目自己的门号例外（`G6` 之类）共用一张表，**不含 `/` 的行本工具不理**，
      既不登记也不校验——那是项目的门，不是本工具的发现。
    - `problems`：本工具认领但不合格的行（行号 + 缺什么）。
    - `source_path`：文件路径；文件不存在时为 None。
    """
    path = os.path.join(config_dir, EXCEPTIONS_FILE)
    if not os.path.isfile(path):
        return [], [], None
    try:
        with io.open(path, encoding="utf-8") as fh:
            text = fh.read()
    except OSError as exc:
        return [], [u"%s 读不了：%s" % (EXCEPTIONS_FILE, exc)], path
    table = _first_md_table(text)
    if table is None:
        return [], [u"%s 里没有 markdown 表；本工具只读第一张表" % EXCEPTIONS_FILE], path

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

    rows = []
    for lineno, cells in raw_rows:
        if not any(c for c in cells):
            continue

        def get(field, _cells=cells):
            i = cols.get(field)
            return _cells[i].strip() if i is not None and i < len(_cells) else u""

        status = get("status")
        low = status.lower()
        if any(tok in status or tok in low for tok in _EX_CLOSED):
            continue                                  # 先判关闭
        rule = get("rule").strip().strip(u"`").strip()
        if u"/" not in rule:
            continue                                  # 不是本工具的发现，不理
        ex_id, reason, scope = get("ex_id"), get("reason"), get("scope")
        approver, expires_raw = get("approver"), get("expires")
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
    return rows, problems, path


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
        files = [p for p in files if not p.lstrip('"').startswith(rel + "/")]
    return files, None


def read_text(path):
    with io.open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def count_lines(path):
    with io.open(path, encoding="utf-8", errors="replace") as fh:
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
