# G · DSH 一手核对（G1～G14）

## 0. 验证边界与本轮的方法变更

检索日期 **2026-09-07**。

**本轮把证据基线整个抬高了一级。** 上一轮只能靠 `raw.githubusercontent.com` 单文件取用；本轮我直接把官方仓库做了一次**无 blob 浅克隆**并检出完整工作树：

```
git clone --filter=blob:none --depth=1 https://github.com/deepseek-ai/deepseek-harness.git
HEAD = d347e703908d0406b7a7ef80e3a0e594d86b2215
      Fri Sep 4 17:16:23 2026 +0800
      "Merge pull request #3554 from deepseek-harness/release/dsh-0.1.3-alpha.1"
工作树 9080 个文件；packages/ 下 255 个包；306 个 README.md；docs/ 下约 190 篇（中英成对）
```

所以下文除特别注明外，**每一条都是我在本机检出的官方仓库文件里逐字读到的**，证据等级一律记 **[官方仓库文件]**，并给出仓库内相对路径。以下三点必须先说清楚：

1. **文档站归属问题已解决，不再是"未证实"。** 官方仓库根 `README.md` 第 8 行逐字写着：`Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)`；且仓库内有 `website/` 目录与 `.github/workflows/docs-pages.yml`（"Publish the documentation website to GitHub Pages"）。GitHub 组织 `deepseek-harness` 也是本项目自己的开发组织——所有 release/feature 分支都是 `deepseek-harness/release/dsh-0.1.3-alpha.1`、`deepseek-harness/fix/...` 这种形态（见 git log）。**结论：文档站是一手，归属已证实。** 但本报告仍然全部引自仓库文件，因为仓库文件更新更快、更完整。
2. **我没有运行过 dsh。** 下文全部是"仓库文件（README / docs / 源码 / CI 配置）这么写"，不是"运行时确实如此"。凡我读的是 `src/*.ts` 源码（比 README 更接近运行时），我会标"源码"。
3. **版本口径**：仓库 master 是 `0.1.3-alpha.1`；npm 上 `@deepseek-ai/dsh` 的 `latest` 是 `0.1.2-rc.1`。V1 那份《DSH 载体映射》读的 `0.1.2-rc.1` 与本轮的 master 之间隔了约一天、一个 alpha 版。

---

## G1 · headless / 非交互入口

**结论**：有，且是官方一等公民——`dsh --profile headless "<task>"`，一次一任务、打印最终答案、按 turn 结束原因映射退出码；**但输出是纯文本，没有 `--json`，也没有强制输出 schema**。要结构化结果必须走 SDK（stdio JSON-RPC，TypeScript 与 Python 两套客户端）或 `dsh-subagent` / `dsh-workflow` 的 `outputSchema`。

**证据**：

- `packages/bundle/headless/README.md`：「`dsh-headless` runs one dsh task from the command line and prints the final answer, then exits — no GUI, no server, no browser.」「It is ideal for scripts, CI, and one-off jobs: the process opens no ports and leaves nothing running behind. The exit code tells you the outcome — 0 when the task completed, 1 when it aborted or errored. The main boundary: one task per invocation, with no interactive follow-up.」
- 同文件输出契约：「The agent works through the task, streams each non-empty provider reasoning delta to stderr under a `dsh: reasoning:` heading, then prints the final answer on stdout and exits.」「A completed final `turn/end` exits 0; any other outcome — aborted, error, or no turn in the owned interval — exits 1.」
- 同文件配置表只有一个字段：`| task | required | The task text for the single run |`。**全文没有 json / schema / format 相关字段。**
- 同文件已知限制：「**Only reasoning and the final answer are printed** — a run without an assistant message prints an empty stdout line and exits 1; intermediate tool output is not printed.」「**Runs through the `dsh` launcher** — starting the headless profile another way fails at startup, because only the launcher can request the process exit.」
- 进程内 / 跨进程替代：`packages/sdk/protocol/README.md`：「one transport class plus the named request, result, and notification types both wire ends speak」，方法集只有三个 client→server 请求（`initialize` / `session/prompt` / `shutdown`）与四个 server→client 通知（`session.event` / `session.status` / `subagent.started` / `subagent.finished`）。
- `packages/sdk/client/README.md`：「It returns `RunResult { sessionId, finalResponse, events, notifications }`, where `finalResponse` is the last committed root-session assistant text in that interval — **not a response causally assigned to the prompt**, because steering, injected context, and other queued work may contribute before idle.」
- `packages/sdk/server/README.md`：「Stdout carries only JSON-RPC frames, so clients can parse every byte; diagnostics belong on stderr. Keep stdout loggers out of the composed tree.」

**证据等级**：[官方仓库文件]（README + package.json + `src/startup.ts`）。

**对 L3 的后果**：外部程序驱动 dsh 有两条路，**都不给"强制 schema 的最终结果"**。headless 只能拿到 stdout 自由文本 + 0/1 退出码——这不满足本理论"子执行者只回结构化三态裁定、上游不解析自由文本"。SDK 路能拿到完整事件流，但 `finalResponse` 明确声明**不因果归属于该 prompt**，所以"这一次运行的裁定"必须由我们自己在 dsh 里用一个工具写到外部状态工件里，再由外部程序回读——**不能靠解析 dsh 的输出**。真正能强制 schema 的只有 `dsh-subagent` 的 `outputSchema`（见 G9），那是进程内的、给子代理用的，不是给最外层一次运行用的。

---

## G2 · `ctx.tools.guard()` 的注册位置与作用域

**结论**：**作用域由"用哪个 ctx 注册"决定：普通 context 注册即全局，用 `agent.ctx` 注册即只对该 agent 生效。** 守卫是同步、单调、只能拒不能放行。注册必须发生在一个被加载的 Cordis 插件里，但**这个插件完全可以是项目目录里的一个本地 `.ts` 文件**——通过启动时 `--patch <项目里的 cordis.yml>` 引入，条件是插件路径写绝对路径。dsh 本身**不会自动发现项目目录里的插件**。

**证据**：

- 源码 `packages/core/tools/src/index.ts:1092-1101`（JSDoc 逐字）：
  「Register a monotonic guard after the extensible `tools/pre-execute` waterfall. **A plain-context guard applies globally; one registered through `agent.ctx` applies only to that agent.** Any matching guard may deny by returning a reason, while no guard can force-allow a call another guard …」
