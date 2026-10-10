// layout 检查器的验收测试：selftest 全过且 (id,status) 集合与 Python 黄金样本相同；对 4 个真实仓逐条一致；变异验证靠这里的直接断言变红。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NAME, run, scope, selftest } from '../lib/checks/layout.js'
import { LAYOUT } from './cases/selftest-ids.mjs'

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..')
const probes = LAYOUT.map(([id, status]) => ({ id, status }))

test('NAME 与 Python 版一致', () => assert.equal(NAME, 'layout'))

test('selftest：每条都 PASS，且 (id, status) 集合与黄金样本完全相同', () => {
  const got = selftest()
  assert.ok(got.length >= 2)
  assert.deepEqual(got.filter((f) => f.status !== 'PASS').map((f) => `${f.title}｜${f.evidence}`), [])
  assert.deepEqual(got.map((f) => [f.id, f.status]).sort(), probes.map((p) => [p.id, p.status]).sort())
})

// ---- 直接断言（变异验证用，不依赖真实仓，所有平台都跑）----
const tmps = []
const mk = (p = 'lychk-') => { const t = mkdtempSync(join(tmpdir(), p)); tmps.push(t); return t }
test.after(() => { for (const t of tmps) rmSync(t, { recursive: true, force: true }) })
const put = (t, rel, body = '') => { mkdirSync(dirname(join(t, rel)), { recursive: true }); writeFileSync(join(t, rel), body) }
const META = '---\nid: X\nstatus: active\nupdated_at: 2026-09-10\n---\n\n# 标题\n'
const st = (fs) => fs.map((f) => `${f.status} ${f.id}`).sort()
const only = (fs, s) => fs.filter((f) => f.status === s)

test('tier：未声明 → 未定（单条，id 固定）；不认识 → 未定且标题带 repr；大小写与首尾 Python 空白不敏感；非 L0-L3 的各种写法', () => {
  const t = mk()
  const a = run({ _root: t }); assert.deepEqual(a.map((f) => [f.status, f.title]), [['UNDETERMINED', '未声明采用档次']])
  for (const v of ['', '  ', '\u3000']) assert.equal(run({ _root: t, tier: v })[0].title, '未声明采用档次', JSON.stringify(v))
  const b = run({ _root: t, tier: 'l9' }); assert.deepEqual(b.map((f) => [f.status, f.title]), [['UNDETERMINED', "tier 取值 'L9' 不是 L0/L1/L2/L3"]])
  assert.equal(run({ _root: t, tier: "it's" })[0].title, 'tier 取值 "IT\'S" 不是 L0/L1/L2/L3', 'repr 含单引号时用双引号')
  for (const v of ['l0', 'L1', ' l2 ', '\u3000L3\u3000', 'l1\n']) assert.ok(!run({ _root: t, tier: v })[0].title.startsWith('tier 取值'), JSON.stringify(v))
  for (const v of ['\ufeffL1', 'L１', 'L 1', 'L1x', 'l4']) assert.ok(run({ _root: t, tier: v })[0].title.startsWith('tier 取值'), JSON.stringify(v))
  assert.ok(run({ _root: t, tier: 5 })[0].title.startsWith('tier 取值'), '数字 5 → str → "5" → 不认识')
})

test('档位累加：L0 只有 5 项；L1 再加 3；L2 再加 6；L3 再加 3；每项的 role 在标题里', () => {
  const t = mk(); const n = (tier) => run({ _root: t, tier, layout: { entry: ['CONTEXT.md'] } }).filter((f) => f.status !== 'SKIP').length
  const roles = (tier) => run({ _root: t, tier, layout: { entry: ['CONTEXT.md'] } }).map((f) => /（(\w+)）/.exec(f.title)?.[1]).filter(Boolean)
  assert.deepEqual(roles('L0').sort(), ['acceptance', 'failures', 'playbook', 'status'], 'L0：入口走另一条标题（「★ 入口缺失」），其余四项带 role')
  assert.deepEqual(roles('L1').sort(), ['acceptance', 'failures', 'handoff', 'playbook', 'status', 'work_artifacts', 'work_current'])
  assert.deepEqual(roles('L2').sort(), [...roles('L1'), 'checkers', 'decisions', 'eval', 'gates', 'memory', 'sources'].sort())
  assert.deepEqual(roles('L3').sort(), [...roles('L2'), 'ops_liveness', 'policy_budget', 'policy_judges'].sort())
  assert.ok(n('L0') < n('L1') && n('L1') < n('L2') && n('L2') < n('L3'))
})

