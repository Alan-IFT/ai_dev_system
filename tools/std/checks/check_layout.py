# -*- coding: utf-8 -*-
"""文档树工件齐备性与元信息。

执行 01 §3.1（文档树，★ 是最小起点）、§3.2（职责卡的"它过期了怎么被发现"）、
§3.5（文档元信息与状态）。契约见 ../CONTRACT.md。

本模块只用标准库。需要 stdlib 里没有的函数在本文件内实现，不改 stdlib。
"""
from __future__ import annotations

import glob as _glob
import io
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from stdlib import (  # noqa: E402
    FAIL, PASS, SKIP, UNDETERMINED,
    cfg_get, finding, is_tailored_out, undetermined_from_exception,
)

NAME = "layout"
STANDARD_REFS = ["01 §3.1", "01 §3.2", "01 §3.5"]

# --------------------------------------------------------------------------
# 分档工件清单
#
# 派生自 templates/文件树与落地路径.md，提取日期 2026-09-10：
#   L0  该文件 §2「L0 · 一人一工具（5 个文件）」第 20-30 行的树 + 第 32-38 行的职责表
#   L1  该文件 §3「L1 · 一人多会话（+3）」第 44-53 行的树
#   L2  该文件 §4「L2 · 团队（+5）」第 58-73 行的树
#   L3  该文件 §5「L3 · 无人值守（+3）」第 79-87 行的树
# ★ 三类（入口 / 验收 / 状态）取自 标准/01-项目管理标准.md §3.1 正文
#   「最小起点是入口、验收、状态三类工件（标 ★）」。
#
# 已知不一致，照实记：模板 §4 的小标题写「+5」，其下的树实列 6 项
#   （DECISIONS / GATES / SOURCES / eval / memory / tools/check_*）。本常量按树取 6 项。
#
# **这是那个文件某一天的快照。源文件改了，这里不会自动跟着改。**
# 每项候选路径给两套：模板的 L0 扁平摆法，以及 01 §3.1 大项目树的摆法
# （01 §3.1 明说「文件路径可按 §3.1 合并映射」，所以命中任一即算存在）。
# 项目可用 governance/project.yaml 的 layout.artifacts.<role> 指定自己的路径，
# 指定了就只认它，不再猜候选。
# --------------------------------------------------------------------------

_TEMPLATE_SOURCE = "templates/文件树与落地路径.md"
_SNAPSHOT_DATE = "2026-09-10"

# (role, 中文名, 是否 ★, 存在性判据, 候选相对路径)
# 存在性判据：file=必须是文件 / dir=必须是目录 / any=文件或目录 / glob=通配命中任一
_TIER_ITEMS = {
    "L0": [
        ("entry", "入口", True, "file", ["CONTEXT.md", "AGENTS.md", "CLAUDE.md"]),
        ("acceptance", "验收", True, "any", ["ACCEPTANCE.md", "docs/product/acceptance"]),
        ("status", "状态", True, "any", ["WORK.md", "docs/state/STATUS.md"]),
        ("playbook", "方法与坑", False, "any", ["PLAYBOOK.md", "docs/knowledge/PLAYBOOK.md"]),
        ("failures", "失败清单", False, "any", ["FAILURES.md", "docs/knowledge/FAILURES.md"]),
    ],
    "L1": [
        ("work_current", "实时状态源", False, "any", ["work/current.md", "docs/state/work"]),
        ("handoff", "会话交接", False, "any", ["work/handoff.md", "docs/state/handoff"]),
        ("work_artifacts", "工具原文落点", False, "dir", ["work/artifacts", "docs/state/artifacts"]),
    ],
    "L2": [
        ("decisions", "决策与生效登记", False, "any", ["DECISIONS.md", "docs/decisions"]),
        ("gates", "闸门合同", False, "any", ["GATES.md", "governance/GATES.md"]),
        ("sources", "权威记录源指派", False, "any", ["SOURCES.md", "docs/SOURCES.md"]),
        ("eval", "评估三区与 manifest", False, "any", ["eval/manifest.md", "eval"]),
        ("memory", "记忆候选池", False, "dir", ["memory", "docs/memory"]),
        ("checkers", "项目侧检查器", False, "glob",
         ["tools/check_*.py", "tools/*/check_*.py", "tools/*/checks/check_*.py"]),
    ],
    "L3": [
        ("policy_budget", "预算与范围", False, "any", ["policy/budget.md"]),
        ("policy_judges", "判定器登记", False, "any", ["policy/judges.md"]),
        ("ops_liveness", "活性巡检", False, "any", ["ops/liveness.md"]),
    ],
}

