# -*- coding: utf-8 -*-
"""采用记录：项目有没有记下自己采用的是标准的哪一版（顺带看有没有采用日期）。

执行 01 §8「采用、例外与升级」第一条（项目记录采用的标准版本
`governance/STANDARD_VERSION`），并接住 01 §4.7「标准升级」那一行的验收判据
（`STANDARD_VERSION` 与差异记录一致）。契约见 ../CONTRACT.md。

**本检查主要判"记没记"；"记得对不对"只判一处**：以内嵌方式运行（本工具就在被扫项目的 `.std/`
里）时，把记下的版本值与内嵌标准 `.std/标准/README.md` 第 3 行的「候选实现修订」比对，不一致判
FAIL——两边都是被扫项目里的文件，比的是记录与实物。标准仓的 tag 机制已经建立（版本值 = `release`
分支上的 tag 名，标准按该 tag 以 subtree 内嵌进项目的 `.std/`），但**核实那个 tag 是否真的
存在，要么访问远端、要么读 `.std/` 之外的 git 元数据，本工具两样都不做**：不联网、不越出被扫
项目。读到的值原样写进 evidence 供人核，**不与工具侧任何常量比对**——
这条硬约束由 `selftest` 里的变异验证守着，不是靠本段注释。

本模块只用标准库。
"""
from __future__ import annotations

import io
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from stdlib import (  # noqa: E402
    FAIL, PASS, SKIP, UNDETERMINED,
    embedded_std_rel, finding, is_tailored_out, undetermined_from_exception,
)

NAME = "adoption"
STANDARD_REFS = ["01 §8", "01 §4.7", "01 §3.1"]

# 位置由 01 §3.1 的文档树定死（`governance/ └─ STANDARD_VERSION  采用的标准版本`），
# 不做成配置项：再加一个 layout 键，就等于让被检查方自己指定这条判据看哪儿。
# 项目把它挪了位置，本检查会报 FAIL 而不是四处去找——见 scope().not_covered。
_REL = "governance/STANDARD_VERSION"

# 版本值可以是首行裸值（示例项目的实物形状），也可以写成 `version: 1.0`。
_VERSION_KEYS = ("standard_version", "version", "adopted_version", "标准版本", "采用版本")
# 采用日期不是标准原文的要求（01 §8 只要求记录版本），这几个字段名是本工具的约定：
# 按契约 §1.1，命中记 PASS，落空只记未定。
_ADOPTED_KEYS = ("adopted_at", "adopted", "adoption_date", "采用日期", "采用时间")

# 内嵌标准 README 第 3 行的修订号（`**候选实现修订：`2026-09-22.2`。**`）。
_EMBED_REV_RE = re.compile(u"候选实现修订：`([^`]+)`")

_KEY_LINE = re.compile(r"^([A-Za-z_][A-Za-z0-9_.\-]*|[一-鿿]+)\s*:\s*(.*)$")


def _parse(text):
    """把 STANDARD_VERSION 拆开。返回 (版本值, 采用日期, 键值对列表)。

    实物形状取自 `标准/示例项目-连锁零售中台/governance/STANDARD_VERSION`：

        1.0
        adopted_at: 2025-03-03
        last_evaluated_upgrade: 2026-09-07 (no newer version)

    首行是**裸的版本值**，其后是 `键: 值`。所以判据是：第一条不含键冒号的非空行
    即版本值；也接受 `version: 1.0` 这种写法。`#` 开头的行当注释。
    这不是 YAML——`stdlib.parse_yaml_subset` 会在首行那个裸值上直接抛错。
    """
    version, adopted, pairs = None, None, []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = _KEY_LINE.match(line)
        if not m:
            if version is None:
                version = line
            continue
        key, val = m.group(1).strip(), m.group(2).strip()
        pairs.append((key, val))
        low = key.lower()
        if version is None and low in _VERSION_KEYS and val:
            version = val
        elif adopted is None and low in _ADOPTED_KEYS and val:
            adopted = val
    return version, adopted, pairs


