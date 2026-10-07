#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""evidence 检查器私有纯函数的单元黄金样本：`_label_field`、`_unknown_label`、`_is_sep`、`_split_row`、`_map_header`、`_is_placeholder`、`_evidence_sections`、
`_parse_list_blocks`、`_parse_table_blocks`、`str.isdigit()` 的全码点集合。
真实仓只有 reservoir 与 cms 里出现了 evidence 的 PASS 条目（都是整齐的六字段写法），**边界写法（全角、围栏、表格、认不出的标签、各种空白）一个真实输入都没有**，
判据靠 selftest 与这里的样本守护。写之前对每个 Python 字符串、正则、容器操作问过「JS 里对应的在非 ASCII、非 BMP、边界值上等价吗」（设计 §12.22）。
用法：python golden/make_unit_evidence.py
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STD = os.path.join(os.path.dirname(HERE), "tools", "std")
sys.path.insert(0, STD)
spec = importlib.util.spec_from_file_location("check_evidence", os.path.join(STD, "checks", "check_evidence.py"))
ce = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ce)

E = "\U0001f600"

LABEL_LINES = [
    "断言：x", "  断言: x", "1. 断言：x", "**断言**：x", "|断言|：x", "x断言：x", "ASSERTION: y", "Assertion：y", "ＡＳＳＥＲＴＩＯＮ: y", "٣断言：x", "１断言：x", "\u3000断言：x", "\u00a0断言：x", "\u2028断言：x",
    "a\nb: x", "断言：", "断言：   ", "断言 ：x", "断言 : x", "断言\t:x", "evidence: a", "EVIDENCE: a", "Evidence：a", "time: 3s", "TIME：3s", "ｔｉｍｅ: 3", "İ断言：x", "head: abc", "HEAD：abc",
    "ſcope: x", "ſ: x", "scope: x", "ＫELVIN", "\u212aéy: x", "(断言: x)", "（断言：x）", ".断言：x", "、断言：x", ">断言：x", "\\断言：x", "_断言：x", "-断言：x", ":断言：x", "断言断言：x", "my断言：x",
    "原始证据：`a.txt`", "raw evidence: x", "RAW_EVIDENCE: x", "raw_evidence: x", "observed at: 12", "Observed_At: 12", "observed_at：12", "workspace: w", "工作区身份：id", "版本与工作区身份：v",
    "断言：a\u2028b", "scope: " + E * 3, E + "断言: x", "断言: " + E, "limitations：none", "限制: x", "Limitation: y",
    # 值两端的空白（pyStrip 与 JS trim 的差异：U+FEFF 不是 Python 空白，U+001C 与 U+0085 是）
    "断言：  x  ", "断言：\u3000x\u3000", "断言：\ufeffx", "断言：x\x1c", "断言：\u00a0x\u00a0", "断言：\x85x", "断言：\ufeff", "断言：\x1c", "断言：x\ufeff", "断言：\x1cx\x1c",
    "断言：a\x0bb", "断言：a\x0cb", "断言：a\x1cb", "断言：a\x85b", "断言：a\u2029b", "断言：a\rb", "断言：a\x00b",
    "断言：a  原始证据：b", "时间：1 版本：2", "版本：2 时间：1", "scope: x; time: y", "1. 断言：a 2. 版本：b", "断言：断言：x", "evidence: raw evidence: y", "证据：x", "原始证据：x", "输出：x",
    "x断言：1", " 断言：1", "|断言：1", "*断言：1", ">断言：1", "(断言：1", "（断言：1", "）断言：1", ")断言：1", ".断言：1", "、断言：1", "1断言：1", "٣断言：1", "_断言：1", "-断言：1", "`断言：1", ":断言：1", "：断言：1",
    "/断言：1", "#断言：1", '"断言：1', "'断言：1", "「断言：1", "【断言：1", "\u200b断言：1", "\ufeff断言：1", "\u2003断言：1", "\x1c断言：1", "\x85断言：1",
    "raw  evidence: x", "RAW EVIDENCE: x", "observed at: x", "observed-at: x", "Observed At: x", "scope：", "范围:  ", "环境: x", "ENV: y", "env：z", "environment: e", "claim: c", "acceptance: a", "主张：m",
    "确认方式：x", "procedure: p", "CHECKER: c", "method：m", "方法：m", "时刻：t", "观察时间：t", "分支：b", "commit: c", "version: v", "revision: r", "artifact: a", "输出: o",
    # re.I 把 İ(U+0130)、ı(U+0131) 当 i：同义词里含 i 的每一个词（变异验证发现此前没有样本触发 foldRegexSource 的 İı 分支）
    "ASSERTİON: x", "assertıon: x", "acceptance: x", "lımitatıon: x", "LİMİTATİON: x", "revİsion: x", "verSİon: x", "proceDure: x", "enVİronment: x", "obsErved: x", "ENV: y", "observed_at: x", "workspace: w",
    "versıon: v", "VERSİON：v", "commıt: c", "COMMİT: c", "claım: c", "CLAİM：c", "ıtem: x", "head: h", "HEAD: h", "enV: e", "ENvıronment: e",
]

