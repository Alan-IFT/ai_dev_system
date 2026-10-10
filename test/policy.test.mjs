// 判定核心单测。无依赖：node:test + node:assert。运行：node --test test/
// 契约 §3 的要求同样适用：每类判定要有「应拦」反例与「应放行」正例；用例表为空时必须失败，不得静默通过。

import test from 'node:test'
import assert from 'node:assert/strict'
import { decide, commitMessageProblem } from '../lib/guard/policy.js'
import { apply, name } from '../lib/guard/index.js'

const ROOT = process.platform === 'win32' ? 'D:\\proj' : '/proj'
const sh = (command) => ({ name: process.platform === 'win32' ? 'pwsh' : 'bash', arguments: { command } })

const cases = [
  // [标题, exec, 期望 kind]
  // —— protect 里列了 .std 当靶子：写工具 ask（守卫已无 deny，设计 §12.38）——
  ['write .std/ 内文件 => ask', { name: 'write', arguments: { file_path: '.std/标准/README.md' } }, 'ask'],
  ['edit .std/ 内文件 => ask', { name: 'edit', arguments: { file_path: '.std/x.md' } }, 'ask'],
  ['write 绝对路径落在 .std 下 => ask', { name: 'write', arguments: { file_path: `${ROOT}${process.platform === 'win32' ? '\\' : '/'}.std${process.platform === 'win32' ? '\\' : '/'}a.md` } }, 'ask'],
  ['write 路径含 .. 绕回 .std => ask', { name: 'write', arguments: { file_path: 'docs/../.std/a.md' } }, 'ask'],
  ['write 普通文件 => allow', { name: 'write', arguments: { file_path: 'docs/a.md' } }, 'allow'],
  ['write 名字像 .std 的别的目录 => allow', { name: 'write', arguments: { file_path: '.stdx/a.md' } }, 'allow'],
  // —— 受保护文件：ask ——
  ['改 CONTEXT_MANIFEST.md => ask', { name: 'edit', arguments: { file_path: 'CONTEXT_MANIFEST.md' } }, 'ask'],
  ['改 AGENTS.md => ask', { name: 'write', arguments: { file_path: 'AGENTS.md' } }, 'ask'],
  ['改 .githooks/pre-commit => ask', { name: 'edit', arguments: { file_path: '.githooks/pre-commit' } }, 'ask'],
  ['旧插件目录不再是受保护路径（守卫不再硬编码它）：改 tools/dsh-std/lib/policy.js => allow', { name: 'edit', arguments: { file_path: 'tools/dsh-std/lib/policy.js' } }, 'allow'],
  // —— 命令：写 protect 项 .std ——
  ['重定向写 .std => ask', sh('echo x > .std/a.md'), 'ask'],
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
    const got = decide(exec, { root: ROOT, protect: ['.std'] })
    assert.equal(got.kind, want, `实得 ${JSON.stringify(got)}`)
    if (want !== 'allow') assert.ok(got.reason && got.reason.length > 0, 'ask/deny 必须带理由')
  })
}

