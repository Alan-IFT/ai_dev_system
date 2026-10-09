# 例外登记

本表登记 `check_all` 报出的**未定项**（`UNDETERMINED`），格式按 `tools/std/CONTRACT.md` §9 与 01 §8 的必填项。登记不改结论：登记过的项仍是未定、仍逐条列在报告里、仍计入未定计数，变的只有退出码。规则列抄报告里那条发现的 `id`，工具按精确相等匹配；到期按运行日比较，过期即回到未登记。

登记行里不复述被登记的数值：本表也在 `single-authority` 的扫描面内，复述一次就多算一个文件（CONTRACT §9「已知边界」）。

| 编号 | 规则 | 理由 | 范围 | 批准人 | 到期 | 替代检查 | 复查条件 | 状态 |
|---|---|---|---|---|---|---|---|---|
| EX-001 | `single-authority/count-claim/14:个:部件` | 本检查器报出的位置删成指针后剩三处（D-112），各有作用、不是副本：架构确定是权威处；决策日志里是 D-043 的生效登记行，改写即篡改历史；templates 文件树是交付给采用方的唯一说法，交付面不得链回本仓 `docs/`，只能写值。 | `docs/架构确定.md`、`docs/决策日志.md`、`templates/文件树与落地路径.md` | Alan（项目所有者）2026-09-23 | 2027-03-02 | 改部件划分必走决策日志（D-043、D-047 的 blocks），届时三处随同一条决策一起改 | D-043 复核日到期；或部件划分有任何变动；或这组发现的出现位置多于上列三处 | active |
| EX-002 | `derived-artifacts/no-commit-time/skills/std-01-project-management.md` | 首次提交派生物 skills/ 时它还没有提交，git 取不到提交时间，陈旧与否按 N1 记未定；提交后即可取得，不是判据缺陷。一次性过渡，提交后立即删除本组行。 | `skills/std-01-project-management.md` | Alan（项目所有者）2026-10-09 | 2026-10-16 | 提交后重跑 `check_all`，该条应为通过；`scripts/check-skills-sync.mjs` 同步校验 | 首次提交 skills/ 的提交落地后；或到期 | active |
| EX-003 | `derived-artifacts/no-commit-time/skills/std-02-architecture.md` | 同 EX-002。 | `skills/std-02-architecture.md` | Alan（项目所有者）2026-10-09 | 2026-10-16 | 同 EX-002 | 同 EX-002 | active |
| EX-004 | `derived-artifacts/no-commit-time/skills/std-03-agent-context.md` | 同 EX-002。 | `skills/std-03-agent-context.md` | Alan（项目所有者）2026-10-09 | 2026-10-16 | 同 EX-002 | 同 EX-002 | active |
| EX-005 | `derived-artifacts/no-commit-time/skills/std-04-reliability-ops.md` | 同 EX-002。 | `skills/std-04-reliability-ops.md` | Alan（项目所有者）2026-10-09 | 2026-10-16 | 同 EX-002 | 同 EX-002 | active |
| EX-006 | `derived-artifacts/no-commit-time/skills/std-templates.md` | 同 EX-002；该派生物由多份模板拼成，每份模板各有一条同 id 的发现，一行登记覆盖全部。 | `skills/std-templates.md` | Alan（项目所有者）2026-10-09 | 2026-10-16 | 同 EX-002 | 同 EX-002 | active |
