# AGENTS.md

Bose Connector：不登录、不联网，用蓝牙直连耳机的一个页面 + 三端壳。页面是唯一真源，原生端只提供通道和设备列表。

对外名称统一写 **Bose Connector**；仓库名 `bose-control`、Bundle ID `cain.com.bosecontrol` 保持不动，不要顺带改。

## 项目现状

| 平台 | 页面 | 设备中心 | Bose | 华为 SPP | vivo / OPPO |
| --- | --- | --- | --- | --- | --- |
| macOS | WKWebView + 内置 `Web/` | 有 | BLE + RFCOMM | 有（真机验过 FreeClip 2） | 默认关闭 |
| Android | WebView + `assets/www/` | 有 | BLE + RFCOMM | 有（未真机验证） | 默认关闭 |
| iOS | WKWebView + 内置 `Web/` | 无 | BLE | 永远没有（系统不给第三方 SPP） | 没有 |
| Chrome / Edge | 直接开页面 | 无 | Web Bluetooth | 仅当页面由 `server.py` 提供 | 默认关闭 |

已验证真机：Bose QuietComfort Ultra Headphones、HUAWEI FreeClip 2。其他型号靠「谁回包就显示谁」自动适配。

`npm test` 现在 100 条全过。测试都在 `tests/*.test.mjs`，直接 import `web/` 里的模块。

## 我对 agent 的要求

这些是过去几轮里被明确要求、也被反复纠正过的：

- **先回答，再动手。** 问「为什么」就先给原因和证据，不要拿一堆修改当回答。被叫停（「别干了」「先停」）就立刻停，不要继续执行下一个目标。
- **不许长时间闷头跑。** 一个目标做完就汇报一次；不要连续执行几十分钟不说进度。
- **没验证就别说「修好了」。** 区分「已验证」（构建过、真机跑过、截图看过、测试过）和「只改了代码」。报告里把没验的部分写出来。
- **不臆造。** 文案不能自己编、不能自己翻译；图标不能自己画；没在真机上验证过的能力不能当成能用；平台做不到就直接说做不到，并写清原因。
- **自己决策。** 不要抛「A 也行 B 也行」让人选。有证据就选一个做下去，把取舍写进 README。
- **范围克制。** 只做要做的。改 UI 前先确认接到现有界面的哪个位置，不要把已经满意的地方顺手重做。
- **三端都不能废。** 用户自己用 Android + Mac，但 iOS 必须保持能用（开源出去是给别人用的）。平台推进顺序是 macOS → Android → web；iOS 只做系统允许的那部分，做不到的写清原因，不要砍掉。
- **报错先加日志定位根因。** 不要靠猜，也不要靠改超时、加重试来「让它看起来好了」。装成 App 之后 `console.debug` 看不到，所以诊断信息必须同时进设置页的「诊断」面板。
- 文案要和官方 App / 官网对得上：说「静态、运动」就都得是「静态、运动」，不能一处一个说法。

## 改代码的硬约束

### 1. `web/` 是唯一真源

三端加载的是拷贝：`android/app/src/main/assets/www/`、`ios/BoseControl/Web/`、`macos/BoseControl/Web/`。

```bash
sh scripts/sync-web.sh
```

改 `web/` 之后必须跑，并把三端拷贝一起提交。CI（`.github/workflows/android.yml`、`apple.yml`）会重新 sync 再 `git diff --exit-code`，漏同步直接失败。

`web/` 没有构建步骤，纯 ES module，被原样拷走、也被 `server.py` 直接 serve。不要引入打包器。

### 2. 文案只在 `web/labels.js`

- 所有界面文字都是 `{ zh, en }` 两份，`t(key)` 取当前语言；`index.html` 里用 `data-label`。
- 中英文都来自官方 APK 的 `res/values` / `res/values-zh-rCN` 或官方 App 实际显示。新增一条就要两条都有。
- 连接错误由 `web/link.js` 统一成代码（`idle` / `off` / `denied` / `noproto` / `lost` …），原生端只上报错误码，不拼中文。每条提示 10 字以内，窄屏单行不换行。

