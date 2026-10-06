// core/tracked 的单元测试：对 Python 的黄金样本（golden/unit/tracked.json）逐条比对；夹具是真实 git 仓（与 make_unit_tracked.py 同一组文件）。
// 与 Python 版的有意差异 D17：不带 `embedded_std_rel`（.std/ 自排除）——黄金样本里它对三个采用项目全部返回 None，删掉不改变任何样本。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { trackedFiles, markdownUnder, workItems, withScanMemo, cmpCodepoint } from '../lib/core/tracked.js'

const here = dirname(fileURLToPath(import.meta.url))
const gold = JSON.parse(readFileSync(join(here, '..', 'golden', 'unit', 'tracked.json'), 'utf8'))

let tmp
const gitq = (args, cwd) => spawnSync('git', ['-C', cwd ?? tmp, '-c', 'init.defaultBranch=main', '-c', 'user.email=a@b.c', '-c', 'user.name=n', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8' })
test.before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tstr-'))
  gitq(['init', '-q'])
  const made = []
  // 只造样本里有的那批（Windows 上造不出 NOT_ON_WIN 的三个，样本里没有它们）：这样 Windows 生成的样本在 Linux 上也能整份比对。Linux 专有的三个文件另有断言
  for (const rel of gold.files.filter((f) => !gold.not_made.includes(f))) {
    const p = join(tmp, rel)
    try {
      mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, 'x\n')
      if (!readdirSync(dirname(p)).includes(basename(rel))) continue // Windows 上 `col:on.md` 建出的是备用数据流，不算造成
      made.push(rel)
    } catch { /* 造不出 */ }
  }
  writeFileSync(join(tmp, '.gitignore'), 'ignored.md\nbuild/\n')
  for (const rel of ['ignored.md', 'build/o.md', 'untracked.md']) { mkdirSync(dirname(join(tmp, rel)), { recursive: true }); writeFileSync(join(tmp, rel), 'x\n') }
  const add = gitq(['--literal-pathspecs', 'add', '-f', '--', ...made, '.gitignore'])
  assert.equal(add.status, 0, add.stderr)
  unlinkSync(join(tmp, 'dup.md')) // 工作区已删但仍在索引里
})
test.after(() => rmSync(tmp, { recursive: true, force: true }))

const sorted = (a) => (a === null ? null : [...a].sort(cmpCodepoint))
const run = (fn) => { try { return fn() } catch (e) { return { raised: e.name } } }

test('样本规模', () => assert.ok(gold.cases.length >= 20 && Object.keys(gold.markdown_under).length >= 12 && Object.keys(gold.work_items).length >= 10))

test('trackedFiles：每种模式对 Python 逐条一致（通配、目录前缀、大小写、字符类、字面括号、中文、空模式串报错）', () => {
  const wrong = []
  for (const c of gold.cases) {
    const [files, problem] = trackedFiles(tmp, c.patterns ?? undefined)
    const want = c.files
    const ok = want === null ? files === null && c.problem.startsWith('git ls-files 退出码 128') && problem?.startsWith('git ls-files 退出码 128') : JSON.stringify(sorted(files)) === JSON.stringify(want) && problem === null
    if (!ok) wrong.push({ pat: c.patterns, want, got: sorted(files), problem })
  }
  assert.deepEqual(wrong.slice(0, 4), [], `不一致共 ${wrong.length} 条`)
})

