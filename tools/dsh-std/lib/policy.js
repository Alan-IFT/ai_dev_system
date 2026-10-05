// 判定核心：纯函数，不依赖 DSH，可单独测。
//
// 输入是一次工具调用（name + arguments），输出是 {kind:'allow'} | {kind:'ask', reason} | {kind:'deny', reason}。
// 对应 01 §5.5 受控动作：本仓只列确有对象的几类（与原 .claude/settings.json 的 ask 清单同口径，D-135 迁入）。
//
// 设计约束：
//  - 命令串匹配只是尽力而为的预过滤，不是安全边界（见 README「盲区」）。解析不了的形状按未定处理，交给人问。
//  - **deny 只用于两件「不需要猜」的事实**：①写工具（write/edit）的路径参数落在内嵌目录 .std/ 之下；②shell 命令里**重定向的目标词**
//    是 .std 下的路径（`> x`、`>> x`、`word>x`、`2>x`）。其余一切「带 .std 的写类命令」一律 **ask**，由人看一眼批准或拒绝。
//    为什么不更激进：独立审查三轮实测证明，没有真 shell 解析时「哪个词是写目标」的启发式两个方向都出错——既把读取判成 deny
//    （`Copy-Item -Path .std\x -Destination out`、`tar -tf .std/x.tar`、`git log -- .std`……），又漏过真写（`cp a .std 2>&1`）；
//    而 deny 人批准不了，误报代价远高于 ask。所以 deny 只留给无需猜测的两类，其余让人判。
//  - 缺信息按未定处理，不按放行处理：参数缺失或类型不对 => ask。
//  - **线性时间**：命令先切成子命令，每段正则只在短串上跑，不用跨整串的 `[\s\S]*?`（独立审查实测：嵌套的 `[\s\S]*?` 在
//    2 万字符输入上耗时 13 秒，立方级增长）。命令超过 MAX_CMD 字符不进正则，直接 ask。
//  - 路径比较在 Windows 上大小写不敏感，并先剥掉 Win32 会忽略的段尾点与空格、`\\?\` 前缀、NTFS 备用数据流后缀。

import path from 'node:path'

/** 写类工具的名字与它们的路径参数名（DSH 内置 fs 工具）。 */
const WRITE_TOOLS = { write: 'file_path', edit: 'file_path' }
/** 跑命令的工具（Windows 为 pwsh，POSIX 为 bash）。 */
const SHELL_TOOLS = new Set(['pwsh', 'bash'])
const IS_WIN = process.platform === 'win32'
/** 命令长度上限：超过则不进正则，直接 ask（防 ReDoS，也防把超长命令当「已审」放行）。 */
export const MAX_CMD = 8192

// ---------------------------------------------------------------------------
// 路径
// ---------------------------------------------------------------------------

/** 线性地剥掉段尾的点与空格（`/[. ]+$/` 在 `". . . x"` 这类输入上是二次方：每个起点都要扫到末尾才发现不匹配）。 */
function stripTrailingDotsSpaces(seg) {
  let end = seg.length
  while (end > 0 && (seg[end - 1] === '.' || seg[end - 1] === ' ')) end--
  return seg.slice(0, end)
}

/** 把路径规整成可比较的形式：Win32 会忽略每段尾部的点与空格，并认 \\?\ 前缀；NTFS 的 `:流名` 后缀不改变文件本身；Windows 上还要忽略大小写。 */
export function normalizeForCompare(p) {
  let s = String(p)
  if (IS_WIN) {
    s = s.replace(/^\\\\\?\\(UNC\\)?/, (m, unc) => (unc ? '\\\\' : ''))
    // 备用数据流：`AGENTS.md::$DATA`、`AGENTS.md:evil`。盘符冒号（第 2 位）不动，其余的 `:…` 一律砍掉。
    s = s.replace(/^([A-Za-z]:)?([^:]*)(:.*)?$/, (m, drv, body) => (drv || '') + body)
    s = s.split(/[\\/]/).map((seg) => (seg === '.' || seg === '..' ? seg : stripTrailingDotsSpaces(seg))).join(path.sep)
    s = s.toLowerCase()
  }
  return s
}

function baseRoot(root) {
  return path.resolve(root || process.cwd())
}