test('★ 入口：声明了但不在 → FAIL（where 是该路径）；在 → PASS；多个入口各一条；候选命中只带「候选」证据', () => {
  const t = mk(); put(t, 'A.md', META)
  const r = run({ _root: t, tier: 'L0', layout: { entry: ['A.md', 'B.md'] } })
  assert.deepEqual(r.filter((f) => f.title.startsWith('入口') || f.title.startsWith('★ 入口')).map((f) => [f.status, f.title, f.where]), [['PASS', '入口 A.md 在', 'A.md'], ['FAIL', '★ 入口缺失：B.md', 'B.md']])
  const t2 = mk(); put(t2, 'AGENTS.md', META)
  const g = run({ _root: t2, tier: 'L0' }).find((f) => f.title === '入口 AGENTS.md 在'); assert.match(g.evidence, /未配 layout\.entry，按候选/)
})

test('★ 工件：声明了落点却不在 → FAIL；未声明候选落空 → 未定（不是 FAIL）；非 ★ 候选落空 → 未定、标题带档位；where 是第一个候选', () => {
  const t = mk(); put(t, 'CONTEXT.md', META)
  const a = run({ _root: t, tier: 'L0', layout: { entry: ['CONTEXT.md'], artifacts: { acceptance: 'NOPE-ACC.md' } } })
  assert.deepEqual(a.filter((f) => f.title.startsWith('★ 验收')).map((f) => [f.status, f.where]), [['FAIL', 'NOPE-ACC.md']])
  const b = run({ _root: t, tier: 'L0', layout: { entry: ['CONTEXT.md'] } })
  assert.deepEqual(b.filter((f) => f.title.startsWith('★ 验收')).map((f) => [f.status, f.where]), [['UNDETERMINED', 'ACCEPTANCE.md']])
  assert.deepEqual(b.filter((f) => f.title.startsWith('L0 档要求的 方法与坑')).map((f) => [f.status, f.where]), [['UNDETERMINED', 'PLAYBOOK.md']])
  assert.ok(!b.some((f) => f.status === 'FAIL'))
})

test('候选随 docs_root 改基：docs/ 开头的候选换成项目的文档根', () => {
  const t = mk(); put(t, 'CONTEXT.md', META); put(t, 'manual/state/STATUS.md', META)
  const r = run({ _root: t, tier: 'L0', layout: { entry: ['CONTEXT.md'], docs_root: 'manual' } })
  assert.ok(r.some((f) => f.title === '状态（status）在：manual/state/STATUS.md'))
})

test('存在性判据 file/dir/any：入口必须是文件；work_artifacts 必须是目录；其余文件或目录都行', () => {
  const t = mk(); put(t, 'CONTEXT.md', META); mkdirSync(join(t, 'work', 'artifacts'), { recursive: true }); put(t, 'work/current.md', '')
  const ok = run({ _root: t, tier: 'L1', layout: { entry: ['CONTEXT.md'] } })
  assert.ok(ok.some((f) => f.title.startsWith('工具原文落点（work_artifacts）在')))
  const t2 = mk(); put(t2, 'CONTEXT.md', META); put(t2, 'work/artifacts', 'x')
  assert.ok(run({ _root: t2, tier: 'L1', layout: { entry: ['CONTEXT.md'] } }).some((f) => f.title.startsWith('L1 档要求的 工具原文落点')), '同名**文件**不是目录')
  const t3 = mk(); mkdirSync(join(t3, 'CONTEXT.md')); const e = run({ _root: t3, tier: 'L0', layout: { entry: ['CONTEXT.md'] } })
  assert.ok(e.some((f) => f.title === '★ 入口缺失：CONTEXT.md' && f.status === 'FAIL'), '入口必须是文件，同名目录不算')
})

