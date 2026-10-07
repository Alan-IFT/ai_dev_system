// 完成声明的证据六字段。对应 tools/std/checks/check_evidence.py；契约见 tools/std/CONTRACT.md。
// 执行 01 §1 G4（完成需要证据）与 01 §4.2 收工前第 1 条。§4.2 的六字段原文是：
// ① 断言（具体说了什么）② 原始证据（命令 + 完整输出，或 CI 链接；不许只写结论）③ 版本与工作区身份 ④ 适用范围 ⑤ 观察时间 ⑥ 确认方法。**缺一项声明无效。**
//
// 迁移约束：与 Python 版逐 id 相同（黄金样本）。动笔前对每个 Python 字符串、正则、容器操作都问过「JS 里对应的在非 ASCII、非 BMP、边界值上等价吗」并在 Python 上实测（设计 §12.22）：
//   `\s` / `strip` / `lstrip`      → 显式 `PY_WHITESPACE` / `pyStrip` / `pyLstrip`（D6）
//   `\d`（行内标签的前导、条目编号）→ `\p{Nd}`（D4/D5：Python 的 `\d` 是 Unicode 十进制数字；版本差只来自 Unicode 15.0 与 17.0，见设计 §12.27）
//   `str.isdigit()`                → `isPyDigit`：`\p{Nd}` 再并上 Python 认的 128 个「数字但不是 Nd」的码点（上标、带圈数字等），逐码点与 Python 比过
//   `re.I`                         → `foldRegexSource` + `iu`（D11：只有 `İ`、`ı` 要显式并上）
//   `(.*)$` / `.+$`                → `([^\n]*)(?=\n?$)`：Python 的 `.` 只不匹配 `\n`、`$` 还匹配末尾 `\n` 之前；JS 的 `.` 还不匹配 `\r`、U+2028/9
//   `splitlines()`                 → `splitLinesPy`
//   `re.escape(fence[0])`          → 围栏字符只会是 `` ` `` 或 `~`，二者 Python 都不转义
import { mkdtempSync, rmSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stateList } from '../core/cfg.js';
import { clean, foldRegexSource, inFrozen, isTailoredOut, itemStatus, statusKind, workRoot } from '../core/docs.js';
import { FAIL, PASS, PY_WHITESPACE, SKIP, UNDETERMINED, finding, pyLstrip, pyStrip } from '../core/finding.js';
import { gitTrack, writeText } from '../core/fixture.js';
import { readText } from '../core/fs.js';
import { pyRepr } from '../core/repr.js';
import { agg, probe, runGuarded, unreadable, workRootAbsent } from '../core/shell.js';
import { workItems } from '../core/tracked.js';
import { splitLinesPy } from '../core/yaml.js';
export const NAME = 'evidence';
export const STANDARD_REFS = ['01 §1 G4', '01 §2 N1', '01 §3.1', '01 §4.1', '01 §4.2'];
// 状态字段词表已并进 core/docs 的 STATUS_FIELDS（01 §1 G2：同一事实一处权威）。
// 证据段的标题词（大小写不敏感）。这是工具约定（契约 §1.1）：认不出证据段只记未定，不判 FAIL。
const EVIDENCE_HEADINGS = ['证据', 'evidence'];
/** 六字段。顺序即匹配优先级：同一行命中多个时取靠前的那个。 */
export const FIELDS = [
    ['assertion', '① 断言', ['断言', 'assertion', 'claim', '主张', 'acceptance']],
    ['raw', '② 原始证据', ['原始证据', 'raw_evidence', 'raw evidence', 'evidence', 'artifact', '证据', '输出']],
    ['identity', '③ 版本与工作区身份', ['版本与工作区身份', '工作区身份', '版本', 'revision', 'head', 'commit', 'version', 'workspace', '分支']],
    ['scope', '④ 适用范围', ['适用范围', '限制', 'limitations', 'limitation', '范围', 'scope', 'environment', '环境', 'env']],
    ['observed', '⑤ 观察时间', ['观察时间', 'observed_at', 'observed at', '时间', 'time', '时刻']],
    ['method', '⑥ 确认方法', ['确认方法', '确认方式', '方法', 'procedure', 'checker', 'method']],
];
const LABELS = Object.fromEntries(FIELDS.map(([k, label]) => [k, label]));
const ORDER = FIELDS.map(([k]) => k);
/** 表头到字段的映射比行内标签更严：ID 列不算字段。顺序即优先级。 */
const HEADER_MAP = [
    ['acceptance', 'assertion'], ['断言', 'assertion'], ['主张', 'assertion'], ['assertion', 'assertion'], ['claim', 'assertion'],
    ['artifact', 'raw'], ['原始证据', 'raw'], ['raw', 'raw'], ['evidence', 'raw'], ['证据', 'raw'], ['输出', 'raw'],
    ['revision', 'identity'], ['head', 'identity'], ['version', 'identity'], ['版本', 'identity'], ['commit', 'identity'], ['工作区', 'identity'], ['分支', 'identity'],
    ['limitation', 'scope'], ['限制', 'scope'], ['适用范围', 'scope'], ['环境', 'scope'], ['environment', 'scope'], ['scope', 'scope'], ['范围', 'scope'],
    ['observed', 'observed'], ['观察时间', 'observed'], ['时间', 'observed'], ['time', 'observed'], ['date', 'observed'],
    ['procedure', 'method'], ['checker', 'method'], ['确认', 'method'], ['方法', 'method'], ['method', 'method'],
];
const LIMIT_WORDS = ['限制', 'limitation'];
const PLACEHOLDERS = new Set(['', 'tbd', 'todo', '待补', '待填', '待定', '待确认', 'na', 'n/a', 'n.a.', '-', '--', '—', '——', '?', '？', '...', '。', 'xxx', '略']);
const NOTE_WORDS = new Set(['注意', '备注', '说明', '注', '附注', '提示', 'note', 'notes', 'ps', 'tip', 'todo', 'warning']);
const WS = `[${PY_WHITESPACE}]`;
const NWS = `[^${PY_WHITESPACE}]`;
/** Python 的 `(.*)$`、`.+$`：值取到行尾（行里没有 `\n`，`splitlines` 之后不会有）。见文件头的说明。 */
const TO_EOL = '(?=\\n?$)';
// --------------------------------------------------------------------------
// Python `str.isdigit()`
// --------------------------------------------------------------------------
/**
 * Python 的 `str.isdigit()` 为真、但 Unicode 类别不是 Nd 的码点（上标、下标、带圈数字、各文字的「数字」而非「十进制数字」），Python 3.12（Unicode 15.0）实测，共 128 个。
 * `isdigit` = 类别 Nd ∪ 这一批。TS 用 `\p{Nd}`（Node 24，Unicode 17.0）再并上它：Nd 里 Unicode 16、17 新增的码点 Python 里仍是未分配，这是版本差，不是写法差（同 D5）；
 * 逐码点核对见 test/evidence-pure.test.mjs：Python 为真的 TS 一律为真，TS 多出来的全是 Python 视作未分配的码点。
 */
