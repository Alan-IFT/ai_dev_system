# -*- coding: utf-8 -*-
"""文档漂移的机械信号：写下的日期、ADR 就地修订、索引对账、STATUS 声明的工作项。

四条判据都只回答"文档说的和仓库里的对不对得上"，不回答"内容对不对"：

1. `future-date`   记录里写成既成事实的日期，晚于写下它的那次提交（基准取 `git blame` 行级提交时间）。
2. `adr-revision`  ADR 正文里出现就地修订的标记（02 §8「ADR 不就地修订」）；围栏代码块不看，
   英文标记只认标题/标签形态，「修订后」开头的指代句不算。
3. `adr-index-*`   ADR 索引与目录里实物的双向对账（02 §8「decisions/README.md 是索引」）。
4. `work-item-missing` STATUS 声明的工作项没有对应文件（01 §4.1 每个状态都要求工作项工件）；
   状态源可以是一份文件，也可以是一个目录（一件一文件，ID 取其直接一层的 *.md）。

三态取向（01 §2 N1 与契约 §1.1）：前两条的召回靠两份**工具常量词表**，是猜测，**永不 FAIL**；
第 4 条的 `WI-\\d{3,}` 同属工具约定，也永不 FAIL。只有第 3 条的反向对账（目录里有实物、
索引里没有）是确定事实，且**只在项目用 `layout.artifacts.decisions` 声明了 ADR 目录时**才 FAIL；
靠目录名猜到的一律未定。契约见 ../CONTRACT.md。只用标准库。
"""
from __future__ import annotations

import calendar
import datetime
import io
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from stdlib import (  # noqa: E402
    DEFAULT_WORK_ROOT, FAIL, PASS, SKIP, STATUS_CANDIDATES, UNDETERMINED,
    cfg_get, finding, in_frozen, is_tailored_out, read_text, rebase_docs, tracked_files,
    undetermined_from_exception, work_root, work_root_absent,
)
# 表格解析复用 stdlib 的那一份（例外登记册用的也是它）：同一事实一处权威，
# 再抄一份 markdown 表解析器必然与它漂（01 §1 G2）。
from stdlib import _first_md_table  # noqa: E402

NAME = "drift"
STANDARD_REFS = ["01 §2 N1", "01 §4.1", "02 §8"]

# --------------------------------------------------------------------------
# 工具常量：两份词表都是**猜测**（契约 §1.1「标记词」），换一种写法就漏。
# 它们不做成配置键——判据自身的召回位置不是项目参数（契约 §1.1 末段）。
# --------------------------------------------------------------------------

# 日期后面跟着它，这个日期读起来就像"已经发生了"。
_PAST_ACTS = (u"裁定", u"拍板", u"裁准", u"批准", u"验收通过", u"已完成", u"完成于",
              u"达成", u"已生效", u"已落地", u"已发布", u"发布于", u"已确认",
              u"已复核", u"已复查", u"已取代", u"决议", u"签字")
_ACT_WINDOW = 10            # 窗口从日期末尾起算的定长，不分句、不切表格

# 日期**左边**跟着它，这个日期是计划位（复查日、到期日），不是既成事实。
# 由来：`- 复查：2026-12-08（半年）——已复查，无回退。` 这一行右窗口命中 `已复查`，
# 是实测出来的真误报形态（示例 ADR-0007:41 就是这个形状）。
_PLAN_WORDS = (u"复查", u"到期", u"下次", u"计划", u"截止", u"保留至", u"有效期")
_PLAN_WINDOW = 6

# ADR 正文里的就地修订标记。**必须从剥掉行首装饰后的第 0 个字符开始**——
# 放宽到"前 8 个字符内"时，本仓 docs/ 的候选从 10 行涨到 67 行，全是正文句子
# （`- 只追加地保存原始记录…`、`- 与现有理论：修订 D-027…`），那是实测出来的误报形态。
_REVISION_MARKERS = (u"修订", u"变更记录", u"补充", u"更新于", u"追加", u"修改记录",
                     u"版本历史", u"revision", u"changelog")
# 以标记词开头却是指代句（「修订后的结论见 §13.1」），不是修订块——采用项目实测误报。
_REVISION_NOT = (u"修订后",)
# 英文标记常作普通名词（`revision id "0053_x"`），只在标题或标签形态才算：
# `#` 标题行，或去装饰后该词后面紧跟 `:`／`：`／表格竖线／行尾。
_REVISION_LABEL_ONLY = (u"revision", u"changelog")
_LEAD_TRIM = u" \t　>#-*|"      # 行首装饰：引用、标题、列表、加粗、表格竖线

_INDEX_NAMES = ("README.md", "INDEX.md")
# 状态工件候选与工作项目录缺省在 stdlib（与 layout 共用一处），这里不另写。
_LIST_CAP = 12

_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
_WI_RE = re.compile(r"\bWI-\d{3,}\b")
_ADR_RE = re.compile(r"ADR-\d+")
_ADR_FILE_RE = re.compile(r"^(ADR-\d+)")
_BLAME_HEAD = re.compile(r"^([0-9a-f]{40})\s+(\d+)\s+(\d+)(?:\s+(\d+))?$")
# CommonMark 围栏：同一字符连续 3 个以上；闭合须同字符、不短于开围栏、其后只有空白。
_FENCE_RE = re.compile(u"^(`{3,}|~{3,})(.*)$")
_MD_LINK_RE = re.compile(r"\]\(([^)]+)\)")
_ZERO_SHA = "0" * 40


# --------------------------------------------------------------------------
# 小工具
# --------------------------------------------------------------------------

def _norm_rel(p):
    return str(p).replace("\\", "/").strip()


def _under(rel, sub):
    sub = _norm_rel(sub).rstrip("/")
    if sub in ("", "."):
        return True
    return rel == sub or rel.startswith(sub + "/")


def _md_under(files, sub):
    return sorted(f for f in files if f.lower().endswith(".md") and _under(f, sub))


def _cap(items):
    shown = list(items)[:_LIST_CAP]
    more = "" if len(items) <= _LIST_CAP else u"；另有 %d 条未列出" % (len(items) - _LIST_CAP)
    return u"、".join(shown) + more


def _git(root, args, timeout=120):
    """返回 (退出码, stdout 文本, 错误串)。跑不起来时退出码为 None。"""
    try:
        out = subprocess.run(["git", "-C", root] + list(args), capture_output=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError) as exc:
        return None, "", "跑不了 git %s：%s" % (args[0], exc)
    text = (out.stdout or b"").decode("utf-8", "replace")
    err = (out.stderr or b"").decode("utf-8", "replace").strip()[:200]
    return out.returncode, text, err


