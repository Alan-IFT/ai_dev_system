# 记忆层（12 记忆与知识治理）：候选、标准与对照

## 0. 验证边界

- 检索日期：**2026-09-07**。全部通过 WebSearch / WebFetch 完成。
- **本报告没有任何 [一手实测]**：我没有在本机安装或运行任何候选（无 dsh、无 Claude Code auto-memory 目录、无 mem0/Graphiti 实例），也没有逐行读源码。凡"官方文档 / 官方 README / 官方发布页"一律记 **[厂商文档]**；博客、评测、第三方汇总记 **[二手]**。按 §1.6 的口径，这份报告的证据上限就是 [厂商文档]。
- 我亲自打开（WebFetch）过的页面：Claude Code memory 官方文档；ChatGPT/Codex Memories 官方文档（`developers.openai.com/codex/memories` 302 跳到 `learn.chatgpt.com/docs/customization/memories`）；GitHub Blog 的 Copilot agentic memory；github community discussion #184415；opencode rules 文档；csyangwen/dsh-memory-evolve README（GitHub 页面 + raw README）；mem0 memory-types / expiration-date / changelog highlights / GitHub 仓库首页；Graphiti overview、bi-temporal 概念页、GitHub 仓库首页；Zep 开源方向公告；Letta sleeptime 文档与 Context Repositories 博文；Cognee overview 与 GitHub 首页；TencentCloud/TencentDB-Agent-Memory 首页与 releases 页；Basic Memory 文档首页；universalmemoryprotocol.io；anthropics/claude-code issue #44820。
- 只看了搜索摘要、**没有打开**的：绝大多数中文评测号、mnemoverse/particula/braintrust 等横评、arXiv 上的记忆综述。这些一律不作论据。
- **未查到**的：任何标准组织（Linux Foundation / AAIF / IETF / OWASP / W3C）发布的"agent 记忆"开放标准；任何产品提供"注入即记账、且区分到达/有用两维"的现成能力；dsh 官方（非插件）对"会话检索/记忆"的一手文档（我只找到插件方与第三方目录站，`dsharness.io` / `dshplugin.dev` 等站点性质无法确认，不作依据）；dsh-memory-evolve 的许可证（GitHub 页面摘要说 MIT，raw README 里我没看到许可证声明——记为**未定**）。

---

## 1. 2026 年的行业标准与主流实践

### 1.1 结论：记忆层**没有**开放标准

- **AAIF（Agentic AI Foundation，Linux Foundation，2025-12 成立）** 锚定的项目是 **MCP、goose、AGENTS.md**；MCP 已于 2025-12-09 由 Anthropic 捐赠。公开的项目清单里**没有记忆规范**。[厂商文档]（linuxfoundation.org 新闻稿 + blog.modelcontextprotocol.io）
- **Universal Memory Protocol (UMP)**：自称"transport-neutral memory protocol"，定义六个操作（capabilities / recall / remember / revise / forget / get）、可移植 JSON 记录、四级 conformance，复用 W3C PROV 与 DID。但托管在个人仓库（edihasaj/universal-memory-protocol），**未查到任何标准组织背书、未查到正式版本号、未查到任何宿主采纳**。按 §1.2 的"要给出标准名称、归属组织、当前状态"——归属组织：无；状态：**提案，未被采纳**。[厂商文档（其自有站点）]
- 因此本领域**没有"有开放标准者优先"这一条可用**。唯一的准标准是**指令文件**这一层：`AGENTS.md` 已进 AAIF，是跨宿主"人写的记忆"的事实载体。**模型自写的记忆没有任何跨宿主格式**——五个宿主各写各的目录、各用各的 schema，互不相通。这一点直接决定了本报告的推荐方向。
- MCP 可以当"接外部记忆服务的通道"（Graphiti、Cognee、Basic Memory、mem0 都提供 MCP server），但 **MCP 只规定传输与工具描述，不规定记忆语义**（没有有效期、没有来源、没有晋升）。把 MCP 当"记忆标准"是误读。

### 1.2 五宿主 × 记忆机制矩阵

| 机制 | Claude Code | codex | opencode | dsh | VSCode Copilot |
|---|---|---|---|---|---|
| 人写指令文件（通用层） | `CLAUDE.md` + `.claude/rules/`，可 `@AGENTS.md` 导入；不直接读 AGENTS.md [厂商文档] | `AGENTS.md` 原生 [厂商文档] | `AGENTS.md` + `opencode.json:instructions` [厂商文档] | 未查到官方一手文档（插件生态各行其是）未查到 | `.github/copilot-instructions.md` [二手] |
| 模型自写记忆（宿主原生） | **有**：auto memory，默认开，`~/.claude/projects/<project>/memory/`，`MEMORY.md` 索引 + 主题文件 [厂商文档] | **有**：Memories，`~/.codex/memories/`，**默认关** [厂商文档] | **无原生**（仅社区插件） [厂商文档] | 原生未查到；社区插件 dsh-memory-evolve 提供五轨记忆 [厂商文档（插件 README）] | **有**：Copilot Memory，仓库级，2026-01-15 起 Pro/Pro+ 默认开 [厂商文档] |
| 记忆写入可被拦截/审批 | **不可**：`PreMemoryWrite/PostMemoryWrite` 的 feature request（issue #44820）**已 closed as not planned**；用 `PreToolUse` 按路径匹配被提案者自述为"undocumented and fragile" [厂商文档] | **不可**：官方明说 memories 是 "generated state"，"don't rely on editing them by hand as your primary control surface" [厂商文档] | 不适用 | **可**：插件自带**待确认队列**，"AI 不会擅自往记忆里写东西；你确认后才生效" [厂商文档（插件 README）] | **事后可**：仓库 owner 在 Repository Settings → Copilot → Memory 复核与删除；**写入前无审批** [厂商文档] |
| 记忆有自动失效 | **无** TTL；只有 `modified` 写入时间戳（v2.1.214+）；memory 目录被排除在 `cleanupPeriodDays` 清扫之外 [厂商文档] | 未查到 TTL [厂商文档] | 不适用 | 无 TTL，只有**归档**（不再注入、可转回） [厂商文档] | **有**：**28 天自动过期** [厂商文档] |
| 接外部记忆服务（MCP） | 支持 | 支持 | 支持 | 支持（mem0 2026-08-24 起提供 DSH 原生插件 [厂商文档]） | 支持 |

