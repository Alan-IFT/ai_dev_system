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

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from stdlib import (  # noqa: E402
    FAIL, PASS, SKIP, UNDETERMINED,
    agg, cfg_get, clean, finding, git_track, is_tailored_out, item_status, markdown_under,
    read_text, state_list, undetermined_from_exception, work_root, work_root_absent, write_text,
)

NAME = "evidence"
STANDARD_REFS = ["01 §1 G4", "01 §2 N1", "01 §3.1", "01 §4.1", "01 §4.2"]

_DEFAULT_DONE_STATES = ("done", "完成", "delivered")
# 状态字段词表已并进 stdlib.STATUS_FIELDS（01 §1 G2：同一事实一处权威）。
_EVIDENCE_HEADINGS = ("证据",)

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

def _evidence_sections(text):
    """返回 [(标题, 起始行号(1-based), [行])]，标题含"证据"的小节。"""
    lines = text.splitlines()
    out, cur = [], None
    for i, ln in enumerate(lines):
        if ln.lstrip().startswith("#"):
            title = ln.lstrip("#").strip()
            if cur is not None:
                out.append(cur)
                cur = None
            if any(k in title for k in _EVIDENCE_HEADINGS):
                cur = (title, i + 2, [])
            continue
        if cur is not None:
            cur[2].append((i + 1, ln))
    if cur is not None:
        out.append(cur)
    return out


_BLOCK_HEAD = re.compile(r"^\s*(?:[-*+]\s*)?\*\*(?P<name>[^*]+)\*\*")
_SUBHEAD = re.compile(r"^\s*#{3,6}\s+(?P<name>.+)$")


def _label_field(line):
    """行内标签 → (字段键, 值)。不是字段行返回 (None, None)。"""
    for key, _label, syns in FIELDS:
        for syn in syns:
            m = re.search(r"(?:^|[\s　|*>()（）.、\d])" + re.escape(syn) + r"\s*[:：]\s*(.*)$",
                          line, re.I)
            if m:
                return key, m.group(1).strip()
    return None, None


def _parse_list_blocks(rows):
    """加粗条目行（或三级以上小标题）起头的证据条目。"""
    blocks, cur = [], None
    for lineno, ln in rows:
        m = _BLOCK_HEAD.match(ln) or _SUBHEAD.match(ln)
        if m and not _label_field(ln)[0]:
            if cur:
                blocks.append(cur)
            cur = {"name": clean(m.group("name")), "line": lineno, "fields": {},
                   "limit_cols": [], "kind": "条目"}
            continue
        if cur is None:
            continue
        key, val = _label_field(ln)
        if key and key not in cur["fields"]:
            cur["fields"][key] = val
            if key == "scope" and any(w in ln.lower() for w in _LIMIT_WORDS):
                cur["limit_cols"].append(val)
    if cur:
        blocks.append(cur)

    if not blocks:  # 没有条目行但整段就是一条证据
        one = {"name": "（整段）", "line": rows[0][0] if rows else 1, "fields": {},
               "limit_cols": [], "kind": "条目"}
        for lineno, ln in rows:
            key, val = _label_field(ln)
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
    return bool(re.match(r"^\s*\|?[\s:\-|]+\|[\s:\-|]*$", ln)) and "-" in ln


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
            j = i + 2
            while j < len(rows) and "|" in rows[j][1] and rows[j][1].strip():
                cells = _split_row(rows[j][1])
                blk = {"name": (cells[0] if cells else "").strip() or "第 %d 行" % rows[j][0],
                       "line": rows[j][0], "fields": {}, "limit_cols": [], "kind": "表行"}
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
            "只认 §4.2 的六字段标签及其常见同义词；项目自造的字段名认不出，会被误报为缺字段",
            "自检只覆盖行内标签写法与不依赖 git 时间的分支；字段表写法未被反例证明",
        ],
    }


def run(cfg):
    try:
        return _run(cfg)
    except Exception as exc:  # noqa: BLE001 —— 契约 §1：内部异常一律未定
        return [undetermined_from_exception(NAME, exc, "跑 %s" % NAME)]