def _embedded_revision(root, embedded_rel, version):
    """内嵌运行时的一条比对：STANDARD_VERSION 的版本值 vs 内嵌标准 README 的修订号。"""
    readme_rel = "%s/标准/README.md" % embedded_rel
    try:
        with io.open(os.path.join(root, readme_rel), encoding="utf-8", errors="replace") as fh:
            m = _EMBED_REV_RE.search(fh.read())
    except OSError as exc:
        return undetermined_from_exception(NAME, exc, "读 %s" % readme_rel)
    why = ("01 §8 第一条：项目记录采用的标准版本；01 §4.7『标准升级』行的验收判据："
           "『`STANDARD_VERSION` 与差异记录一致』——记录与内嵌进来的实物不是同一版，就对不上")
    if not m:
        return finding(
            NAME, UNDETERMINED, "内嵌标准的修订号取不到，没法与 %s 比对" % _REL,
            where=readme_rel, kind="embedded-revision-unreadable",
            reason="%s 里没有『候选实现修订：`…`』这一句" % readme_rel, why=why)
    got = m.group(1)
    if got == version:
        return finding(
            NAME, PASS, "%s 与内嵌标准的修订号一致" % _REL, where=_REL, why=why,
            evidence="%s：%s；%s：%s" % (_REL, version, readme_rel, got))
    return finding(
        NAME, FAIL, "%s 记的版本与内嵌标准的修订号不一致" % _REL,
        where=_REL, kind="version-mismatch",
        reason="%s 记的是 %s，%s 的候选实现修订是 %s；升级后改 STANDARD_VERSION，在 pull 之后改"
               % (_REL, version, readme_rel, got),
        why=why,
        evidence="%s：%s；%s：%s" % (_REL, version, readme_rel, got))


def scope(cfg):
    return {
        "covered": [
            "%s 是否存在、是否非空" % _REL,
            "能否从中读出**版本值**（首行裸值，或 version/standard_version 键）",
            "能否从中读出**采用日期**（adopted_at 或等价键；字段名是本工具的约定，落空只记未定）",
            "把读到的版本值原样写进证据，供人核",
            "以内嵌方式运行时（本工具在被扫项目的 .std/ 之类目录里）：版本值与内嵌标准 "
            "<内嵌目录>/标准/README.md 里「候选实现修订：`…`」的值是否相等，不等判 FAIL",
        ],
        "not_covered": [
            "不验证读到的版本值背后的 tag 是否真实存在——核实它要联网或读被扫项目之外的 git 元数据，本工具两样都不做",
            "不与工具侧任何常量比对（check_all 的 _SMOKE_CONFIG、check_layout 的 _SNAPSHOT_DATE 都不比）；"
            "拿工具自己的常量当真相比，结论就是编的。内嵌运行时比对的对象是被扫项目里的内嵌 "
            "README（记录与实物），不是工具常量",
            "只在内嵌运行时比对修订号：在标准仓自身、或用仓外的工具副本扫项目时不产出这一条"
            "——那时正在跑的不是被扫项目 .std/ 里那份，拿它的 README 比对说明不了项目实际采用的是哪版",
            "不判裁剪内容是否合理、是否完整——那是内容判断，契约 §7 说了不做",
            "不判裁剪登记齐不齐：裁剪的权威位置是 governance/project.yaml 的 tailoring"
            "（01 §3.2 职责卡的权威域逐字含『裁剪与派生登记』），本文件只承载采用的标准修订；"
            "规则本身还不存在，按契约 §4『why 追不到标准条款的检查项不进本工具』，"
            "本检查对该项不产出任何发现：调和该由上游做，不由每份报告里塞一条恒定未定代劳",
            "不核实 adopted_at 的日期是否属实，也不判它与版本发布时间的先后",
            "只看 %s 这一个位置：01 §3.1 把它定在这里，项目挪了位置本检查报缺失而不去猜" % _REL,
        ],
    }


