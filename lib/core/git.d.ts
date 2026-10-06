/**
 * git 跑钩子时注入的仓库定位变量，取自 `git rev-parse --local-env-vars`（git 自己进入另一个仓库前清掉的就是这张表）。
 * 显式的 GIT_DIR 压过 `-C`。GIT_CEILING_DIRECTORIES 不在表里：它只挡上溯、不改定位。
 */
export declare const GIT_LOCAL_ENV: readonly string[];
/**
 * 经 GIT_CONFIG_COUNT 注入的是命令行级配置（git ≥ 2.31），优先级高于任何配置文件，一处设好全部子进程生效。
 * 取值里不放空串（D9）：Python 版在 Windows 上 `os.environ[k] = ""` 不传给子进程，所以这四项用 `true`（命令名；调用时该程序不存在或什么都不做即安全，
 * 且不是被扫方可控的字符串）代替空串。TS 里空串能传，但保持原取值：行为不变，且 `true` 的语义已被 Python 版的安全审计认可。
 */
export declare const GIT_HARDEN_CONFIG: ReadonlyArray<readonly [string, string]>;
/** GIT_OPTIONAL_LOCKS=0：扫描不刷新、不回写被扫仓的 index（只读扫描不该有写入）。 */
export declare const GIT_HARDEN_ENV: ReadonlyArray<readonly [string, string]>;
/** GIT_CONFIG_COUNT 注入要 git ≥ 2.31；更老的 git 静默忽略这些变量，上面的加固全部失效。 */
export declare const GIT_MIN_VERSION: readonly [number, number];
export type Env = Record<string, string | undefined>;
/**
 * 构造加固后的子进程环境：从 base 去掉 GIT_LOCAL_ENV 与已有的 GIT_CONFIG_KEY_n/VALUE_n，再注入加固配置。
 * **纯函数，不读也不写 process.env**（D9）：base 由调用方传入（通常是 `process.env` 的拷贝）。
 */
export declare function hardenedEnv(base: Env): Env;
/**
 * git 低于 GIT_MIN_VERSION 或认不出版本时返回原因串，否则 null（git 跑不起来也返回 null——那时每个 git 读点各自记未定）。
 * `out` 只为自检注入 `git version` 的输出。
 */
export declare function gitVersionProblem(out?: string): string | null;
/** 清缓存：仅测试用（一次扫描里 blame 要对每份文档跑一遍，缓存按仓的真实路径）。 */
export declare function _clearFilterEnvCache(): void;
/**
 * 把被扫仓配置里声明的过滤器驱动逐个置空的子进程环境（会读工作区的 git 调用传它）。
 *
 * 过滤器由 .gitattributes 与配置合起来触发，驱动名由被扫方起，无法事先列全；读配置本身不执行任何东西，所以先列出名字再逐个置空。
 * 经 GIT_CONFIG_KEY_n/VALUE_n 传，键值分开——名字里带 `=` 也不会像 `-c k=v` 那样被切错。
 * 列不出（git 失败、超时）返回 null，调用方记未定，不照常执行。
 *
 * `base` 是调用方的环境（通常已经 hardenedEnv 过）；返回的是**新对象**，不改 base。
 */
export declare function filterEnv(root: string, base: Env): Env | null;
/**
 * 浅克隆下「最后一次提交」取的是边界提交、时间等于克隆那一刻，按它判新旧会把 FAIL 翻成 PASS。
 * 返回 null（不是浅克隆，可以用提交时间）或原因串（浅克隆、或探测不了）——调用方据此记未定。
 */
export declare function shallowProblem(root: string, base: Env): string | null;
