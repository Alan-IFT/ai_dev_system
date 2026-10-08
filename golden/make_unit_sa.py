#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""single_authority 检查器私有纯函数的单元黄金样本：`effective_chars`、`is_doc`、`_is_structural`、`_unfenced`、`significant_lines`、`prose_lines`、`_mask_links`、
`_count_claims`（单行，同一行放进 3 份文件以满足 _CLAIM_MIN_FILES）、`_declared_derived_artifacts` / `_excluded` 里的 `lstrip("./")`。
四个真实仓覆盖这个检查器很强（pmc 20 条 count-claim），但**真实仓里没有 emoji、\\x1c、\\u2028、前导零编号、全角数字这类输入**，所以单独成样本。
用法：python golden/make_unit_sa.py
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STD = os.path.join(os.path.dirname(HERE), "tools", "std")
sys.path.insert(0, STD)
spec = importlib.util.spec_from_file_location("check_sa", os.path.join(STD, "checks", "check_single_authority.py"))
sa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sa)

E = "\U0001f600"

EFF = ["abc", "a b", "a·b", "a—b", "a–b", "a-b", "a_b", "，。、", "a\u3000b", "a\u00a0b", "a\u200bb", "a\ufeffb", "a\x1cb", "a\x85b", "漢字", E, "a" + E, "“引”", "‘引’", "…", "《书》", "〈x〉", "【x】", "〔x〕", "（x）",
       "a~b", "a^b", "a`b", "a|b", "a\\b", "a/b", "a#b", "a=b", "a<b", "a>b", "a!b", "a@b", "a$b", "a%b", "a&b", "a(b)c", "a[b]c", "a{b}c", "a+b", "a:b", "a;b", "a,b", "a.b", "a?b", 'a"b', "a'b", "", " ", "\t\n", "，", "。。。",
       "ａ", "Ａ１", "①", "②③", "ǅ", "a\u2028b", "a\u2029b", "a\u202fb", "a\u205fb", "a\u1680b", "a\u2000b", "a\u200ab", "·", "—", "–"]

DOC = ["a.md", "A.MD", "a.Md", "x/.md", ".md", "a.markdown", "a.TXT", "a.rst", "a.adoc", "a.org", "a.md.bak", "a.md/", "a", "x.y/z", "x\\a.md", "a.İ", "a.mD", "dir.md/f.py", "..md", "a..md", "a.", ".", "..", "a .md", "a.md ",
       "é.md", "a.MDK", "docs/state/work/WI-001.md", "a/b/c.txt", "a/b.c/d", "a/b.c/d.md", ".git/x.md", "x/.hidden.md", "x/..md", "x/...md", "x/a...md", "x/a.b.c.md", "x/a.b.c.txt.bak", "README", "README.", "README.md", ".md.md", "a.md.md", "a.org.org",
       "\u3000.md", "a.\u3000md", "漢.md", "a." + E, E + ".md", "a.md" + E,
       # 反斜杠只在「文件名」的起点上起作用：先归一成 / 再取最后一段，`x\\.md` 的文件名是 `.md`（开头的点不算后缀），不归一则整段 `x\\.md` 的后缀是 `.md`
       "x\\.md", "x\\..md", "dir\\.md", "a\\b.md", "a/b\\.txt", "x\\.git.md", "\\.md", "\\a.md"]

STRUCT = ["# 标题", "  ## x", "    # 四空格", "#无空格", "#\t制表", "---", "***", "___", "===", "--", "- - -", "|---|---|", "| a | b |", "|", "||", " |---", "|:-:|", "- [a](b.md)。", "[a](b)  x", "[a](b)", "**[a](b)**", "1. [a](b)", "1) [a](b)",
          "- **[a](b)**；", "http://x", "- https://x", "<https://x>", "see http://x", "\u3000# x", "> # x", "#\u3000x", "-{3}", "----", "----  ", "  ---  ", "- ---", "\t---", "---x", "|a|b", "a|b|", "-|-", ":|:", " | | ",
          "#" * 6 + " x", "#" * 7 + " x", "   # x", "  \u3000# x", "####### x", "---\u3000", "***\x1c", "___ ", "=== ", "====", "- [a](b)！", "- [a](b)，", "- [a](b),", "- [a](b);", "- [a](b)；  ", "+ [a](b)", "* [a](b)", "2. [a](b)", "10) [a](b)",
          "[a](b)", "[a]()", "[](b)", "**[a](b)", "[a](b)**", "[a](b)**x", "[a](b) [c](d)", "[a](b)[c](d)", "http://", "https://x y", "<http://x>y", "- <https://x>", "-<https://x>", "  http://x  ", "ftp://x", "HTTP://x", "http://x\u3000",
          "|" * 3, "|" + E, E + "|", ":|", "|:", "|-", "-|", "- | -", "| : |", "|x|", " :-: ", "-:|"]

