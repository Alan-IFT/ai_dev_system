// 文档树工件齐备性与元信息。对应 tools/std/checks/check_layout.py；契约见 tools/std/CONTRACT.md。
// 执行 01 §3.1（文档树，★ 是最小起点）、§3.2（职责卡的「它过期了怎么被发现」）、§3.5（文档元信息与状态）。
//
// 迁移约束：与 Python 版逐 id 相同（黄金样本）；`selftest()` 的 12 条探针（id 含标题哈希）集合必须与黄金样本完全相同。

import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { cfgGet, pyStr, pyTruthy, type Config } from '../core/cfg.js'
import {
  ACCEPTANCE_CANDIDATES, DEFAULT_WORK_ROOT, ENTRY_CANDIDATES, HANDOFF_CANDIDATES, STATUS_CANDIDATES, STATUS_FIELDS,
  artifactTailored, dateFieldsOf, docsRootOf, entryFiles, findField, itemStatus, rebaseDocs,
} from '../core/docs.js'
import { FAIL, PASS, SKIP, UNDETERMINED, finding, pyStrip, type Finding } from '../core/finding.js'
import { writeText } from '../core/fixture.js'
import { MAX_READ_BYTES, exists as pathExists, inside, isDir, isFile, readText } from '../core/fs.js'
import { globAny } from '../core/glob.js'
import { pyRepr } from '../core/repr.js'
import { probe, runGuarded, undeterminedFromException, unreadable } from '../core/shell.js'
import { splitLinesPy } from '../core/yaml.js'

export const NAME = 'layout'
export const STANDARD_REFS = ['01 §3.1', '01 §3.2', '01 §3.5']

// --------------------------------------------------------------------------
// 分档工件清单
//
// 派生自 templates/文件树与落地路径.md，提取日期 2026-09-10（按节名引用，不记行号——行号随编辑漂）：
//   L0  该文件 §2「L0 · 一人一工具」的树与其下的职责表；L1 §3；L2 §4；L3 §5。
// ★ 三类（入口 / 验收 / 状态）取自 标准/01-项目管理标准.md §3.1 正文「最小起点是入口、验收、状态三类工件（标 ★）」。
// 已知不一致，照实记：模板 §4 的小标题写「+5」，其下的树实列 6 项。本常量按树取 6 项。
// **这是那个文件某一天的快照。源文件改了，这里不会自动跟着改。**
// 每项候选路径给两套：模板的 L0 扁平摆法，以及 01 §3.1 大项目树的摆法（命中任一即算存在）。
// 项目可用 governance/project.yaml 的 layout.artifacts.<role> 指定自己的路径，指定了就只认它，不再猜候选。
// **候选路径列不是判据依据，是提示。** 候选落空推不出「该工件不存在」——按契约 §1/§7，★ 角色未声明且候选未命中时记 UNDETERMINED，不记 FAIL。
// --------------------------------------------------------------------------

const TEMPLATE_SOURCE = 'templates/文件树与落地路径.md'
const SNAPSHOT_DATE = '2026-09-10'

/** 存在性判据：file=必须是文件 / dir=必须是目录 / any=文件或目录 / glob=通配命中任一 */
type Kind = 'file' | 'dir' | 'any' | 'glob'
type TierItem = readonly [role: string, label: string, star: boolean, kind: Kind, cands: readonly string[]]