**读矩阵的两个要点**：
1. 五宿主里**唯一在写入前设审批点**的是 dsh 的社区插件，不是任何一家厂商的原生功能。理论 §12 的 R3（"审批点在进入权威载体之前"）在原生层面**普遍不满足**。
2. 五宿主的模型自写记忆**互不通用**，且都存在宿主自己的目录里（Claude Code 明说 "machine-local... not shared across machines"）。任何依赖宿主原生记忆的设计都**违反 D-020 跨宿主通用**，只能是宿主绑定层。

---

## 2. 候选清单

### 2.1 基线：**Markdown 文件 + front-matter + git**（通用层）
一句话：把记忆写成仓库里的普通 md 文件，字段放 YAML front-matter，历史交给 git。
维护状态：不适用（无上游）。部署形态：无新组件。许可证：不适用。层级：**通用层**，五宿主都能读（各自的指令文件 import 或直接 Read）。来源：本报告的对照基准，不是产品。

### 2.2 Claude Code auto memory（宿主绑定层）
一句话：Claude 自己写的四类笔记（`user` / `feedback` / `project` / `reference`），`MEMORY.md` 每次会话开头加载前 200 行或 25KB。
维护状态：随 Claude Code 滚动更新（文档提到 v2.1.214 / v2.1.234 / v2.1.239 等近期版本）。部署形态：内置，无依赖。许可证：随宿主。来源：[厂商文档] code.claude.com/docs/en/memory。

### 2.3 Codex Memories（宿主绑定层）
一句话：从"合格的历史会话"自动生成本地记忆文件（summaries / durable entries / recent inputs / supporting evidence），存 `~/.codex/memories/`，默认关。
维护状态：现役。部署形态：内置。来源：[厂商文档] learn.chatgpt.com/docs/customization/memories。

### 2.4 GitHub Copilot Memory（宿主绑定层）
一句话：agent 在发现"可复用模式"时主动调 memory 工具存一条**带代码位置引用**的记忆，仓库级，跨 coding agent / code review / CLI 共享。
维护状态：2026-01-15 起 Pro/Pro+ 默认开（此前 public preview）。部署形态：GitHub 侧托管。来源：[厂商文档] github.blog + community discussion #184415。

### 2.5 dsh-memory-evolve（宿主绑定层，社区）
一句话：给 dsh 加"五轨记忆 + 待确认队列 + git 分支感知 + 会话搜索"的纯插件。
五轨：用户档案 / 全局事实 / 项目关键记忆（可标记只在某 git 分支生效）/ 项目日志与每日日志 / 情绪反馈记录。
维护状态：日期戳 tag（如 `v26081302`），24h 自动检查更新；README 未见许可证声明（GitHub 页面摘要称 MIT）→ **未定**。部署形态：纯插件，"零运行时依赖"，记忆远端默认存进代码仓库的专属分支，也可用独立共享记忆仓库。来源：[厂商文档] github.com/csyangwen/dsh-memory-evolve。

### 2.6 mem0（通用层，库/服务双形态）
一句话：LLM 驱动的记忆管道，`infer=True` 时一次 LLM 调用对每条事实决定 ADD / UPDATE / DELETE。
维护状态：活跃（2026-08-24 出 DSH 插件，2026-06-27 加 expiration，2026-05-08 加 decay）。部署形态：Python/TS SDK + 可 docker 自托管 server；需 LLM + embedding + 向量库。许可证：**Apache-2.0**。**OSS 与云不等价**——官方自陈 benchmark 分数来自"managed platform, which includes proprietary optimizations not available in the open-source SDK"。来源：[厂商文档] docs.mem0.ai + github.com/mem0ai/mem0。

### 2.7 Graphiti（通用层，库）／Zep（云服务）
一句话：时序知识图谱框架，把输入按 episode 增量摄入，边带**双时间轴**元数据。
维护状态：活跃，**v0.29.2（2026-06-08）**，Apache-2.0。部署形态：Python 3.10+ **必须**配一个图数据库（Neo4j 5.26+ / FalkorDB / Neptune；Kuzu 已弃用）+ 一个 LLM（默认 OpenAI，需结构化 JSON 输出）；自带 `mcp_server`。
**重要上游事实**：Zep 已**停止维护 Zep Community Edition**（公告 2025-04-02，2026-06-03 更新），仓库留在 Apache-2.0 但不再更新，开源力量全部集中到 Graphiti；Zep 本体现在是云服务。来源：[厂商文档] help.getzep.com / github.com/getzep/graphiti / blog.getzep.com。

### 2.8 Letta（宿主绑定层 = 绑 Letta 运行时）
一句话：有状态 agent 运行时；memory blocks + archival memory + **sleep-time agent** 后台整理记忆 + **MemFS / Context Repositories：git 支撑的记忆文件系统**（2026-02-12 发布）。
维护状态：活跃。部署形态：Letta server / Letta Code（`npm i -g @letta-ai/letta-code`），`/memfs` 开启。层级：**只在 Letta 自己的 agent 里成立**，不是五宿主通用。来源：[厂商文档] docs.letta.com + letta.com/blog/context-repositories。

