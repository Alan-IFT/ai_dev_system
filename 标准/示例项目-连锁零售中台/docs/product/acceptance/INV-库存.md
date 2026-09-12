---
id: ACC-INV
status: active
owner: Zhao（产品）
updated_at: 2026-02-20
---

# INV · 库存

### INV-001 · 门店库存不为负
- 可观察结果：任何出库使库存 < 0 的操作被拒绝；允许负库存的门店需显式配置且有到期日
- 目标环境：prod
- 优先级：P0
- 状态：frozen（Zhao，2025-03-10）
- 来源：INV-01 不变量
- 派生：WI-0011

### INV-005 · 盘点差异生成调整单
- 可观察结果：盘点提交后系统按 SKU 生成差异清单；确认后生成库存调整单并留痕；未确认的差异不改库存
- 目标环境：prod
- 优先级：P0
- 状态：frozen（Zhao，2025-04-15）
- 派生：WI-0027

### INV-009 · 库存变更发出事件
- 可观察结果：每次库存变更（销售、入库、调拨、调整）发出一条 `inventory.stock-changed` 事件；报表与 POS 推送基于事件而非直接读表
- 目标环境：prod
- 优先级：P0
- 状态：**superseded → INV-014**（2025-12-08：v1 事件无幂等键，见 F-017）
- 派生：WI-0033

### INV-014 · 库存变更事件 v2 携带分区键与幂等键
- 可观察结果：任一库存变更产生一条 `inventory.stock-changed` v2 事件，含 `store_id`、`sku_id`、`delta`、`idempotency_key`、`occurred_at`；同一 `idempotency_key` 重复投递时每个消费者只处理一次（消费者回执数 == 去重后投递数）
- 目标环境：staging → prod
- 优先级：P0
- 状态：frozen（Zhao，2025-12-08）
- 来源：ADR-0007；F-017；INV-04 不变量
- 派生：WI-0142；tests/integration/inventory/test_stock_changed_v2.py

### INV-015 · v1 事件消费者全部迁移后下线
- 可观察结果：契约登记表里 `EVT-inventory-stock-changed` v1 的消费者为零；v1 队列 7 天无投递后删除；删除前有告警期
- 目标环境：prod
- 优先级：P1
- 状态：frozen（Zhao，2025-12-08）
- 派生：WI-0142（contract 阶段）

### INV-016 · 事件重放不产生第二次副作用
- 可观察结果：对任一消费者重放过去 24h 的事件，库存、报表、POS 推送的结果与重放前一致（差异为零）
- 目标环境：staging
- 优先级：P0
- 状态：frozen（Zhao，2025-12-08）
- 来源：INV-04
- 派生：WI-0142；tests/integration/inventory/test_replay_idempotent.py