def run(cfg):
    tailored, reason = is_tailored_out(cfg, NAME)
    if tailored:
        return [finding(NAME, SKIP, "项目已裁剪本检查", reason=reason or "project.yaml 未写理由")]

    root = cfg.get("_root") or "."
    path = os.path.join(root, _REL)
    out = []

    if not os.path.isfile(path):
        out.append(finding(
            NAME, FAIL, "缺 %s：没有记录采用的是标准的哪一版" % _REL,
            where=_REL,
            why="01 §8 第一条：项目记录采用的标准版本（governance/STANDARD_VERSION），"
                "标准升级由项目显式评估、不在任务中自动跟随——没有这份记录，"
                "『我原来是哪一版』无从回答，§4.7『标准升级』那一行也就没有可执行的起点",
            evidence="按 cfg[_root] 拼出的路径不存在：%s" % path,
        ))
        return out

    try:
        with io.open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except OSError as exc:
        return [undetermined_from_exception(NAME, exc, "读 %s" % _REL)]

    version, adopted, pairs = _parse(text)
    raw_head = "；".join(ln.strip() for ln in text.splitlines() if ln.strip())[:200] or "（空文件）"

    if not version:
        out.append(finding(
            NAME, FAIL, "%s 在，但读不出版本值" % _REL,
            where="%s:1" % _REL,
            why="01 §8 第一条要求记录的是**采用的标准版本**；文件存在而没有版本值，"
                "记录形式在、内容不在，等于没记（契约 §1：不把『有个文件』升格成通过）",
            evidence="全文非空行：%s\n判据：第一条不含键冒号的非空行即版本值，"
                     "或 %s 这几个键之一有值" % (raw_head, "/".join(_VERSION_KEYS)),
        ))
    else:
        out.append(finding(
            NAME, PASS, "%s 记了版本值" % _REL,
            where="%s:1" % _REL,
            why="01 §8 第一条：项目记录采用的标准版本",
            evidence="读到的版本值（原样）：%s\n"
                     "不核实该值背后的 tag 是否真实存在（要联网或读仓外 git 元数据，本工具不做），"
                     "也不与工具侧任何常量比对——拿工具自己的常量当真相比，结论就是编的。"
                     "值原样列在这里，供人核。" % version,
        ))

    embedded = embedded_std_rel(root)
    if embedded and version:
        out.append(_embedded_revision(root, embedded, version))

    why_date = ("01 §8 第一条：『项目记录采用的标准版本（`governance/STANDARD_VERSION`）』；"
                "01 §4.7『标准升级』行的验收判据：『`STANDARD_VERSION` 与差异记录一致』"
                "——采用日期是对账时的线索，不是标准原文的要求")
    if not adopted:
        out.append(finding(
            NAME, UNDETERMINED, "%s 里没找到采用日期" % _REL,
            where=_REL, kind="adopted-date-missing",
            reason="日期字段名是本工具的约定（%s），没找到只说明不在约定处，推不出没记"
                   "（契约 §1.1）；加一行 `adopted_at: <日期>` 即得通过" % "/".join(_ADOPTED_KEYS),
            why=why_date,
            evidence="全文非空行：%s" % raw_head,
        ))
    else:
        out.append(finding(
            NAME, PASS, "%s 记了采用日期" % _REL,
            where=_REL,
            why=why_date,
            evidence="读到的采用日期（原样）：%s\n"
                     "本检查不核实这个日期是否属实，也不判它与版本发布的先后。" % adopted,
        ))

    return out


# --------------------------------------------------------------------------
# 自检（契约 §3）
# --------------------------------------------------------------------------

_COMPLETE = u"1.0\nadopted_at: 2025-03-03\nlast_evaluated_upgrade: 2026-09-07 (no newer version)\n"