### 2.9 Cognee（通用层，库）
一句话：ECL（Extract-Cognify-Load）管道，把原始数据变成图 + 向量 + 关系三层存储的可检索记忆；主操作 remember / recall / improve / forget。
维护状态：活跃，Apache-2.0，文档提到 1.0。部署形态：**本地可零外部服务**（SQLite + LanceDB + Kuzu 默认），生产可换后端；**必须配 LLM**；有 cognee-mcp。来源：[厂商文档] docs.cognee.ai + github.com/topoteretes/cognee。

### 2.10 TencentDB-Agent-Memory（通用层，服务；proxy 形态）
一句话：团队级记忆中枢，**Memory Proxy 挂在模型 API 路径上**（改 base URL，零代码接入，支持 Anthropic/OpenAI 双协议），把会话/文档/代码变成四类资产：Chat Memory（L0 原始 → L1 原子 → L2 场景 → L3 人设）/ Skill / LLM-Wiki / Code-Graph。
维护状态：活跃，**v2.0.1（2026-08-25）**，v2.0.0（2026-08-03），MIT。部署形态：Memory Core + Memory Hub + Memory Proxy 三服务，docker 一键起。治理：**三级可见性 private / team / restricted + User/Role/Agent ACL**，资产带 owner / version / status / visibility / **usage counts** / agent 绑定。来源：[厂商文档] github.com/TencentCloud/TencentDB-Agent-Memory + releases 页。

### 2.11 Basic Memory（通用层，MCP）
一句话：把知识图谱写成纯 Markdown 文件、由 LLM 经 MCP 工具读写、人可直接编辑、可 git 版本化；支持 Claude Code / Codex / VS Code / Cursor 等。最新 v0.23.2。许可证未查到。来源：[厂商文档] docs.basicmemory.com。

---

## 3. 对照本理论的要求（核心）

### 3.0 要求编号（下两表共用）

| # | 要求（§4 D 与 02-记忆管理落地设计） |
|---|---|
| R1 | 五类（上下文/任务状态/项目知识/长期记忆/验收证据）**运营上分开** |
| R2 | 候选的最小身份：来源与产生事件、置信态、适用范围、归属人、时效或派生源版本、冲突、晋升目标、生成与评估它的模型 |
| R3 | **入池与权威正交**：入池靠客观交付信号；成权威靠归属人批准；审批点在进入权威载体之前 |
| R4 | 自动晋升仅限"已登记判定器覆盖 + 影响面局部可撤回" |
| R5 | 候选由交付链**状态转换**自动提取；**模型自身输出与推断不得成为候选** |
| R6 | 条目带置信态与使用方式（强/弱/影子）；敏感或冲突隔离；召回为空须声明"无历史经验" |
| R7 | **注入即记账**，指标分"到达"与"有用"两维 |
| R8 | 权威验证不可逆推；验证者与生成者隔离 |
| R9 | 个人与团队边界**在读取前**生效 |
| R10 | 四时间戳两条轴：事件时间（t_valid / t_invalid）vs 记录时间 |
| R11 | 不采纳"新的永远赢" |
| R12 | 来源标记**必填** |
| R13 | **控制流不得来自记忆内容** |
| R14 | 三层三种淘汰机制 |

### 3.1 表一：最小形态 vs 宿主原生

