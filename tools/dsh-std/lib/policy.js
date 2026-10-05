// 判定核心：纯函数，不依赖 DSH，可单独测。
//
// 输入是一次工具调用（name + arguments），输出是 {kind:'allow'} | {kind:'ask', reason} | {kind:'deny', reason}。
// 对应 01 §5.5 受控动作：本仓只列确有对象的几类（与原 .claude/settings.json 的 ask 清单同口径，D-135 迁入）。
//
// 设计约束：
//  - 命令串分析只是尽力而为的预过滤，不是安全边界（见 README「盲区」）。**解析不了的形状一律 ask，不静默放行**：
//    引号不配对、here 文档找不到终止符、块注释不闭合、here 文档正文含命令替换、命令嵌套过深、命令过长。
//  - **deny 只用于两件「不需要猜」的事实**：①写工具（write/edit）的路径参数落在内嵌目录 .std/ 之下；②shell 命令里**引号外重定向的目标词**
//    按（虚拟）cwd 解析后落在 .std/ 下。其余一切「带 .std 的写类命令」一律 **ask**，由人看一眼批准或拒绝。
//    为什么不更激进：独立审查四轮实测证明，没有真 shell 解析时「哪个词是写目标」的启发式两个方向都出错；而 deny 人批准不了，误报代价远高于 ask。
//  - 缺信息按未定处理，不按放行处理：参数缺失或类型不对 => ask。
//  - **线性时间**：词法是一遍手写扫描，不用跨整串的回溯正则；命令超过 MAX_CMD 字符不分析直接 ask；内嵌命令递归深度有界（MAX_DEPTH）。
//  - 路径比较在 Windows 上大小写不敏感，并先剥掉 Win32 会忽略的段尾点与空格、`\\?\` 前缀、NTFS 备用数据流后缀。

import path from 'node:path'

/** 写类工具的名字与它们的路径参数名（DSH 内置 fs 工具）。 */
const WRITE_TOOLS = { write: 'file_path', edit: 'file_path' }
/** 跑命令的工具（Windows 为 pwsh，POSIX 为 bash）。 */
const SHELL_TOOLS = new Set(['pwsh', 'bash'])
const IS_WIN = process.platform === 'win32'
/** 命令长度上限：超过则不分析，直接 ask（防 ReDoS，也防把超长命令当「已审」放行）。 */
export const MAX_CMD = 8192
/** 内嵌命令（`bash -c "…"`、`$(…)`、反引号等）的最大递归深度：再深一律 ask。 */
const MAX_DEPTH = 2

// ---------------------------------------------------------------------------
// 路径
// ---------------------------------------------------------------------------

/** 线性地剥掉段尾的点与空格（`/[. ]+$/` 在 `". . . x"` 这类输入上是二次方）。 */
function stripTrailingDotsSpaces(seg) {
  let end = seg.length
  while (end > 0 && (seg[end - 1] === '.' || seg[end - 1] === ' ')) end--
  return seg.slice(0, end)
}

/** 把路径规整成可比较的形式：Win32 会忽略每段尾部的点与空格，并认 \\?\ 前缀；NTFS 的 `:流名` 后缀不改变文件本身；Windows 上还要忽略大小写。 */
export function normalizeForCompare(p) {
  let s = String(p)
  if (IS_WIN) s = s.replace(/^\\\\\?\\(UNC\\)?/, (m, unc) => (unc ? '\\\\' : ''))          // `\\?\` 与 `\\?\UNC\` 前缀，必须先于重复斜杠规整
  // `a/./b`、`a//b` => `a/b`；开头的 `./` 去掉。盘符后与 UNC 开头（`\\host`）的双反斜杠保留。
  const unc = IS_WIN && /^\\\\[^\\]/.test(s) ? '\\\\' : ''
  if (unc) s = s.slice(2)
  s = s.replace(/([\\/])\.(?=[\\/])/g, '$1').replace(/([\\/])[\\/]+/g, '$1')
  if (s.startsWith('./') || s.startsWith('.\\')) s = s.slice(2)
  s = unc + s
  if (IS_WIN) {
    // 备用数据流：`AGENTS.md::$DATA`、`AGENTS.md:evil`。盘符冒号（第 2 位）不动，其余的 `:…` 一律砍掉。
    s = s.replace(/^([A-Za-z]:)?([^:]*)(:.*)?$/, (m, drv, body) => (drv || '') + body)
    s = s.split(/[\\/]/).map((seg) => (seg === '.' || seg === '..' ? seg : stripTrailingDotsSpaces(seg))).join(path.sep)
    s = s.toLowerCase()
  }
  return s
}

function baseRoot(root) {
  return path.resolve(typeof root === 'string' && root !== '' ? root : process.cwd())
}

