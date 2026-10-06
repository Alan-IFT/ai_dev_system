export interface Utf8Problem {
    /** 无效序列的第一个字节的偏移 */
    start: number;
    /** 无效序列之后第一个字节的偏移（开区间，与 Python 的 `UnicodeDecodeError.end` 同义） */
    end: number;
    reason: 'invalid start byte' | 'invalid continuation byte' | 'unexpected end of data';
}
/** 首个无效序列的诊断；整段合法返回 null。 */
export declare function diagnoseUtf8(b: Uint8Array): Utf8Problem | null;
/** 首个无效序列的起点；整段合法返回 -1。 */
export declare function firstInvalidUtf8(b: Uint8Array): number;
/**
 * Python 的 `str(UnicodeDecodeError)`：`'utf-8' codec can't decode byte 0xe9 in position 2: invalid continuation byte`
 * 或（序列占多字节时）`can't decode bytes in position 0-1: ...`。位置是 `start` 到 `end - 1`。
 * 注意：Python 的 `decode('utf-8-sig')` 先去掉开头的 BOM 再解码，所以报告的位置**相对 BOM 之后**；调用方负责传去掉 BOM 的数据。
 */
export declare function pyUtf8ErrorMessage(b: Uint8Array, p: Utf8Problem): string;
