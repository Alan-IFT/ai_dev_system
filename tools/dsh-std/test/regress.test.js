// 回归用例：D-135 提交前的独立审查（只读 diff 的另一个执行者）实测出的绕过，逐条固化。
// 每条都先在改前的判定器上复现为 allow（见完善记录），改后应为 ask／deny。
// 平台说明：路径规整（大小写、段尾点与空格、\\?\ 前缀）只在 Windows 上有意义，其它平台上这几条用例跳过并说明。

import test from 'node:test'
import assert from 'node:assert/strict'
import { decide, normalizeForCompare } from '../lib/policy.js'
import { apply } from '../lib/index.js'

const WIN = process.platform === 'win32'
const ROOT = WIN ? 'D:\\proj' : '/proj'
const sh = (command) => ({ name: WIN ? 'pwsh' : 'bash', arguments: { command } })
const w = (file_path) => ({ name: 'write', arguments: { file_path } })
const bashSh = (command) => ({ name: 'bash', arguments: { command } })   // 固定 bash 工具名（不随平台变），用来在任何平台上钉 POSIX 写法

const winOnly = (title, fn) => test(title, { skip: WIN ? false : '仅 Windows 的路径规整语义' }, fn)

// —— 写工具：.std 路径的 Win32 变形 ——
winOnly('段尾点 .std. 仍是 .std => deny', () => assert.equal(decide(w('.std./a.md'), { root: ROOT }).kind, 'deny'))
winOnly('段尾空格 ".std /a.md" => deny', () => assert.equal(decide(w('.std /a.md'), { root: ROOT }).kind, 'deny'))
winOnly('\\\\?\\ 前缀绝对路径 => deny', () => assert.equal(decide(w('\\\\?\\D:\\proj\\.std\\a.md'), { root: ROOT }).kind, 'deny'))
winOnly('大小写 .STD => deny', () => assert.equal(decide(w('.STD/a.md'), { root: ROOT }).kind, 'deny'))
winOnly('受保护文件大小写 agents.md => ask', () => assert.equal(decide(w('agents.md'), { root: ROOT }).kind, 'ask'))
winOnly('受保护目录大小写 .GITHOOKS/pre-commit => ask', () => assert.equal(decide(w('.GITHOOKS/pre-commit'), { root: ROOT }).kind, 'ask'))
winOnly('守卫自身大小写 TOOLS/DSH-STD/lib/policy.js => ask', () => assert.equal(decide(w('TOOLS/DSH-STD/lib/policy.js'), { root: ROOT }).kind, 'ask'))
winOnly('normalizeForCompare 剥段尾点空格并小写', () => assert.equal(normalizeForCompare('D:\\Proj\\.STD. \\A.md'), 'd:\\proj\\.std\\a.md'))

// —— 反例保险：规整不能把无关路径误判成 .std ——
test('.stdx 不是 .std => allow', () => assert.equal(decide(w('.stdx/a.md'), { root: ROOT }).kind, 'allow'))
test('std（无点）不是 .std => allow', () => assert.equal(decide(w('std/a.md'), { root: ROOT }).kind, 'allow'))

// —— shell：写动词与 .std ——
for (const [title, cmd] of [
  ['别名 ri -r .std', 'ri -r .std'],
  ['别名 sc .std/a x', 'sc .std/a x'],
  ['别名 ac .std/a x', 'ac .std/a x'],
  ['别名 mi a .std/a', 'mi a .std/a'],
  ['别名 cpi a .std/a', 'cpi a .std/a'],
  ['别名 ni .std/a.md', 'ni .std/a.md'],
  ['cmd rd /s /q .std', 'rd /s /q .std'],
  ['robocopy 目标 .std', 'robocopy src .std /E'],
  ['xcopy 目标 .std', 'xcopy src .std /E'],
  ['重定向无空格 >.std/a', 'echo x >.std/a'],
  ['iwr -OutFile .std', 'iwr http://x -OutFile .std/a'],
  ['curl -o .std', 'curl -o .std/a http://x'],
  ['dd of=.std', 'dd of=.std/a'],
  ['rsync 目标 .std', 'rsync -a src/ .std/'],
  ['ln -s 到 .std', 'ln -s a .std/a'],
  ['truncate .std', 'truncate -s0 .std/a'],
  ['git stash push -- .std', 'git stash push -- .std'],
  ['git apply 到 .std（命令里提到 .std）', 'git apply --directory=.std p.diff'],
]) test(`写 .std：${title} => 被拦（ask 或 deny，不能放行）`, () => assert.notEqual(decide(sh(cmd), { root: ROOT }).kind, 'allow', cmd))

// —— Windows 专属写法：反斜杠是路径分隔符、`.STD` 与 `.std` 是同一个目录、cmd 内置 `move`/`copy`。
// Linux 上 `\\` 只是文件名里的普通字符、`.STD` 是另一个目录，这些命令本来就写不到 `.std`，断言「必须被拦」在那里不成立
// （Ubuntu 容器里跑 `node --test` 就是因此红了 7 条）。所以只在 Windows 上断言；Linux 的对应覆盖是紧随其后的 POSIX 表。
for (const [title, cmd] of [
  ['cmd move a .std\\a', 'move a .std\\a'],
  ['cmd copy a .std\\a', 'copy a .std\\a'],
  ['Set-Content 大小写 .STD', 'Set-Content .STD/a x'],
  ['ren .std\\a b（反斜杠）', 'ren .std\\a b'],
  ['Copy-Item x .std\\ 2>nul（反斜杠）', 'Copy-Item x .std\\ 2>nul'],
  ['Tee-Object .std\\a（反斜杠）', 'Get-Content a | Tee-Object .std\\a'],
  ['Set-Content .std\\a.md（反斜杠）', "Set-Content .std\\a.md 'x'"],
]) winOnly(`写 .std（仅 Windows）：${title} => 被拦`, () => assert.notEqual(decide(sh(cmd), { root: ROOT }).kind, 'allow', cmd))

// —— Linux（bash 工具名）对应覆盖：同一类动作的 POSIX 写法，以及「大小写不同的目录不是 .std」这一条平台语义本身。
for (const [title, cmd] of [
  ['bash mv 到 .std', 'mv a .std/a'],
  ['bash cp 到 .std', 'cp a .std/a'],
  ['bash cp -r 到 .std', 'cp -r src .std/'],
  ['bash 重定向到 .std', 'echo x >> .std/a'],
  ['bash install 到 .std', 'install -m 644 a .std/a'],
]) test(`写 .std（bash 工具名）：${title} => 被拦`, () => assert.notEqual(decide(bashSh(cmd), { root: ROOT }).kind, 'allow', cmd))
test('Linux 语义：`.STD` 与 `.std` 是两个目录，大小写不同的写入不算写 .std（只在非 Windows 上成立）', { skip: WIN ? 'Windows 大小写不敏感，两者是同一个目录' : false }, () => {
  assert.equal(decide(w('.STD/a'), { root: ROOT }).kind, 'allow')
})

for (const [title, cmd] of [
  ['只读 Get-Content .std', 'Get-Content .std/标准/README.md'],
  ['只读 ls .std', 'ls .std'],
  ['只读 cat .std', 'cat .std/a.md'],
  ['git status', 'git status -sb'],
  ['不相干的 touch', 'touch docs/a.md'],
]) test(`读或无关：${title} => allow`, () => assert.equal(decide(sh(cmd), { root: ROOT }).kind, 'allow', cmd))

