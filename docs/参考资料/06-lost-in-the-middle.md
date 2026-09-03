# Lost in the Middle: How Language Models Use Long Contexts

原文：[TACL 2024 论文](https://aclanthology.org/2024.tacl-1.9/)；用户提供的 HTML 版：[arXiv](https://arxiv.org/html/2307.03172v1)  
source_id：`SRC-LITM`  
类型：A1（同行评审受控实验）  
访问核对：2026-09-01

## 可支持的观察

- 在论文研究的模型与任务中，长上下文容量不等于所有位置信息都被等效利用。
- 关键资料的位置、上下文长度和干扰项会影响任务表现。
- 因此，检索/上下文策略应测试长度、位置、噪声和冲突，而不是只看窗口上限。

## 在本项目中的落点

- [上下文分层](../22-上下文装配.md#context-levels)采用最小充分与渐进加载。
- [评估与演进](../33-评估与演进.md#case-registry)要求用真实 Case 验证所选模型的上下文策略。

## 边界

研究主要覆盖 2023 年模型、多文档 QA 与合成键值任务。不能据此断言所有当前模型都会出现相同的 U 型曲线或固定的性能降幅。
