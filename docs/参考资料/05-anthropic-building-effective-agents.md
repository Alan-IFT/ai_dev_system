# Anthropic：Building Effective Agents

原文：[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)  
source_id：`SRC-ANT-AGENTS`  
类型：V1（厂商一手工程文章）  
访问核对：2026-09-01

## 可支持的观察

- 应从最简单可行的方案开始，避免为了“Agent 化”堆叠复杂协调。
- Workflow 使用预定义路径；Agent 根据环境反馈动态决定下一步。
- 链式、路由、并行、编排者—Worker、评价者—优化者等都是模式选择，不是必选架构。
- 有真实环境反馈、清晰工具接口和受限权限比单纯增加 prompt 更重要。

## 在本项目中的落点

- [复杂度阶梯](../21-调度与拆分.md#complexity-ladder)规定先用低复杂度机制。
- [Worker 合同](../21-调度与拆分.md#worker-contract)和[ACI](../24-工具与执行环境.md#aci)把并行和工具设计显式化。

## 边界

文章是模式指南，不是对不同模式的统一性能排序。是否启用多 Agent 要由任务独立性、热点冲突、合并验收、成本和 eval 决定。
