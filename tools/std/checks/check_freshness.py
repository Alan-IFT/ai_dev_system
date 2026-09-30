# -*- coding: utf-8 -*-
"""文档新鲜度与工作项活性巡检。

执行 01 §3.5（重要文档头部带 `updated_at` 等元信息）与 01 §4.1（活性：任一未终结
状态停留超过约定复查时间即触发核实）。契约见 ../CONTRACT.md。只用标准库。

三态取向（01 §2 N1）：
- 文档久未更新记 **未定**，不记失败——久未更新可能只是内容稳定，是否过期要人看。
- 文档没有日期字段：项目在 metadata_required 与 metadata_fields 里都声明了（哪些文档要带、字段叫什么）
  才记 **失败**——01 §3.2 要求说清"它过期了怎么被发现"，没有日期就发现不了；任一处靠工具约定都只记未定（契约 §1.1）。
- 进行中工作项长期无状态转换记 **失败**，但标题写"需核实"：01 §4.1 说的是超龄触发核实，
  不是自动判违规，处置由负责人定（补进度、转 blocked 或拆分）。
- metadata_required 命中的文档头部没认出状态字段记 **未定**（字段名是工具词表，契约 §1.1）。防的是文件名写着
  「暂缓」、正文已翻盘、头部无状态，读者分不出它现行与否（D-131）；删除条件：采用项目连续一季度复审零命中，
  且 01 §3.5 的状态要求被移出或合并。
"""
from __future__ import annotations

import datetime
import os
import re
import subprocess
import sys
import tempfile

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 放末尾：不遮住标准库

from stdlib import (  # noqa: E402
    is_work_item_name, work_items, shallow_problem, FAIL, HEAD_CHARS, PASS, SKIP, UNDETERMINED,
    ACCEPTANCE_CANDIDATES, STATUS_CANDIDATES, STATUS_FIELDS, rebase_docs, artifact_tailored, is_tailored_out,
    agg, cfg_get, clean, date_fields_of, docs_root_of, find_field, finding, git_track, in_frozen,
    item_status, markdown_under, norm_rel, note_default, parse_date, parse_yaml_subset,
    read_text, status_kind, under, unreadable, once, work_root, work_root_absent, write_text,
    run_guarded, probe, load_config, metadata_required_hit,
)

NAME = "freshness"
STANDARD_REFS = ["01 §2 N1", "01 §3.2", "01 §3.5", "01 §4.1"]

_DEFAULT_STALE_DAYS = 90              # 标准正文未给文档新鲜度默认值，本工具取 90 天作起步参数
_DEFAULT_WORK_ITEM_STALE_DAYS = 14    # 01 §4.1 的 in_progress 复查参数默认 5 天，本工具放宽到 14

# 01 §3.5 的元信息要求是一个封闭清单：验收、架构、模块、契约、ADR、runbook。
# 索引页、README、PLAYBOOK 不在其列——§3.2 那张表说 INDEX.md 过期是靠链接检查发现的。
# 按目录名约定识别；项目可用 metadata_required 覆盖（路径前缀，相对仓库根）。
_IMPORTANT_DIRS = frozenset((
    "acceptance", "architecture", "modules", "contracts", "decisions", "runbooks",
))


def _metadata_requirement(cfg, rel):
    """该文档属不属于 01 §3.5 要求带元信息的那一类。

    返回三值，**不再返回硬布尔**：

    - `"required"`   —— 项目配置 `metadata_required` 命中（项目声明，缺日期可判 FAIL）；
    - `"convention"` —— 项目没配，路径里出现约定的目录名。约定命中只说明"像"，不是项目声明，
      缺日期按契约 §1.1 只记未定；
    - `"not_required"` —— 项目配了 `metadata_required` 而本文件不在清单内（含被 `!` 排除的）。
      这是**项目自己的声明**，是确定结论，可以记 SKIP；
    - `"declared_none"` —— 项目把 `metadata_required` 显式写成空列表 `[]`：声明
      本项目没有 01 §3.5 那六类文档。同是项目声明，调用方整轮聚成一条 SKIP；
      与"键缺失"（没声明）必须分开——后者才落到 `"unknown"`；
    - `"unknown"`    —— 项目没配，目录名约定也没命中。
      "这份文档算不算 01 §3.5 的六类"要看内容，不是机械可判定的（契约 §7），
      所以**不能**记成 SKIP（"不适用"是确定结论），按 01 §2 N1 记未定。

    这条改动的由来：RCMS 的 runbook 放在 `docs/ops/`，本仓的文档树是中文名
    （`docs/架构图`、`docs/审计记录`），两处的目录名约定命中率分别是 0/9 与 0/35。
    原实现把 100% 的未命中输出成 SKIP「不要求元信息」——那是在拿"我没看"冒充"不适用"。
    """
    hit = metadata_required_hit(cfg, rel)     # 包含／`!` 排除只在 stdlib 一处判（D-133）
    if hit is not None:
        return "required" if hit else ("not_required" if cfg_get(cfg, "metadata_required") else "declared_none")
    parts = [p for p in str(rel).replace("\\", "/").split("/") if p]
    if any(seg in _IMPORTANT_DIRS for seg in parts[:-1]):
        return "convention"
    return "unknown"



# 状态字段词表已并进 stdlib.STATUS_FIELDS（01 §1 G2：同一事实一处权威）。
_TRANSITION_FIELDS = ("last_transition_at", "state_changed_at", "最后状态转换时间", "状态更新时间")
_TRANSITION_HEADINGS = ("状态转换记录", "状态转换", "转换记录", "transition")


# --------------------------------------------------------------------------
# 小工具（工作项扫描共用的几件在 stdlib）
# --------------------------------------------------------------------------

def _section_body(text, keywords):
    """取标题含关键词的那一节正文（到下一个标题为止）。找不到返回 None。"""
    lines = text.splitlines()
    start = None
    for i, ln in enumerate(lines):
        if not ln.lstrip().startswith("#"):
            continue
        title = ln.lstrip("#").strip().lower()
        if any(str(k).lower() in title for k in keywords):
            start = i + 1
            break
    if start is None:
        return None
    out = []
    for ln in lines[start:]:
        if ln.lstrip().startswith("#"):
            break
        out.append(ln)
    return "\n".join(out)


def _git_commit_date(root, rel, memo):
    """该文件最后一次提交的时间。返回 (date, None) 或 (None, 原因)。
    memo 是一次扫描共用的空列表：浅克隆只探测一次，不每份工作项起一个子进程（C22）。"""
    if not memo:
        memo.append(shallow_problem(root))
    if memo[0]:
        return None, memo[0]
    cmd = ["git", "--literal-pathspecs", "-C", root, "log", "-1", "--format=%cI", "--", rel]   # 路径按字面（C02）
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=60)
    except (OSError, subprocess.SubprocessError) as exc:
        return None, "跑不了 git log：%s" % exc
    if out.returncode != 0:
        return None, "git log 退出码 %d：%s" % (out.returncode, (out.stderr or "").strip()[:200])
    s = (out.stdout or "").strip()
    if not s:
        return None, "git log 无输出：该文件没有提交历史"
    return parse_date(s)


def _last_transition(text):
    """最后一次状态转换时间。

    成功返回 (date, 说明, None)；失败返回 (None, None, (类别, 原因))，
    类别 'absent' 表示文件里根本没写，可以退到提交时间；'bad' 表示写了但解析不了，
    按 01 §2 N1 记未定，不退到提交时间去猜。
    """
    val, name = find_field(text, _TRANSITION_FIELDS)
    if val:
        d, err = parse_date(val)
        if d:
            return d, "取自显式字段 %s = %s" % (name, clean(val)), None
        return None, None, ("bad", "字段 %s 的值解析不了（%s）" % (name, err))

    block = _section_body(text, _TRANSITION_HEADINGS)
    if block is None:
        return None, None, ("absent", "文件里没有状态转换记录小节，也没有显式转换时间字段")

    # 取最后一条记录（表格行或列表项）里的第一个日期（C10）。不取全节最大值——小节里的备注、
    # 计划日期会把停滞的工作项洗成活着；记录是按发生顺序追加的，最后一条就是最后一次转换。
    # 只认小节里第一段连续的记录行：其后的空行、备注列表、第二张表都不算（R2-3）
    last, started = None, False
    for ln in block.splitlines():
        if not re.match(r"\s*(?:\||[-*+]\s)", ln):
            if started:
                break
            continue
        started = True
        for token in re.findall(r"\d{4}-\d{2}-\d{2}", ln):
            d, _err = parse_date(token)
            if d:
                last = d
                break
    if last is None:
        # 有小节却找不到一条带日期的记录：不退到提交时间去猜（01 §2 N1）
        return None, None, ("bad", "状态转换记录小节里找不到带日期的记录行（表格行或列表项）")
    return last, "取自状态转换记录的最后一条（%s）" % last.isoformat(), None