_TIER_ORDER = ["L0", "L1", "L2", "L3"]

_DEFAULT_DATE_FIELDS = ["updated_at"]   # 01 §3.5 的字段名
_STATUS_FIELD = "status"                # 01 §3.5：draft | active | superseded | retired
_META_HEAD_LINES = 40                   # 元信息在"头部"，只看头部若干行


def _norm(p):
    return str(p).replace("\\", "/").strip().rstrip("/")


def _rebase_docs(cand, docs_root):
    """候选路径里以 docs/ 开头的，按项目的 layout.docs_root 改基。"""
    docs_root = _norm(docs_root or "docs")
    if cand.startswith("docs/") and docs_root != "docs":
        return docs_root + cand[4:]
    return cand


def _exists(root, rel, kind):
    path = os.path.join(root, rel.replace("/", os.sep))
    if kind == "glob":
        return bool(_glob.glob(os.path.join(root, rel.replace("/", os.sep))))
    if kind == "file":
        return os.path.isfile(path)
    if kind == "dir":
        return os.path.isdir(path)
    return os.path.exists(path)


def _tier_items(tier):
    items = []
    for t in _TIER_ORDER[: _TIER_ORDER.index(tier) + 1]:
        items.extend(_TIER_ITEMS[t])
    return items


def _artifact_tailored(cfg, role):
    """项目是否在 tailoring 里登记了这个工件不适用。

    接受 `check: layout:<role>` 与 `check: <role>` 两种写法。
    """
    keys = ("%s:%s" % (NAME, role), role)
    for item in cfg_get(cfg, "tailoring", []) or []:
        if not isinstance(item, dict):
            continue
        if str(item.get("check")) in keys and item.get("applicable") is False:
            return True, (str(item.get("reason") or "").strip() or None)
    return False, None


def _head(path):
    with io.open(path, encoding="utf-8", errors="replace") as fh:
        out = []
        for i, line in enumerate(fh):
            if i >= _META_HEAD_LINES:
                break
            out.append(line)
    return "".join(out)


def _has_field(head, field):
    """头部有没有 `field:`。允许 YAML front matter、列表项、加粗写法。"""
    pat = r"^[ \t]*(?:[-*+][ \t]*)?\*{0,2}%s\*{0,2}[ \t]*[:：]" % re.escape(str(field))
    return re.search(pat, head, re.M) is not None


def _date_fields(cfg):
    raw = cfg_get(cfg, "metadata_fields")
    if raw is None:
        return list(_DEFAULT_DATE_FIELDS), True
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list) or not raw:
        return list(_DEFAULT_DATE_FIELDS), True
    return [str(x) for x in raw], False


# --------------------------------------------------------------------------

