// git 子进程的环境加固与最小封装（对应 tools/std/stdlib.py 的 GIT_LOCAL_ENV / GIT_HARDEN_* / git_version_problem / filter_env / tracked_files / shallow_problem）。
//
// 威胁模型：被扫仓的 `.git/config` 是**被扫方写的**——压缩包、共享目录带进来的仓，配置里可以写任何命令，本工具的每个 `git -C <被扫仓>` 都会照它执行
// （实测 core.fsmonitor、blame 的 textconv、clean 过滤器、diff.external、log.showSignature 加 gpg.program 都会跑）。
// 另一个真实事故：从 git worktree 提交时钩子里有绝对路径的 GIT_DIR，它压过 `-C`，夹具的 git 命令整批落进真实仓、把 core.bare 改成 true。
//
// **责任划分（迁移 check_drift 与 check_freshness 时不能漏）**：本模块挡的是配置里写死的东西（fsmonitor、diff.external、pager、gpg、hooksPath、过滤器）。
// 挡不了的有两类，要**调用方**自己写在命令行上：①`diff.<驱动>.textconv`——驱动名由被扫方起、列不全，所以会读工作区内容的 `git blame` 必须带 `--no-textconv`
// （Python 版 check_drift 就这么写）；②路径要按字面——`git log`/`git ls-files` 前加 `--literal-pathspecs`（Python 版 check_derived、check_freshness 如此），
// 否则文件名里的 `*`、`:` 会被当成 pathspec 魔法。这两条在迁移对应检查器时有专门的测试钉住，**不指望靠本模块兜底**。
//
// 与 Python 版的有意差异见设计 §12.6 D9：①取值保持 `true`（不改空串）；②**永不写 process.env**——每次 spawn 显式传 env 对象，
// `core/git` 只提供「构造子进程环境」的纯函数。TS 模块可能被 DSH 的插件宿主加载，改宿主进程的环境会泄漏到别的插件。
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { devNull } from 'node:os';
import { pyStrip } from './finding.js';
/**
 * git 跑钩子时注入的仓库定位变量，取自 `git rev-parse --local-env-vars`（git 自己进入另一个仓库前清掉的就是这张表）。
 * 显式的 GIT_DIR 压过 `-C`。GIT_CEILING_DIRECTORIES 不在表里：它只挡上溯、不改定位。
 */
export const GIT_LOCAL_ENV = [
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
    'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE',
    'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX',
    'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR',
];
/**
 * 经 GIT_CONFIG_COUNT 注入的是命令行级配置（git ≥ 2.31），优先级高于任何配置文件，一处设好全部子进程生效。
 * 取值里不放空串（D9）：Python 版在 Windows 上 `os.environ[k] = ""` 不传给子进程，所以这四项用 `true`（命令名；调用时该程序不存在或什么都不做即安全，
 * 且不是被扫方可控的字符串）代替空串。TS 里空串能传，但保持原取值：行为不变，且 `true` 的语义已被 Python 版的安全审计认可。
 */
export const GIT_HARDEN_CONFIG = [
    ['core.fsmonitor', 'false'], ['core.hooksPath', devNull], ['core.sshCommand', 'true'],
    ['core.gitProxy', 'true'], ['core.askPass', 'true'], ['diff.external', 'true'], ['core.pager', 'cat'],
    // log.showSignature=true 时 `git log` 会对签名提交调 gpg.program（被扫方可指定任意程序）
    ['log.showSignature', 'false'],
];
/** GIT_OPTIONAL_LOCKS=0：扫描不刷新、不回写被扫仓的 index（只读扫描不该有写入）。 */
export const GIT_HARDEN_ENV = [
    ['GIT_PAGER', 'cat'], ['GIT_TERMINAL_PROMPT', '0'], ['GIT_OPTIONAL_LOCKS', '0'],
];
/** GIT_CONFIG_COUNT 注入要 git ≥ 2.31；更老的 git 静默忽略这些变量，上面的加固全部失效。 */
export const GIT_MIN_VERSION = [2, 31];
/**
 * 构造加固后的子进程环境：从 base 去掉 GIT_LOCAL_ENV 与已有的 GIT_CONFIG_KEY_n/VALUE_n，再注入加固配置。
 * **纯函数，不读也不写 process.env**（D9）：base 由调用方传入（通常是 `process.env` 的拷贝）。
 */
export function hardenedEnv(base) {
    const env = { ...base };
    for (const key of GIT_LOCAL_ENV)
        delete env[key];
    for (let i = 0; i < 64; i++) {
        if (!(`GIT_CONFIG_KEY_${i}` in env))
            break;
        delete env[`GIT_CONFIG_KEY_${i}`];
        delete env[`GIT_CONFIG_VALUE_${i}`];
    }
    env.GIT_CONFIG_COUNT = String(GIT_HARDEN_CONFIG.length);
    GIT_HARDEN_CONFIG.forEach(([k, v], i) => {
        env[`GIT_CONFIG_KEY_${i}`] = k;
        env[`GIT_CONFIG_VALUE_${i}`] = v;
    });
    for (const [k, v] of GIT_HARDEN_ENV)
        env[k] = v;
    return env;
}
/**
 * git 低于 GIT_MIN_VERSION 或认不出版本时返回原因串，否则 null（git 跑不起来也返回 null——那时每个 git 读点各自记未定）。
 * `out` 只为自检注入 `git version` 的输出。
 */
