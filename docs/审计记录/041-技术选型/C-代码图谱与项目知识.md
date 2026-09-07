# 代码图谱与项目知识：候选、标准与对照

对应部件 **11 项目知识**。核心结论提前一句：**代码图谱在本理论里是「派生缓存」，而 2026 年没有任何一个现成工具把「绑定源版本 + 与源机械对账 + 差异由人分诊」这三件事做全**；因此最低成本形态不是装工具，而是「宿主原生 LSP（不落盘、无对账义务）+ 一个自建的、头部写着 `source_rev` 的单文件地图 + CI 里 regenerate-and-diff」。

---

## 0. 验证边界

- 检索日期：**2026-09-07**。所有"最新版本/日期"均为当日检索所得。
- **本报告没有任何 [一手实测]**：我没有在 Alan 的机器上安装或运行过任何候选。GitHub API 在本会话被代理拒绝（403，需 add_repo 授权），因此版本与日期全部来自网页抓取。读官方仓库文件（`scip.proto`、Serena `CHANGELOG.md`）也是经抓取工具转述、未逐字目视，故一律按 **[厂商文档]** 计，不冒充一手。
- **亲自（经 WebFetch）打开过的页面**：Claude Code `tools-reference`、Claude Code `discover-plugins`、Anthropic《Effective context engineering for AI agents》、VS Code `workspace-context`、GitHub Docs `indexing-repositories-for-copilot-chat`、GitHub Docs `codeql github upload-results`、opencode `/docs/lsp/`、opencode `/v2/docs/lsp/`、dsh `docs/features/tools`、learn.chatgpt.com `docs/codex/cli`、scip-code.org、`scip-code/scip` 仓库页与 README 与 releases、`scip.proto`、Sourcegraph《The future of SCIP》、Sourcegraph 自托管 6.12 changelog、Sourcegraph `src code-intel upload` 参考、oraios/serena 仓库页/releases/CHANGELOG/docs(运行、工作流、Memories)、joernio/joern、pypi `code-graph-rag`、docs.code-graph-rag.com、zilliztech/claude-context、bartolli/codanna、isaacphi/mcp-language-server、sourcebot 仓库页与 docs overview、LSP 3.18 规范页、universal-ctags releases、adr.github.io/madr、DeepWiki 的 aider repomap 页。
- **只看了搜索摘要、没打开**：各类评测博客、Milvus/Medium 类文章、`codebase-memory-mcp`、`cocoindex realtime-codebase-indexing`。凡出现在下文的均标 [二手] 或明写"未打开"。
- **未查到**：Codex CLI 是否有 LSP 或代码索引（官方文档只描述 shell + 文件读写 + MCP，未提及索引/LSP —— 这是"文档未提"，不等于"确定没有"，记 **未定**）；dsh 是否有持久代码索引（同上）；Sourcebot 的许可证条款与索引新鲜度语义；`scip` CLI 的子命令列表；Diátaxis 官网（未打开，本报告不引用）。

---

## 1. 2026 年的行业标准与主流实践

### 1.1 有开放标准的层：符号解析与索引产物

| 标准 | 归属 | 状态（2026-09） | URL |
|---|---|---|---|
| **LSP (Language Server Protocol)** | Microsoft，公开规范 | 3.17 为最新定稿版；**3.18 仍标注 "under development"**。`workspace/symbol`、`textDocument/definition`、`references`、`prepareCallHierarchy`、`prepareTypeHierarchy` 全部在规范内 [厂商文档] | microsoft.github.io/language-server-protocol |
| **SCIP (SCIP Code Intelligence Protocol)** | **已从 Sourcegraph 转出为独立开放治理**：Core Steering Committee 含 Meta / Uber / Sourcegraph，设 SEP（SCIP Enhancement Proposal）RFC 流程；仓库迁至 `github.com/scip-code/scip` | Apache-2.0；最新 **v0.9.0，2026-06-29**。官方列出 10 个 indexer（scip-java/typescript/clang/ruby/python/dotnet 由 Sourcegraph 维护，rust-analyzer 由 Rust 项目自带，scip-dart 由 Workiva，scip-php 由个人）[厂商文档] | scip-code.org |
| **LSIF** | 原 Microsoft/Sourcegraph | 已被 SCIP 取代（SCIP 官方定位为 "a better code indexing format than LSIF"）[厂商文档] | — |
| **MADR（ADR 模板）** | ADR GitHub 组织 | **4.0.0，2024-09-17**，MIT + CC0 双许可；字段含 status / date / deciders / consulted / informed / consequences [厂商文档] | adr.github.io/madr |

**没有开放标准的层**：**「代码图谱交换格式」不存在开放标准**。tree-sitter 是事实标准的解析库而非规范；universal-ctags 的 tags 文件是事实格式（最新 **6.2.1，2025-10-25**）；Joern 的 CPG（Code Property Graph）是学术/开源规范，无标准组织归属；各图数据库方案（Neo4j/Memgraph 类）之间 schema 互不通用。**结论：图数据库型代码图没有可迁移性保证——这直接违背「知识平面是资产、换工具不丢」。**

### 1.2 一条重要的官方立场（与本理论同向）

