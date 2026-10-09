// 汇总层 src/check_all.ts 的单元测试：自检闸门、异常转未定、裁剪名校验、封签、例外登记 join、报告渲染与退出码。
// 这一层的安全属性（见文件头）每一条都要有会变红的断言——"检查在跑"不等于"检查抓得住"（设计 §12.4）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  gatedBySelftest, runOne, tailoringUnknown, sealed, toolIdentity, identityLine, identityBlock, sha256File,
  joinExceptions, ownExceptions, configOutsideRoot, safe, render, exitCode, runAll, scopes, IDENTITY_CHECK, EXCEPTION_CHECK,
} from '../lib/check_all.js'
import { finding, PASS, FAIL, SKIP, UNDETERMINED } from '../lib/core/finding.js'
import { addDays, toIso, todayLocal } from '../lib/core/dates.js'
import { parseArgs, main } from '../lib/main.js'
import { CHECKS, tailorableNames } from '../lib/checks/index.js'
import { trackedFiles } from '../lib/core/tracked.js'

const ok2 = () => [finding('m', PASS, '反例'), finding('m', PASS, '正例')]
const mod = (over = {}) => ({ NAME: 'm', selftest: ok2, run: () => [finding('m', PASS, '跑了')], scope: () => ({ covered: ['c'], not_covered: ['n'] }), ...over })
const tmpdirs = []
const mk = () => { const d = mkdtempSync(join(tmpdir(), 'catest-')); tmpdirs.push(d); return d }
test.after(() => { for (const d of tmpdirs) rmSync(d, { recursive: true, force: true }) })

// ---------------- 注册表 ----------------

test('检查器表：次序固定、名字与 Python 的 check_*.py 排序结果相同、每个都有 NAME/run/selftest/scope', () => {
  assert.deepEqual(CHECKS.map((m) => m.NAME), ['adoption', 'cross-repo', 'derived-artifacts', 'drift', 'entry-budget', 'evidence', 'freshness', 'layout', 'links', 'single-authority'])
  for (const m of CHECKS) for (const k of ['run', 'selftest', 'scope']) assert.equal(typeof m[k], 'function', `${m.NAME}.${k}`)
})

test('可裁剪的名字 = 检查器短名 + layout 的分档工件 role（裸名与 layout:<role> 两种写法）', () => {
  const names = tailorableNames()
  for (const m of CHECKS) assert.ok(names.includes(m.NAME), m.NAME)
  for (const r of ['entry', 'status', 'playbook']) { assert.ok(names.includes(r), r); assert.ok(names.includes(`layout:${r}`), `layout:${r}`) }
  assert.ok(!names.includes('derived'), '"derived" 不是检查器名（它叫 derived-artifacts）')
})

// ---------------- 自检闸门（契约 §3） ----------------

test('闸门：没有 selftest 函数 → 作废并记未定', () => {
  const [ok, gate] = gatedBySelftest('m', { run() {} })
  assert.equal(ok, false); assert.equal(gate.length, 1); assert.equal(gate[0].status, UNDETERMINED); assert.equal(gate[0].id, 'm/internal-error')
})

test('闸门：自检返回 0 条或 1 条不放行，2 条全过才放行', () => {
  const got = [0, 1, 2].map((n) => gatedBySelftest('m', mod({ selftest: () => Array.from({ length: n }, () => finding('m', PASS, 'x')) }))[0])
  assert.deepEqual(got, [false, false, true])
})

test('闸门：自检返回的不是数组 / 元素不是对象 → 不放行', () => {
  for (const bad of [null, undefined, 'x', { length: 2 }, [1, 2], [null, null], [[], []]]) {
    assert.equal(gatedBySelftest('m', mod({ selftest: () => bad }))[0], false, JSON.stringify(bad))
  }
})

test('闸门：自检里有一条不 PASS → 作废，原因里带出那一条的标题与证据；放行时第三项是这一次拿到的结果', () => {
  const [ok, gate] = gatedBySelftest('m', mod({ selftest: () => [finding('m', PASS, '好'), finding('m', FAIL, '坏条', { evidence: '证据甲' })] }))
  assert.equal(ok, false); assert.equal(gate[0].status, UNDETERMINED)
  assert.match(gate[0].reason, /坏条（证据甲）/); assert.doesNotMatch(gate[0].reason, /好/)
  const res = ok2()
  const [ok3, , results] = gatedBySelftest('m', mod({ selftest: () => res }))
  assert.equal(ok3, true); assert.equal(results, res, '给 --selftest 打印的必须是闸门据以放行的那一份，不重跑')
})

test('闸门：作废原因的文字——条数/类型照实写；多条坏项都列（「; 」连接）；作废时第三项给这一次拿到的数组（不是空）', () => {
  const reason = (r) => gatedBySelftest('m', mod({ selftest: () => r }))[1][0].reason
  assert.match(reason([finding('m', PASS, 'x')]), /^selftest\(\) 返回 1 条；/)
  assert.match(reason([]), /^selftest\(\) 返回 0 条；/)
  assert.match(reason([[], []]), /^selftest\(\) 返回 2 条；/, '元素是数组：条数够但元素不是 Finding，照样作废，原因里条数是真实条数')
  assert.match(reason({ a: 1 }), /^selftest\(\) 返回 object；/); assert.match(reason('x'), /^selftest\(\) 返回 string；/); assert.match(reason(undefined), /^selftest\(\) 返回 undefined；/)
  const bad = [finding('m', FAIL, 'a', { evidence: 'e1' }), finding('m', FAIL, 'b', { evidence: 'e2' })]
  const [ok, gate, res] = gatedBySelftest('m', mod({ selftest: () => bad }))
  assert.equal(ok, false); assert.equal(gate[0].reason, 'a（e1）; b（e2）'); assert.equal(res, bad, '坏项作废时第三项仍是这一次的数组')
  const short = [finding('m', PASS, 'x')]
  assert.equal(gatedBySelftest('m', mod({ selftest: () => short }))[2], short, '条数不足作废时第三项也是这一次的数组')
  assert.deepEqual(gatedBySelftest('m', mod({ selftest: () => 'x' }))[2], [], '非数组时第三项为空数组')
})

test('闸门：不缓存——同一个检查器对象第一次返回好的、第二次返回坏的，第二次必须作废', () => {
  let n = 0
  const m = mod({ selftest: () => (n++ === 0 ? ok2() : []) })
  assert.equal(gatedBySelftest('m', m)[0], true); assert.equal(gatedBySelftest('m', m)[0], false)
  assert.equal(n, 2)
})

test('闸门：自检本身抛异常（含抛字符串）→ 作废并记未定，不带走进程；不缓存（每次都重新跑）', () => {
  let n = 0
  const m = mod({ selftest: () => { n++; throw 'boom' } })
  for (let i = 0; i < 2; i++) { const [ok, gate] = gatedBySelftest('m', m); assert.equal(ok, false); assert.equal(gate[0].status, UNDETERMINED) }
  assert.equal(n, 2, '闸门不得缓存：入口冒烟会嵌套跑完整扫描')
})

test('runOne：闸门不过不跑 run；run 抛任何东西都转恰好一条未定', () => {
  let ran = false
  const bad = runOne('m', mod({ selftest: () => [], run: () => { ran = true; return [] } }), {})
  assert.equal(ran, false); assert.equal(bad[0].status, UNDETERMINED)
  for (const what of [new Error('x'), 'boom', undefined, 42]) {
    const r = runOne('m', mod({ run: () => { throw what } }), {})
    assert.deepEqual(r.map((f) => f.status), [UNDETERMINED], String(what))
  }
  assert.deepEqual(runOne('m', mod({ run: () => undefined }), {}), [], 'run 返回 undefined 当空')
  assert.deepEqual(runOne('m', mod(), {}).map((f) => f.status), [PASS])
})

