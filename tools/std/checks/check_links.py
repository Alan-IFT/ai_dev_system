# -*- coding: utf-8 -*-
"""git 跟踪的 markdown 里，本地链接与锚点是否可达。

执行 01 §3.4「引用」关系的核对方式（linkcheck）与 §3.2 里
`docs/INDEX.md`「指向不存在的路径」这一条过期发现方式。契约见 ../CONTRACT.md。

本模块只用标准库。需要 stdlib 里没有的函数在本文件内实现，不改 stdlib。
"""
from __future__ import annotations

import io
import os
import re
import sys
import tempfile
import time
from urllib.parse import unquote

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 放末尾：不遮住标准库

from stdlib import (  # noqa: E402
    FAIL, PASS, SKIP, UNDETERMINED,
    cfg_get, finding, in_frozen, inside, is_tailored_out, read_text, tracked_files,
    undetermined_from_exception, unreadable,
)

NAME = "links"
STANDARD_REFS = ["01 §3.4 引用", "01 §3.2 docs/INDEX.md", "01 §3.8 跨仓引用按契约处理"]

_NL = chr(10)
_BQ = chr(96)

# [文字](路径) / [文字](路径#锚点) / ![alt](图片)；容许行尾 "title"。
# <> 包裹的目标可以含空格与圆括号（CommonMark），单独一支：第 1 组是它，第 2 组是裸写法
_LINK_RE = re.compile(
    r'\[(?:[^\[\]]|\[[^\[\]]*\])*\]'
    r'\(\s*(?:<([^<>\n]+)>|([^()<>\s]+))(?:\s+"[^"]*"|\s+\'[^\']*\')?\s*\)'
)

# 带协议的目标（http:、mailto:、javascript:、vscode: ……）都不是本地路径，一律跳过（RFC 3986 的 scheme 形状）。
# 至少两个字符：单字母加冒号是 Windows 盘符，归 _WIN_ABS_RE。scheme 不含点、冒号后不是纯行号：
# `a.py:12`、`Makefile:3` 是「本地路径:行号」，按路径核（R2-9）；tel:、sms: 的值本就是纯数字，照跳过
_SKIP_SCHEME_RE = re.compile(r'^(?:(?:tel|sms):|[A-Za-z][A-Za-z0-9+-]+:(?!\d+(?::\d+)?$))', re.I)
_LINE_SUFFIX_RE = re.compile(r':\d+(?::\d+)?$')
_WIN_ABS_RE = re.compile(r'^[A-Za-z]:[\\/]')

_MD_EXT = (".md", ".markdown")

# 线性：不在正则里剥收尾的 `#`（原写法 `(.+?)[ \t]*#*[ \t]*$` 遇长空白行是平方级），交给 _atx_title
_HEADING_RE = re.compile(r"^(#{1,6})[ \t]+(.*)$", re.M)
_EXPLICIT_ANCHOR_RE = re.compile(r'<a\s+(?:id|name)\s*=\s*["\']([^"\']+)["\']', re.I)

_CJK_RE = re.compile(r'[^\x00-\x7f]')


def _mask_code(text):
    """把围栏代码块与行内代码涂白，行号与列位置不变。

    举例里的链接不算断链——这一条来自本仓库 docs/附录-载体实例/linkcheck.py
    记下的真实教训（Case C-011）。
    """
    def blank(m):
        return "".join(c if c == _NL else " " for c in m.group(0))

    text = re.sub(_BQ * 3 + r"[\s\S]*?" + _BQ * 3, blank, text)
    text = re.sub(r"~~~[\s\S]*?~~~", blank, text)
    text = re.sub(_BQ + r"+[^" + _BQ + _NL + r"]*" + _BQ + r"+", blank, text)
    return text


