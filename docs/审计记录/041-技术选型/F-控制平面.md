# 控制平面（30 验证与测试 / 31 守卫与权限边界 / 32 证据与追踪 / 33 评估与演进）：候选、标准与对照

## 0. 验证边界

- 检索日期：2026-09-07（全部结论以此日为准）。
- **我亲自打开并读过全文/原文件的页面**（记 [厂商文档]，读官方仓库原始文件的记 [一手实测]）：
  - Claude Code 官方文档：`sandboxing`（含 Limitations 全节）、`sandbox-environments`、`permissions`（含 deny/ask/allow 优先级与 hook 交互全节）、`hooks`、`monitoring-usage`。
  - OpenTelemetry：`semantic-conventions-genai` 仓库首页与 `docs/gen-ai/gen-ai-agent-spans.md` 原始文件 [一手实测]；opentelemetry.io 上原 gen-ai 页面（已迁移告示）；2026-05-14 官方博客 `genai-observability`。
  - OWASP GenAI Security Project：Agentic Top 10 (2026) 资源页、2026-09-01/02 公告页；`GenAI-Security-Project/agent-control-standard` 仓库首页与 README 原文 [一手实测]。
  - GitHub Docs：rulesets 可用规则、protected branches、CODEOWNERS。
  - OpenAI：`developers.openai.com/codex/agent-approvals-security`、API deprecations 页。
  - 其他：in-toto/attestation 仓库、slsa.dev v1.1 页（含"v1.2 为当前版本"告示）、PyPI `inspect-ai`、Inspect 官方 `sandboxing.html`、UK AISI Autonomous Systems Evaluation Standard、OPA releases、promptfoo 官方公告与仓库、opencode 权限文档、GitHub Changelog 2026-07-08、Microsoft Security Blog 2026-06-05。
- **只看了搜索摘要、未逐页打开**：Braintrust / LangSmith / Langfuse 的许可与自托管条款；E2B 底层是否 Firecracker；Cedar crate 当前版本（crates.io 页面 404，未能打开）；ISO/IEC 42001 是否已有修订版（只见到 EN ISO/IEC 42001:2026 这个欧洲采纳版的目录条目，未打开）。
- **未查到 / 未能打开**：
  - OTel GenAI 语义约定拆分后的**正式发布版本号与 Schema URL**（仓库 README 里写着 `Schema URL: TODO`）[一手实测]。
  - dsh（DeepSeek Harness）的 guard/hook 是否能对工具调用返回 deny——本节不覆盖，属调研员 A。
  - OWASP Agentic Top 10 PDF 正文（资源页只提供下载，我用二手页核对了 ASI01–ASI10 条目名）。
  - Cedar 开源实现的最新版本号与日期。

---

## 1. 2026 年的行业标准与主流实践（先答这个）

### 1.1 有开放标准的部分

| 领域 | 标准 | 归属组织 | 状态（2026-09-07） | 证据 |
|---|---|---|---|---|
| 证据/追踪 | **OpenTelemetry GenAI 语义约定** | CNCF / OpenTelemetry | **Development（未稳定）**。已从主 semconv 仓库拆出到 `open-telemetry/semantic-conventions-genai`，原页面标注"已迁移、不再维护"。agent spans 文件顶部逐字写着 `Status: Development`；仓库 README 的 Schema URL 仍是 `TODO` | [一手实测] |
| 运行时守卫 | **Agent Control Standard (ACS)** | OWASP GenAI Security Project（2026-09-01 捐赠公告） | **v0.1 Public Preview**。三支柱：Inspectable / Traceable / Instrumentable；路线图 v1=agent 插桩 + Guardian Agent 参考实现，v2=AgBOM，**v3 才做 deny/modify 控制** | [一手实测] |
| 安全基线 | **OWASP Top 10 for Agentic Applications 2026**（ASI01–ASI10） | OWASP | 已发布，2025-12-09 | [厂商文档]+[二手]（条目名来自二手页） |
| 安全基线 | **OWASP Top 10 for LLM Applications 2026** | OWASP | 已发布 2026-09-01；"Excessive Agency" 升至第 3 | [厂商文档] |
| 供应链证明 | **in-toto Attestation Framework** | CNCF（in-toto 项目） | v1.2.0，2026-03-18 | [厂商文档] |
| 供应链证明 | **SLSA** | OpenSSF | **v1.2 为当前版本，v1.1 已 Retired** | [厂商文档] |
| 治理 | **NIST AI RMF 1.0**（2023-01）+ **NIST AI 600-1 GenAI Profile**（2024-07） | NIST | 1.0 现正依 White House AI Action Plan **修订中**；2026-04 出了关键基础设施 Profile 概念说明 | [厂商文档] |
| 治理 | **ISO/IEC 42001:2023** | ISO/IEC | 有效；欧洲有 EN ISO/IEC 42001:2026 采纳版（未打开确认） | [二手] |
| 评估 | **UK AISI Autonomous Systems Evaluation Standard** | UK AISI | 2024-10-31 发布，是**"提交一条 agent 评估必须满足什么"的最小规范**（强制 Inspect、强制全自动打分、强制 canary 串、要求 QA 证据） | [厂商文档] |

**明确没有开放标准的部分**：①"从改动集派生验证计划"②"三态裁定的线格式"③"Case 注册表分区（诊断/筛选/最终验证）"④"评估器校准"。这四项在 2026 年仍**只有各家实践、没有标准**。UK AISI 那份标准是最接近③的东西，但它规范的是"评估任务包"的形态，不是"回归集分区隔离"。

### 1.2 五宿主支持矩阵

