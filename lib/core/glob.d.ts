/**
 * 在 `root` 下展开 `pattern`（以 `/` 分段），返回命中的相对路径（`/` 分隔、未排序——调用方只关心「有没有命中」）。
 * `root` 按字面，不解释其中的通配字符。
 */
export declare function globIn(root: string, pattern: string): string[];
/** 命中任一即真：layout 的 `glob` 判据只问「有没有」。 */
export declare function globAny(root: string, pattern: string, accept: (rel: string) => boolean): boolean;
