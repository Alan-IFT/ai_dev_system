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
STANDARD_REFS = ["01 §1 G2", "01 §2 N2", "01 §3.4"]

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


_RE_HEADING = re.compile(r"^\s{0,3}#{1,6}\s")
_RE_TABLE_SEP = re.compile(r"^\s*\|?[\s:\-|]+\|[\s:\-|]*$")
_RE_HR = re.compile(r"^\s*(-{3,}|\*{3,}|_{3,}|={3,})\s*$")
_RE_ONLY_LINK = re.compile(r"^\s*(?:[-*+]\s*|\d+[.)]\s*)?(?:\*\*)?\[[^\]]*\]\([^)]*\)(?:\*\*)?\s*[，,。.；;]?\s*$")
_RE_BARE_URL = re.compile(r"^\s*(?:[-*+]\s*)?<?https?://\S+>?\s*$")
_RE_FENCE = re.compile(r"^\s*(```|~~~)")
_RE_WS = re.compile(r"\s+")

# 数字 + 量词 + 名词。误报率高，按判据 3 一律记未定。
_RE_COUNT_CLAIM = re.compile(
    u"(?<![0-9.])([0-9]{2,}(?:[,，][0-9]{3})*)\\s*"
    u"(个|份|条|张|处|项|次|篇|轮|页|套|组|类|种|台|块|人|家|款|批|行|列|字|步)"
    u"([\\u4e00-\\u9fa5A-Za-z][\\u4e00-\\u9fa5A-Za-z_·]{0,3})"
)
# 名词只取前两字作键。同一事实在不同句子里后接的字不同（「192 份归档，按季度」
# 与「192 份归档由资料员保管」），按全长比会漏判。放宽只会多报，而本判据按设计
# 一律记未定，不会因此升格为失败。
_CLAIM_NOUN_KEY = 2


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
            for m in _RE_COUNT_CLAIM.finditer(raw):
                num = m.group(1).replace(u",", u"").replace(u"，", u"")
                key = (num, m.group(2), m.group(3)[:_CLAIM_NOUN_KEY])
                claims.setdefault(key, {}).setdefault(rel, (lineno, m.group(0)))
    return {k: v for k, v in claims.items() if len(v) > 1}


# --------------------------------------------------------------------------
# 接口
# --------------------------------------------------------------------------

def scope(cfg):
    frozen = cfg_get(cfg, "layout.frozen", []) or []
    return {
        "covered": [
            u"git 跟踪的 UTF-8 文本文件：内容逐字节相同的成组报出",
            u"跨文件重复的实质文本段落（默认连续 %d 行、有效字符 ≥%d）"
            % (_DEFAULT_MIN_LINES, _DEFAULT_MIN_CHARS),
            u"同一「数字+量词+名词」组合出现在两个以上文件（只报未定，不判失败）",
        ],
        "not_covered": [
            u"不看非文本文件（二进制、含 NUL 或非 UTF-8 的文件）",
            u"不看未被 git 跟踪的文件（未提交、被 .gitignore 排除的一律不看）",
            u"不看单个大于 %d 字节的文件" % _MAX_FILE_BYTES,
            u"不判断两处内容是否语义相同，只判文本——换个说法写同一事实抓不到",
            u"不跨仓库比对（跨仓副本归 check_cross_repo）",
            u"不看代码块（``` 围栏之间）里的重复，除非整文件逐字节相同",
            u"不看标题行、目录/索引行、纯链接行、表格分隔行这类天然重复的结构",
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

    # 判据 2
    blocks = _duplicate_blocks(files, min_lines, min_chars, dup_rels)
    shown = 0
    for rep in blocks:
        if shown >= _MAX_FINDINGS_PER_KIND:
            break
        shown += 1
        places = u"、".join(u"%s:%d" % (r, ln) for r, ln in rep["places"])
        out.append(finding(
            NAME, FAIL,
            u"%d 行实质文本重复出现在 %d 处：%s" % (rep["length"], len(rep["places"]), places),
            where=u"%s:%d" % (rep["places"][0][0], rep["places"][0][1]),
            why=u"01 §3.4 禁止的关系：文档 A 复制文档 B 的一段，应改为引用；01 §2 N2 副本即缺陷",
            evidence=u"首行：%s；%s" % (rep["first"][:80], thresh_note),
        ))
    if len(blocks) > shown:
        out.append(finding(
            NAME, UNDETERMINED, u"还有 %d 处重复文本块未逐条列出" % (len(blocks) - shown),
            reason=u"单类结果上限 %d 条；未列出的不等于没问题（契约 §2）" % _MAX_FINDINGS_PER_KIND,
            why=u"01 §3.4",
        ))
    if not blocks:
        out.append(finding(
            NAME, PASS, u"没有跨文件重复的实质文本块",
            why=u"01 §3.4 复制应改为引用", evidence=u"%s；%s" % (thresh_note, scanned),
        ))

    # 判据 3：一律未定
    claims = _count_claims(files)
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
    if not claims:
        out.append(finding(
            NAME, PASS, u"没有同一「数字+量词+名词」组合跨文件出现",
            why=u"01 §1 G2 别处引用写链接、不抄值", evidence=scanned,
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

    # 探测三：同一数值声明出现在两个文件，按判据 3 应得未定而非失败
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = _mkrepo(tmp, {
                "m.md": _UNIQ_A + u"\n当前共有 192 份归档，按季度清点一次。\n",
                "n.md": _UNIQ_B + u"\n仓库里 192 份归档由资料员保管。\n",
            })
            got = [f["status"] for f in run(cfg)]
        ok = UNDETERMINED in got and FAIL not in got
        results.append(finding(
            NAME, PASS if ok else FAIL,
            u"探测三：重复数值声明应判未定、不得升格为失败",
            evidence=u"实得 %s" % got, why=u"契约 §1 未定不可静默升格",
        ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(NAME, FAIL, u"探测三自身出错", evidence=u"%s: %s" % (type(exc).__name__, exc)))

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

    return results
