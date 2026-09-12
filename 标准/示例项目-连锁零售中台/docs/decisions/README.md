---
id: ADR-INDEX
status: active
owner: Zhao
updated_at: 2026-07-08
---

# 决策记录索引

只做索引，不复制内容。`draft` 不构成实施授权。

| ID | 标题 | 状态 | 日期 | 影响模块 | 文件 |
|---|---|---|---|---|---|
| ADR-0001 | 模块化单体而非微服务 | active | 2025-03-05 | 全部 | [ADR-0001](ADR-0001-模块化单体而非微服务.md) |
| ADR-0002 | PostgreSQL 单实例按模块分 schema | active | 2025-03-05 | platform, 全部 | ADR-0002 |
| ADR-0003 | 一品多码数据模型：barcode 多对一 sku | active | 2025-03-10 | catalog | ADR-0003 |
| ADR-0004 | RabbitMQ 作模块间事件总线，outbox 模式 | active | 2025-05-12 | platform, inventory | ADR-0004 |
| ADR-0005 | 导入两阶段：预览后提交，提交原子 | active | 2025-05-06 | import-export | ADR-0005 |
| ADR-0006 | 价格生效以事件为准，POS 不缓存价格逻辑 | active | 2025-06-20 | pricing, pos-gateway | ADR-0006 |
| ADR-0007 | 库存事件契约 v1→v2 采用 expand/contract | active | 2025-12-08 | inventory, reporting, pos-gateway, settlement | [ADR-0007](ADR-0007-库存事件契约v2-expand-contract.md) |
| ADR-0008 | 会员手机号列级加密 | active | 2025-10-14 | member | ADR-0008 |
| ADR-0009 | 幂等回执表与 outbox 作为全部外部写的基础设施 | active | 2025-11-24 | platform, 全部 | [ADR-0009](ADR-0009-幂等回执与outbox.md) |
| ADR-0010 | 报表基于事件投影而非直接查业务表 | active | 2025-09-15 | reporting | ADR-0010 |
| ADR-0011 | ~~POS 推送用轮询~~ | superseded → ADR-0012 | 2025-04-01 | pos-gateway | ADR-0011 |
| ADR-0012 | POS 接入用适配器层并独立部署 | active | 2025-09-01 | pos-gateway | [ADR-0012](ADR-0012-POS接入用适配器层并独立部署.md) |
| ADR-0013 | 团队化：CI 必需检查、CODEOWNERS、生效登记 | active | 2026-03-02 | governance | ADR-0013 |
| ADR-0014 | 电商订单不进本期，2027 再议 | active | 2026-03-10 | — | ADR-0014 |
| ADR-0015 | 门店静默告警阈值按营业时间配置 | **draft** | 2026-07-08 | pos-gateway, identity | ADR-0015（等 WI-0155 解阻） |

本示例展开四份。ADR 与 PLAYBOOK 的边界：有备选方案的是 ADR；"做 X 时注意 Y"的是 PLAYBOOK。
