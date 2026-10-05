# tools/std · 标准机械检查

对着 [`标准/`](../../标准/README.md) 里**能机械判定**的那部分做检查，判不了的如实报"未定"。
三态定义、退出码规则、检查器接口在同目录 [CONTRACT.md](CONTRACT.md)；本文只讲怎么用，不复述它。

## 一条命令

在采用项目根执行：`python3 .std/tools/std/check_all.py .`

`.std/` 是标准（含本工具）内嵌进项目的目录，怎么取进来见下文「接入一个项目」。

退出码：`0` 本次执行的检查全过，或判不了的项**全部登记在案**；`1` 有 FAIL；`2` 没有 FAIL 但有**未登记**的判不了项。
**`2` 不是成功**——把 2 吞成成功，等于把"没检查"记成"检查通过"，而这正是本工具要拦的事。

## 前提

- Linux / macOS，`python3`，不装任何第三方包。入口以 `python3` 调用。
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
写上去之后被裁的那一项变成"不适用"，本来会报的 FAIL 一起消失，不是被修好了（裁掉 `adoption` 时，
内嵌目录只读与 `compatibility.policy` 必填两项不可裁剪，照判）。
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

判不了的项可以逐条登记"我看过了，接受到什么时候、谁批的"：在 `governance/exceptions.md`（和
`project.yaml` 同一个目录）的第一张表里加一行，**规则列抄报告里那条发现的 `id`**，再写理由、范围、
批准人、到期（列名按"包含"认，列的顺序和多出来的列都不影响）。登记**不改变结论**——那条仍是未定、
仍逐条列出、仍计入未定计数，变的只有退出码；到期按**运行日**校验，最远写到运行日起 365 天，过期即回到
未登记。**FAIL 不能登记**——那是确定的违规，处置是修；检查器自身出错的未定（`<检查器>/internal-error`）
也不能登记；整个检查器不适用走 `tailoring`。同一张表里项目自己的门号例外（规则列不含 `/`）不参与登记，
但到期照判。表头匹配、关闭的写法、过期／不合格／孤儿行各报什么，见 CONTRACT.md §9。

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
带进来，clone 即用、离线可跑。内嵌的这份取自某一次发布，`STANDARD_VERSION` 记的就是那次发布的 tag 名；
副本只能由一次显式的 `subtree pull` 移动（[01 §8](../../标准/01-项目管理标准.md#adoption)：由项目显式评估
并升级，不在任务中自动跟随），它移动代码与 `.std/标准/README.md` 第 3 行的修订号，`STANDARD_VERSION`
要在 pull 之后手改——`check_adoption` 以内嵌方式运行时比对这两个值，不一致判 FAIL；实际跑的是哪份代码
由 CONTRACT.md §8 的身份哈希钉住。这就是它与无版本手工拷贝的区别：后者停在拷贝当天、照旧报 PASS，结论
已不可信。`.std/` 是只读内嵌（01 §3.8 与[试点通过条件](../../标准/覆盖与采用检查.md#pilot-exit)第 3 条已把
"两份 + 同步机制"判为待删对象），项目不得在里面改标准——改了就是第二处权威，处置是先撤掉改动、要保留的向上游报告（01 §8），
修复发布后再 `pull`，不是就地同步。

配置字段的语义见 CONTRACT.md §5，实例见交付面内的
[示例项目 `governance/project.yaml`](../../标准/示例项目-连锁零售中台/governance/project.yaml)——照实文件抄，本文不另立字段表；
`tier` 是必填的，不写就得到一条未定；`compatibility.policy` 也是必填的（01 §5.3），缺了判 FAIL——
兼容策略正文若已有权威位置，这里写一句指针即可。四个篇幅预算键 `budgets.status_lines`／
`handoff_lines`／`work_item_lines`／`module_lines` 可选：**不声明就不判**，01 §3.7 的 80／60／150／200
只是参考值（原文：试验参数，不是合格门槛）；声明之后超了判 FAIL，处置是先移出，不是先加预算。工具来源由 `.std/` 的 subtree 提交与
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
  条数 = 取用 1 次 + 升级次数，多出来的任何一条就是项目在 `.std/` 里改了标准，先撤掉改动、要保留的
  向上游报告（01 §8），修复发布后再 pull：同一行上游也改了 git 会报冲突，**上游没改的行 pull 会静默保留本地改动**，这种漂移
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
- **发布**（标准仓维护者按这几步手工执行，**不写发布脚本**）：先过一遍公开仓 open issues——每条进标准仓的
  失败 Case 清单或决策，或回复不处理的理由；本次发布修掉的，在 issue 里写 tag 名后关闭（外部回报没有别的
  接收点，不看就等于没报）→ 在 main 上跑
  `python3 tools/std/check_all.py --selftest` 与 `python3 tools/std/check_all.py . --no-scope`，都退出 0
  才继续——跨检查器反例只在 `--selftest` 里跑、不在提交路径上，绕过钩子进来的内容也要在这里再判一次 → 在 main 上
  `git worktree add ../release release`（首次加 `-b release`，从空开始）→ 在该 worktree 里
  `git rm -r -q .`（首次跳过）→ `git checkout main -- 标准 templates tools/std tools/dsh-std LICENSE LICENSE-DOCS` → 写／更新根
  `README.md`（说明本分支是 main 的发布产物、含哪几个目录、对应哪个 main 提交；`tools/dsh-std/` 是 DSH 插件，D-135 起属交付面）→
  `git commit -m "release <tag>：来自 main <sha>"` → `git tag <tag>` → push 分支与 tag。
  每次发布提交接在上一次之上，不用 orphan 重建——重建会让两个 tag 间的 diff 不再是升级差异。
  **push 时同时推到公开仓**（`release` 分支在公开仓里就是它的 `main`，采用项目按上面「取用」那条
  命令取的也是这个地址）：`git push https://github.com/Alan-IFT/ai-dev-std.git release:main --follow-tags`；
  `--follow-tags` 只推带注解的 tag，用 `git tag <tag>` 打的轻量 tag 不在其中，那就分两条：
  `git push <公开仓> release:main && git push <公开仓> <tag>`。本仓 main 含不可公开的脚手架，只推 `release`，不推 main。
- **报告标准或工具的问题**：到公开仓提 issue（`https://github.com/Alan-IFT/ai-dev-std/issues`），写采用的修订号、
  定位和最小复现；项目侧怎么记见 [01 §8](../../标准/01-项目管理标准.md#adoption)。

**执行层由采用项目自己接**，标准不发**生效的**钩子、流水线或 agent 侧配置——它们随宿主工具变，
上游给一份就会过期成第二处权威；`templates/` 里的 agent、skill 文件是供复制的载体实例，拷进项目的
`.agents/` 之后才生效，由采用方自己决定。**唯一例外是 [`tools/dsh-std/`](../dsh-std/README.md)**——DeepSeek Harness 插件，本仓唯一受支持宿主上的执行层，依据是 D-108 登记行的修订句与 D-135（标准仓 `docs/决策日志.md`）。接法只有一条：把 `check_all` 放进提交、合并或发布的必经路径，退出码非 0
就不放行；退出码 0 已含"未定项全部登记"这层意思（见上文「未定项怎么登记」），执行层不必自己解释
2。`.std/` 只读也在这一条里：内嵌运行时 `check_adoption` 看到内嵌目录下有已跟踪文件被改动（已暂存
或未暂存都算，覆盖 `git commit -a`）即判 FAIL（`adoption/embedded-modified`），执行层不必另写判断。
`check_all` 判的是本标准要求的工件与结构，不是 [01 §5.6](../../标准/01-项目管理标准.md#gates) 的 G1–G8；
测试、格式、依赖审计各按该节写执行点，可与它并列接进同一钩子（已观察：单人项目的钩子只接了 `check_all`，
测试从未进入必经路径；采用项目的 `GATES.md` 都写出测试门的执行点后，本句与 01 §5.6 重复，删去）。
承载可以是版本控制钩子、流水线作业或按清单执行的人工步骤，语义相同；其中钩子形态如下：

```sh
#!/bin/sh
exec python3 .std/tools/std/check_all.py . --no-scope
```

`git subtree add/pull` 走 `commit-tree`，不经过这个钩子，升级不需要放行；反过来它也看不见
`--no-verify` 的提交（git 接受无歧义缩写如 `--no-veri`，`-n` 可并进组合短选项如 `-an`）、
`git -c core.hooksPath=… commit` 临时换走钩子目录的提交、钩子文件失去执行权限后的提交（git 只打一行
hint 就跳过），以及 `git cherry-pick`、`git revert`、`git rebase` 与 fast-forward 的 `git merge`
写进分支的提交（这几类默认不运行 pre-commit 与 commit-msg，只有 `rebase -i` 的 reword 和冲突解决后的
`--continue`／`git commit` 会经过钩子）——这些盲区按
[01 §5.6](../../标准/01-项目管理标准.md#gates) 记为该门未覆盖的范围。不建议为这些写法加宿主询问规则：
git 选项的缩写与组合写不完，按命令字符串拦只能打地鼠；兜底靠 git 历史可查与非 fast-forward 合并、发布前的全量检查。
非 fast-forward 的 `git merge`
可再接一个 `pre-merge-commit` 钩子（内容为 `exec "$(dirname "$0")/pre-commit"`）转调同一钩子覆盖。这段是形态示意不是发布物；
`.std/` 前缀由采用项目自己的取用方式决定，换了前缀要跟着改。`check_all` 启动时先去掉 git 给钩子注入的
`GIT_DIR` 等仓库定位变量，从 git worktree 提交也不会把自检夹具写进本仓；`2026-09-23.9` 之前的版本在
worktree 里接这个钩子会写坏仓库（垃圾提交、`core.bare=true`），在主工作区用 `commit -a` 或按路径提交会
失败，先升级再接。代价是检查器读默认索引而非待提交的索引：`commit -a` 删已跟踪文件会报未定、按路径提交
时已暂存但不在本次提交里的文件也参与判定，偏向多拦；先 `git rm`、不按路径提交即可避开。

把 2 当告警放行的流水线，其结论不得被引用为"检查过了"。agent 侧的执行点是宿主工具自己的权限
规则与调用前钩子，按各工具自己的机制配；没配的按
[01 §5.5](../../标准/01-项目管理标准.md#controlled-actions) 记未定，不记为已受控。DSH 的
接法见下节。

## DSH 接法

**这是 DeepSeek Harness（DSH）一家的接法，是载体实例，不是标准正文。** 本仓只支持 DSH（D-135，标准仓 `docs/决策日志.md`），
执行层是 [`tools/dsh-std/`](../dsh-std/README.md) 插件：受控动作（[01 §5.5](../../标准/01-项目管理标准.md#controlled-actions)）
返回询问，`.std/` 只读返回拒绝。装法、判定表与盲区见该目录 README，本节只写它与 `check_all`、git 钩子的分工。
**接之前先在项目根跑一次** `python tools/std/check_all.py .`（内嵌项目用 `.std/tools/std/check_all.py`），
退出 0 再接提交钩子——否则接上即锁死这个项目的每一次提交。

- **分工**：插件在 agent 发起工具调用的当口收紧（问或拒）；`check_all` 在提交的当口判（`adoption/embedded-modified`
  覆盖「`.std/` 是被哪条命令改的」这类插件看不见的写入）；git 钩子拦人手敲的提交。三层互补，各自的盲区按
  [01 §5.6](../../标准/01-项目管理标准.md#gates) 记，不是二选一。
- **提交前必过 `check_all`**：git `pre-commit` 钩子（见上节形态示意）是必经路径。DSH 一侧**不再另写**调用前钩子——
  没有宿主钩子形态的第二处副本，少一处会过期的权威。插件的 `tools/pre-execute` 监听只做询问与只读，不替代 `check_all`。
- **权限边界在 DSH 自己的两个旋钮上**：沙箱模式与审批策略（`ask`／`never`）。插件的 `ask` 经 DSH 的审批通道，应答缺席、
  被拒、取消一律是拒绝，这一点由 DSH 保证、不由本仓保证。`ctx.tools.restrict()` 是**可见性过滤，不是安全边界**
  （标准仓 `docs/附录-载体实例/DSH载体映射.md` §5），不要拿它当权限用。
- **入口里模型要看的字段写正文行，不放 YAML 头**：这条是此前在另一宿主上实测出来的（YAML 头整段不进模型上下文）；
  DSH 的 `dsh-agent-instructions` 把入口文件原文作为持久基线消息注入，**读自包文档、未实机验证**，所以仍按
  `templates/CONTEXT_MANIFEST.md` 把合同头写成标题下的一行正文——这样两种可能都不出错。
- **入口文件名**：DSH 的 `dsh-agent-instructions` 默认读项目根到工作目录链上每一份 `AGENTS.md`（`CLAUDE.md` 也在候选里，
  内容相同只渲染一次）；有 `maxBytes` 预算，超出时先整份丢更宽泛的文件、最后才截断最具体的，并发出具名的可见通知。
  入口写成 `AGENTS.md`。预算默认值与是否被 profile 改过要自己核，别抄。
- **恢复与压缩后的重读**：DSH 的压缩由 `dsh-compaction` 做，会话日志是权威。「压缩或恢复后先重读当前工作项」这条
  **写进入口文件的加载合同**（[01 §4.2](../../标准/01-项目管理标准.md#session-protocol) 开工前八问②、
  [03](../../标准/03-Agent信息获取与上下文管理.md) §8.2 重建后重核 HEAD），不另造会话启动钩子；
  本仓未验证 DSH 有等价的「恢复后注入」事件，记未定。

**已验证**（2026-10-05，本机一个 profile、一个会话）：插件被 DSH 加载，`write`／`edit`／`pwsh` 下 deny 与 ask 的返回值被采纳。**未验证**（记未定，不折算为通过）：子 agent 是否继承、`Config` 降级后配置字段是否生效；
与同样订阅 `tools/pre-execute` 的其它包的先后顺序没有实测。第一次装上后要做一次真跑，步骤见插件 README。

**盲区**（都不记为已受控，按 [01 §5.5](../../标准/01-项目管理标准.md#controlled-actions)）：

1. 命令串匹配只是预过滤：解释器子进程写 `.std/`（如 `python -c "open(…, 'w')"`）、git 别名、拼接或编码后的命令，
   写入当时不拦；改的是已跟踪文件，提交时被 `check_all` 拦下；新建的未跟踪文件 `check_all` 不看。
2. `ask` 按命令字符串匹配，分不出读写：`git tag` 只列标签也会被问（列标签改用 `git show-ref --tags`）。
3. 同一条命令里先改 `.std/` 再提交：判定在整条命令之前做，看不见之后才发生的改动。
4. `tools/pre-execute` **不能改写参数**（dsh-tools README「Known Limitations」）：只能放行、问或拒。
5. 不经 DSH 的提交：人在终端手敲、IDE 里点的提交——只剩 git `pre-commit` 钩子。
6. **免审批清单**：`check_adoption` 原先读 Claude Code 的 `.claude/settings.json` 里的 `permissions.allow`。
   这一判据的对象已不存在，见下条；DSH 的审批策略是会话级旋钮（`ask`／`never`），没有「逐条放行通配规则」的项目级文件，
   本仓没有等价对象可读，该判据记 `SKIP` 并写明原因，**不折算为通过**。
7. DSH 自身的 `dsh-hooks-claude-code` 桥接包能执行 Claude Code 格式的 `hooks.json`。**走这条桥不算本仓的执行层**：
   那是同一份外部钩子换了个宿主跑，既保留了已退出支持的格式依赖，也不是原生机制（见 DSH 载体映射 §4）。

DSH 一手出处与版本记在 [`tools/dsh-std/README`](../dsh-std/README.md)「查证来源」，本节不重抄。

## 加一个自己的检查器

照 CONTRACT.md §4 的接口写 `checks/check_<name>.py`，最短的现成样板是
`checks/check_entry_budget.py`；`run()` 外壳与自检夹具用 `stdlib` 现成的 `run_guarded`、`probe`、
`write_files`、`git_track`。**必须带含反例的 `selftest()`**（CONTRACT.md §3），写完跑 `--selftest`。

## 已知误报形态

- **中文正文里的数值高召回。** 同一个"数字+量词+名词"出现在多个文件就报未定。设计如此
  （同形数字也可能各说各的，机械判不了），不是 bug。逐条登记理由的落点见上文
  「未定项怎么登记」。
- **中文锚点判不了。** 各平台给中文标题生成锚点的规则不一致，工具拒绝猜：中文锚点没匹配上
  记未定，ASCII 锚点才判 FAIL。
- **重复文本的阈值对源码偏松。** 旋钮是 `budgets.duplicate_min_lines` 与
  `budgets.duplicate_min_chars`。**调阈值不是关检查**：证据里会写明用的是项目值还是默认值。
- 重复文本与重复数值这两条判据，只在**一组重复的全部出现位置都落在非文档文件**时才丢弃；丢弃
  的组不静默消失，汇总成一条 `SKIP`（判据不适用，带代表位置），指向 02 §4 按技术债处置。只要有一处落在文档里，照常报。
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
- **`drift` 的日期判据以提交时刻在最晚时区 UTC+14 下的日期为基准**，不用提交自带的时区：写日期的人
  与提交者时区未必相同。代价是作者当地时间到 UTC+14 之间那几个小时里写下的提前日期不会被报。
- **`drift` 的工作项载体只认两处**：work_root 直接一层里以该 ID 开头（其后不接数字）的 *.md，或状态源文件里行首的
  `work_item_id：<ID>`。放在 work_root 子目录里的工作项文件不算载体，会报 missing（未定）。

## 已知缺口

- **自检样本自己可能有盲区。** 真实教训：`git ls-files` 曾因 `core.quotepath` 把中文路径输出成
  转义形式，成批产生假 FAIL，而当时的自检是**通过**的——因为样本里的路径全是 ASCII。自检绿
  不等于在你的仓库里也对。新增检查器时，反例样本要包含你项目里真实存在的形态。
- **"§5 的键集合 == 实现读的键集合"目前只能靠人核对，没有机械手段。** 现在两边一致是一次人工 grep
  比对的结果，不是自检保证的；往检查器里加一个新配置键而忘了写进 §5，没有任何东西会报警。
- **篇幅预算不全。** 01 §3.7 六项里 INDEX 一项不执行（「每份文档一行」不是行数）；状态、交接、
  工作项、模块文档四项未声明预算键不判；工作项只看 `layout.work_root` 直接一层、头部带状态字段的
  文件；状态声明为目录时不按 80 行判。
- **免审批清单判据本宿主无对象，记 SKIP。** 原先读 Claude Code 的 `.claude/settings.json`（D-135 起该宿主不再支持）；
  DSH 的审批策略是会话级旋钮，没有项目级入库的逐条放行清单可读。SKIP 不是通过：没读到不等于没有通配放行项。
  通配判定函数 `_wildcard_allow` 与它的反例自检保留，为有对象的宿主或旧项目接回而留。

## 本仓库自己的采用结果

标准仓自己也是采用者（配置在标准仓自己的 `governance/project.yaml`，不在交付面里）。裁剪了哪几项、理由是什么，
见该文件的 `tailoring`——裁剪是登记的不适用，不是修好了。唯一一条未定是 `single-authority/count-claim/14:个:部件`，
已登记为 EX-001，所以扫描退出 0。退出 0 不等于全绿：那条仍是未定、仍计数，登记只改了退出码。现状以在标准仓根跑
`python3 tools/std/check_all.py . --no-scope` 为准。
