# -*- coding: utf-8 -*-
"""篇幅预算：入口，以及 01 §3.7 其余四项以行数计的预算（状态、交接、工作项、模块文档）。

参考实现：其余检查器照本文件的形状写。契约见 ../CONTRACT.md。
"""
from __future__ import annotations

import io
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from stdlib import (  # noqa: E402
    FAIL, HANDOFF_CANDIDATES, PASS, SKIP, STATUS_CANDIDATES, UNDETERMINED,
    cfg_get, count_lines, docs_root_of, entry_files, finding, in_frozen, is_tailored_out, item_status,
    read_text, rebase_docs, undetermined_from_exception, work_root,
)

NAME = "entry-budget"
STANDARD_REFS = ["01 §1 G10", "01 §3.7"]

_DEFAULT_ENTRY_LINES = 150  # 01 §3.7 的默认值，项目可改

# 01 §3.7 其余以行数计的四项：(role, 中文名, budgets 下的键, 参考值, 超了怎么办)。01 §3.7 说表中数字
# 只是试验参数、不是合格门槛，所以只有项目声明了对应的 budgets 键才判，参考值只写进说明。
# INDEX 的预算是「每份文档一行」，不是行数，不在这里（见 scope().not_covered）。
_DOC_BUDGETS = (
    ("status", "状态", "status_lines", 80, "完成的移出“当前重点”；历史进 releases"),
    ("handoff", "交接", "handoff_lines", 60, "只留当前判断所需"),
    ("work_item", "工作项", "work_item_lines", 150, "过程记录移进 artifacts，只留结论与指针"),
    ("module", "模块文档", "module_lines", 200, "拆出契约与 runbook；“已知坑”移进 PLAYBOOK"),
)
# 模块文档没在 layout.artifacts.modules 声明时的候选：01 §3.1 的 architecture/ 与 02 的 modules/。
_MODULES_CANDIDATE = "docs/architecture/modules"

_WHY_DOC = "01 §3.7 篇幅预算：%s默认 %d 行；超了先按“%s”移出，不是先加预算"


def scope(cfg):
    entries, guessed = entry_files(cfg)
    return {
        "covered": [
            "逐行计数入口文件：%s（%s）" % ("、".join(entries) or "没找到", guessed or "取自 layout.entry"),
            "逐行计数状态（layout.artifacts.status，须是文件）、交接（layout.artifacts.handoff，文件或"
            "目录下直接一层 *.md）、工作项（layout.work_root 下直接一层、头部带状态字段的 *.md）、"
            "模块文档（layout.artifacts.modules，文件或目录下直接一层 *.md）；未声明时按候选 "
            "%s、%s、默认工作项目录、%s 找" % ("/".join(STATUS_CANDIDATES), "/".join(HANDOFF_CANDIDATES),
                                            _MODULES_CANDIDATE),
            "同一份文件同时是几类工件（如工作项目录兼作交接）时，超过其中最宽的预算才判 FAIL；"
            "只超较紧的预算记未定——标准没写合并工件用哪条预算",
            "以上四类只在项目声明了 budgets.status_lines／handoff_lines／work_item_lines／module_lines 时判",
        ],
        "not_covered": [
            "不判断入口内容是否该留在入口——那不是机械可判定的（契约 §7）",
            "不看未在 layout.entry 列出的文件，包括子目录里的同名入口；未配 layout.entry 时只看"
            "候选里第一个存在的那一个，它超预算只记未定（契约 §1.1）",
            "入口在不在不由本检查报：01 §3.1 的 ★ 入口归 layout（契约 §1 同一事实只报一次）；"
            "其余四类工件在不在同样不由本检查报，找不到记 SKIP",
            "按物理行计，不折算 token 占用（01 §3.7 明确不按行数推定 token）",
            "INDEX 的预算是「每份文档一行」，不是行数；一行里写没写摘要以外的内容要读内容，本检查不判",
            "状态声明为目录时不判：80 行是单份 STATUS 的预算，目录形态下没有对应对象",
            "不看 layout.frozen 下的文件；工作项目录只看直接一层，头部没有状态字段的文件不算工作项",
            "状态、交接、工作项、模块文档四类：未声明预算不判，默认值（80／60／150／200）仅作参考"
            "（01 §3.7：表中数字是试验参数，不是合格门槛）；入口预算不在此列，未声明仍按 150 判",
        ],
    }


def run(cfg):
    tailored, reason = is_tailored_out(cfg, NAME)
    if tailored:
        return [finding(NAME, SKIP, "项目已裁剪本检查", reason=reason or "project.yaml 未写理由")]
    return _entry(cfg) + _docs(cfg)