- 同文件 `:697-704`：「A monotonic execution guard evaluated after every `tools/pre-execute` listener and before the tool body. Returning a reason denies the call; returning `undefined` leaves it unchanged. **Because guards have no allow result, listener ordering cannot turn a denial back into permission.**」，类型是 `export type ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined`。
- 守卫能看到什么（源码 `:307-331` `ToolExecutionInput`）：`callId` / `rootCallId` / `name` / **`arguments`（"Losslessly JSON-serializable parsed arguments"，且已 deep-frozen）** / `agent` / `parent` / `signal`。
- 全局层与 scope 层的求值顺序（源码 `:1109-1116`）：「First monotonic denial from the global then the scope chain's guard layers, farthest first.」
- 项目本地插件的落地形态，`docs/user/develop/basic/index.md`：「Run `pwd` from the repository root, then create `scratch-plugin/cordis.yml` as a Web overlay that inserts the local plugin.」→ `pnpm dsh web --patch ./scratch-plugin/cordis.yml`；并明确：「**The plugin path must be absolute.** A patch file contributes configuration but does not change the profile directory from which the loader resolves module paths.」
- 配置层次（`packages/boot/app-boot/README.md`）：「A profile lives at `$DSH_HOME/profiles/<name>` and combines installable bundles, its own `cordis.patch.yml`, and `patchReload: live | startup`」；「**`cordis.patch.yml`** — your tweak layer, applied after every bundle layer (per-profile first, then the home-level file, which therefore outranks it)」。

**证据等级**：[官方仓库文件]（含源码 JSDoc，强于 README）。

**对 L3 的后果**：这直接回答了 BRIEF-L3 的问题①和②。**落地是 profile 级为主、项目级需显式引入**：`$DSH_HOME/profiles/<name>/cordis.patch.yml` 是稳定归宿；要做成"项目自带守卫"，得让每次启动都带 `--patch /abs/path/to/项目/dsh/cordis.yml`——这本身就是一个可能被忘记的失效面（判据 C：探测手段是启动时打一条 config dump 或让守卫自己在 session 里留一条事件）。**作用域可以做到 per-agent**，所以"验证者子代理比生成者更严"这种拆分是可实现的。守卫按 `name` + 已解析的 `arguments` 判定，满足本理论 31 的"按动作对象与参数判定不按名称字符串"。

---

## G3 · `dsh-invariants` 伴生件

**结论**：伴生件就是一个普通插件，**完全可以由项目侧提供，不必发 npm 包**——注册名只是一个字符串。违规时 `fail(message)` **抛 `InvariantError`**（不是仅记录）。但要注意一个大坑：**出厂的 `dsh` CLI 两个产品面（TUI 与 Web）根本没挂 invariants 服务**，只有 `dsh-sdk-minimal` 挂。

**证据**：

- `packages/runtime-diagnostics/invariants/README.md`：「A companion is a normal plugin you mount beside the registry. It declares any services it needs and registers under its package's exact npm name; the registry joins its setup before the registration completes.」
- 注册名的实际约束（`docs/subsystems/invariants.md`）：「`ctx.invariants.register(packageName, installer)` reserves one active registration for the full npm package name … **a duplicate, blank, or whitespace-containing name throws**.」——**只校验非空、无空格、不重复；没有校验它是不是真实存在的 npm 包**。
- 失败语义（`docs/subsystems/invariants.md`）：「`fail(message)` throws `InvariantError` — `extends Error` with stable `code: 'INVARIANT'`, the owning `packageName`, and a message prefixed `invariant violated by "<package>": …`」；README：「A violation throws an `InvariantError` from the context that reported it」。
- 出厂配置里没有（`.agents/notes/implemented/simplification/2026-08-03-omit-invariants-from-shipped-config.md`）：「The shipped `dsh` configuration trees under `apps/cli/config/` mount neither `@deepseek-ai/dsh-invariants` nor any package-owned `./invariant` companion.」「**Ordinary `dsh` TUI and Web runs install no invariant listeners or trace state and cannot fail through `InvariantError`.**」
- 允许断言什么（`AGENTS.md` 第 106 行）：「**Runtime invariants assert owned relationships.** Publish `./invariant` only when independent observations can diverge. Otherwise omit its source and wiring and record why in its README; **empty installers and checks of service presence, plugin metadata, effects, or fixed examples are invalid**.」
- 过滤器是启动期固化的：「**Filters are fixed for the service lifetime** — `enabled`, `package_allowlist`, and `package_blocklist` are compiled once at startup; changing them requires a Cordis plugin reload.」

**证据等级**：[官方仓库文件]。

**对 L3 的后果**：这回答了问题③——**可以项目侧提供**，成本只是一个本地插件 + 一行 `ctx.invariants.register('local/我们的不变量', installer)`。但两点必须写进选型：① 要用它，就得**显式把 `@deepseek-ai/dsh-invariants` 挂进 profile patch**，出厂配置没有；② 它的定位是**开发期诊断**而不是生产守卫——抛异常的位置是"报告它的那个 context"，对一个无人值守长跑会话来说，一次 InvariantError 会把那一步打断，但**它不是权限边界**。真正的边界仍是 guard + sandbox + approval 三件套。所以我建议：invariants 用于"控制平面自检探测"（判据 C 要求的"它坏了怎么被发现"），不用于拦截。

---

## G4 · `dsh-sandbox` / `dsh-sandbox-policy`：网络、进程可见性、Linux 后端、容器内运行

**结论**：**沙箱只管文件效果，明确不管网络**，进程可见性"看后端"。三个 mode。`full`/`partial` 是"被报告的事实"而不是承诺。Linux 后端是 `bwrap` 优先、失败后回落到官方自带的 Landlock native addon。**容器内跑 dsh 是官方预期场景，但 bwrap 在容器里常常不可用**，会自动降级。

**证据**：

