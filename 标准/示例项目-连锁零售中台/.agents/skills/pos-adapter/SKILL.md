---
name: pos-adapter
description: 新增或修改 POS 厂商适配器时读：VendorAdapter 接口四个方法、幂等键必须由适配器给出且含日期、mTLS 证书登记、契约测试、上线清单。
---

# POS 厂商适配器

来源：ADR-0012；绑 F-023（跨日流水号重置）、F-028（厂商证书到期无告警）。删除条件：厂商统一到同一协议。

## 接口（`services/pos_gateway/adapters/base.py`）

`push(batch) -> PushReceipt`　`pull_sales(since) -> Iterable[Sale]`（或回调入口）　`health() -> Health`　`identity_of_sale(sale) -> str`（幂等键）

## 幂等键规则（PB-11）

- 由适配器给出，platform 不生成。
- 必含 `{vendor}:{date}:{vendor_ref}`——厂商 B 流水号跨日重置，不含日期会撞（F-023）。
- 推送侧 `push_job` 的幂等键 `{vendor}:{store}:{sku}:{version}`。

## 证书

- 我方给厂商的客户端证书与厂商回调我们的证书**分开登记**在 `pos.vendor_adapter_state`（指纹、到期日、最近一次成功握手）。
- 到期前 30 天告警——**厂商侧证书到期我们看不到**，RB-03 第一步永远是问厂商（F-028）。

## 上线清单

1. 契约测试：`tests/contracts/pos/test_<vendor>_adapter.py` 覆盖四个方法 + 幂等键格式 + 跨日样例。
2. staging 用厂商测试门店跑 24h：推送回执率 100%、回传 lag P95 < 5 分钟。
3. 登记表 `API-pos-sales` 消费者列加该厂商；`overview.md` 上下文图加边。
4. `check_receipts --vendor <v>` 跑通。
5. 死信重投是不可逆动作（门店立刻看到价格）——上线首周只人工重投。
