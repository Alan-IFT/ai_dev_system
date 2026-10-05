# dsh-std：DeepSeek Harness 插件（标准仓的执行层）

**这是载体实例，效力为零**，不是标准正文（D-020）。它是本仓唯一受支持宿主上的执行层，由 D-135 引入，放行依据是 D-108 登记行的「修订」句（二者都在标准仓 `docs/决策日志.md`）。

## 它做什么

两件事，都落在 DSH 的 `tools/pre-execute` 瀑布上：

1. **受控动作询问**（[01 §5.5](../../标准/01-项目管理标准.md#controlled-actions)）：`reset --hard`、强推与删分支、`git rm`／`git clean`、打 tag、推公开仓、`--no-verify`、改 `core.hooksPath`、删状态入口与失败清单、改默认上下文合同与入口指令文件、改提交闸门钩子、改插件自身。命中即返回 `ask`，由 DSH 的 `dsh-user-approval` 找人批准。
2. **内嵌标准目录只读**（[01 §8](../../标准/01-项目管理标准.md#adoption)）：对 `write`／`edit` 写 `.std/` 下的路径与疑似写 `.std/` 的 shell 命令返回 `deny`。

判定核心 [`lib/policy.js`](lib/policy.js) 是纯函数，适配层 [`lib/index.js`](lib/index.js) 只有一个监听。

## 装法（每个 profile 一次）

```text
# 1. 把本目录作为本地包装进 profile（路径换成你的克隆位置）。
#    本机 profile 里已有的本地包（dsh-user-preferences）用的是 link: 形态，下面照它写；
#    这条命令本身没有跑过，link: 与 file: 哪个更合适未定。
cd %DSH_PROFILE_DIR%      # 默认 C:\Users\<你>\.dsh\profiles\desktop
pnpm add link:D:/Programs/AI辅助开发规范及工作流确定/tools/dsh-std

# 2. 在 profile 的 package.json 里把 "dsh-std" 加进 dsh.profile.bundles（插件管理页「Plugins」也能选）
```

采用项目内嵌 `.std/` 之后，路径改成 `.std/tools/dsh-std`。**只改 profile，不改项目仓**：守卫属于宿主配置，不随项目文件走。

## 与 DSH 自带机制的分工

- 真正的权限边界是 DSH 的**沙箱模式**与**审批策略**（`ask`／`never`），本插件不替代它们。`never` 下 `ask` 会被确定性拒绝，这是 DSH 一侧保证的。
- 本插件**只收紧不放宽**：与下游决定合并时取最严（`deny` > `ask` > `allow`）；下游返回认不出的决定按 `ask` 的严重度处理，不当放行。（2026-10-04 提交前审查发现此前的写法会把自己的 `deny` 降成下游的 `ask`，已改并加了回归用例。）
- **项目根（`root`）怎么定**：插件配置里的 `root` 优先；没写就取该次调用所属会话的工作目录（`exec.agent.session.header.cwd`，读自 `dsh-hooks-claude-code` 的 `PreToolUse` 载荷构造）；再没有才取进程 cwd。审查实测过：只用进程 cwd 时，cwd 不对写 `<项目>\.std\…` 的绝对路径会判 allow，所以适配层先用会话 cwd。**会话若是在项目子目录里开的，会话 cwd 就不是项目根，`.std` 判偏**——这种用法要在 profile 的 `cordis.patch.yml` 里按 id `dsh-std` 覆盖并写 `config: {enabled: true, root: <项目根>}`（覆盖会替换整块 config，要写全）。`cordis.patch.yml` 随包发的默认值里没有 `root`，因为它因项目而异。会话 cwd 这一路只读源码得出，**没有实机验证**。
- 判定器自己抛异常按**未定**处理（返回 `ask`），不放行。

## 怎么判

**判定核心经过四轮独立审查，设计改过三次。** 第一版是跨整串的正则（实测立方级 ReDoS、大量 deny 误报）；第二版按词法切子命令（仍被转义引号、命令替换、heredoc、括号与控制流绕过）；现在是**一遍手写词法扫描 + 逐段判**。取舍始终是：**deny 只给两件不需要猜的字面事实，其余交给人（ask），解析不了的形状整条 ask、不静默放行。**

### 词法（`lex`，线性，无回溯正则）

按未被引号包住的 `; && || | |& &` 与换行**切子命令**；同时：

- **转义引号**（bash 的 `\"`、PowerShell 的 `` `" ``）在引号内外都不开关引号；双引号内的 `$( )` 与反引号**照样抽取**；
- **命令替换** `$( )`、反引号对、进程替换 `<( )` `>( )` 里的命令**抽出来递归判**（继承外层虚拟 cwd）；
- **here 文档**（`<<EOF`、`<<-EOF`、`<<'EOF'`）与 **PowerShell here-string**（`@'…'@`、`@"…"@`）的**正文是数据**，不当命令判；正文里写 `> .std/x` 不会被 deny；
- 词首的 `#` 行注释与 `<# … #>` 块注释丢弃（`a#b`、`url#frag`、`$#` 不是注释）；词首的 `{ }` 当分隔（脚本块、`foreach(){}`、`if … then … fi`、`for … do … done` 的控制词也被剥掉），词中的 `${x}`、`{a,b}` 是普通字符；
- **解析不了的形状整条 ask**：引号不配对、here 文档/here-string 没有终止符、块注释不闭合、正文含命令替换（未加引号的终止符）、命令替换的括号不配对、嵌套超过 2 层、命令超过 8192 字符。

### deny（只有两个来源）

1. `write`／`edit` 的路径参数落在 `.std/` 之下（Windows 上忽略大小写、段尾点与空格、`\\?\` 前缀、`.//` 与 `./`、NTFS 备用数据流后缀）；
2. shell 命令里**引号外的重定向目标词**按**虚拟 cwd**（`cd` 会更新它）解析后落在 `.std/` 下：`> x`、`>> x`、`word>x`、`>|x`、`>&x`、`2>x`、`1>x`、`>.std/a echo x`（重定向在命令前）。目标是文件描述符或 `$null`/`nul`/`/dev/null` 的不算。

按**项目根**才落在 `.std/`、按虚拟 cwd 不落（`cd other; echo x > .std/a`）的是 ask，不是 deny——`cd` 可能没生效，也可能目标其实是 `other/.std`。

### ask

- **带 `.std` 的写类命令**：命令有写动词（PowerShell 全名与别名、cmd 内置、常见 POSIX 写命令、`git` 改工作区的子命令、`find -delete/-exec`），且参数里有 `.std`（含 `-Path:.std`、`of=.std`、`--output=.std`、`-o.std/a` 紧贴、逗号列表、括号、`.std/$f` 取静态前缀）、或虚拟 cwd 就在 `.std` 里。**写目标不猜**，交给人。
- **受控 git 动作**（先跳过 `-C dir`／`-c k=v`／`--git-dir` 等带值全局选项再取子命令）：`reset --hard/--keep/--merge`、强推（`-f`、`--force*`、`+refspec`、`:refspec`）、删/镜像远端引用、推标签（`--tags`、`--follow-tags`、`refs/tags/`、`v1.0`/日期式的单个 tag）、推公开仓与 `release`（含 `x:release`、`refs/heads/…:refs/heads/release`）、推以地址写出的远端、`tag`、`branch -d/-D/-f/-m/-M`、`update-ref -d/--delete`、`filter-branch`、`worktree remove`、`rm`、`clean`、`commit -n`、改 `core.hooksPath`、`-c alias.*` 注入；`git.exe`／`git.cmd`／绝对路径同样识别；`Start-Process git -ArgumentList "push","-f"` 展平后判。`--no-ve*` 与 `hookspath` 在任何词里出现都问。
- **前缀包装先剥再判**：`env`（含 `-u X`、`--`）、`sudo`（含 `-u user`、`--`）、`doas`、`command`、`time`、`nohup`、`nice`（含 `-n 5`）、`stdbuf`、`timeout`（含 `-s KILL 5`）、`xargs`（含 `-I {}`）、`busybox`、`exec`、`start`/`call`/`Start-Process`、`VAR=val` 前缀、`if/then/do/!` 等控制词。
- **把命令当字符串交给别的 shell 的包装取内嵌串再判**：`bash/sh/zsh/dash/ksh/fish -c`（含 `-lc`、`-ec`、`-cx` 选项簇）、`cmd /c` `/k`、`powershell`/`pwsh -c`／`-Command`（含参数缩写 `-com`…）、`iex`、`Invoke-Expression`、`eval`；最多 2 层。**`-EncodedCommand`、管道喂给裸解释器（`echo … | bash`）、裸 `bash`/`pwsh`/`cmd` 一律 ask**（守卫看不见内容）。
- **删除/移走/清空状态入口与失败清单**（`rm`、`unlink`、`shred`、`truncate`、`mv`、`Set-Content`、`> PROJECT_STATUS.md`、`find … -delete`），以及 `cp/curl/wget/dd/tee…` 覆盖它们；**通配符**（`rm .st*`、`rm AGENTS*`、`rm -r .*`、`PROJECT_STATUS.*`）可能匹配 `.std`／状态文件／受保护文件时也问（`rm *.log`、`rm build/*` 不问）。
- **写入口合同、入口指令、提交钩子、守卫自身**：写工具按路径判；shell 按「写动词 + 参数路径」判，并按虚拟 cwd 解析（`cd tools; rm dsh-std/lib/policy.js`、`cd .githooks && echo x > pre-commit`）。

### 只读用法不问

`sed` 无 `-i`、`tar -t`、`unzip -l/-p/-t`、`git reset`（默认 mixed）、`git restore --staged`、`git rm --cached`、`git apply --check`、`find` 无 `-delete/-exec`、`2>&1`／`2>$null`／`>/dev/null`、`command -v git`、`bash build.sh`、`pwsh -File x.ps1`、`bash -c "ls -la"`。

## 盲区（读源码与单测得出，不是实测得出）

下面这些**仍然是 allow（放行）**，都是审查者或我实测过的。它们的共同点是：要拦住就得做真正的 shell 解析与数据流分析，超出一个预过滤的合理范围；兜底是提交前的 `check_all`（`adoption/embedded-modified`）与 git 钩子。**这不是穷尽清单，是已知清单。**

- **解释器子进程里的写**：`python -c "open('.std/x','w')"`、`node -e`、`[IO.File]::WriteAllText`、`perl -pi`、脚本文件里的写（`bash build.sh`、`pwsh -File x.ps1`、`source x.sh`、`. ./x.sh`——每个脚本都问会让人疲劳，所以只问「没给命令串也没给脚本的」）。
- **管道目标与间接执行**：`ls .std | xargs rm`、`Get-ChildItem .std | Remove-Item`（命令本身不带 `.std`，`.std` 在管道上游）。
- **变量、`~`、环境变量路径**：`echo x > $PWD/.std/a`、`cp a ~/proj/.std/a`、`$env:PWD/.std/a`、`$f="AGENTS.md"; Set-Content $f x`、`x=git; $x tag y`、`alias g=git; g tag x`。含变量的词只取变量之前的静态前缀。
- **git 的非受控写路径**：`git add .std`、`git clone x .std`、`git submodule update --init .std`、`git subtree add --prefix=.std …`；`git push public main`（别名远端，只认 `ai-dev-std` 字面与地址形态）。
- **写动词表是有限的**：表外（`mklink`、`attrib`、`icacls`、`chmod`、`Move-ItemProperty` 等）看不见；短名（`STD~1`）、符号链接、零宽字符插进路径不解析。
- **词法不是真 shell**：PowerShell 的 `-f` 格式化运算符、`switch` 的块、`trap`、嵌套 here 文档、`cmd` 的 `^` 转义、`bash` 的算术/数组展开里的命令，可能判偏。
- 只认工具名 `write`／`edit`／`pwsh`／`bash`。其它会写文件的工具（笔记本编辑、补丁应用等，名字未查证）**默认放行**。

**会多问的（不是漏，是取舍）**：`git tag` 一律问（含 `git tag --list`、`git tag --help`；列标签改用 `git show-ref --tags`）；**任意位置出现 `git` 词都按 git 命令判**，所以 `echo git tag` 也会被问（`grep "git tag"`、`git log --grep=tag`、提交信息里的 `tag` 字样因为 `git` 词后面的子命令不是 `tag` 或整句在引号里，不问）；`git branch -m/-M` 改名；`cp AGENTS.md AGENTS.bak` 只是读入口文件但命令里有受保护路径与写命令；`cp .std/a out`、`Copy-Item -Path .std\x -Destination out`、`mv .std/a out` 读取 `.std` 的写类命令；`git push` 到整段是 `release` 的分支（`feature/release-notes` 不会）；`git push origin v1.0` 版本号式单个 tag；超过 8192 字符的命令（长 heredoc、长 `python -c`、长提交信息）；裸 `bash`/`pwsh`；`echo … | bash`。

- `commitMessageProblem` 目前**没有调用方**（提交信息由 `.githooks/commit-msg` 查），不要当作已生效的检查。
- 不覆盖不经 DSH 的动作：人在终端手敲、IDE 里点的提交，只剩 git 钩子这一层（标准仓 `docs/附录-载体实例/仓库工作须知.md` §7）。
- `tools/pre-execute` **不能改写参数**（dsh-tools README「Known Limitations」），所以本插件只能放行、问或拒，不能把危险命令改成安全命令。

## 查证来源与未验证项

读自本机安装的 DSH 0.2.0-rc.2 包源码与 README（V1 一手，2026-10-04）：

| 事实 | 出处 |
|---|---|
| `ctx.on('tools/pre-execute', async (exec, next) => …)` 返回 `allow／deny／ask`；`ask` 经 `dsh-user-approval`，应答缺席即拒绝 | `dsh-tools` 的 `prepareExecution` 与 `serviceAsk` |
| `ctx.tools.guard()` 单调、同步、普通 context 全局、经 `agent.ctx` 注册则只对该 agent 生效 | `dsh-tools` README「Enforce policy on calls」与源码注释 |
| 内置工具名与路径参数：`read`／`write`／`edit` 用 `file_path`，`pwsh`／`bash` 用 `command` | `dsh-tool-fs`、`dsh-tool-pwsh`、`dsh-tool-bash` |
| 插件以 profile bundle 装入，bundle 补丁文件为 `cordis.patch.yml` 的 `insert` 列表 | `dsh-plugin-manager` README、社区包 `dsh-user-prompt` 的写法 |

**已在真实 DSH 会话里验证过的（2026-10-05，DSH 0.2.0-rc.2，本机 `desktop` profile，装法见上）：**

装上后，**在我（执行这次安装的会话）自己正在运行的会话里，没有重启就观察到了守卫生效**。我没有查证这是 DSH 的 HMR 热重组、还是别的机制（例如每次工具调用时重新读取 profile），所以不要据此断言「改 profile 一定热生效」——换一台机器或换一种启动方式可能需要重启。实测：

| 动作 | 观察到的 |
|---|---|
| `write` 工具写 `.std/x.md` | 被拒，错误信息正是本插件的 deny 文案「内嵌标准目录 .std/ 只读（01 §8）…」；文件没有落盘，`.std` 目录也没被创建 |
| `pwsh` 工具执行 `echo … > .std/redir.txt` | 被拒，文案「命令把输出重定向到内嵌标准目录 .std/…」；文件没有落盘 |
| `edit` 工具改 `.std/y.md` | 被拒，同样是 deny 文案；没有落盘 |
| `edit` 工具改受保护文件 `AGENTS.md` | **被拒：`the user rejected tool "edit"`**（`never` 策略下 `ask` 的结果）；文件没有被改 |
| `pwsh` 工具执行普通命令（`Get-ChildItem …`） | 照常放行 |
| `pwsh` 工具执行 `git tag <名字>` | **被拒：`the user rejected tool "pwsh"`**，tag 没有创建（`.git/refs/tags` 里无该名字） |

这四条证明：**插件确实被 DSH 加载、`tools/pre-execute` 监听确实被调用、deny 与 ask 的返回值被 DSH 采纳**。

**这次观察的局限（不要读多）：**

- **`git tag` 那一条看到的是「被拒」，不是「弹出审批」。** 该会话的审批策略是 `never`，按 `dsh-user-approval` 的语义，`never` 会在应答者运行之前确定性拒绝所有 `ask`。这足以证明本插件的职责：**返回 `{kind:'ask'}`，并被 DSH 采纳**。此后「弹窗 → 人批准 → 放行」是 DSH 自带审批链（`dsh-user-approval`）的功能，**不是本插件的代码，也不在本插件的验证范围内**——不重复验证 DSH 已有的功能（2026-10-05 Alan 明确指出）。
- 测了 `pwsh`、`write`、`edit` 三个工具名；`bash` 没测（本机是 Windows，没有这个工具）。
- 没测子 agent（subagent）里是否继承该守卫。
- 只测了本机一台、一个 profile、一次装法。

**装法里实际踩到的事实（读源码 + 实测）：**

- `pnpm add link:<路径>` 会把插件以符号链接装进 `node_modules`；Node 解析符号链接的**真实路径**，所以插件里 `require('@deepseek-ai/schemastery')` 从插件目录往上找，**找不到** profile 里的那份——`Config` 因此降级为 `undefined`（插件设计上允许降级，不会挡住启动；本机已装的另一个本地包 `dsh-user-preferences` 同样如此）。`enabled`／`root` 两个配置字段**是否仍被 DSH 传给 `apply`，没有验证**（本次装好后没有写任何 `config`，走的是默认值）。要写 `root`，先确认它真的传到了：在 `apply` 里临时打印 `config`。
- `pnpm add` 的输出里出现过 `Packages: -2`。逐项核对：`package.json` 只多了 `dsh-std` 一行依赖，`pnpm-lock.yaml` 只多了 `dsh-std` 的条目，**profile 声明的其余依赖在 `node_modules` 里都还在**，没有误伤。
- `package.json` 没有别的已装包带的 `manifestVersion`／`compatibility` 字段，**不影响加载**（上面的实测就是在没有它的情况下加载成功的）。

**仍未验证（记未定，不折算为通过）：**

- **与其它订阅 `tools/pre-execute` 的包（`dsh-workspace-changes`、`dsh-experimental-auto-review`、`dsh-tool-jobs`）的先后顺序与 `ask` 叠加效果**：本会话里这些包也在 profile 里，没有观察到冲突，但没有专门测。
- **`Config` 降级后 `enabled`／`root` 能否生效**。
- **`bash` 工具名；子 agent 是否继承；POSIX 上的行为。**
- 单测的三个路径用例按平台分支写（Windows 与 POSIX 各一组路径），只在 Windows 上跑过。

**回退（把守卫从 profile 里摘掉）：**

```text
# 备份在 %USERPROFILE%\.dsh\profiles\desktop-backup-before-dsh-std-<时间戳>\
# 方式一：从备份还原 package.json 与 pnpm-lock.yaml，再 pnpm install
# 方式二：手动 —— 删 package.json 里 dependencies 的 "dsh-std" 一行与 dsh.profile.bundles 里的 "dsh-std"，再 pnpm install
```

## 自检

```text
cd tools/dsh-std
node --test test/policy.test.js test/regress.test.js
```

对判定核心改动前后，各做一次「改坏它、单测应报红」的变异验证（见 D-135 验证格）。
