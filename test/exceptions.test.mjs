// core/exceptions 的单元测试：对着 Python 版的黄金样本（golden/unit/stdlib-exceptions.json）逐条比对。
// 纯函数（关闭态、拆单元格、表头归类、找第一张表）与 loadExceptions（固定运行日 2026-10-06，输出不随运行日变化）。
// 有意差异 D10（设计 §12.6）：系统错误类的整句措辞不复现——比较时按「异常类名 + 路径归一」，不按整句。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadExceptions, _exClosed, mdCells, firstMdTable, exField, EXCEPTION_MAX_DAYS } from '../lib/core/exceptions.js'
import { addDays, compareDays } from '../lib/core/dates.js'
import { toIso } from '../lib/core/dates.js'
import { loadConfig } from '../lib/core/config.js'

const here = dirname(fileURLToPath(import.meta.url))
const gold = JSON.parse(readFileSync(join(here, '..', 'golden', 'unit', 'stdlib-exceptions.json'), 'utf8'))
const TODAY = { year: 2026, month: 10, day: 6 }

const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))

/** 把 TS 返回值整理成黄金样本的形状（日期转 ISO 字符串、路径归一）。 */
function pack(res, tmp) {
  const [rows, problems, src, own] = res
  const norm = (s) => (typeof s === 'string' ? s.replaceAll(tmp, '<ROOT>').replaceAll('\\', '/') : s)
  const un = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v && typeof v === 'object' && 'year' in v ? toIso(v) : v]))
  return { rows: rows.map(un), problems: problems.map((p) => norm(p)), source: src === null ? null : norm(src), own: own.map(un) }
}
/** 黄金样本里 problems 的路径是 Windows 反斜杠 + <ROOT>；两边都把反斜杠换成斜杠再比。 */
const goldNorm = (r) => ({ ...r, problems: r.problems.map((p) => p.replaceAll('\\', '/')) })

