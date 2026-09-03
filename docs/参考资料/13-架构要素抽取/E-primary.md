# 批次 E：前三轮一手与附件材料 —— 架构要素抽取

批次范围：SRC-OAI-HARNESS、SRC-ANT-LONG、SRC-ANT-CTX、SRC-OAI-EVAL、SRC-ANT-AGENTS、SRC-COALA、SRC-BORIS（卡片 01/02/03/04/05/07/08）；ATT-A～D（按 09 卡片 + 输入材料 002 分别抽取）；INP-001（输入材料 001，用户初始资料，矩阵中无 source_id，本文暂记 INP-001）；USR-OBS-12（用户 12 条一线观察，09 卡片 §"12 条观察" + 002 §6）。共 **13 个来源**。

核对说明：01/02/03/04/05 已用 WebFetch 回到官方一手页面核对部件名与关系（2026-09-02）；07 回到 arXiv 摘要页核对；08 为视频访谈，仅依卡片；ATT-A～D 原文不在仓库，只依卡片转述（证据形态一律标"卡片转述"）。所有数字只作该来源自述，不做外推。

---

### SRC-OAI-HARNESS  OpenAI: Harness Engineering（类型：V1；场景：编码 Agent / 内部绿地项目，3→7 名工程师）
- **部件清单**：
  - `AGENTS.md`（约 100 行"目录/地图"）→ 上下文装配（入口清单）
  - `docs/` "system of record"（design-docs/core-beliefs.md、product-specs、references、ARCHITECTURE/DESIGN/SECURITY/RELIABILITY.md 等）→ 项目知识；同时是 ★事实溯源（仓库内版本化文档 = 事实记录）
  - `docs/product-specs/` → 意图与验收
  - `docs/exec-plans/active|completed/`、`tech-debt-tracker.md` → 状态工件
  - `docs/generated/db-schema.md`（机器生成）→ 代码地图（近似：机器生成的仓库事实）
  - `QUALITY_SCORE.md`、doc-gardening agent、background cleanup Codex tasks、"garbage collection" → 评估与演进（熵清理）
  - custom linters、structural tests（依赖方向）、docs 覆盖/新鲜度/owner/交叉链接机械检查、"minimal blocking merge gates" → 拦截与守卫
  - 分层域模型（Types→Config→Repo→Service→Runtime→UI）+ Providers 单一接口、文件大小上限、命名约定 → 项目知识（架构不变量，以机械规则执行）
  - git worktree（每变更一实例）→ 工具与执行环境 + 权限与边界（工作区隔离）
  - Chrome DevTools Protocol + DOM 快照/截图 skills → 工具与执行环境 + 验证与测试；skills → Skill/方法库
  - 本地 observability stack（Vector、Victoria Logs/Metrics/Traces，LogQL/PromQL）+ structured logging → 证据与追踪
  - Codex 实例（GPT-5）、agent-to-agent review、自行 squash-merge → 执行者 + 验证与测试（评审）
  - 人类 review 可选、人类反馈被"编码为 docs 或 tooling"、"human time and attention" → 人
  - 模型：GPT-5 / Codex → 模型
- **部件关系**（文中明确）：AGENTS.md → 引用 docs/（数据）；docs/ → Codex 实例（数据）；Codex → CDP 驱动应用并回读快照（数据/验证）；Codex → 查询 observability（数据）；linters/structural tests → 校验产出并"把修复指令注入 agent 上下文"（控制）；agent-to-agent review → 合并（控制）；后台清理 agent → 扫描偏离 golden principles → 更新 QUALITY_SCORE.md → 开 refactor PR（触发）；人类反馈 → 编码为 docs/tooling（数据）。
- **不可省略**："The constraints are what allows speed without decay or architectural drift"；"Agents are most effective in environments with strict boundaries and predictable structure"；"Our one truly scarce resource: human time and attention"；"the discipline shows up more in the scaffolding rather than the code"。
- **分层 / 演进**：六段成长：空仓库脚手架 → 环境欠规范导致慢 → AGENTS.md 单体改为 docs/ 知识库 → 应用可读性（CDP + 可观测栈）→ 熵管理（周五 20% 人工清理 → 自动化）→ 端到端自治（仅判断类事项升级到人）。
- **失败归因**：早期慢 → "environment was underspecified"（工具与执行环境/项目知识缺失）；单体 AGENTS.md 失败 → "Too much guidance becomes non-guidance… It rots instantly"（上下文装配/项目知识失守）；架构漂移 → 缺"strict boundaries"，依赖人的品味未编码（拦截与守卫缺失）；Agent 复制不均匀模式导致漂移（拦截缺失）；QA 瓶颈 → 应用对 Agent 不可读（证据与追踪/验证缺失）；人工清理不可持续（评估与演进未自动化）。
- **证据形态**：一手工程报告 + 3 张概念架构图（CDP 验证回路、可观测栈回路、分层域架构）；自述数字：5 个月、约 100 万行、约 1500 PR、3.5 PR/人/日、单次运行 6 小时以上；无对照实验。

