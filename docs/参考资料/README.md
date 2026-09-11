# 参考资料

本目录保存“可按需读取”的研究卡片；它们解释某条候选为什么被提出、证据能覆盖哪里、又不能覆盖哪里。它们不属于默认上下文，也不直接构成已生效规则。

完整的 `source_id → claim_id → 推断类型 → 待验证状态` 映射见[研究来源与支撑矩阵](../归档/来源与证据矩阵.md)。

| 编号 | 资料 | 类型 | 用途 |
|---|---|---|---|
| 01 | [OpenAI：Harness Engineering](01-openai-harness-engineering.md) | V1 | 仓库事实、地图式入口、可执行约束与熵清理 |
| 02 | [Anthropic：长运行 Agent Harness](02-anthropic-long-running-harness.md) | V1 | 初始会话、工作项、持久进度与端到端验收 |
| 03 | [Anthropic：Context Engineering](03-anthropic-context-engineering.md) | V1 | 最小充分上下文、JIT、渐进披露与压缩 |
| 04 | [OpenAI：Agent Evals](04-openai-agent-evals.md) | V1 | trace、grader、数据集和可重复 eval run |
| 05 | [Anthropic：Building Effective Agents](05-anthropic-building-effective-agents.md) | V1 | Workflow/Agent、模式与工具接口 |
| 06 | [Lost in the Middle](06-lost-in-the-middle.md) | A1 | 长上下文位置、长度与干扰评估边界 |
| 07 | [CoALA](07-coala.md) | A2 | Agent 认知/记忆分类的概念镜头 |
| 08 | [Boris Cherny 访谈](08-boris-cherny-claude-code.md) | P1/V1 | 模型升级后的消融与验证纪律 |
| 09 | [用户附件与一线观察](09-用户附件与观察.md) | P1/S1 | 用户提供的交付链、记忆与控制实践 |
| 14 | [Google Antigravity：Teamwork](14-google-antigravity-teamwork.md) | V1 | pattern 是规格不是程序；候选配 falsifier；驳回路线带异议进下一轮；防作弊沙箱参照实现；Flash 档 + 编排替代更大模型 |

阅读顺序建议：先读 01、02、03 建立交付/上下文基础；需要落地评估时读 04、08；讨论记忆时读 07、09；需要选 Agent 结构时读 05、06。

- [10-第三轮材料合并卡片](10-第三轮材料合并卡片.md)：ATT-E ～ ATT-Q 共 13 份材料的合并卡片。刻意不逐份建卡，理由见卡片首段。
- [11-公众号文章卡片](11-公众号文章卡片/README.md)：第四轮 44 篇公众号文章的逐篇阅读卡片（含图与引用资料核对），每篇一卡。
- [12-第四轮主题综合](12-第四轮主题综合/README.md)：六份主题综合报告，归并 44 张卡片并给出修订建议与冲突裁决。
- [参考资料-Claude](../参考资料-Claude/README.md)：Anthropic 官方一手材料的阅读卡片，按来源方单独存放；权威登记仍在[来源与证据矩阵](../归档/来源与证据矩阵.md#external-sources)。
