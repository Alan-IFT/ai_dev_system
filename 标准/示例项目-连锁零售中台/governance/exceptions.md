# 例外登记

例外不是关闭闸门。每条：规则、理由、范围、批准人、替代检查、复查、到期。**到期未清理 CI 转红。**

| id | 规则 | 偏离 | 理由 | 范围 | 批准人 / 日期 | 替代检查 | 到期 | 状态 |
|---|---|---|---|---|---|---|---|---|
| EX-004 | G9 依赖规则 | `reporting` → `inventory` 同层直接读只读副本视图 `inventory_ro.*` | 事件投影尚未覆盖盘点差异表；建投影是 WI-0148 | 仅 `services/reporting/queries/stock_diff.py` | Zhao 2026-05-12 | `check_deps` 白名单精确到文件；WI-0148 完成即删 | 2026-10-31 | active |
| EX-006 | G6 依赖审计 | `openpyxl` 3.1.2 有 medium 级 CVE | 无 high；升级需改导入模板解析，排在 WI-0151 `done` 之后 | 全仓 | Zhao 2026-08-20 | 导入只处理内部上传文件，不处理外部来源 | 2026-11-20 | active |
| EX-007 | freshness/stale/docs/architecture/contracts/EVT-inventory-stock-changed.md | 契约 v1 文档久未更新 | v1 已冻结，v2 迁移见 WI-0142，内容稳定 | 该文件 | Zhao 2026-09-21 | v1 下线时删除本行 | 2026-12-31 | active |
| EX-008 | drift/work-item-missing/WI-0148 | STATUS 列了 planned 工作项而 work/ 无文件 | 示例只展开三份工作项 | docs/state/STATUS.md | Zhao 2026-09-21 | 无 | 2026-12-31 | active |
| EX-009 | drift/work-item-missing/WI-0157 | 同上 | 同上 | 同上 | Zhao 2026-09-21 | 无 | 2026-12-31 | active |
| EX-010 | drift/adr-index-missing/docs/decisions/README.md | 索引 15 行只有 4 份实物 | 示例只展开四份 ADR（README 第 30 行已说明） | docs/decisions/ | Zhao 2026-09-21 | 无 | 2026-12-31 | active |
| EX-002 | G11 文档新鲜度 | `notification` 模块文档 `source_rev` 落后 14 次 | 全是模板文案改动，不影响接口/边界 | `modules/notification.md` | Zhao 2026-06-03 | 下一迭代对账 | 2026-06-30 | **已过期，已处理**（2026-06-28 对账并更新 `source_rev`） |

已关闭的例外保留一行，状态写处理方式，不删。
