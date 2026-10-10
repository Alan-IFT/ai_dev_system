// 按码点截取（设计 §12.6 D18）：Python 的 `s[:n]` 按码点计，JS 的 `slice` 按 UTF-16 码元计，BMP 之外的字符（emoji、CJK 扩展区）占 2 个码元。
// 此前这条差别没被任何测试抓到：`core/docs.ts` 的 `headOf` 用 `text.slice(0, HEAD_CHARS)`，头部含 emoji 的文档字段会被挤出头部，
// 进而影响 findField / itemStatus → layout、entry_budget、freshness 的 status。
// 规格最初取自迁移期对 Python 版的实测（原为 83 条、约 340 KB 的夹具）；它其实是一张 2×5×2×4 的网格加三条小节用例，期望只取决于（字段，偏移），
// 与前缀字符种类和个数无关——下面用公式生成输入、用两张小表给期望，等价且可读。
import test from 'node:test'
import assert from 'node:assert/strict'
import { findField, itemStatus, headOf, headChars, HEAD_CHARS } from '../lib/core/docs.js'

const EMOJI = '\u{1F600}'   // 1 个码点 / 2 个码元
const HAN_EXT = '\u{20000}'  // CJK 扩展 B：同样 1 个码点 / 2 个码元
const DATE_FIELD = '\nupdated_at: 2026-09-10\n', STATUS_FIELD = '\n状态：进行中\n'

/** 前面 n 个非 BMP 字符，补 x 使字段结束在第 target 个**码点**处，后面再跟 5 个「尾」。 */
const build = (ch, n, tail, target) => ch.repeat(n) + 'x'.repeat(target - [...tail].length - n) + tail + '尾'.repeat(5)

// 字段结束位置相对 HEAD_CHARS 边界：-3 在内、0 恰好、1 与 3 越界一点。期望的 [日期, 状态]（null＝取不到）：
// 越界 1 个码点时仍取得到——截断点恰好落在字段末尾的换行上；越界 3 个码点时值被截断（日期剩 "2026-09-"，状态剩 "进"）。
const DATE_WANT = { '-3': '2026-09-10', 0: '2026-09-10', 1: '2026-09-10', 3: '2026-09-' }
const STATUS_WANT = { '-3': '进行中', 0: '进行中', 1: '进行中', 3: '进' }

test('头部查找：非 BMP 前缀 0/1/5/20/100 个 × 日期与状态字段 × 字段结束在边界内／上／越界一点／越界三点，日期与状态按码点截取', () => {
  const wrong = []
  for (const [chName, ch] of [['emoji', EMOJI], ['han_ext', HAN_EXT]]) {
    for (const n of [0, 1, 5, 20, 100]) {
      for (const off of [-3, 0, 1, 3]) {
        const date = build(ch, n, DATE_FIELD, HEAD_CHARS + off), status = build(ch, n, STATUS_FIELD, HEAD_CHARS + off)
        const gotDate = findField(headChars(date, HEAD_CHARS), ['updated_at'])[0], gotStatus = itemStatus(status)
        // 日期用例里没有状态字段、状态用例里没有日期字段：另一项应取不到
        const other = [itemStatus(date), findField(headChars(status, HEAD_CHARS), ['updated_at'])[0]]
        if (gotDate !== DATE_WANT[off] || gotStatus !== STATUS_WANT[off] || other[0] !== null || other[1] !== null) wrong.push({ chName, n, off, gotDate, gotStatus, other })
      }
    }
  }
  assert.deepEqual(wrong.slice(0, 4), [], `不一致共 ${wrong.length} 条`)
})

test('头部标题截断：`## ` 小节标题之前才是头部；非 BMP 前缀紧贴字段名时字段名不在行首、状态取不到，日期仍在', () => {
  const body = '状态：进行中\nupdated_at: 2026-09-10\n\n## 背景\n状态：已完成\n'
  // 前缀 0 个：状态在行首，取头部里的「进行中」而不是小节里的「已完成」
  assert.equal(itemStatus(body), '进行中'); assert.equal(findField(headChars(body, HEAD_CHARS), ['updated_at'])[0], '2026-09-10')
  assert.equal(headOf(body).length, 31, '头部到小节标题之前为止，31 个码点')
  // 前缀 3、50 个 emoji：「状态」前面紧贴非空白字符，字段名不在行首，itemStatus 取不到；updated_at 在第二行行首，仍取得到
  for (const n of [3, 50]) {
    const t = EMOJI.repeat(n) + body
    assert.equal(itemStatus(t), null, `前缀 ${n} 个 emoji`); assert.equal(findField(headChars(t, HEAD_CHARS), ['updated_at'])[0], '2026-09-10')
    assert.equal([...headOf(t)].length, 31 + n, '头部长度随前缀的码点数增长（按码点，不是码元）')
  }
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
  const t = EMOJI.repeat(20) + 'x'.repeat(HEAD_CHARS - field.length - 20) + field + '尾尾'
  assert.equal(findField(headChars(t, HEAD_CHARS), ['updated_at'])[0], '2026-09-10')
  // 状态字段同理：itemStatus 经 headOf 的截取
  const st = EMOJI.repeat(20) + 'x'.repeat(HEAD_CHARS - '\n状态：进行中\n'.length - 20) + '\n状态：进行中\n' + '尾尾'
  assert.equal(itemStatus(st), '进行中')
  assert.ok(headOf(st).includes('状态：进行中'))
})
