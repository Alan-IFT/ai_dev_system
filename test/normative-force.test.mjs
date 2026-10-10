// scripts/check-normative-force.mjs（本仓元治理自检 C1～C10）的验收测试。
// 期望值取自迁移期对 Python 版（docs/附录-载体实例/check_normative_force.py）的真实对拍：30 个坏仓场景，stdout 与退出码逐字一致；
// Python 版已删除，这里钉的是那次对拍得到的输出。每个场景造一个最小的 git 仓，在它基础上改一处。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'scripts', 'check-normative-force.mjs')
const tmps = []
test.after(() => { for (const t of tmps) rmSync(t, { recursive: true, force: true, maxRetries: 3 }) })

const REG_HDR = '| decision_id | 状态 | approved_by | approved_at | effective_scope · blocks | effective_scope · grants | review_at | expiry |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n'
const IDX_HDR = '| ID | 日期 | 状态 | 摘要 |\n| --- | --- | --- | --- |\n'
const LOG = `governed_by: D-001\n\n# 决策日志\n\n## 生效登记表\n\n${REG_HDR}| D-001 | 试行 | Alan | 2026-01-01 | b | g | 2099-01-01 | 2099-12-31 |\n| D-002 | 已接受 | Alan | 2026-01-01 | b | g |  |  |\n\n## 决策索引\n\n${IDX_HDR}| D-001 | 2026-01-01 | 试行 | x |\n| D-002 | 2026-01-01 | 已接受 | y |\n| D-003 | 2026-01-01 | 提议 | z |\n`
const CH = 'governed_by: D-001\n\n# 章\n\n## 1. 节一\n\n- **P1** 原则一\n'
const base = () => ({ 'docs/决策日志.md': LOG, 'docs/10-章.md': CH, 'docs/追溯账本.md': '# 账本\n\n<a id="ch-10"></a>\n\n| P1 |  |\n' })

function run(files) {
  const root = mkdtempSync(join(tmpdir(), 'nf-')); tmps.push(root)
  const git = (...a) => { const r = spawnSync('git', ['-C', root, '-c', 'core.autocrlf=false', ...a], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(a.join(' ') + ' ' + r.stderr) }
  git('init', '-q')
  for (const [rel, body] of Object.entries(files)) { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body) }
  git('add', '-A', '-f')
  const r = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' })
  return { rc: r.status, out: r.stdout.replaceAll('\r\n', '\n'), err: r.stderr.trim() }
}
const block = (code, where, msg) => `  [${code}] ${where}\n        ${msg}\n`
const HEAD = (n = 3, eff = '2（D-001、D-002）', docs = 2) => `D-014 规范效力检查器\n  决策总数：${n}   生效规则：${eff}   扫描文档：${docs}\n\n`
// 输出规律（与 Python 版一致）：按 code 的字符串序分组，组内各条连着，每组之后空一行；调用方按这个顺序传入
const fail = (n, ...blocks) => { const code = (b) => /^  \[(C\d+)\]/.exec(b)[1]; let out = ''; blocks.forEach((b, i) => { out += b; if (i === blocks.length - 1 || code(blocks[i + 1]) !== code(b)) out += '\n' }); return `FAIL  ${n} 项不合规：\n\n${out}` }
const edit = (f, key, a, b) => ({ ...f, [key]: f[key].replace(a, b) })

test('全合规 → 退出 0，PASS', () => {
  const r = run(base()); assert.equal(r.rc, 0); assert.equal(r.out, HEAD() + 'PASS  未发现不合规项。\n')
})

test('C1：governed_by 引用了决策索引里没有的 ID → 退出 1，带行号', () => {
  const r = run({ ...base(), 'docs/10-章.md': 'governed_by: D-001, D-999\n\n# 章\n\n## 1. 节一\n\n- **P1** 原则一\n' })
  assert.equal(r.rc, 1); assert.equal(r.out, HEAD() + fail(1, block('C1', 'docs/10-章.md:1', 'governed_by 引用了决策索引中不存在的 D-999')))
})

