import { type Config } from '../core/cfg.js';
import { type CalDate } from '../core/dates.js';
import { type Finding } from '../core/finding.js';
export declare const NAME = "freshness";
export declare const STANDARD_REFS: string[];
type Need = 'required' | 'convention' | 'not_required' | 'declared_none' | 'unknown';
/**
 * 该文档属不属于 01 §3.5 要求带元信息的那一类。返回五值（**不再返回硬布尔**）：
 *  required      项目配置 metadata_required 命中（项目声明，缺日期可判 FAIL）；
 *  convention    项目没配，路径里出现约定的目录名。约定命中只说明「像」，缺日期按契约 §1.1 只记未定；
 *  not_required  项目配了 metadata_required 而本文件不在清单内（含被 `!` 排除的）：项目自己的声明，确定结论，可记 SKIP；
 *  declared_none 项目把 metadata_required 显式写成空列表 []：声明本项目没有那六类文档，调用方整轮聚成一条 SKIP；与「键缺失」必须分开；
 *  unknown       项目没配，目录名约定也没命中：「算不算那六类」要看内容，不是机械可判定的（契约 §7），按 01 §2 N1 记未定，**不能**记 SKIP。
 */
export declare function metadataRequirement(cfg: Config, rel: string): Need;
/** 取标题含关键词的那一节正文（到下一个标题为止）。找不到返回 null。 */
export declare function sectionBody(text: string, keywords: readonly unknown[]): string | null;
type LastTransition = {
    d: CalDate;
    how: string;
    err: null;
} | {
    d: null;
    how: null;
    err: ['absent' | 'bad', string];
};
/**
 * 最后一次状态转换时间。成功返回 {d, how}；失败返回 {err: [类别, 原因]}：
 * 类别 'absent' 表示文件里根本没写，可以退到提交时间；'bad' 表示写了但解析不了，按 01 §2 N1 记未定，不退到提交时间去猜。
 */
export declare function lastTransition(text: string): LastTransition;
/**
 * 距基准日几天。晚一天按当天算（C18）：基准日取运行环境本地日期，记录日期按作者时区写，UTC 的机器上读 UTC+8 当天写的日期就是「明天」；晚两天以上才记未定。
 */
export declare function age(today: CalDate, d: CalDate): number;
/** 预算取值：缺省取默认并注明；布尔不是整数；非正整数返回原因。返回 [值, 是否用默认, 原因]。 */
export declare function intBudget(cfg: Config, path: string, dflt: number): [number | null, boolean, string | null];
export declare function note(usedDefault: boolean, name: string, value: number): string;
export declare function scope(cfg: Config): {
    covered: string[];
    not_covered: string[];
};
export declare function run(cfg: Config): Finding[];
export declare function selftest(): Finding[];
export {};
