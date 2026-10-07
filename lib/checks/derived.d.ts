import { type Config } from '../core/cfg.js';
import { type Finding } from '../core/finding.js';
export declare const NAME = "derived-artifacts";
export declare const STANDARD_REFS: string[];
/**
 * 该路径最后一次提交的时间戳。返回 [epoch, null] 或 [null, 原因]。
 * shallow 是本次扫描探测一次的 shallowProblem(root)，不逐条再起子进程（C22）。路径按字面（C02）：`m[1].json` 不许匹配到 `m1.json` 的提交。
 */
export declare function gitLastCommitEpoch(root: string, relpath: string, shallow: string | null): [number, null] | [null, string];
/** 字节 → 头部文本：含 NUL 判二进制；否则丢掉无效 UTF-8 序列、按 Python 的行终止符取前 HEADER_LINES 行。纯函数，便于对样本逐条比对。 */
export declare function headerOfBytes(data: Uint8Array): [string, null] | [null, string];
/** 读文件头部若干行。二进制或读不了时返回 [null, 原因]。 */
export declare function readHeader(path: string, root: string): [string, null] | [null, string];
/**
 * name 作为整段路径/文件名出现在 low 里：前后不能紧挨文件名字符（C15：`api` 不许命中 `rapid`；R2-8：后面接 `.md`、`.bak` 这类扩展名也不算，句末的句号照认）。
 * 只按 ASCII 判边界——`权威是src/map.json` 这种中文紧贴的写法照认。
 */
export declare function mentions(low: string, name: string): boolean;
/**
 * 头部是否**指明了源**（02 §9.1 的门槛）。返回命中说明，没有则 null。
 * 只有这个函数的返回值能让检查判 PASS。生成类措辞与生成器署名不走这里。
 */
export declare function headerDeclares(header: string, sourceRel: unknown): string | null;
/**
 * 头部有没有「这是生成物」的痕迹。**不改变状态，只用来把证据说准。**
 * 返回 [类别, 行号, 原文行]；没有返回 null。生成器署名优先于泛泛的生成措辞，因为它是可引用的原文。
 */
export declare function headerGenerationHint(header: string): [string, number, string] | null;
export declare function scope(cfg: Config): {
    covered: string[];
    not_covered: string[];
};
export declare function run(cfg: Config): Finding[];
export declare function selftest(): Finding[];