def _run(cfg):
    tailored, reason = is_tailored_out(cfg, NAME)
    if tailored:
        return [finding(NAME, SKIP, "项目已裁剪本检查", reason=reason or "project.yaml 未写理由")]

    root = cfg.get("_root") or "."
    wroot, wnote = work_root(cfg)

    states = state_list(cfg, "work_item_done_states", _DEFAULT_DONE_STATES)
    states_default = not cfg_get(cfg, "work_item_done_states")
    note = ("完成态用的是默认 %s（未配 work_item_done_states）" % "/".join(states)
            if states_default else "完成态取自 project.yaml：%s" % "/".join(states))
    note += "；" + wnote

    absent = work_root_absent(NAME, cfg)    # 目录在不在归 layout 报，这里不重复记未定
    if absent:
        return [absent]

    files, problem = markdown_under(root, wroot)
    if problem:
        return [finding(NAME, UNDETERMINED, "列不出 git 跟踪的工作项", reason=problem,
                        why="契约 §1：依赖不可用记未定，不记通过")]

    out, nostatus, other = [], [], []
    for rel in files:
        try:
            text = read_text(os.path.join(root, rel))
        except OSError as exc:
            out.append(undetermined_from_exception(NAME, exc, "读 %s" % rel))
            continue

        status = item_status(text)
        if status is None:
            nostatus.append(rel)
            continue
        if status not in states:
            other.append("%s（%s）" % (rel, status or "空"))
            continue

        out.extend(_check_one(rel, text, status, note))

    if nostatus:
        out.append(agg(NAME, SKIP, "工作项目录下没有状态字段的文件", nostatus,
                       reason="读不到状态字段，不当作工作项（README、索引之类）"))
    if other:
        out.append(agg(NAME, SKIP, "未完成的工作项不查完成证据", other,
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
            NAME, FAIL, "已完成但没有证据段：%s" % rel, where="%s:1" % rel,
            why="01 §1 G4 完成需要证据；01 §4.2 收工前要求每个完成声明后面跟一段六字段，"
                "缺一即声明无效——整段都没有，声明不成立",
            evidence="状态 %s；全文没有标题含'证据'的小节。%s" % (status, note),
        )]

    blocks = []
    for _title, _start, rows in sections:
        blocks.extend(_parse_table_blocks(rows))
        blocks.extend(_parse_list_blocks(rows))
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

        if not other_bad:
            out.append(finding(
                NAME, FAIL, "%s 的限制（④ 适用范围）为空，其余五项齐全" % head, where=where,
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


def _sample(tmp, body, frozen=None):
    write_text(os.path.join(tmp, "work", "WI-0001-x.md"),
               "# WI-0001\n\n状态：**done**\n\n## 验收证据\n\n" + body)
    err = git_track(tmp)
    layout = {"work_root": "work"}
    if frozen is not None:
        layout["frozen"] = frozen
    return {"_root": tmp, "layout": layout}, err


def selftest():
    """反例：只写了五项、缺⑥确认方法的完成证据，须判 FAIL。
    正例：六项齐全且限制非空，须判 PASS。
    只覆盖行内标签写法；字段表写法与 git 相关分支不在自检内（见 scope）。
    """
    results = []
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        cfg, err = _sample(tmp, _FIVE)
        got = [f["status"] for f in run(cfg)] if not err else []
        ok = (not err) and got == [FAIL]
        results.append(finding(
            NAME, PASS if ok else FAIL,
            "反例：已完成工作项缺⑥确认方法，应判 FAIL",
            evidence="实得 %s%s" % (got, ("；git 准备失败：%s" % err) if err else ""),
            why="契约 §3 静默失效探测：抓不出违规的检查器，其结论作废",
        ))

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        cfg, err = _sample(tmp, _SIX)
        got = [f["status"] for f in run(cfg)] if not err else []
        ok = (not err) and got == [PASS]
        results.append(finding(
            NAME, PASS if ok else FAIL,
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
        results.append(finding(
            NAME, PASS if ok else FAIL,
            "反例：落在 layout.frozen 里的已完成工作项，缺⑥仍应判 FAIL",
            evidence="实得 %s%s" % (got, ("；git 准备失败：%s" % err) if err else ""),
            why="01 §3.1 的 frozen 是「不承担更新义务」，01 §1 G4 判的是「完成声明成不成立」；"
                "两者无关，拿前者当后者的跳过条件会让归档区的完成声明全部免检",
        ))
    return results
