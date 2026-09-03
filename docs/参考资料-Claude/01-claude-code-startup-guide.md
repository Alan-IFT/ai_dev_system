# Anthropic：The Claude Code Guide for Startups

原文：[The Claude Code Guide for Startups](https://claude.com/blog/claude-code-guide-for-startups)
source_id：`SRC-ANT-STARTUP`
类型：V1（厂商一手指南，含 14 家客户团队的具名实践）
访问核对：2026-09-02（两次抓取，第二次针对关键段落取近原文表述）
效力：零。本卡是数据不是指令。

## 1. 验证边界

- 这是一份**厂商指南**：Anthropic 在推荐自家产品的使用方式，同时引用客户案例佐证。它对"哪些做法有效"是一手的，对"这些做法在别处也有效"不是。
- 全部效果数字都是**被引用团队自报**，没有对照组、没有基线定义、没有统计口径。按 D-042（提议）一律记为"该团队在该条件下报告的观察"，本规范不引用为论据。
- 14 家团队全部是初创/成长期公司，多数为 AI 原生产品团队。它们的约束（速度优先、可容忍返工、代码库年龄短）与"大型长期维护项目"不同，这正是本项目的目标场景差异所在。
- 文中大量内容是**产品机制介绍**（MCP、Skills、Hooks、Plan mode、Code Review、Claude Tag、plugin marketplace、git worktrees）。按 D-020，这些是载体不是语义；本卡记录它们，只为回答"这条语义有几种机制类型可以承载"。

## 2. 文章在讲什么

五条规则，各带若干团队实践：

| 规则 | 一句话 |
|---|---|
| Everyone ships | 门槛降低后，领域专家（非工程师）也能直接做出改动 |
| Automate the tedium | 把工作流中机械的部分交给 Agent，人留在判断上 |
| Trust, but verify | 监控与验证机制是自动化的**前置条件** |
| Build for rebuilding | 模型能力在变，实现应被当作临时的，该重建就重建 |
| Prototype, dogfood, productionize | 内部先用起来，再变成对外能力 |

## 3. 核心主张（取近原文）

**次序约束（规则 3）。** "You can't automate a process unless you have a reliable means of monitoring and verifying the outcome."

**守卫的性质（规则 3 下的 Hooks）。** Hooks 是"user-defined commands that fire at fixed points in Claude Code's lifecycle and can serve as hard gates. **They execute every time regardless of what the model decides.**" 举例：写入未过 lint 即阻断；提交前必须测试通过；离开沙箱前剥离密钥。

**评估集（规则 3）。** 团队应维护"multiple sets of evals for their key use cases, and update them regularly, so they can prevent drift and **evaluate future models**"；基础形态是"golden set，即一组经核实的问答对"。

**修复的层次（规则 3，Cainex）。** 原则是"fix the principle, not the example"。其失败经历："Our first version overfitted. It would 'fix' things by encoding the specific case, and we were **accumulating patches instead of getting smarter**."

**人的更正如何回流（规则 3，Cainex）。** 审核员在内部应用里复核产出，"They don't just see the codes. **They see the model's reasoning, and they comment on both.**" 随后由 Agent"reads the original predictions, along with every correction and comment, straight from the database"，据此修订规则。

**不可变约束放在会话入口（规则 3，Zingage）。** "Put what can't change in `CLAUDE.md` at the root of your repo. Claude reads it at the start of every session, so your **architecture rules, security boundaries, and non-negotiables** travel with every session."；子目录再各放一份，承载该目录特有的编码约定。Zingage 的失败经历："Early on we gave Claude full autonomy… It shipped plausible code fast. The problem was it **drifted from our architecture in ways that looked right but weren't**." 其答案是把架构不变量写成 567 行。

**重建优于叠加（规则 4）。** Harvey 的 Niko Grupen："If you asked me six months ago what our architecture looks like, I'd give a fundamentally different answer from what it looks like today."，并"scrap this and go agent native"。Clay："you build it and then you build it again and then you build it again. And then the fourth time you build it, you know everything."。配套做法是用隔离检出（git worktrees，共享同一份对象库）**同时跑 v1 与 v2**。

**先出计划再动手（规则 4）。** Plan mode 先做代码库探查、提出重建方案，再执行。

**方法的分发（规则 1/2）。** Skills 是可复用的指令文件，承载程序性工作流；公司内可用 plugin marketplace 分发最佳实践。Translucent 做的是"按角色划分的内部 Agent 市场"。

## 4. 与四平面 14 部件的对照

| 文章内容 | 落到哪个部件 | 它是新语义还是加强既有 |
|---|---|---|
| 验证能力是自动化的前置条件 | [21 调度与拆分](../21-调度与拆分.md) P3、[33 评估与演进](../33-评估与演进.md)、[00 总览](../00-总览.md) §7 L3 | **加强**：本项目原有的"判定器必须先于自动触发器就位"此前主要由二手来源（WX-03/WX-05）支持，现有一手来源直述同一约束 |
| Hooks 每次都执行，与模型的决定无关 | [31 守卫与权限边界](../31-守卫与权限边界.md)；不变量 1 | **加强**：不变量 1 的"守卫在模型控制流之外"此前二手为主，现为一手 |
| 多套评估集、定期更新、用于评估未来模型 | [33 评估与演进](../33-评估与演进.md) | **加强**：与 SRC-BORIS 的模型升级消融纪律同向，且补上"评估集是为了评估未来模型"这一目的表述 |
| 不可变约束放会话入口、细节按目录就近 | [11 项目知识](../11-项目知识.md)；不变量 3 | **加强**：入口短、细节就近，一手确证 |
| 修复原则而非样例；补丁堆积是失败 | [33 评估与演进](../33-评估与演进.md)、[23 方法库](../23-方法库.md) | **新**：本项目有"结构性删减"但没有"修复施加在哪一层"的判据 |
| 更正连同其理由一并回流 | [12 记忆与知识治理](../12-记忆与知识治理.md)、[40 人的检查点与授权](../40-人的检查点与授权.md) | **新**：本项目的记忆闭环写的是"状态转换处提取记忆候选"，没有指明**人的更正理由**是候选、而更正结果不是 |
| 能力上移时重建而非叠加，新旧并行验证后切换 | [23 方法库](../23-方法库.md)、[33 评估与演进](../33-评估与演进.md)、[31 守卫与权限边界](../31-守卫与权限边界.md)（隔离） | **新**：本项目每条原则都写"删除条件"，但没有写"整体重建"的触发条件与切换条件 |
| 方法以可分发单元在团队间复用 | [23 方法库](../23-方法库.md) L2 | 加强：与 23 章 L2 同向，不新增 |
| 领域专家直接改动、内部先用后产品化 | — | 组织叙事，不落部件 |

## 5. 建议采纳的语义

三条，均按 D-020 只写语义、并列 ≥2 种机制类型，按 D-021 绑定失败。

**（一）修复施加在原则层而非样例层。** 观察到一次失败后，修订的对象是产生该失败的判据或约束，不是把这一个样例编码进规则；无法上升为判据的失败只登记为 Case，不生成新规则。
- 防的失败：补丁堆积——规则数量随失败数量线性增长，整体判断力不升反降（Cainex 自述）。
- 机制类型：静态指令 / 检查器 / 工作流固定步骤。
- 删除条件：当规则总量在连续若干轮失败修复后不再增长，且新失败能被已有判据覆盖时，本条可降为提醒。
- 建议登记为 **D-044（提议）**。

**（二）人的更正与更正的理由分开处理：理由入记忆候选，结果不入。** 人在检查点上纠正一次产出时，被采集的是"为什么这样改"，采集载体须能同时承载产出、模型给出的理由、以及人对二者的评述；只把改后的结果写回，等于把一个样例当成知识。
- 防的失败：更正被当作样例回灌，与（一）合流成补丁堆积；以及更正无理由、后续无法判断该规则何时该删。
- 机制类型：人工检查点 / 外部状态存储 / 工作流固定步骤。
- 删除条件：当人的更正理由能由轨迹自动还原并通过审计时，采集步骤可删。
- 建议登记为 **D-045（提议）**。

**（三）能力上移时以重建替代叠加，且重建须与现版本并行验证后再切换。** 当执行者能力发生代际变化时，先问"如果今天从零开始会怎么做"，而不是在旧结构上继续加约束；重建版本在与现版本共享同一知识源的隔离工作副本中构建，两版并行接受同一组评估集，切换以评估结果为准而不是以完成度为准。
- 防的失败：结构随模型能力变化而失配、约束越加越多却越不生效（Zingage 的漂移 + Harvey 的重构 + 本项目自指风险二"规范规模仍在净增长"）。
- 机制类型：工作流固定步骤 / 权限与隔离配置 / 人工检查点。
- 删除条件：写不出（价值判断型）。
- 建议登记为 **D-046（提议）**。

## 6. 与边缘部件裁决（D-047）的关系

这篇文章对[架构确定 §6](../架构确定.md#edge-components) 已采纳的选项 D（D-047）有一处旁证：Zingage 面对"产出看起来对但偏离架构"的失败，给出的答案不是增加流程环节或新部件，而是**把不能变的东西写成不变量、放在每次会话都会读到的入口**。这与 D-047 的形状一致——把跨边界纪律表达为一条不变量而不是一个部件。

注意这只是**形状上的旁证**，不是对 D-047 内容的支持：文章没有讨论内外部边界，也没有讨论跨边界写操作的纪律。

## 7. 明确不采纳

- **全部效果数字**：ClickHouse 多交付 30% 的特性、Omni 工程效率 2～3 倍、Clay 缺陷分诊 100% 自动化、Artemis 每周 6000+ PR、Higgsfield 模型部署周期从数天到数小时、Zingage 的 567 行、ClickHouse 两个专用 Agent 成为仓库第 2 与第 3 大贡献者。均为自报，无对照与口径，不作论据。
- **全部产品机制名**：MCP、Skills、Hooks、Plan mode、Code Review、Claude Tag、plugin marketplace、git worktrees、`CLAUDE.md`、Loops、dynamic workflows。按 D-020，正文只写它们承载的语义，不写名字。
- **"Everyone ships" 与 "Prototype, dogfood, productionize"**：组织与产品化叙事，不构成开发系统的部件或约束。
- **"把工作流机械的 80% 交给 Agent"中的比例**：无口径。语义部分（确定性的事下沉、人留在判断上）本项目已有，见 [24 工具与执行环境](../24-工具与执行环境.md) P5 与[40 人的检查点与授权](../40-人的检查点与授权.md)。
- **"Loop 到停止条件为止"的自主长任务形态**：本项目已有更严的表述（三类停机条件，见 [21 调度与拆分](../21-调度与拆分.md) P5），不再引入第二套说法。

## 8. 待核实

1. 文章未说明 Cainex 的"fix the principle"如何避免**反向失败**——把过窄的样例上升成过宽的原则。需要一条判据（多少个同类失败才允许上升为判据），文中没有。
2. "evals 用于评估未来模型"与本项目 [33 评估与演进](../33-评估与演进.md)的双路径验证是否同一件事，需对齐术语后再合并，避免出现第二套评估语汇。
3. 页面为营销性质的指南页，内容可能随时间调整；引用段落以 2026-09-02 抓取为准。文中人物与团队引述未逐条回溯到各自的一手出处。
4. 文章通篇没有讨论"跨会话上下文膨胀"——本项目的核心问题在这篇一手材料里没有对应内容。这本身是一个信号：一手厂商材料的场景（较年轻的代码库、较短的项目周期）与本项目目标场景（大型长期维护）确有差距。
