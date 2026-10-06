#!/usr/bin/env node
// 检查器验收脚手架：在黄金样本钉住的提交上建临时 worktree，跑 TS 版的**一个检查器**，与 `golden/samples/<名字>.json` 里该检查器名下的条目逐条比较。
// 比较口径与 `golden/make_golden.py` 一致：只比 check、id、status、where、registered；不比 title/evidence/reason（freshness 用运行日、文本里有「N 天」）。
//
// 为什么能单检查器验收：Python 版里单跑一个检查器（过自检闸门 → run）与它在整体里的结果完全相同（已实测），检查器之间没有结果依赖。
//
// 用法：node scripts/golden-compare.mjs <检查器名> [--only std,reservoir]    退出码：0 全部一致；1 有差异；2 跑不了（缺仓、缺提交、缺模块）
// 路径可用环境变量 STD_GOLDEN_<名字大写> 覆盖（与 make_golden.py 同）。
// 不改被扫仓的工作区：用临时 worktree，用完删除（失败时也删）；只删自己建的、按精确路径。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const name = process.argv[2]
if (!name || name.startsWith('--')) { console.error('用法：node scripts/golden-compare.mjs <检查器名> [--only 名字,名字]'); process.exit(2) }
const onlyIdx = process.argv.indexOf('--only')
const only = onlyIdx >= 0 ? new Set((process.argv[onlyIdx + 1] ?? '').split(',').filter(Boolean)) : null

const manifest = JSON.parse(readFileSync(join(root, 'golden', 'samples', 'MANIFEST.json'), 'utf8'))
// 输入的仓路径：与 make_golden.py 的 INPUTS 一致（本机路径）；清单里只有提交号，路径写在这里
const REPOS = {
  std: 'D:\\Programs\\AI辅助开发规范及工作流确定', reservoir: 'D:\\Programs\\NFBY_Reservoir',
  cms: 'D:\\Programs\\NFBY_CMS_FullStack', pmc: 'D:\\Programs\\dingcun\\PMC-Planner',
}

const git = (repo, ...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' })

let mod
try { mod = await import(pathToFileURL(join(root, 'lib', 'checks', `${name.replaceAll('-', '_')}.js`)).href) } catch (e) { console.error(`加载 lib/checks/${name.replaceAll('-', '_')}.js 失败：${e.message}`); process.exit(2) }
const core = await import(pathToFileURL(join(root, 'lib', 'core', 'config.js')).href)
const gitm = await import(pathToFileURL(join(root, 'lib', 'core', 'git.js')).href)
if (typeof mod.run !== 'function') { console.error('模块没有导出 run'); process.exit(2) }

const slim = (f) => ({ check: f.check, id: f.id, status: f.status, where: f.where ?? null, registered: f.registered ?? null })
const key = (f) => `${f.id}\u0000${f.where ?? ''}`
let bad = 0, ran = 0

for (const inp of manifest.inputs) {
  if (only && !only.has(inp.name)) continue
  const repo = process.env['STD_GOLDEN_' + inp.name.toUpperCase()] ?? REPOS[inp.name]
  if (!repo || !existsSync(repo)) { console.error(`${inp.name}：找不到仓 ${repo}`); process.exit(2) }
  if (git(repo, 'cat-file', '-e', inp.commit + '^{commit}').status !== 0) { console.error(`${inp.name}：仓里没有提交 ${inp.commit}`); process.exit(2) }
  const wt = join(mkdtempSync(join(tmpdir(), 'gcmp-')), 'wt')
  try {
    const add = git(repo, 'worktree', 'add', '--detach', wt, inp.commit)
    if (add.status !== 0) { console.error(`${inp.name}：建临时 worktree 失败：${add.stderr}`); process.exit(2) }
    const [cfg, problem] = core.loadConfig(wt)
    if (problem) { console.error(`${inp.name}：读不到配置：${problem}`); process.exit(2) }
    const env = gitm.hardenedEnv(process.env)
    void env
    const got = (await mod.run(cfg)).map(slim)
    const want = JSON.parse(readFileSync(join(root, 'golden', 'samples', inp.name + '.json'), 'utf8')).filter((f) => f.check === (mod.NAME ?? name))
    const g = new Map(got.map((f) => [key(f), f])), w = new Map(want.map((f) => [key(f), f]))
    const onlyGot = [...g.keys()].filter((k) => !w.has(k)), onlyWant = [...w.keys()].filter((k) => !g.has(k))
    const diff = [...g.keys()].filter((k) => w.has(k) && (g.get(k).status !== w.get(k).status || (g.get(k).registered ?? null) !== (w.get(k).registered ?? null)))
    ran++
    if (!onlyGot.length && !onlyWant.length && !diff.length) console.log(`✓ ${inp.name.padEnd(10)} ${name}：${want.length} 条逐条一致`)
    else {
      bad++
      console.log(`✗ ${inp.name.padEnd(10)} ${name}：期望 ${want.length} 条、实得 ${got.length} 条`)
      for (const k of onlyWant) console.log(`    缺：${w.get(k).status} ${k.replace('\u0000', ' @ ')}`)
      for (const k of onlyGot) console.log(`    多：${g.get(k).status} ${k.replace('\u0000', ' @ ')}`)
      for (const k of diff) console.log(`    状态不同：${k.replace('\u0000', ' @ ')}  期望 ${w.get(k).status}、实得 ${g.get(k).status}`)
    }
  } finally {
    git(repo, 'worktree', 'remove', '--force', wt); git(repo, 'worktree', 'prune'); rmSync(dirname(wt), { recursive: true, force: true })
  }
}
if (ran === 0) { console.error('一个输入也没跑'); process.exit(2) }
console.log(bad ? `\n${bad} 个输入有差异` : `\n${ran} 个输入全部一致`)
process.exit(bad ? 1 : 0)