export function gitVersionProblem(out) {
    let text = out;
    if (text === undefined) {
        try {
            const r = spawnSync('git', ['version'], { encoding: 'utf8', timeout: 60_000 });
            if (r.error || r.status === null)
                return null;
            text = r.stdout;
        }
        catch {
            return null;
        }
    }
    // `[0-9]` 而不是 `\d`：有意只认 ASCII 数字（设计 §12.6 D4）；Python 的 `\d` 会认全角数字，git 不会输出它们
    const m = /([0-9]+)\.([0-9]+)/.exec(text ?? '');
    if (!m)
        return `认不出 git 版本（${pyReprShort(pyStrip(text ?? '').slice(0, 40))}）；加固配置要 git ≥ ${GIT_MIN_VERSION[0]}.${GIT_MIN_VERSION[1]} 才生效`;
    const major = Number(m[1]), minor = Number(m[2]);
    if (major < GIT_MIN_VERSION[0] || (major === GIT_MIN_VERSION[0] && minor < GIT_MIN_VERSION[1])) {
        return `git ${m[1]}.${m[2]} 低于 ${GIT_MIN_VERSION[0]}.${GIT_MIN_VERSION[1]}：经 GIT_CONFIG_COUNT 注入的加固（fsmonitor、过滤器、pager 等）会被静默忽略，被扫仓配置里的外部程序可能被执行；请升级 git`;
    }
    return null;
}
function pyReprShort(s) {
    return `'${s.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}
const filterEnvCache = new Map();
/** 清缓存：仅测试用（一次扫描里 blame 要对每份文档跑一遍，缓存按仓的真实路径）。 */
export function _clearFilterEnvCache() {
    filterEnvCache.clear();
}
/**
 * 把被扫仓配置里声明的过滤器驱动逐个置空的子进程环境（会读工作区的 git 调用传它）。
 *
 * 过滤器由 .gitattributes 与配置合起来触发，驱动名由被扫方起，无法事先列全；读配置本身不执行任何东西，所以先列出名字再逐个置空。
 * 经 GIT_CONFIG_KEY_n/VALUE_n 传，键值分开——名字里带 `=` 也不会像 `-c k=v` 那样被切错。
 * 列不出（git 失败、超时）返回 null，调用方记未定，不照常执行。
 *
 * `base` 是调用方的环境（通常已经 hardenedEnv 过）；返回的是**新对象**，不改 base。
 */
export function filterEnv(root, base) {
    let key;
    try {
        key = realpathSync.native(String(root));
    }
    catch {
        key = String(root);
    }
    if (filterEnvCache.has(key))
        return filterEnvCache.get(key) ?? null;
    let r;
    try {
        r = spawnSync('git', ['-C', root, 'config', '-z', '--name-only', '--get-regexp', '^filter\\.'], { timeout: 60_000, env: base });
    }
    catch {
        return null;
    }
    if (r.error || r.status === null)
        return null;
    if (r.status !== 0 && r.status !== 1)
        return null; // 1 = 一个过滤器都没配，是正常出口
    const names = new Set();
    for (const k of (r.stdout ?? Buffer.alloc(0)).toString('utf8').split('\0')) {
        const dot = k.lastIndexOf('.');
        const head = dot < 0 ? '' : k.slice(0, dot);
        if (head.startsWith('filter.'))
            names.add(head);
    }
    const env = { ...base };
    let n = Number(env.GIT_CONFIG_COUNT || 0);
    for (const head of [...names].sort()) {
        for (const [sub, val] of [['clean', ''], ['smudge', ''], ['process', ''], ['required', 'false']]) {
            env[`GIT_CONFIG_KEY_${n}`] = `${head}.${sub}`;
            env[`GIT_CONFIG_VALUE_${n}`] = val;
            n++;
        }
    }
    env.GIT_CONFIG_COUNT = String(n);
    filterEnvCache.set(key, env);
    return env;
}
/**
 * 浅克隆下「最后一次提交」取的是边界提交、时间等于克隆那一刻，按它判新旧会把 FAIL 翻成 PASS。
 * 返回 null（不是浅克隆，可以用提交时间）或原因串（浅克隆、或探测不了）——调用方据此记未定。
 */
export function shallowProblem(root, base) {
    let r;
    try {
        r = spawnSync('git', ['-C', root, 'rev-parse', '--is-shallow-repository'], { encoding: 'utf8', timeout: 60_000, env: base });
    }
    catch (e) {
        return `跑不了 git rev-parse：${String(e)}`;
    }
    if (r.error)
        return `跑不了 git rev-parse：${r.error.message}`;
    if (r.status !== 0)
        return `git rev-parse --is-shallow-repository 退出码 ${r.status}`;
    if (pyStrip(r.stdout ?? '').toLowerCase() === 'true')
        return '浅克隆：git log 取到的是边界提交，时间等于克隆时刻，不是该文件真实的最后提交';
    return null;
}
