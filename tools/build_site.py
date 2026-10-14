#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""构建部署目录 site/。

site/ 是「真正发布出去的那一份」：不放 docs/、tools/、README，避免把源码与说明一起暴露在线上。
index.html 仍是唯一真源，改完 index.html 后跑本脚本 + sync_single_file.py 即可。

用法：python tools/build_site.py
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
FILES = ["index.html", "manifest.webmanifest", "sw.js", "icon.svg", "icon-192.png", "icon-512.png"]


def main():
    SITE.mkdir(exist_ok=True)
    for name in FILES:
        src = ROOT / name
        if not src.exists():
            print(f"[跳过] 缺少 {name}")
            continue
        shutil.copyfile(src, SITE / name)
        print(f"  {name}  {src.stat().st_size} 字节")
    # 可选：同源解析库目录（放了就用同源优先，没放会自动走 CDN 兜底）
    vendor = ROOT / "vendor"
    if vendor.is_dir():
        dst = SITE / "vendor"
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(vendor, dst)
        print("  vendor/ 已一并复制")
    print(f"\nsite/ 构建完成：{SITE}")


if __name__ == "__main__":
    main()