UNKNOWN_LINES = [
    "6. 核验手段：人工抽查", "核验手段：x", "- 核验手段: x", "* 核验手段：x", "**核验手段**：x", "`核验手段`: x", "核验手段：", "核验手段：  ", "注意：x", "备注：x", "Note: x", "NOTE: x", "ps: x", "tip: x", "warning: x", "TODO: x",
    "12:30 x", "12：30 x", "1234567890123：x", "123456789012：x", "abcdefghijkl: x", "abcdefghijklm: x", E * 12 + ": x", E * 13 + ": x", "漢" * 12 + "：x", "漢" * 13 + "：x",
    "https://x/y", "url: https://x", "a: //x", "a://x", "a:// x", "1) 核验：x", "1、核验：x", "1）核验：x", "1.核验：x", "1. 核验：x", "１. 核验：x", "٣. 核验：x", "１２：３０ x",
    "a b: x", "a/b: x", "a|b: x", "a*b: x", "a_b: x", "a`b: x", "_a_: x", "__a__: x", "***a***: x", "`a`: x", "**a**:x", "**a**：x ", "a:x", "a：x",
    "核验手段：\u3000", "核验手段：\u00a0x", "核验手段：\u200bx", "核验手段：\ufeffx", "核验\u3000手段：x", "核验\u00a0手段：x", "核验\u200b手段：x",
    "²: x", "²²：x", "①: x", "①②：x", "٣: x", "٣٤: x", "१२३: x", "12a: x", "a12: x", "1²: x", "²1: x", "½: x", "Ⅳ: x", "⑩: x", "⒈: x", "🄀: x", "①a: x", "²a: x", "٣a: x",
    "NOTES: x", "Notes：x", "TIP：x", "PS: x", "说明：x", "注：x", "附注：x", "提示：x", "Warning: x", "todo: x",
    "- 12:30 x", "* 12：30 x", "1. 12:30 x", "1. ²：x", "- ①: x", "（注意）：x", "[注意]: x", "注意 ：x",
    # 列表记号、编号记号、前导空白的各种写法（变异验证发现此前没有样本触发这些分支）
    "-核验：x", "*核验：x", "1、核验：x", "1）核验：x", "1)核验：x", "  核验：x", "\t核验：x", "\u3000核验：x", "+核验：x", "+ 核验：x", "1.核验：x", "12、核验：x", "٣、核验：x", "²、核验：x",
]

