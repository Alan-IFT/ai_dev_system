export interface Utf8Problem {
    /** 无效序列的第一个字节的偏移 */
    start: number;
    /** 无效序列之后第一个字节的偏移（开区间，与 Python 的 `UnicodeDecodeError.end` 同义） */
    end: number;
    reason: 'invalid start byte' | 'invalid continuation byte' | 'unexpected end of data';
}
/** 首个无效序列的诊断；整段合法返回 null。 */
export declare function diagnoseUtf8(b: Uint8Array): Utf8Problem | null;
/**
 * Python 的 `data.decode("utf-8", "ignore")`：把每个**无效序列**整个丢掉，其余原样解码。
 * 不能用 Node 的宽松 `TextDecoder`：①它把无效字节换成 U+FFFD，而原文自带的 U+FFFD 必须保留，事后「去掉 U+FFFD」会误伤；②它默认吞掉开头的 BOM，Python 的 `utf-8` 编解码器保留（U+FEFF）。
 * 无效序列的边界直接用 `diagnoseUtf8` 给的 [start, end)（已与 Python 逐字节核对，见设计 §12.11），下一轮从 end 起继续——与 CPython 的 ignore 处理同一规则。
 */
export declare function decodeUtf8Ignore(b: Uint8Array): string;
/** 首个无效序列的起点；整段合法返回 -1。 */
export declare function firstInvalidUtf8(b: Uint8Array): number;
/**
 * Python 的 `str(UnicodeDecodeError)`：`'utf-8' codec can't decode byte 0xe9 in position 2: invalid continuation byte`
 * 或（序列占多字节时）`can't decode bytes in position 0-1: ...`。位置是 `start` 到 `end - 1`。
 * 注意：Python 的 `decode('utf-8-sig')` 先去掉开头的 BOM 再解码，所以报告的位置**相对 BOM 之后**；调用方负责传去掉 BOM 的数据。
 */
export declare function pyUtf8ErrorMessage(b: Uint8Array, p: Utf8Problem): string;