// ---------------- 裁剪名校验 ----------------

test('tailoringUnknown：认不出的名字各记一条未定（id 带名字）；检查器名、裸 role、layout:<role> 不报；空名/缺 check/非映射项忽略', () => {
  const cfg = { tailoring: [{ check: 'derived' }, { check: 'derived-artifacts' }, { check: 'layout:playbook' }, { check: 'playbook' }, { check: 'nope:x' }, { check: '' }, { applicable: false }, 'str', null, { check: '  drift  ' }] }
  const r = tailoringUnknown(cfg)
  assert.deepEqual(r.map((f) => f.id), ['tailoring/unknown-check/derived', 'tailoring/unknown-check/nope:x'])
  assert.ok(r.every((f) => f.status === UNDETERMINED && f.check === 'tailoring'))
  assert.match(r[0].reason, /adoption、cross-repo/, '可写的名字按码点序列出')
  // 次序用「传入顺序与码点序不同」的检查器表来分辨（真实表本来就是排好的，反转/不排都会改变文字）
  const shuffled = tailoringUnknown({ tailoring: [{ check: 'x' }] }, [{ NAME: 'zeta' }, { NAME: 'alpha' }, { NAME: 'Mid' }])[0].reason
  assert.match(shuffled, /检查器短名 Mid、alpha、zeta，或/, '大写先于小写，按码点序，与传入顺序无关')
  assert.deepEqual(tailoringUnknown({ tailoring: ['abc', 5, ['x'], null] }), [], '非映射项忽略（不是把字符串/数字当名字）')
  assert.deepEqual(tailoringUnknown({ tailoring: [{ check: ['x'] }] }).map((f) => f.id), ["tailoring/unknown-check/['x']"], 'check 不是字符串时按 Python 的 str() 形态进名字（pyStr）')
  assert.deepEqual(tailoringUnknown({}), []); assert.deepEqual(tailoringUnknown({ tailoring: 5 }), [])
})

// ---------------- 身份与封签（契约 §8） ----------------

test('身份：只哈希 lib 下 .js 与契约；摘要对行尾归一化，改一个字节则变', () => {
  const lib = mk(), contract = join(lib, 'CONTRACT.md')
  mkdirSync(join(lib, 'a')); writeFileSync(join(lib, 'x.js'), 'a\nb\n'); writeFileSync(join(lib, 'a', 'y.js'), 'c\n'); writeFileSync(join(lib, 'ignored.d.ts'), 'zzz'); writeFileSync(contract, '# 契约\n')
  const a = toolIdentity(lib, contract)
  assert.deepEqual(a.files.map(([r]) => r), ['lib/a/y.js', 'lib/x.js', 'CONTRACT.md'], '.d.ts 不进；子目录递归；契约最后')
  writeFileSync(join(lib, 'x.js'), 'a\r\nb\r\n')
  assert.equal(toolIdentity(lib, contract).digest, a.digest, 'CRLF 与 LF 同身份')
  writeFileSync(join(lib, 'x.js'), 'a\rb\n')
  assert.equal(toolIdentity(lib, contract).digest, a.digest, '裸 CR 同身份')
  writeFileSync(join(lib, 'x.js'), 'a\nb!\n')
  assert.notEqual(toolIdentity(lib, contract).digest, a.digest)
  writeFileSync(join(lib, 'x.js'), 'a\nb\n'); writeFileSync(contract, '# 契约!\n')
  assert.notEqual(toolIdentity(lib, contract).digest, a.digest, '契约进身份')
  writeFileSync(join(lib, 'z.js'), ''); assert.notEqual(toolIdentity(lib, contract).digest, a.digest, '新增文件也算变')
})

test('身份：文件按码点序、合并摘要 = sha256(「路径 哈希」逐行以换行连接)，可由逐文件哈希独立重算', async () => {
  const { createHash } = await import('node:crypto')
  const lib = mk(), contract = join(lib, 'CONTRACT.md'); writeFileSync(contract, 'c')
  // 不放只差大小写的两个名字：Windows 的文件系统不区分大小写，会写成同一个文件
  for (const n of ['b.js', 'a.js', 'Z.js', '_.js', '😀.js', 'é.js', '～.js']) writeFileSync(join(lib, n), n)
  const id = toolIdentity(lib, contract)
  assert.deepEqual(id.files.map(([r]) => r), ['lib/Z.js', 'lib/_.js', 'lib/a.js', 'lib/b.js', 'lib/é.js', 'lib/～.js', 'lib/😀.js', 'CONTRACT.md'], '大写先于下划线先于小写；BMP 之外的在最后（UTF-16 序会把 😀 排到 ～ 前面）')
  assert.equal(id.digest, createHash('sha256').update(id.files.map(([r, h]) => `${r} ${h}`).join('\n'), 'utf8').digest('hex'))
})

// 真 git 仓里的身份：lib/ 在仓里、有提交，才走得到 dirty 与 git_head 的分支（临时目录不是仓时它们全走「拿不到」）
function gitLib(files) {
  const root = mk(), lib = join(root, 'lib'); mkdirSync(lib)
  for (const [n, body] of Object.entries(files)) writeFileSync(join(lib, n), body)
  writeFileSync(join(root, 'CONTRACT.md'), 'c')
  const g = (...a) => { const r = spawnSync('git', ['-C', root, '-c', 'user.name=a', '-c', 'user.email=a@b', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...a], { encoding: 'utf8', env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined } }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim() }
  g('init', '-q'); g('add', '-A'); g('commit', '-q', '-m', 's')
  return { root, lib, contract: join(root, 'CONTRACT.md'), head: g('rev-parse', 'HEAD'), g }
}

test('身份（真 git 仓）：干净 → dirty=false、git_head 是 HEAD 全长；改了未提交 → dirty=true 且 detail 列出改动', () => {
  const r = gitLib({ 'x.js': 'a', 'y.js': 'b' })
  const clean = toolIdentity(r.lib, r.contract)
  assert.equal(clean.dirty, false); assert.equal(clean.dirty_detail, ''); assert.equal(clean.git_head, r.head)
  writeFileSync(join(r.lib, 'x.js'), 'changed')
  const dirty = toolIdentity(r.lib, r.contract)
  assert.equal(dirty.dirty, true); assert.match(dirty.dirty_detail, /x\.js/); assert.doesNotMatch(dirty.dirty_detail, /y\.js/)
  assert.match(identityLine(dirty), /工作区 dirty/); assert.match(identityBlock(dirty), /tool_identity_dirty: True/)
})

test('身份（真 git 仓）：dirty_detail 最多列 12 行、用「；」连接；空白行不算 dirty 行', () => {
  const files = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`f${String(i).padStart(2, '0')}.js`, 'a']))
  const r = gitLib(files)
  for (const n of Object.keys(files)) writeFileSync(join(r.lib, n), 'b')
  const id = toolIdentity(r.lib, r.contract)
  assert.equal(id.dirty_detail.split('；').length, 12, '只列前 12 行'); assert.equal(id.dirty, true)
  const r2 = gitLib({ 'x.js': 'a' })
  assert.equal(toolIdentity(r2.lib, r2.contract).dirty, false, '没有改动时 porcelain 输出为空串，不得因空串切出一行就判 dirty')
})

test('身份：不是 git 仓 → dirty=null，git_head 回退成 git 的原因文字（不是空串）；dirty_detail 写原因', () => {
  const lib = mk(), contract = join(lib, 'CONTRACT.md'); writeFileSync(join(lib, 'x.js'), 'a'); writeFileSync(contract, 'c')
  const id = toolIdentity(lib, contract)
  assert.equal(id.dirty, null); assert.match(id.git_head, /^git 退出码 \d+|^跑不了 git/); assert.match(id.dirty_detail, /^git 退出码 \d+|^跑不了 git/)
})

