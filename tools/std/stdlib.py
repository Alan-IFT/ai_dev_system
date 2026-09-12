# -*- coding: utf-8 -*-
"""检查器公共库：三态 Finding、严格配置加载、路径工具。

契约见同目录 CONTRACT.md。本模块只用标准库——目标项目不应为了跑检查而先装依赖。
"""
from __future__ import annotations

import io
import os
import re
import subprocess

PASS = "PASS"
FAIL = "FAIL"
UNDETERMINED = "UNDETERMINED"
SKIP = "SKIP"

STATUSES = (PASS, FAIL, UNDETERMINED, SKIP)

# 01 §3.5 的「状态」字段在文档头部叫什么。中英两写都算。
#
# 放进 stdlib 是因为它此前有三份不一致的副本：`check_layout` 只认英文单值
# `"status"`，`check_freshness` 与 `check_evidence` 各持一份 ("状态","status","state")。
# 同一事实三份副本违反 01 §1 G2；更要紧的是那份英文单值已经产出过一条假 FAIL
# （本仓 `PROJECT_STATUS.md` 头部写的是「状态：进行中」，被报成"缺状态字段"），
# 那是 01 §2 N1 禁止的确定性错误结论。**新增写法只在这里加，不在检查器里另起一张表。**
STATUS_FIELDS = (u"状态", u"status", u"state")


def finding(check, status, title, where=None, why="", reason="", evidence=""):
    """构造一条 Finding。status 非法即抛——不允许悄悄产生第四种状态。"""
    if status not in STATUSES:
        raise ValueError("非法状态 %r" % (status,))
    if status in (UNDETERMINED, SKIP) and not reason:
        raise ValueError("%s 必须给 reason（契约 §1）" % status)
    return {
        "check": check,
        "status": status,
        "title": title,
        "where": where,
        "why": why,
        "reason": reason,
        "evidence": evidence,
    }


def undetermined_from_exception(check, exc, what):
    """检查器内部异常一律转 UNDETERMINED，绝不吞掉记 PASS。"""
    return finding(
        check, UNDETERMINED,
        "%s 时检查器自身出错" % what,
        reason="%s: %s" % (type(exc).__name__, exc),
        evidence="检查器故障时其结论作废；按 01 §5.6 判检查器故障，不按通过记。",
    )


# --------------------------------------------------------------------------
# 严格 YAML 子集
# --------------------------------------------------------------------------

class ConfigError(Exception):
    """配置无法被无歧义地解析。歧义即拒绝，不猜。"""


_SCALAR_TRUE = {"true", "yes", "on"}
_SCALAR_FALSE = {"false", "no", "off"}


def _scalar(raw, lineno):
    s = raw.strip()
    if not s:
        return ""
    if s[0] in "[{&*|>!%@`":
        raise ConfigError(
            "第 %d 行用了本解析器不支持的 YAML 语法 %r。"
            "本工具只接受最简子集（缩进映射、短横线列表、纯量），"
            "看不懂即拒绝而不是猜。" % (lineno, s[0])
        )
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        body = s[1:-1]
        if "\\" in body:
            raise ConfigError("第 %d 行的引号字符串含转义，本解析器不处理" % lineno)
        return body
    low = s.lower()
    if low in _SCALAR_TRUE:
        return True
    if low in _SCALAR_FALSE:
        return False
    if low in ("null", "~"):
        return None
    if re.fullmatch(r"-?\d+", s):
        return int(s)
    if re.fullmatch(r"-?\d+\.\d+", s):
        return float(s)
    return s


def _strip_comment(line):
    """去行尾注释。只在 # 前有空白或位于行首时才算注释，避免吃掉值里的 #。"""
    out, in_q, q = [], False, ""
    for i, ch in enumerate(line):
        if in_q:
            out.append(ch)
            if ch == q:
                in_q = False
            continue
        if ch in "\"'":
            in_q, q = True, ch
            out.append(ch)
            continue
        if ch == "#" and (i == 0 or line[i - 1] in " \t"):
            break
        out.append(ch)
    return "".join(out).rstrip()


def parse_yaml_subset(text):
    """解析 CONTRACT.md §5 所述结构。不支持的语法一律抛 ConfigError。"""
    lines = []
    for n, raw in enumerate(text.splitlines(), 1):
        if "\t" in raw.split("#")[0]:
            raise ConfigError("第 %d 行含制表符；请用空格缩进" % n)
        body = _strip_comment(raw)
        if body.strip():
            lines.append((n, len(body) - len(body.lstrip(" ")), body.strip()))

    def block(idx, indent):
        """返回 (value, next_idx)。indent 是本块的缩进量。"""
        if idx >= len(lines):
            return None, idx
        if lines[idx][2].startswith("- "):
            items = []
            while idx < len(lines) and lines[idx][1] == indent and lines[idx][2].startswith("- "):
                n, _, body = lines[idx]
                rest = body[2:].strip()
                if ":" in rest and not rest.endswith(":"):
                    # 列表项是行内起始的映射：- name: x
                    k, v = rest.split(":", 1)
                    item = {k.strip(): _scalar(v, n)}
                    idx += 1
                    child_indent = indent + 2
                    while idx < len(lines) and lines[idx][1] >= child_indent and not lines[idx][2].startswith("- "):
                        n2, ind2, b2 = lines[idx]
                        if ind2 != child_indent:
                            raise ConfigError("第 %d 行缩进不一致" % n2)
                        if ":" not in b2:
                            raise ConfigError("第 %d 行不是 key: value" % n2)
                        k2, v2 = b2.split(":", 1)
                        if not v2.strip():
                            sub, idx = block(idx + 1, child_indent + 2)
                            item[k2.strip()] = sub
                            continue
                        item[k2.strip()] = _scalar(v2, n2)
                        idx += 1
                    items.append(item)
                elif rest:
                    items.append(_scalar(rest, n))
                    idx += 1
                else:
                    raise ConfigError("第 %d 行是空列表项" % n)
            return items, idx
        mapping = {}
        while idx < len(lines) and lines[idx][1] == indent:
            n, _, body = lines[idx]
            if body.startswith("- "):
                break
            if ":" not in body:
                raise ConfigError("第 %d 行不是 key: value：%r" % (n, body))
            k, v = body.split(":", 1)
            k = k.strip()
            if k in mapping:
                raise ConfigError("第 %d 行的键 %r 重复；重复键的取值有歧义" % (n, k))
            if v.strip():
                mapping[k] = _scalar(v, n)
                idx += 1
                continue
            if idx + 1 < len(lines) and lines[idx + 1][1] > indent:
                sub, idx = block(idx + 1, lines[idx + 1][1])
                mapping[k] = sub
            else:
                mapping[k] = None
                idx += 1
        return mapping, idx

    if not lines:
        return {}
    value, end = block(0, lines[0][1])
    if end != len(lines):
        raise ConfigError("第 %d 行缩进层级无法归属" % lines[end][0])
    return value


