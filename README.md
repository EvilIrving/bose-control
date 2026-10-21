# Bose Connector

[![android](https://github.com/EvilIrving/bose-control/actions/workflows/android.yml/badge.svg)](https://github.com/EvilIrving/bose-control/actions/workflows/android.yml) [![apple](https://github.com/EvilIrving/bose-control/actions/workflows/apple.yml/badge.svg)](https://github.com/EvilIrving/bose-control/actions/workflows/apple.yml)

不登录、不联网，用蓝牙直接控制 Bose 和华为耳机。

官方 App 要账号、要云、要定位权限。这里只做一件事：手机或电脑直连耳机，Bose 走私有的 BMAP 协议，华为走蓝牙串口（SPP），数据不出本机。

- **网页版**：Chrome / Edge 的 Web Bluetooth，打开就能连 Bose
- **App**：macOS（BLE + RFCOMM）、Android（BLE + RFCOMM）、iOS（BLE）
- **设备中心**：macOS、Android 上首页就是设备中心，系统里配对过的耳机都列出来，点哪台控哪台（页面由 `server.py` 提供时，浏览器里也有）
- **按能力渲染**：耳机不回的功能整块隐藏，不会留一个空面板

Controls Bose headphones over BMAP and HUAWEI earbuds over SPP, from the browser or a native app. No account, no cloud, no telemetry.

改 `web/` 之后跑 `scripts/sync-web.sh` 再编 App（Android / iOS / macOS 三端共用同一份页面）。

## 界面

三页，只有当前页可见可点：

| 页面 | 内容 | 怎么进出 |
| --- | --- | --- |
| 设备中心（首页） | 已配对的耳机，每台一个方块，三行：设备名（单行，不换行，太长出省略号）、品牌词标 + 状态点（绿 = 连着，灰 = 没连）、电量（真读到的才写）。已连接的排前面，组内按名字自然序 | 启动就到；列表自己刷新，没有手动刷新的按钮 |
| 设备页 | 顶栏是可点的「名字」下拉，点开就列设备中心里的耳机，正在连的那台打勾，选别的直接换过去；名字右边是一小串电量，再往下是各功能面板 | 点方块进；右上角小箭头返回，或按 `Esc` |
| 设置页 | 语言，各品牌自己的配置项，已配对设备，设备信息（产品名称 / 产品变型 / 固件版本 / 序列号 / 双耳序列号 / 蓝牙 MAC / 硬件版本），耳机操作，诊断 | 设备页底部「设置」进，右上角「完成」出 |

- 设备中心的方块上摆厂商词标（Bose / HUAWEI），替掉原来的品牌文字；来源和商标归属见「品牌标识」。耳机示意图不放。
- 电量按耳机报的组件写，读不到就不写（不拿 0% 凑数）：三段是 `左 96% · 右 100% · 盒 59%`（英文环境是 `L / R / Case`），只有一条读数就只写 `60%`。设备页写在名字右边，设备中心的方块上写在底下。
- 返回**不断开**：回到设备中心时那台设备仍连着、方块高亮，再点它就是回到控制页，不会重连。
- 词标后面的状态点：绿 = 连着（App 会话开着，或者系统链路还在），灰 = 没连。文字版「已连接 / 未连接」只留在 `title` / `aria-label` 里给读屏。
- 要真断开在设置页「耳机操作 → 断开连接」，或者顶栏下拉里的「断开连接」。
- 顶栏下拉在没有设备中心的宿主上（iOS、直接开静态文件的浏览器）只列当前这台，加「断开连接」一项。
- 设备中心没有手动刷新的按钮：启动、从设备页返回、窗口重新可见时各拉一次，停在这一页期间每 5 秒轻拉一次；回包内容没变就不重画，所以列表不会自己跳。
- 品牌芯片在同时能走 BLE 和 SPP 的宿主上出现（macOS、Android、由 `server.py` 提供的浏览器页面）；设备中心已经有设备时让位给设备列表。iPhone 上没有 SPP，所以那里连芯片都不显示，原因见下面的「iPhone 上怎么管华为耳机」。
- 设备中心只在能枚举系统配对设备的宿主上出现（macOS、Android、由 `server.py` 提供的浏览器页面）。iOS 和直接开静态文件的浏览器上首页只有一个「连接」按钮。

## 品牌标识

设备中心卡片上的厂商词标原样内联在 `web/logos.js`，没有改形，只把填充统一换成 `currentColor`，深色底上随旁边文字渲染。Bose / HUAWEI 是各家的商标，这里只用于识别设备品牌。

| 品牌 | 来源 | 许可标注 |
| --- | --- | --- |
| Bose | bose.com 页头静态资源 `logo.svg`；[Commons 同形文件《Bose logo.svg》](https://commons.wikimedia.org/wiki/File:Bose_logo.svg) | Public domain |
| HUAWEI | Commons [《Huawei wordmark 2019.svg》](https://commons.wikimedia.org/wiki/File:Huawei_wordmark_2019.svg) | Public domain |

## 电脑 Chrome

```bash
python3 server.py
```

打开打印出来的 `https://127.0.0.1:8443/`。

这里还有一条「本机串口桥」：浏览器给不了 SPP，`server.py` 就用 `tools/bt-bridge` 子进程代开 RFCOMM，页面通过 WebSocket 把字节交给它。所以**浏览器里也能控华为**——前提是页面由 `server.py` 提供（`/api/devices` 能通就说明桥在）。没起 server、直接开静态文件时，只有 Bose 的 Web Bluetooth 那条路。

桥的协议很简单：`GET /api/devices` 拿已配对设备，`wss://<同一端口>/bt` 上发 `{open|send|close}`、收 `{ok|data|error}`。

## iOS

`ios/BoseControl.xcodeproj`。WKWebView 加载内置 `Web/`，CoreBluetooth 连 FEBE。

Info.plist 已有 `NSBluetoothAlwaysUsageDescription`。用开发者账号选 Team 后真机安装。审核按硬件配套工具交：备注型号，附一段连接改降噪的视频。

华为在 iOS 上做不了：系统不把 SPP / RFCOMM 开放给第三方 App。iPhone 上怎么管华为耳机，见「[iPhone 上怎么管华为耳机](#iphone-上怎么管华为耳机)」。

### 装到别人 iPhone 上（三条路）

| 方式 | 使用者要做什么 | 成本 |
| --- | --- | --- |
| **TestFlight**（推荐） | 点邀请链接直接装，不用电脑 | 开发者账号，已配好 CI |
| 自己用 Xcode 签 | 装 Xcode、填自己 Apple ID，**7 天重签一次** | 免费 |
| App Store | 搜到即装 | 需审核 |

**TestFlight 自动发布**：`.github/workflows/testflight.yml`，打 `v*` 标签或手动触发。需要在仓库 secrets 里放三样东西（App Store Connect → Users and Access → Integrations → Team Keys 生成）：

| secret | 说明 |
| --- | --- |
| `ASC_KEY_ID` | API Key 的 Key ID |
| `ASC_ISSUER_ID` | Issuer ID |
| `ASC_KEY` | `.p8` 文件的完整内容 |

前提：App Store Connect 里先建好 App 记录，Bundle ID 与工程一致（当前 `cain.com.bosecontrol`，Team `QZZ878S3NS`）。构建号自动用 CI 的 run number，版本号取工程的 `MARKETING_VERSION`。

**自己签**：Xcode 打开 `ios/BoseControl.xcodeproj` → Target 的 Signing 选自己的 Team（Bundle ID 改成自己的）→ 连上 iPhone Run。免费账号 7 天过期重签，付费账号一年。

```bash
xcodebuild -project ios/BoseControl.xcodeproj -target BoseControl -sdk iphoneos
```

## macOS

`macos/BoseControl.xcodeproj`。WKWebView 加载内置 `Web/`。

启动就进设备中心：`IOBluetoothDevice.pairedDevices()` 里挑出名字像 Bose / 华为的，按「已连接 → 未连接、同组按名字」排好，交给页面渲染。点一台就连一台：

- **Bose**：从设备中心点选已配对设备时直接尝试 RFCOMM，不先等 BLE 扫描超时。控制串口失败后尝试 BLE FEBE，候选名称必须匹配目标，允许 `LE-` 前缀差异。未指定设备时仍走 BLE。串口只尝试控制服务与明确的候选端口，不枚举其它音频端口。
- **华为**：直接开 SPP。端口从 SDP 里按服务名（`Serial Port` / `Private COM`）取，取不到再试 1 / 2 / 3。不碰免提、A2DP 那些 RFCOMM 口，写进去会打断通话。

```bash
xcodebuild -project macos/BoseControl.xcodeproj -scheme BoseControl -configuration Release -destination 'platform=macOS' -derivedDataPath macos/build
```

产物 `macos/build/Build/Products/Release/BoseControl.app`。第一次打开需要蓝牙权限。

品牌记在 `UserDefaults`（自定义 scheme 下 localStorage 只在本次会话有效），下次启动不会被带偏。

## Android（开源发 Release）

`android/`。WebViewAssetLoader 加载 `assets/www/`。启动进设备中心，列 `bondedDevices` 里配过对的耳机，点一台连一台。

- **Bose**：点选设备后先找该地址已有的 GATT 连接，否则直接尝试该设备的 RFCOMM（`00000000-deca-fade-deca-deafdecacaff`），失败再试目标 GATT。只有未指定设备时才先扫描。BLE 地址与经典蓝牙地址不同的机型仍需真机验证。
- **华为**：页面带上设备地址，先按标准 SPP UUID 开，不通再按端口 1 / 2 / 3 试。这条通道还没在 Android 真机上跑过。

列表按「已连接优先 → 名字自然序」排好（数字按数值比，不分大小写），刷新前后顺序不变。

权限：`BLUETOOTH_SCAN`、`BLUETOOTH_CONNECT`（12+）。Release 已开 `minifyEnabled` / `shrinkResources`。

本机没有 Android SDK 时用 Android Studio 打开 `android/` 再 Assemble Release。

不想装 Android SDK 也行：[Actions](https://github.com/EvilIrving/bose-control/actions/workflows/android.yml) 每次 push 都会在 Ubuntu 上打一个 debug APK，从运行记录的 Artifacts 里下。打 `v*` 标签时会把 APK 附到 Release 上。

### 连不上时看什么

```bash
adb logcat -s BOSE
```

每一步都会打一行：`gatt connected` → `mtu=517` → `cccd write status=0` → 之后才开始收数据。出现 `fail xxx` 就是卡在哪一步，`xxx` 和页面上的提示一一对应（映射在 `web/link.js`）。

几个必须做对的地方（做错了会「连上但什么都不显示」）：

- **必须自己写 CCCD**（`00002902-…`）。只调 `setCharacteristicNotification` 只是让本机转发通知，耳机侧并没有开始推数据。
- **先 `requestMtu(517)` 再读**。默认 MTU 23，模式配置这类 48 字节的回包会收不全。
- **API 33+ 用新回调**：`onCharacteristicChanged(gatt, ch, value)` / `writeCharacteristic(ch, bytes, type)`，老接口在新系统上拿不到数据。
- 耳机正连着手机听歌时 BLE 扫不到，代码会退到「已配对设备」再试 RFCOMM。

> `android/` 里没有 `gradlew`，需要 Android Studio 或本机 Gradle 生成 wrapper 后命令行构建。

### 国产 ROM 的坑

- **定位权限**：vivo 官方支持页明确要求连 BLE 设备时给 App 定位权限并打开「定位服务」。代码里对 vivo / OPPO / realme / 一加 / 小米 / 红米 / 华为 / 荣耀 / 魅族 在 Android 12+ 也一并申请定位权限；扫描失败且系统定位关着时，页面会提示「需要开启定位服务」。
- **权限回调可能是空 map**：部分 ROM 的 `RequestMultiplePermissions` 返回空结果，`values.all{}` 对空 map 恒为 true，会被误判成「已授权」。这里改成按权限名逐个查。
- **冷启动弹窗**：Activity 还没到 RESUMED 时 `launch()` 请求权限可能被系统丢掉，所以先挂起，`onResume` 再弹。
- **WebView 内核偏旧**：国产 ROM 的 Android System WebView 常年不更新，且没 Google Play 无法升级。页面在 `<script type="module">` 跑不起来时会直接提示升级内核，而不是留一个点不动的按钮。

## 传输

| | Bose（BLE GATT） | Bose（RFCOMM） | 华为（SPP） |
| --- | --- | --- | --- |
| Chrome | 有 | 无 | 只有开了 `server.py` |
| iOS App | 有 | 无（系统不给第三方） | 无（同上） |
| macOS App | 有 | 有 | 有 |
| Android App | 有 | 有 | 有（未真机验证） |

## Bose（BMAP）

主页放每天要动的，设置页放配一次就不管的。

| 主页 | 设置页 |
| --- | --- |
| 模式（含新建、编辑自定义模式） | 语言 |
| 消噪 | 耳机名称 |
| EQ | 快捷动作 |
| 沉浸式音频 | 机身模式循环 |
| 自助语音 | 语音提示 |
| 其它：风噪滤除 / 多点连接 / 对话模式 | 触控控制 / 自动接听电话 / 自动播放暂停 |
| 播放控制：上一曲 / 播放 / 暂停 / 下一曲 | 自动关机 |
| | 已配对设备 |
| | 耳机操作：进入配对 / 关机 / 断开连接 |

### 自定义模式

官方 App 建自定义模式要登录云账号，这里直接写耳机，全程离线。

- 槽位由耳机给出（`0x1f/0x07`），空槽在模式行末尾显示为「＋」（文字「新建模式」留在 `title` / `aria-label`）。
- 编辑器能改名字、消噪档位、沉浸式、风噪滤除。勾上「机身可切换」会同时写进 `0x1f/0x08`，不勾的话机身的模式键轮不到它。
- 保存发 `0x1f/0x06`，40 字节：槽位、提示词两字节、32 字节名字、消噪、自动消噪、沉浸式、风噪、ANC。写完自动 `0x1f/0x03` 切过去，耳机当场换。删除走 `0x1f/0x09`。
- 名字是 UTF-8 32 字节，中文约 10 个字；超长在整字边界截断，不会切坏字符。
- 当前模式本身是可编辑的自定义模式时，再点一次它的按钮进入编辑。

### 快捷动作

`0x01/0x09` 读回来的支持位图就是可选项（语音助手、切换设备、上一曲、模式轮播、沉浸式音频等），选一个写回去。标题里的「长按」来自耳机上报的按键事件类型。写完要按一次机身上的多功能键才会用上。

机身模式键轮哪些模式由 `0x1f/0x08` 决定，在设置页「机身模式循环」里勾。

### 空间校准

`0x05/0x11` 只读，回的是一包姿态数据；写回要官方云端 CustomTune，本项目不写。写坏会让空间音频一直偏，得回官方 App 重新校准才能好。

## 华为（HUAWEI）

macOS、Android 和由 `server.py` 提供的浏览器页面能连华为。设备中心里出现的就是系统里配对过的华为耳机（名字含 `HUAWEI` / `FreeBuds` / `FreeClip` / `FreeLace` / `荣耀`），点一台就连一台；这时顶栏下拉也能直接换到另一台华为耳机。

| | 能不能用 |
| --- | --- |
| macOS App | 可以，经典蓝牙 SPP（RFCOMM） |
| Android App | 可以，SPP；还没在 Android 真机上跑过 |
| Chrome / Edge | 可以，前提是页面由 `server.py` 提供（本机串口桥）；直接开静态文件不行 |
| iOS App | 不行（系统不给第三方 SPP） |

### iPhone 上怎么管华为耳机

本项目在 iPhone 上是 Bose 单品牌，没有「切换到华为」这个动作——不是按钮藏起来，是没有通道：华为的控制口是经典蓝牙串口（SPP / RFCOMM），iOS 的 CoreBluetooth 只开放 BLE / GATT，经典蓝牙的数据通道只给 MFi 认证配件（ExternalAccessory），华为耳机不是 MFi。

两条路：

- 用华为自家的「智慧音频」（App Store，iOS 13+，2026-10 仍在更新），连接、音效设置、固件更新都在里面。
- 在 Mac 上用本项目改一次：设置是直接写进耳机的，跟着耳机走，之后 iPhone 当播放端就行。

已验证机型：HUAWEI FreeClip 2（固件 HarmonyOS 6.0.0.256 与 7.0.0.516 均验过，型号 BTFT0027）。其他 FreeBuds / FreeClip 走同一套命令，没真机就不写死，能回包才显示。

| 主页 | 设置页 |
| --- | --- |
| 均衡预设 | 语言 |
| 低延迟 | 手势：双击 / 三击 / 长按（左右耳分开） / 滑动 |
| 摘下暂停 | 语音语言 |
| | 音质偏好（连接优先 / 音质优先） |
| | 已配对设备 |
| | 耳机操作：断开连接 |
| | 诊断（型号、双耳序列号、双连接状态） |

### 已配对设备

设置页「已配对设备」列的是**耳机自己记住的对端**（Mac、手机这些），不是 Mac 上配对过的耳机。

- 每台显示名字和状态：已连接 / —。
- **连接 / 断开**：`2b33`，参数类型就是动作号（1 连、2 断、4 开自动连接、5 关自动连接），值是对端 MAC。
- **自动连接**：同上，4 / 5。
- **常用**：`2b32` 设首选设备。
- 耳机那边一有变化就推 `2b36`，页面自动重新枚举；也可以点「刷新」。

能不能连上取决于对端在不在、愿不愿意连，命令只负责发出去。在列表里对 Mac 自己点断开，会真的把这条链路断掉，App 回到设备中心。

### 为什么有些块没有

- **消噪**：只有耳机自己报了「降噪」这一档（`2b2a` 的位图里有 bit1）才渲染。FreeClip 2 会回 `2b2a`（正常 / 通透），但它是开放式耳机，参考实现 OpenFreebuds 也把它的 ANC 面板排除在外。
- **双连接总开关**：`2b2e` 写 0/1 都回成功，但读回来一直是 1，耳机不接受这条路，所以只显示状态、不给开关。
- **改名 / 关机 / 播放控制 / 自定义 EQ**：SPP 里没找到对应命令，不做。

### 传输细节

包格式和 CRC 见 `web/spp.js`：`5a | 长度(2 大端) | 00 | 命令(2) | [参数类型 1][长度 1][值]… | CRC16`，长度从 `00` 起算，整包 = 长度 + 5，CRC 是 XMODEM（多项式 0x1021）。

`tests/spp.test.mjs` 里的每一帧都是 FreeClip 2 真机抓的，包括我们自己发的请求——编码出来的字节和当初耳机接受过的完全一致。

命令表来自 [OpenFreebuds](https://github.com/melianmiko/OpenFreebuds) 的华为 SPP 驱动（Python，自带 FreeClip 2 型号支持），本项目只做了 JS 实现和界面。

读的时候每条之间留 90ms 空隙，一轮读完界面就交出去了；没读到的项在后台再补一轮，耳机能回的都迟早会出来。

### 连不上时

- 浏览器直接开静态文件时，华为不在可选品牌里（Web Bluetooth 给不了 SPP）；改用 `server.py` 打开页面就有这条通道。
- macOS 上没配对过会提示先配对；配对过但耳机在盒里、或刚被别的设备占着时，SPP 会话可能整个不响应，再点一次即可。

## 加一个品牌

宿主和原生端都不认品牌，加三星这类耳机时只动这两处：

1. 新建 `web/<brand>.js`，导出 brand 描述符（现成例子：`web/bose.js`、`web/huawei.js`）：

```js
export const huaweiBrand = {
  id: "huawei",
  label: "HUAWEI",
  transport: "spp",        // "ble" 走 GATT，"spp" 走蓝牙串口
  channels: [1, 2, 3],     // 端口号候选，从 SDP 里取不到时按顺序试
  services: [],            // 可选：私有控制服务的 UUID，原生端按它去 SDP 里找端口
  matches: (name) => /huawei|freebuds/i.test(name),
  codec: createHuaweiCodec,  // { reset, chunks, parse, key, header }，帧格式自己定
  create: (ctx) => new HuaweiHeadset(ctx),
};
```

2. 在 `web/brands.js` 的数组里加一行。

`create(ctx)` 收到 `{ link, ui, state, refresh, log }`，返回的东西宿主只认四个入口：

| 入口 | 作用 |
| --- | --- |
| `load()` | 连上后读全量状态，写进本次连接独立的 `state`，返回「有没有读到东西」 |
| `ready()`（可选） | 已解析到可用控制时返回 true；宿主在 `refresh()` 时检查，不等 `load()` 全部结束 |
| `render()` | 把主页面板画出来（谁回包画谁） |
| `renderSettings()` | 设置页里属于这个品牌的部分 |
| `onPacket(packet)` | 主动上报（电量变化、模式切换、连接受理） |

`codec` 负责帧层：`chunks(bytes, link)` 怎么切、`parse(chunk, link)` 怎么拼回包、`key(packet)` 用什么做请求/回应对应、`header(bytes)` 从请求字节里取出包头的 key。

每次连接使用独立的 `HeadsetLink` 和品牌状态。品牌只拿到绑定该连接的 `scope()`，旧后台任务不能向新设备写入。原生桥仍只有一个 owner，不提供多设备同时控制。构造新实例不会抢回调，调用 `connect()` 才交接。

三端内置页面与原生桥必须一起更新：`bleConnect` 的 JSON 带 `session`；`sendData` 接收 `{session, hex}` 的 JSON 字符串；`bleDisconnect` 接收 session 字符串。连接、数据、错误回调都以 session 为最后一个参数，断开回调为 `onNativeDisconnected(session)`。设备列表回调不变。旧原生桥不能混用新版页面。

Bose 和华为已确认可用的控制会先出现，其余能力继续读取，未回包的控件仍隐藏。请求最多四条在途，同命令串行，用户写入及确认读取优先于排队的后台探测。华为请求在实际发送处间隔 90ms，排队时间不计入回包超时。设置页诊断记录从点击到通道打开、控制可用和首轮读取完成的耗时；这些日志用于真机比较，不代表固定加载时间。

原生端（`macos/BoseControl`、`android/`、`tools/bt-bridge`）不知道任何品牌：它只把系统里配对过的设备列表交给页面，连接时按页面给的 `transport` / `address` / `channels` / `services` 干活——`services` 是 16 字节的服务 UUID，串口端口号优先从 SDP 里按 UUID 找，找不到再按 `channels` 一个个试。所以加品牌不需要改原生代码。

## 兼容性

页面不按型号写死开关，谁回包就显示谁：每个功能都是连上后单独 GET 一次，有回复才渲染那一块，没回复整块隐藏（连标题一起）。所以同一份代码可以覆盖 QC Ultra、QC45、NC700、earbuds 等不同能力集。

Bose 走 BMAP，华为走 SPP，两边共用同一套页面和「谁回包就显示谁」的规则。

| 区块 | 出现的条件 |
| --- | --- |
| 模式 | `0x1f/0x03` 有回复，且 `0x1f/0x02` 或 `0x1f/0x07` 能给出槽位 |
| 新建/编辑自定义模式 | 有空槽（`0x1f/0x06` 读回「可编辑」且没配过） |
| 降噪 | `0x01/0x05` 或音效设置 `0x1f/0x0a` 有回复 |
| 均衡 | `0x01/0x07` 返回频段 |
| 空间音效 | 音效设置可读 |
| 侧音 | `0x01/0x0b` 有回复 |
| 语音提示 | `0x01/0x03` 返回语言位图 |
| 播放控制 | `0x05/0x03` 有回复 |
| 双连 / 对话 / 禁触控 / 自动接听 / 自动播放 | 对应 GET 有回复 |
| 耳机名称 | `0x01/0x02` 有回复 |
| 快捷动作 | `0x01/0x09` 有回复，选项来自它给的支持位图 |
| 机身模式循环 | `0x1f/0x08` 有回复 |
| 已配对设备 | `0x04/0x04` 有回复 |
| 自动关机 | `0x01/0x04` 有回复 |
| 进入配对 / 关机 | 连上就显示，点两次才发 |
| 设备信息（产品名称/变型/固件/序列号/双耳序列号/MAC/生产/硬件） | 任一字段有回复，设置页出现「设备信息」卡片 |

- 电量按拿到的组件数写：三段写 L / R / C，一条读数只写百分比；列表上只显示当前这台真读到的电量，别的设备不编数字。
- 找设备时按名字前缀（`Bose`、`LE-Bose`、`QC`、`QuietComfort`、`SoundLink`）或 FEBE 服务匹配，改名或匿名的耳机靠服务也能扫到；iOS/Android 原生端同样放 `bose`/`qc`/`quietcomfort`/`soundlink` 关键字。
- 连上了但 BMAP 一个回包都没有（比如连到别家耳机），会自动断开并提示「设备不支持」，不会留一个空白的控制页。
- 能力探测并行进行，首轮没回的项在界面出来之后后台再补一次（超时更长），慢设备不会被误判成不支持。

连不上时的提示都由 `web/link.js` 统一给出（原生端只上报错误码，不拼中文）：`请先连接耳机`、`正在找耳机`、`需要先开启蓝牙`、`需要蓝牙权限`、`当前环境不支持蓝牙`、`没找到耳机，再试一次`、`耳机被别的设备连着`、`设备不支持`、`没连上，再试一次`、`请重新连接`、`需要开启定位服务`。每条都在 10 字以内，保证窄屏单行不换行。

已验证机型：Bose QuietComfort Ultra Headphones、HUAWEI FreeClip 2。其他型号按上面的机制自动适配，若某块显示不对，请附 `console.debug` 里的请求/回复记录提 issue。
