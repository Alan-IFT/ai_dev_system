# 编排、流水线与状态：候选、标准与对照

对应部件 20 状态工件 / 21 调度与拆分 / 25 执行者与模型。调研员 B。

## 0. 验证边界

- 检索日期：**2026-09-07**。全部通过 WebSearch / WebFetch 完成；**没有在本机跑过任何候选**，因此本报告没有真正意义上的"跑过"级证据。
- **亲自打开并读完的官方页面**（记 [厂商文档]）：
  - Claude Code 文档：`/docs/en/sub-agents`、`/docs/en/agent-teams`（页面自述 "as of v2.1.178"，正文引用到 v2.1.261）、`/docs/en/workflows`、`/docs/en/hooks`、`/docs/en/headless`、`/docs/en/checkpointing`、`/docs/en/monitoring-usage`
  - Claude Agent SDK 文档：`/docs/en/agent-sdk/subagents`
  - OpenAI Codex：`developers.openai.com/codex/subagents`、非交互模式页（302 重定向到 `learn.chatgpt.com/docs/non-interactive-mode.md`）
  - opencode：`opencode.ai/docs/agents/`、`opencode.ai/docs/cli/`
  - GitHub Copilot：`docs.github.com/.../copilot-cli/about-custom-agents`
  - DBOS：`dbos.dev/dbos-transact`、`docs.dbos.dev/architecture`、`docs.dbos.dev/python/tutorials/workflow-tutorial`
  - LangGraph/LangChain：`docs.langchain.com/oss/python/langgraph/persistence`、`durable-execution.mdx`（经镜像仓库读到正文）
  - Temporal：`docs.temporal.io/self-hosted-guide/deployment`
  - Inngest：`inngest.com/docs/self-hosting`
  - Restate：`restate.dev` 首页
  - gh-aw：`github.github.com/gh-aw/`、`.../reference/safe-outputs-pull-requests/`
- **打开的官方仓库文件**（记 [一手实测·读文件]，但均经摘要器转述而非逐行原文）：`dbos-inc/dbos-transact-py` README、`microsoft/pg_durable` README、`deepseek-ai/deepseek-harness/docs/architecture.md`、`NanmiCoder/dsh-agent-teams` README、`anthropics/claude-code#20625`、`openai/codex#15451`、两个 releases 列表页。
- **只看了搜索摘要、没打开**：Beads 的原始仓库（`steveyegge/beads` 与 `gastownhall/beads` 两个地址并存，我只打开了后者）；所有中文/英文博客与对比文（一律记 [二手]，不作论据）。
- **未查到**：dsh 官方是否有内建 agent-team/任务列表的一等 API（`architecture.md` 只见 `ctx.subagent` 与 `ctx.sessions.fork`）；Copilot 子代理的用量/成本分单元导出；opencode / Copilot 的结构化输出契约；LangGraph OSS 层是否有租约/心跳；DBOS `max_recovery_attempts` 与死信队列的确切语义。
- **日期不确定**：GitHub releases 页只显示"月 日"，年份由我按当前年推定，凡涉及年份处已标注。

---

## 1. 2026 年的行业标准与主流实践（先答这个）

**结论：编排、流水线与状态这一层，没有开放标准。** 我没有查到任何归属于 Linux Foundation / AAIF / IETF / OASIS 的"agent 编排格式""agent 状态工件格式""子 agent 定义格式"标准。周边有三个标准，但都不覆盖本层：

| 标准 | 归属 | 状态 | 覆盖什么 / 不覆盖什么 |
|---|---|---|---|
| MCP | 见调研员 A | 见 A | 工具接口；**不管**任务状态、检查点、重放 |
| A2A | 见 A | 见 A | agent 间消息；**不管**状态工件与幂等 |
| OpenTelemetry GenAI 语义约定 | OTel / CNCF | 见调研员 F | 观测与计费维度；**不管**编排 |

实际形成的**事实标准只有一个**，而且它非常朴素：**"子执行者 = 一个非交互进程；契约 = 命令行 + JSON 输出 + 会话 id 可恢复"**。五个宿主都提供了这个契约，这是唯一一条五宿主同形的路径；而各家的"子 agent 定义文件"格式互不兼容（YAML frontmatter markdown / TOML / JSON / TS 接口），**不能跨宿主复用**。

### 矩阵一：宿主原生子 agent / agent team 能力

| | Claude Code | Codex | opencode | dsh | VSCode Copilot |
|---|---|---|---|---|---|
| 子 agent 定义格式 | `.claude/agents/*.md`，YAML frontmatter [厂商文档] | `~/.codex/agents/*.toml` / `.codex/agents/*.toml` [厂商文档] | `opencode.json` 的 `agent` 段 或 `.opencode/agents/*.md` [厂商文档] | `ctx.subagent` provider 接口（插件层） [一手实测·读文件] | `.github/agents/*.md`，YAML frontmatter [厂商文档] |
| 每 agent 限工具 | `tools` / `disallowedTools` [厂商文档] | 继承沙箱，可覆写 `sandbox_mode` [厂商文档] | `permission`（allow/ask/deny） [厂商文档] | `ctx.tools` 作用域（**A 已一手证实是可见性过滤**） | `tools` 字段 [厂商文档] |
| 每 agent 选模型 | `model`（含 `inherit`）+ 4 级优先序 [厂商文档] | `model` + `model_reasoning_effort` [厂商文档] | `model`（`provider/model-id`） [厂商文档] | 未查到 | 未查到（`rubber-duck` 内建用不同模型） [厂商文档] |
| 并发上限 | 默认 20（`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`） [厂商文档] | `agents.max_threads` 默认 6 [厂商文档] | 未查到 | 未查到 | "可并行"，无数字 [厂商文档] |
| 嵌套深度上限 | 默认 3（`..._MAX_SUBAGENT_SPAWN_DEPTH`） [厂商文档] | `agents.max_depth` 默认 1 [厂商文档] | 未查到 | 未查到 | 未查到 |
| 子 agent 返回 | **自由文本**（官方明写 "return free text to the parent, not structured output"） [厂商文档] | 结果被"合并"为一条响应；`spawn_agents_on_csv` 支持 `output_schema` [厂商文档] | 未查到 | 未查到 | task agent"成功返摘要、失败返全文" [厂商文档] |
| agent team（对等协作） | 有，**实验、默认关闭**（`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`） [厂商文档] | 未查到 | 未查到（有 child session 概念） | 社区插件 `dsh-agent-teams`（MIT，直接 mailbox 投递，队长不转发） [一手实测·读文件] | 未查到 |
| 脚本化编排原语 | 有：Workflow 工具 / dynamic workflows，`agent()` `pipeline()` `parallel()` `phase()` [厂商文档] | 未查到 | 未查到 | `ctx.agentLoop` / `ctx.sessions.fork` [一手实测·读文件] | 未查到 |

