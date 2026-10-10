// links 检查器的纯函数对 Python 版黄金样本（golden/unit/links.json）逐条比对：maskCode、slug、atxTitle、titles、anchorsOf、链接正则、scheme 判断、行号后缀、盘符、unquote。
// 这里是 Python `re` 与 JS 差异最集中的地方（\w、\s、re.M、re.I、unquote 对非法 UTF-8 的处理），输入给得最密。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { maskCode, slug, atxTitle, titles, anchorsOf, unquote, _regexForTest } from '../lib/checks/links.js'
import { ANCHORS, ATX, LINKS, MASK, SKIP, SLUG, SPACESET, SUFFIX, TITLES, UNQUOTE, WINABS, WORDSET_COUNT, LN_MINUS_W, W_MINUS_LN } from './cases/links.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const gold = { anchors: ANCHORS, atx: ATX, links: LINKS, mask: MASK, skip: SKIP, slug: SLUG, spaceset: SPACESET, suffix: SUFFIX, titles: TITLES, unquote: UNQUOTE, winabs: WINABS, wordset_count: WORDSET_COUNT, LN_minus_w: LN_MINUS_W, w_minus_LN: W_MINUS_LN }
const cmp = (a, b) => JSON.stringify(a) === JSON.stringify(b)

test('样本规模', () => assert.ok(gold.slug.length >= 250 && gold.mask.length >= 40 && gold.titles.length >= 50 && gold.links.length >= 80 && gold.unquote.length >= 80))

test('slug：全部标题 × 两种下划线模式对 Python 逐条一致（Unicode 字母数字、强调标记、链接取文字、去 HTML、全角标点、空白折叠）', () => {
  const wrong = gold.slug.filter((g) => slug(g.in, g.keep) !== g.out).map((g) => ({ in: g.in, keep: g.keep, want: g.out, got: slug(g.in, g.keep) }))
  assert.deepEqual(wrong.slice(0, 6), [], `不一致共 ${wrong.length} 条`)
})

test('maskCode：围栏、波浪围栏、行内代码涂白，换行与列位置不变（对 Python 逐条一致）', () => {
  const wrong = gold.mask.filter((g) => maskCode(g.in) !== g.out).map((g) => ({ in: g.in, want: g.out, got: maskCode(g.in) }))
  assert.deepEqual(wrong.slice(0, 4), [], `不一致共 ${wrong.length} 条`)
  for (const g of gold.mask) assert.equal(maskCode(g.in).length, g.in.length, '涂白不改长度：' + JSON.stringify(g.in))
})

test('atxTitle：收尾的 # 串（前面须有空白或整行只有 #）与首尾空白（对 Python 逐条一致）', () => {
  const wrong = gold.atx.filter((g) => atxTitle(g.in) !== g.out).map((g) => ({ in: g.in, want: g.out, got: atxTitle(g.in) }))
  assert.deepEqual(wrong, [])
})

test('titles：ATX 与 setext 两种标题、缩进代码块不算 setext 正文、涂白后的文本（对 Python 逐条一致）', () => {
  const wrong = gold.titles.filter((g) => !cmp(titles(maskCode(g.in)), g.out)).map((g) => ({ in: g.in, want: g.out, got: titles(maskCode(g.in)) }))
  assert.deepEqual(wrong.slice(0, 4), [], `不一致共 ${wrong.length} 条`)
})

test('anchorsOf：显式 <a id/name> 加标题生成（两种下划线模式）、重复标题加 -N 后缀（对 Python 逐条一致）', () => {
  const wrong = gold.anchors.filter((g) => !cmp([...anchorsOf(g.in)].sort(), g.out)).map((g) => ({ in: g.in.slice(0, 40), want: g.out, got: [...anchorsOf(g.in)].sort() }))
  assert.deepEqual(wrong.slice(0, 4), [], `不一致共 ${wrong.length} 条`)
})

test('链接正则：全部行对 Python 的 `_LINK_RE.findall` 逐条一致（<> 包裹、可选 title、嵌套方括号、含空格与圆括号、超长输入不爆炸）', () => {
  const { LINK_RE } = _regexForTest
  const found = (s) => [...s.matchAll(LINK_RE)].map((m) => [m[1] ?? '', m[2] ?? ''])
  const wrong = gold.links.filter((g) => !cmp(found(g.in), g.out)).map((g) => ({ in: g.in.slice(0, 50), want: g.out, got: found(g.in) }))
  assert.deepEqual(wrong.slice(0, 6), [], `不一致共 ${wrong.length} 条`)
  const t0 = Date.now(); for (const g of gold.links.filter((x) => x.in.length > 250)) found(g.in); assert.ok(Date.now() - t0 < 2000, '超长输入线性')
})