FENCE = ["```\na\n```\nb\n", "```x```\na\n", "````md\n```\nx\n```\n````\ny\n", "~~~\na\n~~~\nb\n", "```\na\n~~~\nb\n```\nc\n", "```py\na\n``` \nb\n", "```\na\n```x\nb\n", "```\na\n  ```\nb\n", "  ```\na\n```\nb\n",
         "\u3000```\na\n```\nb\n", "```\na\n```\u3000\nb\n", "``\na\n", "`` `\na\n", "```a`b\nx\n```\ny\n", "~~~a`b\nx\n~~~\ny\n", "```\na", "x\r\ny\rz\n", "a\u2028b\x0cc\n", "", "\n", "```", "~~~~\n~~~\nx\n~~~~\ny\n",
         "```\n````\nx\n```\ny\n", "````\n```\nx\n````\ny\n", "```\n``\nx\n```\ny\n", "    ```\na\n    ```\nb\n", "\t```\na\n```\nb\n", "```\u3000py\na\n```\nb\n", "``` py\na\n```\nb\n", "```py x\na\n```\nb\n", "```py`x\na\n```\nb\n",
         "~~~ x`y\na\n~~~\nb\n", "```\n" + E + "\n```\n" + E + "\n", E + "\n```\n" + E + "\n```\n" + E + "\n", "a\n```\nb\n```\n```\nc\n```\nd\n", "```\n```\n```\n", "```\na\n```\n```\nb\n",
         # 闭合围栏其后「只有空白」的判断用 Python 空白集：U+FEFF 不是空白（不闭合）、U+00A0 与 U+3000 是（闭合）
         "```\na\n```\ufeff\nb\n", "```\ufeff\na\n```\nb\n", "```\na\n```\u00a0\nb\n", "```\na\n``` \u3000 \nb\n", "```\na\n```\t\nb\n", "~~~\ufeff\na\n~~~\nb\n"]

SIG = ["# T\n\n正文一行。\n  \n---\n|a|b|\n", "正文  多   空格\n", "\ufeff正文\n", "\u3000\n正文\n", "正文\u3000二\n", ",,,\n正文\n", "…\n", "a\n```\ncode\n```\nb\n", "正文\t制表\n", "正文\x1c行\n", "正文\u2028行\n", "  缩进  \n",
       "- 列表项一\n- 列表项二\n", "> 引用\n", "1. 编号\n2. 编号\n", E + "\n", "a" + E + "b\n", "# 标题\n正文\n## 标题二\n正文二\n", "|表|格|\n|---|---|\n|a|b|\n", "[链](x.md)\n", "[链](x.md) 后面有字\n", "https://x.y\n", "see https://x.y\n",
       "***\n", "- - -\n", "===\n", "====\n", "正文\n\n\n正文二\n", "  \n\t\n\u3000\n", "·\n—\n", "a·b\n", "“”\n", "（）\n", "()\n", "\\\n", "/\n", "\n".join("行%d" % i for i in range(30)) + "\n",
       # 空行与结构行的判定用 Python 空白集：仅含 U+FEFF 的行不是空行（保留），仅含 \x1c 的行是空行（丢弃）——一行里 JS 的 trim 正好相反
       "\ufeff\n正文\n", "正文\n\x1c\n后文\n", "正文\n\ufeff\n后文\n", "    # 四空格缩进的井号行内容足够长度\n", "   # 三空格缩进的井号行\n", "\t# 制表符缩进的井号行内容\n", "    ---\n", "    | a | b |\n", "    [链接](x.md)\n", "    http://x.y\n", "  \u3000 # 混合缩进\n", "\x1c\n", "\x85\n"]

LINKS = ["[a](b)", E + "[" + E + "](" + E + ")", "[a](b)[c](d)", "[a]  (b)", "[](b)", "[a]()", "[a](b", "x[a](b)y", "[" * 5, "[a](b c)", "[a](b\tc)", "[a]\u3000(b)", "[[x]](y)", "[x](a(b))", "[a][b](c)", "[a](b)(c)", "![img](x.png)", "[a](<b>)",
         "[a\nb](c)", "[a](b\nc)", "[[a]](b)", "[a]](b)", "[a](b))", "x [a](b) y [c](d) z", "[40 人的检查点与授权](docs/40-x.md)", "共 12 个 [x](y) 部件", "[" + "a" * 100 + "](" + "b" * 100 + ")", "[a](" + E * 5 + ")"]

ORD = ["第 15、16 个", "第15个", "第 个", "第、", "第 1、", "第 1、2、", "第1 、2 个", E + "第 5 个", "第 5 个" + E + "第 6 个", "第\x1c15 个", "第\u300015 个", "第 15 、 16 个", "第15、16、17个", "第 15, 16 个", "第一个",
       "第 0 个", "第 007 个", "第 1 、 2 、 3 个", "第\n15 个", "第 １５ 个", "第 15、 16 个", "第15 、16个", "不算第 15、16 个部件，也不算第 17 个部件。"]

