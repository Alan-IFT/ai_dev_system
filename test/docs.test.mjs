// core/docs 的单元测试：对着 test/cases/docs-cases.mjs 里的行为规格（各函数在各输入上应有的返回值）逐条比对。
// 规格最初取自 Python 版 stdlib 的实测，Python 版已删除；用例表按行为类别分组，期望值今后手工维护。
// find_field 的正则依赖 Python re 的语义（Unicode 大小写折叠、空白集合、回看、行首），是最容易在 JS 里悄悄不同的地方，输入给得最密。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FIELD, FIELD_LONG, LONG_TEXTS, HEAD, STATUS, CLEAN, UNDER, NAME, REBASE, STATUS_KIND_CFGS, STATUS_KIND, CFG, ENTRY_FS } from './cases/docs-cases.mjs'
import { findField, headOf, itemStatus, clean, under, isWorkItemName, rebaseDocs, docsRootOf, workRoot, entryFiles, inFrozen, isTailoredOut, artifactTailored, dateFieldsOf, statusKind, normRel, ENTRY_CANDIDATES, STATUS_FIELDS } from '../lib/core/docs.js'


const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))
const run = (fn) => { try { return { ok: fn() } } catch (e) { return { raised: e.name } } }

test('规格表规模：各部分都不为空，findField 既有命中也有未命中', () => {
  assert.ok(FIELD.length >= 300 && FIELD_LONG.length >= 10 && HEAD.length >= 25 && STATUS.length >= 25 && UNDER.length >= 20 && NAME.length >= 20 && REBASE.length >= 15 && CFG.length >= 30 && STATUS_KIND.length >= 100 && Object.keys(STATUS_KIND_CFGS).length === 3)
  assert.ok(FIELD.some(([, , o]) => o[0] !== null) && FIELD.some(([, , o]) => o[0] === null))
})

test('findField：规格表全部用例（含 Unicode 大小写折叠、强调标记、字段名里的标点）', () => {
  const wrong = []
  for (const [text, names, want] of FIELD) {
    const got = run(() => findField(text, names))
    if (!same(got, { ok: want })) wrong.push({ text: text.slice(0, 30), names, want, got })
  }
  assert.deepEqual(wrong.slice(0, 6), [], `不一致共 ${wrong.length} 条`)
})

test('findField：长输入（满行星号、满行空白、几千行空行、4000 字符边界）', () => {
  const wrong = []
  for (const [key, names, want] of FIELD_LONG) {
    const got = run(() => findField(LONG_TEXTS[key](), names))
    if (!same(got, { ok: want })) wrong.push({ key, names, want, got })
  }
  assert.deepEqual(wrong, [])
})

test('findField 是线性的：满行星号、满行空白、几千行空行，各自在 1 秒内（原写法曾是平方级，R1-01、R2-11）', () => {
  const cases = ['*'.repeat(200000), '状态' + '*'.repeat(200000) + '：z', ' '.repeat(200000) + '状态：z', '\n'.repeat(100000) + '状态：z', '_'.repeat(200000), '`'.repeat(200000) + 'status: z']
  for (const t of cases) {
    const t0 = Date.now(); findField(t, ['状态', 'status', 'state'])
    assert.ok(Date.now() - t0 < 1000, `耗时 ${Date.now() - t0}ms，输入长度 ${t.length}`)
  }
})

test('headOf / itemStatus：YAML 头、第一个二级标题之前、4000 字符上限', () => {
  const wrong = []
  for (const [raw, wantHead, wantStatus] of HEAD) {
    const text = typeof raw === 'string' ? raw : LONG_TEXTS[raw.long]()
    const got = { out: run(() => headOf(text)), status: run(() => itemStatus(text)) }
    if (!same(got.out, wantHead) || !same(got.status, wantStatus)) wrong.push({ text: text.slice(0, 30), want: { out: wantHead, status: wantStatus }, got })
  }
  assert.deepEqual(wrong.slice(0, 4), [], `不一致共 ${wrong.length} 条`)
  const s = STATUS.filter(([text, want]) => !same(run(() => itemStatus(text)), want)).map(([text]) => text)
  assert.deepEqual(s, [])
})

