// evidence 检查器的验收测试：selftest 全过且 (id,status) 集合与 Python 黄金样本相同；对 4 个真实仓逐条一致；变异验证靠这里的直接断言变红。
// 期望值取自 Python 版实测（探针已删，输出逐条抄在断言里）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NAME, run, scope, selftest } from '../lib/checks/evidence.js'

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..')
const probes = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'samples', 'selftest-probes.json'), 'utf8')).filter((p) => p.check === NAME)

test('NAME 与 Python 版一致', () => assert.equal(NAME, 'evidence'))

test('selftest：每条都 PASS，且 (id, status) 集合与黄金样本完全相同', () => {
  const got = selftest()
  assert.ok(got.length >= 15)
  assert.deepEqual(got.filter((f) => f.status !== 'PASS').map((f) => `${f.title}｜${f.evidence}`), [])
  assert.deepEqual(got.map((f) => [f.id, f.status]).sort(), probes.map((p) => [p.id, p.status]).sort())
})

// ---- 直接断言（所有平台都跑）----
const tmps = []
const mk = () => { const t = mkdtempSync(join(tmpdir(), 'evchk-')); tmps.push(t); return t }
test.after(() => { for (const t of tmps) rmSync(t, { recursive: true, force: true }) })
const GID = ['-c', 'user.name=a', '-c', 'user.email=a@b', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false']
const track = (t) => { spawnSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', t]); spawnSync('git', ['-C', t, ...GID, 'add', '-A', '-f']); spawnSync('git', ['-C', t, ...GID, 'commit', '-q', '-m', 's']) }
const put = (t, rel, body) => { mkdirSync(dirname(join(t, rel)), { recursive: true }); writeFileSync(join(t, rel), body) }
const wi = (t, name, status, body, heading = '## 验收证据') => put(t, `work/${name}`, `# ${name}\n\n状态：${status}\n\n${heading}\n\n${body}\n\n`)
const go = (t, extra = {}) => { track(t); return run({ _root: t, layout: { work_root: 'work' }, ...extra }) }
const row = (f) => [f.status, f.id, f.where ?? null]
const SIX = '**E-01**（INV-014，staging）\n1. 断言：导入 100 行样表，四类拆分结果与人工标注一致\n2. 原始证据：`artifacts/e01.txt`（`pytest tests/import -v` 14/14 绿）\n3. 版本：`main@7e1f2a9`，staging migration 20260901_0930\n4. 范围：staging；只覆盖单店样表；未覆盖多店并发\n5. 时间：2026-09-01 16:42\n6. 方法：pytest + 人工抽查 10 行\n'
const FIVE = SIX.replace('3. 版本：`main@7e1f2a9`，staging migration 20260901_0930', '3. 版本：`main@7e1f2a9`').replace('4. 范围：staging；只覆盖单店样表；未覆盖多店并发', '4. 范围：staging；只覆盖单店样表').replace('6. 方法：pytest + 人工抽查 10 行\n', '')
const NOTE_DEFAULT = '完成态按 01 §4.1 done 及别名（stdlib.WORK_ITEM_STATES）；work_root 取自 layout.work_root：work'

test('工作项目录不在 → 单条 SKIP（work-root-absent，指向 layout）；目录里没有可判定的 → 单条未定（空集不判通过）', () => {
  const a = mk(); put(a, 'a.md', 'x'); track(a)
  const ra = run({ _root: a, layout: { work_root: 'work' } }); assert.deepEqual(ra.map(row), [['SKIP', 'evidence/work-root-absent', 'work']]); assert.equal(ra[0].evidence, 'work_root 取自 layout.work_root：work；负责报告的检查器：layout')
  const b = mk(); put(b, 'work/current.md', '# x\n')
  const rb = go(b); assert.deepEqual(rb.map(row), [['UNDETERMINED', 'evidence/d5f2952c', 'work']]); assert.equal(rb[0].title, 'work 下没有可判定的工作项'); assert.equal(rb[0].evidence, NOTE_DEFAULT)
})

test('状态分流：完成态查证据；未完成与认不出各聚成一条 SKIP（带份数与路径）；认不出且（freshness 被裁剪或在 frozen）→ 本检查器记未定', () => {
  const a = mk(); wi(a, 'WI-0001-a.md', 'in_progress', SIX); wi(a, 'WI-0002-b.md', '火星态', SIX); wi(a, 'WI-0003-c.md', 'done', SIX)
  const ra = go(a)
  assert.deepEqual(ra.map((f) => [f.status, f.id]), [['PASS', 'evidence/0aab97ef'], ['SKIP', 'evidence/unknown-state-by-freshness'], ['SKIP', 'evidence/not-done']])
  assert.equal(ra[1].title, '状态认不出的工作项不查完成证据（1 份）'); assert.equal(ra[1].evidence, 'work/WI-0002-b.md（火星态）'); assert.equal(ra[2].evidence, 'work/WI-0001-a.md（in_progress）')
  const b = mk(); wi(b, 'WI-0001-a.md', '火星态', SIX)
  const rb = go(b, { tailoring: [{ check: 'freshness', applicable: false, reason: 'r' }] }); assert.deepEqual(rb.map((f) => [f.status, f.id, f.title]), [['UNDETERMINED', 'evidence/unknown-state', '工作项状态不在已知词表（1 份）']])
  const c = mk(); wi(c, 'WI-0001-a.md', '火星态', SIX); track(c)
  assert.deepEqual(run({ _root: c, layout: { work_root: 'work', frozen: ['work'] } }).map((f) => [f.status, f.id]), [['UNDETERMINED', 'evidence/unknown-state']], '落在 frozen：freshness 不读它的状态，由本检查器报')
})

test('完成态别名：未声明的「已验收」认不出；声明 work_item_done_states 后并入，note 里写明声明词', () => {
  const a = mk(); wi(a, 'WI-0001-a.md', '已验收', SIX); assert.deepEqual(go(a).map((f) => f.id), ['evidence/unknown-state-by-freshness'])
  const b = mk(); wi(b, 'WI-0001-a.md', '已验收', SIX); const rb = go(b, { work_item_done_states: ['已验收'] }); assert.equal(rb[0].status, 'PASS')
  assert.ok(rb[0].evidence.includes('，并入 project.yaml 的 work_item_done_states：已验收；'), rb[0].evidence)
  const c = mk(); wi(c, 'WI-0001-a.md', 'done', SIX); assert.ok(go(c, { work_item_done_states: ['已验收', 'ok'] })[0].evidence.includes('work_item_done_states：已验收/ok；'), '多个声明词用 / 连')
})

test('无证据段 → 未定（no-evidence-section，where 带 :1，reason 列出标题词）；证据段无条目 → 未定（where 是证据段下一行）；证据全在围栏里同样认不出', () => {
  const a = mk(); wi(a, 'WI-0001-a.md', 'done', '随便写点', '## 背景'); const ra = go(a)
  assert.deepEqual(ra.map(row), [['UNDETERMINED', 'evidence/no-evidence-section/work/WI-0001-a.md', 'work/WI-0001-a.md:1']]); assert.equal(ra[0].title, '已完成但认不出证据段：work/WI-0001-a.md'); assert.match(ra[0].reason, /^全文没有标题含 证据 \/ evidence 的小节。/); assert.equal(ra[0].evidence, `状态 done。${NOTE_DEFAULT}`)
  const b = mk(); wi(b, 'WI-0001-a.md', 'done', '只有一句话没有任何字段。\n'); const rb = go(b)
  assert.deepEqual(rb.map(row), [['UNDETERMINED', 'evidence/f5dd9434', 'work/WI-0001-a.md:6']]); assert.equal(rb[0].title, '证据段里认不出证据条目：work/WI-0001-a.md')
  const c = mk(); wi(c, 'WI-0001-a.md', 'done', '```\n**E-1**\n1. 断言：a\n```\n'); assert.deepEqual(go(c).map((f) => f.id), ['evidence/f5dd9434'])
})

test('六字段齐全 → PASS（where 带条目起始行号，title 写条目名，evidence 写写法与六字段名）', () => {
  const t = mk(); wi(t, 'WI-0001-a.md', 'done', SIX); const r = go(t)
  assert.deepEqual(r.map(row), [['PASS', 'evidence/1ccad558', 'work/WI-0001-a.md:7']]); assert.equal(r[0].title, 'work/WI-0001-a.md 的证据 E-01 六字段齐全'); assert.equal(r[0].evidence, `条目（① 断言、② 原始证据、③ 版本与工作区身份、④ 适用范围、⑤ 观察时间、⑥ 确认方法）。${NOTE_DEFAULT}`)
})

test('占位 → FAIL incomplete（值为空或占位）；缺字段 → FAIL incomplete（缺字段）；两条证据各判各的', () => {
  const a = mk(); wi(a, 'WI-0001-a.md', 'done', SIX.replace('6. 方法：pytest + 人工抽查 10 行', '6. 方法：TBD')); const ra = go(a)
  assert.deepEqual(ra.map(row), [['FAIL', 'evidence/incomplete/work/WI-0001-a.md｜E-01', 'work/WI-0001-a.md:7']]); assert.equal(ra[0].title, 'work/WI-0001-a.md 的证据 E-01 证据六字段不全'); assert.equal(ra[0].evidence, `值为空或占位：⑥ 确认方法；写法：条目。${NOTE_DEFAULT}`)
  const b = mk(); wi(b, 'WI-0001-a.md', 'done', SIX + '\n' + FIVE.replace('E-01', 'E-02')); const rb = go(b)
  assert.deepEqual(rb.map((f) => [f.status, f.id, f.where]), [['PASS', 'evidence/1ccad558', 'work/WI-0001-a.md:7'], ['FAIL', 'evidence/incomplete/work/WI-0001-a.md｜E-02', 'work/WI-0001-a.md:15']]); assert.equal(rb[1].evidence, `缺字段：⑥ 确认方法；写法：条目。${NOTE_DEFAULT}`)
})

test('限制（④）为空而其余五项齐全 → limits-empty（FAIL，evidence 写「缺/空：④ 适用范围」）；范围非空而另有一行限制为空 → 列表写法 PASS、表格写法 FAIL（Python 实测两种写法不同）', () => {
  const a = mk(); wi(a, 'WI-0001-a.md', 'done', SIX.replace('4. 范围：staging；只覆盖单店样表；未覆盖多店并发', '4. 限制：')); const ra = go(a)
  assert.deepEqual(ra.map(row), [['FAIL', 'evidence/limits-empty/work/WI-0001-a.md｜E-01', 'work/WI-0001-a.md:7']]); assert.equal(ra[0].title, 'work/WI-0001-a.md 的证据 E-01 的限制（④ 适用范围）为空，其余五项齐全'); assert.equal(ra[0].evidence, `缺/空：④ 适用范围；写法：条目。${NOTE_DEFAULT}`)
  const b = mk(); wi(b, 'WI-0001-a.md', 'done', '**E-1**\n1. 断言：a\n2. 证据：b\n3. 版本：c\n4. 范围：s\n5. 限制：\n6. 时间：e\n7. 方法：f\n'); assert.deepEqual(go(b).map((f) => f.status), ['PASS'], '列表：每个字段只取第一次出现，后来的空限制行不进 limit_cols')
  const c = mk(); wi(c, 'WI-0001-a.md', 'done', '| 断言 | 原始证据 | 版本 | 限制 | 时间 | 方法 |\n|---|---|---|---|---|---|\n| a | b | c | | e | f |\n'); const rc = go(c)
  assert.deepEqual(rc.map(row), [['FAIL', 'evidence/limits-empty/work/WI-0001-a.md｜a', 'work/WI-0001-a.md:9']]); assert.equal(rc[0].evidence, `缺/空：④ 适用范围；写法：表行。${NOTE_DEFAULT}`)
  const d = mk(); wi(d, 'WI-0001-a.md', 'done', '| 断言 | 原始证据 | 版本 | 范围 | 限制 | 时间 | 方法 |\n|---|---|---|---|---|---|---|\n| a | b | c | s | | e | f |\n'); assert.equal(go(d)[0].evidence, `缺/空：限制列为空；写法：表行。${NOTE_DEFAULT}`, '表格：范围非空、限制列空 → 证据里写「限制列为空」')
})

test('同一文件里两条同名证据 → 两条 FAIL，id 相同、where 不同（行号）', () => {
  const t = mk(); wi(t, 'WI-0001-a.md', 'done', FIVE + '\n' + FIVE); const r = go(t)
  assert.deepEqual(r.map((f) => [f.id, f.where]), [['evidence/incomplete/work/WI-0001-a.md｜E-01', 'work/WI-0001-a.md:7'], ['evidence/incomplete/work/WI-0001-a.md｜E-01', 'work/WI-0001-a.md:14']])
})

test('聚合只列前 12 份并注明「另有 N 份未列出」；标题带份数', () => {
  const t = mk(); for (let i = 1; i <= 15; i++) wi(t, `WI-${String(i).padStart(4, '0')}-a.md`, 'in_progress', 'x')
  const r = go(t); assert.equal(r.length, 1); assert.equal(r[0].title, '未完成的工作项不查完成证据（15 份）'); assert.equal(r[0].id, 'evidence/not-done')
  assert.equal(r[0].evidence.split('；').filter((s) => s.startsWith('work/')).length, 12); assert.ok(r[0].evidence.endsWith('；另有 3 份未列出'))
})

test('BOM 与 CRLF 的工作项照样认（读文本时归一）', () => {
  const t = mk(); put(t, 'work/WI-0001-a.md', '\ufeff# x\r\n\r\n状态：done\r\n\r\n## 验收证据\r\n\r\n' + SIX.replaceAll('\n', '\r\n')); const r = go(t)
  assert.deepEqual(r.map(row), [['PASS', 'evidence/1ccad558', 'work/WI-0001-a.md:7']])
})

test('项目裁剪 → 单条 SKIP 带理由', () => {
  const t = mk(); wi(t, 'WI-0001-a.md', 'done', FIVE); track(t)
  const r = run({ _root: t, layout: { work_root: 'work' }, tailoring: [{ check: 'evidence', applicable: false, reason: 'r' }] }); assert.deepEqual(r.map((f) => [f.status, f.id, f.reason]), [['SKIP', 'evidence/48466a1d', 'r']])
})

test('证据段最后一行是含 | 的表头、后面没有分隔行 → 只记「认不出证据条目」，不抛（变异 F26：循环多走一格会越界）；两个证据段都认不出条目 → where 取**第一个**证据段的起始行（变异 L30）', () => {
  const a = mk(); wi(a, 'WI-0001-a.md', 'done', '| 断言 | 原始证据 | 版本 | 范围 | 时间 | 方法 |')
  assert.deepEqual(go(a).map(row), [['UNDETERMINED', 'evidence/f5dd9434', 'work/WI-0001-a.md:6']], '不是「检查器自身出错」那条')
  const b = mk(); wi(b, 'WI-0001-a.md', 'done', '没有字段。\n\n## 补充证据\n\n还是没有字段。\n')
  assert.deepEqual(go(b).map(row), [['UNDETERMINED', 'evidence/f5dd9434', 'work/WI-0001-a.md:6']])
})

test('字段标签的大小写折叠含 İ(U+0130)、ı(U+0131)——Python 的 re.I 把它们当 i（变异 I24）：同义词里含 i 的词，用 İ/ı 写也认', () => {
  const t = mk(); wi(t, 'WI-0001-a.md', 'done', SIX.replace('1. 断言：', '1. ASSERTİON：').replace('3. 版本：', '3. verSİon：').replace('6. 方法：', '6. proceDure：'))
  assert.deepEqual(go(t).map((f) => f.status), ['PASS'], '三个字段都用含 İ 的写法，仍六字段齐全')
})

// ---- 第一轮没抓住的盲区（期望值取自 Python 版实测）----
test('认不出的行数与缺项数的关系（变异 L7、L12、L13）：缺 2 个而认不出 1 行 → 不够顶 → FAIL；认不出 3 行而缺 1 → 未定，reason 写「3 行」、title 写缺哪项', () => {
  const a = mk(); wi(a, 'WI-0001-a.md', 'done', '**E-1**\n1. 断言：a\n2. 原始证据：b\n3. 版本：c\n4. 范围：d\n5. 自造项：x\n'); const ra = go(a)
  assert.deepEqual(ra.map(row), [['FAIL', 'evidence/incomplete/work/WI-0001-a.md｜E-1', 'work/WI-0001-a.md:7']]); assert.equal(ra[0].evidence, `缺字段：⑤ 观察时间、⑥ 确认方法；写法：条目。${NOTE_DEFAULT}`)
  const b = mk(); wi(b, 'WI-0001-a.md', 'done', '**E-1**\n1. 断言：a\n2. 原始证据：b\n3. 版本：c\n4. 范围：d\n5. 时间：e\n6. 甲项：x\n7. 乙项：y\n8. 丙项：z\n'); const rb = go(b)
  assert.deepEqual(rb.map(row), [['UNDETERMINED', 'evidence/fields-unrecognized/work/WI-0001-a.md｜E-1', 'work/WI-0001-a.md:7']]); assert.equal(rb[0].title, 'work/WI-0001-a.md 的证据 E-1 有字段没认出：⑥ 确认方法')
  assert.match(rb[0].reason, /^条目里有 3 行「标签: 值」本工具认不出；/)
})

test('表格写法的限制列与缺字段并存（变异 L23、L24）：范围空 + 限制列空 → limits-empty（缺/空：④ 适用范围）；缺方法 + 限制列空 → incomplete，证据里「缺字段：…；限制列为空」；缺字段 + 占位 → 两段都写', () => {
  const a = mk(); wi(a, 'WI-0001-a.md', 'done', '| 断言 | 原始证据 | 版本 | 范围 | 限制 | 时间 | 方法 |\n|---|---|---|---|---|---|---|\n| a | b | c | | | e | f |\n'); const ra = go(a)
  assert.deepEqual(ra.map((f) => f.id), ['evidence/limits-empty/work/WI-0001-a.md｜a']); assert.equal(ra[0].evidence, `缺/空：④ 适用范围；写法：表行。${NOTE_DEFAULT}`)
  const b = mk(); wi(b, 'WI-0001-a.md', 'done', '| 断言 | 原始证据 | 版本 | 范围 | 限制 | 时间 |\n|---|---|---|---|---|---|\n| a | b | c | s | | e |\n'); const rb = go(b)
  assert.deepEqual(rb.map((f) => f.id), ['evidence/incomplete/work/WI-0001-a.md｜a']); assert.equal(rb[0].evidence, `缺字段：⑥ 确认方法；限制列为空；写法：表行。${NOTE_DEFAULT}`)
  const c = mk(); wi(c, 'WI-0001-a.md', 'done', '**E-1**\n1. 断言：TBD\n2. 原始证据：b\n3. 版本：c\n4. 范围：d\n'); const rc = go(c)
  assert.equal(rc[0].evidence, `缺字段：⑤ 观察时间、⑥ 确认方法；值为空或占位：① 断言；写法：条目。${NOTE_DEFAULT}`, '缺字段在前、占位在后，用「；」连')
})

test('同一证据段里表格块在前、列表块在后（变异 L33）；有表格时列表只认加粗条目，不兜整段', () => {
  const t = mk(); wi(t, 'WI-0001-a.md', 'done', '**E-1**\n1. 断言：a\n\n| 断言 | 原始证据 | 版本 | 范围 | 时间 | 方法 |\n|---|---|---|---|---|---|\n| a | b | c | d | e | f |\n')
  assert.deepEqual(go(t).map((f) => [f.status, f.id, f.where]), [['PASS', 'evidence/0f3072c4', 'work/WI-0001-a.md:12'], ['FAIL', 'evidence/incomplete/work/WI-0001-a.md｜E-1', 'work/WI-0001-a.md:7']])
})

test('文档（layout.artifacts 里声明的路径、状态是文档态）不是工作项，不查完成证据（变异 M8）；读不了的工作项记 unreadable 且不拖累别的（变异 M10）；列不出 git 跟踪的 → 单条未定（变异 M12）', () => {
  const d = mk(); put(d, 'work/ARCH.md', '# x\n\n状态：active\n\n## 证据\n\n没有字段\n'); track(d)
  assert.deepEqual(run({ _root: d, layout: { work_root: 'work', artifacts: { arch: 'work/ARCH.md' } } }).map((f) => [f.status, f.id]), [['UNDETERMINED', 'evidence/d5f2952c']], '文档被跳过 → 只剩「没有可判定的工作项」')
  const u = mk(); wi(u, 'WI-0001-a.md', 'done', SIX); wi(u, 'WI-0002-b.md', 'done', SIX); track(u)
  rmSync(join(u, 'work/WI-0002-b.md')); mkdirSync(join(u, 'work/WI-0002-b.md'))
  const ru = run({ _root: u, layout: { work_root: 'work' } })
  assert.deepEqual(ru.map(row), [['PASS', 'evidence/1ccad558', 'work/WI-0001-a.md:7'], ['UNDETERMINED', 'evidence/unreadable/work/WI-0002-b.md', 'work/WI-0002-b.md']], '标题里的异常名随平台（Windows 是 PermissionError）不比，只比 id 与位置')
  const n = mk(); wi(n, 'WI-0001-a.md', 'done', SIX)
  const rn = run({ _root: n, layout: { work_root: 'work' } }); assert.deepEqual(rn.map((f) => [f.status, f.id, f.where]), [['UNDETERMINED', 'evidence/d9f621e9', null]]); assert.match(rn[0].reason, /^git ls-files 退出码 128：/)
})

// ---- 第二轮：摘掉标注复验后仍漏的真盲区（期望值取自 Python 版实测）----
test('标题深度按**去前导空白后**的 # 个数算（变异 B7）：缩进 4 格的 `## 证据` 之后，无缩进的 `### 子` 仍在段内；标题里夹空白的 `# # 证据` 只去开头连续的 #（变异 B8）', async () => {
  const { evidenceSections } = await import('../lib/checks/evidence.js')
  assert.deepEqual(evidenceSections('    ## 证据\n### 子\n断言：a\n').map((s) => [s[0], s[2].map((r) => r[0])]), [['证据', [2, 3]]])
  assert.deepEqual(evidenceSections('# # 证据\nx\n').map((s) => s[0]), ['# 证据']); assert.deepEqual(evidenceSections('#\t# 证据\nx\n').map((s) => s[0]), ['# 证据'])
  // 深度只数开头连续的 #，**不受标题文字前的空白影响**：`##  证据`（# 后两个空格）深度仍是 2，后面 3 级的 `### 子` 仍在段内；若把空白也算进去（B8），深度变 4，`### 子` 不再大于它，段就在这里截断
  assert.deepEqual(evidenceSections('##  证据\n### 子\n断言：a\n').map((s) => [s[0], s[2].map((r) => r[0])]), [['证据', [2, 3]]])
  assert.deepEqual(evidenceSections('##\t\t证据\n### 子\n断言：a\n').map((s) => [s[0], s[2].map((r) => r[0])]), [['证据', [2, 3]]])
})

test('表头一个格同时含多个词时取**第一个**（按映射表的先后）（变异 E17）：「断言与原始证据」→ 断言；「time evidence」→ 原始证据（evidence 在 time 之前）；「观察时间 limitation」→ 适用范围', async () => {
  const { mapHeader } = await import('../lib/checks/evidence.js')
  assert.deepEqual([...mapHeader(['断言与原始证据', '版本', '范围', '时间'])], [[0, 'assertion'], [1, 'identity'], [2, 'scope'], [3, 'observed']])
  assert.deepEqual([...mapHeader(['time evidence', 'x', 'y'])], [[0, 'raw']]); assert.deepEqual([...mapHeader(['观察时间 limitation'])], [[0, 'scope']])
})

test('表格：表头后的下一行不是分隔行就不当表（变异 F5）；数据行遇到「只有空白与竖线」的行：它不为空，所以继续，并记一条（空行）（变异 F12）', async () => {
  const { parseTableBlocks } = await import('../lib/checks/evidence.js')
  assert.deepEqual(parseTableBlocks([[1, '| 断言 | 原始证据 | 版本 |'], [2, '| a | b | c |'], [3, '| d | e | f |']]).map((b) => b.name), [])
  const head = [[1, '| 断言 | 原始证据 | 版本 | 范围 | 时间 | 方法 |'], [2, '|---|---|---|---|---|---|'], [3, '| a | b | c | d | e | f |']]
  assert.deepEqual(parseTableBlocks([...head, [4, ''], [5, '| g | h | i | j | k | l |']]).map((b) => b.name), ['a'], '真正的空行结束这张表')
  assert.deepEqual(parseTableBlocks([...head, [4, '   |  '], [5, '| g | h | i | j | k | l |']]).map((b) => b.name), ['a', '（空行）', 'g'], '只有空白与竖线的行不算空，继续读，条目名「（空行）」')
})

test('限制列只要有一个为占位就算空（any，不是 all）（变异 K3）；缺的字段里本来就有「④ 适用范围」时，「限制列为空」不再重复写（变异 L24）', async () => {
  const { judge } = await import('../lib/checks/evidence.js')
  const full = new Map([['assertion', 'a'], ['raw', 'b'], ['identity', 'c'], ['scope', 's'], ['observed', 'e'], ['method', 'f']])
  assert.deepEqual(judge({ fields: full, limit_cols: ['', 'x'] }), [[], [], true])
  const t = mk(); wi(t, 'WI-0001-a.md', 'done', '| 断言 | 原始证据 | 版本 | 限制 | 时间 | 方法 |\n|---|---|---|---|---|---|\n| a | b | c | | e | f |\n')
  const r = go(t); assert.equal(r[0].id, 'evidence/limits-empty/work/WI-0001-a.md｜a')
  const u = mk(); wi(u, 'WI-0001-a.md', 'done', '| 断言 | 原始证据 | 版本 | 限制 | 时间 |\n|---|---|---|---|---|\n| a | b | c | | e |\n')
  const ru = go(u); assert.equal(ru[0].evidence.split('；')[0], '缺字段：⑥ 确认方法', '范围（限制）列存在但为空，且缺⑥：证据里只写「缺字段」，限制列为空是 scope 自己的空，已在缺/空里体现')
  assert.ok(!ru[0].evidence.includes('限制列为空；'), '「④ 适用范围」不在缺的列表里时才补「限制列为空」')
})

// ---- Ubuntu 上才暴露的盲区（Windows 上被真实仓比对顺带抓住）----
test('整段兜底的条目行号取证据段第一行（不是固定 1）（变异 D5）；有多个证据段时每段都解析，不只看第一个（变异 L34）', () => {
  const a = mk(); wi(a, 'WI-0001-a.md', 'done', '断言：a\n原始证据：b\n版本：c\n范围：d\n时间：e\n方法：f\n'); const ra = go(a)
  assert.deepEqual(ra.map(row), [['PASS', 'evidence/9b0dccad', 'work/WI-0001-a.md:6']]); assert.equal(ra[0].title, 'work/WI-0001-a.md 的证据 （整段） 六字段齐全')
  const b = mk(); wi(b, 'WI-0001-a.md', 'done', '没有字段。\n\n## 补充证据\n\n' + SIX); assert.deepEqual(go(b).map(row), [['PASS', 'evidence/1ccad558', 'work/WI-0001-a.md:11']], '第二个证据段里的条目照判')
  const c = mk(); wi(c, 'WI-0001-a.md', 'done', SIX + '\n## 补充证据\n\n' + FIVE.replace('E-01', 'E-02'))
  assert.deepEqual(go(c).map(row), [['PASS', 'evidence/1ccad558', 'work/WI-0001-a.md:7'], ['FAIL', 'evidence/incomplete/work/WI-0001-a.md｜E-02', 'work/WI-0001-a.md:17']])
})

test('scope：覆盖 3 条、未覆盖 10 条；当前 work_root 用 Python 的 repr 写（单引号）', () => {
  assert.deepEqual([scope({}).covered.length, scope({}).not_covered.length], [3, 10])
  assert.match(scope({}).covered[0], /^layout\.work_root（当前 'docs\/state\/work'）下 git 跟踪的/); assert.match(scope({ layout: { work_root: 'wk' } }).covered[0], /^layout\.work_root（当前 'wk'）/)
})