Anthropic 官方工程文章明确主张 **just-in-time 检索优于预计算索引**：「Rather than pre-processing all relevant data up front, agents built with the 'just in time' approach maintain lightweight identifiers (file paths, stored queries, web links, etc.) and use these references to dynamically load data into context at runtime using tools.」并点名预计算路径的问题是 **stale indexing**；同时说「Folder hierarchies, naming conventions, and timestamps all provide important signals」——这正是本理论「入口只做地图 + 细节就近」的同构表述。[厂商文档]

### 1.3 五宿主原生代码检索能力矩阵

| 宿主 | 文本检索 | LSP 符号能力 | 持久代码索引 | 证据 |
|---|---|---|---|---|
| **Claude Code** | Grep（基于 ripgrep，尊重 .gitignore）+ Glob | **有内置 LSP 工具**：跳定义、找引用、hover 类型、列符号、跨工作区符号搜索、找实现、调用层级；**默认不激活**，须安装 code intelligence 插件（官方市场列 11 语言：clangd/csharp/gopls/jdtls/kotlin/lua/php/pyright/rust-analyzer/swift/typescript），且语言服务器二进制要自己装；云端会话不启动插件语言服务器 | **无**。文档未出现任何索引/embedding/语义搜索 | [厂商文档] |
| **codex** | shell + 文件读写；`--search` 是**联网搜索**不是代码检索 | 未查到 | 未查到 | [厂商文档]（未提及→**未定**） |
| **opencode** | 内置 grep/glob 类工具 | **v1 文档（更新于 2026-09-06）：LSP 仅用于诊断反馈，默认关闭，可自动下载 server**；**v2 文档：「OpenCode V2 does not yet have an LSP runtime」**，配置被保留但不启动 server、不暴露 LSP 工具 | 未查到 | [厂商文档] |
| **dsh** | `fs_search`（bundled ripgrep，glob/grep） | **有 `lsp` 工具**：goToDefinition / findReferences / goToImplementation / hover，标注为只读、基于 `ctx.lsp` | 文档未提，**未定** | [厂商文档] |
| **VSCode Copilot** | semantic search + text search + grep + file search + **usages** | 走 VS Code 自身的语言服务（usages 工具） | **有**：GitHub 仓库远程语义索引（GitHub 侧构建，大仓首次约 60 秒，之后"新会话开始后数秒内自动更新"）、Azure DevOps 索引、非托管工作区的本地索引（首次数分钟），可手动 `Build Codebase semantic index` | [厂商文档] |

**读法**：符号层（LSP）在 5 个宿主里有 3 个能用（Claude Code 需插件、dsh 原生、opencode 仅诊断），**语义不变量必须写成「符号解析能力可用则用，不可用则退回文本检索并把结论降级为未定」**，不能假定处处有。索引层只有 Copilot 有，且**对用户完全不透明**。

---

## 2. 候选清单

### 2.1 零索引基线（agentic grep）
- 一句话：不建任何派生产物，靠 ripgrep + 文件读 + 目录约定按需探查。
- 维护状态：五宿主全部内置，无上游风险。
- 部署形态：无。许可证：随宿主。
- **通用层**（五宿主都有）。来源：各宿主官方文档 + Anthropic context engineering 文章。

### 2.2 宿主原生 LSP
- Claude Code code-intelligence 插件 / dsh `lsp` 工具 / opencode 诊断（见 §1.3）。
- 部署形态：本地进程，随文件变化由 language server 自己增量重算，**不落持久盘产物**。
- **宿主绑定层**。风险：opencode 官方自己写明「Language servers can get out of sync, use significant memory, vary by version or project, and slow down agent workflows」——这是判据 C 要的失效面自述。[厂商文档]

### 2.3 Serena（oraios/serena）
- 一句话：以 LSP 为后端的 MCP 工具箱，给 agent 符号级检索与符号级编辑，另带一套 Markdown「memories」。
- 维护状态：**活跃**。v1.5.3（2026-05-26），main 分支持续开发（LaTeX/texlab、git worktree、trust-based 项目配置等）。
- 部署形态：MCP server（uvx/本地进程）+ 各语言 language server；`serena project index` 预热符号缓存，配置在 `.serena/project.yml`，memories 在 `.serena/memories/`（项目级）与 `~/.serena/memories/global/`。官方称「During regular usage, Serena will automatically update the index whenever files change」。
- 许可证：MIT。**通用层**（官方列 Claude Code / Codex / OpenCode / Gemini-CLI / VSCode / Cursor / JetBrains）。

### 2.4 mcp-language-server（isaacphi）
- 一句话：把任意 stdio 语言服务器包成 6 个 MCP 工具（definition / references / diagnostics / hover / rename_symbol / edit_file）。
- 维护状态：活跃但轻量（未查到发布版本号）。部署：单个 Go 二进制 + 你自己的 language server。
- 许可证：BSD-3-Clause。**通用层**。定位：比 Serena 更薄，给没有原生 LSP 的宿主（codex / opencode v2）补齐符号层。

