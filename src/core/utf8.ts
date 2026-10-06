// UTF-8 校验：给出首个**无效序列的起点**（字节偏移）。Node 的 TextDecoder fatal 模式只抛「数据无效」，不给偏移；
// Python 的 UnicodeDecodeError.start 给，而配置读取的报错信息写了「第 N 字节起解不开」，是契约的一部分。
//
// 规则对着 Unicode 标准 Table 3-7（well-formed UTF-8 byte sequences）与 Python 的解码器：
//   00..7F；C2..DF 80..BF；E0 A0..BF 80..BF；E1..EC 80..BF 80..BF；ED 80..9F 80..BF（排除代理）；EE..EF 80..BF 80..BF；
//   F0 90..BF 80..BF 80..BF；F1..F3 80..BF 80..BF 80..BF；F4 80..8F 80..BF 80..BF。C0、C1、F5..FF 永远无效。
// 「起点」是**第一个无效序列的第一个字节**：Python 在 `a\xe4b` 里报 start=1（\xe4 起，因为 b 不是后继字节），不是 2。
// 一个被截断的前缀（`\xe4\xb8` 后面没有了）报的是 start=该序列起点、reason=unexpected end of data——起点同样是序列的第一个字节。

/** 首个无效序列的起点；整段合法返回 -1。 */
export function firstInvalidUtf8(b: Uint8Array): number {
  let i = 0
  const n = b.length
  while (i < n) {
    const c = b[i]!
    if (c < 0x80) { i++; continue }
    let need: number, lo = 0x80, hi = 0xbf
    if (c >= 0xc2 && c <= 0xdf) need = 1
    else if (c === 0xe0) { need = 2; lo = 0xa0 }
    else if (c >= 0xe1 && c <= 0xec) need = 2
    else if (c === 0xed) { need = 2; hi = 0x9f }
    else if (c >= 0xee && c <= 0xef) need = 2
    else if (c === 0xf0) { need = 3; lo = 0x90 }
    else if (c >= 0xf1 && c <= 0xf3) need = 3
    else if (c === 0xf4) { need = 3; hi = 0x8f }
    else return i                                           // 80..C1、F5..FF：不能作起始字节
    for (let k = 1; k <= need; k++) {
      const x = b[i + k]
      if (x === undefined) return i                         // 被截断
      const l = k === 1 ? lo : 0x80, h = k === 1 ? hi : 0xbf
      if (x < l || x > h) return i                          // 后继字节不合规：整个序列自起点起无效
    }
    i += need + 1
  }
  return -1
}
