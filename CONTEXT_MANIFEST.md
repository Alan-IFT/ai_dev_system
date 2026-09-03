---
contract_id: context-contract-research-001
contract_revision: 4
updated_at: 2026-09-02
status: proposal-demo  # 本合同自身仍是 D-015 的演示，D-015 未生效
current_work_item: null
---

# Default Context Contract

本文件是本仓库默认上下文的唯一清单，也是 D-015 的演示实现。它只组织理论讨论，不代表 D-015 已被接受，也不授权编写业务代码或执行高风险动作。

效力语义由 [D-014 规范效力元治理](docs/08-规范效力元治理.md)（已接受）定义。

<a id="required-context"></a>

## Required context

| 顺序 | 精确路径或片段 | 用途 | 缺失时处理 |
|---|---|---|---|
| 1 | `CONTEXT_MANIFEST.md#required-context` | 确认本合同版本和加载边界 | 停止并报告入口缺失 |
| 2 | `PROJECT_STATUS.md` | 当前里程碑、风险和下一步 | 停止并请求恢复状态 |
| 3 | `docs/决策日志.md#effective-register` | 确认当前哪些规则可阻断或授权 | 停止：无法确认效力时不得执行或授权 |
| 4 | `docs/00-总览.md` | 四平面与 14 部件的入口，决定新内容归属哪一章 | 停止并报告架构入口缺失 |
| 5 | `docs/待决策清单.md#a0-round5` | 当前审议队列（架构与边缘部件在最前） | 不猜测"相关决策"，报告缺失 |

当前工作项为 `null`。若进入真实实施，必须在此填写一个精确工作项路径，不能写“当前工作项”之类的动态占位。

<a id="related-decisions"></a>

## Related decisions

按需读取与当前议题相关的决策；除 D-014、D-020、D-043 外均为`提议`，读取不等于生效。三条已接受规则的正文分别是 [08-规范效力元治理](docs/08-规范效力元治理.md)、[09-跨工具通用性](docs/09-跨工具通用性.md) 与 [架构确定](docs/架构确定.md)，在需要判断效力、判断某条内容该不该进正文、或判断新内容归属哪个部件时按需加载。

## Optional context

- 讨论某个部件时，只加载 `docs/` 下对应的那一章（章号见 00 总览）；
- 讨论某一规则时，只加载对应片段；
- 核查依据时，再加载来源矩阵中的对应 claim 或原始来源；
- 核查模板可执行性时，只加载相关模板。

## Excluded by default

- 全部规范全文、全部模板和全部来源材料；
- `docs/历史/` 下已被取代的原 00–07 章（只在核查旧文表述时按需读取）；
- 44 张公众号文章卡片、六份主题综合与架构要素抽取明细；
- 聊天历史、旧工作项、废弃 ADR、完整日志或大段工具输出；
- 仅因链接可达但不在清单中的文档。

## Resolution rules

1. 路径使用仓库相对 canonical path；相同 `path#fragment` 只加载一次。
2. 链接不递归展开；“相关”“对应”“当前”等无法解析的描述不得由 Agent 猜测。
3. 仓库指令文件只有在本清单列出且实际存在时才加载；不能假设一定有 `AGENTS.md`。
4. 合同、工作项或[工作区身份](docs/20-状态工件.md#workspace-identity)冲突时失败关闭，先核对 ID、revision、updated_at 与工作区身份，再继续。
5. 切换工作项或审议焦点时递增 `contract_revision`；历史版本归档但不进入默认上下文。
