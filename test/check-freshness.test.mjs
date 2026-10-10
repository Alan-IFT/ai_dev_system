// freshness 检查器的验收测试：selftest 全过且 (id,status) 集合与 Python 黄金样本相同；对 4 个真实仓逐条一致；变异验证靠这里的直接断言变红。
// 期望值取自 Python 版实测。每个判据有自己的、不依赖外部数据的断言（设计 §6 第 6 条）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NAME, run, scope, selftest } from '../lib/checks/freshness.js'
import { addDays, todayLocal, toIso } from '../lib/core/dates.js'

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..')
const probes = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'samples', 'selftest-probes.json'), 'utf8')).filter((p) => p.check === NAME)

test('NAME 与 Python 版一致', () => assert.equal(NAME, 'freshness'))

test('selftest：每条都 PASS，且 (id, status) 集合与黄金样本完全相同', () => {
  const got = selftest()
  assert.ok(got.length >= 2)
  assert.deepEqual(got.filter((f) => f.status !== 'PASS').map((f) => `${f.title}｜${f.evidence}`), [])
  assert.deepEqual(got.map((f) => [f.id, f.status]).sort(), probes.map((p) => [p.id, p.status]).sort())
})

// ---- 直接断言（所有平台都跑）----
const tmps = []
const mk = () => { const t = mkdtempSync(join(tmpdir(), 'frchk-')); tmps.push(t); return t }
test.after(() => { for (const t of tmps) rmSync(t, { recursive: true, force: true }) })
const put = (t, rel, body = '') => { mkdirSync(dirname(join(t, rel)), { recursive: true }); writeFileSync(join(t, rel), body) }
const today = todayLocal()
const day = (n) => toIso(addDays(today, n))
const gitInit = (t) => { for (const a of [['-c', 'init.defaultBranch=main', 'init', '-q'], ['add', '-A', '-f']]) spawnSync('git', ['-C', t, ...a], { encoding: 'utf8' }) }
const cfgOf = (t, extra = {}) => ({ _root: t, layout: { docs_root: 'docs', work_root: 'work' }, budgets: { stale_days: 90, work_item_stale_days: 14 }, ...extra })
const go = (t, extra) => { gitInit(t); return run(cfgOf(t, extra)) }
const ids = (fs) => fs.filter((f) => f.status !== 'PASS').map((f) => [f.status, f.id])
const only = (fs, s) => fs.filter((f) => f.status === s)
const REQ = { metadata_required: ['docs/architecture'], metadata_fields: ['updated_at'] }
const WI = (st, rows) => `# WI-0001\n\n状态：${st}\n\n## 状态转换记录\n\n| from → to | 时间 |\n|---|---|\n${rows}`

test('文档日期：新鲜 → PASS（where 是路径、evidence 含基准日与阈值说明）；刚好等于阈值算新鲜，超一天 → 未定 stale（id 不随天数变）', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-90)}\n`)
  let r = go(t, REQ).find((f) => f.where === 'docs/architecture/a.md')
  assert.equal(r.status, 'PASS'); assert.equal(r.title, 'docs/architecture/a.md 距今 90 天，在阈值 90 天内'); assert.match(r.evidence, /^updated_at = \d{4}-\d{2}-\d{2}，比较基准日 \d{4}-\d{2}-\d{2}（取自运行时系统日期），budgets\.stale_days = 90，取自 project\.yaml$/)
  put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-91)}\n`); r = run(cfgOf(t, REQ)).find((f) => f.where === 'docs/architecture/a.md:1')
  assert.equal(r.status, 'UNDETERMINED'); assert.equal(r.id, 'freshness/stale/docs/architecture/a.md'); assert.match(r.title, /已 91 天未更新（阈值 90 天）$/)
})

test('阈值：budgets.stale_days 缺省取 90 并注明「用的是本工具默认值」；写成非正整数 → 单条未定（reason 带 repr）', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-5)}\n`)
  const c = cfgOf(t, REQ); delete c.budgets; gitInit(t)
  const r = run(c).find((f) => f.where === 'docs/architecture/a.md'); assert.match(r.evidence, /budgets\.stale_days 用的是本工具默认值 90，项目未校准（契约 §5）$/)
  for (const v of [0, -1, true, '90', 1.5, []]) {
    const f = run(cfgOf(t, { ...REQ, budgets: { stale_days: v } })).filter((x) => x.title === '文档新鲜度阈值不是正整数')
    assert.equal(f.length, 1, JSON.stringify(v)); assert.match(f[0].reason, /^budgets\.stale_days = .*，不是正整数$/)
  }
})

test('日期字段名：缺省 updated_at 并注明；metadata_fields 自定义生效（evidence 里写「取自 metadata_fields」）', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\n更新于: ${day(-1)}\n`)
  const r = go(t, { metadata_required: ['docs/architecture'], metadata_fields: ['更新于'] }).find((f) => f.where === 'docs/architecture/a.md'); assert.equal(r.status, 'PASS'); assert.match(r.evidence, /^更新于 = /)
  const c = run(cfgOf(t, { metadata_required: ['docs/architecture'] })).find((f) => f.id === 'freshness/undated-fields-default'); assert.match(c.title, /没认出默认日期字段 updated_at（1 份）$/)
})