def _blame_date(epoch, tz):
    """把 blame 的 `committer-time` + `committer-tz` 折成**提交自己时区里的**日期。

    纯函数，不读机器时区：`datetime.fromtimestamp()` 按运行机本地时区折算，
    一次 `2026-09-22 00:30 +0800` 的提交在 UTC 机器上会折成 `2026-09-21`，
    同一份文档里的 `2026-09-22 裁定` 就成了假阳。自检对固定输入两种 tz 各断言一次。
    """
    off = 0
    m = re.match(r"^([+-])(\d{2})(\d{2})$", str(tz or "").strip())
    if m:
        off = (int(m.group(2)) * 3600 + int(m.group(3)) * 60) * (-1 if m.group(1) == "-" else 1)
    return (datetime.datetime(1970, 1, 1) + datetime.timedelta(seconds=int(epoch) + off)).date()


# --------------------------------------------------------------------------
# 判据 1：记录里的日期晚于写下它的提交
# --------------------------------------------------------------------------

def _candidates(text):
    """返回 [(行号, 日期字面量)]。左窗口排除计划位，右窗口要求动作词。"""
    out = []
    for n, line in enumerate(text.splitlines(), 1):
        for m in _DATE_RE.finditer(line):
            left = line[max(0, m.start() - _PLAN_WINDOW):m.start()]
            if any(w in left for w in _PLAN_WORDS):
                continue
            if any(w in line[m.end():m.end() + _ACT_WINDOW] for w in _PAST_ACTS):
                out.append((n, m.group(0)))
    return out


def _blame(root, rel):
    """`git blame -p` 的行级提交时间。返回 ({行号: (sha, 日期)}, 问题)。

    porcelain 的 `committer-time`/`committer-tz` **只在一个 commit 首次出现时输出**，
    后续行头只有 sha。不先建 commit→时间缓存再按行头摊开，94% 的行会读成 None。
    """
    code, text, err = _git(root, ["blame", "-p", "--", rel])
    if code is None:
        return None, err
    if code != 0:
        return None, u"git blame 退出码 %d：%s" % (code, err)
    times, lines, cur = {}, {}, None
    for raw in text.splitlines():
        m = _BLAME_HEAD.match(raw)
        if m:
            cur = m.group(1)
            lines[int(m.group(3))] = cur
            continue
        if cur is None:
            continue
        if raw.startswith("\t"):
            cur = None
        elif raw.startswith("committer-time "):
            e, z = times.get(cur, (None, None))
            times[cur] = (raw.split(" ", 1)[1].strip(), z)
        elif raw.startswith("committer-tz "):
            e, z = times.get(cur, (None, None))
            times[cur] = (e, raw.split(" ", 1)[1].strip())
    out = {}
    for lineno, sha in lines.items():
        if sha == _ZERO_SHA:
            out[lineno] = (sha, None)
            continue
        epoch, tz = times.get(sha, (None, None))
        if epoch is None:
            return None, u"blame 输出里 %s 这个提交没有 committer-time" % sha[:7]
        out[lineno] = (sha, _blame_date(epoch, tz))
    return out, None


def _check_dates(cfg, root, files, docs_root):
    hot, scanned, cand_total = [], 0, 0
    for rel in files:
        if in_frozen(cfg, rel):
            continue
        scanned += 1
        try:
            cand = _candidates(read_text(os.path.join(root, rel)))
        except OSError as exc:
            return [undetermined_from_exception(NAME, exc, u"读 %s" % rel)]
        if cand:
            hot.append((rel, cand))
            cand_total += len(cand)
    if scanned == 0:
        return []                       # 空集上说不出"全部通过"（01 §2 N1）

    def _clean_pass():
        return [finding(
            NAME, PASS,
            u"future-date：扫 %d 份文档、%d 个候选行，无晚于写下时间的日期"
            % (scanned, cand_total),
            where=str(docs_root), kind="future-date",
            why=u"01 §5.6：门跑过与没跑过要分得出；本条列出来是为了让静默失效看得见",
            evidence=u"扫描面 %s（git 跟踪、不在 layout.frozen 内的 *.md）；"
                     u"候选＝日期后 %d 字内带动作词且左侧 %d 字内不带计划词；"
                     u"基准＝该行 git blame 的提交日（按提交自己的 committer-tz 折算）"
                     % (docs_root, _ACT_WINDOW, _PLAN_WINDOW))]

    if not hot:
        return _clean_pass()

    code, text, err = _git(root, ["rev-parse", "--is-shallow-repository"], timeout=60)
    if code is None or code != 0:
        return [finding(
            NAME, UNDETERMINED, u"判不了日期：探测不出是不是浅克隆",
            kind="future-date",
            reason=err or u"git rev-parse --is-shallow-repository 退出码 %s" % code,
            why=u"01 §2 N1：依赖不可用记未定，不记通过",
            evidence=u"%s 下有 %d 份文档含候选日期" % (docs_root, len(hot)))]
    if text.strip().lower() == "true":
        return [finding(
            NAME, UNDETERMINED, u"浅克隆下判不了日期是否晚于写下它的提交",
            kind="future-date",
            reason=u"浅克隆下 blame 时间不可信：git blame 退出 0，但全部行都归到边界提交、"
                   u"时间等于当下，逐文件比会得出整仓无问题的假结论",
            why=u"01 §2 N1：判不了的记未定，不记通过",
            evidence=u"git rev-parse --is-shallow-repository = true；"
                     u"%s 下有 %d 份文档含候选日期未判" % (docs_root, len(hot)))]

    today = datetime.date.today()
    out = []
    for rel, cand in hot:
        blamed, problem = _blame(root, rel)
        if problem:
            out.append(finding(
                NAME, UNDETERMINED, u"取不到 %s 的行级提交时间" % rel, where=rel,
                kind="blame-unavailable", key=rel, reason=problem,
                why=u"01 §2 N1：依赖不可用记未定，不记通过",
                evidence=u"该文件有 %d 处候选日期未判" % len(cand)))
            continue
        groups = {}
        for lineno, day in cand:
            got, err2 = _parse_day(day)
            if got is None:
                continue
            sha, base = blamed.get(lineno, (None, None))
            if sha is None:
                continue
            if sha == _ZERO_SHA:
                base, note = today, u"该行未提交，基准取运行时刻 %s" % today.isoformat()
            else:
                note = u"比较基准：git blame 提交时间 %s（%s）" % (base.isoformat(), sha[:7])
            if got > base:
                groups.setdefault(day, []).append((lineno, note))
        for day in sorted(groups):
            hits = groups[day]
            out.append(finding(
                NAME, UNDETERMINED,
                u"%s 里的 %s 写成已经发生，却晚于写下它的那次提交" % (rel, day),
                where=u"%s:%d" % (rel, hits[0][0]),
                kind="future-date", key=u"%s|%s" % (rel, day),
                reason=u"日期后 %d 字内出现动作词（%s 之一），读起来是既成事实；"
                       u"是预告、笔误，还是真的提前写下，本工具判不了"
                       % (_ACT_WINDOW, u"/".join(_PAST_ACTS[:4]) + u"…"),
                why=u"01 §2 N1：判不了的记未定不记通过；词表是工具常量（契约 §1.1），永不 FAIL",
                evidence=_cap([u"第 %d 行：%s" % (n, note) for n, note in hits])))
    return out or _clean_pass()


