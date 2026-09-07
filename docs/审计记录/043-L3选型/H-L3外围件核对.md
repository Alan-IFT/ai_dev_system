# H · L3 外围件核对（DBOS / 出口白名单 / 遥测落库 / Inspect AI / 人裁通知 / 行业无人值守做法 / 容器内沙箱）

调研员 H。检索日期 2026-09-07。口径继承 BRIEF.md §0/§1/§2/§5 与 BRIEF-L3.md。
证据等级：[官方文档]=厂商官方文档站或官方仓库文件；[官方仓库文件]=raw.githubusercontent 上的仓库原文件；[registry]=npm/PyPI 元数据；[二手]=博客/媒体；未查到=未查到。
凡「README/文档这么写」一律不写成「运行时确实如此」。本轮**没有任何一条是我亲手跑过的**，因此全表无 [一手实测]。

---

## H1 · DBOS Transact TypeScript

### 结论
DBOS Transact TS 是一个 **MIT 许可的 npm 库**（不是服务），最新稳定版 `4.27.6`（2026-08-25），`engines.node: ">=20"`，把持久化工作流状态写进 Postgres；**单节点、无 Conductor 时的崩溃恢复就是"进程重启时自动恢复所有 PENDING 工作流"**，官方明文写了这条；可以嵌进一个长驻 Node 进程（`DBOS.launch()`）。但 **Node 24 与 PostgreSQL 18 的"支持声明"未查到**——只有 `>=20` 这个下界。

### 证据
- 版本与许可证与 Node 下界（npm registry `@dbos-inc/dbos-sdk` 元数据，2026-09-07 取）：`latest = 4.27.6`，`time[4.27.6] = 2026-08-25T15:39:32.081Z`，`license = MIT`，`engines = {"node": ">=20"}`，运行期依赖只有 `pg / ws / yaml / commander / superjson / serialize-error`。发布节奏很密：8 月 12 日至 9 月 4 日之间有 12 个版本（多数是 `-preview`），当前 preview tag 为 `4.28.7-preview`（2026-09-04）。
- 恢复语义逐字原句（https://docs.dbos.dev/typescript/tutorials/workflow-tutorial ）：
  - 「Steps are tried *at least once* but are never re-executed after they complete.」
  - 「Transactions commit *exactly once*. Once a workflow commits a transaction, it will never retry that transaction.」
  - 「If a DBOS process is interrupted while executing a workflow and restarts, it resumes the workflow from the last completed step.」
  - 异常语义（**很关键，容易漏**）：出现未捕获异常时 DBOS「records the exception, sets the workflow status to `ERROR`, and **does not recover the workflow**」。
- 幂等原句（同页）：「An assigned workflow ID acts as an idempotency key: if a workflow is called multiple times with the same ID, it executes only once.」以及「Workflow IDs must be **globally unique** for your application.」
- 单节点无 Conductor 的恢复（https://docs.dbos.dev/production/workflow-recovery ）：「each time you restart your application's process, DBOS recovers all workflows that were executing before the restart (all `PENDING` workflows)」；多进程共用一个库时需给每个执行器分配 ID，「Each workflow is tagged with the ID of the executor that started it」，重启时只恢复自己那一份。自托管页（https://docs.dbos.dev/typescript/tutorials/development/self-hosting ）：执行器 ID 由环境变量 `DBOS__VMID` 指定。
- 队列与并发（https://docs.dbos.dev/typescript/reference/queues ）：全局并发「The maximum number of workflows from this queue that may run concurrently across all DBOS processes.」；单进程并发「… within a single DBOS process.」；另有 partition 级两档；限流「A limit on the maximum number of functions which may be started in a given period」（`limitPerPeriod` + `periodSec`）。
- 作为库嵌入（https://raw.githubusercontent.com/dbos-inc/dbos-transact-ts/main/README.md ）：「DBOS provides lightweight durable workflows built on top of Postgres」，是「a library」，「add durable workflows and queues to your program in just a few lines of code」，无额外系统要运维。启动方式（https://docs.dbos.dev/typescript/programming-guide ）：`await DBOS.launch();`，在既有 Node 进程内启动。
- **未查到**：官方任何页面写明「支持 Node 22 / Node 24」或「支持 PostgreSQL 18」。配置参考页（https://docs.dbos.dev/typescript/reference/configuration ）只说需要一个 Postgres 连接串，「If the Postgres database referenced by this connection string does not exist, DBOS will attempt to create it.」没有版本矩阵。

### 证据等级
[registry]（版本/许可证/engines）+ [官方文档]（全部语义原句）+ [官方仓库文件]（README）。Node 22/24 与 PG18 的支持声明：**未查到**（只能推断 `>=20` 覆盖 22/24，但那是我的推断，不是厂商声明）。