// —— shell：受保护位置 + 写动词 => ask ——
for (const [title, cmd] of [
  ['Set-Content AGENTS.md', 'Set-Content AGENTS.md x'],
  ['Set-Content CONTEXT_MANIFEST.md', 'Set-Content CONTEXT_MANIFEST.md x'],
  ['Set-Content 钩子', "Set-Content .githooks/pre-commit 'exit 0'"],
  ['Remove-Item .githooks', 'Remove-Item -Recurse .githooks'],
  ['Set-Content 守卫自身', 'Set-Content tools/dsh-std/lib/policy.js x'],
  ['重定向改入口 >AGENTS.md', 'echo x >AGENTS.md'],
  ['删状态入口别名 ri', 'ri PROJECT_STATUS.md'],
  ['删状态入口 rd/del', 'del PROJECT_STATUS.md'],
]) test(`受保护：${title} => ask`, () => assert.equal(decide(sh(cmd), { root: ROOT }).kind, 'ask', cmd))

test('受保护位置只读不问：cat AGENTS.md => allow', () => assert.equal(decide(sh('cat AGENTS.md'), { root: ROOT }).kind, 'allow'))
test('受保护位置只读不问：Get-Content CONTEXT_MANIFEST.md => allow', () => assert.equal(decide(sh('Get-Content CONTEXT_MANIFEST.md'), { root: ROOT }).kind, 'allow'))
test('名字相近不误问：Set-Content docs/AGENTS.md.bak 之外的 AGENTSX.md => allow', () => assert.equal(decide(sh('Set-Content AGENTSX.md x'), { root: ROOT }).kind, 'allow'))

// —— shell：受控 git 动作的变形 ——
for (const [title, cmd] of [
  ['强推 +refspec', 'git push origin +main'],
  ['强推 +HEAD:main', 'git push origin +HEAD:main'],
  ['删远端 :old', 'git push origin :old'],
  ['push -d', 'git push -d origin old'],
  ['push --mirror', 'git push --mirror'],
  ['push --prune', 'git push --prune origin'],
  ['别名远端推 release', 'git push public release:main'],
  ['按名字推 tag refs/tags', 'git push origin refs/tags/2026-10-04'],
  ['branch -fD', 'git branch -fD x'],
  ['branch -Df', 'git branch -Df x'],
  ['branch -dr', 'git branch -dr x'],
  ['update-ref -d', 'git update-ref -d refs/heads/x'],
  ['reset --ha 缩写', 'git reset --ha'],
  ['--no-veri 缩写', 'git commit --no-veri -m x'],
  ['--force-if-includes', 'git push --force-if-includes origin main'],
  ['ri 删 PROJECT_STATUS（别名）', 'ri PROJECT_STATUS.md'],
]) test(`受控 git：${title} => ask`, () => assert.notEqual(decide(sh(cmd), { root: ROOT }).kind, 'allow', cmd))
test('受控 git：reset --hard 反引号续行（固定 pwsh 工具名：反引号在 PowerShell 里是续行，在 bash 里是命令替换，Linux 上用 sh() 会选 bash 而判成放行）', () =>
  assert.notEqual(decide({ name: 'pwsh', arguments: { command: 'git reset `\n --hard' } }, { root: ROOT }).kind, 'allow'))

test('无续行符的换行是两条独立命令：`git reset` 与 `--hard`，后者不是 git，放行', () => assert.equal(decide(sh('git reset\n--hard'), { root: ROOT }).kind, 'allow'))

for (const [title, cmd] of [
  ['普通 push', 'git push origin main'],
  ['普通 commit', 'git commit -m "feat: x"'],
  ['git log', 'git log --oneline -5'],
  ['git diff', 'git diff --stat'],
  ['git branch 列出', 'git branch -a'],
  ['git branch 新建', 'git branch topic'],
]) test(`受控 git 反向保险：${title} => allow`, () => assert.equal(decide(sh(cmd), { root: ROOT }).kind, 'allow', cmd))

// —— 适配层：合并取最严、不放宽 ——
function wire(config) {
  const hs = []
  apply({ on: (e, f) => hs.push([e, f]), logger: () => ({ info() {}, warn() {} }) }, config)
  return hs[0][1]
}
const down = (kind, reason = 'downstream') => async () => ({ kind, reason })

test('适配层：下游 ask 而本插件 deny => deny（审查发现的缺陷）', async () => {
  const fn = wire({ root: ROOT })
  const d = await fn({ name: 'write', arguments: { file_path: '.std/a.md' } }, down('ask'))
  assert.equal(d.kind, 'deny')
})
test('适配层：下游 deny 而本插件 allow => deny 保持', async () => {
  const fn = wire({ root: ROOT })
  const d = await fn({ name: 'write', arguments: { file_path: 'docs/a.md' } }, down('deny', '别的守卫'))
  assert.deepEqual(d, { kind: 'deny', reason: '别的守卫' })
})
test('适配层：下游 allow 而本插件 ask => ask', async () => {
  const fn = wire({ root: ROOT })
  const d = await fn(sh('git tag x'), down('allow'))
  assert.equal(d.kind, 'ask')
})
test('适配层：下游 ask 而本插件 ask => 保持下游（不重复）', async () => {
  const fn = wire({ root: ROOT })
  const d = await fn(sh('git tag x'), down('ask', '下游理由'))
  assert.deepEqual(d, { kind: 'ask', reason: '下游理由' })
})
test('适配层：下游返回认不出的决定 => 按 ask 的严重度处理，不当放行', async () => {
  const fn = wire({ root: ROOT })
  const d = await fn({ name: 'write', arguments: { file_path: '.std/a.md' } }, async () => ({ kind: 'weird' }))
  assert.equal(d.kind, 'deny')
})
test('适配层：下游返回 undefined => 当 allow 处理，本插件照判', async () => {
  const fn = wire({ root: ROOT })
  const d = await fn(sh('git tag x'), async () => undefined)
  assert.equal(d.kind, 'ask')
})
test('适配层：配置里的 root 生效（cwd 不是项目根也判得对）', async () => {
  const fn = wire({ root: ROOT })
  const abs = WIN ? 'D:\\proj\\.std\\a.md' : '/proj/.std/a.md'
  const d = await fn({ name: 'write', arguments: { file_path: abs } }, down('allow'))
  assert.equal(d.kind, 'deny')
})

test('适配层：未配 root 时用会话工作目录（exec.agent.session.header.cwd）', async () => {
  const fn = wire({})
  const abs = WIN ? 'D:\\proj\\.std\\a.md' : '/proj/.std/a.md'
  const exec = { name: 'write', arguments: { file_path: abs }, agent: { session: { header: { cwd: ROOT } } } }
  const d = await fn(exec, down('allow'))
  assert.equal(d.kind, 'deny')
})
test('适配层：配置 root 优先于会话工作目录', async () => {
  const fn = wire({ root: ROOT })
  const other = WIN ? 'D:\\elsewhere' : '/elsewhere'
  const abs = WIN ? 'D:\\proj\\.std\\a.md' : '/proj/.std/a.md'
  const exec = { name: 'write', arguments: { file_path: abs }, agent: { session: { header: { cwd: other } } } }
  const d = await fn(exec, down('allow'))
  assert.equal(d.kind, 'deny')
})
test('适配层：没有 agent 与 session 时不崩（回落进程 cwd）', async () => {
  const fn = wire({})
  const d = await fn({ name: 'write', arguments: { file_path: 'docs/a.md' } }, down('allow'))
  assert.equal(d.kind, 'allow')
})