### 2.5 universal-ctags + tags 文件
- 一句话：几十年历史的符号表生成器，产出单个文本 tags 文件。
- 维护状态：**6.2.1，2025-10-25**（近一年无新版，但项目仍在 nightly build）。部署：一个 C 二进制。许可证：GPL-2.0（观察，未逐字核对）。**通用层**。
- 价值：**最低成本的持久派生缓存**，产物是纯文本、进 git、可 diff。

### 2.6 tree-sitter repo map（aider 式）
- 一句话：tree-sitter 抽 def/ref 标签 → 建文件引用图 → PageRank 排序 → 生成一份带 token 预算的"仓库地图"。
- 参考实现是 aider 内置（不是可独立安装的通用工具）。**其缓存机制是本报告里唯一见到的、接近本理论要求的机械对账**：缓存文件名为 `.aider.tags.cache.v{VERSION}`（**提取逻辑变更时版本号递增 → 整批失效**），每条缓存记录携带文件 mtime，读取时比对当前 mtime，不符即重算。[厂商文档/DeepWiki 转述，二手偏一手]
- **通用层**（作为自建脚本的设计模板，不是作为依赖）。

### 2.7 SCIP + 语言 indexer
- 一句话：把一次全量分析的结果落成一个 protobuf 索引文件，供任意消费者读。
- 维护状态：v0.9.0（2026-06-29），独立治理（§1.1）。许可证：Apache-2.0。**通用层（格式层）**。
- **关键事实**：`scip.proto` 的 `Metadata` 只有 4 个字段——`version` / `tool_info` / `project_root` / `text_document_encoding`；`ToolInfo` 只有 `name` / `version` / `arguments`。**索引格式本身不带 commit SHA**。版本绑定发生在消费侧：`src code-intel upload -commit`（"The 40-character hash of the commit. Defaults to the currently checked-out commit."）。[厂商文档]
- 缺口：**未查到轻量的本地 SCIP 查询器**（不装 Sourcegraph 的情况下怎么问这个索引）。记未定。

### 2.8 Sourcegraph 自托管
- 一句话：企业级代码搜索 + 精确代码导航（消费 SCIP 上传）。
- 维护状态：自托管 **6.12，2026-02-10**；该版把 CSS/SCSS 符号抽取从 ctags 换成 tree-sitter，并把 custom indexing policies 默认关闭。
- 部署形态：多组件服务集群。许可证：Sourcegraph 企业许可（非 OSI 开源，观察）。**通用层（服务）**，但对一人项目严重超配。

### 2.9 Sourcebot（sourcebot-dev/sourcebot）
- 一句话：自托管的代码搜索/代码问答，**自带 MCP server**，Docker Compose 部署。
- 维护状态：活跃（观察）。许可证 **未核实**（仓库有 LICENSE.md，抓取未能给出条款）。索引版本/新鲜度语义 **未查到**。**通用层（服务）**。

### 2.10 CodeQL
- 一句话：把代码编译成关系型数据库再用 QL 查询，主用于安全与代码质量分析。
- 部署：CLI + 每语言 extractor；数据库是**一次性快照**。许可证：GitHub 专有（开源项目免费，观察）。
- **版本绑定做得最正**：`codeql github upload-results` 有 `-c/--commit`（"SHA of commit that was analyzed"）与 `-f/--ref`，缺省时从 checkout 自动推断。[厂商文档]
- 定位：**这不是日常"项目知识"工具**，构建代价高、查询语言陡；更适合作为 F（控制平面）的验证器候选。

### 2.11 Joern
- 一句话：把源码/字节码/二进制统一成 CPG（Code Property Graph）做跨语言分析。
- 维护状态：活跃（每日自动发布）。许可证：Apache-2.0。部署：JVM CLI / `--server` / Docker。语言：C/C++/Java/JS/Python/Kotlin/二进制。
- **无 MCP server**；**未查到增量索引能力**。定位偏安全分析。

### 2.12 code-graph-rag（vitali87）
- 一句话：tree-sitter 解析全仓 → 写进 **Memgraph** 图库 → LLM 生成 Cypher 查询；另接 **Qdrant**（默认）做向量检索；提供 MCP server。
- 维护状态：**极活跃但版本号是 0.0.845（2026-09-02）**——五天前还在发版，但仍是 0.0.x。许可证：MIT。
- 依赖：Python 3.12+ **+ Docker + CMake + ripgrep + Memgraph + Qdrant**。有 `cgr daemon`、文件监听、`--update-graph`。**未查到 commit 绑定**。
- **通用层（服务）**，但引入三个新的常驻进程。

### 2.13 claude-context（zilliztech）
- 一句话：AST 切块 + embedding → Milvus/Zilliz Cloud 向量库，混合 BM25 + dense 检索，MCP 暴露。
- 维护状态：活跃。许可证：MIT。依赖：Node ≥20 + embedding provider（OpenAI/VoyageAI/Ollama/Gemini）+ Milvus 或 Zilliz Cloud。
- **增量机制是 Merkle 树**（"Efficiently re-index only changed files using Merkle trees"）——内容哈希级对账，比 mtime 强。**通用层**。

### 2.14 codanna（bartolli）
- 一句话：单个 Rust 二进制的本地代码智能 MCP + CLI，tree-sitter 解析 + **本地** embedding，索引落 `.codanna/`，15 语言，`--watch` 跟随文件变化。
- 许可证：Apache-2.0（带 NOTICE 署名要求）。**通用层**。首次会下载约 150MB 的嵌入模型。**未查到过期/重建语义**。

