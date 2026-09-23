# -*- coding: utf-8 -*-
"""文档新鲜度与工作项活性巡检。

执行 01 §3.5（重要文档头部带 `updated_at` 等元信息）与 01 §4.1（活性：任一未终结
状态停留超过约定复查时间即触发核实）。契约见 ../CONTRACT.md。只用标准库。

三态取向（01 §2 N1）：
- 文档久未更新记 **未定**，不记失败——久未更新可能只是内容稳定，是否过期要人看。
- 文档没有日期字段记 **失败**——01 §3.2 要求说清"它过期了怎么被发现"，没有日期就发现不了。
- 进行中工作项长期无状态转换记 **失败**，但标题写"需核实"：01 §4.1 说的是超龄触发核实，
  不是自动判违规，处置由负责人定（补进度、转 blocked 或拆分）。
"""
from __future__ import annotations

import datetime
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from stdlib import (  # noqa: E402
    FAIL, HEAD_CHARS, PASS, SKIP, UNDETERMINED,
    agg, cfg_get, clean, date_fields_of, docs_root_of, find_field, finding, git_track, in_frozen,
    is_tailored_out, item_status, markdown_under, norm_rel, note_default, parse_date, parse_yaml_subset,
    read_text, state_list, undetermined_from_exception, work_root, work_root_absent, write_text,
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

    - `"required"`   —— 项目配置命中，或路径里出现约定的目录名；
    - `"not_required"` —— 项目配了 `metadata_required` 而本文件不在清单内。
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
    parts = [p for p in str(rel).replace("\\", "/").split("/") if p]
    override = cfg_get(cfg, "metadata_required")
    if isinstance(override, list):
        if not override:
            return "declared_none"
        joined = "/".join(parts)
        for pre in override:
            pre = str(pre).replace("\\", "/").strip("/")
            if pre and (joined == pre or joined.startswith(pre + "/")):
                return "required"
        return "not_required"
    if any(seg in _IMPORTANT_DIRS for seg in parts[:-1]):
        return "required"
    return "unknown"


_DEFAULT_IN_PROGRESS = ("in_progress", "进行中")

# 状态字段词表已并进 stdlib.STATUS_FIELDS（01 §1 G2：同一事实一处权威）。
_TRANSITION_FIELDS = ("last_transition_at", "state_changed_at", "最后状态转换时间", "状态更新时间")
_TRANSITION_HEADINGS = ("状态转换记录", "状态转换", "转换记录", "transition")


# --------------------------------------------------------------------------
# 小工具（工作项扫描共用的几件在 stdlib）
# --------------------------------------------------------------------------

# 日期解析已提到 stdlib：例外登记的到期也要解析同样的形态，留两份必然漂（01 §1 G2）。
# 本名保留是因为本模块内有多处调用点，改名只会制造无谓的 diff。
_parse_date = parse_date


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


def _git_commit_date(root, rel):
    """该文件最后一次提交的时间。返回 (date, None) 或 (None, 原因)。"""
    cmd = ["git", "-C", root, "log", "-1", "--format=%cI", "--", rel]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=60)
    except (OSError, subprocess.SubprocessError) as exc:
        return None, "跑不了 git log：%s" % exc
    if out.returncode != 0:
        return None, "git log 退出码 %d：%s" % (out.returncode, (out.stderr or "").strip()[:200])
    s = (out.stdout or "").strip()
    if not s:
        return None, "git log 无输出：该文件没有提交历史"
    return _parse_date(s)


