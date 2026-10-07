// 日期解析（对应 tools/std/stdlib.py 的 parse_date，契约 §5、§9）。
//
// 设计 §12.6 D1（Alan 2026-10-06 决定「按契约严格解析」）：Python 版用 `fromisoformat`，在 3.12 上连紧凑型 `20261006`、周日期 `2026-W41-2`、
// 仅小时的 `2026-10-06T10` 都接受——那是 3.11 起的偶然放宽（3.8 到 3.10 不接受），契约只写 `YYYY-MM-DD` 与 ISO8601。
// TS 版只收契约写的两种：纯日期，以及 `T` 或空格分隔的 `HH:MM[:SS[.fraction]]` 加可选的 `Z`/`z`/`±HH[:MM]`。
// 这个决定对真实仓的影响面（实测有没有文档用到被放宽的写法）记在设计文档 §12.6 D1，**不在这里重复数字**——同一数值只放一处（01 §1 G2）。

import { pyStrip } from './finding.js'
import { pyRepr } from './repr.js'

/** 一个日历日期。不用 `Date`：它按本地时区解释，且 `new Date('2026-02-30')` 会静默进位。 */
export interface CalDate {
  readonly year: number
  readonly month: number
  readonly day: number
}

export function toIso(d: CalDate): string {
  return `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

/** 以 UTC 午夜的毫秒数表示的日历日，只用于加天数与比较；不经过本地时区。 */
function dayNumber(d: CalDate): number {
  return Math.floor(Date.UTC(d.year, d.month - 1, d.day) / 86_400_000)
}
function fromDayNumber(n: number): CalDate {
  const dt = new Date(n * 86_400_000)
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() }
}
/** 运行日（取系统日期，**本地时区**，与 Python 的 `datetime.date.today()` 同义）。 */
export function todayLocal(now: Date = new Date()): CalDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
}
export function addDays(d: CalDate, days: number): CalDate {
  return fromDayNumber(dayNumber(d) + days)
}
export function compareDays(a: CalDate, b: CalDate): number {
  return dayNumber(a) - dayNumber(b)
}

/** 公历日期是否存在（含闰年）。`2026-02-30`、`2026-13-01` 都不存在。 */
export function validDate(y: number, m: number, d: number): boolean {
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1) return false
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!
  return d <= dim
}

// 只认 ASCII 数字（D4）。
const PLAIN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/
const WITH_TIME = /^([0-9]{4})-([0-9]{2})-([0-9]{2})[T ]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.[0-9]+)?)?(?:[Zz]|[+-]([0-9]{2})(?::?([0-9]{2}))?)?$/
// 非严格模式的兜底：日期 + 任意文字（`2026-10-06 之前`）
const LEADING = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/

/**
 * 支持 YYYY-MM-DD 与 ISO8601。返回 [date, null] 或 [null, 原因]。解析不了不猜。
 * `*` 与反引号是 markdown 的加粗/行内代码标记，先剥掉。
 * strict：只收纯日期，不认「日期 + 任意文字」（例外登记的到期，契约 §9）。
 */
export function parseDate(raw: unknown, strict = false): [CalDate, null] | [null, string] {
  const s = pyStrip(String(raw).replaceAll('*', '').replaceAll('`', ''))
  if (!s) return [null, '值为空']
  // Python 的控制流（黄金样本实测，不是推断）：①date.fromisoformat ②datetime.fromisoformat ③**仅非严格**的「前 10 位是 YYYY-MM-DD」兜底。
  // ①②任一成功就返回；都失败（含「日期不存在」「时刻不合法」）才落到③。严格模式没有③，所以日期不存在时报的是「既不是…」；
  // 非严格模式的③命中格式但日期无效，才报「不是合法日期」。
  const m1 = PLAIN.exec(s) ?? WITH_TIME.exec(s)
  if (m1 && timeOk(m1)) {
    const y = Number(m1[1]), mo = Number(m1[2]), d = Number(m1[3])
    if (validDate(y, mo, d)) return [{ year: y, month: mo, day: d }, null]
  }
  const m3 = strict ? null : LEADING.exec(s)
  if (m3) {
    const y = Number(m3[1]), mo = Number(m3[2]), d = Number(m3[3])
    if (validDate(y, mo, d)) return [{ year: y, month: mo, day: d }, null]
    return [null, `不是合法日期：${pyRepr(s)}`]
  }
  return [null, `既不是 YYYY-MM-DD 也不是 ISO8601：${pyRepr(s)}`]
}

/** 时刻部分合法（纯日期没有时刻部分，恒合法）。 */
function timeOk(m: RegExpExecArray): boolean {
  if (m[4] === undefined) return true
  const h = Number(m[4]), mi = Number(m[5]), sec = m[6] === undefined ? 0 : Number(m[6])
  const tzh = m[7] === undefined ? 0 : Number(m[7]), tzm = m[8] === undefined ? 0 : Number(m[8])
  return h <= 23 && mi <= 59 && sec <= 59 && tzh <= 23 && tzm <= 59
}

