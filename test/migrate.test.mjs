// `std-check migrate` 的测试：合成一个带 `.std/` 副本、三种钩子形态的采用项目，验证方案的内容；
// 并**按方案真正执行一遍**（在临时仓里），对比迁移前后的 std-check 输出——只允许出现登记的预期差异。
// 三个真实采用项目一字节不碰（硬约束 4）；夹具里的钩子文本取自它们的真实形态（读自实物，不是编的）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { plan, renderPlan, findHooks } from '../lib/migrate.js'
import { pluginInstalled, main, parseArgs } from '../lib/main.js'
import { ADOPTION as ADOPTION_CHANGES } from './cases/expected-changes.mjs'

const here = dirname(fileURLToPath(import.meta.url)), repo = join(here, '..')
const tmps = []
const mk = () => { const t = mkdtempSync(join(tmpdir(), 'mig-')); tmps.push(t); return t }
test.after(() => { for (const t of tmps) rmSync(t, { recursive: true, force: true }) })
const w = (root, rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text) }
const git = (root, ...args) => { const env = { ...process.env }; for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k]; return spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { env, encoding: 'utf8' }) }

// 三种钩子的真实文本（读自 Reservoir/CMS/PMC 的实物，缩到与迁移相关的行）
const HOOK_GITHOOKS = `#!/bin/sh
[ -f .std/tools/std/pick-python.sh ] || { echo "缺 pick-python" >&2; exit 127; }
. .std/tools/std/pick-python.sh || exit $?
exec "$PY" .std/tools/std/check_all.py . --no-scope
`
const HOOK_PRECOMMIT = `repos:
  - repo: local
    hooks:
      - id: std-check-all
        entry: >-
          sh -c '[ -f .std/tools/std/pick-python.sh ] || { echo "missing" >&2; exit 127; };
          . .std/tools/std/pick-python.sh || exit $?;
          exec "$PY" .std/tools/std/check_all.py . --no-scope'
        language: system
`
const HOOK_PMC_PUSH = `#!/usr/bin/env bash
hook_pick_python
"\${HOOK_GIT_ENV_STRIP[@]}" "$PY" .std/tools/std/check_all.py . >"$STD_OUT" 2>&1
`

/** 造一个带 .std/ 副本的采用项目。flavor 决定钩子形态。 */
function adopter(flavor) {
  const root = mk()
  git(root, 'init', '-q')
  w(root, 'AGENTS.md', '# 入口\n\n标准在 `.std/标准/`，检查：`python3 .std/tools/std/check_all.py .`\n')
  w(root, 'governance/project.yaml', 'tier: L0\ncompatibility:\n  policy: 未上线，可破坏性重构\nlayout:\n  entry:\n    - AGENTS.md\n  frozen:\n    - .std                # 标准的只读内嵌副本\n')
  w(root, 'governance/STANDARD_VERSION', '2026-10-05.1\nadopted_at: 2026-09-10\n')
  w(root, '.std/标准/README.md', '# 标准\n\n候选实现修订：`2026-10-05.1`。\n')
  w(root, '.std/tools/std/check_all.py', '# 旧检查器\n')
  w(root, 'docs/plans/2026-09-01-历史计划.md', '# 历史计划\n\n当时用 `.std/tools/std/check_all.py .` 跑过。\n') // 历史记录：不应进"现行引用"清单
  if (flavor === 'githooks') w(root, '.githooks/pre-commit', HOOK_GITHOOKS)
  if (flavor === 'precommit') w(root, '.pre-commit-config.yaml', HOOK_PRECOMMIT)
  if (flavor === 'custom') { w(root, 'tools/hooks/pre-commit', '#!/usr/bin/env bash\n# 闸门①已搬到 pre-push\nhook_pick_python\n'); w(root, 'tools/hooks/pre-push', HOOK_PMC_PUSH) }
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'init')
  return root
}

