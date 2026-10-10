// core/yaml 的单元测试：对着 Python 版的单元黄金样本（golden/unit/stdlib-pure.json）逐条比对。
// 比对的是**结果与精确的错误信息**，不只是「接受还是拒收」——错误信息带行号并指明写法，是契约的一部分。
// 有意差异（设计 §12.6）在 KNOWN_DIFF 里逐条列出，**没列的差异都是 bug**。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseYamlSubset, stripComment, splitLinesPy, ConfigError } from '../lib/core/yaml.js'
import { parseDate, toIso } from '../lib/core/dates.js'
import { FINDING_ID, NORMALIZE_KEY, PARSE_DATE, STRIP_COMMENT, YAML } from './cases/stdlib-pure.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const gold = { finding_id: FINDING_ID, normalize_key: NORMALIZE_KEY, parse_date: PARSE_DATE, strip_comment: STRIP_COMMENT, yaml: YAML }

/**
 * 黄金样本是 json.dump(sort_keys=True) 写的，键按字典序；TS 对象保持插入序。键序**不是**解析结果的一部分（配置是映射，不是有序对），
 * 所以比较前两边都按键排序规范化。数组的顺序则是语义，不规范化。
 */
const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v
const run = (fn) => {
  try { return { ok: fn() } } catch (e) { return { raised: e.name, message: e.message } }
}

// 设计 §12.6 的有意差异：输入标签 → 说明。这些输入允许 TS 与 Python 不同；每条另有专门的测试钉住 TS 的实际行为。
const KNOWN_DIFF_YAML = new Map([
  // D4：非 ASCII 数字（本批样本里没有；留空表示目前没有输入落在差异上）
])

test('yaml 黄金样本非空且两类都有（空样本集不得算通过）', () => {
  assert.ok(gold.yaml.length >= 60, `样本只有 ${gold.yaml.length} 条`)
  const kinds = new Set(gold.yaml.map((x) => ('ok' in x.result ? 'ok' : 'raised')))
  assert.deepEqual([...kinds].sort(), ['ok', 'raised'])
})

test('parseYamlSubset：对 Python 黄金样本逐条一致（结果与精确的错误信息）', () => {
  const wrong = []
  for (const row of gold.yaml) {
    if (KNOWN_DIFF_YAML.has(row.input)) continue
    // 长输入在样本里只存了标签，不存原文：由专门的测试（下面「性能与深度」）按同样的生成规则重建
    if (row.input.startsWith('<长输入')) continue
    const got = run(() => parseYamlSubset(row.input))
    const want = row.result
    const same = 'ok' in want
      ? 'ok' in got && JSON.stringify(canon(got.ok)) === JSON.stringify(canon(want.ok))
      : got.raised === want.raised && got.message === want.message
    if (!same) wrong.push({ input: row.input, want, got })
  }
  assert.deepEqual(wrong, [], '与 Python 不一致的输入:\n' + wrong.slice(0, 5).map((w) => JSON.stringify(w)).join('\n'))
})

test('stripComment：对 Python 黄金样本逐条一致', () => {
  const wrong = []
  for (const { input, result } of gold.strip_comment) {
    const got = run(() => stripComment(input))
    if (JSON.stringify(got) !== JSON.stringify(result)) wrong.push({ input, want: result, got })
  }
  assert.deepEqual(wrong, [])
  assert.ok(gold.strip_comment.length >= 10)
})

test('性能与深度（D2）：长空白行与满行引号不超时；1200 层嵌套拒收、消息与 Python 相同；100 层以内照常接受', () => {
  const deep = (n) => Array.from({ length: n }, (_, i) => '  '.repeat(i) + 'k' + i + ':\n').join('') + '  '.repeat(n) + 'v: 1\n'
  const t0 = Date.now()
  parseYamlSubset('a: ' + ' '.repeat(100000) + '\n')
  run(() => parseYamlSubset('a: ' + "'".repeat(50000) + '\n'))
  run(() => parseYamlSubset('- '.repeat(2000) + 'x\n'))
  assert.ok(Date.now() - t0 < 2000, `耗时 ${Date.now() - t0}ms，应在 2 秒内（线性）`)
  const r = run(() => parseYamlSubset(deep(1200)))
  assert.equal(r.raised, 'ConfigError')
  assert.equal(r.message, '嵌套层数超出本解析器的递归上限；本工具的配置只需两三层')
  const goldDeep = gold.yaml.find((x) => x.input_len > 10000 && x.input.startsWith('<长输入') && 'raised' in x.result && x.result.message.startsWith('嵌套层数'))
  assert.ok(goldDeep, '黄金样本里应有那条 1200 层的记录')
  assert.equal(goldDeep.result.message, r.message, 'TS 与 Python 对 1200 层拒收的消息逐字相同')
  assert.ok('ok' in run(() => parseYamlSubset(deep(90))), '90 层应接受')
})

