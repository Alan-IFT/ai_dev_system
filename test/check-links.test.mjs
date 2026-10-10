// links 检查器的验收测试：selftest 全过且 (id,status) 集合与 Python 黄金样本相同；对 4 个真实仓逐条一致；变异验证靠这里的直接断言变红。
// 期望值取自 Python 版实测（golden/_probe_links.py 的输出，用完已删）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NAME, run, scope, selftest } from '../lib/checks/links.js'
import { LINKS } from './cases/selftest-ids.mjs'

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..')
const probes = LINKS.map(([id, status]) => ({ id, status }))

test('NAME 与 Python 版一致', () => assert.equal(NAME, 'links'))

test('selftest：每条都 PASS，且 (id, status) 集合与黄金样本完全相同', () => {
  const got = selftest()
  assert.ok(got.length >= 2)
  assert.deepEqual(got.filter((f) => f.status !== 'PASS').map((f) => `${f.title}｜${f.evidence}`), [])
  assert.deepEqual(got.map((f) => [f.id, f.status]).sort(), probes.map((p) => [p.id, p.status]).sort())
})

// ---- 直接断言（所有平台都跑）----
const tmps = []
const mk = () => { const t = mkdtempSync(join(tmpdir(), 'lnchk-')); tmps.push(t); return t }
test.after(() => { for (const t of tmps) rmSync(t, { recursive: true, force: true }) })
const put = (t, rel, body = '') => { mkdirSync(dirname(join(t, rel)), { recursive: true }); writeFileSync(join(t, rel), body) }
const go = (t, files, extra = {}) => run({ _root: t, _links_files: files, ...extra })
const bad = (fs) => fs.filter((f) => !f.title.startsWith('扫了')).map((f) => [f.status, f.id])

test('基本：存在的链接不报；不存在 → FAIL missing（where 是 文件:行号、evidence 含「解析为」「不在归档区」「出现在第 N 行」）；末尾恒有一条 PASS 计数', () => {
  const t = mk(); put(t, 'b.md', '# B\n'); put(t, 'a.md', '[x](b.md)\n[y](nope.md)\n')
  const r = go(t, ['a.md', 'b.md'])
  assert.deepEqual(bad(r), [['FAIL', 'links/missing/a.md｜nope.md']])
  const f = r.find((x) => x.status === 'FAIL'); assert.equal(f.where, 'a.md:2'); assert.match(f.evidence, /^解析为 .*nope\.md；不在归档区；出现在第 2 行（共 1 处）$/)
  const last = r.at(-1); assert.equal(last.status, 'PASS'); assert.equal(last.title, '扫了 2 份 markdown、2 条本地链接，1 条有问题')
})

test('文件清单为空 → 未定（单条，不是通过）；被裁剪 → 单条 SKIP', () => {
  const t = mk()
  const e = go(t, []); assert.deepEqual(e.map((f) => [f.status, f.title]), [['UNDETERMINED', '没有找到任何 git 跟踪的 markdown']])
  assert.deepEqual(go(t, ['a.md'], { tailoring: [{ check: 'links', applicable: false, reason: 'r' }] }).map((f) => f.status), ['SKIP'])
})

test('锚点：ASCII 缺失 → FAIL anchor-missing；中文缺失 → 未定 anchor-cjk；空锚点 `#` 不核；纯锚点指向本文件', () => {
  const t = mk(); put(t, 'b.md', '# B\n')
  put(t, 'a.md', '[x](b.md#nope) [y](b.md#中文) [z](b.md#)\n')
  assert.deepEqual(bad(go(t, ['a.md', 'b.md'])), [['FAIL', 'links/anchor-missing/a.md｜b.md#nope'], ['UNDETERMINED', 'links/anchor-cjk/a.md｜b.md#中文']])
  put(t, 'a.md', '[x](#top) [y](#nope) [z](#中文)\n# Top\n')
  assert.deepEqual(bad(go(t, ['a.md'])), [['FAIL', 'links/anchor-missing/a.md｜#nope'], ['UNDETERMINED', 'links/anchor-cjk/a.md｜#中文']])
  const c = go(t, ['a.md']).find((f) => f.id.includes('anchor-cjk')); assert.match(c.evidence, /^目标 a\.md；本工具算出的锚点集合里没有 '中文'。/)
})

