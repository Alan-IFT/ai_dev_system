# 上下文装配（22）：候选、标准与对照

## 0. 验证边界

- **检索日期**：2026-09-07。所有版本号与"最新状态"以该日为准。
- **我亲自打开并读全文的页面**（WebFetch 取回正文，由小模型转述，非我逐字读源码）：
  - Claude Code 官方文档 `code.claude.com/docs/en/`：memory、hooks、hooks-guide、context-window、sub-agents、skills、monitoring-usage、costs、settings-reference。其中 context-window 与 hooks-guide 的原文（60KB / 80KB）被落到本地文件，我用 grep/sed **逐字读了**"What survives compaction"表与"Re-inject context after compaction"节。
  - Codex 官方文档（`learn.chatgpt.com/docs/`，由 `developers.openai.com/codex/*` 302 重定向而来）：hooks、config-reference、agent-configuration/agents-md。
  - opencode 官方文档 `opencode.ai/docs/`：rules、config、plugins、agents，以及 `opencode.ai/v2/docs/instructions`。
  - VS Code 官方文档 `code.visualstudio.com/docs/agent-customization/custom-instructions` 与旧路径 `docs/copilot/customization/custom-instructions`。
  - dsh 官方仓库文件 `raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/context/agent-instructions/README.md`（**这是唯一确证归属 deepseek-ai 的 dsh 一手文件**）；以及文档站 `deepseek-harness.github.io/deepseek-harness/en/reference/…` 的 architecture / agent-lifecycle / subsystems/{compaction, system-prompt, skills, spill, token-meter, subagent}。
  - MCP 规范 `modelcontextprotocol.io/specification/2025-06-18/server/tools`。
  - Anthropic `platform.claude.com/docs/en/build-with-claude/context-editing`；`anthropic.com/engineering/effective-context-engineering-for-ai-agents`。
- **我一手实测（在本次会话里亲历，非读文档）**：
  1. Claude Code 把超大工具返回落盘：两次 WebFetch 返回 60.1KB / 79.9KB 时，会话里收到的是 `<persisted-output>` 包裹的**前 2KB 预览 + 落盘路径**，正文写在 `~/.claude/projects/<project>/<session>/tool-results/<tool_use_id>.txt`。我用 `ls -la` 确认了该目录里 4 个文件（61536–78013 字节），并用 grep/sed 回源读取。
  2. 工具 schema 的渐进披露：本会话系统提示里约 90 个工具**只列名字不给 schema**，必须先调 `ToolSearch` 取回 `<functions>` 定义才能调用。
  3. Skills 的渐进披露：系统提示里 skills 只有 name + 一句 description，没有 SKILL.md 正文。
- **没打开只看了搜索结果标题/摘要的**：`openai/codex` issue #7138（"AGENTS.md is silently truncated without any warning within the TUI"）；`deepwiki.com/openai/codex/3.11-hooks-system`（我打开了，但它是第三方对源码的转述，记 [二手]）；ccusage 仓库页（打开了 README 渲染页，未读源码）；dsh 社区插件 dsh-context / dsh-cost-meter 的仓库说明页。
- **未查到**：Codex 是否有"工具返回落盘按引用回源"机制；Copilot 的压缩产物构成与是否重读工作集；dsh 的缓存命中（cache read/write）计量；opencode 的原生用量归因（按 skill / MCP 分摊）；OTel GenAI 语义约定的当前稳定级别（原页面已迁走，新仓库正文未取到）。
- **文档站归属存疑**：`deepseek-harness.github.io` 属于 GitHub 组织 `deepseek-harness`，而代码仓库在 `deepseek-ai/deepseek-harness`。二者是否同一维护方**我未能证实**。凡引自该文档站的，本报告一律标 [厂商文档?]，不当作确证。

---

## 1. 2026 年的行业标准与主流实践

**先答结论：上下文装配这一层没有开放标准。** 有三个"半标准"各覆盖一小块，剩下的（尤其是压缩的可拦截点、装配清单的唯一性、成本三轴）是**事实收敛**，不是规范。

| 半标准 | 覆盖 22 的哪一块 | 归属组织 | 状态 | URL |
|---|---|---|---|---|
| **AGENTS.md** | 指令文件的**位置与命名**（不含加载语义、不含预算） | agentsmd 社区仓库（OpenAI 发起），无正式标准组织 | 事实标准，无版本号、无一致性测试 | agents.md |
| **Agent Skills / SKILL.md** | **渐进披露**（name+description 常驻，正文按需） | Anthropic 提出，多家实现 | 事实标准；各家的预算与截断规则**各不相同** | code.claude.com/docs/en/skills |
| **MCP `resource_link`** | **工具返回按引用回源**（返回 URI 而非正文） | Model Context Protocol，spec 2025-06-18（2026-07-28 有 RC） | 规范正文里是 `MAY`，非强制 | modelcontextprotocol.io/specification/2025-06-18/server/tools |
| （对照）OTel GenAI semconv | 成本三轴的**词汇** | OpenTelemetry；已从主 semconv 仓库迁至独立仓库 `open-telemetry/semantic-conventions-genai` | **未稳定**；我未取到正文，稳定级别记「未定」 | github.com/open-telemetry/semantic-conventions-genai |
| （对照）Anthropic Context Editing | 工具返回的服务端清理 | Anthropic，**厂商 API 非标准**，beta header `context-management-2025-06-27` | beta | platform.claude.com/docs/en/build-with-claude/context-editing |

**最重要的事实收敛（不是标准，但五宿主里四个用了同一组事件名）**：`PreCompact` / `PostCompact` / `SessionStart(source=compact)`。Claude Code、Codex、VS Code Copilot 三家的钩子事件名**逐字相同**，Copilot 甚至直接读 `.claude/settings.json` 和 `.github/hooks/*.json` 两处。这意味着 22 的「压缩是可拦截的生命周期事件」这条**在四个宿主上可以用同一份钩子脚本落地**——这是本次调研最有价值的发现。

### 矩阵：五宿主 × 22 的七个机制

