#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""freshness 检查器私有函数的单元黄金样本：`_section_body`、`_last_transition`（含 `re.match(r"\\s*(?:\\||[-*+]\\s)")` 与 `re.findall(r"\\d{4}-\\d{2}-\\d{2}")`）、`_age`、`_int_budget`、`_note`、
`_metadata_requirement`。写之前对每个 Python 字符串、正则、容器操作问一遍「JS 里对应的在非 ASCII、非 BMP、边界值上等价吗」（设计 §12.22 的教训）。
用法：python golden/make_unit_freshness.py
"""
import datetime
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STD = os.path.join(os.path.dirname(HERE), "tools", "std")
sys.path.insert(0, STD)
spec = importlib.util.spec_from_file_location("check_freshness", os.path.join(STD, "checks", "check_freshness.py"))
cf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cf)

# --- _section_body：标题含关键词的那一节（到下一个标题为止）；`lstrip().startswith("#")`、`lstrip("#").strip().lower()`、`str.lower`、`in` 子串、splitlines
KW = ("状态转换记录", "状态转换", "转换记录", "transition")
SECTION_TEXTS = [
    "", "no heading", "# 状态转换记录\nrow1\nrow2", "## 状态转换记录\n| a | b |\n\n## 下一节\nx", "### Transition\nA\n#### sub\nB", "## STATE TRANSITION LOG\nx", "## Transition\n\n  # 缩进标题\nx",
    "  ## 缩进的标题 转换记录\ny", "\t## 制表缩进 转换记录\ny", "\u3000## 全角缩进 转换记录\ny", "#转换记录\nz", "# #转换记录\nz", "## 转换记录 ##\nz", "## 非转换\nz\n## 转换记录\nw",
    "## 转换记录\nA\r\nB\rC\x0bD\x0cE\x1cF\x85G\u2028H\u2029I\n## end", "## 转换记录\n\n\n\n", "## 转换记录", "## 转换记录\n#", "## 转换记录\n  \n# x", "## İ transition\nx", "## TRANSİTİON\nx",
    "## Transition\n```\n## fake\n```\nrest", "x\n## transition\na\n## transition\nb", "# a\n## 转换记录x\nb", "##\n转换记录\nz", "## \u00a0转换记录\nz", "## \ufeff转换记录\nz",
    "####### 七级 转换记录\nz", "## 状态\u200b转换记录\nz", "##### 转换记录\n- 2026-09-01\n##### 下一\n", "# Ａ转换记录\nz",
]

# --- _last_transition：显式字段、小节里最后一条记录的第一个日期、失败类别
LT_TEXTS = [
    "", "last_transition_at: 2026-09-01\n", "state_changed_at: 2026-09-02\n", "最后状态转换时间：2026-09-03\n", "状态更新时间: 2026-09-04\n", "last_transition_at: 2026-02-30\n", "last_transition_at: bad\n",
    "last_transition_at:\n", "last_transition_at: **2026-09-05**\n", "last_transition_at: `2026-09-06`\n", "last_transition_at: 2026-09-07T10:00:00Z\n", "LAST_TRANSITION_AT: 2026-09-08\n",
    "## 状态转换记录\n| from → to | 时间 |\n|---|---|\n| a → b | 2026-09-01 |\n| b → c | 2026-09-02 |\n", "## 状态转换记录\n- 2026-09-01 a→b\n- 2026-09-05 b→c\n",
    "## 状态转换记录\n* 2026-09-01\n+ 2026-09-03\n", "## 状态转换记录\n| a | 2026-09-01 | 2026-09-09 |\n", "## 状态转换记录\n|---|---|\n| x | y |\n", "## 状态转换记录\n（无）\n",
    "## 状态转换记录\n\n| a | 2026-09-01 |\n\n备注：计划 2026-10-01 前完成\n", "## 状态转换记录\n| a | 2026-09-01 |\n\n- 备注 2026-12-01\n", "## 状态转换记录\n| a | 2026-09-01 |\n\n| 计划 | 2026-12-01 |\n",
    "## 状态转换记录\n-2026-09-01\n", "## 状态转换记录\n- 无日期\n- 2026-09-10\n", "## 状态转换记录\n  | a | 2026-09-01 |\n", "## 状态转换记录\n\t| a | 2026-09-01 |\n", "## 状态转换记录\n\u3000| a | 2026-09-01 |\n",
    "## 状态转换记录\n| a | ２０２６-０９-０１ |\n", "## 状态转换记录\n| a | ２０２６-０９-０１ | 2026-09-02 |\n", "## 状态转换记录\n| a | ٢٠٢٦-٠٩-٠١ |\n","## 状态转换记录\n| a | 2026-09-01x |\n", "## 状态转换记录\n| a | x2026-09-01 |\n", "## 状态转换记录\n| a | 12026-09-011 |\n", "## 状态转换记录\n| a | 2026-13-01 | 2026-09-02 |\n",
    "## 状态转换记录\n| a | 2026-02-30 | 2026-09-02 |\n", "## 状态转换记录\n-\t2026-09-01\n", "## 状态转换记录\n-\u00a02026-09-01\n", "## 状态转换记录\n- \u00a02026-09-01\n", "## 状态转换记录\n*\x0b2026-09-01\n",
    "## 状态转换记录\n+ 2026-09-01\n2026-09-05\n", "## 状态转换记录\n日期 2026-09-01\n", "## 状态转换记录\n| 2026-09-01 | 2026-09-03 |\n| 2026-09-02 |\n", "## Transition\n- 2026-09-01\n## Other\n- 2026-09-30\n",
    "状态转换记录\n无标题标记\n- 2026-09-01\n", "# 状态转换\n- 2026-09-01\n", "# 转换记录\n- 2026-09-01\r\n- 2026-09-02\r\n", "# 转换记录\n- 2026-09-01\r- 2026-09-02\r", "# 转换记录\n- 2026-09-01\u2028- 2026-09-02\u2029",
    "last_transition_at: 2026-09-01\n## 状态转换记录\n- 2026-09-09\n", "## 状态转换记录\n- 2026-09-01\nlast_transition_at: 2026-09-09\n",
]

# --- _age：晚一天按当天算
AGE_PAIRS = [(0, 0), (1, 0), (-1, 0), (-2, 0), (5, 0), (-100, 0), (365, 0)]

# --- _int_budget：布尔不是整数、浮点不是、字符串不是、0 与负数不是
# 不放 `90.0`：JSON 里 90.0 与 90 同形，JS 里是同一个 number，intBudget 无从区分 int 与 float；真实入口由 core/config 的 NumKinds 在读配置时按原文字面拒收这种写法
BUDGETS = [None, 90, 1, 0, -1, True, False, 1.5, 0.5, "90", "", [], [90], {}, {"a": 1}, 10 ** 12]

# --- _metadata_requirement：required / convention / not_required / declared_none / unknown
MR_CFGS = [
    ({}, "docs/x.md"), ({}, "docs/architecture/a.md"), ({}, "docs/acceptance/a.md"), ({}, "docs/modules/m.md"), ({}, "docs/contracts/c.md"), ({}, "docs/decisions/d.md"), ({}, "docs/runbooks/r.md"),
    ({}, "architecture/a.md"), ({}, "a/architecture"), ({}, "a/architecture/b/c.md"), ({}, "docs/Architecture/a.md"), ({}, "docs/架构/a.md"), ({}, "docs\\architecture\\a.md"), ({}, "architecture"),
    ({"metadata_required": []}, "docs/x.md"), ({"metadata_required": ["docs/architecture"]}, "docs/architecture/a.md"), ({"metadata_required": ["docs/architecture"]}, "docs/x.md"),
    ({"metadata_required": ["docs", "!docs/x.md"]}, "docs/x.md"), ({"metadata_required": ["docs", "!docs/x.md"]}, "docs/y.md"), ({"metadata_required": "docs"}, "docs/x.md"),
    ({"metadata_required": None}, "docs/x.md"), ({"metadata_required": ["docs/architecture"]}, "docs/architecture"), ({"metadata_required": ["./docs"]}, "docs/x.md"),
    ({"metadata_required": ["docs/a"]}, "docs/ab/x.md"), ({"metadata_required": ["docs/a/"]}, "docs/a/x.md"), ({"metadata_required": ["docs"]}, "docs"),
]


def main():
    out = {"python": sys.version.split()[0]}
    out["section"] = [{"in": t, "out": cf._section_body(t, KW)} for t in SECTION_TEXTS]
    out["section_other_kw"] = [{"in": t, "kw": list(k), "out": cf._section_body(t, k)} for t in SECTION_TEXTS[:12] for k in (("转换",), ("TRANSITION",), ("a", "b"), ())]

    def lt(t):
        d, how, err = cf._last_transition(t)
        return {"date": None if d is None else d.isoformat(), "how": how, "err": None if err is None else list(err)}
    out["last_transition"] = [dict(lt(t), **{"in": t}) for t in LT_TEXTS]
    today = datetime.date(2026, 10, 6)
    out["age"] = [{"delta": d, "out": cf._age(today, today - datetime.timedelta(days=d))} for d, _ in AGE_PAIRS] + \
                 [{"delta": -d, "out": cf._age(today, today + datetime.timedelta(days=d))} for d in (1, 2, 3, 100)]
    out["int_budget"] = [{"in": b, "out": list(cf._int_budget({"budgets": {"x": b}} if b is not None else {}, "budgets.x", 90))} for b in BUDGETS]
    out["note"] = [{"used_default": u, "name": "budgets.stale_days", "value": v, "out": cf._note(u, "budgets.stale_days", v)} for u in (True, False) for v in (90, 14)]
    out["metadata_requirement"] = [{"cfg": c, "rel": r, "out": cf._metadata_requirement(c, r)} for c, r in MR_CFGS]
    path = os.path.join(HERE, "unit", "freshness.json")
    tmpf = path + ".tmp"
    with open(tmpf, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    back = json.load(open(tmpf, encoding="utf-8"))
    if {k: len(v) for k, v in back.items() if isinstance(v, list)} != {k: len(v) for k, v in out.items() if isinstance(v, list)}:
        sys.exit("回读与内存不一致，拒绝落盘")
    os.replace(tmpf, path)
    print("写出 golden/unit/freshness.json：" + "、".join("%s %d" % (k, len(v)) for k, v in out.items() if isinstance(v, list)))


if __name__ == "__main__":
    main()
