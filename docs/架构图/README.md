# 架构图（Archify 生成）

**当前版本：四个平面 · 十四个部件 · 一条交付线**（对应[架构确定](../架构确定.md)与[00 总览](../00-总览.md)，2026-09-03 更新）

- `four-planes.architecture.html`：可交互成品（深浅主题、五个引导视图、路径追踪、导出 PNG/JPEG/WebP/SVG）。
- `four-planes.architecture.json`：图的源（Archify Typed JSON IR）。**改图改这个文件**，然后重新 `validate` 与 `deliver`。
- `four-planes-preview-light.png` / `-dark.png`：4140×2460 预览，由成品页自身的 PNG 导出生成（不是截图）。

## 这一版比上一版多了什么

| | 旧版（2026-09-02） | 当前版 |
|---|---|---|
| 部件 | 12（24 与 25 合并，缺 23 方法库） | **14，与 00 总览 §2 一一对应** |
| 连线 | 12，无证据标注 | 15，**括号内是明确画出该关系的独立来源数**（00 总览 §4） |
| 节点标注 | 无 | **「归因 N」= 52 个来源中把该类失败归因到本部件的来源数**（00 总览 §6，即排查顺序） |
| 引导视图 | 3（交付线 / 知识平面 / 控制与责任） | **5，即四个闭环 + 责任平面**（00 总览 §3） |
| 卡片 | 3（三个平面） | 5（**六条不变量**、三个平面、**L0–L3 四档**） |

## 读法

四个虚线框是责任、知识、执行、控制四个平面；**绿色粗线是交付线**（人确认意图 → 派生工作项与用例 → 每轮先读状态 → 派发切片 → 装配上下文 → 执行 → 环境回读与三态裁定 → 证据写回状态）；**紫色虚线是回流**（记忆治理后的晋升、证据喂给演进、失败驱动规则增删）；**红色虚线是控制平面的阻断**。

**刻意没有画成边的两条关系**：「超限与门禁失败 → 升级到人」与「不可逆动作 → 只能由人授权」。它们要横跨整张图，画出来会压过交付线；语义写在守卫与人两个节点上，关系本身见[00 总览 §4](../00-总览.md)。这是可读性取舍，不是遗漏。

## 改图与重新生成

```bash
archify validate architecture docs/架构图/four-planes.architecture.json
archify deliver architecture docs/架构图/four-planes.architecture.json docs/架构图/four-planes.architecture.html --quality showcase
```

`validate` 会逐条报出标签压组件、连线穿节点、走廊交叉、桌面视口下文字过密等问题，并给出可直接照抄的修法（`labelAt`、`labelDy`、`via` 坐标）。**showcase 档必须 0 错 0 警**——当前版本 9/9 artifact 检查通过。PNG 预览用成品页右上角「导出 → PNG（无损图像）」重出，两个主题各一张。

历史版本（保留供对照）：`three-planes.*`（三平面，人尚未单列）、`ai-dev-system.*`（五部件 + 两胶水，最初按示例画的）。

生成工具：[tt-a1i/archify](https://github.com/tt-a1i/archify) v2.17.0-dev.1（`npm install -g` 自仓库 `archify/` 子目录安装；仓库根目录没有 package.json，直接 `npm i -g github:tt-a1i/archify` 会失败）。
