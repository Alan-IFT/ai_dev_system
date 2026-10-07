#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""stdlib 文档头部与工作项函数（find_field / head_of / item_status / clean / under / is_work_item_name / status_kind /
docs_root_of / entry_files / rebase_docs / work_root / in_frozen / date_fields_of / is_tailored_out / artifact_tailored / metadata_required_hit 之外的小工具）的单元黄金样本。

find_field 的正则依赖 Python `re` 的语义（Unicode 大小写折叠、`\\s` 的集合、`(?<=...)` 的回看、`re.M` 的 `^`），是最容易在 JS 里悄悄不同的地方，所以输入给得最密：
中英字段名、全角冒号与全角空格、加粗斜体反引号装饰、行首与竖线与 `>` 之后、满行星号（性能）、大小写（含 Kelvin 符号 K 与 ſ 这类 Unicode 折叠）、空值。
纯函数的输出直接记；依赖文件系统的（entry_files 要 isfile）在临时目录里建夹具。
用法：python golden/make_unit_docs.py
"""
import hashlib
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "tools", "std"))
import stdlib as sl  # noqa: E402


def call(fn, *a, **k):
    try:
        return {"ok": fn(*a, **k)}
    except Exception as exc:  # noqa: BLE001
        return {"raised": type(exc).__name__}


def tup(v):
    return list(v) if isinstance(v, tuple) else v


FIELD_TEXTS = [
    "状态：进行中", "状态: 进行中", "状态 ：进行中", "状态 : 进行中", "状态:进行中", "状态：", "状态：\n下一行", "状态：  \n", "状态：\t值", "状态：　值", "状态　：值",
    "**状态**：done", "*状态*：done", "`状态`：done", "__状态__：done", "***状态***：done", "*****状态*****：done", "**状态**：**done**", "**状态：**done", "`status`: done",
    "status: done", "Status: done", "STATUS: done", "sTaTuS: done", "state: x", "State: x", "状态：a\n状态：b", "status:\nstatus: later", "status: a | status: b", "status: a　status: b",
    "| 状态 | 进行中 |", "| 状态：进行中 | x |", "> 状态：进行中", ">状态：进行中", "- 状态：进行中", "-状态：进行中", "* 状态：进行中", "  状态：进行中", "\t状态：进行中",
    "build-status: passing", "build_status: passing", "x状态：y", "_状态：y", "pre status: z", "pre-status: z", "(status: z)", "[status: z]", "“状态：z”",
    "状态：进行中（待复核）", "状态：进行中 (x)", "状态：a|b", "状态：a　b", "状态：a\u00a0b", "状态：a\u2003b", "状态：a\u3000b", "状态：中文值", "状态：`x`", "状态：**x**",
    "状态：" + "x" * 200, "x" * 500, "*" * 5000, "*" * 5000 + "状态：z", "状态" + "*" * 5000 + "：z", "状态：z" + "*" * 5000, " " * 5000 + "状态：z", "\n" * 3000 + "状态：z",
    "updated_at: 2026-01-01", "Updated_At: 2026-01-01", "UPDATED_AT: 2026-01-01", "updated_at：2026-01-01", "更新于：2026-01-01", "更新于 ：2026-01-01",
    "K: 1", "\u212a: 1", "ſ: 1", "ss: 1", "ß: 1", "İ: 1", "ı: 1", "I: 1", "i: 1",
    "", "\n", "状态", "：", "状态：\n", "\ufeff状态：x", "状态：x\r\n", "状态：x\r下一", "a\r状态：x",
    "---\nstatus: active\n---\n正文", "status: a\n状态: b\nstate: c", "state: c\n状态: b\nstatus: a",
    # —— 变异验证发现的盲区：这些输入此前没有，对应的实现分支没有被任何样本触发 ——
    # —— 字段名含连字符等字符（对应 FIELD_NAME_SETS 末尾那一批）——
    "updated-at: 2026-01-01", "Updated-At：2026-01-01", "last-transition-at: x", "a-b: 1", "- : 1", "a#b: 1", "a&b: 1", "a~b: 1", "a!b: 1", "a'b: 1", 'a"b: 1', "a%b: 1", "a,b: 1", "a;b: 1", "a<b: 1", "a=b: 1",
    "a>b: 1", "a@b: 1", "a/b: 1", "a\\b: 1", "a:b: 1", "a_b: 1", "a{b}: 1", "a^b: 1", "a$b: 1", "a*b: 1", "a?b: 1", "a b: 1", "axb: 1", "a-b: 1\na_b: 2",
    "state: a\n状态: b", "state: a\nstatus: b", "status: a\nstate: b", "x|status: z", "xstatus: z", "|status: z", "a|状态：z",
    "****status****: z", "*****status*****: z", "****status***: z", "***status****: z", "___状态___：z", "____状态____：z", "`status`: z", "``status``: z", "``````status``````: z",
    "status\t:\tz", "status\t: z", "status :\tz", "status:\t\tz", "状态\t：\tz",
    "x\nstatus: z", "x\n状态：z", "x\r\nstatus: z", "x\n\nstatus: z", "x status: z", "x\tstatus: z", "x　status: z",
    "状态：\n状态：b", "状态：\nstatus: x", "status:\nstate: x", "state:\nstatus: x", "status: \nstate: x", "状态：　\nstate: x",
    "status: \ufeff", "status: \ufeffx\ufeff", "status:\ufeffx", "status: x\ufeff", "status: \u001cx", "status: x\u0085", "status: \u0085x",
    "ſtatus: z", "ſtate: z", "STATUS: z", "\u212aey: z", "ke\u212a: z", "\u0130d: z", "\u0131d: z", "ß: 1", "ẞ: 1", "straße: 1",
]
FIELD_NAME_SETS = [["状态", "status", "state"], ["status"], ["状态"], ["updated_at"], ["更新于", "updated_at"], ["k"], ["s"], ["i"], ["key"], ["id"], ["ss"], ["a.b"], ["a+b"], ["(x)"], ["[x]"], ["x|y"], ["中 文"], [""], ["状态", ""], [],
                   # 带连字符等字符的名字：Python 的 re.escape 转义它们都合法，JS 的 `u` 模式不许在字符类之外写 `\-`——曾整条抛 SyntaxError（evidence 迁移时发现，样本里此前没有一个含 `-` 的名字）
                   ["updated-at"], ["last-transition-at"], ["a-b"], ["-"], ["a#b"], ["a&b"], ["a~b"], ["a!b"], ["a'b"], ['a"b'], ["a%b"], ["a,b"], ["a;b"], ["a<b"], ["a=b"], ["a>b"], ["a@b"], ["a/b"], ["a\\b"], ["a:b"], ["a_b"], ["a{b}"], ["a^b"], ["a$b"], ["a*b"], ["a?b"], ["a b"]]

HEAD_TEXTS = [
    "---\nstatus: active\n---\n# T\n正文", "---\nstatus: active\n---\n# T\n\n## 背景\n状态：old", "---\ntitle: x\n---\n# T\n状态：active\n## s\n状态：old",
    "---\ntitle: x\n---\n状态：active\n", "---\nupdated_at: 2026-01-01\n---\n# T\n状态：进行中\n\n## 小节\n状态：旧", "---\nstatus: a\n---\n---\nstatus: b\n---\n",
    "\ufeff---\nstatus: a\n---\n", "---  \nstatus: a\n---  \n", "---\nstatus: a\n---", "---\nstatus: a\n--- x\n", "---\nstatus: a\n", "--\nstatus: a\n--\n",
    "# T\n状态：a\n## B\n状态：b", "# T\n\n#### 四级\n状态：b", "# T\n# 另一个一级\n状态：b", "#### 先四级\n状态：b", "##没空格\n状态：b", "## \n状态：b", "状态：a", "",
    "x" * 4100 + "\n状态：late", "状态：early\n" + "x" * 4100, "---\n" + "a: b\n" * 1000 + "status: late\n---\n", "# T\n" + "x" * 3990 + "\n## S\n状态：z",
    "---\ntitle: t\n---\n# T\n## 状态\n状态：x", "---\n状态: 草稿\n---\n# T", "---\nstate: x\n---\n", "---\nSTATUS: x\n---\n",
    # 变异验证补：六级标题、五级、七个 #（不是标题）、标题后制表符/全角空格
    "# T\n状态：a\n###### 六级\n状态：b", "# T\n状态：a\n##### 五级\n状态：b", "# T\n状态：a\n####### 七级\n状态：b", "# T\n状态：a\n##\t制表\n状态：b", "# T\n状态：a\n##　全角\n状态：b",
    "# T\n状态：a\n## \n", "# T\n状态：a\n##", "# T\n状态：a\n  ## 缩进\n状态：b", "# T\n状态：a\r\n## B\r\n状态：b", "# T\n状态：a\r## B\r状态：b",
]

STATUS_TEXTS = [
    "状态：进行中", "状态：**进行中**", "状态：`done`", "状态：Done", "状态：DONE", "状态：进行中（待复核）", "状态：done (note)", "状态：done（a）(b)", "状态：（括注开头）",
    "状态：", "无状态字段", "---\nstatus: Active\n---\n", "status: in progress", "status: IN_PROGRESS", "状态: 完成 2026-02-20", "状态：  已完成  ", "状态：a|b",
    "状态：**done**（x）", "状态：`a`", "状态：*a*", "状态：_a_", "状态：__a__", "状态：done。", "状态：Ünïcode", "状态：İSTANBUL", "状态：ẞ",
]

CLEAN_INPUTS = ["**a**", "`a`", "*a*", " a ", "a*b`c", "", "  ", "**", "a\tb", "a\u00a0", "\u3000a\u3000", "a\ufeff", 5, None, True, 3.5, "中文**加粗**", "*`*`*"]
UNDER_CASES = [("a/b", "a"), ("a/b", "a/"), ("a/b", "a/b"), ("a/b", "a/b/"), ("a/bc", "a/b"), ("a", "a"), ("a/b", ""), ("a/b", "."), ("a/b", "./"), ("a/b", "a\\"), ("a\\b", "a"),
               ("a/b", " a "), ("", ""), ("", "a"), ("./a", "a"), ("a//b", "a"), ("A/b", "a"), ("a/b", "a/b/c"), ("中/文", "中"), ("a/b", "/"), ("/a", ""), ("a/b", "a//")]
NAMES = ["WI-001-x.md", "WI-0001.md", "WI-01.md", "WI-123", "wi-123.md", "WI-123x", "xWI-123", "docs/state/work/WI-001-a.md", "docs\\WI-002.md", "WI-.md", "WI-１２３.md", "WI-123.md/x",
         "work/WI-9999-中文.md", "", "WI-001", "docs/WI-001/readme.md", "WI-0a1.md", "B-001.md", "wi-001-x", "WI−001.md"]
REBASE = [("docs/a.md", "docs"), ("docs/a.md", "manual"), ("docs/a.md", "manual/"), ("docs/a.md", "./manual"), ("docs", "manual"), ("docsx/a", "manual"), ("a/docs/b", "manual"),
          ("docs/a.md", ""), ("docs/a.md", None), ("docs\\a.md", "m"), ("docs/a.md", " m "), ("docs/", "m"), ("docs/state/work", "d2"), ("docs/state/work", "d2/"), ("DOCS/a", "m"), ("docs/a", "docs/"), ("docs/a", "m/n"), (" docs/a ", "m"),
          ("docs/", "docs"), ("docs/a/b/c.md", "m"), ("docs/a.md", "m\\"), ("docs/a.md", 5), ("docs/a.md", 0), ("docs/a.md", False), ("docs/a.md", " "), ("docs//a", "m"), ("docs/docs/a", "m"), ("docs", "docs"), ("docs/", "m/")]

CFGS = {
    "empty": {}, "docs_root": {"layout": {"docs_root": "manual"}}, "docs_root_empty": {"layout": {"docs_root": ""}}, "docs_root_int": {"layout": {"docs_root": 5}},
    "work_root": {"layout": {"work_root": "w/x"}}, "work_root_empty": {"layout": {"work_root": ""}}, "work_root_with_docs": {"layout": {"docs_root": "manual"}},
    "entry_decl": {"layout": {"entry": ["A.md", "B.md"]}}, "entry_decl_str": {"layout": {"entry": "A.md"}}, "entry_art": {"layout": {"artifacts": {"entry": "E.md"}}},
    "entry_art_list": {"layout": {"artifacts": {"entry": ["E.md", "F.md"]}}}, "entry_both": {"layout": {"entry": "A.md", "artifacts": {"entry": "E.md"}}},
    "entry_empty_list": {"layout": {"entry": []}}, "entry_empty_str": {"layout": {"entry": ""}},
    "frozen": {"layout": {"frozen": ["docs/archive", "old/"]}}, "frozen_str": {"layout": {"frozen": "docs/archive"}}, "frozen_empty": {"layout": {"frozen": []}},
    "tailor": {"tailoring": [{"check": "freshness", "applicable": False, "reason": "不适用 x"}, {"check": "layout:status", "applicable": False, "reason": ""}, {"check": "evidence", "applicable": True}]},
    "tailor_no_reason": {"tailoring": [{"check": "freshness", "applicable": False}]}, "tailor_str_applicable": {"tailoring": [{"check": "freshness", "applicable": "false"}]},
    "tailor_role_form": {"tailoring": [{"check": "status", "applicable": False, "reason": "r"}]}, "tailor_layout_form": {"tailoring": [{"check": "layout:acceptance", "applicable": False, "reason": "r2"}]},
    "tailor_nondict": {"tailoring": ["x", 5, None]}, "tailor_empty": {"tailoring": []}, "tailor_none": {"tailoring": None},
    "fields_default": {}, "fields_list": {"metadata_fields": ["updated_at", "更新于"]}, "fields_str": {"metadata_fields": "更新于"}, "fields_empty_list": {"metadata_fields": []},
    "fields_blank_items": {"metadata_fields": ["", "  ", "x"]}, "fields_int": {"metadata_fields": 5}, "fields_ints": {"metadata_fields": [1, 2]}, "fields_map": {"metadata_fields": {"a": 1}},
    "arts": {"layout": {"artifacts": {"status": "./WORK.md", "acceptance": "ACCEPTANCE.md/", "other": "docs/x.md", "n": 5}}},
    # 变异验证补
    "work_root_trailing_slash": {"layout": {"work_root": "w/x/"}}, "work_root_backslash": {"layout": {"work_root": "w\\x"}}, "work_root_spaces": {"layout": {"work_root": " w/x "}},
    "docs_root_trailing_slash": {"layout": {"docs_root": "manual/"}}, "docs_root_docs": {"layout": {"docs_root": "docs"}}, "docs_root_with_work": {"layout": {"docs_root": "m", "work_root": ""}},
    "frozen_backslash": {"layout": {"frozen": ["docs\\archive", "old\\sub\\"]}}, "frozen_spaces": {"layout": {"frozen": [" docs/archive "]}}, "frozen_int_item": {"layout": {"frozen": [5, "docs/archive"]}},
    "tailor_reason_spaces": {"tailoring": [{"check": "freshness", "applicable": False, "reason": "  理由  "}, {"check": "status", "applicable": False, "reason": "  r  "}]},
    "tailor_dup_first_not_false": {"tailoring": [{"check": "freshness", "applicable": True}, {"check": "freshness", "applicable": False, "reason": "二"}, {"check": "status", "applicable": True}, {"check": "status", "applicable": False, "reason": "s2"}]},
    "tailor_numeric_check": {"tailoring": [{"check": 5, "applicable": False, "reason": "r"}, {"check": True, "applicable": False, "reason": "t"}]},
    "tailor_no_applicable": {"tailoring": [{"check": "freshness"}, {"check": "status"}]}, "tailor_applicable_true": {"tailoring": [{"check": "freshness", "applicable": True, "reason": "x"}, {"check": "status", "applicable": True, "reason": "y"}]},
    "tailor_reason_int": {"tailoring": [{"check": "freshness", "applicable": False, "reason": 5}]}, "tailor_reason_none": {"tailoring": [{"check": "freshness", "applicable": False, "reason": None}]},
    "tailor_check_missing": {"tailoring": [{"applicable": False, "reason": "r"}]},
    "fields_str_spaces": {"metadata_fields": "  更新于  "}, "fields_mixed": {"metadata_fields": ["a", "", " b ", "c"]}, "fields_list_of_none": {"metadata_fields": [None, "x"]},
    "entry_decl_ints": {"layout": {"entry": [1, "B.md"]}}, "entry_decl_nonstr_nonlist": {"layout": {"entry": 5}}, "entry_none": {"layout": {"entry": None}},
}


def main():
    out = {"field": [], "head": [], "status": [], "clean": [], "under": [], "name": [], "rebase": [], "cfg": []}
    for text in FIELD_TEXTS:
        for names in FIELD_NAME_SETS:
            if len(text) > 400:
                label = {"len": len(text), "sha1": hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]}
            else:
                label = text
            out["field"].append({"text": label, "names": names, "out": call(lambda t=text, n=names: tup(sl.find_field(t, n)))})
    for text in HEAD_TEXTS:
        label = text if len(text) < 400 else {"len": len(text), "sha1": hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]}
        out["head"].append({"text": label, "out": call(sl.head_of, text), "status": call(sl.item_status, text)})
    for text in STATUS_TEXTS:
        out["status"].append({"text": text, "out": call(sl.item_status, text)})
    for v in CLEAN_INPUTS:
        out["clean"].append({"in": v, "out": call(sl.clean, v)})
    for rel, sub in UNDER_CASES:
        out["under"].append({"rel": rel, "sub": sub, "out": call(sl.under, rel, sub)})
    for n in NAMES:
        out["name"].append({"rel": n, "out": call(sl.is_work_item_name, n)})
    for rel, dr in REBASE:
        out["rebase"].append({"rel": rel, "docs_root": dr, "out": call(sl.rebase_docs, rel, dr)})

    tmp = tempfile.mkdtemp(prefix="golddocs-")
    try:
        for cand in ("AGENTS.md", "CONTEXT.md"):
            pass
        for name, cfg in CFGS.items():
            c = dict(cfg)
            c["_root"] = tmp
            rec = {"name": name, "config": cfg}
            rec["docs_root_of"] = call(lambda c=c: tup(sl.docs_root_of(c)))
            rec["work_root"] = call(lambda c=c: tup(sl.work_root(c)))
            rec["entry_files"] = call(lambda c=c: tup(sl.entry_files(c)))
            rec["is_tailored_out"] = {chk: call(lambda c=c, chk=chk: tup(sl.is_tailored_out(c, chk))) for chk in ("freshness", "layout", "evidence", "x")}
            rec["artifact_tailored"] = {r: call(lambda c=c, r=r: tup(sl.artifact_tailored(c, r))) for r in ("status", "acceptance", "handoff", "entry")}
            rec["date_fields_of"] = call(lambda c=c: tup(sl.date_fields_of(c)))
            rec["in_frozen"] = {p: call(lambda c=c, p=p: sl.in_frozen(c, p)) for p in ("docs/archive/a.md", "docs/archive", "docs/archivex/a.md", "old/x", "old", "docs\\archive\\a.md", "other", "")}
            out["cfg"].append(rec)
        # entry_files 依赖文件系统：候选的存在与否、同时存在、出仓的候选
        out["entry_fs"] = []
        for label, files in [("none", []), ("agents", ["AGENTS.md"]), ("context", ["CONTEXT.md"]), ("claude_only", ["CLAUDE.md"]), ("all_three", ["CONTEXT.md", "AGENTS.md", "CLAUDE.md"]),
                             ("agents_claude", ["AGENTS.md", "CLAUDE.md"]), ("lowercase_agents", ["agents.md"])]:
            t2 = tempfile.mkdtemp(prefix="golddocs-")
            try:
                for f in files:
                    with open(os.path.join(t2, f), "w", encoding="utf-8") as fh:
                        fh.write("x")
                out["entry_fs"].append({"name": label, "files": files, "result": call(lambda t2=t2: tup(sl.entry_files({"_root": t2})))})
            finally:
                shutil.rmtree(t2, ignore_errors=True)
        # 候选是指向仓外的符号链接：出仓的候选不探测、照算命中
        t3 = tempfile.mkdtemp(prefix="golddocs-")
        o3 = tempfile.mkdtemp(prefix="golddocs-out-")
        try:
            with open(os.path.join(o3, "secret.md"), "w", encoding="utf-8") as fh:
                fh.write("x")
            try:
                os.symlink(os.path.join(o3, "secret.md"), os.path.join(t3, "CONTEXT.md"))
                with open(os.path.join(t3, "AGENTS.md"), "w", encoding="utf-8") as fh:
                    fh.write("x")
                out["entry_fs"].append({"name": "context_symlink_out", "files": ["CONTEXT.md→outside", "AGENTS.md"], "symlink": True,
                                        "result": call(lambda: tup(sl.entry_files({"_root": t3})))})
            except OSError:
                out["entry_fs"].append({"name": "context_symlink_out", "symlink": False})
        finally:
            shutil.rmtree(t3, ignore_errors=True)
            shutil.rmtree(o3, ignore_errors=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # status_kind / state_class：配置 × 文件名 × 状态值
    sk = []
    cfgs = [("none", {}), ("declared", {"work_item_done_states": ["shipped"], "work_item_in_progress_states": ["doing"]}),
            ("arts", {"layout": {"artifacts": {"status": "docs/state/STATUS.md", "current": "./work/current.md", "dir": "docs/x/", "multi": "././work/multi.md", "wi": "docs/state/work/WI-001-a.md", "abs": "/etc/x.md", "none": 5}}})]
    for cn, cfg in cfgs:
        for rel in ("docs/state/work/WI-001-x.md", "docs/state/STATUS.md", "work/current.md", "docs/x", "docs/state/work/B-001.md", "x.md", "WI-12.md", "work\\current.md",
                    "work/multi.md", "docs/state/work/WI-001-a.md", "WI-001-a.md", "/etc/x.md", "./work/current.md", "work/current.md/"):
            for st in ("done", "active", "draft", "doing 2026", "shipped", "未知", "", None, "草稿", "现行", "进行中", "完成", "已取代 2026", "superseded", "retired.", "actives"):
                sk.append({"cfg": cn, "rel": rel, "status": st, "out": call(lambda cfg=cfg, rel=rel, st=st: tup(sl.status_kind(cfg, rel, st)))})
    out["status_kind"] = sk
    out["status_kind_cfgs"] = dict(cfgs)
    path = os.path.join(HERE, "unit", "stdlib-docs.json")
    tmpf = path + ".tmp"
    with open(tmpf, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    back = json.load(open(tmpf, encoding="utf-8"))
    if {k: len(v) for k, v in back.items()} != {k: len(v) for k, v in out.items()}:
        sys.exit("回读与内存不一致，拒绝落盘")
    os.replace(tmpf, path)
    print("写出 golden/unit/stdlib-docs.json：" + "、".join("%s %d" % (k, len(v)) for k, v in out.items()))


if __name__ == "__main__":
    main()
