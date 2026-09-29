# -*- coding: utf-8 -*-
"""完成声明的证据六字段。

执行 01 §1 G4（完成需要证据）与 01 §4.2 收工前第 1 条。§4.2 的六字段原文是：
① 断言（具体说了什么）② 原始证据（命令 + 完整输出，或 CI 链接；不许只写结论）
③ 版本与工作区身份 ④ 适用范围 ⑤ 观察时间 ⑥ 确认方法。**缺一项声明无效。**

契约见 ../CONTRACT.md。只用标准库。工作项扫描的小工具（`find_field` 等）与 check_freshness 共用，在 stdlib。
"""
from __future__ import annotations

import os
import re
import sys
import tempfile
import time

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 放末尾：不遮住标准库

from stdlib import (  # noqa: E402
    work_items, FAIL, PASS, SKIP, UNDETERMINED,
    agg, clean, finding, git_track, in_frozen, is_tailored_out, item_status, state_class,
    read_text, state_list, unreadable, work_root, work_root_absent, write_text,
    run_guarded, probe,
)

NAME = "evidence"
STANDARD_REFS = ["01 §1 G4", "01 §2 N1", "01 §3.1", "01 §4.1", "01 §4.2"]

# 状态字段词表已并进 stdlib.STATUS_FIELDS（01 §1 G2：同一事实一处权威）。
# 证据段的标题词（大小写不敏感）。这是工具约定（契约 §1.1）：认不出证据段只记未定，不判 FAIL。
_EVIDENCE_HEADINGS = ("证据", "evidence")

# 六字段。顺序即匹配优先级：同一行命中多个时取靠前的那个。
FIELDS = (
    ("assertion", "① 断言",
     ("断言", "assertion", "claim", "主张", "acceptance")),
    ("raw", "② 原始证据",
     ("原始证据", "raw_evidence", "raw evidence", "evidence", "artifact", "证据", "输出")),
    ("identity", "③ 版本与工作区身份",
     ("版本与工作区身份", "工作区身份", "版本", "revision", "head", "commit", "version",
      "workspace", "分支")),
    ("scope", "④ 适用范围",
     ("适用范围", "限制", "limitations", "limitation", "范围", "scope", "environment",
      "环境", "env")),
    ("observed", "⑤ 观察时间",
     ("观察时间", "observed_at", "observed at", "时间", "time", "时刻")),
    ("method", "⑥ 确认方法",
     ("确认方法", "确认方式", "方法", "procedure", "checker", "method")),
)
_LABELS = dict((k, label) for k, label, _syn in FIELDS)
_ORDER = [k for k, _l, _s in FIELDS]

# 表头到字段的映射比行内标签更严：ID 列不算字段。
_HEADER_MAP = (
    ("acceptance", "assertion"), ("断言", "assertion"), ("主张", "assertion"),
    ("assertion", "assertion"), ("claim", "assertion"),
    ("artifact", "raw"), ("原始证据", "raw"), ("raw", "raw"), ("evidence", "raw"),
    ("证据", "raw"), ("输出", "raw"),
    ("revision", "identity"), ("head", "identity"), ("version", "identity"),
    ("版本", "identity"), ("commit", "identity"), ("工作区", "identity"), ("分支", "identity"),
    ("limitation", "scope"), ("限制", "scope"),
    ("适用范围", "scope"), ("环境", "scope"), ("environment", "scope"), ("scope", "scope"),
    ("范围", "scope"),
    ("observed", "observed"), ("观察时间", "observed"), ("时间", "observed"),
    ("time", "observed"), ("date", "observed"),
    ("procedure", "method"), ("checker", "method"), ("确认", "method"),
    ("方法", "method"), ("method", "method"),
)
_LIMIT_WORDS = ("限制", "limitation")

_PLACEHOLDERS = {
    "", "tbd", "todo", "待补", "待填", "待定", "待确认", "na", "n/a", "n.a.",
    "-", "--", "—", "——", "?", "？", "...", "。", "xxx", "略",
}


# --------------------------------------------------------------------------
# 小工具
# --------------------------------------------------------------------------

def _is_placeholder(value):
    v = clean(value).lower().replace(" ", "").replace("　", "")
    return v in _PLACEHOLDERS


# --------------------------------------------------------------------------
# 证据段解析
# --------------------------------------------------------------------------

_FENCE = re.compile(r"^\s*(`{3,}|~{3,})")


