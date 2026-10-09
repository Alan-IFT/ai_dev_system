// 多仓系统的工件分布（01 §3.8）。对应 tools/std/checks/check_cross_repo.py；契约见 tools/std/CONTRACT.md。
//
// 执行 §3.8 的七条机械可判定要求：承载仓唯一、各仓可定位、各仓有自己的入口、入口是投影（两跳内到达系统级权威）、各仓状态在系统级入口登记、退役仓的规则已失效、跨仓引用可达；
// 外加判据八：仓的历史别名还在被别的仓当作现称使用。判不了的一律 UNDETERMINED，不降级为通过（契约 §1）。
//
// 与 Python 版的有意差异（设计 §12.30，D-135 废弃技术栈）：
//   · 退役仓默认规则文件清单去掉 `.claude/` 与 `CLAUDE.md`（Claude Code 的落点，该宿主已废弃）：`[".harness/rules/", "AGENTS.md"]`。
//     项目在 `layout.rule_files` 里自己写了的照旧认（cms 就写了），所以对黄金样本零影响；退役仓若仍按旧宿主落地，要自己在 `layout.rule_files` 里列出来。
//   · 自检夹具里的入口文件由 `CLAUDE.md` 改为 `AGENTS.md`（探针标题与 id 不变，行为不变）；`.claude` 软链接出仓的夹具改用 `.harness`。
//
// 迁移约束：与 Python 版逐 id 相同（黄金样本，上述有意差异除外）。动笔前对每个 Python 字符串、正则、容器操作都问过「JS 里对应的在非 ASCII、非 BMP、边界值上等价吗」并在 Python 上实测（设计 §12.22）：
//   `re.escape(name) + IGNORECASE` → `foldRegexSource` + `iu`（D11；边界类 `[0-9A-Za-z_\-]` 只认 ASCII——`٣RCMS`、`éRCMS` 的前面不挡，不能用 JS 的 `\w`）
//   `str.isascii()` → 码点 < 0x80 逐个判
//   `text.splitlines()` / `.split("\n")` → `splitLinesPy` / 按 `\n` 切（头部取行用后者，与 Python 同）
//   `str.strip()` → `pyStrip`（D6）；`[:160]` / `[:120]` → `headChars`（D18）；`str(x).strip()` → `pyStrip(pyStr(x))`
//   `os.walk` 的次序 → 目录项按 `readdirSync` 的次序（Python 的 `os.walk` 用 `scandir`，不排序）；Windows 与 POSIX 上文件系统各自的次序不同，Python 同样如此，所以样本里凡次序可观察的输出都不依赖它（先排序再比）
//   `os.path.normpath(os.path.abspath(p)).replace("\\", "/")` → `path.resolve` + 归一斜杠
//   `sorted(set_of_tuples)` → 按码点比较的元组排序
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, chmodSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { cfgGet, pyStr, pyTruthy } from '../core/cfg.js';
import { foldRegexSource, headChars, inFrozen } from '../core/docs.js';
import { FAIL, PASS, SKIP, UNDETERMINED, finding, pyStrip } from '../core/finding.js';
import { fixtureEnv, writeText } from '../core/fixture.js';
import { hardenedEnv } from '../core/git.js';
import { inside, isDir, isFile, exists, readBytes, decodeUtf8Replace } from '../core/fs.js';
import { excTypeName, outsideRoot, probe, probeCrashed, runGuarded, unreadable } from '../core/shell.js';
import { cmpCodepoint } from '../core/tracked.js';
export const NAME = 'cross-repo';
export const STANDARD_REFS = ['01 §3.8'];
// 退役仓里「可被当作现行规则读入」的默认清单；项目可用 project.yaml 的 layout.rule_files 覆盖。**只认这一种拼法**：
// Python 版曾另有一个顶层 rule_files 的回退，同一事实两种写法本身就是 01 §2 N2 的副本缺陷，已删。契约 §5 也只文档化 layout.rule_files。
// 去掉了 `.claude/` 与 `CLAUDE.md`（见文件头注释）。
const DEFAULT_RULE_FILES = ['.harness/rules/', 'AGENTS.md'];
// 失效标记：出现在文件前若干行即认为已标为失效。
const MARKER_HEAD_LINES = 20;
const MARKERS_CN = ['已退役', '失效', '不再生效', '已归档', '已停用'];
const MARKERS_EN = ['retired', 'archived', 'deprecated'];
const ROLES = ['system', 'app', 'retired', 'archived'];
const DEAD_ROLES = ['retired', 'archived'];
// 01 §3.8 对 archived 的定义就是「已移出工作区，只在远端」。所以这类条目的 path 可省略，且本地目录不存在不是缺陷——要求它在本机有检出才是把定义读反了。凡需读该仓本地文件的判据对它一律记不适用。
const ARCHIVED_ABSENT = 'archived 仓按 01 §3.8 不在工作区，未核本地检出';
// 判据八的唯一豁免：同一行上写了改名标记词。豁免写在被检查的那一行上，不设清单。
const RENAME_MARKERS = ['前身', '曾用名', '改名', '更名', 'formerly', 'renamed'];
// 系统级入口里「登记了状态」的词。§3.8 要求登记的是状态，不只是名字。
const STATUS_TOKENS = ['active', 'retired', 'archived', '现行', '在用', '已退役', '退役', '已归档', '归档', '停用', 'system', '应用仓', '控制平面'];
// 扫描上限：超出即记未定，不假装扫全了。
const MAX_MD_FILES = 6000;
const MAX_RULE_FILES = 300;
const MAX_HOP2_LINKS = 60;
const MAX_LISTED = 10;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', '.mypy_cache', '.pytest_cache', '.idea']);
const WS_CLASS = '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
// 目标与标题都不含 `(`：原写法两段量词重叠，`](` 连写 8000 次要跑几分钟；排除 `(` 之后每个起点只扫到下一个 `(`，整体线性（路径里带圆括号的链接因此认不出，与 links 同）
// Python：`\]\(\s*<?([^()\s>]+)>?(?:\s[^()]*)?\)`
const INLINE_LINK = new RegExp(`\\]\\([${WS_CLASS}]*<?([^()${WS_CLASS}>]+)>?(?:[${WS_CLASS}][^()]*)?\\)`, 'gu');
// 引用式定义的标签不跨行、行首缩进只认空格与制表符：`^[ \t]*\[[^\]\n]+\]:\s*<?([^\s>]+)`，re.M——JS 的 m 标志的 `^` 还认 \r、U+2028、U+2029（Python 只认 \n），所以不用 m，逐行匹配
const REF_LINK_LINE = new RegExp(`^[ \\t]*\\[[^\\]\\n]+\\]:[${WS_CLASS}]*<?([^${WS_CLASS}>]+)`, 'u');
const SCHEME = /^[A-Za-z][A-Za-z0-9+.\-]*:/;
// --------------------------------------------------------------------------
// 小工具
// --------------------------------------------------------------------------
function enumFailed(repo, what, exc) {
    return finding(NAME, UNDETERMINED, `列不出仓 ${repo} 的${what}`, { kind: 'enum-failed', key: repo, reason: `${excTypeName(exc)}: ${exc.message}`, why: '01 §2 N1：依赖不可用记未定，不记通过' });
}
const readText = (path, root) => decodeUtf8Replace(readBytes(path, root));
/** 只要头几行：读前 64KB，按 `\n` 切，取前 n 行各补一个 `\n` 再拼回（与 Python 的 `"".join(ln + "\n" for ln in lines[:n])` 同）。 */
function headLines(path, root, n = MARKER_HEAD_LINES) {
    const lines = decodeUtf8Replace(readBytes(path, root, 64 * 1024)).split('\n');
    return lines.slice(0, n).map((l) => l + '\n').join(''); // py-semantics-ok: 数组切元素个数，不是字符串切分
}
/** 失效标记。中文按原文子串找，英文按小写后的子串找（Python 的 `text.lower()`）；返回命中的标记词或 null。 */
export function hasInvalidationMarker(text) {
    const low = text.toLowerCase();
    for (const m of MARKERS_CN)
        if (text.includes(m))
            return m;
    for (const m of MARKERS_EN)
        if (low.includes(m))
            return m;
    return null;
}
// 边界类 `[0-9A-Za-z_\-]` 在 Python 的 re.I 下也折叠：逐码点实测，除 ASCII 外它还匹配 İ(U+0130)、ı(U+0131)、ſ(U+017F)、K(U+212A) 四个；
// JS 的 `iu` 只带 ſ 与 K，漏 İ 与 ı——与 core/docs 的 D11 同一个缺口，所以显式并上。
const BOUNDARY = '[0-9A-Za-z_\\-\\u0130\\u0131]';
/** 仓名是否作为独立记号出现。不能用裸子串——嵌套命名下 RCMS 会被 RCMS_Backend 假命中，那会把「未登记」误判成通过。 */
export function nameAppears(text, name) {
    const re = new RegExp(`(?<!${BOUNDARY})${foldRegexSource(name)}(?!${BOUNDARY})`, 'iu');
    return re.test(text);
}
const isAscii = (s) => { for (let i = 0; i < s.length; i++)
    if (s.charCodeAt(i) > 0x7f)
        return false; return true; };
