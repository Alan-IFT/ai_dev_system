// core/fs 的单元测试：在临时目录里按**同一份夹具清单**建夹具，对着 Python 版的黄金样本（golden/unit/stdlib-fs.json）逐条比对。
// 夹具清单（FILES）与 golden/make_unit_fs.py 里那张表一一对应；测试开头核对条数与每个夹具的字节数，防止两边悄悄漂移。
// 设计 §12.6 D7：Python 在 Windows 上对目录抛 PermissionError、POSIX 上抛 NotRegular；TS 统一 NotRegular——比对时两者都归一成「OSError 类的拒读」。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, openSync, ftruncateSync, closeSync, readFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readBytes, readText, countLines, inside, guard, MAX_READ_BYTES, OutsideRoot, TooLarge, NotRegular, __testHooks as __hooks } from '../lib/core/fs.js'

const here = dirname(fileURLToPath(import.meta.url))
const gold = JSON.parse(readFileSync(join(here, '..', 'golden', 'unit', 'stdlib-fs.json'), 'utf8'))

const B = (...a) => Buffer.from(a)
const FILES = [
  ['a.txt', Buffer.from('hello')], ['empty.txt', Buffer.alloc(0)], ['nl.txt', Buffer.from('\n')], ['nonl.txt', Buffer.from('a')],
  ['two.txt', Buffer.from('a\nb\n')], ['crlf_nonl.txt', Buffer.from('a\r\nb')], ['bom_crlf.txt', Buffer.concat([B(0xef, 0xbb, 0xbf), Buffer.from('a\r\nb\rc\n')])],
  ['bom_only.txt', B(0xef, 0xbb, 0xbf)], ['double_bom.txt', Buffer.concat([B(0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf), Buffer.from('x')])],
  ['bad_ff.txt', B(0x61, 0xff, 0x62)], ['bad_trunc2.txt', B(0xe4, 0xb8)], ['bad_trunc3.txt', B(0xf0, 0x9f, 0x98, 0x78)], ['bad_overlong.txt', B(0xc0, 0x80)],
  ['bad_surrogate.txt', B(0xed, 0xa0, 0x80)], ['bad_fffe.txt', B(0xff, 0xfe)], ['bad_after_bom.txt', B(0xef, 0xbb, 0xbf, 0x61, 0xff, 0x62)],
  ['utf8_ok.txt', Buffer.from('中文😀 ok\n', 'utf8')],
]

let base, proj, outDir, canLink = true
const P = (n) => join(proj, n)

test.before(() => {
  base = mkdtempSync(join(tmpdir(), 'tsfs-'))
  proj = join(base, 'proj'); outDir = join(base, 'outside')
  mkdirSync(proj); mkdirSync(outDir)
  for (const [n, data] of FILES) writeFileSync(P(n), data)
  mkdirSync(P('d'))
  const sparse = (name, size) => { const fd = openSync(P(name), 'w'); ftruncateSync(fd, size); closeSync(fd) }
  sparse('big_sparse.bin', MAX_READ_BYTES + 1); sparse('exact_max.bin', MAX_READ_BYTES)
  writeFileSync(P('big_lines.txt'), Buffer.from('x\n'.repeat(Math.floor(MAX_READ_BYTES / 2) + 100)))
  writeFileSync(join(outDir, 'secret.txt'), 'TOPSECRET')
  try {
    symlinkSync(join(outDir, 'secret.txt'), P('ln_out.txt'), 'file')
    symlinkSync(P('a.txt'), P('ln_in.txt'), 'file')
    symlinkSync(outDir, P('dir_out'), 'junction')
  } catch { canLink = false }
})
test.after(() => { rmSync(base, { recursive: true, force: true }) })

const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))
const run = (fn) => { try { return { ok: fn() } } catch (e) { return { raised: e.name } } }
const hexed = (b) => ({ len: b.length, hex: Buffer.from(b).subarray(0, 64).toString('hex') })
/** D7：目录在 Python/Windows 上是 PermissionError，在 POSIX 上是 NotRegular，TS 统一 NotRegular——三者都是「拒读」。 */
const norm = (r) => ('raised' in r && (r.raised === 'PermissionError' || r.raised === 'NotRegular' || r.raised === 'IsADirectoryError') ? { raised: 'REFUSED_NOT_FILE' } : r)
/** Python 的 FileNotFoundError 在 Node 里是 ENOENT 的 Error，名字是 'Error'。 */
const normNode = (r) => ('raised' in r && r.raised === 'Error' ? { raised: 'FileNotFoundError' } : r)

const names = () => [...FILES.map(([n]) => n), 'd', 'nope', 'big_sparse.bin', 'big_lines.txt', 'exact_max.bin', ...(canLink ? ['ln_out.txt', 'ln_in.txt', 'dir_out/secret.txt'] : [])]

