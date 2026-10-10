// entry_budget 检查器的验收测试：
//  ① 它自带的 selftest()（契约 §3）全部通过，且 (id, status) 集合与 Python 版黄金样本完全相同；
//  ② 对 4 个固定提交的真实仓，TS 版的 finding 与黄金样本逐条一致；
//  ③ 变异验证（scripts/mutate.mjs + test/mutations/entry_budget.json）靠这里的断言变红——所以这里要尽量「一处变异、至少一条断言红」。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NAME, run, scope, selftest } from '../lib/checks/entry_budget.js'
import { loadConfig } from '../lib/core/config.js'
import { ENTRY_BUDGET } from './cases/selftest-ids.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const probes = ENTRY_BUDGET.map(([id, status]) => ({ id, status }))

test('NAME 与 Python 版一致', () => assert.equal(NAME, 'entry-budget'))

test('selftest：每条都 PASS，且 (id, status) 集合与黄金样本完全相同（id 含标题的哈希，所以同时钉住条数、措辞与结论）', () => {
  const got = selftest()
  assert.ok(got.length >= 2, '契约 §3：至少一条反例、一条正例')
  const bad = got.filter((f) => f.status !== 'PASS').map((f) => `${f.title}｜${f.evidence}`)
  assert.deepEqual(bad, [])
  assert.deepEqual(got.map((f) => [f.id, f.status]).sort(), probes.map((p) => [p.id, p.status]).sort())
})

// ---- 直接断言（变异验证用）：不依赖真实仓，每个判据一条或几条 ----
const tmps = []
const mk = () => { const t = mkdtempSync(join(tmpdir(), 'ebchk-')); tmps.push(t); return t }
test.after(() => { for (const t of tmps) rmSync(t, { recursive: true, force: true }) })
const put = (tmp, rel, n, head = '') => { mkdirSync(dirname(join(tmp, rel)), { recursive: true }); writeFileSync(join(tmp, rel), head + 'x\n'.repeat(n - (head ? 1 : 0))) }
const ids = (fs) => fs.map((f) => `${f.status} ${f.id}`).sort()
const ST = '状态: in_progress\n'
/** run 总会附带四条 budget-undeclared 的 SKIP（文档预算未声明）。只关心入口时，滤掉它们。 */
const entryOnly = (fs) => fs.filter((f) => !f.id.startsWith('entry-budget/budget-undeclared/'))

test('入口：刚好等于预算 PASS、超 1 行 FAIL；where 行号是预算+1；默认预算 150', () => {
  const t = mk(); put(t, 'E.md', 10); put(t, 'F.md', 11)
  assert.deepEqual(entryOnly(run({ _root: t, layout: { entry: ['E.md'] }, budgets: { entry_lines: 10 } })).map((f) => f.status), ['PASS'])
  const f = entryOnly(run({ _root: t, layout: { entry: ['F.md'] }, budgets: { entry_lines: 10 } }))
  assert.deepEqual(f.map((x) => [x.status, x.where]), [['FAIL', 'F.md:11']])
  const t2 = mk(); put(t2, 'E.md', 150); put(t2, 'F.md', 151)
  assert.equal(run({ _root: t2, layout: { entry: ['E.md'] } })[0].status, 'PASS', '默认预算 150：150 行恰好在内')
  assert.equal(run({ _root: t2, layout: { entry: ['F.md'] } })[0].status, 'FAIL', '151 行超')
})

test('入口预算非法：0、负数、浮点、布尔、字符串都记未定且不判行数', () => {
  const t = mk(); put(t, 'E.md', 5)
  for (const v of [0, -3, 1.5, true, false, 'abc', [], {}]) {
    const r = entryOnly(run({ _root: t, layout: { entry: ['E.md'] }, budgets: { entry_lines: v } }))
    assert.deepEqual(r.map((f) => f.status), ['UNDETERMINED'], JSON.stringify(v))
    assert.match(r[0].reason, /^budgets\.entry_lines = /)
  }
})

test('入口：候选入口（未配 layout.entry）超预算只记未定 candidate-over，声明的才判 FAIL', () => {
  const t = mk(); put(t, 'AGENTS.md', 20)
  const r = run({ _root: t, budgets: { entry_lines: 10 } }).filter((f) => f.id.includes('candidate-over'))
  assert.deepEqual(r.map((f) => [f.status, f.id, f.where]), [['UNDETERMINED', 'entry-budget/candidate-over/AGENTS.md', 'AGENTS.md:11']])
})

