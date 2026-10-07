---
status: active
updated_at: 2026-10-06
---

# 重构设计：标准与工具改为一个全 TypeScript 的 DSH 插件包

本文是这次重构的**唯一设计依据与进度账**。任何会话中断后，从「§9 断点续做协议」开始读，不要凭记忆续做。

- 决策来源：Alan 2026-10-06 原话——「插件直接按照 dsh 的插件分发要求进行分发就行，我是为本项目专门建立 git 仓库了的 https://github.com/Alan-IFT/ai_dev_system；检查器是 Python，插件是 Node，理论上应该跟着 dsh 一样，全面改用 typescript 方案吧，这样长期才好管理」「按照你推荐的来，废弃技术栈直接清理，不再遗留；开发前一定要把重构设计文档先写好，避免开发中断，导致后续开发混乱」。
- 本文是执行记录与设计，不是对标准正文的修订；是否升格为 ADR / 决策日志条目见 §11。

## 1. 为什么重构（问题，不是愿望）

这一轮会话里**实测**出的问题，每条都有证据：

| 问题 | 证据 | 根因 |
|---|---|---|
| 标准以 `git subtree` 复制进每个采用项目的 `.std/`，升级一次要在 3 个项目各做 7 步 | 本轮升级 `2026-10-05.1`：3 项目 × 7 步，Reservoir 因「工作区必须干净」被卡过一次 | 分发单位是**副本**，副本必然漂移、必须同步 |
| 为「副本不被改坏」存在整套机制：`check_adoption` 里 108 行与内嵌相关的代码、12 种判据、插件里 `.std/` 只读判定 | 本轮量得 | 同上 |
| 检查器是 Python（10,472 行），插件是 Node，两套运行时 | Windows 上 `python3` 被 Microsoft Store 占位程序占着，为此写了 `pick-python.sh`、`certutil` 回退、垫片 | 技术栈不统一，运行时发现靠「找一个能跑的」 |
| 迁移换机时本机状态丢失（便携 git、垫片、profile 的 `link:` 绝对路径） | 本轮实测打包迁移 | 守卫依赖 `link:` 本地路径 |
| 废弃技术栈残留：Claude Code 相关命中 1,284 处（标准仓）、约 200 行死代码 | 本轮量得 | D-135 只做了「不再支持」，没做「清除」 |

## 2. 目标与非目标

**目标**
1. 本仓库（`https://github.com/Alan-IFT/ai_dev_system`）本身就是一个合规的 DSH 插件包，用户经 DSH 自己的安装通道（Plugins 页 / `plugin_manager`，填 git 地址）安装。
2. 守卫、12 个检查器、`check_all`、`stdlib` 全部用 TypeScript，运行时只有 Node（DSH 自带），**不再依赖 Python**。
3. 采用项目**不再内嵌 `.std/`**：项目只放自己的文档与 `governance/`，用一行版本声明指向标准版本；标准正文、模板、检查器随插件提供。
4. 废弃技术栈（Claude Code、`.claude/settings.json`、`CLAUDE.md` 兼容候选名、`.std/` 内嵌机制）从代码、文档、配置中**清除**，不留兼容层。
5. 重构过程可中断、可续做、可回滚（§9、§10）。

**非目标（明确不做）**
- 不改标准正文的**规则内容**；只改它的分发位置与检查器实现语言。
- 不重写检查器的**判定逻辑**——TS 版必须与 Python 版**行为逐 id 一致**（§6），逻辑上的改进另行立项。
- 不擅自执行三个采用项目（NFBY_Reservoir、NFBY_CMS_FullStack、PMC-Planner）的迁移，只提供步骤与脚本（§8）。
- 不支持 DSH 之外的宿主（与 D-135 一致）。

## 3. 目标结构

```text
ai_dev_system/                      ← 仓库根 = 插件包根
├─ package.json                     DSH 清单：dsh.manifestVersion=1、dsh.bundle.patch、engines.dsh
├─ cordis.patch.yml                 把守卫挂进 profile
├─ tsconfig.json
├─ src/                             TypeScript 源码（唯一手写源）
│  ├─ guard/                        守卫（现 tools/dsh-std 迁入）
│  ├─ checks/                       12 个检查器
│  ├─ core/                         stdlib 的 TS 版（读文件、三态、finding、YAML 子集解析等）
│  └─ cli.ts                        命令行入口：`std-check`（钩子与 CI 调用）
├─ lib/                             **构建产物，提交进 git**（原因见 §4）
├─ standard/                        标准正文与模板（由现 标准/、templates/ 迁入），随包分发，只读
├─ test/                            单元与黄金样本对比测试
├─ golden/                          Python 版黄金样本（§6，迁移完成后随 Python 版一并删除）
└─ docs/                            本仓自己的决策、审计、交接（**不随包分发**）
```

采用项目的形态：

```text
<项目>/
├─ AGENTS.md                        项目入口（加载合同指向插件提供的标准）
├─ governance/
│  ├─ project.yaml                  项目配置（裁剪、例外、预算、layout）
│  └─ STANDARD_VERSION              采用的标准版本（一行 + 采用日期等，沿用现格式）
└─ docs/ …                          项目自己的文档（不变）
```
**没有 `.std/`。**

## 4. 分发设计（已实测的约束）

2026-10-06 实测结论，直接决定设计：

| 事实 | 证据 |
|---|---|
| DSH 安装通道支持 git 地址，对 GitHub 先 `git ls-remote`，失败自动还原 `package.json` 与 `pnpm-lock.yaml` | `dsh-plugin-manager` README |
| 包清单规范：`dsh.manifestVersion: 1`、`dsh.bundle.patch`、`engines.dsh`（安装器**当前不强制**检查兼容性） | `dsh-package-manifest` README |
| **pnpm 从 git 装包时默认拒绝执行 `prepare` 脚本**（`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`），要用户在 `pnpm-workspace.yaml` 逐包授权；DSH 的安装通道没有这一步 | 本机用 `pnpm add git+file://…` 实测 |
| **把构建产物 `lib/` 直接提交进 git，则 pnpm 从 git 装包成功**，`lib/index.js` 到位 | 同上，rc=0 |
| DSH 生态里 `dsh-context`、`dsh-plugin-subscriptions` 的 `.gitignore` 忽略 `lib/`——但它们发布到 **npm registry**，不是 git 分发 | 两个仓库的 `.gitignore` 与 profile 里的 `^版本号` 依赖 |

**结论**：`lib/` 必须提交进 git。这引入一个新风险——**`src/` 与 `lib/` 不一致**。对策（必须实现，不是可选项）：

1. 提交钩子（`.githooks/pre-commit`）里先构建，再检查 `git diff --exit-code lib/`，不一致则拒绝提交。
2. `std-check` 自带一条判据：`lib/` 的内容必须等于从当前 `src/` 构建的结果（CI 与发布前都跑）。
3. 发布（打 tag）脚本只在 `lib/` 与 `src/` 一致时才允许。

**版本与 tag**：沿用现有 `YYYY-MM-DD[.n]` 命名，**同时**满足 npm semver 的要求——`package.json.version` 用 `0.<序号>.0` 形式（见 §11 未决 Q1），tag 名仍是日期版本；两者的对应关系写进发布记录。

### 4.1 钩子如何调用插件提供的命令（Q3 的实测答案）

2026-10-06 在临时目录里用 `pnpm add git+file://…` 装一个带 `bin` 字段的最小包，结果：

| 实测 | 结论 |
|---|---|
| 包声明 `bin: {"std-check": "lib/cli.js"}` 后，装入 profile，`node_modules/.bin/` 出现 `std-check`、`.CMD`、`.ps1` | **`bin` 机制可用**，不需要 DSH 额外提供命令入口 |
| 直接调 `.bin/std-check.CMD`：报「`node` 不是内部或外部命令」；把 DSH 的 node 目录放进 PATH 后调：成功，node=v24.21.0 | **`.CMD` 要求 PATH 里有 node**；DSH 的会话 shell 里 **PATH 没有 node**（实测 `Get-Command node` 为空，PATH 里也没有任何 `.dsh` 段） |
| 绕开 `.bin`，直接 `node <profile>/node_modules/<包名>/lib/cli.js`：成功 | 路径稳定：`node_modules/<包名>` 是指向 `.pnpm` 的链接 |
| DSH 导出 `DSH_HOME`、`DSH_PROFILE_DIR`、`DSH_PROFILE`；DSH 的 node 固定在 `$DSH_HOME/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node(.exe)` | **钩子只靠这两个环境变量就能定位 node 与插件**，不需要找系统 node |

**据此定的钩子写法**（阶段 1 落地并验证）：钩子用 `$DSH_PROFILE_DIR`、`$DSH_HOME` 拼出 node 与 `cli.js` 的路径后直接 `node cli.js`，**不依赖 `.bin` 的 shim，也不依赖 PATH 上有 node**。这和现在 `pick-python.sh` 解决的是同一类问题（「钩子运行时找不到解释器」），但**只剩一条确定路径**，不再需要「依次试几个候选、取第一个跑得通」。
**未验证**：钩子在 **DSH 之外**（例如在系统终端手敲 `git commit`、CI）运行时，`DSH_HOME` 不存在——此时钩子要回退到什么？阶段 1 要定：我的倾向是回退到 `PATH` 上的 `node` 与项目里记录的 `STD_CLI` 环境变量，找不到则**失败关闭**并说清缺什么。

**安装验证（硬性，阶段 1 的验收）**：在真实 DSH 里，用 Plugins 页（或 `plugin_manager`）填 `git+https://github.com/Alan-IFT/ai_dev_system.git#<tag>` 安装，重启后**实测守卫生效**（写 `standard/` 被拒），不能只靠本地 `link:`。

## 5. 技术选型

| 项 | 选择 | 理由 | 未验证 |
|---|---|---|---|
| 运行时 | Node ≥ 22.19（沿用现 `engines`），DSH 自带 | 零额外依赖 | — |
| 语言 | TypeScript，`strict` | Alan 决定 | — |
| 构建 | 先用 `tsc` 直接产出 `lib/`（ESM），不引入打包器 | 简单优先；生态插件用 `tsdown` 是为了打包与 d.ts，我们没有这个需求 | `tsc` 产物能否被 DSH 的 Cordis loader 直接加载——**阶段 1 实测** |
| 测试 | Node 内置 `node --test` | 现有 471 条守卫测试已在用，不换框架 | TS 测试直接跑：Node 24 原生支持去类型，但 `engines` 下限 22.19 是否也支持——**阶段 1 实测**，不行则测试也先 `tsc` |
| 依赖 | **零运行时依赖**；`typescript` 仅作开发依赖 | Python 版检查器「只用标准库」是既定约束，保持 | — |
| YAML | 自实现的 YAML 子集解析器（现 `stdlib` 里就是自己写的子集） | 同上，避免引入依赖；行为必须与 Python 版一致（§6） | — |

## 6. 检查器迁移：以契约为规格，以黄金样本为验收

**规格**：`tools/std/CONTRACT.md`（接口、三态语义、退出码、配置键）。**不是 Python 代码**——逐行翻译会把已修好的 bug 带回来，也会把 Python 特有的行为（如 `re` 的回溯、`os.listdir` 顺序）误当成需求。

**验收**：黄金样本对比，机械可验，不靠「我觉得译对了」。

1. **生成黄金样本（阶段 0，在改任何代码之前）**：用 Python 版对下列输入各跑一次，存**完整结构化输出**（每个 finding 的 `id`、状态、位置、原因，及汇总计数与退出码）到 `golden/`：
   - 本仓（`--no-scope` 与含 scope 两种）；
   - 三个采用项目的**固定提交**（记录提交号，避免项目继续开发导致样本漂移）；
   - `--selftest` 里的全部夹具仓（把夹具改造成可导出：每个夹具一个目录 + 期望 finding 集合）。
2. **TS 版对同批输入产生的 finding 集合必须与黄金样本逐 id 相同**；差异逐条处理——要么 TS 有 bug，要么 Python 有 bug（后者**不在本次修**，记入 §11 并保持两版一致，改进另行立项）。
3. 迁移顺序（依赖序）：`core`（stdlib）→ `entry_budget` → `layout` → `links` → `freshness` → `drift` → `derived` → `evidence` → `adoption` → `single_authority` → `cross_repo` → `check_all` 汇总。每迁完一个，**单独跑通对比再迁下一个**。
4. `--selftest` 里的**变异验证**（故意改坏判据看检查器是否报错）是质量保障的核心，**必须迁**，不能为了省事丢掉。
5. 全部对齐后才删 Python 版（§7 阶段 4），中间任何时候都能回退。
6. **每个迁完的单元的测试，必须经 `scripts/mutate.mjs` 的变异验证后才算守住了它的性质**（2026-10-06 加，缘由见 §12.16–§12.18）：
   - 「对真实仓/黄金样本的整份比对」只是**额外的一道**，不是唯一的一道。它在样本平台以外会被跳过，也只覆盖样本里碰巧有的输入；**每个判据必须有自己的、不依赖外部数据的直接断言**，期望值先在 Python 版上实测再写。
   - 变异首轮没抓住的，只有四种处置：补输入（盲区）、标 `unobservable` 并写明理由（真实入口走不到，且行为与 Python 一致）、删除（等价变异）、标 `posixOnly`/`winOnly`（只在一个平台可观察）。**不许因为「难写」而放过**。
   - **两个平台（Windows 与 Ubuntu 容器）都要跑**：已有三次（`lexists`、`glob` 的 `G32`、`layout` 的 `D5/D6`）只在 Linux 上红。

**迁移时直接不带过去的（废弃技术栈）**：
- `check_adoption` 里读 `.claude/settings.json` 的 `_settings_allow`、`_wildcard_allow` 及其自检（约 200 行）与对应 finding id：`wildcard-allow`、`wildcard-unsure`、`no-wildcard-allow`、`settings-invalid`、`settings-absent`；
- 所有 `.std/` 内嵌相关判据：`embedded-modified`、`embedded-untracked`、`embedded-readonly-unknown`、`embedded-revision-unreadable`，以及 `version-mismatch` 中「比对内嵌 `.std/标准/README.md` 第 3 行」的部分（改为见 §8 的版本声明语义）；
- `ENTRY_CANDIDATES`、`_DEFAULT_RULE_FILES` 里的 `CLAUDE.md`、`.claude/`；
- 守卫里「`.std/` 只读」的整套判定（因为不再有 `.std/`）——改为保护 `standard/`（本仓内）与插件自己的 `lib/`（防手改产物），详见阶段 1 设计。

> 这些被删的 finding id 需要在黄金样本对比时**显式列入「预期消失」清单**，否则对比会把它们当差异。

## 7. 阶段、验收与退出条件

每阶段有**可机械验证的退出条件**；未满足不得进入下一阶段。阶段状态记在 §12 进度账。