const TIER_ITEMS: Readonly<Record<string, readonly TierItem[]>> = {
  L0: [
    ['entry', '入口', true, 'file', [...ENTRY_CANDIDATES]],
    ['acceptance', '验收', true, 'any', [...ACCEPTANCE_CANDIDATES]],
    ['status', '状态', true, 'any', [...STATUS_CANDIDATES]],
    ['playbook', '方法与坑', false, 'any', ['PLAYBOOK.md', 'docs/knowledge/PLAYBOOK.md']],
    ['failures', '失败清单', false, 'any', ['FAILURES.md', 'docs/knowledge/FAILURES.md']],
  ],
  L1: [
    ['work_current', '实时状态源', false, 'any', ['work/current.md', DEFAULT_WORK_ROOT]],
    ['handoff', '会话交接', false, 'any', [...HANDOFF_CANDIDATES]],
    ['work_artifacts', '工具原文落点', false, 'dir', ['work/artifacts', 'docs/state/artifacts']],
  ],
  L2: [
    ['decisions', '决策与生效登记', false, 'any', ['DECISIONS.md', 'docs/decisions']],
    ['gates', '闸门合同', false, 'any', ['GATES.md', 'governance/GATES.md']],
    ['sources', '权威记录源指派', false, 'any', ['SOURCES.md', 'docs/SOURCES.md']],
    ['eval', '评估三区与 manifest', false, 'any', ['eval/manifest.md', 'eval']],
    ['memory', '记忆候选池', false, 'dir', ['memory', 'docs/memory']],
    ['checkers', '项目侧检查器', false, 'glob', ['tools/check_*.py', 'tools/*/check_*.py', 'tools/*/checks/check_*.py']],
  ],
  L3: [
    ['policy_budget', '预算与范围', false, 'any', ['policy/budget.md']],
    ['policy_judges', '判定器登记', false, 'any', ['policy/judges.md']],
    ['ops_liveness', '活性巡检', false, 'any', ['ops/liveness.md']],
  ],
}
const TIER_ORDER = ['L0', 'L1', 'L2', 'L3'] as const

/** 全部分档的工件 role 名（`tailoring[].check` 可写 `layout:<role>` 或裸 `<role>`）；汇总层校验裁剪名用（Python 版读 `_TIER_ITEMS` 的第 0 列）。 */
export function tierRoles(): string[] {
  return Object.values(TIER_ITEMS).flatMap((items) => items.map((it) => it[0]))
}

/** 元信息在「头部」，只看头部若干行。 */
const META_HEAD_LINES = 40

const normPath = (p: unknown): string => pyStrip(pyStr(p).replaceAll('\\', '/')).replace(/\/+$/, '')

/** 工件在不在：true / false；真实位置在项目之外返回 null（不探测项目之外，调用方记未定；C16）。 */
function exists(root: string, rel: string, kind: Kind): boolean | null {
  const path = join(root, ...rel.split('/'))
  if (kind === 'glob') return globAny(root, rel, (p) => inside(root, join(root, p))) // 只有候选部分是通配；扫描根里的 [ ] * ? 按字面（C14）
  if (!inside(root, path)) return null
  if (kind === 'file') return isFile(path)
  if (kind === 'dir') return isDir(path)
  return pathExists(path)
}

function tierItems(tier: string): TierItem[] {
  const items: TierItem[] = []
  for (const t of TIER_ORDER.slice(0, TIER_ORDER.indexOf(tier as (typeof TIER_ORDER)[number]) + 1)) items.push(...TIER_ITEMS[t]!)
  return items
}

/** 工件路径的真实位置在项目之外（符号链接出仓）：不读、不探测，记未定。entry-budget 对同一件记 SKIP。 */
function outside(rel: string, label: string): Finding {
  return finding(NAME, UNDETERMINED, `${label} ${rel} 的真实位置在被扫项目之外`, {
    where: rel, kind: 'outside-root', key: rel,
    reason: '它是指向项目之外的符号链接；本工具不读、不探测项目之外的路径，换一台机器它是否存在也不由本仓决定',
    why: '01 §3.1：工件要在项目里；契约 §5 只读被扫项目之内的文件',
  })
}

/** 返回 [前 META_HEAD_LINES 行, 读到的全文]：日期字段看前者，状态字段按 itemStatus 的头部划界看后者。 */
function head(path: string, root: string): [string, string] {
  const text = readText(path, root, MAX_READ_BYTES)
  return [splitLinesPy(text, true).slice(0, META_HEAD_LINES).join(''), text]
}

/** 头部有没有 `field:`。解析与 freshness 同一套（findField）：行首、列表项、加粗、同一行用全角空格或竖线并排的写法都认。 */
const hasField = (h: string, field: string): boolean => findField(h, [field])[0] !== null

// --------------------------------------------------------------------------