test('入口：声明了但文件不在 → SKIP entry-absent（由 layout 报）；未配且候选全无 → 单条 SKIP', () => {
  const t = mk()
  const a = entryOnly(run({ _root: t, layout: { entry: ['NOPE.md'] } })).filter((f) => !f.id.endsWith('-absent') || f.id.includes('entry-absent'))
  assert.deepEqual(a.map((f) => [f.status, f.id]), [['SKIP', 'entry-budget/entry-absent/NOPE.md']])
  const b = run({ _root: t })
  assert.deepEqual(b.filter((f) => f.id.includes('entry-absent')).map((f) => [f.status, f.where]), [['SKIP', null]])
})

test('入口：声明的路径是目录（名字叫 D.md）→ 不是文件，走 entry-absent 的 SKIP，不当成读不了', () => {
  const t = mk()
  mkdirSync(join(t, 'D.md'))
  const r = entryOnly(run({ _root: t, layout: { entry: ['D.md'] } })).filter((f) => f.id.includes('entry-absent'))
  assert.deepEqual(r.map((f) => [f.status, f.id]), [['SKIP', 'entry-budget/entry-absent/D.md']], '目录不是文件：isFile 为假，走 entry-absent')
})

test('文档预算：未声明不判（4 条 SKIP budget-undeclared）；非法值记未定 budget-invalid；kind 名固定', () => {
  const t = mk(); put(t, 'S.md', 100)
  const base = { _root: t, layout: { artifacts: { status: 'S.md' } } }
  const r = run(base).filter((f) => f.id.includes('budget-'))
  assert.deepEqual(ids(r), ['SKIP entry-budget/budget-undeclared/handoff_lines', 'SKIP entry-budget/budget-undeclared/module_lines', 'SKIP entry-budget/budget-undeclared/status_lines', 'SKIP entry-budget/budget-undeclared/work_item_lines'])
  for (const v of [0, -1, 2.5, true, 'x']) {
    const x = run({ ...base, budgets: { status_lines: v, handoff_lines: 60, work_item_lines: 150, module_lines: 200 } }).filter((f) => f.id.includes('budget-invalid'))
    assert.deepEqual(ids(x), ['UNDETERMINED entry-budget/budget-invalid/status_lines'], JSON.stringify(v))
  }
})

test('文档预算：声明的状态 100 行 / 预算 80 → FAIL doc-over，where 是 hi+1；120 → docs-within PASS；刚好 80 → PASS', () => {
  const t = mk(); put(t, 'S.md', 100)
  const B = { status_lines: 80, handoff_lines: 60, work_item_lines: 150, module_lines: 200 }
  const f = run({ _root: t, budgets: B, layout: { artifacts: { status: 'S.md' } } }).find((x) => x.id === 'entry-budget/doc-over/S.md')
  assert.deepEqual([f.status, f.where], ['FAIL', 'S.md:81'])
  assert.ok(run({ _root: t, budgets: { ...B, status_lines: 120 }, layout: { artifacts: { status: 'S.md' } } }).some((x) => x.id === 'entry-budget/docs-within' && x.status === 'PASS'))
  put(t, 'S.md', 80)
  assert.ok(run({ _root: t, budgets: B, layout: { artifacts: { status: 'S.md' } } }).some((x) => x.id === 'entry-budget/docs-within'), '刚好 80 行在预算内')
})

test('候选（未声明）状态 100 行超 80 → 未定 candidate-over，不是 FAIL', () => {
  const t = mk(); put(t, 'WORK.md', 100)
  const B = { status_lines: 80, handoff_lines: 60, work_item_lines: 150, module_lines: 200 }
  const f = run({ _root: t, budgets: B }).filter((x) => x.id === 'entry-budget/candidate-over/WORK.md')
  assert.deepEqual(f.map((x) => [x.status, x.where]), [['UNDETERMINED', 'WORK.md:81']])
})

