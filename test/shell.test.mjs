// core/shell 的单元测试：对着 Python 版的黄金样本（golden/unit/stdlib-shell.json）逐条比对。
// 异常的类名与消息进 finding 的 reason：Python 与 JS 的异常体系不同，OSError 家族按 errno 映射、本模块的拒读类按各自名字，其它 Python 内置异常（KeyError 等）
// 在 TS 里没有对应物（设计 §12.6 D14）——这部分只比**结构**（id、status、where、kind），不比 reason 里的类名。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { undeterminedFromException, runGuarded, probe, probeCrashed, unreadable, once, outsideRoot, workRootAbsent, agg, excTypeName } from '../lib/core/shell.js'
import { finding, PASS, FAIL, UNDETERMINED, SKIP } from '../lib/core/finding.js'
import { OutsideRoot, TooLarge, NotRegular } from '../lib/core/fs.js'
import { ConfigError } from '../lib/core/yaml.js'

const here = dirname(fileURLToPath(import.meta.url))
const gold = JSON.parse(readFileSync(join(here, 'fixtures', 'stdlib-shell.json'), 'utf8'))

const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))
const run = (fn) => { try { const v = fn(); return { ok: v } } catch (e) { return { raised: e.name, message: e.message } } }

class Boom extends Error { constructor(m) { super(m); this.name = 'Boom' } }
const errno = (code, msg) => { const e = new Error(msg); e.code = code; return e }
/** 黄金样本里的异常 → TS 里对应的异常。OSError 家族用 errno 的 code；本模块拒读类用它们自己的类。 */
const EXC = {
  filenotfound: () => errno('ENOENT', 'No such file or directory'), permission: () => errno('EACCES', 'Permission denied'), isadir: () => errno('EISDIR', 'Is a directory'),
  notadir: () => errno('ENOTDIR', 'Not a directory'), oserror: () => errno('EIO', 'I/O error'), plain_oserror_msg: () => errno('EIO', '自定义消息'),
  outside_root: () => new OutsideRoot('x 的真实位置在被扫项目之外'), too_large: () => new TooLarge('x 超过上限'), not_regular: () => new NotRegular('x 不是常规文件'),
  config_error: () => new ConfigError('第 3 行不对'), custom: () => new Boom('炸了'), custom_empty: () => new Boom(''),
}
// Python 的 KeyError/ValueError/TypeError/ZeroDivisionError/RuntimeError/RecursionError：TS 里没有同名物，只比结构
const STRUCTURE_ONLY = new Set(['value_error', 'key_error', 'type_error', 'zero_div', 'runtime', 'recursion'])
const structure = (f) => ({ check: f.check, id: f.id, status: f.status, where: f.where, registered: f.registered, hasReason: !!f.reason })

test('黄金样本规模：各部分不为空', () => {
  assert.ok(gold.exc.length >= 18 && gold.probe.length >= 10 && gold.run_guarded.length >= 15 && gold.agg.length >= 8 && gold.work_root_absent.length >= 8)
})

test('undeterminedFromException / unreadable / probeCrashed：对 Python 逐条一致（类名可映射的比整条，其余只比结构）', () => {
  const wrong = []
  for (const g of gold.exc) {
    const mk = EXC[g.name]
    if (STRUCTURE_ONLY.has(g.name)) {
      const e = g.name === 'value_error' ? new RangeError('bad') : g.name === 'key_error' ? new TypeError('k') : new Error('x')
      const got = undeterminedFromException('chk', e, '读东西')
      if (!same(structure(got), structure(g.undetermined.ok))) wrong.push({ name: g.name, what: 'undetermined 结构' })
      continue
    }
    assert.ok(mk, g.name)
    const gu = undeterminedFromException('chk', mk(), '读东西')
    const ur = unreadable('chk', 'docs/a.md', mk())
    const pc = probeCrashed('chk', '某断言', mk())
    // reason 里的 `[Errno N] strerror` 不复现（D10/D14）：把 Python 的 reason 与 TS 的 reason 都归一成「类名: 消息尾」再比类名
    const clsOf = (r) => r.split(':')[0]
    if (!same(structure(gu), structure(g.undetermined.ok))) wrong.push({ name: g.name, what: 'undetermined 结构' })
    if (clsOf(gu.reason) !== clsOf(g.undetermined.ok.reason)) wrong.push({ name: g.name, what: 'undetermined 类名', want: g.undetermined.ok.reason, got: gu.reason })
    if (ur.id !== g.unreadable.ok.id || ur.status !== g.unreadable.ok.status || ur.where !== g.unreadable.ok.where) wrong.push({ name: g.name, what: 'unreadable', want: g.unreadable.ok, got: ur })
    if (ur.title !== g.unreadable.ok.title) wrong.push({ name: g.name, what: 'unreadable 标题含类名', want: g.unreadable.ok.title, got: ur.title })
    if (pc.status !== g.probe_crashed.ok.status || pc.id !== g.probe_crashed.ok.id || pc.title !== g.probe_crashed.ok.title) wrong.push({ name: g.name, what: 'probeCrashed' })
  }
  assert.deepEqual(wrong, [])
})

