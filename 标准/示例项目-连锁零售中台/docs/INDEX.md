# 文档地图

**只做地图：去哪找 + 一句摘要 + 什么时候读。** 与细节冲突以细节为准；这里出现的任何数字或状态都不是权威。

| 路径 | 一句摘要 | 权威域 | 加载时机 |
|---|---|---|---|
| `../AGENTS.md` | 常驻规则与唯一加载合同 | 规则、合同、权威位置表 | 每次 |
| `../governance/project.yaml` | 档次、路径、预算、元信息范围 | 项目配置 | 每次 |
| `../governance/GATES.md` | 十三道闸门的合同，以及它们用的命令 | 闸门、命令 | 提交/合并/收工前 |
| `../governance/exceptions.md` | 例外登记（带到期） | 例外 | 检查器报错时 |
| `product/vision.md` | 目标、用户、非目标 | 意图（项目级） | 立项/阶段变化时 |
| `product/acceptance/README.md` | 验收 ID 规则与领域前缀 | — | 新建条目时 |
| `product/acceptance/CAT-商品主数据.md` | 商品、条码、一品多码、经营范围的验收条目 | 意图（CAT-） | 工作项引用时 |
| `product/acceptance/INV-库存.md` | 库存、盘点、调拨、事件的验收条目 | 意图（INV-） | 同上 |
| `product/acceptance/IMP-导入导出.md` | 批量导入模板与导出 | 意图（IMP-） | 同上 |
| `product/acceptance/POS-对接.md` | POS 推送与流水回传 | 意图（POS-） | 同上 |
| `architecture/overview.md` | 系统全景：14 个模块、分层、部署、外部系统 | 架构（全景） | 涉及跨模块时 |
| `architecture/invariants.md` | 全仓不变量 INV-01～INV-09 | 不变量 | 高影响变更前；事故复盘 |
| `architecture/dependency-rules.md` | 四层与允许依赖矩阵 | 依赖规则 | 新增依赖前 |
| `architecture/data-ownership.md` | 每张表归哪个模块 | 数据所有权 | 碰数据库前 |
| `architecture/modules/README.md` | 14 个模块一行清单 | — | 定位模块时 |
| `architecture/modules/<m>.md` | 单模块职责、边界、接口、依赖、坑 | 模块 | 碰该模块时 |
| `architecture/contracts/README.md` | 契约登记表：提供方、消费者、版本、状态 | 契约索引与消费者 | 改接口/事件/文件格式前 |
| `architecture/contracts/<c>.md` | 单个契约的 schema、兼容策略、变更历史 | 该契约 | 同上 |
| `decisions/README.md` | ADR 索引 | — | 问"为什么"时 |
| `decisions/ADR-*.md` | 决策、备选、代价、重评条件 | 决策 | 同上 |
| `state/STATUS.md` | 基线、当前重点、阻塞、接手入口 | 项目状态 | 每次 |
| `state/work/README.md` | 工作项 ID 规则与当前清单 | — | — |
| `state/work/WI-*.md` | 单个任务实时状态 | 任务状态 | 当前工作项 |
| `state/handoff/*.md` | 会话交接快照 | 恢复凭据 | 接手时第一读 |
| `state/artifacts/` | 工具返回原文（不进 git） | — | 按引用回读 |
| `knowledge/PLAYBOOK.md` | 项目特有做法与坑（规则索引） | 做法 | 按条目触发条件 |
| `knowledge/FAILURES.md` | 失败清单 | 失败 | 删减、审计、补绑定时 |
| `knowledge/glossary.md` | 本项目特有术语 | 术语 | 遇到不认识的词时 |
| [反馈跨任务生效演练](../反馈跨任务生效演练.md) | 从反馈、条目变更到后续使用与撤销的待执行计划 | 教学材料，不是现行规则 | 采用或复核记忆/反馈机制时按需 |
| `runbooks/RB-*.md` | 故障排查与运维操作 | 操作 | 出故障时 |
| `releases/v*.md` | 版本包含的工作项、证据、限制、回滚 | 发布 | 回溯时 |
| [operations/README.md](operations/README.md) | 运行责任、恢复、发布和维护风险的虚构演练入口 | 运行计划索引 | 上线、恢复、接班和周期维护时 |
| `../.agents/skills/README.md` | 方法库清单 | — | description 常驻 |
| `../tools/README.md` | 检查器清单与验收记录 | — | 改检查器时 |