| 阶段 | 内容 | 退出条件（全部满足） | 可否单独停下 |
|---|---|---|---|
| **0 基线** | 写本设计文档并提交；生成 Python 版黄金样本；量化废弃残留 | 设计文档已提交推送；`golden/` 含 ≥5 个样本且 Python 版重跑结果与之逐字节相同；残留清单落盘 | 是——只增文件，不改现状 |
| **1 骨架与守卫** | TS 工程骨架（`package.json` 合规、`tsconfig`、构建、`lib/` 同步校验）；守卫迁为 TS；真实 DSH 里经 git 地址安装验证 | `tsc` 通过；守卫测试 ≥ 现有 471 条且全过（Windows 与 Ubuntu 容器）；**真实 DSH Plugins 页用 git 地址装入后，写 `standard/` 被拒且已落盘文件为零**；`lib/` 与 `src/` 一致校验已接进钩子 | 是——此时 Python 检查器仍是现役 |
| **2 检查器迁移** | `core` + 12 检查器 + `check_all` + selftest 夹具 | 每个检查器：TS 与黄金样本逐 id 零差异；`--selftest` 的变异验证全迁且通过；TS `check_all` 在本仓退出码与 Python 版一致 | 每迁完一个检查器可停 |
| **3 采用项目迁移材料** | 写迁移步骤文档与脚本（**不执行**） | 步骤在一个**本仓内的合成夹具项目**上演练通过；三项目逐个写出「改什么、验什么、怎么回退」 | 是 |
| **4 清理** | 删 Python 版与 `golden/`；清 Claude Code 残留；冻结历史处理 | `git grep` 在现行文件中对 `Claude Code`/`CLAUDE.md`/`.claude/`/`.std/` 零命中（冻结历史按下条）；**冻结历史先打 `archive-pre-ts-refactor` tag，再从 `main` 移除或留作仅历史**——此条需 Alan 确认（§11 Q2） | 否——删了就不能回退，必须在 tag 之后 |
| **5 收尾验证** | Windows + Ubuntu 容器全量；文档与实际对齐 | 两个平台全量测试与 `std-check` 退出 0；设计文档 §12 与实际一致；发布新 tag 并在真实 DSH 里从该 tag 安装验证 | — |

## 8. 采用项目迁移（本阶段只写材料，不执行）

迁移一个采用项目 = 以下步骤，**每步有验证与回退**：

1. 装好新插件（DSH Plugins 页填 git 地址，钉 tag）。
2. 把项目的 `governance/STANDARD_VERSION` 改成指向插件版本（格式见阶段 3 定稿）。
3. 项目提交钩子改调 `std-check`（由插件提供的命令；具体怎么在钩子里找到它——见 §11 Q3）。
4. 删除 `.std/` 目录（`git rm -r .std`）；清 `project.yaml` 里 `.std` 的 frozen 声明与 `AGENTS.md` 加载合同里的 `.std/` 路径。
5. 跑 `std-check`，读数应与迁移前**逐 id 相同**（`.std/` 相关 id 除外），不同则回退。
- 回退：`git revert` 该迁移提交即可（`.std/` 在历史里）。
- 三个项目各自的特殊点（已知）：CMS 的 `.pre-commit-config.yaml` 里 `entry` 是 YAML 折叠块；Reservoir 钩子是 `.githooks/pre-commit`；PMC 的钩子是自己的 `tools/hooks/common.sh`，不调用公共片段。

## 9. 断点续做协议（会话中断后必读）

1. 先读本文 §12「进度账」，只信**已勾选且附了证据命令/提交号**的项。
2. 跑 `git log --oneline -20` 与 `git status --short`，确认工作区状态与进度账一致；**不一致时以 git 为准**，并在 §12 补记差异。
3. 当前阶段的**退出条件**逐条现场重验，不要相信「上次说过了」。
4. 一次只推进一个阶段、阶段内一次只迁一个检查器；每个最小单元完成后**立刻提交并更新 §12**，不攒。
5. 提交信息用 `refactor(ts): <阶段>.<单元> …`，便于从历史回溯进度。
6. 任何**破坏性**操作（删 Python 版、移除冻结历史、强推、改三个采用项目）前必须有明确授权记录；没有就停下问。
7. 发现本文与现实冲突：**先修本文，再继续开发**，并在 §13 记一条变更。

## 10. 回滚

| 阶段 | 回滚方式 |
|---|---|
| 0–3 | 只增文件/只改本仓非现役部分：`git revert` 对应提交即可，Python 版全程可用 |
| 4 之前 | Python 版一直保留；TS 版出问题时钩子仍指向 Python 版 |
| 4（清理） | 先打 `archive-pre-ts-refactor` tag；回滚 = `git checkout` 该 tag 的对应路径 |
| 发布后 | tag 不删不改；发现问题发新 tag，采用项目钉旧 tag 即不受影响 |

## 11. 未决与风险

**需要 Alan 决定的**

| # | 问题 | 我的倾向 | 状态 |
|---|---|---|---|
| Q1 | **已定 A**（Alan 2026-10-06 确认；只影响 `package.json.version` 一个字段）。`package.json.version` 用什么形式：`0.<序号>.0`（符合 semver，与日期 tag 另表对应），还是把日期当版本（`2026.10.6` 这类，不合 semver 规范但可读） | `0.<序号>.0`，对应表放发布记录 | 未决，阶段 1 前定 |
| Q2 | 冻结历史（`docs/参考资料*`、`审计记录`、`归档`、`标准/参考资料`，约 172 个文件、1,190 处 Claude 字样）：留在 `main`、还是打 tag 后从 `main` 移除 | 打 tag 后从 `main` 移除（保留可查，`main` 不再带废弃栈）；**这会推翻 D-135 当时的「冻结历史不改」** | **未决，阶段 4 前必须定** |
| Q3 | 采用项目的钩子怎么找到插件提供的 `std-check` | **已实测，答案见 §4.1**：`bin` 字段 + `.bin` 可用，但钩子里必须自己带 node | **已定（阶段 1，2026-10-06）** |

**风险**

| 风险 | 缓解 |
|---|---|
| 1 万行重写引入行为差异 | §6 黄金样本逐 id 对比，机械验收 |
| 黄金样本本身漂移（项目继续开发） | 样本固定在记录的提交号上 |
| `lib/` 与 `src/` 不一致 | §4 三道校验 |
| DSH 的 Cordis loader 不接受 `tsc` 直出的 ESM | 阶段 1 先验，不通过则改构建方式并更新本文 |
| 对 DSH 插件 API 的了解不全 | 每个用到的 API 在使用前查官方 README；查不到的标「未验证」，不写成事实 |
| 「标准正文随插件走」让采用项目 `git diff` 看不到升级差异（CMS 的升级评估记录依赖它） | 升级差异改在插件仓看；项目里记版本号与评估结论。**这是真实代价，已接受** |
| 重构期间本仓仍要正常发布/维护 | 阶段 1 前 Python 版仍是现役，期间的标准改动照常做、照常发版 |

## 12. 进度账

> 勾选规则：只有**附了证据（命令输出摘要或提交号）**才可勾。没证据的不勾。

- [x] 阶段 0：基线（2026-10-06 完成）
  - [x] 设计文档已提交推送（本文）——提交 `2fdb501`，`check_all` 含本文退出 0；变异验证（给本文加坏链接）退出 1 并指到本文，还原后 0
  - [x] 黄金样本已生成并校验可复现——`golden/samples/` 5 个文件：`std`/`reservoir`/`cms`/`pmc` 四个仓的 finding 清单 + `selftest-probes.json`（228 条探针）；`golden/make_golden.py` 重跑后四个仓样本与落盘逐字节相同；`selftest-probes.json` 连跑两次一致
  - [x] 废弃残留清单已落盘——`golden/residue-baseline.txt`（口径与基线读数见 §12.1）
- [ ] 阶段 1：骨架与守卫（**进行中**，下面分项）
  - [x] 1-a Q3 实测定案、`tsc` 可用性（`ac0e2b5`）
  - [x] 1-b TS 工程骨架：`package.json`（`dsh.manifestVersion`、`bundle.patch`、`engines`）、`tsconfig.json`、`cordis.patch.yml`（`name` 与包名同为 `ai-dev-std`）、`scripts/check-lib-sync.mjs`；`tsc` 7.0.2 构建通过
  - [x] 1-c 守卫迁 TS：`src/guard/{policy,index}.ts` + 根入口 `src/index.ts`；**行为不变**——现役 JS 守卫基线 471 条（470 过、0 败、1 跳）与 TS 编译产物上的结果逐项相同；变异验证（把「.std 只读 deny」改 allow）后 16 条变红、还原后回到 0 败
  - [x] 1-d `lib/` 与 `src/` 一致性校验：脚本四种变异都符合预期（改 src 不构建→1、手改 lib→1、lib 多出过期文件→1、缺 tsc→2 即「没跑成不当通过」）；已接进 `.githooks/pre-commit` 作第四道，三种行为实测（全绿 0、不一致拦下、找不到 node 失败关闭 127）
  - [x] 1-e **`lib/` 提交进 git**——`755e7ad`，经新的第四道钩子；提交前核暂存清单时发现一份已在磁盘删除的 `tsconfig.test.json` 还在索引里，已移除，没进历史
  - [x] 1-f 守卫测试在 **Ubuntu 24.04 容器**里全过：用 Node **22.19.0**（`engines` 下限）与 **24.21.0** 各跑一遍——`pnpm install --frozen-lockfile`、`tsc` 构建、`check-lib-sync` 退出 0、构建后 `git status` 为空（lib 与提交一致）、`node --test "test/*.test.mjs"` 471 条、0 失败、22 条跳过（只在 Windows 成立的路径语义，跳过不算通过）
  - [x] 1-g **真实 DSH 里从 git 地址经 DSH 自己的安装通道装入，守卫生效**（2026-10-06，提交 `fac60ca`）。做法与范围见 §12.3；**未覆盖的两项**（`ask` 的真实批准流程、桌面版 Plugins 页的点击安装）在 §12.3 逐条写明，不算已验证
  - [x] 1-h 新路径保护：做成插件配置 `protect`（Alan 2026-10-06 选 B），默认空；37 条单测；6 种变异验证（首轮 2 种没被抓住，补用例后全部抓住）；真实 DSH 里端到端验证配置传递，含对照实验。做法与取舍见 §12.4。**`standard/` 的保护未做**——该目录阶段 2 之后才存在，不预先写规则
- [ ] 阶段 2：检查器迁移（**进行中**）
  - [ ] core（拆成多文件，下面逐个勾）：
    - [x] `core/finding.ts`（三态、id、`normalizeKey`、Python 空白集合 `PY_WHITESPACE`、`pyStrip`、`encodeSurrogateEscape`）
    - [x] `core/yaml.ts`（严格 YAML 子集解析器）、`core/dates.ts`（`parseDate`，D1）
    - [x] `core/fs.ts`（受限读取：`inside`/`guard`/`readBytes`/`readText`/`countLines`）
    - [x] `core/git.ts`（git 子进程环境加固：`hardenedEnv`、`filterEnv`、`gitVersionProblem`、`shallowProblem`；`tracked_files` 因依赖 `embedded_std_rel`（`.std/` 内嵌机制，阶段 4 废弃）与 `scan_memo`，**推迟到 `check_all` 汇总层迁**）
    - [x] `core/config.ts`（配置加载与校验）、`core/cfg.ts`（`cfgGet`、状态词表、`leadWord`、`stateClass`）、`core/utf8.ts`（首个无效序列起点）
    - [x] `core/exceptions.ts`（例外登记册：`loadExceptions`、关闭态、表格解析、表头归类、日期运算）
    - [x] `core/docs.ts`（头部字段查找、工件落点、入口候选、工作项命名、裁剪、状态归类）
    - [x] `core/shell.ts`（检查器公共外壳：`runGuarded`、`undeterminedFromException`、`probe`、`probeCrashed`、`unreadable`、`outsideRoot`、`once`、`agg`、`workRootAbsent`——每个检查器都用，所以先于任何检查器迁）
    - [x] `core/fixture.ts`（自检夹具：`writeText`、`writeFiles`、`gitFixture`、`gitTrack`——所有检查器的 selftest 共用）
    - [x] `core/glob.ts`（路径通配，只实现 layout 用到的子集；§12.17）
    - [x] `core/text`（`splitLinesPy` 增 `keepends`，在 `yaml.ts`；`exists` 并入 `core/fs.ts`——`layout` 用到）
    - [x] `core/tracked.ts`（`trackedFiles`、`withScanMemo`、`markdownUnder`、`workItems`、`cmpCodepoint`；**不带 `.std/` 自排除**，见 D17 与 §12.19）
  - [ ] （core 总项：只剩 `tracked.ts`，推迟到汇总层）　[x] entry_budget（2026-10-06，§12.16）　[x] layout（2026-10-06，§12.18）　[x] links（2026-10-06，§12.20）　[ ] freshness　[ ] drift
  - [ ] derived　[ ] evidence　[ ] adoption　[ ] single_authority　[ ] cross_repo　[ ] check_all
- [ ] 阶段 3：采用项目迁移材料
- [ ] 阶段 4：清理
- [ ] 阶段 5：收尾验证

### 12.1 阶段 0 的真实口径（TS 版对比时必须按这个来，不是按我设想的来）

**样本钉在提交上，不钉在目录上**：`make_golden.py` 用临时 `git worktree` 检出记录的提交再扫，所以不受被扫仓当前工作区影响。实测同一提交用「真实目录」与「worktree」两种扫法，PMC 的 157 条 finding 的 id 与 status 完全一致。

| 输入 | 钉住的提交 | 退出码 | finding 数 | 分布 |
|---|---|---|---|---|
| std（本仓） | `2fdb501a` | 0 | 68 | SKIP 50 / PASS 17 / UNDETERMINED 1 |
| reservoir | `1ae3f0d6` | 0 | 69 | SKIP 33 / PASS 36 |
| cms | `34d0ad9d` | 0 | 147 | SKIP 28 / PASS 103 / UNDETERMINED 16 |
| pmc | `c952f0ff` | 2 | 157 | SKIP 31 / PASS 98 / UNDETERMINED 28 |

**只比 `id`、`status`、`where`、`registered`，不比 `title`/`evidence`/`reason`**：`freshness` 用运行日（文本里有「N 天」），`tool-identity` 含 git 提交号与检查器哈希，这些随日期与提交变。`tool-identity` 一项在 TS 版里**必然不同**（检查器文件集变了），对比时列入「预期差异」。

**selftest 探针清单**（228 条，已排除 `tool-identity`）记 `check`/`id`/`status`/`title`，按检查器分：stdlib 66、drift 27、freshness 22、single-authority 18、cross-repo 17、evidence 17、adoption 11、entry-budget 10、layout 10、shared-fact 9、derived-artifacts 9、links 8、contract-examples 3、entry-smoke 1。**这些探针的 `title` 是人写的中文描述，TS 版要逐条复现同样的探针（同 id、同 PASS），而不是只复现最终 `check_all` 的结果**——否则变异验证这层质量保障就丢了。

**这里有一个我必须如实写下的迁移难点**：各检查器的 selftest 里，探针**大量直接调用私有函数**（如 `check_entry_budget` 的探针调私有 `_docs`/`_entry` 共 44 次、公共 `run` 0 次；`check_drift` 私有 43 次、公共 16 次）。所以 TS 版**不能只实现公共 `run()`**：每个检查器要保留与 Python 版对应的内部函数边界，selftest 才能逐条对应。这会让迁移比「重写判定逻辑」更贴近原结构，是**有意的取舍**——结构上偏离 Python 版越多，探针越难一一对上。

**废弃残留基线**（`golden/residue-baseline.txt`，口径：`Claude Code|claude-code|CLAUDE.md|.claude/|claude plugin|.std/|git subtree` 命中行数，不含 `golden/` 自己；冻结历史在该文件里**按顶层目录汇总、不逐文件列**——第一版逐文件列了归档文章的文件名，文件名里带的数字被 `single-authority` 当成数值声明、判成「同一声明出现在多个文件」，`check_all` 因此退出 2，改成按目录汇总后回到 0；要逐文件清单就现跑同口径，不入库）：

| 类别 | 文件数 | 行数 | 阶段 4 的目标 |
|---|---|---|---|
| 冻结历史 | 165 | 1112 | 按 §11 Q2 |
| 守卫（将迁 TS） | 5 | 150 | 0 |
| 检查器（Python，将被 TS 取代） | 9 | 133 | 随 Python 版整体删除 |
| 现行文档 | 16 | 48 | 0 |
| 其它 | 1 | 1 | 0 |

### 12.4 1-h：新路径保护——为什么做成配置、不内置，以及验证里发现的两件事

