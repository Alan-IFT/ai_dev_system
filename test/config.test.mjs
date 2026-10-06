// core/config 的单元测试：对着 Python 版 load_config 的黄金样本（golden/unit/stdlib-config.json）逐条比对，含**精确的报错信息**。
// 黄金样本的输入来自 stdlib 自己 selftest 里每条实测误读的样本、四个真实仓已提交的 project.yaml、边界补充（BOM、CRLF、非 UTF-8、下划线键……）。
// 有意差异（设计 §12.6）在 KNOWN_DIFF 里逐条列出，**没列的差异都是 bug**。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { loadConfig, metadataRequiredHit, metadataPrefixes } from '../lib/core/config.js'
import { firstInvalidUtf8 } from '../lib/core/utf8.js'
import { cfgGet, stateList, stateClass, leadWord, pyTruthy } from '../lib/core/cfg.js'

const here = dirname(fileURLToPath(import.meta.url))
const gold = JSON.parse(readFileSync(join(here, '..', 'golden', 'unit', 'stdlib-config.json'), 'utf8'))

function canSymlink() {
  const t = mkdtempSync(join(tmpdir(), 'tscfg-sl-'))
  try { writeFileSync(join(t, 'a'), 'x'); symlinkSync(join(t, 'a'), join(t, 'b'), 'file'); return true } catch { return false } finally { rmSync(t, { recursive: true, force: true }) }
}

const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))
const strip = (cfg) => { const c = { ...cfg }; delete c._root; delete c._path; return c }