| 要求 | 最小满足形态（少就是多） | 文件+git 基线 | CC auto memory | Codex Memories | Copilot Memory | dsh-memory-evolve |
|---|---|---|---|---|---|---|
| R1 | 四个目录：`candidates/` `knowledge/` `state/` `evidence/`，各一条写入规则 | 满足 [厂商文档-git] | **不满足**：`project` 类型明确装 "ongoing work, deadlines"，任务状态混进长期记忆 [厂商文档] | 不满足：summaries/durable/recent inputs 混在一个目录 [厂商文档] | 部分：只有"仓库级模式"一类，其余四类没有 [厂商文档] | 部分：五轨已分（档案/事实/项目记忆/日志/反馈），但"验收证据"缺位 [厂商文档] |
| R2 | front-matter 八字段 | 满足（字段由你定） | **不满足**：只有 `type` + `modified` 两个字段 [厂商文档] | 未定（字段结构未公开） | 部分：有代码位置 citation（=适用范围+来源），无置信态/归属人/晋升目标 [厂商文档] | 部分：有 git 分支标记（适用范围）、时间、反馈标记；无置信态/晋升目标/生成模型 [厂商文档] |
| R3 | 候选区自由写；进 `knowledge/` 必须一次人工 commit / PR | **满足** | **不满足**：Claude 直接写权威载体，且 `MEMORY.md` 每会话自动加载 [厂商文档] | 不满足：无审批，且官方劝阻手工编辑 [厂商文档] | **部分**：写入无审批、使用无审批；owner 可**事后**复核删除 [厂商文档] | **满足**：待确认队列，"你确认后才生效"，逐条采纳或拒绝 [厂商文档] |
| R4 | 默认无自动晋升 | 满足（默认关） | 不满足：全自动 | 不满足：全自动 | 不满足：全自动 | 满足（默认人工确认） |
| R5 | 候选只由 hook / CI / 状态转换写入；只收人的自述与工具回读事实 | 满足（取决于你怎么写钩子） | **部分**：`feedback` 类（用户纠正）合规；`user`/`project`/`reference` 含模型推断，不合规 [厂商文档] | **不满足**：从整段会话蒸馏，assistant 输出必然入池 [厂商文档] | **不满足**：agent 自主判断"值得记"时调 memory 工具 [厂商文档] | 部分：回合内自我审查由模型提议，但**人确认**才生效——入池不合规、权威合规 [厂商文档] |
| R6 | 三档标签 + `无历史经验` 兜底句 | 满足 | 不满足 | 不满足 | 部分：有 citation 校验（用前对照代码，矛盾则改写），近似"影子"用法 [厂商文档] | 部分（有归档=影子的近似） |
| R7 | 注入清单落盘（到达）+ 事后人工标注（有用） | 部分：到达可做，有用需自建 | **不满足**：`/context` 只显示加载了哪些文件，无逐条记账 [厂商文档] | 不满足 | 不满足 | 不满足：只有上下文占用比例的可视化环，无逐条记账 [厂商文档] |
| R8 | 权威目录的 commit 由人签；生成者无权写 | 满足 | 不满足：生成者=写入者 | 不满足 | 不满足 | 部分：确认人是人，但生成与提议同一模型 |
| R9 | 用 git 仓库/分支边界隔离个人与团队 | 部分：粒度只到仓库/分支 | 不适用（machine-local） | 不适用 | **满足**：创建需 write 权限、使用需 read 权限，仓库级 [厂商文档] | 部分：私有记忆可放独立共享仓库 [厂商文档] |
| R10 | front-matter 写 `t_valid`/`t_invalid`；git commit time 即记录时间 | **满足**（记录轴白送） | 不满足：只有 `modified`（记录轴单点） | 未定 | **部分**：28 天 TTL 是记录轴上的粗粒度失效，无事件轴 [厂商文档] | 不满足：只有创建时间 |
| R11 | 冲突时并列两条主张 + 各自范围/版本 | 满足（靠约定） | 不满足：新笔记覆盖旧笔记 | 不满足 | 部分：矛盾时"鼓励存一条修正版"，旧的怎么办未说明 [厂商文档] | 未定 |
| R12 | front-matter `source:` 必填，schema 校验卡 | **满足** | 不满足：无 source 字段 | 部分：文档提到 "supporting evidence from prior chats" [厂商文档] | **满足**：citation 到具体代码位置 [厂商文档] | 部分：有 git 分支与日志出处，无统一 source 字段 |
| R13 | 记忆只进"资料块"，权限由 hooks/settings 决定 | 部分（靠约定） | **部分**，但有官方背书：官方明说 CLAUDE.md 与 auto memory 是 "context, not enforced configuration"，"To block an action regardless of what Claude decides, use a PreToolUse hook" [厂商文档] | 部分 | 部分 | 部分 |
| R14 | 三层各一种：候选区定期扫→过期删；权威区源版本对账；日志区按时间归档 | 满足（需自写扫描脚本） | **不满足**：memory 目录被显式排除在保留期清扫之外；只有 `MEMORY.md` 超 200 行/25KB 时提示模型自己精简（超限内容下次加载被丢弃 = 事实上的静默截断） [厂商文档] | 未定 | 部分：单一机制（28 天） | 部分：单一机制（人工归档） |

### 3.2 表二：最小形态 vs 独立记忆服务

| 要求 | 文件+git 基线 | mem0 | Graphiti | Letta MemFS | Cognee | TencentDB-Agent-Memory |
|---|---|---|---|---|---|---|
| R1 | 满足 | 部分：靠 `user_id/agent_id/run_id/app_id` 分域，非按五类 [厂商文档] | 部分：group_id 分域 | 部分：`system/` 常驻 + 其余分层 [厂商文档] | 部分 | **部分**：四类资产（Chat/Skill/Wiki/CodeGraph）≈ 长期记忆+方法库+项目知识，缺任务状态与验收证据 [厂商文档] |
| R2 | 满足 | 部分：有 metadata/categories/expiration_date，无归属人/置信态/晋升目标 [厂商文档] | 部分：episode 溯源 + 四时间戳，无归属人/置信态/晋升目标 [厂商文档] | 部分：YAML front-matter 自定义 [厂商文档] | 部分 | 部分：owner/version/status/visibility 有，置信态与晋升目标未查到 [厂商文档] |
| R3 | 满足 | **不满足**：LLM 一次调用直接决定 ADD/UPDATE/DELETE，无人工环节 [厂商文档] | 不满足 | **不满足**：可选的 review 是"第二个后台 agent"，不是人 [厂商文档] | 不满足 | **部分**：新资产默认 private，共享到 team 需显式决定——这是**发布审批**，不是**写入审批** [厂商文档] |
| R4 | 满足 | 不满足 | 不满足 | 不满足 | 不满足 | 不满足 |
| R5 | 满足 | **不满足**：从消息流推断 | **不满足**：episode 里含 assistant 消息 | **不满足** | **不满足** | **不满足**：Chat Memory 就是对整段会话做 L0→L3 蒸馏 [厂商文档] |
| R6 | 满足 | 部分：decay 只改排序不改语义 [厂商文档] | 部分 | 未定 | 未定 | 未定 |
| R7 | 部分 | 不满足：未查到逐条注入记账 | 不满足 | 不满足 | 不满足 | **部分**：资产元数据含 usage counts = "到达"一维；"有用"维未查到 [厂商文档] |
| R8 | 满足 | 不满足 | 不满足 | 不满足 | 不满足 | 不满足 |
| R9 | 部分（仓库粒度） | 部分：scope id 是软隔离 | 部分 | 部分 | 部分 | **满足**：三级可见性 + User/Role/Agent ACL，proxy 侧按 user key 校验权限后才注入 [厂商文档] |
| R10 | 满足 | **部分**：只有 `expiration_date`（YYYY-MM-DD，记录轴），无事件轴 [厂商文档] | **满足（唯一一个）**：`valid_at`/`invalid_at`（事件轴）+ `created_at`/`expired_at`（记录轴）；`add_episode(reference_time)` 落成 `valid_at` [厂商文档] | 不满足（git 只给记录轴） | 未查到 | 未查到 |
| R11 | 满足 | **不满足**：LLM 判 UPDATE/DELETE，旧值被改写 [厂商文档] | **满足**：温和失效而非删除——旧边设 `invalid_at` + `expired_at`，新边并存，"facts are never deleted" [厂商文档] | 部分：git 保留历史，但当前视图是新的赢 | 未定 | 未定 |
| R12 | 满足 | 部分：metadata 可放 source，非必填 | **满足**：episode 即 provenance [厂商文档] | 部分 | **部分**：关系库跟踪 documents/chunks/lineage [厂商文档] | 部分：owner 有，原始出处未查到 |
| R13 | 部分 | 部分 | 部分 | 部分 | 部分 | **不满足**：proxy 明说做 "system prompt injection"——记忆内容进系统提示，与"控制流不得来自记忆内容"直接抵触 [厂商文档] |
| R14 | 满足 | **部分**：expiration（隐藏≠删除，`show_expired=True` 可见）+ decay（重排序）+ delete，是三种机制但都不绑源版本 [厂商文档] | 部分：invalidation 不是淘汰，图只增不减（长期看是**成本失效面**） | 部分：defragmentation 技能 [厂商文档] | 部分：有 forget 操作 | 未查到 |

