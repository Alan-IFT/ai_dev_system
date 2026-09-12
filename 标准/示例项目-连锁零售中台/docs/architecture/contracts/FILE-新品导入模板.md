---
id: FILE-新品导入模板
status: active
owner: Li（import-export）；业务方：商品部
version: 3
updated_at: 2026-08-04
supersedes: [FILE-新品导入模板@v2]
---

# FILE · 新品导入模板

商品部用 Excel 填写、上传的文件。**外部人是提供方**，本系统是消费方——所以模板变更由本系统发布版本、商品部按版本填写，而不是反过来。

## 格式（权威：`packages/contracts/files/new_item_template_v3.xlsx` + `new_item_template_v3.schema.json`）

首行 `TEMPLATE_VERSION=3`。列：条码、名称、**规格**（v3 新增）、分类、供应商编码、进价、售价、经营范围（门店编码，分号分隔）、备注。

## 语义约束

- 未知版本拒绝（IMP-001）；v2 文件支持至 2026-12-31，缺"规格"列时归类相似度降权并标"待确认"。
- 同一文件内同名同规格不同条码的多行 → 一品多码（CAT-012）。
- 合并单元格读为空 → 逐行报错，不整体拒绝（F-012）。

## 变更历史

| 版本 | 日期 | 变更 | 原因 |
|---|---|---|---|
| v1 | 2025-05-06 | 首版 | WI-0024 |
| v2 | 2025-11-03 | 加"供应商编码"列 | 采购要求 |
| v3 | 2026-08-04 | 加"规格"列 | F-029：无规格时相似度误归类 |

## 契约测试

`tests/contracts/import/test_new_item_template_v3.py`（含 v2 文件的降级路径）。
