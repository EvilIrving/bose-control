# 操作行横向滚动

## 目标

设备页 / 设置页里所有「一行摆 N 个 chip」的操作行，超出容器宽度时横向滚动，绝不换行。

## 现状（实测，不是读代码猜的）

在 390×844 下用 Chrome headless 渲染全部行并量 `scrollWidth/clientWidth` 和子项 `offsetTop` 去重行数：

| 行 | 容器 | 实测 |
| --- | --- | --- |
| 消噪 | `#cnc.levels` | 1 行，溢出 77px → 滚动 |
| 模式 | `#modes.chips` | 1 行，溢出 191px → 滚动 |
| 沉浸式 / 自助语音 / 其它 / 播放控制 / 语言 / 设备 | `.chips` | 不溢出，单行 |
| **快捷动作（Bose）** | `#shortcut.chips` | **5 行（换行了）** |
| 机身模式循环 / 语音提示 / 自动关机 / 耳机操作 / 诊断 | `.chips` | 1 行，溢出 → 滚动 |
| 快捷动作（华为） | `#shortcut` → `.gesture` × N，每个内含 `.chips` | 组竖排，组内 1 行滚动 |

唯一换行的行是 Bose 的 `#shortcut`。

## 根因

`styles.css` 里 `#shortcut { display: grid; gap: .9rem }` 用 id 选择器压过 `.chips` 的
`display: flex; flex-wrap: nowrap`。`#shortcut` 同时被两个品牌用：

- 华为 `renderGestures()` 往里塞 `.gesture` 组（要求竖排，组与组之间 0.9rem，历史规则「手势不要并排成两列」）；
- Bose `renderShortcut()` 往里直接塞一排 chip 按钮（要求横向滚动）。

同一个容器承载两种语义，网格覆盖是让华为那半边成立的做法，代价是 Bose 那半边掉出 `.chips` 契约。

## 修法

把 `#shortcut` 还原成普通块级容器（它装的是「组」，不是一行 chip），Bose 自己造一行 `.chips`：

- `web/index.html`：`<div id="shortcut" class="chips">` → `<div id="shortcut">`
- `web/styles.css`：删掉 `#shortcut { display: grid; gap: .9rem }` 和
  `#shortcut .gesture + .gesture { margin-top: 0 }`；组间距交给已有的全局 `.gesture + .gesture { margin-top: .9rem }`
- `web/bose.js` `renderShortcut()`：新建/复用一个 `div.chips`，`chips()` 往里画

## 回归防护

`tests/layout.test.mjs` 增加一条结构性测试：读 `index.html`，取出所有 `class="chips|levels"` 容器的 id，
断言 `styles.css` 里没有任何 `#<id>` 规则把它的 `display` 改掉。这条测试在改动前必须失败。

## 已知代价

桌面端纯鼠标（无触控板）够不到溢出的 chip：全局隐藏了滚动条。行本身仍是可点区域之外的可滚动容器，
键盘 Tab 会把焦点滚进视野，所以不额外加控件。用户明确要求「超出就横向滚动」。