def _parse_day(s):
    try:
        return datetime.date.fromisoformat(s), None
    except ValueError:
        return None, u"不是合法日期：%r" % s


# --------------------------------------------------------------------------
# ADR 目录定位（判据 2 与判据 3 共用）
# --------------------------------------------------------------------------

def _adr_dir(cfg, root, files, docs_root):
    """返回 (目录相对路径, 是否项目声明, 说不通时的 Finding)。"""
    declared = cfg_get(cfg, "layout.artifacts.decisions")
    if declared:
        rel = _norm_rel(declared).rstrip("/")
        path = os.path.join(root, rel)
        if os.path.isfile(path):
            rel = os.path.dirname(rel) or "."
            path = os.path.join(root, rel)
        if not os.path.isdir(path):
            return None, True, finding(
                NAME, UNDETERMINED, u"ADR 目录不存在：%s" % declared, where=str(declared),
                reason=u"layout.artifacts.decisions 指向 %s，它既不是目录也不是文件；"
                       u"是配置过期还是目录被移走，本工具判不了" % declared,
                why=u"02 §8：ADR 与它的索引以目录为对象，对象不在则判不了")
        return rel, True, None

    found = set()
    for f in files:
        if not _under(f, docs_root):
            continue
        parts = f.split("/")
        for i, seg in enumerate(parts[:-1]):
            if seg == "decisions":
                found.add("/".join(parts[:i + 1]))
    if len(found) == 1:
        return sorted(found)[0], False, None
    return None, False, finding(
        NAME, SKIP,
        u"未定位到 ADR 目录，判据 2（就地修订）与判据 3（索引对账）本次未执行",
        reason=(u"未声明 layout.artifacts.decisions，且 %s 下%s；本工具不猜 ADR 放在哪"
                % (docs_root,
                   u"没有名为 decisions 的目录" if not found
                   else u"有 %d 个名为 decisions 的目录（%s）" % (len(found), _cap(sorted(found))))),
        why=u"02 §8 以 decisions 目录为对象；契约 §1.1：目录名是约定，猜不到不记通过")


# --------------------------------------------------------------------------
# 判据 2：ADR 就地修订的标记
# --------------------------------------------------------------------------

def _revision_hits(text):
    out, fence = [], None
    for n, line in enumerate(text.splitlines(), 1):
        bare = line.lstrip(u" \t　>")
        fm = _FENCE_RE.match(bare)
        if fence:                           # 围栏代码块里的行是样例，不是正文
            if (fm and fm.group(1)[0] == fence[0] and len(fm.group(1)) >= len(fence)
                    and not fm.group(2).strip()):
                fence = None
            continue
        if fm and not (fm.group(1)[0] == u"`" and u"`" in fm.group(2)):   # ```x``` 是行内代码
            fence = fm.group(1)
            continue
        s = line.lstrip(_LEAD_TRIM)
        low = s.lower()
        if low.startswith(_REVISION_NOT):
            continue
        for mark in _REVISION_MARKERS:
            if not low.startswith(mark):
                continue
            rest = s[len(mark):].lstrip(u"* \t").rstrip()
            if (mark in _REVISION_LABEL_ONLY and not bare.startswith(u"#")
                    and rest and rest[0] not in u":：|"):
                continue
            out.append((n, s[:40], mark))
            break
    return out


def _check_revision(root, adr_dir, adr_files):
    out = []
    for rel in adr_files:
        try:
            hits = _revision_hits(read_text(os.path.join(root, rel)))
        except OSError as exc:
            out.append(undetermined_from_exception(NAME, exc, u"读 %s" % rel))
            continue
        if not hits:
            continue
        out.append(finding(
            NAME, UNDETERMINED, u"%s 里有就地修订的标记（%d 处）" % (rel, len(hits)),
            where=u"%s:%d" % (rel, hits[0][0]),
            kind="adr-revision", key=rel,
            reason=u"命中标记词只说明这份 ADR 的行首写了『%s』；它是改了决定，还是 02 §8 允许的"
                   u"事实性更正（错别字、失效链接、补证据指针），本工具判不了" % hits[0][2],
            why=u"02 §8「**ADR 不就地修订**：决定变了——哪怕只改一句——就开新 ADR」；"
                u"标记词是工具常量（契约 §1.1），永不 FAIL",
            evidence=_cap([u"第 %d 行：%s" % (n, s) for n, s, _m in hits])))
    if out or not adr_files:
        return out                      # 空集上说不出"全部通过"（01 §2 N1）
    return [finding(
        NAME, PASS,
        u"adr-revision：%s 下 %d 份 ADR，行首都没有就地修订标记" % (adr_dir, len(adr_files)),
        where=adr_dir, kind="adr-revision",
        why=u"01 §5.6：门跑过与没跑过要分得出；本条列出来是为了让静默失效看得见",
        evidence=u"对象＝%s 下除 %s 外、不在 layout.frozen 内的 *.md；标记词 %d 个，"
                 u"须从剥掉行首装饰后的第 0 个字符开始"
                 % (adr_dir, u"/".join(_INDEX_NAMES), len(_REVISION_MARKERS)))]


# --------------------------------------------------------------------------
# 判据 3：索引与实物对账
# --------------------------------------------------------------------------

def _index_target(cell):
    """「文件」列里可用的路径；不是路径（裸 ID、括注）返回 None。"""
    m = _MD_LINK_RE.search(cell)
    if m:
        return m.group(1).split("#")[0].strip()
    s = cell.strip().strip(u"`").strip()
    return s if s.lower().endswith(".md") else None


