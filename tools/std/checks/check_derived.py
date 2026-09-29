# -*- coding: utf-8 -*-
"""派生工件：由源机械生成，且自己说清自己是派生物。

执行 01 §3.4（派生关系的核对方式）与 02 §9（派生工件按缓存处理）。
契约见 ../CONTRACT.md。
"""
from __future__ import annotations

import io
import os
import re
import subprocess
import sys
import tempfile

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 放末尾：不遮住标准库

from stdlib import (  # noqa: E402
    shallow_problem, read_bytes, FAIL, PASS, SKIP, UNDETERMINED,
    cfg_get, finding, is_tailored_out, undetermined_from_exception,
)

NAME = "derived-artifacts"
STANDARD_REFS = ["01 §3.4", "02 §9"]

_HEADER_LINES = 30          # 自我声明只看头部这么多行（02 §9.1 说的是"头部声明"）
_HEADER_MAX_BYTES = 8192
_GIT_TIMEOUT = 60

# 02 §9.1 的门槛是两件事：说清**权威是谁**，并记 source_rev。只说"我是自动生成的"
# 不算——接手者仍然不知道该去改哪个文件。所以标记分成两组：
#
# 1. `_SOURCE_MARKERS` 与源路径/源文件名一起，构成**判 PASS 的唯一依据**。
# 2. `_GENERATED_MARKERS` / `_GENERATOR_HINTS` 只用来**把证据说准**，命中不改变状态。
#
# 曾经的 `_DECLARE_MARKERS` 把两组混在一起、命中即 PASS，门槛比 02 §9.1 低。
# 收紧时实测过本仓 10 份派生 HTML：0 份靠生成类标记拿到 PASS，故本次收紧影响为 0。
_SOURCE_MARKERS = (
    u"source_rev", u"source-rev", u"sourcerev",
)

# "这是生成物"的措辞。命中不足以判 PASS。按子串匹配，所以不列被别的词包含的变体
# （auto-generated ⊃ generated、regenerate ⊃ regen、请勿手改 ⊃ 勿手改）。
_GENERATED_MARKERS = (
    u"source:", u"source =", u"sources:",
    u"generated", u"do not edit", u"regen",
    u"派生", u"生成", u"自动产出", u"不要手改", u"勿手改",
    u"不要手工修改", u"请勿编辑", u"权威是", u"权威在",
)

# 工具链写的产出者署名（HTML 的 <meta name="generator">、HTTP 的 X-Generator 等）。
# **不进判 PASS 的集合**：它说的是"谁生成的"，不是"源是谁"。命中只改措辞，状态仍 FAIL。
_GENERATOR_HINTS = (
    u'name="generator"', u"name='generator'", u"x-generator", u"generated-by", u"generator:",
)


# --------------------------------------------------------------------------
# 本模块自备的小工具（不改 stdlib，见任务纪律）
# --------------------------------------------------------------------------

def git_last_commit_epoch(root, relpath, shallow):
    """该路径最后一次提交的时间戳。返回 (epoch, 原因)；取不到时 epoch 为 None。
    shallow 是本次扫描探测一次的 shallow_problem(root)，不逐条再起子进程（C22）。"""
    if shallow:
        return None, shallow
    # --literal-pathspecs：路径按字面，`m[1].json` 不许匹配到 `m1.json` 的提交（C02）
    cmd = ["git", "--literal-pathspecs", "-C", root, "log", "-1", "--format=%ct", "--", relpath]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True,
                             encoding="utf-8", timeout=_GIT_TIMEOUT)
    except (OSError, subprocess.SubprocessError) as exc:
        return None, u"跑不了 git log：%s" % exc
    if out.returncode != 0:
        return None, u"git log 退出码 %d：%s" % (out.returncode, (out.stderr or "").strip()[:200])
    txt = (out.stdout or "").strip().splitlines()
    if not txt or not txt[0].strip().isdigit():
        return None, u"%s 没有提交记录（未提交或路径写错）" % relpath
    return int(txt[0].strip()), None


