#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""stdlib 检查器外壳（run_guarded / undetermined_from_exception / probe / probe_crashed / unreadable / outside_root / once / agg / work_root_absent）的单元黄金样本。

异常的 `type(exc).__name__` 与 `str(exc)` 会进 finding 的 reason：Python 与 JS 的异常类名体系不同（Python 有 FileNotFoundError / KeyError / ZeroDivisionError……，
JS 只有 Error / TypeError / RangeError……）。所以这里**只记 Python 能由 Node 里对应情形复现的几类**——OSError 家族（按 errno 映射）与本模块自己抛的拒读类；
其它 Python 内置异常（KeyError、ValueError 等）在 TS 里没有对应物，TS 版的检查器遇到的是 JS 的 Error 类名，那是**有意不同**（设计 §12.6 D14）。
用法：python golden/make_unit_shell.py
"""
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "tools", "std"))
import stdlib as sl  # noqa: E402


def fnd(f):
    return {k: f[k] for k in ("check", "id", "status", "title", "where", "why", "reason", "evidence", "registered")}


def call(fn, *a, **k):
    try:
        v = fn(*a, **k)
        if isinstance(v, list):
            return {"ok": [fnd(x) if isinstance(x, dict) else x for x in v]}
        if isinstance(v, dict) and "check" in v:
            return {"ok": fnd(v)}
        return {"ok": v}
    except Exception as exc:  # noqa: BLE001
        return {"raised": type(exc).__name__, "message": str(exc)}


class Boom(Exception):
    pass


EXCS = [
    ("filenotfound", FileNotFoundError(2, "No such file or directory")), ("permission", PermissionError(13, "Permission denied")),
    ("isadir", IsADirectoryError(21, "Is a directory")), ("notadir", NotADirectoryError(20, "Not a directory")), ("oserror", OSError(5, "I/O error")),
    ("plain_oserror_msg", OSError("自定义消息")), ("outside_root", sl.OutsideRoot("x 的真实位置在被扫项目之外")), ("too_large", sl.TooLarge("x 超过上限")),
    ("not_regular", sl.NotRegular("x 不是常规文件")), ("config_error", sl.ConfigError("第 3 行不对")), ("custom", Boom("炸了")), ("custom_empty", Boom()),
    ("value_error", ValueError("bad")), ("key_error", KeyError("k")), ("type_error", TypeError("t")), ("zero_div", ZeroDivisionError("division by zero")),
    ("runtime", RuntimeError("r")), ("recursion", RecursionError("maximum recursion depth exceeded")),
]
FINDINGS = [sl.finding("c", s, "t%d" % i, kind="k", key=str(i % 3), reason="r" if s in (sl.UNDETERMINED, sl.SKIP) else "")
            for i, s in enumerate((sl.PASS, sl.FAIL, sl.UNDETERMINED, sl.SKIP, sl.PASS, sl.FAIL))]


def main():
    out = {"exc": [], "probe": [], "unreadable": [], "once": [], "outside": [], "agg": [], "run_guarded": [], "work_root_absent": []}
    for name, e in EXCS:
        out["exc"].append({"name": name, "undetermined": call(sl.undetermined_from_exception, "chk", e, "读东西"), "unreadable": call(sl.unreadable, "chk", "docs/a.md", e),
                           "probe_crashed": call(sl.probe_crashed, "chk", "某断言", e), "type_name": type(e).__name__})
    for ok in (True, False, 1, 0, "", "x", None, [], [1]):
        out["probe"].append({"ok": repr(ok), "out": call(sl.probe, "chk", ok, "断言", evidence="e", why="w")})
    out["probe"].append({"ok": "reason-given", "out": call(sl.probe, "chk", False, "断言", reason="r")})
    for rel in ("a.md", "docs/a b.md", "中文.md", "", "a|b.md", "  sp  ", "a\nb.md"):
        out["unreadable"].append({"rel": rel, "out": call(sl.unreadable, "chk", rel, FileNotFoundError())})
        out["outside"].append({"rel": rel, "out": call(sl.outside_root, "chk", rel)})
    dup = [sl.finding("c", sl.PASS, "a", kind="k", key="1"), sl.finding("c", sl.FAIL, "b", kind="k", key="1"), sl.finding("c", sl.PASS, "c", kind="k", key="2"),
           sl.finding("c", sl.PASS, "d", kind="k", key="1"), sl.finding("c", sl.PASS, "e", kind="k", key="2")]
    out["once"].append({"name": "dup", "out": call(sl.once, dup)})
    out["once"].append({"name": "empty", "out": call(sl.once, [])})
    out["once"].append({"name": "single", "out": call(sl.once, dup[:1])})
    out["once"].append({"name": "distinct", "out": call(sl.once, FINDINGS)})
    for n in (0, 1, 5, 12, 13, 20, 100):
        paths = ["docs/f%03d.md" % i for i in range(n)]
        out["agg"].append({"n": n, "out": call(sl.agg, "chk", sl.UNDETERMINED, "标题", paths, "原因", "依据", kind="kk")})
    out["agg"].append({"n": "no_why", "out": call(sl.agg, "chk", sl.PASS, "标题", ["a"], "", kind="kk")})
    # run_guarded：裁剪（有理由、无理由、不适用不为 false）、正常、抛各种异常、返回非 list
    def fine(cfg):
        return [sl.finding("c", sl.PASS, "ok")]
    def boom(cfg):
        raise Boom("炸")
    def fnf(cfg):
        raise FileNotFoundError(2, "x")
    cfgs = [("none", {}), ("tailored_reason", {"tailoring": [{"check": "c", "applicable": False, "reason": "不适用"}]}),
            ("tailored_noreason", {"tailoring": [{"check": "c", "applicable": False}]}), ("tailored_other", {"tailoring": [{"check": "d", "applicable": False, "reason": "r"}]}),
            ("tailored_applicable", {"tailoring": [{"check": "c", "applicable": True}]})]
    for cn, cfg in cfgs:
        for fn_name, fn in (("fine", fine), ("boom", boom), ("fnf", fnf)):
            out["run_guarded"].append({"cfg": cn, "fn": fn_name, "out": call(sl.run_guarded, "c", fn, cfg)})
    # work_root_absent：目录在、不在、出仓链接、配置了的、docs_root 改基
    tmp = tempfile.mkdtemp(prefix="goldsh-")
    try:
        os.makedirs(os.path.join(tmp, "docs", "state", "work"))
        os.makedirs(os.path.join(tmp, "w"))
        cases = [("default_present", {}), ("declared_present", {"layout": {"work_root": "w"}}), ("declared_absent", {"layout": {"work_root": "nope"}}),
                 ("docs_root_rebase_absent", {"layout": {"docs_root": "manual"}}), ("declared_backslash", {"layout": {"work_root": "w\\"}}), ("declared_spaces", {"layout": {"work_root": " w "}}),
                 ("declared_is_file", {"layout": {"work_root": "f.txt"}})]
        with open(os.path.join(tmp, "f.txt"), "w") as fh:
            fh.write("x")
        for n, cfg in cases:
            c = dict(cfg); c["_root"] = tmp
            out["work_root_absent"].append({"name": n, "out": call(sl.work_root_absent, "c", c)})
        outside = tempfile.mkdtemp(prefix="goldsh-out-")
        try:
            os.symlink(outside, os.path.join(tmp, "linkdir"), target_is_directory=True)
            c = {"_root": tmp, "layout": {"work_root": "linkdir"}}
            out["work_root_absent"].append({"name": "declared_symlink_out", "symlink": True, "out": call(sl.work_root_absent, "c", c)})
        except OSError:
            out["work_root_absent"].append({"name": "declared_symlink_out", "symlink": False})
        finally:
            shutil.rmtree(outside, ignore_errors=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    path = os.path.join(HERE, "unit", "stdlib-shell.json")
    tmpf = path + ".tmp"
    with open(tmpf, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    back = json.load(open(tmpf, encoding="utf-8"))
    if {k: len(v) for k, v in back.items()} != {k: len(v) for k, v in out.items()}:
        sys.exit("回读与内存不一致，拒绝落盘")
    os.replace(tmpf, path)
    print("写出 golden/unit/stdlib-shell.json：" + "、".join("%s %d" % (k, len(v)) for k, v in out.items()))


if __name__ == "__main__":
    main()
