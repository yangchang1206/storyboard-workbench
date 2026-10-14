/**
 * 生成 PWA 所需的 PNG 图标（192 / 512）。
 *
 * manifest.webmanifest 原本只声明了 icon.svg（sizes: "any"）。部分环境（尤其 Android/Chrome
 * 的「添加到主屏幕」，以及某些桌面安装流程）不接受 SVG 作为安装图标，缺 PNG 会导致装不上
 * 或图标空白，所以这里把 icon.svg 光栅化成两个标准尺寸。
 *
 * 用无头 Chrome 的 --screenshot 直接出图：零额外依赖，矢量缩放交给浏览器，边缘最干净。
 * （不用 CDP：本机 Chrome 156 的新无头模式在给 about:blank 时不再创建 page 目标。）
 *
 * 用法：node tools/make_icons.mjs
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SIZES = [192, 512];

/* 把 icon.svg 的 viewBox 换成目标尺寸，铺满整页且不留边距 */
function htmlFor(svg, size){
  const scaled = svg.replace(/<svg([^>]*?)>/,
    (m, attrs) => '<svg' + attrs.replace(/\s(width|height)="[^"]*"/g, "") +
      ' width="' + size + '" height="' + size + '">');
  return '<!doctype html><meta charset="utf-8">'
    + '<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>'
    + scaled;
}

/* 读 PNG 头里的宽高，用来确认真的出图了（不靠文件是否存在来判断成功） */
function pngSize(buf){
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;   /* PNG 魔数 */
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function main(){
  const svg = readFileSync(join(ROOT, "icon.svg"), "utf8");
  const dir = mkdtempSync(join(tmpdir(), "sb-icons-"));
  let failed = false;
  try {
    for (const size of SIZES){
      const page = join(dir, "icon-" + size + ".html");
      const out = join(ROOT, "icon-" + size + ".png");
      writeFileSync(page, htmlFor(svg, size), "utf8");
      const r = spawnSync(CHROME, [
        "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
        "--disable-extensions", "--mute-audio", "--hide-scrollbars", "--no-proxy-server",
        "--default-background-color=00000000", "--force-device-scale-factor=1",
        "--window-size=" + size + "," + size,
        "--screenshot=" + out,
        pathToFileURL(page).href,
      ], { encoding: "utf8", timeout: 90000 });

      let buf = null;
      try { buf = readFileSync(out); } catch (e){ buf = null; }
      const dim = buf ? pngSize(buf) : null;
      if (!dim || dim.w !== size || dim.h !== size){
        console.error("  ✗ icon-" + size + ".png 生成失败："
          + (dim ? "得到 " + dim.w + "x" + dim.h : "没有可用的 PNG 输出")
          + (r.stderr ? " / " + String(r.stderr).trim().slice(0, 200) : ""));
        failed = true;
        continue;
      }
      console.log("  ✓ icon-" + size + ".png  " + dim.w + "x" + dim.h + "  " + buf.length + " 字节");
    }
    if (failed){
      console.error("\n图标生成有失败项。请确认 Chrome 路径，或设置 CHROME_PATH 环境变量。");
      process.exitCode = 1;
      return;
    }
    console.log("\nPNG 图标生成完成。manifest.webmanifest 已声明这两个尺寸，"
      + "tools/build_site.py 会把它们一起放进 site/。");
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}
main();
