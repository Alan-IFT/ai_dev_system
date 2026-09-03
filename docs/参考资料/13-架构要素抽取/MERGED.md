# 跨来源合并统计（A/B/C/D/E 五批 → 一张表）

## 0. 去重与来源基数

原始行数 57（A 11 + B 11 + C 11 + D 11 + E 13）。按给定同源规则合并，**实际发生合并的只有 5 组**（其余 ATT-E～Q 未作为独立行出现在任一批次，只在卡片注里被指为同源，不重复扣减）：

| 合并 | 保留代号 | 扣减 |
|---|---|---|
| WX-23 = WX-21 = ATT-J（同文重发） | WX-21/23 | −1 |
| WX-36 = WX-18 = ATT-L（同文转载） | WX-18/36 | −1 |
| WX-39 ≈ ATT-D | WX-39 | −1 |
| WX-41 ≈ ATT-C | WX-41 | −1 |
| WX-44 ≈ ATT-A | WX-44 | −1 |
| WX-05≈ATT-Q / WX-08=ATT-P / WX-10=ATT-O / WX-16=ATT-N / WX-17=ATT-M / WX-22=ATT-K / WX-25=ATT-I / WX-26=ATT-H / WX-30=ATT-G / WX-32=ATT-F / WX-34=ATT-E | 各保留 WX 侧 | 0（ATT 侧未独立成行） |

**独立来源总数 N = 52。**（合并后的来源，其部件取两侧并集。）

> 遗留重叠提示：WX-43「Context Engineering 综述」与 ATT-B「Context Engineering 综合教程」七要素完全同构（提示词/历史/状态/记忆/检索/工具/输出约束），高度疑似同源；未在给定规则内，故仍按 2 个计。若合并则 N = 51。

**场景分桶（N=52，互斥；V1 一手单列，不再计入其业务场景）**

| 场景 | 数 | 来源 |
|---|---|---|
| 编码 Agent | 19 | WX-02,03,04,06,07,08,10,13,14,18,25,26,27,32,35,40,42,43,44 |
| 企业 Agent 平台 | 9 | WX-05,11,12,15,17,30,31,34,38 |
| 个人 | 6 | WX-01,09,22,41,INP-001,USR-OBS-12 |
| 对话 Agent | 3 | WX-16,19,39 |
| 基础设施/运行时/范式综述 | 7 | WX-20,21,24,28,29,SRC-COALA,ATT-B |
| 一手厂商文档（V1） | 8 | WX-33,37,SRC-OAI-HARNESS,SRC-ANT-LONG,SRC-ANT-CTX,SRC-OAI-EVAL,SRC-ANT-AGENTS,SRC-BORIS |

---

## 1. 部件频次总表（归一化名 → 独立来源数 / 52 → 场景拆分）

★ 词合并说明：`★知识/记忆治理` ＝ A 批`★知识新鲜度维护` + B 批`★记忆策展者` + C 批`★知识/记忆治理`（三者同指"准入·分级·过期·退场·晋升"）；`★Harness 配置分发与一致性` ＝ B 批`★配置分发与一致性` + C 批`★Harness 配置分发`。其余 ★ 词无同义项，保持原样。

场景列顺序：**编码 / 企业平台 / 个人 / 对话 / 基础设施 / 一手**