test('excTypeName：errno 映射到 Python 的类名；拒读类按自己的名字；其它取 Error.name', () => {
  assert.equal(excTypeName(errno('ENOENT', 'x')), 'FileNotFoundError'); assert.equal(excTypeName(errno('EACCES', 'x')), 'PermissionError'); assert.equal(excTypeName(errno('EPERM', 'x')), 'PermissionError')
  assert.equal(excTypeName(errno('EISDIR', 'x')), 'IsADirectoryError'); assert.equal(excTypeName(errno('ENOTDIR', 'x')), 'NotADirectoryError'); assert.equal(excTypeName(errno('EMFILE', 'x')), 'OSError')
  assert.equal(excTypeName(new OutsideRoot('x')), 'OutsideRoot'); assert.equal(excTypeName(new TooLarge('x')), 'TooLarge'); assert.equal(excTypeName(new NotRegular('x')), 'NotRegular')
  assert.equal(excTypeName(new TypeError('x')), 'TypeError'); assert.equal(excTypeName(null), 'object'); assert.equal(excTypeName('str'), 'string')
})

test('probe：真值记 PASS、假值记 FAIL；证据与依据原样；对 Python 逐条一致', () => {
  // Python 的真值（空串、0、None、空列表为假）在 TS 里由调用方传 boolean——这里只验证 boolean 路径与 Python 的 bool 路径一致
  for (const g of gold.probe) {
    const ok = { 'True': true, 'False': false, '1': true, '0': false, "''": false, "'x'": true, 'None': false, '[]': false, '[1]': true }[g.ok]
    if (ok === undefined) continue // reason-given
    const got = probe('chk', ok, '断言', { evidence: 'e', why: 'w' })
    assert.deepEqual(structure(got), structure(g.out.ok), g.ok); assert.equal(got.evidence, 'e'); assert.equal(got.why, 'w')
  }
  const r = probe('chk', false, '断言', { reason: 'r' }); assert.equal(r.reason, 'r'); assert.equal(r.status, FAIL)
})

test('outsideRoot / unreadable：对 Python 逐条一致（含竖线、换行、空白、中文路径）', () => {
  const wrong = []
  for (const g of gold.outside) { const got = outsideRoot('chk', g.rel); if (!same({ ...got }, g.out.ok)) wrong.push({ rel: g.rel, what: 'outside', want: g.out.ok, got }) }
  for (const g of gold.unreadable) { const got = unreadable('chk', g.rel, errno('ENOENT', 'x')); if (got.id !== g.out.ok.id || got.title !== g.out.ok.title || got.where !== g.out.ok.where) wrong.push({ rel: g.rel, what: 'unreadable' }) }
  assert.deepEqual(wrong, [])
})