---

### SRC-ANT-LONG  Anthropic: Effective Harnesses for Long-Running Agents（类型：V1；场景：编码 Agent / 全栈 Web，claude.ai 克隆实验）
- **部件清单**：
  - initializer agent（首会话）与 coding agent（后续会话）→ 执行者（两种角色）
  - Claude Agent SDK 跨多个上下文窗口的循环；"一次只做一个特性" → 任务拆分与调度
  - `init.sh`（启动开发服务器）→ 工具与执行环境
  - feature list JSON（200+ 端到端特性，初始全部 failing，只允许改 passes 字段）→ 意图与验收 + 状态工件
  - `claude-progress.txt`（Agent 行为日志）→ 状态工件
  - git commit / `git log --oneline -20` → 状态工件 + 证据与追踪
  - Puppeteer MCP server（像用户一样端到端测试、截图）→ 工具与执行环境 + 验证与测试
  - 会话启动清单（pwd → 读进度文件 → git log → 运行 init.sh → 基本功能验证）→ 上下文装配（恢复）+ 验证与测试
  - context compaction（被判定不足）→ 上下文装配
  - 模型：Opus 4.5 → 模型
- **部件关系**：initializer → 生成 init.sh / feature list / progress / 初始 commit（数据）；coding agent 启动时读 git log + progress（数据）→ 从 feature list 选一条未完成特性（控制）→ 运行 init.sh 验证环境（触发）→ Puppeteer 端到端验证（验证）→ commit + 更新 progress + 改 passes 字段（数据）→ 下一会话。
- **不可省略**："The key insight… finding a way for agents to quickly understand the state of work when starting with a fresh context window… accomplished with the claude-progress.txt file alongside the git history"；增量工作是"critical"；"essential that the model leaves the environment in a clean state"；"Compaction isn't sufficient"。
- **分层 / 演进**：两阶段：Stage 1 initializer 会话（扩展提示为完整特性清单并搭环境）→ Stage 2+ 每个 coding 会话同构（验证 → 单特性 → 提交 → 记录）。
- **失败归因**：过早宣布全项目完成 → 无完成标准可见（意图与验收/状态工件缺失）；环境留 bug 或进度未记录 → 无状态延续机制（状态工件缺失）；特性被过早标完成 → 验证不足（验证与测试缺失）；一次做完整个 app → 无增量引导（任务拆分缺失）；端到端失败不可见 → 单元测试不够（验证与测试）；Puppeteer 看不到浏览器原生 alert → 依赖该模态的特性更多 bug（工具与执行环境盲区）。
- **证据形态**：一手工程文章 + Puppeteer 截图 + 会话消息示例代码块；有实验（Opus 4.5 + Agent SDK 循环 vs 仅高层提示的对比描述），无量化对照数据。

---

### SRC-ANT-CTX  Anthropic: Effective Context Engineering for AI Agents（类型：V1；场景：通用 Agent / 编码 Agent（Claude Code 示例））
- **部件清单**：
  - system prompt、tools、examples（few-shot）、message history、MCP → 上下文装配（上下文组成）；tools/MCP → 工具与执行环境
  - context window / "attention budget" → 模型
  - `CLAUDE.md`（启动即载入）→ 项目知识 + 上下文装配
  - glob/grep、agentic search、轻量标识符（路径/查询/链接）JIT 加载 → 上下文装配（检索）
  - compaction（摘要历史 + 最近 5 个文件）→ 上下文装配（压缩）
  - structured note-taking / `NOTES.md` / to-do list / memory tool → 状态工件 + 长期记忆
  - sub-agent 架构（lead agent + 专用子 Agent，回传 1–2k token 摘要）→ 任务拆分与调度 + 执行者
  - system prompt "altitude"（Goldilocks zone）→ Skill/方法库（指令层）
- **部件关系**：子 Agent → lead agent（压缩摘要，数据）；notes 写出上下文窗口外 → 后续被拉回（数据）；compaction 保留架构决策/未解 bug/实现细节、丢弃冗余工具输出（控制）；工具 → 拉取新上下文（数据）。
- **不可省略**："Context is a critical but finite resource"；目标是"the smallest possible set of high-signal tokens"；"Tool definitions… as much prompt engineering attention"（明确要求工具集小而清晰）。
- **分层 / 演进**："context engineering as the natural progression of prompt engineering"；随模型增强"progressively less human curation"；三类长任务策略并列：compaction / structured note-taking / sub-agent。
- **失败归因**：context rot → token 过多（上下文装配失守）；Agent 低效 → "bloated tool sets… ambiguous decision points"（工具与执行环境失守）；脆弱行为 → prompt 中硬编码复杂逻辑；指引无效 → 过于笼统；边界案例清单塞满 prompt；过度激进 compaction 丢失后来才显重要的上下文；运行时探索慢、误用工具、追死胡同。
- **证据形态**：一手工程文章 + 2 张示意图（prompt vs context engineering；system prompt 校准光谱）；示例：Claude Code 混合策略、Claude 玩 Pokémon 的笔记、多 Agent 研究系统；无本篇独立实测数字。

