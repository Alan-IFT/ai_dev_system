#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""重算本仓库那些会漂移的计数。

这个脚本的存在理由：这些数字此前是手抄在文档里的，抄一次就多一处会过期的副本。
2026-09-03 第十一轮实测到两次真实漂移（版本号 27 份副本分成三档；仓库工作须知
在同一轮内把"生效 5 条"写成"生效 4 条"），因此改为不抄、只算。

效力为零，与本目录其余内容同。它是"计数不该手抄"这条语义要求在
Markdown + Git + Python 上的一种载体实现，删掉它不影响规范。
"""
import re, sys, pathlib, io

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
sys.stdout.reconfigure(encoding="utf-8")

def read(p): return p.read_text(encoding="utf-8")


def mask_code(t):
    """与检查器 C10 和链接自检同一口径：代码块与行内代码里的链接是举例，不计数。"""
    NL, BT = chr(10), chr(96)
    def blank(m): return "".join(c if c == NL else " " for c in m.group(0))
    t = re.sub(BT * 3 + ".*?" + BT * 3, blank, t, flags=re.S)
    return re.sub(BT + "[^" + BT + NL + "]*" + BT, blank, t)

body = [ROOT / "docs" / "00-总览.md"] + sorted(ROOT.glob("docs/[1234][0-9]-*.md"))
chars = sum(len(read(p)) for p in body)
lines = sum(len(read(p).splitlines()) for p in body)
princ = sum(len(re.findall(r"^- \*\*P\d+", read(p), re.M)) for p in body)

ledger = ROOT / "docs" / "追溯账本.md"
led_lines = len(read(ledger).splitlines()) if ledger.exists() else 0

log = read(ROOT / "docs" / "决策日志.md")
decisions = sorted(set(re.findall(r"^\| (D-\d{3}) \|", log, re.M)))
reg = log.split("## 决策索引")[0]
# 状态格允许带强调标记：检查器用 _strip 去掉 ** 后比较，这里必须同口径，
# 否则两个工具对同一张表数出不同的生效条数（C-009 同形问题，2026-09-03 实际发生过一次）。
effective = sorted(set(re.findall(
    r"^\| (D-\d{3}) \|\s*\**\s*(?:试行|已接受)\s*\**\s*\|", reg, re.M)))

mds, links, bad = [], 0, 0
SKIP = {".git", ".staging"}
for p in ROOT.rglob("*.md"):
    if any(s in p.parts for s in SKIP): continue
    mds.append(p)
    links += len(re.findall(r"\[[^\]]*\]\((?![a-zA-Z][\w+.-]*:|//)[^)\s]+\)", mask_code(read(p))))

print("正文        %d 文件 / %d 行 / %d 字符 / %d 条原则" % (len(body), lines, chars, princ))
print("追溯账本    %d 行（效力为零）" % led_lines)
print("决策        %d 条，生效 %d 条（%s）" % (len(decisions), len(effective), "、".join(effective)))
print("markdown    %d 个文件 / %d 条本地链接" % (len(mds), links))
print()
print("断链数跑第二项自检：python docs/附录-载体实例/linkcheck.py")
