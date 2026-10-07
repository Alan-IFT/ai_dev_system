// 文档头部、工件落点、工作项（对应 tools/std/stdlib.py 的 find_field / head_of / item_status / clean / under / norm_rel / is_work_item_name /
// docs_root_of / entry_files / rebase_docs / work_root / in_frozen / is_tailored_out / artifact_tailored / date_fields_of / status_kind，契约 §1、§5）。
//
// 迁移约束：`find_field` 的正则依赖 Python `re` 的语义——Unicode 大小写折叠、`\s` 的集合、`(?<=…)` 回看、`re.M`——这些都是 JS 里最容易悄悄不同的地方，
// 所以黄金样本给得最密（规模见设计文档 §12.13，不在这里重复数字），并逐码点比对了大小写折叠（见 `foldRegexSource`）。
// 废弃项：入口候选里的 `CLAUDE.md` 是 Claude Code 时代的兼容名（D-135），**本块保持原行为不动，阶段 4 统一清**——现在删会让黄金样本对不上。

import { join } from 'node:path'
import { cfgGet, DOC_STATES, leadWord, pyStr, pyTruthy, stateClass, type Config } from './cfg.js'
import { PY_WHITESPACE, pyStrip } from './finding.js'
import { inside, isFile } from './fs.js'

/** 01 §3.5 的「状态」字段在文档头部叫什么。中英两写都算；**新增写法只在这里加，不在检查器里另起一张表**。 */
export const STATUS_FIELDS: readonly string[] = ['状态', 'status', 'state']
/** 01 §3.5 的日期字段名缺省（`metadata_fields` 未配时取它，契约 §5）。 */
export const DEFAULT_DATE_FIELDS: readonly string[] = ['updated_at']

export const HEAD_CHARS = 4000 // 元信息只在文件头找；正文里再出现同名字段不算
export const LIST_CAP = 12 // 聚合类 Finding 的证据里最多列几条路径

/**
 * Python 的 `s[:n]`：按**码点**取前 n 个字符。JS 的 `s.slice(0, n)` 按 UTF-16 码元计，BMP 之外的字符（emoji、CJK 扩展区）占 2 个码元，
 * 含这类字符的文本会被少取（设计 §12.6 D18）。进判据的截取（头部区域、日期字段查找范围）必须用这个。
 * 纯展示的截断（evidence 里的前 N 字）不进判据，不要求等价，但同一处用它也无妨。
 * 快路径：码元数 ≤ n 时码点数必然 ≤ n，原样返回；否则逐码点数到 n。
 */
export function headChars(s: string, n: number): string {
  if (s.length <= n) return s
  let i = 0, count = 0
  while (i < s.length && count < n) {
    const cp = s.codePointAt(i)!
    i += cp > 0xffff ? 2 : 1
    count++
  }
  return s.slice(0, i)
}

// ---------------------------------------------------------------------------------------------
// 字段查找
// ---------------------------------------------------------------------------------------------

/**
 * Python `re.I`（Unicode）的单字符大小写等价，**逐码点实测**（全部 Unicode 码点对 26 个 ASCII 字母，设计 §12.6 D11）：
 * JS 的 `i` 标志漏 4 个（`İ` U+0130、`ı` U+0131、`ſ` U+017F、`K` U+212A），**`iu`（本模块用的）只漏 2 个：`İ`、`ı`**——`ſ↔s` 与 `K↔k` 在 `iu` 下本来就等价。
 * 所以只对 `i` 显式并上 `İı`；其余 Unicode 字母的大小写对两边一致，交给 `iu`。**必须带 `u` 标志**：去掉 `u` 就又漏 `ſ` 与 `K`（变异 F20 钉住）。
 */
const EXTRA_FOLD: Readonly<Record<string, string>> = { i: 'İı', I: 'İı' }

export function foldRegexSource(name: string): string {
  let out = ''
  for (const ch of name) {
    // 不转义 `-`：正则带 `u` 标志，`u` 模式下 `\-` 在字符类之外是非法转义（抛 SyntaxError），而 `-` 在字符类之外本来就是字面量。
    // `updated-at` 这类带连字符的 metadata_fields 名字曾因此整条崩掉，Python 的 re.escape 版本正常（样本 `-` 类名字钉住）。
    const esc = ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
    const extra = EXTRA_FOLD[ch]
    out += extra ? `(?:${esc}|[${extra}])` : esc
  }
  return out
}

// `[\s　|>]` 里的 `\s` 是 Python 的空白集合（D6），再加全角空格 U+3000（本来就在 PY_WHITESPACE 里，这里显式写出以对应原模式）
// 行首写成 `(?<![^\\n])`（开头或前一字符是 \\n）：JS 的 `m` 标志下 `^` 在 \\r、U+2028、U+2029 之后也匹配，Python 的 `re.M` 不匹配（设计 §12.6 D13）
const LINE_START = '(?<![^\\n])'
const FIELD_LEAD = `(?:${LINE_START}|(?<=[${PY_WHITESPACE}　|>]))`
const FIELD_DECOR = '[*_`]{0,4}'
const FIELD_GAP = '[ \\t　]*'
const FIELD_VALUE = '([^\\n　|]*)'