def _entry(cfg):
    root = cfg.get("_root") or "."
    entries, guessed = entry_files(cfg)
    if not entries:
        return [_absent(guessed)]

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
            out.append(_absent("来自项目声明（layout.entry／layout.artifacts.entry），文件不在", rel))
            continue
        try:
            n = count_lines(path)
        except OSError as exc:
            out.append(undetermined_from_exception(NAME, exc, "读 %s" % rel))
            continue
        if n > budget and guessed:
            # 候选是工具约定：它是不是这个项目的入口本工具不猜（契约 §1.1），超了只记未定
            out.append(finding(
                NAME, UNDETERMINED, "候选入口 %s 有 %d 行，超预算 %d 行" % (rel, n, budget),
                where="%s:%d" % (rel, budget + 1), kind="candidate-over", key=rel,
                reason="未配 layout.entry，%s 是按候选文件名认的入口；在 layout.entry 声明它之后"
                       "仍超预算才判 FAIL（契约 §1.1）" % rel,
                why="01 §1 G10 入口只放晚一秒就来不及的规则；01 §3.7 超了先移出，不是先加预算",
                evidence="%d 行 / 预算 %d（%s）；%s" % (n, budget, note, guessed),
            ))
        elif n > budget:
            out.append(finding(
                NAME, FAIL, "%s 有 %d 行，超预算 %d 行" % (rel, n, budget),
                where="%s:%d" % (rel, budget + 1),
                why="01 §1 G10 入口只放晚一秒就来不及的规则；01 §3.7 超了先移出，不是先加预算",
                evidence="%d 行 / 预算 %d（%s）" % (n, budget, note),
            ))
        else:
            out.append(finding(
                NAME, PASS, "%s 有 %d 行，在预算 %d 内" % (rel, n, budget),
                where=str(rel), evidence=note + ("；" + guessed if guessed else ""),
            ))
    return out


def _absent(note, rel=None):
    """入口文件不在：01 §3.1 的 ★ 入口由 layout 报，本检查记不适用（契约 §1 同一事实只报一次）。"""
    return finding(
        NAME, SKIP, "入口文件不在，行数无从计" + ("：%s" % rel if rel else ""),
        where=rel, kind="entry-absent", key=rel,
        reason="入口在不在由 layout 报（01 §3.1 ★ 入口）；本检查不再另记一条",
        evidence="%s；负责报告的检查器：layout（layout 被裁剪、其入口一项被裁剪或 tier 未声明时它不报）"
                 % note,
    )


# --------------------------------------------------------------------------
# 其余四项：状态、交接、工作项、模块文档
# --------------------------------------------------------------------------

def _md_children(root, rel):
    """目录下直接一层的 *.md（相对路径，排好序）。"""
    base = os.path.join(root, rel)
    return sorted("%s/%s" % (rel.rstrip("/"), n) for n in os.listdir(base)
                  if n.lower().endswith(".md") and os.path.isfile(os.path.join(base, n)))


def _locate(cfg, role):
    """一类工件落在哪些文件上。返回 (文件列表, 是否来自项目声明, 说明, SKIP 或 None)。"""
    root = cfg.get("_root") or "."
    droot = docs_root_of(cfg)[0]
    if role == "work_item":
        rel, note = work_root(cfg)
        declared = bool(cfg_get(cfg, "layout.work_root"))
        if not os.path.isdir(os.path.join(root, rel)):
            return [], declared, note + "，目录不在", None
        files = [f for f in _md_children(root, rel)
                 if item_status(read_text(os.path.join(root, f))) is not None]
        return files, declared, note, None

    key = {"status": "status", "handoff": "handoff", "module": "modules"}[role]
    declared = cfg_get(cfg, "layout.artifacts.%s" % key)
    if declared:
        cands, src = [str(declared).strip().rstrip("/")], "取自 layout.artifacts.%s" % key
    else:
        base = {"status": STATUS_CANDIDATES, "handoff": HANDOFF_CANDIDATES,
                "module": (_MODULES_CANDIDATE,)}[role]
        cands = [rebase_docs(c, droot) for c in base]
        src = "未声明 layout.artifacts.%s，按候选 %s 找" % (key, "、".join(cands))
    for rel in cands:
        path = os.path.join(root, rel)
        if os.path.isfile(path):
            return [rel], bool(declared), src, None
        if os.path.isdir(path):
            if role == "status":
                return [], bool(declared), src, finding(
                    NAME, SKIP, "状态工件是目录，不按单份 STATUS 的行数预算判", where=rel,
                    kind="status-dir", key=rel,
                    reason="01 §3.7 的 80 行是单份 STATUS.md 的预算；%s 是目录（%s），没有对应的单份文件；"
                           "目录下的文件若是工作项或交接，按那两类的预算判" % (rel, src),
                    why=_WHY_DOC % ("STATUS ", 80, _DOC_BUDGETS[0][4]))
            return _md_children(root, rel), bool(declared), src, None
    return [], bool(declared), src + "，不在", None