### 3. 界面不放图标

用户明确要求过：耳机示意图删掉，品牌 logo 也不要（企业商标不能随手分发，自己画更不行）。`web/art.js` 已删，别再加回来。

- 设备列表用状态点表示连接态：绿 = 连着，灰 = 没连；「已连接 / 未连接」只留在 `title` / `aria-label`。
- 电量是一行小字：设备页跟在名字右边，设备中心写在方块底部，只有真读到的那台才写。

### 4. 能力按回包渲染，不按型号写死

每个功能连上后单独 GET，有回复才画，没回复整块隐藏（连标题一起）。首屏不等慢项：先短超时探一轮，没回的项在界面出来之后后台补一轮。

连上了但一条控制回包都没有 → 断开并提示「设备不支持」，不要留一个空白控制页。

### 5. 未验证的品牌默认关闭

vivo / OPPO 的命令表来自第三方逆向、没真机验证，`web/experimental.js` 把它们挡在默认之外。开关在设置页「未验证的品牌」，或 `?unverified=1`。

新增没真机验证的品牌，照这个规则办：能读能写也不默认放出来。

### 6. 只有一套外观

`web/styles.css` 是唯一主题：黑底、胶囊 chip、白底滑轨、无边框顶栏。没有 `data-theme`、没有 `theme.css`、设置页没有「外观」。

不要再加主题切换，也不要「顺手对齐 shadcn」把这套改掉。用户明确说过 shadcn 那版不如这套好看。

### 7. 布局规则

- chip 左对齐，有几个排几个；**7 个以内不许换行**（`#modes.dense`），挤不下就缩字号，不要固定行宽、不要溢出换行。
- 新建模式只在模式行末尾放一个「＋」，不写「新建」两个字。
- 设置页不放日常操作；主页不放配一次就不管的东西。不要把所有东西都塞进设置页。新功能先按使用频率和重要性排序，再决定放哪页。
- 设备中心每台一个自适应方块（图标 / 名字 / 品牌 / 已连接），刷新是右上角图标，不是大按钮；标题左对齐。
- 排序：已连接在前，组内按名字自然序（数字按数值比、不分大小写），刷新前后顺序不能变。两个设备中心实现都要守：macOS 在 `HeadsetCatalog`，Android 在 `BmapBridge.listDevices`。
- 设备页顶栏：名字 + 电量同一行，右边小箭头展开 / 收起；点开是设备切换下拉。设备信息整块在设置页。
- 返回是右上角一个小箭头（`Esc` 同效），不要大 back 按钮，不要浏览器式返回条。返回不断开，回到设备中心那台仍高亮。
- 未连接时不要同时出现「返回 / 连接 / 请重新连接 / 设备」一堆东西，只留一个有用的入口。
- 不给控件加 `cursor: pointer` 之类的光标手势（`styles.css` 里全局是 `cursor: default`）。
- 触控目标不小于约 44px，但视觉上压扁、按钮圆角不要过大。

### 8. 「连上了」的判定

`link.connected` 只说明通道开着。会话还活着要同时满足「通道开着 + 这次连接真的读到过回包」（`web/app.js` 的 `sessionLive()` / `state.link === "ready"`）。

系统蓝牙链路在 App 关掉控制通道后还会挂一阵，拿它写「已连接」会骗人：卡片显示已连接，点进去要重连。改动这块要同时看设备中心卡片、顶栏下拉、点卡片的行为三处。

### 9. 原生端不认识任何品牌

原生层只做四件事：枚举系统配对设备、按页面给的 `transport` / `address` / `channels` / `services` 建通道、收发字节、上报错误码。加品牌不改原生代码。

### 10. 日志

- 页面：`log()` 写 `console.debug`，同时留最近 20 行给设置页「诊断」显示最近 3 行。
- macOS：`Diag`（`os.Logger`，subsystem `cain.com.bosecontrol.mac`，全部 `privacy: .public`），同时写 stderr。用 `log stream --predicate 'subsystem == "cain.com.bosecontrol.mac"' --info --debug` 看。
- Android：`adb logcat -s BOSE`，每一步一行（`gatt connected` → `mtu=517` → `cccd write status=0`）。
- 新增失败分支时补一条日志，打清「在哪一步、给了什么值、错误码是什么」。