/** 路径是否落在内嵌标准目录（.std/）之下。base 缺省为 root（虚拟 cwd 时传入）。 */
export function inEmbeddedStd(p, root, base) {
  if (typeof p !== 'string' || p === '') return false
  const r = baseRoot(root)
  const b = base ? path.resolve(r, base) : r
  const abs = normalizeForCompare(path.resolve(b, p))
  const std = normalizeForCompare(path.resolve(r, '.std'))
  const rel = path.relative(std, abs)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** 路径是否是需要先问的受保护文件（改钩子、改入口合同、改守卫自身）；返回理由或 null。 */
export function protectedPath(p, root, base) {
  if (typeof p !== 'string' || p === '') return null
  const r = baseRoot(root)
  const b = base ? path.resolve(r, base) : r
  const rel = path.relative(normalizeForCompare(r), normalizeForCompare(path.resolve(b, p))).split(path.sep).join('/')
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  if (rel === 'context_manifest.md' || rel === 'CONTEXT_MANIFEST.md') return '改默认上下文合同（唯一清单）'
  if (rel === 'agents.md' || rel === 'AGENTS.md') return '改入口指令文件'
  if (rel.startsWith('.githooks/') || rel === '.githooks') return '改提交闸门钩子'
  if (rel.startsWith('tools/dsh-std/') || rel === 'tools/dsh-std') return '改守卫插件自身（改守卫的人不应由守卫放行）'
  return null
}

/** 路径是否指向状态入口/失败清单（只拦删除、移走、清空，不拦日常编辑）。 */
function isStateFile(p, root, base) {
  if (typeof p !== 'string' || p === '') return false
  const r = baseRoot(root)
  const b = base ? path.resolve(r, base) : r
  const name = path.basename(normalizeForCompare(path.resolve(b, p))).toLowerCase()
  return name === 'project_status.md' || name === '失败case清单.md'
}

// ---------------------------------------------------------------------------
// 词法：一遍扫描，产出子命令段、内嵌命令、解析问题
// ---------------------------------------------------------------------------

function lastCh(s) { return s.length === 0 ? '' : s[s.length - 1] }
function isWsCh(c) { return c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\u00a0' || c === '\u3000' }

/** 从 s[i]（是 `(`）起读到配对的 `)`，跳过引号内的括号。返回 {inner, end} 或 null。 */
function readParen(s, i) {
  let depth = 0
  let q = null
  for (let k = i; k < s.length; k++) {
    const c = s[k]
    if (q) {
      if (c === '\\' && q === '"') { k++; continue }
      if (c === q) q = null
      continue
    }
    if (c === '"' || c === "'") { q = c; continue }
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) return { inner: s.slice(i + 1, k), end: k + 1 } }
  }
  return null
}

/** 从 s[i]（是反引号）起读到下一个未转义的反引号。返回 {inner, end} 或 null。 */
function readBacktick(s, i) {
  for (let k = i + 1; k < s.length; k++) {
    if (s[k] === '\\') { k++; continue }
    if (s[k] === '`') return { inner: s.slice(i + 1, k), end: k + 1 }
  }
  return null
}

/**
 * 词法扫描。返回 {segs, subs, problem}：
 *   segs    —— 按未被引号包住的 `; && || | & 换行` 与词首的 `{ }` 切出的子命令（保留引号，供后续切词与重定向识别）；
 *   subs    —— 抽取出的内嵌命令串：`$(…)`、反引号对、`<(…)`／`>(…)`（包括双引号内的），由调用方递归判；
 *   problem —— 解析不了的形状（引号不配对、here 文档无终止符、块注释不闭合、here 文档正文含命令替换），非空则整条 ask。
 * 同时处理：引号内的转义引号（`\"`、`` `" ``）、行注释（词首 `#`）、`<# … #>` 块注释、here 文档（`<<EOF`）与 PowerShell here-string（`@' … '@`）——
 * 它们的**正文是数据，不是命令**，剥掉后再判；续行（行尾 `\` 或反引号）。线性，无回溯。
 */
