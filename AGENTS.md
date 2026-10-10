@CONTEXT_MANIFEST.md

提交闸门由 `.githooks/` 下的 git 钩子执行（合同见仓库工作须知 §7），每个克隆装一次：`git config core.hooksPath .githooks`。

受支持的宿主只有 DeepSeek Harness（D-135）。受控动作的询问由本仓根目录的 DSH 插件 `dsh-project-std` 承担（源码 `src/guard/`），装法见 [tools/std/README](tools/std/README.md)「DSH 接法」。
