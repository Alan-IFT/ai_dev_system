# 工作项：<可验收结果>

work_item_id：  
state_revision：  
updated_at：  
状态：（六选一：planned / in_progress / blocked / in_validation / done / cancelled）  
负责人：  
变更级别：（轻量 / 常规 / 高影响；未确认时写「<级别>（提议，待 <确认人> 确认）」，待确认期间能做什么见 01 §4.1）

> 状态机与各态必需工件按 01 §4.1（标准/01-项目管理标准.md 的「工作项生命周期」一节），小节标题括注的是要求它的状态；工件缺失即不得进入该态。`done` 不代表已合并、已部署、已发布——这三件另记在发布记录里（01 §4.5），不作工作项状态。

## 目标与范围（planned）

- 目标：
- 范围内：
- 范围外：
- 本次输入清单（每项归到范围内条目或显式记为范围外）：
- 上下文清单：

## 验收映射（planned）

| acceptance_id | 验收主张 | source of record | target environment | owner |
|---|---|---|---|---|

## 工作区身份（in_progress）

- repository：
- worktree：
- branch：
- HEAD：
- target environment：

## 影响与风险（in_progress，常规及以上）

- 相关模块：
- 数据/迁移：
- 安全/隐私：
- 兼容性：
- 回滚思路：

## 阻塞（blocked）

- 缺失条件：
- 影响：
- 解除方式：
- 责任人：
- 复查时间：

## 验证计划（in_validation）

从改动集派生的可观察终点：

## 闸门记录（in_validation）

| gate_id | 状态/范围 | checker | pass condition | result | evidence | waiver_id |
|---|---|---|---|---|---|---|

## 验收证据（done）

证据六字段逐条绑验收 ID（01 §4.2）；相关文档已同步；已知限制写进 limitations。

| evidence_id | acceptance_id | revision/HEAD | environment | procedure/checker | result | artifact | observed_at | limitations |
|---|---|---|---|---|---|---|---|---|

## 取消（cancelled）

- 原因：
- 已有工作的处理：

## 当前状态

- 已完成：
- 下一原子动作：
- 最后验证时间：
- handoff：
- 发布记录：涉及发布时填发布记录指针（01 §4.5）

## 状态转换记录

变更级别待确认期间的转换，在「依据」列注明“级别待确认”。

| from → to | 时间 | 执行者 | 工作区身份 | 依据（闸门/证据） | 三态 |
|---|---|---|---|---|---|

## 遗留与风险接受

| item | owner | 处理/接受记录 | expiry/review_at |
|---|---|---|---|
