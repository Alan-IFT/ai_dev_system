#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""derived 检查器私有纯函数的单元黄金样本：`_mentions`、`header_declares`、`header_generation_hint`、`read_header` 的解码与截行部分、`bytes.decode("utf-8","ignore")`。
**为什么要自己的样本**：4 个真实仓都没有声明 `derived:`（只出一条 SKIP），真实仓比对对这个检查器几乎没有覆盖力；判据只靠 selftest 与这里的样本守护。
写之前对每个 Python 字符串、正则、容器操作问过「JS 里对应的在非 ASCII、非 BMP、边界值上等价吗」（设计 §12.22）。
用法：python golden/make_unit_derived.py
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STD = os.path.join(os.path.dirname(HERE), "tools", "std")
sys.path.insert(0, STD)
spec = importlib.util.spec_from_file_location("check_derived", os.path.join(STD, "checks", "check_derived.py"))
cd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cd)

E = "\U0001f600"

# --- _mentions(low, name)：ASCII 边界；名字里含正则元字符；大小写；中文紧贴；非 ASCII 字母数字不算边界字符
MENT = [
    ("权威是src/map.json", "src/map.json"), ("rapid", "api"), ("api.md", "api"), ("api。", "api"), ("xapi", "api"), ("a-api", "api"), ("api-b", "api"), ("api_b", "api"), ("api.", "api"), ("api.b", "api"),
    ("src/map.json.bak", "src/map.json"), ("src/map.json,", "src/map.json"), ("src/map.json。", "src/map.json"), ("é api", "api"), ("éapi", "api"), ("api é", "api"), ("apié", "api"),
    ("src/m[1].json", "src/m[1].json"), ("src/m1.json", "src/m[1].json"), ("SRC/MAP.JSON", "src/map.json"), ("src\\map.json", "src/map.json"), ("", "x"), ("x", ""), ("İapi", "api"), ("api٣", "api"), ("٣api", "api"), ("api１", "api"),
    ("a.api", "api"), (".api", "api"), ("-api", "api"), ("api.-", "api"), ("api-", "api"), ("api--", "api"), ("api\n", "api"), ("\napi", "api"), ("(api)", "api"), ("'api'", "api"), ("api/x", "api"), ("x/api", "api"),
    ("a+b", "a+b"), ("a+b", "a.b"), ("a.b", "a.b"), ("axb", "a.b"), ("a*b", "a*b"), ("(x)", "(x)"), ("a|b", "a|b"), ("a^b$", "a^b$"), ("a{1}", "a{1}"), ("a\\b", "a\\b"), ("a b", "a b"), ("a#b", "a#b"), ("a-b", "a-b"), ("a&b", "a&b"),
    ("docs/map.html.md", "docs/map.html"), ("docs/map.html.", "docs/map.html"), ("docs/map.html..", "docs/map.html"), ("docs/map.html.x", "docs/map.html"),
    ("api" + E, "api"), (E + "api", "api"), ("apiǅ", "api"), ("API", "api"), ("Api.", "api"),
]

# --- header_declares(header, source_rel)：源路径（反斜杠换斜杠）、文件名、source_rev 标记；lower 对 İ/K 的行为
DECL = [
    ("权威是 SRC/MAP.JSON", "src/map.json"), ("source_rev: 1", "x"), ("SOURCE-REV", "x"), ("sourcerev", "x"), ("SOURCEREV", "x"), ("İ source_rev", "x"), ("\u212aelvin source_rev", "x"), ("see map.json", "src/map.json"),
    ("src\\map.json", "src\\map.json"), ("a/b/c.json", "a\\b\\c.json"), ("rapid prototype, generated", "src/api"), ("权威是src/map.json", "src/map.json"), ("source: ../map.json.", "src/map.json"), ("see api.md", "src/api"),
    ("src/map.json.bak", "src/map.json"), ("", "src/x"), ("source", "src/source"), ("source_re", "x"), ("sourcer ev", "x"), ("source rev", "x"), ("SOURCE_REV", "x"), ("src/a.json src/b.json", "src/b.json"),
    ("a" + E + "src/map.json", "src/map.json"), ("src/map.json" + E, "src/map.json"), ("权威是 src/map.json；不要手改", "src/map.json"), ("<!-- src/m[1].json -->", "src/m[1].json"), ("<!-- src/m1.json -->", "src/m[1].json"),
    ("map.json", "src/map.json"), ("amap.json", "src/map.json"), ("map.jsonx", "src/map.json"), ("src//map.json", "src//map.json"), ("./src/map.json", "./src/map.json"), ("../src/map.json", "src/map.json"),
    ("x", ""), ("x", "/"), ("x", "src/"), ("src/", "src/"),
]

