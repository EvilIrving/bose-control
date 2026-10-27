# Bose Connector 隐私政策 / Privacy Policy

生效日期：2026-10-27

Bose Connector 是一个不登录、不联网的耳机控制工具，支持 macOS、iOS、Android 和浏览器。下面说明它接触到的数据。

## 我们不收集数据

- 没有账号，不需要登录。
- 没有分析、广告、崩溃上报或任何第三方 SDK。
- App 不会把你的数据发到任何服务器。浏览器版本由本机的 `server.py` 提供时，页面只和 `127.0.0.1` 通信。

## 留在设备上的数据

为了让你下次打开还能用，App 只在设备本地保存这些内容：

| 内容 | 用途 | 位置 |
| --- | --- | --- |
| 语言、上次使用的品牌 | 记住你的选择 | 系统偏好设置 / 浏览器 localStorage |
| 耳机名称、蓝牙地址、型号、固件、序列号、电量 | 显示设备信息和状态 | 只在内存里，重新连接时从耳机读取 |
| 诊断日志 | 排查连接问题，只有你点「导出诊断」才会生成文件 | App 私有目录，最多保留 7 天 / 10 MiB |

诊断日志会包含设备名称、蓝牙地址、协议收发的字节和错误码。它不会自动上传；导出的文本也只写到本机（Android 的「下载」、macOS 的 `~/Downloads`、iOS 的「文件」）。你可以随时删除这些文件。

## 权限

- **蓝牙**：连接耳机、读写设置。没有蓝牙权限就找不到设备。
- **定位（仅部分 Android 系统）**：Android 12 起蓝牙扫描通常不需要定位权限，但 vivo、OPPO、小米等系统仍可能要求开启定位服务和定位权限才能扫到 BLE 设备。App 不读取、不保存、不上传你的位置。

## 第三方

App 不接入第三方分析、广告或数据经纪服务。设备中心显示的 Bose、HUAWEI 词标只用于识别设备品牌，商标归各家公司所有。

## 儿童

App 不收集任何人的数据，包括儿童。

## 变更与联系

政策有变化会更新这个文件。问题、数据相关的请求，请开 issue：
<https://github.com/EvilIrving/bose-control/issues>

---

# Privacy Policy (English)

Effective date: 2026-10-27

Bose Connector controls headphones without an account or an internet connection. It runs on macOS, iOS, Android, and in a browser.

## We do not collect data

- No account, no sign-in.
- No analytics, advertising, crash reporting, or third-party SDKs.
- The apps do not send your data to any server. When the browser version is served by the local `server.py`, the page talks only to `127.0.0.1`.

## Data kept on your device

| Data | Why | Where |
| --- | --- | --- |
| Language, last used brand | Remember your choice | System preferences / browser localStorage |
| Headphone name, Bluetooth address, model, firmware, serial number, battery | Show device information and status | Memory only; read from the headphones on each connection |
| Diagnostic logs | Troubleshoot connections; a file is created only when you tap Export diagnostics | App-private folder, kept for at most 7 days / 10 MiB |

Diagnostic logs can contain device names, Bluetooth addresses, protocol bytes, and error codes. They are never uploaded automatically. Exported text is written locally (Downloads on Android, `~/Downloads` on macOS, Files on iOS). You can delete these files at any time.

## Permissions

- **Bluetooth**: to find headphones and read or change settings.
- **Location (some Android systems only)**: Android 12 and later usually does not need location for Bluetooth scanning, but some vendor ROMs still require location services and permission to find BLE devices. The app does not read, store, or upload your location.

## Third parties

The app does not use third-party analytics, advertising, or data brokers. The Bose and HUAWEI wordmarks in the device list identify the brand of each device; those trademarks belong to their owners.

## Children

The app collects no data from anyone, including children.

## Changes and contact

This file will be updated when the policy changes. For questions or data requests, open an issue:
<https://github.com/EvilIrving/bose-control/issues>
