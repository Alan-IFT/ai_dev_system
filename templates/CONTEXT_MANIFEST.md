---
contract_id: <项目-context-001>
contract_revision: 1
updated_at: <ISO-8601>
status: proposal | trial | accepted
current_work_item: <精确路径或 null>
---

# Default Context Contract

> 只有状态为 trial/accepted 且带批准记录的合同才产生项目执行效力。

**每个项目只有这一份默认加载清单**（D-015，已接受）。清单只做路由、不复制被路由文档的正文；可按运行类型等维度参数化出**视图**，但视图是同一份清单的投影，不是第二份清单。需要新视图时先证明它不是已有视图的子集。

## Required context

视图列按本项目实际的运行类型命名并自行增删（取值轴见规范 00 总览 §3：产出类型 × 起点状态）。判不清时按更宽的那一列处理。

| 顺序 | canonical path#fragment | 视图 A：<交付型> | 视图 B：<事实型> | 用途 | 缺失/冲突时处理 |
|---|---|:---:|:---:|---|---|

● 必读　○ 不读　△ 条件读（写出条件）

## Related decisions

| decision_id | 精确路径#fragment | 状态 | 生效范围 |
|---|---|---|---|

## Optional context

| 触发条件 | canonical path#fragment | 不加载条件 |
|---|---|---|

## Excluded by default

- 采用的《项目管理标准》四章全文；`NN §x.y` 引用按节读，不通读；

## Resolution rules

- 链接不递归展开；
- 同一 canonical `path#fragment` 只加载一次；
- 不猜测“相关/当前/对应”等动态描述；
- 合同、工作项、worktree 或 HEAD 冲突时失败关闭；
- 「NN §x.y」式引用不是 `#片段`：以该标题行起、至下一个同级或更高级标题前为外延（`grep -n "^#\{2,3\} x\.y[ .]" NN-*.md` 定位）；命中 0 行记未定，不退回通读整章。