# 变异体：故意去做契约禁止的"与工具侧常量比对"。它的用途只有一个——
# 证明下面那条"版本值不参与判定"的探针真的会报警，而不是一条永远绿的注释。
_MUTANT_SUFFIX = u'''

_MUTANT_TOOL_VERSION = "2026-09-10"
_pristine_run = run


def run(cfg):  # noqa: F811
    out = _pristine_run(cfg)
    path = os.path.join(cfg.get("_root") or ".", _REL)
    try:
        with io.open(path, encoding="utf-8", errors="replace") as fh:
            ver = _parse(fh.read())[0]
    except OSError:
        return out
    if ver and ver != _MUTANT_TOOL_VERSION:
        out.append(finding(
            NAME, FAIL, "版本值与工具侧常量不一致（变异体）",
            where=_REL,
            why="变异体故意违反契约：拿没有可比制品的值去比对",
        ))
    return out
'''


def _write(tmp, content):
    """在临时目录里摆一份 STANDARD_VERSION（content 为 None 表示不摆）。返回 cfg。"""
    gov = os.path.join(tmp, "governance")
    if not os.path.isdir(gov):
        os.makedirs(gov)
    path = os.path.join(gov, "STANDARD_VERSION")
    if content is None:
        if os.path.exists(path):
            os.remove(path)
    else:
        with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(content)
    return {"_root": tmp}


def _statuses(run_fn, cfg):
    return tuple(f["status"] for f in run_fn(cfg))


def _value_insensitive(run_fn, tmp):
    """同一份完整文件，只换版本值，判定必须**完全一样**。

    这就是"不与工具侧任何常量比对"这条硬约束的可执行形态：一旦实现里出现了
    任何"值等于某常量才算数"的比对，两次判定就会分叉，本探针当场分辨得出来。
    """
    a = _statuses(run_fn, _write(tmp, u"9.9-一个不存在的版本\nadopted_at: 2025-03-03\n"))
    b = _statuses(run_fn, _write(tmp, u"2026-09-10\nadopted_at: 2025-03-03\n"))
    return a == b, (a, b)


