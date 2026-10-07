#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""`core/cfg.ts` 的 pyStr 的单元黄金样本：Python 的 `str(x)` 对 YAML 能产生的各种值（标量、列表、映射、嵌套、空容器、含引号的字符串）。
为什么单独成样本：adoption 迁移时发现 pyStr 对映射用了 JSON.stringify（`{"d":3}`），Python 是 `{'d': 3}`——此前所有调用点传进来的都是标量或列表，没有暴露。
只放 JSON 往返不丢信息的值：整数值的浮点（`1.0`）、`-0.0`、指数形态的浮点在 JSON 里会变成整数或另一种写法，这类差异记在设计 D20，不在这里比。
用法：python golden/make_unit_pystr.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
E = "\U0001f600"
VALUES = [
    {"d": 3}, {"a": "x", "b": [1, {"c": None}]}, {}, [], [{"k": "v"}], "漢", None, True, False, 1.5, 0.1, 100, -3, 10 ** 20, "it's", 'say "hi"', "a'b\"c", "\n", "\x00", "\u2028", E,
    ["a", "it's"], {"k": "it's"}, {"k": 'say "hi"'}, [None, True, False, 1, 1.5], {"a": {"b": {"c": []}}}, {"x": {}}, [[]], [[], {}], "", " ", "0", "None", "True",
    {"policy": "两个版本"}, {"data": "两个版本", "api": None, "cfg": [1, 2], "client": {"min": "1.0"}}, {"k": E}, [E, "漢"], {"漢": "字"}, {"a": 1, "b": 2, "c": 3}, {"k": "a\\b"}, {"k": "a\nb"}, {"k": "tab\there"},
    ["x" * 5, {"y": ["z"]}], {"k": [{"a": [{"b": None}]}]}, [True, [False, [None]]], {"k": 0.5}, [0.5, -1.5, 2.25], {"k": -3}, {"k": "'"}, {"k": '"'}, {"k": "'\""}, ["'"], ['"'], ["'\""],
    "\x1b", {"k": "\x1b"}, {"k": "\u00a0"}, {"k": "\u200b"}, {"k": "\ufeff"}, {"k": "é"}, {"k": "\U0010ffff"},
]


def main():
    out = [{"in": v, "out": str(v)} for v in VALUES]
    path = os.path.join(HERE, "unit", "pystr.json")
    tmpf = path + ".tmp"
    with open(tmpf, "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"python": sys.version.split()[0], "cases": out}, fh, ensure_ascii=False, indent=1, sort_keys=False)
        fh.write("\n")
    back = json.load(open(tmpf, encoding="utf-8"))
    if len(back["cases"]) != len(out):
        sys.exit("回读与内存不一致，拒绝落盘")
    os.replace(tmpf, path)
    print("写出 golden/unit/pystr.json：%d 条" % len(out))


if __name__ == "__main__":
    main()
