#!/usr/bin/env node
// D-014 规范效力元治理检查器（本仓自检，效力为零的载体实例）。
//
// 校验：
//   C1  所有 governed_by 引用的 decision_id 在决策索引中存在
//   C2  生效登记表中每条记录的必需字段齐全（按状态区分）
//   C3  生效登记表中的「试行」条目 expiry 可解析（不可解析＝不合规）；已过期只作到期通告，不计入不合规，也不计入生效规则
//   C4  决策索引状态列与生效登记表一致
//   C5  规范正文中不存在第三处状态值副本
//   C6  所有规范文档都声明了 governed_by
//   C7  正文每条原则在追溯账本中有且只有一条记录；账本缺失也算不合规
//   C8  活文档不自行声明语料版本号
//   C9  决策日志的散文生效计数与生效登记表对账
//   C10 散文里的「NN §M」引用指向正文中真实存在的小节
//
// 由 pre-commit 挂成提交闸门（Gate 合同见仓库工作须知 §7）。
// 退出码：0 全部通过；1 存在不合规项；2 输入缺失或无法解析，或生效规则集为空（UNDETERMINED，D-014 §4）。
//
// 原为 Python 脚本（docs/附录-载体实例/check_normative_force.py），阶段 4 迁成 Node；判据与输出格式不变。
// 扫描面取 git ls-files（已跟踪与已暂存），与 std-check 同口径：未跟踪草稿不参与任何一项。
//
// 用法：node scripts/check-normative-force.mjs [仓根]（默认：本脚本所在仓）
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { maskCode } from '../lib/checks/links.js'
import { trackedFiles } from '../lib/core/tracked.js'

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
const LOG = join(ROOT, 'docs', '决策日志.md')

const FORCE_STATES = ['提议', '试行', '已接受', '已取代', '已拒绝', '已执行']
const EFFECTIVE_STATES = ['试行', '已接受']
const REQUIRED_FIELDS = {
  试行: ['approved_by', 'approved_at', 'effective_scope · blocks', 'effective_scope · grants', 'review_at', 'expiry'],
  已接受: ['approved_by', 'approved_at', 'effective_scope · blocks', 'effective_scope · grants'],
}
// 允许出现状态值的位置：元治理正文（定义语义）与决策日志（唯一效力源）
const STATE_COPY_EXEMPT = new Set(['docs/08-规范效力元治理.md', 'docs/决策日志.md'])
// 需要声明 governed_by 的规范文档（原 glob：docs/[0-4]*.md、术语表、决策日志、架构确定）
const isGoverned = (rel) => /^docs\/[0-4][^/]*\.md$/.test(rel) || ['docs/术语表.md', 'docs/决策日志.md', 'docs/架构确定.md'].includes(rel)

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const read = (p) => readFileSync(p, 'utf8')
const lines = (s) => s.split(/\r\n|\n|\r/)             // Python splitlines 的子集；本仓文件只有 \n 与 \r\n
const rel = (p) => p.slice(ROOT.length + 1).replaceAll('\\', '/')

class Finding {
  constructor(code, path, line, msg) { this.code = code; this.path = path; this.line = line; this.msg = msg }
  toString() { return `[${this.code}] ${this.line ? `${this.path}:${this.line}` : this.path}\n        ${this.msg}` }
}

function rows(block) {
  const out = []
  for (let ln of lines(block)) {
    ln = ln.trim()
    if (!ln.startsWith('|')) continue
    const cells = ln.replace(/^\|+|\|+$/g, '').split('|').map((c) => c.trim())
    if (cells.filter((c) => c).every((c) => /^:?-{2,}:?$/.test(c))) continue
    out.push(cells)
  }
  return out
}