# --- header_generation_hint(header)：先署名后措辞；行号按 splitlines；`line.strip()[:200]`
HINT = [
    '<meta name="generator" content="x">', "<META NAME='GENERATOR'>", "X-Generator: y", "generated-by foo", "Generator: z", "本文件由工具生成", "权威是 x", "a\x0cDO NOT EDIT", "a\u2028生成", "", "   ",
    "generated " + E * 250, "生成" + "x" * 300, "\u3000生成\u3000", "\ufeff生成", "REGEN", "Regenerate", "source:", "SOURCES:", "İ generated", "GENERATED\u212a", "source =", "Source = x", "do not edit", "DO NOT EDIT",
    "派生缓存", "自动产出", "不要手改", "勿手改", "不要手工修改", "请勿编辑", "权威在 x", "x\n生成\n署名 generator:", "generator:\n生成", "生成\n<meta name=\"generator\">", "a\n\n生成", "a\r\n生成", "a\r生成", "a\x1c生成", "a\x85生成",
    "x" * 199 + "生成", "x" * 200 + "生成", E * 199 + "生成", E * 200 + "生成", "\u3000" + "x" * 199 + "\u3000", "  generator:  ", "name = \"generator\"", 'name="Generator"', "name = 'generator'",
]

# --- read_header 的解码与截行：decode("utf-8","ignore")、\x00 判二进制、splitlines()[:30]、"\n".join
HDR_BYTES = [
    b"ab\xffcd", b"\xe4\xbd", b"a\n" * 40, b"a\x00b", b"\xef\xbb\xbfhello", "x\u2028y\x0cz\r\nw\rv\n".encode(), b"", b"\xed\xa0\x80", b"\xc0\x80", b"\xf0\x9f\x98", b"a\xe4\xbdb", b"a\xef\xbf\xbdb", b"\xef\xbf\xbd",
    b"a\xef\xbf\xbd\xffb", b"\xf4\x90\x80\x80", b"\xe0\x80\x80", b"\xf8\x88\x80\x80\x80", "第一行\n第二行\n".encode(), ("l\n" * 30).encode(), ("l\n" * 31).encode(), ("l\r\n" * 31).encode(), ("l\r" * 31).encode(),
    ("l\u2028" * 31).encode(), b"\xff" * 10, b"a\xffb\xffc", b"\xe4\xbd\xa0\xe5\xa5", "你好".encode()[:-1], "你好".encode()[:-2], E.encode()[:-1], (E + "\n") .encode() * 3, b"\xef\xbb\xbf\xef\xbb\xbfx", b"\xfe\xff", b"\xc2", b"\xc2\xa0x",
    b"a\x00", b"\x00", b"\xff\x00", b"\n\n\n", b"\r\n", b"x\x0b\x0cy", b"\x1c\x1d\x1e", b"a\xc3", b"a\xc3\xa9", b"\xe2\x82", b"\xe2\x82\xac", b"\xe2\x82\xacx",
]


def main():
    out = {"python": sys.version.split()[0]}
    out["mentions"] = [{"low": a, "name": b, "out": cd._mentions(a, b)} for a, b in MENT]
    out["declares"] = [{"header": h, "src": s, "out": cd.header_declares(h, s)} for h, s in DECL]
    out["hint"] = [{"in": h, "out": (list(cd.header_generation_hint(h)) if cd.header_generation_hint(h) else None)} for h in HINT]

    def hdr(data):
        if b"\x00" in data:
            return {"binary": True, "text": None}
        return {"binary": False, "text": u"\n".join(data.decode("utf-8", "ignore").splitlines()[:cd._HEADER_LINES])}
    out["header_bytes"] = [dict(hdr(b), **{"hex": b.hex()}) for b in HDR_BYTES]
    out["decode_ignore"] = [{"hex": b.hex(), "out": b.decode("utf-8", "ignore")} for b in HDR_BYTES if b"\x00" not in b]
    path = os.path.join(HERE, "unit", "derived.json")
    tmpf = path + ".tmp"
    with open(tmpf, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    back = json.load(open(tmpf, encoding="utf-8"))
    if {k: len(v) for k, v in back.items() if isinstance(v, list)} != {k: len(v) for k, v in out.items() if isinstance(v, list)}:
        sys.exit("回读与内存不一致，拒绝落盘")
    os.replace(tmpf, path)
    print("写出 golden/unit/derived.json：" + "、".join("%s %d" % (k, len(v)) for k, v in out.items() if isinstance(v, list)))


if __name__ == "__main__":
    main()