| # | 归一化部件 | 计数 | 编 | 企 | 个 | 对 | 基 | 一 | 典型原名 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 工具与执行环境 | 50/52 | 19 | 9 | 6 | 2 | 7 | 8 | MCP / 沙箱与 worktree / 确定性脚本与 CLI / Puppeteer·CDP / ACI 工具定义 |
| 2 | 执行者（Agent·子代理·节点） | 49/52 | 19 | 9 | 5 | 2 | 6 | 8 | 22 Agent、12 专家 Agent / tech-leader+6 子 Agent / planner-worker-judge / Agent Loop / initializer+coding agent |
| 3 | 上下文装配 | 47/52 | 17 | 8 | 6 | 3 | 6 | 7 | 渐进披露 L1/L2/L3 / Handoff+Artifact / JIT 检索 / compaction / Memory Pack + Token 预算 |
| 4 | 模型（LLM 本体·分档） | 42/52 | 18 | 6 | 2 | 3 | 6 | 7 | 冻结的推理引擎 / 评估模型≠编码模型 / 模型分层降本 / attention budget |
| 5 | 验证与测试 | 42/52 | 18 | 8 | 4 | 3 | 4 | 5 | 传感器/Inspector / 独立 reviewer / Surrogate+Oracle / 验证器节点 / ground truth |
| 6 | Skill/方法库（SOP·规则·Runbook） | 41/52 | 16 | 9 | 6 | 2 | 4 | 4 | Skills+斜杠命令+Plugins / Iron 铁律 Skill / rules.json / procedural memory |
| 7 | 证据与追踪 | 41/52 | 16 | 9 | 3 | 3 | 5 | 5 | 证据包/exit 0 / 事件日志 append-only / AgentLens+trace / sentinel+receipt / observability stack |
| 8 | 人（审批·验收·责任人） | 40/52 | 16 | 9 | 6 | 3 | 3 | 3 | 五个人工关卡 / INTERACTION_BOX 确认框 / humans above the loop / Verdict·Answerability·Accountability |
| 9 | 状态工件 | 39/52 | 16 | 8 | 4 | 2 | 4 | 5 | HANDOFF.md / e2e-state.json / state.json+delivery-log / feature list JSON + progress.txt / 检查点 S |
| 10 | 拦截与守卫（hook·门禁·gate） | 39/52 | 18 | 9 | 2 | 3 | 4 | 3 | Stop/PreToolUse Hook / 五道门禁 / verify-artifacts.sh / custom linter + merge gates |
| 11 | 项目知识（入口文件·契约·ADR） | 38/52 | 18 | 7 | 5 | 3 | 2 | 3 | CLAUDE.md / AGENTS.md 地图 + docs/ / 四层领域模型契约 / 知识库 L0-L4 / claim 六字段 |
| 12 | 评估与演进（eval·Thin·到期审计） | 38/52 | 17 | 7 | 2 | 3 | 5 | 4 | 评分 Skill / harness-audit / Add-Thin 循环 / 到期审计 + garbage collection / graders+eval runs |
| 13 | 任务拆分与调度 | 38/52 | 16 | 6 | 4 | 2 | 4 | 6 | P0–P6 管线 / 13 棒接力 / Wave 并行 / 图的节点与边 / orchestrator-workers |
| 14 | 意图与验收 | 34/52 | 18 | 5 | 5 | 2 | 1 | 3 | 全链路 SPEC / AC WHEN→THEN 冻结 / intent.md→spec.md / 200+ 特性清单 / 业务定义方向 |
| 15 | 权限与边界 | 34/52 | 14 | 7 | 4 | 2 | 3 | 4 | 四层自主权 / 危险工具清单 + 授权标记 / 有效能力五重交集 / Least Agency + 出站白名单 |
| 16 | 长期记忆 | 33/52 | 16 | 6 | 3 | 1 | 4 | 3 | 文档即记忆 / experiences+preferences / Skill Bank / Chat Memory L0–L3 / 五层个人记忆库 |
| 17 | ★知识/记忆治理（准入·分级·过期·退场） | 16/52 | 7 | 3 | 3 | 0 | 2 | 1 | staleness-checker + 增量再生 / Curator·Experience Manager / 准入双门禁 + 90 天重校验 / 强·弱·Shadow |
| 18 | 代码地图 | 12/52 | 9 | 0 | 1 | 0 | 0 | 2 | 代码导航地图 26KB / 三级知识库 + 五步定位 / graphify 代码图谱 / CodeGraph callers-impact |
| 19 | ★外部系统交接（Connector·工单回写·通知） | 9/52 | 6 | 2 | 1 | 0 | 0 | 0 | Connectors / TAPD·工蜂·企微 MCP / Hook-Callback 验收回写（另 WX-26/34/40/44 四例被并入"工具与执行环境"） |
| 20 | ★Agent 运行时框架（loop 宿主·插件·checkpoint） | 8/52 | 3 | 1 | 0 | 0 | 3 | 1 | Cordis/Fiber + Scope 链 / LangGraph 检查点 / L1"被 runtime 吸收" / loopforge 跨宿主 |
| 21 | ★触发与入口（定时·事件·Hook 进入） | 6/52 | 4 | 2 | 0 | 0 | 0 | 0 | Automations 心跳 / 告警源四类分流 / 外部事件进入工作流 |
| 22 | ★Harness 配置分发与一致性 | 6/52 | 3 | 2 | 0 | 0 | 1 | 0 | 私有插件市场 marketplace.json / team-harness→CI 同步 / shared→symlink+check-consistency / Skill registry 编译白名单 |
| 23 | ★事实溯源（来源·revision·scope·时间标签） | 6/52 | 1 | 0 | 1 | 1 | 1 | 2 | docs/ system of record / claim 六字段 / 保证来源类型表 / 版本绑定 Few-shot |
| 24 | ★监控与巡检（健康分析·告警·周期审阅） | 5/52 | 1 | 3 | 0 | 0 | 0 | 1 | Sweeper 活性巡检 / 晨间快照+晚间复盘 / Dreaming 跨会话巡检 / 1σ-2σ-3σ 分级响应 |
| 25 | ★发布与回滚 | 3/52 | 1 | 1 | 1 | 0 | 0 | 0 | 灰度 10%×7 天 + P0 自动回滚 / 灰度发布与回退 / 具名发布授权 + 回滚演练 |
| 26 | ★不确定性出口（追问·拒识·升级） | 2/52 | 0 | 0 | 0 | 2 | 0 | 0 | 追问/拒识/确认/执行四出口 / 人工升级出口 |
| 27 | ★结构化输出约束（schema） | 2/52 | 1 | 0 | 0 | 0 | 1 | 0 | 结构化输出要素（schema+示例）/ 输出约束类上下文 |
| 28 | ★推理引擎（算子·规约拓扑·确定性开关） | 1/52 | 0 | 0 | 0 | 0 | 1 | 0 | vLLM 算子 + VLLM_BATCH_INVARIANT |
| 29 | ★Harness 改进记录（Playbook） | 1/52 | 0 | 1 | 0 | 0 | 0 | 0 | Playbook（"怎么改 Agent"的经验，与任务记忆分离） |