def _evidence_sections(text):
    """返回 [(标题, 起始行号(1-based), [行])]，标题含"证据"的小节。

    围栏代码块里的行不算标题、也不进小节（C06）：代码里的 `# 注释` 会截断证据段，
    命令输出里的 `time: 3s` 会被认成字段。比证据段标题低一级以上的小标题（`### E-01`）
    留在段内，由 _parse_list_blocks 当条目头（C13）；同级或更高一级的标题才结束这一段。
    """
    lines = text.splitlines()
    out, cur, fence, level = [], None, None, 0
    for i, ln in enumerate(lines):
        m = _FENCE.match(ln)
        if fence is None and m:
            fence = m.group(1)
            continue
        if fence is not None:   # 闭合行：同一种字符、不短于开栏、后面只有空白（CommonMark；R2-12）
            if re.match(r"^\s*%s{%d,}\s*$" % (re.escape(fence[0]), len(fence)), ln):
                fence = None
            continue
        if ln.lstrip().startswith("#"):
            title = ln.lstrip().lstrip("#")
            depth = len(ln.lstrip()) - len(title)
            if cur is not None and depth > level:
                cur[2].append((i + 1, ln))
                continue
            if cur is not None:
                out.append(cur)
                cur = None
            if any(k in title.strip().lower() for k in _EVIDENCE_HEADINGS):
                cur, level = (title.strip(), i + 2, []), depth
            continue
        if cur is not None:
            cur[2].append((i + 1, ln))
    if cur is not None:
        out.append(cur)
    return out


_BLOCK_HEAD = re.compile(r"^\s*(?:[-*+]\s*)?\*\*(?P<name>[^*]+)\*\*")
_SUBHEAD = re.compile(r"^\s*#{3,6}\s+(?P<name>.+)$")
# 形如「标签: 值」的行（可带列表记号或编号）。_label_field 不认的这种行算「认不出的字段」（R2-1）
# 认不出的「标签: 值」行：标签不含空白与斜杠、不超过 12 字、非纯数字（时刻）、冒号后不紧跟 //（URL）；
# 注意、备注之类说明词不算标签（R2-1 第二轮收窄）
_LABEL_LINE = re.compile(r"^\s*(?:[-*+]\s+|\d+[.、)）]\s*)?[*_`]{0,2}(?P<l>[^\s:：|/*_`]{1,12})[*_`]{0,2}[:：](?!//)\s*\S")
_NOTE_WORDS = {"注意", "备注", "说明", "注", "附注", "提示", "note", "notes", "ps", "tip", "todo", "warning"}


def _unknown_label(ln):
    m = _LABEL_LINE.match(ln)
    return bool(m) and not m.group("l").isdigit() and m.group("l").lower() not in _NOTE_WORDS


def _label_field(line):
    """行内标签 → (字段键, 值)。不是字段行返回 (None, None)。"""
    for key, _label, syns in FIELDS:
        for syn in syns:
            m = re.search(r"(?:^|[\s　|*>()（）.、\d])" + re.escape(syn) + r"\s*[:：]\s*(.*)$",
                          line, re.I)
            if m:
                return key, m.group(1).strip()
    return None, None


def _parse_list_blocks(rows, whole=True):
    """加粗条目行（或三级以上小标题）起头的证据条目。

    表格行归 _parse_table_blocks，这里不看（C08：表格格子里的「输出: …」曾被认成字段，
    凭空多出一条「（整段）」证据判 FAIL）。whole=False 时不把整段兜成一条——同一段里已按
    字段表认出了条目，零散的「字段: 值」只是说明文字。
    """
    rows = [(n, ln) for n, ln in rows if not ln.lstrip().startswith("|")]
    blocks, cur = [], None
    for lineno, ln in rows:
        bold = _BLOCK_HEAD.match(ln)
        m = bold or _SUBHEAD.match(ln)
        if m and not _label_field(ln)[0]:
            if cur:
                blocks.append(cur)
            cur = {"name": clean(m.group("name")), "line": lineno, "fields": {},
                   "limit_cols": [], "kind": "条目", "unknown": 0, "sub": not bold}
            continue
        if cur is None:
            continue
        key, val = _label_field(ln)
        if not key and _unknown_label(ln):
            cur["unknown"] += 1
        if key and key not in cur["fields"]:
            cur["fields"][key] = val
            if key == "scope" and any(w in ln.lower() for w in _LIMIT_WORDS):
                cur["limit_cols"].append(val)
    if cur:
        blocks.append(cur)
    # 小标题起头、一个字段行都没有的块（`### 备注`、`#### 附件`）不是证据条目（R2-2）；加粗条目照判
    blocks = [b for b in blocks if not b["sub"] or b["fields"] or b["unknown"]]

    if not blocks and whole:  # 没有条目行但整段就是一条证据
        one = {"name": "（整段）", "line": rows[0][0] if rows else 1, "fields": {},
               "limit_cols": [], "kind": "条目", "unknown": 0}
        for lineno, ln in rows:
            key, val = _label_field(ln)
            if not key and _unknown_label(ln):
                one["unknown"] += 1
            if key and key not in one["fields"]:
                one["fields"][key] = val
                if key == "scope" and any(w in ln.lower() for w in _LIMIT_WORDS):
                    one["limit_cols"].append(val)
        if one["fields"]:
            blocks.append(one)
    return blocks


