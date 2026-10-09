import { type Finding } from './core/finding.js';
/**
 * 钩子注入的 GIT_DIR 不得把夹具写进别的仓。建一个牺牲仓，照 worktree 钩子实测的注入形态（绝对 GIT_DIR 与 GIT_INDEX_FILE，不带 GIT_WORK_TREE——带上它反而掩盖泄漏）指向它，
 * 以子进程走真实入口（`lib/cli.js`）跑一遍会建夹具的扫描，断言牺牲仓的 config、HEAD、refs 一字未变。
 */
export declare function gitEnvSelftest(): Finding[];
/**
 * 被扫仓 `.git/config` 里的外部程序不得被本工具执行（`GIT_HARDEN_CONFIG`、`filterEnv`）。
 * 夹具仓的配置写上 core.fsmonitor、blame 会走的 textconv、两个 clean 过滤器（其一名字带 `=`，`-c k=v` 会把它切错）、diff.external，
 * 以及 log.showSignature + gpg.program + 一个签名提交（freshness 退到提交时间时的 `git log` 会验签）；每个都 touch 一个标记文件。
 * 工作区文件带会被 drift 拿去 blame 的日期、带一件没有转换时间戳的进行中工作项，保证这些 git 调用真的发生。
 */
export declare function hostileGitConfigSelftest(): Finding[];