BLOCK_TEXTS = {
    "six": ce._SIX, "five": ce._FIVE,
    "bold_dash": "- **E-01**\n1. 断言：a\n2. 原始证据：b\n",
    "sub": "### E-01\n1. 断言：a\n#### 附件\n见 artifacts\n### 备注\n说明\n",
    "sub_unknown": "### E-02\n核验手段：人工\n",
    "table": "| 编号 | 断言 | 原始证据 | 版本 | 范围 | 时间 | 方法 |\n|---|---|---|---|---|---|---|\n| E-1 | a | b | c | d | e | f |\n| | x | TBD | c | d | e | f |\n",
    "table_note": "| 编号 | 断言 | 原始证据 | 版本 | 范围 | 时间 | 备注 |\n|---|---|---|---|---|---|---|\n| E-1 | a | b | c | d | e | f |\n",
    "table_limit": "| 断言 | 原始证据 | 版本 | 限制 | 时间 | 方法 |\n|---|---|---|---|---|---|\n| a | b | c | | e | f |\n",
    "table_id_col": "| acceptance_id | 断言 | 原始证据 | 版本 | 范围 | 时间 | 方法 | run_id |\n|---|---|---|---|---|---|---|---|\n| A-1 | a | b | c | d | e | f | 7 |\n",
    "whole": "断言：a\n原始证据：b\n版本：c\n范围：d\n时间：e\n方法：f\n",
    "whole_empty": "一段说明，没有字段。\n",
    "scope_limit": "**E-1**\n1. 断言：a\n2. 证据：b\n3. 版本：c\n4. 限制：\n5. 时间：e\n6. 方法：f\n",
    "two_scope": "**E-1**\n1. 断言：a\n2. 证据：b\n3. 版本：c\n4. 范围：s\n5. 限制：\n6. 时间：e\n7. 方法：f\n",
    "dup_field": "**E-1**\n1. 断言：a\n2. 断言：b\n",
    "table_dup_col": "| 断言 | 证据 | 原始证据 | 版本 | 范围 | 时间 | 方法 |\n|---|---|---|---|---|---|---|\n| a | TBD | real | c | d | e | f |\n",
    "table_short_row": "| 断言 | 原始证据 | 版本 | 范围 | 时间 | 方法 |\n|---|---|---|---|---|---|\n| a | b |\n",
    "table_blank_after": "| 断言 | 原始证据 | 版本 | 范围 | 时间 | 方法 |\n|---|---|---|---|---|---|\n| a | b | c | d | e | f |\n\n| x | y |\n",
    "table_empty_first": "| 编号 | 断言 | 原始证据 | 版本 | 范围 | 时间 | 方法 |\n|---|---|---|---|---|---|---|\n|  | 导入一致 | TBD | c | d | e | f |\n",
    "table_two": "| 断言 | 原始证据 | 版本 | 范围 | 时间 | 方法 |\n|---|---|---|---|---|---|\n| a | b | c | d | e | f |\n文字\n| 断言 | 原始证据 | 版本 | 范围 | 时间 | 方法 |\n|---|---|---|---|---|---|\n| g | h | i | j | k | l |\n",
    "table_two_cols_only": "| 断言 | 原始证据 |\n|---|---|\n| a | b |\n",
    "emoji_name": "**" + E + "**\n1. 断言：a\n", "bold_space": "** **\n1. 断言：a\n",
    "bold_nested": "**a*b**\n1. 断言：x\n", "bold_empty": "****\n1. 断言：x\n", "bold_unclosed": "**E-01\n1. 断言：x\n",
    "sub_levels": "### a\n断言：1\n###### b\n断言：2\n####### c\n断言：3\n## d\n断言：4\n",
    "sub_tab": "###\ta\n断言：1\n###\u3000b\n断言：2\n###c\n断言：3\n",
    "sub_empty_name": "### \n断言：1\n###\n断言：2\n",
    "sub_trailing": "### a  \n断言：1\n",
    "list_pipe_lines": "**E-1**\n| 断言：a |\n1. 断言：b\n",
    "list_indented_pipe": "**E-1**\n   | x |\n1. 断言：b\n",
    "head_with_field": "**断言**：a\n1. 原始证据：b\n",
    "head_bold_label": "**E-1**：x\n1. 断言：a\n",
    "unknown_count": "**E-1**\n1. 核验手段：a\n2. 自造项：b\n3. 断言：c\n",
    "note_words": "**E-1**\n注意：x\n备注：y\n1. 断言：c\n",
    "limit_in_label": "**E-1**\n1. 断言：a\n2. Limitations: none\n",
    "limit_cn": "**E-1**\n1. 断言：a\n2. 限制：无\n3. 范围：全\n",
    "scope_then_limit": "**E-1**\n1. 范围：全\n2. 限制：\n",
    "bold_name_trim": "**  E-1  **\n1. 断言：a\n", "bold_name_star_in": "**`E-1`**\n1. 断言：a\n",
    # —— 变异验证第一轮没抓住的盲区：此前样本里没有对应输入，实现分支没有被任何样本触发 ——
    "bold_plus": "+ **E-1**\n1. 断言：a\n", "bold_nospace": "-**E-1**\n1. 断言：a\n", "bold_star_tab": "*\t**E-1**\n1. 断言：a\n", "bold_plus_nospace": "+**E-1**\n1. 断言：a\n",
    "sub_indented": "  ### E-1\n1. 断言：a\n", "sub_tab_indent": "\t### E-1\n1. 断言：a\n", "sub_ideo_indent": "\u3000### E-1\n1. 断言：a\n",
    "sub_with_label": "### 断言：a\n原始证据：b\n", "bold_with_label": "**断言**：a\n原始证据：b\n", "sub_bold": "### **E-1**\n1. 断言：a\n",
    "indented_pipe": "**E-1**\n  | 断言：x |\n1. 断言：b\n", "limit_in_identity": "**E-1**\n1. 断言：a\n2. 版本：c（无限制）\n3. 范围：\n", "limit_in_method": "**E-1**\n1. 范围：s\n2. 方法：limitation test\n",
    "bold_no_fields": "**E-1**\n只有文字\n", "whole_unknown": "断言：a\n核验手段：x\n", "whole_limit": "断言：a\n限制：\n",
    "table_3kinds": "| 断言 | 原始证据 | 版本 |\n|---|---|---|\n| a | b | c |\n", "table_3cols_2kinds": "| 断言 | 断言2 | 原始证据 |\n|---|---|---|\n| a | b | c |\n",
    "table_no_pipe_head": "断言 原始证据 版本\n|---|---|---|\n| a | b | c |\n", "table_no_sep": "| 断言 | 原始证据 | 版本 |\n| a | b | c |\n",
    "table_empty_head_col": "| 编号 | 断言 | 原始证据 | 版本 | | 范围 | 时间 | 方法 |\n|---|---|---|---|---|---|---|---|\n| E | a | b | c | x | d | e | f |\n",
    "table_upper_note": "| 编号 | 断言 | 原始证据 | 版本 | 范围 | 时间 | NOTE |\n|---|---|---|---|---|---|---|\n| E | a | b | c | d | e | f |\n",
    "table_blank_between": "| 断言 | 原始证据 | 版本 | 范围 | 时间 | 方法 |\n|---|---|---|---|---|---|\n| a | b | c | d | e | f |\n\n| g | h | i | j | k | l |\n",
    "table_adjacent": "| 断言 | 原始证据 | 版本 | 范围 | 时间 | 方法 |\n|---|---|---|---|---|---|\n| a | b | c | d | e | f |\n| 断言 | 原始证据 | 版本 | 范围 | 时间 | 方法 |\n|---|---|---|---|---|---|\n| g | h | i | j | k | l |\n",
    "table_all_empty_row": "| 断言 | 原始证据 | 版本 | 范围 | 时间 | 方法 |\n|---|---|---|---|---|---|\n| | | | | | |\n",
    "table_name_padded": "| 编号 | 断言 | 原始证据 | 版本 | 范围 | 时间 | 方法 |\n|---|---|---|---|---|---|---|\n|   E-9   | a | b | c | d | e | f |\n",
    "table_limit_upper": "| 断言 | 原始证据 | 版本 | Limitation | 时间 | 方法 |\n|---|---|---|---|---|---|\n| a | b | c | | e | f |\n",
    "table_scope_and_limit_empty": "| 断言 | 原始证据 | 版本 | 范围 | 限制 | 时间 | 方法 |\n|---|---|---|---|---|---|---|\n| a | b | c | | | e | f |\n",
    "table_missing_method_limit_empty": "| 断言 | 原始证据 | 版本 | 范围 | 限制 | 时间 |\n|---|---|---|---|---|---|\n| a | b | c | s | | e |\n",
    "list_placeholder_missing": "**E-1**\n1. 断言：TBD\n2. 原始证据：b\n3. 版本：c\n4. 范围：d\n", "list_placeholder_only": "**E-1**\n1. 断言：TBD\n",
    "two_limits": "**E-1**\n1. 限制：\n2. 范围：s\n", "unknown_vs_missing": "**E-1**\n1. 断言：a\n2. 原始证据：b\n3. 版本：c\n4. 范围：d\n5. 自造项：x\n",
    "unknown_three": "**E-1**\n1. 断言：a\n2. 原始证据：b\n3. 版本：c\n4. 范围：d\n5. 时间：e\n6. 甲项：x\n7. 乙项：y\n8. 丙项：z\n",
}