test('合并工件：同时是状态（80）与工作项（150）——超 80 没超 150 → 未定 merged-over（where=81）；超 150 → FAIL（where=151）；≤80 → 在预算内', () => {
  const t = mk(); const B = { status_lines: 80, handoff_lines: 60, work_item_lines: 150, module_lines: 200 }
  const cfg = { _root: t, budgets: B, layout: { work_root: 'w', artifacts: { status: 'w/current.md' } } }
  put(t, 'w/current.md', 100, ST)
  let f = run(cfg).find((x) => x.id === 'entry-budget/merged-over/w/current.md')
  assert.deepEqual([f.status, f.where], ['UNDETERMINED', 'w/current.md:81'])
  put(t, 'w/current.md', 151, ST)
  f = run(cfg).find((x) => x.id === 'entry-budget/doc-over/w/current.md')
  assert.deepEqual([f.status, f.where], ['FAIL', 'w/current.md:151'])
  assert.match(f.reason, /已按其中最宽的预算 150 比/)
  put(t, 'w/current.md', 80, ST)
  assert.ok(run(cfg).some((x) => x.id === 'entry-budget/docs-within'))
  // 单类工件的 doc-over 不写 reason
  const t2 = mk(); put(t2, 'h/a.md', 70)
  const g = run({ _root: t2, budgets: B, layout: { artifacts: { handoff: 'h' } } }).find((x) => x.id === 'entry-budget/doc-over/h/a.md')
  assert.equal(g.reason, '')
})

test('文档预算：声明的状态是目录 → SKIP status-dir；交接目录下一层 md 逐份计；子目录不递归；非 md 不计；大写 .MD 也算', () => {
  const t = mk(); const B = { status_lines: 80, handoff_lines: 60, work_item_lines: 150, module_lines: 200 }
  put(t, 'sd/x.md', 3); put(t, 'h/a.md', 70); put(t, 'h/b.MD', 70); put(t, 'h/c.txt', 500); put(t, 'h/sub/d.md', 500)
  const r = run({ _root: t, budgets: B, layout: { artifacts: { status: 'sd', handoff: 'h' } } })
  assert.ok(r.some((f) => f.id === 'entry-budget/status-dir/sd' && f.status === 'SKIP'))
  assert.deepEqual(ids(r.filter((f) => f.id.includes('doc-over'))), ['FAIL entry-budget/doc-over/h/a.md', 'FAIL entry-budget/doc-over/h/b.MD'])
})

test('文档预算：目录里的文件按码点序处理——输出顺序稳定；emoji 文件名排在 BMP 字符之后（Python 按码点、JS 默认按码元）', () => {
  const t = mk(); const B = { status_lines: 80, handoff_lines: 60, work_item_lines: 150, module_lines: 200 }
  for (const n of ['\u{1F600}.md', '\uFF21.md', 'a.md', 'B.md']) put(t, 'h/' + n, 70)
  const order = run({ _root: t, budgets: B, layout: { artifacts: { handoff: 'h' } } }).filter((f) => f.id.includes('doc-over')).map((f) => f.id.split('/').pop())
  assert.deepEqual(order, ['B.md', 'a.md', '\uFF21.md', '\u{1F600}.md'], '码点序：B(66) < a(97) < Ａ(65313) < 😀(128512)；UTF-16 码元序里 😀 的首码元 0xD83D 小于 Ａ 的 0xFF21，次序会不同')
})

test('工作项：头部带状态字段才算；无状态字段的大文件不算；归档区内的不计；工作项目录不在 → SKIP work_item-absent', () => {
  const t = mk(); const B = { status_lines: 80, handoff_lines: 60, work_item_lines: 150, module_lines: 200 }
  put(t, 'w/WI-1.md', 160, ST); put(t, 'w/notes.md', 400); put(t, 'w/old/WI-9.md', 400, ST); put(t, 'w/arch.md', 400, ST)
  const cfg = { _root: t, budgets: B, layout: { work_root: 'w', frozen: ['w/arch.md'] } }
  assert.deepEqual(ids(run(cfg).filter((f) => f.id.includes('doc-over'))), ['FAIL entry-budget/doc-over/w/WI-1.md'])
  const none = run({ _root: t, budgets: B, layout: { work_root: 'nope' } }).filter((f) => f.id.includes('work_item-absent'))
  assert.deepEqual(none.map((f) => f.status), ['SKIP'])
})