/** 路径是否落在内嵌标准目录（.std/）之下。 */
export function inEmbeddedStd(p, root) {
  if (typeof p !== 'string' || p === '') return false
  const r = baseRoot(root)
  const abs = normalizeForCompare(path.resolve(r, p))
  const std = normalizeForCompare(path.resolve(r, '.std'))
  const rel = path.relative(std, abs)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** 路径是否是需要先问的受保护文件（改钩子、改入口合同、改守卫自身）；返回理由或 null。 */
export function protectedPath(p, root) {
  if (typeof p !== 'string' || p === '') return null
  const r = baseRoot(root)
  const rel = path.relative(normalizeForCompare(r), normalizeForCompare(path.resolve(r, p))).split(path.sep).join('/')
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  if (rel === 'context_manifest.md' || rel === 'CONTEXT_MANIFEST.md') return '改默认上下文合同（唯一清单）'
  if (rel === 'agents.md' || rel === 'AGENTS.md') return '改入口指令文件'
  if (rel.startsWith('.githooks/') || rel === '.githooks') return '改提交闸门钩子'
  if (rel.startsWith('tools/dsh-std/') || rel === 'tools/dsh-std') return '改守卫插件自身（改守卫的人不应由守卫放行）'
  return null
}

// ---------------------------------------------------------------------------
// 命令：切成子命令 + 逐段分析（每段都是短串，正则线性）
// ---------------------------------------------------------------------------

/**
 * 按未被引号包住的 `; && || | &` 与换行切子命令。引号内的分隔符不切。
 * 手写扫描而不是正则：线性、不回溯。命令 `` ` `` 续行（PowerShell）与 `\` 续行当作空白处理，让拆行的 `git reset\n--hard` 还原成一段。
 */
export function splitCommands(cmd) {
  const out = []
  let cur = ''
  let q = null
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (q) { cur += c; if (c === q) q = null; continue }
    // 反斜杠转义（POSIX）：`\"` 与 `\'` 不开启引号
    if (c === '\\' && (cmd[i + 1] === '"' || cmd[i + 1] === "'")) { cur += c + cmd[i + 1]; i++; continue }
    // 注释：词首的 # 到行尾整段丢弃（注释里的撇号不能开启引号——LLM 生成的命令里很常见）
    if (c === '#' && (cur === '' || /\s$/.test(cur))) { while (i < cmd.length && cmd[i] !== '\n') i++; i--; continue }
    if (c === '"' || c === "'") { q = c; cur += c; continue }
    // 续行：反引号/反斜杠 + 换行 => 空格
    if ((c === '`' || c === '\\') && (cmd[i + 1] === '\n' || (cmd[i + 1] === '\r' && cmd[i + 2] === '\n'))) {
      cur += ' '; i += cmd[i + 1] === '\r' ? 2 : 1; continue
    }
    // `>|` 与 `>&` 是重定向（`echo x >| f`、`echo x >&f`、`2>&1`），其中的 | 与 & 不是命令分隔符
    if ((c === '|' || c === '&') && /[>]$/.test(cur)) { cur += c; continue }
    if (c === '&' && /^\d/.test(cur.slice(-1)) === false && cmd[i - 1] === '>') { cur += c; continue }
    if (c === '\n' || c === ';' || c === '|' || c === '&') {
      if ((c === '|' || c === '&') && cmd[i + 1] === c) i++ // && ||
      if (cur.trim()) out.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim()) out.push(cur)
  return out
}

/** 一段子命令切词：空白分隔，引号包住的算一个词（去引号）。 */
export function tokenize(seg) {
  const toks = []
  let cur = ''
  let q = null
  let has = false
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]
    if (q) { if (c === q) { q = null } else cur += c; continue }
    if (c === '"' || c === "'") { q = c; has = true; continue }
    if (/\s/.test(c)) { if (has || cur) toks.push(cur); cur = ''; has = false; continue }
    cur += c; has = true
  }
  if (has || cur) toks.push(cur)
  return toks
}

/** PowerShell 与 POSIX 里「会写文件」的命令名（不分大小写）。目标由 writeTargets() 取。 */
const WRITERS = new Set([
  // PowerShell 全名与别名
  'set-content', 'sc', 'add-content', 'ac', 'out-file', 'tee-object', 'new-item', 'ni', 'remove-item', 'ri', 'rm', 'rmdir', 'rd', 'del', 'erase',
  'move-item', 'mi', 'move', 'mv', 'copy-item', 'cpi', 'copy', 'cp', 'rename-item', 'rni', 'ren', 'rename', 'clear-content', 'clc',
  'expand-archive', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm', 'curl', 'wget', 'mkdir', 'md',
  // cmd 与 POSIX
  'xcopy', 'robocopy', 'tee', 'dd', 'install', 'ln', 'rsync', 'truncate', 'touch', 'sed', 'tar', 'unzip',
])