- `docs/subsystems/sandbox.md` 顶部逐字：「`SandboxMode` governs filesystem effects only.」以及类型注释：「`read-only` permits only required sinks such as `/dev/null`; `workspace-write` also permits the workspace and a backend-defined temp area; `danger-full-access` bypasses confinement. **Network and process visibility are outside this vocabulary.**」
- 更直白的一句（`packages/shell/bash-sandbox/README.md`）：「The modes govern file effects only — **network stays unrestricted and process visibility is backend-specific.**」
- `full` vs `partial`（`docs/subsystems/sandbox.md`）：「Enforcement is a reported fact. `full` means the backend governs every file effect promised by the mode; `partial` means an active backend or older kernel ABI governs only a subset, so **consumers that require the absolute promise must reject or surface that distinction.** Older Landlock ABIs and the Windows ACL runner's Everyone/hard-link boundaries are current partial cases.」
- Linux 后端与链（`packages/sandbox/sandbox-local/README.md`）：「Selection is by platform first, probes second: each platform has a runner chain (`linux`: `bwrap` then Landlock; `darwin`: Seatbelt; `win32`: the ACL restricted-token runner).」；「**When no runner is usable the provider fails closed with `SANDBOX_UNAVAILABLE` — a command never silently runs unconfined.**」
- bwrap profile 细节：「The bwrap profile combines a read-only host root, a fresh `/dev`, and `/proc` from a private PID namespace — commands manage their descendants but cannot see host processes, so procfs magic links cannot bypass the mounts; `workspace-write` adds an ephemeral `/tmp` and a writable workspace bind.」
- Landlock 是官方打包的原生 addon：「The Landlock launcher ships as an npm-distributed native addon (`@deepseek-ai/node-addon-landlock-run`) that supplies the platform launcher, functional probe, and grant vocabulary」。仓库里也确有 `native/landlock-run/`。
- 容器/用户命名空间（`.agents/notes/implemented/feature/2026-07-06-sandbox.md`）：「And the first-choice runner, `bwrap`, **is unusable on exactly the hosts a sandbox matters most (minimal containers, disabled unprivileged userns, LSMs that deny `mount`)**, so a fallback runner has to ship with the SDK rather than be assumed on the host.」同文件：「The chain probe is functional — it builds and enforces a real profile rather than checking `--version` — so a present-but-unusable `bwrap` fails its probe, selection falls to the packaged Landlock launcher, and **the verdict is cached for the provider's lifetime**.」
- Ubuntu 24.04 具体点名（`.github/workflows/sandbox.yml` 注释）：「The bwrap rung needs bubblewrap on PATH and unprivileged user namespaces. **Ubuntu 24.04 gates the latter behind an AppArmor knob**; lift it best-effort — on images where the knob is absent the functional probe (and the run-guard below) is the arbiter anyway.」CI 里对应的步骤名是 `Prepare bubblewrap (unrestrict userns)`，脚本 `scripts/prepare-ci-bubblewrap.sh`。
- Landlock partial 的真实事故：`docs/postmortem/0004-landlock-partial-notice-misclassified-child-failures.md`——「On kernels with an older Landlock ABI, the launcher prints a benign partial-enforcement notice before executing every child.」曾把 ripgrep 的"无匹配 exit 1"误判成 `SANDBOX_UNAVAILABLE`。同文还有一句必须记：「Stderr remains an in-band attribution channel. **A confined child can deliberately reproduce a runner's gated fatal line and exit status**, causing an availability/diagnostic false attribution … an out-of-band status protocol remains separate hardening.」
- 官方安全立场（`SAFETY.md`）：「Sandboxing, approval prompts, and permission controls can reduce risk, but **they do not guarantee isolation or prevent damage.**」「**Do not rely on DeepSeek Harness as the sole security control for untrusted workloads.**」「Prefer a disposable virtual machine, container, or dedicated environment.」

**证据等级**：[官方仓库文件]。

**对 L3 的后果**：这回答了问题⑤——**是的，沙箱确实不管网络，官方逐字承认**。所以 L3 的"边界外不由我们控制"这条不变量，在 dsh 层面**根本没有载体**：出口白名单必须由 dsh 之外的一层（容器 + 网络策略）提供，这正好落到 H2。第二个后果：Ubuntu 24.04 上要么先解 AppArmor 的 userns 限制让 bwrap 可用（`full`），要么接受 Landlock 可能报 `partial`；而 `partial` 按官方口径**不能当 `full` 用**——L3 的守卫得读这个字段并在 `partial` 时降级或转"未定"。第三：官方自己说别把 dsh 当唯一安全控制——这条应当原样写进 L3 选型的风险节。

---

## G5 · permission preset：会话中能否放宽、能否锁死

**结论**：**没有一个叫"lock"的开关；但有一个更干净的做法——把 preset 表本身配窄。** preset 表是进程级、插件生命周期内固定的；表里没有宽 preset，客户端就没有可切换的目标。真正的硬闸是 `approval/policy: never`（见 G6），因为模型唯一的提权路径（bash 的 `sandbox_permissions` 逐次升级）必须过 `ctx.approval`。事件名与载荷是公开的：`permission/preset`、`sandbox/mode`、`approval/policy`、`approval/asked`、`approval/decided`。

**证据**：

- 表与默认（`docs/subsystems/permission-presets.md`）：「the default table ships `workspace-write` (`workspace-write` + `ask`) and `danger-full-access` (`danger-full-access` + `never`)」。
- 表是进程级固定的（`packages/interaction/permission-presets/README.md` 已知限制）：「**The preset table is process-level** — configuration is fixed for the plugin lifetime; changing available presets requires reloading the plugin.」
- `set()` 的写路径：「`set(session, name)` resolves the preset (**unknown names throw**), appends a log-only `permission/preset` event unless `name` is already the effective preset, then writes each knob through its own setter — `setSandboxMode` from `dsh-sandbox-policy` and `setApprovalPolicy` from `dsh-user-approval` — only when that knob's effective value changes.」
- 本服务不做强制：「it owns no enforcement: execution, prompt narration, and replay keep reading their knob folds, and a preset switch only records intent and writes through each knob's canonical setter.」
- 沙箱侧的默认是安全默认（`packages/sandbox/sandbox-policy/README.md`）：「the fail-safe default is `read-only`, and a deployment that wants a workspace-writable agent opts into `workspace-write` explicitly.」优先级：「an approved explicit mode outranks the session's last `sandbox/mode` event, which outranks the deployment default.」
- 模型侧唯一的提权入口（`packages/shell/tool-bash/README.md`）：「The model may then retry the exact same command once in the same turn with `sandbox_permissions` (the narrowest wider mode that suffices) and a one-sentence `justification`; **the approval prompt raised by that retry is how the user consents**. Escalation is never speculative: a request with no real prior denial, or one that is not strictly wider than the current mode, fails closed without running anything, and **a rejected escalation is final for that command**.」
- 对账用事件：`docs/persistence-catalog.md`（生成文件，1075 行，"Every event type that can appear in a session's durable event log"）收录全部 `SessionEventMap` 成员；`permission/preset` 被标为「durable, log-only user intent」，`approval/asked` / `approval/decided` 为 log-only 审计对。

**证据等级**：[官方仓库文件]。**未查到**：任何名为 lock / freeze / monotonic 的 preset 配置项，也没查到"只允许收窄"的内建约束——`setSandboxMode` 本身可以放宽。

