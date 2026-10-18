# Bose 本地控制

BMAP 控制页。不登录官方云。电脑 Chrome 走 Web Bluetooth；iPhone / 部分 Android 走 App 壳里的原生蓝牙。

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

## Android（开源发 Release）

`android/`。WebViewAssetLoader 加载 `assets/www/`。`NativeBLE`：BLE 先扫，没有再试已配对设备的 RFCOMM（`00000000-deca-fade-deca-deafdecacaff`）。

权限：`BLUETOOTH_SCAN`、`BLUETOOTH_CONNECT`（12+）。Release 已开 `minifyEnabled` / `shrinkResources`。

本机没有 Android SDK 时用 Android Studio 打开 `android/` 再 Assemble Release。

## 传输

| | BLE GATT | RFCOMM |
| --- | --- | --- |
| Chrome | 有 | 无 |
| iOS App | 有 | 无（系统不给第三方） |
| Android App | 有 | 有 |
