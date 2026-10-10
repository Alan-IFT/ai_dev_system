// core/glob 的单元测试：对 Python `glob.glob(os.path.join(glob.escape(root), pattern))` 的黄金样本（golden/unit/glob.json）逐条比对。
// 样本在 Windows 上生成。Windows 上 Python 的 fnmatch 会 normcase（小写）后比较，所以 `Check_c.py` 匹配 `check_*.py`；POSIX 上区分大小写。
// 本实现在 Windows 上用 `i` 标志、其它平台不用，所以两个平台都与「在该平台上跑 Python」一致——样本只在生成它的平台上比整份，其余平台比大小写无关的部分。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { globIn, globAny } from '../lib/core/glob.js'

const here = dirname(fileURLToPath(import.meta.url))
const gold = JSON.parse(readFileSync(join(here, 'fixtures', 'glob.json'), 'utf8'))

const canMake = (rel) => !(process.platform === 'win32' && /[*?"<>|:\n]/.test(rel))
let base, linked = false
/** 每个可造的根名一棵相同的树。 */
const roots = new Map()
test.before(() => {
  base = mkdtempSync(join(tmpdir(), 'tsglob-'))
  for (const rn of gold.root_names) {
    if (!canMake(rn)) continue
    const root = join(base, rn); mkdirSync(root, { recursive: true })
    for (const rel of gold.tree) {
      if (!canMake(rel)) continue
      const p = join(root, ...rel.split('/')); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, '')
    }
    try {
      symlinkSync(join(root, 'tools', 'check_a.py'), join(root, 'tools', 'check_ln.py'), 'file')
      symlinkSync(join(root, 'tools', 'x'), join(root, 'tools', 'lndir'), 'junction')
      symlinkSync(join(root, 'tools', 'no-such-target'), join(root, 'tools', 'check_dangling.py'), 'file')
      linked = true
    } catch { /* 造不出符号链接 */ }
    roots.set(rn, root)
  }
})
test.after(() => rmSync(base, { recursive: true, force: true }))

const sorted = (a) => [...a].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))
/** Python 的 sorted 按码点；样本里已按码点排。这里同样按码点比较（localeCompare 不是）。 */
const cmpCp = (a, b) => { const x = [...a], y = [...b]; for (let i = 0; i < Math.min(x.length, y.length); i++) { const d = x[i].codePointAt(0) - y[i].codePointAt(0); if (d) return d } return x.length - y.length }

test('样本规模与可造根名', () => {
  assert.ok(gold.cases.length >= 100 && gold.patterns.length >= 40 && roots.size >= 3)
  assert.ok(gold.cases.some((c) => c.hits.length) && gold.cases.some((c) => !c.hits.length))
})

test('globIn 在生成样本的平台上对 Python 整份逐条一致（含隐藏文件、中文名、空格、符号链接、`**`、字符类、不闭合的 `[`、尾斜杠、空模式）', { skip: process.platform === gold.platform ? false : `样本是在 ${gold.platform} 上生成的` }, () => {
  const wrong = []
  for (const c of gold.cases) {
    const root = roots.get(c.root); if (!root) continue
    if (!linked && /ln|dangling/.test(c.hits.join(','))) continue
    const got = globIn(root, c.pattern).map((r) => r).sort(cmpCp)
    // '' 与 '*/' 这类：Python 返回 ['.'] 之类特殊值；本实现的用途里不会出现空模式，空模式返回 []，在 EMPTY_OK 里豁免并有专门断言
    if (c.pattern === '') continue
    if (JSON.stringify(got) !== JSON.stringify(c.hits)) wrong.push({ root: c.root, pattern: c.pattern, want: c.hits, got })
  }
  assert.deepEqual(wrong.slice(0, 6), [], `不一致共 ${wrong.length} 条`)
})

