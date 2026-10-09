// adoption 检查器的验收测试：selftest 的 (id,status) 集合与 Python 黄金样本相同（扣掉 golden/expected-changes.json 里预期消失/新增的）；对 4 个真实仓逐条一致；变异验证靠这里的直接断言变红。
// 期望值取自 Python 版实测。Python 版 run() 多出的内嵌只读、免审批清单两条 SKIP，以及设计 §12.33 起移除的版本记录判据（STANDARD_VERSION），都不迁，见 expected-changes.json。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NAME, run, scope, selftest } from '../lib/checks/adoption.js'

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..')
const probes = JSON.parse(readFileSync(join(root, 'golden', 'samples', 'selftest-probes.json'), 'utf8')).filter((p) => p.check === NAME)
const changes = JSON.parse(readFileSync(join(root, 'golden', 'expected-changes.json'), 'utf8'))[NAME]

test('NAME 与 Python 版一致', () => assert.equal(NAME, 'adoption'))

test('expected-changes.json 里的每一条都有理由（不静默）', () => {
  for (const k of ['vanished_findings', 'vanished_probes', 'added_probes']) for (const v of changes[k]) assert.ok(typeof v.reason === 'string' && v.reason.length > 20, `${k} ${v.id} 没写理由`)
  for (const v of changes.renamed_findings) assert.ok(v.from && v.to && v.reason.length > 20)
})

test('selftest：每条都 PASS，且 (id, status) 集合 = 黄金样本 − 预期消失 + TS 新增', () => {
  const got = selftest()
  assert.deepEqual(got.filter((f) => f.status !== 'PASS').map((f) => `${f.title}｜${f.evidence}`), [])
  const gone = new Set(changes.vanished_probes.map((v) => v.id))
  const want = [...probes.filter((p) => !gone.has(p.id)).map((p) => [p.id, p.status]), ...changes.added_probes.map((v) => [v.id, 'PASS'])].sort()
  assert.deepEqual(got.map((f) => [f.id, f.status]).sort(), want)
})

const REPOS = ['D:\\Programs\\AI辅助开发规范及工作流确定', 'D:\\Programs\\NFBY_Reservoir', 'D:\\Programs\\NFBY_CMS_FullStack', 'D:\\Programs\\dingcun\\PMC-Planner']
test('对 4 个固定提交的真实仓逐条一致（仅本机有这四个仓时跑；预期消失的未比）', { skip: process.platform === 'win32' && REPOS.every((p) => existsSync(p)) ? false : '本机没有这四个真实仓' }, () => {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'golden-compare.mjs'), 'adoption'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /预期消失（adoption\/60a5c980、adoption\/settings-absent、adoption\/8baf1c92、adoption\/8714bd62）/, '预期消失的条数与 id 必须每次都打印出来')
})

// ---- 直接断言（所有平台都跑）----
const OK = { compatibility: { policy: '未上线，可破坏性重构' } }
const row = (f) => [f.status, f.id, f.where ?? null]

test('不再读 governance/STANDARD_VERSION：无论仓里有没有这个文件，run 只产出 compatibility.policy 一条（设计 §12.33）', () => {
  assert.deepEqual(run({ ...OK, _root: '/不存在的根' }).map(row), [['PASS', 'adoption/compatibility-policy', 'governance/project.yaml']])
  assert.deepEqual(run({}).map((f) => f.id), ['adoption/compatibility-policy'])
})

test('compatibility.policy：无 → FAIL（reason 写加在哪里）；映射值 → PASS，evidence 按 Python 的 str() 写 {\'k\': v}；_path 有值 → where 取它', () => {
  const r = run({})
  assert.deepEqual(r.map(row), [['FAIL', 'adoption/compatibility-policy', 'governance/project.yaml']])
  assert.match(r[0].reason, /^在 governance\/project\.yaml 里加 `compatibility:` 下的 `policy:`，写明数据、接口、配置、旧版本客户端各支持到什么程度；未上线的写明“可破坏性重构”及其前提$/)
  const m = run({ compatibility: { policy: { data: '两个版本', api: null } } }); assert.equal(m[0].evidence, "原样值：{'data': '两个版本', 'api': None}（内容写得对不对不判，契约 §7）")
  assert.equal(run({ _path: 'x/p.yaml', compatibility: { policy: 'ok' } })[0].where, 'x/p.yaml')
})

test('裁剪 adoption → 一条 SKIP（带理由，没写理由用默认文案）+ compatibility.policy 照判（有值 PASS、空 FAIL）', () => {
  const a = run({ tailoring: [{ check: 'adoption', applicable: false, reason: '不适用' }], compatibility: { policy: 'ok' } })
  assert.deepEqual(a.map((f) => [f.status, f.id]), [['SKIP', 'adoption/0a63fe45'], ['PASS', 'adoption/compatibility-policy']]); assert.equal(a[0].reason, '不适用'); assert.equal(a[0].title, '项目已裁剪本检查（compatibility.policy 不可裁剪，照判）')
  const b = run({ tailoring: [{ check: 'adoption', applicable: false }] }); assert.deepEqual(b.map((f) => f.status), ['SKIP', 'FAIL']); assert.equal(b[0].reason, 'project.yaml 未写理由')
  const c = run({ tailoring: [{ check: 'adoption', applicable: false, reason: 'r' }], compatibility: { policy: '' } }); assert.deepEqual(c.map((f) => f.status), ['SKIP', 'FAIL'])
})

test('scope：覆盖 2 条、未覆盖 5 条；首条覆盖是 compatibility.policy，并明说不读任何项目里的版本文件', () => {
  const s = scope({})
  assert.deepEqual([s.covered.length, s.not_covered.length], [2, 5])
  assert.match(s.covered[0], /compatibility\.policy/)
  assert.ok(s.not_covered[0].includes('不读任何项目里的版本文件'), '边界必须写明：版本由锁文件与工具身份承担')
  assert.ok(s.not_covered[0].startsWith('不记录、也不核对「采用的是标准的哪一版」'), '措辞：既不记录也不核对（只写「不记录」会让读者以为核对了）')
})
