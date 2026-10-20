# 操作行横向滚动

## 需求

设备页 / 设置页里所有「一行摆 N 个 chip」的操作行，放不下就横向滑，不换行。用户点名的行：
模式、快捷动作（含长按）、机身模式循环、播放控制。

## 根因

`#shortcut` 一个容器被两个品牌共用：华为 `renderGestures()` 往里放手势组（要求竖排、组间距 0.9rem），
Bose `renderShortcut()` 往里直接塞一排 chip 按钮（要求横滑）。`web/styles.css` 用

```css
#shortcut { display: grid; gap: 0.9rem }
```

撑起华为那半边。id 选择器压过 `.chips` 的 `display: flex; flex-wrap: nowrap`，Bose 那一行掉出
`.chips`；grid 没定义列，几项就几行（QC Ultra 2 报 4 项时是 4 行，与宽度无关）。

## 改法

| 文件 | 改动 |
| --- | --- |
| `web/index.html` | `#shortcut` 去掉 `class="chips"`：它装的是「组」，不是一行 chip |
| `web/styles.css` | 删 `#shortcut { display: grid; gap: .9rem }` 与配套的 `#shortcut .gesture + .gesture { margin-top: 0 }`；组间距交给已有的全局 `.gesture + .gesture { margin-top: .9rem }` |
| `web/bose.js` | `renderShortcut()` 每次清空 `#shortcut` 再建一个 `div.chips`。不能 `querySelector(".chips")` 复用：华为残留的 `.gesture > .chips` 会命中，把按钮画进手势组里 |
| `web/ui.js` | `refill()`：重画保留横向位置；`revealSelection()`：选中值真的变了（或首次渲染）才把 `.on` 拉回视野 |
| `web/ui.js` `chips()` | 单选（`selected` 不是数组）走 `revealSelection`；多选行（机身模式循环）不抢滚动位置 |
| `web/app.js` | 诊断回执从 `#diag-actions`（nowrap 横滑容器）里挪到它旁边：塞在行里会被滑走，`.diag-note` 的 `display:block` 也失效 |
| `web/styles.css` | `.chips button:focus-visible { outline-offset: -3px }`：行是 overflow 容器、padding-block 为 0，向外的焦点环被上下裁掉。`.levels` 自带 4px padding，不用改 |
| `web/styles.css` | `#go { flex: none }`：`#headset-actions` 是内层滚动容器，别让「断开连接」先被挤 |

为什么必须动 DOM：纯 CSS 把 `#shortcut` 改成 flex+nowrap 会让华为的手势组横排成分页，破掉
「手势不要并排成两列」；`:has(> .chip)` 要 Chromium 105，页面承诺 Chromium 80。两边抢
`#shortcut.className` 也可以，但 Bose 加上、华为忘了摘就会出事，不如各管各的。

`web/` 是真源，改完必须 `sh scripts/sync-web.sh`（三端 bundle + CI 的 `git diff --exit-code` 都卡这个）。

## 回归防护

`tests/layout.test.mjs` 四条新断言：

- 已知的 chip 行还挂在 `.chips / .levels` 上 —— 某一行被摘掉 class 就红。
- chip 行不被 `#id` 规则改布局（`display / flex-direction / flex-wrap / grid-template* / grid-auto* / overflow*`）。
  只认「选择器就是 `#id`」的规则，`#modes .chip` 这类后代规则不误报。
- `#shortcut` 自己不许有样式规则。
- 只有基础那条规则（`.chips, .levels, .row`）能给 chip 行定布局。后面再接一条 `.chips { overflow-x: clip }`
  或 `.chips { flex-flow: row wrap }` 不算「基础规则已存在」；全表另禁 `flex-flow: … wrap`。

每一条都用真实现场验过会红：加回 `#shortcut { display: grid }`、`#modes.chips { display: grid }`、去掉
`#modes` 的 class、`.chips { flex-flow: row wrap }`、`.chips { overflow-x: clip }`、`.levels { display: block }`、
`.row { flex-direction: column }`。

仍然盖不住的：Bose 直接 `chips(ui.shortcut, …)` 而不建内层行。没有 DOM 环境，正则看不出渲染结果，
只能靠看界面。

## 实测

```bash
node scripts/measure-rows.mjs                 # 溢出像素表
node scripts/measure-rows.mjs --shot /tmp/x   # 顺便出 390/1280 × 中英 四张图
```

**别用 `chrome --headless --window-size=390,844` 量**：macOS 上那个窗口被夹到 500 宽，跑的是桌面分支
的 padding，数据是错的。脚本走 CDP `Emulation.setDeviceMetricsOverride` 拿真视口。

390 视口 / 内容宽 350px，真实文案（`web/labels.js`），单位 px 溢出；1280 下除 `voice` 与
`shortcut-max` 全为 0。`modes` 用的是代表性模式名（模式名是耳机报的运行时数据，没有枚举表可查），
其余行的选项集合全部来自 `labels.js` 的真实枚举：

| 行 | 中文 | English |
| --- | --- | --- |
| `shortcut-max` 快捷动作（ActionButtonMode 全表 23 项） | 1866 | 2699 |
| `voice` 语音提示（19 种语言） | 1832 | 2015 |
| `favorites` 机身模式循环（8 个模式名） | 375 | 547 |
| `modes` 模式（8 个） | 328 | 494 |
| `standby` 自动关机（8 档） | 335 | 480 |
| `shortcut-4` 快捷动作（QC Ultra 2 真机只报 1/14/16/19） | 37 | 150 |
| `cnc` 分段控件（11 档） | 163 | 163 |
| `behaviour` 设置-其它 | 11 | 107 |
| `toggles` 主页-其它 | 0 | 8 |
| `spatial` / `sidetone` / `transport` / `lang` | 0 | 0 |

