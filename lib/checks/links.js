// git 跟踪的 markdown 里，本地链接与锚点是否可达。对应 tools/std/checks/check_links.py；契约见 tools/std/CONTRACT.md。
// 执行 01 §3.4「引用」关系的核对方式（linkcheck）与 §3.2 里 `docs/INDEX.md`「指向不存在的路径」这一条过期发现方式。
//
// 迁移约束：与 Python 版逐 id 相同（黄金样本）。这个文件是 Python 与 JS 正则语义差异最集中的地方，逐条对应（设计 §12.6）：
//   `\w`      → `[\p{L}\p{N}_]` 带 `u`（D5：Python 的 `\w` 恰是 Unicode 字母、数字、下划线；差异只在 Unicode 版本，9661 个未分配码点）
//   `\s`      → 显式 `PY_WHITESPACE` 字符类（D6）
//   `re.M ^`  → `(?<![^\n])`（D13）
//   `.lower()`→ JS 的 `toLowerCase` 与 Python 的 `str.lower()` 对 `İ` 都给出两个码点（`i̇`），一致
//   `unquote` → 自己实现（Python 的 `urllib.parse.unquote`：`%XX` 按 UTF-8 解码，非法序列用 U+FFFD 替换；`%` 后不是两个十六进制数字的原样保留）
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { cfgGet, pyStr } from '../core/cfg.js';
import { inFrozen } from '../core/docs.js';
import { FAIL, PASS, UNDETERMINED, PY_WHITESPACE, finding, pyStrip } from '../core/finding.js';
import { writeText } from '../core/fixture.js';
import { __testHooks, exists as pathExists, inside, isDir, readText } from '../core/fs.js';
import { excTypeName, probe, runGuarded, undeterminedFromException, unreadable } from '../core/shell.js';
import { trackedFiles } from '../core/tracked.js';
export const NAME = 'links';
export const STANDARD_REFS = ['01 §3.4 引用', '01 §3.2 docs/INDEX.md', '01 §3.8 跨仓引用按契约处理'];
const NL = '\n';
const WS = `[${PY_WHITESPACE}]`;
// [文字](路径) / [文字](路径#锚点) / ![alt](图片)；容许行尾 "title"。
// <> 包裹的目标可以含空格与圆括号（CommonMark），单独一支：第 1 组是它，第 2 组是裸写法
const LINK_RE = new RegExp('\\[(?:[^\\[\\]]|\\[[^\\[\\]]*\\])*\\]' +
    `\\(${WS}*(?:<([^<>\\n]+)>|([^()<>${PY_WHITESPACE}]+))(?:${WS}+"[^"]*"|${WS}+'[^']*')?${WS}*\\)`, 'g');