/**
 * 在文本里找 `名字: 值` 或 `名字：值`。返回 [值, 命中的名字]，找不到返回 [null, null]。
 *
 * 值以换行、表格竖线或全角空格为界——示例项目把三个字段写在同一行，用全角空格分隔。
 * 字段名两侧可带加粗、斜体或反引号（`**状态**：done`、`` `status`: done ``）。
 * 冒号两侧只认同一行的空白：`状态：` 后面是空行时不许把下一行吞成值——值为空等于没写这个字段。
 * 名字前不认 `-`：`build-status: passing` 不是 `status`（列表项 `- status:` 靠空白分隔照认）。
 * 只取第一次出现：它的值为空就是缺字段，不往后文找同名字段（R1-05）；冒号后的全角空格照跳过。
 * 线性：名字只在行首或空白、`|`、`>` 之后起算，两侧装饰限 4 个——满行 `*` 曾是平方级（R1-01、R2-11）。
 */
export function findField(text: string, names: readonly unknown[]): [string | null, string | null] {
  for (const name of names) {
    const n = pyStr(name)
    const re = new RegExp(FIELD_LEAD + FIELD_DECOR + foldRegexSource(n) + FIELD_DECOR + FIELD_GAP + '[:：]' + FIELD_GAP + FIELD_VALUE, 'iu')
    const m = re.exec(text)
    if (m) {
      const val = pyStrip(m[1]!)
      return val ? [val, n] : [null, null]
    }
  }
  return [null, null]
}

const FRONT_MATTER = /^\ufeff?---[ \t]*\n([\s\S]*?\n)---[ \t]*(?:\n|$)/
// Python 的 `^#{2,6}\s`（re.M）：`\s` 是 Python 空白集合（D6），`^` 只认 \n 之后（D13）；两者都用显式写法，不用 JS 的 \s 与 m 标志
const SECTION_PY = new RegExp(`${LINE_START}#{2,6}[${PY_WHITESPACE}]`)

/**
 * 文件头部区域（D-134）：以 `---` 起头的 YAML 头里有状态字段时只取它；否则取到第一个二级及以下标题之前
 * （含 YAML 头之后的引导段——日期写在 YAML、状态写在一级标题下是合法写法）；都不超过 HEAD_CHARS。
 *
 * 状态字段只从这里读——`## 背景` 之类小节里的 `状态：active` 字样不算。YAML 分支不可省：findField 按字段名
 * 顺序（状态→status→state）逐个找，不是取位置上第一次出现，YAML 写 `status:` 、正文写 `状态：` 时会读到正文。
 */
export function headOf(text: string): string {
  const t = headChars(text, HEAD_CHARS)
  const m = FRONT_MATTER.exec(t)
  if (m && findField(m[1]!, STATUS_FIELDS)[0] !== null) return m[1]!
  const s = SECTION_PY.exec(t)
  return s ? t.slice(0, s.index) : t
}

/** 去掉 markdown 的加粗与反引号标记，再去首尾空白。输入按 Python 的 `str()` 转字符串。 */
export function clean(value: unknown): string {
  return pyStrip(pyStr(value).replaceAll('*', '').replaceAll('`', ''))
}

/** 头部区域（headOf）的状态值（去装饰、去括注、小写）；没有状态字段返回 null。 */
export function itemStatus(text: string): string | null {
  const [raw] = findField(headOf(text), STATUS_FIELDS)
  if (raw === null) return null
  return pyStrip(clean(raw).split(/[（(]/)[0]!).toLowerCase()
}

// ---------------------------------------------------------------------------------------------
// 路径与工作项
// ---------------------------------------------------------------------------------------------

export function normRel(p: unknown): string {
  return pyStrip(pyStr(p).replaceAll('\\', '/'))
}

/** rel 是否落在 sub 目录下。sub 为空或 '.' 视为整仓。 */
export function under(rel: string, sub: string): boolean {
  const s = normRel(sub).replace(/\/+$/, '')
  if (s === '' || s === '.') return true
  return rel === s || rel.startsWith(s + '/')
}

/** 工作项文件的命名：01 §3.2 职责卡与 §3.3 阅读路径写作 `state/work/WI-*`；与 drift 认 ID 的 `WI-<三位以上数字>` 同一形式。 */
export const WORK_ITEM_NAME = /^WI-[0-9]{3,}/

/** Python 的 `os.path.basename`：取最后一个路径分隔符之后。Windows 上 `\` 与 `/` 都是分隔符，POSIX 上只有 `/`——黄金样本是在 Windows 上生成的。 */
function pyBasename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), process.platform === 'win32' ? p.lastIndexOf('\\') : -1)
  return p.slice(i + 1)
}

