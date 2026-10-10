// drift 检查器的纯函数对 Python 版黄金样本（golden/unit/drift.json）逐条比对：candidates、revisionHits、indexTarget、latestDay、parseBlame、WI 正则。
// 有意差异 D19（设计 §12.6）：`\d`、`\b` 里的非 ASCII 数字（全角、阿拉伯-印度）Python 认、TS 不认；样本里这几条（标注）单独断言，不计入逐条一致。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { candidates, revisionHits, indexTarget, latestDay, parseBlame, WI_PATTERN_FOR_TEST, WI_FIELD_PATTERN_FOR_TEST } from '../lib/checks/drift.js'
import { toIso } from '../lib/core/dates.js'
import { BLAME_HEAD, BLAME_TEXT, CANDIDATES, INDEX_TARGET, LATEST_DAY, REVISION_HITS, WI } from './cases/drift.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const gold = { blame_head: BLAME_HEAD, blame_text: BLAME_TEXT, candidates: CANDIDATES, index_target: INDEX_TARGET, latest_day: LATEST_DAY, revision_hits: REVISION_HITS, wi: WI }
const NON_ASCII_DIGIT = /[\uff10-\uff19\u0660-\u0669\u06f0-\u06f9]/
const rows = (l) => l.map((x) => [x[0], x[1]])

test('样本规模', () => assert.ok(gold.candidates.length >= 45 && gold.revision_hits.length >= 70 && gold.index_target.length >= 20 && gold.wi.length >= 45 && gold.latest_day.length >= 12 && Object.keys(gold.blame_text).length >= 20))

test('candidates：全部输入对 Python 逐条一致（窗口按码点：emoji 前缀不挤掉计划词、不挤出动作词；\\r \\x0c \\u2028 不是行终止符；动作词与计划词边界）；含非 ASCII 数字的是 D19', () => {
  const wrong = []
  for (const g of gold.candidates) {
    if (NON_ASCII_DIGIT.test(g.in)) continue
    const got = candidates(g.in)
    if (JSON.stringify(got) !== JSON.stringify(g.out)) wrong.push({ in: g.in.slice(0, 50), want: g.out, got })
  }
  assert.deepEqual(wrong.slice(0, 4), [], `不一致共 ${wrong.length} 条`)
})

test('D19：日期里的全角数字不被认（Python 的 `\\d` 认，候选里有 `２０２６-０９-２２ 裁定`）——TS 不报它，而只认 ASCII 日期', () => {
  const g = gold.candidates.find((x) => x.in === '２０２６-０９-２２ 裁定')
  assert.ok(g && g.out.length === 1, 'Python 把全角日期当候选')
  assert.deepEqual(candidates('２０２６-０９-２２ 裁定'), [])
  assert.deepEqual(candidates('2026-09-22 裁定'), [[1, '2026-09-22']])
})

test('candidates 窗口恰好按码点：计划词前面放 4/5/6 个 emoji 的三条（Python 实测）逐条一致——按码元会把计划词挤出窗口', () => {
  const E = '\u{1F600}'
  for (const pre of [4, 5, 6]) {
    const t = '计划' + E.repeat(pre) + '2026-12-08 裁定'
    assert.deepEqual(candidates(t), gold.candidates.find((x) => x.in === t).out, `emoji ${pre} 个`)
  }
  for (const post of [4, 5, 6, 9, 10]) {
    const t = '2026-09-22' + E.repeat(post) + '裁定'
    assert.deepEqual(candidates(t), gold.candidates.find((x) => x.in === t).out, `右侧 emoji ${post} 个`)
  }
})

test('revisionHits：全部输入对 Python 逐条一致（围栏开闭、标记词从第 0 个字符起、英文词只认标签形态、「修订后」不算、lstrip 字符集含全角空格、`s[:40]` 按码点）', () => {
  const wrong = gold.revision_hits.filter((g) => JSON.stringify(rows(revisionHits(g.in).map((h) => [h[0], h[1], h[2]]))) !== JSON.stringify(rows(g.out.map((h) => [h[0], h[1], h[2]]))))
    .map((g) => ({ in: g.in.slice(0, 40), want: g.out, got: revisionHits(g.in) }))
  assert.deepEqual(wrong.slice(0, 4), [], `不一致共 ${wrong.length} 条`)
  // 三元组整体比（含第三项标记词）
  const wrong3 = gold.revision_hits.filter((g) => JSON.stringify(revisionHits(g.in)) !== JSON.stringify(g.out))
  assert.deepEqual(wrong3.map((g) => g.in.slice(0, 40)), [])
})

