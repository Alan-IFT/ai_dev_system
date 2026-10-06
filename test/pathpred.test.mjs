// core/fs 的 isFile / isDir：对 Python 的 os.path.isfile / isdir 逐条一致（golden/unit/pathpred.json，夹具上 196 种路径写法）。
// 样本在 Windows 上生成；同一份脚本在 Linux 上的结论有 85 条不同（`f.md.`、`d\`、`f.md ` 这类写法两个平台的文件系统语义本来就不同），
// 所以样本只在生成它的平台上比整份；其余平台只比「与平台无关」的核心写法（无后缀、尾斜杠、不存在、符号链接）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { isFile, isDir, lexists, exists } from '../lib/core/fs.js'

const here = dirname(fileURLToPath(import.meta.url))
const gold = JSON.parse(readFileSync(join(here, '..', 'golden', 'unit', 'pathpred.json'), 'utf8'))

const FILES = ['f.md', 'empty.md', 'a b.md', '中文.md', 'sub/g.md'], DIRS = ['d', 'd2/inner']
let tmp, linked = false
test.before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tspp-'))
  for (const f of FILES) { mkdirSync(dirname(join(tmp, f)), { recursive: true }); writeFileSync(join(tmp, f), f === 'empty.md' ? '' : 'x\n') }
  for (const d of DIRS) mkdirSync(join(tmp, d), { recursive: true })
  try {
    symlinkSync(join(tmp, 'f.md'), join(tmp, 'ln_file'), 'file'); symlinkSync(join(tmp, 'd'), join(tmp, 'ln_dir'), 'junction'); symlinkSync(join(tmp, 'no-such'), join(tmp, 'ln_dangling'), 'file')
    linked = true
  } catch { /* 造不出符号链接：对应样本跳过 */ }
})
test.after(() => rmSync(tmp, { recursive: true, force: true }))

const at = (rel) => (rel.includes('\\') ? join(tmp, rel) : join(tmp, ...rel.split('/')))
/** 路径末尾带分隔符时 `join` 会吃掉它——要原样拼，才是在测「带尾斜杠的路径」。 */
const raw = (rel) => tmp + '/' + rel

test('样本规模', () => assert.ok(gold.cases.length >= 190 && gold.cases.some((c) => c.isfile) && gold.cases.some((c) => c.isdir)))

test('isFile / isDir：在生成样本的平台上对 Python 整份逐条一致', { skip: process.platform === gold.platform ? false : `样本是在 ${gold.platform} 上生成的，本平台是 ${process.platform}` }, () => {
  const wrong = []
  for (const c of gold.cases) {
    if (!linked && /^ln_/.test(c.rel)) continue
    // D15：Windows 上 Python 按 Win32 规则去掉路径名末尾的空格与点（`f.md ` 读到 f.md），Node 不做；Linux 上 Python 同样认为它们不存在。不复现，见下一条断言
    if (WIN32_TRAILING.test(c.rel) && (c.isfile || c.isdir)) continue
    const p = raw(c.rel)
    const got = { isfile: isFile(p), isdir: isDir(p) }
    if (got.isfile !== c.isfile || got.isdir !== c.isdir) wrong.push({ rel: c.rel, want: [c.isfile, c.isdir], got: [got.isfile, got.isdir] })
  }
  assert.deepEqual(wrong.slice(0, 12), [], `不一致共 ${wrong.length} 条`)
})

/** 路径名（不是目录分隔符之后的 `.`/`..` 段）末尾的空格或点。 */
const WIN32_TRAILING = /[^/\\][ .]$/

test('D15：名字末尾的空格与点不去掉——`f.md ` 与 `f.md.` 是另外两个名字，不存在即「不是文件」（与 Linux 上的 Python 一致）；真实仓配置里没有这样的值', () => {
  for (const n of ['f.md ', 'f.md.', 'f.md  ', 'd ', 'd.']) { assert.equal(isFile(raw(n)), false, JSON.stringify(n)); assert.equal(isDir(raw(n)), false, JSON.stringify(n)) }
  const winOnly = gold.cases.filter((c) => WIN32_TRAILING.test(c.rel) && (c.isfile || c.isdir)).length
  assert.ok(gold.platform !== 'win32' || winOnly >= 20, '样本里记着 Windows 上 Python 的这条偶然行为（供查证，不据以断言 TS）')
})

test('平台无关的核心：普通文件 → isFile；目录 → isDir；不存在 → 都不是；文件带尾斜杠 → 不是文件（Python 为 False，Node 的 statSync 为 True）', () => {
  for (const f of FILES) {
    assert.equal(isFile(at(f)), true, f); assert.equal(isDir(at(f)), false, f)
    assert.equal(isFile(raw(f) + '/'), false, f + '/（变异：不判尾斜杠）')
    assert.equal(isFile(raw(f) + '//'), false, f + '//')
  }
  for (const d of DIRS) { assert.equal(isDir(at(d)), true, d); assert.equal(isFile(at(d)), false, d); assert.equal(isDir(raw(d) + '/'), true, d + '/（目录带尾斜杠仍是目录）') }
  for (const n of ['nope', 'nope/deeper', 'F.md.no']) { assert.equal(isFile(at(n)), false, n); assert.equal(isDir(at(n)), false, n) }
})

