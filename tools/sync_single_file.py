#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 index.html 同步成同名本地双击副本 `分镜工作台.html`。

为什么要有这一步：仓库里同时存在 index.html（部署/PWA 入口）与 `分镜工作台.html`（用户双击打开的名字），
两者内容必须逐字节一致，手工同步极易漏改导致「部署版 ≠ 本地版」。
这里把 `分镜工作台.html` 当作 index.html 的构建产物，改完 index.html 跑一次本脚本即可。

用法：
    python tools/sync_single_file.py          # 写入
    python tools/sync_single_file.py --check  # 只校验是否一致，不一致则退出码 1
"""
import hashlib
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "index.html"
DST = ROOT / "分镜工作台.html"
# 双击打开时不需要 PWA（代码里已判断 file: 协议不注册 SW），但保留 manifest 引用无副作用。


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def main() -> int:
    if not SRC.exists():
        print(f"源文件不存在：{SRC}", file=sys.stderr)
        return 2
    check_only = "--check" in sys.argv

    if check_only:
        if not DST.exists():
            print("分镜工作台.html 不存在，需要生成")
            return 1
        same = md5(SRC) == md5(DST)
        print(("一致 ✓ " if same else "不一致 ✗ ") + f"index.html {md5(SRC)[:8]} vs 分镜工作台.html {md5(DST)[:8]}")
        return 0 if same else 1

    shutil.copyfile(SRC, DST)
    print(f"已同步：index.html → 分镜工作台.html（{DST.stat().st_size} 字节，md5 {md5(DST)[:8]}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