### 3.3 必答三问

#### 问一：L0/L1 用文件够不够？

**够，而且文件是当前唯一能同时满足 R2 / R10 / R11 / R12 的形态。**

理由不是"文件简单"，而是：R2 那八个字段、R10 的双时间轴、R12 的必填来源，本质是**每条记忆的表头**。现成产品的 schema 全都填不满这张表头——mem0 没有事件轴也没有归属人；Graphiti 有双时间轴但没有归属人、置信态、晋升目标；Copilot 有 citation 但没有有效期字段；Claude Code auto memory 只有 `type` 和 `modified` 两个字段。**你要的字段没有任何产品提供，而 front-matter 想写几个写几个。**

文件+git 还白送三样：
- **记录时间轴**：commit time 就是 t_recorded，且不可被写入者篡改（这同时满足 R8 的"不可逆推"一半）。
- **审批点**：把权威目录设成需要人 commit（或 PR + CODEOWNERS），R3 的"审批点在进入权威载体之前"就成立了，零新组件。
- **冲突并列**：两条互相矛盾的记忆就是两个文件/两段，不需要任何"合并策略"，天然不落入"新的永远赢"。

文件方案**做不到**的两件，要各补一小段脚本（仍属"少就是多"）：
- R14 淘汰：一个到期扫描（读 front-matter 的 `t_invalid` / `source_version`，过期的移出或标记）。**关键是这个扫描必须在 CI 里跑、不由写记忆的那个 agent 跑**，否则违反 R8。
- R7 记账"到达"维：装配上下文时把"这一轮注入了哪几条记忆 id"落一行盘。"有用"维目前**没有任何产品提供**，只能靠事后人工标注或从返工记录反查。

#### 问二：L2 起什么条件下值得上服务？

不要用"团队人数"当条件（不可判定）。可判定的触发条件，**任一满足**才考虑：

- **C1 检索失效可测**：权威区条目规模让 grep/文件名索引开始明显误召回——具体指标：一周内"召回为空但事后证明有相关记忆"的次数 ≥ N，或人工找不到已知条目的次数 ≥ N。这条是唯一真正需要"检索引擎"的理由。
- **C2 读取前的细粒度边界**：需要在**同一个仓库内**按人/按 agent 区分谁能读哪条（R9）。文件+git 的粒度只到仓库和分支，做不到这个。满足 C2 的只有 TencentDB 的 ACL 模型。
- **C3 需要时间旅行查询**：要能回答"2026-03 时我们**以为**是什么"与"2026-03 **实际**是什么"两个不同问题（R10 完整双轴）。文件能存字段，但查不动；满足 C3 的只有 Graphiti。
- **C4 不构成理由**：R7 的两维记账，**没有任何服务提供**，所以"为了记账上服务"是伪需求。

**同时必须能写出 C 判据的探测**——写不出就不装。给三个可写出的例子：
- 上 Graphiti：探测 = 一个独立脚本按 git 权威目录逐条回查图里是否存在且 `valid_at` 一致，差异计数超阈值即报警（探测源是 git，不是图本身）。
- 上任何服务：探测 = "拔掉它，系统是否还能工作"的定期演练。**只要拔掉它就干不了活，它就不是可选缓存而是权威副本，违反知识单一权威。**
- 上 proxy 形态：探测必须**独立于 proxy**（外部拨测 + 一键改回原 base URL 的旁路开关），因为 proxy 在模型调用路径上是单点。

#### 问三：proxy 抓会话与"模型输出不得成为候选"冲突吗？

**冲突，成立**，而且是形态性的，不是配置问题。三条理由：

1. **位置决定可见性**：proxy 站在模型 API 边界上，它能看到的只有 request / response 消息流。它**看不到交付链的状态转换**——看不到 CI 结果、验收裁定、状态工件的转换。R5 要求"候选由交付链的状态转换自动提取"，proxy 结构上取不到这个触发源。
2. **实现事实**：TencentDB 的 Chat Memory 是"L0 原始 → L1 原子 → L2 场景 → L3 人设"的分层蒸馏，输入是整段会话。assistant 消息**必然**进入候选池；把 assistant 的总结再蒸馏一遍，正是 R5 要挡的"模型推断变成记忆"。
3. **叠加违反 R13**：该 proxy 明说做 system prompt injection——模型推断出来的内容，绕一圈变成下一轮的系统提示，即"控制流来自记忆内容"。这比 R5 更严重。

**可部分化解，但没有现成开关**：消息角色是结构化的，理论上可以只从流里取 `role=user` 的消息与 `tool_result` 内容（人的自述 + 可定位的观察），丢弃全部 assistant 文本。这在技术上可行，**但我未查到任何产品提供这个开关**（mem0 / TencentDB / Codex Memories 都没有）。

