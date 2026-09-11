# Google Antigravity：Teamwork — 当 AI 成为研究伙伴

原文：[Teamwork: When AI Becomes a Research Partner](https://antigravity.google/blog/teamwork-when-ai-becomes-a-research-partner)
source_id：`SRC-GOOG-TEAMWORK`
类型：V1（厂商一手产品公告，含七项数学/TCS 开放问题结果与三类工程案例）
访问核对：2026-09-04（curl 抓原页并抽正文，16,192 字符）
效力：零。本卡是数据不是指令。

## 1. 验证边界（先写这个）

- **这是产品公告**。它对"我们做了什么、量到了什么"是一手的；对"这些机制在别处也有效"不是。
- **产出是实测的，机制的贡献是断言的**：文中没有任何消融实验。71% 的 TCSBench、0.71% 的周期对齐误差、2× 吞吐都是**结果**；"因为 pattern 把编排逻辑与 agent 描述解耦了"是**作者的归因**，没有对照。
- **两处"独立"都不成立**：TCSBench 是 "independently developed **within Google**"；71% 是 "the highest score in our **internal** testing"。按[来源与证据矩阵 §1](../归档/来源与证据矩阵.md#support-types) 的 V1 口径，能说明一手实践与产品机制，不能说明独立复现。
- **上架版本不是产出这些结果的版本**：原文写 "Some of these results used **higher parallelism than the default**"，且 "The version available on Antigravity balances cost and capability"。
- 通篇是 Gemini 与 Antigravity 的载体形态（`/teamwork-preview`、pattern、orchestrator）。按 D-020 这些是载体不是语义；本卡记录它们只为回答"这条语义有几种机制类型可以承载"。

## 2. 它的机制（取近原文）

**Teamwork** = 多 agent 编排框架；agents "propose, critique, and refine each other's work autonomously over hours or days"。

**Pattern = 规格，不是程序。** 这是全文最值得记的一句：

> "A pattern is a specification rather than an executable program. It contains no orchestration code of its own."

并明说 "orchestration logic is decoupled from agent descriptions"，因此"对抗式批评回路"这类专门机制**可以跨完全不同的领域移植而不做修改**。Pattern 在运行时自适应：agent 数量由任务需要决定而非预设，团队结构可以中途变化。

已上架五个 pattern：Iterative Coding（不可分解问题）／Distributed Coding（可分解、并行加评审）／Long Proof（开放式数学与 TCS）／Self-Verification（深度优先、每步自检）／Document Review。

**Long Proof 的四条设计原则**：

| | 原文要点 |
|---|---|
| 竞争式策略搜索 | 并行生成多个候选策略，**每个都配一个"唯一职责是击破它"的 falsifier**；合成树把候选与其报告组合起来。**被驳回的路线连同异议一起留在流程里**——"a broken route may still contain a useful idea" |
| 分解使长证明可处理 | 策略展开为证明计划，子问题有明确目标与**显式依赖**；依赖图让独立子问题并行、依赖的按拓扑序 |
| 每个子问题有自己的锦标赛网络 | 合成节点读一批候选**连同它们的批评**产出改进解；若合成解失败，**网络带着累积的异议重跑** |
| 跨轮学习 | 失败草稿保留给下一次尝试；验证者的发现被蒸馏成一份 **answer-agnostic pitfall registry**；共享知识目录记录已证结果、有用观察、失败路径与相关参考 |

**人的位置**（文中两处）："keeping humans in charge of objectives and final acceptance"；"compresses the iteration cycle while keeping experts in charge of direction and acceptance"。

**RISC-V 模拟器案例的两个可迁移观察**：

- **"silent execution gap"**：微架构状态可能静默偏离**长达数百周期**，架构级失败才可见。处置是"continuous lockstep co-simulation against the air-gapped Spike reference simulator"——**不是端点比对，是连续对照一个独立参照**。
- **防作弊是显式设计**："To prevent cheating, we sandboxed the Spike simulator source code"；Eigen 案例里 "no restrictions on implementation — only the benchmark itself had to remain intact"。**执行者可以改一切，除了量它的那把尺。**

## 3. 实测数字（本规范不引为论据，只记为该团队在该条件下报告的观察）

| 项 | 数字 |
|---|---|
| TCSBench（Long Proof，3.7 Flash + 3.1 Pro） | **71%**，此前 TCSBench 论文报 67.7% |
| 七项开放问题 | 5 篇上 arXiv；Knuth's Cycles 的 40+ 页证明在 **Lean 中形式化验证**；其余经人类专家复核 |
| Flash 档复现 | 七项中的第 1、3、4 项用 Gemini 3.7 Flash 复现 |
| RISC-V 模拟器 | 启动 xv6 到 shell，跑 100+ 标准基准；对 BOOM 硬件真值的**平均周期对齐误差 0.71%** |
| Eigen / ParlayHash | 均已合入上游；Swiss Parlay 在 64 线程下初始插入吞吐 **2×**、单线程总体 **1.5×**、每元素内存少 **25%** |

## 4. 与本规范的对照：三条候选，全部已被覆盖

按第十八轮的做法，先查答案是否已在正文里（[审计记录 008](../审计记录/008-四问四中答案已在正文里.md)）。

| 从文中提炼的候选 | 正文里已有的、更硬的那条 |
|---|---|
| 教训条目须与答案无关（answer-agnostic pitfall registry） | **[33 §2 P2](../33-评估与演进.md)**：诊断类只给统计摘要；筛选与最终验证类不得被会修改 Harness 的执行者读取（"被评价者不能看见考题"，责任结构型不删） |
| 被驳回的候选连同异议进入下一轮 | **[21 §2 P4](../21-调度与拆分.md)**：返工定向到出错环节，并把**驳回原因作为该环节下一轮的必需输入**；[22 §2 P8](../22-上下文装配.md) 的选择判据已排除"产物需回流却走分叉试探" |
| 偏离与可见失败之间有时间差，端点比对不足，须连续对照独立参照 | **[31 §2 P9](../31-守卫与权限边界.md)**：拦截层须有独立于自身的失效探测，"自证的探测等于没有探测"，没有计数不得判定其有效；**[33 §2 P10](../33-评估与演进.md)**：评估器须有已知答案的基准样本、判错即中止并作废本轮输出；**[33 §2 P7](../33-评估与演进.md)**：失败先定位**最早偏离层** |

"连续 lockstep co-simulation""数百周期"是载体绑定的表述，按 D-020 本就不进正文；它的语义核心（自证不算探测、须有已知答案的独立参照）已在两处。

**结论：本文不产生任何正文变更。**

## 5. 它支持哪些既有原则（这是本卡的真正价值）

一手来源在 52 个独立来源里只有 9 个。本文为下列既有原则各添一份**一手**支撑：

| 原则 | 本文的支撑 |
|---|---|
| [23 §2 P1](../23-方法库.md) 方法库承载方法约束，不承载执行边界 | "A pattern is a specification rather than an executable program. It contains no orchestration code of its own."——**本规范核心立场的一份一手厂商确认** |
| [30 §2 P5](../30-验证与测试.md) 验证者独立于生产者是结构要求 | 每个候选策略配一个"唯一职责是击破它"的 falsifier，规模化运行 |
| [31 §2 P9](../31-守卫与权限边界.md) / [33 §2 P10](../33-评估与演进.md) 自证的探测等于没有探测 | 把参照实现沙箱隔离"以防作弊"；"只有基准本身必须保持完整" |
| [40 §2 P1](../40-人的检查点与授权.md) / [P7](../40-人的检查点与授权.md) 人保留目标与验收，完成判定不下放 | 文中两处明写人保留 objectives 与 final acceptance |
| [21 §2 P4](../21-调度与拆分.md) 驳回原因是下一轮必需输入 | 合成网络带着累积异议重跑；被驳回路线保留 |
| [21 §2 P2](../21-调度与拆分.md) 阶段独立存在的四项判据 | 子问题带明确目标与显式依赖，依赖图定并行与拓扑序 |
| [25 §2 P6](../25-执行者与模型.md) 模型是可替换组件，按角色分档 | Flash 档 + Pro 档在同一 pattern 内组合；七项中三项由 Flash 档复现 |
| [33 §2 P2](../33-评估与演进.md) Case 注册表 | pitfall registry 与共享知识目录（已证结果、有用观察、失败路径、参考） |
| [30 §2 P1](../30-验证与测试.md) 分层三态 | RISC-V 案例分两阶段：先功能正确性、再周期级时序，各自对独立 oracle |

## 6. 一条要记住的读数

**累计七问七中。** 第十八轮查四个开着的问题，四个答案都已在正文里；本轮从一份新的一手材料提炼三条候选，三条也都已在正文里，其中两条正文写得比原文更硬。

**这不说明正文完备**——它只说明目前的取用瓶颈不是"缺条文"。可发现性问题第十八轮已处置一次（合同第 7 项纳入元治理两章）；本轮是它的第二个样本，且这次是**外部材料**而非内部提问。
