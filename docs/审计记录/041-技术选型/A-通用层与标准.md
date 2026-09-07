# 跨宿主通用层与行业标准：候选、标准与对照

## 0. 验证边界

- 检索日期：**2026-09-07**（全部结论以当日可访问内容为准）。
- **亲自打开并读过全文/结构化摘要的官方页面**：
  - agents.md 首页；github.com/agentsmd/agents.md 仓库页
  - agentskills.io/specification；agentskills.io/clients（客户端展示墙，含全部条目原始数据）；github.com/agentskills/agentskills
  - modelcontextprotocol.io/specification/2026-07-28/changelog（全文）；MCP releases 页；modelcontextprotocol.io/docs/extensions/overview（全文）
  - a2a-protocol.org/latest 与 /latest/specification；aaif.io 的 AAIF 成立新闻稿与 a2a-joins-aaif 博文
  - agentclientprotocol.com 的 introduction / protocol/tool-calls / get-started/agents；ACP GitHub 仓库页
  - Claude Code：docs/en/memory、docs/en/hooks、docs/en/permissions（全文落盘后 grep）、docs/en/sandboxing（全文落盘后 grep）、docs/en/skills
  - Codex：learn.chatgpt.com/docs/agent-approvals-security、/docs/hooks、/docs/agent-configuration/agents-md、developers.openai.com/codex/skills/
  - opencode：docs/rules、docs/permissions、docs/plugins、docs/skills、docs/mcp-servers
  - VS Code Copilot：custom-instructions、agent-skills、mcp-servers、agent-customization/hooks、agents/run/approvals
  - dsh：github.com/deepseek-ai/deepseek-harness README；官方文档站 reference 的 approval / sandbox / tools / skills / permission-presets / capability-seams / develop/framework/events
- **只看了摘要、未打开原文**：Forbes 关于 A2A 入 AAIF 的报道（403，未能打开，结论改用 aaif.io 官方博文）。
- **未能打开**：agentic-ai.foundation（DNS/robots 失败）；learn.chatgpt.com/docs/skills 与 /docs/agents-md（404，改用可用路径）。
- **未查到**：
  - AGENTS.md 的**带版本号的正式规范文本**（只有一份示例性 Markdown 说明，无 MUST/SHOULD 条文、无版本号）。
  - Agent Skills 规范的**版本号、发布日期、治理机构**（仅有仓库许可证与"由 Anthropic 开发后开放"的表述）。
  - dsh 的**指令文件（AGENTS.md/DSH.md）加载规则**官方页面（reference 下无 instructions/context 条目，两次 404）。
  - dsh 的 **hook-protocol / hooks-claude-code / hooks-codex 官方文档页**（只在 DeepWiki 上找到，[二手]）。
  - 各宿主**当前实现的 MCP spec 版本号**（无一家在文档里标注 2026-07-28 或 2025-11-25）。
- 本报告不含任何配置文件全文与代码。

---

## 1. 2026 年的行业标准与主流实践

### 1.1 有开放标准的五件事

| 标准 | 归属组织 | 当前状态（2026-09-07） | 关键事实 | 证据 |
|---|---|---|---|---|
| **AGENTS.md** | **Agentic AI Foundation（AAIF），Linux Foundation 旗下**；由 OpenAI 捐赠 | **无版本号、无正式条文**的"开放格式"；网站自称 6 万+ 仓库使用 | 仓库 MIT；30+ 工具自称兼容；无 nested/`.agents/` 约定的规范文本 | [厂商文档] |
| **Agent Skills（SKILL.md）** | **无基金会**。GitHub 组织 `agentskills`；Anthropic 开发后开放 | 规范文本在线且完整（目录结构、frontmatter 表、渐进披露三层），**但无版本号无日期** | 代码 Apache-2.0 / 文档 CC-BY-4.0；必填 `name`+`description`，可选 `license`/`compatibility`/`metadata`，`allowed-tools` 标注 **Experimental** | [厂商文档] |
| **MCP** | **AAIF / Linux Foundation**；Anthropic 于 **2025-12-09** 捐赠 | 最新稳定版 **2026-07-28**（RC 于 2026-05-29，稳定版 2026-07-28），**其后无新版本** | 破坏性改版：删除会话与 initialize 握手（全面无状态）、新增必需 `server/discover`、`subscriptions/listen` 取代 SSE GET、MRTR 取代服务端发起请求、tasks 移入官方扩展、**Roots/Sampling/Logging 进入弃用期（≥12 个月）**、确立特性生命周期与弃用策略 | [厂商文档] |
| **A2A** | Google → Linux Foundation（2025-04）→ **加入 AAIF（2026-08-17）** | 规范 **1.0.0** 为最新发布版 | 官方明确写："**不是子代理协议、也不是工具调用协议**；A2A 不规定 agent 如何与自己的子代理对话、如何调用工具" | [厂商文档] |
| **ACP（Agent Client Protocol）** | **无基金会**；GitHub 组织 `agentclientprotocol`，有 GOVERNANCE.md / MAINTAINERS.md | 稳定协议版本 **`1`**；Apache-2.0 | 定义 `session/request_permission`（选项类型 `allow_once`/`allow_always`/`reject_once`/`reject_always`）与 `session/update` 的 `tool_call`/`tool_call_update` | [厂商文档] |

**没有开放标准的一件事：hooks / 拦截点。** 未查到任何标准组织的 agent hook 规范。实际发生的是**事实性收敛**：Claude Code 的事件词汇（`PreToolUse`/`PostToolUse`/`UserPromptSubmit`/`PreCompact`/`Stop`/`SubagentStop`…）被 Codex、VS Code Copilot 直接复用同名事件，VS Code 甚至**直接读 `.claude/settings.json`**，dsh 则据 [二手] 提供 `hooks-claude-code` 与 `hooks-codex` 两个方言桥。**这是事实标准，不是标准**——按简报优先级它不享受"行业标准"加分。

### 1.2 五宿主 × 五标准 支持矩阵

图例：**满足** / **部分**（括注哪部分）/ **不满足** / **未定**。每格附证据等级。