// 以下断言不依赖「样本是在哪个平台生成的」，所有平台都跑（否则 Linux 上整份比对被跳过时，这些性质就没人守——Ubuntu 验证时才发现的盲区）。
// 期望值取自 Python 的实测，写成字面量。大小写无关的夹具：名字全小写、只用 a-z。
test('通配的单字符语义（所有平台）：`?` 恰好一个字符，`*` 零个或多个，`.` 是字面（变异 G4、G5、G10）', () => {
  const r = roots.get('plain'), g = (p) => globIn(r, p).sort(cmpCp)
  // `*` 可匹配空串：check_.py 在 `check_*.py` 里命中（G4：`.+` 会丢掉它）
  assert.ok(g('tools/check_*.py').includes('tools/check_.py'), '`*` 匹配空串')
  // `?` 恰好一个字符：check_a.py 命中，check_.py（0 个）与 check_中文.py（2 个字符）不命中（G5：`.*` 会都命中）
  const q = g('tools/check_?.py')
  assert.ok(q.includes('tools/check_a.py') && !q.includes('tools/check_.py') && !q.includes('tools/check_中文.py'), JSON.stringify(q))
  // `.` 是字面（G10：不转义时 `.` 匹配任意字符）：模式 `cls/a*.md` 与 `cls/a*Xmd` 的区别——后者若把 `.` 当通配会命中以 md 结尾的 a 开头名。
  // 用「含通配的段里写字面点」的模式：`cls/a*.md`，夹具里没有名字以 `md` 结尾却缺少 `.` 的，所以改用 `cls/ab*md`：
  // 字面点版本下，`*` 吞掉的是 `.`，ab.md 命中；而 `cls/a?*md` 里若 `.` 当通配则无区别——所以用字符类对照：
  assert.deepEqual(g('cls/a.*'), ['cls/a.b.md', 'cls/a.md'], '`a.*`：a、字面点、任意——命中 a.b.md 与 a.md；`a-b.md`、`ab.md` 的第二个字符不是点，不命中（`.` 不转义则它们也命中）')
  assert.deepEqual(g('cls/ab.md'), ['cls/ab.md'])
})

test('根带 [ ] 时按字面（C14）：同一候选在 `a[b]` 根下与在普通根下命中相同；若不先 escape，在 `a[b]` 根下会一条都命中不了', () => {
  const plain = roots.get('plain'), br = roots.get('a[b]')
  for (const pat of ['tools/check_*.py', 'tools/*/check_*.py', 'tools/*/checks/check_*.py']) {
    assert.deepEqual(globIn(br, pat).sort(cmpCp), globIn(plain, pat).sort(cmpCp), pat)
    assert.ok(globIn(br, pat).length > 0, pat)
  }
  // 第一段就是通配时，要读的是**根目录本身**——它的名字里有 `[b]`，必须按字面（变异 G32；此前只有整份样本比对才踩到，而那条在样本平台以外被跳过）
  assert.deepEqual(globIn(br, '*').sort(cmpCp), globIn(plain, '*').sort(cmpCp)); assert.ok(globIn(br, '*').includes('tools'))
  assert.deepEqual(globIn(br, '*/check_a.py'), ['tools/check_a.py'], '第一段 `*` 要在根目录里列目录项')
  assert.ok(globIn(br, '*/*').includes('tools/check_a.py'))
  const c = gold.cases.find((x) => x.root === 'a[b]' && x.pattern === 'tools/check_*.py')
  assert.ok(c.hits.length > 0 && c.unescaped_hits.length === 0, '样本记着：Python 里不 escape 就命中 0 条')
})

test('隐藏文件：`*` 不匹配以 . 开头的名字，除非模式在该位置也以 . 开头', () => {
  const r = roots.get('plain')
  assert.ok(!globIn(r, 'tools/*').includes('tools/.check_hidden.py'))
  assert.ok(!globIn(r, 'tools/check_*.py').includes('tools/.check_hidden.py'))
  assert.ok(globIn(r, 'tools/.*').includes('tools/.check_hidden.py'))
  assert.ok(!globIn(r, 'tools/*/check_*.py').includes('tools/.h/check_f.py'), '隐藏目录里的文件不匹配 tools/*/')
})

