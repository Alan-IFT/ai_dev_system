# O-05 · Canarying Releases

- 作者：Alec Warner、Štěpán Davidovič；协作 Alex Hidalgo、Betsy Beyer、Kyle Smith、Matt Duftler；机构 Google。
- 原文：[SRE Workbook · Canarying Releases](https://sre.google/workbook/canarying-releases/)。未标独立发布日期；访问 2026-09-08。
- 实读：Release Engineering Principles、canary 前提、实施范围与时长、指标代表性与归因、Before/After Evaluation Is Risky；没有运行 App Engine 示例或复算图表。

## 原文结论与边界

灰度要限制暴露范围并评估是否继续，具备流量分配、评价和流程连接。代表性取决于流量、时段和指标；共享故障域、并发变更与简单前后对比可能干扰判断。文章的示例流量比例和错误预算模型均有假设，不是默认发布阈值。

## 本项目采用

把发布计划补成候选制品、观察、放量/停止和恢复的记录；把配置及功能开关也视为变更。数据不可逆、无流量判未定、开关清理与发布证据字段为本项目的具体设计，不假称原文逐项要求。

- 已落地：[04 渐进发布与容量](../04-可靠性安全与运行维护.md#progressive-delivery)。
- 不采纳：统一灰度百分比和观察时长；低流量无报错即安全；所有项目必须自动化生产发布。
- 验证：无代表流量、候选与对照共用故障资源、回退后无法读取新数据三个场景，分别应延长验证、登记归因限制、进入恢复/前向修复路径。
- 裁剪：无法分流时可采用分批交付或维护窗口，但需标明证据覆盖，不称拥有未实现的灰度能力。

闭环顺序：O-04 已落地 → 读本篇 → 写本卡并更新 04。本方向随后进入示例与集成，没有实际发布。