| | Claude Code | Codex CLI | opencode | dsh | VSCode Copilot |
|---|---|---|---|---|---|
| **AGENTS.md** | **不满足**：官方明写"Claude Code reads `CLAUDE.md`, not `AGENTS.md`"，给出 `@AGENTS.md` import 或 symlink 变通 [厂商文档] | **满足**：三层（`~/.codex/AGENTS.override.md`→`~/.codex/AGENTS.md`；项目根向下逐级），越近越后、上限 `project_doc_max_bytes` 默认 32 KiB [厂商文档] | **满足**：本地 `AGENTS.md`（回退 `CLAUDE.md`）+ 全局 `~/.config/opencode/AGENTS.md`，各类别首个命中者胜 [厂商文档] | **未定**：仓库自带 AGENTS.md 文件，但官方 reference 无指令加载页（两次 404）[未查到] | **满足**：`chat.useAgentsMdFile`；嵌套子目录需 `chat.useNestedAgentsMdFiles`（**实验**）；另读 `CLAUDE.md` [厂商文档] |
| **Agent Skills（SKILL.md）** | **满足**：文档自称 implements the Agent Skills open standard，并明确区分"标准字段 vs Claude Code 扩展字段" [厂商文档] | **满足**：`.agents/skills`（cwd 向上到 repo root）、`$HOME/.agents/skills`、`/etc/codex/skills`、内置；显式渐进披露 [厂商文档] | **部分**：只识别 `name`/`description`/`license`/`compatibility`/`metadata`，**不支持 `allowed-tools`**；目录含 `.claude/skills`、`.agents/skills` [厂商文档] | **部分**：有 SKILL.md 与 `.agents/skills` 目录，但**未声明遵循该标准**，官方只列 `disable-model-invocation`/`user-invocable` 两个 frontmatter 键 [厂商文档] | **部分**：`.github/skills`/`.claude/skills`/`.agents/skills`；支持 `name`/`description`+ 三个 VS Code 扩展字段，**文档未提 `license`/`allowed-tools`** [厂商文档] |
| **MCP（客户端）** | **满足**（版本号未定）：有 `Elicitation`/`ElicitationResult` 钩子佐证 elicitation 支持 [厂商文档] | **满足**（版本号未定）[厂商文档] | **满足**：local(stdio) / remote(http+oauth) [厂商文档] | **满足**：`mcp-client` 插件，stdio + streamable-http，工具名 `mcp__<server>__<tool>` [二手] | **满足**：tools/resources/prompts/MCP Apps；`.vscode/mcp.json`；加服务器需信任确认 [厂商文档] |
| **A2A** | 未查到 | 未查到 | 未查到 | 未查到 | 未查到 |
| **ACP** | **部分**：以 **Zed 的 SDK 适配器**方式接入，非原生 [厂商文档] | **部分**：以 **ACP 官方适配器**接入，非原生 [厂商文档] | **满足**：官方名单列为 native 实现 [厂商文档] | 未查到 | **满足**：GitHub Copilot 列在 native 实现名单 [厂商文档] |

### 1.3 五宿主 × 拦截/隔离/权限 支持矩阵

| | Claude Code | Codex CLI | opencode | dsh | VSCode Copilot |
|---|---|---|---|---|---|
| **hooks 事件数** | **33 个**，其中 **10 个可阻断**（PreToolUse、UserPromptSubmit、UserPromptExpansion、Stop、SubagentStop、PostToolBatch、TaskCreated、TaskCompleted、TeammateIdle、ConfigChange）[厂商文档] | **12 个**：SessionStart/SessionEnd/SubagentStart/SubagentStop/PreToolUse/**PermissionRequest**/PostToolUse/PreCompact/PostCompact/UserPromptSubmit/Stop/Interrupt [厂商文档] | **无 hooks**，改为 TS/JS 插件 + 事件总线（`tool.execute.before/after`、`permission.asked/replied`、`session.compacted` 等）[厂商文档] | **有 waterfall 拦截点**：`tools/pre-execute`（allow/ask/deny）、`tools/execute`、`tools/post-execute`、`tools/result`、`approval/request` [厂商文档]；Claude/Codex 方言桥 [二手] | **8 个**（Preview）：SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/PreCompact/SubagentStart/SubagentStop/Stop [厂商文档] |
| **阻断方式** | `hookSpecificOutput.permissionDecision: allow/deny/ask`；exit 2 强制阻断且 `allow` 不能覆盖 [厂商文档] | `permissionDecision:"deny"` / `decision:"block"` / exit 2 [厂商文档] | 在 `tool.execute.before` 里**抛异常** [厂商文档] | `tools/pre-execute` 返回 deny；`approval/request` 返回 `rejected` [厂商文档] | `hookSpecificOutput.permissionDecision: deny` [厂商文档] |
| **OS 级沙箱** | **满足**：macOS Seatbelt；Linux/WSL2 **bubblewrap + socat**（可选 seccomp 补 unix socket）；文件系统与网络**两层独立**；**仅覆盖 Bash 及其子进程** [厂商文档] | **满足**：read-only / workspace-write / danger-full-access；macOS Seatbelt、Linux **bwrap + seccomp**；workspace-write **默认断网** [厂商文档] | **不满足**（原生）：官方文档无沙箱章节；社区有 `opencode-sandbox` npm 包 [二手] | **部分**：Linux **bwrap + Landlock**、macOS Seatbelt、Windows 受限令牌 ACL；**只管文件效果——"网络与进程可见性不在此词汇表内"**；区分 full / partial 强制 [厂商文档] | **满足**：macOS/Linux/WSL2；`chat.agent.sandbox.enabled`、`...fileSystem.mac/.linux`、`...allowNetwork` [厂商文档] |
| **权限规则求值序** | **deny → ask → allow，首个命中即定**；deny 从任何层生效、**任何层都不能覆盖**；managed settings 最高（命令行也压不过）[厂商文档] | approval policy（untrusted/on-request/on-failure/never）× sandbox mode 二维 [厂商文档] | `allow/ask/deny`，**最后一条命中的规则胜**（与 Claude Code 相反）；agent 级覆盖优先于全局 [厂商文档] | `ApprovalPolicy` `'ask'`/`'never'`；**策略在 waterfall 分发之前强制，下游 answerer 无法绕过**；结果词汇 `allowed-once`/`rejected`/`cancelled`/`unavailable` [厂商文档] | `chat.tools.terminal.autoApprove`（精确名或正则，allow/deny）、`enableAutoApprove`、`global.autoApprove`、`urls.autoApprove`、`eligibleForAutoApproval`、`blockDetectedFileWrites` [厂商文档] |
| **未知默认关闭** | **部分**：deny 优先且 managed 不可覆盖；但 `bypassPermissions`/`auto` 模式存在（可用 `disableBypassPermissionsMode`/`disableAutoMode` 锁死）[厂商文档] | **部分**：`never` 策略下不提示、只受沙箱约束 [厂商文档] | **未定**：文档未说明超时/缺席时的默认走向 [未查到] | **满足**：headless 下策略切 `'never'`，**每个 ask 确定性地解析为 `rejected`**；answerer 缺失/抛错/不合规 → `unavailable` 也是失败态 [厂商文档] | **部分**：默认 `sandbox.enabled: "off"`；deny 域名恒优先于 allow [厂商文档] |
| **"工具限制"是可见性还是安全边界** | **两者都有且语义不同**：**裸工具名 deny =「把工具从 Claude 的上下文里整个移除」（可见性过滤）**；`Bash(rm *)` 这类**带参 deny = 保留工具、在调用时阻断（安全边界）** [厂商文档] | 未查到工具级"隐藏"机制；边界靠 sandbox + approval [未查到] | `tools` 配置按 glob 启/禁 MCP 与内置工具——**读作可见性过滤**；真正的边界是 permission 规则 [厂商文档，推断] | **可见性过滤（官方确认）**：`ctx.tools.restrict()` 文档原文为"Restrict global tools for the calling agent scope"，且"**scope 自身注册的工具保持可见/豁免**"，restrict 作用于 `schemas()` 构造的 model-facing projection [厂商文档]，与 Alan 的一手结论一致 | `eligibleForAutoApproval` 是审批过滤而非移除；未查到工具隐藏机制 [未查到] |