test('Linux 专有文件名（含 `*`、`?`、`:`）：git 列出的就是原名；用字面 pathspec 时这些名字不被当通配（Windows 上造不出，跳过）', { skip: process.platform === 'win32' ? 'Windows 上造不出含 * ? : 的文件名' : false }, () => {
  const odd = mkdtempSync(join(tmpdir(), 'tstr-lnx-'))
  try {
    gitq(['init', '-q'], odd)
    for (const n of ['star*.md', 'q?.md', 'col:on.md', 'plain.md']) writeFileSync(join(odd, n), 'x')
    assert.equal(gitq(['--literal-pathspecs', 'add', '-f', '--', 'star*.md', 'q?.md', 'col:on.md', 'plain.md'], odd).status, 0)
    assert.deepEqual(sorted(trackedFiles(odd)[0]), ['col:on.md', 'plain.md', 'q?.md', 'star*.md'].sort(cmpCodepoint), '原名，不被 core.quotepath 转义')
    assert.deepEqual(sorted(trackedFiles(odd, ['*.md'])[0]), ['col:on.md', 'plain.md', 'q?.md', 'star*.md'].sort(cmpCodepoint), '`*.md` 作 pathspec 通配命中它们全部')
    assert.deepEqual(sorted(trackedFiles(odd, ['q?.md'])[0]), ['q?.md'], '`q?.md` 里的 ? 是通配：只匹配单字符，命中 q?.md 自己（? 本身是一个字符）')
    assert.deepEqual(trackedFiles(odd, ['star*.md'])[0], ['star*.md'])
  } finally { rmSync(odd, { recursive: true, force: true }) }
})

test('文件名里含反斜杠（只有 POSIX 造得出）：git 列的是原名 `docs/a\\b.md`，markdownUnder 把它规范成 `docs/a/b.md`（Python 在 Linux 上实测如此）（变异 U7）', { skip: process.platform === 'win32' ? 'Windows 上文件名不能含反斜杠' : false }, () => {
  const odd = mkdtempSync(join(tmpdir(), 'tstr-bs-'))
  try {
    gitq(['init', '-q'], odd); mkdirSync(join(odd, 'docs'))
    writeFileSync(join(odd, 'docs', 'a\\b.md'), 'x'); writeFileSync(join(odd, 'docs', 'c.md'), 'x')
    assert.equal(gitq(['--literal-pathspecs', 'add', '-f', '--', '.'], odd).status, 0)
    assert.deepEqual(sorted(trackedFiles(odd)[0]), ['docs/a\\b.md', 'docs/c.md'], 'git 原名')
    assert.deepEqual(markdownUnder(odd, 'docs'), [['docs/a/b.md', 'docs/c.md'], null])
    assert.deepEqual(markdownUnder(odd, 'docs\\'), [['docs/a/b.md', 'docs/c.md'], null], '子目录写法的反斜杠同样规范')
  } finally { rmSync(odd, { recursive: true, force: true }) }
})

test('trackedFiles 的几个性质（直接断言，不依赖样本）：通配生效（不加 --literal-pathspecs）；未跟踪与被忽略的不列；已删除但仍在索引里的照列；中文路径原样', () => {
  const [all] = trackedFiles(tmp)
  assert.ok(!all.includes('untracked.md') && !all.includes('ignored.md') && !all.includes('build/o.md'), '未跟踪与被忽略的不列')
  assert.ok(all.includes('dup.md'), '工作区已删、索引里仍在：照列')
  assert.ok(all.includes('中文.md') && all.includes('目录/文档.md'), '中文路径原样（-z，不被 core.quotepath 转义成 \\345...）')
  assert.deepEqual(sorted(trackedFiles(tmp, ['m[1].json'])[0]), ['m1.json', 'm[1].json'].sort(cmpCodepoint), 'pathspec 里的 [1] 是通配：m[1].json 命中 m1.json 与自己')
  assert.equal(trackedFiles(tmp, ['*.md'])[0].some((p) => p.endsWith('.markdown')), false); assert.ok(trackedFiles(tmp, ['*.markdown'])[0].includes('b.markdown'))
  assert.deepEqual(trackedFiles(tmp, ['*.MD'])[0].sort(), ['a.MD', 'docs/UPPER.MD'], '*.MD 区分大小写（git 的 pathspec 默认区分）')
})

test('非仓与空仓：普通目录与不存在的目录 → [null, 原因（退出码 128）]；空仓 → [[], null]', () => {
  const plain = mkdtempSync(join(tmpdir(), 'tstr-plain-')), empty = mkdtempSync(join(tmpdir(), 'tstr-empty-'))
  try {
    gitq(['init', '-q'], empty)
    const a = trackedFiles(plain); assert.equal(a[0], null); assert.match(a[1], /^git ls-files 退出码 128：/)
    const b = trackedFiles(join(plain, 'no-such-dir')); assert.equal(b[0], null); assert.match(b[1], /^git ls-files 退出码 128：/)
    assert.deepEqual(trackedFiles(empty), [[], null])
  } finally { rmSync(plain, { recursive: true, force: true }); rmSync(empty, { recursive: true, force: true }) }
})

