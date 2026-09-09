# 检查器契约

本文规定 `tools/std/` 下每个检查器必须满足的接口与行为。**它是并行实现的前提**：满足本契约的检查器可以各自独立编写、独立测试，由 `check_all` 汇总。

标准正文见 [`标准/`](../../标准/README.md)（修订 `2026-09-10`）。检查器只做**机械可判定**的部分；判不了的一律输出 `UNDETERMINED`，不猜、不降级为通过。

---

## 1. 三态，且未定不可静默升格

每条检查结果只有三种：

| 状态 | 含义 | 退出码贡献 |
|---|---|---|
| `PASS` | 检查实际执行了，且未发现违规 | 0 |
| `FAIL` | 检查实际执行了，发现违规 | 1 |
| `UNDETERMINED` | 未能判定：对象不存在、配置缺失、依赖不可用、判据本身不适用 | 2 |

**这是本工具与普通 linter 的根本区别。** 依据是 [01 §2 N1](../../标准/01-项目管理标准.md) 与 [§5.6](../../标准/01-项目管理标准.md#gates)：适用却没配置或未执行的门记未定，不记通过。

规则：

- **`UNDETERMINED` 永远不能被合并成 `PASS`。** 汇总时三态各自计数，不允许"没有 FAIL 即通过"。
- 对象不存在时，先判**是否适用**：不适用记 `SKIP`（不计入三态，但必须给理由）；适用而对象缺失记 `UNDETERMINED`。
- 检查器自身崩溃、超时、依赖缺失，一律 `UNDETERMINED`，**不得吞掉异常记 PASS**。依据：该项目已发生过"守卫崩溃却报告为漂移"与"退出 0 却跑了 0 个测试"。

`check_all` 的退出码：有任一 `FAIL` → 1；无 FAIL 但有 `UNDETERMINED` → 2；全 PASS/SKIP → 0。**调用方不得把 2 当成功。**

---

## 2. 每个检查器必须声明覆盖边界

输出里必须带 `scope`，写明**检查了什么、没检查什么**。依据 [01 §5.6](../../标准/01-项目管理标准.md#gates)（控制的覆盖范围本身是状态）与 [04 §6.1](../../标准/04-可靠性安全与运行维护.md#agent-run-observability)（未采到的区间记未知）。

未覆盖的部分不是"没问题"，是"没看"。例如只扫 `*.md` 的检查器必须写明它不看 `*.service`、`*.sh`、`*.json`——该项目真实吃过这个亏：现有闸门只扫 `scripts/*.sh`，因而看不见两个应用仓里 28 处已断的跨仓引用。

---

## 3. 每个检查器必须自带反例（静默失效探测）

**没有反例测试的检查器，其结果记 `UNDETERMINED`，不记 `PASS`。**

依据 [01 §5.6](../../标准/01-项目管理标准.md#gates) 的四步验收与 [M-10](../../标准/参考资料/M-10-守卫的执行点.md)：守卫存在不等于守卫在执行。每个检查器提供 `selftest()`：

1. 造一个**应该被判 FAIL** 的最小样本，跑检查器，必须得到 FAIL；
2. 造一个**应该被判 PASS** 的最小样本，必须得到 PASS。

任一条不成立即判该检查器故障，其对目标仓库的结论作废、记 `UNDETERMINED`。`check_all --selftest` 单独跑这一层。

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
| `cfg["_path"]` | 配置文件的实际路径 | 只用于报告与证据。它是相对路径（`governance/project.yaml`）还是绝对路径（`--config` 给的外部配置），决定了输出里要不要标注"外部配置" |

这两个键的名字带下划线是为了与项目自己写的配置项区分：**项目的 `project.yaml` 里写 `_root` 或 `_path` 无效**——`load_config` 解析完会原地覆盖它们。

除这两个之外，检查器**自己**也可以约定下划线开头的注入口，只在自检里往 `cfg` 里塞、`load_config` 不产生也不覆盖。目前有一个：`check_links` 的 `_links_files`（由 `check_links.selftest` 注入，取代 `git ls-files` 的结果，让自检不碰真实仓库的 git 索引，见第 3 节）。**这类键不是项目配置项，项目不要写**——`load_config` 不会覆盖它，写了会被检查器当真采信，等于让被检查方自己指定检查范围。新增这类注入口要在本节登记，因为"`cfg` 里都有什么"是契约面，不是实现细节。

`Finding` 的字段：

```python
{
  "check": NAME,
  "status": "PASS" | "FAIL" | "UNDETERMINED" | "SKIP",
  "title": "一句话说清是什么",         # FAIL 时必须能定位
  "where": "path:line" 或 None,        # 可定位工件，FAIL 时尽量给
  "why": "为什么这算问题" ,             # 绑到 STANDARD_REFS 的哪一条
  "reason": "未定/跳过的原因",          # UNDETERMINED 与 SKIP 必填
  "evidence": "原始证据，命令或摘录",   # 可复算
}
```

**`why` 必须能追到标准的具体条款。** 追不到的检查项不进本工具——那说明它是实现者的偏好，不是标准的要求。

---

## 5. 配置

项目根的 `governance/project.yaml`，检查器只从这里取项目相关参数，**不硬编码路径**：

```yaml
standard_version: "2026-09-10"     # 采用的标准修订，见 标准/README.md
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
  status_lines: 80
  work_item_lines: 150
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
```

**只用块状列表（短横线），不要用 `[a, b]` 这种流式写法**——解析器按"歧义即拒绝"拒收它，本文此前的示例写成流式，照抄会让整份配置解析失败，已改正。

上面每个键的类型、是否必填、以及缺了会怎样：

| 键 | 类型 | 必填 | 缺省行为 |
|---|---|---|---|
| `tier` | 字符串 `L0`/`L1`/`L2`/`L3` | **是** | `check_layout` 整条记 `UNDETERMINED`——不猜该项目该有哪些工件。取值不在四档内同样记未定，不归到最近的一档 |
| `tailoring` | 列表，每项 `check` / `applicable` / `reason` | 否 | 视为没裁剪任何检查。`check` 可写检查器短名，也可写 `layout:<role>` 或裸 `<role>` 单裁一个工件 |
| `layout.entry` | 字符串列表 | 否 | `entry-budget` 与 `cross-repo` 的入口相关判据记 `UNDETERMINED`——不猜哪份是入口；只有 `check_layout` 退回分档快照里的候选名判存在性 |
| `layout.docs_root` | 字符串 | 否 | **两个检查器不一致**：`check_layout` 退回常量 `docs`，`freshness` 记 `UNDETERMINED`（不猜文档放在哪）。想让 `freshness` 跑起来就必须写 |
| `layout.work_root` | 字符串 | 否 | 取常量 `docs/state/work`，并在 `evidence` 里注明用的是默认 |
| `layout.artifacts` | 映射，`<role>: 路径` | 否 | 按分档快照里的候选路径猜；给了就只认它，不再猜候选。role 名见 `check_layout` 的 `_TIER_ITEMS`（`entry`/`acceptance`/`status`/`playbook`/`failures`/…） |
| `layout.frozen` | 路径前缀列表 | 否 | 视为没有只读归档区，全仓都承担更新义务 |
| `layout.rule_files` | 路径/前缀列表，以 `/` 结尾按目录递归 | 否 | 取常量 `.harness/rules/`、`.claude/`、`AGENTS.md`、`CLAUDE.md`，并在 `evidence` 里注明用的是缺省清单。只有 `cross-repo` 判退役仓时用它 |
| `budgets.entry_lines` | 正整数 | 否 | 取 01 §3.7 默认 150 并注明未校准；不是正整数记 `UNDETERMINED` |
| `budgets.status_lines` | 正整数 | 否 | 01 §3.7 的 `STATUS.md` 上限 80。**目前没有检查器读它** |
| `budgets.work_item_lines` | 正整数 | 否 | 01 §3.7 的工作项上限 150。**目前没有检查器读它** |
| `budgets.stale_days` | 正整数 | 否 | 取常量 90 并注明未校准；不是正整数记 `UNDETERMINED` |
| `budgets.work_item_stale_days` | 正整数 | 否 | 取常量 14 并注明未校准；不是正整数记 `UNDETERMINED` |
| `budgets.duplicate_min_lines` | 整数 ≥2 | 否 | 取常量 3 并注明未校准 |
| `budgets.duplicate_min_chars` | 整数 ≥1 | 否 | 取常量 60 并注明未校准 |
| `metadata_fields` | 字符串列表（也接受单个字符串） | 否 | 取常量 `updated_at` 并注明未校准 |
| `metadata_required` | 路径前缀列表 | 否 | 按目录名约定判：路径里出现 `acceptance`/`architecture`/`modules`/`contracts`/`decisions`/`runbooks` 之一即算需要元信息。给了就只认这份清单 |
| `work_item_done_states` | 字符串列表（大小写不敏感） | 否 | 取常量 `done`/`完成`/`delivered` 并注明未校准 |
| `work_item_in_progress_states` | 字符串列表 | 否 | 取常量 `in_progress`/`进行中` 并注明未校准 |
| `derived` | 列表，每项 `artifact` / `source` / `regen` | 否 | `check_derived` 整条记 `SKIP`——不猜哪些文件是生成的 |
| `repos` | 列表，每项 `name` / `path` / `role` | 否 | `cross-repo` 记 `UNDETERMINED`（不足两个条目同样记未定）。`role` 取 `system`/`app`/`retired`/`archived` |

**缺配置项时记 `UNDETERMINED` 并写明缺哪一项，不取默认值当事实。** 例外见上表"缺省行为"一列：`budgets` 的全部键，以及 `layout.work_root`、`layout.rule_files`、`metadata_fields`、两个 `work_item_*_states`，缺失时取常量兜底而不是记未定；**取了默认就必须在 `evidence` 里写明"用的是默认值，项目未校准"**，让读报告的人知道这个结论建立在工具的假设上。`layout.docs_root` 是半个例外：`check_layout` 兜底、`freshness` 记未定——这处不一致是实现现状，不是有意设计。除这些之外的键缺失一律记 `UNDETERMINED`。

配置也可由 `check_all --config PATH` 从被扫描项目之外给出，此时 `_root` 仍是被扫描项目、`_path` 记配置的实际路径；这是扫描只读/第三方项目而不往其中写入任何文件的唯一受支持方式；外部配置缺失或解析失败一律记 `UNDETERMINED`，不回退到 `<root>/governance/`。

---

## 6. 输出

默认人读的文本：先给三态计数，再按 `FAIL` → `UNDETERMINED` → `SKIP` 排，`PASS` 只给计数不逐条列。`--json` 输出机器可读的 Finding 数组，供上层工具消费。

**不输出分数、不输出百分比、不输出"健康度"。** 依据 [01 §4.8](../../标准/01-项目管理标准.md#delivery-metrics)：合成指标会把未定折算成部分通过。

---

## 7. 检查器只做机械判定

能机械判定的才写成检查器。**判不了的写进走查清单交给人**，不要做成"用模型判一下"的检查器——那会让检查结果本身不可重复（见 [04 §6.2](../../标准/04-可靠性安全与运行维护.md#agent-run-observability)）。

具体地：文件是否存在、链接是否可达、行数是否超预算、同一字符串是否出现在两处、时间戳是否超期、字段是否齐全——可以。某段文字写得好不好、某条规则该不该存在、某个设计是否合理——不可以。
