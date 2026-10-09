import { existsSync, readFileSync } from 'node:fs';
/** 方案里每一步的类别：deterministic＝精确命令可直接执行；judgement＝需要判断，只给命中与建议。 */
export type StepKind = 'deterministic' | 'judgement';
export interface Step {
    id: string;
    kind: StepKind;
    title: string;
    /** deterministic 步骤：要执行的 git 命令（一条一项，逐条可单独回退）。 */
    commands?: string[];
    /** judgement 步骤：命中的位置 [相对路径, 行号, 原文]。 */
    hits?: Array<[string, number, string]>;
    /** 建议改法（人读）。 */
    advice?: string;
    verify: string;
    rollback: string;
    /** 非空表示这一步当前做不了，值是缺什么。 */
    blocked?: string;
}
export interface Plan {
    root: string;
    /** 项目当前的形态摘要，供读方案的人核对"这确实是它"。 */
    facts: Record<string, string | boolean | number | null>;
    steps: Step[];
    /** 方案不适用时的说明（例如根本没有 .std/）。 */
    notApplicable?: string;
}
/** 钩子的三种已知形态（读自三个真实项目）。认不出的记 unknown，由人决定——不猜。 */
export type HookKind = 'githooks-script' | 'precommit-framework' | 'custom-hooks-dir' | 'unknown' | 'none';
/** 找出项目里调用旧检查器的钩子文件（只看文件内容里有没有 `.std/tools/std/check_all`）。 */
export declare function findHooks(root: string): Array<{
    kind: HookKind;
    path: string;
}>;
/** 在文本里找所有命中某模式的行：[行号, 原文]。 */
declare function grepLines(text: string, re: RegExp): Array<[number, string]>;
/**
 * 生成方案。`installed`：新插件是否已装入 profile（由调用方探测并传入，便于测试注入；生产路径由 cli 探测）。
 * 不读被扫项目之外的任何东西；对项目只读。
 */
export declare function plan(root: string, installed?: boolean | {
    ok: false;
    why: string;
}): Plan;
/** 文本渲染：给人读的方案（--json 另给机器可读版）。 */
export declare function renderPlan(p: Plan): string;
export declare const _internal: {
    grepLines: typeof grepLines;
    existsSync: typeof existsSync;
    readFileSync: typeof readFileSync;
};
export {};