def _check_index(root, adr_dir, adr_files, index_rel, declared):
    """索引对账。不读 ADR 头、不比状态与日期——那两侧的写法（`**draft**`、
    `superseded → ADR-0012`）没有无歧义的归一化，比出来的不一致会是假 FAIL。"""
    dir_ids = {}
    for rel in adr_files:
        m = _ADR_FILE_RE.match(os.path.basename(rel))
        if m:
            dir_ids.setdefault(m.group(1), rel)

    if index_rel is None:
        if not dir_ids:
            return []
        return [finding(
            NAME, UNDETERMINED, u"%s 下有 %d 份 ADR，但没有索引" % (adr_dir, len(dir_ids)),
            where=adr_dir, kind="adr-index-absent", key=adr_dir,
            reason=u"目录里没有 %s；索引是另起了名字，还是确实没建，本工具判不了"
                   % u" 或 ".join(_INDEX_NAMES),
            why=u"02 §8「`decisions/README.md` 是索引：ID、标题、状态、日期、影响模块」",
            evidence=u"目录里的 ADR：%s" % _cap(sorted(dir_ids)))]

    try:
        table = _first_md_table(read_text(os.path.join(root, index_rel)))
    except OSError as exc:
        return [undetermined_from_exception(NAME, exc, u"读 %s" % index_rel)]
    id_col = file_col = None
    if table is not None:
        _hdr_lineno, header, _rows = table
        for i, cell in enumerate(header):
            low = cell.lower()
            if id_col is None and "id" in low:
                id_col = i
            if file_col is None and u"文件" in cell:
                file_col = i
    if table is None or id_col is None:
        return [finding(
            NAME, UNDETERMINED, u"%s 读不出 ADR 索引表" % index_rel, where=index_rel,
            kind="adr-index-unreadable", key=index_rel,
            reason=u"文件里%s；本工具只读第一张表，表头按包含匹配 `ID` 与 `文件`"
                   % (u"没有 markdown 表" if table is None else u"第一张表没有 ID 列"),
            why=u"02 §8「`decisions/README.md` 是索引：ID、标题、状态、日期、影响模块」",
            evidence=u"目录里的 ADR：%s" % (_cap(sorted(dir_ids)) or u"（无）"))]

    _hdr_lineno, _header, rows = table
    listed, missing = set(), []
    for _lineno, cells in rows:
        cell = cells[id_col] if id_col < len(cells) else u""
        m = _ADR_RE.search(cell)
        if not m:
            continue
        adr_id = m.group(0)
        listed.add(adr_id)
        target = _index_target(cells[file_col]) if file_col is not None and file_col < len(cells) else None
        if target and (os.path.isfile(os.path.join(root, adr_dir, target))
                       or os.path.isfile(os.path.join(root, target))):
            continue
        if adr_id in dir_ids:            # 「文件」列不是可用路径时回落到 <ID>*.md
            continue
        missing.append(adr_id)

    out = []
    if missing:
        out.append(finding(
            NAME, UNDETERMINED, u"%s 列了 %d 个没有实物的 ADR" % (index_rel, len(missing)),
            where=index_rel, kind="adr-index-missing", key=index_rel,
            reason=u"索引里有这些 ID，但「文件」列指的路径与 %s 下的 `<ID>*.md` 都没找到；"
                   u"是还没展开、放在别处，还是真的丢了，本工具判不了" % adr_dir,
            why=u"02 §8「`decisions/README.md` 是索引：ID、标题、状态、日期、影响模块」",
            evidence=u"缺实物：%s" % _cap(missing)))
    for adr_id in sorted(set(dir_ids) - listed):
        out.append(finding(
            NAME, FAIL if declared else UNDETERMINED,
            u"%s 在 %s 里，索引没有它" % (adr_id, adr_dir),
            where=dir_ids[adr_id], kind="adr-unindexed", key=adr_id,
            reason=u"" if declared else
            u"ADR 目录是按目录名猜到的（项目未声明 layout.artifacts.decisions），"
            u"猜中的前提下才谈得上漏登；契约 §1.1：猜测得出的结论只能记未定",
            why=u"02 §8「`decisions/README.md` 是索引：ID、标题、状态、日期、影响模块」；"
                u"索引漏了一份实物，等于这份决定在索引这条必经路径上不存在",
            evidence=u"实物 %s；索引列出的 ID：%s" % (dir_ids[adr_id], _cap(sorted(listed)) or u"（无）")))
    if out or not listed:
        return out                      # 空集上说不出"全部通过"（01 §2 N1）
    return [finding(
        NAME, PASS,
        u"adr-index：索引 %d 行、目录 %d 份，全部对上" % (len(listed), len(dir_ids)),
        where=index_rel, kind="adr-index",
        why=u"01 §5.6：门跑过与没跑过要分得出；本条列出来是为了让静默失效看得见",
        evidence=u"索引 %s 的第一张表；对象＝%s 下不在 layout.frozen 内的 `ADR-<数字>*.md`；"
                 u"双向对账：索引每个 ID 都定位到实物，每份实物的 ID 都在索引 ID 列"
                 % (index_rel, adr_dir))]


# --------------------------------------------------------------------------
# 判据 4：STATUS 声明的工作项没有文件
# --------------------------------------------------------------------------

