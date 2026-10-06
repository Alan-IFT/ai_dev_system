// 判定核心单测。无依赖：node:test + node:assert。运行：node --test test/
// 契约 §3 的要求同样适用：每类判定要有「应拦」反例与「应放行」正例；用例表为空时必须失败，不得静默通过。

import test from 'node:test'
import assert from 'node:assert/strict'
import { decide, commitMessageProblem } from '../lib/policy.js'
import { apply, name } from '../lib/index.js'

const ROOT = process.platform === 'win32' ? 'D:\\proj' : '/proj'
const sh = (command) => ({ name: process.platform === 'win32' ? 'pwsh' : 'bash', arguments: { command } })

const cases = [
  // [标题, exec, 期望 kind]
  // —— 内嵌目录只读：写工具 deny ——
  ['write .std/ 内文件 => deny', { name: 'write', arguments: { file_path: '.std/标准/README.md' } }, 'deny'],
  ['edit .std/ 内文件 => deny', { name: 'edit', arguments: { file_path: '.std/x.md' } }, 'deny'],
  ['write 绝对路径落在 .std 下 => deny', { name: 'write', arguments: { file_path: `${ROOT}${process.platform === 'win32' ? '\\' : '/'}.std${process.platform === 'win32' ? '\\' : '/'}a.md` } }, 'deny'],
  ['write 路径含 .. 绕回 .std => deny', { name: 'write', arguments: { file_path: 'docs/../.std/a.md' } }, 'deny'],
  ['write 普通文件 => allow', { name: 'write', arguments: { file_path: 'docs/a.md' } }, 'allow'],
  ['write 名字像 .std 的别的目录 => allow', { name: 'write', arguments: { file_path: '.stdx/a.md' } }, 'allow'],
  // —— 受保护文件：ask ——
  ['改 CONTEXT_MANIFEST.md => ask', { name: 'edit', arguments: { file_path: 'CONTEXT_MANIFEST.md' } }, 'ask'],
  ['改 AGENTS.md => ask', { name: 'write', arguments: { file_path: 'AGENTS.md' } }, 'ask'],
  ['改 .githooks/pre-commit => ask', { name: 'edit', arguments: { file_path: '.githooks/pre-commit' } }, 'ask'],
  ['改守卫插件自身 => ask', { name: 'edit', arguments: { file_path: 'tools/dsh-std/lib/policy.js' } }, 'ask'],
  // —— 命令：写 .std deny ——
  ['重定向写 .std => deny', sh('echo x > .std/a.md'), 'deny'],
  ['Set-Content 写 .std => ask（带 .std 的写类命令，写目标不猜，交给人）', sh("Set-Content .std/a.md 'x'"), 'ask'],
  ['Remove-Item .std => ask（带 .std 的写类命令，写目标不猜，交给人）', sh('Remove-Item -Recurse .std'), 'ask'],
  ['只读 .std（Get-Content）=> allow', sh('Get-Content .std/标准/README.md'), 'allow'],
  ['ls .std => allow', sh('ls .std'), 'allow'],
  // —— 命令：受控动作 ask ——
  ['git reset --hard => ask', sh('git reset --hard HEAD~1'), 'ask'],
  ['git push --force => ask', sh('git push origin main --force'), 'ask'],
  ['git push -f => ask', sh('git push -f origin main'), 'ask'],
  ['git push --tags => ask', sh('git push --tags'), 'ask'],
  ['git push 公开仓 => ask', sh('git push ai-dev-std release:main'), 'ask'],
  ['git tag => ask', sh('git tag 2026-10-04'), 'ask'],
  ['git branch -D => ask', sh('git branch -D old'), 'ask'],
  ['git rm => ask', sh('git rm a.md'), 'ask'],
  ['git clean => ask', sh('git clean -fd'), 'ask'],
  ['--no-verify => ask', sh('git commit --no-verify -m x'), 'ask'],
  ['git commit -n => ask', sh('git commit -n -m x'), 'ask'],
  ['改 hooksPath => ask', sh('git config core.hooksPath /dev/null'), 'ask'],
  ['删 PROJECT_STATUS => ask', sh('Remove-Item PROJECT_STATUS.md'), 'ask'],
  // —— 命令：普通动作 allow ——
  ['git status => allow', sh('git status -sb'), 'allow'],
  ['git log => allow', sh('git log --oneline -5'), 'allow'],
  ['普通 commit => allow', sh('git commit -m "feat: x"'), 'allow'],
  ['git push 普通 => allow', sh('git push origin main'), 'allow'],
  ['跑检查器 => allow', sh('python tools/std/check_all.py . --no-scope'), 'allow'],
  // —— 未定：参数缺失/类型不对不得放行 ——
  ['write 缺 file_path => ask', { name: 'write', arguments: {} }, 'ask'],
  ['shell 缺 command => ask', { name: 'pwsh', arguments: {} }, 'ask'],
  ['shell command 非字符串 => ask', { name: 'pwsh', arguments: { command: 42 } }, 'ask'],
  // —— 无关工具 ——
  ['read 工具 => allow', { name: 'read', arguments: { file_path: '.std/x.md' } }, 'allow'],
  ['未知工具 => allow', { name: 'web_search', arguments: { queries: ['x'] } }, 'allow'],
]

