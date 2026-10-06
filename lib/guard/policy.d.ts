/** 命令长度上限：超过则不分析，直接 ask（防 ReDoS，也防把超长命令当「已审」放行）。 */
/** 判定结果。deny 无法由人批准，所以只给不需要猜的字面事实；其余不确定一律 ask。 */
export type Verdict = {
    kind: 'allow';
} | {
    kind: 'ask';
    reason: string;
} | {
    kind: 'deny';
    reason: string;
};
/** 词法方言：bash 用 `\` 转义，PowerShell 用反引号。 */
export type Dialect = 'bash' | 'ps';
/** 命令替换：text 是 $( ) 或反引号里的内容；at 是它出现时已切出的段数（属于当前正在读的那一段）。 */
export interface Sub {
    text: string;
    at: number;
}
export interface LexResult {
    segs: string[];
    subs: Sub[];
    problem: string | null;
}
export interface ToolCall {
    name?: unknown;
    arguments?: unknown;
}
export interface DecideOpts {
    root?: string;
    protect?: unknown;
}
export declare const MAX_CMD = 8192;
/** 把路径规整成可比较的形式：Win32 会忽略每段尾部的点与空格，并认 \\?\ 前缀；NTFS 的 `:流名` 后缀不改变文件本身；Windows 上还要忽略大小写。 */
export declare function normalizeForCompare(p: string): string;
/** 路径是否落在内嵌标准目录（.std/）之下。base 缺省为 root（虚拟 cwd 时传入）。 */
export declare function inEmbeddedStd(p: string, root?: string, base?: string): boolean;
/** 路径是否是需要先问的受保护文件（改钩子、改入口合同、改守卫自身）；返回理由或 null。 */
export declare function protectedPath(p: string, root?: string, base?: string, protect?: string[]): string | null;
/**
 * 把插件配置的 protect 规整成「相对项目根、以 / 分隔、无首尾斜杠」的列表。只收紧不放宽：
 * 非数组、非字符串项、空串、绝对路径（含盘符与 UNC）、含 `..` 或 `.` 段的项一律丢弃，不抛、不当成「全部」。
 * 比较时与 protectedPath 里的 rel 同样走 normalizeForCompare（大小写、段尾点与空格），所以 `Src\\Guard` 也认。
 */
export declare function normalizeProtect(raw: unknown): string[];
/**
 * 词法扫描。返回 {segs, subs, problem}：
 *   segs    —— 按未被引号包住的 `; && || | & 换行` 与词首的 `{ }` 切出的子命令（保留引号，供后续切词与重定向识别）；
 *   subs    —— 抽取出的内嵌命令串：`$(…)`、反引号对、`<(…)`／`>(…)`（包括双引号内的），由调用方递归判；
 *   problem —— 解析不了的形状（引号不配对、here 文档无终止符、块注释不闭合、here 文档正文含命令替换），非空则整条 ask。
 * 同时处理：引号内的转义引号（`\"`、`` `" ``）、行注释（词首 `#`）、`<# … #>` 块注释、here 文档（`<<EOF`）与 PowerShell here-string（`@' … '@`）——
 * 它们的**正文是数据，不是命令**，剥掉后再判；续行（行尾 `\` 或反引号）。线性，无回溯。
 */
export declare function lex(cmd: string, dialect?: Dialect): LexResult;
/** 兼容：只要子命令段。 */
export declare function splitCommands(cmd: string): string[];
/** 一段子命令切词：空白分隔，引号包住的算一个词（去引号；双引号内的转义引号保留成引号字符）。 */
export declare function tokenize(seg: string, dialect?: Dialect): string[];
/**
 * 取一段命令里**引号外**的重定向目标词。识别 `>`、`>>`、`>|`、`>&`，前缀可以是数字或 `&`，`>` 前可以紧贴别的词（`echo x>f`），
 * 也可以在命令之前（`>f echo x`）。目标是 `>` 之后的下一个词（可紧贴，也可隔空白）。线性扫描。
 */
export declare function redirectTargets(seg: string, dialect?: Dialect): string[];
/** 剥掉控制流关键字、前缀包装与 `VAR=val` 赋值前缀；返回剥后的词表。 */
export declare function stripPrefix(toks: string[]): string[];
/**
 * 把整条命令当字符串参数交给别的 shell 的包装：`bash -c "…"`（含 `-lc`、`-ec`、`-cx` 等选项簇）、`cmd /c "…"`（含 `/k`）、
 * `powershell -c`／`-Command`（含参数缩写 `-com` `-comm`…）、`iex "…"`、`Invoke-Expression`、`eval`。取出那段字符串，作为内嵌命令再判一次。
 * 没有这种包装返回 null；否则返回 {text, dialect}，dialect 决定内嵌串用哪种转义规则解析。
 */
export declare function innerCommand(toks: string[]): {
    text: string;
    dialect: Dialect;
} | null;
/** 取 git 的真正子命令（跳过 -C dir、-c k=v、--git-dir 等带值全局选项）；返回 {name, raw, alias}。 */
export declare function gitSubcommand(rawToks: string[]): {
    name: string;
    raw: string;
    rest: string[];
    alias: boolean;
};
/** 受控 git 动作。返回理由字符串或 null。 */
export declare function gitAsk(rawToks: string[]): string | null;
/**
 * 判定一次工具调用。
 * @param {{name:string, arguments:any}} exec
 * @param {{root?:string}} [opts]  root 缺省取进程 cwd。适配层会先传会话工作目录；会话不是在项目根开的就可能判偏，
 *                                   要稳妥就在 profile 的插件配置里写 root（见 README）。
 */
export declare function decide(exec: ToolCall, opts?: DecideOpts): Verdict;
/**
 * 提交信息首行是否合 type(scope)!?: subject（01 §5.1）；放行 git 自动生成的固定形态。
 * **目前没有任何调用方**：插件没有接提交信息检查（那是 `.githooks/commit-msg` 的职责）。保留它是因为单测覆盖了
 * 这条判据，将来要在 pre-execute 里接再用；在此之前不要把它当作已生效的检查。
 */
export declare function commitMessageProblem(first: string): string | null;
