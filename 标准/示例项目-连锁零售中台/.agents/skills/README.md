# 方法库（skills）

`.agents/skills/<name>/SKILL.md`，Claude Code 经 `.claude/skills` 符号链接读同一目录。**description 常驻，正文命中才读。** 只有人能写；新增须绑 F- 与删除条件。预算 20 个，现 11。

| skill | description（常驻的那一句） | 来源 |
|---|---|---|
| delivery-gates | 交付门与证据六字段。宣布"做完了/测过了"、提 PR、写完成报告前必读 | 标准 01 §5.6 |
| testing | 先红后绿、证明修复的测试不由修复者改、覆盖率不作门、flaky 处置 | 标准 01 §5.2；F-006 |
| code-review | 生产者≠验证者、单人项目独立会话自审、评审看什么 | 标准 01 §4.4 |
| commit-and-version | 提交格式、`WI:` 尾注、SemVer、分支短命 | 标准 01 §5.1 |
| security | 最小权限、凭据、输入校验、依赖 | 标准 01 §5.7 |
| observability | 结构化日志、SLO、告警、复盘 | 标准 01 §5.8；F-028 |
| failure-log | FAILURES 登记格式、三条同形下沉、减法 | 标准 01 §4.6 §4.7 |
| [takeover](takeover/SKILL.md) | 无交接接手：测绘 → 反例注入 → 只补缺失 → 照单演练 | 标准 03 §8.4 |
| [inventory-migration](inventory-migration/SKILL.md) | 本项目 expand/contract 迁移的具体步骤、回读校验、共存期监控 | ADR-0007；WI-0142 |
| [pos-adapter](pos-adapter/SKILL.md) | 新增 POS 厂商适配器：接口、幂等键、契约测试、证书 | ADR-0012；F-023、F-028 |
| [import-template](import-template/SKILL.md) | 导入模板版本、四类拆分、导出列顺序 | CAT-011；F-012、F-015、F-029 |

前七个是通用的（来自标准模板，按项目微调），后四个是本项目特有的。本示例展开后四个。
