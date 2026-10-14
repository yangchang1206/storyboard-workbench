#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""分镜工作台 · 内联脚本语法校验

单文件 HTML 的致命风险是「一行残留字符导致整段脚本 SyntaxError，整个前端失效」。
本脚本把 HTML 里所有 <script>...</script> 内联块抽出来，逐个交给 node --check。

用法：
    python tools/check_inline_js.py [要检查的 html ...]
不给参数时默认检查 index.html 与 分镜工作台.html。
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TARGETS = ["index.html", "分镜工作台.html"]
# 只匹配没有 src 属性的内联脚本
SCRIPT_RE = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.S | re.I)


def find_node():
    for cand in ("node", r"C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"):
        try:
            subprocess.run([cand, "--version"], capture_output=True, check=True)
            return cand
        except Exception:
            continue
    return None


def check(html_path: Path, node: str) -> int:
    src = html_path.read_text(encoding="utf-8")
    blocks = SCRIPT_RE.findall(src)
    if not blocks:
        print(f"[跳过] {html_path.name}：没有内联脚本")
        return 0
    bad = 0
    for i, code in enumerate(blocks, 1):
        if not code.strip():
            continue
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
            f.write(code)
            tmp = f.name
        r = subprocess.run([node, "--check", tmp], capture_output=True, text=True, encoding="utf-8", errors="replace")
        status = "OK" if r.returncode == 0 else "FAIL"
        print(f"[{status}] {html_path.name} 第 {i} 块内联脚本（{len(code.encode('utf-8'))} 字节）")
        if r.returncode != 0:
            bad += 1
            print((r.stderr or r.stdout or "").strip()[:2000])
        Path(tmp).unlink(missing_ok=True)
    return bad


def main() -> int:
    node = find_node()
    if not node:
        print("找不到可用的 node，无法校验", file=sys.stderr)
        return 2
    args = sys.argv[1:] or DEFAULT_TARGETS
    total_bad = 0
    for a in args:
        p = Path(a)
        if not p.is_absolute():
            p = ROOT / a
        if not p.exists():
            print(f"[跳过] 文件不存在：{p}", file=sys.stderr)
            continue
        total_bad += check(p, node)
    print("\n结论：" + ("全部通过 ✓" if total_bad == 0 else f"{total_bad} 个块存在语法错误 ✗"))
    return 1 if total_bad else 0


if __name__ == "__main__":
    sys.exit(main())