test('出仓：交接目录是链到仓外的符号链接 → 不列仓外文件名；工作项里一份出仓记 outside-root、不吞别的工作项的 FAIL', () => {
  const t = mk(), o = mk(); const B = { handoff_lines: 60, work_item_lines: 150 }
  put(o, 'SECRET-NAME.md', 100); put(t, 'w/WI-1.md', 200, ST)
  try { symlinkSync(o, join(t, 'h'), process.platform === 'win32' ? 'junction' : 'dir'); symlinkSync(join(o, 'SECRET-NAME.md'), join(t, 'w', 'WI-2.md'), 'file') } catch { return }
  const r = run({ _root: t, budgets: B, layout: { work_root: 'w', artifacts: { handoff: 'h' } } })
  assert.ok(!JSON.stringify(r).includes('SECRET-NAME'))
  assert.ok(r.some((f) => f.id === 'entry-budget/doc-over/w/WI-1.md' && f.status === 'FAIL'))
  assert.ok(r.some((f) => f.id === 'entry-budget/outside-root/w/WI-2.md' && f.status === 'UNDETERMINED'))
})

test('候选路径随 docs_root 改基；artifacts.modules 键被读；模块候选是 docs/architecture/modules', () => {
  const t = mk(); const B = { status_lines: 80, handoff_lines: 60, work_item_lines: 150, module_lines: 200 }
  put(t, 'manual/architecture/modules/m.md', 250)
  assert.ok(run({ _root: t, budgets: B, layout: { docs_root: 'manual' } }).some((f) => f.id === 'entry-budget/candidate-over/manual/architecture/modules/m.md'))
  const t2 = mk(); put(t2, 'M/a.md', 250)
  assert.ok(run({ _root: t2, budgets: B, layout: { artifacts: { modules: 'M' } } }).some((f) => f.id === 'entry-budget/doc-over/M/a.md'))
  const t3 = mk(); put(t3, 'docs/architecture/modules/m.md', 250)
  assert.ok(run({ _root: t3, budgets: B }).some((f) => f.id === 'entry-budget/candidate-over/docs/architecture/modules/m.md'))
})

test('声明的落点路径：去末尾斜杠与首尾 Python 空白（全角空格去、U+FEFF 不去）', () => {
  const t = mk(); const B = { status_lines: 80, handoff_lines: 60, work_item_lines: 150, module_lines: 200 }
  put(t, 'h/a.md', 70)
  for (const p of ['h/', 'h//', ' h ', '\u3000h\u3000']) {
    assert.ok(run({ _root: t, budgets: B, layout: { artifacts: { handoff: p } } }).some((f) => f.id === 'entry-budget/doc-over/h/a.md'), JSON.stringify(p))
  }
  assert.ok(!run({ _root: t, budgets: B, layout: { artifacts: { handoff: '\uFEFFh' } } }).some((f) => f.id === 'entry-budget/doc-over/h/a.md'), 'U+FEFF 不是 Python 空白，不去掉，目录 \\uFEFFh 不存在')
})

test('外壳：被裁剪 → 单条 SKIP；内部异常 → 未定 internal-error，不抛；入口顺序在前、文档在后；同 id 去重', () => {
  const t = mk(); put(t, 'E.md', 3)
  const tail = run({ _root: t, layout: { entry: ['E.md'] }, tailoring: [{ check: 'entry-budget', applicable: false, reason: '不适用' }] })
  assert.deepEqual(tail.map((f) => [f.status, f.id]), [['SKIP', 'entry-budget/' + tail[0].id.split('/')[1]]])
  const boom = run({ _root: t, layout: { entry: ['E.md'] }, get budgets() { throw new Error('炸') } })
  assert.deepEqual(boom.map((f) => [f.status, f.id]), [['UNDETERMINED', 'entry-budget/internal-error']])
  const r = run({ _root: t, layout: { entry: ['E.md'] } })
  assert.equal(r[0].id.startsWith('entry-budget/') && r[0].status, 'PASS', '入口的结论在最前')
  assert.equal(new Set(r.map((f) => f.id)).size, r.length)
})

test('scope：入口写明来自声明还是候选；覆盖与未覆盖各有内容', () => {
  const t = mk(); put(t, 'E.md', 3)
  const s = scope({ _root: t, layout: { entry: ['E.md'] } })
  assert.match(s.covered[0], /逐行计数入口文件：E\.md（取自 layout\.entry）/)
  assert.match(scope({ _root: t }).covered[0], /没找到（未配 layout\.entry/)
  assert.ok(s.covered.length >= 4 && s.not_covered.length >= 8)
  assert.match(s.covered[1], /WORK\.md\/docs\/state\/STATUS\.md、work\/handoff\.md\/docs\/state\/handoff、默认工作项目录、docs\/architecture\/modules/)
  assert.match(s.not_covered[0], /不判断入口内容是否该留在入口/)
})