---

## 2. 候选清单

### 2.1 AGENTS.md
一句话：放在仓库里的一份纯 Markdown，给所有编码 agent 读的项目说明。
维护状态：AAIF/Linux Foundation 托管（OpenAI 于 2025-12-09 捐赠）；仓库活跃（90 open issues / 80 PR），**但无版本化规范**。
部署形态：**一个文本文件，零依赖、零运行时**。许可证：MIT。
**通用层**（Codex/opencode/Copilot 原生；Claude Code 需 import 或 symlink；dsh 未定）。

### 2.2 Agent Skills（SKILL.md）
一句话：一个目录 + 一份带 YAML frontmatter 的 SKILL.md，按需（渐进披露）加载的能力包。
维护状态：规范在线完整，**无版本号、无基金会**；客户端展示墙上有 45+ 产品。
部署形态：**目录 + 文本文件**，可选 `scripts/`/`references/`/`assets/`；零服务。许可证：Apache-2.0（代码）/ CC-BY-4.0（文档）。
**通用层**（五宿主全部有实现，但字段集不一致——见 §3）。

### 2.3 MCP（2026-07-28）
一句话：agent 与外部工具/数据之间的 JSON-RPC 协议，现已彻底无状态化。
维护状态：AAIF/Linux Foundation；稳定版 2026-07-28（发布日 2026-07-28）；有明文的 12 个月弃用窗口与 SEP 流程。
部署形态：**stdio 子进程**（本地零运维）或 **Streamable HTTP 服务**（有运维）。扩展（tasks/apps/auth）**默认关闭、须显式选入**。
**通用层**（五宿主均有客户端）。**注意失效面**：Roots/Sampling/Logging 已进入弃用；SSE 断流不再可恢复（客户端必须以新 request id 重发）。

### 2.4 A2A 1.0.0
一句话：**agent 之间**（跨组织、跨厂商）的互操作协议，靠 Agent Card 发现、以 task/message 交互。
维护状态：AAIF（2026-08-17 加入），TSC 含 AWS/Cisco/Google/IBM/Microsoft/Salesforce/SAP/ServiceNow。
部署形态：HTTP 服务 + 卡片托管。
**通用层，但与本理论无关**：官方明写它**不管子代理、不管工具调用**。五宿主是否支持——未查到。

### 2.5 ACP `1`
一句话：编辑器（客户端）↔ 编码 agent 之间的 JSON-RPC 协议，把**权限请求**与**工具调用展示**标准化了。
维护状态：GitHub 组织自治，有 GOVERNANCE/MAINTAINERS，Apache-2.0；官方 SDK 覆盖 Rust/TS/Python/Java/Kotlin。
部署形态：本地 stdio 或远程 HTTP/WebSocket。
**通用层**：opencode 与 GitHub Copilot 原生；Claude Code（经 Zed 的 SDK 适配器）与 Codex（经官方适配器）为**适配器接入**；dsh 未查到。

### 2.6 宿主 hooks（无标准，事实收敛）
一句话：在固定生命周期点上运行一个外部命令并读它的 JSON 裁定。
维护状态：Claude Code 最完整（33 事件）；Codex 12 事件；VS Code 8 事件且标 **Preview**（"配置格式与行为可能变化"）；opencode 无 hooks 只有插件；dsh 有 waterfall 事件 + 方言桥（桥仅 [二手]）。
**宿主绑定层**——但事件名与 JSON 契约高度同形，可写**一套脚本 + 五份薄适配**。

### 2.7 宿主沙箱
一句话：用 OS 机制（Seatbelt / bubblewrap / Landlock / seccomp / ACL）把子进程关起来。
**宿主绑定层**，且能力不等价（见 §1.3）。共同的最小公分母是 **`workspace-write` 语义 + 默认断网**，dsh 是例外（**不管网络**）。