test('身份（真 git 仓）：仓的 .git/config 坏了、列不出过滤器 → dirty=null 且明说「未跑 git status」，不照常执行', () => {
  const r = gitLib({ 'x.js': 'a' })
  writeFileSync(join(r.root, '.git', 'config'), '[broken\n')
  const id = toolIdentity(r.lib, r.contract)
  assert.equal(id.dirty, null); assert.equal(id.dirty_detail, '列不出被扫仓的过滤器，未跑 git status')
  assert.match(identityLine(id), /工作区状态未知：列不出被扫仓的过滤器/)
})

test('身份：git 子进程不吃调用方注入的 GIT_DIR（钩子带着它跑时，HEAD 与 dirty 必须是工具自己所在仓的）', () => {
  const mine = gitLib({ 'x.js': 'a' }), other = gitLib({ 'o.js': 'o' })
  const saved = process.env.GIT_DIR
  process.env.GIT_DIR = join(other.root, '.git')
  try {
    const id = toolIdentity(mine.lib, mine.contract)
    assert.equal(id.git_head, mine.head); assert.notEqual(id.git_head, other.head); assert.equal(id.dirty, false)
  } finally { if (saved === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = saved }
})

test('sha256File：读不了的文件给「读不了：」而不是抛', () => {
  assert.match(sha256File(join(mk(), '不存在')), /^读不了：/)
})

test('封签：前后身份相同则原样返回；不一致则整份丢掉只留一条未定', () => {
  const lib = mk(), contract = join(lib, 'CONTRACT.md'); writeFileSync(join(lib, 'x.js'), '1'); writeFileSync(contract, 'c')
  const before = toolIdentity(lib, contract)
  const fs = [finding('m', PASS, 'a'), finding('m', FAIL, 'b')]
  assert.equal(sealed(fs, before, () => toolIdentity(lib, contract)), fs)
  writeFileSync(join(lib, 'x.js'), '2')
  const out = sealed(fs, before, () => toolIdentity(lib, contract))
  assert.equal(out.length, 1); assert.equal(out[0].check, IDENTITY_CHECK); assert.equal(out[0].status, UNDETERMINED)
  assert.match(out[0].evidence, /扫描前[\s\S]*扫描后/)
})

test('身份行与身份块：dirty 三态措辞、提交号只认十六进制、git 不可用时不写「git git」', () => {
  const base = { digest: 'a'.repeat(64), files: [['lib/x.js', 'h']], git_head: 'b'.repeat(40) }
  assert.match(identityLine({ ...base, dirty: true, dirty_detail: '' }), /工作区 dirty（哈希已含未提交改动）/)
  assert.match(identityLine({ ...base, dirty: false, dirty_detail: '' }), /工作区干净/)
  assert.match(identityLine({ ...base, dirty: null, dirty_detail: '为什么' }), /工作区状态未知：为什么/)
  assert.match(identityLine({ ...base, dirty: false, dirty_detail: '' }), /git bbbbbbbbbbbb ·/)
  const l = identityLine({ ...base, git_head: 'git 退出码 128', dirty: null, dirty_detail: 'git 退出码 128' })
  assert.doesNotMatch(l, /git git/); assert.match(l, /提交不可知（git 退出码 128）/)
  assert.match(identityLine({ ...base, git_head: '', dirty: null, dirty_detail: '' }), /提交不可知（未知）/)
  assert.match(identityBlock({ ...base, dirty: null, dirty_detail: '' }), /tool_identity_dirty: None/)
  assert.match(identityBlock({ ...base, dirty: true, dirty_detail: 'x' }), /tool_identity_dirty: True[\s\S]*tool_identity_dirty_detail: x/)
  assert.match(identityBlock({ ...base, dirty: false, dirty_detail: '' }), /tool_identity_files:\n  - lib\/x\.js h$/)
})

// ---------------- 例外登记 join（契约 §9） ----------------

const TODAY = { year: 2026, month: 10, day: 8 }
const EX_HEAD = '| id | 规则 | 理由 | 范围 | 批准人 | 到期 | 状态 |\n|---|---|---|---|---|---|---|\n'
function repo(exBody) {
  const root = mk(); mkdirSync(join(root, 'governance'))
  writeFileSync(join(root, 'governance', 'project.yaml'), 'tier: L0\n')
  if (exBody !== null) writeFileSync(join(root, 'governance', 'exceptions.md'), '# 登记\n\n' + EX_HEAD + exBody)
  return { _root: root, _path: 'governance/project.yaml' }
}
const und = (id, over = {}) => ({ ...finding('c', UNDETERMINED, id, { reason: 'r', kind: 'k' }), id, ...over })

test('join：没有登记册 → info 全空、不改任何发现、不产出登记条目', () => {
  const cfg = repo(null), fs = [und('c/a')]
  const info = joinExceptions(fs, cfg, TODAY)
  assert.deepEqual(info, { path: null, display: null, valid: 0, expired: 0 }); assert.equal(fs[0].registered, null); assert.equal(fs.length, 1)
})

test('join：有效登记贴 registered（id+到期），不改 status；info 记有效行数与展示路径', () => {
  const cfg = repo('| EX-001 | c/a | 理由 | 该项 | 甲 | 2026-12-31 | active |\n'), fs = [und('c/a'), und('c/b')]
  const info = joinExceptions(fs, cfg, TODAY)
  assert.deepEqual(fs[0].registered, { id: 'EX-001', expires: '2026-12-31' }); assert.equal(fs[0].status, UNDETERMINED); assert.equal(fs[1].registered, null)
  assert.equal(info.valid, 1); assert.equal(info.expired, 0); assert.equal(info.display, 'governance/exceptions.md'); assert.equal(fs.length, 2)
})

test('join：同一 id 的多条未定都贴；到期当天仍有效，昨天过期', () => {
  const cfgToday = repo('| EX-001 | c/a | 理由 | 该项 | 甲 | 2026-10-08 | active |\n')
  const fs = [und('c/a', { where: 'x' }), und('c/a', { where: 'y' })]
  joinExceptions(fs, cfgToday, TODAY); assert.deepEqual(fs.map((f) => f.registered?.id), ['EX-001', 'EX-001'])
  const cfgY = repo('| EX-001 | c/a | 理由 | 该项 | 甲 | 2026-10-07 | active |\n'), fs2 = [und('c/a')]
  const info = joinExceptions(fs2, cfgY, TODAY)
  assert.equal(fs2[0].registered, null); assert.equal(info.expired, 1)
  const e = fs2.find((f) => f.id === `${EXCEPTION_CHECK}/expired`)
  assert.equal(e.status, UNDETERMINED); assert.match(e.reason, /第 \d+ 行 EX-001 到期 2026-10-07/); assert.match(e.evidence, /比较基准日 2026-10-08/)
})

test('join：规则匹配不到未定（含匹配到 PASS/SKIP/FAIL）→ orphan，不算过期；不贴到非未定的发现上', () => {
  for (const st of [PASS, SKIP, FAIL]) {
    const cfg = repo('| EX-001 | c/a | 理由 | 该项 | 甲 | 2026-12-31 | active |\n')
    const f = { ...finding('c', st, 't', { reason: 'r', kind: 'k' }), id: 'c/a' }
    const fs = [f]; joinExceptions(fs, cfg, TODAY)
    assert.equal(f.registered, null, st); assert.ok(fs.some((x) => x.id === `${EXCEPTION_CHECK}/orphan`), st); assert.ok(!fs.some((x) => x.id === `${EXCEPTION_CHECK}/expired`), st)
  }
  const cfg = repo('| EX-001 | c/没有 | 理由 | 该项 | 甲 | 2026-12-31 | active |\n'), fs = [und('c/a')]; joinExceptions(fs, cfg, TODAY)
  assert.match(fs.find((x) => x.id === `${EXCEPTION_CHECK}/orphan`).reason, /EX-001：c\/没有/)
})

test('join：过期且孤儿的行只算孤儿（不报 expired）', () => {
  const cfg = repo('| EX-001 | c/没有 | 理由 | 该项 | 甲 | 2020-01-01 | active |\n'), fs = [und('c/a')]
  const info = joinExceptions(fs, cfg, TODAY)
  assert.ok(fs.some((x) => x.id === `${EXCEPTION_CHECK}/orphan`)); assert.ok(!fs.some((x) => x.id === `${EXCEPTION_CHECK}/expired`)); assert.equal(info.expired, 0)
})

test('join：缺五项之一 → invalid-rows；晚于今天+365 天 → 不合格不生效；恰 +365 天生效', () => {
  const t = TODAY, plus = (n) => toIso(addDays(t, n))
  const cfgBad = repo('| EX-001 | c/a | 理由 |  |  | 2026-12-31 | active |\n'), fs = [und('c/a')]
  joinExceptions(fs, cfgBad, t); assert.equal(fs[0].registered, null); assert.ok(fs.some((x) => x.id === `${EXCEPTION_CHECK}/invalid-rows`))
  const cfg366 = repo(`| EX-001 | c/a | 理由 | 该项 | 甲 | ${plus(366)} | active |\n`), fs2 = [und('c/a')]
  joinExceptions(fs2, cfg366, t); assert.equal(fs2[0].registered, null); assert.ok(fs2.some((x) => x.id === `${EXCEPTION_CHECK}/invalid-rows`))
  const cfg365 = repo(`| EX-001 | c/a | 理由 | 该项 | 甲 | ${plus(365)} | active |\n`), fs3 = [und('c/a')]
  joinExceptions(fs3, cfg365, t); assert.equal(fs3[0].registered?.id, 'EX-001'); assert.ok(!fs3.some((x) => x.id === `${EXCEPTION_CHECK}/invalid-rows`))
})

test('join：检查器自身出错的未定（<检查器>/internal-error）不可登记；读不了的文件（unreadable）照常可登记', () => {
  const cfg = repo('| EX-001 | layout/internal-error | 理由 | 该项 | 甲 | 2026-12-31 | active |\n| EX-002 | evidence/unreadable/a.md | 理由 | 该项 | 甲 | 2026-12-31 | active |\n')
  const fs = [und('layout/internal-error'), und('evidence/unreadable/a.md')]
  joinExceptions(fs, cfg, TODAY)
  assert.equal(fs[0].registered, null); assert.equal(fs[1].registered?.id, 'EX-002'); assert.ok(fs.some((x) => x.id === `${EXCEPTION_CHECK}/invalid-rows`))
})

test('join：过期条目的 reason 文字——超过 12 行只列前 12 并标「共 N 行」；无编号写「（无编号）」', () => {
  const rows = Array.from({ length: 14 }, (_, i) => `| ${i === 0 ? '' : 'EX-' + (300 + i)} | c/a | 理由 | 该项 | 甲 | 2020-01-0${i % 7 + 1} | active |\n`).join('')
  const fs = [und('c/a')]; joinExceptions(fs, repo(rows), TODAY)
  const r = fs.find((x) => x.id === `${EXCEPTION_CHECK}/expired`).reason
  assert.equal((r.match(/第 \d+ 行/g) ?? []).length, 12, '只列前 12 行'); assert.match(r, /；……共 14 行$/)
  assert.match(r, /^第 \d+ 行 （无编号） 到期 2020-01-01；/, '第一行没有编号')
})

test('join：条目上限——超过 12 行只列前 12 并标「共 N 行」', () => {
  const rows = Array.from({ length: 15 }, (_, i) => `| EX-${100 + i} | c/没有${i} | 理由 | 该项 | 甲 | 2026-12-31 | active |\n`).join('')
  const fs = [und('c/a')]; joinExceptions(fs, repo(rows), TODAY)
  const o = fs.find((x) => x.id === `${EXCEPTION_CHECK}/orphan`)
  assert.equal((o.reason.match(/EX-1\d\d：/g) ?? []).length, 12); assert.match(o.reason, /共 15 行/)
})

test('join：外部配置（绝对路径 _path）时展示的是登记册的绝对路径；cfg 没有 _path 就不读登记册', () => {
  const root = mk(), outer = mk(); writeFileSync(join(outer, 'project.yaml'), 'tier: L0\n'); writeFileSync(join(outer, 'exceptions.md'), '# x\n\n' + EX_HEAD + '| EX-001 | c/a | 理由 | 该项 | 甲 | 2026-12-31 | active |\n')
  const cfg = { _root: root, _path: join(outer, 'project.yaml') }, fs = [und('c/a')]
  const info = joinExceptions(fs, cfg, TODAY)
  assert.equal(info.display, join(outer, 'exceptions.md')); assert.equal(fs[0].registered?.id, 'EX-001')
  assert.deepEqual(joinExceptions([und('c/a')], { _root: root }, TODAY), { path: null, display: null, valid: 0, expired: 0 })
})

test('join：不合格行与过期行的条目也受 12 行上限；过期行无编号写「（无编号）」；各条目的 where 是登记册的展示路径', () => {
  const bad = Array.from({ length: 14 }, (_, i) => `| EX-${200 + i} | c/a${i} | 理由 |  |  | 2026-12-31 | active |\n`).join('')
  const fs = [und('c/a')]; joinExceptions(fs, repo(bad), TODAY)
  const inv = fs.find((x) => x.id === `${EXCEPTION_CHECK}/invalid-rows`)
  assert.equal(inv.where, 'governance/exceptions.md'); assert.match(inv.title, /有 14 行不合格/); assert.match(inv.reason, /共 14 行/)
  assert.equal(inv.reason.split('；').length, 13, '前 12 行 + 「……共 14 行」')
  const exp = Array.from({ length: 14 }, (_, i) => `| ${i === 0 ? '' : 'EX-' + (300 + i)} | c/a | 理由 | 该项 | 甲 | 2026-10-0${i % 7 + 1} | active |\n`).join('')
  const fs2 = [und('c/a')]; joinExceptions(fs2, repo(exp), TODAY)
  const e = fs2.find((x) => x.id === `${EXCEPTION_CHECK}/expired`)
  assert.equal(e.where, 'governance/exceptions.md'); assert.match(e.title, /有 \d+ 行已过期/)
  const rows = repo('| EX-001 | c/a | 理由 | 该项 | 甲 | 2020-01-01 | active |\n| EX-002 | c/a | 理由 | 该项 | 甲 | 2020-01-01 | active |\n'); const fs3 = [und('c/a')]; joinExceptions(fs3, rows, TODAY)
  const rn = fs3.find((x) => x.id === `${EXCEPTION_CHECK}/expired`).reason
  assert.match(rn, /^第 \d+ 行 EX-001 到期 2020-01-01；第 \d+ 行 EX-002 到期 2020-01-01$/)
})

test('join：读登记册时的程序错误（不是「读不了」）→ 一条检查器自身出错的未定，不静默当成没有登记；info 仍返回', () => {
  // 「读不了」类（目录、权限、坏编码）loadExceptions 自己转成 problems；会一路抛到这里的只有程序错误。
  // 造法：_path 不是字符串（配置被别的代码污染成对象）→ configDir 里的 path 运算抛 TypeError
  const fs = [und('c/a')]
  const info = joinExceptions(fs, { _root: mk(), _path: { not: 'a string' } }, TODAY)
  assert.equal(fs.length, 2, '多一条'); assert.equal(fs[1].status, UNDETERMINED); assert.equal(fs[1].check, EXCEPTION_CHECK); assert.equal(fs[1].id, `${EXCEPTION_CHECK}/internal-error`)
  assert.deepEqual(info, { path: null, display: null, valid: 0, expired: 0 })
  // 登记册是个目录 → problems（不抛）：在 invalid-rows 里报，不静默
  const root = mk(); mkdirSync(join(root, 'governance')); writeFileSync(join(root, 'governance', 'project.yaml'), 'tier: L0\n'); mkdirSync(join(root, 'governance', 'exceptions.md'))
  const fs2 = [und('c/a')]; joinExceptions(fs2, { _root: root, _path: 'governance/project.yaml' }, TODAY)
  assert.deepEqual(fs2.map((f) => f.id), ['c/a'], '目录不是文件：当作没有登记册（与 Python 版同）')
})

test('join：自有例外并入结果（不是只算不报）', () => {
  const cfg = repo('| EX-001 | G9 依赖规则 | 过期 | 全仓 | 甲 | 2020-01-01 | active |\n'), fs = []
  joinExceptions(fs, cfg, TODAY)
  assert.deepEqual(fs.map((f) => [f.status, f.id]), [[FAIL, 'exception-register/own-expired/EX-001']])
  assert.equal(fs[0].where, 'governance/exceptions.md')
})

test('join 的结果挂在 cfg._exceptions 上，供 render 首部取用', () => {
  const cfg = repo('| EX-001 | c/a | 理由 | 该项 | 甲 | 2026-12-31 | active |\n'); joinExceptions([und('c/a')], cfg, TODAY)
  assert.equal(cfg._exceptions.valid, 1)
})

// ---------------- 项目自有例外 ----------------

test('ownExceptions：过期未关闭 FAIL（id 带编号）、到期写不成日期记未定、晚于上限记未定、未到期不出', () => {
  const t = TODAY, d = (s) => { const [y, m, dd] = s.split('-').map(Number); return { year: y, month: m, day: dd } }
  const own = [
    { ex_id: 'EX-1', rule: 'G9', expires: '2026-10-07', expires_date: d('2026-10-07'), error: null, lineno: 5 },
    { ex_id: 'EX-2', rule: 'G6', expires: '2026-12-31', expires_date: d('2026-12-31'), error: null, lineno: 6 },
    { ex_id: 'EX-3', rule: 'G11', expires: '', expires_date: null, error: '值为空', lineno: 7 },
    { ex_id: 'EX-4', rule: 'G12', expires: '2028-01-01', expires_date: d('2028-01-01'), error: null, lineno: 8 },
    { ex_id: '', rule: 'G13', expires: '2026-10-08', expires_date: d('2026-10-08'), error: null, lineno: 9 },
  ]
  const out = ownExceptions(own, 'governance/exceptions.md', t, 'base')
  assert.deepEqual(out.map((f) => [f.status, f.id]).sort(), [[FAIL, 'exception-register/own-expired/EX-1'], [UNDETERMINED, 'exception-register/own-too-far'], [UNDETERMINED, 'exception-register/own-undated']].sort())
  assert.match(out.find((f) => f.id.endsWith('own-undated')).reason, /第 7 行 EX-3：值为空/)
  assert.match(out.find((f) => f.id.endsWith('own-too-far')).reason, /第 8 行 EX-4 到期 2028-01-01/)
  const fail = out.find((f) => f.status === FAIL); assert.match(fail.title, /EX-1.*2026-10-07/); assert.match(fail.evidence, /规则列：G9/)
  // 没有编号时用规则做 key，再没有就用行号
  const noId = ownExceptions([{ ex_id: '', rule: 'GX', expires: '2026-01-01', expires_date: d('2026-01-01'), error: null, lineno: 3 }], null, t, 'b')
  assert.equal(noId[0].id, 'exception-register/own-expired/GX')
  const noRule = ownExceptions([{ ex_id: '', rule: '', expires: '2026-01-01', expires_date: d('2026-01-01'), error: null, lineno: 3 }], null, t, 'b')
  assert.equal(noRule[0].id, 'exception-register/own-expired/3')
  assert.match(ownExceptions([{ ex_id: '', rule: '', expires: '', expires_date: null, error: 'e', lineno: 4 }], null, t, 'b')[0].reason, /第 4 行 （无编号）：e/)
})

test('ownExceptions：到期上限边界——今天+365 天不算太远、+366 天算；到期当天不算过期、昨天算', () => {
  const d = (n) => addDays(TODAY, n), row = (n, id) => ({ ex_id: id, rule: 'G', expires: toIso(d(n)), expires_date: d(n), error: null, lineno: 1 })
  const ids = (n) => ownExceptions([row(n, 'E')], null, TODAY, 'b').map((f) => f.id.replace('exception-register/', ''))
  assert.deepEqual(ids(365), [], '恰好 +365 天：合格'); assert.deepEqual(ids(366), ['own-too-far']); assert.deepEqual(ids(0), [], '到期当天未过期'); assert.deepEqual(ids(-1), ['own-expired/E'])
  const far = ownExceptions([row(366, 'E')], null, TODAY, 'b')[0]
  assert.match(far.title, new RegExp(`晚于上限 ${toIso(d(365)).replaceAll('-', '\\-')}（运行日起 365 天）`))
  const farMany = ownExceptions(Array.from({ length: 14 }, (_, i) => ({ ...row(400, 'E' + i), lineno: i + 1 })), null, TODAY, 'b')[0]
  assert.equal((farMany.reason.match(/第 \d+ 行/g) ?? []).length, 12); assert.match(farMany.reason, /共 14 行/)
  // 没有编号时标签回退到规则；两者都没有才写「（无编号）」
  assert.match(ownExceptions([{ ...row(400, ''), rule: 'GR' }], null, TODAY, 'b')[0].reason, /第 1 行 GR 到期/)
  assert.match(ownExceptions([{ ...row(400, ''), rule: '' }], null, TODAY, 'b')[0].reason, /第 1 行 （无编号） 到期/)
  assert.match(ownExceptions([{ ...row(-5, ''), rule: 'GR' }], null, TODAY, 'b')[0].title, /项目例外 第 1 行 GR 已于/)
})

test('ownExceptions：多行超 12 只列前 12', () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({ ex_id: `E${i}`, rule: 'G', expires: '', expires_date: null, error: 'x', lineno: i + 1 }))
  const o = ownExceptions(rows, null, TODAY, 'b')[0]
  assert.equal((o.reason.match(/第 \d+ 行/g) ?? []).length, 12); assert.match(o.reason, /共 14 行/); assert.match(o.title, /有 14 行/)
})

