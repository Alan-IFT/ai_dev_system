#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""drift 检查器私有纯函数的单元黄金样本：`_candidates`、`_revision_hits`、`_index_target`、`_latest_day`、`_blame` 的解析部分（用 blame 文本喂）、`_WI_RE`/`_WI_FIELD_RE`/`_BLAME_HEAD`。
写之前对每个 Python 字符串、正则、容器操作问过「JS 里对应的在非 ASCII、非 BMP、边界值上等价吗」（设计 §12.22）。
用法：python golden/make_unit_drift.py
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STD = os.path.join(os.path.dirname(HERE), "tools", "std")
sys.path.insert(0, STD)
spec = importlib.util.spec_from_file_location("check_drift", os.path.join(STD, "checks", "check_drift.py"))
cd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cd)

E = "\U0001f600"  # 非 BMP：Python 一个码点、JS 两个码元（D18）

# --- _candidates：左窗口 6、右窗口 10（按**码点**），动作词与计划词
CAND_TEXTS = [
    "", "无日期", "- 2026-09-22 裁定 X。", "- 2026-09-22 之后裁定", "- 2026-09-22" + "。" * 9 + "裁定", "- 2026-09-22" + "。" * 10 + "裁定", "- 2026-09-22" + "。" * 11 + "裁定",
    "复查：2026-12-08（半年）——已复查，无回退。", "计划 2026-12-08 裁定", "计划是 2026-12-08 裁定", "到期2026-12-08批准", "下次评审 2026-12-08 已完成", "保留至 2026-12-31 已发布",
    "截止 2026-12-31 批准", "有效期 2026-12-31 裁定", "xxxxx计划2026-12-08裁定", "x计划x2026-12-08裁定",
    "- 2026-09-22 裁定 X；2026-09-23 拍板 Y", "2026-09-22 2026-09-23 裁定", "第一行\n- 2026-09-22 裁定 X\n第三行", "a\r\n2026-09-22 裁定\r\nb", "a\x0c2026-09-22 裁定", "a\u20282026-09-22 裁定", "a\r2026-09-22 裁定\rb",
    "２０２６-０９-２２ 裁定", "12026-09-221 裁定", "a2026-09-22b裁定", "2026-9-22 裁定", "2026-09-22裁定", "2026-09-22 ：裁定", "2026-09-22 验收通过", "2026-09-22 验收 通过", "2026-09-22 已完成于",
    # 非 BMP：窗口按码点——日期前 6 个码点里放 emoji
    E * 3 + "计划" + "2026-12-08 裁定", E * 5 + "复查" + "2026-12-08 裁定", "计划" + E * 4 + "2026-12-08 裁定", "计划" + E * 5 + "2026-12-08 裁定", "计划" + E * 6 + "2026-12-08 裁定",
    "2026-09-22" + E * 4 + "裁定", "2026-09-22" + E * 5 + "裁定", "2026-09-22" + E * 6 + "裁定", "2026-09-22" + E * 9 + "裁定", "2026-09-22" + E * 10 + "裁定",
    E + "2026-09-22 裁定", E * 8 + "2026-09-22 裁定 " + E + "2026-09-23 拍板", "2026-09-22 裁定" + E + "2026-09-23" + E + "批准",
    "\u200b2026-09-22裁定", "\ufeff计划2026-09-22裁定", "計劃 2026-09-22 裁定",
]