| 机制 | Claude Code | codex | opencode | dsh | VSCode Copilot |
|---|---|---|---|---|---|
| 指令文件层级（根→cwd 拼接） | 满足 `CLAUDE.md`+`CLAUDE.local.md`，root→cwd 顺序拼接 [厂商文档] | 满足 `~/.codex/AGENTS.md` + git root→cwd 链，每目录至多一文件 [厂商文档] | 满足 全局 `~/.config/opencode/AGENTS.md` + 向上遍历 [厂商文档] | 满足 `$DSH_HOME/AGENTS.md` + 项目链，含 `AGENTS.md`/`CLAUDE.md`/`*.local.md` [厂商文档] | 部分 根级 `AGENTS.md`/`.github/copilot-instructions.md`；嵌套为实验特性 [厂商文档] |
| 子目录**惰性**加载 | 满足 子目录 CLAUDE.md 在读该目录文件时才注入 [厂商文档] | 不满足 启动时一次性建链 [厂商文档] | 满足 v2 读文件时向上发现并**每会话注入一次** [厂商文档] | 未查到 | 部分 `chat.useNestedAgentsMdFiles` 只把**相对路径**加入上下文，不加正文 [厂商文档] |
| 条件加载（按 glob/角色） | 满足 `.claude/rules/*.md` 的 `paths:` frontmatter [厂商文档] | 未查到 | 部分 `instructions` 支持 glob，但 v2 声明「解析保留但不解析为指令源」 [厂商文档] | 未查到 | 满足 `*.instructions.md` 的 `applyTo:` glob [厂商文档] |
| 字节预算 + **告知模型** | 部分 有 4 MiB 上限（超限跳过）、MEMORY.md 200 行/25KB、skill listing 1% 上下文；**丢弃是否告知模型未查到** [厂商文档] | 不满足 `project_doc_max_bytes` 默认 32 KiB，**静默截断**（issue #7138 标题，[二手] 只看了标题） | 未查到 | **满足** `maxBytes` 必填；**先整份丢弃更宽的文件，最后才截断最具体的那份**，并发出 `Workspace instruction budget …` 通告，**点名被省略与被截断的路径** [厂商文档] | 未查到 |
| 压缩前可拦截 | 满足 `PreCompact`（exit 2 / `permissionDecision:deny` 可阻断），`PostCompact`，`SessionStart` matcher=`compact` 可 `additionalContext` 注入 [厂商文档] | 满足 `PreCompact`/`PostCompact`（`continue:false`），`SessionStart` source=`compact` + `additionalContext` [厂商文档] | 满足 插件钩子 `experimental.session.compacting`，可 `output.context.push()` 注入或直接**替换 `output.prompt`**；事件 `session.compacted` [厂商文档] | 满足（更强）压缩是**能力位**：服务定义 `dsh-compaction` / 提供者 `dsh-compaction-basic` 可整体替换；事件 `compaction/start`、`compaction/summary`、`compaction/end` [厂商文档?] | 满足 agent hooks 含 `PreCompact`，配置在 `.github/hooks/*.json` 或 `.claude/settings.json` [厂商文档] |
| 大工具返回落盘按引用 | **满足** 超限落 `tool-results/<tool_use_id>.txt`，会话内只留预览+路径 [一手实测] | 未查到 | 部分 `compaction.prune` 移除旧工具输出（是删除不是落盘） [厂商文档] | **满足** spill storage：`maxInlineBytes` 超限则替换为「head/tail 预览 + `SpillLocator` + `retrievalHint`（告诉模型用 read/grep）」 [厂商文档?] | 未查到 |
| 成本三轴可观测 | **满足** 见 §3-15 [厂商文档] | 部分 需 ccusage [二手] | 部分 需 ccusage [二手] | 部分 `ctx.tokenMeter` + 社区 dsh-cost-meter；缓存轴未查到 [厂商文档?]/[二手] | 部分 需 ccusage（支持 Copilot CLI） [二手] |

---

## 2. 候选清单

### 候选 0 —— 纯文件：一份「装配清单」+ 每宿主一个 shim 文件
- **是什么**：仓库里一份 `context-manifest.md`（唯一权威），各宿主的入口文件（`CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md`）只写一行 import 指向它。
- **维护状态**：无上游，不存在停更。
- **部署形态**：文本文件，零依赖。
- **许可证**：你自己的。
- **层**：**通用层**（五宿主全覆盖）。Claude Code 官方就推荐 `CLAUDE.md` 里写 `@AGENTS.md` 或建符号链接来复用 [厂商文档]。
- **来源**：code.claude.com/docs/en/memory §AGENTS.md。

### 候选 1 —— Claude Code 原生上下文栈
- **是什么**：CLAUDE.md 层级 + `.claude/rules/`（`paths:` 条件加载）+ Skills 渐进披露 + hooks（PreCompact/PostCompact/SessionStart(compact)/InstructionsLoaded）+ subagent（隔离）/ fork（继承）+ 工具返回落盘 + `/context` `/usage` + OTel 导出。
- **维护状态**：活跃，文档里逐条标注版本门槛（如 v2.1.251 的 prompt cache 行、v2.1.242 的 `modelPricing`）。
- **部署形态**：宿主自带，零额外组件。
- **层**：**宿主绑定层**。
- **来源**：code.claude.com/docs/en/{memory,hooks,context-window,skills,costs,monitoring-usage}。

### 候选 2 —— dsh 原生上下文栈
- **是什么**：`dsh-agent-instructions`（maxBytes + 预算通告）、`dsh-compaction` 能力位（可替换提供者）+ `ctx.toolResultPruner`、spill storage（`maxInlineBytes` + `SpillLocator` + `retrievalHint`）、skills catalog（`catalogDescriptionMaxLength` 默认 500）、`ctx.subagents`（spawn 隔离 / fork 继承 + `toolFilter`）、`ctx.tokenMeter`。
- **维护状态**：rc 阶段；`experimental` 前缀少，但文档站归属存疑。
- **部署形态**：宿主自带 + 插件。
- **层**：**宿主绑定层**。
- **来源**：deepseek-ai 仓库 agent-instructions/README.md [厂商文档]；其余 [厂商文档?]。