export function scope(cfg: Config): { covered: string[]; not_covered: string[] } {
  const tier = cfgGet(cfg, 'tier')
  const [docsRoot, dnote] = docsRootOf(cfg)
  const [entries, guessed] = entryFiles(cfg)
  const [fields, usedDefault] = dateFieldsOf(cfg)
  return {
    covered: [
      `按 project.yaml 的 tier（当前 ${pyTruthy(tier) ? pyStr(tier) : '未声明'}）查该档要求的工件在不在`,
      `只在项目根、入口（${(entries.join(', ') || '没找到') + (guessed ? '，按候选' : '')}）与 layout.docs_root（${normPath(docsRoot) + (dnote ? '，默认' : '')}）下解析工件路径`,
      '只对 acceptance / status 两角色的 markdown 工件查 01 §3.5 的头部元信息：' +
        `日期字段 ${fields.join('/') + (usedDefault ? '（默认值）' : '')} 与状态字段 ${STATUS_FIELDS.join('/')}`,
    ],
    not_covered: [
      '不判断文档内容对不对——那不是机械可判定的（契约 §7）',
      '不判断某个工件该不该存在：裁剪是人的决定，只看它有没有在 tailoring 里登记',
      '不扫全仓：只看 layout.entry 与 layout.docs_root 下的候选路径，别处同名文件看不见',
      '★ 工件未在 layout.artifacts 里声明落点时，候选路径只当提示用：未命中记未定，' + '不记 FAIL——候选来自模板快照，落空只说明工具没在它猜的地方找到（契约 §1/§7）',
      `分档清单是 ${TEMPLATE_SOURCE} 于 ${SNAPSHOT_DATE} 的快照，源文件改了这里不会自动变；两边不一致时以源文件为准`,
      '只看元信息字段在不在，不看它的值对不对、日期是不是已经过期',
      '目录型工件不逐份判其下文档的元信息',
      '不判其余角色（入口、方法与坑、实时状态源、会话交接等）的头部元信息——01 §3.5 点名的是' +
        '验收、架构、模块、契约、ADR、runbook 六类；它们过期怎么被发现按 01 §3.2 各自那一列' +
        '（入口看行数超预算、方法与坑看条目只增不减、工作项看状态超期无转换），不由本检查器判',
    ],
  }
}

export function run(cfg: Config): Finding[] {
  return runGuarded(NAME, doRun, cfg)
}

