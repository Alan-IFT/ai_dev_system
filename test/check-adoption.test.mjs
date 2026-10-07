// adoption 检查器的验收测试：selftest 的 (id,status) 集合与 Python 黄金样本相同（扣掉 golden/expected-changes.json 里预期消失/新增的）；对 4 个真实仓逐条一致；变异验证靠这里的直接断言变红。
// 期望值取自 Python 版实测（探针已删，输出逐条抄在断言里）。Python 版 run() 还多出的两条（内嵌只读 SKIP、免审批清单 SKIP）不迁，见 expected-changes.json。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
test('对 4 个固定提交的真实仓逐条一致（仅本机有这四个仓时跑；预期消失的两条未比）', { skip: process.platform === 'win32' && REPOS.every((p) => existsSync(p)) ? false : '本机没有这四个真实仓' }, () => {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'golden-compare.mjs'), 'adoption'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /预期消失（adoption\/60a5c980、adoption\/settings-absent）/, '预期消失的条数与 id 必须每次都打印出来')
})

// ---- 直接断言（所有平台都跑）----
const tmps = []
const mk = () => { const t = mkdtempSync(join(tmpdir(), 'adchk-')); tmps.push(t); return t }
test.after(() => { for (const t of tmps) rmSync(t, { recursive: true, force: true }) })
const put = (t, body) => { mkdirSync(join(t, 'governance'), { recursive: true }); if (body !== null) writeFileSync(join(t, 'governance', 'STANDARD_VERSION'), body) }
const OK = { compatibility: { policy: '未上线，可破坏性重构' } }
const row = (f) => [f.status, f.id, f.where ?? null]
const SEP = '不核实该值背后的 tag 是否真实存在（要联网或读仓外 git 元数据，本工具不做），也不与工具侧任何常量比对——拿工具自己的常量当真相比，结论就是编的。值原样列在这里，供人核。'

test('文件缺失 → FAIL（where 是相对路径，evidence 写拼出的绝对路径）', () => {
  const t = mk(); put(t, null); const r = run({ ...OK, _root: t })
  assert.deepEqual(r.map(row), [['FAIL', 'adoption/0876f848', 'governance/STANDARD_VERSION'], ['PASS', 'adoption/compatibility-policy', 'governance/project.yaml']])
  assert.equal(r[0].title, '缺 governance/STANDARD_VERSION：没有记录采用的是标准的哪一版'); assert.match(r[0].evidence, /^按 cfg\[_root\] 拼出的路径不存在：.*STANDARD_VERSION$/)
})

test('空文件 → 版本读不出 FAIL（where 带 :1、evidence 写「（空文件）」与判据）+ 采用日期读不出未定', () => {
  const t = mk(); put(t, ''); const r = run({ ...OK, _root: t })
  assert.deepEqual(r.map(row), [['FAIL', 'adoption/fb8f3a95', 'governance/STANDARD_VERSION:1'], ['UNDETERMINED', 'adoption/adopted-date-missing', 'governance/STANDARD_VERSION'], ['PASS', 'adoption/compatibility-policy', 'governance/project.yaml']])
  assert.equal(r[0].evidence, '全文非空行：（空文件）\n判据：第一条不含键冒号的非空行即版本值，或 standard_version/version/adopted_version/标准版本/采用版本 这几个键之一有值')
  assert.equal(r[1].reason, '日期字段名是本工具的约定（adopted_at/adopted/adoption_date/采用日期/采用时间），没找到只说明不在约定处，推不出没记（契约 §1.1）；加一行 `adopted_at: <日期>` 即得通过')
})

test('完整 → 版本值 PASS（where 带 :1，evidence 原样写版本值与「不核实 tag、不比常量」）+ 采用日期 PASS（where 不带行号）', () => {
  const t = mk(); put(t, '1.0\nadopted_at: 2025-03-03\n'); const r = run({ ...OK, _root: t })
  assert.deepEqual(r.map(row), [['PASS', 'adoption/8baf1c92', 'governance/STANDARD_VERSION:1'], ['PASS', 'adoption/8714bd62', 'governance/STANDARD_VERSION'], ['PASS', 'adoption/compatibility-policy', 'governance/project.yaml']])
  assert.equal(r[0].evidence, `读到的版本值（原样）：1.0\n${SEP}`); assert.equal(r[1].evidence, '读到的采用日期（原样）：2025-03-03\n本检查不核实这个日期是否属实，也不判它与版本发布的先后。')
  assert.equal(r[0].title, 'governance/STANDARD_VERSION 记了版本值'); assert.equal(r[1].title, 'governance/STANDARD_VERSION 记了采用日期')
})

