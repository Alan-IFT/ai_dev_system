#!/usr/bin/env node
// 汇总层验收脚手架：在黄金样本钉住的提交上建只读克隆，跑 TS 版的**整体** `runAll`（含自检闸门、例外登记 join、封签），与 `golden/samples/<名字>.json` 逐条比较。
// 与 `golden-compare.mjs`（单检查器）的区别：这里比的是汇总层的产出——`registered` 字段、`exception-register/*` 条目、`tailoring/*` 条目都在其内。
// 口径与 `golden/make_golden.py` 一致：只比 check、id、status、where、registered；不比 title/evidence/reason。运行日冻结在样本生成日（同 golden-compare 的 FROZEN_MS）。
//
// `tool-identity` 一项**必然不同**（设计 §12.31 取舍 1：TS 版哈希 lib/*.js + CONTRACT.md，文件集与 Python 版不同），对比时排除并显式打印。
// `golden/expected-changes.json` 里的 `vanished_findings` 同样先从期望集剔除、每次打印。
//
// 用法：node scripts/golden-compare-all.mjs [--only std,reservoir]    退出码：0 全部一致；1 有差异；2 跑不了
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const onlyIdx = process.argv.indexOf('--only')
const only = onlyIdx >= 0 ? new Set((process.argv[onlyIdx + 1] ?? '').split(',').filter(Boolean)) : null
const manifest = JSON.parse(readFileSync(join(root, 'golden', 'samples', 'MANIFEST.json'), 'utf8'))
const REPOS = {
  std: 'D:\\Programs\\AI辅助开发规范及工作流确定', reservoir: 'D:\\Programs\\NFBY_Reservoir',
  cms: 'D:\\Programs\\NFBY_CMS_FullStack', pmc: 'D:\\Programs\\dingcun\\PMC-Planner',
}
const git = (repo, ...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' })

// 冻结「现在」到样本生成日的本地正午（理由同 golden-compare.mjs）。
const [gy, gm, gd] = manifest.generated_at.split('-').map(Number)
const FROZEN_MS = new Date(gy, gm - 1, gd, 12, 0, 0).getTime()
const RealDate = Date
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(FROZEN_MS); else super(...a) }
  static now() { return FROZEN_MS }
}

const ca = await import(pathToFileURL(join(root, 'lib', 'check_all.js')).href)
const expected = (() => { try { return JSON.parse(readFileSync(join(root, 'golden', 'expected-changes.json'), 'utf8')) } catch { return {} } })()
const vanished = new Map(Object.values(expected).flatMap((e) => (e?.vanished_findings ?? []).map((v) => [v.id, v.reason])))
const renamed = new Map(Object.values(expected).flatMap((e) => (e?.renamed_findings ?? []).map((v) => [v.from, v.to])))

const slim = (f) => ({ check: f.check, id: f.id, status: f.status, where: f.where ?? null, registered: f.registered ?? null })
const key = (f) => `${f.id}\u0000${f.where ?? ''}`
let bad = 0, ran = 0

for (const inp of manifest.inputs) {
  if (only && !only.has(inp.name)) continue
  const repo = process.env['STD_GOLDEN_' + inp.name.toUpperCase()] ?? REPOS[inp.name]
  if (!repo || !existsSync(repo)) { console.error(`${inp.name}：找不到仓 ${repo}`); process.exit(2) }
  if (git(repo, 'cat-file', '-e', inp.commit + '^{commit}').status !== 0) { console.error(`${inp.name}：仓里没有提交 ${inp.commit}`); process.exit(2) }
  const wt = join(mkdtempSync(join(tmpdir(), 'gall-')), 'wt')
  try {
    const clone = spawnSync('git', ['-c', 'core.autocrlf=false', 'clone', '-q', '--shared', '--no-checkout', repo, wt], { encoding: 'utf8' })
    if (clone.status !== 0) { console.error(`${inp.name}：只读克隆失败：${clone.stderr}`); process.exit(2) }
    const co = spawnSync('git', ['-C', wt, '-c', 'core.autocrlf=false', 'checkout', '-q', '--detach', inp.commit], { encoding: 'utf8' })
    if (co.status !== 0) { console.error(`${inp.name}：检出 ${inp.commit} 失败：${co.stderr}`); process.exit(2) }
    const [findings] = ca.runAll(wt)
    const got = findings.filter((f) => f.check !== ca.IDENTITY_CHECK).map(slim)
    const gotIdent = findings.filter((f) => f.check === ca.IDENTITY_CHECK).length
    const wantAll = JSON.parse(readFileSync(join(root, 'golden', 'samples', inp.name + '.json'), 'utf8')).filter((f) => f.check !== 'tool-identity')
    const want = wantAll.filter((f) => !vanished.has(f.id)).map((f) => (renamed.has(f.id) ? { ...f, id: renamed.get(f.id) } : f))
    const droppedHere = wantAll.length - want.length
    const g = new Map(got.map((f) => [key(f), f])), w = new Map(want.map((f) => [key(f), f]))
    const onlyGot = [...g.keys()].filter((k) => !w.has(k)), onlyWant = [...w.keys()].filter((k) => !g.has(k))
    // registered 比字段而不是比 JSON 字符串：样本里键序是 Python 的 sort_keys（expires, id），TS 的构造序是 id, expires，值相同就是相同
    const sameReg = (a, b) => (a === null || b === null) ? a === b : a.id === b.id && a.expires === b.expires
    const diff = [...g.keys()].filter((k) => w.has(k) && (g.get(k).status !== w.get(k).status || !sameReg(g.get(k).registered ?? null, w.get(k).registered ?? null)))
    ran++
    const nReg = want.filter((f) => f.registered).length
    if (!onlyGot.length && !onlyWant.length && !diff.length) {
      console.log(`✓ ${inp.name.padEnd(10)} 整体：${want.length} 条逐条一致（含 registered ${nReg} 条完整比对）；身份条目 ${gotIdent} 条已排除${droppedHere ? `；另有 ${droppedHere} 条按 golden/expected-changes.json 预期消失（${[...vanished.keys()].filter((id) => wantAll.some((f) => f.id === id)).join('、')}），未比` : ''}`)
    } else {
      bad++
      console.log(`✗ ${inp.name.padEnd(10)} 整体：期望 ${want.length} 条、实得 ${got.length} 条`)
      for (const k of onlyWant) console.log(`    缺：${w.get(k).status} ${k.replace('\u0000', ' @ ')}`)
      for (const k of onlyGot) console.log(`    多：${g.get(k).status} ${k.replace('\u0000', ' @ ')}`)
      for (const k of diff) console.log(`    不同：${k.replace('\u0000', ' @ ')}  期望 ${w.get(k).status}/${JSON.stringify(w.get(k).registered ?? null)}、实得 ${g.get(k).status}/${JSON.stringify(g.get(k).registered)}`)
    }
  } finally {
    rmSync(dirname(wt), { recursive: true, force: true })
  }
}
if (ran === 0) { console.error('一个输入也没跑'); process.exit(2) }
console.log(bad ? `\n${bad} 个输入有差异` : `\n${ran} 个输入全部一致`)
process.exit(bad ? 1 : 0)
