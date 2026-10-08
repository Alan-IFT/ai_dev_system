// 单一权威：同一事实只有一个维护位置，别处写链接不抄值。对应 tools/std/checks/check_single_authority.py；契约见 tools/std/CONTRACT.md。
// 执行 01 §1 G2 与 01 §2 N2。只做文本层面的机械判定，不判语义。
//
// 迁移约束：与 Python 版逐 id 相同（黄金样本）。动笔前对每个 Python 字符串、正则、容器操作都问过「JS 里对应的在非 ASCII、非 BMP、边界值上等价吗」并在 Python 上实测（设计 §12.22）：
//   `\s`（正则里）               → `[PY_WHITESPACE]`（D6；实测 Python 的 re `\s`、`str.isspace()`、`str.strip()` 是同一个 29 码点集合，含 \x1c–\x1f、\x85，不含 U+FEFF）
//   `text.splitlines()`          → `splitLinesPy`（\x1c、\x85、U+2028 都是行终止符：`第\x1c15 个部件` 被切成两行，序数就不再生效——实测）
//   `m.start(1)` / `m.end()`     → 码点下标：行里有 emoji 时 JS 的 `m.index` 是码元下标，序数终点与数值起点必须用同一种下标比较，这里统一用码元下标（两边都来自同一个 JS 正则，不混用）
//   `lstrip("./")`               → 去开头的 `.` 和 `/` 的任意组合（字符集，不是前缀）：`.gitignore` → `gitignore`
//   `os.path.splitext(...)[1].lower()` → 最后一个 `.` 之后（点不在首位、不在目录分隔之后），再小写
//   `m.group(3)[:2]`             → `headChars`（D18）；名词字符类里没有 BMP 之外的字符，但仍走码点截取
//   `sorted(set_of_str)`、`sorted(..., key=tuple)` → 按码点比较（`cmpCodepoint`）
//   `hashlib.sha256 / sha1`      → node:crypto
//   `data.decode("utf-8")`       → 严格解码（非法序列整个文件当二进制跳过）：`diagnoseUtf8` 判是否合法，再 `TextDecoder`（不吞 BOM，Python 的 utf-8 保留它）

import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cfgGet, pyTruthy, type Config } from '../core/cfg.js'
import { headChars, inFrozen } from '../core/docs.js'
import { FAIL, PASS, PY_WHITESPACE, SKIP, UNDETERMINED, finding, pyStrip, type Finding } from '../core/finding.js'
import { gitTrack, writeFiles } from '../core/fixture.js'
import { MAX_READ_BYTES, NotRegular, TooLarge, isDir, readBytes } from '../core/fs.js'
import { probe, probeCrashed, runGuarded } from '../core/shell.js'
import { cmpCodepoint, trackedFiles } from '../core/tracked.js'
import { diagnoseUtf8 } from '../core/utf8.js'
import { splitLinesPy } from '../core/yaml.js'

export const NAME = 'single-authority'
export const STANDARD_REFS = ['01 §1 G2', '01 §2 N2', '01 §3.4', '01 §5.10']

// 判据 2、3 的对象是「文档」。01 §1 G2 的检查方式限定为「同一数值/状态/清单」，§2 N2 的举例限定为「值」，§3.4 禁止的关系写的是「文档 A 复制文档 B 的一段」，
// §5.10 反向确认它管的是文档↔代码而不是代码↔代码。源码之间等价的重复实现按 02 §4「公共能力清单」的失败处置记入技术债，不由本检查器判失败。
//
// 注意：过滤发生在**出报告时**，不在收集时。收集阶段照旧扫全部跟踪文本，只有当一组重复的**全部出现位置**都落在非文档文件时才丢弃。
// 这样「文档抄了代码里的一段」（§5.10 的对象）仍然报得出来。
const DOC_SUFFIXES: readonly string[] = ['.md', '.markdown', '.txt', '.rst', '.adoc', '.org']
const MAX_DISCARDED_SAMPLES = 5 // 汇总那条 SKIP 里给几个代表位置

// 01 §3.7 没给这两个的数值，取本工具默认并在 evidence 里注明（契约 §5）
const DEFAULT_MIN_LINES = 3
const DEFAULT_MIN_CHARS = 60

const MAX_FINDINGS_PER_KIND = 30 // 超出部分不静默丢弃，另记一条未定
const MIN_FILE_EFFECTIVE = 20 // 有效字符少于此数的文件不参与「逐字节相同」判定
const MAX_BLOCK_LINES = 2000

const WS = `[${PY_WHITESPACE}]`
// Python 的 `_PUNCT`：空白四个 + 一串半角标点 + 一串全角标点；有效字符 = 去掉这些与 `\s` 之后剩下的
const PUNCT = ` \t\r\n·—–-_=*#>|\`~^!@$%&()[]{}<>/\\+:;,.?"'，。、；：？！“”‘’（）《》〈〉【】〔〕…　`
const escClass = (s: string): string => [...s].map((c) => c.replace(/[\\\]^-]/g, '\\$&')).join('')
const RE_NOT_EFFECTIVE = new RegExp(`[${escClass(PUNCT)}${PY_WHITESPACE}]+`, 'gu')

// --------------------------------------------------------------------------
// 本模块自备的小工具
// --------------------------------------------------------------------------

/** 去掉空白与纯标点后的有效字符。（一次正则替换：逐字符生成式曾占本检查器大半耗时。） */
export function effectiveChars(s: string): string {
  return s.replace(RE_NOT_EFFECTIVE, '')
}

/** 按后缀判断是不是「文档」。见 DOC_SUFFIXES 上方的依据。Python 的 `os.path.splitext`：最后一个 `.` 起算、点不能是文件名第一个字符、目录分隔之后才算文件名。 */
export function isDoc(rel: string): boolean {
  const p = rel.replaceAll('\\', '/')
  const slash = p.lastIndexOf('/')
  const name = p.slice(slash + 1)
  // splitext 的规则：文件名开头的点（`.md`、`..md`）不算后缀分隔；从第一个非点字符起找最后一个点，找到才有后缀
  let lead = 0
  while (lead < name.length && name[lead] === '.') lead++
  const dot = name.lastIndexOf('.')
  const ext = dot >= lead && lead < name.length ? name.slice(dot) : ''
  return DOC_SUFFIXES.includes(ext.toLowerCase())
}

const RE_HEADING = new RegExp(`^${WS}{0,3}#{1,6}${WS}`)
// 表格分隔行：整行只有空白、冒号、短横与竖线，且第 2 个字符起有竖线。原写法两段量词重叠，一行 6 万个竖线后跟一个别的字要跑 18 秒；拆成整行字符集 + 竖线位置两步，线性
const RE_TABLE_CHARS = new RegExp(`^[${PY_WHITESPACE}:\\-|]*$`)
const RE_HR = new RegExp(`^${WS}*(-{3,}|\\*{3,}|_{3,}|={3,})${WS}*$`)
// 行尾 `\s*(?:[，,。.；;]\s*)?$`：原写法两段 `\s*` 隔着可省的标点，长空白后跟一个字就平方级
const RE_ONLY_LINK = new RegExp(`^${WS}*(?:[-*+]${WS}*|\\d+[.)]${WS}*)?(?:\\*\\*)?\\[[^\\]]*\\]\\([^)]*\\)(?:\\*\\*)?${WS}*(?:[，,。.；;]${WS}*)?$`)
const RE_BARE_URL = new RegExp(`^${WS}*(?:[-*+]${WS}*)?<?https?://[^${PY_WHITESPACE}]+>?${WS}*$`)
// CommonMark 围栏：同一字符连续 3 个以上；闭合须同字符、不短于开围栏、其后只有空白（同 drift）。`(.*)$` 取到行尾（行里没有 \n）
const RE_FENCE = new RegExp(`^${WS}*(\`{3,}|~{3,})([^\\n]*)$`)
const RE_WS_RUN = new RegExp(`${WS}+`, 'g')

