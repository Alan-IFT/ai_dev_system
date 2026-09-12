---
id: ACC-INDEX
status: active
owner: Zhao（产品）
updated_at: 2026-08-30
---

# 验收条目

**验收条目是意图的唯一派生源**：工作项与测试都从这里派生，下游不重新解释意图。

## ID 规则

- 格式 `<领域>-<三位序号>`：`CAT-`（商品主数据）`SUP-`（供应商与采购）`INV-`（库存）`PRC-`（价格促销）`POS-`（POS 对接）`MEM-`（会员）`SET-`（结算）`IMP-`（导入导出）`RPT-`（报表）`NFR-`（非功能）。
- **ID 发布后不复用**；语义变化新增 ID 并在旧条目写 `superseded_by`。
- 每条：可观察结果、目标环境、优先级、状态（`draft` / `frozen` / `superseded`）、冻结人与日期。
- **确认即冻结**：`frozen` 后语义不随实施调整；实施期要改的，记为验收变更回原批准人，不由实现者就地改。

## 条目格式

```
### INV-014 · 库存变更事件 v2 携带分区键与幂等键
- 可观察结果：任一库存变更产生一条 `inventory.stock-changed` v2 事件，含 store_id、sku_id、delta、idempotency_key、occurred_at；同一 idempotency_key 重复投递时消费者只处理一次（回执数 == 投递去重后数）
- 目标环境：staging → prod
- 优先级：P0
- 状态：frozen（Zhao，2025-12-08）
- 来源：ADR-0007；F-017
- 派生：WI-0142；tests/integration/inventory/test_stock_changed_v2.py
```

## 文件

| 文件 | 领域 | 条目数 |
|---|---|---|
| `CAT-商品主数据.md` | CAT- | 见文件 |
| `INV-库存.md` | INV- | 见文件 |
| `IMP-导入导出.md` | IMP- | 见文件 |
| `POS-对接.md` | POS- | 见文件 |
| （SUP、PRC、MEM、SET、RPT、NFR 各一文件，本示例未展开） | | |

条目数不在此抄——跑 `grep -c '^### ' docs/product/acceptance/*.md` 现取。