**对 L3 的后果**：这回答了问题⑥。**锁死的配方是三条一起用**：① profile patch 里把 `dsh-permission-presets.presets` 只配一个窄条目（甚至干脆不挂这个包）；② `dsh-sandbox-policy.mode` 留在 `read-only` 或 `workspace-write`，不给 `danger-full-access`；③ `approval/policy` 设 `never`，让任何逐次提权确定性地被拒。另外必须补一个自己的 `ctx.tools.guard()`，因为 preset 服务"owns no enforcement"，理论上还有别的代码路径能调 `setSandboxMode`。**探测手段（判据 C）**：外部程序读会话日志，只要出现 `sandbox/mode` 变宽或 `approval/policy` 变成 `ask` 就报警——这是可机械检测的。

---

## G6 · headless 下的审批语义

**结论**：`'never'` 的语义是**确定性 `rejected`，且在瀑布分发之前就被服务本身强制**，后注册的 answerer 也绕不过去。answerer 缺席 / 不认领 / 抛错 / 返回不合规 → **`unavailable`，同样 fail-closed**。两种情况都会写进会话审计日志。

**证据**（全部出自 `docs/subsystems/approval.md`）：

- 闭集：「`ApprovalOutcome` is closed and fail-closed. `allowed-once` grants only the asked-about action; callers deny on `rejected`, `cancelled`, and `unavailable`. **A missing, non-owning, throwing, or non-conforming answerer becomes `unavailable` rather than opening the gate.**」
- 两种策略：「`'ask'` (the default) — delegate to the composed answerers; with none composed the chain falls through to the fail-closed `'unavailable'`.」「`'never'` — never prompt anyone: **every ask resolves `'rejected'` deterministically.** The strict headless stance (CI, unattended runs) and the policy whose outcome is knowable without asking.」
- 不可绕过：「**The `never` policy is enforced inside the service before waterfall dispatch, so even an answerer registered later with `prepend` cannot bypass it.**」
- 审计：「`ctx.approval.request(req)` requires the requesting session to be inside an open turn. It appends `approval/asked`, obtains one outcome, appends the matching `approval/decided`, and resolves with that outcome.」「The audit events are log-only and do not enter the model transcript.」
- 有效值来源：「The effective value is the last `approval/policy` event in the session log, falling back to the service config. Consumers read it with `ctx.approval.effectivePolicy(session)`; `setApprovalPolicy(session, policy)` is the single write path, so replay reconstructs the override.」

**证据等级**：[官方仓库文件]。

**对 L3 的后果**：这是 dsh 在无人值守下最干净的一块。`never` 给出的是**可预测、可重放、可外部对账**的拒绝，正好对上本理论 31 的"未知默认关闭（未登记动作、应答缺席、超时不放行）"。**但要注意它的代价**：`never` 之下所有需要人裁的动作都会被直接拒，不会挂起等人——也就是说，dsh 的 approval **不能充当 L3 的"五处检查点"**（检查点要的是"停下来等人"，approval 给的是"立刻拒绝"）。检查点必须放到 dsh 之外（PR review / 队列），dsh 侧只负责"拒得干净、拒得留痕"。

---

## G7 · 会话日志：格式、schema、可外读性、检查点

**结论**：格式是**每会话一个目录 + append-only JSONL，默认 zstd 带校验和分帧，可配 `compression: 'none'` 得到纯文本行**。schema **完全公开且是生成物**（`docs/persistence-catalog.md`，1075 行，覆盖整个 `SessionEventMap`）。外部程序完全可以读并投影。`dsh-session-log-export` 是**给浏览器下 ZIP 的**，不是给程序用的导出。检查点策略有确切原句。

**证据**：

- 落盘（`packages/session/session-persistence-jsonl/README.md`）：「stores each session in a current append-only JSONL log and retains immutable historical format generations — **checksummed Zstandard frames by default, raw newline-delimited lines when compression is disabled**」；配置只有两个字段：`root`（required，无默认，理由："a `process.cwd()` default would scatter session files as the process's cwd changes"）与 `compression`（默认 `'zstd'`）。目录布局：`<root>/--<normalized-cwd>--/`（"readable project directory (or `_no-cwd/`)"），当前物理格式 v2，"one physical row per durable event"。
- schema 公开（`docs/persistence-catalog.md` 头部）：「Every event type that can appear in a session's durable event log: the complete persisted `SessionEvent` envelope and each member of the merge-extensible `SessionEventMap` … with source JSDoc, full payload declaration, surface badge, and declaration site.」信封字段：「each event's `type`, monotonic `seq`, epoch-ms `time`, `data`, the optional `ignorable` unknown-type skip marker, and the conditional `surfaceOp`/`sourceEventSeqs` fields.」并且「Every payload is JSON-serializable (enforced at `Session.append`)」。
- 检查点原句（`packages/session/session-checkpoint-policy/README.md`）：「makes a persisted session durable at the moments that matter: **before a model request reaches the adapter, before a top-level tool body can produce an external side effect, and at each step boundary** so the preceding response and tool results are stored before the next request.」「a crash after any checkpoint resumes with the recorded work — a request, a tool call, or a completed step — instead of losing it.」「**checkpoint failures are fail-closed**, so neither the adapter nor a top-level tool body runs when the durable write cannot be confirmed.」「a persisted call without a result records an unknown outcome rather than retrying automatically.」
- 不挂它的后果：「Loading a backend without it is valid but weaker: events still inside the backend's batching window or an outstanding write can be lost.」
- 导出（`packages/session-query/session-log-export/README.md`）：「a `Session log` button in the Session Header and an `/export` slash command both hand the session tree — the session, its sub-sessions, and attachments — to the browser as a ZIP download.」「**Avoid it when a programmatic or Host-side export is needed: this package produces a browser download, not a Host path write.**」
- 另有 `dsh-session-query-sqlite`：「searches session history with a SQLite FTS5 index … Live sessions are indexed from memory and persisted sessions from **a dedicated derived-index database**, so results always reflect the newest state without touching the session-persistence store.」「Search is opt-in and off by default in shipped compositions」。

**证据等级**：[官方仓库文件]。

**对 L3 的后果**：**这是 dsh 给本理论最强的一块——32（证据与追踪）几乎是白送的**。会话日志本身就是"只追加保存原始记录"，`seq` 单调、`time` 是 epoch-ms、payload 强制 JSON、schema 是生成文档。选型上应当：① 生产用 `compression: 'none'` 换取"外部程序 / grep / 脚本能直接读"（少就是多，不用装 collector）；② 必须挂 `dsh-session-checkpoint-policy`（零配置，一行），否则 20 的"从任一持久检查点可恢复"没有载体；③ **不要**用 `session-log-export`，它是浏览器下载；外部投影直接读 JSONL 目录。注意 `session-query-sqlite` 是派生索引，按本理论 11 属于"派生缓存"，要绑源版本——它的源版本就是 `seq`。