def read_header(path, root):
    """读文件头部若干行。二进制或读不了时返回 (None, 原因)。"""
    try:
        data = read_bytes(path, root, head=_HEADER_MAX_BYTES)
    except OSError as exc:
        return None, u"读不了：%s" % exc
    if b"\x00" in data:
        return None, u"是二进制文件，头部声明判不了"
    # 截断在多字节字符中间或夹杂非 UTF-8 字节时丢掉那几个字节；"ignore" 不会抛
    return u"\n".join(data.decode("utf-8", "ignore").splitlines()[:_HEADER_LINES]), None


def _mentions(low, name):
    """name 作为整段路径/文件名出现在 low 里：前后不能紧挨文件名字符（C15：`api` 不许命中 `rapid`；
    R2-8：后面接 `.md`、`.bak` 这类扩展名也不算，句末的句号照认）。
    只按 ASCII 判边界——`权威是src/map.json` 这种中文紧贴的写法照认。"""
    return bool(name) and re.search(r"(?<![A-Za-z0-9_.-])" + re.escape(name.lower()) + r"(?!\.?[A-Za-z0-9_-])",
                                    low) is not None


def header_declares(header, source_rel):
    """头部是否**指明了源**（02 §9.1 的门槛）。返回命中说明，没有则 None。

    只有这个函数的返回值能让检查判 PASS。生成类措辞与生成器署名不走这里。
    """
    low = header.lower()
    src = str(source_rel).replace("\\", "/")
    if _mentions(low, src):
        return u"头部出现源路径 %s" % src
    base = os.path.basename(src)
    if _mentions(low, base):
        return u"头部出现源文件名 %s" % base
    for mark in _SOURCE_MARKERS:
        if mark.lower() in low:
            return u"头部出现标记 %s" % mark
    return None


def header_generation_hint(header):
    """头部有没有"这是生成物"的痕迹。**不改变状态，只用来把证据说准。**

    返回 (类别, 行号, 原文行)；没有返回 None。生成器署名优先于泛泛的生成措辞，
    因为它是可引用的原文，比"某处出现了『生成』二字"更有信息量。
    """
    lines = header.splitlines()
    for group, kind in ((_GENERATOR_HINTS, u"生成器署名"),
                        (_GENERATED_MARKERS, u"生成/派生措辞")):
        for i, line in enumerate(lines, 1):
            low = line.lower()
            for mark in group:
                if mark.lower() in low:
                    return kind, i, line.strip()[:200]
    return None


# --------------------------------------------------------------------------
# 接口
# --------------------------------------------------------------------------

def scope(cfg):
    decls = cfg_get(cfg, "derived", []) or []
    n = len(decls) if isinstance(decls, list) else 0
    return {
        "covered": [
            u"只看 project.yaml 的 derived: 声明（本次 %d 条）" % n,
            u"每条声明的 artifact / source 是否存在、regen 是否非空",
            u"artifact 的 git 最后提交时间是否早于 source 的（陈旧）",
            u"artifact 头部 %d 行是否**指明了源**：出现源路径、源文件名或 source_rev 才算"
            u"（02 §9.1 的门槛是『权威是 X』，只写『自动生成』、只留 <meta name=generator> 不算）"
            % _HEADER_LINES,
        ],
        "not_covered": [
            u"不看未在 derived: 里声明的派生关系——本工具不猜哪些文件是生成的",
            u"不判断派生物内容是否与源一致：那要跑生成器重建再 diff，属运行不属检查",
            u"不跑任何 regen 命令，也不校验该命令是否真能跑通",
            u"不判断派生物里是否混入了人工内容——机械判不了，只判它有没有自我声明",
            u"不看人工批注区（02 §9.3）的隔离是否正确",
            u"不比对 source_rev 的值与源的实际版本，只比 git 提交先后",
            u"不看工作区未提交的改动：陈旧判据用 git 提交时间，不用文件 mtime",
            u"不校验头部写的源路径是不是 derived: 里声明的那一个之外的别的文件——"
            u"只做字符串出现判定，不解析头部的语义",
        ],
    }


def run(cfg):
    tailored, reason = is_tailored_out(cfg, NAME)
    if tailored:
        return [finding(NAME, SKIP, u"项目已裁剪本检查", reason=reason or u"project.yaml 未写理由")]
    try:
        return _run(cfg)
    except Exception as exc:  # noqa: BLE001  内部异常一律转未定，绝不吞掉记 PASS
        return [undetermined_from_exception(NAME, exc, u"跑 %s" % NAME)]


