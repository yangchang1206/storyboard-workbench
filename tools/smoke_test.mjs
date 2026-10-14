/**
 * 分镜工作台 · CDP 冒烟测试（零依赖，Node 22 内置 WebSocket）
 *
 * 单文件 HTML 应用没有测试框架，历史上最怕的是「改完看着没问题、一打开整个前端失效」。
 * 本脚本用真实 Chrome 无头模式加载页面，抓控制台异常，并对关键逻辑做断言。
 *
 * 用法：
 *   node tools/smoke_test.mjs http://127.0.0.1:8899/index.html
 *   node tools/smoke_test.mjs file:///D:/项目/项目2/storyboard-workbench/index.html
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";

const CHROME = process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const TARGET_URL = process.argv[2] || "http://127.0.0.1:8899/index.html";

const freePort = () => new Promise(res => {
  const s = net.createServer();
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 页面内跑的断言，返回 JSON 字符串 */
const PROBE = `(async () => {
  const out = {}, notes = [];
  const ok = (name, cond, extra) => { out[name] = !!cond; if (!cond) notes.push(name + (extra ? " → " + extra : "")); };

  // —— 基础：初始化是否真的跑完 ——
  ok("规则渲染 15 条", document.querySelectorAll("#ruleBox .rule").length === 15,
     "实际 " + document.querySelectorAll("#ruleBox .rule").length);

  // —— P0-2 价格表 / P0-1 模型名（对齐官方现价）——
  const f = MODELS["deepseek-flash"], p = MODELS["deepseek-v4-pro"];
  ok("flash 价目=官方现价", f.inPeak === 2 && f.inOff === 1 && f.outPeak === 8 && f.outOff === 4 && f.inHitPeak === 0.04 && f.inHitOff === 0.02, JSON.stringify(f));
  ok("pro 价目=官方现价", p.inPeak === 9 && p.inOff === 4.5 && p.outPeak === 27 && p.outOff === 13.5 && p.inHitPeak === 0.3, JSON.stringify(p));

  // —— P1-3 峰谷判定必须与「本机时区」无关，且以北京时间为准 ——
  //  用固定时刻断言，避免「自己和自己比」的循环验证（上一版就是这么漏掉时区补偿重复计算的）
  const peakCases = [
    ["2026-10-14T01:00:00Z", true,  "周三 北京09:00 高峰起点"],
    ["2026-10-14T02:00:00Z", true,  "周三 北京10:00 高峰"],
    ["2026-10-14T03:59:00Z", true,  "周三 北京11:59 高峰"],
    ["2026-10-14T04:00:00Z", false, "周三 北京12:00 高峰结束"],
    ["2026-10-14T06:00:00Z", true,  "周三 北京14:00 高峰"],
    ["2026-10-14T10:00:00Z", false, "周三 北京18:00 高峰结束"],
    ["2026-10-14T00:00:00Z", false, "周三 北京08:00 空闲"],
    ["2026-10-17T02:00:00Z", false, "周六 北京10:00 周末全天空闲"],
  ];
  const peakBad = peakCases.filter(([iso, exp]) => isPeak(Date.parse(iso)) !== exp).map(([iso, , d]) => d);
  ok("峰谷判定（8 个定点）", peakBad.length === 0, peakBad.join(" / "));

  // —— P0-3 esc 必须转义引号 ——
  ok("esc 转义引号", esc('a"b\\'c<d&e') === "a&quot;b&#39;c&lt;d&amp;e", esc('a"b'));

  // —— P1-1 多集批量 ——
  const fullComp = () => ({台词总览:[],动作总览:[],集型:"对话对峙集"});
  state.eps = [{id:"ep1",title:"第1集",text:"a"},{id:"ep2",title:"第2集",text:"b"},{id:"ep3",title:"第3集",text:"c"}];
  state.comp = { ep1:fullComp(), ep2:fullComp() }; state.plans = {}; state.shots = {}; state.sel = ["ep1","ep2","ep3"];
  const ids = a => a.map(e => e.id).join(",");
  ok("多选只补未完成的集", ids(batchTargets(hasCompOf)) === "ep3", ids(batchTargets(hasCompOf)));
  state.sel = ["ep1"];
  ok("单选允许重跑", ids(batchTargets(hasCompOf)) === "ep1", ids(batchTargets(hasCompOf)));
  state.sel = ["ep1","ep2","ep3"]; refreshPipeline();
  ok("门控：3集仅2集压缩→②禁用", document.getElementById("btnRun2").disabled === true);
  ok("状态栏显示批次进度", /2\\/3 集压缩/.test(document.getElementById("pipeState").textContent),
     document.getElementById("pipeState").textContent);

  // —— 容错：缺字段的压缩结果 / 缺断点的规划不得让整页崩掉 ——
  state.comp = { ep1:{} }; state.eps = [{id:"ep1",title:"第1集",text:"x"}]; state.sel = ["ep1"];
  let crash = false;
  try { refreshPipeline(); } catch (e) { crash = String(e); }
  ok("缺字段的压缩结果不崩页", crash === false, crash);
  state.plans = { ep1:{} };
  crash = false;
  try { refreshPipeline(); } catch (e) { crash = String(e); }
  ok("缺断点的规划不崩页", crash === false, crash);

  // —— P0-3 回归：模型输出含双引号时不得撑破属性 ——
  state.eps = [{id:"ep1",title:"第1集",text:"x"}]; state.sel = ["ep1"];
  state.comp = { ep1:Object.assign(fullComp(), {情绪曲线:"低→高",集型理由:"测试"}) };
  state.plans = { ep1:{断点:[{id:1,内容摘要:"测试",总时长:10}],合计:10} };
  const evil = '1" onfocus=alert(1) x="';
  state.shots = { ep1:{ 1:[{镜头号:evil,转场:"硬切",景别:"近景",机位:"平视",运镜:"固定",时长:3,画面内容:"c",台词:"甲：你好",视觉建议:"v"}] } };
  refreshPipeline();
  const inp = document.querySelector('#shotList input[data-f="镜头号"]');
  ok("引号字段完整回填", !!inp && inp.value === evil, inp ? inp.value : "no input");
  ok("未注入出多余属性", document.querySelectorAll("#shotList [onfocus]").length === 0);
  ok("镜头表渲染出 1 行", document.querySelectorAll("#shotList tbody tr").length === 1);

  // —— P2-8 / 机位开关：MD 导出 ——
  state.expTech = true; renderSummary();
  const md = buildMD();
  ok("MD 含机位行（开关开）", md.includes("机位：平视"));
  ok("MD 含视觉建议行（开关开）", md.includes("视觉建议：v"));
  ok("MD 第五节表头已修正", md.includes("| 镜头 | 机位/角度 | 景别/构图 |"));
  state.expTech = false;
  const md2 = buildMD();
  ok("MD 默认不含机位行", !md2.includes("机位：平视"));

  // —— P1-2 思考模式不传 temperature / P1-4 缓存命中分账 / P1-7 超时 ——
  const realFetch = window.fetch;
  let captured = null;
  window.fetch = async (url, init) => {
    captured = JSON.parse(init.body);
    return new Response(JSON.stringify({
      usage:{ prompt_tokens:10, completion_tokens:5, prompt_cache_hit_tokens:4, prompt_cache_miss_tokens:6 },
      choices:[{ message:{ content: '{"ok":1}' } }]
    }), { status:200, headers:{"Content-Type":"application/json"} });
  };
  state.apiKey = "sk-test"; state.model = "deepseek-flash"; state.tok = {}; state.abortCtrl = null;
  state.effort = "high";
  await callDeepSeek([{role:"user",content:"hi"}], { json:true, temperature:0.3 });
  ok("思考模式不传 temperature", !Object.prototype.hasOwnProperty.call(captured, "temperature"), JSON.stringify(Object.keys(captured)));
  ok("思考模式带 reasoning_effort", captured.reasoning_effort === "max" && captured.thinking.type === "enabled", JSON.stringify(captured.thinking));
  ok("缓存命中/未命中分别记账", JSON.stringify(state.tok["deepseek-flash"]) === '{"in":6,"out":5,"hit":4}', JSON.stringify(state.tok["deepseek-flash"]));
  state.effort = "off"; captured = null;
  await callDeepSeek([{role:"user",content:"hi"}], { json:true, temperature:0.3 });
  ok("思考关闭时传 temperature", captured.temperature === 0.3, String(captured.temperature));

  window.fetch = (url, init) => new Promise((res, rej) => {
    init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name:"AbortError" })));
  });
  let tMsg = "", t0 = Date.now();
  try { await fetchWithTimeout("http://127.0.0.1:1/x", {}, 80, null); } catch (e) { tMsg = e.message; }
  ok("请求超时能中止（非静默挂起）", tMsg === "TIMEOUT", tMsg + " / " + (Date.now() - t0) + "ms");
  window.fetch = realFetch;

  // —— 费用估算：命中价 ≠ 未命中价，且峰谷要用对档位 ——
  const realNow = Date.now;
  Date.now = () => Date.parse("2026-10-14T02:00:00Z");   // 周三 北京 10:00 → 高峰
  state.tok = { "deepseek-flash": { in:1000000, out:0, hit:0 } }; renderTokens();
  out.高峰_100万未命中入 = document.getElementById("tokCost").textContent;
  out.高峰_时段标签 = document.getElementById("tokTz").textContent;
  Date.now = () => Date.parse("2026-10-17T02:00:00Z");   // 周六 北京 10:00 → 空闲
  renderTokens();
  out.周末_100万未命中入 = document.getElementById("tokCost").textContent;
  out.周末_时段标签 = document.getElementById("tokTz").textContent;
  state.tok = { "deepseek-flash": { in:0, out:0, hit:1000000 } }; renderTokens();
  out.周末_100万命中入 = document.getElementById("tokCost").textContent;
  Date.now = realNow;
  ok("高峰按 2 元/M 计（flash 未命中入）", out.高峰_100万未命中入 === "2.0000", out.高峰_100万未命中入);
  ok("周末按空闲 1 元/M 计", out.周末_100万未命中入 === "1.0000", out.周末_100万未命中入);
  ok("命中价 0.02 元/M 远低于未命中", out.周末_100万命中入 === "0.0200", out.周末_100万命中入);
  ok("时段标签正确", out.高峰_时段标签 === "高峰" && out.周末_时段标签 === "空闲",
     out.高峰_时段标签 + "/" + out.周末_时段标签);

  // —— 分集与快照提示 ——
  out.DEMO_分集数 = parseEpisodes(DEMO_SCRIPT).length;
  ok("示例剧本可分集", out.DEMO_分集数 >= 2, String(out.DEMO_分集数));
  state.eps = parseEpisodes(DEMO_SCRIPT); state.epsSnap = state.scriptText = DEMO_SCRIPT; state.sel = ["ep1"];
  ok("未改动时不提示过期", isEpsStale() === false);
  state.scriptText = DEMO_SCRIPT + "\\n追加一行";
  ok("改动后标记分集过期", isEpsStale() === true);
  renderEpList();
  ok("过期时给出可见提示", /剧本已改动/.test(document.getElementById("epList").textContent));
  state.scripts = null;

  // —— 多集批量 + 逐集查看（回归：勾 3 集时中/右栏只显示第 1 集）——
  //  用假模型响应把三步流水线在 3 集上真跑一遍，并让每集返回可区分的标记，确保断言的是「显示跟着切换」
  state.scriptText = "第36集 起\\n甲：三十六集内容，够长。\\n第37集 承\\n乙：三十七集内容，够长。\\n第38集 转\\n丙：三十八集内容，够长。";
  state.eps = parseEpisodes(state.scriptText); state.epsSnap = state.scriptText;
  state.sel = state.eps.map(e => e.id); state.viewId = "";
  state.comp = {}; state.plans = {}; state.shots = {}; state.tok = {};
  state.apiKey = "sk-test"; state.effort = "off"; state.abortCtrl = null;
  window.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const user = body.messages[body.messages.length - 1].content || "";
    const tag = ["第36集","第37集","第38集"].find(t => user.includes(t)) || "?";
    let payload;
    if (user.includes("第一步：剧情压缩"))
      payload = { 集型:"集型-" + tag, 台词总览:[], 动作总览:[], 人物:[], 场景:[], 核心道具:[], 情绪曲线:"平稳→紧张" };
    else if (user.includes("第二步：断点规划"))
      payload = { 断点:[{id:1,内容摘要:"段一-" + tag,台词时长:10,动作时长:15,总时长:25,位置锚点:"画中",角色锚点:"甲"}], 合计:25, 说明:"" };
    else
      payload = { 镜头:[{镜头号:tag,转场:"硬切",景别:"近景",机位:"平视",运镜:"固定",时长:5,画面内容:"c",台词:"甲：你好",字数:3,语速:3.5,台词时长:1,视觉建议:"v"}] };
    return new Response(JSON.stringify({
      usage:{ prompt_tokens:1, completion_tokens:1, prompt_cache_hit_tokens:0, prompt_cache_miss_tokens:1 },
      choices:[{ message:{ content: JSON.stringify(payload) } }]
    }), { status:200, headers:{ "Content-Type":"application/json" } });
  };
  await runStep1(); await runStep2(); await runStep3();
  window.fetch = realFetch;

  ok("批量：3 集都完成压缩", Object.keys(state.comp).length === 3, Object.keys(state.comp).join(","));
  ok("批量：3 集都完成规划", Object.keys(state.plans).length === 3, Object.keys(state.plans).join(","));
  ok("批量：3 集都出了分镜", Object.keys(state.shots).length === 3, Object.keys(state.shots).join(","));

  const epView = document.getElementById("epViewSel");
  state.viewId = "ep2"; refreshPipeline();
  ok("可切到第 37 集查看", curEp() && curEp().title === "第37集", curEp() ? curEp().title : "null");
  ok("中栏概览真的换成了第 37 集", document.getElementById("overview").textContent.includes("集型-第37集"),
     document.getElementById("overview").textContent.slice(0, 60));
  ok("镜头表真的换成了第 37 集", /第37集/.test(document.getElementById("shotList").textContent),
     document.querySelector("#shotList tbody tr") ? "有行" : "空");
  ok("多集时出现集数下拉", epView && epView.style.display !== "none" && epView.options.length === 3,
     epView ? epView.options.length + " 项" : "无元素");
  ok("分集列表带完成度标记", /压规镜/.test(document.getElementById("epList").textContent));
  ok("出现「导出全部」按钮", document.getElementById("btnExportAll").style.display !== "none");

  const mds = selEps().map(e => buildMD(e));
  ok("逐集都能单独导出 MD", mds.every(m => m && m.includes("分镜脚本")), mds.map(m => m ? m.length : 0).join(","));
  out.三集MD字节 = mds.map(m => m ? m.length : 0).join(" / ");
  out.第38集导出标题行 = (buildMD(selEps()[2]) || "").split("\\n")[0];

  out._failed = notes;
  return JSON.stringify(out);
})()`;

