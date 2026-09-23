---
name: inventory-migration
description: 在本项目做 schema 或事件契约的 expand/contract 迁移时读：三阶段每步的具体命令、回读校验怎么写进证据、共存期监控阈值、回滚。
---

# expand / migrate / contract 在本项目的具体步骤

来源：ADR-0007、WI-0142；绑 F-019。删除条件：迁移工具原生支持三阶段并给回读证据。

## 前置

- ADR `active`；工作项变更级别"高影响"；契约登记表消费者列已对账（`python3 tools/check_contracts.py --consumers <契约>`）。
- 切换顺序按回滚代价从低到高（PB-13）：投影类 → 网关类 → 结算类。

## expand

1. alembic 分支只在所有者模块下：`alembic revision -m "<WI> expand <表>" --head <模块>@head`。新列**可空**或有默认值；不删不改现有列。
2. 事件双发：outbox 写两条（v1、v2），v2 走新队列。
3. 提供方契约测试先红后绿。
4. **回读校验写进证据**：迁移后 `select count(*) ... where <新列> is null` 与预期一致；空输出前先断言表非空（PB-16）。
5. 共存期监控：RabbitMQ 内存 < 70%、`inventory_outbox_lag_seconds` P95 < 10s——超了先停发 v2（回滚 expand），不硬扛。

## migrate（每个消费者一次发布）

1. 消费者切到 v2 队列；消费方契约测试。
2. 幂等去重经 `platform.idempotency_receipt`，不自建。
3. 重放验证（INV-016）：`python3 tools/replay.py --consumer <c> --from <d> --to <d+1>`，比对快照差异为零，**先断言快照非空**。
4. 发布后 `check_receipts --event <契约> --consumer <c> --days 7` 差集为零才算该消费者 done。
5. 回滚：切回 v1 队列（v1 仍在发）。

## contract

1. `check_contracts --consumers <契约>@v1` = 0。
2. v1 队列 7 天投递数 0（`rabbitmqctl list_queues` 监控截图路径进证据）。
3. 告警期 7 天（通知所有模块负责人）。
4. 删 v1 发送代码与队列；登记表 v1 行标 `retired`；契约文件变更历史更新；四份模块文档 `source_rev`。
5. **删除是不可逆动作**，需确认。

## 不要做

- 一次提交同时改提供方 schema 与消费方解析（INV-07；F-019 就是这么死的）。
- 在 `core` 事务外直接 `basic_publish`（走 outbox）。
- 把"重放差异为零"当通过而不看快照行数（F-031）。
