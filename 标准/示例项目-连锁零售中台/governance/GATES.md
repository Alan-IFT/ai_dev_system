# 闸门合同

每道门是合同不是清单：身份、范围、检查器、通过条件、失败去向、谁能豁免、怎么发现它失效。**没配置的门记 UNDETERMINED，不记跳过。** 豁免与跳过留同样的记录（见 `exceptions.md`），超期自动失效。

| 门 | 生效范围 | 检查器（命令见下方「命令」节） | 通过条件 | 失败去向 | 豁免人 | 失效探测 |
|---|---|---|---|---|---|---|
| G1 格式化 | 每次提交 | `format` | 无 diff | 自动修，重跑 | 无需 | CI 日志有该步 |
| G2 静态检查 | 每次提交 | `lint` | 0 error | 修；绕过须 PR 说明 | 无 | 同上 |
| G3 单元测试 | 每次提交 | `test_unit` | 相关判据通过；遗留失败有单独记录，新增回归可检出 | 修实现或有依据地修测试，不得弱化验收使其变绿 | 无 | 变异测试月度抽样 |
| G4 集成测试 | 合并前 | `test_integ` | 全绿 | 修 | 无 | 同上 |
| G5 构建 | 合并前 | `build` | 成功且无新告警 | 修 | 无 | — |
| G6 依赖审计 | 合并前、每周 | `deps_audit` | 按 `docs/operations/RISK-maintenance.md` 完成适用风险判定及处置，无未解决的阻断风险或过期例外 | 补证、修复/缓解；有权人限时接受风险，不能将接受写为漏洞消失 | Zhao | 周报有该项 |
| G7 密钥扫描 | 每次提交 | `secrets` | 0 命中 | 停止，撤销凭据 | 无 | 反例仓库月度跑 |
| G8 验收对账 | 工作项 `done` 前 | 人工：工作项证据段 | 声明的验收 ID 全有六字段证据 | 补证据或降低声明 | 无 | 巡检：`done` 无证据段即报 |
| **G9 依赖规则** | 每次提交 | `check_deps` | 允许矩阵之外 0 违反 | 阻断；例外走 exceptions.md | 架构负责人 | 反例：故意加一条跨层 import，须 FAIL（月度） |
| **G10 契约** | 合并前 | `check_contracts` + 契约测试 | 提供方/消费方测试全绿；消费者登记 = 代码引用 | 阻断 | 无 | 反例：改一个事件字段名，须 FAIL |
| **G11 文档新鲜度** | 每迭代 | `check_docs` | 模块 `source_rev` 落后 ≤ 8 次相关提交 | 报告；连续两迭代未对账转阻塞 | Zhao | 输出含每模块的落后数（空输出记未定） |
| **G12 交接完整性** | 每次会话结束 | `check_handoff` | 最新交接含 HEAD、分支、`state_revision`、下一原子动作 | 拒收交接 | 无 | 反例：删掉 HEAD 行，须 FAIL |
| **G13 回执对账** | 每日及未知写结果后 | `check_receipts` | 按稳定动作 ID 核对预期动作、接收方实际效果与回执；无缺失/额外/重复或结果不一致，未知单列 | 停止依赖写并对账；确认影响按事故流程 | 无 | 注入总数相等但漏一笔/重一笔的反例；检查须能检出 |

## 命令

**全部从仓库根执行。** 上表「检查器」列里的名字就是这里的名字；本节是这些命令的唯一位置，别处写链接不抄命令行。

| 名字 | 命令 | 备注 |
|---|---|---|
| `setup` | `make setup` | |
| `dev` | `make dev` | 起 api + web + 依赖容器 |
| `format` | `ruff format . && npm -w apps/admin-web run format` | G1 |
| `lint` | `ruff check . && mypy services packages && npm -w apps/admin-web run lint` | G2 |
| `test_unit` | `pytest tests/unit -q` | G3 |
| `test_integ` | `pytest tests/integration -q --maxfail=5` | G4；需要 `dev` 起的容器 |
| `test_e2e` | `npm -w apps/admin-web run e2e` | 不设门，发布前人工跑 |
| `build` | `make build` | G5 |
| `migrate` | `alembic upgrade head` | prod 由发布流程执行，agent 不直接跑 |
| `deps_audit` | `pip-audit && npm audit --audit-level=high` | G6 |
| `secrets` | `gitleaks detect --no-banner` | G7 |
| `check_deps` | `python tools/check_deps.py` | G9 |
| `check_contracts` | `python tools/check_contracts.py` | G10 |
| `check_docs` | `python tools/check_docs_fresh.py` | G11；判据是模块 `source_rev` 落后 ≤ 8 次相关提交 |
| `check_receipts` | `python tools/check_receipts.py --env staging` | G13 |
| `check_handoff` | `python tools/check_handoff.py` | G12 |

`tools/check_*.py` 的脚本实现不含在本示例里（见 `../tools/README.md`）。不适用的检查写 reason，不删掉这一行。

## 来源

运行目标、恢复与安全的验收入口见[运行维护演练包](../docs/operations/README.md)。新增检查只有在真实项目配置执行点、证据与授权后才成为该项目闸门；本示例没有实际执行的生产闸门。

- G1–G8：标准 01 §5.6 默认集
- G9：F-011（2025-09，reporting 直接 import 了 inventory 的 ORM）
- G10：F-019（2025-12，契约 v2 直接改 schema 两个消费者崩）
- G11：F-013（2025-10，pricing 模块文档折扣顺序与代码相反）
- G12：F-021（2026-01，交接无 HEAD，在错分支验证）
- G13：F-017（2025-11，库存双扣）

## 检查器验收记录

每个 `tools/check_*.py` 上线时的四步验收（验字节 / 断言待替换串存在 / 反例测试 / 全仓误伤）记录在 `tools/README.md`。F-026 是 `check_deps` 曾恒 PASS 的记录。
