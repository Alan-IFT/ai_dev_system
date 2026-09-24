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

同一张表里项目自己的门号例外（规则列不含 `/`，如依赖规则、依赖审计）不参与登记，但**也按到期判**：
没关闭、到期早于运行日的判 FAIL（`exception-register/own-expired/<编号>`），到期写不成日期的记一条
未定。关闭的写法是状态列写「已处理」「关闭」之类并写明处理方式。

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
  `git rm -r -q .`（首次跳过）→ `git checkout main -- 标准 templates tools/std LICENSE LICENSE-DOCS` → 写／更新根
  `README.md`（说明本分支是 main 的发布产物、含哪几个目录、对应哪个 main 提交）→
  `git commit -m "release <tag>：来自 main <sha>"` → `git tag <tag>` → push 分支与 tag。
  每次发布提交接在上一次之上，不用 orphan 重建——重建会让两个 tag 间的 diff 不再是升级差异。
  **push 时同时推到公开仓**（`release` 分支在公开仓里就是它的 `main`，采用项目按上面「取用」那条
  命令取的也是这个地址）：`git push https://github.com/Alan-IFT/ai-dev-std.git release:main --follow-tags`；
  `--follow-tags` 只推带注解的 tag，用 `git tag <tag>` 打的轻量 tag 不在其中，那就分两条：
  `git push <公开仓> release:main && git push <公开仓> <tag>`。本仓 main 含不可公开的脚手架，只推 `release`，不推 main。

**执行层由采用项目自己接**，标准不发**生效的**钩子、流水线或 agent 侧配置——它们随宿主工具变，
上游给一份就会过期成第二处权威；`templates/` 里的 agent、skill 文件是供复制的载体实例，拷进项目的
`.claude/` 之后才生效，由采用方自己决定。接法只有一条：把 `check_all` 放进提交、合并或发布的必经路径，退出码非 0
就不放行；退出码 0 已含"未定项全部登记"这层意思（见上文「未定项怎么登记」），执行层不必自己解释
2。`.std/` 只读也在这一条里：内嵌运行时 `check_adoption` 看到内嵌目录下有已跟踪文件被改动（已暂存
或未暂存都算，覆盖 `git commit -a`）即判 FAIL（`adoption/embedded-modified`），执行层不必另写判断。
承载可以是版本控制钩子、流水线作业或按清单执行的人工步骤，语义相同；其中钩子形态如下：

```sh
#!/bin/sh
exec python3 .std/tools/std/check_all.py . --no-scope
```