test('glob 判据（L2 checkers）：三种候选各命中；带 [ ] 的扫描根照样找得到（C14）；没有则未定', () => {
  for (const [rel, root0] of [['tools/check_a.py', 'p-'], ['tools/x/check_a.py', 'p-'], ['tools/x/checks/check_a.py', 'p-'], ['tools/check_a.py', 'a[b]']]) {
    const t = mk(root0); put(t, rel, ''); const r = run({ _root: t, tier: 'L2' }).find((f) => f.title.includes('（checkers）'))
    assert.equal(r.status, 'PASS', rel + ' @ ' + root0)
  }
  const t = mk(); assert.equal(run({ _root: t, tier: 'L2' }).find((f) => f.title.includes('checkers')).status, 'UNDETERMINED')
})

test('裁剪：artifacts 登记不适用 → SKIP（有理由取理由、没理由写固定句）；入口也可裁剪；被裁剪的不再判存在', () => {
  const t = mk(); put(t, 'CONTEXT.md', META)
  const r = run({ _root: t, tier: 'L0', layout: { entry: ['CONTEXT.md'] }, tailoring: [{ check: 'layout:playbook', applicable: false, reason: '不需要' }, { check: 'failures', applicable: false }] })
  assert.deepEqual(r.filter((f) => f.status === 'SKIP').map((f) => [f.title, f.reason]), [['方法与坑（playbook）已登记为不适用', '不需要'], ['失败清单（failures）已登记为不适用', 'project.yaml 的 tailoring 未写理由']])
  const e = run({ _root: t, tier: 'L0', layout: { entry: ['NOPE.md'] }, tailoring: [{ check: 'entry', applicable: false, reason: 'x' }] })
  assert.ok(e.some((f) => f.title === '入口（entry）已登记为不适用') && !e.some((f) => f.title.startsWith('★ 入口缺失')))
})

test('work_root：声明了但不在 → FAIL work-root-absent（任何档、where=该路径）；是文件也算不在；在 → 不报；work_current 取它时不再另报', () => {
  const t = mk(); put(t, 'CONTEXT.md', META); put(t, 'wf', 'x'); mkdirSync(join(t, 'w'))
  assert.deepEqual(only(run({ _root: t, tier: 'L0', layout: { entry: ['CONTEXT.md'], work_root: 'nope' } }), 'FAIL').map((f) => [f.id, f.where]), [['layout/work-root-absent/nope', 'nope']])
  assert.equal(only(run({ _root: t, tier: 'L0', layout: { entry: ['CONTEXT.md'], work_root: 'wf' } }), 'FAIL').length, 1, '文件不是目录')
  assert.equal(only(run({ _root: t, tier: 'L0', layout: { entry: ['CONTEXT.md'], work_root: 'w/' } }), 'FAIL').length, 0, '存在（尾斜杠已规范化）')
  const l1 = run({ _root: t, tier: 'L1', layout: { entry: ['CONTEXT.md'], work_root: 'w' } })
  assert.ok(l1.some((f) => f.title === '实时状态源（work_current）在：w'), 'work_current 未声明时取 work_root')
  const absent = run({ _root: t, tier: 'L1', layout: { entry: ['CONTEXT.md'], work_root: 'nope' } })
  assert.ok(!absent.some((f) => f.title.includes('work_current')), 'work_root 不在时 work_current 不再另报')
})

test('元信息（仅 acceptance、status 两角色）：声明 metadata_fields 且缺 → FAIL；未声明缺日期 → 未定 meta-unrecognized；状态字段缺 → 未定；齐 → PASS', () => {
  const t = mk(); put(t, 'CONTEXT.md', META); put(t, 'ACCEPTANCE.md', META)
  const cfg = { _root: t, tier: 'L0', layout: { entry: ['CONTEXT.md'], artifacts: { status: 'WORK.md' } } }
  put(t, 'WORK.md', '# 标题\n')
  const fail = run({ ...cfg, metadata_fields: ['updated_at'] }).filter((f) => f.status === 'FAIL')
  assert.deepEqual(fail.map((f) => [f.title, f.where]), [['WORK.md 头部缺元信息：日期字段（updated_at）、状态字段（状态/status/state）', 'WORK.md:1']])
  const und = run(cfg).filter((f) => f.id === 'layout/meta-unrecognized/WORK.md'); assert.equal(und.length, 1); assert.equal(und[0].status, 'UNDETERMINED'); assert.equal(und[0].where, 'WORK.md:1')
  put(t, 'WORK.md', '---\nupdated_at: 2026-09-10\n---\n# 标题\n'); const onlyStatus = run(cfg).filter((f) => f.id === 'layout/meta-unrecognized/WORK.md')
  assert.match(onlyStatus[0].title, /头部没认出元信息：状态字段/)
  put(t, 'WORK.md', META); assert.ok(run(cfg).some((f) => f.title === 'WORK.md 头部元信息齐' && f.status === 'PASS'))
  // 其余角色不判元信息：playbook 缺元信息不产生任何元信息 finding
  put(t, 'PLAYBOOK.md', '# 无元信息\n'); assert.ok(!run(cfg).some((f) => f.title.startsWith('PLAYBOOK.md 头部')))
})

