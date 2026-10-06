// core/finding 的单元测试。金标准来自 Python 版：golden/unit/stdlib-pure.json（函数输出）与 golden/unit/whitespace.json（逐码点空白集合）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PY_WHITESPACE, pyStrip, normalizeKey, findingId, finding, encodeSurrogateEscape, PASS, FAIL, SKIP, UNDETERMINED } from '../lib/core/finding.js'

const here = dirname(fileURLToPath(import.meta.url))
const unit = (name) => JSON.parse(readFileSync(join(here, '..', 'golden', 'unit', name), 'utf8'))

test('PY_WHITESPACE 逐码点等于 Python 的 str.strip() 与 re 的 \\s（0 到 0x10FFFF 全部码点，设计 §12.6 D6）', () => {
  const gold = unit('whitespace.json')
  assert.deepEqual(gold.strip, gold.re_s, '金标准自洽：Python 里 strip 与 \\s 是同一个集合')
  const inGold = (cp) => gold.strip.some(([a, b]) => cp >= a && cp <= b)
  const mine = new RegExp(`^[${PY_WHITESPACE}]$`, 'u')
  const wrong = []
  for (let cp = 0; cp < 0x110000; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue
    if (mine.test(String.fromCodePoint(cp)) !== inGold(cp)) wrong.push(cp)
  }
  assert.deepEqual(wrong, [], '与 Python 不一致的码点: ' + wrong.slice(0, 10).map((x) => 'U+' + x.toString(16)).join(' '))
})

test('pyStrip 与 JS 的 trim 在 U+FEFF 上不同：Python 留着 BOM，pyStrip 也留着（D6）', () => {
  assert.equal(pyStrip('\ufeffx\ufeff'), '\ufeffx\ufeff')
  assert.equal('\ufeffx\ufeff'.trim(), 'x', '对照：JS 的 trim 会去掉 BOM——这就是不能用它的原因')
  assert.equal(pyStrip('\u001cx\u0085'), 'x', 'U+001C 与 U+0085 Python 认作空白，JS 的 trim 不认')
  assert.equal('\u001cx\u0085'.trim(), '\u001cx\u0085')
  assert.equal(pyStrip('\u3000x\u00a0'), 'x')
})

test('normalizeKey：与 Python 版逐条一致', () => {
  const rows = unit('stdlib-pure.json').normalize_key
  assert.ok(rows.length >= 7)
  for (const { input, result } of rows) assert.equal(normalizeKey(input), result.ok, JSON.stringify(input))
})

test('findingId：与 Python 版逐条一致（含含代理字符的输入）', () => {
  const rows = unit('stdlib-pure.json').finding_id
  assert.ok(rows.length >= 7)
  for (const { args, result } of rows) {
    const real = args.map((a) => (a && typeof a === 'object' && 'surrogate_escaped' in a ? JSON.parse(`"${a.surrogate_escaped}"`) : a))
    assert.equal(findingId(...real), result.ok, JSON.stringify(args))
  }
})

test('encodeSurrogateEscape：合法字符串等于 UTF-8；DC80..DCFF 的孤立代理变成单字节；其它孤立代理抛（Python 同样抛）', () => {
  assert.deepEqual([...encodeSurrogateEscape('a中😀')], [...Buffer.from('a中😀', 'utf8')])
  assert.deepEqual([...encodeSurrogateEscape('t\udcff')], [0x74, 0xff])
  assert.deepEqual([...encodeSurrogateEscape('\udc80\udcfe')], [0x80, 0xfe])
  assert.throws(() => encodeSurrogateEscape('\ud800'), RangeError)
  assert.throws(() => encodeSurrogateEscape('\udc7f'), RangeError)
  assert.notDeepEqual([...Buffer.from('t\udcff', 'utf8')], [0x74, 0xff], '对照：Buffer.from 会把孤立代理换成 U+FFFD，哈希会不同')
})

test('finding：非法状态抛；未定与不适用必须给 reason；registered 初值为 null', () => {
  assert.throws(() => finding('c', 'MAYBE', 't'), /非法状态/)
  assert.throws(() => finding('c', UNDETERMINED, 't'), /必须给 reason/)
  assert.throws(() => finding('c', SKIP, 't'), /必须给 reason/)
  const f = finding('c', PASS, 't')
  assert.equal(f.registered, null); assert.equal(f.where, null); assert.equal(f.why, '')
  assert.equal(finding('c', FAIL, 't', { kind: 'k', key: 'a b' }).id, 'c/k/a_b')
  assert.equal(finding('c', UNDETERMINED, 't', { reason: 'r', kind: 'k', key: '  ' }).id, 'c/k', 'key 全空白等同没给')
})