// —— 适配层：下游返回值的规整（第二轮审查：此前会原样透传非法值）——
for (const [title, bad] of [
  ['字符串 "deny"', 'deny'], ['数字 5', 5], ['空对象 {}', {}], ['kind 为 null', { kind: null }],
  ['未知 kind', { kind: 'weird' }], ['数组 []', []], ['原型键 toString', { kind: 'toString' }], ['原型键 constructor', { kind: 'constructor' }],
]) {
  test(`适配层：下游返回非法值（${title}）=> 不原样透传，按 ask 处理`, async () => {
    const fn = wire({ root: ROOT })
    const d = await fn(sh('ls'), async () => bad)
    assert.equal(d.kind, 'ask')
    assert.ok(d.reason)
  })
}
test('适配层：非法下游 + 本插件 deny => deny（更严的赢）', async () => {
  const fn = wire({ root: ROOT })
  const d = await fn({ name: 'write', arguments: { file_path: '.std/a.md' } }, async () => 'garbage')
  assert.equal(d.kind, 'deny')
})
test('适配层：next() 抛异常 => 按 ask 处理，不崩', async () => {
  const fn = wire({ root: ROOT })
  const d = await fn(sh('ls'), async () => { throw new Error('boom') })
  assert.equal(d.kind, 'ask')
})
test('适配层：exec 为 null / undefined 不崩', async () => {
  const fn = wire({ root: ROOT })
  for (const e of [null, undefined]) {
    const d = await fn(e, async () => ({ kind: 'allow' }))
    assert.ok(['allow', 'ask', 'deny'].includes(d.kind))
  }
})

// —— 性能：线性，不回溯（第二轮审查实测：旧实现 2 万字符 13 秒）——
test('性能：长的重复 `git push ` 串在 200ms 内（线性，不回溯）', () => {
  const s = ('git push '.repeat(900)).slice(0, 8000)
  const t0 = Date.now()
  decide(sh(s), { root: ROOT })
  assert.ok(Date.now() - t0 < 200, `耗时 ${Date.now() - t0}ms`)
})
test('性能：超过 MAX_CMD 的命令不分析、直接 ask', () => {
  const t0 = Date.now()
  const d = decide(sh('a'.repeat(1000000)), { root: ROOT })
  assert.equal(d.kind, 'ask')
  assert.ok(Date.now() - t0 < 50)
})
test('性能：长的重复 `git ` 串在 200ms 内', () => {
  const t0 = Date.now()
  decide(sh('git '.repeat(2000)), { root: ROOT })
  assert.ok(Date.now() - t0 < 200)
})

// —— deny 误报：只读 .std、写别处的常见命令必须放行（第二轮审查实测：旧实现一律 deny，人批准不了）——
for (const [title, cmd] of [
  ['cp .std/x 到别处', 'cp .std/templates/notes.md ./notes.md'],
  ['Copy-Item .std 到别处', 'Copy-Item .std\\templates\\* .\\out -Recurse'],
  ['cat .std 重定向到别处', 'cat .std/标准/01.md > notes.txt'],
  ['Get-Content .std | Out-File 别处', 'Get-Content .std\\a.md | Out-File out.md'],
  ['git log -- .std | tee 别处', 'git log -- .std | tee log.txt'],
  ['check_all 的输出重定向', 'python .std/tools/std/check_all.py . > report.txt'],
  ['check_all 的输出管道到 tee', 'python .std/tools/std/check_all.py . 2>&1 | tee r.txt'],
  ['git diff -- .std | Out-File', 'git diff HEAD -- .std | Out-File d.diff'],
  ['rg .std | sed', 'rg "x" .std --glob "*.md" | sed -n 1p'],
  ['echo 含 .std 的字符串 > 别处', 'echo ".std is read-only" > note.txt'],
  ['python -c 里的 > 比较', 'python .std/x.py | python -c "print(1>0)"'],
  ['commit 信息里的 .std', 'git commit -m "chore: bump .std to v1.2"'],
  ['git add .std', 'git add .std'],
  ['git log --grep=reset', 'git log --grep="reset --hard" --oneline'],
  ['git log --grep=tag', 'git log --grep=tag'],
  ['grep -rn "git tag" docs/', 'grep -rn "git tag" docs/'],
  ['git checkout -b fix/clean-up', 'git checkout -b fix/clean-up'],
  ['git push origin feature/release-notes', 'git push origin feature/release-notes'],
  ['git commit -m 含 -n 文字', 'git commit -m "feat(std): add -n option"'],
  ['中文路径', 'Get-Content docs/审计记录/本轮完善记录.md'],
  ['管道里的 Select-String', 'Get-Content AGENTS.md | Select-String "install"'],
]) test(`误报保险：${title} => 不是 deny`, () => assert.notEqual(decide(sh(cmd), { root: ROOT }).kind, 'deny', cmd))

// —— 第二轮审查新列的真绕过 —— 
for (const [title, cmd] of [
  ['Remove-Item .std;', 'Remove-Item .std;'],
  ['rm -rf .std&&echo', 'rm -rf .std&&echo done'],
  ['Remove-Item (Get-Item .std)', 'Remove-Item (Get-Item .std)'],
  ['Remove-Item -Path 逗号列表', 'Remove-Item -Path .std,.x'],
  ['Remove-Item .std)', 'Remove-Item .std)'],
  ['cd .std; sc a x', 'cd .std; sc a x'],
  ['Set-Location .std; Set-Content a x', 'Set-Location .std; Set-Content a x'],
  ['Tee-Object .std/a', 'Get-Content a | Tee-Object .std/a'],
  ['git -C . checkout -- .std', 'git -C . checkout -- .std'],
  ['git -C .std checkout .', 'git -C .std checkout .'],
]) test(`写 .std（审查二）：${title} => 被拦（ask 或 deny，不能放行）`, () => assert.notEqual(decide(sh(cmd), { root: ROOT }).kind, 'allow', cmd))

for (const [title, cmd] of [
  ['git reset --keep', 'git reset --keep HEAD~1'],
  ['git reset --merge', 'git reset --merge'],
  ['git branch -f', 'git branch -f main HEAD~3'],
  ['git filter-branch', 'git filter-branch --tree-filter x'],
  ['git worktree remove --force', 'git worktree remove --force ../w'],
  ['git push 地址写出的远端', 'git push https://example.com/r.git main'],
  ['git push 别名远端 release:main', 'git push public release:main'],
  ['git push 别名远端 HEAD:release', 'git push public HEAD:release'],
  ['git commit --no-ver 缩写', 'git commit --no-ver -m x'],
  ['Set-Content PROJECT_STATUS.md 清空', 'Set-Content PROJECT_STATUS.md $null'],
  ['重定向清空 PROJECT_STATUS.md', 'echo x > PROJECT_STATUS.md'],
  ['git 全局选项后的 tag', 'git -c core.pager=cat tag x'],
  ['git -C 目录后的 push -f', 'git -C ../r push -f origin main'],
]) test(`受控 git（审查二）：${title} => ask`, () => assert.equal(decide(sh(cmd), { root: ROOT }).kind, 'ask', cmd))

winOnly('NTFS 备用数据流 write AGENTS.md::$DATA => ask', () => assert.equal(decide(w('AGENTS.md::$DATA'), { root: ROOT }).kind, 'ask'))
winOnly('NTFS 备用数据流 write .std/a.md:evil => deny', () => assert.equal(decide(w('.std/a.md:evil'), { root: ROOT }).kind, 'deny'))

// ===========================================================================
// 第三轮审查（判定核心重写后）列出的缺口，逐条固化。
// 设计：deny 只给 ①写工具的 .std 路径 ②命令里**重定向的目标词**是 .std；其余带 .std 的写类命令 ask。
// ===========================================================================