test('markdownUnder：每种子目录写法对 Python 逐条一致（尾斜杠、`.`、空串、反斜杠、首尾空白、`./` 前缀、不存在、docsx 不误含 docs）', () => {
  const wrong = []
  for (const [sub, want] of Object.entries(gold.markdown_under)) {
    const [files, problem] = markdownUnder(tmp, sub)
    const ok = JSON.stringify(files) === JSON.stringify(want.files) && problem === want.problem
    if (!ok) wrong.push({ sub, want: want.files, got: files })
  }
  assert.deepEqual(wrong.slice(0, 4), [], `不一致共 ${wrong.length} 条`)
})

test('workItems：每种工作项目录写法对 Python 逐条一致（直接一层、子目录不算、整仓写法 `.`/空串只取根下一层）', () => {
  const wrong = []
  for (const [wr, want] of Object.entries(gold.work_items)) {
    const [files, problem] = workItems(tmp, wr)
    if (JSON.stringify(files) !== JSON.stringify(want.files) || problem !== want.problem) wrong.push({ wr, want: want.files, got: files })
  }
  assert.deepEqual(wrong.slice(0, 4), [], `不一致共 ${wrong.length} 条`)
})

test('markdownUnder 的结果按码点排序（Python 的 sorted）；后缀大小写不敏感（.MD 算）；只认 .md', () => {
  const [files] = markdownUnder(tmp, '.')
  assert.deepEqual(files, [...files].sort(cmpCodepoint)); assert.ok(files.includes('a.MD') && files.includes('docs/UPPER.MD'), '.MD 大写后缀算')
  assert.ok(!files.includes('b.markdown'), 'markdownUnder 只认 .md（Python 的 markdown_under 同；.markdown 只在 links 检查器自己的列表里收）')
  assert.ok(!files.includes('c.txt') && !files.includes('e.md.bak'))
})

// ---- 变异验证第一轮没抓住的盲区（期望值取自 Python 版实测）----
const haveSh = spawnSync('sh', ['-c', 'exit 0']).status === 0

test('恶意仓：被扫仓配置里的 core.fsmonitor 不得被执行（变异 L5：不经 hardenedEnv）——对照组先证明不加固时 git ls-files 确会执行它', { skip: haveSh ? false : '没有 sh（标记文件靠 touch 创建）' }, () => {
  const evil = mkdtempSync(join(tmpdir(), 'tstr-evil-'))
  try {
    gitq(['init', '-q'], evil); writeFileSync(join(evil, 'a.md'), 'x'); gitq(['add', 'a.md'], evil)
    const mark = join(evil, 'PWNED').replaceAll('\\', '/')
    gitq(['config', 'core.fsmonitor', `touch ${mark}; false`], evil)
    // 对照组：直接跑（不经加固）→ 标记文件出现，证明这个攻击在本机真实可行
    spawnSync('git', ['-C', evil, 'ls-files'], { encoding: 'utf8' })
    assert.ok(readdirSync(evil).includes('PWNED'), '对照组：不经加固时，git ls-files 会执行 core.fsmonitor——否则本测试什么也没证明')
    unlinkSync(join(evil, 'PWNED'))
    const [files] = trackedFiles(evil, ['*.md']); assert.deepEqual(files, ['a.md'])
    assert.ok(!readdirSync(evil).includes('PWNED'), 'trackedFiles 经 hardenedEnv：fsmonitor 没有被执行')
  } finally { rmSync(evil, { recursive: true, force: true }) }
})

test('非仓时的问题文案：「git ls-files 退出码 128：」后带 git 自己的 stderr（去首尾空白、取前 200 字符）（变异 L8、L9、L10）', () => {
  const plain = mkdtempSync(join(tmpdir(), 'tstr-plain-'))
  try {
    const [files, problem] = trackedFiles(plain)
    assert.equal(files, null); assert.match(problem, /^git ls-files 退出码 128：fatal: not a git repository/)
    assert.ok(problem.length > 'git ls-files 退出码 128：'.length + 30, 'stderr 要带上，不能只剩前缀（变异 L8、L10）')
    assert.ok(!/[\r\n]$/.test(problem), '去掉了 stderr 末尾的换行（变异 L9：不去空白）')
  } finally { rmSync(plain, { recursive: true, force: true }) }
})

