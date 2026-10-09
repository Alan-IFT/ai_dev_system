// 汇总层的慢测试：真实检查器表（10 个检查器）下 main 整条路径跑一遍。与 check-all.test.mjs 分开，是因为变异验证每条变异都要重跑测试文件，
// 这一条要 20 多秒，放进去 156 条变异会多出一小时。它钉的是「装配没坏」（注册表、入口、渲染连起来能跑），不钉各分支——各分支在 check-all.test.mjs 里用假检查器表钉。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../lib/main.js'

test('main：真实检查器表下整条路径跑得通：退出码合法、输出含身份行与覆盖边界', () => {
  const root = mkdtempSync(join(tmpdir(), 'cafull-'))
  try {
    mkdirSync(join(root, 'governance'))
    writeFileSync(join(root, 'governance', 'project.yaml'), 'tier: L0\nlayout:\n  entry:\n    - AGENTS.md\n')
    writeFileSync(join(root, 'AGENTS.md'), '# x\n')
    const out = [], code = main([root], undefined, { out: (t) => out.push(t), err: () => {} })
    const text = out.join('\n')
    assert.ok([0, 1, 2].includes(code))
    assert.match(text, /检查器身份 · sha256:/); assert.match(text, /覆盖边界/); assert.match(text, /结论：/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})