def _split_row(ln):
    s = ln.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [c.strip() for c in s.split("|")]


def _is_sep(ln):
    """表格分隔行。不用正则：原写法里 `\\s*` 与字符类重叠，满行 `|` 或空格是平方级（R2-11）。"""
    return "|" in ln and "-" in ln and set(ln.strip()) <= set("|:- \t")


def _map_header(cells):
    """表头 → {列号: 字段键}。以 _id 结尾的列当标识符，不当字段（acceptance_id 除外）。"""
    cols = {}
    for idx, cell in enumerate(cells):
        name = clean(cell).lower()
        if not name:
            continue
        if name.endswith("_id") and "acceptance" not in name:
            continue
        for token, key in _HEADER_MAP:
            if token in name:
                cols[idx] = key
                break
    return cols


def _parse_table_blocks(rows):
    """字段表写法：表头映射到六字段，每个数据行是一条证据。"""
    blocks = []
    i = 0
    while i < len(rows) - 1:
        lineno, ln = rows[i]
        if "|" in ln and _is_sep(rows[i + 1][1]):
            header = _split_row(ln)
            cols = _map_header(header)
            if len(set(cols.values())) < 3:
                i += 1
                continue
            # 首列之外映射不到字段的表头列算「认不出的字段」（首列是条目名/编号，R2-1）
            unknown = sum(1 for idx, c in enumerate(header) if idx and idx not in cols and clean(c)
                          and clean(c).lower() not in _NOTE_WORDS
                          and not clean(c).lower().endswith("_id"))
            j = i + 2
            while j < len(rows) and "|" in rows[j][1] and rows[j][1].strip():
                cells = _split_row(rows[j][1])
                # 条目名取第一个非空格：不取行号，否则 id 随行号漂（C19）
                blk = {"name": next((c for c in cells if c.strip()), "（空行）").strip(),
                       "line": rows[j][0], "fields": {}, "limit_cols": [], "kind": "表行",
                       "unknown": unknown}
                for idx, key in cols.items():
                    if idx >= len(cells):
                        continue
                    val = cells[idx]
                    if key not in blk["fields"] or _is_placeholder(blk["fields"][key]):
                        blk["fields"][key] = val
                    if key == "scope" and any(w in clean(header[idx]).lower()
                                              for w in _LIMIT_WORDS):
                        blk["limit_cols"].append(val)
                blocks.append(blk)
                j += 1
            i = j
            continue
        i += 1
    return blocks


def _judge(block):
    """返回 (missing, empty, limits_empty)。"""
    missing, empty = [], []
    for key in _ORDER:
        if key not in block["fields"]:
            missing.append(_LABELS[key])
        elif _is_placeholder(block["fields"][key]):
            empty.append(_LABELS[key])
    limits_empty = any(_is_placeholder(v) for v in block["limit_cols"])
    return missing, empty, limits_empty


# --------------------------------------------------------------------------
# 契约接口
# --------------------------------------------------------------------------

def scope(cfg):
    return {
        "covered": [
            "layout.work_root（当前 %r）下 git 跟踪的 *.md 中状态为已完成的工作项，"
            "**包括落在 layout.frozen 里的**：frozen 的语义是「不承担更新义务」（01 §3.1），"
            "而本检查判的是「这条完成声明当初成不成立」，与要不要更新无关；"
            "把 frozen 当跳过条件，等于把 §3.1 的一条豁免搬到一条它不适用的判据上" % work_root(cfg)[0],
            "它们证据段里每条证据的六字段（01 §4.2）是否齐全、值是否为空或占位",
            "两种写法：加粗条目行下的编号字段，以及表头能映射到六字段的字段表",
        ],
        "not_covered": [
            "不判断证据内容是否属实：只判字段在不在、值空不空。命令是否真跑过、输出是否被裁剪过、"
            "版本号是否对得上，本工具一概不看（契约 §7）",
            "不打开证据里引用的 artifacts 文件或 CI 链接，不核对它们存在与否",
            "L0 合在状态工件（WORK.md 之类）里的工作项不扫：只扫工作项目录，目录不在记 SKIP，"
            "目录在不在由 layout 报",
            "不核对证据是否逐条绑到验收 ID（01 §4.1 done 行要求绑），也不追进验收文件核对主张",
            "不判断 01 §4.2 ④ 里「跨边界后采集」这一条是否满足——那要看证据内容",
            "不看未被 git 跟踪的文件，不看 .md 以外的文件，不看 PR/提交说明里承载的轻量简记"
            "（01 §4.1 允许该写法，本工具读不到）",
            "不判断文档内容是否仍然正确，也不判断日期新旧——那是 freshness 检查器的事",
            "状态认不出的工作项不查完成证据：未定由 freshness/unknown-state 报；freshness 被裁剪或该件"
            "落在 layout.frozen 时由本检查器记 evidence/unknown-state",
            "只认 §4.2 的六字段标签及其常见同义词；缺字段而条目里有认不出的「标签: 值」行（或字段表有"
            "映射不到的列）时只记未定（fields-unrecognized），没有这种行就按缺字段判 FAIL；"
            "认出的字段值为空或占位判 FAIL",
            "自检覆盖行内标签与字段表两种写法；不依赖 git 时间",
        ],
    }


