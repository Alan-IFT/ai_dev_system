# 项目现状

status_revision：147
状态：active
updated_at：2026-09-07
状态负责人：Zhao
last_verified_at：2026-09-07（`git rev-parse HEAD` 与 prod `/health` 核对）

> 只承载里程碑级摘要、当前重点、项目级阻塞与接手入口。实时任务步骤看工作项；数字不在此抄，脚本现取。

## 当前基线

- repository：`github.com/example/retail-core`，branch `main`
- HEAD：不抄，`git rev-parse HEAD` 现取
- prod：v2.4.0（2026-08-25 发布，观察窗已过，无回退）；migration head `20260820_1142`
- staging：main 每次合并自动部署
- 60 家门店在线；厂商 A 42 家、厂商 B 18 家

## 当前阶段与本期目标

v2.x 维护期 + 商品部"新品导入自动拆分"需求（CAT-011/012、IMP-006/007）。下一版 v2.5.0 目标 2026-09-23。

## 当前重点

| 工作项 | 一句话 | 状态 | 负责人 | 精确路径 |
|---|---|---|---|---|
| WI-0151 | 新品导入四类拆分与一品多码 | in_progress（阶段 2/3） | Li + Claude Code | [work/WI-0151](work/WI-0151-新品导入四类拆分与一品多码.md) |
| WI-0155 | POS 静默告警阈值按营业时间 | **blocked**（等 identity 门店营业时间字段与 ADR-0015 裁定） | Zhao | [work/WI-0155](work/WI-0155-POS静默告警按营业时间.md) |
| WI-0148 | reporting 盘点差异事件投影（消 EX-004） | planned | Wang | work/WI-0148 |
| WI-0157 | pricing 模块文档对账（G11 连续两迭代落后） | planned | Li | work/WI-0157 |

## 影响后续工作的阻塞与限制

- **EX-004 到期 2026-10-31**：WI-0148 不做完，reporting 直接读 inventory 视图的例外到期 CI 转红。
- **EX-006 openpyxl CVE** 到期 2026-11-20，排在 WI-0151 `done` 之后。
- 厂商 B 尚未提供门店营业时间接口，WI-0155 阻塞；临时用全局 30 分钟阈值，夜间门店误报每天约 6 条。
- 特性开关 `classify_v2` 到期 2026-11-30。

## 接手入口

- 优先继续 **WI-0151**：最新交接 [handoff/WI-0151-2026-09-05.md](handoff/WI-0151-2026-09-05.md)；分支 `feat/wi-0151-classify`，有未合并提交，**无未提交改动**（交接里核对）。
- 本周维护（每周一）：候选区过一遍、活性巡检、STATUS 更新——上次 2026-09-07 已做。
- 迭代对账（下次 2026-09-15）：G11 文档新鲜度、契约消费者对账。