test('元信息：日期只看前 40 行（第 41 行起的字段不算）；状态按 headOf 划界；自定义 metadata_fields 生效', () => {
  const t = mk(); put(t, 'CONTEXT.md', META); put(t, 'ACCEPTANCE.md', META)
  const cfg = { _root: t, tier: 'L0', layout: { entry: ['CONTEXT.md'], artifacts: { status: 'WORK.md' } }, metadata_fields: ['updated_at'] }
  put(t, 'WORK.md', '状态: active\n' + 'x\n'.repeat(45) + 'updated_at: 2026-09-10\n')
  assert.ok(run(cfg).some((f) => f.status === 'FAIL' && f.title.includes('日期字段')), '第 47 行的日期不算')
  put(t, 'WORK.md', '状态: active\n' + 'x\n'.repeat(37) + 'updated_at: 2026-09-10\n')
  assert.ok(run(cfg).some((f) => f.title === 'WORK.md 头部元信息齐'), '第 39 行的日期算')
  put(t, 'WORK.md', '状态: active\n更新于: 2026-09-10\n'); assert.ok(run({ ...cfg, metadata_fields: ['更新于'] }).some((f) => f.title === 'WORK.md 头部元信息齐'))
})

test('元信息：目录型 status/acceptance 记 SKIP（同一目录只一条）；非 md 文件不判元信息', () => {
  const t = mk(); put(t, 'CONTEXT.md', META); mkdirSync(join(t, 'w'))
  const r = run({ _root: t, tier: 'L1', layout: { entry: ['CONTEXT.md'], artifacts: { status: 'w', acceptance: 'w', handoff: 'w', work_current: 'w' } } })
  assert.deepEqual(r.filter((f) => f.status === 'SKIP').map((f) => [f.title, f.where]), [['w 是目录，不逐份判其下文档的元信息', 'w']])
  const t2 = mk(); put(t2, 'CONTEXT.md', META); put(t2, 'S.txt', '无元信息')
  assert.ok(!run({ _root: t2, tier: 'L0', layout: { entry: ['CONTEXT.md'], artifacts: { status: 'S.txt' } } }).some((f) => f.title.startsWith('S.txt 头部')), '.txt 不判')
  const t3 = mk(); put(t3, 'CONTEXT.md', META); put(t3, 'S.MD', '无元信息'); assert.ok(run({ _root: t3, tier: 'L0', layout: { entry: ['CONTEXT.md'], artifacts: { status: 'S.MD' } } }).some((f) => f.title.startsWith('S.MD 头部')), '后缀大小写不敏感')
})

test('出仓：入口、状态工件、work_root 是指向仓外的链接 → 未定 outside-root，不读、不泄漏文件名；断链出仓同样', () => {
  const t = mk(), o = mk('lychk-out-'); put(o, 'SECRET-NAME.md', META)
  try { symlinkSync(join(o, 'SECRET-NAME.md'), join(t, 'AGENTS.md'), 'file'); symlinkSync(join(o, 'no-such.md'), join(t, 'WORK.md'), 'file'); symlinkSync(o, join(t, 'wl'), process.platform === 'win32' ? 'junction' : 'dir') } catch { return }
  const r = run({ _root: t, tier: 'L1', layout: { entry: ['AGENTS.md'], work_root: 'wl' } })
  assert.ok(!JSON.stringify(r).includes('SECRET-NAME'))
  assert.deepEqual(r.filter((f) => f.id.includes('outside-root')).map((f) => f.id).sort(), ['layout/outside-root/AGENTS.md', 'layout/outside-root/WORK.md', 'layout/outside-root/wl'])
})

