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
from linkcheck import EXTERNAL, links as _links, mask_code, md_files  # 扫描面与涂白口径只此一处

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
sys.stdout.reconfigure(encoding="utf-8")

def read(p): return p.read_text(encoding="utf-8")

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

mds, links = [pathlib.Path(f) for f in md_files(str(ROOT))], 0
for p in mds:
    links += sum(1 for t in _links(mask_code(read(p))) if not EXTERNAL.match(t))

# ---- 失败 Case 清单的分组数（2026-09-04 新增）----------------------------------
# 为什么加这一段：2026-09-04 的独立核查在三份活文档里查出 56/139 条断言不属实，
# 其中超过一半是 Case 表的手写投影（§1 的 A 档「10」实为 26、读数一的「3 条」、
# 读数七的「10→12」「105 条 90%」、PROJECT_STATUS 的「11 条绑到 6 条规则」「27 条 Case」）。
# 判据：一个数若 (a) 是仓库当前状态的函数、(b) 有唯一可机械解析的权威载体、
# (c) 却出现在权威之外的散文里，就交给脚本导出，不再手抄。
cases_md = ROOT / "docs" / "失败Case清单.md"
case_rows, grades, blocked, bound_rules = [], {}, {}, set()
if cases_md.exists():
    for ln in read(cases_md).splitlines():
        if not ln.startswith("| C-"):
            continue
        _m = mask_code(ln)
        _cut = [i for i, ch in enumerate(_m) if ch == "|"]
        _b = [-1] + _cut + [len(ln)]
        col = [ln[_b[i]+1:_b[i+1]].strip() for i in range(len(_b)-1)]
        # col[1]=id col[2]=观察到的失败 col[3]=等级 col[4]=本该防住它的规则 col[5]=被拦住了吗
        if len(col) < 7:
            # 列数不足不能静默跳过——那会让一行残缺的表悄悄少算（2026-09-04 核查指出）
            raise SystemExit("失败Case清单.md 有一行列数不足，先修表：" + ln[:40])
        case_rows.append(col[1])
        # 剥强调标记后再比较，与 check_normative_force.py 的 _strip 同口径；
        # 不剥的话「**A｜仓库可复核**」与「A｜仓库可复核」会被数成两档（同 C-009 形态）。
        g = col[3].replace("*", "").strip()
        grades[g] = grades.get(g, 0) + 1
        # 取整格而不是首字符：首字符会把「不适用」切成「不」，凭空造出一个档位。
        b = col[5].replace("*", "").strip()
        for k in ("是", "否", "不适用", "算"):
            if b.startswith(k):
                b = k
                break
        else:
            b = "其它"
        blocked[b] = blocked.get(b, 0) + 1
        # 2026-09-05：这一格以「无」开头（「无对应原则——…」「无——…」）时，它断言的正是
        # "没有对应原则"，格里出现的 NN §M Pn 是它点名的反例或同型参照，不是绑定。原来
        # 只抓形状不读语义，C-041 那格逐字「无对应原则——这不是某条原则失守，是全仓不存在
        # [31 §2 P1] 所说的自动通道」被数成 31-P1 的绑定，"已被证明有实例的章"因此凭空
        # 多出 31 章（见 Case C-042）。已知限制：判据是"整格以「无」开头"，不做语义分析。
        rule_cell = col[4].replace("*", "").strip()
        if not rule_cell.startswith("无"):
            for a, b in re.findall(r"(\d\d)[ 　]?(?:章[ 　]?)?§\s?\d[ 　]?(P\d+)", col[4]):
                bound_rules.add(a + "-" + b)
            for a, b in re.findall(r"(\d\d)-(P\d+)", col[4]):
                bound_rules.add(a + "-" + b)
bound_chapters = sorted({r[:2] for r in bound_rules})

print("正文        %d 文件 / %d 行 / %d 字符 / %d 条原则" % (len(body), lines, chars, princ))
print("追溯账本    %d 行（效力为零）" % led_lines)
print("决策        %d 条，生效 %d 条（%s）" % (len(decisions), len(effective), "、".join(effective)))
print("markdown    %d 个文件 / %d 条本地链接" % (len(mds), links))
print("失败 Case    %d 条（等级 %s；被拦住了吗 %s）" % (
    len(case_rows),
    "、".join("%s=%d" % kv for kv in sorted(grades.items())),
    "、".join("%s=%d" % kv for kv in sorted(blocked.items()))))
print("已绑定原则  %d 条 / 共 %d 条（未绑 %d，%.0f%%）；已被证明有实例的章：%s" % (
    len(bound_rules), princ, princ - len(bound_rules),
    (princ - len(bound_rules)) * 100.0 / princ if princ else 0,
    "、".join(bound_chapters)))
print()
print("断链数跑第二项自检：python docs/附录-载体实例/linkcheck.py")
