// derived 检查器的验收测试：selftest 全过且 (id,status) 集合与 Python 黄金样本相同；对 4 个真实仓逐条一致；变异验证靠这里的直接断言变红。
// 4 个真实仓都没有声明 `derived:`（各只出一条 SKIP），所以真实仓比对对判据几乎没有覆盖力——每个判据都要有自己的、不依赖外部数据的断言（设计 §6 第 6 条）。
// 期望值取自 Python 版实测（探针已删，输出逐条抄在断言里）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NAME, run, scope, selftest, mentions, headerDeclares } from '../lib/checks/derived.js'
import { DERIVED } from './cases/selftest-ids.mjs'

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..')
const probes = DERIVED.map(([id, status]) => ({ id, status }))

test('NAME 与 Python 版一致（注意不是文件名 derived）', () => assert.equal(NAME, 'derived-artifacts'))

test('selftest：每条都 PASS，且 (id, status) 集合与黄金样本完全相同', () => {
  const got = selftest()
  assert.ok(got.length >= 8)
  assert.deepEqual(got.filter((f) => f.status !== 'PASS').map((f) => `${f.title}｜${f.evidence}`), [])
  assert.deepEqual(got.map((f) => [f.id, f.status]).sort(), probes.map((p) => [p.id, p.status]).sort())
})