const DIGIT_EXTRA = '\\u{b2}\\u{b3}\\u{b9}\\u{1369}-\\u{1371}\\u{19da}\\u{2070}\\u{2074}-\\u{2079}\\u{2080}-\\u{2089}\\u{2460}-\\u{2468}\\u{2474}-\\u{247c}\\u{2488}-\\u{2490}\\u{24ea}\\u{24f5}-\\u{24fd}\\u{24ff}' +
    '\\u{2776}-\\u{277e}\\u{2780}-\\u{2788}\\u{278a}-\\u{2792}\\u{10a40}-\\u{10a43}\\u{10e60}-\\u{10e68}\\u{11052}-\\u{1105a}\\u{1f100}-\\u{1f10a}';
const ALL_DIGITS = new RegExp(`^[\\p{Nd}${DIGIT_EXTRA}]+$`, 'u');
export function isPyDigit(s) {
    return ALL_DIGITS.test(s);
}
// --------------------------------------------------------------------------
// 小工具
// --------------------------------------------------------------------------
export function isPlaceholder(value) {
    const v = clean(value).toLowerCase().replaceAll(' ', '').replaceAll('　', '');
    return PLACEHOLDERS.has(v);
}
// --------------------------------------------------------------------------
// 证据段解析
// --------------------------------------------------------------------------
const FENCE = new RegExp(`^${WS}*(\`{3,}|~{3,})`);
/** 闭合行：同一种字符、不短于开栏、后面只有空白（CommonMark；R2-12）。围栏字符只会是 ` 或 ~，Python 的 re.escape 都不转义。 */
const fenceClose = (fence) => new RegExp(`^${WS}*${fence[0]}{${[...fence].length},}${WS}*$`);
/**
 * 返回 [标题, 起始行号(1-based), [行]]，标题含「证据」的小节。
 *
 * 围栏代码块里的行不算标题、也不进小节（C06）：代码里的 `# 注释` 会截断证据段，命令输出里的 `time: 3s` 会被认成字段。比证据段标题低一级以上的小标题（`### E-01`）
 * 留在段内，由 parseListBlocks 当条目头（C13）；同级或更高一级的标题才结束这一段。
 */
export function evidenceSections(text) {
    const lines = splitLinesPy(text);
    const out = [];
    let cur = null;
    let fence = null;
    let level = 0;
    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        const m = FENCE.exec(ln);
        if (fence === null && m) {
            fence = m[1];
            continue;
        }
        if (fence !== null) {
            if (fenceClose(fence).test(ln))
                fence = null;
            continue;
        }
        const s = pyLstrip(ln);
        if (s.startsWith('#')) {
            const title = s.replace(/^#+/, ''); // `lstrip("#")`：只去开头的 #
            const depth = s.length - title.length; // 开头 # 的个数（都在 BMP，码元数与码点数相同）
            if (cur !== null && depth > level) {
                cur[2].push([i + 1, ln]);
                continue;
            }
            if (cur !== null) {
                out.push(cur);
                cur = null;
            }
            const t = pyStrip(title);
            if (EVIDENCE_HEADINGS.some((k) => t.toLowerCase().includes(k))) {
                cur = [t, i + 2, []];
                level = depth;
            }
            continue;
        }
        if (cur !== null)
            cur[2].push([i + 1, ln]);
    }
    if (cur !== null)
        out.push(cur);
    return out;
}
const BLOCK_HEAD = new RegExp(`^${WS}*(?:[-*+]${WS}*)?\\*\\*([^*]+)\\*\\*`);
const SUBHEAD = new RegExp(`^${WS}*#{3,6}${WS}+(.+?)${TO_EOL}`); // `.+$`：值取到行尾。非贪婪 + 前瞻 = 贪婪到行尾，写成这样只为让 `${TO_EOL}` 紧跟在后
// 形如「标签: 值」的行（可带列表记号或编号）。labelField 不认的这种行算「认不出的字段」（R2-1）。
// 认不出的「标签: 值」行：标签不含空白与斜杠、不超过 12 字（按码点）、非纯数字（时刻）、冒号后不紧跟 //（URL）；注意、备注之类说明词不算标签（R2-1 第二轮收窄）
const LABEL_LINE = new RegExp(`^${WS}*(?:[-*+]${WS}+|\\p{Nd}+[.、)）]${WS}*)?[*_\`]{0,2}(?<l>[^${PY_WHITESPACE}:：|/*_\`]{1,12})[*_\`]{0,2}[:：](?!//)${WS}*${NWS}`, 'u');
export function unknownLabel(ln) {
    const m = LABEL_LINE.exec(ln);
    if (!m)
        return false;
    const l = m.groups['l'];
    return !isPyDigit(l) && !NOTE_WORDS.has(l.toLowerCase());
}
/** 每个同义词一条正则，按 FIELDS 的顺序平铺：同一行命中多个时取靠前的那个（取该同义词在行里**第一次**出现的位置）。 */
const FIELD_RES = [];
for (const [key, , syns] of FIELDS) {
    for (const syn of syns) {
        FIELD_RES.push([key, new RegExp(`(?:^|[${PY_WHITESPACE}　|*>()（）.、\\p{Nd}])${foldRegexSource(syn)}${WS}*[:：]${WS}*([^\\n]*)${TO_EOL}`, 'iu')]);
    }
}
/** 行内标签 → [字段键, 值]。不是字段行返回 [null, null]。 */
export function labelField(line) {
    for (const [key, re] of FIELD_RES) {
        const m = re.exec(line);
        if (m)
            return [key, pyStrip(m[1])];
    }
    return [null, null];
}
const hasLimitWord = (s) => LIMIT_WORDS.some((w) => s.includes(w));
/**
 * 加粗条目行（或三级以上小标题）起头的证据条目。
 *
 * 表格行归 parseTableBlocks，这里不看（C08：表格格子里的「输出: …」曾被认成字段，凭空多出一条「（整段）」证据判 FAIL）。whole=false 时不把整段兜成一条——同一段里已按
 * 字段表认出了条目，零散的「字段: 值」只是说明文字。
 */