def _check_work_items(cfg, root, files):
    declared = cfg_get(cfg, "layout.artifacts.status")
    if declared:
        status_rel = _norm_rel(declared).rstrip("/")
        status_path = os.path.join(root, status_rel)
        if not (os.path.isfile(status_path) or os.path.isdir(status_path)):
            return [finding(
                NAME, UNDETERMINED, u"状态文件不存在：%s" % status_rel, where=status_rel,
                kind="status-missing", key=status_rel,
                reason=u"layout.artifacts.status 声明了它，但文件与目录都不在；"
                       u"是配置过期还是文件被移走，本工具判不了",
                why=u"01 §4.1 的工作项以 STATUS 的声明为入口，入口不在则判不了")]
    else:
        status_rel = None
        cands = [rebase_docs(c, cfg_get(cfg, "layout.docs_root")) for c in STATUS_CANDIDATES]
        for cand in cands:
            if os.path.exists(os.path.join(root, cand)):
                status_rel = cand
                break
        if status_rel is None:
            return [finding(
                NAME, SKIP, u"没有状态文件，判据 4（STATUS 声明的工作项）本次未执行",
                reason=u"未声明 layout.artifacts.status，候选 %s 也都不存在；"
                       u"本工具不猜状态文件叫什么" % u" / ".join(cands),
                why=u"01 §4.1 以工作项为对象；契约 §1.1：候选路径是约定，猜不到不记通过")]

    # 状态源是目录（一件一文件即状态源）时，ID 取它直接一层的 *.md，不递归。
    if os.path.isdir(os.path.join(root, status_rel)):
        sources = [f for f in files if f.lower().endswith(".md") and os.path.dirname(f) == status_rel]
    else:
        sources = [status_rel]
    seen = {}
    for src in sources:
        try:
            text = read_text(os.path.join(root, src))
        except OSError as exc:
            return [undetermined_from_exception(NAME, exc, u"读 %s" % src)]
        for n, line in enumerate(text.splitlines(), 1):
            for m in _WI_RE.finditer(line):
                seen.setdefault(m.group(0), u"%s:%d" % (src, n))
    if not seen:                       # 一个 ID 都没有：无结论，不产条目
        return []

    wroot, note = work_root(cfg)
    wroot = _norm_rel(wroot)
    # 目录不在是 layout 报的那一件事（契约 §1）；逐 ID 再报一遍就是同一事实报 N 次。
    # L0 按模板把工作项写在 WORK.md 里、本就没有这个目录，更不该逐条报"没有文件"。
    absent = work_root_absent(NAME, cfg)
    if absent:
        return [absent]

    have = set()
    for rel in _md_under(files, wroot):
        base = os.path.basename(rel)
        for wid in seen:
            if base.startswith(wid):
                have.add(wid)

    out = []
    for wid in sorted(set(seen) - have):
        out.append(finding(
            NAME, UNDETERMINED, u"%s 在 %s 里声明了，%s 下没有它的文件" % (wid, status_rel, wroot),
            where=seen[wid],
            kind="work-item-missing", key=wid,
            reason=u"%s 下没有文件名以 %s 开头的工件；是还没建、建在别处，还是这个 ID 只是"
                   u"正文里提了一句，本工具判不了。ID 形态 WI-<三位以上数字> 是工具约定"
                   u"（契约 §1.1），永不 FAIL" % (wroot, wid),
            why=u"01 §4.1：每个状态都写明**必需工件**，`planned` 起就要有工作项文件；"
                u"工件缺失即不得进入该状态",
            evidence=note))
    if out:
        return out
    return [finding(
        NAME, PASS,
        u"work-item：状态文件列了 %d 个 ID，%s 下都有文件" % (len(seen), wroot),
        where=status_rel, kind="work-item",
        why=u"01 §5.6：门跑过与没跑过要分得出；本条列出来是为了让静默失效看得见",
        evidence=u"状态文件 %s；ID 形态 `WI-<三位以上数字>`；%s" % (status_rel, note))]


# --------------------------------------------------------------------------
# 契约接口
# --------------------------------------------------------------------------

def scope(cfg):
    docs_root = cfg_get(cfg, "layout.docs_root")
    decisions = cfg_get(cfg, "layout.artifacts.decisions")
    status = cfg_get(cfg, "layout.artifacts.status")
    wroot = work_root(cfg)[0]
    return {
        "covered": [
            u"layout.docs_root（当前 %r）下 git 跟踪、不在 frozen 内的 *.md：日期后 %d 字内带动作词"
            u"且左侧 %d 字内不带计划词的那些日期，是否晚于该行 `git blame` 的提交日"
            % (docs_root or u"（未配置）", _ACT_WINDOW, _PLAN_WINDOW),
            u"ADR 目录（layout.artifacts.decisions，当前 %r；未声明则在 docs_root 内找名为 "
            u"decisions 的目录）里除索引外、不在 frozen 内的 *.md：围栏代码块之外的行首是否以就地修订"
            u"标记词开头（围栏按 CommonMark 开闭；英文 revision/changelog 只认 `#` 标题或后跟冒号/表格竖线/行尾的标签形态；"
            u"「修订后」开头的指代句不算）"
            % (decisions or u"（未声明）"),
            u"同一目录的索引（%s 的第一张表）与目录里 `ADR-<数字>` 实物的双向对账：索引有 ID 无实物、"
            u"实物不在索引 ID 列" % u" 或 ".join(_INDEX_NAMES),
            u"状态文件（layout.artifacts.status，当前 %r；声明为目录时取其直接一层、git 跟踪的 *.md，"
            u"不递归）正文里的 `WI-<三位以上数字>`，在 %s 下有没有同名开头的文件"
            % (status or u"（未声明）", wroot),
        ],
        "not_covered": [
            u"**两份词表都是工具常量，换一种写法就漏**：日期动作词 %d 个、ADR 修订标记词 %d 个。"
            u"命中率没有召回数据，只有误报数据；按契约 §1.1 它们永不 FAIL"
            % (len(_PAST_ACTS), len(_REVISION_MARKERS)),
            u"**不判日期的语义**：到期日、计划日、复查日不在候选句式里（左侧 %d 字带 %s 之一即丢弃），"
            u"所以它们晚于提交日也不看——那本来就该晚" % (_PLAN_WINDOW, u"/".join(_PLAN_WORDS)),
            u"只看 docs_root 与 ADR 目录，别处不看。`.std/` 里的标准副本**通常**不在扫描面，"
            u"因为它一般不在 docs_root 之下——这是路径关系，不是工具对 `.std/` 做了特判；"
            u"采用项目把它放进 docs_root 就会被扫",
            u"decisions 目录里非 ADR 的 md（模板、会议纪要、说明页）照样按判据 2 判，工具分不出",
            u"浅克隆下 blame 时间不可信（全部行归边界提交、时间等于当下），判据 1 整条记一条未定，"
            u"不逐文件报",
            u"**merge 带进来的改动照样按 blame 时间判**：判据看的是行的提交时间，不受提交钩子"
            u"是否触发影响（pre-commit 对 merge 与 `--no-verify` 静默失效，这里不受那层影响）",
            u"判据 3 不读 ADR 头、不比索引与正文的状态/日期——`**draft**` 与 `superseded → ADR-0012` "
            u"这类写法没有无歧义的归一化，比出来的不一致会是假 FAIL",
            u"反向不报：work_root 下有文件而 STATUS 没提、目录里有 ADR 而索引没列（后者报，前者不报）",
            u"**归档区（layout.frozen：%s）整体不看**：四条判据的对象集合都先减掉它——归档区里的 ADR "
            u"既不判就地修订，也不参与索引对账（放进 frozen 的 ADR 会让索引那一侧看起来"
            u"『少了实物』，工具只当它不存在）。依据 01 §3.1：归档区不承担更新义务"
            % (u"、".join(str(x) for x in (cfg_get(cfg, "layout.frozen") or [])) or u"未配置"),
            u"每条判据干净时各出一条 PASS，**那条 PASS 只承诺「扫了多少、都对上了」**，"
            u"不承诺扫描面之外的事；判据没执行时出的是 SKIP 或未定，不会出 PASS",
        ],
    }


