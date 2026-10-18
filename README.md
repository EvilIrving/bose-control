# Bose Connector

[![android](https://github.com/EvilIrving/bose-control/actions/workflows/android.yml/badge.svg)](https://github.com/EvilIrving/bose-control/actions/workflows/android.yml) [![apple](https://github.com/EvilIrving/bose-control/actions/workflows/apple.yml/badge.svg)](https://github.com/EvilIrving/bose-control/actions/workflows/apple.yml)

不登录、不联网，用蓝牙直接控制 Bose 和华为耳机。

官方 App 要账号、要云、要定位权限。这里只做一件事：手机或电脑直连耳机，Bose 走私有的 BMAP 协议，华为走蓝牙串口（SPP），数据不出本机。

- **网页版**：Chrome / Edge 的 Web Bluetooth，打开就能连（只有 Bose）
- **App**：macOS（BLE + RFCOMM）、Android（BLE + RFCOMM）、iOS（BLE）
- **设备中心**：macOS 上首页就是设备中心，系统里配对过的耳机都列出来，点哪台控哪台
- **按能力渲染**：耳机不回的功能整块隐藏，不会留一个空面板

Controls Bose headphones over BMAP and HUAWEI earbuds over SPP, from the browser or a native app. No account, no cloud, no telemetry.

改 `web/` 之后跑 `scripts/sync-web.sh` 再编 App（Android / iOS / macOS 三端共用同一份页面）。

## 界面

三页，只有当前页可见可点：

| 页面 | 内容 | 怎么进出 |
| --- | --- | --- |
| 设备中心（首页） | 已配对的耳机，每台一个方块：名字 / 品牌 / 已连接·电量 或 未连接。已连接的排前面，组内按名字自然序 | 启动就到，右上角 ↻ 重新枚举 |
| 设备页 | 顶栏是可点的「名字 · 电量」下拉，点开就列设备中心里的耳机，正在连的那台打勾，选别的直接换过去；下面是各功能面板 | 点方块进；右上角小箭头返回，或按 `Esc` |
| 设置页 | 语言，各品牌自己的配置项，已配对设备，设备信息（产品名称 / 产品变型 / 固件版本 / 序列号 / 双耳序列号 / 蓝牙 MAC / 硬件版本），耳机操作，诊断 | 设备页底部「设置」进，右上角「完成」出 |

- 返回**不断开**：回到设备中心时那台设备仍连着、方块高亮并带电量，再点它就是回到控制页，不会重连。
- 要真断开在设置页「耳机操作 → 断开连接」，或者顶栏下拉里的「断开连接」。
- 顶栏下拉在没有设备中心的平台上（浏览器 / iOS / Android）只列当前这台，加「刷新 / 断开连接」两项。
- 品牌芯片只在能连两个品牌的平台出现（现在只有 macOS）。iPhone 与浏览器上华为那条通道走不通，所以那里连芯片都不显示，原因见下面的「iPhone 上怎么管华为耳机」。
- 设备中心只在能枚举系统配对设备的平台上出现（目前是 macOS）。浏览器 / iOS / Android 上首页只有一个「连接」按钮。

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

- **Bose**：先看经典蓝牙是不是已经连着，连着直接开 RFCOMM（channel 2，再试 8，再试 SDP 里找到的）；没连就先 BLE GATT FEBE，失败再 RFCOMM。
- **华为**：直接开 SPP。端口从 SDP 里按服务名（`Serial Port` / `Private COM`）取，取不到再试 1 / 2 / 3。不碰免提、A2DP 那些 RFCOMM 口，写进去会打断通话。

```bash
xcodebuild -project macos/BoseControl.xcodeproj -scheme BoseControl -configuration Release -destination 'platform=macOS' -derivedDataPath macos/build
```

产物 `macos/build/Build/Products/Release/BoseControl.app`。第一次打开需要蓝牙权限。

品牌记在 `UserDefaults`（自定义 scheme 下 localStorage 只在本次会话有效），下次启动不会被带偏。

## Android（开源发 Release）

`android/`。WebViewAssetLoader 加载 `assets/www/`。`NativeBLE`：BLE 先扫，没有再试已配对设备的 RFCOMM（`00000000-deca-fade-deca-deafdecacaff`）。

目前只接了 Bose：设备中心和华为 SPP 都还没做（Android 的 RFCOMM 是能给第三方的，缺的是 `getBondedDevices()` 枚举 + SPP UUID 那一步）。

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
| Chrome | 有 | 无 | 无（Web Bluetooth 只给 GATT） |
| iOS App | 有 | 无（系统不给第三方） | 无（同上） |
| macOS App | 有 | 有 | 有 |
| Android App | 有 | 有 | 还没接 |

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

- 槽位由耳机给出（`0x1f/0x07`），空槽在模式行里显示成「＋ 新建模式」。
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

目前只有 macOS 版能连华为。设备中心里出现的就是系统里配对过的华为耳机（名字含 `HUAWEI` / `FreeBuds` / `FreeClip` / `FreeLace` / `荣耀`），点一台就连一台；这时顶栏下拉也能直接换到另一台华为耳机。

| | 能不能用 |
| --- | --- |
| macOS App | 可以，经典蓝牙 SPP（RFCOMM） |
| Chrome / Edge | 不行：华为的控制口是蓝牙串口，Web Bluetooth 只给 GATT |
| iOS App | 不行（系统不给第三方 SPP） |
| Android App | 还没接（`BmapBridge` 只认 Bose） |

### iPhone 上怎么管华为耳机

本项目在 iPhone 上是 Bose 单品牌，没有「切换到华为」这个动作——不是按钮藏起来，是没有通道：华为的控制口是经典蓝牙串口（SPP / RFCOMM），iOS 的 CoreBluetooth 只开放 BLE / GATT，经典蓝牙的数据通道只给 MFi 认证配件（ExternalAccessory），华为耳机不是 MFi。

两条路：

- 用华为自家的「智慧音频」（App Store，iOS 13+，2026-10 仍在更新），连接、音效设置、固件更新都在里面。
- 在 Mac 上用本项目改一次：设置是直接写进耳机的，跟着耳机走，之后 iPhone 当播放端就行。

已验证机型：HUAWEI FreeClip 2（固件 HarmonyOS 6.0.0.256，型号 BTFT0027）。其他 FreeBuds / FreeClip 走同一套命令，没真机就不写死，能回包才显示。

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

- 安卓 / 浏览器的提示是「华为耳机要用 App」，因为那边没有 SPP 通道。
- macOS 上没配对过会提示先配对；配对过但耳机在盒里、或刚被别的设备占着时，SPP 会话可能整个不响应，再点一次即可。

## 加一个品牌

宿主和原生端都不认品牌，加 VIVO / OPPO / 三星这类耳机时只动这两处：

1. 新建 `web/<brand>.js`，导出 brand 描述符：

```js
export const vivoBrand = {
  id: "vivo",
  label: "vivo",
  transport: "spp",        // "ble" 走 GATT，"spp" 走蓝牙串口
  channels: [1, 2, 3],     // SPP 端口候选，SDP 里找到串口服务会插到最前面
  matches: (name) => /vivo|iqoo/i.test(name),
  codec: createVivoCodec,  // { reset, chunks, parse, key, header }，帧格式自己定
  create: (ctx) => new VivoSession(ctx),
};
```

2. 在 `web/brands.js` 的数组里加一行。

`create(ctx)` 收到 `{ link, ui, state, refresh, log }`，返回的东西宿主只认四个入口：

| 入口 | 作用 |
| --- | --- |
| `load()` | 连上后读全量状态，写进 `state`，返回「有没有读到东西」 |
| `render()` | 把主页面板画出来（谁回包画谁） |
| `renderSettings()` | 设置页里属于这个品牌的部分 |
| `onPacket(packet)` | 主动上报（电量变化、模式切换、连接受理） |

`codec` 负责帧层：`chunks(bytes, link)` 怎么切、`parse(chunk, link)` 怎么拼回包、`key(packet)` 用什么做请求/回应对应、`header(bytes)` 从请求字节里取出包头的 key。

原生端（`macos/BoseControl`）不知道任何品牌：它只把系统里配对过的设备列表交给页面，连接时按页面给的 `transport` / `address` / `channels` 干活。所以加品牌不需要改 Swift。

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

- 电量按组件数显示：1 个直接百分比，2 个「左/右」，3 个「左/盒/右」。
- 找设备时按名字前缀（`Bose`、`LE-Bose`、`QC`、`QuietComfort`、`SoundLink`）或 FEBE 服务匹配，改名或匿名的耳机靠服务也能扫到；iOS/Android 原生端同样放 `bose`/`qc`/`quietcomfort`/`soundlink` 关键字。
- 连上了但 BMAP 一个回包都没有（比如连到别家耳机），会自动断开并提示「设备不支持」，不会留一个空白的控制页。
- 能力探测并行进行，首轮没回的项在界面出来之后后台再补一次（超时更长），慢设备不会被误判成不支持。

连不上时的提示都由 `web/link.js` 统一给出（原生端只上报错误码，不拼中文）：`请先连接耳机`、`需要先开启蓝牙`、`需要蓝牙权限`、`没找到耳机，再试一次`、`耳机被别的设备连着`、`设备不支持`、`请重新连接`。每条都在 10 字以内，保证窄屏单行不换行。

已验证机型：Bose QuietComfort Ultra Headphones、HUAWEI FreeClip 2。其他型号按上面的机制自动适配，若某块显示不对，请附 `console.debug` 里的请求/回复记录提 issue。