def _slug(heading, keep_inner_underscore=False):
    """GitHub 风格锚点：去内联标记与标点、小写、空格转连字符。

    非 ASCII 字符按 GitHub 的做法保留（\\w 在 Python3 的 re 里含中日韩字符），
    但各平台对中文标题的处理并不一致——所以中文锚点匹配不上时判未定，不判断链。
    `keep_inner_underscore`：词中的下划线（`my_func`）GitHub 会保留，只有贴着词边界的才是强调标记；
    两种都算作可用锚点（`_anchors_of`），宁可少报不误报。
    """
    h = heading.strip()
    # 三处字符类都排除自己的起始符，失败时只扫到下一个起始符：原写法遇满行 `[`、`<` 或长串 `_` 是平方级
    h = re.sub(r"\[([^\[\]]*)\]\([^()]*\)", r"\1", h)   # 链接取其文字
    h = re.sub(r"<[^<>]+>", "", h)                    # 去内联 HTML
    if keep_inner_underscore:
        h = re.sub(r"(?<!\w)_+|(?<!_)_+(?!\w)", "", h)
        h = re.sub(r"[" + _BQ + r"*~]", "", h)
    else:
        h = re.sub(r"[" + _BQ + r"*_~]", "", h)          # 去强调标记
    h = h.lower()
    h = re.sub(r"[^\w\s-]", "", h, flags=re.U)       # 去标点（含全角）
    h = re.sub(r"\s+", "-", h.strip())
    return h


def _atx_title(raw):
    """ATX 标题去掉可选的收尾 `#` 串（前面须有空白，或整行只有 `#`）与首尾空白。"""
    t = raw.rstrip(" \t")
    body = t.rstrip("#")
    if body != t and (not body or body[-1] in " \t"):
        t = body.rstrip(" \t")
    return t.strip()


_SETEXT_RE = re.compile(r"^ {0,3}(?:=+|-+)[ \t]*$")


def _titles(masked):
    """按出现顺序给出标题文字：ATX（`# x`）与 setext（下一行是 `===` / `---`）两种。入参是涂白后的文本。"""
    prev = ""
    for line in masked.split(_NL):
        m = _HEADING_RE.match(line)
        if m:
            yield _atx_title(m.group(2))
            prev = ""
            continue
        if prev.strip() and _SETEXT_RE.match(line) and not prev.startswith((" " * 4, "\t")):
            yield prev.strip()
            prev = ""
            continue
        prev = line


def _anchors_of(text, masked=None):
    """一份 markdown 里可用的锚点集合。masked：调用方已涂白的同一份文本，省一次涂白。"""
    found = set(_EXPLICIT_ANCHOR_RE.findall(text))
    seen = {}
    for title in _titles(_mask_code(text) if masked is None else masked):
        for s in {_slug(title), _slug(title, keep_inner_underscore=True)}:
            if not s:
                continue
            n = seen.get(s, 0)
            found.add(s if n == 0 else "%s-%d" % (s, n))
            seen[s] = n + 1
    return found


class _Cache(object):
    """目标文件读一次就够：几千份 markdown 上不能对每条链接重读一次文件。
    扫描对象与链接目标共用这一份（C22）：扫过的对象再被链接时直接取锚点；还没扫到的对象
    先被当成目标读了，正文留在 pending 里，轮到扫它时取走，不读第二遍。"""

    def __init__(self, root, todo=()):
        self.root = root
        self.todo = set(todo)     # 还没扫到的扫描对象（normpath）
        self.pending = {}
        self.exists = {}
        self.isdir = {}
        self.anchors = {}
        self.errors = {}

    def path_kind(self, abspath):
        key = os.path.normpath(abspath)
        if key not in self.exists:
            self.exists[key] = os.path.exists(abspath)
            self.isdir[key] = os.path.isdir(abspath)
        return self.exists[key], self.isdir[key]

    def anchors_of(self, abspath):
        """返回 (锚点集合, 出错原因)。读不了时锚点为 None。"""
        key = os.path.normpath(abspath)
        if key in self.anchors:
            return self.anchors[key], self.errors.get(key)
        try:
            text = read_text(abspath, self.root)
        except OSError as exc:
            self.anchors[key] = None
            self.errors[key] = "%s: %s" % (type(exc).__name__, exc)
            return None, self.errors[key]
        self.anchors[key] = _anchors_of(text)
        if key in self.todo:
            self.pending[key] = text
        return self.anchors[key], None

    def source_text(self, abspath):
        """取一份扫描对象的正文：先当过目标的从 pending 取走，否则读盘。"""
        key = os.path.normpath(abspath)
        self.todo.discard(key)
        text = self.pending.pop(key, None)
        return read_text(abspath, self.root) if text is None else text


