// scripts/check-release-tag.mjs：标签必须等于 v + package.json 的 version。纯函数部分逐条测，再在临时 git 仓里测整条检查的各个否决条件。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classify, tagProblems, SEMVER } from '../scripts/check-release-tag.mjs'

const here = dirname(fileURLToPath(import.meta.url)); const SCRIPT = join(here, '..', 'scripts', 'check-release-tag.mjs')
const tmps = []; test.after(() => { for (const t of tmps) rmSync(t, { recursive: true, force: true, maxRetries: 3 }) })

test('SEMVER：官方正则放行合法写法、拒绝常见的错写', () => {
  for (const ok of ['0.1.0', '1.0.0', '10.20.30', '1.0.0-rc.1', '1.0.0-alpha.beta', '1.0.0+build.5', '1.0.0-rc.1+b']) assert.ok(SEMVER.test(ok), ok)
  for (const bad of ['1', '1.0', '01.0.0', '1.0.0.0', 'v1.0.0', '1.0.0-', '1.0.0-01', '1.0.0+', '', '2026-10-10', '1.0.x']) assert.ok(!SEMVER.test(bad), bad)
})

test('classify：semver 标签、旧日期式（含 -pre.N 与 .N）、其它', () => {
  for (const t of ['v0.1.0', 'v1.2.3-rc.1', 'v10.0.0+b']) assert.equal(classify(t), 'semver', t)
  for (const t of ['2026-10-05', '2026-10-05.1', '2026-09-30.5', '2026-10-10-pre.4']) assert.equal(classify(t), 'legacy-date', t)
  for (const t of ['archive-pre-ts-refactor', 'release', '0.1.0', 'v1', 'v1.0', 'V0.1.0', '2026-10']) assert.equal(classify(t), 'other', t)
})

test('tagProblems：v + version 一致才放行；每种不一致各给一条明确的理由', () => {
  assert.deepEqual(tagProblems('v0.1.0', '0.1.0'), [])
  assert.deepEqual(tagProblems('v1.2.3-rc.1', '1.2.3-rc.1'), [])
  assert.match(tagProblems('0.1.0', '0.1.0').join('|'), /以 v 开头/)
  assert.match(tagProblems('v0.1.1', '0.1.0').join('|'), /不一致/)
  assert.match(tagProblems('v0.1.0', '0.1.1').join('|'), /不一致/)
  assert.match(tagProblems('v1', '1').join('|'), /不是合法 semver/)
  assert.match(tagProblems('2026-10-10', '0.1.0').join('|'), /以 v 开头/)
  assert.match(tagProblems('v0.1.0', undefined).join('|'), /version 不是合法 semver/)
  assert.match(tagProblems('v0.1.0', 'abc').join('|'), /version 不是合法 semver/)
  assert.ok(tagProblems('v0.1.0', '0.1.0-rc.1').length > 0, 'v0.1.0 不等于 v0.1.0-rc.1')
})

/** 临时仓：origin 是一个裸仓；工作仓里放 package.json 与脚本；返回 {run, git}。 */
function repo({ version = '0.1.0', branch = 'main', pushed = true, dirty = false, existingTag = null, existingRemoteTag = null } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'reltag-')); tmps.push(base); const bare = join(base, 'origin.git'), work = join(base, 'work')
  const g = (cwd, ...a) => { const r = spawnSync('git', ['-C', cwd, '-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }); return r }
  mkdirSync(bare); g(bare, 'init', '-q', '--bare', '-b', 'main'); mkdirSync(work); g(work, 'init', '-q', '-b', 'main')
  mkdirSync(join(work, 'scripts')); cpSync(SCRIPT, join(work, 'scripts', 'check-release-tag.mjs')); writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'x', version }))
  g(work, 'add', '-A'); g(work, 'commit', '-q', '-m', 'init'); g(work, 'remote', 'add', 'origin', bare)
  if (pushed) g(work, 'push', '-q', 'origin', 'main'); else g(work, 'fetch', 'origin')
  if (branch !== 'main') g(work, 'checkout', '-q', '-b', branch)
  if (existingTag) g(work, 'tag', existingTag)
  if (existingRemoteTag) { g(work, 'tag', existingRemoteTag); g(work, 'push', '-q', 'origin', existingRemoteTag); g(work, 'tag', '-d', existingRemoteTag) }
  if (dirty) writeFileSync(join(work, 'dirty.txt'), 'x')
  if (!pushed) { writeFileSync(join(work, 'more.txt'), 'x'); g(work, 'add', '-A'); g(work, 'commit', '-q', '-m', 'more'); g(work, 'rev-parse', 'HEAD') }
  return { run: (...a) => { const r = spawnSync(process.execPath, [join(work, 'scripts', 'check-release-tag.mjs'), ...a], { encoding: 'utf8' }); return { rc: r.status, out: (r.stdout + r.stderr).replaceAll('\r\n', '\n') } }, git: (...a) => g(work, ...a), work }
}