// ---- 变异验证补的盲区（每条对应一个第一轮没被抓住的变异）----
const B = { status_lines: 80, handoff_lines: 60, work_item_lines: 150, module_lines: 200 }
const hooks = (await import('../lib/core/fs.js')).__testHooks
/** 让下一批读文件都以 EACCES 失败；用完必须还原。 */
const denyReads = (fn) => { hooks.beforeOpen = () => { const e = new Error('denied'); e.code = 'EACCES'; throw e }; try { return fn() } finally { hooks.beforeOpen = undefined } }

test('合并工件刚好等于最宽预算：状态（80）兼工作项（150）恰好 150 行 → 仍是未定 merged-over，不是 FAIL（变异 M4：> 改 >=）', () => {
  const t = mk(); put(t, 'w/cur.md', 150, ST)
  const f = run({ _root: t, budgets: B, layout: { work_root: 'w', artifacts: { status: 'w/cur.md' } } }).find((x) => x.id === 'entry-budget/merged-over/w/cur.md')
  assert.deepEqual([f.status, f.where], ['UNDETERMINED', 'w/cur.md:81'])
})

test('合并工件里只有一类是项目声明的：超最宽预算仍判 FAIL（some，不是 every）；状态声明、工作项是默认目录候选（变异 M6）', () => {
  const t = mk(); put(t, 'docs/state/work/cur.md', 200, ST)
  const f = run({ _root: t, budgets: B, layout: { artifacts: { status: 'docs/state/work/cur.md' } } }).find((x) => x.id === 'entry-budget/doc-over/docs/state/work/cur.md')
  assert.ok(f && f.status === 'FAIL')
})

test('work_root 写成空字符串算「未声明」（Python 真值判断）：落点按候选认，超预算只记未定 candidate-over（变异 P7）', () => {
  const t = mk(); put(t, 'docs/state/work/a.md', 200, ST)
  const r = run({ _root: t, budgets: B, layout: { work_root: '' } })
  assert.deepEqual(r.filter((f) => f.id.includes('candidate-over') || f.id.includes('doc-over')).map((f) => [f.status, f.id]), [['UNDETERMINED', 'entry-budget/candidate-over/docs/state/work/a.md']])
})

test('docs-within 汇总：只列前 12 份，超出写「……共 N 份」；刚好 12 份不写（变异 M14、M15）', () => {
  const t = mk(); for (let i = 0; i < 14; i++) put(t, `h/f${String(i).padStart(2, '0')}.md`, 3)
  const cfg = { _root: t, budgets: B, layout: { artifacts: { handoff: 'h' } } }
  let s = run(cfg).find((x) => x.id === 'entry-budget/docs-within')
  assert.equal(s.evidence.split('；').filter((x) => /\.md \d+ 行$/.test(x)).length, 12, '只列 12 份')
  assert.ok(s.evidence.endsWith('……共 14 份')); assert.match(s.title, /14 份在预算内/)
  const t2 = mk(); for (let i = 0; i < 12; i++) put(t2, `h/f${String(i).padStart(2, '0')}.md`, 3)
  s = run({ _root: t2, budgets: B, layout: { artifacts: { handoff: 'h' } } }).find((x) => x.id === 'entry-budget/docs-within')
  assert.ok(!s.evidence.includes('……共'), '刚好 12 份不写省略')
  const t3 = mk(); for (let i = 0; i < 13; i++) put(t3, `h/f${String(i).padStart(2, '0')}.md`, 3)
  s = run({ _root: t3, budgets: B, layout: { artifacts: { handoff: 'h' } } }).find((x) => x.id === 'entry-budget/docs-within')
  assert.equal(s.evidence.split('；').filter((x) => /\.md \d+ 行$/.test(x)).length, 12); assert.ok(s.evidence.endsWith('……共 13 份'))
})

