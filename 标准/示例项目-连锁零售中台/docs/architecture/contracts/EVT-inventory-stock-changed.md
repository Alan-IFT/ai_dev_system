---
id: EVT-inventory-stock-changed
status: active
owner: Zhao（inventory）
version: 2
updated_at: 2026-02-20
supersedes: [EVT-inventory-stock-changed@v1]
---

# EVT · inventory.stock-changed

每次库存变更一条。提供方 inventory；消费者见登记表。

## Schema（权威：`packages/contracts/events/inventory_stock_changed_v2.json`，本文只引用）

关键字段：`event_id`（uuid）、`version`（=2）、`store_id`、`sku_id`、`delta`（整数，可负）、`reason`（sale / receipt / transfer_in / transfer_out / adjustment / stocktake）、`idempotency_key`（`{source}:{source_ref}`，如 `pos:A-20260907-000123`）、`occurred_at`、`emitted_at`。

## 语义约束

- **分区键** `store_id`：同一门店的事件保序；跨门店不保序。
- **幂等键**：消费者按 `idempotency_key` 去重，重复投递只处理一次；去重表由 platform 的 `idempotency_receipt` 提供（INV-04）。
- 顺序：同一 `store_id + sku_id` 内按 `occurred_at` 单调；消费者不得依赖跨 SKU 顺序。
- 重试：投递器至少一次；消费者必须幂等。
- 错误：schema 校验失败进死信；死信重投是不可逆动作。

## 兼容策略

- 加字段向后兼容（消费者忽略未知字段）。
- 改字段语义或删字段走新 MAJOR 版本，expand/contract，共存期 ≥ 2 个发布周期。

## 变更历史

| 版本 | 日期 | 变更 | ADR | 工作项 | 状态 |
|---|---|---|---|---|---|
| v1 | 2025-05-20 | 首版：`store_id`、`sku_id`、`delta`、`reason`、`occurred_at` | — | WI-0033 | retired 2026-02-20 |
| v2 | 2025-12-15（expand）→ 2026-02-20（contract） | 加 `idempotency_key`、`event_id`、`version`、`emitted_at`；`store_id` 成为分区键 | [ADR-0007](../../decisions/ADR-0007-库存事件契约v2-expand-contract.md) | [WI-0142](../../state/work/WI-0142-库存事件契约v2迁移.md) | active |

## 契约测试

- 提供方：`tests/contracts/inventory/test_stock_changed_v2_producer.py`（schema + 幂等键格式 + 分区键）
- 消费方：各消费者仓库目录下 `tests/contracts/consumer_stock_changed_v2.py`（reporting、pos-gateway、settlement）
- CI：G10