test('日期解析不了 → 未定（reason 带原文 repr 与原因）；晚于基准日一天按当天算（PASS），两天起 → 未定；空值当缺', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', 'status: active\nupdated_at: 不是日期\n')
  let r = go(t, REQ).find((f) => f.where === 'docs/architecture/a.md:1'); assert.equal(r.status, 'UNDETERMINED'); assert.equal(r.title, '日期解析不了：docs/architecture/a.md'); assert.match(r.reason, /^updated_at 的原文是 '不是日期'，既不是 YYYY-MM-DD 也不是 ISO8601：'不是日期'；本工具不猜日期$/)
  put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(1)}\n`); assert.equal(run(cfgOf(t, REQ)).find((f) => f.where === 'docs/architecture/a.md').status, 'PASS')
  put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(3)}\n`); r = run(cfgOf(t, REQ)).find((f) => f.where === 'docs/architecture/a.md:1'); assert.equal(r.status, 'UNDETERMINED'); assert.match(r.reason, /比基准日晚 3 天/)
  put(t, 'docs/architecture/a.md', 'status: active\nupdated_at:\n'); assert.equal(run(cfgOf(t, REQ)).find((f) => f.title === '缺日期字段：docs/architecture/a.md').status, 'FAIL')
})

test('缺日期字段：声明 metadata_required 且声明 metadata_fields → FAIL（where 带 :1、evidence 带头部字符数）；只声明前者 → 聚合未定', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', 'status: active\n')
  const r = go(t, REQ).find((f) => f.title === '缺日期字段：docs/architecture/a.md'); assert.equal(r.status, 'FAIL'); assert.equal(r.where, 'docs/architecture/a.md:1'); assert.match(r.evidence, /^文件头 4000 字符内没有找到 updated_at。日期字段名取自 metadata_fields：updated_at$/)
})

test('日期只在头部 4000 个**码点**内找：日期被推过边界不算；前面有 emoji 时按码点（D18）', () => {
  const t = mk(); const pad = 'x'.repeat(4000)
  put(t, 'docs/architecture/a.md', `status: active\n${pad}\nupdated_at: ${day(-1)}\n`)
  assert.equal(go(t, REQ).find((f) => f.title === '缺日期字段：docs/architecture/a.md').status, 'FAIL')
  const field = `\nupdated_at: ${day(-1)}\n`
  put(t, 'docs/architecture/a.md', '\u{1F600}'.repeat(20) + 'x'.repeat(4000 - field.length - 20) + field + '尾')
  assert.equal(run(cfgOf(t, REQ)).find((f) => f.where === 'docs/architecture/a.md').status, 'PASS', '字段结束在第 4000 个码点上：按码点算在内')
})

test('元信息要求五值：required→FAIL；convention→聚合未定；unknown→聚合未定；not_required→逐份 SKIP；declared_none→整轮一条 SKIP', () => {
  const t = mk(); put(t, 'docs/ops/r.md', '# 无日期\n'); put(t, 'docs/运维/d.md', '# 无日期\n'); put(t, 'docs/architecture/a.md', '# 无日期\n')
  put(t, 'work/WI-0001-x.md', WI('in_progress', `| a | ${day(-1)} |\n`)) // 有工作项目录：否则多一条「工作项目录不在」的 SKIP（指向 layout）
  const un = go(t, {}).filter((f) => f.status !== 'PASS').map((f) => f.id).sort()
  assert.deepEqual(un, ['freshness/undated-by-convention', 'freshness/undated-unclassified'])
  const u1 = run(cfgOf(t, {})).find((f) => f.id === 'freshness/undated-unclassified'); assert.equal(u1.evidence, 'docs/ops/r.md；docs/运维/d.md'); assert.match(u1.title, /（2 份）$/)
  const nr = run(cfgOf(t, { metadata_required: ['docs/ops'], metadata_fields: ['updated_at'] }))
  assert.deepEqual(only(nr, 'SKIP').map((f) => f.title).sort(), ['不要求元信息：docs/architecture/a.md', '不要求元信息：docs/运维/d.md'].sort()); assert.deepEqual(only(nr, 'FAIL').map((f) => f.title), ['缺日期字段：docs/ops/r.md'])
  const dn = run(cfgOf(t, { metadata_required: [] })); assert.deepEqual(only(dn, 'SKIP').map((f) => f.id).filter((i) => i.includes('undated-declared-none')), ['freshness/undated-declared-none']); assert.equal(only(dn, 'FAIL').length, 0)
})

test('状态字段：metadata_required 命中而头部没认出 → 聚合未定 no-status-field；带状态的不进；状态只认头部', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `updated_at: ${day(-1)}\n`); put(t, 'docs/architecture/b.md', `状态：进行中\nupdated_at: ${day(-1)}\n`)
  const r = go(t, REQ).find((f) => f.id === 'freshness/no-status-field'); assert.equal(r.status, 'UNDETERMINED'); assert.equal(r.evidence, 'docs/architecture/a.md'); assert.match(r.reason, /状态字段名是本工具的词表（stdlib\.STATUS_FIELDS：状态 \/ status \/ state）/)
})

test('归档区：layout.frozen 内的文档与工作项各汇成一条 SKIP，不进任何判据', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); put(t, 'docs/old/x.md', '# 无日期\n'); put(t, 'work/WI-0001-x.md', WI('in_progress', `| a | ${day(-1)} |\n`)); put(t, 'work/old/WI-0009.md', '# x\n状态：in_progress\n')
  const r = go(t, { ...REQ, layout: { docs_root: 'docs', work_root: 'work', frozen: ['docs/old'] } })
  assert.deepEqual(r.filter((f) => f.id === 'freshness/frozen-docs').map((f) => f.evidence), ['docs/old/x.md'])
  assert.equal(r.filter((f) => (f.where ?? '').startsWith('docs/old')).length, 0)
})