---

### SRC-OAI-EVAL  OpenAI: Evaluate Agent Workflows（类型：V1；场景：Agent workflow 评估 / 平台产品指南）
- **部件清单**：
  - traces（"end-to-end record of model calls, tool calls, guardrails, and handoffs for one run"）、spans、Logs > Traces dashboard → 证据与追踪
  - trace grading、graders（结构化标准）、datasets、eval runs → 评估与演进
  - guardrails（被 trace 记录）→ 拦截与守卫
  - handoffs（路由事件）→ 任务拆分与调度
  - tool calls → 工具与执行环境
  - Agents SDK 工作流 → 执行者
- **部件关系**：Agents SDK 运行 → 产生 traces（数据）→ graders 打分（控制）→ "Once you know what 'good' looks like" → 转为 datasets + eval runs（数据）→ 对比 prompt/路由变更（控制）。
- **不可省略**："Trace grading is the fastest way to identify workflow-level issues"（调试阶段先看 trace）；需要可重复时才进入 dataset/eval run。
- **分层 / 演进**：三段：trace grading（调试）→ datasets & eval runs（可重复/基准）→ 外部模型 grader/批量评估。
- **失败归因**：工具选错、该 handoff 未 handoff、违反指令/安全策略、prompt 或路由变更引起回归 → 均通过 trace 定位（证据与追踪是定位前提）。
- **证据形态**：官方产品文档，纯文字，无图、无数据。

---

### SRC-ANT-AGENTS  Anthropic: Building Effective Agents（类型：V1；场景：通用 Agent 模式指南，含编码 Agent 与客服示例）
- **部件清单**：
  - augmented LLM（retrieval + tools + memory）→ 模型 + 上下文装配 + 工具与执行环境 + 长期记忆
  - workflows：prompt chaining（含 programmatic gate）、routing、parallelization（sectioning/voting）、orchestrator-workers、evaluator-optimizer → 任务拆分与调度；gate → 拦截与守卫；evaluator → 验证与测试
  - autonomous agent（模型自主决定过程与工具）→ 执行者
  - 环境 "ground truth"（工具结果、代码执行）、tests → 验证与测试
  - checkpoints / blockers 处暂停要人类反馈 → 人
  - sandboxed environments、guardrails → 权限与边界
  - ACI（agent-computer interface）、工具文档与测试、绝对路径约束 → 工具与执行环境
  - "High-level flow of a coding agent" 图 → 任务拆分与调度（编码 Agent 流程）
- **部件关系**：链式步骤输出 → gate 校验 → 下一步（控制）；orchestrator → workers 分发并综合（控制/数据）；evaluator → generator 反馈循环（控制）；环境 → agent ground truth（数据）；agent → 人（checkpoint 触发）。
- **不可省略**："finding the simplest solution possible"；"it's crucial for the agents to gain 'ground truth' from the environment at each step"；"Tool definitions… just as much prompt engineering attention"；三原则：simplicity / transparency（展示规划步骤）/ carefully craft ACI。
- **分层 / 演进**：复杂度阶梯：augmented LLM → workflows（chaining→routing→parallel→orchestrator-workers→evaluator-optimizer）→ autonomous agents；"add multi-step agentic systems only when simpler solutions fall short"。
- **失败归因**：自治 → 成本高与"compounding errors"（执行者失控，需 guardrails/sandbox）；相对路径出错 → 工具接口设计（工具与执行环境）；diff 格式要求预知行数 → 工具格式；框架多层抽象遮蔽 prompt/响应难调试（证据与追踪弱化）。
- **证据形态**：一手模式指南 + 8 张图（augmented LLM、5 种 workflow、autonomous agent、coding agent 流程）；无量化数据，仅引用 SWE-bench 可解与客服计费模式。

---

### SRC-COALA  CoALA: Cognitive Architectures for Language Agents（类型：A2；场景：语言 Agent 概念框架）
- **部件清单**：
  - working memory → 上下文装配；episodic / semantic memory → 长期记忆；procedural memory → Skill/方法库
  - internal actions：reasoning、retrieval（→ 上下文装配）、learning（→ 评估与演进）；external actions：grounding → 工具与执行环境
  - decision cycle：planning（proposal / evaluation / selection）→ execution → 任务拆分与调度
  - LLM → 模型
- **部件关系**：决策循环中 retrieval 把长期记忆读入 working memory（数据）；reasoning 更新 working memory；learning 写回长期记忆（数据）；grounding 与环境交互并把反馈写入 working memory（数据）。
- **不可省略**：无"不可省略"表述；摘要仅声明"modular memory components, a structured action space… and a generalized decision-making process"。
- **分层 / 演进**：记忆四分 + 行动内/外二分 + 决策循环三段（概念分层，非成长阶段）。
- **失败归因**：无（概念框架，不做失败归因）。
- **证据形态**：同行评审概念框架，架构示意图（论文内），无实测。