test('findHooks：三种形态各自被认出；自写钩子目录里「含旧检查器调用」的其它钩子（pre-push）也被认出', () => {
  assert.deepEqual(findHooks(adopter('githooks')).map((h) => [h.kind, h.path]), [['githooks-script', '.githooks/pre-commit']])
  assert.deepEqual(findHooks(adopter('precommit')).map((h) => [h.kind, h.path]), [['precommit-framework', '.pre-commit-config.yaml']])
  const c = findHooks(adopter('custom')).map((h) => [h.kind, h.path])
  assert.deepEqual(c, [['custom-hooks-dir', 'tools/hooks/pre-push']], 'PMC 真实形态：只有 pre-push 调旧检查器；pre-commit 不调，不算')
  assert.deepEqual(findHooks(mk()), [], '没有钩子 → 空')
})

test('findHooks：固定候选文件也必须真的调用旧检查器才算；钩子目录里的 .md 文档不算钩子（读三个真实项目时发现的两处缺陷：PMC 的 pre-commit 不调检查器、其 README.md 只是写着旧命令）', () => {
  const root = adopter('custom')
  w(root, 'tools/hooks/pre-commit', '#!/usr/bin/env bash\n# 闸门①已搬到 pre-push\nhook_pick_python\n') // 不调旧检查器
  w(root, 'tools/hooks/README.md', '| ① | pre-push | `python .std/tools/std/check_all.py .` |\n') // 文档里写着旧命令
  git(root, 'add', '-A')
  assert.deepEqual(findHooks(root).map((h) => h.path), ['tools/hooks/pre-push'], '只剩真正调用旧检查器的可执行钩子')
  const docs = plan(root, true).steps.find((s) => s.id === 'docs-refs')
  assert.ok(docs.hits.some(([f]) => f === 'tools/hooks/README.md'), 'README.md 里的旧命令归文档引用步骤，不丢')
})

test('findHooks：只引用 pick-python 片段、不调 check_all 的钩子也算（它依赖 .std/，.std/ 删后会找不到片段而拒绝一切提交）', () => {
  const root = mk(); git(root, 'init', '-q')
  w(root, '.githooks/pre-commit', '#!/bin/sh\n. .std/tools/std/pick-python.sh || exit $?\necho "$PY"\n'); git(root, 'add', '-A')
  assert.deepEqual(findHooks(root).map((h) => h.path), ['.githooks/pre-commit'])
})

test('findHooks：自写钩子目录里只认「含旧检查器调用」的钩子——不含的（项目自己的其它门）不算，不给它们造步骤', () => {
  const root = adopter('custom')
  w(root, 'tools/hooks/pre-merge', '#!/bin/sh\necho 项目自己的别的门，不调检查器\n'); git(root, 'add', '-A')
  assert.deepEqual(findHooks(root).map((h) => h.path), ['tools/hooks/pre-push'], '没调旧检查器的 pre-merge 与 pre-commit 都不进来')
})

test('plan：只要有 .std/ 以外的迁移对象（版本声明或钩子）就不能判「无需迁移」——哪怕没有 .std/ 目录', () => {
  const a = mk(); git(a, 'init', '-q'); w(a, 'governance/STANDARD_VERSION', '1\n'); git(a, 'add', '-A')
  const pa = plan(a, true); assert.equal(pa.notApplicable, undefined); assert.deepEqual(pa.steps.map((s) => s.id), ['rm-standard-version', 'compare'])
  const b = mk(); git(b, 'init', '-q'); w(b, '.githooks/pre-commit', HOOK_GITHOOKS); git(b, 'add', '-A')
  const pb = plan(b, true); assert.equal(pb.notApplicable, undefined); assert.ok(pb.steps.some((s) => s.id.startsWith('hook:')))
})

test('plan：.std/ 目录存在但没有被 git 跟踪的文件 → 不给会失败的 git rm，改给「直接删目录」的说明', () => {
  const root = mk(); git(root, 'init', '-q'); w(root, 'README.md', '# x\n'); git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'i')
  w(root, '.std/x.md', '# 未跟踪\n') // 未 git add
  const s = plan(root, true).steps.find((x) => x.id === 'rm-std')
  assert.equal(s.commands.length, 1); assert.ok(!s.commands[0].startsWith('git rm'), '没有跟踪文件时 git rm 会报 pathspec 无匹配而失败')
  assert.match(s.commands[0], /没有被 git 跟踪/)
})