/** 含反斜杠的路径：Windows 上 `\` 是分隔符，POSIX 上不是（basename 不切）。黄金样本记录的是生成它的平台（Windows）。 */
const platformName = (rel, want) => (process.platform !== 'win32' && typeof rel === 'string' && rel.includes('\\') ? { ok: false } : want)

test('isWorkItemName 的平台语义：反斜杠只在 Windows 上是路径分隔符（Linux 上 Python 同样返回 False，已在容器里实测）', () => {
  assert.equal(isWorkItemName('docs/WI-002.md'), true); assert.equal(isWorkItemName('WI-002.md'), true)
  assert.equal(isWorkItemName('docs\\WI-002.md'), process.platform === 'win32')
  assert.equal(isWorkItemName('a\\b\\WI-003.md'), process.platform === 'win32')
})

// 设计 §12.6 的有意差异：这些输入允许 TS 与 Python 不同，每条另有专门断言钉住 TS 的实际行为。
const KNOWN_DIFF_NAME = new Set(['WI-１２３.md']) // D4：Python 的 \d 认全角数字，TS 只认 ASCII 0-9

test('D4 在工作项命名上：全角数字不算数字（Python 的 \\d 会认）；ASCII 照常', () => {
  assert.equal(NAME.find(([rel]) => rel === 'WI-１２３.md')[1].ok, true, '规格表记录的是 Python 的行为')
  assert.equal(isWorkItemName('WI-１２３.md'), false); assert.equal(isWorkItemName('WI-123.md'), true); assert.equal(isWorkItemName('WI-12.md'), false)
})

// D12：配置形状非法时 Python 的行为是偶然的（逐字符迭代、TypeError），真实入口走不到（loadConfig 已整份拒收）
const D12_SKIP = new Set(['frozen_str:in_frozen', 'entry_decl_nonstr_nonlist:entry_files'])

test('D12：配置形状非法时下游函数当空、不崩；真实入口走不到，因为 loadConfig 已整份拒收', () => {
  // 非字符串、非列表的 layout.entry：声明存在（真值）但取不出任何条目——返回空列表与空注记，不崩（Python 在此抛 TypeError）。
  for (const cfg of [{ layout: { entry: 5 } }, { layout: { entry: { a: 1 } } }, { layout: { artifacts: { entry: 5 } } }, { layout: { entry: true } }]) {
    assert.deepEqual(entryFiles({ ...cfg, _root: '.' }), [[], ''], JSON.stringify(cfg))
  }
  // 对照：合法形状照常
  assert.deepEqual(entryFiles({ layout: { entry: 'A.md' }, _root: '.' }), [['A.md'], ''])
  assert.deepEqual(entryFiles({ layout: { entry: ['A.md', 'B.md'] }, _root: '.' }), [['A.md', 'B.md'], ''])
})

test('D12：layout.frozen 不是列表时永不命中（Python 会逐字符迭代）；真实入口走不到，因为 loadConfig 已整份拒收', () => {
  for (const cfg of [{ layout: { frozen: 'docs/archive' } }, { layout: { frozen: 5 } }, { layout: { frozen: { a: 1 } } }]) {
    for (const p of ['', 'docs/x', 'd', '/x', 'docs/archive/a.md']) assert.equal(inFrozen(cfg, p), false, JSON.stringify([cfg, p]))
  }
  assert.equal(inFrozen({ layout: { frozen: ['docs/archive'] } }, 'docs/archive/a.md'), true)
})