test('once：同一 id 只留第一条，保持顺序；空与单条照常；对 Python 逐条一致', () => {
  const dup = [finding('c', PASS, 'a', { kind: 'k', key: '1' }), finding('c', FAIL, 'b', { kind: 'k', key: '1' }), finding('c', PASS, 'c', { kind: 'k', key: '2' }), finding('c', PASS, 'd', { kind: 'k', key: '1' }), finding('c', PASS, 'e', { kind: 'k', key: '2' })]
  const by = new Map(gold.once.map((g) => [g.name, g.out.ok]))
  assert.deepEqual(once(dup).map((f) => f.title), by.get('dup').map((f) => f.title)); assert.deepEqual(once([]), by.get('empty')); assert.equal(once(dup.slice(0, 1)).length, by.get('single').length)
  const distinct = [PASS, FAIL, UNDETERMINED, SKIP, PASS, FAIL].map((s, i) => finding('c', s, 't' + i, { kind: 'k', key: String(i % 3), reason: s === UNDETERMINED || s === SKIP ? 'r' : '' }))
  assert.equal(once(distinct).length, by.get('distinct').length)
})

test('once 保留独占 id 的每一条，尤其是 FAIL（变异 N4：把所有 FAIL 都丢掉会让检查器「一个违规都报不出」）', () => {
  const solo = [finding('c', FAIL, 'solo', { kind: 'k', key: '9' }), finding('c', PASS, 'p', { kind: 'k', key: '8' }), finding('c', UNDETERMINED, 'u', { kind: 'k', key: '7', reason: 'r' }), finding('c', SKIP, 's', { kind: 'k', key: '6', reason: 'r' })]
  assert.deepEqual(once(solo).map((f) => [f.status, f.title]), [[FAIL, 'solo'], [PASS, 'p'], [UNDETERMINED, 'u'], [SKIP, 's']])
  // 同 id 的先 FAIL 后 PASS：留第一条（FAIL），不是「留最严重的」也不是「留最后的」
  const dup = [finding('c', FAIL, 'first', { kind: 'k', key: '1' }), finding('c', PASS, 'second', { kind: 'k', key: '1' })]
  assert.deepEqual(once(dup).map((f) => f.title), ['first'])
})

test('agg：证据最多列 12 条，超出写「另有 N 份未列出」；标题带份数；kind 必填；对 Python 逐条一致', () => {
  const wrong = []
  for (const g of gold.agg) {
    const paths = typeof g.n === 'number' ? Array.from({ length: g.n }, (_, i) => 'docs/f' + String(i).padStart(3, '0') + '.md') : ['a']
    const got = typeof g.n === 'number' ? agg('chk', UNDETERMINED, '标题', paths, '原因', '依据', 'kk') : agg('chk', PASS, '标题', paths, '', '', 'kk')
    const want = g.out.ok
    if (got.title !== want.title || got.evidence !== want.evidence || got.id !== want.id || got.status !== want.status) wrong.push({ n: g.n, want, got })
  }
  assert.deepEqual(wrong, [])
})

test('runGuarded：对 Python 逐条一致——裁剪记 SKIP（有理由取理由、没理由写固定句）；fn 抛异常转未定；正常原样', () => {
  const fine = () => [finding('c', PASS, 'ok')], boom = () => { throw new Boom('炸') }, fnf = () => { throw errno('ENOENT', 'x') }
  const cfgs = { none: {}, tailored_reason: { tailoring: [{ check: 'c', applicable: false, reason: '不适用' }] }, tailored_noreason: { tailoring: [{ check: 'c', applicable: false }] },
    tailored_other: { tailoring: [{ check: 'd', applicable: false, reason: 'r' }] }, tailored_applicable: { tailoring: [{ check: 'c', applicable: true }] } }
  const fns = { fine, boom, fnf }
  const wrong = []
  for (const g of gold.run_guarded) {
    const got = runGuarded('c', fns[g.fn], cfgs[g.cfg])
    const want = g.out.ok
    if (got.length !== want.length || got.some((f, i) => f.id !== want[i].id || f.status !== want[i].status || f.title !== want[i].title || (f.reason.split(':')[0] !== want[i].reason.split(':')[0]))) wrong.push({ cfg: g.cfg, fn: g.fn, want, got: got.map((f) => ({ id: f.id, status: f.status, title: f.title, reason: f.reason })) })
  }
  assert.deepEqual(wrong, [])
})

