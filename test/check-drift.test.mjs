// drift 检查器的验收测试：selftest 全过且 (id,status) 集合与 Python 黄金样本相同；对 4 个真实仓逐条一致；变异验证靠这里的直接断言变红。
// 期望值取自 Python 版实测。每个判据有自己的、不依赖外部数据的断言（设计 §6 第 6 条）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { NAME, run, scope, selftest, adrDir } from '../lib/checks/drift.js'

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..')
const probes = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'samples', 'selftest-probes.json'), 'utf8')).filter((p) => p.check === NAME)

test('NAME 与 Python 版一致', () => assert.equal(NAME, 'drift'))

test('selftest：每条都 PASS，且 (id, status) 集合与黄金样本完全相同', () => {
  const got = selftest()
  assert.ok(got.length >= 20)
  assert.deepEqual(got.filter((f) => f.status !== 'PASS').map((f) => `${f.title}｜${f.evidence}`), [])
  assert.deepEqual(got.map((f) => [f.id, f.status]).sort(), probes.map((p) => [p.id, p.status]).sort())
})

// ---- 直接断言（所有平台都跑）----
const tmps = []
const mk = () => { const t = mkdtempSync(join(tmpdir(), 'drchk-')); tmps.push(t); return t }
test.after(() => { for (const t of tmps) rmSync(t, { recursive: true, force: true }) })
const put = (t, rel, body = '') => { mkdirSync(dirname(join(t, rel)), { recursive: true }); writeFileSync(join(t, rel), body) }
const COMMIT = '2026-09-21T05:26:00+08:00'
const GID = ['-c', 'user.name=a', '-c', 'user.email=a@b', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false']
const gitInit = (t, commit = true, when = COMMIT) => {
  spawnSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', t]); spawnSync('git', ['-C', t, '-c', 'core.autocrlf=false', 'add', '-A', '-f'])
  if (commit) spawnSync('git', ['-C', t, ...GID, 'commit', '-q', '-m', 's'], { env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } })
}
const cfgOf = (t, layout = {}, extra = {}) => ({ _root: t, layout: { docs_root: 'docs', ...layout }, ...extra })
const go = (t, layout, extra) => { gitInit(t); return run(cfgOf(t, layout, extra)) }
const ids = (fs) => fs.map((f) => f.id)
const only = (fs, s) => fs.filter((f) => f.status === s)
const DEC = { artifacts: { decisions: 'docs/decisions' } }

test('判据 1 干净时出一条 PASS（扫了多少份、多少候选），where 是 docs_root；标题数字准确', () => {
  const t = mk(); put(t, 'docs/a.md', '# x\n- 2026-09-20 裁定 X\n'); put(t, 'docs/b.md', '无日期\n')
  const r = go(t).filter((f) => f.id === 'drift/future-date')
  assert.equal(r.length, 1); assert.equal(r[0].status, 'PASS'); assert.equal(r[0].title, 'future-date：扫 2 份文档、1 个候选行，无晚于写下时间的日期'); assert.equal(r[0].where, 'docs')
  assert.match(r[0].evidence, /^扫描面 docs（git 跟踪、不在 layout\.frozen 内的 \*\.md）；候选＝日期后 10 字内带动作词且左侧 6 字内不带计划词；基准＝该行 git blame 的提交时刻在 UTC\+14 下的日期$/)
})

test('判据 1：晚于提交的日期记未定（永不 FAIL）；同一文件同一日期多行合成一条；id 带 `｜日期`；where 指向第一处；evidence 逐行列出基准', () => {
  const t = mk(); put(t, 'docs/a.md', '- 2026-09-22 裁定 X\n- 2026-09-22 拍板 Y\n- 2026-09-23 批准 Z\n')
  const r = go(t).filter((f) => f.id.startsWith('drift/future-date/'))
  assert.deepEqual(ids(r), ['drift/future-date/docs/a.md｜2026-09-22', 'drift/future-date/docs/a.md｜2026-09-23']); assert.ok(r.every((f) => f.status === 'UNDETERMINED'))
  assert.equal(r[0].where, 'docs/a.md:1'); assert.match(r[0].evidence, /^第 1 行：比较基准：git blame 提交时刻在 UTC\+14 下的日期 2026-09-21（[0-9a-f]{7}）、第 2 行：/, '多行用「、」连（cap 的分隔符，Python `_cap` 同）')
  assert.equal(r[0].title, 'docs/a.md 里的 2026-09-22 写成已经发生，却晚于写下它的那次提交')
})

test('判据 1：日期不存在（2026-02-30）不报；日期恰为基准日不报（> 不是 >=）；比基准日晚一天（UTC+14 下仍未到）才报', () => {
  const t = mk(); put(t, 'docs/a.md', '- 2026-02-30 裁定\n- 2026-09-21 裁定\n- 2026-09-22 裁定\n')
  assert.deepEqual(ids(go(t).filter((f) => f.id.startsWith('drift/future-date/'))), ['drift/future-date/docs/a.md｜2026-09-22'])
})

test('判据 1：浅克隆整条记一条未定；归档区不看；扫描面 0 份时只出读不了的、不出 PASS', () => {
  const t = mk(); put(t, 'docs/old/a.md', '- 2026-09-22 裁定\n'); put(t, 'docs/b.md', '无\n'); gitInit(t)
  const r = run(cfgOf(t, { frozen: ['docs/old'] })); assert.equal(r.filter((f) => f.id.startsWith('drift/future-date/')).length, 0, '归档区的候选不判')
  const e = mk(); put(e, 'docs/a.md', '- x\n'); gitInit(e)
  const only0 = run({ _root: e, layout: { docs_root: 'docs', frozen: ['docs'] } }); assert.equal(only0.filter((f) => f.id === 'drift/future-date').length, 0, '全是归档区：scanned 为 0，不出 PASS')
})

test('判据 1：blame 取不到（文件未提交、仓里没有提交）→ 该文件一条 blame-unavailable 未定，不丢整条判据', () => {
  const t = mk(); put(t, 'docs/a.md', '- 2026-09-22 裁定\n'); put(t, 'docs/b.md', '- 2026-09-20 裁定\n'); gitInit(t, false)
  const r = run(cfgOf(t)).filter((f) => f.id.startsWith('drift/blame-unavailable/'))
  assert.deepEqual(ids(r), ['drift/blame-unavailable/docs/a.md', 'drift/blame-unavailable/docs/b.md']); assert.ok(r.every((f) => f.status === 'UNDETERMINED'))
  assert.match(r[0].reason, /^git blame 退出码 128：/); assert.equal(r[0].evidence, '该文件有 1 处候选日期未判')
})

