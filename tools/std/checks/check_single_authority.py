# -*- coding: utf-8 -*-
"""单一权威：同一事实只有一个维护位置，别处写链接不抄值。

执行 01 §1 G2 与 01 §2 N2。只做文本层面的机械判定，不判语义。
契约见 ../CONTRACT.md。
"""
from __future__ import annotations

import hashlib
import io
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from stdlib import (  # noqa: E402
    FAIL, PASS, SKIP, UNDETERMINED,
    cfg_get, finding, in_frozen, is_tailored_out, tracked_files,
    undetermined_from_exception,
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
_MAX_DISCARDED_SAMPLES = 5       # 汇总那条未定里给几个代表位置

# 01 §3.7 没给这两个的数值，取本工具默认并在 evidence 里注明（契约 §5）
_DEFAULT_MIN_LINES = 3
_DEFAULT_MIN_CHARS = 60

_MAX_FINDINGS_PER_KIND = 30      # 超出部分不静默丢弃，另记一条未定
_MAX_FILE_BYTES = 2 * 1024 * 1024  # 更大的文件不读，记未定
_MIN_FILE_EFFECTIVE = 20         # 有效字符少于此数的文件不参与"逐字节相同"判定
_MAX_BLOCK_LINES = 2000

_PUNCT = set(" \t\r\n") | set(u"·—–-_=*#>|`~^!@$%&()[]{}<>/\\+:;,.?\"'"
                              u"，。、；：？！“”‘’（）《》〈〉【】〔〕…　")


# --------------------------------------------------------------------------
# 本模块自备的小工具（不改 stdlib，见任务纪律）
# --------------------------------------------------------------------------

def unquote_git_path(p):
    """还原 git ls-files 对非 ASCII 路径的 C 风格转义。

    stdlib.tracked_files 直接返回 git 原样输出；仓库里有中文路径时那是带引号
    的八进制转义串，拼出来的路径不存在。这里就地还原，不动 stdlib。
    """
    if not (len(p) >= 2 and p[0] == '"' and p[-1] == '"'):
        return p
    body = p[1:-1]
    out = bytearray()
    simple = {"n": 10, "t": 9, "r": 13, "\\": 92, '"': 34, "a": 7, "b": 8, "f": 12, "v": 11}
    i = 0
    while i < len(body):
        ch = body[i]
        if ch == "\\" and i + 1 < len(body):
            nxt = body[i + 1]
            if nxt in "01234567" and i + 3 < len(body) + 1:
                try:
                    out.append(int(body[i + 1:i + 4], 8))
                    i += 4
                    continue
                except ValueError:
                    pass
            if nxt in simple:
                out.append(simple[nxt])
                i += 2
                continue
        out.extend(ch.encode("utf-8"))
        i += 1
    return out.decode("utf-8", "replace")


def effective_chars(s):
    """去掉空白与纯标点后的有效字符。"""
    return u"".join(ch for ch in s if ch not in _PUNCT and not ch.isspace())


def is_doc(rel):
    """按后缀判断是不是"文档"。见 _DOC_SUFFIXES 上方的依据。"""
    return os.path.splitext(rel.replace("\\", "/"))[1].lower() in _DOC_SUFFIXES


_RE_HEADING = re.compile(r"^\s{0,3}#{1,6}\s")
_RE_TABLE_SEP = re.compile(r"^\s*\|?[\s:\-|]+\|[\s:\-|]*$")
_RE_HR = re.compile(r"^\s*(-{3,}|\*{3,}|_{3,}|={3,})\s*$")
_RE_ONLY_LINK = re.compile(r"^\s*(?:[-*+]\s*|\d+[.)]\s*)?(?:\*\*)?\[[^\]]*\]\([^)]*\)(?:\*\*)?\s*[，,。.；;]?\s*$")
_RE_BARE_URL = re.compile(r"^\s*(?:[-*+]\s*)?<?https?://\S+>?\s*$")
_RE_FENCE = re.compile(r"^\s*(```|~~~)")
_RE_WS = re.compile(r"\s+")

# 数字 + 量词 + 名词。误报率高，按判据 3 一律记未定。
# 首位不取 0：中文行文不把计数写成前导零（「01 个」「02 条」不成句），带前导零的
# 两位数在文档里一律是编号。本仓实测这一处收窄消掉的正是 `01 项目管理标`（10 文件）
# 与 `02 条款`（4 文件）两组编号噪声，`44 篇公众号文`、`52 个独立来源`、
# `1614 个同名文件` 等真候选一条不少。反例见 selftest 的「探测三之三」。
_RE_COUNT_CLAIM = re.compile(
    u"(?<![0-9.])([1-9][0-9]+(?:[,，][0-9]{3})*)\\s*"
    u"(个|份|条|张|处|项|次|篇|轮|页|套|组|类|种|台|块|人|家|款|批|行|列|字|步)"
    u"([\\u4e00-\\u9fa5A-Za-z][\\u4e00-\\u9fa5A-Za-z_·]{0,3})"
)
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
_RE_MD_LINK = re.compile(r"\[[^\]\n]*\]\([^)\n]*\)")

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
    if _RE_TABLE_SEP.match(line):
        return True
    if _RE_ONLY_LINK.match(line):
        return True
    if _RE_BARE_URL.match(line):
        return True
    return False


def significant_lines(text):
    """产出 [(行号, 归一化文本)]：去代码块、空行、纯标点行与结构行。"""
    out = []
    in_fence = False
    for lineno, raw in enumerate(text.splitlines(), 1):
        if _RE_FENCE.match(raw):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
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
    out = []
    in_fence = False
    for lineno, raw in enumerate(text.splitlines(), 1):
        if _RE_FENCE.match(raw):
            in_fence = not in_fence
            continue
        if in_fence or not raw.strip():
            continue
        out.append((lineno, raw))
    return out


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
    files, notes = [], {"skipped_binary": 0, "skipped_big": 0, "excluded": 0, "unreadable": 0}
    for entry in listed:
        rel = unquote_git_path(entry)
        if _excluded(cfg, rel, derived):
            notes["excluded"] += 1
            continue
        path = os.path.join(root, rel)
        if not os.path.isfile(path):
            notes["unreadable"] += 1
            continue
        try:
            size = os.path.getsize(path)
            if size > _MAX_FILE_BYTES:
                notes["skipped_big"] += 1
                continue
            with io.open(path, "rb") as fh:
                data = fh.read()
        except OSError:
            notes["unreadable"] += 1
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
        if len(effective_chars(text)) < _MIN_FILE_EFFECTIVE:
            continue
        h = hashlib.sha256(data).hexdigest()
        groups.setdefault(h, []).append(rel)
    dupes = {h: sorted(v) for h, v in groups.items() if len(v) > 1}
    return dupes


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
        for i in range(len(sig) - min_lines + 1):
            chunk = sig[i:i + min_lines]
            joined = u"\n".join(x[1] for x in chunk)
            if len(effective_chars(joined)) < min_chars:
                continue
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
            for m in _RE_COUNT_CLAIM.finditer(line):
                num = m.group(1).replace(u",", u"").replace(u"，", u"")
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
            u"等价的重复实现归 02 §4 公共能力清单，按技术债处置，不在这里判失败；"
            u"这些组汇总成一条未定，不静默丢弃",
            u"不把 .yaml / .json / .html 等配置与产物算作文档：它们之间的结构性重复"
            u"不进判据 2、3（判据 1 的逐字节相同仍然看它们）",
            u"不看非文本文件（二进制、含 NUL 或非 UTF-8 的文件）",
            u"不看未被 git 跟踪的文件（未提交、被 .gitignore 排除的一律不看）",
            u"不看单个大于 %d 字节的文件" % _MAX_FILE_BYTES,
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
    tailored, reason = is_tailored_out(cfg, NAME)
    if tailored:
        return [finding(NAME, SKIP, u"项目已裁剪本检查", reason=reason or u"project.yaml 未写理由")]

    try:
        return _run(cfg)
    except Exception as exc:  # noqa: BLE001  内部异常一律转未定，绝不吞掉记 PASS
        return [undetermined_from_exception(NAME, exc, u"跑 %s" % NAME)]


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
    if not isinstance(min_lines, int) or min_lines < 2:
        used_default.append(u"duplicate_min_lines=%d" % _DEFAULT_MIN_LINES)
        min_lines = _DEFAULT_MIN_LINES
    if not isinstance(min_chars, int) or min_chars < 1:
        used_default.append(u"duplicate_min_chars=%d" % _DEFAULT_MIN_CHARS)
        min_chars = _DEFAULT_MIN_CHARS
    thresh_note = (u"用的是默认值（%s），项目未校准" % u"、".join(used_default)) if used_default \
        else u"阈值取自 project.yaml：连续 %d 行 / 有效字符 %d" % (min_lines, min_chars)
    scanned = u"扫了 %d 个文本文件；排除归档与派生 %d 个，跳过二进制 %d 个、超大 %d 个、读不了 %d 个" % (
        len(files), notes["excluded"], notes["skipped_binary"], notes["skipped_big"], notes["unreadable"])
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
            reason=u"单类结果上限 %d 条；未列出的不等于没问题（契约 §2）" % _MAX_FINDINGS_PER_KIND,
            why=u"01 §3.4",
        ))
    if code_blocks:
        out.append(finding(
            NAME, UNDETERMINED,
            u"另有 %d 组重复文本块的全部出现位置都在非文档文件，本检查器不判" % len(code_blocks),
            reason=u"判据 2 的对象是文档（01 §1 G2 限定「同一数值/状态/清单」、§3.4 限定"
                   u"「文档 A 复制文档 B 的一段」）。源码与配置之间等价的重复实现按 "
                   u"02 §4 公共能力清单的失败处置「记入技术债并指定收敛方向」，"
                   u"不由本检查器判失败，也不当成通过",
            why=u"契约 §1：判据本身不适用记未定",
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
            why=u"01 §1 G2：数值的权威只有一处，别处应写链接不抄值",
            reason=u"疑似副本，需人确认是否为同一事实——同形数字也可能各说各的，机械判不了",
            evidence=u"出现在：%s" % u"、".join(loc),
        ))
    if len(claims) > shown:
        out.append(finding(
            NAME, UNDETERMINED, u"还有 %d 组疑似重复数值未逐条列出" % (len(claims) - shown),
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
            NAME, UNDETERMINED,
            u"另有 %d 组重复数值声明的全部出现位置都在非文档文件，本检查器不判" % len(code_claims),
            reason=u"判据 3 的对象是文档里的值（01 §1 G2、§2 N2）。源码与配置之间的同形数字"
                   u"多为常量与样板，等价的重复实现按 02 §4 公共能力清单记入技术债，"
                   u"不由本检查器判，也不当成通过",
            why=u"契约 §1：判据本身不适用记未定",
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
    for rel, body in files.items():
        path = os.path.join(tmp, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(body)
    subprocess.run(["git", "init", "-q", tmp], capture_output=True, text=True, timeout=60)
    subprocess.run(["git", "-C", tmp, "add", "-A"], capture_output=True, text=True, timeout=60)
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
        results.append(finding(
            NAME, PASS if ok else FAIL,
            u"反例一：两个逐字节相同的文件应判 FAIL",
            evidence=u"实得 %s" % got, why=u"契约 §3 静默失效探测",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(NAME, FAIL, u"反例一自身出错", evidence=u"%s: %s" % (type(exc).__name__, exc)))

    # 反例二：跨文件重复的实质文本块（两文件本身不相同）
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _mkrepo(tmp, {
                "x.md": _UNIQ_A + u"\n" + _SHARED,
                "y.md": _UNIQ_B + u"\n" + _SHARED,
            })
            got = [f["status"] for f in run(cfg)]
        ok = FAIL in got
        results.append(finding(
            NAME, PASS if ok else FAIL,
            u"反例二：跨文件重复的三行段落应判 FAIL",
            evidence=u"实得 %s" % got, why=u"契约 §3 静默失效探测",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(NAME, FAIL, u"反例二自身出错", evidence=u"%s: %s" % (type(exc).__name__, exc)))

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
        results.append(finding(
            NAME, PASS if ok else FAIL,
            u"探测三：重复数值声明出现在 %d 个文件应判未定、不得升格为失败" % _CLAIM_MIN_FILES,
            evidence=u"实得 %s" % got, why=u"契约 §1 未定不可静默升格",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(NAME, FAIL, u"探测三自身出错", evidence=u"%s: %s" % (type(exc).__name__, exc)))

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
        results.append(finding(
            NAME, PASS if ok else FAIL,
            u"探测三之二：只出现在链接文本里的数字，跨 3 个文件也不报",
            evidence=u"命中 %d 条：%s" % (
                len(hits), u"；".join(f["title"] for f in hits) or u"（无）"),
            why=u"01 §1 G2 的对象是被声明的数值；链接是指针不是数值，"
                u"把文件名当数值会把一份索引报成 21 处重复",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(
            NAME, FAIL, u"探测三之二自身出错", evidence=u"%s: %s" % (type(exc).__name__, exc)))

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
        results.append(finding(
            NAME, PASS if ok else FAIL,
            u"探测三之三：文档编号「01 项…」跨 3 个文件不得报，"
            u"同批的真计数声明「44 篇…」必须照报",
            evidence=u"编号噪声命中 %d 条：%s；真计数命中 %d 条：%s" % (
                len(noise), u"；".join(noise) or u"（无）",
                len(real), u"；".join(real) or u"（无）"),
            why=u"01 §1 G2 的对象是被声明的数值；文档编号是标识不是数值。"
                u"收窄若过头会连真计数一起吃掉，所以两侧一起钉",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(
            NAME, FAIL, u"探测三之三自身出错", evidence=u"%s: %s" % (type(exc).__name__, exc)))

    # 正例：三份互不相同、无重复段落与重复数值
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _mkrepo(tmp, {"a.md": _UNIQ_A, "b.md": _UNIQ_B, "c.md": _UNIQ_C})
            got = [f["status"] for f in run(cfg)]
        ok = bool(got) and set(got) == {PASS}
        results.append(finding(
            NAME, PASS if ok else FAIL,
            u"正例：三份互不相同的文档应全判 PASS",
            evidence=u"实得 %s" % got, why=u"契约 §3 静默失效探测",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(NAME, FAIL, u"正例自身出错", evidence=u"%s: %s" % (type(exc).__name__, exc)))

    # ---- 以下五条覆盖"判据 2、3 只判文档"这次收窄的边界。每条一个独立临时仓，
    #      不把 .py 与 .md 混在同一仓里断言 `FAIL in got`——那样分不清 FAIL 来自谁。

    # 边界一：重复只出现在源码之间 → 不得判 FAIL，须留下汇总的那条未定
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _mkrepo(tmp, {
                "doc.md": _UNIQ_A,
                "svc/alpha.py": _PY_A + _PY_BOILER,
                "svc/beta.py": _PY_B + _PY_BOILER,
            })
            res = run(cfg)
        got = [f["status"] for f in res]
        summarized = [f for f in res if f["status"] == UNDETERMINED
                      and u"都在非文档文件" in f["title"]]
        ok = FAIL not in got and len(summarized) == 1
        results.append(finding(
            NAME, PASS if ok else FAIL,
            u"边界一：重复只在 .py 之间应不判 FAIL，且汇总成一条未定",
            evidence=u"实得 %s；汇总条数 %d" % (got, len(summarized)),
            why=u"01 §1 G2 的对象是文档里的值；源码重复实现归 02 §4 技术债（契约 §1 记未定）",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(NAME, FAIL, u"边界一自身出错", evidence=u"%s: %s" % (type(exc).__name__, exc)))

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
        results.append(finding(
            NAME, PASS if ok else FAIL,
            u"边界二：文档抄源码的一段仍须判 FAIL，落点在 .md",
            evidence=u"FAIL %d 条；where=%s；title=%s" % (
                len(fails),
                fails[0].get("where") if fails else u"（无）",
                fails[0]["title"][:70] if fails else u"（无）"),
            why=u"01 §5.10 模块文档只引用不复制——收窄不得把这一类误杀",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(NAME, FAIL, u"边界二自身出错", evidence=u"%s: %s" % (type(exc).__name__, exc)))

    # 边界三：一个文档都没有的仓 → 判据 2、3 记未定，不得记 PASS
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _mkrepo(tmp, {"svc/alpha.py": _PY_A, "svc/beta.py": _PY_B})
            res = run(cfg)
        got = [f["status"] for f in res]
        nodoc = [f for f in res if f["status"] == UNDETERMINED
                 and u"没有可比对的文档文件" in f["title"]]
        ok = FAIL not in got and len(nodoc) == 2 and got.count(PASS) == 1
        results.append(finding(
            NAME, PASS if ok else FAIL,
            u"边界三：纯代码仓的判据 2、3 须记未定，不得记 PASS",
            evidence=u"实得 %s；未定（无文档）%d 条" % (got, len(nodoc)),
            why=u"01 §2 N1：空集上的「全部通过」判未定（判据 1 的 PASS 照旧，它不收窄）",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(NAME, FAIL, u"边界三自身出错", evidence=u"%s: %s" % (type(exc).__name__, exc)))

    # 边界四（回归点）：两份逐字节相同的 .py，判据 1 未收窄，仍须判 FAIL
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _mkrepo(tmp, {"svc/alpha.py": _PY_A, "vendor/alpha.py": _PY_A})
            res = run(cfg)
        fails = [f for f in res if f["status"] == FAIL and u"逐字节相同" in f["title"]]
        ok = len(fails) == 1
        results.append(finding(
            NAME, PASS if ok else FAIL,
            u"边界四：两份逐字节相同的 .py 仍须判 FAIL（判据 1 不收窄）",
            evidence=u"实得 %s" % [f["status"] for f in res],
            why=u"01 §2 N2 副本即缺陷；整份复制在代码里同样是缺陷",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(NAME, FAIL, u"边界四自身出错", evidence=u"%s: %s" % (type(exc).__name__, exc)))

    # 边界五：文档集合不止 .md——两份 .txt 的重复段落仍须判 FAIL
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _mkrepo(tmp, {
                "notes/a.txt": _UNIQ_A + u"\n" + _SHARED,
                "notes/b.rst": _UNIQ_B + u"\n" + _SHARED,
            })
            got = _statuses(cfg)
        ok = FAIL in got
        results.append(finding(
            NAME, PASS if ok else FAIL,
            u"边界五：.txt 与 .rst 之间的重复段落仍须判 FAIL",
            evidence=u"实得 %s" % got,
            why=u"文档不只有 .md；收窄到单一后缀会静默漏报",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(NAME, FAIL, u"边界五自身出错", evidence=u"%s: %s" % (type(exc).__name__, exc)))

    return results
