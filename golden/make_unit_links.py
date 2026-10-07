#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""links 检查器私有函数的单元黄金样本：`_mask_code`、`_slug`、`_atx_title`、`_titles`、`_anchors_of`、`_LINK_RE`、`_SKIP_SCHEME_RE`、`_LINE_SUFFIX_RE`、`_WIN_ABS_RE`、`urllib.parse.unquote`。

这些都是正则密集的纯函数，Python 的 `re` 与 JS 的差异在这里最集中：`\\w`（D5）、`\\s`（D6）、`re.M` 的 `^`（D13）、`re.I` 的 Unicode 折叠（D11）、`.` 与 `[\\s\\S]`、
`re.sub` 的空匹配语义、`str.lower()`（`İ` 变成两个码点）、`str.strip()`（D6）、`unquote` 对非法 UTF-8 与 `%` 序列的处理。所以输入给得最密，并对 `\\w` 逐码点实测。
用法：python golden/make_unit_links.py
"""
import importlib.util
import json
import os
import re
import sys
from urllib.parse import unquote

HERE = os.path.dirname(os.path.abspath(__file__))
STD = os.path.join(os.path.dirname(HERE), "tools", "std")
sys.path.insert(0, STD)
spec = importlib.util.spec_from_file_location("check_links", os.path.join(STD, "checks", "check_links.py"))
cl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cl)

HEADINGS = [
    "Hello World", "  spaced  ", "A-B", "a_b", "_a", "a_", "__a__", "my_func", "_my_func_", "a__b", "**bold**", "*em*", "~~del~~", "`code`", "a`b`c",
    "[link](http://x.y)", "[l](a(b))", "[l](a)b[m](c)", "[[x]]", "[a", "a]", "<b>x</b>", "<a href=\"x\">y</a>", "a<b", "a>b", "<<>>", "<>",
    "中文标题", "中文 English 混合", "Ünïcode Çafé", "ß straße", "İstanbul", "ǅ", "ʻokina", "naïve", "ΑΒΓ αβγ", "Привет мир", "日本語のタイトル", "한국어 제목",
    "１２３", "①②", "½", "٣٤٥", "² ³", "ⅷ", "⁰", "ℵ", "ª º", "_", "__", "a-b-c", "a - b", "a  b", "a\tb", "a\u00a0b", "a\u3000b", "a\u2003b", "a\u200bb", "a\ufeffb",
    "Hello, World!", "What's new?", "100% done", "a/b", "a\\b", "a.b", "a:b", "a;b", "a@b", "a#b", "a$b", "a&b", "a+b", "a=b", "a|b", "a^b", "a~b", "(paren)", "{brace}",
    "—em dash", "–en dash", "…", "“quote”", "‘single’", "，。！？", "【方括号】", "（全角括号）", "·", "•", "→", "★", "😀 emoji", "a😀b", "\U0001f600",
    "", " ", "-", "--", "- a", "a -", "# x", "1. item", "v1.2.3", "API v2", "FAQ?", "C++", "C#", ".NET", "node_modules", "a_b_c", "a_b c_d", "__init__.py", "_private_",
    "\u0301", "e\u0301", "é", "\u00e9", "ﬁ", "ǆ", "Ǆ", "ǈ", "ꭰ", "𝐀𝐁", "𝟘𝟙", "ℌ", "ℙ", "Ⅻ", "ⓐ", "㊀", "〇", "〡", "꘠", "𐒠", "ᛮ", "᠐", "߀", "०",
]
SLUG_KEEP = (False, True)

MASK_TEXTS = [
    "", "plain", "`code`", "a `x` b", "``a`b``", "`a\nb`", "```\nfence\n```", "~~~\nfence\n~~~", "```a```", "text ```\nunclosed", "~~~ x", "``` x ``` `y`", "`", "``", "```",
    "`a` `b` `c`", "a`b\nc`d", "```\n[x](y.md)\n```\n[z](w.md)", "[a](b.md) `[c](d.md)` [e](f.md)", "~~~\n```\n~~~\n```", "```\n~~~\n```", "x\n```\n```\ny", "```\n\n```",
    "`\u4e2d\u6587`", "a\r\nb `c\r\nd`", "a\rb", "\t`x`\t", "``` ``` ``` ```", "`a``b`", "```a``b```", "`` ` ``", "\ufeff`x`", "`x`\u2028y", "a\x0bb`c`", "a ` b` c",
    "[`x`](y.md)", "[a](`b`.md)", "```\n```\n```\n```", "~~~\n~~~\n~~~", "`" * 50, "``" * 20, "```" * 7, "` `" * 10,
]

ATX = ["x", " x ", "x #", "x ##", "x#", "x # y", "#", "##", " # ", "x \\#", "x # #", "x ## ##", "x\t#", "x #\t", "x\u3000#", "x \u00a0#", "# #", "a  ", "\ta\t", "a#b#", "a #b", "a# #", "中 #", ""]

TITLE_TEXTS = [
    "", "# A", "## B", "###### F", "####### G", "#nospace", "#\tx", "# x #", "#  x  ", "Title\n===", "Title\n---", "Title\n=", "Title\n -", "Title\n ===", "Title\n    ===", "Title\n\t===",
    "a\n\nb\n===", "# A\nSetext\n---\n## B", "text\n---\n", "---\n", "===\n", "a\n---\nb\n---", "a\n- - -\n", "a\n___", "a\n***", "x\n====  ", "x\n=== x", "x\n==\n",
    "    code\n===", "\tcode\n===", "  para\n---", "   a\n---", "    a\n---", "- item\n---", "> q\n---", "# H\n===", "a\n---\n\n---", "\n\nx\n===", "x\r\n===\r\n", "x\r===\r", "x\u2028===",
    "# `code` title", "# [l](u) t", "# a_b", "# A\n# A\n# A", "# 中文\n## English", "###\n", "# \n", "#\n", "# #", "# a #b", "#\u3000x", "# \u00a0x",
]

LINK_LINES = [
    "[a](b.md)", "![i](p.png)", "[a](b.md#c)", "[a](<b c.md>)", "[a](<b (1).md>)", "[a](b.md \"t\")", "[a](b.md 't')", "[a]( b.md )", "[a](b.md  \"t\"  )", "[a](b.md \"t\" x)",
    "[a][ref]", "[a](b.md)[c](d.md)", "[a](b.md) text [c](d.md)", "[[x]](y.md)", "[a[b]c](d.md)", "[a[b[c]]](d.md)", "[](b.md)", "[ ](b.md)", "[a]()", "[a]( )", "[a](())",
    "[a](b(c).md)", "[a](b)c)", "[a](http://x.y)", "[a](<http://x y>)", "[a](#frag)", "[a](<#frag>)", "[a](?q=1)", "[a](b.md?x=1#y)", "[a](b%20c.md)", "[a](b c.md)", "[a](<>)", "[a](< >)",
    "[a](<b\nc>)", "[a](b<c.md)", "[a](b>c.md)", "[a]\n(b.md)", "[a] (b.md)", "\\[a](b.md)", "[a\\](b.md)", "[a](b\\).md)", "[a](b.md\"t\")", "[a](b.md \"t)", "[a](b.md 't\")",
    "[中文](文档.md)", "[a](<文 档.md>)", "[a](中文.md#标题)", "[a](b.md#a_b)", "[a](b.md#)", "[a](#)", "[a](b.md#c#d)", "[a](b.md#c?d)", "[a](b.md?c#d)",
    "[a](/abs.md)", "[a](//host/x)", "[a](C:\\x.md)", "[a](c:/x.md)", "[a](C:/x.md#f)", "[a](./b.md)", "[a](../b.md)", "[a](b/../c.md)", "[a](b//c.md)", "[a](b.md/)",
    "[a](mailto:x@y.z)", "[a](tel:123)", "[a](sms:123)", "[a](javascript:void(0))", "[a](vscode:ext)", "[a](news:x)", "[a](a.py:12)", "[a](Makefile:3)", "[a](x.py:3:5)", "[a](http:80)",
    "[a](file:///x)", "[a](a+b:c)", "[a](a.b:c)", "[a](1a:b)", "[a](a:)", "[a](:b)", "[a](a:1)", "[a](a:1:2)", "[a](a:b:1)", "[a](TEL:1)", "[a](Tel:x)",
    "x" * 300 + "](" + "y" * 300 + ")", "[" * 200, "[a](" + "(" * 200, "[a](b" + " " * 300 + ")", "[" + "a" * 300, "[a](<" + "b" * 300,
]

SKIP_TARGETS = [
    "http://x", "https://x", "HTTP://X", "mailto:a@b", "tel:1", "tel:+1 2", "sms:1", "SMS:x", "javascript:x", "vscode:x", "a.py:12", "a.py:12:3", "Makefile:3", "x:1", "xy:1", "xy:1:2",
    "xy:a", "xy:a:1", "a-b:c", "a+b:c", "a.b:c", "1a:b", "_a:b", "a:", "a::", ":a", "C:\\x", "C:/x", "c:", "C:x", "ab", "a", "", " ", "http", "http:", "news:comp", "file:x", "a:1b", "a:1:b",
    "\u00e9a:b", "ab\u00e9:c", "a\u0131:b", "\u212a:b", "\u017f:b", "ǆa:b", "ab:\uff11", "ab:\u0661", "ab:１２", "tel:\uff11", "tel:１", "SMS:１",
]
LINE_SUFFIX = ["a.py:12", "a.py:12:3", "a.py:", "a.py:x", "a.py:1:2:3", ":12", "a:b:3", "a.py:１", "a.py:\u0661", "a.py:12 ", "a.py:12\n", "a:1\n", "a:1:2\n", "a.py:12:", "a.py::1", "12", ":", "::"]
WIN_ABS = ["C:\\x", "C:/x", "c:\\x", "C:x", "CC:\\x", "1:\\x", "\u00e9:\\x", "C:", "C:\\", "C:/", " C:\\x", "C:\\\n", "\u212a:\\x", "\u0130:\\x", "z:/", "Z:\\a\\b"]

UNQUOTE = [
    "", "a", "a%20b", "a%2Fb", "a%2fb", "%41", "%e4%b8%ad", "%E4%B8%AD", "%e4%b8", "%e4", "%ff", "%c0%80", "%ed%a0%80", "%f0%9f%98%80", "%F0%9F%98", "%", "%%", "%2", "%2g", "%g2", "%zz", "a%", "a%2",
    "%25", "%2525", "+", "a+b", "%2B", "%00", "a%00b", "%0a", "%0d%0a", "%20%20", "文档", "文%20档", "%e6%96%87%e6%a1%a3", "%E6%96%87%E6%A1%A3.md", "a%E6%96b", "%e6%96%87%e6%a1", "x%80y", "x%C3y",
    "%c3%a9", "%C3%A9", "%c3%a9%c3%a9", "%u4e2d", "%U4E2D", "\ud7ff", "%ef%bf%bd", "%ef%bf%be", "%f4%90%80%80", "%f5%80%80%80", "%e0%80%80", "%e0%9f%bf", "%c1%81", "%80", "%bf", "%fe", "%fd",
    "a%2", "%1", "%1%", "%%41", "%4%1", "%４１", "%٤١", "%\u0661\u0662", "a%20", "%20a", "%7e", "%7E", "~", "%2e%2e%2f", "..%2f", "%5c", "%5C", "a%3Fb", "a%23b", "a%3fb%23c",
    "%e4%b8%ad%e6%96%87", "%e4%b8%ad%ff%e6%96%87", "%ff%fe", "%c2", "%c2%a0", "%ee%80%80", "%ef%bb%bf", "%e2%80%a8",
]

# 对 `\w` 的逐码点实测：Python 的 `re` 认哪些码点是单词字符（含数字、下划线）。用于生成 TS 的 `\p{L}\p{N}_` 以外的补集
def wordset():
    pat = re.compile(r"\w")
    return [cp for cp in range(0x110000) if not (0xD800 <= cp <= 0xDFFF) and pat.match(chr(cp))]


def spaceset():
    pat = re.compile(r"\s")
    return [cp for cp in range(0x110000) if not (0xD800 <= cp <= 0xDFFF) and pat.match(chr(cp))]


def main():
    out = {"python": sys.version.split()[0], "unicodedata": __import__("unicodedata").unidata_version}
    out["slug"] = [{"in": h, "keep": k, "out": cl._slug(h, k)} for h in HEADINGS for k in SLUG_KEEP]
    out["mask"] = [{"in": t, "out": cl._mask_code(t)} for t in MASK_TEXTS]
    out["atx"] = [{"in": t, "out": cl._atx_title(t)} for t in ATX]
    out["titles"] = [{"in": t, "out": list(cl._titles(cl._mask_code(t)))} for t in TITLE_TEXTS]
    out["anchors"] = [{"in": t, "out": sorted(cl._anchors_of(t))} for t in TITLE_TEXTS + HEADINGS[:40]]
    out["links"] = [{"in": s, "out": [list(m) for m in cl._LINK_RE.findall(s)]} for s in LINK_LINES]
    out["skip"] = [{"in": s, "skip": bool(cl._SKIP_SCHEME_RE.match(s))} for s in SKIP_TARGETS]
    out["suffix"] = [{"in": s, "out": cl._LINE_SUFFIX_RE.sub("", s)} for s in LINE_SUFFIX]
    out["winabs"] = [{"in": s, "abs": bool(cl._WIN_ABS_RE.match(s))} for s in WIN_ABS]
    out["unquote"] = [{"in": s, "out": unquote(s)} for s in UNQUOTE]
    w, sp = wordset(), spaceset()
    out["wordset_count"], out["spaceset"] = len(w), sp
    # `\w` 与「Unicode 字母 + 数字 + 下划线」的差集（逐码点）：Python 认、`\p{L}\p{N}_` 不认的，与反过来的
    import unicodedata
    def l_n(cp):
        c = unicodedata.category(chr(cp))
        return c[0] in "LN" or chr(cp) == "_"
    wset = set(w)
    out["w_minus_LN"] = [cp for cp in w if not l_n(cp)]
    out["LN_minus_w"] = [cp for cp in range(0x110000) if not (0xD800 <= cp <= 0xDFFF) and l_n(cp) and cp not in wset]
    path = os.path.join(HERE, "unit", "links.json")
    tmpf = path + ".tmp"
    with open(tmpf, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    back = json.load(open(tmpf, encoding="utf-8"))
    if {k: len(v) for k, v in back.items() if isinstance(v, list)} != {k: len(v) for k, v in out.items() if isinstance(v, list)}:
        sys.exit("回读与内存不一致，拒绝落盘")
    os.replace(tmpf, path)
    print("写出 golden/unit/links.json：" + "、".join("%s %d" % (k, len(v)) for k, v in out.items() if isinstance(v, list) and k not in ("spaceset", "w_minus_LN", "LN_minus_w")) +
          "；\\w 码点数 %d，\\w−(L|N|_) %d 个，(L|N|_)−\\w %d 个，\\s %d 个" % (len(w), len(out["w_minus_LN"]), len(out["LN_minus_w"]), len(sp)))


if __name__ == "__main__":
    main()
