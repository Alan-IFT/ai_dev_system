// 派生工件：由源机械生成，且自己说清自己是派生物。对应 tools/std/checks/check_derived.py；契约见 tools/std/CONTRACT.md。
// 执行 01 §3.4（派生关系的核对方式）与 02 §9（派生工件按缓存处理）。
//
// 迁移约束：与 Python 版逐 id 相同（黄金样本）。动笔前对每个 Python 字符串、正则、容器操作都问过「JS 里对应的在非 ASCII、非 BMP、边界值上等价吗」并在 Python 上实测（设计 §12.22）：
//   `str.isdigit()`            → `[\p{Nd}\p{No}]` 才与 Python 的 isdigit 一致（`²` 也是 True）；后接 `int()`：`²` 抛 ValueError，全角/阿拉伯数字被 int 接受。**git 的 %ct 只会是 ASCII 数字**，所以这里只认 ASCII（D19 同类）
//   `.lower()`                 → `toLowerCase()`（两边对全部码点一致；`İ` 变两个码点，本文件的标记词都是 ASCII/中文，不依赖偏移）
//   `s[:200]`                  → `headChars(s, 200)`（D18，按码点）
//   `splitlines()`             → `splitLinesPy`（认 \x0c、\u2028 等）；`strip()` → `pyStrip`（D6）
//   `bytes.decode("utf-8","ignore")` → `decodeUtf8Ignore`（保留原文的 U+FFFD 与开头 BOM，无效序列整个丢掉；不能用 Node 的宽松 TextDecoder，见 core/utf8）
//   `re.escape(name)` + ASCII 边界 → 手写转义 + `(?<![A-Za-z0-9_.-])…(?!\.?[A-Za-z0-9_-])`

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cfgGet, pyStr, pyTruthy, type Config } from '../core/cfg.js'
import { headChars } from '../core/docs.js'
import { FAIL, PASS, SKIP, UNDETERMINED, finding, pyStrip, type Finding } from '../core/finding.js'
import { gitFixture, writeText } from '../core/fixture.js'
import { isFile, readBytes } from '../core/fs.js'
import { hardenedEnv, shallowProblem } from '../core/git.js'
import { probe, probeCrashed, runGuarded } from '../core/shell.js'
import { decodeUtf8Ignore } from '../core/utf8.js'
import { splitLinesPy } from '../core/yaml.js'

export const NAME = 'derived-artifacts'
export const STANDARD_REFS = ['01 §3.4', '02 §9']

const HEADER_LINES = 30 // 自我声明只看头部这么多行（02 §9.1 说的是「头部声明」）
const HEADER_MAX_BYTES = 8192
const GIT_TIMEOUT_MS = 60_000

// 02 §9.1 的门槛是两件事：说清**权威是谁**，并记 source_rev。只说「我是自动生成的」不算——接手者仍然不知道该去改哪个文件。所以标记分成两组：
// 1. SOURCE_MARKERS 与源路径/源文件名一起，构成**判 PASS 的唯一依据**。
// 2. GENERATED_MARKERS / GENERATOR_HINTS 只用来**把证据说准**，命中不改变状态。
const SOURCE_MARKERS: readonly string[] = ['source_rev', 'source-rev', 'sourcerev']

/** 「这是生成物」的措辞。命中不足以判 PASS。按子串匹配，所以不列被别的词包含的变体（auto-generated ⊃ generated、regenerate ⊃ regen、请勿手改 ⊃ 勿手改）。 */
const GENERATED_MARKERS: readonly string[] = [
  'source:', 'source =', 'sources:', 'generated', 'do not edit', 'regen',
  '派生', '生成', '自动产出', '不要手改', '勿手改', '不要手工修改', '请勿编辑', '权威是', '权威在',
]

/** 工具链写的产出者署名（HTML 的 `<meta name="generator">`、HTTP 的 X-Generator 等）。**不进判 PASS 的集合**：它说的是「谁生成的」，不是「源是谁」。命中只改措辞，状态仍 FAIL。 */
const GENERATOR_HINTS: readonly string[] = ['name="generator"', "name='generator'", 'x-generator', 'generated-by', 'generator:']

// --------------------------------------------------------------------------
// 本模块自备的小工具
// --------------------------------------------------------------------------

