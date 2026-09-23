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

同样只在内嵌运行时，另判 01 §8「内嵌的 `.std/` 只放标准，只读……项目不在里面改」：内嵌目录下
有已跟踪文件的改动（已暂存或未暂存都算，覆盖 `git commit -a`）判 FAIL。规则放在检查器里而不是
某个宿主工具的钩子里，git 钩子、CI 与 Agent 的提交前钩子只要调 `check_all` 就同样受益。

本模块只用标准库。
"""
from __future__ import annotations

import io
import os
import re
import subprocess
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


def _git(root, *args):
    """只读 git 调用：不抢可选锁（与并行的 git 操作不互相干扰），路径原样输出。"""
    cmd = ["git", "--no-optional-locks", "-C", root, "-c", "core.quotepath=false"] + list(args)
    return subprocess.run(cmd, capture_output=True, timeout=60)


def _embedded_readonly(root, embedded_rel):
    """内嵌运行时的一条判定：内嵌目录下有没有已跟踪文件的改动（01 §8：`.std/` 只读）。

    看工作区与暂存区两边（`git status`），不只看暂存区：`git commit -a` 在提交前钩子之后才暂存。
    不看未跟踪文件——`__pycache__` 之类会误报；新建文件要进提交须先 `git add`，那时已是已跟踪。
    先确认内嵌目录确实被本仓跟踪：被 .gitignore 忽略、或是嵌套的独立 clone 时 `git status`
    恒为空，拿空输出判 PASS 就是假通过（契约 §1：空输出不是通过）。
    """
    why = ("01 §8：内嵌的 `.std/` 只放标准，只读、升级时整体替换，项目不在里面改——就地改下次升级会被"
           "覆盖（上游没改的行 subtree pull 还会静默保留本地改动），合规结论也不再可复算")
    where = "%s/" % embedded_rel

    def _unknown(out, what):
        return finding(
            NAME, UNDETERMINED, "查不了 %s 有无改动" % where,
            where=where, kind="embedded-readonly-unknown",
            reason="%s 退出码 %d：%s" % (
                what, out.returncode, (out.stderr or b"").decode("utf-8", "replace").strip()[:200]),
            why=why)

    try:
        listed = _git(root, "ls-files", "-z", "--", embedded_rel)
        if listed.returncode != 0:
            return _unknown(listed, "git ls-files")
        if not (listed.stdout or b"").strip(b"\0"):
            return finding(
                NAME, UNDETERMINED, "%s 没有被本仓 git 跟踪，判不了它有没有被改" % where,
                where=where, kind="embedded-untracked",
                reason="`git ls-files -- %s` 为空：内嵌目录被 .gitignore 忽略，或是嵌套的独立 clone，"
                       "本仓的 git status 看不见里面的改动；按「接入一个项目」用 subtree 取用"
                       % embedded_rel,
                why=why)
        out = _git(root, "status", "--porcelain", "--untracked-files=no", "--", embedded_rel)
    except (OSError, subprocess.SubprocessError) as exc:
        return undetermined_from_exception(NAME, exc, "查 %s 有无改动（git）" % where)
    if out.returncode != 0:
        return _unknown(out, "git status")
    lines = [ln for ln in (out.stdout or b"").decode("utf-8", "replace").splitlines() if ln.strip()]
    if not lines:
        return finding(
            NAME, PASS, "%s 只读：没有已跟踪文件被改动" % where,
            where=where, why=why,
            evidence="`git status --porcelain --untracked-files=no -- %s` 输出为空" % embedded_rel)
    return finding(
        NAME, FAIL, "%s 只读，改标准走合并回标准仓再 subtree pull" % where,
        where=where, kind="embedded-modified",
        reason="%s 下有 %d 个已跟踪文件被改动（已暂存或未暂存）；先移出如 `git stash push -- %s`"
               "（不丢内容），要改标准就把改动合并回标准仓再 subtree pull"
               % (where, len(lines), embedded_rel),
        why=why,
        evidence="`git status --porcelain --untracked-files=no -- %s`：\n%s"
                 % (embedded_rel, "\n".join(lines[:10])))


def _readonly_findings(root, embedded):
    if not embedded:
        return [finding(
            NAME, SKIP, "内嵌目录只读：非内嵌运行，不适用",
            reason="被扫根下没有正在运行的本工具（在标准仓自身、或用仓外的工具副本扫项目）："
                   "被扫项目里的内嵌目录不是正在跑的这份，是不是内嵌、在哪都无从确认")]
    return [_embedded_readonly(root, embedded)]


def scope(cfg):
    return {
        "covered": [
            "%s 是否存在、是否非空" % _REL,
            "能否从中读出**版本值**（首行裸值，或 version/standard_version 键）",
            "能否从中读出**采用日期**（adopted_at 或等价键；字段名是本工具的约定，落空只记未定）",
            "把读到的版本值原样写进证据，供人核",
            "以内嵌方式运行时（本工具在被扫项目的 .std/ 之类目录里）：版本值与内嵌标准 "
            "<内嵌目录>/标准/README.md 里「候选实现修订：`…`」的值是否相等，不等判 FAIL",
            "以内嵌方式运行时：内嵌目录下有没有已跟踪文件的改动（git status，含已暂存与未暂存），"
            "有判 FAIL（01 §8 只读）；git 查不了记未定",
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
            "内嵌目录没被本仓 git 跟踪（被忽略或是嵌套的独立 clone）时记未定 embedded-untracked，不判改没改；"
            "内嵌目录只读：不看未跟踪文件（新建而未 git add 的），不看已提交进历史的改动"
            "——后者用 `git log --oneline -- .std` 查（见 tools/std/README「升级」）；非内嵌运行不判",
        ],
    }


def run(cfg, tool_root=None):
    """tool_root 只为自检注入（同 stdlib.embedded_std_rel），生产路径不传。"""
    tailored, reason = is_tailored_out(cfg, NAME)
    if tailored:
        return [finding(NAME, SKIP, "项目已裁剪本检查", reason=reason or "project.yaml 未写理由")]

    root = cfg.get("_root") or "."
    path = os.path.join(root, _REL)
    out = []
    embedded = embedded_std_rel(root, tool_root)

    if not os.path.isfile(path):
        out.append(finding(
            NAME, FAIL, "缺 %s：没有记录采用的是标准的哪一版" % _REL,
            where=_REL,
            why="01 §8 第一条：项目记录采用的标准版本（governance/STANDARD_VERSION），"
                "标准升级由项目显式评估、不在任务中自动跟随——没有这份记录，"
                "『我原来是哪一版』无从回答，§4.7『标准升级』那一行也就没有可执行的起点",
            evidence="按 cfg[_root] 拼出的路径不存在：%s" % path,
        ))
        return out + _readonly_findings(root, embedded)

    try:
        with io.open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except OSError as exc:
        return [undetermined_from_exception(NAME, exc, "读 %s" % _REL)] + _readonly_findings(root, embedded)

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

    return out + _readonly_findings(root, embedded)


# --------------------------------------------------------------------------
# 自检（契约 §3）
# --------------------------------------------------------------------------

_COMPLETE = u"1.0\nadopted_at: 2025-03-03\nlast_evaluated_upgrade: 2026-09-07 (no newer version)\n"

# 变异体：故意去做契约禁止的"与工具侧常量比对"。它的用途只有一个——
# 证明下面那条"版本值不参与判定"的探针真的会报警，而不是一条永远绿的注释。
_MUTANT_SUFFIX = u'''

_MUTANT_TOOL_VERSION = "2026-09-10"
_pristine_run = run


def run(cfg, tool_root=None):  # noqa: F811
    out = _pristine_run(cfg, tool_root)
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


# 夹具不受全局配置左右：不签名、不跑全局钩子、不转换换行（同 check_derived 的 _GIT_ID）
_GIT_ID = ["-c", "user.email=std@example.invalid", "-c", "user.name=std",
           "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null",
           "-c", "core.autocrlf=false", "-c", "core.safecrlf=false"]


def _git_fixture(repo, *args):
    cmd = ["git", "-C", repo, "-c", "init.defaultBranch=main"] + _GIT_ID + list(args)
    r = subprocess.run(cmd, capture_output=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError("git %s 退出码 %d：%s" % (
            " ".join(args), r.returncode, (r.stderr or b"").decode("utf-8", "replace")[:200]))


def _embedded_repo(repo, ignore_std=False):
    """造一个内嵌采用项目：STANDARD_VERSION 与内嵌 README 修订号一致，`.std/` 已提交
    （ignore_std 时 `.std/` 被 .gitignore 忽略、从未跟踪）。返回内嵌目录路径（即注入的 tool_root）。"""
    files = {
        _REL: u"2026-09-22.2\nadopted_at: 2025-03-03\n",
        ".std/标准/README.md": u"**候选实现修订：`2026-09-22.2`。**\n",
        ".std/x.md": u"标准\n",
    }
    if ignore_std:
        files[".gitignore"] = u".std/\n"
    for rel, body in files.items():
        path = os.path.join(repo, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(body)
    _git_fixture(repo, "init", "-q")
    _git_fixture(repo, "add", "-A")
    _git_fixture(repo, "commit", "-q", "-m", "s")
    return os.path.join(repo, ".std")


def _readonly_selftest():
    """经 run() 注入 tool_root 走真实的内嵌分支：
    未暂存改动 → FAIL（覆盖 `git commit -a`）、已暂存改动 → FAIL、干净与仅未跟踪新文件 → PASS、
    内嵌目录被 .gitignore 忽略 → 未定 embedded-untracked、不在 git 仓库 → 未定。"""
    def _ro(fs):
        hit = [f for f in fs if f["id"].startswith(NAME + "/") and "只读" in f["title"]
               or f["id"] in ("adoption/embedded-untracked", "adoption/embedded-readonly-unknown")]
        return [(f["status"], f["id"]) for f in hit]

    try:
        with tempfile.TemporaryDirectory() as tmp:
            repo = os.path.join(tmp, "repo")
            tr = _embedded_repo(repo)
            cfg = {"_root": repo}
            clean = _ro(run(cfg, tool_root=tr))
            with io.open(os.path.join(repo, ".std", "new.md"), "w", encoding="utf-8") as fh:
                fh.write(u"未跟踪\n")
            untracked = _ro(run(cfg, tool_root=tr))
            with io.open(os.path.join(repo, ".std", "x.md"), "a", encoding="utf-8") as fh:
                fh.write(u"就地改\n")
            dirty_fs = run(cfg, tool_root=tr)
            dirty = _ro(dirty_fs)
            _git_fixture(repo, "add", "--", ".std/x.md")
            staged = _ro(run(cfg, tool_root=tr))

            ign = os.path.join(tmp, "ignored")
            ignored = _ro(run({"_root": ign}, tool_root=_embedded_repo(ign, ignore_std=True)))

            nogit = os.path.join(tmp, "nogit")
            os.makedirs(os.path.join(nogit, ".std"))
            # 临时目录的上级万一在某个 git 仓库里，nogit 就会被当成它的子目录；设天花板挡住上溯
            saved = os.environ.get("GIT_CEILING_DIRECTORIES")
            os.environ["GIT_CEILING_DIRECTORIES"] = tmp
            try:
                outside = _embedded_readonly(nogit, ".std")
            finally:
                if saved is None:
                    os.environ.pop("GIT_CEILING_DIRECTORIES", None)
                else:
                    os.environ["GIT_CEILING_DIRECTORIES"] = saved

            fail = [f for f in dirty_fs if f["id"] == "adoption/embedded-modified"]
            ok = (len(clean) == 1 and clean[0][0] == PASS
                  and untracked == clean
                  and dirty == [(FAIL, "adoption/embedded-modified")]
                  and staged == [(FAIL, "adoption/embedded-modified")]
                  and bool(fail) and "git stash push -- .std" in fail[0]["reason"]
                  and "只读" in fail[0]["title"]
                  and ignored == [(UNDETERMINED, "adoption/embedded-untracked")]
                  and outside["status"] == UNDETERMINED
                  and outside["id"] == "adoption/embedded-readonly-unknown")
            return finding(
                NAME, PASS if ok else FAIL,
                "内嵌目录只读（经 run() 注入内嵌）：未暂存或已暂存改动 FAIL embedded-modified、"
                "干净与仅未跟踪 PASS、被忽略记未定 embedded-untracked、不在 git 仓库记未定",
                evidence="干净 %s；仅未跟踪 %s；未暂存 %s；已暂存 %s；被忽略 %s；非 git %s"
                         % (clean, untracked, dirty, staged, ignored, (outside["status"], outside["id"])),
                why="01 §8：内嵌的 `.std/` 只读；契约 §3 静默失效探测")
    except Exception as exc:  # noqa: BLE001
        return finding(NAME, FAIL, "内嵌目录只读的自检跑不起来",
                       evidence="%s: %s" % (type(exc).__name__, exc),
                       why="契约 §3：自检崩了，本检查器对目标仓库的结论作废")


def selftest():
    """反例与正例。见契约 §3：抓不出违规的检查器，其结论作废。

    最后一条是**变异验证**：把"不与工具常量比对"改成真去比对，探针必须报警。
    没有它，那条硬约束就只是一句注释。
    """
    results = []
    cases = [
        (None, (FAIL, SKIP),
         "反例：文件缺失应判 FAIL（01 §8 第一条）"),
        (u"\n   \n", (FAIL, UNDETERMINED, SKIP),
         "反例：空文件——版本读不出判 FAIL，采用日期读不出记未定"),
        (u"adopted_at: 2025-03-03\n", (FAIL, PASS, SKIP),
         "反例：只有采用日期、读不出版本值应判 FAIL"),
        (u"1.0\n", (PASS, UNDETERMINED, SKIP),
         "只有版本值、没有采用日期记未定：日期字段名是工具约定，落空不判 FAIL（契约 §1.1）"),
        (_COMPLETE, (PASS, PASS, SKIP),
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
                NAME, PASS if (len(ids) == 3 and "adoption/version-mismatch" not in ids
                               and not any("embedded-modified" in i for i in ids)) else FAIL,
                "非内嵌运行（被扫根不含本工具）时不产出内嵌修订号比对，内嵌目录只读记不适用",
                evidence="实得 %s" % ids,
                why="只在内嵌运行时比对：外部工具副本扫项目时，被扫项目里的 .std/ 不是正在跑的这份",
            ))

            # —— 内嵌目录只读（01 §8）：同上，直接测判定函数 ——
            results.append(_readonly_selftest())

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