### 矩阵二：进程级契约（这是唯一的跨宿主通用层）

| | 非交互入口 | JSON 输出 | **强制结构化输出** | 会话恢复 |
|---|---|---|---|---|
| Claude Code | `claude -p` / `--bare` | `--output-format json\|stream-json` | **`--json-schema`**，结果落在 `structured_output` 字段（v2.1.205+ 起校验 schema） [厂商文档] | `--continue` / `--resume <session_id>`（v2.1.223 起跨目录按 id 找） [厂商文档] |
| Codex | `codex exec` | `--json`（JSONL 事件流） | **`--output-schema <file>`**；文档称"约束输出符合 schema" [厂商文档]，但 issue #15451 报告"有 tools/MCP 时被静默丢弃"，已关闭且未见维护者回复 [一手实测·读文件] → **部分成立** | `codex exec resume --last` / `resume <SESSION_ID>` [厂商文档] |
| opencode | `opencode run` | `--format json`（"raw JSON events"） [厂商文档] | 未查到 | `-c/--continue`、`-s/--session`、`--fork` [厂商文档] |
| dsh | 未查到确切 CLI 形态 | 未查到 | 未查到 | `ctx.sessions.fork(source, boundary?, childSessionId?)`；会话是 append-only `SessionEvent` 日志 [一手实测·读文件] |
| Copilot | `copilot` CLI + `/delegate` | 未查到 | 未查到 | 未查到 |

**这张表是本报告最重要的结论之一**：把"子执行者只回结构化三态裁定"落到通用层，今天只有 Claude Code（满足）与 Codex（部分成立）两家给了一等支持；opencode / dsh / Copilot 上这条要靠"提示词要求 + 上游解析 + 校验失败即判 UNDETERMINED"来兜底。

### 为什么这一层没有标准（一个判断，不是事实）

三条观察支持"短期内也不会有"：① 各家的子 agent 定义文件都是**私有 frontmatter/TOML 字段**，且字段语义与该宿主的权限模型深度耦合（`permissionMode`、`sandbox_mode`、`permission: allow/ask/deny` 三家概念都不同），没有可抽象的公共子集；② AGENTS.md 这个已经跨工具的载体**只管指令、不管状态与编排**，没有任何一家把任务状态写进去；③ 状态的持久位置各家都放在私有目录（`~/.claude/tasks/`、`~/.codex/`、`.opencode/`）并明确标注"不要手改"。

由此得出本报告的选型总原则：**编排与状态不要买宿主的账，要买文件系统与 git 的账。** 宿主原生能力只当"更省 token 的执行手段"用，状态与裁定一律外置到自己的 `events.jsonl` / PR / 数据库里。这正好也是本理论不变量②"状态外置且朴素"的直接推论。

---

## 2. 候选清单

**A 组 · 宿主绑定层**

1. **Claude Code subagents** — 一句话：同会话内隔离上下文的一次性工作者，md+frontmatter 定义。维护状态：活跃，文档随版本号更新到 v2.1.26x。部署形态：无额外依赖，文件即配置。许可：随宿主。宿主绑定层。来源：官方文档。
2. **Claude Code agent teams** — 一句话：多个独立 Claude Code 实例共享任务列表 + mailbox 协作。维护：**实验、默认关闭**，官方列了 8 条限制。部署：本地目录 `~/.claude/teams/{team}/`、`~/.claude/tasks/{team}/`。宿主绑定层。
3. **Claude Code / Agent SDK dynamic workflows（Workflow 工具）** — 一句话：Claude 写一段纯 JS 脚本，运行时在会话外执行，编排几十到几百个 subagent。维护：活跃（TS SDK v0.3.149+）。部署：无额外依赖。宿主绑定层。
4. **Claude Agent SDK** — 一句话：把 Claude Code 的 agent loop 做成 Python / TS 库。维护：活跃（TS v0.3.219 / Py v0.2.127 对齐 CC v2.1.219）。部署：库 + 内嵌 CLI 子进程。宿主绑定层（但可作为"编排器宿主"去驱动别人）。
5. **Codex subagents（`.codex/agents/*.toml`）+ `codex exec`** — 宿主绑定层。维护：活跃。
6. **opencode agents + `opencode run`** — 宿主绑定层。维护：活跃。
7. **dsh：`ctx.subagent` / `ctx.sessions.fork` / append-only SessionEvent 日志 + 社区插件 `dsh-agent-teams`（MIT，Node ≥22，pnpm 11）** — 宿主绑定层。维护：dsh 本体活跃；插件 40 commits、187 star（星数只作观察，不作论据）。
8. **Copilot custom agents + 内建子代理（explore / task / general-purpose / code-review / research / rubber-duck）** — 宿主绑定层。

**B 组 · 通用层：编排/持久执行引擎**

9. **LangGraph + checkpointer** — 一句话：图状态机 + 每步落库的检查点。维护：活跃（`langgraph` 1.2.11、`langgraph-checkpoint-postgres` 3.1.2、`langgraph-checkpoint` 4.2.0，releases 页只显示月日、年份按 2026 推定）。部署：**库**；Postgres 变体需先调 `.setup()` 建表。许可：MIT（未逐字核对）。通用层。
10. **DBOS Transact** — 一句话：靠装饰器把普通函数变成"检查点存在 Postgres 里"的持久工作流。维护：活跃（Python 2.24.0，2026-06-15 推定）。部署：**纯库，只要 Postgres**，README 逐字："there's no additional infrastructure for you to configure or manage"、"no separate queueing service or message broker—just Postgres"。许可：MIT。语言：TS/Python/Java/Go/Kotlin。通用层。**最贴合 Alan 环境（两台机器都有 PostgreSQL 18）**。
11. **`microsoft/pg_durable`** — 一句话：把持久工作流做成 PostgreSQL 扩展，工作流用 SQL DSL 表达（`|=>`、`~>`、`df.if()`、`df.loop()`）。维护：**Preview**。部署：PG 扩展（Rust/pgrx），要求 PostgreSQL 17/18；README 逐字："No Redis, no Temporal, no external services"。许可：PostgreSQL License。通用层。
12. **Temporal** — 一句话：行业里最成熟的持久执行平台。部署：**服务**（Temporal Server + UI Server + 数据库 Cassandra/MySQL/PostgreSQL + 可见性层通常要 Elasticsearch）。文档自述"应像数据库一样加固"。通用层但重。
13. **Restate** — 一句话：单二进制的持久执行运行时，journal/replay 模型。部署：**需要独立 `restate-server` 进程**（"Single Binary, Zero Dependencies"），自带存储；未查到许可与版本。通用层。
14. **Inngest** — 一句话：事件驱动的持久函数。部署：**需要 `inngest` 服务进程**；默认内嵌 Redis + SQLite，生产建议外部 Redis + PostgreSQL；官方明写"不保证对自托管实例的支持"。通用层。

