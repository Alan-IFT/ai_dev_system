# OpenAI：Evaluate Agent Workflows

原文：[Evaluate agent workflows](https://developers.openai.com/api/docs/guides/agent-evals)  
source_id：`SRC-OAI-EVAL`  
类型：V1（官方产品指南）  
访问核对：2026-09-01

## 可支持的观察

- trace 能帮助定位模型调用、工具调用、guardrail 与 handoff 中的行为问题。
- 当“什么是好结果”还不清楚时，先检查真实轨迹；标准稳定后，再构造数据集、grader 和可重复 eval run。
- 评估对象不只最终文本，也包括工具使用、handoff、规则遵守和端到端行为。

## 在本项目中的落点

- [四层评估](../33-评估与演进.md#case-registry)保留工件、轨迹、任务和项目层。
- [Eval manifest](../33-评估与演进.md#case-registry)固定 Case、模型、工具、grader、阈值和结果。

## 边界

“trace → dataset/eval run”的直接适用对象是 agent workflow。将其用于 AI 编码 Harness 是本项目的外推假设（RC-006），应以项目 Case 验证，不能把它误写成官方对编码系统的结论。
