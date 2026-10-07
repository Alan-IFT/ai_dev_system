#!/usr/bin/env node
// 检查器 selftest 验收：TS 版 `selftest()` 产出的 (id, status) 集合必须与 `golden/samples/selftest-probes.json` 里该检查器名下的条目**完全相同**。
//
// 为什么这比「逐条看标题」强：探针的 id 是 `sha1(标题)[:8]`（没给 kind 时），所以**标题差一个字、id 就不同**——集合相等同时钉住了
// 探针的数量、每条的措辞与每条的结论。少迁一条、标题抄错一个字、某条在 TS 里变成了 FAIL，都会让这个比较红。
//
// 用法：node scripts/golden-selftest.mjs <检查器名>          退出码：0 一致；1 有差异；2 跑不了
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const name = process.argv[2]
if (!name) { console.error('用法：node scripts/golden-selftest.mjs <检查器名>'); process.exit(2) }

// 检查器名（NAME，进 finding id）与文件名不总一致：`derived-artifacts` 对应 check_derived.py / derived.ts。命令行两种写法都收。
const FILE_OF = { 'derived-artifacts': 'derived' }
const file = FILE_OF[name] ?? name.replaceAll('-', '_')
let mod
try { mod = await import(pathToFileURL(join(root, 'lib', 'checks', `${file}.js`)).href) } catch (e) { console.error(`加载失败：${e.message}`); process.exit(2) }
if (typeof mod.selftest !== 'function') { console.error('模块没有导出 selftest'); process.exit(2) }

const want = JSON.parse(readFileSync(join(root, 'golden', 'samples', 'selftest-probes.json'), 'utf8')).filter((p) => p.check === (mod.NAME ?? name))
const got = (await mod.selftest()).map((f) => ({ id: f.id, status: f.status, title: f.title }))
const w = new Map(want.map((p) => [p.id, p])), g = new Map(got.map((p) => [p.id, p]))
const missing = [...w.keys()].filter((k) => !g.has(k)), extra = [...g.keys()].filter((k) => !w.has(k))
const changed = [...g.keys()].filter((k) => w.has(k) && g.get(k).status !== w.get(k).status)
const dupes = got.length - g.size

if (!missing.length && !extra.length && !changed.length && !dupes) {
  console.log(`✓ ${name}：selftest ${got.length} 条，与黄金样本的 (id, status) 集合完全相同`)
  process.exit(0)
}
console.log(`✗ ${name}：黄金样本 ${want.length} 条，TS 实得 ${got.length} 条`)
for (const k of missing) console.log(`    缺：${w.get(k).status} ${k} | ${w.get(k).title}`)
for (const k of extra) console.log(`    多：${g.get(k).status} ${k} | ${g.get(k).title}`)
for (const k of changed) console.log(`    状态不同：${k} | ${g.get(k).title}  期望 ${w.get(k).status}、实得 ${g.get(k).status}`)
if (dupes) console.log(`    TS 的 selftest 里有 ${dupes} 条重复 id`)
process.exit(1)
