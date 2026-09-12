# 示例项目：连锁零售中台 `retail-core`

这是一个**虚构但按真实规模写的**项目文档树，展示[管理](../01-项目管理标准.md)、[架构](../02-项目架构描述规范.md)、[Agent 上下文](../03-Agent信息获取与上下文管理.md)与[运行维护](../04-可靠性安全与运行维护.md)怎样落到项目工件。数字、日期、人名、提交号都是示例值，不能作为真实项目证据。原有历史快照保留当时场景；2026-09-08 补充运行维护计划，并修正活入口的三态和测试纪律。

## 项目背景

- **业务**：为一家 60 家门店的连锁超市提供商品主数据、供应商与采购、门店库存、价格促销、POS 对接、会员积分、供应商结算、批量导入导出、报表。
- **规模**：14 个模块，模块化单体 + 1 个已拆出的部署单元（POS 网关）；PostgreSQL 16 / Redis / RabbitMQ；Python 3.12（FastAPI）后端，TypeScript/React 前端；两个环境（staging、prod）。
- **时间**：2025-03-03 启动，2025-06-02 首发（12 家店），2026-09-07（"现在"）跑到第 18 个月，v2.4.0 在线。
- **人**：前 11 个月一人（Zhao）+ Claude Code；2026-03 起四人，其中一人用 Codex、一人用 Cursor。
- **AI 工具**：Claude Code 为主宿主；Codex 做独立验证会话；Cursor 由新成员使用。

## 怎么读这个示例

| 想看什么 | 去哪 |
|---|---|
| 18 个月里每个月发生了什么、文档怎么变、**旧做法会在哪一步死掉** | [维护时间线.md](维护时间线.md) |
| 一次高影响任务（契约破坏性变更）从开到关的每一步读什么写什么 | [一次任务的完整走法.md](一次任务的完整走法.md) |
| 一条反馈怎样进入后续任务，怎样验证、收窄或撤销 | [反馈跨任务生效演练.md](反馈跨任务生效演练.md)；待执行计划，含重复提醒、误归类和检查器停跑分支 |
| 工具入口长什么样 | [AGENTS.md](AGENTS.md) · [CLAUDE.md](CLAUDE.md) |
| 项目配置、闸门、例外 | [governance/](governance/project.yaml) |
| 文档地图 | [docs/INDEX.md](docs/INDEX.md) |
| 系统全景、模块、依赖、契约、不变量 | [docs/architecture/](docs/architecture/overview.md) |
| 决策记录 | [docs/decisions/README.md](docs/decisions/README.md) |
| 现在的状态、进行中的工作项、一份真实形态的交接 | [docs/state/STATUS.md](docs/state/STATUS.md) · [work/](docs/state/work/README.md) · [handoff/](docs/state/handoff/WI-0151-2026-09-05.md) |
| 项目特有做法与失败清单 | [PLAYBOOK.md](docs/knowledge/PLAYBOOK.md) · [FAILURES.md](docs/knowledge/FAILURES.md) |
| 故障手册、发布记录 | [runbooks/](docs/runbooks/RB-03-POS流水回传中断.md) · [releases/](docs/releases/v2.4.0.md) |
| 方法库（skills） | [.agents/skills/](.agents/skills/README.md) |
| 检查器清单 | [tools/README.md](tools/README.md) |
| 运行目标、恢复演练、灰度发布、维护与漏洞响应怎样串起来 | [运行维护演练包](docs/operations/README.md)；均为待执行计划 |

## 文档树

```text
retail-core/
├─ 反馈跨任务生效演练.md             教学计划，不改变下列历史工件
├─ AGENTS.md                       工具入口与唯一加载合同
├─ CLAUDE.md                       @AGENTS.md
├─ governance/
│  ├─ project.yaml                 档次、路径、预算、元信息范围（检查器读的唯一配置）
│  ├─ GATES.md                     G1–G8 + 项目自加的 G9–G13，及它们用的命令
│  ├─ exceptions.md                例外登记（带到期）
│  └─ STANDARD_VERSION             采用的标准修订与采用日期
├─ docs/
│  ├─ INDEX.md
│  ├─ product/
│  │  ├─ vision.md
│  │  └─ acceptance/  README · CAT-商品主数据 · INV-库存 · IMP-导入导出 · POS-对接
│  ├─ architecture/
│  │  ├─ overview.md · invariants.md · dependency-rules.md · data-ownership.md
│  │  ├─ modules/  README（14 行清单）· catalog · inventory · pos-gateway · import-export
│  │  └─ contracts/ README（登记表）· EVT-inventory-stock-changed · API-catalog-sku · FILE-新品导入模板
│  ├─ decisions/  README（索引）· ADR-0001 · ADR-0007 · ADR-0009 · ADR-0012
│  ├─ state/
│  │  ├─ STATUS.md
│  │  ├─ work/  README · WI-0142（done）· WI-0151（in_progress）· WI-0155（blocked）
│  │  ├─ handoff/ WI-0151-2026-09-05.md
│  │  └─ artifacts/（不进版本控制，只留 .gitkeep 与索引）
│  ├─ knowledge/  PLAYBOOK.md · FAILURES.md · glossary.md
│  ├─ operations/  README · SVC-inventory · DR-inventory · REL-inventory-next · RISK-maintenance
│  ├─ runbooks/   RB-03-POS流水回传中断.md
│  └─ releases/   v2.4.0.md
├─ .agents/skills/  README · takeover/ · inventory-migration/ · pos-adapter/ · import-template/
├─ tools/  README（check_deps · check_contracts · check_docs_fresh · check_receipts · check_handoff）
└─ services/ apps/ packages/ tests/（代码，本示例不含）
```

示例有选择地展开部分模块、决策与任务，其余只给索引形态；因此不是可运行的完整产品仓库。Agent 的实际读取量由任务判断需要决定，不由示例展开数量决定。`governance/STANDARD_VERSION` 记的是本示例当前采用的标准修订（`2026-09-12.1`）与 2025-03-03 的采用日期——展示的是现行形态，不是示例立项当年的取值。**本示例的叙事日期冻结在 2026-09-07**：`tools/std/check_all.py` 扫它时，按真实系统日期算出的陈旧类未定（文档/ADR 超 `stale_days`）与工作项活性 FAIL（`in_progress` 超 `work_item_stale_days` 无转换）都是预期结果，不随时间修——改阈值或平移日期都会把示例变成另一回事。
