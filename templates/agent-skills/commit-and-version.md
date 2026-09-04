---
name: commit-and-version
description: Conventional Commits、SemVer、分支纪律。写提交信息、开分支、合并、打 tag、发版本时读。
---

# 变更与提交

- **Conventional Commits**：`type(scope): subject`，type ∈ `feat|fix|docs|refactor|test|chore|perf|build|ci|revert`
- **一个提交一件事**。重构与功能改动**不许**混在同一提交——混了就没法单独回滚
- **SemVer**：破坏性变更进 MAJOR，提交体写 `BREAKING CHANGE:`
- **分支短命**：从主干切出，**不超过两天**合回。长期分支本身是缺陷
- 提交信息写**为什么**，不写**改了什么**——改了什么看 diff

**不许**：`--no-verify`、跳过 hook、绕过签名、多人项目直接推主干。

钩子失败时**查根因，不绕过**。绕过一次，那个钩子此后就等于不存在。
