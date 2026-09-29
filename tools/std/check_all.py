# -*- coding: utf-8 -*-
"""汇总入口：跑 checks/ 下的全部检查器，按三态汇总。

用法：
    python3 tools/std/check_all.py [项目根]           # 默认当前目录
    python3 tools/std/check_all.py --selftest         # 只跑检查器自检
    python3 tools/std/check_all.py --json             # 机器可读
    python3 tools/std/check_all.py <项目> --config <别处的.yaml>
        # 扫描只读项目：配置放在被测项目之外，全程不往被测项目写任何东西

退出码：有 FAIL → 1；无 FAIL 但有**未登记**的 UNDETERMINED → 2；否则 0。
**2 不是成功。** 已登记的未定仍是未定、仍逐条列出、仍计数，登记只改变退出码。
契约见同目录 CONTRACT.md（三态 §1、例外登记 §9）。
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# 脚本目录会被 Python 放在 sys.path[0]：工具目录里一份未跟踪的 argparse.py、hashlib.py 就能顶替标准库
# 执行，而契约 §8 的身份不哈希它。先把工具目录移出 sys.path 再导入别的（os、sys 启动时已载入）；
# stdlib 与检查器经 _load_source 按路径加载，不靠 sys.path。
sys.path[:] = [p for p in sys.path if os.path.realpath(p or os.curdir) != os.path.realpath(HERE)]

import argparse  # noqa: E402
import datetime  # noqa: E402
import io  # noqa: E402
import json  # noqa: E402
import re  # noqa: E402


def _load_source(name, path, register=False):
    """按 .py 源码字节编译并执行成模块，不经导入系统、不读 `__pycache__`。

    PEP 552 的 unchecked-hash pyc 不与源码比对：往 `__pycache__/` 放一份篡改版，执行的就是它，
    而契约 §8 的身份只哈希 .py 源码，身份不变。stdlib 与各检查器一律经这里加载。
    register：放进 sys.modules（stdlib 要被检查器 `from stdlib import` 取到）。
    """
    import types
    with io.open(path, "rb") as fh:
        code = compile(fh.read(), path, "exec", dont_inherit=True)
    mod = types.ModuleType(name)
    mod.__file__ = path
    if register:
        sys.modules[name] = mod
    exec(code, mod.__dict__)
    return mod


_load_source("stdlib", os.path.join(HERE, "stdlib.py"), register=True)

from stdlib import (  # noqa: E402
    FAIL, PASS, SKIP, STATUS_CANDIDATES, UNDETERMINED,
    embedded_std_rel, filter_env, finding, scan_memo, finding_id, git_version_problem, load_config, load_exceptions, scrub_git_env,
    EXCEPTION_MAX_DAYS, INTERNAL_ERROR_KIND, tracked_files, undetermined_from_exception, work_root, unreadable as sl_unreadable,
)

CHECKS_DIR = os.path.join(HERE, "checks")

IDENTITY_CHECK = "tool-identity"


# --------------------------------------------------------------------------
# 检查器版本身份（契约 §8）
# --------------------------------------------------------------------------

def _sha256_file(path):
    """行尾归一化后再哈希（契约 §8）：CRLF / CR 一律作 LF，其余字节不动。"""
    import hashlib
    try:
        with io.open(path, "rb") as fh:
            data = fh.read().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
        return hashlib.sha256(data).hexdigest()
    except OSError as exc:
        return "读不了：%s" % exc


def _git_line(args, here=HERE, env=None):
    import subprocess
    try:
        out = subprocess.run(["git", "-C", here] + list(args), env=env,
                             capture_output=True, text=True, encoding="utf-8", timeout=60)
    except (OSError, subprocess.SubprocessError) as exc:
        return None, "跑不了 git：%s" % exc
    if out.returncode != 0:
        return None, "git 退出码 %d" % out.returncode
    return (out.stdout or ""), None


def tool_identity(here=HERE):
    """本次跑的这套检查器是哪一套。

    身份是**内容哈希**，不是提交号：提交号覆盖不了工作区未提交的改动，而决定行为的
    是文件内容。`CONTRACT.md` 也算进去——`_contract_examples_selftest` 会读它，
    它进闸门，就必须进身份。提交号与 `--porcelain` 只作旁证与 dirty 标记。
    here 只为自检注入（工具位于被扫仓内的夹具），生产路径不传。
    """
    import hashlib

    checks_dir = os.path.join(here, "checks")
    files = [("check_all.py", os.path.join(here, "check_all.py")),
             ("stdlib.py", os.path.join(here, "stdlib.py")),
             ("CONTRACT.md", os.path.join(here, "CONTRACT.md"))]
    if os.path.isdir(checks_dir):
        for fn in sorted(os.listdir(checks_dir)):
            if fn.startswith("check_") and fn.endswith(".py"):
                files.append(("checks/" + fn, os.path.join(checks_dir, fn)))

    digests = [(rel, _sha256_file(path)) for rel, path in files]
    joined = "\n".join("%s %s" % (rel, h) for rel, h in digests)
    combined = hashlib.sha256(joined.encode("utf-8")).hexdigest()

    head, head_err = _git_line(["rev-parse", "HEAD"], here)
    # 内嵌运行时 here 在被扫仓里：status 会重哈希工作区、触发被扫方配置的过滤器，与 adoption 同样置空
    env = filter_env(here)
    porcelain, por_err = ((None, "列不出被扫仓的过滤器，未跑 git status") if env is None else
                          _git_line(["status", "--porcelain", "--ignore-submodules=all", "--", here], here, env))
    if porcelain is None:
        dirty, dirty_detail = None, por_err
    else:
        lines = [ln for ln in porcelain.splitlines() if ln.strip()]
        dirty, dirty_detail = bool(lines), "；".join(ln.strip() for ln in lines[:12])

    return {
        "digest": combined,
        "files": digests,
        "git_head": (head or "").strip() or head_err,
        "dirty": dirty,
        "dirty_detail": dirty_detail,
    }


def identity_line(ident):
    """一行摘要，给文本输出的头部。"""
    if ident.get("dirty") is True:
        flag = "工作区 dirty（哈希已含未提交改动）"
    elif ident.get("dirty") is False:
        flag = "工作区干净"
    else:
        flag = "工作区状态未知：%s" % ident.get("dirty_detail")
    head = str(ident.get("git_head") or "")
    head = head[:12] if re.fullmatch(r"[0-9a-f]{7,64}", head) else "提交不可知（%s）" % (head or "未知")
    return ("检查器身份 · sha256:%s（%d 个文件，含 CONTRACT.md）· git %s · %s"
            % (ident["digest"][:16], len(ident["files"]), head, flag))


def identity_block(ident):
    """逐文件哈希，写成本工具自己的 yaml 子集能解析的形状。"""
    lines = ["tool_identity_digest: %s" % ident["digest"],
             "tool_identity_git_head: %s" % (ident.get("git_head") or "未知"),
             "tool_identity_dirty: %s" % ident.get("dirty"),
             "tool_identity_files:"]
    lines += ["  - %s %s" % (rel, h) for rel, h in ident["files"]]
    if ident.get("dirty_detail"):
        lines.append("tool_identity_dirty_detail: %s" % ident["dirty_detail"])
    return "\n".join(lines)


def _identity_finding(ident, excluded=None):
    return finding(
        IDENTITY_CHECK, SKIP, identity_line(ident),
        where="tools/std/",
        reason="这不是判定，是记录，故不计三态。依据契约 §8：符合性报告不钉检查器版本身份"
               "就不可复算——曾发生过扫描期间检查器被并行改写，同一项目旧版 30 条 FAIL、"
               "新版 9 条，两份报告都自称是『对该项目的结论』",
        evidence=identity_block(ident) + (
            "\nscan_excluded: %s/（工具自身所在的内嵌目录，不扫描）" % excluded
            if excluded else ""),
    )


def _identity_void_finding(before, after):
    return finding(
        IDENTITY_CHECK, UNDETERMINED, "扫描期间检查器自身被改动，本次结论作废",
        where="tools/std/",
        reason="扫描前后的检查器内容哈希不一致，说明这份报告是两套检查器混出来的，"
               "不可复算。请等检查器稳定后重跑（契约 §8）",
        why="契约 §8 / 01 §2 N1：拿不准是哪一套跑出来的结论，不记通过也不记失败",
        evidence="扫描前 %s\n扫描后 %s" % (identity_block(before), identity_block(after)),
    )


def discover():
    mods = []
    if not os.path.isdir(CHECKS_DIR):
        return mods
    for fn in sorted(os.listdir(CHECKS_DIR)):
        if not (fn.startswith("check_") and fn.endswith(".py")):
            continue
        try:
            mod = _load_source(fn[:-3], os.path.join(CHECKS_DIR, fn))
        except (Exception, SystemExit) as exc:  # 加载失败也是未定，不是没有这项检查
            mods.append((fn[:-3], None, exc))
            continue
        mods.append((getattr(mod, "NAME", fn[:-3]), mod, None))
    return mods


def _gated_by_selftest(name, mod):
    """契约 §3：自检不过或没有自检的检查器，其结论作废。

    返回 `(ok, gate_findings, results)`。第三项是**闸门这一次实际拿到的那份自检结果**，
    给 `--selftest` 分支原样打印用。

    为什么要把它带出来：闸门是拿这一次的结果判的，`--selftest` 从前又自己调了一遍
    再打印，于是**报告展示的证据不是闸门据以放行的那份证据**。各检查器的自检里有
    `datetime.date.today()`、临时目录与 git，任何一次抖动都会让两份对不上。
    这与"结论对、证据错"是同一类问题。

    **禁止在这里做任何 memo / 缓存。** `_entry_smoke_selftest` 会嵌套跑一遍
    `run_all(selftest_only=False)`（还会再跑两遍 `main`），缓存会跨嵌套泄漏，
    闸门就不再是"这次扫描前刚跑过"，而是"某一次跑过、且不知道是哪一次"。
    嵌套那几次是**另一次扫描的闸门**，不是重复，不该被消掉。
    """
    if not hasattr(mod, "selftest"):
        return False, [finding(
            name, UNDETERMINED, "检查器没有自检", kind=INTERNAL_ERROR_KIND,
            reason="契约 §3 要求每个检查器自带反例；没有反例就无法证明它抓得住违规",
            why="01 §5.6 守卫存在不等于守卫在执行",
        )], []
    try:
        results = mod.selftest()
    except (Exception, SystemExit) as exc:   # 检查器里的 sys.exit 也是崩溃，不许带走整个进程
        return False, [undetermined_from_exception(name, exc, "跑自检")], []
    # 契约 §3：反例与正例至少各一条。空自检（或只有一条）照样放行，等于没有自检（D-123）
    if not isinstance(results, list) or len(results) < 2 or not all(isinstance(r, dict) for r in results):
        return False, [finding(
            name, UNDETERMINED, "检查器自检不足反例与正例各一条，其对本仓库的结论作废", kind=INTERNAL_ERROR_KIND,
            reason="selftest() 返回 %s；契约 §3 要求至少一条反例、一条正例" % (
                "%d 条" % len(results) if isinstance(results, list) else type(results).__name__),
            why="契约 §3 / 01 §5.6：守卫存在不等于守卫在执行",
        )], results if isinstance(results, list) else []
    bad = [r for r in results if r.get("status") != PASS]
    if bad:
        return False, [finding(
            name, UNDETERMINED, "检查器自检未通过，其对本仓库的结论作废", kind=INTERNAL_ERROR_KIND,
            reason="; ".join("%s（%s）" % (r.get("title"), r.get("evidence")) for r in bad),
            why="契约 §3 / 01 §5.6：检查器故障按未定处置，不按通过记",
        )], results
    return True, [], results


def _tailoring_unknown(cfg, mods):
    """`tailoring[].check` 写了不存在的名字（如 `derived`，实名 `derived-artifacts`）时裁剪不生效，
    检查照跑——项目以为关掉了，其实没有。每个认不出的名字记一条未定并列出可写的名字。"""
    valid = set(n for n, m, _e in mods if m is not None)
    for n, m, _e in mods:
        for items in (getattr(m, "_TIER_ITEMS", None) or {}).values():
            for item in items:
                valid.update((item[0], "%s:%s" % (n, item[0])))
    out = []
    for item in cfg.get("tailoring") or []:
        name = str(item.get("check") or "").strip() if isinstance(item, dict) else ""
        if name and name not in valid:
            out.append(finding(
                "tailoring", UNDETERMINED, "裁剪项 check: %s 不对应任何检查器或工件，裁剪没有生效" % name,
                kind="unknown-check", key=name,
                reason="可写的名字：检查器短名 %s，或 layout:<role>／<role>" % "、".join(
                    sorted(n for n, m, _e in mods if m is not None)),
                why="契约 §5 tailoring：写错名字的裁剪静默失效，项目以为不适用的检查仍在跑、结论仍在计"))
    return out


def _run_one(name, mod, cfg):
    """过自检闸门再跑一个检查器。检查器里的异常与 sys.exit 一律转未定（契约 §1），不带走整个进程。"""
    ok, gate, _results = _gated_by_selftest(name, mod)
    if not ok:
        return gate
    try:
        return list(mod.run(cfg) or [])
    except (Exception, SystemExit) as exc:
        return [undetermined_from_exception(name, exc, "跑 %s" % name)]


def _contract_examples_selftest():
    """契约文档里的 yaml 示例必须能被本工具的解析器读懂。

    这条来自一次真实翻车：CONTRACT.md §5 的示例写成 `entry: [a, b]` 流式列表，
    而解析器按"歧义即拒绝"拒收它——照文档抄配置的人会直接卡在第一步。
    文档里的示例是可执行工件，不是插图，所以纳入自检闸门。
    """
    import re
    from stdlib import parse_yaml_subset

    path = os.path.join(HERE, "CONTRACT.md")
    try:
        with io.open(path, encoding="utf-8") as fh:
            doc = fh.read()
    except OSError as exc:
        return [undetermined_from_exception("contract-examples", exc, "读 CONTRACT.md")]

    blocks = re.findall(r"```yaml\n(.*?)```", doc, re.S)
    if not blocks:
        return [finding(
            "contract-examples", UNDETERMINED, "契约里没有 yaml 示例",
            reason="没找到 ```yaml 段；是文档被改了还是正则失效，本检查判不了",
        )]
    out = []
    for i, block in enumerate(blocks, 1):
        try:
            parse_yaml_subset(block)
        except (Exception, SystemExit) as exc:
            out.append(finding(
                "contract-examples", FAIL,
                "CONTRACT.md 第 %d 段 yaml 示例本工具自己解析不了" % i,
                where="tools/std/CONTRACT.md",
                why="文档示例是可执行工件；照抄示例就该能跑通",
                evidence="%s: %s" % (type(exc).__name__, exc),
            ))
        else:
            out.append(finding(
                "contract-examples", PASS,
                "CONTRACT.md 第 %d 段 yaml 示例解析通过" % i,
                where="tools/std/CONTRACT.md",
            ))

    # §5 写明"唯一接受的流式写法是空列表 []，且只作键的值"。三种形状各钉一下：
    # 键值 [] 得空列表；列表项 - [] 与非空流式 [a, b] 都必须拒收，不许静默解析成别的形状
    got, bad = None, []
    try:
        got = parse_yaml_subset(u"k: []\n").get("k")
    except Exception as exc:  # noqa: BLE001
        bad.append(u"k: [] 被拒：%s" % exc)
    if got != []:
        bad.append(u"k: [] 应得 []，实得 %r" % (got,))
    for text in (u"k:\n  - []\n", u"k: [a, b]\n"):
        try:
            val = parse_yaml_subset(text)
        except Exception:  # noqa: BLE001
            continue
        bad.append(u"%r 应被拒收，实得 %r" % (text, val))
    out.append(finding(
        "contract-examples", FAIL if bad else PASS,
        u"解析器的流式写法边界与 CONTRACT §5 一致：只有键值 [] 被接受",
        where="tools/std/CONTRACT.md",
        why=u"歧义即拒绝；列表项位置的 [] 若被静默收下会解析成嵌套空列表",
        evidence=u"；".join(bad) or u"键值 [] → []；- [] 与 [a, b] 均拒收",
    ))
    return out


_SMOKE_CONFIG = u"""layout:
  entry:
    - CLAUDE.md
  docs_root: docs
  frozen:
    - docs/archive