/**
 * 该路径最后一次提交的时间戳。返回 [epoch, null] 或 [null, 原因]。
 * shallow 是本次扫描探测一次的 shallowProblem(root)，不逐条再起子进程（C22）。路径按字面（C02）：`m[1].json` 不许匹配到 `m1.json` 的提交。
 */
export function gitLastCommitEpoch(root: string, relpath: string, shallow: string | null): [number, null] | [null, string] {
  if (shallow) return [null, shallow]
  let r
  try {
    r = spawnSync('git', ['--literal-pathspecs', '-C', root, 'log', '-1', '--format=%ct', '--', relpath], { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, env: hardenedEnv(process.env) as NodeJS.ProcessEnv })
  } catch (exc) {
    return [null, `跑不了 git log：${(exc as Error).message}`]
  }
  if (r.error) return [null, `跑不了 git log：${r.error.message}`]
  if (r.status !== 0) return [null, `git log 退出码 ${r.status}：${headChars(pyStrip(r.stderr ?? ''), 200)}`]
  const first = splitLinesPy(pyStrip(r.stdout ?? ''))[0]
  // Python：`not txt[0].strip().isdigit()` 再 `int(...)`。git 的 %ct 只会是 ASCII 数字，所以只认 ASCII；`²` 这类 isdigit 为真而 int 抛错的输入 git 不会产出
  if (first === undefined || !/^[0-9]+$/.test(pyStrip(first))) return [null, `${relpath} 没有提交记录（未提交或路径写错）`]
  return [Number(pyStrip(first)), null]
}

/** 字节 → 头部文本：含 NUL 判二进制；否则丢掉无效 UTF-8 序列、按 Python 的行终止符取前 HEADER_LINES 行。纯函数，便于对样本逐条比对。 */
export function headerOfBytes(data: Uint8Array): [string, null] | [null, string] {
  if (data.includes(0)) return [null, '是二进制文件，头部声明判不了']
  // 截断在多字节字符中间或夹杂非 UTF-8 字节时丢掉那几个字节；"ignore" 不会抛
  return [splitLinesPy(decodeUtf8Ignore(data)).slice(0, HEADER_LINES).join('\n'), null] // py-semantics-ok: 数组切元素个数，不是字符串切分
}

/** 读文件头部若干行。二进制或读不了时返回 [null, 原因]。 */
export function readHeader(path: string, root: string): [string, null] | [null, string] {
  let data: Buffer
  try {
    data = readBytes(path, root, HEADER_MAX_BYTES)
  } catch (exc) {
    return [null, `读不了：${(exc as Error).message}`]
  }
  return headerOfBytes(data)
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Python 的 re.escape 对同一批元字符转义；其余字符（含空白、中文）在这里的用法里不影响匹配

/**
 * name 作为整段路径/文件名出现在 low 里：前后不能紧挨文件名字符（C15：`api` 不许命中 `rapid`；R2-8：后面接 `.md`、`.bak` 这类扩展名也不算，句末的句号照认）。
 * 只按 ASCII 判边界——`权威是src/map.json` 这种中文紧贴的写法照认。
 */
export function mentions(low: string, name: string): boolean {
  return !!name && new RegExp('(?<![A-Za-z0-9_.-])' + escapeRe(name.toLowerCase()) + '(?!\\.?[A-Za-z0-9_-])').test(low)
}

const pyBasename = (p: string): string => { const i = p.lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1) }

/**
 * 头部是否**指明了源**（02 §9.1 的门槛）。返回命中说明，没有则 null。
 * 只有这个函数的返回值能让检查判 PASS。生成类措辞与生成器署名不走这里。
 */
export function headerDeclares(header: string, sourceRel: unknown): string | null {
  const low = header.toLowerCase()
  const src = pyStr(sourceRel).replaceAll('\\', '/')
  if (mentions(low, src)) return `头部出现源路径 ${src}`
  const base = pyBasename(src)
  if (mentions(low, base)) return `头部出现源文件名 ${base}`
  for (const mark of SOURCE_MARKERS) if (low.includes(mark.toLowerCase())) return `头部出现标记 ${mark}`
  return null
}

/**
 * 头部有没有「这是生成物」的痕迹。**不改变状态，只用来把证据说准。**
 * 返回 [类别, 行号, 原文行]；没有返回 null。生成器署名优先于泛泛的生成措辞，因为它是可引用的原文。
 */