行=能力，列=宿主。每格标证据等级。

| 能力 | Claude Code | codex | opencode | dsh | VSCode Copilot |
|---|---|---|---|---|---|
| **运行时拦截可返回 deny/ask** | 满足：`PreToolUse` 返回 `permissionDecision: deny/allow/ask`，exit 2 阻断；另有 `PermissionRequest` 用 `decision` 字段 [厂商文档] | 部分：有 approval policy（untrusted/on-request/on-failure/never）与 `approvals_reviewer="auto_review"` 自动审阅者，但**未查到**可编程 PreToolUse 式 deny 钩子 [厂商文档] | 部分：配置式 `permission` 三态（allow/ask/deny，最后匹配胜出）；插件 `permission.ask` 钩子有 issue 报告"定义了但不触发" [厂商文档]+[二手] | 未查到（属 A 的分工） | 未查到可编程 deny 钩子 |
| **OS 级沙箱（文件+网络）** | 满足：Bash 沙箱（macOS Seatbelt / Linux bubblewrap+socat+可选 seccomp）；`sandbox-runtime` 可把**整个进程**（含 MCP、hooks、文件工具）罩进去，但标注 beta research preview [厂商文档] | 满足：Seatbelt / bwrap+seccomp；三档 read-only / workspace-write / danger-full-access；网络**默认关**；`.git`/`.agents`/`.codex` 在可写根内仍只读 [厂商文档] | 未查到 | 未查到 | 未查到（容器/devcontainer 路线） |
| **权限 deny 规则可由管理端强制** | 满足：managed settings；deny→ask→allow 顺序，**hook 返回 allow 也不能越过 deny 规则**；`disableBypassPermissionsMode` 只能在 managed 里锁死 [厂商文档] | 部分：config.toml + 审批策略，未查到 MDM 级强制 | 部分：配置文件，未查到强制机制 | 未查到 | 部分：managed-settings.json / MDM（见下行） |
| **OTel 导出（成本/令牌/工具决策）** | 满足：metrics+logs **稳定**，traces **beta**（`CLAUDE_CODE_ENHANCED_TELEMETRY_BETA`）；`claude_code.cost.usage`(USD)、`token.usage`、`tool_decision`(含 source=config/hook/user_*)、`api_request.cost_usd_micros`；`llm_request` span 带 `gen_ai.*` 属性 [厂商文档] | 未查到官方 OTel 导出 | 未查到 | 未查到 | 满足：2026-07-08 起 **enterprise-managed OTel export**，覆盖 VS Code Copilot Chat 与 Copilot CLI，管理员可锁 OTLP endpoint/协议/头/是否采集 prompt 与工具内容，走 MDM 或服务端托管设置 [厂商文档] |
| **官方 CI 载体** | claude-code-action（**2026-06 曾被披露 prompt-injection 导致读 `/proc/self/environ` 泄 API key，v2.1.128 修复**）[二手，来自 Microsoft 安全博客] | Codex CLI 可跑在 CI | 未查到 | 未查到 | GitHub Actions 原生 |

**结论一句话**：跨五宿主，**唯一真正通用的强制层是 git/CI 侧（必经路径）**；宿主内的 deny/ask 与沙箱是**宿主绑定层**，能力差距很大，不能作为规范正文的依赖。

---

## 2. 候选清单

### A 组：必经路径事实门禁（通用层）

1. **git 客户端 hooks（pre-commit 框架 / lefthook / husky）** — 提交/推送前跑检查的本地钩子管理器。维护活跃。部署形态：单个可执行 + 一个配置文件，无服务。许可证 MIT（pre-commit MIT，lefthook MIT）。**通用层**。致命限制：hooks **不随 git clone 分发**（需一次 `install` 或 `core.hooksPath`），且 `--no-verify` 可跳过——**它对 agent 是"工具"级，不是"约束"级**。[厂商文档]+[二手]
2. **GitHub Actions + Rulesets（必需状态检查 / 必需 PR 评审 / 必需 code owner 评审 / 合并队列 / 必需部署 / 代码扫描门槛 / 覆盖率下限 / 限制文件路径与扩展名）** — 服务端强制。旧的 branch protection 有"Do not allow bypassing the above settings"可把管理员一并纳入；rulesets 支持多规则叠加与显式 bypass 名单。**通用层（对宿主完全中立）**。[厂商文档]
3. **CODEOWNERS** — `.github/`、根目录或 `docs/` 三处之一，gitignore 语法，最后匹配优先，需配合 ruleset 的"require code owner review"才有强制力；**任一列出的 owner 批准即满足**，不是全部。文件上限 3MB；草稿 PR 不自动请求。**通用层**。[厂商文档]
4. **GitHub Artifact Attestations（`actions/attest-build-provenance`）** — 在 Actions 里生成 in-toto/SLSA provenance 并签入 Sigstore 透明日志。**通用层**（绑 GitHub，不绑宿主）。[厂商文档]

### B 组：运行时守卫（宿主绑定层 + 可选策略引擎）

