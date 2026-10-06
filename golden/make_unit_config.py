#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""stdlib.load_config / _read_config 的单元黄金样本：对一批配置文本记录 Python 版的 (cfg, problem)，含**精确的报错信息**。

输入来源：①check_all 的 _stdlib_selftest 里每条来自一次实测误读的样本（每条对应一个审计缺陷，D-123）；②四个真实仓**已提交**的 project.yaml
（按提交取内容，不读工作区，免随开发漂移）；③边界补充（BOM、CRLF、非 UTF-8、空文件、只有注释、下划线键、各种形状错）。
配置文件在临时目录里写，输出只记 cfg 的内容与 problem，**不含临时路径**（`--config` 的显示路径归一成 <CONFIG_PATH>）。
用法：python golden/make_unit_config.py
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "tools", "std"))
import stdlib as sl  # noqa: E402

REPOS = {"std": r"D:\Programs\AI辅助开发规范及工作流确定", "reservoir": r"D:\Programs\NFBY_Reservoir",
         "cms": r"D:\Programs\NFBY_CMS_FullStack", "pmc": r"D:\Programs\dingcun\PMC-Planner"}
REVS = {"std": "2fdb501afdebec0f752ad1dc06500de95d2d739a", "reservoir": "1ae3f0d6f9610059e4cb9e6da9a2fd927f7aed62",
        "cms": "34d0ad9df53ada8142fdc526dd1140fa2868e874", "pmc": "c952f0ff1779f9902d6aac6d154f683f518f3ae1"}

