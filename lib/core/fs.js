// 受限读取：被扫项目里的文件只能经这里读（对应 tools/std/stdlib.py 的 inside / guard / read_bytes / read_text / count_lines，契约 §2）。
//
// 威胁模型：被扫项目是**别人写的**（压缩包、共享目录带进来的仓）。里面的符号链接可以指向仓外任意文件；FIFO 会让 read 永久阻塞；
// 4GB 稀疏文件能把机器撑爆；打开前后可以把中间目录换成指向仓外的链接。每一道都是一次实测出来的缺陷（D-123）。
// 与 Python 版的有意差异见设计 §12.6：D7（非常规文件统一抛 NotRegular）、D8（Windows 上 O_NOFOLLOW/O_NONBLOCK 为空，ino 用 BigInt）。
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
/** 读被扫项目文件的唯一上限。超限抛 TooLarge，各读点照常按 OSError 记未定。 */
export const MAX_READ_BYTES = 2 * 1024 * 1024;
/** 路径的真实位置（跟随符号链接后）不在被扫项目之内。继承 Error 并带 `code`，各读点的 catch 照常把它转成未定。 */
export class OutsideRoot extends Error {
    name = 'OutsideRoot';
    code = 'OUTSIDE_ROOT';
}
/** 文件超过 MAX_READ_BYTES，未读。 */
export class TooLarge extends Error {
    name = 'TooLarge';
    code = 'TOO_LARGE';
}
/** 不是常规文件（FIFO、设备、socket、目录），未读：FIFO 会让 open/read 永久阻塞。 */
export class NotRegular extends Error {
    name = 'NotRegular';
    code = 'NOT_REGULAR';
}
/** 本模块抛出的「没读」类错误。调用方用它统一判断，不必逐个 instanceof。 */
export function isReadRefusal(e) {
    return e instanceof OutsideRoot || e instanceof TooLarge || e instanceof NotRegular;
}
function under(p, r) {
    if (p === r)
        return true;
    const base = r.endsWith(sep) ? r.slice(0, -1) : r;
    return p.startsWith(base + sep);
}
/** 字面（不碰文件系统）规整成绝对路径。 */
function abs(p) {
    return resolve(String(p));
}
/**
 * path 跟随符号链接后是否仍在 root 之内（含 root 本身）。判不了按「不在」算。
 *
 * 先按字面（abspath）判：字面就在 root 之外的路径直接返回 false，**不碰文件系统**——
 * realpath 会逐段 lstat，那本身就是对项目之外路径的探测。字面在内的再按真实位置判（符号链接出仓）。
 */
export function inside(root, path) {
    try {
        const r = abs(root || '.');
        if (!under(abs(path), r))
            return false;
        return under(realpathLoose(abs(path)), realpathLoose(r));
    }
    catch {
        return false;
    }
}
/**
 * 与 Python 的 `os.path.realpath`（非严格）同义：路径不存在时不抛，对存在的最长前缀求真实路径，再拼上剩余部分。
 * Node 的 `realpathSync` 对不存在的路径抛 ENOENT，Python 的不抛——`inside()` 要对「还不存在的路径」也能答。
 */
export function realpathLoose(p) {
    let cur = p;
    const rest = [];
    for (;;) {
        try {
            const real = realpathSync.native(cur);
            return rest.length ? resolve(real, ...rest.reverse()) : real;
        }
        catch (e) {
            const code = e.code;
            if (code !== 'ENOENT' && code !== 'ENOTDIR')
                throw e;
            const parent = resolve(cur, '..');
            if (parent === cur)
                return p;
            rest.push(cur.slice(parent.length).replace(/^[\\/]+/, ''));
            cur = parent;
        }
    }
}
/**
 * 读被扫项目里的文件之前调用：真实位置在 root 之外即抛 OutsideRoot，不读、不回显内容。
 * 被扫项目里的符号链接可以指向仓外任意文件；跟随它读，就是把仓外内容（与其存在性）带进报告。
 */
export function guard(root, path) {
    if (!inside(root, path))
        throw new OutsideRoot(`${path} 的真实位置在被扫项目之外（符号链接或 ..），未读`);
    return path;
}
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const O_NONBLOCK = constants.O_NONBLOCK ?? 0;
/**
 * **仅测试用**：在 realpath 与 openSync 之间调用，用来在「护栏放行之后、打开之前」把中间目录换成出仓链接（Python 版的自检靠 monkeypatch os.open，
 * ESM 的命名空间不可改写，所以显式留钩子）。`afterOpen` 在 fd 已打开、核对 dev/ino 之前调用——那正是 dev/ino 核对要防的窗口（文件在被我们打开之后、核对之前被换成另一个）。
 * 生产路径里恒为 undefined，不影响行为；改它的只有测试。
 */
