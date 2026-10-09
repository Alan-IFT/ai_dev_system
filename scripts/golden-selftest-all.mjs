#!/usr/bin/env node
// 汇总层/stdlib 层自检的验收脚手架：TS 版 `--selftest` 追加的那部分探针的 (id, status) 集合，必须等于黄金样本里 check ∈ {stdlib, shared-fact, entry-smoke, contract-examples} 的集合，
// 差异只能来自 `golden/expected-changes.json` 里的 `vanished_probes`（Python 专有机制，对象在 TS 里不存在）与 `added_probes`（TS 新增的替代探针），两者每次都打印、每条有理由。
// 与 `golden-selftest.mjs`（单个检查器）同口径；SKIP 的探针（Windows 上造不出夹具）两边按平台各自 SKIP，比对时只比 id。
//
// 用法：node scripts/golden-selftest-all.mjs     退出码：0 一致；1 有差异；2 跑不了
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const st = await import(pathToFileURL(join(root, 'lib', 'selftest.js')).href)
if (typeof st.aggregateSelftest !== 'function') { console.error('lib/selftest.js 没有导出 aggregateSelftest'); process.exit(2) }

const LAYERS = new Set(['stdlib', 'shared-fact', 'entry-smoke', 'contract-examples'])
const want = JSON.parse(readFileSync(join(root, 'golden', 'samples', 'selftest-probes.json'), 'utf8')).filter((p) => LAYERS.has(p.check))
const expected = (() => { try { return JSON.parse(readFileSync(join(root, 'golden', 'expected-changes.json'), 'utf8')) } catch { return {} } })()
const ex = expected['check_all'] ?? {}
const vanished = new Map((ex.vanished_probes ?? []).map((v) => [v.id, v.reason]))
const added = new Map((ex.added_probes ?? []).map((v) => [v.id, v.reason]))

const got = st.aggregateSelftest().filter((f) => LAYERS.has(f.check))
const wantIds = new Map(want.filter((p) => !vanished.has(p.id)).map((p) => [p.id, p.status]))
const gotIds = new Map(got.map((f) => [f.id, f.status]))

const missing = [...wantIds.keys()].filter((id) => !gotIds.has(id))
const extra = [...gotIds.keys()].filter((id) => !wantIds.has(id) && !added.has(id))
const addedMissing = [...added.keys()].filter((id) => !gotIds.has(id))
// 状态：期望 SKIP 的（Windows 造不出夹具）与实得可以不同（TS 可能在别的平台有夹具）；其余必须相同，且除 SKIP 外全是 PASS
const statusDiff = [...wantIds.keys()].filter((id) => gotIds.has(id) && wantIds.get(id) !== gotIds.get(id) && wantIds.get(id) !== 'SKIP' && gotIds.get(id) !== 'SKIP')
const notPass = got.filter((f) => f.status !== 'PASS' && f.status !== 'SKIP')

if (vanished.size) console.log(`预期消失的探针 ${vanished.size} 条（golden/expected-changes.json）：${[...vanished.keys()].join('、')}`)
if (added.size) console.log(`新增的替代探针 ${added.size} 条：${[...added.keys()].join('、')}`)
const bad = missing.length + extra.length + addedMissing.length + statusDiff.length + notPass.length
if (!bad) {
  console.log(`✓ 汇总/stdlib 层自检：${got.length} 条，与黄金样本的 (id, status) 集合相同（样本 ${want.length} 条，其中预期消失 ${vanished.size} 条）`)
  process.exit(0)
}
console.log(`✗ 汇总/stdlib 层自检：黄金样本 ${want.length} 条（预期消失 ${vanished.size}），TS 实得 ${got.length} 条`)
for (const id of missing) console.log(`    缺：${id} ${want.find((p) => p.id === id).title}`)
for (const id of extra) console.log(`    多：${id} ${got.find((f) => f.id === id).title}`)
for (const id of addedMissing) console.log(`    声明新增却没产出：${id}`)
for (const id of statusDiff) console.log(`    状态不同：${id} 期望 ${wantIds.get(id)}、实得 ${gotIds.get(id)}`)
for (const f of notPass) console.log(`    非 PASS：${f.id} ${f.status} ${f.title}｜${f.evidence}`)
process.exit(1)