test('读不了（注入 EACCES）→ unreadable 未定，不吞也不当缺元信息', async () => {
  const hooks = (await import('../lib/core/fs.js')).__testHooks
  const t = mk(); put(t, 'CONTEXT.md', META); put(t, 'WORK.md', META)
  hooks.beforeOpen = () => { const e = new Error('denied'); e.code = 'EACCES'; throw e }
  let r; try { r = run({ _root: t, tier: 'L0', layout: { entry: ['CONTEXT.md'], artifacts: { status: 'WORK.md' } } }) } finally { hooks.beforeOpen = undefined }
  assert.ok(r.some((f) => f.id === 'layout/unreadable/WORK.md' && f.status === 'UNDETERMINED'))
  assert.ok(!r.some((f) => f.title.includes('WORK.md 头部缺元信息')))
})

test('外壳：被裁剪整个检查 → 单条 SKIP；内部异常 → internal-error 未定', () => {
  const t = mk()
  assert.deepEqual(run({ _root: t, tier: 'L0', tailoring: [{ check: 'layout', applicable: false, reason: 'r' }] }).map((f) => [f.status, f.reason]), [['SKIP', 'r']])
  const boom = run({ _root: t, tier: 'L0', get layout() { throw new Error('炸') } })
  assert.deepEqual(boom.map((f) => [f.status, f.id]), [['UNDETERMINED', 'layout/internal-error']])
})

test('layout.artifacts 不是映射 → 当作没声明（不崩）；work_root 写成空串当作没声明', () => {
  const t = mk(); put(t, 'CONTEXT.md', META)
  for (const art of [5, 'x', ['a'], null, '']) assert.doesNotThrow(() => run({ _root: t, tier: 'L0', layout: { entry: ['CONTEXT.md'], artifacts: art } }), JSON.stringify(art))
  assert.equal(only(run({ _root: t, tier: 'L0', layout: { entry: ['CONTEXT.md'], work_root: '' } }), 'FAIL').length, 0)
})

// ---- 变异验证第一轮没抓住的盲区（期望值取自 Python 版实测）----
const lay = (t, extra = {}, layout = {}) => ({ _root: t, tier: 'L0', layout: { entry: ['CONTEXT.md'], ...layout }, ...extra })

test('tier 为 null（YAML 里写 `tier:` 留空）当作没声明，不是字符串 "NONE"（变异 A4）；未声明的证据写缺 tier（变异 A8）', () => {
  const t = mk(); const r = run({ _root: t, tier: null })
  assert.deepEqual(r.map((f) => [f.status, f.title]), [['UNDETERMINED', '未声明采用档次']])
  assert.equal(r[0].evidence, 'governance/project.yaml 缺 tier；分档定义见 templates/文件树与落地路径.md')
})

test('清单判据（变异 T4、T7、T9）：memory 必须是目录（同名文件 → 未定）；入口必须是文件（同名目录 → 未配入口时 ★ 未定）；eval 目录存在即算在（无 manifest 也行）', () => {
  const t = mk(); put(t, 'CONTEXT.md', META); put(t, 'memory', 'x')
  assert.deepEqual(run(lay(t, { tier: 'L2' })).filter((f) => f.title.includes('记忆候选池')).map((f) => [f.status, f.where]), [['UNDETERMINED', 'memory']])
  const t2 = mk(); mkdirSync(join(t2, 'CONTEXT.md'))
  assert.deepEqual(run({ _root: t2, tier: 'L0' }).filter((f) => f.title.startsWith('★ 入口')).map((f) => [f.status, f.where]), [['UNDETERMINED', 'CONTEXT.md']])
  const t3 = mk(); put(t3, 'CONTEXT.md', META); mkdirSync(join(t3, 'eval'))
  assert.deepEqual(run(lay(t3, { tier: 'L2' })).filter((f) => f.title.includes('评估三区')).map((f) => [f.status, f.where, f.evidence]), [['PASS', 'eval', 'templates/文件树与落地路径.md 快照候选：eval/manifest.md、eval']])
})