### 对 L3 选型的直接后果
DBOS 可以当"**L3 的持久执行底座**"：它把"从任一持久检查点可恢复且不重复已发生的不可逆副作用"（部件 20）变成一行装饰器语义，且**不引入新服务**（只多用一个已有的 PG 库）。但有三个必须写进选型正文的限制：① **抛异常的工作流不会被恢复**——它进 `ERROR` 态就停在那，这正好可以映射到「三态裁定的 UNDETERMINED / 阻塞升级」，但不能指望它自动重试；② 单进程重启才触发恢复，**进程活着但卡死不会被发现**，活性信号（租约/心跳）得自己另做；③ PG18 兼容是**未定**，上线前必须自测。

---

## H2 · 出口白名单的最少组件（Ubuntu 24.04）

### 结论
**最少组件形态 = Docker 容器 + 容器内 `iptables`（默认 OUTPUT DROP）+ `ipset` + 启动时 `dig` 解析域名装入 ipset + 脚本自带的两个连通性探针**。Anthropic 参考 devcontainer 里的 `init-firewall.sh` 就是这个形态且**自带探测**，所以按判据 C 可以装。Docker Sandboxes（microVM）在网络策略上更强（deny-by-default 出口代理 + 域名 allowlist + 凭据不进 VM），但它是**新增的一整个产品**，且治理功能要付费订阅，按"以少就是多"排第二。

### 证据
- Anthropic 参考防火墙脚本（https://raw.githubusercontent.com/anthropics/claude-code/main/.devcontainer/init-firewall.sh ）：用 `iptables` + `ipset create allowed-domains hash:net` + `dig +noall +answer A` 解析域名；默认策略是 DROP——`iptables -P INPUT DROP`、`iptables -P FORWARD DROP`、`iptables -P OUTPUT DROP`；允许 GitHub IP 段与 `registry.npmjs.org`、`api.anthropic.com`、`sentry.io`、`statsig.anthropic.com`/`statsig.com`、`marketplace.visualstudio.com`、`vscode.blob.core.windows.net`、`update.code.visualstudio.com`，以及 DNS(53)、SSH(22) 与宿主网络。**脚本结尾自带两个探针**：`curl --connect-timeout 5 https://example.com` 必须失败，`curl --connect-timeout 5 https://api.github.com/zen` 必须成功。
- 官方对这套的定位（https://code.claude.com/docs/en/devcontainer ）：「The reference container includes an `init-firewall.sh` script that limits outbound traffic to the destinations the script allows. Running a firewall inside a container requires extra permissions, so the reference adds the `NET_ADMIN` and `NET_RAW` capabilities through `runArgs`. The firewall script and these capabilities are not required for Claude Code itself: you can leave them out and rely on your own network controls instead.」并且「It is provided as a working example rather than a maintained base image」。
- **关于"convention rather than an enforcement boundary"这句原话的归属，简报的转述需要更正**：这句在 https://code.claude.com/docs/en/sandbox-environments 的组织执行一节，说的是**dev container 本身作为组织级强制手段**，不是说防火墙脚本：「**Dev containers**: commit the example dev container to your repositories to standardize the environment across a team. This is a convention rather than an enforcement boundary, because Claude Code does not require a container. If developers should not be able to run Claude Code outside it, enforce that with your organization's device management or software allowlisting tools.」
- Docker Sandboxes（https://docs.docker.com/ai/sandboxes/ 与 https://docs.docker.com/ai/sandboxes/security/ ）：「Docker Sandboxes run AI coding agents in isolated microVM sandboxes. Each sandbox gets its own Docker daemon, filesystem, and network」；隔离层里网络那条：「outbound TCP traffic is proxied through the host and governed by a deny-by-default policy. Direct external UDP and ICMP are blocked.」凭据：「API keys are injected into HTTP headers by the host-side proxy. Credential values never enter the VM.」默认 allowlist 的告诫：「The default allowed domains include broad wildcards. Some defaults like `*.googleapis.com` cover many services beyond AI APIs. Run `sbx policy ls` to see the full list of active rules, and remove entries you don't need.」治理功能：免费的 `sbx` CLI 不含治理，那些「require a separate paid subscription」。Claude Code 侧旁证（sandbox-environments 页）：「Docker Sandboxes provides a microVM with its own Docker daemon and workspace sync, which can run Claude Code on any host with Docker Sandboxes installed. It is a free, standalone product from Docker that does not require Docker Desktop.」**Linux 支持未在我读到的页面上明确写出**——写「未查到」。
- 另一个不能忽视的口径（https://code.claude.com/docs/en/sandboxing 安全限制一节）：内置代理默认不终止 TLS，「Because the proxy makes its allow decision from the client-supplied hostname without inspecting TLS, code running inside the sandbox can potentially use domain fronting or similar techniques to reach hosts outside the allowlist.」——**基于 SNI/hostname 的域名白名单不是抗对抗的边界**。iptables+ipset 走的是 IP 层，反而没有这个问题，但有另一个问题（DNS 轮换导致 IP 漂移）。

