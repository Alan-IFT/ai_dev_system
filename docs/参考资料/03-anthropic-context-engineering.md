# Anthropic：Effective Context Engineering for AI Agents

原文：[Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)  
source_id：`SRC-ANT-CTX`  
类型：V1（厂商一手工程文章）  
访问核对：2026-09-01

## 可支持的观察

- Context Engineering 关注每次推理真正看到的信息工作集，而不只是提示词。
- 理想目标是最小充分且高信号的上下文；信息过多同样会降低有效注意力。
- 渐进披露、即时检索、压缩、结构化笔记和子 Agent 是不同的长任务策略，各有代价。
- 工具应尽量少而边界清楚，输出也应控制噪声。

## 在本项目中的落点

- [Default Context Contract](../../CONTEXT_MANIFEST.md)定义唯一入口、按需材料和默认排除项。
- [分层加载](../22-上下文装配.md#context-levels)规定先索引、后片段、再扩展。
- [记忆检索](../12-记忆与知识治理.md#memory-retrieval)要求从索引回到当前有效来源。

## 边界

文章没有证明固定 Token 百分比、固定 Top-K、固定目录层级或某一种长任务策略对所有项目最优。即时检索也可能带来延迟、检索失败和工具选择成本。