test('work_root 值的规范化：反斜杠换成斜杠、去首尾空白（变异 W11、W12）；空串/0/false 都当没声明（变异 R4）', () => {
  const t = mk(); put(t, 'CONTEXT.md', META)
  assert.deepEqual(only(run(lay(t, {}, { work_root: ' nope\\sub ' })), 'FAIL').map((f) => [f.title, f.where]), [['layout.work_root 声明的工作项目录不在：nope/sub', 'nope/sub']])
  for (const v of ['', 0, false, null]) assert.equal(only(run(lay(t, {}, { work_root: v })), 'FAIL').length, 0, JSON.stringify(v))
})

test('声明的落点不再去猜候选：声明 NOPE-ACC.md 而候选 ACCEPTANCE.md 在 → 仍是 FAIL（变异 O3）；声明空串当没声明（变异 O2）', () => {
  const t = mk(); put(t, 'CONTEXT.md', META); put(t, 'ACCEPTANCE.md', META)
  assert.deepEqual(run(lay(t, {}, { artifacts: { acceptance: 'NOPE-ACC.md' } })).filter((f) => f.title.startsWith('★ 验收')).map((f) => [f.status, f.where]), [['FAIL', 'NOPE-ACC.md']])
  const e = run(lay(t, {}, { artifacts: { acceptance: '' } })).filter((f) => f.title.startsWith('验收（acceptance）在'))
  assert.deepEqual(e.map((f) => [f.status, f.where]), [['PASS', 'ACCEPTANCE.md']], '空串 = 没声明，按候选找到 ACCEPTANCE.md')
})

test('多个候选都在时取**第一个**；多个都出仓时报第一个出仓的（变异 O5、O7）', () => {
  const t = mk(); put(t, 'CONTEXT.md', META); put(t, 'WORK.md', META); put(t, 'docs/state/STATUS.md', META)
  assert.deepEqual(run(lay(t)).filter((f) => f.title.startsWith('状态（status）')).map((f) => f.where), ['WORK.md'])
  const t2 = mk(), o = mk('lychk-out-'); put(o, 'a.md', META); put(o, 'b.md', META); put(t2, 'CONTEXT.md', META)
  try { mkdirSync(join(t2, 'docs', 'state'), { recursive: true }); symlinkSync(join(o, 'a.md'), join(t2, 'WORK.md'), 'file'); symlinkSync(join(o, 'b.md'), join(t2, 'docs', 'state', 'STATUS.md'), 'file') } catch { return }
  assert.deepEqual(run(lay(t2)).filter((f) => f.id.includes('outside-root')).map((f) => f.id), ['layout/outside-root/WORK.md'], '两个候选都出仓：报第一个')
})

test('非 ★ 角色声明了落点但缺失 → 未定（不是 FAIL）（变异 M3）；命中的证据在声明时写键名、候选时写快照（变异 M7）', () => {
  const t = mk(); put(t, 'CONTEXT.md', META); put(t, 'S.md', META)
  const r = run(lay(t, {}, { artifacts: { playbook: 'NOPE.md', status: 'S.md' } }))
  assert.deepEqual(r.filter((f) => f.title.startsWith('L0 档要求的 方法与坑')).map((f) => [f.status, f.where, f.evidence]), [['UNDETERMINED', 'NOPE.md', '候选都不存在。layout.artifacts.playbook']])
  assert.equal(r.find((f) => f.title === '状态（status）在：S.md').evidence, 'layout.artifacts.status', '声明命中：证据是键名')
  const t2 = mk(); put(t2, 'CONTEXT.md', META); put(t2, 'WORK.md', META)
  assert.equal(run(lay(t2)).find((f) => f.title.startsWith('状态（status）在')).evidence, 'templates/文件树与落地路径.md 快照候选：WORK.md、docs/state/STATUS.md', '候选命中：证据是快照来源')
})