test('clean / under / isWorkItemName / rebaseDocs：规格表', () => {
  const w1 = CLEAN.filter(([input, want]) => !same(run(() => clean(input)), want)).map(([input]) => input)
  const w2 = UNDER.filter(([rel, sub, want]) => !same(run(() => under(rel, sub)), want)).map(([rel, sub]) => [rel, sub])
  // 黄金样本在 Windows 上生成：`docs\WI-002.md` 里 `\` 是路径分隔符（os.path.basename 认）。Linux 上 Python 自己对它也返回 False（容器里实测过），
  // 所以这类输入按平台期望——是路径语义差异，不是实现差异。其余输入两个平台一致。
  const w3 = NAME.filter(([rel, want]) => !KNOWN_DIFF_NAME.has(rel) && !same(run(() => isWorkItemName(rel)), platformName(rel, want))).map(([rel]) => rel)
  const w4 = REBASE.filter(([rel, root, want]) => !same(run(() => rebaseDocs(rel, root)), want)).map(([rel, root]) => [rel, root])
  assert.deepEqual({ w1, w2, w3, w4 }, { w1: [], w2: [], w3: [], w4: [] })
})

// ---- 配置派生：配置原文取自黄金样本（不在测试里手抄第二份）----

test('配置派生函数（docsRootOf、workRoot、entryFiles、isTailoredOut、artifactTailored、dateFieldsOf、inFrozen）：规格表', () => {
  const root = mkdtempSync(join(tmpdir(), 'tsdocs-'))
  try {
    const wrong = []
    for (const g of CFG) {
      const cfg = { ...g.config, _root: root }
      const got = {
        docs_root_of: run(() => docsRootOf(cfg)), work_root: run(() => workRoot(cfg)), entry_files: run(() => entryFiles(cfg)), date_fields_of: run(() => dateFieldsOf(cfg)),
        is_tailored_out: Object.fromEntries(['freshness', 'layout', 'evidence', 'x'].map((c) => [c, run(() => isTailoredOut(cfg, c))])),
        artifact_tailored: Object.fromEntries(['status', 'acceptance', 'handoff', 'entry'].map((r) => [r, run(() => artifactTailored(cfg, r))])),
        in_frozen: Object.fromEntries(['docs/archive/a.md', 'docs/archive', 'docs/archivex/a.md', 'old/x', 'old', 'docs\\archive\\a.md', 'other', ''].map((p) => [p, run(() => inFrozen(cfg, p))])),
      }
      for (const k of Object.keys(got)) { if (D12_SKIP.has(g.name + ':' + k)) continue /* D12：配置形状非法，上游 loadConfig 已拒收，Python 的行为是偶然的 */; if (!same(got[k], g.expect[k])) wrong.push({ name: g.name, field: k, want: g.expect[k], got: got[k] }) }
    }
    assert.deepEqual(wrong.slice(0, 4), [], `不一致共 ${wrong.length} 条`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('entryFiles 依赖文件系统：候选存在与否、同时存在、出仓的候选照算命中、大小写（Windows 不区分而 Linux 区分，按平台比对）', () => {
  const wrong = []
  for (const g of ENTRY_FS) {
    if (g.name === 'context_symlink_out') continue
    const t = mkdtempSync(join(tmpdir(), 'tsdocs-'))
    try {
      for (const f of g.files) writeFileSync(join(t, f), 'x')
      const got = run(() => entryFiles({ _root: t }))
      // 黄金样本在 Windows 上生成：`agents.md` 在大小写不敏感的文件系统上被当成 AGENTS.md。Linux 上不等，**这是文件系统差异不是实现差异**，按平台期望
      if (g.name === 'lowercase_agents' && process.platform !== 'win32') { assert.deepEqual(got.ok[0], [], 'Linux 区分大小写：agents.md 不是 AGENTS.md'); continue }
      if (!same(got, g.result)) wrong.push({ name: g.name, want: g.result, got })
    } finally { rmSync(t, { recursive: true, force: true }) }
  }
  assert.deepEqual(wrong, [])
})

test('entryFiles：CONTEXT.md 是指向仓外的符号链接时，出仓的候选不探测、照算命中（结论不随仓外文件在不在而变）', { skip: canSymlink() ? false : '本机造不出符号链接' }, () => {
  const t = mkdtempSync(join(tmpdir(), 'tsdocs-')), o = mkdtempSync(join(tmpdir(), 'tsdocs-out-'))
  try {
    writeFileSync(join(o, 'secret.md'), 'x'); writeFileSync(join(t, 'AGENTS.md'), 'x')
    symlinkSync(join(o, 'secret.md'), join(t, 'CONTEXT.md'), 'file')
    const got = run(() => entryFiles({ _root: t }))
    const want = ENTRY_FS.find((g) => g.name === 'context_symlink_out')
    if (want.symlink) assert.ok(same(got, want.result), JSON.stringify({ want: want.result, got }))
    assert.deepEqual(got.ok[0], ['CONTEXT.md'], '出仓的候选照算命中，排在 AGENTS.md 之前')
  } finally { rmSync(t, { recursive: true, force: true }); rmSync(o, { recursive: true, force: true }) }
})

test('statusKind：3 套配置 × 路径 × 状态值', () => {
  const wrong = STATUS_KIND.filter(([cfg, rel, status, want]) => !same(run(() => statusKind(STATUS_KIND_CFGS[cfg], rel, status)), want)).map(([cfg, rel, status]) => [cfg, rel, status])
  assert.deepEqual(wrong.slice(0, 6), [], `不一致共 ${wrong.length} 条`)
})

test('STATUS_FIELDS 的顺序与成员经 itemStatus 生效：状态 优先于 status 优先于 state（变异 D1、D2、D3）', () => {
  assert.deepEqual([...STATUS_FIELDS], ['状态', 'status', 'state'])
  assert.equal(itemStatus('state: a\n状态: b'), 'b', '状态 在前：即使 state 行出现得更早也取 状态')
  assert.equal(itemStatus('state: a\nstatus: b'), 'b', 'status 优先于 state')
  assert.equal(itemStatus('status: a\nstate: b'), 'a')
  assert.equal(itemStatus('state: only'), 'only', 'state 是第三个，仍被认')
})

test('artifactTailored：check 与 role 按 Python 的 str() 比较——数字 check 5 与 role "5" 相等；布尔 true 与 "True"（变异 T8）', () => {
  assert.deepEqual(artifactTailored({ tailoring: [{ check: 5, applicable: false, reason: 'r' }] }, '5'), [true, 'r'])
  assert.deepEqual(artifactTailored({ tailoring: [{ check: true, applicable: false, reason: 't' }] }, 'True'), [true, 't'])
  assert.deepEqual(artifactTailored({ tailoring: [{ check: 5, applicable: false, reason: 'r' }] }, '6'), [false, null])
})

test('JS 与 Python 的 Unicode 大小写折叠差异被显式补上：İ ı（U+0130/0131）、ſ（U+017F）、K（U+212A）与 ASCII 字母等价（设计 §12.6 D11）', () => {
  assert.deepEqual(findField('İd: 1', ['id']), ['1', 'id']); assert.deepEqual(findField('ıd: 1', ['id']), ['1', 'id'])
  assert.deepEqual(findField('ſtatus: 1', ['status']), ['1', 'status']); assert.deepEqual(findField('\u212aey: 1', ['key']), ['1', 'key'])
  assert.deepEqual(findField('ß: 1', ['ss']), [null, null], 'ß 与 ss 在 Python 的 re.I 里不等价（那是完整折叠，re 只做简单折叠）')
  assert.deepEqual(findField('é: 1', ['É']), ['1', 'É'], '非 ASCII 字母的普通大小写对两边一致')
})

test('normRel 与 ENTRY_CANDIDATES：CLAUDE.md（Claude Code 时代的兼容名）不再是候选', () => {
  assert.equal(normRel(' a\\b '), 'a/b'); assert.deepEqual([...ENTRY_CANDIDATES], ['CONTEXT.md', 'AGENTS.md'])
})

function canSymlink() {
  const t = mkdtempSync(join(tmpdir(), 'tsdocs-sl-'))
  try { writeFileSync(join(t, 'a'), 'x'); symlinkSync(join(t, 'a'), join(t, 'b'), 'file'); return true } catch { return false } finally { rmSync(t, { recursive: true, force: true }) }
}