test('git 跑不起来（PATH 里没有 git）→ [null, 「跑不了 git ls-files：…」]，不抛、不当空仓（变异 L11）', () => {
  const saved = process.env.PATH
  try {
    process.env.PATH = mkdtempSync(join(tmpdir(), 'tstr-nopath-'))
    const [files, problem] = trackedFiles(tmp, ['*.md'])
    assert.equal(files, null); assert.match(problem, /^跑不了 git ls-files：/)
  } finally { rmSync(process.env.PATH, { recursive: true, force: true }); process.env.PATH = saved }
})

test('缓存的细节（变异 M4、M6、M8、M9）：键用真实路径（同一目录的不同写法命中同一项）；退出后外层缓存仍在（嵌套退出不是置空）；出错也缓存且带问题；模式缺省与空数组是同一项', () => {
  const plain = mkdtempSync(join(tmpdir(), 'tstr-plain2-'))
  try {
    // M8：非仓的问题被缓存时仍带问题，不变成「没问题的 null」
    withScanMemo(plain, () => {
      const a = trackedFiles(plain); const b = trackedFiles(plain)
      assert.equal(a[0], null); assert.match(a[1], /^git ls-files 退出码 128/); assert.deepEqual(b, a, '缓存命中也保留问题')
    })
    // M9：undefined 与 [] 是同一缓存项：中途改了索引，第二次仍看不到
    const repo = mkdtempSync(join(tmpdir(), 'tstr-memo-'))
    try {
      gitq(['init', '-q'], repo); writeFileSync(join(repo, 'a.md'), 'x'); gitq(['add', 'a.md'], repo)
      withScanMemo(repo, () => {
        const n1 = trackedFiles(repo)[0].length
        writeFileSync(join(repo, 'b.md'), 'x'); gitq(['add', 'b.md'], repo)
        assert.equal(trackedFiles(repo, [])[0].length, n1, '缺省与 [] 同一项：不重跑')
        // M4：同一目录换个写法（尾斜杠 + 点段）→ 真实路径相同，命中同一缓存项
        assert.equal(trackedFiles(repo + '/./')[0].length, n1, '键用真实路径：不同写法的同一根命中同一项')
        // M6：内层退出后，外层的缓存还在（置空会让它重跑、看到 b.md）
        withScanMemo(repo, () => { trackedFiles(repo) })
        assert.equal(trackedFiles(repo)[0].length, n1, '内层退出后恢复外层：外层缓存仍有效')
      })
    } finally { rmSync(repo, { recursive: true, force: true }) }
  } finally { rmSync(plain, { recursive: true, force: true }) }
})

test('出错时 markdownUnder 与 workItems 透传问题（不吞成空列表）（变异 U8、W9）；整仓写法 `.` 与空串都只取根下一层（变异 W4）', () => {
  const plain = mkdtempSync(join(tmpdir(), 'tstr-plain3-'))
  try {
    for (const [fn, arg] of [[markdownUnder, '.'], [workItems, 'docs/state/work']]) {
      const [files, problem] = fn(plain, arg); assert.equal(files, null); assert.match(problem, /^git ls-files 退出码 128/)
    }
  } finally { rmSync(plain, { recursive: true, force: true }) }
  const a = workItems(tmp, '.'), b = workItems(tmp, '')
  assert.deepEqual(a, b); assert.ok(a[0].length > 5 && a[0].every((r) => !r.includes('/')), '根下一层')
})