---

### SRC-BORIS  Boris Cherny: We Cut 80% of Claude Code's Prompt（类型：P1/V1；场景：编码 Agent 产品团队）
- **部件清单**：
  - system prompt、工具说明、Harness 补丁（模型升级后成噪声，删 80%）→ Skill/方法库 + 上下文装配
  - 消融（ablation）+ 真实任务验证 + 失败反馈 → 评估与演进 + 验证与测试
  - 长时间开放任务 vs 周期性例行任务两种工作方式 → 任务拆分与调度
  - 模型升级 → 模型；Claude Code → 执行者
- **部件关系**：模型升级（触发）→ 消融 prompt/工具说明/补丁（控制）→ 真实任务验证与失败反馈决定保留（数据）。
- **不可省略**：卡片转述："与其持续堆 prompt，更重要的是对真实任务建立验证和失败反馈"（验证与评估先于 prompt 堆砌）。
- **分层 / 演进**：模型代际升级 → 删减 → 按失败加回（循环）。
- **失败归因**：旧 prompt/工具说明/补丁在新模型下成噪声（Skill/方法库与上下文装配失守，未随模型清理）。
- **证据形态**：视频访谈，文字转述；无公开 Case、对照组或 grader。

---

### ATT-A  用户附件：交付链（类型：P1；场景：编码 Agent / 私有项目交付）
- **部件清单**（依 09 卡片与 002 §2）：
  - 可信事实 /"事实供应链"，结论携带来源、revision、scope、环境、时间；四个现场（代码、契约、部署、运行）→ 项目知识 + ★事实溯源
  - 文档 / Rule（讲意图）→ 项目知识 + Skill/方法库
  - 脚本（判断事实）、可执行约束 → 拦截与守卫
  - Gate（阻断阶段或危险动作）→ 拦截与守卫 + 权限与边界
  - State（书签）、文档（任务正文）、Workflow（阶段交接协议）→ 状态工件 + 任务拆分与调度
  - 现实验收证据 → 验证与测试 + 证据与追踪
  - 真实任务基线 + Add/Thin → 评估与演进
- **部件关系**：文档/Rule 提供意图 → 脚本判断事实 → Gate 阻断（控制链）；State 指向文档正文（数据）；Workflow 在阶段间交接 State（控制）；真实失败 → Add/Thin Harness（触发）。
- **不可省略**："代码不是交付；可信上下文、可执行约束、可恢复流程共同构成 Harness"（三者并列为交付链构成）。
- **分层 / 演进**：意图（文档/Rule）→ 事实判断（脚本）→ 阻断（Gate）三级；Add/Thin 循环。
- **失败归因**：卡片未给具体失败案例；隐含：只交付代码而无可信事实/约束/状态则不算交付。
- **证据形态**：卡片转述，原文不在仓库；私有案例效果未公开。

---

### ATT-B  用户附件：Context Engineering 综合教程（类型：S1；场景：通用 Agent 上下文）
- **部件清单**（依 09 卡片与 002 §3）：
  - 七类上下文：提示词、历史、状态、记忆、检索、工具、输出约束 → 上下文装配（总）；其中状态 → 状态工件；记忆 → 长期记忆；工具 → 工具与执行环境
  - compaction、结构化笔记、子 Agent 三类长任务方法 → 上下文装配 / 状态工件 / 任务拆分与调度 + 执行者
  - JIT、渐进披露、工具边界、工具返回治理 → 上下文装配 + 工具与执行环境
- **部件关系**：子 Agent 回传摘要给主 Agent（数据，与 SRC-ANT-CTX 同）；笔记外置后按需拉回（数据）。
- **不可省略**：卡片未标；反模式清单侧面指出"避免全量加载和工具输出常驻"。
- **分层 / 演进**：Prompt → ReAct 行动循环 → Context Engineering 三层关注面。
- **失败归因**：全量加载、工具过多、规则枚举、原始输出常驻（上下文装配与工具返回治理失守）。
- **证据形态**：二手综合教程，卡片转述；固定比例/Token 估算/准确率数字不采信。

---

### ATT-C  用户附件：跨工具个人记忆（类型：P1；场景：个人 / 跨 AI 工具）
- **部件清单**（依 09 卡片与 002 §4）：
  - 用户拥有、跨工具的个人记忆；五层记忆（稳定身份/原则 vs 动态偏好/上下文/知识）→ 长期记忆
  - 短索引路由正文、条目携带状态/隐私/标签/时间、两级目录 → 上下文装配（索引）+ 长期记忆
  - 审核、过期、归档、冲突处理、跨工具同步 → 长期记忆（治理）
  - 经验晋升为技能（需本人确认）→ Skill/方法库 + 人
  - 个人记忆 / 项目知识 / 团队资产分权 → 权限与边界