test('只有日期 → 版本读不出 FAIL，evidence 写原文非空行；只有版本 → 日期未定，evidence 写「全文非空行：1.0」', () => {
  const a = mk(); put(a, 'adopted_at: 2025-03-03\n'); const ra = run({ ...OK, _root: a }); assert.deepEqual(ra.map((f) => f.status), ['FAIL', 'PASS', 'PASS']); assert.match(ra[0].evidence, /^全文非空行：adopted_at: 2025-03-03\n判据：/)
  const b = mk(); put(b, '1.0\n'); const rb = run({ ...OK, _root: b }); assert.deepEqual(rb.map((f) => f.status), ['PASS', 'UNDETERMINED', 'PASS']); assert.equal(rb[1].evidence, '全文非空行：1.0')
})

test('BOM + CRLF 的文件照样读出版本值与日期（读文本时归一）；含非法 UTF-8 字节的行照样读（丢掉/替换，不抛）', () => {
  const a = mk(); mkdirSync(join(a, 'governance')); writeFileSync(join(a, 'governance', 'STANDARD_VERSION'), Buffer.from('\ufeff1.0\r\nadopted_at: x\r\n', 'utf8')); const ra = run({ ...OK, _root: a })
  assert.deepEqual(ra.map((f) => f.id), ['adoption/8baf1c92', 'adoption/8714bd62', 'adoption/compatibility-policy']); assert.ok(ra[0].evidence.startsWith('读到的版本值（原样）：1.0\n'))
  const b = mk(); mkdirSync(join(b, 'governance')); writeFileSync(join(b, 'governance', 'STANDARD_VERSION'), Buffer.concat([Buffer.from('1.0\n'), Buffer.from([0xff, 0xfe]), Buffer.from('\nadopted_at: x\n')])); const rb = run({ ...OK, _root: b })
  assert.deepEqual(rb.map((f) => f.status), ['PASS', 'PASS', 'PASS'])
})

