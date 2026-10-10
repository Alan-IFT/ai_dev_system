// single_authority 检查器的纯函数对 Python 版黄金样本（golden/unit/single-authority.json）逐条比对：effectiveChars、isDoc、isStructural、unfenced、significantLines/proseLines、
// maskLinks、序数前缀、countClaims（单行）、stripDotSlash。
// 为什么要这份样本：四个真实仓对这个检查器覆盖很强（pmc 20 条 count-claim），但**真实仓里没有 emoji、\x1c、\u2028、前导零编号、全角数字这类输入**。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { effectiveChars, isDoc, isStructural, unfenced, significantLines, proseLines, maskLinks, RE_ORDINAL_PREFIX, countClaims, stripDotSlash } from '../lib/checks/single_authority.js'

const here = dirname(fileURLToPath(import.meta.url))
const gold = { effective_chars: EFFECTIVE_CHARS, is_doc: IS_DOC, is_structural: IS_STRUCTURAL, unfenced: UNFENCED, significant: SIGNIFICANT, mask_links: MASK_LINKS, ordinal: ORDINAL, count_claims: COUNT_CLAIMS, lstrip_dotslash: LSTRIP_DOTSLASH }
const bad = (arr, f) => arr.filter((g) => JSON.stringify(f(g)) !== JSON.stringify(g.out)).map((g) => ({ in: String(g.in).slice(0, 40), want: g.out, got: f(g) }))

test('样本规模', () => assert.ok(gold.effective_chars.length >= 70 && gold.is_doc.length >= 50 && gold.is_structural.length >= 90 && gold.unfenced.length >= 37 && gold.significant.length >= 37 && gold.mask_links.length >= 28 && gold.ordinal.length >= 23 && gold.count_claims.length >= 120 && gold.lstrip_dotslash.length >= 18))

test('effectiveChars：全部输入对 Python 逐条一致（半角与全角标点、Python 空白集合——含 \\x1c \\x85，不含 U+200B U+FEFF；emoji 与 CJK 保留）', () => assert.deepEqual(bad(gold.effective_chars, (g) => effectiveChars(g.in)).slice(0, 3), []))
test('isDoc：全部路径对 Python 的 os.path.splitext 逐条一致（开头的点不算后缀、目录名带点不算、反斜杠先归一、后缀小写比较）', () => assert.deepEqual(bad(gold.is_doc, (g) => isDoc(g.in)).slice(0, 3), []))
test('isStructural：全部行对 Python 逐条一致（标题 0–3 空格缩进、分隔线、表格分隔行、纯链接行、裸 URL）', () => assert.deepEqual(bad(gold.is_structural, (g) => isStructural(g.in)).slice(0, 3), []))
test('unfenced：全部文本对 Python 逐条一致（行内 ```x``` 不开围栏、长围栏只被同字符不短于它的行闭合、未闭合到文尾、行终止符）', () => assert.deepEqual(bad(gold.unfenced, (g) => unfenced(g.in)).slice(0, 3), []))
test('significantLines：全部文本对 Python 逐条一致（去代码块、空行、纯标点行、结构行；空白折成单个空格）', () => assert.deepEqual(bad(gold.significant, (g) => significantLines(g.in)).slice(0, 3), []))
test('proseLines：全部文本对 Python 逐条一致（只去代码块与空行，保留原文）', () => {
  const wrong = gold.significant.filter((g) => JSON.stringify(proseLines(g.in)) !== JSON.stringify(g.prose)).map((g) => ({ in: g.in.slice(0, 40), want: g.prose, got: proseLines(g.in) }))
  assert.deepEqual(wrong.slice(0, 3), [], `不一致共 ${wrong.length} 条`)
})
test('maskLinks：全部行对 Python 逐条一致（链接换成等长空格，按**码点**数——含 emoji 的链接）', () => assert.deepEqual(bad(gold.mask_links, (g) => maskLinks(g.in)).slice(0, 3), []))
test('序数前缀：全部行的 [起点, 终点] 对 Python 逐条一致（终点是**码元下标**，行里有 emoji 时与 Python 的码点下标不同，但与同一正则的数值起点比较仍然自洽——由 countClaims 的样本钉住）', () => {
  const got = (s) => [...s.matchAll(RE_ORDINAL_PREFIX)].map((o) => [o.index, o.index + o[0].length])
  const cp = (s, i) => [...s.slice(0, i)].length // 码元下标 → 码点下标，只为与 Python 的样本比
  const wrong = gold.ordinal.filter((g) => JSON.stringify(got(g.in).map(([a, b]) => [cp(g.in, a), cp(g.in, b)])) !== JSON.stringify(g.out)).map((g) => ({ in: g.in, want: g.out, got: got(g.in) }))
  assert.deepEqual(wrong.slice(0, 3), [], `不一致共 ${wrong.length} 条`)
})
test('countClaims：全部行对 Python 逐条一致（键 = [数字去逗号, 量词, 名词前两个码点]；序数排除；链接遮盖；千分位；前导零；emoji 前后；\\x1c 是行终止符）', () => {
  const run = (line) => [...countClaims([0, 1, 2].map((i) => [`k${i}.md`, line, null])).values()].map((v) => [[...v.key], v.places.get('k0.md')[0], v.places.get('k0.md')[1]]).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))
  const wrong = gold.count_claims.filter((g) => JSON.stringify(run(g.in)) !== JSON.stringify([...g.out].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)))).map((g) => ({ in: g.in.slice(0, 40), want: g.out, got: run(g.in) }))
  assert.deepEqual(wrong.slice(0, 3), [], `不一致共 ${wrong.length} 条`)
})
test('stripDotSlash：全部路径对 Python 的 lstrip("./") 逐条一致（字符集，不是前缀：`.gitignore` 去成 `gitignore`）', () => assert.deepEqual(bad(gold.lstrip_dotslash, (g) => stripDotSlash(g.in.replaceAll('\\', '/'))).slice(0, 3), []))