---

## 2. 不可省略投票总表（明确写"没有它不行/不可省"的独立来源数）

| 部件 | 票数 | 最具代表性的两条原句 |
|---|---|---|
| 人（判断·授权·最终验收） | 21 | "任何不可逆动作前先让人点头"（WX-14）；"不会到期的是三类——只有你们知道的信息、只有人能承担的责任、评价者不能是被评价者本人"（WX-26） |
| 验证与测试（独立、可自动跑） | 16 | "先建 Inspector，再建 Loop……传感器就是设计本身"（WX-03）；"crucial for the agents to gain 'ground truth' from the environment at each step"（SRC-ANT-AGENTS） |
| 拦截与守卫（模型不可绕过的确定性边界） | 15 | "Hook 运行在 Agent 控制流之外——Agent 无法绕过也无法说服；安全边界不靠 prompt 保证"（WX-17）；"The constraints are what allows speed without decay or architectural drift"（SRC-OAI-HARNESS） |
| 证据与追踪 | 12 | "可监测性是信任 AI 的工程前提，而非运维锦上添花"（WX-04）；"Trace grading is the fastest way to identify workflow-level issues"（SRC-OAI-EVAL） |
| 状态工件（外置·唯一事实源） | 11 | "The key insight… claude-progress.txt file alongside the git history"（SRC-ANT-LONG）；"state.json 是唯一事实来源"（WX-06） |
| 项目知识（组织特有信息·System of Record） | 10 | "Agent 运行时读不到的东西等于不存在"（WX-10）；"需求与设计决策必须持久化进仓库"（WX-13） |
| 权限与边界 | 9 | "任何 DDL/DML 不允许 AI 自动执行，即使 Critical 修复也不例外"（WX-04）；"边界画在访问与动作上，不画在模型的指令上"（WX-40 引 Anthropic） |
| 意图与验收 | 9 | "Harness 落地第一步不是写 Rule 或拆 Agent，而是先形成团队共识的全链路 SPEC"（WX-07）；"分类的正确答案取决于业务当前的观察方向，这是模型无法从输入推出的"（WX-39） |
| 评估与演进 | 9 | "先建评测再写内容"（WX-26）；"评测可信度 > 系统复杂度——打错分＝学到错误经验污染后续"（WX-38） |
| 上下文装配 | 8 | "the smallest possible set of high-signal tokens"（SRC-ANT-CTX）；"正确意图未进入候选集，后续模型无法补救"（WX-19） |
| 任务拆分与调度 | 7 | "后一阶段输入必须等于前一阶段产出，跳阶段是越界主因"（WX-14）；增量工作是"critical"（SRC-ANT-LONG） |
| ★知识/记忆治理 | 6 | "沉淀靠人一定失败，必须绑死流程必经节点"（WX-31）；"团队记忆首先是治理系统"（WX-33） |
| 工具与执行环境（底座·ACI） | 4 | "缺的不是 AI 能力，而是专业开发预先搭好的企业级底座"（WX-15）；"Tool definitions deserve as much prompt engineering attention"（SRC-ANT-AGENTS） |
| ★Agent 运行时框架 | 3 | "可逆副作用是'一切皆插件、可热插拔'成立的前提"（WX-29）；"Graph 建立在前四层都做好了的前提上"（WX-21/23） |
| ★事实溯源 | 3 | "可信上下文、可执行约束、可恢复流程共同构成 Harness"（WX-44/ATT-A）；知识写入须保留来源、owner、审核（USR-OBS-12） |
| Skill/方法库 | 3 | "MCP、Skills、知识库三者缺一不可"（WX-13）；Skills→Knowledge Loss（WX-03 图 004） |
| 长期记忆 | 2 | "个人记忆必须属于本人并归本人管理，不绑定任何一个 AI 工具"（WX-41）；写入和晋升需要本人确认（同源 ATT-C） |
| 六组件整体（不可单独抽走） | 1 | "Remove any one. The loop still runs. Remove enough. It becomes dangerous."（WX-03 图 004） |