export const __testHooks = { beforeOpen: undefined, afterOpen: undefined, opened: 0 };
/**
 * 读被扫项目文件的唯一入口：护栏 → 非阻塞打开 → 只收常规文件 → 大小上限。
 *
 * head 缺省时超过 MAX_READ_BYTES 抛 TooLarge；给了 head 就只读前 head 字节、不因体量拒读。
 * 给了 root：先按字面、再按真实位置判（与 `guard` 同一规则，字面出仓不碰文件系统），打开后再核一次——
 * 真实路径仍是它自己（中间目录没被换成链接）、且与打开的 fd 是同一个文件（dev/ino，换出去又换回来也拦得下）。
 * O_NOFOLLOW 挡住末段被换成符号链接（Windows 上该标志不存在，D8）。
 */
export function readBytes(path, root, head) {
    if (root !== undefined && root !== null && !under(abs(path), abs(root))) {
        throw new OutsideRoot(`${path} 的真实位置在被扫项目之外（符号链接或 ..），未读`);
    }
    const real = realpathLoose(abs(path));
    if (root !== undefined && root !== null && !under(real, realpathLoose(abs(root)))) {
        throw new OutsideRoot(`${path} 的真实位置在被扫项目之外（符号链接或 ..），未读`);
    }
    __testHooks.beforeOpen?.();
    const fd = (__testHooks.opened++, openSync(real, constants.O_RDONLY | O_NONBLOCK | O_NOFOLLOW));
    try {
        const st = fstatSync(fd, { bigint: true });
        __testHooks.afterOpen?.(fd);
        // 目录：POSIX 上 open 成功、这里判；Windows 上 open 就抛（D7）。统一抛 NotRegular。
        if (!st.isFile())
            throw new NotRegular(`${path} 不是常规文件，未读`);
        if (root !== undefined && root !== null) {
            const again = statSync(real, { bigint: true });
            // 全程 BigInt：Windows 上 Number 的 ino 会丢精度，同一个文件会被判成两个（D8）
            if (realpathLoose(real) !== real || again.dev !== st.dev || again.ino !== st.ino) {
                throw new OutsideRoot(`${path} 在读取期间被换位，未读`);
            }
        }
        if ((head === undefined || head === null) && st.size > BigInt(MAX_READ_BYTES)) {
            throw new TooLarge(`${path} 超过 ${MAX_READ_BYTES} 字节，未读`);
        }
        const want = head === undefined || head === null ? MAX_READ_BYTES + 1 : head;
        const buf = Buffer.allocUnsafe(want);
        let got = 0;
        while (got < want) {
            const n = readSync(fd, buf, got, want - got, null);
            if (n === 0)
                break;
            got += n;
        }
        const data = buf.subarray(0, got);
        if ((head === undefined || head === null) && data.length > MAX_READ_BYTES) {
            throw new TooLarge(`${path} 超过 ${MAX_READ_BYTES} 字节，未读`); // 读的过程中长大了
        }
        return Buffer.from(data); // 拷出来：不持有 allocUnsafe 的大块
    }
    finally {
        closeSync(fd);
    }
}
/** 与 Python `bytes.decode('utf-8-sig', 'replace')` 同义：去**一个**开头的 BOM；非法序列按 Python 的规则替换成 U+FFFD。 */
export function decodeUtf8Sig(data) {
    const d = data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf ? data.subarray(3) : data;
    return decodeUtf8Replace(d);
}
/**
 * Python 的 `decode('utf-8', 'replace')` 与 WHATWG（Node 的 TextDecoder）在「怎么数 U+FFFD」上规则相同——
 * 都遵循 Unicode 的「最大子部分」替换（一个被截断的多字节序列替换成**一个** U+FFFD）。
 * 所以直接用 TextDecoder（不 fatal、不 ignoreBOM 之外的特殊处理）；是否逐样本相同由黄金样本逐条钉住，不靠这条注释。
 */
function decodeUtf8Replace(d) {
    return new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(d);
}
/** 读文本：UTF-8，解不开的字节替换，行尾归一为 \n。走 readBytes，同一套护栏与上限。 */
export function readText(path, root, head) {
    const text = decodeUtf8Sig(readBytes(path, root, head));
    return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}
/**
 * 行数。超过 MAX_READ_BYTES 的文件只数前 MAX_READ_BYTES 字节，得到的是**下界**：下界超预算
 * 照判超预算——入口撑过上限不许从确定的 FAIL 变成未定。
 */
export function countLines(path, root) {
    const text = readText(path, root, MAX_READ_BYTES);
    let n = 0;
    for (let i = 0; i < text.length; i++)
        if (text.charCodeAt(i) === 10)
            n++;
    return n + (text && !text.endsWith('\n') ? 1 : 0);
}
export { isAbsolute };
