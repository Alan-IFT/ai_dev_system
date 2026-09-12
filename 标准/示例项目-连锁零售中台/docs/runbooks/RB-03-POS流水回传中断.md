---
id: RB-03
status: active
owner: Zhao
updated_at: 2026-06-20
source_rev: f0a1b3e
---

# RB-03 · POS 流水回传中断

触发：门店静默告警（POS-009）或店长报"POS 正常但系统没流水"。来源：F-028（2026-06-14，厂商 B 证书过期 4h 无告警）。

## 0. 先判断范围（2 分钟）

```
python tools/pos_status.py --silent-since 30m
```
输出按厂商分组的静默门店。**全部是同一厂商** → 厂商侧问题（走 §1）；**单店** → 门店网络或 POS 本地（走 §2）；**跨厂商** → 我方入口（走 §3）。空输出先确认脚本能连 prod 只读副本（返回码 0、总门店数 60）。

## 1. 单一厂商全部静默

1. **先问厂商证书**（F-028 的根因，我方看不到厂商侧证书）：`openssl s_client -connect <vendor-callback-host>:443 | openssl x509 -noout -dates`——注意这是**厂商回调我们时用的客户端证书**，要看 `pos.vendor_adapter_state` 里记录的指纹是否与最近一次成功回调一致：`select vendor, last_ok_cert_fingerprint, last_ok_at from pos.vendor_adapter_state`。
2. 看我方入口日志：`kubectl logs -l app=pos-gateway --since=1h | grep -E 'tls|handshake|401|403'`。
3. 证书问题：联系厂商更新；我方 mTLS 信任链在 `k8s/pos-gateway/tls-trust.yaml`，更新是**不可逆动作**（需确认）。
4. 恢复后：厂商侧会补传缓存流水；观察 `pos_sales_inbound_lag_seconds` 回落；**补传按流水号幂等，不会重复入账**（PB-11；厂商 B 注意跨日）。
5. 对账：`python tools/check_receipts.py --env prod --vendor <B> --since <中断开始>`，差集为零才关闭事件。

## 2. 单店静默

1. 店长确认 POS 本地是否有"未上传"计数。
2. 门店网络：厂商侧有门店心跳面板（我方无）。
3. POS 本地缓存 ≥ 72h，超过前必须恢复；接近时升级到厂商。

## 3. 我方入口

1. `kubectl get pods -l app=pos-gateway`；`/health` 是否返回 `{version, migration_head}`。
2. RabbitMQ：`EVT-pos-sale-received` 队列积压？→ RB-04。
3. 回滚：上一版本镜像 tag 在 `releases/` 最新记录里；回滚是不可逆动作。

## 4. 关闭事件

- 静默告警自动恢复；对账差集为零；FAILURES 是否要新增一行（新形状才加）；本 runbook 是否要改（跑过的命令有没有失效）。

## 变更历史

- 2026-06-20 首版（F-028 复盘）
- 2026-07-10 §1 第 1 步加 `vendor_adapter_state` 指纹核对（上次排查靠猜）
