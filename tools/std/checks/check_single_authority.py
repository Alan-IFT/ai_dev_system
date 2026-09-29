# -*- coding: utf-8 -*-
"""单一权威：同一事实只有一个维护位置，别处写链接不抄值。

执行 01 §1 G2 与 01 §2 N2。只做文本层面的机械判定，不判语义。
契约见 ../CONTRACT.md。
"""
from __future__ import annotations

import hashlib
import os
import re
import sys
import tempfile
import time

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 放末尾：不遮住标准库

from stdlib import (  # noqa: E402
    read_bytes, MAX_READ_BYTES, NotRegular, TooLarge, FAIL, PASS, SKIP, UNDETERMINED,
    cfg_get, finding, in_frozen, tracked_files, run_guarded, probe, probe_crashed, write_files, git_track,
)

NAME = "single-authority"
STANDARD_REFS = ["01 §1 G2", "01 §2 N2", "01 §3.4", "01 §5.10"]

# 判据 2、3 的对象是"文档"。01 §1 G2 的检查方式限定为「同一数值/状态/清单」，
# §2 N2 的举例限定为「值」，§3.4 禁止的关系写的是「文档 A 复制文档 B 的一段」，
# §5.10 反向确认它管的是文档↔代码而不是代码↔代码。源码之间等价的重复实现按
# 02 §4「公共能力清单」的失败处置记入技术债，不由本检查器判失败。
#
# 注意：过滤发生在**出报告时**，不在收集时。收集阶段照旧扫全部跟踪文本，
# 只有当一组重复的**全部出现位置**都落在非文档文件时才丢弃。这样
# 「文档抄了代码里的一段」（§5.10 的对象）仍然报得出来。
_DOC_SUFFIXES = (".md", ".markdown", ".txt", ".rst", ".adoc", ".org")
_MAX_DISCARDED_SAMPLES = 5       # 汇总那条 SKIP 里给几个代表位置

# 01 §3.7 没给这两个的数值，取本工具默认并在 evidence 里注明（契约 §5）
_DEFAULT_MIN_LINES = 3
_DEFAULT_MIN_CHARS = 60

_MAX_FINDINGS_PER_KIND = 30      # 超出部分不静默丢弃，另记一条未定
_MIN_FILE_EFFECTIVE = 20         # 有效字符少于此数的文件不参与"逐字节相同"判定
_MAX_BLOCK_LINES = 2000

_PUNCT = set(" \t\r\n") | set(u"·—–-_=*#>|`~^!@$%&()[]{}<>/\\+:;,.?\"'"
                              u"，。、；：？！“”‘’（）《》〈〉【】〔〕…　")


# --------------------------------------------------------------------------
# 本模块自备的小工具（不改 stdlib，见任务纪律）
# --------------------------------------------------------------------------

_RE_NOT_EFFECTIVE = re.compile(u"[%s\\s]+" % u"".join(re.escape(c) for c in sorted(_PUNCT)))


def effective_chars(s):
    """去掉空白与纯标点后的有效字符。（一次正则替换：逐字符生成式曾占本检查器大半耗时。）"""
    return _RE_NOT_EFFECTIVE.sub(u"", s)


def is_doc(rel):
    """按后缀判断是不是"文档"。见 _DOC_SUFFIXES 上方的依据。"""
    return os.path.splitext(rel.replace("\\", "/"))[1].lower() in _DOC_SUFFIXES


_RE_HEADING = re.compile(r"^\s{0,3}#{1,6}\s")
# 表格分隔行：整行只有空白、冒号、短横与竖线，且第 2 个字符起有竖线。原写法 `\|?[\s:\-|]+\|[\s:\-|]*$`
# 两段量词重叠，一行 6 万个竖线后跟一个别的字要跑 18 秒；拆成整行字符集 + 竖线位置两步，线性
_RE_TABLE_CHARS = re.compile(r"[\s:\-|]*")
_RE_HR = re.compile(r"^\s*(-{3,}|\*{3,}|_{3,}|={3,})\s*$")
# 行尾 `\s*(?:[，,。.；;]\s*)?$`：原写法 `\s*[…]?\s*$` 两段 `\s*` 隔着可省的标点，长空白后跟一个字就平方级
_RE_ONLY_LINK = re.compile(r"^\s*(?:[-*+]\s*|\d+[.)]\s*)?(?:\*\*)?\[[^\]]*\]\([^)]*\)(?:\*\*)?\s*(?:[，,。.；;]\s*)?$")
_RE_BARE_URL = re.compile(r"^\s*(?:[-*+]\s*)?<?https?://\S+>?\s*$")
# CommonMark 围栏：同一字符连续 3 个以上；闭合须同字符、不短于开围栏、其后只有空白（同 check_drift）
_RE_FENCE = re.compile(r"^\s*(`{3,}|~{3,})(.*)$")
_RE_WS = re.compile(r"\s+")

# 数字 + 量词 + 名词。误报率高，按判据 3 一律记未定。
# 首位不取 0：中文行文不把计数写成前导零（「01 个」「02 条」不成句），带前导零的
# 两位数在文档里一律是编号。本仓实测这一处收窄消掉的正是 `01 项目管理标`（10 文件）
# 与 `02 条款`（4 文件）两组编号噪声，`44 篇公众号文`、`52 个独立来源`
# 等真候选一条不少。反例见 selftest 的「探测三之三」。
# 千分位只认半角逗号后恰好三位（「1,614」整取，不截成「614」），比较时去逗号。全角「，」是
# 标点不是千分位：采用方实测的「截至 09-21，933 个自然日」是一个日期加一个计数，不是 21933。
# 「3,45 个」「1、2」不并成一个数。反例见 selftest 的「探测三之五」。
_RE_COUNT_CLAIM = re.compile(
    u"(?<![0-9.])([1-9][0-9]{0,2}(?:,[0-9]{3})+|[1-9][0-9]+)\\s*"
    u"(个|份|条|张|处|项|次|篇|轮|页|套|组|类|种|台|块|人|家|款|批|行|列|字|步)"
    u"([\\u4e00-\\u9fa5A-Za-z][\\u4e00-\\u9fa5A-Za-z_·]{0,3})"
)
# 序数不是计数：「第 16 个部件」「第 15、16 个部件」说的是位次，不声明有多少。
# 只看数字前面紧挨着的「第」，或「第 N、」起头的并列序数；「3、16 个文件」
# 这种不带「第」的并列照常计。反例见 selftest 的「探测三之四」。
# 按行一次 finditer 取各序数前缀的终点，数字起点落在终点上即序数。原写法对每个数值匹配都从行首
# search 一遍 `…$`，一行几千个「第 12 个」就是平方级
_RE_ORDINAL_PREFIX = re.compile(u"第\\s*(?:[0-9]+\\s*、\\s*)*")