## 架构

```
web/ 页面（无构建、ES module）
 ├─ app.js        宿主：页面路由、设备中心、连接/断开、品牌选择、设置页、诊断
 ├─ transport.js  字节进出 + 请求配对（不认识品牌）
 ├─ brand.js      当前品牌（运行时状态）
 ├─ brands.js     品牌注册表 + 平台能力判定
 ├─ bose.js / huawei.js / vivo.js / oppo.js   品牌描述符 + codec + session
 ├─ bmap.js / spp.js / gaia.js / opo.js       纯协议编解码
 ├─ bridge.js     浏览器 → server.py 的 WebSocket 串口桥
 ├─ native.js     原生桥调用（NativeBLE / messageHandlers）
 ├─ labels.js     中英文案（唯一来源）
 ├─ menu.js       下拉（键盘 / 点外关闭）
 ├─ ui.js         chip / 行 / 面板小工具
 ├─ link.js       错误码 → 提示
 ├─ products.js   型号表           experimental.js  未验证品牌开关
 └─ index.html / styles.css

原生：macOS (BLE + RFCOMM)、Android (BLE + RFCOMM)、iOS (BLE)、tools/bt-bridge + server.py (浏览器 SPP)
```

### 品牌契约

新增品牌：新建 `web/<brand>.js`，导出描述符，在 `web/brands.js` 的 `registry` 加一行。

```js
{ id, label, transport: "ble" | "spp", alt?, channels?, services?,
  matches(name), codec(), create({ link, ui, state, refresh, log }) }
```

- `codec()` 返回 `{ id, ble, filters, services, chars, reset(), chunks(bytes, link), parse(chunk, link), key(packet), header(bytes) }`。
- `create()` 返回的 session 宿主只认四个入口：`load()` / `render()` / `renderSettings()` / `onPacket(packet)`。`load()` 必须返回「有没有读到东西」，宿主用它判定设备支不支持。
- `alt` 是备用通道，只在主通道这台机器上没有时才算可用（vivo 的 GATT 只在浏览器里能走）。

### 传输层

`HeadsetLink`：

- 同一条命令（`fblock.func` 或品牌自己的 key）同时只能有一条在途，否则乱序回包会配错。
- 不同命令可以一起飞，`MAX_IN_FLIGHT = 4`。
- 每条请求有超时；断开时排队和在途的一起 reject，不留悬着的 Promise。
- `write()` 按 codec 切包：Bose 的 BLE 按 `segment()` 切 19 字节，SPP 整帧发。

### 原生桥

| | 入口 | 能力 |
| --- | --- | --- |
| macOS | 注入 `window.NativeBLE` 对象；`NativeBrand` 注入上次品牌 | `transports: ["ble","spp"]`、`hub: true`、`platform()`、`bleConnect` / `bleScan` / `sendData` / `bleDisconnect` / `listDevices` / `setBrand`；没有 `env()`，诊断页的蓝牙状态在这里是「—」 |
| Android | `addJavascriptInterface(bridge, "NativeBLE")` | 同上；JS 接口只吃字符串，所以 `bleConnect(JSON.stringify(...))`；`platform()` 返回 `{transports:["ble","spp"],hub:true}` |
| iOS | `window.webkit.messageHandlers`（没有 `NativeBLE` 对象） | 只有 `bleScan` / `bleConnect` / `sendData` / `bleDisconnect`；没有 `platform()` / `hub` / `listDevices` / `setBrand`，所以页面按「单品牌 + 一个连接按钮」走 |

原生回调页面：`onDataReceived(hex)`、`onNativeConnected(json)`、`onNativeDisconnected()`、`onNativeError(msg)`、`onDeviceList(json)`。都是全局函数。

新增原生能力时三端一起看：`web/brands.js` 的 `platformInfo()` 只有拿到 `transports` 才会显示对应品牌。

