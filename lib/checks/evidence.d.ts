import { type Config } from '../core/cfg.js';
import { type Finding } from '../core/finding.js';
export declare const NAME = "evidence";
export declare const STANDARD_REFS: string[];
type FieldKey = 'assertion' | 'raw' | 'identity' | 'scope' | 'observed' | 'method';
/** 六字段。顺序即匹配优先级：同一行命中多个时取靠前的那个。 */
export declare const FIELDS: ReadonlyArray<readonly [FieldKey, string, readonly string[]]>;
export declare function isPyDigit(s: string): boolean;
export declare function isPlaceholder(value: unknown): boolean;
type Row = readonly [number, string];
export type Section = [title: string, start: number, rows: Array<[number, string]>];
/**
 * 返回 [标题, 起始行号(1-based), [行]]，标题含「证据」的小节。
 *
 * 围栏代码块里的行不算标题、也不进小节（C06）：代码里的 `# 注释` 会截断证据段，命令输出里的 `time: 3s` 会被认成字段。比证据段标题低一级以上的小标题（`### E-01`）
 * 留在段内，由 parseListBlocks 当条目头（C13）；同级或更高一级的标题才结束这一段。
 */
export declare function evidenceSections(text: string): Section[];
export declare function unknownLabel(ln: string): boolean;
/** 行内标签 → [字段键, 值]。不是字段行返回 [null, null]。 */
export declare function labelField(line: string): [FieldKey, string] | [null, null];
export interface Block {
    name: string;
    line: number;
    fields: Map<FieldKey, string>;
    limit_cols: string[];
    kind: '条目' | '表行';
    unknown: number;
    sub?: boolean;
}
/**
 * 加粗条目行（或三级以上小标题）起头的证据条目。
 *
 * 表格行归 parseTableBlocks，这里不看（C08：表格格子里的「输出: …」曾被认成字段，凭空多出一条「（整段）」证据判 FAIL）。whole=false 时不把整段兜成一条——同一段里已按
 * 字段表认出了条目，零散的「字段: 值」只是说明文字。
 */
export declare function parseListBlocks(allRows: readonly Row[], whole?: boolean): Block[];
export declare function splitRow(ln: string): string[];
/** 表格分隔行。不用正则：原写法里 `\s*` 与字符类重叠，满行 `|` 或空格是平方级（R2-11）。 */
export declare function isSep(ln: string): boolean;
/** 表头 → {列号: 字段键}。以 _id 结尾的列当标识符，不当字段（acceptance_id 除外）。 */
export declare function mapHeader(cells: readonly string[]): Map<number, FieldKey>;
/** 字段表写法：表头映射到六字段，每个数据行是一条证据。 */
export declare function parseTableBlocks(rows: readonly Row[]): Block[];
/** 返回 [缺的, 空的, 限制是否为空]。 */
export declare function judge(block: Block): [string[], string[], boolean];
export declare function scope(cfg: Config): {
    covered: string[];
    not_covered: string[];
};
export declare function run(cfg: Config): Finding[];
export declare function selftest(): Finding[];
export {};