def _budget(cfg, key, default, label):
    val = cfg_get(cfg, "budgets.%s" % key)
    if val is None:
        return None, None, finding(
            NAME, SKIP, "%s：项目没声明 budgets.%s，不判" % (label, key), kind="budget-undeclared", key=key,
            reason="01 §3.7 说表中数字只是试验参数、不是合格门槛；项目在 project.yaml 声明了预算才按它判，"
                   "未声明不判，默认 %d 行仅作参考" % default)
    if not isinstance(val, int) or isinstance(val, bool) or val <= 0:
        return None, None, finding(
            NAME, UNDETERMINED, "行数预算 budgets.%s 不是正整数" % key, kind="budget-invalid", key=key,
            reason="budgets.%s = %r" % (key, val), why="01 §3.7 的预算是参数，但必须是可比较的数")
    return val, "%s = %d 取自 project.yaml" % (key, val), None


def _docs(cfg):
    root = cfg.get("_root") or "."
    out, per_file, passed = [], {}, []
    for role, label, key, default, fix in _DOC_BUDGETS:
        budget, bnote, bad = _budget(cfg, key, default, label)
        if bad:
            out.append(bad)
            continue
        try:
            files, declared, src, skip = _locate(cfg, role)
        except OSError as exc:
            out.append(undetermined_from_exception(NAME, exc, "找%s" % label))
            continue
        if skip:
            out.append(skip)
            continue
        files = [f for f in files if not in_frozen(cfg, f)]
        if not files:
            out.append(finding(
                NAME, SKIP, "%s：没有可计行数的文件" % label, kind="%s-absent" % role,
                reason="%s；在不在由 layout 报（01 §3.1），本检查只数已有的" % src))
            continue
        for rel in files:
            per_file.setdefault(rel, []).append((role, label, budget, declared, src, bnote, fix))

    for rel in sorted(per_file):
        roles = per_file[rel]
        try:
            n = count_lines(os.path.join(root, rel))
        except OSError as exc:
            out.append(undetermined_from_exception(NAME, exc, "读 %s" % rel))
            continue
        lo = min(r[2] for r in roles)
        hi = max(r[2] for r in roles)
        labels = "、".join("%s（预算 %d）" % (r[1], r[2]) for r in roles)
        why = "；".join(_WHY_DOC % (r[1], r[2], r[6]) for r in roles)
        ev = "%d 行；%s；%s" % (n, "；".join(r[4] for r in roles), "；".join(r[5] for r in roles))
        if n <= lo:
            passed.append("%s %d 行" % (rel, n))
        elif n > hi and any(r[3] for r in roles):
            out.append(finding(
                NAME, FAIL, "%s 有 %d 行，超%s" % (rel, n, labels), where="%s:%d" % (rel, hi + 1),
                kind="doc-over", key=rel, why=why, evidence=ev,
                reason="落点是项目声明的；同时是几类工件时已按其中最宽的预算 %d 比" % hi
                       if len(roles) > 1 else ""))
        elif n > hi:
            out.append(finding(
                NAME, UNDETERMINED, "候选 %s 有 %d 行，超%s" % (rel, n, labels),
                where="%s:%d" % (rel, hi + 1), kind="candidate-over", key=rel, why=why, evidence=ev,
                reason="落点是按候选路径认的，不是项目声明；在 project.yaml 声明它之后仍超预算才判 FAIL"
                       "（契约 §1.1）"))
        else:
            out.append(finding(
                NAME, UNDETERMINED, "%s 有 %d 行，超了较紧的预算、没超较宽的：它同时是%s"
                % (rel, n, labels), where="%s:%d" % (rel, lo + 1), kind="merged-over", key=rel,
                why=why, evidence=ev,
                reason="01 §3.7 按文档类给预算，没写一份文件合并承担几类职责时用哪条；超过最宽的 %d 行"
                       "才是确定的超预算" % hi))
    if passed:
        out.append(finding(
            NAME, PASS, "状态/交接/工作项/模块文档：%d 份在预算内" % len(passed), kind="docs-within",
            evidence="；".join(passed[:12]) + ("；……共 %d 份" % len(passed) if len(passed) > 12 else "")))
    return out


_ALL = {"status_lines": 80, "handoff_lines": 60, "work_item_lines": 150, "module_lines": 200}


