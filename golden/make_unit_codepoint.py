#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按码点切分与按码元切分的差别（设计 §12.6 新增 D18）：Python 的 `str[:N]` 按**码点**计，JS 的 `String.prototype.slice` 按 UTF-16**码元**计，
BMP 之外的字符（emoji、部分汉字扩展区）在 JS 里占 2 个码元，所以含这类字符的文本，JS 会比 Python 少取。

这条差别此前没有被任何测试抓到：`core/docs.ts` 的 `headOf` 用 `text.slice(0, HEAD_CHARS)`，头部含 emoji 的文档，字段会被挤出头部，进而影响
`findField`/`itemStatus` → `layout`、`entry_budget`、`freshness` 的 status。样本记 Python 在这些输入上的真实结论，供 TS 逐条对照。
用法：python golden/make_unit_codepoint.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "tools", "std"))
import stdlib as sl  # noqa: E402

HC = sl.HEAD_CHARS
EMOJI = "\U0001f600"          # 1 码点 / 2 码元
HAN_EXT = "\U00020000"        # CJK 扩展 B：1 码点 / 2 码元
FIELD = "\nupdated_at: 2026-09-10\n"
STATUS = "\n状态：进行中\n"


def build(prefix_char, n_prefix, tail_field, pad_to=None):
    """前面 n_prefix 个非 BMP 字符，补 x 使字段结束在**码点** pad_to 处（默认恰好 HC），后面再跟 '尾'。"""
    target = HC if pad_to is None else pad_to
    pad = "x" * (target - len(tail_field) - n_prefix)
    return prefix_char * n_prefix + pad + tail_field + "尾" * 5


CASES = []
for ch_name, ch in (("emoji", EMOJI), ("han_ext", HAN_EXT)):
    for n in (0, 1, 5, 20, 100):
        for tag, field in (("date", FIELD), ("status", STATUS)):
            for off in (-3, 0, 1, 3):   # 字段结束位置相对 HC 边界：-3 在内、0 恰好、1 与 3 越界一点
                try:
                    t = build(ch, n, field, HC + off)
                except Exception:
                    continue
                CASES.append({"ch": ch_name, "n": n, "field": tag, "off": off, "text": t})

# 头部标题截断：`## ` 小节标题之前才是头部；非 BMP 字符出现在标题前
for n in (0, 3, 50):
    t = EMOJI * n + "状态：进行中\nupdated_at: 2026-09-10\n\n## 背景\n状态：已完成\n"
    CASES.append({"ch": "emoji", "n": n, "field": "section", "off": 0, "text": t})


def main():
    out = {"python": sys.version.split()[0], "head_chars": HC, "cases": []}
    for c in CASES:
        t = c["text"]
        v, name = sl.find_field(t[:HC], ["updated_at"])
        out["cases"].append({
            "ch": c["ch"], "n": c["n"], "field": c["field"], "off": c["off"], "text": t,
            "len_cp": len(t), "len_cu": len(t.encode("utf-16-le")) // 2,
            "date": v, "item_status": sl.item_status(t), "head_len": len(sl.head_of(t)) if hasattr(sl, "head_of") else None,
        })
    path = os.path.join(HERE, "unit", "codepoint.json")
    tmpf = path + ".tmp"
    with open(tmpf, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    if len(json.load(open(tmpf, encoding="utf-8"))["cases"]) != len(out["cases"]):
        sys.exit("回读与内存不一致，拒绝落盘")
    os.replace(tmpf, path)
    differ = sum(1 for c in out["cases"] if c["len_cp"] != c["len_cu"])
    print("写出 golden/unit/codepoint.json：%d 条，其中码点数≠码元数 %d 条" % (len(out["cases"]), differ))


if __name__ == "__main__":
    main()
