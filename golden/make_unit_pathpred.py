#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""路径谓词（os.path.isfile / isdir / lexists）的单元黄金样本：在**真实夹具**上对各种写法的路径记 Python 的结论。

起因：entry_budget 迁移时发现，路径带尾斜杠的**普通文件**（`S.md/`），Python 的 `os.path.isfile` 为 False，Node 的 `statSync(...).isFile()` 在 Windows 上为 True。
`isFile`/`isDir` 当时在 5 个文件里各写了一份、都直接用 Node 的行为——这违反「同一事实只一处」，也让这个差异无处统一修。
所以先把 Python 的行为钉成样本，再在 core/fs 里写唯一一份。

夹具：普通文件、目录、空文件、符号链接（到文件/到目录/断链）、含空格与中文名。路径写法：原样、尾斜杠、尾反斜杠、尾点、尾空格、双斜杠、`.` 段、`..` 段、大小写变体。
用法：python golden/make_unit_pathpred.py
"""
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))

FILES = ["f.md", "empty.md", "a b.md", "中文.md", "sub/g.md"]
DIRS = ["d", "d2/inner"]
SUFFIXES = ["", "/", "//", "\\", "/.", "/./", " ", ".", "\\.", "/..", "/../f.md", "/sub/..", "?", "*"]


def main():
    tmp = tempfile.mkdtemp(prefix="goldpp-")
    out = {"platform": sys.platform, "python": sys.version.split()[0], "symlink": False, "cases": []}
    try:
        for f in FILES:
            os.makedirs(os.path.dirname(os.path.join(tmp, f)), exist_ok=True)
            with open(os.path.join(tmp, f), "wb") as fh:
                fh.write(b"" if f == "empty.md" else b"x\n")
        for d in DIRS:
            os.makedirs(os.path.join(tmp, d), exist_ok=True)
        names = FILES + DIRS + ["nope", "nope/deeper", "F.MD", "D"]
        try:
            os.symlink(os.path.join(tmp, "f.md"), os.path.join(tmp, "ln_file"))
            os.symlink(os.path.join(tmp, "d"), os.path.join(tmp, "ln_dir"), target_is_directory=True)
            os.symlink(os.path.join(tmp, "no-such"), os.path.join(tmp, "ln_dangling"))
            out["symlink"] = True
            names += ["ln_file", "ln_dir", "ln_dangling"]
        except OSError:
            pass
        for n in names:
            for s in SUFFIXES:
                rel = n + s
                p = os.path.join(tmp, rel.replace("/", os.sep)) if "\\" not in rel else os.path.join(tmp, rel)
                # 路径原文按「相对夹具」记；不含临时目录
                out["cases"].append({"rel": rel, "isfile": os.path.isfile(p), "isdir": os.path.isdir(p), "lexists": os.path.lexists(p)})
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    path = os.path.join(HERE, "unit", "pathpred.json")
    tmpf = path + ".tmp"
    with open(tmpf, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    if len(json.load(open(tmpf, encoding="utf-8"))["cases"]) != len(out["cases"]):
        sys.exit("回读与内存不一致，拒绝落盘")
    os.replace(tmpf, path)
    t = sum(1 for c in out["cases"] if c["isfile"])
    print("写出 golden/unit/pathpred.json：%d 条（isfile 为真 %d），platform=%s，符号链接可用=%s" % (len(out["cases"]), t, sys.platform, out["symlink"]))


if __name__ == "__main__":
    main()