def selftest():
    """反例与正例。见契约 §3：抓不出违规的检查器，其结论作废。"""
    results = []

    def _case(title, got, want):
        results.append(finding(NAME, PASS if got == want else FAIL, title,
                               evidence="期望 %s，实得 %s" % (want, got), why="契约 §3 静默失效探测"))

    def _w(tmp, rel, n, head=u""):
        path = os.path.join(tmp, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(head + u"x\n" * (n - (1 if head else 0)))

    def _got(cfg, ids=False):
        return sorted((f["status"], f["id"]) if ids else f["status"]
                      for f in _docs(cfg) if f["status"] != SKIP or ids)

    try:
        with tempfile.TemporaryDirectory() as tmp:
            _w(tmp, "BIG.md", 20)
            _w(tmp, "SMALL.md", 3)
            cfg = {"_root": tmp, "layout": {"entry": ["BIG.md"]}, "budgets": {"entry_lines": 10}}
            _case("反例：入口 20 行 / 预算 10 应判 FAIL", [f["status"] for f in _entry(cfg)], [FAIL])
            cfg["layout"]["entry"] = ["SMALL.md"]
            _case("正例：入口 3 行 / 预算 10 应判 PASS", [f["status"] for f in _entry(cfg)], [PASS])

        # 状态：声明的 FAIL、候选的未定、在预算内 PASS、预算键被读
        with tempfile.TemporaryDirectory() as tmp:
            _w(tmp, "S.md", 100)
            cfg = {"_root": tmp, "layout": {"artifacts": {"status": "S.md"}}}
            _case("未声明预算不判：声明的状态 100 行、四个预算键都没有，只得四条 SKIP budget-undeclared",
                  _got(cfg, True), sorted((SKIP, "entry-budget/budget-undeclared/%s" % k) for k in
                                          ("status_lines", "handoff_lines", "work_item_lines", "module_lines")))
            cfg["budgets"] = dict(_ALL)
            _case("反例：声明的状态 100 行 / 声明预算 80 应判 FAIL doc-over",
                  _got(cfg, True), [(FAIL, "entry-budget/doc-over/S.md"), (SKIP, "entry-budget/handoff-absent"),
                                    (SKIP, "entry-budget/module-absent"), (SKIP, "entry-budget/work_item-absent")])
            cfg["budgets"]["status_lines"] = 120
            _case("正例：budgets.status_lines=120 时同一份 100 行应判 PASS", _got(cfg), [PASS])
        with tempfile.TemporaryDirectory() as tmp:
            _w(tmp, "WORK.md", 100)
            _case("候选状态 WORK.md 100 行只记未定 candidate-over（契约 §1.1）",
                  [x for x in _got({"_root": tmp, "budgets": dict(_ALL)}, True) if x[0] != SKIP],
                  [(UNDETERMINED, "entry-budget/candidate-over/WORK.md")])

        # 交接、工作项、模块文档；合并工件
        with tempfile.TemporaryDirectory() as tmp:
            st = u"状态: in_progress\n"
            _w(tmp, "w/WI-1.md", 160, st)         # 工作项超 150
            _w(tmp, "w/WI-2.md", 40, st)
            _w(tmp, "w/notes.md", 400)            # 无状态字段：不算工作项
            _w(tmp, "w/current.md", 100, st)      # 同时是状态（80）与工作项（150）
            _w(tmp, "h/2026-09-01.md", 70)        # 交接超 60
            _w(tmp, "m/a.md", 201)                # 模块文档超 200
            cfg = {"_root": tmp, "budgets": dict(_ALL), "layout": {"work_root": "w", "artifacts": {
                "status": "w/current.md", "handoff": "h", "modules": "m"}}}
            _case("反例：工作项 160、交接 70、模块 201 判 FAIL；状态兼工作项 100 行记未定 merged-over；"
                  "无状态字段的不算工作项",
                  _got(cfg, True),
                  [(FAIL, "entry-budget/doc-over/h/2026-09-01.md"), (FAIL, "entry-budget/doc-over/m/a.md"),
                   (FAIL, "entry-budget/doc-over/w/WI-1.md"), (PASS, "entry-budget/docs-within"),
                   (UNDETERMINED, "entry-budget/merged-over/w/current.md")])
            _w(tmp, "w/current.md", 151, st)
            _w(tmp, "w/WI-1.md", 150, st)
            _w(tmp, "h/2026-09-01.md", 60)
            _w(tmp, "m/a.md", 200)
            _case("正例：各在预算上限内 PASS；合并工件超过最宽的 150 判 FAIL",
                  _got(cfg, True), [(FAIL, "entry-budget/doc-over/w/current.md"),
                                    (PASS, "entry-budget/docs-within")])
            cfg["layout"]["artifacts"]["status"] = "w"
            _case("状态声明为目录记 SKIP status-dir", [x for x in _got(cfg, True) if "status" in x[1]],
                  [(SKIP, "entry-budget/status-dir/w")])
    except Exception as exc:  # noqa: BLE001
        results.append(finding(NAME, FAIL, "自检自己跑不起来", evidence="%s: %s" % (type(exc).__name__, exc),
                               why="契约 §3：自检崩了，本检查器对目标仓库的结论作废"))
    return results
