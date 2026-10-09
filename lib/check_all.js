// 汇总层：把 10 个检查器串起来（发现、自检闸门、异常转未定、封签）、贴例外登记、出报告。对应 tools/std/check_all.py；设计 §12.31。
//
// 这一层不判任何文档的对错。它的安全属性：①检查器内部异常一律转未定，**绝不吞掉记 PASS**（契约 §1）；②自检不过或没有自检的检查器，其结论作废（契约 §3）；
// ③扫描前后检查器身份不一致，整份作废（契约 §8）；④登记只改 `registered`、不改 `status`（契约 §9）；⑤被扫仓里的文件名能伪造「结论：」行，控制字符必须转义。
//
// 与 Python 版的有意差异（设计 §12.31）：
//   · 身份哈希 `lib/` 下全部 `.js` + `CONTRACT.md`（运行的是编译产物，不是源码）；`tool-identity` 一项因此与黄金样本必然不同，对比时排除。
//   · 不带 `scrub_git_env`：Python 版往 `os.environ` 里写加固变量；TS 版 `hardenedEnv` 是纯函数（D9），每个 git 调用点自己传加固环境，不改本进程环境。
//   · 不带 `.std/` 内嵌自排除（D17）与内嵌只读自检（对象已废弃，§12.28）。
//   · 检查器在显式表里登记，不扫目录（`checks/index.ts`）。
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CHECKS, tailorableNames } from './checks/index.js';
import { cfgGet, pyStr } from './core/cfg.js';
import { loadConfig } from './core/config.js';
import { addDays, compareDays, toIso, todayLocal } from './core/dates.js';
import { EXCEPTION_MAX_DAYS, INTERNAL_ERROR_KIND, loadExceptions } from './core/exceptions.js';
import { FAIL, PASS, SKIP, UNDETERMINED, finding, pyStrip } from './core/finding.js';
import { filterEnv, gitVersionProblem, hardenedEnv } from './core/git.js';
import { undeterminedFromException } from './core/shell.js';
import { cmpCodepoint, withScanMemo } from './core/tracked.js';
export const IDENTITY_CHECK = 'tool-identity';
export const EXCEPTION_CHECK = 'exception-register';
const MAX_REGISTER_LISTED = 12;
/** 本包根：`lib/check_all.js` 上溯一层是 `lib/`，再上溯一层是包根。身份只哈希包根下的 `lib/` 与 `tools/std/CONTRACT.md`。 */
const HERE = dirname(fileURLToPath(import.meta.url));
export const TOOL_LIB = HERE;
const CONTRACT_PATH = resolve(HERE, '..', 'tools', 'std', 'CONTRACT.md');
// --------------------------------------------------------------------------
// 检查器版本身份（契约 §8）
// --------------------------------------------------------------------------
/** 行尾归一化后再哈希：CRLF / CR 一律作 LF，其余字节不动（契约 §8）。 */
export function sha256File(path) {
    try {
        const data = readFileSync(path);
        const out = [];
        for (let i = 0; i < data.length; i++) {
            const b = data[i];
            if (b === 0x0d) {
                out.push(0x0a);
                if (data[i + 1] === 0x0a)
                    i++;
            }
            else
                out.push(b);
        }
        return createHash('sha256').update(Buffer.from(out)).digest('hex');
    }
    catch (e) {
        return `读不了：${e.message}`;
    }
}
/** 读工具自己所在仓的 git 旁证。默认走加固环境：钩子注入的 GIT_DIR 会压过 `-C`，让这里读到调用方别的仓的 HEAD（错误旁证）。 */
function gitLine(args, here, env = hardenedEnv(process.env)) {
    let r;
    try {
        r = spawnSync('git', ['-C', here, ...args], { encoding: 'utf8', timeout: 60_000, env });
    }
    catch (e) {
        return [null, `跑不了 git：${e.message}`];
    }
    if (r.error)
        return [null, `跑不了 git：${r.error.message}`];
    if (r.status !== 0)
        return [null, `git 退出码 ${r.status}`];
    return [r.stdout ?? '', null];
}
function listJs(dir, base, out) {
    let names;
    try {
        names = readdirSync(dir).sort(cmpCodepoint);
    }
    catch {
        return;
    }
    for (const n of names) {
        const p = join(dir, n);
        let st;
        try {
            st = statSync(p);
        }
        catch {
            continue;
        }
        if (st.isDirectory())
            listJs(p, base, out);
        else if (n.endsWith('.js'))
            out.push(relative(base, p).split(sep).join('/'));
    }
}
/** 本次跑的这套检查器是哪一套。身份是**内容哈希**，不是提交号；提交号与 `--porcelain` 只作旁证与 dirty 标记。 */
export function toolIdentity(libDir = TOOL_LIB, contract = CONTRACT_PATH) {
    const rels = [];
    listJs(libDir, libDir, rels);
    const files = rels.map((rel) => [`lib/${rel}`, join(libDir, ...rel.split('/'))]).map(([rel, p]) => [rel, sha256File(p)]);
    files.push(['CONTRACT.md', sha256File(contract)]);
    const joined = files.map(([rel, h]) => `${rel} ${h}`).join('\n');
    const digest = createHash('sha256').update(joined, 'utf8').digest('hex');
    const [head, headErr] = gitLine(['rev-parse', 'HEAD'], libDir);
    const env = filterEnv(libDir, hardenedEnv(process.env));
    let dirty, detail;
    if (env === null) {
        dirty = null;
        detail = '列不出被扫仓的过滤器，未跑 git status';
    }
    else {
        const [porcelain, porErr] = gitLine(['status', '--porcelain', '--ignore-submodules=all', '--', libDir], libDir, env);
        if (porcelain === null) {
            dirty = null;
            detail = porErr ?? '';
        }
        else {
            const lines = porcelain.split('\n').filter((l) => pyStrip(l) !== '');
            dirty = lines.length > 0;
            detail = lines.slice(0, 12).map((l) => pyStrip(l)).join('；'); // py-semantics-ok: 数组切元素个数
        }
    }
    return { digest, files, git_head: pyStrip(head ?? '') || (headErr ?? ''), dirty, dirty_detail: detail };
}
export function identityLine(id) {
    const flag = id.dirty === true ? '工作区 dirty（哈希已含未提交改动）' : id.dirty === false ? '工作区干净' : `工作区状态未知：${id.dirty_detail}`;
    const head0 = String(id.git_head || '');
    const head = /^[0-9a-f]{7,64}$/.test(head0) ? head0.slice(0, 12) : `提交不可知（${head0 || '未知'}）`; // py-semantics-ok: 十六进制提交号，纯 ASCII
    return `检查器身份 · sha256:${id.digest.slice(0, 16)}（${id.files.length} 个文件，含 CONTRACT.md）· git ${head} · ${flag}`; // py-semantics-ok: 十六进制摘要，纯 ASCII
}
/** 逐文件哈希，写成本工具自己的 yaml 子集能解析的形状。 */
export function identityBlock(id) {
    const lines = [`tool_identity_digest: ${id.digest}`, `tool_identity_git_head: ${id.git_head || '未知'}`, `tool_identity_dirty: ${id.dirty === null ? 'None' : id.dirty ? 'True' : 'False'}`, 'tool_identity_files:'];
    for (const [rel, h] of id.files)
        lines.push(`  - ${rel} ${h}`);
    if (id.dirty_detail)
        lines.push(`tool_identity_dirty_detail: ${id.dirty_detail}`);
    return lines.join('\n');
}
function identityFinding(id) {
    return finding(IDENTITY_CHECK, SKIP, identityLine(id), {
        where: 'tools/std/',
        reason: '这不是判定，是记录，故不计三态。依据契约 §8：符合性报告不钉检查器版本身份就不可复算——曾发生过扫描期间检查器被并行改写，同一项目旧版 30 条 FAIL、新版 9 条，两份报告都自称是『对该项目的结论』',
        evidence: identityBlock(id),
    });
}
function identityVoidFinding(before, after) {
    return finding(IDENTITY_CHECK, UNDETERMINED, '扫描期间检查器自身被改动，本次结论作废', {
        where: 'tools/std/',
        reason: '扫描前后的检查器内容哈希不一致，说明这份报告是两套检查器混出来的，不可复算。请等检查器稳定后重跑（契约 §8）',
        why: '契约 §8 / 01 §2 N1：拿不准是哪一套跑出来的结论，不记通过也不记失败',
        evidence: `扫描前 ${identityBlock(before)}\n扫描后 ${identityBlock(after)}`,
    });
}
/** 收尾：再取一次身份，与开扫时比对。不一致就**整份作废**——把已有的 findings 全丢掉，只留一条未定。 */
export function sealed(findings, before, take = () => toolIdentity()) {
    const after = take();
    if (after.digest === before.digest)
        return findings;
    return [identityVoidFinding(before, after)];
}
// --------------------------------------------------------------------------
// 自检闸门与单个检查器的运行
// --------------------------------------------------------------------------
/**
 * 契约 §3：自检不过或没有自检的检查器，其结论作废。返回 `[ok, 闸门发现, 闸门这一次实际拿到的自检结果]`。
 * 第三项给 `--selftest` 分支原样打印：闸门是拿这一次的结果判的，报告展示的证据必须就是闸门据以放行的那份。
 * **禁止在这里做任何缓存**——入口冒烟自检会嵌套跑一遍完整扫描，缓存会跨嵌套泄漏。
 */
