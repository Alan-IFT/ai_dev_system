// adoption 检查器的纯函数对 Python 版黄金样本（golden/unit/adoption.json）逐条比对：parse（STANDARD_VERSION 拆版本值、采用日期、键值对）、rawHead、compatibility。
// 为什么要这份样本：四个真实仓的 STANDARD_VERSION 都是整齐的实物形状，**边界写法（键写法、全角冒号、BOM、行终止符、中日文键、无冒号行、重复键）一个真实输入都没有**。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, rawHead, compatibility } from '../lib/checks/adoption.js'

const here = dirname(fileURLToPath(import.meta.url))
const gold = JSON.parse(readFileSync(join(here, '..', 'golden', 'unit', 'adoption.json'), 'utf8'))

test('样本规模', () => assert.ok(gold.parse.length >= 90 && gold.compat.length >= 24 && gold.compat_shapes.length >= 10))

test('parse：全部文本对 Python 逐条一致（版本值、采用日期、键值对；键的写法、冒号、BOM、行终止符、中日文键、无冒号行、重复键）', () => {
  const wrong = gold.parse.filter((g) => JSON.stringify(parse(g.in)) !== JSON.stringify([g.version, g.adopted, g.pairs])).map((g) => ({ in: g.in.slice(0, 40), want: [g.version, g.adopted, g.pairs], got: parse(g.in) }))
  assert.deepEqual(wrong.slice(0, 3), [], `不一致共 ${wrong.length} 条`)
})

test('rawHead：全部文本对 Python 逐条一致（非空行用「；」连、取前 200 个码点、空文件的写法）', () => {
  const wrong = gold.parse.filter((g) => rawHead(g.in) !== g.head).map((g) => ({ in: g.in.slice(0, 30), want: g.head.slice(0, 40), got: rawHead(g.in).slice(0, 40) }))
  assert.deepEqual(wrong.slice(0, 3), [], `不一致共 ${wrong.length} 条`)
})

test('compatibility：全部 policy 值对 Python 逐条一致（状态、evidence、reason）——0 与 0.0 不算缺，只有 None、false、空串、空列表、空映射算缺', () => {
  const wrong = gold.compat.filter((g) => { const f = compatibility({ compatibility: { policy: g.policy } }); return f.status !== g.status || f.evidence !== g.evidence || f.reason !== g.reason }).map((g) => ({ policy: g.policy, want: [g.status, g.evidence], got: (() => { const f = compatibility({ compatibility: { policy: g.policy } }); return [f.status, f.evidence] })() }))
  assert.deepEqual(wrong.slice(0, 3), [], `不一致共 ${wrong.length} 条`)
})

test('compatibility：配置形态（无键、不是映射、_path 的各种取值）对 Python 逐条一致——where 取 _path 的 str()，假值回落默认', () => {
  const wrong = gold.compat_shapes.filter((g) => { const f = compatibility(g.cfg); return f.status !== g.status || f.where !== g.where || f.reason !== g.reason || f.evidence !== g.evidence }).map((g) => ({ name: g.name, want: [g.status, g.where], got: (() => { const f = compatibility(g.cfg); return [f.status, f.where] })() }))
  assert.deepEqual(wrong, [])
})