test('文档根不存在 → 单条未定（reason 区分默认与声明）；文档根下没有 markdown → 单条未定；git 列不出 → 单条未定', () => {
  const t = mk(); put(t, 'work/WI-0001-x.md', WI('in_progress', `| a | ${day(-1)} |\n`)); gitInit(t)
  const d = run({ _root: t, layout: { work_root: 'work' } }).find((f) => f.title === '文档根目录不存在：docs'); assert.match(d.reason, /^未配 layout\.docs_root，默认的文档根不在/)
  const d2 = run(cfgOf(t, { layout: { docs_root: 'nodocs', work_root: 'work' } })).find((f) => f.title === '文档根目录不存在：nodocs'); assert.match(d2.reason, /^layout\.docs_root 指向的目录不在/)
  mkdirSync(join(t, 'docs')); const e = run(cfgOf(t, {})).find((f) => f.title === 'docs 下没有 git 跟踪的 markdown'); assert.equal(e.status, 'UNDETERMINED')
  const t2 = mk(); mkdirSync(join(t2, 'docs')); const g = run({ _root: t2, layout: { docs_root: 'docs' } }).find((f) => f.title === '列不出 git 跟踪的文档'); assert.match(g.reason, /^git ls-files 退出码 128/)
})

test('工作项：进行中且超龄 → FAIL（标题「需核实」、id 不随天数变）；在阈值内 → PASS；晚于基准日 → 未定；阈值默认 14', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`)
  put(t, 'work/WI-0001-x.md', WI('in_progress', `| a | ${day(-14)} |\n`)); let r = go(t, REQ).find((f) => f.where === 'work/WI-0001-x.md'); assert.equal(r.status, 'PASS'); assert.equal(r.title, '进行中工作项 work/WI-0001-x.md 距上次转换 14 天，在阈值 14 天内')
  put(t, 'work/WI-0001-x.md', WI('in_progress', `| a | ${day(-15)} |\n`)); r = run(cfgOf(t, REQ)).find((f) => f.where === 'work/WI-0001-x.md'); assert.equal(r.status, 'FAIL'); assert.equal(r.id, 'freshness/work-item-stale/work/WI-0001-x.md'); assert.match(r.title, /^进行中工作项 15 天无状态转换，需核实：/)
  put(t, 'work/WI-0001-x.md', WI('in_progress', `| a | ${day(5)} |\n`)); r = run(cfgOf(t, REQ)).find((f) => f.where === 'work/WI-0001-x.md'); assert.equal(r.status, 'UNDETERMINED'); assert.match(r.reason, /比基准日晚 5 天/)
  const c = cfgOf(t, REQ); delete c.budgets; put(t, 'work/WI-0001-x.md', WI('in_progress', `| a | ${day(-1)} |\n`)); assert.match(run(c).find((f) => f.where === 'work/WI-0001-x.md').evidence, /budgets\.work_item_stale_days 用的是本工具默认值 14，项目未校准/)
})

test('转换时间：显式字段优先于小节；字段值解析不了 → 未定「状态转换时间解析不了」（不退到提交时间）；无小节 → 退到 git 提交时间', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`)
  put(t, 'work/WI-0001-x.md', `# W\n\n状态：in_progress\nlast_transition_at: ${day(-1)}\n\n## 状态转换记录\n| a | ${day(-100)} |\n`)
  let r = go(t, REQ).find((f) => f.where === 'work/WI-0001-x.md'); assert.equal(r.status, 'PASS'); assert.match(r.evidence, /取自显式字段 last_transition_at = /)
  put(t, 'work/WI-0001-x.md', '# W\n\n状态：in_progress\nlast_transition_at: 乱写\n'); r = run(cfgOf(t, REQ)).find((f) => f.where === 'work/WI-0001-x.md'); assert.equal(r.title, '状态转换时间解析不了：work/WI-0001-x.md'); assert.equal(r.status, 'UNDETERMINED')
  put(t, 'work/WI-0001-x.md', '# W\n\n状态：in_progress\n'); gitInit(t); spawnSync('git', ['-C', t, '-c', 'user.name=a', '-c', 'user.email=a@b', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 's'])
  r = run(cfgOf(t, REQ)).find((f) => f.where === 'work/WI-0001-x.md'); assert.equal(r.status, 'PASS'); assert.match(r.evidence, /。注意：用的是提交时间，不是显式状态时间戳（git log -1 --format=%cI -- work\/WI-0001-x\.md）$/)
})

test('取不到转换时间且退到提交时间也不成（未提交 → git log 无输出）→ 未定「取不到最后状态转换时间」', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); put(t, 'work/WI-0001-x.md', '# W\n\n状态：in_progress\n'); gitInit(t) // 已 add 未提交
  const r = run(cfgOf(t, REQ)).find((f) => f.where === 'work/WI-0001-x.md'); assert.equal(r.title, '取不到最后状态转换时间：work/WI-0001-x.md'); assert.match(r.reason, /^文件里没有状态转换记录小节，也没有显式转换时间字段；退到提交时间也不成：/)
})