def run(cfg):
    return run_guarded(NAME, _run, cfg)


def _run(cfg):
    root = cfg.get("_root") or "."
    wroot, wnote = work_root(cfg)

    declared = state_list(cfg, "work_item_done_states", ())
    note = "完成态按 01 §4.1 done 及别名（stdlib.WORK_ITEM_STATES）%s；%s" % (
        "，并入 project.yaml 的 work_item_done_states：%s" % "/".join(declared) if declared else "", wnote)
    fresh_off = is_tailored_out(cfg, "freshness")[0]

    absent = work_root_absent(NAME, cfg)    # 目录在不在归 layout 报，这里不重复记未定
    if absent:
        return [absent]

    files, problem = work_items(root, wroot)   # 只看直接一层
    if problem:
        return [finding(NAME, UNDETERMINED, "列不出 git 跟踪的工作项", reason=problem,
                        why="契约 §1：依赖不可用记未定，不记通过")]

    out, other, unknown, unknown_here = [], [], [], []
    for rel in files:
        try:
            text = read_text(os.path.join(root, rel), root)
        except OSError as exc:
            out.append(unreadable(NAME, rel, exc))
            continue

        status = item_status(text)
        if status is None:
            # 读不到状态：是不是工作项、要不要报 no-status 都由 freshness 判一次（契约 §1 同一事实只报一次），
            # 这里静默跳过
            continue
        cls = state_class(cfg, status)
        if cls is None:
            # freshness 被裁剪或该件落在 frozen（freshness 不读它的状态）时由本检查器报，否则指向 freshness
            (unknown_here if fresh_off or in_frozen(cfg, rel) else unknown).append(
                "%s（%s）" % (rel, status or "空"))
            continue
        if cls != "done":
            other.append("%s（%s）" % (rel, status or "空"))
            continue

        out.extend(_check_one(rel, text, status, note))

    if unknown:
        out.append(agg(NAME, SKIP, "状态认不出的工作项不查完成证据", unknown, kind="unknown-state-by-freshness",
                       reason="状态认不出由 freshness/unknown-state 记未定，报一次（契约 §1）"))
    if unknown_here:
        out.append(agg(NAME, UNDETERMINED, "工作项状态不在已知词表", unknown_here, kind="unknown-state",
                       reason="freshness 被裁剪或这些件落在 layout.frozen（freshness 不读其状态），由本检查器报一次；"
                              "认不出就说不清是否完成，完成证据本次没查（契约 §1.1）"))
    if other:
        out.append(agg(NAME, SKIP, "未完成的工作项不查完成证据", other, kind="not-done",
                       reason="01 §1 G4 约束的是完成声明；未声明完成的不适用本检查"))
    if not out:
        out.append(finding(
            NAME, UNDETERMINED, "%s 下没有可判定的工作项" % wroot, where=wroot,
            reason="空集上说不出'全部完成声明都有证据'（01 §2 N1：X 为空集时判未定）",
            evidence=note,
        ))
    return out