# 名词只取前两字作键。同一事实在不同句子里后接的字不同（「192 份归档，按季度」
# 与「192 份归档由资料员保管」），按全长比会漏判。放宽只会多报，而本判据按设计
# 一律记未定，不会因此升格为失败。
_CLAIM_NOUN_KEY = 2

# markdown 链接构造：链接文本与链接目标都不是"这份文档在声明一个数值"，
# 而是"这份文档在指向另一份文档"。本仓实测：`[40 人的检查点与授权](...)` 这个
# 文件名被当成一条数值声明，本仓实测这一条就吃掉 21 个文件位。
# （这里刻意不把那个形态原样抄进注释——抄了本文件自己就成了它的第 N 处出现。）
# 判据 2 用 _RE_ONLY_LINK 挡掉了**整行只有链接**的行，但这些命中都在表格行与
# 正文句子里（`README.md:37` 是「责任平面：[40 …](…)」），整行判挡不住。
# 所以按构造挡：把链接整段换成等长空格，同一行里链接之外的数值照常参与判定。
# 链接文本不含 `[`、目标不含 `(`：原写法 `\[[^\]\n]*\]\([^)\n]*\)` 对满行 `[` 每个起点都扫到行尾（64KB 6 秒）；
# 排除之后每个起点只扫到下一个 `[`／`(`，线性（嵌套方括号、目标带圆括号的链接因此不遮，与 check_links 同）
_RE_MD_LINK = re.compile(r"\[[^\[\]\n]*\]\([^()\n]*\)")

# 一组要出现在几个文件才报。阈值 2 时本仓 31 组里 20 组是"2 个文件"，
# 其中经人工逐条核对真候选 0 个；N2 点名的"版本号、条数、状态摘要"那一类
# （架构部件数、来源数、原则条数）实测都出现在 3 个以上文件。
# 不做成配置键：这是判据自身的召回位置，不是项目参数（契约 §1.1）。
_CLAIM_MIN_FILES = 3


def _mask_links(raw):
    """把整行里的 markdown 链接构造换成等长空格，其余字符原样保留。"""
    return _RE_MD_LINK.sub(lambda m: u" " * (m.end() - m.start()), raw)


def _is_structural(line):
    """目录、索引、链接行、标题行这类天然重复的结构，不算实质文本。"""
    if _RE_HEADING.match(line):
        return True
    if _RE_HR.match(line):
        return True
    if _RE_TABLE_CHARS.fullmatch(line) and u"|" in line[1:]:
        return True
    if _RE_ONLY_LINK.match(line):
        return True
    if _RE_BARE_URL.match(line):
        return True
    return False


def _unfenced(text):
    """产出围栏代码块之外的 (行号, 原文)。反引号围栏的信息串不得含反引号：一行 ```x``` 是行内代码，
    不开围栏——原先见到 ``` 就翻转，这样一行会让其后全文被当成代码块跳过。"""
    fence = None
    for lineno, raw in enumerate(text.splitlines(), 1):
        m = _RE_FENCE.match(raw)
        if fence:
            if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence) and not m.group(2).strip():
                fence = None
            continue
        if m and not (m.group(1)[0] == u"`" and u"`" in m.group(2)):
            fence = m.group(1)
            continue
        yield lineno, raw


def significant_lines(text):
    """产出 [(行号, 归一化文本)]：去代码块、空行、纯标点行与结构行。"""
    out = []
    for lineno, raw in _unfenced(text):
        s = raw.strip()
        if not s:
            continue
        if not effective_chars(s):
            continue
        if _is_structural(raw):
            continue
        out.append((lineno, _RE_WS.sub(u" ", s)))
    return out


def prose_lines(text):
    """产出 [(行号, 原文)]：只去代码块与空行，供数值判据用。"""
    return [(lineno, raw) for lineno, raw in _unfenced(text) if raw.strip()]


def _declared_derived_artifacts(cfg):
    """project.yaml 里声明为派生的工件，由 check_derived 管，这里不重复报。"""
    out = set()
    for item in cfg_get(cfg, "derived", []) or []:
        if isinstance(item, dict) and item.get("artifact"):
            out.add(str(item["artifact"]).replace("\\", "/").lstrip("./"))
    return out


def _excluded(cfg, rel, derived):
    if in_frozen(cfg, rel):
        return "只读归档区（01 §3.1，不承担更新义务）"
    if rel.replace("\\", "/").lstrip("./") in derived:
        return "已声明为派生工件，归 derived-artifacts 检查"
    return None


def _collect(cfg):
    """读出参与判定的文本文件。返回 (files, notes, problem)。

    files: [(relpath, text, raw_bytes)]
    """
    root = cfg.get("_root") or "."
    listed, problem = tracked_files(root)
    if listed is None:
        return None, None, problem
    derived = _declared_derived_artifacts(cfg)
    files, notes = [], {"skipped_binary": 0, "skipped_big": 0, "excluded": 0, "unreadable": 0,
                        "absent": 0, "big_paths": [], "unreadable_paths": []}
    for entry in listed:
        rel = entry          # tracked_files 走 -z，路径原样，不需要还原转义
        if _excluded(cfg, rel, derived):
            notes["excluded"] += 1
            continue
        path = os.path.join(root, rel)
        try:                              # 直接读：护栏在 read_bytes 里先于任何探测（B15）
            data = read_bytes(path, root)
        except TooLarge:
            notes["skipped_big"] += 1
            notes["big_paths"].append(rel)
            continue
        except OSError as exc:
            # 已删未提交、子模块（目录）：不是可读的文本对象。走到 NotRegular 时护栏已过，isdir 不出仓
            if isinstance(exc, FileNotFoundError) or (isinstance(exc, NotRegular) and os.path.isdir(path)):
                notes["absent"] += 1
                continue
            notes["unreadable"] += 1
            notes["unreadable_paths"].append("%s（%s）" % (rel, type(exc).__name__))
            continue
        if b"\x00" in data:
            notes["skipped_binary"] += 1
            continue
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            notes["skipped_binary"] += 1
            continue
        files.append((rel, text, data))
    return files, notes, None


# --------------------------------------------------------------------------
# 判据 1：逐字节相同的文件
# --------------------------------------------------------------------------

def _identical_files(files):
    groups = {}
    for rel, text, data in files:
        groups.setdefault(hashlib.sha256(data).hexdigest(), []).append((rel, text))
    # 同一组内容相同，有效字符只需在成组的那一份上算一次
    return {h: sorted(r for r, _t in v) for h, v in groups.items()
            if len(v) > 1 and len(effective_chars(v[0][1])) >= _MIN_FILE_EFFECTIVE}


# --------------------------------------------------------------------------
# 判据 2：跨文件重复的实质文本块
# --------------------------------------------------------------------------