// ---------------- 外部配置判定 ----------------

test('configOutsideRoot：项目内/外、等于根、带分隔符的前缀比较（zz 不吞 zzz）、相对 _path 接到根上', () => {
  const root = mk(), sib = root + 'z'
  assert.deepEqual(configOutsideRoot(root, join(root, 'g', 'p.yaml')), [false, ''])
  assert.deepEqual(configOutsideRoot(root, join(sib, 'p.yaml')), [true, ''], '只差一个字符的兄弟目录是外部')
  assert.deepEqual(configOutsideRoot(root, root), [false, ''])
  assert.deepEqual(configOutsideRoot(root, 'governance/project.yaml'), [false, ''], '相对路径先接到根上，不按当前工作目录')
  assert.deepEqual(configOutsideRoot(root, join(root, '..', 'elsewhere', 'p.yaml')), [true, ''])
  assert.deepEqual(configOutsideRoot(root + '/', join(root, 'a.yaml')), [false, ''], '根带尾斜杠')
  const rootSep = root + (process.platform === 'win32' ? '\\\\' : '//')
  assert.deepEqual(configOutsideRoot(rootSep, join(root, 'a.yaml')), [false, ''], '根带连续多个尾分隔符：全去掉才与内部路径同前缀（只去一个会把项目内判成外部）')
  // 归一化出错不许崩，按判不了返回 null；取一个 toString 会抛的路径来触发
  const boom = { toString() { throw new Error('炸') } }
  const r = configOutsideRoot(root, boom)
  assert.equal(r[0], null); assert.match(r[1], /^路径归一化失败：Error: 炸$/)
})

