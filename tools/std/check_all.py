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

import argparse
import datetime
import importlib.util
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from stdlib import (  # noqa: E402
    FAIL, PASS, SKIP, STATUS_CANDIDATES, UNDETERMINED,
    embedded_std_rel, finding, load_config, load_exceptions, tracked_files,
    undetermined_from_exception, work_root,
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


def _git_line(args):
    import subprocess
    try:
        out = subprocess.run(["git", "-C", HERE] + list(args),
                             capture_output=True, text=True, encoding="utf-8", timeout=60)
    except (OSError, subprocess.SubprocessError) as exc:
        return None, "跑不了 git：%s" % exc
    if out.returncode != 0:
        return None, "git 退出码 %d" % out.returncode
    return (out.stdout or ""), None


def tool_identity():
    """本次跑的这套检查器是哪一套。

    身份是**内容哈希**，不是提交号：提交号覆盖不了工作区未提交的改动，而决定行为的
    是文件内容。`CONTRACT.md` 也算进去——`_contract_examples_selftest` 会读它，
    它进闸门，就必须进身份。提交号与 `--porcelain` 只作旁证与 dirty 标记。
    """
    import hashlib

    files = [("check_all.py", os.path.join(HERE, "check_all.py")),
             ("stdlib.py", os.path.join(HERE, "stdlib.py")),
             ("CONTRACT.md", os.path.join(HERE, "CONTRACT.md"))]
    if os.path.isdir(CHECKS_DIR):
        for fn in sorted(os.listdir(CHECKS_DIR)):
            if fn.startswith("check_") and fn.endswith(".py"):
                files.append(("checks/" + fn, os.path.join(CHECKS_DIR, fn)))

    digests = [(rel, _sha256_file(path)) for rel, path in files]
    joined = "\n".join("%s %s" % (rel, h) for rel, h in digests)
    combined = hashlib.sha256(joined.encode("utf-8")).hexdigest()

    head, head_err = _git_line(["rev-parse", "HEAD"])
    porcelain, por_err = _git_line(["status", "--porcelain", "--", HERE])
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
    return ("检查器身份 · sha256:%s（%d 个文件，含 CONTRACT.md）· git %s · %s"
            % (ident["digest"][:16], len(ident["files"]),
               (ident.get("git_head") or "未知")[:12], flag))


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
        path = os.path.join(CHECKS_DIR, fn)
        spec = importlib.util.spec_from_file_location(fn[:-3], path)
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
        except Exception as exc:  # 加载失败也是未定，不是没有这项检查
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
            name, UNDETERMINED, "检查器没有自检",
            reason="契约 §3 要求每个检查器自带反例；没有反例就无法证明它抓得住违规",
            why="01 §5.6 守卫存在不等于守卫在执行",
        )], []
    try:
        results = mod.selftest()
    except Exception as exc:
        return False, [undetermined_from_exception(name, exc, "跑自检")], []
    bad = [r for r in results if r.get("status") != PASS]
    if bad:
        return False, [finding(
            name, UNDETERMINED, "检查器自检未通过，其对本仓库的结论作废",
            reason="; ".join("%s（%s）" % (r.get("title"), r.get("evidence")) for r in bad),
            why="契约 §3 / 01 §5.6：检查器故障按未定处置，不按通过记",
        )], results
    return True, [], results


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
        except Exception as exc:
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
            subprocess.run(["git", "-C", proj, "add", "-A"], capture_output=True, timeout=60)

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

            # 3g) 契约 §9 例外登记。四条断言**打在结果上，不打在退出码上**——退出码只有
            #     三个取值，靠它分不清"登记生效了"与"这次恰好没别的未定"。
            und = [f for f in findings if f["status"] == UNDETERMINED]
            if not und:
                raise AssertionError("冒烟仓没有未定项，登记这一支无从自检")
            target = und[0]["id"]
            ex_path = os.path.join(os.path.dirname(cfg_path), "exceptions.md")
            today = datetime.date.today()
            ok_day = (today + datetime.timedelta(days=30)).isoformat()
            yesterday = (today - datetime.timedelta(days=1)).isoformat()

            def _register(rule, expires, extra=u""):
                with io.open(ex_path, "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(u"# 例外登记\n\n"
                             u"| id | 规则 | 理由 | 范围 | 批准人 | 到期 | 状态 |\n"
                             u"|---|---|---|---|---|---|---|\n"
                             u"| EX-001 | %s | 入口冒烟自检用 | 该项 | 自检 | %s | active |\n%s"
                             % (rule, expires, extra))
                fs, c = run_all(proj, selftest_only=False, config_path=cfg_path)
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
            subprocess.run(["git", "-C", emb, "add", "-A"], capture_output=True, timeout=60)
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
                 "例外登记四条（有效登记生效／过期不生效且报 expired／"
                 "坏行报 invalid-rows／孤儿行报 orphan 且不报 expired；有过期行时首部标出其中几行已过期）、"
                 "main 两种 argv 退出码合法且有输出",
    ))
    return out