function isStdPath(tok, root) {
  if (typeof tok !== 'string' || tok === '') return false
  // 逗号列表（-Path .std,.x）、括号包住、of=／--directory= 前缀：逐个候选判断
  const stripped = tok.replace(/^(of|--directory|--target-directory)=/i, '')
  return stripped.split(',').some((c) => {
    const s = c.replace(/^[(\[{"']+|[)\]}"']+$/g, '')
    return s !== '' && inEmbeddedStd(s, root)
  })
}

/**
 * 一段子命令对 `.std` 的关系：
 *   'write' —— **重定向的目标词**是 .std 下的路径（`> x`、`>> x`、`word>x`、`2>x`、`&>x`、`>|x`）。唯一的 deny 来源（命令串层面）。
 *   'touch' —— 命令里出现 .std 且这一段有写动词（写类命令名、git 改工作区的子命令、cd 进 .std 后的写）：交给人问，不猜目标。
 *   null    —— 与 .std 的写无关。
 * 重定向在引号外才算：`grep ">" .std/a.md`、`echo "a > .std/x"` 里的 `>` 在引号里，不是重定向。
 */
export function stdRelation(seg, root) {
  // 重定向要在**去引号之前**的原始串上找（引号内的 > 不算）。手写扫描，线性。
  const targets = redirectTargets(seg)
  if (targets.some((tg) => isStdPath(tg, root))) return 'write'
  const toks = tokenize(seg.replace(/[()]/g, ' '))
  if (toks.length === 0) return null
  const mentionsStd = toks.some((t) => isStdPath(t, root) || /(^|[=,:]|^-[A-Za-z])\.std([\\/,]|$)/i.test(t))
  if (!mentionsStd) return null
  return segHasWrite(seg) ? 'touch' : null
}

/**
 * 取一段命令里**引号外**的重定向目标词。识别 `>`、`>>`、`>|`、`>&`，前缀可以是数字或 `&`，`>` 前可以紧贴别的词（`echo x>f`）。
 * 目标是 `>` 之后的下一个词（可紧贴，也可隔空白）。线性扫描，不用正则回溯。
 */
export function redirectTargets(seg) {
  const out = []
  let q = null
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]
    if (q) { if (c === q) q = null; continue }
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
      if (/\s/.test(d) || d === '>' || d === '<') break
      word += d; k++
    }
    if (word) out.push(word)
    i = Math.max(i, k - 1)
  }
  return out
}

// ---------------------------------------------------------------------------
// 受控动作（ask）——每条正则只在**单个子命令**上跑
// ---------------------------------------------------------------------------

/**
 * 子命令里的受控动作，**按词判断，不用跨词的 `.*?`**（独立审查实测过：嵌套 `.*?` 是立方级，长命令能卡住事件循环，实测读数见 README；
 * 按词判断每个词只看一次，线性）。
 * 做法：切词 → 找 `git` → 取它后面第一个不是选项的词作为子命令 → 对子命令的后续词逐个判断。
 * 返回理由字符串或 null。
 */
export function gitAsk(rawToks) {
  // 括号、$(…)、@(…) 里的命令也要看：把括号当空白再切词的由调用方做；这里兜底剥掉词首词尾的括号与 $ @
  const toks = rawToks.map((x) => x.replace(/^[$@]?\(+/, '').replace(/\)+$/, '')).filter((x) => x !== '')
  // 找到 git（可带路径/.exe），再跳过 git 自己的全局选项（-C dir、-c k=v、--git-dir=… 等），取子命令
  const gi = toks.findIndex((t) => /^(.*[\\/])?git(\.exe)?$/i.test(t))
  if (gi < 0) return null
  let i = gi + 1
  while (i < toks.length && toks[i].startsWith('-')) {
    // 带值的全局选项：-C <dir>、-c <k=v>、--git-dir <d>、--work-tree <d>、--namespace <n>
    if (/^-(C|c)$/.test(toks[i]) || /^--(git-dir|work-tree|namespace|exec-path|config-env|super-prefix)$/.test(toks[i])) i += 2
    else i += 1
  }
  const sub = (toks[i] || '').toLowerCase()
  const rest = toks.slice(i + 1)
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
      if (has(/^--tags$/i) || has(/(^|:)refs\/tags\//i) || has(/^(tag)$/i) || has(/^v?\d+(\.\d+)+([.-][\w.]+)?$/) || has(/^\d{4}-\d{2}-\d{2}(\.\d+)?$/)) return '推送标签属发布动作（01 §5.5 发布；含按名字推的版本号式 tag）'
      if (has(/ai-dev-std/i)) return '推公开仓只允许 release 线性发布（D-108）'
      if (has(/(^|:|\/)release$/i) || has(/^release:/i) || has(/^[^:]+:(refs\/heads\/)?release$/i)) return '推 release 分支属发布动作（D-108）；别名远端也一并问'
      if (has(/^(https?:\/\/|git@|ssh:\/\/)/i) || has(/\.git$/i)) return '推到以地址写出的远端（可能是公开仓的别名）'
      return null
    }
    case 'tag': return '打标签属发布动作（只列标签也会问：命令串分不出读写，列标签改用 git show-ref --tags）'
    case 'branch':
      if (has(/^(--delete|--force|--move)$/i) || has(/^-[a-zA-Z]*[dDfmM][a-zA-Z]*$/)) return '删除、强制移动或改名分支（含 -fD 等组合短选项）'
      return null
    case 'update-ref': return has(/^-d$/) ? 'update-ref -d 删除引用' : null
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

/** 与具体子命令无关的受控标志：出现在任何一段里都 ask。 */
const ANY_TOKEN_ASK = [
  [/^--no-ve/i, '跳过提交钩子（提交闸门；含缩写 --no-ve*），只管这一次由 Alan 批准'],
  [/hookspath/i, '改 core.hooksPath 会关掉提交闸门'],
]

/** 兼容旧导出名：测试里用它断言「ask 清单没被清空」。 */
export const ASK_COMMANDS = [...ANY_TOKEN_ASK, ['gitAsk', 'git 子命令判断']]
/** 删除或移走状态入口/失败清单。 */
const PROTECTED_FILES_DEL = /(PROJECT_STATUS\.md|失败Case清单\.md)/i
const DELETERS = new Set(['remove-item', 'ri', 'rm', 'rmdir', 'rd', 'del', 'erase', 'move-item', 'mi', 'move', 'mv', 'ren', 'rename-item', 'rni', 'rename', 'clear-content', 'clc', 'set-content', 'sc', 'out-file'])

/** 前缀包装：执行其后参数的命令。剥掉后再判（`env X=1 git push -f`、`sudo rm -rf .std`）。 */
const PREFIX_WRAPPERS = new Set(['env', 'sudo', 'command', 'time', 'nohup', 'nice', 'stdbuf', 'timeout', 'exec', 'builtin', 'xargs', 'start', 'call', 'start-process'])

/** 剥掉前缀包装与 `VAR=val` 赋值前缀；返回剥后的词表。`timeout 5 cmd`、`nice -n 5 cmd` 的数字参数也跳过。 */
export function stripPrefix(toks) {
  let i = 0
  while (i < toks.length) {
    const w = toks[i].toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '')
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) { i++; continue }       // VAR=val
    if (PREFIX_WRAPPERS.has(w)) {
      i++
      while (i < toks.length && (toks[i].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i]) || /^\d+(\.\d+)?[smhd]?$/.test(toks[i]))) i++
      continue
    }
    break
  }
  return toks.slice(i)
}