**C 组 · 通用层：以 git/PR 为状态机的轻量做法**

15. **GitHub Agentic Workflows（gh-aw）** — 一句话：用 Markdown 写自动化，编译成 `.lock.yml` 在 GitHub Actions 里跑 AI agent；**支持 Copilot（默认）/ Claude / Codex / Gemini，另有 opencode 等可导入引擎**。维护：GitHub Next + Microsoft Research，**Public Preview**。部署：GitHub Actions，无自建服务。许可/最新发布日期：未查到。通用层（唯一一个官方就跨多宿主的编排层）。
16. **Beads（`bd`）** — 一句话：为 coding agent 做的、git 原生的依赖图式 issue 追踪器；`bd ready` 列可领任务、`bd update <id> --claim` 原子认领。存储：Dolt（默认嵌入 `.beads/embeddeddolt/`，多写需 `dolt sql-server`），`.beads/issues.jsonl` 只是导出格式**不是真相源**。许可 MIT。接口：CLI + MCP。通用层。**注意**：搜索结果里同时存在 `steveyegge/beads` 与 `gastownhall/beads`，且有第三方描述称其存储是"SQLite + JSONL"，与我读到的 Dolt 说法冲突 → 见 §6。
17. **基线：朴素状态文件 + shell/Make 脚本 + 进程契约** — 一句话：`STATE.md` + `events.jsonl` + `leases/*.json` + `git`，子执行者是 `claude -p --json-schema` / `codex exec --output-schema` 进程。部署形态：零依赖。通用层。**这是本报告的推荐基线，也是对照表里的"最小满足形态"。**

---

## 3. 对照本理论的要求（核心）

列的含义：**原生** = Claude Code subagents + agent teams；**WF** = Claude Code dynamic workflows；**基线** = 候选 17（朴素文件 + 进程契约）；**LG** = LangGraph + PostgresSaver；**DBOS** = DBOS Transact；**gh-aw** = git/PR 状态机。

### 3.1 部件 20 · 状态工件