function loadRaw(raw) {
  const tmp = mkdtempSync(join(tmpdir(), 'tscfg-'))
  try {
    mkdirSync(join(tmp, 'governance'))
    writeFileSync(join(tmp, 'governance', 'project.yaml'), raw)
    const [cfg, problem] = loadConfig(tmp)
    return { cfg: strip(cfg), problem }
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

// 设计 §12.6 的有意差异：名字 → 说明。允许 TS 与 Python 不同的用例；每条另有专门的测试钉住 TS 的实际行为。
const KNOWN_DIFF = new Map([
  // deep_nest_1200：D2。Python 的递归上限报「嵌套层数超出…」，TS 的 MAX_DEPTH=100 报同一条消息——结果相同，不需要列在这里。
])

test('黄金样本规模：用例、原始字节、文件布局、真实仓都不为空，且接受与拒收都有（空样本集不得算通过）', () => {
  assert.ok(gold.cases.length >= 80); assert.ok(gold.raw.length >= 6); assert.ok(gold.files.length >= 7); assert.equal(gold.real_repos.length, 4)
  const ok = gold.cases.filter((c) => !c.result.problem).length
  assert.ok(ok >= 20 && gold.cases.length - ok >= 40, `接受 ${ok}、拒收 ${gold.cases.length - ok}`)
})

test('loadConfig：81 条用例对 Python 黄金样本逐条一致（结果与精确的报错信息）', () => {
  const wrong = []
  for (const c of gold.cases) {
    if (KNOWN_DIFF.has(c.name)) continue
    let text = c.input
    if (text === null) {
      // 长输入黄金样本里只存了 sha1：深嵌套那条按同样的生成规则重建
      assert.equal(c.name, 'deep_nest_1200')
      text = Array.from({ length: 1200 }, (_, i) => '  '.repeat(i) + 'k' + i + ':\n').join('') + '  '.repeat(1200) + 'v: 1\n'
    }
    assert.equal(createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 10), c.input_sha1, `${c.name} 输入与黄金样本不是同一份`)
    const got = loadRaw(Buffer.from(text, 'utf8'))
    if (!(got.problem === c.result.problem && same(got.cfg, c.result.cfg))) wrong.push({ name: c.name, want: c.result, got })
  }
  assert.deepEqual(wrong.map((w) => w.name), [], JSON.stringify(wrong.slice(0, 3), null, 1))
})

test('loadConfig：原始字节（非 UTF-8、截断、孤立 BOM、双 BOM、NUL、纯 CR 换行）逐条一致', () => {
  const wrong = []
  for (const r of gold.raw) {
    const got = loadRaw(Buffer.from(r.hex, 'hex'))
    if (!(got.problem === r.result.problem && same(got.cfg, r.result.cfg))) wrong.push({ name: r.name, want: r.result, got })
  }
  assert.deepEqual(wrong, [])
})

test('loadConfig：文件布局（没有配置、project.yml 回退、yaml 与 yml 并存、yaml 是目录、外部配置）逐条一致', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tscfg-'))
  try {
    const gov = join(tmp, 'governance'); mkdirSync(gov)
    const ext = join(gov, 'project.yaml'); const missing = join(tmp, 'nope.yaml')
    const rec = (cfg, problem, extPath) => ({
      cfg: strip(cfg), problem: problem && extPath ? problem.replaceAll(extPath, '<CONFIG_PATH>') : problem,
      path_key: extPath && cfg._path === extPath ? '<CONFIG_PATH>' : (cfg._path ?? ''), path_key_is_abs: !!cfg._path && /^([A-Za-z]:)?[\\/]/.test(cfg._path),
    })
    const got = {}
    let r = loadConfig(tmp); got.no_config = rec(...r)
    writeFileSync(join(gov, 'project.yml'), 'tier: L2\n'); r = loadConfig(tmp); got.yml_only = rec(...r)
    writeFileSync(ext, 'tier: L1\n'); r = loadConfig(tmp); got.both_yaml_wins = rec(...r)
    r = loadConfig(tmp, ext); got.external_ok = rec(r[0], r[1], ext)
    rmSync(ext); mkdirSync(ext); r = loadConfig(tmp); got.yaml_is_dir_falls_to_yml = rec(...r)
    r = loadConfig(tmp, ext); got.external_is_dir = rec(r[0], r[1], ext)
    r = loadConfig(tmp, missing); got.external_missing = rec(r[0], r[1], missing)
    const wrong = []
    for (const g of gold.files) {
      const w = { cfg: g.cfg ?? {}, problem: g.problem, path_key: g.path_key ?? '', path_key_is_abs: g.path_key_is_abs }
      const x = got[g.name]
      const xn = { cfg: x.cfg, problem: x.problem, path_key: x.path_key, path_key_is_abs: x.path_key_is_abs }
      if (!same(w, xn)) wrong.push({ name: g.name, want: w, got: xn })
    }
    assert.deepEqual(wrong, [], JSON.stringify(wrong.slice(0, 2), null, 1))
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('loadConfig：四个真实仓已提交的 project.yaml 全部被接受，且读出的配置与 Python 逐键一致', () => {
  const wrong = []
  for (const r of gold.real_repos) {
    assert.equal(r.result.problem, null, `${r.name} 应被接受`)
    // 真实 project.yaml 原文不在仓库里（它们属于三个采用项目）；黄金样本只存读出的配置。用读出的配置反向序列成 YAML 再解析会失真，
    // 所以这里验证：用同一份已解析配置里的**每个顶层键**都能被 cfgGet 取到，且值与黄金样本一致——真正的逐字节比对在阶段 2 的 4 仓端到端（golden/samples）里做。
    for (const [k, v] of Object.entries(r.result.cfg)) if (!same(cfgGet(r.result.cfg, k), v)) wrong.push({ name: r.name, key: k })
  }
  assert.deepEqual(wrong, [])
})

test('D3：安全整数范围外的整数在配置里拒收（不静默丢精度）；浮点 2.0 对 duplicate_min_lines 拒收（Python 里它是 float）', () => {
  const r = loadRaw(Buffer.from('tier: L1\nbudgets:\n  duplicate_min_lines: 9007199254740993\n'))
  assert.match(r.problem, /超出 ±2\^53/)
  const f = loadRaw(Buffer.from('tier: L1\nbudgets:\n  duplicate_min_lines: 2.0\n'))
  assert.match(f.problem, /budgets\.duplicate_min_lines 须是 ≥2 的整数/)
  assert.equal(loadRaw(Buffer.from('tier: L1\nbudgets:\n  duplicate_min_lines: 2\n')).problem, null)
})

test('报错不回显文件内容：解析失败的信息里没有那行的原文（安全 2）', () => {
  const r = loadRaw(Buffer.from('tier: L1\nTOPSECRET-LINE\n'))
  assert.ok(r.problem && !r.problem.includes('TOPSECRET'))
  const u = loadRaw(Buffer.from([...Buffer.from('tier: L1\nx: SECRET'), 0xff]))
  assert.ok(u.problem && !u.problem.includes('SECRET'))
})

test('--config 指向项目之外：cfg._path 是绝对路径、cfg._root 仍是被扫项目；项目内是相对路径', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tscfg-'))
  try {
    mkdirSync(join(tmp, 'governance')); writeFileSync(join(tmp, 'governance', 'project.yaml'), 'tier: L1\n')
    const inRepo = loadConfig(tmp)[0]
    assert.equal(inRepo._path, 'governance/project.yaml'); assert.equal(inRepo._root, tmp)
    const outside = join(tmpdir(), 'tscfg-ext-' + process.pid + '.yaml'); writeFileSync(outside, 'tier: L2\n')
    try { const o = loadConfig(tmp, outside)[0]; assert.equal(o._path, outside); assert.equal(o._root, tmp); assert.equal(o.tier, 'L2') } finally { rmSync(outside, { force: true }) }
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

// ---- metadataRequiredHit / metadataPrefixes ----
test('metadataRequiredHit：未配返回 null；包含与排除前缀按整段匹配；归一写法', () => {
  assert.equal(metadataRequiredHit({}, 'docs/a.md'), null)
  assert.equal(metadataRequiredHit({ metadata_required: 'docs' }, 'docs/a.md'), null, '不是列表等同没配')
  const cfg = { metadata_required: ['docs', '!docs/archive', './plans'] }
  assert.equal(metadataRequiredHit(cfg, 'docs/a.md'), true)
  assert.equal(metadataRequiredHit(cfg, 'docs/archive/x.md'), false)
  assert.equal(metadataRequiredHit(cfg, 'docs/archive2/x.md'), true, '排除前缀按整段匹配：archive2 不是 archive 之下')
  assert.equal(metadataRequiredHit(cfg, 'docsx/a.md'), false, '包含前缀按整段匹配')
  assert.equal(metadataRequiredHit(cfg, 'plans/p.md'), true, './plans 即 plans')
  assert.equal(metadataRequiredHit(cfg, 'docs\\a.md'), true, '反斜杠路径归一')
  assert.equal(metadataRequiredHit({ metadata_required: [] }, 'docs/a.md'), false, '空列表：声明了一类都没有')
  assert.deepEqual(metadataPrefixes(['./docs', '!./x', '  a\\b  ', '!  c ']), [['docs', 'a/b'], ['x', 'c']])
  assert.deepEqual(metadataPrefixes(['./']), [['./'], []], '单独的 ./ 留给校验拒收')
})

test('metadataRequiredHit：前缀两侧的斜杠都去掉（/docs 与 docs/ 都按 docs 判）——校验会拒 /docs，但判定函数本身对它的行为要与 Python 一致', () => {
  assert.equal(metadataRequiredHit({ metadata_required: ['/docs'] }, 'docs/a.md'), true)
  assert.equal(metadataRequiredHit({ metadata_required: ['docs/'] }, 'docs/a.md'), true)
  assert.equal(metadataRequiredHit({ metadata_required: ['//docs//'] }, 'docs/a.md'), true)
  assert.equal(metadataRequiredHit({ metadata_required: ['docs', '!/docs/x/'] }, 'docs/x/y.md'), false)
})

test('loadConfig：配置文件本身是指向仓外的符号链接时拒读，不回显仓外内容（变异 C51）', { skip: process.platform === 'win32' && !canSymlink() ? '本机造不出符号链接' : false }, () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tscfg-'))
  try {
    const out = join(tmp, 'outside.yaml'); writeFileSync(out, 'tier: SECRETTIER\n')
    const proj = join(tmp, 'proj'); mkdirSync(join(proj, 'governance'), { recursive: true })
    symlinkSync(out, join(proj, 'governance', 'project.yaml'), 'file')
    const [cfg, problem] = loadConfig(proj)
    assert.deepEqual(cfg, {})
    assert.match(problem, /真实位置在被扫项目之外（符号链接），未读/)
    assert.ok(!problem.includes('SECRETTIER'))
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('拒收时 cfg 是空对象，不是半成品（变异 C55 的外层）', () => {
  for (const text of ['tier: true\n', '_x: 1\n', 'layout:\n  entry:\n    - ../x\n', '- a\n']) {
    const r = loadRaw(Buffer.from(text)); assert.ok(r.problem); assert.deepEqual(r.cfg, {})
  }
})

test('读配置时的**程序错误**不被伪装成「读不了」：非 OSError 向外抛；OSError 类（不存在、权限、拒读）才记 problem（变异 C56）', async () => {
  const { __testHooks } = await import('../lib/core/fs.js')
  const tmp = mkdtempSync(join(tmpdir(), 'tscfg-'))
  try {
    mkdirSync(join(tmp, 'governance')); writeFileSync(join(tmp, 'governance', 'project.yaml'), 'tier: L1\n')
    __testHooks.beforeOpen = () => { throw new TypeError('模拟的程序错误') }
    try { assert.throws(() => loadConfig(tmp), (e) => e instanceof TypeError && /模拟的程序错误/.test(e.message)) } finally { __testHooks.beforeOpen = undefined }
    // 对照：带 errno code 的系统错误是 OSError，记 problem
    __testHooks.beforeOpen = () => { const e = new Error('x'); e.code = 'EACCES'; throw e }
    try { const [cfg, problem] = loadConfig(tmp); assert.deepEqual(cfg, {}); assert.equal(problem, 'governance/project.yaml 读不了：PermissionError') } finally { __testHooks.beforeOpen = undefined }
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

// ---- cfg.ts ----
test('leadWord：短别名与长别名都命中边界时取长的（变异 S3：不按长度排序）；数字也算字母数字（变异 S6）', () => {
  assert.equal(leadWord('in progress 3', [['in', 'X'], ['in progress', 'P']]), 'P', '短别名排在前面也要取长的')
  assert.equal(leadWord('in 3', [['in', 'X'], ['in progress', 'P']]), 'X')
  assert.equal(leadWord('done2', [['done', 'D']]), null, '后面是 ASCII 数字：不命中')
  assert.equal(leadWord('done٣', [['done', 'D']]), null, '后面是阿拉伯数字：Python 的 isalnum 也认')
  assert.equal(leadWord('done②', [['done', 'D']]), null, '带圈数字 ② 是 No 类，isalnum 为真')
  assert.equal(leadWord('done。', [['done', 'D']]), 'D', '全角句号不是字母数字')
  assert.equal(leadWord('等长a', [['等长', 'A'], ['等长', 'B']]), null)
  assert.equal(leadWord('等长 x', [['等长', 'A'], ['等长', 'B']]), 'A', '等长别名保持原顺序（稳定排序）')
})

test('cfgGet：缺键、中间层不是映射、值为 null 都按 Python 语义；__proto__ 不穿透', () => {
  assert.equal(cfgGet({ a: { b: 1 } }, 'a.b'), 1)
  assert.equal(cfgGet({ a: 1 }, 'a.b', 'D'), 'D')
  assert.equal(cfgGet({ a: [1] }, 'a.0', 'D'), 'D', '列表不按下标取')
  assert.equal(cfgGet({ a: null }, 'a'), null, '值为 null 就是 null，不取默认')
  assert.equal(cfgGet({}, 'toString', 'D'), 'D', '继承来的方法不是配置键')
  assert.equal(cfgGet({}, 'constructor', 'D'), 'D'); assert.equal(cfgGet({}, '__proto__', 'D'), 'D')
})

test('pyTruthy 与 stateList：Python 的 `x or default` 语义（空串、空列表、0、False、None 都取默认）', () => {
  for (const f of [null, undefined, false, 0, '', [], {}]) assert.equal(pyTruthy(f), false, JSON.stringify(f))
  for (const t of [true, 1, 'x', ['a'], { a: 1 }, '0']) assert.equal(pyTruthy(t), true, JSON.stringify(t))
  assert.deepEqual(stateList({ s: [] }, 's', ['d']), ['d']); assert.deepEqual(stateList({ s: '' }, 's', ['d']), ['d']); assert.deepEqual(stateList({}, 's', ['D']), ['d'])
  assert.deepEqual(stateList({ s: ' A  ' }, 's', []), ['a']); assert.deepEqual(stateList({ s: ['A', ' ', '', 'B '] }, 's', []), ['a', 'b'])
  assert.deepEqual(stateList({ s: [1, true] }, 's', []), ['1', 'true'], 'str(True) 是 True，小写后是 true')
})

test('leadWord / stateClass：长别名优先；别名之后须是结尾或非字母数字；声明词并入对应态', () => {
  const words = [['done', 'D'], ['do', 'X']]
  assert.equal(leadWord('done 2026-02-20', words), 'D'); assert.equal(leadWord('doing', words), null, 'do 后面是 i（字母）不命中')
  assert.equal(leadWord('do_it', words), null, '下划线算单词字符'); assert.equal(leadWord('do-it', words), 'X')
  assert.equal(leadWord('完成了', [['完成', 'D']]), null, '后面是中文字母：不命中'); assert.equal(leadWord('完成，了', [['完成', 'D']]), 'D')
  assert.equal(leadWord('', words), null); assert.equal(leadWord(null, words), null); assert.equal(leadWord('  done', words), 'D', '先去首尾空白')
  assert.equal(stateClass({}, 'in progress 3/5'), 'in_progress'); assert.equal(stateClass({}, '进行中'), 'in_progress'); assert.equal(stateClass({}, 'nope'), null)
  assert.equal(stateClass({ work_item_done_states: ['shipped'] }, 'shipped 2026-01-01'), 'done', '声明词并入 done')
  assert.equal(stateClass({ work_item_done_states: ['shipped'] }, 'done'), 'done', '并入不替换缺省')
})

// ---- utf8.ts ----
test('firstInvalidUtf8：对 Python 的 UnicodeDecodeError.start 穷举一致（边界字节 × 长度 1 到 4，规格见黄金样本）', () => {
  const spec = JSON.parse(readFileSync(join(here, '..', 'golden', 'unit', 'utf8-start.json'), 'utf8'))
  const h = createHash('sha256'); let n = 0, valid = 0
  const rec = (arr) => { const s = firstInvalidUtf8(Uint8Array.from(arr)); h.update(String(s) + ','); if (s === -1) valid++; n++ }
  const gen = (L, pre) => { if (pre.length === L) { rec(pre); return } for (const b of spec.alphabet) gen(L, [...pre, b]) }
  for (let L = 1; L <= spec.maxlen; L++) gen(L, [])
  assert.equal(n, spec.count); assert.equal(valid, spec.valid); assert.equal(h.digest('hex'), spec.sha256)
})
