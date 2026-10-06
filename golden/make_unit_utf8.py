#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""UTF-8 首个无效序列诊断（起点、终点、原因）与 Python 异常整句文本的穷举黄金样本。

在一组**边界字节**上枚举所有长度 1 到 4 的序列，对每个序列记 Python 严格解码的 `UnicodeDecodeError`：start、end、reason，以及整句 `str(e)`；合法记 `-1`。
边界字节取各码点区间的两端与两端之外一位（Unicode Table 3-7 的每一条边界都落在里面）：00 41 7f 80 8f 90 9f a0 bf c0 c1 c2 df e0 e1 ec ed ee ef f0 f1 f3 f4 f5 ff。
字母表与长度上限就是下面的 ALPHABET 与 MAXLEN，总条数由脚本运行时输出。**文件里只存枚举规格与整体的 sha256**（逐条存会有几 MB），
TS 测试按同一规格重新枚举、算同样的 sha256 比较；不一致时用 `--dump 文件` 导出逐条结果定位。
两个哈希：`sha256_start`（只含 start，向后兼容配置读取）、`sha256_full`（start,end,reason 与整句文本）。
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


def diagnose(b):
    try:
        b.decode("utf-8")
        return None
    except UnicodeDecodeError as e:
        return e


def main():
    dump = None
    if "--dump" in sys.argv:
        dump = open(sys.argv[sys.argv.index("--dump") + 1], "w", encoding="utf-8")
    hs, hf = hashlib.sha256(), hashlib.sha256()
    n = valid = 0
    reasons = {}
    for L in range(1, MAXLEN + 1):
        for combo in itertools.product(ALPHABET, repeat=L):
            b = bytes(combo)
            e = diagnose(b)
            if e is None:
                start, line = -1, "-1"
                valid += 1
            else:
                start = e.start
                line = "%d,%d,%s,%s" % (e.start, e.end, e.reason, str(e))
                reasons[e.reason] = reasons.get(e.reason, 0) + 1
            hs.update(str(start).encode() + b",")
            hf.update(line.encode("utf-8") + b"\n")
            n += 1
            if dump:
                dump.write("%s %s\n" % (b.hex(), line))
    out = {"alphabet": ALPHABET, "maxlen": MAXLEN, "count": n, "valid": valid, "reasons": reasons,
           "sha256": hs.hexdigest(), "sha256_start": hs.hexdigest(), "sha256_full": hf.hexdigest(), "python": sys.version.split()[0]}
    path = os.path.join(HERE, "unit", "utf8-start.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, indent=1, sort_keys=True)
        fh.write("\n")
    if json.load(open(tmp, encoding="utf-8"))["sha256_full"] != out["sha256_full"]:
        sys.exit("回读不一致，拒绝落盘")
    os.replace(tmp, path)
    print("写出 golden/unit/utf8-start.json：%d 个序列（合法 %d），原因分布 %s，sha256_full=%s" % (n, valid, reasons, out["sha256_full"][:16]))


if __name__ == "__main__":
    main()