test('绝对路径、协议相对、仓根、出仓：Windows 盘符 → 未定 host-abs；`//host` 跳过；`/x` 找不到 → 未定 root-abs；`/../x` 与 `../x` 出仓 → 未定 outside-root', () => {
  const t = mk(); put(t, 'b.md', '# B\n')
  put(t, 'a.md', '[a](C:\\x.md) [b](c:/y.md) [c](//host/z) [d](/b.md) [e](/nope.md) [f](/../out.md) [g](../out.md)\n')
  assert.deepEqual(bad(go(t, ['a.md', 'b.md'])).sort(), [['UNDETERMINED', 'links/host-abs/a.md｜C:\\x.md'], ['UNDETERMINED', 'links/host-abs/a.md｜c:/y.md'], ['UNDETERMINED', 'links/outside-root/a.md｜../out.md'],
    ['UNDETERMINED', 'links/outside-root/a.md｜/../out.md'], ['UNDETERMINED', 'links/root-abs/a.md｜/nope.md']].sort())
  assert.equal(go(t, ['a.md', 'b.md']).at(-1).title, '扫了 2 份 markdown、6 条本地链接，5 条有问题', '`//host` 不计入链接数')
})

test('目标是目录或非 markdown：只核存在性，带锚点也不核（目录 `dd#frag`、图片 `p.png#frag`）', () => {
  const t = mk(); mkdirSync(join(t, 'dd')); put(t, 'p.png', 'x'); put(t, 'a.md', '[a](dd) [b](dd/) [c](dd#frag) [d](p.png#frag) [e](p.png)\n')
  assert.deepEqual(bad(go(t, ['a.md'])), [])
})

test('归档区：断链照报，证据里注明在 layout.frozen 归档区；不在归档区写「不在归档区」', () => {
  const t = mk(); put(t, 'old/f.md', '[x](nope.md)\n')
  assert.match(go(t, ['old/f.md'], { layout: { frozen: ['old'] } }).find((f) => f.status === 'FAIL').evidence, /；该文件在 layout\.frozen 归档区，断链照报，是否修由人定；出现在第 1 行/)
  assert.match(go(t, ['old/f.md']).find((f) => f.status === 'FAIL').evidence, /；不在归档区；出现在第 1 行/)
})

test('目标后缀：.MD（大写）与 .markdown 的目标都核锚点；锚点缺失照判 FAIL', () => {
  const t = mk(); put(t, 'U.MD', '# U\n'); put(t, 'm.markdown', '# M\n'); put(t, 'a.md', '[a](U.MD#u) [b](U.MD#x) [c](m.markdown#m) [d](m.markdown#x)\n')
  assert.deepEqual(bad(go(t, ['a.md', 'U.MD', 'm.markdown'])), [['FAIL', 'links/anchor-missing/a.md｜U.MD#x'], ['FAIL', 'links/anchor-missing/a.md｜m.markdown#x']])
})

test('目录名叫 .md（`dir.md#x`）：是目录 → 只核存在性，不读它', () => {
  const t = mk(); mkdirSync(join(t, 'dir.md')); put(t, 'a.md', '[a](dir.md#x)\n')
  assert.deepEqual(bad(go(t, ['a.md'])), [])
})

test('扫描对象本身读不了（不存在）→ 未定 unreadable（where 是该文件），不是检查器故障；清单里非 md 也照读', () => {
  const t = mk()
  assert.deepEqual(go(t, ['ghost.md']).filter((f) => f.status !== 'PASS').map((f) => [f.status, f.id, f.where]), [['UNDETERMINED', 'links/unreadable/ghost.md', 'ghost.md']])
  put(t, 'a.md', '# a\n'); assert.deepEqual(bad(go(t, ['a.md', 'x.txt'])), [['UNDETERMINED', 'links/unreadable/x.txt']])
})

test('百分号：`%E4%B8%AD%20%E6%96%87.md` 解码成「中 文.md」；残缺的 `%ZZ` 原样保留（按文件名 `%ZZ.md` 核，不存在 → FAIL）；锚点里的百分号也解码', () => {
  const t = mk(); put(t, '中 文.md', '# 标题\n'); put(t, 'a.md', '[a](%E4%B8%AD%20%E6%96%87.md) [b](中%20文.md#标题) [c](%E4%B8%AD%20%E6%96%87.md#nope) [d](%ZZ.md)\n')
  assert.deepEqual(bad(go(t, ['a.md', '中 文.md'])), [['FAIL', 'links/anchor-missing/a.md｜%E4%B8%AD%20%E6%96%87.md#nope'], ['FAIL', 'links/missing/a.md｜%ZZ.md']])
})