### 证据等级
[官方仓库文件]（init-firewall.sh）+ [官方文档]（Claude Code devcontainer / sandbox-environments / sandboxing、Docker Sandboxes）。Docker Sandboxes 在 Linux 上是否可用：**未查到**。

### 对 L3 选型的直接后果与「它坏了怎么被发现」
**推荐件：容器内 iptables+ipset 出口白名单（组件数 = 0 个新服务，只是容器启动脚本）。**
- 它坏了怎么被发现：**把 init-firewall.sh 那两个探针提成独立的、每轮开工前跑一次的门禁**——「访问一个未授权域必须失败」+「访问模型网关必须成功」。两条都必须是**非零退出码即阻塞**，且探测器不是防火墙自己（判据 C 满足）。
- 第二探针（针对 ipset 的真实失效面）：**IP 漂移**。ipset 是启动时按 `dig` 结果冻结的一组 IP，包源/git 远端换 IP 后会静默变成"允许集里没有它"→ 表现为 npm/git 超时而不是明确拒绝。探测方式：每轮开工前对每个白名单域重解析一次，与 ipset 现有成员求差集，差集非空即告警重建。
- **明确不推荐**：只靠 Docker 的 `--network` 或 compose 网络做隔离（那是连通性不是白名单）；只靠 `HTTPS_PROXY` 环境变量（进程可以不理它，不是强制边界）。
- 升级条件：当出现"必须防对抗性外泄（域名前置/DNS 隧道）"时，才升级到终止 TLS 的自建代理或 Docker Sandboxes 的 microVM + host-side proxy。

---

## H3 · 遥测落库

### 结论
**OpenTelemetry Collector contrib 里没有官方的 PostgreSQL 导出器**（trace/metrics/logs 任一都没有）。有一个 2026-02-27 提的捐赠 issue 仍是 open、未合并；更早那个 2024 年的请求已 closed as not planned。所以"OTel → PG"这条路**没有现成一等组件**。按"以少就是多"排序：**① 什么都不装（会话日志 JSONL + 定时脚本导入 PG）> ② Collector + fileexporter 落盘 + 同一个脚本导入 PG > ③ 自己维护第三方 postgresexporter 编译进 collector > ④ ClickHouse/SigNoz（新组件、新数据库、新运维）。**

### 证据
- 捐赠 issue（https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/46501 ）：标题「Component donation: exporter/postgres #46501」，2026-02-27，状态 **open**；提案方称组件可「exporting otel logs, traces and metrics to PostgreSQL or other databases built on top of PostgreSQL (e.g. Timescale)」，且「are ready to suggest sponsorship and maintain the Postgres exporter component as part of the OpenTelemetry Collector Contrib project」。截至检索日**未被接收、未合并**。
- 更早的请求（https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/35451 ）：「[exporter/postgres]: Exporter to save OTEL data in postgresql #35451」，2024-09-27 提，**已 closed as not planned**，标签为 "Sponsor Needed" / "Stale"。
- 注册表侧核对（https://opentelemetry.io/ecosystem/registry/?s=postgres&component=exporter ）：Collector 导出器里**没有 PostgreSQL**；ClickHouse、Elasticsearch、Azure Data Explorer、Cassandra 等在列。（注：contrib 仓库的 `exporter/` 目录树页被 robots.txt 拒绝抓取，我改用注册表 + 两个 issue 交叉确认，**没有逐个目录名核对过**。）
- 唯一的第三方实现（https://github.com/destrex271/postgresexporter ）：自我描述为「Unofficial Postgres Exporter for OpenTelemetry」。[二手/第三方仓库]
- 落盘替代（https://raw.githubusercontent.com/open-telemetry/opentelemetry-collector-contrib/main/exporter/fileexporter/README.md ）：「Writes telemetry data to files on disk.」traces/metrics/logs 稳定度均为 **Alpha**；JSON 格式下「Each line in the file is a JSON object.」；支持轮转（`max_megabytes` 默认 100MB、`max_backups` 默认 100）。
- ClickHouse 路线（https://raw.githubusercontent.com/open-telemetry/opentelemetry-collector-contrib/main/exporter/clickhouseexporter/README.md ）：「This exporter supports sending OpenTelemetry data to ClickHouse.」稳定度：traces/logs **Beta**、metrics **Alpha**、profiles Development；在 contrib 发行版里。
- SigNoz：官方自托管索引页（https://signoz.io/docs/install/self-host/ ）只列安装方式，**组件清单、最低资源、许可证我未在官方页读到**——写「未查到」。其"ClickHouse-native"的描述只见于二手文章，不作论据。

