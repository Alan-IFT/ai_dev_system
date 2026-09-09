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
tailoring:                          # 裁剪：不适用的部分与理由
  - check: cross-repo
    applicable: false
    reason: 单仓项目
layout:
  entry:                            # 入口文件，受行数预算约束
    - CLAUDE.md
    - AGENTS.md
  docs_root: docs
  frozen:                           # 只读归档区，不参与新鲜度与更新义务
    - docs/features
budgets:                             # 参数，项目可改；默认见 01 §3.7
  entry_lines: 150
  status_lines: 80
  work_item_lines: 150
repos:                               # 多仓系统，见 01 §3.8；单仓省略
  - name: control-plane
    path: .
    role: system                     # system | app | retired | archived
```

**只用块状列表（短横线），不要用 `[a, b]` 这种流式写法**——解析器按"歧义即拒绝"拒收它，本文此前的示例写成流式，照抄会让整份配置解析失败，已改正。

**缺配置项时记 `UNDETERMINED` 并写明缺哪一项，不取默认值当事实。** 例外：`budgets` 有标准默认值，可取默认但要在 `evidence` 里注明"用的是标准默认值，项目未校准"。

---

## 6. 输出

默认人读的文本：先给三态计数，再按 `FAIL` → `UNDETERMINED` → `SKIP` 排，`PASS` 只给计数不逐条列。`--json` 输出机器可读的 Finding 数组，供上层工具消费。

**不输出分数、不输出百分比、不输出"健康度"。** 依据 [01 §4.8](../../标准/01-项目管理标准.md#delivery-metrics)：合成指标会把未定折算成部分通过。

---

## 7. 检查器只做机械判定

能机械判定的才写成检查器。**判不了的写进走查清单交给人**，不要做成"用模型判一下"的检查器——那会让检查结果本身不可重复（见 [04 §6.2](../../标准/04-可靠性安全与运行维护.md#agent-run-observability)）。

具体地：文件是否存在、链接是否可达、行数是否超预算、同一字符串是否出现在两处、时间戳是否超期、字段是否齐全——可以。某段文字写得好不好、某条规则该不该存在、某个设计是否合理——不可以。
