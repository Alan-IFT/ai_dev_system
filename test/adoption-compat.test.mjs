// adoption 检查器唯一剩下的纯函数 compatibility 对 Python 版黄金样本（golden/unit/adoption.json）逐条比对。
// 原先同目录有一份 adoption-pure 还比对 parse／rawHead（STANDARD_VERSION 的解析），随版本记录判据一起移除（设计 §12.33）；样本里的 parse 部分不再被读。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compatibility } from '../lib/checks/adoption.js'

const here = dirname(fileURLToPath(import.meta.url))
const gold = JSON.parse(readFileSync(join(here, 'fixtures', 'adoption.json'), 'utf8'))

test('样本规模', () => assert.ok(gold.compat.length >= 24 && gold.compat_shapes.length >= 10))

test('compatibility：全部 policy 值对 Python 逐条一致（状态、evidence、reason）——0 与 0.0 不算缺，只有 None、false、空串、空列表、空映射算缺', () => {
  const wrong = gold.compat.filter((g) => { const f = compatibility({ compatibility: { policy: g.policy } }); return f.status !== g.status || f.evidence !== g.evidence || f.reason !== g.reason }).map((g) => ({ policy: g.policy, want: [g.status, g.evidence], got: (() => { const f = compatibility({ compatibility: { policy: g.policy } }); return [f.status, f.evidence] })() }))
  assert.deepEqual(wrong.slice(0, 3), [], `不一致共 ${wrong.length} 条`)
})

test('compatibility：配置形态（无键、不是映射、_path 的各种取值）对 Python 逐条一致——where 取 _path 的 str()，假值回落默认', () => {
  const wrong = gold.compat_shapes.filter((g) => { const f = compatibility(g.cfg); return f.status !== g.status || f.where !== g.where || f.reason !== g.reason || f.evidence !== g.evidence }).map((g) => ({ name: g.name, want: [g.status, g.where], got: (() => { const f = compatibility(g.cfg); return [f.status, f.where] })() }))
  assert.deepEqual(wrong, [])
})