test('判据 1：docs_root 取默认时证据末尾补注记，已声明时不补（noteDefault 经 drift）', () => {
  const t = mk(); put(t, 'docs/a.md', '- 2026-09-20 裁定\n'); gitInit(t)
  const d = run({ _root: t }).find((f) => f.id === 'drift/future-date'); assert.ok(d.evidence.endsWith('；docs_root 用的是默认 docs（未配 layout.docs_root）'), d.evidence)
  const c = run(cfgOf(t)).find((f) => f.id === 'drift/future-date'); assert.ok(!c.evidence.includes('docs_root 用的是默认'))
})

test('判据 2：只扫 ADR 目录（除索引、归档区）；标记词命中记未定（永不 FAIL）；where 带第一处行号；evidence 逐行；PASS 写明份数与词数', () => {
  const t = mk(); put(t, 'docs/decisions/README.md', '# i\n\n| ID | 文件 |\n|---|---|\n| ADR-0001 | ADR-0001-a.md |\n| ADR-0002 | ADR-0002-b.md |\n'); put(t, 'docs/decisions/ADR-0001-a.md', '# A\n\n修订：改了\n补充：又改\n'); put(t, 'docs/decisions/ADR-0002-b.md', '# B\n\n正文\n')
  const r = go(t, DEC).filter((f) => f.id.startsWith('drift/adr-revision'))
  assert.deepEqual(ids(r), ['drift/adr-revision/docs/decisions/ADR-0001-a.md']); assert.equal(r[0].status, 'UNDETERMINED'); assert.equal(r[0].where, 'docs/decisions/ADR-0001-a.md:3'); assert.equal(r[0].title, 'docs/decisions/ADR-0001-a.md 里有就地修订的标记（2 处）')
  assert.equal(r[0].evidence, '第 3 行：修订：改了、第 4 行：补充：又改'); assert.match(r[0].reason, /^命中标记词只说明这份 ADR 的行首写了『修订』；/)
  const t2 = mk(); put(t2, 'docs/decisions/README.md', '| ID | 文件 |\n|---|---|\n| ADR-0001 | ADR-0001-a.md |\n'); put(t2, 'docs/decisions/ADR-0001-a.md', '# A\n正文\n')
  const p = go(t2, DEC).find((f) => f.id === 'drift/adr-revision'); assert.equal(p.status, 'PASS'); assert.equal(p.title, 'adr-revision：docs/decisions 下 1 份 ADR，行首都没有就地修订标记'); assert.match(p.evidence, /标记词 9 个，须从剥掉行首装饰后的第 0 个字符开始$/)
})

test('判据 2：证据里的行文取前 40 个**码点**（emoji 不被劈成半个）（D18）', () => {
  const t = mk(); put(t, 'docs/decisions/README.md', '| ID | 文件 |\n|---|---|\n| ADR-0001 | ADR-0001-a.md |\n'); put(t, 'docs/decisions/ADR-0001-a.md', '修订：' + '\u{1F600}'.repeat(60) + '\n')
  const r = go(t, DEC).find((f) => f.id.startsWith('drift/adr-revision/'))
  assert.equal(r.evidence, '第 1 行：修订：' + '\u{1F600}'.repeat(37), '3 个码点 + 37 个 emoji = 40 个码点；按码元截会得 18 个 emoji 加半个')
})

test('判据 2：归档区里的 ADR 既不判就地修订也不参与索引对账', () => {
  const t = mk(); put(t, 'docs/decisions/README.md', '| ID | 文件 |\n|---|---|\n| ADR-0001 | ADR-0001-a.md |\n'); put(t, 'docs/decisions/ADR-0001-a.md', '# A\n'); put(t, 'docs/decisions/ADR-0009-z.md', '修订：x\n')
  const r = go(t, { ...DEC, frozen: ['docs/decisions/ADR-0009-z.md'] })
  assert.ok(!ids(r).some((i) => i.includes('ADR-0009')), '归档区的 ADR-0009 一条都不出'); assert.equal(r.find((f) => f.id === 'drift/adr-index').status, 'PASS')
})

test('判据 3：索引缺实物聚合一条未定；实物不在索引——声明了 decisions 判 FAIL、靠目录名猜到的判未定（reason 点明）；PASS 写明行数与份数', () => {
  const t = mk(); put(t, 'docs/decisions/README.md', '| ID | 标题 | 文件 |\n|---|---|---|\n| ADR-0001 | a | ADR-0001-a.md |\n| ADR-0005 | e | ADR-0005-e.md |\n| ADR-0006 | f | ADR-0006-f.md |\n'); put(t, 'docs/decisions/ADR-0001-a.md', '# A\n'); put(t, 'docs/decisions/ADR-0003-c.md', '# C\n')
  gitInit(t)
  const d = run(cfgOf(t, DEC)), g = run(cfgOf(t))
  const miss = d.find((f) => f.id.startsWith('drift/adr-index-missing')); assert.equal(miss.status, 'UNDETERMINED'); assert.equal(miss.title, 'docs/decisions/README.md 列了 2 个没有实物的 ADR'); assert.equal(miss.evidence, '缺实物：ADR-0005、ADR-0006')
  const un = d.find((f) => f.id === 'drift/adr-unindexed/ADR-0003'); assert.equal(un.status, 'FAIL'); assert.equal(un.where, 'docs/decisions/ADR-0003-c.md'); assert.equal(un.reason, ''); assert.equal(un.evidence, '实物 docs/decisions/ADR-0003-c.md；索引列出的 ID：ADR-0001、ADR-0005、ADR-0006')
  const un2 = g.find((f) => f.id === 'drift/adr-unindexed/ADR-0003'); assert.equal(un2.status, 'UNDETERMINED'); assert.match(un2.reason, /^ADR 目录是按目录名猜到的（项目未声明 layout\.artifacts\.decisions）/)
  assert.ok(!ids(d).includes('drift/adr-index'), '有问题时不再出通过')
  const ok = mk(); put(ok, 'docs/decisions/README.md', '| ID | 文件 |\n|---|---|\n| ADR-0001 | ADR-0001-a.md |\n'); put(ok, 'docs/decisions/ADR-0001-a.md', '# A\n')
  const p = go(ok, DEC).find((f) => f.id === 'drift/adr-index'); assert.equal(p.title, 'adr-index：索引 1 行、目录 1 份，全部对上'); assert.equal(p.where, 'docs/decisions/README.md')
})

