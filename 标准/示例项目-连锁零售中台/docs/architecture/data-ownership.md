---
id: ARCH-DATA
status: active
owner: Zhao（架构）
updated_at: 2026-02-20
---

# 数据所有权

一张表一个所有者；非所有者只能经所有者 API 或事件投影读，**不写**。检查：`check_deps --writes`。

| schema | 所有者 | 主要表 | 谁可以读（经什么） | 备注 |
|---|---|---|---|---|
| `platform` | platform | `audit_log`、`idempotency_receipt`、`outbox` | 所有模块经 platform API | `idempotency_receipt` 是 INV-04 的回执表 |
| `identity` | identity | `org`、`store`、`user`、`role`、`grant` | 所有模块经 identity API | |
| `catalog` | catalog | `sku`、`barcode`、`category`、`sku_store_scope`、`sku_history` | pricing/inventory/supplier/import-export/pos-gateway 经 API；reporting 经投影 | `barcode` 多对一 `sku`（CAT-001） |
| `pricing` | pricing | `store_price`、`promotion`、`price_effective` | pos-gateway/settlement 经 API | |
| `supplier` | supplier | `supplier`、`quote`、`purchase_order`、`receipt_note` | settlement/import-export 经 API | |
| `inventory` | inventory | `stock`、`batch`、`stocktake`、`stocktake_diff`、`transfer`、`adjustment`、`stock_event_outbox` | settlement/pos-gateway 经 API；reporting 经事件投影 + EX-004 只读视图 | v1/v2 事件均由 `stock_event_outbox` 发出 |
| `member` | member | `member`、`points_ledger`、`tier` | pos-gateway 经 API | 手机号加密列 |
| `settlement` | settlement | `supplier_statement`、`store_daily_close`、`reconcile_diff` | reporting 经投影 | |
| `pos` | pos-gateway | `push_job`、`push_receipt`、`sales_inbound`、`vendor_adapter_state` | reporting 经投影 | 独立部署单元，独立连接池 |
| `import_export` | import-export | `import_job`、`import_row`、`template_version` | — | 两阶段导入的暂存 |
| `reporting` | reporting | `proj_*`（事件投影表）、`report_snapshot` | 所有模块只读 | 投影可重建，不是权威 |
| `notification` | notification | `message`、`delivery_receipt` | — | 短信回执是 INV-04 的一部分 |

## 迁移规则

- 只有所有者模块的 alembic 分支可改该 schema。
- expand/contract；保留期内不删列；大表分批；回读校验写进工作项证据。
- prod 迁移由发布流程执行，agent 不直接跑（`AGENTS.md` §4）。
