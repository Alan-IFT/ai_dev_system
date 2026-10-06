# pick-python.sh —— 提交钩子选 Python 解释器的公共写法（标准仓 tools/std/ 发布物，经 .std/ 到达采用项目）。
#
# 用法（POSIX sh，被钩子 `.` 引入，不是直接执行）。**先判文件在不在再 `.`**：dash 等 POSIX sh 里 `.` 找不到文件会直接终止 shell，
# `|| exit` 根本走不到，消息也只是 "No such file"，说不清是 .std/ 没初始化还是被误删——所以钩子自己判并说清，失败关闭（127）：
#     [ -f .std/tools/std/pick-python.sh ] || { echo "提交闸门：缺 .std/tools/std/pick-python.sh（.std/ 没初始化或被删？按 tools/std/README 的取用步骤取回）；本次提交被拒（失败关闭）。" >&2; exit 127; }
#     . .std/tools/std/pick-python.sh || exit $?
#     exec "$PY" .std/tools/std/check_all.py . --no-scope
# 成功：设置并导出 PY（解释器路径）与 PYTHONUTF8=1，返回 0。
# 失败：向 stderr 说清缺什么，返回 127（失败关闭——不放行、不跳过，01 §2 N1：没跑成的不记通过）。
#
# 为什么要有这个文件：写死 `python3` 的钩子在 Windows 上会拒绝一切提交——Microsoft Store 的占位程序占着
# python3/python 这两个名字，存在于 PATH 但退出 49，只看「命令存在」会选中它们。所以这里按「跑得通」选，不按「找得到」选：
# 依次试 python3、python、DSH 自带的 Python，取**第一个真能执行一条语句并退出 0 且版本 >= 3.8** 的。
# 之前 3 个采用项目各抄了一份同一段逻辑；公共写法只留这一处。
#
# 选解释器必须发生在 Python 之前，所以不能放进 check_all.py。
# 它与 check_all.py 同在 .std/ 内、同一信任域：钩子每次提交都在执行 .std/ 里的 Python，source 同目录的 sh 片段没有引入新的信任边界；
# .std/ 里已跟踪文件被改动，check_adoption 判 FAIL（adoption/embedded-modified），片段不会被悄悄改。
# 它不进 check_all 的工具身份哈希（身份只算 check_all.py、stdlib.py、CONTRACT.md、checks/check_*.py）——它不改任何检查的判定，只选解释器。
#
# 路径含空格（用户名、DSH_HOME 里常见）：解释器路径一律带引号用，不拼进字符串再不加引号展开。
PY=""
for _pp_cand in python3 python \
    "${DSH_HOME:+$DSH_HOME/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe}" \
    "${USERPROFILE:+$USERPROFILE/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe}"; do
  [ -n "$_pp_cand" ] || continue
  if "$_pp_cand" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' >/dev/null 2>&1; then
    PY="$_pp_cand"
    break
  fi
done
unset _pp_cand
if [ -z "$PY" ]; then
  echo "提交闸门：找不到能运行的 Python（试过 python3、python、DSH 自带的 Python）。Windows 上 python3/python 常是 Microsoft Store 占位程序（退出 49）。装一个真 Python 或设置 DSH_HOME 后重试；本次提交被拒（失败关闭）。" >&2
  return 127 2>/dev/null || exit 127
fi
PYTHONUTF8=1
export PY PYTHONUTF8