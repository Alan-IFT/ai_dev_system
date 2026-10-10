// scripts/repo-counts.mjs（重算会漂移的计数）的验收测试。
// 迁移时与 Python 版（docs/附录-载体实例/repo_counts.py）在本仓真实数据上逐行对拍过，输出一致；Python 版已删除。
// 这里不钉具体数值（那正是这个脚本存在的理由：数会漂）——钉的是输出的"形状"与各项的内部一致性，以及对失败 Case 表的解析口径。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const REAL = join(here, '..', 'scripts', 'repo-counts.mjs')
const tmps = []
test.after(() => { for (const t of tmps) rmSync(t, { recursive: true, force: true, maxRetries: 3 }) })

/** 在一个最小的临时仓里跑一份拷贝（脚本按自身位置推仓根，所以要把它放进去）。 */
function runIn(files) {
  const root = mkdtempSync(join(tmpdir(), 'rc-')); tmps.push(root)
  const g = (...a) => { const r = spawnSync('git', ['-C', root, '-c', 'core.autocrlf=false', ...a], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(a.join(' ') + r.stderr) }
  g('init', '-q')
  for (const [rel, body] of Object.entries(files)) { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body) }
  // 脚本 import 的是 ../lib/…：把真实的 lib 与脚本一并拷进临时仓
  const cp = (rel) => spawnSync(process.execPath, ['-e', `require('fs').cpSync(${JSON.stringify(join(here, '..', rel))}, ${JSON.stringify(join(root, rel))}, { recursive: true })`])
  cp('lib'); cp('scripts/repo-counts.mjs'); cp('package.json')
  g('add', '-A', '-f')
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'repo-counts.mjs')], { cwd: root, encoding: 'utf8' })
  return { rc: r.status, out: r.stdout.replaceAll('\r\n', '\n'), err: r.stderr }
}

const LOG = '# 日志\n\n## 生效登记表\n\n| D-001 | 试行 | x |\n| D-002 | **已接受** | x |\n| D-003 | 提议 | x |\n\n## 决策索引\n\n| D-001 | a |\n| D-002 | b |\n| D-003 | c |\n'
const CASES_HDR = '| id | 失败 | 等级 | 规则 | 拦住了吗 | 处置 | 备注 |\n| --- | --- | --- | --- | --- | --- | --- |\n'
const base = () => ({
  'docs/00-总览.md': '# 总览\n\n- **P1** a\n',
  'docs/10-章.md': '# 章\n\n- **P1** a\n- **P2** b\n',
  'docs/追溯账本.md': '1\n2\n3\n',
  'docs/决策日志.md': LOG,
  'docs/失败Case清单.md': '# Case\n\n' + CASES_HDR + '| C-001 | f | A | [10 §1 P1](10-章.md) | 否 | x | y |\n| C-002 | f | **B** | 无对应原则——见 10 §1 P2 | 是 | x | y |\n| C-003 | f | A | 10-P2 | 不适用——x | x | y |\n',
})

test('输出六行 + 空行 + 指引；各项的内部一致性（已绑 + 未绑 = 总数）', () => {
  const r = runIn(base()); assert.equal(r.rc, 0, r.err)
  const L = r.out.split('\n')
  assert.match(L[0], /^正文 {8}2 文件 \/ \d+ 行 \/ \d+ 字符 \/ 3 条原则$/)
  assert.equal(L[1], '追溯账本    3 行（效力为零）')
  assert.equal(L[2], '决策        3 条，生效 2 条（D-001、D-002）')   // **已接受** 带强调标记也算生效（C-023 同形问题）
  assert.match(L[3], /^markdown {4}\d+ 个文件 \/ \d+ 条本地链接$/)
  assert.equal(L[4], '失败 Case    3 条（等级 A=2、B=1；被拦住了吗 不适用=1、否=1、是=1）')
  assert.equal(L[5], '已绑定原则  2 条 / 共 3 条（未绑 1，33%）；已被证明有实例的章：10')   // "无对应原则"开头的那格不产生绑定（C-042）
  assert.equal(L[6], ''); assert.match(L[7], /std-check/)
})

test('失败 Case 表：等级格剥强调标记（**B** 与 B 同档）；"被拦住了吗"取整格前缀而不是首字符（不适用 ≠ 不）', () => {
  const r = runIn(base()); assert.match(r.out, /等级 A=2、B=1/); assert.match(r.out, /不适用=1/); assert.doesNotMatch(r.out, /不=\d/)
})

test('失败 Case 表：切出的列数少于 7 个 → 报错退出，不静默少算（2026-09-04 核查指出的口径洞）；边界按 Python 版实测：5 个单元格（含首尾空串共 7 段）仍算够', () => {
  const short = runIn({ ...base(), 'docs/失败Case清单.md': '# Case\n\n| C-001 | f | A | 规则 |\n' })   // 4 个单元格 → 6 段
  assert.notEqual(short.rc, 0); assert.match(short.err, /失败Case清单\.md 有一行列数不足，先修表：\| C-001 \| f \| A \| 规则 \|/)
  const edge = runIn({ ...base(), 'docs/失败Case清单.md': '# Case\n\n| C-001 | f | A | 规则 | 否 |\n' })   // 5 个单元格 → 7 段：刚好够
  assert.equal(edge.rc, 0, edge.err); assert.match(edge.out, /失败 Case {4}1 条/)
})

test('行内代码里的竖线不切列（C-042 第二段：含 | 的行内代码曾把一行切成十余段）', () => {
  const r = runIn({ ...base(), 'docs/失败Case清单.md': '# Case\n\n' + CASES_HDR + '| C-001 | 用 `a | b` 举例 | A | 10-P1 | 否 | x | y |\n' })
  assert.equal(r.rc, 0, r.err); assert.match(r.out, /失败 Case {4}1 条（等级 A=1；被拦住了吗 否=1）/)
})