test('声明的 status 是目录：PASS 在 + SKIP 目录；acceptance 是目录 status 是文件：只有 acceptance 那条 SKIP；元信息不读目录（变异 D3、D8）', () => {
  const t = mk(); put(t, 'CONTEXT.md', META); mkdirSync(join(t, 'S.md'))
  const a = run(lay(t, {}, { artifacts: { status: 'S.md' } }))
  assert.deepEqual(a.filter((f) => f.title.includes('S.md')).map((f) => [f.status, f.title]), [['PASS', '状态（status）在：S.md'], ['SKIP', 'S.md 是目录，不逐份判其下文档的元信息']])
  assert.ok(!a.some((f) => f.id === 'layout/unreadable/S.md'), '目录不进元信息检查（读目录会报 unreadable）')
  const t2 = mk(); put(t2, 'CONTEXT.md', META); put(t2, 'WORK.md', META); mkdirSync(join(t2, 'w'))
  assert.deepEqual(only(run(lay(t2, {}, { artifacts: { status: 'WORK.md', acceptance: 'w' } })), 'SKIP').map((f) => f.where), ['w'], '只有 acceptance 目录一条 SKIP')
})

test('元信息头部边界（变异 D9、D10、D11、D12、D14、D18）：日期在第 40 行算、第 41 行不算；用 \\f 分隔的「行」也按 Python 的行终止符计；超 2 MiB 的文件只读头部；两个日期字段只要一个在就齐；状态在 YAML 第 45 行也算', () => {
  const base = (t) => { put(t, 'CONTEXT.md', META); put(t, 'ACCEPTANCE.md', META) }
  const cfg = (t) => lay(t, { metadata_fields: ['updated_at'] }, { artifacts: { status: 'WORK.md' } })
  for (const [n, ok] of [[40, true], [41, false]]) {
    const t = mk(); base(t); put(t, 'WORK.md', '状态: active\n' + 'x\n'.repeat(n - 2) + 'updated_at: 2026-09-10\n')
    const w = run(cfg(t)).filter((f) => f.title.startsWith('WORK.md 头部'))
    assert.equal(w[0].status, ok ? 'PASS' : 'FAIL', `日期在第 ${n} 行`); if (!ok) assert.match(w[0].evidence, /^只看前 40 行。/)
  }
  const t2 = mk(); base(t2); put(t2, 'WORK.md', '状态: active\n' + 'x\f'.repeat(45) + 'updated_at: 2026-09-10\n')
  assert.equal(run(cfg(t2)).find((f) => f.title.startsWith('WORK.md 头部')).status, 'FAIL', '\\f 也是行终止符：日期在第 47 行之后')
  const t3 = mk(); base(t3); put(t3, 'WORK.md', '状态: active\nupdated_at: 2026-09-10\n' + 'x\n'.repeat(1600000))
  assert.equal(run(cfg(t3)).find((f) => f.title.startsWith('WORK.md 头部')).status, 'PASS', '3 MiB 的文件不拒读：只读头部')
  const t4 = mk(); base(t4); put(t4, 'WORK.md', '状态: active\nupdated_at: 2026-09-10\n')
  assert.equal(run({ ...cfg(t4), metadata_fields: ['updated_at', '更新于'] }).find((f) => f.title.startsWith('WORK.md 头部')).status, 'PASS', '任一日期字段在即齐')
  const t5 = mk(); base(t5); put(t5, 'WORK.md', '---\nupdated_at: 2026-09-10\n' + 'k: v\n'.repeat(42) + 'status: active\n---\n# T\n')
  assert.equal(run(lay(t5, {}, { artifacts: { status: 'WORK.md' } })).find((f) => f.title.startsWith('WORK.md 头部')).status, 'PASS', '状态在 YAML 第 45 行：按 headOf 划界读全文，不限前 40 行')
})

test('元信息的 evidence：默认字段名与声明字段名文案不同；FAIL 与未定都写「只看前 40 行」（变异 D26、D27）', () => {
  const t = mk(); put(t, 'CONTEXT.md', META); put(t, 'ACCEPTANCE.md', META); put(t, 'WORK.md', '# 无\n')
  const d = run(lay(t, {}, { artifacts: { status: 'WORK.md' } })).find((f) => f.id === 'layout/meta-unrecognized/WORK.md')
  assert.equal(d.evidence, '只看前 40 行。元信息日期字段用的是标准默认 updated_at，项目未在 metadata_fields 里校准（契约 §5）')
  const f = run(lay(t, { metadata_fields: ['updated_at'] }, { artifacts: { status: 'WORK.md' } })).find((x) => x.status === 'FAIL')
  assert.equal(f.evidence, '只看前 40 行。元信息日期字段取自 project.yaml 的 metadata_fields：updated_at')
})

