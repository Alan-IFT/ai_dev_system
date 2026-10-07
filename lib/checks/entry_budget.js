// 篇幅预算：入口，以及 01 §3.7 其余四项以行数计的预算（状态、交接、工作项、模块文档）。
// 对应 tools/std/checks/check_entry_budget.py；契约见 tools/std/CONTRACT.md。
//
// 迁移约束：与 Python 版逐 id 相同（黄金样本）；`selftest()` 的变异验证必须迁（契约 §3：抓不出违规的检查器，其结论作废）。
import { mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cfgGet, pyStr, pyTruthy } from '../core/cfg.js';
import { HANDOFF_CANDIDATES, STATUS_CANDIDATES, docsRootOf, entryFiles, inFrozen, itemStatus, rebaseDocs, workRoot } from '../core/docs.js';
import { FAIL, PASS, SKIP, UNDETERMINED, finding, pyStrip } from '../core/finding.js';
import { countLines, inside, isDir, isFile, readText } from '../core/fs.js';
import { pyRepr } from '../core/repr.js';
import { once, probe, runGuarded, unreadable } from '../core/shell.js';
import { writeText } from '../core/fixture.js';
export const NAME = 'entry-budget';
export const STANDARD_REFS = ['01 §1 G10', '01 §3.7'];
const DEFAULT_ENTRY_LINES = 150; // 01 §3.7 的默认值，项目可改
const DOC_BUDGETS = [
    ['status', '状态', 'status_lines', 80, '完成的移出“当前重点”；历史进 releases'],
    ['handoff', '交接', 'handoff_lines', 60, '只留当前判断所需'],
    ['work_item', '工作项', 'work_item_lines', 150, '过程记录移进 artifacts，只留结论与指针'],
    ['module', '模块文档', 'module_lines', 200, '拆出契约与 runbook；“已知坑”移进 PLAYBOOK'],
];
/** 模块文档没在 layout.artifacts.modules 声明时的候选：01 §3.1 的 architecture/ 与 02 的 modules/。 */
const MODULES_CANDIDATE = 'docs/architecture/modules';
/** Python 的 `"…%s默认 %d 行；超了先按“%s”移出…" % (label, n, fix)`。 */
const whyDoc = (label, n, fix) => `01 §3.7 篇幅预算：${label}默认 ${n} 行；超了先按“${fix}”移出，不是先加预算`;
export function scope(cfg) {
    const [entries, guessed] = entryFiles(cfg);
    return {
        covered: [
            `逐行计数入口文件：${entries.join('、') || '没找到'}（${guessed || '取自 layout.entry'}）`,
            '逐行计数状态（layout.artifacts.status，须是文件）、交接（layout.artifacts.handoff，文件或' +
                '目录下直接一层 *.md）、工作项（layout.work_root 下直接一层、头部带状态字段的 *.md）、' +
                '模块文档（layout.artifacts.modules，文件或目录下直接一层 *.md）；未声明时按候选 ' +
                `${STATUS_CANDIDATES.join('/')}、${HANDOFF_CANDIDATES.join('/')}、默认工作项目录、${MODULES_CANDIDATE} 找`,
            '同一份文件同时是几类工件（如工作项目录兼作交接）时，超过其中最宽的预算才判 FAIL；' + '只超较紧的预算记未定——标准没写合并工件用哪条预算',
            '以上四类只在项目声明了 budgets.status_lines／handoff_lines／work_item_lines／module_lines 时判',
        ],
        not_covered: [
            '不判断入口内容是否该留在入口——那不是机械可判定的（契约 §7）',
            '不看未在 layout.entry 列出的文件，包括子目录里的同名入口；未配 layout.entry 时只看' + '候选里第一个存在的那一个，它超预算只记未定（契约 §1.1）',
            '入口在不在不由本检查报：01 §3.1 的 ★ 入口归 layout（契约 §1 同一事实只报一次）；' + '其余四类工件在不在同样不由本检查报，找不到记 SKIP',
            '按物理行计，不折算 token 占用（01 §3.7 明确不按行数推定 token）',
            'INDEX 的预算是「每份文档一行」，不是行数；一行里写没写摘要以外的内容要读内容，本检查不判',
            '状态声明为目录时不判：状态预算是单份 STATUS 的预算，目录形态下没有对应对象（契约 §4 预算表）',
            '不看 layout.frozen 下的文件；工作项目录只看直接一层，头部没有状态字段的文件不算工作项',
            '状态、交接、工作项、模块文档四类：未声明预算不判，默认值（80／60／150／200）仅作参考' +
                '（01 §3.7：表中数字是试验参数，不是合格门槛）；入口预算不在此列，未声明仍按 150 判',
        ],
    };
}
export function run(cfg) {
    return runGuarded(NAME, (c) => once([...entry(c), ...docs(c)]), cfg); // 入口同时是某类文档且读不了时只报一次
}
/** Python 的 `isinstance(budget, int) and not isinstance(budget, bool) and budget > 0` 的 JS 对应：YAML 整数（number 且整数），**不含布尔**。 */
const isPosInt = (v) => typeof v === 'number' && Number.isInteger(v) && v > 0;
function entry(cfg) {
    const root = cfg._root || '.';
    const [entries, guessed] = entryFiles(cfg);
    if (entries.length === 0)
        return [absent(guessed)];
    let budget = cfgGet(cfg, 'budgets.entry_lines');
    const usedDefault = budget === undefined || budget === null;
    if (usedDefault)
        budget = DEFAULT_ENTRY_LINES;
    if (!isPosInt(budget)) {
        return [finding(NAME, UNDETERMINED, '行数预算不是正整数', { reason: `budgets.entry_lines = ${pyRepr(budget)}`, why: '01 §3.7 的预算是参数，但必须是可比较的数' })];
    }
    const note = usedDefault ? `用的是标准默认值 ${budget}，项目未校准（契约 §5）` : '预算取自 project.yaml';
    const out = [];
    for (const rel of entries) {
        const path = join(root, String(rel));
        if (!inside(root, path)) { // 先判真实位置，不探测项目之外（C16）；由 layout 记未定
            out.push(absent('真实位置在被扫项目之外（符号链接出仓），未读', rel));
            continue;
        }
        if (!isFile(path)) {
            out.push(absent('来自项目声明（layout.entry／layout.artifacts.entry），文件不在', rel));
            continue;
        }
        let n;
        try {
            n = countLines(path, root);
        }
        catch (exc) {
            out.push(unreadable(NAME, String(rel), exc));
            continue;
        }
        if (n > budget && guessed) {
            // 候选是工具约定：它是不是这个项目的入口本工具不猜（契约 §1.1），超了只记未定
            out.push(finding(NAME, UNDETERMINED, `候选入口 ${rel} 有 ${n} 行，超预算 ${budget} 行`, {
                where: `${rel}:${budget + 1}`, kind: 'candidate-over', key: rel,
                reason: `未配 layout.entry，${rel} 是按候选文件名认的入口；在 layout.entry 声明它之后仍超预算才判 FAIL（契约 §1.1）`,
                why: '01 §1 G10 入口只放晚一秒就来不及的规则；01 §3.7 超了先移出，不是先加预算',
                evidence: `${n} 行 / 预算 ${budget}（${note}）；${guessed}`,
            }));
        }
        else if (n > budget) {
            out.push(finding(NAME, FAIL, `${rel} 有 ${n} 行，超预算 ${budget} 行`, {
                where: `${rel}:${budget + 1}`,
                why: '01 §1 G10 入口只放晚一秒就来不及的规则；01 §3.7 超了先移出，不是先加预算',
                evidence: `${n} 行 / 预算 ${budget}（${note}）`,
            }));
        }
        else {
            out.push(finding(NAME, PASS, `${rel} 有 ${n} 行，在预算 ${budget} 内`, { where: String(rel), evidence: note + (guessed ? '；' + guessed : '') }));
        }
    }
    return out;
}
/** 入口文件不在：01 §3.1 的 ★ 入口由 layout 报，本检查记不适用（契约 §1 同一事实只报一次）。 */
function absent(note, rel) {
    return finding(NAME, SKIP, '入口文件不在，行数无从计' + (rel ? `：${rel}` : ''), {
        where: rel ?? null, kind: 'entry-absent', key: rel ?? null,
        reason: '入口在不在由 layout 报（01 §3.1 ★ 入口）；本检查不再另记一条',
        evidence: `${note}；负责报告的检查器：layout（layout 被裁剪、其入口一项被裁剪或 tier 未声明时它不报）`,
    });
}
// --------------------------------------------------------------------------
// 其余四项：状态、交接、工作项、模块文档
// --------------------------------------------------------------------------
/**
 * 目录下直接一层的 *.md（相对路径，排好序）。调用方已确认目录本身的真实位置在项目内（C04）。
 * 其中指向项目之外的文件照列、不做 isfile（名字是项目里的；探测会跟随链接到仓外，R2-10），计行时记 outside-root 未定。
 */