test('runGuarded：fn 抛**任何**东西（含非 Error 的字符串、null）都转未定，不向外抛、不当通过', () => {
  for (const thrown of ['字符串', null, 42, undefined, { a: 1 }, new RangeError('r')]) {
    const out = runGuarded('c', () => { throw thrown }, {})
    assert.equal(out.length, 1); assert.equal(out[0].status, UNDETERMINED); assert.equal(out[0].id, 'c/internal-error'); assert.ok(out[0].reason.length > 0, JSON.stringify(thrown))
  }
})

function canSymlink() {
  const t = mkdtempSync(join(tmpdir(), 'tssh-sl-'))
  try { writeFileSync(join(t, 'a'), 'x'); symlinkSync(join(t, 'a'), join(t, 'b'), 'file'); return true } catch { return false } finally { rmSync(t, { recursive: true, force: true }) }
}

test('workRootAbsent：目录在返回 null；不在、是文件、改基后不在、出仓链接都记 SKIP；对 Python 逐条一致', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tssh-'))
  try {
    mkdirSync(join(tmp, 'docs', 'state', 'work'), { recursive: true }); mkdirSync(join(tmp, 'w')); writeFileSync(join(tmp, 'f.txt'), 'x')
    const cases = { default_present: {}, declared_present: { layout: { work_root: 'w' } }, declared_absent: { layout: { work_root: 'nope' } }, docs_root_rebase_absent: { layout: { docs_root: 'manual' } },
      declared_backslash: { layout: { work_root: 'w\\' } }, declared_spaces: { layout: { work_root: ' w ' } }, declared_is_file: { layout: { work_root: 'f.txt' } } }
    const wrong = []
    for (const g of gold.work_root_absent) {
      if (g.name === 'declared_symlink_out') continue
      const got = workRootAbsent('c', { ...cases[g.name], _root: tmp }); const want = g.out.ok
      if (want === null ? got !== null : (got === null || got.id !== want.id || got.title !== want.title || got.evidence !== want.evidence || got.status !== want.status)) wrong.push({ name: g.name, want, got })
    }
    assert.deepEqual(wrong, [])
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('workRootAbsent：配置值先把 \\ 换成 / 再去首尾 Python 空白——只在 Windows 上 `w\\sub` 才等于目录 w/sub；U+FEFF 不是 Python 空白，不被去掉（变异 W3、W5）', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tssh-'))
  try {
    mkdirSync(join(tmp, 'w', 'sub'), { recursive: true })
    // W3：嵌套路径 `w\sub`。Windows 上 `\` 换成 `/` 后是 w/sub（存在）；POSIX 上 Python 与 TS 都先换成 `/`，所以同样是 w/sub——换不换会改变结果
    assert.equal(workRootAbsent('c', { _root: tmp, layout: { work_root: 'w\\sub' } }), null, '先把 \\ 换成 /：w\\sub 即 w/sub，目录在')
    // W5：U+FEFF 夹在名字里。Python 的 strip 不认它是空白：`\ufeffw` 保持原样，目录 \ufeffw 不存在 → SKIP；用 trim 的话会被去掉变成 w（存在）→ null
    const got = workRootAbsent('c', { _root: tmp, layout: { work_root: '\ufeffw' } })
    assert.ok(got !== null, 'U+FEFF 不是 Python 空白：不去掉，所以目录 `\\ufeffw` 不存在，要记 SKIP')
    assert.equal(workRootAbsent('c', { _root: tmp, layout: { work_root: '\u3000w\u3000' } }), null, '全角空格是 Python 空白：去掉后是 w，目录在')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('workRootAbsent：work_root 是指向仓外的目录符号链接时也记 SKIP（由 layout 记未定），不探测仓外', { skip: canSymlink() ? false : '本机造不出符号链接' }, () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tssh-')), out = mkdtempSync(join(tmpdir(), 'tssh-out-'))
  try {
    symlinkSync(out, join(tmp, 'linkdir'), process.platform === 'win32' ? 'junction' : 'dir')
    const got = workRootAbsent('c', { _root: tmp, layout: { work_root: 'linkdir' } })
    assert.ok(got); assert.equal(got.status, SKIP); assert.equal(got.id, 'c/work-root-absent')
  } finally { rmSync(tmp, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }) }
})
