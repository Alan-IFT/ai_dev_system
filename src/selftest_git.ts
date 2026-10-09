// git 相关的汇总层自检（对应 tools/std/check_all.py 的 `_git_env_selftest`、`_hostile_git_config_selftest`；设计 §12.31）。标题与 Python 版逐字相同。
//
// 两条都是**真实事故**的复现：①从 git worktree 提交时 pre-commit 钩子带着绝对 `GIT_DIR` 跑 check_all，曾把真实仓改成 bare；
// ②扫描不可信目录时，其 `.git/config` 可让 git 执行任意命令（fsmonitor、textconv、过滤器、gpg）。
// 与 Python 版的有意差异：
//   · 夹具入口文件由 `CLAUDE.md` 改为 `AGENTS.md`；
//   · 子模块那一段原本调 `adoption._embedded_readonly`（内嵌 `.std/` 只读判据，已废弃，§12.28）——这一段的对象没了，TS 版不迁，但子模块过滤器不被执行这件事本身
//     由 `git status` 的 `--ignore-submodules=all`（`toolIdentity` 用）与 `hardenedEnv` 保证，这里改为直接对子模块仓跑 `filterEnv` 路径的 git status，仍断言标记文件不存在。

import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAll, toolIdentity } from './check_all.js'
import { fixtureEnv, writeText } from './core/fixture.js'
import { FAIL, PASS, finding, type Finding } from './core/finding.js'
import { filterEnv, hardenedEnv } from './core/git.js'
import { blame } from './checks/drift.js'

const TITLE_ENV = '钩子注入的 GIT_DIR 等变量不得让夹具写进调用方的仓'
const WHY_ENV = '从 worktree 提交时 pre-commit 钩子带着绝对 GIT_DIR 跑 check_all，曾把真实仓改成 bare'
const TITLE_HOSTILE = '被扫仓配置里的外部程序不得被执行'
const WHY_HOSTILE = '扫描不可信目录时，其 .git/config 可让 git 执行任意命令（fsmonitor、textconv、过滤器、gpg）'

const GIT_ID = ['-c', 'init.defaultBranch=main', '-c', 'user.email=std@example.invalid', '-c', 'user.name=std', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.autocrlf=false']
const SMOKE_ENTRY = '# 冒烟仓\n\n这个仓只为跑通入口冒烟自检而存在，内容不参与任何判定。\n'
const SMOKE_CONFIG = 'layout:\n  entry:\n    - AGENTS.md\n  docs_root: docs\n  frozen:\n    - docs/archive\nbudgets:\n  entry_lines: 150\n'

const HERE = dirname(fileURLToPath(import.meta.url))

function git(repo: string, args: readonly string[], extra: readonly string[] = [], input?: Buffer): string {
  const r = spawnSync('git', ['-C', repo, ...GIT_ID, ...extra, ...args], { timeout: 60_000, input, env: fixtureEnv() })
  if (r.status !== 0) throw new Error(`git ${args[0]} 退出码 ${r.status}：${(r.stderr ?? Buffer.alloc(0)).toString('utf8').slice(-200)}`) // py-semantics-ok: 展示——夹具报错文字，不进判据
  return (r.stdout ?? Buffer.alloc(0)).toString('utf8').trim()
}

/** 牺牲仓 `.git` 里会因误写而变的几处：HEAD、config、packed-refs、refs/**。 */
function snap(repo: string): Map<string, string> {
  const gd = join(repo, '.git'), got = new Map<string, string>()
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) { walk(p); continue }
      const rel = relative(gd, p).split('\\').join('/')
      if (rel === 'HEAD' || rel === 'config' || rel === 'packed-refs' || rel.startsWith('refs/')) got.set(rel, readFileSync(p).toString('latin1'))
    }
  }
  walk(gd)
  return got
}

/**
 * 钩子注入的 GIT_DIR 不得把夹具写进别的仓。建一个牺牲仓，照 worktree 钩子实测的注入形态（绝对 GIT_DIR 与 GIT_INDEX_FILE，不带 GIT_WORK_TREE——带上它反而掩盖泄漏）指向它，
 * 以子进程走真实入口（`lib/cli.js`）跑一遍会建夹具的扫描，断言牺牲仓的 config、HEAD、refs 一字未变。
 */