- **部件关系**：索引 → 正文（数据，按需）；经验 → 本人确认 → 技能（控制/触发）；本人确认 → 写入记忆（控制）。
- **不可省略**：卡片转述："记忆应由用户拥有，避免绑定单一 AI 工具"；"写入和晋升需要本人确认"。
- **分层 / 演进**：五层记忆分层；记忆 → 技能晋升路径。
- **失败归因**：未分权导致项目事实复制到个人记忆形成第二权威（长期记忆与项目知识边界失守，卡片"修正"段）。
- **证据形态**：个人实践，卡片转述。

---

### ATT-D  用户附件：反馈分类 Harness（类型：P1；场景：企业业务分类 / 非编码 Agent）
- **部件清单**（依 09 卡片与 002 §5）：
  - 业务定义方向 → 意图与验收 + 人
  - 控制强度梯度：确定规则 / 范围限制 / 优先推荐 / 语义判断 → 拦截与守卫（确定规则由系统稳定执行）+ Skill/方法库（推荐/限制）+ 模型（剩余语义不确定性）
  - taxonomy、规则、Few-shot、评测数据版本绑定 → 项目知识 + ★事实溯源 + 评估与演进
  - 离线回归、灰度、线上观察、回滚 → 评估与演进
  - 不确定 / 人工升级出口 → 人
- **部件关系**：业务方向（人）→ 规则（系统执行）→ 模型处理剩余（控制梯度）；规则/数据变更 → 回归 → 灰度 → 观察 → 回滚（触发链）；不确定 → 人工升级（触发）。
- **不可省略**：卡片转述："业务定义方向，确定规则由系统稳定执行，模型处理剩余语义不确定性"；"规则必须有不确定和人工升级出口"。
- **分层 / 演进**：控制强度四级梯度。
- **失败归因**：错误范围限制会排除正确答案（拦截与守卫误伤）；准确率提升无消融不能归因。
- **证据形态**：卡片转述；60%/90% 数字无公开数据集与消融。

---

### INP-001  输入材料 001：用户提供的初始资料（类型：S1/P1 汇总；场景：编码 Agent / 个人-小团队项目）
- **部件清单**：
  - PRD（功能列表、用户流程、页面清单、每功能完成定义/验收标准）、视觉与页面框架（Figma/墨刀）→ 意图与验收
  - 项目边界与非功能需求（安全/性能/可用性/成本）、锁定技术栈（可测试、可入 CI、社区活跃）→ 项目知识 + 工具与执行环境
  - 轻量架构草案 + 每次记录更新原因 → 项目知识（ADR）
  - PRD / 架构 / 项目状态三份文档，会话开始提供 → 上下文装配 + 状态工件
  - 开发规范、参考资料目录、语言/命名/文件大小规则 → Skill/方法库 + 项目知识
  - Git + 质量闸门（写代码前建立）→ 拦截与守卫 + 状态工件
  - 人类负责边界和验收、AI 负责体力工作 → 人 + 执行者
  - 小步迭代、端到端切片、主动拆模块 → 任务拆分与调度
  - 状态摘要管理、限制 AI 擅自做主 → 状态工件 + 权限与边界
  - 密钥不进入前端 → 权限与边界
  - "两次没有新证据就停止重复尝试" → Skill/方法库（止损规则）
- **部件关系**：需求 → AI 整理 PRD → 验收标准（数据/控制）；三份文档 → 会话开始供 AI 熟悉项目（数据）；架构草案迭代 → 记录原因（数据）；Git + 闸门先于代码（触发顺序）。
- **不可省略**："定图纸，避免 AI 边写功能边倒推 UI"（先 PRD）；"写代码前建立 Git 和质量闸门"；"人类负责边界和验收"。
- **分层 / 演进**：开发前准备三步：定图纸 → 打地基 → 立规矩；开发中六条要点。
- **失败归因**：边写功能边倒推 UI → 缺图纸（意图与验收缺失）；代码聚成一坨 → 未拆模块（任务拆分）；重复无效尝试 → 缺止损规则。
- **证据形态**：用户汇总的外部资料，纯文字要点，无实测。

---

### USR-OBS-12  用户 12 条一线观察（类型：P1；场景：个人 / 团队 / 组织提效）
- **部件清单**：
  - 人类判断：目标、权限、风险接受、验收的 owner；风险分级 Review；专业责任不转移 → 人 + 权限与边界
  - 问题定义与验收（"一头一尾难"）→ 意图与验收
  - 最小充分 Prompt，由失败和 eval 驱动增删 → Skill/方法库 + 上下文装配 + 评估与演进
  - 确定性任务用普通程序/工具 → 工具与执行环境
  - 隐性知识显式化，保留来源、owner、审核；知识库重点在知识质量 → 项目知识 + ★事实溯源 + 人
  - 独立证据 → 证据与追踪 / 验证与测试
  - 评估分层（个人/团队/业务）、Bottom-up 从真实任务和失败中积累 → 评估与演进
