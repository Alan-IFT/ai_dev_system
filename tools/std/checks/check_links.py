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
from urllib.parse import unquote

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from stdlib import (  # noqa: E402
    FAIL, PASS, SKIP, UNDETERMINED,
    cfg_get, finding, in_frozen, is_tailored_out, read_text, tracked_files,
    undetermined_from_exception,
)

NAME = "links"
STANDARD_REFS = ["01 §3.4 引用", "01 §3.2 docs/INDEX.md", "01 §3.8 跨仓引用按契约处理"]

_NL = chr(10)
_BQ = chr(96)

# [文字](路径) / [文字](路径#锚点) / ![alt](图片)；容许 <> 包裹与行尾 "title"
_LINK_RE = re.compile(
    r'\[(?:[^\[\]]|\[[^\[\]]*\])*\]'
    r'\(\s*<?([^()<>\s]+)>?(?:\s+"[^"]*"|\s+\'[^\']*\')?\s*\)'
)

# 跳过的协议：契约要求跳过 http/https/mailto，另加几个同样不是本地路径的
_SKIP_SCHEME_RE = re.compile(r'^(?:https?|mailto|ftp|ftps|tel|sms|data|file|irc|ssh|git):', re.I)
_WIN_ABS_RE = re.compile(r'^[A-Za-z]:[\\/]')

_MD_EXT = (".md", ".markdown")

_HEADING_RE = re.compile(r"^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$", re.M)
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


def _slug(heading):
    """GitHub 风格锚点：去内联标记与标点、小写、空格转连字符。

    非 ASCII 字符按 GitHub 的做法保留（\\w 在 Python3 的 re 里含中日韩字符），
    但各平台对中文标题的处理并不一致——所以中文锚点匹配不上时判未定，不判断链。
    """
    h = heading.strip()
    h = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", h)   # 链接取其文字
    h = re.sub(r"<[^>]+>", "", h)                    # 去内联 HTML
    h = re.sub(r"[" + _BQ + r"*_~]", "", h)          # 去强调标记
    h = h.lower()
    h = re.sub(r"[^\w\s-]", "", h, flags=re.U)       # 去标点（含全角）
    h = re.sub(r"\s+", "-", h.strip())
    return h


def _anchors_of(text):
    """一份 markdown 里可用的锚点集合。"""
    found = set(_EXPLICIT_ANCHOR_RE.findall(text))
    seen = {}
    for _, title in _HEADING_RE.findall(_mask_code(text)):
        s = _slug(title)
        if not s:
            continue
        n = seen.get(s, 0)
        found.add(s if n == 0 else "%s-%d" % (s, n))
        seen[s] = n + 1
    return found


class _Cache(object):
    """目标文件读一次就够：几千份 markdown 上不能对每条链接重读一次文件。"""

    def __init__(self):
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
            text = read_text(abspath)
        except OSError as exc:
            self.anchors[key] = None
            self.errors[key] = "%s: %s" % (type(exc).__name__, exc)
            return None, self.errors[key]
        self.anchors[key] = _anchors_of(text)
        return self.anchors[key], None


_C_ESCAPES = {"a": 7, "b": 8, "f": 12, "n": 10, "r": 13, "t": 9, "v": 11,
              "\\": 92, '"': 34}


def _unquote_git_path(p):
    """还原 git ls-files 的 C 风格转义路径。

    core.quotepath 默认开启，含非 ASCII 的路径会被输出成 "docs/\\345\\275\\222/x.md"。
    不还原就会把本仓库全部中文路径当成不存在的文件——那是假 FAIL。
    stdlib.tracked_files 不做这层还原，本模块自己做（不改 stdlib）。
    """
    if len(p) < 2 or p[0] != '"' or p[-1] != '"':
        return p
    body = p[1:-1]
    out = bytearray()
    i = 0
    while i < len(body):
        ch = body[i]
        if ch == "\\" and i + 1 < len(body):
            nxt = body[i + 1]
            if nxt in _C_ESCAPES:
                out.append(_C_ESCAPES[nxt])
                i += 2
                continue
            if nxt.isdigit() and i + 4 <= len(body):
                try:
                    out.append(int(body[i + 1:i + 4], 8))
                    i += 4
                    continue
                except ValueError:
                    pass
            out.extend(nxt.encode("utf-8"))
            i += 2
            continue
        out.extend(ch.encode("utf-8"))
        i += 1
    return out.decode("utf-8", "replace")


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
    files = [_unquote_git_path(f) for f in files]
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
            "路径里带圆括号的链接、跨行书写的链接匹配不到，因而不计入",
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

    cache = _Cache()
    out = []
    merged = {}          # Finding id -> [finding, [行号…], 原始 evidence]
    n_links = 0
    n_bad = 0

    for rel in files:
        abs_src = os.path.join(root, rel.replace("/", os.sep))
        try:
            text = read_text(abs_src)
        except OSError as exc:
            out.append(undetermined_from_exception(NAME, exc, "读 %s" % rel))
            continue

        frozen_note = "该文件在 layout.frozen 归档区，断链照报，是否修由人定" \
            if in_frozen(cfg, rel) else ""

        masked = _mask_code(text)
        src_anchors = None   # 惰性：只有出现 #锚点 才算本文件的锚点

        for lineno, line in enumerate(masked.split(_NL), 1):
            if "](" not in line:
                continue
            for raw in _LINK_RE.findall(line):
                target = raw.strip()
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
                path_part = unquote(path_part)
                anchor = unquote(anchor)

                # 纯锚点：指向本文件
                if not path_part:
                    if src_anchors is None:
                        src_anchors = _anchors_of(text)
                    if anchor in src_anchors:
                        continue
                    n_bad += 1
                    _emit_anchor_miss(out, merged, lineno,
                                      _anchor_miss(rel, where, target, anchor, rel, frozen_note))
                    continue

                abs_tgt = os.path.normpath(
                    os.path.join(os.path.dirname(abs_src), path_part.replace("/", os.sep)))
                exists, isdir = cache.path_kind(abs_tgt)
                if not exists:
                    n_bad += 1
                    out.append(finding(
                        NAME, FAIL, "%s 指向不存在的路径：%s" % (rel, target),
                        where=where,
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
                _emit_anchor_miss(out, merged, lineno,
                                  _anchor_miss(rel, where, target, anchor, path_part, frozen_note))

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
    """带 `kind` 的未定三类按 Finding id 合并：同一份文件里同一个链接目标只出一条。

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


def _emit_anchor_miss(out, merged, lineno, f):
    """锚点没匹配上：中文那支（未定，带 kind）合并，ASCII 那支（FAIL）逐处照报。"""
    if f["status"] == UNDETERMINED:
        _merge(out, merged, lineno, f)
    else:
        out.append(f)


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
        where=where,
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
    except Exception as exc:  # noqa: BLE001
        results.append(undetermined_from_exception(NAME, exc, "跑自检"))
    return results