test('判据 3：目录里有 ADR 但没有索引 → 一条未定（id 带目录）；有索引但读不出表 → 未定，reason 区分「没有表」与「没有 ID 列」', () => {
  const t = mk(); put(t, 'docs/decisions/ADR-0001-a.md', '# A\n'); put(t, 'docs/decisions/ADR-0002-b.md', '# B\n')
  const a = go(t, DEC).find((f) => f.id === 'drift/adr-index-absent/docs/decisions'); assert.equal(a.status, 'UNDETERMINED'); assert.equal(a.title, 'docs/decisions 下有 2 份 ADR，但没有索引'); assert.equal(a.reason, '目录里没有 README.md 或 INDEX.md；索引是另起了名字，还是确实没建，本工具判不了')
  put(t, 'docs/decisions/README.md', '没有表\n'); const b = go(t, DEC).find((f) => f.id.startsWith('drift/adr-index-unreadable/')); assert.match(b.reason, /^文件里没有 markdown 表；/)
  put(t, 'docs/decisions/README.md', '| 标题 | 文件 |\n|---|---|\n| a | b |\n'); const c = run(cfgOf(t, DEC)).find((f) => f.id.startsWith('drift/adr-index-unreadable/')); assert.match(c.reason, /^文件里第一张表没有 ID 列；/)
  const e = mk(); put(e, 'docs/decisions/README.md', '| ID | 文件 |\n|---|---|\n'); assert.equal(go(e, DEC).filter((f) => f.id.startsWith('drift/adr-index')).length, 0, '空目录空索引：不出 PASS')
})

test('判据 3：索引名 README.md 优先于 INDEX.md；两者都不算 ADR；ID 取文件名开头的 ADR-数字，同 ID 取先出现的', () => {
  const t = mk(); put(t, 'docs/decisions/INDEX.md', '| ID | 文件 |\n|---|---|\n| ADR-0001 | x.md |\n'); put(t, 'docs/decisions/README.md', '| ID | 文件 |\n|---|---|\n| ADR-0001 | ADR-0001-a.md |\n'); put(t, 'docs/decisions/ADR-0001-a.md', '# A\n')
  const r = go(t, DEC); assert.equal(r.find((f) => f.id === 'drift/adr-index').where, 'docs/decisions/README.md', 'README 优先')
  const t2 = mk(); put(t2, 'docs/decisions/README.md', '| ID | 文件 |\n|---|---|\n| ADR-0001 | ADR-0001-a.md |\n'); put(t2, 'docs/decisions/ADR-0001-a.md', '# A\n'); put(t2, 'docs/decisions/ADR-0001-b.md', '# B\n')
  assert.equal(go(t2, DEC).find((f) => f.id === 'drift/adr-index').title, 'adr-index：索引 1 行、目录 1 份，全部对上', '同 ID 两份文件计 1')
})

test('ADR 目录定位：声明的优先（可指文件，取其所在目录）；声明了但不存在 → 未定；出仓 → 记 outside-root；未声明靠 docs_root 下唯一的 decisions 目录；多个 → 未定；没有 → 按档位', () => {
  const t = mk(); put(t, 'docs/decisions/ADR-0001-a.md', '# A\n'); put(t, 'docs/other/decisions/ADR-0002-b.md', '# B\n'); gitInit(t)
  assert.deepEqual(adrDir(cfgOf(t, DEC), t, ['docs/decisions/ADR-0001-a.md'], 'docs').slice(0, 2), ['docs/decisions', true])
  assert.deepEqual(adrDir(cfgOf(t, { artifacts: { decisions: 'docs/decisions/ADR-0001-a.md' } }), t, [], 'docs').slice(0, 2), ['docs/decisions', true], '声明指向文件：取其目录')
  const nope = adrDir(cfgOf(t, { artifacts: { decisions: 'docs/nope' } }), t, [], 'docs')[2]; assert.equal(nope.status, 'UNDETERMINED'); assert.equal(nope.title, 'ADR 目录不存在：docs/nope')
  assert.equal(adrDir(cfgOf(t, { artifacts: { decisions: '../outside' } }), t, [], 'docs')[2].id.startsWith('drift/outside-root/'), true)
  assert.deepEqual(adrDir(cfgOf(t), t, ['docs/decisions/x.md'], 'docs').slice(0, 2), ['docs/decisions', false])
  const multi = adrDir(cfgOf(t), t, ['docs/decisions/x.md', 'docs/other/decisions/y.md'], 'docs')[2]; assert.equal(multi.status, 'UNDETERMINED'); assert.match(multi.reason, /有 2 个名为 decisions 的目录（docs\/decisions、docs\/other\/decisions）/)
  assert.equal(adrDir({ tier: 'L1', layout: {} }, t, ['docs/a.md'], 'docs')[2].status, 'SKIP'); assert.equal(adrDir({ tier: 'L2' }, t, ['docs/a.md'], 'docs')[2].status, 'UNDETERMINED')
  assert.equal(adrDir({ tier: 'L1' }, t, ['docs/decisions/x.md', 'docs/other/decisions/y.md'], 'docs')[2].status, 'UNDETERMINED', 'L1 但有多个候选：不是「没有」，记未定不记不适用')
  assert.equal(adrDir({ tier: 'L0' }, t, ['docs/a.md'], 'docs')[2].reason.endsWith('。tier L0 不要求决策登记（L2 起），故不适用'), true)
})

test('判据 4：STATUS 声明了而无载体 → 每个缺的一条未定（永不 FAIL）；载体二选一（直接一层的 WI-*.md 或状态源里 work_item_id 行）；PASS 写明数量与目录', () => {
  const t = mk(); put(t, 'docs/state/STATUS.md', '- WI-0001 a\n- WI-0002 b\n- WI-0003 c\n'); put(t, 'docs/state/work/WI-0002-x.md', '#\n'); put(t, 'docs/state/work/sub/WI-0003-y.md', '#\n')
  const st = { artifacts: { status: 'docs/state/STATUS.md' } }
  const r = go(t, st).filter((f) => f.id.startsWith('drift/work-item-missing/'))
  assert.deepEqual(ids(r), ['drift/work-item-missing/WI-0001', 'drift/work-item-missing/WI-0003']); assert.ok(r.every((f) => f.status === 'UNDETERMINED'))
  assert.equal(r[0].where, 'docs/state/STATUS.md:1'); assert.equal(r[0].title, 'WI-0001 在 docs/state/STATUS.md 里声明了，docs/state/work 直接一层没有它的文件，状态源文件里也没有它的 work_item_id 行')
  assert.match(r[0].evidence, /work_root 用的是默认 docs\/state\/work/)
  const ok = mk(); put(ok, 'docs/state/STATUS.md', '- WI-0002 b\n'); put(ok, 'docs/state/work/WI-0002-x.md', '#\n')
  const p = go(ok, st).find((f) => f.id === 'drift/work-item'); assert.equal(p.title, 'work-item：状态文件列了 1 个 ID，都有载体（docs/state/work 直接一层的文件或状态源里的 work_item_id 字段）'); assert.equal(p.where, 'docs/state/STATUS.md')
})