---

## 3. 失败归因总表（该部件缺失/失守被归因的独立来源数）

| 部件 | 来源数 | 主要失败形态（三条） |
|---|---|---|
| 验证与测试 | 32 | ①假通过：自评自信、生成者即评估者、空判决被当通过、"span 全 OK"≠做对；②假测试：恒真断言、篡改测试交差、覆盖率 0/0、银答案自证；③验证后置或不可分区：编译错误流到 reviewer、并行失败不可定位到文件（16 Agent＝1） |
| 上下文装配 | 29 | ①上下文腐烂与滚雪球：长会话污染、历史与原始工具返回逐轮重复计费、注意力衰减跳步；②压缩失真：自动压缩丢约束与"已失败尝试"、有损命令压缩滤掉关键命中且无回退；③加载失当：巨型入口文件"Too much guidance becomes non-guidance"、全量灌入、召回未命中/过期文档命中 |
| 拦截与守卫 | 28 | ①规则只写在文本被遗漏、门禁形同摆设"从未拦住真实问题"；②拦截器静默失效（字段名不一致、无匹配即放行、状态反推事件）；③无上限型停止：无轮次/预算上限导致发散烧光预算，或误报率高逼人绕过 |
| 状态工件 | 27 | ①跨会话失忆：重复已失败尝试、重复探索、从头重跑（无检查点）；②虚假完成与含糊输出：提前交卷、部分完成即宣布、blocked 未成状态、空 commit 无失败态；③交接整包传递或状态混在会话历史：不可恢复、缓存前缀失效、旧设计结论被冲掉 |
| 评估与演进 | 25 | ①评估器本身没被验证：判分器格式错 0→98、Kappa 低、评测集泄漏与过拟合、无同预算对照；②规则只增不减：Skill 膨胀走神、规则表只增不减、到期脚手架成 dead weight；③指标错位：只报总量掩盖分阶段回升、以条目数/自评为指标、修错层复发 |
| 权限与边界 | 23 | ①越权改动：越权改协议、审查顺手改码、方案 Agent 偷改验收标准、Agent 扩大自身权限文件；②隔离缺失：并行写同一工作区、allowlist 累积、子代理继承全部工具 Schema；③声明式权限不覆盖真实面：无规则匹配默认放行、通信对象维度缺失（经 Slack 委托他人推送） |
| 证据与追踪 | 22 | ①静默丢失：扇入丢一路、span 队列满丢弃、副作用不可见；②摘要/声明替代证据：Summary substitution、信 stdout 误判、指标自报与过程记录矛盾；③事实源自身撒谎：覆盖率混显、配置声明与实际路径不符、裁剪后提示词不可辨 |
| 项目知识 / ★知识新鲜度 | 21 | ①过期知识比没有知识更危险：调老接口链路通但结果错、旧契约当生效、废弃接口污染知识库；②第二事实源与漂移：根索引与模块漂移、规则多处重复、文档与代码不一致；③派生物责任未标：手改生成物、路径硬编码失效 |
| 人 | 19 | ①过度信任与认知投降：AI slop 无全局审核、"廉价习得感"导致审查失效；②带宽耗尽：验收积压 49 项/响应 0s、审核疲劳变橡皮章、弹窗密度导致绕过 Harness；③人的刹车被自动化拆掉：人只看结果不审文档，自动追加规则无人把关 |
| 任务拆分与调度 | 19 | ①不可分割任务被并行：互相覆盖、改同一入口文件；②编排结构本身耗成本：编排者每站重读、单体 Agent 无重置时机、扁平多 Agent 装忙；③流程失效：跳阶段越界、催促活锁、triage 误分类与死锁、返工不撤销下游 |
| 工具与执行环境 | 18 | ①确定性任务交给模型：拼错命令、模型做数值分桶、生成脚本末端才暴露；②工具接口设计差：工具集臃肿、功能重叠选错、相对路径/diff 格式、Puppeteer 看不到原生 alert；③环境未就绪或坏环境上叠加改动 |
| ★知识/记忆治理 | 11 | ①半成品入池、只进不出信噪比下降；②过期规则仍被召回、旧 Few-shot 把结果拉回旧分类；③"有关系"被判"同一问题"、置信层级缺失 |
| Skill/方法库 | 11 | ①补丁式规则落笔即错、每错加一条导致膨胀；②隐性冲突静默择一、否定指令失效；③旧命令/旧补丁残留成噪声（模型升级后） |
| 长期记忆 | 10 | ①经验留在个人头脑重复踩坑；②自动 Memory 串扰、规范放会话记忆腐化；③归属绑定单一工具、过期与冲突无检测 |
| 模型（依赖模型自觉） | 8 | ①prompt 是软约束、训练先验压过上下文用废弃 API；②模型不擅数值/幂等；③Skill 与生成模型耦合导致迁移退化 |
| 代码地图 | 4 | ①重复造轮子、改错子仓库；②定位错模块；③结构工具用于多点 path:line 任务反而 +152.9% 成本 |
| ★外部系统交接 | 3 | ①双通道写审计不一致、重跑灌重复关联；②MCP 不支持配置集群导致链路断裂；③只读接入只能建议不能交付 |
| ★监控与巡检 | 4 | ①静默卡住（掉线/孤立/无 Agent Task）；②关键事项被淹没、交接断档 3–5 天无人感知；③闭环静默退化、对齐漂移无方向性监控 |
| ★Agent 运行时框架 | 2 | ①坏插件废掉恢复用界面、半初始化残留；②runtime 的压缩/限额不可干预（11 小时/203 次压缩空转） |
| ★触发与入口 | 2 | ①无触发则永不启动；②靠人触发形成瓶颈、积压 issue |