def scope(cfg):
    tier = cfg_get(cfg, "tier")
    docs_root = _norm(cfg_get(cfg, "layout.docs_root") or "docs")
    entries = cfg_get(cfg, "layout.entry", []) or []
    fields, used_default = _date_fields(cfg)
    return {
        "covered": [
            "按 project.yaml 的 tier（当前 %s）查该档要求的工件在不在" % (tier or "未声明"),
            "只在项目根、layout.entry（%s）与 layout.docs_root（%s）下解析工件路径"
            % (", ".join(map(str, entries)) or "未配置", docs_root),
            "对存在的 markdown 工件查 01 §3.5 的头部元信息：日期字段 %s 与状态字段 %s"
            % ("/".join(fields) + ("（默认值）" if used_default else ""), _STATUS_FIELD),
        ],
        "not_covered": [
            "不判断文档内容对不对——那不是机械可判定的（契约 §7）",
            "不判断某个工件该不该存在：裁剪是人的决定，只看它有没有在 tailoring 里登记",
            "不扫全仓：只看 layout.entry 与 layout.docs_root 下的候选路径，别处同名文件看不见",
            "分档清单是 %s 于 %s 的快照，源文件改了这里不会自动变；两边不一致时以源文件为准"
            % (_TEMPLATE_SOURCE, _SNAPSHOT_DATE),
            "只看元信息字段在不在，不看它的值对不对、日期是不是已经过期",
            "目录型工件不逐份判其下文档的元信息",
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

    tier = cfg_get(cfg, "tier")
    tier = str(tier).strip().upper() if tier is not None else ""
    if not tier:
        return [finding(
            NAME, UNDETERMINED, "未声明采用档次",
            reason="未声明采用档次，本工具不猜该项目该有哪些工件",
            why="01 §3.1：文件存在的理由是它承载哪条职责；该有哪几件由采用的档位决定",
            evidence="governance/project.yaml 缺 tier；分档定义见 %s" % _TEMPLATE_SOURCE,
        )]
    if tier not in _TIER_ORDER:
        return [finding(
            NAME, UNDETERMINED, "tier 取值 %r 不是 L0/L1/L2/L3" % tier,
            reason="档次取值不认识，本工具不把它归到最近的一档",
            why="01 §3.1 / %s 只定义了四档" % _TEMPLATE_SOURCE,
        )]

    docs_root = _norm(cfg_get(cfg, "layout.docs_root") or "docs")
    entries = [str(x) for x in (cfg_get(cfg, "layout.entry", []) or [])]
    overrides = cfg_get(cfg, "layout.artifacts") or {}
    if not isinstance(overrides, dict):
        overrides = {}
    date_fields, used_default_fields = _date_fields(cfg)

    out = []
    md_to_check = []   # [(role, 中文名, relpath)]

    for role, label, star, kind, cands in _tier_items(tier):
        skipped, sreason = _artifact_tailored(cfg, role)
        if skipped:
            out.append(finding(
                NAME, SKIP, "%s（%s）已登记为不适用" % (label, role),
                reason=sreason or "project.yaml 的 tailoring 未写理由",
                why="01 §3.1：树里每一行都要能说出它承载哪条职责；裁剪须登记",
            ))
            continue

        # 入口以 layout.entry 为准：那是项目自己声明的默认加载合同
        if role == "entry" and entries:
            for rel in entries:
                rel = _norm(rel)
                if _exists(root, rel, "file"):
                    out.append(finding(
                        NAME, PASS, "入口 %s 在" % rel, where=rel,
                        evidence="来自 layout.entry",
                    ))
                    md_to_check.append((role, label, rel))
                else:
                    out.append(finding(
                        NAME, FAIL, "★ 入口缺失：%s" % rel, where=rel,
                        why="01 §3.1：入口、验收、状态是最小起点（★）；01 §3.2 入口每次整份加载，"
                            "缺了默认加载合同就不成立",
                        evidence="layout.entry 列了它，%s 下没有" % os.path.abspath(root),
                    ))
            continue

        override = overrides.get(role)
        cand_list = [_norm(override)] if override else [
            _rebase_docs(c, docs_root) for c in cands
        ]
        hit = None
        for rel in cand_list:
            if _exists(root, rel, kind):
                hit = rel
                break

        src = "layout.artifacts.%s" % role if override else \
              "%s 快照候选：%s" % (_TEMPLATE_SOURCE, "、".join(cand_list))

        if hit is None:
            if star:
                out.append(finding(
                    NAME, FAIL, "★ %s 类工件缺失（%s）" % (label, role),
                    where=cand_list[0],
                    why="01 §3.1：入口、验收、状态是最小起点（★），少一件这套管理就没有落点",
                    evidence="候选都不存在。%s" % src,
                ))
            else:
                out.append(finding(
                    NAME, UNDETERMINED, "%s 档要求的 %s（%s）没找到" % (tier, label, role),
                    where=cand_list[0],
                    reason="可能是有意裁剪但没在 tailoring 里登记，也可能是真的漏了；本工具判不了是哪一种",
                    why="01 §3.1：%s 档的树里有这一项；不登记的缺失按未定，不按通过" % tier,
                    evidence="候选都不存在。%s" % src,
                ))
            continue

        out.append(finding(
            NAME, PASS, "%s（%s）在：%s" % (label, role, hit), where=hit, evidence=src,
        ))
        if kind != "glob" and hit.lower().endswith(".md") and \
                os.path.isfile(os.path.join(root, hit.replace("/", os.sep))):
            md_to_check.append((role, label, hit))
        elif os.path.isdir(os.path.join(root, hit.replace("/", os.sep))):
            out.append(finding(
                NAME, SKIP, "%s 是目录，不逐份判其下文档的元信息" % hit,
                where=hit,
                reason="01 §3.5 的元信息挂在具体文档上；目录下有哪几份该带元信息本工具判不了",
            ))

    note = "元信息日期字段用的是标准默认 %s，项目未在 metadata_fields 里校准（契约 §5）" \
        % "/".join(date_fields) if used_default_fields else \
        "元信息日期字段取自 project.yaml 的 metadata_fields：%s" % "/".join(date_fields)

    for role, label, rel in md_to_check:
        path = os.path.join(root, rel.replace("/", os.sep))
        try:
            head = _head(path)
        except OSError as exc:
            out.append(undetermined_from_exception(NAME, exc, "读 %s 的头部" % rel))
            continue
        missing = []
        if not any(_has_field(head, f) for f in date_fields):
            missing.append("日期字段（%s）" % "/".join(date_fields))
        if not _has_field(head, _STATUS_FIELD):
            missing.append("状态字段（%s）" % _STATUS_FIELD)
        if missing:
            out.append(finding(
                NAME, FAIL, "%s 头部缺元信息：%s" % (rel, "、".join(missing)),
                where="%s:1" % rel,
                why="01 §3.5 要求重要文档头部带 status 与 updated_at；"
                    "没有元信息就无法按 01 §3.2「它过期了怎么被发现」那一列发现它过期",
                evidence="只看前 %d 行。%s" % (_META_HEAD_LINES, note),
            ))
        else:
            out.append(finding(
                NAME, PASS, "%s 头部元信息齐" % rel, where=rel, evidence=note,
            ))

    return out


def selftest():
    """反例与正例各一。见契约 §3：抓不出违规的检查器，其结论作废。"""
    results = []
    try:
        with tempfile.TemporaryDirectory() as tmp:
            def w(name, body):
                p = os.path.join(tmp, name.replace("/", os.sep))
                parent = os.path.dirname(p)
                if parent:
                    os.makedirs(parent, exist_ok=True)
                with io.open(p, "w", encoding="utf-8") as fh:
                    fh.write(body)

            meta = "---\nid: X\nstatus: active\nupdated_at: 2026-09-10\n---\n\n# 标题\n"
            for name in ("CONTEXT.md", "ACCEPTANCE.md", "WORK.md", "PLAYBOOK.md", "FAILURES.md"):
                w(name, meta)

            cfg = {
                "_root": tmp,
                "tier": "L0",
                "layout": {"entry": ["CONTEXT.md"], "docs_root": "docs"},
            }

            # 正例：L0 五件齐、元信息齐 → 全 PASS
            got_ok = [f["status"] for f in run(cfg)]

            # 反例：删掉 ★ 状态工件 → 必须有 FAIL
            os.remove(os.path.join(tmp, "WORK.md"))
            got_bad = [f["status"] for f in run(cfg)]

            results.append(finding(
                NAME, PASS if FAIL in got_bad else FAIL,
                "反例：L0 缺 ★ 状态工件 WORK.md 应判 FAIL",
                evidence="实得 %s" % got_bad,
                why="契约 §3 静默失效探测；判据 01 §3.1 的 ★ 三类",
            ))
            results.append(finding(
                NAME, PASS if (got_ok and set(got_ok) == {PASS}) else FAIL,
                "正例：L0 五件齐且元信息齐应全判 PASS",
                evidence="实得 %s" % got_ok,
                why="契约 §3 静默失效探测",
            ))
    except Exception as exc:  # noqa: BLE001
        results.append(undetermined_from_exception(NAME, exc, "跑自检"))
    return results
