#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 stdlib 各纯函数的单元黄金样本：对一批输入记录 Python 版的**完整输出**（含抛出的异常类型与信息）。

TS 版的单元测试读这些 JSON 逐条比对。与 golden/make_golden.py 的区别：那个比「整个检查器对整个仓库的 finding 集合」，
这个比「单个函数对单个输入」——后者定位问题快一个数量级（一条输入一条断言），前者才能证明端到端一致。两者都要。

输入的来源：①stdlib 自己 selftest 里已有的样本（它们各自来自一次实测缺陷）；②边界补充（空串、BOM、CRLF、制表符、极长行、深嵌套）。
输出确定性：不含时间、路径、提交号。用法：python golden/make_unit.py
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "tools", "std"))
import stdlib as sl


def call(fn, *args, **kw):
    try:
        return {"ok": fn(*args, **kw)}
    except Exception as exc:  # noqa: BLE001 —— 异常本身就是要记录的行为
        return {"raised": type(exc).__name__, "message": str(exc)}


YAML_INPUTS = [
    # ---- stdlib selftest 里已有的（每条来自一次实测误读，D-123）----
    "tier: L1\n",
    "---\ntier: L1\n",
    "a:\n  - name: x\n    path:",
    'x: "a # b" # c\n',
    "reason: don't do it # 注释\n",
    '"tier": L1\n',
    "a:\n  - \"a: b\"\n  - https://x\n",
    "tier: L1\nTOPSECRET-LINE\n",
    "tier: L1\nlayout:\n  entry:\n    - ../outside/secret.md\n",
    "tier: L1\nlayout:\n  frozen: docs/archive\n",
    "tier: L1\ntailoring:\n  check: layout\n  applicable: false\n",
    "tier: L1\nrepos:\n  - name: a\n    path: .\n    former_names: b\n",
    # ---- 边界补充 ----
    "", "\n", "   \n  \n", "# 只有注释\n", "\ufefftier: L1\n", "tier: L1\r\nlayout:\r\n  entry:\r\n    - A.md\r\n",
    "a:\n\tb: 1\n", "a: 1\na: 2\n", "a:\n  b: 1\n  b: 2\n", "a: [x]\n", "a: {x: 1}\n", "a: &x 1\n", "a: |\n  text\n", "a: >\n  text\n",
    "a: !tag x\n", "a: %x\n", "a: @x\n", "a: `x`\n", "a: \"un closed\n", "a: 'it''s'\n", 'a: "has \\ backslash"\n',
    "a: true\nb: Yes\nc: ON\nd: false\ne: no\nf: off\n", "a: null\nb: ~\n", "a: -12\nb: 3.5\nc: -0.5\nd: 1e3\n", "a: 007\n", "a: 1_000\n",
    "a: x: y\n", "a: http://x\n", "a: b: c\n", "- a\n- b\n", "- a: 1\n  b: 2\n- c: 3\n", "- []\n", "- \n", "a: []\n", "a: [ ]\n",
    "a:\n- b\n", "a:\n  - b\n  c: 1\n", "a:\n    - b\n  - c\n", "a:\n  b:\n    c:\n      d: 1\n", "key with spaces: 1\n", ": 1\n", "a:b\n",
    "a: 1 # c\nb: 2\n", "a: 1\n  b: 2\n", "  a: 1\n  b:\n    c: 2\n", "a:\n  - x\n  - y\nb: z\n", "a:\n  -\n",
    "layout:\n  entry:\n    - A.md\n    - B.md\n  docs_root: docs\n",
    "metadata_required:\n  - docs/a\n  - \"!docs/x\"\n",
    "a: !docs/x\n",
    # ---- 变异验证发现的盲区（TS 版对应变异没被抓住）：列表项内的重复键与缩进不一致 ----
    "- a: 1\n  a: 2\n", "x:\n  - a: 1\n    a: 2\n", "- a: 1\n    b: 2\n", "x:\n  - a: 1\n      b: 2\n", "- a: 1\n b: 2\n",
    "- a: 1\n  b:\n    c: 2\n  d: 3\n", "- a: 1\n  b:\n  c: 2\n", "- a: 1\n  b:\n- c: 2\n", "- a: 1\n  b: 2\n  c:\n    - d\n    - e\n",
    # BOM 与全角空格出现在值里、键里、行首（Python 的 strip 保留 U+FEFF 但去 U+3000，设计 §12.6 D6）
    "tier: \ufeffL1\n", "a: \ufeff\n", "\u3000a: 1\n", "a:\u3000b\n", "a: \u3000\n", "a:\u00a0b\n", "a: b\u3000\n", "- \ufeffx\n", "-\u3000x\n",
    "a\u2028b: 1\n", "a: 1\u2028b: 2\n", "a: 1\x85b: 2\n", "a: 1\x1cb: 2\n", "a: 1\vb: 2\n", "a: 1\fb: 2\n", "a: 1\rb: 2\n",
    # JS 特有的坑：键是被扫方写的任意字符串，`__proto__` 在 JS 里直接赋值会改原型或被吞掉，Python 的 dict 里它只是普通键
    "__proto__: x\n", "__proto__:\n  a: 1\n", "a:\n  __proto__: 1\n", "- __proto__: 1\n  b: 2\n", "- b: 2\n  __proto__: 1\n",
    "constructor: 1\ntoString: 2\nhasOwnProperty: 3\nvalueOf: 4\n", "__proto__: 1\n__proto__: 2\n", "a:\n  - __proto__: x\n    __proto__: y\n",
]
# 深嵌套与极长行（性能与递归上限）
YAML_INPUTS.append("".join("%sk%d:\n" % ("  " * i, i) for i in range(1200)) + "  " * 1200 + "v: 1\n")
YAML_INPUTS.append("a: " + " " * 100000 + "\n")
YAML_INPUTS.append("a: " + "'" * 50000 + "\n")
YAML_INPUTS.append("- " * 2000 + "x\n")