def _last_transition(text):
    """最后一次状态转换时间。

    成功返回 (date, 说明, None)；失败返回 (None, None, (类别, 原因))，
    类别 'absent' 表示文件里根本没写，可以退到提交时间；'bad' 表示写了但解析不了，
    按 01 §2 N1 记未定，不退到提交时间去猜。
    """
    val, name = find_field(text[:HEAD_CHARS] + "\n" + text, _TRANSITION_FIELDS)
    if val:
        d, err = _parse_date(val)
        if d:
            return d, "取自显式字段 %s = %s" % (name, clean(val)), None
        return None, None, ("bad", "字段 %s 的值解析不了（%s）" % (name, err))

    block = _section_body(text, _TRANSITION_HEADINGS)
    if block is None:
        rows = [ln for ln in text.splitlines() if "from" in ln.lower() and "|" in ln]
        block = "\n".join(rows) if rows else None
    if block is None:
        return None, None, ("absent", "文件里没有状态转换记录小节，也没有显式转换时间字段")

    found = []
    for token in re.findall(r"\d{4}-\d{2}-\d{2}", block):
        d, _err = _parse_date(token)
        if d:
            found.append(d)
    if not found:
        return None, None, ("absent", "状态转换记录小节里没有可解析的日期")
    return max(found), "取自状态转换记录里最晚的日期（共 %d 个）" % len(found), None


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

def _classify_stats(cfg):
    """本次 docs_root 下各分类各有几份。纯按路径算，不读文件内容。

    只为把覆盖边界说准：契约 §2 要求写明"没检查什么"，而"有多少份文档根本没被分类"
    正是这个检查器最大的盲区——它此前一个字都没写。取不到时返回 None，不猜。
    """
    docs_root = docs_root_of(cfg)[0]
    root = cfg.get("_root") or "."
    try:
        files, problem = markdown_under(root, docs_root)
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
        stats["not_required" if need == "declared_none" else need] += 1   # 同是项目声明不需要
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
            "layout.docs_root（当前 %r%s）下 git 跟踪的 *.md：日期字段是否存在、是否可解析、"
            "距基准日是否超 budgets.stale_days" % (docs_root, "，默认" if dnote else ""),
            "layout.work_root（当前 %r）下状态为进行中的工作项：最后一次状态转换距基准日"
            "是否超 budgets.work_item_stale_days" % work_root(cfg)[0],
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
            "不核实工作项状态是否属实，只读它自己写的状态字段",
            "不判断谁该处置超龄工作项，也不代为转 blocked（01 §4.1：巡检只通知负责人核实）",
            "自检只覆盖显式时间戳分支：git 提交时间回退分支、git 不可用分支与 metadata_fields "
            "自定义分支不在自检里，它们的正确性未被反例证明",
        ],
    }


def run(cfg):
    try:
        return _run(cfg)
    except Exception as exc:  # noqa: BLE001 —— 契约 §1：内部异常一律未定，绝不吞掉记 PASS
        return [undetermined_from_exception(NAME, exc, "跑 %s" % NAME)]


def _run(cfg):
    tailored, reason = is_tailored_out(cfg, NAME)
    if tailored:
        return [finding(NAME, SKIP, "项目已裁剪本检查", reason=reason or "project.yaml 未写理由")]

    root = cfg.get("_root") or "."
    today = datetime.date.today()
    base = "比较基准日 %s（取自运行时系统日期）" % today.isoformat()

    out = []
    # 文档部分整组依赖 docs_root：取了默认就在这里统一注明，不在各条 finding 里逐个拼
    out.extend(note_default(_check_docs(cfg, root, today, base), docs_root_of(cfg)[1]))
    out.extend(_check_work_items(cfg, root, today, base))
    return out