CONFIG_CANDIDATES = ("governance/project.yaml", "governance/project.yml")


def load_config(root, config_path=None):
    """读配置。默认读 <root>/governance/project.yaml。

    config_path 给了就读那个文件，可以在被扫描项目之外——这样才能在不往被测项目
    写任何东西的前提下扫只读项目。此时 cfg["_root"] 仍是被扫描的 root，
    cfg["_path"] 记配置文件的真实路径。

    返回 (cfg, problem)。problem 非 None 时 cfg 为 {}，调用方据此记 UNDETERMINED，
    不得取默认值当事实（契约 §5）。
    """
    if config_path is not None:
        p = os.path.abspath(config_path)
        if not os.path.isfile(p):
            return {}, "指定的外部配置 %s 不存在（--config）；本工具不回退去猜项目布局" % p
        try:
            with io.open(p, encoding="utf-8") as fh:
                cfg = parse_yaml_subset(fh.read())
        except ConfigError as exc:
            return {}, "指定的外部配置 %s 无法无歧义解析：%s" % (p, exc)
        except OSError as exc:
            return {}, "指定的外部配置 %s 读不了：%s" % (p, exc)
        if not isinstance(cfg, dict):
            return {}, "指定的外部配置 %s 的顶层不是映射" % p
        cfg["_path"] = p
        cfg["_root"] = root
        return cfg, None

    for rel in CONFIG_CANDIDATES:
        p = os.path.join(root, rel)
        if os.path.isfile(p):
            try:
                with io.open(p, encoding="utf-8") as fh:
                    cfg = parse_yaml_subset(fh.read())
            except ConfigError as exc:
                return {}, "%s 无法无歧义解析：%s" % (rel, exc)
            except OSError as exc:
                return {}, "%s 读不了：%s" % (rel, exc)
            if not isinstance(cfg, dict):
                return {}, "%s 的顶层不是映射" % rel
            cfg["_path"] = rel
            cfg["_root"] = root
            return cfg, None
    return {}, "未找到 %s；本工具不猜项目布局" % " 或 ".join(CONFIG_CANDIDATES)


def cfg_get(cfg, path, default=None):
    """按 'budgets.entry_lines' 取值，缺失返回 default。"""
    cur = cfg
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return default
        cur = cur[part]
    return cur


def is_tailored_out(cfg, check_name):
    """项目是否把该检查裁剪掉了。返回 (是否裁剪, 理由)。"""
    for item in cfg_get(cfg, "tailoring", []) or []:
        if isinstance(item, dict) and item.get("check") == check_name:
            if item.get("applicable") is False:
                return True, str(item.get("reason") or "").strip() or None
    return False, None


# --------------------------------------------------------------------------
# 文件与仓库
# --------------------------------------------------------------------------

def tracked_files(root, patterns=None):
    """git 跟踪的文件；不在 git 仓库时返回 (None, 原因)。

    用 `-z`：git 默认开 core.quotepath，会把非 ASCII 路径输出成
    `"docs/\\345\\275\\222..."` 这种转义形式。不还原就会把中文路径当成不存在，
    成批产生假 FAIL。`-z` 走 NUL 分隔、原样输出，从源头绕开这件事。
    """
    cmd = ["git", "-C", root, "ls-files", "-z"]
    if patterns:
        cmd += list(patterns)
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as exc:
        return None, "跑不了 git ls-files：%s" % exc
    if out.returncode != 0:
        err = (out.stderr or b"").decode("utf-8", "replace").strip()[:200]
        return None, "git ls-files 退出码 %d：%s" % (out.returncode, err)
    raw = (out.stdout or b"").decode("utf-8", "surrogateescape")
    return [p for p in raw.split("\0") if p.strip()], None


def read_text(path):
    with io.open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def count_lines(path):
    with io.open(path, encoding="utf-8", errors="replace") as fh:
        return sum(1 for _ in fh)


def in_frozen(cfg, relpath):
    """是否落在只读归档区（不承担更新义务，见 01 §3.1）。"""
    rel = relpath.replace("\\", "/")
    for prefix in cfg_get(cfg, "layout.frozen", []) or []:
        pre = str(prefix).replace("\\", "/").rstrip("/")
        if rel == pre or rel.startswith(pre + "/"):
            return True
    return False