test('夹具清单与黄金样本一致（条数与每个夹具的字节数）', () => {
  assert.equal(FILES.length, 17)
  for (const [n, data] of FILES) {
    const g = gold.read_bytes[n]
    assert.ok(g && 'ok' in g, n)
    // head 之外读全：黄金样本里记的是完整字节的 hex（≤64 字节）与长度
    assert.equal(g.ok.len, data.length, `${n} 长度`)
    assert.equal(g.ok.hex, data.subarray(0, 64).toString('hex'), `${n} 内容`)
  }
  assert.equal(gold._max_read_bytes, MAX_READ_BYTES)
})

test('readBytes 对黄金样本逐条一致', () => {
  const wrong = []
  for (const n of names()) {
    const got = normNode(norm(run(() => hexed(readBytes(P(n), proj)))))
    const want = norm(gold.read_bytes[n])
    if (!same(got, want)) wrong.push({ n, want, got })
  }
  assert.deepEqual(wrong, [])
})

test('readBytes(head=4) 对黄金样本逐条一致：只读头部时超限文件照读', () => {
  const wrong = []
  for (const n of names()) {
    const got = normNode(norm(run(() => hexed(readBytes(P(n), proj, 4)))))
    const want = norm(gold.read_bytes_head4[n])
    if (!same(got, want)) wrong.push({ n, want, got })
  }
  assert.deepEqual(wrong, [])
})

test('readText 对黄金样本逐条一致（BOM 只去一个、非法序列替换、行尾归一）', () => {
  const wrong = []
  for (const n of names()) {
    const got = normNode(norm(run(() => { const t = readText(P(n), proj); return t.length < 5000 ? t.slice(0, 200) : { len: t.length } })))
    const want = norm(gold.read_text[n])
    if (!same(got, want)) wrong.push({ n, want, got })
  }
  assert.deepEqual(wrong, [])
})

test('readText(head=5) 对黄金样本逐条一致', () => {
  const wrong = []
  for (const n of names()) {
    const got = normNode(norm(run(() => readText(P(n), proj, 5))))
    const want = norm(gold.read_text_head5[n])
    if (!same(got, want)) wrong.push({ n, want, got })
  }
  assert.deepEqual(wrong, [])
})

test('countLines 对黄金样本逐条一致（超限文件数前 MAX 字节得到下界）', () => {
  const wrong = []
  for (const n of names()) {
    const got = normNode(norm(run(() => countLines(P(n), proj))))
    const want = norm(gold.count_lines[n])
    if (!same(got, want)) wrong.push({ n, want, got })
  }
  assert.deepEqual(wrong, [])
})

test('inside / guard 对黄金样本逐条一致：字面出仓不碰文件系统，符号链接出仓判不在', () => {
  const wrong = []
  const literal = { '../x': join(proj, '..', 'x'), outside_abs: join(outDir, 'secret.txt'), proj_itself: proj, inner_missing: P('nope/deeper') }
  for (const [k, p] of Object.entries(literal)) {
    const got = run(() => inside(proj, p)), want = gold.inside[k]
    if (!same(got, want)) wrong.push({ k, want, got })
    const g2 = run(() => { guard(proj, p); return true }), w2 = gold.guard[k]
    const w2n = 'ok' in w2 ? w2 : { raised: w2.raised }
    if (!same(g2, w2n)) wrong.push({ guard: k, want: w2n, got: g2 })
  }
  for (const n of names()) {
    const got = run(() => inside(proj, P(n))), want = gold.inside[n]
    if (!same(got, want)) wrong.push({ n, want, got })
    const g2 = run(() => { guard(proj, P(n)); return true }), w2 = gold.guard[n]
    if (!same(g2, w2)) wrong.push({ guard: n, want: w2, got: g2 })
  }
  assert.deepEqual(wrong, [])
})

test('readBytes 字面出仓的路径：抛 OutsideRoot，且**不碰文件系统**（对一个不存在的仓外路径也是 OutsideRoot 而不是 ENOENT）', () => {
  const r = run(() => readBytes(join(proj, '..', 'does-not-exist-anywhere'), proj))
  assert.deepEqual(r, { raised: 'OutsideRoot' })
  assert.deepEqual(norm(run(() => hexed(readBytes(P('nope'), proj)))).raised ?? 'ok', 'Error', '仓内不存在的路径是 ENOENT（Python 的 FileNotFoundError），不是 OutsideRoot')
})

test('没给 root：不做仓内判定，只读常规文件', () => {
  assert.deepEqual(hexed(readBytes(P('a.txt'))), gold.read_bytes_noroot['a.txt'].ok)
  assert.equal(norm(run(() => readBytes(P('d')))).raised, 'REFUSED_NOT_FILE')
  assert.equal(normNode(run(() => readBytes(P('nope')))).raised, 'FileNotFoundError')
})

