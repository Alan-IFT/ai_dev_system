---
id: MOD-inventory
status: active
owner: Zhao
updated_at: 2026-08-25
source_rev: a3f9c21
---

# inventory · 库存

## 职责与边界

**负责**：门店库存现值与批次、入库/出库/调拨/调整的账务、盘点（差异清单 → 确认 → 调整单）、每次库存变更发出 `inventory.stock-changed` 事件。

**不负责**：销售流水的接收与解析（pos-gateway 收到流水后调用本模块的出库 API）、采购单与到货（supplier；到货确认后调用本模块入库）、库存报表（reporting 基于事件投影）、库存金额（settlement）。

**边界上的常见误放**："断网补传不重复入账"（POS-003）——幂等在 pos-gateway 按厂商流水号做，本模块只保证同一 `idempotency_key` 的出库只执行一次（INV-04）。

## 公开接口

| 契约 | 类型 | 一句话 |
|---|---|---|
| `API-inventory` v1 | 同步 API | 现值查询、出入库、调拨、调整、盘点 |
| [`EVT-inventory-stock-changed`](../contracts/EVT-inventory-stock-changed.md) v2 | 事件 | 每次库存变更一条；v1 已于 2026-02-20 下线 |

## 依赖

- **依赖**：platform（幂等回执、outbox）、identity（门店）、catalog（SKU 存在性与主条码）
- **被依赖**：settlement（库存金额）、pos-gateway（出库）、import-export（期初库存导入）、reporting（事件投影 + EX-004 只读视图）、api-gateway

## 数据所有权

`inventory.*`：`stock`、`batch`、`stocktake`、`stocktake_diff`、`transfer`、`adjustment`、`stock_event_outbox`。事件由 outbox 表经 platform 的投递器发出，**不在业务事务外直接发消息**（F-017 的根因之一）。

## 不变量

- INV-01（不为负）、INV-04（幂等回执）
- 局部：`stock.qty` 的每次变更必对应一行 outbox；outbox 行与事件一一对应（`check_outbox_parity`，每日）

## 配置与开关

- `inventory.allow_negative_stores`：白名单 + 到期日（INV-01 例外）
- `inventory.stocktake_lock_hours`：盘点期间锁定出库，默认 2 小时

## 可观测性

- 指标：`inventory_events_emitted_total{version}`、`inventory_outbox_lag_seconds`、`inventory_negative_attempts_total`
- 告警：outbox lag > 60s；负库存尝试一小时超 100 次（通常是 POS 流水乱序）
- SLO：事件从业务事务提交到投递 P95 ≤ 10s

## 已知坑

- **v1 事件无幂等键**：2025-11 消费者重放导致库存双扣（F-017）。v2 加了 `idempotency_key` 与 `store_id` 分区键，迁移过程见 ADR-0007 与 WI-0142。
- 盘点锁定期内 POS 流水会排队；锁超过 2 小时门店会看到"库存未更新"——是设计如此，见 runbook RB-05（未展开）。
- `stock_event_outbox` 的投递器是 platform 的，出问题先看 platform 而不是这里（F-020 排查了半天）。

## 相关决策

ADR-0001、[ADR-0007](../../decisions/ADR-0007-库存事件契约v2-expand-contract.md)、[ADR-0009](../../decisions/ADR-0009-幂等回执与outbox.md)

## 运行手册

RB-05（盘点锁定）、RB-07（outbox 积压）——本示例未展开。
