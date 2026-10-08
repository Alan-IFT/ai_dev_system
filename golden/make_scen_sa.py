#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""single_authority 的整仓场景黄金样本：每个场景造一个小 git 仓，记 Python 版 run() 的**完整**输出（id、status、where、title、reason、why、evidence）。
为什么要这份：变异验证第一轮漏了 78 条，绝大多数是「多文件整体行为」——排序次序（码点 vs 码元）、单类上限与「共 N 组」汇总、块的延长与覆盖、读不了/已删/出仓软链接的分流、
派生声明的各种形态。这些靠单行的纯函数样本钉不住。TS 版回放同一批场景，逐字段比对（test/sa-scenarios.test.mjs）。
文件内容的两种特殊写法：{"rep":[字符, 字节数]} 重复字符造大文件；{"seq":[行数, 附加行]} 造很长的共有块（TS 侧有同一份生成函数，见测试）。
用法：python golden/make_scen_sa.py
"""
import base64
import importlib.util
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
STD = os.path.join(os.path.dirname(HERE), "tools", "std")
sys.path.insert(0, STD)
import stdlib as sl  # noqa: E402

spec = importlib.util.spec_from_file_location("check_sa", os.path.join(STD, "checks", "check_single_authority.py"))
sa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sa)

CH = list("甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往")  # 40 个，辰重复无妨：tag 用三位组合保证唯一
E = "\U0001f600"


def tag(i):
    return CH[i % 40] + CH[(i // 40) % 40] + CH[(i // 1600) % 40]  # 三位 40 进制，64000 种互不相同（第三位若由 i%40 决定，只有 1600 种）


def seq_lines(n, salt=0):
    # 每行 ≥ 24 个有效字符（窗口 3 行 ≥ 60 才进比对）
    return ["".join([tag(salt + i), "内容", tag(salt + i * 3 + 1), "说明", tag(salt + i * 5 + 2), "记录", tag(salt + i * 11 + 4), "备注", tag(salt + i * 13 + 5), "结尾"]) for i in range(n)]


def uniq(k):
    """一份与任何别的文件都不共享行的文档：三行，每行都带自己的 k。"""
    return "# 文%s\n\n独占%s篇第一句说明%s，此文件专属内容。\n独占%s篇第二句说明%s，此文件专属内容。\n独占%s篇第三句说明%s，此文件专属内容。\n" % (
        tag(5000 + k), tag(5000 + k), tag(6000 + k), tag(7000 + k), tag(8000 + k), tag(9000 + k), tag(9500 + k))


def para(i, n=3):
    """n 行共有段落，每行 ≥ 20 个有效字符，不含数字。"""
    return "".join("%s模块负责处理%s类事务并留存%s记录，写入口唯一。\n" % (tag(100 + i * 10 + j), tag(200 + i * 10 + j), tag(300 + i * 10 + j)) for j in range(n))


def build(root, files, ops, outside):
    for rel, content in files:
        p = os.path.join(root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        if isinstance(content, str):
            data = content.encode("utf-8")
        elif "b64" in content:
            data = base64.b64decode(content["b64"])
        elif "rep" in content:
            data = content["rep"][0].encode("utf-8") * content["rep"][1]
        else:
            data = ("\n".join(seq_lines(*content["seq"][:1]) + [content["seq"][1]]) + "\n").encode("utf-8")
        open(p, "wb").write(data)
    for op in ops:
        if op["op"] == "symlink":
            continue
    # 软链接先建（要进 git 索引）
    for op in ops:
        if op["op"] == "symlink":
            tgt = os.path.join(outside, op["target"])
            if op["kind"] == "dir":
                os.makedirs(tgt, exist_ok=True)
                open(os.path.join(tgt, "in.md"), "w", encoding="utf-8").write("# 仓外\n")
            os.symlink(tgt, os.path.join(root, op["path"]), target_is_directory=op["kind"] == "dir")
    sl.git_track(root)
    for op in ops:
        if op["op"] == "delete":
            os.remove(os.path.join(root, op["path"]))
        elif op["op"] == "replace_with_dir":
            os.remove(os.path.join(root, op["path"]))
            os.makedirs(os.path.join(root, op["path"]))


def scenario(name, files, extra=None, ops=None, note=""):
    ops = ops or []
    tmp = tempfile.mkdtemp(prefix="scn-")
    outside = tempfile.mkdtemp(prefix="scn-out-")
    try:
        root = os.path.join(tmp, "r")
        os.makedirs(root)
        try:
            build(root, files, ops, outside)
        except OSError as exc:
            print("跳过场景 %s：%s" % (name, exc))
            return None
        cfg = {"_root": root, "layout": {"frozen": []}}
        cfg.update(extra or {})
        res = sa.run(cfg)
        rows = [{k: (f.get(k) if k == "where" else (f.get(k) or "")) for k in ("id", "status", "where", "title", "reason", "why", "evidence")} for f in res]
        for r in rows:
            for k in ("reason", "why", "evidence", "title"):
                if tmp in r[k] or outside in r[k]:
                    sys.exit("场景 %s 的输出里带了临时路径，不可比：%s" % (name, r[k][:100]))
        return {"name": name, "note": note, "files": [[r, c] for r, c in files], "cfg": extra or {}, "ops": ops, "out": rows}
    finally:
        for d in (tmp, outside):
            for dp, dn, fn in os.walk(d):
                for x in dn + fn:
                    try:
                        os.chmod(os.path.join(dp, x), 0o666)
                    except OSError:
                        pass
            shutil.rmtree(d, ignore_errors=True)


S = []

# ---- 逐字节相同：组与组内的次序（码点 vs 码元）、有效字符门槛 ----
B1, B2, B3 = uniq(1), uniq(2), uniq(3)
S.append(scenario("ident-order", [("～x.md", B1), ("～y.md", B1), ("😀x.md", B2), ("😀y.md", B2), ("a.md", B3), ("～z.md", B3), ("😀z.md", B3), ("solo.md", uniq(4))],
                  note="组按首路径码点排序（～ U+FF5E 在 😀 U+1F600 之前，码元序相反）；组内路径按码点（git ls-files 的字节序即码点序）"))
cj = lambda base, n: "".join(chr(base + i) for i in range(n))
S.append(scenario("ident-threshold", [
    ("e20a.md", cj(0x4e00, 20) + "\n"), ("e20b.md", cj(0x4e00, 20) + "\n"),
    ("e19a.md", cj(0x4e50, 19) + "\n"), ("e19b.md", cj(0x4e50, 19) + "\n"),
    ("emo10a.md", E * 10 + "\n"), ("emo10b.md", E * 10 + "\n"),
    ("emo20a.md", "\U0001f601" * 20 + "\n"), ("emo20b.md", "\U0001f601" * 20 + "\n")],
    note="有效字符恰 20 → 成组，19 → 不成组；10 个 emoji 是 10 个码点（码元 20）→ 不成组；20 个 emoji → 成组"))
S.append(scenario("ident-rep", [("a.md", uniq(10) + para(1)), ("a2.md", uniq(10) + para(1)), ("b.md", uniq(11) + para(1))],
                  note="逐字节相同的组留第一个做代表参与块比对：代表与第三个文件共有的段落照报"))

# ---- 块：延长、覆盖、阈值、窗口字符数、分隔符 ----
P6, P5, P4 = para(20, 6), para(21, 5), para(22, 4)
p4_lines = P4.splitlines(True)
S.append(scenario("blocks-extend", [("x.md", uniq(20) + P6), ("y.md", uniq(21) + P6), ("u.md", uniq(22) + P5), ("v.md", uniq(23) + P5),
                                    ("a4.md", uniq(24) + P4), ("b4.md", uniq(25) + P4), ("c4.md", uniq(26) + "".join(p4_lines[1:]) + "另有一句只属于丙四的收尾说明文字。\n")],
                  note="6 行与 5 行的共有段落延长到全长；4 行段落的后三行又出现在第三个文件：第一个窗口覆盖 a4/b4 后，第二窗口 a4/b4 已覆盖而 c4 未覆盖→照报"))
L = lambda base: [cj(base + 20 * k, 20) for k in range(3)]
w60, w59 = L(0x5000), L(0x5100)
w59[2] = w59[2][:19]
emo = ["\U0001f602" * 15, "\U0001f603" * 15, "\U0001f604" * 15]
P_, Q_, R_ = cj(0x6000, 20), cj(0x6020, 20), cj(0x6040, 20)
S.append(scenario("blocks-width", [
    ("w60a.md", uniq(60) + "\n".join(w60) + "\n"), ("w60b.md", uniq(61) + "\n".join(w60) + "\n"), ("w59a.md", uniq(62) + "\n".join(w59) + "\n"), ("w59b.md", uniq(63) + "\n".join(w59) + "\n"),
    ("emoa.md", uniq(64) + "\n".join(emo) + "\n"), ("emob.md", uniq(65) + "\n".join(emo) + "\n"),
    ("sepx.md", uniq(66) + "\n".join([P_, Q_, R_]) + "\n"), ("sepy.md", uniq(67) + "\n".join([P_[:10], P_[10:] + Q_, R_]) + "\n")],
    note="窗口有效字符恰 60 → 报，59 → 不报；3 行各 15 个 emoji 是 45 个码点（码元 90）→ 不报；行界不同而拼起来相同的两份不是重复（哈希拼接要带分隔符）"))
long_first = cj(0x7000, 79) + E + cj(0x7100, 30)
S.append(scenario("blocks-firstline", [("lf1.md", uniq(30) + long_first + "\n" + para(30, 2)), ("lf2.md", uniq(31) + long_first + "\n" + para(30, 2))],
                  note="首行 > 80 个码点且第 80 个码点是 emoji：取前 80 个码点（按码点、不是码元）"))
S.append(scenario("blocks-bom-start", [("bs_x.md", "\ufeff" + para(45, 5)), ("bs_y.md", para(45, 5))],
                  note="文件**开头**的 BOM 保留在第一行里：x 的第一行带 BOM、y 的不带，所以第一个窗口不等，共有块从第 2 行起、长 4 行（若解码时把开头 BOM 吃掉，会变成从第 1 行起、长 5 行）"))
S.append(scenario("blocks-places-order", [("～b.md", uniq(46) + para(46)), ("😀b.md", uniq(47) + para(46)), ("a.md", uniq(48) + para(46))],
                  note="一个共有块的出现位置按文件路径的码点序排：git 给的次序是 a.md、～b.md、😀b.md（字节序）；按 UTF-16 码元排会把 😀 排到 ～ 前面"))
S.append(scenario("blocks-seq2100", [("big1.md", {"seq": [2100, ""]}), ("big2.md", {"seq": [2100, "只属于第二份的最后一行说明文字。"]})],
                  note="很长的共有块：延长到块长度上限为止"))
S.append(scenario("blocks-bom", [("bomx.md", uniq(41) + "\ufeff" + para(40)), ("bomy.md", uniq(42) + "\ufeff" + para(40)), ("bomz.md", uniq(43) + para(40)), ("bomw.md", uniq(44) + para(40))],
                  note="BOM 保留在所在行里（Python 的 utf-8 不是 utf-8-sig）：x、y 的共有段落第一行都带 BOM，z、w 的不带；x/y 与 z/w 之间窗口不等"))

# ---- 上限与汇总 ----
pairs = []
for i in range(31):
    pairs += [("bx%02d.md" % i, uniq(100 + i) + para(50 + i)), ("by%02d.md" % i, uniq(200 + i) + para(50 + i))]
S.append(scenario("caps-doc-blocks-31", pairs, note="31 组文档里的共有段落：只列 30 条，溢出 1 条"))
claims31 = "".join("共有 %d 份%s%s记录\n" % (100 + j, CH[j % 40], CH[(j * 3 + 1) % 40]) for j in range(31))
S.append(scenario("caps-doc-claims-31", [("c%d.md" % k, uniq(300 + k) + claims31) for k in range(3)], note="31 组数值声明：只列 30 条，溢出 1 条"))


def code_block(name, k):
    return "".join("value_%s_%s_alpha = compute_%s_%s_beta(argument_%s_%s)\n" % (name, "xyz"[j], name, "xyz"[j], name, "xyz"[j]) for j in range(3))


names = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta"]
for n in (5, 7):
    fl = [("readme.md", uniq(400 + n))]
    for gi in range(n):  # 两份不能逐字节相同（否则被判据 1 吃掉）：各带一行只属于自己的收尾
        fl += [("m%d_a.py" % gi, code_block(names[gi], 0) + "only_a_%s = 1\n" % tag(950 + gi)), ("m%d_b.py" % gi, code_block(names[gi], 0) + "only_b_%s = 2\n" % tag(970 + gi))]
    S.append(scenario("code-blocks-%d" % n, fl, note="全部出现位置都在非文档文件的重复块 %d 组：汇总成一条 SKIP，代表位置最多 5 个，超过 5 组写「共 N 组，只列前 5 组」" % n))

KN = ["归档", "账本", "规则", "文件", "报表", "模板", "条目"]
for n in (5, 7):
    def body_of(k):
        b = "# 文件序号 %s\n" % tag(900 + k)
        for gi in range(n):
            b += "x%d_%s = 1\n" % (gi, tag(910 + k * 7 + gi))
            b += 'y = "共有 %d 份%s记录"\n' % (200 - gi * 17, KN[n - 1 - gi])
        return b
    S.append(scenario("code-claims-%d" % n, [("readme.md", uniq(500 + n))] + [("c%d.py" % k, body_of(k)) for k in range(3)],
                      note="数值声明的全部出现位置都在非文档文件 %d 组：汇总成一条 SKIP；代表位置取每组排序后的第一个文件，再整体按码点排序" % n))

# ---- 数值声明的排序与位置 ----
names5 = ["k", "k-j.md", "k.md", "x～.md", "x😀.md"]
suf = ["甲乙", "丙丁", "戊己", "庚辛", "壬癸"]
claim_lines = lambda s: [
    "共 99 份归档%s" % s, "共 20 份归档%s" % s, "共 100 份归档%s" % s, "[共 66 项记录 [x](y.md)", "共 20 个归档%s" % s, "共 20 份账本%s" % s, "共 30 条规则%s" % s, "共 77 轮评审%s" % s, "共 55 个BCd%s" % s,
    "共 40 张表格%s" % s, "共 45 位同事%s" % s, "共 61 [括号 [x](y) 内数值%s" % s, "共 71 个abc%s" % s, "共 88 个ABC%s" % s]
S.append(scenario("claims-order", [(nm, uniq(600 + i) + "\n".join(claim_lines(suf[i])) + "\n") for i, nm in enumerate(names5)],
                  note="数值声明按 (量词, 名词前两字, 数字) 的码点序排列；位置字符串按码点排序（'k-j.md:N' < 'k.md:N' < 'k:N'；～ 在 😀 之前）；标题样本取第一个文件"))

# ---- 派生声明与排除 ----
sharedD = para(63)
dfiles = [(".hidden/x.md", uniq(700) + sharedD), ("docs/gen.html", uniq(701) + sharedD), ("null", uniq(702) + sharedD), ("None", uniq(703) + sharedD), ("0", uniq(704) + sharedD), ("false", uniq(705) + sharedD),
          ("a.md", uniq(706) + sharedD), ("b.md", uniq(707) + sharedD), ("frz/z.md", uniq(708) + sharedD), ("keep.md", uniq(709) + sharedD)]
S.append(scenario("derived-shapes", dfiles, extra={"layout": {"frozen": ["frz"]}, "derived": [
    {"artifact": ".hidden/x.md"}, {"artifact": "docs\\gen.html"}, {"artifact": None}, {"artifact": ""}, {"artifact": 0}, {"artifact": False}, "text", ["artifact"], {"artifact": "./a.md"}, {"x": 1}]},
    note="派生声明：开头的 ./ 与 . 去掉（字符集不是前缀）、反斜杠归一、空/假值/非映射条目忽略（None 不会被当成文件名 'None'）；frozen 目录排除"))
S.append(scenario("derived-mapping", [("a.md", uniq(712) + para(60)), ("b.md", uniq(713) + para(60))], extra={"derived": {"artifact": "a.md"}}, note="derived 是映射而不是列表：忽略（Python 的 for 会遍历映射的键，键是字符串、不是映射，所以也被忽略）"))
S.append(scenario("derived-strings", [("a.md", uniq(714) + para(61)), ("b.md", uniq(715) + para(61)), ("c.md", uniq(716) + para(61)), ("7", uniq(717) + para(61)), ("None", uniq(718) + para(61))], extra={"derived": ["a.md", {"artifact": "b.md"}, 7, None, {"artifact": 7}, {"artifact": None}]}, note="derived 列表里混着字符串、数字、None：只认映射"))
S.append(scenario("derived-notlist", [("a.md", uniq(710) + para(62)), ("b.md", uniq(711) + para(62))], extra={"derived": "a.md"}, note="derived 不是列表：忽略"))

# ---- 读不了、已删、出仓、超大 ----
big = {"rep": ["x", 3 * 1024 * 1024]}
S.append(scenario("unreadable-mix", [("a.md", uniq(800)), ("b.md", uniq(801)), ("deleted.md", uniq(802)), ("big1.md", big), ("big2.md", big)],
                  ops=[{"op": "symlink", "path": "ext_file.md", "target": "gone.md", "kind": "file"}, {"op": "symlink", "path": "ext_dir", "target": "outdir", "kind": "dir"},
                       {"op": "delete", "path": "deleted.md"}],
                  note="出仓软链接（文件、目录）→ 读不了（OutsideRoot）；已删未提交 → 不记；超大 → too-big；读不了与超大的汇总先后与计数。（文件被换成目录的那条随平台变——Windows 抛 PermissionError 算读不了，POSIX 判 NotRegular+isdir 算不在——不进跨平台样本，见 check-single-authority.test.mjs）"))
S.append(scenario("big-10", [("a.md", uniq(810))] + [("bg%02d.md" % i, big) for i in range(10)], note="恰 10 个超大：路径全列，不写「另有」"))
S.append(scenario("big-11", [("a.md", uniq(811))] + [("bg%02d.md" % i, big) for i in range(11)], note="11 个超大：列前 10 个，另有 1 个"))

S = [s for s in S if s]
path = os.path.join(HERE, "unit", "sa-scenarios.json")
tmpf = path + ".tmp"
with open(tmpf, "w", encoding="utf-8", newline="\n") as fh:
    json.dump({"python": sys.version.split()[0], "scenarios": S}, fh, ensure_ascii=False, indent=1)
    fh.write("\n")
back = json.load(open(tmpf, encoding="utf-8"))
if len(back["scenarios"]) != len(S):
    sys.exit("回读与内存不一致，拒绝落盘")
os.replace(tmpf, path)
print("写出 golden/unit/sa-scenarios.json：%d 个场景，%d KB" % (len(S), os.path.getsize(path) // 1024))
for s in S:
    print("  %-22s %2d 条输出  %s" % (s["name"], len(s["out"]), " ".join("%s" % o["status"][0] for o in s["out"])[:60]))