def _age(today, d):
    """距基准日几天。晚一天按当天算（C18）：基准日取运行环境本地日期，记录日期按作者时区写，
    UTC 的机器上读 UTC+8 当天写的日期就是「明天」；晚两天以上才记未定。"""
    age = (today - d).days
    return 0 if age == -1 else age


def _int_budget(cfg, path, default):
    raw = cfg_get(cfg, path)
    if raw is None:
        return default, True, None
    if isinstance(raw, bool) or not isinstance(raw, int) or raw <= 0:
        return None, False, "%s = %r，不是正整数" % (path, raw)
    return raw, False, None


def _note(used_default, name, value):
    if used_default:
        return "%s 用的是本工具默认值 %s，项目未校准（契约 §5）" % (name, value)
    return "%s = %s，取自 project.yaml" % (name, value)


# --------------------------------------------------------------------------
# 契约接口
# --------------------------------------------------------------------------

def _doc_files(cfg, root):
    """文档巡检的扫描面：docs_root 与 metadata_required 各包含前缀下（减去 ! 排除的）git 跟踪的 *.md 的并集。

    只扫 docs_root 时，项目声明在文档根之外的前缀（根下的 ACCEPTANCE.md、L1 的 work/）一条结论都不出，
    而契约 §5 说 metadata_required「给了就只认它」——声明了要查却静默不查（D-131）。
    并集的后一半由 _metadata_requirement 一处判定；`.`、`./`、空与 `/`、`..` 起头的元素在读配置时整份拒收
    （stdlib._bad_metadata_required），到不了这里。
    """
    files, problem = markdown_under(root, "")
    if problem:
        return None, problem
    docs_root = docs_root_of(cfg)[0]
    return [r for r in files if under(r, docs_root) or _metadata_requirement(cfg, r) == "required"], None


def _layout_meta_files(cfg, root):
    """layout 已查头部元信息的两件 ★ 工件（验收、状态；落点是单份 .md 时）。

    取落点与 layout 同一规则：声明了取声明，没声明取候选里第一个存在的。它们缺日期、缺状态字段由 layout 报
    （`layout/meta-unrecognized` 或「头部缺元信息」），这里不重报（契约 §1 同一事实只报一次）。
    layout 整个被裁、或该工件在 tailoring 里登记为不适用时 layout 不查，这里照报。
    """
    if is_tailored_out(cfg, "layout")[0]:
        return set()
    arts = cfg_get(cfg, "layout.artifacts") or {}
    arts = arts if isinstance(arts, dict) else {}
    out = set()
    for role, cands in (("acceptance", ACCEPTANCE_CANDIDATES), ("status", STATUS_CANDIDATES)):
        if artifact_tailored(cfg, role)[0]:
            continue
        paths = [arts[role]] if arts.get(role) else [rebase_docs(c, docs_root_of(cfg)[0]) for c in cands]
        for p in paths:
            p = norm_rel(p).strip("/")
            full = os.path.join(root, p)
            if os.path.exists(full):
                if os.path.isfile(full) and p.lower().endswith(".md"):
                    out.add(p)
                break
    return out


def _classify_stats(cfg):
    """本次扫描面（docs_root 与 metadata_required 包含前缀，减去 ! 排除的）下各分类各有几份。纯按路径算，不读文件内容。

    只为把覆盖边界说准：契约 §2 要求写明"没检查什么"，而"有多少份文档根本没被分类"
    正是这个检查器最大的盲区——它此前一个字都没写。取不到时返回 None，不猜。
    """
    root = cfg.get("_root") or "."
    try:
        files, problem = _doc_files(cfg, root)
    except Exception:  # noqa: BLE001  覆盖边界不该把主流程带崩
        return None
    if problem or files is None:
        return None
    stats = {"required": 0, "not_required": 0, "unknown": 0, "frozen": 0}
    for rel in files:
        if in_frozen(cfg, rel):
            stats["frozen"] += 1
            continue
        need = _metadata_requirement(cfg, rel)
        # 同是项目声明不需要；约定命中计入"需要"（统计只为说准覆盖边界）
        stats[{"declared_none": "not_required", "convention": "required"}.get(need, need)] += 1
    stats["scanned"] = stats["required"] + stats["not_required"] + stats["unknown"]
    return stats


def scope(cfg):
    docs_root, dnote = docs_root_of(cfg)
    stats = _classify_stats(cfg)
    if stats is None:
        cls = ("本次未能统计分类结果（列不出 git 跟踪的文档）")
    else:
        cls = ("本次参与分类的 %d 份文档里（另有归档区 %d 份不参与），判定为需要元信息 %d 份、"
               "项目声明不需要 %d 份、**未能分类 %d 份**"
               % (stats["scanned"], stats["frozen"], stats["required"],
                  stats["not_required"], stats["unknown"]))
    return {
        "covered": [
            "layout.docs_root（当前 %r%s）与 metadata_required 各包含前缀下（减去 ! 排除的）git 跟踪的 *.md：日期字段是否存在、"
            "是否可解析、距基准日是否超 budgets.stale_days" % (docs_root, "，默认" if dnote else ""),
            "layout.work_root（当前 %r）下状态为进行中的工作项：最后一次状态转换距基准日"
            "是否超 budgets.work_item_stale_days。最后一次转换取显式转换时间字段，否则取状态转换记录小节"
            "第一段连续记录行的最后一条，没有该小节才退到 git 提交时间（浅克隆记未定）" % work_root(cfg)[0],
            "metadata_required 命中的文档头部有没有状态字段（stdlib.STATUS_FIELDS）：没认出的汇成一条未定"
            "（freshness/no-status-field），不判取值是否在 01 §3.5 的四值里；layout 已查的验收、状态工件与"
            "工作项目录里的 WI-* 不在此列（各由 layout、freshness/no-status 报；layout 已查的两件缺日期也不重报，"
            "layout 被裁或该工件在 tailoring 里登记不适用时照报）",
            "日期晚基准日一天按当天算（基准日是运行环境本地日期，作者可能在更早的时区写当天日期），"
            "晚两天以上记未定",
        ],
        "not_covered": [
            "L0 合在状态工件（WORK.md 之类）里的工作项不扫：活性巡检只扫工作项目录，目录不在记 SKIP，"
            "目录在不在由 layout 报",
            "**不判断一份文档到底属不属于 01 §3.5 的六类**（验收、架构、模块、契约、ADR、"
            "runbook）。未配 metadata_required 时只按目录名约定（%s）识别，"
            "这是约定不是判定，会两头误：runbook 放在 docs/ops/ 认不出，中文目录树"
            "（docs/架构图、docs/审计记录）天然零命中；反过来叫 architecture 的目录里也可能"
            "放着别的东西。%s。未能分类的不逐份记不适用，整轮汇总成一条未定"
            % ("/".join(sorted(_IMPORTANT_DIRS)), cls),
            "不判断文档内容是否仍然正确，只判它的日期字段——内容对不对不是机械可判定的（契约 §7）",
            "不判断超期文档是否真的过期：超期只记未定，交人确认它是否仍然有效（01 §2 N1）",
            "不看归档区 layout.frozen 里的任何文件（01 §3.1：一次性对齐工件不承担更新义务）",
            "不看未被 git 跟踪的文件，不看 .md 以外的文件（.json、.yaml、.sh、代码注释都不看）",
            "只巡检进行中的工作项；planned / blocked / in_validation 的停滞不看——01 §4.1 里"
            "它们的复查时间是每项自己约定的值，工具读不到那个约定",
            "不核实工作项状态是否属实，只读它自己写的状态字段；状态认不出（不在 stdlib.WORK_ITEM_STATES "
            "的六态别名与 project.yaml 声明的词里）的记未定（freshness/unknown-state），不查活性；"
            "layout.artifacts 声明的工件状态不属六态时按文档认（stdlib.status_kind）：属 01 §3.5 文档四值的不巡检，"
            "两表都认不出的记 freshness/unknown-doc-state；未声明的文件写文档四值仍记 unknown-state",
            "状态转换记录只认小节里第一段连续的表格行或列表项，取最后一条里的第一个日期：按新的在上"
            "倒序写的记录会取到最旧那条（偏向报超龄）；记录行里不按列区分，occurred_at 空着而别的列写了"
            "日期时取到那个日期；只有表头、没有记录行的转换表记未定，不退到提交时间",
            "不判断谁该处置超龄工作项，也不代为转 blocked（01 §4.1：巡检只通知负责人核实）",
            "自检不覆盖 git 不可用的分支与自定义日期字段名（metadata_fields 写成 updated_at 以外的名字）"
            "的分支，它们的正确性未被反例证明",
        ],
    }


