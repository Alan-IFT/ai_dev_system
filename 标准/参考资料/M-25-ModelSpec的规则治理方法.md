# M-25 · Model Spec 的规则治理方法：整卡佐证，不新增条款

- 原题：《Inside our approach to the Model Spec》（OpenAI），署名 Jason Wolfe。
- 类型：**V1 厂商一手**——厂商讲自家行为规范文档的结构、写法与修订机制，转述层数 0。它讲的是**规则文档的治理方法**，不是工程实践；对本标准的价值是与 01 若干条款的方法论对照，不是失败依据。
- URL：`https://openai.com/index/our-approach-to-the-model-spec`。发布日期：页面所示 March 25, 2026。访问日：2026-09-09（读本地落盘全文，抓取头行声明 DECLARED_LEN 与 CAPTURED_LEN 相等）。
- 实际阅读范围：全文。**未读**：Model Spec 本身、Model Spec Evals 的配套博客与评测集、文中链接的各条款（Stay in bounds、Red-line principles 等）、按章节的合规率图表（只读到图注）。

## 原文结论与适用限制

与 01 有对应关系的方法论，共六条：

1. **规则文本刻意超前现状**："usually aiming somewhere around 0-3 months ahead of the present"（中译：通常瞄在当下之后 0～3 个月）；"Model training may lag behind Model Spec updates."文档"is not a claim that our models already behave this way perfectly today"（中译：不是在宣称我们的模型今天已经完全这样做了）。
2. **硬规则与可覆盖默认分层**：链式指挥给每条政策与每条指令一个权威级别；"a relatively small set of non-overridable rules alongside a larger set of defaults"（中译：一小组不可覆盖的规则，加一大组默认值）；用户级默认（真实性、客观性）只能由显式指令覆盖，"shouldn't quietly drift based on vibes"（中译：不应凭感觉悄悄漂移）。
3. **有些规则是在补当期模型的能力缺口，模型变强后到期**："some policies aim to compensate for insufficient intelligence, where models might not reliably derive the correct behavior from higher-level principles"（中译：有些政策是为了补智能不足——模型未必能从高层原则可靠地推出正确行为），并举例：早期版本要求先展示推理再给答案，"but today our models naturally learn this behavior through reinforcement learning"（中译：但今天我们的模型通过强化学习自然学会了这一行为）；"Although this is becoming less true over time"（中译：尽管这一点随时间越来越不成立）。**另一类**是补运行时上下文不足："Other policies address limited context at runtime: the assistant can only rely on what's observable in the current interaction, and rarely knows the user's full situation, intent, downstream use, or what safeguards exist outside the model."（中译：另一些政策针对运行时上下文有限——助手只能依赖当前交互里可观察到的东西，很少知道用户的全貌、意图、下游用途，或模型之外存在什么保障。）
4. **每条断言配场景评测**：随文发布 Model Spec Evals——"a scenario-based evaluation suite that attempts to cover as many assertions in the Model Spec as possible with a small number of representative examples"（中译：一套基于场景的评测，试图用少量代表性样例覆盖尽可能多的规范断言）；用它追踪行为与规范的偏离，并检查模型对规范的解读是否如作者所愿。
5. **让分歧具体而不是用讨喜措辞掩盖**："The Model Spec should sharpen disagreements, not hide them behind agreeable language."（中译：规范应当让分歧更锋利，而不是把它们藏在讨喜的措辞后面。）要显式指出规则间的潜在冲突并给出解法；作者的经验："real consensus is often possible—especially when we force ourselves to write down the tradeoffs precisely enough that disagreements become concrete."（中译：真正的共识常常是可能的——尤其当我们逼自己把取舍写得足够精确、让分歧变得具体的时候。）
6. **修订由四类输入驱动**：公开问题与反馈；内部问题（开发测试中看到的模式，含"不同合理解读导致不同行为"的歧义）；行为与安全政策更新；新能力与新产品。行为与规范不一致时"we treat it as a serious bug—by working either to adjust behavior or the Model Spec to bring them into alignment."（中译：我们把它当严重 bug——要么调行为、要么调规范，让二者对齐。）

其他：文档是"an interface, not an implementation"（中译：是接口，不是实现），避免绑定实现细节；主要读者是人不是模型；例子数量刻意少、只留信息量最大的；成功判据三条——Legibility、Actionability、Revisability；任何员工可提修改，由跨职能的一组人批准。

适用限制：

- 对象是**模型行为规范**，不是软件项目的管理规范；其"规则"约束的是模型的输出行为，其"评测"是模型行为评测。迁移到 01 只能在方法层（规则怎么写、怎么绑依据、怎么到期、怎么评）。
- 全文无失败案例、无数据；合规率图表是该厂商对自家模型的测量，且作者自承有"a small effect due to measuring older models against more recent policies"（中译：用较新政策去测较旧模型带来的小幅效应）。
- "0～3 个月超前"是该组织的节奏参数，不迁移。

## 缺口与逐条落点核对

按主执行者的预判，本卡预设为整卡佐证。逐条核对 01 是否已覆盖：

