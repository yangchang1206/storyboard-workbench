# 分镜工作台 · AI真人剧导演

单文件本地网页应用：上传剧本 → 智能分集 → 三步流水线（剧情压缩 → 断点规划 → 逐断点分镜）→ 导出模板E六段 Markdown 分镜脚本。配套完整「导演十五规则 v5」方法论文档。

**在线版**：https://storyboard-workbench-43699.app.workbuddy.host/
（也可下载后双击 `分镜工作台.html` 本地运行，数据不出本机）

## 界面预览

桌面端 | 移动端
--- | ---
![桌面端](docs/preview/分镜工作台_desktop.jpg) | ![移动端](docs/preview/分镜工作台_mobile.jpg)

## 目录结构

```
storyboard-workbench/
├── index.html                   # 主程序唯一真源（单文件自包含）
├── 分镜工作台.html               # index.html 的本地双击副本，由 tools/sync_single_file.py 生成，勿手改
├── manifest.webmanifest         # PWA 清单
├── sw.js                        # Service Worker 离线缓存
├── icon.svg                     # PWA 图标
├── tools/
│   ├── check_inline_js.py       # 内联脚本语法校验（抽 <script> 逐个 node --check）
│   ├── sync_single_file.py      # index.html → 分镜工作台.html 同步（--check 只校验）
│   ├── build_site.py            # 生成部署目录 site/
│   └── smoke_test.mjs           # 真实 Chrome(CDP) 冒烟测试，31 项断言
├── site/                        # 部署产物（build_site.py 生成，不入库）
├── README.md
└── docs/
    ├── 分镜方法论-v5/           # 导演十五规则完整文档（规则 v5）
    │   ├── SKILL.md             # 工作流总览：阅读理解→任务参数→场次灯光→逐镜头→自检→迭代
    │   ├── 改版说明.txt          # v5 版本演进与新增内容
    │   └── references/
    │       ├── director-rules.md        # 七基础：肌肉导演法/动作链/机位三问/情绪标签/终点态/机位比例/角色锚点
    │       ├── director-rules-v5.md     # 八进阶：语速多档/灯光变量/集型机位/跨片段台词/运镜双语/道具符号/走位叙事/满负荷打包
    │       ├── format-templates.md      # 五种输出模板（默认模板E：总结→断点→分镜→统计→对照→建议）
    │       ├── camera-movements.md      # 运镜库：适用场景与提示词写法
    │       ├── lighting-schemes.md      # 灯光方案库：光型/色温/色彩与情绪对应
    │       ├── pacing-and-revision.md   # 台词节奏、长台词细分、镜头时长与迭代修正
    │       └── special-angles.md        # 特殊视角与 9:16 竖屏构图
    └── preview/                  # 界面预览截图
```

> **版本口径**：本项目并行两套编号，**规则 v5** = 导演十五规则条数版，**排版 v6** = 多行式位置锚点等排版五规范版。两者维度不同，不要再混用「v5/v6」笼统指代。

## 其他电脑下载使用

**方式一：git 克隆**
```
git clone https://github.com/yangchang1206/storyboard-workbench.git
```

**方式二：直接下载 ZIP**
打开仓库页 → 绿色 `Code` 按钮 → `Download ZIP` → 解压。

