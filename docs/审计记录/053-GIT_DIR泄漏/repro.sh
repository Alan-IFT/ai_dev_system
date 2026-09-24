#!/bin/bash
# 用法：repro.sh <标签> <内嵌标准来源目录（含 tools/std）> [wt|main-a]
#   wt（默认）：从 worktree 提交；main-a：在主工作区用 git commit -a 提交
set -u
L=$1; SRC=$2; MODE=${3:-wt}; D=/tmp/claude-1000/gitdir-leak/$L
rm -rf "$D"; mkdir -p "$D"; cd "$D"
G="git -c user.email=r@example.invalid -c user.name=r -c commit.gpgsign=false -c init.defaultBranch=main"
$G init -q main
cd main
cp -r "$SRC" .std
find .std -name __pycache__ -prune -exec rm -rf {} +
mkdir -p governance docs
printf 'layout:\n  entry:\n    - CLAUDE.md\n  docs_root: docs\nbudgets:\n  entry_lines: 150\n' > governance/project.yaml
printf '# 复现仓\n' > CLAUDE.md
printf '# 说明\n' > docs/a.md
$G add -A && $G commit -q -m init
$G worktree add -q ../wt -b feature
printf '#!/bin/sh\npython3 .std/tools/std/check_all.py . --no-scope > %s/hook-output.txt 2>&1\necho "check_all rc=$?" >> %s/hook-output.txt\nexit 0\n' "$D" "$D" > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
snap() { { echo "== config"; cat .git/config; echo "== HEAD"; cat .git/HEAD; echo "== refs"; git for-each-ref --format='%(refname) %(objectname) %(subject)'; echo "== all log"; git log --oneline --all | head -20; echo "== status"; git status --short 2>&1 | head -5; } ; }
snap > "$D/before-commit.txt" 2>&1
if [ "$MODE" = main-a ]; then
  echo x >> docs/a.md && $G commit -q -a -m "main change" 2> "$D/commit-stderr.txt"; RC=$?
else
  cd ../wt && echo x >> docs/a.md && $G add docs/a.md && $G commit -q -m "wt change" 2> "$D/commit-stderr.txt"; RC=$?; cd ../main
fi
{ echo "mode=$MODE commit rc=$RC"; echo "== commit stderr"; cat "$D/commit-stderr.txt"; } > "$D/commit-rc.txt"; rm -f "$D/commit-stderr.txt"
snap > "$D/after-commit.txt" 2>&1
diff "$D/before-commit.txt" "$D/after-commit.txt" > "$D/diff.txt"; echo "diff rc=$?（唯一应有的差异：多出本次这一个正常提交（wt change 或 main change）；bare 变 true 或出现别的提交即为泄漏）" >> "$D/diff.txt"
cat "$D/commit-rc.txt"; tail -40 "$D/diff.txt"