test('C1：多条同类按出现顺序逐条报', () => {
  const r = run({ ...base(), 'docs/10-章.md': 'governed_by: D-998, D-999\n\n# 章\n\n## 1. 节一\n\n- **P1** 原则一\n' })
  assert.equal(r.rc, 1); assert.equal(r.out, HEAD() + fail(2, block('C1', 'docs/10-章.md:1', 'governed_by 引用了决策索引中不存在的 D-998'), block('C1', 'docs/10-章.md:1', 'governed_by 引用了决策索引中不存在的 D-999')))
})

test('C2：已接受缺必需字段 / 登记表里有非生效态（并连带 C4 状态不一致）', () => {
  let r = run(edit(base(), 'docs/决策日志.md', '| D-002 | 已接受 | Alan | 2026-01-01 | b | g |', '| D-002 | 已接受 | Alan | 2026-01-01 | b |  |'))
  assert.equal(r.rc, 1); assert.equal(r.out, HEAD() + fail(1, block('C2', 'docs/决策日志.md', 'D-002（已接受）缺少必需字段 `effective_scope · grants`；按 D-014 §1 不视为已生效')))
  r = run(edit(base(), 'docs/决策日志.md', '| D-002 | 已接受 |', '| D-002 | 提议 |'))
  assert.equal(r.rc, 1); assert.equal(r.out, HEAD(3, '1（D-001）') + fail(2, block('C2', 'docs/决策日志.md', 'D-002 出现在生效登记表但状态为「提议」；登记表只收录 试行/已接受'), block('C4', 'docs/决策日志.md', 'D-002 状态不一致：索引「已接受」 vs 登记表「提议」')))
})

test('C3：expiry 不可解析 / 日期不存在（像日期但不存在也是写错了）', () => {
  for (const [exp, shown] of [['无', "'无'"], ['2020-02-30', "'2020-02-30'"]]) {
    const r = run(edit(base(), 'docs/决策日志.md', '2099-12-31', exp))
    assert.equal(r.rc, 1); assert.equal(r.out, HEAD() + fail(1, block('C3', 'docs/决策日志.md', `D-001（试行）的 expiry 不是可解析日期：${shown}`)), exp)
  }
})

test('C3：已到期的试行项只作到期通告，不计入不合规项也不计入生效规则；散文计数恰好多出已到期条数是日历翻页，不进 FAIL', () => {
  const g = edit(base(), 'docs/决策日志.md', '2099-12-31', '2020-01-01')
  const r = run(g)
  assert.equal(r.rc, 0)
  assert.equal(r.out, `D-014 规范效力检查器\n  决策总数：3   生效规则：1（D-002）   扫描文档：2\n  已到期：1（D-001）——不计入生效规则，见下方到期通告\n\n到期通告  不计入不合规项（只在它使生效集变空时退出 2，见上）。按 08 §6 已自动退回「提议」，须人决定续期或移出生效登记表，并在决策日志留下处置痕迹：\n  [C3] docs/决策日志.md\n        D-001（试行）已于 2020-01-01 到期，按 D-014 §6 自动退回「提议」，须从生效登记表移除或重新批准（历史结果不追溯）\n\nPASS  未发现不合规项。\n`)
  const r2 = run({ ...g, 'docs/决策日志.md': g['docs/决策日志.md'] + '\n当前生效规则数：**2**\n' }) // 实算 1，散文 2 ＝ 1 + 已到期 1：日历翻页
  assert.equal(r2.rc, 0)
})