function mdChildren(root, rel) {
    const base = join(root, rel);
    const prefix = rel.replace(/\/+$/, '');
    return readdirSync(base)
        .filter((n) => n.toLowerCase().endsWith('.md') && (!inside(root, join(base, n)) || isFile(join(base, n))))
        .map((n) => `${prefix}/${n}`)
        .sort(cmpCodepoint);
}
/** Python 的 `sorted(list_of_str)` 按码点排；JS 的默认 `sort()` 按 UTF-16 码元。BMP 之外的字符（如 emoji 文件名）两者次序不同，所以显式按码点比。 */
function cmpCodepoint(a, b) {
    const ia = a[Symbol.iterator](), ib = b[Symbol.iterator]();
    for (;;) {
        const x = ia.next(), y = ib.next();
        if (x.done && y.done)
            return 0;
        if (x.done)
            return -1;
        if (y.done)
            return 1;
        const cx = x.value.codePointAt(0), cy = y.value.codePointAt(0);
        if (cx !== cy)
            return cx - cy;
    }
}
/** 一类工件落在哪些文件上。返回 [文件列表, 是否来自项目声明, 说明, SKIP 或 null]。 */
function locate(cfg, role) {
    const root = cfg._root || '.';
    const droot = docsRootOf(cfg)[0];
    if (role === 'work_item') {
        const [rel, note] = workRoot(cfg);
        const declared = pyTruthy(cfgGet(cfg, 'layout.work_root'));
        const path = join(root, rel);
        if (!inside(root, path) || !isDir(path))
            return [[], declared, note + '，目录不在或真实位置在项目之外', null];
        return [mdChildren(root, rel).filter((f) => isItem(root, f)), declared, note, null];
    }
    const key = { status: 'status', handoff: 'handoff', module: 'modules' }[role];
    const declared = cfgGet(cfg, `layout.artifacts.${key}`);
    let cands, src;
    if (pyTruthy(declared)) {
        cands = [pyStrip(pyStr(declared)).replace(/\/+$/, '')];
        src = `取自 layout.artifacts.${key}`;
    }
    else {
        const base = { status: STATUS_CANDIDATES, handoff: HANDOFF_CANDIDATES, module: [MODULES_CANDIDATE] }[role];
        cands = base.map((c) => rebaseDocs(c, droot));
        src = `未声明 layout.artifacts.${key}，按候选 ${cands.join('、')} 找`;
    }
    const isDeclared = pyTruthy(declared);
    for (const rel of cands) {
        const path = join(root, rel);
        if (!inside(root, path)) { // 出仓的符号链接不探测、不列目录（C04）；在不在由 layout 报
            src += `；${rel} 的真实位置在项目之外，未读`;
            continue;
        }
        if (isFile(path))
            return [[rel], isDeclared, src, null];
        if (isDir(path)) {
            if (role === 'status') {
                return [[], isDeclared, src, finding(NAME, SKIP, '状态工件是目录，不按单份 STATUS 的行数预算判', {
                        where: rel, kind: 'status-dir', key: rel,
                        reason: `01 §3.7 的状态预算是单份 STATUS.md 的预算；${rel} 是目录（${src}），没有对应的单份文件；目录下的文件若是工作项或交接，按那两类的预算判`,
                        why: whyDoc('STATUS ', 80, DOC_BUDGETS[0][4]),
                    })];
            }
            return [mdChildren(root, rel), isDeclared, src, null];
        }
    }
    return [[], isDeclared, src + '，不在', null];
}
/**
 * 头部带状态字段才算工作项。读不了的（出仓、超限、非常规文件）留下，计行时逐份记未定——
 * 一份读不了不许让整类变成一条未定、吞掉别的工作项的 FAIL（C12）。
 */