def _markdown_files(cfg):
    """git 跟踪的 markdown。返回 (相对路径列表, 问题)。

    `_links_files` 是给 selftest 用的注入口：自检不该去动任何 git 索引
    （契约 §3 要求自检用最小样本，不碰真实仓库）。除自检外没人设它。
    """
    override = cfg.get("_links_files")
    if override is not None:
        return [str(x).replace("\\", "/") for x in override], None
    root = cfg.get("_root") or "."
    files, problem = tracked_files(root, ["*.md", "*.markdown"])
    if problem:
        return None, problem
    return [f for f in files if f.lower().endswith(_MD_EXT)], None


# --------------------------------------------------------------------------

def scope(cfg):
    frozen = cfg_get(cfg, "layout.frozen", []) or []
    return {
        "covered": [
            "git 跟踪的 *.md / *.markdown 里 [文字](路径) 形式的本地链接：目标文件或目录存在性",
            "目标是 markdown 时，链接里的 #锚点 是否匹配它的 <a id>/<a name> 或标题生成的锚点",
            "归档区（layout.frozen：%s）里的文件同样检查，断链就是断链；报出时在证据里注明它在归档区"
            % ("、".join(map(str, frozen)) or "未配置"),
        ],
        "not_covered": [
            "不检查外链可达性：联网结果不可重复（契约 §7；04 §6.2）",
            "不检查图片内容，只检查图片文件在不在",
            "不检查跨仓库路径的另一侧——那归 check_cross_repo（01 §3.8）",
            "不检查 HTML 里的链接（<a href=…>、<img src=…>）",
            "围栏代码块与行内代码里的链接被涂白，不算数",
            "不解析引用式链接 [文字][标签] 与裸 URL",
            "不带 <> 包裹而路径里有圆括号的链接、跨行书写的链接匹配不到，因而不计入",
            "不检查未被 git 跟踪的 markdown（未提交或被 .gitignore 排除的看不见）",
            "不判断锚点指的片段外延到哪（该问题见 templates/文件树与落地路径.md §7 第 5 条）",
        ],
    }


def run(cfg):
    tailored, reason = is_tailored_out(cfg, NAME)
    if tailored:
        return [finding(NAME, SKIP, "项目已裁剪本检查", reason=reason or "project.yaml 未写理由")]
    try:
        return _run(cfg)
    except Exception as exc:  # noqa: BLE001 - 契约 §1：内部异常一律未定
        return [undetermined_from_exception(NAME, exc, "跑 %s" % NAME)]