---

## G8 · workflow / jobs / schedule / goal-round-driver

**结论**：四个都是**进程内、无持久化编排**。最要紧的一条：**`dsh-workflow` 明确写着没有 journaling、没有 resume，进程重启不能续跑。**

**证据**：

- `packages/workflow/workflow/README.md`：「runs a plain-JavaScript orchestration script and gives the caller a live run whose result resolves with the script's final JSON value.」「A run is holder-owned: **its result never rejects**, cancellation and disposal are bounded, and every child is attributed to the invoking agent.」「The package ships no execution engine — `dsh-workflow-worker-thread` is the current one」。
- 已知限制（逐字）：「**Foreground collection only** — the caller owns one live run and awaits it; background start/poll, spill handles, and detached collection are deferred.」「**No journaling or resume** — scripts, child progress, and intermediate values are not checkpointed, so a process restart cannot continue a run.」「**No saved or nested workflows** — the capability starts caller-supplied scripts only, and a workflow script receives no `workflow()` hook for recursive orchestration.」
- 工具层阻塞父轮：「A tool call submits `meta`, `script`, and optional `args` and returns `{ runId, agentsStarted, result }` when the run completes. **The tool blocks the parent turn until the whole workflow settles**, so the model sees one final outcome, never intermediate child messages.」
- `packages/jobs/jobs/README.md`：「lets tools run long work as background jobs: the work gets a stable `<kind>-N` id, keeps running while the agent moves on」「A job belongs to the agent session that started it: another agent cannot read or stop it. **Ids such as `bash-1` are predictable, so this fence is authorization, not secrecy.**」实现在 `dsh-jobs-local`（进程内注册表）。
- `packages/schedule/schedule/README.md`：「gives your session durable reminders … **Reminders survive restarts**: an already-live idle agent can deliver due work immediately, while a closed or cold session keeps it overdue until a future live root agent resumes the session. **Delivery stays inside the session, with no email, SMS, or push notification.**」
- `packages/goal/goal-round-driver/README.md`：「whenever the agent is idle with an active, armed goal and remaining round capacity, the driver starts the next goal round. Each round is one model turn toward the objective, driven by a retained goal-round prompt; **only goal-sourced rounds count against the goal's round cap, and the goal records a blocker when the cap is exhausted.**」

**证据等级**：[官方仓库文件]。**未查到**：workflow / jobs 任何"幂等键"或"重试语义"的配置项。

**对 L3 的后果**：**这是 L3 选型最关键的一条负面结论。** dsh 的编排层（workflow）不能承担本理论 20 的"从任一持久检查点可恢复且不重复已发生的不可逆副作用"。会话层有检查点（G7），**编排层没有**。所以：把 dsh 当"一次可独立验收切片的执行者"（一次 headless / 一次 SDK run），**跨切片的持久编排必须放到 dsh 之外**——这正好是 H1（DBOS Transact）要回答的位置。`dsh-schedule` 是会话内提醒，不能当调度器用。`goal-round-driver` 的"round cap 用尽即记 blocker"倒是可以直接映射本理论 21 的"上限型停机条件"。

---

## G9 · `dsh-subagent`：spawn vs fork、toolFilter、返回什么、能否换模型

**结论**：spawn = 空白会话的新子代理；fork = 用父会话**已完成的轮次**做一次性快照种子。`toolFilter` **就是 `ctx.tools.restrict()` 那条路**（同一路径，作用于子代理创建窗口），被过滤的工具**既从提示里消失、也拒绝执行**——但官方明确说这是"可见性不是授权"。子代理能返回**结构化值**（`outputSchema` → `SubagentResult.structured`）。**能为子代理指定不同的 provider / model / reasoningEffort / maxTokens。**

**证据**：

- fork（`packages/subagent/subagent-fork-in-process/README.md`）：「seeds each child with the parent's completed conversation turns: **the child sees every finished turn and none of the in-flight one** … Choose it when a subtask continues this conversation; choose spawn when the child must stand alone. **The seed is a one-time snapshot taken at fork time: later parent turns never reach the child.**」
- spawn（`packages/subagent/subagent-spawn-in-process/README.md`）：「runs each delegated task in a fresh child agent that shares this process and its agent factory, LLM, and tool services. **The child starts with an empty conversation, so a task prompt must stand alone**; it inherits the parent's working directory, session lineage, provider, model, reasoning effort, and output-token limit unless `request.agentOptions` overrides them.」
- toolFilter 与 restrict 的关系（`docs/subsystems/subagent.md`，`SubagentStartRequest.toolFilter` 的 JSDoc 逐字）：「Optional child tool scoping. Requires `SubagentCapabilities.toolFilter`; rejected at start otherwise. **In-process backends apply it as a scoped `tools.restrict()` in the child's creation window: the named tools vanish from the child's prompt AND refuse to execute (one visibility), with loud unknown-name validation.**」
- 但不是授权边界（`.agents/notes/implemented/feature/2026-07-12-subagent-persona-tool-filter-and-depth.md`，小节标题就叫 **"Visibility is not authority"**）：「These controls compose trusted same-process behavior; **they do not authorize it.** `toolFilter` changes the child view resolved by the tool registry, but it does not create a parent-to-child grant lattice, require a child to be a subset of its parent, sandbox plugins, or prevent code with another Cordis context from calling services directly.」「In particular, **a child-local tool is added after the global filter and may be absent from the parent's view. A deny-only child also sees later global tools not named by the deny-list.**」「A security design would need a separate authority representation, propagation rule, and execution-time enforcement point.」
- 结构化返回（`docs/subsystems/subagent.md`，`SubagentResult`）：「`structured?: unknown` — The structured result after a requested `outputSchema` was successfully satisfied. **Requesting a schema does not guarantee presence**: a provider can end with `stopReason: 'error'` when the child fails or finishes without a valid capture. The structured value is validated against the requested output schema by the provider」。`outputSchema` 类型是「Object-rooted JSON Schema within `assertObjectJsonSchema`'s enforced subset」，且「In-process backends … implement the supported object-rooted schema with a **forced capture tool**」。
- 换模型：`SubagentStartRequest.agentOptions`「Optional host-Agent provider, model, reasoning-effort, and output-token overrides. Requires `SubagentCapabilities.agentOptions`」；且「ACP, Codex, and Claude Code reject `agentOptions` before starting their transports.」
- 后端阵容（`packages/subagent/subagent/README.md`）：「a single composition can offer in-process children, out-of-process ACP or SDK children, and **real Codex or Claude Code children side by side**.」仓库里确有 `subagent-claude-code` / `subagent-codex` / `subagent-acp` / `subagent-dsh-sdk`。