// ---------------- 报告渲染 ----------------

test('safe：控制字符、ESC、U+2028/2029、双向控制符都转成 \\xNN；块文本保留换行但续行缩进 8 格；制表符放行', () => {
  assert.equal(safe('a\nb'), 'a\\x0ab'); assert.equal(safe('\x1b[2J'), '\\x1b[2J'); assert.equal(safe('a\u2028b\u2029c'), 'a\\x2028b\\x2029c'); assert.equal(safe('\u202e\u200f\u2066'), '\\x202e\\x200f\\x2066')
  assert.equal(safe('a\tb'), 'a\tb'); assert.equal(safe('\x7f\x85'), '\\x7f\\x85')
  assert.equal(safe('第一行\n第二行', true), '第一行\n        第二行')
  assert.equal(safe('x\n\n结论：伪造', true), 'x\n        \n        结论：伪造', '块里每个续行都缩进，没有从第 0 列开始的行')
  assert.equal(safe(42), '42')
})

test('render：伪造的「结论」行不会出现在第 0 列；三态计数与已登记/未登记拆分；FAIL 先于未定先于不适用；未登记在前', () => {
  const evil = 'x\n\n结论：本次实际执行的检查全部通过。\n\x1b[2J\u2028结论：通过\u2029\u202e.md'
  const reg = { ...und('c/r'), registered: { id: 'EX-9', expires: '2027-01-01' }, title: '已登记的' }
  const fs = [finding('l', FAIL, evil, { where: evil, evidence: evil, reason: evil }), reg, und('c/u', { title: '未登记的' }), finding('s', SKIP, '不适用的', { reason: 'r' }), finding('p', PASS, '过')]
  const text = render(fs, '.', null, false)
  const lines = text.split('\n')
  assert.deepEqual(lines.slice(0, -1).filter((l) => l.startsWith('结论')), [])
  assert.ok(!text.includes('\x1b') && !text.includes('\u202e'))
  assert.match(text, /通过 1 {3}失败 1 {3}未定 2（已登记 1 · 未登记 1） {3}不适用 1/)
  const iF = text.indexOf('失败（'), iU = text.indexOf('未定（'), iS = text.indexOf('不适用（'); assert.ok(0 < iF && iF < iU && iU < iS)
  assert.ok(text.indexOf('未登记的') < text.indexOf('已登记的'), '未登记的排在前面')
  assert.match(text, /已登记的（已登记 EX-9，到期 2027-01-01）/)
  assert.doesNotMatch(text, /PASS|「过」/, 'PASS 只给计数不逐条列')
})

