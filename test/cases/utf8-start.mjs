// UTF-8 无效序列起点的穷举规格：用 ALPHABET 里的字节穷举长度 1 到 MAXLEN 的全部序列（COUNT 个），每个序列的 firstInvalidUtf8 结果拼成串取 sha256 应等于 SHA256（Python 的 UnicodeDecodeError.start，Python 3.12.14 实测）
// 行为规格：各函数在各输入上应有的返回值。最初取自迁移期对 Python 版的实测（原为 utf8-start.json），Python 版与生成脚本已删除；
// 今后行为有意改变时手工改这里的期望值并说明原因。提炼的验收见 scripts/mutate-compare.mjs（变异清单每条的结局不许变坏）。

/** alphabet（25 条） */
export const ALPHABET = [
  0,
  65,
  127,
  128,
  143,
  144,
  159,
  160,
  191,
  192,
  193,
  194,
  223,
  224,
  225,
  236,
  237,
  238,
  239,
  240,
  241,
  243,
  244,
  245,
  255,
]

/** count */
export const COUNT = 406900

/** maxlen */
export const MAXLEN = 4

/** reasons（3 项） */
export const REASONS = {
  'invalid continuation byte': 208500,
  'invalid start byte': 190540,
  'unexpected end of data': 5280,
}

/** sha256 */
export const SHA256 = 'b289138b1cc364a412c5805e2d73aa8b80ee01c0b24c6cc2980f5343747d872f'

/** valid */
export const VALID = 2580
