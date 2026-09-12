# tools/std · 标准机械检查

对着 [`标准/`](../../标准/README.md) 里**能机械判定**的那部分做检查，判不了的如实报"未定"。
三态定义、退出码规则、检查器接口在同目录 [CONTRACT.md](CONTRACT.md)；本文只讲怎么用，不复述它。

## 一条命令

在采用项目根执行：`python .std/tools/std/check_all.py .`

`.std/` 是标准（含本工具）内嵌进项目的目录，怎么取进来见下文「接入一个项目」。

退出码：`0` 本次执行的检查全过；`1` 有 FAIL；`2` 没有 FAIL 但有判不了的项。
**`2` 不是成功**——把 2 吞成成功，等于把"没检查"记成"检查通过"，而这正是本工具要拦的事。

## 前提

- python3，不装任何第三方包。
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
检查器**：写上去之后该检查器整项变成"不适用"，本来会报的 FAIL 一起消失，不是被修好了。
判"不适用"的判据是**对象不存在**；缺人、没数据、没测试是待确认，不是不适用
（见[如何裁剪并开始使用](../../标准/覆盖与采用检查.md#如何裁剪并开始使用)）。

输出形状（节间空行已略；计数随项目与提交变动，这里不写具体数）：

```
标准检查 · <项目绝对路径>
  通过 N   失败 N   未定 N   不适用 N
失败（N）
  · <一句话> [<路径:行>]
      依据：<标准条款>
      证据：<可复算的原始摘录>
未定（N）
  · <一句话>
      原因：<为什么判不了>
覆盖边界（没检查的不等于没问题）
  <检查器名>
    不看：<这次没覆盖到的范围>
结论：FAIL。
```

## 命令行开关

`check_all.py` 只有这些：

- `root`（位置参数，默认当前目录）：被扫描的项目根。
- `--selftest`：只跑检查器自检，不看项目。这是 CONTRACT.md §3 的**执行点**——改完任何检查器
  都要跑它，退出 0 才算改完。自检不过或没有自检的检查器，其对项目的结论被汇总器作废成未定。
- `--json`：输出 Finding 数组给上层工具消费，退出码规则不变。
- `--no-scope`：不打印覆盖边界。默认输出很长，只想先看结论时用；关掉打印不等于扩大了覆盖。
- `--config PATH`：改从别处读配置。扫只读或第三方项目时用：配置放在被扫项目之外，全程不往
  被扫项目写任何东西。该路径不存在或解析不了一律记未定，不回退去猜项目布局。

CI 里把退出码 2 当失败还是当告警，是项目要**显式做并写下来**的决定，不能让 shell 的默认行为
替你做——"非零一律失败"和"忽略非零"都会把"判不了"与"判过了"混成一件事。判据：这条流水线的
结论若会被人当作"检查过了"引用，2 就必须拦住它。

## 接入一个项目

**标准与工具按 tag 以 `git subtree` 内嵌进采用项目的 `.std/`。** 采用项目自己只写
`governance/` 那两个文件（`project.yaml`、`STANDARD_VERSION`），标准正文、模板和本工具由 subtree
带进来，clone 即用、离线可跑，不再按绝对路径去调一份仓外的工作副本。**这份副本不会静默失效：**
会静默失效的是无版本的手工拷贝——副本停在拷贝当天而配置里的版本号照旧，跑得动、报 PASS、结论
已不可信；而内嵌进来的这份就是按 tag 取的，`STANDARD_VERSION` 记的就是那个 tag，二者由取用命令
本身构造出来，不会各自漂。副本只能由一次显式的 `subtree pull` 移动，它同时移动代码和版本号
（[01 §8](../../标准/01-项目管理标准.md#adoption)：由项目显式评估并升级，不在任务中自动跟随）。
**未定优于假通过仍是这套工具存在的理由，它自己的部署方式不能选会假通过的那条：**内嵌的是哪一版
由 tag 与 `STANDARD_VERSION` 双写钉住，实际跑的是哪份代码由 CONTRACT.md §8 的身份哈希钉住；取不到、
对不上就该记未定，不得按"大概是那一版"往下判。
另外 01 §3.8 与[试点通过条件](../../标准/覆盖与采用检查.md#pilot-exit)第 3 条已把"两份 +
同步机制"判为待删对象：`.std/` 是只读内嵌，项目不得在里面改标准——改了就是第二处权威，处置是
把改动合并回标准仓再 `pull`，不是就地同步。

配置字段的语义见 CONTRACT.md §5，实例见交付面内的
[示例项目 `governance/project.yaml`](../../标准/示例项目-连锁零售中台/governance/project.yaml)——照实文件抄，本文不另立字段表；
`tier` 是必填的，不写就得到一条未定。工具来源由 `.std/` 的 subtree 提交与
`governance/STANDARD_VERSION` 承载，不在 yaml 里另记。

**取用、升级、发布三条命令线。** `<tag>` 就是写进 `governance/STANDARD_VERSION` 的那个值，日期
格式（如 `2026-09-12`），打在标准仓 `release` 分支的发布提交上；同一天第二次及以后的发布在日期后加 `.1`、`.2`（如 `2026-09-12.1`），日期本身不改。

- **取用**（采用项目里执行一次）：
  `git subtree add --prefix=.std https://github.com/Alan-IFT/ai-dev-std.git <tag> --squash`。
  之后入口里的路径写 `.std/标准/…`，检查命令写 `python .std/tools/std/check_all.py .`，
  `governance/STANDARD_VERSION` 记下这个 `<tag>`。
- **提示**：取用与升级只差一个词——`.std/` 不存在用 `add`，已存在用 `pull`，其余参数不变（
  `--prefix=.std <url> <tag> --squash`）；升级前后的越界检测、读差异、改
  `governance/STANDARD_VERSION` 是判断步骤，命令代替不了，不能靠这条 alias 跳过。可选一条本机
  alias（一次性设置，不进仓库）把两条命令合成一条：
  `git config --global alias.std '!f(){ u=https://github.com/Alan-IFT/ai-dev-std.git; if [ -d .std ]; then git subtree pull --prefix=.std $u "$1" --squash; else git subtree add --prefix=.std $u "$1" --squash; fi; }; f'`，
  之后 `git std <tag>` 一条命令兼取用与升级。`!` 开头的 alias 由 Git 自带的 sh 执行，PowerShell 下
  同样可用；alias 是本机配置、不随仓库走，这是有意的——标准不携带宿主配置，见标准仓
  `docs/09-跨工具通用性.md`。
- **升级**：先跑 `git log --oneline -- .std` 查越界——路径过滤下这条命令只会列出 merge 提交（squash
  提交的内容落在仓根、不在 `.std/` 下，路径过滤看不到它）；每次 add/pull 各贡献 1 条 merge 提交，
  条数 = 取用 1 次 + 升级次数，多出来的任何一条就是项目在 `.std/` 里改了标准，先把改动合并回标准仓
  或撤掉再 pull：同一行上游也改了 git 会报冲突，**上游没改的行 pull 会静默保留本地改动**，这种漂移
  只有 log 能看见。**工作区须干净**——`git subtree` 的 ensure_clean 对已跟踪文件的改动直接 die，
  有改动先 `git stash push`，pull 完再 `git stash pop`。确认干净后
  `git subtree pull --prefix=.std <remote> <新 tag> --squash`。换上游地址（如从私有仓换到公开仓）
  时，`<remote>` 直接换成新地址即可——`--squash` 合并的是本地这条 squash 提交链，不依赖上游历史、
  也不要求与本地已有 squash 共有祖先；2026-09-13 有采用项目从重新起根的公开仓拉取，实测无冲突。项
  目的 ref 空间里没有标准仓的 tag（squash 不带 tag 过来），读差异改用
  `git log --oneline --all --grep="Squashed '.std/'"` 列出 squash 提交（形如
  `Squashed '.std/' changes from <旧 sha>..<新 sha>`，消息里就是标准仓 `release` 分支的旧新提交；
  首次取用那条 squash 提交的消息形如 `Squashed '.std/' content from commit <sha>`，没有 `..`，之后
  每次升级的才是 `changes from <旧>..<新>`），`git diff <旧 squash sha> <新 squash sha>` 就是这次
  升级里 `.std/` 的差异；手头有标准仓检出时 `git diff <旧 tag> <新 tag>` 与此等价——`release` 分
  支是线性的，两者都是完整的升级差异。读完差异再改 `governance/STANDARD_VERSION`，**在 pull 之后改
  ，不要先改再 pull**：pull 认的是当前 `.std/` 的内容，先改版本号只会让文件和记录对不上。
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

## 加一个自己的检查器

照 CONTRACT.md §4 的接口写 `checks/check_<name>.py`，最短的现成样板是
`checks/check_entry_budget.py`。**必须带 `selftest()` 且里面要有反例**：造一个应该被判 FAIL
的最小样本，跑出来必须是 FAIL。没有自检或自检不过的检查器，汇总器把它对项目的全部结论作废
成未定。写完跑 `--selftest`。

## 已知误报形态

- **中文正文里的数值高召回。** 同一个"数字+量词+名词"出现在多个文件就报未定。设计如此
  （同形数字也可能各说各的，机械判不了），不是 bug。
- **中文锚点判不了。** 各平台给中文标题生成锚点的规则不一致，工具拒绝猜：中文锚点没匹配上
  记未定，ASCII 锚点才判 FAIL。
- **重复文本的阈值对源码偏松。** 旋钮是 `budgets.duplicate_min_lines` 与
  `budgets.duplicate_min_chars`。**调阈值不是关检查**：证据里会写明用的是项目值还是默认值。
- 重复文本与重复数值这两条判据，只在**一组重复的全部出现位置都落在非文档文件**时才丢弃；丢弃
  的组不静默消失，汇总成一条未定，指向 02 §4 按技术债处置。只要有一处落在文档里，照常报。

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
没有全绿**：仍有 FAIL 与未定没处置（`layout.artifacts` 的 `acceptance` 故意空着——这个仓确实
没有验收条目工件，留着让它报出来）。作者自己的仓库不全绿，比全绿的样例更能说明三态怎么用。
