// freshness 检查器的纯函数对 Python 版黄金样本（golden/unit/freshness.json）逐条比对：sectionBody、lastTransition、age、intBudget、note、metadataRequirement。
// 有意差异 D19（设计 §12.6）：日期令牌的 `\d{4}-\d{2}-\d{2}` 在 Python 里认全角与阿拉伯数字，TS 只认 ASCII；样本里这几条（标注 D19）单独断言，不计入逐条一致。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sectionBody, lastTransition, age, intBudget, note, metadataRequirement } from '../lib/checks/freshness.js'
import { toIso } from '../lib/core/dates.js'
import { AGE, INT_BUDGET, LAST_TRANSITION, METADATA_REQUIREMENT, NOTE, SECTION, SECTION_OTHER_KW } from './cases/freshness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const gold = { age: AGE, int_budget: INT_BUDGET, last_transition: LAST_TRANSITION, metadata_requirement: METADATA_REQUIREMENT, note: NOTE, section: SECTION, section_other_kw: SECTION_OTHER_KW }
const NON_ASCII_DIGIT = /[\uff10-\uff19\u0660-\u0669\u06f0-\u06f9]/

test('样本规模', () => assert.ok(gold.section.length >= 30 && gold.last_transition.length >= 45 && gold.age.length >= 10 && gold.int_budget.length >= 15 && gold.metadata_requirement.length >= 25))

test('sectionBody：全部输入对 Python 逐条一致（标题缩进、Unicode 小写、`lstrip("#")` 只去开头 #、七级标题、`\\r` `\\x0b` `\\u2028` 等行终止符）', () => {
  const KW = ['状态转换记录', '状态转换', '转换记录', 'transition']
  const wrong = gold.section.filter((g) => sectionBody(g.in, KW) !== g.out).map((g) => ({ in: g.in.slice(0, 40), want: g.out, got: sectionBody(g.in, KW) }))
  assert.deepEqual(wrong.slice(0, 5), [], `不一致共 ${wrong.length} 条`)
  const w2 = gold.section_other_kw.filter((g) => sectionBody(g.in, g.kw) !== g.out).map((g) => ({ in: g.in.slice(0, 30), kw: g.kw }))
  assert.deepEqual(w2.slice(0, 5), [], `换关键词后不一致共 ${w2.length} 条`)
})

test('lastTransition：全部输入对 Python 逐条一致（显式字段、小节最后一条的第一个日期、失败类别 absent/bad）；含非 ASCII 数字的几条是 D19，单独断言', () => {
  const wrong = []
  for (const g of gold.last_transition) {
    if (NON_ASCII_DIGIT.test(g.in)) continue
    const r = lastTransition(g.in)
    const got = { date: r.d ? toIso(r.d) : null, how: r.how, err: r.err }
    if (JSON.stringify(got) !== JSON.stringify({ date: g.date, how: g.how, err: g.err })) wrong.push({ in: g.in.slice(0, 60), want: { date: g.date, how: g.how, err: g.err }, got })
  }
  assert.deepEqual(wrong.slice(0, 4), [], `不一致共 ${wrong.length} 条`)
})

test('D19（有意差异，Alan 2026-10-06 选「保持 TS 严格」）：日期令牌里的全角/阿拉伯数字不被认——Python 读成 2026-09-01，TS 当没有日期 → 该小节「找不到带日期的记录行」记未定', () => {
  const asciiOnly = gold.last_transition.filter((g) => NON_ASCII_DIGIT.test(g.in))
  assert.ok(asciiOnly.length >= 3, '样本里有这几条')
  for (const g of asciiOnly) {
    const r = lastTransition(g.in)
    // Python 在这些输入上读出了日期（全角数字也算 \d）；TS 不读：要么没有日期（bad），要么只取到同一行里别的 ASCII 日期
    if (g.in.includes('| 2026-09-02 |')) assert.equal(r.d && toIso(r.d), '2026-09-02', '同一行里还有 ASCII 日期时取它')
    else { assert.equal(r.d, null, JSON.stringify(g.in)); assert.equal(r.err[0], 'bad') }
  }
})

test('age：晚一天按当天算（C18），晚两天及以上保持负数；非负原样（对 Python 逐条一致）', () => {
  const today = { year: 2026, month: 10, day: 6 }
  const addDays = (d, n) => { const t = new Date(Date.UTC(d.year, d.month - 1, d.day) + n * 86400000); return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() } }
  const wrong = gold.age.filter((g) => age(today, addDays(today, -g.delta)) !== g.out).map((g) => ({ delta: g.delta, want: g.out, got: age(today, addDays(today, -g.delta)) }))
  assert.deepEqual(wrong, [])
  assert.equal(age(today, addDays(today, 1)), 0); assert.equal(age(today, addDays(today, 2)), -2); assert.equal(age(today, addDays(today, -5)), 5)
})

test('intBudget：缺省取默认并标注；布尔、非整数浮点、字符串、空、列表、映射、0、负数都拒（对 Python 逐条一致）', () => {
  const wrong = []
  for (const g of gold.int_budget) {
    const cfg = g.in === null ? {} : { budgets: { x: g.in } }
    const [v, d, e] = intBudget(cfg, 'budgets.x', 90)
    if (JSON.stringify([v, d, e]) !== JSON.stringify(g.out)) wrong.push({ in: g.in, want: g.out, got: [v, d, e] })
  }
  assert.deepEqual(wrong.slice(0, 5), [], `不一致共 ${wrong.length} 条`)
})

test('note：默认值与项目声明两种文案对 Python 逐条一致', () => {
  const wrong = gold.note.filter((g) => note(g.used_default, g.name, g.value) !== g.out)
  assert.deepEqual(wrong, [])
})

test('metadataRequirement：五值全部输入对 Python 逐条一致（required、convention、not_required、declared_none、unknown；目录名约定只看路径中间的段、不看文件名；`!` 排除；空列表与键缺失分开）', () => {
  const wrong = gold.metadata_requirement.filter((g) => metadataRequirement(g.cfg, g.rel) !== g.out).map((g) => ({ cfg: g.cfg, rel: g.rel, want: g.out, got: metadataRequirement(g.cfg, g.rel) }))
  assert.deepEqual(wrong.slice(0, 5), [], `不一致共 ${wrong.length} 条`)
  assert.equal(new Set(gold.metadata_requirement.map((g) => g.out)).size, 5, '样本五值都有')
})