CASES = [
    # —— stdlib selftest 里的样本（安全 2、4；A4/A11/C21/R1-04/R127 R2-2 等）——
    ("path_escape_dotdot_entry", "tier: L1\nlayout:\n  entry:\n    - ../outside/secret.md\n"),
    ("path_escape_abs_status", "tier: L1\nlayout:\n  artifacts:\n    status: /etc/passwd\n"),
    ("path_escape_metadata", "tier: L1\nmetadata_required:\n  - docs/../../x\n"),
    ("path_escape_windows_abs", "tier: L1\nlayout:\n  entry:\n    - C:/x/y.md\n"),
    ("path_escape_backslash_dotdot", "tier: L1\nlayout:\n  entry:\n    - docs\\..\\..\\x.md\n"),
    ("path_dotdot_in_name_ok", "tier: L1\nlayout:\n  entry:\n    - docs/a..b/c.md\n"),
    ("no_echo_parse_fail", "tier: L1\nTOPSECRET-LINE\n"),
    ("shape_frozen_scalar", "tier: L1\nlayout:\n  frozen: docs/archive\n"),
    ("shape_tailoring_map", "tier: L1\ntailoring:\n  check: layout\n  applicable: false\n"),
    ("shape_entry_int", "tier: L1\nlayout:\n  entry: 5\n"),
    ("shape_done_states_map", "tier: L1\nwork_item_done_states:\n  done: x\n"),
    ("shape_former_names_scalar", "tier: L1\nrepos:\n  - name: a\n    path: .\n    former_names: b\n"),
    ("shape_work_root_list", "tier: L1\nlayout:\n  work_root:\n    - a\n"),
    ("shape_docs_root_map", "tier: L1\nlayout:\n  docs_root:\n    k: v\n"),
    ("shape_artifacts_status_list", "tier: L1\nlayout:\n  artifacts:\n    status:\n      - a\n"),
    ("shape_repos_path_list", "tier: L1\nrepos:\n  - name: a\n    path:\n      - x\n"),
    ("shape_tier_bool", "tier: true\n"), ("shape_tier_ok_int", "tier: 1\n"), ("shape_tier_float_ok", "tier: 1.5\n"),
    ("shape_layout_scalar", "tier: L1\nlayout: x\n"), ("shape_budgets_list", "tier: L1\nbudgets:\n  - a\n"),
    ("shape_derived_scalar", "tier: L1\nderived: x\n"), ("shape_derived_item_scalar", "tier: L1\nderived:\n  - x\n"),
    ("shape_derived_artifact_list", "tier: L1\nderived:\n  - artifact:\n      - a\n    source: b\n"),
    ("shape_tailoring_scalar", "tier: L1\ntailoring: 5\n"), ("shape_repos_item_scalar", "tier: L1\nrepos:\n  - x\n"),
    ("shape_rule_files_scalar", "tier: L1\nlayout:\n  rule_files: AGENTS.md\n"),
    ("shape_metadata_fields_ok_scalar", "tier: L1\nmetadata_fields: updated_at\n"),
    ("shape_entry_bool_in_list", "tier: L1\nlayout:\n  entry:\n    - true\n"),
    ("shape_empty_values_ok", "tier:\nlayout:\nbudgets:\n"),
    ("states_collide_alias", "tier: L1\nwork_item_done_states:\n  - 验证中\n"),
    ("states_collide_other_key", "tier: L1\nwork_item_in_progress_states: done\n"),
    ("states_collide_superseded", "tier: L1\nwork_item_done_states: 已取代\n"),
    ("states_collide_both_keys", "tier: L1\nwork_item_done_states: closed\nwork_item_in_progress_states: Closed\n"),
    ("states_ok_extend", "tier: L1\nwork_item_done_states:\n  - closed\n  - shipped\nwork_item_in_progress_states: doing\n"),
    ("states_same_key_twice_ok", "tier: L1\nwork_item_done_states:\n  - closed\n  - CLOSED\n"),
    ("states_collide_with_doc_state", "tier: L1\nwork_item_done_states: active\n"),
    ("states_collide_planned", "tier: L1\nwork_item_in_progress_states: 计划中\n"),
    ("states_empty_string_item", "tier: L1\nwork_item_done_states:\n  - ''\n  - closed\n"),
    ("dup_budget_ok", "tier: L1\nbudgets:\n  duplicate_min_lines: 3\n  duplicate_min_chars: 40\n"),
    ("dup_budget_lines_1", "tier: L1\nbudgets:\n  duplicate_min_lines: 1\n"),
    ("dup_budget_chars_0", "tier: L1\nbudgets:\n  duplicate_min_chars: 0\n"),
    ("dup_budget_string", "tier: L1\nbudgets:\n  duplicate_min_lines: abc\n"),
    ("dup_budget_bool", "tier: L1\nbudgets:\n  duplicate_min_lines: true\n"),
    ("dup_budget_float", "tier: L1\nbudgets:\n  duplicate_min_lines: 2.5\n"),
    ("dup_budget_neg", "tier: L1\nbudgets:\n  duplicate_min_chars: -5\n"),
    ("dup_budget_min_exact", "tier: L1\nbudgets:\n  duplicate_min_lines: 2\n  duplicate_min_chars: 1\n"),
    ("meta_ok", "tier: L1\nmetadata_required:\n  - docs/decisions\n  - \"!docs/decisions/README.md\"\n"),
    ("meta_empty_list_ok", "tier: L1\nmetadata_required: []\n"),
    ("meta_dot", "tier: L1\nmetadata_required:\n  - .\n"),
    ("meta_dotslash", "tier: L1\nmetadata_required:\n  - ./\n"),
    ("meta_slash", "tier: L1\nmetadata_required:\n  - /docs\n"),
    ("meta_dotdot", "tier: L1\nmetadata_required:\n  - ../x\n"),
    ("meta_bang_only", "tier: L1\nmetadata_required:\n  - \"!docs/x\"\n"),
    ("meta_bang_same", "tier: L1\nmetadata_required:\n  - docs/x\n  - \"!docs/x\"\n"),
    ("meta_bang_outside", "tier: L1\nmetadata_required:\n  - docs/a\n  - \"!docs/b\"\n"),
    ("meta_bang_inside_ok", "tier: L1\nmetadata_required:\n  - docs\n  - \"!docs/archive\"\n"),
    ("meta_dotslash_prefix_ok", "tier: L1\nmetadata_required:\n  - ./docs\n"),
    ("meta_bang_dotslash", "tier: L1\nmetadata_required:\n  - docs\n  - \"!./docs/x\"\n"),
    ("meta_backslash", "tier: L1\nmetadata_required:\n  - docs\\a\n"),
    ("meta_empty_string", "tier: L1\nmetadata_required:\n  - ''\n"),
    ("meta_bang_empty", "tier: L1\nmetadata_required:\n  - docs\n  - \"!\"\n"),
    ("meta_scalar", "tier: L1\nmetadata_required: docs\n"),
    ("underscore_key", "tier: L1\n_root: /x\n"),
    ("underscore_key_nested_ok", "tier: L1\nlayout:\n  _x: 1\n"),
    ("underscore_first_of_many", "tier: L1\nA: 1\n_b: 2\n_c: 3\n"),
    ("top_not_map_list", "- a\n- b\n"), ("top_not_map_scalar", "just text\n"),
    ("empty", ""), ("only_comment", "# c\n"), ("only_blank", "\n\n  \n"),
    ("bom_first_key", "\ufefftier: L1\n"), ("crlf", "tier: L1\r\nlayout:\r\n  docs_root: docs\r\n"),
    ("tab", "tier: L1\nlayout:\n\tdocs_root: docs\n"),
    ("flow_map", "tier: L1\nlayout: {entry: A.md}\n"), ("dup_key", "tier: L1\ntier: L2\n"),
    ("deep_nest_1200", "".join("%sk%d:\n" % ("  " * i, i) for i in range(1200)) + "  " * 1200 + "v: 1\n"),
    ("ok_minimal", "tier: L1\n"),
    ("ok_full", "tier: L1\nlayout:\n  entry:\n    - AGENTS.md\n  docs_root: docs\n  work_root: docs/state/work\n  frozen:\n    - docs/archive\n"
                "  artifacts:\n    status: PROJECT_STATUS.md\n    handoff: docs/handoff.md\nbudgets:\n  entry_lines: 150\n  duplicate_min_lines: 3\n"
                "tailoring:\n  - check: freshness\n    applicable: false\n    reason: x\nmetadata_fields:\n  - updated_at\n  - 更新于\n"
                "work_item_done_states:\n  - closed\n"),
    ("ok_chinese_values", "tier: L1\nlayout:\n  entry: 入口.md\n"), ("ok_quoted_key", "\"tier\": L1\n"),
    # —— 变异验证发现的盲区：这些输入此前没有，对应的实现分支没有被任何样本触发 ——
    ("path_escape_derived_source", "tier: L1\nderived:\n  - artifact: a.md\n    source: ../x\n"),
    ("path_escape_derived_artifact_abs", "tier: L1\nderived:\n  - artifact: /abs/a.md\n    source: b.md\n"),
    ("shape_tailoring_check_list", "tier: L1\ntailoring:\n  - check:\n      - a\n"),
    ("shape_tailoring_reason_list", "tier: L1\ntailoring:\n  - check: x\n    reason:\n      - a\n"),
    ("shape_artifacts_entry_list_ok", "tier: L1\nlayout:\n  artifacts:\n    entry:\n      - A.md\n"),
    ("shape_artifacts_status_list_line", "tier: L1\nlayout:\n  artifacts:\n    other: x\n    status:\n      - a\n"),
    ("shape_repos_name_list_in_item", "tier: L1\nrepos:\n  - name:\n      - x\n"),
    ("shape_quoted_key", "\"tier\": true\n"),
    # 列表项首键（`- key:` 的 key 在 `- ` 之后）形状错：行号定位要认 `- ` 前缀
    ("shape_list_first_key_tailoring", "tier: L1\ntailoring:\n  - check: true\n    reason: x\n"),
    ("shape_list_first_key_repos", "tier: L1\nrepos:\n  - name: true\n"),
    ("shape_list_first_key_derived", "tier: L1\nderived:\n  - artifact: true\n    source: s\n"),
    ("shape_list_first_key_quoted", "tier: L1\nrepos:\n  - \"role\": yes\n    name: a\n"),
    ("shape_quoted_single_key", "'tier': true\n"),
    ("meta_double_dotslash", "tier: L1\nmetadata_required:\n  - ././docs\n"),
    ("meta_bang_double_dotslash", "tier: L1\nmetadata_required:\n  - docs\n  - \"!././docs/x\"\n"),
    ("underscore_key_regex_dot", "tier: L1\n_axb: 1\n_a.b: 2\n"),
    ("underscore_key_regex_paren", "tier: L1\n_a(b: 1\n"),
    ("underscore_key_regex_bracket", "tier: L1\n_a[b: 1\n"),
    ("underscore_key_regex_star", "tier: L1\n_a*: 1\n"),
    ("underscore_key_regex_plus_q", "tier: L1\n_a+b?: 1\n"),
    ("underscore_key_quoted", "tier: L1\n\"_q\": 1\n"),
    ("budget_key_after_list_item", "tier: L1\nrepos:\n  - name: a\nbudgets:\n  duplicate_min_chars: 0\n"),
    ("states_key_in_list_item", "tier: L1\nx:\n  - work_item_done_states: closed\nwork_item_in_progress_states: closed\n"),
]