**因此建议的降级用法**：proxy 只作**会话原始记录的旁路留存**（对应 32 "只追加保存原始记录"），当作可回溯的档案，**不作候选来源**；候选仍由状态转换钩子从 git / CI 产生。这样 proxy 从"记忆系统"降级成"日志系统"，冲突消失，且它挂了也不影响判定——同时也就没必要用商业记忆产品来做这件事。

---

## 4. 判据 A/B/C 判定

| 候选 | A 必需 / B 可选 | 引入的失效面 | "它坏了怎么被发现" |
|---|---|---|---|
| **文件+git 基线** | **A 必需**（不是"记忆服务"必需，是"某个持久载体"必需：没有它，"来源标记必填""候选带最小身份"这些条文无法被判定为已执行） | front-matter 写歪、字段缺失、过期条目不清 | **能写出**：CI 里一个 schema 校验 + 到期扫描，**运行者独立于写入的 agent**；失败即红 → **装** |
| Claude Code auto memory | **B 可选** | ① 模型静默写权威载体，无写前钩子（issue #44820 closed as not planned）② `MEMORY.md` 超 200 行/25KB 后**超出部分下次加载被静默丢弃** ③ machine-local，换机器即丢 | **能写出**：把 `autoMemoryDirectory` 指到一个纳入 git 的目录，CI 里跑 `wc -l MEMORY.md` 阈值检查 + 每日 `git diff` 审计 → **可装，但只当候选区，绝不当权威** |
| Codex Memories | **B 可选** | 生成态、官方劝阻手工编辑、无审计 API（未查到） | **写不出** → **按判据 C 不装**（保持默认关闭） |
| Copilot Memory | **B 可选** | 写入无审批；28 天 TTL 不可配（未查到）；社区反馈 VSCode 侧生成不稳定 [二手] | 部分能写出：仓库设置页可人工复核清单 → **可留默认，不纳入规范的权威链** |
| dsh-memory-evolve | **B 可选** | ① 单人社区插件，上游停更是现实失效面 ② 许可证未定 ③ 记忆写进代码仓库的专属分支——与 D-020 跨宿主冲突（只有 dsh 会读） | 能写出：记忆分支的内容是普通文件，任何宿主都能 Read + CI 校验 → **可装（它是唯一自带写入审批的），但把记忆分支的格式设计成宿主中立的** |
| mem0 | **B 可选** | ① LLM 可自主 DELETE，误删无审批 ② OSS 与云功能不等（分数来自云） ③ 每次写入一次 LLM 调用 = 成本与不确定性 | 能写出（自建 history diff 告警），但**要为"防止 LLM 误删"另建一套审计，成本超过它省下的**→ 不装 |
| Graphiti | **B 可选** | ① 必须一个图数据库（新运维面）② 每次摄入需 LLM 结构化输出（失败模式：抽取错、成本）③ 只增不删，长期规模问题 ④ Zep 已砍掉 Community Edition，说明该团队会砍产品线 | **能写出**：以 git 权威目录为源，独立脚本逐条回查图并计差 → **L2 满足 C1/C3 时才装，且只作检索侧派生缓存** |
| Letta（含 MemFS） | **B 可选** | 绑定 Letta 运行时——Alan 的五宿主里一个都不是 | 能写出，但**违反 D-020 通用性** → 不装（但**借鉴其 git 载体设计**） |
| Cognee | **B 可选** | 三层存储 + LLM 抽取；无审批、无双轴 | 能写出，但相对文件方案没有新增可判定项 → 不装 |
| TencentDB-Agent-Memory | **B 可选** | ① **proxy 在模型调用路径上 = 单点，它挂了整个宿主不能用**（最重的一条）② system prompt injection 违反 R13 ③ Chat Memory 违反 R5 | **能写出**：外部拨测 + 一键旁路（改回原 base URL）演练 → **仅当 C2（细粒度 ACL）真实出现时才考虑，且必须先关掉 Chat Memory 自动蒸馏、只留 Skill/Wiki 这类人工整理资产** |
| Basic Memory | **B 可选** | 引入一个 MCP server 去做"写文件"这件宿主本来就能做的事 | 能写出（文件在，git 在），但**它没解决任何文件方案解决不了的问题** → 不装 |
| UMP（协议） | 不适用 | 无组织背书、无采纳 | 不适用 → **不采纳，但可抄它的记录字段设计** |

---

## 5. 推荐与备选（按 L0→L3 分档）

### L0（一人一工具）
**装**：只有 `CLAUDE.md` / `AGENTS.md` + 一个 `docs/decisions/` 目录（每个决策一个 md，front-matter 至少 `source` / `t_valid`）。
**不装**：任何记忆服务、任何向量库、任何图库。auto memory 保持默认开但**当成草稿本**——每次它写了什么，你自己决定要不要抄进 `docs/decisions/`。Codex Memories 保持默认关。
**为什么**：L0 只有一个人一个工具，"入池"和"权威"之间没有信息不对称，人脑就是审批器。上任何东西都是纯增加失效面。

### L1（一人多会话）
**升级触发**：出现"上一次会话得出的结论，这一次会话不知道"且**已经付出返工代价**。
**装**：在 L0 之上加三件，都是文件：
1. `memory/candidates/`（模型和钩子随便写）与 `memory/knowledge/`（只有你 commit 才能进）两个目录——这就是 R3 的入池/权威正交，成本为零。
2. front-matter 的最小身份字段 + 一个 CI 校验脚本（缺 `source` 就红）。
3. 一个到期扫描：读 `t_invalid` 和 `source_version`，过期的移进 `memory/archive/`。
**记账**：装配上下文时把注入的条目 id 追加一行到 `memory/injections.log`（到达维）。"有用"维先不做，等有返工记录时反查。
**不装**：仍然什么服务都不装。
**dsh 上的做法**：dsh-memory-evolve 可以装（它是五宿主里唯一自带写入审批的），但**把它的记忆分支内容当作普通文件对待**，让 Claude Code / Codex 也能直接 Read——不要让记忆格式只有 dsh 能解析。