### 存储键

页面：`bose.lang`、`headset.brand`、`headset.unverified`。macOS 的品牌另存 `UserDefaults`（自定义 scheme 下 localStorage 只在本次会话有效），启动时以 `NativeBrand` 注入。

### 为什么不上 React / 构建链

1. `web/` 被原样拷进三端 bundle，`server.py` 直接 serve，上 Vite + React 等于给四条路径都加 node 步骤。
2. `index.html` 自己挡 Chromium < 80（老国产 ROM 的 WebView 常年不更新）。Tailwind v4 / shadcn v4 要 `oklch()` 等新特性，老内核整块掉色。
3. 真正缺的原语只有下拉；`menu.js` 已经自己实现。要的是设计令牌（颜色、圆角、控件高度），不是框架。

## 平台差异与坑

### Android

- **必须自己写 CCCD**（`00002902-…`），只调 `setCharacteristicNotification` 耳机不会推数据。
- **先 `requestMtu(517)` 再读**，默认 23 会截断 48 字节的模式配置回包。
- API 33+ 用新回调：`onCharacteristicChanged(gatt, ch, value)` / `writeCharacteristic(ch, bytes, type)`。
- 串口写必须单线程排队（`sppWriter`），每次开线程会把两帧写岔。
- 权限：12+ 要 `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT`；国产 ROM 还常要定位权限和定位服务。权限回调可能返回空 map，要按权限名逐个查；Activity 没到 RESUMED 时 `launch()` 会被吞，先挂起等 `onResume`。
- 点连接没反应时先看 `adb logcat -s BOSE`；原生回包缺失不能让页面永久卡在 busy。
- WebView 内核偏旧：`index.html` 在 module / 可选链跑不起来时直接提示升级，不要留一个点不动的按钮。

### iOS

- WKWebView 在 `file://` 下会静默拒绝 `type="module"`，所以用自定义 scheme `bose://` 提供内置 `Web/`。
- 只有 CoreBluetooth（BLE）；SPP / RFCOMM 不开放给第三方，华为在这边永远没有通道。不要在 iOS 上「藏一个按钮假装支持」。
- `brandsHere()` 在这边是空集，页面落到默认 Bose 单品牌；这是设计，不是 bug。
- 签名：Team `QZZ878S3NS`，Bundle ID `cain.com.bosecontrol`；TestFlight 走 `.github/workflows/testflight.yml`。

### macOS

- 设备中心来自 `IOBluetoothDevice.pairedDevices()`，排序和去重都在 `HeadsetCatalog`（已连接优先 + 本地化自然序）。
- Bose：先看经典蓝牙是否已连（RFCOMM channel 2 → 8 → SDP），没连先 BLE FEBE，失败再 RFCOMM。
- 华为 / vivo / OPPO：端口按 `services` 的 UUID 从 SDP 取，取不到再试 `channels`。不要碰免提 / A2DP 的 RFCOMM 口，写进去会打断通话。
- 页面统一用 `bleConnect(JSON)`；无参 `bleScan` 是旧桥入口，macOS 点设备中心会连错设备。

### 浏览器 / `server.py`

- Web Bluetooth 只给 GATT，给不了 SPP。华为、OPPO 只有在页面由 `server.py` 提供时才能控（`tools/bt-bridge` 子进程代开 RFCOMM，WebSocket `/bt`）。
- `server.py` 自签 HTTPS（`.certs/`，已忽略），因为 Web Bluetooth 要求安全上下文。`/api/devices` 能通就说明桥在。

## 协议层：写操作要当心

### Bose（BMAP）

- 主页放每天要动的，设置页放配一次就不管的；具体分法见 README。
- 写自定义模式是 `0x1f/0x06` 40 字节，写完要 `0x1f/0x03` 切过去；槽位和能力都从耳机读，不按型号写死。
- 空间校准 `0x05/0x11` **只读**：写回要官方云端 CustomTune，写坏会让空间音频一直偏，得回官方 App 重校。
- 机身模式循环 `0x1f/0x08` 决定模式键轮到哪些；只存进模式表不写这里，机身上切不到。
- 快捷动作写完要按一次机身上的键才生效，界面要说明。