def run(cfg):
    return run_guarded(NAME, _run, cfg)


def _run(cfg):
    root = cfg.get("_root") or "."
    today = datetime.date.today()
    base = "比较基准日 %s（取自运行时系统日期）" % today.isoformat()

    out = []
    texts = {}   # 工作项目录在文档根之下时，文档巡检读过的工作项留给活性巡检，不读第二遍（C22）
    # 文档部分整组依赖 docs_root：取了默认就在这里统一注明，不在各条 finding 里逐个拼
    out.extend(note_default(_check_docs(cfg, root, today, base, texts), docs_root_of(cfg)[1]))
    out.extend(_check_work_items(cfg, root, today, base, texts))
    return once(out)            # 工作项在文档根下且读不了时，文档巡检与活性巡检只报一次（R1-10）


def _check_docs(cfg, root, today, base, texts):
    docs_root, dnote = docs_root_of(cfg)

    days, used_default, bad = _int_budget(cfg, "budgets.stale_days", _DEFAULT_STALE_DAYS)
    if bad:
        return [finding(NAME, UNDETERMINED, "文档新鲜度阈值不是正整数", reason=bad,
                        why="01 §3.5 的复核周期是参数，但必须是可比较的数")]
    note = _note(used_default, "budgets.stale_days", days)

    names, names_default = date_fields_of(cfg)
    fnote = ("日期字段名用的是默认 %s（未配 metadata_fields）" % ", ".join(names)
             if names_default else "日期字段名取自 metadata_fields：%s" % ", ".join(names))

    path = os.path.join(root, norm_rel(docs_root))
    if not os.path.isdir(path):
        return [finding(
            NAME, UNDETERMINED, "文档根目录不存在：%s" % docs_root, where=str(docs_root),
            reason="layout.docs_root 指向的目录不在；是配置过期还是目录被移走，本工具判不了"
            if not dnote else "未配 layout.docs_root，默认的文档根不在；文档放在别处就在 project.yaml 写明",
            why="01 §3.1：文档树是约定的位置，位置不成立则新鲜度无从判起",
        )]

    files, problem = _doc_files(cfg, root)
    if problem:
        return [finding(NAME, UNDETERMINED, "列不出 git 跟踪的文档", reason=problem,
                        why="契约 §1：依赖不可用记未定，不记通过")]
    if not files:
        return [finding(
            NAME, UNDETERMINED, "%s 下没有 git 跟踪的 markdown" % docs_root, where=str(docs_root),
            reason="空集上说不出'全部文档都新鲜'（01 §2 N1：X 为空集时'全部 X 通过'判未定）",
        )]

    wdir = norm_rel(work_root(cfg)[0]).rstrip("/")
    by_layout = _layout_meta_files(cfg, root)
    out, frozen, unclassified, declared_none, by_convention, field_guessed = [], [], [], [], [], []
    no_status = []
    for rel in files:
        if in_frozen(cfg, rel):
            frozen.append(rel)
            continue
        try:
            text = read_text(os.path.join(root, rel), root)
        except OSError as exc:
            out.append(unreadable(NAME, rel, exc))
            continue
        in_wdir = os.path.dirname(rel) == wdir
        if in_wdir:
            texts[rel] = text
        # 01 §3.5 的状态字段：只查项目声明的清单；layout 已查的两件、WI-* 工作项（活性巡检报 no-status）不重报
        if rel not in by_layout and not (in_wdir and is_work_item_name(rel)) \
                and _metadata_requirement(cfg, rel) == "required" \
                and item_status(text) is None:
            no_status.append(rel)

        value, hit = find_field(text[:HEAD_CHARS], names)
        if value is None or not clean(value):
            if rel in by_layout:   # layout 已查这件的日期字段（契约 §1）；解析不了、超期 layout 不判，照下文走
                continue
            need = _metadata_requirement(cfg, rel)
            if need == "not_required":
                out.append(finding(
                    NAME, SKIP, "不要求元信息：%s" % rel, where=str(rel),
                    reason="项目在 project.yaml 的 metadata_required 里给出了清单，本文件不在其内。"
                           "这是项目自己的声明，故记不适用（01 §3.5 的元信息要求只覆盖重要文档："
                           "验收、架构、模块、契约、ADR、runbook）",
                ))
                continue
            if need == "unknown":
                unclassified.append(rel)
                continue
            if need == "declared_none":
                declared_none.append(rel)
                continue
            if need == "convention":
                by_convention.append(rel)
                continue
            if names_default:      # 字段名是工具默认，没认出推不出没写（C11，与 layout 同口径）
                field_guessed.append(rel)
                continue
            out.append(finding(
                NAME, FAIL, "缺日期字段：%s" % rel, where="%s:1" % rel,
                why="01 §3.5 要求重要文档头部带 %s；01 §3.2 要求每份文档答得出"
                    "'它过期了怎么被发现'——没有日期就发现不了" % "/".join(names),
                evidence="文件头 %d 字符内没有找到 %s。%s" % (HEAD_CHARS, "/".join(names), fnote),
            ))
            continue

        d, err = parse_date(value)
        if d is None:
            out.append(finding(
                NAME, UNDETERMINED, "日期解析不了：%s" % rel, where="%s:1" % rel,
                reason="%s 的原文是 %r，%s；本工具不猜日期" % (hit, clean(value), err),
                why="01 §2 N1：证据不足而无法判定记未定",
                evidence=fnote,
            ))
            continue

        age = _age(today, d)
        if age < 0:
            out.append(finding(
                NAME, UNDETERMINED, "日期晚于基准日：%s" % rel, where="%s:1" % rel,
                reason="%s = %s，比基准日晚 %d 天；是笔误还是系统时钟不对，本工具判不了"
                       % (hit, d.isoformat(), -age),
                why="01 §2 N1", evidence=base,
            ))
        elif age > days:
            out.append(finding(
                NAME, UNDETERMINED, "%s 已 %d 天未更新（阈值 %d 天）" % (rel, age, days),
                where="%s:1" % rel, kind="stale", key=rel,
                reason="超期不等于过期，需人确认它是否仍然有效——久未更新也可能只是内容稳定",
                why="01 §3.5 元信息带 review_at 是为了到期复核；01 §2 N1 不把判不了的记成通过",
                evidence="%s = %s，%s，%s。%s" % (hit, d.isoformat(), base, note, fnote),
            ))
        else:
            out.append(finding(
                NAME, PASS, "%s 距今 %d 天，在阈值 %d 天内" % (rel, age, days), where=rel,
                evidence="%s = %s，%s，%s" % (hit, d.isoformat(), base, note),
            ))

    if frozen:
        out.append(agg(NAME, SKIP, "归档区文档不参与新鲜度", frozen, kind="frozen-docs",
                       reason="落在 layout.frozen 内；01 §3.1：一次性对齐工件不承担更新义务"))
    if declared_none:
        out.append(agg(
            NAME, SKIP, "缺日期字段，项目声明没有需要日期元数据的文档类", declared_none, kind="undated-declared-none",
            reason="project.yaml 把 metadata_required 显式写成空列表：项目声明自己没有 "
                   "01 §3.5 那六类文档（验收、架构、模块、契约、ADR、runbook）。这是项目自己的声明，"
                   "故记不适用；声明错了由写下它的人负责，本工具不复核。"
                   "键缺失不是这个意思——那种情况记未定",
            why="契约 §5：metadata_required 给了就只认它；空列表即『一类都不要求』"))
    if by_convention:
        out.append(agg(
            NAME, UNDETERMINED, "缺日期字段，按目录名约定像是 01 §3.5 的六类", by_convention,
            kind="undated-by-convention",
            reason="项目未配 metadata_required，这些路径里出现了 %s 之一。目录名是工具的约定，"
                   "不是项目的声明（契约 §1.1）：命中只说明『像』，推不出『这份必须带日期』，"
                   "故记未定不判 FAIL。要给出定论，在 project.yaml 写 metadata_required"
                   % " / ".join(sorted(_IMPORTANT_DIRS)),
            why="01 §3.5 元信息要求覆盖六类重要文档；契约 §1.1 约定落空或命中都不产出 FAIL"))
    if field_guessed:
        out.append(agg(
            NAME, UNDETERMINED, "metadata_required 要求带日期，但没认出默认日期字段 %s" % "/".join(names),
            field_guessed, kind="undated-fields-default",
            reason="这些文档在 metadata_required 清单内（项目声明），但日期字段名是本工具的默认值、"
                   "项目没在 metadata_fields 里声明；没认出推不出没写（契约 §1.1）。声明 metadata_fields 之后"
                   "仍缺才判 FAIL",
            why="01 §3.5 要求重要文档头部带日期；契约 §1.1 字段名约定落空只记未定"))
    if no_status:
        out.append(agg(
            NAME, UNDETERMINED, "metadata_required 命中的文档头部没认出状态字段", no_status,
            kind="no-status-field",
            reason="这些文档在项目声明的 metadata_required 内，但状态字段名是本工具的词表"
                   "（stdlib.STATUS_FIELDS：%s），没认出推不出没写（契约 §1.1），故记未定不判 FAIL；"
                   "取值是否在 01 §3.5 的四值里不判。补状态字段、收窄 metadata_required，或登记例外"
                   % " / ".join(STATUS_FIELDS),
            why="01 §3.5 要求重要文档头部带 status：没有它，读者分不出这份是现行、草稿还是已被取代（D-131）"))
    if unclassified:
        # 整轮一条，不逐份。逐份 SKIP 会把"没看"混进"不适用"里，而且数量一大就把
        # 真正的 FAIL 淹掉；聚成一条未定，退出码从 0/1 变 2，报告里也留得下路径清单。
        out.append(agg(
            NAME, UNDETERMINED, "缺日期字段，且判不了它们属不属于 01 §3.5 的六类", unclassified,
            kind="undated-unclassified",
            reason="项目未配 metadata_required，且这些路径里没有出现 acceptance / architecture / "
                   "modules / contracts / decisions / runbooks 任一目录名。"
                   "『这份文档算不算验收/架构/模块/契约/ADR/runbook』要看内容，"
                   "本工具只按目录名约定识别，机械判不了（契约 §7），故按 01 §2 N1 记未定，"
                   "不记不适用——不适用是确定结论，这里没有结论。"
                   "要给出定论，在 project.yaml 写 metadata_required（路径前缀清单，"
                   "**整体替换**目录名约定，不是追加）",
            why="01 §3.5 元信息要求覆盖六类重要文档；01 §2 N1 判不了的不记通过也不记不适用"))
    return out