| 原文方法 | 01 对应 | 结论 |
|---|---|---|
| 规则文本超前现状 | §0"本文是候选实现，效力为零"；§3.5 `draft` 不产生约束 / `active` 才有效；[§5.6](../01-项目管理标准.md#gates) 约束/提醒二分——没有执行点的规则是提醒 | **已覆盖**：01 用状态字段与执行点二分表达"写在前、生效在后"，不需要另设"超前期"概念 |
| 硬规则与可覆盖默认分层 | §0"必须/建议/参数"三档；[03 §6.1](../03-Agent信息获取与上下文管理.md#source-trust) 指令权威表禁止低层文件覆盖上层边界；[§5.5](../01-项目管理标准.md#controlled-actions) 本轮由 O-18 补的"授权分层：下层只能收窄不能放宽" | **已覆盖**；本文是"上层不可覆盖、下层可覆盖且只能显式覆盖"的第二个一手来源 |
| 补能力缺口的规则到期 vs 补运行时上下文的规则不到期 | [N3](../01-项目管理标准.md#discipline-n3) 依据类型二分（补当期工具或模型的能力缺口 → 随换代进到期队列；组织特有的事实与责任边界 → 不因工具变强而复查）；[§4.7](../01-项目管理标准.md#maintenance-budget)"每次模型换代"行 | **已覆盖，且对应关系精确**：原文的"insufficient intelligence"对应 N3 第一类，"limited context at runtime（模型不知道用户全貌、不知道模型外有什么保障）"对应 N3 第二类。这是 [M-11](M-11-脚手架的到期与保值.md) 之外的第二个一手来源，且来自不同厂商。补引 |
| 每条断言配场景评测 | G5 约束可检查、§1"每条附检查方式"；[03 §11.1](../03-Agent信息获取与上下文管理.md#context-evals) 新增规则须证明增量 | **已覆盖**；由 C 方向决定是否在 03 补引 |
| 让分歧具体 | [§3.6](../01-项目管理标准.md#conflict)"每条规则写明适用范围与例外，冲突在写入那一刻消除"（M-09）；[§4.4](../01-项目管理标准.md#review-flow)"把待裁事项、支持证据与建议结论前置" | **已覆盖**；补引 |
| 四类修订输入 | §4.7 各行触发（候选区、FAILURES、模型换代、标准升级）；§4.6 复盘行动进工作项 | **已覆盖** |
| 行为与规范不一致：改行为或改规范 | §3.6"代码与文档不符时不自动以代码为准……谁对由主张的归属人裁" | **已覆盖** |
| 接口不是实现 | [§8](../01-项目管理标准.md#adoption)"只迁移判据与方法"；本仓库"正文只写语义不变量"的写作规则 | **已覆盖** |
| 例子少而精 | N3"修订作用于判据，不把样例编码进规则" | 方向一致但不同：原文把少量例子留在规范里作解释性辅助，01 不把样例写进规则。记为形态差异，不改 |

核对结论：**无 01 缺口，不新增条款**。两处补引（N3 依据类型、§3.6 冲突具体化）。

## 采纳

- 无新增条款。补引两处：[N3](../01-项目管理标准.md#discipline-n3) 依据类型句末补 M-25 为第二个一手来源；[§3.6](../01-项目管理标准.md#conflict)"冲突在写入那一刻消除"句末补 M-25。均为佐证，不改既有文字的语义。
- 因无采纳条款，本卡不含逐条的触发、责任、可定位工件、验收/失败处置、失败依据、复查/删除条件字段；这些字段随被补引的 N3 与 §3.6 既有条款走（其依据分别是 M-11 与 M-09），本卡不另立。补引本身的验收见下文"验证办法"。

## 不采纳

- "0～3 个月超前"：节奏参数。
- 链式指挥的具体权威级别、根/系统/开发者/用户各级：模型行为规范的结构，01 的对应物是"必须/建议/参数"与 03 §6.1，不复制一套。
- 决策评分表与示例对：模型行为规范的解释性辅助；01 N3 明确不把样例编码进规则。
- 合规率图表：厂商对自家模型的测量，不进正文。
- "Legibility / Actionability / Revisability"三判据：与 G5/G9 同义，不另立。
- 开放的内部贡献与跨职能批准：01 §6.1 写入角色已有"授权起草、批准不转移"，不复写。

## 跨方向建议（不由本方向修改）

- 给 **03 §11.1**：本文是"每条规则断言配场景评测、用少量代表性用例覆盖尽可能多的断言"的一手来源，可与 C-04/C-13 并列引用；同时它自承评测集"only one part of a broader evaluation strategy"，与 §11.1"用于挑选改动的用例集与最终验证用例集分离"不冲突。
- 给 **03 §6.1**：本文"用户级默认只能由显式指令覆盖、不能静默漂移"是指令权威表的又一来源。

## 验证办法

本卡无新增条款，验证只针对补引：核对 N3 与 §3.6 的引用指向本卡且本卡"缺口与逐条落点核对"表里对应行存在。已自查。

## 逐篇闭环

上一篇 M-24 已落 01 §4.3/§4.4/§4.5。本篇：01 不新增条款，N3 与 §3.6 各补一处引用。无新增小节，无锚点变动。断点：Model Spec 与 Model Spec Evals 本体未读，本卡只据这篇方法文；合规率图表未看。本波五篇至此闭环；由其他方向跨落到 01 的条款（O-16/O-17/O-18/O-19/C-20）与本波各卡的 01 改动一并完成，落点见 01 各节引用。
