---
id: ARCH-DEPS
status: active
owner: Zhao（架构）
updated_at: 2026-05-12
---

# 依赖规则

机械检查：`python3 tools/check_deps.py`（CI 阻断，G9）。规则本体是下面的矩阵；本文以外任何地方的"应该"都不算数。

## 分层

`interface` → `application` → `domain` → `platform`。只允许向下依赖。`platform` 不依赖任何业务模块。

## 允许依赖矩阵（行依赖列）

| 行 \ 列 | platform | identity | catalog | pricing | supplier | inventory | member | settlement | pos-gateway | import-export | reporting | notification |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| identity | ● | | | | | | | | | | | |
| catalog | ● | ● | | | ○¹ | | | | | | | |
| pricing | ● | ● | ● | | | | | | | | | |
| supplier | ● | ● | ● | | | | | | | | | |
| inventory | ● | ● | ● | | | | | | | | | |
| member | ● | ● | | | | | | | | | | |
| settlement | ● | ● | ● | ● | ● | ● | | | | | | |
| pos-gateway | ● | ● | ● | ● | | ● | ● | | | | | |
| import-export | ● | ● | ● | ● | ● | ● | | | | | | |
| reporting | ● | ● | ● | ● | ● | ○² | ● | ● | | | | |
| notification | ● | ● | | | | | | | | | | |
| api-gateway | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| admin-web | （只经 api-gateway） | | | | | | | | | | | |

● 允许（只经公开 API / 事件）　○ 同层或例外，见注

1. `catalog → supplier`：同层。只读供应商 ID 存在性（`supplier.exists(id)`），方向 catalog → supplier，登记于 2025-04-20，永久。
2. `reporting → inventory`：例外 EX-004，精确到文件，到期 2026-10-31。

## 禁止项

- 任何模块 import 另一模块的 ORM 模型或直接查询其 schema（INV-02）
- 循环依赖
- `domain` 依赖 `application` / `interface`
- 通过 `packages/common` 偷渡业务依赖：`common` 只放无业务语义的工具

## 例外流程

写进 `governance/exceptions.md`，带到期；`check_deps` 读该文件的白名单；到期未清理 CI 转红。

## 来源

ADR-0001；F-011（`reporting` 直接 import `inventory` ORM）；F-026（检查器曾恒 PASS）。