def _run(cfg):
    root = cfg.get("_root") or "."
    decls = cfg_get(cfg, "derived")
    if not decls:
        return [finding(
            NAME, SKIP, u"项目未声明派生工件",
            reason=u"governance/project.yaml 没有 derived:；本工具不猜哪些文件是派生的（契约 §5）",
            why=u"01 §3.4：派生关系由项目指定主从，不由检查器推定",
        )]
    out = []
    shallow = shallow_problem(root)
    # 同一派生物可配几个源：头部只判一次，指明其中任一个源就算（R2-7）
    srcs = {}
    for item in decls:
        srcs.setdefault(str(item.get("artifact") or "").strip(), []).append(str(item.get("source") or "").strip())
    for i, item in enumerate(decls, 1):
        out.extend(_check_one(root, i, item, shallow, srcs))
    return out


def _check_one(root, idx, item, shallow, srcs):
    # derived 须是映射组成的列表，load_config 已按形状校验拒收别的写法（契约 §5）
    label = u"derived[%d]" % idx
    artifact = str(item.get("artifact") or "").strip()
    source = str(item.get("source") or "").strip()
    regen = str(item.get("regen") or "").strip()
    label = u"%s（%s）" % (label, artifact or u"未写 artifact")

    missing = [k for k, v in ((u"artifact", artifact), (u"source", source), (u"regen", regen)) if not v]
    if missing:
        return [finding(
            NAME, UNDETERMINED, u"%s 的声明不完整" % label,
            where=artifact or None, kind=u"incomplete-decl", key=artifact or label,
            reason=u"缺：%s" % u"、".join(missing),
            why=u"01 §3.4：派生的核对方式是记源版本并 CI 重建 diff，缺源或缺重建命令就核对不了",
        )]

    apath = os.path.join(root, artifact)
    spath = os.path.join(root, source)
    problems = []
    if not os.path.isfile(apath):
        problems.append(u"artifact 不存在：%s" % artifact)
    if not os.path.isfile(spath):
        problems.append(u"source 不存在：%s" % source)
    if problems:
        return [finding(
            NAME, UNDETERMINED, u"%s 声明的文件不在" % label,
            where=artifact, kind=u"missing-file", key=artifact,
            reason=u"；".join(problems),
            why=u"01 §3.4：声明了派生关系但对象缺失，是配置过期还是文件被删，机械判不了",
            evidence=u"regen: %s" % regen,
        )]

    out = []

    # 陈旧检测：派生物落后于源
    a_epoch, a_why = git_last_commit_epoch(root, artifact, shallow)
    s_epoch, s_why = git_last_commit_epoch(root, source, shallow)
    if a_epoch is None or s_epoch is None:
        out.append(finding(
            NAME, UNDETERMINED, u"%s 取不到 git 提交时间，陈旧与否未定" % label,
            where=artifact, kind=u"no-commit-time", key=artifact,
            reason=u"；".join(x for x in (a_why, s_why) if x),
            why=u"01 §3.4：派生物要对账源版本；取不到版本即无法判定，按 N1 记未定",
            evidence=u"git log -1 --format=%%ct -- %s / %s" % (artifact, source),
        ))
    elif a_epoch < s_epoch:
        out.append(finding(
            NAME, FAIL, u"%s 落后于源 %s" % (label, source),
            where=artifact, kind=u"behind", key=artifact + u"|" + source,
            why=u"01 §3.4：派生物记录源的版本、CI 重建后 diff 为零才算一致；落后的派生物默认不作事实（02 §9.4）",
            evidence=u"artifact 最后提交 %d，source 最后提交 %d，晚 %d 秒" % (a_epoch, s_epoch, s_epoch - a_epoch),
        ))
    else:
        out.append(finding(
            NAME, PASS, u"%s 不落后于源" % label,
            where=artifact, kind=u"not-behind", key=artifact + u"|" + source,
            why=u"01 §3.4",
            evidence=u"artifact 最后提交 %d ≥ source 最后提交 %d（只比提交先后，不比内容）" % (a_epoch, s_epoch),
        ))

    # 自我声明：改它是白改，得让接手者看得见。同一派生物只在它的第一条声明上判
    sources = srcs.pop(artifact, None)
    if sources is None:
        return out
    header, hwhy = read_header(apath, root)
    if header is None:
        out.append(finding(
            NAME, UNDETERMINED, u"%s 的头部读不了，自我声明未定" % label,
            where=artifact, kind=u"header-unreadable", key=artifact, reason=hwhy,
            why=u"02 §9.1：派生工件头部要声明『派生缓存，权威是 X』",
        ))
    else:
        hit = next((h for h in (header_declares(header, x) for x in sources) if h), None)
        if hit:
            out.append(finding(
                NAME, PASS, u"%s 头部声明了自己是派生物" % label,
                where=artifact, kind=u"header-declared", key=artifact, why=u"02 §9.1", evidence=hit,
            ))
        else:
            why = (u"02 §9.1 派生工件头部须声明『派生缓存，权威是 X』并记 source_rev；"
                   u"01 §3.4 派生物不得当成可手改的文档")
            gen = header_generation_hint(header)
            if gen:
                # 两种事实的第一种：有生成痕迹，但没说源是谁。结论仍是 FAIL——
                # 02 §9.1 要的是"权威是 X"，不是"我是自动生成的"。
                hint, lineno, line = gen
                out.append(finding(
                    NAME, FAIL, u"%s 头部有%s但未指明源" % (label, hint),
                    where=u"%s:%d" % (artifact, lineno), kind=u"header-undeclared", key=artifact,
                    why=why,
                    evidence=u"第 %d 行原文：%s；但前 %d 行里既没有源路径 %s、也没有源文件名 %s、"
                             u"也没有 source_rev——只说了『这是生成的』，没说权威是谁，"
                             u"接手者仍然不知道该回头改哪个文件"
                             % (lineno, line, _HEADER_LINES, source, os.path.basename(source)),
                ))
            else:
                # 第二种：完全没有痕迹。
                out.append(finding(
                    NAME, FAIL, u"%s 头部没有任何生成/派生标记" % label,
                    where=u"%s:1" % artifact, kind=u"header-undeclared", key=artifact,
                    why=why,
                    evidence=u"前 %d 行里既没有源路径 %s，也没有任何生成/派生/不要手改一类标记，"
                             u"也没有生成器署名；派生物没有自我声明，接手者无法知道改它是白改"
                             u"——下次重建就覆盖掉" % (_HEADER_LINES, source),
                ))
    return out