test('C4：索引状态为生效但未登记 / 使用了未定义的状态值', () => {
  let r = run(edit(base(), 'docs/决策日志.md', '| D-003 | 2026-01-01 | 提议 | z |', '| D-003 | 2026-01-01 | 已接受 | z |'))
  assert.equal(r.rc, 1); assert.equal(r.out, HEAD() + fail(1, block('C4', 'docs/决策日志.md', 'D-003 索引状态为「已接受」但未登记；按 D-014 §5 以登记表为准，实际不生效')))
  r = run(edit(base(), 'docs/决策日志.md', '| D-003 | 2026-01-01 | 提议 |', '| D-003 | 2026-01-01 | 乱写 |'))
  assert.equal(r.rc, 1); assert.equal(r.out, HEAD() + fail(1, block('C4', 'docs/决策日志.md', 'D-003 使用了未定义的状态值「乱写」')))
})

test('状态带强调标记（**已接受**）与朴素写法同样认（C-023 同形问题）', () => {
  const g = edit(edit(base(), 'docs/决策日志.md', '| D-002 | 已接受 | Alan', '| D-002 | **已接受** | Alan'), 'docs/决策日志.md', '| D-002 | 2026-01-01 | 已接受 |', '| D-002 | 2026-01-01 | **已接受** |')
  const r = run(g); assert.equal(r.rc, 0); assert.equal(r.out, HEAD() + 'PASS  未发现不合规项。\n')
})

test('C5：括号形态与系动词形态的状态值副本都认（Case C-022），带行号', () => {
  let r = run({ ...base(), 'docs/10-章.md': CH + '\n本章（均为提议）\n' })
  assert.equal(r.rc, 1); assert.equal(r.out, HEAD() + fail(1, block('C5', 'docs/10-章.md:9', '状态值副本「（均为提议）」；状态只允许存在于生效登记表与决策索引（D-014 §7）。此处应删除或改为指向生效登记表的链接')))
  r = run({ ...base(), 'docs/10-章.md': CH + '\n各章仍是`试行`\n' })
  assert.equal(r.rc, 1); assert.equal(r.out, HEAD() + fail(1, block('C5', 'docs/10-章.md:9', '状态值副本「仍是`试行`」；状态只允许存在于生效登记表与决策索引（D-014 §7）。此处应删除或改为指向生效登记表的链接')))
})

test('C6：缺 governed_by / governed_by 里没有任何 ID', () => {
  let r = run({ ...base(), 'docs/10-章.md': '# 章\n\n## 1. 节一\n\n- **P1** 原则一\n' })
  assert.equal(r.rc, 1); assert.equal(r.out, HEAD() + fail(1, block('C6', 'docs/10-章.md', '规范文档未在文件头 12 行内声明 governed_by（D-014 §7）')))
  r = run({ ...base(), 'docs/10-章.md': 'governed_by: 无\n\n# 章\n\n## 1. 节一\n\n- **P1** 原则一\n' })
  assert.equal(r.rc, 1); assert.equal(r.out, HEAD() + fail(1, block('C6', 'docs/10-章.md', "governed_by 未解析出任何 decision_id：'无'")))
})

test('C7：账本缺记录 / 多出 / 重复 / 无本章段 / 账本不存在', () => {
  const diff = (miss, extra, dup) => `正文与追溯账本的原则编号对不上——正文有账本无：${miss}；账本有正文无：${extra}；账本内重复：${dup}`
  let r = run({ ...base(), 'docs/10-章.md': CH + '- **P2** 原则二\n' })
  assert.equal(r.out, HEAD() + fail(1, block('C7', 'docs/10-章.md', diff("['P2']", '无', '无'))))
  r = run({ ...base(), 'docs/追溯账本.md': base()['docs/追溯账本.md'] + '| P9 |  |\n' })
  assert.equal(r.out, HEAD() + fail(1, block('C7', 'docs/10-章.md', diff('无', "['P9']", '无'))))
  r = run({ ...base(), 'docs/追溯账本.md': base()['docs/追溯账本.md'] + '| P1 |  |\n' })
  assert.equal(r.out, HEAD() + fail(1, block('C7', 'docs/10-章.md', diff('无', '无', "['P1']"))))
  r = run({ ...base(), 'docs/追溯账本.md': '# 账本\n' })
  assert.equal(r.out, HEAD() + fail(1, block('C7', 'docs/10-章.md', '追溯账本缺少 ch-10 的记录段')))
  const g = base(); delete g['docs/追溯账本.md']
  r = run(g); assert.equal(r.rc, 1); assert.equal(r.out, HEAD() + fail(1, block('C7', 'docs/追溯账本.md', '追溯账本不存在，正文原则无从对账')))
})