---

## 3. 对照本理论的要求

### 3.1 「09 §5：一条语义要能落在≥2 种机制类型不同的载体，且两种实例不同属一个工具」

七种机制类型在五宿主上的可用性（**满足=该宿主有此类型的原生载体**）：

| 机制类型 | Claude Code | Codex | opencode | dsh | Copilot | 该类型是否**跨宿主通用** |
|---|---|---|---|---|---|---|
| 静态指令 | 满足（CLAUDE.md）[厂商文档] | 满足（AGENTS.md）[厂商文档] | 满足 [厂商文档] | 未定 | 满足 [厂商文档] | **部分**（文件名不统一：CLAUDE.md vs AGENTS.md） |
| 条件加载规则 | 满足（`.claude/rules/` + `paths:` frontmatter）[厂商文档] | 部分（AGENTS.md 逐级下沉，非按 glob 触发）[厂商文档] | 不满足（官方明言无条件作用域）[厂商文档] | 未定 | 满足（`.instructions.md` + `applyTo`）[厂商文档] | **部分** |
| 按需能力包（Skills） | 满足 | 满足 | 满足 | 满足 | 满足 | **满足**（唯一五宿主齐全的语义载体） |
| 运行时拦截 | 满足（33 事件）| 满足（12 事件）| 部分（插件抛异常）| 满足（waterfall）| 部分（8 事件，Preview）| **部分** |
| 权限与隔离配置 | 满足 | 满足 | 部分（无沙箱）| 部分（沙箱不含网络）| 满足 | **部分** |
| 外部状态存储 | 满足（就是文件/git，与宿主无关）| 同左 | 同左 | 同左 | 同左 | **满足** |
| 检查器（CI/脚本）| 满足（宿主外）| 同左 | 同左 | 同左 | 同左 | **满足** |
| 人工检查点 | 满足（审批 UI）| 满足 | 满足 | 满足 | 满足 | **满足** |

**结论（对本要求）：满足，但可选项比想象的窄。** 真正五宿主齐全的机制类型只有四类：**Skills、外部状态存储、宿主外检查器、人工检查点**。因此"同一条语义的两个不同机制类型实例"的**最省力配对是：`SKILL.md`（按需加载的规则正文）+ 仓库外部检查器（CI/脚本，落在宿主之外）**——这一对天然满足"不同属一个工具"。运行时拦截作为第三个实例只能按宿主分别落地。

### 3.2 「23 方法库」

| 要求 | 最小满足形态（少就是多） | AGENTS.md | Agent Skills | `.claude/rules`/`.instructions.md` 类 | 宿主 hooks |
|---|---|---|---|---|---|
| 只承载模型与工具拿不到的内容 | 靠**写作纪律**，非机制 | 部分：格式不阻止你写废话；Claude Code 的 `/doctor` 会主动裁掉"能从代码推出"的内容 [厂商文档] | 部分：spec 只约束 `description` 要写"做什么+何时用" [厂商文档] | 部分 | 不适用 |
| 每条规则登记分类与淘汰条件 | frontmatter 里加自定义键 | **不满足**：无 frontmatter 约定 [厂商文档] | **部分**：`metadata` 是任意 string→string 映射，可放 `category`/`expires`，但**规范不定义语义，也无人校验** [厂商文档] | 部分（有 frontmatter，但字段集由宿主定）[厂商文档] | 不满足 |
| 绑定一个失败 Case | 在 skill 目录里放 `references/` 或 `scripts/` 的回归用例 | 不满足 | **满足**：目录形态天然容纳 `scripts/` + `references/` [厂商文档] | 不满足（单文件） | 不适用 |
| 一条规则只有一个位置 | 单一文件 + 引用 | **不满足**（同一条要在 CLAUDE.md 与 AGENTS.md 各写一份，除非 import/symlink）[厂商文档] | **部分**：五宿主目录名不统一（`.claude/skills`/`.agents/skills`/`.opencode/skills`/`.github/skills`/`.dsh/skills`），**但 opencode / Codex / dsh / Copilot 都读 `.agents/skills`**，Claude Code 读 `.claude/skills` | 不满足 | 不满足 |
| 按触发条件加载而非常驻 | 渐进披露 | **不满足**：AGENTS.md 每轮常驻（Codex 计入 32 KiB 预算）[厂商文档] | **满足**：规范定义三层（约 100 token 元数据常驻 → 激活后载入正文 → 资源按需）[厂商文档] | **满足**（`paths:`/`applyTo` 按文件触发）[厂商文档] | 满足（按事件） |

**判定：23 的最小满足形态是 `SKILL.md` 目录 + `.agents/skills` 作为主位置。** AGENTS.md 在"按触发加载"和"一条规则只有一个位置"两项上**不满足**，只适合放不变的项目事实。
**关键缺口（写成"部分成立"）：规范没有为「分类 / 淘汰条件 / 绑定 Case」定义字段，也没有校验器。** `metadata` 能装下这些键，但**没有任何宿主会因为它过期而告诉你**——这一条要靠 §4 的 C 判据自己补探测。

### 3.3 「24 工具接口」

