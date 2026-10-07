// 采用记录：项目有没有记下自己采用的是标准的哪一版（顺带看有没有采用日期），及项目级声明 `compatibility.policy`。
// 对应 tools/std/checks/check_adoption.py；契约见 tools/std/CONTRACT.md。
//
// 执行 01 §8「采用、例外与升级」第一条（项目记录采用的标准版本 `governance/STANDARD_VERSION`），并接住 01 §4.7「标准升级」那一行的验收判据（`STANDARD_VERSION` 与差异记录一致）。
//
// **本检查主要判「记没记」；「记得对不对」一处也不判**：版本值背后的 tag 是否真的存在，要么访问远端、要么读 `.std/` 之外的 git 元数据，本工具两样都不做：不联网、不越出被扫项目。
// 读到的值原样写进 evidence 供人核，**不与工具侧任何常量比对**——这条硬约束由 `selftest` 里的变异验证守着，不是靠本段注释。
//
// 与 Python 版的有意差异（设计 §12.28，D-135 废弃技术栈，逐条经用户决定）：不迁移——
//   · 内嵌 `.std/` 机制：版本值与内嵌 README 修订号比对、内嵌目录只读（git status）、及其三个 finding id（embedded-*、version-mismatch）；采用项目不再内嵌 `.std/`；
//   · 免审批清单（读 Claude Code 的 `.claude/settings.json`）：`_settings_allow`、`_wildcard_allow` 及它们的 5 个 finding id、自检；该宿主已废弃，DSH 的审批策略是会话级旋钮，没有项目级入库清单可读；
//   · 因此黄金样本里的 `adoption/60a5c980`（内嵌只读，非内嵌运行不适用）与 `adoption/settings-absent` 两条 SKIP 预期消失，见 golden/expected-changes.json。
//
// 迁移约束：与 Python 版逐 id 相同（黄金样本，上述预期消失的除外）。动笔前对每个 Python 字符串、正则、容器操作都问过「JS 里对应的在非 ASCII、非 BMP、边界值上等价吗」并在 Python 上实测（设计 §12.22）：
//   `str.strip()` / `splitlines()`   → `pyStrip` / `splitLinesPy`（D6）
//   `[一-鿿]+`                        → 同一个码点范围 U+4E00–U+9FFF，JS 的 `u` 模式下写法相同
//   `[:300]`、`[:200]`               → `headChars`（D18，按码点）
//   `"%s" % value`                    → `pyStr`（映射与嵌套容器按 repr，见 core/cfg 与 golden/unit/pystr.json）
import { mkdtempSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cfgGet, pyStr, pyTruthy } from '../core/cfg.js';
import { headChars, isTailoredOut } from '../core/docs.js';
import { FAIL, PASS, SKIP, UNDETERMINED, finding, pyStrip } from '../core/finding.js';
import { writeText } from '../core/fixture.js';
import { inside, isFile, readText } from '../core/fs.js';
import { probe, outsideRoot, unreadable } from '../core/shell.js';
import { splitLinesPy } from '../core/yaml.js';
export const NAME = 'adoption';
export const STANDARD_REFS = ['01 §8', '01 §4.7', '01 §3.1', '01 §5.3'];
// 位置由 01 §3.1 的文档树定死（`governance/ └─ STANDARD_VERSION  采用的标准版本`），不做成配置项：再加一个 layout 键，就等于让被检查方自己指定这条判据看哪儿。
// 项目把它挪了位置，本检查会报 FAIL 而不是四处去找——见 scope().not_covered。
const REL = 'governance/STANDARD_VERSION';
// 版本值可以是首行裸值（示例项目的实物形状），也可以写成 `version: 1.0`。
const VERSION_KEYS = ['standard_version', 'version', 'adopted_version', '标准版本', '采用版本'];
// 采用日期不是标准原文的要求（01 §8 只要求记录版本），这几个字段名是本工具的约定：按契约 §1.1，命中记 PASS，落空只记未定。
const ADOPTED_KEYS = ['adopted_at', 'adopted', 'adoption_date', '采用日期', '采用时间'];
// `^([A-Za-z_][A-Za-z0-9_.\-]*|[一-鿿]+)\s*:\s*(.*)$`：`\s` 是 Python 的空白集合（D6），`.` 取到行尾（行里没有 `\n`，splitlines 之后不会有）
const WS = '[\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const KEY_LINE = new RegExp(`^([A-Za-z_][A-Za-z0-9_.\\-]*|[\\u4e00-\\u9fff]+)${WS}*:${WS}*([^\\n]*)(?=\\n?$)`, 'u');
/** 把 STANDARD_VERSION 拆开。返回 [版本值, 采用日期, 键值对列表]。
 *
 * 实物形状取自 `标准/示例项目-连锁零售中台/governance/STANDARD_VERSION`：
 *     1.0
 *     adopted_at: 2025-03-03
 *     last_evaluated_upgrade: 2026-09-07 (no newer version)
 * 首行是**裸的版本值**，其后是 `键: 值`。所以判据是：第一条不含键冒号的非空行即版本值；也接受 `version: 1.0` 这种写法。`#` 开头的行当注释。
 * 这不是 YAML——`parseYamlSubset` 会在首行那个裸值上直接抛错。 */