test('同一链接目标重复出现合并成一条，行号进证据：同一行两次也写两个行号（Python 行为：「第 1、1、3 行（共 3 处）」）', () => {
  const t = mk(); put(t, 'a.md', '[a](gone.md) [b](gone.md)\n\n[c](gone.md)\n')
  const r = go(t, ['a.md']).filter((f) => f.status === 'FAIL'); assert.equal(r.length, 1); assert.equal(r[0].where, 'a.md:1'); assert.match(r[0].evidence, /；出现在第 1、1、3 行（共 3 处）$/)
})

test('代码里的链接被涂白不算：行内代码、围栏、波浪围栏里的 [a](gone.md) 都不报；围栏外的照报', () => {
  const t = mk(); put(t, 'a.md', '`[a](gone.md)` ```\n[b](gone.md)\n``` [c](gone.md)\n~~~\n[d](gone.md)\n~~~\n')
  const r = go(t, ['a.md']).filter((f) => f.status === 'FAIL'); assert.equal(r.length, 1); assert.equal(r[0].where, 'a.md:3'); assert.match(r[0].evidence, /出现在第 3 行（共 1 处）$/)
})

test('路径写法：`./sub/s.md` 与 `sub//s.md` 都指到 sub/s.md；链接里的反斜杠 `sub\\s.md` 只在 Windows 上是分隔符（POSIX 上是文件名的一部分 → 断链，Python 在 Linux 上实测如此）', () => {
  const t = mk(); put(t, 'sub/s.md', '# S\n'); put(t, 'a.md', '[a](sub\\s.md) [b](./sub/s.md) [c](sub//s.md)\n')
  const want = process.platform === 'win32' ? [] : [['FAIL', 'links/missing/a.md｜sub\\s.md']]
  assert.deepEqual(bad(go(t, ['a.md', 'sub/s.md'])), want)
})

test('文件清单里的反斜杠换成斜杠（所有平台）：`sub\\s.md` 即 sub/s.md', () => {
  const t = mk(); put(t, 'sub/s.md', '# S\n')
  assert.deepEqual(bad(go(t, ['sub\\s.md'])), [], 'Python 的 `_markdown_files` 把 `\\` 换成 `/`，所以读的是 sub/s.md')
})

test('出仓：目标是指向仓外的符号链接 → 不读、不泄漏内容、记未定', () => {
  const t = mk(), o = mk(); put(o, 'secret.md', '# TOPSECRET\n'); put(t, 'a.md', '[x](c.md#topsecret)\n')
  try { symlinkSync(join(o, 'secret.md'), join(t, 'c.md'), 'file') } catch { return }
  const r = go(t, ['a.md', 'c.md']); assert.ok(!JSON.stringify(r).includes('TOPSECRET')); assert.ok(!r.some((f) => f.status === 'FAIL'))
})

// ---- 变异验证第一轮没抓住的盲区（期望值取自 Python 版实测）----
test('显式锚点 <a id|name>：name、大写 <A ID>、单引号、等号两侧空白、制表符分隔都认；属性顺序反了（href 在前）、空值、无引号都不认（变异 N2、N4、N5、N6）', () => {
  const t = mk()
  put(t, 'b.md', '# B\n<a name="n1"></a>\n<A ID="n2">\n<a id=\'n3\'>\n<a id = "n4">\n<a\tid="n5">\n<a href="x" id="n6">\n<a id="">\n<a id=n7>\n<a  name = \'n8\' >\n')
  put(t, 'a.md', '[1](b.md#n1) [2](b.md#n2) [3](b.md#n3) [4](b.md#n4) [5](b.md#n5) [6](b.md#n6) [7](b.md#n7) [8](b.md#n8)\n')
  assert.deepEqual(bad(go(t, ['a.md', 'b.md'])), [['FAIL', 'links/anchor-missing/a.md｜b.md#n6'], ['FAIL', 'links/anchor-missing/a.md｜b.md#n7']])
})