---

## 4. 共现关系总表（跨批 ≥3 独立来源的"A → B 提供 X"，降序）

| A → B 提供 X | 来源数 | 来源 |
|---|---|---|
| 拦截与守卫 →执行者/阶段：动作或阶段转换前阻断，回显原因或注入修复指令 | 29 | 01,02,04,06,07,08,11,12,13,14,15,17,18,19,21,25,28,29,30,32,34,38,39,40,42,44,OAI-HARNESS,ANT-AGENTS,INP-001 |
| 证据与追踪（trace/记账/日志）→评估与演进：作为回归 Case、Thin、到期审计的输入 | 28 | 01,02,04,05,07,10,11,13,14,15,16,18,20,24,26,30,31,32,33,34,37,38,42,44,OAI-EVAL,OAI-HARNESS,BORIS,USR-OBS-12 |
| 项目知识（短入口/索引）→上下文装配：按需拉取正文而非全量推送 | 24 | 01,02,05,06,07,09,10,13,14,15,18,25,26,27,29,30,33,40,41,43,44,OAI-HARNESS,ANT-CTX,ATT-B |
| 独立验证者（与生成者隔离）→调度/放行：pass-fail 判定 + 定位反馈或打回 | 22 | 03,04,05,06,08,10,11,13,14,15,17,20,21,26,27,28,33,40,42,44,ANT-AGENTS,OAI-HARNESS |
| 评估与演进（失败/评测）→Skill·项目知识·规则：增删规则（Add/Thin、绑定失败） | 22 | 01,02,05,07,10,13,14,16,20,24,26,29,30,31,38,40,42,44,BORIS,OAI-HARNESS,USR-OBS-12,ATT-B |
| 拦截与守卫/监控 →人：超限、门禁失败、告警升级到人裁决 | 21 | 04,06,07,08,11,12,15,17,19,21,25,29,30,33,34,38,39,40,42,ANT-AGENTS,INP-001 |
| 工具与执行环境 →执行者：环境 ground truth 回读（截图/运行观察/receipt/exit 码） | 21 | 04,08,10,12,14,15,21,22,27,29,30,32,33,37,40,42,44,OAI-HARNESS,ANT-LONG,ANT-AGENTS,COALA |
| 状态工件 →执行者/调度：新会话或每轮先读状态工件，不回放对话 | 20 | 02,03,05,06,07,08,10,11,14,18,21,28,29,30,32,43,44,ANT-LONG,ANT-CTX,INP-001 |
| 人 →意图与验收：确认/冻结需求、验收标准、方案（下游不得再理解一遍） | 19 | 01,04,06,07,08,11,13,14,15,22,26,30,33,39,40,42,44,INP-001,USR-OBS-12 |
| 脚本/程序 →执行者：确定性判断先做，模型只判残余（"能沉降到工具层的别留在指令层"） | 18 | 04,06,12,14,15,18,21,25,26,27,32,34,35,39,42,44,USR-OBS-12,ATT-A |
| 子执行者 →主执行者/下游：只回结构化摘要或短交接，原始数据不回灌 | 18 | 02,04,05,07,08,09,17,18,21,25,28,30,32,40,43,ANT-CTX,ANT-AGENTS,ATT-B |
| 人 →权限与边界：不可逆/发射类动作只能由人触发或审批 | 17 | 04,08,12,13,17,19,21,25,26,28,29,30,38,39,40,42,ANT-AGENTS |
| 隔离（worktree/沙箱/干净上下文）→执行者：独立可写空间与独立判断 | 16 | 01,03,05,06,07,10,12,15,22,28,29,30,40,44,OAI-HARNESS,ANT-AGENTS |
| 状态转换/流程节点事件 →长期记忆·项目知识：自动提取候选并写回 | 15 | 02,04,06,27,30,31,32,33,38,40,41,42,44,OAI-HARNESS,ATT-C |
| 权限与边界 →执行者：范围/预算在会话或运行创建时固化，执行中只能收窄 | 15 | 02,06,08,13,18,21,26,28,29,30,33,38,40,44,OAI-HARNESS |
| ★知识/记忆治理 →项目知识·长期记忆：准入门禁、置信分级、过期退场 | 15 | 04,06,10,16,20,27,29,30,31,33,38,41,44,USR-OBS-12,ATT-C |
| ★外部系统交接 →调度/交付：事件进入触发，交付回写工单·PR·通知 | 14 | 01,02,03,04,05,06,07,08,11,26,31,34,40,44 |
| 上下文装配（压缩/驱逐）→状态工件·长期记忆：外部笔记/教训承接被驱逐内容 | 14 | 01,02,09,12,14,18,25,29,32,43,44,ANT-CTX,ANT-LONG,ATT-B |
| ★触发与入口 →调度/执行者：定时·事件·告警启动一次运行 | 13 | 03,04,05,06,10,11,25,31,34,38,40,44,OAI-HARNESS |
| 意图与验收（AC 清单）→验证与测试：用例由同一条目派生并回指编号 | 12 | 04,06,07,08,10,26,30,40,42,44,ANT-LONG,INP-001 |

