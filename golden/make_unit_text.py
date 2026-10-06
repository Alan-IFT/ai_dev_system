#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""文本小工具的单元黄金样本：`str.splitlines()` / `str.splitlines(True)`（行终止符集合与 JS 的 `split('\\n')` 不同）与 `str.upper()` 在 tier 取值上的行为。

splitlines 在 7 个检查器里被用（行号、头部若干行、逐行扫描），行终止符集合错一个就是整批行号错位。
Python 的集合：\\n \\r \\r\\n \\v \\f \\x1c \\x1d \\x1e \\x85 \\u2028 \\u2029；不产生末尾空串；`\\r\\n` 算一个；连续终止符产生空行。
用法：python golden/make_unit_text.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

TERMS = ["\n", "\r", "\r\n", "\x0b", "\x0c", "\x1c", "\x1d", "\x1e", "\x85", "\u2028", "\u2029", "\n\r", "\r\r\n", "\n\n", "\r\n\r\n", "\r\n\n", "\n\r\n"]
TEXTS = [""]
for t in TERMS:
    TEXTS += [t, "a" + t, t + "a", "a" + t + "b", "a" + t + "b" + t, t + t, "a" + t + t + "b", "a" + t + "b" + t + "c"]
TEXTS += [
    "abc", "a b", "中文\n行二\n", "\ufeffa\nb", "a\u0085b\u0085", "a\x1fb", "a\x1b\x1fb", "a\u200bb", "a\u00a0b\nc", "\u3000\nx", "line\r\nline\r\nline",
    "a\nb\nc\nd\ne\nf", "a\n" * 50, "a\r\n" * 50, "a\n\n\n\nb", "\n\n\n", "\r\r\r", "\r\n\r\n\r\n", "x" * 1000, ("x" * 100 + "\n") * 10,
    "\U0001f600\n\U0001f600",
]
UPPER = ["l0", "l1", "l2", "l3", "L0", "L1", "L2", "L3", "l4", "l", "L", "", " l1 ", "\tL1\n", "\u3000L1\u3000", "\ufeffL1", "l 1", "l1x", "\u00df", "\ufb01", "\u0130", "\u0131",
         "\u01c6", "\u017f", "\u212a", "\uff2c\uff11", "L1\u00a0", "\u00a0L1", "\u2003L2\u2003", "\x1cL3\x1c", "\x85L0\x85", "i", "\u0069\u0307", "\u03c3", "\u03c2", "\u1e9e"]


def main():
    out = {"python": sys.version.split()[0], "splitlines": [], "upper": []}
    for t in TEXTS:
        out["splitlines"].append({"text": t, "lines": t.splitlines(), "keepends": t.splitlines(True)})
    for u in UPPER:
        s = str(u).strip().upper()
        out["upper"].append({"in": u, "out": s, "in_tiers": s in ["L0", "L1", "L2", "L3"]})
    path = os.path.join(HERE, "unit", "text.json")
    tmpf = path + ".tmp"
    with open(tmpf, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    back = json.load(open(tmpf, encoding="utf-8"))
    if {k: len(v) for k, v in back.items() if isinstance(v, list)} != {k: len(v) for k, v in out.items() if isinstance(v, list)}:
        sys.exit("回读与内存不一致，拒绝落盘")
    os.replace(tmpf, path)
    print("写出 golden/unit/text.json：splitlines %d、upper %d" % (len(out["splitlines"]), len(out["upper"])))


if __name__ == "__main__":
    main()