# --------------------------------------------------------------------------
# 自检（契约 §3）
# --------------------------------------------------------------------------

# 夹具不受全局配置左右：不签名、不跑全局钩子
_GIT_ID = ["-c", "user.email=std@example.invalid", "-c", "user.name=std",
           "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null",
           "-c", "core.autocrlf=false", "-c", "core.safecrlf=false"]


def _git(root, *args, **kw):
    env = dict(os.environ)
    env.update(kw.get("env") or {})
    return subprocess.run(["git", "-C", root] + _GIT_ID + list(args),
                          capture_output=True, text=True, timeout=_GIT_TIMEOUT, env=env)


def _commit(root, rel, body, when):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path) or root, exist_ok=True)
    with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(body)
    _git(root, "add", "--", rel)
    _git(root, "commit", "-q", "-m", "add %s" % rel,
         env={"GIT_AUTHOR_DATE": when, "GIT_COMMITTER_DATE": when})


_SRC = u'{"modules": ["inventory", "settlement"]}\n'
_GOOD = u"""<!-- 派生缓存，权威是 src/map.json；不要手改，改动由下面的命令重建 -->
<!-- regen: python3 tools/build_map.py -->
<h1>模块图</h1>
"""
_BAD = u"""<h1>模块图</h1>
<p>库存与结算两个模块。</p>
"""
# 只有 <meta name="generator">，既没有源路径也没有 source_rev。
# 这是真实形态：本仓 docs/架构图/ 十份与 RCMS 三份 HTML 的第 6 行都长这样。
# 它必须仍判 FAIL——把 generator 当成"自我声明"会一次性制造十几条假 PASS。
_GENERATOR_ONLY = u"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>模块图</title>
  <meta name="generator" content="archify 2.16.0">