**起因**：把守卫迁到新位置后，实测 `src/guard/policy.ts`、`lib/`、`cordis.patch.yml`、`package.json` 都是 `allow`——旧位置 `tools/dsh-std/` 的「改守卫的人不应由守卫放行」保护没有跟过来。

**第一版（已撤回）**：直接把 `src/`、`lib/`、`package.json` 等内置进 `protectedPath`，471 条旧测试加 15 条新测试全绿。但**守卫装在 profile 里、对用户所有项目共用**，实测会让**每个采用项目自己的** `src/app/main.py`、`lib/utils.js`、`package.json` 都被问一遍——用自己项目的同名路径当成「守卫源码」去拦，是误伤。撤回，没有提交。

**Alan 选的方案 B**：插件配置 `config.protect`，相对项目根的路径数组，默认空；只有开发本插件的仓库在 profile 里写上。判定规则：整段匹配（`package.json` 不连带 `package.json.bak`），写工具与 shell（含 `cd` 后写、命令替换、内嵌 `bash -c`）都判，大小写按 `.std` 同样规整；非数组、非字符串项、空串、绝对路径（含盘符与 UNC）、含 `.`/`..`/空段的项一律丢弃，不抛、不当成「全部」。

**验证里发现的两件事**
1. **变异验证抓出测试盲区**：6 种变异里 M4（放过含 `..` 与 `.` 的项）、M5（放过绝对路径）两种**没被抓住**。查实不是防御冗余——放过 `./x` 会让项目内的 `x` 被误保护、放过 `/etc` 会让项目内的 `etc/hosts` 被误保护，只是原用例没有构造出会触发差异的输入。补了 9 条能区分的用例（以及 4 条区分「非数组被整体忽略」与「字符串被逐字符展开」的用例）后，M3/M4/M5/M7 全部被抓住。**教训：用例通过不等于用例有区分力，变异验证才是**。
2. **我在 README 里写了一个编造的 YAML 语法**：先写了 `- override:` 这个键，**DSH 并没有它**。发现的经过：为了验证配置传递，去读 DSH 文档与用户真实 profile 的 `cordis.patch.yml`，真实写法是**顶层条目带 `id`/`name`/`config`**，并且 DSH 明确「用户 patch 整块替换匹配到的 config、不深合并」。已更正 README，并**真的在隔离 profile 里照更正后的写法验证**：`--dump-config` 合并后 `protect` 为那六项；真实 `tools/pre-execute` 管线里写 `src/guard/x.ts`、`package.json` 被要求审批（探针没有 agent，所以是「requires approval」，与 §12.3 第 1 项同一限制），写 `docs/a.md`、`test/a.mjs` 放行；**对照**：同 profile 把 `protect` 改回 `[]`，四个写入全部放行并落盘。

**仍未覆盖**：`ask` 的真实批准流程（同 §12.3）；用户自己真实 profile 里的 `dsh-std` 条目仍是旧的 `link:` 到 `tools/dsh-std`，**没有改**——切换到新包、写上 `protect` 是阶段 4（清理旧位置）一起做的事，现在改会让本机的守卫在 Python 检查器退役前出现两份。

### 12.3 1-g 的验证做法、证据与未覆盖的部分

**做法（全程隔离，没碰用户真实的 `~/.dsh`）**：`DSH_HOME` 指向一个全新的临时目录；用 DSH 自带的 `dsh.cmd` 命令行（`--profile e2e --from-default-profile headless` 建 profile，`dsh plugin --profile e2e add <git 地址>` 装插件）；起 `dsh --profile e2e`（headless）。这条路径与桌面版 Plugins 页走的是同一个 `plugin-manager` 安装通道。

| 实测 | 结果 |
|---|---|
| `dsh plugin add git+ssh://git@github.com/Alan-IFT/ai_dev_system.git#fac60cae…` | 退出 0；profile 的 `package.json` 写入 `"ai-dev-std": "github:Alan-IFT/ai_dev_system#fac60cae…"`，`dsh.profile.bundles` 自动追加 `ai-dev-std` |
| 装到的包内容 | 只有 `lib/`（6 个文件）、`cordis.patch.yml`、`package.json`、`README.md`、`LICENSE`，**没有** `src/ test/ docs/ tools/ 标准/ templates/ golden/ scripts/`——`files` 白名单生效 |
| `dsh --profile e2e --dump-config` | 合并后的配置里有 `# == ai-dev-std`、`id: ai-dev-std`、`name: ai-dev-std`、`config: {enabled: true, root: ''}` |
| 在真实 `tools/pre-execute` 管线里（探针插件直接调 `ctx.tools.execute`，不经模型，所以不需要模型凭据）写 `.std/x.md` | **被守卫 deny**，错误文本是守卫的「内嵌标准目录 .std/ 只读」；磁盘上**没有**该文件 |
| 同上，`edit` 一个 `.std/` 内文件 | 被 deny |
| 同上，写普通文件 `ok.txt` | **放行**，文件落盘（说明不是「什么都拦」） |

**没有覆盖的（诚实标明）**
1. **`ask` 的真实批准流程**：`pwsh` 的调用（含 `git push --force` 与写 `.std/`）得到的是「`tool "pwsh" requires approval, but the call has no agent to route it through`」——**这是 DSH 因为我的探针调用没有 agent 而在守卫之前/之外拒绝的**，不是守卫的判定，所以这两条**不能算守卫生效的证据**。`ask` 要有 agent 与审批通道才会走到，本次未验证。（单测里 `ask` 的判定逻辑 471 条覆盖，但那是判定核心，不是 DSH 里的端到端。）
2. **桌面版 Plugins 页的点击安装**：我用的是同一个 `plugin-manager` 的命令行入口，没有真的在桌面 GUI 里点。
3. **会话工作目录推导项目根**（`exec.agent.session.header.cwd`）：探针调用没有 agent，所以守卫走的是 `root` 配置（空）→ 进程 cwd 的回落路径；「取会话 cwd」那条分支没被这次覆盖。我把探针的工作目录设成了测试项目，所以 `.std/` 判定落在了正确的项目里，但这只证明回落路径。
4. **模型调用**：隔离 home 没有 API 凭据，启动在「挂载完成之后」因 `MISSING_CREDENTIAL` 退出 1；这不影响上面的结论（探针在挂载后、模型调用前就已跑完并落盘），但意味着**没有走过一次完整的 agent 回合**。

**一个意外的发现**：工具是**渐进注册**的——在 `apply` 里同步取 `ctx.tools.schemas()` 得 0 个，下一个微任务 6 个，`setTimeout 0` 后 24 个（含 `write`、`pwsh`）。写探针时因此踩了三次坑（`inactive context`、`unknown tool "write"`）。这对守卫**没有影响**（守卫挂的是 `tools/pre-execute` 事件，不在 `apply` 里调用工具），但说明**以后任何在 `apply` 里直接用工具的代码都要等就绪**。

### 12.2 阶段 1 里量出来的、设计时没预见的事（做的时候才发现）

- **一次测量假象，差点被当成真失败**：第一次在 Node 22.19 上跑 `node --test "test/*.test.mjs" | head -12`，退出码是 7，看起来像「22.19 不支持 glob 或测试失败」。不是——是我自己用管道接了 `head`，`head` 提前关管道，`node` 收到 SIGPIPE。去掉管道、重定向到文件后，22.19 上 glob 形式退出 0、471 条、0 失败。**规矩：验证命令不要接会提前退出的管道**，退出码要在没有管道的情况下取。
- **`pnpm run test` 在 DSH 的会话 shell 里要先把 DSH 的 node 目录放进 PATH**：会话 PATH 里没有 node（§4.1 已记），脚本里的 `tsc`/`node` 由 pnpm 注入 PATH，但 `node` 本身不在其中。这与钩子用 `DSH_HOME` 拼路径是同一件事。
- **`node --test` 的三种写法在这个仓里结果不同**：传目录（`test/`）失败（被当成模块路径）；无参数会把 `test/` 与别处重复发现的测试一起数成 942 条；只有显式 glob 或显式文件是 471。脚本里固定用显式 glob。

- **`noUncheckedIndexedAccess` 关掉了**：开着时这份代码有 57 处「数组下标可能是 undefined」报错；关掉后只剩 17 处，且都是缺类型标注。这份词法扫描代码的循环条件已在运行时保证下标在范围内，把 30 处都改成 `!` 或加判断是在**为类型检查器改写已被运行时保证的代码**，改动面大、引入新错误的风险高，收益是零。**这是有意的取舍，不是偷懒**；其余 `strict` 全开。
- **TS 7.0 的 `tsc` 能直接用**：`pnpm view` 显示 `latest = 7.0.2`，本机实测构建与运行都成功；DSH 生态里 `dsh-context` 同样用 `^7.0.2`。
- **DSH 官方有 `ToolExecution`、`PreToolDecision` 类型**（`@deepseek-ai/dsh-tools`），守卫的适配层直接用，不自己编接口。本仓 devDeps 拉到的 `cordis 4.0.4`、`dsh-tools 0.2.0-rc.2` 与 DSH 内置版本**逐一核对相同**。
- **JS 的字面量推断与 TS 不同**：JS 版里 `{ kind: 'allow' }` 在 TS 里被推断成 `{ kind: string }`，赋给 `PreToolDecision` 报错。给 `downstream`、`verdict`、`inner`、`mine` 显式标类型后解决；行为不变。
- **插件名要等于包名**：`cordis.patch.yml` 的 `name` 与 `index.ts` 的 `name` 导出都改成 `ai-dev-std`（本机已装的 `dsh-user-preferences` 就是这个惯例）。原来的 `dsh-std` 只是目录名。
- **`bin` 与 PATH**：见 §4.1。

### 12.7 阶段 2 迁移中量出来的事（`core` 的 finding/yaml/dates 完成时）

- **证据**：对 Python 版单元黄金样本（`golden/unit/stdlib-pure.json`，152 条输入，52 接受 39 拒收）逐条比对，含**精确的错误信息**；YAML 配置读入的结果比对时键序规范化（黄金样本用 `sort_keys` 写出，键序不是解析结果的一部分，数组顺序则是语义、不规范化）。`PY_WHITESPACE` 对着 `golden/unit/whitespace.json`（Python 的 `strip`/`\s` 在全部 0x110000 个码点上的集合）逐码点测。
- **变异验证 29 条全部被抓住**（`test/mutations/core.json`，`scripts/mutate.mjs` 执行）。**首轮 25 条里有 4 条没被抓住**，都是因为黄金样本没有构造能触发差异的输入：列表项内重复键、列表项缩进不一致、BOM 出现在值里、闰年的世纪规则（1900 不是闰年而 2000 是）。补了输入后抓住——这是第三次实测证明**用例通过不等于有区分力**。
- **我写变异脚本时出过一次事故**：第一版是一段内联 PowerShell，其中 `Try-Mut` 函数在失败路径上用了一个未定义变量，`WriteAllBytes` 把一份**尚未提交**的 `dates.ts` 整份当成路径写坏了。幸好文件系统写的是「路径不存在」而没真的覆盖，且我立刻核对了文件内容，**没有丢数据**。改成独立脚本 `scripts/mutate.mjs`：开始前整份备份并记 sha256、每条变异 `try/finally` 还原、结束后核对哈希、`SIGINT`/未捕获异常也从备份恢复；还有「基线必须全绿才开始」「锚点必须恰好出现一次」「变异后编译不过算无效」三条前置检查。清单落在 `test/mutations/*.json`，成为**可重复的资产**而不是一次性操作。
- **Python 的 `parse_date` 控制流我第一次读错了**：我以为「日期不存在」在严格模式下报「不是合法日期」，黄金样本说是「既不是 YYYY-MM-DD 也不是 ISO8601」。查实 Python 的顺序是 ① `date.fromisoformat` ② `datetime.fromisoformat` ③ **仅非严格**的前 10 位兜底，①②失败（含日期不存在）才落到③；严格模式没有③。已按这个控制流重写并写进注释。**读 Python 代码得出的结论要拿黄金样本对一遍，不能凭读代码。**
- **一个新发现**：Python 里一个分支是**不可达**的——「列表项是空的」这条 `ConfigError("第 N 行是空列表项")`，我用 621,435 条穷举输入（17 种行体 × 5 种缩进 × 1 到 3 行）都没有触发。TS 版保留了该分支（行为与 Python 一致），但无法用黄金样本验证它，也无法对它做变异验证，**如实记为未验证**，不假装覆盖。

### 12.8 `core/fs.ts` 完成时量出来的事

- **证据**：对 Python 版夹具型单元黄金样本（`golden/unit/stdlib-fs.json`，190 条，含普通文件、目录、不存在、超限稀疏文件、恰好等于上限、符号链接出仓、目录符号链接出仓、17 种编码与行尾夹具）逐条一致；测试在临时目录里按**同一份夹具清单**建夹具，开头核对条数与每个夹具的字节数，防两边漂移。
- **变异验证 20 条：16 条被抓住，4 条如实标注「已知未验证」，0 条没被抓住。** 首轮 22 条里有 9 条没被抓住或无效，分四类处理，**没有一条是靠「删掉不好看的」解决的**：
  1. **测试盲区，补了测试**：`under` 退化成纯字符串前缀（`/x/ab` 误含 `/x/abc`）、`dev/ino` 核对被去掉或只剩一半。后者需要在「fd 已打开、核对之前」那个窗口里把文件换掉——光有 `beforeOpen` 钩子不够，**加了 `afterOpen` 钩子**才造得出这个窗口。
  2. **纵深防御，改成复合变异**：超限有两道防线（`stat` 大小、读后长度），各自去掉都被另一道兜住，所以单独变异永远抓不住。正确的验证是**同时去掉两道**必须变红——`mutate.mjs` 新增 `multi` 字段，已抓住。
  3. **等价变异，删除**：我写的 `S18` 在 `realpathLoose` 里加了一个恒假的 `if`，等于没改。
  4. **性质不可观察，如实标注 `unobservable`**：「字面出仓不碰文件系统」（没有可观察副作用，ESM 的 `fs` 命名空间不可改写所以无法像 Python 那样 monkeypatch `realpath` 计次）；「循环读到底」（普通文件在本机一次 `readSync` 就返回全部，短读只出现在管道和网络文件系统）；`Number` 对 `BigInt` 的 `ino` 比较（只在两个不同文件的 `ino` 恰好 `Number` 相等时才有差别，构造不出）。`mutate.mjs` 把它们报告为 `△ 已知未验证`，**既不算通过也不算失败**。
- **一个被一次误判差点糊弄过去的测试**：「护栏之后路径被换出仓」那条，我第一版写成了**空壳 `skip`**（注释说「Windows 上做不到」），变异 `S22`（把钩子挪到打开之后）是它没有任何断言时唯一能暴露问题的东西。改成真正验证的版本，需要 `__testHooks.beforeOpen`（生产路径恒为 `undefined`）。**教训：「这个平台上测不了」要先试过，不要先写 skip。**
- **Windows 上 D8 的实测**：`ino` 的 `Number` 与 `BigInt` 读法相差 12，直接比较会把同一个文件判成两个，所以全程 `BigInt`；`O_NOFOLLOW`/`O_NONBLOCK` 在 Windows 上 Node 返回 `undefined`、Python 的 `getattr(...,0)` 为 0——这三道防线在 Windows 上本来就是空的，**如实写进 §12.6 D8，不假装有**。Linux 上的真实防线要在 Ubuntu 容器里验证（见下一步）。
- **一次测试侧的错误**：第一轮 `readBytes` 比对「失败」，看输出两边内容完全一样——是 `JSON.stringify` 的键序不同（`{hex,len}` 对 `{len,hex}`）。**是测试的比较方式错了，不是实现错了**；改成键序规范化后全绿。

