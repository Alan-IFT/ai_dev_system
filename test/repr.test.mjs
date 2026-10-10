// core/repr 对 Python `repr()` 的黄金样本（golden/unit/repr.json）逐条比对，外加「可打印」判定的逐码点全量核对。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pyRepr } from '../lib/core/repr.js'

const here = dirname(fileURLToPath(import.meta.url))
const gold = JSON.parse(readFileSync(join(here, 'fixtures', 'repr.json'), 'utf8'))

test('样本规模', () => assert.ok(gold.str.length >= 60 && gold.other.length >= 30 && gold.nonprintable_ranges.length > 100))

test('字符串：全部输入对 Python 的 repr 逐条一致（引号选择、转义、控制字符、非 ASCII 可打印、不可打印按码点、非 BMP）', () => {
  const wrong = gold.str.filter((g) => pyRepr(g.in) !== g.out).map((g) => ({ in: g.in, want: g.out, got: pyRepr(g.in) }))
  assert.deepEqual(wrong.slice(0, 6), [], `不一致共 ${wrong.length} 条`)
})

test('整数、浮点、布尔、None、列表、字典、嵌套：对 Python 逐条一致（整数值的浮点带 .0；字典键值各自 repr）', () => {
  const wrong = gold.other.filter((g) => pyRepr(g.in) !== g.out).map((g) => ({ in: g.in, want: g.out, got: pyRepr(g.in) }))
  assert.deepEqual(wrong.slice(0, 6), [], `不一致共 ${wrong.length} 条`)
  assert.ok(gold.other.some((g) => g.kind === 'float') && gold.other.some((g) => g.kind === 'int') && gold.other.some((g) => g.kind === 'list') && gold.other.some((g) => g.kind === 'dict'), '样本四种都有')
})

test('「可打印」判定：Python 的 isprintable 为假的码点，这里一个都不能当可打印原样输出（逐码点全量；Node 的 Unicode 比 Python 新，允许多保留 Python 视为未分配的码点，但不允许反过来）', () => {
  const inPy = (cp) => { let lo = 0, hi = gold.nonprintable_ranges.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1, [a, b] = gold.nonprintable_ranges[m]; if (cp < a) hi = m - 1; else if (cp > b) lo = m + 1; else return true } return false }
  let jsEscapesButPyPrints = 0, pyEscapesButJsPrints = 0
  for (let cp = 0; cp < 0x110000; cp++) {
    if (cp >= 0xD800 && cp <= 0xDFFF) continue
    const ch = String.fromCodePoint(cp)
    const jsEscapes = pyRepr(ch).slice(1, -1) !== ch && cp >= 0x7f // 非 ASCII 里被转义的
    const pyEscapes = inPy(cp) && cp >= 0x7f
    if (jsEscapes && !pyEscapes) jsEscapesButPyPrints++
    if (!jsEscapes && pyEscapes) pyEscapesButJsPrints++
  }
  assert.equal(jsEscapesButPyPrints, 0, 'Python 认可打印、这里却转义了：不允许')
  assert.ok(pyEscapesButJsPrints < 20000, `Node 的 Unicode 更新，多保留的是 Python 15.0 里未分配的码点（量级固定在一万多）；暴涨说明规则变了：${pyEscapesButJsPrints}`)
})

test('转义的写法按码点宽度选 \\x \\u \\U（变异：宽度边界）', () => {
  assert.equal(pyRepr('\x85'), "'\\x85'"); assert.equal(pyRepr('\xa0'), "'\\xa0'"); assert.equal(pyRepr('\xad'), "'\\xad'")
  assert.equal(pyRepr('\u2028'), "'\\u2028'"); assert.equal(pyRepr('\u3000'), "'\\u3000'"); assert.equal(pyRepr('\ufeff'), "'\\ufeff'")
  assert.equal(pyRepr('\u{e0001}'), "'\\U000e0001'"); assert.equal(pyRepr('\u{10ffff}'), "'\\U0010ffff'")
})

test('引号选择：含单引号不含双引号 → 双引号；两者都含 → 单引号并转义单引号；都不含 → 单引号', () => {
  assert.equal(pyRepr("it's"), '"it\'s"'); assert.equal(pyRepr('say "hi"'), `'say "hi"'`); assert.equal(pyRepr(`it's "x"`), `'it\\'s "x"'`); assert.equal(pyRepr('a'), "'a'")
})

test('None、布尔、整数不加引号；列表与字典递归；字符串里的反斜杠加倍', () => {
  assert.equal(pyRepr(null), 'None'); assert.equal(pyRepr(true), 'True'); assert.equal(pyRepr(false), 'False'); assert.equal(pyRepr(90), '90')
  assert.equal(pyRepr(['a', 1, null]), "['a', 1, None]"); assert.equal(pyRepr({ a: 'b', c: [1] }), "{'a': 'b', 'c': [1]}"); assert.equal(pyRepr('a\\b'), "'a\\\\b'")
})