- **部件关系**：真实任务/失败 → 团队资产（触发，bottom-up）；知识写入 → 来源/owner/审核（控制）。
- **不可省略**："没有判断力会被 AI 忽悠"→ 人的判断与责任；"问题定义与验收仍是瓶颈"。
- **分层 / 演进**：个人 → 团队 → 业务三级提效评估。
- **失败归因**：被 AI 忽悠 → 缺判断力/独立证据（人 + 验证与测试缺失）；产能过剩 → 未优化价值链瓶颈；知识库无效 → 内容质量与来源治理缺失（项目知识失守）。
- **证据形态**：对话中的一线观察，纯文字，无实测。

---

## 批次汇总

### 1. 部件频次表（本批 13 个来源）

| 归一化名 | 来源数/13 | 各来源原名 |
|---|---|---|
| 任务拆分与调度 | 10 | OAI-HARNESS：worktree 并行实例、exec-plans；ANT-LONG：单特性/会话、Agent SDK 循环；ANT-CTX：lead/sub-agent；OAI-EVAL：handoffs；ANT-AGENTS：5 种 workflow、coding agent 流程；COALA：decision cycle；BORIS：开放任务 vs 例行任务；ATT-A：Workflow 交接协议；ATT-B：子 Agent；INP-001：小步迭代/端到端切片/拆模块 |
| 上下文装配 | 10 | OAI-HARNESS：AGENTS.md 地图；ANT-LONG：启动清单、compaction；ANT-CTX：system prompt/history/JIT/compaction；ANT-AGENTS：retrieval；COALA：working memory/retrieval；BORIS：prompt 削减；ATT-B：七类上下文；ATT-C：短索引路由；INP-001：三份文档会话开始；USR-OBS-12：最小充分指令 |
| 工具与执行环境 | 10 | OAI-HARNESS：worktree/CDP/observability/gh；ANT-LONG：init.sh/Puppeteer MCP；ANT-CTX：tools/MCP/glob-grep；OAI-EVAL：tool calls；ANT-AGENTS：tools/ACI/sandbox；COALA：grounding；BORIS：工具说明；ATT-B：工具边界/返回治理；INP-001：技术栈/CI；USR-OBS-12：确定性任务用工具 |
| 执行者 | 9 | OAI-HARNESS：Codex 实例/doc-gardening agent；ANT-LONG：initializer/coding agent；ANT-CTX：lead/sub-agent；OAI-EVAL：Agents SDK；ANT-AGENTS：agent/workers；COALA：language agent；BORIS：Claude Code；ATT-B：子 Agent；INP-001：AI 体力工作 |
| Skill/方法库 | 8 | OAI-HARNESS：CDP skills/core-beliefs；COALA：procedural memory；BORIS：prompt/工具说明/补丁；ATT-A：Rule；ATT-C：经验晋升技能；ATT-D：规则/推荐；INP-001：开发规范/止损规则；USR-OBS-12：Prompt |
| 验证与测试 | 7 | OAI-HARNESS：CDP 验证/agent 互审；ANT-LONG：Puppeteer e2e/self-verify/启动验证；ANT-AGENTS：ground truth/evaluator/tests；BORIS：真实任务验证；ATT-A：现实验收证据；INP-001：测试/CI/验收；USR-OBS-12：分级 Review/独立证据 |
| 评估与演进 | 7 | OAI-HARNESS：QUALITY_SCORE/垃圾回收；OAI-EVAL：graders/datasets/eval runs；COALA：learning；BORIS：消融；ATT-A：Add/Thin；ATT-D：回归/灰度/回滚；USR-OBS-12：评估分层/bottom-up |
| 模型 | 7 | OAI-HARNESS：GPT-5；ANT-LONG：Opus 4.5；ANT-CTX：attention budget；ANT-AGENTS：augmented LLM；COALA：LLM；BORIS：模型升级；ATT-D：模型处理语义不确定性 |
| 项目知识 | 6 | OAI-HARNESS：docs/ system of record、架构不变量；ANT-CTX：CLAUDE.md；ATT-A：文档/契约；ATT-D：taxonomy/规则版本；INP-001：PRD/架构/规范目录；USR-OBS-12：显式化知识 |
| 权限与边界 | 6 | OAI-HARNESS：worktree 隔离/自合并边界；ANT-AGENTS：sandbox/guardrails；ATT-A：Gate 阻断危险动作；ATT-C：分权；INP-001：密钥不进前端/限制擅自做主；USR-OBS-12：权限不转移 |
| 拦截与守卫 | 6 | OAI-HARNESS：linters/structural tests/docs 机械检查/merge gates；OAI-EVAL：guardrails；ANT-AGENTS：gate/guardrails；ATT-A：脚本/Gate；ATT-D：确定规则；INP-001：质量闸门 |
| 状态工件 | 6 | OAI-HARNESS：exec-plans/tech-debt-tracker；ANT-LONG：feature list/progress/git；ANT-CTX：NOTES.md/to-do；ATT-A：State 书签；ATT-B：状态/笔记；INP-001：项目状态文档/状态摘要 |
| 人 | 6 | OAI-HARNESS：可选 review/反馈编码化；ANT-AGENTS：checkpoints；ATT-C：本人确认；ATT-D：业务定义/人工升级；INP-001：人管边界与验收；USR-OBS-12：判断与责任 owner |
| 意图与验收 | 5 | OAI-HARNESS：product-specs；ANT-LONG：feature list；ATT-D：业务定义方向；INP-001：PRD/验收标准/图纸；USR-OBS-12：问题定义与验收 |
| 长期记忆 | 5 | ANT-CTX：memory tool/notes；ANT-AGENTS：memory；COALA：episodic/semantic；ATT-B：记忆类上下文；ATT-C：个人记忆五层 |
| 证据与追踪 | 4 | OAI-HARNESS：observability stack/structured logging；ANT-LONG：git log/截图；OAI-EVAL：traces/spans；ATT-A：带 revision/环境/时间的证据 |
| ★事实溯源（来源/revision/scope/环境/时间标签） | 4 | OAI-HARNESS：docs 作为 system of record；ATT-A：事实供应链/四个现场；ATT-D：版本绑定；USR-OBS-12：来源/owner/审核 |
| 代码地图 | 1 | OAI-HARNESS：docs/generated/db-schema.md（机器生成，近似） |