test('链接目标的几处细节：<> 内首尾空白被去（H1）；`%3F` 解码成 `?` 之后不再当查询串（H11）；锚点里的百分号也解码（H14）；锚点取**第一个** `#` 之后（H15）；中英混合的锚点算中文锚点（H45）；证据文案（H47）', () => {
  const t = mk(); put(t, 'b.md', '# 中\n# a b\n'); put(t, 'a', 'x')
  put(t, 'a.md', '[x](< b.md >)\n'); assert.deepEqual(bad(go(t, ['a.md', 'b.md'])), [], '<> 里首尾空白去掉后是 b.md')
  put(t, 'a.md', '[x](a%3Fb)\n')
  const m = go(t, ['a.md']).find((f) => f.status === 'FAIL'); assert.equal(m.id, 'links/missing/a.md｜a%3Fb'); assert.match(m.evidence, /a\?b；不在归档区/, '解码后是 a?b，不是被剥成 a（文件 a 存在，若剥了就不会 FAIL）')
  put(t, 'a.md', '[x](b.md#%E4%B8%AD) [y](b.md#a%2Db) [z](b.md#a%20b)\n')
  assert.deepEqual(bad(go(t, ['a.md', 'b.md'])), [['FAIL', 'links/anchor-missing/a.md｜b.md#a%20b']], '%E4%B8%AD→中、%2D→-（命中）；%20→空格（锚点是 a-b，不命中）')
  put(t, 'a.md', '[x](b.md#a#b)\n')
  const h = go(t, ['a.md', 'b.md']).find((f) => f.status === 'FAIL'); assert.equal(h.id, 'links/anchor-missing/a.md｜b.md#a#b'); assert.match(h.evidence, /<a id="a#b">/, '锚点是第一个 # 之后的全部：a#b')
  put(t, 'a.md', '[x](b.md#abc中)\n'); assert.deepEqual(bad(go(t, ['a.md', 'b.md'])), [['UNDETERMINED', 'links/anchor-cjk/a.md｜b.md#abc中']])
  put(t, 'a.md', '[x](b.md#xx)\n')
  assert.equal(go(t, ['a.md', 'b.md']).find((f) => f.status === 'FAIL').evidence, '目标 b.md 里既无 <a id="xx">，也没有能生成该锚点的标题。；出现在第 1 行（共 1 处）')
})

test('本机绝对路径的证据只有「出现在第 N 行」，前面没有多余的分号（变异 H35）', () => {
  const t = mk(); put(t, 'a.md', '[a](C:\\x.md)\n')
  assert.equal(go(t, ['a.md']).find((f) => f.id.startsWith('links/host-abs/')).evidence, '出现在第 1 行（共 1 处）')
})

test('目标是超过读取上限的 markdown 且带锚点 → 未定 anchor-unreadable（不是 FAIL、不被吞）（变异 H28、H29）', () => {
  const t = mk(); put(t, 'big.md', '# a\n' + 'x\n'.repeat(1600000)); put(t, 'a.md', '[x](big.md#a)\n')
  const r = go(t, ['a.md']).filter((f) => f.status !== 'PASS'); assert.deepEqual(r.map((f) => [f.status, f.id]), [['UNDETERMINED', 'links/anchor-unreadable/a.md｜big.md#a']])
  assert.ok(r[0].reason.length > 0 && r[0].evidence === '出现在第 1 行（共 1 处）')
})

test('文件清单里的反斜杠规范成斜杠，id 里是规范后的写法（变异 H36）', () => {
  const t = mk(); put(t, 'sub/s.md', '[x](gone.md)\n')
  assert.deepEqual(bad(go(t, ['sub\\s.md'])), [['FAIL', 'links/missing/sub/s.md｜gone.md']])
})

test('git 列不出（扫描根不是仓库）→ 单条未定，reason 带 git 的退出码（变异 H38）', () => {
  const t = mk(); const r = run({ _root: t })
  assert.deepEqual(r.map((f) => [f.status, f.title]), [['UNDETERMINED', '列不出 git 跟踪的 markdown']]); assert.match(r[0].reason, /^git ls-files 退出码 128：/)
})

test('scope：归档区列表写进说明（顿号分隔），未配置写「未配置」', () => {
  assert.equal(scope({ layout: { frozen: ['a', 'b'] } }).covered[2], '归档区（layout.frozen：a、b）里的文件同样检查，断链就是断链；报出时在证据里注明它在归档区')
  assert.match(scope({}).covered[2], /^归档区（layout\.frozen：未配置）/)
  assert.equal(scope({}).covered.length, 3); assert.equal(scope({}).not_covered.length, 9)
})

test('外壳：内部异常 → internal-error 未定，不抛', () => {
  const t = mk(); const r = run({ _root: t, get _links_files() { throw new Error('炸') } })
  assert.deepEqual(r.map((f) => [f.status, f.id]), [['UNDETERMINED', 'links/internal-error']])
})