| 要求 | 最小满足形态 | MCP 2026-07-28 | 宿主原生工具 | ACP `1` |
|---|---|---|---|---|
| 工具接口是一等设计对象（名称/参数表达用途、副作用、不适用场景） | 工具描述里写清楚 | **部分**：有 `inputSchema`/`outputSchema`（放宽到任意 JSON Schema 2020-12 关键字）与 description，**但协议不要求声明副作用或不适用场景** [厂商文档] | 部分 | 部分：`tool_call.kind` 给出操作分类 [厂商文档] |
| 能力目录与权限边界分开维护 | 目录一份、权限一份 | **满足**：`tools/list` 是目录，权限完全在客户端侧 [厂商文档] | **部分**：Claude Code 的裸名 deny **同时改变目录**（把工具移出上下文），两者耦合；dsh 的 `restrict` 只改目录不改边界 [厂商文档] | 满足：`session/request_permission` 独立于工具声明 [厂商文档] |
| 隔离工作区与可观察反馈 | 宿主沙箱 + 工具返回 | 部分（协议不管隔离） | **满足**（Claude Code/Codex/Copilot/dsh 有沙箱；opencode 无）[厂商文档] | 部分 |
| **长动作有可重读的持久完成标记** | 落一个状态文件 | **满足（须显式选入）**：官方扩展 `io.modelcontextprotocol/tasks` 提供**轮询式 `tasks/get`、`tasks/update` 与"durable handles"**，且服务器可不经每请求 opt-in 直接返回 task handle [厂商文档] | 未定 | 部分：`tool_call_update` 有 pending/in-progress/completed/failed 状态，但**不保证跨连接持久** [厂商文档] |
| 外部写可幂等重试、结果第三态 | 服务端铸造的句柄 + 重试 | **部分且方向正确**：删除协议级会话后，官方指定的做法是"**服务端铸造 handle 作为普通工具参数传递**"；MRTR 要求客户端**重发原请求**并带上 `inputResponses`（天然要求服务端幂等）；`resultType` 引入 `complete`/`input_required` 两态——**但"未定/未知"没有专门的第三态值，仍要靠工具自己的返回体表达** [厂商文档] | 未定 | 不满足 |

**结论：24 的最小满足形态 = 宿主原生工具 + 沙箱（隔离与反馈）+ 一个纯文件的完成标记；只有当"长动作跨会话/跨机器"时才需要 MCP tasks 扩展。**
需要写成"部分成立"的：**MCP 没有把"结果未知"提升为协议级第三态**；`resultType` 的两个值是"完成"和"需要更多输入"，不是三态裁定。

### 3.4 「31 守卫与权限边界（宿主侧）」

| 要求 | 最小满足形态 | Claude Code | Codex | opencode | dsh | Copilot |
|---|---|---|---|---|---|---|
| 未知默认关闭（未登记动作 / 应答缺席 / 超时不放行） | 默认 deny | **部分**：deny 优先且 managed 不可覆盖；但存在 `auto`/`bypassPermissions` 两个放行模式（可锁死）[厂商文档] | **部分**：`never` 策略只剩沙箱兜底 [厂商文档] | **未定**：未查到缺席/超时语义 | **满足**：headless→`'never'`→每个 ask 确定性 `rejected`；answerer 缺失/抛错/不合规 → `unavailable`（非放行）[厂商文档] | **部分**：沙箱默认 off [厂商文档] |
| **权限在运行创建时固化、执行中只能收窄** | 会话启动即冻结 | **部分**：managed 层不可覆盖且"任一层 deny 即全局 deny"；但会话内可切 permission mode | 部分 | **不满足**：agent 级规则可覆盖全局，且**最后命中者胜**（后写的可放宽）[厂商文档] | **不满足（官方明示）**：permission preset **会话中随时可 `set()` 切换，且"框架不施加方向性限制"（可放宽）** [厂商文档] | 部分 |
| 至少两处检查有效能力，按动作对象与参数判定、不按名称字符串 | 规则层 + 拦截层 | **满足**：PreToolUse hook 与 permission 规则**两层独立求值**，且官方明写"hook 的 allow 不能绕过 deny 规则、hook 的 exit 2 优先于 allow 规则"；规则按参数匹配（`Bash(rm *)`、`Tool(param:value)`、子命令/重定向/符号链接双路径都查）[厂商文档] | **满足**：hooks（PreToolUse+PermissionRequest）+ approval policy + sandbox 三层 [厂商文档] | **部分**：permission 规则 + 插件抛异常，两层都在同一进程内 [厂商文档] | **满足**：`tools/pre-execute` 与 `approval/request` 是两条独立 waterfall，且 approval 策略在分发前强制 [厂商文档] | **部分**：hooks 为 **Preview** [厂商文档] |
| 每个拦截层有**独立于自身**的失效探测 | 另一层报告本层状态 | **不满足**：官方给了关闭开关（`disableAllHooks`，且项目设置可覆盖用户设置把它设回 false）与 `claude doctor` 的已解析设置输出，但**没有"hook 没跑成"的独立告警通道** [厂商文档] | **未定** | **未定** | **部分**：`approval/asked` + `approval/decided` **成对的审计事件**可用于"有请求无裁定"的对账，但**这两个事件本身也由同一服务发出** [厂商文档] | **未定** |
| 豁免与跳过留痕并带失效时间 | 记录 + TTL | **不满足**：`bypassPermissions`、沙箱的 `dangerouslyDisableSandbox` 逃生口、`excludedCommands` **都无内建失效时间**（`allowUnsandboxedCommands:false` 只能整体关掉逃生口）[厂商文档] | **不满足** | **不满足** | **不满足** | **不满足** |
| **"工具限制"是可见性还是安全边界** | 必须逐宿主判定 | **两种都有，语义不同**（见 §1.3）——**这是五宿主里唯一把两者做成显式对立语义并写进文档的** [厂商文档] | 未查到隐藏机制 | 可见性为主 | **可见性过滤（官方确认）** [厂商文档] | 未查到隐藏机制 |
| **四级定级**（提醒 / 工具 / 必经路径） | — | AGENTS.md·CLAUDE.md·SKILL.md = **提醒**；Skill 的 `scripts/` = **工具**；hooks 与 permission 规则 = **约束**（自动进入必经路径）；沙箱 = **约束（OS 级）** | 同左 | 提醒 + 工具 + 弱约束（无沙箱） | 提醒 + 工具 + 约束（文件效果 OS 级，网络无） | 提醒 + 工具 + 约束（hooks 为 Preview，定级降一档） |

**两条必须写成"不满足"的普遍缺口：**
1. **五个宿主没有一个为豁免/跳过提供失效时间。** 逃生口（Claude Code 的 `dangerouslyDisableSandbox`/`excludedCommands`、Codex 的 `danger-full-access`、dsh 的同名模式、Copilot 的 `global.autoApprove`）都是**无限期**的。
2. **五个宿主没有一个提供"拦截层自身失效"的独立探测。** dsh 的 `approval/asked`+`approval/decided` 成对事件最接近，但仍是自证。

