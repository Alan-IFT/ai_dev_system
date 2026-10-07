#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""adoption 检查器私有纯函数的单元黄金样本：`_parse`（STANDARD_VERSION 拆版本值、采用日期、键值对）、`_compatibility`（compatibility.policy 判据）。
四个真实仓的 STANDARD_VERSION 都是整齐的实物形状，**边界写法（键写法、全角冒号、BOM、行终止符、中日文键、无冒号行、重复键）一个真实输入都没有**，判据靠 selftest 与这里的样本守护。
用法：python golden/make_unit_adoption.py
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STD = os.path.join(os.path.dirname(HERE), "tools", "std")
sys.path.insert(0, STD)
spec = importlib.util.spec_from_file_location("check_adoption", os.path.join(STD, "checks", "check_adoption.py"))
ca = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ca)

E = "\U0001f600"
TEXTS = [
    "1.0\nadopted_at: 2025-03-03\nlast_evaluated_upgrade: 2026-09-07 (no newer version)\n", "", "\n   \n", "adopted_at: 2025-03-03\n", "1.0\n", "# 注释\n1.0\n", "  1.0  \n", "version: 1.0\n", "VERSION: 2\n",
    "Standard_Version: 3\n", "标准版本: 4\n", "采用版本：5\n", "version:\n", "version: \n1.0\n", "version: 1\nversion: 2\n", "adopted_at: 2025\nadopted_at: 2026\n", "adopted: x\n", "adoption_date: y\n", "采用日期: z\n",
    "采用时间: w\n", "ADOPTED_AT: q\n", "a b: c\n", "a-b: c\n", "a.b: c\n", "1a: c\n", "_a: c\n", "a1: c\n", "漢字: c\n", "漢字x: c\n", "漢: c\n", "一: c\n", "\u9fff: c\n", "\u4e00: c\n", "\u3400: c\n",
    "\u9fa5: c\n", "\u9fd0: c\n", "\ua000: c\n", "x:y\n", "x : y\n", "x\t:\ty\n", "x:: y\n", "http://x\n", "1.0 # 行内注释\n", "#1.0\n", "\ufeff1.0\n", "1.0\r\n2.0\r\n", "1.0\r2.0\n", "1.0\u2028adopted_at: x\n",
    "1.0\x0cadopted_at: x\n", "1.0\x85adopted_at: x\n", "a" * 300 + "\n", "版" * 300 + "\n", E * 300 + "\n", "x: " + E * 10 + "\n", "1.0\nadopted_at: " + E + "\n", "\u30001.0\u3000\n", "\u00a01.0\n", "\x1c1.0\x1c\n",
    "\ufeffversion: 1\n", "version\u3000: 1\n", "version:\u3000\n", "version: 1.0\nadopted_at: 2025-03-03\n", "1.0\nversion: 2.0\n", "version: \nstandard_version: 3\n", "version: a\nstandard_version: b\n",
    "adopted_at:\nadopted: x\n", "adopted_at: x\n1.0\n", "# c\n\n\n1.0\n\n# d\nadopted_at: z\n", "x: 1\n1.0\n", "1.0\nx: 1\nversion: 2\n", "_: x\n", "__: x\n", "a: b: c\n", "a:b:c\n", "a ::c\n",
    "标准版本：4\n", "标准版本 : 4\n", "标准 版本: 4\n", "Version : 1\n", "version :1\n", "version\t:\t1\n", "version\n: 1\n", "key with spaces: v\n1.0\n", "漢字: v\n1.0\n", "1.0\n漢字: v\n", "ａ: b\n", "ａ: b\n1.0\n",
    "a" * 205 + "\nb\n", "；\n", "1.0；2.0\n", "x\u2029y\n", "x\u2028y: z\n",
]
# 不放整数值的浮点（0.0、1.0）：JSON 往返会把它变成整数，且 TS 的 YAML 解析器读 `0.0` 时就已经是 number 0，「它是浮点」这一信息无从还原——记在设计 D20，不在这里比
COMPAT = [None, False, True, 0, 1, "", "x", [], [1], {}, {"a": 1}, " ", "false", {"data": "两个版本"}, ["a", {"b": 1}], {"a": {"b": {}}}, "漢", E, {"k": [E]}, "it's", 'say "hi"', {"k": "it's"}, 1.5, 100]


def main():
    out = {"python": sys.version.split()[0]}
    cases = []
    for t in TEXTS:
        v, a, pairs = ca._parse(t)
        head = "；".join(ln.strip() for ln in t.splitlines() if ln.strip())[:200] or "（空文件）"
        cases.append({"in": t, "version": v, "adopted": a, "pairs": [list(p) for p in pairs], "head": head})
    out["parse"] = cases
    compat = []
    for v in COMPAT:
        cfg = {"compatibility": {"policy": v}}
        f = ca._compatibility(cfg)
        compat.append({"policy": v, "status": f["status"], "evidence": f["evidence"], "reason": f["reason"]})
    out["compat"] = compat
    # 其它形态：没有 compatibility 键、compatibility 不是映射、_path 的几种
    shapes = []
    for name, cfg in [("无键", {}), ("字符串", {"compatibility": "x"}), ("列表", {"compatibility": ["policy"]}), ("空映射", {"compatibility": {}}), ("policy 键大小写", {"compatibility": {"Policy": "x"}}),
                      ("_path 空", {"_path": "", "compatibility": {"policy": "x"}}), ("_path 有", {"_path": "a/b.yaml", "compatibility": {"policy": "x"}}), ("_path 0", {"_path": 0, "compatibility": {"policy": "x"}}),
                      ("_path 缺项", {"_path": "a/b.yaml"}), ("_path 数字 5", {"_path": 5, "compatibility": {"policy": "x"}})]:
        f = ca._compatibility(cfg)
        shapes.append({"name": name, "cfg": cfg, "status": f["status"], "where": f["where"], "reason": f["reason"], "evidence": f["evidence"]})
    out["compat_shapes"] = shapes
    path = os.path.join(HERE, "unit", "adoption.json")
    tmpf = path + ".tmp"
    with open(tmpf, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    back = json.load(open(tmpf, encoding="utf-8"))
    if {k: len(v) for k, v in back.items() if isinstance(v, list)} != {k: len(v) for k, v in out.items() if isinstance(v, list)}:
        sys.exit("回读与内存不一致，拒绝落盘")
    os.replace(tmpf, path)
    print("写出 golden/unit/adoption.json：" + "、".join("%s %d" % (k, len(v)) for k, v in out.items() if isinstance(v, list)))


if __name__ == "__main__":
    main()
