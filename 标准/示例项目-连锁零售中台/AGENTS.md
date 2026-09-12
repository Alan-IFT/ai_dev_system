# AGENTS.md — retail-core 工作规范（常驻核）

**本文件只放"晚一秒就来不及"的规则。** 细则在 `.agents/skills/`，命中才读。标准版本见 `governance/STANDARD_VERSION`。

## 0. 项目专属

```yaml
项目名: retail-core（连锁零售中台）
一句话目标: 60 家门店的商品、采购、库存、价格、POS 对接、会员、结算、报表一体化
技术栈: Python 3.12 / FastAPI / SQLAlchemy / PostgreSQL 16 / Redis 7 / RabbitMQ 3.13；TypeScript 5 / React 18
跑起来: 见 governance/GATES.md 的「命令」节（不要从 README 抄命令）
有生产环境: 是（60 家店在线，日均 40 万笔流水）
含个人信息或凭据: 是（会员手机号；POS 厂商密钥）
几个人: 4（Zhao 负责人；Li 后端；Zhou 前端；Wang 数据）
本项目特有的不可逆动作:
  - 向 POS 厂商推送商品/价格（推出去门店立刻生效）
  - 供应商结算单确认（触发对账与付款流程）
  - 会员积分批量调整
  - 触发 RabbitMQ 队列清空或死信重投
```

填不出的写 `未定`。**留空 ≠ 未定**。

## 1. 权威位置：每类事实只有一处，引用写链接不抄值

| 事实 | 唯一位置 |
|---|---|
| 怎么跑、测、构建 | `governance/GATES.md`「命令」节 |
| 档次、路径、预算、元信息范围（检查器读的配置） | `governance/project.yaml` |
| 栈与版本；环境与拓扑；数据保留 | 本文件 §0 与 `docs/architecture/overview.md` §6/§7 |
| 兼容策略 | `docs/architecture/invariants.md` INV-07 与 `docs/architecture/contracts/README.md` |
| 要做什么、什么算完成（稳定 ID） | `docs/product/acceptance/*.md` |
| 项目现状、当前重点、阻塞 | `docs/state/STATUS.md` |
| 单个任务的实时状态 | `docs/state/work/WI-*.md` |
| 模块职责、边界、依赖、坑 | `docs/architecture/modules/*.md` |
| 契约（API/事件/文件格式）与消费者 | `docs/architecture/contracts/README.md` |
| 不变量 | `docs/architecture/invariants.md` |
| 为什么这样设计 | `docs/decisions/ADR-*.md` |
| 项目特有做法与坑 | `docs/knowledge/PLAYBOOK.md` |
| 出过的错 | `docs/knowledge/FAILURES.md` |
| 证据（测试/构建/部署结果） | CI 产物与 `artifacts/`；工作项只存指针 |
| 代码结构、依赖、配置 | **代码本身**——不写进文档 |

## 2. 加载合同（唯一一份）

先声明运行类型：**交付型 / 事实型 × 从头 / 接手**。判不清按"交付型·接手"。

| # | 精确路径 | 交付·从头 | 交付·接手 | 事实型 | 缺失时 |
|---|---|:---:|:---:|:---:|---|
| 1 | `AGENTS.md`（整份） | ● | ● | ● | 停 |
| 2 | `governance/project.yaml` | ● | ● | ● | 停 |
| 3 | `docs/state/STATUS.md` | ● | ● | ○ | 停，请求恢复状态 |
| 4 | 当前 `docs/state/work/WI-*.md`（STATUS 指定；轻量变更可用精确引用的简记） | ● | ● | △ 请求者给定 | 缺目标/范围/证据入口先补；不因省独立文件丢失任务记录 |
| 5 | 最新 `docs/state/handoff/*` | ○ | ● | △ | 无交接：先测绘（见 skill `takeover`） |
| 6 | `docs/INDEX.md` | ● | ● | ● | 可继续，不得猜路径 |
| 7 | 工作项"上下文"节列出的对象 | ● | ● | ● | 缺一项记未定 |

