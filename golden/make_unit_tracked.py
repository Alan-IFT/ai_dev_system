#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""`tracked_files` / `markdown_under` / `work_items` 的单元黄金样本：在**真实夹具 git 仓**上对各种文件名与模式记 Python 的结论。

夹具：普通文件、中文名、空格、含 `*` `?` `[` `:` 的名字（Windows 上造不出的跳过并记下）、大小写后缀（.MD）、嵌套目录、以点开头、工作项目录与其子目录、
被 .gitignore 忽略的（不入索引）、未跟踪的（不入索引）、已删除但仍在索引里的、子模块式的嵌套仓（git 把它当 gitlink）。
模式：无、`*.md`、`*.markdown`、两者并给、目录前缀、不存在的、含通配的。
另有「非仓」（普通目录）与「空仓」（无提交）的返回。
用法：python golden/make_unit_tracked.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "tools", "std"))
import stdlib as sl  # noqa: E402

FILES = [
    "README.md", "a.MD", "b.markdown", "c.txt", "docs/x.md", "docs/sub/y.md", "docs/sub/deep/z.md", "docs/state/work/WI-001-a.md", "docs/state/work/WI-002-b.md",
    "docs/state/work/notes.md", "docs/state/work/artifacts/out.md", "docs/state/work/sub/WI-009.md", "中文.md", "目录/文档.md", "sp ace.md", ".hidden.md", ".dot/in.md",
    "weird[1].md", "w#h.md", "m[1].json", "m1.json", "a,b.md", "dup.md", "x/dup.md", "docs/UPPER.MD", "docs.md", "docsx/n.md", "work/current.md", "e.md.bak",
    # 排序：码点序与 UTF-16 码元序在非 BMP 字符上不同（U+FF21 的码元 0xFF21 大于 😀 的首码元 0xD83D，而码点上 U+FF21 小于 U+1F600）
    "srt/\uff21.md", "srt/\U0001f600.md", "srt/z.md",
]
NOT_ON_WIN = ["star*.md", "q?.md", 'col:on.md']


def main():
    out = {"python": sys.version.split()[0], "platform": sys.platform, "files": FILES, "cases": [], "not_made": []}
    tmp = tempfile.mkdtemp(prefix="goldtr-")
    try:
        git = ["git", "-C", tmp, "-c", "init.defaultBranch=main", "-c", "user.email=a@b.c", "-c", "user.name=n", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", "-c", "core.quotepath=true"]
        subprocess.run(git + ["init", "-q"], check=True)
        made = []
        for rel in FILES + NOT_ON_WIN:
            p = os.path.join(tmp, rel)
            try:
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p, "w", encoding="utf-8") as fh:
                    fh.write("x\n")
                # Windows 上 `col:on.md` 不抛异常——NTFS 把冒号当备用数据流，实际建出的是名为 `col` 的文件。必须核对「同名文件真的在目录里」才算造成
                if os.path.basename(rel) not in os.listdir(os.path.dirname(p) or tmp):
                    out["not_made"].append(rel)
                    continue
                made.append(rel)
            except OSError:
                out["not_made"].append(rel)
        with open(os.path.join(tmp, ".gitignore"), "w") as fh:
            fh.write("ignored.md\nbuild/\n")
        for rel in ("ignored.md", "build/o.md", "untracked.md"):
            os.makedirs(os.path.dirname(os.path.join(tmp, rel)) or tmp, exist_ok=True)
            with open(os.path.join(tmp, rel), "w") as fh:
                fh.write("x\n")
        add = [r for r in made if r != "untracked.md"] + [".gitignore"]
        r = subprocess.run(git + ["--literal-pathspecs", "add", "-f", "--"] + add, capture_output=True)   # 夹具自己的 add 要按字面：`weird[1].md` 不能被当成通配
        if r.returncode != 0:
            sys.exit("夹具 git add 失败：%s" % r.stderr.decode("utf-8", "replace")[:400])
        # 暂存区之外的两类：一份已删除但仍在索引里；一份已改名未提交
        os.remove(os.path.join(tmp, "dup.md"))
        out["made"] = made

        def call(root, patterns):
            try:
                files, prob = sl.tracked_files(root, patterns)
                return {"files": None if files is None else sorted(files), "problem": prob}
            except Exception as exc:  # noqa: BLE001
                return {"raised": type(exc).__name__}

        for pat in (None, ["*.md"], ["*.markdown"], ["*.md", "*.markdown"], ["docs"], ["docs/"], ["docs/state/work"], ["nope"], ["*.nope"], ["docs/*.md"], ["docs/**/*.md"], [":(top)*.md"], ["*.MD"], ["[ab].md"], ["weird[1].md"], ["m[1].json"], ["?.md"], [".*"], ["中文.md"], ["目录"], [], [""]):
            r = call(tmp, pat)
            r["patterns"] = pat
            out["cases"].append(r)
        mds = {}
        for sub in ("docs", "docs/", ".", "", "docs/state/work", "docs/state/work/", "docs/sub", "nope", "work", "docs/sub/deep", " docs ", "./docs", "docs\\sub", "目录", "docsx"):
            try:
                files, prob = sl.markdown_under(tmp, sub)
                mds[sub] = {"files": files, "problem": prob}
            except Exception as exc:  # noqa: BLE001
                mds[sub] = {"raised": type(exc).__name__}
        out["markdown_under"] = mds
        wis = {}
        for wr in ("docs/state/work", "docs/state/work/", "docs/state/work/artifacts", "docs", ".", "", "nope", "work", "docs/sub", " docs/state/work ", "./docs/state/work", "docs\\state\\work"):
            try:
                files, prob = sl.work_items(tmp, wr)
                wis[wr] = {"files": files, "problem": prob}
            except Exception as exc:  # noqa: BLE001
                wis[wr] = {"raised": type(exc).__name__}
        out["work_items"] = wis
        # 非仓与空仓
        plain = tempfile.mkdtemp(prefix="goldtr-plain-")
        empty = tempfile.mkdtemp(prefix="goldtr-empty-")
        subprocess.run(["git", "-C", empty, "-c", "init.defaultBranch=main", "init", "-q"], check=True)
        nonexist = os.path.join(plain, "no-such-dir")
        try:
            out["not_repo"] = {k: {kk: (vv if kk != "problem" else (None if vv is None else vv.split("：")[0] + "：…")) for kk, vv in call(p, None).items()} for k, p in (("plain", plain), ("empty", empty), ("nonexist", nonexist))}
            out["not_repo"]["_problem_prefix"] = [(call(p, None).get("problem") or "")[:22] for p in (plain, nonexist)]
        finally:
            shutil.rmtree(plain, ignore_errors=True)
            shutil.rmtree(empty, ignore_errors=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    path = os.path.join(HERE, "unit", "tracked.json")
    tmpf = path + ".tmp"
    with open(tmpf, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    if len(json.load(open(tmpf, encoding="utf-8"))["cases"]) != len(out["cases"]):
        sys.exit("回读与内存不一致，拒绝落盘")
    os.replace(tmpf, path)
    print("写出 golden/unit/tracked.json：模式 %d、markdown_under %d、work_items %d；本平台造不出的文件 %s" % (len(out["cases"]), len(out["markdown_under"]), len(out["work_items"]), out["not_made"]))


if __name__ == "__main__":
    main()