> 未打开、仅在搜索结果里见到、因此不进入评估：`DeusData/codebase-memory-mcp`、`cocoindex-io/realtime-codebase-indexing`。

---

## 3. 对照本理论 11 的要求

### 3.1 派生缓存的六条硬要求（R3–R8）

要求原文（简报 §4·C）：**派生缓存必须①声明为缓存 ②绑定源版本 ③与源机械对账 ④差异由人分诊 ⑤人工写入区受保护 ⑥再生成只追加变更记录。**

**最小满足形态（少就是多）**：一个进 git 的纯文本产物，头部三行元数据 `kind: derived-cache` / `source_rev: <git rev-parse HEAD>` / `generator: <name>@<version>`；CI 里跑「重新生成 → `git diff --exit-code`」（与 Kubernetes `hack/verify-codegen.sh` 同构的 regenerate-and-diff 模式，[二手]）；人工内容放在**另一个文件**里，生成器只写自己的文件；再生成的差异走 PR，由人看 diff 分诊；变更记录就是 git log（天然只追加）。**这套形态零新增服务、零新增失效面，是本报告推荐的基线。**

| 要求 | 最小形态 | 宿主原生 LSP | Serena | ctags / tree-sitter 自建 | SCIP + CI | code-graph-rag | claude-context | codanna |
|---|---|---|---|---|---|---|---|---|
| ③ 声明为缓存 | 满足（头部字段） | **不适用**（无持久产物） | **不满足**：`.serena/cache` 与 `.serena/memories` 未区分派生/人工，文档未要求声明 [厂商文档] | 满足（自己写） | 部分：产物明确是索引，但格式无 `kind` 字段 | 不满足（图库内容不自述） | 不满足 | 不满足 |
| ④ 绑定源版本 | 满足（`source_rev`） | 不适用 | **不满足**：文档未提任何版本绑定 [厂商文档] | 满足（自己写） | **部分**：`scip.proto` Metadata **无 commit 字段**，绑定只在 `src ... upload -commit` 的消费侧 [厂商文档] | **未定**（未查到） | 部分：绑内容哈希（Merkle）不绑 git 版本 | **未定** |
| ⑤ 与源机械对账 | 满足（regenerate + diff） | 不适用（server 自己增量） | 部分：官方称"文件变化时自动更新索引"，但**不产出可核对的对账结果** | 满足 | 部分：可在 CI 重建后比对，但需自建 | 部分：文件监听 | **部分（较强）**：Merkle 树按内容哈希只重建变更文件 | 部分：`--watch` |
| ⑥ 差异由人分诊 | 满足（走 PR diff） | 不适用 | 不满足 | 满足 | 部分（需自建） | 不满足 | 不满足 | 不满足 |
| ⑦ 人工写入区受保护 | 满足（分文件） | 不适用 | **不满足**：memories 由 agent 在 onboarding 阶段自动生成、也可人手改，**同一目录同一格式，无写入权分区** [厂商文档] | 满足 | 满足（索引与文档天然分开） | 不满足 | 不适用（无人工区） | 不适用 |
| ⑧ 再生成只追加变更记录 | 满足（git log） | 不适用 | 不满足 | 满足 | 部分 | 不满足 | 不满足 | 不满足 |

**两个必须点名的事实**：
1. **Serena 的 memories 是本理论意义上最危险的形态**：它由 agent 生成、以人读 Markdown 存放、被当作项目权威知识注入，却**没有任何过期机制**（官方文档明确只依赖"human review and agent maintenance"）。按 12（记忆治理）的口径，它同时踩了「模型输出不得成为候选」与「派生知识须绑源版本」。**要用 Serena，就要把 memories 关掉或降级为影子，别让它进权威载体。**
2. **Copilot 的远程语义索引对用户完全不可对账**：官方文档不给任何新鲜度指示器、不给 commit 绑定、不给"索引里有哪些文件"的读取接口。按 R3/R4 全部不满足；它只能作为"提示"，不能作为"权威"。[厂商文档]

### 3.2 知识组织的要求（R1、R2、R9–R12）