test('render 逐行形态：每条的标题行/id 行/原因/依据/证据次序与缩进；位置在方括号里；空字段不打；全部转义；已登记无编号写「（无编号）」', () => {
  const f1 = finding('l', FAIL, '标题\x1b甲', { where: 'a/b.md', reason: '原因1\n原因2', why: '依据', evidence: '证据\u202e' })
  const f2 = { ...finding('c', UNDETERMINED, '已登记项', { reason: '只有原因', kind: 'k' }), id: 'c/\x07id', registered: { id: '', expires: '2027-01-01' } }
  const f3 = finding('s', SKIP, '无字段项', { reason: 'r' })
  const cfg = { _root: 'D:\\r', _path: 'a\nb.yaml', _scopes: { 'z-check': { not_covered: ['不看\x1b甲'] }, 'a-check': { not_covered: ['乙', '丙'] } } }
  const lines = render([f1, f2, f3], 'D:\\r', cfg, true).split('\n')
  assert.equal(lines[1], '配置 · a\\x0ab.yaml（在被扫描项目内）', '配置路径里的控制字符转义')
  assert.equal(lines[6], '  · 标题\\x1b甲  [a/b.md]')
  assert.match(lines[7], /^ {6}id：l\/[0-9a-f]{8}$/)
  assert.deepEqual(lines.slice(8, 12), ['      原因：原因1', '        原因2', '      依据：依据', '      证据：证据\\x202e'], '原因 → 依据 → 证据；块文本续行缩进 8 格')
  assert.equal(lines[14], '  · 已登记项（已登记 （无编号），到期 2027-01-01）'); assert.equal(lines[15], '      id：c/\\x07id', 'id 行转义')
  assert.deepEqual(lines.slice(16, 18), ['      原因：只有原因', ''], '没有依据/证据就不打这两行（空字段不出）')
  assert.deepEqual(lines.slice(24, 29), ['  a-check', '    不看：乙', '    不看：丙', '  z-check', '    不看：不看\\x1b甲'], '覆盖边界：检查器按码点序，「不看」转义')
  // 插入序恰为升序的输入：只有真排序才分得出「排序」与「把插入序反过来」
  const asc = render([], '.', { _scopes: { 'a-check': { not_covered: ['甲'] }, 'b-check': { not_covered: ['乙'] }, 'c-check': { not_covered: ['丙'] } } }, true)
  assert.ok(asc.indexOf('a-check') < asc.indexOf('b-check') && asc.indexOf('b-check') < asc.indexOf('c-check'))
  // 插入序是乱序的输入：不能只靠插入序
  const mix = render([], '.', { _scopes: { 'b-check': { not_covered: ['乙'] }, 'c-check': { not_covered: ['丙'] }, 'a-check': { not_covered: ['甲'] } } }, true)
  assert.ok(mix.indexOf('a-check') < mix.indexOf('b-check') && mix.indexOf('b-check') < mix.indexOf('c-check'))
})

test('render 计数：已登记数只数「未定且登记了」的发现（非未定的发现带了 registered 也不计）', () => {
  const stray = { ...finding('p', PASS, '不该带登记'), registered: { id: 'E', expires: '2027-01-01' } }
  const text = render([stray, und('c/u')], '.', null, false)
  assert.match(text, /未定 1（已登记 0 · 未登记 1）/); assert.match(text, /^结论：未定 —— 有 1 项没能判定且未登记。\*\*/m)
})

test('render 结论行四种：FAIL / 有未登记未定 / 只有已登记未定（带最近到期）/ 全通过', () => {
  const r = (fs) => render(fs, '.', null, false).split('\n').filter((l) => l.startsWith('结论')).join('|')
  assert.equal(r([finding('l', FAIL, 't'), und('c/u')]), '结论：FAIL。')
  assert.match(r([und('c/u')]), /^结论：未定 —— 有 1 项没能判定且未登记。\*\*未定不是通过\*\*/)
  assert.match(r([und('c/u'), { ...und('c/r'), registered: { id: 'E', expires: '2027-02-02' } }]), /有 1 项没能判定且未登记，另有 1 项已登记/)
  assert.match(r([{ ...und('c/r'), registered: { id: 'E1', expires: '2027-02-02' } }, { ...und('c/s'), registered: { id: 'E2', expires: '2027-01-01' } }]), /^结论：无未登记的未定；仍有 2 项已登记未定（最近到期 2027-01-01）/)
  assert.equal(r([finding('p', PASS, 't')]), '结论：本次实际执行的检查全部通过。通过只覆盖上面列出的范围。')
})