### 证据等级
[官方文档/官方仓库文件]（两个 issue、注册表、fileexporter/clickhouseexporter README）。SigNoz 细节：**未查到**。

### 对 L3 选型的直接后果与排序（"以少就是多"）
1. **首选：不装 Collector。** dsh 的会话事件日志本来就是持久化的结构化流（G 组正在核实其确切格式），OTel 的价值在"跨进程关联"，而 Alan 是**单机单人**，跨进程关联需求还没出现。最小形态：一个定时脚本把会话日志投影成 PG 里的两三张表（run / step / cost）。判据 B 明确说"只是把仓库里已有的信息重新组织了一遍 → 可选"，这条正踩在上面。
   - 它坏了怎么被发现：**缺口计数**（部件 32 要求"导出是派生投影、带缺口计数"）。每次导入后比对"会话目录里的会话数"与"PG 里 run 表的行数"，差值非零即告警。这个探测器独立于导入脚本本身（一边数文件、一边数表行）。
2. **次选：Collector + fileexporter，仍由同一个脚本入 PG。** 只在"需要同时汇聚 dsh 之外的信号（比如 Claude Code 的 OTel 指标导出）"时才升级到这一步。代价是多一个常驻进程。
   - 它坏了怎么被发现：fileexporter 的输出文件 mtime 停止更新超过 N 分钟即告警；轮转配置下还要盯 `max_backups` 到顶后的静默丢弃。
3. **第三：自编 collector 带第三方 postgresexporter。** 不推荐——上游是个人仓库、非官方，判据 C 的"上游停更"失效面直接命中，且探测不出"它写错了"。
4. **末位：ClickHouse / SigNoz。** 引入第二个数据库 + 一套 UI 服务，判据 B 判为可选、判据 C 的探测成本远高于收益。**升级条件**：当遥测量大到 PG 查询超过分钟级、或需要多人共享看板时才考虑。

---

## H4 · Inspect AI 作为外部 CLI/进程型 agent 的评估器

### 结论
**可以。** Inspect AI 的 **Sandbox Bridge** 就是为"在沙箱容器里跑一个任意语言的 CLI agent"设计的：它在容器内起一个代理服务器，接管 OpenAI/Anthropic/Google 三种 API 的请求并转发给 Inspect 当前的 model provider，agent 只要把 base URL 指向 `localhost:13131` 即可；**官方给的示例正是 Claude Code、Codex CLI、Gemini CLI**。因此 dsh 的一次运行完全可以作为被评对象（只要 dsh 能把模型端点指向那个代理——这依赖 dsh 的 `dsh-llm` 是否可配 base URL，需 G 组核实）。版本 `0.3.263`（2026-09-04），**MIT** 许可，`requires_python >=3.10`。

### 证据
- 桥接机制（https://inspect.aisi.org.uk/agent-bridge.html ）：「The sandbox bridge works via running a proxy server inside the sandbox container which receives requests for the OpenAI, Anthropic, and Google APIs.」「This proxy server in turn relays requests to the current Inspect model provider.」环境变量：`OPENAI_BASE_URL=http://localhost:13131/v1`、`ANTHROPIC_BASE_URL=http://localhost:13131`、`GOOGLE_GEMINI_BASE_URL=http://localhost:13131/v1beta`。语言不限：agent「can be written in any language」。CLI 形态：「Run the agent, using a CLI argument for input and stdout for output」。
- 官方示例（同页）：Claude Code——「Demonstrates using a Claude Code agent to explore a Kali Linux system」；Codex CLI——「Demonstrates using a Codex CLI agent to explore a Kali Linux system」；Gemini CLI 在列。
- Python 内嵌形态（https://inspect.aisi.org.uk/agents.html ）：「Use the `agent_bridge()` context manager to redirect the OpenAI API to the Inspect model provider.」；agent 转 solver 用 `as_solver()`。
- 日志格式（https://inspect.aisi.org.uk/eval-logs.html ）：`.eval` 是「Binary file format optimised for size and speed. Typically 1/8 the size of `.json` files and accesses samples incrementally.」，自 0.3.46 起是默认；`.json` 是「Text file format with native JSON representation」。**schema 是公开可取的**：`inspect log schema` 输出 JSON schema；非 Python 侧可用 `inspect log dump` ——「print any log file as plain text JSON no matter its underlying format」。Python 侧读取 API：`read_eval_log()` / `read_eval_log_samples()` / `read_eval_log_sample_summaries()`。
- 版本与许可证（PyPI `inspect-ai` 元数据，2026-09-07 取）：`version 0.3.263`，上传时间 `2026-09-04T01:37:58Z`，`license: MIT License`，`requires_python >=3.10`，源码仓库 https://github.com/UKGovernmentBEIS/inspect_ai 。