export function parse(text) {
    let version = null, adopted = null;
    const pairs = [];
    for (const raw of splitLinesPy(text)) {
        const line = pyStrip(raw);
        if (!line || line.startsWith('#'))
            continue;
        const m = KEY_LINE.exec(line);
        if (!m) {
            if (version === null)
                version = line;
            continue;
        }
        const key = pyStrip(m[1]), val = pyStrip(m[2]);
        pairs.push([key, val]);
        const low = key.toLowerCase();
        if (version === null && VERSION_KEYS.includes(low) && val)
            version = val;
        else if (adopted === null && ADOPTED_KEYS.includes(low) && val)
            adopted = val;
    }
    return [version, adopted, pairs];
}
export function scope(cfg) {
    void cfg;
    return {
        covered: [
            `${REL} 是否存在、是否非空`,
            '能否从中读出**版本值**（首行裸值，或 version/standard_version 键）',
            '能否从中读出**采用日期**（adopted_at 或等价键；字段名是本工具的约定，落空只记未定）',
            '把读到的版本值原样写进证据，供人核',
            '配置里有没有非空的 compatibility.policy（01 §5.3 必填，不分档），没有判 FAIL',
            'tailoring 裁掉本检查时，compatibility.policy 不可裁剪、照判，其余记 SKIP',
        ],
        not_covered: [
            '不验证读到的版本值背后的 tag 是否真实存在——核实它要联网或读被扫项目之外的 git 元数据，本工具两样都不做',
            '不与工具侧任何常量比对（check_all 的 _SMOKE_CONFIG、check_layout 的 _SNAPSHOT_DATE 都不比）；拿工具自己的常量当真相比，结论就是编的',
            '不判裁剪内容是否合理、是否完整——那是内容判断，契约 §7 说了不做',
            '不判裁剪登记齐不齐：裁剪的权威位置是 governance/project.yaml 的 tailoring（01 §3.2 职责卡的权威域逐字含『裁剪与派生登记』），本文件只承载采用的标准修订；' +
                '规则本身还不存在，按契约 §4『why 追不到标准条款的检查项不进本工具』，本检查对该项不产出任何发现：调和该由上游做，不由每份报告里塞一条恒定未定代劳',
            '不核实 adopted_at 的日期是否属实，也不判它与版本发布时间的先后',
            `只看 ${REL} 这一个位置：01 §3.1 把它定在这里，项目挪了位置本检查报缺失而不去猜`,
            'compatibility.policy 只判有没有，不判写得对不对、是否覆盖数据/接口/配置/旧客户端四项（契约 §7）',
        ],
    };
}
export function run(cfg) {
    // compatibility.policy 必填不可裁剪（D-126），照判；其余的随裁剪记 SKIP
    const [tailored, reason] = isTailoredOut(cfg, NAME);
    if (tailored)
        return [finding(NAME, SKIP, '项目已裁剪本检查（compatibility.policy 不可裁剪，照判）', { reason: reason || 'project.yaml 未写理由' }), compatibility(cfg)];
    // 注意：Python 版 run() 没有包 run_guarded（直接 `_version + [_compatibility]`），内部异常向上抛、由 check_all 的外层兜；这里保持一致，不加 runGuarded
    return [...version(cfg), compatibility(cfg)];
}
/** 全文非空行（去首尾空白）用「；」连起来，取前 200 个码点；空文件写「（空文件）」。进 evidence，所以要与 Python 逐字相同。 */
export function rawHead(text) {
    return headChars(splitLinesPy(text).map(pyStrip).filter((l) => l).join('；'), 200) || '（空文件）';
}
function version(cfg) {
    const root = cfg._root || '.';
    const path = join(root, 'governance', 'STANDARD_VERSION');
    if (!inside(root, path))
        return [outsideRoot(NAME, REL)]; // 先护栏：出仓的不探测在不在（R1-07）
    if (!isFile(path)) {
        return [finding(NAME, FAIL, `缺 ${REL}：没有记录采用的是标准的哪一版`, {
                where: REL,
                why: '01 §8 第一条：项目记录采用的标准版本（governance/STANDARD_VERSION），标准升级由项目显式评估、不在任务中自动跟随——没有这份记录，' +
                    '『我原来是哪一版』无从回答，§4.7『标准升级』那一行也就没有可执行的起点',
                evidence: `按 cfg[_root] 拼出的路径不存在：${path}`,
            })];
    }
    let text;
    try {
        text = readText(path, root);
    }
    catch (exc) {
        return [unreadable(NAME, REL, exc)];
    }
    const out = [];
    const [ver, adopted] = parse(text);
    const head = rawHead(text);
    if (!ver) {
        out.push(finding(NAME, FAIL, `${REL} 在，但读不出版本值`, {
            where: `${REL}:1`,
            why: '01 §8 第一条要求记录的是**采用的标准版本**；文件存在而没有版本值，记录形式在、内容不在，等于没记（契约 §1：不把『有个文件』升格成通过）',
            evidence: `全文非空行：${head}\n判据：第一条不含键冒号的非空行即版本值，或 ${VERSION_KEYS.join('/')} 这几个键之一有值`,
        }));
    }
    else {
        out.push(finding(NAME, PASS, `${REL} 记了版本值`, {
            where: `${REL}:1`, why: '01 §8 第一条：项目记录采用的标准版本',
            evidence: `读到的版本值（原样）：${ver}\n不核实该值背后的 tag 是否真实存在（要联网或读仓外 git 元数据，本工具不做），也不与工具侧任何常量比对——拿工具自己的常量当真相比，结论就是编的。值原样列在这里，供人核。`,
        }));
    }
    const whyDate = '01 §8 第一条：『项目记录采用的标准版本（`governance/STANDARD_VERSION`）』；01 §4.7『标准升级』行的验收判据：『`STANDARD_VERSION` 与差异记录一致』——采用日期是对账时的线索，不是标准原文的要求';
    if (!adopted) {
        out.push(finding(NAME, UNDETERMINED, `${REL} 里没找到采用日期`, {
            where: REL, kind: 'adopted-date-missing',
            reason: `日期字段名是本工具的约定（${ADOPTED_KEYS.join('/')}），没找到只说明不在约定处，推不出没记（契约 §1.1）；加一行 \`adopted_at: <日期>\` 即得通过`,
            why: whyDate, evidence: `全文非空行：${head}`,
        }));
    }
    else {
        out.push(finding(NAME, PASS, `${REL} 记了采用日期`, {
            where: REL, why: whyDate, evidence: `读到的采用日期（原样）：${adopted}\n本检查不核实这个日期是否属实，也不判它与版本发布的先后。`,
        }));
    }
    return out;
}
/** 01 §5.3：`project.yaml` 的 `compatibility.policy` 必填。 */
export function compatibility(cfg) {
    const rawPath = cfg._path;
    const where = pyTruthy(rawPath) ? pyStr(rawPath) : 'governance/project.yaml';
    const why = '01 §5.3：`project.yaml` 的 `compatibility.policy` 必填——数据、接口、配置、旧版本客户端各支持到什么程度；未上线项目可选破坏性重构，但要记录前提';
    const val = cfgGet(cfg, 'compatibility.policy');
    // Python：`val is None or val is False or (isinstance(val, (str, list, dict)) and not val)`——0 与 0.0 不算缺（只有 None、False、空串、空列表、空映射算缺）
    const missing = val === undefined || val === null || val === false || ((typeof val === 'string' || typeof val === 'object') && !pyTruthy(val));
    if (missing) {
        return finding(NAME, FAIL, '配置里没有 compatibility.policy', {
            where, kind: 'compatibility-policy', why,
            reason: `在 ${where} 里加 \`compatibility:\` 下的 \`policy:\`，写明数据、接口、配置、旧版本客户端各支持到什么程度；未上线的写明“可破坏性重构”及其前提`,
        });
    }
    return finding(NAME, PASS, '配置里写了 compatibility.policy', { where, kind: 'compatibility-policy', why, evidence: `原样值：${pyStr(val)}（内容写得对不对不判，契约 §7）` });
}
// --------------------------------------------------------------------------
// 自检（契约 §3）
// --------------------------------------------------------------------------
const COMPLETE = '1.0\nadopted_at: 2025-03-03\nlast_evaluated_upgrade: 2026-09-07 (no newer version)\n';
/** 摆一份 STANDARD_VERSION（content 为 null 表示不摆）。返回 cfg。 */
function put(tmp, content) {
    const gov = join(tmp, 'governance');
    mkdirSync(gov, { recursive: true });
    const path = join(gov, 'STANDARD_VERSION');
    if (content === null) {
        try {
            unlinkSync(path);
        }
        catch { /* 本来就没有 */ }
    }
    else
        writeText(path, content);
    return { _root: tmp, compatibility: { policy: '未上线，可破坏性重构' } };
}
const statuses = (runFn, cfg) => runFn(cfg).map((f) => f.status);
const J = (v) => JSON.stringify(v);
/**
 * 同一份完整文件，只换版本值，判定必须**完全一样**。
 * 这就是「不与工具侧任何常量比对」这条硬约束的可执行形态：一旦实现里出现了任何「值等于某常量才算数」的比对，两次判定就会分叉，本探针当场分辨得出来。
 */