def _check_work_items(cfg, root, today, base, texts):
    wroot, wnote = work_root(cfg)

    days, used_default, bad = _int_budget(
        cfg, "budgets.work_item_stale_days", _DEFAULT_WORK_ITEM_STALE_DAYS)
    if bad:
        return [finding(NAME, UNDETERMINED, "工作项活性阈值不是正整数", reason=bad,
                        why="01 §4.1 的复查时间是参数，但必须是可比较的数")]
    note = _note(used_default, "budgets.work_item_stale_days", days) + "；" + wnote

    absent = work_root_absent(NAME, cfg)    # 目录在不在归 layout 报，这里不重复记未定
    if absent:
        return [absent]

    files, problem = work_items(root, wroot)   # 只看直接一层
    if problem:
        return [finding(NAME, UNDETERMINED, "列不出 git 跟踪的工作项", reason=problem,
                        why="契约 §1：依赖不可用记未定")]

    out, frozen, nostatus, unknown, other, not_items, memo = [], [], [], [], [], [], []
    docs, unknown_docs = [], []
    for rel in files:
        if in_frozen(cfg, rel):
            frozen.append(rel)
            continue
        try:
            text = texts.pop(rel, None)
            text = read_text(os.path.join(root, rel), root) if text is None else text
        except OSError as exc:
            out.append(unreadable(NAME, rel, exc))
            continue

        status = item_status(text)
        if status is None:
            # 工作项按 01 §3.2 的 `WI-*` 命名认；不带这个名字又读不到状态的（样板 L1 的 current.md、
            # handoff.md、README 之类）不是工作项。带状态字段的是工作项还是文档由 stdlib.status_kind 判
            (nostatus if is_work_item_name(rel) else not_items).append(rel)
            continue
        kind, cls = status_kind(cfg, rel, status)   # 工作项还是文档，只在 stdlib 一处分（D-134）
        if cls is None:
            (unknown_docs if kind == "document" else unknown).append("%s（%s）" % (rel, status or "空"))
            continue
        if kind == "document":
            docs.append("%s（%s）" % (rel, status))
            continue
        if cls != "in_progress":
            other.append("%s（%s）" % (rel, status or "空"))
            continue

        d, how, err = _last_transition(text)
        used_git = False
        if d is None and err and err[0] == "absent":
            d, gerr = _git_commit_date(root, rel, memo)
            if d is None:
                out.append(finding(
                    NAME, UNDETERMINED, "取不到最后状态转换时间：%s" % rel, where=rel,
                    reason="%s；退到提交时间也不成：%s" % (err[1], gerr),
                    why="01 §4.1 要求每次转换留一行带时间；取不到就判不了它超没超龄（01 §2 N1）",
                    evidence=note,
                ))
                continue
            used_git = True
            how = "用的是提交时间，不是显式状态时间戳（git log -1 --format=%cI -- " + rel + "）"
        elif d is None:
            out.append(finding(
                NAME, UNDETERMINED, "状态转换时间解析不了：%s" % rel, where=rel,
                reason=err[1] if err else "未知", why="01 §2 N1：解析不了不猜",
                evidence=note,
            ))
            continue

        age = _age(today, d)
        caveat = "。注意：%s" % how if used_git else "。%s" % how
        if age < 0:
            out.append(finding(
                NAME, UNDETERMINED, "状态转换时间晚于基准日：%s" % rel, where=rel,
                reason="记录的时间 %s 比基准日晚 %d 天；是笔误还是时钟不对，本工具判不了"
                       % (d.isoformat(), -age),
                why="01 §2 N1", evidence="%s%s" % (base, caveat),
            ))
        elif age > days:
            out.append(finding(
                NAME, FAIL, "进行中工作项 %d 天无状态转换，需核实：%s" % (age, rel), where=rel,
                kind="work-item-stale", key=rel,   # 标题带天数，id 不许每天变（契约 §4）
                why="01 §4.1 要求活性巡检：长期无转换的进行中工作项要么在做要么被忘了，"
                    "二者都要有人处置——补进度与下次检查时间、转 blocked、或拆分。"
                    "01 §4.1 明确超龄需核实原因，不强造阻塞，也不许空转状态清零年龄",
                evidence="状态 %s，最后转换 %s，距今 %d 天，阈值 %d 天。%s，%s%s"
                         % (status, d.isoformat(), age, days, base, note, caveat),
            ))
        else:
            out.append(finding(
                NAME, PASS, "进行中工作项 %s 距上次转换 %d 天，在阈值 %d 天内" % (rel, age, days),
                where=rel,
                evidence="最后转换 %s。%s，%s%s" % (d.isoformat(), base, note, caveat),
            ))

    if frozen:
        out.append(agg(NAME, SKIP, "归档区工作项不参与活性巡检", frozen, kind="frozen-work-items",
                       reason="落在 layout.frozen 内；01 §3.1：一次性对齐工件不承担更新义务"))
    if nostatus:
        out.append(agg(NAME, UNDETERMINED, "WI-* 工作项读不到状态字段", nostatus,
                       kind="no-status",
                       reason="文件按 01 §3.2 的 WI-* 命名是工作项，但状态字段名是本工具的词表"
                              "（stdlib.STATUS_FIELDS），读不到推不出它没写（契约 §1.1）：它的活性与完成证据本次都没查"))
    if unknown:
        out.append(agg(NAME, UNDETERMINED, "工作项状态不在已知词表", unknown, kind="unknown-state",
                       reason="已知词表是 01 §4.1 六态及别名（stdlib.WORK_ITEM_STATES），并入 project.yaml 的 "
                              "work_item_*_states；"
                              "认不出就说不清它是进行中还是完成，超龄与完成证据两道检查本次都没查"
                              "（契约 §1.1）。改用 01 §4.1 的状态词，或在 project.yaml 声明自己的词"))
    if unknown_docs:
        out.append(agg(NAME, UNDETERMINED, "文档状态不在 01 §3.5 词表", unknown_docs, kind="unknown-doc-state",
                       reason="这些是 layout.artifacts 声明的工件，状态在工作项六态与 01 §3.5 文档四值"
                              "（stdlib.DOC_STATES）两表里都认不出，说不清它是否有效（契约 §1.1）"))
    if docs:
        out.append(agg(NAME, SKIP, "工作项目录下的文档不做工作项巡检", docs, kind="document-state",
                       reason="layout.artifacts 声明的工件、状态属 01 §3.5 文档四值（stdlib.DOC_STATES）的是文档，"
                              "不是 01 §4.1 的工作项：不查活性、不查完成证据（stdlib.status_kind，D-134）"))
    if not_items:
        out.append(agg(NAME, SKIP, "工作项目录下既不按 WI-* 命名、也没有状态字段的文件", not_items,
                       kind="not-work-item",
                       reason="01 §3.2 的工作项是 state/work/WI-*；这些文件不按该名、自己也没写状态，"
                              "不当工作项（样板 L1 的 current.md、handoff.md、README 之类）"))
    if other:
        out.append(agg(NAME, SKIP, "非进行中状态的工作项", other, kind="not-in-progress",
                       reason="01 §4.1 对 planned / blocked / in_validation 也要求巡检，"
                              "但复查时间是每项自己约定的值，工具读不到，故不判"))
    if not out:
        out.append(finding(
            NAME, UNDETERMINED, "%s 下没有可判定的工作项" % wroot, where=wroot,
            reason="空集上说不出'全部工作项都活着'（01 §2 N1）", evidence=note,
        ))
    return out