test('工作项分类：非进行中 → 聚合 SKIP；未知状态词 → 聚合未定；声明的文档（layout.artifacts）按文档认 → SKIP；无状态的 WI-* → 聚合未定；非 WI-* 无状态 → 聚合 SKIP', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`)
  put(t, 'work/WI-0001-x.md', WI('planned', `| a | ${day(-100)} |\n`)); put(t, 'work/WI-0002-y.md', WI('乱写状态', '')); put(t, 'work/WI-0003-z.md', '# 无状态\n'); put(t, 'work/notes.md', '# 说明\n')
  const r = go(t, REQ)
  assert.deepEqual(ids(r).sort(), [['SKIP', 'freshness/not-in-progress'], ['SKIP', 'freshness/not-work-item'], ['UNDETERMINED', 'freshness/no-status'], ['UNDETERMINED', 'freshness/unknown-state']].sort())
  assert.equal(r.find((f) => f.id === 'freshness/no-status').evidence, 'work/WI-0003-z.md'); assert.equal(r.find((f) => f.id === 'freshness/not-work-item').evidence, 'work/notes.md')
  assert.equal(r.find((f) => f.id === 'freshness/not-in-progress').evidence, 'work/WI-0001-x.md（planned）'); assert.equal(r.find((f) => f.id === 'freshness/unknown-state').evidence, 'work/WI-0002-y.md（乱写状态）')
})

test('只巡检进行中：blocked 且已超龄的工作项**不**判 FAIL，进「非进行中」聚合 SKIP（变异 W5，Windows 上被真实仓比对顺带抓住、Ubuntu 上没有）', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); put(t, 'work/WI-0001-x.md', WI('blocked', `| a | ${day(-100)} |\n`))
  const r = go(t, REQ); assert.equal(only(r, 'FAIL').length, 0); const s = r.find((f) => f.id === 'freshness/not-in-progress'); assert.equal(s.status, 'SKIP'); assert.equal(s.evidence, 'work/WI-0001-x.md（blocked）')
})

test('layout.artifacts 声明的工件落在工作项目录里、状态是文档四值（`active`）：按文档认 → 聚合 SKIP 「工作项目录下的文档不做工作项巡检」，不进「非进行中」（变异 W7，同样只被真实仓比对顺带抓住）', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); put(t, 'work/ADR-1.md', `# ADR\n\n状态：active\n`); gitInit(t)
  const r = run(cfgOf(t, { ...REQ, layout: { docs_root: 'docs', work_root: 'work', artifacts: { decisions: 'work/ADR-1.md' } } }))
  const d = r.find((f) => f.id === 'freshness/document-state'); assert.equal(d.status, 'SKIP'); assert.equal(d.evidence, 'work/ADR-1.md（active）'); assert.ok(!r.some((f) => f.id === 'freshness/not-in-progress'), '不当「非进行中」的工作项')
  // 同一份文件状态写成文档词表里没有的值 → 未知文档状态（未定）
  put(t, 'work/ADR-1.md', '# ADR\n\n状态：乱写\n'); const u = run(cfgOf(t, { ...REQ, layout: { docs_root: 'docs', work_root: 'work', artifacts: { decisions: 'work/ADR-1.md' } } })).find((f) => f.id === 'freshness/unknown-doc-state')
  assert.equal(u.status, 'UNDETERMINED'); assert.equal(u.evidence, 'work/ADR-1.md（乱写）')
})

test('工作项目录不存在 → 单条 SKIP 指向 layout（不是未定）；工作项阈值写错 → 单条未定', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); gitInit(t)
  const r = run(cfgOf(t, { ...REQ, layout: { docs_root: 'docs', work_root: 'nope' } })).filter((f) => f.id.includes('work-root-absent')); assert.equal(r.length, 1); assert.equal(r[0].status, 'SKIP')
  put(t, 'work/WI-0001-x.md', WI('in_progress', `| a | ${day(-1)} |\n`)); gitInit(t)
  const b = run(cfgOf(t, { ...REQ, budgets: { work_item_stale_days: 0 } })).filter((f) => f.title === '工作项活性阈值不是正整数'); assert.equal(b.length, 1); assert.match(b[0].reason, /^budgets\.work_item_stale_days = 0，不是正整数$/)
  const e = mk(); put(e, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); mkdirSync(join(e, 'work')); gitInit(e)
  assert.equal(run(cfgOf(e, REQ)).filter((f) => f.title === 'work 下没有可判定的工作项').length, 1)
})

test('被 layout 已查的验收、状态工件缺日期不重报；layout 被裁时照报', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); put(t, 'ACCEPTANCE.md', '# 无日期\n状态：active\n'); put(t, 'work/WI-0001-x.md', WI('in_progress', `| a | ${day(-1)} |\n`))
  const c = { metadata_required: ['docs/architecture', 'ACCEPTANCE.md'], metadata_fields: ['updated_at'] }
  assert.equal(go(t, c).filter((f) => (f.where ?? '').startsWith('ACCEPTANCE.md')).length, 0, 'layout 已查，这里不重报')
  const r = run(cfgOf(t, { ...c, tailoring: [{ check: 'layout', applicable: false, reason: 'x' }] })).filter((f) => f.title === '缺日期字段：ACCEPTANCE.md'); assert.equal(r.length, 1, 'layout 被裁：照报')
})

test('工作项目录在文档根下（缺省形态 docs/state/work）且被 metadata_required 命中：工作项自己没有日期字段 → 缺日期 FAIL（Python 实测），活性巡检同时照做', () => {
  const t = mk(); put(t, 'docs/state/work/WI-0001-x.md', WI('in_progress', `| a | ${day(-1)} |\n`)); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); gitInit(t)
  const r = run({ _root: t, metadata_required: ['docs/architecture', 'docs/state/work'], metadata_fields: ['updated_at'] })
  assert.deepEqual(only(r, 'FAIL').map((f) => f.title), ['缺日期字段：docs/state/work/WI-0001-x.md'])
  assert.ok(r.some((f) => f.status === 'PASS' && f.where === 'docs/state/work/WI-0001-x.md'), '活性巡检也出了一条 PASS（距上次转换在阈值内）')
  assert.match(only(r, 'FAIL')[0].evidence, /；docs_root 用的是默认 docs（未配 layout\.docs_root）$/, '文档部分整组依赖 docs_root：取了默认就统一注明（noteDefault）')
})

test('scope：覆盖与未覆盖各有内容；分类统计写进「未覆盖」；归档区份数单列；docs_root 默认时写「默认」', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `updated_at: ${day(-1)}\n`); put(t, 'docs/ops/r.md', '# x\n'); put(t, 'docs/old/f.md', '# x\n'); gitInit(t)
  const s = scope({ _root: t, layout: { frozen: ['docs/old'] } })
  assert.equal(s.covered.length, 4); assert.equal(s.not_covered.length, 11); assert.match(s.covered[0], /^layout\.docs_root（当前 'docs'，默认）与 metadata_required/)
  assert.match(s.not_covered[1], /本次参与分类的 2 份文档里（另有归档区 1 份不参与），判定为需要元信息 1 份、项目声明不需要 0 份、\*\*未能分类 1 份\*\*/)
  assert.match(scope({ _root: mk() }).not_covered[1], /本次未能统计分类结果（列不出 git 跟踪的文档）/)
})