### 华为（SPP）

- 帧：`5a | 长度(2 大端) | 00 | 命令(2) | [类型 1][长度 1][值]… | CRC16(XMODEM)`；长度从 `00` 起算，整包 = 长度 + 5。`tests/spp.test.mjs` 里是 FreeClip 2 真机帧，编码字节必须和当初耳机接受过的一致。
- 读命令之间留 90ms，连续问会把耳机问闷。首轮短超时，缺的项后台再补。
- `2b2e` 双连接总开关：写 0/1 都回成功但读回一直是 1，耳机不接受，只显示状态。
- 有些块**故意不做**：消噪（FreeClip 2 是开放式，参考实现也排除）、改名 / 关机 / 播放控制（SPP 里没找到命令）。
- 「音质优先 / 连接优先」只是编码偏好，不碰音量；这副耳机在 macOS 上不支持绝对音量，系统音量条是软件衰减。

### vivo / OPPO

- 默认关闭，没真机验证。代码按公开逆向记录实现，字节级有单测。
- OPPO 的长度字段是 **LEB128 变长整数**，按单字节读会在长 payload 上安静地错帧。
- vivo 降噪设置的尾巴（`reduceModel`）按型号代际不同，代码按 `[03]` → `[03 01]` → `[04 00]` 试，通了就记住。

### 真机写测试的红线

只在读命令上做全量扫描，**不要给写命令带参数**。真实事故：一次「只发读请求」的扫描给每条命令都带了 `[1, 2]`，对写命令等于「把值写成 2」，把 FreeClip 2 的 ANC、手势、EQ、内部音量全改了，用户听不清。

- 扫描前确认命令表里哪些是可写项，或只扫明确只读的区段。
- 写命令一律先读回确认，再报成功。
- 测试脚本跑完要把改动过的项恢复到原值。

## 验证

改页面：

```bash
npm test                      # 100 条，含真机帧与传输层
sh scripts/sync-web.sh        # 然后 git status 必须只剩预期改动
```

改 macOS：

```bash
xcodebuild -project macos/BoseControl.xcodeproj -scheme BoseControl \
  -configuration Release -destination 'platform=macOS' -derivedDataPath macos/build
```

改 iOS：

```bash
xcodebuild -project ios/BoseControl.xcodeproj -scheme BoseControl \
  -configuration Release -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
```

改 Android：本机没有 SDK / wrapper，走 CI 的 debug APK，或用 Android Studio 打开 `android/`。要确认产物里 `assets/www/` 是新的。

UI 改动要真渲染看：390×844 和桌面两档，至少看未连接、连接中、已连接、设置页、设备中心五个状态，确认没有换行、没有溢出、控制台零错误。真机/模拟器截图比「代码看起来对」可靠。

## Git 与协作

- **分批提交，按主题分组**（一个小目标一条），保持 `git log` 一条线：分支做完并入 `main`，确认无误后删掉分支。
- 不要 force push。push 前确认用户是要求 push 了，`git push` 不等于「提交」。
- 不提交构建产物（`macos/build`、`android/build`、`.certs`、`tools/bt-bridge` 已在 `.gitignore`）。
- **同一时间只能有一个会话在改这个项目。** 过去多个会话并行改 `web/app.js`，出现过「Bose 全都连上即报设备不支持」这类回归，还有会话在删 `macos/build` 时另一个会话正在构建。
  - 动手前 `git status` 看有没有别人未提交的改动，不认识的就当用户的工作保留，不要覆盖。
  - 要开并行工作，先分文件 / 分支，或先沟通。

## 已知欠账

- 华为新固件多出约 27 条可读命令，大多含义未知（`2b25` 是会变的状态、`0a01` 是日志通道、`2b0a` 是第二组设备信息）。不要按猜测接进界面；要确认得做定向写测试，先问用户。
- iOS 永远单品牌、无设备中心，原因写在 README；不要试图绕过。