export function lex(cmd) {
  const segs = []
  const subs = []          // [{ text, at }]：at 是它出现时已切出的段数——它属于**当前正在读**的那一段（下标 at）
  let cur = ''
  let q = null
  let problem = null
  const n = cmd.length
  let i = 0
  const pend = []
  const push = () => { if (cur.trim() !== '') segs.push(cur); cur = '' }

  while (i < n && !problem) {
    const c = cmd[i]

    if (q === "'") {
      cur += c; i++
      if (c === "'") q = null
      continue
    }
    if (q === '"') {
      if (c === '\\' && i + 1 < n) { cur += c + cmd[i + 1]; i += 2; continue }              // \" \\ （bash）
      if (c === '`' && cmd[i + 1] === '"') { cur += c + '"'; i += 2; continue }              // `" （PowerShell）
      if (c === '$' && cmd[i + 1] === '(') {
        const r = readParen(cmd, i + 1)
        if (!r) { problem = '命令替换 $( 没有配对的 )'; break }
        subs.push({ text: r.inner, at: segs.length }); cur += ' '; i = r.end; continue
      }
      if (c === '`') {
        const r = readBacktick(cmd, i)
        if (r) { subs.push({ text: r.inner, at: segs.length }); cur += ' '; i = r.end; continue }
      }
      cur += c; i++
      if (c === '"') q = null
      continue
    }

    // ——— 未引号状态 ———
    // 续行
    if ((c === '\\' || c === '`') && (cmd[i + 1] === '\n' || (cmd[i + 1] === '\r' && cmd[i + 2] === '\n'))) {
      cur += ' '; i += cmd[i + 1] === '\r' ? 3 : 2; continue
    }
    // 转义的引号：不开启引号
    if ((c === '\\' || c === '`') && (cmd[i + 1] === '"' || cmd[i + 1] === "'")) { cur += c + cmd[i + 1]; i += 2; continue }
    // 反引号命令替换（bash）／转义（PowerShell）：成对则抽取内部，不成对当普通字符
    if (c === '`') {
      const r = readBacktick(cmd, i)
      if (r) { subs.push({ text: r.inner, at: segs.length }); cur += ' '; i = r.end; continue }
      cur += c; i++; continue
    }
    // 命令替换 $( … )、进程替换 <( … ) >( … )
    if ((c === '$' || c === '<' || c === '>') && cmd[i + 1] === '(' && !(c === '>' && lastCh(cur) === '>')) {
      const r = readParen(cmd, i + 1)
      if (!r) { problem = '命令替换或进程替换的 ( 没有配对的 )'; break }
      subs.push({ text: r.inner, at: segs.length }); cur += ' '; i = r.end; continue
    }
    // 块注释 <# … #>（PowerShell）
    if (c === '<' && cmd[i + 1] === '#') {
      const e = cmd.indexOf('#>', i + 2)
      if (e < 0) { problem = '块注释 <# 没有闭合的 #>'; break }
      cur += ' '; i = e + 2; continue
    }
    // here 文档 <<WORD（不含 <<< here-string）
    if (c === '<' && cmd[i + 1] === '<' && cmd[i + 2] !== '<') {
      let j = i + 2
      let strip = false
      if (cmd[j] === '-') { strip = true; j++ }
      while (cmd[j] === ' ' || cmd[j] === '\t') j++
      let w = ''
      let quoted = false
      if (cmd[j] === "'" || cmd[j] === '"') {
        const e = cmd.indexOf(cmd[j], j + 1)
        if (e < 0) { problem = 'here 文档终止符的引号没有闭合'; break }
        w = cmd.slice(j + 1, e); quoted = true; j = e + 1
      } else {
        let k = j
        while (k < n && /[A-Za-z0-9_.\-]/.test(cmd[k])) k++
        w = cmd.slice(j, k); j = k
      }
      if (w !== '') { pend.push({ w, strip, quoted }); cur += ' '; i = j; continue }
    }
    // PowerShell here-string：@' 或 @" 之后只剩空白到行尾
    if (c === '@' && (cmd[i + 1] === "'" || cmd[i + 1] === '"')) {
      let j = i + 2
      while (cmd[j] === ' ' || cmd[j] === '\t' || cmd[j] === '\r') j++
      if (cmd[j] === '\n') {
        const close = cmd[i + 1] + '@'
        let k = j + 1
        let found = false
        while (k <= n) {
          let e = cmd.indexOf('\n', k)
          if (e < 0) e = n
          const line = cmd.slice(k, e)
          if (line.startsWith(close)) { found = true; i = k + close.length; break }
          if (close[0] === '"' && (line.includes('$(') || line.includes('`'))) { problem = 'here-string 正文含命令替换，守卫不解析'; break }
          if (e >= n) break
          k = e + 1
        }
        if (problem) break
        if (!found) { problem = 'here-string 没有找到终止符'; break }
        cur += ' '
        continue
      }
    }
    // 行注释：词首的 #（`a#b`、`url#frag`、`$#` 不是）
    if (c === '#' && (cur === '' || isWsCh(lastCh(cur)))) {
      while (i < n && cmd[i] !== '\n') i++
      continue
    }
    // 开引号
    if (c === '"' || c === "'") { q = c; cur += c; i++; continue }
    // 换行：先处理待读的 here 文档正文
    if (c === '\n') {
      push(); i++
      if (pend.length > 0) {
        for (const h of pend) {
          let found = false
          while (i <= n) {
            let e = cmd.indexOf('\n', i)
            if (e < 0) e = n
            let line = cmd.slice(i, e).replace(/\r$/, '')
            if (h.strip) line = line.replace(/^\t+/, '')
            i = e + 1
            if (line === h.w) { found = true; break }
            if (!h.quoted && (line.includes('$(') || line.includes('`'))) { problem = problem || 'here 文档正文含命令替换，守卫不解析' }
            if (e >= n) break
          }
          if (!found) problem = problem || 'here 文档没有找到终止符'
        }
        pend.length = 0
      }
      continue
    }
    // `>|` 与 `>&`、`2>&1`：其中的 | & 不是命令分隔符
    if ((c === '|' || c === '&') && lastCh(cur) === '>') { cur += c; i++; continue }
    // 命令分隔
    if (c === ';' || c === '|' || c === '&') {
      if ((c === '|' || c === '&') && (cmd[i + 1] === c || (c === '|' && cmd[i + 1] === '&'))) i++   // && || |&
      push(); i++; continue
    }
    // 词首的 { 与 }：脚本块、控制流的花括号当分隔符；词中的 { }（${x}、.std/{a,b}、xargs 的 {}）是普通字符
    if (c === '{') {
      const p = lastCh(cur)
      if ((p === '' || isWsCh(p) || p === ')' || p === '%' || p === '?') && cmd[i + 1] !== '}') { push(); i++; continue }
    }
    if (c === '}') {
      const p = lastCh(cur)
      const nx = cmd[i + 1]
      if ((p === '' || isWsCh(p)) && (nx === undefined || isWsCh(nx) || nx === ';' || nx === ')' || nx === '|' || nx === '&')) { push(); i++; continue }
    }
    cur += c; i++
  }
  if (!problem && q) problem = '引号没有配对'
  if (!problem && pend.length > 0) problem = 'here 文档没有找到终止符'
  if (!problem) push()
  return { segs, subs, problem }
}

/** 兼容：只要子命令段。 */
export function splitCommands(cmd) { return lex(cmd).segs }

/** 一段子命令切词：空白分隔，引号包住的算一个词（去引号；双引号内的转义引号保留成引号字符）。 */
export function tokenize(seg) {
  const toks = []
  let cur = ''
  let q = null
  let has = false
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]
    if (q === '"') {
      if ((c === '\\' || c === '`') && (seg[i + 1] === '"' || (c === '\\' && seg[i + 1] === '\\'))) { cur += seg[i + 1]; i++; continue }
      if (c === '"') { q = null; continue }
      cur += c; continue
    }
    if (q === "'") { if (c === "'") q = null; else cur += c; continue }
    if ((c === '\\' || c === '`') && (seg[i + 1] === '"' || seg[i + 1] === "'")) { cur += seg[i + 1]; i++; has = true; continue }
    if (c === '"' || c === "'") { q = c; has = true; continue }
    if (isWsCh(c)) { if (has || cur) toks.push(cur); cur = ''; has = false; continue }
    cur += c; has = true
  }
  if (has || cur) toks.push(cur)
  return toks
}

/**
 * 取一段命令里**引号外**的重定向目标词。识别 `>`、`>>`、`>|`、`>&`，前缀可以是数字或 `&`，`>` 前可以紧贴别的词（`echo x>f`），
 * 也可以在命令之前（`>f echo x`）。目标是 `>` 之后的下一个词（可紧贴，也可隔空白）。线性扫描。
 */