// —— 重定向 deny（含紧贴词的形态）——
for (const [title, cmd] of [
  ['word>file 无空格', 'echo x>.std/a'],
  ['word>>file', 'echo x>>.std/a'],
  ['python x.py>.std/r.txt', 'python x.py>.std/r.txt'],
  ['分号后的紧贴重定向', 'echo a;echo x>.std/a'],
  ['>| 强制覆盖', 'echo x >| .std/a'],
  ['>&file', 'echo x >&.std/a'],
  ['2> 错误流重定向到 .std', 'echo x 2>.std/e'],
  ['多重重定向其一是 .std', 'cp a b 2>&1 > .std/b'],
]) test(`重定向 deny：${title}`, () => assert.equal(decide(sh(cmd), { root: ROOT }).kind, 'deny', cmd))

// —— 重定向不是写 .std 的情形 ——
for (const [title, cmd] of [
  ['引号里的 > 不是重定向', 'grep ">" .std/a.md'],
  ['echo 字符串里的重定向样子', 'echo "a > .std/x"'],
  ['2>&1 是复制描述符', 'python .std/tools/std/check_all.py . 2>&1'],
  ['2>$null 丢弃', 'Get-Content .std/a.md 2>$null'],
  ['>/dev/null 丢弃', 'cat .std/a.md >/dev/null'],
]) test(`重定向放行：${title}`, () => assert.notEqual(decide(sh(cmd), { root: ROOT }).kind, 'deny', cmd))

// —— 只读 .std 的命令不应 ask 也不应 deny（审查三实测它们此前被 deny 或误问）——
for (const [title, cmd] of [
  ['sed 无 -i', 'sed -n 1,20p .std/标准/01.md'],
  ['tar -t 只列', 'tar -tf .std/x.tar'],
  ['unzip -l 只列', 'unzip -l .std/a.zip'],
  ['git log -- .std', 'git log --grep merge -- .std'],
  ['git log -S', 'git log -S "rm" -- .std'],
  ['git apply --check', 'git apply --check .std/x.patch'],
  ['git reset HEAD 默认 mixed', 'git reset HEAD .std'],
  ['git restore --staged', 'git restore --staged .std'],
  ['cd .std 后只读并 2>&1', 'cd .std; python x.py 2>&1'],
  ['cd .std 后 2>$null', 'cd .std; ls 2>$null'],
  ['cd .std 再 cd .. 后写别处（复位）', 'cd .std; cd ..; ls > out.txt'],
]) test(`只读 .std：${title} => allow`, () => assert.equal(decide(sh(cmd), { root: ROOT }).kind, 'allow', cmd))

// —— 带 .std 的写类命令 => ask 或 deny（不能 allow）——
for (const [title, cmd] of [
  ['-Path/-Destination 写 .std', 'Copy-Item a -Destination .std'],
  ['mv 源是 .std（会从 .std 里移走）', 'mv .std/a b'],
  ['ren .std 里的文件', 'ren .std/a b'],
  ['cp 目标 .std 加 2>&1', 'cp a .std/a 2>&1'],
  ['cp 目标 .std 加 2>nul', 'Copy-Item x .std/ 2>nul'],
  ['mv 目标 .std 加 2>/dev/null', 'mv a .std 2>/dev/null'],
  ['cp 目标 .std 加 >/dev/null', 'cp a .std/ >/dev/null'],
  ['Copy-Item 加 -ErrorAction', 'Copy-Item a .std -ErrorAction SilentlyContinue'],
  ['Copy-Item 加 -Exclude', 'Copy-Item a .std -Exclude *.md'],
  ['robocopy /MIR', 'robocopy a .std /MIR'],
  ['xcopy /EXCLUDE', 'xcopy a .std /EXCLUDE:x'],
  ['-Destination: 冒号写法', 'Move-Item a -Destination:.std'],
  ['-Path: 冒号写法', 'Set-Content -Path:.std/a x'],
  ['cp -rt', 'cp -rt .std a'],
  ['cp --target-directory 不带 =', 'cp --target-directory .std a'],
  ['curl -o 紧贴', 'curl -o.std/a http://x'],
  ['git rm 带 .std', 'git rm .std/x'],
  ['git mv 到 .std', 'git mv a .std/a'],
]) test(`写 .std（审查三）：${title} => 被拦`, () => assert.notEqual(decide(sh(cmd), { root: ROOT }).kind, 'allow', cmd))

// —— 词法：反斜杠转义引号、注释里的撇号不应吞掉后面的命令 ——
for (const [title, cmd] of [
  ['注释里的撇号后接 git reset --hard', "# don't\ngit reset --hard"],
  ['注释里的撇号后接写 .std', "# don't\necho x > .std/a"],
  ['行尾注释撇号后接 git push -f', "git status # it's\ngit push -f"],
]) test(`词法（审查三）：${title} => 被拦`, () => assert.notEqual(decide(sh(cmd), { root: ROOT }).kind, 'allow', cmd))

// —— git 形态 ——
for (const [title, cmd] of [
  ['括号包住', '(git reset --hard)'],
  ['$( ) 包住', '$(git reset --hard)'],
  ['@( ) 包住', '@(git tag x)'],
  ['--config-env 带值', 'git --config-env foo=bar tag x'],
  ['--super-prefix 带值', 'git --super-prefix x tag x'],
  ['按版本号推单个 tag', 'git push origin v1.0'],
  ['按日期 tag 推送', 'git push origin 2026-10-05'],
  ['refs/heads 全名的 release', 'git push origin refs/heads/main:refs/heads/release'],
  ['git branch -M', 'git branch -M main'],
]) test(`受控 git（审查三）：${title} => ask`, () => assert.notEqual(decide(sh(cmd), { root: ROOT }).kind, 'allow', cmd))
for (const [title, cmd] of [
  ['普通分支名 v 开头不是版本号', 'git push origin vendor-update'],
  ['feature 分支', 'git push origin feature/x'],
]) test(`受控 git 反向保险：${title} => allow`, () => assert.equal(decide(sh(cmd), { root: ROOT }).kind, 'allow', cmd))

// —— 前缀包装与内嵌命令 ——
for (const [title, cmd] of [
  ['env 前缀 + git push -f', 'env X=1 git push -f'],
  ['env 前缀 + rm -rf .std', 'env X=1 rm -rf .std'],
  ['sudo rm -rf .std', 'sudo rm -rf .std'],
  ['command rm -rf .std', 'command rm -rf .std'],
  ['timeout 5 git push -f', 'timeout 5 git push -f'],
  ['bash -c', 'bash -c "git push -f"'],
  ['sh -c', "sh -c 'git push -f'"],
  ['cmd /c', 'cmd /c "git push -f"'],
  ['powershell -c', 'powershell -c "git push -f"'],
  ['pwsh -Command', 'pwsh -Command "git push -f"'],
  ['iex', 'iex "git push -f"'],
  ['Invoke-Expression', 'Invoke-Expression "git push -f"'],
  ['bash -c 里写 .std 的重定向', 'bash -c "echo x > .std/a"'],
  ['两层嵌套', 'bash -c "sh -c \'git push -f\'"'],
  ['xargs cp 到 .std', 'xargs -I{} cp {} .std/'],
]) test(`包装（审查三）：${title} => 被拦`, () => assert.notEqual(decide(sh(cmd), { root: ROOT }).kind, 'allow', cmd))
test('内嵌命令：bash -c 里的重定向 .std 是 deny（取更严）', () => assert.equal(decide(sh('bash -c "echo x > .std/a"'), { root: ROOT }).kind, 'deny'))
test('嵌套超过 MAX_DEPTH 层一律 ask', () => {
  let c = 'git status'
  for (let i = 0; i < 5; i++) c = `bash -c "${c.replace(/"/g, '\\"')}"`
  assert.notEqual(decide(sh(c), { root: ROOT }).kind, 'allow')
})
test('包装里的无害命令不误报：bash -c "ls -la"', () => assert.equal(decide(sh('bash -c "ls -la"'), { root: ROOT }).kind, 'allow'))
test('包装里的无害命令不误报：env X=1 python x.py', () => assert.equal(decide(sh('env X=1 python x.py'), { root: ROOT }).kind, 'allow'))

