/** 一个日历日期。不用 `Date`：它按本地时区解释，且 `new Date('2026-02-30')` 会静默进位。 */
export interface CalDate {
    readonly year: number;
    readonly month: number;
    readonly day: number;
}
export declare function toIso(d: CalDate): string;
/** 公历日期是否存在（含闰年）。`2026-02-30`、`2026-13-01` 都不存在。 */
export declare function validDate(y: number, m: number, d: number): boolean;
/**
 * 支持 YYYY-MM-DD 与 ISO8601。返回 [date, null] 或 [null, 原因]。解析不了不猜。
 * `*` 与反引号是 markdown 的加粗/行内代码标记，先剥掉。
 * strict：只收纯日期，不认「日期 + 任意文字」（例外登记的到期，契约 §9）。
 */
export declare function parseDate(raw: unknown, strict?: boolean): [CalDate, null] | [null, string];
