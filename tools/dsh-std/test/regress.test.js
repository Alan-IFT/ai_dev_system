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
  ['cmd move a .std\\a', 'move a .std\\a'],
  ['cmd copy a .std\\a', 'copy a .std\\a'],
  ['robocopy 目标 .std', 'robocopy src .std /E'],
  ['xcopy 目标 .std', 'xcopy src .std /E'],
  ['重定向无空格 >.std/a', 'echo x >.std/a'],
  ['Set-Content 大小写 .STD', 'Set-Content .STD/a x'],
  ['iwr -OutFile .std', 'iwr http://x -OutFile .std/a'],
  ['curl -o .std', 'curl -o .std/a http://x'],
  ['dd of=.std', 'dd of=.std/a'],
  ['rsync 目标 .std', 'rsync -a src/ .std/'],
  ['ln -s 到 .std', 'ln -s a .std/a'],
  ['truncate .std', 'truncate -s0 .std/a'],
  ['git stash push -- .std', 'git stash push -- .std'],
  ['git apply 到 .std（命令里提到 .std）', 'git apply --directory=.std p.diff'],
]) test(`写 .std：${title} => 被拦（ask 或 deny，不能放行）`, () => assert.notEqual(decide(sh(cmd), { root: ROOT }).kind, 'allow', cmd))

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
  ['reset --hard 反斜杠续行（POSIX）', 'git reset \\\n --hard'],
  ['reset --hard 反引号续行（PowerShell）', 'git reset `\n --hard'],
  ['--no-veri 缩写', 'git commit --no-veri -m x'],
  ['--force-if-includes', 'git push --force-if-includes origin main'],
  ['ri 删 PROJECT_STATUS（别名）', 'ri PROJECT_STATUS.md'],
]) test(`受控 git：${title} => ask`, () => assert.notEqual(decide(sh(cmd), { root: ROOT }).kind, 'allow', cmd))

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
  ['Tee-Object .std\\a', 'Get-Content a | Tee-Object .std\\a'],
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
  ['ren .std 里的文件', 'ren .std\\a b'],
  ['cp 目标 .std 加 2>&1', 'cp a .std/a 2>&1'],
  ['cp 目标 .std 加 2>nul', 'Copy-Item x .std\\ 2>nul'],
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
  ['转义引号夹住的分号', 'echo \\" ; git push -f ; echo \\"'],
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
const bashSh = (command) => ({ name: 'bash', arguments: { command } })
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