test('模式串原样交给 git，**不加 `--`**：以 `-` 开头的「模式」被 git 当成选项（`-z`、`--others` 生效，`--help` 让 git 输出用法），与 Python 一致（变异 L3）；只含 Python 空白之外字符的路径名（U+FEFF）不被丢（变异 L13）', () => {
  assert.deepEqual(sorted(trackedFiles(tmp, ['-z'])[0]), sorted(trackedFiles(tmp)[0]), '`-z` 是选项（重复给 -z 无副作用）：结果同无模式')
  const others = trackedFiles(tmp, ['--others'])[0]
  assert.ok(others.includes('untracked.md') && !others.includes('README.md'), '`--others` 是选项：列的是**未跟踪**的，不含已跟踪的 README.md——若被当成路径（加了 `--`）就会什么也匹配不到')
  const odd = mkdtempSync(join(tmpdir(), 'tstr-odd-'))
  try {
    gitq(['init', '-q'], odd)
    for (const n of ['\ufeff', 'a.md']) { try { writeFileSync(join(odd, n), 'x') } catch { return } }
    gitq(['--literal-pathspecs', 'add', '-f', '--', '\ufeff', 'a.md'], odd)
    assert.deepEqual(sorted(trackedFiles(odd)[0]), ['\ufeff', 'a.md'].sort(cmpCodepoint), 'U+FEFF 不是 Python 空白：名为 U+FEFF 的路径保留（`.trim()` 会把它当空白丢掉）')
  } finally { rmSync(odd, { recursive: true, force: true }) }
})

test('cmpCodepoint：按码点而不是 UTF-16 码元（emoji 排在 BMP 末段字符之后）', () => {
  assert.deepEqual(['\u{1F600}', '\uFF21', 'a', 'B'].sort(cmpCodepoint), ['B', 'a', '\uFF21', '\u{1F600}'])
  assert.deepEqual(['b', 'a', 'ab', ''].sort(cmpCodepoint), ['', 'a', 'ab', 'b']); assert.equal(cmpCodepoint('a', 'a'), 0)
})

test('withScanMemo：扫描根同一组模式只跑一次 git ls-files；缓存里的数组被调用方改动不污染缓存；退出即关；嵌套各用各的；别的根不缓存', () => {
  let n = 0
  const real = trackedFiles
  void real
  // 观察「跑了几次 git」：在缓存期间，工作区新增并 add 一个文件，缓存内第二次调用看不到它，缓存外能看到
  withScanMemo(tmp, () => {
    const first = trackedFiles(tmp, ['*.md'])[0]; n = first.length
    writeFileSync(join(tmp, 'late.md'), 'x\n'); gitq(['--literal-pathspecs', 'add', '-f', '--', 'late.md'])
    const second = trackedFiles(tmp, ['*.md'])[0]
    assert.equal(second.length, n, '缓存内：第二次不重跑 git，看不到新文件')
    second.push('污染.md'); assert.equal(trackedFiles(tmp, ['*.md'])[0].length, n, '调用方改动返回的数组不污染缓存')
    assert.equal(trackedFiles(tmp, ['*.markdown'])[0].length, 1, '不同模式是不同缓存项（此项是第一次调用，会真跑 git）')
    assert.ok(trackedFiles(tmp)[0].includes('late.md'), '无模式是又一个缓存项：它第一次被调用发生在 late.md 已 add 之后，所以看得到')
  })
  assert.ok(trackedFiles(tmp, ['*.md'])[0].includes('late.md'), '退出缓存后看得到新文件')
  const other = mkdtempSync(join(tmpdir(), 'tstr-other-'))
  try {
    gitq(['init', '-q'], other); writeFileSync(join(other, 'o.md'), 'x'); gitq(['add', 'o.md'], other)
    withScanMemo(tmp, () => {
      trackedFiles(tmp, ['*.md'])
      assert.deepEqual(trackedFiles(other, ['*.md']), [['o.md'], null], '别的根不走缓存（检查器自检在临时仓里建夹具、改完再列）')
      writeFileSync(join(other, 'o2.md'), 'x'); gitq(['add', 'o2.md'], other)
      assert.equal(trackedFiles(other, ['*.md'])[0].length, 2, '别的根每次都重跑')
      withScanMemo(other, () => { assert.equal(trackedFiles(other, ['*.md'])[0].length, 2) }) // 嵌套：内层用自己的
      assert.ok(!trackedFiles(tmp, ['*.md'])[0].includes('o.md'), '内层退出后恢复外层')
    })
  } finally { rmSync(other, { recursive: true, force: true }) }
})
