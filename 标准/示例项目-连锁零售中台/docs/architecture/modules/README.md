---
id: ARCH-MODULES
status: active
owner: Zhao（架构）
updated_at: 2026-08-25
---

# 模块文档

每模块一份，写代码里读不到的：职责边界、公开接口 ID、依赖与被依赖、数据所有权、不变量、坑、负责人。预算 200 行。`source_rev` 每迭代对账（G11）。

| 模块 | 文档 | 负责人 | `source_rev` | 上次对账 | 备注 |
|---|---|---|---|---|---|
| platform | modules/platform.md | Zhao | c41e9a7 | 2026-08-25 | |
| identity | modules/identity.md | Zhao | b7d2e10 | 2026-08-25 | |
| catalog | [catalog.md](catalog.md) | Li | e93a0f4 | 2026-08-30 | WI-0151 进行中，会再动 |
| pricing | modules/pricing.md | Li | 9f1c6b2 | 2026-08-25 | F-013 后每迭代必查 |
| supplier | modules/supplier.md | Wang | 4d8e7a1 | 2026-08-25 | |
| inventory | [inventory.md](inventory.md) | Zhao | a3f9c21 | 2026-08-25 | |
| member | modules/member.md | Zhou | 7c2b9d5 | 2026-08-11 | |
| settlement | modules/settlement.md | Wang | 2e6f4c8 | 2026-08-25 | |
| pos-gateway | [pos-gateway.md](pos-gateway.md) | Zhao | f0a1b3e | 2026-08-25 | 独立部署单元 |
| import-export | [import-export.md](import-export.md) | Li | e93a0f4 | 2026-08-30 | WI-0151 |
| reporting | modules/reporting.md | Wang | 5b9d2a7 | 2026-08-25 | EX-004 |
| notification | modules/notification.md | Zhou | 8a4c1e6 | 2026-06-28 | 曾 EX-002 |
| api-gateway | modules/api-gateway.md | Zhao | c41e9a7 | 2026-08-25 | |
| admin-web | modules/admin-web.md | Zhou | 1d7e5f3 | 2026-08-25 | |

本示例只展开四份（链接的）；其余在真实项目里同样存在，形态一致。

**这张表里的 `source_rev` 是 `check_docs_fresh` 的输入**，不是权威——权威是各文件头部；此表由脚本 `--list` 生成，人不手改。