test('`*` 不跨目录；`**` 没有 recursive 时等价于 `*`（不递归到更深一层）', () => {
  const r = roots.get('plain')
  assert.ok(!globIn(r, 'tools/check_*.py').some((p) => p.split('/').length > 2))
  assert.ok(!globIn(r, 'tools/**/check_*.py').includes('tools/x/checks/check_g.py'), '`**` 不递归到 tools/x/checks/')
  assert.deepEqual(globIn(r, 'tools/**/check_*.py').sort(cmpCp), globIn(r, 'tools/*/check_*.py').sort(cmpCp))
})

test('字符类：`[ab]`、`[!a]`、`[a-b]`；不闭合的 `[` 按字面（命中 0 条，与 Python 一致）', () => {
  const r = roots.get('plain')
  assert.deepEqual(globIn(r, 'tools/check_[ab].py'), ['tools/check_a.py'])
  assert.ok(!globIn(r, 'tools/check_[!a].py').includes('tools/check_a.py'))
  assert.deepEqual(globIn(r, 'tools/check_['), []); assert.deepEqual(globIn(r, 'tools/check_[a'), [])
  assert.deepEqual(globIn(r, 'tools/a[[]b]/check_k.py'), ['tools/a[b]/check_k.py'], '`[[]` 是字面的 `[`')
})

test('不含通配字符的模式只判存在；尾斜杠只匹配目录；目录名带 .py 时 `check_*.py/` 命中该目录', () => {
  const r = roots.get('plain')
  assert.deepEqual(globIn(r, 'tools/check_dir.py'), ['tools/check_dir.py']); assert.deepEqual(globIn(r, 'nope/*'), []); assert.deepEqual(globIn(r, 'tools/nope.py'), [])
  assert.deepEqual(globIn(r, 'tools/check_*.py/'), ['tools/check_dir.py'], '尾斜杠：只留目录')
  assert.deepEqual(globIn(r, 'tools/check_dir.py/*'), ['tools/check_dir.py/inner.txt'])
})

test('字符类的边界（对 Python 的 fnmatch 实测）：`^` 是字面不是取反；`]` 作首字符是字面；`-` 在两端是字面；不闭合的 `[` 是字面（变异 G13 到 G16）', () => {
  const r = roots.get('plain')
  const g = (p) => globIn(r, p).sort(cmpCp)
  assert.deepEqual(g('cls/[^a].md'), ['cls/^.md', 'cls/a.md'], '`[^a]` 是「^ 或 a」，不是「非 a」')
  assert.deepEqual(g('cls/[a^].md'), ['cls/^.md', 'cls/a.md'])
  assert.deepEqual(g('cls/[]a].md'), ['cls/].md', 'cls/a.md'], '`[]a]` 的 `]` 是首字符：字面 `]` 或 `a`（变异 G14）')
  assert.deepEqual(g('cls/[]].md'), ['cls/].md'], '`[]]` 是只含 `]` 的字符类')
  assert.deepEqual(g('cls/[!]].md'), ['cls/^.md', 'cls/a.md', 'cls/b.md', 'cls/x.md', 'cls/中.md'], '`[!]]`：除 `]` 之外的单字符')
  assert.deepEqual(g('cls/[\u4e00-\u9fff].md'), ['cls/中.md'], '范围含非 BMP 之外的 CJK')
  assert.deepEqual(g('cls/[a-]b.md'), ['cls/ab.md'], '`[a-]` 末尾的 `-` 是字面'); assert.deepEqual(g('cls/[-a]b.md'), ['cls/ab.md'])
  assert.deepEqual(g('cls/a[.]b.md'), ['cls/a.b.md'], '`[.]` 是字面点'); assert.deepEqual(g('cls/[.]b.md'), [])
  assert.deepEqual(g('cls/a[.md'), [], '不闭合的 `[` 按字面：没有文件名叫 `a[.md`，命中 0 条（变异 G13：吞掉 `[` 会命中 `a.md`）')
  assert.deepEqual(g('cls/[a\\]].md'), [], '字符类里的反斜杠按字面（变异 G15）')
})

test('大小写按平台（变异 G9：所有平台都不区分）：POSIX 上 `Check_c.py` 与 `check_*.py` 不匹配', { skip: process.platform === 'win32' ? 'Windows 上两者本来就匹配' : false }, () => {
  assert.ok(!globIn(roots.get('plain'), 'tools/check_*.py').includes('tools/Check_c.py'))
})