export function isWorkItemName(rel: unknown): boolean {
  return WORK_ITEM_NAME.test(pyBasename(pyStr(rel)))
}

// ---------------------------------------------------------------------------------------------
// 工件落点
// ---------------------------------------------------------------------------------------------

/** 01 §3.1 文档树的根。契约 §5：`layout.docs_root` 缺省取它并在证据里注明。 */
export const DEFAULT_DOCS_ROOT = 'docs'
/** 01 §3.1 大项目树的 `docs/state/work/`（工作项，一件一文件）。契约 §5：缺省取它并在证据里注明。 */
export const DEFAULT_WORK_ROOT = 'docs/state/work'
/** ★ 状态工件没在 layout.artifacts.status 声明落点时的候选。 */
export const STATUS_CANDIDATES: readonly string[] = ['WORK.md', 'docs/state/STATUS.md']
/** ★ 验收工件没在 layout.artifacts.acceptance 声明落点时的候选。 */
export const ACCEPTANCE_CANDIDATES: readonly string[] = ['ACCEPTANCE.md', 'docs/product/acceptance']
/** 会话交接没在 layout.artifacts.handoff 声明落点时的候选。 */
export const HANDOFF_CANDIDATES: readonly string[] = ['work/handoff.md', 'docs/state/handoff']
/**
 * ★ 入口没在 layout.entry 声明时的候选，按此顺序取第一个存在的。`CLAUDE.md` 是 Claude Code 时代的**兼容候选名**（D-135：受支持宿主只有 DeepSeek Harness）。
 * **本块保持原行为，阶段 4 统一清**——现在删会让黄金样本里依赖它的几条对不上。
 */
export const ENTRY_CANDIDATES: readonly string[] = ['CONTEXT.md', 'AGENTS.md', 'CLAUDE.md']

/** 文档根：`layout.docs_root`，未配则取 DEFAULT_DOCS_ROOT。返回 [相对路径, 证据注记]。 */
export function docsRootOf(cfg: Config): [string, string] {
  const raw = cfgGet(cfg, 'layout.docs_root')
  if (pyTruthy(raw)) return [pyStr(raw), ''] // 配了原样返回、注记为空（它会进 finding 标题，契约 §4）
  return [DEFAULT_DOCS_ROOT, `docs_root 用的是默认 ${DEFAULT_DOCS_ROOT}（未配 layout.docs_root）`]
}

/** 以 `docs/` 开头的候选/缺省路径，按项目的 layout.docs_root 改基（缺省 docs 即不改）。 */
export function rebaseDocs(rel: unknown, docsRoot: unknown): string {
  const r = pyStrip(pyStr(rel).replaceAll('\\', '/')).replace(/\/+$/, '')
  const dr = pyStrip(pyStr(pyTruthy(docsRoot) ? docsRoot : DEFAULT_DOCS_ROOT).replaceAll('\\', '/')).replace(/\/+$/, '')
  if (r.startsWith('docs/') && dr !== 'docs') return dr + r.slice(4)
  return r
}

/** 工作项目录：`layout.work_root`，未配则取 DEFAULT_WORK_ROOT（随 docs_root 改基）。返回 [相对路径, 证据注记]。 */
export function workRoot(cfg: Config): [string, string] {
  const raw = cfgGet(cfg, 'layout.work_root')
  if (pyTruthy(raw)) return [pyStr(raw), `work_root 取自 layout.work_root：${pyStr(raw)}`] // 原样返回不归一：它会进 finding 标题，标题变了兜底 id 就变（契约 §4）
  const rel = rebaseDocs(DEFAULT_WORK_ROOT, docsRootOf(cfg)[0])
  return [rel, `work_root 用的是默认 ${rel}（未配 layout.work_root）`]
}

/**
 * 入口文件：项目声明优先，未声明则取 ENTRY_CANDIDATES 里第一个存在的。返回 [相对路径列表, 注记]。
 * 注记为空＝取自项目声明（`layout.entry`，未配时认 `layout.artifacts.entry`），原样返回、不判存在；
 * 注记非空＝取自候选，列表只含命中的那一个，候选全不在时为空。候选是工具约定：据此只许出 PASS 或未定，不许出 FAIL（契约 §1.1）。
 */