test('scheme 判断、行号后缀、盘符：对 Python 逐条一致（`a.py:12` 是本地路径加行号不是 scheme；tel:、sms: 照跳过；全角数字不是行号）', () => {
  const { SKIP_SCHEME_RE, LINE_SUFFIX_RE, WIN_ABS_RE } = _regexForTest
  const w1 = gold.skip.filter((g) => SKIP_SCHEME_RE.test(g.in) !== g.skip).map((g) => g.in)
  const w2 = gold.suffix.filter((g) => g.in.replace(LINE_SUFFIX_RE, '') !== g.out).map((g) => g.in)
  const w3 = gold.winabs.filter((g) => WIN_ABS_RE.test(g.in) !== g.abs).map((g) => g.in)
  assert.deepEqual({ w1, w2, w3 }, { w1: [], w2: [], w3: [] })
})

test('unquote：全部输入对 Python 的 urllib.parse.unquote 逐条一致（非法 UTF-8 用 U+FFFD、残缺 % 序列保留、不处理 +、`%` 后的全角数字不算十六进制）', () => {
  const wrong = gold.unquote.filter((g) => unquote(g.in) !== g.out).map((g) => ({ in: g.in, want: g.out, got: unquote(g.in) }))
  assert.deepEqual(wrong.slice(0, 6), [], `不一致共 ${wrong.length} 条`)
})

// ---- 变异验证第一轮没抓住的盲区（期望值取自 Python 版实测）----
test('maskCode：两个围栏**之间**的正文不被涂白（围栏是非贪婪的，各配各的）；波浪围栏同理；行内代码不跨行（变异 M5、M6）', () => {
  const t = '```\na\n```\n[x](gone.md)\n```\nb\n```\n'
  assert.equal(maskCode(t), '   \n \n   \n[x](gone.md)\n   \n \n   \n', '中间那条链接留着，两侧围栏各自涂白')
  const w = '~~~\na\n~~~\n[y](gone.md)\n~~~\nb\n~~~\n'
  assert.ok(maskCode(w).includes('[y](gone.md)'), '波浪围栏之间的链接也留着')
  assert.equal(maskCode('`a\nb` [z](gone.md)'), '`a\nb` [z](gone.md)', '行内代码不跨行：开头的 ` 与下一行的 ` 不配对')
})

test('scheme：Kelvin 符号 K（U+212A）开头也是 scheme（re.I 折叠）；不锚定开头的写法会把 `dir/ab:c.md` 里的 `ab:` 误当 scheme（变异 S8、S12）', () => {
  const { SKIP_SCHEME_RE } = _regexForTest
  assert.equal(SKIP_SCHEME_RE.test('\u212aa:b'), true); assert.equal(SKIP_SCHEME_RE.test('dir/ab:c.md'), false); assert.equal(SKIP_SCHEME_RE.test('x ab:c'), false)
})

test('atxTitle：收尾 # 前是全角空格 U+3000 时不算「前面有空白」（先去的只是空格与制表符）（变异 A9）', () => {
  assert.equal(atxTitle('x #\u3000'), 'x #'); assert.equal(atxTitle('x\u3000#'), 'x\u3000#')
})

test('titles：setext 与 ATX 识别后都要清掉 prev，否则同一行被当两次标题（变异 T8、T9）', () => {
  const T = (s) => titles(maskCode(s))
  assert.deepEqual(T('a\n---\n---'), ['a']); assert.deepEqual(T('a\n===\n==='), ['a'])
  assert.deepEqual(T('a\n# H\n---'), ['H']); assert.deepEqual(T('# H\n---'), ['H']); assert.deepEqual(T('a\n---\n# B\n---'), ['a', 'B'])
})

test('unquote：`+` 不当空格（含 % 的串里也一样）；非 BMP 字符不被按码元拆开（变异 U9、U10）', () => {
  assert.equal(unquote('a+b%41'), 'a+bA'); assert.equal(unquote('+%2B'), '++'); assert.equal(unquote('%41+%42'), 'A+B')
  assert.equal(unquote('\u{1F600}%41'), '\u{1F600}A'); assert.equal(unquote('\u{1F600}%e4%b8%ad'), '\u{1F600}中')
})

test('\\w 的差异只在 Unicode 版本：Python 的 \\w 与 `\\p{L}\\p{N}_` 在**同一 Unicode 版本**下完全相同（差集为空）；Node 的 Unicode 更新，多认的全是 Python 的 Unicode 15.0 里未分配的码点（设计 §12.6 D5）', () => {
  assert.equal(gold.w_minus_LN.length, 0, 'Python 认、`\\p{L}\\p{N}_` 不认的：必须为空')
  assert.equal(gold.LN_minus_w.length, 0, '`\\p{L}\\p{N}_` 认、Python 不认的（同版本内）：必须为空')
  const re = /[\p{L}\p{N}_]/u; let js = 0
  for (let cp = 0; cp < 0x110000; cp++) { if (cp >= 0xD800 && cp <= 0xDFFF) continue; if (re.test(String.fromCodePoint(cp))) js++ }
  assert.ok(js >= gold.wordset_count, 'Node 的 Unicode 不低于 Python 的')
  assert.ok(js - gold.wordset_count < 20000, '差值只来自新版本新增的字符，量级固定（9661）；若暴涨说明规则变了')
})