// ---- 直接断言（所有平台都跑）----
const tmps = []
const mk = () => { const t = mkdtempSync(join(tmpdir(), 'dvchk-')); tmps.push(t); return t }
test.after(() => { for (const t of tmps) rmSync(t, { recursive: true, force: true }) })
const GID = ['-c', 'user.name=a', '-c', 'user.email=a@b', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false']
const git = (t, ...a) => spawnSync('git', ['-C', t, ...GID, ...a], { encoding: 'utf8' })
const repo = (t) => { spawnSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', t]); return { _root: t } }
const commit = (t, rel, body, when) => { mkdirSync(dirname(join(t, rel)), { recursive: true }); writeFileSync(join(t, rel), body); git(t, 'add', '--', rel); spawnSync('git', ['-C', t, ...GID, 'commit', '-q', '-m', `add ${rel}`], { env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } }) }
const D = (artifact, source, regen = 'make') => ({ artifact, source, regen })
const SRC = '{}\n', GOOD = '<!-- 派生缓存，权威是 src/map.json；不要手改 -->\n'
const T = (n) => `2026-01-0${n}T00:00:00 +0000`
const ids = (fs) => fs.map((f) => f.id)
const row = (f) => [f.status, f.id, f.where ?? null]

test('无声明 → 单条 SKIP（空列表也一样）；项目裁剪 → 单条 SKIP 带理由', () => {
  const t = mk(); repo(t)
  for (const d of [undefined, []]) { const r = run(d === undefined ? { _root: t } : { _root: t, derived: d }); assert.deepEqual(r.map(row), [['SKIP', 'derived-artifacts/88dac3ad', null]]); assert.equal(r[0].title, '项目未声明派生工件') }
  const c = run({ _root: t, tailoring: [{ check: 'derived-artifacts', applicable: false, reason: 'r' }], derived: [D('a', 'b')] }); assert.deepEqual(c.map((f) => [f.status, f.reason]), [['SKIP', 'r']])
})

test('声明不完整 → 未定，缺哪项列哪项；artifact 缺失时 id 用声明序号（下划线归一）；数字 0 当缺、数字 5 当 "5"；前后空白去掉', () => {
  const t = mk(); repo(t)
  let r = run({ _root: t, derived: [{ artifact: 'a.html' }] }); assert.deepEqual(r.map(row), [['UNDETERMINED', 'derived-artifacts/incomplete-decl/a.html', 'a.html']]); assert.equal(r[0].reason, '缺：source、regen'); assert.equal(r[0].title, 'derived[1]（a.html） 的声明不完整')
  r = run({ _root: t, derived: [{ artifact: '', source: '', regen: '' }] }); assert.deepEqual(r.map(row), [['UNDETERMINED', 'derived-artifacts/incomplete-decl/derived[1]（未写_artifact）', null]]); assert.equal(r[0].reason, '缺：artifact、source、regen')
  r = run({ _root: t, derived: [{ artifact: 0, source: 's', regen: 'r' }] }); assert.equal(r[0].reason, '缺：artifact', '0 是假值：当没写')
  r = run({ _root: t, derived: [{ artifact: 5, source: 's', regen: 'r' }] }); assert.equal(r[0].id, 'derived-artifacts/missing-file/5')
  r = run({ _root: t, derived: [{ artifact: '  a.html  ', source: 's', regen: 'r' }] }); assert.equal(r[0].id, 'derived-artifacts/missing-file/a.html')
})

test('声明的文件不在 → 未定，reason 列出缺的（artifact、source 各自）；evidence 写 regen；缺 source 时不再往下判', () => {
  const t = mk(); repo(t); commit(t, 'docs/a.html', GOOD, T(1)); commit(t, 'src/s.json', SRC, T(1))
  const a = run({ _root: t, derived: [D('docs/a.html', 'src/nope.json')] }); assert.deepEqual(a.map(row), [['UNDETERMINED', 'derived-artifacts/missing-file/docs/a.html', 'docs/a.html']]); assert.equal(a[0].reason, 'source 不存在：src/nope.json'); assert.equal(a[0].evidence, 'regen: make'); assert.equal(a[0].title, 'derived[1]（docs/a.html） 声明的文件不在')
  assert.equal(run({ _root: t, derived: [D('docs/nope.html', 'src/s.json')] })[0].reason, 'artifact 不存在：docs/nope.html')
  assert.equal(run({ _root: t, derived: [D('docs/nope.html', 'src/nope.json')] })[0].reason, 'artifact 不存在：docs/nope.html；source 不存在：src/nope.json', '两个都缺：用「；」连')
})

test('陈旧判据：artifact 提交时间 < source 才算落后（同一秒不落后）；落后 FAIL 带秒差；不落后 PASS 写两个时间戳；id 带「｜」连 artifact 与 source', () => {
  const same = mk(); repo(same); commit(same, 'src/s.json', SRC, T(1)); commit(same, 'docs/a.html', GOOD, T(1))
  const a = run({ _root: same, derived: [D('docs/a.html', 'src/s.json')] }).find((f) => f.id.startsWith('derived-artifacts/not-behind/'))
  assert.equal(a.status, 'PASS'); assert.equal(a.id, 'derived-artifacts/not-behind/docs/a.html｜src/s.json'); assert.equal(a.evidence, 'artifact 最后提交 1767225600 ≥ source 最后提交 1767225600（只比提交先后，不比内容）'); assert.equal(a.title, 'derived[1]（docs/a.html） 不落后于源')
  const behind = mk(); repo(behind); commit(behind, 'docs/a.html', GOOD, '2026-01-01T00:00:00 +0000'); commit(behind, 'src/s.json', SRC, '2026-01-01T00:00:01 +0000')
  const b = run({ _root: behind, derived: [D('docs/a.html', 'src/s.json')] }).find((f) => f.id.startsWith('derived-artifacts/behind/'))
  assert.equal(b.status, 'FAIL'); assert.equal(b.id, 'derived-artifacts/behind/docs/a.html｜src/s.json'); assert.equal(b.evidence, 'artifact 最后提交 1767225600，source 最后提交 1767225601，晚 1 秒'); assert.equal(b.title, 'derived[1]（docs/a.html） 落后于源 src/s.json')
})

test('取不到提交时间 → 未定（artifact 未提交 / 非 git 仓），reason 写原因、evidence 写 git 命令；这时头部判据照样跑', () => {
  const t = mk(); repo(t); commit(t, 'src/s.json', SRC, T(1)); mkdirSync(join(t, 'docs'), { recursive: true }); writeFileSync(join(t, 'docs/a.html'), GOOD)
  const r = run({ _root: t, derived: [D('docs/a.html', 'src/s.json')] })
  const n = r.find((f) => f.id === 'derived-artifacts/no-commit-time/docs/a.html'); assert.equal(n.status, 'UNDETERMINED'); assert.equal(n.reason, 'docs/a.html 没有提交记录（未提交或路径写错）'); assert.equal(n.evidence, 'git log -1 --format=%ct -- docs/a.html / src/s.json')
  assert.ok(r.some((f) => f.id.startsWith('derived-artifacts/header-undeclared/')), '头部判据照跑')
  const nr = mk(); writeFileSync(join(nr, 'a.html'), GOOD); writeFileSync(join(nr, 's.json'), SRC)
  const x = run({ _root: nr, derived: [D('a.html', 's.json')] }).find((f) => f.id === 'derived-artifacts/no-commit-time/a.html'); assert.match(x.reason, /^git rev-parse --is-shallow-repository 退出码 128/)
})

test('头部判据：源路径/源文件名/source_rev 之一才 PASS；只有生成措辞 → FAIL（where 带行号、title 带「生成/派生措辞」）；一点痕迹都没有 → FAIL（where 带 :1、title「没有任何生成/派生标记」）', () => {
  const hdr = (body) => { const t = mk(); repo(t); commit(t, 'src/s.json', SRC, T(1)); commit(t, 'docs/a.html', body, T(2)); return run({ _root: t, derived: [D('docs/a.html', 'src/s.json')] }).filter((f) => f.id.includes('header')) }
  const ok = hdr('<!-- source_rev: abc123 -->\n'); assert.deepEqual(ok.map(row), [['PASS', 'derived-artifacts/header-declared/docs/a.html', 'docs/a.html']]); assert.equal(ok[0].evidence, '头部出现标记 source_rev'); assert.equal(ok[0].title, 'derived[1]（docs/a.html） 头部声明了自己是派生物')
  assert.equal(hdr('权威是 src/s.json\n')[0].evidence, '头部出现源路径 src/s.json'); assert.equal(hdr('see s.json here\n')[0].evidence, '头部出现源文件名 s.json')
  const gen = hdr('<!-- 派生缓存，权威是别处 -->\n'); assert.deepEqual(gen.map(row), [['FAIL', 'derived-artifacts/header-undeclared/docs/a.html', 'docs/a.html:1']]); assert.equal(gen[0].title, 'derived[1]（docs/a.html） 头部有生成/派生措辞但未指明源'); assert.match(gen[0].evidence, /^第 1 行原文：<!-- 派生缓存，权威是别处 -->；但前 30 行里既没有源路径 src\/s\.json、也没有源文件名 s\.json、也没有 source_rev——/)
  const none = hdr('<h1>x</h1>\n'); assert.deepEqual(none.map(row), [['FAIL', 'derived-artifacts/header-undeclared/docs/a.html', 'docs/a.html:1']]); assert.equal(none[0].title, 'derived[1]（docs/a.html） 头部没有任何生成/派生标记'); assert.match(none[0].evidence, /^前 30 行里既没有源路径 src\/s\.json，也没有任何生成\/派生\/不要手改一类标记，也没有生成器署名；/)
})

test('头部只看前 30 行与前 8192 字节：源路径在第 30 行 PASS、第 31 行（40 个空行之后）FAIL；在 8192 字节之后 FAIL；二进制（含 NUL）→ header-unreadable 未定', () => {
  const hdr = (body) => { const t = mk(); repo(t); commit(t, 'src/s.json', SRC, T(1)); commit(t, 'docs/a.html', body, T(2)); return run({ _root: t, derived: [D('docs/a.html', 'src/s.json')] }).filter((f) => f.id.includes('header')) }
  assert.equal(hdr('\n'.repeat(29) + '权威是 src/s.json\n')[0].status, 'PASS', '第 30 行')
  assert.equal(hdr('\n'.repeat(40) + '权威是 src/s.json\n')[0].status, 'FAIL', '第 41 行')
  assert.equal(hdr('x'.repeat(9000) + '\n权威是 src/s.json\n')[0].status, 'FAIL', '8192 字节之后')
  const bin = hdr('\x00\x01'); assert.deepEqual(bin.map(row), [['UNDETERMINED', 'derived-artifacts/header-unreadable/docs/a.html', 'docs/a.html']]); assert.equal(bin[0].reason, '是二进制文件，头部声明判不了'); assert.equal(bin[0].title, 'derived[1]（docs/a.html） 的头部读不了，自我声明未定')
})

test('同一派生物配多个源：头部只在**第一条能走到头部判据的声明**上判，指明其中任一源即可；落后按 (派生物, 源) 各一条；第一条早退（源缺失）时头部由第二条判', () => {
  const t = mk(); repo(t); commit(t, 'src/a.json', SRC, T(1)); commit(t, 'src/b.json', SRC, T(1)); commit(t, 'docs/m.html', '<!-- 权威是 src/b.json -->\n', T(2))
  const r = run({ _root: t, derived: [D('docs/m.html', 'src/a.json'), D('docs/m.html', 'src/b.json')] })
  assert.deepEqual(r.map((f) => [f.id, f.title]), [['derived-artifacts/not-behind/docs/m.html｜src/a.json', 'derived[1]（docs/m.html） 不落后于源'], ['derived-artifacts/header-declared/docs/m.html', 'derived[1]（docs/m.html） 头部声明了自己是派生物'], ['derived-artifacts/not-behind/docs/m.html｜src/b.json', 'derived[2]（docs/m.html） 不落后于源']])
  const u = mk(); repo(u); commit(u, 'src/b.json', SRC, T(1)); commit(u, 'docs/m.html', '<!-- 权威是 src/b.json -->\n', T(2))
  const e = run({ _root: u, derived: [D('docs/m.html', 'src/gone.json'), D('docs/m.html', 'src/b.json')] })
  assert.deepEqual(e.map((f) => f.id), ['derived-artifacts/missing-file/docs/m.html', 'derived-artifacts/not-behind/docs/m.html｜src/b.json', 'derived-artifacts/header-declared/docs/m.html'], '第一条早退不消耗头部名额：头部由第二条判')
})

test('源路径带 [ ]：git 按字面取提交（不被通配到 m1.json 的更晚提交）', () => {
  const t = mk(); repo(t); commit(t, 'src/m[1].json', SRC, T(1)); commit(t, 'docs/map.html', '<!-- 权威是 src/m[1].json -->\n', T(2)); commit(t, 'src/m1.json', SRC, '2026-02-01T00:00:00 +0000')
  assert.deepEqual(run({ _root: t, derived: [D('docs/map.html', 'src/m[1].json')] }).map((f) => f.status), ['PASS', 'PASS'])
})

test('浅克隆 → 取不到提交时间记未定，不据边界提交判「不落后」', () => {
  const src = mk(); repo(src); commit(src, 'docs/map.html', GOOD, T(1)); commit(src, 'src/map.json', SRC, '2026-02-01T00:00:00 +0000')
  const dst = join(mk(), 'clone'); spawnSync('git', ['clone', '-q', '--depth', '1', 'file://' + (process.platform === 'win32' ? '/' : '') + src.replaceAll('\\', '/'), dst])
  const r = run({ _root: dst, derived: [D('docs/map.html', 'src/map.json')] })
  assert.ok(r.some((f) => f.status === 'UNDETERMINED' && f.id === 'derived-artifacts/no-commit-time/docs/map.html')); assert.ok(!r.some((f) => f.status === 'PASS' && f.id.includes('not-behind')))
})

// ---- 第一轮没抓住的盲区（期望值取自 Python 版实测）----
test('源标记 source_rev 是**子串**匹配（不要求边界）：紧贴字母也命中；整段匹配只用于路径与文件名（变异 B6）', () => {
  for (const h of ['xsource_revx', 'source_revision', 'my_source_rev_v2', 'x source_rev y']) assert.equal(headerDeclares(h, 'src/zzz.json'), '头部出现标记 source_rev', h)
})

test('整段匹配的前边界含 `_` 与数字（变异 C3、C4）；声明的源路径写了大写也与头部（转小写后）匹配（变异 C12）', () => {
  assert.equal(mentions('_api', 'api'), false); assert.equal(mentions('1api', 'api'), false); assert.equal(mentions('9src/map.json', 'src/map.json'), false); assert.equal(mentions('_src/map.json', 'src/map.json'), false)
  assert.equal(headerDeclares('权威是 src/map.json', 'src/Map.json'), '头部出现源路径 src/Map.json', '声明写大写：name 转小写后与头部匹配，说明里保留声明的原样写法')
  assert.equal(headerDeclares('权威是 SRC/MAP.JSON', 'src/map.json'), '头部出现源路径 src/map.json')
})

test('陈旧判据比的是**提交时间**（%ct）而不是作者时间（变异 G2）：作者时间晚于源、提交时间早于源 → 仍判落后', () => {
  const t = mk(); repo(t); commit(t, 'src/s.json', SRC, '2026-02-01T00:00:00 +0000')
  mkdirSync(join(t, 'docs'), { recursive: true }); writeFileSync(join(t, 'docs/a.html'), '权威是 src/s.json\n'); git(t, 'add', '--', 'docs/a.html')
  spawnSync('git', ['-C', t, ...GID, 'commit', '-q', '-m', 'a'], { env: { ...process.env, GIT_COMMITTER_DATE: '2026-01-02T00:00:00 +0000', GIT_AUTHOR_DATE: '2026-03-01T00:00:00 +0000' } })
  const r = run({ _root: t, derived: [D('docs/a.html', 'src/s.json')] }).find((f) => f.id.startsWith('derived-artifacts/behind/'))
  assert.equal(r.status, 'FAIL'); assert.equal(r.evidence, 'artifact 最后提交 1767312000，source 最后提交 1769904000，晚 2592000 秒')
})

test('git log 退出非 0（source 在仓外，路径对 git 无效）→ 取不到提交时间记未定，reason 以「git log 退出码 128」起头（变异 G5、G9 的一半）', () => {
  const t = mk(); repo(t); commit(t, 'docs/a.html', '权威是 ../o.json\n', T(2))
  const out = mk(); writeFileSync(join(out, 'o.json'), SRC)
  const rel = join('..', out.split(/[\\/]/).pop(), 'o.json')
  const r = run({ _root: t, derived: [D('docs/a.html', rel)] }).find((f) => f.id === 'derived-artifacts/no-commit-time/docs/a.html')
  assert.equal(r.status, 'UNDETERMINED'); assert.match(r.reason, /^git log 退出码 128：/)
})

test('两个都取不到提交时间时，reason 两条原因都写（用「；」连）（变异 H8）', () => {
  const t = mk(); repo(t); mkdirSync(join(t, 'docs')); mkdirSync(join(t, 'src')); writeFileSync(join(t, 'docs/a.html'), '权威是 src/s.json\n'); writeFileSync(join(t, 'src/s.json'), SRC)
  const r = run({ _root: t, derived: [D('docs/a.html', 'src/s.json')] }).find((f) => f.id === 'derived-artifacts/no-commit-time/docs/a.html')
  assert.equal(r.reason.split('；').length, 2, r.reason); assert.match(r.reason, /^git log 退出码 128：.*；git log 退出码 128：/)
})

test('头部同时指明两个源时，说明取**第一个**命中的源（变异 H13）；生成痕迹在第 3 行 → where 带 :3（变异 H16）', () => {
  const t = mk(); repo(t); commit(t, 'src/a.json', SRC, T(1)); commit(t, 'src/b.json', SRC, T(1)); commit(t, 'docs/m.html', '权威是 src/a.json 与 src/b.json\n', T(2))
  const h = run({ _root: t, derived: [D('docs/m.html', 'src/a.json'), D('docs/m.html', 'src/b.json')] }).find((f) => f.id.includes('header'))
  assert.equal(h.evidence, '头部出现源路径 src/a.json')
  const u = mk(); repo(u); commit(u, 'src/s.json', SRC, T(1)); commit(u, 'docs/a.html', '<h1>x</h1>\n<p>y</p>\n<!-- 生成的 -->\n', T(2))
  const f = run({ _root: u, derived: [D('docs/a.html', 'src/s.json')] }).find((x) => x.id.includes('header-undeclared')); assert.equal(f.where, 'docs/a.html:3'); assert.match(f.evidence, /^第 3 行原文：<!-- 生成的 -->；/)
})

test('同一派生物的两条声明，artifact 一条带空白一条不带：按去空白后的名字归为一组，头部只判一次，且指明**任一**源（含第一条的）即 PASS（变异 H38）', () => {
  // 头部只指明第一条（带空白那条）的源 a.json：按 strip 后分组时两条声明的源 [a, b] 同属一组，头部指明 a 即 PASS；
  // 不 strip 时第一条的键是 ' docs/m.html '、checkOne 用 strip 后的名字去取 → 取不到、第一条不判头部，第二条的组里只有 [b]，头部没指明 b → FAIL
  const t = mk(); repo(t); commit(t, 'src/a.json', SRC, T(1)); commit(t, 'src/b.json', SRC, T(1)); commit(t, 'docs/m.html', '权威是 src/a.json\n', T(2))
  const r = run({ _root: t, derived: [D(' docs/m.html ', 'src/a.json'), D('docs/m.html', 'src/b.json')] })
  assert.deepEqual(r.map((f) => f.id), ['derived-artifacts/not-behind/docs/m.html｜src/a.json', 'derived-artifacts/header-declared/docs/m.html', 'derived-artifacts/not-behind/docs/m.html｜src/b.json'])
  assert.equal(r[1].evidence, '头部出现源路径 src/a.json')
})

test('artifact 或 source 写成**目录**：不是文件，按「声明的文件不在」记未定（变异 H30；两路各一条）', () => {
  const a = mk(); repo(a); commit(a, 'src/s.json', SRC, T(1)); commit(a, 'docs/sub/x.txt', 'x', T(2))
  const ra = run({ _root: a, derived: [D('docs/sub', 'src/s.json')] }); assert.deepEqual(ra.map(row), [['UNDETERMINED', 'derived-artifacts/missing-file/docs/sub', 'docs/sub']]); assert.equal(ra[0].reason, 'artifact 不存在：docs/sub')
  const s = mk(); repo(s); commit(s, 'docs/a.html', '权威是 src/sub\n', T(2)); commit(s, 'src/sub/x.txt', 'x', T(1))
  const rs = run({ _root: s, derived: [D('docs/a.html', 'src/sub')] }); assert.deepEqual(rs.map(row), [['UNDETERMINED', 'derived-artifacts/missing-file/docs/a.html', 'docs/a.html']]); assert.equal(rs[0].reason, 'source 不存在：src/sub')
})

test('头部字节上限恰是 8192（变异 A3、A4）：源路径（10 字节）起于第 8182 字节、恰好结束在第 8192 字节 → 读得完整 → PASS；起于 8183 字节 → 差 1 字节读不完整 → FAIL（Python 实测）', () => {
  const at = (start) => { const t = mk(); repo(t); commit(t, 'src/m.json', SRC, T(1)); commit(t, 'docs/a.html', 'x'.repeat(start) + 'src/m.json', T(2)); return run({ _root: t, derived: [D('docs/a.html', 'src/m.json')] }).filter((f) => f.id.includes('header')).map((f) => f.status) }
  assert.deepEqual(at(8182), ['PASS'], '恰好结束在 8192：上限 8191 时读不完整，此处会变 FAIL')
  assert.deepEqual(at(8183), ['FAIL'], '结束在 8193：上限 8193 时读得完整，此处会变 PASS')
  assert.deepEqual(at(8180), ['PASS'])
})

test('scope：覆盖 4 条、未覆盖 8 条；条数随 derived 的长度（非列表当 0）', () => {
  assert.deepEqual([scope({}).covered.length, scope({}).not_covered.length], [4, 8])
  assert.equal(scope({ derived: [1, 2, 3] }).covered[0], '只看 project.yaml 的 derived: 声明（本次 3 条）'); assert.equal(scope({ derived: 'x' }).covered[0], '只看 project.yaml 的 derived: 声明（本次 0 条）')
  assert.match(scope({}).covered[3], /^artifact 头部 30 行是否\*\*指明了源\*\*/)
})
