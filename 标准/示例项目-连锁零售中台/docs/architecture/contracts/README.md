---
id: ARCH-CONTRACTS
status: active
owner: Zhao（架构）
updated_at: 2026-08-25
---

# 契约登记表

**消费者列是登记的权威位置，不能单独证明实际使用范围**：改契约前先查登记，再按代码、配置及运行证据核对，注明低频/外部消费者盲区；发现未登记消费者先补登记。对账候选入口：`tools/check_contracts.py --consumers`（G10）；示例未含脚本实现。登记为零不自动满足旧版本退出条件，按[主标准兼容迁移](../../../../02-项目架构描述规范.md#contract-migration)核验。

| 契约 ID | 类型 | 提供方 | 消费者 | 当前版本 | 兼容策略 | 状态 | 文件 |
|---|---|---|---|---|---|---|---|
| API-catalog-sku | 同步 API | catalog | pricing, inventory, supplier, settlement, pos-gateway, import-export, api-gateway | v1 | 加字段向后兼容；删字段走 MAJOR | active | [API-catalog-sku.md](API-catalog-sku.md) |
| EVT-catalog-sku-changed | 事件 | catalog | pos-gateway, reporting | v1 | 同上 | active | EVT-catalog-sku-changed.md |
| API-inventory | 同步 API | inventory | settlement, pos-gateway, import-export, api-gateway | v1 | 同上 | active | API-inventory.md |
| EVT-inventory-stock-changed | 事件 | inventory | reporting, pos-gateway, settlement | **v2** | v1 已下线（2026-02-20） | active | [EVT-inventory-stock-changed.md](EVT-inventory-stock-changed.md) |
| API-pricing | 同步 API | pricing | pos-gateway, settlement, import-export, api-gateway | v1 | | active | API-pricing.md |
| EVT-pricing-price-effective | 事件 | pricing | pos-gateway, reporting | v1 | | active | EVT-pricing-price-effective.md |
| API-pos-push | 同步 API（对外） | pos-gateway | POS 厂商 A、B | v2 | v1 保留至 2026-12-31；废弃通知期 90 天 | active | API-pos-push.md |
| API-pos-sales | 同步 API（对外，我方消费） | POS 厂商 A、B | pos-gateway | v1 | 厂商版本；适配器隔离 | active | API-pos-sales.md |
| EVT-pos-sale-received | 事件 | pos-gateway | settlement, member, reporting | v1 | | active | EVT-pos-sale-received.md |
| API-supplier | 同步 API | supplier | settlement, import-export, api-gateway | v1 | | active | API-supplier.md |
| API-member | 同步 API | member | pos-gateway, api-gateway | v1 | | active | API-member.md |
| API-settlement | 同步 API | settlement | api-gateway | v1 | | active | API-settlement.md |
| API-import | 同步 API | import-export | api-gateway | v1 | | active | API-import.md |
| FILE-新品导入模板 | 文件格式 | 商品部（外部人） | import-export | **v3** | v2 支持至 2026-12-31 | active | [FILE-新品导入模板.md](FILE-新品导入模板.md) |
| FILE-供应商报价 | 文件格式 | 供应商（外部） | import-export | v1 | | active | FILE-供应商报价.md |
| FILE-结算导出 | 文件格式（对外） | import-export（数据来自 settlement） | 财务软件 | v3 | 财务软件升级时联动 | active | FILE-结算导出.md |
| API-sms | 同步 API（外部，我方消费） | 短信网关 | notification | v1 | 厂商版本 | active | API-sms.md |
| API-notification | 同步 API | notification | 所有模块（经 platform 封装） | v1 | | active | API-notification.md |
| EVT-inventory-stock-changed **v1** | 事件 | inventory | （无） | v1 | — | **retired** 2026-02-20 | 见 v2 文件的变更历史 |

本示例展开三份（链接的）。

## 对账记录（最近三次）

| 日期 | 结果 | 处置 |
|---|---|---|
| 2026-08-25 | 登记 = 引用 | — |
| 2026-08-11 | `reporting` 引用了 `API-member`（未登记） | 登记；实际只读会员等级做报表，登记为消费者 |
| 2026-07-28 | 登记 = 引用 | — |
