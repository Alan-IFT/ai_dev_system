// 按码点截取（设计 §12.6 D18）：Python 的 `s[:n]` 按码点计，JS 的 `slice` 按 UTF-16 码元计，BMP 之外的字符（emoji、CJK 扩展区）占 2 个码元。
// 此前这条差别没被任何测试抓到：`core/docs.ts` 的 `headOf` 用 `text.slice(0, HEAD_CHARS)`，头部含 emoji 的文档字段会被挤出头部，
// 进而影响 findField / itemStatus → layout、entry_budget、freshness 的 status。样本 golden/unit/codepoint.json 记 Python 在这些输入上的真实结论。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findField, itemStatus, headOf, headChars, HEAD_CHARS } from '../lib/core/docs.js'

const here = dirname(fileURLToPath(import.meta.url))
const gold = JSON.parse(readFileSync(join(here, '..', 'golden', 'unit', 'codepoint.json'), 'utf8'))

test('样本规模：含非 BMP 字符、码点数与码元数不同的输入占多数', () => {
  assert.ok(gold.cases.length >= 80)
  assert.ok(gold.cases.filter((c) => c.len_cp !== c.len_cu).length >= 60)
  assert.equal(gold.head_chars, HEAD_CHARS)
})

test('头部查找：全部输入的日期字段与状态字段对 Python 逐条一致（字段恰在边界内、恰在边界上、越界一点；emoji 与 CJK 扩展区；前缀 0、1、5、20、100 个）', () => {
  const wrong = []
  for (const c of gold.cases) {
    const d = findField(headChars(c.text, HEAD_CHARS), ['updated_at'])[0], s = itemStatus(c.text)
    if (d !== c.date || s !== c.item_status) wrong.push({ ch: c.ch, n: c.n, field: c.field, off: c.off, wantDate: c.date, gotDate: d, wantStatus: c.item_status, gotStatus: s })
  }
  assert.deepEqual(wrong.slice(0, 4), [], `不一致共 ${wrong.length} 条`)
})

test('headChars：按码点取前 n 个；码元数不超过 n 时原样返回；n 恰好劈在代理对中间时整个字符保留或整个丢弃，不留半个', () => {
  assert.equal(headChars('abc', 5), 'abc'); assert.equal(headChars('abcdef', 3), 'abc'); assert.equal(headChars('', 3), ''); assert.equal(headChars('abc', 0), '')
  assert.equal(headChars('\u{1F600}\u{1F600}\u{1F600}', 2), '\u{1F600}\u{1F600}', '2 个码点 = 4 个码元')
  assert.equal(headChars('a\u{1F600}b', 2), 'a\u{1F600}', '第 2 个码点是 emoji，整个保留')
  assert.equal(headChars('a\u{1F600}b', 1), 'a')
  assert.equal(headChars('\u{20000}x', 1), '\u{20000}', 'CJK 扩展 B 同样 2 个码元')
  // BMP 的最后一个码点 U+FFFF 只占 1 个码元；紧挨着的 U+10000 是第一个占 2 个码元的（边界两侧都要有，否则 `> 0xffff` 与 `>= 0xffff` 分不出）
  assert.equal(headChars('a\uffffb\uffffc\uffffd', 3), 'a\uffffb', 'U+FFFF 是 1 个码元')
  assert.equal(headChars('a\u{10000}b\u{10000}c', 3), 'a\u{10000}b', 'U+10000 是 2 个码元')
  const s = 'x'.repeat(3999) + '\u{1F600}' + 'tail'
  assert.equal([...headChars(s, 4000)].length, 4000); assert.ok(headChars(s, 4000).endsWith('\u{1F600}'), '第 4000 个码点是 emoji，保留完整')
  assert.ok(!/[\ud800-\udbff]$/.test(headChars(s, 3999)) && headChars(s, 3999) === 'x'.repeat(3999))
})

test('headOf 的 HEAD_CHARS 截取按码点：头部含 emoji 时字段不被挤出（直接断言，变异验证用）', () => {
  // 日期字段结束在第 4000 个码点上；前面 20 个 emoji 让 UTF-16 码元数超过 4000
  const field = '\nupdated_at: 2026-09-10\n'
  const t = '\u{1F600}'.repeat(20) + 'x'.repeat(HEAD_CHARS - field.length - 20) + field + '尾尾'
  assert.equal(findField(headChars(t, HEAD_CHARS), ['updated_at'])[0], '2026-09-10')
  // 状态字段同理：itemStatus 经 headOf 的截取
  const st = '\u{1F600}'.repeat(20) + 'x'.repeat(HEAD_CHARS - '\n状态：进行中\n'.length - 20) + '\n状态：进行中\n' + '尾尾'
  assert.equal(itemStatus(st), '进行中')
  assert.ok(headOf(st).includes('状态：进行中'))
})