// ---- duplicateBlocks / identicalFiles 的整体行为：直接喂 files（绕过 git 的次序），期望值取自 Python 版同输入的实测 ----
import { duplicateBlocks, identicalFiles } from '../lib/checks/single_authority.js'
import { EFFECTIVE_CHARS, IS_DOC, IS_STRUCTURAL, UNFENCED, SIGNIFICANT, MASK_LINKS, ORDINAL, COUNT_CLAIMS, LSTRIP_DOTSLASH } from './cases/single-authority.mjs'
const SHARED3 = '退款口径由结算模块单独维护别处引用它的接口而不抄写规则。\n抄写会在下一次口径变化时留下一份不会更新的旧值。\n因此本节只给出指针具体数值到结算模块文档去读。\n'
const own = (k) => `# 文${k}\n独占${k}篇甲一说明此文件专属内容。\n独占${k}篇乙二说明此文件专属内容。\n`
const mkf = (pairs) => pairs.map(([n, t]) => [n, t, Buffer.from(t, 'utf8')])

test('duplicateBlocks：出现位置按文件路径的码点序排，不是 files 的传入次序、也不是码元序（变异 J20、J22）；同文件两处按行号升序（变异 J21）', () => {
  assert.deepEqual(duplicateBlocks(mkf([['b.md', own('一') + SHARED3], ['a.md', own('二') + SHARED3]]), 3, 60, new Set()).map((x) => x.places), [[['a.md', 4], ['b.md', 4]]])
  assert.deepEqual(duplicateBlocks(mkf([['😀.md', own('三') + SHARED3], ['～.md', own('四') + SHARED3]]), 3, 60, new Set()).map((x) => x.places), [[['～.md', 4], ['😀.md', 4]]], '～ U+FF5E 在 😀 U+1F600 之前（码元序 0xD83D 小于 0xFF5E，相反）')
  assert.deepEqual(duplicateBlocks(mkf([['a.md', own('五') + SHARED3 + '间隔' + '甲'.repeat(30) + '\n' + SHARED3]]), 3, 60, new Set()), [], '单个文件内的重复不算跨文件')
  assert.deepEqual(duplicateBlocks(mkf([['a.md', own('六') + SHARED3 + own('七') + SHARED3], ['b.md', own('八') + SHARED3]]), 3, 60, new Set()).map((x) => x.places), [[['a.md', 4], ['a.md', 10], ['b.md', 4]]])
})

test('duplicateBlocks：首行取**遍历次序里第一个**出现位置的（变异 J23）；有效行数不足窗口的文件跳过（变异 J2）；skipRels 里的文件不参与（变异 J1）', () => {
  const r = duplicateBlocks(mkf([['z.md', own('九') + SHARED3], ['a.md', own('十') + SHARED3.replace('退款', '回款')]]), 2, 20, new Set())
  assert.deepEqual(r.map((x) => [x.length, x.first.slice(0, 6), x.places]), [[2, '抄写会在下一', [['a.md', 5], ['z.md', 5]]]])
  assert.deepEqual(duplicateBlocks(mkf([['a.md', '只有一行足够长的内容用来占位凑数。\n'], ['b.md', '只有一行足够长的内容用来占位凑数。\n']]), 3, 10, new Set()), [])
  const t2 = '第一行足够长的内容用来凑数一二三。\n第二行足够长的内容用来凑数四五六。\n'
  assert.deepEqual(duplicateBlocks(mkf([['a.md', t2], ['b.md', t2]]), 3, 10, new Set()), [], '只有 2 行有效文本，窗口要 3 行：跳过（minLines 取 3；若不跳过，窗口越界不会报，但下游变异可见）')
  assert.deepEqual(duplicateBlocks(mkf([['a.md', own('十一') + SHARED3], ['b.md', own('十二') + SHARED3]]), 3, 60, new Set(['b.md'])), [], 'b 被跳过后只剩一个文件')
})

test('countClaims：同一数值声明至少出现在 3 个文件才成组——2 个文件不成（变异 L10、L11；Windows 上被真实仓比对顺带抓住、Ubuntu 上没有，所以直接断言）', () => {
  const l = '共有 192 份归档记录\n'
  assert.equal(countClaims([['a.md', l, null], ['b.md', l, null]]).size, 0)
  assert.equal(countClaims([['a.md', l, null], ['b.md', l, null], ['c.md', l, null]]).size, 1)
  assert.equal(countClaims([['a.md', l, null]]).size, 0, '一个文件更不成')
})

test('identicalFiles：组内路径按码点升序（变异 I7、I8）', () => {
  const body = '这是内容相同的一份文档文本，足够长以便超过有效字符下限二十个字。\n'
  assert.deepEqual([...identicalFiles(mkf([['😀.md', body], ['～.md', body], ['a.md', body]])).values()], [['a.md', '～.md', '😀.md']])
})
