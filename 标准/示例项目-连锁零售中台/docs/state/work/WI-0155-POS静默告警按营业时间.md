# WI-0155：POS 门店静默告警阈值按营业时间配置

work_item_id：WI-0155　state_revision：6　updated_at：2026-09-01
状态：**blocked**　负责人：Zhao　变更级别：常规

## 工作区身份

- repository：`github.com/example/retail-core`　branch：`main`（未开分支）
- HEAD：—　目标环境：prod

## 目标与范围

- 目标：POS-009 的静默告警按门店营业时间判断，消除夜间门店误报（现每天约 6 条）。
- 范围内：identity 门店加营业时间字段；pos-gateway 告警判定读该字段；厂商 B 门店营业时间来源。
- 范围外：告警渠道；SLO 变更。

## 验收映射

| acceptance_id | 主张 | 目标环境 | 证据 |
|---|---|---|---|
| POS-009 | 营业时间外不告警；营业时间内 30 分钟静默告警 | prod | — |

## 上下文

- 必读：`docs/architecture/modules/pos-gateway.md#配置与开关`、`#可观测性`；`docs/decisions/README.md`（ADR-0015 draft）；`docs/product/acceptance/POS-对接.md#POS-009`
- 条件读：`docs/runbooks/RB-03-POS流水回传中断.md`
- 本次不变量：不改告警渠道；不改 SLO

## 阻塞

- **缺失条件**：① 厂商 B 未提供门店营业时间接口（涉及门店数见 [STATUS.md](../STATUS.md)），人工维护 vs 接口拉取需裁定；② ADR-0015 仍 `draft`——营业时间字段放 identity 还是 pos-gateway 的 `vendor_adapter_state` 未定。
- 影响：夜间误报持续；值班疲劳。
- 解除方式：Zhao 裁 ADR-0015（建议放 identity，因为结算与报表也要用）；厂商 B 2026-09-15 前答复。
- 责任人：Zhao　复查：2026-09-15
- 临时缓解：告警规则加 23:00–07:00 静音（全局），2026-07-10 起。**这是豁免不是修复，但未登记到 exceptions**（F-032）——本周补 EX-007，见候选沉淀

## 状态转换记录

| from → to | 时间 | 执行者 | 依据 | 三态 |
|---|---|---|---|---|
| planned → in_progress | 2026-07-08 | Zhao | POS-009 frozen；F-028 | — |
| in_progress → blocked | 2026-07-10 | Zhao | 厂商 B 无接口；ADR-0015 未裁 | — |
| （周巡检） | 2026-08-04 / 09-01 | 巡检脚本 | 仍 blocked，复查日更新 | — |

## 候选沉淀

- 全局静音是豁免，应登记到期——**已发现未登记**（本工作项自己的疏漏），2026-09-08 补 EX-007 并绑 F-（登记为失败：豁免未留记录）