test('原则数只数行首的 `- **Pn`（行中间出现的不算）；字符数按码点（一个 emoji 算 1 个）', () => {
  const r = runIn({ ...base(), 'docs/10-章.md': '# 章\n\n- **P1** a\n正文里提到 - **P9** 不算\n  - **P8** 缩进的也不算\n\u{1F600}\n' })
  assert.equal(r.rc, 0, r.err)
  const m = /^正文 {8}2 文件 \/ (\d+) 行 \/ (\d+) 字符 \/ (\d+) 条原则$/m.exec(r.out); assert.ok(m, r.out)
  assert.equal(m[3], '2', '总览 1 条 + 10 章 1 条')
  const text = '# 总览\n\n- **P1** a\n' + '# 章\n\n- **P1** a\n正文里提到 - **P9** 不算\n  - **P8** 缩进的也不算\n\u{1F600}\n'
  assert.equal(m[2], String([...text].length), 'emoji 按 1 个码点计；按 UTF-16 码元会多 1')
})

test('生效集合只看「## 决策索引」之前的登记表；索引里的行不算', () => {
  const g = base(); const r = runIn({ ...g, 'docs/决策日志.md': g['docs/决策日志.md'].replace('| D-003 | c |', '| D-003 | 已接受 | c |').replace('## 决策索引\n\n', '## 决策索引\n\n| D-004 | 试行 | 索引里的状态格不算 |\n') })
  assert.match(r.out, /^决策 {8}\d+ 条，生效 2 条（D-001、D-002）$/m)
})

test('追溯账本不存在 → 0 行（不是 1 行）；存在但为空文件同样 0 行（Python 的 splitlines 对空串给空列表，JS 的 split 会给 [""]）；末尾换行不多算一行', () => {
  const g = base(); delete g['docs/追溯账本.md']
  assert.match(runIn(g).out, /^追溯账本 {4}0 行（效力为零）$/m)
  assert.match(runIn({ ...base(), 'docs/追溯账本.md': '' }).out, /^追溯账本 {4}0 行（效力为零）$/m)
  assert.match(runIn({ ...base(), 'docs/追溯账本.md': 'a\nb' }).out, /^追溯账本 {4}2 行/m, '无末尾换行')
  assert.match(runIn({ ...base(), 'docs/追溯账本.md': 'a\nb\n' }).out, /^追溯账本 {4}2 行/m, '有末尾换行，同样 2 行')
})

test('本地链接数：外部链接（http:、mailto:、//）不算；代码块与行内代码里的举例链接不算（C-011）', () => {
  const doc = '[本地](a.md) [外部](https://x.y/z) [邮件](mailto:a@b) [协议相对](//x/y)\n\n```\n[围栏里](fake1.md)\n```\n行内 `[代码里](fake2.md)` 结束\n'
  const r = runIn({ ...base(), 'x.md': doc })
  const before = runIn(base()).out.match(/^markdown {4}(\d+) 个文件 \/ (\d+) 条本地链接$/m), after = r.out.match(/^markdown {4}(\d+) 个文件 \/ (\d+) 条本地链接$/m)
  assert.equal(Number(after[1]) - Number(before[1]), 1, '多一个 md 文件')
  assert.equal(Number(after[2]) - Number(before[2]), 1, '只多出那 1 条本地链接 [本地](a.md)')
})

test('"无……" 开头的规则格不产生绑定，哪怕格里点名了 NN §M Pn（C-042）；不以「无」开头的才产生', () => {
  const r = runIn({ ...base(), 'docs/失败Case清单.md': '# Case\n\n' + CASES_HDR + '| C-001 | f | A | 无对应原则——是 20 §1 P3 的反例 | 否 | x | y |\n' })
  assert.match(r.out, /^已绑定原则 {2}0 条 /m)
  const r2 = runIn({ ...base(), 'docs/失败Case清单.md': '# Case\n\n' + CASES_HDR + '| C-001 | f | A | 违反 20 §1 P3 | 否 | x | y |\n' })
  assert.match(r2.out, /^已绑定原则 {2}1 条 .*已被证明有实例的章：20$/m)
})

test('不在 git 工作区 → 退出 2 并说明', () => {
  const root = mkdtempSync(join(tmpdir(), 'rc-nogit-')); tmps.push(root)
  mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'docs'))
  const cpr = (rel) => spawnSync(process.execPath, ['-e', `require('fs').cpSync(${JSON.stringify(join(here, '..', rel))}, ${JSON.stringify(join(root, rel))}, { recursive: true })`])
  cpr('lib'); cpr('scripts/repo-counts.mjs'); cpr('package.json')
  writeFileSync(join(root, 'docs', '00-总览.md'), '# x\n'); writeFileSync(join(root, 'docs', '决策日志.md'), LOG)
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'repo-counts.mjs')], { cwd: root, encoding: 'utf8' })
  assert.equal(r.status, 2); assert.match(r.stderr, /不在 git 工作区/)
})

test('本仓真实数据：能跑、各项都是数、"已绑 + 未绑 = 原则总数"', () => {
  const r = spawnSync(process.execPath, [REAL], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr)
  const m = /已绑定原则\s+(\d+) 条 \/ 共 (\d+) 条（未绑 (\d+)，/.exec(r.stdout); assert.ok(m, r.stdout)
  assert.equal(Number(m[1]) + Number(m[3]), Number(m[2]))
  assert.match(r.stdout, /^正文 {8}\d+ 文件 \/ \d+ 行 \/ \d+ 字符 \/ \d+ 条原则$/m)
})
