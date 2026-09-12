# ai_dev_system · release 分支

本分支是 `main` 的发布产物，不在这里修改任何内容：改动一律回 `main`，再按 `tools/std/README.md` 「接入一个项目」里的发布步骤重新发布。

内容只有三个目录，与 `main` 上同名目录逐字一致：

- `标准/` 四章正文、覆盖与采用检查、参考资料、示例项目
- `templates/` 载体实例模板
- `tools/std/` 检查器与契约（`python .std/tools/std/check_all.py .`）

每个发布提交打一个 tag，tag 名就是采用项目写进 `governance/STANDARD_VERSION` 的值（日期格式）。采用项目用
`git subtree add --prefix=.std git@github.com:Alan-IFT/ai_dev_system.git <tag> --squash` 取用，
用 `git subtree pull --prefix=.std <remote> <新 tag> --squash` 升级；两个 tag 之间的 `git diff` 就是升级差异。

| tag | 来自 main |
|---|---|
| `2026-09-12` | `a419b04` |
| `2026-09-12.1` | `a58a7ff` |
| `2026-09-12.2` | `402cf7f` |
