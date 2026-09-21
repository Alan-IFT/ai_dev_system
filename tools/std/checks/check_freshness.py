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
import io
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from stdlib import (  # noqa: E402
    FAIL, PASS, SKIP, STATUS_FIELDS, UNDETERMINED,
    cfg_get, finding, in_frozen, is_tailored_out, parse_date, read_text, tracked_files,
    undetermined_from_exception,
)

NAME = "freshness"
STANDARD_REFS = ["01 §2 N1", "01 §3.2", "01 §3.5", "01 §4.1"]

_DEFAULT_STALE_DAYS = 90              # 标准正文未给文档新鲜度默认值，本工具取 90 天作起步参数
_DEFAULT_WORK_ITEM_STALE_DAYS = 14    # 01 §4.1 的 in_progress 复查参数默认 5 天，本工具放宽到 14
_DEFAULT_DATE_FIELDS = ("updated_at",)

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
    - `"unknown"`    —— 项目没配，目录名约定也没命中。
      "这份文档算不算 01 §3.5 的六类"要看内容，不是机械可判定的（契约 §7），
      所以**不能**记成 SKIP（"不适用"是确定结论），按 01 §2 N1 记未定。

    这条改动的由来：RCMS 的 runbook 放在 `docs/ops/`，本仓的文档树是中文名
    （`docs/架构图`、`docs/审计记录`），两处的目录名约定命中率分别是 0/9 与 0/35。
    原实现把 100% 的未命中输出成 SKIP「不要求元信息」——那是在拿"我没看"冒充"不适用"。
    """
    parts = [p for p in str(rel).replace("\\", "/").split("/") if p]
    override = cfg_get(cfg, "metadata_required")
    if isinstance(override, list) and override:
        joined = "/".join(parts)
        for pre in override:
            pre = str(pre).replace("\\", "/").strip("/")
            if pre and (joined == pre or joined.startswith(pre + "/")):
                return "required"
        return "not_required"
    if any(seg in _IMPORTANT_DIRS for seg in parts[:-1]):
        return "required"
    return "unknown"


_DEFAULT_WORK_ROOT = "docs/state/work"
_DEFAULT_IN_PROGRESS = ("in_progress", "进行中")

_HEAD_CHARS = 4000        # 元信息只在文件头找；正文里再出现同名字段不算
_LIST_CAP = 12            # 聚合类 Finding 的证据里最多列几条路径

# 状态字段词表已并进 stdlib.STATUS_FIELDS（01 §1 G2：同一事实一处权威）。
_TRANSITION_FIELDS = ("last_transition_at", "state_changed_at", "最后状态转换时间", "状态更新时间")
_TRANSITION_HEADINGS = ("状态转换记录", "状态转换", "转换记录", "transition")


# --------------------------------------------------------------------------
# 小工具（stdlib 里没有，按任务约定在本模块内实现，不改公共库）
# --------------------------------------------------------------------------

def _norm_rel(p):
    return str(p).replace("\\", "/").strip()


def _under(rel, sub):
    """rel 是否落在 sub 目录下。sub 为空或 '.' 视为整仓。"""
    sub = _norm_rel(sub).rstrip("/")
    if sub in ("", "."):
        return True
    return rel == sub or rel.startswith(sub + "/")


def _find_field(text, names):
    """在文本里找 `名字: 值` 或 `名字：值`。返回 (值, 命中的名字)，找不到返回 (None, None)。

    值以换行、表格竖线或全角空格为界——示例项目把三个字段写在同一行，用全角空格分隔。
    """
    for name in names:
        pat = r"(?:^|[\s　|*>-])" + re.escape(str(name)) + r"\s*[:：]\s*([^\n　|]*)"
        m = re.search(pat, text, re.M | re.I)
        if m:
            return m.group(1).strip(), str(name)
    return None, None


def _clean(value):
    return str(value).replace("*", "").replace("`", "").strip()


# 日期解析已提到 stdlib：例外登记的到期也要解析同样的形态，留两份必然漂（01 §1 G2）。
# 本名保留是因为本模块内有七处调用点，改名只会制造无谓的 diff。
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
    val, name = _find_field(text[:_HEAD_CHARS] + "\n" + text, _TRANSITION_FIELDS)
    if val:
        d, err = _parse_date(val)
        if d:
            return d, "取自显式字段 %s = %s" % (name, _clean(val)), None
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


def _date_fields(cfg):
    """文档日期字段名。返回 (名字列表, 是否用的默认值)。"""
    raw = cfg_get(cfg, "metadata_fields")
    if raw is None:
        return list(_DEFAULT_DATE_FIELDS), True
    if isinstance(raw, str):
        return [raw], False
    if isinstance(raw, dict):
        for key in ("updated_at", "updated", "date"):
            if raw.get(key):
                return [str(raw[key])], False
        return list(_DEFAULT_DATE_FIELDS), True
    if isinstance(raw, list):
        names = [str(x).strip() for x in raw if str(x).strip()]
        if names:
            return names, False
    return list(_DEFAULT_DATE_FIELDS), True


def _int_budget(cfg, path, default):
    raw = cfg_get(cfg, path)
    if raw is None:
        return default, True, None
    if isinstance(raw, bool) or not isinstance(raw, int) or raw <= 0:
        return None, False, "%s = %r，不是正整数" % (path, raw)
    return raw, False, None


def _markdown_under(root, sub):
    """sub 目录下 git 跟踪的 markdown。返回 (相对路径列表, 问题)。"""
    files, problem = tracked_files(root)
    if problem:
        return None, problem
    out = []
    for f in files:
        rel = _norm_rel(f)
        if rel.lower().endswith(".md") and _under(rel, sub):
            out.append(rel)
    return sorted(out), None


def _note(used_default, name, value):
    if used_default:
        return "%s 用的是本工具默认值 %s，项目未校准（契约 §5）" % (name, value)
    return "%s = %s，取自 project.yaml" % (name, value)


def _agg(status, title, paths, reason, why=""):
    shown = paths[:_LIST_CAP]
    more = "" if len(paths) <= _LIST_CAP else "；另有 %d 份未列出" % (len(paths) - _LIST_CAP)
    return finding(
        NAME, status, "%s（%d 份）" % (title, len(paths)),
        reason=reason, why=why,
        evidence="；".join(shown) + more,
    )


# --------------------------------------------------------------------------
# 契约接口
# --------------------------------------------------------------------------

def _classify_stats(cfg):
    """本次 docs_root 下各分类各有几份。纯按路径算，不读文件内容。

    只为把覆盖边界说准：契约 §2 要求写明"没检查什么"，而"有多少份文档根本没被分类"
    正是这个检查器最大的盲区——它此前一个字都没写。取不到时返回 None，不猜。
    """
    docs_root = cfg_get(cfg, "layout.docs_root")
    root = cfg.get("_root") or "."
    if not docs_root:
        return None
    try:
        files, problem = _markdown_under(root, docs_root)
    except Exception:  # noqa: BLE001  覆盖边界不该把主流程带崩
        return None
    if problem or files is None:
        return None
    stats = {"required": 0, "not_required": 0, "unknown": 0, "frozen": 0}
    for rel in files:
        if in_frozen(cfg, rel):
            stats["frozen"] += 1
            continue
        stats[_metadata_requirement(cfg, rel)] += 1
    stats["scanned"] = stats["required"] + stats["not_required"] + stats["unknown"]
    return stats


def scope(cfg):
    docs_root = cfg_get(cfg, "layout.docs_root")
    work_root = cfg_get(cfg, "layout.work_root") or _DEFAULT_WORK_ROOT
    stats = _classify_stats(cfg)
    if stats is None:
        cls = ("本次未能统计分类结果（未配 docs_root 或列不出 git 跟踪的文档）")
    else:
        cls = ("本次参与分类的 %d 份文档里（另有归档区 %d 份不参与），判定为需要元信息 %d 份、"
               "项目声明不需要 %d 份、**未能分类 %d 份**"
               % (stats["scanned"], stats["frozen"], stats["required"],
                  stats["not_required"], stats["unknown"]))
    return {
        "covered": [
            "layout.docs_root（当前 %r）下 git 跟踪的 *.md：日期字段是否存在、是否可解析、"
            "距基准日是否超 budgets.stale_days" % (docs_root or "（未配置）"),
            "layout.work_root（当前 %r）下状态为进行中的工作项：最后一次状态转换距基准日"
            "是否超 budgets.work_item_stale_days" % work_root,
        ],
        "not_covered": [
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
    out.extend(_check_docs(cfg, root, today, base))
    out.extend(_check_work_items(cfg, root, today, base))
    return out


def _check_docs(cfg, root, today, base):
    docs_root = cfg_get(cfg, "layout.docs_root")
    if not docs_root:
        return [finding(
            NAME, UNDETERMINED, "未配置文档根目录",
            reason="governance/project.yaml 缺 layout.docs_root；本工具不猜文档放在哪（契约 §5）",
            why="01 §3.5 要求重要文档带日期，但先要说清哪些是文档",
        )]

    days, used_default, bad = _int_budget(cfg, "budgets.stale_days", _DEFAULT_STALE_DAYS)
    if bad:
        return [finding(NAME, UNDETERMINED, "文档新鲜度阈值不是正整数", reason=bad,
                        why="01 §3.5 的复核周期是参数，但必须是可比较的数")]
    note = _note(used_default, "budgets.stale_days", days)

    names, names_default = _date_fields(cfg)
    fnote = ("日期字段名用的是默认 %s（未配 metadata_fields）" % ", ".join(names)
             if names_default else "日期字段名取自 metadata_fields：%s" % ", ".join(names))

    path = os.path.join(root, _norm_rel(docs_root))
    if not os.path.isdir(path):
        return [finding(
            NAME, UNDETERMINED, "文档根目录不存在：%s" % docs_root, where=str(docs_root),
            reason="layout.docs_root 指向的目录不在；是配置过期还是目录被移走，本工具判不了",
            why="01 §3.1：文档树是约定的位置，位置不成立则新鲜度无从判起",
        )]

    files, problem = _markdown_under(root, docs_root)
    if problem:
        return [finding(NAME, UNDETERMINED, "列不出 git 跟踪的文档", reason=problem,
                        why="契约 §1：依赖不可用记未定，不记通过")]
    if not files:
        return [finding(
            NAME, UNDETERMINED, "%s 下没有 git 跟踪的 markdown" % docs_root, where=str(docs_root),
            reason="空集上说不出'全部文档都新鲜'（01 §2 N1：X 为空集时'全部 X 通过'判未定）",
        )]

    out, frozen, unclassified = [], [], []
    for rel in files:
        if in_frozen(cfg, rel):
            frozen.append(rel)
            continue
        try:
            text = read_text(os.path.join(root, rel))
        except OSError as exc:
            out.append(undetermined_from_exception(NAME, exc, "读 %s" % rel))
            continue

        value, hit = _find_field(text[:_HEAD_CHARS], names)
        if value is None or not _clean(value):
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
            out.append(finding(
                NAME, FAIL, "缺日期字段：%s" % rel, where="%s:1" % rel,
                why="01 §3.5 要求重要文档头部带 %s；01 §3.2 要求每份文档答得出"
                    "'它过期了怎么被发现'——没有日期就发现不了" % "/".join(names),
                evidence="文件头 %d 字符内没有找到 %s。%s" % (_HEAD_CHARS, "/".join(names), fnote),
            ))
            continue

        d, err = _parse_date(value)
        if d is None:
            out.append(finding(
                NAME, UNDETERMINED, "日期解析不了：%s" % rel, where="%s:1" % rel,
                reason="%s 的原文是 %r，%s；本工具不猜日期" % (hit, _clean(value), err),
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
        out.append(_agg(SKIP, "归档区文档不参与新鲜度", frozen,
                        reason="落在 layout.frozen 内；01 §3.1：一次性对齐工件不承担更新义务"))
    if unclassified:
        # 整轮一条，不逐份。逐份 SKIP 会把"没看"混进"不适用"里，而且数量一大就把
        # 真正的 FAIL 淹掉；聚成一条未定，退出码从 0/1 变 2，报告里也留得下路径清单。
        out.append(_agg(
            UNDETERMINED, "缺日期字段，且判不了它们属不属于 01 §3.5 的六类", unclassified,
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
    work_root = cfg_get(cfg, "layout.work_root")
    root_default = work_root is None
    work_root = work_root or _DEFAULT_WORK_ROOT

    days, used_default, bad = _int_budget(
        cfg, "budgets.work_item_stale_days", _DEFAULT_WORK_ITEM_STALE_DAYS)
    if bad:
        return [finding(NAME, UNDETERMINED, "工作项活性阈值不是正整数", reason=bad,
                        why="01 §4.1 的复查时间是参数，但必须是可比较的数")]
    note = _note(used_default, "budgets.work_item_stale_days", days)
    if root_default:
        note += "；work_root 用的是默认 %s（未配 layout.work_root）" % _DEFAULT_WORK_ROOT

    states = cfg_get(cfg, "work_item_in_progress_states") or list(_DEFAULT_IN_PROGRESS)
    if isinstance(states, str):
        states = [states]
    states = [str(s).strip().lower() for s in states if str(s).strip()]

    path = os.path.join(root, _norm_rel(work_root))
    if not os.path.isdir(path):
        return [finding(
            NAME, UNDETERMINED, "工作项目录不存在：%s" % work_root, where=str(work_root),
            reason="项目可能还没建工作项，或 layout.work_root 配错；两者本工具分不出",
            why="01 §4.1 的活性巡检以工作项为对象，对象不在则判不了（契约 §1）",
            evidence=note,
        )]

    files, problem = _markdown_under(root, work_root)
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

        raw, _hit = _find_field(text[:_HEAD_CHARS], STATUS_FIELDS)
        if raw is None:
            nostatus.append(rel)
            continue
        status = re.split(r"[（(]", _clean(raw))[0].strip().lower()
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
        out.append(_agg(SKIP, "归档区工作项不参与活性巡检", frozen,
                        reason="落在 layout.frozen 内；01 §3.1：一次性对齐工件不承担更新义务"))
    if nostatus:
        out.append(_agg(SKIP, "工作项目录下没有状态字段的文件", nostatus,
                        reason="读不到状态字段，不当作工作项（README、索引之类）；本检查只巡检有状态的工作项"))
    if other:
        out.append(_agg(SKIP, "非进行中状态的工作项", other,
                        reason="01 §4.1 对 planned / blocked / in_validation 也要求巡检，"
                               "但复查时间是每项自己约定的值，工具读不到，故不判"))
    if not out:
        out.append(finding(
            NAME, UNDETERMINED, "%s 下没有可判定的工作项" % work_root, where=str(work_root),
            reason="空集上说不出'全部工作项都活着'（01 §2 N1）", evidence=note,
        ))
    return out


# --------------------------------------------------------------------------
# 自检：反例与正例各一（契约 §3）
# --------------------------------------------------------------------------

def _write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with io.open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def _git_init(tmp):
    """自检样本要被 git 跟踪才进得了扫描范围。返回 None 或错误串。"""
    for cmd in (["git", "-c", "init.defaultBranch=main", "init", "-q", tmp],
                ["git", "-C", tmp, "add", "-A", "-f"]):
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=60)
        except (OSError, subprocess.SubprocessError) as exc:
            return "%s 跑不了：%s" % (cmd[0], exc)
        if out.returncode != 0:
            return "%s 退出码 %d：%s" % (" ".join(cmd[:3]), out.returncode,
                                        (out.stderr or "").strip()[:200])
    return None


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
    _write(os.path.join(tmp, "docs", "architecture", "a.md"), doc_text)
    _write(os.path.join(tmp, "work", "WI-0001-x.md"), work_text)
    err = _git_init(tmp)
    return _cfg(tmp), err


def _sample_unconventional(tmp, work_text, metadata_required=None):
    """路径**不匹配任何目录名约定**的两份无日期文档，其中一份是中文名。

    造法：一份用真实踩过的形态（RCMS 的 runbook 在 `docs/ops/`，目录名不在
    `_IMPORTANT_DIRS` 里），一份用本工具自己仓库的形态（中文目录 + 中文文件名，
    一套英文目录名约定对它零命中）。中文名那份是关键——上面那份还能靠加
    `*runbook*` 文件名模式蒙对，中文树连蒙的机会都没有。
    """
    _write(os.path.join(tmp, "docs", "ops", "pitr-runbook.md"),
           "# PITR 恢复手册\n\n正文：按时间点恢复的操作步骤。\n")
    _write(os.path.join(tmp, "docs", "运维", "数据恢复手册.md"),
           "# 数据恢复手册\n\n正文：故障后的数据恢复步骤。\n")
    _write(os.path.join(tmp, "work", "WI-0001-x.md"), work_text)
    err = _git_init(tmp)
    extra = {"metadata_required": list(metadata_required)} if metadata_required else None
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
