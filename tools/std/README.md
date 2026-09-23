# tools/std · 标准机械检查

对着 [`标准/`](../../标准/README.md) 里**能机械判定**的那部分做检查，判不了的如实报"未定"。
三态定义、退出码规则、检查器接口在同目录 [CONTRACT.md](CONTRACT.md)；本文只讲怎么用，不复述它。

## 一条命令

在采用项目根执行：`python3 .std/tools/std/check_all.py .`

`.std/` 是标准（含本工具）内嵌进项目的目录，怎么取进来见下文「接入一个项目」。

退出码：`0` 本次执行的检查全过，或判不了的项**全部登记在案**；`1` 有 FAIL；`2` 没有 FAIL 但有**未登记**的判不了项。
**`2` 不是成功**——把 2 吞成成功，等于把"没检查"记成"检查通过"，而这正是本工具要拦的事。

## 前提

- Linux / macOS，`python3`，不装任何第三方包。入口与拦截层都以 `python3` 调用。
- **被扫描目录必须是 git 仓库。** 检查对象来自 `git ls-files`。不在 git 仓库里跑，links 与
  single-authority 会报"git ls-files 退出码 128"并记未定，整体退出 2。这不是工具坏了。
- 项目根有 `governance/project.yaml`（或同名 `.yml`）。配置加载只认这两个路径；换个文件名
  等于没有配置，全部检查一次性记未定。

## 首跑怎么读

首跑一定不好看。**FAIL 的条数不是质量分**，是"这个项目此前没被这套判据看过"的存量。处置顺序：

1. **先看未定。** 未定多半是配置没填全（缺 `tier`、`layout.work_root` 之类）或对象不存在。
   未定的意思是这项没判成，既不是过也不是不过。先清一批未定，FAIL 那边的图景才可信。
2. **再看 FAIL。** 每条带位置、依据条款、原始证据，照证据复算。
3. **最后看输出末尾的覆盖边界。** 那里逐检查器列"不看：……"，是本次**没有看**的范围，
   不是没有问题的范围。