| 要求 | 最小满足形态 | 现成实践/工具 | 判定 |
|---|---|---|---|
| **按问题类型指定唯一权威记录源** | 一张 4–8 行的对照表写在入口文件里：*决策→`docs/adr/`（MADR 4.0.0）；接口→schema/类型定义本身；依赖→lockfile；结构与调用→代码 + LSP；历史→git；验收→验收条目文件* | MADR 是唯一有归属组织与稳定模板的开放件（ADR org，MIT/CC0）；其余没有标准，靠约定 | **满足**（纯文档实现，零工具） |
| **入口只做地图（去哪找 + 一句摘要），细节就近** | 入口文件只放「路径 + 一句话」的清单，正文分散在各目录 | 与 Anthropic 官方 context engineering 立场一致（"folder hierarchies, naming conventions... provide important signals"）；AGENTS.md/CLAUDE.md 层级由调研员 A/E 负责 | **满足**（纯文档实现） |
| **两类知识两种过期机制** | 派生知识：`source_rev` + 机械判过期；经验知识：条目头写 `scope`（适用范围）+ `origin_event`（产生事件）+ `review_if`（触发复核的路径 glob） | **未查到任何现成工具实现「源变化触发经验知识复核」**。可用的机械近似：把 `review_if` 的 glob 交给 CODEOWNERS 或一个 CI 检查（改了 `src/auth/**` 就要求 touch 对应经验条目）。这属于 F 的必经路径范畴 | **部分成立**：机制可用纯文件 + CI 实现，但没有现成件；工具侧全部**不满足** |
| **不为执行者维护与人读版本分离的第二副本** | 同一份 Markdown，人读也给模型读 | Serena memories、Copilot 索引、任何向量库/图库**都是第二副本**；ctags/SCIP 也是副本，但它们是「代码的副本」不是「文档的副本」，且明确是缓存 | 零索引：满足；LSP：满足（无副本）；**向量/图库：不满足** |
| **「代码里能读到就不写」是默认方向** | 入口文件不复述函数签名、目录结构、依赖列表 | 与 Anthropic JIT 立场一致 | **满足**（纪律，不是工具） |
| **冲突时列出互相冲突的主张与范围版本，不静默挑一个** | 检索工具返回多来源时并列，不合并 | **所有候选都不满足**：LSP 返回单一定义、向量检索返回相似度排序后的 top-k、图库返回一条 Cypher 结果——**没有一个候选会告诉你"我这里有两条互相矛盾的记录"**。这是执行者提示词/方法库的职责，不是索引工具的 | 工具侧一律 **不满足**；须由 23 方法库承担 |

---

## 4. 判据 A / B / C 判定

判据 A（必需性）：没有它，某条规范条文就无法被判定为"已执行"或"已违反"。
判据 B（可选性）：它是否只是把仓库里已有的信息重新组织了一遍。
判据 C（引入门槛）：写不出"它坏了怎么被发现"的，不装。

| 候选 | A 还是 B | 引入的失效面 | "它坏了怎么被发现"（判据 C） |
|---|---|---|---|
| 零索引 grep | 都不是（是缺省态） | 无新增 | 不适用 |
| 宿主原生 LSP | **B**（依赖关系本来就在代码里；LSP 只是更快地读出来） | language server 崩溃、与项目版本不匹配、monorepo 误报（Claude Code 文档自己列了这三条）；opencode 文档明写"can get out of sync" | **写得出**：把同一个符号问题用 LSP 与 grep 各问一次，结果不一致即 LSP 可疑（探测器是 grep，独立于 LSP）。**可装** |
| Serena | **B** | 多一个 MCP 进程 + LSP + 一套无过期机制的 memories | 符号能力部分同上；**memories 写不出探测器**（"这条 memory 过期了怎么被发现" 没有答案）→ **memories 按判据 C 不装**；符号工具可装 |
| mcp-language-server | **B** | 一个 Go 进程 + language server | 同 LSP。**可装** |
| ctags / tree-sitter 自建单文件地图 | **B** | 一个 CI 步骤；产物可能过期 | **写得出且最强**：CI regenerate + `git diff --exit-code`；再加一条覆盖率对账（索引文件集合 vs `git ls-files` 的差集必须为空）。探测器是 git 与 CI，独立于生成器本身。**可装** |
| SCIP + indexer | **B** | 一个索引构建步骤 + 一个消费者；**格式不带 commit，绑定靠人不忘记传 `-commit`** | 写得出（同上 + 上传时 commit 与 HEAD 比对）；但**没有现成的轻量本地消费者**→ 在不装 Sourcegraph 的前提下，判据 A/B 之外还卡在"没东西读它" |
| Sourcegraph 自托管 | **B** | 一整套服务集群、企业许可、升级维护 | 写得出（服务健康检查 + 索引 commit 与 HEAD 比对），但成本与一人项目完全不匹配 |
| Sourcebot | **B** | Docker Compose 服务栈；许可未核实 | **暂时写不出**（索引新鲜度语义未查到）→ 按判据 C 现在不装，可作为待核实项 |
| CodeQL | 对 11 是 **B**；对 30/31（F 的领域）可能是 A | 构建耗时、每语言 extractor、专有许可 | 写得出（DB 里记的 commit vs HEAD；查询本身可用已知答案回归集校验）。**在 11 这一格不装** |
| Joern | **B** | JVM 运行时、全量重建、无 MCP | 写不出增量/过期语义（未查到）→ **按判据 C 不装** |
| code-graph-rag | **B** | **Memgraph + Qdrant + Docker + daemon 四个新常驻件**；0.0.x 版本号；LLM 生成 Cypher 本身不确定 | **写不出**：未查到 commit 绑定；"图过期了"没有独立探测器（探测只能靠它自己的 daemon）→ **按判据 C 不装** |
| claude-context / 任何向量库 | **B**（判据 B 已点名） | 向量库 + embedding 服务/API + 索引；**embedding 语义漂移不可机械检测** | **半个**：Merkle 树能检出"文件变了没重建"，但**检不出"embedding 模型换了/召回质量退化了"**。要装就必须自带一个"已知答案召回回归集"作为独立探测器 |
| codanna | **B** | 单二进制（这点很好）+ 150MB 本地模型 + `.codanna/` 索引 | 部分：`--watch` 是同步机制不是探测机制；过期语义未查到 → **现在写不出，暂不装** |

