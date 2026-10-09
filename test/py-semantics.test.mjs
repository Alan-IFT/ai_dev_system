// scripts/check-py-semantics.mjs 的测试：往 src/core 的一份**临时拷贝**里塞违规写法，脚本必须报；塞合规写法，脚本必须放行。
// 为什么要测一个检查脚本：「检查在跑」不等于「检查抓得住」（设计 §12.4），这个脚本守的是已登记却被我自己违反过的约束（§12.14）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'scripts', 'check-py-semantics.mjs')

/** 在临时仓里放一份脚本拷贝与一个 src/core/x.ts，运行脚本，返回 { status, out }。 */
function run(line, rel = 'src/core/x.ts') {
  const tmp = mkdtempSync(join(tmpdir(), 'pysem-'))
  try {
    mkdirSync(join(tmp, 'scripts')); mkdirSync(join(tmp, 'src', 'core', ''), { recursive: true }); mkdirSync(join(tmp, 'src', 'checks'), { recursive: true })
    copyFileSync(script, join(tmp, 'scripts', 'check-py-semantics.mjs'))
    writeFileSync(join(tmp, 'package.json'), '{"type":"module"}')
    writeFileSync(join(tmp, ...rel.split('/')), line + '\n')
    const r = spawnSync(process.execPath, [join(tmp, 'scripts', 'check-py-semantics.mjs')], { encoding: 'utf8' })
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

const MUST_FLAG = [
  ['trim', "const a = s.trim()"], ['trimStart', "const a = s.trimStart()"], ['trimEnd', "const a = s.trimEnd()"], ['链式 trim', "const a = x.y.trim().toLowerCase()"],
  ['正则 \\s', "const re = /a\\s+b/"], ['正则 \\S', "const re = /\\S+/"], ['new RegExp 里的 \\s', "const re = new RegExp('a\\\\s*b')"],
  ['\\w', "const re = /\\w+/"], ['\\W', "const re = /\\W/"], ['\\b', "const re = /\\bWI-/"], ['\\d', "const re = /\\d+/"], ['\\D', "const re = /\\D/"],
  ['m 标志（字面量）', "const re = /^#{2,6} /m"], ['im 标志', "const re = /x/im"], ['new RegExp 带 m', "const re = new RegExp('^x', 'm')"], ['new RegExp 带 imu', "const re = new RegExp('^x', 'imu')"],
  ['\\s 在字符类里', "const re = /[\\s|>]/"], ['py-semantics-ok 不带理由', "const a = s.trim() // py-semantics-ok:"],
  ['slice(0, 大写常量)', "const t = text.slice(0, HEAD_CHARS)"], ['slice(0, 下划线大写常量)', "const t = text.slice(0, MAX_READ_BYTES)"], ['slice(0, 4 位数字)', "const t = text.slice(0, 4000)"],
  ['slice(0, 3 位数字)', "const t = text.slice(0, 200)"], ['slice 参数两侧有空白', "const t = text.slice( 0 , HEAD )".replace('HEAD', 'HEAD_CHARS')],
]
const MUST_PASS = [
  ['pyStrip', "const a = pyStrip(s)"], ['[0-9]', "const re = /[0-9]+/"], ['显式空白类', "const re = new RegExp(`[${PY_WHITESPACE}]+`)"], ['(?<![^\\n])', "const re = new RegExp('(?<![^\\\\n])x', 'iu')"],
  ['[\\s\\S] 任意字符', "const re = /^---([\\s\\S]*?)---/"], ['整行注释里的 trim', "// 不要用 s.trim()"], ['块注释里的 \\s', "/* 用 \\s 会错 */"], ['行尾注释里的 trim', "const a = 1 // 别用 trim()"],
  ['带理由的例外', "const a = s.trim() // py-semantics-ok: 输入是 git 自己的输出，只含 ASCII"], ['字符串里的 .trim( 文字', "const m = '不要写 .trim( 这样'"],
  ['无关代码', "const x = [1, 2, 3].map((n) => n * 2)"], ['u 标志', "const re = /[\\p{L}\\p{N}_]/u"],
  ['slice(0, 小写变量)', "const t = s.slice(0, i)"], ['slice(0, 1 位数字)', "const t = s.slice(0, 1)"], ['slice(0, 2 位数字)', "const t = s.slice(0, 40)"],
  ['slice 不从 0 起', "const t = s.slice(1, HEAD_CHARS)"], ['slice(-N)', "const t = s.slice(-120)"], ['headChars 本身', "const t = headChars(text, HEAD_CHARS)"],
  ['slice(0, 常量) 带展示标注', "const t = s.slice(0, LIST_CAP) // py-semantics-ok: 展示"], ['注释里的 slice(0, HEAD_CHARS)', "// 不要写 text.slice(0, HEAD_CHARS)"],
  ['字符串里的 slice 文字', "const m = '不要写 .slice(0, HEAD_CHARS) 这样'"],
]

test('脚本必须报告的违规写法（每一种都被抓住，退出码 1 且信息里点名位置）', () => {
  const missed = []
  for (const [name, line] of MUST_FLAG) { const r = run(line); if (r.status !== 1 || !/x\.ts:1/.test(r.out)) missed.push({ name, line, status: r.status, out: r.out.slice(0, 120) }) }
  assert.deepEqual(missed, [])
})

test('脚本必须放行的合规写法（不误报，退出码 0）', () => {
  const flagged = []
  for (const [name, line] of MUST_PASS) { const r = run(line); if (r.status !== 0) flagged.push({ name, line, status: r.status, out: r.out.slice(0, 160) }) }
  assert.deepEqual(flagged, [])
})

test('process.exit 在 core、checks、汇总层任何一处出现都被抓住（接不住的退出会带走整次扫描）；process.exitCode 与注释里的放行', () => {
  const where = ['src/core/x.ts', 'src/checks/x.ts', 'src/check_all.ts', 'src/main.ts', 'src/selftest_git.ts']
  const missed = where.filter((rel) => { const r = run('if (bad) process.exit(2)', rel); return !(r.status === 1 && r.out.includes('process-exit')) })
  assert.deepEqual(missed, [])
  // 宽档不套用 core 的其它规则：检查器里的 .trim( 不在本脚本管辖内（那是 core 的 Python 语义约束）
  assert.equal(run('const a = s.trim()', 'src/checks/x.ts').status, 0)
  // cli.ts 是唯一设退出码的地方，用 process.exitCode（不立即结束）；脚本不扫 cli.ts
  assert.equal(run('process.exit(1)', 'src/cli.ts').status, 0)
  assert.equal(run('process.exitCode = 1', 'src/checks/x.ts').status, 0)
  assert.equal(run('// 不要写 process.exit(1)', 'src/checks/x.ts').status, 0)
  assert.equal(run('process.exit(1) // py-semantics-ok: 测试夹具的子进程入口', 'src/checks/x.ts').status, 0)
})

test('真实 src/core 当前无违规（这条红了说明有人写了会偏离 Python 语义的代码）', () => {
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr + r.stdout)
})

test('src/core 不存在时脚本报「自己跑不了」（退出码 2），不是静默通过', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pysem-'))
  try {
    mkdirSync(join(tmp, 'scripts')); copyFileSync(script, join(tmp, 'scripts', 'check-py-semantics.mjs')); writeFileSync(join(tmp, 'package.json'), '{"type":"module"}')
    const r = spawnSync(process.execPath, [join(tmp, 'scripts', 'check-py-semantics.mjs')], { encoding: 'utf8' })
    assert.equal(r.status, 2)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})