def main():
    out = {"yaml": [], "scalar_edge": [], "strip_comment": [], "parse_date": [], "normalize_key": [], "finding_id": []}
    for text in YAML_INPUTS:
        label = text if len(text) < 200 else "<长输入 len=%d sha1-prefix=%s>" % (len(text), __import__("hashlib").sha1(text.encode("utf-8")).hexdigest()[:10])
        out["yaml"].append({"input": label, "input_len": len(text), "result": call(sl.parse_yaml_subset, text)})
    for raw in ["", "a # b", "a#b", "'a # b' # c", "x: \"a # b\"", "don't # 注释", "- 'q' # c", " # lead", "a \t# tab", '"a" "b" # c', "a: 'x # y' # z"]:
        out["strip_comment"].append({"input": raw, "result": call(sl._strip_comment, raw)})
    for raw, strict in [("2026-10-06", False), ("2026-10-06T10:00:00Z", False), ("2026-10-06T10:00:00+08:00", False), ("**2026-10-06**", False),
                        ("`2026-10-06`", False), ("2026-10-06 之前", False), ("2026-10-06 之前", True), ("2026-13-45", False), ("", False), ("  ", False),
                        ("2026-1-6", False), ("20261006", False), ("2026-10-06T25:00:00", False), ("2026-02-30", False), ("2024-02-29", False), ("2026-10-06z", False),
                        ("1900-02-29", False), ("2000-02-29", False), ("2100-02-29", False), ("2024-02-29", True), ("2023-02-29", True), ("2026-04-31", False),
                        ("2026-06-31", True), ("2026-12-31", True), ("2026-01-00", False), ("0000-01-01", False), ("9999-12-31", False), ("2026-10-06 10:00", False),
                        ("2026-10-06 10:00", True), ("2026-10-06T10:00:00+0800", True), ("2026-10-06T10:00:00+08", True), ("2026-10-06T10:60:00", True),
                        ("2026-10-06T10:00:60", True), ("2026-10-06T10:00:00.5Z", True), ("2026-10-06T24:00:00", True), ("2026-10-06T10:00:00-23:59", True)]:
        out["parse_date"].append({"input": raw, "strict": strict, "result": call(lambda r=raw, s=strict: [str(x) if x is not None else None for x in sl.parse_date(r, s)])})
    for raw in ["a b", "  a\n b  ", "a|b", "a｜b", "中 文", "", "a\t\tb"]:
        out["normalize_key"].append({"input": raw, "result": call(sl.normalize_key, raw)})
    for args in [("c", "t", None, None), ("c", "t", "k", None), ("c", "t", "k", "a b"), ("c", "t", "k", "  "), ("c", "t", "k", "a|b"), ("c", "中文标题", None, None),
                 ("c", "t\udcff", None, None)]:
        def _safe(a):
            if isinstance(a, str) and any(0xD800 <= ord(c) <= 0xDFFF for c in a):
                # JSON/UTF-8 编不出孤立代理字符。记原样的 \u 转义形式（TS 的 JSON.parse 能还原成同一个 UTF-16 单元）
                return {"surrogate_escaped": "".join(("\\u%04x" % ord(c)) if 0xD800 <= ord(c) <= 0xDFFF else c for c in a)}
            return a
        out["finding_id"].append({"args": [_safe(a) for a in args], "result": call(sl.finding_id, *args)})
    path = os.path.join(HERE, "unit", "stdlib-pure.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True); fh.write("\n")
    n = sum(len(v) for v in out.values())
    back = json.load(open(tmp, encoding="utf-8"))
    if sum(len(v) for v in back.values()) != n:
        sys.exit("写出的文件回读条数与内存不符，拒绝落盘")
    os.replace(tmp, path)                      # 原子替换：中途崩溃不会留下半个目标文件
    kinds = {}
    for it in out["yaml"]:
        k = "ok" if "ok" in it["result"] else it["result"]["raised"]
        kinds[k] = kinds.get(k, 0) + 1
    print("写出 %s：%d 条；yaml 结果分布 %s" % (os.path.relpath(path, os.path.dirname(HERE)), n, kinds))


if __name__ == "__main__":
    main()