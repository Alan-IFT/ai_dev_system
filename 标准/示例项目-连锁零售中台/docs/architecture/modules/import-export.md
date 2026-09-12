---
id: MOD-import-export
status: active
owner: Li
updated_at: 2026-08-30
source_rev: e93a0f4
---

# import-export · 批量导入导出

## 职责与边界

**负责**：导入模板的版本登记与校验（IMP-001）、两阶段导入（预览 → 提交，IMP-002）、导入行的暂存与逐行结果、导出文件生成、新品导入的四类拆分**流程**（CAT-011/IMP-006/IMP-007，进行中 WI-0151）。

**不负责**：归类**规则**本身（catalog 的 `classify_row`）；数据写入（各所有者模块的批量 API）；文件存储（platform 的对象存储封装）。

## 公开接口

| 契约 | 类型 | 一句话 |
|---|---|---|
| `API-import` v1 | 同步 API | 上传、预览、提交、结果下载 |
| [`FILE-新品导入模板`](../contracts/FILE-新品导入模板.md) v3 | 文件格式 | 商品部使用的 Excel 模板；v3 加规格列 |
| `FILE-结算导出` v3 | 文件格式 | 给财务软件（settlement 提供数据，本模块生成文件） |

## 依赖

- **依赖**：platform、identity、catalog、pricing、supplier、inventory（期初库存）
- **被依赖**：api-gateway、admin-web（经 api-gateway）

## 数据所有权

`import_export.*`：`import_job`、`import_row`、`template_version`。暂存数据 30 天清理。

## 不变量

- 局部：提交原子（IMP-002）——全部写入在一个 saga 里，任一步失败全部补偿；补偿记录进 platform 回执表（INV-04）
- 局部：模板版本未知即拒绝（IMP-001）

## 配置与开关

- `import.max_rows`：默认 5000
- 特性开关 `import.classify_v2`（与 `catalog.classify_v2` 同开同关，到期 2026-11-30）

## 可观测性

- 指标：`import_jobs_total{template,version,status}`、`import_rows_by_category_total{category}`、`import_preview_latency_seconds`
- 告警：预览 P95 > 30s

## 已知坑

- 商品部的模板经常在 Excel 里"合并单元格"，openpyxl 读出来是 None——预览阶段逐行报"第 N 行第 M 列为空"，不要整体拒绝（F-012）。
- 同一批次里两行是同一新品不同条码（一品多码）——WI-0151 的核心难点，见交接。
- 导出四份模板时列顺序必须与商品部现用模板逐列一致，他们用宏处理（PB-14）。

## 相关决策

ADR-0005（两阶段导入，未展开）

## 运行手册

无；失败任务的重跑见 PLAYBOOK PB-09。