# 证据段解析的整篇文本（含围栏、标题层级、BOM、行终止符）
SECTION_TEXTS = [
    "# T\n## 验收证据\n**E-1**\n1. 断言：a\n", "## Evidence\nx\n", "## EVIDENCE\nx\n", "## 证据\nx\n## 附注\ny\n", "## 证 据\nx\n", "## ｅｖｉｄｅｎｃｅ\nx\n", "## İevidence\nx\n", "## evİdence\nx\n",
    "### 证据\n#### 子\nx\n### 下一个\ny\n", "## 证据\n### E-1\n断言：a\n## 附注\n**E-2**\n", "## 证据\n```\n# 代码里的标题\n```\n断言：a\n", "## 证据\n````md\n```\n# x\n```\n````\n断言：a\n",
    "## 证据\n~~~\n# x\n~~~\n断言：a\n", "## 证据\n```\n# 未闭合\n断言：a\n", "```\n## 证据\n```\n断言：a\n", "## 证据\n  ```\n# x\n  ```\n断言：a\n", "## 证据\n\u3000```\n# x\n\u3000```\n断言：a\n",
    "## 证据\n```\n# x\n``` \n断言：a\n", "## 证据\n```\n# x\n```x\n断言：a\n", "## 证据\n```\n# x\n```\u3000\n断言：a\n", "## 证据\n```\n# x\n```\u200b\n断言：a\n", "## 证据\n~~~\n# x\n```\n~~~\n断言：a\n",
    "## 证据\n```python\n# x\n```\n断言：a\n", "## 证据\n`` `\n# x\n", "## 证据\n``\n# x\n", "\ufeff## 证据\nx\n", "\u3000## 证据\nx\n", "\t## 证据\nx\n", "##证据\nx\n", "#证据\nx\n", "# 证据\n## 子\nx\n# 另一\ny\n",
    "## 证据 ##\nx\n", "## 验收证据与说明\nx\n", "## 不是\n## 证据\nx\n", "## 证据\n## 证据\ny\n", "## 证据\nx\r\ny\rz\n", "## 证据\nx\u2028y\x0cz\n", "x\n## 证据", "## 证据", "", "\n\n## 证据\n\n",
    "## 证据\n#### 四级\n证据行\n## 同级\n", "###### 证据\nx\n", "####### 证据\nx\n", "# a\n## 证据\n# b\n## 证据\n", "## 证据\n#\n##\nx\n",
]