test('C8：活文档自行声明语料版本号', () => {
  const r = run({ ...base(), 'docs/术语表.md': 'governed_by: D-001\n\n状态：`v0.7-x`\n' })
  assert.equal(r.rc, 1); assert.equal(r.out, HEAD(3, '2（D-001、D-002）', 3) + fail(1, block('C8', 'docs/术语表.md', '自行声明了语料版本号「状态：`v0.7-x`」；版本号只允许出现在 PROJECT_STATUS.md 的 corpus_version（D-014 §7 单一副本）。此处应删除或改为指向该字段的链接')))
})

test('C9：散文生效计数与登记表实算不符', () => {
  const g = base(); const r = run({ ...g, 'docs/决策日志.md': g['docs/决策日志.md'] + '\n当前生效规则数：**5**\n' })
  assert.equal(r.rc, 1); assert.equal(r.out, HEAD() + fail(1, block('C9', 'docs/决策日志.md', '散文写「生效规则数 5」，与生效登记表实算 2 条不一致')))
})

test('C10：「NN §M」引用指向正文里不存在的小节——裸写与链接两种形态', () => {
  for (const body of ['见 10 §9。\n', '见 [10 章](10-章.md) §9。\n']) {
    const r = run({ ...base(), 'docs/术语表.md': 'governed_by: D-001\n\n' + body })
    assert.equal(r.rc, 1); assert.equal(r.out, HEAD(3, '2（D-001、D-002）', 3) + fail(1, block('C10', 'docs/术语表.md:3', '引用了 10 章的 §9，但该章只有 §1')), body)
  }
})

test('生效规则集为空：有别的问题时 FAIL 并带"注意"行；没别的问题时 UNDETERMINED 退出 2', () => {
  const noReg = (f) => edit(f, 'docs/决策日志.md', /\| D-00[12] \|[^\n]*\n/g, '')
  let r = run(noReg(base()))
  assert.equal(r.rc, 1); assert.match(r.out, /生效规则：0（无）/); assert.match(r.out, /注意：生效规则集为空，『全部规则通过』不得视为 PASS（D-014 §4）。/)
  r = run({ ...noReg(base()), 'docs/10-章.md': 'governed_by: D-003\n\n# 章\n\n## 1. 节一\n\n- **P1** 原则一\n' })
  assert.equal(r.rc, 1, '该场景 D-003 在索引里，但 D-001/D-002 的索引行仍是生效态却未登记 → C4，所以不是 UNDETERMINED')
})

test('FATAL（退出 2，写 stderr）：决策日志缺失 / 无生效登记表 / 无决策索引', () => {
  let g = base(); delete g['docs/决策日志.md']
  let r = run({ ...g, 'x.md': '# x\n' }); assert.equal(r.rc, 2); assert.match(r.err, /^FATAL 决策日志缺失：/)
  r = run({ ...base(), 'docs/决策日志.md': 'governed_by: D-001\n\n# 日志\n\n## 决策索引\n\n| ID | 状态 |\n| --- | --- |\n| D-001 | 提议 |\n' })
  assert.equal(r.rc, 2); assert.equal(r.err, 'FATAL 未找到生效登记表')
  r = run({ ...base(), 'docs/决策日志.md': 'governed_by: D-001\n\n# 日志\n\n## 生效登记表\n\n| decision_id | 状态 |\n| --- | --- |\n| D-001 | 试行 |\n' })
  assert.equal(r.rc, 2); assert.equal(r.err, 'FATAL 未找到决策索引')
})