### 证据等级
[官方文档]（桥接、日志、示例）+ [registry]（版本/许可证）。**"dsh 能否把模型 base URL 指向 13131"未查到**——那是 G 组的 `dsh-llm` 问题，我这边只能标 UNDETERMINED。

### 对 L3 选型的直接后果与「它坏了怎么被发现」
Inspect AI 是 L3 的 **33 评估与演进** 的现成载体，且**是"判定器本身也要被验证"这条的唯一现成答案**——已知答案回归集的最小形态就是：一个 `dataset`（每条含 input + 期望的三态裁定 target）+ 一个 `scorer`（比对结构化裁定，不看自由文本）+ `.eval` 日志作为只追加的原始记录。**不需要装服务**（是 Python 包 + 本地日志文件）。
- 它坏了怎么被发现：**金标样本（canary）**。回归集里固定放两条必然通过与两条必然失败的样本；某次 eval 里这四条的裁定与预期不符，说明是 harness/桥接坏了而不是被评对象退步了。这个探测独立于 scorer（它检的是 scorer 本身），满足判据 C。
- 需要写进选型正文的风险：桥接是把模型流量劫持到 Inspect 的 provider，**dsh 走的是 Alan 自建 sub2api 网关**，两者叠加时"到底谁在计费、谁在限流"必须先跑通一次才能下结论。现在是 UNDETERMINED。
- 判据 A/B：评估在 L3 是 **A（必需）**——L3 的前置条件就是"有一个不需要人在场就能拒绝坏输出的判定器"，而没有回归集就无法判定这个判定器是否还有效。

---

## H5 · 人裁队列通知

### 结论
企业微信群机器人 webhook 支持 **8 种消息类型**、限频 **20 条/分钟**（官方原文），足以承载"五处检查点"的**通知**，但它**只是通知，不是授权载体**——它没有回执、没有身份绑定、没有"批准/驳回"的结构化返回。授权载体应当是 **GitHub PR + CODEOWNERS + 必需审查 + auto-merge**：CODEOWNERS 自动请求审查、分支保护/规则集把"code owner 批准"变成合并的必经条件、auto-merge 在"所有必需审查与必需状态检查都满足"后才自动合并。这正好符合部件 31 的四级里最高一级"自动进入必经路径的才是约束"。

### 证据
- 企业微信（https://developer.work.weixin.qq.com/document/path/91770 ）：支持「文本（text）、markdown（markdown、markdown_v2）、图片（image）、图文（news）、文件（file）、语音（voice）、模板卡片（template_card）八种消息类型」；限频「每个消息推送发送的消息不能超过20条/分钟」。文档同时提醒要保护 webhook URL 以防被冒用发垃圾消息。（注：该文档现以「消息推送」称呼，早期文案为「群机器人」。）
- CODEOWNERS（https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners ）：「You can use a CODEOWNERS file to define individuals or teams that are responsible for code in a repository.」「Code owners are automatically requested for review when someone opens a pull request that modifies code that they own.」草稿 PR 例外——转为 ready for review 后才请求。分支保护可「optionally require approval from a code owner before the author can merge a pull request in the repository」。同一 pattern 列多个 owner 时，**任一 owner 批准即满足**。
- auto-merge（https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request ）：「the pull request will merge automatically when all required reviews are met and all required status checks have passed.」「People with write permissions to a repository can enable auto-merge for a pull request.」若无写权限的人向分支推了新提交、或基分支被切换，auto-merge 会被禁用。

### 证据等级
[官方文档]（企业微信、GitHub 两页）。**未查到**：企业微信 webhook 是否支持任何形式的交互回调（模板卡片的按钮回调需要走应用而非 webhook 机器人，我未在该页确认，标未定）。