// —— protect：插件配置里列出的「额外受保护路径」（设计 §12.4）。默认空：采用项目自己的 src/、lib/、package.json 不被误伤 ——
const protectCases = [
  // [标题, exec, protect 列表, 期望 kind]
  ['未配置 protect：写 src/app/main.py => allow（采用项目自己的源码不误伤）', { name: 'write', arguments: { file_path: 'src/app/main.py' } }, undefined, 'allow'],
  ['protect=[] 同上 => allow', { name: 'write', arguments: { file_path: 'src/app/main.py' } }, [], 'allow'],
  ['protect 里列了 src/guard：写其下文件 => ask', { name: 'edit', arguments: { file_path: 'src/guard/policy.ts' } }, ['src/guard'], 'ask'],
  ['protect 里列了 src/guard：写 src/guard 本身 => ask', { name: 'write', arguments: { file_path: 'src/guard' } }, ['src/guard'], 'ask'],
  ['protect 里列了 src/guard：写 src/other => allow（只保护列出的）', { name: 'write', arguments: { file_path: 'src/other/a.ts' } }, ['src/guard'], 'allow'],
  ['protect 里列了 lib：写 lib/guard/policy.js => ask', { name: 'edit', arguments: { file_path: 'lib/guard/policy.js' } }, ['lib'], 'ask'],
  ['protect 里列了单文件 package.json：写它 => ask', { name: 'edit', arguments: { file_path: 'package.json' } }, ['package.json'], 'ask'],
  ['protect 里列了单文件 package.json：写 package.json.bak => allow（整段匹配，不是前缀字符串）', { name: 'write', arguments: { file_path: 'package.json.bak' } }, ['package.json'], 'allow'],
  ['protect 里列了 src/guard：名字像它的别处 docs/src/guard/a.md => allow', { name: 'write', arguments: { file_path: 'docs/src/guard/a.md' } }, ['src/guard'], 'allow'],
  ['protect 写成带尾斜杠与反斜杠也认：src\\guard\\', { name: 'edit', arguments: { file_path: 'src/guard/x.ts' } }, ['src\\guard\\'], 'ask'],
  ['protect 里有非字符串/空串被忽略，不崩也不放宽：[1,null,"",{}] 加合法项 lib', { name: 'edit', arguments: { file_path: 'lib/a.js' } }, [1, null, '', {}, 'lib'], 'ask'],
  ['protect 不是数组（字符串）被忽略，不崩：写 src/guard => allow', { name: 'edit', arguments: { file_path: 'src/guard/a.ts' } }, 'src/guard', 'allow'],
  ['protect 里写 .. 越出项目的路径被忽略：写项目内普通文件 => allow', { name: 'write', arguments: { file_path: 'docs/a.md' } }, ['..', '../x'], 'allow'],
  ['protect 里写绝对路径被忽略（只认相对项目根）：写 docs/a.md => allow', { name: 'write', arguments: { file_path: 'docs/a.md' } }, ['/', 'D:\\'], 'allow'],
  // 下面这几条是「变异验证发现原用例不触发差异」后补的：放过这些项不会让判定变宽，但会让**项目内同名的普通路径被误保护**。
  // 非数组 protect 必须整体忽略。字符串 'x' 若被逐字符展开成 ['x'] 就会命中项目内名叫 x 的文件——用单字符串做输入才能区分「忽略」与「展开」。
  ['protect 是单字符串 x（非数组）被整体忽略：写项目内 x => allow', { name: 'write', arguments: { file_path: 'x' } }, 'x', 'allow'],
  ['protect 是对象（非数组）被整体忽略：写 src/guard/a.ts => allow', { name: 'edit', arguments: { file_path: 'src/guard/a.ts' } }, { 'src/guard': true }, 'allow'],
  ['protect 是数字被整体忽略 => allow', { name: 'write', arguments: { file_path: 'docs/a.md' } }, 7, 'allow'],
  ['protect 是 null 被整体忽略 => allow', { name: 'write', arguments: { file_path: 'docs/a.md' } }, null, 'allow'],
  ['protect 里写 ./x 被丢弃（不当成 x）：写项目内 x => allow', { name: 'write', arguments: { file_path: 'x' } }, ['./x'], 'allow'],
  ['protect 里写 a/../b 被丢弃（不当成 b）：写项目内 b => allow', { name: 'write', arguments: { file_path: 'b' } }, ['a/../b'], 'allow'],
  ['protect 里写 . 被丢弃（不当成整个项目根）：写 docs/a.md => allow', { name: 'write', arguments: { file_path: 'docs/a.md' } }, ['.'], 'allow'],
  ['protect 里写 /etc 被丢弃（不当成项目内的 etc）：写 etc/hosts => allow', { name: 'write', arguments: { file_path: 'etc/hosts' } }, ['/etc'], 'allow'],
  ['protect 里写 D:\\x 被丢弃（不当成项目内的 d:/x 或 x）：写 x => allow', { name: 'write', arguments: { file_path: 'x' } }, ['D:\\x'], 'allow'],
  ['protect 里写 C:/x 被丢弃：写项目内 c:/x 同名路径 => allow', { name: 'write', arguments: { file_path: 'c:/x' } }, ['C:/x'], 'allow'],
  ['protect 里写 UNC \\\\srv\\share 被丢弃（不当成项目内的 srv/share）：写 srv/share/a => allow', { name: 'write', arguments: { file_path: 'srv/share/a' } }, ['\\\\srv\\share'], 'allow'],
  ['protect 里写 src//guard（空段）被丢弃：写 src/guard/a.ts => allow', { name: 'edit', arguments: { file_path: 'src/guard/a.ts' } }, ['src//guard'], 'allow'],
  ['protect 大小写不敏感（Windows 语义一致）：Src/Guard 命中 src/guard/a.ts => ask', { name: 'edit', arguments: { file_path: 'src/guard/a.ts' } }, ['Src/Guard'], process.platform === 'win32' ? 'ask' : 'allow'],
  ['pwsh 写 protect 内文件 => ask', sh('Set-Content src/guard/policy.ts x'), ['src/guard'], 'ask'],
  ['pwsh 重定向写 protect 内单文件 => ask', sh('echo x > cordis.patch.yml'), ['cordis.patch.yml'], 'ask'],
  ['pwsh 删 protect 内目录 => ask', sh('Remove-Item -Recurse lib'), ['lib'], 'ask'],
  ['pwsh 只读 protect 内文件 => allow', sh('Get-Content src/guard/policy.ts'), ['src/guard'], 'allow'],
  ['pwsh cd 进 protect 目录后写 => ask', sh('cd src/guard; Set-Content a.ts x'), ['src/guard'], 'ask'],
  ['命令替换里写 protect 内文件 => ask', sh('echo $(Set-Content src/guard/a.ts x)'), ['src/guard'], 'ask'],
  ['内嵌 bash -c 里写 protect 内文件 => ask', { name: 'bash', arguments: { command: "bash -c 'echo x > src/guard/a.ts'" } }, ['src/guard'], 'ask'],
]
test('protect 用例表非空（空用例表不得算通过）', () => { assert.ok(protectCases.length >= 20) })
for (const [title, exec, protect, want] of protectCases) {
  test('protect：' + title, () => {
    const v = decide(exec, { root: ROOT, protect })
    assert.equal(v.kind, want, `${title}：实得 ${v.kind}${'reason' in v ? '（' + v.reason + '）' : ''}`)
  })
}
test('protect 会让三种判定之外多出的 ask 都带 reason（给人看的理由不能为空）', () => {
  const v = decide({ name: 'edit', arguments: { file_path: 'src/guard/a.ts' } }, { root: ROOT, protect: ['src/guard'] })
  assert.equal(v.kind, 'ask'); assert.ok(typeof v.reason === 'string' && v.reason.length > 0)
})

