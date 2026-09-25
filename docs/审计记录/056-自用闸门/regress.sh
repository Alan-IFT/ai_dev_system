#!/bin/sh
# 提交闸门的"应被拦截"回归（31-P9），合同见仓库工作须知 §7。
# 在临时 worktree（带上当前工作区改动）里跑下列各例，读数印到 stdout；跑完删 worktree，notes 引用复原。
# 前提：core.hooksPath 已设为 .githooks。用法：sh docs/审计记录/056-自用闸门/regress.sh
R=$(git rev-parse --show-toplevel); T=$(mktemp -d); W=$T/wt
had=$(git -C "$R" rev-parse -q --verify refs/notes/gate-skip)
git -C "$R" worktree add -q --detach "$W" HEAD
git -C "$R" diff HEAD --binary | git -C "$W" apply --allow-empty
git -C "$R" ls-files -o --exclude-standard -z | (cd "$R" && xargs -0 -r cp --parents -t "$W")
cd "$W" && git add -A
F=docs/附录-载体实例/仓库工作须知.md
note() { git notes --ref=gate-skip show HEAD >/dev/null 2>&1 && echo 有 || echo 无; }
git commit -q -m "test: 带入工作区改动" >/dev/null 2>&1; echo "例0 正常提交：退出 $?（应 0）；note：$(note)（应 无）"
echo '[断](不存在的文件.md)' >> $F; git add $F
git commit -q -m "docs: 注入断链" >/dev/null 2>&1; echo "例1 断链提交：退出 $?（应非 0）"
git checkout -q HEAD -- $F
git commit -q --allow-empty -m "随手写的信息" >/dev/null 2>&1; echo "例2 坏提交信息：退出 $?（应非 0）"
git commit -q --allow-empty --no-verify -m "随手写的信息" >/dev/null 2>&1; echo "例3 --no-verify：退出 $?（应 0）；note：$(note)（应 有）"
echo x > regress-tmp.txt; git add regress-tmp.txt; git commit -q -m "test: 待改写" >/dev/null 2>&1
git commit -q --amend -m "test: 改写后" >/dev/null 2>&1; echo "例4 amend：退出 $?（应 0）；note：$(note)（应 无）"
git revert --no-edit HEAD >/dev/null 2>&1; echo "例5a revert：退出 $?（应 0）；首行 $(git log -1 --format=%s | cut -c1-20)；note：$(note)"
git revert --no-edit HEAD >/dev/null 2>&1; echo "例5b revert-of-revert：退出 $?（应 0）；首行 $(git log -1 --format=%s | cut -c1-20)；note：$(note)"
base=$(git rev-parse HEAD)
git commit -q --allow-empty -m "test: 侧支" >/dev/null 2>&1; side=$(git rev-parse HEAD)
git checkout -q "$base"; git commit -q --allow-empty -m "test: 主支" >/dev/null 2>&1
git merge -q --no-ff -m "Merge 侧支" "$side" >/dev/null 2>&1; echo "例6 正常 merge：退出 $?（应 0）；父提交数 $(git log -1 --format=%p | wc -w)（应 2）"
git commit -q --allow-empty --no-verify -m "随手写的信息" >/dev/null 2>&1; echo "T9 merge 后接 --no-verify 空提交：退出 $?（应 0）；note：$(note)（应 有）"
if [ -n "$had" ]; then git update-ref refs/notes/gate-skip "$had"; else git update-ref -d refs/notes/gate-skip 2>/dev/null; fi
cd "$R" && git worktree remove --force "$W" && rm -rf "$T"