**不许用 `tailoring` 把红的关绿。** 它的语义是"这条在本项目不适用，理由是……"，粒度是**整个
检查器**，或 `layout` 下的单个工件（`layout:<role>`，见 [CONTRACT §5](CONTRACT.md)）：
写上去之后被裁的那一项变成"不适用"，本来会报的 FAIL 一起消失，不是被修好了。
判"不适用"的判据是**对象不存在**；缺人、没数据、没测试是待确认，不是不适用
（见[如何裁剪并开始使用](../../标准/覆盖与采用检查.md#如何裁剪并开始使用)）。

输出形状（节间空行已略；计数随项目与提交变动，这里不写具体数）：

```
标准检查 · <项目绝对路径>
配置 · governance/project.yaml
排除 · .std/（工具自身所在的内嵌目录，不扫描；在标准仓自己身上跑时没有这一行）
登记 · governance/exceptions.md（N 行有效）
  通过 N   失败 N   未定 N（已登记 a · 未登记 b）   不适用 N
失败（N）
  · <一句话> [<路径:行>]
      id：<这条发现的地址>
      依据：<标准条款>
      证据：<可复算的原始摘录>
未定（N）
  · <一句话>
      id：<这条发现的地址>
      原因：<为什么判不了>
覆盖边界（没检查的不等于没问题）
  <检查器名>
    不看：<这次没覆盖到的范围>
结论：FAIL。
```

## 未定项怎么登记

判不了的项可以逐条登记"我看过了，接受到什么时候、谁批的"。在 `governance/exceptions.md`
（和 `project.yaml` 同一个目录）的第一张表里加一行：**规则列抄报告里那条发现的 `id`**，再写
理由、范围、批准人、到期。列名按"包含"认（`规则`/`理由`/`范围`/`批准`/`到期`/`状态`），列的
顺序和多出来的列都不影响。

登记**不改变结论**：那条仍是未定、仍逐条列出、仍计入未定计数，报告里标「（已登记 EX-xxx，
到期 …）」，变的只有退出码。到期由工具按**运行日**校验，过期即回到未登记，并多出一条
`exception-register/expired`；过期的行在首部标「其中 M 行已过期」。**FAIL 不能登记**——那是
确定的违规，处置是修；整个检查器不适用走 `tailoring`。语义细则见 CONTRACT.md §9。

## 命令行开关

`check_all.py` 只有这些：

- `root`（位置参数，默认当前目录）：被扫描的项目根。
- `--selftest`：只跑检查器自检，不看项目。这是 CONTRACT.md §3 的**执行点**——改完任何检查器
  都要跑它，退出 0 才算改完。自检不过或没有自检的检查器，其对项目的结论被汇总器作废成未定。
- `--json`：输出 Finding 数组给上层工具消费，退出码规则不变。
- `--no-scope`：不打印覆盖边界。默认输出很长，只想先看结论时用；关掉打印不等于扩大了覆盖。
- `--config PATH`：改从别处读配置。扫只读或第三方项目时用：配置放在被扫项目之外，全程不往
  被扫项目写任何东西。该路径不存在或解析不了一律记未定，不回退去猜项目布局。

## 接入一个项目

**标准与工具按 tag 以 `git subtree` 内嵌进采用项目的 `.std/`。** 采用项目自己只写
`governance/` 那两个文件（`project.yaml`、`STANDARD_VERSION`），标准正文、模板和本工具由 subtree
带进来，clone 即用、离线可跑，不再按绝对路径去调一份仓外的工作副本。**这份副本不会静默失效：**
会静默失效的是无版本的手工拷贝——副本停在拷贝当天而配置里的版本号照旧，跑得动、报 PASS、结论
已不可信；而内嵌进来的这份取自某一次发布（取用默认从 `main` 拉最新发布，要钉某一版才用 tag 名），
`STANDARD_VERSION` 记的就是那次发布的 tag 名。副本只能由一次
显式的 `subtree pull` 移动，它移动代码与 `.std/标准/README.md` 第 3 行的修订号
（[01 §8](../../标准/01-项目管理标准.md#adoption)：由项目显式评估并升级，不在任务中自动跟随）；
`STANDARD_VERSION` 要在 pull 之后手改，漏改就是两边各自漂——`check_adoption` 以内嵌方式运行时比对
这两个值，不一致判 FAIL。
**未定优于假通过仍是这套工具存在的理由，它自己的部署方式不能选会假通过的那条：**内嵌的是哪一版
由 tag 与 `STANDARD_VERSION` 双写钉住，实际跑的是哪份代码由 CONTRACT.md §8 的身份哈希钉住；取不到
就该记未定，记录与内嵌对不上判失败，不得按"大概是那一版"往下判。
另外 01 §3.8 与[试点通过条件](../../标准/覆盖与采用检查.md#pilot-exit)第 3 条已把"两份 +
同步机制"判为待删对象：`.std/` 是只读内嵌，项目不得在里面改标准——改了就是第二处权威，处置是
把改动合并回标准仓再 `pull`，不是就地同步。

配置字段的语义见 CONTRACT.md §5，实例见交付面内的
[示例项目 `governance/project.yaml`](../../标准/示例项目-连锁零售中台/governance/project.yaml)——照实文件抄，本文不另立字段表；
`tier` 是必填的，不写就得到一条未定。工具来源由 `.std/` 的 subtree 提交与
`governance/STANDARD_VERSION` 承载，不在 yaml 里另记。

**取用、升级、发布三条命令线。** tag 仍打在每个发布提交上，日期格式（如 `2026-09-12`），打在
标准仓 `release` 分支的发布提交上；同一天第二次及以后的发布在日期后加 `.1`、`.2`（如
`2026-09-12.1`），日期本身不改。`main` 永远指向最新发布，取用与升级两条命令都直接用 `main`，
README 里的命令零编辑复制即用；要钉某一版，把命令里的 `main` 换成 tag 名即可。

- **取用**（采用项目里执行一次）：
  `git subtree add --prefix=.std https://github.com/Alan-IFT/ai-dev-std.git main --squash`。
  之后入口里的路径写 `.std/标准/…`，检查命令写 `python3 .std/tools/std/check_all.py .`；
  `.std/标准/README.md` 第 3 行「候选实现修订」的值就是拉到的版本，写进
  `governance/STANDARD_VERSION` 首行；第二行可同时写 `adopted_at: <日期>`（形态见示例项目的
  [`governance/STANDARD_VERSION`](../../标准/示例项目-连锁零售中台/governance/STANDARD_VERSION)），
  不写的话 `adoption` 记一条未定。
- **升级**：先跑 `git log --oneline -- .std` 查越界——路径过滤下这条命令只会列出 merge 提交（squash
  提交的内容落在仓根、不在 `.std/` 下，路径过滤看不到它）；每次 add/pull 各贡献 1 条 merge 提交，
  条数 = 取用 1 次 + 升级次数，多出来的任何一条就是项目在 `.std/` 里改了标准，先把改动合并回标准仓
  或撤掉再 pull：同一行上游也改了 git 会报冲突，**上游没改的行 pull 会静默保留本地改动**，这种漂移
  只有 log 能看见。**工作区须干净**——`git subtree` 的 ensure_clean 对已跟踪文件的改动直接 die，
  有改动先 `git stash push`，pull 完再 `git stash pop`。确认干净后
  `git subtree pull --prefix=.std <remote> main --squash`。换上游地址（如从私有仓换到公开仓）
  时，`<remote>` 直接换成新地址即可——`--squash` 合并的是本地这条 squash 提交链，不依赖上游历史、
  也不要求与本地已有 squash 共有祖先；2026-09-13 有采用项目从重新起根的公开仓拉取，实测无冲突。项
  目的 ref 空间里没有标准仓的 tag（squash 不带 tag 过来），读差异改用
  `git log --oneline --all --grep="Squashed '.std/'"` 列出 squash 提交（形如
  `Squashed '.std/' changes from <旧 sha>..<新 sha>`，消息里就是标准仓 `release` 分支的旧新提交；
  首次取用那条 squash 提交的消息形如 `Squashed '.std/' content from commit <sha>`，没有 `..`，之后
  每次升级的才是 `changes from <旧>..<新>`），`git diff <旧 squash sha> <新 squash sha>` 就是这次
  升级里 `.std/` 的差异；手头有标准仓检出时 `git diff <旧 tag> <新 tag>` 与此等价——`release` 分
  支是线性的，两者都是完整的升级差异。读完差异再改 `governance/STANDARD_VERSION`（值取
  `.std/标准/README.md` 第 3 行），**在 pull 之后改，不要先改再 pull**：pull 认的是当前 `.std/`
  的内容，先改版本号只会让文件和记录对不上。
- **发布**（标准仓维护者按这几步手工执行，**不写发布脚本**）：在 main 上
  `git worktree add ../release release`（首次加 `-b release`，从空开始）→ 在该 worktree 里
  `git rm -r -q .`（首次跳过）→ `git checkout main -- 标准 templates tools/std .claude-plugin LICENSE LICENSE-DOCS` → 写／更新根
  `README.md`（说明本分支是 main 的发布产物、含哪几个目录、对应哪个 main 提交）→
  `git commit -m "release <tag>：来自 main <sha>"` → `git tag <tag>` → push 分支与 tag。
  每次发布提交接在上一次之上，不用 orphan 重建——重建会让两个 tag 间的 diff 不再是升级差异。
  **push 时同时推到公开仓**（`release` 分支在公开仓里就是它的 `main`，采用项目按上面「取用」那条
  命令取的也是这个地址）：`git push https://github.com/Alan-IFT/ai-dev-std.git release:main --follow-tags`；
  `--follow-tags` 只推带注解的 tag，用 `git tag <tag>` 打的轻量 tag 不在其中，那就分两条：
  `git push <公开仓> release:main && git push <公开仓> <tag>`。本仓 main 含不可公开的脚手架，只推 `release`，不推 main。

**执行层由采用项目自己接**，标准不发钩子、流水线或 agent 侧配置——它们随宿主工具变，上游给一份
就会过期成第二处权威；**例外：Claude Code 一家的拦截层随标准一起发**（`.std/` 本身就是一个
Claude Code 插件），接法见下节「Claude Code 拦截层」；其它宿主工具仍由采用项目自己接。接法只有
一条：把 `check_all` 放进提交、合并或发布的必经路径，退出码非 0
就不放行；退出码 0 已含"未定项全部登记"这层意思（见上文「未定项怎么登记」），执行层不必自己解释
2。承载可以是版本控制钩子、流水线作业或按清单执行的人工步骤，语义相同；其中钩子形态如下：

```sh
#!/bin/sh
if git diff --cached --name-only | grep -q '^\.std/'; then
  echo "拒绝：.std/ 只读，改标准请合并回标准仓再 pull" >&2; exit 1
fi
exec python3 .std/tools/std/check_all.py .
```

`git subtree add/pull` 走 `commit-tree`，不经过这个钩子，升级不需要放行；反过来它也看不见
`git merge` 带进来的改动与 `--no-verify` 的提交（**agent 在 Claude Code 里发起的**那条已由下节的
拦截层补上，人手在终端敲的仍是盲区）——这两条盲区按
[01 §5.6](../../标准/01-项目管理标准.md#gates) 记为该门未覆盖的范围。这段是形态示意不是发布物；
`.std/` 前缀由采用项目自己的取用方式决定，换了前缀要跟着改。

把 2 当告警放行的流水线，其结论不得被引用为"检查过了"。agent 侧对 `.std/` 写入的拦截属于宿主工具
的调用前钩子，按各工具自己的机制配；没配的按
[01 §5.5](../../标准/01-项目管理标准.md#controlled-actions) 记未定，不记为已受控——Claude Code 的
这一份随标准发（见下节），装上后按「在场信号」自证是否真在跑；没装的、别的宿主工具的，仍按本句
记未定。

## Claude Code 拦截层

**这是 Claude Code 一家的专有适配层，不是标准正文。** 正文对宿主工具只说一句「把 `check_all` 放进
必经路径」，怎么接是宿主自己的事；这一层只是把那句话在 Claude Code 里做成了代码，随标准一起发，
换宿主工具不影响正文。别的宿主工具仍按上一段记未定。

装法四步，**第 0 步不能跳**：

0. **先在项目根跑一次** `python3 .std/tools/std/check_all.py .`。退出非 0 就先清账，或按上文「未定项
   怎么登记」把判不了的逐条登记，退出 0 之后再装。跳过的后果是确定的：提交门装上即锁死这个项目的
   每一次提交，第一反应必然是把拦截层关掉。
1. subtree 取用（见上文「接入一个项目」），`.std/` 就位——它本身就是那个插件。
2. 项目 `.claude/settings.json` 加两键（相对路径必须以 `./` 开头）：

   ```json
   {"extraKnownMarketplaces": {"ai-dev-std": {"source": "./.std"}},
    "enabledPlugins": {"std@ai-dev-std": true}}
   ```

3. **每台机器**跑一次 `claude plugin marketplace add ./.std`（换机器、换路径都要重跑）。

**生效标志（在场信号）**：装上之后，新会话的上下文里会出现一行「std 拦截层已加载 · guard `<sha8>` ·
`.std` 只读 · 提交前跑 check_all」。**这一行不出现就是没在跑**——不要假设它在，它正是下面第 1、2 条
盲区唯一的外部可见信号。不要用 `claude plugin list` 自证：它只列用户级启用的插件，项目级 `enabledPlugins` 不在其中。

拦什么，三条，全部只覆盖 Claude Code 自己发起的动作：

- Edit/Write/MultiEdit/NotebookEdit 写 `.std/` → **拒绝**；写本项目 `.claude/settings.json` 或
  `.claude/settings.local.json` → **先问**（拦截层自己的开关就在里面）。
- Bash 按 `&&`/`||`/`;`/`|`/换行分段，某段既是写形态（`>`、`>>`、`tee`、`rm`、`mv`、`cp`——含
  `git rm`/`git mv`——、`sed -i`、`git checkout … --`、`python -c`/`python3 -c`、`node -e`）又提及
  `.std` 或上面两个 settings → **先问**。`.std` 写成 `.std`、`./.std` 或 `<项目根绝对路径>/.std`，带不带
  尾斜杠都算（`rm -rf .std`、`mv .std old` 命中，`.std-backup`、`out/.std` 不算）；settings 任何前缀都算。
  以 `git subtree` 开头且不带重定向的段是升级通道，放行；读形态放行。**这一条只是提早提醒**：写入
  动词永远列不全，挡住改动的是下一条的兜底。
- 提交门。Bash 里精确认出 `git commit`（含 `--no-verify`、`--amend`、`git -c … commit`、
  `git -C … commit`）→ 先查 `.std/` 下有没有改动（已暂存或已跟踪未暂存都算——`git commit -a` 在钩子
  之后才暂存），有就**拒绝**：不论 `.std/` 是被哪条命令改的，都进不了提交；再跑
  `check_all . --no-scope`，退出 0 才放行；退出 1／2 **拒绝**，并把计数行、结论行与前 8 条 `id：`
  交给模型；跑不成（崩溃、超时 300 秒、退出码不在 {0,1,2}、`git status` 查不了）**同样拒绝**——
  "没检查"不算"检查过了"（[CONTRACT §1](CONTRACT.md)）。同一段里有 `git` 与 `commit` 两个词、却没被
  精确认出的（`bash -c "git commit …"`、`(git commit)`、`/usr/bin/git commit`、`env`/`command`/`nohup`/
  `time` 前缀）过同一道门，不过时给**先问**而不是拒绝——模糊命中可能是误判，交人裁决。
  `hooks.json` 给这个钩子显式写了 310 秒时限：宿主时限先到会取消钩子、动作照常执行，内部 300 秒
  必须先到。`.std/tools/std/check_all.py` 不在位（插件被装到没内嵌标准的项目上）则不表态，不锁死
  那个项目。

每次有判断的动作（拒绝／先问／跑过检查才放行／跳过）和每次会话开始，都往
`${CLAUDE_PLUGIN_DATA}/receipts.log` 追加一行：时间、会话号、项目根、事件、工具、对象、决定。回执由
拦截层自己写、落在仓外，不是被约束者的自述；与受控动作清单对账见
[01 §5.5](../../标准/01-项目管理标准.md#controlled-actions)。

**2026-09-22 在 Ubuntu、claude 2.1.278 上经真实会话实测两点**：① 无头模式（`claude -p`）没有人回答「先问」，宿主把它当拒绝——动作不执行、文件不落地，`--allowedTools` 的放行盖不过 hook 的先问；② 在场信号那一行加上标准正文，会让模型自己放弃动作（实测它引用「`.std` 只读」拒绝了往 `.std/x.md` 的 Write 与往 `.std/` 的 subtree），这时钩子根本没被调用、也没有回执——**模型自律不计为受控**，与钩子的拒绝／先问分开记，按 [01 §5.5](../../标准/01-项目管理标准.md#controlled-actions) 只有回执里那一行算数。

**盲区七条**（都不记为已受控，按 [01 §5.5](../../标准/01-项目管理标准.md#controlled-actions)）：

1. 无头模式（`claude -p`）下项目 settings 的 `extraKnownMarketplaces` **不会**自动注册，必须先在这台
   机器上 `marketplace add` 过一次——第 3 步漏做，整层静默不生效。
2. `python3` 缺失或 hook 崩溃／卡死超过宿主时限（`hooks.json` 里的 310 秒）→ **静默放行**：
   Claude Code 至多报一条非阻断错误，动作照常执行。2026-09-22 在 Ubuntu 上实测过一次——`hooks.json` 当时写的是 `python`，
   该命令不存在，hook 退出码 127，整层一声不响地不生效。在场信号那一行不出现，即此。
3. 不经 Bash/Edit 的通道一律不命中：IDE 里的提交、人在终端手敲的命令、MCP 文件工具、`git merge` /
   `git rebase` 带进来的改动。子 agent 的 Write 会命中。
4. 写入期提醒认不全：heredoc 与变量拼接（`python - <<'P' … P`/`python3 - <<'P' … P` 那种）、
   `cd .std && …`、从子目录写 `../.std`、清单外的写入动词都不命中。这些改动进不了
   提交（提交门兜底），但工作区里的改动本身没人拦、也不会被撤；**同一条 Bash 命令里先改 `.std/`
   再提交**的，钩子在整条命令之前跑，兜底也看不见。兜底不看未跟踪文件（免得误拦 `__pycache__`），
   所以在 `.std/` 里新建文件后用一条 `git add -A && git commit` 提交，兜底同样看不见；`git add` 与
   `git commit` 分两条命令执行则会被拦。
5. 回执落在用户目录、按插件名共用：同一台机器上所有采用项目的回执混在一个文件里（行内带项目根可
   区分），跨机器对账要人工收集；`--plugin-dir` 与 marketplace 两种装法的回执还分在两个目录。
6. 内嵌目录是符号链接时，`realpath` 会把它解析到项目外，整层漏判。
7. git 别名（如 `git ci`）不解析：既不精确命中也没有 `commit` 这个词，提交门整道不跑。

与上面那段 git pre-commit 示意是**两层互补**，不是二选一：git 钩子拦人（但被 `--no-verify` 跳过、
看不见 `git merge`），这一层拦 agent（拦得住 `--no-verify`，但只覆盖 Claude Code 自己发起的动作）。
两层都不是全覆盖，各自的盲区按 [01 §5.6](../../标准/01-项目管理标准.md#gates) 记。

## 加一个自己的检查器

照 CONTRACT.md §4 的接口写 `checks/check_<name>.py`，最短的现成样板是
`checks/check_entry_budget.py`。**必须带 `selftest()` 且里面要有反例**：造一个应该被判 FAIL
的最小样本，跑出来必须是 FAIL。没有自检或自检不过的检查器，汇总器把它对项目的全部结论作废
成未定。写完跑 `--selftest`。

## 已知误报形态

- **中文正文里的数值高召回。** 同一个"数字+量词+名词"出现在多个文件就报未定。设计如此
  （同形数字也可能各说各的，机械判不了），不是 bug。逐条登记理由的落点见上文
  「未定项怎么登记」。
- **中文锚点判不了。** 各平台给中文标题生成锚点的规则不一致，工具拒绝猜：中文锚点没匹配上
  记未定，ASCII 锚点才判 FAIL。
- **重复文本的阈值对源码偏松。** 旋钮是 `budgets.duplicate_min_lines` 与
  `budgets.duplicate_min_chars`。**调阈值不是关检查**：证据里会写明用的是项目值还是默认值。
- 重复文本与重复数值这两条判据，只在**一组重复的全部出现位置都落在非文档文件**时才丢弃；丢弃
  的组不静默消失，汇总成一条未定，指向 02 §4 按技术债处置。只要有一处落在文档里，照常报。
- **`drift` 的日期判据靠一份动作词表召回。** 日期后 10 字内出现「裁定／批准／已完成」这类词才算
  候选，日期左侧 6 字内出现「复查／到期／下次／计划／截止／保留至／有效期」即丢弃。左侧那一刀是
  实测出来的：`- 复查：2026-12-08（半年）——已复查，无回退。` 右窗口命中「已复查」，而它是计划日
  不是既成事实。换一种写法（词不在表里、或计划词离日期超过 6 字）就漏。命中只产未定，可逐条登记。
- **`drift` 的 ADR 修订判据要求标记词从行首第 0 个字符开始**（剥掉 `>`、`#`、`-`、`*`、`|` 与空白
  之后）。放宽到「前 8 个字符内」时本仓 `docs/` 的候选从 10 行涨到 67 行，全是正文句子
  （`- 只追加地保存原始记录…`、`- 与现有理论：修订 D-027…`）。代价是**换写法即漏**：写成
  「本次修订：…」不命中。围栏代码块（```／~~~，按 CommonMark 开闭：同字符、不短于开围栏才闭合）里的行不看；英文标记 revision／changelog 常作普通名词
  （`revision id "0053_x"`），只在 `#` 标题或后跟冒号／表格竖线／行尾的标签形态才算；「修订后的结论见…」这类
  以「修订后」开头的指代句不算。这三刀都来自采用项目的实测误报。同样只产未定。

## 已知缺口

- **自检样本自己可能有盲区。** 真实教训：`git ls-files` 曾因 `core.quotepath` 把中文路径输出成
  转义形式，成批产生假 FAIL，而当时的自检是**通过**的——因为样本里的路径全是 ASCII。自检绿
  不等于在你的仓库里也对。新增检查器时，反例样本要包含你项目里真实存在的形态。
- CONTRACT.md §5 的字段表已按实现补齐（`tier`、`layout.work_root`/`artifacts`/`rule_files`、`derived`、
  `metadata_fields`/`metadata_required`、两个 `work_item_*_states`、两个 duplicate 阈值与两个 stale
  阈值），顶层 `rule_files` 这个重复拼法已从代码里删掉，只留 `layout.rule_files`。反向的缺口
  （§5 写了但没有检查器读的键）已清空：`standard_version` 随 D-088 删除，
  `budgets.status_lines` 与 `budgets.work_item_lines` 本轮从 §5 与本仓配置里一并删掉。
- **"§5 的键集合 == 实现读的键集合"目前只能靠人核对，没有机械手段。** 现在两边一致是一次人工 grep
  比对的结果，不是自检保证的；往检查器里加一个新配置键而忘了写进 §5，没有任何东西会报警。

## 本仓库自己的采用结果

本仓库自己也是采用者，记录在 标准仓 `governance/project.yaml`。**它自己
没有全绿**：仍有未定没处置、也没登记。验收条目工件在 `tailoring` 里按"本仓库不交付软件"
登记为不适用（`layout:acceptance`）——那是裁剪，理由写在登记里，不是被修好了。
作者自己的仓库不全绿，比全绿的样例更能说明三态怎么用。