function doRun(cfg: Config): Finding[] {
  const root = (cfg._root as string | undefined) || '.'

  const tierRaw = cfgGet(cfg, 'tier')
  const tier = tierRaw !== undefined && tierRaw !== null ? pyStrip(pyStr(tierRaw)).toUpperCase() : ''
  if (!tier) {
    return [finding(NAME, UNDETERMINED, '未声明采用档次', {
      reason: '未声明采用档次，本工具不猜该项目该有哪些工件',
      why: '01 §3.1：文件存在的理由是它承载哪条职责；该有哪几件由采用的档位决定',
      evidence: `governance/project.yaml 缺 tier；分档定义见 ${TEMPLATE_SOURCE}`,
    })]
  }
  if (!(TIER_ORDER as readonly string[]).includes(tier)) {
    return [finding(NAME, UNDETERMINED, `tier 取值 ${pyRepr(tier)} 不是 L0/L1/L2/L3`, {
      reason: '档次取值不认识，本工具不把它归到最近的一档', why: `01 §3.1 / ${TEMPLATE_SOURCE} 只定义了四档`,
    })]
  }

  const docsRoot = normPath(docsRootOf(cfg)[0])
  let overrides: unknown = cfgGet(cfg, 'layout.artifacts')
  if (!pyTruthy(overrides)) overrides = {}
  const ov: Record<string, unknown> = overrides !== null && typeof overrides === 'object' && !Array.isArray(overrides) ? (overrides as Record<string, unknown>) : {}
  const [dateFields, usedDefaultFields] = dateFieldsOf(cfg)

  const out: Finding[] = []
  const mdToCheck: Array<[role: string, label: string, rel: string]> = []

  // 声明了工作项目录却不在：项目声明的落点不成立，任何档都判 FAIL（契约 §1.1；C09）。
  // evidence／freshness／drift 对同一件记 SKIP 指向这里；L1 的 work_current 取它时不再另报
  const wrRaw = cfgGet(cfg, 'layout.work_root')
  const wr = normPath(pyTruthy(wrRaw) ? wrRaw : '')
  const wrThere = wr ? exists(root, wr, 'dir') : true
  if (wrThere === null) {
    out.push(outside(wr, '工作项目录'))
  } else if (!wrThere) {
    out.push(finding(NAME, FAIL, `layout.work_root 声明的工作项目录不在：${wr}`, {
      where: wr, kind: 'work-root-absent', key: wr,
      why: '01 §3.1：工作项一件一文件放在工作项目录；项目声明了它在哪，那里没有就是确定的缺失',
      evidence: `project.yaml 的 layout.work_root = ${wr}，${resolve(root)} 下没有这个目录`,
    }))
  }

  for (const [role, label, star, kind, cands] of tierItems(tier)) {
    const [skipped, sreason] = artifactTailored(cfg, role)
    if (skipped) {
      out.push(finding(NAME, SKIP, `${label}（${role}）已登记为不适用`, {
        reason: sreason || 'project.yaml 的 tailoring 未写理由', why: '01 §3.1：树里每一行都要能说出它承载哪条职责；裁剪须登记',
      }))
      continue
    }

    // 入口与 entry-budget 同一种读法（entryFiles）：声明优先，未声明取候选里存在的那个。
    // 候选全不在时落到下面的通用分支，记 ★ 未定一次（entry-budget 那边记不适用）。
    const [entries, guessed] = role === 'entry' ? entryFiles(cfg) : [[] as string[], '']
    if (entries.length) {
      for (const raw of entries) {
        const rel = normPath(raw)
        const there = exists(root, rel, 'file')
        if (there === null) {
          out.push(outside(rel, label))
        } else if (there) {
          out.push(finding(NAME, PASS, `入口 ${rel} 在`, { where: rel, evidence: guessed || '来自项目声明（layout.entry／layout.artifacts.entry）' }))
          mdToCheck.push([role, label, rel])
        } else {
          out.push(finding(NAME, FAIL, `★ 入口缺失：${rel}`, {
            where: rel,
            why: '01 §3.1：入口、验收、状态是最小起点（★）；01 §3.2 入口每次整份加载，缺了默认加载合同就不成立',
            evidence: `来自项目声明（layout.entry／layout.artifacts.entry），${resolve(root)} 下没有`,
          }))
        }
      }
      continue
    }

    let override: string | undefined = pyTruthy(ov[role]) ? pyStr(ov[role]) : undefined
    let srcKey = `layout.artifacts.${role}`
    if (role === 'work_current' && wr && !wrThere && normPath(override ?? wr) === wr) continue // 落点就是上面已报的工作项目录（声明的 work_current 与 work_root 同指也算，R2-4）
    if (!override && role === 'work_current' && wr) { override = wr; srcKey = 'layout.work_root' }
    const candList: string[] = override ? [normPath(override)] : cands.map((c) => rebaseDocs(c, docsRoot))
    let hit: string | null = null
    let outsideRel: string | null = null
    for (const rel of candList) {
      const there = exists(root, rel, kind)
      if (there) { hit = rel; break }
      outsideRel = outsideRel || (there === null ? rel : null)
    }
    if (hit === null && outsideRel) { out.push(outside(outsideRel, label)); continue }

    const src = override ? srcKey : `${TEMPLATE_SOURCE} 快照候选：${candList.join('、')}`

    if (hit === null) {
      if (star && override) {
        // 项目自己声明了它在哪，那条路径上没有东西 —— 这是确定的缺失。
        out.push(finding(NAME, FAIL, `★ ${label} 类工件缺失（${role}）`, {
          where: candList[0]!,
          why: '01 §3.1：入口、验收、状态是最小起点（★），少一件这套管理就没有落点',
          evidence: `项目在 ${srcKey} 声明了它，该路径下没有。${src}`,
        }))
      } else if (star) {
        // 未声明 + 候选未命中。候选路径只是本工具从模板抄来的一份猜测，用它落空推不出「这个仓真的没有验收/状态工件」。
        // 契约 §1/§7：判据靠猜测得出的结论只能是 PASS 或 UNDETERMINED。
        out.push(finding(NAME, UNDETERMINED, `★ ${label} 类工件没找到（${role}）`, {
          where: candList[0]!,
          reason: `项目未在 layout.artifacts.${role} 里声明它在哪，工具只按快照候选路径找过；候选落空不等于该工件不存在`,
          why: '01 §3.1：入口、验收、状态是最小起点（★）。要把它判成缺失，先在 layout.artifacts 里声明落点——声明后仍然没有才记 FAIL',
          evidence: `候选都不存在。${src}`,
        }))
      } else {
        out.push(finding(NAME, UNDETERMINED, `${tier} 档要求的 ${label}（${role}）没找到`, {
          where: candList[0]!,
          reason: '可能是有意裁剪但没在 tailoring 里登记，也可能是真的漏了；本工具判不了是哪一种',
          why: `01 §3.1：${tier} 档的树里有这一项；不登记的缺失按未定，不按通过`,
          evidence: `候选都不存在。${src}`,
        }))
      }
      continue
    }

    out.push(finding(NAME, PASS, `${label}（${role}）在：${hit}`, { where: hit, evidence: src }))
    if (kind !== 'glob' && hit.toLowerCase().endsWith('.md') && isFile(join(root, ...hit.split('/')))) {
      mdToCheck.push([role, label, hit])
    } else if ((role === 'acceptance' || role === 'status') && isDir(join(root, ...hit.split('/'))) &&
      !out.some((f) => f.where === hit && f.status === SKIP)) { // 只报判元信息的两类、同一目录一次（R2-6）
      out.push(finding(NAME, SKIP, `${hit} 是目录，不逐份判其下文档的元信息`, {
        where: hit, reason: '01 §3.5 的元信息挂在具体文档上；目录下有哪几份该带元信息本工具判不了',
      }))
    }
  }

  const note = usedDefaultFields
    ? `元信息日期字段用的是标准默认 ${dateFields.join('/')}，项目未在 metadata_fields 里校准（契约 §5）`
    : `元信息日期字段取自 project.yaml 的 metadata_fields：${dateFields.join('/')}`

  // 01 §3.5 只点名验收等六类，§3.2 给 entry/playbook/work 的过期发现方式都不是元信息头；其余角色不判
  for (const [role, , rel] of mdToCheck) {
    if (role !== 'acceptance' && role !== 'status') continue
    const path = join(root, ...rel.split('/'))
    let h: string, text: string
    try {
      ;[h, text] = head(path, root)
    } catch (exc) {
      out.push(unreadable(NAME, rel, exc))
      continue
    }
    // 字段名只有项目在 metadata_fields 里声明过的才算「确定没有」；工具词表（状态字段、默认日期字段名）没找到只说明不在工具猜的写法里，按契约 §1.1 记未定
    const missing: string[] = [], guessedMiss: string[] = []
    if (!dateFields.some((f) => hasField(h, f))) (usedDefaultFields ? guessedMiss : missing).push(`日期字段（${dateFields.join('/')}）`)
    if (itemStatus(text) === null) guessedMiss.push(`状态字段（${STATUS_FIELDS.join('/')}）`) // 与 freshness/evidence 同一处头部划界（headOf，D-134）
    if (guessedMiss.length && !missing.length) {
      out.push(finding(NAME, UNDETERMINED, `${rel} 头部没认出元信息：${guessedMiss.join('、')}`, {
        where: `${rel}:1`, kind: 'meta-unrecognized', key: rel,
        reason: '字段名是本工具的词表（状态字段）或未校准的默认（日期字段），不是项目的声明；没认出推不出没写（契约 §1.1）。日期字段名在 metadata_fields 里声明之后仍缺才判 FAIL',
        why: '01 §3.5 要求重要文档头部带 status 与 updated_at',
        evidence: `只看前 ${META_HEAD_LINES} 行。${note}`,
      }))
    } else if (missing.length) {
      missing.push(...guessedMiss)
      out.push(finding(NAME, FAIL, `${rel} 头部缺元信息：${missing.join('、')}`, {
        where: `${rel}:1`,
        why: '01 §3.5 要求重要文档头部带 status 与 updated_at；没有元信息就无法按 01 §3.2「它过期了怎么被发现」那一列发现它过期',
        evidence: `只看前 ${META_HEAD_LINES} 行。${note}`,
      }))
    } else {
      out.push(finding(NAME, PASS, `${rel} 头部元信息齐`, { where: rel, evidence: note }))
    }
  }

  return out
}