### 12.9 `core/fs.ts` 在 Ubuntu 上验证时发现的、只在 Linux 上才暴露的事

做 fs 时我在 Windows 上把变异验证跑到「全部被抓住」，**然后去 Ubuntu 容器里重跑**，结果出了三件 Windows 上看不见的事：

1. **Linux 独有的两条防线 Windows 上本来就是空的**：`O_NOFOLLOW`（挡「末段被换成符号链接」）与 `O_NONBLOCK`（挡 FIFO 永久阻塞）。Windows 上 Node 返回 `undefined`、Python 的 `getattr(...,0)` 为 0，两边都空，所以黄金样本与 Windows 测试**对它们没有任何验证力**。补了两条 POSIX 才跑的测试（FIFO 靠子进程 + 超时杀掉验证不阻塞；`beforeOpen` 钩子在 realpath 与 open 之间把末段换成出仓链接），并在变异清单里加 `P1`、`P2`（`posixOnly`），`mutate.mjs` 在 Windows 上把它们报告为「△ 本平台不适用」而不是假装通过。
2. **`O_NOFOLLOW` 与 `dev/ino` 核对是一对纵深防御**：在 Linux 上单独去掉任何一道都被另一道兜住（我实测了三种组合：只去 `O_NOFOLLOW` → 被 `dev/ino` 拦下；只去 `dev/ino` → 被 `O_NOFOLLOW` 拦下；两道同时去掉 → 读到仓外内容）。所以 `P1` 是**复合变异**。这和 `S7+8`（超限的两道防线）同一类。
3. **同一条变异在两个平台上结论不同，根因是我的测试断言写在了「会因别的原因失败」的位置**：`S22`（把 `beforeOpen` 钩子挪到 `openSync` 之后）在 Windows 上被抓住、在 Linux 上没被抓住。我连改了三版才弄对——
   - 第一版靠「换目录这个动作本身在 Windows 上会因文件已被打开而失败」被抓住，**那是偶然的失败，不是测试在验证顺序**；Linux 上换目录总是成功，所以抓不住。
   - 第二版用「`openSync` 返回的 fd 赋给 `lastFd`」当哨兵，以为它「挪不动」。**错了**：`lastFd = fd` 那一行在 `openSync` 之后，钩子被挪过 `openSync` 之后仍然在 `lastFd = fd` **之前**被调用，所以哨兵看起来「还没变」。
   - 第三版把计数 `opened++` 与 `openSync(...)` 绑在**同一个表达式**里：`const fd = (opened++, openSync(...))`。钩子被挪到这个表达式之后时，`opened` 必然已经是 1。这才是让断言**不依赖行的先后、只依赖「open 是否已被调用」这个事实**的写法。Windows 与 Linux 上都被抓住。

   **教训：写变异验证的断言时，要问「这条失败是因为我要验证的那件事，还是因为别的偶然原因」。换了平台结论就变，说明是后者。**

**为此新增 `scripts/verify-ubuntu.ps1`**：用 `git bundle` 加容器内真实 `git clone` 带代码进去（**不用 `git archive`**，它按导出端的 `autocrlf` 转行尾）、可用 `-Overlay` 把工作区里**未提交**的文件覆盖进去、可用 `-Mutations fs` 另跑变异清单、可指定 Node 版本；容器名与临时目录名固定，只删自己创建的，跑完核对 0 残留。手工拼容器命令这一轮已经出过三次错（grep 格式对不上 Node 22 与 24 的输出、sed 锚点、漏拷文件），脚本化后一次通过。

### 12.10 `core/git.ts` 完成时量出来的事

- **验证做的是行为，不是代码长什么样**：安全加固这一类，「代码里有 `core.fsmonitor=false` 这一行」什么都证明不了。测试在临时目录建**恶意仓**——配置里写 `core.fsmonitor`、`diff.evil.textconv`、两个 `clean` 过滤器（其一名字带 `=`）、`diff.external`，每个都 `touch` 一个标记文件——**先跑不加固的对照组，断言标记文件确实出现了（4 个被执行）**，再跑加固后的实验组，断言一个都没出现。没有对照组的「没被执行」不证明加固起了作用。
- **第一次跑 textconv 被执行了**：不是 `core/git` 的 bug，是责任划分我没读清楚——`diff.<驱动>.textconv` 的驱动名由被扫方起、列不全，**所以 `git blame` 必须由调用方带 `--no-textconv`**（Python 版 `check_drift` 就这么写，`stdlib` 并不挡它）。我的测试第一版没带它，是测试错了。已把「责任划分」写进 `git.ts` 头注释，并列出迁移后续检查器时**不能漏**的两条（`--no-textconv`、`--literal-pathspecs`）。**这类「不在本模块、靠调用方」的防线最容易在迁移时丢，所以单独列。**
- **D9 的实测**：本机实测 Python 里 `os.environ[k]=""` 再继承给子进程会让 git 报 `missing config value`（`rc=128`），而 Node 里两种写法空串都能传到子进程。所以 Python 为此绕的弯在 TS 里不再必要，但**取值保持 `true`**（行为不变，且已被安全审计认可），**并且不照搬「改本进程环境」**——TS 模块可能被 DSH 插件宿主加载，改宿主进程的环境会泄漏到别的插件。**这是预防性的：现在 `lib/index.js` 只导出守卫，`core/*` 不在导出链里，没有受影响的路径。**
- **两个测试环境的坑**：①`os.devNull` 在 Windows 上是 `\\.\nul`，**git 不接受它当配置文件**（`rc=128`），屏蔽用户级与系统级 gitconfig 要用一个真实的空文件；②本机的系统 gitconfig 里有 `git-lfs` 的过滤器，所以「一个过滤器都没配」的测试要先屏蔽这两层，否则测的不是它想测的场景。
- **变异验证 30 条：29 条被抓住，1 条如实标 `unobservable`，0 条没被抓住；Windows 与 Ubuntu 结论相同（这次没有出现两平台不同的变异）。** 首轮 31 条里有 5 条没被抓住：`G9`（`hardenedEnv` 偷写 `process.env`）——**DSH 会话里 `GIT_PAGER` 本来就是 `cat`，写入 `cat` 前后看不出差别**，改用哨兵值才能区分；`F9`、`F10`（需要「有过滤器」「名字自己带点」的仓才有差别）；`F1` 是我写的等价变异（`Set` 还是 `Set`），删除；`H1`（浅克隆判断不认大小写）真实 git 只输出小写，无可观察差异，如实标注。
- **范围收窄的一个决定**：`tracked_files` 不在这一块迁。它调用 `embedded_std_rel`（`.std/` 内嵌机制，阶段 4 要废弃）与 `scan_memo`（`run_all` 的缓存上下文）。迁它时才能决定「内嵌判定」是直接删还是保留成空实现——放到 `check_all` 汇总层，那时才清楚全局怎么用它。

### 12.11 `core/config.ts` 完成时量出来的事

- **证据**：对 Python 版 `load_config` 的黄金样本（`golden/unit/stdlib-config.json`）逐条一致，含**精确的报错信息**——104 条用例（接受 30、拒收 74）、6 条原始字节、7 种文件布局、4 个真实仓已提交的 `project.yaml`。UTF-8 首个无效序列的起点对着 Python 的 `UnicodeDecodeError.start` **穷举 406,900 个序列**（25 个边界字节 × 长度 1 到 4）逐一致，样本只存规格与 sha256，TS 侧重新枚举后比哈希。
- **变异验证 78 条：Windows 77 抓住 + 1 条仅 POSIX（`C6`，Ubuntu 上抓住），Ubuntu 上 78 条全部抓住。** 首轮 77 条里 **16 条没被抓住或无效**，分类处理：
  1. **黄金样本盲区，补了输入**（占大头）：`derived` 的 `source`、`tailoring` 子项、`layout.artifacts.entry` 允许列表、`metadata_required` 的 `././docs`、行号定位认引号键与列表项首键（`- key:`）、键名里的正则元字符（`.` `(` `[` `*` `+` `?`）。
  2. **纵深防御，改成复合变异**：`C55`（拒收时返回半成品 `cfg`）被 `loadConfig` 的 `if (problem) return [{}, problem]` 兜住——内层返回半成品、外层清空，外部不可观察；`C27`（布尔当整数）被「字面必须是整数」第二道挡住。改成两层同时去掉。
  3. **直接断言补缺**：`leadWord` 的「长别名优先」（短别名排前面时要取长的）、数字也算字母数字（阿拉伯数字、带圈数字 ②）、等长别名保持原顺序；符号链接指向仓外的配置文件拒读。
  4. **平台相关**：`C6`（越界检查不认盘符）在 Windows 上被 `isAbsolute` 先挡住，不可观察；标 `posixOnly`，Ubuntu 上验证。
  5. **变异本身写错**：`C15`（编译不过）、`U1`（锚点对不上），已修。
- **一个 JS 特有的真实缺陷，是在写测试之前就想到、验证后确认的**：YAML 里的键是**被扫方写的任意字符串**，`__proto__: x` 在 JS 里直接赋值会**静默吞掉**（标量）或**改掉对象原型**（值是对象），而 Python 的 `dict` 里它只是普通键。我在 `yaml.ts` 里用 `Object.defineProperty` 建自有属性，并补了 8 条 `__proto__`、`constructor`、`toString` 的黄金样本与变异 `Y16`。**这类 JS 与 Python 语义差异不会出现在「对 Python 黄金样本逐条一致」之外，除非主动想到它们——黄金样本只能证明样本里有的。**
- **两个我自己犯的错**：①第一次写黄金样本脚本时命令被拒，我用 `write` 工具重写；脚本里**两次生成逐字节不同**，查出是 `--config` 指向项目之外时 `_path` 是含随机临时目录名的绝对路径，已归一为 `<CONFIG_PATH>` 并另记 `path_key_is_abs`（它本身是契约的一部分：外部配置记绝对路径、项目内记相对路径）。②变异清单追加时，第一次用「替换文本锚点」去改 `make_unit.py`，**锚点没匹配上，整个脚本中止，黄金样本与变异清单都没改**，而我紧接着看到的「152 条」「29 条」其实是**旧值**——差点把它当成新结果。以后追加变异一律用 JSON 读写。
- **一个收紧**：`readConfig` 里最初 `catch` 了「任何 `Error`」并记成「读不了」，这会把**检查器自己的程序错误**伪装成「配置读不了」。Python 只捕获 `OSError`；TS 版改成只吞本模块的拒读类与带 errno `code` 的系统错误，其余向外抛，变异 `C56` 与对应测试钉住。

### 12.12 `core/exceptions.ts` 完成时量出来的事

- **证据**：对 Python 黄金样本（`golden/unit/stdlib-exceptions.json`）逐条一致——关闭态 65 条、表格行拆分 27 条、表头归类 33 条、第一张表 65 条、`loadExceptions` 65 个 `exceptions.md` 样本（登记行 33、问题 24）、4 条原始字节、5 个运行日（含闰年）、6 种文件布局。变异验证 64 条：**Windows 与 Ubuntu 都是 62 抓住 + 2 条如实标注 + 0 漏**。
- **UTF-8 诊断从「起点」扩展到「起点 + 终点 + 原因 + Python 整句文本」**：登记册读不了时 Python 把整句异常（`'utf-8' codec can't decode byte 0xe9 in position 2: invalid continuation byte`）塞进 `problems`，所以 `core/utf8.ts` 新增 `diagnoseUtf8` 与 `pyUtf8ErrorMessage`，对同样 406,900 个序列再穷举核对 `start`、`end`、`reason`、整句文本（两个独立哈希）。**一次全对，没有返工**——但那是因为我先用 Python 穷举出了五种信息形状（`byte 0xHH` 对 `bytes ... position N-M`、三种 reason）再写规则。
- **D10（系统错误整句措辞不复现）与一次我自己改正的事实错误**：设计里我最初写「Windows 简体中文系统上是中文」——**那是凭印象写的**，查实本机（en-US）Python 的 `FileNotFoundError` 文本是 `[Errno 2] No such file or directory: ...`、`winerror` 为 `None`，与 POSIX 相同。已改正，并如实限定：我只验证过 en-US，**不对其它语言环境下结论**；TS 用固定措辞 `<异常类名>: <路径>`，不复现 `[Errno N] strerror`。
- **变异首轮 65 条里 10 条没被抓住或无效**：
  1. **锚点写错 4 条**（X3 到 X6）：模板字符串里的反斜杠转义层数，按源码真实文本改。
  2. **等价变异 1 条删除**（X23）：表头包含匹配里「再看小写」——七个 token 全是中文，`lower()` 对中文恒等，改不改都一样。
  3. **测试盲区补测试 4 条**：`ENOENT` 与别的 errno 的类名映射（`errnoName`）；自有例外的到期按严格模式（`日期 + 文字` 要被拒）；`dayNumber` 用本地时区还是 UTC——**需要在有夏令时、半小时偏移（`Asia/Kolkata`、`Australia/Lord_Howe`）、UTC+14、UTC−12 的时区下跑子进程比较结果，单在本机时区里永远看不出**；`todayLocal` 取本地日期还是 UTC（固定一个本地与 UTC 日期必然不同的时刻）。
  4. **两条标 `unobservable`（X52、X53）**：见下一条。
- **一个值得单独记的发现：`governance/` 本身是指向仓外的目录符号链接时，`loadExceptions` 单独调用会读到仓外的登记册内容**——Python 版如此（黄金样本 `echoed=True`），TS 版与之**一致**。我用真实入口 `check_all` 验证了影响面：默认读配置时 `load_config` 先判真实位置、拒读，**走不到登记册**，报告里没有仓外内容（`TOPSECRET` 未出现）。所以这是**上游一道防线兜住的下游缺口**，不是现行漏洞。我**没有擅自收紧**：收紧是行为改动，要走「有意差异」登记；且这里的价值是确认上游那道防线在 TS 里也在——`config` 的变异 `C51` 与本文件里一条 `loadConfig` 断言钉住它。`guard` 与护栏基准这两条变异因此无可观察差异，标 `unobservable` 并写明全部理由，不折算通过。**这是个应该告诉 Alan 的事：如果将来有人在 DSH 里直接调用登记册读取、绕过 `loadConfig`，缺口会暴露。**
- **一个我写错的测试期望**：`addDays(2023-12-31, 59)` 我以为是闰日 2024-02-29，实际是 02-28（加 60 才是）；期望值要用 Python `date + timedelta` 实算，不要心算。

### 12.13 `core/docs.ts` 完成时量出来的事

- **证据**：对 Python 黄金样本（`golden/unit/stdlib-docs.json`）逐条一致——`find_field` 2880 条输入（文本 × 名字集合，含 Unicode 大小写折叠、满行星号、全角冒号与全角空格、`\r` 行尾）、`head_of`、`item_status`、`status_kind`（3 套配置 × 14 个路径 × 16 个状态值）、配置派生函数（57 套配置）、入口候选的文件系统夹具。变异验证 110 条：**Windows 110 抓住；Ubuntu 109 抓住 + 1 条 `winOnly`（P12，如实标注）；两平台 0 漏**。
- **三个新的「正则标志在两种语言里语义不同」**，**这个模式已经出现四次**（D5 `\w`、D6 `\s` 与 `strip`、D11 `re.I`、D13 `m`），**每个用到正则标志的地方都要逐个验证，不能默认等价**：
  1. **D11 `re.I`**：逐码点实测（0x110000 个码点 × 26 个 ASCII 字母）——JS 的 `i` 漏 4 个（`İ ı ſ K`），`iu` 漏 2 个（`İ ı`）。**我最初把四个都手写进特例表，变异验证发现 `ſ`、`K` 两项对 `iu` 是多余的**（去掉不改变结果），已收窄；`u` 标志不能省（变异 F20 钉住）。
  2. **D13 `re.M` 的 `^`**：Python **只认 `\n` 之后**，JS 的 `m` 在 `\r`、U+2028、U+2029 之后也认。后果是真实的：`# T\n状态：a\r## B\r状态：b`（旧 Mac 行尾或混合行尾），Python 里 `\r## B` 不算标题行，JS 会切断。**这条是黄金样本里我补了一条混合行尾输入才暴露的**——之前所有样本都用 `\n`，一路全绿。改成显式的 `(?<![^\n])`。
  3. **D4（`\d`）又一次出现**：`WI-１２３.md` 全角数字，TS 与 Python 不同，按已登记的 D4 处理。
