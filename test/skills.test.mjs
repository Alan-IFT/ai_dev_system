// 标准技能提供者（src/skills.ts）的测试。
// 合同来自 deepseek-ai/deepseek-harness `packages/skill/skill/src/index.ts` 的 `validateCandidate` / `validateDefinition` / `registerProvider`——
// 下面的 `Registry` 是对它们的**忠实最小复刻**（本仓不依赖 @deepseek-ai/dsh-skill，也不该为测试加运行时依赖）；每条校验规则都标了官方源码里对应的错误文案。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PROVIDER_NAME, loadMeta, makeProvider, registerStandardSkills, skillFiles } from '../lib/skills.js'
import { apply } from '../lib/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/   // 官方 SKILL_NAME

/** 官方 validateCandidate + normalizeProviderObservation 的复刻。 */
function validateCandidate(c, providerName) {
  assert.equal(typeof c.name, 'string', `skill provider "${providerName}" returned a non-string skill name`)
  assert.ok(SKILL_NAME.test(c.name), `invalid skill name "${c.name}"`)
  assert.equal(typeof c.description, 'string'); assert.ok(c.description.length > 0, `skill "${c.name}" without a description`)
  assert.equal(typeof c.invocation?.modelInvocable, 'boolean'); assert.equal(typeof c.invocation?.userInvocable, 'boolean')
  if (c.whenToUse !== undefined) assert.equal(typeof c.whenToUse, 'string')
  assert.equal(typeof c.source, 'string')
  assert.ok(typeof c.rank === 'number' && Number.isFinite(c.rank), `skill "${c.name}" with an invalid rank`)
  assert.equal(typeof c.provider, 'string')
  assert.equal(c.provider, providerName, `skill provider "${providerName}" returned skill "${c.name}" for provider "${c.provider}"`)
}
/** 官方 validateDefinition 的复刻（get() 返回值）。 */
function validateDefinition(d) {
  assert.ok(SKILL_NAME.test(d.name)); assert.ok(d.description.length > 0)
  assert.equal(typeof d.content, 'string'); assert.equal(typeof d.source, 'string'); assert.equal(typeof d.provider, 'string')
  assert.equal(typeof d.invocation?.modelInvocable, 'boolean')
}

/** registerProvider 的最小复刻：同步 create、保留名 `runtime` 拒绝、同名重复拒绝、返回 disposer。 */
class Registry {
  providers = new Map()
  registerProvider(create) {
    const provider = create({ signal: new AbortController().signal, invalidate() {} })
    if (provider.name === 'runtime') throw new Error('"runtime" is reserved for runtime skill registrations')
    if (this.providers.has(provider.name)) throw new Error(`a skill provider named "${provider.name}" is already registered`)
    this.providers.set(provider.name, provider)
    return () => this.providers.delete(provider.name)
  }
}

test('元信息：名字合文法、描述非空、与 skills/ 下的文件一一对应（不多不少）', () => {
  const meta = loadMeta()
  assert.equal(meta.length, 5)
  for (const m of meta) { assert.ok(SKILL_NAME.test(m.name), m.name); assert.ok(m.description.length > 0); assert.ok(m.description.length <= 500, `${m.name} 描述超过目录的 500 字上限，会被截断`); assert.ok(m.whenToUse.length > 0) }
  assert.deepEqual(skillFiles(), meta.map((m) => `${m.name}.md`).sort())
  assert.equal(new Set(meta.map((m) => m.name)).size, meta.length, '名字不重复')
})

test('list()：每条候选通过官方 validateCandidate；provider 字段等于提供者名；source 是 bundled、rank 600；模型与用户都可调用', async () => {
  const p = makeProvider()
  const cands = await p.list()
  assert.equal(cands.length, 5)
  for (const c of cands) { validateCandidate(c, p.name); assert.equal(c.source, 'bundled'); assert.equal(c.rank, 600); assert.deepEqual(c.invocation, { modelInvocable: true, userInvocable: true }); assert.equal(c.resourceBase.kind, 'directory') }
  assert.equal(p.name, PROVIDER_NAME)
})

test('get()：返回的定义通过官方 validateDefinition，且 name 等于候选名（注册表据此判「陈旧选择」）；正文就是 skills/<名>.md', async () => {
  const p = makeProvider()
  for (const c of await p.list()) {
    const d = await p.get(c, {})
    validateDefinition(d)
    assert.equal(d.name, c.name, '定义名必须等于候选名，否则注册表会 invalidateEntry 并返回 undefined')
    assert.equal(d.content, readFileSync(join(root, 'skills', `${c.name}.md`), 'utf8'))
    assert.ok(d.content.includes('节目录') || d.content.includes('模板目录'), `${c.name} 开头应有目录，模型靠它定位`)
  }
  assert.equal(await p.get({ name: 'std-不存在', locator: null }, {}), undefined, '未知候选返回 undefined（官方：provider.get 可返回 undefined）')
})

