// adoption 的规格（测试 adoption-compat.test.mjs）
// 行为规格：各函数在各输入上应有的返回值。最初取自迁移期对 Python 版的实测（原为 adoption.json），Python 版与生成脚本已删除；
// 今后行为有意改变时手工改这里的期望值并说明原因。提炼的验收见 scripts/mutate-compare.mjs（变异清单每条的结局不许变坏）。

/** compat（24 条） */
export const COMPAT = [
  { policy: null, status: 'FAIL', evidence: '', reason: '在 governance/project.yaml 里加 `compatibility:` 下的 `policy:`，写明数据、接口、配置、旧版本客户端各支持到什么程度；未上线的写明“可破坏性重构”及其前提' },
  { policy: false, status: 'FAIL', evidence: '', reason: '在 governance/project.yaml 里加 `compatibility:` 下的 `policy:`，写明数据、接口、配置、旧版本客户端各支持到什么程度；未上线的写明“可破坏性重构”及其前提' },
  { policy: true, status: 'PASS', evidence: '原样值：True（内容写得对不对不判，契约 §7）', reason: '' },
  { policy: 0, status: 'PASS', evidence: '原样值：0（内容写得对不对不判，契约 §7）', reason: '' },
  { policy: 1, status: 'PASS', evidence: '原样值：1（内容写得对不对不判，契约 §7）', reason: '' },
  { policy: '', status: 'FAIL', evidence: '', reason: '在 governance/project.yaml 里加 `compatibility:` 下的 `policy:`，写明数据、接口、配置、旧版本客户端各支持到什么程度；未上线的写明“可破坏性重构”及其前提' },
  { policy: 'x', status: 'PASS', evidence: '原样值：x（内容写得对不对不判，契约 §7）', reason: '' },
  { policy: [], status: 'FAIL', evidence: '', reason: '在 governance/project.yaml 里加 `compatibility:` 下的 `policy:`，写明数据、接口、配置、旧版本客户端各支持到什么程度；未上线的写明“可破坏性重构”及其前提' },
  { policy: [1], status: 'PASS', evidence: '原样值：[1]（内容写得对不对不判，契约 §7）', reason: '' },
  { policy: {  }, status: 'FAIL', evidence: '', reason: '在 governance/project.yaml 里加 `compatibility:` 下的 `policy:`，写明数据、接口、配置、旧版本客户端各支持到什么程度；未上线的写明“可破坏性重构”及其前提' },
  { policy: { a: 1 }, status: 'PASS', evidence: '原样值：{\'a\': 1}（内容写得对不对不判，契约 §7）', reason: '' },
  { policy: ' ', status: 'PASS', evidence: '原样值： （内容写得对不对不判，契约 §7）', reason: '' },
  { policy: 'false', status: 'PASS', evidence: '原样值：false（内容写得对不对不判，契约 §7）', reason: '' },
  { policy: { data: '两个版本' }, status: 'PASS', evidence: '原样值：{\'data\': \'两个版本\'}（内容写得对不对不判，契约 §7）', reason: '' },
  { policy: ['a', { b: 1 }], status: 'PASS', evidence: '原样值：[\'a\', {\'b\': 1}]（内容写得对不对不判，契约 §7）', reason: '' },
  { policy: { a: { b: {  } } }, status: 'PASS', evidence: '原样值：{\'a\': {\'b\': {}}}（内容写得对不对不判，契约 §7）', reason: '' },
  { policy: '漢', status: 'PASS', evidence: '原样值：漢（内容写得对不对不判，契约 §7）', reason: '' },
  { policy: '😀', status: 'PASS', evidence: '原样值：😀（内容写得对不对不判，契约 §7）', reason: '' },
  { policy: { k: ['😀'] }, status: 'PASS', evidence: '原样值：{\'k\': [\'😀\']}（内容写得对不对不判，契约 §7）', reason: '' },
  { policy: 'it\'s', status: 'PASS', evidence: '原样值：it\'s（内容写得对不对不判，契约 §7）', reason: '' },
  { policy: 'say "hi"', status: 'PASS', evidence: '原样值：say "hi"（内容写得对不对不判，契约 §7）', reason: '' },
  { policy: { k: 'it\'s' }, status: 'PASS', evidence: '原样值：{\'k\': "it\'s"}（内容写得对不对不判，契约 §7）', reason: '' },
  { policy: 1.5, status: 'PASS', evidence: '原样值：1.5（内容写得对不对不判，契约 §7）', reason: '' },
  { policy: 100, status: 'PASS', evidence: '原样值：100（内容写得对不对不判，契约 §7）', reason: '' },
]

/** compat_shapes（10 条） */
export const COMPAT_SHAPES = [
  { name: '无键', cfg: {  }, status: 'FAIL', where: 'governance/project.yaml', reason: '在 governance/project.yaml 里加 `compatibility:` 下的 `policy:`，写明数据、接口、配置、旧版本客户端各支持到什么程度；未上线的写明“可破坏性重构”及其前提', evidence: '' },
  { name: '字符串', cfg: { compatibility: 'x' }, status: 'FAIL', where: 'governance/project.yaml', reason: '在 governance/project.yaml 里加 `compatibility:` 下的 `policy:`，写明数据、接口、配置、旧版本客户端各支持到什么程度；未上线的写明“可破坏性重构”及其前提', evidence: '' },
  { name: '列表', cfg: { compatibility: ['policy'] }, status: 'FAIL', where: 'governance/project.yaml', reason: '在 governance/project.yaml 里加 `compatibility:` 下的 `policy:`，写明数据、接口、配置、旧版本客户端各支持到什么程度；未上线的写明“可破坏性重构”及其前提', evidence: '' },
  { name: '空映射', cfg: { compatibility: {  } }, status: 'FAIL', where: 'governance/project.yaml', reason: '在 governance/project.yaml 里加 `compatibility:` 下的 `policy:`，写明数据、接口、配置、旧版本客户端各支持到什么程度；未上线的写明“可破坏性重构”及其前提', evidence: '' },
  { name: 'policy 键大小写', cfg: { compatibility: { Policy: 'x' } }, status: 'FAIL', where: 'governance/project.yaml', reason: '在 governance/project.yaml 里加 `compatibility:` 下的 `policy:`，写明数据、接口、配置、旧版本客户端各支持到什么程度；未上线的写明“可破坏性重构”及其前提', evidence: '' },
  { name: '_path 空', cfg: { _path: '', compatibility: { policy: 'x' } }, status: 'PASS', where: 'governance/project.yaml', reason: '', evidence: '原样值：x（内容写得对不对不判，契约 §7）' },
  { name: '_path 有', cfg: { _path: 'a/b.yaml', compatibility: { policy: 'x' } }, status: 'PASS', where: 'a/b.yaml', reason: '', evidence: '原样值：x（内容写得对不对不判，契约 §7）' },
  { name: '_path 0', cfg: { _path: 0, compatibility: { policy: 'x' } }, status: 'PASS', where: 'governance/project.yaml', reason: '', evidence: '原样值：x（内容写得对不对不判，契约 §7）' },
  { name: '_path 缺项', cfg: { _path: 'a/b.yaml' }, status: 'FAIL', where: 'a/b.yaml', reason: '在 a/b.yaml 里加 `compatibility:` 下的 `policy:`，写明数据、接口、配置、旧版本客户端各支持到什么程度；未上线的写明“可破坏性重构”及其前提', evidence: '' },
  { name: '_path 数字 5', cfg: { _path: 5, compatibility: { policy: 'x' } }, status: 'PASS', where: '5', reason: '', evidence: '原样值：x（内容写得对不对不判，契约 §7）' },
]