`git subtree add/pull` 走 `commit-tree`，不经过这个钩子，升级不需要放行；反过来它也看不见
`git merge` 带进来的改动与 `--no-verify` 的提交——这两条盲区按
[01 §5.6](../../标准/01-项目管理标准.md#gates) 记为该门未覆盖的范围。这段是形态示意不是发布物；
`.std/` 前缀由采用项目自己的取用方式决定，换了前缀要跟着改。`check_all` 启动时先去掉 git 给钩子注入的
`GIT_DIR` 等仓库定位变量，从 git worktree 提交也不会把自检夹具写进本仓；`2026-09-23.9` 之前的版本在
worktree 里接这个钩子会写坏仓库（垃圾提交、`core.bare=true`），在主工作区用 `commit -a` 或按路径提交会
失败，先升级再接。代价是检查器读默认索引而非待提交的索引：`commit -a` 删已跟踪文件会报未定、按路径提交
时已暂存但不在本次提交里的文件也参与判定，偏向多拦；先 `git rm`、不按路径提交即可避开。

把 2 当告警放行的流水线，其结论不得被引用为"检查过了"。agent 侧的执行点是宿主工具自己的权限
规则与调用前钩子，按各工具自己的机制配；没配的按
[01 §5.5](../../标准/01-项目管理标准.md#controlled-actions) 记未定，不记为已受控。Claude Code 的
接法见下节。

## Claude Code 接法

**这是 Claude Code 一家的接法示意，不是标准正文，也不随标准发 settings 文件。** 只用 Claude Code
自带的权限规则与钩子：采用项目把下面这段并进自己的 `.claude/settings.json`（已有 `permissions` 或
`hooks` 的合并进去，不要整份覆盖）。**接之前先在项目根跑一次** `python3 .std/tools/std/check_all.py .`，
退出 0 再接——否则接上即锁死这个项目的每一次提交。

```json
{
  "permissions": { "deny": ["Edit(/.std/**)"] },
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{
      "type": "command", "if": "Bash(*git*commit*)",
      "command": "python3 -c \"import sys,json,re; sys.exit(0 if re.search(r'git.*commit', json.load(sys.stdin)['tool_input']['command'], re.S) else 3)\"; [ $? -eq 3 ] && exit 0; cd \"$CLAUDE_PROJECT_DIR\" && python3 .std/tools/std/check_all.py . --no-scope >&2 || exit 2"
    }]}],
    "SessionStart": [{ "matcher": "resume|compact", "hooks": [{
      "type": "command",
      "command": "cd \"$CLAUDE_PROJECT_DIR\" && { git log -1 --format='HEAD %h %s'; git status -sb | head -20; }; echo '压缩或恢复后先重读当前工作项。'"
    }]}]
  }
}
```

- **`.std/` 只读**：`Edit(/.std/**)` 的单个 `/` 锚在会话的主工作目录（不是文件系统根），在项目根启动会话即是项目根。Edit 的 deny 规则作用于
  全部内置编辑工具（Edit、Write、NotebookEdit），也作用于 Claude Code 认得出的 Bash 文件写——重定向
  目标、`tee`、`sed -i`、`cp`、`mv`、`rm`；读不受影响。deny 在任何权限模式下都生效，
  `bypassPermissions` 也不例外。
- **提交前必过 `check_all`**：命令前半段从 stdin 读出这条 Bash 命令的全文，明确判为不含 `git…commit`
  （可跨行）才退出 3、`exit 0` 放行；其余都跑 `check_all`，退出非 0（有 FAIL，或有未登记的未定）
  就 `exit 2`。**只有 exit 2 阻断**，其它非 0 退出码只是非阻断错误、动作照常执行；检查结论走 stderr
  回给模型，它看得到是哪一条没过。`.std/` 有改动时拦下提交的就是上面那条
  `adoption/embedded-modified`，不论 `.std/` 是被哪条命令改的。
- **`if` 只是预过滤**：它按 Claude Code 解析出的子命令匹配，[官方文档](https://code.claude.com/docs/en/hooks#bash-if-matching)
  说明这是尽力而为，解析不了的命令形状一律触发。实测会触发的有 `$(…)`、反引号、`{ …; }`（不带 `$`
  与重定向也算）、循环体里用了变量；`$VAR` 作普通参数、单条重定向不触发。所以真正做判断的是命令
  前半段，只看文本，故意写宽：`bash -c "git commit …"`、`env git commit`、`/usr/bin/git commit`、
  `git -C … commit`、`git -c … commit` 都命中。代价是 `check_all` 红着的时候，文本含 `git…commit` 的
  命令（如 `git log --grep=commit`）也被拦，拒绝信息就是完整的检查结论，照它清账即可。
- **不另设的**：`.claude/` 与 `.git/` 是 Claude Code 的内置受保护路径，写入不会被自动放行
  （`bypassPermissions` 除外），不再自写规则。**不做成插件**：插件的 `settings.json` 不支持
  `permissions`，而拦 `.std/` 写入要的正是权限规则。
- **恢复与压缩后注入（可选）**：`SessionStart` 设 `"matcher": "resume|compact"`——startup 时
  Claude Code 已自带 gitStatus 快照，不重复注入。按官方文档，它的 stdout 直接进模型上下文。只注入
  动态事实：HEAD、`git status -sb` 前 20 行（含分支），再加一句「压缩或恢复后先重读当前工作项」，
  对应 [01 §4.2](../../标准/01-项目管理标准.md#session-protocol) 开工前八问②、
  [03](../../标准/03-Agent信息获取与上下文管理.md) §8.2 重建后重核 HEAD。**静态提醒（按加载合同开工、
  先读状态源与当前工作项、身份不一致先停）写进入口文件的加载合同**，不放钩子——照官方「CLAUDE.md
  for static context」。只注入不阻断（这个事件本来也不能阻断）；`git log` 失败不影响 `git status`，
  不在 git 仓里时 git 报错，提醒照样输出。
- **入口里模型要看的字段写正文行，不放 YAML 头**：2026-09-24 在 claude 2.1.281 上实测，`CLAUDE.md`、
  它 `@` 导入的文件、单独自动加载的 `AGENTS.md`，YAML 头都整段不进模型上下文，正文行照常可见。
  所以加载合同的合同头（修订号、当前工作项）按 `templates/CONTEXT_MANIFEST.md` 写成标题下的一行正文。

2026-09-23 在 Ubuntu、claude 2.1.280 上用 `claude -p`（`--allowedTools Bash` 放开整个 Bash）实测：
Edit/Write 写 `.std/`、`echo x > .std/x.md`、`tee`、`cp`、`mv`、`sed -i`、`rm -rf .std` 全部被拒，读
`.std/` 放行；`check_all` 红时 `git commit -am`、`bash -c "git commit …"`、`env git commit`、
`/usr/bin/git commit` 全部被拒；`.std/` 有未暂存改动时 `git commit -am` 被拒、理由是
`adoption/embedded-modified`，`git stash push -- .std` 放行，移出后提交放行；`check_all` 红时
`git log --grep=commit` 也被拒（即上面说的代价）。同日另测：只有 `if`、没有前半段时，真实采用项目里
两条不含 commit 的复合命令（含 `$(git rev-parse --short HEAD)`）在 `check_all` 红时被拦；加上前半段
（`claude -p` 实跑的是早先出错即放行的版本，与上面片段只在过滤自身出错时不同）后这两条与
`echo $(git rev-parse HEAD)` 放行，上面的提交变形与 `git -C . commit`、`git -c x=y commit` 仍被拒。
上面这版片段只在 shell 里配假 `check_all` 复跑过：`git commit`、反斜杠续行的提交、非 JSON 输入、缺
`command` 字段在 `check_all` 红时都退出 2、绿时退出 0，`git status` 退出 0，`python3` 缺失退出 2。

**盲区**（都不记为已受控，按 [01 §5.5](../../标准/01-项目管理标准.md#controlled-actions)）：

1. 解释器子进程写 `.std/`（如 `python3 -c "open(…, 'w')"`，实测放行）、`git checkout -- .std` 之类
   git 自己的写入，写入当时不拦；改的是已跟踪文件，提交时被 `check_all` 拦下；新建的未跟踪文件
   `check_all` 不看。
2. 同一条 Bash 命令里先改 `.std/` 再提交（含 `git add -A && git commit` 带进新文件）：钩子在整条
   命令之前跑，看不见之后才发生的改动。
3. 钩子超过时限（command 钩子默认 600 秒，可用 `timeout` 字段改）会被宿主取消，按官方文档不阻断，
   提交照常执行。其它出错不在此列：`python3` 缺失、`cd` 失败、`check_all` 跑不起来都转成阻断，
   后果是每次提交都被拦（出错即拦），要先修好环境。前半段本身出错（stdin 不是合法 JSON、没有
   `command` 字段）不放行，退化为触发了 `if` 的命令都要过 `check_all`，即只有 `if` 时的宽度。
4. 文本里看不到 `git` 在前、`commit` 在后的命令放行：git 别名（如 `git ci`）、经变量拼出的提交（如
   `c=commit; git $c -m x`，`check_all` 红时实测退出 0；`git $(echo commit)` 字面可见，仍退出 2）。
5. 不经 Claude Code 的提交：人在终端手敲、IDE 里点的提交——接上面那个 git pre-commit 钩子。两层
   互补，不是二选一：git 钩子拦人（但被 `--no-verify` 跳过、看不见 `git merge`），这一层拦 agent
   （拦得住 `--no-verify`，只覆盖 Claude Code 自己发起的动作）。两层都不是全覆盖，各自的盲区按
   [01 §5.6](../../标准/01-项目管理标准.md#gates) 记。

**两份可选模板**在 [templates/claude-code/](../../templates/claude-code/)，拷到项目 `.claude/` 下的同名子目录即生效，不用改 settings；
和其它模板一样，拷走即归项目所有，`.std/` 升级不会带着它变：

- `agents/std-reviewer.md`：只读审查子 agent，对应 [01 §4.4](../../标准/01-项目管理标准.md#review-flow) 生产者≠验证者、
  [03 §9](../../标准/03-Agent信息获取与上下文管理.md#delegation) 的返回三态与 expected/received/missing。`tools` 只给
  Read、Grep、Glob，**不给 Bash**：Bash 限定不了只读。代价是它不能复跑测试，只能读生产者附上的命令与
  完整输出（01 §4.2 四类出口允许读这份证据当作已核）；要它复跑就自己加 Bash，它也就不再只读。`model` 由项目定。
- `skills/std-handoff/SKILL.md`：收工、交接技能，对应 01 §4.2 收工前第 1–3 条、03 §8.1 两半交接。调用时用 `!`
  注入 `git status -sb` 与最近 5 条提交，`allowed-tools` 只预批这两条 git 命令；模板用项目自己的，找不到就停下问。可以敲 `/std-handoff`
  手动触发，模型也会按 description 在收工、交接时自己调。

2026-09-24 在 claude 2.1.281 上用 `claude -p --model haiku` 实测（当时未设 matcher 的旧片段）：
SessionStart 在 startup、resume、`/compact` 三种情形都注入了，resume 前新做的提交也读对了；clear、
fork 未实测。现行 `resume|compact` 片段的实测见本节末。std-reviewer 能被
调用，让它写文件时它一次工具都没调，文件没建出来（对照：同一会话里主 agent 在 acceptEdits 下写入成功）。
`/std-handoff` 能触发，`!` 注入生效。现行 `resume|compact` 片段同日另测（haiku，`claude -p`）：startup 不注入；
新提交后 `--resume`，模型逐字读出新的 HEAD 行与提醒句；`git log` 失败（仓里还没有提交）时 `git status`
照常输出。compact 未对现行片段实测。

**免审批清单**：`check_adoption` 读本文件的 `permissions.allow`，放行任意代码或任意委托的整类规则
（`Bash`、`Bash(*)`、解释器或运行器后只剩通配、`PowerShell`、`PowerShell(*)`、`Monitor`、`Agent`）判
FAIL（[01 §5.5](../../标准/01-项目管理标准.md#controlled-actions)）。auto 模式下 Claude Code 自己就会
丢弃这类规则，本检查的增量在 manual、acceptEdits 这些会照单放行的模式下。`defaultMode:
bypassPermissions` 写在项目级或 local 设置里 Claude Code 自身不生效（官方 settings 文档），不判，交给宿主。

**这几项的盲区**：SessionStart 只是提醒，模型可以不理会，也可以不读工作项；它注入的是事实，
不替模型判断"与工作项一致吗"。std-handoff 没人调就没有交接。要在收工时卡住，得另接 Stop 钩子：
官方文档写明 `decision: "block"` 能让模型继续干，本次顺带实测 Stop、SubagentStop 的阻断都生效。但
交接写全没写全要靠判断，这里不接。std-reviewer 只做到上下文隔离：给它什么输入仍由委托它的人挑，
01 §4.4 的执行点仍是评审者本人的人工核。

官方文档：[hooks](https://code.claude.com/docs/en/hooks)（exit 2 语义、`if` 字段、时限）、
[permissions](https://code.claude.com/docs/en/permissions)（Edit 规则的路径写法与 Bash 文件写的覆盖面）、
[permission-modes#protected-paths](https://code.claude.com/docs/en/permission-modes#protected-paths)、
[plugins-reference](https://code.claude.com/docs/en/plugins-reference)（插件 settings 只支持的键）、
[permission-modes](https://code.claude.com/docs/en/permission-modes)（auto 模式丢弃的通配放行规则）、
[settings](https://code.claude.com/docs/en/settings)（`defaultMode` 的生效范围）、[memory](https://code.claude.com/docs/en/memory)（静态上下文写进 CLAUDE.md）、
[sub-agents](https://code.claude.com/docs/en/sub-agents)（`tools` 字段）、[skills](https://code.claude.com/docs/en/skills#inject-dynamic-context)（`!` 注入与 `allowed-tools`）。

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
- **`drift` 的工作项载体只认两处**：work_root 直接一层里以该 ID 开头的 *.md，或状态源文件里行首的
  `work_item_id：<ID>`。放在 work_root 子目录里的工作项文件不算载体，会报 missing（未定）。

## 已知缺口

- **自检样本自己可能有盲区。** 真实教训：`git ls-files` 曾因 `core.quotepath` 把中文路径输出成
  转义形式，成批产生假 FAIL，而当时的自检是**通过**的——因为样本里的路径全是 ASCII。自检绿
  不等于在你的仓库里也对。新增检查器时，反例样本要包含你项目里真实存在的形态。
- CONTRACT.md §5 的字段表已按实现补齐（`tier`、`layout.work_root`/`artifacts`/`rule_files`、`derived`、
  `metadata_fields`/`metadata_required`、两个 `work_item_*_states`、两个 duplicate 阈值与两个 stale
  阈值），顶层 `rule_files` 这个重复拼法已从代码里删掉，只留 `layout.rule_files`。反向的缺口
  （§5 写了但没有检查器读的键）已清空：`standard_version` 已删除；`budgets.status_lines` 等四个
  篇幅预算键曾因没有读者删掉，现在随 `check_entry_budget` 的四项预算一起回来。
- **"§5 的键集合 == 实现读的键集合"目前只能靠人核对，没有机械手段。** 现在两边一致是一次人工 grep
  比对的结果，不是自检保证的；往检查器里加一个新配置键而忘了写进 §5，没有任何东西会报警。

- **篇幅预算不全。** 01 §3.7 六项里 INDEX 一项不执行（「每份文档一行」不是行数）；状态、交接、
  工作项、模块文档四项未声明预算键不判；工作项只看 `layout.work_root` 直接一层、头部带状态字段的
  文件；状态声明为目录时不按 80 行判。
- **免审批清单只读入库的 `.claude/settings.json`。** 不读 `.claude/settings.local.json` 与用户级设置
  ——个人在交互里点「总是允许」攒下的通配放行项落在那里，本工具看不见（那份文件不入库、因人因机器
  而异，读了会让同一提交在不同机器上结论不同）；要查就自己跑 `grep -n '"Bash' .claude/settings.local.json`。
  只判 Bash 规则，解释器与运行器按一份固定清单认；不判 MCP、WebFetch 等工具的放行范围，也不判每项
  有没有加入理由与复审条件。

## 本仓库自己的采用结果

本仓库自己也是采用者，记录在 标准仓 `governance/project.yaml`。**它自己
没有全绿**：仍有未定没处置、也没登记。验收条目工件在 `tailoring` 里按"本仓库不交付软件"
登记为不适用（`layout:acceptance`）——那是裁剪，理由写在登记里，不是被修好了。
作者自己的仓库不全绿，比全绿的样例更能说明三态怎么用。