export function redirectTargets(seg) {
  const out = []
  let q = null
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]
    if (q === '"') {
      if (c === '\\' || (c === '`' && seg[i + 1] === '"')) { i++; continue }
      if (c === '"') q = null
      continue
    }
    if (q === "'") { if (c === "'") q = null; continue }
    if ((c === '\\' || c === '`') && (seg[i + 1] === '"' || seg[i + 1] === "'")) { i++; continue }
    if (c === '"' || c === "'") { q = c; continue }
    if (c !== '>') continue
    let j = i + 1
    if (seg[j] === '>') j++                                           // >>
    if (seg[j] === '|' || seg[j] === '&') j++                         // >| >&（目标紧贴时 >&.std/a）
    while (j < seg.length && (seg[j] === ' ' || seg[j] === '\t')) j++
    let k = j
    let qq = null
    let word = ''
    while (k < seg.length) {
      const d = seg[k]
      if (qq) { if (d === qq) { qq = null } else word += d; k++; continue }
      if (d === '"' || d === "'") { qq = d; k++; continue }
      if (isWsCh(d) || d === '>' || d === '<') break
      word += d; k++
    }
    if (word) out.push(word)
    i = Math.max(i, k - 1)
  }
  return out
}

// ---------------------------------------------------------------------------
// 词表
// ---------------------------------------------------------------------------

/** PowerShell 与 POSIX 里「会写文件」的命令名（不分大小写）。 */
const WRITERS = new Set([
  // PowerShell 全名与别名
  'set-content', 'sc', 'add-content', 'ac', 'out-file', 'tee-object', 'new-item', 'ni', 'remove-item', 'ri', 'rm', 'rmdir', 'rd', 'del', 'erase',
  'move-item', 'mi', 'move', 'mv', 'copy-item', 'cpi', 'copy', 'cp', 'rename-item', 'rni', 'ren', 'rename', 'clear-content', 'clc',
  'expand-archive', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm', 'curl', 'wget', 'mkdir', 'md',
  // cmd 与 POSIX
  'xcopy', 'robocopy', 'tee', 'dd', 'install', 'ln', 'rsync', 'truncate', 'touch', 'sed', 'tar', 'unzip', 'unlink', 'shred',
])

/** 删除/移走/清空：用于状态入口与失败清单的保护，以及通配匹配。 */
const DELETERS = new Set(['remove-item', 'ri', 'rm', 'rmdir', 'rd', 'del', 'erase', 'unlink', 'shred', 'truncate', 'move-item', 'mi', 'move', 'mv', 'ren', 'rename-item', 'rni', 'rename', 'clear-content', 'clc', 'set-content', 'sc', 'out-file'])

/** 前缀包装：执行其后参数的命令。 */
const PREFIX_WRAPPERS = new Set(['env', 'sudo', 'doas', 'command', 'time', 'nohup', 'nice', 'stdbuf', 'timeout', 'exec', 'builtin', 'xargs', 'start', 'call', 'start-process', 'busybox'])
/** 各前缀包装里**带值**的选项（值是下一个词，不是命令）。 */
const PREFIX_VALUE_OPTS = {
  sudo: new Set(['-u', '-g', '-h', '-p', '-c', '-d', '-r', '-t', '-C', '-D', '-R', '-T', '-U', '--user', '--group', '--host', '--prompt', '--chdir', '--role', '--type']),
  doas: new Set(['-u', '-C']),
  env: new Set(['-u', '-C', '--unset', '--chdir']),
  timeout: new Set(['-s', '-k', '--signal', '--kill-after']),
  xargs: new Set(['-I', '-n', '-L', '-P', '-s', '-E', '-d', '-a', '--arg-file', '--max-args', '--max-lines', '--max-procs', '--delimiter']),
  nice: new Set(['-n', '--adjustment']),
  stdbuf: new Set(['-i', '-o', '-e']),
}

/** 控制流关键字：出现在段首时剥掉再判（`then rm …`、`do rm …`、`! rm …`）。 */
const CONTROL_WORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', '!', 'in', 'esac', 'begin', 'end'])

/** 剥掉控制流关键字、前缀包装与 `VAR=val` 赋值前缀；返回剥后的词表。 */
export function stripPrefix(toks) {
  let i = 0
  while (i < toks.length) {
    const raw = toks[i]
    const w = raw.toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '')
    if (CONTROL_WORDS.has(w)) { i++; continue }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(raw)) { i++; continue }       // VAR=val
    if (PREFIX_WRAPPERS.has(w)) {
      i++
      const valueOpts = PREFIX_VALUE_OPTS[w]
      let sawDuration = false
      while (i < toks.length) {
        const t = toks[i]
        if (t === '--') { i++; break }
        if (t.startsWith('-') && t.length > 1) {
          if (valueOpts && valueOpts.has(t) && !t.includes('=')) i += 2
          else i += 1
          continue
        }
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { i++; continue }
        if (w === 'timeout' && !sawDuration && /^\d+(\.\d+)?[smhd]?$/.test(t)) { sawDuration = true; i++; continue }
        if (w === 'nice' && /^-?\d+$/.test(t)) { i++; continue }
        break
      }
      continue
    }
    break
  }
  return toks.slice(i)
}

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell', 'cmd'])

/**
 * 把整条命令当字符串参数交给别的 shell 的包装：`bash -c "…"`（含 `-lc`、`-ec`、`-cx` 等选项簇）、`cmd /c "…"`（含 `/k`）、
 * `powershell -c`／`-Command`（含参数缩写 `-com` `-comm`…）、`iex "…"`、`Invoke-Expression`、`eval`。取出那段字符串，作为内嵌命令再判一次。
 * 没有这种包装返回 null。
 */