test('render 首部：身份行取自 SKIP 的身份条目；配置行三种；登记行三种；cfg 为 null 时不打配置与登记', () => {
  const id = finding(IDENTITY_CHECK, SKIP, '身份行文字', { reason: 'r' })
  const t0 = render([id], '.', null, false); assert.match(t0, /^标准检查 · .*\n身份行文字\n {2}通过/); assert.doesNotMatch(t0, /配置 ·|登记 ·/)
  const root = mk()
  const c1 = { _root: root, _path: 'governance/project.yaml' }; assert.match(render([id], root, c1, false), /配置 · governance\/project\.yaml（在被扫描项目内）\n登记 · 无/)
  const c2 = { _root: root, _path: join(mk(), 'p.yaml') }; assert.match(render([id], root, c2, false), /（外部配置，不在被扫描项目内）/)
  const c3 = { ...c1, _exceptions: { display: 'governance/exceptions.md', valid: 3, expired: 0 } }; assert.match(render([id], root, c3, false), /登记 · governance\/exceptions\.md（3 行有效）/)
  const c4 = { ...c1, _exceptions: { display: 'governance/exceptions.md', valid: 3, expired: 2 } }; assert.match(render([id], root, c4, false), /（3 行有效，其中 2 行已过期）/)
})

test('render 覆盖边界：showScope=false 不打；cfg 为 null 打「配置没读进来」；有 cfg._scopes 用它，按码点序列出各检查器的「不看」', () => {
  assert.doesNotMatch(render([], '.', null, false), /覆盖边界/)
  assert.match(render([], '.', null, true), /覆盖边界[\s\S]*未定：配置没读进来/)
  const t = render([], '.', { _scopes: { 'b-check': { not_covered: ['乙'] }, 'a-check': { not_covered: ['甲', '丙'] } } }, true)
  assert.ok(t.indexOf('a-check') < t.indexOf('b-check')); assert.match(t, /a-check\n {4}不看：甲\n {4}不看：丙/)
  const live = render([], '.', {}, true, [mod({ NAME: 'z', scope: () => ({ covered: [], not_covered: ['现算'] }) })]); assert.match(live, /z\n {4}不看：现算/, '没有 _scopes 时现算')
})

test('scopes：scope() 抛异常记在该检查器的 not_covered 里，不带走其它检查器', () => {
  const sc = scopes({}, [mod({ NAME: 'a', scope: () => { throw new Error('炸') } }), mod({ NAME: 'b' })])
  assert.match(sc.a.not_covered[0], /scope\(\) 出错：炸/); assert.deepEqual(sc.b.not_covered, ['n'])
})

// ---------------- 退出码 ----------------

test('exitCode：有 FAIL → 1（压过未定）；无 FAIL 有未登记未定 → 2；只有已登记未定 → 0；SKIP/PASS → 0', () => {
  assert.equal(exitCode([finding('p', PASS, 't')]), 0)
  assert.equal(exitCode([finding('s', SKIP, 't', { reason: 'r' })]), 0)
  assert.equal(exitCode([und('c/u')]), 2)
  assert.equal(exitCode([{ ...und('c/u'), registered: { id: 'E', expires: '2027-01-01' } }]), 0)
  assert.equal(exitCode([und('c/u'), finding('l', FAIL, 't')]), 1)
  assert.equal(exitCode([{ ...und('c/u'), registered: { id: 'E', expires: '2027-01-01' } }, und('c/v')]), 2)
})

// ---------------- runAll ----------------

