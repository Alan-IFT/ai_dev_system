export declare const PASS = "PASS";
export declare const FAIL = "FAIL";
export declare const UNDETERMINED = "UNDETERMINED";
export declare const SKIP = "SKIP";
export declare const STATUSES: readonly ["PASS", "FAIL", "UNDETERMINED", "SKIP"];
export type Status = (typeof STATUSES)[number];
export interface Finding {
    check: string;
    id: string;
    status: Status;
    title: string;
    where: string | null;
    why: string;
    reason: string;
    evidence: string;
    /** 例外登记由 check_all 在全部检查跑完之后贴上（契约 §9）；检查器自己不填。 */
    registered: string | null;
}
/**
 * Python 的 `\s`（`re` 的 Unicode 空白）与 `str.strip()` 认的空白集合，逐码点实测得出（设计 §12.6 D6）。
 * 与 JS 的差别：多 U+001C 到 U+001F、U+0085；少 U+FEFF。所以**不能用 `\s` 和 `trim()`**——BOM 开头的文本两版本会得出不同结果。
 */
export declare const PY_WHITESPACE = "\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
/** 等价于 Python 的 `str.strip()`（不带参数）。 */
export declare function pyStrip(s: string): string;
/** 等价于 Python 的 `str.lstrip()`（不带参数）：只去开头的 Python 空白。 */
export declare function pyLstrip(s: string): string;
/**
 * Finding id 里 key 段的归一化：去首尾空白、内部空白与换行折成 `_`、`|` 换成 `｜`。
 * `|` 要换掉是因为 id 会被人抄进 markdown 表格的「规则」列，裸竖线会把那一行拆成两格。
 */
export declare function normalizeKey(key: unknown): string;
/**
 * Python 对含孤立代理字符的字符串用 `surrogateescape` 编码（非 UTF-8 文件名经 git ls-files 解码后带代理字符）。
 * JS 的字符串是 UTF-16，孤立代理单元用 Buffer.from(s, 'utf8') 会被替换成 U+FFFD，**得到不同的哈希**。
 * 这里按 Python 的 surrogateescape 规则手工编码：U+DC80..U+DCFF 的孤立代理 → 单字节 0x80..0xFF。
 */
export declare function encodeSurrogateEscape(s: string): Buffer;
/**
 * Finding 的稳定标识（契约 §9）。
 * `kind` 给了 → `check/kind[/归一化 key]`，判据不变它就不变，标题怎么改都不影响；
 * 没给 → `check/` + `sha1(title)[:8]`，只在同一工具身份内稳定（标题一改就换）。
 */
export declare function findingId(check: string, title: string, kind?: string | null, key?: unknown): string;
export interface FindingInit {
    where?: string | null;
    why?: string;
    reason?: string;
    evidence?: string;
    kind?: string | null;
    key?: unknown;
}
/** 构造一条 Finding。status 非法即抛——不允许悄悄产生第四种状态。 */
export declare function finding(check: string, status: string, title: string, init?: FindingInit): Finding;