test('注册：registerProvider 同步成功、返回 disposer；注销后可再注册；提供者名不是保留名 runtime', () => {
  const reg = new Registry()
  const ctx = { skills: reg }
  const dispose = registerStandardSkills(ctx)
  assert.equal(typeof dispose, 'function'); assert.ok(reg.providers.has(PROVIDER_NAME))
  assert.notEqual(PROVIDER_NAME, 'runtime')
  assert.throws(() => registerStandardSkills(ctx), /already registered/, '同层重复注册会抛（官方行为）')
  dispose(); assert.ok(!reg.providers.has(PROVIDER_NAME))
  assert.equal(typeof registerStandardSkills(ctx), 'function')
})

test('没有 skills 服务（没装 dsh-skill）→ 静默跳过，不抛；skills 不是对象 / registerProvider 不是函数同样', () => {
  assert.equal(registerStandardSkills({}), undefined)
  assert.equal(registerStandardSkills({ skills: null }), undefined)
  assert.equal(registerStandardSkills({ skills: {} }), undefined)
  assert.equal(registerStandardSkills({ skills: { registerProvider: 'x' } }), undefined)
})

test('apply：守卫照常挂上；技能服务在则注册；enabled:false 两者都不做；技能注册抛错不带走守卫', () => {
  const events = [], reg = new Registry(), logs = []
  const mk = (extra = {}) => ({ on: (n) => events.push(n), skills: reg, logger: () => ({ info: (m) => logs.push(['info', m]), warn: (m) => logs.push(['warn', m]) }), ...extra })
  apply(mk(), { enabled: true })
  assert.deepEqual(events, ['tools/pre-execute']); assert.ok(reg.providers.has(PROVIDER_NAME)); assert.ok(logs.some(([k, m]) => k === 'info' && m.includes('registered standard skills')))
  // enabled:false
  const reg2 = new Registry(); events.length = 0
  apply({ on: (n) => events.push(n), skills: reg2 }, { enabled: false })
  assert.deepEqual(events, []); assert.equal(reg2.providers.size, 0)
  // 注册抛错：守卫已挂，技能失败只记警告
  events.length = 0; logs.length = 0
  apply({ on: (n) => events.push(n), skills: { registerProvider() { throw new Error('boom') } }, logger: () => ({ info() {}, warn: (m) => logs.push(m) }) }, {})
  assert.deepEqual(events, ['tools/pre-execute'], '守卫不受影响'); assert.ok(logs.some((m) => m.includes('standard skills not registered') && m.includes('boom')))
  // 无 skills 服务
  events.length = 0; apply({ on: (n) => events.push(n) }, {}); assert.deepEqual(events, ['tools/pre-execute'])
})

test('技能正文：无相对链接目标残留（316 处在单条技能里会断，生成时去掉了目标）；章内引用写法「NN §x.y」仍在', () => {
  for (const f of skillFiles()) {
    const t = readFileSync(join(root, 'skills', f), 'utf8')
    const rel = [...t.matchAll(/\]\((?!https?:|#|mailto:)([^)]+)\)/g)].map((m) => m[1])
    // 模板里有代码块写着示例链接（例如模板正文自己的 markdown 示例），不算技能的链接；只在章技能里严查
    if (f.startsWith('std-0')) assert.deepEqual(rel, [], `${f} 残留相对链接：${rel.slice(0, 3).join(' | ')}`)
  }
  assert.match(readFileSync(join(root, 'skills', 'std-01-project-management.md'), 'utf8'), /§4\.1/)
})

test('节目录：行号指向技能正文里的真实标题行（模型靠它定位，错一行就读错一节）', () => {
  for (const f of skillFiles().filter((x) => x.startsWith('std-0'))) {
    const lines = readFileSync(join(root, 'skills', f), 'utf8').split('\n')
    const outline = lines.filter((l) => /^- 第 \d+ 行　/.test(l))
    assert.ok(outline.length >= 5, `${f} 节目录条数太少`)
    for (const o of outline) {
      const [, n, title] = /^- 第 (\d+) 行　(.*)$/.exec(o)
      assert.equal(lines[Number(n) - 1].replace(/^#+\s*/, ''), title, `${f} 第 ${n} 行不是「${title}」`)
    }
  }
})

test('package.json：files 白名单含 skills；bin 含 std-check；装到的包里有技能正文（这是设计时发现的缺口）', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.ok(pkg.files.includes('skills'), 'files 里缺 skills：装到 profile 的包里就没有标准正文')
  assert.ok(pkg.files.includes('tools/std/CONTRACT.md'))
  assert.equal(pkg.bin['std-check'], 'lib/cli.js')
  for (const f of readdirSync(join(root, 'skills'))) assert.ok(statLike(f))
})
const statLike = (f) => f.endsWith('.md') || f === 'index.json'
