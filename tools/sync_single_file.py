#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 index.html 同步成各处需要的单文件副本。

index.html 是唯一真源，下面每一处副本都必须与它逐字节一致：

1. **仓库内** `分镜工作台.html` —— 双击打开时用的文件名（内容和部署版 index.html 相同）。
2. **桌面版目录**里的 `分镜工作台.html` —— 带快捷方式与独立 `.profile` 的那一份
   （自己日常用、以及打包发给别人的都是它），默认在 `F:\\OpenCode项目\\分镜工作台\\`。

第 2 处不在仓库里、路径因机器而异，所以按「命令行 > 环境变量 > 内置默认」解析，
**目录不存在就跳过**（换台电脑 clone 本仓库不会因此报错）。
两处都做了幂等：内容已经一致就跳过写入，不白改 mtime。

用法：
    python tools/sync_single_file.py                  # 写入所有副本
    python tools/sync_single_file.py --check          # 只校验，有不一致则退出码 1
    python tools/sync_single_file.py --no-desktop     # 只同步仓库内那一份
    python tools/sync_single_file.py --desktop "D:\\某个目录"      # 指定桌面版目录（可重复）
    set SBW_DESKTOP_DIR=F:\\OpenCode项目\\分镜工作台               # 或用环境变量（; 或 , 分隔多个）
"""
import hashlib
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "index.html"
DST = ROOT / "分镜工作台.html"
APP_NAME = "分镜工作台.html"

# 桌面版目录的内置默认（本机路径）。换机器用 --desktop 或 SBW_DESKTOP_DIR 覆盖即可。
DEFAULT_DESKTOP_DIRS = [r"F:\OpenCode项目\分镜工作台"]
ENV_DESKTOP = "SBW_DESKTOP_DIR"
SHARE_PKG = "分镜工作台-分享版.zip"


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def parse_desktop_args(argv):
    """收集 --desktop DIR / --desktop=DIR（可重复）。没给返回 None 表示「未指定」。"""
    dirs = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--desktop":
            if i + 1 < len(argv):
                dirs.append(argv[i + 1])
                i += 2
                continue
        elif a.startswith("--desktop="):
            dirs.append(a.split("=", 1)[1])
        i += 1
    return dirs or None


def resolve_desktop_dirs(argv):
    """返回 (目录列表, 来源说明)。"""
    cli = parse_desktop_args(argv)
    if cli:
        return [Path(p) for p in cli], "命令行 --desktop"
    env = os.environ.get(ENV_DESKTOP, "").strip()
    if env:
        parts = [p.strip().strip('"') for p in env.replace(";", ",").split(",") if p.strip()]
        if parts:
            return [Path(p) for p in parts], f"环境变量 {ENV_DESKTOP}"
    return [Path(p) for p in DEFAULT_DESKTOP_DIRS], "内置默认"


def sync_repo_copy(check_only: bool, src_md5: str) -> int:
    """仓库内那一份：不存在或不一致都算失败。"""
    print(f"[仓库内] {DST}")
    if check_only:
        if not DST.exists():
            print("         不存在 —— 需要同步（跑一次不带 --check 的本脚本）")
            return 1
        d = md5(DST)
        if d == src_md5:
            print(f"         一致 ✓  md5 {d[:8]}")
            return 0
        print(f"         不一致 ✗  {d[:8]} vs index.html {src_md5[:8]}")
        return 1
    if DST.exists() and md5(DST) == src_md5:
        print(f"         已是最新，跳过（md5 {src_md5[:8]}）")
        return 0
    shutil.copyfile(SRC, DST)
    print(f"         已同步（{DST.stat().st_size} 字节，md5 {src_md5[:8]}）")
    return 0


def sync_desktop_copies(argv, check_only: bool, src_md5: str):
    """同步仓库外的桌面版副本。返回 (退出码, 本次真正写过的路径列表)。"""
    targets, how = resolve_desktop_dirs(argv)
    print(f"\n[桌面版] 目录来源：{how}，共 {len(targets)} 个")
    rc = 0
    written = []
    for d in targets:
        dst = d / APP_NAME
        print(f"         {dst}")
        if not d.is_dir():
            print("           目录不存在，跳过（用 --desktop 或 SBW_DESKTOP_DIR 指定别的目录）")
            continue
        if check_only:
            if not dst.exists():
                print("           不存在 —— 需要同步")
                rc = 1
                continue
            dm = md5(dst)
            if dm == src_md5:
                print(f"           一致 ✓  md5 {dm[:8]}")
            else:
                print(f"           不一致 ✗  {dm[:8]} vs index.html {src_md5[:8]}")
                rc = 1
            continue
        if dst.exists() and md5(dst) == src_md5:
            print(f"           已是最新，跳过（md5 {src_md5[:8]}）")
            continue
        shutil.copyfile(SRC, dst)
        print(f"           已同步（{dst.stat().st_size} 字节，md5 {src_md5[:8]}）")
        written.append(dst)
    return rc, written


def warn_stale_share_package(dst: Path):
    """桌面版本体刚更新过：已存在的分享包就是旧的了，提醒重打。

    分享包由「制作分享包.bat」生成在**桌面版文件夹的上一级**（即 `dst.parent.parent`）；
    这里两个位置都探一下，免得路径规则一变就漏提醒。
    """
    for parent in (dst.parent.parent, dst.parent):
        pkg = parent / SHARE_PKG
        if pkg.exists():
            print(f"         ⚠ 提醒：{pkg} 还是旧版本，"
                  f"要发给别人的话请重跑「制作分享包.bat」")
            return


def main() -> int:
    if not SRC.exists():
        print(f"源文件不存在：{SRC}", file=sys.stderr)
        return 2

    argv = sys.argv[1:]
    check_only = "--check" in argv
    src_md5 = md5(SRC)
    print(f"真源 index.html  {SRC.stat().st_size} 字节  md5 {src_md5[:8]}\n")

    rc = sync_repo_copy(check_only, src_md5)

    if "--no-desktop" in argv:
        print("\n[桌面版] 已用 --no-desktop 跳过")
    else:
        r, written = sync_desktop_copies(argv, check_only, src_md5)
        rc = max(rc, r)
        for w in written:
            warn_stale_share_package(w)

    if not check_only:
        print("\n完成。" + ("（所有副本都已一致）" if rc == 0 else ""))
    return rc


if __name__ == "__main__":
    sys.exit(main())
