#!/usr/bin/env node
// 把一个黄金夹具（JSON）里的若干「表」原样写成可读的 JS 用例表（test/cases/<名字>.mjs），期望值逐条保留。
// 用于提炼流程的第一步（无损搬出）；是否再精简由变异对比（scripts/mutate-compare.mjs）裁判，不由本脚本决定。
//
// 用法：node scripts/fixture-to-cases.mjs <夹具.json> <输出.mjs> <说明> <导出名=路径> [<导出名=路径> ...]
//   路径：夹具里的键路径，如 cases、parse、blame_text.basic；该处必须是数组。
// 例：node scripts/fixture-to-cases.mjs test/fixtures/pystr.json test/cases/pystr.mjs "pyStr 的 repr 规则" CASES=cases
//
// 字面量写法：字符串里的控制字符、BOM、各种空白、代理区一律写成 \uXXXX（肉眼可见、编辑器不会悄悄改），其余照原样；
// 自动识别「某字符重复 N 次」的长字符串（≥60 个同一字符）写成 'x'.repeat(N)，保持文件可读。
import { readFileSync, writeFileSync } from 'node:fs'

const [src, dst, doc, ...pairs] = process.argv.slice(2)
if (!src || !dst || !doc || !pairs.length) { console.error('用法：node scripts/fixture-to-cases.mjs <夹具.json> <输出.mjs> <说明> <导出名=路径>…'); process.exit(2) }
const gold = JSON.parse(readFileSync(src, 'utf8'))

const ESC = (c) => c < 0x20 || (c >= 0x7f && c <= 0xa0) || (c >= 0x2000 && c <= 0x200f) || (c >= 0x2028 && c <= 0x202f) || c === 0x3000 || c === 0xfeff || c === 0x1680 || c === 0x180e || c === 0x205f || (c >= 0xd800 && c <= 0xdfff)
function str(s) {
  const rep = /^(.*?)((.)\3{59,})(.*)$/su.exec(s)
  if (rep) return `${str(rep[1])} + ${str(rep[3])}.repeat(${[...rep[2]].length}) + ${str(rep[4])}`.replace(/^'' \+ /, '').replace(/ \+ ''$/, '')
  let o = "'"
  for (const ch of s) {
    const c = ch.codePointAt(0)
    if (ch === "'") o += "\\'"; else if (ch === '\\') o += '\\\\'; else if (ch === '\n') o += '\\n'; else if (ch === '\r') o += '\\r'; else if (ch === '\t') o += '\\t'
    else if (ESC(c)) o += c > 0xffff ? `\\u{${c.toString(16)}}` : '\\u' + c.toString(16).padStart(4, '0')
    else o += ch
  }
  return o + "'"
}
const lit = (v) => v === null ? 'null' : v === undefined ? 'undefined' : typeof v === 'string' ? str(v) : Array.isArray(v) ? '[' + v.map(lit).join(', ') + ']'
  : typeof v === 'object' ? '{ ' + Object.entries(v).map(([k, x]) => `${key(k)}: ${lit(x)}`).join(', ') + ' }' : String(v)
// 对象字面量里 `__proto__: x` 设置的是原型而不是自有属性（实测：yaml 夹具里「配置写 __proto__ 键」的期望因此悄悄变成 {}）——必须写成计算属性 ['__proto__']
function key(k) { return k === '__proto__' ? "['__proto__']" : /^[A-Za-z_$][\w$]*$/.test(k) ? k : str(k) }

const at = (path) => path.split('.').reduce((o, k) => o?.[k], gold)
let out = `// ${doc}\n// 行为规格：各函数在各输入上应有的返回值。最初取自迁移期对 Python 版的实测（原为 ${src.replace(/^.*[\\/]/, '')}），Python 版与生成脚本已删除；\n// 今后行为有意改变时手工改这里的期望值并说明原因。提炼的验收见 scripts/mutate-compare.mjs（变异清单每条的结局不许变坏）。\n`
for (const p of pairs) {
  const [name, path] = p.split('=')
  const rows = at(path)
  if (Array.isArray(rows)) out += `\n/** ${path}（${rows.length} 条） */\nexport const ${name} = [\n${rows.map((r) => '  ' + lit(r) + ',').join('\n')}\n]\n`
  else if (rows && typeof rows === 'object') out += `\n/** ${path}（${Object.keys(rows).length} 项） */\nexport const ${name} = {\n${Object.entries(rows).map(([k, v]) => `  ${key(k)}: ${lit(v)},`).join('\n')}\n}\n`
  else if (typeof rows === 'string' || typeof rows === 'number' || typeof rows === 'boolean') out += `\n/** ${path} */\nexport const ${name} = ${lit(rows)}\n`
  else { console.error(`${path} 取不到（${rows}）`); process.exit(2) }
}
writeFileSync(dst, out)
console.log(`已写 ${dst}：${pairs.length} 张表，${out.length} 字符（原 ${readFileSync(src).length} 字节）`)