CLAIM_LINES = [
    "共有 23 个部件在册", "第 15 个部件", "第15个部件", "第 15、16 个部件", "第 15 、 16 个部件", "第15、16、17个部件", "不算第 15、16 个部件，也不算第 17 个部件。", "第\u300015 个部件", "第\x1c15 个部件", E + "共有 23 个部件", E + "第 15 个部件",
    "第 15 个部件" + E + "共有 23 个部件", E * 3 + "第 15、16 个部件 共有 23 个部件", "共 1,614 条记录", "共 1614 条记录", "共 3,45 个文件", "1、2 项注", "21，933 个自然日", "01 个", "012 个文件", "0 个文件", "10 个文件", "9 个文件", "99 个", "100 个文件",
    "1,000 个文件", "1,00 个文件", "1,0000 个文件", "1000,000 个文件", "999,999 个", ".5 个文件", "3.5 个文件", "3.52 个文件", "35.0 个文件", "v3 个文件", "12个部件", "12 个部件", "12\u3000个部件", "12\x1c个部件", "12 个 部件", "12 个部",
    "12 个部件件件件", "12 个部件件件件件", "12 个ab", "12 个a", "12 个a_b", "12 个·部件", "12 个部·件", "12 个Ab_c·d", "12 个 ", "12 个1", "12 个部件，12 个部件", "12 个部件 13 个部件", "5 份归档、7 份归档", "5份归档7份归档", "12步", "12 步骤", "12 行",
    "12行数据", "12 家公司", "12 款", "12 批", "12 列", "12 字", "12 人员", "12 台机器", "12 块硬盘", "12 套系统", "12 组数据", "共 12 个 [x](y) 部件", "[12 个部件](x.md)", "[x](12 个部件)", "[a](b)12 个部件", "[a][b](c) 12 个部件", "[[x]](y) 12 个部件",
    "[x](a(b)) 12 个部件", E + "[12 个部件](x.md)" + E + "12 个部件", "12 个部件" + E * 5 + "[12 个部件](x)", E + "12 个部件", "12" + E + "个部件", "12 个" + E + "部件", "12 个部" + E, "Ａ12 个部件", "１２ 个部件", "12 个Ｂ部件", "12 个Ünicode", "12 个éa",
    "12 个ſ", "12 个部\u9fa5", "12 个\u9fa6部", "12 个\u4dffa", "12 个龥件", "12 个一件", "12 个部件，12 个部件，12 个部件，12 个部件", "12 个部件" * 30, " " * 5 + "12 个部件", "12  个  部件", "12\t个部件", "2,147,483,648 个文件",
    "12345678901234567890 个文件", "9007199254740993 个文件", "12 个部件[x](y)13 个文件", "12 个部件，第 5 个文件，共 7 份报告", "共 12 个部件，其中 3 个已完成、9 个未完成", "12 个部件。12 个部件。", "12 个部件\n", "第 12 个文件 " * 3,
    "10 项目管理", "100 个项目", "共 5 个文件", "1,234,567 条", "1,23 条", "1,234 条", "12,345 条", "123,456 条", "1234,567 条", "0,123 条", "01,234 条", "共1,614条记录", "共 1,614 条记录和 1,614 条记录",
]

DERIVED = ["docs/a.html", "./docs/a.html", "../docs/a.html", "docs\\a.html", ".\\docs\\a.html", "/docs/a.html", ".hidden/a.md", "...x", "./.x", ".", "..", "./", "a/./b", "./a/./b", "", "\\", ".\\", "./\\a"]


def main():
    out = {"python": sys.version.split()[0]}
    out["effective_chars"] = [{"in": s, "out": sa.effective_chars(s)} for s in EFF]
    out["is_doc"] = [{"in": s, "out": sa.is_doc(s)} for s in DOC]
    out["is_structural"] = [{"in": s, "out": sa._is_structural(s)} for s in STRUCT]
    out["unfenced"] = [{"in": t, "out": [list(x) for x in sa._unfenced(t)]} for t in FENCE]
    out["significant"] = [{"in": t, "out": [list(x) for x in sa.significant_lines(t)], "prose": [list(x) for x in sa.prose_lines(t)]} for t in SIG]
    out["mask_links"] = [{"in": s, "out": sa._mask_links(s)} for s in LINKS]
    out["ordinal"] = [{"in": s, "out": [[o.start(), o.end()] for o in sa._RE_ORDINAL_PREFIX.finditer(s)]} for s in ORD]
    claim = []
    for line in CLAIM_LINES:
        r = sa._count_claims([("k%d.md" % i, line, None) for i in range(3)])
        claim.append({"in": line, "out": sorted([list(k), v["k0.md"][0], v["k0.md"][1]] for k, v in r.items())})
    out["count_claims"] = claim
    out["lstrip_dotslash"] = [{"in": s, "out": s.replace("\\", "/").lstrip("./")} for s in DERIVED]
    path = os.path.join(HERE, "unit", "single-authority.json")
    tmpf = path + ".tmp"
    with open(tmpf, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    back = json.load(open(tmpf, encoding="utf-8"))
    if {k: len(v) for k, v in back.items() if isinstance(v, list)} != {k: len(v) for k, v in out.items() if isinstance(v, list)}:
        sys.exit("回读与内存不一致，拒绝落盘")
    os.replace(tmpf, path)
    print("写出 golden/unit/single-authority.json：" + "、".join("%s %d" % (k, len(v)) for k, v in out.items() if isinstance(v, list)))


if __name__ == "__main__":
    main()