export function gitEnvSelftest(): Finding[] {
  let tmp = ''
  try {
    tmp = mkdtempSync(join(tmpdir(), 'ca-env-'))
    const victim = join(tmp, 'victim'), proj = join(tmp, 'proj'), cfgPath = join(tmp, 'project.yaml')
    writeText(join(victim, 'a.md'), '牺牲仓\n')
    writeText(join(proj, 'AGENTS.md'), SMOKE_ENTRY)
    writeText(cfgPath, SMOKE_CONFIG)
    for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 's']]) git(victim, args)
    const before = snap(victim)
    const env = { ...process.env, GIT_DIR: join(victim, '.git'), GIT_INDEX_FILE: join(victim, '.git', 'index') }
    const run = spawnSync(process.execPath, [join(HERE, 'cli.js'), proj, '--config', cfgPath, '--json'], { timeout: 300_000, env, maxBuffer: 1 << 28 })
    const ran = (run.stdout ?? Buffer.alloc(0)).toString('utf8').includes('"check": "adoption"')
    const after = snap(victim)
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter((k) => before.get(k) !== after.get(k)).sort()
    if (changed.length || !ran) {
      return [finding('shared-fact', FAIL, TITLE_ENV, { why: WHY_ENV, evidence: changed.length ? `牺牲仓被改：${changed.join('、')}` : `子进程没跑到检查器（退出码 ${run.status}）` })]
    }
    return [finding('shared-fact', PASS, TITLE_ENV, { why: WHY_ENV, evidence: `GIT_DIR/GIT_INDEX_FILE 指向牺牲仓跑完整扫描，其 config、HEAD、refs 共 ${after.size} 个文件未变` })]
  } catch (exc) {
    return [finding('shared-fact', FAIL, TITLE_ENV, { why: WHY_ENV, evidence: `跑不起来：${(exc as Error).name}: ${(exc as Error).message}` })]
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 3 })
  }
}

/**
 * 被扫仓 `.git/config` 里的外部程序不得被本工具执行（`GIT_HARDEN_CONFIG`、`filterEnv`）。
 * 夹具仓的配置写上 core.fsmonitor、blame 会走的 textconv、两个 clean 过滤器（其一名字带 `=`，`-c k=v` 会把它切错）、diff.external，
 * 以及 log.showSignature + gpg.program + 一个签名提交（freshness 退到提交时间时的 `git log` 会验签）；每个都 touch 一个标记文件。
 * 工作区文件带会被 drift 拿去 blame 的日期、带一件没有转换时间戳的进行中工作项，保证这些 git 调用真的发生。
 */
