import { type Finding } from './core/finding.js';
export declare function contractExamplesSelftest(): Finding[];
export declare function sharedFactSelftest(): Finding[];
/**
 * 契约 §3 的自检只覆盖各检查器，**不覆盖入口**。这条来自一次真实翻车：`run_all` 改成返回 `(findings, cfg)` 之后 `main` 仍按列表接收，`check_all .` 直接崩——
 * 而当时每个检查器的自检都是绿的，`--selftest` 退出码 0。所以这里不是再验一遍检查器，而是造一个临时项目 + 一份放在项目之外的配置，
 * 真正走一遍 runAll → render → main（含参数解析与三态退出码），断言不抛异常、返回形状对、三态计数拿得到。
 */
export declare function entrySmokeSelftest(): Finding[];
