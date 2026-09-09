# -*- coding: utf-8 -*-
"""汇总入口：跑 checks/ 下的全部检查器，按三态汇总。

用法：
    python tools/std/check_all.py [项目根]           # 默认当前目录
    python tools/std/check_all.py --selftest         # 只跑检查器自检
    python tools/std/check_all.py --json             # 机器可读

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


def run_all(root, selftest_only=False):
    findings = []
    mods = discover()
    if not mods:
        findings.append(finding(
            "check_all", UNDETERMINED, "没有发现任何检查器",
            reason="%s 下没有 check_*.py" % CHECKS_DIR,
        ))
        return findings

    if selftest_only:
        findings.extend(_contract_examples_selftest())
        for name, mod, err in mods:
            if err is not None:
                findings.append(undetermined_from_exception(name, err, "加载检查器"))
                continue
            ok, gate = _gated_by_selftest(name, mod)
            findings.extend(gate if not ok else mod.selftest())
        return findings

    cfg, problem = load_config(root)
    if problem:
        findings.append(finding(
            "check_all", UNDETERMINED, "读不到项目配置，全部检查未定",
            reason=problem,
            why="契约 §5：缺配置不取默认值当事实",
        ))
        return findings

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
    return findings


def scopes(root):
    out = {}
    cfg, _ = load_config(root)
    for name, mod, err in discover():
        if err is not None or not hasattr(mod, "scope"):
            continue
        try:
            out[name] = mod.scope(cfg)
        except Exception as exc:
            out[name] = {"covered": [], "not_covered": ["scope() 出错：%s" % exc]}
    return out


def render(findings, root, show_scope=True):
    buf = []
    counts = {s: 0 for s in (PASS, FAIL, UNDETERMINED, SKIP)}
    for f in findings:
        counts[f["status"]] = counts.get(f["status"], 0) + 1

    buf.append("标准检查 · %s" % os.path.abspath(root))
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
        for name, sc in sorted(scopes(root).items()):
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
    args = ap.parse_args(argv)

    findings = run_all(args.root, selftest_only=args.selftest)

    if args.json:
        sys.stdout.write(json.dumps(findings, ensure_ascii=False, indent=2))
        sys.stdout.write("\n")
    else:
        text = render(findings, args.root, show_scope=not args.no_scope and not args.selftest)
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
