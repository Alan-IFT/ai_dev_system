---
id: MOD-catalog
status: active
owner: Li
updated_at: 2026-08-30
source_rev: e93a0f4
---

# catalog · 商品主数据

## 职责与边界

**负责**：SKU 的生命周期（建档、变更、停售）、条码（一品多码，主/副条码）、分类树、经营范围（SKU × 门店集合）、SKU 与供应商的关联、档案变更历史（CAT-007）。

**明确不负责**：价格（pricing）、库存（inventory）、采购与报价（supplier）、导入文件的解析与两阶段流程（import-export——catalog 只提供"按行归类"与"写入"两个 API）、推送到 POS（pos-gateway 订阅本模块事件）。

**最容易被误放进来的**："新品导入自动分四类"（CAT-011）的**流程**属于 import-export，本模块只提供 `classify_row()` 与批量写入；"经营范围变更 15 分钟内推送"（CAT-002）的**时效**由 pos-gateway 的推送周期保证，本模块只负责发事件。

## 公开接口

| 契约 | 类型 | 一句话 |
|---|---|---|
| `API-catalog-sku` v1 | 同步 API | SKU/条码/分类/经营范围的读写；`classify_row` | 
| `EVT-catalog-sku-changed` v1 | 事件 | SKU、条码、经营范围任一变更时发出（供 pos-gateway、reporting） |

定义在 `../contracts/`；本文不复制签名。

## 依赖

- **依赖**：platform（审计、幂等回执）、identity（门店存在性、操作人）、supplier（只读 `exists(id)`，同层登记）
- **被依赖**：pricing、inventory、supplier、settlement、pos-gateway、import-export、reporting、api-gateway——**改公开接口前先看契约登记表的消费者列**，这是全仓被依赖最多的模块

## 数据所有权

`catalog.*`：`sku`、`barcode`（多对一 `sku`，`is_primary`）、`category`、`sku_store_scope`、`sku_history`。他人只经 API 读。

## 不变量

- INV-05（权威在本系统）
- 局部：任一条码全企业唯一（DB 唯一约束 + `classify_row` 前置检查）；每个 SKU 恰有一个主条码；副条码 ≤ 8（CAT-012）

## 配置与开关

- `catalog.scope_push_interval`：经营范围变更合并推送窗口，默认 15 分钟（实际推送由 pos-gateway 执行）
- 特性开关 `catalog.classify_v2`（WI-0151 用，2026-08-04 开，到期 2026-11-30 清理）

## 可观测性

- 指标：`catalog_sku_changes_total{kind}`、`catalog_classify_latency_seconds`
- 日志事件：`sku.created`、`sku.scope_changed`、`barcode.conflict`
- 告警：`barcode.conflict` 一小时超 50 次（通常是导入模板错列）

## 已知坑

- 名称相似度归类曾把"可口可乐 330ml"与"可口可乐 330ml×6"归为同一 SKU（F-029）——现在规格字段参与比对，见 PLAYBOOK PB-12。
- 经营范围变更如果一次改 60 家店，`sku_store_scope` 的 60 行写入曾触发 pos-gateway 60 次单独推送（F-014）——现在事件按 SKU 合并，消费者按窗口批量。
- `sku_history` 只记本模块的变更；价格历史在 pricing——查"这个 SKU 什么时候改过价"别来这里。

## 相关决策

ADR-0001；ADR-0003（一品多码数据模型，未展开）

## 运行手册

无独立 runbook；条码冲突处理见 PLAYBOOK PB-05。
