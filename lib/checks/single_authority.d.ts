import { type Config } from '../core/cfg.js';
import { type Finding } from '../core/finding.js';
export declare const NAME = "single-authority";
export declare const STANDARD_REFS: string[];
/** 去掉空白与纯标点后的有效字符。（一次正则替换：逐字符生成式曾占本检查器大半耗时。） */
export declare function effectiveChars(s: string): string;
/** 按后缀判断是不是「文档」。见 DOC_SUFFIXES 上方的依据。Python 的 `os.path.splitext`：最后一个 `.` 起算、点不能是文件名第一个字符、目录分隔之后才算文件名。 */
export declare function isDoc(rel: string): boolean;
export declare const RE_ORDINAL_PREFIX: RegExp;
/** 把整行里的 markdown 链接构造换成等长（码点数）空格，其余字符原样保留。 */
export declare function maskLinks(raw: string): string;
/** 目录、索引、链接行、标题行这类天然重复的结构，不算实质文本。 */
export declare function isStructural(line: string): boolean;
/**
 * 产出围栏代码块之外的 [行号, 原文]。反引号围栏的信息串不得含反引号：一行 ```x``` 是行内代码，不开围栏——
 * 原先见到 ``` 就翻转，这样一行会让其后全文被当成代码块跳过。
 */
export declare function unfenced(text: string): Array<[number, string]>;
/** 产出 [行号, 归一化文本]：去代码块、空行、纯标点行与结构行。 */
export declare function significantLines(text: string): Array<[number, string]>;
/** 产出 [行号, 原文]：只去代码块与空行，供数值判据用。 */
export declare function proseLines(text: string): Array<[number, string]>;
/** Python 的 `s.lstrip("./")`：去开头的任意个 `.` 与 `/`（字符集，不是前缀）。 */
export declare const stripDotSlash: (s: string) => string;
type FileEntry = [rel: string, text: string, data: Buffer];
export declare function identicalFiles(files: readonly FileEntry[]): Map<string, string[]>;
export interface DupBlock {
    length: number;
    places: Array<[string, number]>;
    first: string;
}
/**
 * skipRels 是逐字节相同组里除代表外的其余文件：已按判据 1 报过，不再当成第二遍重复；但每组留一个代表参与比对，否则它与第三个文件共有的段落会被一起漏掉。
 */
export declare function duplicateBlocks(files: readonly FileEntry[], minLines: number, minChars: number, skipRels: ReadonlySet<string>): DupBlock[];
/** key = [数字（去逗号）, 量词, 名词前两个码点]；值 = 文件 → [行号, 命中原文]（每个文件只记第一次）。 */
export type ClaimKey = readonly [string, string, string];
export declare function countClaims(files: ReadonlyArray<readonly [string, string, unknown]>): Map<string, {
    key: ClaimKey;
    places: Map<string, [number, string]>;
}>;
export declare function scope(cfg: Config): {
    covered: string[];
    not_covered: string[];
};
export declare function run(cfg: Config): Finding[];
export declare function selftest(): Finding[];
export {};