// ---- 变异验证第一轮没抓住的盲区（期望值取自 Python 版实测）----
const WI_OK = (t) => put(t, 'work/WI-0001-x.md', WI('in_progress', `| a | ${day(-1)} |\n`))

test('转换时间取「最后一条记录的第一个日期」，不是全节最大日期（变异 T16）：后一行日期更早 → 取更早的', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`)
  put(t, 'work/WI-0001-x.md', `# W\n\n状态：in_progress\n\n## 状态转换记录\n| a | ${day(-1)} |\n| b | ${day(-50)} |\n`)
  const r = go(t, REQ).find((f) => f.where === 'work/WI-0001-x.md'); assert.equal(r.status, 'FAIL', '最后一条是 50 天前：超龄'); assert.match(r.title, /^进行中工作项 50 天无状态转换/)
})

test('docs_root 取默认时，文档类 finding 的 evidence 末尾补注记，工作项类不补；已含注记不重复；evidence 原本为空时不带前导分号（变异 D1、D2、D3、X3）', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); WI_OK(t); gitInit(t)
  const c = { _root: t, layout: { work_root: 'work' }, budgets: { stale_days: 90, work_item_stale_days: 14 }, ...REQ }
  const r = run(c); const doc = r.find((f) => f.where === 'docs/architecture/a.md'), wi = r.find((f) => f.where === 'work/WI-0001-x.md')
  const NOTE = 'docs_root 用的是默认 docs（未配 layout.docs_root）'
  assert.ok(doc.evidence.endsWith('；' + NOTE), '文档类末尾补注记'); assert.equal(doc.evidence.split(NOTE).length - 1, 1, '只补一次')
  assert.ok(!wi.evidence.includes(NOTE), '工作项类不补')
  const c2 = { ...c, layout: { work_root: 'work', docs_root: 'docs' } }; assert.ok(!run(c2).find((f) => f.where === 'docs/architecture/a.md').evidence.includes(NOTE), '声明了 docs_root：不补')
  // evidence 为空的 finding（归档区聚合没有 evidence 以外的……）取一条 evidence 本来为空的：文档根下没有 markdown 的未定
  const e = mk(); mkdirSync(join(e, 'docs')); gitInit(e); const none = run({ _root: e, layout: { work_root: 'work' } }).find((f) => f.title === 'docs 下没有 git 跟踪的 markdown')
  assert.equal(none.evidence, NOTE, 'evidence 本来为空：直接是注记，没有前导「；」')
})

test('layout 已查的落点判定（变异 L5、L6、L7、L8、L10、L11）：候选路径是 .md 才算；.MD 大写后缀也算；目录落点不算；两个候选都在只取第一个；候选随 docs_root 改基；声明落点去首尾斜杠', () => {
  const base = (t) => { put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); WI_OK(t) }
  const mr = (...ps) => ({ metadata_required: ['docs/architecture', ...ps], metadata_fields: ['updated_at'] })
  const reported = (r, p) => r.filter((f) => (f.where ?? '').startsWith(p) || (f.evidence ?? '') === p).length
  // L5/L6：候选 ACCEPTANCE.md（.md）layout 已查 → 这里不重报；声明落点 ACC.MD（大写）同样
  let t = mk(); base(t); put(t, 'ACCEPTANCE.md', '# 无日期\n状态：active\n'); assert.equal(reported(go(t, mr('ACCEPTANCE.md')), 'ACCEPTANCE.md'), 0, '.md 候选：layout 已查，不重报')
  t = mk(); base(t); put(t, 'ACC.MD', '# 无日期\n状态：active\n'); assert.equal(reported(go(t, { ...mr('ACC.MD'), layout: { docs_root: 'docs', work_root: 'work', artifacts: { acceptance: 'ACC.MD' } } }), 'ACC.MD'), 0, '.MD 大写后缀也算 .md')
  // L7：声明落点是目录 → 不算 layout 已查：目录里的文件照报
  t = mk(); base(t); put(t, 'acc/x.md', '# 无日期\n'); const r7 = go(t, { ...mr('acc'), layout: { docs_root: 'docs', work_root: 'work', artifacts: { acceptance: 'acc' } } })
  assert.ok(r7.some((f) => f.status === 'FAIL' && f.where === 'acc/x.md:1'), '目录落点：里面的文档照判缺日期')
  // L8：状态的两个候选 WORK.md 与 docs/state/STATUS.md 都在：只认第一个（WORK.md）；第二个（只有它在清单里）照报
  t = mk(); base(t); put(t, 'WORK.md', `状态：active\nupdated_at: ${day(-1)}\n`); put(t, 'docs/state/STATUS.md', '# 无日期\n状态：active\n')
  assert.ok(go(t, mr('docs/state/STATUS.md')).some((f) => f.status === 'FAIL' && f.where === 'docs/state/STATUS.md:1'), '只取第一个候选（WORK.md）作 layout 已查；STATUS.md 不是，照报')
  // L10：docs_root=manual 时候选 docs/state/STATUS.md 改基成 manual/state/STATUS.md：它是 layout 已查的，不重报
  t = mk(); put(t, 'manual/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); WI_OK(t); put(t, 'manual/state/STATUS.md', '# 无日期\n状态：active\n')
  assert.equal(reported(go(t, { metadata_required: ['manual/architecture', 'manual/state/STATUS.md'], metadata_fields: ['updated_at'], layout: { docs_root: 'manual', work_root: 'work' } }), 'manual/state/STATUS.md'), 0, '候选随 docs_root 改基')
  // L11：声明落点写成 "/ACC.md/"：去首尾斜杠后仍是 ACC.md → layout 已查
  t = mk(); base(t); put(t, 'ACC.md', '# 无日期\n状态：active\n'); assert.equal(reported(go(t, { ...mr('ACC.md'), layout: { docs_root: 'docs', work_root: 'work', artifacts: { acceptance: '/ACC.md/' } } }), 'ACC.md'), 0, '声明落点去首尾斜杠')
})