test('整条检查：满足全部条件 → 退出 0，并报出指向的提交（必须是真实 HEAD 的前 7 位，不是任意十六进制）', () => {
  const x = repo(); const r = x.run('v0.1.0'); assert.equal(r.rc, 0, r.out)
  const head = x.git('rev-parse', 'HEAD').stdout.trim(); assert.match(head, /^[0-9a-f]{40}$/)
  assert.ok(r.out.includes(`通过——v0.1.0 = v0.1.0，指向 ${head.slice(0, 7)}（main，已推送，工作区干净）`), r.out)
})

test('整条检查：每个否决条件各自单独能拦下（各退出 1，并点名那一项）', () => {
  const cases = [
    ['标签与 version 不一致', () => repo().run('v0.2.0'), /不一致/],
    ['标签没有 v 前缀', () => repo().run('0.1.0'), /以 v 开头/],
    ['本地已有同名标签', () => repo({ existingTag: 'v0.1.0' }).run('v0.1.0'), /已存在（本地）/],
    ['远端已有同名标签', () => repo({ existingRemoteTag: 'v0.1.0' }).run('v0.1.0'), /已存在（远端）/],
    ['工作区不干净', () => repo({ dirty: true }).run('v0.1.0'), /工作区不干净/],
    ['不在 main 分支', () => repo({ branch: 'feature' }).run('v0.1.0'), /不是 main/],
    ['HEAD 还没推送', () => repo({ pushed: false }).run('v0.1.0'), /先推送再打标签/],
    ['package.json 的 version 不合法', () => repo({ version: 'abc' }).run('vabc'), /version 不是合法 semver/],
  ]
  for (const [name, f, re] of cases) { const r = f(); assert.equal(r.rc, 1, name + '：' + r.out); assert.match(r.out, re, name) }
})

test('整条检查：查不了远端不当作“标签不存在”（没跑成 ≠ 通过）', () => {
  const x = repo(); x.git('remote', 'set-url', 'origin', join(tmpdir(), 'no-such-remote-' + Date.now())); const r = x.run('v0.1.0')
  assert.equal(r.rc, 1, r.out); assert.match(r.out, /查不了远端标签/)
})

test('--list：把现有标签分成 semver／legacy-date／other 三类，计数与内容对得上', () => {
  const x = repo(); for (const t of ['2026-10-05', '2026-10-10-pre.1', 'v0.0.9', 'archive-x']) x.git('tag', t)
  const r = x.run('--list'); assert.equal(r.rc, 0, r.out)
  assert.match(r.out, /semver\s+1：v0\.0\.9/); assert.match(r.out, /legacy-date\s+2：.*2026-10-05.*2026-10-10-pre\.1|legacy-date\s+2：.*2026-10-10-pre\.1.*2026-10-05/); assert.match(r.out, /other\s+1：archive-x/)
})

test('不带参数 → 退出 2 并给出用法；不在 git 工作区 → 退出 2（没跑成不当通过）', () => {
  assert.equal(repo().run().rc, 2)
  const d = mkdtempSync(join(tmpdir(), 'reltag-nogit-')); tmps.push(d); mkdirSync(join(d, 'scripts')); cpSync(SCRIPT, join(d, 'scripts', 'check-release-tag.mjs')); writeFileSync(join(d, 'package.json'), '{"version":"0.1.0"}')
  const r = spawnSync(process.execPath, [join(d, 'scripts', 'check-release-tag.mjs'), 'v0.1.0'], { encoding: 'utf8', env: { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir() } }); assert.equal(r.status, 2, r.stdout + r.stderr)
})