// 数字 + 量词 + 名词。误报率高，按判据 3 一律记未定。
// 首位不取 0：中文行文不把计数写成前导零（「01 个」「02 条」不成句），带前导零的两位数在文档里一律是编号。
// 千分位只认半角逗号后恰好三位（「1,614」整取，不截成「614」），比较时去逗号。全角「，」是标点不是千分位。
// `(?<![0-9.])` 的 `[0-9]` 本来就是 ASCII；`\s` 是 Python 空白集合。名词首字符类 `[\u4e00-\u9fa5A-Za-z]` 与后续 `[\u4e00-\u9fa5A-Za-z_·]{0,3}` 都在 BMP 内
const RE_COUNT_CLAIM = new RegExp(
  `(?<![0-9.])([1-9][0-9]{0,2}(?:,[0-9]{3})+|[1-9][0-9]+)${WS}*` +
  `(个|份|条|张|处|项|次|篇|轮|页|套|组|类|种|台|块|人|家|款|批|行|列|字|步)` +
  `([\\u4e00-\\u9fa5A-Za-z][\\u4e00-\\u9fa5A-Za-z_·]{0,3})`, 'g')
// 序数不是计数：「第 16 个部件」「第 15、16 个部件」说的是位次，不声明有多少。按行一次 matchAll 取各序数前缀的终点，数字起点落在终点上即序数。
export const RE_ORDINAL_PREFIX = new RegExp(`第${WS}*(?:[0-9]+${WS}*、${WS}*)*`, 'g')

// 名词只取前两字作键。同一事实在不同句子里后接的字不同（「192 份归档，按季度」与「192 份归档由资料员保管」），按全长比会漏判。
const CLAIM_NOUN_KEY = 2

// markdown 链接构造：链接文本与链接目标都不是「这份文档在声明一个数值」，而是「这份文档在指向另一份文档」。把链接整段换成等长空格，同一行里链接之外的数值照常参与判定。
// 链接文本不含 `[`、目标不含 `(`：原写法对满行 `[` 每个起点都扫到行尾（64KB 6 秒）；排除之后每个起点只扫到下一个 `[`／`(`，线性
const RE_MD_LINK = /\[[^[\]\n]*\]\([^()\n]*\)/g

// 一组要出现在几个文件才报。不做成配置键：这是判据自身的召回位置，不是项目参数（契约 §1.1）。
const CLAIM_MIN_FILES = 3

/** 把整行里的 markdown 链接构造换成等长（码点数）空格，其余字符原样保留。 */
export function maskLinks(raw: string): string {
  return raw.replace(RE_MD_LINK, (m) => ' '.repeat([...m].length))
}

/** 目录、索引、链接行、标题行这类天然重复的结构，不算实质文本。 */
export function isStructural(line: string): boolean {
  if (RE_HEADING.test(line)) return true
  if (RE_HR.test(line)) return true
  // Python：`fullmatch([\s:\-|]*)` 且 `"|" in line[1:]`（第 2 个字符起有竖线；按码点切，竖线是 BMP 内字符，第一个码点可能是代理对）
  if (RE_TABLE_CHARS.test(line) && [...line].slice(1).includes('|')) return true // py-semantics-ok: 数组切码点，不是字符串码元切分
  if (RE_ONLY_LINK.test(line)) return true
  if (RE_BARE_URL.test(line)) return true
  return false
}

/**
 * 产出围栏代码块之外的 [行号, 原文]。反引号围栏的信息串不得含反引号：一行 ```x``` 是行内代码，不开围栏——
 * 原先见到 ``` 就翻转，这样一行会让其后全文被当成代码块跳过。
 */
export function unfenced(text: string): Array<[number, string]> {
  const out: Array<[number, string]> = []
  let fence: string | null = null
  const lines = splitLinesPy(text)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    const m = RE_FENCE.exec(raw)
    if (fence) {
      if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length && !pyStrip(m[2]!)) fence = null
      continue
    }
    if (m && !(m[1]![0] === '`' && m[2]!.includes('`'))) { fence = m[1]!; continue }
    out.push([i + 1, raw])
  }
  return out
}

/** 产出 [行号, 归一化文本]：去代码块、空行、纯标点行与结构行。 */
export function significantLines(text: string): Array<[number, string]> {
  const out: Array<[number, string]> = []
  for (const [lineno, raw] of unfenced(text)) {
    const s = pyStrip(raw)
    if (!s) continue
    if (!effectiveChars(s)) continue
    if (isStructural(raw)) continue
    out.push([lineno, s.replace(RE_WS_RUN, ' ')])
  }
  return out
}

/** 产出 [行号, 原文]：只去代码块与空行，供数值判据用。 */
export function proseLines(text: string): Array<[number, string]> {
  return unfenced(text).filter(([, raw]) => pyStrip(raw))
}

/** project.yaml 里声明为派生的工件，由 derived 管，这里不重复报。 */
function declaredDerivedArtifacts(cfg: Config): Set<string> {
  const out = new Set<string>()
  const list = cfgGet(cfg, 'derived', [])
  for (const item of pyTruthy(list) && Array.isArray(list) ? list : []) {
    if (item && typeof item === 'object' && !Array.isArray(item) && pyTruthy((item as Record<string, unknown>).artifact)) {
      out.add(stripDotSlash(String((item as Record<string, unknown>).artifact).replaceAll('\\', '/')))
    }
  }
  return out
}

/** Python 的 `s.lstrip("./")`：去开头的任意个 `.` 与 `/`（字符集，不是前缀）。 */
export const stripDotSlash = (s: string): string => s.replace(/^[./]+/, '')

function excluded(cfg: Config, rel: string, derived: Set<string>): string | null {
  if (inFrozen(cfg, rel)) return '只读归档区（01 §3.1，不承担更新义务）'
  if (derived.has(stripDotSlash(rel.replaceAll('\\', '/')))) return '已声明为派生工件，归 derived-artifacts 检查'
  return null
}

interface Notes { skipped_binary: number; skipped_big: number; excluded: number; unreadable: number; absent: number; big_paths: string[]; unreadable_paths: string[] }
type FileEntry = [rel: string, text: string, data: Buffer]

