# -*- coding: utf-8 -*-
"""链接与锚点全解析（第二项自检）。

效力为零：这是载体实例，不是规范条文。

为什么它变成了脚本：此前《仓库工作须知》§2 写的是"没有现成脚本，每次现写"。
2026-09-03 第十三轮现写的那一版忘了排除 .staging/（冻结快照），
报出一批假断链、结论 FAIL——而真实断链是 0（数字与经过见 Case C-016）。
判据本身很短，但"排除哪些目录"这类前提每次重写都会丢，所以固化下来。

扫描面取 git ls-files（已跟踪与已暂存），与 check_all 同口径：未跟踪草稿、
.staging/ 与嵌套 worktree 都不参与。repo_counts.py、check_normative_force.py
直接从这里导入 md_files 与 mask_code，三处计数与判定因此不会互相对不上
（Case C-009 的同型问题）。
"""
import io
import os
import re
import subprocess
import sys

NL = chr(10)
BQ = chr(96)


def mask_code(text):
    """把围栏代码块与行内代码涂白，行号不变——举例中的链接不算数（Case C-011）。"""
    def blank(m):
        return "".join(c if c == NL else " " for c in m.group(0))
    text = re.sub(BQ * 3 + ".*?" + BQ * 3, blank, text, flags=re.S)
    text = re.sub(BQ + "[^" + BQ + NL + "]*" + BQ, blank, text)
    return text


def slug(heading):
    h = heading.strip().lstrip("#").strip()
    h = re.sub(r"[" + BQ + r"*_\[\]()]", "", h)
    return re.sub(r"\s+", "-", h.strip()).lower()


def md_files(root):
    out = subprocess.run(["git", "-C", root, "ls-files", "-z", "--", "*.md"],
                         capture_output=True, check=True).stdout.decode("utf-8")
    return [os.path.join(root, f) for f in out.split("\0")
            if f and os.path.isfile(os.path.join(root, f))]


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    mds = md_files(root)

    anchors = {}
    for f in mds:
        text = io.open(f, encoding="utf-8", errors="replace").read()
        found = set(re.findall(r'<a id="([^"]+)"', text))
        for h in re.findall(r"^#{1,6} .*$", text, flags=re.M):
            found.add(slug(h))
        anchors[os.path.normpath(f)] = found

    link = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
    total = 0
    bad = []
    for f in mds:
        text = mask_code(io.open(f, encoding="utf-8", errors="replace").read())
        for tgt in link.findall(text):
            if re.match(r"^(https?:|mailto:)", tgt):
                continue
            total += 1
            if tgt.startswith("#"):
                if tgt[1:] not in anchors[os.path.normpath(f)]:
                    bad.append((f, tgt, "锚点不存在"))
                continue
            path, _, anc = tgt.partition("#")
            p = os.path.normpath(os.path.join(os.path.dirname(f), path))
            if not os.path.exists(p):
                bad.append((f, tgt, "路径不存在"))
                continue
            # 目录型链接（如 ../归档/参考资料-公众号文章/）没有 README.md 也算通过
            if anc and not os.path.isdir(p):
                if anc not in anchors.get(os.path.normpath(p), set()):
                    bad.append((f, tgt, "锚点不存在"))

    for f, tgt, why in bad:
        print("BROKEN  %s  ->  %s  (%s)" % (f, tgt, why))
    print()
    print("markdown %d 个文件 / %d 条本地链接 / %d 条断链" % (len(mds), total, len(bad)))
    print("PASS" if not bad else "FAIL")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