test('governance 是指向仓外的链接 → 未定 outside-root（不探测目标在不在）；STANDARD_VERSION 是目录 → 按「缺」判 FAIL', () => {
  const out = mk(); writeFileSync(join(out, 'STANDARD_VERSION'), '1.0\n'); const t = mk()
  symlinkSync(out, join(t, 'governance'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.deepEqual(run({ ...OK, _root: t }).map(row), [['UNDETERMINED', 'adoption/outside-root/governance/STANDARD_VERSION', 'governance/STANDARD_VERSION'], ['PASS', 'adoption/compatibility-policy', 'governance/project.yaml']])
  const d = mk(); mkdirSync(join(d, 'governance', 'STANDARD_VERSION'), { recursive: true }); assert.equal(run({ ...OK, _root: d })[0].id, 'adoption/0876f848')
})

test('compatibility.policy：无 → FAIL（reason 写加在哪里）；映射值 → PASS，evidence 按 Python 的 str() 写 {\'k\': v}；_path 有值 → where 取它', () => {
  const t = mk(); put(t, '1.0\n'); const r = run({ _root: t })
  assert.deepEqual(r.map(row), [['PASS', 'adoption/8baf1c92', 'governance/STANDARD_VERSION:1'], ['UNDETERMINED', 'adoption/adopted-date-missing', 'governance/STANDARD_VERSION'], ['FAIL', 'adoption/compatibility-policy', 'governance/project.yaml']])
  assert.match(r[2].reason, /^在 governance\/project\.yaml 里加 `compatibility:` 下的 `policy:`，写明数据、接口、配置、旧版本客户端各支持到什么程度；未上线的写明“可破坏性重构”及其前提$/)
  const m = run({ _root: t, compatibility: { policy: { data: '两个版本', api: null } } }); assert.equal(m[2].evidence, "原样值：{'data': '两个版本', 'api': None}（内容写得对不对不判，契约 §7）")
  assert.equal(run({ _root: t, _path: 'x/p.yaml', compatibility: { policy: 'ok' } })[2].where, 'x/p.yaml')
})

test('裁剪 adoption → 一条 SKIP（带理由，没写理由用默认文案）+ compatibility.policy 照判（有值 PASS、空 FAIL）；版本记录不判', () => {
  const t = mk(); put(t, '1.0\n')
  const a = run({ _root: t, tailoring: [{ check: 'adoption', applicable: false, reason: '不适用' }], compatibility: { policy: 'ok' } })
  assert.deepEqual(a.map((f) => [f.status, f.id]), [['SKIP', 'adoption/0a63fe45'], ['PASS', 'adoption/compatibility-policy']]); assert.equal(a[0].reason, '不适用'); assert.equal(a[0].title, '项目已裁剪本检查（compatibility.policy 不可裁剪，照判）')
  const b = run({ _root: t, tailoring: [{ check: 'adoption', applicable: false }] }); assert.deepEqual(b.map((f) => f.status), ['SKIP', 'FAIL']); assert.equal(b[0].reason, 'project.yaml 未写理由')
  const c = run({ _root: t, tailoring: [{ check: 'adoption', applicable: false, reason: 'r' }], compatibility: { policy: '' } }); assert.deepEqual(c.map((f) => f.status), ['SKIP', 'FAIL'])
})

// ---- 第一轮没抓住的盲区（期望值取自 Python 版实测）----
test('键行的冒号后空白用 Python 的空白集合（变异 B9、B11）：`version:\\x1c1.0`——U+001C 是 Python 空白（JS 的 \\s 不认），所以冒号后被吃掉、值为空，版本取下一行；冒号后紧跟 BOM 则 BOM 留在值里（BOM 不是 Python 空白）', async () => {
  const { parse } = await import('../lib/checks/adoption.js')
  assert.deepEqual(parse('version:\x1c1.0\n'), ['1.0', null, [['version', '']]])
  assert.deepEqual(parse('version:\x851.0\n'), ['1.0', null, [['version', '']]])
  assert.deepEqual(parse('version:\ufeff1.0\n'), ['\ufeff1.0', null, [['version', '\ufeff1.0']]])
  assert.deepEqual(parse('version\ufeff: 1.0\n'), ['version\ufeff: 1.0', null, []], '键后是 BOM：不是键行，整行当裸版本值')
  assert.deepEqual(parse('version: 1.0\n'), ['1.0', null, [['version', '1.0']]]); assert.deepEqual(parse('version:1.0\n'), ['1.0', null, [['version', '1.0']]])
})

test('STANDARD_VERSION 超过读取上限 → 未定 unreadable/<路径>（where 是相对路径，标题里写异常名 TooLarge），compatibility.policy 照判（变异 E6）', () => {
  const t = mk(); mkdirSync(join(t, 'governance')); writeFileSync(join(t, 'governance', 'STANDARD_VERSION'), Buffer.concat([Buffer.from('1.0\n'), Buffer.alloc(3 * 1024 * 1024, 0x78)]))
  const r = run({ ...OK, _root: t })
  assert.deepEqual(r.map(row), [['UNDETERMINED', 'adoption/unreadable/governance/STANDARD_VERSION', 'governance/STANDARD_VERSION'], ['PASS', 'adoption/compatibility-policy', 'governance/project.yaml']])
  assert.equal(r[0].title, 'governance/STANDARD_VERSION 读不了（TooLarge），依赖它的判据未判')
})

test('scope：覆盖 6 条、未覆盖 7 条（比 Python 版各少 2、3 条：内嵌与免审批清单两块不迁）', () => {
  assert.deepEqual([scope({}).covered.length, scope({}).not_covered.length], [6, 7])
  assert.equal(scope({}).covered[0], 'governance/STANDARD_VERSION 是否存在、是否非空')
})