---

## 4. 判据 A/B/C 判定

| 候选 | A（必需）还是 B（可选） | 引入的失效面 | 「它坏了怎么被发现」 |
|---|---|---|---|
| **AGENTS.md** | **B（可选）**：它只是把仓库里已有的信息重新组织一遍；缺了它没有哪条规范条文变得不可判定。 | 与 CLAUDE.md 双份漂移；Codex 的 32 KiB 截断静默丢内容 | **可写**：CI 里比对 `CLAUDE.md` 与 `AGENTS.md` 的 import/symlink 关系 + 字节数越界告警。**探测在宿主之外（CI），不是它自己。** → 装 |
| **Agent Skills（SKILL.md）** | **A（必需）**：23 的「按触发条件加载而非常驻」和「绑定一个失败 Case」，没有它就无法被判定为"已执行"——常驻指令文件在机制上做不到按需加载。 | ①字段集五宿主不一致（`allowed-tools` 在 opencode/Copilot 文档里没有）②`description` 写坏则永不触发，且**静默** ③ 目录名分裂 | **可写**：(a) `skills-ref validate` 做 frontmatter 机械校验（官方参考实现）；(b) 在 CI 里对每个 skill 的绑定 Case 跑一次（skill 坏了 = 用例红）；(c) 触发率记账。 → 装 |
| **MCP（核心）** | **B（可选）**，除非需要跨进程能力。五宿主都有大量内建工具；MCP 的价值是**接入自建能力**。 | ①2026-07-28 是破坏性改版，宿主实现版本**全部未查到** ②Roots/Sampling/Logging 弃用 ③SSE 断流不可恢复 ④服务器进程崩了通常只表现为"工具消失" | **可写**：把每个 MCP server 的一个只读工具做成健康探针，由 CI/cron（宿主之外）调用并断言返回值。**不能拿 agent 会话当探测。** → 有需要才装 |
| **MCP tasks 扩展** | **A（必需）——仅在有跨会话长动作时**：24 的"长动作有可重读的持久完成标记"没有它就要自己造。 | 扩展默认关闭；客户端未实现时须优雅降级；宿主支持情况**未查到** | **可写**：完成标记同时落一个文件，对账两者。**若只用文件就够，则本扩展降为 B。** |
| **A2A** | **B，且本项目不适用**：官方明写它不管子代理与工具调用。 | — | — → **不装** |
| **ACP** | **B（可选）**：它解决的是"编辑器 ↔ agent"的 N×M，Alan 是单人、宿主自带 UI。 | 适配器层（Claude Code / Codex 都是适配器接入）多一跳 | 可写（连接失败即可见），但收益为零 → **不装** |
| **宿主 hooks** | **A（必需）**：31 的"至少两处检查有效能力"与"未知默认关闭"在纯文档形态下无法判定"已违反"。 | ①VS Code 仍是 **Preview**，格式可能变 ②`disableAllHooks` 可被项目设置压过用户设置 ③opencode 无 hooks，只能用插件 ④**hook 自身失效无告警** | **可写**：让每个阻断型 hook 在放行时也写一条只追加日志，由 CI 断言"每个受管动作都有一条对应日志"（缺席 = hook 没跑）。**这条探测必须落在宿主之外。** → 装 |
| **宿主沙箱** | **A（必需）——L2 起**：31 的"权限边界"若无 OS 级强制，就只剩提醒级。L0/L1 可用人工审批替代。 | ①能力不等价（dsh **不管网络**；opencode 无沙箱）②逃生口无失效时间 ③Ubuntu 24.04 需改 AppArmor 才能让 bwrap 建用户命名空间 | **可写**：一个"故意越界"的探针命令（写工作区外的路径 / 连未授权域名），期望它失败；纳入 CI 或每日 cron。**能写出来 → 装。** |
| **A2A/ACP 之外的"跨 agent 通信"自造协议** | — | — | **写不出"它坏了怎么被发现" → 按判据 C 不装。** |

---

## 5. 推荐与备选（按 L0→L3 分档）

### L0（一人一工具，全部是文档与人工流程）
- **装**：① 一份 `AGENTS.md` 作为**唯一**指令原本，在 Claude Code 侧用 `@AGENTS.md` import 或 symlink 接过去（Windows 用 import）；② `.agents/skills/` 下的 SKILL.md，每条方法一个目录。
- **不装**：MCP、ACP、A2A、任何服务、任何图/向量库。
- **为什么**：这两样都是纯文本，零运维；`.agents/skills` 是 Codex / opencode / dsh / Copilot **四家共读**的目录，Claude Code 再加一个 `.claude/skills` 符号链接即可做到"一条规则只有一个位置"。
- **升级触发**：当你第一次发现"写在指令里的规则被忽略了"——那说明你需要的是约束不是提醒 → 进 L1。

### L1（一人多会话）
- **加装**：**一套 hook 脚本 + 五份薄适配**。以 Claude Code 的事件契约（`PreToolUse`/`PostToolUse`/`UserPromptSubmit`/`PreCompact`/`Stop`/`SubagentStop` + `permissionDecision`/exit 2）为**规范源**，因为它是超集且被 Codex、VS Code 同名复用；opencode 用 `tool.execute.before` 抛异常包一层；dsh 走 `tools/pre-execute`（若 `hooks-claude-code` 桥可用则直接复用，但该桥目前只有 [二手] 证据，须先一手验证）。
- **同时加装**：hook 的**放行日志 + CI 对账**（这是唯一能发现"hook 没跑"的手段）。
- **不装**：MCP tasks、记忆服务、编排引擎。
- **升级触发**：当出现"跨会话/跨机器的长动作"时 → 需要持久完成标记；先用文件，文件不够（跨机器）才上 MCP tasks。