# --- _revision_hits：围栏、标记词、`lstrip` 字符集、`lower()`、`rest[0]`
REV_TEXTS = [
    "", "## 修订记录", "修订五：补一段。", "> **修订：** 改了一句。", "补充说明（2026-09-01）", "## Changelog", "Revision: 2", "Revision 2", "revision id `\"0053_x\"`（迁移脚本名）照旧。", "修订后的结论见 §13.1。",
    "REVISION: x", "Revision：y", "ReVision | w", "CHANGELOG", "ChangeLog：", "ChangeLog 1.0", "# changelog 1.0", "REVİSION: z", "İrevision: x", "ǅ修订",
    "\u3000\u3000修订：全角缩进", "> > 修订：", "- 修订：列表", "* 修订：", "| 修订 | 2 |", "# # 修订", "-*|修订", "\t修订：tab", " \t\u3000> 修订", "\x0b修订", "\ufeff修订", "\u200b修订",
    "更新于 2026", "追加：x", "修改记录", "版本历史 v1", "变更记录", "补充", "UPDATE", "REVISION", "revision", "revision:", "revision：", "revision|", "revision *: x", "revision **：x", "revision\t: x", "revision \u3000: x", "revision \x85: x",
    "```\n修订：围栏里\n```\n修订：围栏外", "~~~\n修订：围栏里\n~~~", "````\n```\n修订：x\n```\n````\n修订：外", "```x``` 内联\n修订：外", "``` x`y\n修订：不开围栏", "```x`y```\n修订：行内", "  ```\n修订：缩进围栏\n  ```", "> ```\n修订：引用里的围栏\n> ```", "~~~~\n~~~\n修订：x\n~~~~\n修订：外",
    "```\n```x\n修订：仍在围栏里\n```\n修订：外", "```\n\n修订：围栏里\n```  \n修订：外", "```\n~~~\n修订：围栏里", "``` ```\n修订：外", "~~~ `x`\n修订：~~~ 的信息串可含反引号 → 开围栏\n~~~",
    "a" * 50, "修订" + "x" * 60, "补充" + E * 30, "修订：" + E * 20 + "尾", "## " + "修" * 45,
    "revision" + E, "revision " + E, "修订" + E, E + "修订", "REVİSİON: z", "REVISION\u212a: k",
    # 变异验证第一轮没抓住的盲区（输入由 Python 实测区分）：全角空格缩进的围栏（E7）、闭合围栏行尾带 U+FEFF——Python 的 strip 不去它，所以不闭合（E11）、
    # 英文标记词后只有全角空格/NBSP——rest 去尾部空白后为空才命中（E24）
    "\u3000```\n修订：围栏里\n\u3000```\n修订：外", "\u3000> ```\n修订：围栏里\n```\n修订：外", "```\n修订：围栏里\n```\ufeff\n修订：仍在围栏里（闭合行尾有 BOM，strip 不去 → 不闭合）",
    "```\n修订：围栏里\n```\u200b\n修订：仍在围栏里", "```\n修订：围栏里\n```\u00a0\n修订：外（NBSP 是 Python 空白，会闭合）", "revision \u3000", "REVISION \u00a0", "changelog\u3000", "revision \x85", "revision\u2028x",
]

# --- _index_target：「文件」列单元格
IDX_CELLS = [
    "", "ADR-0001", "[ADR-0001](ADR-0001-x.md)", "[x](a/b.md#sec)", "[x](#anchor)", "[x]( a.md )", "`ADR-0001-x.md`", " `a.md` ", "``a.md``", "a.MD", "a.md ", "x.md#y", "[x](a.md) [y](b.md)", "(括注)", "[x]()", "[x](a b.md)",
    "[x](<a.md>)", "`` `a.md` ``", "\u3000a.md\u3000", "a.md\u200b", "a.md\ufeff", "[x](a.md\u200b)", "[x](\ufeffa.md)", "a\u00a0.md",
]