def _duplicate_blocks(files, min_lines, min_chars, skip_rels):
    """skip_rels 是逐字节相同组里除代表外的其余文件：已按判据 1 报过，
    不再当成第二遍重复；但每组留一个代表参与比对，否则它与第三个文件
    共有的段落会被一起漏掉。"""
    idx_hash = {}
    by_hash = {}
    order = []
    for rel, text, _data in files:
        if rel in skip_rels:
            continue
        sig = significant_lines(text)
        if len(sig) < min_lines:
            continue
        # 窗口的有效字符数 = 各行之和（行间的 \n 本就不计），滑动累加，不再每个窗口重算
        eff = [len(effective_chars(x[1])) for x in sig]
        width = sum(eff[:min_lines])
        for i in range(len(sig) - min_lines + 1):
            if i:
                width += eff[i + min_lines - 1] - eff[i - 1]
            if width < min_chars:
                continue
            chunk = sig[i:i + min_lines]
            joined = u"\n".join(x[1] for x in chunk)
            h = hashlib.sha1(joined.encode("utf-8")).hexdigest()
            idx_hash[(rel, i)] = h
            if h not in by_hash:
                by_hash[h] = []
                order.append(h)
            by_hash[h].append((rel, i, chunk[0][0], chunk[0][1]))

    covered = {}
    reports = []
    for h in order:
        occ = by_hash[h]
        if len({o[0] for o in occ}) < 2:
            continue
        if all(o[1] in covered.get(o[0], ()) for o in occ):
            continue
        work = [(o[0], o[1]) for o in occ]
        length = min_lines
        while length < _MAX_BLOCK_LINES:
            nxt = [(rel, i + 1) for rel, i in work]
            hs = {idx_hash.get(k) for k in nxt}
            if None in hs or len(hs) != 1:
                break
            work = nxt
            length += 1
        for rel, i, _ln, _first in occ:
            covered.setdefault(rel, set()).update(range(i, i + length))
        reports.append({
            "length": length,
            "places": sorted((o[0], o[2]) for o in occ),
            "first": occ[0][3],
        })
    return reports


# --------------------------------------------------------------------------
# 判据 3：重复的具体数值声明（误报率高，一律未定）
# --------------------------------------------------------------------------

def _count_claims(files):
    claims = {}
    for rel, text, _data in files:
        for lineno, raw in prose_lines(text):
            line = _mask_links(raw)
            ordinal_ends = {o.end() for o in _RE_ORDINAL_PREFIX.finditer(line)}
            for m in _RE_COUNT_CLAIM.finditer(line):
                if m.start(1) in ordinal_ends:
                    continue
                num = m.group(1).replace(u",", u"")
                key = (num, m.group(2), m.group(3)[:_CLAIM_NOUN_KEY])
                claims.setdefault(key, {}).setdefault(rel, (lineno, m.group(0)))
    return {k: v for k, v in claims.items() if len(v) >= _CLAIM_MIN_FILES}


# --------------------------------------------------------------------------
# 接口
# --------------------------------------------------------------------------

def scope(cfg):
    frozen = cfg_get(cfg, "layout.frozen", []) or []
    return {
        "covered": [
            u"git 跟踪的 UTF-8 文本文件：内容逐字节相同的成组报出（不分文档与源码）",
            u"跨文件重复的实质文本段落（默认连续 %d 行、有效字符 ≥%d），"
            u"只要有一处落在文档里就报——包括「文档抄了源码里的一段」（01 §5.10）"
            % (_DEFAULT_MIN_LINES, _DEFAULT_MIN_CHARS),
            u"同一「数字+量词+名词」组合出现在 %d 个以上文件、且至少一处在文档里"
            u"（只报未定，不判失败）" % (_CLAIM_MIN_FILES - 1),
            u"算文档的后缀：%s" % u" ".join(_DOC_SUFFIXES),
        ],
        "not_covered": [
            u"判据 2、3 不判「全部出现位置都在非文档文件」的重复——源码与配置之间"
            u"等价的重复实现归 02 §4 公共能力清单，按技术债处置，不在这里判；"
            u"这些组汇总成一条 SKIP（判据不适用，契约 §1），带代表位置，不静默丢弃",
            u"不把 .yaml / .json / .html 等配置与产物算作文档：它们之间的结构性重复"
            u"不进判据 2、3（判据 1 的逐字节相同仍然看它们）",
            u"不看非文本文件（二进制、含 NUL 或非 UTF-8 的文件）",
            u"不看未被 git 跟踪的文件（未提交、被 .gitignore 排除的一律不看）",
            u"不看单个大于 %d 字节的文件" % MAX_READ_BYTES,
            u"不判断两处内容是否语义相同，只判文本——换个说法写同一事实抓不到",
            u"不跨仓库比对（跨仓副本归 check_cross_repo）",
            u"不看代码块（``` 围栏之间）里的重复，除非整文件逐字节相同",
            u"不看标题行、目录/索引行、纯链接行、表格分隔行这类天然重复的结构",
            u"判据 3 不看 markdown 链接构造里的数字（链接文本与链接目标都换成空格再匹配）"
            u"——那是指向另一份文档，不是在声明一个数值；同一行链接之外的数值照常判",
            u"判据 3 不看带前导零的两位数（「01 项」「02 条」这种文档编号）："
            u"中文行文不把计数写成前导零。代价是真写成「05 份」的计数声明也看不见",
            u"判据 3 不报只出现在 2 个文件的组：本仓实测这一档 20 组、真候选 0 组。"
            u"召回换准确的取舍写在这里，不是漏判——需要更高召回时改 _CLAIM_MIN_FILES",
            u"不看只读归档区 layout.frozen：%s（01 §3.1）" % (u"、".join(map(str, frozen)) or u"（未配置）"),
            u"不看 project.yaml 里已声明为派生的工件（归 derived-artifacts）",
            u"不判断成组的两份里哪一份该是权威——那是人的取舍，不是机械判定",
        ],
    }


def run(cfg):
    return run_guarded(NAME, _run, cfg)