def _run(cfg):
    root = cfg.get("_root") or "."
    files, problem = _markdown_files(cfg)
    if problem:
        return [finding(
            NAME, UNDETERMINED, "列不出 git 跟踪的 markdown",
            reason=problem,
            why="01 §3.4：引用关系靠 linkcheck 核对；列不出对象就没有执行过这项检查",
        )]
    if not files:
        return [finding(
            NAME, UNDETERMINED, "没有找到任何 git 跟踪的 markdown",
            reason="采集为空。空输出最常见的原因是采集根本没跑起来"
                   "（templates/文件树与落地路径.md §7 第 4 条），一律记未定",
            why="契约 §1：适用却没执行的检查记未定，不记通过",
        )]

    cache = _Cache(root, (os.path.normpath(os.path.join(root, r.replace("/", os.sep))) for r in files))
    out = []
    merged = {}          # Finding id -> [finding, [行号…], 原始 evidence]
    n_links = 0
    n_bad = 0

    for rel in files:
        abs_src = os.path.join(root, rel.replace("/", os.sep))
        try:
            text = cache.source_text(abs_src)
        except OSError as exc:
            out.append(unreadable(NAME, rel, exc))    # 对象读不了，不是检查器故障（R1-10）
            continue

        frozen_note = "该文件在 layout.frozen 归档区，断链照报，是否修由人定" \
            if in_frozen(cfg, rel) else ""

        masked = _mask_code(text)
        src_anchors = cache.anchors[os.path.normpath(abs_src)] = _anchors_of(text, masked)

        for lineno, line in enumerate(masked.split(_NL), 1):
            if "](" not in line:
                continue
            for wrapped, bare in _LINK_RE.findall(line):
                target = (wrapped or bare).strip()
                if not target or _SKIP_SCHEME_RE.match(target) or target.startswith("//"):
                    continue
                n_links += 1
                where = "%s:%d" % (rel, lineno)

                if _WIN_ABS_RE.match(target):
                    n_bad += 1
                    _merge(out, merged, lineno, finding(
                        NAME, UNDETERMINED, "%s 里是本机绝对路径：%s" % (rel, target),
                        where=where, kind="host-abs", key=rel + "|" + target,
                        reason="绝对路径换一台机器就不成立，本工具不按当前机器的存在性下结论",
                        why="01 §3.4 引用：B 链接 A 且可机械核对；本机绝对路径不可机械核对",
                        evidence=frozen_note,
                    ))
                    continue

                path_part, _, anchor = target.partition("#")
                path_part = unquote(path_part.partition("?")[0])   # ?plain=1 之类是查询串，不是文件名的一部分
                path_part = _LINE_SUFFIX_RE.sub("", path_part)       # `文件:行号` 只核文件（R2-9）
                if not path_part and not anchor:                     # 只有查询串：指向本页，没什么可核
                    continue
                anchor = unquote(anchor)

                # 纯锚点：指向本文件
                if not path_part:
                    if anchor in src_anchors:
                        continue
                    n_bad += 1
                    _merge(out, merged, lineno, _anchor_miss(rel, where, target, anchor, rel, frozen_note))
                    continue

                root_abs = False
                if path_part.startswith("/"):
                    # 仓库根路径：GitHub 按仓根解析，别的渲染器按站点根或主机根——本工具按仓根核，
                    # 核不到只记未定（契约 §1.1：解析方式是约定）
                    abs_tgt = os.path.normpath(os.path.join(root, path_part.lstrip("/").replace("/", os.sep)))
                    root_abs = True
                else:
                    abs_tgt = os.path.normpath(
                        os.path.join(os.path.dirname(abs_src), path_part.replace("/", os.sep)))
                if not inside(root, abs_tgt):
                    n_bad += 1
                    _merge(out, merged, lineno, finding(
                        NAME, UNDETERMINED, "%s 的链接指向被扫项目之外：%s" % (rel, target),
                        where=where, kind="outside-root", key=rel + "|" + target,
                        reason="目标的真实位置不在被扫项目之内；本工具不读、不探测项目之外的路径，"
                               "它在另一台机器上是否存在也不由本仓决定",
                        why="01 §3.4 引用：B 链接 A 且可机械核对；项目之外的目标不在本次核对范围",
                        evidence=frozen_note,
                    ))
                    continue
                if root_abs and not cache.path_kind(abs_tgt)[0]:   # 先过 inside，再探测存在性
                    n_bad += 1
                    _merge(out, merged, lineno, finding(
                        NAME, UNDETERMINED, "%s 的仓根路径链接按仓根找不到：%s" % (rel, target),
                        where=where, kind="root-abs", key=rel + "|" + target,
                        reason="以 / 开头的链接各平台解析不一（GitHub 按仓根、静态站按站点根、"
                               "本地按主机根），按仓根没找到推不出断链",
                        why="01 §3.4 引用：B 链接 A 且可机械核对",
                        evidence=frozen_note,
                    ))
                    continue
                exists, isdir = cache.path_kind(abs_tgt)
                if not exists:
                    n_bad += 1
                    _merge(out, merged, lineno, finding(
                        NAME, FAIL, "%s 指向不存在的路径：%s" % (rel, target),
                        where=where, kind="missing", key=rel + "|" + target,
                        why="01 §3.4 引用关系的核对方式就是 linkcheck；"
                            "01 §3.2 里 INDEX 过期的发现方式是「指向不存在的路径」",
                        evidence="解析为 %s；%s" % (abs_tgt, frozen_note or "不在归档区"),
                    ))
                    continue

                if not anchor:
                    continue
                if isdir or not path_part.lower().endswith(_MD_EXT):
                    # 目录 / 图片 / 非 markdown：只检查存在性（判据第 4 条）
                    continue

                tgt_anchors, err = cache.anchors_of(abs_tgt)
                if tgt_anchors is None:
                    n_bad += 1
                    _merge(out, merged, lineno, finding(
                        NAME, UNDETERMINED, "读不了 %s，锚点 %s 判不了" % (path_part, target),
                        where=where, kind="anchor-unreadable", key=rel + "|" + target,
                        reason=err or "目标文件读取失败",
                        why="01 §3.4：引用要可机械核对；读不了就是没核对过",
                    ))
                    continue
                if anchor in tgt_anchors:
                    continue
                n_bad += 1
                _merge(out, merged, lineno, _anchor_miss(rel, where, target, anchor, path_part, frozen_note))

    out.append(finding(
        NAME, PASS,
        "扫了 %d 份 markdown、%d 条本地链接，%d 条有问题" % (len(files), n_links, n_bad),
        evidence="对象来自 git ls-files；覆盖边界见 scope()。"
                 "本条只说明检查确实跑起来了，问题逐条另列。",
        why="01 §3.4 引用：linkcheck 是这条关系的核对方式",
    ))
    return out


