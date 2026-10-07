// git 跟踪的文件清单与一次扫描内的缓存（对应 tools/std/stdlib.py 的 tracked_files / _tracked_files / scan_memo / markdown_under / work_items）。
//
// **与 Python 版的有意差异（设计 §12.19 D17）：不带 `embedded_std_rel`（`.std/` 自排除）。**
// 依据——对 3 个采用项目的固定提交实测：黄金样本是在 `TOOL_ROOT` = 本仓下生成的，`embedded_std_rel(扫描根)` 对它们**全部返回 None**，
// 即 `.std/` 从未被排除，采用项目里 `.std/` 下的文件一直在扫描面内（reservoir 扫 200 份 markdown 而不是 28 份）。
// 所以删掉排除机制不改变任何黄金样本，而新架构里采用项目本来就不再内嵌 `.std/`（设计 §8），这个机制也就失去了对象。
// 反向证明也做了：把 `TOOL_ROOT` 指到 `扫描根/.std`，links 的计数从 200 份变成 28 份——那是真内嵌场景的行为，已随 `.std/` 一起废弃。
//
// 威胁模型与调用方责任见 git.ts 头注释：读被扫仓的 git 调用一律经 hardenedEnv。
// **这里不加 `--literal-pathspecs`**：本函数的 `patterns` 就是 pathspec（`*.md`、`*.markdown`），要通配；加了它 `*.md` 会被当成字面文件名、什么都列不出。
// （与 `git log -- <文件>` 不同：那里的路径是被扫仓里的文件名，要按字面——check_derived、check_freshness 在各自的 git log 调用上加。）

import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { under, normRel } from './docs.js'
import { pyStrip } from './finding.js'
import { hardenedEnv } from './git.js'

/** `-z` 走 NUL 分隔、原样输出：git 默认开 core.quotepath，会把非 ASCII 路径输出成 `"docs/\\345..."`，不还原就会把中文路径当成不存在、成批产生假 FAIL。 */
function listFiles(root: string, patterns?: readonly string[]): [string[] | null, string | null] {
  const args = ['-C', root, 'ls-files', '-z', ...(patterns && patterns.length ? patterns : [])]
  let r
  try {
    r = spawnSync('git', args, { timeout: 60_000, env: hardenedEnv(process.env) as NodeJS.ProcessEnv, maxBuffer: 1 << 30 })
  } catch (exc) {
    return [null, `跑不了 git ls-files：${(exc as Error).message}`]
  }
  if (r.error) return [null, `跑不了 git ls-files：${r.error.message}`]
  if (r.status !== 0) return [null, `git ls-files 退出码 ${r.status}：${pyStrip((r.stderr ?? Buffer.alloc(0)).toString('utf8')).slice(0, 200)}`] // py-semantics-ok: 展示——进 reason 的文字，不进判据；git 的 stderr 是 ASCII
  const raw = (r.stdout ?? Buffer.alloc(0)).toString('utf8')
  return [raw.split('\0').filter((p) => pyStrip(p) !== ''), null] // Python 的 `if p.strip()`：只含 Python 空白的「路径」丢掉（D6）
}

// ---- 一次扫描内的缓存 ----

type Memo = { key: string; map: Map<string, [string[] | null, string | null]> }
let memo: Memo | null = null

/** 对扫描根开一段缓存：同一组模式的 `git ls-files` 一次扫描只跑一次。只缓存扫描根本身——检查器自检在临时仓里建夹具、改完再列，缓存它们会读到旧列表。 */
export function withScanMemo<T>(root: string, fn: () => T): T {
  const prev = memo
  let key: string
  try { key = realpathSync.native(String(root)) } catch { key = String(root) }
  memo = { key, map: new Map() }
  try {
    return fn()
  } finally {
    memo = prev // 退出即恢复外层（自检里嵌套跑的各用各的），不跨扫描、不跨嵌套
  }
}

/** git 跟踪的文件；不在 git 仓库时返回 [null, 原因]。 */
export function trackedFiles(root: string, patterns?: readonly string[]): [string[] | null, string | null] {
  const m = memo
  let key: string
  try { key = realpathSync.native(String(root)) } catch { key = String(root) }
  if (m && m.key === key) {
    const k = JSON.stringify(patterns ?? [])
    if (!m.map.has(k)) m.map.set(k, listFiles(root, patterns))
    const [files, problem] = m.map.get(k)!
    return [files === null ? null : [...files], problem] // 拷贝：调用方改它不能污染缓存
  }
  return listFiles(root, patterns)
}

/** sub 目录下 git 跟踪的 markdown。返回 [相对路径列表（已排序）, 问题]。 */
export function markdownUnder(root: string, sub: string): [string[] | null, string | null] {
  const [files, problem] = trackedFiles(root)
  if (problem) return [null, problem]
  return [files!.map(normRel).filter((r) => r.toLowerCase().endsWith('.md') && under(r, sub)).sort(cmpCodepoint), null]
}

/**
 * 工作项目录**直接一层**里 git 跟踪的 markdown。子目录（L1 的 work/artifacts/ 之类）放的是留证与产物，不是工作项——与 drift 的 D-118 裁定同一条规则，evidence 与 freshness 共用这一处。
 */
export function workItems(root: string, wroot: string): [string[] | null, string | null] {
  const [files, problem] = markdownUnder(root, wroot)
  if (problem) return [null, problem]
  const base = normRel(wroot).replace(/\/+$/, '')
  return [files!.filter((r) => dirnameOf(r) === base || ((base === '' || base === '.') && !r.includes('/'))), null]
}

/** Python 的 `os.path.dirname`（本函数的入参已规范成 `/` 分隔）：最后一个 `/` 之前，没有则空串。 */
const dirnameOf = (r: string): string => { const i = r.lastIndexOf('/'); return i < 0 ? '' : r.slice(0, i) }

/** Python 的 `sorted(list_of_str)` 按码点；JS 的默认 `sort()` 按 UTF-16 码元，BMP 之外的字符次序不同。 */
export function cmpCodepoint(a: string, b: string): number {
  const x = a[Symbol.iterator](), y = b[Symbol.iterator]()
  for (;;) {
    const p = x.next(), q = y.next()
    if (p.done && q.done) return 0
    if (p.done) return -1
    if (q.done) return 1
    const d = p.value.codePointAt(0)! - q.value.codePointAt(0)!
    if (d) return d
  }
}