### L2（团队 / 验证者与生成者分开）
- **加装**：**OS 级沙箱**，四宿主分别开（Claude Code `sandbox.enabled` + managed settings；Codex `workspace-write` 且保持默认断网；Copilot `chat.agent.sandbox.enabled:"on"`；dsh `workspace-write` **但必须另想办法管网络**）；opencode 在此档**不合格**，除非接社区沙箱插件或整体放进容器。
- **加装**：一个"故意越界"的沙箱探针，进 CI/每日 cron。
- **加装（按需）**：自建能力经 **MCP stdio** 接入（不要一上来就上 HTTP 服务）；健康探针从宿主外调用。
- **不装**：A2A、ACP。
- **升级触发**：当"豁免与跳过"开始堆积时——因为五个宿主都没有 TTL，你必须自己在 CI 里加"逃生口清单 + 到期日"对账。

### L3（无人值守）
- **前置条件（本领域侧）**：拦截层必须有**独立探测**。五宿主都不自带，因此 L3 的门槛是：**你已经有一条宿主之外的必经路径（CI/git hook），它能在 agent 不在场时拒绝坏输出。**
- **首选宿主**：**dsh**——headless 下 `ApprovalPolicy` 切 `'never'`、每个 ask **确定性地** `rejected`、策略在 waterfall 分发之前强制，是五家里唯一把"未知默认关闭"做成结构性保证而非超时约定的。
- **但必须补两个洞**：① dsh 沙箱**不管网络**（要靠容器/网络命名空间补）；② dsh permission preset **会话中可放宽**（要靠"只用一个 preset、禁止 `set()`"的外部约束补，或用 CI 对账 `sandbox/mode` 事件流）。

### 明确不采纳
- **A2A**：官方明写它不是子代理协议、不是工具调用协议；本理论的所有跨 agent 需求都落在"子执行者"上，用不到它。
- **ACP**：解决编辑器 ↔ agent 的 N×M 问题；单人 + 宿主自带 UI 的场景下净增一层适配器。
- **把 AGENTS.md 当方法库**：它常驻上下文、无 frontmatter、Codex 侧还有 32 KiB 静默截断，违反 23 的"按触发条件加载"。
- **MCP Streamable HTTP 服务化（在 L0–L2）**：stdio 子进程能做的事不要上服务；2026-07-28 已经把无状态化做完，服务化的唯一理由是多机共享。
- **自建 hook 抽象层/统一 harness**：五家事件名已同形，写抽象层是给自己造一个没有独立探测的新失效面（判据 C）。
- **依赖 `ctx.tools.restrict` 或 Claude Code 裸名 deny 做安全边界**：前者官方明示是可见性过滤；后者虽然是"从上下文移除"，但对**已经能执行同等动作的其他工具**（如 Bash 里的等价命令）无效——边界要写成带参数的 deny 或 hook。

---

## 6. 未定与待核实

1. **各宿主实际实现的 MCP spec 版本**——五家文档**没有一家**标注 2026-07-28 或 2025-11-25。2026-07-28 是破坏性改版（无状态化、删握手、删会话头），**一个宿主升级而你的 server 没升，表现可能是"工具静默消失"**。→ 需要一手实测：起一个最小 server，看客户端是否发 `server/discover`、`_meta` 里带不带 `io.modelcontextprotocol/protocolVersion`。
2. **dsh 的指令文件加载规则**（是否读 AGENTS.md、字节预算、是否告知模型截断）——官方 reference 无此页，两次 404。Alan 手上有 dsh，**这一条应由他一手实测**（简报 §4-E 提到"dsh 的字节预算裁剪并告知模型"，来源未在官方文档中找到）。
3. **dsh 的 `hooks-claude-code` / `hooks-codex` 方言桥**——只有 DeepWiki [二手]。若为真，L1 的"一套脚本五份适配"可省掉一份；若为假，dsh 侧要自己写 `tools/pre-execute` 插件。**建议一手验证。**
4. **dsh 版本状态口径冲突**：官方 README 写 **developer preview**（"THERE WILL BE COMPATIBILITY-BREAKING CHANGES"），简报 §2 记的是 "rc 阶段"。以官方为准 → **preview**，这对"上游停更/破坏性变更"这个失效面（判据 C）的评估更不利。
5. **Agent Skills 的治理归属**——它是唯一**没有基金会、没有版本号**的核心标准，而 Alan 的方法库要押在它上面。AAIF 已经收了 MCP / AGENTS.md / A2A / goose，Skills **未在 AAIF 项目名单中**。这是一个需要 Alan 裁的风险：接受"单厂商开放标准"，还是把方法库的**目录与 frontmatter 约定自己版本化**（在 `metadata` 里存自己的 schema 版本）。
6. **opencode 无原生沙箱**是否已在 2026 年下半年改变——官方 permissions 文档未提沙箱，只找到社区 npm 包 [二手]。若 Alan 真要把 opencode 用到 L2，此项必须复核。
7. **"权限只能收窄"这条要求在五宿主上都不完全成立**：opencode 最后命中者胜、dsh preset 无方向限制、Claude Code 会话内可切模式。→ 需要 Alan 裁：是接受"由外部 CI 对账权限事件流"作为补偿控制，还是把这条不变量在 L0/L1 降级为人工检查点。

---

## 7. 来源

