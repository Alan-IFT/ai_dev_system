/** 写文本文件：UTF-8、LF（不做行尾转换），父目录不存在就建。 */
export declare function writeText(path: string, text: string): void;
/** 按 {相对路径: 内容} 在 root 下摆自检样本。 */
export declare function writeFiles(root: string, files: Record<string, string>): void;
/** 夹具不受全局配置左右：固定身份、不签名、不跑全局钩子、不转换换行。 */
export declare const GIT_FIXTURE_ID: readonly string[];
/** 在本工具自建的夹具仓里跑一条 git；退出码非 0 即抛。 */
export declare function gitFixture(repo: string, args: readonly string[], env?: NodeJS.ProcessEnv): void;
/**
 * 自检样本要被 git 跟踪才进得了扫描范围；给了 when 再以该时间真提交一次。返回 null 或错误串。
 * 只用于本工具自建的夹具仓，不得用于被扫仓（不走 filterEnv）。
 */
export declare function gitTrack(tmp: string, when?: string): string | null;