// —— MAX_CMD 边界与性能 ——
test('MAX_CMD 恰好等于上限的命令照常分析', () => {
  const base = 'git status '
  const cmd = (base.repeat(Math.ceil(8192 / base.length))).slice(0, 8192)
  assert.equal(cmd.length, 8192)
  assert.equal(decide(sh(cmd), { root: ROOT }).kind, 'allow')
})
test('MAX_CMD+1 直接 ask', () => assert.equal(decide(sh('a'.repeat(8193)), { root: ROOT }).kind, 'ask'))
for (const [title, mk] of [
  ['引号重复', () => '"'.repeat(8000)],
  ['括号重复', () => '('.repeat(8000)],
  ['反引号重复', () => '`'.repeat(8000)],
  ['分号重复', () => ';'.repeat(8000)],
  ['重定向符重复', () => '>'.repeat(8000)],
  ['注释符重复', () => '#'.repeat(8000)],
  ['cp .std 重复', () => 'cp .std '.repeat(1000)],
  ['bash -c 重复', () => 'bash -c "x" '.repeat(600)],
]) test(`性能：${title} 在 200ms 内`, () => {
  const t0 = Date.now(); decide(sh(mk()), { root: ROOT }); assert.ok(Date.now() - t0 < 200, `耗时 ${Date.now() - t0}ms`)
})
test('性能：写工具的超长路径参数在 200ms 内（此前 normalizeForCompare 对段尾点空格是二次方）', () => {
  const t0 = Date.now()
  decide({ name: 'write', arguments: { file_path: '. '.repeat(20000) + 'x' } }, { root: ROOT })
  assert.ok(Date.now() - t0 < 200, `耗时 ${Date.now() - t0}ms`)
})

// —— 适配层：异常不逃出监听器（第三轮审查 F-10）——
test('适配层：下游 kind 的 getter 抛错 => 按 ask 处理，不崩', async () => {
  const fn = wire({ root: ROOT })
  const evil = { get kind() { throw new Error('boom') } }
  const d = await fn(sh('ls'), async () => evil)
  assert.equal(d.kind, 'ask')
})
test('适配层：Proxy 抛错的下游 => 按 ask 处理', async () => {
  const fn = wire({ root: ROOT })
  const p = new Proxy({}, { get() { throw new Error('proxy boom') }, has() { throw new Error('proxy boom') } })
  const d = await fn(sh('ls'), async () => p)
  assert.equal(d.kind, 'ask')
})
test('适配层：exec.agent 的 getter 抛错 => 不崩，回落进程 cwd', async () => {
  const fn = wire({})
  const exec = { name: 'write', arguments: { file_path: 'docs/a.md' }, get agent() { throw new Error('agent boom') } }
  const d = await fn(exec, async () => ({ kind: 'allow' }))
  assert.equal(d.kind, 'allow')
})
test('适配层：apply(ctx, null) 不崩，且仍注册监听', () => {
  const hs = []
  apply({ on: (e, f) => hs.push([e, f]), logger: () => ({ info() {}, warn() {} }) }, null)
  assert.equal(hs.length, 1)
})
test('适配层：Symbol kind / 冻结对象 / 数字 kind 都按 ask 处理', async () => {
  const fn = wire({ root: ROOT })
  for (const bad of [{ kind: Symbol('x') }, Object.freeze({ kind: 'weird' }), { kind: 5 }, { kind: {} }]) {
    const d = await fn(sh('ls'), async () => bad)
    assert.equal(d.kind, 'ask')
  }
})

// —— 审查三点名的单测盲区 ——
test('工具名 bash 同样判定（不只 pwsh）', () => {
  assert.equal(decide(bashSh('git push -f'), { root: ROOT }).kind, 'ask')
  assert.equal(decide(bashSh('echo x > .std/a'), { root: ROOT }).kind, 'deny')
  assert.equal(decide(bashSh('git status'), { root: ROOT }).kind, 'allow')
})
for (const [title, cmd] of [
  ['--git-dir 带值后的 push -f', 'git --git-dir /x/.git push -f'],
  ['--work-tree 带值后的 tag', 'git --work-tree /x tag v1'],
  ['--namespace 带值后的 tag', 'git --namespace n tag x'],
  ['--exec-path 带值后的 tag', 'git --exec-path /x tag x'],
  ['-C 带值后的 reset --hard', 'git -C ../r reset --hard'],
  ['-c 带值后的 branch -D', 'git -c a=b branch -D x'],
]) test(`git 全局选项带值：${title} => ask`, () => assert.equal(decide(sh(cmd), { root: ROOT }).kind, 'ask', cmd))
test('git branch -m 改名 => ask', () => assert.equal(decide(sh('git branch -m old new'), { root: ROOT }).kind, 'ask'))
test('git -c core.hooksPath=… commit => ask（hookspath 在任何词里）', () => assert.equal(decide(sh('git -c core.hooksPath=/x commit -m "feat: x"'), { root: ROOT }).kind, 'ask'))
test('git config core.hooksPath => ask', () => assert.equal(decide(sh('git config core.hooksPath /x'), { root: ROOT }).kind, 'ask'))
test('2> 与 &> 重定向到 .std => deny', () => {
  assert.equal(decide(sh('python x.py 2> .std/err'), { root: ROOT }).kind, 'deny')
  assert.equal(decide(sh('python x.py &> .std/all'), { root: ROOT }).kind, 'deny')
})
test('touch 写 .std => 被拦', () => assert.notEqual(decide(sh('touch .std/a'), { root: ROOT }).kind, 'allow'))
test('touch 写别处 => allow', () => assert.equal(decide(sh('touch docs/a.md'), { root: ROOT }).kind, 'allow'))

// ===========================================================================
// 第四轮审查（词法重写后）列出的缺口与单测逃逸，逐条固化。
// 本轮设计：解析不了的形状整条 ask（引号不配对、here 文档无终止符、块注释不闭合、here 文档正文含命令替换、嵌套过深）；
// 命令替换/反引号/进程替换抽出来递归判；here 文档与 here-string 正文当数据；cd 维护虚拟 cwd；glob 与受保护路径按词判。
// ===========================================================================
const bashAskOrDeny = (cmd) => assert.notEqual(decide(bashSh(cmd), { root: ROOT }).kind, 'allow', cmd)
const bashIsDeny = (cmd) => assert.equal(decide(bashSh(cmd), { root: ROOT }).kind, 'deny', cmd)
const askOrDeny = (cmd) => assert.notEqual(decide(sh(cmd), { root: ROOT }).kind, 'allow', cmd)
const isAllow = (cmd) => assert.equal(decide(sh(cmd), { root: ROOT }).kind, 'allow', cmd)
const isDeny = (cmd) => assert.equal(decide(sh(cmd), { root: ROOT }).kind, 'deny', cmd)