/** 取出从某标题到下一个同级/更高级标题之间的内容。 */
function section(text, head) {
  const m = new RegExp(`^#{2,3} .*${esc(head)}.*$`, 'm').exec(text)
  if (!m) return ''
  const start = m.index + m[0].length
  const rest = text.slice(start)
  const nxt = /^#{2,3} /m.exec(rest)
  return nxt ? rest.slice(0, nxt.index) : rest
}
const strip = (cell) => cell.replace(/[*`~]/g, '').trim()
const zip = (hdr, row) => Object.fromEntries(hdr.map((h, i) => [h, row[i]]).filter(([, v]) => v !== undefined))
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length

function main() {
  if (!existsSync(LOG)) { console.error(`FATAL 决策日志缺失：${LOG}`); return 2 }
  const log = read(LOG)
  const findings = [], expired = [], expiredIds = new Set()
  const logRel = rel(LOG)

  // ---- 解析生效登记表 ----
  const regRows = rows(section(log, '生效登记表'))
  if (!regRows.length) { console.error('FATAL 未找到生效登记表'); return 2 }
  const [regHdr, ...regData] = regRows
  const register = new Map()
  for (const r of regData) { const rec = zip(regHdr, r); const did = strip(rec.decision_id ?? ''); if (did) register.set(did, rec) }

  // ---- 解析决策索引 ----
  const idxRows = rows(section(log, '决策索引'))
  const [idxHdr, ...idxData] = idxRows.length ? idxRows : [[]]
  const index = new Map()
  for (const r of idxData) { const rec = zip(idxHdr, r); const did = strip(rec.ID ?? ''); if (did) index.set(did, strip(rec['状态'] ?? '')) }
  if (!index.size) { console.error('FATAL 未找到决策索引'); return 2 }

  const now = new Date(), today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())

  // ---- C2 / C3 生效登记表字段与到期 ----
  for (const [did, rec] of register) {
    const status = strip(rec['状态'] ?? '')
    if (!EFFECTIVE_STATES.includes(status)) {
      findings.push(new Finding('C2', logRel, null, `${did} 出现在生效登记表但状态为「${status}」；登记表只收录 试行/已接受`))
      continue
    }
    for (const field of REQUIRED_FIELDS[status]) {
      if (!strip(rec[field] ?? '')) findings.push(new Finding('C2', logRel, null, `${did}（${status}）缺少必需字段 \`${field}\`；按 D-014 §1 不视为已生效`))
    }
    if (status === '试行') {
      const exp = strip(rec.expiry ?? '')
      const m = /(\d{4})-(\d{2})-(\d{2})/.exec(exp)
      let expDate = null
      if (m) { const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]; const t = new Date(Date.UTC(y, mo - 1, d)); if (t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d) expDate = t.getTime() } // 形如 2020-02-30：像日期但不存在，同样是写错了
      if (expDate === null) findings.push(new Finding('C3', logRel, null, `${did}（试行）的 expiry 不是可解析日期：${pyRepr(exp)}`))
      else if (expDate < today) {
        expiredIds.add(did)
        expired.push(new Finding('C3', logRel, null, `${did}（试行）已于 ${exp} 到期，按 D-014 §6 自动退回「提议」，须从生效登记表移除或重新批准（历史结果不追溯）`))
      }
    }
  }

  // ---- C4 索引与登记表一致 ----
  for (const [did, status] of index) {
    const inReg = register.has(did)
    if (EFFECTIVE_STATES.includes(status) && !inReg) findings.push(new Finding('C4', logRel, null, `${did} 索引状态为「${status}」但未登记；按 D-014 §5 以登记表为准，实际不生效`))
    if (!EFFECTIVE_STATES.includes(status) && inReg) findings.push(new Finding('C4', logRel, null, `${did} 已登记但索引状态为「${status}」，两处不一致`))
    if (inReg && strip(register.get(did)['状态'] ?? '') !== status) findings.push(new Finding('C4', logRel, null, `${did} 状态不一致：索引「${status}」 vs 登记表「${strip(register.get(did)['状态'] ?? '')}」`))
    if (status && !FORCE_STATES.includes(status)) findings.push(new Finding('C4', logRel, null, `${did} 使用了未定义的状态值「${status}」`))
  }

  // ---- C1 / C5 / C6 逐文档 ----
  // 全部扫描面只取已跟踪（含已暂存）的 .md：未跟踪草稿不参与任何一项
  const [tr, problem] = trackedFiles(ROOT)
  if (!tr) { console.error(`不在 git 工作区（或没有 git），无法取文件清单：${ROOT}（${problem}）`); return 2 }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  const tracked = tr.filter((f) => f.toLowerCase().endsWith('.md') && existsSync(join(ROOT, f))).map((f) => f.replaceAll('\\', '/')).sort(cmp)
  const mdFiles = tracked.filter(isGoverned)
  // 上下文合同只进 C5 的扫描面（它是加载入口，一句过期的效力声明在这里最危险），不进 C6 的 governed_by 要求——它不是规范正文。
  // PROJECT_STATUS、README 与失败 Case 清单刻意不纳入：那里有对历史状态的叙述，纳入即制造大批误伤（33 §2 P9 的 Thin 信号）。
  const c5Extra = existsSync(join(ROOT, 'CONTEXT_MANIFEST.md')) ? ['CONTEXT_MANIFEST.md'] : []
  // C5 两种形态都要认（Case C-022）：括号形态「（均为提议）」，与系动词形态「正文各章仍是`提议`」
  const ST = FORCE_STATES.join('|')
  const stateCopyRe = new RegExp(`[（(]\\s*(?:均为)?\\s*[\`「"]?(${ST})[\`」"]?\\s*[）)]|(?:仍是|仍为|全部是|全都是|一律是|均为|都是|是|为)\\s*[\`「"](${ST})[\`」"]`)
  for (const r of [...mdFiles, ...c5Extra]) {
    const text = read(join(ROOT, r))
    const head = lines(text).slice(0, 12).join('\n')
    const isExtra = c5Extra.includes(r)
    const gm = /^governed_by[：:]\s*(.+)$/m.exec(head)
    if (isExtra) { /* 不进 C6 */ }
    else if (!gm) findings.push(new Finding('C6', r, null, '规范文档未在文件头 12 行内声明 governed_by（D-014 §7）'))
    else {
      const refs = gm[1].match(/D-\d{3}/g) ?? []
      if (!refs.length) findings.push(new Finding('C6', r, null, `governed_by 未解析出任何 decision_id：${pyRepr(gm[1])}`))
      for (const did of refs) if (!index.has(did)) findings.push(new Finding('C1', r, head.slice(0, gm.index).split('\n').length - 1 + 1, `governed_by 引用了决策索引中不存在的 ${did}`))
    }
    if (STATE_COPY_EXEMPT.has(r)) continue
    lines(text).forEach((ln, i) => {
      const m = stateCopyRe.exec(ln)
      if (m) findings.push(new Finding('C5', r, i + 1, `状态值副本「${m[0]}」；状态只允许存在于生效登记表与决策索引（D-014 §7）。此处应删除或改为指向生效登记表的链接`))
    })
  }

  // ---- C7：每条原则在追溯记录中有且只有一条对应项（D-014 §9） ----
  const ledgerP = join(ROOT, 'docs', '追溯账本.md')
  const chapters = tracked.filter((r) => /^docs\/[1-4][0-9]-.*\.md$/.test(r))
  if (chapters.length && !existsSync(ledgerP)) findings.push(new Finding('C7', 'docs/追溯账本.md', null, '追溯账本不存在，正文原则无从对账')) // 账本段缺失即为缺陷（上下文合同第 7 项），不得静默跳过
  else if (chapters.length) {
    const ledger = read(ledgerP)
    for (const r of chapters) {
      const num = r.split('/').pop().slice(0, 2)
      const m = new RegExp(`<a id="ch-${num}"></a>`).exec(ledger)
      let sec = ''
      if (m) { const rest = ledger.slice(m.index + m[0].length); const n = /<a id="ch-\d\d"><\/a>/.exec(rest); sec = n ? rest.slice(0, n.index) : rest }
      const inBody = [...read(join(ROOT, r)).matchAll(/^- \*\*(P\d+)/gm)].map((x) => x[1])
      const inLedger = [...sec.matchAll(/^\|\s*(P\d+)\s*\|/gm)].map((x) => x[1])
      if (!sec) { findings.push(new Finding('C7', r, null, `追溯账本缺少 ch-${num} 的记录段`)); continue }
      const miss = inBody.filter((x) => !inLedger.includes(x))
      const extra = inLedger.filter((x) => !inBody.includes(x))
      const dup = [...new Set(inLedger)].filter((x) => inLedger.filter((y) => y === x).length > 1)
      if (miss.length || extra.length || dup.length) findings.push(new Finding('C7', r, null, `正文与追溯账本的原则编号对不上——正文有账本无：${pyList(miss)}；账本有正文无：${pyList(extra)}；账本内重复：${pyList(dup)}`))
    }
  }

  // ---- C8：语料版本号只允许一处（D-014 §7 的单一副本判据） ----
  const VERSION_SNAPSHOT_DIRS = ['docs/归档/历史/', 'docs/参考资料', 'docs/归档/输入材料', 'docs/审计记录', 'docs/归档/参考资料-公众号文章']
  const verRe = /^(?:状态|当前版本)[：:]\s*`v\d+\.\d+[-\w]*`/m
  for (const r of tracked) {
    if (VERSION_SNAPSHOT_DIRS.some((d) => r.startsWith(d))) continue // 冻结快照与研究材料保留其被冻结时的版本号
    if (r === 'PROJECT_STATUS.md') continue // 唯一权威位置
    const m = verRe.exec(read(join(ROOT, r)))
    if (m) findings.push(new Finding('C8', r, null, `自行声明了语料版本号「${m[0]}」；版本号只允许出现在 PROJECT_STATUS.md 的 corpus_version（D-014 §7 单一副本）。此处应删除或改为指向该字段的链接`))
  }

  // 生效集合只在这里算一次，C9 与报头共用；已到期的试行项不算（D-082）
  const effIds = [...register].filter(([d, r]) => EFFECTIVE_STATES.includes(strip(r['状态'] ?? '')) && !expiredIds.has(d)).map(([d]) => d).sort(cmp)

  // ---- C9：决策日志里的散文计数须与表对账（Case C-005） ----
  const cm = /当前生效规则数：\*\*(\d+)\*\*/.exec(log)
  // 散文数恰好多出已到期条数：是日历翻页，归到期通告，不进 FAIL（同 D-078 2a）
  if (cm && ![effIds.length, effIds.length + expiredIds.size].includes(Number(cm[1]))) findings.push(new Finding('C9', logRel, null, `散文写「生效规则数 ${cm[1]}」，与生效登记表实算 ${effIds.length} 条不一致`))

  // ---- C10：散文里的「NN §M」引用须指向正文中真实存在的小节（Case C-003） ----
  const bodySecs = new Map()
  for (const r of chapters) bodySecs.set(r.split('/').pop().slice(0, 2), new Set([...read(join(ROOT, r)).matchAll(/^## (\d+)\. /gm)].map((x) => x[1])))
  const LIVE_SKIP = VERSION_SNAPSHOT_DIRS
  // 两种引用形态都要认：裸写「21 §6」，以及链接写法「[21 调度与拆分](21-调度与拆分.md) §6」
  const BODY_ALT = '(1[0-2]|2[0-5]|3[0-3]|40)'
  const refBare = new RegExp(`(?<![\\d.])${BODY_ALT}[ \\u3000]?(?:章[ \\u3000]?)?§\\s?(\\d+)(?![\\d.])`, 'g')
  const refLink = new RegExp(`\\]\\(\\.?/?${BODY_ALT}-[^)]*\\)\\s*§\\s?(\\d+)(?![\\d.])`, 'g')
  for (const r of tracked) {
    if (LIVE_SKIP.some((s) => r.startsWith(s))) continue
    const text = maskCode(read(join(ROOT, r)))
    for (const [rx, isLink] of [[refBare, false], [refLink, true]]) {
      for (const mo of text.matchAll(rx)) {
        const [ch, sec] = [mo[1], mo[2]]
        if (!bodySecs.has(ch)) continue
        if (!isLink) {
          const pre = text.slice(Math.max(0, mo.index - 24), mo.index)
          if (/(WX-|SRC-|D-|T[1-6] |00[0-9] )\S*$/.test(pre)) continue // 指向研究材料而不是正文
        }
        if (!bodySecs.get(ch).has(sec)) {
          const ln = text.slice(0, mo.index).split('\n').length
          findings.push(new Finding('C10', r, ln, `引用了 ${ch} 章的 §${sec}，但该章只有 §` + [...bodySecs.get(ch)].sort((a, b) => Number(a) - Number(b)).join('/§')))
        }
      }
    }
  }

  // ---- 报告 ----
  console.log('D-014 规范效力检查器')
  console.log(`  决策总数：${index.size}   生效规则：${effIds.length}（${effIds.join('、') || '无'}）   扫描文档：${mdFiles.length}`)
  if (expiredIds.size) console.log(`  已到期：${expiredIds.size}（${[...expiredIds].sort(cmp).join('、')}）——不计入生效规则，见下方到期通告`)
  if (!effIds.length) console.log('  注意：生效规则集为空，『全部规则通过』不得视为 PASS（D-014 §4）。')
  console.log()
  if (expired.length) {
    console.log('到期通告  不计入不合规项（只在它使生效集变空时退出 2，见上）。按 08 §6 已自动退回「提议」，须人决定续期或移出生效登记表，并在决策日志留下处置痕迹：')
    for (const f of expired) console.log('  ' + f)
    console.log()
  }
  if (!findings.length && !effIds.length) { console.log('UNDETERMINED  生效规则集为空，『全部规则通过』不得视为 PASS（D-014 §4）。'); return 2 }
  if (!findings.length) { console.log('PASS  未发现不合规项。'); return 0 }
  const byCode = new Map()
  for (const f of findings) { if (!byCode.has(f.code)) byCode.set(f.code, []); byCode.get(f.code).push(f) }
  console.log(`FAIL  ${findings.length} 项不合规：\n`)
  for (const code of [...byCode.keys()].sort(cmp)) { // 与 Python 的 sorted(str) 一致：C1、C10、C2……（不是数字序；输出格式不变是迁移的承诺）
    for (const f of byCode.get(code)) console.log('  ' + f)
    console.log()
  }
  return 1
}

/** Python 的 repr(str)：单引号包裹；含单引号且不含双引号时改用双引号。仅用于错误信息里回显用户写的值。 */
function pyRepr(s) {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'"
  return q + s.replaceAll('\\', '\\\\').replaceAll(q, '\\' + q).replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t') + q
}
/** Python 里 `f"{miss or '无'}"`：空列表写 `无`，否则是列表的 repr。 */
function pyList(a) { return a.length ? '[' + a.map(pyRepr).join(', ') + ']' : '无' }

process.exit(main())
