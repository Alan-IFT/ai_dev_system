# -*- coding: utf-8 -*-
"""文档树工件齐备性与元信息。

执行 01 §3.1（文档树，★ 是最小起点）、§3.2（职责卡的"它过期了怎么被发现"）、
§3.5（文档元信息与状态）。契约见 ../CONTRACT.md。

本模块只用标准库。与其他检查器共用的候选路径（状态、工作项目录）在 stdlib。
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
    DEFAULT_WORK_ROOT, ENTRY_CANDIDATES, FAIL, HANDOFF_CANDIDATES, PASS, SKIP, STATUS_CANDIDATES,
    STATUS_FIELDS, UNDETERMINED, cfg_get, date_fields_of, docs_root_of, entry_files, finding,
    is_tailored_out, rebase_docs, undetermined_from_exception,
)

NAME = "layout"
STANDARD_REFS = ["01 §3.1", "01 §3.2", "01 §3.5"]

# --------------------------------------------------------------------------
# 分档工件清单
#
# 派生自 templates/文件树与落地路径.md，提取日期 2026-09-10（按节名引用，不记行号——行号随编辑漂）：
#   L0  该文件 §2「L0 · 一人一工具」的树与其下的职责表
#   L1  该文件 §3「L1 · 一人多会话」的树
#   L2  该文件 §4「L2 · 团队」的树
#   L3  该文件 §5「L3 · 无人值守」的树
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
# 指定了就只认它，不再猜候选。入口、状态与实时状态源三项的候选别的检查器也要用，
# 放在 stdlib（ENTRY_CANDIDATES / STATUS_CANDIDATES / DEFAULT_WORK_ROOT）只写一处；
# 入口的解析（layout.entry 优先、未配取候选里第一个存在的）同在 stdlib.entry_files；
# 实时状态源未声明时先认 layout.work_root——工作项目录就是它的目录形态（01 §3.1 `state/work/`）。
#
# **候选路径列不是判据依据，是提示。** 它只有两个用途：项目没声明时试着找一下，
# 以及未命中时把这份清单写进 evidence，告诉采用方"该往哪儿放，或该在
# layout.artifacts 里改成哪儿"。候选落空推不出"该工件不存在"——按契约 §1/§7，
# ★ 角色未声明且候选未命中时记 UNDETERMINED，不记 FAIL。
# --------------------------------------------------------------------------

_TEMPLATE_SOURCE = "templates/文件树与落地路径.md"
_SNAPSHOT_DATE = "2026-09-10"

# (role, 中文名, 是否 ★, 存在性判据, 候选相对路径)
# 存在性判据：file=必须是文件 / dir=必须是目录 / any=文件或目录 / glob=通配命中任一
_TIER_ITEMS = {
    "L0": [
        ("entry", "入口", True, "file", list(ENTRY_CANDIDATES)),
        ("acceptance", "验收", True, "any", ["ACCEPTANCE.md", "docs/product/acceptance"]),
        ("status", "状态", True, "any", list(STATUS_CANDIDATES)),
        ("playbook", "方法与坑", False, "any", ["PLAYBOOK.md", "docs/knowledge/PLAYBOOK.md"]),
        ("failures", "失败清单", False, "any", ["FAILURES.md", "docs/knowledge/FAILURES.md"]),
    ],
    "L1": [
        ("work_current", "实时状态源", False, "any", ["work/current.md", DEFAULT_WORK_ROOT]),
        ("handoff", "会话交接", False, "any", list(HANDOFF_CANDIDATES)),
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

# 日期字段名的缺省与解析在 stdlib.date_fields_of（与 freshness 共用）。
# 状态字段名取自 stdlib.STATUS_FIELDS（01 §3.5：draft | active | superseded | retired，
# 中文文档写「状态：进行中」同样算）。此前这里是英文单值 "status"，与 freshness/evidence
# 手上的三词表不一致，对本仓 PROJECT_STATUS.md 产出过一条假 FAIL。
_META_HEAD_LINES = 40                   # 元信息在"头部"，只看头部若干行


def _norm(p):
    return str(p).replace("\\", "/").strip().rstrip("/")


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


# --------------------------------------------------------------------------

def scope(cfg):
    tier = cfg_get(cfg, "tier")
    docs_root, dnote = docs_root_of(cfg)
    entries, guessed = entry_files(cfg)
    fields, used_default = date_fields_of(cfg)
    return {
        "covered": [
            "按 project.yaml 的 tier（当前 %s）查该档要求的工件在不在" % (tier or "未声明"),
            "只在项目根、入口（%s）与 layout.docs_root（%s）下解析工件路径"
            % ((", ".join(entries) or "没找到") + ("，按候选" if guessed else ""),
               _norm(docs_root) + ("，默认" if dnote else "")),
            "只对 acceptance / status 两角色的 markdown 工件查 01 §3.5 的头部元信息："
            "日期字段 %s 与状态字段 %s"
            % ("/".join(fields) + ("（默认值）" if used_default else ""),
               "/".join(STATUS_FIELDS)),
        ],
        "not_covered": [
            "不判断文档内容对不对——那不是机械可判定的（契约 §7）",
            "不判断某个工件该不该存在：裁剪是人的决定，只看它有没有在 tailoring 里登记",
            "不扫全仓：只看 layout.entry 与 layout.docs_root 下的候选路径，别处同名文件看不见",
            "★ 工件未在 layout.artifacts 里声明落点时，候选路径只当提示用：未命中记未定，"
            "不记 FAIL——候选来自模板快照，落空只说明工具没在它猜的地方找到（契约 §1/§7）",
            "分档清单是 %s 于 %s 的快照，源文件改了这里不会自动变；两边不一致时以源文件为准"
            % (_TEMPLATE_SOURCE, _SNAPSHOT_DATE),
            "只看元信息字段在不在，不看它的值对不对、日期是不是已经过期",
            "目录型工件不逐份判其下文档的元信息",
            "不判其余角色（入口、方法与坑、实时状态源、会话交接等）的头部元信息——01 §3.5 点名的是"
            "验收、架构、模块、契约、ADR、runbook 六类；它们过期怎么被发现按 01 §3.2 各自那一列"
            "（入口看行数超预算、方法与坑看条目只增不减、工作项看状态超期无转换），不由本检查器判",
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

    docs_root = _norm(docs_root_of(cfg)[0])
    overrides = cfg_get(cfg, "layout.artifacts") or {}
    if not isinstance(overrides, dict):
        overrides = {}
    date_fields, used_default_fields = date_fields_of(cfg)

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

        # 入口与 entry-budget 同一种读法（stdlib.entry_files）：声明优先，未声明取候选里存在的那个。
        # 候选全不在时落到下面的通用分支，记 ★ 未定一次（entry-budget 那边记不适用）。
        entries, guessed = entry_files(cfg) if role == "entry" else ([], "")
        if entries:
            for rel in entries:
                rel = _norm(rel)
                if _exists(root, rel, "file"):
                    out.append(finding(
                        NAME, PASS, "入口 %s 在" % rel, where=rel,
                        evidence=guessed or "来自项目声明（layout.entry／layout.artifacts.entry）",
                    ))
                    md_to_check.append((role, label, rel))
                else:
                    out.append(finding(
                        NAME, FAIL, "★ 入口缺失：%s" % rel, where=rel,
                        why="01 §3.1：入口、验收、状态是最小起点（★）；01 §3.2 入口每次整份加载，"
                            "缺了默认加载合同就不成立",
                        evidence="来自项目声明（layout.entry／layout.artifacts.entry），%s 下没有"
                                 % os.path.abspath(root),
                    ))
            continue

        override, src_key = overrides.get(role), "layout.artifacts.%s" % role
        if not override and role == "work_current" and cfg_get(cfg, "layout.work_root"):
            override, src_key = cfg_get(cfg, "layout.work_root"), "layout.work_root"
        cand_list = [_norm(override)] if override else [
            rebase_docs(c, docs_root) for c in cands
        ]
        hit = None
        for rel in cand_list:
            if _exists(root, rel, kind):
                hit = rel
                break

        src = src_key if override else \
              "%s 快照候选：%s" % (_TEMPLATE_SOURCE, "、".join(cand_list))

        if hit is None:
            if star and override:
                # 项目自己声明了它在哪，那条路径上没有东西 —— 这是确定的缺失。
                out.append(finding(
                    NAME, FAIL, "★ %s 类工件缺失（%s）" % (label, role),
                    where=cand_list[0],
                    why="01 §3.1：入口、验收、状态是最小起点（★），少一件这套管理就没有落点",
                    evidence="项目在 %s 声明了它，该路径下没有。%s" % (src_key, src),
                ))
            elif star:
                # 未声明 + 候选未命中。候选路径只是本工具从模板抄来的一份猜测，
                # 用它落空推不出"这个仓真的没有验收/状态工件"——它可能就在别的名字下。
                # 契约 §1/§7：判据靠猜测得出的结论只能是 PASS 或 UNDETERMINED。
                out.append(finding(
                    NAME, UNDETERMINED, "★ %s 类工件没找到（%s）" % (label, role),
                    where=cand_list[0],
                    reason="项目未在 layout.artifacts.%s 里声明它在哪，工具只按快照候选路径找过；"
                           "候选落空不等于该工件不存在" % role,
                    why="01 §3.1：入口、验收、状态是最小起点（★）。要把它判成缺失，"
                        "先在 layout.artifacts 里声明落点——声明后仍然没有才记 FAIL",
                    evidence="候选都不存在。%s" % src,
                ))
            elif src_key == "layout.work_root":
                # 路径是项目声明的，不是工具猜的；它不在就说它不在，不往"可能是有意裁剪"上推。
                out.append(finding(
                    NAME, UNDETERMINED,
                    "%s 档要求的 %s（%s）：layout.work_root 声明的目录不在" % (tier, label, role),
                    where=cand_list[0],
                    reason="layout.work_root 声明的目录 %s 不在；是还没建还是配置过期，本工具判不了"
                           % cand_list[0],
                    why="01 §3.1：%s 档的树里有这一项；工作项目录是它的目录形态" % tier,
                    evidence="未声明 layout.artifacts.work_current，取 layout.work_root：%s"
                             % cand_list[0],
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

    # 01 §3.5 只点名验收等六类，§3.2 给 entry/playbook/work 的过期发现方式都不是元信息头；其余角色不判
    for role, label, rel in md_to_check:
        if role not in ("acceptance", "status"):
            continue
        path = os.path.join(root, rel.replace("/", os.sep))
        try:
            head = _head(path)
        except OSError as exc:
            out.append(undetermined_from_exception(NAME, exc, "读 %s 的头部" % rel))
            continue
        missing = []
        if not any(_has_field(head, f) for f in date_fields):
            missing.append("日期字段（%s）" % "/".join(date_fields))
        if not any(_has_field(head, f) for f in STATUS_FIELDS):
            missing.append("状态字段（%s）" % "/".join(STATUS_FIELDS))
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
    """反例两条（工件缺失、元信息缺失）、探测一条、正例一条。见契约 §3：抓不出违规的检查器，其结论作废。"""
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
                "layout": {"entry": ["CONTEXT.md"], "docs_root": "docs",
                           "artifacts": {"status": "WORK.md"}},
            }
            # 同一个仓，但没在 layout.artifacts 里声明状态工件在哪
            cfg_undeclared = {
                "_root": tmp,
                "tier": "L0",
                "layout": {"entry": ["CONTEXT.md"], "docs_root": "docs"},
            }

            # 正例：L0 五件齐、元信息齐 → 全 PASS
            got_ok = [f["status"] for f in run(cfg)]

            # 反例二：声明了状态工件在 WORK.md，文件在但头部元信息被抽掉 → 必须有 FAIL。
            # 元信息判定只对 acceptance / status 两角色执行，不声明这两角色的项目上它一条都不跑，
            # 这条反例是它还活着的唯一证据（契约 §3）。
            w("WORK.md", "# 标题\n")
            res_nometa = run(cfg)
            got_nometa = [f["status"] for f in res_nometa]
            nometa_fail = [f["title"] for f in res_nometa
                           if f["status"] == FAIL and "头部缺元信息" in f["title"]]

            # 反例一：声明了状态工件在 WORK.md，删掉它 → 必须有 FAIL
            os.remove(os.path.join(tmp, "WORK.md"))
            got_bad = [f["status"] for f in run(cfg)]

            # 探测：同样缺 WORK.md，但项目没声明落点 → 只许未定，不许 FAIL。
            # 候选路径是本工具从模板抄来的猜测，落空推不出"该仓没有状态工件"。
            res_und = run(cfg_undeclared)
            got_und = [f["status"] for f in res_und]
            star_und = [f for f in res_und
                        if f["status"] == UNDETERMINED and f["title"].startswith("★ ")]

            results.append(finding(
                NAME, PASS if FAIL in got_bad else FAIL,
                "反例：layout.artifacts 声明了 ★ 状态工件却不存在，应判 FAIL",
                evidence="实得 %s" % got_bad,
                why="契约 §3 静默失效探测；判据 01 §3.1 的 ★ 三类",
            ))
            results.append(finding(
                NAME, PASS if nometa_fail else FAIL,
                "反例：声明的 ★ 状态工件缺头部元信息，应判 FAIL",
                evidence="实得 %s；元信息 FAIL %s" % (got_nometa, nometa_fail),
                why="01 §3.5 要求重要文档头部带 status 与 updated_at；契约 §3 静默失效探测",
            ))
            results.append(finding(
                NAME, PASS if (FAIL not in got_und and star_und) else FAIL,
                "探测：★ 工件未声明落点且候选未命中，应判未定、不得判 FAIL",
                evidence="实得 %s；★ 未定 %d 条" % (got_und, len(star_und)),
                why="契约 §1/§7：判据靠猜测（这里是模板快照的候选路径）得出的结论"
                    "只能是 PASS 或 UNDETERMINED",
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