test('C4：已登记而索引状态非生效——同一条会连报两种 C4（不一致 + 状态不一致），同组连着输出', () => {
  const r = run(edit(base(), 'docs/决策日志.md', '| D-002 | 2026-01-01 | 已接受 | y |', '| D-002 | 2026-01-01 | 提议 | y |'))
  assert.equal(r.rc, 1)
  assert.equal(r.out, HEAD() + fail(2, block('C4', 'docs/决策日志.md', 'D-002 已登记但索引状态为「提议」，两处不一致'), block('C4', 'docs/决策日志.md', 'D-002 状态不一致：索引「提议」 vs 登记表「已接受」')))
})

test('CONTEXT_MANIFEST.md（上下文合同）：进 C5 的扫描面（它是加载入口，过期的效力声明在这里最危险），但不要求 governed_by（它不是规范正文）', () => {
  const r = run({ ...base(), 'CONTEXT_MANIFEST.md': '# 合同\n\n本章（均为提议）\n' })
  assert.equal(r.rc, 1)
  assert.equal(r.out, HEAD() + fail(1, block('C5', 'CONTEXT_MANIFEST.md:3', '状态值副本「（均为提议）」；状态只允许存在于生效登记表与决策索引（D-014 §7）。此处应删除或改为指向生效登记表的链接')), '只有 C5，没有 C6')
})

test('PROJECT_STATUS.md 是语料版本号的唯一权威位置：在那里声明不算 C8', () => {
  const r = run({ ...base(), 'PROJECT_STATUS.md': '状态：`v0.7-x`\n' })
  assert.equal(r.rc, 0); assert.equal(r.out, HEAD() + 'PASS  未发现不合规项。\n')
})

test('生效规则集为空且没有别的问题 → UNDETERMINED，退出 2（"全部规则通过"不得视为 PASS，D-014 §4）', () => {
  const REG = '| decision_id | 状态 | approved_by | approved_at | effective_scope · blocks | effective_scope · grants | review_at | expiry |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n'
  const log = 'governed_by: D-001\n\n# 决策日志\n\n## 生效登记表\n\n' + REG + '\n## 决策索引\n\n| ID | 日期 | 状态 | 摘要 |\n| --- | --- | --- | --- |\n| D-001 | 2026-01-01 | 提议 | x |\n'
  const r = run({ ...base(), 'docs/决策日志.md': log })
  assert.equal(r.rc, 2)
  assert.equal(r.out, 'D-014 规范效力检查器\n  决策总数：1   生效规则：0（无）   扫描文档：2\n  注意：生效规则集为空，『全部规则通过』不得视为 PASS（D-014 §4）。\n\nUNDETERMINED  生效规则集为空，『全部规则通过』不得视为 PASS（D-014 §4）。\n')
})

test('报告里各 code 的次序是字符串序（C10 在 C2 之前）——与迁移前的输出逐字一致', () => {
  const g = edit(base(), 'docs/决策日志.md', '| D-002 | 已接受 | Alan | 2026-01-01 | b | g |', '| D-002 | 已接受 | Alan | 2026-01-01 | b |  |')
  const r = run({ ...g, 'docs/术语表.md': 'governed_by: D-001\n\n见 10 §9。\n' })
  assert.equal(r.rc, 1)
  assert.equal(r.out, HEAD(3, '2（D-001、D-002）', 3) + fail(2, block('C10', 'docs/术语表.md:3', '引用了 10 章的 §9，但该章只有 §1'), block('C2', 'docs/决策日志.md', 'D-002（已接受）缺少必需字段 `effective_scope · grants`；按 D-014 §1 不视为已生效')))
})

test('本仓自己跑一遍：退出 0（真实仓是它的第一个使用者）', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout.slice(0, 600)); assert.match(r.stdout, /PASS  未发现不合规项。/)
})
