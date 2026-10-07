import { type Config } from '../core/cfg.js';
import { type CalDate } from '../core/dates.js';
import { type Finding } from '../core/finding.js';
export declare const NAME = "drift";
export declare const STANDARD_REFS: string[];
/** 日期后面跟着它，这个日期读起来就像「已经发生了」。 */
export declare const PAST_ACTS: readonly string[];
/**
 * 日期**左边**跟着它，这个日期是计划位（复查日、到期日），不是既成事实。
 * 由来：`- 复查：2026-12-08（半年）——已复查，无回退。` 这一行右窗口命中 `已复查`，是实测出来的真误报形态。
 */
export declare const PLAN_WORDS: readonly string[];
/**
 * ADR 正文里的就地修订标记。**必须从剥掉行首装饰后的第 0 个字符开始**——放宽到「前 8 个字符内」时，本仓 docs/ 的候选行数成倍增加，全是正文句子，那是实测出来的误报形态（数字见 Python 版同处，不抄）。
 */
export declare const REVISION_MARKERS: readonly string[];
declare const WI_RE: RegExp;
/** WORK_ITEM 模板的首字段，照模板写法只认行首；正文里提到的 ID 不算载体。 */
declare const WI_FIELD_RE: RegExp;
export { WI_RE as WI_PATTERN_FOR_TEST, WI_FIELD_RE as WI_FIELD_PATTERN_FOR_TEST };
export declare function mdUnder(files: readonly string[], sub: string): string[];
export declare function cap(items: readonly string[]): string;
/**
 * 该时刻在最晚时区（UTC+14）下的日期，作「写下时最晚可能是哪天」的基准。
 * 纯函数，不读机器时区，也不用提交自带的 committer-tz：写日期的人与提交者的时区未必相同，`2026-09-13 21:46 -0700` 的提交在 +0800 已是 09-14，按 -0700 取日会把正确的『09-14』报成未来。
 * 取 UTC+14 只会少报、不会漏掉真正的未来日期。
 */
export declare function latestDay(epochSeconds: number): CalDate;
/**
 * 返回 [[行号, 日期字面量]]。左窗口排除计划位，右窗口要求动作词。
 *
 * 窗口按**码点**取：Python 的 `m.start()` 是码点下标，`line[a:b]` 按码点切；JS 的 `m.index` 是码元下标，`slice` 按码元切，含 emoji 的行下标不通用（D18）。
 * 做法：把 `line` 转成码点数组 `cps`；日期起点的码点下标 = `[...line.slice(0, m.index)].length`；日期本身是纯 ASCII（`[0-9]` 与 `-`），长度 10，码点数 = 码元数。
 * 窗口都在码点下标上加减，最后 `cps.slice(a, b).join('')`。
 */
export declare function candidates(text: string): Array<[number, string]>;
/** `git blame -p` 的 committer-time 与行头解析。纯函数（输入是 blame 的文本输出），便于对样本逐条比对。返回 [{行号: [sha, 日期|null]}, 问题|null]。 */
export declare function parseBlame(text: string): [Map<number, [string, CalDate | null]> | null, string | null];
/** 返回 [目录相对路径, 是否项目声明, 说不通时的 Finding]。 */
export declare function adrDir(cfg: Config, root: string, files: readonly string[], docsRoot: string): [string | null, boolean, Finding | null];
export declare function revisionHits(text: string): Array<[number, string, string]>;
/** 「文件」列里可用的路径；不是路径（裸 ID、括注）返回 null。 */
export declare function indexTarget(cell: string): string | null;
export declare function scope(cfg: Config): {
    covered: string[];
    not_covered: string[];
};
export declare function selftest(): Finding[];
export declare function run(cfg: Config): Finding[];
