# 附录·载体实例：DeepSeek Harness (DSH) 载体映射

governed_by：D-014、D-020、D-041（提议）
**本文效力为零**，不属于规范正文。它是"DSH 插件运行时"这一种载体上的一个实现映射，不是落地要求（D-020 §7：规范不维护工具映射表；本表是**载体实例**，不是正文的一部分，正文不得引用本表任何一行作为依据）。

## 0. 口径与来源

- **来源等级：V1 一手。** 全部内容读自本机实际安装 `~/.dsh/profiles/node_modules/@deepseek-ai/`（231 个包）与 `~/.dsh/profiles/web/`，不是转述。
- **测量时点：2026-09-04。DSH 版本 `@deepseek-ai/dsh@0.1.2-rc.1`。**
- **本表必然过期。** DSH 处于 rc 阶段，WX-29 记载其 README 自称 developer preview 且"必有破坏性变更"。过期处置见[载体过期登记](载体过期登记.md)。
- **读文档，未运行。** 下表全部条目来自各包 README 的 `## Use this package` 契约段与 config 表，**没有一条经过实机运行验证**。按 [30 §2 P1](../30-验证与测试.md)，"文档这么写"与"运行时确实如此"是两回事：本表的每一行都是**结论 + 成立条件（该包 0.1.2-rc.1 的 README 契约段属实）**，运行验证是空缺，不得折算为已验证。

## 1. 14 部件 → DSH 机制

| 部件 | DSH 的承载机制（包名 / API / 配置位置） | 形态 |
|---|---|---|
| [10 意图与验收](../10-意图与验收.md) | `dsh-goal`：每会话一个持久完成目标，活在会话日志里；`dsh-tool-goal` 给模型 `get_goal`/`create_goal`/`update_goal`；`/goal` 命令 | 日志投影型状态 |
| [11 项目知识](../11-项目知识.md) | `dsh-agent-instructions`：加载 `$DSH_HOME/AGENTS.md` + 项目根到工作目录链上每一份 `AGENTS.md`/`CLAUDE.md`（`.local.md` 为附加覆盖层），**广→具体顺序**；`dsh-file-reference` | 文件约定 + 持久基线消息 |
| [12 记忆与知识治理](../12-记忆与知识治理.md) | **核心无记忆包**（见 §3 空缺一）。可用：`dsh-session-query` + `dsh-session-query-sqlite`（FTS5 跨会话全文检索）、`dsh-storage`；本机已装社区插件 `dsh-memory-evolve`（`~/.dsh/memories/advisor/`） | 外部状态存储 + 检索 |
| [20 状态工件](../20-状态工件.md) | `dsh-session`（事件溯源会话日志，权威）、`dsh-session-persistence-jsonl`、`dsh-tool-todo`（整表替换）、`dsh-plan-mode`、`dsh-session-checkpoint-policy`（崩溃不丢模型请求与工具副作用） | 只追加日志 + 投影 |
| [21 调度与拆分](../21-调度与拆分.md) | `dsh-subagent`（`-spawn-in-process` 新子 / `-fork-in-process` 继承父已完成轮次两种后端）、`dsh-tool-subagent-control`（`send_message`/`interrupt_agent`/`list_agents`）、`dsh-workflow`(`-worker-thread`)、`dsh-jobs`、`dsh-schedule`、`dsh-goal-round-driver` | 进程内隔离 + 编排脚本 |
| [22 上下文装配](../22-上下文装配.md) | `dsh-agent-instructions` 的 **`maxBytes` 硬预算**（`dsh-base` 默认 65536）：超预算**先整份丢弃更宽泛的文件、最后才截断最具体的**，并发出具名被删/被截路径的可见通知；`dsh-compaction`(`-basic`/`-tool-result-pruner`)、`dsh-spill`(`-policy`/`-local`)、`dsh-output-retention`、`dsh-token-meter`、`dsh-system-prompt` | 预算裁剪型（**并把裁剪事实告知模型**） |
| [23 方法库](../23-方法库.md) | `dsh-skill`（provider 注册表）、`dsh-skill-filesystem`（项目/自定义/用户三档 skill 根，带监视）、`dsh-tool-skill`（模型可见的目录与加载工具） | 条件加载 + 工具 |
| [24 工具与执行环境](../24-工具与执行环境.md) | `dsh-tools`（`ctx.tools` 注册表 + `defineTool`）、`dsh-sandbox`(`-local`/`-windows-acl`)、`dsh-bash-sandbox`/`dsh-pwsh-sandbox`、`dsh-mcp-client`、`dsh-code-runtime`(`-worker-thread`) | 运行时注册 + 沙箱 |
| [25 执行者与模型](../25-执行者与模型.md) | `dsh-llm`(`-deepseek`/`-pi-ai`/`-retry`)、`dsh-agent-presets`、`dsh-agent-default-model`、`dsh-persona`（每 agent 自己的 system-prompt 人格） | 预设组合 |
| [30 验证与测试](../30-验证与测试.md) | **`dsh-invariants`**：`ctx.invariants`，任何包可随包发一个 `./invariant` 伴生件校验自己的持久关系；失败报 `InvariantError` 并**归属到违约的那个包**；全局开关 + 包名正则 allowlist/blocklist。`dsh-sdk-minimal` 已挂四个核心伴生件（session/agent/scope/agent-loop），**`dsh-base` 刻意不挂** | 进程内自检（见 §4） |
| [31 守卫与权限边界](../31-守卫与权限边界.md) | **见 §2**。`ctx.tools.guard()` 单调守卫、`tools/pre-execute` 瀑布、`ctx.approval.request()`、`dsh-sandbox-policy`（`mode` 默认 `read-only`）、`dsh-permission-presets`、`dsh-authorization`、`dsh-hook-protocol`（CC/Codex 桥接的共同规则） | 进程内类型化事件 |
| [32 证据与追踪](../32-证据与追踪.md) | `dsh-session` 日志本身即 trace；`dsh-session-telemetry`(`-otel`，带脱敏链)、`dsh-session-projection`(`-cache`)、`dsh-session-stats`、`dsh-token-meter`、`dsh-session-log-export`（ZIP 导出） | 只追加日志为权威，导出为有损投影 |
| [33 评估与演进](../33-评估与演进.md) | **无原生落点**（见 §3 空缺二） | — |
| [40 人的检查点与授权](../40-人的检查点与授权.md) | `dsh-user-approval`（见 §2）、`dsh-tool-ask-user`、`dsh-user-questions`、`dsh-message-feedback`、`dsh-client-ui-approval` | 可插拔应答链 |

