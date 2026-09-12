---
id: MOD-pos-gateway
status: active
owner: Zhao
updated_at: 2026-08-25
source_rev: f0a1b3e
---

# pos-gateway · POS 对接

独立部署单元（ADR-0012）：公网入口、mTLS、独立伸缩、独立发布节奏。

## 职责与边界

**负责**：把商品/价格/经营范围变更推送到各门店 POS（POS-001）；接收门店销售流水并调用 inventory 出库、member 积分（POS-003）；厂商适配器（A、B）；推送与回传的回执、重试、告警（POS-009）。

**不负责**：商品/价格本身（catalog/pricing 是权威，INV-05）；流水的业务解释（结算由 settlement 基于事件）；告警的投递渠道（notification）。

## 公开接口

| 契约 | 类型 | 方向 | 一句话 |
|---|---|---|---|
| `API-pos-push` v2 | 同步 API | 我方提供给厂商 | 商品/价格/范围下发 |
| `API-pos-sales` v1 | 同步 API | 我方消费（厂商回调） | 流水回传，按厂商流水号幂等 |
| `EVT-pos-sale-received` v1 | 事件 | 我方发出 | 每笔流水入账后一条（settlement、member、reporting 消费） |

## 依赖

- **依赖**：platform、identity、catalog、pricing、inventory、member；外部：POS 厂商 A、B
- **被依赖**：settlement、member、reporting（经事件）；api-gateway（推送面板）

## 数据所有权

`pos.*`：`push_job`、`push_receipt`、`sales_inbound`、`vendor_adapter_state`。独立连接池；与 `core` 不共享事务。

## 不变量

- INV-04：每个 `push_job` 有幂等键，厂商回执写 `push_receipt`；`check_receipts` 每日对账推送数 == 回执数
- 局部：同一厂商流水号只入账一次（`sales_inbound` 唯一约束）

## 配置与开关

- `pos.push_interval_minutes`：默认 15（CAT-002/POS-001 的时效来源）
- `pos.silence_alert_minutes`：默认 30（POS-009）；按门店营业时间的阈值在 WI-0155（blocked）
- 每厂商适配器的开关与版本：`vendor_adapter_state`

## 可观测性

- 指标：`pos_push_jobs_total{vendor,status}`、`pos_sales_inbound_lag_seconds{store}`、`pos_store_silence_minutes{store}`
- SLO：营业时间可用性 99.9%；回传 P95 ≤ 5 分钟
- 告警：门店静默 > 30 分钟（值班群）；推送回执缺失 > 10 个门店（值班群）
- 来源：F-028——2026-06-14 厂商 B 回调证书过期，4 小时无流水且无告警

## 已知坑

- 厂商 B 的流水号在跨日时会重置（F-023）——适配器 B 用 `日期+流水号` 作幂等键，别改回去。
- 推送失败重试三次后进死信；死信重投是**不可逆动作**（`AGENTS.md` §0），因为门店会立刻看到价格变化。
- mTLS 证书到期前 30 天有告警，但**厂商侧**的证书到期我们看不到（F-028）——runbook RB-03 第一步是问厂商证书。

## 相关决策

[ADR-0012](../../decisions/ADR-0012-POS接入用适配器层并独立部署.md)、ADR-0009

## 运行手册

[RB-03 POS 流水回传中断](../../runbooks/RB-03-POS流水回传中断.md)；RB-04 推送积压（未展开）
