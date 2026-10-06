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
| Q1 | **暂定 A**（Alan 未回复，按推荐先推进；可逆：只影响 `package.json.version` 一个字段）。`package.json.version` 用什么形式：`0.<序号>.0`（符合 semver，与日期 tag 另表对应），还是把日期当版本（`2026.10.6` 这类，不合 semver 规范但可读） | `0.<序号>.0`，对应表放发布记录 | 未决，阶段 1 前定 |
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
- [ ] 阶段 1：骨架与守卫
- [ ] 阶段 2：检查器迁移
  - [ ] core　[ ] entry_budget　[ ] layout　[ ] links　[ ] freshness　[ ] drift
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

## 13. 变更记录

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-10-06 | 初版 | Alan 决定重构；写完设计文档后才开发 |
| 2026-10-06 | Q3 实测定案，新增 §4.1；Q1 暂定 A | 做阶段 1 前先验证整个设计风险最大的假设（钩子能否找到插件提供的命令）；Alan 未回复 Q1，按推荐先推进并标明可逆 |
| 2026-10-06 | 阶段 0 完成；新增 §12.1 记真实口径 | 样本口径（钉提交、只比 id/status/where/registered）与「selftest 探针大量调私有函数」这两点是做的时候才量出来的，必须写进设计，否则阶段 2 会按错的假设去迁 |
| 2026-10-06 | §4 定「`lib/` 提交进 git」，放弃「git 安装时 `prepare` 构建」 | 实测 pnpm 从 git 装包拒绝 `prepare`（`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`），提交 `lib/` 则成功 |