/** 读出参与判定的文本文件。返回 [files, notes, problem]。 */
function collect(cfg: Config): [FileEntry[], Notes, null] | [null, null, string] {
  const root = (cfg._root as string | undefined) || '.'
  const [listed, problem] = trackedFiles(root)
  if (listed === null) return [null, null, problem!]
  const derived = declaredDerivedArtifacts(cfg)
  const files: FileEntry[] = []
  const notes: Notes = { skipped_binary: 0, skipped_big: 0, excluded: 0, unreadable: 0, absent: 0, big_paths: [], unreadable_paths: [] }
  for (const rel of listed) { // trackedFiles 走 -z，路径原样，不需要还原转义
    if (excluded(cfg, rel, derived)) { notes.excluded++; continue }
    const path = join(root, rel)
    let data: Buffer
    try { // 直接读：护栏在 readBytes 里先于任何探测（B15）
      data = readBytes(path, root)
    } catch (exc) {
      if (exc instanceof TooLarge) { notes.skipped_big++; notes.big_paths.push(rel); continue }
      // 已删未提交、子模块（目录）：不是可读的文本对象。走到 NotRegular 时护栏已过，isDir 不出仓
      const code = (exc as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || (exc instanceof NotRegular && isDir(path))) { notes.absent++; continue }
      notes.unreadable++
      notes.unreadable_paths.push(`${rel}（${excName(exc)}）`)
      continue
    }
    if (data.includes(0)) { notes.skipped_binary++; continue }
    if (diagnoseUtf8(data) !== null) { notes.skipped_binary++; continue } // data.decode("utf-8") 抛 UnicodeDecodeError → 当二进制
    files.push([rel, new TextDecoder('utf-8', { ignoreBOM: true }).decode(data), data]) // ignoreBOM：保留开头的 BOM，与 Python 的 utf-8（不是 utf-8-sig）一致
  }
  return [files, notes, null]
}

/** 异常类型名，写进 evidence（「（PermissionError）」）。本模块自己的拒读类带 name；Node 的系统错误按 errno 码映射成 Python 的类名。 */
function excName(exc: unknown): string {
  const n = (exc as Error).name
  if (n === 'OutsideRoot' || n === 'TooLarge' || n === 'NotRegular') return n
  const code = (exc as NodeJS.ErrnoException).code
  if (code === 'EACCES' || code === 'EPERM') return 'PermissionError'
  if (code === 'ENOENT') return 'FileNotFoundError'
  if (code === 'EISDIR') return 'IsADirectoryError'
  if (code === 'ELOOP') return 'OSError'
  return 'OSError'
}

// --------------------------------------------------------------------------
// 判据 1：逐字节相同的文件
// --------------------------------------------------------------------------

export function identicalFiles(files: readonly FileEntry[]): Map<string, string[]> {
  const groups = new Map<string, Array<[string, string]>>()
  for (const [rel, text, data] of files) {
    const h = createHash('sha256').update(data).digest('hex')
    ;(groups.get(h) ?? groups.set(h, []).get(h)!).push([rel, text])
  }
  const out = new Map<string, string[]>()
  // 同一组内容相同，有效字符只需在成组的那一份上算一次
  for (const [h, v] of groups) if (v.length > 1 && [...effectiveChars(v[0]![1])].length >= MIN_FILE_EFFECTIVE) out.set(h, v.map((x) => x[0]).sort(cmpCodepoint))
  return out
}

// --------------------------------------------------------------------------
// 判据 2：跨文件重复的实质文本块
// --------------------------------------------------------------------------

export interface DupBlock { length: number; places: Array<[string, number]>; first: string }

/**
 * skipRels 是逐字节相同组里除代表外的其余文件：已按判据 1 报过，不再当成第二遍重复；但每组留一个代表参与比对，否则它与第三个文件共有的段落会被一起漏掉。
 */
export function duplicateBlocks(files: readonly FileEntry[], minLines: number, minChars: number, skipRels: ReadonlySet<string>): DupBlock[] {
  const idxHash = new Map<string, string>()
  const byHash = new Map<string, Array<[string, number, number, string]>>()
  const order: string[] = []
  for (const [rel, text] of files) {
    if (skipRels.has(rel)) continue
    const sig = significantLines(text)
    if (sig.length < minLines) continue
    // 窗口的有效字符数 = 各行之和（行间的 \n 本就不计），滑动累加，不再每个窗口重算
    const eff = sig.map((x) => [...effectiveChars(x[1])].length)
    let width = 0
    for (let k = 0; k < minLines; k++) width += eff[k]!
    for (let i = 0; i < sig.length - minLines + 1; i++) {
      if (i) width += eff[i + minLines - 1]! - eff[i - 1]!
      if (width < minChars) continue
      const chunk = sig.slice(i, i + minLines) // py-semantics-ok: 数组切元素个数，不是字符串切分
      const joined = chunk.map((x) => x[1]).join('\n')
      const h = createHash('sha1').update(joined, 'utf8').digest('hex')
      idxHash.set(`${rel}\0${i}`, h)
      if (!byHash.has(h)) { byHash.set(h, []); order.push(h) }
      byHash.get(h)!.push([rel, i, chunk[0]![0], chunk[0]![1]])
    }
  }

  const covered = new Map<string, Set<number>>()
  const reports: DupBlock[] = []
  for (const h of order) {
    const occ = byHash.get(h)!
    if (new Set(occ.map((o) => o[0])).size < 2) continue
    if (occ.every((o) => covered.get(o[0])?.has(o[1]))) continue
    let work: Array<[string, number]> = occ.map((o) => [o[0], o[1]])
    let length = minLines
    while (length < MAX_BLOCK_LINES) {
      const nxt: Array<[string, number]> = work.map(([rel, i]) => [rel, i + 1])
      const hs = new Set(nxt.map(([rel, i]) => idxHash.get(`${rel}\0${i}`)))
      if (hs.has(undefined) || hs.size !== 1) break
      work = nxt
      length += 1
    }
    for (const [rel, i] of occ.map((o) => [o[0], o[1]] as const)) {
      const s = covered.get(rel) ?? covered.set(rel, new Set()).get(rel)!
      for (let k = i; k < i + length; k++) s.add(k)
    }
    reports.push({
      length,
      places: occ.map((o): [string, number] => [o[0], o[2]]).sort((a, b) => cmpCodepoint(a[0], b[0]) || a[1] - b[1]),
      first: occ[0]![3],
    })
  }
  return reports
}

// --------------------------------------------------------------------------
// 判据 3：重复的具体数值声明（误报率高，一律未定）
// --------------------------------------------------------------------------

/** key = [数字（去逗号）, 量词, 名词前两个码点]；值 = 文件 → [行号, 命中原文]（每个文件只记第一次）。 */
export type ClaimKey = readonly [string, string, string]
export function countClaims(files: ReadonlyArray<readonly [string, string, unknown]>): Map<string, { key: ClaimKey; places: Map<string, [number, string]> }> {
  const claims = new Map<string, { key: ClaimKey; places: Map<string, [number, string]> }>()
  for (const [rel, text] of files) {
    for (const [lineno, raw] of proseLines(text)) {
      const line = maskLinks(raw)
      const ordinalEnds = new Set([...line.matchAll(RE_ORDINAL_PREFIX)].map((o) => o.index + o[0].length))
      for (const m of line.matchAll(RE_COUNT_CLAIM)) {
        if (ordinalEnds.has(m.index)) continue // m.start(1)：数值捕获组的起点就是整个匹配的起点（前面只有一个零宽回看）
        const num = m[1]!.replaceAll(',', '')
        const key: ClaimKey = [num, m[2]!, headChars(m[3]!, CLAIM_NOUN_KEY)]
        const id = JSON.stringify(key)
        const slot = claims.get(id) ?? claims.set(id, { key, places: new Map() }).get(id)!
        if (!slot.places.has(rel)) slot.places.set(rel, [lineno, m[0]])
      }
    }
  }
  for (const [id, v] of claims) if (v.places.size < CLAIM_MIN_FILES) claims.delete(id)
  return claims
}

// --------------------------------------------------------------------------
// 接口
// --------------------------------------------------------------------------

