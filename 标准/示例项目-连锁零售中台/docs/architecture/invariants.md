---
id: ARCH-INV
status: active
owner: Alan（架构）
updated_at: 2026-06-28
---

# 架构不变量

**全仓唯一清单**；模块文档只引用 ID。每条绑定一次失败或一份 ADR，每条有检查方式。预算 12 条，现 9 条。

### INV-01 · 门店库存不为负
- 判据：`inventory.stock.qty >= 0`，除非门店在 `allow_negative` 白名单且未到期
- 检查：数据库约束 + 每日 `check_stock_nonneg` 报告
- 违反症状：POS 卖出不存在的货；盘点差异异常
- 来源：INV-001

### INV-02 · 每张表只有一个所有者模块，跨模块不直接写
- 判据：`data-ownership.md` 的所有者与迁移脚本的 schema 前缀一致；非所有者模块无对该 schema 的写语句
- 检查：`check_deps --writes`（CI）
- 违反症状：两个模块对同一行有不同理解；迁移互相踩
- 来源：ADR-0001；F-011

### INV-03 · 模块间同步调用只经公开 API，异步只经登记的事件契约
- 判据：`contracts/README.md` 里存在该契约且消费者已登记
- 检查：`check_contracts`（CI）
- 违反症状：未登记消费者在契约变更时崩
- 来源：F-019

### INV-04 · 每笔对外部系统的写都带幂等键，重放不产生第二次副作用
- 判据：外部系统写入数 == 本地回执数（按幂等键去重后）
- 检查：`check_receipts`（每日 cron，宿主之外）；事故复盘必查
- 违反症状：库存双扣、重复推送、重复短信
- 来源：F-017；ADR-0009

### INV-05 · 商品、价格、经营范围的权威在本系统，POS 只做终端
- 判据：POS 侧任何这三类数据的修改入口关闭；差异核对以本系统为准
- 检查：每日差异核对报告（`reporting` 投影）差异率 < 0.1%
- 违反症状：门店私改价格；档案三处三个名字（立项原因）
- 来源：VISION

### INV-06 · 验收条目冻结后语义不变
- 判据：`frozen` 条目的正文 hash 不变；变更只能新增 ID 并 `superseded_by`
- 检查：`check_acceptance_frozen`（CI，对比上次提交）
- 违反症状：实现者弱化验收让自己通过
- 来源：F-004

### INV-07 · 破坏性契约变更走 expand → migrate → contract，每步独立可发布
- 判据：一次提交不同时改提供方 schema 与消费方解析；contract 阶段前登记表消费者为零
- 检查：评审清单 + `check_contracts --consumers`
- 违反症状：两个消费者同时崩、无法回滚
- 来源：F-019；ADR-0007

### INV-08 · 每条状态记录带工作区身份与时间
- 判据：工作项转换记录与交接含 branch/HEAD/时间
- 检查：`check_handoff`（G12）
- 违反症状：在错分支验证；旧证据被沿用
- 来源：F-021

### INV-09 · 证明修复的测试不由修复者修改
- 判据：修 bug 的 PR 里，新增的失败测试文件的后续修改由他人提交
- 检查：评审清单；CODEOWNERS 对 `tests/regression/`
- 违反症状：改测试让它变绿
- 来源：标准 01 §5.2；F-006