test('判据 4：状态文件候选（未声明时）：声明的文件不存在 → status-missing 未定；候选都不在 → 单条 SKIP（reason 列候选）；声明出仓 → outside-root', () => {
  const t = mk(); put(t, 'docs/a.md', '#\n'); gitInit(t)
  const s = run(cfgOf(t)).find((f) => f.status === 'SKIP' && f.title.startsWith('没有状态文件')); assert.equal(s.reason, '未声明 layout.artifacts.status，候选 WORK.md / docs/state/STATUS.md 也都不存在；本工具不猜状态文件叫什么')
  const m = run(cfgOf(t, { artifacts: { status: 'docs/nope.md' } })).find((f) => f.id.startsWith('drift/status-missing/')); assert.equal(m.title, '状态文件不存在：docs/nope.md'); assert.equal(m.status, 'UNDETERMINED')
  assert.ok(run(cfgOf(t, { artifacts: { status: '../x.md' } })).some((f) => f.id.startsWith('drift/outside-root/')))
  const r2 = run(cfgOf(t, { docs_root: 'manual' })).find((f) => f.status === 'SKIP' && f.title.startsWith('没有状态文件')); assert.match(r2.reason, /候选 WORK\.md \/ manual\/state\/STATUS\.md/, '候选随 docs_root 改基')
})

test('判据 4：工作项目录不在 → 单条 work-root-absent（SKIP，指向 layout）而不是逐 ID 报；work_root 带尾斜杠、为 `.`（仓根）都按目录相等比较', () => {
  const t = mk(); put(t, 'WORK.md', '- WI-0001 a\n- WI-0002 b\n'); put(t, 'docs/a.md', '#\n')
  const r = go(t, {}).filter((f) => f.id.startsWith('drift/work')); assert.deepEqual(ids(r), ['drift/work-root-absent']); assert.equal(r[0].status, 'SKIP')
  const t2 = mk(); put(t2, 'WORK.md', '- WI-0001 a\n'); put(t2, 'WI-0001-x.md', '#\n'); gitInit(t2)
  assert.equal(run(cfgOf(t2, { work_root: '.' })).find((f) => f.id === 'drift/work-item').status, 'PASS', 'work_root 为 . 时取仓根一层')
})

test('判据 4：WI- 形态（`\\b` 的 Unicode 边界）：紧贴中文、下划线、字母的不算；WI-12 不够 3 位不算；同一 ID 取首次出现的位置', () => {
  const t = mk(); put(t, 'docs/state/STATUS.md', '中WI-0001文 _WI-0002 WI-0003_ xWI-0004 WI-12 (WI-0005) WI-0006,WI-0006\n'); put(t, 'docs/state/work/.keep.md', '#\n')
  const r = go(t, { artifacts: { status: 'docs/state/STATUS.md' } }).filter((f) => f.id.startsWith('drift/work-item-missing/'))
  assert.deepEqual(ids(r), ['drift/work-item-missing/WI-0005', 'drift/work-item-missing/WI-0006'], '只有被标点/空白隔开的才算')
  assert.equal(r[1].where, 'docs/state/STATUS.md:1')
})

test('判据 4：状态源为目录时 ID 取其直接一层的 *.md（git 跟踪、不递归）；work_item_id 只对状态源**文件**自己有效，目录里的文件不算内联载体', () => {
  const t = mk(); put(t, 'docs/items/a.md', 'work_item_id：WI-0001\n- WI-0001 在做\n'); put(t, 'docs/items/sub/b.md', '- WI-0009\n'); put(t, 'docs/state/work/WI-0002-x.md', '#\n')
  const r = go(t, { artifacts: { status: 'docs/items' } }).filter((f) => f.id.startsWith('drift/work-item'))
  assert.deepEqual(ids(r), ['drift/work-item-missing/WI-0001'], '目录形态下 work_item_id 行不算载体；子目录里的 WI-0009 不递归')
})

test('各判据互不拖累：一条判据抛异常只记它自己一条未定，其余照出（契约 §4）', () => {
  const t = mk(); put(t, 'docs/a.md', '- 2026-09-20 裁定\n'); gitInit(t)
  let n = 0
  const cfg = { _root: t, layout: { docs_root: 'docs', get artifacts() { if (++n >= 1) throw new Error('炸'); return {} } } }
  const r = run(cfg); assert.ok(r.some((f) => f.id === 'drift/future-date' && f.status === 'PASS'), '判据 1 不受影响'); assert.ok(r.some((f) => f.status === 'UNDETERMINED' && f.id.startsWith('drift/internal-error')), '抛异常的判据记 internal-error 未定')
})

test('git 列不出文档（非仓）→ 单条未定；被裁剪整个检查 → 单条 SKIP', () => {
  const t = mk(); mkdirSync(join(t, 'docs'))
  const r = run(cfgOf(t)); assert.equal(r.length, 1); assert.equal(r[0].title, '列不出 git 跟踪的文档'); assert.equal(r[0].status, 'UNDETERMINED'); assert.match(r[0].reason, /^git ls-files 退出码 128/)
  assert.deepEqual(run({ _root: t, tailoring: [{ check: 'drift', applicable: false, reason: 'r' }] }).map((f) => [f.status, f.reason]), [['SKIP', 'r']])
})

// ---- 变异验证第一轮没抓住的盲区（期望值取自 Python 版实测）----
test('判据 2：行首装饰不含 `+`——`+ 修订：x` 不命中（变异 E5）；`-`、`*`、`#`、`>`、`|`、全角空格才是装饰', async () => {
  const { revisionHits } = await import('../lib/checks/drift.js')
  assert.deepEqual(revisionHits('+ 修订：x'), [], 'Python 实测不命中')
  assert.equal(revisionHits('- 修订：x').length, 1); assert.equal(revisionHits('* 修订：x').length, 1)
})

test('判据 4：缺失 ID 按字典序输出，而不是出现顺序（变异 H22）：STATUS 里先 WI-0009 后 WI-0002，输出先 0002', () => {
  const t = mk(); put(t, 'docs/state/STATUS.md', '- WI-0009 a\n- WI-0002 b\n'); put(t, 'docs/state/work/.keep.md', '#\n')
  const r = go(t, { artifacts: { status: 'docs/state/STATUS.md' } }).filter((f) => f.id.startsWith('drift/work-item-missing/'))
  assert.deepEqual(ids(r), ['drift/work-item-missing/WI-0002', 'drift/work-item-missing/WI-0009'])
})

test('latestDay 年份下界：年 0 不存在（Python 抛 OverflowError），TS 同样抛；年 1 可（变异 B6）', async () => {
  const { latestDay } = await import('../lib/checks/drift.js')
  assert.throws(() => latestDay(-62167219200), RangeError, 'epoch -62167219200 是公元 0 年——JS 的 Date 能表示，Python 的 datetime 不能')
  assert.deepEqual(latestDay(-62135596800), { year: 1, month: 1, day: 1 }, '公元 1 年 1 月 1 日 00:00 UTC 加 14 小时仍是 1 月 1 日')
})

