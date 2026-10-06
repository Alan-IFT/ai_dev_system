// core/git 的单元测试。
// ①纯函数（版本判断、环境加固）：对 Python 版的单元黄金样本（golden/unit/stdlib-git.json）逐条比对。
// ②filterEnv / shallowProblem：要起真实 git，在临时目录里建**恶意仓**——配置里写会 touch 标记文件的外部程序，断言标记文件一个都没出现。
//    这是整个 core 里最容易「看起来对、实际不安全」的一块（设计 §12.6 D9），所以验证做的是**行为**（外部程序真的没跑），不是代码长什么样。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, utimesSync, chmodSync } from 'node:fs'
import { tmpdir, devNull } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { GIT_HARDEN_CONFIG, GIT_HARDEN_ENV, GIT_LOCAL_ENV, hardenedEnv, gitVersionProblem, filterEnv, shallowProblem, _clearFilterEnvCache } from '../lib/core/git.js'

const here = dirname(fileURLToPath(import.meta.url))
const gold = JSON.parse(readFileSync(join(here, '..', 'golden', 'unit', 'stdlib-git.json'), 'utf8'))

test('gitVersionProblem：对 Python 黄金样本逐条一致', () => {
  assert.ok(gold.version.length >= 10)
  for (const { in: v, out } of gold.version) assert.equal(gitVersionProblem(v), out, JSON.stringify(v))
})

test('hardenedEnv：对 Python scrub_git_env 的结果逐变量一致（去掉定位变量与旧的 CONFIG_KEY/VALUE，注入加固，保留无关变量）', () => {
  const { before, after, devnull } = gold.scrub
  const got = hardenedEnv(before)
  // Python 的 os.devnull 在 Windows 是 'nul'、POSIX 是 '/dev/null'；样本记录了生成时的值，TS 用 os.devNull——比对前归一
  const norm = (e) => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v === devnull ? '<DEVNULL>' : v === devNull ? '<DEVNULL>' : v]))
  assert.deepEqual(norm(got), norm(after))
})

test('hardenedEnv 是纯函数：不读不写 process.env，不改入参（设计 §12.6 D9）', () => {
  // 先把每个会被加固的变量在 process.env 里设成**哨兵值**：DSH 会话里 GIT_PAGER 本来就是 cat，写入 cat 前后看不出差别（变异 G9 因此没被抓住）。
  // 哨兵值不可能等于任何加固值，所以只要 hardenedEnv 写了 process.env，哨兵就会被改掉。
  const touched = [...GIT_HARDEN_ENV.map(([k]) => k), 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', ...GIT_LOCAL_ENV]
  const saved = Object.fromEntries(touched.map((k) => [k, process.env[k]]))
  for (const k of touched) process.env[k] = '__SENTINEL__'
  try {
    const base = { GIT_DIR: '/evil', KEEP: '1' }
    const baseCopy = JSON.stringify(base)
    const env = hardenedEnv(base)
    for (const k of touched) assert.equal(process.env[k], '__SENTINEL__', `process.env.${k} 被改了`)
    assert.equal(JSON.stringify(base), baseCopy, '入参被改了')
    assert.ok(!('GIT_DIR' in env)); assert.equal(env.KEEP, '1'); assert.equal(env.GIT_PAGER, 'cat')
  } finally { for (const k of touched) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } }
})

test('hardenedEnv 对 base 里不存在 GIT_CONFIG_KEY_0 时不循环空转；对 64 个连续旧键全部清掉', () => {
  const base = {}
  for (let i = 0; i < 70; i++) { base[`GIT_CONFIG_KEY_${i}`] = 'k' + i; base[`GIT_CONFIG_VALUE_${i}`] = 'v' + i }
  const env = hardenedEnv(base)
  const stale = Object.keys(env).filter((k) => /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k) && Number(k.split('_').pop()) >= GIT_HARDEN_CONFIG.length)
  // Python：循环最多清 64 个（range(64)），第 65 个起的旧键留着——COUNT 只认前 N 个，所以它们不生效；此处同样只清 64 个，与 Python 一致
  assert.equal(env.GIT_CONFIG_COUNT, String(GIT_HARDEN_CONFIG.length))
  assert.ok(stale.every((k) => Number(k.split('_').pop()) >= 64), '64 以内的旧键必须清掉：' + stale.slice(0, 4))
})