test('用例表非空（空用例表不得算通过）', () => {
  assert.ok(cases.length >= 20, `用例只有 ${cases.length} 条`)
  // ask 判定改为按词实现后，不再有可数的正则清单；改用行为断言：下面这些受控命令必须至少 12 条被 ask
  const probes = ['git reset --hard', 'git push -f', 'git push --tags', 'git tag x', 'git branch -D x', 'git rm a', 'git clean -fd', 'git commit --no-verify -m x', 'git config core.hooksPath x', 'git push origin +main', 'git update-ref -d refs/heads/x', 'git filter-branch']
  const asked = probes.filter((c) => decide({ name: 'pwsh', arguments: { command: c } }, { root: ROOT }).kind === 'ask')
  assert.ok(asked.length >= 12, `ask 判定退化：只有 ${asked.length}/${probes.length} 条被问`)
})

for (const [title, exec, want] of cases) {
  test(title, () => {
    const got = decide(exec, { root: ROOT })
    assert.equal(got.kind, want, `实得 ${JSON.stringify(got)}`)
    if (want !== 'allow') assert.ok(got.reason && got.reason.length > 0, 'ask/deny 必须带理由')
  })
}

test('分布：三种判定都至少出现一次（防判定器退化成恒 allow）', () => {
  const kinds = new Set(cases.map(([, e]) => decide(e, { root: ROOT }).kind))
  assert.deepEqual([...kinds].sort(), ['allow', 'ask', 'deny'])
})

test('commitMessageProblem：合格与不合格', () => {
  for (const ok of ['feat: x', 'fix(tools/std): y', 'chore(release)!: z', "Merge branch 'a' into b", 'Revert "feat: x"', 'fixup! feat: x']) {
    assert.equal(commitMessageProblem(ok), null, ok)
  }
  for (const bad of ['', '   ', 'update stuff', 'Feat: x', 'feat:x', '修改了东西']) {
    assert.notEqual(commitMessageProblem(bad), null, JSON.stringify(bad))
  }
})

// —— 适配层：用假 ctx 验证 tools/pre-execute 的接线 ——
function fakeCtx() {
  const handlers = []
  return {
    handlers,
    on: (ev, fn) => { handlers.push([ev, fn]) },
    logger: () => ({ info() {}, warn() {} }),
  }
}

test('适配层：注册了 tools/pre-execute，且插件名是 dsh-std', () => {
  const ctx = fakeCtx()
  apply(ctx, {})
  assert.equal(name, 'dsh-std')
  assert.deepEqual(ctx.handlers.map(([e]) => e), ['tools/pre-execute'])
})

test('适配层：enabled=false 不注册任何监听', () => {
  const ctx = fakeCtx()
  apply(ctx, { enabled: false })
  assert.equal(ctx.handlers.length, 0)
})

test('适配层：写 .std 被 deny；普通写走下游（allow）', async () => {
  const ctx = fakeCtx()
  apply(ctx, { root: ROOT })
  const [, fn] = ctx.handlers[0]
  const allow = async () => ({ kind: 'allow' })
  const d = await fn({ name: 'write', arguments: { file_path: '.std/a.md' } }, allow)
  assert.equal(d.kind, 'deny')
  const ok = await fn({ name: 'write', arguments: { file_path: 'docs/a.md' } }, allow)
  assert.equal(ok.kind, 'allow')
})

test('适配层：下游已 deny 的不被覆盖成 ask', async () => {
  const ctx = fakeCtx()
  apply(ctx, { root: ROOT })
  const [, fn] = ctx.handlers[0]
  const downDeny = async () => ({ kind: 'deny', reason: '别的守卫拒绝' })
  const d = await fn(sh('git reset --hard'), downDeny)
  assert.deepEqual(d, { kind: 'deny', reason: '别的守卫拒绝' })
})

test('适配层：判定器抛异常时按未定处理（ask），不放行', async () => {
  const ctx = fakeCtx()
  apply(ctx, { root: ROOT })
  const [, fn] = ctx.handlers[0]
  // exec.arguments 取值抛异常，模拟判定器内部崩溃
  const exec = { name: 'write', get arguments() { throw new Error('boom') } }
  const d = await fn(exec, async () => ({ kind: 'allow' }))
  assert.equal(d.kind, 'ask')
  assert.match(d.reason, /未定/)
})