// Ubuntu 验证时才暴露：以下两条在 Windows 上是被「4 个真实仓比对」顺带抓住的，而那条在 Linux 上整条跳过——必须有不依赖真实仓的直接断言（变异 D5、D6）
test('acceptance 文件缺元信息同样被判（不只 status）：声明 metadata_fields 且缺 → FAIL，标题点名该文件（变异 D5）', () => {
  const t = mk(); put(t, 'CONTEXT.md', META); put(t, 'WORK.md', META); put(t, 'ACC.md', '# 无元信息\n')
  const r = run(lay(t, { metadata_fields: ['updated_at'] }, { artifacts: { status: 'WORK.md', acceptance: 'ACC.md' } }))
  assert.deepEqual(only(r, 'FAIL').map((f) => [f.title, f.where]), [['ACC.md 头部缺元信息：日期字段（updated_at）、状态字段（状态/status/state）', 'ACC.md:1']])
  assert.ok(r.some((f) => f.title === 'WORK.md 头部元信息齐'), 'status 那份齐')
})

test('「是目录」的 SKIP 只对 acceptance 与 status 报；handoff、work_current 等其余角色即使是目录也不报（变异 D6）', () => {
  const t = mk(); put(t, 'CONTEXT.md', META); mkdirSync(join(t, 'h')); mkdirSync(join(t, 'wc'))
  const r = run({ _root: t, tier: 'L1', layout: { entry: ['CONTEXT.md'], artifacts: { handoff: 'h', work_current: 'wc' } } })
  assert.deepEqual(only(r, 'SKIP').map((f) => f.where), [], '交接与实时状态源是目录：照常 PASS，不额外报「是目录」')
  assert.ok(r.some((f) => f.title === '会话交接（handoff）在：h') && r.some((f) => f.title === '实时状态源（work_current）在：wc'))
})

test('glob 判据的命中若是指向仓外的符号链接 → 不算命中（Python 判「没找到」）（变异 E5）', () => {
  const t = mk(), o = mk('lychk-out-'); put(o, 'check_x.py', ''); put(t, 'CONTEXT.md', META); mkdirSync(join(t, 'tools'))
  try { symlinkSync(join(o, 'check_x.py'), join(t, 'tools', 'check_x.py'), 'file') } catch { return }
  assert.deepEqual(run({ _root: t, tier: 'L2', layout: { entry: ['CONTEXT.md'] } }).filter((f) => f.title.includes('checkers')).map((f) => [f.status, f.title]), [['UNDETERMINED', 'L2 档要求的 项目侧检查器（checkers）没找到']])
})

test('scope：有候选入口时写「按候选」（变异 S3）', () => {
  const t = mk(); put(t, 'AGENTS.md', META)
  assert.match(scope({ _root: t, tier: 'L0' }).covered[1], /入口（AGENTS\.md，按候选）与 layout\.docs_root（docs，默认）/)
})

test('scope：tier 未声明时写「未声明」，写的是别的值时原样写（变异 S1 已覆盖）', () => {
  const t = mk(); assert.match(scope({ _root: t, tier: 'l2' }).covered[0], /tier（当前 l2）/)
})

test('scope：tier 与入口、文档根、字段名都写进说明；覆盖与未覆盖各有内容', () => {
  const t = mk(); put(t, 'CONTEXT.md', META)
  const s = scope({ _root: t, tier: 'L1', layout: { entry: ['CONTEXT.md'], docs_root: 'manual' } })
  assert.match(s.covered[0], /tier（当前 L1）/); assert.match(s.covered[1], /入口（CONTEXT\.md）与 layout\.docs_root（manual）/); assert.match(s.covered[2], /日期字段 updated_at（默认值） 与状态字段 状态\/status\/state/)
  assert.match(scope({ _root: t }).covered[0], /当前 未声明/); assert.match(scope({ _root: t }).covered[1], /docs，默认/)
  assert.match(scope({ _root: t, tier: 'L0', metadata_fields: ['a', 'b'] }).covered[2], /日期字段 a\/b 与状态字段/)
  assert.ok(s.covered.length === 3 && s.not_covered.length === 8); assert.match(s.not_covered[4], /2026-09-10 的快照/)
})