SEP_LINES = [
    "|---|---|", "|:-:|:--|", "| - | - |", "|---", "---", "|", "| |", "|a|", "||", "|-|", "- - -", "|\u3000---|", "|\u00a0---|", "|\u200b---|", "|---|\t", "|---|\r", "|---|\x0b", "|---|\x1c", "|--- ---|",
    "\ufeff|---|", "|:|", "|::|", "|-:|", "|x-|", "| --- | --- |", "|---|---|---|", ":---|", "---|", "|-", "-|", "|- -|", "|\t-\t|", " |---| ", "\t|---|\t", "|---|\u2028", "|---|\x85", "|---|\xa0",
    "|" * 50 + "-", "-" * 50 + "|", "|" + "-" * 50, "| " * 20 + "-", "-|" * 30, "|:" * 5 + "-",
]

SPLIT_LINES = [
    "| a | b |", "|a|b|", "a|b", "| a |", "|", "||", "| | |", "| a | b", "a | b |", "|\u3000a\u3000|\u00a0b\u00a0|", "| a \\| b |", "| | a |", " | a | b | ", "|a|b|\u2028", "|a|b|\r", "|  |", "| a ||",
    "||a||", "|a|b|c|d|", "a", "", " ", "\u3000|a|\u3000", "\ufeff|a|", "|a|\ufeff", "| 中 | 文 |", "|" + E + "|" + E + "|", "| a | b |\t", "|\ta\t|",
]

HEADER_ROWS = [
    ["编号", "断言", "原始证据", "版本", "范围", "时间", "方法"], ["acceptance_id", "断言", "原始证据"], ["run_id", "断言"], ["Acceptance_ID", "x"], ["断言_id", "x"], ["acceptance", "x"], ["", "断言"], ["  ", "断言"],
    ["**断言**", "`原始证据`"], ["ASSERTION", "Evidence", "REVISION", "Scope", "Time", "Method"], ["limitation", "限制", "适用范围"], ["环境", "environment"], ["date", "observed", "时间"], ["checker", "procedure", "确认"],
    ["head", "commit", "分支", "工作区", "版本"], ["输出", "artifact", "raw"], ["claim", "主张"], ["a断言b", "x原始证据y"], ["ＡＳＳＥＲＴＩＯＮ"], ["ı", "İ"], ["Method_ID", "方法"], ["_id", "断言"], ["x_ID", "x"],
    ["限制（④）", "范围（④）"], ["acceptance_id_x", "断言"], ["断言 ", " 原始证据"], ["断言\u3000", "\u3000原始证据"], ["断\u200b言"], ["observed_at", "时间"], ["time_id", "method_id"], ["备注", "说明"],
]

