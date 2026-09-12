---
id: API-catalog-sku
status: active
owner: Li（catalog）
version: 1
updated_at: 2026-08-04
supersedes: []
---

# API · catalog-sku

提供方 catalog；消费者：pricing、inventory、supplier、settlement、pos-gateway、import-export、api-gateway（全仓被依赖最多的契约）。

## 定义（权威：`services/catalog/api/openapi.yaml`，本文只引用）

端点族：`GET/POST/PATCH /skus`、`/skus/{id}/barcodes`、`/skus/{id}/scope`、`/categories`、`POST /skus/classify-row`（WI-0151 新增，开关 `catalog.classify_v2`）。

## 语义约束

- 条码全企业唯一；`POST /barcodes` 冲突返回 409 与冲突 SKU（CAT-001）。
- `PATCH /scope` 是全量替换门店集合，不是增量；一次最多 200 家店。
- `classify-row` 是纯函数（不写），输入一行导入数据，输出 `{category, basis, matched_sku_id?}`；`category` 取值见 IMP-006。
- 所有写操作要求 `Idempotency-Key` header（INV-04）。

## 兼容策略

加字段/加端点向后兼容；改语义或删走 v2 与 90 天共存。

## 变更历史

| 版本 | 日期 | 变更 | 工作项 |
|---|---|---|---|
| v1 | 2025-03-24 | 首版 | WI-0003 |
| v1 | 2025-04-20 | 加 `/scope` 全量替换语义 | WI-0008 |
| v1 | 2026-08-04 | 加 `classify-row`（开关后） | WI-0151（进行中） |

## 契约测试

`tests/contracts/catalog/test_api_v1_producer.py`；消费者各自的 consumer 测试。