/**
 * 把整条命令当字符串参数交给别的 shell 的包装：`bash -c "…"`、`sh -c`、`cmd /c "…"`、`powershell -c`、`pwsh -Command`、`iex "…"`、`Invoke-Expression`。
 * 取出那段字符串，作为内嵌命令再判一次（有界递归，见 decide 的 depth）。没有这种包装返回 null。
 */
export function innerCommand(toks) {
  if (toks.length < 2) return null
  const w = toks[0].toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '')
  if (['iex', 'invoke-expression'].includes(w)) return toks.slice(1).join(' ')
  if (['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish'].includes(w)) {
    const k = toks.findIndex((x, i) => i > 0 && /^-[a-zA-Z]*c$/.test(x))
    return k > 0 && toks[k + 1] !== undefined ? toks.slice(k + 1).join(' ') : null
  }
  if (['cmd'].includes(w)) {
    const k = toks.findIndex((x, i) => i > 0 && /^\/[ckCK]$/.test(x))
    return k > 0 ? toks.slice(k + 1).join(' ') : null
  }
  if (['powershell', 'pwsh'].includes(w)) {
    const k = toks.findIndex((x, i) => i > 0 && /^-(c|command)$/i.test(x))
    return k > 0 ? toks.slice(k + 1).join(' ') : null
  }
  return null
}