### 4.1 正面回答简报点名的问题

**Q1：什么条件下图数据库/向量库才值得装？**
三个条件**同时**满足才值得，缺一不装：
1. **存在 LSP 与 grep 都答不出、但你反复要问的问题**——典型是跨语言/跨制品的边界关系：TS 前端调用 → OpenAPI → Python 后端 → SQL schema 这一串，LSP 在每段内部都能走，但跨段断链；grep 只能靠命名巧合。
2. **这个问题的答案要进入判定**（比如"这次改动的影响面"要作为验证计划的输入），而不只是给人参考。判据 A 在这里才可能从 B 升格：如果某条规范条文（例如 30「从改动集派生验证计划」）**只能**靠影响面图来判定"已执行"，它才是必需。
3. **你已经有一条必经路径（CI）能承载它的重建与对账**。没有 CI 就没有机械对账，装了也是第二个真相。

**向量库另加一条**：只有当"我不知道该搜什么词"是真实高频痛点时才装（自然语言→代码的模糊召回）。Alan 是单人开发、对自己的代码熟悉，这个痛点强度存疑 → **现阶段不装**。

**Q2：最低成本形态是什么？**
- **图**：**不是图数据库，是一个文本文件**。用 tree-sitter（或 ctags）抽 def/ref，产出 `docs/_generated/codemap.md`（或 `.tsv`），头部三行元数据，内容是「文件 → 它引用了谁 / 谁引用它」的邻接表，按 PageRank 或入度排序截断到 token 预算内（aider 的做法即此）。查询用 grep。**零服务、零守护进程、产物进 git、diff 可读。**
- **向量**：最低成本形态是**不装**；退一步是 codanna 这类单二进制本地方案（一个进程、一个 `.codanna/` 目录、模型在本地），而不是 Milvus/Qdrant + embedding API。
- **符号**：宿主原生 LSP（Claude Code 插件 / dsh `lsp`）；跨宿主统一时用 mcp-language-server（比 Serena 薄）。

**Q3：装了怎么知道它过期了？**（四条，按强度排序，前两条必须有）
1. **版本对账**：产物头部写 `source_rev` + 生成时的 `git status --porcelain` 是否为空；每次查询前比对当前 HEAD，不一致就在工具返回里带 `STALE` 标记，**并把基于它的结论降级为三态里的「未定」**——这是与本理论第 4 条不变量（事实来自回读）唯一自洽的接法。
2. **覆盖率对账**：索引里的文件集合 vs `git ls-files` 的集合，差集非空即失败。**探测器是 git，不是索引器自己**，满足判据 C。
3. **重建对账**：CI 里重新生成 + `git diff --exit-code`。这条同时覆盖"生成逻辑变了但产物没更新"。
4. **抽样回读**：随机抽 N 个条目，用 grep/LSP 独立复核位置与存在性；失败率超阈值即报警。**向量库只能靠这条**（一个固定的"已知答案召回集"），因为前三条对 embedding 无效。

---

## 5. 推荐与备选（按 L0→L3 分档）

### L0 · 一人一工具
**装**：什么都不装。**权威源分工表**（决策→ADR/MADR；结构与调用→代码+LSP；历史→git；验收→验收条目文件）写进入口文件，入口只放地图。
**不装**：任何索引、任何图库、任何向量库、Serena memories。
**为什么**：判据 A 不成立——没有代码图谱，11 的每一条规范条文照样能被判定；且 Anthropic 官方立场与本理论同向（JIT 检索、警惕 stale indexing）。

### L1 · 一人多会话（Alan 的当前位置）
**装**：
1. **宿主原生 LSP**：Claude Code 装 `pyright-lsp` + `typescript-lsp`（对应 Alan 的 Python/TS 栈）；dsh 用内置 `lsp` 工具。这是**宿主绑定层**，正文只写「符号解析可用则用」的语义。
2. **一个自建的单文件代码地图**（可选，仓库超过约 200 个源文件时才开始有价值）：ctags 或 30 行 tree-sitter 脚本，产物进 git，头部 `source_rev`，CI 里 regenerate-and-diff。
**不装**：Serena 的 memories（符号工具部分可用，但如果 Claude Code 与 dsh 都已有 LSP，Serena 的边际价值主要在 codex/opencode 上）；向量库；图库。
**升级到下一档的触发条件**：出现「LSP 答不出、grep 靠命名巧合、我一周问了三次」的跨制品关系问题。

### L2 · 团队
**装**：在 L1 之上，把代码地图的生成移进 CI（必经路径），并让"影响面"成为验证计划的输入之一。此时才考虑 **SCIP + 语言 indexer**，上传时用 `-commit` 绑定版本；消费端优先找轻量本地查询器（**目前未查到，是本报告最大的缺口**），找不到就继续用自建文本地图。
**不装**：Sourcegraph 自托管（组件与许可成本与团队规模不匹配，除非已有多仓多语言与合规需求）。
**升级触发**：多仓库、多语言边界、代码检索本身成为多人共享的基础设施。