### 候选 3 —— Codex 原生栈
- **是什么**：AGENTS.md 指令链（32 KiB）+ hooks（含 PreCompact/PostCompact）+ `compact_prompt` / `experimental_compact_prompt_file` 覆盖压缩提示词 + `model_auto_compact_token_limit`。
- **层**：宿主绑定层。**它是五个里唯一允许你直接改压缩提示词的**（Claude Code 只能在 CLAUDE.md 里写「# Compact instructions」软引导 [厂商文档]）。
- **来源**：learn.chatgpt.com/docs/{hooks,config-file/config-reference,agent-configuration/agents-md}。

### 候选 4 —— opencode
- **是什么**：AGENTS.md 链 + `instructions` glob/URL + 插件钩子 `experimental.session.compacting`（可替换压缩 prompt）+ `compaction.{auto,prune,reserved}`（默认 true / false / 10000）+ Task 子代理与 `permission.task`。
- **层**：宿主绑定层。
- **来源**：opencode.ai/docs/{rules,config,plugins,agents}、/v2/docs/instructions。

### 候选 5 —— VS Code Copilot
- **是什么**：`.github/copilot-instructions.md` + `AGENTS.md`（`chat.useAgentsMdFile`）+ 嵌套实验（`chat.useNestedAgentsMdFiles`，只注入相对路径）+ `*.instructions.md` 的 `applyTo` + `CLAUDE.md`（`chat.useClaudeMdFile`）+ `.claude/rules` 兼容 + agent hooks（含 `PreCompact`）。
- **层**：宿主绑定层，但**读 `.claude/` 配置这点让它半只脚踏进通用层**。
- **来源**：code.visualstudio.com/docs/agent-customization/custom-instructions；microsoft/vscode-copilot-chat 仓库内 hooks.md。

### 候选 6 —— Anthropic Context Editing API（`clear_tool_uses_20250919`）+ memory tool
- **是什么**：服务端在 prompt 到模型之前清掉旧工具结果，参数 `trigger`（默认 100k input tokens）、`keep`（默认 3 个 tool use）、`clear_at_least`、`exclude_tools`、`clear_tool_inputs`；被清的位置**留占位文本告诉模型「这里被移除了」**；响应回 `context_management.applied_edits`（`cleared_tool_uses`、`cleared_input_tokens`）。
- **部署形态**：API 参数，需 beta header。Alan 走自建 sub2api 网关 → **可以在网关侧统一施加，对五个宿主都生效**（前提是宿主不自己算 token 预算而冲突）。
- **层**：介于两者之间——**模型侧**，不是宿主侧。
- **来源**：platform.claude.com/docs/en/build-with-claude/context-editing。

### 候选 7 —— ccusage
- **是什么**：读本地各 agent CLI 的用量文件，出日/月/会话/5 小时块报表，分模型、**分 cache creation 与 cache read**。
- **维护状态**：活跃；MIT；作者 @ryoppippi。README 声称已支持 Codex、OpenCode、GitHub Copilot CLI、Gemini CLI 等十余家。
- **层**：**通用层**（跨宿主，唯一一个）。
- **来源**：github.com/ryoppippi/ccusage。