export function headerGenerationHint(header: string): [string, number, string] | null {
  const lines = splitLinesPy(header)
  for (const [group, kind] of [[GENERATOR_HINTS, '生成器署名'], [GENERATED_MARKERS, '生成/派生措辞']] as const) {
    for (let i = 0; i < lines.length; i++) {
      const low = lines[i]!.toLowerCase()
      for (const mark of group) if (low.includes(mark.toLowerCase())) return [kind, i + 1, headChars(pyStrip(lines[i]!), 200)]
    }
  }
  return null
}

// --------------------------------------------------------------------------
// 接口
// --------------------------------------------------------------------------

export function scope(cfg: Config): { covered: string[]; not_covered: string[] } {
  const decls = cfgGet(cfg, 'derived', [])
  const list = pyTruthy(decls) ? decls : []
  const n = Array.isArray(list) ? list.length : 0
  return {
    covered: [
      `只看 project.yaml 的 derived: 声明（本次 ${n} 条）`,
      '每条声明的 artifact / source 是否存在、regen 是否非空',
      'artifact 的 git 最后提交时间是否早于 source 的（陈旧）',
      `artifact 头部 ${HEADER_LINES} 行是否**指明了源**：出现源路径、源文件名或 source_rev 才算（02 §9.1 的门槛是『权威是 X』，只写『自动生成』、只留 <meta name=generator> 不算）`,
    ],
    not_covered: [
      '不看未在 derived: 里声明的派生关系——本工具不猜哪些文件是生成的',
      '不判断派生物内容是否与源一致：那要跑生成器重建再 diff，属运行不属检查',
      '不跑任何 regen 命令，也不校验该命令是否真能跑通',
      '不判断派生物里是否混入了人工内容——机械判不了，只判它有没有自我声明',
      '不看人工批注区（02 §9.3）的隔离是否正确',
      '不比对 source_rev 的值与源的实际版本，只比 git 提交先后',
      '不看工作区未提交的改动：陈旧判据用 git 提交时间，不用文件 mtime',
      '不校验头部写的源路径是不是 derived: 里声明的那一个之外的别的文件——只做字符串出现判定，不解析头部的语义',
    ],
  }
}

export function run(cfg: Config): Finding[] {
  return runGuarded(NAME, doRun, cfg)
}

type Decl = Record<string, unknown>
/** Python 的 `str(item.get(k) or "").strip()`。 */
const field = (item: Decl, k: string): string => pyStrip(pyTruthy(item[k]) ? pyStr(item[k]) : '')

function doRun(cfg: Config): Finding[] {
  const root = (cfg._root as string | undefined) || '.'
  const decls = cfgGet(cfg, 'derived')
  if (!pyTruthy(decls)) {
    return [finding(NAME, SKIP, '项目未声明派生工件', {
      reason: 'governance/project.yaml 没有 derived:；本工具不猜哪些文件是派生的（契约 §5）',
      why: '01 §3.4：派生关系由项目指定主从，不由检查器推定',
    })]
  }
  const items = decls as Decl[]
  const out: Finding[] = []
  const shallow = shallowProblem(root, hardenedEnv(process.env))
  // 同一派生物可配几个源：头部只判一次，指明其中任一个源就算（R2-7）
  const srcs = new Map<string, string[]>()
  for (const item of items) {
    const a = field(item, 'artifact')
    srcs.set(a, [...(srcs.get(a) ?? []), field(item, 'source')])
  }
  items.forEach((item, i) => out.push(...checkOne(root, i + 1, item, shallow, srcs)))
  return out
}

