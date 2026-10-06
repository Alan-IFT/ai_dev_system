#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""UTF-8 首个无效序列起点的穷举黄金样本。

在一组**边界字节**上枚举所有长度 1 到 4 的序列，对每个序列记 Python 严格解码的 `UnicodeDecodeError.start`（合法为 -1）。
边界字节取各码点区间的两端与两端之外一位（Unicode Table 3-7 的每一条边界都落在里面）：00 41 7f 80 8f 90 9f a0 bf c0 c1 c2 df e0 e1 ec ed ee ef f0 f1 f3 f4 f5 ff。
25 个字节、长度 1 到 4，共 25+625+15625+390625 条。**文件里只存枚举规格与整体的 sha256**（41 万条逐条存会有几 MB），
TS 测试按同一规格重新枚举、算同样的 sha256 比较；不一致时用 `--dump` 导出逐条结果定位。
用法：python golden/make_unit_utf8.py [--dump 文件]
"""
import hashlib
import itertools
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ALPHABET = [0x00, 0x41, 0x7F, 0x80, 0x8F, 0x90, 0x9F, 0xA0, 0xBF, 0xC0, 0xC1, 0xC2, 0xDF, 0xE0, 0xE1, 0xEC, 0xED, 0xEE, 0xEF,
            0xF0, 0xF1, 0xF3, 0xF4, 0xF5, 0xFF]
MAXLEN = 4


def start_of(b):
    try:
        b.decode("utf-8")
        return -1
    except UnicodeDecodeError as e:
        return e.start


def main():
    dump = None
    if "--dump" in sys.argv:
        dump = open(sys.argv[sys.argv.index("--dump") + 1], "w", encoding="utf-8")
    h = hashlib.sha256()
    n = 0
    valid = 0
    for L in range(1, MAXLEN + 1):
        for combo in itertools.product(ALPHABET, repeat=L):
            s = start_of(bytes(combo))
            h.update(str(s).encode() + b",")
            if s == -1:
                valid += 1
            n += 1
            if dump:
                dump.write("%s %d\n" % (bytes(combo).hex(), s))
    out = {"alphabet": ALPHABET, "maxlen": MAXLEN, "count": n, "valid": valid, "sha256": h.hexdigest(), "python": sys.version.split()[0]}
    path = os.path.join(HERE, "unit", "utf8-start.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, indent=1, sort_keys=True)
        fh.write("\n")
    if json.load(open(tmp, encoding="utf-8"))["sha256"] != out["sha256"]:
        sys.exit("回读不一致，拒绝落盘")
    os.replace(tmp, path)
    print("写出 golden/unit/utf8-start.json：%d 个序列（合法 %d），sha256=%s" % (n, valid, out["sha256"][:16]))


if __name__ == "__main__":
    main()