test('符号链接指向仓外：不读、不回显仓外内容（错误信息里没有 TOPSECRET）', { skip: canLink ? false : '本机造不出符号链接（Windows 需要权限）' }, () => {
  try { readBytes(P('ln_out.txt'), proj); assert.fail('不该读到') } catch (e) {
    assert.ok(e instanceof OutsideRoot); assert.ok(!String(e.message).includes('TOPSECRET'))
  }
})

// Python 版用 monkeypatch os.open 在「护栏放行之后、打开之前」把中间目录换成出仓链接。TS 的 ESM 命名空间不可被改写，所以 readBytes 提供一个
// **仅测试用**的钩子 `__testHooks.beforeOpen`：在 realpath 与 openSync 之间调用。生产路径里它恒为 undefined，不影响行为。
test('护栏之后路径被换出仓：打开后复核拦下（OutsideRoot），不读仓外内容', { skip: canLink ? false : '本机造不出符号链接（Windows 需要权限）' }, async () => {
  const { __testHooks } = await import('../lib/core/fs.js')
  const inner = join(proj, 'swap'), outer = join(outDir, 'swap')
  mkdirSync(inner); mkdirSync(outer)
  writeFileSync(join(inner, 'a.md'), 'inside\n'); writeFileSync(join(outer, 'a.md'), 'TOPSECRET\n')
  let swapped = false
  __testHooks.beforeOpen = () => {
    if (swapped) return
    swapped = true
    renameSync(inner, inner + '.bak')
    symlinkSync(outer, inner, process.platform === 'win32' ? 'junction' : 'dir')
  }
  try {
    const r = run(() => hexed(readBytes(join(inner, 'a.md'), proj)))
    assert.ok(swapped, '钩子应当被调用（否则这条测试什么都没验证）')
    assert.deepEqual(r, { raised: 'OutsideRoot' }, '换位后必须被拦：' + JSON.stringify(r))
  } finally { __testHooks.beforeOpen = undefined }
})

test('under 是「整段」前缀：root=/x/ab 不含兄弟目录 /x/abc（变异 S20：退化成纯字符串前缀）', () => {
  const sib = join(base, 'projx')                       // 名字以 proj 为前缀的兄弟目录
  mkdirSync(sib); writeFileSync(join(sib, 'x.txt'), 'SIB')
  assert.equal(inside(proj, join(sib, 'x.txt')), false)
  assert.deepEqual(run(() => readBytes(join(sib, 'x.txt'), proj)), { raised: 'OutsideRoot' })
  assert.equal(inside(proj, proj), true)
})

test('读超过一次 readSync 能返回的量：循环读到底，不把短读当成全部（变异 S21）', () => {
  const size = 300000                                    // 远大于管道/一次系统调用常见的 64KB
  const data = Buffer.alloc(size); for (let i = 0; i < size; i++) data[i] = i % 251
  writeFileSync(P('mid.bin'), data)
  const got = readBytes(P('mid.bin'), proj)
  assert.equal(got.length, size); assert.ok(got.equals(data))
  assert.equal(readBytes(P('mid.bin'), proj, 100000).length, 100000)
})

test('fd 已打开、核对之前文件被换成另一个：realpath 不变，但 dev/ino 变了——只有核对 dev/ino 才拦得下（变异 S4）', () => {
  const dir = join(proj, 'flip'); mkdirSync(dir)
  const f = join(dir, 'a.md'); writeFileSync(f, 'v1\n')
  let n = 0
  __hooks.afterOpen = () => {
    if (n++) return
    renameSync(f, f + '.old'); writeFileSync(f, 'v2-different-file\n')   // 路径与 realpath 都不变，inode 变了
  }
  try {
    const r = run(() => hexed(readBytes(f, proj)))
    assert.ok(n > 0, '钩子应当被调用（否则这条测试什么都没验证）')
    assert.deepEqual(r, { raised: 'OutsideRoot' }, '换位后必须拦下：' + JSON.stringify(r))
  } finally { __hooks.afterOpen = undefined }
})

test('读取错误类型各自独立：TooLarge / NotRegular / OutsideRoot 互不是子类', () => {
  assert.ok(!(new TooLarge('x') instanceof OutsideRoot)); assert.ok(!(new NotRegular('x') instanceof TooLarge))
  assert.equal(new OutsideRoot('x').code, 'OUTSIDE_ROOT'); assert.equal(new TooLarge('x').code, 'TOO_LARGE'); assert.equal(new NotRegular('x').code, 'NOT_REGULAR')
})
