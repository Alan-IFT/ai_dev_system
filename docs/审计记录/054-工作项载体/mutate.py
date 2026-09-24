import os, shutil, subprocess, sys, json
SRC = "/home/alan/Programs/AI辅助开发规范及工作流确定/tools/std"
MUT = {
  "M1 撤载体(have 不含 inline)": ("have = set(inline)", "have = set()"),
  "M2 放宽正则到任意提及": ('_WI_FIELD_RE = re.compile(r"^work_item_id[:：]\\s*(WI-\\d{3,})\\b")',
                        '_WI_FIELD_RE = re.compile(r".*?(WI-\\d{3,})\\b")'),
  "M3 撤直接一层过滤(恢复递归)": ("        if os.path.dirname(rel) != wroot:\n            continue\n", ""),
  "M4 基准改回提交自带时区（本夹具 -0700）": ("timedelta(seconds=int(epoch), hours=14)", "timedelta(seconds=int(epoch), hours=-7)"),
  "M5 基准再放宽一天（UTC+38）": ("timedelta(seconds=int(epoch), hours=14)", "timedelta(seconds=int(epoch), hours=38)"),
  "M6 去掉 work_root 尾斜杠归一": ('    wroot = norm_rel(wroot).rstrip("/")', '    wroot = norm_rel(wroot)'),
}
for name, (a, b) in MUT.items():
    d = "/tmp/claude-1000/d118/mut/std"
    shutil.rmtree("/tmp/claude-1000/d118/mut", ignore_errors=True)
    shutil.copytree(SRC, d)
    p = os.path.join(d, "checks", "check_drift.py")
    s = open(p, encoding="utf-8").read()
    assert s.count(a) == 1, name
    open(p, "w", encoding="utf-8").write(s.replace(a, b))
    code = ("import sys;sys.path.insert(0,%r);sys.path.insert(0,%r)\n"
            "import check_drift as c\n"
            "print(' '.join('%%s=%%s'%%(f['title'][:5],f['status']) for f in c.selftest() if f['title'][:2] in ('1e','1f','4g','4h','4i')))"
            % (d, d + "/checks"))
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    rc = subprocess.run([sys.executable, d + "/check_all.py", "--selftest"], capture_output=True, text=True).returncode
    print("%s: %s | check_all --selftest exit=%d" % (name, out.stdout.strip() or out.stderr[-300:], rc))