### 对 L3 选型的直接后果与「它坏了怎么被发现」
**推荐件：GitHub PR（必经路径 = 约束）+ CODEOWNERS（归属人）+ required status checks（事实门禁）+ auto-merge（无人值守下的放行）；企业微信 webhook 只做"唤醒"。** 这正对上不变量⑥的「唤醒不等于授权」——通知走微信，授权只在 PR 上发生。
- 企业微信坏了怎么被发现：**心跳消息**。每天固定时刻发一条"守夜人还活着"，Alan 侧只要某天没收到就知道通道断了。webhook 的失败是静默的（HTTP 200 也可能被限频丢弃），所以必须靠"该来的没来"而不是"错的来了"来探测。20 条/分钟的限频意味着**批量告警会被吞**——五处检查点的通知必须先聚合再发，不能一个工作项一条。
- GitHub 门禁坏了怎么被发现：**红队 PR**。定期开一个必然违反规则的 PR（比如动了受保护路径且不带 code owner 批准），确认它**不能**被 auto-merge。这个探测独立于门禁配置本身。写不出这条探测的分支保护配置，按判据 C 不装。

---

## H6 · 2026 年无人值守编码 agent 的官方做法（只取官方材料）

### 结论
三家官方材料给出的是**同一个骨架**：隔离边界在外、人在**输出侧**介入，而不是在动作侧逐个批准。Claude Code 说"无提示就必须有隔离边界，且沙箱化 Bash 单独不够"；Codex 云端**默认关闭外网**并给域名白名单 + HTTP 方法限制，人在 PR 上看结果；gh-aw 把 agent 跑成**只读权限**、输出写到已知文件、由另一个有写权限的生成 job 去落成 issue/PR/comment。给 L3 的"五处检查点"的现成形态就是：**权限最小化的执行 + 结构化输出 + 有写权限的旁路 job + PR 审查**。

### 证据
- Claude Code（https://code.claude.com/docs/en/sandbox-environments ）：
  - 「With no prompts to catch mistakes, the isolation boundary you choose is what protects your system. Always run `--dangerously-skip-permissions` sessions inside a container, a VM, or the sandbox runtime, so that file tools, MCP servers, and hooks are also inside the boundary.」
  - 「The sandboxed Bash tool on its own constrains only Bash, so it is not sufficient for fully unattended runs in either mode.」
  - auto mode 的定位：「The classifier is a per-action control, not an isolation boundary, so an isolation boundary still adds defense in depth for unattended runs」。
  - 隔离不改变外泄面：「Any approach that allows network egress can still leak data the agent can read, and any approach that mounts your project directory writable can still modify that code.」
  - dev container 页对无人值守的说法（https://code.claude.com/docs/en/devcontainer ）：「Because the container runs Claude Code as a non-root user and confines command execution to the container, you can pass `--dangerously-skip-permissions` for unattended operation.」并且「Skipping permission prompts removes your opportunity to review tool calls before they run.」
- OpenAI Codex 云端（https://developers.openai.com/codex/cloud/internet-access ）：agent 阶段**默认阻断外网**（setup script 阶段保留访问以装依赖）；控制方式是**域名 allowlist**，预设三档 None / Common dependencies / All (unrestricted)，可加自定义域；可进一步「limit requests to `GET`, `HEAD`, and `OPTIONS`」，阻断 POST/PUT/PATCH/DELETE。风险明示包括「Prompt injection from untrusted web content」与「Exfiltration of code or secrets」，并举了"从 GitHub issue 描述里读到隐藏指令→把敏感数据发到攻击者服务器"的例子。总览页（https://developers.openai.com/codex/cloud/ ）提到「Control internet access—Decide whether Codex can reach the public internet from cloud environments, and when to enable it.」以及把结果「turning results into PRs」。
- gh-aw safe-outputs（https://githubnext.github.io/gh-aw/reference/safe-outputs/ ）：「The safe-outputs: element of your workflow's frontmatter declares that your agentic workflow should conclude with optional automated actions based on the agentic workflow's output.」；「The agentic part of your workflow runs with minimal read-only permissions. It is given additional prompting to write its output to the special known files.」；编译器「automatically generates additional jobs that read this output and perform the requested actions」，且「Only these generated jobs receive the necessary write permissions.」；「All coding agent output is automatically sanitized for security before being processed」（XML 转义、URI 协议过滤、域名 allowlist）。

### 证据等级
[官方文档] 三份全部。**未查到**：gh-aw 是否强制某个人工审查步骤——文档没写强制的人工环节，人是通过标准 PR/issue 流程介入的；这一点我标"部分成立"，不写成"有强制人工检查点"。

### 对 L3 选型的直接后果
"五处检查点"在 L3 的现成形态可以直接照抄 gh-aw 的**权限分离**：执行者只读、输出写结构化文件、由**另一个执行单元**（有写权限、且它自己不受 agent 控制）去落地。这同时满足部件 25 的"写入权与生成权分开"和部件 31 的"权限在运行创建时固化、执行中只能收窄"。三家共同点还有一条要写进正文：**外网出口的默认态是关闭**（Codex 明说 agent 阶段默认阻断；Claude Code 沙箱明说「pre-allows no domains by default」）——这与本理论"未知默认关闭"同构，是行业已经收敛的做法，不是我们的独创。