test('未声明预算的 SKIP 在 reason 里写默认参考值：状态 80、交接 60、工作项 150、模块 200（变异 D3）', () => {
  const t = mk()
  const r = run({ _root: t })
  const want = { status_lines: 80, handoff_lines: 60, work_item_lines: 150, module_lines: 200 }
  for (const [k, v] of Object.entries(want)) assert.match(r.find((f) => f.id === `entry-budget/budget-undeclared/${k}`).reason, new RegExp(`默认 ${v} 行仅作参考`), k)
})

test('读不了（注入 EACCES）：入口记 unreadable 未定、文档同样，不吞（变异 B11、M18）；入口兼交接时同一文件只报一次（变异 L1）', () => {
  const t = mk(); put(t, 'E.md', 3); put(t, 'h/a.md', 3)
  const e = denyReads(() => run({ _root: t, layout: { entry: ['E.md'] } }))
  assert.ok(e.some((f) => f.id === 'entry-budget/unreadable/E.md' && f.status === 'UNDETERMINED'), '入口读不了要记 unreadable')
  const d = denyReads(() => run({ _root: t, budgets: B, layout: { artifacts: { handoff: 'h' } } }))
  assert.ok(d.some((f) => f.id === 'entry-budget/unreadable/h/a.md' && f.status === 'UNDETERMINED'), '文档读不了要记 unreadable')
  // 入口 E.md 同时被声明为状态工件：入口与文档各读一次、各自读不了 → 同一 id，once 只留一条
  const both = denyReads(() => run({ _root: t, budgets: B, layout: { entry: ['E.md'], artifacts: { status: 'E.md' } } }))
  assert.equal(both.filter((f) => f.id === 'entry-budget/unreadable/E.md').length, 1)
})

test('跨类工件的输出顺序按码点排，不按类别插入序：交接的 z.md 与模块的 a.md，a 在前（变异 M20；与 D8、D9 的复合变异一起钉住目录内排序）', () => {
  const t = mk(); put(t, 'h/z.md', 70); put(t, 'm/a.md', 250)
  const r = run({ _root: t, budgets: B, layout: { artifacts: { handoff: 'h', modules: 'm' } } }).filter((f) => f.id.includes('doc-over')).map((f) => f.id.split('/').slice(2).join('/'))
  assert.deepEqual(r, ['h/z.md', 'm/a.md'].sort(), '按码点序：h/z.md 在 m/a.md 之前——两类各一份时插入序（交接先于模块）与码点序恰好相同，所以另见下一条')
  const t2 = mk(); put(t2, 'zz/a.md', 70); put(t2, 'aa/b.md', 250)
  const r2 = run({ _root: t2, budgets: B, layout: { artifacts: { handoff: 'zz', modules: 'aa' } } }).filter((f) => f.id.includes('doc-over')).map((f) => f.id.split('/').slice(2).join('/'))
  assert.deepEqual(r2, ['aa/b.md', 'zz/a.md'], '模块的 aa/b.md 在交接的 zz/a.md 之前：插入序是交接先、码点序是 aa 先')
})

test('声明的状态落点是带尾斜杠的**文件**路径（`S.md/`）：去掉尾斜杠后照认（变异 P2）', () => {
  const t = mk(); put(t, 'S.md', 100)
  const f = run({ _root: t, budgets: B, layout: { artifacts: { status: 'S.md/' } } }).find((x) => x.id === 'entry-budget/doc-over/S.md')
  assert.ok(f && f.status === 'FAIL')
})

test('work_root 是指向仓外的目录符号链接：不列仓外内容，记 work_item-absent 的 SKIP，不记 outside-root（变异 D14）', () => {
  const t = mk(), o = mk(); put(o, 'WI-SECRET.md', 200, ST)
  try { symlinkSync(o, join(t, 'wl'), process.platform === 'win32' ? 'junction' : 'dir') } catch { return }
  const r = run({ _root: t, budgets: B, layout: { work_root: 'wl' } })
  assert.ok(!JSON.stringify(r).includes('WI-SECRET'), '不泄漏仓外文件名')
  assert.ok(r.some((f) => f.id === 'entry-budget/work_item-absent' && f.status === 'SKIP'))
  assert.ok(!r.some((f) => f.id.includes('outside-root')))
})

test('loadConfig 之后 run 对本仓自己的配置不崩（冒烟）', () => {
  const [cfg, problem] = loadConfig(root)
  assert.equal(problem, null)
  const r = run(cfg)
  assert.ok(r.length >= 1 && r.every((f) => f.check === NAME))
})