// 带协议的目标（http:、mailto:、javascript:、vscode: ……）都不是本地路径，一律跳过（RFC 3986 的 scheme 形状）。
// 至少两个字符：单字母加冒号是 Windows 盘符，归 WIN_ABS_RE。scheme 不含点、冒号后不是纯行号：
// `a.py:12`、`Makefile:3` 是「本地路径:行号」，按路径核（R2-9）；tel:、sms: 的值本就是纯数字，照跳过
//
// 三处与 Python 逐字相同的细节（样本与逐码点实测比出来的，不是我设计的）：
//   ① `re.I`（D11）：Python 在 `re.I` 下把 `İ`(U+0130)、`ı`(U+0131)、`ſ`(U+017F)、`K`(U+212A) 与 ASCII 字母等价（逐码点实测，只此四个），所以 `aı:b` 被当 scheme 跳过。
//      字符类 `[A-Za-z]` 与 `[A-Za-z0-9+-]` 里显式并上这四个；`tel`/`sms` 里只有 `s` 有等价的 `ſ`。
//   ② `\d`（D4）：Python 的 `\d` 认全角、阿拉伯等 Unicode 数字（`\p{Nd}`），所以 `ab:１` 的「冒号后是纯数字」判断成立 → 不当 scheme 跳过，按本地路径核。这里**不**用 `[0-9]`。
//   ③ `$`（无 `re.M`）：Python 的 `$` 也匹配**末尾换行之前**，所以 `a:1\n` 也算「纯行号」。JS 的 `$` 不带 `m` 时只匹配真正的末尾，补 `(?=\n?$)`。
const ND = '\\p{Nd}';
const FOLD_EXTRA = '\u0130\u0131\u017f\u212a'; // re.I 下与 ASCII 字母等价的非 ASCII 字符
const NUM_TAIL = `${ND}+(?::${ND}+)?(?=\\n?$)`;
const SKIP_SCHEME_RE = new RegExp(`^(?:(?:[Tt][Ee][Ll]|[Ss\u017f][Mm][Ss\u017f]):|[A-Za-z${FOLD_EXTRA}][A-Za-z0-9+${FOLD_EXTRA}-]+:(?!${NUM_TAIL}))`, 'u');
const LINE_SUFFIX_RE = new RegExp(`:${NUM_TAIL}`, 'u');
const WIN_ABS_RE = /^[A-Za-z]:[\\/]/;
/** 仅供测试：把几条模块私有的正则暴露出来，对 Python 样本逐条比对（它们是整份检查器里正则语义差异最集中的地方）。 */
export const _regexForTest = { LINK_RE, SKIP_SCHEME_RE, LINE_SUFFIX_RE, WIN_ABS_RE };
const MD_EXT = ['.md', '.markdown'];
const hasMdExt = (s) => MD_EXT.some((e) => s.toLowerCase().endsWith(e));
// 线性：不在正则里剥收尾的 `#`（原写法 `(.+?)[ \t]*#*[ \t]*$` 遇长空白行是平方级），交给 atxTitle
const HEADING_RE = /^(#{1,6})[ \t]+(.*)$/;
// Python 的 `re.I`（D11）：`a`、`i`、`d`、`n`、`m`、`e` 里只有 `i` 有非 ASCII 的等价字符（`İ`、`ı`）。`<a id|name = "…">` 的 `i` 要并上它们。
const EXPLICIT_ANCHOR_PY = new RegExp(`<[Aa]${WS}+(?:[Ii\u0130\u0131][Dd]|[Nn][Aa][Mm][Ee])${WS}*=${WS}*["']([^"']+)["']`, 'g');
const CJK_RE = /[^\x00-\x7f]/;
/** 把围栏代码块与行内代码涂白，行号与列位置不变。举例里的链接不算断链——本仓 docs/附录-载体实例/linkcheck.py 记下的真实教训（Case C-011）。 */
export function maskCode(text) {
    const blank = (m) => [...m].map((c) => (c === NL ? c : ' ')).join('');
    let t = text.replace(/```[\s\S]*?```/g, blank);
    t = t.replace(/~~~[\s\S]*?~~~/g, blank);
    t = t.replace(/`+[^`\n]*`+/g, blank);
    return t;
}
/**
 * GitHub 风格锚点：去内联标记与标点、小写、空格转连字符。
 * 非 ASCII 字符按 GitHub 的做法保留（Python 的 `\w` 含中日韩字符），但各平台对中文标题的处理并不一致——所以中文锚点匹配不上时判未定，不判断链。
 * `keepInnerUnderscore`：词中的下划线（`my_func`）GitHub 会保留，只有贴着词边界的才是强调标记；两种都算作可用锚点（anchorsOf），宁可少报不误报。
 */
export function slug(heading, keepInnerUnderscore = false) {
    let h = pyStrip(heading);
    // 三处字符类都排除自己的起始符，失败时只扫到下一个起始符：原写法遇满行 `[`、`<` 或长串 `_` 是平方级
    h = h.replace(/\[([^[\]]*)\]\([^()]*\)/g, '$1'); // 链接取其文字
    h = h.replace(/<[^<>]+>/g, ''); // 去内联 HTML
    if (keepInnerUnderscore) {
        h = h.replace(/(?<![\p{L}\p{N}_])_+|(?<!_)_+(?![\p{L}\p{N}_])/gu, '');
        h = h.replace(/[`*~]/g, '');
    }
    else {
        h = h.replace(/[`*_~]/g, ''); // 去强调标记
    }
    h = pyLower(h);
    h = h.replace(new RegExp(`[^\\p{L}\\p{N}_${PY_WHITESPACE}-]`, 'gu'), ''); // 去标点（含全角）
    h = pyStrip(h).replace(new RegExp(`${WS}+`, 'g'), '-');
    return h;
}
/** Python 的 `str.lower()`：与 JS 的 `toLowerCase()` 对 Unicode 全部码点一致（含 `İ` → `i̇`、`ẞ` → `ß`）；封装一处便于变异验证。 */
const pyLower = (s) => s.toLowerCase();
/** ATX 标题去掉可选的收尾 `#` 串（前面须有空白，或整行只有 `#`）与首尾空白。 */
export function atxTitle(raw) {
    let t = raw.replace(/[ \t]+$/, '');
    const body = t.replace(/#+$/, '');
    if (body !== t && (body === '' || body.endsWith(' ') || body.endsWith('\t')))
        t = body.replace(/[ \t]+$/, '');
    return pyStrip(t);
}
const SETEXT_RE = /^ {0,3}(?:=+|-+)[ \t]*$/;
/** 按出现顺序给出标题文字：ATX（`# x`）与 setext（下一行是 `===` / `---`）两种。入参是涂白后的文本。 */
export function titles(masked) {
    const out = [];
    let prev = '';
    for (const line of masked.split(NL)) {
        const m = HEADING_RE.exec(line);
        if (m) {
            out.push(atxTitle(m[2]));
            prev = '';
            continue;
        }
        if (pyStrip(prev) && SETEXT_RE.test(line) && !(prev.startsWith('    ') || prev.startsWith('\t'))) {
            out.push(pyStrip(prev));
            prev = '';
            continue;
        }
        prev = line;
    }
    return out;
}
/** 一份 markdown 里可用的锚点集合。masked：调用方已涂白的同一份文本，省一次涂白。 */
export function anchorsOf(text, masked) {
    const found = new Set();
    for (const m of text.matchAll(EXPLICIT_ANCHOR_PY))
        found.add(m[1]);
    const seen = new Map();
    for (const title of titles(masked ?? maskCode(text))) {
        for (const s of new Set([slug(title), slug(title, true)])) {
            if (!s)
                continue;
            const n = seen.get(s) ?? 0;
            found.add(n === 0 ? s : `${s}-${n}`);
            seen.set(s, n + 1);
        }
    }
    return found;
}
/**
 * Python 的 `urllib.parse.unquote(s)`（默认 `encoding='utf-8', errors='replace'`）：把 `%XX` 序列按 UTF-8 解码，
 * 非法的字节序列各替换成 U+FFFD；`%` 后不跟两个十六进制数字的原样保留；不处理 `+`。
 * 实现方式与 CPython 一致：把字符串里连续的 `%XX` 收成一段字节，一次按 UTF-8（replace）解码，其余字符原样。
 */
export function unquote(s) {
    if (!s.includes('%'))
        return s;
    const out = [];
    const hex = /[0-9A-Fa-f]/;
    let bytes = [];
    const flush = () => {
        if (bytes.length) {
            out.push(Buffer.from(bytes).toString('utf8'));
            bytes = [];
        }
    };
    for (let i = 0; i < s.length;) {
        const c = s[i];
        if (c === '%' && i + 2 < s.length && hex.test(s[i + 1]) && hex.test(s[i + 2])) {
            bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
            i += 3;
            continue;
        }
        flush();
        const cp = s.codePointAt(i);
        const ch = String.fromCodePoint(cp);
        out.push(ch);
        i += ch.length;
    }
    flush();
    return out.join('');
}
// ---------------------------------------------------------------------------------------------
// 目标文件读一次就够：几千份 markdown 上不能对每条链接重读一次文件。
// 扫描对象与链接目标共用这一份（C22）：扫过的对象再被链接时直接取锚点；还没扫到的对象先被当成目标读了，正文留在 pending 里，轮到扫它时取走，不读第二遍。
// ---------------------------------------------------------------------------------------------
class Cache {
    root;
    todo;
    pending = new Map();
    exists = new Map();
    isdir = new Map();
    anchors = new Map();
    errors = new Map();
    constructor(root, todo = []) {
        this.root = root;
        this.todo = new Set(todo); // 还没扫到的扫描对象（normalize 后）
    }
    pathKind(abspath) {
        const key = normalize(abspath);
        if (!this.exists.has(key)) {
            this.exists.set(key, pathExists(abspath));
            this.isdir.set(key, isDir(abspath));
        }
        return [this.exists.get(key), this.isdir.get(key)];
    }
    /** 返回 [锚点集合, 出错原因]。读不了时锚点为 null。 */
    anchorsOf(abspath) {
        const key = normalize(abspath);
        if (this.anchors.has(key))
            return [this.anchors.get(key), this.errors.get(key) ?? null];
        let text;
        try {
            text = readText(abspath, this.root);
        }
        catch (exc) {
            this.anchors.set(key, null);
            const reason = `${excTypeName(exc)}: ${exc.message}`;
            this.errors.set(key, reason);
            return [null, reason];
        }
        this.anchors.set(key, anchorsOf(text));
        if (this.todo.has(key))
            this.pending.set(key, text);
        return [this.anchors.get(key), null];
    }
    /** 取一份扫描对象的正文：先当过目标的从 pending 取走，否则读盘。 */
    sourceText(abspath) {
        const key = normalize(abspath);
        this.todo.delete(key);
        const text = this.pending.get(key);
        this.pending.delete(key);
        return text === undefined ? readText(abspath, this.root) : text;
    }
}
/**
 * git 跟踪的 markdown。返回 [相对路径列表, 问题]。
 * `_links_files` 是给 selftest 用的注入口：自检不该去动任何 git 索引（契约 §3 要求自检用最小样本，不碰真实仓库）。除自检外没人设它。
 */
function markdownFiles(cfg) {
    const override = cfg._links_files;
    if (override !== undefined && override !== null)
        return [override.map((x) => pyStr(x).replaceAll('\\', '/')), null];
    const root = cfg._root || '.';
    const [files, problem] = trackedFiles(root, ['*.md', '*.markdown']);
    if (problem)
        return [null, problem];
    return [files.filter(hasMdExt), null];
}
// --------------------------------------------------------------------------
export function scope(cfg) {
    const fr = cfgGet(cfg, 'layout.frozen', []);
    const frozen = Array.isArray(fr) ? fr : [];
    return {
        covered: [
            'git 跟踪的 *.md / *.markdown 里 [文字](路径) 形式的本地链接：目标文件或目录存在性',
            '目标是 markdown 时，链接里的 #锚点 是否匹配它的 <a id>/<a name> 或标题生成的锚点',
            `归档区（layout.frozen：${frozen.map(pyStr).join('、') || '未配置'}）里的文件同样检查，断链就是断链；报出时在证据里注明它在归档区`,
        ],
        not_covered: [
            '不检查外链可达性：联网结果不可重复（契约 §7；04 §6.2）',
            '不检查图片内容，只检查图片文件在不在',
            '不检查跨仓库路径的另一侧——那归 check_cross_repo（01 §3.8）',
            '不检查 HTML 里的链接（<a href=…>、<img src=…>）',
            '围栏代码块与行内代码里的链接被涂白，不算数',
            '不解析引用式链接 [文字][标签] 与裸 URL',
            '不带 <> 包裹而路径里有圆括号的链接、跨行书写的链接匹配不到，因而不计入',
            '不检查未被 git 跟踪的 markdown（未提交或被 .gitignore 排除的看不见）',
            '不判断锚点指的片段外延到哪（该问题见 templates/文件树与落地路径.md §7 第 5 条）',
        ],
    };
}
export function run(cfg) {
    return runGuarded(NAME, doRun, cfg);
}
function doRun(cfg) {
    const root = cfg._root || '.';
    const [files, problem] = markdownFiles(cfg);
    if (problem) {
        return [finding(NAME, UNDETERMINED, '列不出 git 跟踪的 markdown', {
                reason: problem, why: '01 §3.4：引用关系靠 linkcheck 核对；列不出对象就没有执行过这项检查',
            })];
    }
    if (!files || files.length === 0) {
        return [finding(NAME, UNDETERMINED, '没有找到任何 git 跟踪的 markdown', {
                reason: '采集为空。空输出最常见的原因是采集根本没跑起来（templates/文件树与落地路径.md §7 第 4 条），一律记未定',
                why: '契约 §1：适用却没执行的检查记未定，不记通过',
            })];
    }
    const cache = new Cache(root, files.map((r) => normalize(join(root, ...r.split('/')))));
    const out = [];
    const merged = new Map(); // Finding id -> [finding, [行号…], 原始 evidence]
    let nLinks = 0;
    let nBad = 0;
    for (const rel of files) {
        const absSrc = join(root, ...rel.split('/'));
        let text;
        try {
            text = cache.sourceText(absSrc);
        }
        catch (exc) {
            out.push(unreadable(NAME, rel, exc)); // 对象读不了，不是检查器故障（R1-10）
            continue;
        }
        const frozenNote = inFrozen(cfg, rel) ? '该文件在 layout.frozen 归档区，断链照报，是否修由人定' : '';
        const masked = maskCode(text);
        const srcAnchors = anchorsOf(text, masked);
        cache.anchors.set(normalize(absSrc), srcAnchors);
        const lines = masked.split(NL);
        for (let li = 0; li < lines.length; li++) {
            const lineno = li + 1;
            const line = lines[li];
            if (!line.includes(']('))
                continue;
            for (const m of line.matchAll(LINK_RE)) {
                const target = pyStrip(m[1] ?? m[2] ?? '');
                if (!target || SKIP_SCHEME_RE.test(target) || target.startsWith('//'))
                    continue;
                nLinks++;
                const where = `${rel}:${lineno}`;
                if (WIN_ABS_RE.test(target)) {
                    nBad++;
                    mergeFinding(out, merged, lineno, finding(NAME, UNDETERMINED, `${rel} 里是本机绝对路径：${target}`, {
                        where, kind: 'host-abs', key: `${rel}|${target}`,
                        reason: '绝对路径换一台机器就不成立，本工具不按当前机器的存在性下结论',
                        why: '01 §3.4 引用：B 链接 A 且可机械核对；本机绝对路径不可机械核对',
                        evidence: frozenNote,
                    }));
                    continue;
                }
                const hashAt = target.indexOf('#');
                let pathPart = hashAt < 0 ? target : target.slice(0, hashAt);
                let anchor = hashAt < 0 ? '' : target.slice(hashAt + 1);
                const qAt = pathPart.indexOf('?');
                pathPart = unquote(qAt < 0 ? pathPart : pathPart.slice(0, qAt)); // ?plain=1 之类是查询串，不是文件名的一部分
                pathPart = pathPart.replace(LINE_SUFFIX_RE, ''); // `文件:行号` 只核文件（R2-9）
                if (!pathPart && !anchor)
                    continue; // 只有查询串：指向本页，没什么可核
                anchor = unquote(anchor);
                // 纯锚点：指向本文件
                if (!pathPart) {
                    if (srcAnchors.has(anchor))
                        continue;
                    nBad++;
                    mergeFinding(out, merged, lineno, anchorMiss(rel, where, target, anchor, rel, frozenNote));
                    continue;
                }
                let rootAbs = false;
                let absTgt;
                if (pathPart.startsWith('/')) {
                    // 仓库根路径：GitHub 按仓根解析，别的渲染器按站点根或主机根——本工具按仓根核，核不到只记未定（契约 §1.1：解析方式是约定）
                    absTgt = normalize(join(root, ...pathPart.replace(/^\/+/, '').split('/')));
                    rootAbs = true;
                }
                else {
                    absTgt = normalize(join(dirname(absSrc), ...pathPart.split('/')));
                }
                if (!inside(root, absTgt)) {
                    nBad++;
                    mergeFinding(out, merged, lineno, finding(NAME, UNDETERMINED, `${rel} 的链接指向被扫项目之外：${target}`, {
                        where, kind: 'outside-root', key: `${rel}|${target}`,
                        reason: '目标的真实位置不在被扫项目之内；本工具不读、不探测项目之外的路径，它在另一台机器上是否存在也不由本仓决定',
                        why: '01 §3.4 引用：B 链接 A 且可机械核对；项目之外的目标不在本次核对范围',
                        evidence: frozenNote,
                    }));
                    continue;
                }
                if (rootAbs && !cache.pathKind(absTgt)[0]) { // 先过 inside，再探测存在性
                    nBad++;
                    mergeFinding(out, merged, lineno, finding(NAME, UNDETERMINED, `${rel} 的仓根路径链接按仓根找不到：${target}`, {
                        where, kind: 'root-abs', key: `${rel}|${target}`,
                        reason: '以 / 开头的链接各平台解析不一（GitHub 按仓根、静态站按站点根、本地按主机根），按仓根没找到推不出断链',
                        why: '01 §3.4 引用：B 链接 A 且可机械核对',
                        evidence: frozenNote,
                    }));
                    continue;
                }
                const [exists, isdir] = cache.pathKind(absTgt);
                if (!exists) {
                    nBad++;
                    mergeFinding(out, merged, lineno, finding(NAME, FAIL, `${rel} 指向不存在的路径：${target}`, {
                        where, kind: 'missing', key: `${rel}|${target}`,
                        why: '01 §3.4 引用关系的核对方式就是 linkcheck；01 §3.2 里 INDEX 过期的发现方式是「指向不存在的路径」',
                        evidence: `解析为 ${absTgt}；${frozenNote || '不在归档区'}`,
                    }));
                    continue;
                }
                if (!anchor)
                    continue;
                if (isdir || !hasMdExt(pathPart))
                    continue; // 目录 / 图片 / 非 markdown：只检查存在性（判据第 4 条）
                const [tgtAnchors, err] = cache.anchorsOf(absTgt);
                if (tgtAnchors === null) {
                    nBad++;
                    mergeFinding(out, merged, lineno, finding(NAME, UNDETERMINED, `读不了 ${pathPart}，锚点 ${target} 判不了`, {
                        where, kind: 'anchor-unreadable', key: `${rel}|${target}`,
                        reason: err || '目标文件读取失败', why: '01 §3.4：引用要可机械核对；读不了就是没核对过',
                    }));
                    continue;
                }
                if (tgtAnchors.has(anchor))
                    continue;
                nBad++;
                mergeFinding(out, merged, lineno, anchorMiss(rel, where, target, anchor, pathPart, frozenNote));
            }
        }
    }
    out.push(finding(NAME, PASS, `扫了 ${files.length} 份 markdown、${nLinks} 条本地链接，${nBad} 条有问题`, {
        evidence: '对象来自 git ls-files；覆盖边界见 scope()。本条只说明检查确实跑起来了，问题逐条另列。',
        why: '01 §3.4 引用：linkcheck 是这条关系的核对方式',
    }));
    return out;
}
const linesNote = (base, lines) => {
    const note = `出现在第 ${lines.join('、')} 行（共 ${lines.length} 处）`;
    return base ? `${base}；${note}` : note;
};
/**
 * 按 Finding id 合并（各条都带 `kind`）：同一份文件里同一个链接目标只出一条。
 * id 是 `links/<kind>/<文件>｜<目标>`，同一 (文件, 目标) 重复出现只是同一件事被写了多遍——出成多条会让登记册要为同一件事写多行，行号一改登记就失效。行号进 evidence。
 */
function mergeFinding(out, merged, lineno, f) {
    const hit = merged.get(f.id);
    if (hit === undefined) {
        const base = f.evidence || '';
        f.evidence = linesNote(base, [lineno]);
        merged.set(f.id, [f, [lineno], base]);
        out.push(f);
        return;
    }
    const [prev, lines, base] = hit;
    lines.push(lineno);
    prev.evidence = linesNote(base, lines);
}
// --------------------------------------------------------------------------
// 自检：反例与正例各一，外加合并与 id、约定、查询串与协议、C22 只读一遍、R2-9 文件:行号、安全与线性。见契约 §3。
// 用注入的文件清单，不动任何 git 索引，也不碰真实仓库。
// --------------------------------------------------------------------------
export function selftest() {
    const results = [];
    const tmps = [];
    const mk = (prefix = 'lnself-') => { const t = mkdtempSync(join(tmpdir(), prefix)); tmps.push(t); return t; };
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const J = (v) => JSON.stringify(v);
    try {
        const tmp = mk();
        const w = (name, body) => writeText(join(tmp, ...name.split('/')), body);
        w('b.md', '# Hello World\n\n<a id="pin"></a>\n\n正文。\n');
        w('a.md', '# A\n\n见 [b](b.md)、[节](b.md#hello-world)、[锚](b.md#pin)。\n');
        const cfg = { _root: tmp, _links_files: ['a.md', 'b.md'] };
        const gotOk = run(cfg).map((f) => f.status);
        w('a.md', '# A\n\n见 [b](b.md)。\n\n坏的一条：[没有这个文件](missing.md)。\n');
        const gotBad = run(cfg).map((f) => f.status);
        results.push(probe(NAME, gotBad.includes(FAIL), '反例：指向不存在的 missing.md 应判 FAIL', { evidence: `实得 ${J(gotBad)}`, why: '契约 §3 静默失效探测；判据 01 §3.4 引用' }));
        results.push(probe(NAME, gotOk.length > 0 && new Set(gotOk).size === 1 && gotOk[0] === PASS, '正例：文件与两个锚点都在，应全判 PASS', { evidence: `实得 ${J(gotOk)}`, why: '契约 §3 静默失效探测' }));
        // 反例二（合并与 id，契约 §9）：同一份文件里同一个中文锚点目标写三次，只出一条未定，行号进证据，id 里带源文件名。
        // 出成三条的话，例外登记就要为同一件事写三行，而且行号一改登记全失效。
        w('b.md', '# 标题\n\n正文。\n');
        w('a.md', '# A\n\n见 [一](b.md#没有这个锚)。\n\n又见 [二](b.md#没有这个锚)。\n\n再见 [三](b.md#没有这个锚)。\n');
        {
            const cjk = run(cfg).filter((f) => (f.id || '').startsWith('links/anchor-cjk/'));
            const ok = cjk.length === 1 && cjk[0].id.startsWith('links/anchor-cjk/a.md｜') && (cjk[0].where ?? '') === 'a.md:3' && (cjk[0].evidence ?? '').includes('3、5、7');
            results.push(probe(NAME, ok, '反例二：同一份文件里同一个链接目标重复出现，应合并成一条、行号进证据、id 带源文件', {
                evidence: `中文锚点条数 ${cjk.length}；id=${cjk.length ? cjk[0].id : '（无）'}；where=${cjk.length ? cjk[0].where : '（无）'}；证据=${cjk.length ? J((cjk[0].evidence ?? '').slice(0, 120)) : '（无）'}`,
                why: '契约 §9：登记行写的是 id，同一件事出成多条会逼着登记也写多行',
            }));
        }
        // 反例四（约定，D-123）：词中下划线锚点、setext 标题锚点、仓根 / 路径、<> 包裹含空格的路径都按实际渲染认；
        // 仓根路径找不到只记未定（解析方式是约定），<> 里的缺文件照判 FAIL
        mkdirSync(join(tmp, 'sub'), { recursive: true });
        w('b.md', '# my_func\n\nSetext 标题行\nSetext Title\n===\n');
        w('my file.md', '# x\n');
        w('sub/a.md', '[1](../b.md#my_func) [2](../b.md#setext-title) [3](/b.md) [4](</my file.md>) [5](<../my file.md>) [6](/nope.md) [7](<../no such.md>)\n');
        {
            const res = run({ _root: tmp, _links_files: ['sub/a.md', 'b.md', 'my file.md'] });
            const bad = res.filter((f) => f.status !== PASS).map((f) => [f.status, f.title.includes('：') ? f.title.slice(f.title.indexOf('：') + 1) : f.title]).sort(cmpPair);
            const want = [[FAIL, '<../no such.md>'], [UNDETERMINED, '/nope.md']];
            const norm = (xs) => xs.map(([st, t]) => [st, t.replace(/^<|>$/g, '').replaceAll('../', '')]);
            results.push(probe(NAME, eq(norm(bad), norm(want)), '反例四：下划线锚点、setext 锚点、仓根路径、<> 包裹路径按实际渲染认；仓根找不到记未定', {
                evidence: `非通过项 ${J(bad)}；应得 ${J(want)}`, why: '契约 §1.1：约定落空只记未定；01 §3.4 引用核对不得误报',
            }));
        }
        // 反例五（C19 C20）：同一缺失文件、同一 ASCII 缺失锚点各写两遍，各只出一条 FAIL、id 带 kind；
        // ?plain=1 是查询串（b.md 在），javascript:/vscode: 之类带协议的不是本地路径
        w('b.md', '# b\n');
        w('a.md', '[x](gone.md)\n[y](gone.md)\n[z](b.md#nope)\n[z](b.md#nope)\n[q](b.md?plain=1) [v](vscode:extension/x) [n](news:comp.lang) [t](tel:10086) [s](sms:10086)\n');
        {
            const got = run(cfg).filter((f) => f.status !== PASS).map((f) => [f.status, f.id]).sort(cmpPair);
            const want = [[FAIL, 'links/anchor-missing/a.md｜b.md#nope'], [FAIL, 'links/missing/a.md｜gone.md']];
            results.push(probe(NAME, eq(got, want), '反例五：同一缺失目标只出一条 FAIL、id 不随行号漂；查询串与带协议的目标不当本地路径', {
                evidence: `非通过项 ${J(got)}；应得 ${J(want)}`, why: '契约 §4/§9：id 是登记的地址；01 §3.4 引用核对不得误报',
            }));
        }
        // C22：互相链接的两份 markdown 各只读一遍（旧写法作为链接目标时再读一遍）
        w('a.md', '# A\n\n[b](b.md#b)\n');
        w('b.md', '# B\n\n[a](a.md#a)\n');
        {
            // 读次数：`__testHooks.opened` 在每次真正 open 时加一（与 openSync 在同一表达式里），前后差即本次扫描读了几次
            const before = __testHooks.opened;
            const got = run({ _root: tmp, _links_files: ['a.md', 'b.md'] }).map((f) => f.status);
            const nReads = __testHooks.opened - before;
            results.push(probe(NAME, eq(got, [PASS]) && nReads === 2, 'C22：互相链接的两份 markdown 各只读一遍', {
                evidence: `实得 ${J(got)}；读 ${nReads} 次`, why: '一次扫描里同一份文件不重复 I/O',
            }));
        }
        // R2-9：`文件:行号` 按本地路径核（文件在则通过、不在判断链），只有查询串的链接不核
        w('x.py', 'print(1)\n');
        w('a.md', '[t](x.py:12) [m](x.py:3:5) [g](gone.py:10) [q](?plain=1)\n');
        {
            const got = run({ _root: tmp, _links_files: ['a.md'] }).filter((f) => f.status !== PASS).map((f) => [f.status, f.id]).sort(cmpPair);
            const want = [[FAIL, 'links/missing/a.md｜gone.py:10']];
            results.push(probe(NAME, eq(got, want), 'R2-9：文件:行号 按本地路径核，只有查询串的链接不当锚点', { evidence: `非通过项 ${J(got)}；应得 ${J(want)}`, why: '01 §3.4 引用核对不得漏报也不得误报' }));
        }
        // 反例三（安全，D-123）：指向项目之外的链接与经符号链接出仓的 markdown 不读、不判断链，记未定；标题行里一长串空白不许把锚点计算拖成平方级
        {
            const outside = mk('lnself-out-');
            writeText(join(outside, 'secret.md'), '# TOPSECRET\n');
            symlinkSync(join(outside, 'secret.md'), join(tmp, 'c.md'), 'file');
            w('a.md', '# A\n\n[外](../x/secret.md) [链](c.md#topsecret) [长](b.md#a-x)\n');
            w('b.md', '# a' + ' '.repeat(3000) + 'x\n'); // 旧正则下这一行约 12 秒
            // 满行 `[`、`<`、长串词中 `_` 的标题：旧 _slug 下 4 万字符分别约 6.7、1.1、10.4 秒（C03）
            w('d.md', '# ' + '['.repeat(40000) + '\n# ' + '<'.repeat(40000) + '\n# a' + '_'.repeat(40000) + 'b\n');
            w('a.md', '# A\n\n[外](../x/secret.md) [链](c.md#topsecret) [长](b.md#a-x) [根](/../x/y.md) [满](d.md#ab)\n');
            const cfg3 = { _root: tmp, _links_files: ['a.md', 'b.md', 'c.md', 'd.md'] };
            const t0 = Date.now();
            const res = run(cfg3);
            const took = (Date.now() - t0) / 1000;
            const kinds = [...new Set(res.filter((f) => f.status !== PASS).map((f) => f.id.split('/')[1]))].sort(cmpCp);
            const leaked = res.some((f) => ((f.evidence ?? '') + (f.title ?? '')).includes('TOPSECRET'));
            const ok = !res.some((f) => f.status === FAIL) && kinds.includes('outside-root') && !leaked && took < 5;
            results.push(probe(NAME, ok, '反例三：项目之外的链接目标与出仓符号链接记未定、不读内容；长空白、满行 [ / < / _ 的标题线性', {
                evidence: `非通过项 kind=${J(kinds)}；泄露内容=${leaked}；耗时 ${took.toFixed(2)}s`, why: 'D-123 安全 2／3：不读项目之外的文件；一个文件不许拖死整次检查',
            }));
        }
    }
    catch (exc) {
        results.push(undeterminedFromException(NAME, exc, '跑自检'));
    }
    finally {
        for (const t of tmps)
            rmSync(t, { recursive: true, force: true });
    }
    return results;
}
const cmpCp = (a, b) => {
    const x = [...a], y = [...b];
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
        const d = x[i].codePointAt(0) - y[i].codePointAt(0);
        if (d)
            return d;
    }
    return x.length - y.length;
};
const cmpPair = (a, b) => cmpCp(a[0], b[0]) || cmpCp(a[1], b[1]);
/** Python 的 `%r % anchor`（anchor 是 str）。 */
const pyReprStr = (s) => (s.includes("'") && !s.includes('"') ? `"${s}"` : `'${s.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`);
/** 锚点没匹配上。中文锚点判未定，ASCII 锚点判 FAIL。 */
function anchorMiss(srcRel, where, target, anchor, tgtRel, frozenNote) {
    if (CJK_RE.test(anchor)) {
        return finding(NAME, UNDETERMINED, `${srcRel} 的锚点 ${target} 没匹配上（中文锚点）`, {
            where, kind: 'anchor-cjk', key: `${srcRel}|${target}`,
            reason: '中文标题生成锚点的规则各平台不一致（GitHub、GitLab、静态站生成器各一套），匹配不上不能断定是断链，是平台差异；本工具不猜哪一套',
            why: '01 §3.4 引用：核对方式是 linkcheck，但判不了的按契约 §1 记未定不记通过',
            evidence: `目标 ${tgtRel}；本工具算出的锚点集合里没有 ${pyReprStr(anchor)}。${frozenNote}`,
        });
    }
    return finding(NAME, FAIL, `${srcRel} 的锚点不存在：${target}`, {
        where, kind: 'anchor-missing', key: `${srcRel}|${target}`,
        why: '01 §3.4 引用：B 链接 A 不复制 A，靠 linkcheck 核对；锚点失效即引用失效',
        evidence: `目标 ${tgtRel} 里既无 <a id="${anchor}">，也没有能生成该锚点的标题。${frozenNote}`,
    });
}