test('加固配置的取值：四项用 true 而不是空串（D9），hooksPath 指向空设备', () => {
  const m = new Map(GIT_HARDEN_CONFIG)
  for (const k of ['core.sshCommand', 'core.gitProxy', 'core.askPass', 'diff.external']) assert.equal(m.get(k), 'true', k)
  assert.equal(m.get('core.hooksPath'), devNull)
  assert.equal(m.get('core.fsmonitor'), 'false'); assert.equal(m.get('log.showSignature'), 'false'); assert.equal(m.get('core.pager'), 'cat')
  assert.deepEqual(GIT_HARDEN_ENV.map(([k]) => k).sort(), ['GIT_OPTIONAL_LOCKS', 'GIT_PAGER', 'GIT_TERMINAL_PROMPT'])
  assert.ok(GIT_LOCAL_ENV.includes('GIT_DIR') && GIT_LOCAL_ENV.includes('GIT_INDEX_FILE') && !GIT_LOCAL_ENV.includes('GIT_CEILING_DIRECTORIES'))
})

// ---------------------------------------------------------------------------------------------
// 恶意仓：行为验证
// ---------------------------------------------------------------------------------------------
const gitId = ['-c', 'init.defaultBranch=main', '-c', 'user.email=std@example.invalid', '-c', 'user.name=std', '-c', 'commit.gpgsign=false', '-c', 'protocol.file.allow=always']
const haveSh = process.platform !== 'win32' || spawnSync('sh', ['-c', 'exit 0']).status === 0
function git(repo, ...args) {
  const r = spawnSync('git', ['-C', repo, ...gitId, ...args], { encoding: 'utf8', timeout: 60000 })
  if (r.status !== 0) throw new Error(`git ${args[0]} 退出码 ${r.status}：${(r.stderr || '').slice(-200)}`)
  return r.stdout.trim()
}
const touchCmd = (mark, tag) => `touch ${mark.replaceAll('\\', '/')}${tag}`