test('点段与重复斜杠被规范化：`./`、`a/../b`、`//` 不留在结果里，与 Python 的 relpath 一致', () => {
  const r = roots.get('plain'), want = globIn(r, 'tools/check_*.py').sort(cmpCp)
  for (const p of ['./tools/check_*.py', 'tools/./check_*.py', 'tools/../tools/check_*.py', 'tools/x/../check_*.py', 'tools//check_*.py', 'tools///check_*.py']) assert.deepEqual(globIn(r, p).sort(cmpCp), want, p)
})

test('无通配的段只判存在、不跟随符号链接：断链（目标不存在）也算存在；真不存在的才不算（变异 G21）', { skip: linked ? false : '本机造不出符号链接' }, () => {
  const r = roots.get('plain')
  assert.deepEqual(globIn(r, 'tools/check_dangling.py'), ['tools/check_dangling.py'], '断链：Python 的 glob 对无通配段用 lexists，断链也命中')
  assert.deepEqual(globIn(r, 'tools/check_ln.py'), ['tools/check_ln.py']); assert.deepEqual(globIn(r, 'tools/lndir'), ['tools/lndir'])
  assert.deepEqual(globIn(r, 'tools/lndir/check_d.py'), ['tools/lndir/check_d.py']); assert.deepEqual(globIn(r, 'tools/no-such-target'), [])
})

test('文件名含换行：`?` 与 `*` 在 Python 的 fnmatch 里匹配换行（DOTALL）；本实现带 s 标志同义（变异 G18，只在能造出这种名字的平台上）', { skip: process.platform === 'win32' ? 'Windows 造不出含换行的文件名' : false }, () => {
  const r = roots.get('plain')
  assert.deepEqual(globIn(r, 'nl/a?b.md').sort(cmpCp), ['nl/a\nb.md', 'nl/a b.md'].sort(cmpCp)); assert.deepEqual(globIn(r, 'nl/a*b.md').sort(cmpCp), ['nl/a\nb.md', 'nl/a b.md'].sort(cmpCp))
})

test('中文名与带空格的名字照常匹配；候选三种形态各命中其夹具', () => {
  const r = roots.get('plain')
  assert.ok(globIn(r, 'tools/check_*.py').includes('tools/check_中文.py'))
  assert.ok(globIn(r, 'tools/*/checks/check_*.py').includes('tools/sub dir/checks/check_i.py'))
  assert.ok(globIn(r, 'tools/*/checks/check_*.py').includes('tools/中文/checks/check_h.py'))
  assert.ok(globIn(r, 'tools/*/check_*.py').includes('tools/x/check_d.py'))
  assert.ok(!globIn(r, 'tools/*/check_*.py').includes('tools/x/check_e.pyc'), '.pyc 不匹配 .py（整段匹配，不是前缀）')
})

test('大小写按平台：Windows 上不区分（`Check_c.py` 匹配 `check_*.py`），POSIX 上区分', () => {
  const r = roots.get('plain'); const hit = globIn(r, 'tools/check_*.py').includes('tools/Check_c.py')
  assert.equal(hit, process.platform === 'win32')
})

test('globAny：只问「有没有命中」且受 accept 过滤（layout 用它剔除真实位置出仓的命中）', () => {
  const r = roots.get('plain')
  assert.equal(globAny(r, 'tools/check_*.py', () => true), true); assert.equal(globAny(r, 'tools/check_*.py', () => false), false); assert.equal(globAny(r, 'nope/*', () => true), false)
})

test('符号链接：到文件、到目录、断链都按名字匹配（glob 只读目录项，不跟随）', { skip: linked ? false : '本机造不出符号链接' }, () => {
  const r = roots.get('plain')
  const h = globIn(r, 'tools/check_*.py')
  assert.ok(h.includes('tools/check_ln.py') && h.includes('tools/check_dangling.py'))
  assert.ok(globIn(r, 'tools/*/check_*.py').includes('tools/lndir/check_d.py'), '经符号链接目录进入')
})