test('分布：allow 与 ask 都至少出现一次（防判定器退化成恒 allow 或恒 ask）', () => {
  const kinds = new Set(cases.map(([, e]) => decide(e, { root: ROOT, protect: ['.std'] }).kind))
  assert.deepEqual([...kinds].sort(), ['allow', 'ask'])   // 本守卫不再产出 deny（设计 §12.38）
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

test('适配层：注册了 tools/pre-execute，且插件名是 dsh-project-std（等于 package.json 的包名，DSH 按它解析；重构设计 §4）', () => {
  const ctx = fakeCtx()
  apply(ctx, {})
  assert.equal(name, 'dsh-project-std')
  assert.deepEqual(ctx.handlers.map(([e]) => e), ['tools/pre-execute'])
})

test('适配层：enabled=false 不注册任何监听', () => {
  const ctx = fakeCtx()
  apply(ctx, { enabled: false })
  assert.equal(ctx.handlers.length, 0)
})

test('适配层：写受保护的 AGENTS.md 被 ask；普通写走下游（allow）', async () => {
  const ctx = fakeCtx()
  apply(ctx, { root: ROOT })
  const [, fn] = ctx.handlers[0]
  const allow = async () => ({ kind: 'allow' })
  const d = await fn({ name: 'write', arguments: { file_path: 'AGENTS.md' } }, allow)
  assert.equal(d.kind, 'ask')
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

// —— 补：变异验证（test/mutations/guard.json）发现原用例不触发差异的三处 ——
test('protect 非数组被整体忽略，且不会把空串当成“整个项目都受保护”：写项目内各种普通路径都 allow', () => {
  for (const protect of ['x', 7, null, { a: 1 }, undefined]) {
    for (const f of ['x', 'docs/a.md', '.', 'a/b']) {
      assert.equal(decide({ name: 'write', arguments: { file_path: f } }, { root: ROOT, protect }).kind, 'allow', JSON.stringify([f, protect]))
    }
  }
})

test('decide 自己吃抛错的 name／arguments（getter、Proxy）：一律 ask，不抛、不放行', () => {
  const bad = [
    { get name() { throw new Error('boom') }, arguments: {} },
    { name: 'write', get arguments() { throw new Error('boom') } },
    new Proxy({}, { get() { throw new Error('proxy boom') } }),
  ]
  for (const e of bad) { const v = decide(e, { root: ROOT }); assert.equal(v.kind, 'ask'); assert.match(v.reason, /未定/) }
})

test('从标准输入读命令的解释器、编码后的命令：守卫看不见内容 => ask；给了命令串或脚本文件、只问版本 => allow（它们在别处判或是盲区）', () => {
  for (const c of ['bash', 'sh', 'pwsh', 'cmd', 'zsh -i', 'bash -', 'pwsh -EncodedCommand AAA', 'powershell -enc AAA']) assert.equal(decide(sh(c), { root: ROOT }).kind, 'ask', c)
  for (const c of ['bash script.sh', 'bash --version']) assert.equal(decide(sh(c), { root: ROOT }).kind, 'allow', c)
})