任选其一后：
1. 双击打开 `分镜工作台.html`（浏览器直接运行，无需安装任何东西）
2. 在 [platform.deepseek.com](https://platform.deepseek.com) 创建 API Key，填入页面顶部（仅存本机浏览器 localStorage）
3. 粘贴或上传剧本（txt / docx / pdf），「智能分集」后勾选目标集数（**可多选，会按集批量串行生成**）
4. 依次执行：剧情压缩 → 断点规划 → 逐断点分镜
5. 「导出 MD」获得模板E六段完整分镜脚本

> 注意：docx / pdf 解析需联网加载解析库（顺序为「同源 `./vendor/npm/` → jsDelivr → unpkg」，任一可用即可）；txt 与粘贴无需联网。

## 特性

- **纯本地运行**：数据不出本机，无服务器、无注册
- **直连 DeepSeek API**（OpenAI 兼容协议）：`deepseek-flash` / `deepseek-v4-pro`，思考强度可调（关闭/低/中/高）
- **多集批量流水线**：勾选多集后一键批量生成，多选时自动跳过已完成的集；断点级续跑，暂停后可从缺口接着跑
- **导演十五规则（规则 v5）可开关**：界面 15 个开关真实生效，提示词按开关拼装
- **模板E 口径**：断点即生成片段（≤30s，满负荷打包 26~29.5s）、语速四档（喃喃3/常态3.5/对抗4/惊呼5 字每秒）、台词字数不含标点（仅汉字/字母/数字）
- **分镜表可编辑**：单镜头/整断点重生成，生成可暂停/继续/取消
- **成本透明**：按官方价目区分「输入缓存命中 / 未命中 / 输出」三段计价，按北京时间高峰·空闲档实时估算
- **不描述服饰/身材**：画面内容只写动作、表情、生理细节，外貌由人物参考图锁定

## 技术说明

- 单 HTML 自包含（内联 CSS/JS），无构建、无本地依赖
- DeepSeek 接口：`https://api.deepseek.com/chat/completions`
- 思考模式参数：`thinking: {type: enabled/disabled}` + `reasoning_effort: low/high/max`
  （思考模式下 `temperature` 不生效，因此代码只在「思考关闭」时才传，避免调参假象）
- 单次请求带 240s 超时，区分「用户暂停」与「网络超时」，不会静默卡死流水线
- 流水线分三阶段请求，分镜阶段只传断点上下文（不重复传整集全文），控制 token 成本

## 开发与自检

改完 `index.html` 后按顺序跑一遍，再发布：

```bash
python tools/check_inline_js.py      # 内联脚本语法校验（单文件最容易死在这里）
python tools/sync_single_file.py     # 同步出 分镜工作台.html
python tools/build_site.py           # 生成部署目录 site/

# 冒烟测试：真实 Chrome 无头模式加载页面，断言关键逻辑 + 抓控制台报错
python -m http.server 8899 --bind 127.0.0.1   # 另开一个终端，在 site/ 目录下
node tools/smoke_test.mjs http://127.0.0.1:8899/index.html
node tools/smoke_test.mjs https://storyboard-workbench-43699.app.workbuddy.host/   # 也可直接测线上
```

> 测试脚本用 Chrome 无头模式，本机若装了系统代理（如 Clash），需保证 Chrome 加 `--no-proxy-server`（脚本内已加），否则连 `127.0.0.1` 都会被代理拦掉。

## 规划中

- BGM 配乐清单（按情绪弧线从素材开头/中间/高潮/结尾截取）
- 模板 A/B/C/D 导出（规格已在 `format-templates.md`，代码只实现了模板E）
- 多模型接入
- 持久化迁移到 IndexedDB（解除 localStorage 5MB 限制）

## 版本演进

- v1 模板E定型版 → v2 长台词细分版 → v3 机位三问版 → v4 导演七规则版 → v5 导演十五规则版
- **v1.5（当前）** —— 缺陷修复版：
  - `esc()` 补转义 `"` `'`（模型输出含引号会撑破 `value="..."` 属性、破坏镜头表）
  - 多集勾选真正生效（原 `curEp()` 只取第一集，勾 10 集只跑 1 集）
  - **多集后可逐集查看**：顶栏「当前集」在多选时变成下拉框，点左侧集名也能切换；中栏压缩概览 / 断点规划、右栏镜头表、MD 预览与导出一律跟随当前查看集
  - 分集列表显示每集完成度（`压`/`规`/`镜`）；新增「导出全部（N 集）」，把已出分镜的选中集并成一个合集文件
  - 峰谷判定改用固定北京时间（原用本机时区，非东八区机器费用整体偏移）；周末=空闲符合官方口径
  - 费用估算区分输入「缓存命中 / 未命中 / 输出」三段单价，并修正 token 跨模型混算导致的费用虚高
  - 思考模式下不再传无效的 `temperature`；单次请求加 240s 超时，区分暂停与超时
  - 解析库加载加同源/unpkg 兜底，pdf.js 显式配置 worker；Service Worker 缓存可随版本失效
  - 剧本改动不再静默清空分集勾选，改为显式提示「建议重新分集」
  - 新增「导出含机位/视觉建议」开关（v1.3 起默认不输出，需要机位三问答案时勾上）
  - 统一版本口径为「规则v5 / 排版v6」；补 `.gitignore` 与自检工具链（语法校验 / 单文件同步 / 站点构建 / CDP 冒烟测试 41 项）

> 模型名与价目表核对结论（2026-10-14 官方文档）：模型名以 `deepseek-flash` 为准，旧名 `deepseek-v4-flash` 已下线但仍可调用、同价；现价 flash = 命中 0.04/0.02、未命中 2/1、输出 8/4（元/百万 tokens，高峰/空闲），pro = 0.30/0.15、9/4.5、27/13.5。代码与官方一致。