test('plan：文档引用清单不含 .std/ 自己里的文件（标准副本里到处写着 .std/ 不算项目的引用）', () => {
  const root = adopter('githooks'); w(root, '.std/标准/说明.md', '# 副本\n\n见 `.std/标准/01.md`\n'); git(root, 'add', '-A')
  const docs = plan(root, true).steps.find((s) => s.id === 'docs-refs')
  assert.ok(docs.hits.every(([f]) => !f.startsWith('.std/')), `混进了 .std/ 内的文件：${docs.hits.map((h) => h[0]).join(',')}`)
})

test('plan：文档引用最多列 200 处（方案要给人和 agent 读，不能一次倒出几千行）；标题里写的是真实总数', () => {
  const root = adopter('githooks')
  w(root, 'docs/很多引用.md', Array.from({ length: 260 }, (_, i) => `第${i}处见 .std/标准/x.md`).join('\n') + '\n'); git(root, 'add', '-A')
  const docs = plan(root, true).steps.find((s) => s.id === 'docs-refs')
  assert.equal(docs.hits.length, 200); assert.match(docs.title, /共 261 处/, '标题里是真实总数，不是截断后的数（含 AGENTS.md 的 1 处）')
})

test('plan：frozen 只认真正的 .std 项——.stdlib、.std-cache 这类同前缀的目录不能被当成要删的', () => {
  const root = adopter('githooks'); w(root, 'governance/project.yaml', 'tier: L0\ncompatibility:\n  policy: x\nlayout:\n  frozen:\n    - .stdlib\n    - .std-cache\n')
  assert.ok(!plan(root, true).steps.some((s) => s.id === 'frozen-std'))
})

test('renderPlan：无需迁移的方案只输出说明，不夹带空的「项目现状」', () => {
  const root = mk(); git(root, 'init', '-q')
  const txt = renderPlan(plan(root, true))
  assert.ok(txt.includes('无需迁移')); assert.ok(!txt.includes('项目现状'))
})

test('命令行 migrate：根是文件、不存在、含 NUL 都不崩——plan 对任何字符串根都返回方案（"无需迁移"），不抛', () => {
  for (const r of ['package.json', 'D:/不存在的目录-xyz', 'a\0b']) {
    const out = [], err = []
    assert.equal(main(['migrate', r], undefined, { out: (t) => out.push(t), err: (t) => err.push(t) }), 0, `根 ${JSON.stringify(r)}`)
    assert.deepEqual(err, []); assert.match(out[0], /无需迁移/)
  }
})

test('plan：不是带内嵌标准的采用项目 → 无需迁移，不给步骤', () => {
  const root = mk(); git(root, 'init', '-q'); w(root, 'README.md', '# x\n')
  const p = plan(root, true)
  assert.equal(p.steps.length, 0); assert.match(p.notApplicable, /无需迁移/)
})

test('plan：步骤次序＝先钩子、再删 .std/、再删版本声明、再 frozen、再文档引用、最后对账（删 .std/ 之前钩子必须已改，否则旧钩子找不到检查器、提交被拒）', () => {
  const p = plan(adopter('githooks'), true)
  assert.deepEqual(p.steps.map((s) => s.id.split(':')[0]), ['hook', 'rm-std', 'rm-standard-version', 'frozen-std', 'docs-refs', 'compare'])
  assert.deepEqual(p.steps.filter((s) => s.kind === 'deterministic').map((s) => s.id), ['rm-std', 'rm-standard-version', 'compare'])
  assert.deepEqual(p.steps[1].commands, ['git rm -r -q .std']); assert.deepEqual(p.steps[2].commands, ['git rm -q governance/STANDARD_VERSION'])
  for (const s of p.steps) { assert.ok(s.verify.length > 10, `${s.id} 没写验证`); assert.ok(s.rollback.length > 5, `${s.id} 没写回退`) }
})

test('plan：新插件未装入 → 钩子步骤标 blocked 并说清缺什么；其余步骤不受影响（失败关闭，不假装能调）', () => {
  const p = plan(adopter('githooks'), { ok: false, why: '缺插件' })
  const hook = p.steps.find((s) => s.id.startsWith('hook:'))
  assert.equal(hook.blocked, '缺插件'); assert.equal(p.facts.pluginInstalled, false)
  assert.ok(p.steps.filter((s) => !s.id.startsWith('hook:')).every((s) => s.blocked === undefined))
  assert.match(renderPlan(p), /当前不可做/)
})