test('恶意仓：blame 带 --no-textconv——被扫仓 .gitattributes 指定的 textconv 驱动不被执行（变异 C11）；对照组先证明不加这个选项时 git blame 确会执行它', { skip: spawnSync('sh', ['-c', 'exit 0']).status === 0 ? false : '没有 sh' }, () => {
  const t = mk(); put(t, 'docs/a.md', '- 2026-09-22 裁定 X\n'); put(t, '.gitattributes', 'docs/a.md diff=evil\n'); gitInit(t)
  const mark = join(t, 'PWNED_textconv').replaceAll('\\', '/')
  spawnSync('git', ['-C', t, 'config', 'diff.evil.textconv', `sh -c "touch ${mark}; cat \\"$0\\""`])
  spawnSync('git', ['-C', t, 'blame', '-p', '--', 'docs/a.md'])
  const control = existsSync(join(t, 'PWNED_textconv')); if (control) rmSync(join(t, 'PWNED_textconv'))
  assert.ok(control, '对照组必须真的触发过，否则下面的「没出现」什么也证明不了')
  run(cfgOf(t))
  assert.equal(existsSync(join(t, 'PWNED_textconv')), false, 'drift 的 blame 带了 --no-textconv：驱动没有被执行')
})

// ---- 第二轮盲区（期望值取自 Python 版实测）----
test('浅克隆：整条判据 1 记一条未定（reason 写明 blame 时间不可信），不逐文件报（变异 D1）', () => {
  const src = mk(); put(src, 'docs/a.md', '- 2026-09-22 裁定 X\n'); gitInit(src)
  spawnSync('git', ['-C', src, ...GID, 'commit', '-q', '--allow-empty', '-m', 't'])
  const dst = join(mk(), 'clone'); spawnSync('git', ['clone', '-q', '--depth', '1', pathToFileURL(src).href, dst])
  const r = run({ _root: dst, layout: { docs_root: 'docs' } }).filter((f) => f.id.startsWith('drift/future-date'))
  assert.deepEqual(ids(r), ['drift/future-date']); assert.equal(r[0].status, 'UNDETERMINED'); assert.equal(r[0].title, '浅克隆下判不了日期是否晚于写下它的提交')
  assert.equal(r[0].evidence, 'git rev-parse --is-shallow-repository = true；docs 下有 1 份文档含候选日期未判')
})

test('判据 1：未提交行基准取运行日——写很早日期的未提交行不报（变异 D7）；不合法日期（2026-02-30）不报也不拖累同文件的合法日期（变异 D8）', () => {
  const t = mk(); put(t, 'docs/a.md', '- 2026-09-20 裁定 X\n'); gitInit(t)
  appendFileSync(join(t, 'docs', 'a.md'), '- 2020-01-01 拍板追加（未提交，日期很早）\n')
  assert.equal(run(cfgOf(t)).find((f) => f.id === 'drift/future-date').status, 'PASS', '未提交行的 2020-01-01 比运行日早：不报')
  const u = mk(); put(u, 'docs/a.md', '- 2026-02-30 裁定 X\n- 2026-09-20 裁定 Y\n')
  assert.equal(go(u).find((f) => f.id === 'drift/future-date').status, 'PASS', '2026-02-30 不合法被丢弃，不抛、不报')
})

test('判据 2 的围栏与尾白（变异 E7、E11、E24）：全角空格缩进的围栏照样开闭；闭合围栏行尾带 U+FEFF/U+200B 时 Python 的 strip 不去它→不闭合（后面的修订行仍在围栏里）；NBSP 是 Python 空白→闭合；英文标记词后只有全角空格/NBSP 时去尾白后为空→命中', async () => {
  const { revisionHits } = await import('../lib/checks/drift.js')
  assert.deepEqual(revisionHits('\u3000```\n修订：围栏里\n\u3000```\n修订：外').map((h) => h[0]), [4], '全角空格缩进的围栏：开、闭都识别')
  assert.deepEqual(revisionHits('\u3000> ```\n修订：围栏里\n```\n修订：外').map((h) => h[0]), [4])
  assert.deepEqual(revisionHits('```\n修订：围栏里\n```\ufeff\n修订：仍在围栏里').map((h) => h[0]), [], 'U+FEFF 不是 Python 空白：闭合行不闭合')
  assert.deepEqual(revisionHits('```\n修订：围栏里\n```\u200b\n修订：仍在围栏里').map((h) => h[0]), [], 'U+200B 同')
  assert.deepEqual(revisionHits('```\n修订：围栏里\n```\u00a0\n修订：外').map((h) => h[0]), [4], 'NBSP 是 Python 空白：闭合')
  for (const line of ['revision \u3000', 'REVISION \u00a0', 'changelog\u3000', 'revision \x85']) assert.equal(revisionHits(line).length, 1, JSON.stringify(line))
})

test('判据 2：ADR 目录只有索引、没有任何 ADR → 不出 revision PASS（空集上说不出「全部通过」）（变异 E34）；ADR 读不了 → 该份 unreadable 未定且其余照判（变异 E36）', () => {
  const t = mk(); put(t, 'docs/decisions/README.md', '| ID | 文件 |\n|---|---|\n'); const r = go(t, DEC)
  assert.ok(!ids(r).includes('drift/adr-revision'), '空集不出 PASS')
  const u = mk(); put(u, 'docs/decisions/README.md', '| ID | 文件 |\n|---|---|\n| ADR-0001 | ADR-0001-a.md |\n'); put(u, 'docs/decisions/ADR-0001-a.md', 'x\n'); put(u, 'docs/decisions/ADR-0002-b.md', 'x\n'); gitInit(u)
  rmSync(join(u, 'docs/decisions/ADR-0002-b.md')); mkdirSync(join(u, 'docs/decisions/ADR-0002-b.md'))
  const s = run(cfgOf(u, DEC)); assert.ok(ids(s).includes('drift/unreadable/docs/decisions/ADR-0002-b.md')); assert.equal(s.find((f) => f.id === 'drift/adr-unindexed/ADR-0002').status, 'FAIL', '读不了的那份仍参与索引对账')
})

