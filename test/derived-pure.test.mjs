// derived 检查器的纯函数对 Python 版黄金样本（golden/unit/derived.json）逐条比对：mentions、headerDeclares、headerGenerationHint、headerOfBytes、decodeUtf8Ignore。
// 为什么要这份样本：4 个真实仓都没有声明 `derived:`（只出一条 SKIP），真实仓比对对这个检查器几乎没有覆盖力；判据只靠 selftest 与这里的样本守护。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mentions, headerDeclares, headerGenerationHint, headerOfBytes } from '../lib/checks/derived.js'
import { decodeUtf8Ignore } from '../lib/core/utf8.js'

const here = dirname(fileURLToPath(import.meta.url))
const gold = JSON.parse(readFileSync(join(here, '..', 'golden', 'unit', 'derived.json'), 'utf8'))
const bytesOf = (hex) => Buffer.from(hex, 'hex')

test('样本规模', () => assert.ok(gold.mentions.length >= 60 && gold.declares.length >= 35 && gold.hint.length >= 45 && gold.header_bytes.length >= 45 && gold.decode_ignore.length >= 40))

test('mentions：全部输入对 Python 逐条一致（ASCII 边界、扩展名不算、句末句号照认、中文紧贴照认、正则元字符按字面、非 ASCII 字母数字不当边界）', () => {
  const wrong = gold.mentions.filter((g) => mentions(g.low, g.name) !== g.out).map((g) => ({ low: g.low, name: g.name, want: g.out, got: mentions(g.low, g.name) }))
  assert.deepEqual(wrong, [])
})

test('headerDeclares：全部输入对 Python 逐条一致（源路径、源文件名、source_rev 三个标记；反斜杠换斜杠；lower 对 İ/K）', () => {
  const wrong = gold.declares.filter((g) => headerDeclares(g.header, g.src) !== g.out).map((g) => ({ header: g.header, src: g.src, want: g.out, got: headerDeclares(g.header, g.src) }))
  assert.deepEqual(wrong, [])
})

test('headerGenerationHint：全部输入对 Python 逐条一致（生成器署名先于生成措辞；行号按 Python 的行终止符；原文行 strip 后取前 200 个**码点**）', () => {
  const wrong = gold.hint.filter((g) => JSON.stringify(headerGenerationHint(g.in)) !== JSON.stringify(g.out)).map((g) => ({ in: g.in.slice(0, 40), want: g.out, got: headerGenerationHint(g.in) }))
  assert.deepEqual(wrong.slice(0, 3), [], `不一致共 ${wrong.length} 条`)
})

test('headerOfBytes：全部输入对 Python 逐条一致（NUL 判二进制；无效 UTF-8 序列整个丢掉；前 30 行；\\x0c \\u2028 \\r 都是行终止符；BOM 保留）', () => {
  const wrong = []
  for (const g of gold.header_bytes) {
    const [text, why] = headerOfBytes(bytesOf(g.hex))
    const got = { binary: text === null, text }
    if (JSON.stringify(got) !== JSON.stringify({ binary: g.binary, text: g.text })) wrong.push({ hex: g.hex.slice(0, 40), want: { binary: g.binary, text: g.text }, got, why })
  }
  assert.deepEqual(wrong.slice(0, 3), [], `不一致共 ${wrong.length} 条`)
})

test('decodeUtf8Ignore：全部输入对 Python 的 decode("utf-8","ignore") 逐条一致——原文自带的 U+FFFD 保留、开头 BOM 保留（Node 的宽松 TextDecoder 两处都不一致）', () => {
  const wrong = gold.decode_ignore.filter((g) => decodeUtf8Ignore(bytesOf(g.hex)) !== g.out).map((g) => ({ hex: g.hex, want: g.out, got: decodeUtf8Ignore(bytesOf(g.hex)) }))
  assert.deepEqual(wrong, [])
  // 对照：Node 的宽松解码确实在这两处与 Python 不同，所以 decodeUtf8Ignore 不能写成它的包装
  const loose = (b) => new TextDecoder('utf-8', { fatal: false }).decode(b).replaceAll('\ufffd', '')
  assert.notEqual(loose(Buffer.from([0xef, 0xbf, 0xbd])), decodeUtf8Ignore(Buffer.from([0xef, 0xbf, 0xbd])), '原文自带 U+FFFD：宽松解码 + 去 U+FFFD 会误伤')
  assert.notEqual(loose(Buffer.from([0xef, 0xbb, 0xbf, 0x68])), decodeUtf8Ignore(Buffer.from([0xef, 0xbb, 0xbf, 0x68])), '开头 BOM：Node 默认吞掉，Python 保留')
})