def selftest():
    """反例与正例。见契约 §3：抓不出违规的检查器，其结论作废。

    最后一条是**变异验证**：把"不与工具常量比对"改成真去比对，探针必须报警。
    没有它，那条硬约束就只是一句注释。
    """
    results = []
    cases = [
        (None, (FAIL,),
         "反例：文件缺失应判 FAIL（01 §8 第一条）"),
        (u"\n   \n", (FAIL, UNDETERMINED),
         "反例：空文件——版本读不出判 FAIL，采用日期读不出记未定"),
        (u"adopted_at: 2025-03-03\n", (FAIL, PASS),
         "反例：只有采用日期、读不出版本值应判 FAIL"),
        (u"1.0\n", (PASS, UNDETERMINED),
         "只有版本值、没有采用日期记未定：日期字段名是工具约定，落空不判 FAIL（契约 §1.1）"),
        (_COMPLETE, (PASS, PASS),
         "正例：示例项目的实物形状应判 PASS，本检查器对该输入不再产出任何未定"),
    ]
    try:
        with tempfile.TemporaryDirectory() as tmp:
            for content, want, title in cases:
                got = _statuses(run, _write(tmp, content))
                results.append(finding(
                    NAME, PASS if got == want else FAIL, title,
                    evidence="期望 %s，实得 %s" % (list(want), list(got)),
                    why="契约 §3 静默失效探测",
                ))

            # 正例的证据里必须真的带上原样值与那句"不核实 tag、不比常量"的限定，
            # 否则"把值写进报告供人核"这件事就没落地。
            fs = run(_write(tmp, _COMPLETE))
            ev = fs[0].get("evidence") or ""
            ok_ev = ("1.0" in ev
                     and "不核实该值背后的 tag 是否真实存在" in ev
                     and "不与工具侧任何常量比对" in ev)
            results.append(finding(
                NAME, PASS if ok_ev else FAIL,
                "正例的证据里带原样版本值与『不核实 tag、不比工具常量』的限定",
                evidence="evidence 首 120 字：%s" % ev[:120].replace("\n", " / "),
                why="契约 §4：evidence 要可复算；A2 的落点是把值写进报告供人核",
            ))

            # —— 内嵌运行时：STANDARD_VERSION 与内嵌标准第 3 行修订号比对 ——
            # embedded_std_rel 依赖工具自身路径，自检模拟不了内嵌，故直接测比对函数，
            # 另测 run() 在非内嵌时不产出这条。
            readme = os.path.join(tmp, ".std", "标准", "README.md")
            os.makedirs(os.path.dirname(readme), exist_ok=True)

            def _put(text):
                with io.open(readme, "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(text)

            _put(u"# 标准\n\n**候选实现修订：`2026-09-22.2`。** 其余说明。\n")
            same = _embedded_revision(tmp, ".std", u"2026-09-22.2")
            diff = _embedded_revision(tmp, ".std", u"2026-09-10")
            _put(u"# 标准\n\n这一版没写修订号。\n")
            blank = _embedded_revision(tmp, ".std", u"2026-09-22.2")
            os.remove(readme)
            gone = _embedded_revision(tmp, ".std", u"2026-09-22.2")
            ev = same.get("evidence") or ""
            ok = (same["status"] == PASS and "2026-09-22.2" in ev
                  and _REL in ev and ".std/标准/README.md" in ev
                  and diff["status"] == FAIL and diff["id"] == "adoption/version-mismatch"
                  and "2026-09-10" in diff["reason"] and "2026-09-22.2" in diff["reason"]
                  and blank["status"] == UNDETERMINED and gone["status"] == UNDETERMINED)
            results.append(finding(
                NAME, PASS if ok else FAIL,
                "内嵌修订号比对：相等 PASS（证据带两值两路径）、不等 FAIL version-mismatch、"
                "README 取不到值或读不到记未定",
                evidence="实得 %s" % [(f["status"], f["id"]) for f in (same, diff, blank, gone)],
                why="01 §4.7『标准升级』验收判据：『`STANDARD_VERSION` 与差异记录一致』",
            ))

            _put(u"**候选实现修订：`2026-09-22.2`。**\n")
            ids = [f["id"] for f in run(_write(tmp, u"2026-09-10\nadopted_at: 2025-03-03\n"))]
            results.append(finding(
                NAME, PASS if (len(ids) == 2 and "adoption/version-mismatch" not in ids) else FAIL,
                "非内嵌运行（被扫根不含本工具）时不产出内嵌修订号比对这一条",
                evidence="实得 %s" % ids,
                why="只在内嵌运行时比对：外部工具副本扫项目时，被扫项目里的 .std/ 不是正在跑的这份",
            ))

            # —— 变异验证 ——
            ok_real, detail_real = _value_insensitive(run, tmp)
            src = io.open(os.path.abspath(__file__), encoding="utf-8").read()
            ns = {"__name__": "check_adoption__mutant", "__file__": __file__}
            exec(compile(src + _MUTANT_SUFFIX, "<check_adoption 变异体>", "exec"), ns)  # noqa: S102
            ok_mut, detail_mut = _value_insensitive(ns["run"], tmp)

            results.append(finding(
                NAME, PASS if (ok_real and not ok_mut) else FAIL,
                "变异验证：真实现对版本值不敏感，而『去比对工具常量』的变异体被探针抓住",
                evidence="真实现两次判定 %s → 一致=%s；变异体两次判定 %s → 一致=%s"
                         % (list(detail_real), ok_real, list(detail_mut), ok_mut),
                why="契约 §3：守卫存在不等于守卫在执行——"
                    "『不与工具侧常量比对』这条硬约束必须被测试守着，不能只写在注释里",
            ))
    except Exception as exc:  # noqa: BLE001
        results.append(finding(
            NAME, FAIL, "自检自己跑不起来",
            evidence="%s: %s" % (type(exc).__name__, exc),
            why="契约 §3：自检崩了，本检查器对目标仓库的结论作废",
        ))
    return results
