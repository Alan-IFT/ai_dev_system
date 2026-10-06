// 配置取值与状态词表（对应 tools/std/stdlib.py 的 cfg_get / state_list / WORK_ITEM_STATES / DOC_STATES / _DECLARED_STATES / _lead_word / state_class）。
// 单独成文件是为了打破循环依赖：config（加载与校验）要用状态词表判「撞词」，docs（工件落点、工作项）要用 config 读出的配置；
// 它们都依赖这里，这里不依赖它们。

import { pyStrip } from './finding.js'
import type { YamlValue } from './yaml.js'

/** 配置对象：`load_config` 的结果。顶层键是任意 YAML 值；`_root`、`_path` 由代码注入（契约 §4）。 */
export type Config = { [k: string]: YamlValue | undefined }

/** 按 'budgets.entry_lines' 取值，缺失返回 default。中间任何一层不是映射、或缺键，都返回 default。 */
export function cfgGet(cfg: unknown, path: string, dflt: YamlValue | undefined = undefined): YamlValue | undefined {
  let cur: unknown = cfg
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur) || !Object.hasOwn(cur as object, part)) return dflt
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur as YamlValue
}

/** 01 §4.1 六态 → 别名（小写），唯一一份（01 §1 G2）：freshness 与 evidence 都按它判进行中 / 完成 / 认不出。 */
export const WORK_ITEM_STATES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['planned', ['planned', '计划中', '已计划']],
  ['in_progress', ['in_progress', 'in progress', '进行中']],
  ['blocked', ['blocked', '阻塞', '已阻塞']],
  ['in_validation', ['in_validation', '验证中', '待验证']],
  ['done', ['done', '完成', '已完成', 'delivered']],
  ['cancelled', ['cancelled', 'canceled', '取消', '已取消']],
]
export const DECLARED_STATES: ReadonlyArray<readonly [string, string]> = [['done', 'work_item_done_states'], ['in_progress', 'work_item_in_progress_states']]

/** 01 §3.5 文档状态四值 → 别名（小写），唯一一份。与 WORK_ITEM_STATES 不得有交集，项目声明的 work_item_*_states 撞上它整份拒收。 */
export const DOC_STATES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['draft', ['draft', '草稿']],
  ['active', ['active', '现行', '有效']],
  ['superseded', ['superseded', '已取代', '已被取代']],
  ['retired', ['retired', '已退役', '退役']],
]

/** 状态词表配置（列表或单个字符串），未配取 default。归一为去空白小写的列表。 */
export function stateList(cfg: unknown, path: string, dflt: readonly string[]): string[] {
  let states: unknown = cfgGet(cfg, path)
  // Python 的 `cfg_get(...) or list(default)`：值为假（None、''、[]、0、False）一律取默认
  if (!pyTruthy(states)) states = [...dflt]
  if (typeof states === 'string') states = [states]
  const out: string[] = []
  for (const s of Array.isArray(states) ? states : []) {
    const t = pyStrip(pyStr(s))
    if (t) out.push(t.toLowerCase())
  }
  return out
}

/** Python 的真值：None、False、0、0.0、''、[]、{} 为假。 */
export function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

/** Python 的 `str(x)`：对本模块会遇到的 YAML 值（字符串、整数、浮点、布尔、None）足够。布尔是 `True`/`False`，None 是 `None`。 */
export function pyStr(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : pyFloatStr(v)
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return '[' + v.map(pyRepr).join(', ') + ']'
  return JSON.stringify(v)
}

function pyFloatStr(n: number): string {
  // Python 的 repr(float)：最短往返表示；整数值带 .0。这里的浮点来自 YAML 的 `-?\d+\.\d+`，不会有指数与 inf/nan。
  const s = String(n)
  return s.includes('.') || s.includes('e') ? s : s + '.0'
}

function pyRepr(v: unknown): string {
  return typeof v === 'string' ? `'${v.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'` : pyStr(v)
}

/**
 * status 开头的状态词归到哪一类：别名之后是结尾或非字母数字即命中，长别名优先；认不出返回 null。
 * 「字母数字」按 Python 的 `str.isalnum()` ——Unicode 字母与数字，设计 §12.6 D5：JS 用 `[\p{L}\p{N}]`，已分配码点上与 Python 等价。
 */
export function leadWord(status: string | null | undefined, words: ReadonlyArray<readonly [string, string]>): string | null {
  const s = pyStrip(status ?? '')
  const sorted = [...words].sort((a, b) => b[0].length - a[0].length)   // 稳定排序：等长保持原顺序，与 Python sorted 一致
  for (const [word, c] of sorted) {
    if (s.startsWith(word) && (s.length === word.length || !(/^[\p{L}\p{N}]$/u.test(s[word.length]!) || s[word.length] === '_'))) return c
  }
  return null
}

/** 工作项状态值归到 01 §4.1 六态之一，认不出返回 null（D-127）。project.yaml 的 work_item_*_states **并入**对应态，不替换缺省。 */
export function stateClass(cfg: unknown, status: string | null | undefined): string | null {
  const words: Array<readonly [string, string]> = []
  for (const [c, al] of WORK_ITEM_STATES) for (const a of al) words.push([a, c])
  for (const [c, key] of DECLARED_STATES) for (const w of stateList(cfg, key, [])) words.push([w, c])
  return leadWord(status, words)
}
