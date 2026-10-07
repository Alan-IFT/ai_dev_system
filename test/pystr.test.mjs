// core/cfg.ts 的 pyStr 对 Python `str(x)` 的黄金样本逐条比对（golden/unit/pystr.json）。
// 起因：adoption 迁移时发现映射值走了 JSON.stringify（`{"d":3}`），Python 是 `{'d': 3}`——此前所有调用点传进来的都是标量或列表，没有暴露。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pyStr } from '../lib/core/cfg.js'

const here = dirname(fileURLToPath(import.meta.url))
const gold = JSON.parse(readFileSync(join(here, '..', 'golden', 'unit', 'pystr.json'), 'utf8'))

test('样本规模', () => assert.ok(gold.cases.length >= 60))

test('pyStr：全部输入对 Python 的 str() 逐条一致（标量、列表、映射、嵌套、空容器、含引号的字符串）', () => {
  const wrong = gold.cases.filter((g) => pyStr(g.in) !== g.out).map((g) => ({ in: g.in, want: g.out, got: pyStr(g.in) }))
  assert.deepEqual(wrong.slice(0, 3), [], `不一致共 ${wrong.length} 条`)
})

test('映射不能走 JSON.stringify：`{d: 3}` 是 `{\'d\': 3}`，不是 `{"d":3}`（引号、冒号后空格、None）', () => {
  assert.equal(pyStr({ d: 3 }), "{'d': 3}")
  assert.equal(pyStr({ k: null }), "{'k': None}")
  assert.equal(pyStr({ k: "it's" }), '{\'k\': "it\'s"}', '含单引号且不含双引号的值用双引号包')
})