### L3 · 无人值守
前置条件是「有一个不需要人在场就能拒绝坏输出的判定器」。代码图谱在这一档**可以**作为影响面判定器的输入，但必须满足：产物带 `source_rev`、查询返回带 `STALE` 标记、STALE 一律裁为**未定**并阻塞而非放行。**没有这三条就别把图谱接进自动判定链。**

### 明确不采纳
- **Sourcegraph 自托管**：企业许可 + 多组件集群，一人项目严重超配。
- **Joern**：CPG 能力强但面向安全分析，JVM + 未查到增量、无 MCP，判据 C 写不出。
- **code-graph-rag**：Memgraph + Qdrant + Docker + daemon 四个新失效面，版本仍是 0.0.x，未查到源版本绑定；判据 C 写不出。
- **claude-context / 任何 Milvus-Qdrant 类向量方案**：判据 B 已点名，且 embedding 漂移不可机械检测；除非配一个已知答案召回回归集，否则不装。
- **CodeQL 作为日常项目知识工具**：构建代价与查询门槛都错配（它在 F 那边可能有位置）。
- **Copilot 远程语义索引作为权威源**：不可见、不可对账、宿主绑定，只能当提示。
- **Serena memories 作为项目知识权威载体**：agent 生成 + 无过期机制 + 人工/派生同区，同时违反 11 与 12。
- **Sourcebot**：不是否定，是**未核实**（许可与新鲜度语义都没查到），按判据 C 现在不装。

---

## 6. 未定与待核实

1. **codex 与 dsh 是否有持久代码索引**：两家官方文档都没提。"文档未提"≠"确定没有"，记 **未定**。dsh 的 `lsp` 工具是否真的只读、`ctx.lsp` 的权限语义如何，需 Alan 在本机一手核对（他有 dsh）。
2. **SCIP 的轻量本地消费者**：未查到。如果不存在，SCIP 在一人场景下的实际价值接近零（有格式没读法），这会改变 L2 的推荐。**建议 Alan 裁：是否值得花时间验证这一条。**
3. **Sourcebot 的许可证与索引新鲜度语义**：未核实。
4. **Serena「文件变化时自动更新索引」的实际行为**：官方一句话带过，未说是文件监听还是查询时惰性校验、外部改动（git checkout 切分支、rebase）是否能被感知。**这是判据 C 的关键，未定。**
5. **Claude Code LSP 工具的失效可见性**：文档说语言服务器不启动会在 `/plugin` Errors 标签里报错，但**没说 agent 调用 LSP 工具失败时会不会静默退化为 grep**。若会静默退化，则「至少两个位置检查」的语义在这里落不了地。需一手实测。
6. **aider repo map 的缓存语义**主要来自 DeepWiki 转述（偏二手）；如要采用其设计，建议直接读 `aider/repomap.py`。
7. **本报告全部候选的"效果"未做任何比较**：没有跑过任何 benchmark，也不引用他人的准确率数字。
8. **与调研员 D 的交叉点**：Serena memories 同时属于 11 与 12 的辖区，两份报告的结论必须一致（我这边的结论是"不进权威载体"）。
9. **与调研员 F 的交叉点**：本报告的 regenerate-and-diff 与覆盖率对账都要落在 CI 必经路径上，属 31 的"约束"级；CodeQL 的归属也应由 F 定。

---

## 7. 来源