def _lines_note(base, lines):
    note = "出现在第 %s 行（共 %d 处）" % ("、".join(str(n) for n in lines), len(lines))
    return (base + "；" + note) if base else note


def _merge(out, merged, lineno, f):
    """按 Finding id 合并（各条都带 `kind`）：同一份文件里同一个链接目标只出一条。

    id 是 `links/<kind>/<文件>｜<目标>`，同一 (文件, 目标) 重复出现只是同一件事被写了
    多遍——出成多条会让登记册要为同一件事写多行，行号一改登记就失效。行号进 evidence。
    """
    hit = merged.get(f["id"])
    if hit is None:
        base = f.get("evidence") or ""
        f["evidence"] = _lines_note(base, [lineno])
        merged[f["id"]] = [f, [lineno], base]
        out.append(f)
        return
    prev, lines, base = hit
    lines.append(lineno)
    prev["evidence"] = _lines_note(base, lines)


def _anchor_miss(src_rel, where, target, anchor, tgt_rel, frozen_note):
    """锚点没匹配上。中文锚点判未定，ASCII 锚点判 FAIL。"""
    if _CJK_RE.search(anchor):
        return finding(
            NAME, UNDETERMINED, "%s 的锚点 %s 没匹配上（中文锚点）" % (src_rel, target),
            where=where, kind="anchor-cjk", key=src_rel + "|" + target,
            reason="中文标题生成锚点的规则各平台不一致（GitHub、GitLab、静态站生成器各一套），"
                   "匹配不上不能断定是断链，是平台差异；本工具不猜哪一套",
            why="01 §3.4 引用：核对方式是 linkcheck，但判不了的按契约 §1 记未定不记通过",
            evidence="目标 %s；本工具算出的锚点集合里没有 %r。%s" % (tgt_rel, anchor, frozen_note),
        )
    return finding(
        NAME, FAIL, "%s 的锚点不存在：%s" % (src_rel, target),
        where=where, kind="anchor-missing", key=src_rel + "|" + target,
        why="01 §3.4 引用：B 链接 A 不复制 A，靠 linkcheck 核对；锚点失效即引用失效",
        evidence="目标 %s 里既无 <a id=\"%s\">，也没有能生成该锚点的标题。%s"
                 % (tgt_rel, anchor, frozen_note),
    )