def _check_one(rel, text, status, note):
    sections = _evidence_sections(text)
    if not sections:
        return [finding(
            NAME, UNDETERMINED, "已完成但认不出证据段：%s" % rel, where="%s:1" % rel,
            kind="no-evidence-section", key=rel,
            reason="全文没有标题含 %s 的小节。标题词是本工具的约定，不是项目的声明（契约 §1.1）："
                   "没找到只说明证据不在工具猜的地方，推不出没有证据" % " / ".join(_EVIDENCE_HEADINGS),
            why="01 §1 G4 完成需要证据；01 §4.2 收工前要求每个完成声明后面跟一段六字段",
            evidence="状态 %s。%s" % (status, note),
        )]

    blocks = []
    for _title, _start, rows in sections:
        table = _parse_table_blocks(rows)
        blocks.extend(table)
        blocks.extend(_parse_list_blocks(rows, whole=not table))
    if not blocks:
        return [finding(
            NAME, UNDETERMINED, "证据段里认不出证据条目：%s" % rel,
            where="%s:%d" % (rel, sections[0][1]),
            reason="本工具只认两种写法：加粗条目行下的编号字段，或表头能映射到六字段的表；"
                   "都没认出来，判不了字段齐不齐——不猜，也不当通过",
            why="01 §2 N1：证据不足而无法判定记未定", evidence=note,
        )]

    out = []
    for blk in blocks:
        missing, empty, limits_empty = _judge(blk)
        where = "%s:%d" % (rel, blk["line"])
        head = "%s 的证据 %s" % (rel, blk["name"])
        other_bad = [x for x in (missing + empty) if x != _LABELS["scope"]]

        if not missing and not empty and not limits_empty:
            out.append(finding(NAME, PASS, "%s 六字段齐全" % head, where=where,
                               evidence="%s（%s）。%s" % (blk["kind"], "、".join(_LABELS[k] for k in _ORDER), note)))
            continue

        if not empty and not limits_empty and blk["unknown"] >= len(missing):   # 一行认不出最多顶一个缺项
            # 缺的字段可能就在那几行认不出的「标签: 值」里：字段名是本工具的词表，项目可能用了
            # 自己的叫法（C07，契约 §1.1）。没有这种行就是真没写，照判 FAIL（R2-1）
            out.append(finding(
                NAME, UNDETERMINED, "%s 有字段没认出：%s" % (head, "、".join(missing)), where=where,
                kind="fields-unrecognized", key="%s|%s" % (rel, blk["name"]),
                reason="条目里有 %d 行「标签: 值」本工具认不出；字段名是本工具的词表（§4.2 六字段及常见"
                       "同义词），不是项目的声明，没认出推不出没写（契约 §1.1）。认出的字段都有值" % blk["unknown"],
                why="01 §4.2 收工前第 1 条的六字段；01 §1 G4 完成需要证据",
                evidence="写法：%s。%s" % (blk["kind"], note),
            ))
            continue

        if not other_bad:
            out.append(finding(
                NAME, FAIL, "%s 的限制（④ 适用范围）为空，其余五项齐全" % head, where=where,
                kind="limits-empty", key="%s|%s" % (rel, blk["name"]),
                why="01 §4.2 的六字段里④是适用范围，01 §1 G4 缺一即声明无效。"
                    "没有写限制不等于没有限制——空的限制字段让通过看起来比实际更强，"
                    "读的人会把一次局部验证当成全面验证",
                evidence="缺/空：%s；写法：%s。%s"
                         % ("、".join(missing + empty) or "限制列为空", blk["kind"], note),
            ))
            continue

        parts = []
        if missing:
            parts.append("缺字段：%s" % "、".join(missing))
        if empty:
            parts.append("值为空或占位：%s" % "、".join(empty))
        if limits_empty and _LABELS["scope"] not in missing + empty:
            parts.append("限制列为空")
        out.append(finding(
            NAME, FAIL, "%s 证据六字段不全" % head, where=where,
            kind="incomplete", key="%s|%s" % (rel, blk["name"]),
            why="01 §4.2 收工前第 1 条列的六字段是①断言②原始证据③版本与工作区身份"
                "④适用范围⑤观察时间⑥确认方法；01 §1 G4：证据六字段缺一即声明无效。"
                "当时没记，事后补不出来",
            evidence="%s；写法：%s。%s" % ("；".join(parts), blk["kind"], note),
        ))
    return out


# --------------------------------------------------------------------------
# 自检：反例与正例各一（契约 §3）
# --------------------------------------------------------------------------

_SIX = """**E-01**（INV-014，staging）
1. 断言：导入 100 行样表，四类拆分结果与人工标注一致
2. 原始证据：`artifacts/e01.txt`（`pytest tests/import -v` 14/14 绿）
3. 版本：`main@7e1f2a9`，staging migration 20260901_0930
4. 范围：staging；只覆盖单店样表；未覆盖多店并发
5. 时间：2026-09-01 16:42
6. 方法：pytest + 人工抽查 10 行
"""

_FIVE = """**E-01**（INV-014，staging）
1. 断言：导入 100 行样表，四类拆分结果与人工标注一致
2. 原始证据：`artifacts/e01.txt`（`pytest tests/import -v` 14/14 绿）
3. 版本：`main@7e1f2a9`
4. 范围：staging；只覆盖单店样表
5. 时间：2026-09-01 16:42
"""


def _sample(tmp, body, frozen=None, heading="## 验收证据"):
    write_text(os.path.join(tmp, "work", "WI-0001-x.md"),
               "# WI-0001\n\n状态：**done**\n\n%s\n\n" % heading + body)
    err = git_track(tmp)
    layout = {"work_root": "work"}
    if frozen is not None:
        layout["frozen"] = frozen
    return {"_root": tmp, "layout": layout}, err