- **D12 扩写**：配置形状非法时（`layout.frozen` 写成字符串、`layout.entry` 写成整数），Python 的行为是偶然的（逐字符迭代、`TypeError`），**真实入口全部走不到**（`load_config` 已整份拒收）。TS 当空、不崩，黄金样本里这两条按 D12 跳过。
- **变异首轮 114 条里 21 条没被抓住**，分类处理：
  1. **黄金样本盲区（大头，约 15 条）**：竖线紧邻名字、装饰上限 3 对 4 对 5、制表符、值为空时是否继续找、`U+FEFF` 与 `trim`、六级标题、改基的各种写法、反斜杠前缀、裁剪理由的空白、同名两条的先后、数字 `check`、声明路径的 `././`。**一次补 20 多条输入，从 21 降到 15，再对齐锚点后降到 1**。
  2. **等价变异删除 3 条**：`R2`、`R5`（`docs_root` 就是 `docs` 时改基结果逐字相同；`slice(5)` 配 `'/'` 等价）、`F26/F27`（折叠特例对 `iu` 多余）。
  3. **测试读的是参数而非常量（D3）**：`STATUS_FIELDS` 的顺序变异，`findField` 的测试传入 `names` 参数、不经过常量；补了经 `itemStatus` 走常量的断言。
  4. **我改了源码后变异锚点失效 7 条**（F1、F18 到 F20、H6 到 H9）：变异清单与源码要同步，否则「锚点命中 0 次」会被当成「无效」而不是「没抓住」——**这类无效变异不报错但也不验证任何东西**。`mutate.mjs` 已把它计为失败，所以被发现了。
  5. **平台相关 1 条（P12）**：`docs\WI-002.md` 里 `\` 是否路径分隔符——Windows 上是、Linux 上不是。**黄金样本在 Windows 上生成，Linux 上 Python 自己对它也返回 False，我在容器里直接实测了**。所以 `isWorkItemName` 的这类输入按平台期望，变异 P12 标 `winOnly`（`mutate.mjs` 新增，与 `posixOnly` 对称）。
- **Ubuntu 暴露的这一条，是又一次「Windows 全绿而 Linux 不是」**（上次是 fs 的 `O_NOFOLLOW`）。我没有直接改期望糊弄，而是先在容器里用 Python 实测它的行为，确认是路径语义差异再按平台处理。`scripts/verify-ubuntu.ps1` 也因此改进：**失败时把断言细节（`failing tests` 之后 60 行）打印出来**，不然只知道哪条红、不知道为什么，还要再手拼命令进容器。
- **一个流程教训**：这一轮我**两次**把 `edit` 当成成功了——`edit` 因「文件在读取后变了」失败时，同一批并行的 `pwsh` 照常往下跑，输出里的数字（`17/17`、`605`）其实是**旧测试**的结果。第二次我改成用输出里的**测试名**（「含新测试: True」）确认新测试真的在跑。**并行批里「编辑」与「依赖该编辑的验证」不能放在同一批。**

### 12.14 `core/shell.ts` 完成时量出来的事

- **为什么先迁它**：读 `entry_budget` 时发现它依赖 `run_guarded`、`unreadable`、`once` 等一批外壳函数——它们是**每个检查器**都用的，不属于任何一个检查器，所以单独成块、先于第一个检查器迁。`tracked_files` 一类仍推迟（依赖 `.std/` 内嵌机制）。
- **证据**：对 Python 黄金样本（`golden/unit/stdlib-shell.json`）逐条一致——18 种异常 × 三个函数、`probe` 的 9 种真值、`once`、`agg` 的 0 到 100 份、`run_guarded` 的 15 种组合（5 种裁剪配置 × 3 种 fn）、`work_root_absent` 的 8 种情形。变异验证 50 条：**Windows 49 抓住 + 1 条 `posixOnly`（W3），Ubuntu 50 全抓住，0 漏**。
- **一个由黄金样本比出来的真 bug，不是变异发现的**：`excTypeName` 我最初写成「带 `code` 字符串的都是 `OSError`」，但本模块自己的拒读类（`OutsideRoot`、`TooLarge`、`NotRegular`）**也带 `code`**，所以被吞成 `OSError`。后果不是显示问题：类名进 `unreadable` 的**标题**（`docs/a.md 读不了（OutsideRoot）`），而 `unreadable` 给了 `kind` 所以 id 不变，但**别处没给 `kind` 的构造点标题变了兜底 id 的哈希就变**。改为先判拒读类。**这种「某个分支吞掉了另一个分支」的错，测试里不存在直接对应的单点断言，只有对着 Python 的整条输出才暴露。**
- **一个我自己犯的、刚登记过的错**：`workRootAbsent` 里 Python 的 `rel.replace("\\","/").strip()`，我第一版写成了 JS 的 `\s` 去空白——**正是 D6 登记过的「不能用 `\s` 与 `trim`」**，写代码时没想起来，靠写变异清单（`W5`：U+FEFF）时才发现。**教训：已登记的约束不会自己执行；要么有机械检查，要么每次写新代码前重读。** 下一步我打算给「`src/` 里出现 `.trim()` 或正则 `\s`」加一道自动检查（见下）。
- **D14（异常类名不对应）**：Python 的 `KeyError`、`ValueError`、`ZeroDivisionError` 等在 TS 里没有对应物，进 `reason` 的类名不同。这部分**只比结构**（id、status、where、是否有 reason），不比类名；OSError 家族按 errno 映射、本模块拒读类按各自名字。**实测黄金样本（4 个真实仓 + 228 探针）里没有任何一条 finding 的 `reason` 含 Python 异常类名**——所以这条差异对验收口径（只比 `check, id, status, where, registered`）零影响。
- **一个流程上做对了的事**：这一轮我把「创建文件」「构建」「运行测试」「依赖编辑的验证」**分成不同的批次**，没有再出现上一轮「编辑失败但并行验证照跑、读到旧结果」的事。W3/W5/N4 补测试后，我用输出里的测试名（`含新测试: True`）确认新测试真的在跑，才信变异结果。

### 12.15 机械检查 `scripts/check-py-semantics.mjs`：把已登记的约束变成会执行的东西

- **起因**：§12.14 记了一件事——D6 早已登记「不用 `trim()` 与 `\s` 处理被扫文本」，我自己写 `workRootAbsent` 时又违反了一次，靠写变异清单才偶然发现。**已登记的约束不会自己执行。**
- **做了什么**：新增 `scripts/check-py-semantics.mjs`，扫 `src/core/`（**不扫 `src/guard/`**：守卫是 JS 原生实现，不是 Python 的移植，不需要与 Python 对齐），禁止五类写法：`.trim()` 一族（D6）、正则 `\s \S`（D6）、`\w \W \b`（D5）、`\d \D`（D4）、正则 `m` 标志（D13）。注释里的不算；确有理由的在行尾写 `// py-semantics-ok: 理由`（**理由必填**，不写理由本身就是违规）。`test/py-semantics.test.mjs` 对它做变异：18 种违规写法必须全被抓住、12 种合规写法必须全被放行、真实 `src/core` 必须 0 违规、`src/core` 不存在时必须退出码 2（不是静默通过）。
- **首次运行就在现有源码上抓到 5 处**：`config.ts` 2 处 `\s`（`numKinds` 的两个正则，输入已通过 YAML 解析，实际风险小，但仍按约束改成显式空白类）、`git.ts` 2 处 `.trim()` 与 1 处 `\d`。另外 `config.ts:241` 的 `.trim()` 是个**真实的小风险**（预算键名带 U+FEFF 时对不上，脚本之前我手工审计时发现并修了）。全部改成 `pyStrip` / `[0-9]` / 显式空白类，行为不变，全部测试仍过。
- **一个被 `\s` 规则放宽的细节**：我最初为了放过 `[\s\S]`（「任意字符」，不是空白语义）写了个带前后断言的复杂正则，**测试立刻显示它放过了 `[\s|>]`（字符类里的 `\s`）**；去掉复杂断言、改成无条件抓 `\s`，`[\s\S]` 的放行靠先把这个字面子串从待查文本里删掉。**简单的规则加例外，比复杂的规则更不容易漏。**
- **没接进提交闸门——这是个待你决定的事**：我准备把它作为 `.githooks/pre-commit` 的第五道，**这一步的编辑被拒绝了**。我没有绕过（钩子是受控动作，需要你同意）。现状：脚本 + 测试都在，`pnpm test` 会跑到 `py-semantics.test.mjs` 里的「真实 src/core 当前无违规」那条，所以**测试套件已经间接守着它**；只是提交时不会单独拦。接不接、是否另有想法，见本轮汇报。

### 12.16 第一个检查器 `entry_budget`：验收脚手架、`isFile` 统一、`realpath` 对断链的缺口

- **验收脚手架**：`scripts/golden-compare.mjs <检查器名>`——在黄金样本钉住的提交上建临时 worktree、跑 TS 版**一个**检查器、与 `golden/samples/<名字>.json` 里该检查器的条目逐条比（口径同 `make_golden.py`：只比 `check`、`id`、`status`、`where`、`registered`）；`scripts/golden-selftest.mjs <检查器名>`——TS 版 `selftest()` 产出的 `(id, status)` 集合必须与 `selftest-probes.json` 里该检查器的条目**完全相同**。后者比逐条看标题强：探针 id 是 `sha1(标题)[:8]`，**标题差一个字 id 就不同**，所以集合相等同时钉住条数、措辞与结论。能单检查器验收的前提——Python 版里单跑一个检查器与它在整体里的结果完全相同——我先实测了一遍，不是假设。
- **证据**：`entry-budget` 对 4 个真实仓逐条一致（各仓条数见黄金样本）；`selftest` 10 条的 `(id, status)` 集合与黄金样本完全相同；变异验证 62 条，**Windows 62 全抓住、Ubuntu 62 全抓住**；全量测试 Windows 660 条（656 过 0 败 4 跳）、Ubuntu 660 条（635 过 0 败 25 跳，多出的跳过是 Windows 专属与本机真实仓的）。
- **检查器的自检暴露了 `core/fs` 的黄金样本盲区（这是本轮最值得记的一件事）**：`entry_budget` 的自检第 10 条要求「指向仓外**不存在**文件的断链」被判为出仓。TS 的 `realpathSync` 对断链抛 `ENOENT`，我的 `realpathLoose` 随即退到上一级求路径，把它当成了仓内；Python 的 `realpath` 照算链接目标。`core/fs` 阶段的黄金样本里没有断链，所以一路全绿。修复：`realpathLoose` 遇到 `ENOENT` 先判这一段是不是符号链接，是就跟随它（上限 40 层，循环链原样返回、不抛，与 Python 的非严格 `realpath` 一致）；补 7 种断链/循环链/相对出仓夹具进 `make_unit_fs.py` 与 `fs.test.mjs`（样本从 190 条增到 239 条）。
- **`isFile`/`isDir`/`lexists` 此前在 5 个文件里各写一份**，都直接用 Node 的 `statSync`——这违反「同一事实只一处」（01 §1 G2），也让一个平台差异无处统一修。差异：路径带尾分隔符的**普通文件**（`S.md/`），Python 的 `os.path.isfile` 为 False，Node 的 `statSync` 在 Windows 上照样 stat 到文件。统一收进 `core/fs.ts`，新增 `golden/make_unit_pathpred.py` 在真实夹具上对 14 种路径写法 × 14 种夹具记 Python 的结论；`pathpred.test.mjs` 与 14 条变异（Windows 全抓住；Ubuntu 9 抓住 + 5 条 `winOnly`——Linux 上 `statSync("文件/")` 本来就抛 `ENOTDIR`，尾分隔符判断冗余，与原代码等价，如实标注，不折算通过）。
- **D15（有意差异）**：Windows 上 Python 按 Win32 规则去掉路径名**末尾的空格与点**（`f.md ` 读到 `f.md`，`isfile` 为真），Node 不做，两者都认为不存在。TS 不复现：同一份脚本在 Linux 上 Python 的结论也是「不存在」，这是 Windows 文件系统的怪癖，不是契约。**影响面**：配置里能写出这样的路径（YAML 引号内的尾空格，`load_config` 不拦），但**四个真实仓的 78 个路径值里没有**；写成这样的路径，TS 报「文件不在」，Windows 上的 Python 报「在」。已有断言钉住 TS 的行为（`D15：名字末尾的空格与点不去掉`）。
- **Windows 与 Linux 上 Python 自己的结论也不同**：同一份路径谓词样本，在两个平台上有 85 条（共 196）不同。所以样本只在生成它的平台上比整份，其余平台只比平台无关的核心（无后缀、尾斜杠、不存在、符号链接）。这与 §12.13 里 `docs\WI-002.md` 的结论同类：**黄金样本是平台相关的，跨平台验证不能指望同一份期望**。
- **变异首轮 62 条里 14 条没抓住**：分类——测试没覆盖的输入补 8 条（合并工件刚好等于最宽预算、只有一类声明、`work_root` 写成空串、`docs-within` 汇总的 12 份上限、默认参考值、读不了、跨类排序、尾斜杠、`work_root` 出仓链接）；锚点编译不过 4 条（放宽类型改写成 `multi` 复合变异）；**纵深防御 2 条**（`D8`、`D9`：目录内排序与按文件排序互为冗余，只有同时去掉才可观察——改成复合变异）。其中「读不了」一类要注入 `EACCES`，用的是 `fs.ts` 里早就为 S22 留的 `__testHooks.beforeOpen`，没有新增生产代码里的测试后门。
- **机械检查立刻抓到我刚写的代码**：`fixture.ts` 里一处 `.trim()`（只用在错误消息里）。`check-py-semantics` 跑起来的第二次就有收获，没有靠我记得。
- **两个我写错的、被测试当场指出的假设**：1) 我以为 `run()` 对只有入口的配置只返回入口那一条，实际总会附带四条 `budget-undeclared` 的 SKIP；2) 我以为 `lexists` 不受尾分隔符影响，Windows 上它同样不同——这条是 `pathpred` 的整份比对抓到的，因为我最初只补了 `isFile`。
- **一个流程上的不确定**：本轮中途有两次 `pwsh` 调用被拒（含一次纯只读的状态确认），我停下来不换花样重试，下一轮开头用最小的只读命令试探后恢复。原因不明，不做推断。

### 12.17 `core/glob.ts`：为 `layout` 的存在性判据补一块 core，刻意只实现子集