function checkOne(root: string, idx: number, item: Decl, shallow: string | null, srcs: Map<string, string[]>): Finding[] {
  // derived 须是映射组成的列表，loadConfig 已按形状校验拒收别的写法（契约 §5）
  const artifact = field(item, 'artifact'), source = field(item, 'source'), regen = field(item, 'regen')
  const label = `derived[${idx}]（${artifact || '未写 artifact'}）`

  const missing = [['artifact', artifact], ['source', source], ['regen', regen]].filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) {
    return [finding(NAME, UNDETERMINED, `${label} 的声明不完整`, {
      where: artifact || null, kind: 'incomplete-decl', key: artifact || label, reason: `缺：${missing.join('、')}`,
      why: '01 §3.4：派生的核对方式是记源版本并 CI 重建 diff，缺源或缺重建命令就核对不了',
    })]
  }

  const apath = join(root, artifact), spath = join(root, source)
  const problems: string[] = []
  if (!isFile(apath)) problems.push(`artifact 不存在：${artifact}`)
  if (!isFile(spath)) problems.push(`source 不存在：${source}`)
  if (problems.length) {
    return [finding(NAME, UNDETERMINED, `${label} 声明的文件不在`, {
      where: artifact, kind: 'missing-file', key: artifact, reason: problems.join('；'),
      why: '01 §3.4：声明了派生关系但对象缺失，是配置过期还是文件被删，机械判不了', evidence: `regen: ${regen}`,
    })]
  }

  const out: Finding[] = []

  // 陈旧检测：派生物落后于源
  const [aEpoch, aWhy] = gitLastCommitEpoch(root, artifact, shallow)
  const [sEpoch, sWhy] = gitLastCommitEpoch(root, source, shallow)
  if (aEpoch === null || sEpoch === null) {
    out.push(finding(NAME, UNDETERMINED, `${label} 取不到 git 提交时间，陈旧与否未定`, {
      where: artifact, kind: 'no-commit-time', key: artifact, reason: [aWhy, sWhy].filter((x) => x).join('；'),
      why: '01 §3.4：派生物要对账源版本；取不到版本即无法判定，按 N1 记未定', evidence: `git log -1 --format=%ct -- ${artifact} / ${source}`,
    }))
  } else if (aEpoch < sEpoch) {
    out.push(finding(NAME, FAIL, `${label} 落后于源 ${source}`, {
      where: artifact, kind: 'behind', key: `${artifact}|${source}`,
      why: '01 §3.4：派生物记录源的版本、CI 重建后 diff 为零才算一致；落后的派生物默认不作事实（02 §9.4）',
      evidence: `artifact 最后提交 ${aEpoch}，source 最后提交 ${sEpoch}，晚 ${sEpoch - aEpoch} 秒`,
    }))
  } else {
    out.push(finding(NAME, PASS, `${label} 不落后于源`, {
      where: artifact, kind: 'not-behind', key: `${artifact}|${source}`, why: '01 §3.4',
      evidence: `artifact 最后提交 ${aEpoch} ≥ source 最后提交 ${sEpoch}（只比提交先后，不比内容）`,
    }))
  }

  // 自我声明：改它是白改，得让接手者看得见。同一派生物只在它的第一条声明上判
  const sources = srcs.get(artifact)
  srcs.delete(artifact)
  if (sources === undefined) return out
  const [header, hwhy] = readHeader(apath, root)
  if (header === null) {
    out.push(finding(NAME, UNDETERMINED, `${label} 的头部读不了，自我声明未定`, {
      where: artifact, kind: 'header-unreadable', key: artifact, reason: hwhy, why: '02 §9.1：派生工件头部要声明『派生缓存，权威是 X』',
    }))
    return out
  }
  let hit: string | null = null
  for (const x of sources) { const h = headerDeclares(header, x); if (h) { hit = h; break } }
  if (hit) {
    out.push(finding(NAME, PASS, `${label} 头部声明了自己是派生物`, { where: artifact, kind: 'header-declared', key: artifact, why: '02 §9.1', evidence: hit }))
    return out
  }
  const why = '02 §9.1 派生工件头部须声明『派生缓存，权威是 X』并记 source_rev；01 §3.4 派生物不得当成可手改的文档'
  const gen = headerGenerationHint(header)
  if (gen) {
    // 两种事实的第一种：有生成痕迹，但没说源是谁。结论仍是 FAIL——02 §9.1 要的是「权威是 X」，不是「我是自动生成的」。
    const [hint, lineno, line] = gen
    out.push(finding(NAME, FAIL, `${label} 头部有${hint}但未指明源`, {
      where: `${artifact}:${lineno}`, kind: 'header-undeclared', key: artifact, why,
      evidence: `第 ${lineno} 行原文：${line}；但前 ${HEADER_LINES} 行里既没有源路径 ${source}、也没有源文件名 ${pyBasename(source)}、也没有 source_rev——只说了『这是生成的』，没说权威是谁，接手者仍然不知道该回头改哪个文件`,
    }))
  } else {
    // 第二种：完全没有痕迹。
    out.push(finding(NAME, FAIL, `${label} 头部没有任何生成/派生标记`, {
      where: `${artifact}:1`, kind: 'header-undeclared', key: artifact, why,
      evidence: `前 ${HEADER_LINES} 行里既没有源路径 ${source}，也没有任何生成/派生/不要手改一类标记，也没有生成器署名；派生物没有自我声明，接手者无法知道改它是白改——下次重建就覆盖掉`,
    }))
  }
  return out
}

