#!/usr/bin/env node
// 机械检查：src/core/ 里不得出现会悄悄偏离 Python 语义的 JS 写法（设计 §12.6 D5、D6、D13）。
//
// 为什么是脚本不是自觉：这个仓里**已登记**的约束「不用 `trim()` 与 `\s` 处理被扫文本」，我自己在写 `workRootAbsent` 时又违反了一次（设计 §12.14），
// 靠写变异清单才偶然发现。已登记的约束不会自己执行——要么有机械检查，要么每次写新代码前重读，而后者靠不住。
//
// 禁止项（只扫 src/core/，不扫 src/guard/：守卫是 JS 原生实现，不是 Python 的移植，不需要与 Python 对齐）：
//   1. `.trim(` / `.trimStart(` / `.trimEnd(`  —— JS 的 trim 去 U+FEFF、不去 U+001C..U+001F 与 U+0085，Python 的 strip 相反（D6）；用 `pyStrip`
//   2. 正则里的 `\s` `\S`                       —— 同上（D6）；用 `PY_WHITESPACE` 拼显式字符类（`[\s\S]` 这种「任意字符」写法除外）
//   3. 正则里的 `\w` `\W` `\b`                 —— Python 的 `\w` 认 Unicode 15 的字母数字，JS 的 `\w` 只认 ASCII（D5）；用 `[\p{L}\p{N}_]` 并带 `u`
//   4. 正则里的 `\d`                           —— Python 的 `\d` 认全角数字，JS 只认 ASCII（D4）；有意用 ASCII 的写 `[0-9]`，让意图可见
//   5. 正则标志 `m`                            —— `^` 认的行终止符与 Python 不同（D13）；用 `(?<![^\n])`
//   6. `.slice(0, <大写常量>)` 与 `.slice(0, <≥ 3 位的数字>)` —— Python 的 `s[:n]` 按码点，JS 的 slice 按 UTF-16 码元，BMP 之外的字符少取（D18）；
//      进判据的截取用 `headChars`。纯展示的截断（evidence 里的前 N 字）加 `// py-semantics-ok: 展示` 并说明。列表元素个数的 slice（`paths.slice(0, LIST_CAP)`）不是字符串切分，
//      同样加标注——**标注是让「我知道这里在切什么」可见**，不是绕过。
//   7. `process.exit(`                          —— 它同步结束进程、接不住（Python 的 `sys.exit` 抛 `SystemExit`，汇总层能转未定；Node 里没有对应物）。
//      检查器里出现它，一个检查器就能把整次扫描连同其它检查器的结论一起带走（设计 §12.31 取舍 3）。**这条还扫 src/checks/ 与汇总层**
//      （check_all.ts、main.ts、selftest*.ts）；唯一该设退出码的地方是 cli.ts，且用 `process.exitCode =`（不立即结束）。
// 例外：写在**注释里**的不算；确有理由的在那一行末尾加 `// py-semantics-ok: 理由`（理由必填）。
//
// 用法：node scripts/check-py-semantics.mjs        退出码 0 通过、1 有违规、2 脚本自己跑不了
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'src', 'core')

/** 去掉行内注释与字符串内容，只留代码骨架——粗但够用：本仓 src/core 不用多行模板字符串里的 `//`。 */
function stripLine(line) {
  let out = '', q = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '\\') { i++; out += '  '; continue } if (c === q) q = null; out += q ? ' ' : c; continue }
    if (c === "'" || c === '"') { q = c; out += c; continue }
    if (c === '/' && line[i + 1] === '/') break
    out += c
  }
  return out
}

