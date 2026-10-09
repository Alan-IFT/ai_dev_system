#!/usr/bin/env node
// 命令行入口 `std-check`（钩子与 CI 调用）。主流程在 `main.ts`；这里只负责把汇总层自检注入进去并设退出码。设计 §3、§12.31 取舍 6。
import { pathToFileURL } from 'node:url';
import { main } from './main.js';
import { aggregateSelftest } from './selftest.js';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    process.exitCode = main(process.argv.slice(2), aggregateSelftest);
