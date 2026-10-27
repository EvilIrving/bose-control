# 上架清单

截至 2026-10-27。这里只写会影响提交或审核的东西，界面细节见 README。

## 本次已做

- **版本号接上构建设置**：iOS / macOS 的 `Info.plist` 里 `CFBundleShortVersionString` 改成 `$(MARKETING_VERSION)`，`CFBundleVersion` 改成 `$(CURRENT_PROJECT_VERSION)`。之前写死 `0.1.0 / 1`，`MARKETING_VERSION = 0.2.0` 根本没进包；TestFlight 用 `CURRENT_PROJECT_VERSION=$GITHUB_RUN_NUMBER` 覆盖也会被 plist 里的 `1` 盖掉，第二次上传会因构建号重复失败。实测覆盖成 42 后包内是 `42`，版本是 `0.2.0`。
- **隐私清单**：新增 `PrivacyInfo.xcprivacy`，iOS / macOS 都编进包。声明无跟踪、无收集数据；`UserDefaults` 用 `CA92.1`（只读写本 App 的设置），文件时间戳用 `C617.1`（只读 App 自己日志目录的元数据）。macOS 清单是保险，Apple 目前只对 iOS 等平台强制 required-reason API 声明。
- **iPad 方向**：`TARGETED_DEVICE_FAMILY = 1,2`，但 `Info.plist` 只声明了三个方向。补了 `UISupportedInterfaceOrientations~ipad` 四方向，避免 iPad 审核和多任务校验出问题。
- **隐私政策草稿**：`docs/privacy.md`。推送后可直接用
  `https://github.com/EvilIrving/bose-control/blob/main/docs/privacy.md`
  作为 App Store / Play 的隐私政策 URL（仓库是公开的）。

## macOS App Store

| 状态 | 事项 |
| --- | --- |
| **硬阻塞** | App Sandbox 现在是关的：`BoseControl.entitlements` 里 `com.apple.security.app-sandbox = false`，工程里 `ENABLE_APP_SANDBOX = NO`。Mac App Store 审核指南 2.4.5 要求沙盒，必须改成开。 |
| **要你决策** | 开沙盒后，`IOBluetoothDevice.pairedDevices()` 和 RFCOMM（华为 SPP）不一定还能用。Apple 只保证 CoreBluetooth；经典蓝牙在沙盒下常见空列表或打不开通道。这台机器上没做真机验证，不能保证。如果不行，商店版就要砍掉华为和设备中心，只留 Bose BLE——等于换一个产品。 |
| 必做 | 打开沙盒后，导出诊断写到 `~/Downloads` 需要 `com.apple.security.files.downloads.read-write`；否则导出会失败。 |
| 必做 | App Store Connect 建记录（Bundle ID `cain.com.bosecontrol.mac`，Team `QZZ878S3NS`），准备截图、描述、关键词、隐私政策 URL、审核备注。 |
| 已验证 | Release 构建通过，包内版本 `0.2.0 (3)`，`PrivacyInfo.xcprivacy` 在 `Contents/Resources/`。 |

## iOS App Store

| 状态 | 事项 |
| --- | --- |
| 必做 | App Store Connect 建记录（Bundle ID `cain.com.bosecontrol`），确认没被占用。TestFlight 的 CI 已配好，需要 `ASC_KEY_ID` / `ASC_ISSUER_ID` / `ASC_KEY` 三个 secrets。 |
| 必做 | 截图（iPhone；保留 iPad 支持还要 iPad 截图）、隐私政策 URL、支持 URL、年龄分级、审核备注。硬件配套 App 要写清支持的型号，并附一段真机连接、改降噪的视频。 |
| 要你决策 | 工程声明支持 iPad（`TARGETED_DEVICE_FAMILY = 1,2`）。继续支持就按 iPad 交截图和测试；不支持就把这个值改成 `1`，省掉一套素材。 |
| 已验证 | iOS 模拟器 Release 构建通过，包内版本 `0.2.0 (3)`，方向声明和 `PrivacyInfo.xcprivacy` 都在包里。 |

## Google Play

| 状态 | 事项 |
| --- | --- |
| **硬阻塞** | Google Play 从 2026-08-31 起要求新应用和更新 `targetSdk` 至少 36。现在是 `compileSdk 35 / targetSdk 35`，提交会被拒。要升到 36，同时升 AGP / Gradle，并在 Android 16 上验边缘到边缘布局（targetSdk 36 会强制）。本机没有 Android SDK / JDK，这项没动也没验证。 |
| **硬阻塞** | 没有上传签名。`android/app/build.gradle` 没有 `signingConfigs`，CI 只出 debug APK。Play 要签过名的 AAB 和 upload key（keystore 不要进仓库）。 |
| 必做 | Play Console：建应用、隐私政策 URL、数据安全表单（要说明定位权限只用于部分 ROM 的 BLE 扫描）、内容分级、商店素材（512×512 图标、feature graphic、截图）。 |
| 风险 | 华为 SPP 在 Android 上还没真机验证（README 里就写着）。上架前至少要在一台真实 Android 手机上连一次 FreeClip。 |
| 已验证 | 无。本机只有 `platform-tools`，没有 SDK，跑不了 Gradle。 |

## 三端共同

| 状态 | 事项 |
| --- | --- |
| **要你决策** | App 名叫 **Bose Connector**，界面上还有 Bose / HUAWEI 词标。App Store 审核指南 5.2.1 管第三方商标；用别人的品牌做 App 名有被拒风险。要么准备品牌授权说明，要么改商店里的显示名（词标本身是标识设备，风险小一些）。 |
| 必做 | App Store Connect 的「App 隐私」选「不收集数据」，要和 `PrivacyInfo.xcprivacy` 一致。 |
| 必做 | 硬件配套 App 的审核备注和演示视频（Bose 连接、改降噪、华为改 EQ）。 |
| 可选 | 现在只有 GitHub Release 的 macOS 包和 Android APK；上架后建议保留这条直装渠道，商店版和直装版分开签名/配置。 |

## 本机怎么复核

```bash
# iOS：版本号、方向、隐私清单是否进包
xcodebuild -project ios/BoseControl.xcodeproj -scheme BoseControl \
  -configuration Release -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/bose-ios CODE_SIGNING_ALLOWED=NO build
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
  /tmp/bose-ios/Build/Products/Release-iphonesimulator/BoseControl.app/Info.plist
ls /tmp/bose-ios/Build/Products/Release-iphonesimulator/BoseControl.app/PrivacyInfo.xcprivacy

# macOS：版本号、隐私清单、沙盒到底开没开（上架前必须是 true）
xcodebuild -project macos/BoseControl.xcodeproj -scheme BoseControl \
  -configuration Release -destination 'platform=macOS' \
  -derivedDataPath /tmp/bose-macos CODE_SIGNING_ALLOWED=NO build
codesign -d --entitlements :- /tmp/bose-macos/Build/Products/Release/BoseControl.app
```
