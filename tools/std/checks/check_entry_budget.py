# -*- coding: utf-8 -*-
"""入口文件行数预算。

参考实现：其余检查器照本文件的形状写。契约见 ../CONTRACT.md。
"""
from __future__ import annotations

import io
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from stdlib import (  # noqa: E402
    FAIL, PASS, SKIP, UNDETERMINED,
    cfg_get, count_lines, finding, is_tailored_out, undetermined_from_exception,
)

NAME = "entry-budget"
STANDARD_REFS = ["01 §1 G10", "01 §3.7"]

_DEFAULT_ENTRY_LINES = 150  # 01 §3.7 的默认值，项目可改


def scope(cfg):
    entries = cfg_get(cfg, "layout.entry", []) or []
    return {
        "covered": ["逐行计数 layout.entry 列出的入口文件：%s" % (", ".join(map(str, entries)) or "（未配置）")],
        "not_covered": [
            "不判断入口内容是否该留在入口——那不是机械可判定的（契约 §7）",
            "不看未在 layout.entry 列出的文件，包括子目录里的同名入口",
            "按物理行计，不折算 token 占用（01 §3.7 明确不按行数推定 token）",
        ],
    }


def run(cfg):
    tailored, reason = is_tailored_out(cfg, NAME)
    if tailored:
        return [finding(NAME, SKIP, "项目已裁剪本检查", reason=reason or "project.yaml 未写理由")]

    root = cfg.get("_root") or "."
    entries = cfg_get(cfg, "layout.entry")
    if not entries:
        return [finding(
            NAME, UNDETERMINED, "未配置入口文件",
            reason="governance/project.yaml 缺 layout.entry；本工具不猜哪个文件是入口",
            why="01 §1 G10 要求入口简短，但先要说清哪份是入口",
        )]

    budget = cfg_get(cfg, "budgets.entry_lines")
    used_default = budget is None
    if used_default:
        budget = _DEFAULT_ENTRY_LINES
    if not isinstance(budget, int) or budget <= 0:
        return [finding(
            NAME, UNDETERMINED, "行数预算不是正整数",
            reason="budgets.entry_lines = %r" % (budget,),
            why="01 §3.7 的预算是参数，但必须是可比较的数",
        )]
    note = "用的是标准默认值 %d，项目未校准（契约 §5）" % budget if used_default else "预算取自 project.yaml"

    out = []
    for rel in entries:
        path = os.path.join(root, str(rel))
        if not os.path.isfile(path):
            out.append(finding(
                NAME, UNDETERMINED, "入口文件不存在：%s" % rel,
                where=str(rel),
                reason="layout.entry 列了它但文件不在；是配置过期还是文件被删，本工具判不了",
                why="01 §3.2：入口是每次整份加载的工件，缺失即默认加载合同不成立",
            ))
            continue
        try:
            n = count_lines(path)
        except OSError as exc:
            out.append(undetermined_from_exception(NAME, exc, "读 %s" % rel))
            continue
        if n > budget:
            out.append(finding(
                NAME, FAIL, "%s 有 %d 行，超预算 %d 行" % (rel, n, budget),
                where="%s:%d" % (rel, budget + 1),
                why="01 §1 G10 入口只放晚一秒就来不及的规则；01 §3.7 超了先移出，不是先加预算",
                evidence="%d 行 / 预算 %d（%s）" % (n, budget, note),
            ))
        else:
            out.append(finding(
                NAME, PASS, "%s 有 %d 行，在预算 %d 内" % (rel, n, budget),
                where=str(rel), evidence=note,
            ))
    return out


def selftest():
    """反例与正例各一。见契约 §3：抓不出违规的检查器，其结论作废。"""
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        os.makedirs(os.path.join(tmp, "governance"), exist_ok=True)
        big = os.path.join(tmp, "BIG.md")
        small = os.path.join(tmp, "SMALL.md")
        with io.open(big, "w", encoding="utf-8") as fh:
            fh.write("x\n" * 20)
        with io.open(small, "w", encoding="utf-8") as fh:
            fh.write("x\n" * 3)

        cfg = {"_root": tmp, "layout": {"entry": ["BIG.md"]}, "budgets": {"entry_lines": 10}}
        got = [f["status"] for f in run(cfg)]
        results.append(finding(
            NAME, PASS if got == [FAIL] else FAIL,
            "反例：20 行 / 预算 10 应判 FAIL",
            evidence="实得 %s" % got,
            why="契约 §3 静默失效探测",
        ))

        cfg["layout"]["entry"] = ["SMALL.md"]
        got = [f["status"] for f in run(cfg)]
        results.append(finding(
            NAME, PASS if got == [PASS] else FAIL,
            "正例：3 行 / 预算 10 应判 PASS",
            evidence="实得 %s" % got,
            why="契约 §3 静默失效探测",
        ))
    return results