export function gatedBySelftest(name, mod) {
    const st = mod.selftest;
    if (typeof st !== 'function') {
        return [false, [finding(name, UNDETERMINED, '检查器没有自检', { kind: INTERNAL_ERROR_KIND, reason: '契约 §3 要求每个检查器自带反例；没有反例就无法证明它抓得住违规', why: '01 §5.6 守卫存在不等于守卫在执行' })], []];
    }
    let results;
    try {
        results = st.call(mod);
    }
    catch (exc) {
        return [false, [undeterminedFromException(name, exc, '跑自检')], []];
    }
    // 契约 §3：反例与正例至少各一条。空自检（或只有一条）照样放行，等于没有自检（D-123）
    if (!Array.isArray(results) || results.length < 2 || !results.every((r) => r !== null && typeof r === 'object' && !Array.isArray(r))) {
        return [false, [finding(name, UNDETERMINED, '检查器自检不足反例与正例各一条，其对本仓库的结论作废', {
                    kind: INTERNAL_ERROR_KIND,
                    reason: `selftest() 返回 ${Array.isArray(results) ? `${results.length} 条` : typeof results === 'object' ? 'object' : typeof results}；契约 §3 要求至少一条反例、一条正例`,
                    why: '契约 §3 / 01 §5.6：守卫存在不等于守卫在执行',
                })], Array.isArray(results) ? results : []];
    }
    const rs = results;
    const bad = rs.filter((r) => r.status !== PASS);
    if (bad.length) {
        return [false, [finding(name, UNDETERMINED, '检查器自检未通过，其对本仓库的结论作废', {
                    kind: INTERNAL_ERROR_KIND,
                    reason: bad.map((r) => `${r.title}（${r.evidence}）`).join('; '),
                    why: '契约 §3 / 01 §5.6：检查器故障按未定处置，不按通过记',
                })], rs];
    }
    return [true, [], rs];
}
/** 过自检闸门再跑一个检查器。检查器里的异常一律转未定（契约 §1），不带走整个进程。 */
export function runOne(name, mod, cfg) {
    const [ok, gate] = gatedBySelftest(name, mod);
    if (!ok)
        return gate;
    try {
        return [...(mod.run(cfg) ?? [])];
    }
    catch (exc) {
        return [undeterminedFromException(name, exc, `跑 ${name}`)];
    }
}
/** `tailoring[].check` 写了不存在的名字时裁剪不生效、检查照跑——项目以为关掉了，其实没有。每个认不出的名字记一条未定并列出可写的名字。 */
export function tailoringUnknown(cfg, mods = CHECKS) {
    const valid = new Set(mods.map((m) => m.NAME));
    for (const n of tailorableNames())
        valid.add(n);
    const out = [];
    const t = cfgGet(cfg, 'tailoring');
    for (const item of Array.isArray(t) ? t : []) {
        const name = item !== null && typeof item === 'object' && !Array.isArray(item) ? pyStrip(pyStr(item.check ?? '')) : '';
        if (name && !valid.has(name)) {
            out.push(finding('tailoring', UNDETERMINED, `裁剪项 check: ${name} 不对应任何检查器或工件，裁剪没有生效`, {
                kind: 'unknown-check', key: name,
                reason: `可写的名字：检查器短名 ${mods.map((m) => m.NAME).sort(cmpCodepoint).join('、')}，或 layout:<role>／<role>`,
                why: '契约 §5 tailoring：写错名字的裁剪静默失效，项目以为不适用的检查仍在跑、结论仍在计',
            }));
        }
    }
    return out;
}
/** 按已加载的 cfg 与检查器算各检查器的覆盖边界。 */
export function scopes(cfg, mods = CHECKS) {
    const out = {};
    for (const m of mods) {
        try {
            out[m.NAME] = m.scope(cfg);
        }
        catch (exc) {
            out[m.NAME] = { covered: [], not_covered: [`scope() 出错：${exc.message}`] };
        }
    }
    return out;
}
/** 跑全部检查。返回 `[findings, cfg]`——配置只在这里加载一次，渲染覆盖边界时由调用方把 cfg 传回去。 */
export function runAll(root, opts = {}) {
    const mods = opts.mods ?? CHECKS;
    const take = opts.identity ?? (() => toolIdentity());
    const findings = [];
    const before = take();
    findings.push(identityFinding(before));
    if (!mods.length) {
        findings.push(finding('check_all', UNDETERMINED, '没有发现任何检查器', { reason: '检查器表为空' }));
        return [findings, null];
    }
    if (opts.selftestOnly) {
        // 汇总层自己的自检（契约示例、入口冒烟、跨检查器、git 环境、stdlib 层）在 selftest.ts，由入口注入；次序与 Python 版相同：先汇总层自检，再逐个检查器
        if (opts.extraSelftest)
            findings.push(...opts.extraSelftest());
        for (const m of mods) {
            const [ok, gate, results] = gatedBySelftest(m.NAME, m);
            findings.push(...(ok ? results : gate)); // 打印闸门**这一次**拿到的那份结果，不再重跑一遍
        }
        return [sealed(findings, before, take), null];
    }
    const oldGit = (opts.gitProblem ?? gitVersionProblem)();
    if (oldGit) {
        findings.push(finding('check_all', UNDETERMINED, 'git 版本过旧，加固不生效，全部检查未定', { kind: 'git-too-old', reason: oldGit, why: '契约 §1：依赖不可用记未定；契约 §5：被扫仓配置里的外部程序一律压掉' }));
        return [sealed(findings, before, take), null];
    }
    const [cfg, problem] = loadConfig(root, opts.configPath ?? null);
    if (problem) {
        findings.push(finding('check_all', UNDETERMINED, '读不到项目配置，全部检查未定', { reason: problem, why: '契约 §5：缺配置不取默认值当事实' }));
        return [sealed(findings, before, take), null];
    }
    findings.push(...tailoringUnknown(cfg, mods));
    withScanMemo(root, () => {
        for (const m of mods)
            findings.push(...runOne(m.NAME, m, cfg));
        // 覆盖边界在封签之内、用同一份 ls-files 缓存算好，render 不再重算（契约 §4）
        cfg._scopes = scopes(cfg, mods);
    });
    joinExceptions(findings, cfg, opts.today);
    return [sealed(findings, before, take), cfg];
}
function configDir(cfg) {
    const path = cfg._path;
    if (!path)
        return null;
    const p = isAbsolute(path) ? path : join(cfg._root || '.', path);
    return dirname(resolve(p));
}
function rowsNote(items) {
    const head = items.slice(0, MAX_REGISTER_LISTED).map((r) => `第 ${r.lineno} 行 ${r.ex_id || '（无编号）'} 到期 ${r.expires}`).join('；'); // py-semantics-ok: 数组切元素个数
    return head + (items.length > MAX_REGISTER_LISTED ? `；……共 ${items.length} 行` : '');
}
/**
 * 把登记册里的行贴到未定发现上。**只在这里改 `registered`，不改 `status`**：状态、三态计数与逐条列出都不因登记而改变（01 §5.6），登记改变的只有退出码。
 * FAIL 不可登记——本工具的 FAIL 按契约 §1.1 只在项目声明的事实下产出，整块不适用走 `tailoring`，不走这里。
 */
