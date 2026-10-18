# bose-control

[![android](https://github.com/EvilIrving/bose-control/actions/workflows/android.yml/badge.svg)](https://github.com/EvilIrving/bose-control/actions/workflows/android.yml) [![apple](https://github.com/EvilIrving/bose-control/actions/workflows/apple.yml/badge.svg)](https://github.com/EvilIrving/bose-control/actions/workflows/apple.yml)

不登录、不联网，用蓝牙直接控制 Bose 耳机。

官方 App 要账号、要云、要定位权限。这里只做一件事：手机或电脑直连耳机，走 Bose 私有的 BMAP 协议改降噪、模式、均衡、侧音、双连这些设置，数据不出本机。

- **网页版**：Chrome / Edge 的 Web Bluetooth，打开就能连
- **App**：Android（BLE + RFCOMM）、iOS（BLE）、macOS（BLE + RFCOMM）
- **按能力渲染**：不同 Bose 型号支持的功能不一样，耳机不回的功能整块隐藏，不会留一个空面板

Controls Bose Bluetooth headphones over the BMAP protocol from the browser or a native app. No account, no cloud, no telemetry.

改 `web/` 之后跑 `scripts/sync-web.sh` 再编 App（Android / iOS / macOS 三端共用同一份页面）。

## 电脑 Chrome

```bash
python3 server.py
```

打开打印出来的 `https://127.0.0.1:8443/`。

## iOS

`ios/BoseControl.xcodeproj`。WKWebView 加载内置 `Web/`，CoreBluetooth 连 FEBE。

Info.plist 已有 `NSBluetoothAlwaysUsageDescription`。用开发者账号选 Team 后真机安装。审核按硬件配套工具交：备注型号，附一段连接改降噪的视频。

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

`macos/BoseControl.xcodeproj`。WKWebView 加载内置 `Web/`。经典蓝牙已连上 Bose 时走 RFCOMM（channel 2，再试 8）；否则先 BLE GATT FEBE，失败再 RFCOMM。

```bash
xcodebuild -project macos/BoseControl.xcodeproj -scheme BoseControl -configuration Release -destination 'platform=macOS'
```

产物 `macos/build/Build/Products/Release/BoseControl.app`。第一次打开需要蓝牙权限。

## Android（开源发 Release）

`android/`。WebViewAssetLoader 加载 `assets/www/`。`NativeBLE`：BLE 先扫，没有再试已配对设备的 RFCOMM（`00000000-deca-fade-deca-deafdecacaff`）。

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

| | BLE GATT | RFCOMM |
| --- | --- | --- |
| Chrome | 有 | 无 |
| iOS App | 有 | 无（系统不给第三方） |
| macOS App | 有 | 有 |
| Android App | 有 | 有 |

## 主页与设置页

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
| | 耳机操作：进入配对 / 关机 |

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

## 兼容性

页面不按型号写死开关，谁回包就显示谁：每个功能都是连上后单独 GET 一次，有回复才渲染那一块，没回复整块隐藏（连标题一起）。所以同一份代码可以覆盖 QC Ultra、QC45、NC700、earbuds 等不同能力集。

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
| 设备信息（型号/固件/序列号/MAC/生产/硬件） | 任一字段有回复，顶栏电量右侧出现小箭头 |

- 电量按组件数显示：1 个直接百分比，2 个「左/右」，3 个「左/盒/右」。
- 找设备时按名字前缀（`Bose`、`LE-Bose`、`QC`、`QuietComfort`、`SoundLink`）或 FEBE 服务匹配，改名或匿名的耳机靠服务也能扫到；iOS/Android 原生端同样放 `bose`/`qc`/`quietcomfort`/`soundlink` 关键字。
- 连上了但 BMAP 一个回包都没有（比如连到别家耳机），会自动断开并提示「设备不支持」，不会留一个空白的控制页。
- 能力探测失败会自动重试一次（超时翻倍），慢设备不会被误判成不支持。

连不上时的提示都由 `web/link.js` 统一给出（原生端只上报错误码，不拼中文）：`请先连接耳机`、`需要先开启蓝牙`、`需要蓝牙权限`、`没找到耳机，再试一次`、`耳机被别的设备连着`、`设备不支持`、`请重新连接`。每条都在 10 字以内，保证窄屏单行不换行。

已验证机型：Bose QuietComfort Ultra Headphones。其他型号按上面的机制自动适配，若某块显示不对，请附 `console.debug` 里的请求/回复记录提 issue。
