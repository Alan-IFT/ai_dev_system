# Anthropic：Effective Harnesses for Long-Running Agents

原文：[Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)  
source_id：`SRC-ANT-LONG`  
类型：V1（厂商一手工程文章）  
访问核对：2026-09-01

## 可支持的观察

- 仅靠上下文压缩，长任务仍容易半完成、重复劳动或过早宣布完成。
- 可以把“初始化项目环境”和“后续小步实现”分开，并让每次会话只推进一个可验收功能。
- 外部特性清单、Git、进度记录和会话开始的基本验证，有助于新会话恢复。
- 浏览器或其他端到端验证可补足“代码看起来合理”的盲区。

## 在本项目中的落点

- [唯一状态机](../21-调度与拆分.md#canonical-states)区分 `IMPLEMENTED` 与 `ACCEPTED`。
- [状态工件协议](../20-状态工件.md#state-artifacts)把工作项、交接与项目状态分工。
- [验收证据包](../32-证据与追踪.md#evidence-package)绑定版本、环境和结果。

## 边界

文中示例面向全栈 Web Agent；`init.sh`、JSON 特性文件和每会话提交是实现样例，不是跨语言、跨团队的硬规则。单 Agent 或多 Agent 哪个更优也必须用代表性任务验证。
