/** 对扫描根开一段缓存：同一组模式的 `git ls-files` 一次扫描只跑一次。只缓存扫描根本身——检查器自检在临时仓里建夹具、改完再列，缓存它们会读到旧列表。 */
export declare function withScanMemo<T>(root: string, fn: () => T): T;
/** git 跟踪的文件；不在 git 仓库时返回 [null, 原因]。 */
export declare function trackedFiles(root: string, patterns?: readonly string[]): [string[] | null, string | null];
/** sub 目录下 git 跟踪的 markdown。返回 [相对路径列表（已排序）, 问题]。 */
export declare function markdownUnder(root: string, sub: string): [string[] | null, string | null];
/**
 * 工作项目录**直接一层**里 git 跟踪的 markdown。子目录（L1 的 work/artifacts/ 之类）放的是留证与产物，不是工作项——与 drift 的 D-118 裁定同一条规则，evidence 与 freshness 共用这一处。
 */
export declare function workItems(root: string, wroot: string): [string[] | null, string | null];
/** Python 的 `os.path.dirname`（本函数的入参已规范成 `/` 分隔）：最后一个 `/` 之前，没有则空串。 */
export declare const dirnameOf: (r: string) => string;
/** Python 的 `sorted(list_of_str)` 按码点；JS 的默认 `sort()` 按 UTF-16 码元，BMP 之外的字符次序不同。 */
export declare function cmpCodepoint(a: string, b: string): number;