# --------------------------------------------------------------------------
# 自检：反例与正例各一（契约 §3）
# --------------------------------------------------------------------------

def _cfg(tmp, extra=None):
    cfg = {"_root": tmp,
           "layout": {"docs_root": "docs", "work_root": "work"},
           "budgets": {"stale_days": 90, "work_item_stale_days": 14}}
    if extra:
        cfg.update(extra)
    return cfg


def _sample(tmp, doc_text, work_text, declared=True):
    # 放在 architecture/ 下：这份样本是**照着被测约定造的**，所以它只能证明
    # "约定命中时判得对"，结构上永远抓不到"约定与标准不匹配"那一类缺陷。
    # 那一类由下面的 _sample_unconventional 覆盖。
    write_text(os.path.join(tmp, "docs", "architecture", "a.md"), doc_text)
    write_text(os.path.join(tmp, "work", "WI-0001-x.md"), work_text)
    err = git_track(tmp)
    return _cfg(tmp, {"metadata_required": ["docs/architecture"], "metadata_fields": ["updated_at"]}
                if declared else None), err


def _sample_unconventional(tmp, work_text, metadata_required=None):
    """路径**不匹配任何目录名约定**的两份无日期文档，其中一份是中文名。

    造法：一份用真实踩过的形态（RCMS 的 runbook 在 `docs/ops/`，目录名不在
    `_IMPORTANT_DIRS` 里），一份用本工具自己仓库的形态（中文目录 + 中文文件名，
    一套英文目录名约定对它零命中）。中文名那份是关键——上面那份还能靠加
    `*runbook*` 文件名模式蒙对，中文树连蒙的机会都没有。
    """
    write_text(os.path.join(tmp, "docs", "ops", "pitr-runbook.md"),
               "# PITR 恢复手册\n\n正文：按时间点恢复的操作步骤。\n")
    write_text(os.path.join(tmp, "docs", "运维", "数据恢复手册.md"),
               "# 数据恢复手册\n\n正文：故障后的数据恢复步骤。\n")
    write_text(os.path.join(tmp, "work", "WI-0001-x.md"), work_text)
    err = git_track(tmp)
    extra = ({"metadata_required": list(metadata_required), "metadata_fields": ["updated_at"]}
             if metadata_required is not None else None)
    return _cfg(tmp, extra), err