1. [AGENTS.md](https://agents.md/) — 2026-09-07 — [厂商文档] — §1.1、§2.1、§5
2. [Linux Foundation Announces the Formation of the AAIF（aaif.io 新闻稿）](https://aaif.io/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation-aaif-anchored-by-new-project-contributions-including-model-context-protocol-mcp-goose-and-agents-md/) — 2026-09-07（发布日 2025-12-09）— [厂商文档] — §1.1
3. [A2A joins AAIF's open agentic stack](https://aaif.io/blog/a2a-joins-aaif) — 2026-09-07（发布日 2026-08-17）— [厂商文档] — §1.1、§2.4
4. [Agent Skills Specification](https://agentskills.io/specification) — 2026-09-07 — [厂商文档] — §1.1、§2.2、§3.2
5. [Agent Skills Client Showcase](https://agentskills.io/clients) — 2026-09-07 — [厂商文档] — §1.2、§2.2
6. [github.com/agentskills/agentskills](https://github.com/agentskills/agentskills) — 2026-09-07 — [厂商文档] — §2.2、§6.5
7. [MCP 2026-07-28 Key Changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog) — 2026-09-07 — [厂商文档] — §1.1、§2.3、§3.3
8. [MCP Releases](https://github.com/modelcontextprotocol/modelcontextprotocol/releases) — 2026-09-07 — [厂商文档] — §1.1（2026-07-28 为最新稳定版）
9. [MCP Extensions Overview](https://modelcontextprotocol.io/docs/extensions/overview) — 2026-09-07 — [厂商文档] — §3.3、§4（tasks 扩展）
10. [Bringing MCP 2026-07-28 to Claude](https://claude.com/blog/bringing-mcp-2026-07-28-to-claude) — 2026-09-07（发布日 2026-07-28）— [厂商文档] — §6.1
11. [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/) 与 [A2A 首页](https://a2a-protocol.org/latest/) — 2026-09-07 — [厂商文档] — §1.1、§2.4、§5
12. [ACP — Tool Calls & Permissions](https://agentclientprotocol.com/protocol/tool-calls) — 2026-09-07 — [厂商文档] — §1.1、§3.3
13. [ACP — Agents](https://agentclientprotocol.com/get-started/agents) — 2026-09-07 — [厂商文档] — §1.2、§2.5
14. [github.com/agentclientprotocol/agent-client-protocol](https://github.com/agentclientprotocol/agent-client-protocol) — 2026-09-07 — [厂商文档] — §2.5（许可证、协议版本 1、治理文件）
15. [Claude Code — How Claude remembers your project](https://code.claude.com/docs/en/memory) — 2026-09-07 — [厂商文档] — §1.2（AGENTS.md 行）、§3.1
16. [Claude Code — Hooks reference](https://code.claude.com/docs/en/hooks) — 2026-09-07 — [厂商文档] — §1.3、§3.4
17. [Claude Code — Configure permissions](https://code.claude.com/docs/en/permissions) — 2026-09-07 — [厂商文档] — §1.3（裸名 deny = 移出上下文；deny 优先；hook 与规则两层）、§3.4
18. [Claude Code — Sandboxing](https://code.claude.com/docs/en/sandboxing) — 2026-09-07 — [厂商文档] — §1.3、§4
19. [Claude Code — Skills](https://code.claude.com/docs/en/skills) — 2026-09-07 — [厂商文档] — §1.2（标准字段 vs 扩展字段）
20. [Codex — Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security) — 2026-09-07 — [厂商文档] — §1.3
21. [Codex — Hooks](https://learn.chatgpt.com/docs/hooks) — 2026-09-07 — [厂商文档] — §1.3、§2.6
22. [Codex — AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) — 2026-09-07 — [厂商文档] — §1.2、§3.2（32 KiB）
23. [Codex — Skills](https://developers.openai.com/codex/skills/) — 2026-09-07 — [厂商文档] — §1.2（`.agents/skills`、渐进披露）
24. [opencode — Rules](https://opencode.ai/docs/rules/) / [Permissions](https://opencode.ai/docs/permissions/) / [Plugins](https://opencode.ai/docs/plugins/) / [Skills](https://opencode.ai/docs/skills/) / [MCP servers](https://opencode.ai/docs/mcp-servers/) — 2026-09-07 — [厂商文档] — §1.2、§1.3、§3
25. [VS Code — Custom instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions) / [Agent skills](https://code.visualstudio.com/docs/copilot/customization/agent-skills) / [MCP servers](https://code.visualstudio.com/docs/copilot/customization/mcp-servers) / [Agent hooks (Preview)](https://code.visualstudio.com/docs/agent-customization/hooks) / [Approvals](https://code.visualstudio.com/docs/agents/run/approvals) — 2026-09-07 — [厂商文档] — §1.2、§1.3
26. [dsh — Approvals](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/approval) / [Sandboxing](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/sandbox) / [Tools](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/tools) / [Skills](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/skills) / [Permission presets](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/permission-presets) — 2026-09-07 — [厂商文档] — §1.2、§1.3、§3.4、§5、§6
27. [github.com/deepseek-ai/deepseek-harness（README）](https://github.com/deepseek-ai/deepseek-harness/blob/master/README.md) — 2026-09-07 — [厂商文档] — §6.4（developer preview 口径）
28. [DeepWiki — dsh MCP Client, Hooks & Skills](https://deepwiki.com/deepseek-ai/deepseek-harness/7.2-mcp-client-hooks-and-skills) — 2026-09-07 — **[二手]** — §1.2（dsh MCP）、§2.6（方言桥，待一手验证）
29. [Agentic Control Plane — dsh Permissions & Control Model](https://agenticcontrolplane.com/controls/dsh) — 2026-09-07 — **[二手]** — 仅用于交叉印证 §1.3 中已由官方文档确认的结论，未单独作为论据

---

自评：我最没把握的三个判断是 ① 五宿主"两处独立检查有效能力"这条的判定——Claude Code 与 dsh 我给了"满足"，但两层拦截都跑在同一进程里，是否算"独立"取决于本理论对独立性的定义，我按"求值路径互不覆盖"来判，可能过宽；② dsh 的 `hooks-claude-code` / `hooks-codex` 方言桥是否真实存在（只有 DeepWiki 一处 [二手] 证据，而 L1 推荐的"一套脚本五份适配"成本高度依赖它），以及 dsh 的指令文件加载规则（官方页 404，完全未定）；③ 把 Agent Skills 判为"判据 A 必需"——它没有基金会、没有版本号、没有发布日期，五宿主的字段集又各不相同（`allowed-tools` 在 opencode 与 Copilot 文档里都没有），我认为"按需加载"这条语义没有别的通用载体，但这个判断建立在"常驻指令文件在机制上做不到"上，如果接受"人工在每轮手动粘贴"作为 L0 的合法形态，它就退回 B。