---

## 5. 分层/演进模型总表（按"层的性质"归组）

**A. 范式阶梯型（时间/能力递进，层层包含）** — 12 源
WX-03/04/05/17/21-23/43 Prompt → Context → Harness → Loop（→ Graph）；WX-03 加"工作单位轴"（一次调用/一次会话/一个任务/持续系统），WX-05 加作用域（单 Turn/单 Session/跨 Session/∞），WX-21/23 加第五层 Graph；WX-43 PE ⊂ ReAct ⊂ CE；WX-10 金鱼—记事本—管理制度；WX-11 Prompt → Personal Loop → Work Loop；WX-19 八阶段（规则→ML→DL→Embedding→LLM→检索+LLM→状态跟踪→混合级联）；WX-39 Prompt 工程 → Harness；SRC-ANT-CTX "context engineering 是 prompt engineering 的自然延伸"；SRC-ANT-AGENTS augmented LLM → workflows → autonomous agents。

**B. 组件清单型（并列组件，不分先后）** — 10 源
WX-05 Harness 五组件 Guides / Sensors / Enforcement / Context Pipeline / Observability；WX-03+05 Loop 六要素 Automations / Worktrees / Skills / Connectors / Sub-agents / State；WX-13 六大支柱 上下文·工具·编排·状态记忆·评估观测·约束恢复；WX-43 Harness 四组件 Rules / Skills / Memory / Cases；WX-43 七要素（指令/用户提示/状态历史/长期记忆/检索/工具/结构化输出）＝ ATT-B 七类上下文；WX-11 三根骨架 + 六类能力；WX-44 三件事 可信上下文/可执行约束/可恢复流程（＝ATT-A）；WX-37 三问三数据；WX-21/23 图四要素 V/E/S/P；WX-40 五层 play 依赖图。

**C. 控制论型（控制器/执行器/传感器闭环）** — 4 源
WX-03 控制器 / 执行器 / 传感器 + 触发；WX-38 四齿飞轮 信号 → 积累 → 落地 → 控制；WX-31 飞轮 生产 → 治理 → 运营 → 消费；WX-21/23、WX-28 生产者 → 验证器 → 放行/打回（对抗式/多视角/评委制）。

**D. 资产类型型（按资产种类分工）** — 8 源
WX-07 六类资产 Rule/Skill/子 Agent/Workflow/门禁脚本/MCP；WX-02、WX-08 Command / Skill / Subagent（或 Agent）三级；WX-12 prompt 定意图 / Skill 定规矩 / Hook 定边界；WX-17 MCP 能力层 / Skills 编排层 / Hooks 边界层 / 多平台分发层；WX-40 三层约束 指令文件 / Skills / hooks；WX-33 四类资产 Chat Memory / LLM-Wiki / CodeGraph / Skill；ATT-A 文档&Rule（意图）→ 脚本（事实）→ Gate（阻断）；WX-25 常驻规则 vs 条件加载规则 + 子代理 vs 分支两原语。