def selftest():
    """反例：无日期文档 + 停滞 100 天的进行中工作项，须判 FAIL。
    正例：昨天更新的文档 + 昨天刚转换的进行中工作项，须判 PASS。
    另有转换记录、提交时间回退、浅克隆、metadata 声明等反例；未覆盖的分支见 scope。
    """
    results = []
    today = datetime.date.today()
    old = (today - datetime.timedelta(days=100)).isoformat()
    fresh = (today - datetime.timedelta(days=1)).isoformat()

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        cfg, err = _sample(
            tmp,
            "# 一份没有日期的文档\n\nstatus: active\n\n正文。\n",
            "# WI-0001\n\n状态：**in_progress**\n\n## 状态转换记录\n\n"
            "| from → to | 时间 |\n|---|---|\n| planned → in_progress | %s |\n" % old,
        )
        got = [f["status"] for f in run(cfg)] if not err else []
        ok = (not err) and got and set(got) == {FAIL} and len(got) == 2
        results.append(probe(NAME, ok,
            "反例：无日期文档 + 停滞 100 天的进行中工作项，应各判一条 FAIL",
            evidence="实得 %s%s" % (got, ("；git 准备失败：%s" % err) if err else ""),
            why="契约 §3 静默失效探测：抓不出违规的检查器，其结论作废",
        ))

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        cfg, err = _sample(
            tmp,
            "---\nid: DOC-1\nstatus: active\nupdated_at: %s\n---\n\n# 有日期的文档\n" % fresh,
            "# WI-0001\n\n状态：**in_progress**\n\n## 状态转换记录\n\n"
            "| from → to | 时间 |\n|---|---|\n| planned → in_progress | %s |\n" % fresh,
        )
        got = [f["status"] for f in run(cfg)] if not err else []
        ok = (not err) and got and set(got) == {PASS} and len(got) == 2
        results.append(probe(NAME, ok,
            "正例：昨天更新的文档 + 昨天刚转换的进行中工作项，应各判一条 PASS",
            evidence="实得 %s%s" % (got, ("；git 准备失败：%s" % err) if err else ""),
            why="契约 §3 静默失效探测：把正常样本判成违规的检查器同样不可用",
        ))

    work_fresh = ("# WI-0001\n\n状态：**in_progress**\n\n## 状态转换记录\n\n"
                  "| from → to | 时间 |\n|---|---|\n| planned → in_progress | %s |\n" % fresh)

    # 反例三：路径不匹配约定（含中文名），未配 metadata_required。
    # 必须落到聚合未定，**不得**出现逐份 SKIP「不要求元信息」——那是拿"没看"冒充"不适用"。
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        cfg, err = _sample_unconventional(tmp, work_fresh)
        res = run(cfg) if not err else []
        skips = [f for f in res if f["status"] == SKIP and "不要求元信息" in (f["title"] or "")]
        aggs = [f for f in res if f["status"] == UNDETERMINED and "判不了它们" in (f["title"] or "")]
        ev = (aggs[0].get("evidence") or "") if aggs else ""
        ok = ((not err) and not skips and len(aggs) == 1
              and "docs/ops/pitr-runbook.md" in ev and "docs/运维/数据恢复手册.md" in ev)
        results.append(probe(NAME, ok,
            "反例三：路径不匹配目录名约定（含中文名）的无日期文档，"
            "未配 metadata_required 时须记聚合未定，不得逐份记不适用",
            evidence="实得 %s；逐份 SKIP %d 条，聚合未定 %d 条，证据 %r%s"
                     % ([f["status"] for f in res], len(skips), len(aggs), ev[:160],
                        ("；git 准备失败：%s" % err) if err else ""),
            why="契约 §7 只做机械判定 + 01 §2 N1 判不了记未定；SKIP 是确定结论，"
                "『这份算不算重要文档』不是机械可判定的",
        ))

    # 反例四：同一样本配上 metadata_required。同时钉死它的**替换语义**：
    # 只写 docs/ops，中文那份就从"未分类"变成"项目声明不需要"，而不是继续按目录名约定判。
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        cfg, err = _sample_unconventional(tmp, work_fresh, metadata_required=["docs/ops"])
        res = run(cfg) if not err else []
        fails = [f for f in res if f["status"] == FAIL and "pitr-runbook" in (f["title"] or "")]
        skips = [f for f in res if f["status"] == SKIP and "数据恢复手册" in (f["title"] or "")]
        aggs = [f for f in res if f["status"] == UNDETERMINED and "判不了它们" in (f["title"] or "")]
        ok = (not err) and len(fails) == 1 and len(skips) == 1 and not aggs
        results.append(probe(NAME, ok,
            "反例四：配了 metadata_required: [docs/ops] 后，命中的判 FAIL、未命中的判不适用，"
            "不再有未分类（钉死『替换而非追加』的语义）",
            evidence="实得 %s；命中 FAIL %d 条，未命中 SKIP %d 条，残留聚合未定 %d 条%s"
                     % ([f["status"] for f in res], len(fails), len(skips), len(aggs),
                        ("；git 准备失败：%s" % err) if err else ""),
            why="契约 §5：metadata_required 给了就只认它，整体替换目录名约定",
        ))

    # 反例四之二：metadata_required 显式写成空列表 `[]`，是项目声明"一类都不要求"，
    # 须整轮一条 SKIP、不留聚合未定；同一样本不配这个键（反例三）才记未定——两者不得混同。
    # 取值经解析器读出，连同"解析器接受 `[]`"一起钉住。
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        declared = parse_yaml_subset("metadata_required: []\n")["metadata_required"]
        cfg, err = _sample_unconventional(tmp, work_fresh, metadata_required=declared)
        res = run(cfg) if not err else []
        skips = [f for f in res if f["status"] == SKIP and "项目声明没有" in (f["title"] or "")]
        aggs = [f for f in res if f["status"] == UNDETERMINED and "判不了它们" in (f["title"] or "")]
        ev = (skips[0].get("evidence") or "") if skips else ""
        ok = ((not err) and len(skips) == 1 and not aggs
              and FAIL not in [f["status"] for f in res]
              and "docs/ops/pitr-runbook.md" in ev and "docs/运维/数据恢复手册.md" in ev)
        results.append(probe(NAME, ok,
            "反例四之二：metadata_required: [] 时无日期文档整轮记一条不适用，"
            "不留聚合未定（键缺失才记未定，见反例三）",
            evidence="实得 %s；声明型 SKIP %d 条，残留聚合未定 %d 条%s"
                     % ([f["status"] for f in res], len(skips), len(aggs),
                        ("；git 准备失败：%s" % err) if err else ""),
            why="契约 §5：空列表是项目的声明，键缺失是没声明，前者可给确定结论、后者不能",
        ))

    # 反例五（id 稳定性，契约 §9）：同一份文档再放一阵子，**标题里的天数要变、id 不能变**。
    # id 跟着天数走的话，例外登记里写下的那一行第二天就失效——登记会退化成每天重抄一遍。
    def _stale_one(days_ago):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            cfg, err = _sample(
                tmp,
                "---\nid: DOC-1\nstatus: active\nupdated_at: %s\n---\n\n# 有日期的文档\n"
                % (today - datetime.timedelta(days=days_ago)).isoformat(),
                work_fresh,
            )
            if err:
                return None, err
            hits = [f for f in run(cfg) if f["id"].startswith(NAME + "/stale/")]
        return (hits[0] if len(hits) == 1 else None), None

    # 反例六（契约 §1.1，D-123）：未配 metadata_required，目录名约定命中的无日期文档只记未定
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        cfg, err = _sample(tmp, "# 一份没有日期的文档\n\n正文。\n", work_fresh, declared=False)
        res = run(cfg) if not err else []
        conv = [f for f in res if f["id"] == NAME + "/undated-by-convention"]
        ok = (not err) and len(conv) == 1 and conv[0]["status"] == UNDETERMINED \
            and FAIL not in [f["status"] for f in res]
        results.append(probe(NAME, ok,
            "反例六：未配 metadata_required 时目录名约定命中的无日期文档只记未定，不判 FAIL",
            evidence="实得 %s%s" % ([(f["status"], f["id"]) for f in res], ("；git 准备失败：%s" % err) if err else ""),
            why="契约 §1.1：目录名是工具约定，约定命中或落空都不产出 FAIL",
        ))

    # 反例八（D-131）：metadata_required 前缀在 docs_root 之外（L1 的 work/）时照样扫——
    # 无日期判 FAIL、有日期判 PASS；修前这两份一条结论都不出
    got = {}
    for tag, body in (("undated", "# 留证\n\n状态：active\n"),
                      ("dated", "状态：active\nupdated_at: %s\n" % fresh)):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            write_text(os.path.join(tmp, "work", "artifacts", "x.md"), body)
            cfg, err = _sample(tmp, "状态：active\nupdated_at: %s\n" % fresh, work_fresh)
            cfg["metadata_required"] = ["docs/architecture", "work"]
            got[tag] = [f["status"] for f in run(cfg) if (f.get("where") or "").startswith("work/artifacts/x.md")] \
                if not err else err
    results.append(probe(NAME, got == {"undated": [FAIL], "dated": [PASS]},
        "反例八：docs_root 之外的 metadata_required 前缀照扫，无日期判 FAIL、有日期判 PASS",
        evidence="实得 %s" % (got,), why="契约 §5：metadata_required 给了就只认它，声明了要查不能静默不查",
    ))

    # 反例九（D-131）：metadata_required 命中、头部没认出状态字段的文档汇成一条未定（id 不随份数变），不判 FAIL；
    # 带状态字段的不进；layout 已查的状态工件、活性巡检已报 no-status 的 WI-* 不重报（契约 §1）
    def _nostatus(extra):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            dated = "updated_at: %s\n" % fresh
            for i in range(extra):
                write_text(os.path.join(tmp, "docs", "architecture", "n%d.md" % i), dated)
            write_text(os.path.join(tmp, "docs", "architecture", "b.md"), "状态：进行中\n" + dated)
            write_text(os.path.join(tmp, "docs", "architecture", "S.md"), "# 声明的状态工件，缺日期也缺状态\n")
            write_text(os.path.join(tmp, "docs", "architecture", "late.md"),
                       dated + "x" * HEAD_CHARS + "\nstatus: active\n")
            write_text(os.path.join(tmp, "ACCEPTANCE.md"), dated)     # 验收走候选路径，未声明落点
            write_text(os.path.join(tmp, "work", "WI-0002-y.md"), dated)
            cfg, err = _sample(tmp, dated, work_fresh)
            cfg["metadata_required"] = ["docs/architecture", "work", "ACCEPTANCE.md"]
            cfg["layout"]["artifacts"] = {"status": "docs/architecture/S.md"}
            if err:
                return err
            res = [f for f in run(cfg) if f["status"] != PASS]
            return [(f["status"], f["id"], f.get("evidence") or f.get("where")) for f in res
                    if f["id"] != NAME + "/not-work-item" and not (f.get("where") or "").startswith("work/WI-0001")]
    a, b = _nostatus(0), _nostatus(2)
    ok = a == [(UNDETERMINED, NAME + "/no-status-field", "docs/architecture/a.md；docs/architecture/late.md"),
               (UNDETERMINED, NAME + "/no-status", "work/WI-0002-y.md")] \
        and isinstance(b, list) and [x[1] for x in b] == [x[1] for x in a]
    results.append(probe(NAME, ok,
        "反例九：metadata_required 命中而没认出状态字段的文档记一条聚合未定，状态字段只认头部；带状态的、"
        "layout 已查的（声明落点与候选路径两种，缺日期也不重报）、WI-* 不进；份数变 id 不变",
        evidence="1 份：%s；3 份：%s" % (a, b),
        why="01 §3.5 要求头部带 status；状态字段名是工具词表，契约 §1.1 只记未定；契约 §1 同一事实只报一次",
    ))

    # 反例九之二（D-131）：验收工件在 tailoring 里登记为不适用、或 layout 整个被裁时 layout 不查它，
    # 缺状态字段改由这里报（仍只一次）
    got = {}
    for tag in ("layout:acceptance", "layout"):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            write_text(os.path.join(tmp, "ACCEPTANCE.md"), "updated_at: %s\n" % fresh)
            cfg, err = _sample(tmp, "status: active\nupdated_at: %s\n" % fresh, work_fresh)
            cfg["metadata_required"] = ["docs/architecture", "ACCEPTANCE.md"]
            cfg["tailoring"] = [{"check": tag, "applicable": False, "reason": "样本"}]
            got[tag] = [(f["id"], f.get("evidence")) for f in run(cfg) if f["status"] != PASS] if not err else err
    want = [(NAME + "/no-status-field", "ACCEPTANCE.md")]
    results.append(probe(NAME, got == {"layout:acceptance": want, "layout": want},
        "反例九之二：验收工件被 tailoring 裁掉、或 layout 整个被裁时，它缺状态字段由 freshness 报一条未定",
        evidence="非通过项 %s" % (got,), why="契约 §1：layout 不查的，不能因以为它查了而谁都不报",
    ))

    # 反例八之二（D-131）：落在 layout.frozen 内的前缀不产出结论（归档区）；metadata_required 写成
    # "./"、"."、空或以 / 、.. 起头时整份配置拒收并报行号——不猜整仓（会扫进内嵌 .std/）也不当不命中（拿没看冒充不适用）
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        write_text(os.path.join(tmp, "work", "old", "y.md"), "# 归档\n")
        cfg, err = _sample(tmp, "status: active\nupdated_at: %s\n" % fresh, work_fresh)
        cfg["metadata_required"] = ["docs/architecture", "work"]
        cfg["layout"]["frozen"] = ["work/old"]
        got = [(f["status"], f["id"]) for f in run(cfg) if f["status"] in (FAIL, UNDETERMINED)
               and "work/old" in "%s%s" % (f.get("where"), f.get("evidence"))] if not err else err
        rejected = {}
        for v in ('"./"', '"."', '""', "/abs", "../x"):
            write_text(os.path.join(tmp, "governance", "project.yaml"),
                       "tier: L0\nmetadata_required:\n  - docs\n  - %s\n" % v)
            _c, prob = load_config(tmp)
            rejected[v] = bool(prob) and "第 2 行 metadata_required" in prob
    ok = got == [] and all(rejected.values())
    results.append(probe(NAME, ok,
        "反例八之二：layout.frozen 内的前缀不产出失败或未定；metadata_required 写成 ./ 、. 、空、/ 或 .. 起头整份拒收并报行号",
        evidence="归档区 %s；拒收 %s" % (got, rejected), why="01 §3.1 归档区不承担更新义务；契约 §5 写错不猜",
    ))

    # 反例八之三（D-133）：`!` 排除前缀从包含里减——被排除的无日期无状态文档在文档根内只记一条不适用、
    # 不进缺日期 FAIL 与缺状态未定（同一事实只报一次），在文档根外不进扫描面；未排除的照判 FAIL。
    # 开头带 "./" 的写法（包含与排除）与不带的同判——此前 "./docs" 合法却永远不命中（D-133 记原有缺陷）
    got = {}
    for tag, pre in (("plain", ""), ("dot", "./")):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            write_text(os.path.join(tmp, "docs", "architecture", "index.md"), "# 索引\n")
            write_text(os.path.join(tmp, "docs", "architecture", "keep.md"), "status: active\n")
            write_text(os.path.join(tmp, "work", "raw", "r.md"), "# 工具原文\n")
            cfg, err = _sample(tmp, "status: active\nupdated_at: %s\n" % fresh, work_fresh)
            cfg["metadata_required"] = [pre + "docs/architecture", pre + "work",
                                        "!%sdocs/architecture/index.md" % pre, "!%swork/raw/" % pre]
            res = run(cfg) if not err else []
            got[tag] = {k: [f["status"] for f in res if k in "%s|%s" % (f.get("where"), f.get("evidence"))]
                        for k in ("index.md", "keep.md", "work/raw")} if not err else err
    want = {"index.md": [SKIP], "keep.md": [FAIL], "work/raw": []}
    results.append(probe(NAME, got == {"plain": want, "dot": want},
        "反例八之三：! 排除的文档只记一条不适用、文档根外的不扫，未排除的无日期照判 FAIL；开头带 ./ 的写法同判",
        evidence="实得 %s" % (got,), why="契约 §5：排除是项目声明，从包含里减；契约 §1 同一事实只报一次",
    ))

    # 反例八之四（D-133）：排除前缀写法非法、不落在包含之下、只有排除没有包含、与包含相同，整份拒收并报行号；
    # 裸写 ! 被解析器拒收时提示加引号；合法的（含 ./ 起头）照收
    rej = "第 2 行 metadata_required"
    cases = (("  - docs\n  - '!'\n", rej), ("  - docs\n  - '!/docs/x'\n", rej), ("  - docs\n  - '!../x'\n", rej),
             ("  - docs\n  - '!.'\n", rej), ("  - docs\n  - '!./'\n", rej), ("  - docs\n  - '!work/x'\n", rej),
             ("  - '!docs/x'\n", rej), ("  - docs\n  - '!docs'\n", rej), ("  - docs\n  - '!./docs/'\n", rej),
             ("  - docs\n  - !docs/x\n", "须加引号"),
             ("  - docs\n  - '!docs/x'\n", None), ("  - ./docs\n  - '!./docs/x'\n", None))
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        verdict = {}
        for body, want_msg in cases:
            write_text(os.path.join(tmp, "governance", "project.yaml"), "tier: L0\nmetadata_required:\n" + body)
            _c, prob = load_config(tmp)
            verdict[body] = (not prob) if want_msg is None else (bool(prob) and want_msg in prob)
    results.append(probe(NAME, all(verdict.values()),
        "反例八之四：! 后为空、/ 或 .. 起头、. 、./ ，排除不在包含之下、只有排除、与包含相同，均整份拒收；"
        "裸写 ! 提示加引号；合法排除（含 ./ 起头）照收",
        evidence="符合预期与否 %s" % (verdict,), why="契约 §5 写错不猜：排除不存在的范围多半是笔误",
    ))

    # C10：取最后一条转换记录的日期——小节里的备注日期、全文别处的 from|…| 行都不算；
    # 有小节却没有带日期的记录记未定，不退到提交时间
    got = {}
    for tag, body in (
            ("note", "## 状态转换记录\n\n| from → to | 时间 |\n|---|---|\n| planned → in_progress | %s |\n\n"
                     "备注：计划 %s 前完成\n" % (old, fresh)),
            ("elsewhere", "## 其他\n\n| from | to | %s |\n|---|---|---|\n" % fresh),
            ("empty", "## 状态转换记录\n\n（无）\n")):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            cfg, err = _sample(tmp, "updated_at: %s\n" % fresh, "# WI-0001\n\n状态：in_progress\n\n" + body)
            if not err:   # 退到提交时间的那支按 100 天前提交
                env = dict(os.environ, GIT_COMMITTER_DATE="%s 12:00:00 +0000" % old,
                           GIT_AUTHOR_DATE="%s 12:00:00 +0000" % old)
                subprocess.run(["git", "-C", tmp, "-c", "user.name=a", "-c", "user.email=a@b",
                                "-c", "commit.gpgsign=false", "commit", "-q", "-m", "s"],
                               capture_output=True, timeout=60, env=env)
            got[tag] = [f["status"] for f in run(cfg) if (f.get("where") or "") == "work/WI-0001-x.md"] \
                if not err else err
    want = {"note": [FAIL], "elsewhere": [FAIL], "empty": [UNDETERMINED]}
    results.append(probe(NAME, got == want,
        "C10：取最后一条转换记录；备注日期与别处的 from 行不洗白停滞工作项，空记录记未定",
        evidence="实得 %s；应得 %s" % (got, want), why="01 §4.1：活性看最后一次状态转换；01 §2 N1 判不了不猜",
    ))

    # C18：作者时区比运行环境早一天时，日期写成「明天」不算晚于基准日；晚两天仍记未定
    got = {}
    for n in (1, 2):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            cfg, err = _sample(tmp, "updated_at: %s\n" % (today + datetime.timedelta(days=n)).isoformat(), work_fresh)
            got[n] = [f["status"] for f in run(cfg) if (f.get("where") or "").startswith("docs/")] if not err else err
    results.append(probe(NAME, got == {1: [PASS], 2: [UNDETERMINED]},
        "C18：日期晚基准日一天按当天算，晚两天记未定",
        evidence="实得 %s" % (got,), why="基准日是运行环境本地日期，作者可能在更早的时区写当天日期",
    ))

    # R2-3：转换表之后隔一个空行的备注列表、第二张计划表，不许把停滞工作项洗成活着
    got = []
    for tail in ("\n- 备注：计划 %s 复查\n" % fresh, "\n| 计划 | 日期 |\n|---|---|\n| 复查 | %s |\n" % fresh):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            cfg, err = _sample(tmp, "updated_at: %s\n" % fresh,
                               "# WI-0001\n\n状态：in_progress\n\n## 状态转换记录\n\n| from → to | 时间 |\n"
                               "|---|---|\n| planned → in_progress | %s |\n" % old + tail)
            got.append([f["status"] for f in run(cfg) if (f.get("where") or "") == "work/WI-0001-x.md"]
                       if not err else err)
    results.append(probe(NAME, got == [[FAIL], [FAIL]],
        "R2-3：只认第一段连续的记录行，其后的备注列表与第二张表不算转换记录",
        evidence="实得 %s" % (got,), why="01 §4.1：活性看最后一次状态转换",
    ))

    # C11：metadata_required 声明了而 metadata_fields 没声明，无日期文档只记一条聚合未定，不判 FAIL
    # （与 layout 的 meta-unrecognized 同口径：字段名是工具默认，没认出推不出没写）
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        cfg, err = _sample(tmp, "# 无日期\n\nstatus: active\n日期：2026-09-01\n", work_fresh)
        cfg.pop("metadata_fields", None)
        got = [(f["status"], f["id"]) for f in run(cfg) if f["status"] != PASS] if not err else err
    results.append(probe(NAME, got == [(UNDETERMINED, NAME + "/undated-fields-default")],
        "C11：未声明 metadata_fields 时 metadata_required 命中的无日期文档只记未定",
        evidence="非通过项 %s" % (got,), why="契约 §1.1 与 §5 metadata_fields：声明后仍缺才判 FAIL",
    ))

    # 反例七（D-123 bug 1）：浅克隆下退到提交时间的工作项须记未定。非浅克隆同一样本判 FAIL，
    # 浅克隆取到的是克隆时刻，旧实现会把它翻成 PASS。
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        src, dst = os.path.join(tmp, "src"), os.path.join(tmp, "dst")
        write_text(os.path.join(src, "work", "WI-0001-x.md"), "# WI-0001\n\n状态：in_progress\n")
        write_text(os.path.join(src, "docs", "architecture", "a.md"), "updated_at: %s\n" % fresh)
        env = dict(os.environ, GIT_COMMITTER_DATE="%s 12:00:00 +0000" % old,
                   GIT_AUTHOR_DATE="%s 12:00:00 +0000" % old)
        gid = ["-c", "user.name=a", "-c", "user.email=a@b", "-c", "commit.gpgsign=false"]
        steps = [["git", "-c", "init.defaultBranch=main", "init", "-q", src],
                 ["git", "-C", src] + gid + ["add", "-A"],
                 ["git", "-C", src] + gid + ["commit", "-q", "-m", "s"],
                 ["git", "-C", src] + gid + ["commit", "-q", "--allow-empty", "-m", "t"],
                 ["git", "clone", "-q", "--depth", "1", "file://" + src, dst]]
        err = None
        for i, cmd in enumerate(steps):
            r = subprocess.run(cmd, capture_output=True, timeout=60, env=env if i < 4 else None)
            if r.returncode != 0:
                err = "%s 退出码 %d" % (" ".join(cmd[:4]), r.returncode)
                break
        got = {}
        if not err:
            for tag, d in (("full", src), ("shallow", dst)):
                got[tag] = [f["status"] for f in run(_cfg(d)) if (f.get("where") or "") == "work/WI-0001-x.md"]
        ok = (not err) and got.get("full") == [FAIL] and got.get("shallow") == [UNDETERMINED]
        results.append(probe(NAME, ok,
            "反例七：退到提交时间的超龄工作项，完整仓判 FAIL、浅克隆记未定",
            evidence="实得 %s%s" % (got, ("；git 准备失败：%s" % err) if err else ""),
            why="01 §2 N1：浅克隆的提交时间是克隆时刻，据它判活性会把 FAIL 翻成 PASS",
        ))

    # 反例七之二（C02）：工作项文件名带 [ ] 时 git 按通配解读，会取到 WI-0001-a.md 刚才的提交，
    # 把 100 天前提交、无转换记录的进行中工作项判成活着
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        write_text(os.path.join(tmp, "work", "WI-0001-[a].md"), "# WI-0001\n\n状态：in_progress\n")
        write_text(os.path.join(tmp, "docs", "architecture", "a.md"), "updated_at: %s\n" % fresh)
        gid = ["-c", "user.name=a", "-c", "user.email=a@b", "-c", "commit.gpgsign=false"]
        err = None
        for when, cmd in ((None, ["git", "-c", "init.defaultBranch=main", "init", "-q", tmp]),
                          (None, ["git", "-C", tmp] + gid + ["add", "-A"]),
                          (old, ["git", "-C", tmp] + gid + ["commit", "-q", "-m", "s"]),
                          (None, ["sh", "-c", "echo x > '%s'" % os.path.join(tmp, "work", "WI-0001-a.md")]),
                          (None, ["git", "-C", tmp] + gid + ["add", "-A"]),
                          (fresh, ["git", "-C", tmp] + gid + ["commit", "-q", "-m", "t"])):
            env = dict(os.environ, GIT_COMMITTER_DATE="%s 12:00:00 +0000" % when,
                       GIT_AUTHOR_DATE="%s 12:00:00 +0000" % when) if when else None
            r = subprocess.run(cmd, capture_output=True, timeout=60, env=env)
            if r.returncode != 0:
                err = "%s 退出码 %d" % (" ".join(cmd[:4]), r.returncode)
                break
        got = [f["status"] for f in run(_cfg(tmp)) if (f.get("where") or "") == "work/WI-0001-[a].md"] \
            if not err else err
    results.append(probe(NAME, got == [FAIL],
        "反例七之二：文件名带 [ ] 的超龄工作项按字面取提交时间，仍判 FAIL",
        evidence="实得 %s" % (got,),
        why="01 §4.1：活性看的是这一份工作项自己的提交，不是被通配到的别的文件",
    ))

    # C22：工作项目录在文档根之下（缺省形态）时每份工作项只读一遍；浅克隆一次扫描只探测一次
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        for i in (1, 2):
            write_text(os.path.join(tmp, "docs", "state", "work", "WI-000%d-x.md" % i), "# WI\n\n状态：in_progress\n")
        err = git_track(tmp)
        reads, probes = [], []
        real_read, real_probe = globals()["read_text"], globals()["shallow_problem"]
        globals()["read_text"] = lambda p, r=None: (reads.append(p), real_read(p, r))[1]
        globals()["shallow_problem"] = lambda r: (probes.append(r), real_probe(r))[1]
        try:
            run({"_root": tmp}) if not err else None
        finally:
            globals()["read_text"], globals()["shallow_problem"] = real_read, real_probe
    ok = (not err) and len(reads) == 2 and len(set(reads)) == 2 and len(probes) == 1
    results.append(probe(NAME, ok,
        "C22：工作项目录在文档根下时每份只读一遍，浅克隆只探测一次",
        evidence="读 %d 次（%d 份），探测 %d 次%s" % (len(reads), len(set(reads)), len(probes),
                                             ("；git 准备失败：%s" % err) if err else ""),
        why="一次扫描里同一份文件不重复 I/O，不为每份工作项起子进程",
    ))

    # 反例五之二（D-123 bug 10）：超龄工作项的 FAIL 标题带天数，id 须不随天数变；
    # 聚合未定的标题带份数，id 须不随份数变
    def _ids_of(days_ago, extra_unclassified):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            day = (today - datetime.timedelta(days=days_ago)).isoformat()
            for i in range(extra_unclassified):
                write_text(os.path.join(tmp, "docs", "杂项", "n%d.md" % i), "# 无日期\n")
            cfg, err = _sample(tmp, "updated_at: %s\n" % fresh,
                               "# WI-0001\n\n状态：**in_progress**\n\n## 状态转换记录\n\n"
                               "| from → to | 时间 |\n|---|---|\n| planned → in_progress | %s |\n" % day,
                               declared=False)
            return sorted(f["id"] for f in run(cfg) if f["status"] in (FAIL, UNDETERMINED)) if not err else err
    ids_a, ids_b = _ids_of(100, 2), _ids_of(300, 3)
    ok = ids_a == ids_b == sorted([NAME + "/undated-unclassified", NAME + "/work-item-stale/work/WI-0001-x.md"])
    results.append(probe(NAME, ok,
        "反例五之二：超龄天数与聚合份数变了，FAIL 与未定的 id 都不变",
        evidence="100 天 2 份：%s；300 天 3 份：%s" % (ids_a, ids_b),
        why="契约 §4/§9：id 随天数或份数漂，登记行就成孤儿",
    ))

    # 只看工作项目录直接一层（D-123 裁定 3）；工作项按 01 §3.2 的 WI-* 命名认（审查 B5）：
    # 样板 L1 的 current.md / handoff.md 与子目录留证不报 no-status，无状态的 WI-* 才报
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        write_text(os.path.join(tmp, "work", "artifacts", "README.md"), "# 留证说明\n")
        write_text(os.path.join(tmp, "work", "current.md"), "# 当前\n")
        write_text(os.path.join(tmp, "work", "handoff.md"), "# 交接\n")
        write_text(os.path.join(tmp, "work", "WI-0002-y.md"), "# 没写状态\n")
        cfg, err = _sample(tmp, "status: active\nupdated_at: %s\n" % fresh, work_fresh)
        got = [(f["status"], f["id"], f.get("evidence") or "") for f in run(cfg) if f["status"] != PASS] \
            if not err else err
    ok = (not err) and [(st, i) for st, i, _e in got] == [(UNDETERMINED, NAME + "/no-status"),
                                                           (SKIP, NAME + "/not-work-item")] \
        and got[0][2] == "work/WI-0002-y.md" and got[1][2] == "work/current.md；work/handoff.md"
    results.append(probe(NAME, ok,
        "工作项按 WI-* 命名认：current.md/handoff.md 不报 no-status、子目录不数，无状态的 WI-* 记未定",
        evidence="非通过项 %s" % (got,),
        why="01 §3.2 state/work/WI-*；样板 L1（templates/文件树与落地路径.md §3）不许恒退 2",
    ))

    a, err_a = _stale_one(100)
    b, err_b = _stale_one(300)
    ok = (a is not None and b is not None and a["id"] == b["id"] and a["title"] != b["title"]
          and a["id"] == "%s/stale/%s" % (NAME, (a.get("where") or "")[:-2]))
    results.append(probe(NAME, ok,
        "反例五：同一份文档放得更久，标题里的天数变而 id 不变（id = freshness/stale/<路径>）",
        evidence="100 天：id=%s title=%r；300 天：id=%s title=%r%s"
                 % (a["id"] if a else "（无）", a["title"] if a else "（无）",
                    b["id"] if b else "（无）", b["title"] if b else "（无）",
                    ("；git 准备失败：%s" % (err_a or err_b)) if (err_a or err_b) else ""),
        why="契约 §9：例外登记行写的就是 id，id 随天数漂就等于登记每天失效一次",
    ))
    return results
