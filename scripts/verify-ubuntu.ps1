# 在本机 Docker 的 Ubuntu 24.04 容器里验证：当前 main 的提交 + 工作区里指定的文件，构建、全部测试、（可选）变异验证。
# 为什么要它：这个仓里已有两次实测证明「Windows 上过」不等于「Linux 上过」——
#   ① 受限读取的 O_NOFOLLOW、O_NONBLOCK、FIFO 只在 POSIX 上存在，Windows 上这三道防线本来就是空的（设计 §12.6 D8）；
#   ② 同一条变异（S22）在 Windows 上被抓住、在 Linux 上没被抓住——因为两个平台上让测试失败的机制不同（设计 §12.8）。
# 手工在容器里拼命令容易漏、也无法复现，所以脚本化。
#
# 用法（PowerShell，在仓库根）：
#   pwsh scripts/verify-ubuntu.ps1                       # 构建 + 全部测试
#   pwsh scripts/verify-ubuntu.ps1 -Mutations fs         # 另跑 test/mutations/fs.json（Linux 上才有的仅 POSIX 变异在这里被验证）
#   pwsh scripts/verify-ubuntu.ps1 -Node 22.19.0         # 指定 Node 版本（engines 下限）
#   pwsh scripts/verify-ubuntu.ps1 -Overlay "src/core/fs.ts test/fs.test.mjs"   # 把工作区里这些**未提交**的文件覆盖进去再测
#
# 只创建并删除自己的东西：容器名固定 std-verify-ubuntu、临时目录固定 std-verify-ubuntu-*；不碰别的容器。
param(
  [string]$Node = '24.21.0',
  [string]$Mutations = '',
  [string]$Overlay = '',
  [int]$TimeoutMin = 20
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$git = (Get-Command git -ErrorAction SilentlyContinue)?.Source
if (-not $git) { throw '找不到 git' }
$name = 'std-verify-ubuntu'
$work = Join-Path ([IO.Path]::GetTempPath()) ('std-verify-ubuntu-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $work | Out-Null
try {
  # 代码用 git bundle + 容器内真实 git clone 带进去，**不用 git archive**：archive 会按导出端的 autocrlf 转行尾，造出 Linux 上不存在的 CRLF。
  & $git -C $root bundle create (Join-Path $work 'repo.bundle') main 2>&1 | Out-Null
  $overlayList = @($Overlay -split '\s+' | Where-Object { $_ })
  foreach ($f in $overlayList) {
    $dst = Join-Path $work ('overlay/' + $f)
    New-Item -ItemType Directory -Force (Split-Path -Parent $dst) | Out-Null
    Copy-Item (Join-Path $root $f) $dst -Force
  }
  $mutLine = if ($Mutations) { "node scripts/mutate.mjs test/mutations/$Mutations.json > /tmp/m.txt 2>&1; echo `"mutate 退出码 `$?`"; sed -E 's/已知未验证：.*/已知未验证（unobservable）/' /tmp/m.txt | grep -E '^[✗?△✓]|条变异'" } else { '' }
  $script = @"
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 LC_ALL=C.UTF-8
apt-get update -qq >/dev/null; apt-get install -y -qq --no-install-recommends git ca-certificates curl xz-utils python3 >/dev/null 2>&1
git clone -q -b main /in/repo.bundle /work/proj; cd /work/proj
[ -d /in/overlay ] && cp -r /in/overlay/. . && echo "已覆盖未提交文件: `$(cd /in/overlay && find . -type f | tr '\n' ' ')"
mkdir -p /opt/node; curl -fsSL https://nodejs.org/dist/v$Node/node-v$Node-linux-x64.tar.xz | tar -xJ -C /opt/node --strip-components=1
export PATH=/opt/node/bin:`$PATH
echo "Node `$(node --version)  platform=`$(node -p process.platform)  O_NOFOLLOW=`$(node -p 'require("fs").constants.O_NOFOLLOW')"
npm i -g --silent pnpm@11 >/dev/null 2>&1; pnpm install --frozen-lockfile >/dev/null 2>&1
pnpm run build > /tmp/b.txt 2>&1; echo "build rc=`$?"
node scripts/check-lib-sync.mjs > /tmp/s.txt 2>&1; echo "check-lib-sync rc=`$?: `$(head -1 /tmp/s.txt)"
[ -f golden/make_unit_fs.py ] && python3 golden/make_unit_fs.py | tail -1
node --test "test/*.test.mjs" > /tmp/t.txt 2>&1; echo "test rc=`$?  `$(grep -E '^ℹ (tests|pass|fail|skipped)' /tmp/t.txt | tr '\n' ' ')"
grep -E '^✖ ' /tmp/t.txt | sed -E 's/ \([0-9.]+ms\)`$//' | sort -u | head -8
# 有失败时把断言细节也打出来（「failing tests:」之后的前 60 行）——否则只知道哪条红、不知道为什么，还得再手拼命令进容器看
if grep -q '^✖ failing tests:' /tmp/t.txt; then echo "=== 失败详情（node --test 输出里 failing tests 之后）==="; sed -n '/^✖ failing tests:/,`$p' /tmp/t.txt | head -60 | cut -c1-220; fi
$mutLine
"@
  [IO.File]::WriteAllText((Join-Path $work 'run.sh'), ($script -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding $false))
  & docker rm -f $name 2>&1 | Out-Null
  $mounts = @('-v', "${work}:/in:ro", '-v', "$(Join-Path $work 'run.sh'):/run.sh:ro")
  & docker run -d --name $name @mounts ubuntu:24.04 bash /run.sh 2>&1 | Out-Null
  $deadline = (Get-Date).AddMinutes($TimeoutMin)
  while ((Get-Date) -lt $deadline) { if ((& docker inspect -f '{{.State.Status}}' $name 2>&1) -ne 'running') { break }; Start-Sleep -Seconds 8 }
  if ((& docker inspect -f '{{.State.Status}}' $name 2>&1) -eq 'running') { Write-Warning "超时 $TimeoutMin 分钟，强制结束 $name"; & docker rm -f $name 2>&1 | Out-Null; exit 2 }
  & docker logs $name 2>&1
  $code = [int](& docker inspect -f '{{.State.ExitCode}}' $name 2>&1)
  exit $code
} finally {
  & docker rm -f $name 2>&1 | Out-Null
  if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