function valueInsensitive(runFn, tmp) {
    const a = statuses(runFn, put(tmp, '9.9-一个不存在的版本\nadopted_at: 2025-03-03\n'));
    const b = statuses(runFn, put(tmp, '2026-09-10\nadopted_at: 2025-03-03\n'));
    return [J(a) === J(b), [a, b]];
}
/** 变异体：故意去做契约禁止的「与工具侧常量比对」。它的用途只有一个——证明下面那条「版本值不参与判定」的探针真的会报警，而不是一条永远绿的注释。 */
const MUTANT_TOOL_VERSION = '2026-09-10';
function runMutant(cfg) {
    const out = run(cfg);
    const root = cfg._root || '.';
    let ver;
    try {
        ver = parse(readText(join(root, 'governance', 'STANDARD_VERSION')))[0];
    }
    catch {
        return out;
    }
    if (ver && ver !== MUTANT_TOOL_VERSION)
        out.push(finding(NAME, FAIL, '版本值与工具侧常量不一致（变异体）', { where: REL, why: '变异体故意违反契约：拿没有可比制品的值去比对' }));
    return out;
}
export function selftest() {
    const results = [];
    // 注意：Python 版各条的期望状态元组里还有「内嵌只读」「免审批清单」两条 SKIP——不迁，所以这里每个期望都少 2 个 SKIP
    const cases = [
        [null, [FAIL, PASS], '反例：文件缺失应判 FAIL（01 §8 第一条）'],
        ['\n   \n', [FAIL, UNDETERMINED, PASS], '反例：空文件——版本读不出判 FAIL，采用日期读不出记未定'],
        ['adopted_at: 2025-03-03\n', [FAIL, PASS, PASS], '反例：只有采用日期、读不出版本值应判 FAIL'],
        ['1.0\n', [PASS, UNDETERMINED, PASS], '只有版本值、没有采用日期记未定：日期字段名是工具约定，落空不判 FAIL（契约 §1.1）'],
        [COMPLETE, [PASS, PASS, PASS], '正例：示例项目的实物形状应判 PASS，本检查器对该输入不再产出任何未定'],
    ];
    const tmp = mkdtempSync(join(tmpdir(), 'adself-'));
    try {
        for (const [content, want, title] of cases) {
            const got = statuses(run, put(tmp, content));
            results.push(probe(NAME, J(got) === J(want), title, { evidence: `期望 ${J(want)}，实得 ${J(got)}`, why: '契约 §3 静默失效探测' }));
        }
        {
            // 正例的证据里必须真的带上原样值与那句「不核实 tag、不比常量」的限定，否则「把值写进报告供人核」这件事就没落地。
            const fs = run(put(tmp, COMPLETE));
            const ev = fs[0].evidence;
            const ok = ev.includes('1.0') && ev.includes('不核实该值背后的 tag 是否真实存在') && ev.includes('不与工具侧任何常量比对');
            results.push(probe(NAME, ok, '正例的证据里带原样版本值与『不核实 tag、不比工具常量』的限定', {
                evidence: `evidence 首 120 字：${headChars(ev, 120).replaceAll('\n', ' / ')}`, why: '契约 §4：evidence 要可复算；A2 的落点是把值写进报告供人核',
            }));
        }
        {
            // compatibility.policy（01 §5.3）：缺、空串、空映射、空列表、false 判 FAIL；有值（含映射）PASS。
            // 这条替换 Python 版 `adoption/d5d57eb2`——它把 compatibility.policy 与免审批清单的通配放行合在一条探针里，后一半随废弃宿主一起删，前一半在这里单独守护（golden/expected-changes.json 的 added_probes）。
            const cfgs = [{}, { compatibility: {} }, { compatibility: { policy: '' } }, { compatibility: { policy: [] } }, { compatibility: { policy: false } }, { compatibility: { policy: 'x' } }, { compatibility: { policy: { data: '两个版本' } } }, { compatibility: { policy: 0 } }];
            const cs = cfgs.map((c) => compatibility(c).status);
            results.push(probe(NAME, J(cs) === J([FAIL, FAIL, FAIL, FAIL, FAIL, PASS, PASS, PASS]), 'compatibility.policy 缺、空串、空列表、false 判 FAIL；有值（字符串、映射、0）PASS', {
                evidence: `实得 ${J(cs)}`, why: '01 §5.3 compatibility.policy 必填；契约 §3',
            }));
        }
        {
            // 变异验证
            const [okReal, detailReal] = valueInsensitive(run, tmp);
            const [okMut, detailMut] = valueInsensitive(runMutant, tmp);
            results.push(probe(NAME, okReal && !okMut, '变异验证：真实现对版本值不敏感，而『去比对工具常量』的变异体被探针抓住', {
                evidence: `真实现两次判定 ${J(detailReal)} → 一致=${okReal}；变异体两次判定 ${J(detailMut)} → 一致=${okMut}`,
                why: '契约 §3：守卫存在不等于守卫在执行——『不与工具侧常量比对』这条硬约束必须被测试守着，不能只写在注释里',
            }));
        }
    }
    finally {
        rmSync(tmp, { recursive: true, force: true });
    }
    return results;
}