export function parseListBlocks(allRows, whole = true) {
    const rows = allRows.filter(([, ln]) => !pyLstrip(ln).startsWith('|'));
    let blocks = [];
    let cur = null;
    for (const [lineno, ln] of rows) {
        const bold = BLOCK_HEAD.exec(ln);
        const m = bold ?? SUBHEAD.exec(ln);
        if (m && !labelField(ln)[0]) {
            if (cur)
                blocks.push(cur);
            cur = { name: clean(m[1]), line: lineno, fields: new Map(), limit_cols: [], kind: '条目', unknown: 0, sub: !bold };
            continue;
        }
        if (cur === null)
            continue;
        const [key, val] = labelField(ln);
        if (!key && unknownLabel(ln))
            cur.unknown += 1;
        if (key && !cur.fields.has(key)) {
            cur.fields.set(key, val);
            if (key === 'scope' && hasLimitWord(ln.toLowerCase()))
                cur.limit_cols.push(val);
        }
    }
    if (cur)
        blocks.push(cur);
    // 小标题起头、一个字段行都没有的块（`### 备注`、`#### 附件`）不是证据条目（R2-2）；加粗条目照判
    blocks = blocks.filter((b) => !b.sub || b.fields.size > 0 || b.unknown > 0);
    if (blocks.length === 0 && whole) { // 没有条目行但整段就是一条证据
        const one = { name: '（整段）', line: rows.length ? rows[0][0] : 1, fields: new Map(), limit_cols: [], kind: '条目', unknown: 0 };
        for (const [, ln] of rows) {
            const [key, val] = labelField(ln);
            if (!key && unknownLabel(ln))
                one.unknown += 1;
            if (key && !one.fields.has(key)) {
                one.fields.set(key, val);
                if (key === 'scope' && hasLimitWord(ln.toLowerCase()))
                    one.limit_cols.push(val);
            }
        }
        if (one.fields.size > 0)
            blocks.push(one);
    }
    return blocks;
}
export function splitRow(ln) {
    let s = pyStrip(ln);
    if (s.startsWith('|'))
        s = s.slice(1);
    if (s.endsWith('|'))
        s = s.slice(0, -1);
    return s.split('|').map((c) => pyStrip(c));
}
/** 表格分隔行。不用正则：原写法里 `\s*` 与字符类重叠，满行 `|` 或空格是平方级（R2-11）。 */
export function isSep(ln) {
    if (!ln.includes('|') || !ln.includes('-'))
        return false;
    for (const ch of pyStrip(ln))
        if (!'|:- \t'.includes(ch))
            return false;
    return true;
}
/** 表头 → {列号: 字段键}。以 _id 结尾的列当标识符，不当字段（acceptance_id 除外）。 */
export function mapHeader(cells) {
    const cols = new Map();
    cells.forEach((cell, idx) => {
        const name = clean(cell).toLowerCase();
        if (!name)
            return;
        if (name.endsWith('_id') && !name.includes('acceptance'))
            return;
        for (const [token, key] of HEADER_MAP)
            if (name.includes(token)) {
                cols.set(idx, key);
                break;
            }
    });
    return cols;
}
/** 字段表写法：表头映射到六字段，每个数据行是一条证据。 */
export function parseTableBlocks(rows) {
    const blocks = [];
    let i = 0;
    while (i < rows.length - 1) {
        const ln = rows[i][1];
        if (ln.includes('|') && isSep(rows[i + 1][1])) {
            const header = splitRow(ln);
            const cols = mapHeader(header);
            if (new Set(cols.values()).size < 3) {
                i += 1;
                continue;
            }
            // 首列之外映射不到字段的表头列算「认不出的字段」（首列是条目名/编号，R2-1）
            let unknown = 0;
            header.forEach((c, idx) => {
                const cc = clean(c);
                if (idx && !cols.has(idx) && cc && !NOTE_WORDS.has(cc.toLowerCase()) && !cc.toLowerCase().endsWith('_id'))
                    unknown += 1;
            });
            let j = i + 2;
            while (j < rows.length && rows[j][1].includes('|') && pyStrip(rows[j][1])) {
                const cells = splitRow(rows[j][1]);
                // 条目名取第一个非空格：不取行号，否则 id 随行号漂（C19）
                const first = cells.find((c) => pyStrip(c));
                const blk = { name: pyStrip(first ?? '（空行）'), line: rows[j][0], fields: new Map(), limit_cols: [], kind: '表行', unknown };
                for (const [idx, key] of cols) {
                    if (idx >= cells.length)
                        continue;
                    const val = cells[idx];
                    if (!blk.fields.has(key) || isPlaceholder(blk.fields.get(key)))
                        blk.fields.set(key, val);
                    if (key === 'scope' && hasLimitWord(clean(header[idx]).toLowerCase()))
                        blk.limit_cols.push(val);
                }
                blocks.push(blk);
                j += 1;
            }
            i = j;
            continue;
        }
        i += 1;
    }
    return blocks;
}
/** 返回 [缺的, 空的, 限制是否为空]。 */
export function judge(block) {
    const missing = [], empty = [];
    for (const key of ORDER) {
        if (!block.fields.has(key))
            missing.push(LABELS[key]);
        else if (isPlaceholder(block.fields.get(key)))
            empty.push(LABELS[key]);
    }
    return [missing, empty, block.limit_cols.some((v) => isPlaceholder(v))];
}
// --------------------------------------------------------------------------
// 契约接口
// --------------------------------------------------------------------------
export function scope(cfg) {
    return {
        covered: [
            `layout.work_root（当前 ${pyRepr(workRoot(cfg)[0])}）下 git 跟踪的 *.md 中状态为已完成的工作项，` +
                '**包括落在 layout.frozen 里的**：frozen 的语义是「不承担更新义务」（01 §3.1），' +
                '而本检查判的是「这条完成声明当初成不成立」，与要不要更新无关；' +
                '把 frozen 当跳过条件，等于把 §3.1 的一条豁免搬到一条它不适用的判据上',
            '它们证据段里每条证据的六字段（01 §4.2）是否齐全、值是否为空或占位',
            '两种写法：加粗条目行下的编号字段，以及表头能映射到六字段的字段表',
        ],
        not_covered: [
            '不判断证据内容是否属实：只判字段在不在、值空不空。命令是否真跑过、输出是否被裁剪过、' +
                '版本号是否对得上，本工具一概不看（契约 §7）',
            '不打开证据里引用的 artifacts 文件或 CI 链接，不核对它们存在与否',
            'L0 合在状态工件（WORK.md 之类）里的工作项不扫：只扫工作项目录，目录不在记 SKIP，' +
                '目录在不在由 layout 报',
            '不核对证据是否逐条绑到验收 ID（01 §4.1 done 行要求绑），也不追进验收文件核对主张',
            '不判断 01 §4.2 ④ 里「跨边界后采集」这一条是否满足——那要看证据内容',
            '不看未被 git 跟踪的文件，不看 .md 以外的文件，不看 PR/提交说明里承载的轻量简记' +
                '（01 §4.1 允许该写法，本工具读不到）',
            '不判断文档内容是否仍然正确，也不判断日期新旧——那是 freshness 检查器的事',
            '状态认不出的工作项不查完成证据：未定由 freshness/unknown-state 报；freshness 被裁剪或该件' +
                '落在 layout.frozen 时由本检查器记 evidence/unknown-state',
            '只认 §4.2 的六字段标签及其常见同义词；缺字段而条目里有认不出的「标签: 值」行（或字段表有' +
                '映射不到的列）时只记未定（fields-unrecognized），没有这种行就按缺字段判 FAIL；' +
                '认出的字段值为空或占位判 FAIL',
            '自检覆盖行内标签与字段表两种写法；不依赖 git 时间',
        ],
    };
}
export function run(cfg) {
    return runGuarded(NAME, doRun, cfg);
}
function doRun(cfg) {
    const root = cfg._root || '.';
    const [wroot, wnote] = workRoot(cfg);
    const declared = stateList(cfg, 'work_item_done_states', []);
    const note = `完成态按 01 §4.1 done 及别名（stdlib.WORK_ITEM_STATES）${declared.length ? `，并入 project.yaml 的 work_item_done_states：${declared.join('/')}` : ''}；${wnote}`;
    const freshOff = isTailoredOut(cfg, 'freshness')[0];
    const absent = workRootAbsent(NAME, cfg); // 目录在不在归 layout 报，这里不重复记未定
    if (absent)
        return [absent];
    const [files, problem] = workItems(root, wroot); // 只看直接一层
    if (problem)
        return [finding(NAME, UNDETERMINED, '列不出 git 跟踪的工作项', { reason: problem, why: '契约 §1：依赖不可用记未定，不记通过' })];
    const out = [];
    const other = [], unknown = [], unknownHere = [];
    for (const rel of files) {
        let text;
        try {
            text = readText(join(root, ...rel.split('/')), root);
        }
        catch (exc) {
            out.push(unreadable(NAME, rel, exc));
            continue;
        }
        const status = itemStatus(text);
        // 读不到状态：是不是工作项、要不要报 no-status 都由 freshness 判一次（契约 §1 同一事实只报一次），这里静默跳过
        if (status === null)
            continue;
        const [kind, cls] = statusKind(cfg, rel, status); // 文档（D-134）不是工作项，不查完成证据，由 freshness 报一次
        if (kind === 'document')
            continue;
        if (cls === null) {
            // freshness 被裁剪或该件落在 frozen（freshness 不读它的状态）时由本检查器报，否则指向 freshness
            ;
            (freshOff || inFrozen(cfg, rel) ? unknownHere : unknown).push(`${rel}（${status || '空'}）`);
            continue;
        }
        if (cls !== 'done') {
            other.push(`${rel}（${status || '空'}）`);
            continue;
        }
        out.push(...checkOne(rel, text, status, note));
    }
    if (unknown.length) {
        out.push(agg(NAME, SKIP, '状态认不出的工作项不查完成证据', unknown, '状态认不出由 freshness/unknown-state 记未定，报一次（契约 §1）', '', 'unknown-state-by-freshness'));
    }
    if (unknownHere.length) {
        out.push(agg(NAME, UNDETERMINED, '工作项状态不在已知词表', unknownHere, 'freshness 被裁剪或这些件落在 layout.frozen（freshness 不读其状态），由本检查器报一次；认不出就说不清是否完成，完成证据本次没查（契约 §1.1）', '', 'unknown-state'));
    }
    if (other.length) {
        out.push(agg(NAME, SKIP, '未完成的工作项不查完成证据', other, '01 §1 G4 约束的是完成声明；未声明完成的不适用本检查', '', 'not-done'));
    }
    if (out.length === 0) {
        out.push(finding(NAME, UNDETERMINED, `${wroot} 下没有可判定的工作项`, {
            where: wroot, reason: "空集上说不出'全部完成声明都有证据'（01 §2 N1：X 为空集时判未定）", evidence: note,
        }));
    }
    return out;
}
function checkOne(rel, text, status, note) {
    const sections = evidenceSections(text);
    if (sections.length === 0) {
        return [finding(NAME, UNDETERMINED, `已完成但认不出证据段：${rel}`, {
                where: `${rel}:1`, kind: 'no-evidence-section', key: rel,
                reason: `全文没有标题含 ${EVIDENCE_HEADINGS.join(' / ')} 的小节。标题词是本工具的约定，不是项目的声明（契约 §1.1）：没找到只说明证据不在工具猜的地方，推不出没有证据`,
                why: '01 §1 G4 完成需要证据；01 §4.2 收工前要求每个完成声明后面跟一段六字段',
                evidence: `状态 ${status}。${note}`,
            })];
    }
    const blocks = [];
    for (const [, , rows] of sections) {
        const table = parseTableBlocks(rows);
        blocks.push(...table);
        blocks.push(...parseListBlocks(rows, table.length === 0));
    }
    if (blocks.length === 0) {
        return [finding(NAME, UNDETERMINED, `证据段里认不出证据条目：${rel}`, {
                where: `${rel}:${sections[0][1]}`,
                reason: '本工具只认两种写法：加粗条目行下的编号字段，或表头能映射到六字段的表；都没认出来，判不了字段齐不齐——不猜，也不当通过',
                why: '01 §2 N1：证据不足而无法判定记未定', evidence: note,
            })];
    }
    const out = [];
    for (const blk of blocks) {
        const [missing, empty, limitsEmpty] = judge(blk);
        const where = `${rel}:${blk.line}`;
        const head = `${rel} 的证据 ${blk.name}`;
        const otherBad = [...missing, ...empty].filter((x) => x !== LABELS.scope);
        if (!missing.length && !empty.length && !limitsEmpty) {
            out.push(finding(NAME, PASS, `${head} 六字段齐全`, { where, evidence: `${blk.kind}（${ORDER.map((k) => LABELS[k]).join('、')}）。${note}` }));
            continue;
        }
        if (!empty.length && !limitsEmpty && blk.unknown >= missing.length) { // 一行认不出最多顶一个缺项
            // 缺的字段可能就在那几行认不出的「标签: 值」里：字段名是本工具的词表，项目可能用了自己的叫法（C07，契约 §1.1）。没有这种行就是真没写，照判 FAIL（R2-1）
            out.push(finding(NAME, UNDETERMINED, `${head} 有字段没认出：${missing.join('、')}`, {
                where, kind: 'fields-unrecognized', key: `${rel}|${blk.name}`,
                reason: `条目里有 ${blk.unknown} 行「标签: 值」本工具认不出；字段名是本工具的词表（§4.2 六字段及常见同义词），不是项目的声明，没认出推不出没写（契约 §1.1）。认出的字段都有值`,
                why: '01 §4.2 收工前第 1 条的六字段；01 §1 G4 完成需要证据', evidence: `写法：${blk.kind}。${note}`,
            }));
            continue;
        }
        if (otherBad.length === 0) {
            out.push(finding(NAME, FAIL, `${head} 的限制（④ 适用范围）为空，其余五项齐全`, {
                where, kind: 'limits-empty', key: `${rel}|${blk.name}`,
                why: '01 §4.2 的六字段里④是适用范围，01 §1 G4 缺一即声明无效。没有写限制不等于没有限制——空的限制字段让通过看起来比实际更强，读的人会把一次局部验证当成全面验证',
                evidence: `缺/空：${[...missing, ...empty].join('、') || '限制列为空'}；写法：${blk.kind}。${note}`,
            }));
            continue;
        }
        const parts = [];
        if (missing.length)
            parts.push(`缺字段：${missing.join('、')}`);
        if (empty.length)
            parts.push(`值为空或占位：${empty.join('、')}`);
        if (limitsEmpty && ![...missing, ...empty].includes(LABELS.scope))
            parts.push('限制列为空');
        out.push(finding(NAME, FAIL, `${head} 证据六字段不全`, {
            where, kind: 'incomplete', key: `${rel}|${blk.name}`,
            why: '01 §4.2 收工前第 1 条列的六字段是①断言②原始证据③版本与工作区身份④适用范围⑤观察时间⑥确认方法；01 §1 G4：证据六字段缺一即声明无效。当时没记，事后补不出来',
            evidence: `${parts.join('；')}；写法：${blk.kind}。${note}`,
        }));
    }
    return out;
}
// --------------------------------------------------------------------------
// 自检：反例与正例各一（契约 §3）
// --------------------------------------------------------------------------
const SIX = `**E-01**（INV-014，staging）
1. 断言：导入 100 行样表，四类拆分结果与人工标注一致
2. 原始证据：\`artifacts/e01.txt\`（\`pytest tests/import -v\` 14/14 绿）
3. 版本：\`main@7e1f2a9\`，staging migration 20260901_0930
4. 范围：staging；只覆盖单店样表；未覆盖多店并发
5. 时间：2026-09-01 16:42
6. 方法：pytest + 人工抽查 10 行
`;
const FIVE = `**E-01**（INV-014，staging）
1. 断言：导入 100 行样表，四类拆分结果与人工标注一致
2. 原始证据：\`artifacts/e01.txt\`（\`pytest tests/import -v\` 14/14 绿）
3. 版本：\`main@7e1f2a9\`
4. 范围：staging；只覆盖单店样表
5. 时间：2026-09-01 16:42
`;
const J = (v) => JSON.stringify(v);
export function selftest() {
    const results = [];
    const tmps = [];
    const mk = () => { const t = mkdtempSync(join(tmpdir(), 'evself-')); tmps.push(t); return t; };
    /** 夹具：一个已完成工作项 + 给定正文。返回 [cfg, git 准备失败的原因]。 */
    const sample = (tmp, body, frozen, heading = '## 验收证据') => {
        writeText(join(tmp, 'work', 'WI-0001-x.md'), `# WI-0001\n\n状态：**done**\n\n${heading}\n\n` + body);
        const err = gitTrack(tmp);
        return [{ _root: tmp, layout: frozen === undefined ? { work_root: 'work' } : { work_root: 'work', frozen } }, err];
    };
    const statuses = (cfg, err) => (err ? [] : run(cfg).map((f) => f.status));
    const errNote = (err) => (err ? `；git 准备失败：${err}` : '');
    try {
        {
            const [cfg, err] = sample(mk(), FIVE);
            const got = statuses(cfg, err);
            results.push(probe(NAME, !err && J(got) === J([FAIL]), '反例：已完成工作项缺⑥确认方法，应判 FAIL', { evidence: `实得 ${J(got)}${errNote(err)}`, why: '契约 §3 静默失效探测：抓不出违规的检查器，其结论作废' }));
        }
        {
            const [cfg, err] = sample(mk(), FIVE + '6. 方法：待补\n');
            const got = statuses(cfg, err);
            results.push(probe(NAME, !err && J(got) === J([FAIL]), '反例：已完成工作项⑥确认方法写的是占位，应判 FAIL', { evidence: `实得 ${J(got)}${errNote(err)}`, why: '01 §4.2：占位不是值' }));
        }
        {
            const [cfg, err] = sample(mk(), SIX);
            const got = statuses(cfg, err);
            results.push(probe(NAME, !err && J(got) === J([PASS]), '正例：六字段齐全且限制非空，应判 PASS', { evidence: `实得 ${J(got)}${errNote(err)}`, why: '契约 §3 静默失效探测：把合规样本判成违规的检查器同样不可用' }));
        }
        {
            // frozen 不是跳过条件。没有这条，「解开 frozen 耦合」就只是一句注释：上一版把整个 work_root 划进 frozen 就能让本检查一条对象都取不到，而那正是一次真实扫描里「覆盖对象为零」的成因。
            const [cfg, err] = sample(mk(), FIVE, ['work']);
            const got = statuses(cfg, err);
            results.push(probe(NAME, !err && J(got) === J([FAIL]), '反例：落在 layout.frozen 里的已完成工作项，缺⑥仍应判 FAIL', {
                evidence: `实得 ${J(got)}${errNote(err)}`,
                why: '01 §3.1 的 frozen 是「不承担更新义务」，01 §1 G4 判的是「完成声明成不成立」；两者无关，拿前者当后者的跳过条件会让归档区的完成声明全部免检',
            }));
        }
        {
            // 读不了的工作项是对象的事：出 unreadable/<路径>（可登记、按文件分开），不出不可登记的 internal-error（D-126 返修 R126-1：修前两份读不了的文件合成同一个 evidence/internal-error）
            const tmp = mk();
            const [cfg, err0] = sample(tmp, SIX);
            writeText(join(tmp, 'work', 'WI-0003-z.md'), '# WI-0003\n\n状态：done\n');
            const err = err0 || gitTrack(tmp);
            const locked = ['WI-0001-x.md', 'WI-0003-z.md'].map((n) => join(tmp, 'work', n));
            // root 读得了 000 文件，这条无从构造；Windows 没有 geteuid，Python 版同样不构造
            const canLock = typeof process.geteuid === 'function' && process.geteuid() !== 0;
            let ids = [];
            if (canLock) {
                for (const p of locked)
                    chmodSync(p, 0);
                try {
                    ids = err ? err : run(cfg).filter((f) => f.status === UNDETERMINED).map((f) => f.id).sort();
                }
                finally {
                    for (const p of locked)
                        chmodSync(p, 0o644);
                }
            }
            const want = ['evidence/unreadable/work/WI-0001-x.md', 'evidence/unreadable/work/WI-0003-z.md'];
            results.push(probe(NAME, !canLock || J(ids) === J(want), '反例：两份工作项读不了，各出一条 unreadable/<路径>，不出 internal-error', {
                evidence: `实得 ${J(ids)}${canLock ? '' : '（root 或非 POSIX 运行，未构造）'}`, why: '契约 §9：读不了的文件是对象的事，可登记；检查器自身出错才不可登记',
            }));
        }
        {
            // 只看工作项目录直接一层（D-123 裁定 3）；读不到状态的文件一律静默跳过——是不是工作项、要不要报 no-status 由 freshness 报一次（审查 B5）
            const tmp = mk();
            writeText(join(tmp, 'work', 'artifacts', 'WI-0009-留证.md'), '# 留证\n\n状态：done\n');
            writeText(join(tmp, 'work', 'current.md'), '# 当前\n');
            writeText(join(tmp, 'work', 'WI-0002-y.md'), '# 没写状态\n');
            const [cfg, err] = sample(tmp, SIX);
            const got = err ? [] : run(cfg).map((f) => [f.status, f.where ?? '']).sort();
            const ok = !err && J(got.map(([st]) => st)) === J([PASS]) && got[0][1].startsWith('work/WI-0001-x.md');
            results.push(probe(NAME, ok, '只看直接一层、读不到状态的静默跳过：子目录里的完成态留证不查，current.md 与无状态 WI 不报', {
                evidence: `实得 ${J(err || got)}`, why: 'D-123 裁定 3 与审查 B5：子目录是留证与产物；同一文件的 no-status 只由 freshness 报一次',
            }));
        }
        {
            // C07：项目自造的字段名（「核验手段」）认不出只记未定，不判 FAIL；认出的字段为占位仍判 FAIL（见反例）
            const [cfg, err] = sample(mk(), FIVE + '6. 核验手段：人工抽查 10 行\n');
            const got = err ? [] : run(cfg).map((f) => [f.status, f.id]);
            results.push(probe(NAME, J(got) === J([[UNDETERMINED, NAME + '/fields-unrecognized/work/WI-0001-x.md｜E-01']]), 'C07：自造字段名认不出只记未定（fields-unrecognized），不判 FAIL', {
                evidence: `实得 ${J(err || got)}`, why: '契约 §1.1：字段名词表落空推不出没写',
            }));
        }
        {
            // C06：条目里的代码块带 `# 注释`，不许把证据段截断；代码块里的 `时间: 3s` 不算字段
            const [cfg, err] = sample(mk(), SIX.replace('6. 方法：', '```bash\n# 跑测试\npytest -v  # 时间: 3s\n```\n6. 方法：'));
            const got = err ? err : statuses(cfg, err);
            results.push(probe(NAME, J(got) === J([PASS]), 'C06：证据条目里代码块的 # 注释不当标题，六字段齐全判 PASS', { evidence: `实得 ${J(got)}`, why: '01 §4.2 六字段；围栏代码块是正文，不是结构' }));
        }
        {
            // C13：`### E-01` 小标题起头的条目留在 `## 验收证据` 段内，按条目判（旧写法段在此截断，只记未定）
            const [cfg, err] = sample(mk(), FIVE.replace('**E-01**（INV-014，staging）', '### E-01') + '\n## 附注\n\n**E-02**\n1. 断言：不属于证据段\n');
            const got = err ? [] : run(cfg).map((f) => [f.status, f.title]);
            results.push(probe(NAME, J(got) === J([[FAIL, 'work/WI-0001-x.md 的证据 E-01 证据六字段不全']]), 'C13：### 小标题起头的证据条目按条目判，同级标题结束证据段', {
                evidence: `实得 ${J(err || got)}`, why: '01 §4.2 六字段；markdown 小标题的层级决定它属于哪一段',
            }));
        }
        {
            // C08：字段表格子里写「输出: ok」、表下再附一句「输出: 见 artifacts」，不许多出一条「（整段）」证据
            const [cfg, err] = sample(mk(), '| 断言 | 原始证据 | 版本 | 范围 | 时间 | 方法 |\n|---|---|---|---|---|---|\n| 导入一致 | 输出: ok | c | d | e | f |\n\n输出: 见 artifacts/e01.txt\n');
            const got = err ? err : statuses(cfg, err);
            results.push(probe(NAME, J(got) === J([PASS]), 'C08：字段表写法里格子与表外的「输出: …」不凭空生出「（整段）」证据', { evidence: `实得 ${J(got)}`, why: '01 §4.2 六字段；一条证据只判一次' }));
        }
        {
            // R2-2：证据段里没有字段行的小标题（### 备注、#### 附件）不当空条目
            const got = [];
            for (const body of [SIX + '\n### 备注\n\n一段说明文字。\n', SIX.replace('**E-01**（INV-014，staging）', '### E-01') + '\n#### 附件\n\n见 artifacts。\n']) {
                const [cfg, err] = sample(mk(), body);
                got.push(err ? err : statuses(cfg, err));
            }
            results.push(probe(NAME, J(got) === J([[PASS], [PASS]]), 'R2-2：证据段里没有字段行的小标题不当成一条空证据', { evidence: `实得 ${J(got)}`, why: '01 §4.2 六字段只对证据条目判；说明性小标题不是条目' }));
        }
        {
            // R2-5：工作项目录声明成出仓的符号链接——layout 记未定，这里只记 SKIP 指向它，不另报「没有可判定的工作项」
            const tmp = mk(), outDir = mk();
            writeText(join(outDir, 'WI-0001-x.md'), '# WI\n\n状态：done\n');
            symlinkSync(outDir, join(tmp, 'ext'), process.platform === 'win32' ? 'junction' : 'dir');
            const err = gitTrack(tmp);
            const got = err ? [] : run({ _root: tmp, layout: { work_root: 'ext' } }).map((f) => [f.status, f.id]);
            results.push(probe(NAME, J(got) === J([[SKIP, NAME + '/work-root-absent']]), 'R2-5：工作项目录链到项目之外只记 SKIP 指向 layout', {
                evidence: `实得 ${J(err || got)}`, why: '契约 §1 同一事实只报一次；§5 只读项目之内',
            }));
        }
        {
            // R2-11：证据段里一行 4 万个 `|` 或空格，表格分隔行判定须线性（旧正则约 7 秒）
            const t0 = performance.now();
            const seps = [isSep('|'.repeat(40000) + 'x'), isSep(' '.repeat(40000)), isSep('|---|:-:|'), isSep('| a | b |')];
            const took = (performance.now() - t0) / 1000;
            results.push(probe(NAME, J(seps) === J([false, false, true, false]) && took < 1, 'R2-11：表格分隔行判定线性、结果不变', {
                evidence: `实得 ${J(seps)}，耗时 ${took.toFixed(2)}s`, why: '一份文件不许拖死整次检查',
            }));
        }
        {
            // R2-12：四个反引号开的围栏里的 ``` 不闭合它，其中的 `# 注释` 仍在代码里
            const [cfg, err] = sample(mk(), SIX.replace('6. 方法：', '````md\n```\n# 标题样例\n```\n````\n6. 方法：'));
            const got = err ? err : statuses(cfg, err);
            results.push(probe(NAME, J(got) === J([PASS]), 'R2-12：长围栏只被同字符、不短于开栏的行闭合', { evidence: `实得 ${J(got)}`, why: '围栏代码块是正文，不是结构' }));
        }
        {
            // C19：字段表里首格为空的行，id 不随行号漂——上面多一行空白，id 照旧
            const ids = [];
            for (const pad of ['', '\n\n']) {
                const [cfg, err] = sample(mk(), pad + '| 编号 | 断言 | 原始证据 | 版本 | 范围 | 时间 | 方法 |\n|---|---|---|---|---|---|---|\n|  | 导入一致 | TBD | c | d | e | f |\n');
                ids.push(err ? err : run(cfg).map((f) => f.id));
            }
            const a = ids[0], b = ids[1];
            const ok = J(a) === J(b) && Array.isArray(a) && a.length === 1 && a[0].startsWith(NAME + '/incomplete/work/WI-0001-x.md｜');
            results.push(probe(NAME, ok, 'C19：字段表条目的 id 取条目名与文件，不随行号漂', { evidence: `两次实得 ${J(ids)}`, why: '契约 §4/§9：id 是登记与复核的地址' }));
        }
        {
            // 证据段标题是工具约定（契约 §1.1，D-123）：英文 `## Evidence` 照认；一个都认不出只记未定
            const got = {};
            for (const [tag, heading] of [['en', '## Evidence'], ['none', '## 附注']]) {
                const [cfg, err] = sample(mk(), SIX, undefined, heading);
                got[tag] = err ? err : statuses(cfg, err);
            }
            results.push(probe(NAME, J(got) === J({ en: [PASS], none: [UNDETERMINED] }), '约定：## Evidence 下六字段齐全判 PASS；认不出证据段只记未定，不判 FAIL', {
                evidence: `实得 ${J(got)}`, why: '契约 §1.1：标记词落空推不出没有证据',
            }));
        }
        {
            // R2-1 第二轮：认不出的标签只顶替同样多的缺项；说明词、URL、时刻不算标签。审查席在副本验证的 8 例一律回到 FAIL，「6. 核验手段：…」这种确实认不出的第六项仍记未定
            const one = '**E-01**\n1. 断言：导入一致\n';
            const five = '**E-01**\n1. 断言：x\n2. 原始证据：a.txt\n3. 版本：main@1\n4. 范围：staging\n5. 时间：2026-09-01 16:42\n';
            const cases = [
                [one + '注意：以上只在 staging 跑过\n', 'incomplete'], [one + '详见 https://ci.example.com/run/1\n', 'incomplete'],
                [one + '运行于 12:30 完成\n', 'incomplete'], [one + 'Note: flaky on CI\n', 'incomplete'],
                [five + '备注：无\n', 'incomplete'], [five + '日志 https://x/y\n', 'incomplete'],
                ['| 编号 | 断言 | 原始证据 | 版本 | 范围 | 时间 | 备注 |\n|---|---|---|---|---|---|---|\n| E-1 | a | b | c | d | e | f |\n', 'incomplete'],
                [one + 'note: 见下\n', 'incomplete'],
                [five + '6. 核验手段：人工抽查\n', 'fields-unrecognized'],
            ];
            const got = [];
            for (const [body, want] of cases) {
                const [cfg, err] = sample(mk(), body);
                got.push([err ? [err] : run(cfg).filter((f) => f.status !== SKIP).map((f) => f.id.split('/')[1]), want]);
            }
            results.push(probe(NAME, got.every(([ids, want]) => J(ids) === J([want])), 'R2-1：说明词、URL、时刻不算认不出的标签，一行认不出最多顶一个缺项', {
                evidence: `实得 ${J(got)}`, why: '01 §4.2 六字段；契约 §1.1 只有确实认不出的字段才记未定',
            }));
        }
    }
    finally {
        for (const t of tmps)
            rmSync(t, { recursive: true, force: true });
    }
    return results;
}