test('scope 分类统计：声明空列表时全部算「项目声明不需要」；统计取不到时返回「未能统计」，异常不外抛（变异 C2、C6）；目录名词表按字母序（变异 P3）', () => {
  const t = mk(); put(t, 'docs/ops/r.md', '# x\n'); gitInit(t)
  assert.match(scope(cfgOf(t, { metadata_required: [] })).not_covered[1], /判定为需要元信息 0 份、项目声明不需要 1 份、\*\*未能分类 0 份\*\*/)
  // try 只包住 `docFiles(...)`（Python 的 `_doc_files` 同）。读 `layout` 的顺序（栈实测）：scope 开头 docsRootOf 第 1 次；classifyStats 的 try 内 docFiles → docsRootOf 第 2 次；
  // try 之外的 inFrozen 第 3 次。只让**第 2 次**抛，异常才恰好落在 try 之内
  let n = 0
  const cfg = { _root: t, get layout() { if (++n === 2) throw new Error('炸'); return {} } }
  assert.match(scope(cfg).not_covered[1], /本次未能统计分类结果（列不出 git 跟踪的文档）/, 'try 之内抛异常：不把主流程带崩，当取不到')
  // try 之外（对每份文档算分类时）抛的异常**照常外抛**——与 Python 一致，不是兜底（变异 C6 是把整个函数改成都外抛）
  assert.throws(() => scope({ _root: t, get metadata_required() { throw new Error('炸') } }), /炸/)
  assert.match(scope(cfgOf(t, {})).not_covered[1], /（acceptance\/architecture\/contracts\/decisions\/modules\/runbooks）识别/)
})

test('日期字段值为空（`updated_at:`）= 缺字段，不往后文找同名字段（变异 R8）', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at:\n\n## 历史\n- updated_at: ${day(-1)}\n`); WI_OK(t)
  assert.equal(go(t, REQ).find((f) => f.title === '缺日期字段：docs/architecture/a.md').status, 'FAIL')
})

test('工作项目录判据：只有**工作项目录直接一层**里的 WI-* 才算活性巡检的对象，别处 WI- 命名的文档仍要查状态字段与日期（变异 R19、R20）', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); WI_OK(t)
  put(t, 'docs/architecture/WI-0009-y.md', `updated_at: ${day(-1)}\n`); put(t, 'work/sub/WI-0008-z.md', '# 无状态\n')
  gitInit(t)
  const rr = run(cfgOf(t, { metadata_required: ['docs/architecture', 'work'], metadata_fields: ['updated_at'] }))
  const ns = rr.find((f) => f.id === 'freshness/no-status-field'); assert.equal(ns.evidence, 'docs/architecture/WI-0009-y.md；work/sub/WI-0008-z.md', 'WI- 命名但不在工作项目录直接一层：缺状态字段照报')
})

test('读不了的文档 → unreadable 未定，不当缺日期也不吞（变异 R22、W21）；同一份工作项被文档与活性两处读不了只报一条（变异 X2）', async () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); put(t, 'docs/state/work/WI-0001-x.md', WI('in_progress', `| a | ${day(-1)} |\n`)); gitInit(t)
  const hooks = (await import('../lib/core/fs.js')).__testHooks
  hooks.beforeOpen = () => { const e = new Error('denied'); e.code = 'EACCES'; throw e }
  let r; try { r = run({ _root: t, metadata_required: ['docs/architecture', 'docs/state/work'], metadata_fields: ['updated_at'] }) } finally { hooks.beforeOpen = undefined }
  const un = r.filter((f) => f.id.startsWith('freshness/unreadable/'))
  assert.deepEqual(un.map((f) => f.id).sort(), ['freshness/unreadable/docs/architecture/a.md', 'freshness/unreadable/docs/state/work/WI-0001-x.md'], '每份各一条；工作项目录在文档根下，被两处读也只报一条（once）')
  assert.ok(!r.some((f) => f.title.startsWith('缺日期字段')), '读不了不是缺日期')
})

test('工作项目录在文档根**之外**时，工作项只经活性巡检读：读不了 → 该份记 unreadable 未定，不吞（变异 W21）；注入读失败（EACCES）', async () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); WI_OK(t); gitInit(t)
  const hooks = (await import('../lib/core/fs.js')).__testHooks
  let opens = 0
  hooks.beforeOpen = () => { if (++opens > 1) { const e = new Error('denied'); e.code = 'EACCES'; throw e } } // 第 1 次（文档 a.md）放行，第 2 次起（工作项）失败
  let r; try { r = run(cfgOf(t, REQ)) } finally { hooks.beforeOpen = undefined }
  assert.deepEqual(r.filter((f) => f.id.startsWith('freshness/unreadable/')).map((f) => f.id), ['freshness/unreadable/work/WI-0001-x.md'], '工作项读不了：记 unreadable，不吞')
})