**E. 知识/记忆分层型（按内容与生命周期分层）** — 11 源
WX-04 知识库 L0 产品概述 / L1 业务规范 / L2 技术规范 / L3 接口契约 / L4 需求演进（单向依赖）；WX-14 三级金字塔 L1 总览 / L2 模块登记表 / L3 领域语义桥；WX-33 Chat Memory L0–L3 + 置信三级 强/弱/背景；WX-41 五层 identity/principles/preferences/context/knowledge + L1–L5 权重（＝ATT-C）；WX-38 三层晋升 .learnings/ → MEMORY.md → skills/ + 三层存储 Skill/Facts/Episodes；WX-13 记忆四类 短期/中期/长期/变更；SRC-COALA working / episodic / semantic / procedural；WX-27 根索引 → 模块细节；WX-30 VFS 按信息生命周期分区（evidence/working/artifacts/shared/memory/checkpoints）；WX-09 三层存储 窗口/缓存/文件；WX-31 三层质量分级 可直接使用/待确认/待验证。

**F. 归属与到期型（谁拥有、何时该删）** — 6 源
WX-26 L0 模型本体 / L1 通用 agent 机制（被 runtime 吸收）/ L2 组织特有流程与工具 / L3 判断与授权（永不内化）＋三类不过期内容；WX-30 Surface → Control Plane → Enterprise Harness → 通用 Runtime 四层分离 + 联邦所有权 base→team→project→user；WX-08 组织级（分发覆盖）vs 项目级（升级不触碰）；WX-29 边界内（可逆）/ 边界外（只能暂缓或补偿）+ scope 链 全局→预设→会话；WX-44 可带走 vs 须重生；SRC-BORIS 模型升级 → 消融 → 按失败加回。

**G. 阶段流水线型（串行阶段与门禁）** — 12 源
WX-04 P0–P6；WX-06 Phase 0–8 + R/forking/joining；WX-07 13 棒接力；WX-08、WX-14 8 阶段；WX-02 8 阶段需求生命周期；WX-32 六角色接力；WX-34 九阶段流程模型；WX-39 五步 Harness；WX-40 六阶段 Plan/Design/Build/Test/Deploy/Maintain（+八节点环 + Governance 横切）；WX-44 feature-delivery 六阶段交接合同；WX-38 八环节 Agent CI/CD；SRC-ANT-LONG 两阶段（initializer → 同构 coding 会话）。

**H. 加载/披露分层型（何时装进上下文）** — 7 源
WX-18/36 Skill L1 目录 / L2 SKILL.md / L3 references+scripts；WX-01 常驻 / 按需 / 人工触发 / 打包分发；WX-16 Skill 四层 Global Rules / Core Methods / Execution Flow / Output Templates；WX-14 红线两级 Critical 启动 / Standard 按阶段；WX-33 路由五层（ACL → 固定绑定 → 浮动召回 → 装配 → Memory Pack）；WX-30 两阶段路由（预筛 → Top-K → LLM 精选）；SRC-ANT-CTX 预加载 → JIT → 渐进披露。

**I. 控制强度/约束力梯度型** — 6 源
WX-39（＝ATT-D）四级控制强度 定向归类 / 范围限定 / 优先推荐 / 语义归类；WX-44 约束力四级阶梯 提醒 / 提供工具 / 自动运行可继续 / 自动运行且阻断；WX-17 安全四级 pass-through / audit / warned / blocked；WX-07 硬门禁 vs 软门禁；WX-15 DB 变更风险三级；WX-38 分级自主 Level 0–3（人工占比 80/40/15/5%）。

**J. 评估/验证分层型** — 7 源
WX-13 验证四层 L1 编译 Lint / L2 单测 / L3 AI 合规 / L4 架构人+AI；WX-08 L0–L4 五层门禁；WX-02 L1 roundtrip / L2 静态分析 / L3 引擎+浏览器；WX-38 评测金字塔 规则/Judge/人工 + 三分法 train/val/test + 五层门控；WX-32 三层评价 局部输出/行动路径/整体结果；SRC-OAI-EVAL 三段 trace grading → datasets & eval runs → 外部 grader；WX-42 LLM 初审 → 执行验证 → 人复核（顺序不可倒置）。

**K. 成熟度/落地路线型** — 9 源
WX-05 L1+L2 → L3 → L4（含 1-3/3-6/6-12 月与退出阈值）；WX-07 Day1 SPEC → Week1 Skill → Month1 硬门禁 → Month2 拆 Agent → Month3 MCP → Month4+ 索引；WX-13 基础建设 1–2 周 → 工具接入 2–4 周 → 持续优化；WX-38 Phase 1–4；WX-30 演进四阶段；WX-34 数据可见 → 可信 → 异常定位 → 瓶颈挖掘；WX-31 三大范式转变；SRC-OAI-HARNESS 六段成长（脚手架 → 环境欠规范 → docs/ 知识库 → 应用可读性 → 熵管理自动化 → 端到端自治）；WX-11 三路径 A/B/C。