for (const [t1, c] of [
  ['bash 转义引号后的 git push -f', 'echo "a\\"b"; git push -f'],
  ['commit -m 里转义引号后的 git push -f', 'git commit -m "fix \\"x\\" y\\""; git push -f'],
  ['PowerShell 反引号转义引号后的 git push -f', 'echo "a`"b"; git push -f'],
]) test(`转义引号（审查四）：${t1}`, () => askOrDeny(c))
test('转义引号后的重定向 .std 仍是 deny（bash 方言）', () => bashIsDeny('echo "a\\"b" > .std/x'))

for (const [t1, c] of [
  ['双引号内 $()', 'echo "$(git tag x)"'],
  ['进程替换 <()', 'diff <(git tag x) b'],
  ['词中的 $()', 'echo $(git push -f)'],
]) test(`命令替换（审查四）：${t1}`, () => askOrDeny(c))

for (const [t1, c] of [
  ['括号包住的 rm .std', '(rm -rf .std)'],
  ['$( ) 包住 rm .std', '$(rm .std/a)'],
  ['花括号块', '{ rm .std/a }'],
  ['if then', 'if true; then rm .std/a; fi'],
  ['for do（静态路径）', 'for f in a; do rm .std/a; done'],
  ['for do（含变量，取静态前缀）', 'for f in a; do rm .std/$f; done'],
  ['! 取反', '! rm .std/a'],
  ['& { } 脚本块', '& { rm .std/a }'],
  ['括号里的 cp', '(cp a .std/b)'],
  ['括号里改入口指令', '(rm AGENTS.md)'],
  ['管道到 % { }', 'Get-ChildItem | % { Set-Content .std/a $_ }'],
  ['foreach(){}', 'foreach($f in 1){ Set-Content .std/$f x }'],
]) test(`括号与控制流（审查四）：${t1}`, () => askOrDeny(c))

test('heredoc 里的撇号不吞掉 heredoc 之后的命令', () => askOrDeny("cat <<EOF\ndon't\nEOF\ngit push -f"))
test('cmd /c 里的撇号不开引号', () => askOrDeny('cmd /c "echo don\'t & git push -f"'))
test('heredoc 正文含「> .std」是数据，不是重定向 => 不 deny', () => assert.notEqual(decide(sh('cat > out.md <<EOF\nuse x > .std/y\nEOF'), { root: ROOT }).kind, 'deny'))
test('PowerShell here-string 正文含「> .std」是数据 => 不 deny', () => assert.notEqual(decide(sh("Set-Content out.md @'\nit's here\nRedirect > .std/a\n'@"), { root: ROOT }).kind, 'deny'))
test('heredoc 正文是普通文字 => allow', () => isAllow('cat > notes.md <<EOF\nhello\nworld\nEOF'))
test('python - <<PY 正文 => allow', () => isAllow('python - <<PY\nprint("x")\nPY'))
test('heredoc 没有终止符 => ask（解析不了不放行）', () => assert.equal(decide(sh('cat <<EOF\nhello'), { root: ROOT }).kind, 'ask'))
test('heredoc 正文含命令替换（未加引号的终止符）=> ask', () => assert.equal(decide(sh('cat <<EOF\n$(git push -f)\nEOF'), { root: ROOT }).kind, 'ask'))
test('引号不配对 => ask（不静默放行）', () => assert.equal(decide(sh('echo "abc'), { root: ROOT }).kind, 'ask'))
test('块注释不闭合 => ask', () => assert.equal(decide(sh('<# oops git status'), { root: ROOT }).kind, 'ask'))
test('块注释里的命令不当命令：<# git push -f #> ls => allow', () => isAllow('<# git push -f #> ls'))
test('块注释后接真命令仍被判：<# it\'s #> git push -f => ask', () => askOrDeny("<# it's #> git push -f"))

for (const [t1, c] of [
  ['pwsh 参数缩写 -com', 'pwsh -com "git tag x"'],
  ['bash -cx 选项簇', 'bash -cx "git tag x"'],
  ['bash -lc', 'bash -lc "git tag x"'],
  ['bash --login -c', 'bash --login -c "git tag x"'],
  ['cmd /k', 'cmd /k "git tag x"'],
  ['powershell -NoProfile -Command', 'powershell -NoProfile -Command "git tag x"'],
  ['eval', "eval 'git tag x'"],
  ['管道喂给 bash', 'echo "git tag x" | bash'],
  ['-EncodedCommand（看不见内容）', 'powershell -EncodedCommand AAAA'],
  ['裸 bash', 'bash'],
  ['裸 pwsh', 'pwsh'],
]) test(`内嵌与解释器（审查四）：${t1} => 被拦`, () => askOrDeny(c))
for (const [t1, c] of [['bash 跑脚本文件', 'bash build.sh'], ['pwsh -File', 'pwsh -File x.ps1'], ['bash --version', 'bash --version'], ['bash -c 无害内嵌', 'bash -c "ls -la"'], ['cmd /c dir', 'cmd /c dir']]) {
  test(`内嵌与解释器放行：${t1} => allow`, () => isAllow(c))
}

for (const [t1, c] of [
  ['sudo -u 带值', 'sudo -u x rm .std/a'],
  ['env -u 带值', 'env -u X rm .std/a'],
  ['timeout -s 带值', 'timeout -s KILL 5 rm .std/a'],
  ['xargs -I {} 带值', 'xargs -I {} rm .std/{}'],
  ['busybox 前缀', 'busybox rm .std/a'],
  ['sudo -- 分隔', 'sudo -- rm .std/a'],
  ['sudo -u 删状态文件', 'sudo -u user rm PROJECT_STATUS.md'],
]) test(`前缀包装（审查四）：${t1} => 被拦`, () => askOrDeny(c))
test('command -v git 只是查询：allow', () => isAllow('command -v git'))
test('time ./build.sh：allow', () => isAllow('time ./build.sh'))
test('timeout 5 ping x：allow', () => isAllow('timeout 5 ping x'))

for (const [t1, c] of [
  ['find .std -delete', 'find .std -delete'],
  ['find .std -exec rm', 'find .std -exec rm {} ;'],
]) test(`find（审查四）：${t1} => 被拦`, () => askOrDeny(c))
test('find 只读 => allow', () => isAllow('find . -name "*.py"'))

for (const [t1, c] of [
  ['cd .std; cd sub; rm a', 'cd .std; cd sub; rm a'],
  ['cd tools 后写守卫自身', 'cd tools; rm dsh-std/lib/policy.js'],
  ['cd .githooks 后写钩子', 'cd .githooks; rm pre-commit'],
  ['cd .githooks && echo > pre-commit', 'cd .githooks && echo x > pre-commit'],
  ['cd tools/dsh-std 后写', 'cd tools/dsh-std; rm lib/policy.js'],
]) test(`cd 追踪（审查四）：${t1} => 被拦`, () => askOrDeny(c))
test('cd .std 后重定向到相对路径 => deny（虚拟 cwd 解析）', () => isDeny('cd .std; echo x > a.txt'))
test('cd other 后重定向到 .std 目录名 => 不 deny（目标是 other/.std，只可能 ask）', () => assert.notEqual(decide(sh('cd other; echo x > .std/a'), { root: ROOT }).kind, 'deny'))
test('cd .. 复位后写别处 => allow', () => isAllow('cd .std; cd ..; ls > out.txt'))
test('cd 变量目标复位到项目根而不是沿用旧 cwd', () => isAllow('cd .std; cd $HOME; echo x > a.txt'))