test('indexTarget：「文件」列单元格对 Python 逐条一致（链接取括号内去锚点、反引号、.md 后缀不分大小写、不是路径返回 null）', () => {
  const wrong = gold.index_target.filter((g) => indexTarget(g.in) !== g.out).map((g) => ({ in: g.in, want: g.out, got: indexTarget(g.in) }))
  assert.deepEqual(wrong, [])
})

test('WI 正则：`\\bWI-\\d{3,}\\b` 与 `work_item_id` 首字段对 Python 逐条一致；含非 ASCII 数字或其紧邻的是 D19/D5 的单独断言', () => {
  const wrong = []
  for (const g of gold.wi) {
    if (NON_ASCII_DIGIT.test(g.in)) continue
    const got = { all: [...g.in.matchAll(WI_PATTERN_FOR_TEST)].map((m) => m[0]), field: (WI_FIELD_PATTERN_FOR_TEST.exec(g.in) ?? [])[1] ?? null }
    if (JSON.stringify(got) !== JSON.stringify({ all: g.all, field: g.field })) wrong.push({ in: g.in, want: { all: g.all, field: g.field }, got })
  }
  assert.deepEqual(wrong.slice(0, 5), [], `不一致共 ${wrong.length} 条`)
})

test('D19：WI 的数字部分只认 ASCII——`WI-００１`、`WI-001٣`、`WI-٣٤٥` Python 认（\\d），TS 不认；`WI-001٣` 在 TS 里 `WI-001` 后面紧跟阿拉伯数字（\\p{N}）所以也不是 ID 边界；`WI-0٣` 只有 2 位数字，两边都不认', () => {
  for (const s of ['WI-００１', 'WI-001٣', 'WI-٣٤٥']) {
    const g = gold.wi.find((x) => x.in === s)
    assert.ok(g && g.all.length === 1, `${s}：Python 认`)
    assert.deepEqual([...s.matchAll(WI_PATTERN_FOR_TEST)].map((m) => m[0]), [], `${s}：TS 不认`)
  }
  assert.deepEqual(gold.wi.find((x) => x.in === 'WI-0٣').all, [], 'Python 也不认（要 3 位以上）')
  assert.deepEqual([...'WI-0٣'.matchAll(WI_PATTERN_FOR_TEST)], [])
})

test('latestDay：对 Python 逐条一致（UTC+14 取日、不读机器时区、负数时间、浮点向零取整）；越界年份抛错（Python 抛 OverflowError）', () => {
  for (const g of gold.latest_day) {
    if (String(g.out).startsWith('CRASH:')) { assert.throws(() => latestDay(g.epoch), RangeError, `epoch ${g.epoch}`); continue }
    assert.equal(toIso(latestDay(g.epoch)), g.out, `epoch ${g.epoch}`)
  }
})

test('parseBlame：22 份手工 porcelain 文本对 Python 逐条一致（40/64 位 sha、全零未提交行、committer-time 只在首次出现时输出、缺 committer-time、CRLF、行头格式变体、浮点时间抛错）', () => {
  const wrong = []
  for (const [name, g] of Object.entries(gold.blame_text)) {
    // D19：行头里的行号是阿拉伯-印度数字——Python 的 `\d` 认，TS 的 `[0-9]` 不认；blame 的输出是 git 自己写的纯 ASCII，现实里不会出现，单独在下一条断言
    if (name === 'head_arabic_digit') continue
    let res = null, problem = null
    try {
      const [m, p] = parseBlame(g.in)
      res = m === null ? null : Object.fromEntries([...m].map(([k, [sha, d]]) => [String(k), [sha, d === null ? null : toIso(d)]]))
      problem = p
    } catch (e) { problem = 'CRASH:' + (e instanceof SyntaxError ? 'ValueError' : e.name) }
    if (JSON.stringify({ res, problem }) !== JSON.stringify({ res: g.res, problem: g.problem })) wrong.push({ name, want: { res: g.res, problem: g.problem }, got: { res, problem } })
  }
  assert.deepEqual(wrong.slice(0, 3), [], `不一致共 ${wrong.length} 份`)
})

test('D19：blame 行头里的行号只认 ASCII 数字（Python 的 `\\d` 连阿拉伯-印度数字也认）；这种行头不会由 git 产出，所以只是「不接受」而不是「错判」——整行当没有行头，该文件的候选行在 blame 结果里找不到 → 记 blame-line-missing 未定', () => {
  const g = gold.blame_text.head_arabic_digit
  assert.deepEqual(Object.keys(g.res), ['1'], 'Python 认')
  const [m, p] = parseBlame(g.in)
  assert.equal(p, null); assert.equal(m.size, 0, 'TS 不认')
})