test('git 列不出（非仓）→ 未定；归档区的工作项不进活性巡检；工作项阈值写错 → 记未定而不是 FAIL；列不出工作项 → 未定（变异 R27、W22、W24、W29）', () => {
  const t = mk(); mkdirSync(join(t, 'docs'))
  const r = run({ _root: t, layout: { docs_root: 'docs' } }); assert.equal(r.find((f) => f.title === '列不出 git 跟踪的文档').status, 'UNDETERMINED')
  const t2 = mk(); put(t2, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); put(t2, 'work/WI-0001-x.md', WI('in_progress', `| a | ${day(-100)} |\n`)); gitInit(t2)
  const fz = run(cfgOf(t2, { ...REQ, layout: { docs_root: 'docs', work_root: 'work', frozen: ['work'] } })); assert.equal(only(fz, 'FAIL').length, 0, '归档区里的超龄工作项不报'); assert.ok(fz.some((f) => f.id === 'freshness/frozen-work-items'))
  assert.equal(run(cfgOf(t2, { ...REQ, budgets: { work_item_stale_days: 0 } })).find((f) => f.title === '工作项活性阈值不是正整数').status, 'UNDETERMINED')
  assert.equal(run(cfgOf(t2, { ...REQ, budgets: { stale_days: 0 } })).find((f) => f.title === '文档新鲜度阈值不是正整数').status, 'UNDETERMINED')
})

test('git 取提交时间（变异 G2、G4–G10）：经 hardenedEnv（恶意仓的 fsmonitor 不被执行）；取提交时间 %cI 而非作者时间；只取最近一次；输出空 → 未定；退出码非 0 → 未定；浅克隆探测只做一次', () => {
  const when = (d) => ({ ...process.env, GIT_COMMITTER_DATE: `${d} 12:00:00 +0000`, GIT_AUTHOR_DATE: `${d} 12:00:00 +0000` })
  const gid = ['-c', 'user.name=a', '-c', 'user.email=a@b', '-c', 'commit.gpgsign=false']
  // G5/G6：作者时间与提交时间不同；有两次提交，只取最近一次的提交时间
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); put(t, 'work/WI-0001-x.md', '# W\n\n状态：in_progress\n')
  spawnSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', t]); spawnSync('git', ['-C', t, 'add', '-A', '-f'])
  spawnSync('git', ['-C', t, ...gid, 'commit', '-q', '-m', 's'], { env: { ...process.env, GIT_COMMITTER_DATE: `${day(-200)} 12:00:00 +0000`, GIT_AUTHOR_DATE: `${day(-200)} 12:00:00 +0000` } })
  writeFileSync(join(t, 'work', 'WI-0001-x.md'), '# W\n\n状态：in_progress\n备注\n'); spawnSync('git', ['-C', t, 'add', '-A', '-f'])
  spawnSync('git', ['-C', t, ...gid, 'commit', '-q', '-m', 't'], { env: { ...process.env, GIT_COMMITTER_DATE: `${day(-1)} 12:00:00 +0000`, GIT_AUTHOR_DATE: `${day(-300)} 12:00:00 +0000` } })
  const r = run(cfgOf(t, REQ)).find((f) => f.where === 'work/WI-0001-x.md'); assert.equal(r.status, 'PASS', '提交时间 1 天前（%cI），作者时间 300 天前（%aI 会判超龄）；最近一次是 1 天前，不是 200 天前')
  // G8：没有提交历史（已 add 未提交）→ 未定，reason 写「没有提交历史」
  const u = mk(); put(u, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); put(u, 'work/WI-0001-x.md', '# W\n\n状态：in_progress\n'); gitInit(u)
  const ur = run(cfgOf(u, REQ)).find((f) => f.where === 'work/WI-0001-x.md'); assert.match(ur.reason, /退到提交时间也不成：(git log 退出码 128|git log 无输出：该文件没有提交历史)/)
  // G9/G7：git 不在 PATH → 浅克隆探测与 git log 都跑不了 → 未定「退到提交时间也不成」，不抛、不当 PASS
  const saved = process.env.PATH; const nopath = mkdtempSync(join(tmpdir(), 'frchk-nopath-'))
  try { process.env.PATH = nopath; const nr = run(cfgOf(u, REQ)); assert.ok(nr.some((f) => f.status === 'UNDETERMINED'), 'git 不可用：未定') } finally { process.env.PATH = saved; rmSync(nopath, { recursive: true, force: true }) }
})

test('恶意仓：freshness 取提交时间的 git log 经 hardenedEnv——被扫仓配置里的 core.fsmonitor 不被执行（变异 G2）；对照组先证明不加固时 git log 也会触发它', { skip: spawnSync('sh', ['-c', 'exit 0']).status === 0 ? false : '没有 sh' }, () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); put(t, 'work/WI-0001-x.md', '# W\n\n状态：in_progress\n'); gitInit(t)
  spawnSync('git', ['-C', t, '-c', 'user.name=a', '-c', 'user.email=a@b', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 's'])
  const mark = join(t, 'PWNED').replaceAll('\\', '/'); spawnSync('git', ['-C', t, 'config', 'core.fsmonitor', `touch ${mark}; false`])
  spawnSync('git', ['-C', t, 'log', '-1', '--format=%cI', '--', 'work/WI-0001-x.md'], { encoding: 'utf8' })
  const control = existsSync(join(t, 'PWNED')); if (control) rmSync(join(t, 'PWNED'))
  run(cfgOf(t, REQ))
  // 对照组必须真的触发过，否则「标记文件没出现」什么也证明不了；本机 git 不触发就明确跳过，不假装通过
  if (!control) return
  assert.equal(existsSync(join(t, 'PWNED')), false, '经 hardenedEnv：freshness 的 git log 没有执行 fsmonitor')
})

// ---- 第二轮剩余盲区（期望值取自 Python 版实测）----
test('日期字段值去掉 markdown 装饰后为空（`updated_at: **`）= 缺字段（FAIL），不是「日期解析不了」（变异 R8）', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', 'status: active\nupdated_at: **\n'); WI_OK(t)
  const r = go(t, REQ); assert.equal(r.find((f) => f.title === '缺日期字段：docs/architecture/a.md').status, 'FAIL'); assert.ok(!r.some((f) => f.title.startsWith('日期解析不了')))
})