def selftest():
    """反例与正例各一。见契约 §3：抓不出违规的检查器，其结论作废。

    用注入的文件清单，不动任何 git 索引，也不碰真实仓库。
    """
    results = []
    try:
        with tempfile.TemporaryDirectory() as tmp:
            def w(name, body):
                with io.open(os.path.join(tmp, name), "w", encoding="utf-8") as fh:
                    fh.write(body)

            w("b.md", "# Hello World\n\n<a id=\"pin\"></a>\n\n正文。\n")
            w("a.md", "# A\n\n见 [b](b.md)、[节](b.md#hello-world)、[锚](b.md#pin)。\n")

            cfg = {"_root": tmp, "_links_files": ["a.md", "b.md"]}
            got_ok = [f["status"] for f in run(cfg)]

            w("a.md",
              "# A\n\n见 [b](b.md)。\n\n坏的一条：[没有这个文件](missing.md)。\n")
            got_bad = [f["status"] for f in run(cfg)]

            results.append(finding(
                NAME, PASS if FAIL in got_bad else FAIL,
                "反例：指向不存在的 missing.md 应判 FAIL",
                evidence="实得 %s" % got_bad,
                why="契约 §3 静默失效探测；判据 01 §3.4 引用",
            ))
            results.append(finding(
                NAME, PASS if (got_ok and set(got_ok) == {PASS}) else FAIL,
                "正例：文件与两个锚点都在，应全判 PASS",
                evidence="实得 %s" % got_ok,
                why="契约 §3 静默失效探测",
            ))

            # 反例二（合并与 id，契约 §9）：同一份文件里同一个中文锚点目标写三次，
            # 只出一条未定，行号进证据，id 里带源文件名。出成三条的话，例外登记就要
            # 为同一件事写三行，而且行号一改登记全失效。
            w("b.md", "# 标题\n\n正文。\n")
            w("a.md", "# A\n\n见 [一](b.md#没有这个锚)。\n\n又见 [二](b.md#没有这个锚)。\n"
                      "\n再见 [三](b.md#没有这个锚)。\n")
            res = run(cfg)
            cjk = [f for f in res if (f.get("id") or "").startswith("links/anchor-cjk/")]
            ok = (len(cjk) == 1
                  and cjk[0]["id"].startswith("links/anchor-cjk/a.md｜")
                  and (cjk[0].get("where") or "") == "a.md:3"
                  and "3、5、7" in (cjk[0].get("evidence") or ""))
            results.append(finding(
                NAME, PASS if ok else FAIL,
                "反例二：同一份文件里同一个链接目标重复出现，应合并成一条、行号进证据、id 带源文件",
                evidence="中文锚点条数 %d；id=%s；where=%s；证据=%r"
                         % (len(cjk),
                            cjk[0]["id"] if cjk else "（无）",
                            cjk[0].get("where") if cjk else "（无）",
                            (cjk[0].get("evidence") or "")[:120] if cjk else "（无）"),
                why="契约 §9：登记行写的是 id，同一件事出成多条会逼着登记也写多行",
            ))
            # 反例四（约定，D-123）：词中下划线锚点、setext 标题锚点、仓根 / 路径、<> 包裹含空格的路径
            # 都按实际渲染认；仓根路径找不到只记未定（解析方式是约定），<> 里的缺文件照判 FAIL
            os.makedirs(os.path.join(tmp, "sub"), exist_ok=True)
            w("b.md", "# my_func\n\nSetext 标题行\nSetext Title\n===\n")
            w("my file.md", "# x\n")
            w("sub/a.md", "[1](../b.md#my_func) [2](../b.md#setext-title) [3](/b.md) "
                          "[4](</my file.md>) [5](<../my file.md>) [6](/nope.md) [7](<../no such.md>)\n")
            res = run({"_root": tmp, "_links_files": ["sub/a.md", "b.md", "my file.md"]})
            bad = sorted((f["status"], f["title"].split("：", 1)[-1]) for f in res if f["status"] != PASS)
            want = [(FAIL, "<../no such.md>"), (UNDETERMINED, "/nope.md")]
            results.append(finding(
                NAME, PASS if [(st, t.strip("<>").replace("../", "")) for st, t in bad] ==
                [(st, t.strip("<>").replace("../", "")) for st, t in want] else FAIL,
                "反例四：下划线锚点、setext 锚点、仓根路径、<> 包裹路径按实际渲染认；仓根找不到记未定",
                evidence="非通过项 %s；应得 %s" % (bad, want),
                why="契约 §1.1：约定落空只记未定；01 §3.4 引用核对不得误报",
            ))

            # 反例五（C19 C20）：同一缺失文件、同一 ASCII 缺失锚点各写两遍，各只出一条 FAIL、id 带 kind；
            # ?plain=1 是查询串（b.md 在），javascript:/vscode: 之类带协议的不是本地路径
            w("b.md", "# b\n")
            w("a.md", "[x](gone.md)\n[y](gone.md)\n[z](b.md#nope)\n[z](b.md#nope)\n"
                      "[q](b.md?plain=1) [v](vscode:extension/x) [n](news:comp.lang)"
                      " [t](tel:10086) [s](sms:10086)\n")
            got = sorted((f["status"], f["id"]) for f in run(cfg) if f["status"] != PASS)
            want = [(FAIL, "links/anchor-missing/a.md｜b.md#nope"), (FAIL, "links/missing/a.md｜gone.md")]
            results.append(finding(
                NAME, PASS if got == want else FAIL,
                "反例五：同一缺失目标只出一条 FAIL、id 不随行号漂；查询串与带协议的目标不当本地路径",
                evidence="非通过项 %s；应得 %s" % (got, want),
                why="契约 §4/§9：id 是登记的地址；01 §3.4 引用核对不得误报",
            ))

            # C22：互相链接的两份 markdown 各只读一遍（旧写法作为链接目标时再读一遍）
            w("a.md", "# A\n\n[b](b.md#b)\n")
            w("b.md", "# B\n\n[a](a.md#a)\n")
            reads, real_read = [], globals()["read_text"]
            globals()["read_text"] = lambda p, r=None: (reads.append(os.path.normpath(p)), real_read(p, r))[1]
            try:
                got = [f["status"] for f in run({"_root": tmp, "_links_files": ["a.md", "b.md"]})]
            finally:
                globals()["read_text"] = real_read
            results.append(finding(
                NAME, PASS if got == [PASS] and len(reads) == 2 == len(set(reads)) else FAIL,
                "C22：互相链接的两份 markdown 各只读一遍",
                evidence="实得 %s；读 %d 次：%s" % (got, len(reads), [os.path.basename(r) for r in reads]),
                why="一次扫描里同一份文件不重复 I/O",
            ))

            # R2-9：`文件:行号` 按本地路径核（文件在则通过、不在判断链），只有查询串的链接不核
            w("x.py", "print(1)\n")
            w("a.md", "[t](x.py:12) [m](x.py:3:5) [g](gone.py:10) [q](?plain=1)\n")
            got = sorted((f["status"], f["id"]) for f in run({"_root": tmp, "_links_files": ["a.md"]})
                         if f["status"] != PASS)
            want = [(FAIL, "links/missing/a.md｜gone.py:10")]
            results.append(finding(
                NAME, PASS if got == want else FAIL,
                "R2-9：文件:行号 按本地路径核，只有查询串的链接不当锚点",
                evidence="非通过项 %s；应得 %s" % (got, want), why="01 §3.4 引用核对不得漏报也不得误报",
            ))

            # 反例三（安全，D-123）：指向项目之外的链接与经符号链接出仓的 markdown 不读、不判断链，记未定；
            # 标题行里一长串空白不许把锚点计算拖成平方级
            with tempfile.TemporaryDirectory() as outside:
                secret = os.path.join(outside, "secret.md")
                with io.open(secret, "w", encoding="utf-8") as fh:
                    fh.write("# TOPSECRET\n")
                os.symlink(secret, os.path.join(tmp, "c.md"))
                w("a.md", "# A\n\n[外](../x/secret.md) [链](c.md#topsecret) [长](b.md#a-x)\n")
                w("b.md", "# a" + " " * 3000 + "x\n")   # 旧正则下这一行约 12 秒
                # 满行 `[`、`<`、长串词中 `_` 的标题：旧 _slug 下 4 万字符分别约 6.7、1.1、10.4 秒（C03）
                w("d.md", "# " + "[" * 40000 + "\n# " + "<" * 40000 + "\n# a" + "_" * 40000 + "b\n")
                w("a.md", "# A\n\n[外](../x/secret.md) [链](c.md#topsecret) [长](b.md#a-x) [根](/../x/y.md)"
                          " [满](d.md#ab)\n")
                cfg3 = {"_root": tmp, "_links_files": ["a.md", "b.md", "c.md", "d.md"]}
                probed, real_exists = [], os.path.exists
                os.path.exists = lambda p: (probed.append(p), real_exists(p))[1]
                t0 = time.time()
                try:
                    res = run(cfg3)
                finally:
                    os.path.exists = real_exists
                took = time.time() - t0
                # 仓根路径 `/../x` 字面就出了项目：先判越界，不探测存在性（B4）
                took += 100 * any(not os.path.abspath(p).startswith(os.path.abspath(tmp) + os.sep)
                                  for p in probed)
            kinds = sorted(set(f["id"].split("/")[1] for f in res if f["status"] != PASS))
            leaked = any("TOPSECRET" in (f.get("evidence") or "") + (f.get("title") or "") for f in res)
            ok = (FAIL not in [f["status"] for f in res] and "outside-root" in kinds
                  and not leaked and took < 5)
            results.append(finding(
                NAME, PASS if ok else FAIL,
                "反例三：项目之外的链接目标与出仓符号链接记未定、不读内容；长空白、满行 [ / < / _ 的标题线性",
                evidence="非通过项 kind=%s；泄露内容=%s；耗时 %.2fs" % (kinds, leaked, took),
                why="D-123 安全 2／3：不读项目之外的文件；一个文件不许拖死整次检查",
            ))
    except Exception as exc:  # noqa: BLE001
        results.append(undetermined_from_exception(NAME, exc, "跑自检"))
    return results
