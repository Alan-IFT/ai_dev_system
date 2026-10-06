// 文本小工具对 Python 的黄金样本（golden/unit/text.json）：`splitlines()` / `splitlines(True)` 与 tier 取值的 `strip().upper()`。
// splitlines 的行终止符集合与 JS 的 split('\n') 不同，错一个就是整批行号错位（7 个检查器在用）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitLinesPy } from '../lib/core/yaml.js'
import { pyStrip } from '../lib/core/finding.js'

const here = dirname(fileURLToPath(import.meta.url))
const gold = JSON.parse(readFileSync(join(here, '..', 'golden', 'unit', 'text.json'), 'utf8'))

test('样本规模', () => assert.ok(gold.splitlines.length >= 150 && gold.upper.length >= 30))

test('splitLinesPy：全部输入对 Python 的 splitlines() 逐条一致（行终止符集合、\\r\\n 算一个、连续终止符产生空行、无末尾空串）', () => {
  const wrong = gold.splitlines.filter((g) => JSON.stringify(splitLinesPy(g.text)) !== JSON.stringify(g.lines)).map((g) => ({ text: g.text, want: g.lines, got: splitLinesPy(g.text) }))
  assert.deepEqual(wrong.slice(0, 5), [], `不一致共 ${wrong.length} 条`)
})

test('splitLinesPy(keepends)：全部输入对 Python 的 splitlines(True) 逐条一致，且拼回去等于原文', () => {
  const wrong = gold.splitlines.filter((g) => JSON.stringify(splitLinesPy(g.text, true)) !== JSON.stringify(g.keepends)).map((g) => ({ text: g.text, want: g.keepends, got: splitLinesPy(g.text, true) }))
  assert.deepEqual(wrong.slice(0, 5), [], `不一致共 ${wrong.length} 条`)
  for (const g of gold.splitlines) assert.equal(splitLinesPy(g.text, true).join(''), g.text, JSON.stringify(g.text))
})

test('splitLinesPy 的每一种行终止符都被认（逐个验证，不靠整份比对）：\\n \\r \\r\\n \\v \\f \\x1c \\x1d \\x1e \\x85 \\u2028 \\u2029', () => {
  for (const t of ['\n', '\r', '\r\n', '\x0b', '\x0c', '\x1c', '\x1d', '\x1e', '\x85', '\u2028', '\u2029']) {
    assert.deepEqual(splitLinesPy('a' + t + 'b'), ['a', 'b'], JSON.stringify(t)); assert.deepEqual(splitLinesPy('a' + t + 'b', true), ['a' + t, 'b'], JSON.stringify(t))
  }
  assert.deepEqual(splitLinesPy('a\r\nb'), ['a', 'b'], '\\r\\n 算一个终止符，不是两个'); assert.deepEqual(splitLinesPy('a\n\rb'), ['a', '', 'b'], '\\n\\r 是两个')
  assert.deepEqual(splitLinesPy('a\u001fb'), ['a\u001fb'], '\\x1f 不是终止符'); assert.deepEqual(splitLinesPy('a\u200bb'), ['a\u200bb'], '零宽空格不是终止符')
  assert.deepEqual(splitLinesPy(''), []); assert.deepEqual(splitLinesPy('\n'), ['']); assert.deepEqual(splitLinesPy('a\n'), ['a'], '无末尾空串'); assert.deepEqual(splitLinesPy('\n\n'), ['', ''])
})

test('tier 取值 `strip().upper()`：能落进 L0-L3 的输入集合与 Python 一致（JS 的 toUpperCase 对 ß ﬁ ſ 等的结果可不同，但它们都不会变成 L0-L3）', () => {
  const TIERS = ['L0', 'L1', 'L2', 'L3']
  const wrong = gold.upper.filter((g) => TIERS.includes(pyStrip(String(g.in)).toUpperCase()) !== g.in_tiers).map((g) => g.in)
  assert.deepEqual(wrong, [])
  // 几个能进的、几个不能进的，字面写出（变异：去掉 strip、去掉 upper）
  for (const ok of ['l0', 'L1', ' l2 ', '\tL3\n', '\u3000L1\u3000']) assert.ok(TIERS.includes(pyStrip(ok).toUpperCase()), JSON.stringify(ok))
  for (const bad of ['l4', 'l 1', 'l1x', '\ufeffL1', '\uff2c\uff11', '']) assert.ok(!TIERS.includes(pyStrip(bad).toUpperCase()), JSON.stringify(bad))
})
