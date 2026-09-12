# O-01 · Implementing SLOs

- 作者：Steven Thurgood、David Ferguson；协作 Alex Hidalgo、Betsy Beyer。机构：Google。
- 原文：[The Site Reliability Workbook · Implementing SLOs](https://sre.google/workbook/implementing-slos/)。页面未标独立发布日期；访问：2026-09-08。
- 实读范围：Getting Started、SLI specification/implementation、组件类型、窗口选择、相关方共识、错误预算策略与目标迭代；不声称核验书中示例代码。

## 原文结论与边界

SLO 应表达用户体验；指标定义与采集方法分开。目标需产品、研发和运维达成共识，错误预算必须关联行动。目标与测量会迭代。文中的示例百分比、窗口和 HTTP 成功口径具有场景前提，不能直接复制为所有项目标准。

## 本项目采用

现有发布与事故流程缺少运营目标连接。本项目设计一张运行责任卡，绑定关键旅程、指标、观测窗口、目标负责人、异常行动和复核入口；采集缺失记未知。卡字段与最低采用时机是本项目的实现选择，不是原文逐字要求。

- 已落地：[04 的服务责任卡与 SLO](../04-可靠性安全与运行维护.md#service-objectives)。
- 不采纳：默认 100% 或统一的几个九；直接复制 Google 数值；用 CPU 健康替代业务成功。
- 验证：用用户操作失败但进程仍存活的场景检查指标；缺流量/缺采集时不得算通过；预算触发后能定位负责人和处置工作项。
- 裁剪：离线工具可用任务正确性与完成时限，不强加在线可用率。

闭环顺序：读取本篇 → 写本卡 → 更新 04 对应章节 → 才开始 O-02。真实收益未验证。