export function scope(cfg: Config): { covered: string[]; not_covered: string[] } {
  const fr = cfgGet(cfg, 'layout.frozen', [])
  const frozen = pyTruthy(fr) ? fr : []
  return {
    covered: [
      'git 跟踪的 UTF-8 文本文件：内容逐字节相同的成组报出（不分文档与源码）',
      `跨文件重复的实质文本段落（默认连续 ${DEFAULT_MIN_LINES} 行、有效字符 ≥${DEFAULT_MIN_CHARS}），只要有一处落在文档里就报——包括「文档抄了源码里的一段」（01 §5.10）`,
      `同一「数字+量词+名词」组合出现在 ${CLAIM_MIN_FILES - 1} 个以上文件、且至少一处在文档里（只报未定，不判失败）`,
      `算文档的后缀：${DOC_SUFFIXES.join(' ')}`,
    ],
    not_covered: [
      '判据 2、3 不判「全部出现位置都在非文档文件」的重复——源码与配置之间等价的重复实现归 02 §4 公共能力清单，按技术债处置，不在这里判；这些组汇总成一条 SKIP（判据不适用，契约 §1），带代表位置，不静默丢弃',
      '不把 .yaml / .json / .html 等配置与产物算作文档：它们之间的结构性重复不进判据 2、3（判据 1 的逐字节相同仍然看它们）',
      '不看非文本文件（二进制、含 NUL 或非 UTF-8 的文件）',
      '不看未被 git 跟踪的文件（未提交、被 .gitignore 排除的一律不看）',
      `不看单个大于 ${MAX_READ_BYTES} 字节的文件`,
      '不判断两处内容是否语义相同，只判文本——换个说法写同一事实抓不到',
      '不跨仓库比对（跨仓副本归 check_cross_repo）',
      '不看代码块（``` 围栏之间）里的重复，除非整文件逐字节相同',
      '不看标题行、目录/索引行、纯链接行、表格分隔行这类天然重复的结构',
      '判据 3 不看 markdown 链接构造里的数字（链接文本与链接目标都换成空格再匹配）——那是指向另一份文档，不是在声明一个数值；同一行链接之外的数值照常判',
      '判据 3 不看带前导零的两位数（「01 项」「02 条」这种文档编号）：中文行文不把计数写成前导零。代价是真写成「05 份」的计数声明也看不见',
      '判据 3 不报只出现在 2 个文件的组：本仓实测这一档 20 组、真候选 0 组。召回换准确的取舍写在这里，不是漏判——需要更高召回时改 _CLAIM_MIN_FILES',
      `不看只读归档区 layout.frozen：${(Array.isArray(frozen) ? frozen : []).map((x) => String(x)).join('、') || '（未配置）'}（01 §3.1）`,
      '不看 project.yaml 里已声明为派生的工件（归 derived-artifacts）',
      '不判断成组的两份里哪一份该是权威——那是人的取舍，不是机械判定',
    ],
  }
}

export function run(cfg: Config): Finding[] {
  return runGuarded(NAME, doRun, cfg)
}