**证据等级**：[官方仓库文件]（含 `.agents/` 决策笔记，是官方仓库内的一手决策记录）。

**对 L3 的后果**：**这里要修正 V1 那条"冲突"的表述。** V1 说 `ctx.tools.restrict()` 是"可见性过滤不是安全边界"——**方向对，但太粗**。准确说法是：`restrict` / `toolFilter` **确实会拒绝执行**被过滤的工具（不只是从提示里藏起来），但它**不构成非提权保证**：子代理本地新注册的工具、以及 deny-list 之后新增的全局工具都会逃出去。所以在 L3 里：**用 `toolFilter` 做"该子代理该看见什么"（22 上下文装配、25 执行者合同），用 `ctx.tools.guard()` 做"绝对不许发生什么"（31 守卫）**——两者是不同的部件，不能互相顶替。这正好满足本理论 31 的"至少两个位置检查有效能力"。另一个直接可用的结论：`outputSchema` + `structured` 是 dsh 里**唯一**能强制结构化返回的机制，21 的"子执行者只回结构化三态裁定"应当落在这里，而不是落在 headless 的 stdout 上。

---

## G10 · `dsh-session-telemetry-otel` 与 `ctx.tokenMeter`

**结论**：**只导 OTel logs，不导 traces、不导 metrics。** 属性极简（`session.id` / `event.type` / `event.seq` 等），body 是会话事件 data 的深拷贝。**默认无脱敏规则**——出厂就是原样上传。**不含 token 数、不含成本**。`ctx.tokenMeter` 是每会话一份的重放折叠，只给 token 估算，**没有金额、没有价表**。另有一个必须知道的事实：**出厂 `dsh-base` 默认把遥测指向 DeepSeek 的生产端点。**

**证据**：

- 只有 logs（`packages/session/session-telemetry-otel/README.md`）：「delivers session records through **OpenTelemetry logs** and is the only entry a deployment loads for the session-telemetry seam.」「Uploading modes compose the OTel JS SDK as-is — **`LoggerProvider` → `BatchLogRecordProcessor` → OTLP/HTTP log exporter** — and map each record onto `logger.emit()`」。
- 三种 mode：`FULL` / `FEEDBACK_ONLY` / `DISABLED`（"Default"）。
- 无脱敏：「Records carry the complete event data as the seam's redaction waterfall returns it, so **a deployment exporting beyond a trusted boundary mounts its own redaction rules.**」并列举了什么会出去：「message content, tool arguments and results, the system prompt and tool schemas, todo text, compaction summaries, feedback text, and the session `cwd`. **Provider credentials never appear**: adapter API keys are constructor parameters, not session events」。
- 属性名（`docs/subsystems/session-telemetry.md`，`SessionTelemetryRecord.attributes` 的 JSDoc）：「ledger records carry `session.id`, `session.format_version`, `event.type`, `event.seq`, plus optional `session.cwd` / `session.parent_id`; a seeded Session also carries `session.seed_length` … ops records carry `telemetry.op`, `session.id`, and (for `agent-error`) **`agent.id`, `turn`, `step`, `error.name`**.」两条 scope：`@deepseek-ai/dsh-session-telemetry-otel`（ledger）与 `…/ops`（ops）。
- 交付是尽力而为：「Delivery is best-effort: the cursor marks handed-off, not delivered, and records can be lost (crash, reload window) or duplicated (new-object replay, SDK retries), so **receivers dedupe ledger records on `(session.id, session.format_version, event.seq)`**」。
- 出厂端点（`packages/bundle/base/cordis.patch.yml` 第 168–203 行，逐字）：
  「Session telemetry defaults to feedback-gated sharing: FEEDBACK_ONLY uploads only when the user records /feedback … **uploading mirrors session-log records onto OTLP/HTTP logs with no session-telemetry/record redaction rule, so exports are the raw captured copy.**」
  配置行：`mode: !!js process.env.DSH_TELEMETRY_MODE || 'FEEDBACK_ONLY'`，`url: !!js process.env.DSH_TELEMETRY_OTLP_URL ?? 'https://harness-telemetry.deepseeksvc.com/v1/logs'`。
  退出方式：「A non-empty `DSH_TELEMETRY_DISABLED` — any value, including '0'/'false' — opts the process out (the launchers patch the row disabled; **config cannot disable a row**).」并且「Exports carry the harness home's anonymous user id (`$DSH_HOME/.anonymous-user-id`, random UUID; delete the file to reset the identity) as the Resource's `user.id`.」
- tokenMeter（`docs/subsystems/token-meter.md`）：`TokenMeasurement` 字段为 `logRevision` / `baseline` / `surfaceDeltaTokens` / `totalTokens` / `surfaceTokens` / `nodes`；粒度是**每个 surface 节点（一条消息，带 `seq`）一个 token 价**。「`baseline.kind === 'usage'` means the latest successful provider call has the same canonical request envelope … `estimated` means no reusable conservative usage anchor exists, so the service priced the complete envelope and surface itself.」README：「It uses a fixed heuristic for text and routes without image pricing, applies adapter-declared visual-token pricing when available … and **reuses provider-reported usage only when the request envelope matches exactly.**」

**证据等级**：[官方仓库文件]。**未查到**：任何金额/成本字段、任何价表版本概念、任何 OpenTelemetry **GenAI 语义约定**（`gen_ai.*` 属性）的采用。

**对 L3 的后果**：三条。① **上生产前必须先处理默认遥测**——内网生产机 nfsy 上跑 dsh，出厂配置会往 `harness-telemetry.deepseeksvc.com` 发；要么 `DSH_TELEMETRY_DISABLED=1`，要么把 `DSH_TELEMETRY_OTLP_URL` 指到自建 collector。这条也直接进 H2 的出口白名单清单。② 遥测**只是会话日志的镜像**，信息量不超过 G7 的 JSONL；按"少就是多"，**L3 完全可以不装 OTel，直接读 JSONL 目录**——只有当需要多机汇聚时才值得上 collector。③ 本理论 32 要求"按计费类别加权记账并声明价表版本"，**dsh 一个字都不提供**；成本记账必须自己在网关（sub2api）侧做，按 `session.id` 关联。

---

## G11 · `dsh-agent-instructions`（确认与补齐）