● 必读　○ 不读　△ 条件读

解析规则：实际加载前把表中的通配符和“当前/最新”解析成精确路径；片段的起止按主标准 03 的解析规则；不递归展开链接；同一片段只读一次；合同/工作项/HEAD 冲突先核对。**默认不读**：全部模块文档、`FAILURES.md`、`releases/`、`artifacts/`、聊天历史。接手检查来源版本及实际使用记录；无法知道历史读取时间只标未知，不据此中止无关工作。

## 3. 开工前八问：答不出就停

① 当前工作项与 `state_revision` ② 仓库/分支/HEAD/未提交改动 ③ 交付型还是事实型 ④ 从头还是接手 ⑤ 本次可触范围 ⑥ 本次禁止的动作 ⑦ 完成判据是哪几个验收 ID ⑧ 上次遗留项。

## 4. 受控动作：核对已有授权及其适用范围

下面是本示例项目的受控动作清单，部分动作可逆，仍需核对项目授权。已有明确授权且范围、环境、对象、期限仍适用时继续；超出或缺授权再询问。本文本不替代宿主权限系统，也不对本研究仓库生效。

- 删文件/分支/表/桶；`push --force`；有未提交改动时 `reset --hard`
- 写 prod：迁移、部署、回滚、改配置/DNS/IAM/密钥；写 staging 的迁移也要问
- schema 变更；无精确 WHERE 或影响 >1 行的批量写
- 发布：推镜像、打 tag、发 release
- 对外：发邮件/短信、向外部仓库提 PR、调用产生费用的 API
- 装新依赖、改锁文件、改 CI、改 `governance/`、改 `.agents/skills/`
- 改 `docs/product/acceptance/` 已冻结条目；覆盖或删除本文件 / `STATUS.md` / `FAILURES.md`
- **§0 的四项项目特有动作**

不在清单但可能不可逆的按不可逆处理：撤销要不要人工介入？要不要恢复备份？会不会被别人看见？

## 5. 三态：PASS / FAIL / UNDETERMINED

每个结论 = 结论 + 成立条件。有效检查确认违反判据为 `FAIL`；证据支持全部适用判据为 `PASS`；没跑、采集失败/超时、无法解释的空输出、解释性自证、外部写入结果未知为 `UNDETERMINED`。工具约定静默成功时须核对退出码及执行覆盖，不能仅凭空输出判断。空检查集记未定；报告三态与未定覆盖，不隐藏未知样本。

## 6. 停机条件：命中任一即停下报告

同一故障连续两次修复无效且无新证据（重试前改变一个输入变量并写下）· 超出 §3 第 ⑤ 项范围 · 需要 §4 动作而未获授权 · `UNDETERMINED` 挡在完成判据上 · 连续三次工具调用失败 · **为变绿而删断言、弱化验收或屏蔽有效失败**。新增回归测试、修正测试缺陷或已批准需求对应的测试可以执行，并记录依据与复核。

停机不是失败。带着"知道什么、不知道什么、下一步要什么"停下。

## 7. 收工前

证据六字段（断言 / 原始证据 / 版本与工作区身份 / 适用范围 / 观察时间 / 确认方法）缺一项声明无效 · 更新工作项与转换记录 · 写交接（会话结束与压缩同等对待）· 候选沉淀写进工作项，**模型自己的推断不作候选** · 影响整体认知的同步 STATUS。

## 8. 细则在 skill 里

`delivery-gates` `testing` `code-review` `commit-and-version` `security` `observability` `failure-log` `takeover` `inventory-migration` `pos-adapter` `import-template`——按任务触发条件读取。当前动作的安全、授权和验收前提必须先读；无关内容不因“可能有用”而加载。方法库旧摘要与当前标准矛盾时登记并按适用权威处理。

## 9. 改本文件

新增规则绑定真实失败或可追溯的风险依据，写适用范围与删除/重评条件，不伪造事故编号。只增不减是缺陷。本文件预算是项目参数；实际大小由文件测量，不手抄现值。
