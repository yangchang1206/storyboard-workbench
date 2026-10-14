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

  // —— 剧名推断（回归：旧版把「第一行非分集标记的内容」当剧名，实测取到台词或场景描述）——
  const titleFails = [];
  const chk = (label, setup, want) => {
    setup();
    const got = dramaTitle();
    if (got !== want) titleFails.push(label + " 得到「" + got + "」期望「" + want + "」");
  };
  chk("手填优先于一切", () => {
    state.dramaTitle = "手填剧名"; state.scriptFile = "文件剧名.docx"; state.scriptText = "标题行\\n第1集";
  }, "手填剧名");
  chk("文件名优先于标题行", () => {
    state.dramaTitle = ""; state.scriptFile = "福女入府定风华.docx"; state.scriptText = "退婚后我靠山神系统成首富\\n第1集";
  }, "福女入府定风华");
  chk("无文件名时取标题行", () => {
    state.dramaTitle = ""; state.scriptFile = "";
    state.scriptText = "退婚后，我靠山神系统成首富\\n第1集 退婚\\n1993年，北方小城。家属楼筒子楼走廊，灯泡昏黄。";
  }, "退婚后，我靠山神系统成首富");
  chk("不取台词行", () => {
    state.dramaTitle = ""; state.scriptFile = "";
    state.scriptText = "第1集 退婚\\n陈阳：我去找老赵说说，他欠我的工钱也该结了。";
  }, "未命名剧集");
  chk("不取场景描述行", () => {
    state.dramaTitle = ""; state.scriptFile = "";
    state.scriptText = "1993年，北方小城。家属楼筒子楼走廊，灯泡昏黄。\\n第1集 退婚";
  }, "未命名剧集");
  ok("剧名推断（5 种情形）", titleFails.length === 0, titleFails.join(" / "));

  state.dramaTitle = "测试剧名"; state.scriptFile = "";
  out.导出标题行 = (buildMD(selEps()[0]) || "").split("\\n")[0];
  ok("导出标题真的用了剧名", out.导出标题行.includes("测试剧名"), out.导出标题行);

  // ============ v1.7 模板 A/B/C/D/E 导出 ============
  // 五个模板共用同一份 comp/plans/shots，所以这里用同一份夹具渲染五遍做对比。
  const shotTpl = (no, extra) => Object.assign({
    镜头号:no, 转场:"硬切（切点理由：换说话人）", 景别:"近景→特写·面部（楚景珩）",
    机位:"正面偏侧·突出表情·主角更有力量，低角度仰拍",
    运镜:"缓慢推进（slow dolly in），正常速度", 时长:4.5,
    画面内容:"裴灼昀扶住门框起身，指节按在伤口处，随后侧身让出半个身位",
    台词:"楚景珩（关切打量）：五弟，你伤得怎么样？（11字）",
    情绪标签:"[gentle whisper]", 情绪标记:"【压火·一字一顿】",
    字数:11, 语速:3.5, 台词时长:3.1,
    视觉建议:"侧逆光压暗背景，窗棂透光作轮廓光，整体偏暖"
  }, extra || {});
  state.projects = []; state.curId = null;
  state.eps = [{id:"tp1",title:"第1集",text:"x"}]; state.sel = ["tp1"];
  state.comp = { tp1:{ 台词总览:[], 动作总览:[], 集型:"对话对峙集", 场景:["裴府正堂"],
    情绪曲线:"压抑→对峙→爆发" } };
  state.plans = { tp1:{ 合计:9.0, 断点:[{ id:1, 内容摘要:"楚景珩挡门", 台词时长:3.1, 动作时长:5.9,
    总时长:9.0, 位置锚点:"画左为门框与裴灼昀，画右为桌案与楚景珩", 角色锚点:"楚景珩：画右中景" }] } };
  state.shots = { tp1:{ 1:[shotTpl("1-1"), shotTpl("1-2"), shotTpl("1-3", {台词:""})] } };
  state.dramaTitle = "模板测试剧"; state.scriptFile = "";

  const mE = buildMD(state.eps[0], "E"), mB = buildMD(state.eps[0], "B");
  const mC = buildMD(state.eps[0], "C"), mD = buildMD(state.eps[0], "D");
  const mA = buildMD(state.eps[0], "A");
  ok("模板E 仍是六段", mE.includes("## 一、人物台词、动作与情绪总结")
     && mE.includes("## 五、本集镜头角度应用说明") && mE.includes("（模板E"), mE.slice(0, 80));
  ok("模板B 表头 6 列",
     mB.includes("| 镜头号 | 景别 | 运镜 | 运镜时长 | 画面描述（含台词/OS/VO） | 切换逻辑 |"), mB.slice(0, 120));
  ok("模板B 台词带【台词】前缀", mB.includes("【台词】楚景珩"));
  const bRows = (mB.match(/\\n\\| 1-\\d+ \\|/g) || []).length;
  ok("模板B 数据行数=镜头数", bRows === 3, String(bRows));
  ok("模板C 表头含灯光三列", mC.includes("| 切换逻辑 | 场景光 | 体积光 | 调色 |"), mC.slice(0, 160));
  const colsEmpty = lightCols({ 视觉建议:"" }, {});
  ok("模板C 无线索时三列均为—（不编造）", colsEmpty.join(",") === "—,—,—", colsEmpty.join(","));
  const colsHit = lightCols({ 视觉建议:"侧逆光压暗背景，窗棂透光作轮廓光，整体偏暖" }, {});
  ok("模板C 关键词抽取生效", colsHit[0].includes("侧逆光") && colsHit[2].includes("偏暖"), colsHit.join(" | "));
  ok("模板D 段落式无表格", mD.includes("【镜头1-1】") && !mD.includes("| --- |"));
  ok("模板D 含景别/运镜行", mD.includes("景别/运镜：近景→特写·面部（楚景珩）"));
  const aN = (mA.match(/即梦提示词 镜头1-\\d+：/g) || []).length;
  ok("模板A 每镜头一段提示词", aN === 3, String(aN));
  ok("模板A 含固定句式", mA.includes("电影级竖屏画面，9:16比例"));
  ok("模板A 含灯光方案块 7 项",
     ["类型：","核心情绪：","选用光型：","主光：","轮廓光：","氛围：","色彩倾向："].every(k => mA.includes("- " + k)));
  ok("模板A 用上压缩阶段的场景字段", mA.includes("裴府正堂"), "未用场景字段");
  ok("切模板不修改原始数据",
     state.shots.tp1[1].length === 3 && state.shots.tp1[1][0].景别 === "近景→特写·面部（楚景珩）");
  ok("模板选择器在界面上", !!document.getElementById("exportTpl")
     && document.getElementById("exportTpl").options.length === 5,
     String(document.getElementById("exportTpl") && document.getElementById("exportTpl").options.length));

  // ============ 排版 v6 四规范 + 画面内容三条红线（本轮改动回归）============
  // 背景：①「断点角色锚点」不再输出到 MD（字段仍生成，供分镜阶段自检）；
  //       ②位置锚点改场景级 —— 只有换场景/人物位置变化的断点才写该行；
  //       ③画面内容禁止人物具体位置/人物光影/场景光影（位置→锚点行，光色→视觉建议）。
  {
    const sys = buildSystem();
    ok("系统提示是排版四规范", sys.includes("排版四规范") && !sys.includes("排版五规范"),
       sys.includes("排版四规范") ? "四规范" : "仍是五规范");
    ok("系统提示含画面内容三条红线", sys.includes("画面内容红线（三条") && sys.includes("禁止写进画面内容"));

    const p3 = PROMPT_SHOT("第1集", { id:1, 内容摘要:"x", 总时长:9,
      位置锚点:"画左为门框与裴灼昀", 角色锚点:"楚景珩：左眉疤" }, { 集型:"对话对峙集" });
    ok("分镜提示是排版四规范", p3.includes("排版四规范") && !p3.includes("排版五规范"));
    ok("分镜提示的画面内容字段不再枚举走位/光变点",
       !p3.includes("走位/终点态/灯光光变点") && p3.includes("不写任何光影"));
    ok("分镜提示含画面内容三条红线", p3.includes("画面内容三条红线"));
    ok("分镜提示把角色锚点标为内部自检（不输出 MD）", p3.includes("内部自检用，不输出到 MD"));

    // 场景级位置锚点：非空直用 / 为空向上回溯 / 再变则用自己的
    const plan2 = { 合计:0, 断点:[
      { id:1, 内容摘要:"a", 位置锚点:"画左为门框", 角色锚点:"甲" },
      { id:2, 内容摘要:"b", 位置锚点:"",         角色锚点:"甲" },
      { id:3, 内容摘要:"c", 位置锚点:"画右为桌案", 角色锚点:"甲" }
    ] };
    state.plans.tp1 = plan2;
    ok("锚点·非空断点直用本断点", resolveAnchor(plan2.断点[0]) === "画左为门框",
       resolveAnchor(plan2.断点[0]));
    const r2 = resolveAnchor(plan2.断点[1]);
    ok("锚点·空断点回溯上方非空锚点",
       r2.includes("画左为门框") && r2.includes("沿用上方锚点"), r2);
    ok("锚点·位置再变化时用新锚点", resolveAnchor(plan2.断点[2]) === "画右为桌案",
       resolveAnchor(plan2.断点[2]));

    const mE2 = buildMD(state.eps[0], "E");
    ok("模板E 输出场景位置锚点行",
       mE2.includes("断点1 位置锚点：画左为门框") && mE2.includes("断点3 位置锚点：画右为桌案"));
    const anchorLines = mE2.match(/断点\\d+ 位置锚点[^\\n]*/g) || [];
    ok("模板E 位置未变的断点不输出锚点行", !mE2.includes("断点2 位置锚点"), anchorLines.join(" | ") || "无锚点行");
    ok("模板E 不再输出角色锚点行", !/断点\\d+ 角色锚点：/.test(mE2));
    const mD2 = buildMD(state.eps[0], "D");
    ok("模板D 不输出角色锚点行、保留位置锚点行",
       !/断点\\d+ 角色锚点：/.test(mD2) && mD2.includes("位置锚点"));
    state.plans.tp1 = { 合计:9.0, 断点:[{ id:1, 内容摘要:"楚景珩挡门", 台词时长:3.1, 动作时长:5.9,
      总时长:9.0, 位置锚点:"画左为门框与裴灼昀，画右为桌案与楚景珩", 角色锚点:"楚景珩：画右中景" }] };
  }

  // ============ v1.7 存储层 / 运行历史 / 完整备份 ============
  // 背景：实测 localStorage 配额只有 5,241,856 字符，旧 persist() 溢出时会把整个 key
  // 覆盖成 {apiKey,model}，等于把用户全部项目写没；且同一份业务数据被序列化了两次。

  // (0) 首次使用自动建档（v1.7 真实 Key 端到端实测暴露的 P0 回归：
  //     只序列化 projects 后，无项目时 syncCurProject 直接 return，首次用户数据不落盘）
  {
    const keep = { projects: state.projects, curId: state.curId,
      scriptText: state.scriptText, eps: state.eps, sel: state.sel,
      comp: state.comp, plans: state.plans, shots: state.shots };
    state.projects = []; state.curId = null;
    state.scriptText = "第一集 测试\\n正文"; state.eps = []; state.sel = [];
    state.comp = {}; state.plans = {}; state.shots = {};
    syncCurProject();
    ok("首次使用·有剧本时自动建档",
       state.projects.length === 1 && state.curId === state.projects[0].id
       && state.projects[0].scriptText === "第一集 测试\\n正文",
       "projects=" + state.projects.length);
    state.projects = []; state.curId = null; state.scriptText = ""; state.eps = [];
    syncCurProject();
    ok("首次使用·无数据时不建档", state.projects.length === 0, "projects=" + state.projects.length);
    Object.assign(state, keep);   /* 还原现场 */
  }

  // (1) 载荷里不得再有顶层摊平的业务副本
  state.eps = [{id:"ep1",title:"第1集",text:"a"}];
  state.scriptText = "剧本正文"; state.sel = ["ep1"];
  state.comp = { ep1:fullComp() }; state.plans = {}; state.shots = {};
  state.projects = [{ id:"p1", name:"剧一", createdAt:1, updatedAt:2, scriptText:"剧本正文",
    scriptFile:"", dramaTitle:"", eps:state.eps, epsSnap:"剧本正文", sel:["ep1"],
    comp:state.comp, plans:{}, shots:{} }];
  state.curId = "p1";
  const pl = payload();
  ok("载荷不再带顶层业务副本",
     pl.scriptText === undefined && pl.eps === undefined && pl.comp === undefined
     && pl.plans === undefined && pl.shots === undefined && pl.epsSnap === undefined,
     Object.keys(pl).join(","));
  ok("载荷保留设置与项目",
     pl.apiKey !== undefined && pl.model !== undefined && pl.rules !== undefined
     && pl.tok !== undefined && Array.isArray(pl.projects), Object.keys(pl).join(","));

  // (2) 去重后体积必须小于旧写法（顶层 + projects 一起 stringify）
  const newSize = JSON.stringify(payload()).length;
  const oldSize = JSON.stringify(Object.assign({}, payload(), {
    scriptText:state.scriptText, scriptFile:state.scriptFile, dramaTitle:state.dramaTitle,
    eps:state.eps, epsSnap:state.epsSnap, sel:state.sel,
    comp:state.comp, plans:state.plans, shots:state.shots })).length;
  out.载荷体积_去重后_旧写法 = newSize + " / " + oldSize;
  ok("去重后体积更小", newSize < oldSize, newSize + " vs " + oldSize);

  // (3) 精简镜像不含项目：配额被业务数据吃干后，设置至少还写得进去
  const slim = payloadSlim(payload());
  ok("精简镜像不含项目",
     slim.projects === undefined && slim.apiKey !== undefined && slim.rules !== undefined
     && slim.tok !== undefined, Object.keys(slim).join(","));

  // (4) 溢出保护：旧存档绝不能被为腾地方而覆盖
  const LS = "storyboard_ws_v1";
  const GUARD = "旧存档不该被覆盖";
  localStorage.setItem(LS, GUARD);
  const big = { v:2, apiKey:"k", model:"m", effort:"off", expTech:false, rules:{}, tok:{}, viewId:"",
                projects:[{ id:"pX", blob:new Array(7 * 1024 * 1024).join("x") }] };
  const mode = writeLS(big, false);          // false = 假装 IndexedDB 不可用，走 localStorage 完整存档
  updateSaveWarn(mode);                      // saveNow() 里的真实调用顺序：writeLS → updateSaveWarn
  const after = localStorage.getItem(LS);
  out["溢出落盘前32字"] = String(after).slice(0, 32);
  ok("溢出时返回 overflow", mode === "overflow", mode);
  ok("溢出不覆盖旧存档", after === GUARD, "落盘=" + String(after).slice(0, 32));
  ok("溢出时告警横幅出现", document.getElementById("saveWarn").style.display === "flex",
     document.getElementById("saveWarn").style.display);
  updateSaveWarn("full");
  ok("正常写入时告警隐藏", document.getElementById("saveWarn").style.display !== "flex");
  localStorage.removeItem(LS); localStorage.removeItem("storyboard_ws_v1_slim");

  // (5) IndexedDB 主存确实可用（否则整条新路径都没生效）
  ok("IndexedDB 主存可用", storageMode() === "IndexedDB", storageMode());

  // (6) 运行历史：前面 callDeepSeek 已经调用过，应当已自动记账
  const runs = await loadRuns();
  out.历史条数 = runs.length;
  ok("运行历史自动记账", runs.length >= 1, "条数 " + runs.length);
  const r0 = runs[0] || {};
  ok("历史含时间/模型/阶段/token/耗时",
     typeof r0.ts === "number" && !!r0.model && !!r0.stage && !!r0.tok && typeof r0.ms === "number",
     JSON.stringify({ts:typeof r0.ts, model:r0.model, stage:r0.stage, tok:r0.tok, ms:r0.ms}));
  ok("历史有成功/失败字段", typeof r0.ok === "boolean", String(r0.ok));
  ok("历史有费用字段", typeof r0.cost === "number", String(r0.cost));
  ok("历史按时间倒序", runs.every((r,i)=> i === 0 || (runs[i-1].ts||0) >= (r.ts||0)));

  // (7) 历史面板渲染 + 详情展开
  let histCrash = "";
  try { await renderHistory(); } catch(e){ histCrash = String(e); }
  ok("历史面板渲染不崩", histCrash === "", histCrash);
  ok("历史面板出现表头", !!document.querySelector("#histList .hist-row.head"));
  ok("历史行数与记录一致",
     document.querySelectorAll("#histList .hist-row[data-id]").length === runs.length,
     document.querySelectorAll("#histList .hist-row[data-id]").length + " vs " + runs.length);
  ok("历史汇总显示累计费用", /累计约/.test(document.getElementById("histStat").textContent),
     document.getElementById("histStat").textContent.slice(0, 60));
  const firstRow = document.querySelector("#histList .hist-row[data-id]");
  if (firstRow) firstRow.click();
  ok("点击行展开详情", !!document.querySelector("#histList .hist-detail"));

  // (8) 完整备份载荷
  let capName = "", capText = "";
  const realDl = downloadText;
  downloadText = (t, f) => { capText = t; capName = f; };
  state.projects = [
    { id:"p1", name:"剧一", createdAt:1, updatedAt:2, scriptText:"正文一", scriptFile:"", dramaTitle:"",
      eps:[{id:"e1",title:"第1集",text:"a"}], epsSnap:"正文一", sel:[], comp:{}, plans:{}, shots:{} },
    { id:"p2", name:"剧二", createdAt:3, updatedAt:4, scriptText:"正文二", scriptFile:"", dramaTitle:"",
      eps:[], epsSnap:"", sel:[], comp:{}, plans:{}, shots:{} }
  ];
  state.curId = "p1"; state.apiKey = "sk-x"; state.dramaTitle = "";
  exportAllBackup();
  const bk = JSON.parse(capText || "{}");
  ok("完整备份含全部项目", Array.isArray(bk.projects) && bk.projects.length === 2,
     String(bk.projects && bk.projects.length));
  ok("完整备份含设置", !!bk.settings && bk.settings.apiKey === "sk-x" && !!bk.settings.rules);
  ok("完整备份文件名规范", /完整备份/.test(capName) && /\\.json$/.test(capName), capName);
  downloadText = realDl;

  // (9) 导入完整备份必须「合并」，不能覆盖现有项目
  const beforeN = state.projects.length;
  importProjectJSON(new File([capText], "backup.json", {type:"application/json"}));
  for (let i = 0; i < 60 && state.projects.length === beforeN; i++) await new Promise(r=>setTimeout(r, 50));
  ok("导入完整备份是合并不是覆盖", state.projects.length === beforeN + 2,
     beforeN + " → " + state.projects.length);
  ok("导入后项目名带（导入）标记", state.projects.some(p => /（导入）/.test(p.name || "")));

  // (10) 清空历史后必须真的清干净
  await idbClear("runs");
  try { localStorage.removeItem("storyboard_ws_v1_runs"); } catch(e){}
  const afterClear = await loadRuns();
  ok("清空历史后无残留", afterClear.length === 0, "剩 " + afterClear.length);

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
    /** 需要页内 Promise 结果时用这个（awaitPromise 才会把 Promise 解开） */
    const evalAsync = async (expression) => {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
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
    /* v1.7 起启动是异步的（先读 IndexedDB 再 hydrate 渲染），必须等 __booted 置位再断言 */
    let booted = false;
    for (let i = 0; i < 80; i++) {
      if (await evalVal("window.__booted === true")) { booted = true; break; }
      await sleep(250);
    }
    if (!booted) {
      const diag = await evalVal("JSON.stringify({readyState:document.readyState, hasState:typeof state, idb:!!self.indexedDB, err:(document.getElementById('logBox')||{}).textContent})");
      throw new Error("页面没有完成启动（window.__booted 未置位）—— 诊断：" + diag);
    }

    const r = await send("Runtime.evaluate", { expression: PROBE, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("页面内断言抛出异常：" + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    if (!r.result || r.result.value === undefined) {
      throw new Error("断言脚本没有返回结果，原始响应：" + JSON.stringify(r).slice(0, 800));
    }
    const out = JSON.parse(r.result.value);

    /* ===== 阶段二：持久化往返（写 → 刷新页面 → 读回）=====
       v1.7 把存储层换成了「IndexedDB 主存 + localStorage 降级」，启动也改成异步的。
       只断言页面内的函数不算数 —— 必须真的刷新一次，确认数据跨页面加载活下来了。 */
    const RT = await (async () => {
      const setup = "state.projects=[{id:'rt',name:'往返测试剧',createdAt:1,updatedAt:2,"
        + "scriptText:'正文',scriptFile:'',dramaTitle:'往返标题',eps:[{id:'e1',title:'第1集',text:'a'}],"
        + "epsSnap:'正文',sel:[],comp:{},plans:{},shots:{}}];state.curId='rt';"
        + "state.scriptText='正文';state.dramaTitle='往返标题';";
      await evalVal(setup);
      const saved = await evalAsync("(async()=>{ const ok = await saveNow(); return JSON.stringify({ok:ok, mode:storageMode()}); })()");
      await send("Page.navigate", { url: TARGET_URL }).catch(() => {});
      let b2 = false;
      for (let i = 0; i < 80; i++) {
        if (await evalVal("window.__booted === true")) { b2 = true; break; }
        await sleep(250);
      }
      const back = await evalVal("JSON.stringify({booted:!!window.__booted," +
        "n:(state.projects||[]).length,name:(state.projects[0]||{}).name,title:state.dramaTitle," +
        "sel:(state.projects[0]||{}).scriptText,mode:window.__storageMode})");
      return { saved, b2, back };
    })();
    const backObj = (() => { try { return JSON.parse(RT.back || "{}"); } catch (e) { return {}; } })();
    out["往返_写入"] = String(RT.saved);
    out["往返_刷新后读到"] = String(RT.back);
    const rtOk = RT.b2 && backObj.n === 1 && backObj.name === "往返测试剧"
      && backObj.title === "往返标题" && backObj.sel === "正文";
    const rtMode = (() => { try { return JSON.parse(RT.saved || "{}").mode; } catch (e) { return "?"; } })();
    out["持久化往返（刷新后数据仍在）"] = rtOk;
    out["主存用的是 IndexedDB"] = rtMode === "IndexedDB";
    if (!rtOk) (out._failed = out._failed || []).push(
      "持久化往返失败：写入=" + RT.saved + " 刷新后=" + RT.back);

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
