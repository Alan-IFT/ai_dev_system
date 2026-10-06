// ai-dev-std 插件包入口（DSH 按 package.json 的 main 加载它）。
// 目前只有一个子系统：守卫（受控动作询问）。检查器迁入后在这里并列导出，不改守卫的对外形状。
export { name, inject, Config, apply } from './guard/index.js';