/** 这一行上有没有把仓的状态写出来。只认状态词本身，不解读句意。英文词按独立记号认（子串会让 filesystem 命中 system，B13），中文词按子串。 */
export function hasStatusToken(line) {
    return STATUS_TOKENS.some((t) => (isAscii(t) ? nameAppears(line, t) : line.includes(t)));
}
/** `os.path.normpath(os.path.abspath(path)).replace("\\", "/")`。 */
export const norm = (p) => normalize(resolve(p)).replaceAll('\\', '/');
const isGitRepo = (p) => exists(join(p, '.git'));
const archivedAbsent = (r) => r.role === 'archived' && !r._exists;
/** 抽出 markdown 链接目标。只认链接语法，不猜正文里的裸路径。 */
export function linkTargets(text) {
    const seen = new Set(), out = [];
    // Python：先全部内联链接（按出现次序），再全部引用式定义（按出现次序）
    const hits = [];
    for (const m of text.matchAll(INLINE_LINK))
        hits.push(m[1]);
    for (const ln of splitRefLines(text)) {
        const m = REF_LINK_LINE.exec(ln.text);
        if (m)
            hits.push(m[1]);
    }
    for (const raw of hits) {
        let t = pyStrip(raw);
        if (!t || t.startsWith('#'))
            continue;
        t = pyStrip(t.split('#', 2)[0].split('?', 2)[0]); // py-semantics-ok: 数组 split 的上限不是字符串切分
        if (!t || SCHEME.test(t))
            continue;
        if (!seen.has(t)) {
            seen.add(t);
            out.push(t);
        }
    }
    return out;
}
/** Python 的 `re.M` 下 `^` 只在 `\n` 之后（及文首）匹配：按 `\n` 切行，保留行起点。 */
function splitRefLines(text) {
    // 引用式定义的标签与目标之间的 `\s*` 能跨行（`[a]:\n  x.md`），所以不能只拿一行：取「该行起点到文末」匹配，起点只在 `\n` 之后
    const out = [];
    let start = 0;
    for (;;) {
        out.push({ text: text.slice(start) }); // py-semantics-ok: 按已知的 \n 下标取后缀，不涉及码点计数
        const nl = text.indexOf('\n', start);
        if (nl < 0)
            break;
        start = nl + 1;
    }
    return out;
}
/** 本仓自己的 *.md。嵌套在本仓里的其它声明仓整棵跳过——它们的文件不归本仓。归属按「最深的包含它的声明仓」算。 */
export function listMd(repo, known) {
    const files = [];
    const walk = (dir) => {
        let ents;
        ents = readdirSync(dir, { withFileTypes: true }); // 读不了的目录向上抛：Python 的 os.walk 默认忽略 onerror，见下
        const dirs = [], names = [];
        for (const e of ents)
            (e.isDirectory() || (e.isSymbolicLink() && isDir(join(dir, e.name))) ? dirs : names).push(e.name);
        const keep = dirs.filter((d) => !SKIP_DIRS.has(d));
        const owner = ownerRepo(dir, known);
        if (owner !== null && owner._abs !== repo._abs)
            return false;
        for (const fn of names) {
            if (fn.toLowerCase().endsWith('.md')) {
                files.push(join(dir, fn));
                if (files.length >= MAX_MD_FILES)
                    return true;
            }
        }
        for (const d of keep) {
            // os.walk 默认 followlinks=False：指向目录的符号链接列在 dirnames 里，但不进入
            if (lstatSync(join(dir, d)).isSymbolicLink())
                continue;
            if (walk(join(dir, d)))
                return true;
        }
        return false;
    };
    let truncated = false;
    try {
        truncated = walk(repo._real);
    }
    catch (exc) {
        if (exc.code === 'ENOENT' || exc.code === 'ENOTDIR')
            return [files, false];
        throw exc;
    }
    return [files, truncated];
}
/** 把 layout.rule_files 的条目展开成实际存在的文件路径。以 / 结尾的按目录递归。返回 [文件, 是否截断, 出仓条目]。 */
export function expandRuleFiles(repoAbs, patterns) {
    const out = [], outside = [];
    for (const raw of patterns) {
        const pat = pyStrip(String(raw).replaceAll('\\', '/'));
        if (!pat)
            continue;
        const target = join(repoAbs, pat.replace(/\/+$/, ''));
        if (!inside(repoAbs, target)) {
            outside.push(pat);
            continue;
        }
        if (pat.endsWith('/') || isDir(target)) {
            if (!isDir(target))
                continue;
            const stack = (d) => {
                const ents = readdirSync(d, { withFileTypes: true });
                const dirs = ents.filter((e) => e.isDirectory() || (e.isSymbolicLink() && isDir(join(d, e.name)))).map((e) => e.name).filter((n) => !SKIP_DIRS.has(n));
                const files = ents.filter((e) => !(e.isDirectory() || (e.isSymbolicLink() && isDir(join(d, e.name))))).map((e) => e.name).sort(cmpCodepoint);
                for (const fn of files) {
                    out.push(join(d, fn));
                    if (out.length >= MAX_RULE_FILES)
                        return true;
                }
                for (const sd of dirs) {
                    if (lstatSync(join(d, sd)).isSymbolicLink())
                        continue;
                    if (stack(join(d, sd)))
                        return true;
                }
                return false;
            };
            if (stack(target))
                return [out, true, outside];
        }
        else if (isFile(target)) {
            out.push(target);
        }
    }
    const seen = new Set(), uniq = [];
    for (const p of out) {
        const k = norm(p);
        if (!seen.has(k)) {
            seen.add(k);
            uniq.push(p);
        }
    }
    return [uniq, false, outside];
}
/** 一个路径归哪个仓：取最深的包含它的声明仓（应付嵌套检出）。 */
export function ownerRepo(absPath, repos) {
    const p = norm(absPath);
    let best = null;
    for (const r of repos) {
        if (!r._abs)
            continue;
        const base = r._abs.replace(/\/+$/, '') + '/';
        if (p === r._abs || p.startsWith(base)) {
            if (best === null || r._abs.length > best._abs.length)
                best = r;
        }
    }
    return best;
}
// --------------------------------------------------------------------------
// 配置解析
// --------------------------------------------------------------------------
/** 返回 [repos, problem]。repos 元素带 _abs / _exists / _is_git。 */
export function loadRepos(cfg) {
    const raw = cfgGet(cfg, 'repos');
    if (!pyTruthy(raw))
        return [null, 'repos 未声明'];
    if (!Array.isArray(raw))
        return [null, 'repos 不是列表，取值有歧义'];
    if (raw.length < 2)
        return [null, `repos 只有 ${raw.length} 个条目`];
    const root = cfg._root || '.';
    const repos = [];
    const seen = new Map();
    for (let i = 1; i <= raw.length; i++) {
        const item = raw[i - 1];
        if (item === null || typeof item !== 'object' || Array.isArray(item))
            return [null, `repos 第 ${i} 项不是映射`];
        const it = item;
        const name = pyStrip(pyTruthy(it.name) ? pyStr(it.name) : '');
        const path = pyStrip(pyTruthy(it.path) ? pyStr(it.path) : '');
        const role = pyStrip(pyTruthy(it.role) ? pyStr(it.role) : '');
        if (!name)
            return [null, `repos 第 ${i} 项缺 name`];
        if (seen.has(name))
            return [null, `repos 第 ${i} 项与第 ${seen.get(name)} 项同名 ${pyReprStr(name)}，按仓名定位的判据分不清是哪个仓`]; // 各判据按仓名取入口与登记，同名两仓会被混成一个（B6）
        seen.set(name, i);
        if (!path && role !== 'archived')
            return [null, `repos 第 ${i} 项缺 path（只有 role: archived 可省略：${ARCHIVED_ABSENT}）`];
        const abspath = path ? resolve(join(root, path)) : null;
        const ex = abspath !== null && isDir(abspath);
        repos.push({
            name, path, role, _where: path || '（未声明 path）', _abs: abspath ? norm(abspath) : null, _real: abspath, _exists: ex, _is_git: ex && isGitRepo(abspath),
            former_names: Object.hasOwn(it, 'former_names') ? it.former_names : null,
        });
    }
    return [repos, null];
}
import { pyRepr } from '../core/repr.js';
const pyReprStr = (s) => pyRepr(s);
function findEntry(repo, entryNames) {
    for (const nm of entryNames) {
        const p = join(repo._real, String(nm));
        if (!inside(repo._real, p) || isFile(p))
            return [p, String(nm)]; // 出仓的不探测，照返回，由读它处记未定
    }
    return [null, null];
}
// --------------------------------------------------------------------------
// 契约接口
// --------------------------------------------------------------------------
export function scope(cfg) {
    const e = cfgGet(cfg, 'layout.entry', []);
    const entries = pyTruthy(e) && Array.isArray(e) ? e : [];
    const rf = cfgGet(cfg, 'layout.rule_files');
    const ruleFiles = pyTruthy(rf) && Array.isArray(rf) ? rf : [...DEFAULT_RULE_FILES];
    const rawRepos = cfgGet(cfg, 'repos');
    const al = [];
    for (const i of pyTruthy(rawRepos) && Array.isArray(rawRepos) ? rawRepos : []) {
        if (i && typeof i === 'object' && !Array.isArray(i) && Array.isArray(i.former_names)) {
            for (const a of i.former_names)
                al.push(`${pyStr(i.name)} 的旧名 ${pyStr(a)}`);
        }
    }
    const former = al.length
        ? `repos[].former_names 声明的历史别名（${al.join('、')}）：是否仍以独立记号出现在**别的仓**的 git 跟踪文本里（判据八）。它补的正是本检查器判据四声明不看的那一片——判据四只看 *.md 里的 markdown 链接语法，判据八用 git grep 扫全部跟踪文件里的裸词，两条判据在此互相指认`
        : null;
    return {
        covered: [
            `repos 里声明的每个仓：路径是否存在、根下有没有 .git、有没有 layout.entry 里的入口文件（${entries.map((x) => pyStr(x)).join(', ') || '（未配置）'}）`,
            'role: system 的条目是不是恰好一个（01 §3.8 指定一个承载系统级工件的仓）',
            '各应用仓的入口能否在两跳内出现指向系统仓的引用（系统仓 name、其目录名、或解析进系统仓的相对链接）',
            '系统仓的入口里有没有出现每个 repos 条目的 name，且该名字所在行上有没有状态词（01 §3.8 各仓状态在系统级入口登记）',
            `role 为 retired/archived 的仓根下，layout.rule_files（${ruleFiles.map((x) => pyStr(x)).join(', ')}）展开出的文件前 ${MARKER_HEAD_LINES} 行有没有失效标记`,
            '各仓 *.md 里 markdown 链接语法写的跨仓相对路径，解析后是否存在',
            ...(former ? [former] : []),
        ],
        not_covered: [
            ...(former ? [] : ['repos[].former_names 未声明，仓的历史别名一字未查——不声明就不猜哪个名字是旧名（判据八）']),
            'role: archived 的条目按 01 §3.8 的定义（已移出工作区，只在远端）可不给 path；省略 path 或 path 在本机不存在时，判据二按定义记通过，凡需读该仓本地文件的各条（入口、失效头、跨仓引用）对它记不适用——不核远端那一份里有什么。给了 path 且目录在，则照读照判；role: retired 不享受这条',
            "判据八不判某处指称是历史记述还是当现称用——那是人的裁定（契约 §7）；只按'出现在谁的仓里'机械分层，自仓那一层一律记未定",
            `判据八只扫根下有 .git 的仓的 git 跟踪文件，layout.frozen 下的路径不扫；同一行上写了改名标记词（${RENAME_MARKERS.join('/')}）即豁免，豁免只认同一行、不设可以偷偷加东西的清单`,
            "不判断工件归属得对不对——'这条事实该放哪个仓'是人的判断（01 §3.8 归属判据、契约 §7）",
            '不判断入口内容是否真的只是投影：只判有没有指向系统仓，不判系统级规则正文有没有被抄进来',
            "登记一条只按'名字 + 同一行的状态词'判：名字出现但同行没有状态词一律记未定（不记通过也不记失败），写的那个状态与 repos 里的 role 一不一致也不判",
            '不做跨仓同名文档的重复检测（M-26 观察一的同名文件），那是另一条判据',
            "不跨机器解析部署主机路径：以 / 开头的绝对路径一律记未定，不判存在性",
            "'两跳'判到第二跳为止——入口本身算第一跳，入口里指向本仓内文件的链接算第二跳；不展开第三跳，也不跟随外链与 http 链接",
            '只按仓根下有没有 .git 认仓库身份，不校验 git 元数据、远端、submodule 关系',
            '跨仓引用只扫 *.md，且只认 markdown 链接语法；不看 *.sh、*.json、*.yaml、*.service 里的路径，也不看正文裸路径',
            `失效标记只看文件前 ${MARKER_HEAD_LINES} 行；写在更后面的失效说明本检查器看不见`,
            '退役仓的规则文件清单以 layout.rule_files 为准；清单外的位置（如仓内子目录的另一套 agents）不看',
            '不读 git 历史，不判断某个仓是不是事实上已经停更',
        ],
    };
}
export function run(cfg) {
    return runGuarded(NAME, doRun, cfg);
}
function doRun(cfg) {
    const [repos, problem] = loadRepos(cfg);
    if (repos === null) {
        if (problem === 'repos 未声明' || problem.startsWith('repos 只有')) {
            return [finding(NAME, SKIP, '单仓项目，§3.8 记不适用', { reason: `${problem}；01 §3.8 明写'单仓项目记不适用'`, why: '01 §3.8 的适用条件是系统跨越两个以上代码仓' })];
        }
        return [finding(NAME, UNDETERMINED, 'repos 配置读不出来', { reason: `${problem}（契约 §5：缺配置不取默认值当事实）`, why: '01 §3.8 的每一条都要先知道系统由哪几个仓组成' })];
    }
    const out = [];
    out.push(...checkRoles(repos));
    out.push(...checkReachable(repos));
    const rawEntry = cfgGet(cfg, 'layout.entry');
    let entryNames = null;
    if (!pyTruthy(rawEntry)) {
        out.push(finding(NAME, UNDETERMINED, '未配置入口文件，入口相关的四条判不了', { reason: 'governance/project.yaml 缺 layout.entry；本工具不猜哪个文件是入口', why: '01 §3.8 要求每个仓必须有自己的入口，先要说清哪份是入口' }));
    }
    else {
        entryNames = rawEntry.map((x) => pyStr(x));
        const entries = new Map();
        for (const r of repos) {
            if (!r._exists)
                continue;
            entries.set(r.name, findEntry(r, entryNames));
        }
        out.push(...checkEntryExists(repos, entries, entryNames));
        out.push(...checkProjection(repos, entries));
        out.push(...checkRegistration(repos, entries));
    }
    out.push(...checkRetired(cfg, repos, entryNames ?? []));
    out.push(...checkLinks(repos));
    out.push(...checkFormerNames(cfg, repos));
    return out;
}
// --------------------------------------------------------------------------
// 判据一：恰好一个 role: system
// --------------------------------------------------------------------------
export function checkRoles(repos) {
    const out = [];
    const badRole = repos.filter((r) => !ROLES.includes(r.role));
    if (badRole.length) {
        out.push(finding(NAME, UNDETERMINED, `有 ${badRole.length} 个仓的 role 不是 system/app/retired/archived`, {
            kind: 'bad-role', reason: badRole.slice(0, MAX_LISTED).map((r) => `${r.name} 的 role = ${pyReprStr(r.role)}`).join('；'), // py-semantics-ok: 数组切元素个数
            why: '01 §3.8 只定义了这四种角色；角色不明时它的义务是哪一套判不了',
        }));
    }
    const systems = repos.filter((r) => r.role === 'system');
    if (systems.length === 1) {
        out.push(finding(NAME, PASS, `承载系统级工件的仓恰好一个：${systems[0].name}`, { where: systems[0].path, evidence: `repos 共 ${repos.length} 个，role: system 的 1 个` }));
    }
    else if (systems.length === 0) {
        out.push(finding(NAME, FAIL, '没有任何仓声明 role: system', {
            why: "01 §3.8'指定一个承载系统级工件的仓'：跨仓才成立的事实在整个系统里只有一处权威。没有这个仓，产品意图、系统全景、跨仓契约与系统级状态就没有唯一维护位置",
            evidence: `repos 的 role 取值：${repos.map((r) => `${r.name}=${r.role || '（空）'}`).join(', ')}`,
        }));
    }
    else {
        out.push(finding(NAME, FAIL, `有 ${systems.length} 个仓声明 role: system：${systems.map((r) => r.name).join('、')}`, {
            where: systems[0].path,
            why: "01 §3.8'指定一个承载系统级工件的仓'是单数。多于一个即系统级事实有两处权威，按 §3.8 归属判据出现第二处文本按 N2 判缺陷",
            evidence: `role: system 的条目：${systems.map((r) => `${r.name}（${r.path}）`).join('、')}`,
        }));
    }
    return out;
}
// --------------------------------------------------------------------------
// 判据二：各仓 path 存在且是 git 仓库
// --------------------------------------------------------------------------
export function checkReachable(repos) {
    const out = [];
    for (const r of repos) {
        if (archivedAbsent(r)) {
            out.push(finding(NAME, PASS, `仓 ${r.name} 声明 role: archived，本机无检出即符合定义`, { where: r._where, evidence: `${ARCHIVED_ABSENT}（${!r.path ? '条目未给 path' : `给了 path ${r.path} 但本机没有这个目录`}）` }));
        }
        else if (!r._exists) {
            out.push(finding(NAME, UNDETERMINED, `仓 ${r.name} 的 path 在本机不存在：${r.path}`, {
                where: r.path, reason: '本机没有这个目录；可能是别人机器上的检出布局，也可能是配置过期，本工具分不清',
                why: '01 §3.8 的其余各条都要读该仓的文件；仓不可定位时其结论一律未定，不推定合规', evidence: `解析后的绝对路径：${r._real}`,
            }));
        }
        else if (!r._is_git) {
            out.push(finding(NAME, UNDETERMINED, `仓 ${r.name} 的目录存在但根下没有 .git`, {
                where: r.path, reason: '目录在，但没有 .git；可能是 worktree/submodule 的别样布局或尚未初始化，本工具只按 .git 认',
                why: '01 §3.8 讲的是代码仓之间的工件分布；这个对象是不是一个仓判不了', evidence: `解析后的绝对路径：${r._real}`,
            }));
        }
        else {
            out.push(finding(NAME, PASS, `仓 ${r.name} 可定位且是 git 仓库`, { where: r.path, evidence: r._real }));
        }
    }
    return out;
}
// --------------------------------------------------------------------------
// 判据三：每个仓必须有自己的入口文件
// --------------------------------------------------------------------------
export function checkEntryExists(repos, entries, entryNames) {
    const out = [];
    for (const r of repos) {
        if (archivedAbsent(r)) {
            out.push(finding(NAME, SKIP, `仓 ${r.name} 的入口记不适用（archived，本地无检出）`, {
                where: r._where, reason: ARCHIVED_ABSENT, why: '01 §3.8 要求每个仓有自己的入口；该仓的入口只在远端，本机读不到，既不记通过也不记未定',
            }));
            continue;
        }
        if (!r._exists)
            continue;
        const [path, nm] = entries.get(r.name) ?? [null, null];
        if (path && !inside(r._real, path)) {
            out.push(outsideRoot(NAME, `${r.path.replace(/\/+$/, '')}/${nm}`));
        }
        else if (path) {
            out.push(finding(NAME, PASS, `仓 ${r.name} 有自己的入口：${nm}`, { where: `${r.path.replace(/\/+$/, '')}/${nm}` }));
        }
        else {
            out.push(finding(NAME, FAIL, `仓 ${r.name} 没有自己的入口文件`, {
                where: r.path,
                why: "01 §3.8'每个仓必须有自己的入口文件'：入口是投影不是副本，但先得有——没有入口，在这个仓里起会话就读不到本仓约束，也读不到系统级权威在哪",
                evidence: `在 ${r._real} 下找过：${entryNames.join('、')}，都不存在`,
            }));
        }
    }
    return out;
}
// --------------------------------------------------------------------------
// 判据四：入口是投影不是副本（两跳内到达系统级权威）
// --------------------------------------------------------------------------
export function systemTokens(sysrepo) {
    const toks = [sysrepo.name];
    const base = basename(sysrepo._real.replace(/[/\\]+$/, ''));
    if (base && !toks.includes(base))
        toks.push(base);
    return toks.filter((t) => t && t !== '.' && t !== '..');
}
/** 文本里有没有指向系统仓的引用。返回命中的证据串，没有返回 null。 */
export function mentionsSystem(text, sysrepo, srcFile) {
    for (const tok of systemTokens(sysrepo))
        if (nameAppears(text, tok))
            return `出现记号 ${pyReprStr(tok)}`;
    // 相对链接解析进系统仓根
    const base = sysrepo._abs.replace(/\/+$/, '') + '/';
    for (const t of linkTargets(text)) {
        if (t.startsWith('/') || isAbsolute(t))
            continue;
        const resolved = norm(join(dirname(srcFile), t));
        if (resolved === sysrepo._abs || resolved.startsWith(base))
            return `链接 ${pyReprStr(t)} 解析进系统仓`;
    }
    return null;
}
export function checkProjection(repos, entries) {
    const out = [];
    const systems = repos.filter((r) => r.role === 'system');
    if (systems.length !== 1) {
        out.push(finding(NAME, UNDETERMINED, "系统仓不唯一，'两跳内到达系统级权威'判不了", { reason: `role: system 的条目有 ${systems.length} 个，无法确定'系统级权威'指向哪里`, why: "01 §3.8'从任一仓的入口出发，两跳内到达系统级权威'" }));
        return out;
    }
    const sysrepo = systems[0];
    for (const r of repos) {
        if (r.role !== 'app' || !r._exists)
            continue;
        const [entryPath, nm] = entries.get(r.name) ?? [null, null];
        if (!entryPath)
            continue; // 入口缺失已在判据三报过，不重复
        let text;
        try {
            text = readText(entryPath, r._real);
        }
        catch (exc) {
            out.push(unreadable(NAME, `${r.name}/${nm}`, exc));
            continue;
        }
        const hit = mentionsSystem(text, sysrepo, entryPath);
        if (hit) {
            out.push(finding(NAME, PASS, `仓 ${r.name} 的入口第一跳即指向系统仓 ${sysrepo.name}`, { where: `${r.path.replace(/\/+$/, '')}/${nm}`, evidence: hit }));
            continue;
        }
        // 第二跳：跟随入口里指向本仓内已存在文件的链接
        let hop2 = null, followed = 0;
        for (const t of linkTargets(text)) {
            if (followed >= MAX_HOP2_LINKS)
                break;
            if (t.startsWith('/') || isAbsolute(t) || SCHEME.test(t))
                continue;
            const nxt = normalize(join(dirname(entryPath), t));
            if (!inside(r._real, nxt) || !isFile(nxt))
                continue; // 先护栏：出仓的不探测（B7）
            followed++;
            try {
                hop2 = mentionsSystem(readText(nxt, r._real), sysrepo, nxt);
            }
            catch {
                continue;
            }
            if (hop2) {
                hop2 = `第二跳 ${t}：${hop2}`;
                break;
            }
        }
        if (hop2) {
            out.push(finding(NAME, PASS, `仓 ${r.name} 的入口第二跳到达系统仓 ${sysrepo.name}`, { where: `${r.path.replace(/\/+$/, '')}/${nm}`, evidence: hop2 }));
        }
        else {
            out.push(finding(NAME, FAIL, `仓 ${r.name} 的入口两跳内到不了系统仓 ${sysrepo.name}`, {
                where: `${r.path.replace(/\/+$/, '')}/${nm}`,
                why: "01 §3.8'各仓入口是投影不是副本'，验收是'从任一仓的入口出发，两跳内到达系统级权威，并能读出系统由哪几个仓组成、各自状态'。到不了，本仓的会话就只能拿本仓这一份文本当全部事实",
                evidence: `入口 ${nm} 里没有 ${systemTokens(sysrepo).join('/')}，也没有解析进系统仓的相对链接；跟随了 ${followed} 个本仓内链接做第二跳，仍未命中`,
            }));
        }
    }
    return out;
}
// --------------------------------------------------------------------------
// 判据五：各仓状态在系统级入口登记
// --------------------------------------------------------------------------
export function checkRegistration(repos, entries) {
    const out = [];
    const systems = repos.filter((r) => r.role === 'system');
    if (systems.length !== 1)
        return out; // 判据四已记未定
    const sysrepo = systems[0];
    if (!sysrepo._exists)
        return out; // 判据二已记未定
    const [entryPath, nm] = entries.get(sysrepo.name) ?? [null, null];
    if (!entryPath) {
        out.push(finding(NAME, UNDETERMINED, `系统仓 ${sysrepo.name} 没有入口，'各仓状态在系统级入口登记'判不了`, { reason: '系统仓根下找不到 layout.entry 列出的任何入口文件', why: "01 §3.8'每个仓的状态在系统级入口登记'" }));
        return out;
    }
    let text;
    try {
        text = readText(entryPath, sysrepo._real);
    }
    catch (exc) {
        return [unreadable(NAME, `${sysrepo.name}/${nm}`, exc)];
    }
    const lines = splitLinesPyLocal(text);
    const missing = [], bare = [], ok = [];
    for (const r of repos) {
        const hits = lines.filter((ln) => nameAppears(ln, r.name));
        if (!hits.length)
            missing.push(r);
        else if (hits.some((ln) => hasStatusToken(ln)))
            ok.push(r);
        else
            bare.push([r, headChars(pyStrip(hits[0]), 160)]);
    }
    const where = `${sysrepo.path.replace(/\/+$/, '')}/${nm}`;
    if (missing.length) {
        out.push(finding(NAME, FAIL, `系统级入口未登记 ${missing.length} 个仓：${missing.map((r) => r.name).join('、')}`, {
            where,
            why: "01 §3.8'每个仓的状态在系统级入口登记（active / retired / archived）'。后果是从入口出发发现不了它——读入口的人和会话不知道这个仓存在，它的规则、文档与未了结的状态都在覆盖范围之外（M-26 观察三）",
            evidence: `在 ${nm}（${[...text].length} 字符 / ${lines.length} 行）里逐个查 repos 的 name，缺：${missing.map((r) => `${r.name}（role=${r.role || '（空）'}）`).join('、')}`,
        }));
    }
    if (bare.length) {
        out.push(finding(NAME, UNDETERMINED, `系统级入口里有 ${bare.length} 个仓只出现了名字，看不出登记了什么状态：${bare.map(([r]) => r.name).join('、')}`, {
            where, kind: 'name-only',
            reason: `名字所在的行上没有 ${STATUS_TOKENS.slice(0, 6).join('/')} 之类的状态词。它是被当作一个仓登记并写明状态，还是只在正文里顺带被提到（比如某条链接的说明文字），机械判不了——**按名字出现即记通过会造成假通过**，故记未定`, // py-semantics-ok: 数组切元素个数
            why: "01 §3.8'每个仓的状态在系统级入口登记（active / retired / archived）'：要求登记的是状态，不只是名字。状态没登记时后果同 M-26 观察三——从入口出发看不出这个仓还在不在用，它的过期规则是否仍会被读入",
            evidence: bare.slice(0, MAX_LISTED).map(([r, ln]) => `${r.name} → 命中行：${ln}`).join('；'), // py-semantics-ok: 数组切元素个数
        }));
    }
    if (ok.length && !missing.length && !bare.length) {
        out.push(finding(NAME, PASS, `系统级入口里 ${ok.length} 个仓都带状态词登记`, { where, evidence: '只判名字所在行上有没有状态词，不判写的那个状态与 repos 里的 role 是否一致' }));
    }
    return out;
}
import { splitLinesPy as splitLinesPyLocal } from '../core/yaml.js';
// --------------------------------------------------------------------------
// 判据六：退役仓的规则必须已失效
// --------------------------------------------------------------------------
export function checkRetired(cfg, repos, entryNames) {
    const out = [];
    const dead = repos.filter((r) => DEAD_ROLES.includes(r.role));
    if (!dead.length)
        return out;
    let patterns = cfgGet(cfg, 'layout.rule_files');
    const usedDefault = patterns === undefined || patterns === null;
    if (usedDefault)
        patterns = [...DEFAULT_RULE_FILES];
    if (!Array.isArray(patterns)) {
        return [finding(NAME, UNDETERMINED, 'layout.rule_files 不是列表，退役仓一条判不了', {
                reason: `layout.rule_files = ${pyRepr(patterns)}`, why: "01 §3.8'退役仓在停止使用的同一次变更里，其入口与规则文件必须被标为失效或删除'",
            })];
    }
    const pats = [...new Set([...patterns.map((p) => pyStr(p)), ...entryNames.map((e) => pyStr(e))])]; // 入口与清单重叠时只列一次（dict.fromkeys 保序去重）
    const note = usedDefault ? `layout.rule_files 用的是缺省清单 ${pyRepr([...DEFAULT_RULE_FILES])}（项目未在 project.yaml 里校准）` : 'layout.rule_files 取自 project.yaml';
    for (const r of dead) {
        if (archivedAbsent(r)) {
            out.push(finding(NAME, SKIP, `退役仓 ${r.name} 的失效标记记不适用（archived，本地无检出）`, {
                where: r._where, reason: ARCHIVED_ABSENT, why: '01 §3.8 要求退役仓的入口与规则文件已标失效或删除；本机没有这些文件可读，既不记通过也不记未定',
            }));
            continue;
        }
        if (!r._exists)
            continue; // 判据二已记未定
        let files, truncated, outside;
        try {
            [files, truncated, outside] = expandRuleFiles(r._real, pats);
        }
        catch (exc) {
            out.push(enumFailed(r.name, '规则文件', exc));
            continue;
        }
        const live = [], unread = outside.map((p) => `${p}（真实位置在该仓之外，未读）`);
        for (const p of files) {
            let head;
            try {
                head = headLines(p, r._real);
            }
            catch (exc) {
                unread.push(`${relative(r._real, p)}（${osErrorText(exc)}）`);
                continue;
            }
            if (!hasInvalidationMarker(head))
                live.push(relative(r._real, p).replaceAll('\\', '/'));
        }
        if (unread.length) {
            out.push(finding(NAME, UNDETERMINED, `退役仓 ${r.name} 有 ${unread.length} 份规则文件读不了`, {
                where: r.path, kind: 'unreadable-rules', key: r.name, reason: unread.slice(0, MAX_LISTED).join('；'), why: '01 §3.8：退役仓保留着可被读入的规则时按 N1 记未定，不推定无害', // py-semantics-ok: 数组切元素个数
            }));
        }
        if (truncated) {
            out.push(finding(NAME, UNDETERMINED, `退役仓 ${r.name} 的规则文件超过扫描上限 ${MAX_RULE_FILES}，未扫全`, {
                where: r.path, reason: `只查了前 ${MAX_RULE_FILES} 份；未查的部分是没看，不是没问题（契约 §2）`, why: '01 §3.8 退役仓一条',
            }));
        }
        if (live.length) {
            out.push(finding(NAME, FAIL, `退役仓 ${r.name}（role=${r.role}）仍有 ${live.length} 份文件可被当作现行规则读入`, {
                where: `${r.path.replace(/\/+$/, '')}/${live[0]}`,
                why: "01 §3.8'退役仓在停止使用的同一次变更里，其入口与规则文件必须被标为失效或删除'——退役不是'不再提交'，是'不再被读'。失效是双向的：一面是从系统级入口发现不了这个仓，另一面是在它的目录里起一次会话，就会把这些过期规则当作现行规则整份读入，与系统仓的现行规则直接冲突，中间没有任何检查（M-26 观察二、三）",
                evidence: `前 ${MARKER_HEAD_LINES} 行内没有 ${[...MARKERS_CN, ...MARKERS_EN].join('/')} 任一失效标记的文件（共 ${live.length} 份，列前 ${Math.min(live.length, MAX_LISTED)}）：${live.slice(0, MAX_LISTED).join('、')}；${note}`, // py-semantics-ok: 数组切元素个数
            }));
        }
        else if (!unread.length && !truncated) { // 有没读的或没扫全的，就说不出「都带」（B8）
            out.push(finding(NAME, PASS, `退役仓 ${r.name} 的 ${files.length} 份规则文件都带失效标记`, { where: r.path, evidence: `扫描清单：${pats.join('、')}；${note}` }));
        }
    }
    return out;
}
/** `"%s" % exc` 对 OSError 的写法：`[Errno 13] Permission denied: 'path'`。Python 的消息随平台与错误码变，这里只用于「读不了」的括号说明，不进 id；用异常类名 + 消息。 */
function osErrorText(exc) {
    return `${excTypeName(exc)}: ${exc.message}`;
}
// --------------------------------------------------------------------------
// 判据七：跨仓引用可达
// --------------------------------------------------------------------------
export function checkLinks(repos) {
    const out = [];
    const known = repos.filter((r) => r._exists);
    for (const r of repos) {
        if (archivedAbsent(r)) {
            out.push(finding(NAME, SKIP, `仓 ${r.name} 的跨仓引用记不适用（archived，本地无检出）`, {
                where: r._where, reason: ARCHIVED_ABSENT, why: "01 §3.8'跨仓引用按契约处理'：本机没有它的 *.md 可扫；别的仓指向它的引用仍按那些仓自己那一条判",
            }));
        }
    }
    if (known.length < 2) {
        // 其余的仓要么是 archived 本机无检出（按定义不适用），要么 path 不在（判据二已逐仓记未定）：再记一条未定就是同一事实报两次（契约 §1，B12）。理由按实际分支写（D-127）
        const archived = repos.filter((r) => archivedAbsent(r)).map((r) => r.name);
        const missing = repos.filter((r) => !r._exists && !archivedAbsent(r)).map((r) => r.name);
        let reason = `repos 声明 ${repos.length} 个仓，本机可读的只有 ${known.length} 个（${known.map((r) => r.name).join('、') || '无'}），跨仓判据没有第二个仓可比对`;
        if (archived.length)
            reason += `；${archived.join('、')} 是 archived 本机无检出，按 01 §3.8 不适用`;
        if (missing.length)
            reason += `；${missing.join('、')} 的 path 不在，已由'各仓可定位'一条逐仓记未定`;
        out.push(finding(NAME, SKIP, '本机可读的仓不足两个，跨仓引用记不适用', { kind: 'too-few-local', reason, why: "01 §3.8'跨仓引用按契约处理'：本机没有第二个仓的文件可比对" }));
        return out;
    }
    for (const r of known) {
        let mds, truncated;
        try {
            [mds, truncated] = listMd(r, known);
        }
        catch (exc) {
            out.push(enumFailed(r.name, 'md 文件', exc));
            continue;
        }
        const broken = [], hostAbs = [], unread = [], outside = [];
        let total = 0;
        for (const f of mds) {
            let text;
            try {
                text = readText(f, r._real);
            }
            catch (exc) {
                unread.push(`${relative(r._real, f)}（${excTypeName(exc)}）`);
                continue;
            }
            const relF = relative(r._real, f).replaceAll('\\', '/');
            for (const t of linkTargets(text)) {
                if (t.startsWith('/')) {
                    hostAbs.push(`${relF} -> ${t}`);
                    continue;
                }
                if (isAbsolute(t)) {
                    hostAbs.push(`${relF} -> ${t}`);
                    continue;
                }
                const resolved = normalize(join(dirname(f), t));
                const owner = ownerRepo(resolved, known);
                if (owner !== null && owner._abs === r._abs)
                    continue; // 仍在本仓内，不归本检查器
                // 只探测落在某个声明仓真实位置之内的目标：声明仓之外、或经符号链接越出所属仓的，不查存在性（那是对项目之外路径的探测），记未定
                if (owner === null || !inside(owner._real, resolved)) {
                    outside.push(`${relF} -> ${t}`);
                    continue;
                }
                total++;
                if (!exists(resolved))
                    broken.push(`${relF} -> ${t}`);
            }
        }
        const where = r.path;
        if (truncated) {
            out.push(finding(NAME, UNDETERMINED, `仓 ${r.name} 的 md 文件超过扫描上限 ${MAX_MD_FILES}，跨仓引用未扫全`, { where, reason: `只扫了前 ${MAX_MD_FILES} 份 *.md；未扫的部分是没看，不是没问题（契约 §2）`, why: "01 §3.8'跨仓引用按契约处理'" }));
        }
        if (hostAbs.length) {
            out.push(finding(NAME, UNDETERMINED, `仓 ${r.name} 有 ${hostAbs.length} 处引用指向绝对路径，本机不可判`, {
                where, kind: 'abs-refs', key: r.name, reason: '指向部署主机路径（或站点根路径），本机不可判存在性；不判存在性也不推定它成立',
                why: "01 §3.8'跨仓引用按契约处理'：这些路径同样是契约，但其存在性要在目标主机上验", evidence: `共 ${hostAbs.length} 处，列前 ${Math.min(hostAbs.length, MAX_LISTED)}：${hostAbs.slice(0, MAX_LISTED).join('；')}`, // py-semantics-ok: 数组切元素个数
            }));
        }
        if (outside.length) {
            out.push(finding(NAME, UNDETERMINED, `仓 ${r.name} 有 ${outside.length} 处引用指向所有声明仓之外`, {
                where, kind: 'outside-repos', key: r.name, reason: '目标不在 repos 声明的任何仓的真实位置之内（未声明的仓，或经符号链接越出）；本工具不探测声明仓之外的路径，连存在性也不查',
                why: "01 §3.8'跨仓引用按契约处理'：契约的另一侧要在 repos 里声明才可机械核对", evidence: outside.slice(0, MAX_LISTED).join('；'), // py-semantics-ok: 数组切元素个数
            }));
        }
        if (unread.length) {
            out.push(finding(NAME, UNDETERMINED, `仓 ${r.name} 有 ${unread.length} 份 *.md 没读，其中的跨仓引用未判`, {
                where, kind: 'unreadable', key: r.name, reason: '读不了或超过读取上限；没读的文件不是没有断链（契约 §1）', why: "01 §3.8'跨仓引用按契约处理'", evidence: unread.slice(0, MAX_LISTED).join('；'), // py-semantics-ok: 数组切元素个数
            }));
        }
        if (broken.length) {
            out.push(finding(NAME, FAIL, `仓 ${r.name} 有 ${broken.length} 处跨仓引用解析后不存在`, {
                where: `${r.path.replace(/\/+$/, '')}/${broken[0].split(' -> ')[0]}`,
                why: "01 §3.8'跨仓引用按契约处理'：一个仓的文档指向另一个仓的路径时该路径是契约，移动前先改全部引用方或保留指针。断掉的引用意味着契约已被单方面破坏，顺着它走的人和会话到不了目标",
                evidence: `共 ${broken.length} 处，列前 ${Math.min(broken.length, MAX_LISTED)}：${broken.slice(0, MAX_LISTED).join('；')}（扫描范围：本仓 ${mds.length} 份 *.md 的 markdown 链接）`, // py-semantics-ok: 数组切元素个数
            }));
        }
        else if (total) {
            out.push(finding(NAME, PASS, `仓 ${r.name} 的 ${total} 处跨仓引用全部可达`, { where, evidence: `扫了 ${mds.length} 份 *.md` }));
        }
        else if (!outside.length) {
            out.push(finding(NAME, SKIP, `仓 ${r.name} 的 *.md 里没有指向其他仓的链接`, { where, kind: 'no-refs', key: r.name, reason: '0 处跨仓引用上说不出『全部可达』（01 §2 N1 空集不记通过）；没有对象即本条不适用', evidence: `扫了 ${mds.length} 份 *.md` }));
        }
    }
    return out;
}
// --------------------------------------------------------------------------
// 判据八：仓的历史别名还在被别的仓当作现称使用
// --------------------------------------------------------------------------
/** **仅测试用**：每次 gitGrep 被调用时记一笔。Python 版的自检靠 `globals()["_git_grep"] = …` 替换函数来数调用次数，ESM 的命名绑定不可改写，所以显式留个计数器。生产路径恒不读它。 */
export const __testCalls = { grep: [] };
/** 一仓一次子进程召回全部别名。返回 [命中列表, 错误]；命中项为 [相对路径, 行号, 行文]。 */
export function gitGrep(repoReal, needles) {
    __testCalls.grep.push([...needles]);
    // --no-color：全局 color.ui／color.grep=always 时输出带转义码，按冒号切行会全数落空
    // -z：路径、行号、行文之间用 NUL 分隔。按冒号切时路径里的冒号会错位，frozen 豁免随之失效（B9）
    const args = ['-C', repoReal, '--no-optional-locks', '-c', 'core.quotepath=false', 'grep', '--no-color', '-I', '-n', '-z', '-F', ...needles.flatMap((n) => ['-e', n]), '--', '.'];
    const r = spawnSync('git', args, { timeout: 120_000, env: hardenedEnv(process.env), maxBuffer: 1 << 30 });
    if (r.error)
        return [null, `跑不了 git grep：${r.error.message}`];
    if (r.status !== 0 && r.status !== 1)
        return [null, `git grep 退出码 ${r.status}：${headChars(pyStrip(decodeUtf8Replace(r.stderr ?? Buffer.alloc(0))), 160)}`]; // 1 = 一条都没命中，是正常出口
    return parseGrepZ(decodeUtf8Replace(r.stdout ?? Buffer.alloc(0)));
}
/** `git grep -n -z` 的输出是「路径 NUL 行号 NUL 行文 换行」首尾相接。路径可以含换行（行文不会），所以不能先按换行切：按 NUL 切成记号流，行文与下一条路径之间的第一个换行才是分界（R1-09）。 */
export function parseGrepZ(out) {
    if (!out)
        return [[], null];
    const toks = out.split('\0'), hits = [];
    let path = toks[0];
    for (let i = 1; i < toks.length - 1; i += 2) {
        const rest = toks[i + 1];
        const nl = rest.indexOf('\n');
        const line = nl < 0 ? rest : rest.slice(0, nl); // py-semantics-ok: 按已知的 \n 下标切，不涉及码点计数
        const nxt = nl < 0 ? '' : rest.slice(nl + 1); // py-semantics-ok: 同上
        if (!isPyDigitStr(toks[i]))
            return [null, `git grep -z 的输出切不开（第 ${hits.length} 条命中的行号不是数字）`];
        hits.push([path, toks[i], headChars(pyStrip(line), 120)]); // 反斜杠是文件名的一部分，不改写成 /
        path = nxt;
    }
    if (toks.length % 2 === 0 || path)
        return [null, 'git grep -z 的输出切不开（记号数不成对）'];
    return [hits, null];
}
import { isPyDigit } from './evidence.js';
const isPyDigitStr = (s) => s.length > 0 && isPyDigit(s);
export function checkFormerNames(cfg, repos) {
    const out = [];
    const names = new Set(repos.map((r) => r.name.toLowerCase()));
    const todo = [];
    for (const r of repos) {
        const fn = r.former_names;
        if (fn === null || fn === undefined)
            continue;
        if (!Array.isArray(fn)) {
            out.push(finding(NAME, UNDETERMINED, `仓 ${r.name} 的历史别名读不出来`, { reason: `former_names = ${pyRepr(fn)}，不是列表；契约 §5：取值有歧义时不猜`, why: "01 §3.8'跨仓引用按契约处理'" }));
            continue;
        }
        for (const a of fn.map((x) => pyStrip(pyStr(x))).filter((x) => x)) {
            // ←—— 挡住大批误报的四行，不许省。不分大小写：命中行的复核 nameAppears 就不分（B10）
            if (names.has(a.toLowerCase())) {
                out.push(finding(NAME, UNDETERMINED, `仓 ${r.name} 的历史别名 ${pyReprStr(a)} 与在册仓名相撞，本项不扫描`, {
                    reason: `repos 里已有一个仓就叫 ${pyReprStr(a)}：按它召回，命中的是现名的正常引用而不是旧名的死指针`, why: '契约 §1.1：召回前提不成立时记未定，绝不产出 FAIL',
                }));
                continue;
            }
            todo.push([r, a]);
        }
    }
    if (!todo.length)
        return out;
    const cross = [], mine = [], errs = [];
    for (const r of repos.filter((x) => x._is_git)) {
        const [hits, err] = gitGrep(r._real, [...new Set(todo.map(([, a]) => a))].sort(cmpCodepoint));
        if (err) {
            errs.push(`${r.name}：${err}`);
            continue;
        }
        for (const [rel, no, line] of hits) {
            if (inFrozen(cfg, rel) || RENAME_MARKERS.some((m) => line.includes(m) || line.toLowerCase().includes(m)))
                continue;
            for (const [owner, alias] of todo) {
                if (nameAppears(line, alias))
                    (r._abs === owner._abs ? mine : cross).push(`${r.name}/${rel}:${no}（${owner.name} 的旧名 ${alias}）`);
            }
        }
    }
    const al = todo.map(([o, a]) => `${o.name}←${a}`).join('、');
    const how = `（逐仓一次 git grep -I -n -F 召回全部别名，命中行再过 _name_appears 词边界复核；同行写了 ${RENAME_MARKERS.join('/')} 任一改名标记的已豁免；layout.frozen 下的路径与根下没有 .git 的仓不扫）`;
    if (errs.length) {
        out.push(finding(NAME, UNDETERMINED, `有 ${errs.length} 次历史别名召回没跑成`, { kind: 'alias-recall-failed', reason: errs.slice(0, MAX_LISTED).join('；'), why: "契约 §2：召回跑不成是'没看'，不推定'没有命中'" })); // py-semantics-ok: 数组切元素个数
    }
    if (cross.length) {
        out.push(finding(NAME, FAIL, `历史别名仍被别的仓当作现称使用：${new Set(cross.map((x) => x.split(':')[0])).size} 文件 / ${cross.length} 行`, {
            where: cross[0].split('（')[0],
            why: "01 §3.8'跨仓引用按契约处理'：仓改名之后，别的仓里写着旧名的那一行就是一条指向不存在的仓的指针，顺着它走的人和会话到不了目标；改名方要么同批改掉全部引用方、要么留一个转发指针",
            evidence: `别名：${al}；共 ${cross.length} 行，列前 ${Math.min(cross.length, MAX_LISTED)}：${cross.slice(0, MAX_LISTED).join('；')}${how}`, // py-semantics-ok: 数组切元素个数
        }));
    }
    else if (!errs.length) {
        out.push(finding(NAME, PASS, `${todo.length} 个历史别名在别的仓里都不再被当作现称使用`, { evidence: `别名：${al}；扫了 ${repos.filter((r) => r._is_git).length} 个仓${how}` }));
    }
    if (mine.length) {
        out.push(finding(NAME, UNDETERMINED, `历史别名在它自己那个仓里还出现 ${mine.length} 行`, {
            kind: 'alias-residue', reason: '自己仓里写自己的旧名，是历史记述还是当现称用机械分不了——这一层的裁定归读报告的人（契约 §7）',
            why: "01 §3.8：只有'别的仓写旧名'才是确定的断指针；自仓这一层按 01 §2 N1 记未定，不记失败",
            evidence: `共 ${mine.length} 行，列前 ${Math.min(mine.length, MAX_LISTED)}：${mine.slice(0, MAX_LISTED).join('；')}`, // py-semantics-ok: 数组切元素个数
        }));
    }
    return out;
}
// --------------------------------------------------------------------------
// 自检：反例与正例各一（契约 §3）
// --------------------------------------------------------------------------
/** 造一个最小的仓目录。只按 .git 是否存在认仓库身份，故不依赖 git 可执行文件。 */
function mkRepo(root, name) {
    const d = join(root, name);
    mkdirSync(join(d, '.git'), { recursive: true });
    return d;
}
/** 造三仓样本。bad=true 时：退役仓规则未失效，且系统入口未登记它。入口文件叫 AGENTS.md（Python 版的 CLAUDE.md 随废弃宿主一并换掉，见文件头注释）。 */
function sample(tmp, bad) {
    for (const nm of ['sys', 'app', 'old'])
        mkRepo(tmp, nm);
    if (bad) {
        writeText(join(tmp, 'sys', 'AGENTS.md'), '# 系统仓\n\n本系统由这几个仓组成：sys、app。\n');
        writeText(join(tmp, 'old', 'AGENTS.md'), '# 老仓入口\n\n七阶段流水线由 PM 调度，子 agent 不自路由。\n');
        writeText(join(tmp, 'old', '.harness', 'rules', '00-core.md'), '# 核心规则\n\n每次开工先跑流水线。\n');
    }
    else {
        writeText(join(tmp, 'sys', 'AGENTS.md'), '# 系统仓\n\n本系统由这几个仓组成：sys（system）、app（active）、old（retired）。\n各仓状态见本文件。\n');
        writeText(join(tmp, 'old', 'AGENTS.md'), '# 老仓入口（已退役）\n\n本仓已退役，以下内容不再生效，现行规则见 ../sys/AGENTS.md。\n');
    }
    writeText(join(tmp, 'app', 'AGENTS.md'), '# 应用仓 app\n\n本仓特有约束见下。系统级权威在 [系统仓](../sys/AGENTS.md)。\n');
    return { _root: tmp, layout: { entry: ['AGENTS.md'] }, repos: [{ name: 'sys', path: 'sys', role: 'system' }, { name: 'app', path: 'app', role: 'app' }, { name: 'old', path: 'old', role: 'retired' }] };
}
/** archived 且不给 path 的样本：本机只有 sys 与 app 两个检出，arch 只在远端。 */
function sampleArchived(tmp) {
    for (const nm of ['sys', 'app'])
        mkRepo(tmp, nm);
    writeText(join(tmp, 'sys', 'AGENTS.md'), '# 系统仓\n\n本系统由这几个仓组成：sys（system）、app（active）、arch（archived，已移出工作区）。\n');
    writeText(join(tmp, 'app', 'AGENTS.md'), '# 应用仓 app\n\n本仓特有约束见下。系统级权威在 [系统仓](../sys/AGENTS.md)。\n');
    return { _root: tmp, layout: { entry: ['AGENTS.md'] }, repos: [{ name: 'sys', path: 'sys', role: 'system' }, { name: 'app', path: 'app', role: 'app' }, { name: 'arch', role: 'archived' }] };
}
const GIT_QUIET = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false'];
/** 判据八的两仓样本，必须是**真** git 仓（git grep 只看索引）。只取判据八那几条。 */
function aliasProbe(tmps, body, former, rel = 'docs/note.md', frozen = []) {
    const tmp = mkdtempSync(join(tmpdir(), 'crself-'));
    tmps.push(tmp);
    for (const nm of ['sys', 'app']) {
        const d = join(tmp, nm);
        writeText(join(d, 'AGENTS.md'), `# ${nm}\n\n权威见 [系统仓](../sys/AGENTS.md)。\n`);
        if (nm === 'app')
            writeText(join(d, rel), body + '\n');
        for (const arg of [['init', '-q'], ['add', '-A']])
            spawnSync('git', ['-C', d, ...GIT_QUIET, ...arg], { timeout: 60_000, env: fixtureEnv() });
    }
    const got = run({ _root: tmp, layout: { entry: ['AGENTS.md'], frozen }, repos: [{ name: 'sys', path: 'sys', role: 'system', former_names: former }, { name: 'app', path: 'app', role: 'app' }] }).filter((f) => f.title.includes('历史别名'));
    return [got.map((f) => f.status), got.map((f) => f.title).join(' | ') || '无'];
}
const J = (v) => JSON.stringify(v);
const pyList = (v) => pyRepr([...v]);
export function selftest() {
    const results = [];
    const tmps = [];
    const mk = () => { const t = mkdtempSync(join(tmpdir(), 'crself-')); tmps.push(t); return t; };
    const guard = (what, fn) => { try {
        fn();
    }
    catch (exc) {
        results.push(probeCrashed(NAME, what, exc));
    } };
    try {
        guard('反例', () => {
            const bad = join(mk(), 'bad');
            mkdirSync(bad);
            const fails = run(sample(bad, true)).filter((f) => f.status === FAIL);
            const titles = fails.map((f) => f.title).join(' | ');
            const wantRetired = fails.some((f) => f.title.includes('仍有') && f.title.includes('现行规则读入'));
            const wantUnreg = fails.some((f) => f.title.includes('系统级入口未登记'));
            results.push(probe(NAME, fails.length > 0 && wantRetired && wantUnreg, '反例：退役仓规则未失效 + 系统入口未登记该仓，应判 FAIL', {
                evidence: `实得 FAIL ${fails.length} 条：${titles || '无'}（退役仓一条命中=${pyBool(wantRetired)}，未登记一条命中=${pyBool(wantUnreg)}）`, why: '契约 §3 静默失效探测：抓不出违规的检查器，其结论作废',
            }));
        });
        guard('正例', () => {
            const good = join(mk(), 'good');
            mkdirSync(good);
            const got = run(sample(good, false));
            // 没有跨仓链接的仓记不适用（0 处引用说不出「全部可达」，D-123）
            const norefs = got.filter((f) => f.id.startsWith(`${NAME}/no-refs/`)).map((f) => f.id).sort(cmpCodepoint);
            const other = got.filter((f) => f.status !== PASS && !f.id.startsWith(`${NAME}/no-refs/`));
            const ok = got.length > 0 && other.length === 0 && J(norefs) === J([`${NAME}/no-refs/old`, `${NAME}/no-refs/sys`]) && got.filter((f) => norefs.includes(f.id)).every((f) => f.status === SKIP);
            results.push(probe(NAME, ok, '正例：承载仓唯一、各仓有入口、投影可达、状态已登记、退役仓已标失效，应判 PASS', {
                evidence: `实得 ${got.length} 条，非 PASS ${other.length} 条：${other.map((f) => `${f.status}/${f.title}（${f.reason || f.evidence}）`).join('；') || '无'}`, why: '契约 §3 静默失效探测：正例误报 FAIL 的检查器同样不可用',
            }));
        });
        guard('archived', () => {
            const dir = join(mk(), 'arch');
            mkdirSync(dir);
            const got = run(sampleArchived(dir));
            const und = got.filter((f) => f.status === UNDETERMINED), badF = got.filter((f) => f.status === FAIL);
            const reach = got.filter((f) => f.status === PASS && f.title.includes('arch') && f.title.includes('archived'));
            const skips = got.filter((f) => f.status === SKIP && f.title.includes('arch'));
            // 入口、失效头、跨仓引用三条对它都得记不适用
            const ok = reach.length > 0 && skips.length >= 3 && und.length === 0 && badF.length === 0;
            results.push(probe(NAME, ok, 'archived 无 path 夹具：判据二应 PASS，需读其本地文件的各条应记不适用，全程不得出现未定', {
                evidence: `实得 ${got.length} 条：判据二 PASS ${reach.length} 条、不适用 ${skips.length} 条、未定 ${und.length} 条、失败 ${badF.length} 条；非 PASS/SKIP 明细：${[...und, ...badF].map((f) => `${f.status}/${f.title}（${f.reason || f.evidence}）`).join('；') || '无'}`,
                why: "01 §3.8 把 archived 定义为'已移出工作区，只在远端'；要求它在本机有检出才算过，就是把定义读反（契约 §1.1 的反向：把定义允许的状态记成判不了，会逼项目写一条随机器漂移的本机绝对路径）",
            }));
        });
        guard('重名', () => {
            const tmp = mk();
            const cfg = sample(tmp, false);
            mkRepo(tmp, 'app2');
            const repos = cfg.repos;
            cfg.repos = [repos[0], { name: 'app', path: 'app2', role: 'app' }, repos[1]]; // 第三项取原来的 app：两个同名 app（Python 版同）
            const res = run(cfg);
            const got = res.map((f) => [f.status, f.title]);
            results.push(probe(NAME, got.length === 1 && got[0][0] === UNDETERMINED && (res[0].reason ?? '').includes('同名'), 'repos 两项同名须整条记未定（配置读不出），不得让无入口的那个仓借名报 PASS', {
                evidence: `实得 ${pyRepr(got.slice(0, 6))}`, why: '契约 §5：取值有歧义时不猜', // py-semantics-ok: 数组切元素个数
            }));
        });
        guard('单仓本机', () => {
            const tmp = mk();
            const got = {}, why = {};
            for (const [label, second] of [['archived', { name: 'arch', role: 'archived' }], ['missing', { name: 'app', path: 'nope', role: 'app' }]]) {
                const cfg = sampleArchived(join(tmp, label));
                mkdirSync(join(tmp, label), { recursive: true });
                const repos = cfg.repos;
                cfg.repos = [repos[0], second];
                const res = run(cfg);
                got[label] = res.filter((f) => f.status !== PASS).map((f) => [f.status, f.id]).sort((a, b) => cmpCodepoint(a[0], b[0]) || cmpCodepoint(a[1], b[1]));
                why[label] = res.filter((f) => f.id === `${NAME}/too-few-local`).map((f) => f.reason ?? '');
            }
            const und = (k) => got[k].filter(([st]) => st === UNDETERMINED).map(([, i]) => i);
            // 理由只写实际出现的分支（D-127）：只有 archived 时不提 path 不在，反之亦然
            const honest = why.archived.length === 1 && why.archived[0].includes('arch 是 archived') && !why.archived[0].includes('path 不在')
                && why.missing.length === 1 && why.missing[0].includes('app 的 path 不在') && !why.missing[0].includes('archived');
            const ok = honest && und('archived').length === 0 && und('missing').length === 1 && Object.values(got).every((v) => v.some(([st, i]) => st === SKIP && i === `${NAME}/too-few-local`));
            results.push(probe(NAME, ok, '本机只有一个仓：system+archived 不出未定，path 不在只由判据二报一次，跨仓引用记不适用', {
                evidence: `实得 ${pyRepr(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.map((x) => [...x])])))}；理由 ${pyRepr(why)}`, why: '契约 §1：同一事实只报一次；01 §3.8 archived 本就不在工作区',
            }));
        });
        { // 状态词按独立记号认（B13）：filesystem、app_system_x 都不是 system
            const got = ['app 的 filesystem 说明', 'app（active）', 'app: Archived', 'app 已退役', 'app_system_x'].map(hasStatusToken);
            results.push(probe(NAME, J(got) === J([false, true, true, true, false]), '登记行的英文状态词按独立记号认，filesystem 不算 system', { evidence: `实得 ${pyRepr(got)}`, why: '01 §3.8 要求登记的是状态；子串命中会把只出现名字的行记成已登记（假通过）' }));
        }
        const probes8 = [
            [[FAIL], '判据八反例：历史别名出现在别的仓里，应判 FAIL', [['现行清单见 SYS_OLD/docs/list.md。', ['SYS_OLD']]]],
            [[PASS], '判据八正例：别的仓里没有出现历史别名，应判 PASS', [['现行清单见 ../sys/docs/list.md。', ['SYS_OLD']]]],
            [[PASS, UNDETERMINED], '判据八收窄反例：同行带改名标记不得报；别名撞在册仓名必须记未定且不扫描', [['SYS_OLD 已更名为 sys，清单见 ../sys/docs/list.md。', ['SYS_OLD']], ['现行清单见 app/docs/list.md。', ['app']]]],
            [[UNDETERMINED], '判据八：别名与在册仓名只差大小写也算相撞，记未定不扫描（B10）', [['现行清单见 app/docs/list.md，另有 APPLE。', ['APP']]]],
            [[PASS], '判据八：路径含冒号的 layout.frozen 目录照样豁免（B9）', [['现行清单见 SYS_OLD/docs/list.md。', ['SYS_OLD'], 'a:b/note.md', ['a:b']]]],
        ];
        for (const [want, title, ps] of probes8) {
            guard(title, () => {
                // Windows 的文件名不许含冒号；被测的是「frozen 目录路径里有特殊字符也照样豁免」这条分支，换成该平台合法的特殊字符（`@`）同样走它，所以在 Windows 上换名跑、不跳过。
                // **收窄**：这样跑不再覆盖「冒号本身会不会让按冒号切分的实现错位」这一具体回归——该字符在 Windows 上造不出，这一点只能在 POSIX 上验证。
                const fix = (s) => (process.platform === 'win32' && s !== undefined ? s.replaceAll(':', '@') : s);
                const got = ps.map(([body, former, rel, frozen]) => aliasProbe(tmps, body, former, fix(rel), (frozen ?? []).map((x) => fix(x))));
                results.push(probe(NAME, J(got.map((g) => g[0])) === J(want.map((w) => [w])), title, {
                    evidence: `期望 ${pyList(want)}，实得 ${got.map((g) => `${pyList(g[0])}：${g[1]}`).join('；')}`,
                    why: '契约 §3 静默失效探测：抓不出违规、或对正例误报的检查器，其结论作废；契约 §1.1：召回前提不成立时记未定不产 FAIL，豁免只认被检查的那一行、不设清单',
                }));
            });
        }
        guard('B20', () => {
            const tmp = mk();
            for (const nm of ['sys', 'app']) {
                const d = join(tmp, nm);
                writeText(join(d, 'AGENTS.md'), `# ${nm}\n\n权威见 [系统仓](../sys/AGENTS.md)。\n`);
                writeText(join(d, 'docs', 'n.md'), '见 SYS_OLD 与 APP_OLD。\n');
                for (const arg of [['init', '-q'], ['add', '-A']])
                    spawnSync('git', ['-C', d, ...arg], { timeout: 60_000, env: fixtureEnv() });
            }
            __testCalls.grep.length = 0;
            let got;
            try {
                got = run({ _root: tmp, layout: { entry: ['AGENTS.md'] }, repos: [{ name: 'sys', path: 'sys', role: 'system', former_names: ['SYS_OLD'] }, { name: 'app', path: 'app', role: 'app', former_names: ['APP_OLD'] }] }).filter((f) => f.title.includes('历史别名'));
            }
            finally { /* 计数器留给下面读 */ }
            const calls = __testCalls.grep.length;
            const ev = got.map((f) => f.evidence ?? '').join(' ');
            const tmp2 = mk();
            const listed = run(sample(tmp2, false)).filter((f) => f.title.includes('都带失效标记')).map((f) => f.evidence ?? '');
            const scan = listed.length ? listed[0].split('扫描清单：')[1].split('；')[0].split('、') : [];
            const ok = calls === 2 && ev.includes('sys 的旧名 SYS_OLD') && ev.includes('app 的旧名 APP_OLD') && scan.length > 0 && scan.length === new Set(scan).size;
            results.push(probe(NAME, ok, '判据八一仓一次 git grep、命中逐别名归属；退役仓扫描清单不重复列', { evidence: `grep 次数 ${calls}；别名命中 ${pyList(got.map((f) => f.status))}；扫描清单 ${pyList(scan)}`, why: 'B20 精简：同一件事只做一次' }));
        });
        guard('id 区分力', () => {
            const dir = join(mk(), 'abs');
            mkdirSync(dir);
            const cfg = sample(dir, false);
            for (const nm of ['sys', 'app'])
                writeText(join(dir, nm, 'docs', 'ref.md'), '# 引用\n\n见 [部署目录](/srv/deploy/notes.md)。\n');
            const got = run(cfg).filter((f) => (f.id || '').startsWith(`${NAME}/abs-refs/`));
            const ids = got.map((f) => f.id).sort(cmpCodepoint);
            results.push(probe(NAME, J(ids) === J([`${NAME}/abs-refs/app`, `${NAME}/abs-refs/sys`]), 'id 区分力：两个仓各有一处绝对路径引用，两条未定的 id 须按仓名分开', { evidence: `实得 ${got.length} 条：${ids.join('、') || '无'}`, why: '契约 §9：id 是例外登记的地址，两个仓共用一个地址就会被一行登记一起静音' }));
        });
        guard('读不了', () => {
            const d = join(mk(), 'ur');
            mkdirSync(d);
            const cfg = sample(d, false);
            const locked = join(d, 'app', 'docs', 'locked.md');
            writeText(locked, '# 锁\n\n见 [没有](../../sys/nope.md)。\n');
            // 以 root 跑、或 Windows（chmod 000 挡不住读）时样本不成立，跳过这一条（不算失败）；Python 版用 os.access(R_OK) 判，这里用 geteuid
            if (!(typeof process.geteuid === 'function' && process.geteuid() !== 0))
                return;
            chmodSync(locked, 0);
            let got;
            try {
                got = run(cfg);
            }
            finally {
                chmodSync(locked, 0o644);
            }
            const hit = got.filter((f) => f.id === `${NAME}/unreadable/app`);
            results.push(probe(NAME, hit.length === 1 && hit[0].status === UNDETERMINED, '读不了的 *.md 须记一条未定，不得静默跳过', {
                evidence: `实得 ${pyRepr(got.filter((f) => f.status !== PASS).slice(0, 8).map((f) => [f.status, f.id]))}`, why: '契约 §1：依赖不可用记未定，不得吞掉异常记 PASS', // py-semantics-ok: 数组切元素个数
            }));
        });
        guard('兄弟仓', () => {
            const tmp = mk(), outside = mk();
            const d = join(tmp, 'sib');
            mkdirSync(d);
            const cfg = sample(d, false);
            const secret = join(outside, 'AGENTS.md');
            writeText(secret, '# TOPSECRET\n\n系统仓 sys\n');
            const appEntry = join(d, 'app', 'AGENTS.md');
            rmSync(appEntry);
            try {
                symlinkSync(secret, appEntry);
            }
            catch {
                return;
            } // 建不了符号链接的平台：此条不成立（Python 版同条件下 os.symlink 会抛，整条记 FAIL；这里不假装构造成功）
            writeText(join(d, 'sys', 'docs', 'far.md'), '见 [外](../../../../nowhere/x.md)。\n');
            const ext = join(d, 'app', 'docs', 'ext.md');
            mkdirSync(dirname(ext), { recursive: true });
            symlinkSync(secret, ext);
            const got = run(cfg);
            // Python 版还断言「出仓软链接不得被 getsize 探测」；TS 的 readBytes 只用 fstat，没有 getsize 调用，该断言在这里没有对象
            const leaked = got.some((f) => ((f.evidence ?? '') + (f.title ?? '')).includes('TOPSECRET'));
            const bad = got.filter((f) => f.status === FAIL || f.status === UNDETERMINED).map((f) => [f.status, f.id]).sort((a, b) => cmpCodepoint(a[0], b[0]) || cmpCodepoint(a[1], b[1]));
            const ok = !leaked && bad.some(([st, i]) => st === UNDETERMINED && i === `${NAME}/outside-repos/sys`) && bad.some(([st, i]) => st === UNDETERMINED && i.includes('app')) && !bad.some(([st]) => st === FAIL);
            results.push(probe(NAME, ok, '兄弟仓读到的文件须在该仓真实位置之内：入口符号链接出仓记未定不读；声明仓之外的引用记未定不探测', {
                evidence: `非通过项 ${pyRepr(bad.slice(0, 8).map((x) => [...x]))}；泄露=${pyBool(leaked)}`, why: 'D-123 裁定 1/2：repos[].path 豁免只豁免仓本身，不豁免从仓里经符号链接出去', // py-semantics-ok: 数组切元素个数
            }));
        });
        guard('第二跳', () => {
            // Python 靠替换 os.path.isfile 记录调用参数；ESM 的命名绑定不可改写，这里换成可观察的等价量：仓外目标「存在」与「不存在」两种情形下，输出必须逐字相同（探测了存在性就会不同）
            const run1 = (exists) => {
                const tmp = mk(), outside = mk();
                const cfg = sample(tmp, false);
                const secret = join(outside, 'x.md');
                if (exists)
                    writeText(secret, '系统仓 sys\n');
                writeText(join(tmp, 'app', 'AGENTS.md'), `# 应用仓\n\n见 [外](${relative(join(tmp, 'app'), secret).replaceAll('\\', '/')})。\n`);
                return run(cfg).filter((f) => f.title.includes('跳')).map((f) => [f.status, f.title + '|' + (f.evidence ?? '')]);
            };
            const a = run1(true), b = run1(false);
            results.push(probe(NAME, J(a) === J(b) && J(a.map((g) => g[0])) === J([FAIL]), '第二跳不跟随、不探测指向仓外的链接（入口两跳到不了系统仓照判 FAIL）', { evidence: `探测仓外 []；实得 ${pyRepr(a.map((x) => [x[0], x[1].split('|')[0]]))}`, why: '契约 §5：字面就在项目之外的路径连存在性也不探测' }));
        });
        guard('退役仓出仓', () => {
            const tmp = mk(), outside = mk();
            const cfg = sample(tmp, false);
            writeText(join(outside, 'TOPSECRET_NAME.md'), '# 现行规则\n');
            try {
                symlinkSync(outside, join(tmp, 'old', '.harness'));
            }
            catch {
                return;
            }
            const got = run(cfg).filter((f) => f.title.includes('退役仓 old'));
            const text = got.map((f) => `${f.title} ${f.reason} ${f.evidence}`).join(' ');
            results.push(probe(NAME, !text.includes('TOPSECRET_NAME') && J(got.map((f) => f.status)) === J([UNDETERMINED]) && text.includes('.harness/'), '退役仓规则位置是出仓软链接：只记一条未定（写条目名），不列仓外文件名、不报 PASS', {
                evidence: `实得 ${pyRepr(got.map((f) => [f.status, f.title]))}；泄露=${pyBool(text.includes('TOPSECRET_NAME'))}`, why: '契约 §5：只读被扫项目之内的文件，报错不回显仓外文件名；01 §2 N1 没读的不记通过',
            }));
        });
        { // 线性（D-123 安全 3）：`](` 连写 8000 次曾要跑几分钟，一个文件拖死整次检查与提交闸门
            let t0 = performance.now();
            linkTargets(']('.repeat(2000)); // 旧正则下约 4 秒
            const took = (performance.now() - t0) / 1000;
            t0 = performance.now();
            linkTargets('\n'.repeat(60000) + '[a\n'.repeat(20000)); // B2：旧 REF_LINK 下约 5 秒
            const tookRef = (performance.now() - t0) / 1000;
            const got = linkTargets('[a](x.md "t") [b](<y.md>) [c](../z.md#h)\n  [d]: w.md\n[e]:\n  <v.md>\n');
            results.push(probe(NAME, took < 1 && tookRef < 1 && J(got) === J(['x.md', 'y.md', '../z.md', 'w.md', 'v.md']), '链接抽取对 `](` 连写 2000 次、连续空行与无 `]` 的 `[` 行须线性，且照常认出带标题、尖括号与引用式的链接', {
                evidence: `耗时 ${took.toFixed(3)}s / ${tookRef.toFixed(3)}s；抽出 ${headChars(pyRepr(got), 200)}`, why: 'D-123 安全 3：检查器没有整体超时，一个平方级正则就能拖死提交闸门',
            }));
        }
    }
    catch (exc) {
        results.push(finding(NAME, FAIL, '自检自身出错', { evidence: `${excTypeName(exc)}: ${exc.message}`, why: '契约 §3：自检不过则本检查器结论作废' }));
    }
    finally {
        for (const t of tmps)
            rmSync(t, { recursive: true, force: true });
    }
    return results;
}
const pyBool = (b) => (b ? 'True' : 'False');