5. **Claude Code hooks** — 36 个事件；可阻断的 12 个，含 `PreToolUse`/`UserPromptSubmit`/`Stop`/`SubagentStop`/`PostToolBatch`/`TaskCreated`/`TaskCompleted`/`ConfigChange`/`PreModelSwitch`。**`PreModelSwitch` 超时=阻断**（唯一一个 fail-closed 的），其余 `PreToolUse` 超时**不阻断**（fail-open）。**宿主绑定层**。[厂商文档]
6. **Claude Code 权限规则 + managed settings** — deny>ask>allow，先匹配先决；裸工具名 deny 直接把工具从上下文摘掉；hook 与规则**是两道独立检查**（hook exit 2 在规则之前阻断；hook allow 不能越过 deny/ask）。**宿主绑定层**。[厂商文档]
7. **OPA（Open Policy Agent）+ Rego** — CNCF 已毕业的通用策略引擎。最新 v1.20.1（2026-08-28）。部署形态：单个 Go 二进制，可做库、sidecar 或 CLI（`opa eval`）。Apache-2.0。**通用层（但要自己接到每个宿主的 hook 上）**。[厂商文档]
8. **Cedar / Amazon Bedrock AgentCore Policy** — Cedar 是开源授权语言（Rust，AWS 开源）；AgentCore Policy 用 Cedar 做 agent 工具调用授权、默认拒绝，**2026-03 GA**。AgentCore 是 AWS 托管服务=**厂商绑定**；Cedar 本体是**通用层**库。[二手为主，AWS 公告为厂商文档]
9. **OWASP Agent Control Standard v0.1** — 见上。当前**只有 schema + 可观测性映射（OTel/OCSF）+ AgBOM**，**deny/modify 要到 v3**。今天不能当守卫用，只能当"证据模型的词汇表"参考。[一手实测]

### C 组：沙箱与隔离

10. **Claude Code Bash 沙箱** — 内置，无需 Docker，macOS/Linux/WSL2。仅罩 Bash 及其子进程；Read/Edit/Write、MCP server、hooks **在宿主上裸跑**。[厂商文档]
11. **`@anthropic-ai/sandbox-runtime`** — 把整个 Claude Code 进程罩进 Seatbelt/bubblewrap。内置强制 denyWrite：`.git/hooks`、`.git/config`、`.mcp.json`、`.claude/commands`、`.claude/agents`、shell 启动文件。**beta research preview，配置格式可能变**。Linux 上 deny 列表**启动时构建一次**，会话中新建的仓库不覆盖。[厂商文档]
12. **devcontainer（Anthropic 参考实现）** — Docker + 默认拒绝的 iptables 防火墙。官方明说这是**约定不是强制边界**（"convention rather than an enforcement boundary"）。[厂商文档]
13. **Codex 沙箱** — 见矩阵。[厂商文档]
14. **VM / microVM（Firecracker、Docker Sandboxes）** — 最强隔离；Docker Sandboxes 是免费独立产品，自带 microVM + 独立 Docker daemon。[厂商文档]
15. **E2B** — Apache-2.0，云沙箱 + SDK，可用 Terraform 自托管（仅 AWS/GCP）。**面向"跑 AI 生成的代码"，不是面向"罩住我的本机开发会话"**。[厂商文档]

### D 组：证据与追踪

16. **OpenTelemetry GenAI 语义约定** — 见上，Development。
17. **Claude Code 原生 OTel 导出** — 见矩阵；这是目前**唯一我确认能按"来源 × 模型 × agent/skill/plugin/mcp 维度"给出美元成本与令牌的宿主原生遥测**。[厂商文档]
18. **git 本身作为只追加日志** — commit/notes/tag 天然只追加、内容寻址、可交叉核对（工作副本身份 = commit sha + branch + worktree）。零新增组件。**通用层**。
19. **in-toto attestation + SLSA + Sigstore/Rekor** — 把"谁在什么输入上产出了什么"做成可验证声明与透明日志。Rekor v2 已 GA。[厂商文档]+[二手]
20. **Langfuse / Braintrust / LangSmith** — LLM 可观测性平台。Langfuse 可自托管；Braintrust/LangSmith 主要是 SaaS（自托管需商业条款）。**均未逐页核实许可，记未定**。

### E 组：评估

21. **Inspect AI** — UK AISI 的 LLM/agent 评估框架。**0.3.263，2026-09-04**，MIT，Python ≥3.10，pip 装的库+CLI，无服务依赖。有 solver/scorer、结构化 eval log + log viewer、8 种 sandbox provider（docker/local/k8s/Daytona/Modal/EC2/Proxmox/Vagrant）。**通用层**。[厂商文档]
22. **inspect_evals** — 200+ 现成评估集，配 UK AISI Autonomous Systems Evaluation Standard。[厂商文档]
23. **promptfoo** — MIT，仍开源；**2026-03-09 被 OpenAI 收购**，官方承诺继续维护并保持多厂商支持。**这是判据 C 的一个新失效面（治理归属变更）**。[厂商文档]
24. **OpenAI Evals（平台）** — **2026-06-03 宣布弃用；2026-10-31 转只读；2026-11-30 关停**（Agent Builder、Prompts API 同批）。开源 `openai/evals` 仓库未标归档，但 README 引导用户去已关停的 Dashboard。**明确不采纳**。[厂商文档]
25. **Braintrust / LangSmith** — 见 D 组 20。

---

## 3. 对照本理论的要求（核心）

格内只填：满足 / 部分（说哪部分）/ 不满足 / 未定 + 证据等级。

### 3.1 第 30 章 · 验证与测试