// --------------------------------------------------------------------------
// 自检（契约 §3）
// --------------------------------------------------------------------------

function commit(root: string, rel: string, body: string, when: string): void {
  writeText(join(root, rel), body)
  gitFixture(root, ['add', '--', rel])
  gitFixture(root, ['commit', '-q', '-m', `add ${rel}`], { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when })
}

const SRC = '{"modules": ["inventory", "settlement"]}\n'
const GOOD = '<!-- 派生缓存，权威是 src/map.json；不要手改，改动由下面的命令重建 -->\n<!-- regen: python3 tools/build_map.py -->\n<h1>模块图</h1>\n'
const BAD = '<h1>模块图</h1>\n<p>库存与结算两个模块。</p>\n'
// 只有 <meta name="generator">，既没有源路径也没有 source_rev。这是真实形态：本仓 docs/架构图/ 十份与 RCMS 三份 HTML 的第 6 行都长这样。
// 它必须仍判 FAIL——把 generator 当成「自我声明」会一次性制造十几条假 PASS。
const GENERATOR_ONLY = '<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="utf-8">\n  <title>模块图</title>\n  <meta name="generator" content="archify 2.16.0">\n</head>\n<body><h1>模块图</h1></body>\n</html>\n'

function repo(tmp: string): Config {
  gitFixture(tmp, ['init', '-q'])
  return { _root: tmp }
}

const decl = (artifact: string, source: string, regen = 'python3 tools/build_map.py') => ({ artifact, source, regen })
const J = (v: unknown): string => JSON.stringify(v)
const cmpCp = (a: string, b: string): number => {
  const x = [...a], y = [...b]
  for (let i = 0; i < Math.min(x.length, y.length); i++) { const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!; if (d) return d }
  return x.length - y.length
}