test('plan：现行文档的 .std/ 引用被列出（行号与原文），历史计划目录里的不列；.std/ 自己里的不列', () => {
  const docs = plan(adopter('githooks'), true).steps.find((s) => s.id === 'docs-refs')
  const files = [...new Set(docs.hits.map((h) => h[0]))]
  assert.deepEqual(files, ['AGENTS.md'], '历史计划 docs/plans/ 与 .std/ 下的不进清单')
  assert.deepEqual(docs.hits.map((h) => h[1]), [3, 3].slice(0, docs.hits.length)); assert.match(docs.hits[0][2], /\.std\//)
})

test('plan：frozen 里的 .std 一项被识别（连注释一起指给你看），project.yaml 没有时不产出这一步', () => {
  const p = plan(adopter('githooks'), true)
  const f = p.steps.find((s) => s.id === 'frozen-std'); assert.equal(f.hits.length, 1); assert.match(f.hits[0][2], /^\s*-\s*\.std/)
  const root = adopter('githooks'); w(root, 'governance/project.yaml', 'tier: L0\ncompatibility:\n  policy: x\n')
  assert.ok(!plan(root, true).steps.some((s) => s.id === 'frozen-std'))
})

test('plan：三种钩子形态给各自的建议（折叠块要用 ; 连；自写钩子不动它自己的选解释器逻辑、保持 0 与 2 放行的语义）', () => {
  const adv = (f) => plan(adopter(f), true).steps.find((s) => s.id.startsWith('hook:')).advice
  assert.match(adv('githooks'), /失败关闭/); assert.match(adv('githooks'), /DSH_PROFILE_DIR/)
  assert.match(adv('precommit'), /折叠块/); assert.match(adv('precommit'), /`;` 连/)
  assert.match(adv('custom'), /不要动/); assert.match(adv('custom'), /0 与 2 都放行/)
  const hits = plan(adopter('custom'), true).steps.filter((s) => s.id.startsWith('hook:')).map((s) => s.id)
  assert.deepEqual(hits, ['hook:tools/hooks/pre-push'], '只给真正调旧检查器的 pre-push 步骤')
})

test('只读：对项目跑 plan／renderPlan 不改任何文件（工作区与 git 索引前后一致）', () => {
  const root = adopter('custom')
  const before = git(root, 'status', '--porcelain').stdout + git(root, 'ls-files', '-s').stdout
  plan(root, true); renderPlan(plan(root, false))
  assert.equal(git(root, 'status', '--porcelain').stdout + git(root, 'ls-files', '-s').stdout, before)
})

test('pluginInstalled：没有 DSH_PROFILE_DIR → 检测不到并说明；profile 里有 cli.js → true；没有 → 说清路径', () => {
  assert.match(pluginInstalled({}).why, /DSH_PROFILE_DIR/)
  const prof = mk()
  assert.match(pluginInstalled({ DSH_PROFILE_DIR: prof }).why, /还没装入/)
  w(prof, 'node_modules/dsh-project-std/lib/cli.js', '// x\n'); assert.equal(pluginInstalled({ DSH_PROFILE_DIR: prof }), true)
})

test('命令行：migrate 只认第一个位置；--json 输出可解析；无需迁移的退出 0；未知参数仍退出 2', () => {
  assert.equal(parseArgs(['migrate', 'p', '--json']).migrate, true)
  assert.equal(parseArgs(['p', 'migrate']), '多余的位置参数：migrate', 'migrate 不在第一位 → 当位置参数，多了就报错（不静默当子命令）')
  const out = [], err = []
  const io = { out: (t) => out.push(t), err: (t) => err.push(t) }
  const root = mk(); git(root, 'init', '-q')
  assert.equal(main(['migrate', root, '--json'], undefined, io), 0); assert.match(JSON.parse(out[0]).notApplicable, /无需迁移/)
  assert.equal(main(['migrate', root, '--nope'], undefined, io), 2)
})

// ---- 按方案真正执行一遍，对比迁移前后（用本仓的 lib/cli.js 做检查器）----
const cli = join(repo, 'lib', 'cli.js')
const std = (root) => { const r = spawnSync(process.execPath, [cli, root, '--json', '--no-scope'], { encoding: 'utf8', maxBuffer: 1 << 28 }); return { rc: r.status, f: JSON.parse(r.stdout) } }

test('端到端：按方案执行确定性步骤后，std-check 的差异只剩登记的预期（adoption 的版本记录两条）；id 集合其余不变、状态不变', () => {
  const root = adopter('githooks')
  const before = std(root)
  const p = plan(root, true)
  for (const s of p.steps.filter((x) => x.kind === 'deterministic' && x.commands && x.id !== 'compare')) {
    for (const c of s.commands) { const m = /^git (.+)$/.exec(c); assert.ok(m, `${s.id} 的命令不是 git：${c}`); const r = git(root, ...m[1].split(' ')); assert.equal(r.status, 0, `${c} 失败：${r.stderr}`) }
  }
  // frozen 里的 .std 一行：方案是「需判断」，这里按它的建议手工删（模拟 agent 执行）
  const y = readFileSync(join(root, 'governance', 'project.yaml'), 'utf8').split('\n').filter((l) => !/^\s*-\s*\.std\b/.test(l)).join('\n').replace(/\n  frozen:\n(?=\S|$)/, '\n')
  writeFileSync(join(root, 'governance', 'project.yaml'), y)
  const after = std(root)
  assert.ok(!existsSync(join(root, '.std')) && !existsSync(join(root, 'governance', 'STANDARD_VERSION')))
  const key = (f) => f.id
  const b = new Map(before.f.map((f) => [key(f), f])), a = new Map(after.f.map((f) => [key(f), f]))
  const gone = [...b.keys()].filter((k) => !a.has(k) && !k.startsWith('tool-identity')), added = [...a.keys()].filter((k) => !b.has(k) && !k.startsWith('tool-identity'))
  const changes = ADOPTION_CHANGES.vanished_findings.map((v) => v.id)
  // 「数量写进标题」的 PASS 条目（没有 kind，id＝标题哈希）：删掉 .std/ 后被扫的文件少了，标题里的数变了，id 随之变。
  // 它们必须**成对**出现（消失一条、新增一条，同一检查器、同为 PASS、位置相同），否则就是真丢了检查——不能用「标题变了」当万能借口。
  const pairs = []
  for (const g of [...gone]) {
    const fg = b.get(g)
    if (fg.status !== 'PASS' || changes.includes(g)) continue
    const m = added.find((k) => a.get(k).check === fg.check && a.get(k).status === 'PASS' && (a.get(k).where ?? null) === (fg.where ?? null) && !pairs.some((p) => p[1] === k))
    if (m) { pairs.push([g, m]); gone.splice(gone.indexOf(g), 1); added.splice(added.indexOf(m), 1) }
  }
  assert.ok(pairs.length >= 1, '应有至少一对「扫描面变小→标题里的数变了」的 PASS（links 的「扫了 N 份」）')
  assert.deepEqual(gone.filter((k) => !changes.includes(k)), [], '消失的 id 必须全在登记的预期消失里，或与新增成对（同检查器、同为 PASS、同位置）')
  assert.deepEqual(added, [], '不应冒出配不上对的新 id')
  const diffStatus = [...a.entries()].filter(([k, f]) => b.has(k) && b.get(k).status !== f.status).map(([k]) => k)
  assert.deepEqual(diffStatus, [], '留下的 id 状态不得变化')
  // 迁移前后用的都是新检查器，它本来就不再产出版本记录那两条 PASS（相对迁移前 Python 版的消失登记在 test/cases/expected-changes.mjs）；
  // 这里钉的是：迁移前后 adoption 的输出完全一致，且只剩 compatibility.policy 一条——删 STANDARD_VERSION 不会让 adoption 变化。
  const ad = (r) => r.f.filter((f) => f.check === 'adoption').map((f) => [f.id, f.status])
  assert.deepEqual(ad(after), ad(before)); assert.deepEqual(ad(after), [['adoption/compatibility-policy', 'PASS']])
  assert.equal(before.rc, after.rc, '退出码不变')
})