export function innerCommand(toks) {
  if (toks.length < 2) return null
  const w = toks[0].toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '')
  if (['iex', 'invoke-expression', 'eval'].includes(w)) return toks.slice(1).join(' ')
  if (['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish'].includes(w)) {
    const k = toks.findIndex((x, i) => i > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(x))
    return k > 0 && toks[k + 1] !== undefined ? toks[k + 1] : null
  }
  if (w === 'cmd') {
    const k = toks.findIndex((x, i) => i > 0 && /^\/[ckCK]$/.test(x))
    return k > 0 ? toks.slice(k + 1).join(' ') : null
  }
  if (w === 'powershell' || w === 'pwsh') {
    const k = toks.findIndex((x, i) => i > 0 && /^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(x))
    return k > 0 ? toks.slice(k + 1).join(' ') : null
  }
  return null
}

/**
 * 解释器从标准输入读命令、或收到守卫看不见的编码命令：`echo "git tag x" | bash`、`bash <<< '…'`、`pwsh -EncodedCommand …`。
 * 脚本文件（`bash build.sh`、`pwsh -File x.ps1`）不在此列——那是盲区，每个脚本都问会让人疲劳。返回理由或 null。
 */
function opaqueShell(toks) {
  if (toks.length === 0) return null
  const w = toks[0].toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '')
  if (!SHELLS.has(w)) return null
  const args = toks.slice(1)
  if ((w === 'pwsh' || w === 'powershell') && args.some((a) => /^-e(c|nc|ncodedcommand)?$/i.test(a))) return '编码后的命令（-EncodedCommand），守卫看不见内容，先问人'
  if (args.length > 0 && args.every((a) => /^(--?(version|v|help|h|\?))$/i.test(a))) return null
  const hasCommand = innerCommand(toks) !== null
  if (hasCommand) return null
  const nonOpt = args.some((a) => !(a.startsWith('-') || (w === 'cmd' && a.startsWith('/'))))
  if (nonOpt) return null                         // 有脚本文件或别的位置参数：盲区，不问
  return `${w} 没有给命令串或脚本文件，会从标准输入读命令，守卫看不见内容，先问人`
}

// ---------------------------------------------------------------------------
// 受控 git 动作（ask）
// ---------------------------------------------------------------------------

/** git 改工作区或索引的子命令。 */
const GIT_WORKTREE_WRITERS = new Set(['checkout', 'restore', 'apply', 'stash', 'reset', 'clean', 'rm', 'mv', 'am', 'cherry-pick', 'merge', 'rebase', 'switch', 'revert', 'pull'])
const GIT_EXE = /^(.*[\\/])?git(\.exe|\.cmd|\.bat)?$/i

/** 展平 PowerShell 的 `-ArgumentList a,b,c`：把逗号列表拆成多个词，并去掉参数名本身。 */
function flattenArgList(toks) {
  const out = []
  for (let i = 0; i < toks.length; i++) {
    if (/^-(argumentlist|args)$/i.test(toks[i]) && i + 1 < toks.length) {
      for (const part of toks[i + 1].split(',')) if (part !== '') out.push(part)
      i++
      continue
    }
    out.push(toks[i])
  }
  return out
}

/** 取 git 的真正子命令（跳过 -C dir、-c k=v、--git-dir 等带值全局选项）；返回 {name, raw, alias}。 */
export function gitSubcommand(rawToks) {
  const toks = flattenArgList(rawToks)
  const gi = toks.findIndex((t) => GIT_EXE.test(t))
  if (gi < 0) return { name: '', raw: '', rest: [], alias: false }
  let i = gi + 1
  let alias = false
  while (i < toks.length && toks[i].startsWith('-')) {
    if (toks[i] === '-c' && /^alias\./i.test(toks[i + 1] || '')) alias = true
    if (/^-(C|c)$/.test(toks[i]) || /^--(git-dir|work-tree|namespace|exec-path|config-env|super-prefix)$/.test(toks[i])) i += 2
    else i += 1
  }
  return { name: (toks[i] || '').toLowerCase(), raw: toks[i] || '', rest: toks.slice(i + 1), alias }
}

