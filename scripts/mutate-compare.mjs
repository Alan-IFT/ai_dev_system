#!/usr/bin/env node
// 把 mutate.mjs 的逐条输出落成 JSON，并对比两次：提炼夹具（把「对外部样本整表循环」换成「人写的命名用例」）前后，
// 每条变异的结局不许变坏。用法：
//   node scripts/mutate-compare.mjs record <名字> <清单.json> "<测试文件…>"    跑 mutate.mjs，把每条的结局存到 %TEMP%/mutcmp-<名字>.json
//   node scripts/mutate-compare.mjs diff   <名字前> <名字后>                     对比两份记录，列出变坏的
// 结局分级（越大越好）：caught（抓住）> typeGuarded/unverified（有声明的例外）> missed（漏）> invalid（无效）。
// 「变坏」＝后一次的等级低于前一次，或「抓住」时失败的测试条数从 ≥1 掉到 0。只看**等级**，不比较失败条数的绝对值——提炼本来就会让失败条数变少。
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [cmd, a, b, c] = process.argv.slice(2)
const file = (name) => join(tmpdir(), `mutcmp-${name}.json`)
const RANK = { caught: 3, typeGuarded: 2, unverified: 2, missed: 1, invalid: 0 }

function parse(stdout) {
  const out = {}
  for (const line of stdout.split('\n')) {
    const m = /^([✓✗?△◇]) (\S+)\s+(.*)$/.exec(line.trim())
    if (!m) continue
    const [, sym, id, rest] = m
    const failedN = /失败 (\d+) 条/.exec(rest)
    out[id] = { outcome: { '✓': 'caught', '✗': 'missed', '?': 'invalid', '△': 'unverified', '◇': 'typeGuarded' }[sym], failed: failedN ? Number(failedN[1]) : 0 }
  }
  return out
}

if (cmd === 'record') {
  const [name, list, tests] = [a, b, c]
  if (!name || !list || !tests) { console.error('用法：record <名字> <清单.json> "<测试文件…>"'); process.exit(2) }
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'mutate.mjs'), list, '--tests', tests], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
  const res = parse(r.stdout)
  const total = Object.keys(res).length
  const counts = Object.values(res).reduce((acc, x) => ((acc[x.outcome] = (acc[x.outcome] ?? 0) + 1), acc), {})
  writeFileSync(file(name), JSON.stringify({ list, tests, res }, null, 1))
  console.log(`已记录 ${name}：${total} 条 ${JSON.stringify(counts)} → ${file(name)}`)
  process.exit(r.status === 0 || r.status === 1 ? 0 : 2)   // mutate 对「有漏」退 1，这里只管记录；基线构建失败才是真错误
} else if (cmd === 'diff') {
  if (!existsSync(file(a)) || !existsSync(file(b))) { console.error('找不到记录文件'); process.exit(2) }
  const A = JSON.parse(readFileSync(file(a), 'utf8')).res, B = JSON.parse(readFileSync(file(b), 'utf8')).res
  const worse = []
  for (const [id, x] of Object.entries(A)) {
    const y = B[id]
    if (!y) { worse.push(`${id}：后一次没有这条（清单变了？）`); continue }
    if (RANK[y.outcome] < RANK[x.outcome]) worse.push(`${id}：${x.outcome}（失败 ${x.failed} 条）→ ${y.outcome}（失败 ${y.failed} 条）`)
    else if (x.outcome === 'caught' && y.outcome === 'caught' && y.failed === 0) worse.push(`${id}：抓住但失败条数为 0（记录异常）`)
  }
  for (const id of Object.keys(B)) if (!(id in A)) worse.push(`${id}：前一次没有这条（清单变了？）`)
  const only1 = Object.entries(B).filter(([id, y]) => y.outcome === 'caught' && A[id]?.outcome === 'caught' && y.failed === 1).length
  console.log(`对比 ${a} → ${b}：${Object.keys(A).length} 条；变坏 ${worse.length} 条；其中后一次「只被 1 个测试抓住」的 ${only1} 条（单点防线，提醒但不算变坏）`)
  for (const w of worse) console.log('  ✗ ' + w)
  process.exit(worse.length ? 1 : 0)
} else {
  console.error('用法：record <名字> <清单.json> "<测试文件…>" | diff <名字前> <名字后>'); process.exit(2)
}