def _shared_fact_selftest(mods):
    """跨检查器的三条反例：同一事实只报一次（契约 §1），同一工件只有一份候选、同一个配置键
    只有一份缺省（01 §1 G2）。

    单个检查器的 selftest 看不见别的检查器，这几条只能在汇总层断言。来由：工作项目录
    不在时 layout / evidence / freshness 各报一条未定，采用方得为同一件事登记三行；
    状态工件的候选 layout 与 drift 各写一份且不一致，同一个项目被一个说"有"、一个说"没有"；
    未配 layout.docs_root 时 layout 兜底取 docs，freshness 与 drift 却记未定。
    """
    import subprocess
    import tempfile

    by = dict((n, m) for n, m, err in mods if err is None)
    need = ("layout", "evidence", "freshness", "drift")
    if any(n not in by for n in need):
        return [finding("shared-fact", UNDETERMINED, "跨检查器自检缺检查器",
                        reason="需要 %s，实有 %s" % ("/".join(need), "/".join(sorted(by))))]

    def _repo(tmp, files):
        for rel, body in files.items():
            path = os.path.join(tmp, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(body)
        subprocess.run(["git", "init", "-q", tmp], capture_output=True, timeout=60)
        subprocess.run(["git", "-C", tmp, "add", "-A"], capture_output=True, timeout=60)

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
        #    不再有的兜底、有的记「未配置文档根目录」；freshness 照判 docs/ 下的文档并注明用了默认。
        with tempfile.TemporaryDirectory() as tmp:
            _repo(tmp, {"CLAUDE.md": u"# 入口\n", "docs/architecture/a.md": u"# 架构\n"})
            cfg = {"_root": tmp, "tier": "L1", "layout": {"entry": ["CLAUDE.md"]}}
            fs = [f for n in need for f in by[n].run(cfg)]
            unset = [f["id"] for f in fs if u"未配置文档根目录" in f["title"]]
            judged = [f["id"] for f in fs if f["check"] == "freshness" and f["status"] == FAIL
                      and f["where"].startswith("docs/architecture/a.md")
                      and u"未配 layout.docs_root" in (f["evidence"] or "")]
        out.append(finding(
            "shared-fact", PASS if not unset and len(judged) == 1 else FAIL,
            "未配 layout.docs_root：各检查器取同一个缺省 docs 并注明，不再一家兜底一家记未定",
            why="契约 §5：缺省只有一处（stdlib.docs_root_of），取了默认就在证据里写明",
            evidence="记未配置的 %r；freshness 按缺省判出的 %r" % (unset, judged)))
    except Exception as exc:  # noqa: BLE001
        out.append(undetermined_from_exception("shared-fact", exc, "跑跨检查器自检"))
    return out


def _hook_guard_selftest():
    """带跑 Claude Code 拦截层的反例自检（契约 §3）。

    guard.py 不进检查器身份（契约 §8 末尾写了排除理由），但它在不在位、跑不跑得过
    会改变本自检的闸门结果，所以由这一条 finding 显式承载：不在位记**未定**，不是
    静默跳过——静默跳过正是 M-10 要探测的那种失效。
    """
    import subprocess

    guard = os.path.join(HERE, "hooks", "guard.py")
    if not os.path.isfile(guard):
        return [finding(
            "hook-guard", UNDETERMINED, "拦截层脚本不在位",
            where="tools/std/hooks/guard.py",
            reason="没有 hooks/guard.py，本工具判不了拦截层是否还成立；"
                   "不装拦截层的项目按这条记未定，不记通过",
            why="契约 §3：守卫存在不等于守卫在执行",
        )]
    try:
        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "utf-8"
        proc = subprocess.run([sys.executable, guard, "--selftest"], env=env,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=300)
        out = proc.stdout.decode("utf-8", "replace")
    except (OSError, subprocess.SubprocessError) as exc:
        return [undetermined_from_exception("hook-guard", exc, "跑 guard --selftest")]
    if proc.returncode == 0:
        return [finding(
            "hook-guard", PASS, "拦截层自检通过：%s" % (out.strip().splitlines() or [""])[-1],
            where="tools/std/hooks/guard.py",
            why="契约 §3：拦截层也是守卫，它的反例表（内嵌目录写入／Bash 写形态／"
                "git commit 识别／check_all 各种退出码）必须逐条跑过",
            evidence=out.strip()[:400],
        )]
    return [finding(
        "hook-guard", FAIL, "拦截层自检没通过（退出码 %d）" % proc.returncode,
        where="tools/std/hooks/guard.py",
        why="契约 §3：自检不过的守卫，其拦截结论作废",
        evidence="\n".join(out.splitlines()[:20]),
    )]


def run_all(root, selftest_only=False, config_path=None):
    """跑全部检查。返回 (findings, cfg)——配置只在这里加载一次，
    渲染覆盖边界时由调用方把 cfg 传回去，不再各自重新加载（重新加载会
    在配置读不到时打出一整屏"未配置"的假边界）。"""
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
        findings.extend(_hook_guard_selftest())
        findings.extend(_shared_fact_selftest(mods))
        for name, mod, err in mods:
            if err is not None:
                findings.append(undetermined_from_exception(name, err, "加载检查器"))
                continue
            ok, gate, results = _gated_by_selftest(name, mod)
            # 打印闸门**这一次**拿到的那份结果，不再重跑一遍。
            findings.extend(gate if not ok else results)
        return _sealed(findings, ident_before), None

    cfg, problem = load_config(root, config_path)
    if problem:
        findings.append(finding(
            "check_all", UNDETERMINED, "读不到项目配置，全部检查未定",
            reason=problem,
            why="契约 §5：缺配置不取默认值当事实",
        ))
        return _sealed(findings, ident_before), None

    for name, mod, err in mods:
        if err is not None:
            findings.append(undetermined_from_exception(name, err, "加载检查器"))
            continue
        ok, gate, _results = _gated_by_selftest(name, mod)
        if not ok:
            findings.extend(gate)
            continue
        try:
            res = mod.run(cfg)
        except Exception as exc:
            findings.append(undetermined_from_exception(name, exc, "跑 %s" % name))
            continue
        findings.extend(res or [])
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
    try:
        cdir = _config_dir(cfg)
        if cdir is None:
            return info
        rows, problems, src = load_exceptions(cdir)
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

    today = datetime.date.today()
    base = "比较基准日 %s（取自运行时系统日期）" % today.isoformat()
    all_ids = set(f.get("id") for f in findings)
    by_id = {}
    for f in findings:
        if f["status"] == UNDETERMINED:
            by_id.setdefault(f["id"], []).append(f)

    expired, orphan = [], []
    for row in rows:
        hit = by_id.get(row["rule"])
        if not hit:
            if row["rule"] not in all_ids:
                orphan.append(row)
            continue                       # 匹配到 FAIL/PASS/SKIP：不可登记，也不是孤儿
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
            "例外登记里有 %d 行的规则匹配不到本次任何发现" % len(orphan),
            where=info["display"], kind="orphan",
            reason="；".join("第 %d 行 %s：%s" % (r["lineno"], r["ex_id"] or "（无编号）", r["rule"])
                             for r in orphan[:_MAX_REGISTER_LISTED])
                   + ("；……共 %d 行" % len(orphan) if len(orphan) > _MAX_REGISTER_LISTED else ""),
            why="契约 §9：规则列写的是 Finding id；对不上的行要么判据已变、要么抄错，"
                "两种都不该留在册子里当作还在生效",
            evidence=base,
        ))
    return info


