import { type Config } from '../core/cfg.js';
import { type Finding } from '../core/finding.js';
export declare const NAME = "cross-repo";
export declare const STANDARD_REFS: string[];
interface Repo {
    name: string;
    path: string;
    role: string;
    _where: string;
    _abs: string | null;
    _real: string | null;
    _exists: boolean;
    _is_git: boolean;
    former_names: unknown;
}
type EntryMap = Map<string, [string | null, string | null]>;
/** 失效标记。中文按原文子串找，英文按小写后的子串找（Python 的 `text.lower()`）；返回命中的标记词或 null。 */
export declare function hasInvalidationMarker(text: string): string | null;
/** 仓名是否作为独立记号出现。不能用裸子串——嵌套命名下 RCMS 会被 RCMS_Backend 假命中，那会把「未登记」误判成通过。 */
export declare function nameAppears(text: string, name: string): boolean;
/** 这一行上有没有把仓的状态写出来。只认状态词本身，不解读句意。英文词按独立记号认（子串会让 filesystem 命中 system，B13），中文词按子串。 */
export declare function hasStatusToken(line: string): boolean;
/** `os.path.normpath(os.path.abspath(path)).replace("\\", "/")`。 */
export declare const norm: (p: string) => string;
/** 抽出 markdown 链接目标。只认链接语法，不猜正文里的裸路径。 */
export declare function linkTargets(text: string): string[];
/** 本仓自己的 *.md。嵌套在本仓里的其它声明仓整棵跳过——它们的文件不归本仓。归属按「最深的包含它的声明仓」算。 */
export declare function listMd(repo: Repo, known: readonly Repo[]): [string[], boolean];
/** 把 layout.rule_files 的条目展开成实际存在的文件路径。以 / 结尾的按目录递归。返回 [文件, 是否截断, 出仓条目]。 */
export declare function expandRuleFiles(repoAbs: string, patterns: readonly unknown[]): [string[], boolean, string[]];
/** 一个路径归哪个仓：取最深的包含它的声明仓（应付嵌套检出）。 */
export declare function ownerRepo(absPath: string, repos: readonly Repo[]): Repo | null;
/** 返回 [repos, problem]。repos 元素带 _abs / _exists / _is_git。 */
export declare function loadRepos(cfg: Config): [Repo[], null] | [null, string];
export declare function scope(cfg: Config): {
    covered: string[];
    not_covered: string[];
};
export declare function run(cfg: Config): Finding[];
export declare function checkRoles(repos: readonly Repo[]): Finding[];
export declare function checkReachable(repos: readonly Repo[]): Finding[];
export declare function checkEntryExists(repos: readonly Repo[], entries: EntryMap, entryNames: readonly string[]): Finding[];
export declare function systemTokens(sysrepo: Repo): string[];
/** 文本里有没有指向系统仓的引用。返回命中的证据串，没有返回 null。 */
export declare function mentionsSystem(text: string, sysrepo: Repo, srcFile: string): string | null;
export declare function checkProjection(repos: readonly Repo[], entries: EntryMap): Finding[];
export declare function checkRegistration(repos: readonly Repo[], entries: EntryMap): Finding[];
export declare function checkRetired(cfg: Config, repos: readonly Repo[], entryNames: readonly string[]): Finding[];
export declare function checkLinks(repos: readonly Repo[]): Finding[];
/** **仅测试用**：每次 gitGrep 被调用时记一笔。Python 版的自检靠 `globals()["_git_grep"] = …` 替换函数来数调用次数，ESM 的命名绑定不可改写，所以显式留个计数器。生产路径恒不读它。 */
export declare const __testCalls: {
    grep: string[][];
};
/** 一仓一次子进程召回全部别名。返回 [命中列表, 错误]；命中项为 [相对路径, 行号, 行文]。 */
export declare function gitGrep(repoReal: string, needles: readonly string[]): [Array<[string, string, string]>, null] | [null, string];
/** `git grep -n -z` 的输出是「路径 NUL 行号 NUL 行文 换行」首尾相接。路径可以含换行（行文不会），所以不能先按换行切：按 NUL 切成记号流，行文与下一条路径之间的第一个换行才是分界（R1-09）。 */
export declare function parseGrepZ(out: string): [Array<[string, string, string]>, null] | [null, string];
export declare function checkFormerNames(cfg: Config, repos: readonly Repo[]): Finding[];
export declare function selftest(): Finding[];
export {};