test('符号链接：到文件 → isFile；到目录 → isDir；断链 → 都不是', { skip: linked ? false : '本机造不出符号链接' }, () => {
  assert.deepEqual([isFile(at('ln_file')), isDir(at('ln_file'))], [true, false])
  assert.deepEqual([isFile(at('ln_dir')), isDir(at('ln_dir'))], [false, true])
  assert.deepEqual([isFile(at('ln_dangling')), isDir(at('ln_dangling'))], [false, false])
})

test('lexists：不跟随符号链接——断链也存在；不存在就是不存在；对样本里每条写法与 Python 的 lexists 一致（在生成样本的平台上）', { skip: process.platform === gold.platform ? false : '样本平台不同' }, () => {
  const wrong = []
  for (const c of gold.cases) {
    if (!linked && /^ln_/.test(c.rel)) continue
    if (WIN32_TRAILING.test(c.rel) && c.lexists) continue // D15
    if (lexists(raw(c.rel)) !== c.lexists) wrong.push({ rel: c.rel, want: c.lexists })
  }
  assert.deepEqual(wrong.slice(0, 10), [], `不一致共 ${wrong.length} 条`)
})

test('exists：对 Python 的 os.path.exists 逐条一致（在生成样本的平台上）；跟随符号链接（断链为假）；带尾分隔符的文件为假', { skip: process.platform === gold.platform ? false : '样本平台不同' }, () => {
  const wrong = []
  for (const c of gold.cases) {
    if (!linked && /^ln_/.test(c.rel)) continue
    if (WIN32_TRAILING.test(c.rel) && c.exists) continue // D15
    if (exists(raw(c.rel)) !== c.exists) wrong.push({ rel: c.rel, want: c.exists })
  }
  assert.deepEqual(wrong.slice(0, 10), [], `不一致共 ${wrong.length} 条`)
})

test('exists（平台无关）：文件与目录存在、不存在不存在、断链不存在（跟随符号链接）、文件加尾斜杠不存在（变异 E1 到 E4）', () => {
  assert.equal(exists(at('f.md')), true); assert.equal(exists(at('d')), true); assert.equal(exists(at('nope')), false)
  assert.equal(exists(raw('f.md') + '/'), false, '文件 + 尾斜杠：Python 为假')
  assert.equal(exists(raw('d') + '/'), true, '目录 + 尾斜杠：为真')
  if (linked) { assert.equal(exists(at('ln_dangling')), false, '断链：跟随链接，目标不在 → 假'); assert.equal(exists(at('ln_file')), true); assert.equal(exists(at('ln_dir')), true) }
})

test('exists：FIFO 也算存在（Python 判存在；若实现成 isFile || isDir 就会判不存在）——只在能 mkfifo 的平台上（变异 E5）', { skip: process.platform === 'win32' ? 'Windows 上没有 FIFO' : false }, () => {
  const r = spawnSync('mkfifo', [join(tmp, 'a-fifo')])
  assert.equal(r.status, 0, 'mkfifo 失败：' + r.stderr)
  assert.equal(isFile(join(tmp, 'a-fifo')), false, 'FIFO 不是常规文件'); assert.equal(isDir(join(tmp, 'a-fifo')), false)
  assert.equal(exists(join(tmp, 'a-fifo')), true, 'FIFO 存在')
  assert.equal(lexists(join(tmp, 'a-fifo')), true)
})

// 平台无关的 lexists 性质：不能放在「样本平台不同就跳过」的测试里，否则 Linux 上抓不到（Ubuntu 验证时才发现的盲区）
test('lexists（平台无关）：断链也存在、不存在就是不存在、文件与目录都存在（变异 Q11、Q12）', () => {
  if (linked) { assert.equal(lexists(at('ln_dangling')), true, '断链：lexists 为真（变异 Q11：跟随链接会变假）'); assert.equal(isFile(at('ln_dangling')), false) }
  assert.equal(lexists(at('nope')), false, '不存在 → false（变异 Q12：出错返回 true）')
  assert.equal(lexists(at('nope/deeper')), false)
  assert.equal(lexists(at('f.md')), true); assert.equal(lexists(at('d')), true)
})

test('非字符串入参按 Python 的 str() 处理（数字、null 不抛）', () => {
  assert.equal(isFile(/** @type {any} */ (null)), false); assert.equal(isDir(/** @type {any} */ (undefined)), false); assert.equal(isFile(/** @type {any} */ (5)), false)
})