function runLoad(text, raw, today = TODAY) {
  const tmp = mkdtempSync(join(tmpdir(), 'tsex-'))
  try {
    const gov = join(tmp, 'governance'); mkdirSync(gov)
    writeFileSync(join(gov, 'exceptions.md'), raw ?? Buffer.from(text, 'utf8'))
    return pack(loadExceptions(gov, tmp, today), tmp)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

test('黄金样本规模：各部分都不为空，且有登记行也有问题行（空样本集不得算通过）', () => {
  assert.ok(gold.closed.length >= 60 && gold.cells.length >= 25 && gold.field.length >= 30 && gold.table.length >= 60 && gold.load.length >= 60)
  assert.ok(gold.load.some((x) => x.result.rows.length > 0) && gold.load.some((x) => x.result.problems.length > 0) && gold.load.some((x) => x.result.own.length > 0))
})

test('exClosed：65 条对 Python 逐条一致（关闭态只认段首整词）', () => {
  const wrong = gold.closed.filter(({ in: s, out }) => _exClosed(s) !== out).map((x) => x.in)
  assert.deepEqual(wrong, [])
})

test('mdCells：转义竖线不拆，对 Python 逐条一致', () => {
  const wrong = gold.cells.filter(({ in: s, out }) => !same(mdCells(s), out)).map((x) => ({ in: x.in, want: x.out, got: mdCells(x.in) }))
  assert.deepEqual(wrong, [])
})

test('exField：表头归类（id 只认整格；包含匹配先命中者为准）对 Python 逐条一致', () => {
  const wrong = gold.field.filter(({ in: s, out }) => exField(s) !== out).map((x) => ({ in: x.in, want: x.out, got: exField(x.in) }))
  assert.deepEqual(wrong, [])
})

test('firstMdTable：找第一张表（分隔行格式、没有前导竖线、第二张表忽略）对 Python 逐条一致', () => {
  const samples = new Map(); for (const x of gold.load) samples.set(x.name, null)
  // 表样本的原文就是 load 样本的原文，但黄金样本里没存原文——从测试自己的同一份清单重建
  const wrong = []
  for (const t of gold.table) {
    const text = SAMPLES.get(t.name); assert.ok(text !== undefined, `缺样本 ${t.name}`)
    const got = firstMdTable(text)
    const gotPacked = got === null ? null : [got[0], got[1], got[2].map(([n, c]) => [n, c])]
    if (!same(gotPacked, t.out)) wrong.push({ name: t.name, want: t.out, got: gotPacked })
  }
  assert.deepEqual(wrong.map((w) => w.name), [], JSON.stringify(wrong.slice(0, 2), null, 1))
})

test('loadExceptions：65 个 exceptions.md 样本对 Python 黄金样本逐条一致（rows / problems / own）', () => {
  const wrong = []
  for (const g of gold.load) {
    const text = SAMPLES.get(g.name); assert.ok(text !== undefined, `缺样本 ${g.name}`)
    const got = runLoad(text)
    if (!same(got, goldNorm(g.result))) wrong.push({ name: g.name, want: g.result, got })
  }
  assert.deepEqual(wrong.map((w) => w.name), [], JSON.stringify(wrong.slice(0, 2), null, 1))
})

test('loadExceptions：原始字节（非 UTF-8、截断、孤立 BOM、双 BOM）——UTF-8 解码失败的整句文本与 Python 逐字一致（D10）', () => {
  const wrong = []
  for (const g of gold.raw) {
    const got = runLoad(null, Buffer.from(g.hex, 'hex'))
    if (!same(got, goldNorm(g.result))) wrong.push({ name: g.name, want: g.result, got })
  }
  assert.deepEqual(wrong.map((w) => w.name), [], JSON.stringify(wrong.slice(0, 2), null, 1))
})

test('loadExceptions：运行日决定上限——同一份样本在 5 个运行日下的结果对 Python 一致（含闰年）', () => {
  const sample = SAMPLES.get('expires_exact_limit')
  const wrong = []
  for (const g of gold.today) {
    const [y, m, d] = g.today.split('-').map(Number)
    const got = runLoad(sample, null, { year: y, month: m, day: d })
    if (!same(got, goldNorm(g.result))) wrong.push({ today: g.today, want: g.result, got })
  }
  assert.deepEqual(wrong.map((w) => w.today), [])
})

test('loadExceptions：文件布局（不存在、是目录、符号链接出仓、外部配置目录）', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tsex-'))
  try {
    const gov = join(tmp, 'governance'); mkdirSync(gov)
    const lay = new Map(gold.layout.map((l) => [l.name, l]))
    assert.ok(same(pack(loadExceptions(gov, tmp, TODAY), tmp), goldNorm(lay.get('absent').result)), 'absent')
    mkdirSync(join(gov, 'exceptions.md'))
    assert.ok(same(pack(loadExceptions(gov, tmp, TODAY), tmp), goldNorm(lay.get('is_dir').result)), 'is_dir')
    rmSync(join(gov, 'exceptions.md'), { recursive: true })
    const ext = mkdtempSync(join(tmpdir(), 'tsex-ext-'))
    try {
      writeFileSync(join(ext, 'exceptions.md'), HDR + '| E1 | a/b | r | s | a | 2026-12-31 | |\n')
      assert.ok(same(pack(loadExceptions(ext, tmp, TODAY), ext), goldNorm(lay.get('external_config_dir').result)), 'external_config_dir')
      assert.ok(same(pack(loadExceptions(ext, null, TODAY), ext), goldNorm(lay.get('external_config_dir_no_root').result)), 'external_config_dir_no_root')
    } finally { rmSync(ext, { recursive: true, force: true }) }
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('符号链接指向仓外的登记册：不读、不回显内容；信息与 Python 一致（路径归一后）', { skip: canSymlink() ? false : '本机造不出符号链接' }, () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tsex-')), out = mkdtempSync(join(tmpdir(), 'tsex-out-'))
  try {
    const gov = join(tmp, 'governance'); mkdirSync(gov)
    writeFileSync(join(out, 'secret.md'), HDR + '| E1 | TOPSECRET/x | r | s | a | 2026-12-31 | |\n')
    symlinkSync(join(out, 'secret.md'), join(gov, 'exceptions.md'), 'file')
    const got = pack(loadExceptions(gov, tmp, TODAY), tmp)
    const want = gold.layout.find((l) => l.name === 'symlink_out')
    if (want.symlink) assert.ok(same(got, goldNorm(want.result)), JSON.stringify({ want: want.result, got }))
    assert.ok(!JSON.stringify(got).includes('TOPSECRET'), '回显了仓外内容')
    assert.equal(got.rows.length, 0)
  } finally { rmSync(tmp, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }) }
})

test('governance 本身是指向仓外的**目录**链接：单独调用 loadExceptions 时与 Python 一致（读得到——护栏的基准随链接一起被带走）；真实入口因 loadConfig 先拒读而走不到', { skip: canSymlink() ? false : '本机造不出符号链接' }, () => {
  // 设计 §12.12：这是 Python 版既有的行为（黄金样本 echoed=True），被上游 loadConfig 兜住。TS 保持一致，**不擅自收紧**——
  // 收紧是行为改动，要走「有意差异」登记；而且此处的纵深价值是确认上游那道防线在 TS 里也在（见下面 loadConfig 的断言）。
  const want = gold.layout.find((l) => l.name === 'governance_dir_symlink_out')
  const tmp = mkdtempSync(join(tmpdir(), 'tsex-')), out = mkdtempSync(join(tmpdir(), 'tsex-out-'))
  try {
    writeFileSync(join(out, 'exceptions.md'), HDR + '| E1 | secret/rule | 机密理由TOPSECRET | s | a | 2026-12-31 | |\n')
    writeFileSync(join(out, 'project.yaml'), 'tier: L1\n')
    symlinkSync(out, join(tmp, 'governance'), process.platform === 'win32' ? 'junction' : 'dir')
    const got = pack(loadExceptions(join(tmp, 'governance'), tmp, TODAY), tmp)
    if (want.symlink) {
      assert.equal(JSON.stringify(got).includes('TOPSECRET'), want.echoed, '与 Python 的「是否回显」一致')
      assert.ok(same(got, goldNorm(want.result)), JSON.stringify({ want: want.result, got }))
    }
    // 上游兜底：同一个项目，loadConfig 必须拒读（真实入口先读配置，失败就走不到登记册）
    const [cfg, problem] = loadConfig(tmp)
    assert.deepEqual(cfg, {}); assert.match(problem, /真实位置在被扫项目之外（符号链接），未读/)
  } finally { rmSync(tmp, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }) }
})

test('D10：不存在与权限类系统错误用固定措辞 `<异常类名>: <路径>`，不带 [Errno N]；程序错误向外抛', async () => {
  const { __testHooks } = await import('../lib/core/fs.js')
  const tmp = mkdtempSync(join(tmpdir(), 'tsex-'))
  try {
    const gov = join(tmp, 'governance'); mkdirSync(gov); writeFileSync(join(gov, 'exceptions.md'), HDR)
    __testHooks.beforeOpen = () => { const e = new Error('x'); e.code = 'EACCES'; throw e }
    try {
      const [rows, problems, src] = loadExceptions(gov, tmp, TODAY)
      assert.deepEqual(rows, []); assert.equal(problems.length, 1); assert.match(problems[0], /^exceptions\.md 读不了：PermissionError: /); assert.ok(!problems[0].includes('[Errno')); assert.ok(src)
    } finally { __testHooks.beforeOpen = undefined }
    __testHooks.beforeOpen = () => { throw new TypeError('模拟的程序错误') }
    try { assert.throws(() => loadExceptions(gov, tmp, TODAY), TypeError) } finally { __testHooks.beforeOpen = undefined }
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('日期运算：addDays 跨月跨年跨闰日；compareDays 符号；EXCEPTION_MAX_DAYS 是 365', () => {
  assert.equal(EXCEPTION_MAX_DAYS, 365)
  assert.deepEqual(addDays({ year: 2026, month: 10, day: 6 }, 365), { year: 2027, month: 10, day: 6 })
  assert.deepEqual(addDays({ year: 2023, month: 12, day: 31 }, 59), { year: 2024, month: 2, day: 28 }, '期望值取自 Python date + timedelta 实算')
  assert.deepEqual(addDays({ year: 2023, month: 12, day: 31 }, 60), { year: 2024, month: 2, day: 29 }, '闰日存在')
  assert.deepEqual(addDays({ year: 2024, month: 2, day: 29 }, 365), { year: 2025, month: 2, day: 28 })
  assert.deepEqual(addDays({ year: 2024, month: 2, day: 29 }, 366), { year: 2025, month: 3, day: 1 })
  assert.ok(compareDays({ year: 2026, month: 1, day: 2 }, { year: 2026, month: 1, day: 1 }) > 0)
  assert.equal(compareDays({ year: 2026, month: 1, day: 1 }, { year: 2026, month: 1, day: 1 }), 0)
})

test('日期运算与时区无关：在有夏令时、有半小时偏移、UTC+14、UTC-12 的时区下，addDays/compareDays 结果相同（变异 X65、X67）', async () => {
  const { spawnSync } = await import('node:child_process')
  const code = `import { addDays, compareDays } from ${JSON.stringify(new URL('../lib/core/dates.js', import.meta.url).href)}
const out = []
for (const [y, m, d] of [[2026, 3, 7], [2026, 3, 8], [2026, 3, 28], [2026, 10, 24], [2026, 10, 25], [2026, 11, 1], [2024, 2, 28], [2026, 10, 6], [2026, 12, 31]])
  for (const n of [0, 1, 2, 30, 365, 366]) out.push(JSON.stringify(addDays({ year: y, month: m, day: d }, n)))
out.push(compareDays({ year: 2026, month: 3, day: 9 }, { year: 2026, month: 3, day: 8 }), compareDays({ year: 2026, month: 11, day: 2 }, { year: 2026, month: 11, day: 1 }))
console.log(JSON.stringify(out))`
  const run = (tz) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, TZ: tz } }).stdout
  const base = run('UTC'); assert.ok(base.length > 100, '基准运行没有输出')
  for (const tz of ['America/Los_Angeles', 'Europe/London', 'Australia/Lord_Howe', 'Asia/Kolkata', 'Pacific/Kiritimati', 'Etc/GMT+12', 'America/Sao_Paulo']) assert.equal(run(tz), base, `时区 ${tz} 下结果与 UTC 不同`)
})

test('errnoName 的映射：不存在是 FileNotFoundError、权限是 PermissionError、其它是 OSError（变异 X63、X64）', async () => {
  const { __testHooks } = await import('../lib/core/fs.js')
  const tmp = mkdtempSync(join(tmpdir(), 'tsex-'))
  try {
    const gov = join(tmp, 'governance'); mkdirSync(gov); writeFileSync(join(gov, 'exceptions.md'), HDR)
    const probe = (code) => {
      __testHooks.beforeOpen = () => { const e = new Error('x'); e.code = code; throw e }
      try { return loadExceptions(gov, tmp, TODAY)[1][0] } finally { __testHooks.beforeOpen = undefined }
    }
    assert.match(probe('ENOENT'), /^exceptions\.md 读不了：FileNotFoundError: /)
    assert.match(probe('EACCES'), /^exceptions\.md 读不了：PermissionError: /)
    assert.match(probe('EPERM'), /^exceptions\.md 读不了：PermissionError: /)
    assert.match(probe('EISDIR'), /^exceptions\.md 读不了：IsADirectoryError: /)
    assert.match(probe('ENOTDIR'), /^exceptions\.md 读不了：NotADirectoryError: /)
    assert.match(probe('EMFILE'), /^exceptions\.md 读不了：OSError: /)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('项目自有例外的到期按**严格**模式解析：「日期 + 文字」不被接受，expires_date 为 null 且带原因（变异 X36）', () => {
  const r = runLoad(HDR + '| E1 | G6 | r | s | a | 2026-12-31 之前 | |\n')
  assert.equal(r.own.length, 1); assert.equal(r.own[0].expires_date, null)
  assert.match(r.own[0].error, /^既不是 YYYY-MM-DD 也不是 ISO8601：/)
  const ok = runLoad(HDR + '| E1 | G6 | r | s | a | 2026-12-31 | |\n')
  assert.equal(ok.own[0].expires_date, '2026-12-31'); assert.equal(ok.own[0].error, null)
})

test('todayLocal 取**本地**日期而不是 UTC（Python 的 date.today() 同义）：固定一个本地与 UTC 日期必然不同的时刻（变异 X20）', async () => {
  const { spawnSync } = await import('node:child_process')
  // 2026-10-06T20:00:00Z 在 UTC+14（Pacific/Kiritimati）是 10-07 10:00；在 UTC-12（Etc/GMT+12）是 10-06 08:00；在 UTC 是 10-06
  const code = `import { todayLocal } from ${JSON.stringify(new URL('../lib/core/dates.js', import.meta.url).href)}
console.log(JSON.stringify(todayLocal(new Date('2026-10-06T20:00:00Z'))))`
  const at = (tz) => JSON.parse(spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, TZ: tz } }).stdout)
  assert.deepEqual(at('Pacific/Kiritimati'), { year: 2026, month: 10, day: 7 }, 'UTC+14：本地已是次日')
  assert.deepEqual(at('Etc/GMT+12'), { year: 2026, month: 10, day: 6 })
  assert.deepEqual(at('UTC'), { year: 2026, month: 10, day: 6 })
})

function canSymlink() {
  const t = mkdtempSync(join(tmpdir(), 'tsex-sl-'))
  try { writeFileSync(join(t, 'a'), 'x'); symlinkSync(join(t, 'a'), join(t, 'b'), 'file'); return true } catch { return false } finally { rmSync(t, { recursive: true, force: true }) }
}

// ---- 样本原文：与 golden/make_unit_exceptions.py 的 SAMPLES 一一对应（测试开头核对条数与每个名字都在黄金样本里）----
const HDR = '| 编号 | 规则 | 理由 | 范围 | 批准 | 到期 | 状态 |\n|---|---|---|---|---|---|---|\n'
const SAMPLES = new Map([
  ['ok_one', HDR + '| E1 | `layout/entry-missing` | 暂缓 | 全仓 | Alan | 2026-12-31 | 生效 |\n'],
  ['ok_no_backticks', HDR + '| E1 | layout/entry-missing | 暂缓 | 全仓 | Alan | 2026-12-31 | |\n'],
  ['ok_no_id', HDR + '|  | layout/x | r | s | a | 2026-12-31 | |\n'],
  ['ok_two', HDR + '| E1 | a/b | r | s | a | 2026-12-31 | |\n| E2 | c/d | r | s | a | 2027-01-01 | |\n'],
  ['closed_skipped', HDR + '| E1 | a/b | r | s | a | 2026-12-31 | 已关闭 |\n'],
  ['closed_with_missing_fields_skipped', HDR + '| E1 | a/b | | | | | closed |\n'],
  ['not_closed_counts', HDR + '| E1 | a/b | r | s | a | 2026-12-31 | not yet closed |\n'],
  ['closed_loop_counts', HDR + '| E1 | a/b | r | s | a | 2026-12-31 | closed-loop 待复核 |\n'],
  ['missing_reason', HDR + '| E1 | a/b | | s | a | 2026-12-31 | |\n'],
  ['missing_all_four', HDR + '| E1 | a/b | | | | 2026-12-31 | |\n'],
  ['missing_expires', HDR + '| E1 | a/b | r | s | a | | |\n'],
  ['expires_not_date', HDR + '| E1 | a/b | r | s | a | 年底 | |\n'],
  ['expires_date_plus_text', HDR + '| E1 | a/b | r | s | a | 2026-12-31 之前 | |\n'],
  ['expires_iso_datetime', HDR + '| E1 | a/b | r | s | a | 2026-12-31T10:00:00Z | |\n'],
  ['expires_bold', HDR + '| E1 | a/b | r | s | a | **2026-12-31** | |\n'],
  ['expires_backtick', HDR + '| E1 | a/b | r | s | a | `2026-12-31` | |\n'],
  ['expires_exact_limit', HDR + '| E1 | a/b | r | s | a | 2027-10-06 | |\n'],
  ['expires_over_limit_by_one', HDR + '| E1 | a/b | r | s | a | 2027-10-07 | |\n'],
  ['expires_far', HDR + '| E1 | a/b | r | s | a | 2099-01-01 | |\n'],
  ['expires_past', HDR + '| E1 | a/b | r | s | a | 2020-01-01 | |\n'],
  ['expires_today', HDR + '| E1 | a/b | r | s | a | 2026-10-06 | |\n'],
  ['expires_invalid_calendar', HDR + '| E1 | a/b | r | s | a | 2026-02-30 | |\n'],
  ['internal_error_rule', HDR + '| E1 | layout/internal-error | r | s | a | 2026-12-31 | |\n'],
  ['internal_error_rule_with_key', HDR + '| E1 | layout/internal-error/x | r | s | a | 2026-12-31 | |\n'],
  ['internal_error_as_third_segment_ok', HDR + '| E1 | layout/x/internal-error | r | s | a | 2026-12-31 | |\n'],
  ['project_own_gate', HDR + '| E1 | G6 | r | s | a | 2026-12-31 | |\n'],
  ['project_own_gate_no_expires', HDR + '| E1 | G6 | r | s | a | | |\n'],
  ['project_own_gate_bad_expires', HDR + '| E1 | G9 | r | s | a | 年底 | |\n'],
  ['project_own_gate_closed', HDR + '| E1 | G6 | r | s | a | 2026-12-31 | done |\n'],
  ['project_own_gate_missing_fields_ok', HDR + '| E1 | G6 | | | | 2026-12-31 | |\n'],
  ['mixed', HDR + '| E1 | a/b | r | s | a | 2026-12-31 | |\n| E2 | G6 | r | s | a | 2026-11-01 | |\n| E3 | c/d | | s | a | 2026-12-31 | |\n| E4 | e/f | r | s | a | 2026-12-31 | closed |\n'],
  ['blank_row_skipped', HDR + '| | | | | | | |\n| E1 | a/b | r | s | a | 2026-12-31 | |\n'],
  ['short_row', HDR + '| E1 | a/b |\n'],
  ['long_row_extra_cells', HDR + '| E1 | a/b | r | s | a | 2026-12-31 | | extra | more |\n'],
  ['header_id_whole_cell', '| id | 规则 | 理由 | 范围 | 批准 | 到期 |\n|---|---|---|---|---|---|\n| E1 | a/b | r | s | a | 2026-12-31 |\n'],
  ['header_rule_id_not_ex_id', '| Rule ID | 理由 | 范围 | 批准 | 到期 |\n|---|---|---|---|---|\n| a/b | r | s | a | 2026-12-31 |\n'],
  ['header_valid_until_expires', '| 编号 | 规则 | 理由 | 范围 | 批准 | 到期 / valid until |\n|---|---|---|---|---|---|\n| E1 | a/b | r | s | a | 2026-12-31 |\n'],
  ['header_provider_not_id', '| Provider | 规则 | 理由 | 范围 | 批准 | 到期 |\n|---|---|---|---|---|---|\n| X | a/b | r | s | a | 2026-12-31 |\n'],
  ['header_dup_columns', '| 编号 | 规则 | 规则说明 | 理由 | 范围 | 批准 | 到期 |\n|---|---|---|---|---|---|---|\n| E1 | a/b | zzz | r | s | a | 2026-12-31 |\n'],
  ['header_dup_three', '| 规则 | 规则 | 规则 | 理由 | 范围 | 批准 | 到期 |\n|---|---|---|---|---|---|---|\n| a/b | c/d | e/f | r | s | a | 2026-12-31 |\n'],
  ['header_no_expires_column', '| 编号 | 规则 | 理由 | 范围 | 批准 |\n|---|---|---|---|---|\n| E1 | a/b | r | s | a |\n'],
  ['header_no_rule_column', '| 编号 | 理由 | 范围 | 批准 | 到期 |\n|---|---|---|---|---|\n| E1 | r | s | a | 2026-12-31 |\n'],
  ['header_english_only', '| ID | Rule | Reason | Scope | Approver | Expires |\n|---|---|---|---|---|---|\n| E1 | a/b | r | s | a | 2026-12-31 |\n'],
  ['table_second_ignored', HDR + '| E1 | a/b | r | s | a | 2026-12-31 | |\n\n文字\n\n' + HDR + '| E9 | x/y | | | | | |\n'],
  ['table_after_text', '# 例外登记\n\n说明文字。\n\n' + HDR + '| E1 | a/b | r | s | a | 2026-12-31 | |\n'],
  ['table_sep_with_colons', '| 编号 | 规则 | 理由 | 范围 | 批准 | 到期 |\n|:--|:-:|--:|---|---|---|\n| E1 | a/b | r | s | a | 2026-12-31 |\n'],
  ['table_sep_bad', '| 编号 | 规则 |\n| -- | x |\n| E1 | a/b |\n'],
  ['table_no_leading_pipe_header', '编号 | 规则 | 理由 | 范围 | 批准 | 到期\n---|---|---|---|---|---\nE1 | a/b | r | s | a | 2026-12-31\n'],
  ['table_row_escape_pipe', HDR + '| E1 | a/b | 理由 \\| 含竖线 | s | a | 2026-12-31 | |\n'],
  ['table_ends_at_blank', HDR + '| E1 | a/b | r | s | a | 2026-12-31 | |\n\n| E2 | c/d | | | | | |\n'],
  ['no_table', '# 只有文字\n\n没有表。\n'],
  ['empty', ''], ['only_header_no_sep', '| 编号 | 规则 |\n'],
  ['only_header_and_sep', '| 编号 | 规则 | 理由 | 范围 | 批准 | 到期 |\n|---|---|---|---|---|---|\n'],
  ['bom', '\ufeff' + HDR + '| E1 | a/b | r | s | a | 2026-12-31 | |\n'],
  ['crlf', (HDR + '| E1 | a/b | r | s | a | 2026-12-31 | |\n').replaceAll('\n', '\r\n')],
  ['chinese_status_closed', HDR + '| E1 | a/b | r | s | a | 2026-12-31 | 已关闭（2026-09-01）|\n'],
  ['rule_with_spaces_and_ticks', HDR + '| E1 |  ` a/b `  | r | s | a | 2026-12-31 | |\n'],
  ['rule_slash_only', HDR + '| E1 | / | r | s | a | 2026-12-31 | |\n'],
  ['rule_trailing_slash', HDR + '| E1 | layout/ | r | s | a | 2026-12-31 | |\n'],
  ['rule_unicode_key', HDR + '| E1 | drift/future-date/docs/a.md｜2099-01-01 | r | s | a | 2026-12-31 | |\n'],
  ['id_with_spaces', HDR + '| E 1 | a/b | | s | a | 2026-12-31 | |\n'],
  ['id_empty_with_missing', HDR + '| | a/b | | s | a | 2026-12-31 | |\n'],
  ['approver_whitespace_only', HDR + '| E1 | a/b | r | s |   | 2026-12-31 | |\n'],
  ['two_missing_plus_expires', HDR + '| E1 | a/b | | | a | 年底 | |\n'],
])

test('样本清单与黄金样本一致：条数相同、名字一一对应', () => {
  assert.equal(SAMPLES.size, gold.load.length)
  assert.deepEqual([...SAMPLES.keys()].sort(), gold.load.map((x) => x.name).sort())
  assert.deepEqual(gold.table.map((x) => x.name).sort(), [...SAMPLES.keys()].sort())
})