test('D3：超出安全整数范围的整数抛 ConfigError，不静默丢精度；范围内正常', () => {
  assert.deepEqual(parseYamlSubset('a: 9007199254740991\n'), { a: 9007199254740991 })
  assert.deepEqual(parseYamlSubset('a: -9007199254740991\n'), { a: -9007199254740991 })
  for (const s of ['a: 9007199254740993\n', 'a: 99999999999999999999\n', 'a: -9007199254740993\n']) {
    assert.throws(() => parseYamlSubset(s), (e) => e instanceof ConfigError && /超出 ±2\^53/.test(e.message), s)
  }
})

test('D4：非 ASCII 数字当字符串，不当整数（Python 会读成 3 与 12）', () => {
  assert.deepEqual(parseYamlSubset('a: ٣\n'), { a: '٣' })
  assert.deepEqual(parseYamlSubset('a: １２\n'), { a: '１２' })
  assert.deepEqual(parseYamlSubset('a: ３.５\n'), { a: '３.５' })
  assert.deepEqual(parseYamlSubset('a: 12\n'), { a: 12 })
  assert.deepEqual(parseYamlSubset('a: -0.5\n'), { a: -0.5 })
})

test('D6：BOM 开头的文件——Python 的 strip 不去 U+FEFF，所以首行成了「\\ufefftier」这个键；TS 必须同样', () => {
  const r = run(() => parseYamlSubset('\ufefftier: L1\n'))
  const want = gold.yaml.find((x) => x.input === '\ufefftier: L1\n').result
  assert.deepEqual(r, want)
})

test('splitLinesPy 与 Python 的 splitlines 一致：\\r\\n、\\r、\\v、\\f、U+001C、U+0085、U+2028 都断行；末尾换行不产生空串', () => {
  assert.deepEqual(splitLinesPy('a\nb\n'), ['a', 'b'])
  assert.deepEqual(splitLinesPy('a\r\nb\rc'), ['a', 'b', 'c'])
  assert.deepEqual(splitLinesPy('a\vb\fc\x1cd\x85e\u2028f'), ['a', 'b', 'c', 'd', 'e', 'f'])
  assert.deepEqual(splitLinesPy(''), [])
  assert.deepEqual(splitLinesPy('\n'), [''])
  assert.deepEqual(splitLinesPy('a\n\n'), ['a', ''])
})

test('parseDate：对 Python 黄金样本逐条一致；D1 的有意差异单独断言', () => {
  const D1 = new Set(['20261006']) // Python 3.12 接受紧凑型；TS 按契约拒（设计 §12.6 D1，Alan 决定）
  const wrong = []
  for (const { input, strict, result } of gold.parse_date) {
    if (D1.has(input)) continue
    const got = run(() => parseDate(input, strict).map((x) => (x === null ? null : typeof x === 'string' ? x : toIso(x))))
    if (JSON.stringify(got) !== JSON.stringify(result)) wrong.push({ input, strict, want: result, got })
  }
  assert.deepEqual(wrong, [])
  // D1 的差异**只在严格模式**（例外登记的到期，契约 §9）：非严格模式有「日期 + 任意文字」的兜底，Python 与 TS 都会取前 10 位，所以
  // 非严格下 `2026-10-06T10`、`20261006` 之类 Python 与 TS 的结论本来就相同（前者取到 2026-10-06，后者 TS 见下）。
  const STRICT_REJECT_IN_TS = ['20261006', '2026-W41-2', '2026-10-06T10']        // Python 3.12 严格模式接受，TS 拒
  for (const s of STRICT_REJECT_IN_TS) assert.equal(parseDate(s, true)[0], null, `严格模式应拒（D1）：${s}`)
  assert.notEqual(parseDate('2026-10-06T10:00:00.123456789', true)[0], null, '严格模式：标准 ISO8601 带小数秒照收')
  assert.notEqual(parseDate('2026-10-06T10:00', true)[0], null)
  assert.notEqual(parseDate('2026-10-06 10:00:00+08:00', true)[0], null, '空格分隔与偏移照收')
  assert.equal(parseDate('2026-10-06T25:00:00', true)[0], null, '非法时刻严格拒（与 Python 同）')
  // 非严格：兜底取前 10 位，TS 与 Python 一致
  assert.equal(toIso(parseDate('20261006')[0] ?? { year: 0, month: 0, day: 0 }), '0000-00-00', '紧凑型在非严格下也拒：前 10 位不是 YYYY-MM-DD 形状，Python 靠 fromisoformat 接受，TS 不接受（D1）')
  assert.equal(toIso(parseDate('2026-10-06T10')[0]), '2026-10-06', '非严格兜底：取前 10 位')
})