1. [Tools reference — Claude Code Docs](https://code.claude.com/docs/en/tools-reference) — 2026-09-07 — [厂商文档] — §1.3、§4
2. [Discover and install prebuilt plugins — Claude Code Docs](https://code.claude.com/docs/en/discover-plugins) — 2026-09-07 — [厂商文档] — §1.3（code intelligence 插件表）、§2.2、§5
3. [Effective context engineering for AI agents — Anthropic Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — 2026-09-07 — [厂商文档] — §1.2、§3.2、§5
4. [How Copilot understands your workspace — VS Code Docs](https://code.visualstudio.com/docs/agents/reference/workspace-context) — 2026-09-07 — [厂商文档] — §1.3
5. [Indexing repositories for Copilot Chat — GitHub Docs](https://docs.github.com/copilot/concepts/indexing-repositories-for-copilot-chat) — 2026-09-07 — [厂商文档] — §1.3、§3.1
6. [LSP Servers — OpenCode Docs](https://opencode.ai/docs/lsp/)（页面标注更新于 2026-09-06） — 2026-09-07 — [厂商文档] — §1.3、§2.2
7. [LSP — OpenCode V2 Docs](https://opencode.ai/v2/docs/lsp/) — 2026-09-07 — [厂商文档] — §1.3
8. [Built-in tools — DeepSeek Harness Docs](https://deepseekdocs.com/en/docs/features/tools) — 2026-09-07 — [厂商文档] — §1.3
9. [Codex CLI — OpenAI](https://learn.chatgpt.com/docs/codex/cli)（由 developers.openai.com/codex/cli/features 302 跳转） — 2026-09-07 — [厂商文档] — §1.3
10. [Language Server Protocol Specification 3.18](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.18/specification/) — 2026-09-07 — [厂商文档] — §1.1
11. [SCIP Code Intelligence Protocol](https://scip-code.org/) — 2026-09-07 — [厂商文档] — §1.1、§2.7
12. [scip-code/scip（README 与 releases）](https://github.com/scip-code/scip) — 2026-09-07 — [厂商文档] — §1.1、§2.7（v0.9.0 / 2026-06-29 / Apache-2.0 / indexer 列表）
13. [scip.proto（官方仓库文件）](https://raw.githubusercontent.com/scip-code/scip/main/scip.proto) — 2026-09-07 — [厂商文档] — §2.7（Metadata 无 commit 字段）
14. [The future of SCIP — Sourcegraph](https://sourcegraph.com/blog/the-future-of-scip) — 2026-09-07 — [厂商文档] — §1.1（独立治理、Core Steering Committee、SEP）
15. [`src code-intel upload` — Sourcegraph docs](https://sourcegraph.com/docs/cli/references/code-intel/upload) — 2026-09-07 — [厂商文档] — §2.7、§4（`-commit` 绑定）
16. [Sourcegraph self-hosted 6.12 changelog](https://sourcegraph.com/changelog/releases/6.12) — 2026-09-07 — [厂商文档] — §2.8（2026-02-10）
17. [`codeql github upload-results` — GitHub Docs](https://docs.github.com/en/code-security/reference/code-scanning/codeql/codeql-cli-manual/github-upload-results) — 2026-09-07 — [厂商文档] — §2.10（`--commit` / `--ref`）
18. [oraios/serena](https://github.com/oraios/serena) 与 [CHANGELOG.md](https://github.com/oraios/serena/blob/main/CHANGELOG.md) — 2026-09-07 — [厂商文档] — §2.3（MIT、v1.5.3 / 2026-05-26）
19. [Memories & Onboarding — Serena Documentation](https://oraios.github.io/serena/02-usage/045_memories.html) — 2026-09-07 — [厂商文档] — §3.1（memories 存放位置、agent 生成、无过期机制）
20. [The Project Workflow — Serena Documentation](https://oraios.github.io/serena/02-usage/040_workflow.html) — 2026-09-07 — [厂商文档] — §2.3（`serena project index`、"automatically update the index whenever files change"）
21. [isaacphi/mcp-language-server](https://github.com/isaacphi/mcp-language-server) — 2026-09-07 — [厂商文档] — §2.4（BSD-3、6 个工具）
22. [universal-ctags releases](https://github.com/universal-ctags/ctags/releases) — 2026-09-07 — [厂商文档] — §2.5（6.2.1 / 2025-10-25）
23. [Repository Mapping System — DeepWiki(Aider)](https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping-system) — 2026-09-07 — [二手] — §2.6、§4.1（mtime 键 + 缓存版本号）
24. [joernio/joern](https://github.com/joernio/joern) — 2026-09-07 — [厂商文档] — §2.11
25. [code-graph-rag — PyPI](https://pypi.org/project/code-graph-rag/) 与 [docs.code-graph-rag.com](https://docs.code-graph-rag.com/) — 2026-09-07 — [厂商文档] — §2.12（0.0.845 / 2026-09-02 / MIT / Memgraph + Qdrant）
26. [zilliztech/claude-context](https://github.com/zilliztech/claude-context) — 2026-09-07 — [厂商文档] — §2.13（MIT、Merkle 树增量）
27. [bartolli/codanna](https://github.com/bartolli/codanna) — 2026-09-07 — [厂商文档] — §2.14（Apache-2.0、单二进制、`.codanna/`）
28. [sourcebot-dev/sourcebot](https://github.com/sourcebot-dev/sourcebot) 与 [docs.sourcebot.dev/docs/overview](https://docs.sourcebot.dev/docs/overview) — 2026-09-07 — [厂商文档] — §2.9（许可与新鲜度未核实）
29. [About MADR](https://adr.github.io/madr/) — 2026-09-07 — [厂商文档] — §1.1、§3.2（4.0.0 / 2024-09-17 / MIT+CC0）
30. [kubernetes/hack/verify-codegen.sh](https://github.com/kubernetes/kubernetes/blob/master/hack/verify-codegen.sh) — 2026-09-07 — [二手]（仅见于搜索结果，未打开文件内容） — §3.1（regenerate-and-diff 模式的出处，作为观察引用，不作论据）

---

自评：我最没把握的三个判断是 ① **「Alan 现阶段一个索引都不该装」**——这条建立在"他对自己代码熟、痛点不在召回"的推断上，而我没有他的仓库规模与实际提问分布，如果他的项目已经跨 Python/TS 两栈且边界频繁出问题，L1.5 的自建地图应该立刻上而不是"可选"；② **SCIP 在一人场景下的可用性**——我确认了格式与治理，但**没查到任何轻量本地消费者**，如果确实不存在，我在 L2 里给 SCIP 的位置是虚的，整段 L2 建议需要重写；③ **各宿主 LSP 的失效可见性**——我按"LSP 无持久产物所以无对账义务"给它开了绿灯，但如果 Claude Code 的 LSP 工具在语言服务器挂掉时会静默退化为 grep 而不报错，那它就变成了一个"看起来精确、其实是文本匹配"的假权威，这条必须由 Alan 一手实测推翻或确认。