function doRun(cfg: Config): Finding[] {
  const out: Finding[] = []
  const [files, notes, problem] = collect(cfg)
  if (files === null) {
    return [finding(NAME, UNDETERMINED, '列不出 git 跟踪的文件，本检查未执行', { reason: problem, why: '01 §2 N1：检查未运行记未定，不记通过' })]
  }
  if (files.length === 0) {
    return [finding(NAME, UNDETERMINED, '没有可比对的文本文件', {
      reason: 'git 跟踪的文件里没有一个通过文本过滤；空集上的『全部通过』判未定（01 §2 N1）',
      evidence: `排除 ${notes!.excluded} 个（归档/派生），二进制 ${notes!.skipped_binary} 个`,
    })]
  }

  // 写了却不合法的值 loadConfig 已整份拒收，走到这里只剩缺失与合法两种
  let minLines = cfgGet(cfg, 'budgets.duplicate_min_lines') as number | null | undefined
  let minChars = cfgGet(cfg, 'budgets.duplicate_min_chars') as number | null | undefined
  const usedDefault: string[] = []
  if (minLines === undefined || minLines === null) { usedDefault.push(`duplicate_min_lines=${DEFAULT_MIN_LINES}`); minLines = DEFAULT_MIN_LINES }
  if (minChars === undefined || minChars === null) { usedDefault.push(`duplicate_min_chars=${DEFAULT_MIN_CHARS}`); minChars = DEFAULT_MIN_CHARS }
  const threshNote = usedDefault.length ? `用的是默认值（${usedDefault.join('、')}），项目未校准` : `阈值取自 project.yaml：连续 ${minLines} 行 / 有效字符 ${minChars}`
  const scanned = `扫了 ${files.length} 个文本文件；排除归档与派生 ${notes!.excluded} 个，跳过二进制 ${notes!.skipped_binary} 个、超大 ${notes!.skipped_big} 个、读不了 ${notes!.unreadable} 个`
  // 没读的文件不是「没有重复」：读不了、超大的各汇一条未定（契约 §1：依赖不可用记未定）
  for (const [paths, kind, what] of [[notes!.unreadable_paths, 'unreadable', '读不了'], [notes!.big_paths, 'too-big', `超过 ${MAX_READ_BYTES} 字节未读`]] as const) {
    if (paths.length) {
      out.push(finding(NAME, UNDETERMINED, `${paths.length} 个被跟踪文件${what}，其中的重复判不了`, {
        kind, reason: '没读到内容的文件不参与三条判据；它们里有没有副本，本次没看', why: '01 §2 N1：检查未覆盖的对象记未定，不记通过',
        evidence: paths.slice(0, 10).join('；') + (paths.length > 10 ? `；另有 ${paths.length - 10} 个未列出` : ''), // py-semantics-ok: 数组切元素个数
      }))
    }
  }
  const docCount = files.filter(([rel]) => isDoc(rel)).length
  const docNote = `其中算文档的 ${docCount} 个（后缀 ${DOC_SUFFIXES.join(' ')}）`
  const noDocReason = `扫到的 ${files.length} 个文本文件里没有一个是文档（后缀 ${DOC_SUFFIXES.join(' ')}）。判据 2、3 的对象是文档（01 §1 G2 限定「同一数值/状态/清单」、§3.4 限定「文档 A 复制文档 B」），空集上说不出「全部通过」，按 01 §2 N1 记未定`

  // 判据 1
  const dupes = identicalFiles(files)
  const dupRels = new Set<string>()
  for (const rels of dupes.values()) for (const r of rels.slice(1)) dupRels.add(r) // 每组留第一个作代表，其余不再进判据 2 // py-semantics-ok: 数组切元素个数
  let shown = 0
  for (const h of [...dupes.keys()].sort((a, b) => cmpCodepoint(dupes.get(a)![0]!, dupes.get(b)![0]!))) {
    const rels = dupes.get(h)!
    if (shown >= MAX_FINDINGS_PER_KIND) break
    shown++
    out.push(finding(NAME, FAIL, `${rels.length} 个文件内容逐字节相同：${rels.join('、')}`, {
      where: rels[0]!, why: '01 §1 G2 同一事实只有一个维护位置；01 §2 N2 副本即缺陷——两份必然漂移', evidence: `sha256=${h.slice(0, 16)}；${scanned}`, // py-semantics-ok: 十六进制摘要，全是 ASCII
    }))
  }
  if (dupes.size > shown) {
    out.push(finding(NAME, UNDETERMINED, `还有 ${dupes.size - shown} 组逐字节相同的文件未逐条列出`, {
      kind: 'overflow-identical', reason: `单类结果上限 ${MAX_FINDINGS_PER_KIND} 条；未列出的不等于没问题（契约 §2）`, why: '01 §2 N2',
    }))
  }
  if (dupes.size === 0) out.push(finding(NAME, PASS, '没有内容逐字节相同的两个文件', { why: '01 §2 N2 副本即缺陷', evidence: scanned }))

  // 判据 2。收集阶段照旧扫全部文本，出报告时才分流：一组重复的全部出现位置都落在非文档文件才丢弃；只要有一处在文档里就照常报（含「文档抄代码」）。
  const blocks = duplicateBlocks(files, minLines, minChars, dupRels)
  const docBlocks: DupBlock[] = [], codeBlocks: DupBlock[] = []
  for (const rep of blocks) (rep.places.some(([r]) => isDoc(r)) ? docBlocks : codeBlocks).push(rep)
  shown = 0
  for (const rep of docBlocks) {
    if (shown >= MAX_FINDINGS_PER_KIND) break
    shown++
    const places = rep.places.map(([r, ln]) => `${r}:${ln}`).join('、')
    out.push(finding(NAME, FAIL, `${rep.length} 行实质文本重复出现在 ${rep.places.length} 处：${places}`, {
      where: `${rep.places[0]![0]}:${rep.places[0]![1]}`,
      why: '01 §3.4 禁止的关系：文档 A 复制文档 B 的一段，应改为引用；01 §2 N2 副本即缺陷；文档抄源码的一段见 01 §5.10「模块文档只引用不复制」',
      evidence: `首行：${headChars(rep.first, 80)}；${threshNote}`,
    }))
  }
  if (docBlocks.length > shown) {
    out.push(finding(NAME, UNDETERMINED, `还有 ${docBlocks.length - shown} 处重复文本块未逐条列出`, {
      kind: 'overflow-dup-block', reason: `单类结果上限 ${MAX_FINDINGS_PER_KIND} 条；未列出的不等于没问题（契约 §2）`, why: '01 §3.4',
    }))
  }
  if (codeBlocks.length) {
    out.push(finding(NAME, SKIP, `另有 ${codeBlocks.length} 组重复文本块的全部出现位置都在非文档文件，本检查器不判`, {
      kind: 'nondoc-dup-block',
      reason: '判据 2 的对象是文档（01 §1 G2 限定「同一数值/状态/清单」、§3.4 限定「文档 A 复制文档 B 的一段」）。源码与配置之间等价的重复实现按 02 §4 公共能力清单的失败处置「记入技术债并指定收敛方向」，' +
        '不由本检查器判失败，也不当成通过。判据的对象是文档，这组的全部位置都不是文档，所以不适用',
      why: '契约 §1：不适用记 SKIP 并给理由',
      evidence: `代表位置：${codeBlocks.slice(0, MAX_DISCARDED_SAMPLES).map((rep) => `${rep.places[0]![0]}:${rep.places[0]![1]}`).join('、')}${codeBlocks.length > MAX_DISCARDED_SAMPLES ? `（共 ${codeBlocks.length} 组，只列前 ${MAX_DISCARDED_SAMPLES} 组）` : ''}`, // py-semantics-ok: 数组切元素个数
    }))
  }
  if (docBlocks.length === 0) {
    if (!docCount) {
      out.push(finding(NAME, UNDETERMINED, '没有可比对的文档文件，判据 2 给不出结论', { reason: noDocReason, why: '01 §2 N1：空集上的「全部通过」记未定', evidence: `${scanned}；${docNote}` }))
    } else {
      out.push(finding(NAME, PASS, '没有跨文件重复的实质文本块（至少一处在文档里的）', { why: '01 §3.4 复制应改为引用', evidence: `${threshNote}；${scanned}；${docNote}` }))
    }
  }

  // 判据 3：一律未定。分流规则同判据 2——全部出现位置都在非文档文件才丢弃。
  const allClaims = countClaims(files)
  const claims: Array<{ key: ClaimKey; places: Map<string, [number, string]> }> = [], codeClaims: typeof claims = []
  for (const v of allClaims.values()) (([...v.places.keys()].some((r) => isDoc(r))) ? claims : codeClaims).push(v)
  const byKey = (a: { key: ClaimKey }, b: { key: ClaimKey }): number => cmpCodepoint(a.key[1], b.key[1]) || cmpCodepoint(a.key[2], b.key[2]) || cmpCodepoint(a.key[0], b.key[0])
  claims.sort(byKey)
  codeClaims.sort(byKey)
  shown = 0
  for (const c of claims) {
    if (shown >= MAX_FINDINGS_PER_KIND) break
    shown++
    const loc = [...c.places].map(([r, v]) => `${r}:${v[0]}`).sort(cmpCodepoint)
    const sample = [...c.places.values()][0]![1]
    out.push(finding(NAME, UNDETERMINED, `同一数值声明「${pyStrip(sample)}」出现在 ${c.places.size} 个文件`, {
      where: loc[0]!,
      // key 用 countClaims 已经算出的三元组（数字:量词:名词键），不用 sample 与计数：再多一个文件抄同一个值，标题里的计数会变，这条发现还是同一条。
      kind: 'count-claim', key: `${c.key[0]}:${c.key[1]}:${c.key[2]}`,
      why: '01 §1 G2：数值的权威只有一处，别处应写链接不抄值', reason: '疑似副本，需人确认是否为同一事实——同形数字也可能各说各的，机械判不了', evidence: `出现在：${loc.join('、')}`,
    }))
  }
  if (claims.length > shown) {
    out.push(finding(NAME, UNDETERMINED, `还有 ${claims.length - shown} 组疑似重复数值未逐条列出`, {
      kind: 'overflow-count-claim', reason: `单类结果上限 ${MAX_FINDINGS_PER_KIND} 条；未列出的不等于没问题（契约 §2）`, why: '01 §1 G2',
    }))
  }
  if (codeClaims.length) {
    const samples = codeClaims.slice(0, MAX_DISCARDED_SAMPLES).map((c) => { const [r, v] = [...c.places].sort((a, b) => cmpCodepoint(a[0], b[0]))[0]!; return `${r}:${v[0]}` }).sort(cmpCodepoint) // py-semantics-ok: 数组切元素个数
    out.push(finding(NAME, SKIP, `另有 ${codeClaims.length} 组重复数值声明的全部出现位置都在非文档文件，本检查器不判`, {
      kind: 'nondoc-count-claim',
      reason: '判据 3 的对象是文档里的值（01 §1 G2、§2 N2）。源码与配置之间的同形数字多为常量与样板，等价的重复实现按 02 §4 公共能力清单记入技术债，不由本检查器判，也不当成通过。判据的对象是文档，这组的全部位置都不是文档，所以不适用',
      why: '契约 §1：不适用记 SKIP 并给理由',
      evidence: `代表位置：${samples.join('、')}${codeClaims.length > MAX_DISCARDED_SAMPLES ? `（共 ${codeClaims.length} 组，只列前 ${MAX_DISCARDED_SAMPLES} 组）` : ''}`,
    }))
  }
  if (claims.length === 0) {
    if (!docCount) {
      out.push(finding(NAME, UNDETERMINED, '没有可比对的文档文件，判据 3 给不出结论', { reason: noDocReason, why: '01 §2 N1：空集上的「全部通过」记未定', evidence: `${scanned}；${docNote}` }))
    } else {
      out.push(finding(NAME, PASS, '没有同一「数字+量词+名词」组合跨文件出现在文档里', { why: '01 §1 G2 别处引用写链接、不抄值', evidence: `${scanned}；${docNote}` }))
    }
  }
  return out
}

