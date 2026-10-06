/** 配置无法被无歧义地解析。 */
export declare class ConfigError extends Error {
    name: string;
}
/** 解析结果的值类型。`undefined` 不会出现；YAML 的 null/空值是 `null`。 */
export type YamlValue = string | number | boolean | null | YamlValue[] | {
    [k: string]: YamlValue;
};
/**
 * 去行尾注释。只在 # 前有空白或位于行首时才算注释，避免吃掉值里的 #。
 * 引号只在值的开头（行首、`:` 或 `- ` 之后）才开启引用：`don't # 注释` 里的撇号是正文，不许把后面的注释吞进值里。
 */
export declare function stripComment(line: string): string;
/**
 * 等价于 Python 的 `str.splitlines()`：除 \n、\r\n、\r 外还在 \v \f \x1c \x1d \x1e \x85 \u2028 \u2029 处断行；
 * 不产生末尾空串。这与 JS 的 `split('\n')` 不同。
 */
export declare function splitLinesPy(text: string, keepends?: boolean): string[];
/** 解析 CONTRACT.md §5 所述结构。不支持的语法一律抛 ConfigError，不静默误读。 */
export declare function parseYamlSubset(text: string): YamlValue;
export declare const _internal: {
    MAX_DEPTH: number;
};