def _run(cfg):
    out = []
    files, notes, problem = _collect(cfg)
    if files is None:
        return [finding(
            NAME, UNDETERMINED, u"列不出 git 跟踪的文件，本检查未执行",
            reason=problem,
            why=u"01 §2 N1：检查未运行记未定，不记通过",
        )]
    if not files:
        return [finding(
            NAME, UNDETERMINED, u"没有可比对的文本文件",
            reason=u"git 跟踪的文件里没有一个通过文本过滤；空集上的『全部通过』判未定（01 §2 N1）",
            evidence=u"排除 %d 个（归档/派生），二进制 %d 个" % (notes["excluded"], notes["skipped_binary"]),
        )]

    min_lines = cfg_get(cfg, "budgets.duplicate_min_lines")
    min_chars = cfg_get(cfg, "budgets.duplicate_min_chars")
    used_default = []
    # 写了却不合法的值 load_config 已整份拒收（stdlib._bad_dup_budgets），走到这里只剩缺失与合法两种
    if min_lines is None:
        used_default.append(u"duplicate_min_lines=%d" % _DEFAULT_MIN_LINES)
        min_lines = _DEFAULT_MIN_LINES
    if min_chars is None:
        used_default.append(u"duplicate_min_chars=%d" % _DEFAULT_MIN_CHARS)
        min_chars = _DEFAULT_MIN_CHARS
    thresh_note = (u"用的是默认值（%s），项目未校准" % u"、".join(used_default)) if used_default \
        else u"阈值取自 project.yaml：连续 %d 行 / 有效字符 %d" % (min_lines, min_chars)
    scanned = u"扫了 %d 个文本文件；排除归档与派生 %d 个，跳过二进制 %d 个、超大 %d 个、读不了 %d 个" % (
        len(files), notes["excluded"], notes["skipped_binary"], notes["skipped_big"], notes["unreadable"])
    # 没读的文件不是"没有重复"：读不了、超大的各汇一条未定（契约 §1：依赖不可用记未定）
    for key, kind, what in (("unreadable_paths", u"unreadable", u"读不了"),
                            ("big_paths", u"too-big", u"超过 %d 字节未读" % MAX_READ_BYTES)):
        paths = notes[key]
        if paths:
            out.append(finding(
                NAME, UNDETERMINED, u"%d 个被跟踪文件%s，其中的重复判不了" % (len(paths), what),
                kind=kind, reason=u"没读到内容的文件不参与三条判据；它们里有没有副本，本次没看",
                why=u"01 §2 N1：检查未覆盖的对象记未定，不记通过",
                evidence=u"；".join(paths[:10]) + (u"；另有 %d 个未列出" % (len(paths) - 10) if len(paths) > 10 else u"")))
    doc_count = sum(1 for rel, _t, _d in files if is_doc(rel))
    doc_note = u"其中算文档的 %d 个（后缀 %s）" % (doc_count, u" ".join(_DOC_SUFFIXES))
    no_doc_reason = (
        u"扫到的 %d 个文本文件里没有一个是文档（后缀 %s）。判据 2、3 的对象是文档"
        u"（01 §1 G2 限定「同一数值/状态/清单」、§3.4 限定「文档 A 复制文档 B」），"
        u"空集上说不出「全部通过」，按 01 §2 N1 记未定" % (len(files), u" ".join(_DOC_SUFFIXES))
    )

    # 判据 1
    dupes = _identical_files(files)
    dup_rels = set()
    for rels in dupes.values():
        dup_rels.update(rels[1:])  # 每组留第一个作代表，其余不再进判据 2
    shown = 0
    for h in sorted(dupes, key=lambda k: dupes[k][0]):
        rels = dupes[h]
        if shown >= _MAX_FINDINGS_PER_KIND:
            break
        shown += 1
        out.append(finding(
            NAME, FAIL,
            u"%d 个文件内容逐字节相同：%s" % (len(rels), u"、".join(rels)),
            where=rels[0],
            why=u"01 §1 G2 同一事实只有一个维护位置；01 §2 N2 副本即缺陷——两份必然漂移",
            evidence=u"sha256=%s；%s" % (h[:16], scanned),
        ))
    if len(dupes) > shown:
        out.append(finding(
            NAME, UNDETERMINED, u"还有 %d 组逐字节相同的文件未逐条列出" % (len(dupes) - shown),
            kind=u"overflow-identical",
            reason=u"单类结果上限 %d 条；未列出的不等于没问题（契约 §2）" % _MAX_FINDINGS_PER_KIND,
            why=u"01 §2 N2",
        ))
    if not dupes:
        out.append(finding(
            NAME, PASS, u"没有内容逐字节相同的两个文件",
            why=u"01 §2 N2 副本即缺陷", evidence=scanned,
        ))

    # 判据 2。收集阶段照旧扫全部文本，出报告时才分流：一组重复的全部出现位置
    # 都落在非文档文件才丢弃；只要有一处在文档里就照常报（含「文档抄代码」）。
    blocks = _duplicate_blocks(files, min_lines, min_chars, dup_rels)
    doc_blocks, code_blocks = [], []
    for rep in blocks:
        (doc_blocks if any(is_doc(r) for r, _ln in rep["places"]) else code_blocks).append(rep)
    shown = 0
    for rep in doc_blocks:
        if shown >= _MAX_FINDINGS_PER_KIND:
            break
        shown += 1
        places = u"、".join(u"%s:%d" % (r, ln) for r, ln in rep["places"])
        out.append(finding(
            NAME, FAIL,
            u"%d 行实质文本重复出现在 %d 处：%s" % (rep["length"], len(rep["places"]), places),
            where=u"%s:%d" % (rep["places"][0][0], rep["places"][0][1]),
            why=u"01 §3.4 禁止的关系：文档 A 复制文档 B 的一段，应改为引用；01 §2 N2 副本即缺陷；"
                u"文档抄源码的一段见 01 §5.10「模块文档只引用不复制」",
            evidence=u"首行：%s；%s" % (rep["first"][:80], thresh_note),
        ))
    if len(doc_blocks) > shown:
        out.append(finding(
            NAME, UNDETERMINED, u"还有 %d 处重复文本块未逐条列出" % (len(doc_blocks) - shown),
            kind=u"overflow-dup-block",
            reason=u"单类结果上限 %d 条；未列出的不等于没问题（契约 §2）" % _MAX_FINDINGS_PER_KIND,
            why=u"01 §3.4",
        ))
    if code_blocks:
        out.append(finding(
            NAME, SKIP,
            u"另有 %d 组重复文本块的全部出现位置都在非文档文件，本检查器不判" % len(code_blocks),
            kind=u"nondoc-dup-block",
            reason=u"判据 2 的对象是文档（01 §1 G2 限定「同一数值/状态/清单」、§3.4 限定"
                   u"「文档 A 复制文档 B 的一段」）。源码与配置之间等价的重复实现按 "
                   u"02 §4 公共能力清单的失败处置「记入技术债并指定收敛方向」，"
                   u"不由本检查器判失败，也不当成通过。判据的对象是文档，这组的全部位置"
                   u"都不是文档，所以不适用",
            why=u"契约 §1：不适用记 SKIP 并给理由",
            evidence=u"代表位置：%s%s" % (
                u"、".join(u"%s:%d" % (rep["places"][0][0], rep["places"][0][1])
                          for rep in code_blocks[:_MAX_DISCARDED_SAMPLES]),
                u"（共 %d 组，只列前 %d 组）" % (len(code_blocks), _MAX_DISCARDED_SAMPLES)
                if len(code_blocks) > _MAX_DISCARDED_SAMPLES else u""),
        ))
    if not doc_blocks:
        if not doc_count:
            out.append(finding(
                NAME, UNDETERMINED, u"没有可比对的文档文件，判据 2 给不出结论",
                reason=no_doc_reason,
                why=u"01 §2 N1：空集上的「全部通过」记未定",
                evidence=u"%s；%s" % (scanned, doc_note),
            ))
        else:
            out.append(finding(
                NAME, PASS, u"没有跨文件重复的实质文本块（至少一处在文档里的）",
                why=u"01 §3.4 复制应改为引用",
                evidence=u"%s；%s；%s" % (thresh_note, scanned, doc_note),
            ))

    # 判据 3：一律未定。分流规则同判据 2——全部出现位置都在非文档文件才丢弃。
    all_claims = _count_claims(files)
    claims, code_claims = {}, {}
    for key, places in all_claims.items():
        (claims if any(is_doc(r) for r in places) else code_claims)[key] = places
    shown = 0
    for key in sorted(claims, key=lambda k: (k[1], k[2], k[0])):
        if shown >= _MAX_FINDINGS_PER_KIND:
            break
        shown += 1
        places = claims[key]
        loc = sorted(u"%s:%d" % (r, v[0]) for r, v in places.items())
        sample = list(places.values())[0][1]
        out.append(finding(
            NAME, UNDETERMINED,
            u"同一数值声明「%s」出现在 %d 个文件" % (sample.strip(), len(places)),
            where=loc[0],
            # key 用 _count_claims 已经算出的三元组（数字:量词:名词键），不用 sample 与计数：
            # 再多一个文件抄同一个值，标题里的计数会变，这条发现还是同一条。
            kind=u"count-claim", key=u"%s:%s:%s" % key,
            why=u"01 §1 G2：数值的权威只有一处，别处应写链接不抄值",
            reason=u"疑似副本，需人确认是否为同一事实——同形数字也可能各说各的，机械判不了",
            evidence=u"出现在：%s" % u"、".join(loc),
        ))
    if len(claims) > shown:
        out.append(finding(
            NAME, UNDETERMINED, u"还有 %d 组疑似重复数值未逐条列出" % (len(claims) - shown),
            kind=u"overflow-count-claim",
            reason=u"单类结果上限 %d 条；未列出的不等于没问题（契约 §2）" % _MAX_FINDINGS_PER_KIND,
            why=u"01 §1 G2",
        ))
    if code_claims:
        samples = sorted(
            u"%s:%d" % (r, v[0])
            for key in sorted(code_claims, key=lambda k: (k[1], k[2], k[0]))[:_MAX_DISCARDED_SAMPLES]
            for r, v in [sorted(code_claims[key].items())[0]]
        )
        out.append(finding(
            NAME, SKIP,
            u"另有 %d 组重复数值声明的全部出现位置都在非文档文件，本检查器不判" % len(code_claims),
            kind=u"nondoc-count-claim",
            reason=u"判据 3 的对象是文档里的值（01 §1 G2、§2 N2）。源码与配置之间的同形数字"
                   u"多为常量与样板，等价的重复实现按 02 §4 公共能力清单记入技术债，"
                   u"不由本检查器判，也不当成通过。判据的对象是文档，这组的全部位置"
                   u"都不是文档，所以不适用",
            why=u"契约 §1：不适用记 SKIP 并给理由",
            evidence=u"代表位置：%s%s" % (
                u"、".join(samples),
                u"（共 %d 组，只列前 %d 组）" % (len(code_claims), _MAX_DISCARDED_SAMPLES)
                if len(code_claims) > _MAX_DISCARDED_SAMPLES else u""),
        ))
    if not claims:
        if not doc_count:
            out.append(finding(
                NAME, UNDETERMINED, u"没有可比对的文档文件，判据 3 给不出结论",
                reason=no_doc_reason,
                why=u"01 §2 N1：空集上的「全部通过」记未定",
                evidence=u"%s；%s" % (scanned, doc_note),
            ))
        else:
            out.append(finding(
                NAME, PASS, u"没有同一「数字+量词+名词」组合跨文件出现在文档里",
                why=u"01 §1 G2 别处引用写链接、不抄值",
                evidence=u"%s；%s" % (scanned, doc_note),
            ))
    return out