### L2（团队）
**升级触发**：§3.3 问二的 C1 / C2 / C3 任一**可测地**出现。
**装（按触发条件分别选）**：
- 触发 C1（检索失效）→ **先试最便宜的**：把 `memory/knowledge/` 的 front-matter 灌进已有的 **PostgreSQL 18**（Alan 两台机器都有），用全文检索。这是"更少的组件"路线：不新增服务，只新增一张表 + 一个重建脚本，且天然是"派生缓存绑源版本"（存 commit sha）。**只有这条路也失效了，才考虑 Graphiti。**
- 触发 C3（时间旅行）→ **Graphiti**，Apache-2.0，且是**唯一**满足 R10 双时间轴 + R11 不新的永远赢的候选。**但它只能是检索侧的派生缓存，权威永远在 git**，并且必须配那个"以 git 为源逐条回查"的对账脚本。
- 触发 C2（细粒度 ACL）→ 先问"能不能用两个 git 仓库解决"。不能，才考虑 TencentDB 的 ACL 模型；即便上，也**只用它的资产治理与 ACL，关掉 Chat Memory 的自动蒸馏**（否则同时违反 R5 和 R13）。
**不装**：mem0（LLM 可自主 DELETE 与无审批，跟 R3/R11 正面冲突）、Letta（绑运行时）、Cognee（多一层存储换不来新的可判定项）。

### L3（无人值守）
**这一档的瓶颈不在记忆层。** L3 的前置条件是"有一个不需要人在场就能拒绝坏输出的判定器"——记忆层在这里的角色是 R4：**自动晋升只在"已登记判定器覆盖 + 影响面局部可撤回"时开启**。所以 L3 的记忆改动只有一条：给 `memory/knowledge/` 的每个子目录登记"哪个判定器覆盖它"，没登记的目录**永远不允许自动晋升**。**没有任何候选产品提供这个能力**，它只能是你自己的目录约定。

### 明确不采纳（各一句理由）
- **Zep（云）/ Zep Community Edition**：CE 已明确停止维护（Apache-2.0 仓库留着但不更新），上游会砍产品线本身就是失效面。
- **mem0**：LLM 一次调用就能 DELETE 一条记忆且无人工环节，与 R3、R11 正面冲突；OSS 与云功能不等价，文档里的分数不代表你自托管能拿到。
- **Letta / MemFS / Context Repositories**：设计思路（git 作记忆载体、worktree 并发写、defragmentation）值得抄，但绑 Letta 运行时，违反 D-020。
- **Cognee**：本地可零外部服务是优点，但它提供的一切（图 + 向量 + lineage）都不解决 R2/R3/R7/R8 里任何一条，多一层存储换不来新的可判定项。
- **Basic Memory**：用一个 MCP server 去做"写 markdown"这件五个宿主本来都会做的事。
- **TencentDB-Agent-Memory 作为默认形态**：proxy 在模型调用路径上是单点；system prompt injection 违反 R13；Chat Memory 违反 R5。它的**资产 ACL 模型**是全场最好的，其余部分不要。
- **Universal Memory Protocol**：无标准组织背书、无宿主采纳，现在按标准用它等于绑一个个人项目；但它的 JSON 记录字段（时间 + 签名 + PROV）可以当 front-matter 的设计参考。
- **Codex Memories**：官方定位为 generated state 且劝阻手工编辑，写不出"它坏了怎么被发现"，按判据 C 不装。

---

## 6. 未定与待核实

1. **Claude Code auto memory 的写入是否走标准 Write/Edit 工具、因而能被 `PreToolUse` hook 拦截？** 文档说 Claude "reads and writes files in this directory"、读主题文件用 "standard file tools"，但写入路径没有明说；issue #44820 的提案者称按路径匹配 `PreToolUse` 是 "undocumented and fragile"。**未定**——这一条如果成立，L1 的审批点就能在 Claude Code 上硬化，值得 Alan 花十分钟实测。
2. **dsh-memory-evolve 的许可证**：GitHub 页面摘要显示 MIT，raw README 里我没找到许可证声明。**未定**，需打开 LICENSE 文件确认。
3. **dsh 原生（非插件）是否有会话检索/记忆**：未查到官方一手文档。本报告矩阵里 dsh 那一列的"指令文件"格是**未查到**，不是"没有"。
4. **Copilot Memory 的 28 天 TTL 是否可配**：未查到配置项，按不可配处理。
5. **Graphiti 的规模成本**："facts are never deleted" 在长期（几年、几万 episode）下的图规模与检索延迟，我没有任何一手或厂商数据。官方引用的 LoCoMo 94.7% / 155ms 按 §1.4 只记为"该团队在该条件下报告的观察"，不作论据。
6. **需要 Alan 裁的**：`memory/knowledge/` 到底是**放在项目仓库内**（跟代码同生共死、天然绑源版本）还是**独立记忆仓库**（跨项目复用、但源版本对账要跨仓库）。这直接决定 R10 的 `source_version` 字段怎么填，两条路都能自洽，我不替他选。
7. **矛盾点**：R7 要求"注入即记账，分到达与有用两维"，而我**在所有候选里都没查到**任何一个提供"有用"维。这条要么由 Alan 自建（从返工记录反查），要么在规范里降级为"到达维必做、有用维选做"。目前记为 **UNDETERMINED**，不折算成"不满足"。

---

