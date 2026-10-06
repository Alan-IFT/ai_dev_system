// 检查器的公共外壳与小工具（对应 tools/std/stdlib.py 的 run_guarded / undetermined_from_exception / probe / probe_crashed / unreadable / outside_root / once / agg /
// work_root_absent，契约 §1、§3）。每个检查器都用它们，所以先于任何检查器迁。
//
// 不带过来的：tracked_files、scan_memo、markdown_under、work_items——它们依赖 `.std/` 内嵌机制（阶段 4 废弃）与扫描缓存，放到 check_all 汇总层迁。
// 检查器内部异常一律转未定，**绝不吞掉记 PASS**（契约 §1、§4）；这是整个工具最重要的一条安全属性，所以 `runGuarded` 的每个分支都有变异验证。

import { statSync } from 'node:fs'
import { join } from 'node:path'
import { isTailoredOut } from './docs.js'
import { FAIL, PASS, SKIP, UNDETERMINED, finding, pyStrip, type Finding, type FindingInit } from './finding.js'
import { inside, isReadRefusal } from './fs.js'
import { INTERNAL_ERROR_KIND } from './exceptions.js'
import { workRoot } from './docs.js'
import { LIST_CAP } from './docs.js'
import type { Config } from './cfg.js'

/** Python 的 `type(exc).__name__`：本模块只需要把 JS 的 Error 映射到一个稳定的类名，供 reason 里显示。系统错误带 `code` 的映射成 Python 的类名。 */
export function excTypeName(e: unknown): string {
  if (e === null || typeof e !== 'object') return typeof e
  // 本模块的拒读类（OutsideRoot / TooLarge / NotRegular）也带 `code` 字符串，**必须先判**，否则会被下面「任何带 code 的都是 OSError」吞掉、
  // 变成 `OSError`——而它进 `unreadable` 的标题，标题没给 kind 时还会进兜底 id 的哈希（本条由 shell.test.mjs 对 Python 黄金样本比出来）
  if (isReadRefusal(e)) return e.name
  const code = (e as NodeJS.ErrnoException).code
  if (code === 'ENOENT') return 'FileNotFoundError'
  if (code === 'EACCES' || code === 'EPERM') return 'PermissionError'
  if (code === 'EISDIR') return 'IsADirectoryError'
  if (code === 'ENOTDIR') return 'NotADirectoryError'
  if (typeof code === 'string') return 'OSError'
  return (e as Error).name || 'Error'
}

function excMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 检查器内部异常一律转 UNDETERMINED，绝不吞掉记 PASS。 */
export function undeterminedFromException(check: string, exc: unknown, what: string): Finding {
  return finding(check, UNDETERMINED, `${what} 时检查器自身出错`, {
    reason: `${excTypeName(exc)}: ${excMessage(exc)}`,
    evidence: '检查器故障时其结论作废；按 01 §5.6 判检查器故障，不按通过记。',
    kind: INTERNAL_ERROR_KIND,
  })
}

/** 检查器 run() 的公共外壳：项目已裁剪记一条 SKIP；fn(cfg) 的内部异常一律转未定（契约 §1、§4）。 */
export function runGuarded(check: string, fn: (cfg: Config) => Finding[], cfg: Config): Finding[] {
  const [tailored, reason] = isTailoredOut(cfg, check)
  if (tailored) return [finding(check, SKIP, '项目已裁剪本检查', { reason: reason || 'project.yaml 未写理由' })]
  try {
    return fn(cfg)
  } catch (exc) {
    return [undeterminedFromException(check, exc, `跑 ${check}`)]
  }
}

/** 自检的一条断言：ok 为真记 PASS，否则 FAIL（契约 §3）。 */
export function probe(check: string, ok: boolean, title: string, init: FindingInit = {}): Finding {
  return finding(check, ok ? PASS : FAIL, title, init)
}

/** 自检的一条断言自己跑崩了：记 FAIL，不按通过记。 */
export function probeCrashed(check: string, what: string, exc: unknown): Finding {
  return finding(check, FAIL, `${what}自身出错`, { evidence: `${excTypeName(exc)}: ${excMessage(exc)}` })
}

/**
 * 读不了的文件（超限、不是常规文件、出仓、IO 错）：是对象的事，不是检查器故障，不落兜底 id。每个检查器内同一文件只报一次（同一 id，调用方去重）。
 */
export function unreadable(check: string, rel: string, exc: unknown): Finding {
  return finding(check, UNDETERMINED, `${rel} 读不了（${excTypeName(exc)}），依赖它的判据未判`, {
    where: rel, kind: 'unreadable', key: rel,
    reason: '读不了、不是常规文件、超过读取上限或真实位置在项目之外；没读的文件不是没有问题',
    why: '01 §2 N1：依赖不可用记未定，不记通过',
  })
}

/** 同一 id 只留第一条（契约 §1 同一事实只报一次）：一份文件被几条判据读、各自读不了时用。 */
export function once(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>()
  return findings.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)))
}

/** 字面在项目内、真实位置出仓的路径：记未定，不判缺失、不探测目标在不在（契约 §5）。 */
export function outsideRoot(check: string, rel: string): Finding {
  return finding(check, UNDETERMINED, `${rel} 的真实位置在被扫项目之外，未读`, {
    where: rel, kind: 'outside-root', key: rel,
    reason: '它是指向项目之外的符号链接；本工具不读、不探测项目之外的路径',
    why: '契约 §5：只读被扫项目之内的文件',
  })
}

/**
 * 工作项目录不在时返回一条 SKIP，在则返回 null。给以工作项为对象的检查器用。
 * 「目录在不在」是 01 §3.1 的存在性事实，由 layout 报一次（契约 §1「同一事实只报一次」）；evidence / freshness 从前各报一条未定，采用方得为同一件事登记两行。
 */
export function workRootAbsent(check: string, cfg: Config): Finding | null {
  const [rel, note] = workRoot(cfg)
  const root = (cfg._root as string | undefined) || '.'
  const path = join(root, pyStripPath(rel))
  if (inside(root, path) && isDir(path)) return null // 出仓的符号链接也回 SKIP，由 layout 记未定
  return finding(check, SKIP, `本检查只扫工作项目录，它不在：${rel}`, {
    where: rel, kind: 'work-root-absent',
    reason: '目录在不在由 layout 报：01 §3.1 的存在性判定归它（声明了 layout.work_root 时任何档由 layout 判 FAIL，出仓记未定；没声明时 L1 起由 work_current 认这个缺省目录，L0 不要求它）。本检查不再另记一条未定',
    evidence: `${note}；负责报告的检查器：layout`,
  })
}

/** Python 的 `rel.replace("\\", "/").strip()`——`strip` 用 Python 的空白集合，不用 JS 的 `\s`/`trim`（设计 §12.6 D6）。 */
function pyStripPath(rel: string): string {
  return pyStrip(rel.replaceAll('\\', '/'))
}

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory() } catch { return false }
}

/**
 * 把一批同类路径聚成一条 Finding，证据最多列 LIST_CAP 条。
 * `kind` 必填：标题带份数，不给 kind 时兜底 id 随份数变，登记行就成孤儿（契约 §4、§9；D-123）。
 */
export function agg(check: string, status: string, title: string, paths: readonly string[], reason: string, why: string, kind: string): Finding {
  const more = paths.length <= LIST_CAP ? '' : `；另有 ${paths.length - LIST_CAP} 份未列出`
  return finding(check, status, `${title}（${paths.length} 份）`, { kind, reason, why, evidence: paths.slice(0, LIST_CAP).join('；') + more })
}

export { FAIL, PASS, SKIP, UNDETERMINED }