function project(extra = '') {
  const root = mk(); mkdirSync(join(root, 'governance'))
  writeFileSync(join(root, 'governance', 'project.yaml'), `tier: L0\nlayout:\n  entry:\n    - AGENTS.md\n${extra}`)
  writeFileSync(join(root, 'AGENTS.md'), '# x\n')
  return root
}
const fakeIdentity = () => ({ digest: '0'.repeat(64), files: [], git_head: 'x', dirty: false, dirty_detail: '' })
const fixtureEnvForTest = () => { const e = { ...process.env }; for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete e[k]; return e }
function gitInit(root) {
  for (const a of [['init', '-q'], ['add', '-A']]) { const r = spawnSync('git', ['-C', root, '-c', 'init.defaultBranch=main', ...a], { env: fixtureEnvForTest(), encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr) }
}

test('runAll：一次扫描内 git ls-files 只跑一次（各检查器共用缓存）；扫描结束后缓存关闭', () => {
  const root = project(); gitInit(root)
  // 假检查器在 run 里读两次跟踪清单，两次之间往仓里加一个跟踪文件：有缓存两次相同；没缓存第二次就看得到新文件
  const seen = []
  const reader = mod({ run: () => {
    seen.push(trackedFiles(root)[0].length)
    writeFileSync(join(root, 'late.md'), 'x\n'); spawnSync('git', ['-C', root, 'add', 'late.md'], { env: fixtureEnvForTest() })
    seen.push(trackedFiles(root)[0].length)
    return []
  } })
  runAll(root, { mods: [reader], identity: fakeIdentity })
  assert.equal(seen[0], seen[1], '扫描内第二次读取命中缓存，看不到中途加的文件')
  assert.equal(trackedFiles(root)[0].length, seen[0] + 1, '扫描结束缓存关闭：现在读得到')
})

test('runAll：配置读不到 → 整份一条未定（不跑任何检查器）、cfg 为 null', () => {
  const root = mk(); let ran = false
  const [fs, cfg] = runAll(root, { mods: [mod({ run: () => { ran = true; return [] } })], identity: fakeIdentity })
  assert.equal(cfg, null); assert.equal(ran, false)
  const f = fs.find((x) => x.check === 'check_all'); assert.equal(f.status, UNDETERMINED); assert.match(f.title, /读不到项目配置/)
})

test('runAll：外部配置不存在 → 同样整份未定，不回退去猜项目布局', () => {
  const [fs] = runAll(project(), { configPath: join(mk(), '没有.yaml'), mods: [mod()], identity: fakeIdentity })
  assert.match(fs.find((x) => x.check === 'check_all').reason, /指定的外部配置.*不存在/)
})

test('runAll：检查器表为空 → 「没有发现任何检查器」', () => {
  const [fs, cfg] = runAll(project(), { mods: [], identity: fakeIdentity })
  assert.equal(cfg, null); assert.ok(fs.some((x) => x.title === '没有发现任何检查器'))
})

test('runAll：跑全部检查器、结果带身份条目打头、裁剪名校验在前、cfg 带 _scopes；某检查器崩溃只影响自己', () => {
  const root = project('')
  const [fs, cfg] = runAll(root, {
    mods: [mod({ NAME: 'a', run: () => [finding('a', PASS, 'A')] }), mod({ NAME: 'b', run: () => { throw new Error('炸') } }), mod({ NAME: 'c', run: () => [finding('c', FAIL, 'C')] })],
    identity: fakeIdentity,
  })
  assert.equal(fs[0].check, IDENTITY_CHECK)
  assert.deepEqual(fs.filter((f) => f.check !== IDENTITY_CHECK).map((f) => [f.check, f.status]), [['a', PASS], ['b', UNDETERMINED], ['c', FAIL]])
  assert.deepEqual(Object.keys(cfg._scopes), ['a', 'b', 'c'])
  const [fs2] = runAll(project('tailoring:\n  - check: 写错了\n    applicable: false\n    reason: x\n'), { mods: [mod()], identity: fakeIdentity })
  const order = fs2.map((f) => f.check)
  assert.deepEqual(order, [IDENTITY_CHECK, 'tailoring', 'm'], '身份 → 裁剪名校验 → 检查器；校验在检查器之前（报告里先看到「你的裁剪没生效」）')
  assert.equal(fs[0].status, SKIP, '身份条目是 SKIP——记录不是判定，不计三态、不影响退出码')
  assert.equal(exitCode([fs[0]]), 0)
})

test('runAll：git 版本过旧 → 整份一条未定（id 稳定，可登记），不跑检查器', () => {
  // 版本判断本身（2.25 报问题、2.31 放行）在 test/git.test.mjs 钉；这里钉汇总层拿到问题之后怎么处置
  let ran = false
  const [fs, cfg] = runAll(project(), { mods: [mod({ run: () => { ran = true; return [] } })], identity: fakeIdentity, gitProblem: () => 'git 2.25 低于 2.31：请升级' })
  assert.equal(ran, false); assert.equal(cfg, null)
  const f = fs.find((x) => x.check === 'check_all'); assert.equal(f.status, UNDETERMINED); assert.equal(f.id, 'check_all/git-too-old', 'id 带 kind：标题以后改了登记行也不失效'); assert.match(f.reason, /2\.25/)
  assert.equal(exitCode(fs), 2)
  const [fs2] = runAll(project(), { mods: [mod()], identity: fakeIdentity, gitProblem: () => null })
  assert.ok(!fs2.some((x) => x.id === 'check_all/git-too-old'), '没问题时不报')
  let n = 0
  const [fs3] = runAll(project(), { mods: [mod()], identity: () => ({ ...fakeIdentity(), digest: String(n++).repeat(64) }), gitProblem: () => '旧' })
  assert.equal(fs3.length, 1, 'git 过旧的收尾也要封签')
})

test('runAll：today 注入传到登记 join（到期按注入日判，不按真实今天）', () => {
  const root = project(); writeFileSync(join(root, 'governance', 'exceptions.md'), '# x\n\n' + EX_HEAD + '| EX-001 | m/u | 理由 | 该项 | 甲 | 2026-06-30 | active |\n')
  const run = (today) => runAll(root, { mods: [mod({ run: () => [{ ...und('m/u'), check: 'm' }] })], identity: fakeIdentity, today })[0]
  assert.equal(run({ year: 2026, month: 6, day: 1 }).find((f) => f.id === 'm/u').registered?.id, 'EX-001', '注入日在到期前 → 登记生效（真实今天已过 2026-06-30，不注入会是过期）')
  assert.equal(run({ year: 2026, month: 7, day: 1 }).find((f) => f.id === 'm/u').registered, null)
})

test('runAll：扫描期间检查器被改（身份前后不一致）→ 整份作废只留一条未定', () => {
  let n = 0
  const [fs] = runAll(project(), { mods: [mod()], identity: () => ({ ...fakeIdentity(), digest: String(n++).repeat(64) }) })
  assert.equal(fs.length, 1); assert.equal(fs[0].check, IDENTITY_CHECK); assert.equal(fs[0].status, UNDETERMINED)
})

test('runAll --selftest：先汇总层自检（注入）再逐个检查器自检；闸门不过的检查器给闸门发现而不是自检结果；也封签', () => {
  const extra = () => [finding('extra', PASS, '汇总层自检')]
  const [fs] = runAll(project(), { selftestOnly: true, extraSelftest: extra, mods: [mod({ NAME: 'good' }), mod({ NAME: 'bad', selftest: () => [] })], identity: fakeIdentity })
  assert.deepEqual(fs.map((f) => f.check), [IDENTITY_CHECK, 'extra', 'm', 'm', 'bad'], '好的给两条自检结果（check 是 m：mod() 里写死），坏的给一条闸门发现')
  assert.equal(fs.at(-1).status, UNDETERMINED)
  let n = 0
  const [sealedFs] = runAll(project(), { selftestOnly: true, mods: [mod()], identity: () => ({ ...fakeIdentity(), digest: String(n++).repeat(64) }) })
  assert.equal(sealedFs.length, 1, '--selftest 也要封签')
})

test('runAll：登记 join 在检查器全部跑完之后；cfg._exceptions 在返回的 cfg 上', () => {
  const root = project(); writeFileSync(join(root, 'governance', 'exceptions.md'), '# x\n\n' + EX_HEAD + `| EX-001 | m/u | 理由 | 该项 | 甲 | ${toIso(addDays(todayLocal(), 30))} | active |\n`)
  const [fs, cfg] = runAll(root, { mods: [mod({ run: () => [{ ...und('m/u'), check: 'm' }] })], identity: fakeIdentity })
  assert.equal(fs.find((f) => f.id === 'm/u').registered?.id, 'EX-001'); assert.equal(cfg._exceptions.valid, 1)
  assert.equal(exitCode(fs), 0)
})

// ---------------- main / 参数 ----------------

test('parseArgs：位置参数是项目根；--config 两种写法；认不出的参数与多余位置参数报错而不是静默忽略', () => {
  assert.deepEqual(parseArgs([]), { root: '.', selftest: false, json: false, noScope: false, config: null })
  assert.deepEqual(parseArgs(['p', '--json', '--no-scope', '--selftest', '--config', 'c.yaml']), { root: 'p', selftest: true, json: true, noScope: true, config: 'c.yaml' })
  assert.equal(parseArgs(['--config=c.yaml']).config, 'c.yaml')
  assert.equal(typeof parseArgs(['--config']), 'string'); assert.match(parseArgs(['--config']), /需要一个路径/)
  assert.match(parseArgs(['--nope']), /不认识的参数：--nope/); assert.match(parseArgs(['a', 'b']), /多余的位置参数：b/)
  assert.equal(parseArgs(['-']).root, '-', '单个 - 当位置参数')
})

test('main：坏参数 → 退出 2 且写 stderr、不写 stdout；每个退出码都能被调用方拿到（不调 process.exit）', () => {
  const out = [], err = []
  assert.equal(main(['--nope'], undefined, { out: (t) => out.push(t), err: (t) => err.push(t) }), 2)
  assert.deepEqual(out, []); assert.match(err[0], /std-check: 不认识的参数/)
})

test('main：真实小项目 --json 输出可解析、含恰好一条身份条目；退出码与 exitCode 一致；--no-scope 不打覆盖边界', () => {
  // 用假检查器表：真实的 10 个检查器每次要跑 20 多秒，变异验证乘不起；真实检查器的整体行为由 scripts/golden-compare-all.mjs 与 std-check 对本仓的实跑钉
  const root = project(), out = [], fake = [mod({ run: () => [und('m/u')] })]
  const code = main([root, '--json'], undefined, { out: (t) => out.push(t), err: () => {} }, fake)
  const data = JSON.parse(out.join('\n'))
  assert.ok(Array.isArray(data)); assert.equal(data.filter((f) => f.check === IDENTITY_CHECK).length, 1)
  assert.equal(code, exitCode(data)); assert.equal(code, 2, '有一条未登记未定 → 2')
  const txt = []; main([root, '--no-scope'], undefined, { out: (t) => txt.push(t), err: () => {} }, fake); assert.doesNotMatch(txt.join('\n'), /覆盖边界/)
  const txt2 = []; main([root], undefined, { out: (t) => txt2.push(t), err: () => {} }, fake); assert.match(txt2.join('\n'), /覆盖边界[\s\S]*不看：n/, '覆盖边界用的是传入的检查器表')
  const sel = []; main([root, '--selftest'], undefined, { out: (t) => sel.push(t), err: () => {} }, fake); assert.doesNotMatch(sel.join('\n'), /覆盖边界/, '--selftest 不打覆盖边界')
})

test('main：runAll 内部崩溃 → 输出一行说明、退出 2，不抛', () => {
  const out = []
  assert.equal(main([mk(), '--selftest'], () => { throw new Error('自检炸了') }, { out: (t) => out.push(t), err: () => {} }), 2)
  assert.match(out[0], /check_all 自身崩溃，本次没有结论（记未定，退出码 2）：Error: 自检炸了/)
})