function isItem(root, rel) {
    try {
        return itemStatus(readText(join(root, rel), root)) !== null;
    }
    catch {
        return true;
    }
}
function budgetOf(cfg, key, dflt, label) {
    const val = cfgGet(cfg, `budgets.${key}`);
    if (val === undefined || val === null) {
        return [null, null, finding(NAME, SKIP, `${label}：项目没声明 budgets.${key}，不判`, {
                kind: 'budget-undeclared', key,
                reason: `01 §3.7 说表中数字只是试验参数、不是合格门槛；项目在 project.yaml 声明了预算才按它判，未声明不判，默认 ${dflt} 行仅作参考`,
            })];
    }
    if (!isPosInt(val)) {
        return [null, null, finding(NAME, UNDETERMINED, `行数预算 budgets.${key} 不是正整数`, {
                kind: 'budget-invalid', key, reason: `budgets.${key} = ${pyRepr(val)}`, why: '01 §3.7 的预算是参数，但必须是可比较的数',
            })];
    }
    return [val, `${key} = ${val} 取自 project.yaml`, null];
}
function docs(cfg) {
    const root = cfg._root || '.';
    const out = [];
    const perFile = new Map();
    const passed = [];
    for (const [role, label, key, dflt, fix] of DOC_BUDGETS) {
        const [budget, bnote, bad] = budgetOf(cfg, key, dflt, label);
        if (bad) {
            out.push(bad);
            continue;
        }
        let located;
        try {
            located = locate(cfg, role);
        }
        catch (exc) {
            out.push(unreadable(NAME, label, exc));
            continue;
        }
        const [files0, declared, src, skip] = located;
        if (skip) {
            out.push(skip);
            continue;
        }
        const files = files0.filter((f) => !inFrozen(cfg, f));
        if (files.length === 0) {
            out.push(finding(NAME, SKIP, `${label}：没有可计行数的文件`, { kind: `${role}-absent`, reason: `${src}；在不在由 layout 报（01 §3.1），本检查只数已有的` }));
            continue;
        }
        for (const rel of files) {
            if (!perFile.has(rel))
                perFile.set(rel, []);
            perFile.get(rel).push([role, label, budget, declared, src, bnote, fix]);
        }
    }
    for (const rel of [...perFile.keys()].sort(cmpCodepoint)) {
        const roles = perFile.get(rel);
        if (!inside(root, join(root, rel))) { // 护栏在起作用，不是检查器故障（R2-10）
            out.push(finding(NAME, UNDETERMINED, `${rel} 的真实位置在被扫项目之外，行数未计`, {
                where: rel, kind: 'outside-root', key: rel,
                reason: '它是指向项目之外的符号链接；本工具不读、不探测项目之外的路径', why: '契约 §5：只读被扫项目之内的文件',
            }));
            continue;
        }
        let n;
        try {
            n = countLines(join(root, rel), root);
        }
        catch (exc) {
            out.push(unreadable(NAME, rel, exc));
            continue;
        }
        const lo = Math.min(...roles.map((r) => r[2])), hi = Math.max(...roles.map((r) => r[2]));
        const labels = roles.map((r) => `${r[1]}（预算 ${r[2]}）`).join('、');
        const why = roles.map((r) => whyDoc(r[1], r[2], r[6])).join('；');
        const ev = `${n} 行；${roles.map((r) => r[4]).join('；')}；${roles.map((r) => r[5]).join('；')}`;
        if (n <= lo) {
            passed.push(`${rel} ${n} 行`);
        }
        else if (n > hi && roles.some((r) => r[3])) {
            out.push(finding(NAME, FAIL, `${rel} 有 ${n} 行，超${labels}`, {
                where: `${rel}:${hi + 1}`, kind: 'doc-over', key: rel, why, evidence: ev,
                reason: roles.length > 1 ? `落点是项目声明的；同时是几类工件时已按其中最宽的预算 ${hi} 比` : '',
            }));
        }
        else if (n > hi) {
            out.push(finding(NAME, UNDETERMINED, `候选 ${rel} 有 ${n} 行，超${labels}`, {
                where: `${rel}:${hi + 1}`, kind: 'candidate-over', key: rel, why, evidence: ev,
                reason: '落点是按候选路径认的，不是项目声明；在 project.yaml 声明它之后仍超预算才判 FAIL（契约 §1.1）',
            }));
        }
        else {
            out.push(finding(NAME, UNDETERMINED, `${rel} 有 ${n} 行，超了较紧的预算、没超较宽的：它同时是${labels}`, {
                where: `${rel}:${lo + 1}`, kind: 'merged-over', key: rel, why, evidence: ev,
                reason: `01 §3.7 按文档类给预算，没写一份文件合并承担几类职责时用哪条；超过最宽的 ${hi} 行才是确定的超预算`,
            }));
        }
    }
    if (passed.length) {
        out.push(finding(NAME, PASS, `状态/交接/工作项/模块文档：${passed.length} 份在预算内`, {
            kind: 'docs-within', evidence: passed.slice(0, 12).join('；') + (passed.length > 12 ? `；……共 ${passed.length} 份` : ''),
        }));
    }
    return out;
}
// --------------------------------------------------------------------------
// 自检：反例与正例。见契约 §3：抓不出违规的检查器，其结论作废。
// --------------------------------------------------------------------------
const ALL_BUDGETS = { status_lines: 80, handoff_lines: 60, work_item_lines: 150, module_lines: 200 };
export function selftest() {
    const results = [];
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const _case = (title, got, want) => {
        results.push(probe(NAME, eq(got, want), title, { evidence: `期望 ${JSON.stringify(want)}，实得 ${JSON.stringify(got)}`, why: '契约 §3 静默失效探测' }));
    };
    const _w = (tmp, rel, n, head = '') => writeText(join(tmp, rel), head + 'x\n'.repeat(n - (head ? 1 : 0)));
    const _got = (cfg, ids = false) => {
        const rows = docs(cfg).filter((f) => f.status !== SKIP || ids).map((f) => (ids ? [f.status, f.id] : f.status));
        return ids ? rows.sort(cmpPair) : rows.sort(cmpCodepoint);
    };
    const tmps = [];
    const mk = () => { const t = mkdtempSync(join(tmpdir(), 'ebsel-')); tmps.push(t); return t; };
    try {
        {
            const tmp = mk();
            _w(tmp, 'BIG.md', 20);
            _w(tmp, 'SMALL.md', 3);
            const cfg = { _root: tmp, layout: { entry: ['BIG.md'] }, budgets: { entry_lines: 10 } };
            _case('反例：入口 20 行 / 预算 10 应判 FAIL', entry(cfg).map((f) => f.status), [FAIL]);
            cfg.layout.entry = ['SMALL.md'];
            _case('正例：入口 3 行 / 预算 10 应判 PASS', entry(cfg).map((f) => f.status), [PASS]);
        }
        // 状态：声明的 FAIL、候选的未定、在预算内 PASS、预算键被读
        {
            const tmp = mk();
            _w(tmp, 'S.md', 100);
            const cfg = { _root: tmp, layout: { artifacts: { status: 'S.md' } } };
            _case('未声明预算不判：声明的状态 100 行、四个预算键都没有，只得四条 SKIP budget-undeclared', _got(cfg, true), (['status_lines', 'handoff_lines', 'work_item_lines', 'module_lines'].map((k) => [SKIP, `entry-budget/budget-undeclared/${k}`])).sort(cmpPair));
            cfg.budgets = { ...ALL_BUDGETS };
            _case('反例：声明的状态 100 行 / 声明预算 80 应判 FAIL doc-over', _got(cfg, true), [[FAIL, 'entry-budget/doc-over/S.md'], [SKIP, 'entry-budget/handoff-absent'], [SKIP, 'entry-budget/module-absent'], [SKIP, 'entry-budget/work_item-absent']]);
            cfg.budgets.status_lines = 120;
            _case('正例：budgets.status_lines=120 时同一份 100 行应判 PASS', _got(cfg), [PASS]);
        }
        {
            const tmp = mk();
            _w(tmp, 'WORK.md', 100);
            _case('候选状态 WORK.md 100 行只记未定 candidate-over（契约 §1.1）', _got({ _root: tmp, budgets: { ...ALL_BUDGETS } }, true).filter((x) => x[0] !== SKIP), [[UNDETERMINED, 'entry-budget/candidate-over/WORK.md']]);
        }
        // 交接、工作项、模块文档；合并工件
        {
            const tmp = mk();
            const st = '状态: in_progress\n';
            _w(tmp, 'w/WI-1.md', 160, st); // 工作项超 150
            _w(tmp, 'w/WI-2.md', 40, st);
            _w(tmp, 'w/notes.md', 400); // 无状态字段：不算工作项
            _w(tmp, 'w/current.md', 100, st); // 同时是状态（80）与工作项（150）
            _w(tmp, 'h/2026-09-01.md', 70); // 交接超 60
            _w(tmp, 'm/a.md', 201); // 模块文档超 200
            const cfg = { _root: tmp, budgets: { ...ALL_BUDGETS }, layout: { work_root: 'w', artifacts: { status: 'w/current.md', handoff: 'h', modules: 'm' } } };
            _case('反例：工作项 160、交接 70、模块 201 判 FAIL；状态兼工作项 100 行记未定 merged-over；无状态字段的不算工作项', _got(cfg, true), [[FAIL, 'entry-budget/doc-over/h/2026-09-01.md'], [FAIL, 'entry-budget/doc-over/m/a.md'], [FAIL, 'entry-budget/doc-over/w/WI-1.md'],
                [PASS, 'entry-budget/docs-within'], [UNDETERMINED, 'entry-budget/merged-over/w/current.md']].sort(cmpPair));
            _w(tmp, 'w/current.md', 151, st);
            _w(tmp, 'w/WI-1.md', 150, st);
            _w(tmp, 'h/2026-09-01.md', 60);
            _w(tmp, 'm/a.md', 200);
            _case('正例：各在预算上限内 PASS；合并工件超过最宽的 150 判 FAIL', _got(cfg, true), [[FAIL, 'entry-budget/doc-over/w/current.md'], [PASS, 'entry-budget/docs-within']]);
            cfg.layout.artifacts.status = 'w';
            _case('状态声明为目录记 SKIP status-dir', _got(cfg, true).filter((x) => x[1].includes('status')), [[SKIP, 'entry-budget/status-dir/w']]);
        }
        // C04 C12 C16：出仓的符号链接——交接目录链到仓外不列出仓外文件名；工作项目录里一份出仓不吞掉另一份的 FAIL；入口链到仓外记 SKIP（layout 记未定），不读
        {
            const tmp = mk(), outDir = mk();
            _w(outDir, 'SECRET-NAME.md', 100);
            _w(outDir, 'AGENTS.md', 3);
            symlinkSync(outDir, join(tmp, 'h'), process.platform === 'win32' ? 'junction' : 'dir');
            _w(tmp, 'w/WI-1.md', 200, '状态: in_progress\n');
            symlinkSync(join(outDir, 'SECRET-NAME.md'), join(tmp, 'w', 'WI-2.md'), 'file');
            symlinkSync(join(outDir, 'AGENTS.md'), join(tmp, 'AGENTS.md'), 'file');
            const cfg = { _root: tmp, budgets: { handoff_lines: 60, work_item_lines: 150 }, layout: { work_root: 'w', entry: ['AGENTS.md'], artifacts: { handoff: 'h' } } };
            let res = [...entry(cfg), ...docs(cfg)];
            const leaked = res.some((f) => ((f.title || '') + (f.evidence || '') + (f.reason || '')).includes('SECRET-NAME'));
            // R2-10：链到仓外不存在的文件（WI-3）同样照列记 outside-root，输出不随仓外存在与否变
            symlinkSync(join(outDir, 'no-such.md'), join(tmp, 'w', 'WI-3.md'), 'file');
            res = [...entry(cfg), ...docs(cfg)];
            const got = res.filter((f) => f.status !== SKIP || f.id.includes('absent')).map((f) => [f.status, f.id.split('/').slice(1).join('/')]).sort(cmpPair);
            _case('出仓符号链接：不列仓外文件名、一份出仓不吞掉整类、入口出仓记 SKIP、出仓工作项记 outside-root', [got, leaked], [[[FAIL, 'doc-over/w/WI-1.md'], [SKIP, 'entry-absent/AGENTS.md'], [SKIP, 'handoff-absent'], [UNDETERMINED, 'outside-root/w/WI-2.md'], [UNDETERMINED, 'outside-root/w/WI-3.md']].sort(cmpPair), false]);
        }
    }
    catch (exc) {
        results.push(finding(NAME, FAIL, '自检自己跑不起来', { evidence: `${exc.name}: ${exc.message}`, why: '契约 §3：自检崩了，本检查器对目标仓库的结论作废' }));
    }
    finally {
        for (const t of tmps)
            rmSync(t, { recursive: true, force: true });
    }
    return results;
}
/** Python 对 (status, id) 元组排序：先按第一个、再按第二个，按码点。 */
function cmpPair(a, b) {
    return cmpCodepoint(a[0], b[0]) || cmpCodepoint(a[1], b[1]);
}
