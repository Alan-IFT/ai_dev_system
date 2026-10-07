#!/usr/bin/env node
// 检查器验收脚手架：在黄金样本钉住的提交上建临时 worktree，跑 TS 版的**一个检查器**，与 `golden/samples/<名字>.json` 里该检查器名下的条目逐条比较。
// 比较口径与 `golden/make_golden.py` 一致：只比 check、id、status、where、registered；不比 title/evidence/reason。运行日冻结在样本生成日（见下方 FROZEN_MS 的注释）。
//
// 为什么能单检查器验收：Python 版里单跑一个检查器（过自检闸门 → run）与它在整体里的结果完全相同（已实测），检查器之间没有结果依赖。
//
// 用法：node scripts/golden-compare.mjs <检查器名> [--only std,reservoir]    退出码：0 全部一致；1 有差异；2 跑不了（缺仓、缺提交、缺模块）
// 路径可用环境变量 STD_GOLDEN_<名字大写> 覆盖（与 make_golden.py 同）。
// **对被扫仓完全只读**：不用 `git worktree add`（它会往被扫仓的 `.git/worktrees/` 写元数据，虽然用完即清）；改为 `git clone --shared --no-checkout` 到自己的临时目录再检出固定提交——
// `--shared` 只读取源仓的对象库（写在自己的 `objects/info/alternates` 里指向它），源仓一个字节都不动。只删自己建的临时目录、按精确路径。
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

// 冻结「现在」到样本生成日的本地正午。黄金样本是钉在 `manifest.generated_at` 那天生成的静态 JSON；freshness 的 PASS/SKIP 条目 id 是标题哈希、标题里写着「距今 N 天」，
// 工作项活性也随运行日越过阈值——不冻结，样本一过夜就和 **Python 自己重跑**都对不上（已用 Python 在只读克隆上实测）。
// 只在本脚本的进程里替换 `Date`（TS 检查器取「今天」都走 `new Date()` / `Date.now()`）；**不改任何生产代码、不加环境变量开关**（那会给人一个藏起「文档过期」的口子），
// 也不改 Python 版。子进程里的 git 不受影响，提交时间照旧。
const [gy, gm, gd] = manifest.generated_at.split('-').map(Number)
const FROZEN_MS = new Date(gy, gm - 1, gd, 12, 0, 0).getTime()
const RealDate = Date
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(FROZEN_MS); else super(...a) }
  static now() { return FROZEN_MS }
}

// 检查器名（NAME，进 finding id）与文件名不总一致：`derived-artifacts` 对应 check_derived.py / derived.ts。
const FILE_OF = { 'derived-artifacts': 'derived' }
const file = FILE_OF[name] ?? name.replaceAll('-', '_')
let mod
try { mod = await import(pathToFileURL(join(root, 'lib', 'checks', `${file}.js`)).href) } catch (e) { console.error(`加载 lib/checks/${file}.js 失败：${e.message}`); process.exit(2) }
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
    // 克隆与检出都在我们自己的目录里；源仓只被读取对象。`-c core.autocrlf=false`：与 Python 生成样本时的 `git worktree add` 同样不转换行尾
    const clone = spawnSync('git', ['-c', 'core.autocrlf=false', 'clone', '-q', '--shared', '--no-checkout', repo, wt], { encoding: 'utf8' })
    if (clone.status !== 0) { console.error(`${inp.name}：只读克隆失败：${clone.stderr}`); process.exit(2) }
    const co = spawnSync('git', ['-C', wt, '-c', 'core.autocrlf=false', 'checkout', '-q', '--detach', inp.commit], { encoding: 'utf8' })
    if (co.status !== 0) { console.error(`${inp.name}：检出 ${inp.commit} 失败：${co.stderr}`); process.exit(2) }
    const [cfg, problem] = core.loadConfig(wt)
    if (problem) { console.error(`${inp.name}：读不到配置：${problem}`); process.exit(2) }
    const env = gitm.hardenedEnv(process.env)
    void env
    const got = (await mod.run(cfg)).map(slim)
    const want = JSON.parse(readFileSync(join(root, 'golden', 'samples', inp.name + '.json'), 'utf8')).filter((f) => f.check === (mod.NAME ?? name))
    const g = new Map(got.map((f) => [key(f), f])), w = new Map(want.map((f) => [key(f), f]))
    const onlyGot = [...g.keys()].filter((k) => !w.has(k)), onlyWant = [...w.keys()].filter((k) => !g.has(k))
    // `registered` 是 check_all 的 `_join_exceptions` 贴上的（检查器自己永远产出 null，Python 上实测：单跑 drift.run 得 null，贴完登记后与整体样本完全相同）。
    // 汇总层还没迁，TS 侧没有这一步，所以**样本里 registered 非空的条目只比 (id, status, where)**，并把这类条数显式打印出来——不静默跳过；
    // 汇总层迁完后改回全口径（把 REGISTERED_PENDING 设为 false）。
    const REGISTERED_PENDING = true
    const skippedRegistered = want.filter((f) => f.registered).length
    const diff = [...g.keys()].filter((k) => w.has(k) && (g.get(k).status !== w.get(k).status || (!REGISTERED_PENDING && (g.get(k).registered ?? null) !== (w.get(k).registered ?? null))))
    ran++
    if (!onlyGot.length && !onlyWant.length && !diff.length) console.log(`✓ ${inp.name.padEnd(10)} ${name}：${want.length} 条逐条一致${skippedRegistered ? `（其中 ${skippedRegistered} 条样本带登记认领 registered，待汇总层迁完后才比该字段）` : ''}`)
    else {
      bad++
      console.log(`✗ ${inp.name.padEnd(10)} ${name}：期望 ${want.length} 条、实得 ${got.length} 条`)
      for (const k of onlyWant) console.log(`    缺：${w.get(k).status} ${k.replace('\u0000', ' @ ')}`)
      for (const k of onlyGot) console.log(`    多：${g.get(k).status} ${k.replace('\u0000', ' @ ')}`)
      for (const k of diff) console.log(`    状态不同：${k.replace('\u0000', ' @ ')}  期望 ${w.get(k).status}、实得 ${g.get(k).status}`)
    }
  } finally {
    rmSync(dirname(wt), { recursive: true, force: true }) // 自己建的克隆，整目录删；源仓里没有任何东西要清
  }
}
if (ran === 0) { console.error('一个输入也没跑'); process.exit(2) }
console.log(bad ? `\n${bad} 个输入有差异` : `\n${ran} 个输入全部一致`)
process.exit(bad ? 1 : 0)