---

## H7 · Landlock / bubblewrap 在 Docker 容器内

### 结论
两个叠加的坑，都有官方原句：① **Ubuntu 24.04 默认的 AppArmor 策略会阻止 bubblewrap 创建它需要的用户命名空间**，需给 `bwrap` 单独加一个 AppArmor profile（或改 sysctl）；② **在非特权容器内，bubblewrap 无法挂载新的 `/proc`**，会以 `Can't mount proc on /newroot/proc: Operation not permitted` 失败，官方给的绕法是打开一个**明确削弱安全性**的开关。**Landlock：我查到的官方材料里，Claude Code 的 Linux 沙箱写的是 bubblewrap，没有提 Landlock——写「未查到」，不猜。**

### 证据
- Ubuntu 24.04 的限制（https://code.claude.com/docs/en/sandboxing ，"Ubuntu 24.04 and later: allow bubblewrap to create user namespaces"）：「On Ubuntu 24.04 and later, the default AppArmor policy prevents bubblewrap from creating the user namespaces it needs for isolation.」检测方式：「run `sysctl kernel.apparmor_restrict_unprivileged_userns`. If the command returns `0`, skip this step. … If it returns `1`, add an AppArmor profile that grants `bwrap` this capability」。并注明「The profile applies only to `bwrap` itself, not to the commands it runs inside the sandbox.」
- 容器内的失败与绕法（同页 Troubleshooting）：「**Bubblewrap fails to start inside a container**: in an unprivileged container, bubblewrap can't mount a fresh `/proc` filesystem, so sandboxed commands fail with a `bwrap` error such as `Can't mount proc on /newroot/proc: Operation not permitted`. Set `enableWeakerNestedSandbox` to `true` so the inner sandbox bind-mounts the container's existing `/proc` instead. Only use this setting when the outer container already provides the isolation boundary you need, since it exposes process information to sandboxed commands that a fresh `/proc` mount would hide.」
- 同页安全限制一节的定性：「the Linux implementation provides strong filesystem and network isolation but includes an `enableWeakerNestedSandbox` mode that enables it to work inside Docker environments without privileged namespaces, or on Linux hosts where unprivileged user namespaces are disabled by sysctl. This option **considerably weakens security** and should only be used when additional isolation is otherwise enforced.」
- Linux 后端确认（同页 "OS-level enforcement"）：「**Linux**: uses bubblewrap for isolation」「**WSL2**: uses bubblewrap, same as Linux」；「WSL1 is not supported because bubblewrap requires kernel features only available in WSL2.」依赖包为 `bubblewrap` 与 `socat`（`socat` 是「the relay used to route network traffic through the sandbox proxy」），可选的 seccomp filter「adds Unix domain socket blocking」，来自 `npm install -g @anthropic-ai/sandbox-runtime`。
- Ubuntu 官方侧的旁证（https://ubuntu.com/blog/whats-new-in-security-for-ubuntu-24-04-lts ）：该文对默认态的表述是「the use of unprivileged user namespaces is then allowed for all applications but access to any additional permissions within the namespace are denied」，理由是「protecting against the abuse of user namespaces to gain access to additional attack surfaces within the Linux kernel」。**该文没有点名 sysctl 名称，也没有点名 bubblewrap**——sysctl 名与 bwrap 的具体影响我只在 Claude Code 文档与 Ubuntu 社区/发行说明讨论帖上读到，**Ubuntu 官方发行说明的逐字段落我未能打开确认**，故此条降级。

### 证据等级
[官方文档]（Claude Code sandboxing 页，三段原句）+ [官方文档，旁证](Ubuntu 安全博客)。Ubuntu 发行说明原文段落：**未能打开**。Landlock 在这套里的角色：**未查到**。

### 对 L3 选型的直接后果与「它坏了怎么被发现」
**结论是"不要把 bubblewrap 套在 Docker 里"**：在容器内再套 bwrap，要么失败、要么必须打开官方自己说"considerably weakens security"的开关，等于两层都不硬。L3 应当**二选一**：容器（+ H2 的 iptables 出口白名单）作为唯一边界，或者宿主上直接用 bwrap/sandbox-runtime 不进容器。Alan 的开发机是 Ubuntu 24.04，若选后者，**必须先加 bwrap 的 AppArmor profile**，否则沙箱会退化。
- 它坏了怎么被发现：这里最危险的失效是**静默降级**——Claude Code 默认行为是「if the sandbox cannot start because dependencies are missing or the platform is unsupported, Claude Code shows a warning and runs commands without sandboxing」。官方给了对应的硬失败开关：「To make this a hard failure instead, set `sandbox.failIfUnavailable` to `true`. This is intended for managed deployments that require sandboxing as a security gate.」**L3 必须打开它**。探测器（独立于沙箱自身）：开工前跑 `sysctl kernel.apparmor_restrict_unprivileged_userns`，返回 `1` 且 `/etc/apparmor.d/bwrap` 不存在即阻塞；再跑一次"沙箱内写一个本不该能写的路径"的探针，写成功即阻塞。

---

## 综合：按"以少就是多"的整体排序（本组 7 条内）

| 序 | 推荐件 | 新增组件数 | 判据 A/B | 它坏了怎么被发现（一句） |
|---|---|---|---|---|
| 1 | GitHub PR + CODEOWNERS + 必需检查 + auto-merge | 0（已有） | A（40 责任平面唯一可强制的载体） | 红队 PR：必然违规的 PR 必须合不进去 |
| 2 | 容器内 iptables+ipset 出口白名单 | 0（容器启动脚本） | A（31 未知默认关闭） | 双向探针（未授权域必失败 / 网关必成功）+ ipset 与 DNS 重解析求差集 |
| 3 | Inspect AI（sandbox bridge + 已知答案回归集） | 1 个 Python 包 | A（L3 前置条件就是判定器） | 金标 canary 四条样本裁定与预期不符即 harness 坏 |
| 4 | DBOS Transact TS 作为持久执行底座 | 0 新服务（复用 PG18） | 部分 A（20 检查点恢复）/ 可被"git+状态文件"替代则为 B | ERROR 态工作流计数 + 活性心跳（DBOS 自己不管卡死） |
| 5 | 会话日志 JSONL → 脚本投影进 PG | 0 新服务 | B（判据 B 点名"重新组织已有信息"） | 缺口计数：会话文件数 vs run 表行数 |
| 6 | 企业微信 webhook（仅唤醒） | 0 | B（通知不是授权） | 每日心跳消息"该来的没来" |
| 7 | Collector + fileexporter / ClickHouse / SigNoz | 1～4 | B，当前不装 | —（现在写不出足够便宜的探测，按判据 C 不装） |

**明确不采纳（各一句理由）**：
- OTel Collector 的第三方 `postgresexporter`——非官方、单人仓库，上游停更是明确失效面且探测不出"写错了"。
- ClickHouse / SigNoz——第二个数据库 + 一套服务，判据 B 判为可选，当前数据量下收益不抵运维。
- Docker Sandboxes——能力更强（microVM + deny-by-default 出口代理 + 凭据不进 VM），但是一整个新产品、治理功能付费、Linux 可用性我未查到；作为"需要抗对抗外泄时"的升级路径记在备选。
- 容器内再套 bubblewrap——官方自述需要打开"considerably weakens security"的开关，两层都不硬，不如只留一层。
- 仅用 `HTTPS_PROXY` 环境变量做出口控制——进程可以不理它，是提醒不是约束（按部件 31 的四级只能算"提醒"）。

## 未定与待 Alan / G 组裁的

1. **dsh 的模型 base URL 能否指向 Inspect 的 13131 代理**——决定 H4 的桥接是否成立。属 G 组 `dsh-llm` 的问题。
2. **DBOS 对 PostgreSQL 18 的支持**——官方无声明，必须自测后才能从 UNDETERMINED 转为满足。
3. **Docker Sandboxes 在 Linux 上是否可用**——官方页未写明，我未查到。
4. **企业微信 webhook 的模板卡片是否支持交互回调**——若支持，人裁通知有可能变成人裁"载体"；未查到，暂按"只做唤醒"处理。
5. **"convention rather than an enforcement boundary" 的归属需要更正到简报里**：这句说的是 dev container 作为组织级标准化手段，不是防火墙脚本。防火墙脚本官方的定性是「provided as a working example rather than a maintained base image」。

自评：我最没把握的三个判断是 ① OTel contrib 里"确实没有任何 PostgreSQL 导出器"——contrib 的 `exporter/` 目录树页被 robots.txt 拒绝，我是靠官方注册表加两个 issue 交叉推出来的，没有逐个目录名核对过；② DBOS 在 Node 24 + PostgreSQL 18 上能跑——`engines.node: ">=20"` 是我推出的覆盖关系，PG 版本官方完全没提，这一条严格说是未定而不是满足；③ Inspect AI 的 sandbox bridge 能桥接 dsh——官方示例只有 Claude Code / Codex CLI / Gemini CLI 三个走 OpenAI/Anthropic/Google API 形态的 agent，dsh 是否也走这三种协议、能否改 base URL，我完全没有证据。
