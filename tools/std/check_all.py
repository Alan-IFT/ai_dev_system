# -*- coding: utf-8 -*-
"""汇总入口：跑 checks/ 下的全部检查器，按三态汇总。

用法：
    python tools/std/check_all.py [项目根]           # 默认当前目录
    python tools/std/check_all.py --selftest         # 只跑检查器自检
    python tools/std/check_all.py --json             # 机器可读
    python tools/std/check_all.py <项目> --config <别处的.yaml>
        # 扫描只读项目：配置放在被测项目之外，全程不往被测项目写任何东西

退出码：有 FAIL → 1；无 FAIL 但有 UNDETERMINED → 2；否则 0。
**2 不是成功。** 契约见同目录 CONTRACT.md。
"""
from __future__ import annotations

import argparse
import importlib.util
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from stdlib import (  # noqa: E402
    FAIL, PASS, SKIP, UNDETERMINED,
    finding, load_config, undetermined_from_exception,
)

CHECKS_DIR = os.path.join(HERE, "checks")


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
    """契约 §3：自检不过或没有自检的检查器，其结论作废。返回 (ok, findings)。"""
    if not hasattr(mod, "selftest"):
        return False, [finding(
            name, UNDETERMINED, "检查器没有自检",
            reason="契约 §3 要求每个检查器自带反例；没有反例就无法证明它抓得住违规",
            why="01 §5.6 守卫存在不等于守卫在执行",
        )]
    try:
        results = mod.selftest()
    except Exception as exc:
        return False, [undetermined_from_exception(name, exc, "跑自检")]
    bad = [r for r in results if r.get("status") != PASS]
    if bad:
        return False, [finding(
            name, UNDETERMINED, "检查器自检未通过，其对本仓库的结论作废",
            reason="; ".join("%s（%s）" % (r.get("title"), r.get("evidence")) for r in bad),
            why="契约 §3 / 01 §5.6：检查器故障按未定处置，不按通过记",
        )]
    return True, []


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


_SMOKE_CONFIG = u"""standard_version: "2026-09-10"
layout:
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
                 "main 两种 argv 退出码合法且有输出",
    ))
    return out


def run_all(root, selftest_only=False, config_path=None):
    """跑全部检查。返回 (findings, cfg)——配置只在这里加载一次，
    渲染覆盖边界时由调用方把 cfg 传回去，不再各自重新加载（重新加载会
    在配置读不到时打出一整屏"未配置"的假边界）。"""
    findings = []
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
        for name, mod, err in mods:
            if err is not None:
                findings.append(undetermined_from_exception(name, err, "加载检查器"))
                continue
            ok, gate = _gated_by_selftest(name, mod)
            findings.extend(gate if not ok else mod.selftest())
        return findings, None

    cfg, problem = load_config(root, config_path)
    if problem:
        findings.append(finding(
            "check_all", UNDETERMINED, "读不到项目配置，全部检查未定",
            reason=problem,
            why="契约 §5：缺配置不取默认值当事实",
        ))
        return findings, None

    for name, mod, err in mods:
        if err is not None:
            findings.append(undetermined_from_exception(name, err, "加载检查器"))
            continue
        ok, gate = _gated_by_selftest(name, mod)
        if not ok:
            findings.extend(gate)
            continue
        try:
            res = mod.run(cfg)
        except Exception as exc:
            findings.append(undetermined_from_exception(name, exc, "跑 %s" % name))
            continue
        findings.extend(res or [])
    return findings, cfg


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
    if cfg and os.path.isabs(str(cfg.get("_path") or "")):
        buf.append("配置 · %s（外部配置，不在被扫描项目内）" % cfg["_path"])
    buf.append("  通过 %d   失败 %d   未定 %d   不适用 %d"
               % (counts[PASS], counts[FAIL], counts[UNDETERMINED], counts[SKIP]))
    buf.append("")

    for status, label in ((FAIL, "失败"), (UNDETERMINED, "未定"), (SKIP, "不适用")):
        items = [f for f in findings if f["status"] == status]
        if not items:
            continue
        buf.append("%s（%d）" % (label, len(items)))
        for f in items:
            loc = ("  [%s]" % f["where"]) if f.get("where") else ""
            buf.append("  · %s%s" % (f["title"], loc))
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
    elif counts[UNDETERMINED]:
        buf.append("结论：未定 —— 有 %d 项没能判定。**未定不是通过**（01 §2 N1）。" % counts[UNDETERMINED])
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
    if any(f["status"] == UNDETERMINED for f in findings):
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
