# c · check_all 补四项机械检查：影响面、变异验证、闸门读数

采集 2026-09-24，基线 HEAD `c5d880b`（改前 = `git archive HEAD tools/std`），改后 = 工作区（含调度方裁定：四类篇幅预算只在项目声明了 `budgets.*_lines` 时判）。
NFBY、PMC 用 `git clone --depth 1` 到 `/tmp/claude-1000/c4/`，把 `.std/tools/std` 换成改前/改后两版各提交一次再跑，跑完已删。
列法：`状态<TAB>id`，`>` 为改后新增、`<` 为改后消失（`check_all --json` 逐条，身份行除外）。

## 影响面（改前 → 改后三态计数）

| 仓 | 改前 | 改后 | 退出码 |
|---|---|---|---|
| 本仓 | PASS 15 SKIP 44 UNDETERMINED 1 | PASS 16 SKIP 49 UNDETERMINED 1 | 0 → 0 |
| 示例项目 | FAIL 1 PASS 43 SKIP 25 UNDETERMINED 19 | FAIL 1 PASS 44 SKIP 30 UNDETERMINED 19 | 1 → 1（既有 FAIL 1 条不变） |
| NFBY | PASS 83 SKIP 24 UNDETERMINED 18 | FAIL 1 PASS 84 SKIP 28 UNDETERMINED 18 | 2 → 1 |
| PMC | FAIL 4 PASS 96 SKIP 26 UNDETERMINED 23 | FAIL 5 PASS 96 SKIP 31 UNDETERMINED 23 | 1 → 1 |

本仓与示例项目的 `compatibility.policy` 已在本仓侧补键（下表是补键之后的读数）。四仓都没有声明 `budgets.status_lines` 等四键，篇幅预算只各出四条 SKIP `budget-undeclared`。NFBY、PMC 新增的 FAIL 只有 `adoption/compatibility-policy`，两仓的 project.yaml 确实没有这个键，属真违规。
本仓 `links/2724afb3 → links/9f982166` 是兜底 id 随标题里的链接总数变（README 新增了官方文档链接），不是判据变化。
审查后改版（2026-09-24 同日）：删 `adoption/bypass-mode`；整类放行补 PowerShell/Monitor/Agent；例外关闭判定排除「待」「未」「非」「不」「not」「un」前缀。四仓的 id 增减与上一版相同（四仓都没有 allow 规则命中新增的整类放行；NFBY 例外表的状态值只有 active 与以「关闭」开头的写法，关闭判定改动不影响它；PMC 没有例外登记）。

```text
### repo
> PASS	adoption/compatibility-policy	
< PASS	links/2724afb3	
> PASS	links/9f982166	
> SKIP	adoption/settings-absent	
> SKIP	entry-budget/budget-undeclared/handoff_lines	
> SKIP	entry-budget/budget-undeclared/module_lines	
> SKIP	entry-budget/budget-undeclared/status_lines	
> SKIP	entry-budget/budget-undeclared/work_item_lines	
### ex
> PASS	adoption/compatibility-policy	
> SKIP	adoption/settings-absent	
> SKIP	entry-budget/budget-undeclared/handoff_lines	
> SKIP	entry-budget/budget-undeclared/module_lines	
> SKIP	entry-budget/budget-undeclared/status_lines	
> SKIP	entry-budget/budget-undeclared/work_item_lines	
### nfby
> FAIL	adoption/compatibility-policy	
> PASS	adoption/no-wildcard-allow	
> SKIP	entry-budget/budget-undeclared/handoff_lines	
> SKIP	entry-budget/budget-undeclared/module_lines	
> SKIP	entry-budget/budget-undeclared/status_lines	
> SKIP	entry-budget/budget-undeclared/work_item_lines	
### pmc
> FAIL	adoption/compatibility-policy	
> SKIP	adoption/settings-absent	
> SKIP	entry-budget/budget-undeclared/handoff_lines	
> SKIP	entry-budget/budget-undeclared/module_lines	
> SKIP	entry-budget/budget-undeclared/status_lines	
> SKIP	entry-budget/budget-undeclared/work_item_lines	
```

## 变异验证（每个变异体单独跑 `check_all --selftest`，全部被抓）

```text
M12 关闭判定回到含词即关闭（「待关闭」也算关闭） → 退出 1；entry-smoke:AssertionError: ⑥ 项目自有例外应只得 own-expired/EX-003、EX-007（状态「待
M13 整类放行（PowerShell/Monitor/Agent）不判 → 退出 2；adoption:检查器自检未通过，其对本仓库的结论作废
M11 删掉『未声明不判』分支（回到取参考值判） → 退出 1；entry-budget:检查器自检未通过，其对本仓库的结论作废 | shared-fact:实得 {'layout': ['AGENTS.md'], 'guessed': [('entry-budget/ca
M1 通配放行判据恒不命中 → 退出 2；adoption:检查器自检未通过，其对本仓库的结论作废
M2 去掉运行器清单 → 退出 2；adoption:检查器自检未通过，其对本仓库的结论作废
M3 解释器后只剩选项的判据去掉 → 退出 2；adoption:检查器自检未通过，其对本仓库的结论作废
M4 compatibility 恒 PASS → 退出 2；adoption:检查器自检未通过，其对本仓库的结论作废
M5 篇幅预算失效（多给 1000 行） → 退出 2；entry-budget:检查器自检未通过，其对本仓库的结论作废
M6 候选超预算也判 FAIL → 退出 2；entry-budget:检查器自检未通过，其对本仓库的结论作废
M7 合并工件按最紧预算判 FAIL → 退出 2；entry-budget:检查器自检未通过，其对本仓库的结论作废
M8 工作项不要求状态字段 → 退出 2；entry-budget:检查器自检未通过，其对本仓库的结论作废
M9 项目自有例外不判到期（回到只认含 / 的行） → 退出 1；entry-smoke:AssertionError: ⑥ 项目自有例外应只得 own-expired/EX-003、EX-007（状态「待
M10 已关闭的自有例外也判过期 → 退出 1；entry-smoke:AssertionError: ⑥ 项目自有例外应只得 own-expired/EX-003、EX-007（状态「待
```

## 闸门读数（改后，本仓）

- `python3 tools/std/check_all.py --selftest`：通过 94 失败 0 未定 0，退出 0（改前 通过 86；自检用例数不变，新增断言并进既有用例：整类放行 4 条、「待关闭」过期行 1 条）
- `python3 tools/std/check_all.py .`：退出 0
- `python3 docs/附录-载体实例/linkcheck.py`：0 条断链，退出 0
- `python3 docs/附录-载体实例/check_normative_force.py`：PASS，退出 0