# --------------------------------------------------------------------------
# 自检（契约 §3）
# --------------------------------------------------------------------------

def _mkrepo(tmp, files):
    write_files(tmp, files)
    git_track(tmp)
    return {"_root": tmp, "layout": {"frozen": []}}


_UNIQ_A = u"""# 甲文档

库存模块负责把门店盘点结果写回中心账，写入口只有一个。
它对外只暴露一个幂等接口，重复提交按同一次盘点合并。
出错时不回滚整批，只标记失败行并交由人工复核。
"""

_UNIQ_B = u"""# 乙文档

结算模块按天切账，切账窗口关闭后不再接受补录。
补录走单独的调整单流程，调整单必须绑定原始凭证。
调整单由财务负责人批准，批准记录随单存档。
"""

_UNIQ_C = u"""# 丙文档

配送模块只读取已确认的订单，未确认订单不进入排线。
排线结果发布后冻结，改动需新建一次排线并作废旧的。
作废原因写在排线记录里，不改动已发布的那一份。
"""

_SHARED = u"""退款口径由结算模块单独维护，别处引用它的接口而不抄写规则。
抄写会在下一次口径变化时留下一份不会更新的旧值。
因此本节只给出指针，具体数值到结算模块文档去读。
"""

# 源码样例。刻意不用 # 注释行——那会被 _RE_HEADING 当成标题行滤掉，测不出东西。
_PY_A = u'''import json


def load_manifest(path, tenant):
    with open(path, encoding="utf-8") as fh:
        payload = json.load(fh)
    payload["tenant"] = tenant
    return payload
'''

_PY_B = u'''import os


def resolve_workspace(base, name):
    target = os.path.join(base, "workspaces", name)
    os.makedirs(target, exist_ok=True)
    return target
'''

# 两个 .py 共有的样板段落：三行以上、有效字符足够，跨文件重复但不该判失败。
_PY_BOILER = u'''
def guard_tenant(request, registry):
    tenant = request.headers.get("X-Tenant-Id") or registry.default_tenant
    if tenant not in registry.known_tenants:
        raise PermissionError("unknown tenant: %s" % tenant)
    return tenant
'''

# .py 的模块 docstring 里的一段散文，被 .md 原样抄走——这正是 01 §5.10 的对象。
_PY_WITH_DOCSTRING = u'"""结算模块。\n\n' + _SHARED + u'"""\n' + _PY_A


def _statuses(cfg):
    return [f["status"] for f in run(cfg)]