- **为什么要有它**：`layout` 的 `glob` 判据（L2 的「项目侧检查器」`tools/check_*.py` 一类）用 Python 的 `glob.glob`；JS 没有内置 glob（Node 22 的 `fs.globSync` 是实验性的、语义也不同）。**全仓只有这一处用 glob**，且候选写死为三种形态，所以**不引依赖、不做通用 glob**，只实现够用的子集：`*`、`?`、`[...]`、`[!...]` 只在单个路径段内、不匹配隐藏文件、`**` 不递归（Python 没带 `recursive=True`）、根按字面（C14：扫描根路径可能含 `[ ] * ?`）。
- **证据**：对 Python 样本（`golden/unit/glob.json`：若干种根名——含 `a[b]`、中文与空格；一棵含隐藏文件、中文名、符号链接、断链的夹具树；几十种通配写法；条数以样本为准，本节不抄）逐条一致；变异验证 29 条，**Windows 27 抓住 + 2 条 `posixOnly`，Ubuntu 28 抓住 + 1 条 `winOnly`，两平台 0 漏**；全量测试 Ubuntu 678 条 0 败。
- **一个这轮反复出现的毛病**：我在写断言时有三次写出了**不是断言的东西**——一条 `deepEqual(x, 一长串绕来绕去的过滤表达式)`、一条带「占位」字样的、一条恒真的 `!a === false`。**每一次都是在写测试的当下想「先让它过」，而不是写出它该守护的事实。** 处理办法：写完断言先问「把实现改错，它会红吗？」；变异验证会兜底，但应该在写的时候就拦住。另有一次我把期望写反（`*/check_a.py` 本该命中 `tools/check_a.py`，我写成 0 条）——靠基线红才发现，这是好的失败。
- **变异首轮 32 条里 10 条没抓住**，分类：字符类边界（`^` 在 Python 的 fnmatch 里是字面不是取反、`]` 作首字符、`-` 在两端）这类 Python 特有语义，样本里缺；等价或子集外 3 条删除（`G24` 模式 `/`、`G26` 空层后继续、`G31` 绝对模式——layout 只用相对候选）；Windows 与 Linux 各有只在本平台可观察的 3 条标注；**`G32`（根按字面）在 Linux 上没被抓住是真盲区**：整份比对在样本平台以外被跳过，而「第一段就是通配时读的是根目录本身」这条性质没有独立断言——补了。**这与 §12.16 的教训同类：「样本平台以外被跳过」的测试，守不住那个平台上的性质，必须有不依赖样本平台的断言。**
- **D16（平台差异）**：Python 的 `glob` 在 Windows 上经 `fnmatch` 的 `normcase`（小写）比较，所以 `Check_c.py` 匹配 `check_*.py`；POSIX 上区分。本实现 Windows 上带 `i` 标志、其它平台不带，**两个平台都与「在该平台上跑 Python」一致**。
- **刻意不收的**：模式 `/` 与 `//`（指向文件系统根，与扫描根无关，Python 的结论是偶然的）、`**` 递归、`{a,b}` 花括号（Python 的 glob 也不支持）。

### 12.18 第二个检查器 `layout`

- **证据**：4 个真实仓 finding 逐条一致（各仓条数 9、10、10、10）；`selftest` 探针 10 条的 `(id, status)` 集合与黄金样本完全相同；变异 89 条，**Windows 与 Ubuntu 都是 87 抓住 + 2 条如实标 `unobservable` + 0 漏**；全量测试 Ubuntu 720 条 0 败。
- **为它补的 core**：`core/glob.ts`（§12.17）；`splitLinesPy` 增 `keepends` 参数（`layout` 取头部 40 行用 `splitlines(True)`；对 158 条输入含 11 种行终止符逐条核对，19 条变异全抓住）；`exists`（Python 的 `os.path.exists`）并入 `core/fs.ts`——要点是**任何文件类型都算存在**，不能写成 `isFile || isDir`（那会把 FIFO 判成不存在），这条在 Linux 上用真实 `mkfifo` 验证。
- **变异首轮 93 条里 30 条没抓住**。分类：测试没覆盖的输入补 24 条（元信息头部边界 40/41 行、`\f` 作行终止符、超 2 MiB 文件、状态在 YAML 第 45 行、清单判据 `memory`/入口/`eval`、`work_root` 规范化、多个候选都在取第一个……每条的期望值都**先在 Python 版上实测**再写）；等价变异 4 条删除（`D2` glob 命中的是 `.py` 所以 `.md` 条件恒假；`N5` 入口 role 不属于 acceptance/status；`O2` 空串在两边都是假；`D27` 把 `${META_HEAD_LINES}` 换成字面 40，值相同）；**真实入口走不到的 2 条标 `unobservable`**（`R2`、`R3`：`load_config` 对 `layout.artifacts` 写成非映射整份拒收，直接调 `run()` 时非映射值上取属性得 `undefined`，与「当作没声明」结果相同）。
- **Ubuntu 又暴露两个只在 Linux 上红的盲区（D5、D6）**：「acceptance 文件缺元信息也判」与「目录 SKIP 只对 acceptance、status 报」。在 Windows 上它们被 4 个真实仓的比对**顺带**抓住——而那条测试在 Linux 上整条跳过（没有这四个仓）。补了不依赖真实仓的直接断言。**这是本轮第三次出现同一个模式**（§12.16 的 `lexists`、§12.17 的 `G32`、这里的 `D5/D6`）：**凡是靠「对真实仓/样本平台的整份比对」才被抓住的性质，在别的平台就没人守。** 以后写测试时，真实仓比对只当「额外的一道」，每个判据必须有自己的、不依赖外部数据的断言——这条我打算记进设计文档的验证口径一节（见下）。
- **一个我自己指出来的毛病**：写 `selftest` 对应断言时，我再次写出一段绕弯的表达式（`mk() && (() => {...})()`），发现后立即重写成两步。三个轮次里同一个毛病出现四次，说明「写完问一句：把实现改错它会红吗」这个办法对我并不自动生效——**真正管用的是变异验证本身**（它每次都在兜底），而不是我的自觉。因此本仓的验证口径应当是：**没有变异验证通过的测试，不算守住了那条性质。**
- **探针脚本是一次性的，用完删除**：我为查 Python 的真实行为写了 `golden/_probe_layout.py`，没进提交，已删（只删自己建的）。

### 12.19 `core/tracked.ts`：这一块我推迟了四轮，迁它时才查清楚「`.std/` 自排除」到底影响什么

- **为什么推迟、为什么现在做**：`links`、`single_authority`、`drift` 都依赖 `trackedFiles`，读 `links` 时不能再推。我原先的理由是「它调用 `embedded_std_rel`（`.std/` 内嵌机制，阶段 4 废弃），迁它时才能决定删还是保留」。
- **一个我之前没验证就信了的前提，这次实测推翻了**：我假设黄金样本在三个采用项目里「排除了 `.std/`」。实测相反——黄金样本是在 `TOOL_ROOT` = 本仓下生成的，`embedded_std_rel(扫描根)` 对三个采用项目**全部返回 `None`**，所以 **`.std/` 从未被排除**，采用项目里 `.std/` 下的文件一直在扫描面内（reservoir 的 `links` 扫的是它 `git ls-files` 的全部 markdown，其中大部分在 `.std/` 下）。反向证明也做了：把 `TOOL_ROOT` 指到 `扫描根/.std`，`links` 的计数才从「全部」变成「只有项目自己的」——那是**真内嵌场景**的行为。
- **D17（有意差异）**：不带 `.std/` 自排除。**对黄金样本零影响**（实测：三个采用项目上，`links`、`single_authority`、`drift` 三个检查器「排除」与「不排除」的 finding 集合完全相同）；新架构里采用项目本来就不再内嵌 `.std/`（§8），这个机制失去了对象。
- **证据**：对 Python 样本（真实夹具 git 仓：普通文件、中文名、空格、含 `[ ] # ,` 的名字、`.MD` 大小写后缀、嵌套目录、以点开头、工作项目录与其子目录、`.gitignore` 忽略的、未跟踪的、已删除但仍在索引里的、非仓、空仓；几十种模式与目录写法；条数以样本为准，本节不抄）逐条一致；变异 44 条，**Windows 42 抓住 + 2 如实标注，Ubuntu 44 全抓住，0 漏**；全量测试 Ubuntu 0 败。
- **一个安全对照实验**：`git ls-files` **会**执行被扫仓配置里的 `core.fsmonitor`（对照组：不经加固直接跑，标记文件出现；`git status` 同）。所以 `trackedFiles` 必须经 `hardenedEnv`——变异 L5（不加固）被恶意仓测试抓住，测试里先跑对照组证明这个攻击在本机真实可行，否则「标记文件没出现」什么也证明不了。
- **三个这一块暴露的、我本来不知道的事**：①**Windows 上 `col:on.md` 不报错**：NTFS 把冒号当备用数据流，建出的是名为 `col` 的文件——造夹具时必须核对「同名文件真的在目录里」才算造成；②**`git add` 对 `weird[1].md` 这类名字要加 `--literal-pathspecs`**，夹具自己的 `add` 也一样；③**`ls-files` 的 pathspec 要通配，所以这里不加 `--literal-pathspecs`**（与 `git log -- <文件>` 相反，那里的路径要按字面——`drift`、`freshness` 在各自的 `git log` 调用上加）。我最初还多写了一个 `--`，Python 版并没有，按 Python 原样改回，并加变异 L3 与一条测试（`-z`、`--others` 作「模式」传入会被 git 当选项）钉住。
- **变异首轮 46 条里 18 条没抓住**：补输入 11 条、等价变异删除 2 条（`U5` 排序：git 按 UTF-8 字节序与 Python 码点序对 UTF-8 一致，对 git 返回的列表排序是恒等；`W4`：空串时第一支 `dirname==base` 已覆盖根下一层）、`posixOnly` 1 条（`U7`，文件名含反斜杠只有 Linux 造得出，Ubuntu 上补断言抓住）、`unobservable` 1 条（`L9`，git 的 stderr 末尾不会有 U+FEFF）；`U6`（按 UTF-16 码元排序）要夹具里同时有 `Ａ`（U+FF21）与 `😀`（U+1F600）才可观察——码点序下前者在前，码元序下 `😀` 的首码元 0xD83D 小于 0xFF21 反而在前，补了夹具。
- **一次清理上的失误与处理**：我的一个一次性探针脚本在 Windows 上 `shutil.rmtree` 删 `.git` 里的只读对象失败，留下一个临时仓。我先核对路径确实是自己建的（精确名字、含 `.git`），去掉只读属性后删除，没有用通配批量删。这类探针以后用 `onerror` 去只读，或直接用 `tempfile.TemporaryDirectory(ignore_cleanup_errors=True)`。
- **再一次写出了没用的断言**：`withScanMemo` 测试里有一行 `'…'.slice(0, 0) || false`（恒假的绕弯表达式），发现后改成了真断言（无模式也是又一个缓存项，它第一次被调用发生在 `late.md` 已 add 之后，所以看得到）。这是第五次。

### 12.20 第三个检查器 `links`：Python 与 JS 正则语义差异最集中的一个

- **证据**：4 个真实仓 finding 逐条一致（各仓条数 1、1、1、3）；`selftest` 探针 8 条的 `(id, status)` 集合与黄金样本完全相同；变异 124 条，**Windows 与 Ubuntu 都是 123 抓住 + 1 条标 `unobservable`、0 漏**；全量测试 Ubuntu 778 条 0 败。纯函数（`maskCode`、`slug`、`atxTitle`、`titles`、`anchorsOf`、链接正则、scheme 判断、行号后缀、盘符、`unquote`）另有 `golden/unit/links.json` 的逐条比对，输入给得最密，条数以样本为准，本节不抄。
- **三个我写之前不知道、样本比出来的 Python 语义**（都已写进 `links.ts` 的头注释）：
  1. **`$`（无 `re.M`）也匹配末尾换行之前**：`a:1\n` 在 Python 里算「纯行号」，JS 的 `$` 不是。补 `(?=\n?$)`。
  2. **`\d` 认全角与阿拉伯数字（D4）**：`ab:１` 的「冒号后是纯数字」成立，所以不当 scheme 跳过。不能用 `[0-9]`，用 `\p{Nd}`。
  3. **`re.I` 的折叠集（D11）**：逐码点实测，非 ASCII 里只有 `İ ı ſ K`（U+0130、U+0131、U+017F、U+212A）与 ASCII 字母等价，且 `tel`/`sms` 里只有 `s` 有 `ſ`。`<a id|name>` 里 `i` 要并上 `İ ı`。
- **`\w` 的结论（D5，实测）**：Python 的 `\w` 与 `[\p{L}\p{N}_]` 在**同一 Unicode 版本**下差集为空（两个方向都是 0）；Node 的 Unicode 更新（17.0 对 Python 的 15.0），多认的全是 Python 版本里未分配的码点，量级固定在一万个以内。所以 `slug` 直接用 `\p{L}\p{N}_`，不需要补集表。
- **`unquote` 自己实现**：Python 的 `urllib.parse.unquote` 把连续的 `%XX` 收成一段字节、一次按 UTF-8（`replace`）解码，非法序列各换成 U+FFFD，`%` 后不是两个 ASCII 十六进制数字的原样保留，不处理 `+`。对 86 条输入（含残缺序列、过长编码、代理区、非字符）逐条一致。
- **变异首轮 130 条里 28 条没抓住**：补输入 21 条（显式锚点的 `name`、大写 `<A ID>`、单引号、等号两侧空白、制表符分隔；`%3F` 解码后不再当查询串；锚点取第一个 `#`；超过读取上限的目标带锚点；等等，每条期望值先在 Python 版实测）；**等价变异 6 条删除**（`G10`/`G11`：对 1400 个带各种首尾字符的标题（10 种前缀 × 10 种后缀 × 14 种内容）、两种下划线模式共 2800 次比较做差分，`slug` 开头的 `strip` 是冗余的，因为末尾 `\s+` 折叠前还有一次；`H2`/`U10`/`H37`/`H43` 见下）；`H49` 标 `unobservable`（`load_config` 对 `layout.frozen` 做形状校验，同 D12）。
  - `H2`：链接正则的两支 `<…>` 与裸写法互斥，同一次匹配里两组不会同时有值，先取谁都一样；`U10`：按码元压入再 `join` 与原串相同；`H37`：git 的 pathspec 已只返回 `*.md` 与 `*.markdown`，后缀过滤冗余；`H43`：缓存存在性只影响性能。
- **这次我又被同一件事绊了一下**：变异验证的第一轮跑了近 40 分钟，我在等待期间重复调用了同一个 `job_output` 好几次（被系统提醒「重复同样调用」）。更好的做法是等待期间做不依赖源码的分析（我最终这么做了：用探针与小脚本判断哪些是等价变异），而不是反复轮询。**变异验证本身很慢（本块 130 条约 40 分钟），这是一个真实成本**：以后每个检查器写变异清单时，应把「证明等价」的工作放在跑之前（对每条变异先问「能构造出一个让它与原实现输出不同的输入吗」），而不是跑完才删。
- **Ubuntu 又暴露两处只在 Linux 上红的**（本轮第四次同类，§6 第 6 条的规矩仍管用）：①链接里的反斜杠 `sub\\s.md` 在 Windows 上是分隔符、在 POSIX 上是文件名的一部分——Python 在 Linux 上对它判断链，我的断言按 Windows 写成了「不报」；先在 Linux 容器里用 Python 实测、再按平台分支写断言；②「围栏改成贪婪」的变异（`M6`）在 Linux 上没被抓住——在 Windows 上它被 4 个真实仓比对顺带抓住，补了「两个围栏之间的正文不被涂白」的直接断言。
- **探针脚本的清理**：我的一次性探针留下了两个临时目录（其中一个含 3 MB 文件）。逐个核对（精确名字、父目录是 TEMP、无 `.git`）后才删，没有用通配批量删。

### 12.21 `core/repr.ts`：统一 Python 的 `%r`——读 `freshness` 前发现的一处重复