export function joinExceptions(findings, cfg, todayIn) {
    const info = { path: null, display: null, valid: 0, expired: 0 };
    if (cfg === null || typeof cfg !== 'object')
        return info;
    cfg._exceptions = info;
    const today = todayIn ?? todayLocal();
    let rows, problems, src, own;
    try {
        const cdir = configDir(cfg);
        if (cdir === null)
            return info;
        [rows, problems, src, own] = loadExceptions(cdir, cfg._root ?? null, today);
    }
    catch (exc) { // 读登记册出错也是未定，不静默当成没有登记
        findings.push(undeterminedFromException(EXCEPTION_CHECK, exc, '读例外登记'));
        return info;
    }
    if (src === null)
        return info;
    const cfgPath = String(cfg._path ?? '');
    info.path = src;
    info.display = isAbsolute(cfgPath) ? src : join(dirname(cfgPath), 'exceptions.md').replaceAll('\\', '/');
    info.valid = rows.length;
    const base = `比较基准日 ${toIso(today)}（取自运行时系统日期）`;
    const byId = new Map();
    for (const f of findings)
        if (f.status === UNDETERMINED) {
            const a = byId.get(f.id);
            if (a)
                a.push(f);
            else
                byId.set(f.id, [f]);
        }
    const expired = [], orphan = [];
    for (const row of rows) {
        const hit = byId.get(row.rule);
        if (!hit) {
            orphan.push(row);
            continue;
        } // 含匹配到 PASS/SKIP/FAIL：死行不留，免得日后条件变了静默复活
        if (compareDays(row.expires_date, today) < 0) {
            expired.push(row);
            continue;
        }
        for (const f of hit)
            f.registered = { id: row.ex_id, expires: row.expires };
    }
    // 「有效」按契约 §9 指五项齐全、表行合格，与「未过期」不同义：过期的行仍是有效行，只是不再改变退出码
    info.expired = expired.length;
    if (problems.length) {
        findings.push(finding(EXCEPTION_CHECK, UNDETERMINED, `例外登记里有 ${problems.length} 行不合格，未生效`, {
            where: info.display, kind: 'invalid-rows',
            reason: problems.slice(0, MAX_REGISTER_LISTED).join('；') + (problems.length > MAX_REGISTER_LISTED ? `；……共 ${problems.length} 行` : ''), // py-semantics-ok: 数组切元素个数
            why: '契约 §9：登记行要能被复核，规则、理由、范围、批准人、到期五项缺一即不算登记', evidence: base,
        }));
    }
    if (expired.length) {
        findings.push(finding(EXCEPTION_CHECK, UNDETERMINED, `例外登记里有 ${expired.length} 行已过期，它登记的发现回到未登记`, {
            where: info.display, kind: 'expired', reason: rowsNote(expired),
            why: '契约 §9：到期由工具按运行日校验；过期的登记不再改变退出码——没有到期的登记就是一键静音，那正是登记要带到期的理由', evidence: base,
        }));
    }
    if (orphan.length) {
        findings.push(finding(EXCEPTION_CHECK, UNDETERMINED, `例外登记里有 ${orphan.length} 行的规则匹配不到本次任何未定发现`, {
            where: info.display, kind: 'orphan',
            reason: orphan.slice(0, MAX_REGISTER_LISTED).map((r) => `第 ${r.lineno} 行 ${r.ex_id || '（无编号）'}：${r.rule}`).join('；') + (orphan.length > MAX_REGISTER_LISTED ? `；……共 ${orphan.length} 行` : ''), // py-semantics-ok: 数组切元素个数
            why: '契约 §9：规则列写的是 Finding id；对不上的行要么判据已变、要么抄错，两种都不该留在册子里当作还在生效', evidence: base,
        }));
    }
    findings.push(...ownExceptions(own, info.display, today, base));
    return info;
}
/**
 * 项目自有例外行（规则列不含 `/`，如依赖规则、依赖审计的门号例外）：只按到期判。不登记、不校验五项（那是项目的门，不是本工具的发现）；
 * 但 02 §4「到期未清理 CI 转红」对它们同样成立：未关闭且已过期判 FAIL（FAIL 不可登记）；到期写不成日期记未定。
 */