</head>
<body><h1>模块图</h1></body>
</html>
"""


def _repo(tmp):
    subprocess.run(["git", "init", "-q", tmp], capture_output=True, text=True, timeout=_GIT_TIMEOUT)
    return {"_root": tmp}


def selftest():
    results = []

    # 反例：派生物头部没有自我声明
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _repo(tmp)
            _commit(tmp, "src/map.json", _SRC, "2026-01-01T00:00:00 +0000")
            _commit(tmp, "docs/map.html", _BAD, "2026-01-02T00:00:00 +0000")
            cfg["derived"] = [{"artifact": "docs/map.html",
                               "source": "src/map.json",
                               "regen": "python3 tools/build_map.py"}]
            got = [f["status"] for f in run(cfg)]
        ok = FAIL in got
        results.append(finding(
            NAME, PASS if ok else FAIL,
            u"反例：派生物头部无自我声明应判 FAIL",
            evidence=u"实得 %s" % got, why=u"契约 §3 静默失效探测",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(NAME, FAIL, u"反例自身出错", evidence=u"%s: %s" % (type(exc).__name__, exc)))

    # 反例（D-123 bug 1）：同一份陈旧样本的浅克隆须记未定——浅克隆里两者的提交时间都是边界提交，
    # 旧实现据此判「不落后」，把 FAIL 翻成 PASS
    try:
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = os.path.join(tmp, "src"), os.path.join(tmp, "dst")
            os.makedirs(src)
            _repo(src)
            _commit(src, "docs/map.html", _GOOD, "2026-01-01T00:00:00 +0000")
            _commit(src, "src/map.json", _SRC, "2026-02-01T00:00:00 +0000")
            subprocess.run(["git", "clone", "-q", "--depth", "1", "file://" + src, dst],
                           capture_output=True, timeout=_GIT_TIMEOUT)
            got = [(f["status"], f["id"]) for f in run({
                "_root": dst, "derived": [{"artifact": "docs/map.html", "source": "src/map.json",
                                            "regen": "python3 tools/build_map.py"}]})]
        ok = (UNDETERMINED, NAME + "/no-commit-time/docs/map.html") in got and \
            not any(st == PASS and "不落后" in i for st, i in got)
        results.append(finding(
            NAME, PASS if ok else FAIL,
            u"反例：浅克隆下取不到真实提交先后，陈旧与否记未定",
            evidence=u"实得 %s" % got, why=u"01 §2 N1：浅克隆的提交时间是克隆时刻，判不了先后",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(NAME, FAIL, u"浅克隆反例自身出错", evidence=u"%s: %s" % (type(exc).__name__, exc)))

    # 反例二：派生物提交早于源（陈旧）
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _repo(tmp)
            _commit(tmp, "docs/map.html", _GOOD, "2026-01-01T00:00:00 +0000")
            _commit(tmp, "src/map.json", _SRC, "2026-02-01T00:00:00 +0000")
            cfg["derived"] = [{"artifact": "docs/map.html",
                               "source": "src/map.json",
                               "regen": "python3 tools/build_map.py"}]
            got = [f["status"] for f in run(cfg)]
        ok = FAIL in got
        results.append(finding(
            NAME, PASS if ok else FAIL,
            u"反例二：派生物落后于源应判 FAIL",
            evidence=u"实得 %s" % got, why=u"契约 §3 静默失效探测",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(NAME, FAIL, u"反例二自身出错", evidence=u"%s: %s" % (type(exc).__name__, exc)))

    # 反例三：只有 <meta name="generator">，没有源路径也没有 source_rev。
    # 两条断言缺一不可：① 状态仍是 FAIL（防假 PASS）；② 证据不再说"没有任何标记"（防假陈述）。
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _repo(tmp)
            _commit(tmp, "src/map.json", _SRC, "2026-01-01T00:00:00 +0000")
            _commit(tmp, "docs/map.html", _GENERATOR_ONLY, "2026-01-02T00:00:00 +0000")
            cfg["derived"] = [{"artifact": "docs/map.html",
                               "source": "src/map.json",
                               "regen": "python3 tools/build_map.py"}]
            res = run(cfg)
        hdr = [f for f in res if u"头部" in (f.get("title") or u"")]
        got = [f["status"] for f in res]
        ev = u" ".join(f.get("evidence") or u"" for f in hdr)
        ok = (len(hdr) == 1 and hdr[0]["status"] == FAIL
              and u"没有任何生成/派生标记" not in (hdr[0].get("title") or u"")
              and u"没有任何生成/派生" not in ev
              and u'name="generator"' in ev)
        results.append(finding(
            NAME, PASS if ok else FAIL,
            u"反例三：只有生成器署名、未指明源，须仍判 FAIL，且证据须引原文而非说『没有任何标记』",
            evidence=u"实得 %s；头部条目 title=%r evidence=%r"
                     % (got, hdr[0].get("title") if hdr else None, ev[:200]),
            why=u"契约 §3；02 §9.1 的门槛是『权威是 X』，不是『我是自动生成的』",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(NAME, FAIL, u"反例三自身出错", evidence=u"%s: %s" % (type(exc).__name__, exc)))

    # 正例：源在前、派生物在后，且头部声明齐全
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _repo(tmp)
            _commit(tmp, "src/map.json", _SRC, "2026-01-01T00:00:00 +0000")
            _commit(tmp, "docs/map.html", _GOOD, "2026-01-02T00:00:00 +0000")
            cfg["derived"] = [{"artifact": "docs/map.html",
                               "source": "src/map.json",
                               "regen": "python3 tools/build_map.py"}]
            got = [f["status"] for f in run(cfg)]
        ok = bool(got) and set(got) == {PASS}
        results.append(finding(
            NAME, PASS if ok else FAIL,
            u"正例：声明齐全且不落后应全判 PASS",
            evidence=u"实得 %s" % got, why=u"契约 §3 静默失效探测",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(NAME, FAIL, u"正例自身出错", evidence=u"%s: %s" % (type(exc).__name__, exc)))

    # 反例五（C02）：源路径带 [ ] 时 git 按通配解读，会取到 m1.json 更晚的提交，把不落后的派生物判落后
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _repo(tmp)
            _commit(tmp, "src/m[1].json", _SRC, "2026-01-01T00:00:00 +0000")
            _commit(tmp, "docs/map.html", u"<!-- 权威是 src/m[1].json -->\n", "2026-01-02T00:00:00 +0000")
            _commit(tmp, "src/m1.json", _SRC, "2026-02-01T00:00:00 +0000")
            cfg["derived"] = [{"artifact": "docs/map.html", "source": "src/m[1].json", "regen": "make"}]
            got = [f["status"] for f in run(cfg)]
        results.append(finding(
            NAME, PASS if got == [PASS, PASS] else FAIL,
            u"反例五：源路径带 [ ] 按字面取提交时间，不被通配到别的文件",
            evidence=u"实得 %s" % got, why=u"01 §3.4：陈旧判据比的是声明的那个源",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(NAME, FAIL, u"反例五自身出错", evidence=u"%s: %s" % (type(exc).__name__, exc)))

    # R2-7：同一派生物对 src/a.json、src/b.json 各声明一条，两条「落后」各有自己的 id，头部只判一次
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _repo(tmp)
            _commit(tmp, "docs/map.html", _BAD, "2026-01-01T00:00:00 +0000")
            _commit(tmp, "src/a.json", _SRC, "2026-02-01T00:00:00 +0000")
            _commit(tmp, "src/b.json", _SRC, "2026-02-01T00:00:00 +0000")
            cfg["derived"] = [{"artifact": "docs/map.html", "source": "src/%s.json" % x, "regen": "make"}
                              for x in "ab"]
            got = sorted(f["id"] for f in run(cfg) if f["status"] == FAIL)
        want = [NAME + u"/behind/docs/map.html｜src/a.json", NAME + u"/behind/docs/map.html｜src/b.json",
                NAME + u"/header-undeclared/docs/map.html"]
        results.append(finding(
            NAME, PASS if got == want else FAIL,
            u"R2-7：一个派生物配两个源，落后按 (派生物, 源) 分开，头部只判一次",
            evidence=u"实得 %s" % (got,), why=u"契约 §9：两件事两个地址，一件事只报一次",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(NAME, FAIL, u"R2-7 反例自身出错", evidence=u"%s: %s" % (type(exc).__name__, exc)))

    # 反例六（C15）：源文件名按整段匹配——头部只写了 rapid 的派生物不算指明了源 src/api
    hits = (header_declares(u"<!-- rapid prototype, generated -->", u"src/api"),
            header_declares(u"<!-- 权威是src/map.json -->", u"src/map.json"),
            header_declares(u"<!-- source: ../map.json. -->", u"src/map.json"),
            header_declares(u"<!-- see api.md -->", u"src/api"),
            header_declares(u"<!-- src/map.json.bak -->", u"src/map.json"))
    results.append(finding(
        NAME, PASS if hits[0] is None and hits[1] and hits[2] and hits[3] is None and hits[4] is None else FAIL,
        u"反例六：源文件名按路径/词边界匹配，api 不命中 rapid、api.md，map.json 不命中 map.json.bak；"
        u"中文紧贴、句号收尾照认",
        evidence=u"实得 %s" % (hits,), why=u"02 §9.1：指明源要指的是那一个文件",
    ))

    # 反例四（id 的区分力，契约 §9）：两条派生声明同时缺源文件，两条未定的 id 必须
    # 各带自己的 artifact 路径。key 不带 artifact 的话两条 id 一模一样，登记一行就会
    # 把两条都静音——而它们是两件事。
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _repo(tmp)
            _commit(tmp, "docs/a.html", _GOOD, "2026-01-01T00:00:00 +0000")
            _commit(tmp, "docs/b.html", _GOOD, "2026-01-01T00:00:00 +0000")
            cfg["derived"] = [
                {"artifact": "docs/a.html", "source": "src/gone-a.json", "regen": "make a"},
                {"artifact": "docs/b.html", "source": "src/gone-b.json", "regen": "make b"},
            ]
            res = run(cfg)
        miss = [f for f in res if (f.get("id") or u"").startswith(NAME + u"/missing-file/")]
        # C19：同一条声明挪到第二位，落后、头部两条 FAIL 的 id 不许随 derived[序号] 变
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _repo(tmp)
            _commit(tmp, "docs/map.html", _BAD, "2026-01-01T00:00:00 +0000")
            _commit(tmp, "src/map.json", _SRC, "2026-02-01T00:00:00 +0000")
            one = {"artifact": "docs/map.html", "source": "src/map.json", "regen": "make"}
            # C22：两次扫描各只探测一次浅克隆（旧写法每条声明的 artifact、source 各起一次子进程）
            probes, real_probe = [], globals()["shallow_problem"]
            globals()["shallow_problem"] = lambda r: (probes.append(r), real_probe(r))[1]
            try:
                ids = [sorted(f["id"] for f in run(dict(cfg, derived=d)) if f["status"] == FAIL)
                       for d in ([one], [{"artifact": "", "source": "", "regen": ""}, one])]
            finally:
                globals()["shallow_problem"] = real_probe
        stable = ids[0] == ids[1] == [NAME + u"/behind/docs/map.html｜src/map.json", NAME + u"/header-undeclared/docs/map.html"]
        mids = [f["id"] for f in miss]
        ok = (len(miss) == 2 and len(set(mids)) == 2 and stable and len(probes) == 2
              and mids[0].endswith(u"docs/a.html") and mids[1].endswith(u"docs/b.html"))
        results.append(finding(
            NAME, PASS if ok else FAIL,
            u"反例四：两条声明各缺自己的源，两条未定的 id 须按 artifact 路径分开；FAIL 的 id 不随声明序号漂",
            evidence=u"实得 %d 条：%s；序号 1 与 2 时的 FAIL id：%s；两次扫描共探测浅克隆 %d 次（应 2 次，C22）"
                     % (len(miss), u"、".join(mids) or u"无", ids, len(probes)),
            why=u"契约 §9：id 是例外登记的地址，两件事共用一个地址就会被一行登记一起静音",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(NAME, FAIL, u"反例四自身出错", evidence=u"%s: %s" % (type(exc).__name__, exc)))

    return results