- **起因**：`freshness` 里 `%r` 用在日期原文、预算值、配置值上；写它时我数了一下，TS 里**已经有八份**各自的 `pyRepr`/`pyReprStr`/`pyReprShort`（`yaml`、`git`、`dates`、`config`、`cfg`、`entry_budget`、`links`、`layout`），实现互不一致：有的只加单引号不选引号、有的不转义控制字符、有的不处理非 BMP、有的只管字符串。对 68 条字符串样本，`dates.ts` 那份有 20 条与 Python 不同。**这是与「同一事实一处权威」直接冲突的，也是每个新检查器都会再抄一份的地方**，所以在迁 `freshness` 前先统一。
- **做法**：新增 `src/core/repr.ts`（全仓唯一一份 `pyRepr`），删除八处私有实现，各处改 import。统一后全量测试 Windows 785 条、Ubuntu 785 条 0 败；三个已迁检查器（`entry-budget`、`layout`、`links`）对 4 个真实仓与 selftest 仍零差异，说明这次合并没有改变任何既有行为。
- **证据**：对 `golden/unit/repr.json` 逐条比对（字符串、整数、浮点、布尔、None、列表、字典、嵌套；引号选择、反斜杠与引号转义、`\n \r \t`、控制字符、非 ASCII 可打印、不可打印按码点宽度选 `\x`/`\u`/`\U`、非 BMP）；变异 31 条，**Windows 与 Ubuntu 都全抓住**。
- **「可打印」是 Unicode 版本相关的（D5 的又一处表现）**：Python 3.12.14 用 Unicode 15.0，Node 24 用 17.0。逐码点全量核对：**这里没有任何一个多判**（Python 认可打印而这里转义的为零）；少判约一万个，全是 17.0 新分配、Python 15.0 里仍是未分配（Cn）的码点，这里原样保留而 Python 会转义。对 `freshness` 这类只把用户配置里的值写进 `reason` 的用法，这个差别不会出现在黄金样本的比对口径里（只比 `check`、`id`、`status`、`where`、`registered`）。**样本只存了 712 个不可打印区间，不存 96 万个码点**（第一版存了逐码点，9.7 MB，发现后改成区间，25 KB）。
- **变异首轮 35 条里 4 条没抓住，全是等价变异，且其中三条暴露的是代码里的真冗余**：`DEL`（0x7f）不必单列（它落到「不可打印」分支同样转义）；`cp < 0x7f` 的边界换成 `0x7e` 输出相同（`~` 可打印）；`isPrintable` 里的 `ch === ' ' ||` 永远走不到（空格是 ASCII，在此之前已分流）；浮点的 `.0` 分支永远走不到（只对非整数调用）。我没有把它们标 `unobservable` 或留着，而是**直接删掉了冗余代码**，再让变异清单对应更新——这是变异验证最有价值的用法：不只是证明测试够强，也在指出「这行代码从来没起过作用」。
- **一个我踩到的循环依赖**：`cfg.ts` 的 `pyStr` 需要 `pyRepr`（列表元素），而新 `repr.ts` 最初借用了 `cfg.ts` 的 `pyStr`。改成 `repr.ts` 自己处理 None、True、False、数字，不再依赖 `cfg.ts`，`cfg.ts` 单向依赖它。

### 12.5 阶段 2 的验收口径（动手前先定，2026-10-06）

**规模实测**：Python 版 10,472 行；`stdlib.py` 1,491 行含约 90 个函数；各文件里引用审计编号或实测缺陷的注释共 **238 处**——每一处是一次真实踩过的坑，迁移时丢一处就是回归。平台相关系统调用（`realpath`、`lstat`、`symlink`、`mkfifo`、`os.open` 等）约 55 处。

**228 条 selftest 探针的三类**（按标题分类；拿不准的归 A，宁可高估 TS 要复现的数量）

| 类 | 条数 | TS 版怎么验收 |
|---|---|---|
| A 行为断言：输入 → finding 集合 | **225** | 逐条复现：同 id、同状态。**这是主体，一条都不许丢** |
| B 依赖 OS 特性（符号链接、FIFO、稀疏文件、打开后换目录） | 10（含在 225 里） | 按平台构造夹具；Windows 造不出的（FIFO）如实记 SKIP，**不折算为通过**——Python 版自己就是这么记的 |
| C Python 运行时特性，TS 没有对应物 | **3** | 逐条定义 TS 里的等价断言，写进设计：`RecursionError`（1200 层嵌套不崩）→ TS 的栈溢出是 `RangeError`，断言「不抛、记未定」；两条「`realpath` 调几次」→ 换成「读一份文件不超过 N 次文件系统元数据调用」，N 取实现后实测值并写明 |

**分类时我犯的一个错**：第一版正则把「探测三之三：…标题**计数**变而 id 不变」误判成实现细节（因为含「计数」二字），C 类先得 5 条；逐条读标题后更正为 3 条。**这说明按关键词分类要抽样复核**。

**迁移的单位与顺序**（依赖序，每个检查器单独验收再迁下一个）：

1. `core`（对应 `stdlib.py`）：先于一切。**拆成几个文件**而不是一个 1,500 行的 `stdlib.ts`：`finding`（三态与 id）、`yaml`（严格子集解析）、`config`（加载与路径护栏）、`fs`（受限读取：`read_bytes`/`read_text`/`tracked_files`）、`git`（环境加固与版本检查）、`exceptions`（例外登记册）、`docs`（元信息、状态词、工作项）。拆分依据是现有注释里的分节，不是我的新设计。
2. 其余 11 个检查器按 `entry_budget → layout → links → freshness → drift → derived → evidence → adoption → single_authority → cross_repo`，最后 `check_all` 汇总与 `tool-identity`。

**这一批差异是怎么发现的**：先拿「四个真实仓的文档里有没有全角空格 U+3000 与 NBSP U+00A0」当判断依据——有（std 5611 个 NBSP、三个项目共 257 个 U+3000），说明 Unicode 空白行为不是理论问题。再逐码点比对 Python 与 Node 的 `\\s`、`\\d`、`\\w`、`strip`：`\\d` 差 360 个、`\\w` 差 49,638 个（先看以为很严重），**但反方向为 0 且差异 100% 落在 Python 的「未分配」码点里**，才定性为 Unicode 版本差异而非写法差异。**教训：看到一个大数字先查构成，不要急着下结论。**

**这批差异是怎么发现的**：先拿「四个真实仓的文档里有没有全角空格 U+3000 与 NBSP U+00A0」当判断依据——有（本仓 5611 个 NBSP、三个项目共 257 个 U+3000），说明 Unicode 空白行为不是理论问题。再逐码点比对 Python 与 Node 的 `\s`、`\d`、`\w`、`strip`：`\d` 差 360 个、`\w` 差 49,638 个（先看以为很严重），**但反方向为 0 且差异 100% 落在 Python 的「未分配」码点里**，才定性为 Unicode 版本差异而非写法差异。**教训：看到一个大数字先查构成，不要急着下结论。**

**每个检查器的验收（机械）**：①对 4 个黄金样本，该检查器产出的 finding 集合（`id`+`status`+`where`）与 Python 版逐条相同；②该检查器名下的 selftest 探针逐条复现；③**变异验证**：对 TS 版的每条判据做至少一种变异（改坏、删掉），测试必须变红——不能只看「全绿」，因为这一轮已有两次实测证明用例通过不等于有区分力（§12.4）。

**迁移时不带过去的**（§6 已列，这里补一条实测）：`check_adoption` 的 `_settings_allow`/`_wildcard_allow` 约 200 行与它们的自检；`.std/` 内嵌相关 4 个 finding id。这些对应的探针（adoption 11 条里的相关几条）在黄金样本里要**标注「预期消失」**，对比脚本要认这张清单，否则会把它们当差异。

### 12.6 阶段 2 的有意差异清单（TS 与 Python 版**不一致**的地方，逐条经决定）

零差异是对「真实仓的 finding 集合」与「探针」说的；**单个函数在极端输入上**允许有下表这些有意差异。每条都要有：Python 的行为、TS 的行为、为什么、谁定的。没写在这里的差异都是 bug。

| # | 函数 | Python 版 | TS 版 | 理由 | 决定 |
|---|---|---|---|---|---|
| D1 | `parse_date` | 用 `fromisoformat`：3.12 上接受紧凑型 `20261006`、周日期 `2026-W41-2`、`2026-10-06T10`（仅小时）、小数秒截断等；这是 3.11 起的偶然放宽，3.8 到 3.10 不接受 | 只收契约写的 `YYYY-MM-DD` 与标准 ISO8601（`T` 或空格分隔，`HH:MM[:SS[.f]]`，`Z`/`z`/`±HH[:MM]`） | 契约只写这两种；实测四个真实仓的 186 个日期字段里 0 个用到被放宽的写法；固化运行时偶然行为会让行为随版本变 | Alan 2026-10-06 选「按契约严格解析」 |
| D2 | `parse_yaml_subset` 递归上限 | 超过 Python 递归上限（约 1000 层，随调用栈深度而变）时报 `ConfigError("嵌套层数超出…")` | 固定上限 100 层，报**同一条**消息 | JS 栈深度与 Python 不同；配置只需两三层，100 层远超任何真实输入；同一输入在两版本里都被拒、消息相同 | 属 §12.5 的 C 类（Python 运行时特性），按「等价断言」处理 |
| D3 | `parse_yaml_subset` 整数 | 任意精度 `int` | `Number`；超出安全整数范围（±2^53）抛 `ConfigError`，不静默丢精度 | 「歧义即拒绝」是该解析器的既定原则；配置里的整数是预算（行数），不会大于 2^53 | 实现时的保守选择，如要放宽改用 `BigInt` |
| D4 | `\d` 与 `-?\d+` 整数判定 | Unicode 十进制数字（`٣`、全角 `１２` 都是 `\d`，被读成整数 3、12） | 仅 ASCII `0-9`；`٣`、`１２` 当字符串 | 配置里没有理由出现非 ASCII 数字（实测四个仓的 `project.yaml` 里只有 4 处 `②`，在注释里，不是数字值）；放宽会让 `٣` 被静默当成整数 | 同 D3 |
| D5 | `\w`（`check_links` 标题锚点、`check_drift` 的 `WI-` 边界） | Unicode 15.0（Python 3.12）的 `isalnum()` 或 `_` | `[\p{L}\p{N}_]`（Unicode 17.0，Node 24） | **逐码点实测**：Python 认的 JS 全认（反方向 0 个）；JS 多认的 9661 个**全部**是 Python 视作「未分配」的码点（Unicode 16、17 新增字符），**已分配码点上两者完全等价**。差异只来自 Unicode 数据库版本，不是写法，不应也无法复现 | 实测得出，无需决定 |
| D6 | `\s`、`str.strip()` | 认 U+001C 到 U+001F、U+0085（NEL）；**不**认 U+FEFF（BOM） | JS 的 `\s`/`trim()` **不**认前者、**认** U+FEFF | 逐码点实测各 6 个差异。U+FEFF 影响最大：Python 的 `strip()` 留着它，JS 的 `trim()` 去掉它——BOM 开头的文件两版本会得出不同结果。实现里**不用** `\s` 与 `trim()` 处理被扫文本，改用显式字符集（与 Python 的集合逐码点一致，由单测钉住） | 实现约束，不是放宽 |
| D7 | `read_bytes` 对**不是常规文件**的路径 | Windows：`os.open` 目录抛 `PermissionError`；POSIX：能打开，再被 `fstat` 判成 `NotRegular`；FIFO 靠 `O_NONBLOCK` 不阻塞再判 `NotRegular` | 统一抛 `NotRegular`（继承 `OSError`），**不区分平台** | 两者都是 `OSError` 子类，所有读点都是 `except OSError` 一视同仁转未定；区分类名只会让 TS 版多一个平台分支。Python 自己的 selftest 在 Windows 上也因此把 FIFO 断言记 SKIP（目录占位「不等价」）。样本里 `d` 这一条按 D7 比对：Python 的 `PermissionError`、TS 的 `NotRegular` 都算「抛了 OSError 子类、没读」 | 实现时的归并，不改变任何调用方的行为 |
| D8 | `O_NOFOLLOW`、`O_NONBLOCK`、`st_ino` | POSIX 上用来挡「末段被换成符号链接」「FIFO 阻塞」「打开后换目录再换回来」；Windows 上 Python 的 `getattr(os,'O_NOFOLLOW',0)` 为 0，**这三道防线在 Windows 上本来就是空的** | Node 的 `fs.constants.O_NOFOLLOW`/`O_NONBLOCK` 在 Windows 上是 `undefined`，同样取 0；`st_ino` 用 `bigint: true` 的 `fstat`/`stat`（Windows 上 Number 会丢精度：实测同一文件的 `ino` 在 Number 与 BigInt 下差 12） | 实测：本机 Windows 上 `fstat(fd).ino` 的 Number 值与 `stat(path, {bigint:true}).ino` 相差，**直接比较会把同一个文件判成两个**，所以必须全程 BigInt。Linux 上的真实防线要在 Ubuntu 容器里验证 | 实现约束；Windows 上这三道本来就是空的这件事如实写在这里，不假装有 |
| D9 | git 环境加固里的「空串值」与「改本进程环境」 | `GIT_HARDEN_CONFIG` 里 `core.sshCommand` 等四项取 `true`（一个命令名）而不是空串，因为 Windows 上 Python 的 `os.environ[k] = ""` **不传给子进程**，丢一个 `GIT_CONFIG_VALUE_n` 而 `COUNT` 不变，git 报 `missing config value` 整条命令失败（本机实测复现：`rc=128`）。另外 Python 版在入口用 `scrub_git_env()` **一次性改写本进程的 `os.environ`**，此后所有 git 子进程继承 | ①取值**保持 `true`**，不改成空串；②**不照搬「改本进程环境」**：每次 `spawn` 显式传 `env` 对象，`core/git` 只提供「构造子进程环境」的纯函数，**永不写 `process.env`** | ①本机实测 Node 里两种写法（`process.env.X=""` 再继承、显式 `env` 对象）空串都能传到子进程，所以 Python 为此绕的弯在 TS 里不再必要；但改成空串会改变「被扫方配置里的 `core.sshCommand` 被什么覆盖」这一行为，`true` 的语义已被 Python 版的安全审计认可，**保持原取值更保守**。②**这是一个现在没人踩、将来很容易踩的坑，不是现在已经存在的风险**：`lib/index.js` 只导出守卫，`core/*` 与将来的 `checks/*` 不在导出链里，DSH 加载插件时**不会**在宿主进程里执行它们，现在只有独立 CLI 与测试会运行它们。但如果将来有人把检查器接成 DSH 的工具或命令（在宿主进程里调用），改 `process.env` 就会泄漏到宿主与别的插件。**设计上先堵住，不等出事** | 实现约束；② 是预防性的，已如实标明现在没有受影响的路径 |
| D10 | 例外登记册读不了时 `problems` 里的**整句异常文本** | `"%s 读不了：%s" % (EXCEPTIONS_FILE, exc)`，`exc` 的 `str` 随异常类而异：`FileNotFoundError` 是 `[Errno 2] No such file or directory: '路径'`、目录是 `PermissionError`（`[Errno 13] Permission denied: '路径'`）——**本机 en-US 实测如此**（Windows 与 POSIX 在这两类上文本相同；`winerror` 为 None）；非 UTF-8 是 `'utf-8' codec can't decode byte 0xe9 in position 2: invalid continuation byte` | **UTF-8 解码失败**的整句文本与 Python **逐字一致**（`pyUtf8ErrorMessage`，对 406,900 个序列穷举核对）；**系统错误**用 `<ErrnoName>: <path>` 的固定措辞（如 `FileNotFoundError: <path>`），**不复现 `[Errno N] strerror` 这一句**；本模块的拒读类（出仓、超限、非常规文件）保持自己的文本不变 | 系统错误的 `strerror` 来自 C 运行库或操作系统，**可能随系统语言与版本变**（我只在 en-US 的 Windows 上验证过英文文本，没有验证过其它语言环境，不对它们下结论）；复现它既无法保证、也没有价值——它只出现在「登记册读不了」这条未定的 `reason` 里给人看，不参与任何判定、不被抄进登记册（规则列只抄 Finding id）。非 UTF-8 的文本由 Python 解码器生成、不依赖系统语言，保持逐字一致。**对比黄金样本时，系统错误类的 problem 按「异常类名 + 路径归一」比，不按整句** | 实现约束；影响面仅限一条未定的说明文字 |
| D11 | `find_field` 的 `re.I` 大小写折叠 | Python `re.I`（Unicode）把 `İ`（U+0130）、`ı`（U+0131）与 `i`、`ſ`（U+017F）与 `s`、`K`（Kelvin，U+212A）与 `k` 视作等价 | 用 `iu` 标志（`ſ↔s`、`K↔k` 随之等价）**并对 `i` 显式并上 `İı`**。**结果与 Python 一致** | 逐码点实测（0x110000 个码点 × 26 个 ASCII 字母）：JS 的 `i` 标志漏 4 个，**`iu` 只漏 2 个（`İ`、`ı`）**；其余 Unicode 字母的大小写对两边一致。这不是「有意放宽或收紧」，而是**把 JS 补到与 Python 一样**。**我最初的实现把四个都手写进特例表，变异验证发现其中 `ſ`、`K` 两项对 `iu` 是多余的（去掉不改变结果），已收窄**——登记在这里是因为它靠一小张手写特例表加一个必须带 `u` 的标志，二者缺一就悄悄不同；由 `docs.test.mjs` 里一条专门的测试与 `findField` 的全部黄金样本钉住，变异 F20（去掉 `u`）与 F25（去掉 `İı`）验证 | 实现约束 |
| D12 | 配置形状非法时下游函数的行为（`in_frozen` 的 `layout.frozen`、`entry_files` 的 `layout.entry` 等） | `layout.frozen` 写成字符串时 Python **逐字符迭代**（`'docs/archive'` 变成 `'d'`、`'o'`、……，`'d'` 前缀匹配任何以 d 开头的路径）；`layout.entry` 写成整数时 Python 在 `for x in declared` 处抛 `TypeError`（崩溃，被调用方的 `run_guarded` 转成「检查器自身出错」） | **形状非法一律当空**（`frozen` 永不命中；`entry` 返回空列表），**不崩** | **真实入口全都走不到**：`load_config` 对这些键写成非法形状整份拒收（黄金样本 `shape_frozen_scalar`、`shape_entry_int`、`shape_artifacts_entry_*`，报「须是字符串列表／字符串或字符串列表」），下游函数只在配置通过之后被调用。Python 的逐字符迭代与 `TypeError` 都是偶然行为，不是契约；复现它们没有价值，还会让一个本该被拒的输入产生奇怪的命中或崩溃。**黄金样本里这几条记着 Python 的偶然行为，比对时按 D12 跳过**，TS 的实际行为由专门断言钉住 | 实现约束；影响面为零（上游已拒） |
| D13 | 多行模式下 `^` 认哪些行终止符 | Python `re.M` 的 `^` **只在字符串开头与 `\n` 之后**匹配（`\r`、U+2028、U+2029、`\x85`、`\v`、`\f` 之后都**不**匹配；`\r\n` 因其中有 `\n` 而匹配） | 显式写成 `(?<![^\n])`（不是「前面有非 `\n` 字符」＝开头或前一字符是 `\n`），**不用 JS 的 `m` 标志** | **逐终止符实测**：JS 的 `m` 标志下 `^` 在 `\r`、U+2028、U+2029 之后也匹配，Python 不匹配。后果是真实的：`# T\n状态：a\r## B\r状态：b`（旧 Mac 行尾或混合行尾的文档），Python 里 `\r## B` 不算标题行、状态值是 `a\r## b\r状态：b`，JS 的 `m` 会把它切成 `a`。受影响的两处：`findField` 的行首、`headOf` 的小节标题行首；`find_field` 的 `$`（Python 里这里没用 `$`）不涉及。**这是第三个因「正则标志在两种语言里语义不同」而发现的差异**（D5 的 `\w`、D6 的 `\s`、D11 的 `re.I`、本条的 `m`），说明迁移里**每个用到正则标志的地方都要逐个验证，不能默认等价** | 实现约束 |
| D14 | 检查器内部异常的类名进 `reason` | Python 的 `type(exc).__name__`（`KeyError`、`ValueError`、`ZeroDivisionError`……） | OSError 家族按 errno 映射成 Python 的类名；本模块的拒读类按各自名字；**其余取 JS 的 `Error.name`**，类名不同 | TS 里没有这些 Python 内置异常的对应物。**实测黄金样本（4 个真实仓 + 全部 selftest 探针）里没有任何一条 finding 的 `reason` 含 Python 异常类名**；验收口径（只比 `check`、`id`、`status`、`where`、`registered`）不比 `reason`，零影响。详见 §12.14 | 实现约束；已验证零影响 |
| D15 | Windows 上路径名末尾的空格与点 | Python 在 Windows 上按 Win32 规则去掉它们（`f.md ` 读到 `f.md`，`isfile` 为真） | 不复现：`f.md ` 与 `f.md.` 是另外两个名字，不存在即「不是文件」 | 同一份脚本在 Linux 上 Python 的结论也是「不存在」，这是 Windows 文件系统的怪癖，不是契约。配置里能写出这样的路径（YAML 引号内的尾空格，`load_config` 不拦），但**四个真实仓的路径值里没有**。详见 §12.16 | 实现约束；影响面为零 |
| D16 | `glob` 在 Windows 上的大小写 | Python 的 `glob`（经 `fnmatch` 的 `normcase`）在 Windows 上不区分大小写，POSIX 上区分 | 同 Python：Windows 上带 `i` 标志，其它平台不带 | **不是差异，是「两个平台都与该平台上的 Python 一致」**；登记是因为这条靠平台分支实现，样本只在生成它的平台上整份可比。详见 §12.17 | 平台语义 |
| D17 | `tracked_files` 的 `.std/` 自排除（`embedded_std_rel`） | 工具自身位于被扫仓的子目录（内嵌的 `.std/`）时，把该目录从扫描面里去掉 | **不带这个机制**，被扫仓的全部 `git ls-files` 结果都在扫描面内 | **对黄金样本零影响**：黄金样本在 `TOOL_ROOT` = 本仓下生成，`embedded_std_rel(扫描根)` 对三个采用项目全部返回 `None`，所以 `.std/` 从未被排除；实测 `links`、`single_authority`、`drift` 三个检查器「排除」与「不排除」的 finding 集合在三个采用项目上完全相同。新架构里采用项目不再内嵌 `.std/`（§8），机制失去对象。**这也意味着 `adoption` 里与它配套的 `embedded-*` 判据一并随阶段 4 消失** | 实现约束；已验证零影响 |