**结论**：V1 的一手结论成立，本轮补齐了默认值与超预算通告的确切形态。**`maxBytes` 是必填、没有默认值**；`dsh-base` 给的是 **65536**。加载顺序是"用户全局 → 项目链由宽到窄"，裁剪方向是"先整份丢掉更宽的文件，最后才截断最具体的那份"，并会**发一条模型可见的通告**。

**证据**（全部出自 `packages/context/agent-instructions/README.md`）：

- 「`dsh-base` already includes it with a **65,536-byte budget**, so base-backed profiles only need to replace the row when they want another `maxBytes`」；配置表 `| maxBytes | required | Cap on the complete rendered baseline message, in bytes |`。
- 顺序：「The first request includes one durable baseline message with the user-global `$DSH_HOME/AGENTS.md` followed by the project chain — **every existing candidate file from the project root down to the session working directory, in broad-to-specific order.**」
- 候选文件：`| instructionFileCandidates | ['AGENTS.md', 'CLAUDE.md'] |`，另有 `AGENTS.local.md` / `CLAUDE.local.md` 作为「additive local overlays」，`.git` 标记项目根。
- 去重：「Sibling files whose content matches after trimming render once, so a `CLAUDE.md` that duplicates its `AGENTS.md` is not repeated.」
- 超预算通告（关键）：「Rendering keeps the most specific files first: **it drops whole broader files before truncating the most-specific file, and emits a visible `Workspace instruction budget ...` notice naming the omitted and truncated paths.** The rendered bytes never exceed `maxBytes`.」并且「**Instruction content is bounded, not summarized** — over-budget broad files are omitted and the most-specific file may be truncated; the plugin never asks a model to compress instruction prose.」
- 刷新语义：「There is no file watcher — external edits become visible on the next successful filesystem touch or when a resumed session reconciles its baseline.」；渲染时的注入形态是 `Instructions from: ~/.dsh/AGENTS.md` / `Additional instructions from: packages/app/AGENTS.md` / `Instructions removed: packages/app/AGENTS.md`。
- 防注入：「literal `</system-reminder>` text anywhere in instruction content or model-visible metadata is escaped so repository-controlled text cannot close the plugin-owned frame.」

**证据等级**：[官方仓库文件]。

**对 L3 的后果**：22 的"唯一一份默认加载清单 + 分层加载 + 启动固定开销计入预算"在 dsh 上有现成载体，而且**这是五个宿主里唯一会把"我丢了什么"明确告诉模型的**——`Workspace instruction budget ...` 这条通告可以直接当成 22 的"可机械检测的损失信号"。选型建议：`maxBytes` 显式配小（比如 32768），逼自己把 AGENTS.md 写成"入口只做地图"（本理论 11 的要求），而不是靠 65536 的宽预算把细节都塞进去。

---

## G12 · 版本、发布节奏与兼容性政策；两个 hooks 桥

**结论**：仓库 master `0.1.3-alpha.1`（2026-09-04），npm `latest` 是 `0.1.2-rc.1`（2026-09-03）。**发布节奏是天级**。README 用全大写写明会破坏兼容。**没有 CHANGELOG，也没有迁移指南**（只有会话日志格式一条内部版本机制）。两个 hooks 桥都只跑 command 型 hook。

**证据**：

- 仓库 `package.json`：`"name": "@deepseek-ai/dsh-root", "version": "0.1.3-alpha.1"`，`"engines": { "node": "^22.19.0 || >=24.0.0" }`，`"packageManager": "pnpm@11.7.0"`，`"license": "MIT"`。
- 根 `README.md`：「DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**」
- npm registry（`https://registry.npmjs.org/@deepseek-ai/dsh`，2026-09-07 取）：`0.0.1-rc.1` 2026-08-10 → … → `0.1.2-alpha.5` 2026-09-02 → `0.1.2-rc.1` 2026-09-03；dist-tags `{latest: 0.1.2-rc.1, alpha: 0.1.2-alpha.5, next: 0.1.2-rc.1}`。**首个公开版本距今不到一个月。**
- 无 CHANGELOG：`find . -maxdepth 2 -iname "CHANGELOG*"` 无结果。仓库内唯一的版本迁移机制是会话日志格式：`packages/session/session-format-v0-to-v1`、`session-format-v1-to-v2`、`session-format-catalog`，且 `AGENTS.md`：「only structural format changes bump `SESSION_FORMAT_VERSION`」。
- `packages/hooks/hooks-claude-code/README.md`：「runs the hooks from your existing Claude Code config — a `hooks.json` or a settings file's `hooks` key — during agent runs … Your hooks fire at the matching moments: **when a session starts, when a prompt is submitted, before and after a tool runs, when the run is about to stop, and when subagents start or end.** A hook can block a prompt or tool call with a message the model sees, attach extra context to the conversation, or force the run to continue.」
- `packages/hooks/hooks-codex/README.md`：「**Five of Codex's hook points** fire at the matching moments: when a session starts, when a prompt is submitted, before and after a tool runs, and when the run is about to stop.」（比 CC 桥少了 subagent 两个点）
- `packages/hooks/hook-protocol/README.md`：「**Only command hooks run; `http`, `mcp_tool`, `prompt`, and `agent` handlers are skipped with a warning.**」

**证据等级**：[官方仓库文件] + npm registry（官方发布渠道）。

**对 L3 的后果**：**这是整份报告里最该让 Alan 停一停的一条。** 一个公开不到一个月、天级发版、自己写明"必然破坏兼容"、没有 CHANGELOG 的运行时，被选作 L3 无人值守的宿主，判据 C 的"新失效面 + 独立探测"必须写死：**版本必须 pin 死**（Alan 已用 `minimumReleaseAgeStrict: true`，方向对），并且要有一条"升级前跑一遍已知答案回归集"的必经路径。另一条正面消息：hooks 桥让 Claude Code 的 `hooks.json` 能原样在 dsh 上跑——这对 D-020 跨宿主通用性有价值，**但按 09 §5，桥接不算第二种机制类型**（BRIEF-L3 已经这么裁定，本轮证据支持这个裁定：两个桥共用同一个 `hook-protocol`，是同一种机制的两个入口）。

---

## G13 · `dsh-mcp-client` 支持的 MCP 版本

**结论**：**未查到**任何 MCP 规范日期标注（既没有 `2026-07-28`，也没有 `2025-11-25` 或 `2025-06-18`）。能确定的只有依赖的 SDK 版本。**并且：只桥接 tools，不支持 resources 和 prompts。**

**证据**：

