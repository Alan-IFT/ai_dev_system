// dsh-project-std 插件包入口（DSH 按 package.json 的 main 加载它）。
// 包里有两个入口，在 cordis.patch.yml 里挂成两行：
//   · 本入口（"."）：守卫（受控动作询问，见 guard/）。不依赖任何服务（inject = []）。
//   · "./skills"：标准技能（把随包分发的标准正文交给会话，见 skills_plugin.ts）。依赖 skills 服务。
// 分开的原因见 skills_plugin.ts 头注释：Cordis 的 inject 是整个插件一份，合在一起要么守卫被技能服务拖住，要么技能取不到服务。
export { name, inject, Config, apply } from './guard/index.js';