test('判据 3 的表头与路径（变异 F1、F3、F4、F7、F8、F9、F11、F13）', () => {
  // F1/F3：表头第一个含 id 的列就是 ID 列（「标题 id」在前）；且匹配是「包含」不是「整格等于」
  const a = mk(); put(a, 'docs/decisions/README.md', '| 标题 id | ID | 文件 |\n|---|---|---|\n| ADR-0001 | ADR-0099 | ADR-0001-a.md |\n'); put(a, 'docs/decisions/ADR-0001-a.md', '# A\n')
  assert.equal(go(a, DEC).find((f) => f.id === 'drift/adr-index').status, 'PASS', '第一个含 id 的列（标题 id）是 ID 列：列出 ADR-0001，与实物对上')
  // F4：多个含「文件」的列取第一个：第一个指向不存在，回落 <ID>*.md 仍找到
  const b = mk(); put(b, 'docs/decisions/README.md', '| ID | 备份文件 | 文件 |\n|---|---|---|\n| ADR-0001 | nope.md | ADR-0001-a.md |\n'); put(b, 'docs/decisions/ADR-0001-a.md', '# A\n')
  assert.equal(go(b, DEC).find((f) => f.id === 'drift/adr-index').status, 'PASS')
  // F7/F8：文件列指向 ADR 目录的子目录里的文件（相对 ADR 目录）：靠路径探测找到，不靠 <ID>*.md 回落
  const c = mk(); put(c, 'docs/decisions/README.md', '| ID | 文件 |\n|---|---|\n| ADR-0007 | notes/ADR-0007-elsewhere.md |\n'); put(c, 'docs/decisions/notes/ADR-0007-elsewhere.md', '# A\n')
  assert.ok(!ids(go(c, DEC)).some((i) => i.startsWith('drift/adr-index-missing')), 'F7/F8：相对 ADR 目录的路径探测到')
  // F9：文件列写相对仓根的路径
  const d = mk(); put(d, 'docs/decisions/README.md', '| ID | 文件 |\n|---|---|\n| ADR-0008 | docs/other/ADR-0008-x.md |\n'); put(d, 'docs/other/ADR-0008-x.md', '# A\n')
  assert.ok(!ids(go(d, DEC)).some((i) => i.startsWith('drift/adr-index-missing')), 'F9：相对仓根的路径探测到')
  // F11：文件列指向一个叫 sub.md 的目录：不是文件，不算有实物
  const e = mk(); put(e, 'docs/decisions/README.md', '| ID | 文件 |\n|---|---|\n| ADR-0009 | sub.md |\n'); put(e, 'docs/decisions/sub.md/x.txt', 'x')
  assert.ok(ids(go(e, DEC)).includes('drift/adr-index-missing/docs/decisions/README.md'), '目录不算实物')
  // F13：文件列写仓内绝对路径：Python 的 join 取该绝对路径本身，通过护栏 → 找到
  const f = mk(); put(f, 'docs/decisions/ADR-0010-x.md', '# A\n'); put(f, 'docs/decisions/README.md', `| ID | 文件 |\n|---|---|\n| ADR-0010 | ${join(f, 'docs', 'decisions', 'ADR-0010-x.md').replaceAll('\\', '/')} |\n`)
  assert.equal(go(f, DEC).find((x) => x.id === 'drift/adr-index').status, 'PASS', '仓内绝对路径')
})

test('判据 3 的目录与同 ID（变异 F19、F20、F21、F27、F33、F34）', () => {
  const a = mk(); put(a, 'docs/decisions/README.md', '| ID | 文件 |\n|---|---|\n'); put(a, 'docs/decisions/ADR-0001-a.md', '# A\n'); put(a, 'docs/decisions/ADR-0001-b.md', '# B\n')
  assert.equal(go(a, DEC).find((f) => f.id === 'drift/adr-unindexed/ADR-0001').where, 'docs/decisions/ADR-0001-a.md', '同 ID 取先出现的（字典序先）')
  const b = mk(); put(b, 'docs/decisions/README.md', '| ID | 文件 |\n|---|---|\n'); put(b, 'docs/decisions/note-ADR-0005.md', '# x\n')
  assert.ok(!ids(go(b, DEC)).some((i) => i.startsWith('drift/adr-unindexed')), '文件名中间含 ADR-0005 不算 ADR（要以它开头）')
  const c = mk(); put(c, 'docs/decisions/README.md', '| ID | 文件 |\n|---|---|\n| 无编号 | x.md |\n'); put(c, 'docs/decisions/ADR-0001-a.md', '# A\n')
  assert.ok(ids(go(c, DEC)).includes('drift/adr-unindexed/ADR-0001'), '索引行 ID 格里没有 ADR-数字：跳过该行，所以实物没被列出')
  const d = mk(); put(d, 'docs/decisions/note.md', '# 非 ADR\n'); assert.ok(!ids(go(d, DEC)).some((i) => i.startsWith('drift/adr-index')), '没有 ADR 也没有索引：不出索引相关条目')
  const e = mk(); put(e, 'docs/decisions/README.md', '| ID | 文件 |\n|---|---|\n'); put(e, 'docs/decisions/sub/ADR-0001-a.md', '# A\n'); assert.ok(!ids(go(e, DEC)).some((i) => i.startsWith('drift/adr-unindexed')), '子目录里的 ADR 不算（只取直接一层）')
  const f = mk(); put(f, 'docs/decisions/README.md', 'x\n'); put(f, 'docs/decisions/ADR-0001-a.md', '# A\n'); gitInit(f); rmSync(join(f, 'docs/decisions/README.md')); mkdirSync(join(f, 'docs/decisions/README.md'))
  assert.ok(ids(run(cfgOf(f, DEC))).includes('drift/unreadable/docs/decisions/README.md'), '索引读不了：记 unreadable')
})

test('判据 4 的细节（变异 G4、H3、H11、H14、H15）：声明目录带尾斜杠；出仓的状态候选不探测、读时记 unreadable；同 ID 取首次出现的位置；状态源目录里一份读不了只记它自己；孤立 \\r 也是行终止符（行号）', () => {
  const a = mk(); put(a, 'docs/decisions/README.md', '| ID | 文件 |\n|---|---|\n| ADR-0001 | ADR-0001-a.md |\n'); put(a, 'docs/decisions/ADR-0001-a.md', '# A\n')
  assert.equal(go(a, { artifacts: { decisions: 'docs/decisions/' } }).find((f) => f.id === 'drift/adr-index').status, 'PASS', '声明带尾斜杠')
  const b = mk(); put(b, 'a.md', '#\n'); gitInit(b)
  assert.ok(ids(run(cfgOf(b, {}, {}).layout && { _root: b, layout: { docs_root: '../outside' } })).some((i) => i.startsWith('drift/unreadable/')), '出仓候选不探测存在性，读时记 unreadable')
  const c = mk(); put(c, 'docs/state/STATUS.md', '- WI-0001 a\n- WI-0001 again\n'); put(c, 'docs/state/work/.keep.md', '#\n')
  assert.equal(go(c, { artifacts: { status: 'docs/state/STATUS.md' } }).find((f) => f.id === 'drift/work-item-missing/WI-0001').where, 'docs/state/STATUS.md:1')
  const d = mk(); put(d, 'docs/items/a.md', '- WI-0007\n'); put(d, 'docs/items/b.md', '占位\n'); put(d, 'docs/state/work/WI-0007-x.md', '#\n'); gitInit(d); rmSync(join(d, 'docs/items/b.md')); mkdirSync(join(d, 'docs/items/b.md'))
  const rd = run(cfgOf(d, { artifacts: { status: 'docs/items' } })); assert.ok(ids(rd).includes('drift/unreadable/docs/items/b.md')); assert.equal(rd.find((f) => f.id === 'drift/work-item').status, 'PASS', '其余状态源照核')
  const e = mk(); put(e, 'docs/state/STATUS.md', '第一行\r- WI-0003\r第三行\n'); put(e, 'docs/state/work/.keep.md', '#\n')
  assert.equal(go(e, { artifacts: { status: 'docs/state/STATUS.md' } }).find((f) => f.id === 'drift/work-item-missing/WI-0003').where, 'docs/state/STATUS.md:2', '孤立 \\r 切行：WI-0003 在第 2 行')
})