RAW = [("raw_latin1", b"tier: L1\nx: \xe9\n"), ("raw_truncated_utf8", b"tier: L1\nx: \xe4\xb8\n"), ("raw_bom_only", b"\xef\xbb\xbf"),
       ("raw_double_bom", b"\xef\xbb\xbf\xef\xbb\xbftier: L1\n"), ("raw_nul", b"tier: L1\n\x00x: 1\n"),
       ("raw_cr_only", b"tier: L1\rlayout:\r  docs_root: docs\r")]


def strip_inj(cfg):
    return {k: v for k, v in cfg.items() if k not in ("_root", "_path")} if cfg else cfg


def load_raw(raw):
    tmp = tempfile.mkdtemp(prefix="goldcfg-")
    try:
        gov = os.path.join(tmp, "governance")
        os.makedirs(gov)
        with open(os.path.join(gov, "project.yaml"), "wb") as fh:
            fh.write(raw)
        cfg, prob = sl.load_config(tmp)
        return {"cfg": strip_inj(cfg), "problem": prob}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    out = {"cases": [], "raw": [], "files": [], "real_repos": []}
    for name, text in CASES:
        r = load_raw(text.encode("utf-8"))
        out["cases"].append({"name": name, "input_len": len(text), "input_sha1": hashlib.sha1(text.encode("utf-8")).hexdigest()[:10],
                             "input": text if len(text) < 600 else None, "result": r})
    for name, raw in RAW:
        out["raw"].append({"name": name, "hex": raw.hex(), "result": load_raw(raw)})
    tmp = tempfile.mkdtemp(prefix="goldcfg-")
    try:
        gov = os.path.join(tmp, "governance")
        os.makedirs(gov)

        def rec(name, cfg, prob, ext=None):
            p = (prob or "").replace(ext, "<CONFIG_PATH>") if (prob and ext) else prob
            pk = (cfg or {}).get("_path")
            # `--config` 指向项目之外时 `_path` 是绝对路径（含随机临时目录名）：归一成 <CONFIG_PATH>，但**记下它是绝对路径这件事**
            out["files"].append({"name": name, "cfg": strip_inj(cfg), "problem": p,
                                 "path_key": "<CONFIG_PATH>" if (pk and ext and os.path.abspath(pk) == os.path.abspath(ext)) else pk,
                                 "path_key_is_abs": bool(pk) and os.path.isabs(pk)})
        c, p = sl.load_config(tmp); rec("no_config", c, p)
        with open(os.path.join(gov, "project.yml"), "w") as fh:
            fh.write("tier: L2\n")
        c, p = sl.load_config(tmp); rec("yml_only", c, p)
        with open(os.path.join(gov, "project.yaml"), "w") as fh:
            fh.write("tier: L1\n")
        c, p = sl.load_config(tmp); rec("both_yaml_wins", c, p)
        ext = os.path.join(gov, "project.yaml")
        c, p = sl.load_config(tmp, ext); rec("external_ok", c, p, ext)
        os.remove(ext)
        os.mkdir(ext)
        c, p = sl.load_config(tmp); rec("yaml_is_dir_falls_to_yml", c, p)
        c, p = sl.load_config(tmp, ext); rec("external_is_dir", c, p, ext)
        missing = os.path.join(tmp, "nope.yaml")
        c, p = sl.load_config(tmp, missing); rec("external_missing", c, p, missing)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    for n, rev in REVS.items():
        raw = subprocess.run(["git", "-C", REPOS[n], "show", "%s:governance/project.yaml" % rev], capture_output=True).stdout
        out["real_repos"].append({"name": n, "rev": rev, "bytes": len(raw), "sha1": hashlib.sha1(raw).hexdigest()[:10], "result": load_raw(raw)})
    path = os.path.join(HERE, "unit", "stdlib-config.json")
    tmpf = path + ".tmp"
    with open(tmpf, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    back = json.load(open(tmpf, encoding="utf-8"))
    if {k: len(v) for k, v in back.items()} != {k: len(v) for k, v in out.items()}:
        sys.exit("回读与内存不一致，拒绝落盘")
    os.replace(tmpf, path)
    ok = sum(1 for c in out["cases"] if not c["result"]["problem"])
    print("写出 golden/unit/stdlib-config.json：用例 %d（接受 %d、拒收 %d）+ 原始字节 %d + 文件布局 %d + 真实仓 %d"
          % (len(out["cases"]), ok, len(out["cases"]) - ok, len(out["raw"]), len(out["files"]), len(out["real_repos"])))


if __name__ == "__main__":
    main()
