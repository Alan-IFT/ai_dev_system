#!/usr/bin/env node
// 重算本仓库那些会漂移的计数。
//
// 这个脚本的存在理由：这些数字此前是手抄在文档里的，抄一次就多一处会过期的副本。
// 2026-09-03 第十一轮实测到两次真实漂移（版本号 27 份副本分成三档；仓库工作须知在同一轮内把"生效 5 条"写成"生效 4 条"），因此改为不抄、只算。
//
// 效力为零：它是"计数不该手抄"这条语义要求在 Markdown + Git + Node 上的一种载体实现，删掉它不影响规范。
// 原为 Python 脚本（docs/附录-载体实例/repo_counts.py），阶段 4 迁成 TS 生态（Node，免编译：本脚本不进插件发布面）；输出格式不变。
//
// 用法：node scripts/repo-counts.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { maskCode } from '../lib/checks/links.js'
import { trackedFiles } from '../lib/core/tracked.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(p, 'utf8')
// Python 的 splitlines：末尾换行不多算一行；空串给空数组（末尾的空段被去掉，空串因此自然得 0 行）
const lines = (s) => s.split(/\r\n|\n|\r/).filter((_, i, a) => !(i === a.length - 1 && a[i] === ''))
const cp = (s) => [...s].length   // Python 的 len() 按码点计

// 本地链接口径与 std-check 的 links 一致：外部（带协议）不算
const LINK = /\[[^\]]*\]\(\s*(?:<([^>\n]*)>|([^)\s]+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g
const EXTERNAL = /^(?:[a-zA-Z][\w+.-]*:|\/\/)/
const links = (masked) => [...masked.matchAll(LINK)].map((m) => m[1] || m[2])

const docs = join(ROOT, 'docs')
const body = [join(docs, '00-总览.md'), ...readdirSync(docs).filter((f) => /^[1234][0-9]-.*\.md$/.test(f)).sort().map((f) => join(docs, f))]
const chars = body.reduce((a, p) => a + cp(read(p)), 0)
const lineCount = body.reduce((a, p) => a + lines(read(p)).length, 0)
const princ = body.reduce((a, p) => a + (read(p).match(/^- \*\*P\d+/gm) ?? []).length, 0)

const ledger = join(docs, '追溯账本.md')
const ledLines = existsSync(ledger) ? lines(read(ledger)).length : 0

const log = read(join(docs, '决策日志.md'))
const decisions = [...new Set([...log.matchAll(/^\| (D-\d{3}) \|/gm)].map((m) => m[1]))].sort()
const reg = log.split('## 决策索引')[0]
// 状态格允许带强调标记：检查器用 strip 去掉 ** 后比较，这里必须同口径，否则两个工具对同一张表数出不同的生效条数（C-009 同形问题）。
const effective = [...new Set([...reg.matchAll(/^\| (D-\d{3}) \|\s*\**\s*(?:试行|已接受)\s*\**\s*\|/gm)].map((m) => m[1]))].sort()

const [tracked, problem] = trackedFiles(ROOT)
if (!tracked) { console.error('不在 git 工作区，无法取文件清单：' + problem); process.exit(2) }
const mds = tracked.filter((f) => f.toLowerCase().endsWith('.md') && existsSync(join(ROOT, f)))
let linkCount = 0
for (const f of mds) linkCount += links(maskCode(read(join(ROOT, f)))).filter((t) => !EXTERNAL.test(t)).length

// ---- 失败 Case 清单的分组数（2026-09-04 新增）----
// 判据：一个数若 (a) 是仓库当前状态的函数、(b) 有唯一可机械解析的权威载体、(c) 却出现在权威之外的散文里，就交给脚本导出，不再手抄。
const casesMd = join(docs, '失败Case清单.md')
const caseRows = [], grades = {}, blocked = {}, boundRules = new Set()
if (existsSync(casesMd)) {
  for (const ln of lines(read(casesMd))) {
    if (!ln.startsWith('| C-')) continue
    const m = maskCode(ln)
    const cut = []; for (let i = 0; i < m.length; i++) if (m[i] === '|') cut.push(i)
    const b = [-1, ...cut, ln.length]
    const col = []; for (let i = 0; i < b.length - 1; i++) col.push(ln.slice(b[i] + 1, b[i + 1]).trim())
    // col[1]=id col[2]=观察到的失败 col[3]=等级 col[4]=本该防住它的规则 col[5]=被拦住了吗
    if (col.length < 7) throw new Error('失败Case清单.md 有一行列数不足，先修表：' + ln.slice(0, 40)) // 列数不足不能静默跳过——那会让一行残缺的表悄悄少算
    caseRows.push(col[1])
    // 剥强调标记后再比较；不剥的话「**A｜仓库可复核**」与「A｜仓库可复核」会被数成两档（同 C-009 形态）。
    const g = col[3].replaceAll('*', '').trim(); grades[g] = (grades[g] ?? 0) + 1
    // 取整格而不是首字符：首字符会把「不适用」切成「不」，凭空造出一个档位。
    let bl = col[5].replaceAll('*', '').trim()
    const hit = ['是', '否', '不适用', '算'].find((k) => bl.startsWith(k)); bl = hit ?? '其它'
    blocked[bl] = (blocked[bl] ?? 0) + 1
    // 这一格以「无」开头时，它断言的正是"没有对应原则"，格里出现的 NN §M Pn 是它点名的反例或同型参照，不是绑定（C-042）。已知限制：判据是"整格以「无」开头"，不做语义分析。
    const ruleCell = col[4].replaceAll('*', '').trim()
    if (!ruleCell.startsWith('无')) {
      for (const mm of col[4].matchAll(/(\d\d)[ \u3000]?(?:章[ \u3000]?)?§\s?\d[ \u3000]?(P\d+)/g)) boundRules.add(mm[1] + '-' + mm[2])
      for (const mm of col[4].matchAll(/(\d\d)-(P\d+)/g)) boundRules.add(mm[1] + '-' + mm[2])
    }
  }
}
const boundChapters = [...new Set([...boundRules].map((r) => r.slice(0, 2)))].sort()
const kv = (o) => Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('、')

console.log(`正文        ${body.length} 文件 / ${lineCount} 行 / ${chars} 字符 / ${princ} 条原则`)
console.log(`追溯账本    ${ledLines} 行（效力为零）`)
console.log(`决策        ${decisions.length} 条，生效 ${effective.length} 条（${effective.join('、')}）`)
console.log(`markdown    ${mds.length} 个文件 / ${linkCount} 条本地链接`)
console.log(`失败 Case    ${caseRows.length} 条（等级 ${kv(grades)}；被拦住了吗 ${kv(blocked)}）`)
console.log(`已绑定原则  ${boundRules.size} 条 / 共 ${princ} 条（未绑 ${princ - boundRules.size}，${(princ ? ((princ - boundRules.size) * 100) / princ : 0).toFixed(0)}%）；已被证明有实例的章：${boundChapters.join('、')}`)
console.log()
console.log('断链数跑 std-check：node lib/cli.js . --no-scope')