test('docs_root 取默认时 ADR 判据的注记（变异 I10、I11、I12）：未声明 decisions 时补注记；声明了不补；没定位到 ADR 目录的那条也补', () => {
  const t = mk(); put(t, 'docs/decisions/README.md', '| ID | 文件 |\n|---|---|\n| ADR-0001 | ADR-0001-a.md |\n'); put(t, 'docs/decisions/ADR-0001-a.md', '# A\n'); put(t, 'docs/decisions/ADR-0002-b.md', '# B\n'); gitInit(t)
  const NOTE = 'docs_root 用的是默认 docs（未配 layout.docs_root）'
  const g = run({ _root: t }).find((f) => f.id === 'drift/adr-unindexed/ADR-0002'); assert.ok(g.evidence.endsWith('；' + NOTE), '未声明：ADR 目录在 docs_root 下找 → 补注记')
  const d = run({ _root: t, layout: DEC }).find((f) => f.id === 'drift/adr-unindexed/ADR-0002'); assert.ok(!d.evidence.includes('docs_root 用的是默认'), '声明了 decisions：不补')
  const u = mk(); put(u, 'docs/a.md', '#\n'); gitInit(u)
  assert.ok(run({ _root: u }).find((f) => f.id === 'drift/adr-dir-unlocated').evidence.includes(NOTE), '没定位到 ADR 目录：该条也补')
})

// ---- 第三轮盲区（期望值取自 Python 版实测）----
test('判据 1：滚日期的非法日期（2026-09-31 会被 Date.UTC 滚成 10-01，晚于基准日）不报（变异 D8）——Python 实测该输入只出 PASS', () => {
  const t = mk(); put(t, 'docs/a.md', '- 2026-09-31 裁定 X\n')
  const r = go(t).filter((f) => f.id.startsWith('drift/future-date')); assert.deepEqual(ids(r), ['drift/future-date']); assert.equal(r[0].status, 'PASS')
})

test('ADR 目录在 docs_root **之外**时，判据 2/3 读不了的文件各记 unreadable，且仍参与对账（变异 E36、F34）——放在 docs_root 之内会被判据 1 先报，once 去重后看不出判据 2/3 有没有吞掉', () => {
  const t = mk(); put(t, 'docs/a.md', '#\n'); put(t, 'adr/README.md', '| ID | 文件 |\n|---|---|\n| ADR-0001 | ADR-0001-a.md |\n'); put(t, 'adr/ADR-0001-a.md', 'x\n'); put(t, 'adr/ADR-0002-b.md', 'x\n'); gitInit(t)
  rmSync(join(t, 'adr/ADR-0002-b.md')); mkdirSync(join(t, 'adr/ADR-0002-b.md'))
  const a = run(cfgOf(t, { artifacts: { decisions: 'adr' } })); assert.ok(ids(a).includes('drift/unreadable/adr/ADR-0002-b.md')); assert.equal(a.find((f) => f.id === 'drift/adr-unindexed/ADR-0002').status, 'FAIL')
  const u = mk(); put(u, 'docs/a.md', '#\n'); put(u, 'adr/README.md', 'x\n'); put(u, 'adr/ADR-0001-a.md', 'x\n'); gitInit(u)
  rmSync(join(u, 'adr/README.md')); mkdirSync(join(u, 'adr/README.md'))
  const b = run(cfgOf(u, { artifacts: { decisions: 'adr' } })); assert.ok(ids(b).includes('drift/unreadable/adr/README.md'), '索引读不了：记 unreadable'); assert.equal(b.find((f) => f.id === 'drift/adr-revision').status, 'PASS', '判据 2 照判')
})

test('判据 3（变异 F4、F13、F21）：多个含「文件」的列取**第一个**（最后一个不存在也不影响）；「文件」列写仓内绝对路径是唯一途径时也找得到（Python 的 join 取绝对路径本身）；索引行 ID 格没有 ADR-数字的行整行跳过（不记成缺实物）', () => {
  const a = mk(); put(a, 'docs/decisions/README.md', '| ID | 文件 | 备份文件 |\n|---|---|---|\n| ADR-0011 | other/foo.md | nope.md |\n'); put(a, 'docs/decisions/other/foo.md', '# x\n')
  assert.equal(go(a, DEC).find((f) => f.id === 'drift/adr-index').status, 'PASS')
  const b = mk(); put(b, 'docs/decisions/sub/foo.md', '# x\n'); put(b, 'docs/decisions/README.md', `| ID | 文件 |\n|---|---|\n| ADR-0012 | ${join(b, 'docs', 'decisions', 'sub', 'foo.md').replaceAll('\\', '/')} |\n`)
  assert.equal(go(b, DEC).find((f) => f.id === 'drift/adr-index').status, 'PASS', '仓内绝对路径：唯一途径')
  const c = mk(); put(c, 'docs/decisions/README.md', '| ID | 文件 |\n|---|---|\n| 无编号 | x.md |\n'); put(c, 'docs/decisions/ADR-0001-a.md', '# A\n')
  const r = go(c, DEC); assert.ok(!ids(r).some((i) => i.startsWith('drift/adr-index-missing')), '无编号行不记缺实物'); assert.equal(r.find((f) => f.id === 'drift/adr-unindexed/ADR-0001').evidence, '实物 docs/decisions/ADR-0001-a.md；索引列出的 ID：（无）')
})

test('判据 4：状态源里的 \\x0c、U+2028 不是行终止符之外的东西——Python 的 splitlines 认它们，行号按它们计（变异 H15）', () => {
  for (const sep of ['\x0c', '\u2028']) {
    const t = mk(); put(t, 'docs/state/STATUS.md', `第一行${sep}- WI-0003${sep}第三行\n`); put(t, 'docs/state/work/.keep.md', '#\n')
    assert.equal(go(t, { artifacts: { status: 'docs/state/STATUS.md' } }).find((f) => f.id === 'drift/work-item-missing/WI-0003').where, 'docs/state/STATUS.md:2', JSON.stringify(sep))
  }
})

