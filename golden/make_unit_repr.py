#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""`%r`（`repr()`）的单元黄金样本：字符串（引号选择、转义、非 ASCII 可打印与否、控制字符、代理区）、整数、浮点、布尔、None、列表、字典、嵌套。

TS 里原有六份各自的 `pyRepr`，实现互不一致；统一成一份，对这份样本逐条比对。
用法：python golden/make_unit_repr.py
"""
import json
import os
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))

STRS = [
    "", "a", "abc def", "it's", 'say "hi"', "it's \"x\"", "a\\b", "a\nb", "a\rb", "a\tb", "a\x00b", "a\x07b", "a\x1bb", "a\x7fb", "a\x80b", "a\x85b", "a\x9fb", "a\xa0b", "a\xadb",
    "中文", "日本語", "한국어", "é", "e\u0301", "ß", "İ", "\u200b", "\u200e", "\u2028", "\u2029", "\u3000", "\ufeff", "\ufffd", "\U0001f600", "\U0001f4a9x", "\U000e0001", "\U0010ffff",
    "\u0378", "\u0530", "\ud7ff", "\ue000", "\uf8ff", "\uffff", "\U00010000", "\U0001d7ce", "\u2060", "\u00ab\u00bb", "\u2018\u2019", "\u201c\u201d", "a'b\"c", "'", '"', "''", '""', "\\", "\\\\", "\\'", "'\\",
    "tab\there", "nl\nthere", "\n", "\t", " ", "  ", "\x1f", "\x1c", "\x1d", "\x1e",
]
# 整数只到 2**53（D3：JS 的安全整数；超出的 YAML 整数 load_config 本就不会产出）。浮点只取 YAML 解析器能产出的形态（`-?\d+\.\d+`，无指数、无 inf/nan），
# 且 JS 里 1.0 与 1 是同一个 number，无法区分 int 与 float——所以浮点只放非整数值，整数值的 float 不放（pyStr 对整数值的 number 一律当 int）。
OTHERS = [0, 1, -1, 90, 14, 10 ** 12, 2 ** 53, 1.5, 0.1, 3.14159, 123456789.123, 0.5, 100.25, True, False, None]
LISTS = [[], [1, 2], ["a", "b"], ["it's", 'q"'], [None, True, 1.5], [[1], ["x"]], [{"a": 1}], ["中", "\n"]]
DICTS = [{}, {"a": 1}, {"a": "b", "c": [1, 2]}, {"k'": 'v"'}, {"a": None}, {"中": "文"}, {"a": {"b": {"c": 1}}}]


def main():
    out = {"python": sys.version.split()[0], "unidata": unicodedata.unidata_version, "str": [], "other": []}
    for s in STRS:
        out["str"].append({"in": s, "out": repr(s)})
    for v in OTHERS + LISTS + DICTS:
        out["other"].append({"in": v, "out": repr(v), "kind": type(v).__name__ if not isinstance(v, bool) else "bool"})
    # 逐码点：Python 的 repr 对哪些码点转义（str.isprintable() 为假）？——给 TS 的 isprintable 近似做全量对照
    # 存成闭区间列表而不是 96 万个码点（逐码点存是 9.7 MB，不该入库）
    ranges, start, prev = [], None, None
    for cp in range(0x110000):
        if 0xD800 <= cp <= 0xDFFF:
            continue
        if not chr(cp).isprintable():
            if start is None:
                start = cp
            prev = cp
        elif start is not None:
            ranges.append([start, prev])
            start = None
    if start is not None:
        ranges.append([start, prev])
    out["nonprintable_ranges"] = ranges
    out["nonprintable_count"] = sum(b - a + 1 for a, b in ranges)
    path = os.path.join(HERE, "unit", "repr.json")
    tmpf = path + ".tmp"
    with open(tmpf, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    back = json.load(open(tmpf, encoding="utf-8"))
    if len(back["str"]) != len(out["str"]) or len(back["other"]) != len(out["other"]):
        sys.exit("回读与内存不一致，拒绝落盘")
    os.replace(tmpf, path)
    print("写出 golden/unit/repr.json：str %d、other %d；不可打印码点 %d 个（Unicode %s）" % (len(out["str"]), len(out["other"]), out["nonprintable_count"], out["unidata"]))


if __name__ == "__main__":
    main()