def _sealed(findings, ident_before):
    """收尾：再取一次身份，与开扫时比对。不一致就**整份作废**。

    作废是真的作废——把已有的 findings 全丢掉，只留一条未定。留着它们再加一句
    "本结论存疑"，读报告的人还是会去看那些条目。
    """
    ident_after = tool_identity()
    if ident_after["digest"] == ident_before["digest"]:
        return findings
    return [_identity_void_finding(ident_before, ident_after)]


def scopes(cfg):
    """按已加载的 cfg 算各检查器的覆盖边界。cfg 由调用方给，本函数不再自己读配置。"""
    out = {}
    for name, mod, err in discover():
        if err is not None or not hasattr(mod, "scope"):
            continue
        try:
            out[name] = mod.scope(cfg)
        except Exception as exc:
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


def render(findings, root, cfg=None, show_scope=True):
    """渲染。cfg 是 run_all 已经加载好的配置，本函数不再自己读配置。

    cfg 为 None 表示配置根本没读进来，此时不打覆盖边界——那种情况下各检查器
    会一律回报"未配置"，那是假边界，不是真的没检查什么。
    """
    buf = []
    counts = {s: 0 for s in (PASS, FAIL, UNDETERMINED, SKIP)}
    for f in findings:
        counts[f["status"]] = counts.get(f["status"], 0) + 1

    buf.append("标准检查 · %s" % os.path.abspath(root))
    for f in findings:
        if f.get("check") == IDENTITY_CHECK and f.get("status") == SKIP:
            buf.append(f["title"])
            break
    if cfg and cfg.get("_path"):
        outside, why_outside = config_outside_root(cfg.get("_root"), cfg.get("_path"))
        if outside is True:
            buf.append("配置 · %s（外部配置，不在被扫描项目内）" % cfg["_path"])
        elif outside is False:
            buf.append("配置 · %s（在被扫描项目内）" % cfg["_path"])
        else:
            buf.append("配置 · %s（在不在项目内判不了：%s）" % (cfg["_path"], why_outside))
        excluded = embedded_std_rel(cfg.get("_root") or root)
        if excluded:
            buf.append("排除 · %s/（工具自身所在的内嵌目录，不扫描）" % excluded)
        ex = cfg.get("_exceptions") or {}
        if not ex.get("display"):
            buf.append("登记 · 无")
        elif ex.get("expired"):
            # 「有效」是契约 §9 的"五项齐全、表行合格"，不是"未过期"；过期数不标出来，
            # 这行的 N 就会和下一行的「已登记」对不上，读的人只能猜是哪一个错了。
            buf.append("登记 · %s（%d 行有效，其中 %d 行已过期）"
                       % (ex["display"], ex.get("valid") or 0, ex["expired"]))
        else:
            buf.append("登记 · %s（%d 行有效）" % (ex["display"], ex.get("valid") or 0))
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
            buf.append("  · %s%s%s" % (f["title"], tag, loc))
            buf.append("      id：%s" % f.get("id"))
            for key, prefix in (("reason", "原因"), ("why", "依据"), ("evidence", "证据")):
                if f.get(key):
                    buf.append("      %s：%s" % (prefix, f[key]))
        buf.append("")

    if show_scope:
        buf.append("覆盖边界（没检查的不等于没问题）")
        if cfg is None:
            buf.append("  未定：配置没读进来，本次覆盖边界无法给出。")
        else:
            for name, sc in sorted(scopes(cfg).items()):
                buf.append("  %s" % name)
                for line in sc.get("not_covered", []):
                    buf.append("    不看：%s" % line)
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


def main(argv=None):
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

    findings, cfg = run_all(args.root, selftest_only=args.selftest,
                            config_path=args.config)

    if args.json:
        sys.stdout.write(json.dumps(findings, ensure_ascii=False, indent=2))
        sys.stdout.write("\n")
    else:
        text = render(findings, args.root, cfg,
                      show_scope=not args.no_scope and not args.selftest)
        try:
            sys.stdout.write(text + "\n")
        except UnicodeEncodeError:
            sys.stdout.buffer.write((text + "\n").encode("utf-8", "replace"))

    if any(f["status"] == FAIL for f in findings):
        return 1
    # 只看**未登记**的未定：已登记的仍是未定、仍逐条列出、仍计数，只是不再挡门（契约 §9）。
    if any(f["status"] == UNDETERMINED and not f.get("registered") for f in findings):
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