def run(cfg):
    tailored, reason = is_tailored_out(cfg, NAME)
    if tailored:
        return [finding(NAME, SKIP, u"项目已裁剪本检查", reason=reason or u"project.yaml 未写理由")]

    root = cfg.get("_root") or "."
    docs_root = cfg_get(cfg, "layout.docs_root")
    if not docs_root:
        return [finding(
            NAME, UNDETERMINED, u"未配置文档根目录",
            reason=u"governance/project.yaml 缺 layout.docs_root；本工具不猜文档放在哪（契约 §5）",
            why=u"01 §2 N1：判不了的记未定，不记通过")]

    files, problem = tracked_files(root, ["*.md"])
    if problem:
        return [finding(NAME, UNDETERMINED, u"列不出 git 跟踪的文档", reason=problem,
                        why=u"01 §2 N1：依赖不可用记未定，不记通过")]
    files = [_norm_rel(f) for f in files if f.lower().endswith(".md")]

    out = []
    try:
        out.extend(_check_dates(cfg, root, _md_under(files, docs_root), docs_root))
    except Exception as exc:  # noqa: BLE001  契约 §4：run 不抛异常
        out.append(undetermined_from_exception(NAME, exc, u"判日期是否晚于提交"))

    try:
        adr_dir, declared, problem_f = _adr_dir(cfg, root, files, docs_root)
        if problem_f is not None:
            out.append(problem_f)
        else:
            # 归档区不承担更新义务（01 §3.1）：既不判就地修订，也不参与索引对账。
            adr_all = [f for f in _md_under(files, adr_dir)
                       if os.path.dirname(f) == adr_dir and not in_frozen(cfg, f)]
            index_rel = None
            for name in _INDEX_NAMES:
                cand = adr_dir + "/" + name
                if cand in adr_all:
                    index_rel = cand
                    break
            adr_files = [f for f in adr_all if os.path.basename(f) not in _INDEX_NAMES]
            out.extend(_check_revision(root, adr_dir, adr_files))
            out.extend(_check_index(root, adr_dir, adr_files, index_rel, declared))
    except Exception as exc:  # noqa: BLE001
        out.append(undetermined_from_exception(NAME, exc, u"对账 ADR 索引"))

    try:
        out.extend(_check_work_items(cfg, root, files))
    except Exception as exc:  # noqa: BLE001
        out.append(undetermined_from_exception(NAME, exc, u"核对 STATUS 声明的工作项"))
    return out


# --------------------------------------------------------------------------
# 自检（契约 §3：必须有反例；本检查器四条判据里三条永不 FAIL，用**结果断言**钉死）
# --------------------------------------------------------------------------

_COMMIT_DATE = "2026-09-21T05:26:00+08:00"      # 基准日 2026-09-21，不随运行机日期漂


def _write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def _git_commit(tmp):
    """自检样本要**真提交**：判据 1 的基准来自 blame，没有提交就没有基准。返回 None 或错误串。"""
    env = dict(os.environ)
    env["GIT_COMMITTER_DATE"] = _COMMIT_DATE
    env["GIT_AUTHOR_DATE"] = _COMMIT_DATE
    # 夹具不受全局配置左右：不签名、不跑全局钩子（同 hooks/guard.py 的 selftest git()）
    cmds = (["git", "-c", "init.defaultBranch=main", "init", "-q", tmp],
            ["git", "-C", tmp, "add", "-A", "-f"],
            ["git", "-C", tmp, "-c", "user.email=a@b", "-c", "user.name=a",
             "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null",
             "commit", "-q", "-m", "s"])
    for cmd in cmds:
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                                 timeout=120, env=env)
        except (OSError, subprocess.SubprocessError) as exc:
            return "%s 跑不了：%s" % (cmd[0], exc)
        if out.returncode != 0:
            return "%s 退出码 %d：%s" % (" ".join(cmd[:4]), out.returncode,
                                        (out.stderr or "").strip()[:200])
    return None


def _ids(res, kind):
    return sorted(f["id"] for f in res if f["id"].startswith("%s/%s" % (NAME, kind)))


def _assert(results, ok, title, evidence, why=u"契约 §3 静默失效探测"):
    results.append(finding(NAME, PASS if ok else FAIL, title, evidence=evidence, why=why))