# --- _BLAME_HEAD / blame 解析：用一份手工 porcelain 文本（40 位与 64 位 sha、未提交行全零、缺 committer-time）
SHA_A, SHA_B, SHA_C = "a" * 40, "b" * 40, "c" * 64
ZERO40, ZERO64 = "0" * 40, "0" * 64
BLAME_TEXTS = {
    "basic": "%s 1 1 2\nauthor x\ncommitter-time 1789000000\nsummary s\nfilename f\n\tline1\n%s 2 2\n\tline2\n" % (SHA_A, SHA_A),
    "two_commits": "%s 1 1 1\ncommitter-time 1789000000\nfilename f\n\tl1\n%s 2 2 1\ncommitter-time 1788000000\nfilename f\n\tl2\n%s 3 3\n\tl3\n" % (SHA_A, SHA_B, SHA_A),
    "uncommitted": "%s 1 1 1\nauthor Not Committed Yet\ncommitter-time 1789999999\nfilename f\n\tl1\n" % ZERO40,
    "uncommitted64": "%s 1 1 1\nauthor Not Committed Yet\ncommitter-time 1789999999\nfilename f\n\tl1\n" % ZERO64,
    "sha256": "%s 1 1 1\ncommitter-time 1789000000\nfilename f\n\tl1\n" % SHA_C,
    "no_time": "%s 1 1 1\nauthor x\nfilename f\n\tl1\n" % SHA_A,
    "empty": "",
    "crlf": "%s 1 1 1\r\ncommitter-time 1789000000\r\nfilename f\r\n\tl1\r\n" % SHA_A,
    "time_with_spaces": "%s 1 1 1\ncommitter-time   1789000000  \nfilename f\n\tl1\n" % SHA_A,
    "time_after_tab": "%s 1 1 1\n\tl1\ncommitter-time 1789000000\n" % SHA_A,
    "bad_head": "%s x 1\ncommitter-time 1789000000\n" % SHA_A,
    "upper_sha": "%s 1 1 1\ncommitter-time 1789000000\n\tl1\n" % ("A" * 40),
    "head_trailing_space": "%s 1 1 1 \ncommitter-time 1789000000\n\tl1\n" % SHA_A,
    "head_tab_sep": "%s\t1\t1\t1\ncommitter-time 1789000000\n\tl1\n" % SHA_A,
    "head_41": "%s 1 1 1\ncommitter-time 1789000000\n\tl1\n" % ("a" * 41),
    "head_65": "%s 1 1 1\ncommitter-time 1789000000\n\tl1\n" % ("a" * 65),
    "head_48": "%s 1 1 1\ncommitter-time 1789000000\n\tl1\n" % ("a" * 48),
    "head_arabic_digit": "%s \u0663 1 1\ncommitter-time 1789000000\n\tl1\n" % SHA_A,
    "dup_line": "%s 1 1 1\ncommitter-time 1789000000\n\tl1\n%s 1 1 1\n\tl1again\n" % (SHA_A, SHA_B),
    "mixed_zero": "%s 1 1 1\ncommitter-time 1789000000\n\tl1\n%s 2 2 1\n\tl2\n" % (SHA_A, "0" * 39 + "1"),
    "time_float": "%s 1 1 1\ncommitter-time 1789000000.5\n\tl1\n" % SHA_A,
    "time_negative": "%s 1 1 1\ncommitter-time -1\n\tl1\n" % SHA_A,
}

# --- _WI_RE（`\bWI-\d{3,}\b`）与 _WI_FIELD_RE：Unicode 词边界与数字
WI_LINES = [
    "WI-001", "WI-0010-x", "xWI-001", "WI-001x", "中WI-001文", "WI-001文", "WI-００１", "WI-001_", "_WI-001", "WI-12", "WI-123456", "wi-001", "WI-001٣", "依赖 WI-0002；留证见 WI-0003；WI-0004 有独立文件。",
    "WI-001,WI-002", "(WI-001)", "[WI-001]", "WI-001.md", "WI-001-WI-002", "WI-001\u200b", "\u200bWI-001", "WI-001\ufeff", "WI-001\u00a0", "WI-001\u3000", "WI-001é", "éWI-001", "WI-001ǅ", "WI-001\u0301", "\u0301WI-001",
    "WI-001" + E, E + "WI-001", "WI-999999999999999999999", "WI-0٣", "WI-\u0663\u0664\u0665",
    "work_item_id：WI-0001", "work_item_id:WI-0001", "work_item_id: WI-0001", "work_item_id:\u3000WI-0001", "work_item_id： WI-0001 x", " work_item_id：WI-0001", "work_item_id：WI-0001x", "work_item_id：WI-0001中", "work_item_id：\u200bWI-0001",
    "work_item_id：WI-001", "work_item_id：WI-12", "Work_Item_Id：WI-0001", "work_item_id：WI-０００１", "work_item_id：\x85WI-0001", "work_item_id：\x1cWI-0001", "work_item_id：\ufeffWI-0001",
]