export function ownExceptions(own, where, today, base) {
    const why = '02 §4：依赖规则的例外登记在 governance/exceptions.md，带到期；到期未清理 CI 转红（01 §8：例外记录含到期，不能只是一份让检查永久跳过的名单）';
    const out = [], undated = [], far = [];
    const limit = addDays(today, EXCEPTION_MAX_DAYS);
    for (const r of own) {
        const label = `第 ${r.lineno} 行 ${r.ex_id || r.rule || '（无编号）'}`;
        if (r.expires_date === null)
            undated.push(`${label}：${r.error}`);
        else if (compareDays(r.expires_date, limit) > 0)
            far.push(`${label} 到期 ${toIso(r.expires_date)}`);
        else if (compareDays(r.expires_date, today) < 0) {
            out.push(finding(EXCEPTION_CHECK, FAIL, `项目例外 ${label} 已于 ${toIso(r.expires_date)} 到期，未关闭`, {
                where, kind: 'own-expired', key: r.ex_id || r.rule || String(r.lineno), why,
                reason: '清理这条例外（修掉偏离后在状态列写处理方式，如「已处理」「关闭」），或经批准人重新评估后改到期',
                evidence: `${base}；规则列：${r.rule || '（空）'}`,
            }));
        }
    }
    if (far.length) {
        out.push(finding(EXCEPTION_CHECK, UNDETERMINED, `有 ${far.length} 行项目例外的到期晚于上限 ${toIso(limit)}（运行日起 ${EXCEPTION_MAX_DAYS} 天）`, {
            where, kind: 'own-too-far', why: `${why}；契约 §9：到期不得晚于运行日 + 365 天`,
            reason: far.slice(0, MAX_REGISTER_LISTED).join('；') + (far.length > MAX_REGISTER_LISTED ? `；……共 ${far.length} 行` : ''), evidence: base, // py-semantics-ok: 数组切元素个数
        }));
    }
    if (undated.length) {
        out.push(finding(EXCEPTION_CHECK, UNDETERMINED, `有 ${undated.length} 行项目例外的到期写不成日期，到没到期判不了`, {
            where, kind: 'own-undated', why,
            reason: undated.slice(0, MAX_REGISTER_LISTED).join('；') + (undated.length > MAX_REGISTER_LISTED ? `；……共 ${undated.length} 行` : ''), evidence: base, // py-semantics-ok: 数组切元素个数
        }));
    }
    return out;
}
// --------------------------------------------------------------------------
// 报告
// --------------------------------------------------------------------------
/** `--config` 给的配置落在被扫描项目之外还是之内。返回 `[true|false|null, 原因]`。非绝对的 `_path` 先接到 root 上再归一化；前缀比较必须**带分隔符**。 */
export function configOutsideRoot(root, path) {
    let r, p;
    try {
        const rawRoot = String(root || '.');
        let rawPath = String(path);
        if (!isAbsolute(rawPath))
            rawPath = join(rawRoot, rawPath);
        r = resolve(rawRoot);
        p = resolve(rawPath);
    }
    catch (e) {
        return [null, `路径归一化失败：${e.name}: ${e.message}`];
    }
    r = r.replace(new RegExp(`${sep === '\\' ? '\\\\' : sep}+$`), '');
    if (p === r)
        return [false, ''];
    return [!p.startsWith(r + sep), ''];
}
// 文件名、摘录都来自被扫仓：换行能在第 0 列伪造「结论：」行，ESC 等能操纵终端。制表符放行。
// U+2028/2029 会被 splitlines 当换行；双向控制符（U+200E/F、202A–202E、2066–2069）能把后文翻到行首显示
const CTRL_RE = /[\x00-\x08\x0a-\x1f\x7f-\x9f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
/** 转义控制字符。block（原因／依据／证据）保留换行，但续行一律缩进 8 格，没有一行从第 0 列开始。 */
export function safe(value, block = false) {
    const esc = (s) => s.replace(CTRL_RE, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
    const s = String(value);
    return block ? s.split('\n').map(esc).join('\n' + ' '.repeat(8)) : esc(s);
}
/** 渲染。cfg 是 runAll 已经加载好的配置；为 null 表示配置根本没读进来，此时不打覆盖边界（那是假边界）。 */
export function render(findings, root, cfg, showScope = true, mods = CHECKS) {
    const buf = [];
    const counts = { [PASS]: 0, [FAIL]: 0, [UNDETERMINED]: 0, [SKIP]: 0 };
    for (const f of findings)
        counts[f.status] = (counts[f.status] ?? 0) + 1;
    buf.push(`标准检查 · ${safe(resolve(root))}`);
    for (const f of findings) {
        if (f.check === IDENTITY_CHECK && f.status === SKIP) {
            buf.push(safe(f.title));
            break;
        }
    }
    if (cfg && cfg._path) {
        const [outside, whyOutside] = configOutsideRoot(String(cfg._root ?? root), String(cfg._path));
        const shown = safe(cfg._path);
        if (outside === true)
            buf.push(`配置 · ${shown}（外部配置，不在被扫描项目内）`);
        else if (outside === false)
            buf.push(`配置 · ${shown}（在被扫描项目内）`);
        else
            buf.push(`配置 · ${shown}（在不在项目内判不了：${safe(whyOutside)}）`);
        const ex = (cfg._exceptions ?? {});
        if (!ex.display)
            buf.push('登记 · 无');
        else if (ex.expired)
            buf.push(`登记 · ${safe(ex.display)}（${ex.valid ?? 0} 行有效，其中 ${ex.expired} 行已过期）`);
        else
            buf.push(`登记 · ${safe(ex.display)}（${ex.valid ?? 0} 行有效）`);
    }
    const registered = findings.filter((f) => f.status === UNDETERMINED && f.registered);
    const nReg = registered.length;
    const nUnreg = counts[UNDETERMINED] - nReg;
    buf.push(`  通过 ${counts[PASS]}   失败 ${counts[FAIL]}   未定 ${counts[UNDETERMINED]}（已登记 ${nReg} · 未登记 ${nUnreg}）   不适用 ${counts[SKIP]}`);
    buf.push('');
    for (const [status, label] of [[FAIL, '失败'], [UNDETERMINED, '未定'], [SKIP, '不适用']]) {
        let items = findings.filter((f) => f.status === status);
        if (!items.length)
            continue;
        if (status === UNDETERMINED)
            items = [...items.filter((f) => !f.registered), ...items.filter((f) => f.registered)]; // 先未登记后已登记：要处置的排在前面
        buf.push(`${label}（${items.length}）`);
        for (const f of items) {
            const loc = f.where ? `  [${f.where}]` : '';
            const reg = f.registered;
            const tag = reg ? `（已登记 ${reg.id || '（无编号）'}，到期 ${reg.expires}）` : '';
            buf.push(`  · ${safe(f.title + tag + loc)}`);
            buf.push(`      id：${safe(f.id)}`);
            for (const [key, prefix] of [['reason', '原因'], ['why', '依据'], ['evidence', '证据']]) {
                if (f[key])
                    buf.push(`      ${prefix}：${safe(f[key], true)}`);
            }
        }
        buf.push('');
    }
    if (showScope) {
        buf.push('覆盖边界（没检查的不等于没问题）');
        if (cfg === null)
            buf.push('  未定：配置没读进来，本次覆盖边界无法给出。');
        else {
            const sc = cfg._scopes ?? scopes(cfg, mods);
            for (const name of Object.keys(sc).sort(cmpCodepoint)) {
                buf.push(`  ${name}`);
                for (const line of sc[name].not_covered ?? [])
                    buf.push(`    不看：${safe(line)}`);
            }
        }
        buf.push('');
    }
    if (counts[FAIL])
        buf.push('结论：FAIL。');
    else if (nUnreg)
        buf.push(`结论：未定 —— 有 ${nUnreg} 项没能判定且未登记${nReg ? `，另有 ${nReg} 项已登记` : ''}。**未定不是通过**（01 §2 N1）。`);
    else if (nReg) {
        const soonest = registered.map((f) => f.registered.expires).sort(cmpCodepoint)[0];
        buf.push(`结论：无未登记的未定；仍有 ${nReg} 项已登记未定（最近到期 ${soonest}）。未定不是通过（01 §2 N1），退出码 0 只表示全部未定都已登记。`);
    }
    else
        buf.push('结论：本次实际执行的检查全部通过。通过只覆盖上面列出的范围。');
    return buf.join('\n');
}
/** 退出码：有 FAIL → 1；无 FAIL 但有**未登记**的未定 → 2；否则 0。已登记的未定仍是未定，只是不再挡门（契约 §9）。 */
export function exitCode(findings) {
    if (findings.some((f) => f.status === FAIL))
        return 1;
    if (findings.some((f) => f.status === UNDETERMINED && !f.registered))
        return 2;
    return 0;
}
