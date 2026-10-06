#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 Python 版检查器的黄金样本（重构设计 §6）。只读：不改被扫仓的工作区，不联网。

用法：python golden/make_golden.py [--out golden/samples]
每个输入钉在 INPUTS 里记录的**提交号**上：用临时 `git worktree` 检出该提交再扫，所以结果不依赖被扫仓当前的工作区或 HEAD
（标准仓自己一提交 HEAD 就变、Reservoir 在持续开发，靠「HEAD 等于记录值」会让样本一碰就失效）。
输出：每个输入一个 JSON（findings 的 check/id/status/where/registered，已排序）+ MANIFEST.json。
不比较 evidence/reason/title：freshness 用运行日，文本里有「N 天」；tool-identity 含 git 提交号。只比 id、status、位置、是否登记。
临时 worktree 一律用完删除（失败时也删）。
"""
import json, os, subprocess, sys, datetime, hashlib, tempfile, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
CHECK_ALL = os.path.join(os.path.dirname(HERE), "tools", "std", "check_all.py")

# (名字, 仓路径, 钉住的提交)。路径随机器变，可用环境变量 STD_GOLDEN_<名字大写> 覆盖。
INPUTS = [
    ("std", r"D:\Programs\AI辅助开发规范及工作流确定", "2fdb501afdebec0f752ad1dc06500de95d2d739a"),
    ("reservoir", r"D:\Programs\NFBY_Reservoir", "1ae3f0d6f9610059e4cb9e6da9a2fd927f7aed62"),
    ("cms", r"D:\Programs\NFBY_CMS_FullStack", "34d0ad9df53ada8142fdc526dd1140fa2868e874"),
    ("pmc", r"D:\Programs\dingcun\PMC-Planner", "c952f0ff1779f9902d6aac6d154f683f518f3ae1"),
]

def git(root, *a):
    p = subprocess.run(["git", "-C", root, *a], capture_output=True, encoding="utf-8", errors="replace")
    return p.returncode, p.stdout.strip(), p.stderr.strip()

def main():
    out_dir = os.path.join(HERE, "samples")
    if "--out" in sys.argv:
        out_dir = sys.argv[sys.argv.index("--out") + 1]
    os.makedirs(out_dir, exist_ok=True)
    manifest = {"generated_at": datetime.date.today().isoformat(), "python": sys.version.split()[0], "inputs": []}
    for name, path, commit in INPUTS:
        path = os.environ.get("STD_GOLDEN_" + name.upper(), path)
        rc, _, err = git(path, "cat-file", "-e", commit + "^{commit}")
        if rc != 0:
            sys.exit("拒绝生成：%s 里找不到提交 %s（%s）" % (name, commit, err))
        wt = tempfile.mkdtemp(prefix="golden-" + name + "-")
        os.rmdir(wt)  # git worktree add 要求目标不存在
        try:
            rc, _, err = git(path, "worktree", "add", "--detach", wt, commit)
            if rc != 0:
                sys.exit("拒绝生成：%s 建临时 worktree 失败：%s" % (name, err))
            env = dict(os.environ, PYTHONUTF8="1")
            # 用本仓的检查器扫每个输入（采用项目内嵌的 .std 与本仓同一份，已核对 blob 相同）
            p = subprocess.run([sys.executable, CHECK_ALL, wt, "--json", "--no-scope"], capture_output=True, encoding="utf-8", env=env)
            findings = json.loads(p.stdout)
            slim = [{k: f.get(k) for k in ("check", "id", "status", "where", "registered")} for f in findings]
            slim.sort(key=lambda x: (x["id"], x["where"] or ""))
            fp = os.path.join(out_dir, name + ".json")
            with open(fp, "w", encoding="utf-8", newline="\n") as fh:
                json.dump(slim, fh, ensure_ascii=False, indent=1, sort_keys=True); fh.write("\n")
            counts = {}
            for f in slim:
                counts[f["status"]] = counts.get(f["status"], 0) + 1
            manifest["inputs"].append({"name": name, "commit": commit, "exit": p.returncode, "findings": len(slim),
                                       "counts": counts, "sha256": hashlib.sha256(open(fp, "rb").read()).hexdigest()})
            print("%-10s commit=%s exit=%d findings=%d %s" % (name, commit[:8], p.returncode, len(slim), counts))
        finally:
            git(path, "worktree", "remove", "--force", wt)
            git(path, "worktree", "prune")
            shutil.rmtree(wt, ignore_errors=True)
    with open(os.path.join(out_dir, "MANIFEST.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1); fh.write("\n")

if __name__ == "__main__":
    main()