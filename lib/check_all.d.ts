import { type CheckModule } from './checks/index.js';
import { type Config } from './core/cfg.js';
import { type CalDate } from './core/dates.js';
import { type OwnRow } from './core/exceptions.js';
import { type Finding } from './core/finding.js';
export declare const IDENTITY_CHECK = "tool-identity";
export declare const EXCEPTION_CHECK = "exception-register";
export declare const TOOL_LIB: string;
/** 行尾归一化后再哈希：CRLF / CR 一律作 LF，其余字节不动（契约 §8）。 */
export declare function sha256File(path: string): string;
export interface Identity {
    digest: string;
    files: Array<[string, string]>;
    git_head: string;
    dirty: boolean | null;
    dirty_detail: string;
}
/** 本次跑的这套检查器是哪一套。身份是**内容哈希**，不是提交号；提交号与 `--porcelain` 只作旁证与 dirty 标记。 */
export declare function toolIdentity(libDir?: string, contract?: string): Identity;
export declare function identityLine(id: Identity): string;
/** 逐文件哈希，写成本工具自己的 yaml 子集能解析的形状。 */
export declare function identityBlock(id: Identity): string;
/** 收尾：再取一次身份，与开扫时比对。不一致就**整份作废**——把已有的 findings 全丢掉，只留一条未定。 */
export declare function sealed(findings: Finding[], before: Identity, take?: () => Identity): Finding[];
/**
 * 契约 §3：自检不过或没有自检的检查器，其结论作废。返回 `[ok, 闸门发现, 闸门这一次实际拿到的自检结果]`。
 * 第三项给 `--selftest` 分支原样打印：闸门是拿这一次的结果判的，报告展示的证据必须就是闸门据以放行的那份。
 * **禁止在这里做任何缓存**——入口冒烟自检会嵌套跑一遍完整扫描，缓存会跨嵌套泄漏。
 */
export declare function gatedBySelftest(name: string, mod: Pick<CheckModule, 'selftest'> | {
    selftest?: unknown;
}): [boolean, Finding[], Finding[]];
/** 过自检闸门再跑一个检查器。检查器里的异常一律转未定（契约 §1），不带走整个进程。 */
export declare function runOne(name: string, mod: Pick<CheckModule, 'run' | 'selftest'>, cfg: Config): Finding[];
/** `tailoring[].check` 写了不存在的名字时裁剪不生效、检查照跑——项目以为关掉了，其实没有。每个认不出的名字记一条未定并列出可写的名字。 */
export declare function tailoringUnknown(cfg: Config, mods?: ReadonlyArray<{
    NAME: string;
}>): Finding[];
/** 按已加载的 cfg 与检查器算各检查器的覆盖边界。 */
export declare function scopes(cfg: Config, mods?: ReadonlyArray<CheckModule>): Record<string, {
    covered: string[];
    not_covered: string[];
}>;
export interface RunOptions {
    selftestOnly?: boolean;
    configPath?: string | null;
    mods?: ReadonlyArray<CheckModule>;
    /** 测试注入：取身份的函数（封签用），生产路径不传。 */
    identity?: () => Identity;
    /** 测试注入：取「今天」。 */
    today?: CalDate;
    /** 测试注入：git 版本问题（生产路径不传，读本机 git）。 */
    gitProblem?: () => string | null;
    /** `--selftest` 时追加的汇总层/stdlib 层自检（由入口注入，避免本文件依赖 selftest.ts 形成环；设计 §12.31）。 */
    extraSelftest?: () => Finding[];
}
/** 跑全部检查。返回 `[findings, cfg]`——配置只在这里加载一次，渲染覆盖边界时由调用方把 cfg 传回去。 */
export declare function runAll(root: string, opts?: RunOptions): [Finding[], Config | null];
export type ExceptionsInfo = {
    path: string | null;
    display: string | null;
    valid: number;
    expired: number;
};
/**
 * 把登记册里的行贴到未定发现上。**只在这里改 `registered`，不改 `status`**：状态、三态计数与逐条列出都不因登记而改变（01 §5.6），登记改变的只有退出码。
 * FAIL 不可登记——本工具的 FAIL 按契约 §1.1 只在项目声明的事实下产出，整块不适用走 `tailoring`，不走这里。
 */
export declare function joinExceptions(findings: Finding[], cfg: Config, todayIn?: CalDate): ExceptionsInfo;
/**
 * 项目自有例外行（规则列不含 `/`，如依赖规则、依赖审计的门号例外）：只按到期判。不登记、不校验五项（那是项目的门，不是本工具的发现）；
 * 但 02 §4「到期未清理 CI 转红」对它们同样成立：未关闭且已过期判 FAIL（FAIL 不可登记）；到期写不成日期记未定。
 */
export declare function ownExceptions(own: OwnRow[], where: string | null, today: CalDate, base: string): Finding[];
/** `--config` 给的配置落在被扫描项目之外还是之内。返回 `[true|false|null, 原因]`。非绝对的 `_path` 先接到 root 上再归一化；前缀比较必须**带分隔符**。 */
export declare function configOutsideRoot(root: string, path: string): [boolean | null, string];
/** 转义控制字符。block（原因／依据／证据）保留换行，但续行一律缩进 8 格，没有一行从第 0 列开始。 */
export declare function safe(value: unknown, block?: boolean): string;
/** 渲染。cfg 是 runAll 已经加载好的配置；为 null 表示配置根本没读进来，此时不打覆盖边界（那是假边界）。 */
export declare function render(findings: Finding[], root: string, cfg: Config | null, showScope?: boolean, mods?: ReadonlyArray<CheckModule>): string;
/** 退出码：有 FAIL → 1；无 FAIL 但有**未登记**的未定 → 2；否则 0。已登记的未定仍是未定，只是不再挡门（契约 §9）。 */
export declare function exitCode(findings: readonly Finding[]): 0 | 1 | 2;