`shortcut-4` 英文溢 150px 正好是选中项（Immersive Audio，最后一颗）的整宽：改之前那颗完全在屏外，
看不见当前值。`reveal()` 之后行自己滑到 `scrollLeft=109`，选中项右对齐可见。

另外在真页面 + 真 `ui.js` 上验过：单选行 reveal 后选中项可见，多选行重画保住用户滑到的位置
（`312 → 312`，不被拽回），键盘 Tab 聚焦时 `:focus-visible` 命中、计算出的 `outline-offset` 是 `-3px`
（环画在框内，没有可裁的部分），诊断回执 `diag-export-state` 是 `#diag-actions` 的兄弟节点、不在行里。

## 复核过的取舍

两个对抗性 subagent 提的意见，成立的和不成立的：

**成立，已改**

- 量测环境错了：`chrome --headless --window-size=390,844` 在 macOS 上被夹到 500 宽，量到的是桌面分支的
  padding。已改用 CDP 拿真视口重量（表在上）。这个错不影响修法（`nowrap` 与宽度无关）。
- Bose `querySelector(".chips")` 复用会捡到华为残留的手势组（换品牌时不重载页面）→ 改成每次清空重建。
- 单选行的当前值滑出屏就看不见当前值（QC Ultra 2 真机英文下整颗在屏外）→ `chips()` 对非数组选中做
  reveal；多选行不做。
- 诊断回执塞在 `.chips` 行里会被滑走，`.diag-note` 的 `display:block` 也失效 → 挪到行外。
- `.chips` 的 `overflow-y: hidden` 裁焦点环 → 行内按钮改成向内画。
- `refill` 里 `root.clientWidth ? … : 0` 是死判断（`display:none` 时 `scrollLeft` 本来就是 0）。
- 第一条结构性测试用「HTML 里带 chips 的 id」定位，`#shortcut` 摘掉 class 之后恰好扫不到 → 换成
  「`#shortcut` 不许有规则」+ 扫 CSS 里全部 chip 容器的 id 规则。
- 「每次重画都 reveal 会把用户正在浏览的位置拽回当前值」—— 对，refresh 是响应驱动的，刚连上就有好几次
  （首批 7 个读、第二批 12 个读、重试批、明细各一次）。改成只在选中值变化时 reveal（`WeakMap` 记上一轮
  的值，首次渲染仍然 reveal）。
- 布局测试只认第一条基础规则、只禁字面 `flex-wrap: wrap`：`.chips { flex-flow: row wrap }`、
  `.chips { overflow-x: clip }`、`.levels { display: block }` 都能绕过 → 已补断言，四种写法都验过会红。
- 量测 fixture 的快捷动作只摆 8 项，`labels.js` 实际有 23 个 ActionButtonMode，长文案
  （`Client Interaction` / `Read Notifications`）没进来，数字偏乐观 → 改成全表 `shortcut-max`，
  真机那 4 项另列。

**不成立，不改**

- 给 chip 行加 `scrollbar-width: thin`（仅桌面）换可达性 —— 不加。溢出项本来就够得到：触控板双指滑、
  触屏拖、鼠标 `Shift+滚轮` 都是原生横向滚动。全局隐藏滚动条是这套外观既定的选择，加一条只在桌面
  出现的条是新的视觉元素。
- 「`reveal` 每次重画都调会和 `refill` 打架」—— 只在单选行调，且只在选中值变化时调；多选行不调。
- 「`renderShortcut()` 每次重画都把按钮从 DOM 上摘下来，pointerdown 之后、pointerup 之前来一次不相关的
  refresh 会让这次点击不算数」—— 机制成立，但没改：不是这次引入的（改动前 `chips(ui.shortcut, …)` 也
  `innerHTML = ""`），`#modes` / `#voice` / `#standby` / `#favorites` 每一条 chip 行都是同一个模式，只修
  这一条反而把不一致留在别处；refresh 是响应驱动的，只有启动那一两秒会连来几次。真治是全局「内容没变
  就不重画」，那是另一件事。复审也确认：已经派发出去的 click 处理函数不会被后面的摘除打断。

## 没验的

- 真机 WKWebView 上，手指从横向可滚行正中间做纵向拖动，`#settings` 还跟不跟手。Chromium 上验过滚动链
  正常（`overscroll-behavior-x: contain` 不吞纵向），iOS 只有规格依据，没有实机。
- 纯鼠标（无 Shift）压在溢出行上，Chrome 会不会把竖直滚轮重映射成横向滚 —— 没测到：headless 的
  `Input.dispatchMouseEvent` 在这台机器上没把事件送进页面，headed 也一样。`Shift+滚轮` 是浏览器通用
  的横向滚动，触控板/触屏更直接，所以没有因此加滚动条。
- 焦点环只验到「规则命中 + 计算值 -3px」，没做像素级截图比对。
- 华为手势组的 `#shortcut` 竖排几何在 Chromium 上逐项量过与改动前一致；没在华为真机上重放。