LATEST_EPOCHS = [0, 1, 86399, 86400, 1789000000, 1788999999, 2 ** 31 - 1, 2 ** 31, 2 ** 40, -1, -86400, 253402300799, 1789000000.9, 3600 * 10 - 1, 3600 * 10]


def main():
    out = {"python": sys.version.split()[0]}
    out["candidates"] = [{"in": t, "out": [list(x) for x in cd._candidates(t)]} for t in CAND_TEXTS]
    out["revision_hits"] = [{"in": t, "out": [list(x) for x in cd._revision_hits(t)]} for t in REV_TEXTS]
    out["index_target"] = [{"in": c, "out": cd._index_target(c)} for c in IDX_CELLS]

    def _wi(line):
        m = cd._WI_FIELD_RE.match(line)
        return {"all": [m2.group(0) for m2 in cd._WI_RE.finditer(line)], "field": m.group(1) if m else None}
    out["wi"] = [dict(_wi(l), **{"in": l}) for l in WI_LINES]
    def _ld(e):
        try:
            return cd._latest_day(e).isoformat()
        except Exception as exc:  # noqa: BLE001  样本记下 Python 的真实行为，含溢出
            return "CRASH:%s" % type(exc).__name__
    out["latest_day"] = [{"epoch": e, "out": _ld(e)} for e in LATEST_EPOCHS]
    out["blame_head"] = [{"in": h, "out": bool(cd._BLAME_HEAD.match(h))} for h in [SHA_A + " 1 1 2", SHA_A + " 1 1", SHA_C + " 2 3", "A" * 40 + " 1 1", SHA_A + "\t1 1", SHA_A + " \u0663 1", "a" * 41 + " 1 1", SHA_A + " 1 1 ", SHA_A + " 1 1 1 1"]]
    out["blame_text"] = {}
    # 把 _blame 里「解析 porcelain 文本」的那一段原样搬过来（_blame 自己要跑 git，不能直接喂文本）；逻辑逐行照抄，不改
    for name, text in BLAME_TEXTS.items():
        times, lines, cur = {}, {}, None
        for raw in text.split("\n"):
            m = cd._BLAME_HEAD.match(raw)
            if m:
                cur = m.group(1)
                lines[int(m.group(3))] = cur
                continue
            if cur is None:
                continue
            if raw.startswith("\t"):
                cur = None
            elif raw.startswith("committer-time "):
                times[cur] = raw.split(" ", 1)[1].strip()
        res, problem = {}, None
        for lineno, sha in lines.items():
            if not sha.strip("0"):
                res[lineno] = [sha, None]
                continue
            epoch = times.get(sha)
            if epoch is None:
                problem = "blame 输出里 %s 这个提交没有 committer-time" % sha[:7]
                res = None
                break
            try:
                res[lineno] = [sha, cd._latest_day(epoch).isoformat()]
            except Exception as exc:  # noqa: BLE001  int("1789000000.5") 抛 ValueError：run 的外壳会把它转成未定
                problem = "CRASH:%s" % type(exc).__name__
                res = None
                break
        out["blame_text"][name] = {"in": text, "res": None if res is None else {str(k): v for k, v in res.items()}, "problem": problem}
    path = os.path.join(HERE, "unit", "drift.json")
    tmpf = path + ".tmp"
    with open(tmpf, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    back = json.load(open(tmpf, encoding="utf-8"))
    if {k: len(v) for k, v in back.items() if isinstance(v, (list, dict))} != {k: len(v) for k, v in out.items() if isinstance(v, (list, dict))}:
        sys.exit("回读与内存不一致，拒绝落盘")
    os.replace(tmpf, path)
    print("写出 golden/unit/drift.json：" + "、".join("%s %d" % (k, len(v)) for k, v in out.items() if isinstance(v, (list, dict))))


if __name__ == "__main__":
    main()