def selftest():
    results = []

    # 反例一：两个文件逐字节相同
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _mkrepo(tmp, {"a.md": _UNIQ_A, "copy/a.md": _UNIQ_A, "b.md": _UNIQ_B})
            got = [f["status"] for f in run(cfg)]
        ok = FAIL in got
        results.append(probe(NAME, ok,
            u"反例一：两个逐字节相同的文件应判 FAIL",
            evidence=u"实得 %s" % got, why=u"契约 §3 静默失效探测",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(probe_crashed(NAME, u"反例一", exc))

    # 反例一之二（D-123 bug 3）：读不了的副本不许让「没有逐字节相同」照常 PASS——须各出一条未定
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _mkrepo(tmp, {"a.md": _UNIQ_A, "copy/a.md": _UNIQ_A, "b.md": _UNIQ_B})
            locked = os.path.join(tmp, "copy", "a.md")
            os.chmod(locked, 0)
            try:
                # 以 root 跑时 chmod 000 挡不住读，样本不成立，跳过这一条（不算失败）
                got = None if os.access(locked, os.R_OK) else [(f["status"], f["id"]) for f in run(cfg)]
            finally:
                os.chmod(locked, 0o644)
        if got is not None:
            results.append(probe(NAME, (UNDETERMINED, NAME + "/unreadable") in got,
                u"反例一之二：读不了的被跟踪文件须记一条未定（single-authority/unreadable）",
                evidence=u"实得 %s" % got, why=u"契约 §1：依赖不可用记未定，不得吞掉记 PASS",
            ))
    except Exception as exc:  # noqa: BLE001
        results.append(probe_crashed(NAME, u"反例一之二", exc))

    # 反例一之三（B15）：指向仓外的被跟踪软链接先过护栏，不得先 isfile 探测仓外存在性；记未定。
    # 已删未提交的文件仍按不在处理，不记未定
    try:
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as outside_dir:
            os.symlink(os.path.join(outside_dir, "gone.md"), os.path.join(tmp, "ext.md"))
            cfg = _mkrepo(tmp, {"a.md": _UNIQ_A, "b.md": _UNIQ_B, "deleted.md": _UNIQ_C})
            os.remove(os.path.join(tmp, "deleted.md"))
            probed, real_isfile = [], os.path.isfile
            os.path.isfile = lambda p: (probed.append(p), real_isfile(p))[1]
            try:
                got = [(f["status"], f["id"]) for f in run(cfg)]
            finally:
                os.path.isfile = real_isfile
        leak = [p for p in probed if p.endswith("ext.md")]
        ok = not leak and (UNDETERMINED, NAME + "/unreadable") in got and got.count((UNDETERMINED, NAME + "/unreadable")) == 1
        results.append(probe(NAME, ok,
            u"反例一之三：仓外软链接不得被 isfile 探测、记一条未定；已删未提交的文件不记未定",
            evidence=u"探测 %s；实得 %s" % (leak, got), why=u"契约 §5：字面就在项目之外的路径连存在性也不探测",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(probe_crashed(NAME, u"反例一之三", exc))

    # 反例二：跨文件重复的实质文本块（两文件本身不相同）
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _mkrepo(tmp, {
                "x.md": _UNIQ_A + u"\n" + _SHARED,
                "y.md": _UNIQ_B + u"\n" + _SHARED,
            })
            got = [f["status"] for f in run(cfg)]
        ok = FAIL in got
        results.append(probe(NAME, ok,
            u"反例二：跨文件重复的三行段落应判 FAIL",
            evidence=u"实得 %s" % got, why=u"契约 §3 静默失效探测",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(probe_crashed(NAME, u"反例二", exc))

    # 探测三：同一数值声明出现在 _CLAIM_MIN_FILES 个文件，按判据 3 应得未定而非失败。
    # 文件数跟着阈值走：阈值从 2 收到 3 那次，这条曾是唯一会当场变红的自检项。
    try:
        with tempfile.TemporaryDirectory() as tmp:
            files = {
                "m.md": _UNIQ_A + u"\n当前共有 192 份归档，按季度清点一次。\n",
                "n.md": _UNIQ_B + u"\n仓库里 192 份归档由资料员保管。\n",
                "o.md": _UNIQ_C + u"\n异地机房另存 192 份归档的副本。\n",
            }
            cfg = _mkrepo(tmp, dict(list(files.items())[:_CLAIM_MIN_FILES]))
            got = [f["status"] for f in run(cfg)]
        ok = UNDETERMINED in got and FAIL not in got
        results.append(probe(NAME, ok,
            u"探测三：重复数值声明出现在 %d 个文件应判未定、不得升格为失败" % _CLAIM_MIN_FILES,
            evidence=u"实得 %s" % got, why=u"契约 §1 未定不可静默升格",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(probe_crashed(NAME, u"探测三", exc))

    # 探测三之三（id 稳定性，契约 §9）：同一个数值再被一个文件抄一遍，**标题里的计数要变、
    # id 不能变**。id 变了登记就失效——每多一个抄的人，上一次写下的登记行就作废一次，
    # 例外登记会退化成"每次重跑都要重抄一遍"。所以 key 取 _count_claims 的三元组，不取计数。
    try:
        base_files = dict(list(files.items())[:_CLAIM_MIN_FILES])
        plus_files = dict(base_files)
        plus_files["p.md"] = _UNIQ_A.replace(u"甲文档", u"丁文档") \
            + u"\n第四处也写了 192 份归档，按同一口径清点。\n"
        with tempfile.TemporaryDirectory() as tmp2:
            cfg = _mkrepo(tmp2, base_files)
            few = [f for f in run(cfg) if f["id"].startswith(NAME + u"/count-claim/")]
        with tempfile.TemporaryDirectory() as tmp3:
            cfg = _mkrepo(tmp3, plus_files)
            more = [f for f in run(cfg) if f["id"].startswith(NAME + u"/count-claim/")]
        ok = (len(few) == 1 and len(more) == 1
              and few[0]["id"] == more[0]["id"]
              and few[0]["title"] != more[0]["title"])
        results.append(probe(NAME, ok,
            u"探测三之三：再加一个抄同一数值的文件，标题计数变而 id 不变",
            evidence=u"%d 个文件：id=%s title=%r；%d 个文件：id=%s title=%r"
                     % (len(base_files),
                        few[0]["id"] if few else u"（无）", few[0]["title"] if few else u"（无）",
                        len(plus_files),
                        more[0]["id"] if more else u"（无）", more[0]["title"] if more else u"（无）"),
            why=u"契约 §9：id 的稳定性是例外登记能用的前提——登记行写的就是 id",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(probe_crashed(NAME, u"探测三之三", exc))

    # 探测三之二（本次收窄的反例）：同一个数字只出现在 markdown 链接文本里，
    # 出现在足够多的文件也不得报——它是指向另一份文档，不是在声明一个数值。
    # 没有这条，"链接构造不算"就只是一句注释；本仓那 21 个文件位正是这个形态。
    try:
        with tempfile.TemporaryDirectory() as tmp:
            body = {}
            for i, uniq in enumerate((_UNIQ_A, _UNIQ_B, _UNIQ_C), 1):
                body["k%d.md" % i] = uniq + u"\n责任平面：[40 人的检查点与授权](docs/40-x.md)\n"
            res = run(_mkrepo(tmp, body))
        hits = [f for f in res if u"同一数值声明" in f["title"]]
        ok = not hits and FAIL not in [f["status"] for f in res]
        results.append(probe(NAME, ok,
            u"探测三之二：只出现在链接文本里的数字，跨 3 个文件也不报",
            evidence=u"命中 %d 条：%s" % (
                len(hits), u"；".join(f["title"] for f in hits) or u"（无）"),
            why=u"01 §1 G2 的对象是被声明的数值；链接是指针不是数值，"
                u"把文件名当数值会把一份索引报成 21 处重复",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(probe_crashed(NAME, u"探测三之二", exc))

    # 探测三之三（本次收窄的反例）：带前导零的两位数是文档编号，不是计数声明。
    # 跨 _CLAIM_MIN_FILES 个文件出现也不得报。同一批里再放一条真计数声明
    # （`44 篇公众号文`）作对照——它必须照常报出来，否则这次收窄就是把判据关掉了。
    try:
        with tempfile.TemporaryDirectory() as tmp:
            body = {}
            for i, uniq in enumerate((_UNIQ_A, _UNIQ_B, _UNIQ_C), 1):
                body["z%d.md" % i] = (
                    uniq
                    + u"\n口径以 01 项目管理标准 的小节号为准，不另抄一份。\n"
                    + u"\n本轮共收 44 篇公众号文章，逐篇留了摘录。\n")
            res = run(_mkrepo(tmp, body))
        titles = [f["title"] for f in res if u"同一数值声明" in f["title"]]
        noise = [t for t in titles if u"01 项" in t]
        real = [t for t in titles if u"44 篇" in t]
        ok = not noise and len(real) == 1 and FAIL not in [f["status"] for f in res]
        results.append(probe(NAME, ok,
            u"探测三之三：文档编号「01 项…」跨 3 个文件不得报，"
            u"同批的真计数声明「44 篇…」必须照报",
            evidence=u"编号噪声命中 %d 条：%s；真计数命中 %d 条：%s" % (
                len(noise), u"；".join(noise) or u"（无）",
                len(real), u"；".join(real) or u"（无）"),
            why=u"01 §1 G2 的对象是被声明的数值；文档编号是标识不是数值。"
                u"收窄若过头会连真计数一起吃掉，所以两侧一起钉",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(probe_crashed(NAME, u"探测三之三", exc))

    # 探测三之四：序数「第 N 个」「第 N、M 个」不是计数，跨 3 个文件不得报；
    # 同批不带「第」的真计数「23 个部件」与并列「3、18 个文件」必须照报——排除只认「第」。
    try:
        with tempfile.TemporaryDirectory() as tmp:
            body = {}
            for i, uniq in enumerate((_UNIQ_A, _UNIQ_B, _UNIQ_C), 1):
                body["q%d.md" % i] = (
                    uniq
                    + u"\n边缘的不算第 15、16 个部件，也不算第 17 个部件。\n"
                    + u"\n本轮共有 23 个部件在册，另有 3、18 个文件两批。\n")
            res = run(_mkrepo(tmp, body))
        titles = [f["title"] for f in res if u"同一数值声明" in f["title"]]
        noise = [t for t in titles if any(n in t for n in (u"15 个", u"16 个", u"17 个"))]
        real = [t for t in titles if u"23 个" in t or u"18 个" in t]
        ok = not noise and len(real) == 2 and FAIL not in [f["status"] for f in res]
        results.append(probe(NAME, ok,
            u"探测三之四：序数「第 N 个」「第 N、M 个」跨 3 个文件不得报，"
            u"同批的基数「23 个…」「3、18 个…」必须照报",
            evidence=u"序数命中 %d 条：%s；基数命中 %d 条：%s" % (
                len(noise), u"；".join(noise) or u"（无）",
                len(real), u"；".join(real) or u"（无）"),
            why=u"01 §1 G2 的对象是被声明的数值；序数是位次不是数值。"
                u"排除若过头会连并列基数一起吃掉，所以两侧一起钉",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(probe_crashed(NAME, u"探测三之四", exc))

    # 探测三之五：千分位「1,614」与「1614」是同一个数；「3,45 个」「1、2」与全角「，」不并数。
    try:
        line = u"库里共 1,614 条记录，另有 3,45 个文件、1、2 项注，至 09-21，933 个自然日。\n"
        keys = set(_count_claims([(u"k%d.md" % i, t, None) for i, t in
                                  enumerate((line, line.replace(u"1,614", u"1614"), line))]))
        want = {(u"1614", u"条", u"记录"), (u"45", u"个", u"文件"), (u"933", u"个", u"自然")}
        results.append(probe(NAME, keys == want,
            u"探测三之五：「1,614」与「1614」同键，「3,45」「1、2」「21，933」不并数",
            evidence=u"实得 %s" % sorted(keys),
            why=u"截成「614」会与别处的 614 误并，又与写成 1614 的同一事实漏并",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(probe_crashed(NAME, u"探测三之五", exc))

    # 线性（B3）：结构行与序数、链接遮盖的正则曾是平方级，一行 6 万字符的单行文件就能拖住提交闸门
    # （旧正则下四行合计约 35 秒）。同时钉住结构行的认法不变
    try:
        t0 = time.time()
        _is_structural(u"|" * 60000 + u"x")
        _is_structural(u"[a](b)" + u" " * 60000 + u"x")
        _count_claims([(u"l.md", u"第 12 个文件 " * 6000, None)])
        _mask_links(u"[" * 60000)
        took = time.time() - t0
        shapes = [_is_structural(x) for x in (u"|---|:-:|", u" |---", u"||", u"|", u"---",
                                              u"- [a](b.md)。", u"[a](b)  x")]
        ok = took < 2 and shapes == [True, True, True, False, True, True, False]
        results.append(probe(NAME, ok,
            u"线性：6 万字符的竖线行、链接后长空白行、满行「第 12 个」与满行 `[` 须在 2 秒内，结构行认法不变",
            evidence=u"耗时 %.3fs；结构行判定 %s" % (took, shapes),
            why=u"检查器没有整体超时，一个平方级正则就能拖死提交闸门",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(probe_crashed(NAME, u"线性一条", exc))

    # 反例二之二（B4）：一行 ```x``` 是行内代码不开围栏，4 反引号外层里的 ``` 不闭合外层——
    # 旧实现见 ``` 就翻转，其后的重复段落整段被跳过，FAIL 翻成 PASS
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _mkrepo(tmp, {
                "x.md": _UNIQ_A + u"\n```x``` 是行内代码。\n\n" + _SHARED,
                "y.md": _UNIQ_B + u"\n````md\n```\n样例\n```\n````\n\n" + _SHARED,
            })
            fails = [f for f in run(cfg) if f["status"] == FAIL]
        ok = len(fails) == 1 and u"x.md" in fails[0]["title"] and u"y.md" in fails[0]["title"]
        results.append(probe(NAME, ok,
            u"反例二之二：行内 ```x``` 与外层 4 反引号围栏之后的重复段落仍须判 FAIL",
            evidence=u"实得 FAIL %s" % [f["title"][:60] for f in fails], why=u"契约 §3 静默失效探测",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(probe_crashed(NAME, u"反例二之二", exc))

    # 正例：三份互不相同、无重复段落与重复数值
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _mkrepo(tmp, {"a.md": _UNIQ_A, "b.md": _UNIQ_B, "c.md": _UNIQ_C})
            got = [f["status"] for f in run(cfg)]
        ok = bool(got) and set(got) == {PASS}
        results.append(probe(NAME, ok,
            u"正例：三份互不相同的文档应全判 PASS",
            evidence=u"实得 %s" % got, why=u"契约 §3 静默失效探测",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(probe_crashed(NAME, u"正例", exc))

    # ---- 以下五条覆盖"判据 2、3 只判文档"这次收窄的边界。每条一个独立临时仓，
    #      不把 .py 与 .md 混在同一仓里断言 `FAIL in got`——那样分不清 FAIL 来自谁。

    # 边界一：重复只出现在源码之间 → 不得判 FAIL，也不得记未定，须留下汇总的那条 SKIP
    #         （判据不适用，契约 §1）；id 仍是 nondoc-dup-block，采用方旧登记行只失效不成孤儿
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _mkrepo(tmp, {
                "doc.md": _UNIQ_A,
                "svc/alpha.py": _PY_A + _PY_BOILER,
                "svc/beta.py": _PY_B + _PY_BOILER,
            })
            res = run(cfg)
        got = [f["status"] for f in res]
        summarized = [f for f in res if f["status"] == SKIP
                      and u"都在非文档文件" in f["title"]]
        ok = (FAIL not in got and UNDETERMINED not in got and len(summarized) == 1
              and summarized[0]["id"] == NAME + u"/nondoc-dup-block")
        results.append(probe(NAME, ok,
            u"边界一：重复只在 .py 之间应不判 FAIL、不记未定，且汇总成一条 SKIP（id 不变）",
            evidence=u"实得 %s；汇总条数 %d；id %s" % (
                got, len(summarized), summarized[0]["id"] if summarized else u"（无）"),
            why=u"01 §1 G2 的对象是文档里的值；源码重复实现归 02 §4 技术债（契约 §1 不适用记 SKIP）",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(probe_crashed(NAME, u"边界一", exc))

    # 边界一之二：同形数值只出现在源码之间 → 同样汇总成一条 SKIP，id 不变
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _mkrepo(tmp, dict(
                ("svc/%s.py" % n, u"# 本模块共 12 个部件\nX_%s = 1\n" % n.upper())
                for n in ("alpha", "beta", "gamma")))
            res = run(cfg)
        got = [f["status"] for f in res]
        summarized = [f for f in res if f["id"] == NAME + u"/nondoc-count-claim"]
        ok = (UNDETERMINED not in [f["status"] for f in res if u"都在非文档文件" in f["title"]]
              and len(summarized) == 1 and summarized[0]["status"] == SKIP)
        results.append(probe(NAME, ok,
            u"边界一之二：同形数值只在 .py 之间应汇总成一条 SKIP（id 不变）",
            evidence=u"实得 %s；汇总 %s" % (got, [f["status"] for f in summarized]),
            why=u"判据 3 的对象是文档里的值；源码常量归 02 §4 技术债（契约 §1 不适用记 SKIP）",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(probe_crashed(NAME, u"边界一之二", exc))

    # 边界二：.md 抄了 .py 里的一段 → 仍须判 FAIL，且落点在 .md 不在 .py
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _mkrepo(tmp, {
                "doc.md": _UNIQ_B + u"\n" + _SHARED,
                "svc/settle.py": _PY_WITH_DOCSTRING,
            })
            res = run(cfg)
        fails = [f for f in res if f["status"] == FAIL]
        ok = (len(fails) == 1
              and (fails[0].get("where") or u"").startswith(u"doc.md:")
              and u"svc/settle.py" in fails[0]["title"])
        results.append(probe(NAME, ok,
            u"边界二：文档抄源码的一段仍须判 FAIL，落点在 .md",
            evidence=u"FAIL %d 条；where=%s；title=%s" % (
                len(fails),
                fails[0].get("where") if fails else u"（无）",
                fails[0]["title"][:70] if fails else u"（无）"),
            why=u"01 §5.10 模块文档只引用不复制——收窄不得把这一类误杀",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(probe_crashed(NAME, u"边界二", exc))

    # 边界三：一个文档都没有的仓 → 判据 2、3 记未定，不得记 PASS
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _mkrepo(tmp, {"svc/alpha.py": _PY_A, "svc/beta.py": _PY_B})
            res = run(cfg)
        got = [f["status"] for f in res]
        nodoc = [f for f in res if f["status"] == UNDETERMINED
                 and u"没有可比对的文档文件" in f["title"]]
        ok = FAIL not in got and len(nodoc) == 2 and got.count(PASS) == 1
        results.append(probe(NAME, ok,
            u"边界三：纯代码仓的判据 2、3 须记未定，不得记 PASS",
            evidence=u"实得 %s；未定（无文档）%d 条" % (got, len(nodoc)),
            why=u"01 §2 N1：空集上的「全部通过」判未定（判据 1 的 PASS 照旧，它不收窄）",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(probe_crashed(NAME, u"边界三", exc))

    # 边界四（回归点）：两份逐字节相同的 .py，判据 1 未收窄，仍须判 FAIL
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _mkrepo(tmp, {"svc/alpha.py": _PY_A, "vendor/alpha.py": _PY_A})
            res = run(cfg)
        fails = [f for f in res if f["status"] == FAIL and u"逐字节相同" in f["title"]]
        ok = len(fails) == 1
        results.append(probe(NAME, ok,
            u"边界四：两份逐字节相同的 .py 仍须判 FAIL（判据 1 不收窄）",
            evidence=u"实得 %s" % [f["status"] for f in res],
            why=u"01 §2 N2 副本即缺陷；整份复制在代码里同样是缺陷",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(probe_crashed(NAME, u"边界四", exc))

    # 边界五：文档集合不止 .md——两份 .txt 的重复段落仍须判 FAIL
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _mkrepo(tmp, {
                "notes/a.txt": _UNIQ_A + u"\n" + _SHARED,
                "notes/b.rst": _UNIQ_B + u"\n" + _SHARED,
            })
            got = _statuses(cfg)
        ok = FAIL in got
        results.append(probe(NAME, ok,
            u"边界五：.txt 与 .rst 之间的重复段落仍须判 FAIL",
            evidence=u"实得 %s" % got,
            why=u"文档不只有 .md；收窄到单一后缀会静默漏报",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(probe_crashed(NAME, u"边界五", exc))

    return results
