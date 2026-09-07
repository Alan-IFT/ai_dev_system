# AGENTS.md — retail-core 工作规范（常驻核）

**本文件只放"晚一秒就来不及"的规则。** 细则在 `.agents/skills/`，命中才读。标准版本见 `governance/STANDARD_VERSION`。

## 0. 项目专属

```yaml
项目名: retail-core（连锁零售中台）
一句话目标: 60 家门店的商品、采购、库存、价格、POS 对接、会员、结算、报表一体化
技术栈: Python 3.12 / FastAPI / SQLAlchemy / PostgreSQL 16 / Redis 7 / RabbitMQ 3.13；TypeScript 5 / React 18
跑起来: 见 governance/project.yaml 的 commands（不要从 README 抄命令）
有生产环境: 是（60 家店在线，日均 40 万笔流水）
含个人信息或凭据: 是（会员手机号；POS 厂商密钥）
几个人: 4（Alan 负责人；Li 后端；Zhou 前端；Wang 数据）
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
| 怎么跑、测、构建；栈与版本；兼容策略 | `governance/project.yaml` |
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
| 4 | 当前 `docs/state/work/WI-*.md`（STATUS 指定） | ● | ● | △ 请求者给定 | 停：没有工作项不开工 |
| 5 | 最新 `docs/state/handoff/*` | ○ | ● | △ | 无交接：先测绘（见 skill `takeover`） |
| 6 | `docs/INDEX.md` | ● | ● | ● | 可继续，不得猜路径 |
| 7 | 工作项"上下文"节列出的对象 | ● | ● | ● | 缺一项记未定 |

● 必读　○ 不读　△ 条件读

解析规则：路径精确到 `#片段`，片段外延到下一同级锚点为止；不递归展开链接；同一路径只读一次；合同/工作项/HEAD 冲突失败关闭。**默认不读**：全部模块文档、`FAILURES.md`、`releases/`、`artifacts/`、聊天历史。接手时对每个必读项多问一句：它上次被写、上次被读是什么时候。

## 3. 开工前八问：答不出就停

① 当前工作项与 `state_revision` ② 仓库/分支/HEAD/未提交改动 ③ 交付型还是事实型 ④ 从头还是接手 ⑤ 本次可触范围 ⑥ 本次禁止的动作 ⑦ 完成判据是哪几个验收 ID ⑧ 上次遗留项。

## 4. 不可逆动作：先问人，同意只对本次有效

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

每个结论 = 结论 + 成立条件。检查没跑/失败/超时、**输出为空**、生成者与验证者同一且涉及解释、外部写入结果未知、需人应答而没答——一律 `UNDETERMINED`，不折算为通过。"全部 X 通过"在 X 为空集时判 `UNDETERMINED`。报告三个数分列。

## 6. 停机条件：命中任一即停下报告

同一故障连续两次修复无效且无新证据（重试前改变一个输入变量并写下）· 超出 §3 第 ⑤ 项范围 · 需要 §4 动作而未获同意 · `UNDETERMINED` 挡在完成判据上 · 连续三次工具调用失败 · **发现自己在改测试而不是改代码** · 接手时某个必读项答不出"上次被写/被读"。

停机不是失败。带着"知道什么、不知道什么、下一步要什么"停下。

## 7. 收工前

证据六字段（断言 / 原始证据 / 版本与工作区身份 / 适用范围 / 观察时间 / 确认方法）缺一项声明无效 · 更新工作项与转换记录 · 写交接（会话结束与压缩同等对待）· 候选沉淀写进工作项，**模型自己的推断不作候选** · 影响整体认知的同步 STATUS。

## 8. 细则在 skill 里

`delivery-gates` `testing` `code-review` `commit-and-version` `security` `observability` `failure-log` `takeover` `inventory-migration` `pos-adapter` `import-template`——按 description 自取。**不确定要不要读，就读。**

## 9. 改本文件

新增一条必须同时写它防哪个 `F-` 编号与什么条件下删。只增不减是缺陷。本文件预算 150 行（现 96）。