### 2. 共现关系表（本批 ≥2 次）

| 关系 | 来源 |
|---|---|
| 状态工件 → 执行者：会话开始恢复工作状态（数据） | ANT-LONG、ANT-CTX（notes 拉回）、ATT-A（State 书签）、INP-001（项目状态先加载） |
| 入口/索引 → 正文：短入口按需加载（数据） | OAI-HARNESS（AGENTS.md→docs）、ANT-CTX（JIT/轻量标识符）、ATT-B（渐进披露）、ATT-C（短索引路由） |
| 工具与执行环境 → 执行者：环境 ground truth 回读（数据/验证） | OAI-HARNESS（CDP/可观测栈）、ANT-LONG（Puppeteer）、ANT-AGENTS（ground truth）、COALA（grounding） |
| 拦截与守卫 → 执行者：阻断或回注修复指令（控制） | OAI-HARNESS（linters 注入修复）、ANT-AGENTS（chain gate）、ATT-A（Gate 阻断）、ATT-D（确定规则执行） |
| 子 Agent → 主 Agent：回传压缩摘要（数据） | ANT-CTX、ANT-AGENTS（orchestrator-workers）、ATT-B |
| 意图与验收 → 任务拆分与调度：从清单选一条/切片（控制） | ANT-LONG（feature list 选一条）、OAI-HARNESS（product-specs→exec-plans）、INP-001（PRD→端到端切片） |
| 证据与追踪 / 真实失败 → 评估与演进：驱动增删（触发） | OAI-EVAL（trace→grader→dataset）、OAI-HARNESS（扫描→QUALITY_SCORE→refactor PR）、BORIS（失败反馈→消融）、ATT-A（真实失败→Add/Thin）、USR-OBS-12（bottom-up） |
| 人 → 项目知识 / 长期记忆 / 工具：反馈或确认后写入（控制） | OAI-HARNESS（反馈编码为 docs/tooling）、ATT-C（本人确认写入/晋升）、USR-OBS-12（owner 审核）、ATT-D（业务定义方向） |
| 模型升级 → Skill/方法库与上下文清理（触发） | BORIS、OAI-HARNESS（garbage collection） |

### 3. 不可省略投票

| 部件 | 来源与原句/转述 |
|---|---|
| 拦截与守卫（机械约束） | OAI-HARNESS："The constraints are what allows speed without decay or architectural drift" |
| 状态工件（进度 + git） | ANT-LONG："The key insight… claude-progress.txt file alongside the git history" |
| 任务拆分与调度（增量/单特性） | ANT-LONG：增量工作是"critical"；ANT-AGENTS："simplest solution possible" |
| 验证与测试（环境 ground truth） | ANT-AGENTS："crucial… gain 'ground truth' from the environment at each step"；BORIS：验证与失败反馈先于堆 prompt；INP-001：先建 Git 与质量闸门 |
| 上下文装配（最小高信号） | ANT-CTX："smallest possible set of high-signal tokens"；OAI-HARNESS："Too much guidance becomes non-guidance" |
| 工具与执行环境（ACI） | ANT-AGENTS / ANT-CTX：工具定义应获得与 prompt 同等投入 |
| 证据与追踪（trace 先行） | OAI-EVAL："Trace grading is the fastest way to identify workflow-level issues" |
| 人（判断/验收 owner） | OAI-HARNESS："one truly scarce resource: human time and attention"；INP-001："人类负责边界和验收"；USR-OBS-12："没有判断力会被 AI 忽悠"；ATT-D：必须有人工升级出口 |
| 意图与验收（先定图纸） | INP-001："定图纸，避免 AI 边写功能边倒推 UI"；USR-OBS-12："问题定义与验收仍是瓶颈" |
| 项目知识 + 拦截 + 状态（三位一体） | ATT-A："可信上下文、可执行约束、可恢复流程共同构成 Harness" |
| 长期记忆（本人拥有/确认） | ATT-C："记忆应由用户拥有"；"写入和晋升需要本人确认" |