for (const [t1, c] of [
  ['tools/./dsh-std', 'rm tools/./dsh-std/lib/policy.js'],
  ['tools//dsh-std', 'cp x tools//dsh-std/a'],
  ['tools/sub/../dsh-std', 'echo x > tools/sub/../dsh-std/a'],
  ['AGENTS.md. 段尾点', 'rm AGENTS.md.'],
  ['tools/dsh-std. 段尾点', 'rm tools/dsh-std.'],
]) winOnly(`路径规整（审查四）：${t1} => ask`, () => askOrDeny(c))

for (const [t1, c] of [
  ['rm .st*', 'rm .st*'],
  ['rm AGENTS*', 'rm AGENTS*'],
  ['rm -r .*', 'rm -r .*'],
  ['Remove-Item PROJECT_STATUS.*', 'Remove-Item PROJECT_STATUS.*'],
]) test(`通配（审查四）：${t1} => ask`, () => askOrDeny(c))
test('通配不误报：rm *.log => allow', () => isAllow('rm *.log'))
test('通配不误报：rm build/* => allow', () => isAllow('rm -rf build/*'))

for (const [t1, c] of [
  ['dd of=AGENTS.md', 'dd of=AGENTS.md'],
  ['-Path: 冒号紧贴', 'Set-Content -Path:AGENTS.md x'],
  ['括号路径', 'cp x (AGENTS.md)'],
  ['unlink 状态入口', 'unlink PROJECT_STATUS.md'],
  ['cp 覆盖状态入口', 'cp x PROJECT_STATUS.md'],
  ['find -delete 状态入口', 'find . -name PROJECT_STATUS.md -delete'],
  ['curl --output=', 'curl --output=AGENTS.md x'],
  ['tar --file=', 'tar --file=AGENTS.md -c x'],
  ['逗号前缀', 'cp x ,AGENTS.md'],
]) test(`受保护文件（审查四）：${t1} => ask`, () => askOrDeny(c))

for (const [t1, c] of [
  ['-c alias 注入', 'git -c alias.x="push -f" x'],
  ['--follow-tags', 'git push --follow-tags'],
  ['按版本 tag', 'git push origin v2'],
  ['update-ref --delete', 'git update-ref --delete refs/heads/x'],
  ['Start-Process -ArgumentList', 'Start-Process git -ArgumentList "push","-f"'],
  ['git.cmd', 'git.cmd tag x'],
]) test(`git（审查四）：${t1} => ask`, () => askOrDeny(c))

for (const [t1, c] of [
  ['1> 重定向', 'echo x 1> .std/a'], ['3> 重定向', 'echo x 3> .std/a'], ['命令前的重定向', '>.std/a echo x'],
  ['双引号目标', 'echo x > ".std/a"'], ['单引号目标', "echo x > '.std/a'"], ['多重重定向最后落在 .std', 'a>b>.std/c'],
]) test(`重定向形态（审查四）：${t1} => deny`, () => isDeny(c))

// —— 逃逸变异对应的用例（审查四点名）——
test('cmd /k 内嵌被剥：cmd /k "git tag x" => ask', () => askOrDeny('cmd /k "git tag x"'))
test('行注释只在词首：a#b 与 url#frag 不吞后续', () => { isAllow('echo a#b'); isAllow('curl https://e.com/x#frag') })
test('行注释吞到行尾：# 后的命令不判（注释就是注释）', () => isAllow('ls # git push -f'))
test('注释换行后的下一行仍判：# c\ngit push -f => ask', () => askOrDeny('# c\ngit push -f'))
test('sed -i 视为写：sed -i s/a/b/ AGENTS.md => ask', () => askOrDeny('sed -i s/a/b/ AGENTS.md'))
test('sed 无 -i 不写：sed -n 1p AGENTS.md => allow', () => isAllow('sed -n 1p AGENTS.md'))
test('stricter 排序：deny 与 ask 同命令 => deny', () => isDeny('git tag x; echo y > .std/a'))
test('stricter 排序：内嵌 deny 与外层 ask => deny', () => isDeny('git tag x; bash -c "echo y > .std/a"'))
test('删除状态入口失败清单：rm 失败Case清单.md => ask', () => askOrDeny('rm 失败Case清单.md'))
test('--force-with-lease => ask', () => askOrDeny('git push --force-with-lease origin main'))
test('--force-with-lease=ref => ask', () => askOrDeny('git push --force-with-lease=main origin main'))
test('time 作前缀被剥：time git push -f => ask', () => askOrDeny('time git push -f'))
test('CRLF 续行：git reset \\\r\n --hard => ask（bash 方言）', () => bashAskOrDeny('git reset \\\r\n --hard'))
test('重定向目标词在 < 处终止：echo x > .std/a < in.txt => deny', () => isDeny('echo x > .std/a < in.txt'))

// —— 不抛异常：任意形态的输入 ——
test('decide 对奇怪入参不抛：opts 为 null / root 非字符串', () => {
  for (const o of [null, undefined, { root: 5 }, { root: {} }, { root: '' }, 'x', 7]) {
    const d = decide(sh('ls'), o)
    assert.ok(['allow', 'ask', 'deny'].includes(d.kind))
  }
})
test('decide 对奇怪命令不抛：NUL、孤立代理项、超长', () => {
  for (const c of ['a\u0000b', 'x\ud800y', 'é'.repeat(5000), '\u00a0\u3000 ls', 'ls\u200b; git tag x']) {
    const d = decide(sh(c), { root: ROOT })
    assert.ok(['allow', 'ask', 'deny'].includes(d.kind))
  }
})

// —— 第二批：对新词法做变异验证时逃逸的盲区（X04 X07 X09 X14 X28 X29 X30）——
test('进程替换 >( )：把内容喂给 git push -f 的子命令 => ask', () => askOrDeny('echo x | tee >(git push -f)'))
test('进程替换 <( ) 里写 .std 的重定向也被抽出判：cat <(echo x > .std/a) => deny', () => isDeny('cat <(echo x > .std/a)'))
test('here-string 正文是数据：里面写 git push -f 不算命令 => allow', () => isAllow("Set-Content notes.md @'\ngit push -f\n'@"))
test('here-string 正文是数据：里面写重定向 .std 不算 => 不 deny', () => assert.notEqual(decide(sh("Set-Content notes.md @'\necho x > .std/a\n'@"), { root: ROOT }).kind, 'deny'))
test('双引号 here-string 正文含 $( => ask（不解析）', () => assert.equal(decide(sh('Set-Content n.md @"\n$(git push -f)\n"@'), { root: ROOT }).kind, 'ask'))
test('here-string 没有终止符 => ask', () => assert.equal(decide(sh("Set-Content n.md @'\nabc"), { root: ROOT }).kind, 'ask'))
test('词首 } 分隔：`{ ls }; git push -f` => ask（} 之后的命令被看见）', () => askOrDeny('{ ls }; git push -f'))
test('词首 } 分隔：`if true; then ls; fi` 的 fi 前后不吞', () => askOrDeny('if true; then ls; fi; git tag x'))
test('花括号不在词首时是普通字符：echo ${x} 与 .std/{a,b} 的 { 不当分隔', () => { isAllow('echo ${HOME}'); isAllow('echo {a,b}') })
test('前缀 -- 分隔符：sudo -- git push -f => ask（-- 之后才是命令）', () => askOrDeny('sudo -- git push -f'))
test('前缀 -- 分隔符：env -- rm .std/a => 被拦', () => askOrDeny('env -- rm .std/a'))
test('timeout 的时长只在 timeout 后第一个位置词：timeout 5 git push -f => ask', () => askOrDeny('timeout 5 git push -f'))
test('重定向目标 cd 之后「按项目根才落在 .std」是 ask：cd other; echo x > .std/a => ask 而不是 allow', () => assert.equal(decide(sh('cd other; echo x > .std/a'), { root: ROOT }).kind, 'ask'))
test('重定向目标 cd 之后「按项目根才落在 .std」：cd sub; echo x > .std/a => ask', () => assert.equal(decide(sh('cd sub; echo x > .std/a'), { root: ROOT }).kind, 'ask'))
test('嵌套深度边界：恰好 2 层的内嵌命令照常分析（git status 放行）', () => isAllow('bash -c "bash -c \'git status\'"'))
test('嵌套深度边界：3 层一律 ask（哪怕里面只是 ls）', () => assert.equal(decide(sh('bash -c "bash -c \'bash -c \\"ls\\"\'"'), { root: ROOT }).kind, 'ask'))
test('嵌套深度边界：命令替换也受深度限制，$( $( $( ls ) ) ) 一律 ask', () => assert.equal(decide(sh('echo $(echo $(echo $(ls)))'), { root: ROOT }).kind, 'ask'))
test('命令替换里的 cd 继承外层虚拟 cwd：cd .std; echo $(echo x > a) => 被拦', () => askOrDeny('cd .std; echo $(echo x > a)'))
test('命令替换内的路径按外层 cwd 解析而不是项目根：cd tools; echo $(rm dsh-std/lib/policy.js) => 被拦', () => askOrDeny('cd tools; echo $(rm dsh-std/lib/policy.js)'))