### 候选 8 —— OTel + 自建 collector
- **是什么**：`CLAUDE_CODE_ENABLE_TELEMETRY=1` 导出 `claude_code.token.usage`（属性 `type`=input/output/**cacheRead/cacheCreation**、`model`、`query_source`=main/subagent/auxiliary、`agent.name`、`skill.name`、`plugin.name`、`mcp_server.name`、`mcp_tool.name`）与 `claude_code.cost.usage`。
- **层**：宿主绑定层（只有 Claude Code 原生导出）；但 OTLP 是通用协议。
- **来源**：code.claude.com/docs/en/monitoring-usage。

### 候选 9 —— dsh-context / dsh-cost-meter 社区插件
- **是什么**：dsh-context 给上下文构成六分类（system prompt / tool schemas / user messages / injected context / assistant replies / tool results）与压缩、剪枝、注入事件时间线；dsh-cost-meter 给会话/每日成本。
- **层**：宿主绑定层，社区维护。
- **来源**：github.com/bowenliang123/dsh-context、github.com/Han-1413141/dsh-cost-meter [二手，仓库说明页]。

---

## 3. 对照 22「必须做到的」

「最小满足形态」一栏按「少就是多」写——能用一个文本文件解决的，就不写组件。

| # | 22 的要求 | 最小满足形态 | 候选 0 文件 | 候选 1 CC | 候选 2 dsh | 候选 3 codex | 候选 4 opencode | 候选 5 Copilot | 候选 6 网关 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 唯一一份默认加载清单 | 一份 `context-manifest.md`，各宿主入口只 import 它 | **满足**[厂商文档] | 部分：CLAUDE.md 是拼接不是唯一，需靠纪律收敛 [厂商文档] | 部分：同上，链式拼接 [厂商文档] | 部分 [厂商文档] | 部分 [厂商文档] | 部分：多文件「不保证顺序」[厂商文档] | 不满足 |
| 2 | 可按角色与环境参数化但仍唯一 | 清单里分节 + 各宿主条件加载指向同一节 | 部分：文本无参数化能力 | 满足：`paths:` rules + subagent `skills` 字段 [厂商文档] | 部分：skills 目录分级，未查到按角色参数化 | 未定 | 部分 | 满足：`applyTo` glob [厂商文档] | 不满足 |
| 3 | 约束优先级显式可查 | 清单里写死优先级表 + `/context` 类命令核对 | 部分：写得出，查不出 | **满足**：`/context` 列出 Memory files；`InstructionsLoaded` 钩子记录**何时、为何**加载（reason 含 `session_start`/`nested_traversal`/`path_glob_match`/`include`/`compact`）[厂商文档] | 部分：预算通告点名路径，但无优先级视图 [厂商文档] | 部分：文档写明 root→cwd「越近越覆盖」，无运行时视图 | 部分 | **不满足**：官方明说多文件「no specific order is guaranteed」[厂商文档] | 不满足 |
| 4 | 分层加载：先索引后正文 | 入口只放地图，正文按需读 | 部分：靠人写 | **满足**：skill listing 只有 name+desc（预算 1% 上下文、desc 截断 1536 字符），正文按需；MCP schema 默认 deferred [厂商文档 + 一手实测] | **满足**：skills catalog 只回「kebab-case id + 短路由描述」，正文靠 `ctx.skills.get()`；`catalogDescriptionMaxLength` 默认 500 [厂商文档?] | 未查到 | 未查到 | 部分：嵌套 AGENTS.md **只注入相对路径**（这恰好就是「先索引」）[厂商文档] | 不满足 |
| 5 | 分层加载：先片段后扩展 | 大文件先读片段 | 部分 | 满足：压缩后 >5000 token 的文件回来是 `Referenced file`（只有路径无正文）[厂商文档] | 满足：spill 的 head/tail 预览 + locator [厂商文档?] | 未查到 | 部分：`compaction.prune` 是删不是缩 | 未查到 | 满足：`clear_tool_uses` 留占位文本 |
| 6 | 启动固定开销计入预算 | 手工估算写进清单 | 部分 | **满足**：`/context` 分类实时统计；文档给出启动各段构成 [厂商文档] | 满足：dsh-context 插件给六分类 + top-5 最贵 tool schema [二手] | 部分：只有 `project_doc_max_bytes` 一个静态上限 | 部分：`compaction.reserved` 默认 10000 是留白不是核算 | 未查到 | 不适用 |
| 7 | **压缩与会话结束是同等的、可在其前被拦截的生命周期事件** | 一个 PreCompact 脚本 + 一个 SessionEnd 脚本，两边写同一份「落状态」逻辑 | 不满足（文件不能拦截） | **满足**：`PreCompact`（可 deny 阻断）、`PostCompact`、`SessionEnd`、`SessionStart(compact)` [厂商文档] | **满足**：`PreCompact`/`PostCompact`（`continue:false`）、`SessionEnd`、`SessionStart(source=compact)` [厂商文档] | **满足（最强）**：压缩整体是可替换能力位 + `compaction/{start,summary,end}` 事件 [厂商文档?] | 满足：`experimental.session.compacting` 可注入或**替换 prompt**；`session.compacted` 事件 [厂商文档] | 部分：有 `PreCompact` 与 `Stop`，是否可阻断未查到 [厂商文档] | 不满足 |
| 8 | 每种策略声明丢什么留什么 | 清单里写一张「压缩策略表」 | 满足（写得出） | **满足**：官方给了逐机制的「What survives compaction」表 [厂商文档，我逐字读了] | 部分：文档说明 summary 替换 span、保 tool-call/result 配对，无逐机制表 [厂商文档?] | 部分：可改 `compact_prompt`，无「丢什么」声明 | 部分 | **未查到** | 满足：参数即声明（keep/exclude_tools）[厂商文档] |
| 9 | 压缩产物分两半：叙事摘要 + 活动工作集**按引用重载** | 摘要 + 一份 `working-set.md` 路径清单，压缩后重读 | 部分：靠 hook 才自动 | **满足**：摘要 + 自动重读最近修改的至多 5 个文件（>5000 token 者只回路径）+ 重注入 CLAUDE.md/rules/plan/已调用 skill 正文（单 skill 5000 token 上限、合计 25000）[厂商文档] | 部分：summary node + 工具结果 head/tail+locator；**未查到**「重读工作集」 [厂商文档?] | 未查到 | 未查到 | 未查到 | 部分：只做工具结果一半 |
| 10 | 窗口重建后不变量重新锚定 | `SessionStart(compact)` 钩子重述不变量 | 不满足 | **满足**：官方文档就有「Re-inject context after compaction」示例 [厂商文档，逐字读了] | **满足**：`SessionStart` source=`compact` + `additionalContext` [厂商文档] | 满足：`experimental.session.compacting` push context [厂商文档] | 部分：有 `PreCompact`，压缩后注入未查到 | 部分 | 不满足 |
| 11 | 工具返回默认只服务当前决策 | 约定「大输出先落盘再摘要」写进方法库 | 部分（提醒级） | **满足**：超限自动落盘，会话里只留预览+路径 [一手实测] | **满足**：spill storage + `retrievalHint` [厂商文档?] | 未查到 | 部分：`compaction.prune` 事后删除 [厂商文档] | 未查到 | 满足：`clear_tool_uses_20250919` [厂商文档] |
| 12 | 原文外部化、读写两侧对称 | 落盘路径可被 read/grep 回源 | 部分 | **满足**：`tool-results/<tool_use_id>.txt`，我用 grep/sed 回源成功 [一手实测] | **满足**：`retrievalHint` 明确「用 read 或 grep 打这个路径」[厂商文档?] | 未查到 | **不满足**：prune 是丢弃，无回源 | 未查到 | 部分：清掉就没了，需配 memory tool 才对称 [厂商文档] |
| 13 | **有损压缩须有可机械检测的损失信号并能回退** | 落盘时输出「原始 N 字节 / 保留 M 字节 / 路径」一行 | 部分（可自己写） | 部分：`Output too large (60.1KB)` + 路径 [一手实测]；`/usage` 有 `expected rebuild (compaction or tool-result clearing)` 计数 [厂商文档]；`/rewind` 可回退 [厂商文档]。**但压缩摘要本身不产出损失清单** | **满足（唯一）**：`Workspace instruction budget …` 通告**点名被省略与被截断的路径**，且策略是「先整份丢更宽的、最后才截最具体的」——损失是结构化的、可枚举的 [厂商文档，deepseek-ai 官方仓库] | **不满足**：32 KiB 静默截断（issue #7138 标题，[二手] 只看了标题，未打开） | 未查到 | 未查到 | 满足：响应回 `cleared_tool_uses` / `cleared_input_tokens` [厂商文档] |
| 14 | 三类隔离原语：委托 | 子代理带独立窗口 | 不满足 | **满足**：subagent 独立上下文窗口，只回最终结果 [厂商文档] | **满足**：`ctx.subagents.start()`，spawn 后端「child 拿新的扁平 scope，不继承 parent 注册」[厂商文档?] | 满足：`SubagentStart`/`SubagentStop` 钩子存在 [厂商文档] | 满足：Task 工具 + 子会话 [厂商文档] | 满足：`SubagentStart`/`SubagentStop` [厂商文档] | 不适用 |
| 15 | 三类隔离原语：分叉 | 继承全量历史的旁支 | 不满足 | **满足**：fork 子代理「继承整个对话、同一 system prompt/tools/model/历史」，工具调用不回主线 [厂商文档] | **满足**：fork 后端传「parent log 的平衡完整轮次前缀」[厂商文档?] | 未查到 | 部分：子会话可导航，是否继承历史未查到 | 未查到 | 不适用 |
| 16 | 三类隔离原语：压缩外部化 | 压缩前把要留的写进外部文件 | 部分 | 满足：`PreCompact` 落盘 + `SessionStart(compact)` 回读 [厂商文档] | 满足：spill + compaction 事件 [厂商文档?] | 满足：同 CC 的两段式 [厂商文档] | 满足：compacting 钩子里写外部 [厂商文档] | 部分 | 部分：配 memory tool [厂商文档] |
| 17 | **委托必须声明治理继承** | 子代理定义文件里显式写「继承/不继承哪几条」 | 部分：写得出但不生效 | 部分：文档明确列了「不继承什么」（output style、auto memory、父窗口大小；Explore/Plan 连 CLAUDE.md 都不加载），权限「父为 bypassPermissions/acceptEdits 则不可覆盖」——**是文档声明，不是运行时可查的合同** [厂商文档] | 部分：`toolFilter` 落到 `tools.restrict()`，官方说「从 prompt 消失**且**拒绝执行」——比 A 组一手证实的可见性过滤强，**但那是 subagent 创建窗口这一条路径，与 `ctx.tools.restrict` 的通用行为是否一致我未能证实** [厂商文档?] | 未查到 | 部分：`permission.task` 可按名 deny/ask [厂商文档] | 未查到 | 不适用 |
| 18a | 成本轴①**来源**（哪份指令/技能/MCP 花的） | 无最小形态——这一轴要么宿主给，要么没有 | 不满足 | **满足**：`/usage` 归因到 skills / subagents / plugins / **各个** MCP server 的百分比（一个 MCP server 的份额只计"消费了它的工具结果"的请求）；OTel 属性 `skill.name` `plugin.name` `mcp_server.name` `mcp_tool.name` `marketplace.name` [厂商文档] | 部分：dsh-context 给「system prompt / tool schemas / user messages / injected context / assistant replies / tool results」六分类与 top-5 最贵 tool schema，是**构成**不是**花费归因** [二手] | 未查到 | 未查到 | 未查到 | 不满足 |
| 18b | 成本轴②**缓存命中** | ccusage：分 cache creation 与 cache read 两类 token | 不满足 | **满足**：`Prompt cache (main)` 行给请求数、input token 命中率、miss 数与**可能原因**（如 `likely cause: tool definitions changed`）、`expected rebuild (compaction or tool-result clearing)` 计数、warm/cold + TTL；OTel `type=cacheRead/cacheCreation`。**注意：该行只覆盖主对话，不含 subagent**（即轴②与轴③在 CC 上并不完全正交）[厂商文档] | **未查到** | 部分：ccusage 给两类 token，无 miss 归因 [二手] | 部分：同左 | 部分：同左 | 部分：响应带 cache 字段 |
| 18c | 成本轴③**执行单元** | 子代理各自独立计费的读数 | 不满足 | **满足**：OTel `query_source=main/subagent/auxiliary` + `agent.name`（自定义者脱敏为 `custom`）；`/usage` 的 Loops 行按调度任务分摊（触发频率、运行次数、总/单次 token、上次运行时间）[厂商文档] | 部分：`ctx.subagents` 有 `subagent/start`、`subagent/end` 事件可自行归集；原生分单元计费未查到 [厂商文档?] | 未查到 | 部分：ccusage 有 session 维度，无 subagent 维度 [二手] | 未查到 | 不适用 |
| 19 | 压缩策略可**替换**（不只是可拦截） | 无——这是宿主能力，装配不了 | 不满足 | 部分：只能改提示词（CLAUDE.md 的 `# Compact instructions` 软引导 + `/compact <focus>`），策略本身不可换 [厂商文档] | **满足**：`dsh-compaction` 是服务定义、`dsh-compaction-basic` 只是一个提供者，「tokenizer 或模板式后端是实现同一接口的兄弟包」[厂商文档?] | 部分：`compact_prompt` / `experimental_compact_prompt_file` 可整体覆盖压缩提示词 [厂商文档] | **满足**：`experimental.session.compacting` 可直接 `output.prompt = …` 替换整个续写提示 [厂商文档] | 未查到 | 不适用 |
| 20 | 会话结束与压缩**同等对待**（同一份落状态逻辑跑两处） | 一个脚本，两个事件各挂一次 | 不满足 | **满足**：`SessionEnd` 与 `PreCompact` 都存在且都收 `transcript_path`，可挂同一脚本 [厂商文档] | 满足：`SessionEnd` + `PreCompact` [厂商文档] | 部分：有 `compaction/*` 事件与会话事件，是否对称未查到 [厂商文档?] | 部分：`session.idle`/`session.deleted` 与 compacting 钩子语义不对称 [厂商文档] | 部分：只有 `Stop`（"Agent session ends"），与 `PreCompact` 能力不对等 [厂商文档] | 不适用 |

**跨表小结**：
- 「压缩可拦截」（#7、#10、#20）是**五宿主全绿**的少数几条之一，且事件名跨三家逐字相同 —— 这条不变量可以放心写进正文，且它在 09 §5 意义上是「运行时拦截」型载体。
- 「有损压缩的损失信号」（#13）只有 dsh 真正做到，Codex 是明确的反例。这条在通用层**只能降级为「我们自己在落盘/裁剪时打一行结构化损失记录」**。
- 「唯一装配清单」（#1）**没有任何宿主原生满足**——所有宿主都是拼接语义。这条必须靠候选 0 的纪律实现，属于 09 §5 里的「静态指令」载体。
- **三轴并不真正正交**：Claude Code 的缓存统计明确「只覆盖主对话，不含 subagent」，即轴②与轴③在同一读数里无法交叉。要真三轴，只能靠 OTel 的属性组合（`type` × `query_source` × `skill.name`）在 collector 侧做聚合——**这也是 L2 推荐 OTel 而非只用 ccusage 的唯一硬理由**。

### 3b. 在「通用层」（五宿主都能用）真正落得了地的只有五条

把上表按"五宿主都不为空且不为不满足"筛一遍，剩下的是：

| 能进通用层的 | 载体类型（对照 09 §5） | 落地形态 |
|---|---|---|
| 唯一装配清单 + 优先级显式 | 静态指令 | 一份 `context-manifest.md`，各宿主入口只 import |
| 压缩前拦截 / 压缩后重锚 | 运行时拦截 | 每宿主一份等价钩子脚本（CC/codex/Copilot 三家事件名相同，opencode 用插件钩子，dsh 用能力位） |
| 三类隔离原语中的**委托** | 权限与隔离配置 | 五宿主都有子代理；合同写在子代理定义文件里 |
| 工具返回外部化（约定版） | 外部状态存储 | 让工具/脚本自己写文件、只回路径——不依赖任何宿主的落盘能力 |
| 成本的**近似**读数 | 检查器 | ccusage（跨宿主），精度不够时才上 OTel |

**落不了通用层、只能宿主绑定的**：分层加载的具体预算（各家规则完全不同）、压缩产物的两半式构成（只有 CC 有）、有损信号（只有 dsh 有）、成本三轴（只有 CC 有）、压缩策略替换（只有 dsh/opencode/codex 有，且三家形态互不相同）。这几条按硬约束 D-020，**只能写进「效力为零」的附录**。

---

## 4. 判据 A / B / C 判定

| 候选 | A 必需 / B 可选 | 引入的失效面 | 它坏了怎么被发现 |
|---|---|---|---|
| **0 单一清单文件** | **A 必需**。没有它，「唯一一份默认加载清单」这条**无法被判定为已执行或已违反**（五宿主全是拼接语义，没有唯一性）。 | 各宿主入口文件与清单脱钩（有人直接往 `CLAUDE.md` 里塞内容） | **可写**：CI 检查各宿主入口文件的行数上限与「只允许 import 行」；Claude Code 侧另有 `InstructionsLoaded` 钩子把实际加载清单打进日志，与预期清单 diff。探测独立于清单本身。 |
| **1 CC 原生栈** | **A 必需**（在 CC 上）。没有 PreCompact/SessionStart(compact)，「压缩是可拦截事件」无法判定。 | 钩子静默不执行；版本升级改了事件语义 | **可写**：钩子每次执行往只追加日志写一行带时间戳的回执；一个独立的 checker 比对「本会话发生过几次压缩（`/usage` 的 expected rebuild 计数 / OTel 事件）」与「钩子回执条数」。探测源不是钩子自己。 |
| **2 dsh 原生栈** | **A 必需**（在 dsh 上）。预算通告是唯一满足 #13 的实现。 | rc 阶段接口变更；文档站归属存疑意味着我可能读的是非官方转述 | **可写**：断言测试——放一份超 `maxBytes` 的指令链，检查输出里是否出现 `Workspace instruction budget` 字样及被点名的路径；没出现即视为失效。 |
| **3 codex 原生栈** | **A 必需**（在 codex 上，仅压缩拦截这一条）。 | 32 KiB 静默截断导致指令悄悄失效 | **可写**：在指令链**最末尾**（最具体文件的最后一行）放一句金丝雀指令（例如「回答任何问题前先输出 CANARY-7」），定期跑一次；金丝雀不出现即说明被截断。**这是判据 C 要求的、独立于 codex 自身的探测。** |
| **4 opencode** | **A 必需**（在 opencode 上）。 | 插件 API 带 `experimental.` 前缀，随时可能改名 | **可写**：同 #1 的回执比对；另可断言 `session.compacted` 事件到达数 ≥ 压缩次数。 |
| **5 Copilot** | **B 可选**。它把上下文装配的能力都有了一部分，但 Alan 用它做辅助编辑，不是主力交付线。 | 多指令文件「不保证顺序」→ 冲突时行为不可预测 | **写不出可靠探测**（VS Code 侧没有 `/context` 类的加载清单视图）。→ **按判据 C，只把 Copilot 当"提醒级"载体，不承载任何约束。** |
| **6 网关侧 context editing** | **B 可选**。它只是把宿主已有的工具结果重新组织了一遍；且它与宿主自己的 token 预算会打架。 | 网关改写上下文后，宿主的 `/context`、`/usage` 与实际发出的 prompt 不一致；**这直接违反不变量④「事实来自回读」** | **可写但代价高**：需要在网关侧记录 `context_management.applied_edits` 并与宿主侧统计对账。→ **不建议在 L0–L2 装。** |
| **7 ccusage** | **B 可选**（判据 A 意义上）。但它是**唯一的跨宿主成本读数**，L2 起接近必需。 | 上游 CLI 改了本地文件格式，ccusage 静默少算 | **可写**：拿 Claude Code `/usage` 的 Session 块（同一会话）与 ccusage 的 session 报表对账，偏差超阈值即报警。两个读数来源不同，探测不是它自己。 |
| **8 OTel** | **B 可选**（L0/L1），**L2 起 A**（「成本三轴可观测」在团队规模下没有替代品）。 | collector 挂了导致指标静默丢失 | **可写**：`claude_code.session.count` 是心跳——每天会话数为 0 而 git 有提交，即判定采集链路失效。 |
| **9 dsh-context / dsh-cost-meter** | **B 可选**。纯观测，把已有信息重新组织。 | 社区单人维护，停更 | 可写（同 #7 的对账），但收益低于成本。 |

---

## 5. 推荐与备选（按 L0→L3 分档）

### L0 一人一工具（全部是文档与人工流程）
- **装**：候选 0（一份 `context-manifest.md` + 各宿主入口只写 import/symlink）。**就这一个。**
- **不装**：钩子、OTel、ccusage、网关改写、任何服务。
- **为什么**：22 里 L0 唯一能被判定的只有「唯一清单 / 优先级显式 / 分层加载写成纪律」。其余（拦截、外部化、三轴）在 L0 没有判定者，装了也无人核对。
- **升级触发**：出现第一次「压缩后 Claude 忘了不变量、导致返工」——升 L1。

### L1 一人多会话（跨会话连续性）
- **装**：候选 0 + 候选 1/2/3/4 中**你当前主力宿主的那两个钩子**：`PreCompact`（把活动工作集路径清单写到 `.state/working-set.md`）与 `SessionStart(compact)`（重述不变量 + 回读该清单）。Claude Code 与 dsh 各配一份、逻辑相同的脚本。
- **另装**：Codex 上的**金丝雀指令**（对抗 32 KiB 静默截断）。这是判据 C 的强制配套，不是可选项。
- **不装**：OTel、ccusage、记忆服务、网关改写。
- **为什么**：22 的「压缩与会话结束是同等的可拦截事件」在 L1 第一次真正有判定者（你自己下一轮会看到状态对不对）。两个脚本 + 两个文本文件，没有新组件。
- **升级触发**：开始用 subagent/fork 分工，且**说不清一次任务的钱花在哪个单元**——升 L2。

### L2 团队（成本可观测、验证者分离）
- **装**：L1 全部 + **ccusage**（通用层，跨宿主的最低成本三轴近似）+ **Claude Code 的 OTel 导出**（唯一能同时给来源/缓存/执行单元三轴的原生手段）。收到自建 collector（Alan 已有 PostgreSQL 18 + Docker，OTel collector + Postgres 存储即可，不上 SaaS）。
- **另装**：`.claude/rules/` 的 `paths:` 条件加载 + Copilot 的 `applyTo` —— 这两个是 09 §5 要求的「同一语义、两种机制类型、不同工具」的现成实例（条件加载规则 × 两家）。
- **不装**：网关侧 context editing（与宿主统计打架，违反回读不变量）；向量库式上下文检索。
- **为什么**：到 L2 才第一次有人需要拿三轴数字做决定（谁的 skill 太贵、哪个 MCP 该关）。在此之前三轴是无人消费的数据。
- **升级触发**：出现「无人值守跑一夜、早上发现上下文被压掉关键约束」——升 L3。

### L3 无人值守
- **装**：L2 全部 + **压缩损失的机械探测**：在 dsh 上直接消费 `Workspace instruction budget` 通告；在其余宿主上自己实现——`PreCompact` 记录压缩前的不变量指纹（一组关键约束的 hash），`PostCompact` / 下一轮开头由**程序**（非模型）核对指纹是否仍在上下文中，缺失即转「未定」并停机。
- **为什么**：L3 的前置条件是「有一个不需要人在场就能拒绝坏输出的判定器」。上下文装配这一层的判定器就是这个指纹核对器——它是确定性程序，不是模型自述。
- **不装**：仍然不装网关改写、不装上下文检索服务。

### 明确不采纳
- **网关侧 Anthropic Context Editing 统一施加**：会让宿主的 `/context` `/usage` 与真实 prompt 分叉，直接违反「事实来自回读」。仅在写自己的 SDK 流水线时才考虑。
- **向量库 / RAG 式「上下文检索服务」**：判据 B 已点名向量库为可选；上下文装配这一层要的是**确定性清单**，不是相似度召回。清单不确定，优先级就不可查（#3 直接不满足）。
- **LangChain / LlamaIndex 类 context manager 中间件**：引入一整个抽象层来做「拼字符串」，与「少就是多」冲突；且它坏了怎么被发现写不出（它自己就是拼装者）。
- **自建 proxy 抓会话改写上下文**（Alan 试过的 TencentDB-Agent-Memory 形态）：同网关改写的问题，且注入内容会成为「控制流来自记忆内容」的入口（D 组的 12 明确禁止）。
- **dsh-context / dsh-cost-meter 作为交付线依赖**：可以装来看，但不要让任何判定依赖它们的读数（社区单人维护 + 只在一个宿主上有）。
- **Copilot 承载任何约束**：多指令文件「不保证顺序」+ 无加载清单视图 → 按 31 的四级定级，它最高只能是**「提醒」**级。

---

## 6. 未定与待核实

1. **dsh 文档站归属未定**。`deepseek-harness.github.io` 与 `deepseek-ai/deepseek-harness` 是否同一维护方我未证实。本报告里 dsh 的 compaction 能力位、spill storage、tokenMeter、subagent、skills 全部来自该站，若归属不实则这些证据等级须从 [厂商文档?] 降为 [二手]。**唯一确证的 dsh 一手证据是 agent-instructions 的 README（raw.githubusercontent.com/deepseek-ai/…）。** 建议 Alan 在本机 dsh 上直接验一次预算通告与 spill。
2. **dsh 的 `toolFilter` 与 `ctx.tools.restrict` 的关系未定**。文档站称 subagent 的 toolFilter「从 prompt 消失**且**拒绝执行」，而 A 组已一手证实 `ctx.tools.restrict` 是可见性过滤。两者要么是不同路径，要么文档站说法不准。**这条影响 #17「委托声明治理继承」的判定，需要 Alan 一手实测。**
3. **Copilot 嵌套 AGENTS.md 的行为自相矛盾**。同一文档站两个页面：一处说「只支持工作区根、不支持嵌套」，另一处说 `chat.useNestedAgentsMdFiles` 递归搜索并「把相对路径加入上下文」。我倾向后者（更新的路径），但记「部分成立」。
4. **Codex 的 32 KiB 静默截断只有 issue 标题为据**，我没打开该 issue，也没实测。金丝雀方案是基于该假设设计的——即使假设不成立，金丝雀也无害。
5. **OTel GenAI 语义约定的稳定级别未定**。原页面已迁至独立仓库，我未取到正文。**这影响 F 组更多**，但 22 的成本三轴如果要用标准词汇表，得先确认这个。
6. **Codex / opencode / Copilot 是否有大工具返回落盘机制，全部「未查到」**（不等于「没有」）。如果没有，那么「原文外部化、读写两侧对称」这条在通用层只能靠**约定**（让工具自己写文件、只回路径）实现——这恰好也是「少就是多」的答案，但要 Alan 裁定是否接受。
7. **需要 Alan 裁**：Claude Code 的「压缩后自动重读最近 5 个文件」是宿主替你做的工作集重载。这算不算 22 要求的「活动工作集原文按引用重载」？我判为「满足」，但它是**宿主猜的**工作集（按修改时间），不是**我们声明的**工作集。若要严格，应改判「部分」，并在 `PreCompact` 里自己写工作集清单。

---

## 7. 来源

1. [How Claude remembers your project (Claude Code memory)](https://code.claude.com/docs/en/memory) — 2026-09-07 — [厂商文档] — §1 矩阵、§3 #1/#3/#4、§2 候选 0/1
2. [Hook Events Reference (Claude Code)](https://code.claude.com/docs/en/hooks) — 2026-09-07 — [厂商文档] — §1 矩阵、§3 #7/#10、§4
3. [Automate actions with hooks (Claude Code hooks guide)](https://code.claude.com/docs/en/hooks-guide) — 2026-09-07 — [厂商文档，逐字读取「Re-inject context after compaction」节] — §3 #10、§5 L1
4. [Explore the context window (Claude Code)](https://code.claude.com/docs/en/context-window) — 2026-09-07 — [厂商文档，逐字读取「What survives compaction」表] — §3 #8/#9
5. [Subagents (Claude Code)](https://code.claude.com/docs/en/sub-agents) — 2026-09-07 — [厂商文档] — §3 #14/#15/#17
6. [Skills (Claude Code)](https://code.claude.com/docs/en/skills) — 2026-09-07 — [厂商文档] — §3 #4（渐进披露预算 1%、1536 字符、5000/25000 token 上限）
7. [Monitoring usage / OpenTelemetry (Claude Code)](https://code.claude.com/docs/en/monitoring-usage) — 2026-09-07 — [厂商文档] — §3 #18 三轴属性名
8. [Manage costs effectively (Claude Code)](https://code.claude.com/docs/en/costs) — 2026-09-07 — [厂商文档] — §3 #18（`/usage` 归因、`Prompt cache (main)` 行）
9. [Hooks (Codex)](https://learn.chatgpt.com/docs/hooks) — 2026-09-07 — [厂商文档] — §1 矩阵、§3 #7/#10
10. [Configuration Reference (Codex)](https://learn.chatgpt.com/docs/config-file/config-reference) — 2026-09-07 — [厂商文档] — `project_doc_max_bytes`、`compact_prompt`、`model_auto_compact_token_limit`
11. [Custom instructions with AGENTS.md (Codex)](https://learn.chatgpt.com/docs/agent-configuration/agents-md) — 2026-09-07 — [厂商文档] — 32 KiB 默认、root→cwd 链、启动时一次性
12. [Rules (opencode)](https://opencode.ai/docs/rules/) 与 [Instructions (opencode v2)](https://opencode.ai/v2/docs/instructions) — 2026-09-07 — [厂商文档] — §1 矩阵惰性加载
13. [Config (opencode)](https://opencode.ai/docs/config/) — 2026-09-07 — [厂商文档] — `compaction.{auto,prune,reserved}`
14. [Plugins (opencode)](https://opencode.ai/docs/plugins/) — 2026-09-07 — [厂商文档] — `experimental.session.compacting`、`session.compacted`
15. [Use custom instructions in VS Code](https://code.visualstudio.com/docs/agent-customization/custom-instructions) — 2026-09-07 — [厂商文档] — Copilot 指令文件与 `chat.useNestedAgentsMdFiles`
16. [vscode-copilot-chat / agent-customization / hooks.md](https://github.com/microsoft/vscode-copilot-chat/blob/main/assets/prompts/skills/agent-customization/references/hooks.md) — 2026-09-07 — [厂商文档，官方仓库文件] — Copilot `PreCompact` 与 `.claude/settings.json` 复用
17. [dsh `@deepseek-ai/dsh-agent-instructions` README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/context/agent-instructions/README.md) — 2026-09-07 — [厂商文档，deepseek-ai 官方仓库] — §3 #13 唯一满足项
18. [dsh 文档站：Compaction / Skills / Spill / Token meter / Subagent / Agent lifecycle](https://deepseek-harness.github.io/deepseek-harness/en/reference/) — 2026-09-07 — [厂商文档?，归属未证实] — §2 候选 2、§3 多处
19. [MCP Specification 2025-06-18 — Tools（`resource_link`）](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) — 2026-09-07 — [厂商文档] — §1 半标准表
20. [Context editing (Anthropic Platform)](https://platform.claude.com/docs/en/build-with-claude/context-editing) — 2026-09-07 — [厂商文档] — §2 候选 6、§3 #11/#13
21. [Effective context engineering for AI agents (Anthropic Engineering)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — 2026-09-07 — [厂商文档] — §5 分档理由（compaction / 结构化笔记 / 子代理 / just-in-time 三法）
22. [ccusage](https://github.com/ryoppippi/ccusage) — 2026-09-07 — [厂商文档（README）] — §2 候选 7、§5 L2
23. [dsh-context 插件](https://github.com/bowenliang123/dsh-context) — 2026-09-07 — [二手] — §2 候选 9、§3 #6
24. [openai/codex issue #7138「AGENTS.md is silently truncated without any warning within the TUI」](https://github.com/openai/codex/issues/7138) — 2026-09-07 — [二手，仅见标题，未打开] — §3 #13 codex 判为不满足的依据

---

自评：我最没把握的三个判断是 ① dsh 文档站（deepseek-harness.github.io）的归属——compaction 能力位、spill storage、subagent fork 这些"dsh 表现最好"的结论全建在它上面，若它不是官方，dsh 在 §3 里的多个"满足"都要降级为「未定」；② 把 Claude Code 压缩后"自动重读最近修改的 5 个文件"判为满足「活动工作集按引用重载」——那是宿主按修改时间猜的工作集，不是我们声明的，严格说应判「部分」；③ Codex 32 KiB 静默截断这条，我只看到 issue 标题没打开正文、也没实测，却据此把 codex 在「损失信号」一栏判为「不满足」并为它专门设计了金丝雀方案。
