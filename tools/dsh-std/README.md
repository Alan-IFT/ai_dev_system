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

**经过三轮独立审查，这一节的设计已经改过两次。** 第一版用跨整串的正则，被实测出立方级 ReDoS 与大量 deny 误报；第二版按词法切子命令后逐段判，仍有「哪个词是写目标」的启发式两个方向都出错。现在的取舍是：**deny 只给两件不需要猜的事实，其余一律交给人（ask）**。

shell 命令先按未被引号包住的 `; && || | &` 与换行**切成子命令**（词首的 `#` 注释整段丢弃，反斜杠转义的引号不开引号，`>|` `>&` 里的 `|` `&` 不是分隔符），再逐段**切词**判。**不用跨整串的 `.*?` 正则**：实测旧写法在 8000 字符的 `git push ` 串上耗时 3.3 秒、2 万字符 13 秒；现在同样输入是毫秒级（数字会随机器变，要看就跑 `test/regress.test.js` 的性能用例）。命令超过 `MAX_CMD`（8192 字符）不分析，直接 ask——**代价**：长的 heredoc、长 `python -c`、长提交信息会一律被问一次，这是有意的取舍（宁可多问，不让超长命令成为绕过通道）。

- **deny 只有两个来源**：①`write`／`edit` 的路径参数落在 `.std/` 之下；②shell 命令里**引号外**的重定向目标词是 `.std/` 下的路径（`> x`、`>> x`、`word>x`、`2>x`、`>| x`、`>&x`）。判据都是不需要猜的字面事实。
- **ask**：①命令里出现 `.std` 且这一段有写动词（写类命令名、`git` 改工作区的子命令、`cd .std` 之后的写），写目标不猜，交给人判（实测证明启发式判目标会把读取判成 deny，deny 人批准不了）；②`git` 受控子命令（先跳过 `-C dir`／`-c k=v`／`--git-dir` 等带值全局选项再取子命令，按词判断）；③`--no-ve*`、`hooksPath` 在任何词里出现；④删除/移走/清空状态入口与失败清单；⑤写入口合同、入口指令、提交钩子、插件自身。
- **只读用法不问**：`sed` 无 `-i`、`tar -t`、`unzip -l/-p/-t`、`git reset`（默认 mixed）、`git restore --staged`、`git apply --check`、`2>&1`／`2>$null`／`>/dev/null` 这类不写文件的重定向。
- **前缀包装先剥再判**：`env X=1`、`sudo`、`command`、`timeout 5`、`xargs`、`VAR=val` 前缀。**把命令当字符串交给别的 shell 的包装取内嵌串再判一次**（`bash -c`、`sh -c`、`cmd /c`、`powershell -c`、`pwsh -Command`、`iex`、`Invoke-Expression`），最多往里看 2 层，再深一律 ask。
- 路径比较在 Windows 上忽略大小写、段尾点与空格、`\\?\` 前缀、NTFS 备用数据流后缀（`AGENTS.md::$DATA`）。

## 盲区（读源码与单测得出，不是实测得出）

下面这些**仍然是 allow（放行）**，都是审查者或我实测过的。它们的共同点是：要拦住就得做真正的 shell 解析，那超出一个预过滤的合理范围；兜底是提交前的 `check_all`（`adoption/embedded-modified`）与 git 钩子。

- **解释器子进程里的写**：`python -c "open('.std/x','w')"`、`node -e`、`[IO.File]::WriteAllText`。
- **脚本块与循环里的写**：`& { Set-Content .std/a x }`、`Get-ChildItem | % { Set-Content .std/a $_ }`、`foreach(...){ Set-Content .std/$f x }`——切词不进 `{ }`。
- **变量与路径展开**：`echo x > $PWD/.std/a`、`cp a ~/proj/.std/a`、`$env:PWD/.std/a`、变量拼接（`$d='.st'+'d'`）、通配符。
- **`find -exec`、`xargs` 之外的间接执行**（`find . -exec rm {} ;` 放行；`xargs` 已按前缀包装剥掉）。
- **保护文件的段尾点**：shell 里 `echo x > AGENTS.md.` 放行（写工具路径参数会规整段尾点，shell 命令串不会）。
- **写动词表是有限的**：重定向、PowerShell 全名与别名、cmd 内置、常见 POSIX 写命令、`git` 的几个改工作区子命令。表外（`mklink`、`attrib`、`icacls`、`chmod`、`perl -pi` 等）看不见。短名（`STD~1`）与符号链接不解析。
- **切子命令是词法，不是真的 shell 解析**：子 shell 的深层嵌套、here-string、复杂引号转义可能判偏。
- 只认工具名 `write`／`edit`／`pwsh`／`bash`。其它会写文件的工具（笔记本编辑、补丁应用等，名字未查证）不在判定内，**默认放行**。

**会多问的（不是漏，是取舍）**：`ask` 按词判断，分不出读写——`git tag` 只列标签也会问（列标签改用 `git show-ref --tags`）；`git branch -m/-M` 改名会问；`cp AGENTS.md AGENTS.bak` 只是读入口文件也会问（因为命令里有受保护位置与写命令）；`git push` 到整段是 `release` 或 `x:release` 的分支会问（`feature/release-notes` 不会）；`git push origin v1.0` 这类版本号式或日期式的单个 tag 会问。

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

**未验证（记未定，不折算为通过）：**

- **本插件被 DSH 真实调用时的瀑布合并语义**：本插件自己合并「下游决定」与「本插件判定」取最严，但 `tools/pre-execute` 作为 waterfall，DSH 是否还会再合并、顺序如何，没有实测。
- `package.json` 没有别的已装包都带的 `manifestVersion`／`compatibility` 字段；缺它是否影响加载未知。`peerDependencies` 里的版本范围也未对 DSH 内置包核实。

- 插件**没有在真实 DSH 会话里加载过**：单测用假 `ctx` 验证接线（条数跑 `node --test test/policy.test.js test/regress.test.js` 现取，不在此抄；做过变异验证），这证明判定逻辑与监听注册，不证明 DSH 真会调用它。第一次装上后要做一次真跑：让 agent 写 `.std/x.md`，应见 `Error: 内嵌标准目录 .std/ 只读…`；让它执行 `git tag x`，应弹出审批。
- 其它包（如 `dsh-workspace-changes`、`dsh-experimental-auto-review`）也订阅了 `tools/pre-execute`，**与本插件的先后顺序没有实测**。本插件先 `await next()` 再收紧，所以不会盖掉别人的 deny，但顺序对 `ask` 的叠加效果未测。
- 单测的三个路径用例按平台分支写（Windows 与 POSIX 各一组路径），只在 Windows 上跑过。

## 自检

```text
cd tools/dsh-std
node --test test/policy.test.js test/regress.test.js
```

对判定核心改动前后，各做一次「改坏它、单测应报红」的变异验证（见 D-135 验证格）。
