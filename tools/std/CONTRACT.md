# 检查器契约

本文规定 `tools/std/` 下每个检查器必须满足的接口与行为。**它是并行实现的前提**：满足本契约的检查器可以各自独立编写、独立测试，由 `check_all` 汇总。

标准正文见 [`标准/`](../../标准/README.md)（修订号见 `标准/README.md` 第 3 行）。检查器只做**机械可判定**的部分；判不了的一律输出 `UNDETERMINED`，不猜、不降级为通过。

---

## 1. 三态，且未定不可静默升格

每条检查结果只有三种：

| 状态 | 含义 | 退出码贡献 |
|---|---|---|
| `PASS` | 检查实际执行了，且未发现违规 | 0 |
| `FAIL` | 检查实际执行了，发现违规 | 1 |
| `UNDETERMINED` | 未能判定：适用却对象缺失、配置缺失、依赖不可用（判据本身不适用记 `SKIP`，见下方规则） | 2（未登记）／0（已登记且未过期） |

**这是本工具与普通 linter 的根本区别。** 依据是 [01 §2 N1](../../标准/01-项目管理标准.md) 与 [§5.6](../../标准/01-项目管理标准.md#gates)：适用却没配置或未执行的门记未定，不记通过。

规则：

- **`UNDETERMINED` 永远不能被合并成 `PASS`。** 汇总时三态各自计数，不允许"没有 FAIL 即通过"。退出码另按已登记／未登记分档（见第 9 节「例外登记」）；状态字段、三态计数与逐条列出**不因登记而改变**——登记改变的只有退出码。
- 对象不存在时，先判**是否适用**：不适用记 `SKIP`（不计入三态，但必须给理由）；适用而对象缺失记 `UNDETERMINED`。
- **同一事实只由一个检查器报。** 对象缺失这件事归哪条标准条款，就由执行那条的检查器报；以同一对象为输入的其余检查器记 `SKIP`，证据里写明由谁报。否则采用方得为同一件事登记几行，报告的未定数也虚高。现有一例：工作项目录（`layout.work_root`）不在，由 `layout` 按 01 §3.1 报（L1 起的 `work_current` 一项），`evidence`、`freshness` 与 `drift`（判据 4）各记一条 `<检查器>/work-root-absent` 的 `SKIP`；两件共用的解析与这条 `SKIP` 都在 `stdlib`（`work_root` / `work_root_absent`）。另一例是入口文件不在：由 `layout` 按 01 §3.1 的 ★ 入口报，`entry-budget` 记 `entry-budget/entry-absent` 的 `SKIP`。
- 检查器自身崩溃、超时、依赖缺失，一律 `UNDETERMINED`，**不得吞掉异常记 PASS**。依据：该项目已发生过"守卫崩溃却报告为漂移"与"退出 0 却跑了 0 个测试"。

`check_all` 的退出码：有任一 `FAIL` → 1；无 FAIL 但有**未登记**的 `UNDETERMINED` → 2；否则 0（全 PASS/SKIP，或全部未定都已登记且未过期）。**调用方不得把 2 当成功。**

### 1.1 判据落空只能记未定，不许升格为 FAIL、也不许新增配置键去救

**判据靠猜测得出的结论只能是 `PASS` 或 `UNDETERMINED`，永不产出 `FAIL`。**

这里的"猜测"指判据的召回依据不是项目自己声明的事实，而是工具单方面的一份约定：**目录名、文件后缀、字段名、标记词，以及从模板快照抄来的候选路径**。约定命中了可以记 `PASS`——东西确实在那儿，这是看见的事实；约定落空只说明"工具没在它猜的地方找到"，推不出"这个项目没有"，所以记 `UNDETERMINED`。要把某项判成 `FAIL`，先让项目在 `project.yaml` 里声明落点：**声明之后仍然不成立，那才是确定的违规。**

两次实测教训，都是用不确定的前提产出了确定的结论：`check_layout` 按模板候选路径没找到 ★ 工件就判缺失，而外部项目只是把它放在别的名字下；`check_layout` 的状态字段曾是英文单值 `status`，本仓 `PROJECT_STATUS.md` 头部写的是「状态：进行中」，被报成"缺状态字段"。前者已改判未定，后者的词表已并进 `stdlib.STATUS_FIELDS`。

**判据落空的处置是记未定，不是在 §5 里新增一个配置键。** 判据自身的召回位置（阈值、词表、候选清单）不是项目参数，把它做成键，等于让每个采用方替工具修判据；键会一直加下去，而报告并不因此更可信。项目要表达的只有一件事——"这东西在我这儿叫什么、放在哪"，那属于 `layout.artifacts` 一类的**落点声明**，与救判据是两回事。

---

## 2. 每个检查器必须声明覆盖边界

输出里必须带 `scope`，写明**检查了什么、没检查什么**。依据 [01 §5.6](../../标准/01-项目管理标准.md#gates)（控制的覆盖范围本身是状态）与 [04 §6.1](../../标准/04-可靠性安全与运行维护.md#agent-run-observability)（未采到的区间记未知）。

**工具自身所在的内嵌目录（采用项目里的 `.std/`）不在扫描面**：那是上游的内容，不是本项目的；报告首部打出被排除的路径。在标准仓自己身上跑时无此排除。它的内容不扫，但**它有没有被改**要判（[01 §8](../../标准/01-项目管理标准.md#adoption)：内嵌的 `.std/` 只读，项目不在里面改）：内嵌运行时 `check_adoption` 跑 `git status --porcelain --untracked-files=no -- <内嵌目录>`，有已跟踪文件的改动（已暂存或未暂存，覆盖 `git commit -a`）判 `FAIL`（`adoption/embedded-modified`），git 查不了记 `UNDETERMINED`，内嵌目录没被本仓跟踪（被忽略或是嵌套的独立 clone，`git status` 恒空）记 `UNDETERMINED`（`adoption/embedded-untracked`），非内嵌运行记 `SKIP`。`--selftest` 在汇总层另有一条断言：内嵌仓有改动时必须出现 `adoption/embedded-modified` 的 `FAIL`，检查器被换回不含这条判据的版本也能被发现。这条规则放在检查器里，任何把 `check_all` 放进提交路径的执行层（git 钩子、CI、宿主工具的提交前钩子）都同样拦得住。

未覆盖的部分不是"没问题"，是"没看"。例如只扫 `*.md` 的检查器必须写明它不看 `*.service`、`*.sh`、`*.json`——该项目真实吃过这个亏：现有闸门只扫 `scripts/*.sh`，因而看不见两个应用仓里 28 处已断的跨仓引用。

---

## 3. 每个检查器必须自带反例（静默失效探测）

**没有反例测试的检查器，其结果记 `UNDETERMINED`，不记 `PASS`。**

依据 [01 §5.6](../../标准/01-项目管理标准.md#gates) 的四步验收与 [M-10](../../标准/参考资料/M-10-守卫的执行点.md)：守卫存在不等于守卫在执行。每个检查器提供 `selftest()`：

1. 造一个**应该被判 FAIL** 的最小样本，跑检查器，必须得到 FAIL；
2. 造一个**应该被判 PASS** 的最小样本，必须得到 PASS。

任一条不成立即判该检查器故障，其对目标仓库的结论作废、记 `UNDETERMINED`。`check_all --selftest` 单独跑这一层。`--selftest` 另跑一组跨检查器反例（`shared-fact`：§1「同一事实只报一次」与共用候选），单个检查器的自检看不见别的检查器，这一层只能在汇总处断言。

---

## 4. 接口

每个检查器是 `tools/std/checks/check_<name>.py`，导出：

```python
NAME: str            # 稳定短名，如 "single-authority"
STANDARD_REFS: list  # 它执行标准的哪几条，如 ["01 §1 G2", "01 §2 N2"]

def scope(cfg) -> dict:
    """返回 {"covered": [...], "not_covered": [...]}，字符串描述，人读。"""

def run(cfg) -> list[dict]:
    """返回若干 Finding。不抛异常——内部异常转成 UNDETERMINED 的 Finding。"""

def selftest() -> list[dict]:
    """见第 3 节。返回两条 Finding：反例与正例各一。"""
```

`cfg` 除了第 5 节那些项目参数，还有若干下划线开头的键。其中两个由 `stdlib.load_config` 无条件注入，**是本契约的一部分**（此前只有实现知道，检查器全靠它定位被扫描项目，写下来是为了新检查器不必去读 `stdlib` 才知道该用什么）：

| 键 | 含义 | 检查器该怎么用 |
|---|---|---|
| `cfg["_root"]` | **被扫描项目的根**，`check_all` 的位置参数原样传入，可能是相对路径 | 检查器定位工件一律用它拼路径（`os.path.join(cfg["_root"], rel)`），**不得**用 `os.getcwd()` 或检查器自己的 `__file__` |
| `cfg["_path"]` | 配置文件的实际路径 | 只用于报告与证据。**它落在 `_root` 之内还是之外**，决定了输出里标"外部配置，不在被扫描项目内"还是"在被扫描项目内"。判据是路径包含关系，不是"绝对还是相对"——`--config` 完全可以指向项目内部的绝对路径，那时标"外部配置"是一句**假的溯源陈述** |

`_path` 在不在项目内由 `check_all.config_outside_root(root, path)` 判，返回 `True`（在外）/ `False`（在内）/ `None`（判不了）。实现是 `abspath(...)` 加带分隔符的前缀比较——带分隔符是因为 `/t/proj` 不该把 `/t/project/x.yaml` 吞成内部；非绝对的 `path` 先接到 `root` 上再归一化，是因为走默认候选路径时 `_path` 本就是相对被扫根的（`governance/project.yaml`），照当前工作目录解析会把项目内的默认配置判成外部。带分隔符前缀比较在入口冒烟 3d) 有断言，相对路径接到 `root` 上在 3e) 有断言。调用点在全部检查跑完之后，归一化出错也不许崩，按判不了返回 `None`。

这两个键的名字带下划线是为了与项目自己写的配置项区分：**项目的 `project.yaml` 里写 `_root` 或 `_path` 无效**——`load_config` 解析完会原地覆盖它们。

除这两个之外，检查器**自己**也可以约定下划线开头的注入口，只在自检里往 `cfg` 里塞、`load_config` 不产生也不覆盖。目前有一个：`check_links` 的 `_links_files`（由 `check_links.selftest` 注入，取代 `git ls-files` 的结果，让自检不碰真实仓库的 git 索引，见第 3 节）。另有一个由 `check_all` 在**全部检查跑完之后**写入的 `_exceptions`（登记册路径、有效行数与过期行数，只给 `render` 打报告首部那一行用，见 §9）——检查器跑的时候它还不存在，不要读它。**这类键不是项目配置项，项目不要写**——`load_config` 不会覆盖它，写了会被检查器当真采信，等于让被检查方自己指定检查范围。新增这类注入口要在本节登记，因为"`cfg` 里都有什么"是契约面，不是实现细节。

`Finding` 的字段：

```python
{
  "check": NAME,
  "id": "check/kind[/key]" 或 "check/<sha1(title)[:8]>",   # 由 stdlib.finding 算，检查器不自己拼
  "status": "PASS" | "FAIL" | "UNDETERMINED" | "SKIP",
  "title": "一句话说清是什么",         # FAIL 时必须能定位
  "where": "path:line" 或 None,        # 可定位工件，FAIL 时尽量给
  "why": "为什么这算问题" ,             # 绑到 STANDARD_REFS 的哪一条
  "reason": "未定/跳过的原因",          # UNDETERMINED 与 SKIP 必填
  "evidence": "原始证据，命令或摘录",   # 可复算
  "registered": None 或 {"id": "EX-007", "expires": "2026-12-31"},   # 由 check_all 贴，见 §9
}
```

**`why` 必须能追到标准的具体条款。** 追不到的检查项不进本工具——那说明它是实现者的偏好，不是标准的要求。

**`id` 是这条发现的地址**，例外登记（§9）的「规则」列写的就是它，所以它的稳定性是契约面，不是实现细节。`stdlib.finding(..., kind=, key=)` 按两档算：

| 档 | 构成 | 稳定性承诺 |
|---|---|---|
| 给了 `kind` | `check/kind`，再给 `key` 则接 `/` 与归一化后的 key（首尾空白去掉、内部空白折成 `_`、竖线换成 `｜`） | **判据不变它就不变**：标题怎么改、命中几个文件、超期几天，都不影响它。跨工具版本升级时仍须按 §8 的身份重跑核对 |
| 没给 `kind` | `check/` + `sha1(title)[:8]` | **只在同一工具身份内稳定**：标题改一个字就换一个 id，对应的登记行随之失效。这是兜底，不是承诺 |

给 `kind` 的构造点覆盖标题会随命中内容变动的那些判据（`freshness` 的陈旧、`cross-repo` 的六条、`single-authority` 的溢出／非文档组／数值声明、`links` 的三条未定、`derived` 的四条；另有 `evidence`／`freshness`／`drift` 的 `work-root-absent` 与 `entry-budget` 的 `entry-absent`、`candidate-over`，标题带路径或行数），**`key` 一律取判据自己的稳定量**（路径、仓名、`数字:量词:名词键` 三元组），不取计数与样本文本。其余构造点用兜底 id。写新检查器时：**标题里会出现数字或摘录的，就必须给 `kind`（能定位到具体对象的再给 `key`）**。

---

## 5. 配置

项目根的 `governance/project.yaml`，检查器只从这里取项目相关参数，**不硬编码路径**。登记与版本各有一处，都不在本文件里：例外登记在 `governance/exceptions.md`（§9），采用的标准修订在 `governance/STANDARD_VERSION`（`check_adoption` 读）。

```yaml
tier: L1                            # 必填：L0 | L1 | L2 | L3，决定该有哪些工件
tailoring:                          # 裁剪：不适用的部分与理由
  - check: cross-repo
    applicable: false
    reason: 单仓项目
layout:
  entry:                            # 入口文件，受行数预算约束
    - CLAUDE.md
    - AGENTS.md
  docs_root: docs
  work_root: docs/state/work        # 工作项目录
  artifacts:                        # 本项目给分档工件起的实际路径，键是工件 role
    status: PROJECT_STATUS.md
  frozen:                           # 只读归档区，不参与新鲜度与更新义务
    - docs/features
  rule_files:                       # 退役仓里"会被当成现行规则读入"的位置
    - .claude/
    - AGENTS.md
budgets:                             # 参数，项目可改；默认见 01 §3.7
  entry_lines: 150
  stale_days: 90                     # 文档多久不动算陈旧
  work_item_stale_days: 14           # 进行中的工作项多久不动算失活
  duplicate_min_lines: 3             # 重复文本判据的下限
  duplicate_min_chars: 60
metadata_fields:                     # 01 §3.5 的日期字段名
  - updated_at
metadata_required:                   # 哪些路径前缀下的文档必须带元信息
  - docs/decisions
work_item_done_states:               # 工作项的完成态词
  - done
  - 完成
work_item_in_progress_states:        # 工作项的进行中态词
  - in_progress
  - 进行中
derived:                             # 派生工件：改源不改产物，见 01 §3.4
  - artifact: docs/map.html
    source: docs/map.json
    regen: make map
repos:                               # 多仓系统，见 01 §3.8；单仓省略
  - name: control-plane
    path: .
    role: system                     # system | app | retired | archived
    former_names:                    # 可选：这个仓改名前叫过什么
      - control-plane-ops
```

**采用的标准修订不在本文件。** 它由 `governance/STANDARD_VERSION` 承载（[01 §3.1](../../标准/01-项目管理标准.md) 的文档树与 [§8](../../标准/01-项目管理标准.md#adoption) 都定在那儿），由 `check_adoption` 读出并把值原样写进报告证据。此处从前有过一个 `standard_version` 键，与标准正文并列成两处权威而**没有任何检查器读它**，已删除；采用项目 `project.yaml` 里若还留着这一行，属可选清理，删不删都不产生后果。`check_adoption` **不拿读到的值与工具侧任何常量比对**——那个值是标准仓 `release` 分支上的 tag 名，核实它要联网或读被扫项目之外的 git 元数据，本工具两样都不做；拿工具自己的常量当真相比，结论就是编。唯一的比对发生在**内嵌运行**时（本工具就在被扫项目的 `.std/` 里）：把读到的值与 `.std/标准/README.md` 里「候选实现修订：`…`」的值比，不一致判 `FAIL`（`adoption/version-mismatch`）——两边都是被扫项目里的文件，比的是记录与实物，不是工具常量；非内嵌运行不产出这一条。

**只用块状列表（短横线），不要用 `[a, b]` 这种流式写法**——解析器按"歧义即拒绝"拒收它，本文此前的示例写成流式，照抄会让整份配置解析失败，已改正。唯一接受的流式写法是空列表 `[]`：它没有歧义，且 `metadata_required` 要靠它区分"声明一类都没有"与"没声明"。

上面每个键的类型、是否必填、以及缺了会怎样：

| 键 | 类型 | 必填 | 缺省行为 |
|---|---|---|---|
| `tier` | 字符串 `L0`/`L1`/`L2`/`L3` | **是** | `check_layout` 整条记 `UNDETERMINED`——不猜该项目该有哪些工件。取值不在四档内同样记未定，不归到最近的一档 |
| `tailoring` | 列表，每项 `check` / `applicable` / `reason` | 否 | 视为没裁剪任何检查。`check` 可写检查器短名，也可写 `layout:<role>` 或裸 `<role>` 单裁一个工件 |
| `layout.entry` | 字符串列表 | 否 | `layout` 与 `entry-budget` 共用 `stdlib.entry_files`：先回退到 `layout.artifacts.entry`（同是项目声明，据此照常判 `FAIL`）；两者都没配才按候选 `CONTEXT.md`、`AGENTS.md`、`CLAUDE.md` 的顺序取第一个存在的（同时存在几个也只取第一个，证据列出其余），证据注明来自候选。候选是 §1.1 的工具约定：`layout` 命中记 `PASS`、全不在记一条 ★ 未定，`entry-budget` 在预算内记 `PASS`、超预算记未定（`candidate-over`），声明之后仍超才判 `FAIL`；入口不在由 `layout` 报，`entry-budget` 记 `SKIP`（§1）。`cross-repo` 的入口相关判据仍记 `UNDETERMINED`：它要在每个仓里认同一组入口名，且那几条判据的结论以 `FAIL` 为主，候选来源下只剩通过与未定 |
| `layout.docs_root` | 字符串 | 否 | 取常量 `docs`（01 §3.1 文档树的根），`freshness`／`drift` 在 `evidence` 里注明用的是默认，`layout` 在覆盖边界里注明（它只拿它给候选路径改基，候选本就是提示，§1.1）。解析只在 `stdlib.docs_root_of` 一处，`layout`／`freshness`／`drift` 与各缺省路径的改基共用 |
| `layout.work_root` | 字符串 | 否 | 取常量 `docs/state/work`（01 §3.1；`docs/` 随 `layout.docs_root` 改基，与 `check_layout` 的候选同一规则），并在 `evidence` 里注明用的是默认。它也是 `check_layout` 的 `work_current`（实时状态源）一项在未声明 `layout.artifacts.work_current` 时认的落点——目录不在由 `layout` 报一次，`evidence`／`freshness`／`drift` 记 `SKIP`（§1）。解析只在 `stdlib.work_root` 一处 |
| `layout.artifacts` | 映射，`<role>: 路径` | 否 | 按分档快照里的候选路径找；给了就只认它，不再猜候选。`status` 的候选（`WORK.md`、`docs/state/STATUS.md`，取自模板 L0 树与 01 §3.1）在 `stdlib.STATUS_CANDIDATES`，`check_layout` 与 `check_drift` 共用。**★ 工件（入口/验收/状态）没声明落点时，候选未命中记 `UNDETERMINED` 而不是 `FAIL`**（§1.1）；声明了却不存在才是 `FAIL`。role 名见 `check_layout` 的 `_TIER_ITEMS`（`entry`/`acceptance`/`status`/`playbook`/`failures`/…） |
| `layout.frozen` | 路径前缀列表 | 否 | 视为没有只读归档区，全仓都承担更新义务 |
| `layout.rule_files` | 路径/前缀列表，以 `/` 结尾按目录递归 | 否 | 取常量 `.harness/rules/`、`.claude/`、`AGENTS.md`、`CLAUDE.md`，并在 `evidence` 里注明用的是缺省清单。只有 `cross-repo` 判退役仓时用它 |
| `budgets.entry_lines` | 正整数 | 否 | 取 01 §3.7 默认 150 并注明未校准；不是正整数记 `UNDETERMINED` |
| `budgets.stale_days` | 正整数 | 否 | 取常量 90 并注明未校准；不是正整数记 `UNDETERMINED` |
| `budgets.work_item_stale_days` | 正整数 | 否 | 取常量 14 并注明未校准；不是正整数记 `UNDETERMINED` |
| `budgets.duplicate_min_lines` | 整数 ≥2 | 否 | 取常量 3 并注明未校准 |
| `budgets.duplicate_min_chars` | 整数 ≥1 | 否 | 取常量 60 并注明未校准 |
| `metadata_fields` | 字符串列表（也接受单个字符串） | 否 | 取常量 `updated_at` 并注明未校准；写成别的形状（映射、空列表）同样按未配处理。解析只在 `stdlib.date_fields_of` 一处，`layout` 与 `freshness` 共用 |
| `metadata_required` | 路径前缀列表 | 否 | 见下方专段。给了就**只认这份清单**；显式写空列表 `[]` 即声明项目没有 01 §3.5 那六类文档，无日期文档整轮记一条 `SKIP`；键缺失或值为空才按目录名约定判，约定也没命中的**记未定，不记不适用** |
| `work_item_done_states` | 字符串列表（大小写不敏感） | 否 | 取常量 `done`/`完成`/`delivered` 并注明未校准 |
| `work_item_in_progress_states` | 字符串列表 | 否 | 取常量 `in_progress`/`进行中` 并注明未校准 |
| `derived` | 列表，每项 `artifact` / `source` / `regen` | 否 | `check_derived` 整条记 `SKIP`——不猜哪些文件是生成的 |
| `repos` | 列表，每项 `name` / `path` / `role`；**`path` 只有 `role: archived` 可省略**（01 §3.8 的 archived 就是"已移出工作区，只在远端"）| 否 | `cross-repo` 记 `SKIP`：未声明或不足两个条目记不适用（单仓项目，01 §3.8）。`role` 取 `system`/`app`/`retired`/`archived`。`archived` 省略 `path` 或 `path` 在本机不存在时，"各仓可定位"一条按定义记 `PASS`，凡需读该仓本地文件的各条（入口、退役仓失效标记、跨仓引用）对它记 `SKIP`；给了 `path` 且目录在则照读照判。`retired` 不享受这条——它仍要求本地有检出可核 |
| `repos[].former_names` | 字符串列表 | 否 | **不声明就一字不查**——不猜哪个名字是旧名（判据八）。别名与任何在册 `name` 相撞时该项记 `UNDETERMINED` 且不扫描：那种情况下命中的多半是在役引用 |

**缺配置项时记 `UNDETERMINED` 并写明缺哪一项，不取默认值当事实。** 例外见上表"缺省行为"一列：`budgets` 的全部键，以及 `layout.docs_root`、`layout.work_root`、`layout.rule_files`、`metadata_fields`、两个 `work_item_*_states`，缺失时取常量兜底而不是记未定；`repos` 与 `derived` 是另一类例外——缺失时整条记 `SKIP`（不适用），既不取默认也不记未定：单仓项目按 01 §3.8「单仓项目记不适用」，未声明派生关系时主从由项目指定、不由检查器推定（01 §3.4）；**取了默认就必须在 `evidence` 里写明"用的是默认值，项目未校准"**，让读报告的人知道这个结论建立在工具的假设上。**被多个检查器读的键，常量缺省只在 `stdlib` 写一处**（01 §1 G2）：同一个键不得被一个检查器取常量兜底、另一个记未定。`check_layout` 按分档快照找候选路径、`stdlib.entry_files` 在 `layout.entry` 未配时找入口候选名，都不算缺省——候选是 §1.1 所说的工具约定（提示），命中只许记通过或未定、未命中只记未定，不当作该键的取值。除这些之外的键缺失一律记 `UNDETERMINED`。

### 01 §3.7 给了六项篇幅预算，本工具只执行其中一项

按 §2「未覆盖的部分不是没问题，是没看」，这里把边界写死：

| 01 §3.7 的预算项 | 默认值 | 本工具 |
|---|---|---|
| `AGENTS.md`（入口） | 150 行 | **执行**：`check_entry_budget` 读 `budgets.entry_lines`，对象是 `layout.entry` 列出的文件，未配时是候选里第一个存在的那个（§5） |
| `INDEX.md` | 每份文档一行 | **无检查器** |
| `STATUS.md` | 80 行 | **无检查器** |
| 工作项 | 150 行 | **无检查器** |
| 交接 | 60 行 | **无检查器** |
| 模块文档 | 200 行 | **无检查器** |

后五项**没有任何检查器执行**，报告里既不会 PASS 也不会 FAIL，连一条未定都不会出现——它们根本没被看过。按 [01 §1 G5](../../标准/01-项目管理标准.md)（高价值规则要有检查方式），它们在本工具的覆盖范围内**目前等于没有**。采用项目要么自建检查器把它们接上，要么在 `tailoring` 里登记不适用，别把"报告没报"当成"没超预算"。

**这五项不对应任何配置键，也不要为它们加键。** 加一个没有读者的键，等于在配置里写一句不会被执行的承诺——`budgets.status_lines` 与 `budgets.work_item_lines` 这两个键正是因为这个原因被删掉的。缺的是检查器，不是键；键要跟着检查器一起来（§1.1）。

### `metadata_required` 的两件事，都容易踩

**一、它是整体替换，不是追加。** 一旦写了它，目录名约定就**整份失效**。项目只写 `docs/ops`（因为注意到 runbook 在那儿），`docs/architecture`、`docs/decisions` 会**同时失去**元信息要求，而报告只会安静地把它们记成"不要求元信息"。要保留原有约定就得把它们一并写进清单。

**二、不配它的后果，是"未定"而不是"不适用"。** `freshness` 判一份文档属不属于 01 §3.5 的六类（验收、架构、模块、契约、ADR、runbook），靠的是路径里有没有出现那几个目录名。这是**约定，不是判定**，两头都会错：RCMS 的 runbook 放在 `docs/ops/`，9 份全部落空；本仓是中文文档树（`docs/架构图`、`docs/审计记录`），35 份 100% 落空。反过来，叫 `architecture` 的目录里也可能放着别的东西。

所以未配 `metadata_required` 且目录名约定未命中时，那些缺日期字段的文档**不逐份记 `SKIP`**——`SKIP`（不适用）是确定结论，而"这份文档算不算重要文档"要看内容，按 §7 机械判不了。它们汇总成**整轮一条 `UNDETERMINED`**，证据里列出路径。代价是这类项目的退出码从 0/1 变 2；收益是"这里没看"从报告末尾的不适用堆里挪到了未定区。配了 `metadata_required` 之后，命中记 `FAIL`、未命中记 `SKIP`，两边都是确定结论。写成空列表 `[]` 是"一类都不要求"的声明，无日期文档整轮汇成一条 `SKIP`——**它与不写这个键不是一回事**：空列表是项目的声明，可给确定结论；键缺失或值为空是没声明，只能记未定。声明错了由写下它的人负责，工具不复核。

配置也可由 `check_all --config PATH` 从被扫描项目之外给出，此时 `_root` 仍是被扫描项目、`_path` 记配置的实际路径；这是扫描只读/第三方项目而不往其中写入任何文件的唯一受支持方式；外部配置缺失或解析失败一律记 `UNDETERMINED`，不回退到 `<root>/governance/`。

---

## 6. 输出

默认人读的文本：先给**检查器身份行**（见 §8），再给三态计数，再按 `FAIL` → `UNDETERMINED` → `SKIP` 排，`PASS` 只给计数不逐条列。`--json` 输出机器可读的 Finding 数组，供上层工具消费。

身份块在 `--json` 里是数组中一条 `check: "tool-identity"` 的 Finding，状态 `SKIP`（它是记录不是判定，不计三态、不影响退出码），逐文件哈希放在 `evidence` 里。这样 `--json` 仍然是一个 Finding 数组，不必为它改顶层形状。

**不输出分数、不输出百分比、不输出"健康度"。** 依据 [01 §4.8](../../标准/01-项目管理标准.md#delivery-metrics)：合成指标会把未定折算成部分通过。

---

## 7. 检查器只做机械判定

能机械判定的才写成检查器。**判不了的交给人：走查条目集中在 [`templates/agent-skills/code-review.md`](../../templates/agent-skills/code-review.md)**（如：记录所述事件是否真在那个日期发生、同一份文档里两处口径是否一致这一类），不要做成"用模型判一下"的检查器——那会让检查结果本身不可重复（见 [04 §6.2](../../标准/04-可靠性安全与运行维护.md#agent-run-observability)）。

具体地：文件是否存在、链接是否可达、行数是否超预算、同一字符串是否出现在两处、时间戳是否超期、字段是否齐全——可以。某段文字写得好不好、某条规则该不该存在、某个设计是否合理——不可以。

---

## 8. 报告必须钉住检查器自己的版本身份

来自一次实跑：扫描一个外部项目的过程中，本工具被另一条线并行改写；旧版对同一项目给 30 条 `FAIL`，新版给 9 条。两份报告都自称是"对该项目的结论"，而**没有任何字段能分辨它们是哪一套跑出来的**。结论：符合性报告不钉检查器版本身份就**不可复算**。

**身份是内容哈希，不是提交号。** 提交号覆盖不了工作区未提交的改动——上面那次正是未提交态；决定行为的是文件内容，不是提交指针。

- 进哈希的文件：`checks/check_*.py` 逐个 + `stdlib.py` + `check_all.py` + **`CONTRACT.md`**。契约进身份是因为 `_contract_examples_selftest` 会读它、它进自检闸门，改了它就可能改变放行与否。
- 各文件 sha256 **对行尾归一化后的字节算**（`\r\n`、`\r` 一律作 `\n`，其余字节不动），外加一个合并摘要（把 `路径 哈希` 逐行拼起来再 sha256）。为什么归一化：上列文件是 Python 源码与按文本读入的契约，行尾不改变它们的任何行为，进哈希只会把同一套工具算成两枚身份——已发生：2026-09-11，`7e0522f` 的 `tools/std` 一字未改，LF 检出与 CRLF 检出得两枚身份，两次 `git status --porcelain` 都为空，dirty 标记对这种漂零信号。仓库根的 `.gitattributes` 把检出钉在 LF 是给 git 的，不是给身份的：它不在上列文件里、不随 `git archive` 或摘目录分发走，身份不得依赖它。
- `git rev-parse HEAD` 与 `git status --porcelain` 只作**旁证与 dirty 标记**，不作身份。
- **脏工作区允许扫**，但报告必须显式标 `dirty` 并附逐文件哈希。
- **扫描前后各取一次**，摘要与文件集合都必须一致（新增一个 `check_*.py` 也算变）。不一致则本次结论**作废**——不是加一句"存疑"，是把已有结论整份丢掉，只留一条 `UNDETERMINED` 说明作废原因，等检查器稳定后重跑。

**这一节约束的是工具，不是人的自觉。** 一条只有人能遵守的报告纪律放进契约，既越出"每个检查器必须满足的接口与行为"这个范围，又必然被忘——那正是 [M-10](../../标准/参考资料/M-10-守卫的执行点.md) 说的"守卫存在不等于守卫在执行"。所以：`check_all` 自己在文本输出头部与 `--json` 里产出身份块，`_entry_smoke_selftest` 有对应断言（文本含身份行、`--json` 含 `tool_identity_digest`）。

`--json` 里那条 Finding 的 `evidence` 长这样，它同时是本工具 yaml 子集能解析的形状：

```yaml
tool_identity_digest: f24d0d3ec39ff5551c006cdc55574a7dc8d6cd1a0fee4d644a55895f6f032ba8
tool_identity_git_head: a3b66cca003121ee1fe4aea034b069b216277461
tool_identity_dirty: True
tool_identity_files:
  - check_all.py 0a59ea87bc6b56431fddf7ad3fbd07a75b14312c51f1001322b6cf6752301d69
  - CONTRACT.md 2b19a50dbb67d7569b0c69f23073f507b4382e34ed9887d666375ab0437ac319
```

---

## 9. 例外登记：未定项逐条登记，登记只改退出码

未定项不是待办堆。项目可以对**某一条**未定写下"我看过了，接受到什么时候、谁批的"——这一条登记之后，它仍然是 `UNDETERMINED`、仍然逐条列在报告里、仍然计入未定计数，**变的只有退出码**：全部未定都已登记且未过期时退出 0，只要还有一条没登记就退出 2。依据 [02 §10.1](../../标准/02-项目架构描述规范.md)：验收必需的检查失败或未定时，「修复、补证或经项目授权登记带范围/到期的例外后再判」，且「到期未清理按例外规则 CI 转红」；以及 [01 §5.6](../../标准/01-项目管理标准.md#gates)：登记不重写结论。

**文件位置：配置文件同目录的 `exceptions.md`**（纯文本路径，不是链接：`governance/` 由采用项目自己写，本工具不往交付面里链它）。不带 `--config` 时就是 `<项目根>/governance/exceptions.md`；`--config PATH` 时读 `PATH` 旁边那一份。取不到即**全部未登记**，不回退去别处找。报告首部在「配置 ·」行之后打一行「登记 · <路径>（N 行有效）」或「登记 · 无」；有已过期的行时该行写作「登记 · <路径>（N 行有效，其中 M 行已过期）」，N 仍按本节「一行有效」的定义计，M 只是提醒，不改变 N。

**表头按「包含」匹配第一张 markdown 表**，先命中者为准：`id` / `编号` → 编号，`规则` → 规则，`理由`、`范围`、`批准`、`到期`、`状态` 各对一列。多列命中同一字段时按先命中者取，并记一条不合格。列的顺序、多出来的列（`偏离`、`替代检查`……）都不影响解析。

**判定顺序写死，先判关闭**：`状态` 含 `关闭` / `closed` / `done` / `已处理` 的行不登记、不报过期、不参与有效性校验——它是历史记录，不是生效中的例外。

**一行有效要五项齐全**：规则、理由、范围、批准人非空，到期能被解析（`YYYY-MM-DD` 或 ISO8601）。**到期必填**，没有到期的登记就是一键静音。`替代检查`／补偿控制这一列本工具**不校验**——那一列写的是项目自己的补偿措施，机械判不了它是否落实（§7）。到期由工具按**运行日**比较，基准日写进证据；过了期该行自动失效，对应发现回到未登记，并多出一条 `exception-register/expired`。

**规则列写的是 Finding id**（报告里每条未定下面那行 `id：…`，直接抄）。比较前去首尾空白、剥首尾反引号，然后**精确相等**才算命中。与项目自己的门号例外（`G6`、`G9` 之类）共用一张表：**规则列不含 `/` 的行本工具一概不理**，既不登记也不校验——那是项目的门，不是本工具的发现。规则含 `/` 却匹配不到本次任何**未定**发现（含匹配到 `PASS`／`SKIP`／`FAIL`）的行即为孤儿，出一条 `exception-register/orphan`（判据变了、该条已不是未定，或抄错了，都该清理——留着的死行会在日后该条转回未定时静默复活）。

**FAIL 不可登记。** 本工具的 FAIL 按 §1.1 只在项目自己声明的事实下产出，那是确定的违规，处置是修或改声明。整块判据在本项目不适用走 `tailoring`（§5）——那是"这个检查器对我不适用"，粒度是整个检查器；例外登记是"这一条发现我看过并接受到某日"，粒度是单条发现。两者不可互换。

**与 §1.1 的关系**：登记**不是配置键**，也不改任何判据的召回位置。§1.1 禁的是"替工具修判据"的键——那会让每个采用方各自把召回改一遍；登记不动召回，它承认发现成立，只记录人对它的处置。

**与 01 §5.5 同行标记词的关系**：差别在于它是**独立于被检查对象的一份登记册**——每行带批准人与到期、超期自动失效、可被上一级抽查；贴在被检查行上的注释这三件都没有，不算登记。

**已知边界**（不加代码处理，写在这里）：

- 登记表里复述的数值会被 `single-authority` 的判据 3 算进文件数，于是那条发现的标题计数会变——但它的 `id` 不变，登记仍然有效。
- 登记表若落在 `layout.docs_root` 之内，会被 `freshness` 当成一份文档巡检。项目自行用 `layout.frozen` 处理。