const RULES = [
  { id: 'process-exit', re: /\bprocess\.exit\s*\(/, scope: 'wide', why: '`process.exit()` 同步结束进程、接不住：检查器崩溃只许表现为抛异常，汇总层才能转未定（设计 §12.31 取舍 3）；要设退出码用 `process.exitCode =`（只在 cli.ts）' },
  { id: 'trim', re: /\.(trim|trimStart|trimEnd)\(/, why: 'JS 的 trim 与 Python 的 strip 空白集合不同（D6）；用 pyStrip' },
  { id: 'slice-cu', re: /\.slice\(\s*0\s*,\s*([A-Z][A-Z0-9_]*|[0-9]{3,})\s*\)/, why: '`.slice(0, N)` 按 UTF-16 码元截，Python 的 `[:N]` 按码点（D18）；进判据的截取用 headChars，展示用的加 `// py-semantics-ok: 展示`' },
]
// 正则字面量与 new RegExp 里的转义要在**字符串/正则内部**看，所以对原行（只去掉 // 注释）另做一遍
const REGEX_RULES = [
  { id: 'regex-\\s', re: /\\[sS]/, why: '`\\s`/`\\S` 与 Python 的空白集合不同（D6）；用 PY_WHITESPACE 拼显式字符类', allow: /\[\\s\\S\]/ },
  { id: 'regex-\\w', re: /\\[wWbB]/, why: '`\\w`/`\\W`/`\\b` 与 Python 的 Unicode 单词字符不同（D5）；用 [\\p{L}\\p{N}_] 并带 u 标志' },
  { id: 'regex-\\d', re: /\\[dD]/, why: '`\\d` 只认 ASCII 而 Python 认全角数字（D4）；有意用 ASCII 就写 [0-9] 让意图可见' },
  { id: 'regex-flag-m', re: /(\/[^\/\n]+\/[a-z]*m[a-z]*\b)|(new RegExp\([^)]*,\s*['"`][a-z]*m[a-z]*['"`]\))/, why: '`m` 标志下 ^ 认的行终止符与 Python 不同（D13）；用 (?<![^\\n])' },
]

function stripComment(line) {
  let q = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '\\') { i++; continue } if (c === q) q = null; continue }
    if (c === "'" || c === '"' || c === '`') { q = c; continue }
    if (c === '/' && line[i + 1] === '/' && !(i > 0 && line[i - 1] === ':')) return line.slice(0, i)
  }
  return line
}

let files
try { files = readdirSync(dir).filter((f) => f.endsWith('.ts')).sort() } catch (e) { console.error('读不了 src/core：' + e.message); process.exit(2) }
// 宽档：src/checks 与汇总层只跑 scope==='wide' 的规则（目前只有 process-exit）。cli.ts 不在内——它是唯一设退出码的地方（用 process.exitCode）。
const srcDir = join(root, 'src')
const WIDE_TOP = ['check_all.ts', 'main.ts', 'selftest.ts', 'selftest_shared.ts', 'selftest_git.ts']
const wide = []
try {
  for (const f of readdirSync(join(srcDir, 'checks')).filter((x) => x.endsWith('.ts')).sort()) wide.push(['checks/' + f, join(srcDir, 'checks', f)])
} catch { /* 没有 src/checks（如测试里的最小临时仓）就只扫 core */ }
for (const f of WIDE_TOP) { const p = join(srcDir, f); try { readFileSync(p); wide.push([f, p]) } catch { /* 没有就不扫 */ } }
const bad = []
const targets = [...files.map((f) => [f, join(dir, f), false]), ...wide.map(([f, p]) => [f, p, true])]
for (const [f, path, onlyWide] of targets) {
  const lines = readFileSync(path, 'utf8').split('\n')
  let inBlock = false
  lines.forEach((raw, i) => {
    const t = raw.trim()
    if (inBlock) { if (t.includes('*/')) inBlock = false; return }
    if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return }
    if (t.startsWith('//') || t.startsWith('*')) return
    const ok = /py-semantics-ok:\s*\S/.exec(raw)
    if (/py-semantics-ok/.test(raw) && !ok) { bad.push(`${f}:${i + 1}  py-semantics-ok 必须写理由：${t.slice(0, 80)}`); return }
    if (ok) return
    const code = stripComment(raw)
    const skeleton = stripLine(raw)
    for (const r of RULES) if ((!onlyWide || r.scope === 'wide') && r.re.test(skeleton)) bad.push(`${f}:${i + 1}  [${r.id}] ${r.why}\n      ${t.slice(0, 120)}`)
    if (onlyWide) return
    for (const r of REGEX_RULES) {
      const probe = r.allow ? code.replace(r.allow, '') : code
      if (r.re.test(probe)) bad.push(`${f}:${i + 1}  [${r.id}] ${r.why}\n      ${t.slice(0, 120)}`)
    }
  })
}
if (bad.length) { console.error(`src 里有 ${bad.length} 处可能悄悄偏离 Python 语义（或会带走整次扫描）的写法：\n` + bad.join('\n')); process.exit(1) }
console.log(`src/core 无偏离 Python 语义的写法（扫了 ${files.length} 个文件；另扫 ${wide.length} 个检查器与汇总层文件的 process.exit）`)