// --------------------------------------------------------------------------
// 自检：反例两条（工件缺失、元信息缺失）、探测一条、正例一条，外加 C16、C09、R2-6、find_field 线性、C14。见契约 §3。
// --------------------------------------------------------------------------

export function selftest(): Finding[] {
  const results: Finding[] = []
  const tmps: string[] = []
  const mk = (prefix = 'lyself-'): string => { const t = mkdtempSync(join(tmpdir(), prefix)); tmps.push(t); return t }
  const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
  try {
    {
      const tmp = mk()
      const w = (name: string, body: string): void => writeText(join(tmp, ...name.split('/')), body)
      const meta = '---\nid: X\nstatus: active\nupdated_at: 2026-09-10\n---\n\n# 标题\n'
      for (const name of ['CONTEXT.md', 'ACCEPTANCE.md', 'WORK.md', 'PLAYBOOK.md', 'FAILURES.md']) w(name, meta)

      const cfg: Config = { _root: tmp, tier: 'L0', layout: { entry: ['CONTEXT.md'], docs_root: 'docs', artifacts: { status: 'WORK.md' } } }
      // 同一个仓，但没在 layout.artifacts 里声明状态工件在哪
      const cfgUndeclared: Config = { _root: tmp, tier: 'L0', layout: { entry: ['CONTEXT.md'], docs_root: 'docs' } }

      // 正例：L0 五件齐、元信息齐 → 全 PASS
      const gotOk = run(cfg).map((f) => f.status)

      // 反例二：声明了状态工件在 WORK.md，文件在但头部元信息被抽掉 → 必须有 FAIL。
      // 元信息判定只对 acceptance / status 两角色执行，不声明这两角色的项目上它一条都不跑，这条反例是它还活着的唯一证据（契约 §3）。
      // 日期字段名须经 metadata_fields 声明，缺了才是确定违规（契约 §1.1）
      w('WORK.md', '# 标题\n')
      const resNometa = run({ ...cfg, metadata_fields: ['updated_at'] })
      const gotNometa = resNometa.map((f) => f.status)
      const nometaFail = resNometa.filter((f) => f.status === FAIL && f.title.includes('头部缺元信息')).map((f) => f.title)
      // 同一样本不声明 metadata_fields：两个字段名都是工具词表，没认出只记未定
      const resGuess = run(cfg).filter((f) => f.status !== PASS).map((f) => [f.status, f.id])
      // 同一行用全角空格并排的写法（示例项目的形态）与 freshness 同一套解析，须认得出
      w('WORK.md', '# 标题\n\n状态：进行中　updated_at：2026-09-10\n')
      const resInline = run(cfg).filter((f) => f.status !== PASS).map((f) => [f.status, f.title])
      results.push(probe(NAME, eq(resGuess, [[UNDETERMINED, 'layout/meta-unrecognized/WORK.md']]) && resInline.length === 0,
        '约定：未声明 metadata_fields 时缺元信息只记未定；同行并排的字段须认得出', {
          evidence: `未声明时非通过项 ${pyList(resGuess)}；同行写法非通过项 ${pyList(resInline)}`,
          why: '契约 §1.1：字段名词表落空推不出没写；layout 与 freshness 共用 findField',
        }))

      // 反例一：声明了状态工件在 WORK.md，删掉它 → 必须有 FAIL
      rmSync(join(tmp, 'WORK.md'))
      const gotBad = run(cfg).map((f) => f.status)

      // 探测：同样缺 WORK.md，但项目没声明落点 → 只许未定，不许 FAIL。候选路径是本工具从模板抄来的猜测，落空推不出「该仓没有状态工件」。
      const resUnd = run(cfgUndeclared)
      const gotUnd = resUnd.map((f) => f.status)
      const starUnd = resUnd.filter((f) => f.status === UNDETERMINED && f.title.startsWith('★ '))

      results.push(probe(NAME, gotBad.includes(FAIL), '反例：layout.artifacts 声明了 ★ 状态工件却不存在，应判 FAIL', {
        evidence: `实得 ${pyList(gotBad)}`, why: '契约 §3 静默失效探测；判据 01 §3.1 的 ★ 三类',
      }))
      results.push(probe(NAME, nometaFail.length > 0, '反例：声明的 ★ 状态工件缺头部元信息，应判 FAIL', {
        evidence: `实得 ${pyList(gotNometa)}；元信息 FAIL ${pyList(nometaFail)}`, why: '01 §3.5 要求重要文档头部带 status 与 updated_at；契约 §3 静默失效探测',
      }))
      results.push(probe(NAME, !gotUnd.includes(FAIL) && starUnd.length > 0, '探测：★ 工件未声明落点且候选未命中，应判未定、不得判 FAIL', {
        evidence: `实得 ${pyList(gotUnd)}；★ 未定 ${starUnd.length} 条`,
        why: '契约 §1/§7：判据靠猜测（这里是模板快照的候选路径）得出的结论只能是 PASS 或 UNDETERMINED',
      }))
      results.push(probe(NAME, gotOk.length > 0 && new Set(gotOk).size === 1 && gotOk[0] === PASS, '正例：L0 五件齐且元信息齐应全判 PASS', {
        evidence: `实得 ${pyList(gotOk)}`, why: '契约 §3 静默失效探测',
      }))
    }
    // C16：入口与状态工件是指向项目之外的符号链接——不当作在（旧写法跟随链接判 PASS），也不判缺失，记未定且不读；entry-budget 对入口记 SKIP，同一件事只报一次
    {
      const tmp = mk(), outDir = mk('lyself-out-')
      const meta = '---\nid: X\nstatus: active\nupdated_at: 2026-09-10\n---\n\n# 标题\n'
      for (const name of ['AGENTS.md', 'WORK.md']) { writeFileSync(join(outDir, name), meta); symlinkSync(join(outDir, name), join(tmp, name), 'file') }
      const res = run({ _root: tmp, tier: 'L0', layout: { entry: ['AGENTS.md'] } })
      const got = res.filter((f) => f.status !== UNDETERMINED || f.id.includes('outside')).map((f) => f.id).sort(cmpCp)
      const want = ['layout/outside-root/AGENTS.md', 'layout/outside-root/WORK.md']
      results.push(probe(NAME, eq(got, want), 'C16：入口与状态工件链到项目之外记未定，不判在、不判缺', {
        evidence: `实得 ${pyList(got)}；应得 ${pyList(want)}`, why: '契约 §5：只读被扫项目之内的文件；§1 同一事实只报一次',
      }))
    }
    // C09：声明了 layout.work_root 而目录不在，L0、L1、以及另行声明了 work_current 时都只报一条 FAIL
    {
      const tmp = mk()
      const got: Array<Array<[string, string]>> = []
      for (const [tier, art] of [['L0', {}], ['L1', {}], ['L1', { work_current: 'ACCEPTANCE.md' }], ['L1', { work_current: 'nope/' }]] as Array<[string, Record<string, string>]>) { // 与 work_root 同指（R2-4）
        const res = run({ _root: tmp, tier, layout: { work_root: 'nope', artifacts: art } })
        got.push(res.filter((f) => (f.where ?? '').includes('nope')).map((f): [string, string] => [f.status, f.id]))
      }
      const want = [[[FAIL, 'layout/work-root-absent/nope']], [[FAIL, 'layout/work-root-absent/nope']], [[FAIL, 'layout/work-root-absent/nope']], [[FAIL, 'layout/work-root-absent/nope']]]
      results.push(probe(NAME, eq(got, want), 'C09：声明的工作项目录不在，任何档都由 layout 报且只报一条 FAIL', {
        evidence: `实得 ${pyList(got)}`, why: '契约 §1.1 声明后仍不成立判 FAIL；§1 同一事实只报一次',
      }))
    }
    // R2-6：同一目录兼作 status、acceptance、handoff、work_current 时，「是目录」SKIP 只出一条
    {
      const tmp = mk()
      writeText(join(tmp, 'w', '.keep'), '')
      rmSync(join(tmp, 'w', '.keep'))
      writeFileSync(join(tmp, 'AGENTS.md'), '')
      const art: Record<string, string> = {}
      for (const r of ['status', 'acceptance', 'handoff', 'work_current']) art[r] = 'w'
      const got = run({ _root: tmp, tier: 'L1', layout: { entry: ['AGENTS.md'], artifacts: art } }).filter((f) => f.status === SKIP).map((f) => f.id)
      results.push(probe(NAME, got.length === 1, 'R2-6：同一目录兼作几类工件时「是目录，不逐份判元信息」只出一条', {
        evidence: `实得 ${pyList(got)}`, why: '契约 §1 同一事实只报一次',
      }))
    }
    // R2-11 R1-01 R1-05：find_field 线性（满行 `*` 曾 20 万字符 138 秒）；常见写法结果不变；
    // 第一次出现的字段值为空即缺字段，不跳到后文同名字段；冒号后全角空格照读
    {
      const t0 = Date.now()
      for (const line of ['*'.repeat(200000), '**'.repeat(40000)]) findField(line, ['status'])
      const took = (Date.now() - t0) / 1000
      const samples: Array<[string, string]> = [['**status**: done', 'status'], ['- status: done', 'status'], ['> status: done', 'status'], ['`status`: done', 'status'],
        ['build-status: passing', 'status'], ['| status: done |', 'status'], ['状态：进行中　updated_at：2026-09-10', 'updated_at'], ['*状态*：done', '状态'],
        ['状态：\n\n## 历史\n- 09-01 状态：done\n', '状态'], ['状态：　done', '状态']]
      const got = samples.map(([t, n]) => findField(t, [n])[0])
      const want = ['done', 'done', 'done', 'done', null, 'done', '2026-09-10', 'done', null, 'done']
      results.push(probe(NAME, eq(got, want) && took < 2, 'find_field：满行 * 线性；常见写法照认；首个同名字段为空即缺；全角空格照跳', {
        evidence: `实得 ${pyList(got)}，耗时 ${took.toFixed(2)}s`, why: '一份文件不许拖死整次检查；契约 §5 空值与不写同义',
      }))
    }
    // C14：扫描根路径里带 [ ] 时，项目侧检查器的通配候选照样找得到
    {
      const tmp = mk('a[b]')
      writeText(join(tmp, 'tools', 'check_x.py'), '')
      const got = run({ _root: tmp, tier: 'L2' }).filter((f) => f.title.includes('（checkers）')).map((f) => f.status)
      results.push(probe(NAME, eq(got, [PASS]), 'C14：扫描根带 [ ] 时 glob 候选按字面拼根，tools/check_x.py 判在', {
        evidence: `实得 ${pyList(got)}`, why: '01 §3.1：L2 的项目侧检查器；候选命中就是看见的事实',
      }))
    }
  } catch (exc) {
    results.push(undeterminedFromException(NAME, exc, '跑自检'))
  } finally {
    for (const t of tmps) rmSync(t, { recursive: true, force: true })
  }
  return results
}

/** Python 的列表 repr 只进 evidence，不进 id；用 JSON 近似即可。 */
const pyList = (v: unknown): string => JSON.stringify(v)

const cmpCp = (a: string, b: string): number => {
  const x = [...a], y = [...b]
  for (let i = 0; i < Math.min(x.length, y.length); i++) { const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!; if (d) return d }
  return x.length - y.length
}