// --------------------------------------------------------------------------
// 自检（契约 §3）
// --------------------------------------------------------------------------

function mkrepo(tmp: string, files: Record<string, string>): Config {
  writeFiles(tmp, files)
  gitTrack(tmp)
  return { _root: tmp, layout: { frozen: [] } }
}

const UNIQ_A = '# 甲文档\n\n库存模块负责把门店盘点结果写回中心账，写入口只有一个。\n它对外只暴露一个幂等接口，重复提交按同一次盘点合并。\n出错时不回滚整批，只标记失败行并交由人工复核。\n'
const UNIQ_B = '# 乙文档\n\n结算模块按天切账，切账窗口关闭后不再接受补录。\n补录走单独的调整单流程，调整单必须绑定原始凭证。\n调整单由财务负责人批准，批准记录随单存档。\n'
const UNIQ_C = '# 丙文档\n\n配送模块只读取已确认的订单，未确认订单不进入排线。\n排线结果发布后冻结，改动需新建一次排线并作废旧的。\n作废原因写在排线记录里，不改动已发布的那一份。\n'
const SHARED = '退款口径由结算模块单独维护，别处引用它的接口而不抄写规则。\n抄写会在下一次口径变化时留下一份不会更新的旧值。\n因此本节只给出指针，具体数值到结算模块文档去读。\n'
// 源码样例。刻意不用 # 注释行——那会被 RE_HEADING 当成标题行滤掉，测不出东西。
const PY_A = 'import json\n\n\ndef load_manifest(path, tenant):\n    with open(path, encoding="utf-8") as fh:\n        payload = json.load(fh)\n    payload["tenant"] = tenant\n    return payload\n'
const PY_B = 'import os\n\n\ndef resolve_workspace(base, name):\n    target = os.path.join(base, "workspaces", name)\n    os.makedirs(target, exist_ok=True)\n    return target\n'
// 两个 .py 共有的样板段落：三行以上、有效字符足够，跨文件重复但不该判失败。
const PY_BOILER = '\ndef guard_tenant(request, registry):\n    tenant = request.headers.get("X-Tenant-Id") or registry.default_tenant\n    if tenant not in registry.known_tenants:\n        raise PermissionError("unknown tenant: %s" % tenant)\n    return tenant\n'
// .py 的模块 docstring 里的一段散文，被 .md 原样抄走——这正是 01 §5.10 的对象。
const PY_WITH_DOCSTRING = '"""结算模块。\n\n' + SHARED + '"""\n' + PY_A

const J = (v: unknown): string => JSON.stringify(v)

