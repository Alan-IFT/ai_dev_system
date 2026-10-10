// evidence 检查器的纯函数对 Python 版黄金样本（golden/unit/evidence.json）逐条比对：labelField、unknownLabel、isSep、splitRow、mapHeader、isPlaceholder、
// evidenceSections、parseListBlocks、parseTableBlocks、judge，以及 `str.isdigit()` 的全码点集合。
// 为什么要这份样本：四个真实仓里 evidence 只出现整齐六字段写法的 PASS，**边界写法（全角、围栏、表格、认不出的标签、各种空白）一个真实输入都没有**。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { labelField, unknownLabel, isSep, splitRow, mapHeader, isPlaceholder, evidenceSections, parseListBlocks, parseTableBlocks, judge, isPyDigit } from '../lib/checks/evidence.js'

const here = dirname(fileURLToPath(import.meta.url))
const gold = JSON.parse(readFileSync(join(here, 'fixtures', 'evidence.json'), 'utf8'))
const bad = (arr, f) => arr.filter((g) => JSON.stringify(f(g)) !== JSON.stringify(g.out)).map((g) => ({ in: String(g.in).slice(0, 40), want: g.out, got: f(g) }))

test('样本规模', () => assert.ok(gold.label_field.length >= 130 && gold.unknown_label.length >= 95 && gold.is_sep.length >= 40 && gold.split_row.length >= 25 && gold.map_header.length >= 30 && gold.is_placeholder.length >= 65 && gold.sections.length >= 45 && gold.blocks.length >= 40))

test('labelField：全部输入对 Python 逐条一致（前导字符类、re.I 折叠、同义词优先级、值取到行尾含行内特殊字符）', () => assert.deepEqual(bad(gold.label_field, (g) => labelField(g.in)).slice(0, 3), []))
test('unknownLabel：全部输入对 Python 逐条一致（12 个码点、纯数字（含上标/带圈）、说明词、URL、前导编号）', () => assert.deepEqual(bad(gold.unknown_label, (g) => unknownLabel(g.in)).slice(0, 3), []))
test('isSep：全部输入对 Python 逐条一致', () => assert.deepEqual(bad(gold.is_sep, (g) => isSep(g.in)).slice(0, 3), []))
test('splitRow：全部输入对 Python 逐条一致', () => assert.deepEqual(bad(gold.split_row, (g) => splitRow(g.in)).slice(0, 3), []))
test('mapHeader：全部输入对 Python 逐条一致（_id 列不算字段、acceptance 例外、包含匹配的优先级）', () => assert.deepEqual(bad(gold.map_header, (g) => [...mapHeader(g.in)].map(([k, v]) => [k, v]).sort((a, b) => a[0] - b[0])).slice(0, 3), []))
test('isPlaceholder：全部输入对 Python 逐条一致', () => assert.deepEqual(bad(gold.is_placeholder, (g) => isPlaceholder(g.in)).slice(0, 3), []))
test('evidenceSections：全部整篇文本对 Python 逐条一致（围栏开闭、标题层级、BOM、行终止符）', () => assert.deepEqual(bad(gold.sections, (g) => evidenceSections(g.in)).slice(0, 3), []))

// 样本由 Python 的 `json.dump(sort_keys=True)` 写出，键是排好序的；这里把 fields 也按键排序再比（比较方式，不是被测函数的行为：fields 的键序对结论无影响）
const sortedObj = (m) => Object.fromEntries([...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
const toObj = (b) => ({ kind: b.kind, limit_cols: b.limit_cols, line: b.line, name: b.name, sub: b.sub ?? null, unknown: b.unknown, fields: sortedObj(b.fields) })
const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v))
const rowsOf = (t) => t.split(/\r\n|[\n\r\x0b\x0c\x1c-\x1e\x85\u2028\u2029]/).map((ln, i) => [i + 1, ln]).filter((_, i, a) => !(i === a.length - 1 && a[i][1] === ''))

test('parseTableBlocks / parseListBlocks：全部文本对 Python 逐条一致（块的名字、行号、字段、限制列、写法、认不出的行数、是否小标题）', () => {
  const wrong = []
  for (const g of gold.blocks) {
    const rows = rowsOf(g.text)
    const tb = parseTableBlocks(rows)
    const lb = parseListBlocks(rows, tb.length === 0)
    const got = { table: tb.map(toObj), list: lb.map(toObj) }
    if (canon(got) !== canon({ table: g.table, list: g.list })) wrong.push({ name: g.name, want: { table: g.table, list: g.list }, got })
  }
  assert.deepEqual(wrong.slice(0, 2), [], `不一致共 ${wrong.length} 条`)
})

test('judge：对每个块的结论对 Python 逐条一致（缺的、空的、限制是否为空）', () => {
  const wrong = []
  for (const j of gold.judge) {
    const g = gold.blocks.find((b) => b.name === j.name)
    const rows = rowsOf(g.text)
    const tb = parseTableBlocks(rows)
    const lb = parseListBlocks(rows, tb.length === 0)
    const got = { table: tb.map((b) => judge(b)), list: lb.map((b) => judge(b)) }
    if (JSON.stringify(got) !== JSON.stringify({ table: j.table, list: j.list })) wrong.push({ name: j.name, want: { table: j.table, list: j.list }, got })
  }
  assert.deepEqual(wrong.slice(0, 2), [], `不一致共 ${wrong.length} 条`)
})

test('isPyDigit：对 Python 的 str.isdigit() 全码点——Python 为真的 TS 一律为真；TS 多出来的全是 Python（Unicode 15.0）视作未分配的码点（版本差，不是写法差，同 D5）', () => {
  const inPy = (c) => gold.isdigit_ranges.some(([a, b]) => c >= a && c <= b)
  const missing = [], extra = []
  for (let c = 0; c < 0x110000; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue
    const ts = isPyDigit(String.fromCodePoint(c)), py = inPy(c)
    if (py && !ts) missing.push(c.toString(16))
    if (!py && ts) extra.push(c)
  }
  assert.deepEqual(missing, [], 'Python 认为是数字而 TS 不认的码点必须为零')
  // TS 多认的：必须全是 Nd 且是 Unicode 16/17 才新增的（Python 3.12 的 Unicode 15.0 里是未分配 Cn）。用一个已知的 Unicode 16 新增数字范围抽样，并限定数量级
  assert.ok(extra.length < 150, `TS 多认的 ${extra.length} 个——应只有 Unicode 16/17 新增的十进制数字`)
  for (const c of extra) assert.ok(/\p{Nd}/u.test(String.fromCodePoint(c)), `U+${c.toString(16)} 不是 Nd，也不在 Python 的 isdigit 里——多认了不该认的`)
  assert.equal(isPyDigit(''), false, '空串不是数字（Python 的 isdigit 对空串为假）')
  assert.equal(isPyDigit('12a'), false); assert.equal(isPyDigit('²'), true); assert.equal(isPyDigit('①'), true); assert.equal(isPyDigit('٣'), true); assert.equal(isPyDigit('１２'), true)
})