export function entryFiles(cfg: Config): [string[], string] {
  const declared = cfgGet(cfg, 'layout.entry') || cfgGet(cfg, 'layout.artifacts.entry')
  if (pyTruthy(declared)) {
    const list = typeof declared === 'string' ? [declared] : Array.isArray(declared) ? declared : []
    return [list.map((x) => pyStr(x)), '']
  }
  const root = (cfg._root as string | undefined) || '.'
  // 出仓的候选不探测、照算命中（由读它的检查器记 outside-root），结论不随仓外文件在不在而变
  const hits = ENTRY_CANDIDATES.filter((c) => !inside(root, join(root, c)) || isFile(join(root, c)))
  const note = `未配 layout.entry，按候选 ${ENTRY_CANDIDATES.join('、')} 的顺序取第一个存在的`
  if (hits.length === 0) return [[], note + '：都不存在']
  return [hits.slice(0, 1), note + `：${hits[0]}${hits.length > 1 ? `（同时存在 ${hits.slice(1).join('、')}，未取）` : ''}`]
}


/** 是否落在只读归档区（不承担更新义务，见 01 §3.1）。 */
export function inFrozen(cfg: Config, relpath: string): boolean {
  const rel = relpath.replaceAll('\\', '/')
  const fr = cfgGet(cfg, 'layout.frozen', [])
  const list = pyTruthy(fr) ? fr : []
  for (const prefix of Array.isArray(list) ? list : []) {
    const pre = pyStr(prefix).replaceAll('\\', '/').replace(/\/+$/, '')
    if (rel === pre || rel.startsWith(pre + '/')) return true
  }
  return false
}

// ---------------------------------------------------------------------------------------------
// 裁剪与日期字段
// ---------------------------------------------------------------------------------------------

/** 项目是否把该检查裁剪掉了。返回 [是否裁剪, 理由]。 */
export function isTailoredOut(cfg: Config, checkName: string): [boolean, string | null] {
  const t = cfgGet(cfg, 'tailoring', [])
  for (const item of pyTruthy(t) && Array.isArray(t) ? t : []) {
    if (item && typeof item === 'object' && !Array.isArray(item) && (item as Record<string, unknown>).check === checkName) {
      if ((item as Record<string, unknown>).applicable === false) {
        const reason = (item as Record<string, unknown>).reason
        return [true, pyStrip(pyTruthy(reason) ? pyStr(reason) : '') || null]
      }
    }
  }
  return [false, null]
}

/**
 * 项目是否在 tailoring 里登记了 layout 的这个工件不适用。返回 [是否裁剪, 理由]。
 * 接受 `check: layout:<role>` 与 `check: <role>` 两种写法。layout 据它跳过该工件，freshness 据它判断该工件的元信息是否已由 layout 报（D-131）。
 */
export function artifactTailored(cfg: Config, role: string): [boolean, string | null] {
  const keys = [`layout:${role}`, role]
  const t = cfgGet(cfg, 'tailoring', [])
  for (const item of pyTruthy(t) && Array.isArray(t) ? t : []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const o = item as Record<string, unknown>
    if (keys.includes(pyStr(o.check)) && o.applicable === false) {
      return [true, pyStrip(pyTruthy(o.reason) ? pyStr(o.reason) : '') || null]
    }
  }
  return [false, null]
}

/** 文档日期字段名：`metadata_fields`（字符串列表，也接受单个字符串）。返回 [名字列表, 是否用的默认值]。 */
export function dateFieldsOf(cfg: Config): [string[], boolean] {
  let raw: unknown = cfgGet(cfg, 'metadata_fields')
  raw = typeof raw === 'string' ? [raw] : raw
  const names = Array.isArray(raw) ? raw.map((x) => pyStrip(pyStr(x))).filter((x) => x) : []
  return names.length ? [names, false] : [[...DEFAULT_DATE_FIELDS], true]
}

// ---------------------------------------------------------------------------------------------
// 工作项还是文档
// ---------------------------------------------------------------------------------------------

/**
 * 工作项目录里带状态字段的文件是工作项还是文档，及其状态归类（D-134，freshness 与 evidence 只此一处分流）。
 * 返回 [身份, 归类]：身份是 "work_item" 或 "document"；归类是 01 §4.1 六态之一或 01 §3.5 四值之一，认不出为 null。
 */
export function statusKind(cfg: Config, rel: string, status: string | null): ['work_item' | 'document', string | null] {
  const item = stateClass(cfg, status)
  if (isWorkItemName(rel) || item !== null) return ['work_item', item]
  const arts = cfgGet(cfg, 'layout.artifacts') || {}
  const declared = new Set<string>()
  if (arts && typeof arts === 'object' && !Array.isArray(arts)) {
    for (const v of Object.values(arts)) if (typeof v === 'string') declared.add(normRel(v).replace(/^(\.\/)+/, '').replace(/\/+$/, ''))
  }
  if (declared.has(normRel(rel))) {
    const words: Array<readonly [string, string]> = []
    for (const [c, al] of DOC_STATES) for (const a of al) words.push([a, c])
    return ['document', leadWord(status, words)]
  }
  return ['work_item', null]
}
