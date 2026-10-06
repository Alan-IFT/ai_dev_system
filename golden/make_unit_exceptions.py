#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""stdlib 例外登记册（load_exceptions / _ex_closed / _md_cells / _first_md_table / _ex_field）的单元黄金样本。

三部分：
 ① 纯函数：_ex_closed（关闭态判定）、_md_cells（拆表格行）、_ex_field（表头归类）——对一批输入记完整输出；
 ② load_exceptions：对一批 exceptions.md 文本，在临时项目里写成 governance/exceptions.md，固定 today，记 (rows, problems, own)——路径部分归一，不含临时目录名；
 ③ 文件布局：不存在、是目录、符号链接出仓、外部配置目录、非 UTF-8、没有表。
today 固定为 2026-10-06（`load_exceptions(today=)` 注入），所以输出不随运行日变化。
用法：python golden/make_unit_exceptions.py
"""
import datetime
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "tools", "std"))
import stdlib as sl  # noqa: E402

TODAY = datetime.date(2026, 10, 6)

CLOSED_INPUTS = [
    "", "关闭", "已关闭", "closed", "Closed", "CLOSED", "done", "已处理", "已关闭（09-01）", "**done**", "`closed`", "**已过期，已处理**（…）", "已过期，已处理",
    "没关闭", "not yet closed", "已处理中", "done? 否", "closed-loop 待复核", "open (to be closed)", "open", "生效中", "active",
    "closed.", "closed。", "closed:", "closed：", "closed (x)", "closed（x）", "closed[x]", "closed【x】", "closed\tx", "closed*", "closed`",
    "doneness", "done2", "done_x", "已处理a", "closedx", "关闭了", "关闭，续期", "a, closed", "a；已关闭", "a、done", "a/closed", "a|done", "a,b,c",
    "  closed  ", "* closed *", "** closed **", "` closed `", "Closed (2026-09-01)", "CLOSED（已完成）", "已关闭，但仍在用", "pending, done",
    "关闭\n", "closed\n", "x,,closed", ",closed", "closed,", "；；已关闭", "DONE", "Done.", "dOnE：", "已 处理", "已处 理",
]

CELL_LINES = [
    "| a | b | c |", "|a|b|c|", "| a | b |", "a | b | c", "| a \\| b | c |", "| a \\\\| b |", "| a \\x | b |", "| a \\", "|", "||", "| | |", "| a |  | c |",
    "| `x|y` | z |", "| a | b | \\|", "  | a | b |  ", "| a |b| c |", "| 中 | 文 |", "|\ta\t|\tb\t|", "| a | b \\\\| c |", "| \\| | \\| |", "| a \\|\\| b |",
    "| a | b |\\", "| a | b \\|", "\\| a", "| a\\|b | c", "|||", "| a |||b |",
]

HEADER_INPUTS = ["编号", "id", "ID", "Id", " id ", "rule id", "Rule ID", "规则", "理由", "范围", "批准", "批准人", "到期", "到期 / valid until", "valid until", "状态", "Provider",
                 "provider", "ex_id", "编号/规则", "规则/理由", "状态/到期", "", "  ", "说明", "备注", "Expires", "过期", "审批人", "批准人/日期", "ID 编号", "idx", "未编号"]

# exceptions.md 样本：(名字, 文本)
HDR = "| 编号 | 规则 | 理由 | 范围 | 批准 | 到期 | 状态 |\n|---|---|---|---|---|---|---|\n"
SAMPLES = [
    ("ok_one", HDR + "| E1 | `layout/entry-missing` | 暂缓 | 全仓 | Alan | 2026-12-31 | 生效 |\n"),
    ("ok_no_backticks", HDR + "| E1 | layout/entry-missing | 暂缓 | 全仓 | Alan | 2026-12-31 | |\n"),
    ("ok_no_id", HDR + "|  | layout/x | r | s | a | 2026-12-31 | |\n"),
    ("ok_two", HDR + "| E1 | a/b | r | s | a | 2026-12-31 | |\n| E2 | c/d | r | s | a | 2027-01-01 | |\n"),
    ("closed_skipped", HDR + "| E1 | a/b | r | s | a | 2026-12-31 | 已关闭 |\n"),
    ("closed_with_missing_fields_skipped", HDR + "| E1 | a/b | | | | | closed |\n"),
    ("not_closed_counts", HDR + "| E1 | a/b | r | s | a | 2026-12-31 | not yet closed |\n"),
    ("closed_loop_counts", HDR + "| E1 | a/b | r | s | a | 2026-12-31 | closed-loop 待复核 |\n"),
    ("missing_reason", HDR + "| E1 | a/b | | s | a | 2026-12-31 | |\n"),
    ("missing_all_four", HDR + "| E1 | a/b | | | | 2026-12-31 | |\n"),
    ("missing_expires", HDR + "| E1 | a/b | r | s | a | | |\n"),
    ("expires_not_date", HDR + "| E1 | a/b | r | s | a | 年底 | |\n"),
    ("expires_date_plus_text", HDR + "| E1 | a/b | r | s | a | 2026-12-31 之前 | |\n"),
    ("expires_iso_datetime", HDR + "| E1 | a/b | r | s | a | 2026-12-31T10:00:00Z | |\n"),
    ("expires_bold", HDR + "| E1 | a/b | r | s | a | **2026-12-31** | |\n"),
    ("expires_backtick", HDR + "| E1 | a/b | r | s | a | `2026-12-31` | |\n"),
    ("expires_exact_limit", HDR + "| E1 | a/b | r | s | a | 2027-10-06 | |\n"),
    ("expires_over_limit_by_one", HDR + "| E1 | a/b | r | s | a | 2027-10-07 | |\n"),
    ("expires_far", HDR + "| E1 | a/b | r | s | a | 2099-01-01 | |\n"),
    ("expires_past", HDR + "| E1 | a/b | r | s | a | 2020-01-01 | |\n"),
    ("expires_today", HDR + "| E1 | a/b | r | s | a | 2026-10-06 | |\n"),
    ("expires_invalid_calendar", HDR + "| E1 | a/b | r | s | a | 2026-02-30 | |\n"),
    ("internal_error_rule", HDR + "| E1 | layout/internal-error | r | s | a | 2026-12-31 | |\n"),
    ("internal_error_rule_with_key", HDR + "| E1 | layout/internal-error/x | r | s | a | 2026-12-31 | |\n"),
    ("internal_error_as_third_segment_ok", HDR + "| E1 | layout/x/internal-error | r | s | a | 2026-12-31 | |\n"),
    ("project_own_gate", HDR + "| E1 | G6 | r | s | a | 2026-12-31 | |\n"),
    ("project_own_gate_no_expires", HDR + "| E1 | G6 | r | s | a | | |\n"),
    ("project_own_gate_bad_expires", HDR + "| E1 | G9 | r | s | a | 年底 | |\n"),
    ("project_own_gate_closed", HDR + "| E1 | G6 | r | s | a | 2026-12-31 | done |\n"),
    ("project_own_gate_missing_fields_ok", HDR + "| E1 | G6 | | | | 2026-12-31 | |\n"),
    ("mixed", HDR + "| E1 | a/b | r | s | a | 2026-12-31 | |\n| E2 | G6 | r | s | a | 2026-11-01 | |\n| E3 | c/d | | s | a | 2026-12-31 | |\n| E4 | e/f | r | s | a | 2026-12-31 | closed |\n"),
    ("blank_row_skipped", HDR + "| | | | | | | |\n| E1 | a/b | r | s | a | 2026-12-31 | |\n"),
    ("short_row", HDR + "| E1 | a/b |\n"),
    ("long_row_extra_cells", HDR + "| E1 | a/b | r | s | a | 2026-12-31 | | extra | more |\n"),
    ("header_id_whole_cell", "| id | 规则 | 理由 | 范围 | 批准 | 到期 |\n|---|---|---|---|---|---|\n| E1 | a/b | r | s | a | 2026-12-31 |\n"),
    ("header_rule_id_not_ex_id", "| Rule ID | 理由 | 范围 | 批准 | 到期 |\n|---|---|---|---|---|\n| a/b | r | s | a | 2026-12-31 |\n"),
    ("header_valid_until_expires", "| 编号 | 规则 | 理由 | 范围 | 批准 | 到期 / valid until |\n|---|---|---|---|---|---|\n| E1 | a/b | r | s | a | 2026-12-31 |\n"),
    ("header_provider_not_id", "| Provider | 规则 | 理由 | 范围 | 批准 | 到期 |\n|---|---|---|---|---|---|\n| X | a/b | r | s | a | 2026-12-31 |\n"),
    ("header_dup_columns", "| 编号 | 规则 | 规则说明 | 理由 | 范围 | 批准 | 到期 |\n|---|---|---|---|---|---|---|\n| E1 | a/b | zzz | r | s | a | 2026-12-31 |\n"),
    ("header_dup_three", "| 规则 | 规则 | 规则 | 理由 | 范围 | 批准 | 到期 |\n|---|---|---|---|---|---|---|\n| a/b | c/d | e/f | r | s | a | 2026-12-31 |\n"),
    ("header_no_expires_column", "| 编号 | 规则 | 理由 | 范围 | 批准 |\n|---|---|---|---|---|\n| E1 | a/b | r | s | a |\n"),
    ("header_no_rule_column", "| 编号 | 理由 | 范围 | 批准 | 到期 |\n|---|---|---|---|---|\n| E1 | r | s | a | 2026-12-31 |\n"),
    ("header_english_only", "| ID | Rule | Reason | Scope | Approver | Expires |\n|---|---|---|---|---|---|\n| E1 | a/b | r | s | a | 2026-12-31 |\n"),
    ("table_second_ignored", HDR + "| E1 | a/b | r | s | a | 2026-12-31 | |\n\n文字\n\n" + HDR + "| E9 | x/y | | | | | |\n"),
    ("table_after_text", "# 例外登记\n\n说明文字。\n\n" + HDR + "| E1 | a/b | r | s | a | 2026-12-31 | |\n"),
    ("table_sep_with_colons", "| 编号 | 规则 | 理由 | 范围 | 批准 | 到期 |\n|:--|:-:|--:|---|---|---|\n| E1 | a/b | r | s | a | 2026-12-31 |\n"),
    ("table_sep_bad", "| 编号 | 规则 |\n| -- | x |\n| E1 | a/b |\n"),
    ("table_no_leading_pipe_header", "编号 | 规则 | 理由 | 范围 | 批准 | 到期\n---|---|---|---|---|---\nE1 | a/b | r | s | a | 2026-12-31\n"),
    ("table_row_escape_pipe", HDR + "| E1 | a/b | 理由 \\| 含竖线 | s | a | 2026-12-31 | |\n"),
    ("table_ends_at_blank", HDR + "| E1 | a/b | r | s | a | 2026-12-31 | |\n\n| E2 | c/d | | | | | |\n"),
    ("no_table", "# 只有文字\n\n没有表。\n"),
    ("empty", ""), ("only_header_no_sep", "| 编号 | 规则 |\n"),
    ("only_header_and_sep", "| 编号 | 规则 | 理由 | 范围 | 批准 | 到期 |\n|---|---|---|---|---|---|\n"),
    ("bom", "\ufeff" + HDR + "| E1 | a/b | r | s | a | 2026-12-31 | |\n"),
    ("crlf", (HDR + "| E1 | a/b | r | s | a | 2026-12-31 | |\n").replace("\n", "\r\n")),
    ("chinese_status_closed", HDR + "| E1 | a/b | r | s | a | 2026-12-31 | 已关闭（2026-09-01）|\n"),
    ("rule_with_spaces_and_ticks", HDR + "| E1 |  ` a/b `  | r | s | a | 2026-12-31 | |\n"),
    ("rule_slash_only", HDR + "| E1 | / | r | s | a | 2026-12-31 | |\n"),
    ("rule_trailing_slash", HDR + "| E1 | layout/ | r | s | a | 2026-12-31 | |\n"),
    ("rule_unicode_key", HDR + "| E1 | drift/future-date/docs/a.md｜2099-01-01 | r | s | a | 2026-12-31 | |\n"),
    ("id_with_spaces", HDR + "| E 1 | a/b | | s | a | 2026-12-31 | |\n"),
    ("id_empty_with_missing", HDR + "| | a/b | | s | a | 2026-12-31 | |\n"),
    ("approver_whitespace_only", HDR + "| E1 | a/b | r | s |   | 2026-12-31 | |\n"),
    ("two_missing_plus_expires", HDR + "| E1 | a/b | | | a | 年底 | |\n"),
]


def pure():
    out = {"closed": [{"in": s, "out": sl._ex_closed(s)} for s in CLOSED_INPUTS],
           "cells": [{"in": s, "out": sl._md_cells(s)} for s in CELL_LINES],
           "field": [{"in": s, "out": sl._ex_field(s)} for s in HEADER_INPUTS],
           "table": []}
    for name, text in SAMPLES:
        t = sl._first_md_table(text)
        out["table"].append({"name": name, "out": None if t is None else [t[0], t[1], [[n, c] for n, c in t[2]]]})
    return out


def run_load(text=None, raw=None, today=TODAY):
    tmp = tempfile.mkdtemp(prefix="goldex-")
    try:
        gov = os.path.join(tmp, "governance")
        os.makedirs(gov)
        with open(os.path.join(gov, "exceptions.md"), "wb") as fh:
            fh.write(raw if raw is not None else text.encode("utf-8"))
        return pack(sl.load_exceptions(gov, tmp, today), tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def pack(res, tmp):
    rows, problems, src, own = res
    norm = lambda s: s.replace(tmp, "<ROOT>") if isinstance(s, str) else s
    unrow = lambda r: {k: (v.isoformat() if isinstance(v, datetime.date) else v) for k, v in r.items()}
    return {"rows": [unrow(r) for r in rows], "problems": [norm(p) for p in problems],
            "source": None if src is None else norm(src).replace("\\", "/"), "own": [unrow(r) for r in own]}


def main():
    out = pure()
    out["load"] = [{"name": n, "result": run_load(text=t)} for n, t in SAMPLES]
    out["raw"] = [{"name": n, "hex": b.hex(), "result": run_load(raw=b)} for n, b in
                  [("raw_latin1", b"| \xe9 | b |\n|---|---|\n"), ("raw_truncated", b"| a |\n|---|\n| \xe4\xb8 |\n"), ("raw_bom_only", b"\xef\xbb\xbf"),
                   ("raw_double_bom", b"\xef\xbb\xbf\xef\xbb\xbf| \xe7\xbc\x96\xe5\x8f\xb7 |\n|---|\n")]]
    # today 的影响：同一份样本，运行日不同，上限不同
    sample = dict(SAMPLES)["expires_exact_limit"]
    out["today"] = [{"today": d.isoformat(), "result": run_load(text=sample, today=d)} for d in
                    (datetime.date(2026, 10, 6), datetime.date(2026, 10, 5), datetime.date(2026, 10, 7), datetime.date(2024, 2, 29), datetime.date(2025, 12, 31))]
    # 文件布局
    lay = []
    tmp = tempfile.mkdtemp(prefix="goldex-")
    try:
        gov = os.path.join(tmp, "governance")
        os.makedirs(gov)
        lay.append({"name": "absent", "result": pack(sl.load_exceptions(gov, tmp, TODAY), tmp)})
        os.makedirs(os.path.join(gov, "exceptions.md"))
        lay.append({"name": "is_dir", "result": pack(sl.load_exceptions(gov, tmp, TODAY), tmp)})
        os.rmdir(os.path.join(gov, "exceptions.md"))
        outside = tempfile.mkdtemp(prefix="goldex-out-")
        with open(os.path.join(outside, "secret.md"), "w", encoding="utf-8") as fh:
            fh.write(HDR + "| E1 | TOPSECRET/x | r | s | a | 2026-12-31 | |\n")
        try:
            os.symlink(os.path.join(outside, "secret.md"), os.path.join(gov, "exceptions.md"))
            r = pack(sl.load_exceptions(gov, tmp, TODAY), tmp)
            lay.append({"name": "symlink_out", "symlink": True, "result": r, "echoed": "TOPSECRET" in json.dumps(r, ensure_ascii=False)})
        except OSError:
            lay.append({"name": "symlink_out", "symlink": False})
        finally:
            shutil.rmtree(outside, ignore_errors=True)
        # governance 本身是指向仓外的**目录**符号链接：登记册文件是普通文件，但真实位置在仓外。
        # 端到端上 load_config 会先拒读配置、走不到这里；直接调用 load_exceptions 时护栏是唯一防线（变异 X52/X53 靠它区分）
        outside2 = tempfile.mkdtemp(prefix="goldex-out2-")
        tmp2 = tempfile.mkdtemp(prefix="goldex-")
        try:
            with open(os.path.join(outside2, "exceptions.md"), "w", encoding="utf-8") as fh:
                fh.write(HDR + "| E1 | secret/rule | 机密理由TOPSECRET | s | a | 2026-12-31 | |\n")
            try:
                os.symlink(outside2, os.path.join(tmp2, "governance"), target_is_directory=True)
                r = pack(sl.load_exceptions(os.path.join(tmp2, "governance"), tmp2, TODAY), tmp2)
                lay.append({"name": "governance_dir_symlink_out", "symlink": True, "result": r,
                            "echoed": "TOPSECRET" in json.dumps(r, ensure_ascii=False)})
            except OSError:
                lay.append({"name": "governance_dir_symlink_out", "symlink": False})
        finally:
            shutil.rmtree(outside2, ignore_errors=True)
            shutil.rmtree(tmp2, ignore_errors=True)
        # 外部配置目录：config_dir 在项目之外，登记册在 config_dir 里，root 给的是被扫项目
        ext = tempfile.mkdtemp(prefix="goldex-ext-")
        try:
            with open(os.path.join(ext, "exceptions.md"), "w", encoding="utf-8") as fh:
                fh.write(HDR + "| E1 | a/b | r | s | a | 2026-12-31 | |\n")
            res = sl.load_exceptions(ext, tmp, TODAY)
            lay.append({"name": "external_config_dir", "result": pack(res, ext)})
            res = sl.load_exceptions(ext, None, TODAY)
            lay.append({"name": "external_config_dir_no_root", "result": pack(res, ext)})
        finally:
            shutil.rmtree(ext, ignore_errors=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    out["layout"] = lay
    path = os.path.join(HERE, "unit", "stdlib-exceptions.json")
    tmpf = path + ".tmp"
    with open(tmpf, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    back = json.load(open(tmpf, encoding="utf-8"))
    if {k: len(v) for k, v in back.items()} != {k: len(v) for k, v in out.items()}:
        sys.exit("回读与内存不一致，拒绝落盘")
    os.replace(tmpf, path)
    nrows = sum(len(x["result"]["rows"]) for x in out["load"])
    nprob = sum(len(x["result"]["problems"]) for x in out["load"])
    print("写出 golden/unit/stdlib-exceptions.json：关闭态 %d、表格行 %d、表头 %d、表 %d、加载 %d（登记行 %d、问题 %d）、原始字节 %d、运行日 %d、布局 %d"
          % (len(out["closed"]), len(out["cells"]), len(out["field"]), len(out["table"]), len(out["load"]), nrows, nprob, len(out["raw"]), len(out["today"]), len(out["layout"])))


if __name__ == "__main__":
    main()