| 要求 | 最小满足形态（少就是多） | 原生 | WF | 基线 | LG | DBOS | gh-aw |
|---|---|---|---|---|---|---|---|
| 三类状态工件职责不重叠（实时源/带身份快照/里程碑摘要） | 三个文件：`STATE.md` / `handoff-<runid>.md` / git tag+CHANGELOG | 部分：`~/.claude/tasks/{team}/`（实时、会话结束仍留）+ `teams/{team}/config.json`（会话结束即删）+ mailbox JSON；**无里程碑层**，且 config 官方明说"别手改" [厂商文档] | 部分：每个 agent 结果存 `~/.claude/projects/<session>/`，无分层 [厂商文档] | 满足：三层由你定义 | 部分：checkpoint=实时源、Store=跨线程长期，无里程碑层 [厂商文档] | 部分：系统库存 checkpoint/step 输出/队列状态，无分层 [厂商文档] | 满足：Issue/PR=实时源、Actions run + git bundle artifact=带身份快照、merge commit/tag=里程碑 [厂商文档] |
| 每条状态记录带可交叉核对的工作副本身份与时间 | 每行 JSON 带 `commit_sha` + `worktree` + ISO 时间 | 不满足：任务与消息不绑 git 身份（subagent 有 `isolation: worktree` 但状态记录不含它） [厂商文档] | 不满足 | 满足 | 部分：有 `thread_id`/`checkpoint_id`，工作副本身份要自己塞进 state [厂商文档] | 部分：有 workflow id，工作副本身份要自己塞进入参 [厂商文档] | 满足：run_id + sha + bundle 天然齐全 [厂商文档] |
| 唯一状态机、"完成"只有一个定义 | 只有 `STATE.md` 里那个状态字段算数 | 部分：任务三态 pending/in-progress/completed，但同时存在 TodoWrite、任务列表、git 三处；官方限制里明写"teammates sometimes fail to mark tasks as completed" [厂商文档] | 部分：脚本即唯一状态机，但"完成"仍是 agent 自述 | 满足 | 部分：图是唯一状态机，"完成"需自定义终止条件 | 部分：同 LG | 满足："merged 且必需检查全绿"是唯一定义 |
| 每次状态转换留结构化记录（含三态裁定） | 向 `events.jsonl` append 一行 `{unit,from,to,verdict,evidence}` | 部分：`TaskCreated`/`TaskCompleted`/`TeammateIdle`/`SubagentStop` hook 有 JSON payload、exit 2 可拦截，**可以在 hook 里写**；内置不写裁定 [厂商文档] | 部分：`agent(prompt,{schema})` 可强制结构化裁定；但转换本身只进 UI 进度视图 [厂商文档] | 满足 | 部分：checkpoint 含 channel values + pending writes，三态字段自己加 [厂商文档] | 部分：step 输出即 checkpoint，三态作为返回类型自己定 [厂商文档] | 部分：check conclusion 天然 success/failure/**neutral** 三态；但要自己把裁定写进 check 而非日志 |
| **进行中的单元有活性信号（租约/心跳）与合法停止点** | `leases/<unit>.json` 含 `holder`+`expires_at`，执行者每 N 秒续期；停止点 = 切片边界 | **不满足**：无租约、无心跳。只有 `TeammateIdle` 事件与 UI 上"idle 行 30 秒后隐藏"；官方限制自陈"Task status can lag"、"Agents stopping early" [厂商文档] | **不满足**：无租约；有 `p` 暂停 / `x` 停止（合法停止点部分成立） [厂商文档] | 部分：租约要自建，但形态极小（一个 JSON + 一行 `date -d`） | **不满足**（OSS 库层）：未查到租约/心跳；LangGraph 平台版未查 | 部分：单进程启动时扫 PENDING 自动恢复；**多执行器场景文档只说"需要协调，或通过 Conductor 或手工"**，未见 lease/heartbeat 描述 [厂商文档] | 部分：Actions job 有 `timeout-minutes` 与 runner 心跳，但不是租约语义（无 holder 归属） |
| **从任一持久检查点可恢复且不重复已发生的不可逆副作用** | 不可逆动作一律"先写 receipt 再执行"，重放时先查 receipt | **不满足**：`/rewind` 只回滚编辑工具的改动，**明确不回滚 bash 改的文件、不回滚 subagent 的编辑、不回滚外部改动**；agent teams "No session resumption with in-process teammates" [厂商文档] | **不满足**：官方逐字——失败 agent 之后启动的 agent（含已完成的）全部重跑，"a failure in the middle of a fan-out reruns work that already finished" [厂商文档] | 部分：引擎不保证，须自建幂等键；但可以做到 | 部分：官方逐字——"In the event that a task starts but fails to complete successfully, the workflow's resumption will re-run the task"，并要求你"Use idempotent operations"/"Use idempotency keys" [厂商文档] | **部分（最强）**：官方逐字——"Steps are tried at least once but are never re-executed after they complete"；`SetWorkflowID` 作幂等键"if a workflow is called multiple times with the same ID, it executes only once"。**中断的那一步仍会重跑**，故不是"满足" [厂商文档] | 部分：agent 本身**无写权限**，所有副作用集中在单独的 `safe_outputs` job（`max`、`max-patch-files`、`max-patch-size`、`protected-files` 限流）；但整 job 重跑会重复创建 PR [厂商文档] |
| 恢复是从上一检查点之后重放 | `events.jsonl` 最后一条之后重放 | 不满足 | 部分：确实按 agent 启动顺序重放、已完成的返回缓存；且脚本内 `Date.now()`/`Math.random()`/无参 `new Date()` **被故意做成抛异常**以保证重放确定性——设计意图正确；但失败点之后全部重跑 [厂商文档] | 满足 | 满足：三档 durability 明确——`"exit"` / `"async"` / `"sync"`；恢复语义是"replay all steps from the start until the stopping point" [厂商文档] | 满足 | 部分：Actions 的 rerun 粒度是 job，不是步 |
| 交接分两层（短交接进窗口，完整产物按引用回源） | `handoff.md` 只写结论 + 路径/sha 引用 | 部分：subagent 只把 final message 回父、过程留在独立 transcript 文件，可凭 `agentId` + `resume: sessionId` 回源 [厂商文档] | 部分：中间结果留脚本变量不进上下文（等于外部化），但不持久按引用回源 | 满足 | 部分 | 未适用/部分 | 满足：PR 描述=短交接，diff/artifact=按引用回源 |

**这张表的三条硬结论**：

- **活性信号（租约/心跳）是全场最大的空洞。** 六列里没有一列"满足"。宿主原生完全没有；两个持久执行引擎在单进程下靠"启动时扫 PENDING"代替，多执行器下 DBOS 文档自己说要 Conductor 或手工协调；gh-aw 有超时但没有归属语义。**结论：租约必须自建，而且它极小**——一个 `{unit, holder, expires_at}` JSON 加一条巡检，是整个方案里性价比最高的一段代码。
- **"不重复不可逆副作用"上，宿主原生是负分而不是零分**：Claude Code 的 `/rewind` 会让人以为有回滚能力，但它明确不管 bash 改的文件、不管 subagent 的编辑、不管外部改动；dynamic workflows 更是官方承认"失败点之后已完成的工作会重跑"。**所以在任何宿主上，不可逆动作都必须自己配 receipt/幂等键，不能指望宿主。**
- **git 在这张表上是最强的单一部件**：工作副本身份、里程碑摘要、按引用回源三条，git 一个工具就同时满足，而且判据 B 明确说"历史决策本来就在 git 里"。

### 3.2 部件 21 · 调度与拆分

| 要求 | 最小满足形态 | 原生 | WF | 基线 | LG | DBOS | gh-aw |
|---|---|---|---|---|---|---|---|
| 切成端到端可独立验收的切片 | 一个切片 = 一个验收条目 + 一条 `events.jsonl` 记录 | 部分：靠提示词与任务大小建议（官方建议每人 5–6 个任务） | 部分：`pipeline(list, fn)` 天然一项一切片 | 满足 | 部分 | 部分：队列 + workflow 天然分片 | 满足：一个 PR = 一个切片 |
| 阶段独立存在须举证（验证者分离外的拆分要理由） | 在 `PIPELINE.md` 里为每个非验证者阶段写一句理由 | 不满足（纯文档纪律，宿主不管） | 不满足 | 满足（就是文档） | 不满足 | 不满足 | 不满足 |
| 返工定向到出错环节，驳回原因作为下一轮**必需输入** | 下一轮 prompt 模板里 `rejection_reason` 是必填字段 | 不满足：只能自然语言让 lead"再去催" | 部分：脚本可循环并把上轮结果喂下轮（官方示例"keep fixing until the type check passes"） [厂商文档] | 满足 | 部分：可条件路由回节点 | 部分 | 部分：PR review comment → 下一轮天然输入 |
| **三类停机条件（证据型/停滞型/上限型），任一触发即转阻塞并升级** | 三个显式判断 + 一个 `BLOCKED` 状态 | 部分：只有上限型（`maxTurns`、并发 20、深度 3、SDK `maxBudgetUsd`/`error_max_budget_usd`）；**到限只是把输出标成 partial，不转阻塞不升级** [厂商文档] | 部分：上限型内建（单次 `parallel/pipeline` ≤4096 项、每 run ≤1000 agents、并发 ≤16、>25 agents 或 >150 万 token 触发 `Large workflow` 警告——**但官方明说该警告只是advisory，不暂停不限制**）；停滞型可在脚本里写（"two rounds in a row make no progress"）；证据型靠 schema [厂商文档] | 满足 | 部分：`recursion_limit` = 上限型 | 部分：step 重试策略 + 超时；`max_recovery_attempts` 语义**未查到** | 部分：Actions `timeout-minutes` / concurrency = 上限型 |
| 重试前须改变至少一个输入变量并记录 | 重试记录里必须有 `changed_input` 字段，否则拒绝重试 | 不满足 | 不满足 | 满足 | 不满足 | 不满足（step 重试是同参重试） | 不满足 |
| **子执行者只回结构化三态裁定、上游不解析自由文本** | 子执行者 = `claude -p --output-format json --json-schema '{...verdict:PASS/FAIL/UNDETERMINED...}'` | **不满足**：官方明写 subagent 返回自由文本；社区诉求 issue #20625 已 **Closed as not planned**（开于 2026-01-24） [厂商文档][一手实测·读文件] | **满足**：`agent(prompt, {schema})` 强制 JSON schema [厂商文档] | **满足**（CC）/ **部分**（Codex，见 #15451）/ **未定**（opencode、dsh、Copilot） | 满足：state 本身是结构化的 | 满足：step 返回类型化对象 | 部分：safe outputs 是被校验的结构化输出，但"裁定"仍要你映射到 check conclusion |
| 验证者分离是默认允许的拆分 | 一个 reviewer 角色文件 | 满足：subagent 定义 + `disallowedTools: Write, Edit` 直接给出只读验证者 [厂商文档] | 满足 | 满足 | 满足 | 满足 | 满足：safe outputs 设计即"生成者无写权限、应用者另一个 job" |
| 并行单元只写自身局部空间、总状态由收口阶段单一执行者更新 | 每个并行单元一个 worktree/目录；收口只有一个进程写 `STATE.md` | 部分：`isolation: worktree` 给了局部空间；但总状态更新无强制单一收口，官方最佳实践只是"别让两个 teammate 改同一文件" [厂商文档] | 部分：`parallel()`/`pipeline()` 结果统一回到脚本变量 = 单一收口（满足）；局部空间靠提示词（"in its own isolated copy"） [厂商文档] | 满足 | 部分：Send/reducer 合并，"只写局部"要靠 reducer 设计 | 部分：队列并发 + 单一父 workflow 收口 | 满足：每个 run 独立 checkout；写集中在 `safe_outputs` job |
| **汇合必须显式报告预期/实收/缺失** | 收口时打印 `expected=N received=M missing=[...]` | **不满足**：teammate 完成是逐条 idle 通知，无汇总口径 | 部分：`pipeline()` 对被停/失败的 agent 保留 `null`（官方示例用 `.filter(Boolean)` 丢掉）→ **能算出缺失，但默认做法是把缺失静默丢掉** [厂商文档] | 满足 | 部分 | 部分 | 部分：Actions 汇总 job 可数，但要自己写 |

**这张表的两条硬结论**：

- **三类停机条件，今天各家只做了"上限型"，而且到限的动作是错的。** Claude Code `maxTurns` 到限只是把输出标 partial；dynamic workflows 的 `Large workflow` 警告官方明写"advisory，不暂停不限制"；SDK 的 `maxBudgetUsd` 是唯一一个到限真的中止（`error_max_budget_usd`）的机制。**证据型与停滞型两类，六个候选里没有一个内建**——必须自己写，而且写起来就是两个 if。
- **"汇合显式报告预期/实收/缺失"是被各家默认做法主动破坏的**：dynamic workflows 官方示例用 `.filter(Boolean)` 把失败 agent 的 `null` 直接丢掉；agent teams 是逐条 idle 通知没有汇总。这条不是"没做"，是"默认做法把缺失静默吃掉了"，因此必须在收口阶段显式打印三个数。

### 3.3 部件 25 · 执行者与模型

| 要求 | 最小满足形态 | 原生 | WF | 基线 | LG/DBOS | gh-aw |
|---|---|---|---|---|---|---|
| 执行者是可替换执行单元（输入、输出、权限、完成条件） | 一个 agent 文件 + 一个 JSON schema + 一条 allow 列表 | 部分：`tools`/`disallowedTools`/`model`/`permissionMode`/`maxTurns`/`skills`/`mcpServers`/`hooks`/`memory`/`isolation` 覆盖输入·权限·完成条件，**唯独输出契约缺失** [厂商文档] | 部分→满足：`agent()` 补上了输出 schema | 满足 | 满足 | 满足：引擎在 `.md` 里声明，可换 |
| 每次委托写合同并声明是否继承治理规则 | 委托 prompt 里显式写"本次继承/不继承 X" | 部分：teammate 自动继承 lead 的权限模式、CLAUDE.md、MCP、skills（**继承是隐式的、不可按 teammate 在 spawn 时设定**）；但跨 agent 消息的治理被显式否定——官方明写收方被告知"消息来自另一个 Claude 会话而非你"，teammate **不能代批准、不能中转绕过** [厂商文档] | 部分 | 满足 | 部分 | 部分 |
| 按角色选模型档位、模型可替换 | 角色文件里一行 `model:` | **满足**：`model` + 4 级优先序 + `CLAUDE_CODE_SUBAGENT_MODEL(_FORCE)` + `availableModels` 白名单被挡时的替换规则 + `effort` [厂商文档] | 满足 | 满足 | 满足 | 满足（可换整个引擎） |
| 确定性判断下沉给程序 | 判定用脚本，模型只解释 | 部分：hooks（`PreToolUse`/`TaskCompleted`/`TeammateIdle` exit 2）是现成的下沉点 [厂商文档] | 满足：脚本持有循环与分支 | 满足 | 满足 | 满足：必需检查即程序判定 |
| **子执行者独立计费、分单元报告** | 每个子进程一行 `total_cost_usd` | **满足**：OTel 指标 `claude_code.cost.usage` / `claude_code.token.usage` 带 `agent.name`、`query_source`（`main`/`subagent`/`auxiliary`）、`skill.name`、`plugin.name`；增强追踪的 `claude_code.llm_request` span 带 `agent_id`、`parent_agent_id`、`workflow.run_id`、`workflow.name`。**注意**：用户自定义 agent 名会被替换成 `"custom"` [厂商文档] | 满足：`/workflows` 视图逐 agent 显示 token；SDK `total_cost_usd` + `maxBudgetUsd` [厂商文档] | 满足：`--output-format json` 的 `total_cost_usd` + 分模型明细（官方注明是**客户端估算**，可能与账单不符） | 部分：需自建（LangSmith/OTel） | 部分：Actions 用量可见，token 计费要 agent 侧提供 |
| （Codex/opencode/dsh/Copilot 的分单元计费） | — | **未查到**（四家都没查到分子代理的用量导出） | — | — | — | — |

---

## 4. 判据 A/B/C 判定

| 候选 | A（必需）还是 B（可选） | C：引入的失效面 与"它坏了怎么被发现" |
|---|---|---|
| **朴素状态文件 + 进程契约（基线）** | **A 必需**。没有外置状态工件，"每轮先读状态""从检查点恢复""三态裁定写回"都无法被判定为已执行 | 失效面：文件被并发写坏、JSON 不合法。探测：每轮开始先 `jq` 校验 `events.jsonl` 尾行 + 比对 `git rev-parse HEAD` 与最后一条记录的 sha，不一致即 UNDETERMINED。**探测独立于文件本身（用 git 和 jq）** → 可装 |
| **Claude Code subagents** | **B 可选**。它是"更省上下文的委托手段"，不是判定条件的载体（返回自由文本，反而使"只回结构化裁定"更难满足） | 失效面：模型不委托、深度/并发被静默截断、子 agent 编辑不进 checkpoint。探测：`SubagentStart`/`SubagentStop` hook 落盘计数，与预期委托数对账；`/rewind` 之外用 `git status` 兜底。→ 可装，但要配 hook |
| **Claude Code agent teams** | **B 可选**，且当前**建议不装**：官方自陈实验、默认关闭、无会话恢复、任务状态会滞后 | 失效面：mailbox 写失败（官方有专门错误页）、teammate 静默 idle、resume 后 lead 给不存在的 teammate 发消息。探测：`TeammateIdle` hook + 对 `~/.claude/tasks/{team}/` 做超时扫描。→ 探测写得出，但收益不抵失效面，**L0/L1 不装** |
| **Claude Code dynamic workflows** | **B 可选**，但对"结构化三态裁定"与"编排即代码"是**目前 Claude Code 上唯一一等的实现** | 失效面：失败点之后已完成的工作会重跑（副作用重复）、脚本无模块加载、无中途人工输入。探测：把不可逆动作全部前置 receipt，重放前查 receipt；`/workflows` 视图逐 agent token 与 `Large workflow` 警告作为上限型停机的信号。→ 可装 |
| **LangGraph + PostgresSaver** | **B 可选**。图状态机本身可用一个 JSON 文件加一段 shell 替代 | 失效面：Postgres 不可用、`.setup()` 未跑、`thread_id` >255 字符、resume 重放导致副作用重复。探测：启动自检查表 + 一条"已知答案"的空跑工作流每日跑一次。→ 可装，但对一人项目属于超配 |
| **DBOS Transact** | **B 可选**（对 L2/L3 接近必需）。判据 A 的严格问法："没有它，哪一条规范无法被判定？"——没有一条；但"恢复不重复不可逆副作用"用它最省代码 | 失效面：Postgres 不可用；**多执行器时无内建租约，崩溃的 executor 其 PENDING 工作流可能无人接管**（文档：需 Conductor 或手工协调）。探测：一条定时的"哨兵工作流"（每 5 分钟启动、必须在 1 分钟内完成），外加对系统库 PENDING 且超过阈值的行做告警——**探测不依赖 DBOS 自身的恢复机制** → 可装 |
| **`microsoft/pg_durable`** | **B 可选**。Preview 状态 | 失效面：扩展崩溃即 Postgres 后端受影响（比库形态失效面更大）；preview 期 API 可能变。探测：同上哨兵 + `pg_extension` 版本对账。→ **暂不装**，观察到 GA 再评 |
| **Temporal** | **B 可选** | 引入 Server + UI + DB + Elasticsearch 四个失效面，一人项目里探测成本高于收益。→ **不装** |
| **Restate / Inngest** | **B 可选** | 各引入一个必须常驻的服务进程（Inngest 官方还声明不保证支持自托管）。→ **不装** |
| **gh-aw** | **B 可选**，但对"必经路径式的状态机"性价比最高 | 失效面：GitHub 侧不可用即全线停摆（跨边界，按不变量⑥"边界外不由我们控制"，结果未知即 UNDETERMINED）；Public Preview 期行为可能变。探测：workflow 编译产物 `.lock.yml` 入库并 diff；每个 run 必须产出一条结构化结论，缺失即判 UNDETERMINED。→ **可装（L2 起）** |
| **Beads（bd）** | **B 可选**。它把"依赖图 + 就绪队列 + 原子认领"现成给了你；但依赖关系与历史决策本来就在 git 与验收条目里 | 失效面：Dolt 嵌入模式单写者；`.beads/issues.jsonl` 是导出不是真相源，容易被当成真相源。探测：定期用 `bd` 导出与 `events.jsonl` 对账，条目数不一致即人工分诊。→ **L1 末/L2 可选装**；它唯一不可替代的是 `--claim` 原子认领（多执行者并发时的租约雏形） |

---

## 5. 推荐与备选（按 L0→L3 分档）

### L0 · 一人一工具
- **装**：什么都不装。`STATE.md`（实时状态源，含唯一"完成"定义）+ 手写交接段落 + git 提交信息作里程碑。
- **不装**：subagent、agent teams、任何引擎。
- **为什么**：L0 全部是文档与人工流程，判据 A 下没有一条规范需要工具才能被判定。

### L1 · 一人多会话（Alan 现在在这里）
- **装**（这是本报告的主推荐）：
  1. **`events.jsonl`（只追加）+ `STATE.md`（唯一状态机）+ `handoff-<runid>.md`（带身份快照）** 三件套；每条记录带 `commit_sha`、`worktree`、ISO 时间、`verdict ∈ {PASS, FAIL, UNDETERMINED}`。
  2. **子执行者 = 非交互进程 + 强制 schema**：Claude Code 上 `claude -p --output-format json --json-schema`（**这是"上游不解析自由文本"在 Claude Code 上唯一可靠的落地方式**，会话内 subagent 做不到）；Codex 上 `codex exec --output-schema`（并对每次输出做 schema 校验，校验失败即 UNDETERMINED，因为 #15451）；opencode 上 `opencode run --format json` + 上游校验。
  3. **`leases/<unit>.json` 租约**（holder + expires_at，约 20 行 shell），加一条巡检：过期租约即把该单元转 `BLOCKED`。这条不能省——所有宿主原生方案在活性信号上都是"不满足"。
  4. **hooks 作为结构化记录的写入点**：Claude Code 的 `SubagentStop`（拿 `last_assistant_message`）、`Stop`、`SessionEnd` 各写一行 `events.jsonl`。
  5. **计费**：开 Claude Code OTel，用 `claude_code.cost.usage` 的 `query_source` + `agent.name` 分单元报告；进程式子执行者直接读 `total_cost_usd`。
- **不装**：agent teams（实验、无恢复、状态会滞后）、LangGraph、任何持久执行引擎、任何服务。
- **升级信号（写死三条，任一触发即评估升 L2）**：
  1. 出现过一次"重放导致不可逆副作用重复"（重复提交、重复创建 PR、重复外部写）；
  2. 并行单元常态 >5，租约巡检开始出现"过期但其实还活着"的误判；
  3. 需要多台机器（Alan 的开发机 + 内网生产机）同时跑同一条流水线——文件锁在跨机时不成立。
- **不作为升级信号的**：token 花得多、单元数量多、想要"更专业的编排"。这些用脚本加几行就够，不构成引入引擎的理由。

### L2 · 团队 / 多执行者并发
- **装**：在 L1 基础上加**二选一**：
  - **DBOS Transact**（Python/TS 都有，只要 PostgreSQL 18，库形态、零额外服务）——用它承载"从检查点恢复且已完成步骤不重跑"与"幂等键"；把每次委托做成一个 `@DBOS.workflow`，`SetWorkflowID` 用切片 id。**必须自己补的两块**：多执行器租约（哨兵工作流 + PENDING 超时告警）、三态裁定字段。
  - **gh-aw**（若工作本来就走 GitHub PR）——用 PR + 必需检查作状态机，safe outputs 保证"生成者无写权限、写入集中到单一收口 job"，check conclusion 的 success/failure/**neutral** 直接就是三态。
- **可选加**：**Beads**，只为它的 `bd ready` + `--claim` 原子认领（多执行者领任务的最小租约）。
- **不装**：Temporal / Restate / Inngest（都要常驻服务，判据 C 下失效面与探测成本不划算）、LangGraph（图状态机对本理论没有独有贡献，且 resume 仍要你自己保证幂等）。
- **升级信号**：需要"无人值守下拒绝坏输出"的自动判定器时 → L3。

### L3 · 无人值守
- **装**：DBOS（或 gh-aw）+ 独立判定器（属调研员 F 的控制平面）+ 强制 schema 的三态裁定 + 三类停机条件全部程序化（证据型：判定器给 FAIL；停滞型：连续两轮 `changed_input` 为空或结果哈希不变；上限型：`maxBudgetUsd` / `max_turns` / Actions timeout）。
- **前置条件不满足就别上**：本理论已写明 L3 的前置是"有一个不需要人在场就能拒绝坏输出的判定器"；今天所有宿主原生的停机条件到限后都只是"标记 partial"而不是"转阻塞并升级"，这一步必须自己写。

### 明确不采纳
- **Temporal**：Server + UI + DB + Elasticsearch，一人项目里纯负担。
- **Restate**：必须常驻独立 `restate-server`；对"只靠 PostgreSQL"这条约束不符。
- **Inngest**：必须常驻服务 + 生产需外部 Redis/PG；官方声明不保证自托管支持。
- **`microsoft/pg_durable`**：方向最符合"只靠 PostgreSQL、零外部服务"，但 Preview，且把失效面放进数据库进程里；**列为观察项**，不是现在的推荐。
- **Claude Code agent teams**：实验、默认关闭、无 in-process teammate 恢复、任务状态会滞后、一个会话只有一个团队、不能嵌套——对"唯一状态机 + 活性信号 + 恢复"三条要求全不满足。
- **LangGraph 作为本项目的编排层**：它的 checkpoint 语义清晰（`exit/async/sync` 三档、重放规则写得最明白），但它带来的是"图"这一层抽象，而本理论要的是"状态外置且朴素"；判据 B 下它主要是把 `events.jsonl` 里已有的信息换个形式重放。**保留为参考语义来源，不作实现依赖。**

---

## 6. 未定与待核实

1. **Beads 的存储真相源**：我打开的 `gastownhall/beads` README 说底层是 Dolt、`.beads/issues.jsonl` 只是导出；而搜索结果里第三方（Rust 移植版描述）称"SQLite + JSONL export for git collaboration"，且 `steveyegge/beads` 与 `gastownhall/beads` 两个仓库地址并存。**未定** —— 装之前须确认哪个是上游、真相源到底是什么，否则"派生缓存必须声明为缓存"这条会被违反。
2. **DBOS 多执行器的活性语义**：文档说分布式下"需要协调，或通过 Conductor 或手工"，但没有说清没有 Conductor 时崩溃 executor 的 PENDING 工作流由谁接管、有没有 lease 列。**未定**，需要读系统库表结构确认。这直接决定 §3.1"活性信号"那格能不能从"部分"变"满足"。
3. **Codex `--output-schema` 是否真的强制**：官方文档说约束输出，issue #15451 说有 tools/MCP 时被静默丢弃、退化成裸 YAML，issue 已关闭且未见维护者回复。**部分成立**，需要 Alan 在 0.116 之后的版本上实测一次。
4. **opencode / dsh / Copilot 的结构化输出**：三家都**未查到**强制 schema 的入口。若确实没有，则"子执行者只回结构化三态裁定"在这三个宿主上只能靠"上游校验 + 失败即 UNDETERMINED"，属于**部分成立**，不能写成成立。
5. **dsh 是否有一等的任务列表/状态工件 API**：`architecture.md` 只见 `ctx.subagent`、`ctx.sessions.fork`、append-only `SessionEvent`，**未查到** todo/task 持久化。dsh 的 append-only 会话日志形态其实与本理论的 `events.jsonl` 高度同构，值得 Alan 单独一手核实——如果 `SessionEventMap` 可扩展，dsh 上的状态工件可能比 Claude Code 更自然。
6. **gh-aw 的许可证与发布节奏**：**未查到**。Public Preview 期的行为变更风险需要 Alan 裁。
7. **版本日期**：DBOS 2.24.0（页面显示"June 15"）、langgraph 1.2.11 / langgraph-checkpoint-postgres 3.1.2（页面显示"Aug"）的**年份由我推定为 2026**，未逐条核实。
8. **需要 Alan 裁的一件事**：`--json-schema` / `--output-schema` 这条"进程级契约"是通用层还是宿主绑定层？它在五个宿主上**语义相同但拼写不同**（`--json-schema` / `--output-schema` / 未查到 / 未查到 / 未查到）。我倾向把"子执行者返回结构化三态裁定"写进正文作语义不变量，把三种拼写放进效力为零的附录；但只有两家半支持，是否够格作正文语义，需要裁定。

---

## 7. 来源

1. [Create custom subagents — Claude Code Docs](https://code.claude.com/docs/en/sub-agents) — 2026-09-07 — [厂商文档] — §1 矩阵一、§3.1、§3.2、§3.3、§4
2. [Orchestrate teams of Claude Code sessions — Claude Code Docs](https://code.claude.com/docs/en/agent-teams) — 2026-09-07 — [厂商文档] — §1、§3.1、§4、§5「明确不采纳」
3. [Orchestrate subagents at scale with dynamic workflows — Claude Code Docs](https://code.claude.com/docs/en/workflows) — 2026-09-07 — [厂商文档] — §2 候选 3、§3.1、§3.2、§4
4. [Subagents in the SDK — Claude Agent SDK Docs](https://code.claude.com/docs/en/agent-sdk/subagents) — 2026-09-07 — [厂商文档] — §2 候选 4、§3.2 上限型、§3.3 计费
5. [Run Claude Code programmatically (headless) — Claude Code Docs](https://code.claude.com/docs/en/headless) — 2026-09-07 — [厂商文档] — §1 矩阵二、§5 L1 推荐
6. [Hooks — Claude Code Docs](https://code.claude.com/docs/en/hooks) — 2026-09-07 — [厂商文档] — §3.1 结构化转换记录、§5 L1
7. [Checkpointing — Claude Code Docs](https://code.claude.com/docs/en/checkpointing) — 2026-09-07 — [厂商文档] — §3.1「不重复不可逆副作用」
8. [Monitoring and usage (OpenTelemetry) — Claude Code Docs](https://code.claude.com/docs/en/monitoring-usage) — 2026-09-07 — [厂商文档] — §3.3 子执行者独立计费
9. [Subagents — OpenAI Codex Docs](https://developers.openai.com/codex/subagents) — 2026-09-07 — [厂商文档] — §1 矩阵一
10. [Non-interactive mode — OpenAI Codex Docs](https://learn.chatgpt.com/docs/non-interactive-mode.md) — 2026-09-07 — [厂商文档] — §1 矩阵二
11. [openai/codex issue #15451 — `--json`/`--output-schema` 在有 tools/MCP 时被忽略](https://github.com/openai/codex/issues/15451) — 2026-09-07 — [一手实测·读文件] — §1 矩阵二、§6.3
12. [Agents — opencode Docs](https://opencode.ai/docs/agents/) 与 [CLI — opencode Docs](https://opencode.ai/docs/cli/) — 2026-09-07 — [厂商文档] — §1 两张矩阵
13. [About custom agents — GitHub Copilot Docs](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-custom-agents) — 2026-09-07 — [厂商文档] — §1 矩阵一
14. [deepseek-ai/deepseek-harness — docs/architecture.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) — 2026-09-07 — [一手实测·读文件] — §1、§2 候选 7、§6.5
15. [NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) — 2026-09-07 — [一手实测·读文件] — §2 候选 7
16. [anthropics/claude-code issue #20625 — 子 agent 结构化输出（Closed as not planned）](https://github.com/anthropics/claude-code/issues/20625) — 2026-09-07 — [一手实测·读文件] — §3.2「只回结构化三态裁定」
17. [DBOS Transact 概览](https://www.dbos.dev/dbos-transact)、[DBOS Architecture](https://docs.dbos.dev/architecture)、[Workflow tutorial](https://docs.dbos.dev/python/tutorials/workflow-tutorial) — 2026-09-07 — [厂商文档] — §2 候选 10、§3.1、§4、§5 L2
18. [dbos-inc/dbos-transact-py README 与 releases](https://github.com/dbos-inc/dbos-transact-py) — 2026-09-07 — [一手实测·读文件] — §2 候选 10 的"只要 Postgres"逐字引用、版本
19. [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence) 与 [Durable execution（mdx 正文）](https://docs.langchain.com/oss/python/langgraph/durable-execution) — 2026-09-07 — [厂商文档] — §3.1 durability 三档与"re-run the task"逐字引用
20. [Temporal 自托管部署指南](https://docs.temporal.io/self-hosted-guide/deployment) — 2026-09-07 — [厂商文档] — §2 候选 12、§5 明确不采纳
21. [Inngest 自托管文档](https://www.inngest.com/docs/self-hosting) — 2026-09-07 — [厂商文档] — §2 候选 14、§5 明确不采纳
22. [Restate 官网](https://restate.dev/) — 2026-09-07 — [厂商文档] — §2 候选 13
23. [GitHub Agentic Workflows (gh-aw)](https://github.github.com/gh-aw/) 与 [Safe Outputs: Pull Requests](https://github.github.com/gh-aw/reference/safe-outputs-pull-requests/) — 2026-09-07 — [厂商文档] — §2 候选 15、§3.1、§3.2、§4、§5 L2
24. [microsoft/pg_durable](https://github.com/microsoft/pg_durable) — 2026-09-07 — [一手实测·读文件] — §2 候选 11、§5 明确不采纳（观察项）
25. [gastownhall/beads](https://github.com/gastownhall/beads) — 2026-09-07 — [一手实测·读文件] — §2 候选 16、§4、§6.1
26. [langchain-ai/langgraph releases](https://github.com/langchain-ai/langgraph/releases) — 2026-09-07 — [一手实测·读文件] — §2 候选 9 版本
27. 二手对比文（Diagrid「Checkpoints are not durable execution」、Spheron、Reactify 等）— 2026-09-07 — [二手] — **仅用于确认候选清单是否遗漏，未作任何论据**

---

自评：我最没把握的三个判断是 ①把 DBOS 在"不重复不可逆副作用"上判为"部分（最强）"而非"满足"——这取决于"中断中的 step 会重跑"是否算违反，也取决于我未核实的多执行器租约语义；②把"进程级契约（`--json-schema`/`--output-schema`）"当作通用层来推荐——它实际只有两家半支持，opencode/dsh/Copilot 上是否只能退回"上游校验"我并未查实；③Beads 的存储真相源到底是 Dolt 还是 SQLite+JSONL，两个仓库地址与两种说法冲突，我只打开了其中一个，因此对它的"原子认领可当租约雏形"这一推荐信心最低。
