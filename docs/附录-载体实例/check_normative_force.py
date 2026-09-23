#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D-014 规范效力元治理检查器。

校验：
  C1  所有 governed_by 引用的 decision_id 在决策索引中存在
  C2  生效登记表中每条记录的必需字段齐全（按状态区分）
  C3  生效登记表中的「试行」条目 expiry 可解析（不可解析＝不合规）；已过期只作到期通告，不计入不合规
  C4  决策索引状态列与生效登记表一致
  C5  规范正文中不存在第三处状态值副本
  C6  所有规范文档都声明了 governed_by

这是 checker，不是 Gate。把它接成阻断需要单独的 Gate 决策（D-018）。
退出码：0 全部通过；1 存在不合规项；2 输入缺失或无法解析。
"""
from __future__ import annotations
import datetime as _dt
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent  # 2026-09-02：脚本移入附录后多一层目录
LOG = ROOT / "docs" / "决策日志.md"

FORCE_STATES = ("提议", "试行", "已接受", "已取代", "已拒绝", "已执行")
EFFECTIVE_STATES = ("试行", "已接受")

REQUIRED_FIELDS = {
    "试行": ("approved_by", "approved_at", "effective_scope · blocks",
             "effective_scope · grants", "review_at", "expiry"),
    "已接受": ("approved_by", "approved_at", "effective_scope · blocks",
               "effective_scope · grants"),
}

# 允许出现状态值的位置：元治理正文（定义语义）与决策日志（唯一效力源）
STATE_COPY_EXEMPT = {"docs/08-规范效力元治理.md", "docs/决策日志.md"}

# 需要声明 governed_by 的规范文档
GOVERNED_GLOBS = ("docs/[0-4]*.md", "docs/术语表.md", "docs/决策日志.md", "docs/架构确定.md")


class Finding:
    def __init__(self, code: str, path: str, line: int | None, msg: str):
        self.code, self.path, self.line, self.msg = code, path, line, msg

    def __str__(self) -> str:
        loc = f"{self.path}:{self.line}" if self.line else self.path
        return f"[{self.code}] {loc}\n        {self.msg}"


def _rows(block: str) -> list[list[str]]:
    out = []
    for ln in block.splitlines():
        ln = ln.strip()
        if not ln.startswith("|"):
            continue
        cells = [c.strip() for c in ln.strip("|").split("|")]
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
            continue
        out.append(cells)
    return out


def _section(text: str, anchor_or_head: str) -> str:
    """取出从某标题到下一个同级/更高级标题之间的内容。"""
    m = re.search(rf"^#{{2,3}} .*{re.escape(anchor_or_head)}.*$", text, re.M)
    if not m:
        return ""
    start = m.end()
    nxt = re.search(r"^#{2,3} ", text[start:], re.M)
    return text[start:start + nxt.start()] if nxt else text[start:]


def _mask_code(text: str) -> str:
    """把围栏代码块与行内代码替换成等长空白：代码里的引用是举例，不是活引用。"""
    NL = chr(10)
    def blank(m):
        return "".join(c if c == NL else " " for c in m.group(0))
    fence = chr(96) * 3
    text = re.sub(fence + ".*?" + fence, blank, text, flags=re.S)
    text = re.sub(chr(96) + "[^" + chr(96) + NL + "]*" + chr(96), blank, text)
    return text


def _strip(cell: str) -> str:
    return re.sub(r"[*`~]", "", cell).strip()


def main() -> int:
    if not LOG.exists():
        print(f"FATAL 决策日志缺失：{LOG}", file=sys.stderr)
        return 2
    log = LOG.read_text(encoding="utf-8")
    findings: list[Finding] = []
    expired: list[Finding] = []  # 到期通告：不计入不合规项、不影响退出码

    # ---- 解析生效登记表 ----
    reg_block = _section(log, "生效登记表")
    reg_rows = _rows(reg_block)
    if not reg_rows:
        print("FATAL 未找到生效登记表", file=sys.stderr)
        return 2
    reg_hdr, reg_data = reg_rows[0], reg_rows[1:]
    register: dict[str, dict[str, str]] = {}
    for r in reg_data:
        rec = dict(zip(reg_hdr, r))
        did = _strip(rec.get("decision_id", ""))
        if did:
            register[did] = rec

    # ---- 解析决策索引 ----
    idx_block = _section(log, "决策索引")
    idx_rows = _rows(idx_block)
    idx_hdr, idx_data = (idx_rows[0], idx_rows[1:]) if idx_rows else ([], [])
    index: dict[str, str] = {}
    for r in idx_data:
        rec = dict(zip(idx_hdr, r))
        did = _strip(rec.get("ID", ""))
        if did:
            index[did] = _strip(rec.get("状态", ""))

    if not index:
        print("FATAL 未找到决策索引", file=sys.stderr)
        return 2

    today = _dt.date.today()

    # ---- C2 / C3 生效登记表字段与到期 ----
    for did, rec in register.items():
        status = _strip(rec.get("状态", ""))
        if status not in EFFECTIVE_STATES:
            findings.append(Finding("C2", str(LOG.relative_to(ROOT)), None,
                f"{did} 出现在生效登记表但状态为「{status}」；登记表只收录 试行/已接受"))
            continue
        for field in REQUIRED_FIELDS[status]:
            val = _strip(rec.get(field, ""))
            if not val:
                findings.append(Finding("C2", str(LOG.relative_to(ROOT)), None,
                    f"{did}（{status}）缺少必需字段 `{field}`；按 D-014 §1 不视为已生效"))
        if status == "试行":
            exp = _strip(rec.get("expiry", ""))
            m = re.search(r"(\d{4})-(\d{2})-(\d{2})", exp)
            if not m:
                findings.append(Finding("C3", str(LOG.relative_to(ROOT)), None,
                    f"{did}（试行）的 expiry 不是可解析日期：{exp!r}"))
            elif _dt.date(*map(int, m.groups())) < today:
                expired.append(Finding("C3", str(LOG.relative_to(ROOT)), None,
                    f"{did}（试行）已于 {exp} 到期，按 D-014 §6 自动退回「提议」，"
                    f"须从生效登记表移除或重新批准（历史结果不追溯）"))

    # ---- C4 索引与登记表一致 ----
    for did, status in index.items():
        in_reg = did in register
        if status in EFFECTIVE_STATES and not in_reg:
            findings.append(Finding("C4", str(LOG.relative_to(ROOT)), None,
                f"{did} 索引状态为「{status}」但未登记；按 D-014 §5 以登记表为准，实际不生效"))
        if status not in EFFECTIVE_STATES and in_reg:
            findings.append(Finding("C4", str(LOG.relative_to(ROOT)), None,
                f"{did} 已登记但索引状态为「{status}」，两处不一致"))
        if in_reg and _strip(register[did].get("状态", "")) != status:
            findings.append(Finding("C4", str(LOG.relative_to(ROOT)), None,
                f"{did} 状态不一致：索引「{status}」 vs 登记表"
                f"「{_strip(register[did].get('状态',''))}」"))
        if status and status not in FORCE_STATES:
            findings.append(Finding("C4", str(LOG.relative_to(ROOT)), None,
                f"{did} 使用了未定义的状态值「{status}」"))

    # ---- C1 / C5 / C6 逐文档 ----
    md_files = sorted({p for g in GOVERNED_GLOBS for p in ROOT.glob(g)})
    # 上下文合同只进 C5 的扫描面（它是加载入口，一句过期的效力声明在这里最危险），
    # 不进 C6 的 governed_by 要求——它不是规范正文。
    # PROJECT_STATUS、README 与失败 Case 清单刻意不纳入：那里有对历史状态的叙述
    # （形如"第十轮：账本层落地（D-056，提议）"），纳入即制造大批误伤（33 §2 P9 的 Thin 信号）。
    c5_extra = [q for q in (ROOT / "CONTEXT_MANIFEST.md",) if q.exists()]
    # C5 两种形态都要认（Case C-022）：括号形态「（均为提议）」，
    # 与系动词形态「正文各章仍是`提议`」——00 §9 那句挂了四轮，只认括号形态时完全报不出。
    _ST = "|".join(FORCE_STATES)
    state_copy_re = re.compile(
        r"[（(]\s*(?:均为)?\s*[`「\"]?(" + _ST + r")[`」\"]?\s*[）)]"
        r"|(?:仍是|仍为|全部是|全都是|一律是|均为|都是|是|为)\s*[`「\"](" + _ST + r")[`」\"]")
    for p in md_files + c5_extra:
        rel = p.relative_to(ROOT).as_posix()
        text = p.read_text(encoding="utf-8")
        head = "\n".join(text.splitlines()[:12])

        gm = None if p in c5_extra else re.search(r"^governed_by[：:]\s*(.+)$", head, re.M)
        if p in c5_extra:
            pass
        elif not gm:
            findings.append(Finding("C6", rel, None,
                "规范文档未在文件头 12 行内声明 governed_by（D-014 §7）"))
        else:
            refs = re.findall(r"D-\d{3}", gm.group(1))
            if not refs:
                findings.append(Finding("C6", rel, None,
                    f"governed_by 未解析出任何 decision_id：{gm.group(1)!r}"))
            for did in refs:
                if did not in index:
                    findings.append(Finding("C1", rel, gm.start(),
                        f"governed_by 引用了决策索引中不存在的 {did}"))

        if rel in STATE_COPY_EXEMPT:
            continue
        for i, ln in enumerate(text.splitlines(), 1):
            m = state_copy_re.search(ln)
            if m:
                findings.append(Finding("C5", rel, i,
                    f"状态值副本「{m.group(0)}」；状态只允许存在于生效登记表与决策索引"
                    f"（D-014 §7）。此处应删除或改为指向生效登记表的链接"))

    # ---- C7：每条原则在追溯记录中有且只有一条对应项（D-014 §9） ----
    ledger_p = ROOT / "docs" / "追溯账本.md"
    if ledger_p.exists():
        ledger = ledger_p.read_text(encoding="utf-8")
        for p in sorted(ROOT.glob("docs/[1-4][0-9]-*.md")):
            rel = p.relative_to(ROOT).as_posix()
            num = p.name[:2]
            _m = re.search(rf'<a id="ch-{num}"></a>', ledger)
            if _m:
                _rest = ledger[_m.end():]
                _n = re.search(r'<a id="ch-\d\d"></a>', _rest)
                sec = _rest[:_n.start()] if _n else _rest
            else:
                sec = ""
            in_body = re.findall(r"^- \*\*(P\d+)", p.read_text(encoding="utf-8"), re.M)
            in_ledger = re.findall(r"^\|\s*(P\d+)\s*\|", sec, re.M)
            if not sec:
                findings.append(Finding("C7", rel, None,
                    f"追溯账本缺少 ch-{num} 的记录段"))
                continue
            miss = [x for x in in_body if x not in in_ledger]
            extra = [x for x in in_ledger if x not in in_body]
            dup = [x for x in set(in_ledger) if in_ledger.count(x) > 1]
            if miss or extra or dup:
                findings.append(Finding("C7", rel, None,
                    f"正文与追溯账本的原则编号对不上——正文有账本无：{miss or '无'}；"
                    f"账本有正文无：{extra or '无'}；账本内重复：{dup or '无'}"))

    # ---- C8：语料版本号只允许一处（D-014 §7 的单一副本判据） ----
    VERSION_SNAPSHOT_DIRS = ("docs/归档/历史/", "docs/参考资料", "docs/归档/输入材料", "docs/审计记录", "docs/归档/参考资料-公众号文章")
    ver_re = re.compile(r"^(?:状态|当前版本)[：:]\s*`v\d+\.\d+[-\w]*`", re.M)
    for p in sorted(ROOT.rglob("*.md")):
        rel = p.relative_to(ROOT).as_posix()
        if rel.startswith(".staging/") or any(rel.startswith(d) for d in VERSION_SNAPSHOT_DIRS):
            continue  # 冻结快照与研究材料保留其被冻结时的版本号
        if rel == "PROJECT_STATUS.md":
            continue  # 唯一权威位置
        m = ver_re.search(p.read_text(encoding="utf-8"))
        if m:
            findings.append(Finding("C8", rel, None,
                f"自行声明了语料版本号「{m.group(0)}」；版本号只允许出现在 PROJECT_STATUS.md 的 "
                f"corpus_version（D-014 §7 单一副本）。此处应删除或改为指向该字段的链接"))

    eff_ids = sorted(d for d, r in register.items() if _strip(r.get("状态", "")) in EFFECTIVE_STATES)

    # ---- C9：决策日志里的散文计数须与表对账（Case C-005） ----
    cnt_re = re.compile(r"当前生效规则数：\*\*(\d+)\*\*")
    m = cnt_re.search(LOG.read_text(encoding="utf-8"))
    if m and int(m.group(1)) != len(eff_ids):
        findings.append(Finding("C9", str(LOG.relative_to(ROOT)), None,
            f"散文写「生效规则数 {m.group(1)}」，与生效登记表实算 {len(eff_ids)} 条不一致"))

    # ---- C10：散文里的「NN §M」引用须指向正文中真实存在的小节（Case C-003） ----
    body_secs = {}
    for p in sorted(ROOT.glob("docs/[1-4][0-9]-*.md")):
        body_secs[p.name[:2]] = set(re.findall(r"^## (\d)\. ", p.read_text(encoding="utf-8"), re.M))
    LIVE_SKIP = ("docs/归档/历史/", "docs/参考资料", "docs/归档/输入材料", "docs/审计记录", "docs/归档/参考资料-公众号文章", ".staging/")
    # 两种引用形态都要认：裸写「21 §6」，以及链接写法「[21 调度与拆分](21-调度与拆分.md) §6」
    BODY_ALT = r"(1[0-2]|2[0-5]|3[0-3]|40)"
    ref_bare = re.compile(r"(?<![\d.])" + BODY_ALT + r"[ 　]?(?:章[ 　]?)?§\s?(\d)(?![\d.])")
    ref_link = re.compile(r"\]\(\.?/?" + BODY_ALT + r"-[^)]*\)\s*§\s?(\d)(?![\d.])")
    for p in sorted(ROOT.rglob("*.md")):
        rel = p.relative_to(ROOT).as_posix()
        if any(rel.startswith(s) for s in LIVE_SKIP): continue
        text = _mask_code(p.read_text(encoding="utf-8"))
        for rx, is_link in ((ref_bare, False), (ref_link, True)):
          for mo in rx.finditer(text):
            ch, sec = mo.group(1), mo.group(2)
            if ch not in body_secs: continue
            if not is_link:
                pre = text[max(0, mo.start()-24):mo.start()]
                if re.search(r"(WX-|SRC-|D-|T[1-6] |00[0-9] )\S*$", pre):
                    continue  # 指向研究材料而不是正文
            if sec not in body_secs[ch]:
                ln = text[:mo.start()].count(chr(10)) + 1
                findings.append(Finding("C10", rel, ln,
                    f"引用了 {ch} 章的 §{sec}，但该章只有 §" + "/§".join(sorted(body_secs[ch]))))

    # ---- 报告 ----
    eff = [d for d, r in register.items() if _strip(r.get("状态", "")) in EFFECTIVE_STATES]
    print("D-014 规范效力检查器")
    print(f"  决策总数：{len(index)}   生效规则：{len(eff)}"
          f"（{'、'.join(sorted(eff)) or '无'}）   扫描文档：{len(md_files)}")
    if not eff:
        print("  注意：生效规则集为空。任何『全部规则通过』的判定应计为 UNDETERMINED"
              "，不得视为 PASS（D-014 §4）。")
    print()
    if expired:
        print("到期通告  不计入不合规项，不影响退出码。按 08 §6 已自动退回「提议」，"
              "须人决定续期或移出生效登记表，并在决策日志留下处置痕迹：")
        for f in expired:
            print("  " + str(f))
        print()
    if not findings:
        print("PASS  未发现不合规项。")
        return 0
    by_code: dict[str, list[Finding]] = {}
    for f in findings:
        by_code.setdefault(f.code, []).append(f)
    print(f"FAIL  {len(findings)} 项不合规：\n")
    for code in sorted(by_code):
        for f in by_code[code]:
            print("  " + str(f))
        print()
    return 1


if __name__ == "__main__":
    sys.exit(main())