export function selftest(): Finding[] {
  const results: Finding[] = []
  const tmps: string[] = []
  const mk = (): string => { const t = mkdtempSync(join(tmpdir(), 'dvself-')); tmps.push(t); return t }
  const guard = (what: string, fn: () => void): void => { try { fn() } catch (exc) { results.push(probeCrashed(NAME, what, exc)) } }
  try {
    guard('反例', () => { // 反例：派生物头部没有自我声明
      const tmp = mk(); const cfg = repo(tmp)
      commit(tmp, 'src/map.json', SRC, '2026-01-01T00:00:00 +0000'); commit(tmp, 'docs/map.html', BAD, '2026-01-02T00:00:00 +0000')
      cfg.derived = [decl('docs/map.html', 'src/map.json')]
      const got = run(cfg).map((f) => f.status)
      results.push(probe(NAME, got.includes(FAIL), '反例：派生物头部无自我声明应判 FAIL', { evidence: `实得 ${J(got)}`, why: '契约 §3 静默失效探测' }))
    })

    guard('浅克隆反例', () => { // 反例（D-123 bug 1）：同一份陈旧样本的浅克隆须记未定——浅克隆里两者的提交时间都是边界提交，旧实现据此判「不落后」，把 FAIL 翻成 PASS
      const tmp = mk(); const src = join(tmp, 'src'), dst = join(tmp, 'dst')
      mkdirSync(src, { recursive: true }); repo(src)
      commit(src, 'docs/map.html', GOOD, '2026-01-01T00:00:00 +0000'); commit(src, 'src/map.json', SRC, '2026-02-01T00:00:00 +0000')
      spawnSync('git', ['clone', '-q', '--depth', '1', 'file://' + (process.platform === 'win32' ? '/' : '') + src.replaceAll('\\', '/'), dst], { timeout: GIT_TIMEOUT_MS })
      const got = run({ _root: dst, derived: [decl('docs/map.html', 'src/map.json')] }).map((f): [string, string] => [f.status, f.id])
      const ok = got.some(([st, id]) => st === UNDETERMINED && id === `${NAME}/no-commit-time/docs/map.html`) && !got.some(([st, id]) => st === PASS && id.includes('不落后'))
      results.push(probe(NAME, ok, '反例：浅克隆下取不到真实提交先后，陈旧与否记未定', { evidence: `实得 ${J(got)}`, why: '01 §2 N1：浅克隆的提交时间是克隆时刻，判不了先后' }))
    })

    guard('反例二', () => { // 反例二：派生物提交早于源（陈旧）
      const tmp = mk(); const cfg = repo(tmp)
      commit(tmp, 'docs/map.html', GOOD, '2026-01-01T00:00:00 +0000'); commit(tmp, 'src/map.json', SRC, '2026-02-01T00:00:00 +0000')
      cfg.derived = [decl('docs/map.html', 'src/map.json')]
      const got = run(cfg).map((f) => f.status)
      results.push(probe(NAME, got.includes(FAIL), '反例二：派生物落后于源应判 FAIL', { evidence: `实得 ${J(got)}`, why: '契约 §3 静默失效探测' }))
    })

    guard('反例三', () => { // 反例三：只有 <meta name="generator">，没有源路径也没有 source_rev。两条断言缺一不可：① 状态仍是 FAIL（防假 PASS）；② 证据不再说「没有任何标记」（防假陈述）。
      const tmp = mk(); const cfg = repo(tmp)
      commit(tmp, 'src/map.json', SRC, '2026-01-01T00:00:00 +0000'); commit(tmp, 'docs/map.html', GENERATOR_ONLY, '2026-01-02T00:00:00 +0000')
      cfg.derived = [decl('docs/map.html', 'src/map.json')]
      const res = run(cfg)
      const hdr = res.filter((f) => f.title.includes('头部'))
      const got = res.map((f) => f.status)
      const ev = hdr.map((f) => f.evidence ?? '').join(' ')
      const ok = hdr.length === 1 && hdr[0]!.status === FAIL && !hdr[0]!.title.includes('没有任何生成/派生标记') && !ev.includes('没有任何生成/派生') && ev.includes('name="generator"')
      results.push(probe(NAME, ok, '反例三：只有生成器署名、未指明源，须仍判 FAIL，且证据须引原文而非说『没有任何标记』',
        { evidence: `实得 ${J(got)}；头部条目 title=${J(hdr[0]?.title ?? null)} evidence=${J(headChars(ev, 200))}`, why: '契约 §3；02 §9.1 的门槛是『权威是 X』，不是『我是自动生成的』' }))
    })

    guard('正例', () => { // 正例：源在前、派生物在后，且头部声明齐全
      const tmp = mk(); const cfg = repo(tmp)
      commit(tmp, 'src/map.json', SRC, '2026-01-01T00:00:00 +0000'); commit(tmp, 'docs/map.html', GOOD, '2026-01-02T00:00:00 +0000')
      cfg.derived = [decl('docs/map.html', 'src/map.json')]
      const got = run(cfg).map((f) => f.status)
      results.push(probe(NAME, got.length > 0 && got.every((s) => s === PASS), '正例：声明齐全且不落后应全判 PASS', { evidence: `实得 ${J(got)}`, why: '契约 §3 静默失效探测' }))
    })

    guard('反例五', () => { // 反例五（C02）：源路径带 [ ] 时 git 按通配解读，会取到 m1.json 更晚的提交，把不落后的派生物判落后
      const tmp = mk(); const cfg = repo(tmp)
      commit(tmp, 'src/m[1].json', SRC, '2026-01-01T00:00:00 +0000'); commit(tmp, 'docs/map.html', '<!-- 权威是 src/m[1].json -->\n', '2026-01-02T00:00:00 +0000'); commit(tmp, 'src/m1.json', SRC, '2026-02-01T00:00:00 +0000')
      cfg.derived = [decl('docs/map.html', 'src/m[1].json', 'make')]
      const got = run(cfg).map((f) => f.status)
      results.push(probe(NAME, J(got) === J([PASS, PASS]), '反例五：源路径带 [ ] 按字面取提交时间，不被通配到别的文件', { evidence: `实得 ${J(got)}`, why: '01 §3.4：陈旧判据比的是声明的那个源' }))
    })

    guard('R2-7 反例', () => { // R2-7：同一派生物对 src/a.json、src/b.json 各声明一条，两条「落后」各有自己的 id，头部只判一次
      const tmp = mk(); const cfg = repo(tmp)
      commit(tmp, 'docs/map.html', BAD, '2026-01-01T00:00:00 +0000'); commit(tmp, 'src/a.json', SRC, '2026-02-01T00:00:00 +0000'); commit(tmp, 'src/b.json', SRC, '2026-02-01T00:00:00 +0000')
      cfg.derived = ['a', 'b'].map((x) => decl('docs/map.html', `src/${x}.json`, 'make'))
      const got = run(cfg).filter((f) => f.status === FAIL).map((f) => f.id).sort(cmpCp)
      const want = [`${NAME}/behind/docs/map.html｜src/a.json`, `${NAME}/behind/docs/map.html｜src/b.json`, `${NAME}/header-undeclared/docs/map.html`]
      results.push(probe(NAME, J(got) === J(want), 'R2-7：一个派生物配两个源，落后按 (派生物, 源) 分开，头部只判一次', { evidence: `实得 ${J(got)}`, why: '契约 §9：两件事两个地址，一件事只报一次' }))
    })

    // 反例六（C15）：源文件名按整段匹配——头部只写了 rapid 的派生物不算指明了源 src/api
    const hits = [headerDeclares('<!-- rapid prototype, generated -->', 'src/api'), headerDeclares('<!-- 权威是src/map.json -->', 'src/map.json'), headerDeclares('<!-- source: ../map.json. -->', 'src/map.json'),
      headerDeclares('<!-- see api.md -->', 'src/api'), headerDeclares('<!-- src/map.json.bak -->', 'src/map.json')]
    results.push(probe(NAME, hits[0] === null && !!hits[1] && !!hits[2] && hits[3] === null && hits[4] === null,
      '反例六：源文件名按路径/词边界匹配，api 不命中 rapid、api.md，map.json 不命中 map.json.bak；中文紧贴、句号收尾照认', { evidence: `实得 ${J(hits)}`, why: '02 §9.1：指明源要指的是那一个文件' }))

    guard('反例四', () => { // 反例四（id 的区分力，契约 §9）：两条派生声明同时缺源文件，两条未定的 id 必须各带自己的 artifact 路径。
      const tmp = mk(); const cfg = repo(tmp)
      commit(tmp, 'docs/a.html', GOOD, '2026-01-01T00:00:00 +0000'); commit(tmp, 'docs/b.html', GOOD, '2026-01-01T00:00:00 +0000')
      cfg.derived = [decl('docs/a.html', 'src/gone-a.json', 'make a'), decl('docs/b.html', 'src/gone-b.json', 'make b')]
      const miss = run(cfg).filter((f) => f.id.startsWith(`${NAME}/missing-file/`))
      // C19：同一条声明挪到第二位，落后、头部两条 FAIL 的 id 不许随 derived[序号] 变
      const t2 = mk(); const cfg2 = repo(t2)
      commit(t2, 'docs/map.html', BAD, '2026-01-01T00:00:00 +0000'); commit(t2, 'src/map.json', SRC, '2026-02-01T00:00:00 +0000')
      const one = decl('docs/map.html', 'src/map.json', 'make')
      // C22：两次扫描各只探测一次浅克隆。Python 在这里替换模块级的 shallow_problem 来计数；TS 的 ESM 导出不可改，改为在 PATH 前放一个计数的 git 包装不现实（Windows），
      // 所以这一项由 test/check-derived.test.mjs 在 POSIX 上用包装验证；这里只验另一半：id 稳定
      const ids = [[one], [decl('', '', ''), one]].map((d) => run({ ...cfg2, derived: d }).filter((f) => f.status === FAIL).map((f) => f.id).sort(cmpCp))
      const stable = J(ids[0]) === J(ids[1]) && J(ids[0]) === J([`${NAME}/behind/docs/map.html｜src/map.json`, `${NAME}/header-undeclared/docs/map.html`])
      const mids = miss.map((f) => f.id)
      const ok = miss.length === 2 && new Set(mids).size === 2 && stable && mids[0]!.endsWith('docs/a.html') && mids[1]!.endsWith('docs/b.html')
      results.push(probe(NAME, ok, '反例四：两条声明各缺自己的源，两条未定的 id 须按 artifact 路径分开；FAIL 的 id 不随声明序号漂',
        { evidence: `实得 ${miss.length} 条：${mids.join('、') || '无'}；序号 1 与 2 时的 FAIL id：${J(ids)}`, why: '契约 §9：id 是例外登记的地址，两件事共用一个地址就会被一行登记一起静音' }))
    })
  } finally {
    for (const t of tmps) rmSync(t, { recursive: true, force: true })
  }
  return results
}