test('恶意仓：配置里的 fsmonitor、textconv、两个 clean 过滤器（其一名字带 =）、diff.external 都不得被执行', { skip: haveSh ? false : '没有 sh（标记文件靠 touch 创建）' }, () => {
  _clearFilterEnvCache()
  const tmp = mkdtempSync(join(tmpdir(), 'tsgit-'))
  try {
    const mark = join(tmp, 'PWNED_'), proj = join(tmp, 'proj')
    mkdirSync(join(proj, 'docs'), { recursive: true })
    writeFileSync(join(proj, 'docs', 'a.md'), '# a\n\n2099-01-01 已完成 某事\n')
    writeFileSync(join(proj, 'docs', 'b.md'), '# b\n')
    writeFileSync(join(proj, '.gitattributes'), '*.md diff=evil filter=evil\ndocs/b.md filter=a=b\n')
    git(proj, 'init', '-q'); git(proj, 'add', '-A'); git(proj, 'commit', '-q', '-m', 's')
    const cfg = [
      ['core.fsmonitor', `${touchCmd(mark, 'fsmonitor')}; false`],
      ['diff.evil.textconv', `sh -c '${touchCmd(mark, 'textconv')}; cat "$1"' -`],
      ['filter.evil.clean', `sh -c '${touchCmd(mark, 'clean')}; cat'`],
      ['filter.a=b.clean', `sh -c '${touchCmd(mark, 'clean_eq')}; cat'`],
      ['diff.external', touchCmd(mark, 'external')],
    ]
    for (const [k, v] of cfg) git(proj, 'config', k, v)
    for (const rel of ['docs/a.md', 'docs/b.md']) { const t = new Date(); utimesSync(join(proj, rel), t, t) } // stat 失效，逼 git 重读工作区

    // 对照组：不加固时这些程序**确实会被执行**——否则「没被执行」什么都没证明
    const plain = { ...process.env }
    spawnSync('git', ['-C', proj, 'status', '--porcelain'], { env: plain, timeout: 60000 })
    spawnSync('git', ['-C', proj, 'blame', '--', 'docs/a.md'], { env: plain, timeout: 60000 })           // 不带 --no-textconv：textconv 会跑
    const controlHits = readdirSync(tmp).filter((f) => f.startsWith('PWNED_')).map((f) => f.slice(6))
    assert.ok(controlHits.length > 0, '对照组：不加固时至少应有一个外部程序被执行，否则这条测试没有区分力。实得 ' + JSON.stringify(controlHits))
    for (const f of readdirSync(tmp).filter((f) => f.startsWith('PWNED_'))) rmSync(join(tmp, f))

    // 实验组：加固后同样的调用，一个都不许执行
    _clearFilterEnvCache()
    const hard = hardenedEnv(process.env)
    const fe = filterEnv(proj, hard)
    assert.ok(fe, 'filterEnv 应能列出过滤器名')
    spawnSync('git', ['-C', proj, 'status', '--porcelain'], { env: fe, timeout: 60000 })
    // **textconv 的防御不在 core/git**：它靠调用方在命令行上写 --no-textconv（Python 版 check_drift 的 blame 就这么写），
    // 因为 diff.<driver>.textconv 的驱动名是被扫方起的，列不全。所以这里照真实调用方的写法调用。
    spawnSync('git', ['-C', proj, 'blame', '-p', '--no-textconv', '--', 'docs/a.md'], { env: fe, timeout: 60000 })
    spawnSync('git', ['-C', proj, 'log', '-1'], { env: hard, timeout: 60000 })
    const hits = readdirSync(tmp).filter((f) => f.startsWith('PWNED_')).map((f) => f.slice(6))
    assert.deepEqual(hits, [], '被执行：' + hits.join('、') + '（对照组被执行的是 ' + controlHits.join('、') + '）')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('filterEnv：配置坏了列不出过滤器名时返回 null，调用方据此记未定而不是照常执行', () => {
  _clearFilterEnvCache()
  const tmp = mkdtempSync(join(tmpdir(), 'tsgit-'))
  try {
    const bad = join(tmp, 'bad')
    spawnSync('git', ['init', '-q', bad], { timeout: 60000 })
    writeFileSync(join(bad, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n[broken\n')
    assert.equal(filterEnv(bad, hardenedEnv(process.env)), null)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('filterEnv：一个过滤器都没配（git 退出码 1）是正常出口，返回环境而不是 null；且不改入参', () => {
  _clearFilterEnvCache()
  const tmp = mkdtempSync(join(tmpdir(), 'tsgit-'))
  try {
    const clean = join(tmp, 'clean'); spawnSync('git', ['init', '-q', clean], { timeout: 60000 })
    // 用户级与系统级 gitconfig 里本身可能配了过滤器（git-lfs 很常见，本机实测就有），那就不是「一个过滤器都没配」了。
    // 把这两层指向一个**真实的空文件**屏蔽掉。不能用 os.devNull：它在 Windows 上是 `\\.\nul`，git 不接受它当配置文件（退出码 128）。
    const emptyCfg = join(tmp, 'empty.gitconfig'); writeFileSync(emptyCfg, '')
    const base = hardenedEnv({ ...process.env, GIT_CONFIG_GLOBAL: emptyCfg, GIT_CONFIG_SYSTEM: emptyCfg })
    const before = JSON.stringify(base)
    const fe = filterEnv(clean, base)
    assert.ok(fe !== null)
    assert.equal(JSON.stringify(base), before, '入参被改了')
    assert.equal(fe.GIT_CONFIG_COUNT, base.GIT_CONFIG_COUNT, '没有过滤器时不追加任何条目')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('filterEnv：名字带 = 的过滤器按键值分开传，不被切错（对应 `-c k=v` 会切错的那个反例）', () => {
  _clearFilterEnvCache()
  const tmp = mkdtempSync(join(tmpdir(), 'tsgit-'))
  try {
    const repo = join(tmp, 'r'); spawnSync('git', ['init', '-q', repo], { timeout: 60000 })
    spawnSync('git', ['-C', repo, 'config', 'filter.a=b.clean', 'x'], { timeout: 60000 })
    spawnSync('git', ['-C', repo, 'config', 'filter.evil.smudge', 'y'], { timeout: 60000 })
    const fe = filterEnv(repo, hardenedEnv(process.env))
    assert.ok(fe)
    const pairs = []
    for (let i = 0; i < Number(fe.GIT_CONFIG_COUNT); i++) pairs.push([fe[`GIT_CONFIG_KEY_${i}`], fe[`GIT_CONFIG_VALUE_${i}`]])
    const keys = pairs.map(([k]) => k)
    assert.ok(keys.includes('filter.a=b.clean') && keys.includes('filter.a=b.required'), '名字带 = 的过滤器应原样出现：' + keys.slice(-8))
    assert.equal(new Map(pairs).get('filter.a=b.required'), 'false'); assert.equal(new Map(pairs).get('filter.a=b.clean'), '')
    assert.ok(keys.includes('filter.evil.smudge') && keys.includes('filter.evil.process'))
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('filterEnv：不改入参 base（有过滤器时才会追加条目，变异 F9）；名字里自己带点的过滤器取对前缀（变异 F10）', () => {
  _clearFilterEnvCache()
  const tmp = mkdtempSync(join(tmpdir(), 'tsgit-'))
  try {
    const repo = join(tmp, 'r'); spawnSync('git', ['init', '-q', repo], { timeout: 60000 })
    spawnSync('git', ['-C', repo, 'config', 'filter.my.driver.clean', 'x'], { timeout: 60000 })   // 名字是 my.driver，自己带点
    const emptyCfg = join(tmp, 'empty.gitconfig'); writeFileSync(emptyCfg, '')
    const base = hardenedEnv({ ...process.env, GIT_CONFIG_GLOBAL: emptyCfg, GIT_CONFIG_SYSTEM: emptyCfg })
    const before = JSON.stringify(base)
    const fe = filterEnv(repo, base)
    assert.ok(fe)
    assert.equal(JSON.stringify(base), before, '入参被改了：有过滤器时 filterEnv 会追加条目，必须追加到拷贝上')
    assert.notEqual(fe.GIT_CONFIG_COUNT, base.GIT_CONFIG_COUNT)
    const keys = []; for (let i = 0; i < Number(fe.GIT_CONFIG_COUNT); i++) keys.push(fe[`GIT_CONFIG_KEY_${i}`])
    assert.ok(keys.includes('filter.my.driver.clean') && keys.includes('filter.my.driver.smudge') && keys.includes('filter.my.driver.required'), '带点的名字应取整个 filter.my.driver：' + keys.slice(-4))
    assert.ok(!keys.includes('filter.my.clean'), '不应被切成 filter.my')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('shallowProblem：完整仓返回 null；浅克隆返回原因串；不是 git 仓返回退出码原因', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tsgit-'))
  try {
    const src = join(tmp, 'src'); mkdirSync(src)
    writeFileSync(join(src, 'a.txt'), '1'); git(src, 'init', '-q'); git(src, 'add', '-A'); git(src, 'commit', '-q', '-m', 'one')
    writeFileSync(join(src, 'a.txt'), '2'); git(src, 'add', '-A'); git(src, 'commit', '-q', '-m', 'two')
    const env = hardenedEnv(process.env)
    assert.equal(shallowProblem(src, env), null)
    const shallow = join(tmp, 'shallow')
    const r = spawnSync('git', ['clone', '-q', '--depth', '1', '--no-local', 'file:///' + src.replaceAll('\\', '/').replace(/^\//, ''), shallow], { encoding: 'utf8', timeout: 60000, env: process.env })
    assert.equal(r.status, 0, '浅克隆失败：' + r.stderr)
    assert.match(shallowProblem(shallow, env) ?? '', /^浅克隆：/)
    const notRepo = join(tmp, 'plain'); mkdirSync(notRepo)
    assert.match(shallowProblem(notRepo, { ...env, GIT_CEILING_DIRECTORIES: tmp }) ?? '', /^git rev-parse --is-shallow-repository 退出码 \d+/)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})