| 要求 | 最小满足形态（少就是多） | git hooks | CI/Rulesets | Inspect AI | promptfoo |
|---|---|---|---|---|---|
| 从改动集派生验证计划 | 一个读 `git diff --name-only` 映射到验证集的脚本（<50 行） | 部分：`pre-commit` 天然只对暂存文件跑 [厂商文档] | 部分：Actions 的 `paths` 过滤 + 脚本，需自己写映射 [厂商文档] | 不满足（不是改动驱动的）[厂商文档] | 不满足 [厂商文档] |
| 分层执行、每层输出三态并声明盲区 | 每层脚本退出码 0/1/2 + 一个 JSON 摘要文件 | 部分：只有 0/非 0，三态要自己编码 [厂商文档] | 部分：check 状态原生是 success/failure/**neutral/skipped**，天然三格；"盲区"要自己写 [厂商文档] | 部分：scorer 可输出多值，但"盲区声明"不是内建概念 [厂商文档] | 部分 [二手] |
| 冻结验证基线、只对新增失败下结论 | 一个 checked-in 的 `known-failures` 文件 + diff | 不满足 | 部分：需要自己维护基线文件；ruleset 的"覆盖率最大下降幅度"是同类思路的现成规则 [厂商文档] | 部分：eval log 可比对但无内建基线冻结 [厂商文档] | 部分：有 `--filter-failing` 类用法 [二手] |
| **在独立于生产者的上下文/模型中验证，并记录双方身份** | 验证在 CI 跑（进程与会话都不同）+ 记录 commit sha 与 runner id | 不满足：与生产者同机同会话 | **满足**：CI runner 与开发者会话天然隔离，run id/commit sha 可记 [厂商文档] | 满足：可指定 grader model ≠ 被测 model，log 里带两边 model 名 [厂商文档] | 满足 [厂商文档] |
| 判分器/脚本本身是被验证对象（已知答案回归集） | 一个小目录：输入 + 期望裁定，判分器跑自己 | 不满足 | 部分：可以把"判分器自测"做成一个必需检查 | **满足**：UK AISI 标准要求提交评估时带 QA 证据（前沿模型或人类完成样本的日志）[厂商文档] | 部分：可对 assertion 做单测 [二手] |
| 输出结构化裁定、不输出自由文本 | JSON 一行 | 部分 | 满足：check run 是结构化对象 [厂商文档] | 满足：eval log 是结构化 schema [厂商文档] | 满足 [厂商文档] |

### 3.2 第 31 章 · 守卫与权限边界（含四级定级）

**四级定级**（提醒 / 工具 / 警告 / 约束）：

| 候选 | 定级 | 理由 |
|---|---|---|
| CLAUDE.md / AGENTS.md 里写"必须先跑测试" | **提醒** | Claude Code 文档逐字："Permission rules are enforced by Claude Code, not by the model. Instructions in your prompt or CLAUDE.md shape what Claude tries to do, but they don't change what Claude Code allows." [厂商文档] |
| Makefile / slash command / skill | **工具** | 要执行者想起来运行 |
| git pre-commit hook | **工具**（不是约束） | 不随 clone 分发，且 `--no-verify` 可跳过；agent 有动机跳过（已有专门的 `block-no-verify` 类工具存在，本身即证据）[二手] |
| CI 非必需检查 / 只做 annotation 的 job | **警告** | 自动进入必经路径但不阻断 |
| CI 必需状态检查 + ruleset（含"不允许绕过"） | **约束** | 服务端强制，绕过需显式 bypass 名单 [厂商文档] |
| CODEOWNERS + require code owner review | **约束**（且是 40 章的人工检查点） | [厂商文档] |
| Claude Code `PreToolUse` hook 返回 deny / exit 2 | **约束（宿主内）** | [厂商文档] |
| Claude Code deny 权限规则（managed settings） | **约束（宿主内）** | hook 返回 allow 也越不过 [厂商文档] |
| OS 沙箱（Bash 沙箱 / sandbox-runtime / 容器 / VM） | **约束（进程级）** | [厂商文档] |
| Codex 审批策略 | **约束（宿主内，人在场时）**；`never` 档降为提醒 | [厂商文档] |
| opencode `permission` 配置 | **约束（宿主内）**，但 `--auto` 一开即降级 | [厂商文档] |
| OWASP ACS v0.1 | **提醒**（今天只有 schema/可观测性，deny 要 v3） | [一手实测] |

| 要求 | 最小满足形态 | 宿主 hooks+权限规则 | OS 沙箱 | CI/Rulesets | OPA/Cedar |
|---|---|---|---|---|---|
| 每个 Gate 有合同并标注判据是**确定事实**还是**代理指标** | Gate 清单文件，每条一行注明 fact/proxy | 部分：文档本身给了区分素材（deny 规则对 `cat`/重定向生效，但**对 Python/Node 脚本自己开文件无效**→那是 proxy；沙箱才是 fact）[厂商文档] | 满足（fact） | 满足（fact：check 结果是客观信号） | 部分：合同要自己写 |
| **未知默认关闭**（未登记动作、应答缺席、超时不放行） | 白名单 + 超时即拒 | **部分**：`PreModelSwitch` 超时阻断，但 **`PreToolUse` 的 command/http/mcp_tool hook 超时不阻断**（Agent SDK 回调 hook 超时才阻断）→ 默认 **fail-open** [厂商文档] | 部分：Claude Code 沙箱起不来时**默认降级为不沙箱**，要显式设 `sandbox.failIfUnavailable: true` 才 fail-closed [厂商文档] | 满足：必需检查未报告即不可合并 [厂商文档] | 满足（引擎不可达→调用方自己决定，通常配 fail-closed） |
| 权限在运行创建时固化、执行中只能收窄 | 会话启动读一次配置 | 部分：`/cd` 会切换到新目录的设置（含 hooks、权限规则），需信任提示确认——**这是执行中可以变宽的路径** [厂商文档] | 满足：沙箱边界启动时定死 | 满足：ruleset 在合并时求值 | 未定 |
| 至少两个位置检查有效能力 | hook + 规则 两道 | **满足**：hook exit 2 在规则前阻断；规则的 deny 在 hook allow 之后仍生效——两道互不覆盖 [厂商文档] | 满足（叠加：沙箱在容器内） | 部分：check + code owner 评审算两道 | 未定 |
| 按动作对象与参数判定、不按名称字符串 | 规则用 `Tool(param:value)` | **部分**：Claude Code 明确**拒绝**对主内容字段（`command`/`file_path`/`url`）用 `param:` 形式，理由是复合命令可绕过；改用 `Bash(rm *)` 这类命令前缀匹配——**仍是字符串匹配** [厂商文档] | 满足：内核按真实路径/域名判 | 满足 | **满足**：Cedar/Rego 按结构化实体与属性判 [二手] |
| 每个拦截层有**独立于自身**的失效探测 | 一条"故意触发应被拒"的探针，跑在另一层 | **部分**：可以写探针，但探针本身要靠另一个宿主或 CI 跑才独立 | 部分：沙箱缺依赖会在 `/sandbox` 面板显示，但那是自报；独立探测需在 CI 里跑"该命令应失败" | 满足：CI 层可探测其他层 | 部分 |
| 豁免与跳过留痕并带失效时间 | 一个带到期日的 exemptions 文件 + CI 检查到期 | 部分：`claude_code.tool_decision` 事件带 `decision` 与 `source`（config/hook/user_permanent/user_temporary/…），留痕有了，**失效时间没有** [厂商文档] | 不满足 | 部分：ruleset bypass 名单可见，但无到期语义 [厂商文档] | 部分 |
| **可见性过滤 vs 安全边界** 的区分 | 明确标注每条规则属哪类 | **关键事实**：Claude Code 裸工具名 deny **把工具从上下文里摘掉**（可见性），带作用域的 `Bash(rm *)` **保留工具、调用时拦截**（边界）——两种语义在同一个字段里 [厂商文档] | 边界 | 边界 | 边界 |

### 3.3 第 32 章 · 证据与追踪

| 要求 | 最小满足形态 | git（commit/notes） | Claude Code OTel | in-toto/SLSA | ACS v0.1 |
|---|---|---|---|---|---|
| 主张/权威源/观察/验证结果/验收证据五概念不互换 | 五个不同的文件区/字段名 | 满足（靠约定：commit message=主张，CI 产物=观察，check=验证结果）| 部分：事件类型天然分开（`assistant_response` vs `tool_result` vs `api_request`），但"主张 vs 观察"要自己映射 [厂商文档] | 满足：predicate/subject/statement 天生分层 [厂商文档] | 部分：schema 定义了 agent 组成与轨迹，未定义"裁定" [一手实测] |
| 完成主张绑定最小字段集 | commit trailer 里放 sha+验证 run id+裁定 | 满足（零新增组件） | 部分 | 满足 | 未定 |
| 轨迹足以还原调用树 | 一棵 span 树 | 不满足 | **满足（beta）**：`claude_code.interaction` → `llm_request`/`hook`/`tool` → `tool.execution`，且 Bash 子进程继承 `TRACEPARENT`、MCP 出站带 `traceparent` [厂商文档] | 不满足 | 部分：靠 OTel [一手实测] |
| 只追加保存原始记录、导出是派生投影（带缺口计数） | git 是只追加的；导出脚本报缺口 | **满足** | 部分：OTel 是流式，落地存储的只追加性取决于后端；缺口计数要自己做 | 满足（Rekor 是只追加透明日志）[二手] | 未定 |
| 按计费类别加权记账并声明价表版本 | 一个 CSV | 部分 | **部分**：`cost.usage`(USD) 与 `cost_usd_micros` 直接给美元并按 `model`/`agent.name`/`skill.name`/`mcp_tool.name` 打标——但**价表版本未在属性里声明** [厂商文档] | 不满足 | 不满足 |
| 证据有失效条件 | 证据行带 `valid_until` 或绑源 sha | 满足（绑 commit sha 即天然失效条件） | 不满足 | 满足（subject digest 变了即失效）[厂商文档] | 未定 |
| 语义可跨工具复用 | 用 OTel `gen_ai.*` 属性名 | — | 部分：`llm_request` span 用了 `gen_ai.system/request.model/response.id/finish_reasons`，其余是 `claude_code.*` 私有名 [厂商文档] | — | — |

### 3.4 第 33 章 · 评估与演进

| 要求 | 最小满足形态 | Inspect AI | promptfoo | CI + 目录约定 |
|---|---|---|---|---|
| 分层评估并说明每层能证明什么 | 三个目录 + 一行说明 | 部分：有 task/solver/scorer 分层，"能证明什么"要自己写 [厂商文档] | 部分 | 满足（靠目录与文档） |
| **Case 注册表：两种来源、三分区（诊断/筛选/最终验证）** | 三个子目录 + 一个 README | 部分：有 dataset 概念，无分区语义 [厂商文档] | 部分 | **满足**：三个目录就够 |
| **筛选与最终验证不得被会修改 harness 的执行者读取** | 目录级 deny 规则 + CODEOWNERS + 独立仓库 | 不满足（框架本身不管访问控制） | 不满足 | **满足**：`Read(./evals/final/**)` deny + CODEOWNERS 守该目录 + ruleset 限制文件路径 [厂商文档] |
| 先写标准再运行 | 期望值先入库并 commit | 满足（dataset 是先写的）[厂商文档] | 满足 | 满足 |
| 所有机制变更走同一条晋升链 | 一条 PR 流水线 | 不满足 | 不满足 | **满足** |
| 失败先定位最早偏离层 | 分层日志 | 满足：eval log + log viewer 可逐样本回看 [厂商文档] | 部分 | 部分 |
| 到期审计与结构性删减 | 每条 case 带 `added_on`；CI 报超龄 | 不满足（无内建） | 不满足 | 满足（脚本 <30 行） |
| 评估器校准 | 判分器跑已知答案集 | 部分：UK AISI 标准要求 QA 证据，且**限制模型打分只用于内容匹配**——这是现成的校准纪律 [厂商文档] | 部分 | 部分 |
| 评估集会过期（污染） | canary 串 | 满足：UK AISI 标准强制 README 带 canary 串 [厂商文档] | 未定 | 部分 |

---

## 4. 判据 A/B/C 判定

| 候选 | A 必需 / B 可选 | C：引入的失效面 与 "它坏了怎么被发现" |
|---|---|---|
| **CI 必需检查 + ruleset** | **A 必需**。没有它，"验证在独立于生产者的上下文中执行"和"事实门禁"无法被判定为已执行 | 失效面：runner 环境漂移、check 名改了变成"不再必需"、bypass 名单被加人。探测：定期跑一个**故意失败**的 canary PR，看它是否真的被拦；ruleset 的 bypass 名单纳入 CODEOWNERS 守护 |
| **CODEOWNERS** | **A 必需**（40 章人工检查点的落地） | 失效面：语法错误的行被静默跳过；草稿 PR 不触发。探测：CI 里跑 `gh api .../codeowners/errors`，非空即失败 |
| **git hooks（pre-commit）** | **B 可选**（它只是把 CI 已有的检查提前跑一遍） | 失效面：没 install、`--no-verify`、`core.hooksPath` 冲突。探测：CI 复跑同一组检查——**CI 才是权威，hook 只是提速** |
| **Claude Code hooks + deny 规则** | **A 必需（仅在 L2+ 且以 Claude Code 为主力时）**；跨宿主视角是 **B** | 失效面：`PreToolUse` hook 超时**默认放行**；`/cd` 引入新目录设置。探测：一条"必被拒"的探针命令，由 CI 或另一宿主定期发起；把 `tool_decision` 事件里 `source=hook` 的计数做成看板，长期为 0 即 hook 没跑 |
| **OS 沙箱（Bash 沙箱 / sandbox-runtime）** | **A 必需（L3 前置条件的一部分）** | 失效面：依赖缺失时**默认降级为不沙箱**（除非 `failIfUnavailable: true`）；`dangerouslyDisableSandbox` 逃生舱；TLS 不解密→域名前置可绕过 allowlist；`allowUnixSockets` 放 docker.sock 即等于给宿主。探测：会话启动跑一条"应被网络拒绝"的命令，成功即报警；把 `allowUnsandboxedCommands: false` 设为 managed |
| **devcontainer** | **B 可选** | 官方自陈"是约定不是强制边界"。探测：容器内跑防火墙 canary（访问未 allowlist 域名应失败） |
| **VM / microVM** | **B 可选**（L3 或处理不可信仓库时升为 A） | 失效面：镜像漂移。探测：镜像 digest 固定 + 启动时校验 |
| **OTel 导出（Claude Code 原生）** | **A 必需（L2 起）**：32 章"按计费类别加权记账"没有它无法判定 | 失效面：traces 仍 beta（属性/结构可能变）；后端不可达时数据静默丢失。探测：每日对账——OTel 里的 `cost.usage` 合计 vs 宿主 `/cost` 或账单，差额超阈值报警 |
| **OTel GenAI 语义约定** | **B 可选（今天）** | 失效面：**Development 状态，且刚拆仓、Schema URL 还是 TODO**——属性名会改。探测：把用到的属性名写进一个 `semconv-pins.md`，CI 里对新版仓库做 diff |
| **in-toto / SLSA / Sigstore** | **B 可选**（除非要对外分发制品） | 失效面：签名链、TUF root 轮换。探测：`gh attestation verify` 作为必需检查 |
| **OPA / Cedar** | **B 可选** | 失效面：策略引擎本身是新的单点，且每个宿主都要写一段桥接代码。**"它坏了怎么被发现"我能写出（引擎不可达→拒绝），但"每个宿主的桥接坏了怎么被发现"我写不出通用探测 → 按判据 C，L0–L2 不装** |
| **OWASP ACS v0.1** | **B 可选** | v0.1 preview，deny 能力要到 v3。**观察但不装** |
| **Inspect AI** | **B 可选（L0/L1）→ A（L2 起，当"判分器本身要被验证"时）** | 失效面：0.3.x 版本号意味着 API 仍在动（近一周才发 0.3.263）。探测：把 Inspect 版本 pin 在 `uv.lock`，CI 跑一个"已知答案必过"的冒烟评估，红了即知升级破坏 |
| **promptfoo** | **B 可选** | 失效面：**治理归属已变（2026-03 被 OpenAI 收购）**，多厂商中立性是承诺而非结构保证。探测：同上冒烟集 |
| **OpenAI Evals（平台）** | **不采纳** | 2026-11-30 关停 |
| **Braintrust / LangSmith / Langfuse** | **B 可选** | 失效面：SaaS 依赖、数据出境。探测：未做 |

---

## 5. 推荐与备选（按 L0→L3 分档）

### L0（一人一工具，全部文档+人工）
- **装**：仓库里三个纯文本约定——① `evals/`（诊断/筛选/最终验证 三目录，每条 case 带 `added_on` 与来源）② 一份 Gate 清单（每条标 fact/proxy）③ commit trailer 约定（sha + 裁定三态）。**git 本身就是只追加日志与证据载体。**
- **不装**：CI、策略引擎、评估框架、OTel、任何服务。
- **理由**：判据 A 在 L0 下由人扮演门禁；这些约定的全部成本是三个目录和一页文档。
- **升级触发**：当你第二次发现"自己忘了跑某层验证"，就上 L1。

### L1（一人多会话）
- **装**：① `pre-commit`（定级=工具，只为提速，不当权威）② Claude Code 的 `PreToolUse` deny hook + deny 权限规则，**专门守 `evals/final/**` 与 `evals/screen/**` 不被会改 harness 的会话读到**（33 章唯一一条必须在运行时执行的要求）③ 打开 Bash 沙箱并设 `allowUnsandboxedCommands: false`。
- **不装**：OTel、OPA、Inspect、任何服务。
- **升级触发**：出现第二个人，或出现"agent 自己改了 harness 又自己判过"的事故。

### L2（团队）
- **装**：① **GitHub Actions + rulesets 必需检查 + CODEOWNERS**（这是本节唯一的"约束级、通用层、判据 A"组合，也是"验证者与生成者分离"的最小实现）② **Claude Code 原生 OTel（metrics+logs 稳定档）** 做成本三轴记账；traces 只当 beta 用 ③ **Inspect AI** 做 Case 注册表与判分器自测，按 UK AISI 标准的四条纪律（全自动打分、canary 串、QA 证据、模型打分只用于内容匹配）④ `sandbox-runtime` 或 devcontainer 把 MCP/hooks 一并罩住。
- **不装**：OPA/Cedar（每宿主桥接的失效探测写不出）、图/向量库、ACS、in-toto（除非对外分发制品）。
- **升级触发**：需要无人值守。

### L3（无人值守）
- **前置条件（不满足就不要进 L3）**：存在一个**不需要人在场就能拒绝坏输出的判定器**，且该判定器本身有已知答案回归集、跑在 CI（生产者够不到的上下文）里。
- **装**：L2 全部 + ① VM/microVM 级隔离（Docker Sandboxes 或 Firecracker），因为 Claude Code 文档明说 Bash 沙箱"单独用不足以支撑完全无人值守" ② `sandbox.failIfUnavailable: true` + managed settings 锁死 ③ 每层拦截的独立探针（canary PR、canary 网络请求、canary deny 命令）跑成定时任务 ④ in-toto/SLSA provenance（`actions/attest-build-provenance`）给产物签名。
- **不装**：仍不建议上 OPA/Cedar，除非同时接入 ≥3 个宿主且愿意为桥接写探测。

### 明确不采纳
- **OpenAI Evals 平台** — 2026-11-30 关停。
- **OWASP ACS v0.1 作为守卫** — deny/modify 要到 v3；今天只能当词汇表读。
- **AgentCore Policy** — AWS 托管服务，与"两台 Ubuntu + 自建网关"的环境不匹配；Cedar 本体可留作 L3+ 备选。
- **E2B** — 解决的是"跑不可信生成代码"，不是"罩住本机开发会话"；与本地 PostgreSQL/Docker 栈重叠。
- **Braintrust / LangSmith** — SaaS 优先、成本与数据出境；同等目的下 Inspect AI 组件更少。
- **把 OTel GenAI 属性名当稳定接口** — Development 状态 + 刚拆仓，属性会改。可以用，但要 pin 并对账。
- **claude-code-action 直接处理 issue/PR 评论正文** — 2026-06 已有实证的注入→凭据泄露路径；若用，必须遵守"不可信输入 / 凭据 / 外发"三者不同时具备。

---

## 6. 未定与待核实

1. **OTel GenAI 语义约定何时稳定** — 未查到路线图或目标日期；Schema URL 仍是 TODO。这直接影响 32 章"语义跨工具复用"能否算数。**记未定。**
2. **Claude Code traces 的属性稳定性** — 官方标 beta，且 `claude_code.*` 私有属性占多数。若 Alan 要把调用树当权威证据，需先自己跑一次并 pin 版本。**未定。**
3. **codex / opencode / dsh 是否能返回可编程 deny** — codex 有审批策略与 `auto_review`，但我未查到 PreToolUse 式的可编程拦截；opencode 的 `permission.ask` 插件钩子有"定义了但不触发"的 issue。**这三格记未定，需 A 的报告交叉核对。**
4. **09 §5 的"两种机制类型不同的载体"能否在控制平面满足** — 我的判断是能：CI 必需检查（外部检查器）+ CODEOWNERS 人工检查点，两者机制类型不同且不同属一个工具。但"运行时拦截"这一类**只在 Claude Code 上确认可用**，跨宿主是**部分成立**，不是成立。
5. **Cedar 开源版当前版本** — crates.io 页面 404，未能打开。
6. **Langfuse / Braintrust / LangSmith 的许可与自托管条款** — 只看了搜索摘要，未核实。
7. **需要 Alan 裁的**：31 章"权限在运行创建时固化、执行中只能收窄"与 Claude Code 的 `/cd`（切目录会加载新目录的 hooks 与权限规则）冲突。是接受"带信任提示的放宽"，还是在 managed settings 里禁掉 `/cd`？
8. **需要 Alan 裁的**：33 章"筛选/最终验证集不得被会修改 harness 的执行者读取"，在单人开发下无法靠组织边界实现。可选：把这两个目录放独立仓库 + deny 规则，还是接受"同一人但不同会话+deny 规则"这种弱形态（**这是弱形态，不是满足**）。

---

## 7. 来源

1. [Configure the sandboxed Bash tool — Claude Code Docs](https://code.claude.com/docs/en/sandboxing) — 2026-09-07 — [厂商文档] — §1.2、§2C、§3.2、§4
2. [Choose a sandbox environment — Claude Code Docs](https://code.claude.com/docs/en/sandbox-environments) — 2026-09-07 — [厂商文档] — §2C、§5
3. [Configure permissions — Claude Code Docs](https://code.claude.com/docs/en/permissions) — 2026-09-07 — [厂商文档] — §3.2 四级定级、§1.2
4. [Hooks reference — Claude Code Docs](https://code.claude.com/docs/en/hooks) — 2026-09-07 — [厂商文档] — §1.2、§2B、§3.2
5. [Monitoring — Claude Code Docs](https://code.claude.com/docs/en/monitoring-usage) — 2026-09-07 — [厂商文档] — §2D、§3.3
6. [open-telemetry/semantic-conventions-genai（含 docs/gen-ai/gen-ai-agent-spans.md 原文）](https://github.com/open-telemetry/semantic-conventions-genai) — 2026-09-07 — [一手实测] — §1.1、§4、§6
7. [Inside the LLM Call: GenAI Observability with OpenTelemetry](https://opentelemetry.io/blog/2026/genai-observability/) — 2026-09-07（原文 2026-05-14）— [厂商文档] — §1.1
8. [OWASP Top 10 for Agentic Applications for 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) — 2026-09-07 — [厂商文档] — §1.1
9. [OWASP GenAI Security Project 公告（2026-09-01/02）](https://genai.owasp.org/2026/09/01/owasp-genai-security-project-unveils-2026-top-10-for-llm-applications-new-agent-control-standard-and-sponsors-as-community-tops-30000-members/) — 2026-09-07 — [厂商文档] — §1.1
10. [GenAI-Security-Project/agent-control-standard（README 原文）](https://github.com/GenAI-Security-Project/agent-control-standard) — 2026-09-07 — [一手实测] — §1.1、§2B、§4
11. [Agent approvals & security — OpenAI Codex](https://developers.openai.com/codex/agent-approvals-security) — 2026-09-07 — [厂商文档] — §1.2、§2C
12. [OpenAI API Deprecations](https://developers.openai.com/api/docs/deprecations) — 2026-09-07 — [厂商文档] — §2E、§5
13. [Available rules for rulesets — GitHub Docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) — 2026-09-07 — [厂商文档] — §2A、§3.1
14. [About protected branches — GitHub Docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) — 2026-09-07 — [厂商文档] — §2A、§3.2
15. [About code owners — GitHub Docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) — 2026-09-07 — [厂商文档] — §2A、§4
16. [Enterprise-managed OpenTelemetry export for VS Code and CLI — GitHub Changelog](https://github.blog/changelog/2026-07-08-enterprise-managed-opentelemetry-export-for-vs-code-and-cli/) — 2026-09-07 — [厂商文档] — §1.2
17. [inspect-ai 0.3.263 — PyPI](https://pypi.org/project/inspect-ai/) — 2026-09-07 — [厂商文档] — §2E
18. [Sandboxing — Inspect AI](https://inspect.aisi.org.uk/sandboxing.html) — 2026-09-07 — [厂商文档] — §2E
19. [UK AISI Autonomous Systems Evaluation Standard](https://ukgovernmentbeis.github.io/as-evaluation-standard/) — 2026-09-07 — [厂商文档] — §1.1、§3.4
20. [Promptfoo is joining OpenAI](https://www.promptfoo.dev/blog/promptfoo-joining-openai/) + [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) — 2026-09-07 — [厂商文档] — §2E、§4
21. [in-toto/attestation](https://github.com/in-toto/attestation) — 2026-09-07 — [厂商文档] — §1.1
22. [SLSA v1.1 规范页（含 v1.2 为当前版本告示）](https://slsa.dev/spec/v1.1/) — 2026-09-07 — [厂商文档] — §1.1
23. [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) — 2026-09-07 — [厂商文档] — §1.1
24. [open-policy-agent/opa releases](https://github.com/open-policy-agent/opa/releases) — 2026-09-07 — [厂商文档] — §2B
25. [Securing CI/CD in an agentic world: Claude Code GitHub Action case — Microsoft Security Blog](https://www.microsoft.com/en-us/security/blog/2026/06/05/securing-ci-cd-in-agentic-world-claude-code-github-action-case/) — 2026-09-07 — [二手] — §1.2、§5
26. [Permissions — OpenCode](https://opencode.ai/docs/permissions/) — 2026-09-07 — [厂商文档] — §1.2
27. [e2b-dev/E2B](https://github.com/e2b-dev/E2B) — 2026-09-07 — [厂商文档] — §2C
28. [Policy in Amazon Bedrock AgentCore is now generally available](https://aws.amazon.com/about-aws/whats-new/2026/03/policy-amazon-bedrock-agentcore-generally-available/) — 2026-09-07 — [二手（未逐页打开，来自检索结果标题与摘要）] — §2B

---

自评：我最没把握的三个判断是 ① OTel GenAI 语义约定"不能当稳定接口"这条——它可能在几个月内就稳定，那样 §5 里"pin 并对账"的额外功夫就白做了；② codex / opencode / dsh 三个宿主"没有可编程 deny 拦截"这条，我只做到"未查到"，很可能是我没找到正确的文档页，需要 A 的报告推翻或确认；③ 把 git pre-commit hook 定级为"工具"而非"约束"——如果配合 `block-no-verify` 类工具 + CI 侧复跑，实际效力可能接近"警告"，我这个定级偏保守。
