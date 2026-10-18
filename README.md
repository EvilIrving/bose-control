# Bose 本地控制

BMAP 控制页。不登录官方云。电脑 Chrome 走 Web Bluetooth；iPhone / Mac / 部分 Android 走 App 壳里的原生蓝牙。

改 `web/` 之后跑 `scripts/sync-web.sh` 再编 App。

## 电脑 Chrome

```bash
python3 server.py
```

打开打印出来的 `https://127.0.0.1:8443/`。

## iOS

`ios/BoseControl.xcodeproj`。WKWebView 加载内置 `Web/`，CoreBluetooth 连 FEBE。

Info.plist 已有 `NSBluetoothAlwaysUsageDescription`。用开发者账号选 Team 后真机安装。审核按硬件配套工具交：备注型号，附一段连接改降噪的视频。

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

## 传输

| | BLE GATT | RFCOMM |
| --- | --- | --- |
| Chrome | 有 | 无 |
| iOS App | 有 | 无（系统不给第三方） |
| macOS App | 有 | 有 |
| Android App | 有 | 有 |

## 兼容性

页面不按型号写死开关，谁回包就显示谁：每个功能都是连上后单独 GET 一次，有回复才渲染那一块，没回复整块隐藏（连标题一起）。所以同一份代码可以覆盖 QC Ultra、QC45、NC700、earbuds 等不同能力集。

| 区块 | 出现的条件 |
| --- | --- |
| 模式 | `0x1f/0x01` 能列出模式，至少一个可用 |
| 降噪 | `0x01/0x05` 或音效设置 `0x1f/0x0a` 有回复 |
| 均衡 | `0x01/0x07` 返回频段 |
| 空间音效 | 音效设置可读 |
| 侧音 | `0x01/0x0b` 有回复 |
| 语音提示 | `0x01/0x03` 返回语言位图 |
| 双连 / 对话 / 禁触控 / 自动接听 / 自动播放 | 对应 GET 有回复 |
| 关机 | `0x01/0x04` 有回复 |
| 设备信息（型号/固件/序列号/MAC/生产/硬件） | 任一字段有回复，顶栏电量右侧出现小箭头 |

- 电量按组件数显示：1 个直接百分比，2 个「左/右」，3 个「左/盒/右」。
- 找设备时按名字前缀（`Bose`、`LE-Bose`、`QC`、`QuietComfort`、`SoundLink`）或 FEBE 服务匹配，改名或匿名的耳机靠服务也能扫到；iOS/Android 原生端同样放 `bose`/`qc`/`quietcomfort`/`soundlink` 关键字。
- 连上了但 BMAP 一个回包都没有（比如连到别家耳机），会自动断开并提示「设备不支持」，不会留一个空白的控制页。
- 能力探测失败会自动重试一次（超时翻倍），慢设备不会被误判成不支持。

连不上时的提示都由 `web/link.js` 统一给出（原生端只上报错误码，不拼中文）：`请先连接耳机`、`需要先开启蓝牙`、`需要蓝牙权限`、`没找到耳机，再试一次`、`耳机被别的设备连着`、`设备不支持`、`连接已断开，重连`。每条都在 10 字以内，保证窄屏单行不换行。

已验证机型：Bose QuietComfort Ultra Headphones。其他型号按上面的机制自动适配，若某块显示不对，请附 `console.debug` 里的请求/回复记录提 issue。