## 13. 变更记录

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-10-06 | 初版 | Alan 决定重构；写完设计文档后才开发 |
| 2026-10-06 | `core/repr.ts` 完成，记 §12.21；统一八份各自为政的 `pyRepr`（迁 `freshness` 前发现）；变异暴露四处代码冗余，直接删除 | 全量 785 条两平台 0 败；三个已迁检查器对 4 个真实仓与 selftest 仍零差异；变异 31 条两平台全抓住；样本第一版逐码点存了 9.7 MB，改成区间 25 KB |
| 2026-10-06 | **第三个检查器 `links` 迁完**，记 §12.20；`unquote` 自己实现；`$` 匹配末尾换行之前（D4/D11 的又一处表现） | 4 个真实仓逐条一致、selftest 8 条集合相同、变异 124 条（Windows 123 抓住 + 1 标注）；变异第一轮 130 条跑近 40 分钟，其中 6 条是等价变异——以后写变异清单时先证明等价再跑 |
| 2026-10-06 | `core/tracked.ts` 完成，记 §12.19，新增 D17（不带 `.std/` 自排除）；推迟四轮的一块，迁时实测推翻了「黄金样本排除了 `.std/`」的假设 | 三个采用项目上排除与否 finding 集合相同；`git ls-files` 会执行被扫仓的 `core.fsmonitor`（对照实验）；变异 44 条 Ubuntu 全抓住；Windows 上 `col:on.md` 建出备用数据流的陷阱；探针脚本留下临时仓、核对路径后手动清理 |
| 2026-10-06 | **第二个检查器 `layout` 迁完**，记 §12.18；`splitLinesPy` 增 `keepends`；`exists` 并入 `core/fs.ts` | 4 个真实仓逐条一致、selftest 10 条集合相同、变异 89 条两平台 0 漏（87 抓住 + 2 如实标注）；Ubuntu 再次暴露「靠真实仓比对才被抓住的性质在 Linux 上没人守」（第三次同类），补了直接断言；探针脚本用完即删 |
| 2026-10-06 | `core/glob.ts` 完成，记 §12.17（含 D16）；为 `layout` 的 `glob` 判据补的 core，刻意只实现子集 | 对 Python 样本逐条一致；变异 29 条两平台 0 漏；写断言时三次写出非断言的东西、一次写反期望，已记入教训；「样本平台以外被跳过」的测试守不住别的平台，补了独立断言 |
| 2026-10-06 | **第一个检查器 `entry_budget` 迁完**，记 §12.16；新增 `golden-compare.mjs`、`golden-selftest.mjs`、`core/fixture.ts`；`isFile`/`isDir`/`lexists` 统一进 `core/fs.ts`；新增 D15 | 4 个真实仓逐条一致、selftest 10 条集合相同、变异 62 条两平台 0 漏；自检暴露 `realpathLoose` 对断链的缺口（`core/fs` 的黄金样本盲区）；路径谓词样本在 Windows 与 Linux 上有 85 条不同 |
| 2026-10-06 | 新增 `scripts/check-py-semantics.mjs` 与 `test/py-semantics.test.mjs`，记 §12.15；**未接入 pre-commit（该编辑被拒绝，待 Alan 决定）** | 把 D4、D5、D6、D13 变成机械检查；首次运行在现有源码上抓到 5 处，全部改成显式写法；检查脚本自己有变异测试 |
| 2026-10-06 | `core/shell.ts` 完成，记 §12.14（含 D14）；先于第一个检查器迁，因为所有检查器都依赖它 | 对 Python 黄金样本逐条一致；变异 50 条两平台 0 漏；`excTypeName` 的真 bug 由黄金样本比出；已登记的 D6 约束我自己在写 `workRootAbsent` 时又违反一次，靠写变异清单才发现 |
| 2026-10-06 | `core/docs.ts` 完成，记 §12.13，新增 D11 到 D13；`mutate.mjs` 新增 `winOnly`；`verify-ubuntu.ps1` 失败时打印断言细节 | `find_field` 2880 条输入逐条一致；变异 110 条两平台 0 漏；`re.M` 的 `^` 在 `\\r` 之后的差异靠补一条混合行尾样本才暴露；Ubuntu 暴露反斜杠路径语义差异，容器里用 Python 实测后按平台处理；两次 `edit` 失败被当成成功的流程教训 |
| 2026-10-06 | `core/exceptions.ts` 完成，记 §12.12，新增 D10；UTF-8 诊断扩展到终点、原因与整句文本 | 65 个登记册样本等逐条一致；变异 64 条两平台 62 抓住 2 标未验证 0 漏；发现 governance 出仓目录链接时登记册读取的下游缺口（被上游 loadConfig 兜住，与 Python 一致，未擅自收紧）；D10 里一处凭印象写的事实经实测改正 |
| 2026-10-06 | `core/config.ts`/`cfg.ts`/`utf8.ts` 完成，记 §12.11 | 104 条配置用例含精确报错信息逐条一致；UTF-8 起点穷举 406900 个序列；变异 78 条 Ubuntu 全抓住；发现并堵住 `__proto__` 键的 JS 特有缺陷；首轮 16 条变异没抓住按五类处理 |
| 2026-10-06 | `core/git.ts` 完成，记 §12.10，新增 D9；`tracked_files` 推迟到汇总层 | 用恶意仓验证行为（先跑对照组证明外部程序确会被执行）；30 条变异 29 抓住、1 标未验证；textconv 的防线在调用方而非本模块，写进头注释防迁移时丢失 |
| 2026-10-06 | 记 §12.9：fs 在 Ubuntu 上的验证；新增 `scripts/verify-ubuntu.ps1` 与仅 POSIX 变异 P1/P2 | 同一条变异在两个平台结论不同，查出是断言写在了会因偶然原因失败的位置；Windows 上本来就空的三道防线在 Linux 上补了验证 |
| 2026-10-06 | `core/fs.ts` 完成，记 §12.8，新增 D7/D8 | 对 190 条夹具型黄金样本逐条一致；变异 20 条，16 抓住、4 如实标未验证、0 漏；`mutate.mjs` 新增复合变异与 `unobservable` 标注 |
| 2026-10-06 | 阶段 2 开始：`core` 的 finding/yaml/dates 完成并记 §12.7 | 对 Python 单元黄金样本逐条一致；变异 29 条全抓住（首轮 4 条没抓住，补输入后抓住）；变异脚本事故后改为带哈希校验的独立脚本；一个 Python 分支穷举 62 万输入不可达，如实记未验证 |
| 2026-10-06 | §12.6 补 D4 到 D6（`\d`、`\w`、`\s`/`strip`） | 逐码点比对 Python 3.12（Unicode 15.0）与 Node 24（Unicode 17.0）；`\w` 的 49,638 个差异先看严重，查构成后确认全部是 Unicode 版本差；`strip()` 对 U+FEFF 的差异是真实风险，实现里禁用 `trim()`/`\s` |
| 2026-10-06 | 新增 §12.6 有意差异清单；D1（日期解析）Alan 选「按契约严格解析」 | 实测 Python 3.12 的 `fromisoformat` 接受契约没写的紧凑型与周日期；四个真实仓 186 个日期字段里 0 个用到 |
| 2026-10-06 | 新增 §12.5 阶段 2 验收口径 | 动手前先量规模与探针分类（225/10/3）；分类时犯过一次关键词误判，抽样复核后更正 |
| 2026-10-06 | 阶段 1 的 1-h 完成并记 §12.4；Q1 Alan 确认保持 `0.<序号>.0` | 新路径保护做成 `protect` 配置（Alan 选 B）；首版内置方案因误伤采用项目自己的 `src/` `package.json` 撤回；变异验证抓出两个测试盲区并补用例；更正我编造的 patch 语法 |
| 2026-10-06 | 阶段 1 的 1-g 完成并记 §12.3 | 从 git 地址经 DSH 自己的 plugin add 通道装入隔离 profile，守卫在真实 pre-execute 管线里拦下 `.std/` 写入、放行普通写入；`ask` 的真实批准流程、桌面 GUI 点击安装、会话 cwd 取根、完整 agent 回合四项未覆盖，逐条写明 |
| 2026-10-06 | 阶段 1 分项 1-a 到 1-d 完成，新增 §12.2 | 守卫迁 TS 并行为不变（471 条逐项一致）；`lib/` 一致性校验与第四道钩子；§12.2 记下做的时候才发现的事 |
| 2026-10-06 | Q3 实测定案，新增 §4.1；Q1 暂定 A | 做阶段 1 前先验证整个设计风险最大的假设（钩子能否找到插件提供的命令）；Alan 未回复 Q1，按推荐先推进并标明可逆 |
| 2026-10-06 | 阶段 0 完成；新增 §12.1 记真实口径 | 样本口径（钉提交、只比 id/status/where/registered）与「selftest 探针大量调私有函数」这两点是做的时候才量出来的，必须写进设计，否则阶段 2 会按错的假设去迁 |
| 2026-10-06 | §4 定「`lib/` 提交进 git」，放弃「git 安装时 `prepare` 构建」 | 实测 pnpm 从 git 装包拒绝 `prepare`（`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`），提交 `lib/` 则成功 |