async function main() {
  const port = await freePort();
  const userDir = mkdtempSync(join(tmpdir(), "sb-smoke-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--mute-audio", "--window-size=1600,1000",
    /* 本机有系统代理（Clash），不加这个参数时 Chrome 会把 127.0.0.1 的请求也丢给代理 → ERR_CONNECTION */
    "--no-proxy-server",
    `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`, TARGET_URL,
  ], { stdio: "ignore" });

  let ws, msgId = 0;
  const pending = new Map();
  const pageErrors = [];
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });

  try {
    let ver = null;
    for (let i = 0; i < 60; i++) {
      try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; }
      catch { await sleep(250); }
    }
    if (!ver) throw new Error("Chrome 调试端口未就绪");

    let target = null;
    for (let i = 0; i < 40; i++) {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find(t => t.type === "page" && t.url.startsWith("http") ) ||
               list.find(t => t.type === "page" && t.url.startsWith("file"));
      if (target && target.webSocketDebuggerUrl) break;
      await sleep(250);
    }
    if (!target) throw new Error("找不到页面调试目标");

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = e => rej(new Error("WS 连接失败")); });
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id); pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
        return;
      }
      if (m.method === "Runtime.exceptionThrown")
        pageErrors.push("异常: " + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
        pageErrors.push("console.error: " + m.params.args.map(a => a.value ?? a.description).join(" "));
      if (m.method === "Log.entryAdded" && m.params.entry.level === "error")
        pageErrors.push("日志: " + m.params.entry.text);
    };

    /** send() 已解包一层（resolve 的是 CDP 消息的 result），取值走 r.result.value */
    const evalVal = async (expression) => {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true });
      if (!r || r.exceptionDetails) return undefined;
      return r.result?.value;
    };

    await send("Runtime.enable");
    await send("Log.enable");
    await send("Page.enable");
    /* 等页面真正加载完 */
    await send("Page.navigate", { url: TARGET_URL }).catch(() => {});
    for (let i = 0; i < 60; i++) {
      if ((await evalVal("document.readyState")) === "complete") break;
      await sleep(250);
    }
    await sleep(600);

    const href = String((await evalVal("location.href")) || "");
    if (href.startsWith("chrome-error")) {
      throw new Error("页面没加载成功（chrome-error）—— 检查本地服务器是否在跑、以及是否被系统代理拦截");
    }

    const r = await send("Runtime.evaluate", { expression: PROBE, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("页面内断言抛出异常：" + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    if (!r.result || r.result.value === undefined) {
      throw new Error("断言脚本没有返回结果，原始响应：" + JSON.stringify(r).slice(0, 800));
    }
    const out = JSON.parse(r.result.value);

    const failed = out._failed || [];
    const asserts = Object.entries(out).filter(([k, v]) => typeof v === "boolean" && k !== "_failed");
    const pass = asserts.filter(([, v]) => v).length;

    console.log(`\n断言：${pass}/${asserts.length} 通过`);
    if (failed.length) failed.forEach(f => console.log("  ✗ " + f));
    console.log("\n实测数据：");
    Object.entries(out).filter(([k, v]) => typeof v !== "boolean").forEach(([k, v]) => console.log(`  ${k}: ${v}`));

    if (pageErrors.length) {
      console.log("\n页面报错（" + pageErrors.length + "）：");
      [...new Set(pageErrors)].forEach(e => console.log("  ! " + e));
    } else {
      console.log("\n页面无控制台报错 ✓");
    }
    process.exitCode = (failed.length || pageErrors.length) ? 1 : 0;
    if (!failed.length && !pageErrors.length) console.log("\n冒烟测试全部通过 ✓");
  } catch (e) {
    console.error("冒烟测试失败：" + e.message);
    process.exitCode = 2;
  } finally {
    try { ws?.close(); } catch {}
    chrome.kill("SIGKILL");
    await sleep(300);
    try { rmSync(userDir, { recursive: true, force: true }); } catch {}
  }
}

main();