def selftest():
    results = []

    # ---- 1e：时区折算是纯函数，不读机器时区（同一 epoch 两种 tz 差一天）----
    epoch = calendar.timegm((2026, 9, 21, 16, 30, 0, 0, 0, 0))   # = 2026-09-22 00:30 +0800
    d8, d0 = _blame_date(epoch, "+0800"), _blame_date(epoch, "+0000")
    _assert(results,
            d8.isoformat() == "2026-09-22" and d0.isoformat() == "2026-09-21" and (d8 - d0).days == 1,
            u"1e 反例：同一 epoch 按 +0800 与 +0000 折出的日期必须差一天（不读运行机时区）",
            u"+0800 → %s；+0000 → %s" % (d8, d0),
            why=u"D-2：按机器本地时区折算时，UTC 机器上会把 2026-09-22 00:30 +0800 的提交"
                u"折成 2026-09-21，同一份文档里的『2026-09-22 裁定』就成了假阳")

    # ---- 1a/1b/1d：真提交后比 blame 日；1c：未提交行取运行时刻 ----
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        doc = os.path.join(tmp, "docs", "a.md")
        _write(doc,
               u"# 样本\n\n"
               u"- 协调方 2026-09-22 裁定 X。\n"                        # 1a 报
               u"- v1 保留至 2026-12-31。\n"                            # 1b 不报
               u"- 批准 2026-05-12 → 到期 2026-10-31，届时复核。\n"      # 1b 不报
               u"- 复查：2026-12-08（半年）——已复查，无回退。\n")        # 1d 不报
        err = _git_commit(tmp)
        cfg = {"_root": tmp, "layout": {"docs_root": "docs"}}
        res = run(cfg) if not err else []
        got = _ids(res, "future-date")
        _assert(results,
                (not err) and got == [u"drift/future-date/docs/a.md｜2026-09-22"]
                and [f["status"] for f in res if f["id"] in got] == [UNDETERMINED],
                u"1a 反例 + 1b/1d 正例：『2026-09-22 裁定』写于 09-21 须报出且状态是 UNDETERMINED；"
                u"保留至/到期/复查三行不得报",
                u"实得 %s%s" % (got, (u"；git 准备失败：%s" % err) if err else u""),
                why=u"契约 §3 静默失效探测；契约 §1.1：词表是猜测，永不 FAIL")

        if not err:
            future = (datetime.date.today() + datetime.timedelta(days=30)).isoformat()
            with io.open(doc, "a", encoding="utf-8", newline="\n") as fh:
                fh.write(u"- %s 拍板追加一条。\n" % future)
            res = run(cfg)
            hit = [f for f in res if f["id"] == u"drift/future-date/docs/a.md｜%s" % future]
            _assert(results,
                    len(hit) == 1 and u"未提交" in (hit[0].get("evidence") or u""),
                    u"1c 反例：提交后追加的未提交行，基准取运行时刻，证据要写明『未提交』",
                    u"实得 %s；证据 %r" % ([f["id"] for f in res],
                                          (hit[0].get("evidence") if hit else u"（无）")))

    # ---- 2a/2b/2c：ADR 就地修订标记从第 0 个字符起 ----
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        _write(os.path.join(tmp, "docs", "decisions", "README.md"),
               u"# 索引\n\n| ID | 标题 | 状态 | 文件 |\n|---|---|---|---|\n"
               u"| ADR-0001 | 甲 | active | [ADR-0001](ADR-0001-x.md) |\n"
               u"| ADR-0002 | 乙 | active | ADR-0002 |\n")
        _write(os.path.join(tmp, "docs", "decisions", "ADR-0001-x.md"),
               u"# ADR-0001\n\n> **修订二**：补充了一段说明。\n")          # 2a 报
        _write(os.path.join(tmp, "docs", "decisions", "ADR-0002-y.md"),
               u"# ADR-0002\n\n正文里补充索引后，检索更快。\n")             # 2b 不报
        _write(os.path.join(tmp, "docs", "notes", "变更记录.md"),
               u"# 变更记录\n\n修订三：这份不在 decisions 下。\n")          # 2c 不报
        err = _git_commit(tmp)
        cfg = {"_root": tmp, "layout": {"docs_root": "docs",
                                        "artifacts": {"decisions": "docs/decisions"}}}
        res = run(cfg) if not err else []
        got = _ids(res, "adr-revision")
        _assert(results,
                (not err) and got == [u"drift/adr-revision/docs/decisions/ADR-0001-x.md"],
                u"2a 反例 + 2b/2c 正例：`> **修订二**：` 须报出；『正文里补充索引后』"
                u"（标记词在第 3 位）与 decisions 之外的 `变更记录.md` 都不得报",
                u"实得 %s%s" % (got, (u"；git 准备失败：%s" % err) if err else u""),
                why=u"D-3：放宽成『前 8 个字符内』时本仓 docs/ 的候选从 10 行涨到 67 行，全是正文句子")

        # 2d/2e：围栏代码块、英文词作普通名词、「修订后」指代句不命中；标题/标签形态仍命中
        must_hit = [u"## 修订记录", u"修订五：补一段。", u"> **修订：** 改了一句。",
                    u"补充说明（2026-09-01）", u"## Changelog", u"Revision: 2"]
        must_miss = [u"```", u"修订：围栏里的样例", u"## Changelog", u"```",
                     u"~~~sql", u"Revision: 9", u"~~~",
                     u"revision id `\"0053_x\"`（迁移脚本名）照旧。",
                     u"修订后的结论见 §13.1。", u"修订后：以新表为准。"]
        hits = _revision_hits(u"\n".join(must_miss + must_hit))
        hit_lines = sorted(n for n, _s, _m in hits)
        want = list(range(len(must_miss) + 1, len(must_miss) + len(must_hit) + 1))
        _assert(results, hit_lines == want,
                u"2d 正例 + 2e 反例：围栏代码块内、`revision id …` 叙述行、「修订后」开头的指代句都不得命中；"
                u"`## 修订记录`、`修订五：`、`> **修订：**`、`补充说明（…）`、`## Changelog`、`Revision: 2` 缺一即失败",
                u"期望命中行 %s，实得 %s" % (want, [(n, s) for n, s, _m in hits]),
                why=u"采用项目实测误报：围栏里的样例、英文 revision 作普通名词、「修订后」作指代")

        # 2f/2g/2h：围栏按 CommonMark 开闭（同字符、长度 ≥ 开围栏；行首 ```x``` 是内联不开围栏）；
        # 表格标签行 `| Revision | 2 |` 仍命中
        sample = [u"````md", u"```", u"修订：外层围栏里的样例", u"```", u"````",
                  u"修订六：外层围栏之后的真标记",                       # 第 6 行
                  u"```x``` 是行内代码，不开围栏",
                  u"修订七：内联代码之后的真标记",                       # 第 8 行
                  u"| Revision | 2 |"]                                    # 第 9 行
        got2 = sorted(n for n, _s, _m in _revision_hits(u"\n".join(sample)))
        _assert(results, got2 == [6, 8, 9],
                u"2f/2g/2h：4 反引号外层内嵌 ``` 后的真标记、行首 ```x``` 后的真标记、"
                u"表格行 `| Revision | 2 |` 都须命中，外层围栏里的样例不得命中",
                u"期望命中行 [6, 8, 9]，实得 %s" % got2,
                why=u"CommonMark：闭合围栏须同字符且不短于开围栏；反引号围栏的信息串不得含反引号")

        # 3d：「文件」列写裸 ID 而实物叫 ADR-0002-y.md → 不得计入缺实物
        _assert(results, (not err) and _ids(res, "adr-index-missing") == [],
                u"3d 正例：索引「文件」列写裸 `ADR-0002`，实物叫 `ADR-0002-y.md`，两段式定位须找到它",
                u"实得 %s" % _ids(res, "adr-index-missing"),
                why=u"D-5：只认「文件」列、不回落 glob 时，这一行会成为假的 adr-index-missing")

    # ---- 3a/3b/3c：索引对账，声明与回退的结论必须不同 ----
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        _write(os.path.join(tmp, "docs", "decisions", "README.md"),
               u"# 索引\n\n| ID | 标题 | 状态 | 文件 |\n|---|---|---|---|\n"
               u"| ADR-0001 | 甲 | active | [ADR-0001](ADR-0001-x.md) |\n"
               u"| ADR-0002 | 乙 | active | ADR-0002 |\n")
        _write(os.path.join(tmp, "docs", "decisions", "ADR-0001-x.md"), u"# ADR-0001\n\n正文。\n")
        _write(os.path.join(tmp, "docs", "decisions", "ADR-0003-y.md"), u"# ADR-0003\n\n正文。\n")
        err = _git_commit(tmp)
        declared = {"_root": tmp, "layout": {"docs_root": "docs",
                                             "artifacts": {"decisions": "docs/decisions"}}}
        res = run(declared) if not err else []
        miss = [f for f in res if f["id"].startswith(u"drift/adr-index-missing")]
        unix = [f for f in res if f["id"] == u"drift/adr-unindexed/ADR-0003"]
        _assert(results,
                (not err) and len(miss) == 1 and u"ADR-0002" in (miss[0].get("evidence") or u"")
                and miss[0]["status"] == UNDETERMINED,
                u"3a 反例：索引列了 ADR-0002 而目录里没有实物，须聚合成一条 adr-index-missing 未定",
                u"实得 %s；证据 %r%s" % (_ids(res, "adr-index-missing"),
                                        miss[0].get("evidence") if miss else u"（无）",
                                        (u"；git 准备失败：%s" % err) if err else u""))
        _assert(results,
                (not err) and len(unix) == 1 and unix[0]["status"] == FAIL,
                u"3b 反例：目录里有 ADR-0003 实物而索引没列，且项目**声明了** "
                u"layout.artifacts.decisions，须判 FAIL",
                u"实得 %s" % [(f["id"], f["status"]) for f in unix])

        fallback = {"_root": tmp, "layout": {"docs_root": "docs"}}
        res2 = run(fallback) if not err else []
        unix2 = [f for f in res2 if f["id"] == u"drift/adr-unindexed/ADR-0003"]
        _assert(results,
                (not err) and len(unix2) == 1 and unix2[0]["status"] == UNDETERMINED,
                u"3c 正例：同一棵树，ADR 目录靠目录名回退猜到时，同一条须降为 UNDETERMINED 不是 FAIL",
                u"实得 %s" % [(f["id"], f["status"]) for f in unix2],
                why=u"契约 §1.1：判据靠猜测得出的结论只能是 PASS 或 UNDETERMINED，永不 FAIL")

    # ---- 4a/4b/4c：STATUS 声明的工作项 ----
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        _write(os.path.join(tmp, "docs", "state", "STATUS.md"),
               u"# 状态\n\n- WI-0001 在做。\n- WI-0003 也在做。\n")
        _write(os.path.join(tmp, "docs", "state", "work", "WI-0003-a.md"), u"# WI-0003\n")
        _write(os.path.join(tmp, "docs", "state", "work", "WI-0002-b.md"), u"# WI-0002\n")
        err = _git_commit(tmp)
        cfg = {"_root": tmp, "layout": {"docs_root": "docs",
                                        "artifacts": {"status": "docs/state/STATUS.md"}}}
        res = run(cfg) if not err else []
        got = _ids(res, "work-item-missing")
        statuses = [f["status"] for f in res if f["id"] in got]
        _assert(results,
                (not err) and got == [u"drift/work-item-missing/WI-0001"]
                and statuses == [UNDETERMINED],
                u"4a 反例 + 4b/4c 正例：STATUS 写了 WI-0001 而 work/ 下没有它，须报一条未定；"
                u"有文件的 WI-0003 与只有文件没进 STATUS 的 WI-0002 都不得报",
                u"实得 %s%s" % (got, (u"；git 准备失败：%s" % err) if err else u""),
                why=u"契约 §3 静默失效探测；契约 §1.1：ID 形态是工具约定，永不 FAIL")
        passes = sorted(f["id"] for f in res if f["status"] == PASS)
        _assert(results,
                (not err) and passes == [u"drift/future-date"],
                u"PASS 的两个方向：判据 1 这次干净，须出一条 `drift/future-date` PASS 让它"
                u"看得出跑过；判据 4 这次有问题，就**不得**再出 `drift/work-item` PASS",
                u"实得 PASS %s" % passes,
                why=u"01 §5.6 静默失效探测：跑过与没跑过要在报告里分得出；"
                    u"有问题的判据再报一条通过，等于两句话互相抵消")
        _assert(results,
                (not err) and u"默认" in
                (([f for f in res if f["id"] in got] or [{}])[0].get("evidence") or u""),
                u"4a 附带：未声明 layout.work_root 时取常量 %s，证据里须注明用的是默认"
                % DEFAULT_WORK_ROOT,
                u"证据 %r" % (([f for f in res if f["id"] in got] or [{}])[0].get("evidence")))

    # ---- 4d/4e：状态源声明为目录（一件一文件）视为存在；路径不存在仍报 ----
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        _write(os.path.join(tmp, "docs", "items", "a.md"), u"# 甲\n\n- WI-0007 在做。\n")
        _write(os.path.join(tmp, "docs", "items", "sub", "b.md"), u"- WI-0009 不递归。\n")
        _write(os.path.join(tmp, "docs", "state", "work", "WI-0007-a.md"), u"# WI-0007\n")
        err = _git_commit(tmp)
        cfg = {"_root": tmp, "layout": {"docs_root": "docs", "artifacts": {"status": "docs/items"}}}
        res = run(cfg) if not err else []
        got = sorted(f["id"] for f in res if f["id"].startswith((u"drift/status", u"drift/work-item")))
        _assert(results,
                (not err) and got == [u"drift/work-item"],
                u"4d 正例：layout.artifacts.status 指向目录时视为存在，不报 status-missing；"
                u"ID 取目录下直接一层 *.md（WI-0007 有文件→PASS；子目录里的 WI-0009 不递归、不报）",
                u"实得 %s%s" % (got, (u"；git 准备失败：%s" % err) if err else u""))
        cfg = {"_root": tmp, "layout": {"docs_root": "docs", "artifacts": {"status": "docs/nope"}}}
        res = run(cfg) if not err else []
        _assert(results,
                (not err) and _ids(res, "status-missing") == [u"drift/status-missing/docs/nope"],
                u"4e 反例：layout.artifacts.status 指向的路径文件与目录都不存在，仍须报 status-missing",
                u"实得 %s" % _ids(res, "status-missing"))

    # ---- 4f：L0 形态——WORK.md 里写着 WI-，没有工作项目录 ----
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        _write(os.path.join(tmp, "WORK.md"), u"# 工作\n\n- WI-0001 在做。\n")
        _write(os.path.join(tmp, "docs", "a.md"), u"# 甲\n")
        err = _git_commit(tmp)
        res = run({"_root": tmp, "layout": {"docs_root": "docs"}}) if not err else []
        got = sorted(f["id"] for f in res if f["id"].startswith((u"drift/status", u"drift/work")))
        _assert(results,
                (not err) and got == [u"drift/work-root-absent"],
                u"4f 正例：状态文件列了 ID 而工作项目录不在，只记一条 work-root-absent（SKIP），"
                u"不逐 ID 报 work-item-missing——目录不在由 layout 报一次（契约 §1），L0 本不要求它",
                u"实得 %s%s" % (got, (u"；git 准备失败：%s" % err) if err else u""))
    return results