def _check_docs(cfg, root, today, base):
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

    files, problem = markdown_under(root, docs_root)
    if problem:
        return [finding(NAME, UNDETERMINED, "列不出 git 跟踪的文档", reason=problem,
                        why="契约 §1：依赖不可用记未定，不记通过")]
    if not files:
        return [finding(
            NAME, UNDETERMINED, "%s 下没有 git 跟踪的 markdown" % docs_root, where=str(docs_root),
            reason="空集上说不出'全部文档都新鲜'（01 §2 N1：X 为空集时'全部 X 通过'判未定）",
        )]

    out, frozen, unclassified, declared_none = [], [], [], []
    for rel in files:
        if in_frozen(cfg, rel):
            frozen.append(rel)
            continue
        try:
            text = read_text(os.path.join(root, rel))
        except OSError as exc:
            out.append(undetermined_from_exception(NAME, exc, "读 %s" % rel))
            continue

        value, hit = find_field(text[:HEAD_CHARS], names)
        if value is None or not clean(value):
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
            out.append(finding(
                NAME, FAIL, "缺日期字段：%s" % rel, where="%s:1" % rel,
                why="01 §3.5 要求重要文档头部带 %s；01 §3.2 要求每份文档答得出"
                    "'它过期了怎么被发现'——没有日期就发现不了" % "/".join(names),
                evidence="文件头 %d 字符内没有找到 %s。%s" % (HEAD_CHARS, "/".join(names), fnote),
            ))
            continue

        d, err = _parse_date(value)
        if d is None:
            out.append(finding(
                NAME, UNDETERMINED, "日期解析不了：%s" % rel, where="%s:1" % rel,
                reason="%s 的原文是 %r，%s；本工具不猜日期" % (hit, clean(value), err),
                why="01 §2 N1：证据不足而无法判定记未定",
                evidence=fnote,
            ))
            continue

        age = (today - d).days
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
        out.append(agg(NAME, SKIP, "归档区文档不参与新鲜度", frozen,
                       reason="落在 layout.frozen 内；01 §3.1：一次性对齐工件不承担更新义务"))
    if declared_none:
        out.append(agg(
            NAME, SKIP, "缺日期字段，项目声明没有需要日期元数据的文档类", declared_none,
            reason="project.yaml 把 metadata_required 显式写成空列表：项目声明自己没有 "
                   "01 §3.5 那六类文档（验收、架构、模块、契约、ADR、runbook）。这是项目自己的声明，"
                   "故记不适用；声明错了由写下它的人负责，本工具不复核。"
                   "键缺失不是这个意思——那种情况记未定",
            why="契约 §5：metadata_required 给了就只认它；空列表即『一类都不要求』"))
    if unclassified:
        # 整轮一条，不逐份。逐份 SKIP 会把"没看"混进"不适用"里，而且数量一大就把
        # 真正的 FAIL 淹掉；聚成一条未定，退出码从 0/1 变 2，报告里也留得下路径清单。
        out.append(agg(
            NAME, UNDETERMINED, "缺日期字段，且判不了它们属不属于 01 §3.5 的六类", unclassified,
            reason="项目未配 metadata_required，且这些路径里没有出现 acceptance / architecture / "
                   "modules / contracts / decisions / runbooks 任一目录名。"
                   "『这份文档算不算验收/架构/模块/契约/ADR/runbook』要看内容，"
                   "本工具只按目录名约定识别，机械判不了（契约 §7），故按 01 §2 N1 记未定，"
                   "不记不适用——不适用是确定结论，这里没有结论。"
                   "要给出定论，在 project.yaml 写 metadata_required（路径前缀清单，"
                   "**整体替换**目录名约定，不是追加）",
            why="01 §3.5 元信息要求覆盖六类重要文档；01 §2 N1 判不了的不记通过也不记不适用"))
    return out


