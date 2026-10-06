#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""stdlib 受限读取（read_bytes / read_text / count_lines / inside / guard）的夹具型单元黄金样本。

与 make_unit.py（纯函数）不同，这里要真的造文件：普通文件、目录、符号链接、超限稀疏文件、各种坏编码。
夹具在临时目录里建、用完删；输出只记**相对夹具名**与结果（字节用十六进制、异常用类名），不含路径、时间，所以确定。
TS 测试在自己的临时目录里按同一份清单（FIXTURES）建同样的夹具，再逐条比对。

平台说明：Python 在 Windows 上 `os.open` 一个目录抛 PermissionError，在 POSIX 上能打开、再被 fstat 判成 NotRegular。
这两个都是 OSError 子类，调用方的 `except OSError` 一视同仁，所以 TS 版统一抛 NotRegular（设计 §12.6 D7）。
符号链接在 Windows 上要权限，造不出时那几条不记录（manifest 里写明），TS 测试同样跳过并如实标 SKIP。
用法：python golden/make_unit_fs.py
"""
import json, os, sys, tempfile, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "tools", "std"))
import stdlib as sl

# (夹具名, 字节内容或特殊标记)。TS 测试里有同一张表，改这里就要同步改那里（测试会核对条数）。
FILES = [
    ("a.txt", b"hello"),
    ("empty.txt", b""),
    ("nl.txt", b"\n"),
    ("nonl.txt", b"a"),
    ("two.txt", b"a\nb\n"),
    ("crlf_nonl.txt", b"a\r\nb"),
    ("bom_crlf.txt", b"\xef\xbb\xbfa\r\nb\rc\n"),
    ("bom_only.txt", b"\xef\xbb\xbf"),
    ("double_bom.txt", b"\xef\xbb\xbf\xef\xbb\xbfx"),
    ("bad_ff.txt", b"a\xffb"),
    ("bad_trunc2.txt", b"\xe4\xb8"),
    ("bad_trunc3.txt", b"\xf0\x9f\x98x"),
    ("bad_overlong.txt", b"\xc0\x80"),
    ("bad_surrogate.txt", b"\xed\xa0\x80"),
    ("bad_fffe.txt", b"\xff\xfe"),
    ("bad_after_bom.txt", b"\xef\xbb\xbfa\xffb"),
    ("utf8_ok.txt", "中文😀 ok\n".encode("utf-8")),
]
MAX = sl.MAX_READ_BYTES


def call(fn, *a, **k):
    try:
        return {"ok": fn(*a, **k)}
    except Exception as exc:  # noqa: BLE001
        return {"raised": type(exc).__name__}


def hexed(v):
    if isinstance(v, bytes):
        return {"len": len(v), "hex": v[:64].hex()}
    return v


def main():
    base = tempfile.mkdtemp(prefix="goldfs-")
    proj = os.path.join(base, "proj")
    out_dir = os.path.join(base, "outside")
    os.makedirs(proj); os.makedirs(out_dir)
    manifest = {"platform": sys.platform, "python": sys.version.split()[0], "symlink": False}
    try:
        for name, data in FILES:
            with open(os.path.join(proj, name), "wb") as fh:
                fh.write(data)
        os.makedirs(os.path.join(proj, "d"))
        with open(os.path.join(proj, "big_sparse.bin"), "wb") as fh:
            fh.truncate(MAX + 1)                                   # 稀疏：读到的全是 0
        with open(os.path.join(proj, "big_lines.txt"), "wb") as fh:  # 超限的真文本：只数前 MAX 字节，得到下界
            fh.write(b"x\n" * (MAX // 2 + 100))
        with open(os.path.join(proj, "exact_max.bin"), "wb") as fh:  # 恰好等于上限：不算超限
            fh.truncate(MAX)
        with open(os.path.join(out_dir, "secret.txt"), "wb") as fh:
            fh.write(b"TOPSECRET")
        try:
            os.symlink(os.path.join(out_dir, "secret.txt"), os.path.join(proj, "ln_out.txt"))
            os.symlink(os.path.join(proj, "a.txt"), os.path.join(proj, "ln_in.txt"))
            os.symlink(out_dir, os.path.join(proj, "dir_out"), target_is_directory=True)
            # 断链：指向仓外**不存在**的文件。realpath 对它要跟随链接到目标路径（不存在也照算），判出仓；
            # TS 的 realpathSync 对它抛 ENOENT，退到上一级求真实路径会把它当成仓内——这个缺口是检查器迁移（entry_budget 的自检）时才暴露的
            os.symlink(os.path.join(out_dir, "no-such.md"), os.path.join(proj, "ln_out_dangling.md"))
            os.symlink(os.path.join(proj, "no-such-inside.md"), os.path.join(proj, "ln_in_dangling.md"))
            os.symlink(os.path.join(out_dir, "no-such-dir", "deeper.md"), os.path.join(proj, "ln_out_dangling_deep.md"))
            os.symlink("ln_out_dangling.md", os.path.join(proj, "ln_chain_to_dangling.md"))      # 链到断链
            os.symlink("ln_chain_loop_b.md", os.path.join(proj, "ln_chain_loop_a.md"))            # 循环链
            os.symlink("ln_chain_loop_a.md", os.path.join(proj, "ln_chain_loop_b.md"))
            os.symlink("../outside/secret.txt", os.path.join(proj, "ln_rel_out.md"))              # 相对路径出仓
            manifest["symlink"] = True
        except OSError:
            pass

        P = lambda n: os.path.join(proj, n)
        res = {"read_bytes": {}, "read_bytes_head4": {}, "read_text": {}, "read_text_head5": {}, "count_lines": {}, "inside": {}, "guard": {}}
        names = [n for n, _ in FILES] + ["d", "nope", "big_sparse.bin", "big_lines.txt", "exact_max.bin"]
        if manifest["symlink"]:
            names += ["ln_out.txt", "ln_in.txt", "dir_out/secret.txt", "ln_out_dangling.md", "ln_in_dangling.md", "ln_out_dangling_deep.md",
                      "ln_chain_to_dangling.md", "ln_chain_loop_a.md", "ln_chain_loop_b.md", "ln_rel_out.md"]
        for n in names:
            res["read_bytes"][n] = call(lambda n=n: hexed(sl.read_bytes(P(n), proj)))
            res["read_bytes_head4"][n] = call(lambda n=n: hexed(sl.read_bytes(P(n), proj, head=4)))
            res["read_text"][n] = call(lambda n=n: sl.read_text(P(n), proj)[:200] if len(sl.read_text(P(n), proj)) < 5000 else {"len": len(sl.read_text(P(n), proj))})
            res["read_text_head5"][n] = call(lambda n=n: sl.read_text(P(n), proj, head=5))
            res["count_lines"][n] = call(lambda n=n: sl.count_lines(P(n), proj))
        # 字面出仓（不碰文件系统）与 root 本身、不存在、仓外绝对路径
        literal = {"../x": os.path.join(proj, "..", "x"), "outside_abs": os.path.join(out_dir, "secret.txt"), "proj_itself": proj, "inner_missing": P("nope/deeper")}
        for k, p in literal.items():
            res["inside"][k] = call(sl.inside, proj, p)
            res["read_bytes"]["<literal> " + k] = call(lambda p=p: hexed(sl.read_bytes(p, proj)))
            res["guard"][k] = call(lambda p=p: bool(sl.guard(proj, p)))
        for n in names:
            res["inside"][n] = call(sl.inside, proj, P(n))
            res["guard"][n] = call(lambda n=n: bool(sl.guard(proj, P(n))))
        # root=None：不做仓内判定（调用方自己负责），只读常规文件
        res["read_bytes_noroot"] = {n: call(lambda n=n: hexed(sl.read_bytes(P(n)))) for n in ("a.txt", "d", "nope")}
        res["_manifest"] = manifest
        res["_max_read_bytes"] = MAX
        path = os.path.join(HERE, "unit", "stdlib-fs.json")
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(res, fh, ensure_ascii=False, indent=1, sort_keys=True); fh.write("\n")
        back = json.load(open(tmp, encoding="utf-8"))
        count = lambda d: sum(len(v) for k, v in d.items() if isinstance(v, dict) and not k.startswith("_"))
        if count(back) != count(res) or back["_manifest"] != manifest:
            sys.exit("回读与内存不一致，拒绝落盘")
        os.replace(tmp, path)
        total = count(res)
        print("写出 %s：%d 条；符号链接可用=%s；platform=%s" % (os.path.relpath(path, os.path.dirname(HERE)), total, manifest["symlink"], sys.platform))
    finally:
        shutil.rmtree(base, ignore_errors=True)


if __name__ == "__main__":
    main()