test('各判据互不拖累（变异 I3）：判据 1 单独抛异常（layout.frozen 的读取抛）时，记一条 internal-error 未定，判据 4 照出「没有状态文件」', () => {
  const t = mk(); put(t, 'docs/a.md', '- 2026-09-20 裁定\n'); gitInit(t)
  const r = run({ _root: t, layout: { docs_root: 'docs', get frozen() { throw new Error('炸') } } })
  assert.ok(r.some((f) => f.status === 'UNDETERMINED' && f.id.startsWith('drift/internal-error')), '判据 1 的异常被转成未定')
  assert.ok(r.some((f) => f.status === 'SKIP' && f.title.startsWith('没有状态文件')), '判据 4 不受拖累')
})

// ---- Ubuntu 上才暴露的盲区（期望值取自 Python 版实测）----
test('latestDay 不随机器时区漂（变异 B3，Ubuntu 容器是 UTC 所以 Windows 上被顺带抓住、Ubuntu 上没有）：在 UTC、UTC-7、UTC+14 三个时区的子进程里对同一刻（UTC 15:00）都得次日——UTC+14 下已是次日', () => {
  const code = `import { latestDay } from ${JSON.stringify(new URL('../lib/checks/drift.js', import.meta.url).href)}
console.log(JSON.stringify(latestDay(Date.UTC(2026, 8, 10, 15, 0, 0) / 1000)))`
  for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Tokyo']) {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, TZ: tz } })
    assert.deepEqual(JSON.parse(r.stdout), { year: 2026, month: 9, day: 11 }, `TZ=${tz}：UTC 15:00 在 UTC+14 下已是 9 月 11 日`)
  }
})

test('blame 行号取「最终行号」（行头第 3 个数字）而不是原文件行号（变异 C8）：未来日期写在旧提交里，之后在它**前面**插两行——它的原行号 2、最终行号 4，两者不同，where 必须是 :4（若取原行号 2，会指到第 2 行上一个根本不是候选的行，blame 对不上 → 报 lost）', () => {
  const t = mk(); put(t, 'docs/a.md', 'a\n- 2026-09-30 裁定 Z\nc\n'); gitInit(t, true, '2026-09-21T05:00:00+08:00')
  put(t, 'docs/a.md', 'a\nX\nY\n- 2026-09-30 裁定 Z\nc\n')
  spawnSync('git', ['-C', t, ...GID, 'commit', '-qam', 'm'], { env: { ...process.env, GIT_AUTHOR_DATE: '2026-09-22T05:00:00+08:00', GIT_COMMITTER_DATE: '2026-09-22T05:00:00+08:00' } })
  const r = run(cfgOf(t)).find((f) => f.id === 'drift/future-date/docs/a.md｜2026-09-30')
  assert.equal(r.where, 'docs/a.md:4'); assert.match(r.evidence, /^第 4 行：比较基准：git blame 提交时刻在 UTC\+14 下的日期 2026-09-21（/, '基准是写下它的旧提交（09-21），不是后来插行的那次（09-22）')
})

test('索引读不出表记**未定**而不是 FAIL（变异 F28）——「没有表」「没有 ID 列」两种都是', () => {
  const a = mk(); put(a, 'docs/decisions/README.md', '没有表\n'); put(a, 'docs/decisions/ADR-0001-a.md', '# A\n')
  assert.equal(go(a, DEC).find((f) => f.id.startsWith('drift/adr-index-unreadable/')).status, 'UNDETERMINED')
  const b = mk(); put(b, 'docs/decisions/README.md', '| 标题 | 文件 |\n|---|---|\n| a | b |\n'); put(b, 'docs/decisions/ADR-0001-a.md', '# A\n')
  assert.equal(go(b, DEC).find((f) => f.id.startsWith('drift/adr-index-unreadable/')).status, 'UNDETERMINED')
})

test('未声明 decisions 时，候选只在 docs_root 之下找：docs 下一个、docs 外另一个 → 取 docs 下的那个（唯一），不报多候选（变异 G6）；日期判据只扫 docs_root 之下，docs 外文档里的未来日期不看（变异 I13）', () => {
  const t = mk(); put(t, 'docs/decisions/ADR-0001-a.md', '# A\n'); put(t, 'elsewhere/decisions/ADR-0002-b.md', '# B\n'); put(t, 'elsewhere/b.md', '- 2026-09-30 裁定 X\n')
  const r = go(t, {})
  assert.ok(ids(r).includes('drift/adr-index-absent/docs/decisions'), '取 docs 下唯一的 decisions'); assert.ok(!ids(r).includes('drift/adr-dir-unlocated'), '不当多候选')
  assert.equal(r.find((f) => f.id === 'drift/future-date').status, 'PASS', 'docs 外的 elsewhere/b.md 里的未来日期不扫')
})

test('判据 4：状态文件里一个 WI- 都没有 → 不出任何 work-item 条目（无结论，不出 PASS）（变异 H16）', () => {
  const t = mk(); put(t, 'docs/state/STATUS.md', '# 状态\n\n没有任何工作项\n'); put(t, 'docs/state/work/WI-0001-x.md', '#\n')
  assert.deepEqual(ids(go(t, { artifacts: { status: 'docs/state/STATUS.md' } }).filter((f) => f.id.startsWith('drift/work'))), [])
})

test('scope：未声明 status 时写「（未声明）」（变异 J6）', () => assert.match(scope({}).covered[3], /^状态文件（layout\.artifacts\.status，当前 '（未声明）'；声明为目录时/))

test('scope：覆盖 4 条、未覆盖 10 条；词表条数写进未覆盖；归档区清单、docs_root 默认标注、未声明 decisions/status 的写法', () => {
  const s = scope({}); assert.equal(s.covered.length, 4); assert.equal(s.not_covered.length, 10)
  assert.match(s.covered[0], /^layout\.docs_root（当前 'docs'，默认）下 git 跟踪、不在 frozen 内的 \*\.md：日期后 10 字内带动作词且左侧 6 字内不带计划词/); assert.match(s.not_covered[0], /日期动作词 18 个、ADR 修订标记词 9 个/)
  assert.match(s.not_covered[8], /^\*\*归档区（layout\.frozen：未配置）整体不看\*\*/); assert.match(s.covered[1], /layout\.artifacts\.decisions，当前 '（未声明）'；未声明则在 docs_root 内找名为 decisions/)
  const s2 = scope({ layout: { frozen: ['docs/old', 'x'], docs_root: 'manual', artifacts: { decisions: 'docs/dec', status: 'docs/st.md' } } })
  assert.match(s2.covered[0], /^layout\.docs_root（当前 'manual'）下/); assert.match(s2.covered[1], /当前 'docs\/dec'/); assert.match(s2.covered[3], /^状态文件（layout\.artifacts\.status，当前 'docs\/st\.md'/); assert.match(s2.not_covered[8], /layout\.frozen：docs\/old、x）/)
})
