#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""cross_repo 的整仓场景黄金样本：每个场景造一组小仓目录（可带 .git 空目录、真 git 仓），记 Python 版 run() 的**完整**输出（id、status、where、title、reason、why、evidence），
以及纯函数 _name_appears / _has_status_token / _has_invalidation_marker / _link_targets / _parse_grep_z / _load_repos 的输出。TS 版回放同一批输入逐字段比对。
入口文件统一叫 AGENTS.md，不用 CLAUDE.md（该宿主已废弃；Python 版的入口名由 layout.entry 配置，不是写死的，所以换名对输出无影响）。
**有意差异不进样本**：退役仓默认规则文件清单 Python 版是 [.harness/rules/, .claude/, AGENTS.md, CLAUDE.md]，TS 去掉 .claude/ 与 CLAUDE.md；
所以所有退役仓场景都**显式写 layout.rule_files**（等于不走默认清单），默认清单这一项在 test/check-cross-repo.test.mjs 里单独断言。
用法：python golden/make_scen_cr.py
"""
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
STD = os.path.join(os.path.dirname(HERE), "tools", "std")
sys.path.insert(0, STD)
import stdlib as sl  # noqa: E402

spec = importlib.util.spec_from_file_location("check_cr", os.path.join(STD, "checks", "check_cross_repo.py"))
cr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cr)

E = "\U0001f600"
RULES = [".harness/rules/", "AGENTS.md"]
KEYS = ("id", "status", "where", "title", "reason", "why", "evidence")


def ent(name, role, **kw):
    d = {"name": name, "path": name, "role": role}
    d.update(kw)
    return d


def scenario(name, note, files, repos, layout=None, git=(), extra=None, ops=()):
    tmp = tempfile.mkdtemp(prefix="scr-")
    try:
        root = os.path.join(tmp, "w")
        os.makedirs(root)
        for rel, body in files:
            p = os.path.join(root, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "wb") as fh:
                fh.write(body.encode("utf-8") if isinstance(body, str) else body)
        for d in git:  # 真 git 仓（git grep 只看索引）
            for arg in (["init", "-q"], ["add", "-A", "-f"]):
                subprocess.run(["git", "-C", os.path.join(root, d), "-c", "core.autocrlf=false", "-c", "core.safecrlf=false"] + arg, capture_output=True, timeout=60)
        for op in ops:
            if op[0] == "mkdir":
                os.makedirs(os.path.join(root, op[1]), exist_ok=True)
            elif op[0] == "symlink_file":  # ("symlink_file", 链接相对路径, 目标相对路径)：文件符号链接，目标可以不存在（悬空）
                os.makedirs(os.path.dirname(os.path.join(root, op[1])), exist_ok=True)
                os.symlink(os.path.join(root, op[2]), os.path.join(root, op[1]))
            elif op[0] == "symlink_dir":  # ("symlink_dir", 链接相对路径, 目标相对路径)：目录符号链接（os.walk 不跟随；Windows 上要权限，不可创建则整个脚本报错——本机可创建）
                os.symlink(os.path.join(root, op[2]), os.path.join(root, op[1]), target_is_directory=True)
        lay = {"entry": ["AGENTS.md"], "rule_files": RULES}
        lay.update(layout or {})
        cfg = {"_root": root, "layout": lay, "repos": repos}
        cfg.update(extra or {})
        res = cr.run(cfg)
        rows = [{k: (f.get(k) if k == "where" else (f.get(k) or "")) for k in KEYS} for f in res]
        for r in rows:
            for k in KEYS:
                if k != "where" and tmp in r[k]:
                    # evidence 里带了绝对路径（判据二的 PASS 证据 / 缺入口的「在 X 下找过」）：归一成占位，TS 侧同样归一
                    r[k] = r[k].replace(os.path.join(root).replace("\\", "/"), "<ROOT>").replace(root, "<ROOT>")
                    # <ROOT> 之后的路径分隔符随平台（Windows 反斜杠、POSIX 斜杠）：统一成 /，样本才能跨平台比（设计 §12.3：黄金样本平台相关）。只动 <ROOT> 后面紧跟的路径片段
                    r[k] = re.sub(r"<ROOT>([^\s；）、:]*)", lambda m: "<ROOT>" + m.group(1).replace("\\", "/"), r[k])
                if k != "where" and tmp in r[k]:
                    sys.exit("场景 %s 的输出里仍带临时路径：%s" % (name, r[k][:120]))
        return {"name": name, "note": note, "files": [[r, (c if isinstance(c, str) else c.decode("latin-1"))] for r, c in files], "binary": [r for r, c in files if not isinstance(c, str)], "git": list(git), "cfg_layout": lay, "repos": repos, "extra": extra or {}, "ops": [list(o) for o in ops], "out": rows}
    finally:
        def _rw(func, path, exc):  # Windows 上 git 对象是只读的，rmtree 删不掉：去掉只读位再删
            os.chmod(path, 0o700)
            func(path)
        shutil.rmtree(tmp, onerror=_rw)


def gitdir(name):
    return (name + "/.git/HEAD", "ref: refs/heads/main\n")


S = []
SYS_OK = "# 系统仓\n\n本系统由这几个仓组成：sys（system）、app（active）、old（retired）。\n各仓状态见本文件。\n"
APP_OK = "# 应用仓 app\n\n本仓特有约束见下。系统级权威在 [系统仓](../sys/AGENTS.md)。\n"

# ---- 判据一：role ----
base3 = [gitdir("sys"), gitdir("app"), gitdir("old"), ("sys/AGENTS.md", SYS_OK), ("app/AGENTS.md", APP_OK), ("old/AGENTS.md", "# 老仓入口（已退役）\n\n本仓已退役，以下内容不再生效。\n")]
S.append(scenario("roles-ok", "恰好一个 system + 三仓都可定位 + 有入口 + 第一跳指向系统仓 + 状态已登记 + 退役仓已标失效", base3, [ent("sys", "system"), ent("app", "app"), ent("old", "retired")]))
S.append(scenario("roles-none", "没有 system → FAIL；role 写成别的 → bad-role 未定", base3, [ent("sys", "app"), ent("app", "app"), ent("old", "weird")]))
S.append(scenario("roles-two", "两个 system → FAIL（where 取第一个）", base3, [ent("sys", "system"), ent("app", "system"), ent("old", "retired")]))
S.append(scenario("roles-empty", "role 缺省（空）→ bad-role，列出 role = ''", base3, [{"name": "sys", "path": "sys"}, ent("app", "app"), ent("old", "retired")]))
S.append(scenario("roles-spaces", "name/path/role 两端空白去掉", base3, [{"name": " sys ", "path": " sys ", "role": " system "}, ent("app", "app"), ent("old", "retired")]))
S.append(scenario("roles-numeric-name", "name 是数字/布尔 → 转成 str", [gitdir("1"), gitdir("True"), ("1/AGENTS.md", "# 1 system\n"), ("True/AGENTS.md", "# T\n")], [ent(1, "system"), ent(True, "app")]))
S.append(scenario("repos-single", "repos 只有 1 项 → SKIP 单仓", base3, [ent("sys", "system")]))
S.append(scenario("repos-notlist", "repos 不是列表 → 未定", base3, "x"))
S.append(scenario("repos-notmap", "repos 第 2 项不是映射 → 未定", base3, [ent("sys", "system"), "x"]))
S.append(scenario("repos-noname", "第 1 项缺 name → 未定", base3, [{"name": "", "path": "sys"}, ent("app", "app")]))
S.append(scenario("repos-nopath", "非 archived 缺 path → 未定", base3, [{"name": "sys", "role": "system"}, ent("app", "app")]))
S.append(scenario("repos-path-zero", "path: 0 是假值，等于缺 path", base3, [{"name": "sys", "path": 0, "role": "system"}, ent("app", "app")]))
S.append(scenario("repos-dup", "重名 → 未定，写明两项序号与重名", base3, [ent("sys", "system"), ent("sys", "app")]))

# ---- 判据二：可定位 ----
S.append(scenario("reach-missing", "path 不存在 → 未定；目录在但无 .git → 未定", [gitdir("sys"), ("sys/AGENTS.md", SYS_OK), ("plain/AGENTS.md", "# p\n")], [ent("sys", "system"), {"name": "gone", "path": "nope", "role": "app"}, {"name": "plain", "path": "plain", "role": "app"}]))
S.append(scenario("reach-dot", "path: . 指向自己（当前仓）", [gitdir("."), ("AGENTS.md", SYS_OK), gitdir("app"), ("app/AGENTS.md", APP_OK)], [{"name": "sys", "path": ".", "role": "system"}, ent("app", "app")]))

# ---- 判据三：入口 ----
S.append(scenario("entry-missing", "仓没有入口 → FAIL，evidence 写在哪儿找过；archived 无检出 → SKIP", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK)], [ent("sys", "system"), ent("app", "app"), {"name": "arch", "role": "archived"}]))
S.append(scenario("entry-second-name", "layout.entry 多个候选，取第一个存在的", [gitdir("sys"), gitdir("app"), ("sys/README.md", SYS_OK), ("app/AGENTS.md", APP_OK)], [ent("sys", "system"), ent("app", "app")], layout={"entry": ["AGENTS.md", "README.md"]}))
S.append(scenario("entry-unset", "layout.entry 没配 → 未定", base3, [ent("sys", "system"), ent("app", "app")], layout={"entry": None}))

# ---- 判据四：投影 ----
S.append(scenario("proj-hop2", "入口里没有系统仓名，但链接到本仓另一份文件，那里有 → 第二跳 PASS", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK), ("app/AGENTS.md", "# app\n\n见 [规则](docs/rules.md)。\n"), ("app/docs/rules.md", "系统级权威在 sys 仓。\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("proj-hop2-fail", "第二跳也没有 → FAIL，写明跟随了几个链接", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK), ("app/AGENTS.md", "# app\n\n见 [规则](docs/rules.md) 与 [别处](docs/other.md#h)。\n"), ("app/docs/rules.md", "没有。\n"), ("app/docs/other.md", "也没有。\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("proj-link-into-sys", "入口里的相对链接解析进系统仓根 → PASS", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK), ("app/AGENTS.md", "# app\n\n权威：[读这里](../sys/docs/a.md)。\n"), ("sys/docs/a.md", "x\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("proj-token-dirname", "系统仓的目录名与 name 不同：入口提到目录名也算", [gitdir("sysdir"), gitdir("app"), ("sysdir/AGENTS.md", "# s\n\nsys（system）、app（active）\n"), ("app/AGENTS.md", "# app\n\n见 sysdir 仓。\n")], [{"name": "sys", "path": "sysdir", "role": "system"}, ent("app", "app")]))
S.append(scenario("proj-token-boundary", "记号边界：sys_x、sys-2、xsys 不算提到 sys；sys. 算", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK), ("app/AGENTS.md", "# app\n\nsys_x sys-2 xsys 都不算。\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("proj-token-unicode-boundary", "边界类只认 ASCII：٣sys、ésys、sysé 前后挡不住 → 算提到", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK), ("app/AGENTS.md", "# app\n\n٣sys\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("proj-two-systems", "系统仓不唯一 → 判据四与五各出未定/不出", base3, [ent("sys", "system"), ent("app", "system"), ent("old", "retired")]))
S.append(scenario("proj-abs-link", "绝对路径链接不跟随", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK), ("app/AGENTS.md", "# app\n\n见 [x](/etc/sys.md) 与 [y](http://sys.example/a.md)。\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("proj-hop2-cap", "第二跳最多跟随 60 个本仓内链接", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK), ("app/AGENTS.md", "# app\n\n" + "".join("[l%d](d/%d.md)\n" % (i, i) for i in range(70)))] + [("app/d/%d.md" % i, "无\n") for i in range(70)], [ent("sys", "system"), ent("app", "app")]))

# ---- 判据五：登记 ----
S.append(scenario("reg-missing", "系统入口没提某仓 → FAIL（列缺的 + 字符数/行数）", [gitdir("sys"), gitdir("app"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、app（active）。\n"), ("app/AGENTS.md", APP_OK), ("old/AGENTS.md", "已退役\n")], [ent("sys", "system"), ent("app", "app"), ent("old", "retired")]))
S.append(scenario("reg-nameonly", "只出现名字没有状态词 → name-only 未定（列命中行前 160 个码点）", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", "# s\n\nsys 是系统仓；app 在 [这里](../app/x.md)，" + "说明" * 90 + "。\n"), ("app/AGENTS.md", APP_OK)], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("reg-filesystem", "英文状态词按记号认：filesystem 不算 system", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", "# s\n\nsys（system）\napp 的 filesystem 说明\n"), ("app/AGENTS.md", APP_OK)], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("reg-many-bare", "未登记状态的仓超过 10 个只列前 10", [gitdir("sys"), ("sys/AGENTS.md", "# s\n\nsys（system）\n" + "".join("r%02d 在这里\n" % i for i in range(12)))] + [gitdir("r%02d" % i) for i in range(12)] + [("r%02d/AGENTS.md" % i, "[系统](../sys/AGENTS.md)\n") for i in range(12)], [ent("sys", "system")] + [ent("r%02d" % i, "app") for i in range(12)]))
S.append(scenario("reg-sys-noentry", "系统仓没有入口 → 判据五未定", [gitdir("sys"), gitdir("app"), ("app/AGENTS.md", APP_OK)], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("reg-emoji", "系统入口含 emoji：字符数按码点、命中行截取按码点", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", "# s " + E * 3 + "\n\nsys（system）\napp " + E * 100 + " 无状态\n"), ("app/AGENTS.md", APP_OK)], [ent("sys", "system"), ent("app", "app")]))

# ---- 判据六：退役仓 ----
S.append(scenario("retired-live", "退役仓规则未失效 → FAIL；where 取第一份", [gitdir("sys"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n"), ("old/AGENTS.md", "# 老\n\n规则。\n"), ("old/.harness/rules/00.md", "规则\n"), ("old/.harness/rules/sub/01.md", "规则\n")], [ent("sys", "system"), ent("old", "retired")]))
S.append(scenario("retired-marked", "都带失效标记 → PASS（证据写扫描清单）", [gitdir("sys"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n"), ("old/AGENTS.md", "本仓失效\n"), ("old/.harness/rules/00.md", "已归档\n"), ("old/.harness/rules/sub/01.md", "Deprecated\n")], [ent("sys", "system"), ent("old", "retired")]))
S.append(scenario("retired-marker-line21", "失效标记在第 21 行 → 看不见（只看前 20 行）；第 20 行 → 看得见", [gitdir("sys"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n"), ("old/AGENTS.md", "\n" * 19 + "已退役\n"), ("old/.harness/rules/a.md", "\n" * 20 + "已退役\n")], [ent("sys", "system"), ent("old", "retired")]))
S.append(scenario("retired-marker-case", "英文标记不分大小写，中文按原文", [gitdir("sys"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n"), ("old/AGENTS.md", "RETIRED\n"), ("old/.harness/rules/a.md", "Archived\n"), ("old/.harness/rules/b.md", "RETİRED\n")], [ent("sys", "system"), ent("old", "retired")]))
S.append(scenario("retired-archived-present", "archived 且给了 path 且目录在 → 照读照判", [gitdir("sys"), gitdir("arch"), ("sys/AGENTS.md", "# s\n\nsys（system）、arch（archived）\n"), ("arch/AGENTS.md", "规则\n")], [ent("sys", "system"), ent("arch", "archived")]))
S.append(scenario("retired-rule-outside", "rule_files 里写 ../ 出仓 → 记未定（写条目名）", [gitdir("sys"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n"), ("old/AGENTS.md", "已退役\n"), ("sys/x.md", "x\n")], [ent("sys", "system"), ent("old", "retired")], layout={"rule_files": ["AGENTS.md", "../sys/x.md"]}))
S.append(scenario("retired-rule-notlist", "rule_files 不是列表 → 未定", [gitdir("sys"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n"), ("old/AGENTS.md", "x\n")], [ent("sys", "system"), ent("old", "retired")], layout={"rule_files": "AGENTS.md"}))
S.append(scenario("retired-rule-dedupe", "入口与 rule_files 重叠时只列一次；rule_files 里的反斜杠与空串", [gitdir("sys"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n"), ("old/AGENTS.md", "已退役\n"), ("old/.harness/rules/a.md", "已退役\n")], [ent("sys", "system"), ent("old", "retired")], layout={"rule_files": [".harness\\rules\\", "", "  ", "AGENTS.md", "AGENTS.md"]}))
S.append(scenario("retired-rule-300", "规则文件超过 300 份 → 未定「超过扫描上限」", [gitdir("sys"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n"), ("old/AGENTS.md", "已退役\n")] + [("old/.harness/rules/r%03d.md" % i, "已退役\n") for i in range(310)], [ent("sys", "system"), ent("old", "retired")]))
S.append(scenario("retired-skipdirs", "规则目录里 node_modules / .git 等整棵跳过", [gitdir("sys"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n"), ("old/AGENTS.md", "已退役\n"), ("old/.harness/rules/node_modules/x.md", "规则\n"), ("old/.harness/rules/ok.md", "已退役\n")], [ent("sys", "system"), ent("old", "retired")]))
S.append(scenario("retired-head-64k", "头部只读 64KB：失效标记在 64KB 之后看不见；第 20 行在 64KB 内看得见", [gitdir("sys"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n"), ("old/AGENTS.md", "x" * 70000 + "\n已退役\n"), ("old/.harness/rules/a.md", "已退役\n" + "y" * 70000 + "\n")], [ent("sys", "system"), ent("old", "retired")]))
S.append(scenario("retired-head-bom-crlf", "头部行按 \\n 切：CRLF 的 \\r 留在行里不影响标记；BOM 保留", [gitdir("sys"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n"), ("old/AGENTS.md", "\ufeff已退役\r\n"), ("old/.harness/rules/a.md", "a\r\nretired\r\n")], [ent("sys", "system"), ent("old", "retired")]))

# ---- 判据七：跨仓引用 ----
S.append(scenario("links-ok", "跨仓相对链接可达 → PASS；不可达 → FAIL", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("sys/docs/a.md", "x\n"), ("app/AGENTS.md", APP_OK), ("app/docs/n.md", "[好](../../sys/docs/a.md) [坏](../../sys/docs/nope.md) [本仓](../AGENTS.md)\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("links-none", "没有跨仓链接 → no-refs SKIP", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK)], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("links-outside", "链接指向所有声明仓之外 → outside-repos 未定（不探测存在性）", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/docs/n.md", "[外](../../../elsewhere/x.md) [外2](../../../../far/y.md)\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("links-abs", "绝对路径引用 → abs-refs 未定，按仓名分 id", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/docs/n.md", "[a](/srv/x.md) [b](/srv/y.md)\n"), ("sys/docs/n.md", "[c](/srv/z.md)\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("links-nested", "嵌套仓：外层仓的 md 遍历跳过内层声明仓整棵；内层链到外层算跨仓", [gitdir("sys"), gitdir("sys/nested"), ("sys/AGENTS.md", "# s\n\nsys（system）、nested（active）\n"), ("sys/docs/a.md", "x\n"), ("sys/nested/AGENTS.md", "[系统](../AGENTS.md) sys\n"), ("sys/nested/n.md", "[上](../docs/a.md) [坏](../docs/nope.md)\n")], [ent("sys", "system"), {"name": "nested", "path": "sys/nested", "role": "app"}]))
S.append(scenario("links-case-ext", "只认 .md 后缀，大小写不分", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/docs/N.MD", "[坏](../../sys/nope.md)\n"), ("app/docs/m.txt", "[坏](../../sys/nope2.md)\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("links-many-broken", "断链超过 10 处只列前 10", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/docs/n.md", "".join("[b%d](../../sys/nope%d.md)\n" % (i, i) for i in range(14)))], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("links-skipdirs", "遍历跳过 node_modules / dist / .git 等；点目录（.hidden）不跳", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/node_modules/x.md", "[坏](../../sys/nope.md)\n"), ("app/.hidden/h.md", "[坏](../../sys/nope2.md)\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("links-md-emoji-unicode", "含 emoji 与中文的路径与链接", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("sys/文档/" + E + ".md", "x\n"), ("app/AGENTS.md", APP_OK), ("app/n.md", "[a](../sys/文档/" + E + ".md) [b](../sys/文档/没有.md)\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("links-ref-style", "引用式定义与内联链接都认；带标题的内联链接", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("sys/a.md", "x\n"), ("app/AGENTS.md", APP_OK), ("app/n.md", "[a][1] [b](../sys/a.md \"标题\")\n\n[1]: ../sys/nope.md\n  [2]: <../sys/a.md>\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("links-too-few", "只剩一个本机仓 → too-few-local SKIP，理由按实际分支写", [gitdir("sys"), ("sys/AGENTS.md", "# s\n\nsys（system）、arch（archived）、gone（active）\n")], [ent("sys", "system"), {"name": "arch", "role": "archived"}, {"name": "gone", "path": "nope", "role": "app"}]))
S.append(scenario("links-md-6000", "md 文件超过 6000 份 → 未定「超过扫描上限」", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK)] + [("app/m/%d/f%d.md" % (i // 100, i), "x\n") for i in range(6005)], [ent("sys", "system"), ent("app", "app")]))

# ---- 判据八：历史别名 ----
S.append(scenario("alias-cross", "别的仓里写旧名 → FAIL；同行有改名标记 → 豁免；自仓出现 → alias-residue 未定", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("sys/docs/own.md", "这里写 SYS_OLD 自己的旧名\n"), ("app/AGENTS.md", APP_OK), ("app/docs/a.md", "现行清单见 SYS_OLD/docs/list.md。\n另一行 SYS_OLD 已更名为 sys。\n第三行 SYS_OLDER 不算。\n"), ("app/docs/b.md", "x-SYS_OLD y\nsys_old 小写算\n")], [ent("sys", "system", former_names=["SYS_OLD"]), ent("app", "app")], git=("sys", "app")))
S.append(scenario("alias-pass", "别的仓没有 → PASS（证据写扫描了几个仓）", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK)], [ent("sys", "system", former_names=["SYS_OLD"]), ent("app", "app")], git=("sys", "app")))
S.append(scenario("alias-collide", "别名与在册仓名相撞（不分大小写）→ 未定不扫描", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK)], [ent("sys", "system", former_names=["APP", "x"]), ent("app", "app")], git=("sys", "app")))
S.append(scenario("alias-notlist", "former_names 不是列表 → 未定", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK)], [ent("sys", "system", former_names="SYS_OLD"), ent("app", "app")], git=("sys", "app")))
S.append(scenario("alias-frozen", "layout.frozen 下的路径豁免（含特殊字符的目录）", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/frz/a.md", "SYS_OLD\n"), ("app/frz sp/b.md", "SYS_OLD\n")], [ent("sys", "system", former_names=["SYS_OLD"]), ent("app", "app")], layout={"frozen": ["frz", "frz sp"]}, git=("sys", "app")))
S.append(scenario("alias-multi", "两个仓各有别名，命中逐别名归属；多别名；别名两端空白；数字别名", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/docs/a.md", "见 SYS_OLD 与 APP_OLD 与 oldsys。\n"), ("sys/docs/b.md", "见 APP_OLD。\n")], [ent("sys", "system", former_names=["SYS_OLD", " oldsys ", 7, ""]), ent("app", "app", former_names=["APP_OLD"])], git=("sys", "app")))
S.append(scenario("alias-nongit", "根下没有 .git 的仓不扫", [gitdir("sys"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/docs/a.md", "SYS_OLD\n")], [ent("sys", "system", former_names=["SYS_OLD"]), ent("app", "app")], git=("sys",)))
S.append(scenario("alias-many", "跨仓命中超过 10 行只列前 10；文件数按 split(':')[0] 去重", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/docs/a.md", "".join("SYS_OLD 第%d行\n" % i for i in range(14)))], [ent("sys", "system", former_names=["SYS_OLD"]), ent("app", "app")], git=("sys", "app")))
S.append(scenario("alias-binary-and-long", "git grep -I 跳过二进制；行文截 120 个码点（emoji 不劈开）", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/bin.dat", b"SYS_OLD\x00\x01"), ("app/docs/long.md", "x" * 118 + "SYS_OLD" + E * 5 + "\n")], [ent("sys", "system", former_names=["SYS_OLD"]), ent("app", "app")], git=("sys", "app")))

# ---- 第二批：第一轮变异漏网后补的场景（每个都先看过 Python 的真实输出） ----
RUL = [gitdir("sys"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n"), ("old/AGENTS.md", "已退役\n")]
RP = [ent("sys", "system"), ent("old", "retired")]
S.append(scenario("rules-order-unicode", "规则目录里文件名按码点排序：C、a、b、é、～、😀（大写在小写前；非 BMP 在 BMP 私用区之后）；where 取排序后的第一份", RUL + [("old/.harness/rules/" + n + ".md", "规则\n") for n in ("b", "a", "C", "é", E, "～")] + [("old/.harness/rules/sub/z.md", "规则\n")], RP))
S.append(scenario("rules-blank-entries", "rule_files 里的空串与纯空白条目跳过；扫描清单照列原样（含空串与空白）", RUL, RP, layout={"rule_files": ["", "  ", "AGENTS.md"]}))
S.append(scenario("rules-backslash", "rule_files 条目的反斜杠归一成 /", RUL + [("old/.harness/rules/a.md", "规则\n")], RP, layout={"rule_files": [".harness\\rules\\"]}))
S.append(scenario("rules-dir-no-slash", "条目是目录但没写尾斜杠也按目录递归；条目前后有空白", RUL + [("old/.harness/rules/a.md", "规则\n")], RP, layout={"rule_files": ["  .harness/rules  "]}))
S.append(scenario("rules-dir-slash-is-file", "条目以 / 结尾但目标是文件：不 isdir，continue（不当文件读）", RUL, RP, layout={"rule_files": ["AGENTS.md/"]}))
SD = [gitdir("core"), gitdir("app"), ("core/AGENTS.md", "# s\n\nplatform（system）、app（active）\n")]
RS = [{"name": "platform", "path": "core", "role": "system"}, ent("app", "app")]
S.append(scenario("link-to-sysroot", "入口里的相对链接解析到系统仓根目录本身，路径里没有系统仓的名字或目录名（目录叫 core、仓名叫 platform）→ 第一跳靠『解析进系统仓』命中", SD + [("app/AGENTS.md", "# app\n\n[内核](../core)\n")], RS))
S.append(scenario("link-to-sysfile", "同上但链接指向系统仓根下的文件（路径里仍有目录名 core，所以先命中记号）：换成不含目录名的方式——用 .. 绕回：../app/../core/AGENTS.md", SD + [("app/AGENTS.md", "# app\n\n[内核](../app/../core/AGENTS.md)\n")], RS))
S.append(scenario("link-abs-nomatch", "入口里的绝对路径链接不含系统仓名/目录名，也不被当作相对链接解析 → 两跳到不了", SD + [("app/AGENTS.md", "# app\n\n[外](/srv/x.md)\n")], RS))
S.append(scenario("link-sys-sibling-prefix", "链接解析到名字以系统仓目录名开头但不在其内的目录（core2）→ 不算解析进系统仓", SD + [gitdir("core2"), ("core2/AGENTS.md", "x\n"), ("app/AGENTS.md", "# app\n\n[别处](../core2/AGENTS.md)\n")], RS + [ent("core2", "app")]))
S.append(scenario("sys-name-dotdot", "系统仓 name 是 .. ：记号里不含 ..（被过滤）；目录名 sysdir 仍是记号", [gitdir("sysdir"), gitdir("app"), ("sysdir/AGENTS.md", ".. 与 . 都在这里\n"), ("app/AGENTS.md", "见 sysdir 和 ..\n")], [{"name": "..", "path": "sysdir", "role": "system"}, ent("app", "app")]))
S.append(scenario("sys-name-dot", "系统仓 name 是 . ：同上", [gitdir("sysdir"), gitdir("app"), ("sysdir/AGENTS.md", ".. 与 . 都在这里\n"), ("app/AGENTS.md", "见 sysdir 和 .\n")], [{"name": ".", "path": "sysdir", "role": "system"}, ent("app", "app")]))
S.append(scenario("sys-gitfile", "仓根下的 .git 是文件（worktree/submodule 形态）：算 git 仓库（exists），不是目录也算", [("sys/.git", "gitdir: ../x\n"), gitdir("app"), ("sys/AGENTS.md", "# s\n\nsys（system）、app（active）\n"), ("app/AGENTS.md", "[s](../sys/AGENTS.md)\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("entry-multi-missing", "多个入口候选都不存在：evidence 用顿号连", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", "# s\n\nsys（system）、app（active）\n")], [ent("sys", "system"), ent("app", "app")], layout={"entry": ["AGENTS.md", "README.md", "ENTRY"]}))
S.append(scenario("app-entry-dir", "app 的入口候选是目录：不算入口 → 没有入口 FAIL", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", "# s\n\nsys（system）、app（active）\n"), ("app/AGENTS.md/x", "x\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("retired-notexist", "退役仓目录不在：判据六不判（不读不报）", [gitdir("sys"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n")], [ent("sys", "system"), {"name": "old", "path": "gone", "role": "retired"}]))
S.append(scenario("md-is-dir", "名为 x.md 的目录：遍历里它是目录，不当文件读", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", "# s\n\nsys（system）、app（active）\n"), ("app/AGENTS.md", "[s](../sys/AGENTS.md)\n"), ("app/dir.md/x", "x\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("alias-case-collide", "别名与仓名只差大小写（别名 APP、仓名 app）→ 相撞未定", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", "# s\n\nsys（system）、app（active）\n"), ("app/AGENTS.md", "[s](../sys/AGENTS.md)\n")], [ent("sys", "system", former_names=["APP"]), ent("app", "app")], git=("sys", "app")))
S.append(scenario("roles-library", "role 写成 library 不在四种之内 → bad-role", base3, [ent("sys", "system"), ent("app", "library"), ent("old", "retired")]))
S.append(scenario("links-dirlink-md", "名为 x.md 的目录符号链接：os.walk 把它列在目录里，不当文件读；若当文件读会读不了而多出一条未定", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("elsewhere/e.md", "x\n")], [ent("sys", "system"), ent("app", "app")], ops=[("symlink_dir", "app/link.md", "elsewhere")]))
S.append(scenario("links-undeclared-sibling", "链接指向与本仓同名前缀的未声明目录（app2）：不属于任何声明仓 → outside-repos 未定；归属前缀不带斜杠时 app2 会被当成 app 的一部分而静默跳过", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/n.md", "[x](../app2/n.md)\n"), ("app2/n.md", "x\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("entry-symlink-outside", "app 的入口是指向仓外存在文件的符号链接，path 带尾斜杠：判据三记 outside-root 未定（where 去尾斜杠），判据四读入口时记 unreadable 未定", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("elsewhere/E.md", "secret sys\n")], [ent("sys", "system"), {"name": "app", "path": "app/", "role": "app"}], ops=[("symlink_file", "app/AGENTS.md", "elsewhere/E.md")]))
S.append(scenario("entry-symlink-dangling", "app 的入口是指向仓外、目标不存在的悬空符号链接：出仓先于存在性判断 → 仍记 outside-root，而不是『没有入口』", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", ""))], [ent("sys", "system"), ent("app", "app")], ops=[("symlink_file", "app/AGENTS.md", "nonexistent_target")]))
S.append(scenario("md-symlink-outside", "两个仓各有一个指向仓外文件的 md 符号链接：各记一条 unreadable 未定，id 按仓名分开（不分开会被一行登记同时静音）", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("elsewhere/E.md", "[x](../sys/nope.md)\n")], [ent("sys", "system"), ent("app", "app")], ops=[("symlink_file", "app/ext.md", "elsewhere/E.md"), ("symlink_file", "sys/ext.md", "elsewhere/E.md")]))
S.append(scenario("link-up-to-sysroot", "系统仓 path 是 . （仓根就是整个工作区），app 的入口只有一个链接 `..`：解析结果等于系统仓根本身 → 第一跳靠『解析进系统仓』命中，证据写链接原文", [gitdir("."), ("AGENTS.md", "# s\n\nsys（system）、app（active）\n"), gitdir("app"), ("app/AGENTS.md", "# app\n\n[上](..)\n")], [{"name": "sys", "path": ".", "role": "system"}, ent("app", "app")]))
S.append(scenario("link-abs-dotdot", "同上，但链接写成 `/..`：绝对路径形式不解析（若按相对路径拼接会落到系统仓根而误判命中）→ 两跳到不了", [gitdir("."), ("AGENTS.md", "# s\n\nsys（system）、app（active）\n"), gitdir("app"), ("app/AGENTS.md", "# app\n\n[上](/..)\n")], [{"name": "sys", "path": ".", "role": "system"}, ent("app", "app")]))
S.append(scenario("alias-upper-reponame", "仓名带大写（App），别名写 APP：相撞判断两边都转小写 → 未定不扫描", [gitdir("sys"), gitdir("App"), ("sys/AGENTS.md", "# s\n\nsys（system）、App（active）\n"), ("App/AGENTS.md", "[s](../sys/AGENTS.md)\n")], [ent("sys", "system", former_names=["APP"]), ent("App", "app")], git=("sys", "App")))
S.append(scenario("alias-bracket", "别名里带 [：git grep 按字面（-F）找得到；不加 -F 会被当正则而报错，整条召回失败", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/docs/a.md", "见 SYS[OLD 这里\n")], [ent("sys", "system", former_names=["SYS[OLD"]), ent("app", "app")], git=("sys", "app")))
S.append(scenario("alias-binary-first", "二进制文件先于文本文件命中：加 -I 才跳过它；不加时输出里多一行 `Binary file … matches`，并进后一个文件的路径", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/a.bin", b"SYS_OLD\x00\x01\x02"), ("app/b.md", "SYS_OLD 的用法\n")], [ent("sys", "system", former_names=["SYS_OLD"]), ent("app", "app")], git=("sys", "app")))
import hashlib
HX = [hashlib.md5(str(i).encode()).hexdigest()[:6] for i in range(30)]  # 30 个毫无规律的小写十六进制名：不排序的实现在 Windows（NTFS 字典序）与 Linux（ext4 哈希序）上都几乎必然与码点序不同；不含只差大小写的名字（Windows 不区分）
S.append(scenario("rules-order-many", "规则目录里 30 个乱名文件：evidence 列前 10 个，按码点序排；where 取排序后第一份（不排序时 Linux 与 Windows 的目录读取次序各不相同）", RUL + [("old/.harness/rules/%s.md" % h, "规则\n") for h in HX], RP, layout={"rule_files": [".harness/rules/"]}))
S.append(scenario("entry-both-exist", "入口候选 AGENTS.md 与 README.md 都存在：取列表里的第一个（AGENTS.md），不是最后一个", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", "# s\n\nsys（system）、app（active）\n"), ("sys/README.md", "# s readme\n"), ("app/AGENTS.md", "[s](../sys/AGENTS.md)\n"), ("app/README.md", "无引用\n")], [ent("sys", "system"), ent("app", "app")], layout={"entry": ["AGENTS.md", "README.md"]}))
S.append(scenario("tailored-out", "项目已裁剪本检查：只出一条 SKIP（经 runGuarded 外壳），不跑任何判据", base3, [ent("sys", "system"), ent("app", "app"), ent("old", "retired")], extra={"tailoring": [{"check": "cross-repo", "applicable": False, "reason": "单仓项目，不适用"}]}))
S.append(scenario("rules-dir-entry-slash-file", "条目以 / 结尾、目标是文件、且文件未标失效：不算目录也不当文件读 → 该仓 0 份规则文件，仍 PASS（「0 份都带标记」）", [gitdir("sys"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n"), ("old/AGENTS.md", "规则\n"), ("old/notes", "规则\n")], RP, layout={"rule_files": ["notes/"]}, extra={}))
S.append(scenario("rules-empty-entry", "空串条目若不跳过会被当作仓根目录整棵递归：仓根下的文件都被列出", [gitdir("sys"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n"), ("old/AGENTS.md", "已退役\n"), ("old/other.md", "规则\n")], RP, layout={"rule_files": [""]}))
S.append(scenario("rules-backslash-file", "文件条目写反斜杠路径：归一后才找得到", [gitdir("sys"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n"), ("old/AGENTS.md", "已退役\n"), ("old/sub/rule.md", "规则\n")], RP, layout={"rule_files": ["sub\\rule.md"]}))
S.append(scenario("rules-dedupe-dotslash-dir", "目录条目与其中的文件条目重复：去重靠规范化后的绝对路径", [gitdir("sys"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n"), ("old/AGENTS.md", "已退役\n"), ("old/rules/a.md", "已退役\n")], RP, layout={"rule_files": ["rules/", "rules/a.md", "./rules/a.md", "rules//a.md"]}))
S.append(scenario("rules-dedupe", "rule_files 里重复项与 ./ 前缀：去重靠规范化后的绝对路径；扫描清单仍列原样", RUL, RP, layout={"rule_files": ["AGENTS.md", "./AGENTS.md", "AGENTS.md"]}))
S.append(scenario("rules-live-14", "live 超过 10 份：只列前 10、where 取第一份", [gitdir("sys"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n")] + [("old/.harness/rules/r%02d.md" % i, "规则\n") for i in range(14)], RP, layout={"rule_files": [".harness/rules/"]}))
S.append(scenario("rules-cap-exact", "规则文件恰好 300 份：达到上限即截断（>=）；299 份不截断", [gitdir("sys"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n")] + [("old/.harness/rules/r%03d.md" % i, "已退役\n") for i in range(300)], RP, layout={"rule_files": [".harness/rules/"]}))
S.append(scenario("rules-cap-299", "规则文件 299 份：不截断，全部带标记 → PASS", [gitdir("sys"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n")] + [("old/.harness/rules/r%03d.md" % i, "已退役\n") for i in range(299)], RP, layout={"rule_files": [".harness/rules/"]}))
S.append(scenario("rules-symlink-dir", "规则目录里的目录符号链接：os.walk 不进入；它指向的文件不列（指向仓外目录，文件未标失效；若被进入则会多报一份 FAIL）", RUL + [("elsewhere/x.md", "规则\n"), ("old/.harness/rules/ok.md", "已退役\n")], RP, layout={"rule_files": [".harness/rules/"]}, ops=[("symlink_dir", "old/.harness/rules/link", "elsewhere")]))
S.append(scenario("rules-entry-only", "entryNames 并入扫描清单：入口文件未标失效时报 FAIL（rule_files 里没有它）", [gitdir("sys"), gitdir("old"), ("sys/AGENTS.md", "# s\n\nsys（system）、old（retired）\n"), ("old/AGENTS.md", "规则\n"), ("old/.harness/rules/a.md", "已退役\n")], RP, layout={"rule_files": [".harness/rules/"]}))
S.append(scenario("repos-falsy", "repos 是 0 / 空串 / false 都等于没声明 → SKIP 单仓", base3, 0))
S.append(scenario("repos-name-zero", "name 是 0（假值）→ 视为缺 name", base3, [{"name": 0, "path": "sys"}, ent("app", "app")]))
S.append(scenario("repos-retired-nopath", "retired 缺 path 不放过（只有 archived 可省略）", base3, [ent("sys", "system"), {"name": "old", "role": "retired"}]))
S.append(scenario("repos-path-is-file", "path 指向文件：不算存在（要求是目录）→ 判据二未定，其余按不存在处理", base3, [{"name": "sys", "path": "sys/AGENTS.md", "role": "system"}, ent("app", "app")]))
S.append(scenario("repos-array-item", "repos 的元素是数组 → 不是映射", base3, [["a"], ["b"]]))
S.append(scenario("repos-former-null", "former_names 显式写 null：等于没声明（不记别名读不出）", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK)], [ent("sys", "system", former_names=None), ent("app", "app")], git=("sys", "app")))
S.append(scenario("entry-numeric", "layout.entry 里写数字：转成字符串（123 → '123'，找不到再取下一个）", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK)], [ent("sys", "system"), ent("app", "app")], layout={"entry": [123, "AGENTS.md"]}))
S.append(scenario("entry-is-dir", "入口候选是目录：不算（要求是文件），取下一个", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/ENTRY/x", "x")], [ent("sys", "system"), ent("app", "app")], layout={"entry": ["ENTRY", "AGENTS.md"]}))
S.append(scenario("roles-bad-12", "bad-role 超过 10 个：reason 只列前 10", [gitdir("r%d" % i) for i in range(12)], [{"name": "r%d" % i, "path": "r%d" % i, "role": "w%d" % i} for i in range(12)]))
S.append(scenario("roles-system-where", "判据一多个 system：where 取第一个、evidence 带路径", base3, [ent("sys", "system"), ent("app", "system"), ent("old", "retired")]))
S.append(scenario("reach-archived-withpath", "archived 给了 path 但本机没有目录：判据二 PASS，证据写「给了 path … 但本机没有这个目录」", [gitdir("sys"), ("sys/AGENTS.md", "# s\n\nsys（system）、arch（archived）\n"), gitdir("app"), ("app/AGENTS.md", APP_OK)], [ent("sys", "system"), ent("app", "app"), {"name": "arch", "path": "gone", "role": "archived"}]))
S.append(scenario("entry-trailing-slash-path", "path 带尾斜杠：where 去尾斜杠", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK)], [{"name": "sys", "path": "sys/", "role": "system"}, {"name": "app", "path": "app//", "role": "app"}]))
S.append(scenario("proj-sysdir-trailing", "系统仓 path 带尾斜杠：目录名取最后一段（不是空串）", [gitdir("sysdir"), gitdir("app"), ("sysdir/AGENTS.md", "# s\n\nsys（system）、app（active）\n"), ("app/AGENTS.md", "# app\n\n见 sysdir 仓。\n")], [{"name": "sys", "path": "sysdir/", "role": "system"}, ent("app", "app")]))
S.append(scenario("proj-sysdir-dot", "系统仓 path 是 . 且目录名为 .：记号不含 . 与 ..", [gitdir("."), ("AGENTS.md", "# s\n\nsys（system）、app（active）\n"), gitdir("app"), ("app/AGENTS.md", "# app\n\n无引用。\n")], [{"name": "sys", "path": ".", "role": "system"}, ent("app", "app")]))
S.append(scenario("proj-link-abs-skipped", "入口里的绝对路径链接不解析（Windows 盘符与 UNC 也不解析）", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", "# app\n\n[a](C:/x/sys.md) [b](D:/sys.md)\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("proj-link-root-itself", "入口里的链接解析到系统仓根本身（不是根下的文件）→ 第一跳命中", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", "# app\n\n[系统](../sys)\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("proj-link-prefix", "链接解析到名字以系统仓目录名开头但不是它的目录（sys2）→ 不算指向系统仓", [gitdir("sys"), gitdir("sys2"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("sys2/AGENTS.md", "x\n"), ("app/AGENTS.md", "# app\n\n[别处](../sys2/AGENTS.md)\n")], [ent("sys", "system"), ent("app", "app"), ent("sys2", "app")]))
S.append(scenario("proj-hop2-first-hit", "第二跳：多个本仓链接，前一个读得到但没命中、后一个命中；命中即停（后面的不再数）", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", "# app\n\n[1](d/1.md) [2](d/2.md) [3](d/3.md)\n"), ("app/d/1.md", "无\n"), ("app/d/2.md", "权威在 sys\n"), ("app/d/3.md", "也有 sys\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("proj-hop2-outside", "第二跳：入口里指向仓外的链接不跟随，不探测存在性（目标存在/不存在时输出相同）", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", "# app\n\n[外](../../outside/x.md)\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("proj-app-notexist", "app 仓目录不在：判据四跳过它（不读不判）", [gitdir("sys"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", ""))], [ent("sys", "system"), {"name": "app", "path": "nope", "role": "app"}]))
S.append(scenario("proj-nonapp", "role 为 retired/空 的仓不进判据四（只判 app）", [gitdir("sys"), gitdir("old"), gitdir("x"), ("sys/AGENTS.md", SYS_OK), ("old/AGENTS.md", "已退役，无引用\n"), ("x/AGENTS.md", "无引用\n")], [ent("sys", "system"), ent("old", "retired"), {"name": "x", "path": "x"}]))
S.append(scenario("reg-sys-notexist", "系统仓目录不在：判据五不判（判据二已记）", [gitdir("app"), ("app/AGENTS.md", APP_OK)], [{"name": "sys", "path": "gone", "role": "system"}, ent("app", "app")]))
S.append(scenario("reg-substring-name", "判据五按记号找名字：app2 里的 app 不算登记 app；名字前后紧挨中文算独立", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", "# s\n\nsys（system）\n仓 app2 为 active\n"), ("app/AGENTS.md", APP_OK)], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("reg-spaces-line", "判据五命中行去首尾空白（含全角空格）后再截取", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", "# s\n\nsys（system）\n\u3000\u3000app 在这里 提到\u3000\u3000\n"), ("app/AGENTS.md", APP_OK)], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("reg-multi-hit-lines", "同一个仓在多行出现：状态词在第二行 → 算登记；都没有时命中行取第一行", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", "# s\n\nsys（system）\napp 先提到一次\napp 再提到（active）\n"), ("app/AGENTS.md", APP_OK)], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("reg-multi-hit-bare", "同一个仓在多行出现且都无状态词：命中行取第一行", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", "# s\n\nsys（system）\napp 第一行\napp 第二行\n"), ("app/AGENTS.md", APP_OK)], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("reg-chars-emoji", "字符数按码点而不是码元", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", E * 20 + "\nsys（system）\n"), ("app/AGENTS.md", APP_OK)], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("links-unreadable", "仓里有读不了的 md（出仓的符号链接）→ unreadable 未定（按仓名分 id）", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/docs/n.md", "[坏](../../sys/nope.md)\n")], [ent("sys", "system"), ent("app", "app")], extra={}, ops=[("mkdir", "outside_dir")]))
S.append(scenario("links-last-broken-where", "断链 where 取第一个文件（遍历次序），不是最后一个", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/a.md", "[坏](../sys/n1.md)\n"), ("app/b.md", "[坏](../sys/n2.md)\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("links-outside-plus-ok", "有 outside 引用但也有可达引用：不记 no-refs，记 PASS", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("sys/docs/a.md", "x\n"), ("app/AGENTS.md", APP_OK), ("app/docs/n.md", "[好](../../sys/docs/a.md) [外](../../../elsewhere/x.md)\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("links-outside-only", "只有 outside 引用：不记 no-refs（0 处可达但有 outside）", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/docs/n.md", "[外](../../../elsewhere/x.md)\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("links-prefix-sibling", "归属前缀要带斜杠：sys2 里的文件不属于 sys；指向 sys2 的链接属于 sys2", [gitdir("sys"), gitdir("sys2"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("sys2/AGENTS.md", "x\n"), ("sys2/y.md", "x\n"), ("app/AGENTS.md", APP_OK), ("app/n.md", "[a](../sys2/y.md) [b](../sys2/nope.md)\n")], [ent("sys", "system"), ent("sys2", "app"), ent("app", "app")]))
S.append(scenario("links-md-includes", "只认 .md 结尾：a.md.bak 与 b.mdx 不是", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/a.md.bak", "[坏](../sys/n.md)\n"), ("app/b.mdx", "[坏](../sys/n.md)\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("links-symlink-dir", "md 遍历不进入目录符号链接：link 指向 app 之外的目录，里面的断链不应被数进 app；链接本身不当文件", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/n.md", "[坏](../sys/nope.md)\n"), ("elsewhere/e.md", "[坏](../sys/nope2.md) [坏2](../sys/nope3.md)\n")], [ent("sys", "system"), ent("app", "app")], ops=[("symlink_dir", "app/link", "elsewhere")]))
S.append(scenario("links-symlink-dir-dup", "目录符号链接指向本仓另一个目录：不进入，所以同一份文件只数一次", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/real/n.md", "[坏](../../sys/nope.md)\n")], [ent("sys", "system"), ent("app", "app")], ops=[("symlink_dir", "app/link", "app/real")]))
S.append(scenario("links-skip-dist-and-git", "遍历跳过 dist 与 .git 目录（.git 里放 md 也不扫）", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/dist/x.md", "[坏](../../sys/nope.md)\n"), ("app/.git/x.md", "[坏](../../sys/nope2.md)\n")], [ent("sys", "system"), ent("app", "app")]))
S.append(scenario("alias-recall-failed", "召回没跑成（.git 是空目录，git grep 报 128）→ alias-recall-failed 未定，不记 PASS", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK)], [ent("sys", "system", former_names=["SYS_OLD"]), ent("app", "app")]))
S.append(scenario("alias-marker-case", "改名标记按小写也认：Formerly / RENAMED 同行豁免", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/docs/a.md", "Formerly SYS_OLD\nRENAMED: SYS_OLD\nSYS_OLD 前身\n")], [ent("sys", "system", former_names=["SYS_OLD"]), ent("app", "app")], git=("sys", "app")))
S.append(scenario("alias-collide-case", "别名与仓名只差大小写也算相撞", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK)], [ent("sys", "system", former_names=["SYS"]), ent("app", "app")], git=("sys", "app")))
S.append(scenario("alias-self-many", "自仓命中超过 10 行只列前 10", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("sys/docs/a.md", "".join("SYS_OLD 第%d行\n" % i for i in range(14)))], [ent("sys", "system", former_names=["SYS_OLD"]), ent("app", "app")], git=("sys", "app")))
S.append(scenario("alias-literal", "git grep -F 按字面：别名里的正则元字符不生效（a.c 不匹配 abc）", [gitdir("sys"), gitdir("app"), ("sys/AGENTS.md", SYS_OK.replace("、old（retired）", "")), ("app/AGENTS.md", APP_OK), ("app/docs/a.md", "abc 与 a.c 与 axc\n")], [ent("sys", "system", former_names=["a.c"]), ent("app", "app")], git=("sys", "app")))

# ---- 纯函数 ----
PURE = {}
PURE["name_appears"] = [[t, n, cr._name_appears(t, n)] for t, n in [
    ("RCMS", "RCMS"), ("RCMS_Backend", "RCMS"), ("x RCMS y", "RCMS"), ("rcms", "RCMS"), ("RCMS-2", "RCMS"), ("a-RCMS", "RCMS"), ("RCMS.", "RCMS"), ("（RCMS）", "RCMS"), ("漢RCMS", "RCMS"), ("RCMS漢", "RCMS"),
    ("ＲＣＭＳ", "RCMS"), ("İ", "i"), ("ı", "I"), ("ſ", "S"), ("\u212a", "k"), ("ǆ", "Ǆ"), ("ß", "SS"), ("SS", "ß"), ("a.b", "a.b"), ("axb", "a.b"), ("a|b", "a|b"), ("a b", "a b"), ("x(y)", "x(y)"), ("C++", "C++"),
    ("x" + E + "RCMS", "RCMS"), ("RCMS" + E, "RCMS"), ("0RCMS", "RCMS"), ("_RCMS", "RCMS"), ("-RCMS", "RCMS"), ("RCMS0", "RCMS"), ("٣RCMS", "RCMS"), ("éRCMS", "RCMS"), ("RCMSé", "RCMS"), ("", "a"), ("a", ""), ("名", "名"), ("名字", "名"),
    ("Ωmega", "ωmega"), ("ΩMEGA", "ωmega"), ("ς", "Σ"), ("σ", "ς"), ("Σ", "ς"), ("\u212b", "å"), ("Å", "å"), ("a\nb", "a"), ("a\u2028b", "a"), ("x\ty", "y"), ("sys-", "sys"), ("sys-x", "sys"), ("1sys", "sys"), ("sys1", "sys"),
    ("a.md", "a"), ("sys", "SYS"), ("İSYS_OLD", "SYS_OLD"), ("[sys]", "sys"), ("sys,", "sys"), ("sys:", "sys"), ("sys\\x", "sys"), ("sys/x", "sys"),
    # 边界类折叠 İ(U+0130) 与 ı(U+0131)：它们紧挨名字时挡得住（ı 与 I 在 re.I 下等价，İ 与 i 同）
    ("ıSYS_OLD", "SYS_OLD"), ("SYS_OLDı", "SYS_OLD"), ("İSYS", "SYS"), ("SYSİ", "SYS"), ("ıSYS", "SYS"), ("SYSı", "SYS"), ("ſSYS", "SYS"), ("SYS\u212a", "SYS"),
    ("\u00dfsys", "sys"), ("sys\u00df", "sys"),
    # 空名字：Python 的 re.escape('') = '' → 模式只剩两个否定环视，在任何「前后都不是边界字符」的位置命中（空文本、空白、标点、中文旁都算）。生产路径上不可达（调用点都已滤掉空串），但函数导出、行为应与 Python 一致
    (" ", ""), ("", ""), ("abc", ""), ("a b", ""), ("，", ""), ("漢", ""), ("a-", ""), ("-", ""), ("_", ""), ("1 ", ""), (E, "")]]
PURE["status_token"] = [[t, cr._has_status_token(t)] for t in ["app（active）", "app: Archived", "app 已退役", "app 的 filesystem 说明", "app_system_x", "system", "SYSTEM", "应用仓", "控制平面", "x 归档 y", "停用", "现行", "在用", "退役", "retired", "RETIRED", "active-x", "x-active", E + "active", "ａｃｔｉｖｅ", "activeé", "éactive", "", "无", "inactive", "reactive", "active.", "active_", "active1", "(active)", "[retired]",
                                                                      # 中文状态词只按子串认（不按记号）：前后紧挨字母数字也算；ASCII 状态词按记号认，前后紧挨中文不挡
                                                                      "x现行y", "a已归档b", "A已归档", "已归档Z", "归档", "xx停用", "停用yy", "x应用仓y", "1控制平面2", "系统system", "system系统", "ａctive", "activeｃ", "x_已退役", "已退役_x"]]
PURE["marker"] = [[t, cr._has_invalidation_marker(t)] for t in ["已退役", "失效", "不再生效", "已归档", "已停用", "Retired", "ARCHIVED", "Deprecated", "deprecated", "RETİRED", "retıred", "ſ", "deprecateD", "#" + E + "retired", "retired", "已退役".upper(), "失效".lower(), "Failure已失效", "ARCHIVED已", "Retired\n已退役", "KELVIN", "\u212aelvin", "x失 效", "已 退役", "", "无效", "不再生 效", "failure", "preretired", "RETIRED".lower(), "ARCHİVED", "Deprecated\n", "\ufeff已退役", "ｒｅｔｉｒｅｄ"]]
PURE["link_targets"] = [[t, cr._link_targets(t)] for t in [
    "[a](x.md)", "[a](<x y.md>)", '[a](x.md "t")', "[a](x.md 't')", "[a](x.md#h)", "[a](#h)", "[a](?q)", "[a](x.md?q=1#h)", "[a](http://x)", "[a](mailto:x@y)", "[a](C:\\x)", "[a](c:/x)", "[a](x:y)", "[a](1:y)", "[a](a+b:y)",
    "[a]: x.md", "  [a]: x.md", "\t[a]: <x.md>", "[a]:x.md", "[a]:\n  x.md", "[a]: ", "[a]: #h", "[a](x.md)[b](x.md)", "[a](x.md) [b](y.md)", "![i](x.png)", "[a](x(y).md)", "[a]( x.md )", "[a](\tx.md)", "[a](  <x.md>  )",
    '[a](x.md  "t" )', '[a](x.md\n"t")', "[a](\nx.md)", "[a]()", "[a]( )", "](x.md)", "](x.md", "[a](x\u3000y.md)", "[a](x\u00a0y.md)", "[a](x\x1cy.md)", "[a](" + E + ".md)", "[" + E + "](x.md)", "[a](x.md)\r\n[b]: y.md\r\n",
    "[a](../x.md)", "[a](./x.md)", "[a](/abs.md)", "[a](\\\\srv\\x.md)", "[a](x.md)\u2028[b]: z.md", "[a](x.md) \x85[b]: z.md", "[a]: x.md\u2028[b]: z.md", "[a]: x.md\n[b]: x.md", "[a](x.md)\n[a]: x.md",
    # 协议头：scheme 只认 字母 开头 + 字母数字 + . - 的组合；1:y 不是协议头（首字符是数字）
    "[a](a1:y)", "[a](a.b:y)", "[a](a-b:y)", "[a](a+b:y)", "[a](a_b:y)", "[a](a b:y)", "[a](ab1.c-d+e:y)", "[a](1a:y)", "[a](-a:y)", "[a](.a:y)", "[a](a:)", "[a](a:b:c)", "[a](aé:y)",
    # 去首尾空白、锚点与查询的先后：先 # 后 ? ；去完后再去空白；纯锚点与纯查询丢弃；锚点前后有空白
    "[a]( # )", "[a](\u3000x.md\u3000)", "[a](x.md \u3000#h)", "[a](x.md?q#h)", "[a](x.md#h?q)", "[a](x.md ?q)", "[a](x.md\u00a0#h)", "[a]( ?q)", "[a](\u3000#h)", "[a](x.md\u3000?q=1)", "[a]: \u3000x.md", "[a]: x.md#h", "[a]: x.md?q", "[a]: #h",
    "[a]: x.md\r[b]: y.md", "[a]:\r\n  x.md", "x [a]: x.md", "[a]: x.md y", "[a\nb]: x.md", "\u3000[a]: x.md", "\u00a0[a]: x.md", " \t [a]: x.md", "[a](x.md?)", "[a](x.md#)", "[a](?#)", "[a](# h)", "[a]( #h)", "[a](x.md#h#i)", "[a](x.md?a?b)",
    "](" * 5, "[a](" + "x" * 200 + ".md)", "[a](x\ufeff.md)", "[a](\ufeffx.md)", "[a]: \ufeffx.md", "[a](x.md" + "\u200b" + ")", "[a](x.MD)", "[a](X.md)", "[a](x%20y.md)", "[a](x y.md)", "[a](<x>)", "[a](<>)", "[a](<#h>)", "[a](<http://x>)"]]
PURE["parse_grep_z"] = [[t, list(cr._parse_grep_z(t))] for t in [
    # 记号数的奇偶与末尾悬空路径：奇数个记号但最后一个路径非空 → 切不开
    "a.md\x001\x00hello\nb.md", "a.md\x001\x00hello\nb.md\n", "a.md", "a.md\x001", "a.md\x001\x00", "a.md\x00\x00x\nb.md\x00\x00y\n", "a.md\x000\x00x\n", "a.md\x00007\x00x\n",
    "", "a.md\x001\x00hello\n", "a.md\x001\x00hello\nb.md\x002\x00world\n", "a\nb.md\x003\x00txt\nc.md\x001\x00z\n", "a.md\x001\x00x:y:z\n", "a.md\x00x\x00hello\n", "a.md\x001\x00hello\nb.md\x00", "a.md\x001\x00hello", "a.md\x001\x00hello\r\n",
    "a.md\x001\x00  \u3000hello\u3000  \n", "a.md\x001\x00" + "x" * 130 + "\n", "a.md\x001\x00" + "x" * 119 + E + "yy\n", "a.md\x001\x00\ufeffhello\n", "a\\b.md\x001\x00hello\n", "a.md\x00\u0663\x00hello\n", "a.md\x00\u00b2\x00hello\n", "a.md\x00\x00hello\n",
    "a.md\x001\x00hello\n\x00", "\x001\x00hello\n", "a.md\x001\x00x\x1cy\n", "a.md\x001\x00\n", "a.md\x001\x00\n\nb.md\x002\x00z\n", "a.md\x0012\x00" + E * 130 + "\n", "a.md\x001\x00x\u2028y\n", "a.md\x00-1\x00x\n", "a.md\x001.5\x00x\n", "a.md\x00 1\x00x\n"]]
path = os.path.join(HERE, "unit", "cr-scenarios.json")
tmpf = path + ".tmp"
with open(tmpf, "w", encoding="utf-8", newline="\n") as fh:
    json.dump({"python": sys.version.split()[0], "scenarios": S, "pure": PURE}, fh, ensure_ascii=False, indent=1)
    fh.write("\n")
back = json.load(open(tmpf, encoding="utf-8"))
if len(back["scenarios"]) != len(S):
    sys.exit("回读与内存不一致，拒绝落盘")
os.replace(tmpf, path)
print("写出 golden/unit/cr-scenarios.json：%d 个场景；纯函数 %s；%d KB" % (len(S), "、".join("%s %d" % (k, len(v)) for k, v in PURE.items()), os.path.getsize(path) // 1024))
for s in S:
    print("  %-28s %2d 条  %s" % (s["name"], len(s["out"]), " ".join(o["status"][0] for o in s["out"])[:50]))