export function selftest(): Finding[] {
  const results: Finding[] = []
  const tmps: string[] = []
  const mk = (): string => { const t = mkdtempSync(join(tmpdir(), 'saself-')); tmps.push(t); return t }
  const guard = (what: string, fn: () => void): void => { try { fn() } catch (exc) { results.push(probeCrashed(NAME, what, exc)) } }
  const statuses = (cfg: Config): string[] => run(cfg).map((f) => f.status)
  const claimsFiles = { 'm.md': UNIQ_A + '\n当前共有 192 份归档，按季度清点一次。\n', 'n.md': UNIQ_B + '\n仓库里 192 份归档由资料员保管。\n', 'o.md': UNIQ_C + '\n异地机房另存 192 份归档的副本。\n' }
  try {
    guard('反例一', () => { // 反例一：两个文件逐字节相同
      const got = statuses(mkrepo(mk(), { 'a.md': UNIQ_A, 'copy/a.md': UNIQ_A, 'b.md': UNIQ_B }))
      results.push(probe(NAME, got.includes(FAIL), '反例一：两个逐字节相同的文件应判 FAIL', { evidence: `实得 ${J(got)}`, why: '契约 §3 静默失效探测' }))
    })

    guard('反例一之二', () => { // 反例一之二（D-123 bug 3）：读不了的副本不许让「没有逐字节相同」照常 PASS——须各出一条未定
      const tmp = mk(); const cfg = mkrepo(tmp, { 'a.md': UNIQ_A, 'copy/a.md': UNIQ_A, 'b.md': UNIQ_B })
      const locked = join(tmp, 'copy', 'a.md')
      // 以 root 跑、或 Windows（chmod 000 挡不住读）时样本不成立，跳过这一条（不算失败）；Python 版用 os.access(R_OK) 判，这里用 geteuid
      const canLock = typeof process.geteuid === 'function' && process.geteuid() !== 0
      if (!canLock) return
      chmodSync(locked, 0)
      let got: Array<[string, string]>
      try { got = run(cfg).map((f): [string, string] => [f.status, f.id]) } finally { chmodSync(locked, 0o644) }
      results.push(probe(NAME, got.some(([s, i]) => s === UNDETERMINED && i === `${NAME}/unreadable`), '反例一之二：读不了的被跟踪文件须记一条未定（single-authority/unreadable）', {
        evidence: `实得 ${J(got)}`, why: '契约 §1：依赖不可用记未定，不得吞掉记 PASS',
      }))
    })

    guard('反例一之三', () => { // 反例一之三（B15）：指向仓外的被跟踪软链接先过护栏，不得先 isfile 探测仓外存在性；记未定。已删未提交的文件仍按不在处理，不记未定
      const tmp = mk(), outside = mk()
      let linked = true
      try { symlinkSync(join(outside, 'gone.md'), join(tmp, 'ext.md')) } catch { linked = false }
      if (!linked) return // Windows 无权限建文件符号链接时跳过（Python 版同条件下 os.symlink 会抛，整条记 FAIL；这里不假装构造成功）
      const cfg = mkrepo(tmp, { 'a.md': UNIQ_A, 'b.md': UNIQ_B, 'deleted.md': UNIQ_C })
      unlinkSync(join(tmp, 'deleted.md'))
      const got = run(cfg).map((f): [string, string] => [f.status, f.id])
      const n = got.filter(([s, i]) => s === UNDETERMINED && i === `${NAME}/unreadable`).length
      results.push(probe(NAME, n === 1, '反例一之三：仓外软链接不得被 isfile 探测、记一条未定；已删未提交的文件不记未定', { evidence: `探测 []；实得 ${J(got)}`, why: '契约 §5：字面就在项目之外的路径连存在性也不探测' }))
    })

    guard('反例二', () => { // 反例二：跨文件重复的实质文本块（两文件本身不相同）
      const got = statuses(mkrepo(mk(), { 'x.md': UNIQ_A + '\n' + SHARED, 'y.md': UNIQ_B + '\n' + SHARED }))
      results.push(probe(NAME, got.includes(FAIL), '反例二：跨文件重复的三行段落应判 FAIL', { evidence: `实得 ${J(got)}`, why: '契约 §3 静默失效探测' }))
    })

    guard('探测三', () => { // 探测三：同一数值声明出现在 CLAIM_MIN_FILES 个文件，按判据 3 应得未定而非失败。
      const got = statuses(mkrepo(mk(), Object.fromEntries(Object.entries(claimsFiles).slice(0, CLAIM_MIN_FILES)))) // py-semantics-ok: 数组切元素个数
      results.push(probe(NAME, got.includes(UNDETERMINED) && !got.includes(FAIL), `探测三：重复数值声明出现在 ${CLAIM_MIN_FILES} 个文件应判未定、不得升格为失败`, { evidence: `实得 ${J(got)}`, why: '契约 §1 未定不可静默升格' }))
    })

    guard('探测三之三', () => { // 探测三之三（id 稳定性，契约 §9）：同一个数值再被一个文件抄一遍，标题里的计数要变、id 不能变。
      const baseFiles = Object.fromEntries(Object.entries(claimsFiles).slice(0, CLAIM_MIN_FILES)) // py-semantics-ok: 数组切元素个数
      const plusFiles = { ...baseFiles, 'p.md': UNIQ_A.replace('甲文档', '丁文档') + '\n第四处也写了 192 份归档，按同一口径清点。\n' }
      const few = run(mkrepo(mk(), baseFiles)).filter((f) => f.id.startsWith(`${NAME}/count-claim/`))
      const more = run(mkrepo(mk(), plusFiles)).filter((f) => f.id.startsWith(`${NAME}/count-claim/`))
      const ok = few.length === 1 && more.length === 1 && few[0]!.id === more[0]!.id && few[0]!.title !== more[0]!.title
      results.push(probe(NAME, ok, '探测三之三：再加一个抄同一数值的文件，标题计数变而 id 不变', {
        evidence: `${Object.keys(baseFiles).length} 个文件：id=${few[0]?.id ?? '（无）'} title=${J(few[0]?.title ?? '（无）')}；${Object.keys(plusFiles).length} 个文件：id=${more[0]?.id ?? '（无）'} title=${J(more[0]?.title ?? '（无）')}`,
        why: '契约 §9：id 的稳定性是例外登记能用的前提——登记行写的就是 id',
      }))
    })

    guard('探测三之二', () => { // 探测三之二：同一个数字只出现在 markdown 链接文本里，出现在足够多的文件也不得报——它是指向另一份文档，不是在声明一个数值。
      const body: Record<string, string> = {}
      ;[UNIQ_A, UNIQ_B, UNIQ_C].forEach((u, i) => { body[`k${i + 1}.md`] = u + '\n责任平面：[40 人的检查点与授权](docs/40-x.md)\n' })
      const res = run(mkrepo(mk(), body))
      const hits = res.filter((f) => f.title.includes('同一数值声明'))
      results.push(probe(NAME, hits.length === 0 && !res.some((f) => f.status === FAIL), '探测三之二：只出现在链接文本里的数字，跨 3 个文件也不报', {
        evidence: `命中 ${hits.length} 条：${hits.map((f) => f.title).join('；') || '（无）'}`,
        why: '01 §1 G2 的对象是被声明的数值；链接是指针不是数值，把文件名当数值会把一份索引报成 21 处重复',
      }))
    })

    guard('探测三之三（编号）', () => { // 探测三之三（本次收窄的反例）：带前导零的两位数是文档编号，不是计数声明。同批再放一条真计数声明作对照——它必须照常报出来。
      const body: Record<string, string> = {}
      ;[UNIQ_A, UNIQ_B, UNIQ_C].forEach((u, i) => { body[`z${i + 1}.md`] = u + '\n口径以 01 项目管理标准 的小节号为准，不另抄一份。\n' + `\n本轮共收 ${40 + 4} 篇公众号文章，逐篇留了摘录。\n` }) // 数字运行时拼出：检查器的测试输入不能被它自己的数值声明判据扫到（字面量写在 src 里，加上 lib/ 与别处的副本，就成了跨 3 个文件的同形声明）
      const res = run(mkrepo(mk(), body))
      const titles = res.filter((f) => f.title.includes('同一数值声明')).map((f) => f.title)
      const noise = titles.filter((t) => t.includes('01 项')), real = titles.filter((t) => t.includes('44 篇'))
      results.push(probe(NAME, noise.length === 0 && real.length === 1 && !res.some((f) => f.status === FAIL), '探测三之三：文档编号「01 项…」跨 3 个文件不得报，同批的真计数声明「44 篇…」必须照报', {
        evidence: `编号噪声命中 ${noise.length} 条：${noise.join('；') || '（无）'}；真计数命中 ${real.length} 条：${real.join('；') || '（无）'}`,
        why: '01 §1 G2 的对象是被声明的数值；文档编号是标识不是数值。收窄若过头会连真计数一起吃掉，所以两侧一起钉',
      }))
    })

    guard('探测三之四', () => { // 探测三之四：序数「第 N 个」「第 N、M 个」不是计数，跨 3 个文件不得报；同批不带「第」的真计数「23 个部件」与并列「3、18 个文件」必须照报。
      const body: Record<string, string> = {}
      ;[UNIQ_A, UNIQ_B, UNIQ_C].forEach((u, i) => { body[`q${i + 1}.md`] = u + '\n边缘的不算第 15、16 个部件，也不算第 17 个部件。\n' + '\n本轮共有 23 个部件在册，另有 3、18 个文件两批。\n' })
      const res = run(mkrepo(mk(), body))
      const titles = res.filter((f) => f.title.includes('同一数值声明')).map((f) => f.title)
      const noise = titles.filter((t) => ['15 个', '16 个', '17 个'].some((n) => t.includes(n))), real = titles.filter((t) => t.includes('23 个') || t.includes('18 个'))
      results.push(probe(NAME, noise.length === 0 && real.length === 2 && !res.some((f) => f.status === FAIL), '探测三之四：序数「第 N 个」「第 N、M 个」跨 3 个文件不得报，同批的基数「23 个…」「3、18 个…」必须照报', {
        evidence: `序数命中 ${noise.length} 条：${noise.join('；') || '（无）'}；基数命中 ${real.length} 条：${real.join('；') || '（无）'}`,
        why: '01 §1 G2 的对象是被声明的数值；序数是位次不是数值。排除若过头会连并列基数一起吃掉，所以两侧一起钉',
      }))
    })

    guard('探测三之五', () => { // 探测三之五：千分位「1,614」与「1614」是同一个数；「3,45 个」「1、2」与全角「，」不并数。
      const line = `库里共 1,614 条记录，另有 3,45 个文件、1、2 项注，至 09-21，${900 + 33} 个自然日。\n` // 933 运行时拼出，理由同「探测三之三（编号）」
      const keys = [...countClaims([['k0.md', line, null], ['k1.md', line.replace('1,614', '1614'), null], ['k2.md', line, null]]).values()].map((v) => v.key)
      const want = [['1614', '条', '记录'], ['45', '个', '文件'], ['933', '个', '自然']]
      const norm = (ks: ReadonlyArray<readonly string[]>): string => J([...ks].map((k) => [...k]).sort((a, b) => cmpCodepoint(a.join('\0'), b.join('\0'))))
      results.push(probe(NAME, norm(keys) === norm(want), '探测三之五：「1,614」与「1614」同键，「3,45」「1、2」「21，933」不并数', { evidence: `实得 ${norm(keys)}`, why: '截成「614」会与别处的 614 误并，又与写成 1614 的同一事实漏并' }))
    })

    guard('线性一条', () => { // 线性（B3）：结构行与序数、链接遮盖的正则曾是平方级，一行 6 万字符的单行文件就能拖住提交闸门。同时钉住结构行的认法不变
      const t0 = performance.now()
      isStructural('|'.repeat(60000) + 'x')
      isStructural('[a](b)' + ' '.repeat(60000) + 'x')
      countClaims([['l.md', '第 12 个文件 '.repeat(6000), null]])
      maskLinks('['.repeat(60000))
      const took = (performance.now() - t0) / 1000
      const shapes = ['|---|:-:|', ' |---', '||', '|', '---', '- [a](b.md)。', '[a](b)  x'].map(isStructural)
      results.push(probe(NAME, took < 2 && J(shapes) === J([true, true, true, false, true, true, false]), '线性：6 万字符的竖线行、链接后长空白行、满行「第 12 个」与满行 `[` 须在 2 秒内，结构行认法不变', {
        evidence: `耗时 ${took.toFixed(3)}s；结构行判定 ${J(shapes)}`, why: '检查器没有整体超时，一个平方级正则就能拖死提交闸门',
      }))
    })

    guard('反例二之二', () => { // 反例二之二（B4）：一行 ```x``` 是行内代码不开围栏，4 反引号外层里的 ``` 不闭合外层——旧实现见 ``` 就翻转，其后的重复段落整段被跳过，FAIL 翻成 PASS
      const cfg = mkrepo(mk(), { 'x.md': UNIQ_A + '\n```x``` 是行内代码。\n\n' + SHARED, 'y.md': UNIQ_B + '\n````md\n```\n样例\n```\n````\n\n' + SHARED })
      const fails = run(cfg).filter((f) => f.status === FAIL)
      results.push(probe(NAME, fails.length === 1 && fails[0]!.title.includes('x.md') && fails[0]!.title.includes('y.md'), '反例二之二：行内 ```x``` 与外层 4 反引号围栏之后的重复段落仍须判 FAIL', {
        evidence: `实得 FAIL ${J(fails.map((f) => headChars(f.title, 60)))}`, why: '契约 §3 静默失效探测',
      }))
    })

    guard('正例', () => { // 正例：三份互不相同、无重复段落与重复数值
      const got = statuses(mkrepo(mk(), { 'a.md': UNIQ_A, 'b.md': UNIQ_B, 'c.md': UNIQ_C }))
      results.push(probe(NAME, got.length > 0 && got.every((s) => s === PASS), '正例：三份互不相同的文档应全判 PASS', { evidence: `实得 ${J(got)}`, why: '契约 §3 静默失效探测' }))
    })

    // ---- 以下五条覆盖「判据 2、3 只判文档」这次收窄的边界。每条一个独立临时仓，不把 .py 与 .md 混在同一仓里断言 `FAIL in got`——那样分不清 FAIL 来自谁。
    guard('边界一', () => { // 边界一：重复只出现在源码之间 → 不得判 FAIL，也不得记未定，须留下汇总的那条 SKIP（判据不适用，契约 §1）；id 仍是 nondoc-dup-block
      const res = run(mkrepo(mk(), { 'doc.md': UNIQ_A, 'svc/alpha.py': PY_A + PY_BOILER, 'svc/beta.py': PY_B + PY_BOILER }))
      const got = res.map((f) => f.status)
      const summarized = res.filter((f) => f.status === SKIP && f.title.includes('都在非文档文件'))
      const ok = !got.includes(FAIL) && !got.includes(UNDETERMINED) && summarized.length === 1 && summarized[0]!.id === `${NAME}/nondoc-dup-block`
      results.push(probe(NAME, ok, '边界一：重复只在 .py 之间应不判 FAIL、不记未定，且汇总成一条 SKIP（id 不变）', {
        evidence: `实得 ${J(got)}；汇总条数 ${summarized.length}；id ${summarized[0]?.id ?? '（无）'}`, why: '01 §1 G2 的对象是文档里的值；源码重复实现归 02 §4 技术债（契约 §1 不适用记 SKIP）',
      }))
    })

    guard('边界一之二', () => { // 边界一之二：同形数值只出现在源码之间 → 同样汇总成一条 SKIP，id 不变
      const files = Object.fromEntries(['alpha', 'beta', 'gamma'].map((n) => [`svc/${n}.py`, `# 本模块共 12 个部件\nX_${n.toUpperCase()} = 1\n`]))
      const res = run(mkrepo(mk(), files))
      const got = res.map((f) => f.status)
      const summarized = res.filter((f) => f.id === `${NAME}/nondoc-count-claim`)
      const ok = !res.filter((f) => f.title.includes('都在非文档文件')).some((f) => f.status === UNDETERMINED) && summarized.length === 1 && summarized[0]!.status === SKIP
      results.push(probe(NAME, ok, '边界一之二：同形数值只在 .py 之间应汇总成一条 SKIP（id 不变）', {
        evidence: `实得 ${J(got)}；汇总 ${J(summarized.map((f) => f.status))}`, why: '判据 3 的对象是文档里的值；源码常量归 02 §4 技术债（契约 §1 不适用记 SKIP）',
      }))
    })

    guard('边界二', () => { // 边界二：.md 抄了 .py 里的一段 → 仍须判 FAIL，且落点在 .md 不在 .py
      const res = run(mkrepo(mk(), { 'doc.md': UNIQ_B + '\n' + SHARED, 'svc/settle.py': PY_WITH_DOCSTRING }))
      const fails = res.filter((f) => f.status === FAIL)
      const ok = fails.length === 1 && (fails[0]!.where ?? '').startsWith('doc.md:') && fails[0]!.title.includes('svc/settle.py')
      results.push(probe(NAME, ok, '边界二：文档抄源码的一段仍须判 FAIL，落点在 .md', {
        evidence: `FAIL ${fails.length} 条；where=${fails[0]?.where ?? '（无）'}；title=${fails[0] ? headChars(fails[0].title, 70) : '（无）'}`, why: '01 §5.10 模块文档只引用不复制——收窄不得把这一类误杀',
      }))
    })

    guard('边界三', () => { // 边界三：一个文档都没有的仓 → 判据 2、3 记未定，不得记 PASS
      const res = run(mkrepo(mk(), { 'svc/alpha.py': PY_A, 'svc/beta.py': PY_B }))
      const got = res.map((f) => f.status)
      const nodoc = res.filter((f) => f.status === UNDETERMINED && f.title.includes('没有可比对的文档文件'))
      results.push(probe(NAME, !got.includes(FAIL) && nodoc.length === 2 && got.filter((s) => s === PASS).length === 1, '边界三：纯代码仓的判据 2、3 须记未定，不得记 PASS', {
        evidence: `实得 ${J(got)}；未定（无文档）${nodoc.length} 条`, why: '01 §2 N1：空集上的「全部通过」判未定（判据 1 的 PASS 照旧，它不收窄）',
      }))
    })

    guard('边界四', () => { // 边界四（回归点）：两份逐字节相同的 .py，判据 1 未收窄，仍须判 FAIL
      const res = run(mkrepo(mk(), { 'svc/alpha.py': PY_A, 'vendor/alpha.py': PY_A }))
      const fails = res.filter((f) => f.status === FAIL && f.title.includes('逐字节相同'))
      results.push(probe(NAME, fails.length === 1, '边界四：两份逐字节相同的 .py 仍须判 FAIL（判据 1 不收窄）', { evidence: `实得 ${J(res.map((f) => f.status))}`, why: '01 §2 N2 副本即缺陷；整份复制在代码里同样是缺陷' }))
    })

    guard('边界五', () => { // 边界五：文档集合不止 .md——两份 .txt 的重复段落仍须判 FAIL
      const got = statuses(mkrepo(mk(), { 'notes/a.txt': UNIQ_A + '\n' + SHARED, 'notes/b.rst': UNIQ_B + '\n' + SHARED }))
      results.push(probe(NAME, got.includes(FAIL), '边界五：.txt 与 .rst 之间的重复段落仍须判 FAIL', { evidence: `实得 ${J(got)}`, why: '文档不只有 .md；收窄到单一后缀会静默漏报' }))
    })
  } finally {
    for (const t of tmps) rmSync(t, { recursive: true, force: true })
  }
  return results
}
