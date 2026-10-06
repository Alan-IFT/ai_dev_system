#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""layout 的存在性判据 `glob` 的单元黄金样本：Python `glob.glob(os.path.join(glob.escape(root), pattern))` 在真实夹具上对各种通配写法的命中集合。

layout 只用到三条候选：`tools/check_*.py`、`tools/*/check_*.py`、`tools/*/checks/check_*.py`，且扫描根可能含 `[ ] * ?`（C14：根要按字面，只有候选部分是通配）。
JS 没有内置 glob（Node 22 的 `fs.globSync` 是实验性的、语义也不同），所以不引依赖、自己实现这三种形态够用的子集：**`*` 与 `?` 只在单个路径段内、不匹配隐藏文件（以 `.` 开头）、字符类 `[...]`**。
这里把 Python 的行为钉成样本，覆盖：隐藏文件、中文名、空格、大小写、符号链接、目录与文件同名、根里带通配字符。
用法：python golden/make_unit_glob.py
"""
import glob
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))

TREE_FILES = [
    "tools/check_a.py", "tools/check_b.txt", "tools/Check_c.py", "tools/check_.py", "tools/check_中文.py", "tools/check x.py", "tools/.check_hidden.py",
    "tools/x/check_d.py", "tools/x/check_e.pyc", "tools/.h/check_f.py", "tools/x/checks/check_g.py", "tools/x/y/checks/check_deep.py", "tools/中文/checks/check_h.py",
    "tools/sub dir/checks/check_i.py", "tools/x/checks/sub/check_j.py", "tools/check_dir.py/inner.txt", "tools/a[b]/check_k.py", "tools/a*b/check_l.py",
    "docs/a.md", "docs/b.md", "docs/.hidden.md", "docs/sub/c.md", "A.MD", "a.md",
    # 变异验证补：字符类边界（`^` 在 Python 的 fnmatch 里是字面不是取反）、`]` 作首字符、名字里含 `-`、`.` 的文件
    "cls/^.md", "cls/].md", "cls/a.md", "cls/b.md", "cls/x.md", "cls/ab.md", "cls/a-b.md", "cls/a.b.md", "cls/\u4e2d.md",
    "nl/a\nb.md", "nl/a b.md",     # 文件名含换行：`?`、`*` 在 Python 的 fnmatch 里匹配换行（DOTALL）。Windows 上造不出这个名字，样本在 Windows 上生成时会缺它
]
PATTERNS = [
    "tools/check_*.py", "tools/*/check_*.py", "tools/*/checks/check_*.py", "tools/*", "tools/*/*", "tools/**/check_*.py", "tools/check_?.py", "tools/check_[ab].py", "tools/check_[!a].py",
    "tools/check_[a-b].py", "tools/[Cc]heck_*.py", "tools/*.py", "*.md", "docs/*.md", "docs/*", "docs/.*", "docs/?.md", "nope/*", "tools/x/*", "tools/x/checks/*", "tools/x/*/",
    "tools/check_*.py/", "tools/check_dir.py", "tools/check_dir.py/*", "tools/*/inner.txt", "tools/a[[]b]/check_k.py", "tools/a?b/check_*.py", "tools/[a]*/check_*.py", "tools/",
    "tools/check_*", "tools/*check*", "tools/.*", "tools/*/.*", "", "*", "*/*", "tools/check_[", "tools/check_[]", "tools/check_[a", "tools/check_\\*.py",
    "cls/[]].md", "cls/[]a].md", "cls/[!]].md", "cls/[^a].md", "cls/[a^].md", "cls/[a", "cls/a[.md", "cls/[]", "cls/[!]", "cls/[]a", "cls/[!a-b].md", "cls/?.md", "cls/*.md",
    "cls/a?b.md", "cls/a*b.md", "cls/[a-b].md", "cls/[!a].md", "cls/[.]b.md", "cls/a[.]b.md", "cls/[a-]b.md", "cls/[-a]b.md", "cls/[\u4e00-\u9fff].md", "cls/[a\\]].md",
    "nl/a?b.md", "nl/a*b.md", "nl/*.md", "nl/a[ \n]b.md", "tools/check_dangling.py", "tools/check_ln.py", "tools/lndir", "tools/lndir/check_d.py", "tools/no-such-target",
    "tools//check_a.py", "tools///check_a.py", "./tools/check_*.py", "tools/./check_*.py", "tools/../tools/check_*.py", "tools/x/../check_*.py",
    # 不收 `/` 与 `//`：它们指向文件系统根（与扫描根无关），不属于 layout 用到的子集；Python 的结论是偶然的（`/` 命中一串 `../../..`）
]
ROOT_NAMES = ["plain", "a[b]", "a*b", "a?b", "中文 root"]


def can_make(rel):
    """Windows 的文件名不允许 `*` 与 `?`（也不允许 `"<>|:`）：这类夹具与根名在该平台上**造不出**，不是 Python 的行为。跳过并在样本里如实记下。"""
    return not (sys.platform == "win32" and any(c in rel for c in '*?"<>|:\n'))


def build(root):
    made = []
    for rel in TREE_FILES:
        if not can_make(rel):
            continue
        p = os.path.join(root, rel.replace("/", os.sep))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "w", encoding="utf-8").close()
        made.append(rel)
    build.made = made
    try:
        os.symlink(os.path.join(root, "tools", "check_a.py"), os.path.join(root, "tools", "check_ln.py"))
        os.symlink(os.path.join(root, "tools", "x"), os.path.join(root, "tools", "lndir"), target_is_directory=True)
        os.symlink(os.path.join(root, "tools", "no-such-target"), os.path.join(root, "tools", "check_dangling.py"))
        return True
    except OSError:
        return False


def main():
    out = {"platform": sys.platform, "python": sys.version.split()[0], "symlink": False, "patterns": PATTERNS, "tree": TREE_FILES, "root_names": ROOT_NAMES, "cases": []}
    base = tempfile.mkdtemp(prefix="goldglob-")
    try:
        out["skipped_roots"] = [rn for rn in ROOT_NAMES if not can_make(rn)]
        for rn in ROOT_NAMES:
            if not can_make(rn):
                continue
            root = os.path.join(base, rn)
            os.makedirs(root)
            sym = build(root)
            out["tree_made"] = build.made
            out["symlink"] = out["symlink"] or sym
            for pat in PATTERNS:
                # 与 layout 一致：根按字面（escape），候选部分是通配
                hits = glob.glob(os.path.join(glob.escape(root), pat.replace("/", os.sep)))
                rel = sorted(os.path.relpath(h, root).replace(os.sep, "/") for h in hits)
                # 对照：不 escape 的写法在带通配字符的根上的结果（C14 的反例）
                raw = sorted(os.path.relpath(h, root).replace(os.sep, "/") for h in glob.glob(os.path.join(root, pat.replace("/", os.sep))) if h.startswith(root))
                out["cases"].append({"root": rn, "pattern": pat, "hits": rel, "unescaped_hits": raw})
    finally:
        shutil.rmtree(base, ignore_errors=True)
    path = os.path.join(HERE, "unit", "glob.json")
    tmpf = path + ".tmp"
    with open(tmpf, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    if len(json.load(open(tmpf, encoding="utf-8"))["cases"]) != len(out["cases"]):
        sys.exit("回读与内存不一致，拒绝落盘")
    os.replace(tmpf, path)
    nonempty = sum(1 for c in out["cases"] if c["hits"])
    print("写出 golden/unit/glob.json：%d 条（命中非空 %d），platform=%s，符号链接可用=%s；本平台造不出的根名 %s，造不出的夹具 %d 个"
          % (len(out["cases"]), nonempty, sys.platform, out["symlink"], out["skipped_roots"], len(TREE_FILES) - len(out["tree_made"])))


if __name__ == "__main__":
    main()
