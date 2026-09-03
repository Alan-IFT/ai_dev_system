# 架构图（Archify 生成）

**当前版本：四个平面 + 一条交付线**（对应[架构确定](../架构确定.md)与[00 总览](../00-总览.md)，2026-09-02）

- `four-planes.architecture.html`：可交互成品（深浅主题、"交付线 / 知识平面 / 控制平面与责任平面"三个引导视图、路径追踪、导出 PNG/SVG）。
- `four-planes.architecture.json`：图的源（Archify Typed JSON IR）。改图改这个文件后重新 `validate` 与 `deliver`。
- `four-planes-preview-light.png` / `-dark.png`：1440×900 预览。

读法：四个虚线框分别是责任、知识、执行、控制平面；绿色粗线是交付线（人确认意图 → 派生工作项 → 每轮先读状态 → 派发 → 装配上下文 → 执行 → 环境回读与三态裁定 → 证据写回状态）；紫色虚线是记忆治理后的晋升与轨迹喂给演进。为保持可读性，"超限 / 不可逆 → 升级到人"没有画成边，写在守卫与人两个节点的副标题里，关系本身见[00 总览 §4](../00-总览.md)。

历史版本（保留供对照）：`three-planes.*`（三平面，人尚未单列）、`ai-dev-system.*`（五部件 + 两胶水，最初按示例画的）。

生成工具：[tt-a1i/archify](https://github.com/tt-a1i/archify) v2.17.0-dev.1；三版均 showcase 校验 9/9 通过、四种桌面视口无溢出。
