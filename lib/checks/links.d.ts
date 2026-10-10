import { type Config } from '../core/cfg.js';
import { type Finding } from '../core/finding.js';
export declare const NAME = "links";
export declare const STANDARD_REFS: string[];
/** 仅供测试：把几条模块私有的正则暴露出来，对 Python 样本逐条比对（它们是整份检查器里正则语义差异最集中的地方）。 */
export declare const _regexForTest: {
    LINK_RE: RegExp;
    SKIP_SCHEME_RE: RegExp;
    LINE_SUFFIX_RE: RegExp;
    WIN_ABS_RE: RegExp;
};
/** 把围栏代码块与行内代码涂白，行号与列位置不变。举例里的链接不算断链——本仓当年的 linkcheck 脚本（已并入本检查器）记下的真实教训（Case C-011）。 */
export declare function maskCode(text: string): string;
/**
 * GitHub 风格锚点：去内联标记与标点、小写、空格转连字符。
 * 非 ASCII 字符按 GitHub 的做法保留（Python 的 `\w` 含中日韩字符），但各平台对中文标题的处理并不一致——所以中文锚点匹配不上时判未定，不判断链。
 * `keepInnerUnderscore`：词中的下划线（`my_func`）GitHub 会保留，只有贴着词边界的才是强调标记；两种都算作可用锚点（anchorsOf），宁可少报不误报。
 */
export declare function slug(heading: string, keepInnerUnderscore?: boolean): string;
/** ATX 标题去掉可选的收尾 `#` 串（前面须有空白，或整行只有 `#`）与首尾空白。 */
export declare function atxTitle(raw: string): string;
/** 按出现顺序给出标题文字：ATX（`# x`）与 setext（下一行是 `===` / `---`）两种。入参是涂白后的文本。 */
export declare function titles(masked: string): string[];
/** 一份 markdown 里可用的锚点集合。masked：调用方已涂白的同一份文本，省一次涂白。 */
export declare function anchorsOf(text: string, masked?: string): Set<string>;
/**
 * Python 的 `urllib.parse.unquote(s)`（默认 `encoding='utf-8', errors='replace'`）：把 `%XX` 序列按 UTF-8 解码，
 * 非法的字节序列各替换成 U+FFFD；`%` 后不跟两个十六进制数字的原样保留；不处理 `+`。
 * 实现方式与 CPython 一致：把字符串里连续的 `%XX` 收成一段字节，一次按 UTF-8（replace）解码，其余字符原样。
 */
export declare function unquote(s: string): string;
export declare function scope(cfg: Config): {
    covered: string[];
    not_covered: string[];
};
export declare function run(cfg: Config): Finding[];
export declare function selftest(): Finding[];