/** 受控 git 动作。返回理由字符串或 null。 */
export function gitAsk(rawToks) {
  const toks = rawToks.map((x) => x.replace(/^[$@]?\(+/, '').replace(/\)+$/, '')).filter((x) => x !== '')
  const { name: sub, rest, alias } = gitSubcommand(toks)
  if (alias) return '通过 -c alias.* 注入 git 别名，真正执行的命令看不见，先问人'
  const has = (re) => rest.some((t) => re.test(t))
  switch (sub) {
    case 'reset':
      if (has(/^--h(a(r(d)?)?)?$/i)) return 'git reset --hard（含缩写）会丢弃未提交改动'
      if (has(/^--(keep|merge)$/i)) return 'git reset --keep／--merge 会改写工作区'
      return null
    case 'push': {
      if (has(/^(--force|--force-with-lease(=.*)?|--force-if-includes)$/i) || has(/^-[a-zA-Z]*f[a-zA-Z]*$/)) return '强制推送会改写远端历史'
      if (has(/^\+/) || has(/^:[^\s]/)) return '强制推送（+refspec）或删除远端引用（:refspec）'
      if (has(/^(--delete|--mirror|--prune)$/i) || has(/^-[a-zA-Z]*d[a-zA-Z]*$/)) return '推送删除或镜像远端引用'
      if (has(/^(--tags|--follow-tags)$/i) || has(/(^|:)refs\/tags\//i) || has(/^tag$/i) || has(/^v\d+([.\-][\w.]*)*$/) || has(/^\d+(\.\d+)+([.\-][\w.]*)*$/) || has(/^\d{4}-\d{2}-\d{2}(\.\d+)?$/)) return '推送标签属发布动作（01 §5.5 发布；含按名字推的版本号式 tag）'
      if (has(/ai-dev-std/i)) return '推公开仓只允许 release 线性发布（D-108）'
      if (has(/(^|:|\/)release$/i) || has(/^release:/i) || has(/^[^:]+:(refs\/heads\/)?release$/i)) return '推 release 分支属发布动作（D-108）；别名远端也一并问'
      if (has(/^(https?:\/\/|git@|ssh:\/\/)/i) || has(/\.git$/i)) return '推到以地址写出的远端（可能是公开仓的别名）'
      return null
    }
    case 'tag': return '打标签属发布动作（只列标签也会问：命令串分不出读写，列标签改用 git show-ref --tags）'
    case 'branch':
      if (has(/^(--delete|--force|--move)$/i) || has(/^-[a-zA-Z]*[dDfmM][a-zA-Z]*$/)) return '删除、强制移动或改名分支（含 -fD 等组合短选项）'
      return null
    case 'update-ref': return has(/^(-d|--delete)$/) ? 'update-ref 删除引用' : null
    case 'filter-branch': return 'filter-branch 改写历史'
    case 'worktree': return has(/^remove$/i) ? '删除工作树' : null
    case 'rm': return 'git rm 删除已跟踪文件'
    case 'clean': return 'git clean 删除未跟踪文件'
    case 'commit':
      if (has(/^-[a-zA-Z]*n[a-zA-Z]*$/)) return 'git commit -n 等同 --no-verify'
      return null
    case 'config':
      return has(/^core\.hookspath$/i) ? '改 core.hooksPath 会关掉提交闸门' : null
    default: return null
  }
}

/** 与具体子命令无关的受控标志：出现在任何一段的任何词里都 ask。 */
const ANY_TOKEN_ASK = [
  [/^--no-ve/i, '跳过提交钩子（提交闸门；含缩写 --no-ve*），只管这一次由 Alan 批准'],
  [/hookspath/i, '改 core.hooksPath 会关掉提交闸门'],
]

// ---------------------------------------------------------------------------
// 一段子命令的写判断
// ---------------------------------------------------------------------------

/** 一段子命令里是否有「写动词」：写重定向（目标不是描述符/空设备），或首词是写命令/git 改工作区子命令。 */
function segHasWrite(seg, toks, countRedirect = true) {
  if (countRedirect && redirectTargets(seg).some((tg) => !isNullTarget(tg))) return true
  if (toks.length === 0) return false
  const verb = toks[0].toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '')
  // sed 无 -i、tar 只列、unzip 只列：不写
  if (verb === 'sed') return toks.some((x) => /^-[a-zA-Z]*i/.test(x) || x === '--in-place' || /^--in-place=/.test(x))
  if (verb === 'tar') return !toks.some((x) => /^-[a-zA-Z]*t/.test(x) || x === '--list') || toks.some((x) => /^-[a-zA-Z]*[xc]/.test(x))
  if (verb === 'unzip') return !toks.some((x) => /^-[lpt]$/.test(x))
  if (verb === 'find') return toks.some((x) => x === '-delete' || x === '-exec' || x === '-execdir' || x === '-ok')
  if (WRITERS.has(verb)) return true
  if (verb === 'git' || GIT_EXE.test(toks[0])) {
    const sub = gitSubcommand(toks)
    // 只改索引的变体（--cached、--staged）不动工作区：不算写
    if (sub.rest.some((x) => /^--(cached|staged)$/.test(x)) && ['rm', 'restore', 'reset'].includes(sub.name)) return false
    if (sub.name === 'reset' && !sub.rest.some((x) => /^--(hard|keep|merge)/i.test(x))) return false   // 默认 --mixed：只改索引
    if (sub.name === 'apply' && sub.rest.some((x) => /^--(check|stat|numstat|summary)$/.test(x))) return false   // 只检查不应用
    return GIT_WORKTREE_WRITERS.has(sub.name)
  }
  return false
}

/**
 * 词里的路径候选：去掉 `-Path:`／`-o=`／`of=`／`--output=` 这类前缀取值；逗号列表拆开；去括号与引号；
 * 以 `-` 开头的选项、URL、含变量（`$`）的词不当路径。
 */
function candidates(tok) {
  if (typeof tok !== 'string' || tok === '') return []
  let t = tok
  const m = /^(?:-{1,2}[A-Za-z][\w-]*[=:]|(?:of|if)=)(.*)$/.exec(t)
  const glued = /^-[A-Za-z](.+)$/.exec(t)                      // 短选项紧贴值：-o.std/a、-C.std
  if (m) t = m[1]
  else if (glued && /[\\/.]/.test(glued[1])) t = glued[1]
  else if (t.startsWith('-')) return []
  if (t.includes('://')) return []
  return t.split(',').map((s) => {
    s = s.replace(/^[(\[{"']+|[)\]}"']+$/g, '')
    const dollar = s.indexOf('$')
    if (dollar >= 0) s = s.slice(0, dollar)                    // `.std/$f` 取静态前缀 `.std/`；`$PWD/.std` 前缀为空，下面被滤掉
    return s
  }).filter((s) => s !== '')
}

/** 把 glob（`*` `?`）转成不分大小写的整串正则；无通配返回 null。 */
function globRegex(s) {
  if (!/[*?]/.test(s) || /[\\/]/.test(s)) return null
  let re = ''
  for (const ch of s) re += ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp('^' + re + '$', 'i')
}
const GLOB_TARGETS = [
  ['.std', 'std'], ['AGENTS.md', 'protected'], ['CONTEXT_MANIFEST.md', 'protected'], ['.githooks', 'protected'],
  ['PROJECT_STATUS.md', 'state'], ['失败Case清单.md', 'state'],
]

/** 对 .std 的命中：'sure'（按虚拟 cwd 解析命中）、'maybe'（只有按项目根解析才命中——cd 可能没生效）、null。 */
function stdHit(c, root, cwd, r) {
  if (inEmbeddedStd(c, root, cwd)) return 'sure'
  if (cwd !== r && inEmbeddedStd(c, root, r)) return 'maybe'
  return null
}

// ---------------------------------------------------------------------------
// 判定
// ---------------------------------------------------------------------------

/** 重定向目标是文件描述符（`&1`、`2`）或空设备（`$null`、`nul`、`/dev/null`）：不写文件。 */
function isNullTarget(tg) { return /^(&?\d+|\$null|nul|\/dev\/null)$/i.test(tg) }

/** 更严的判定：deny > ask > allow。 */
function stricter(a, b) {
  const rank = { allow: 0, ask: 1, deny: 2 }
  return rank[b.kind] > rank[a.kind] ? b : a
}

const CD_WORDS = new Set(['cd', 'chdir', 'set-location', 'sl', 'pushd', 'push-location'])
const POP_WORDS = new Set(['popd', 'pop-location'])

/**
 * 判定一次工具调用。
 * @param {{name:string, arguments:any}} exec
 * @param {{root?:string}} [opts]  root 缺省取进程 cwd。适配层会先传会话工作目录；会话不是在项目根开的就可能判偏，
 *                                   要稳妥就在 profile 的插件配置里写 root（见 README）。
 */
export function decide(exec, opts) {
  // 任何输入都不抛：取字段本身可能抛（getter、Proxy），抛了就按未定 ask
  let name, args
  try {
    name = exec && exec.name
    args = (exec && exec.arguments) || {}
    if (typeof name !== 'string') name = undefined
  } catch (error) {
    return { kind: 'ask', reason: '工具调用的 name／arguments 读不出来，按未定处理，先问人' }
  }
  const root = opts && typeof opts === 'object' && typeof opts.root === 'string' ? opts.root : undefined

  if (Object.prototype.hasOwnProperty.call(WRITE_TOOLS, name)) {
    const p = args[WRITE_TOOLS[name]]
    if (typeof p !== 'string') return { kind: 'ask', reason: `${name} 的路径参数缺失或类型不对，按未定处理，先问人` }
    // 内嵌标准目录只读（01 §8）：机械判据，直接拒绝。
    if (inEmbeddedStd(p, root)) {
      return { kind: 'deny', reason: '内嵌标准目录 .std/ 只读（01 §8）：要改标准就向上游报告，修复发布后再按新 tag 取回' }
    }
    const why = protectedPath(p, root)
    if (why) return { kind: 'ask', reason: why }
    return { kind: 'allow' }
  }

  if (SHELL_TOOLS.has(name)) {
    const cmd = args.command
    if (typeof cmd !== 'string') return { kind: 'ask', reason: `${name} 的 command 缺失或类型不对，按未定处理，先问人` }
    if (cmd.length > MAX_CMD) {
      return { kind: 'ask', reason: `命令超过 ${MAX_CMD} 字符，守卫不分析，按未定处理，先问人` }
    }
    return judgeShell(cmd, root, 0, baseRoot(root))
  }

  return { kind: 'allow' }
}

/**
 * 判一条 shell 命令串：词法扫描 → 内嵌命令递归 → 逐段判。解析不了的形状（lex 的 problem）整条 ask。
 * cwd0 是虚拟工作目录（绝对路径），`cd` 会更新它，相对路径按它解析。
 * 返回 {kind, reason}。
 */
function judgeShell(cmd, root, depth, cwd0) {
  if (depth > MAX_DEPTH) return { kind: 'ask', reason: '命令嵌套了太多层（shell 包装、命令替换），守卫不再往里看，先问人' }
  const lexed = lex(cmd)
  if (lexed.problem) return { kind: 'ask', reason: `命令里有守卫解析不了的形状（${lexed.problem}），先问人` }
  const r = baseRoot(root)
  let cwd = cwd0
  let ask = null
  let inner = { kind: 'allow' }
  const subsBySeg = new Map()
  for (const s of lexed.subs) { if (!subsBySeg.has(s.at)) subsBySeg.set(s.at, []); subsBySeg.get(s.at).push(s.text) }
  // 命令替换的求值点在它所在的子命令：用到那一点的虚拟 cwd（`cd tools; echo $(rm dsh-std/…)`）
  const judgeSubs = (idx) => { for (const text of subsBySeg.get(idx) || []) inner = stricter(inner, judgeShell(text, root, depth + 1, cwd)) }

  for (let segIdx = 0; segIdx < lexed.segs.length; segIdx++) {
    const rawSeg = lexed.segs[segIdx]
    judgeSubs(segIdx)
    const seg = rawSeg.replace(/[()]/g, ' ')                  // 括号当空白：`(rm -rf .std)`、`cp x (AGENTS.md)`
    const rawToks = tokenize(seg)
    const toks = stripPrefix(rawToks)
    if (toks.length === 0) {
      // 只有重定向的段（`> .std/a`、`>.std/a echo` 拆出来的）也要判
      for (const tg of redirectTargets(seg)) {
        if (isNullTarget(tg)) continue
        const hit = stdHit(tg, root, cwd, r)
        if (hit === 'sure') return { kind: 'deny', reason: '命令把输出重定向到内嵌标准目录 .std/（01 §8 只读）。请把目标改到别处' }
        if (hit === 'maybe' && !ask) ask = '重定向目标按项目根解析落在 .std/，而 cd 可能没有生效，先问人（01 §8 只读）'
        const why = !ask && (protectedPath(tg, root, cwd) || (cwd !== r ? protectedPath(tg, root, r) : null))
        if (why) ask = why
      }
      continue
    }

    // 内嵌命令：bash -c "…"、iex "…"、eval '…'
    const innerCmd = innerCommand(toks)
    if (innerCmd !== null) inner = stricter(inner, judgeShell(innerCmd, root, depth + 1, cwd))
    const opaque = opaqueShell(toks)
    if (opaque && !ask) ask = opaque

    // cd：更新虚拟 cwd；目标判不了（变量、~、-）时复位到项目根
    const v0 = toks[0].toLowerCase()
    if (CD_WORDS.has(v0) || POP_WORDS.has(v0)) {
      const target = toks.slice(1).find((x) => !x.startsWith('-') && !/^\/[dD]$/.test(x))
      if (POP_WORDS.has(v0) || target === undefined || target === '-' || target.includes('$') || target.startsWith('~')) cwd = r
      else cwd = path.resolve(cwd, target)
      continue
    }

    // 1) 重定向目标：按虚拟 cwd 解析后落在 .std —— deny（命令串层面唯一的 deny 来源）；仅按项目根才落在 .std —— ask
    for (const tg of redirectTargets(seg)) {
      if (isNullTarget(tg)) continue
      const hit = stdHit(tg, root, cwd, r)
      if (hit === 'sure') return { kind: 'deny', reason: '命令把输出重定向到内嵌标准目录 .std/（01 §8 只读）。请把目标改到别处' }
      if (hit === 'maybe' && !ask) ask = '重定向目标按项目根解析落在 .std/，而 cd 可能没有生效，先问人（01 §8 只读）'
      const why = !ask && (protectedPath(tg, root, cwd) || (cwd !== r ? protectedPath(tg, root, r) : null))
      if (why) ask = why
    }

    // 「写类命令且参数里有 .std／受保护路径」只看命令本身的写动词；重定向到别处不算（重定向目标由上面单独判）
    const writes = segHasWrite(seg, toks, false)
    const verb = toks[0].toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '')
    if (writes) {
      // 2) 写类命令：虚拟 cwd 在 .std 或受保护目录里；参数里有 .std／受保护路径
      if (!ask && inEmbeddedStd('.', root, cwd)) ask = '命令在内嵌标准目录 .std/ 里执行写类命令，先问人（01 §8 只读）'
      if (!ask) { const why = protectedPath('.', root, cwd); if (why && cwd !== r) ask = why }
      if (!ask) {
        for (const t of toks.slice(1)) {
          for (const c of candidates(t)) {
            if (stdHit(c, root, cwd, r)) { ask = '命令里同时有写动词与 .std，写目标判不清，先问人（01 §8 只读）'; break }
            const why = protectedPath(c, root, cwd) || (cwd !== r ? protectedPath(c, root, r) : null)
            if (why) { ask = why; break }
            if (DELETERS.has(verb)) {
              const re = globRegex(c)
              if (re) {
                const hit = GLOB_TARGETS.find(([nm]) => re.test(nm))
                if (hit) { ask = hit[1] === 'std' ? '通配符可能匹配 .std，写类命令先问人（01 §8 只读）' : hit[1] === 'state' ? '通配符可能匹配状态入口／失败清单，删除类命令先问人（01 §5.5）' : '通配符可能匹配受保护文件，写类命令先问人'; break }
              }
            }
          }
          if (ask) break
        }
      }
    }
    // 3) 受控 git 动作与任何词里的受控标志
    if (!ask) ask = gitAsk(toks)
    if (!ask) for (const tk of toks) { const hit = ANY_TOKEN_ASK.find(([re]) => re.test(tk)); if (hit) { ask = hit[1]; break } }
    // 4) 删除/移走/清空状态入口与失败清单
    if (!ask && (DELETERS.has(verb) || verb === 'find') && toks.slice(1).some((t) => candidates(t).some((c) => isStateFile(c, root, cwd)))) {
      if (verb !== 'find' || toks.some((x) => x === '-delete')) ask = '删除、移走或清空状态入口 / 失败清单（01 §5.5）'
    }
    if (!ask && redirectTargets(seg).some((tg) => isStateFile(tg, root, cwd))) ask = '重定向会清空或覆盖状态入口 / 失败清单（01 §5.5）'
    // 复制/下载覆盖状态文件等于清空重写：目标（最后一个非选项词）是状态入口/失败清单也问
    if (!ask && ['cp', 'copy', 'copy-item', 'cpi', 'curl', 'wget', 'iwr', 'invoke-webrequest', 'irm', 'invoke-restmethod', 'rsync', 'install', 'dd', 'tee', 'tee-object'].includes(verb)) {
      const cands = toks.slice(1).flatMap((x) => candidates(x))
      if (cands.some((c) => isStateFile(c, root, cwd))) ask = '复制或下载可能覆盖状态入口 / 失败清单（01 §5.5）'
    }
  }
  judgeSubs(lexed.segs.length)
  const mine = ask ? { kind: 'ask', reason: ask } : { kind: 'allow' }
  return stricter(mine, inner)
}

/**
 * 提交信息首行是否合 type(scope)!?: subject（01 §5.1）；放行 git 自动生成的固定形态。
 * **目前没有任何调用方**：插件没有接提交信息检查（那是 `.githooks/commit-msg` 的职责）。保留它是因为单测覆盖了
 * 这条判据，将来要在 pre-execute 里接再用；在此之前不要把它当作已生效的检查。
 */
export function commitMessageProblem(first) {
  if (typeof first !== 'string' || first.trim() === '') return '提交信息为空'
  const ok = /^Merge ((remote-tracking )?branch(es)?|tags?|commits?) '|^Merge pull request #[0-9]+ from |^(Revert|Reapply) ".*"$|^(fixup|squash|amend)! |^[a-z]+(\([^()]+\))?!?: [^ ]/.test(first)
  return ok ? null : `提交信息首行不合 type(scope)!?: subject（01 §5.1）：${first}`
}