/** 在 shell 命令里写这些受保护位置时 ask：入口合同、入口指令、提交钩子、守卫自身。 */
const PROTECTED_IN_CMD = [
  [/(^|[\s'"\\/>])CONTEXT_MANIFEST\.md(?![\w.])/i, '改默认上下文合同（唯一清单）'],
  [/(^|[\s'"\\/>])AGENTS\.md(?![\w.])/i, '改入口指令文件'],
  [/(^|[\s'"\\/>])\.githooks([\s'"\\/]|$)/i, '改提交闸门钩子'],
  [/(^|[\s'"\\/>])tools[\\/]dsh-std([\s'"\\/]|$)/i, '改守卫插件自身（改守卫的人不应由守卫放行）'],
]

/** git 改工作区或索引的子命令。 */
const GIT_WORKTREE_WRITERS = new Set(['checkout', 'restore', 'apply', 'stash', 'reset', 'clean', 'rm', 'mv', 'am', 'cherry-pick', 'merge', 'rebase', 'switch', 'revert', 'pull'])

/** 取 git 的真正子命令（跳过 -C dir、-c k=v、--git-dir 等全局选项）；返回 {name, raw}，没有则 name 为空串。 */
export function gitSubcommand(toks) {
  const gi = toks.findIndex((t) => /^(.*[\\/])?git(\.exe)?$/i.test(t))
  if (gi < 0) return { name: '', raw: '' }
  let i = gi + 1
  while (i < toks.length && toks[i].startsWith('-')) {
    if (/^-(C|c)$/.test(toks[i]) || /^--(git-dir|work-tree|namespace|exec-path|config-env|super-prefix)$/.test(toks[i])) i += 2
    else i += 1
  }
  return { name: (toks[i] || '').toLowerCase(), raw: toks[i] || '' }
}

/** 一段子命令里是否有「写动词」（用于受保护位置判断）：写重定向，或首词是写命令/git 改工作区子命令。 */
function segHasWrite(seg) {
  // 重定向：引号外，且目标不是文件描述符（`2>&1`、`>&2`）或空设备（`2>$null`、`>nul`、`>/dev/null`）——这些不写文件
  if (redirectTargets(seg).some((tg) => !/^(&?\d+|\$null|nul|\/dev\/null)$/i.test(tg))) return true
  const toks = tokenize(seg)
  if (toks.length === 0) return false
  const verb = toks[0].toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '')
  // 只读用法：sed 没有 -i、tar/unzip 只列（-t／-l）不解（-x）不打包到 .std 之外的位置……这些「是否写」取决于参数，保守起见
  // 对 sed、tar、unzip 做粗判：sed 无 -i／--in-place 不写；tar 有 -t／--list 不写；unzip 有 -l／-p／-t 不写
  if (verb === 'sed') return toks.some((x) => /^-[a-zA-Z]*i/.test(x) || x === '--in-place' || /^--in-place=/.test(x))
  if (verb === 'tar') return !toks.some((x) => /^-[a-zA-Z]*t/.test(x) || x === '--list') || toks.some((x) => /^-[a-zA-Z]*[xc]/.test(x))
  if (verb === 'unzip') return !toks.some((x) => /^-[lpt]$/.test(x))
  if (WRITERS.has(verb)) return true
  if (verb === 'git') {
    const sub = gitSubcommand(toks)
    // 只改索引的变体（--cached、--staged）不动工作区：不算写
    const rest = toks.slice(toks.indexOf(sub.raw) + 1)
    if (rest.some((x) => /^--(cached|staged)$/.test(x)) && ['rm', 'restore', 'reset'].includes(sub.name)) return false
    if (sub.name === 'reset' && !rest.some((x) => /^--(hard|keep|merge)/i.test(x))) return false   // 默认 --mixed：只改索引
    if (sub.name === 'apply' && rest.some((x) => /^--(check|stat|numstat|summary)$/.test(x))) return false   // 只检查不应用
    return GIT_WORKTREE_WRITERS.has(sub.name)
  }
  return false
}

// ---------------------------------------------------------------------------
// 判定
// ---------------------------------------------------------------------------

/**
 * 判定一次工具调用。
 * @param {{name:string, arguments:any}} exec
 * @param {{root?:string}} [opts]  root 缺省取进程 cwd。适配层会先传会话工作目录；会话不是在项目根开的就可能判偏，
 *                                   要稳妥就在 profile 的插件配置里写 root（见 README）。
 */
export function decide(exec, opts = {}) {
  const name = exec && exec.name
  const args = (exec && exec.arguments) || {}
  const root = opts.root

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
    return judgeShell(cmd, root, 0)
  }

  return { kind: 'allow' }
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

/** 内嵌命令的最大递归深度：`bash -c "bash -c '…'"` 只往里看两层，再深一律 ask（防递归与绕过并举）。 */
const MAX_DEPTH = 2

/** 更严的判定：deny > ask > allow。 */
function stricter(a, b) {
  const rank = { allow: 0, ask: 1, deny: 2 }
  return rank[b.kind] > rank[a.kind] ? b : a
}

/**
 * 判一条 shell 命令串。切子命令后逐段判：
 *   - 先**剥前缀包装**（`env X=1`、`sudo`、`command`、`timeout 5` 等）再判，所以 `sudo git push -f` 与 `env X=1 rm -rf .std` 同样被看见；
 *   - 遇到 `bash -c "…"`、`cmd /c "…"`、`pwsh -Command "…"`、`iex "…"` 这类把命令当字符串交给别的 shell 的包装，把内嵌串再判一次（depth+1），取更严的。
 * 返回 {kind, reason}。
 */
function judgeShell(cmd, root, depth) {
  if (depth > MAX_DEPTH) return { kind: 'ask', reason: '命令嵌套了太多层 shell 包装，守卫不再往里看，先问人' }
  const segs = splitCommands(cmd)
  let ask = null
  let inner = { kind: 'allow' }
  let inStd = false   // 本命令串里是否已 cd 进了 .std：之后的写动词按「判不清目标」ask（不 deny：写的相对路径可能指向别处）
  for (const rawSeg of segs) {
    // 剥前缀包装：把剥后的词表拼回一段，下面所有判断都在剥后的段上做
    const rawToks = tokenize(rawSeg.replace(/[()]/g, ' '))
    const stripped = stripPrefix(rawToks)
    const seg = stripped.length === rawToks.length ? rawSeg : stripped.join(' ')

    // 内嵌命令：bash -c "…" 等
    const innerCmd = innerCommand(stripped)
    if (innerCmd !== null) inner = stricter(inner, judgeShell(innerCmd, root, depth + 1))

    const t0 = stripped
    const v0 = (t0[0] || '').toLowerCase()
    if (['cd', 'chdir', 'set-location', 'sl', 'pushd', 'push-location', 'popd', 'pop-location'].includes(v0)) {
      // 进 .std 记下；去任何别处（含 ..、绝对路径、popd）复位
      inStd = t0.slice(1).some((x) => isStdPath(x, root))
      continue
    }
    if (inStd && segHasWrite(seg) && !ask) ask = '命令先进入内嵌标准目录 .std/ 再写，写目标可能在 .std 里（01 §8 只读），先问人'
    // 1) 重定向目标是 .std：deny（命令串层面唯一的 deny 来源）；其余带 .std 的写类命令：ask
    const rel = stdRelation(seg, root)
    if (rel === 'write') {
      return { kind: 'deny', reason: '命令把输出重定向到内嵌标准目录 .std/（01 §8 只读）。请把目标改到别处' }
    }
    if (rel === 'touch' && !ask) ask = '命令里同时有写动词与 .std，写目标判不清，先问人（01 §8 只读）'
    // 2) 受控动作（按词判断，线性）
    if (!ask) {
      const toks = tokenize(seg)
      ask = gitAsk(toks)
      if (!ask) for (const tk of toks) { const hit = ANY_TOKEN_ASK.find(([re]) => re.test(tk)); if (hit) { ask = hit[1]; break } }
    }
    // 3) 删除/移走/清空状态入口与失败清单
    if (!ask && PROTECTED_FILES_DEL.test(seg)) {
      const verb = (stripped[0] || '').toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '')
      if (DELETERS.has(verb) || redirectTargets(seg).length > 0) ask = '删除、移走或清空状态入口 / 失败清单（01 §5.5）'
    }
    // 4) 受保护位置 + 写动词
    if (!ask && segHasWrite(seg)) {
      for (const [re, why] of PROTECTED_IN_CMD) {
        if (re.test(seg)) { ask = why; break }
      }
    }
  }
  const mine = ask ? { kind: 'ask', reason: ask } : { kind: 'allow' }
  return stricter(mine, inner)
}
