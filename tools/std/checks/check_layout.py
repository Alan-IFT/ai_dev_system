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
import sys
import tempfile
import time

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 放末尾：不遮住标准库

from stdlib import (  # noqa: E402
    read_text, MAX_READ_BYTES, DEFAULT_WORK_ROOT, ACCEPTANCE_CANDIDATES, ENTRY_CANDIDATES, artifact_tailored, FAIL, HANDOFF_CANDIDATES, PASS, SKIP, STATUS_CANDIDATES,
    STATUS_FIELDS, UNDETERMINED, cfg_get, date_fields_of, docs_root_of, entry_files, find_field, finding,
    inside, rebase_docs, undetermined_from_exception, unreadable,
    run_guarded, probe,
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
        ("acceptance", "验收", True, "any", list(ACCEPTANCE_CANDIDATES)),
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
    """工件在不在：True / False，真实位置在项目之外返回 None（不探测项目之外，调用方记未定；C16）。"""
    path = os.path.join(root, rel.replace("/", os.sep))
    if kind == "glob":   # 只有候选部分是通配；扫描根里的 [ ] * ? 按字面（C14）
        return any(inside(root, p) for p in _glob.glob(os.path.join(_glob.escape(root), rel.replace("/", os.sep))))
    if not inside(root, path):
        return None
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


def _outside(rel, label):
    """工件路径的真实位置在项目之外（符号链接出仓）：不读、不探测，记未定。entry-budget 对同一件记 SKIP。"""
    return finding(
        NAME, UNDETERMINED, "%s %s 的真实位置在被扫项目之外" % (label, rel), where=rel,
        kind="outside-root", key=rel,
        reason="它是指向项目之外的符号链接；本工具不读、不探测项目之外的路径，换一台机器它是否存在也不由本仓决定",
        why="01 §3.1：工件要在项目里；契约 §5 只读被扫项目之内的文件",
    )


def _head(path, root):
    return "".join(read_text(path, root, head=MAX_READ_BYTES).splitlines(True)[:_META_HEAD_LINES])


def _has_field(head, field):
    """头部有没有 `field:`。解析与 freshness 同一套（stdlib.find_field）：行首、列表项、加粗、
    同一行用全角空格或竖线并排的写法都认——此前这里只认行首，示例项目同行写法被 layout 判缺、
    freshness 却读得出，同一份头部两种读法。"""
    return find_field(head, [field])[0] is not None


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
    return run_guarded(NAME, _run, cfg)


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

    # 声明了工作项目录却不在：项目声明的落点不成立，任何档都判 FAIL（契约 §1.1；C09）。
    # evidence／freshness／drift 对同一件记 SKIP 指向这里；L1 的 work_current 取它时不再另报
    wr = _norm(cfg_get(cfg, "layout.work_root") or "")
    wr_there = _exists(root, wr, "dir") if wr else True
    if wr_there is None:
        out.append(_outside(wr, "工作项目录"))
    elif not wr_there:
        out.append(finding(
            NAME, FAIL, "layout.work_root 声明的工作项目录不在：%s" % wr, where=wr,
            kind="work-root-absent", key=wr,
            why="01 §3.1：工作项一件一文件放在工作项目录；项目声明了它在哪，那里没有就是确定的缺失",
            evidence="project.yaml 的 layout.work_root = %s，%s 下没有这个目录" % (wr, os.path.abspath(root)),
        ))

    for role, label, star, kind, cands in _tier_items(tier):
        skipped, sreason = artifact_tailored(cfg, role)
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
                there = _exists(root, rel, "file")
                if there is None:
                    out.append(_outside(rel, label))
                elif there:
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
        if role == "work_current" and wr and not wr_there and _norm(override or wr) == wr:
            continue      # 落点就是上面已报的工作项目录（声明的 work_current 与 work_root 同指也算，R2-4）
        if not override and role == "work_current" and wr:
            override, src_key = wr, "layout.work_root"
        cand_list = [_norm(override)] if override else [
            rebase_docs(c, docs_root) for c in cands
        ]
        hit = outside = None
        for rel in cand_list:
            there = _exists(root, rel, kind)
            if there:
                hit = rel
                break
            outside = outside or (rel if there is None else None)
        if hit is None and outside:
            out.append(_outside(outside, label))
            continue

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
        elif role in ("acceptance", "status") and os.path.isdir(os.path.join(root, hit.replace("/", os.sep))) \
                and not any(f["where"] == hit and f["status"] == SKIP for f in out):   # 只报判元信息的两类、同一目录一次（R2-6）
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
            head = _head(path, root)
        except OSError as exc:
            out.append(unreadable(NAME, rel, exc))
            continue
        # 字段名只有项目在 metadata_fields 里声明过的才算「确定没有」；工具词表（状态字段、
        # 默认日期字段名）没找到只说明不在工具猜的写法里，按契约 §1.1 记未定
        missing, guessed = [], []
        if not any(_has_field(head, f) for f in date_fields):
            (guessed if used_default_fields else missing).append("日期字段（%s）" % "/".join(date_fields))
        if not any(_has_field(head, f) for f in STATUS_FIELDS):
            guessed.append("状态字段（%s）" % "/".join(STATUS_FIELDS))
        if guessed and not missing:
            out.append(finding(
                NAME, UNDETERMINED, "%s 头部没认出元信息：%s" % (rel, "、".join(guessed)),
                where="%s:1" % rel, kind="meta-unrecognized", key=rel,
                reason="字段名是本工具的词表（状态字段）或未校准的默认（日期字段），不是项目的声明；"
                       "没认出推不出没写（契约 §1.1）。日期字段名在 metadata_fields 里声明之后仍缺才判 FAIL",
                why="01 §3.5 要求重要文档头部带 status 与 updated_at",
                evidence="只看前 %d 行。%s" % (_META_HEAD_LINES, note),
            ))
        elif missing:
            missing += guessed
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
            # 日期字段名须经 metadata_fields 声明，缺了才是确定违规（契约 §1.1）
            w("WORK.md", "# 标题\n")
            res_nometa = run(dict(cfg, metadata_fields=["updated_at"]))
            got_nometa = [f["status"] for f in res_nometa]
            nometa_fail = [f["title"] for f in res_nometa
                           if f["status"] == FAIL and "头部缺元信息" in f["title"]]
            # 同一样本不声明 metadata_fields：两个字段名都是工具词表，没认出只记未定
            res_guess = [(f["status"], f["id"]) for f in run(cfg) if f["status"] != PASS]
            # 同一行用全角空格并排的写法（示例项目的形态）与 freshness 同一套解析，须认得出
            w("WORK.md", "# 标题\n\n状态：进行中　updated_at：2026-09-10\n")
            res_inline = [(f["status"], f["title"]) for f in run(cfg) if f["status"] != PASS]
            results.append(probe(
                NAME, (res_guess == [(UNDETERMINED, "layout/meta-unrecognized/WORK.md")]
                       and not res_inline),
                "约定：未声明 metadata_fields 时缺元信息只记未定；同行并排的字段须认得出",
                evidence="未声明时非通过项 %s；同行写法非通过项 %s" % (res_guess, res_inline),
                why="契约 §1.1：字段名词表落空推不出没写；layout 与 freshness 共用 stdlib.find_field",
            ))

            # 反例一：声明了状态工件在 WORK.md，删掉它 → 必须有 FAIL
            os.remove(os.path.join(tmp, "WORK.md"))
            got_bad = [f["status"] for f in run(cfg)]

            # 探测：同样缺 WORK.md，但项目没声明落点 → 只许未定，不许 FAIL。
            # 候选路径是本工具从模板抄来的猜测，落空推不出"该仓没有状态工件"。
            res_und = run(cfg_undeclared)
            got_und = [f["status"] for f in res_und]
            star_und = [f for f in res_und
                        if f["status"] == UNDETERMINED and f["title"].startswith("★ ")]

            results.append(probe(NAME, FAIL in got_bad,
                "反例：layout.artifacts 声明了 ★ 状态工件却不存在，应判 FAIL",
                evidence="实得 %s" % got_bad,
                why="契约 §3 静默失效探测；判据 01 §3.1 的 ★ 三类",
            ))
            results.append(probe(NAME, nometa_fail,
                "反例：声明的 ★ 状态工件缺头部元信息，应判 FAIL",
                evidence="实得 %s；元信息 FAIL %s" % (got_nometa, nometa_fail),
                why="01 §3.5 要求重要文档头部带 status 与 updated_at；契约 §3 静默失效探测",
            ))
            results.append(probe(NAME, (FAIL not in got_und and star_und),
                "探测：★ 工件未声明落点且候选未命中，应判未定、不得判 FAIL",
                evidence="实得 %s；★ 未定 %d 条" % (got_und, len(star_und)),
                why="契约 §1/§7：判据靠猜测（这里是模板快照的候选路径）得出的结论"
                    "只能是 PASS 或 UNDETERMINED",
            ))
            results.append(probe(NAME, (got_ok and set(got_ok) == {PASS}),
                "正例：L0 五件齐且元信息齐应全判 PASS",
                evidence="实得 %s" % got_ok,
                why="契约 §3 静默失效探测",
            ))
        # C16：入口与状态工件是指向项目之外的符号链接——不当作在（旧写法跟随链接判 PASS），也不判缺失，
        # 记未定且不读；entry-budget 对入口记 SKIP，同一件事只报一次
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as out_dir:
            for name in ("AGENTS.md", "WORK.md"):
                with io.open(os.path.join(out_dir, name), "w", encoding="utf-8") as fh:
                    fh.write(meta)
                os.symlink(os.path.join(out_dir, name), os.path.join(tmp, name))
            res = run({"_root": tmp, "tier": "L0", "layout": {"entry": ["AGENTS.md"]}})
            got = sorted(f["id"] for f in res if f["status"] != UNDETERMINED or "outside" in f["id"])
            want = ["layout/outside-root/AGENTS.md", "layout/outside-root/WORK.md"]
        results.append(probe(NAME, got == want,
            "C16：入口与状态工件链到项目之外记未定，不判在、不判缺",
            evidence="实得 %s；应得 %s" % (got, want),
            why="契约 §5：只读被扫项目之内的文件；§1 同一事实只报一次",
        ))
        # C09：声明了 layout.work_root 而目录不在，L0、L1、以及另行声明了 work_current 时都只报一条 FAIL
        with tempfile.TemporaryDirectory() as tmp:
            got = []
            for tier, art in (("L0", {}), ("L1", {}), ("L1", {"work_current": "ACCEPTANCE.md"}),
                              ("L1", {"work_current": "nope/"})):   # 与 work_root 同指（R2-4）
                res = run({"_root": tmp, "tier": tier, "layout": {"work_root": "nope", "artifacts": art}})
                got.append([(f["status"], f["id"]) for f in res if "nope" in (f.get("where") or "")])
        want = [[(FAIL, "layout/work-root-absent/nope")]] * 4
        results.append(probe(NAME, got == want,
            "C09：声明的工作项目录不在，任何档都由 layout 报且只报一条 FAIL",
            evidence="实得 %s" % (got,), why="契约 §1.1 声明后仍不成立判 FAIL；§1 同一事实只报一次",
        ))

        # R2-6：同一目录兼作 status、acceptance、handoff、work_current 时，「是目录」SKIP 只出一条
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "w"))
            io.open(os.path.join(tmp, "AGENTS.md"), "w", encoding="utf-8").close()
            art = {r: "w" for r in ("status", "acceptance", "handoff", "work_current")}
            got = [f["id"] for f in run({"_root": tmp, "tier": "L1", "layout": {"entry": ["AGENTS.md"], "artifacts": art}})
                   if f["status"] == SKIP]
        results.append(probe(NAME, len(got) == 1,
            "R2-6：同一目录兼作几类工件时「是目录，不逐份判元信息」只出一条",
            evidence="实得 %s" % (got,), why="契约 §1 同一事实只报一次",
        ))

        # R2-11 R1-01 R1-05：find_field 线性（满行 `*` 曾 20 万字符 138 秒）；常见写法结果不变；
        # 第一次出现的字段值为空即缺字段，不跳到后文同名字段；冒号后全角空格照读
        t0 = time.time()
        for line in ("*" * 200000, "**" * 40000):
            find_field(line, ["status"])
        took = time.time() - t0
        samples = [("**status**: done", "status"), ("- status: done", "status"), ("> status: done", "status"),
                   ("`status`: done", "status"), ("build-status: passing", "status"), ("| status: done |", "status"),
                   ("状态：进行中　updated_at：2026-09-10", "updated_at"), ("*状态*：done", "状态"),
                   ("状态：\n\n## 历史\n- 09-01 状态：done\n", "状态"), ("状态：　done", "状态")]
        got = [find_field(t, [n])[0] for t, n in samples]
        want = ["done", "done", "done", "done", None, "done", "2026-09-10", "done", None, "done"]
        results.append(probe(NAME, got == want and took < 2,
            "find_field：满行 * 线性；常见写法照认；首个同名字段为空即缺；全角空格照跳",
            evidence="实得 %s，耗时 %.2fs" % (got, took), why="一份文件不许拖死整次检查；契约 §5 空值与不写同义",
        ))

        # C14：扫描根路径里带 [ ] 时，项目侧检查器的通配候选照样找得到
        with tempfile.TemporaryDirectory(prefix="a[b]") as tmp:
            os.makedirs(os.path.join(tmp, "tools"))
            io.open(os.path.join(tmp, "tools", "check_x.py"), "w", encoding="utf-8").close()
            got = [f["status"] for f in run({"_root": tmp, "tier": "L2"}) if "（checkers）" in f["title"]]
        results.append(probe(NAME, got == [PASS],
            "C14：扫描根带 [ ] 时 glob 候选按字面拼根，tools/check_x.py 判在",
            evidence="实得 %s" % got, why="01 §3.1：L2 的项目侧检查器；候选命中就是看见的事实",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(undetermined_from_exception(NAME, exc, "跑自检"))
    return results