// X07 在专门构造的输入下才有区分力：here-string 正文里有未配对的撇号。不识别 here-string 时会误开引号 => 误 ask。
test('here-string 正文含未配对撇号是数据 => allow（不能因引号错位误问）', () => isAllow("Set-Content n.md @'\nit's fine\n'@"))
test('here-string 正文含未配对双引号是数据 => allow', () => isAllow('Set-Content n.md @\'\nsay "hi\n\'@'))

// ===========================================================================
// 方言（本机 pwsh 的真实问题）：PowerShell 里反斜杠不是转义字符，`"C:\x\"` 是引号已闭合的合法写法；
// 反引号才是转义字符。此前按 bash 规则处理 pwsh 命令，把以 \ 结尾的 Windows 路径误判成「引号没有配对」而整条 ask，
// 守卫因此频繁拦住我自己的无害命令。按工具名选方言（bash → 反斜杠转义，pwsh → 反引号转义），内嵌命令按解释器切换。
// ===========================================================================
const psSh = (command) => ({ name: 'pwsh', arguments: { command } })
const psAllow = (cmd) => assert.equal(decide(psSh(cmd), { root: ROOT }).kind, 'allow', cmd)
const psAsk = (cmd) => assert.notEqual(decide(psSh(cmd), { root: ROOT }).kind, 'allow', cmd)
const psDeny = (cmd) => assert.equal(decide(psSh(cmd), { root: ROOT }).kind, 'deny', cmd)

for (const [t1, c] of [
  ['变量加反斜杠结尾', '$x = "$d\\"; Write-Output $x'],
  ['路径以反斜杠结尾', 'Get-ChildItem "C:\\Users\\x\\" | Select Name'],
  ['Replace 里的 "$d\\"', '$_.FullName.Replace("$d\\",\'\')'],
  ['字符串以反斜杠结尾后接命令', 'Write-Output "a\\"; Get-Date'],
  ['多个以反斜杠结尾的路径', 'Copy-Item "D:\\a\\" "D:\\b\\" -Recurse'],
  ['单引号路径', "Set-Location 'D:\\work\\'"],
]) test(`PowerShell 方言：${t1} => 不因「引号不配对」误问`, () => psAllow(c))

test('PowerShell 方言：以反斜杠结尾的字符串之后的 git push -f 仍被看见', () => psAsk('Write-Output "a\\"; git push -f'))
test('PowerShell 方言：反引号转义引号 "a`"b" 引号内的分号不切', () => psAllow('Write-Output "a`"; b"'))
test('PowerShell 方言：反引号转义引号后的 git push -f 被看见', () => psAsk('echo "a`"b"; git push -f'))
test('PowerShell 方言：反引号转义引号后的重定向 .std 仍 deny', () => psDeny('echo "a`"b" > .std/x'))
test('PowerShell 方言：`n 等反引号转义不影响判定', () => psAllow('Write-Output "line1`nline2"'))
test('PowerShell 方言：未引号的反引号转义下一个字符，不当命令替换', () => psAllow('Write-Output a`;b'))
test('PowerShell 方言：反引号续行 git reset `\n --hard => ask', () => psAsk('git reset `\n --hard'))
test('PowerShell 方言：$() 命令替换仍抽出', () => psAsk('Write-Output "$(git tag x)"'))
test('PowerShell 方言：子表达式 $( ) 里的 git push -f 被看见', () => psAsk('$x = $(git push -f)'))

// —— bash 方言（用 bash 工具名，不随平台变）——
for (const [t1, c] of [
  ['转义引号夹住的分号', 'echo \\" ; git push -f ; echo \\"'],
  ['反斜杠续行 git reset', 'git reset \\\n --hard'],
  ['反引号命令替换', 'echo `git push -f`'],
  ['赋值里的反引号', 'x=`git tag x`'],
  ['双引号内转义引号后的 git push -f', 'echo "a\\"b"; git push -f'],
]) test(`bash 方言：${t1} => 被拦`, () => bashAskOrDeny(c))
test('bash 方言：双引号以反斜杠结尾（引号被转义，没闭合）=> ask（解析不了不放行）', () => assert.equal(decide(bashSh('echo "a\\"'), { root: ROOT }).kind, 'ask'))

// —— 内嵌命令的方言切换 ——
test('pwsh 里的 bash -c 内嵌按 bash 方言解析：bash -c "echo \\"a\\"; git push -f"', () => psAsk('bash -c "echo \\"a\\"; git push -f"'))
test('bash 里的 pwsh -Command 内嵌按 PowerShell 方言解析', () => assert.notEqual(decide(bashSh('pwsh -Command "Write-Output \'x\'; git push -f"'), { root: ROOT }).kind, 'allow'))

// —— PowerShell 无空格赋值：`$sh="C:\\x\\sh.exe"` 分词后是一个整词，取 basename 会把赋值的值误认成解释器名（迁移 CMS 时被自己的守卫误拦） ——
for (const [t1, c] of [
  ['赋值的值是 sh.exe 路径', '$sh="C:\\x\\sh.exe"; ls'],
  ['赋值的值是 git.exe 路径', '$g="C:\\Users\\x\\git.exe"; ls'],
  ['赋值的值是 python.exe 路径', '$py="C:\\x\\python.exe"; ls'],
  ['赋值的值是 rm.exe 路径', '$rm="C:\\x\\rm.exe"; ls'],
  ['赋值的值含 git tag 字样', '$tag="git tag"; ls'],
  ['变量名叫 bash', '$bash = 1'],
]) test(`变量赋值不是命令：${t1} => allow`, () => psAllow(c))
test('变量赋值之后的真命令仍被拦：$x = 1; git tag x => ask', () => psAsk('$x = 1; git tag x'))
test('裸 sh 仍 ask（修复没有放松真命令）', () => psAsk('sh'))
test('echo … | bash 仍 ask', () => psAsk('echo hi | bash'))
