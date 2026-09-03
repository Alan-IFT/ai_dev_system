---
contract_id: <项目-context-001>
contract_revision: 1
updated_at: <ISO-8601>
status: proposal | trial | accepted
current_work_item: <精确路径或 null>
---

# Default Context Contract

> 只有状态为 trial/accepted 且带批准记录的合同才产生项目执行效力。

## Required context

| 顺序 | canonical path#fragment | 用途 | 缺失/冲突时处理 |
|---|---|---|---|

## Related decisions

| decision_id | 精确路径#fragment | 状态 | 生效范围 |
|---|---|---|---|

## Optional context

| 触发条件 | canonical path#fragment | 不加载条件 |
|---|---|---|

## Excluded by default

## Resolution rules

- 链接不递归展开；
- 同一 canonical `path#fragment` 只加载一次；
- 不猜测“相关/当前/对应”等动态描述；
- 合同、工作项、worktree 或 HEAD 冲突时失败关闭。