budgets:
  entry_lines: 150
"""

_SMOKE_ENTRY = u"""# 冒烟仓

这个仓只为跑通入口冒烟自检而存在，内容不参与任何判定。
"""


def _entry_smoke_selftest():
    """入口冒烟：check_all 自己能不能跑一遍。

    契约 §3 的自检只覆盖各检查器，**不覆盖入口**。这条来自一次真实翻车：
    `run_all` 改成返回 `(findings, cfg)` 之后 `main` 仍按列表接收、`render` 里
    `scopes(root)` 传错参，`check_all . ` 直接崩——而当时每个检查器的自检都是绿的，
    `--selftest` 退出码 0。绿的自检没有拦住整个工具跑不起来。

    所以这里不是再验一遍检查器，而是：造一个临时项目 + 一份放在项目之外的配置，
    真正走一遍 run_all → render → main（含 argparse 与三态退出码），
    断言不抛异常、返回形状对、三态计数拿得到。
    """
    import contextlib
    import subprocess
    import tempfile

    out = []
    try:
        with tempfile.TemporaryDirectory() as tmp:
            proj = os.path.join(tmp, "proj")
            os.makedirs(proj)
            with io.open(os.path.join(proj, "CLAUDE.md"), "w", encoding="utf-8", newline="\n") as fh:
                fh.write(_SMOKE_ENTRY)
            cfg_path = os.path.join(tmp, "outside", "project.yaml")
            os.makedirs(os.path.dirname(cfg_path))
            with io.open(cfg_path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(_SMOKE_CONFIG)
            subprocess.run(["git", "init", "-q", proj], capture_output=True, timeout=60)
            subprocess.run(["git", "-C", proj, "-c", "core.autocrlf=false", "-c", "core.safecrlf=false",
                            "add", "-A"], capture_output=True, timeout=60)

            # 1) run_all 的返回形状：必须是 (findings, cfg)，不是列表
            ret = run_all(proj, selftest_only=False, config_path=cfg_path)
            if not (isinstance(ret, tuple) and len(ret) == 2):
                raise AssertionError("run_all 应返回 (findings, cfg)，实得 %r" % (type(ret),))
            findings, cfg = ret
            if not isinstance(findings, list) or not findings:
                raise AssertionError("run_all 的 findings 应是非空列表，实得 %r" % (type(findings),))
            for f in findings:
                if not isinstance(f, dict) or f.get("status") not in (PASS, FAIL, UNDETERMINED, SKIP):
                    raise AssertionError("findings 里有非法条目：%r" % (f,))
            if not isinstance(cfg, dict) or cfg.get("_root") != proj:
                raise AssertionError("外部配置下 cfg[_root] 应仍是被扫描项目，实得 %r" % (cfg,))

            # 2) 三态计数可得
            counts = {s: sum(1 for f in findings if f["status"] == s)
                      for s in (PASS, FAIL, UNDETERMINED, SKIP)}
            if sum(counts.values()) != len(findings):
                raise AssertionError("三态计数与条数对不上：%r" % (counts,))

            # 3) render 真跑一遍，含覆盖边界（scopes 的传参错就在这里崩）
            text = render(findings, proj, cfg, show_scope=True)
            if not isinstance(text, str) or u"覆盖边界" not in text:
                raise AssertionError("render 没有产出带覆盖边界的文本")
            if u"外部配置" not in text:
                raise AssertionError("--config 下 render 应标注外部配置")

            # 3b) 契约 §8：身份块要出现在文本输出头部，不能只写在契约散文里
            if u"检查器身份" not in text or u"sha256:" not in text:
                raise AssertionError("文本输出头部没有检查器身份块")

            # 3c) 缺陷四：--config 指向**项目内部**时，不许标"外部配置"
            inside_cfg = os.path.join(proj, "inside-project.yaml")
            with io.open(inside_cfg, "w", encoding="utf-8") as fh:
                fh.write(_SMOKE_CONFIG)
            f2, c2 = run_all(proj, selftest_only=False, config_path=inside_cfg)
            t2 = render(f2, proj, c2, show_scope=False)
            if u"外部配置" in t2:
                raise AssertionError("--config 指向项目内部时不应标注外部配置：%r"
                                     % t2.splitlines()[:4])
            if u"（在被扫描项目内）" not in t2:
                raise AssertionError("--config 指向项目内部时应如实标注在项目内")

            # 3d) 前缀比较必须带分隔符：断言的是**取值**——/t/proj 不许把 /t/project 吞成内部。
            if config_outside_root("/t/proj", "/t/project/x.yaml")[0] is not True:
                raise AssertionError("/t/proj 不该把 /t/project/x.yaml 吞成内部")
            if config_outside_root("/t/proj", "/t/proj/x.yaml")[0] is not False:
                raise AssertionError("/t/proj 下的 /t/proj/x.yaml 应判为项目内")

            # 3e) 缺陷：默认配置的 `_path` 是**相对被扫根**的，判在不在项目内时却按**当前工作
            #     目录**解析它——工作目录 ≠ 被扫根时，项目自己的 governance/project.yaml 被说成
            #     "外部配置，不在被扫描项目内"；cd 进该项目再跑同一条命令又对了。与 3c) 同类：
            #     结论（配置从哪读的）对，陈述（它在不在项目内）错。
            dflt_cfg = os.path.join(proj, "governance", "project.yaml")
            os.makedirs(os.path.dirname(dflt_cfg), exist_ok=True)
            with io.open(dflt_cfg, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(_SMOKE_CONFIG)
            cwd_before = os.getcwd()
            if cwd_before == proj:
                os.chdir(tmp)      # 自检正常在仓根跑；万一就在被扫根里跑，换个目录才验得出
            try:
                if os.getcwd() == proj:
                    raise AssertionError("这一节要在工作目录 ≠ 被扫根时验，实得两者都是 %s" % proj)
                f3, c3 = run_all(proj, selftest_only=False)
                t3 = render(f3, proj, c3, show_scope=False)
            finally:
                os.chdir(cwd_before)
            if u"外部配置" in t3:
                raise AssertionError("项目内的默认配置不该被说成外部配置（工作目录 %s ≠ 被扫根 %s）：%r"
                                     % (cwd_before, proj, t3.splitlines()[:4]))
            if u"（在被扫描项目内）" not in t3:
                raise AssertionError("项目内的默认配置应如实标注在被扫描项目内：%r"
                                     % t3.splitlines()[:4])

            # 3f) 契约 §8：身份对行尾归一化——同内容的 LF / CRLF / 裸 CR 副本身份相等，改一个字节则不等。
            #     来自 2026-09-11：同一提交的 tools/std 在两种克隆里得到两枚身份，两次 dirty 都报干净。
            eol = {}
            for name, data in (("lf", b"a\nb\n"), ("crlf", b"a\r\nb\r\n"),
                               ("cr", b"a\rb\n"), ("mut", b"a\nb!\n")):
                sample = os.path.join(tmp, "eol-" + name)
                with io.open(sample, "wb") as fh:
                    fh.write(data)
                eol[name] = _sha256_file(sample)
            if eol["lf"] != eol["crlf"]:
                raise AssertionError("契约 §8：同内容的 LF/CRLF 副本身份应相等，实得 %s / %s"
                                     % (eol["lf"][:16], eol["crlf"][:16]))
            if eol["lf"] != eol["cr"]:
                raise AssertionError("契约 §8：裸 CR 也应归一，实得 %s / %s"
                                     % (eol["lf"][:16], eol["cr"][:16]))
            if eol["lf"] == eol["mut"]:
                raise AssertionError("契约 §8：内容不同的文件身份不应相等")

            # 3g) 契约 §9 例外登记。五条断言**打在结果上，不打在退出码上**——退出码只有
            #     三个取值，靠它分不清"登记生效了"与"这次恰好没别的未定"。
            und = [f for f in findings if f["status"] == UNDETERMINED]
            if not und:
                raise AssertionError("冒烟仓没有未定项，登记这一支无从自检")
            target = und[0]["id"]
            ex_path = os.path.join(os.path.dirname(cfg_path), "exceptions.md")
            today = datetime.date.today()
            ok_day = (today + datetime.timedelta(days=30)).isoformat()
            yesterday = (today - datetime.timedelta(days=1)).isoformat()

            def _register(rule, expires, extra=u"", more=()):
                with io.open(ex_path, "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(u"# 例外登记\n\n"
                             u"| id | 规则 | 理由 | 范围 | 批准人 | 到期 | 状态 |\n"
                             u"|---|---|---|---|---|---|---|\n"
                             u"| EX-001 | %s | 入口冒烟自检用 | 该项 | 自检 | %s | active |\n%s"
                             % (rule, expires, extra))
                # 登记只在检查器跑完之后 join（契约 §9），检查器结论不随登记册变：复用第一遍的结论只重做 join，
                # 不再把全部检查器（连同自检闸门）重跑六遍（R1-12）
                fs, c = [dict(f, registered=None) for f in list(findings) + list(more)], dict(cfg)
                _join_exceptions(fs, c)
                hits = [f for f in fs if f.get("id") == target]
                if not hits:
                    raise AssertionError("登记自检：目标未定项 %s 消失了" % target)
                return fs, hits[0], c

            def _has(fs, kind):
                return any((f.get("id") or "").startswith("exception-register/" + kind) for f in fs)

            def _reg_line(fs, c):
                """首部那行「登记 · …」。断言只打在首部，不打在整篇文本上。"""
                for ln in render(fs, proj, c, show_scope=False).splitlines():
                    if ln.startswith(u"登记 · "):
                        return ln
                raise AssertionError("首部没有「登记 · 」行")

            fs, hit, c_ex = _register(target, ok_day)
            if (hit.get("registered") or {}).get("id") != "EX-001":
                raise AssertionError("① 有效登记应标已登记 EX-001，实得 %r" % (hit.get("registered"),))
            if (c_ex.get("_exceptions") or {}).get("expired") != 0:
                raise AssertionError("① 没有过期行时 _exceptions[expired] 应是 0，实得 %r"
                                     % ((c_ex.get("_exceptions") or {}).get("expired"),))
            line = _reg_line(fs, c_ex)
            if u"1 行有效）" not in line or u"已过期" in line:
                raise AssertionError("① 没有过期行时首部应逐字是「（1 行有效）」，实得 %r" % (line,))

            fs, hit, c_ex = _register(target, yesterday)
            if hit.get("registered") is not None:
                raise AssertionError("② 到期在昨天的登记不得生效，实得 %r" % (hit.get("registered"),))
            if not _has(fs, "expired"):
                raise AssertionError("② 过期登记应多一条 exception-register/expired")
            if (c_ex.get("_exceptions") or {}).get("expired") != 1:
                raise AssertionError("② 有 1 行过期时 _exceptions[expired] 应是 1，实得 %r"
                                     % ((c_ex.get("_exceptions") or {}).get("expired"),))
            line = _reg_line(fs, c_ex)
            if u"1 行有效，其中 1 行已过期" not in line:
                raise AssertionError("② 过期行要标在首部，否则「N 行有效」与计数行的已登记数对不上，"
                                     "实得 %r" % (line,))

            fs, _, _ = _register(
                target, ok_day,
                u"| EX-002 | freshness/stale/没有这份文件.md | 缺范围与批准人 |  |  | %s | active |\n" % ok_day)
            if not _has(fs, "invalid-rows"):
                raise AssertionError("③ 写坏一行应多一条 exception-register/invalid-rows")

            fs, hit, _ = _register(u"freshness/stale/根本不存在的判据.md", ok_day)
            if hit.get("registered") is not None:
                raise AssertionError("④ rule 指向不存在的 id 时，原发现应仍是未登记")
            if _has(fs, "expired"):
                raise AssertionError("④ 没过期的孤儿行不得报 expired")
            if not _has(fs, "orphan"):
                raise AssertionError("④ rule 匹配不到任何 id 应多一条 exception-register/orphan")

            skips = [f["id"] for f in findings if f["status"] == SKIP
                     and not f["id"].startswith(("tool-identity/", EXCEPTION_CHECK + "/"))]
            if not skips:
                raise AssertionError("冒烟仓没有 SKIP 发现，⑤ 无从自检")
            fs, _, _ = _register(skips[0], ok_day)
            if not _has(fs, "orphan"):
                raise AssertionError("⑤ rule 匹配到 SKIP（不是未定）也应报 exception-register/orphan，"
                                     "否则死行会在日后该条转回未定时静默复活")

            # ⑥ 项目自有例外（规则列不含 `/`）只按到期判：过期未关闭 FAIL、到期写不成日期记未定、
            #    未到期与已关闭的不出发现，也不当孤儿（02 §4 到期未清理 CI 转红）
            fs, hit, _ = _register(target, ok_day, (
                u"| EX-003 | G9 依赖规则 | 过期 | 全仓 | 自检 | %s | active |\n"
                u"| EX-004 | G6 依赖审计 | 未到期 | 全仓 | 自检 | %s | active |\n"
                u"| EX-005 | G11 文档新鲜度 | 无到期 | 全仓 | 自检 |  | active |\n"
                u"| EX-006 | G7 | 已关闭 | 全仓 | 自检 | %s | 已处理 |\n"
                u"| EX-007 | G8 | 待关闭不是关闭 | 全仓 | 自检 | %s | 待关闭 |\n"
                u"| EX-00A | G12 | 太远 | 全仓 | 自检 | %s | active |\n"
                u"| EX-00B | G13 | 恰一年 | 全仓 | 自检 | %s | active |\n")
                % (yesterday, ok_day, yesterday, yesterday, (today + datetime.timedelta(days=366)).isoformat(),
                   (today + datetime.timedelta(days=365)).isoformat()))
            own = sorted((f["status"], f["id"]) for f in fs if f["id"].startswith(EXCEPTION_CHECK + "/"))
            if own != [(FAIL, EXCEPTION_CHECK + "/own-expired/EX-003"),
                       (FAIL, EXCEPTION_CHECK + "/own-expired/EX-007"),
                       (UNDETERMINED, EXCEPTION_CHECK + "/own-too-far"),
                       (UNDETERMINED, EXCEPTION_CHECK + "/own-undated")]:
                raise AssertionError("⑥ 项目自有例外应只得 own-expired/EX-003、EX-007（状态「待关闭」不是关闭）"
                                     "FAIL、own-too-far（+366 天，+365 天不报）与 own-undated，实得 %r" % (own,))
            if (hit.get("registered") or {}).get("id") != "EX-001":
                raise AssertionError("⑥ 项目自有例外行不得影响 Finding id 行的登记")
            # ⑦ 检查器自身出错（崩溃、自检闸门不过）的未定不可登记：修前它是稳定 id、登记即退出 0，
            #    等于登记了被崩溃顶掉的 FAIL；修后该行记不合格，那条未定仍是未登记（契约 §9）
            crash = undetermined_from_exception("layout", TypeError("x"), u"跑 layout")
            fs, _, _ = _register(target, ok_day, u"| EX-008 | %s | 崩溃 | 全仓 | 自检 | %s | active |\n"
                                 % (crash["id"], ok_day), more=[crash])
            got = [f.get("registered") for f in fs if f["id"] == crash["id"]]
            if crash["id"] != "layout/internal-error" or got != [None] or not _has(fs, "invalid-rows"):
                raise AssertionError("⑦ 崩溃未定 %s 登记后应仍未登记并报 invalid-rows，实得 %r"
                                     % (crash["id"], got))
            #    对照：读不了的文件（unreadable/<路径>）是对象的事，登记照常生效（R126-1）
            unr = sl_unreadable("evidence", u"work/WI-9.md", OSError("x"))
            fs, _, _ = _register(target, ok_day, u"| EX-009 | %s | 读不了 | 该文件 | 自检 | %s | active |\n"
                                 % (unr["id"], ok_day), more=[unr])
            got = [(f.get("registered") or {}).get("id") for f in fs if f["id"] == unr["id"]]
            if got != ["EX-009"] or _has(fs, "invalid-rows"):
                raise AssertionError("⑦ unreadable 未定登记应生效，实得 %r" % (got,))

            # ⑧ 到期上限一年：今天 + 365 天仍生效，+ 366 天记不合格、不生效
            edge = (today + datetime.timedelta(days=365)).isoformat()
            far = (today + datetime.timedelta(days=366)).isoformat()
            fs, hit, _ = _register(target, edge)
            if (hit.get("registered") or {}).get("id") != "EX-001" or _has(fs, "invalid-rows"):
                raise AssertionError("⑧ 到期恰为今天 + 365 天应生效，实得 %r" % (hit.get("registered"),))
            fs, hit, _ = _register(target, far)
            if hit.get("registered") is not None or not _has(fs, "invalid-rows"):
                raise AssertionError("⑧ 到期晚于今天 + 365 天应不生效并报 invalid-rows，实得 %r"
                                     % (hit.get("registered"),))
            os.remove(ex_path)

            # 3h) 工具自身所在的内嵌目录不进扫描面（契约 §2）。采用项目里 `.std/`
            #     是 subtree 内嵌的**被跟踪文件**，不排除就会把上游的示例项目整个扫进来，
            #     实测一个空项目因此得到 31 条 FAIL，提交门装上即锁死。
            emb = os.path.join(tmp, "emb")
            std_dir = os.path.join(emb, ".std")
            os.makedirs(os.path.join(std_dir, "docs"))
            os.makedirs(os.path.join(std_dir, "tools", "std"))
            os.makedirs(os.path.join(emb, "docs"))
            for f_path in (os.path.join(std_dir, "docs", "bad.md"),
                           os.path.join(emb, "docs", "good.md")):
                with io.open(f_path, "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(u"# 样本\n")
            subprocess.run(["git", "init", "-q", emb], capture_output=True, timeout=60)
            subprocess.run(["git", "-C", emb, "-c", "core.autocrlf=false", "-c", "core.safecrlf=false",
                            "add", "-A"], capture_output=True, timeout=60)
            for r, tr, want in ((emb, std_dir, ".std"), (emb, emb, None), (emb, tmp, None)):
                got = embedded_std_rel(r, tr)
                if got != want:
                    raise AssertionError("embedded_std_rel(%r, %r) 应得 %r，实得 %r"
                                         % (r, tr, want, got))
            listed, prob = tracked_files(emb, None, std_dir)
            if prob or sorted(listed or []) != ["docs/good.md"]:
                raise AssertionError("内嵌目录应被排除出扫描面，实得 %r（%s）" % (listed, prob))

            # 4) main 整条走一遍（argparse + 输出 + 退出码），不允许抛异常
            for argv in ([proj, "--config", cfg_path, "--no-scope"],
                         [proj, "--config", cfg_path, "--json"]):
                sink = io.StringIO()
                with contextlib.redirect_stdout(sink):
                    code = main(argv)
                if code not in (0, 1, 2):
                    raise AssertionError("main(%r) 退出码 %r 不在 {0,1,2}" % (argv, code))
                if not sink.getvalue().strip():
                    raise AssertionError("main(%r) 什么都没输出" % (argv,))
                if "--json" in argv:
                    data = json.loads(sink.getvalue())
                    ids = [f for f in data if f.get("check") == IDENTITY_CHECK]
                    if len(ids) != 1 or "tool_identity_digest" not in (ids[0].get("evidence") or ""):
                        raise AssertionError("--json 里没有检查器身份字段")
    except Exception as exc:  # noqa: BLE001
        out.append(finding(
            "entry-smoke", FAIL, "入口冒烟自检没跑通：check_all 自己就跑不起来",
            where="tools/std/check_all.py",
            why="契约 §3 只管各检查器的反例；入口崩了的话所有检查器的绿都没有意义",
            evidence="%s: %s" % (type(exc).__name__, exc),
        ))
        return out
    out.append(finding(
        "entry-smoke", PASS, "入口冒烟：run_all / render / main 在临时仓 + 外部配置下跑通",
        where="tools/std/check_all.py",
        why="契约 §3：守卫存在不等于守卫在执行——入口本身也要有反例",
        evidence="run_all 返回二元组、findings 三态合法、render 出覆盖边界与外部配置标注、"
                 "内嵌目录自排除（embedded_std_rel 三例 + tracked_files 只剩项目自己的文件）、"
                 "文本与 --json 都带检查器身份块、--config 指向项目内部时不标外部配置、"
                 "工作目录 ≠ 被扫根时项目内的默认配置仍标『在被扫描项目内』、"
                 "例外登记五条（有效登记生效／过期不生效且报 expired／"
                 "坏行报 invalid-rows／孤儿行报 orphan 且不报 expired／匹配到 SKIP 的行也报 orphan／"
                 "项目自有例外过期未关闭报 own-expired FAIL（状态「待关闭」不算关闭）、到期不是日期报 own-undated、晚于运行日 + 365 天报 own-too-far；"
                 "有过期行时首部标出其中几行已过期；检查器自身出错的未定登记不生效、报 invalid-rows，读不了的文件照常可登记；"
                 "到期恰为今天 + 365 天生效、再晚一天报 invalid-rows）、"
                 "main 两种 argv 退出码合法且有输出",
    ))
    return out


def _shared_fact_selftest(mods):
    """跨检查器的四条反例：同一事实只报一次（契约 §1），同一工件只有一份候选、同一个配置键
    只有一份缺省或一种读法（01 §1 G2）。

    单个检查器的 selftest 看不见别的检查器，这几条只能在汇总层断言。来由：工作项目录
    不在时 layout / evidence / freshness 各报一条未定，采用方得为同一件事登记三行；
    状态工件的候选 layout 与 drift 各写一份且不一致，同一个项目被一个说"有"、一个说"没有"；
    未配 layout.docs_root 时 layout 兜底取 docs，freshness 与 drift 却记未定；
    未配 layout.entry 时 layout 按候选找到入口，entry-budget 却记「未配置入口文件」。
    """
    import subprocess
    import tempfile

    by = dict((n, m) for n, m, err in mods if err is None)
    need = ("layout", "evidence", "freshness", "drift")
    if any(n not in by for n in need + ("entry-budget",)):
        return [finding("shared-fact", UNDETERMINED, "跨检查器自检缺检查器",
                        reason="需要 %s，实有 %s" % ("/".join(need + ("entry-budget",)),
                                                   "/".join(sorted(by))))]

    def _repo(tmp, files):
        for rel, body in files.items():
            path = os.path.join(tmp, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(body)
        subprocess.run(["git", "init", "-q", tmp], capture_output=True, timeout=60)
        subprocess.run(["git", "-C", tmp, "-c", "core.autocrlf=false", "-c", "core.safecrlf=false",
                        "add", "-A"], capture_output=True, timeout=60)

    out = []
    try:
        # A：L1 项目没有工作项目录，缺省与声明两种 work_root 各跑一遍四个检查器。
        #    断言目录缺失这件事在未定/失败里只出现一次、由 layout 报，
        #    evidence 与 freshness 各记一条 work-root-absent 的 SKIP。
        got_a = []
        with tempfile.TemporaryDirectory() as tmp:
            _repo(tmp, {"CLAUDE.md": u"# 入口\n"})
            for extra in ({}, {"work_root": "items"}):
                layout = dict({"entry": ["CLAUDE.md"], "docs_root": "docs"}, **extra)
                cfg = {"_root": tmp, "tier": "L1", "layout": layout}
                wr = work_root(cfg)[0]
                fs = [f for n in need for f in by[n].run(cfg)]
                told = [f for f in fs if f["status"] in (UNDETERMINED, FAIL)
                        and (u"工作项目录" in f["title"] or u"（work_current）" in f["title"])]
                skips = sorted(f["id"] for f in fs if f["id"].endswith("/work-root-absent")
                               and u"负责报告的检查器：layout" in (f["evidence"] or ""))
                ok = (len(told) == 1 and told[0]["check"] == "layout"
                      and wr in (told[0]["where"] or "") + (told[0]["evidence"] or "")
                      and skips == ["evidence/work-root-absent", "freshness/work-root-absent"])
                got_a.append((wr, ok, [(f["id"], f["title"]) for f in told], skips))
        out.append(finding(
            "shared-fact", PASS if all(g[1] for g in got_a) else FAIL,
            "工作项目录不在：未定只由 layout 报一次，evidence/freshness 记不适用并指向它",
            why="契约 §1：同一事实只由一个检查器报；报两次采用方就得登记两行",
            evidence="实得 %r" % (got_a,)))

        # B：只放一份状态文件（外加它列的那件工作项，让 drift 走到对账），layout 与 drift
        #    对它在不在给同一个答案；候选之外的名字（模板文件名 PROJECT_STATUS.md）两边都不认。
        got_b = []
        for rel in list(STATUS_CANDIDATES) + ["PROJECT_STATUS.md"]:
            with tempfile.TemporaryDirectory() as tmp:
                _repo(tmp, {"CLAUDE.md": u"# 入口\n", rel: u"# 状态\n\n- WI-0001 在做。\n",
                            "docs/state/work/WI-0001-a.md": u"# WI-0001\n"})
                cfg = {"_root": tmp, "tier": "L0",
                       "layout": {"entry": ["CLAUDE.md"], "docs_root": "docs"}}
                lay = any(f["status"] == PASS and f["where"] == rel for f in by["layout"].run(cfg))
                dri = any(f["id"] == "drift/work-item" and f["where"] == rel
                          for f in by["drift"].run(cfg))
                got_b.append((rel, lay, dri))
        want = [(r, r in STATUS_CANDIDATES, r in STATUS_CANDIDATES) for r, _l, _d in got_b]
        out.append(finding(
            "shared-fact", PASS if got_b == want else FAIL,
            "状态工件候选：layout 与 drift 认同一份（stdlib.STATUS_CANDIDATES）",
            why="01 §1 G2：同一事实一处权威；两份候选让同一个项目被说成既有又没有状态工件",
            evidence="实得 (路径, layout 命中, drift 命中) %r；应得 %r" % (got_b, want)))

        # C：未配 layout.docs_root。四个检查器按同一个缺省（stdlib.DEFAULT_DOCS_ROOT）读，
        #    不再有的兜底、有的记「未配置文档根目录」；freshness 照扫 docs/ 下的文档并注明用了默认。
        with tempfile.TemporaryDirectory() as tmp:
            _repo(tmp, {"CLAUDE.md": u"# 入口\n", "docs/architecture/a.md": u"# 架构\n"})
            cfg = {"_root": tmp, "tier": "L1", "layout": {"entry": ["CLAUDE.md"]}}
            fs = [f for n in need for f in by[n].run(cfg)]
            unset = [f["id"] for f in fs if u"未配置文档根目录" in f["title"]]
            # 未配 metadata_required：目录名约定命中只记未定（契约 §1.1），汇在 undated-by-convention
            judged = [f["id"] for f in fs if f["id"] == "freshness/undated-by-convention"
                      and u"docs/architecture/a.md" in (f["evidence"] or "")
                      and u"未配 layout.docs_root" in (f["evidence"] or "")]
        out.append(finding(
            "shared-fact", PASS if not unset and len(judged) == 1 else FAIL,
            "未配 layout.docs_root：各检查器取同一个缺省 docs 并注明，不再一家兜底一家记未定",
            why="契约 §5：缺省只有一处（stdlib.docs_root_of），取了默认就在证据里写明",
            evidence="记未配置的 %r；freshness 按缺省判出的 %r" % (unset, judged)))

        # D：未配 layout.entry。layout 与 entry-budget 按同一种读法（stdlib.entry_files）认入口：
        #    两个候选同时在时都取第一个（AGENTS.md），候选入口超预算只记未定（契约 §1.1），
        #    声明之后才判 FAIL；候选全不在时入口缺失只由 layout 报一次，entry-budget 记不适用。
        got_d = {}
        other = tuple("entry-budget/budget-undeclared/%s_lines" % r
                      for r in ("status", "handoff", "work_item", "module"))
        with tempfile.TemporaryDirectory() as tmp:
            _repo(tmp, {"AGENTS.md": u"x\n" * 20, "CLAUDE.md": u"@AGENTS.md\n"})
            cfg = {"_root": tmp, "tier": "L0", "budgets": {"entry_lines": 10}}
            got_d["layout"] = sorted(f["where"] for f in by["layout"].run(cfg)
                                     if f["status"] == PASS and f["title"].startswith(u"入口 "))
            got_d["guessed"] = [(f["id"], f["status"]) for f in by["entry-budget"].run(cfg)
                                if f["id"] not in other]
            cfg["layout"] = {"entry": ["AGENTS.md"]}
            got_d["declared"] = [f["status"] for f in by["entry-budget"].run(cfg) if f["id"] not in other]
        with tempfile.TemporaryDirectory() as tmp:
            _repo(tmp, {"README.md": u"# 说明\n"})
            cfg = {"_root": tmp, "tier": "L0"}
            fs = by["layout"].run(cfg) + by["entry-budget"].run(cfg)
            got_d["absent"] = sorted((f["id"], f["status"]) for f in fs if u"入口" in f["title"])
            cfg["layout"] = {"entry": ["GONE.md"]}     # 声明了、文件不在：同样只由 layout 报
            fs = by["layout"].run(cfg) + by["entry-budget"].run(cfg)
            got_d["declared_absent"] = sorted((f["check"], f["status"], f["where"]) for f in fs
                                              if u"入口" in f["title"])
        want_d = {
            "layout": ["AGENTS.md"],
            "guessed": [("entry-budget/candidate-over/AGENTS.md", UNDETERMINED)],
            "declared": [FAIL],
            "declared_absent": [("entry-budget", SKIP, "GONE.md"), ("layout", FAIL, "GONE.md")],
            "absent": sorted([("entry-budget/entry-absent", SKIP),
                              (finding_id("layout", u"★ 入口 类工件没找到（entry）"), UNDETERMINED)]),
        }
        out.append(finding(
            "shared-fact", PASS if got_d == want_d else FAIL,
            "未配 layout.entry：layout 与 entry-budget 认同一个入口，候选超预算记未定，入口缺失只报一次",
            why="01 §1 G2：同一配置一种读法（stdlib.entry_files）；契约 §1.1 候选只出通过或未定；"
                "契约 §1 同一事实只报一次",
            evidence="实得 %r；应得 %r" % (got_d, want_d)))
    except Exception as exc:  # noqa: BLE001
        out.append(undetermined_from_exception("shared-fact", exc, "跑跨检查器自检"))
    return out


def _embedded_readonly_selftest(mods):
    """汇总层钉住 01 §8「`.std/` 只读」：造一个内嵌且 `.std/` 有未暂存改动的仓，adoption 检查器
    的结论里必须出现 `adoption/embedded-modified` 的 FAIL。

    检查器自己的 selftest 钉不住"整个检查器被换回不含这条判据的旧版"——旧版自带的 selftest
    照样全绿。这条断言不借用检查器里的任何夹具代码，缺检查器、接口对不上（旧版 run 不收
    tool_root）、没出这条 FAIL，一律判 FAIL。
    """
    import subprocess
    import tempfile

    title = "内嵌仓 .std/ 有未暂存改动：adoption 必须报 embedded-modified FAIL（01 §8 只读）"
    why = "01 §8：内嵌的 `.std/` 只读；契约 §3：守卫存在不等于守卫在执行，换回旧版要能被发现"
    by = dict((n, m) for n, m, err in mods if err is None)
    if "adoption" not in by:
        return [finding("shared-fact", FAIL, title, why=why,
                        evidence="没有加载成功的 adoption 检查器，实有 %s" % "/".join(sorted(by)))]
    git_id = ["-c", "init.defaultBranch=main", "-c", "user.email=std@example.invalid",
              "-c", "user.name=std", "-c", "commit.gpgsign=false",
              "-c", "core.hooksPath=/dev/null", "-c", "core.autocrlf=false"]
    try:
        with tempfile.TemporaryDirectory() as proj:
            for rel, body in (("governance/STANDARD_VERSION", "2026-09-22.2\nadopted_at: 2025-03-03\n"),
                              (".std/标准/README.md", "**候选实现修订：`2026-09-22.2`。**\n"),
                              (".std/x.md", "标准\n")):
                path = os.path.join(proj, rel)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(body)
            for args in (["init", "-q"], ["add", "-A"], ["commit", "-q", "-m", "s"]):
                r = subprocess.run(["git", "-C", proj] + git_id + args,
                                   capture_output=True, timeout=60)
                if r.returncode != 0:
                    raise RuntimeError("git %s 退出码 %d" % (args[0], r.returncode))
            with open(os.path.join(proj, ".std", "x.md"), "a", encoding="utf-8") as fh:
                fh.write("就地改\n")
            fs = by["adoption"].run({"_root": proj}, tool_root=os.path.join(proj, ".std"))
    except Exception as exc:  # noqa: BLE001
        return [finding("shared-fact", FAIL, title, why=why,
                        evidence="跑不起来：%s: %s" % (type(exc).__name__, exc))]
    hit = [f for f in fs if f["id"] == "adoption/embedded-modified" and f["status"] == FAIL]
    return [finding("shared-fact", PASS if hit else FAIL, title, why=why,
                    evidence="adoption 实得 %s" % [(f["status"], f["id"]) for f in fs])]


def _git_env_selftest():
    """钩子注入的 GIT_DIR 不得把夹具写进别的仓。

    真实事故：从 git worktree 提交，pre-commit 钩子里跑 check_all，git 注入的绝对路径
    GIT_DIR/GIT_INDEX_FILE 压过了夹具的 `git -C <临时目录>`，真实分支被写进
    垃圾提交、.git/config 被改成 core.bare=true。这里建一个牺牲仓，照 worktree 钩子实测的
    注入形态（绝对 GIT_DIR 与 GIT_INDEX_FILE，不带 GIT_WORK_TREE——带上它反而掩盖泄漏）指向它，
    以子进程走真实入口跑一遍会建夹具的扫描，断言牺牲仓的 config、HEAD、refs 一字未变。
    """
    import subprocess
    import tempfile

    title = "钩子注入的 GIT_DIR 等变量不得让夹具写进调用方的仓"
    why = "从 worktree 提交时 pre-commit 钩子带着绝对 GIT_DIR 跑 check_all，曾把真实仓改成 bare"
    git_id = ["-c", "init.defaultBranch=main", "-c", "user.email=std@example.invalid",
              "-c", "user.name=std", "-c", "commit.gpgsign=false",
              "-c", "core.hooksPath=/dev/null", "-c", "core.autocrlf=false"]

    def snap(repo):
        gd, got = os.path.join(repo, ".git"), {}
        for dp, _dirs, files in os.walk(gd):
            for f in files:
                path = os.path.join(dp, f)
                rel = os.path.relpath(path, gd).replace(os.sep, "/")
                if rel in ("HEAD", "config", "packed-refs") or rel.startswith("refs/"):
                    with open(path, "rb") as fh:
                        got[rel] = fh.read()
        return got

    try:
        with tempfile.TemporaryDirectory() as tmp:
            victim, proj = os.path.join(tmp, "victim"), os.path.join(tmp, "proj")
            cfg_path = os.path.join(tmp, "project.yaml")
            for path, body in ((os.path.join(victim, "a.md"), u"牺牲仓\n"),
                               (os.path.join(proj, "CLAUDE.md"), _SMOKE_ENTRY),
                               (cfg_path, _SMOKE_CONFIG)):
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(body)
            for args in (["init", "-q"], ["add", "-A"], ["commit", "-q", "-m", "s"]):
                r = subprocess.run(["git", "-C", victim] + git_id + args,
                                   capture_output=True, timeout=60)
                if r.returncode != 0:
                    raise RuntimeError("git %s 退出码 %d" % (args[0], r.returncode))
            before = snap(victim)
            env = dict(os.environ, GIT_DIR=os.path.join(victim, ".git"),
                       GIT_INDEX_FILE=os.path.join(victim, ".git", "index"))
            run = subprocess.run([sys.executable, os.path.join(HERE, "check_all.py"), proj,
                                  "--config", cfg_path, "--json"],
                                 capture_output=True, timeout=300, env=env)
            ran = b'"check": "adoption"' in (run.stdout or b"")
            after = snap(victim)
    except Exception as exc:  # noqa: BLE001
        return [finding("shared-fact", FAIL, title, why=why,
                        evidence="跑不起来：%s: %s" % (type(exc).__name__, exc))]
    changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
    if changed or not ran:
        return [finding("shared-fact", FAIL, title, why=why,
                        evidence="牺牲仓被改：%s" % "、".join(changed) if changed
                        else "子进程没跑到检查器（退出码 %s）" % run.returncode)]
    return [finding("shared-fact", PASS, title, why=why,
                    evidence="GIT_DIR/GIT_INDEX_FILE 指向牺牲仓跑完整扫描，"
                             "其 config、HEAD、refs 共 %d 个文件未变" % len(after))]


def _stdlib_selftest(mods):
    """stdlib 的配置读取与路径护栏：每条样本都来自一次实测的误读或越界（D-123）。

    逐条断言，失败时证据写明哪一条；样本写在临时目录里，不碰真实仓库。
    """
    import subprocess
    import tempfile
    import stdlib as sl

    def load(tmp, body, name="project.yaml", raw=None):
        gov = os.path.join(tmp, "governance")
        os.makedirs(gov, exist_ok=True)
        with io.open(os.path.join(gov, name), "wb") as fh:
            fh.write(raw if raw is not None else body.encode("utf-8"))
        return sl.load_config(tmp)

    cases = []
    try:
        with tempfile.TemporaryDirectory() as base:
            def fresh(tag):
                d = os.path.join(base, tag)
                os.makedirs(d)
                return d
            # 安全 2：配置是指向项目之外的符号链接 → 不读、不回显内容
            out_dir, proj = fresh("outside"), fresh("p1")
            secret = os.path.join(out_dir, "secret.txt")
            with io.open(secret, "w", encoding="utf-8") as fh:
                fh.write(u"tier: TOPSECRET\n")   # 合法配置：护栏失效时会被当成项目配置读进来
            os.makedirs(os.path.join(proj, "governance"))
            os.symlink(secret, os.path.join(proj, "governance", "project.yaml"))
            cfg, prob = sl.load_config(proj)
            cases.append(("配置经符号链接指向项目之外应拒读且不回显内容",
                          bool(prob) and "TOPSECRET" not in prob and not cfg, prob))
            # 安全 2：配置里的路径带 .. 或绝对路径 → 整份拒收
            for tag, body in (("p2", u"tier: L1\nlayout:\n  entry:\n    - ../outside/secret.md\n"),
                              ("p3", u"tier: L1\nlayout:\n  artifacts:\n    status: /etc/passwd\n"),
                              ("p4", u"tier: L1\nmetadata_required:\n  - docs/../../x\n")):
                cfg, prob = load(fresh(tag), body)
                cases.append(("配置路径含 .. 或绝对路径应拒收（%s）" % tag, bool(prob) and not cfg, prob))
            # 安全 2：不回显解析失败行的内容
            cfg, prob = load(fresh("p5"), u"tier: L1\nTOPSECRET-LINE\n")
            cases.append(("解析失败的报错不回显行内容", bool(prob) and "TOPSECRET" not in prob, prob))
            # 安全 4：深嵌套不崩，记未定
            deep = u"".join(u"%sk%d:\n" % (u"  " * i, i) for i in range(1200)) + u"  " * 1200 + u"v: 1\n"
            try:
                cfg, prob = load(fresh("p6"), deep)
                cases.append(("1200 层嵌套应报解析失败（未定），不抛 RecursionError", bool(prob), prob))
            except RecursionError as exc:
                cases.append(("1200 层嵌套应报解析失败（未定），不抛 RecursionError", False, repr(exc)))
            # 安全 2：read_text 给了 root 就不跟随指向项目之外的符号链接
            proj = fresh("p7")
            os.symlink(secret, os.path.join(proj, "a.md"))
            try:
                sl.read_text(os.path.join(proj, "a.md"), proj)
                cases.append(("read_text 不跟随指向项目之外的符号链接", False, "读到了"))
            except sl.OutsideRoot as exc:
                cases.append(("read_text 不跟随指向项目之外的符号链接", "TOPSECRET" not in str(exc), str(exc)))
            # A2／A3／A15：读被扫文件只走 stdlib.read_bytes——FIFO 不读不阻塞、超限不读、打开前后复核真实位置
            proj = fresh("p16")
            def _try(fn):
                try:
                    return "读到：%r" % fn()[:20]
                except OSError as exc:
                    return type(exc).__name__
            fifo = os.path.join(proj, "fifo.md")
            os.mkfifo(fifo)
            got = _try(lambda: sl.read_text(fifo, proj))
            cases.append(("FIFO 不读、不阻塞（NotRegular）", got == "NotRegular", got))
            big = os.path.join(proj, "big.md")
            with open(big, "wb") as fh:
                fh.truncate(sl.MAX_READ_BYTES + 1)          # 稀疏文件，不占盘
            got = [_try(lambda: sl.read_text(big, proj)), _try(lambda: sl.read_bytes(big, proj, head=4))]
            cases.append(("超过 MAX_READ_BYTES 不读（TooLarge），只读头部时照读",
                          got == ["TooLarge", "读到：b'\\x00\\x00\\x00\\x00'"], got))
            inner, outer = os.path.join(proj, "d"), os.path.join(out_dir, "d")
            for d_, body in ((inner, u"inside\n"), (outer, u"TOPSECRET\n")):
                os.makedirs(d_)
                with io.open(os.path.join(d_, "a.md"), "w", encoding="utf-8") as fh:
                    fh.write(body)
            real_open = os.open

            def _swap(p_, *a_, **k_):                       # 护栏放行之后、打开之前把中间目录换成出仓链接
                if not os.path.islink(inner):
                    os.rename(inner, inner + ".bak")
                    os.symlink(outer, inner)
                return real_open(p_, *a_, **k_)
            os.open = _swap
            try:
                got = _try(lambda: sl.read_text(os.path.join(inner, "a.md"), proj))
            finally:
                os.open = real_open
            cases.append(("护栏之后路径被换出仓：打开后复核拦下（OutsideRoot），不读仓外内容",
                          got == "OutsideRoot", got))
            # R1-12：每读一份文件的 realpath 次数（原 5 次，每次逐段 lstat）
            calls, real_rp = [], os.path.realpath
            os.path.realpath = lambda p_, *a_, **k_: (calls.append(p_), real_rp(p_, *a_, **k_))[1]
            try:
                sl.read_bytes(big, proj, head=4)
            finally:
                os.path.realpath = real_rp
            cases.append(("read_bytes 每读一份只做 3 次 realpath", len(calls) <= 3, calls))
            # A4／B1：.claude/settings.json 深嵌套让 json 抛 RecursionError，只作废这一条判据，不让整个 adoption 崩
            proj = fresh("p24")
            os.makedirs(os.path.join(proj, ".claude"))
            with io.open(os.path.join(proj, ".claude", "settings.json"), "w", encoding="utf-8") as fh:
                fh.write(u"[" * 200000 + u"]" * 200000)
            adoption = dict((n, m) for n, m, _e in mods if m is not None)["adoption"]
            try:
                got = [f["title"] for f in adoption._settings_allow(proj)]
            except RecursionError as exc:
                got = repr(exc)
            cases.append(("settings.json 深嵌套记这一条未定，不崩检查器",
                          isinstance(got, list) and len(got) == 1, got))
            # A11／C21／A4：列表键写成标量或映射、layout.entry: 5 → 整份拒收并报键名与行号，不静默误读、不崩检查器
            for tag, body, key in (
                    ("p19", u"tier: L1\nlayout:\n  frozen: docs/archive\n", u"第 3 行 layout.frozen"),
                    ("p20", u"tier: L1\ntailoring:\n  check: layout\n  applicable: false\n", u"第 2 行 tailoring"),
                    ("p21", u"tier: L1\nlayout:\n  entry: 5\n", u"第 3 行 layout.entry"),
                    ("p22", u"tier: L1\nwork_item_done_states:\n  done: x\n", u"第 2 行 work_item_done_states"),
                    ("p23", u"tier: L1\nrepos:\n  - name: a\n    path: .\n    former_names: b\n",
                     u"第 5 行 repos[0].former_names"),
                    # R1-04：字符串键写成列表或映射同样拒收
                    ("p28", u"tier: L1\nlayout:\n  work_root:\n    - a\n", u"第 3 行 layout.work_root"),
                    ("p29", u"tier: L1\nlayout:\n  docs_root:\n    k: v\n", u"第 3 行 layout.docs_root"),
                    ("p30", u"tier: L1\nlayout:\n  artifacts:\n    status:\n      - a\n",
                     u"第 4 行 layout.artifacts.status"),
                    ("p31", u"tier: L1\nrepos:\n  - name: a\n    path:\n      - x\n", u"第 4 行 repos[0].path")):
                cfg, prob = load(fresh(tag), body)
                cases.append(("配置键形状不对整份拒收（%s）" % key, not cfg and key in (prob or ""), prob))
            # A10：列表项空值取 None（不按下一行形状读成 [] 或 {}）；a: b: c、引号不闭合拒收
            got = [sl.parse_yaml_subset(u"r:\n  - name: a\n    former_names:\n  - name: b\n"),
                   sl.parse_yaml_subset(u"d:\n  - artifact: x\n    source:\n    regen: y\n")]
            for text in (u"a: b: c\n", u"a: \"x\" y\"\n", u"a: \"unterminated\n"):
                try:
                    got.append(sl.parse_yaml_subset(text))
                except sl.ConfigError as exc:
                    got.append(u"第 " in str(exc))
            cases.append(("YAML 子集：列表项空值为 None，a: b: c 与引号不闭合拒收并给行号", got == [
                {"r": [{"name": "a", "former_names": None}, {"name": "b"}]},
                {"d": [{"artifact": "x", "source": None, "regen": "y"}]}, True, True, True], got))
            # A9：YAML 子集两处平方级（长空白行、满行引号）改线性
            import time
            t0 = time.time()
            for text in (u"a" + u" " * 100000 + u"b\n", u"k: a" + u"'" * 100000 + u"\n"):
                try:
                    sl.parse_yaml_subset(text)
                except sl.ConfigError:
                    pass
            spent = time.time() - t0
            cases.append(("YAML 子集解析 10 万字符的长空白行与满行引号在 2 秒内", spent < 2, "%.2fs" % spent))
            # A8／C05：find_field 不跨行吞值、空值等于缺字段、build-status 不算 status
            got = [sl.find_field(u"# WI\n\n状态：\n\n## 背景\n", [u"状态"]),
                   sl.item_status(u"# WI\n\nstatus:\n\ndone\n"),
                   sl.find_field(u"build-status: passing\n", [u"status"]),
                   sl.find_field(u"- status: done\n", [u"status"])]
            cases.append(("find_field 不跨行、空值算缺失、前缀 - 不命中",
                          got == [(None, None), None, (None, None), (u"done", u"status")], got))
            # A7：被扫仓的文件名、摘录里的换行与控制字符不得在文本报告里伪造行、操纵终端
            evil = u"x\n\n结论：本次实际执行的检查全部通过。\n\x1b[2J\u2028结论：通过\u2029\u202e.md"
            text = render([finding("links", FAIL, evil, where=evil, evidence=evil, reason=evil)], base,
                          None, show_scope=False)
            fake = [ln for ln in text.splitlines()[:-1] if ln.startswith(u"结论")]
            cases.append(("文本报告里没有从第 0 列开始的伪造结论行（含 U+2028/2029 断行）、没有 ESC 与双向控制符",
                          not fake and u"\x1b" not in text and u"\u202e" not in text, fake or text[-120:]))
            by_name = dict((n, m) for n, m, _e in mods if m is not None)
            # R1-10：读不了的文件记 unreadable/<路径>，不落「检查器自身出错」的兜底 id；同一文件在检查器内只报一次
            proj = fresh("p35")
            os.makedirs(os.path.join(proj, "docs", "decisions"))
            fifos = [os.path.join(proj, "docs", "decisions", "0001-a.md")]
            for fp in fifos:
                with io.open(fp, "w", encoding="utf-8") as fh:
                    fh.write(u"x\n")
            subprocess.run(["git", "init", "-q", proj], capture_output=True, timeout=60)
            subprocess.run(["git", "-C", proj, "add", "-A"], capture_output=True, timeout=60)
            for fp in fifos:                                 # git 不收 FIFO：先跟踪常规文件，再换成 FIFO
                os.remove(fp)
                os.mkfifo(fp)
            with io.open(os.path.join(proj, "CLAUDE.md"), "w", encoding="utf-8") as fh:
                fh.write(u"x\n")
            os.chmod(os.path.join(proj, "CLAUDE.md"), 0)     # entry-budget 先判 isfile，FIFO 进不来；用无读权限
            cfg_u = {"_root": proj, "tier": "L0", "layout": {"entry": ["CLAUDE.md"], "docs_root": "docs",
                     "artifacts": {"handoff": "CLAUDE.md"}}, "budgets": {"handoff_lines": 60}}
            fs = [f for n in ("drift", "entry-budget") for f in by_name[n].run(cfg_u)]
            got = sorted(f["id"] for f in fs if f["status"] == UNDETERMINED and (
                u"读不了" in f["title"] or u"自身出错" in f["title"]))
            cases.append(("读不了的文件记 unreadable，不落兜底 id，检查器内同一文件只报一次", got == [
                "drift/unreadable/docs/decisions/0001-a.md"] + (["entry-budget/unreadable/CLAUDE.md"]
                                                              if os.geteuid() else []), got))   # root 无视权限位
            # R1-S2-03：freshness 与 links 读不了的文件同样记 unreadable/<路径>，同一文件只报一次
            proj = fresh("p36")
            wi = os.path.join(proj, "docs", "state", "work", "WI-001-x.md")
            os.makedirs(os.path.dirname(wi))
            with io.open(wi, "w", encoding="utf-8") as fh:
                fh.write(u"# WI-001\n\n状态：in_progress\n")
            subprocess.run(["git", "init", "-q", proj], capture_output=True, timeout=60)
            subprocess.run(["git", "-C", proj, "add", "-A"], capture_output=True, timeout=60)
            os.remove(wi)
            os.mkfifo(wi)
            cfg_u = {"_root": proj, "tier": "L1", "layout": {"entry": ["CLAUDE.md"], "docs_root": "docs"}}
            fs = [f for n in ("freshness", "links") for f in by_name[n].run(cfg_u)]
            got = sorted(f["id"] for f in fs if f["status"] == UNDETERMINED and (
                u"读不了" in f["title"] or u"自身出错" in f["title"]))
            cases.append(("freshness/links 读不了的文件记 unreadable、各只报一次", got == [
                "freshness/unreadable/docs/state/work/WI-001-x.md",
                "links/unreadable/docs/state/work/WI-001-x.md"], got))
            # R1-09：路径含换行的 git grep 命中按 -z 记号流切，路径不被截成换行后的那半段
            proj = fresh("p34")
            #          R1-S2：文件名里的反斜杠也照原样，archive\x.md 不得被改写成 archive/x.md 冒充 frozen 豁免
            for name in (u"src\narchive.md", u"archive\\x.md"):
                with io.open(os.path.join(proj, name), "w", encoding="utf-8") as fh:
                    fh.write(u"见 OldName 仓\n")
            subprocess.run(["git", "init", "-q", proj], capture_output=True, timeout=60)
            subprocess.run(["git", "-C", proj, "add", "-A"], capture_output=True, timeout=60)
            got = dict((n, m) for n, m, _e in mods if m is not None)["cross-repo"]._git_grep(proj, ["OldName"])
            got = (sorted(got[0] or []), got[1])
            cases.append(("git grep 命中的路径含换行或反斜杠时照原样取回", got == (sorted([
                (u"src\narchive.md", "1", u"见 OldName 仓"), (u"archive\\x.md", "1", u"见 OldName 仓")]), None), got))
            # R1-07：护栏在任何 isfile/isdir/exists 之前——出仓软链接的目标在不在，结论都一样（不探测仓外）
            proj, outd = fresh("p33"), fresh("p33-out")
            links = {"governance/STANDARD_VERSION": "sv", ".claude/settings.json": "set.json",
                     "AGENTS.md": "agents.md", "dec": "dec", "st.md": "st.md"}
            for rel, tgt in links.items():
                os.makedirs(os.path.dirname(os.path.join(proj, rel)) or proj, exist_ok=True)
                os.symlink(os.path.join(outd, tgt), os.path.join(proj, rel))
            with io.open(os.path.join(proj, "CLAUDE.md"), "w", encoding="utf-8") as fh:
                fh.write(_SMOKE_ENTRY)
            subprocess.run(["git", "init", "-q", proj], capture_output=True, timeout=60)
            subprocess.run(["git", "-C", proj, "add", "-A"], capture_output=True, timeout=60)

            def _probe():
                fs = by_name["adoption"].run({"_root": proj, "compatibility": {"policy": "x"}})
                fs += by_name["drift"].run({"_root": proj, "tier": "L0", "layout": {
                    "entry": ["CLAUDE.md"], "artifacts": {"decisions": "dec", "status": "st.md"}}})
                return (sorted((f["status"], f["id"]) for f in fs), sl.entry_files({"_root": proj})[0],
                        by_name["cross-repo"]._find_entry({"_real": proj}, ["AGENTS.md"])[1])
            absent = _probe()
            os.makedirs(os.path.join(outd, "dec"))
            for tgt in ("sv", "set.json", "agents.md", "st.md"):
                with io.open(os.path.join(outd, tgt), "w", encoding="utf-8") as fh:
                    fh.write(u"x\n")
            present = _probe()
            outs = sorted(i for _s, i in absent[0] if "/outside-root/" in i)
            cases.append(("出仓软链接：目标在不在结论一致，且记 outside-root",
                          absent == present and len(outs) == 4, (outs, [x for x in absent[0] if x not in present[0]])))
            # R1-06：已声明入口撑过读取上限，照数行（下界）判超预算 FAIL，不落未定
            proj = fresh("p32")
            with io.open(os.path.join(proj, "CLAUDE.md"), "w", encoding="utf-8") as fh:
                fh.write(u"x\n" * (sl.MAX_READ_BYTES // 2 + 10))
            eb = dict((n, m) for n, m, _e in mods if m is not None)["entry-budget"]
            got = [(f["status"], f["title"][:40]) for f in eb.run(
                {"_root": proj, "tier": "L0", "layout": {"entry": ["CLAUDE.md"]}, "budgets": {"entry_lines": 150}})
                if u"CLAUDE.md" in (f.get("title") or "")]
            cases.append(("已声明入口超过 2MB 判超预算 FAIL", [s_ for s_, _t in got] == [FAIL], got))
            # R1-02：工具目录里同名的标准库模块（未跟踪、不进身份哈希）不得被执行
            import shutil
            shadow = os.path.join(fresh("p26"), "std")
            shutil.copytree(HERE, shadow, ignore=shutil.ignore_patterns("__pycache__"))
            mark = os.path.join(base, "SHADOW_")
            for mod_name in ("argparse", "hashlib", "glob", "subprocess", "tempfile"):
                with io.open(os.path.join(shadow, mod_name + ".py"), "w", encoding="utf-8") as fh:
                    fh.write(u"open(%r, 'w').close()\n" % (mark + mod_name))
            proj = fresh("p27")
            with io.open(os.path.join(proj, "CLAUDE.md"), "w", encoding="utf-8") as fh:
                fh.write(_SMOKE_ENTRY)
            subprocess.run(["git", "init", "-q", proj], capture_output=True, timeout=60)
            shadow_cfg = os.path.join(base, "p27.yaml")
            with io.open(shadow_cfg, "w", encoding="utf-8") as fh:
                fh.write(_SMOKE_CONFIG)
            r = subprocess.run([sys.executable, os.path.join(shadow, "check_all.py"), proj, "--config", shadow_cfg,
                                "--no-scope"], capture_output=True, timeout=300)
            hits = sorted(f for f in os.listdir(base) if f.startswith("SHADOW_"))
            cases.append(("工具目录里的同名标准库模块不被导入执行", not hits and r.returncode in (0, 1, 2),
                          "%s；退出码 %d" % (hits, r.returncode)))
            # A6：模块按源码加载，__pycache__ 里的 unchecked-hash pyc 顶替不了源码
            import py_compile
            import importlib.util
            src = os.path.join(fresh("p18"), "m.py")
            with io.open(src, "w", encoding="utf-8") as fh:
                fh.write(u"X = 2\n")
            py_compile.compile(src, cfile=importlib.util.cache_from_source(src), doraise=True,
                               invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH)
            with io.open(src, "w", encoding="utf-8") as fh:
                fh.write(u"X = 1\n")
            got = (_load_source("m", src).X, getattr(sys.modules["stdlib"], "__spec__", 1),
                   [n for n, m, _e in mods if m is not None and getattr(m, "__spec__", 1) is not None])
            cases.append(("stdlib 与检查器按源码加载，不读 __pycache__ 里的 pyc", got == (1, None, []), got))
            # A5：顶层 _ 开头的键是代码注入口，写进 project.yaml 整份拒收（曾可用 _links_files 缩小 links 扫描面）
            cfg, prob = load(fresh("p17"), u"tier: L1\n_links_files:\n  - CLAUDE.md\n")
            cases.append(("配置写 _links_files 整份拒收并给行号", not cfg and u"第 2 行" in (prob or ""), prob))
            # bug 6：GBK 编码的配置不崩，记未定
            cfg, prob = load(fresh("p8"), None, raw=u"tier: L1\nlayout:\n  docs_root: 文档\n".encode("gbk"))
            cases.append(("非 UTF-8 编码的配置应报未定，不抛 UnicodeDecodeError", bool(prob), prob))
            # bug 6：检查器里的 sys.exit 不带走进程、不静默退 0：闸门与运行两处都转未定
            class _Exits(object):
                NAME = "exits"

                def __init__(self, where):
                    self.where = where

                def selftest(self):
                    if self.where == "selftest":
                        sys.exit(0)
                    return [finding("exits", PASS, "反例"), finding("exits", PASS, "正例")]

                def run(self, cfg):
                    sys.exit(0)
            got = []
            for where in ("selftest", "run"):
                try:
                    res = _run_one("exits", _Exits(where), {})
                    got.append([f["status"] for f in res])
                except BaseException as exc:  # noqa: BLE001
                    got.append(type(exc).__name__)
            class _Empty(object):
                NAME = "empty"

                def __init__(self, n):
                    self.n = n

                def selftest(self):
                    return [finding("empty", PASS, "ok")] * self.n

                def run(self, cfg):
                    return [finding("empty", PASS, "跑了")]
            gate = [[f["status"] for f in _run_one("empty", _Empty(n), {})] for n in (0, 1, 2)]
            cases.append(("自检闸门：返回 0 条或 1 条的自检不放行，2 条全过才放行",
                          gate == [[UNDETERMINED], [UNDETERMINED], [PASS]], gate))
            cases.append(("检查器 sys.exit(0) 在自检与运行两处都应转未定",
                          got == [[UNDETERMINED], [UNDETERMINED]], got))
            # bug 6：非 UTF-8 文件名进了发现时，--json 写到严格 UTF-8 的输出不崩
            proj = fresh("p9")
            with io.open(os.path.join(proj, "CLAUDE.md"), "w", encoding="utf-8") as fh:
                fh.write(_SMOKE_ENTRY)
            with open(os.path.join(os.fsencode(proj), b"\xff\xfe.md"), "wb") as fh:
                fh.write(b"# x\n\n[a](nope.md)\n")
            subprocess.run(["git", "-C", proj, "-c", "init.defaultBranch=main", "init", "-q"],
                           capture_output=True, timeout=60)
            subprocess.run(["git", "-C", proj, "add", "-A"], capture_output=True, timeout=60)
            cfg_p = os.path.join(base, "p9.yaml")
            with io.open(cfg_p, "w", encoding="utf-8") as fh:
                fh.write(_SMOKE_CONFIG)
            r = subprocess.run([sys.executable, os.path.join(HERE, "check_all.py"), proj, "--config", cfg_p,
                                "--json"], capture_output=True, timeout=300,
                               env=dict(os.environ, PYTHONIOENCODING="utf-8:strict"))
            try:
                got = json.loads(r.stdout.decode("utf-8", "replace"))
                parsed = isinstance(got, list) and not any(
                    u"检查器自身出错" in (f.get("title") or "") for f in got)
            except ValueError:
                parsed = False
            cases.append(("非 UTF-8 文件名时各检查器不崩、--json 不崩且输出可解析",
                          parsed and r.returncode in (0, 1, 2),
                          "退出码 %d；%s" % (r.returncode, (r.stderr or b"").decode("utf-8", "replace")[-160:])))
            # A18／C22：一次扫描只加载一遍检查器（覆盖边界复用封签内那份），扫描根上同一组模式的
            #           git ls-files 只跑一次；缓存只限扫描根，退出即关
            seen = {"discover": 0, "ls": []}
            real_disc, real_run = discover, subprocess.run

            def _disc():
                seen["discover"] += 1
                return real_disc()

            def _run(cmd, *a, **k):
                if "ls-files" in cmd and proj in cmd:
                    seen["ls"].append(tuple(cmd[cmd.index("-z") + 1:]))
                return real_run(cmd, *a, **k)
            globals()["discover"], subprocess.run = _disc, _run
            try:
                fs, c = run_all(proj, selftest_only=False, config_path=cfg_p)
                render(fs, proj, c, show_scope=True)
            finally:
                globals()["discover"], subprocess.run = real_disc, real_run
            got = (seen["discover"], len(seen["ls"]) - len(set(seen["ls"])), sl._LS_MEMO[0])
            cases.append(("一次扫描 discover 一次、扫描根 git ls-files 同模式不重跑、缓存随扫描关闭",
                          got == (1, 0, None), (got, seen["ls"])))
            # bug 7：BOM 不进首键
            cfg, prob = load(fresh("p10"), None, raw=u"\ufefftier: L1\n".encode("utf-8"))
            cases.append(("带 BOM 的配置首键读作 tier", cfg.get("tier") == "L1" and not prob, cfg or prob))
            # bug 8：YAML 子集不静默误读——能对的读对，读不对的拒收并给行号
            ys = sl.parse_yaml_subset
            good = [(u"a:\n  - \"a: b\"\n  - https://x\n", {"a": ["a: b", "https://x"]}),
                    (u"\"tier\": L1\n", {"tier": "L1"}),
                    (u"reason: don't do it # 注释\n", {"reason": "don't do it"}),
                    (u"x: \"a # b\" # c\n", {"x": "a # b"})]
            for text, want in good:
                try:
                    got = ys(text)
                except sl.ConfigError as exc:
                    got = "拒收：%s" % exc
                cases.append(("YAML 子集读对 %r" % text[:24], got == want, got))
            for text in (u"a:\n  - name: x\n    path: .\n    path: y\n", u"---\ntier: L1\n"):
                try:
                    got = ys(text)
                    ok = False
                except sl.ConfigError as exc:
                    got, ok = str(exc), u"第 " in str(exc)
                cases.append(("YAML 子集对歧义写法拒收并给行号 %r" % text[:24], ok, got))
            # B4：配置是指向项目之外（且不存在）的软链接 → 先判真实位置，不去探测目标在不在
            proj = fresh("p14")
            os.makedirs(os.path.join(proj, "governance"))
            os.symlink(os.path.join(out_dir, "nope.yaml"), os.path.join(proj, "governance", "project.yaml"))
            cfg, prob = sl.load_config(proj)
            cases.append(("配置软链到项目之外且目标不存在：报越界，不报「未找到」（没探测目标）",
                          bool(prob) and u"之外" in prob, prob))
            # B4：例外登记册是指向项目之外的软链接 → 不读、不回显，记一条问题
            proj = fresh("p15")
            os.makedirs(os.path.join(proj, "governance"))
            os.symlink(secret, os.path.join(proj, "governance", "exceptions.md"))
            rows, probs, _src, _own = sl.load_exceptions(os.path.join(proj, "governance"), proj)
            cases.append(("例外登记册软链到项目之外：不读、不回显内容",
                          not rows and probs and not any("TOPSECRET" in x for x in probs)
                          and any(u"之外" in x for x in probs), probs))
            # 裁定 6：拒收信息带行号并指明不支持的写法
            msgs = []
            for text, want in ((u"---\ntier: L1\n", u"文档分隔符"), (u"tier:L1\n", u"冒号后没有空格"),
                               (u"a:\n- x\n", u"列表项与它的键同列"),
                               (u"a:\n  - key:\n", u"后面没有值")):
                try:
                    ys(text)
                    msgs.append((text, None))
                except sl.ConfigError as exc:
                    msgs.append((text, str(exc)))
                    if not (u"第 " in str(exc) and want in str(exc)):
                        msgs[-1] = (text, "缺行号或写法：" + str(exc))
            cases.append(("YAML 子集拒收信息带行号并指明写法",
                          all(m and not m.startswith("缺") for _t, m in msgs), msgs))
            # 新增：duplicate_* 阈值写错是配置错误（带行号、整份拒收），不静默用默认
            for tag, body in (("p11", u"tier: L1\nbudgets:\n  duplicate_min_lines: 1\n"),
                              ("p12", u"tier: L1\nbudgets:\n  duplicate_min_chars: yes\n")):
                cfg, prob = load(fresh(tag), body)
                cases.append(("duplicate_* 阈值写错整份拒收并给行号（%s）" % tag,
                              not cfg and bool(prob) and u"第 3 行" in prob, prob))
            cfg, prob = load(fresh("p13"), u"tier: L1\nbudgets:\n  duplicate_min_lines: 4\n")
            cases.append(("duplicate_* 阈值合法照常读", not prob, prob))
            # 裁定 2：字面就在项目之外的路径不碰文件系统（realpath 本身就是探测）
            seen = []
            real = sl.os.path.realpath
            sl.os.path.realpath = lambda p, *a, **k: (seen.append(p), real(p, *a, **k))[1]
            try:
                r_out = sl.inside(base, os.path.join(base, "..", "elsewhere", "x.md"))
            finally:
                sl.os.path.realpath = real
            cases.append(("字面在项目之外的路径不做 realpath 探测", r_out is False and not seen, seen))
            # bug 4：字段名两侧的加粗与反引号
            cases.append(("**状态**：done 读得出状态",
                          sl.item_status(u"# x\n\n**状态**：done\n") == "done"
                          and sl.item_status(u"`status`: in_progress\n") == "in_progress",
                          sl.item_status(u"# x\n\n**状态**：done\n")))
            # bug 12：关闭态只认整格等于或以关闭词开头
            closed = [sl._ex_closed(x) for x in (u"关闭", u"已关闭（09-01）", u"**done**",
                                                 u"**已过期，已处理**（06-28 对账）", u"没关闭",
                                                 u"not yet closed", u"open (to be closed)", u"待关闭",
                                                 u"已处理中", u"done? 否", u"closed-loop 待复核")]
            cases.append(("例外登记的关闭态只认段首整词：没关闭/not yet closed/已处理中/done? 否/closed-loop 不算关闭",
                          closed == [True, True, True, True] + [False] * 7, closed))
            # A12：表头 id 只认整格；到期只收纯日期
            got = [sl._ex_field(h) for h in (u"到期 / valid until", u"Rule ID", u"Provider", u" ID ", u"编号")]
            got += [sl.parse_date(u"2026-12-31 以后再说", strict=True)[0], sl.parse_date(u"2026-12-31", strict=True)[0]]
            cases.append(("登记册表头 id 整格匹配、到期不认「日期 + 文字」",
                          got == ["expires", None, None, "ex_id", "ex_id", None, datetime.date(2026, 12, 31)], got))
            # A14：git < 2.31 静默忽略 GIT_CONFIG_COUNT，加固全失效——认出来记未定，不静默照跑
            vers = [sl.git_version_problem(v) is None for v in (
                "git version 2.25.1\n", "git version 2.31.0\n", "git version 2.39.3 (Apple Git-146)\n", "")]
            cases.append(("git 版本 2.25 与认不出的版本报问题，2.31 起放行",
                          vers == [False, True, True, False], vers))
            # 低：身份行在 git 不可用时不写成「git git 退出码」
            line = identity_line({"digest": "0" * 64, "files": [], "git_head": "git 退出码 128",
                                  "dirty": None, "dirty_detail": "git 退出码 128"})
            cases.append(("身份行 git 不可用时措辞不重复", "git git" not in line, line))
            # 低：裁剪写成不存在的检查器名要报出来
            unk = _tailoring_unknown({"tailoring": [{"check": "derived", "applicable": False},
                                                    {"check": "derived-artifacts", "applicable": False},
                                                    {"check": "layout:playbook", "applicable": False}]}, mods)
            cases.append(("裁剪写成不存在的名字（derived）记未定，写对的不报",
                          [f["id"] for f in unk] == ["tailoring/unknown-check/derived"], [f["id"] for f in unk]))
    except Exception as exc:  # noqa: BLE001
        return [undetermined_from_exception("stdlib", exc, "跑 stdlib 自检")]
    return [finding("stdlib", PASS if ok else FAIL, "stdlib：" + title,
                    why="契约 §1／§5：读不了、越界、歧义一律记未定，不猜不崩", evidence=str(ev or ""))
            for title, ok, ev in cases]


def _hostile_git_config_selftest(mods):
    """被扫仓 .git/config 里的外部程序不得被本工具执行（stdlib.GIT_HARDEN_CONFIG、filter_env）。

    夹具仓的配置写上 core.fsmonitor、blame 会走的 textconv、两个 clean 过滤器（其一名字带 `=`，
    `-c k=v` 会把它切错）、diff.external，以及 log.showSignature + gpg.program + 一个签名提交
    （freshness 退到提交时间时的 `git log` 会验签）；每个都 touch 一个标记文件。工作区文件带会被
    drift 拿去 blame 的日期、带一件没有转换时间戳的进行中工作项，保证这些 git 调用真的发生。
    另两件：内嵌目录是子模块时 `git status` 不递归进去跑子模块自己的过滤器；读不出过滤器名
    （配置坏了）时 filter_env 返回 None、blame 记未定而不是照常执行。
    """
    import subprocess
    import tempfile
    import stdlib as sl

    title = "被扫仓配置里的外部程序不得被执行"
    why = "扫描不可信目录时，其 .git/config 可让 git 执行任意命令（fsmonitor、textconv、过滤器、gpg）"
    git_id = ["-c", "init.defaultBranch=main", "-c", "user.email=std@example.invalid",
              "-c", "user.name=std", "-c", "commit.gpgsign=false", "-c", "protocol.file.allow=always"]

    def git(repo, *args, **kw):
        r = subprocess.run(["git", "-C", repo] + git_id + list(args), capture_output=True, timeout=60, **kw)
        if r.returncode != 0:
            raise RuntimeError("git %s 退出码 %d：%s" % (args[0], r.returncode, r.stderr[-200:]))
        return r.stdout.decode("utf-8", "replace").strip()

    def put(path, body):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(body)

    mods = {n: m for n, m, _e in mods if m is not None}
    notes = []
    try:
        with tempfile.TemporaryDirectory() as tmp:
            mark = os.path.join(tmp, "PWNED_")
            proj, cfg_path = os.path.join(tmp, "proj"), os.path.join(tmp, "project.yaml")
            wi = os.path.join(proj, "docs", "state", "work", "WI-001-x.md")
            for path, body in ((os.path.join(proj, "CLAUDE.md"), _SMOKE_ENTRY),
                               (os.path.join(proj, "docs", "a.md"), u"# a\n\n2099-01-01 已完成 某事\n"),
                               (os.path.join(proj, "docs", "b.md"), u"# b\n\n2099-01-02 已完成 某事\n"),
                               (wi, u"# WI-001\n\n状态：in_progress\n"),
                               (os.path.join(proj, ".gitattributes"),
                                u"*.md diff=evil filter=evil\ndocs/b.md filter=a=b\n"),
                               # 工具位于被扫仓内（内嵌运行）：tool_identity 的 git status 也不得跑过滤器
                               (os.path.join(proj, "tools", "std", "CONTRACT.md"), u"# 契约\n"),
                               (cfg_path, _SMOKE_CONFIG)):
                put(path, body)
            git(proj, "init", "-q")
            git(proj, "add", "-A")
            git(proj, "commit", "-q", "-m", "s")
            # 签名提交：不依赖 gpg，直接写一个带 gpgsig 头的提交对象，再把分支指过去
            put(wi, u"# WI-001\n\n状态：in_progress\n\n补一句。\n")
            git(proj, "add", "-A")
            raw = (u"tree %s\nparent %s\nauthor a <a@b> 1700000000 +0000\ncommitter a <a@b> 1700000000 +0000\n"
                   u"gpgsig -----BEGIN PGP SIGNATURE-----\n \n abc\n -----END PGP SIGNATURE-----\n\nsigned\n"
                   % (git(proj, "write-tree"), git(proj, "rev-parse", "HEAD")))
            sha = git(proj, "hash-object", "-t", "commit", "-w", "--stdin", input=raw.encode("utf-8"))
            with io.open(os.path.join(proj, ".git", "refs", "heads", "main"), "w") as fh:
                fh.write(sha + "\n")
            gpg = os.path.join(tmp, "gpg.sh")
            put(gpg, u"#!/bin/sh\ntouch %sgpg\nexit 1\n" % mark)
            os.chmod(gpg, 0o755)
            for k, v in (("core.fsmonitor", "touch %sfsmonitor; false" % mark),
                         ("diff.evil.textconv", "sh -c 'touch %stextconv; cat \"$1\"' -" % mark),
                         ("filter.evil.clean", "sh -c 'touch %sclean; cat'" % mark),
                         ("filter.a=b.clean", "sh -c 'touch %sclean_eq; cat'" % mark),
                         ("diff.external", "touch %sexternal" % mark),
                         ("log.showSignature", "true"), ("gpg.program", gpg)):
                git(proj, "config", k, v)
            for rel in ("docs/a.md", "docs/b.md", "tools/std/CONTRACT.md"):
                os.utime(os.path.join(proj, rel))   # stat 失效，逼 git 重读工作区
            if tool_identity(os.path.join(proj, "tools", "std"))["dirty"] is not False:
                notes.append("夹具没走到 tool_identity 的 git status")
            findings, _cfg = run_all(proj, selftest_only=False, config_path=cfg_path)
            ids = set(f.get("id") for f in findings)
            if not {"drift/future-date/docs/a.md｜2099-01-01", "drift/future-date/docs/b.md｜2099-01-02"} <= ids:
                notes.append("夹具没走到 git blame")
            if not any(f.get("where") == "docs/state/work/WI-001-x.md" and f["check"] == "freshness"
                       and f["status"] in (PASS, FAIL) for f in findings):
                notes.append("夹具没走到 freshness 的 git log")

            # 子模块：内嵌目录 .std 是子模块，子模块自己配了过滤器
            sub, par = os.path.join(tmp, "sub"), os.path.join(tmp, "par")
            put(os.path.join(sub, "x.md"), u"x\n")
            put(os.path.join(sub, ".gitattributes"), u"*.md filter=subf\n")
            put(os.path.join(par, "a.md"), u"a\n")
            for repo in (sub, par):
                git(repo, "init", "-q")
                git(repo, "add", "-A")
                git(repo, "commit", "-q", "-m", "s")
            git(par, "submodule", "add", "-q", sub, ".std")
            git(par, "commit", "-q", "-m", "sub")
            git(os.path.join(par, ".std"), "config", "filter.subf.clean", "sh -c 'touch %ssubmodule; cat'" % mark)
            os.utime(os.path.join(par, ".std", "x.md"))
            mods["adoption"]._embedded_readonly(par, ".std")

            # 配置坏了：列不出过滤器名 → None，blame 记未定，不照常执行
            bad = os.path.join(tmp, "bad")
            git(bad if os.path.isdir(bad) else tmp, "init", "-q", bad)
            with io.open(os.path.join(bad, ".git", "config"), "a") as fh:
                fh.write(u"[broken\n")
            env_bad = sl.filter_env(bad)
            blamed = mods["drift"]._blame(bad, "a.md")
            if env_bad is not None or blamed[0] is not None:
                notes.append("配置坏了时 filter_env=%r、blame=%r，应为 None 与未定" % (type(env_bad).__name__, blamed[1]))
            hits = sorted(f[len("PWNED_"):] for f in os.listdir(tmp) if f.startswith("PWNED_"))
    except Exception as exc:  # noqa: BLE001
        return [finding("shared-fact", FAIL, title, why=why,
                        evidence="跑不起来：%s: %s" % (type(exc).__name__, exc))]
    if hits or notes:
        return [finding("shared-fact", FAIL, title, why=why,
                        evidence="被执行：%s；%s" % ("、".join(hits) or "无", "；".join(notes) or "断言全过"))]
    return [finding("shared-fact", PASS, title, why=why,
                    evidence="fsmonitor、textconv、两个 clean 过滤器（含名字带 = 的）、diff.external、gpg、"
                             "子模块过滤器均未执行；配置坏了时 blame 记未定")]


def run_all(root, selftest_only=False, config_path=None):
    """跑全部检查。返回 (findings, cfg)——配置只在这里加载一次，
    渲染覆盖边界时由调用方把 cfg 传回去，不再各自重新加载（重新加载会
    在配置读不到时打出一整屏"未配置"的假边界）。"""
    scrub_git_env()  # 幂等；供不经 main 直接调 run_all 的调用方（见 stdlib.GIT_HARDEN_CONFIG）
    findings = []
    # 契约 §8：扫描前后各取一次身份，期间检查器自己被改过就作废重跑。
    ident_before = tool_identity()
    findings.append(_identity_finding(
        ident_before, None if selftest_only else embedded_std_rel(root)))
    mods = discover()
    if not mods:
        findings.append(finding(
            "check_all", UNDETERMINED, "没有发现任何检查器",
            reason="%s 下没有 check_*.py" % CHECKS_DIR,
        ))
        return findings, None

    if selftest_only:
        findings.extend(_contract_examples_selftest())
        findings.extend(_entry_smoke_selftest())
        findings.extend(_shared_fact_selftest(mods))
        findings.extend(_embedded_readonly_selftest(mods))
        findings.extend(_git_env_selftest())
        findings.extend(_hostile_git_config_selftest(mods))
        findings.extend(_stdlib_selftest(mods))
        for name, mod, err in mods:
            if err is not None:
                findings.append(undetermined_from_exception(name, err, "加载检查器"))
                continue
            ok, gate, results = _gated_by_selftest(name, mod)
            # 打印闸门**这一次**拿到的那份结果，不再重跑一遍。
            findings.extend(gate if not ok else results)
        return _sealed(findings, ident_before), None

    old_git = git_version_problem()
    if old_git:
        findings.append(finding(
            "check_all", UNDETERMINED, "git 版本过旧，加固不生效，全部检查未定", kind="git-too-old",
            reason=old_git, why="契约 §1：依赖不可用记未定；契约 §5：被扫仓配置里的外部程序一律压掉"))
        return _sealed(findings, ident_before), None

    cfg, problem = load_config(root, config_path)
    if problem:
        findings.append(finding(
            "check_all", UNDETERMINED, "读不到项目配置，全部检查未定",
            reason=problem,
            why="契约 §5：缺配置不取默认值当事实",
        ))
        return _sealed(findings, ident_before), None

    findings.extend(_tailoring_unknown(cfg, mods))
    with scan_memo(root):          # 本次扫描根的 git ls-files 只跑一次（各检查器的自检夹具不在此根，不缓存）
        for name, mod, err in mods:
            if err is not None:
                findings.append(undetermined_from_exception(name, err, "加载检查器"))
                continue
            findings.extend(_run_one(name, mod, cfg))
        # 覆盖边界在封签之内、用同一份加载与同一份 ls-files 缓存算好，render 不再 discover 第二次（契约 §4）
        cfg["_scopes"] = scopes(cfg, mods)
    _join_exceptions(findings, cfg)
    return _sealed(findings, ident_before), cfg


# --------------------------------------------------------------------------
# 例外登记（契约 §9）
# --------------------------------------------------------------------------

EXCEPTION_CHECK = "exception-register"

_MAX_REGISTER_LISTED = 12


def _config_dir(cfg):
    """配置文件所在目录——登记册就在它旁边。`_path` 可能是相对仓库根的。"""
    path = cfg.get("_path")
    if not path:
        return None
    if not os.path.isabs(path):
        path = os.path.join(cfg.get("_root") or ".", path)
    return os.path.dirname(os.path.abspath(path))


def _join_exceptions(findings, cfg):
    """把登记册里的行贴到未定发现上。**只在这里改 `registered`，不改 `status`。**

    只做 join，不重写结论：状态、三态计数与逐条列出都不因登记而改变（01 §5.6）；
    登记改变的只有退出码。FAIL 不可登记——本工具的 FAIL 按契约 §1.1 只在项目
    声明的事实下产出，整块不适用走 `tailoring`，不走这里。
    """
    info = {"path": None, "display": None, "valid": 0, "expired": 0}
    if not isinstance(cfg, dict):
        return info
    cfg["_exceptions"] = info
    today = datetime.date.today()
    try:
        cdir = _config_dir(cfg)
        if cdir is None:
            return info
        rows, problems, src, own = load_exceptions(cdir, cfg.get("_root"), today)
    except Exception as exc:  # noqa: BLE001 —— 读登记册出错也是未定，不静默当成没有登记
        findings.append(undetermined_from_exception(EXCEPTION_CHECK, exc, "读例外登记"))
        return info
    if src is None:
        return info

    cfg_path = str(cfg.get("_path") or "")
    info["path"] = src
    info["display"] = (os.path.join(os.path.dirname(cfg_path), "exceptions.md").replace("\\", "/")
                       if not os.path.isabs(cfg_path) else src)
    info["valid"] = len(rows)

    base = "比较基准日 %s（取自运行时系统日期）" % today.isoformat()
    by_id = {}
    for f in findings:
        if f["status"] == UNDETERMINED:
            by_id.setdefault(f["id"], []).append(f)

    expired, orphan = [], []
    for row in rows:
        hit = by_id.get(row["rule"])
        if not hit:                        # 含匹配到 PASS/SKIP/FAIL：死行不留，免得日后条件变了静默复活
            orphan.append(row)
            continue
        if row["expires_date"] < today:
            expired.append(row)
            continue
        for f in hit:
            f["registered"] = {"id": row["ex_id"], "expires": row["expires"]}

    # 「有效」按契约 §9 指五项齐全、表行合格，与「未过期」不同义：过期的行仍是有效行，
    # 只是不再改变退出码。两个数一起给，首部的「N 行有效」才和计数行的「已登记」对得上。
    info["expired"] = len(expired)

    def _rows_note(items):
        head = "；".join("第 %d 行 %s 到期 %s" % (r["lineno"], r["ex_id"] or "（无编号）", r["expires"])
                         for r in items[:_MAX_REGISTER_LISTED])
        return head + ("；……共 %d 行" % len(items) if len(items) > _MAX_REGISTER_LISTED else "")

    if problems:
        findings.append(finding(
            EXCEPTION_CHECK, UNDETERMINED,
            "例外登记里有 %d 行不合格，未生效" % len(problems),
            where=info["display"], kind="invalid-rows",
            reason="；".join(problems[:_MAX_REGISTER_LISTED])
                   + ("；……共 %d 行" % len(problems) if len(problems) > _MAX_REGISTER_LISTED else ""),
            why="契约 §9：登记行要能被复核，规则、理由、范围、批准人、到期五项缺一即不算登记",
            evidence=base,
        ))
    if expired:
        findings.append(finding(
            EXCEPTION_CHECK, UNDETERMINED,
            "例外登记里有 %d 行已过期，它登记的发现回到未登记" % len(expired),
            where=info["display"], kind="expired",
            reason=_rows_note(expired),
            why="契约 §9：到期由工具按运行日校验；过期的登记不再改变退出码——"
                "没有到期的登记就是一键静音，那正是登记要带到期的理由",
            evidence=base,
        ))
    if orphan:
        findings.append(finding(
            EXCEPTION_CHECK, UNDETERMINED,
            "例外登记里有 %d 行的规则匹配不到本次任何未定发现" % len(orphan),
            where=info["display"], kind="orphan",
            reason="；".join("第 %d 行 %s：%s" % (r["lineno"], r["ex_id"] or "（无编号）", r["rule"])
                             for r in orphan[:_MAX_REGISTER_LISTED])
                   + ("；……共 %d 行" % len(orphan) if len(orphan) > _MAX_REGISTER_LISTED else ""),
            why="契约 §9：规则列写的是 Finding id；对不上的行要么判据已变、要么抄错，"
                "两种都不该留在册子里当作还在生效",
            evidence=base,
        ))
    findings.extend(_own_exceptions(own, info["display"], today, base))
    return info


def _own_exceptions(own, where, today, base):
    """项目自有例外行（规则列不含 `/`，如依赖规则、依赖审计的门号例外）：只按到期判。

    不登记、不校验五项（那是项目的门，不是本工具的发现）；但 02 §4「例外登记在
    `governance/exceptions.md`，带到期；到期未清理 CI 转红」对它们同样成立：未关闭且已过期判
    FAIL（FAIL 不可登记，不能用登记去静音一条过期的登记）；到期写不成日期记未定。
    """
    why = ("02 §4：依赖规则的例外登记在 governance/exceptions.md，带到期；到期未清理 CI 转红"
           "（01 §8：例外记录含到期，不能只是一份让检查永久跳过的名单）")
    out, undated, far = [], [], []
    limit = today + datetime.timedelta(days=EXCEPTION_MAX_DAYS)
    for r in own:
        label = "第 %d 行 %s" % (r["lineno"], r["ex_id"] or r["rule"] or "（无编号）")
        if r["expires_date"] is None:
            undated.append("%s：%s" % (label, r["error"]))
        elif r["expires_date"] > limit:
            far.append("%s 到期 %s" % (label, r["expires_date"].isoformat()))
        elif r["expires_date"] < today:
            out.append(finding(
                EXCEPTION_CHECK, FAIL, "项目例外 %s 已于 %s 到期，未关闭" % (label, r["expires_date"].isoformat()),
                where=where, kind="own-expired", key=r["ex_id"] or r["rule"] or str(r["lineno"]), why=why,
                reason="清理这条例外（修掉偏离后在状态列写处理方式，如「已处理」「关闭」），"
                       "或经批准人重新评估后改到期",
                evidence="%s；规则列：%s" % (base, r["rule"] or "（空）")))
    if far:
        out.append(finding(
            EXCEPTION_CHECK, UNDETERMINED, "有 %d 行项目例外的到期晚于上限 %s（运行日起 %d 天）"
            % (len(far), limit.isoformat(), EXCEPTION_MAX_DAYS),
            where=where, kind="own-too-far", why=why + "；契约 §9：到期不得晚于运行日 + 365 天",
            reason="；".join(far[:_MAX_REGISTER_LISTED])
                   + ("；……共 %d 行" % len(far) if len(far) > _MAX_REGISTER_LISTED else ""),
            evidence=base))
    if undated:
        out.append(finding(
            EXCEPTION_CHECK, UNDETERMINED, "有 %d 行项目例外的到期写不成日期，到没到期判不了" % len(undated),
            where=where, kind="own-undated", why=why,
            reason="；".join(undated[:_MAX_REGISTER_LISTED])
                   + ("；……共 %d 行" % len(undated) if len(undated) > _MAX_REGISTER_LISTED else ""),
            evidence=base))
    return out


def _sealed(findings, ident_before):
    """收尾：再取一次身份，与开扫时比对。不一致就**整份作废**。

    作废是真的作废——把已有的 findings 全丢掉，只留一条未定。留着它们再加一句
    "本结论存疑"，读报告的人还是会去看那些条目。
    """
    ident_after = tool_identity()
    if ident_after["digest"] == ident_before["digest"]:
        return findings
    return [_identity_void_finding(ident_before, ident_after)]


def scopes(cfg, mods):
    """按已加载的 cfg 与检查器算各检查器的覆盖边界。两样都由调用方给，本函数不再自己读配置、加载检查器。"""
    out = {}
    for name, mod, err in mods:
        if err is not None or not hasattr(mod, "scope"):
            continue
        try:
            out[name] = mod.scope(cfg)
        except (Exception, SystemExit) as exc:
            out[name] = {"covered": [], "not_covered": ["scope() 出错：%s" % exc]}
    return out


def config_outside_root(root, path):
    """`--config` 给的配置落在被扫描项目之外还是之内。返回 (True/False/None, 原因)。

    从前的判据是"`_path` 是不是绝对路径"——那是**假的溯源陈述**：
    `--config <项目内部的绝对路径>` 会被报告成"外部配置，不在被扫描项目内"。
    结论（配置从哪读的）对，陈述（它在不在项目内）错，与派生工件那条同类。

    同一类假陈述还有第二种形态：走默认候选路径时 `_path` 是**相对被扫根**的
    （`governance/project.yaml`），照直 `abspath` 就成了按**当前工作目录**解析——
    在仓根跑 `check_all <项目>` 把项目自己的配置说成外部，`cd` 进该项目再跑又对了。
    所以非绝对路径先接到 `root` 上再归一化，与 `_config_dir` 同一做法。

    前缀比较必须**带分隔符**，否则 `/t/proj` 会把 `/t/project/x.yaml` 判成内部。
    `render` 是在全部检查跑完之后才调它的，归一化出错也不许崩，按判不了返回 None。
    """
    try:
        raw_root = str(root or ".")
        raw_path = str(path)
        if not os.path.isabs(raw_path):          # 相对的 `_path` 是相对被扫根的，不是相对 CWD
            raw_path = os.path.join(raw_root, raw_path)
        r = os.path.abspath(raw_root)
        p = os.path.abspath(raw_path)
    except (OSError, ValueError) as exc:  # 归一化本身出问题也不许崩，按判不了处理
        return None, "路径归一化失败：%s: %s" % (type(exc).__name__, exc)
    r = r.rstrip(os.sep)
    if p == r:
        return False, ""
    return not p.startswith(r + os.sep), ""


# 文件名、摘录都来自被扫仓：换行能在第 0 列伪造「结论：」行，ESC 等能操纵终端。制表符放行。
# U+2028/2029 会被 splitlines 当换行；双向控制符（U+200E/F、202A–202E、2066–2069）能把后文翻到行首显示
_CTRL_RE = re.compile(u"[\x00-\x08\x0a-\x1f\x7f-\x9f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]")


def _safe(value, block=False):
    """转义控制字符。block（原因／依据／证据）保留换行，但续行一律缩进 8 格，没有一行从第 0 列开始。"""
    def esc(s):
        return _CTRL_RE.sub(lambda m: "\\x%02x" % ord(m.group()), s)
    s = str(value)
    return ("\n" + " " * 8).join(esc(ln) for ln in s.split("\n")) if block else esc(s)


def render(findings, root, cfg=None, show_scope=True):
    """渲染。cfg 是 run_all 已经加载好的配置，本函数不再自己读配置。

    cfg 为 None 表示配置根本没读进来，此时不打覆盖边界——那种情况下各检查器
    会一律回报"未配置"，那是假边界，不是真的没检查什么。
    """
    buf = []
    counts = {s: 0 for s in (PASS, FAIL, UNDETERMINED, SKIP)}
    for f in findings:
        counts[f["status"]] = counts.get(f["status"], 0) + 1

    buf.append("标准检查 · %s" % _safe(os.path.abspath(root)))
    for f in findings:
        if f.get("check") == IDENTITY_CHECK and f.get("status") == SKIP:
            buf.append(_safe(f["title"]))
            break
    if cfg and cfg.get("_path"):
        outside, why_outside = config_outside_root(cfg.get("_root"), cfg.get("_path"))
        shown = _safe(cfg["_path"])
        if outside is True:
            buf.append("配置 · %s（外部配置，不在被扫描项目内）" % shown)
        elif outside is False:
            buf.append("配置 · %s（在被扫描项目内）" % shown)
        else:
            buf.append("配置 · %s（在不在项目内判不了：%s）" % (shown, _safe(why_outside)))
        excluded = embedded_std_rel(cfg.get("_root") or root)
        if excluded:
            buf.append("排除 · %s/（工具自身所在的内嵌目录，不扫描）" % _safe(excluded))
        ex = cfg.get("_exceptions") or {}
        if not ex.get("display"):
            buf.append("登记 · 无")
        elif ex.get("expired"):
            # 「有效」是契约 §9 的"五项齐全、表行合格"，不是"未过期"；过期数不标出来，
            # 这行的 N 就会和下一行的「已登记」对不上，读的人只能猜是哪一个错了。
            buf.append("登记 · %s（%d 行有效，其中 %d 行已过期）"
                       % (_safe(ex["display"]), ex.get("valid") or 0, ex["expired"]))
        else:
            buf.append("登记 · %s（%d 行有效）" % (_safe(ex["display"]), ex.get("valid") or 0))
    registered = [f for f in findings if f["status"] == UNDETERMINED and f.get("registered")]
    n_reg = len(registered)
    n_unreg = counts[UNDETERMINED] - n_reg
    buf.append("  通过 %d   失败 %d   未定 %d（已登记 %d · 未登记 %d）   不适用 %d"
               % (counts[PASS], counts[FAIL], counts[UNDETERMINED], n_reg, n_unreg, counts[SKIP]))
    buf.append("")

    for status, label in ((FAIL, "失败"), (UNDETERMINED, "未定"), (SKIP, "不适用")):
        items = [f for f in findings if f["status"] == status]
        if not items:
            continue
        if status == UNDETERMINED:
            # 先未登记后已登记：要处置的排在前面，登记过的还在册上但不再挡路。
            items = ([f for f in items if not f.get("registered")]
                     + [f for f in items if f.get("registered")])
        buf.append("%s（%d）" % (label, len(items)))
        for f in items:
            loc = ("  [%s]" % f["where"]) if f.get("where") else ""
            reg = f.get("registered") or {}
            tag = ("（已登记 %s，到期 %s）" % (reg.get("id") or "（无编号）", reg.get("expires"))
                   if reg else "")
            buf.append("  · %s" % _safe(f["title"] + tag + loc))
            buf.append("      id：%s" % _safe(f.get("id")))
            for key, prefix in (("reason", "原因"), ("why", "依据"), ("evidence", "证据")):
                if f.get(key):
                    buf.append("      %s：%s" % (prefix, _safe(f[key], block=True)))
        buf.append("")

    if show_scope:
        buf.append("覆盖边界（没检查的不等于没问题）")
        if cfg is None:
            buf.append("  未定：配置没读进来，本次覆盖边界无法给出。")
        else:
            for name, sc in sorted((cfg.get("_scopes") or scopes(cfg, discover())).items()):
                buf.append("  %s" % name)
                for line in sc.get("not_covered", []):
                    buf.append("    不看：%s" % _safe(line))
        buf.append("")

    if counts[FAIL]:
        buf.append("结论：FAIL。")
    elif n_unreg:
        buf.append("结论：未定 —— 有 %d 项没能判定且未登记%s。**未定不是通过**（01 §2 N1）。"
                   % (n_unreg, ("，另有 %d 项已登记" % n_reg) if n_reg else ""))
    elif n_reg:
        soonest = min(f["registered"]["expires"] for f in registered)
        buf.append("结论：无未登记的未定；仍有 %d 项已登记未定（最近到期 %s）。"
                   "未定不是通过（01 §2 N1），退出码 0 只表示全部未定都已登记。" % (n_reg, soonest))
    else:
        buf.append("结论：本次实际执行的检查全部通过。通过只覆盖上面列出的范围。")
    return "\n".join(buf)


def _emit(text):
    """写到 stdout。非 UTF-8 文件名会带进代理字符，终端或管道编码不收时按 UTF-8 替换写出，不崩。"""
    try:
        sys.stdout.write(text + "\n")
    except UnicodeEncodeError:
        sys.stdout.flush()
        sys.stdout.buffer.write((text + "\n").encode("utf-8", "replace"))


def main(argv=None):
    scrub_git_env()  # 先于任何 git 子进程，见 stdlib.GIT_LOCAL_ENV
    ap = argparse.ArgumentParser(description="按《项目管理标准》做机械检查")
    ap.add_argument("root", nargs="?", default=".", help="项目根目录")
    ap.add_argument("--selftest", action="store_true", help="只跑检查器自检")
    ap.add_argument("--json", action="store_true", help="输出 JSON")
    ap.add_argument("--no-scope", action="store_true", help="不打印覆盖边界")
    ap.add_argument(
        "--config", metavar="PATH", default=None,
        help="改从这个路径读配置，而不是 <项目根>/governance/project.yaml。"
             "用于扫描只读项目：把配置放在被测项目之外，扫描过程不往被测项目写任何东西。",
    )
    args = ap.parse_args(argv)

    try:
        findings, cfg = run_all(args.root, selftest_only=args.selftest,
                                config_path=args.config)
        text = (json.dumps(findings, ensure_ascii=False, indent=2) if args.json
                else render(findings, args.root, cfg,
                            show_scope=not args.no_scope and not args.selftest))
    except (Exception, SystemExit) as exc:  # noqa: BLE001 —— 契约 §1：崩溃记未定，退出 2，且给报告
        _emit("check_all 自身崩溃，本次没有结论（记未定，退出码 2）：%s: %s" % (type(exc).__name__, exc))
        return 2
    _emit(text)

    if any(f["status"] == FAIL for f in findings):
        return 1
    # 只看**未登记**的未定：已登记的仍是未定、仍逐条列出、仍计数，只是不再挡门（契约 §9）。
    if any(f["status"] == UNDETERMINED and not f.get("registered") for f in findings):
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