def _check_work_items(cfg, root, today, base):
    wroot, wnote = work_root(cfg)

    days, used_default, bad = _int_budget(
        cfg, "budgets.work_item_stale_days", _DEFAULT_WORK_ITEM_STALE_DAYS)
    if bad:
        return [finding(NAME, UNDETERMINED, "工作项活性阈值不是正整数", reason=bad,
                        why="01 §4.1 的复查时间是参数，但必须是可比较的数")]
    note = _note(used_default, "budgets.work_item_stale_days", days) + "；" + wnote

    states = state_list(cfg, "work_item_in_progress_states", _DEFAULT_IN_PROGRESS)

    absent = work_root_absent(NAME, cfg)    # 目录在不在归 layout 报，这里不重复记未定
    if absent:
        return [absent]

    files, problem = markdown_under(root, wroot)
    if problem:
        return [finding(NAME, UNDETERMINED, "列不出 git 跟踪的工作项", reason=problem,
                        why="契约 §1：依赖不可用记未定")]

    out, frozen, nostatus, other = [], [], [], []
    for rel in files:
        if in_frozen(cfg, rel):
            frozen.append(rel)
            continue
        try:
            text = read_text(os.path.join(root, rel))
        except OSError as exc:
            out.append(undetermined_from_exception(NAME, exc, "读 %s" % rel))
            continue

        status = item_status(text)
        if status is None:
            nostatus.append(rel)
            continue
        if status not in states:
            other.append("%s（%s）" % (rel, status or "空"))
            continue

        d, how, err = _last_transition(text)
        used_git = False
        if d is None and err and err[0] == "absent":
            d, gerr = _git_commit_date(root, rel)
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

        age = (today - d).days
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
        out.append(agg(NAME, SKIP, "归档区工作项不参与活性巡检", frozen,
                       reason="落在 layout.frozen 内；01 §3.1：一次性对齐工件不承担更新义务"))
    if nostatus:
        out.append(agg(NAME, SKIP, "工作项目录下没有状态字段的文件", nostatus,
                       reason="读不到状态字段，不当作工作项（README、索引之类）；本检查只巡检有状态的工作项"))
    if other:
        out.append(agg(NAME, SKIP, "非进行中状态的工作项", other,
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


def _sample(tmp, doc_text, work_text):
    # 放在 architecture/ 下：这份样本是**照着被测约定造的**，所以它只能证明
    # "约定命中时判得对"，结构上永远抓不到"约定与标准不匹配"那一类缺陷。
    # 那一类由下面的 _sample_unconventional 覆盖。
    write_text(os.path.join(tmp, "docs", "architecture", "a.md"), doc_text)
    write_text(os.path.join(tmp, "work", "WI-0001-x.md"), work_text)
    err = git_track(tmp)
    return _cfg(tmp), err


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
    extra = ({"metadata_required": list(metadata_required)}
             if metadata_required is not None else None)
    return _cfg(tmp, extra), err


def selftest():
    """反例：无日期文档 + 停滞 100 天的进行中工作项，须判 FAIL。
    正例：昨天更新的文档 + 昨天刚转换的进行中工作项，须判 PASS。
    只覆盖显式时间戳分支；git 提交时间回退分支不在自检内（见 scope）。
    """
    results = []
    today = datetime.date.today()
    old = (today - datetime.timedelta(days=100)).isoformat()
    fresh = (today - datetime.timedelta(days=1)).isoformat()

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        cfg, err = _sample(
            tmp,
            "# 一份没有日期的文档\n\n正文。\n",
            "# WI-0001\n\n状态：**in_progress**\n\n## 状态转换记录\n\n"
            "| from → to | 时间 |\n|---|---|\n| planned → in_progress | %s |\n" % old,
        )
        got = [f["status"] for f in run(cfg)] if not err else []
        ok = (not err) and got and set(got) == {FAIL} and len(got) == 2
        results.append(finding(
            NAME, PASS if ok else FAIL,
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
        results.append(finding(
            NAME, PASS if ok else FAIL,
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
        results.append(finding(
            NAME, PASS if ok else FAIL,
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
        results.append(finding(
            NAME, PASS if ok else FAIL,
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
        results.append(finding(
            NAME, PASS if ok else FAIL,
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

    a, err_a = _stale_one(100)
    b, err_b = _stale_one(300)
    ok = (a is not None and b is not None and a["id"] == b["id"] and a["title"] != b["title"]
          and a["id"] == "%s/stale/%s" % (NAME, (a.get("where") or "")[:-2]))
    results.append(finding(
        NAME, PASS if ok else FAIL,
        "反例五：同一份文档放得更久，标题里的天数变而 id 不变（id = freshness/stale/<路径>）",
        evidence="100 天：id=%s title=%r；300 天：id=%s title=%r%s"
                 % (a["id"] if a else "（无）", a["title"] if a else "（无）",
                    b["id"] if b else "（无）", b["title"] if b else "（无）",
                    ("；git 准备失败：%s" % (err_a or err_b)) if (err_a or err_b) else ""),
        why="契约 §9：例外登记行写的就是 id，id 随天数漂就等于登记每天失效一次",
    ))
    return results
