import { isAbsolute } from 'node:path';
/** 读被扫项目文件的唯一上限。超限抛 TooLarge，各读点照常按 OSError 记未定。 */
export declare const MAX_READ_BYTES: number;
/** 路径的真实位置（跟随符号链接后）不在被扫项目之内。继承 Error 并带 `code`，各读点的 catch 照常把它转成未定。 */
export declare class OutsideRoot extends Error {
    name: string;
    readonly code = "OUTSIDE_ROOT";
}
/** 文件超过 MAX_READ_BYTES，未读。 */
export declare class TooLarge extends Error {
    name: string;
    readonly code = "TOO_LARGE";
}
/** 不是常规文件（FIFO、设备、socket、目录），未读：FIFO 会让 open/read 永久阻塞。 */
export declare class NotRegular extends Error {
    name: string;
    readonly code = "NOT_REGULAR";
}
/** 本模块抛出的「没读」类错误。调用方用它统一判断，不必逐个 instanceof。 */
export declare function isReadRefusal(e: unknown): e is OutsideRoot | TooLarge | NotRegular;
/**
 * path 跟随符号链接后是否仍在 root 之内（含 root 本身）。判不了按「不在」算。
 *
 * 先按字面（abspath）判：字面就在 root 之外的路径直接返回 false，**不碰文件系统**——
 * realpath 会逐段 lstat，那本身就是对项目之外路径的探测。字面在内的再按真实位置判（符号链接出仓）。
 */
export declare function inside(root: string | null | undefined, path: string): boolean;
/**
 * 与 Python 的 `os.path.realpath`（非严格）同义：路径不存在时不抛，对存在的最长前缀求真实路径，再拼上剩余部分。
 * Node 的 `realpathSync` 对不存在的路径抛 ENOENT，Python 的不抛——`inside()` 要对「还不存在的路径」也能答。
 */
export declare function realpathLoose(p: string, hops?: number): string;
/**
 * 与 Python 的 `os.path.isfile` / `os.path.isdir` 同义：跟随符号链接，任何错误都按「不是」算。**全仓唯一一份**——此前各模块各写一份直接用 `statSync`。
 * 差异在 Windows 上：路径带尾分隔符的普通文件（`S.md/`），Python 的 `isfile` 为 False，Node 的 `statSync` 却照样 stat 到文件；这里补上这条（设计 §12.16）。
 */
export declare function isFile(p: string): boolean;
export declare function isDir(p: string): boolean;
/** 与 Python 的 `os.path.lexists` 同义：不跟随符号链接，断链也算存在。 */
export declare function lexists(p: string): boolean;
/**
 * 读被扫项目里的文件之前调用：真实位置在 root 之外即抛 OutsideRoot，不读、不回显内容。
 * 被扫项目里的符号链接可以指向仓外任意文件；跟随它读，就是把仓外内容（与其存在性）带进报告。
 */
export declare function guard(root: string | null | undefined, path: string): string;
/**
 * **仅测试用**：在 realpath 与 openSync 之间调用，用来在「护栏放行之后、打开之前」把中间目录换成出仓链接（Python 版的自检靠 monkeypatch os.open，
 * ESM 的命名空间不可改写，所以显式留钩子）。`afterOpen` 在 fd 已打开、核对 dev/ino 之前调用——那正是 dev/ino 核对要防的窗口（文件在被我们打开之后、核对之前被换成另一个）。
 * 生产路径里恒为 undefined，不影响行为；改它的只有测试。
 */
export declare const __testHooks: {
    beforeOpen: (() => void) | undefined;
    afterOpen: ((fd: number) => void) | undefined;
    opened: number;
};
/**
 * 读被扫项目文件的唯一入口：护栏 → 非阻塞打开 → 只收常规文件 → 大小上限。
 *
 * head 缺省时超过 MAX_READ_BYTES 抛 TooLarge；给了 head 就只读前 head 字节、不因体量拒读。
 * 给了 root：先按字面、再按真实位置判（与 `guard` 同一规则，字面出仓不碰文件系统），打开后再核一次——
 * 真实路径仍是它自己（中间目录没被换成链接）、且与打开的 fd 是同一个文件（dev/ino，换出去又换回来也拦得下）。
 * O_NOFOLLOW 挡住末段被换成符号链接（Windows 上该标志不存在，D8）。
 */
export declare function readBytes(path: string, root?: string | null, head?: number | null): Buffer;
/** 与 Python `bytes.decode('utf-8-sig', 'replace')` 同义：去**一个**开头的 BOM；非法序列按 Python 的规则替换成 U+FFFD。 */
export declare function decodeUtf8Sig(data: Buffer): string;
/** 读文本：UTF-8，解不开的字节替换，行尾归一为 \n。走 readBytes，同一套护栏与上限。 */
export declare function readText(path: string, root?: string | null, head?: number | null): string;
/**
 * 行数。超过 MAX_READ_BYTES 的文件只数前 MAX_READ_BYTES 字节，得到的是**下界**：下界超预算
 * 照判超预算——入口撑过上限不许从确定的 FAIL 变成未定。
 */
export declare function countLines(path: string, root?: string | null): number;
export { isAbsolute };