def selftest():
    """反例：缺⑥确认方法、或⑥只写了占位「待补」的完成证据，都须判 FAIL。
    正例：六项齐全且限制非空，须判 PASS。
    另有字段表写法（C08、C19）、小标题条目、代码块、自造字段名等反例。
    """
    results = []
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        cfg, err = _sample(tmp, _FIVE)
        got = [f["status"] for f in run(cfg)] if not err else []
        ok = (not err) and got == [FAIL]
        results.append(probe(NAME, ok,
            "反例：已完成工作项缺⑥确认方法，应判 FAIL",
            evidence="实得 %s%s" % (got, ("；git 准备失败：%s" % err) if err else ""),
            why="契约 §3 静默失效探测：抓不出违规的检查器，其结论作废",
        ))

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        cfg, err = _sample(tmp, _FIVE + "6. 方法：待补\n")
        got = [f["status"] for f in run(cfg)] if not err else []
        results.append(probe(NAME, (not err) and got == [FAIL],
            "反例：已完成工作项⑥确认方法写的是占位，应判 FAIL",
            evidence="实得 %s%s" % (got, ("；git 准备失败：%s" % err) if err else ""),
            why="01 §4.2：占位不是值",
        ))

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        cfg, err = _sample(tmp, _SIX)
        got = [f["status"] for f in run(cfg)] if not err else []
        ok = (not err) and got == [PASS]
        results.append(probe(NAME, ok,
            "正例：六字段齐全且限制非空，应判 PASS",
            evidence="实得 %s%s" % (got, ("；git 准备失败：%s" % err) if err else ""),
            why="契约 §3 静默失效探测：把合规样本判成违规的检查器同样不可用",
        ))

    # frozen 不是跳过条件。没有这条，「解开 frozen 耦合」就只是一句注释：
    # 上一版把整个 work_root 划进 frozen 就能让本检查一条对象都取不到，
    # 而那正是一次真实扫描里"覆盖对象为零"的成因。
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        cfg, err = _sample(tmp, _FIVE, frozen=["work"])
        got = [f["status"] for f in run(cfg)] if not err else []
        ok = (not err) and got == [FAIL]
        results.append(probe(NAME, ok,
            "反例：落在 layout.frozen 里的已完成工作项，缺⑥仍应判 FAIL",
            evidence="实得 %s%s" % (got, ("；git 准备失败：%s" % err) if err else ""),
            why="01 §3.1 的 frozen 是「不承担更新义务」，01 §1 G4 判的是「完成声明成不成立」；"
                "两者无关，拿前者当后者的跳过条件会让归档区的完成声明全部免检",
        ))

    # 读不了的工作项是对象的事：出 unreadable/<路径>（可登记、按文件分开），不出不可登记的
    # internal-error（D-126 返修 R126-1：修前两份读不了的文件合成同一个 evidence/internal-error）
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        cfg, err = _sample(tmp, _SIX)
        write_text(os.path.join(tmp, "work", "WI-0003-z.md"), "# WI-0003\n\n状态：done\n")
        err = err or git_track(tmp)
        locked = [os.path.join(tmp, "work", n) for n in ("WI-0001-x.md", "WI-0003-z.md")]
        for p in locked:
            os.chmod(p, 0)
        try:
            ids = sorted(f["id"] for f in run(cfg) if f["status"] == UNDETERMINED) if not err else err
        finally:
            for p in locked:
                os.chmod(p, 0o644)
    want = ["evidence/unreadable/work/WI-0001-x.md", "evidence/unreadable/work/WI-0003-z.md"]
    can_lock = hasattr(os, "geteuid") and os.geteuid() != 0      # root 读得了 000 文件，这条无从构造
    results.append(probe(NAME, (not can_lock or ids == want),
        "反例：两份工作项读不了，各出一条 unreadable/<路径>，不出 internal-error",
        evidence="实得 %s%s" % (ids, "" if can_lock else "（root 运行，未构造）"),
        why="契约 §9：读不了的文件是对象的事，可登记；检查器自身出错才不可登记",
    ))

    # 只看工作项目录直接一层（D-123 裁定 3）；读不到状态的文件一律静默跳过——是不是工作项、
    # 要不要报 no-status 由 freshness 报一次（审查 B5）
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        write_text(os.path.join(tmp, "work", "artifacts", "WI-0009-留证.md"), "# 留证\n\n状态：done\n")
        write_text(os.path.join(tmp, "work", "current.md"), "# 当前\n")
        write_text(os.path.join(tmp, "work", "WI-0002-y.md"), "# 没写状态\n")
        cfg, err = _sample(tmp, _SIX)
        got = sorted((f["status"], f.get("where") or "") for f in run(cfg)) if not err else err
    ok = (not err) and [st for st, _w in got] == [PASS] and got[0][1].startswith("work/WI-0001-x.md")
    results.append(probe(NAME, ok,
        "只看直接一层、读不到状态的静默跳过：子目录里的完成态留证不查，current.md 与无状态 WI 不报",
        evidence="实得 %s" % (got,),
        why="D-123 裁定 3 与审查 B5：子目录是留证与产物；同一文件的 no-status 只由 freshness 报一次",
    ))

    # C07：项目自造的字段名（「核验手段」）认不出只记未定，不判 FAIL；认出的字段为占位仍判 FAIL（见反例）
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        cfg, err = _sample(tmp, _FIVE + "6. 核验手段：人工抽查 10 行\n")
        got = [(f["status"], f["id"]) for f in run(cfg)] if not err else err
    results.append(probe(NAME, got == [(UNDETERMINED, NAME + "/fields-unrecognized/work/WI-0001-x.md｜E-01")],
        "C07：自造字段名认不出只记未定（fields-unrecognized），不判 FAIL",
        evidence="实得 %s" % (got,), why="契约 §1.1：字段名词表落空推不出没写",
    ))

    # C06：条目里的代码块带 `# 注释`，不许把证据段截断；代码块里的 `时间: 3s` 不算字段
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        cfg, err = _sample(tmp, _SIX.replace("6. 方法：", "```bash\n# 跑测试\npytest -v  # 时间: 3s\n```\n6. 方法："))
        got = [f["status"] for f in run(cfg)] if not err else err
    results.append(probe(NAME, got == [PASS],
        "C06：证据条目里代码块的 # 注释不当标题，六字段齐全判 PASS",
        evidence="实得 %s" % (got,), why="01 §4.2 六字段；围栏代码块是正文，不是结构",
    ))

    # C13：`### E-01` 小标题起头的条目留在 `## 验收证据` 段内，按条目判（旧写法段在此截断，只记未定）
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        cfg, err = _sample(tmp, _FIVE.replace("**E-01**（INV-014，staging）", "### E-01") +
                                 "\n## 附注\n\n**E-02**\n1. 断言：不属于证据段\n")
        got = [(f["status"], f["title"]) for f in run(cfg)] if not err else err
    results.append(probe(NAME, got == [(FAIL, "work/WI-0001-x.md 的证据 E-01 证据六字段不全")],
        "C13：### 小标题起头的证据条目按条目判，同级标题结束证据段",
        evidence="实得 %s" % (got,), why="01 §4.2 六字段；markdown 小标题的层级决定它属于哪一段",
    ))

    # C08：字段表格子里写「输出: ok」、表下再附一句「输出: 见 artifacts」，不许多出一条「（整段）」证据
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        cfg, err = _sample(tmp, "| 断言 | 原始证据 | 版本 | 范围 | 时间 | 方法 |\n|---|---|---|---|---|---|\n"
                                "| 导入一致 | 输出: ok | c | d | e | f |\n\n输出: 见 artifacts/e01.txt\n")
        got = [f["status"] for f in run(cfg)] if not err else err
    results.append(probe(NAME, got == [PASS],
        "C08：字段表写法里格子与表外的「输出: …」不凭空生出「（整段）」证据",
        evidence="实得 %s" % (got,), why="01 §4.2 六字段；一条证据只判一次",
    ))

    # R2-2：证据段里没有字段行的小标题（### 备注、#### 附件）不当空条目
    got = []
    for body in (_SIX + "\n### 备注\n\n一段说明文字。\n",
                 _SIX.replace("**E-01**（INV-014，staging）", "### E-01") + "\n#### 附件\n\n见 artifacts。\n"):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            cfg, err = _sample(tmp, body)
            got.append([f["status"] for f in run(cfg)] if not err else err)
    results.append(probe(NAME, got == [[PASS], [PASS]],
        "R2-2：证据段里没有字段行的小标题不当成一条空证据",
        evidence="实得 %s" % (got,), why="01 §4.2 六字段只对证据条目判；说明性小标题不是条目",
    ))

    # R2-5：工作项目录声明成出仓的符号链接——layout 记未定，这里只记 SKIP 指向它，不另报「没有可判定的工作项」
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp, \
            tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as out_dir:
        write_text(os.path.join(out_dir, "WI-0001-x.md"), "# WI\n\n状态：done\n")
        os.symlink(out_dir, os.path.join(tmp, "ext"))
        err = git_track(tmp)
        got = [(f["status"], f["id"]) for f in run({"_root": tmp, "layout": {"work_root": "ext"}})] \
            if not err else err
    results.append(probe(NAME, got == [(SKIP, NAME + "/work-root-absent")],
        "R2-5：工作项目录链到项目之外只记 SKIP 指向 layout",
        evidence="实得 %s" % (got,), why="契约 §1 同一事实只报一次；§5 只读项目之内",
    ))

    # R2-11：证据段里一行 4 万个 `|` 或空格，表格分隔行判定须线性（旧正则约 7 秒）
    t0 = time.time()
    seps = (_is_sep("|" * 40000 + "x"), _is_sep(" " * 40000), _is_sep("|---|:-:|"), _is_sep("| a | b |"))
    took = time.time() - t0
    results.append(probe(NAME, seps == (False, False, True, False) and took < 1,
        "R2-11：表格分隔行判定线性、结果不变",
        evidence="实得 %s，耗时 %.2fs" % (seps, took), why="一份文件不许拖死整次检查",
    ))

    # R2-12：四个反引号开的围栏里的 ``` 不闭合它，其中的 `# 注释` 仍在代码里
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        cfg, err = _sample(tmp, _SIX.replace("6. 方法：", "````md\n```\n# 标题样例\n```\n````\n6. 方法："))
        got = [f["status"] for f in run(cfg)] if not err else err
    results.append(probe(NAME, got == [PASS],
        "R2-12：长围栏只被同字符、不短于开栏的行闭合",
        evidence="实得 %s" % (got,), why="围栏代码块是正文，不是结构",
    ))

    # C19：字段表里首格为空的行，id 不随行号漂——上面多一行空白，id 照旧
    ids = []
    for pad in ("", "\n\n"):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            cfg, err = _sample(tmp, pad + "| 编号 | 断言 | 原始证据 | 版本 | 范围 | 时间 | 方法 |\n"
                                          "|---|---|---|---|---|---|---|\n|  | 导入一致 | TBD | c | d | e | f |\n")
            ids.append([f["id"] for f in run(cfg)] if not err else err)
    ok = ids[0] == ids[1] and len(ids[0]) == 1 and ids[0][0].startswith(NAME + "/incomplete/work/WI-0001-x.md｜")
    results.append(probe(NAME, ok,
        "C19：字段表条目的 id 取条目名与文件，不随行号漂",
        evidence="两次实得 %s" % (ids,), why="契约 §4/§9：id 是登记与复核的地址",
    ))

    # 证据段标题是工具约定（契约 §1.1，D-123）：英文 `## Evidence` 照认；一个都认不出只记未定
    got = {}
    for tag, heading in (("en", "## Evidence"), ("none", "## 附注")):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            cfg, err = _sample(tmp, _SIX, heading=heading)
            got[tag] = [f["status"] for f in run(cfg)] if not err else err
    ok = got == {"en": [PASS], "none": [UNDETERMINED]}
    results.append(probe(NAME, ok,
        "约定：## Evidence 下六字段齐全判 PASS；认不出证据段只记未定，不判 FAIL",
        evidence="实得 %s" % got,
        why="契约 §1.1：标记词落空推不出没有证据",
    ))
    # R2-1 第二轮：认不出的标签只顶替同样多的缺项；说明词、URL、时刻不算标签。审查席在副本验证的 8 例
    #              一律回到 FAIL，「6. 核验手段：…」这种确实认不出的第六项仍记未定
    one = "**E-01**\n1. 断言：导入一致\n"
    five = ("**E-01**\n1. 断言：x\n2. 原始证据：a.txt\n3. 版本：main@1\n4. 范围：staging\n"
            "5. 时间：2026-09-01 16:42\n")
    cases = [(one + "注意：以上只在 staging 跑过\n", "incomplete"), (one + "详见 https://ci.example.com/run/1\n", "incomplete"),
             (one + "运行于 12:30 完成\n", "incomplete"), (one + "Note: flaky on CI\n", "incomplete"),
             (five + "备注：无\n", "incomplete"), (five + "日志 https://x/y\n", "incomplete"),
             ("| 编号 | 断言 | 原始证据 | 版本 | 范围 | 时间 | 备注 |\n|---|---|---|---|---|---|---|\n"
              "| E-1 | a | b | c | d | e | f |\n", "incomplete"),
             (one + "note: 见下\n", "incomplete"),
             (five + "6. 核验手段：人工抽查\n", "fields-unrecognized")]
    got = []
    for body, want in cases:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            cfg, err = _sample(tmp, body)
            ids = [f["id"].split("/")[1] for f in run(cfg) if f["status"] != SKIP] if not err else [err]
        got.append((ids, want))
    results.append(probe(NAME, all(ids == [want] for ids, want in got),
        "R2-1：说明词、URL、时刻不算认不出的标签，一行认不出最多顶一个缺项",
        evidence="实得 %s" % (got,), why="01 §4.2 六字段；契约 §1.1 只有确实认不出的字段才记未定"))
    return results