## 7. 来源

1. [How Claude remembers your project — Claude Code Docs](https://code.claude.com/docs/en/memory) — 2026-09-07 — [厂商文档] — §1.2 矩阵、§2.2、§3.1、§4
2. [Memories — ChatGPT / Codex 官方文档](https://learn.chatgpt.com/docs/customization/memories?surface=app)（由 `developers.openai.com/codex/memories` 302 跳转）— 2026-09-07 — [厂商文档] — §1.2、§2.3、§3.1、§4
3. [Building an agentic memory system for GitHub Copilot — The GitHub Blog](https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/) — 2026-09-07 — [厂商文档] — §2.4、§3.1
4. [Feedback wanted: Copilot Memory now on by default — community discussion #184415](https://github.com/orgs/community/discussions/184415) — 2026-09-07 — [厂商文档] — §1.2、§2.4（28 天过期、仓库级、owner 复核）
5. [csyangwen/dsh-memory-evolve](https://github.com/csyangwen/dsh-memory-evolve) 及其 [raw README](https://raw.githubusercontent.com/csyangwen/dsh-memory-evolve/main/README.md) — 2026-09-07 — [厂商文档] — §2.5、§3.1（待确认队列、五轨、git 分支标记、会话搜索）
6. [opencode — Rules 文档](https://opencode.ai/docs/rules/) — 2026-09-07 — [厂商文档] — §1.2（opencode 无原生模型自写记忆）
7. [Bi-Temporal Data Model — Graphiti 文档](https://mintlify.wiki/getzep/graphiti/concepts/temporal-model) — 2026-09-07 — [厂商文档] — §3.2 R10/R11（四时间戳、temporal edge invalidation、facts are never deleted）
8. [Graphiti — GitHub](https://github.com/getzep/graphiti) — 2026-09-07 — [厂商文档] — §2.7（Apache-2.0、v0.29.2 / 2026-06-08、必须图数据库、含 mcp_server）
9. [Announcing a New Direction for Zep's Open Source Strategy](https://blog.getzep.com/announcing-a-new-direction-for-zeps-open-source-strategy/) — 2026-09-07 — [厂商文档] — §2.7、§5（CE 停止维护）
10. [Memory Types — mem0 文档](https://docs.mem0.ai/core-concepts/memory-types) 与 [Expiration Date](https://docs.mem0.ai/platform/features/expiration-date)、[Changelog Highlights](https://docs.mem0.ai/changelog/highlights) — 2026-09-07 — [厂商文档] — §2.6、§3.2（LLM 决定 ADD/UPDATE/DELETE、expiration 隐藏非删除、decay、2026-08-24 DSH 插件）
11. [mem0ai/mem0 — GitHub](https://github.com/mem0ai/mem0) — 2026-09-07 — [厂商文档] — §2.6（Apache-2.0、OSS 与云功能不等）
12. [Sleep-time agents — Letta Docs](https://docs.letta.com/guides/agents/architectures/sleeptime/) 与 [Introducing Context Repositories（2026-02-12）](https://www.letta.com/blog/context-repositories/) — 2026-09-07 — [厂商文档] — §2.8、§3.2、§5
13. [Cognee — Core Concepts](https://docs.cognee.ai/core-concepts/overview) 与 [topoteretes/cognee GitHub](https://github.com/topoteretes/cognee) — 2026-09-07 — [厂商文档] — §2.9（Apache-2.0、SQLite+LanceDB+Kuzu 本地可跑、必须 LLM）
14. [TencentCloud/TencentDB-Agent-Memory — GitHub](https://github.com/TencentCloud/TencentDB-Agent-Memory) 与 [Releases](https://github.com/TencentCloud/TencentDB-Agent-Memory/releases) — 2026-09-07 — [厂商文档] — §2.10、§3.2、§3.3 问三（proxy 形态、L0→L3 蒸馏、三级可见性 ACL、system prompt injection、MIT、v2.0.1 / 2026-08-25）
15. [Linux Foundation Announces the Formation of the Agentic AI Foundation (AAIF)](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation) 与 [MCP joins the Agentic AI Foundation](https://blog.modelcontextprotocol.io/posts/2025-12-09-mcp-joins-agentic-ai-foundation/) — 2026-09-07 — [厂商文档] — §1.1（AAIF 锚定 MCP/goose/AGENTS.md，无记忆规范）
16. [Universal Memory Protocol](https://universalmemoryprotocol.io/) — 2026-09-07 — [厂商文档（自有站点）] — §1.1、§5（无组织背书）
17. [anthropics/claude-code issue #44820: PreMemoryWrite / PostMemoryWrite hook events](https://github.com/anthropics/claude-code/issues/44820) — 2026-09-07 — [厂商文档（官方仓库 issue）] — §1.2、§4（closed as not planned）
18. [Basic Memory 文档](https://docs.basicmemory.com/) — 2026-09-07 — [厂商文档] — §2.11、§5

---

自评：我最没把握的三个判断是 ① Claude Code auto memory 的写入能否被 `PreToolUse` hook 拦截——这一条我只有 issue #44820 的间接证据，而它直接决定"审批点能否在 Claude Code 上硬化"，值得实测推翻我；② "L2 检索失效先用 PostgreSQL 18 全文检索、再考虑 Graphiti"这个次序，我没有任何规模数据支撑，只是按"更少的组件"推的，若 Alan 的知识条目本来就是强关系型（大量"A 决策影响 B 模块"），可能一开始就该上图；③ 我把 proxy 抓会话判为"与 R5 形态性冲突"，但这个结论依赖"proxy 看不到交付链状态转换"这一前提——如果把 CI 结果也灌进同一条 proxy 流（技术上可做），冲突就退化成配置问题而非形态问题，我倾向于自己这个判断偏严。