- `packages/mcp/mcp-client/package.json`：`"@modelcontextprotocol/sdk": "^1.12.0"`；`pnpm-lock.yaml` 解析到的实际版本是 **`@modelcontextprotocol/sdk@1.29.0`**（`zod@4.4.3`）。
- `packages/mcp/mcp-client/README.md`：「attaches external Model Context Protocol (MCP) servers to the harness so their tools work like any native tool … under stable names such as `mcp__github__create_issue`.」「**Only tools are bridged: MCP resources and prompts are not supported.**」「nothing ships enabled, so you opt in.」
- 我在全仓库对 `protocolVersion|LATEST_PROTOCOL|2025-06-18|2025-11-25` 做了 grep：**命中的全部是 ACP（Agent Client Protocol）的 `PROTOCOL_VERSION`，与 MCP 无关**（`packages/acp/acp/src/index.ts`、`packages/subagent/subagent-acp/src/run.ts`）。MCP 的协商版本由 SDK 内部决定，dsh 自己不声明。

**证据等级**：[官方仓库文件]（版本号确凿）；**规范日期：未查到**。

**对 L3 的后果**：不能替 dsh 断言它支持哪一版 MCP 规范——只能说"它用的是 MCP TS SDK 1.29.0，协商由 SDK 负责"。要精确知道，得去 MCP SDK 自己的发布说明查（不在本轮范围，且不是 dsh 官方文件）。对选型的实际影响有限，但**"只桥 tools 不桥 resources/prompts"是硬限制**：任何指望用 MCP resources 承载"项目知识只引用不复制"的方案，在 dsh 上不成立。

---

## G14 · 官方的 headless / 自动化 / CI 用例

**结论**：**没有官方 GitHub Action，没有官方 Docker 镜像。** 但有三样实打实的官方自动化材料：① headless profile 自身定位为 CI 用（G1）；② `apps/cli/config/examples/github-review/` 是一个完整的**"GitHub webhook → 自动开一个只读评审会话"**示例，附文档；③ 仓库自己的 19 个 GitHub Actions workflow 里有大量"在 CI 里跑 dsh 组合"的真实配置。

**证据**：

- 未查到镜像：`find . -iname "Dockerfile*"` 在整个仓库**无任何结果**；`.github/workflows/` 下 19 个文件里没有发布 action 或镜像的 workflow（有 `release-publish.yml`、`python-release.yml`、`build-exe-for-python-sdk.yml`，都是发 npm/PyPI/可执行文件）。
- webhook 评审示例（`docs/user/guide/github-review.md`）：「This opt-in overlay adds a signed GitHub endpoint to `dsh web`. **When a pull request in the configured repository changes from draft to ready for review, the rule creates a titled root Session under the repository's Web Workspace and starts a read-only review prompt.**」启动方式：`dsh web --patch /absolute/path/to/github-review/cordis.yml`；「The overlay mounts a second WebServer in an isolated realm; only `POST /github` is registered there, and every other path returns `404`.」
- 该规则的权限姿态（同文，逐字）：「It passes the exact head SHA plus selected PR fields to the review prompt, **labeling the JSON as untrusted metadata and forbidding file, branch, PR, or GitHub mutation.** The Session request selects the `standard` agent preset and **`read-only` permission preset.**」
- CI 里跑 dsh 的实例：`.github/workflows/ci-master.yml`、`e2e.yml`、`sandbox.yml` 都有 `Prepare bubblewrap (unrestrict userns)` → `bash scripts/prepare-ci-bubblewrap.sh`；`e2e.yml` 还有一条对 L3 直接有用的做法（逐字注释）：「Guard against a false green: the e2e suites self-skip when the key is absent, so a missing/misconfigured secret would otherwise pass as 'all skipped'. … the secret MUST be present — **fail loudly if not.**」
- 另有 `.github/workflows/e2b-e2e.yml` 与 `packages/e2b/`（`fs-e2b` / `subprocess-e2b`）——官方支持把文件系统与子进程能力整体换成 E2B 远程沙箱。

**证据等级**：[官方仓库文件]。

**对 L3 的后果**：三条可直接抄的形态。① **github-review 示例就是 L3"人的检查点"的现成载体**：webhook 触发 → 只读 preset → 不许改任何东西 → 产出评论。它同时示范了"外部输入标记为 untrusted metadata"，正好对上本理论"跨边界读只引用不复制"。② `e2e.yml` 那条"self-skip 会伪装成全绿，所以必须 fail loudly"的注释，**就是判据 C 要的探测思路的官方版本**——L3 的每个检查器都要有"它没跑"和"它跑了没发现问题"的区分。③ 没有官方镜像意味着容器化要自己做，而 G4 已说明容器内 bwrap 常不可用——两件事叠加，容器方案要自己验证并读 `enforcement` 字段。

---

## 附：本轮对 V1《DSH 载体映射》的三处修订

1. **`ctx.tools.restrict()` 那条"冲突"要改写**。它不只是"可见性过滤"——被过滤的工具**会拒绝执行**（`toolFilter` 的 JSDoc："vanish from the child's prompt AND refuse to execute"）。准确的表述是官方自己的小节标题：**"Visibility is not authority"**——它不提供非提权保证（子代理本地工具、后加的全局工具会逃逸）。安全边界是 `guard()` + sandbox + approval，不是 restrict。
2. **"文档站归属未证实"可以撤销**。官方仓库 README 自己链过去，仓库里有 `website/` 和 `docs-pages.yml`。
3. **补两个 V1 未提的重要事实**：出厂 `dsh-base` 默认开启 FEEDBACK_ONLY 遥测并指向 DeepSeek 生产端点、且无脱敏规则（G10）；出厂 CLI **不挂** invariants（G3）。

---

自评：我最没把握的三个判断是 ① G13 的 MCP 规范版本——我只能证明依赖 `@modelcontextprotocol/sdk@1.29.0`，dsh 自己不声明规范日期，"支持哪一版"这件事我给不出一手结论，标的是"未查到"而不是任何推断；② G5 的"锁死配方"——我能证明 preset 表进程级固定、`approval: never` 不可绕过，但**我没能证明不存在其他调用 `setSandboxMode` 放宽的代码路径**（我只读了 README 与部分源码，没有做全仓库调用图分析），所以"三条一起用就锁死了"是我的推论而非官方原句；③ 所有"运行时确实如此"的部分——我一次 dsh 都没跑过，G4 的 Landlock `partial`、G7 的 zstd/none 落盘、G8 的 workflow 不可恢复，全都是文件这么写，Ubuntu 24.04 + Node 24 上的真实行为需要一次实测才能定案，尤其是 G4 在容器内的降级路径。
