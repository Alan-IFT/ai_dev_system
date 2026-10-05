@CONTEXT_MANIFEST.md

提交闸门由 `.githooks/` 下的 git 钩子执行（合同见仓库工作须知 §7），每个克隆装一次：`git config core.hooksPath .githooks`。

受支持的宿主只有 DeepSeek Harness（D-135）。受控动作的询问与内嵌目录只读由 `tools/dsh-std/` 插件承担，装法见该目录 README。