PLACEHOLDER_VALUES = [
    "", " ", "tbd", "TBD", "Tbd", "TODO", "待补", "待 补", "待\u3000补", "N/A", "n/a", "N.A.", "n a", "-", "--", "—", "——", "- -", "?", "？", "...", "。", "xxx", "XXX", "略", "略\u200b", "\u3000", "\u00a0", "T B D", "ｔｂｄ",
    "`tbd`", "**待补**", "*待补*", "_tbd_", "`", "``", "na", "NA", "N / A", "n/ a", "待定", "待确认", "待填", "无", "none", "0", "false", "null", "—\u200b", "\x1ctbd", "tbd\x85", "t\tbd", "t\nbd",
    "待补充", "待补 ", " 待补", "**", "****", "` `", "* *", "...  ", ". . .", "。。", "?? ", "? ?", "ＴＢＤ", "ToDo", "tODO", "İ", "ı",
]

def main():
    out = {"python": sys.version.split()[0]}
    out["label_field"] = [{"in": s, "out": list(ce._label_field(s))} for s in LABEL_LINES]
    out["unknown_label"] = [{"in": s, "out": ce._unknown_label(s)} for s in UNKNOWN_LINES]
    out["is_sep"] = [{"in": s, "out": ce._is_sep(s)} for s in SEP_LINES]
    out["split_row"] = [{"in": s, "out": ce._split_row(s)} for s in SPLIT_LINES]
    out["map_header"] = [{"in": h, "out": sorted([k, v] for k, v in ce._map_header(h).items())} for h in HEADER_ROWS]
    out["is_placeholder"] = [{"in": s, "out": ce._is_placeholder(s)} for s in PLACEHOLDER_VALUES]
    out["sections"] = [{"in": t, "out": [[title, start, [[n, ln] for n, ln in rows]] for title, start, rows in ce._evidence_sections(t)]} for t in SECTION_TEXTS]

    def norm(b):
        return {"name": b["name"], "line": b["line"], "fields": b["fields"], "limit_cols": b["limit_cols"], "kind": b["kind"], "unknown": b["unknown"], "sub": b.get("sub")}
    blocks = []
    for k, t in BLOCK_TEXTS.items():
        rows = [(i + 1, ln) for i, ln in enumerate(t.splitlines())]
        tb = ce._parse_table_blocks(rows)
        lb = ce._parse_list_blocks(rows, whole=not tb)
        blocks.append({"name": k, "text": t, "table": [norm(b) for b in tb], "list": [norm(b) for b in lb]})
    out["blocks"] = blocks
    # judge：对每个块再算一遍 _judge
    out["judge"] = [{"name": b["name"], "table": [list(ce._judge(x)) for x in [dict(y) for y in b["table"]]], "list": [list(ce._judge(x)) for x in [dict(y) for y in b["list"]]]} for b in blocks]
    # str.isdigit() 的全码点集合（区间）
    isd = [c for c in range(0x110000) if chr(c).isdigit()]
    rng, s, p = [], None, None
    for x in isd:
        if s is None: s = p = x
        elif x == p + 1: p = x
        else: rng.append([s, p]); s = p = x
    if s is not None: rng.append([s, p])
    out["isdigit_ranges"] = rng
    path = os.path.join(HERE, "unit", "evidence.json")
    tmpf = path + ".tmp"
    with open(tmpf, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    back = json.load(open(tmpf, encoding="utf-8"))
    if {k: len(v) for k, v in back.items() if isinstance(v, list)} != {k: len(v) for k, v in out.items() if isinstance(v, list)}:
        sys.exit("回读与内存不一致，拒绝落盘")
    os.replace(tmpf, path)
    print("写出 golden/unit/evidence.json：" + "、".join("%s %d" % (k, len(v)) for k, v in out.items() if isinstance(v, list)))


if __name__ == "__main__":
    main()