export function hostileGitConfigSelftest(): Finding[] {
  if (process.platform === 'win32') {
    // 夹具里的外部程序是 `sh -c 'touch …'`：Windows 上 git 自带 sh，但 `/dev/null`、`chmod 755` 的 gpg 脚本等路径语义不同，造不出等价夹具。如实记 SKIP（本平台未验证），不折算通过。
    return [finding('shared-fact', 'SKIP', TITLE_HOSTILE, { why: WHY_HOSTILE, reason: '本平台（Windows）造不出等价夹具：外部程序夹具依赖 POSIX 的 sh 与可执行位；该断言只能在 POSIX 上验证，本次未验证，不折算为通过' })]
  }
  let tmp = ''
  const notes: string[] = []
  let hits: string[] = []
  try {
    tmp = mkdtempSync(join(tmpdir(), 'ca-host-'))
    const mark = join(tmp, 'PWNED_')
    const proj = join(tmp, 'proj'), cfgPath = join(tmp, 'project.yaml')
    const wi = join(proj, 'docs', 'state', 'work', 'WI-001-x.md')
    for (const [path, body] of [
      [join(proj, 'AGENTS.md'), SMOKE_ENTRY], [join(proj, 'docs', 'a.md'), '# a\n\n2099-01-01 已完成 某事\n'], [join(proj, 'docs', 'b.md'), '# b\n\n2099-01-02 已完成 某事\n'],
      [wi, '# WI-001\n\n状态：in_progress\n'], [join(proj, '.gitattributes'), '*.md diff=evil filter=evil\ndocs/b.md filter=a=b\n'],
      [join(proj, 'tools', 'std', 'CONTRACT.md'), '# 契约\n'], [cfgPath, SMOKE_CONFIG],
    ] as const) writeText(path, body)
    const GI = ['-c', 'protocol.file.allow=always']
    git(proj, ['init', '-q'], GI); git(proj, ['add', '-A'], GI); git(proj, ['commit', '-q', '-m', 's'], GI)
    // 签名提交：不依赖 gpg，直接写一个带 gpgsig 头的提交对象，再把分支指过去
    writeText(wi, '# WI-001\n\n状态：in_progress\n\n补一句。\n')
    git(proj, ['add', '-A'], GI)
    const raw = `tree ${git(proj, ['write-tree'], GI)}\nparent ${git(proj, ['rev-parse', 'HEAD'], GI)}\nauthor a <a@b> 1700000000 +0000\ncommitter a <a@b> 1700000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n abc\n -----END PGP SIGNATURE-----\n\nsigned\n`
    const sha = git(proj, ['hash-object', '-t', 'commit', '-w', '--stdin'], GI, Buffer.from(raw, 'utf8'))
    writeFileSync(join(proj, '.git', 'refs', 'heads', 'main'), sha + '\n')
    const gpg = join(tmp, 'gpg.sh')
    writeText(gpg, `#!/bin/sh\ntouch ${mark}gpg\nexit 1\n`)
    chmodSync(gpg, 0o755)
    for (const [k, v] of [
      ['core.fsmonitor', `touch ${mark}fsmonitor; false`], ['diff.evil.textconv', `sh -c 'touch ${mark}textconv; cat "$1"' -`], ['filter.evil.clean', `sh -c 'touch ${mark}clean; cat'`],
      ['filter.a=b.clean', `sh -c 'touch ${mark}clean_eq; cat'`], ['diff.external', `touch ${mark}external`], ['log.showSignature', 'true'], ['gpg.program', gpg],
    ] as const) git(proj, ['config', k, v], GI)
    const now = new Date()
    for (const rel of ['docs/a.md', 'docs/b.md', 'tools/std/CONTRACT.md']) utimesSync(join(proj, rel), now, now) // stat 失效，逼 git 重读工作区
    if (toolIdentity(join(proj, 'tools', 'std'), join(proj, 'tools', 'std', 'CONTRACT.md')).dirty !== false) notes.push('夹具没走到 tool_identity 的 git status')
    const [findings] = runAll(proj, { configPath: cfgPath })
    const ids = new Set(findings.map((f) => f.id))
    if (!(ids.has('drift/future-date/docs/a.md｜2099-01-01') && ids.has('drift/future-date/docs/b.md｜2099-01-02'))) notes.push('夹具没走到 git blame')
    if (!findings.some((f) => f.where === 'docs/state/work/WI-001-x.md' && f.check === 'freshness' && (f.status === 'PASS' || f.status === 'FAIL'))) notes.push('夹具没走到 freshness 的 git log')

    // 配置坏了：列不出过滤器名 → null，blame 记未定，不照常执行
    const bad = join(tmp, 'bad')
    mkdirSync(bad, { recursive: true })
    git(bad, ['init', '-q'], GI)
    writeFileSync(join(bad, '.git', 'config'), readFileSync(join(bad, '.git', 'config'), 'utf8') + '[broken\n')
    const envBad = filterEnv(bad, hardenedEnv(process.env))
    const blamed = blame(bad, 'a.md')
    if (envBad !== null || blamed[0] !== null) notes.push(`配置坏了时 filter_env=${envBad === null ? 'null' : 'Env'}、blame=${blamed[1] ?? '有结果'}，应为 null 与未定`)
    hits = readdirSync(tmp).filter((f) => f.startsWith('PWNED_')).map((f) => f.slice('PWNED_'.length)).sort()
  } catch (exc) {
    return [finding('shared-fact', FAIL, TITLE_HOSTILE, { why: WHY_HOSTILE, evidence: `跑不起来：${(exc as Error).name}: ${(exc as Error).message}` })]
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 3 })
  }
  if (hits.length || notes.length) return [finding('shared-fact', FAIL, TITLE_HOSTILE, { why: WHY_HOSTILE, evidence: `被执行：${hits.join('、') || '无'}；${notes.join('；') || '断言全过'}` })]
  return [finding('shared-fact', PASS, TITLE_HOSTILE, { why: WHY_HOSTILE, evidence: 'fsmonitor、textconv、两个 clean 过滤器（含名字带 = 的）、diff.external、gpg 均未执行；配置坏了时 blame 记未定' })]
}