## 2. 阻断点：本规范在 DSH 上唯一真能拦住东西的位置

这是 [D-057](../决策日志.md#effective-register) 试行期最关键的那件事——它裁决理由的原话是"117 条拦住 0 条，原因不是写得差而是`提议`没有执行点"。DSH 给的执行点如下，**管线顺序是固定的**：

```
tools/pre-execute      可扩展的 allow / deny / ask 瀑布（可重排）
      ↓
ctx.tools.guard()      单调守卫：同步；返回一个 reason 即拒绝，
                       且此后没有任何监听器能把这次拒绝翻回许可
      ↓
tools/execute          环绕派发（超时 / 重试 / 度量）
      ↓
tools/post-execute     检查或替换结果、带反馈阻断、附加有序上下文
      ↓
finalizeContent        定义方自有
      ↓
tools/result           只观察，结果已冻结
```

审批侧（`dsh-user-approval`）：

- `ctx.approval.request(req)` 的结果是闭集 `allowed-once | rejected | cancelled | unavailable`；
- **fail-closed 是硬的**：应答者缺失、非属主、或抛异常，一律落到 `unavailable` 即拒绝；
- 授权**只对被请求的那一个动作生效**（`allowed-once`，不存在"以后都允许"）；
- 每次请求都记进发起会话的审计日志；
- 会话级 policy `ask`（默认）/ `never`，`never` 在任何应答者运行**之前**确定性拒绝。

**这四条与 [D-014](../08-规范效力元治理.md) 的 blocks/grants 分离是同构的**：单调守卫只能 deny 或弃权、永远不能授权，正是"blocks 无 grants"的运行时形态。这是本规范在纸面上论证不出、只能在 DSH 上拿到的东西。

## 3. 三处空缺（按 30 §2 P1 记为空缺，不折算）

**空缺一 · 12 记忆与知识治理：DSH 核心不提供长期记忆。** 231 个包里没有任何一个记忆包。可组合的是"会话日志 + FTS5 全文检索 + skill/指令文件 + storage"，形态是**外部状态存储 + 检索**，不是"记忆文件"。本机现用的是社区插件 `dsh-memory-evolve`（在 `~/.dsh/profiles/web/cordis.patch.yml` 里，配 `reviewEnabled: true`、`reviewInterval: 10`）。**后果**：12 章的晋升三维（D-033）在 DSH 上没有原生落点，只能落到社区插件或自写插件——这一层的证据强度会低于其他十三个部件，落地时必须单独标注。

**空缺二 · 33 评估与演进：DSH 无原生落点。** 231 个包里 `eval` / `benchmark` / `judge` / `score` / `regress` 一个都没有。**后果**：33 章的评估集三分区（诊断/筛选/最终验证）、评估器校准、饱和过期条件，在 DSH 上全部落在项目侧自建，与载体无关。这也意味着 **D-035 在这次落地里拿不到任何载体侧证据**。

**空缺三 · 全表未经运行验证。** 见 §0 末段。本表可信度到"README 契约段属实"为止。

## 4. D-020 §5 硬性检验：DSH 提供的是第二种机制类型

[09 §5](../09-跨工具通用性.md) 要求一条语义能在**至少两种机制类型不同**的载体上落地。DSH 与 Claude Code 在同一语义上的机制类型对照：

| 语义 | Claude Code 形态 | DSH 形态 | 是否两种类型 |
|---|---|---|---|
| 动作前拦截 | 外部进程钩子（`PreToolUse` 调外部命令，读结构化返回） | 进程内类型化事件 + 同步单调守卫 | **是** |
| 检查器自检 | 外部脚本，须由某处显式调用 | `ctx.invariants` 包自有伴生件，随组合自动运行 | **是** |
| 常驻指令 | 提示词前缀型（CLAUDE.md 拼入） | 持久基线消息 + 字节预算裁剪并告知模型 | **是** |
| 状态 | 独立状态工件（TodoWrite / 计划文件） | 日志投影型，无第二份存储 | **是** |

**一个必须说清的坑**：DSH 的 `dsh-hooks-claude-code` 能直接跑 Claude Code 的 `hooks.json`。**走这条桥接落地不算第二种机制类型**——那是同一份 hooks.json 换了个宿主执行。要满足 D-020 §5，必须写**原生 Cordis 插件**（`ctx.tools.guard()` / `ctx.invariants`）。桥接只能用作迁移期的过渡，不能用作通用性的证据。

## 5. 一处冲突：一手证实，待裁

WX-29 §5.2 曾以 S1 二手材料登记过一条冲突。**本次读一手包文档证实了它**，证据等级升为 V1：

`dsh-tools` README 原文：`ctx.tools.restrict(filter)` "applies an allow or deny mask to the global tools one agent inherits; **masks intersect, scoped registrations stay visible**"。

即：**DSH 的工具限制是可见性过滤，不是安全边界**——一个子 agent 只要自己注册同名工具，就绕过上层的名字限制。这与 [D-027](../决策日志.md#decision-index)（会话不可变范围在创建时固化且模型不可修改）、[D-028](../决策日志.md#decision-index) 直接冲突。

**DSH 一侧的答案是清楚的**：真正的权限边界在 `dsh-sandbox-policy` 的 `mode` 与 `dsh-user-approval` 的 `policy` 两条旋钮上，`restrict` 属上下文可见性层。**本规范一侧没有这个区分**——D-027 没有把"工具可见性限制"与"权限限制"分成两类语义。**这是落地 DSH 必须先裁的一条，待 Alan 裁决。**

## 6. 本表不回答的问题

- `ctx.tools.guard()` 能否从**项目本地**文件注册（决定落地是项目级还是 profile 级）——未查证；
- 守卫是全局还是 per-agent 作用域——未查证；
- `dsh-invariants` 的伴生件能否由项目侧（而非 npm 包）提供——未查证。

以上三条是写第一个插件前必须查的，**现在记为未定，不猜**。