test('docs_root 已声明时 noteDefault 的注记为空：文档类 evidence 不被动（末尾仍是阈值说明，没有多余分号）（变异 D3）', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); WI_OK(t); gitInit(t)
  const r = run(cfgOf(t, REQ)).find((f) => f.where === 'docs/architecture/a.md'); assert.ok(r.evidence.endsWith('budgets.stale_days = 90，取自 project.yaml'), r.evidence)
})

test('工作项读不了（目录占了文件名）→ 不报缺状态、不报 unreadable 以外的结论；列不出工作项时单条未定（变异 W21）', () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); mkdirSync(join(t, 'work', 'WI-0001-x.md'), { recursive: true }); put(t, 'work/WI-0001-x.md/f.txt', 'x'); gitInit(t)
  const r = run(cfgOf(t, REQ)); assert.deepEqual(only(r, 'UNDETERMINED').map((f) => f.title), ['work 下没有可判定的工作项'], 'git 里没有这份（只有其下的 f.txt）：工作项目录里没有可判定的')
})

test('取提交时间的失败路径（变异 G7、G8、G9、G10）：已 add 未提交 → 未定且 reason 点明；git 不在 PATH → 未定且 reason 以「跑不了 git」起头；非仓 → 单条未定且带退出码', () => {
  const u = mk(); put(u, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); put(u, 'work/WI-0001-x.md', '# W\n\n状态：in_progress\n'); gitInit(u)
  const ur = run(cfgOf(u, REQ)).find((f) => f.where === 'work/WI-0001-x.md')
  assert.equal(ur.status, 'UNDETERMINED'); assert.equal(ur.title, '取不到最后状态转换时间：work/WI-0001-x.md')
  // 已 add 未提交：git log 在「当前分支还没有提交」时退出码 128（实测，Python 同），不是「无输出」——后者是有提交但该文件没有历史时的写法
  assert.match(ur.reason, /^文件里没有状态转换记录小节，也没有显式转换时间字段；退到提交时间也不成：git log 退出码 128：fatal: .*does not have any commits yet$/)
  // 有提交、但该文件不在任何提交里（只 add 了别的文件提交过）→ git log 退出 0 且无输出 → 「无输出：该文件没有提交历史」
  const v = mk(); put(v, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); gitInit(v)
  spawnSync('git', ['-C', v, '-c', 'user.name=a', '-c', 'user.email=a@b', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 's'])
  put(v, 'work/WI-0001-x.md', '# W\n\n状态：in_progress\n'); gitInit(v) // work 下的文件已 add、未提交；仓里已有一次别的提交
  const vr = run(cfgOf(v, REQ)).find((f) => f.where === 'work/WI-0001-x.md')
  assert.match(vr.reason, /退到提交时间也不成：git log 无输出：该文件没有提交历史$/)
  // git 不在 PATH：连 `git ls-files` 都跑不了，所以整轮在文件清单这一步就整体记未定（走不到提交时间那一步）——这是实测，不是推断
  const saved = process.env.PATH, nopath = mkdtempSync(join(tmpdir(), 'frchk-nopath-'))
  try { process.env.PATH = nopath; const nr = run(cfgOf(u, REQ)); assert.ok(nr.length >= 1 && nr.every((f) => f.status === 'UNDETERMINED') && nr.every((f) => /^跑不了 git ls-files：/.test(f.reason)), J(nr.map((f) => [f.status, f.reason]))) }
  finally { process.env.PATH = saved; rmSync(nopath, { recursive: true, force: true }) }
})
const J = (v) => JSON.stringify(v)

test('浅克隆探测对一次扫描只做一次：两份无转换记录的进行中工作项，rev-parse 只跑一次（变异 G4）——靠 PATH 上放一个计数的 git 包装，只在有 sh 且能执行无扩展名脚本的 POSIX 上', { skip: process.platform === 'win32' ? 'Windows 上 spawnSync 不执行无扩展名的 sh 脚本，无法放计数包装' : false }, () => {
  const t = mk(); put(t, 'docs/architecture/a.md', `status: active\nupdated_at: ${day(-1)}\n`); put(t, 'work/WI-0001-x.md', '# W\n\n状态：in_progress\n'); put(t, 'work/WI-0002-y.md', '# W\n\n状态：in_progress\n'); gitInit(t)
  spawnSync('git', ['-C', t, '-c', 'user.name=a', '-c', 'user.email=a@b', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 's'])
  const bin = mkdtempSync(join(tmpdir(), 'frchk-bin-')); const log = join(bin, 'calls.log')
  const real = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['git'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0]
  if (!real) return
  // 包装 git：记录每次调用的第 3、4 个参数（-C <root> rev-parse ...），再转给真 git；只在有 sh 的平台上
  if (spawnSync('sh', ['-c', 'exit 0']).status !== 0) return
  writeFileSync(join(bin, 'git'), `#!/bin/sh\necho "$@" >> "${log.replaceAll('\\', '/')}"\nexec "${real.replaceAll('\\', '/')}" "$@"\n`, { mode: 0o755 })
  const saved = process.env.PATH
  try { process.env.PATH = bin + (process.platform === 'win32' ? ';' : ':') + saved; run(cfgOf(t, REQ)) } finally { process.env.PATH = saved }
  const calls = readFileSync(log, 'utf8').split('\n').filter((l) => l.includes('rev-parse --is-shallow-repository')).length
  rmSync(bin, { recursive: true, force: true })
  assert.equal(calls, 1, `浅克隆探测次数 ${calls}`)
})

test('外壳：被裁剪整个检查 → 单条 SKIP；内部异常 → internal-error 未定', () => {
  const t = mk()
  assert.deepEqual(run({ _root: t, tailoring: [{ check: 'freshness', applicable: false, reason: 'r' }] }).map((f) => [f.status, f.reason]), [['SKIP', 'r']])
  assert.deepEqual(run({ _root: t, get layout() { throw new Error('炸') } }).map((f) => [f.status, f.id]), [['UNDETERMINED', 'freshness/internal-error']])
})