### 4. 分层模型清单

| 来源 | 模型原名 | 层名 |
|---|---|---|
| OAI-HARNESS | 六段演进 | 脚手架 → 环境欠规范 → docs/ 知识库集中 → 应用可读性 → 熵管理自动化 → 端到端自治 |
| OAI-HARNESS | 分层域架构 | Types → Config → Repo → Service → Runtime → UI（+ Providers 横切接口） |
| ANT-LONG | 两阶段会话 | initializer 会话 → 同构 coding 会话（验证→单特性→提交→记录） |
| ANT-CTX | prompt → context engineering | 三类长任务策略并列：compaction / structured notes / sub-agents；system prompt 高度光谱 |
| OAI-EVAL | 评估三段 | trace grading → datasets & eval runs → 外部 grader / 批量评估 |
| ANT-AGENTS | 复杂度阶梯 | augmented LLM → workflows（chaining/routing/parallel/orchestrator-workers/evaluator-optimizer）→ autonomous agents |
| COALA | 认知架构 | 记忆：working/episodic/semantic/procedural；行动：内部（reasoning/retrieval/learning）/外部（grounding）；决策：proposal/evaluation/selection → execution |
| BORIS | 升级-删减-加回循环 | 模型升级 → 消融 → 按失败加回 |
| ATT-A | 意图/事实/阻断三级 | 文档&Rule（意图）→ 脚本（事实判断）→ Gate（阻断）；State/文档/Workflow 分工 |
| ATT-B | 关注层三级 | Prompt → ReAct 行动循环 → Context Engineering |
| ATT-C | 五层记忆 | 稳定身份/原则 → 动态偏好 → 上下文 → 知识（卡片只给"五层"概称）；记忆 → 技能晋升 |
| ATT-D | 控制强度梯度 | 确定规则 → 范围限制 → 优先推荐 → 语义判断 |
| INP-001 | 开发前三步 | 定图纸 → 打地基 → 立规矩 |
| USR-OBS-12 | 提效三级 | 个人 → 团队 → 业务 |
| 002 综合（非单一来源） | 七层候选结构 | 权威事实 → 治理记忆 → 动态上下文 → 可恢复状态 → 合同工作流 → 权限/质量 Gate → 绑定验收证据 |

### 5. 失败归因频次

| 部件（缺失/失守） | 次数 | 来源 |
|---|---|---|
| 上下文装配 | 5 | OAI-HARNESS（单体 AGENTS.md 腐烂）、ANT-CTX（context rot、过度 compaction、prompt 硬编码/笼统）、BORIS（旧 prompt 成噪声）、ATT-B（全量加载/原始输出常驻）、ANT-LONG（compaction 不足） |
| 验证与测试 | 5 | ANT-LONG（过早标完成、e2e 不可见）、OAI-HARNESS（QA 瓶颈/应用不可读）、ANT-AGENTS（compounding errors 需 ground truth）、USR-OBS-12（缺独立证据被忽悠）、ATT-D（准确率无消融不可归因） |
| 工具与执行环境 | 5 | OAI-HARNESS（环境欠规范）、ANT-CTX（工具集臃肿、误用工具）、ANT-AGENTS（相对路径/diff 格式）、ANT-LONG（Puppeteer 看不到 alert）、ATT-B（工具过多） |
| 拦截与守卫 | 4 | OAI-HARNESS（架构漂移、模式复制）、ATT-D（错误范围限制误伤）、INP-001（未先建闸门）、OAI-EVAL（违反策略需 trace 定位） |
| 状态工件 | 3 | ANT-LONG（环境留 bug/进度未记录）、ATT-A（无可恢复状态不算交付）、INP-001（缺状态摘要则 AI 擅自做主） |
| 意图与验收 | 3 | ANT-LONG（无完成标准→过早宣布胜利）、INP-001（边写边倒推 UI）、USR-OBS-12（一头一尾难） |
| 任务拆分与调度 | 3 | ANT-LONG（一次做完整个 app）、INP-001（代码聚成一坨）、OAI-EVAL（handoff 缺失/路由回归） |
| 项目知识 | 3 | OAI-HARNESS（人的品味未编码、docs 过时）、USR-OBS-12（知识库内容质量差）、ATT-A（无可信事实不算交付） |
| 评估与演进 | 2 | OAI-HARNESS（人工清理不可持续）、BORIS（未随模型升级消融） |
| 人 | 2 | USR-OBS-12（缺判断力）、ATT-D（缺人工升级出口） |
| 长期记忆 | 1 | ATT-C（未分权→第二权威版本） |
| Skill/方法库 | 2 | BORIS（工具说明/补丁成噪声）、INP-001（缺止损规则→重复尝试） |
| 证据与追踪 | 1 | ANT-AGENTS（框架抽象遮蔽 prompt/响应难调试） |