**L. 其它（单点/领域专用）** — 8 源
WX-24 确定性两级 run-to-run / batch invariance + 保证四等级；WX-09 会话生命周期 FRESH/DRIFT/ROT + 精确度金字塔；WX-29 Profile/bundle/patch + 事件三域 + 沙箱三档；WX-37 五层 span + 四级状态树 + 三种接入形态；WX-20 三类路线（存储型/RL/零数据）+ 出题者-解题者-总结者；WX-42 两种厚（提示词厚 vs 框架厚）+ 大环套小环；WX-06 编排权转移（AI 编排调脚本 → 脚本编排调 AI）；SRC-OAI-HARNESS 分层域模型 Types→Config→Repo→Service→Runtime→UI。

---

## 6. 一手（V1）与二手来源在部件强调上的差异

**一手厂商文档更强调的（SRC-OAI-HARNESS、SRC-ANT-LONG/CTX/AGENTS、SRC-OAI-EVAL、SRC-BORIS、WX-33、WX-37、DSH 文档）**

1. **工具与环境接口（ACI）本身是一等部件**：8 个一手源中 8 个都写工具与执行环境（8/8），且两处明确要求"工具定义应获得与 prompt 同等的工程投入"（SRC-ANT-AGENTS、SRC-ANT-CTX）；SRC-ANT-LONG 甚至把"Puppeteer 看不到浏览器原生 alert"作为独立失败项。二手极少把 ACI 单列，多把工具并入"MCP 接入清单"。
2. **减法**：一手主张删——"Too much guidance becomes non-guidance… It rots instantly"（OAI-HARNESS）、"smallest possible set of high-signal tokens"（ANT-CTX）、SRC-BORIS 直接删 80% prompt 并以消融+真实任务验证决定加回。二手中只有 WX-16/WX-26/WX-44 三源明确做减法，其余以"加清单"为主。
3. **日志/trace 是运行时不变量而非运维附属**：DSH "Model-visible ⟺ logged"（WX-29/37）、OAI-EVAL "trace grading 先于 dataset"、OAI-HARNESS 自建本地可观测栈供 Agent 查询。一手把可观测当"Agent 自己能读"的能力；二手多把可观测当"给人看的看板"。
4. **朴素状态工件而非复杂状态机**：SRC-ANT-LONG 的核心是 `claude-progress.txt` + `git log` + 一份特性清单 JSON；OAI-HARNESS 是 `docs/exec-plans/` + `tech-debt-tracker.md`。一手没有一处出现 P0–P6 式多阶段管线或 13 棒接力。
5. **人＝稀缺资源而非流程关卡**："Our one truly scarce resource: human time and attention"（OAI-HARNESS），人审可选、反馈被编码回 docs/tooling；SRC-ANT-AGENTS 只在 checkpoints/blockers 处要人。二手的"人"多是审批弹窗与验收签字。

**二手综述/实践帖更强调的**

1. **拦截与守卫的"防模型不听话"叙事**：偷懒/越权/失忆三类治理、Hook 9 步流水线、弹窗确认、四级安全分级、熔断与轮次上限——二手 44 源里 36 源写拦截，一手 8 源只有 3 源（OAI-HARNESS 的 linters/merge gates、OAI-EVAL 的 guardrails、ANT-AGENTS 的 gate）。
2. **多角色编排与阶段流水线**：P0–P6、8/9/13 阶段、Wave 并行、Graph 拓扑、Fan-out/屏障——与一手 SRC-ANT-AGENTS 的明示相反（"add multi-step agentic systems only when simpler solutions fall short"）。
3. **组织流程与外部系统交接**：TAPD/工蜂/蓝盾/企微/iWiki 的读写与回写、工单状态流转、MR 门禁——★外部系统交接 9 票全部来自二手，一手 0 票。
4. **知识库/团队记忆治理与"飞轮"**：准入双门禁、置信三级、90 天重校验、零引用归档、注入命中率看板（WX-31/33/38）——一手只有 OAI-HARNESS 的 doc-gardening + garbage collection 一条对应。
5. **成本与 Token 度量**：AgentLens 按 Wave 聚合、rtk 压缩、prompt cache 前缀、渐进披露的省钱动机（WX-18/36、WX-32）——一手谈上下文只从"注意力预算/质量"出发，8 个一手源无一以账单为优化目标。
6. **分层模型与阶梯图**：范式阶梯、成熟度路线、依赖图共 40+ 个模型基本来自二手；一手给的是具体工件名与不变量（AGENTS.md 约 100 行、progress 文件、Model-visible ⟺ logged）。

> 口径提示：一手 8 源中 WX-33/WX-37 为国内厂商一手，其强调点（ACL 先于检索、脱敏 waterfall、成本下钻）介于两类之间；SRC-BORIS 为视频访谈转述，仅按卡片计。二手对一手的转引存在系统性升格（WX-10、WX-21/23、WX-28 各有 3–5 处失真），故"二手投票数"不应视为独立证据的简单相加。
