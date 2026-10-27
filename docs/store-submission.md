# 上架清单

截至 2026-10-27。这里只写会影响提交或审核的东西，界面细节见 README。

## 本次已做

- **版本号接上构建设置**：iOS / macOS 的 `Info.plist` 里 `CFBundleShortVersionString` 改成 `$(MARKETING_VERSION)`，`CFBundleVersion` 改成 `$(CURRENT_PROJECT_VERSION)`。之前写死 `0.1.0 / 1`，`MARKETING_VERSION = 0.2.0` 根本没进包；TestFlight 用 `CURRENT_PROJECT_VERSION=$GITHUB_RUN_NUMBER` 覆盖也会被 plist 里的 `1` 盖掉，第二次上传会因构建号重复失败。实测覆盖成 42 后包内是 `42`，版本是 `0.2.0`。
- **隐私清单**：新增 `PrivacyInfo.xcprivacy`，iOS / macOS 都编进包。声明无跟踪、无收集数据；`UserDefaults` 用 `CA92.1`（只读写本 App 的设置），文件时间戳用 `C617.1`（只读 App 自己日志目录的元数据）。
- **iPad 方向**：`TARGETED_DEVICE_FAMILY = 1,2`。补了 `UISupportedInterfaceOrientations~ipad` 四方向，并在 iPad Air 11 模拟器上装起来看过，页面能正常渲染。
- **macOS 商店版**：新增 `BoseControl-AppStore` scheme 和 `AppStore` 配置。它开 App Sandbox，只报 BLE，设备中心只列 Bose；直装版 `BoseControl` 配置仍然是 BLE + SPP，华为不受影响。
- **设备中心按宿主能力过滤**：页面现在会丢掉这台机器没有对应通道的品牌。商店版只报 BLE 时，华为卡片不出现，诊断里记 `reason=transport-unavailable`。
- **隐私政策草稿**：`docs/privacy.md`。推送后可直接用
  `https://github.com/EvilIrving/bose-control/blob/main/docs/privacy.md`
  作为 App Store / Play 的隐私政策 URL（仓库是公开的）。

## macOS App Store

| 状态 | 事项 |
| --- | --- |
| 已完成 | `BoseControl-AppStore` 开沙盒（`com.apple.security.app-sandbox = true`），带蓝牙、`files.downloads.read-write`、Wi-Fi/网络客户端权限。Mac App Store 审核指南 2.4.5 要求沙盒。 |
| 已验证 | 用开发签名把商店版跑起来：沙盒生效，页面加载成功，`IOBluetoothDevice.pairedDevices()` 仍能读到系统配对设备，设备中心只显示 Bose QC Ultra 2，华为两台被过滤。 |
| 已验证 | 沙盒里 WKWebView 必须有 `com.apple.security.network.client`，缺了 WebView 进程会被系统回收、页面全黑。这条已经写进商店版 entitlements。 |
| 已验证 | 商店版连接直接走 BLE，不再先试 RFCOMM；沙盒里 BLE 扫描能拿到周围 23 台广播。诊断导出走真实 `~/Downloads`（沙盒里 `.downloadsDirectory` 会落到容器，已改用 `getpwuid` 的真实家目录，单独用沙盒探针验过写入成功）。 |
| 未验证 | 实际连上 Bose 并读设置：测试时 QC Ultra 2 没开机/没广播，扫描找不到。上架前耳机开着再点一次。 |
| 说明 | 经典蓝牙 RFCOMM（华为 SPP）在沙盒下没测。商店版主动不暴露它，连接也不会尝试；直装版继续用 `BoseControl` 配置。 |
| 已完成 | 归档和导出都成功，产物在 `macos/build/export/Bose Connector.pkg`（3rd Party Mac Developer Installer 签名，Mac Team Store 描述文件，版本 `0.2.0 (3)`）。归档可用脚本重新生成。 |
| **唯一阻塞** | App Store Connect 里还没有 `cain.com.bosecontrol.mac` 的 App 记录。`xcodebuild` 上传直接报 `App record ... not found`。建记录只能在 App Store Connect 网站点「+ → New App」，要账号登录和 2FA；API 明确不支持创建 app（`POST /v1/apps` 返回 403）。 |
| 建完记录后 | 跑 `sh scripts/upload-macos-appstore.sh`，会自动归档、导出并上传。文案在 `docs/app-store-listing.md`。 |

## iOS App Store

| 状态 | 事项 |
| --- | --- |
| 已验证 | iOS 模拟器 Release 构建通过，包内版本 `0.2.0 (3)`，方向声明和 `PrivacyInfo.xcprivacy` 都在包里。iPad 模拟器能装能开。 |
| 必做 | App Store Connect 建记录（Bundle ID `cain.com.bosecontrol`），确认没被占用。TestFlight 的 CI 已配好，需要 `ASC_KEY_ID` / `ASC_ISSUER_ID` / `ASC_KEY` 三个 secrets。 |
| 已完成 | iPhone 6.9" 截图 8 张（1290×2796）在 `store-assets/iphone/`，Figma：https://www.figma.com/design/RxtAiv11kHC9HoQJdNmCDu/Bose-Connector |
| 必做 | App Store Connect 建记录（Bundle ID `cain.com.bosecontrol`）。文案、隐私 URL、审核备注见 `docs/app-store-listing.md`。审核视频仍要真机连 Bose 改一次降噪。 |

## Google Play（暂缓上架）

| 状态 | 事项 |
| --- | --- |
| 暂不上架 | Android 继续维护，先不提 Play。下面三条等要上架时再做。 |
| 到时必做 | Google Play 从 2026-08-31 起要求新应用和更新 `targetSdk` 至少 36。现在是 `compileSdk 35 / targetSdk 35`，提交会被拒。升级时一起升 AGP / Gradle，并在 Android 16 上验边缘到边缘布局。本机没有 Android SDK / JDK，这项没动也没验证。 |
| 到时必做 | 加上传签名。`android/app/build.gradle` 没有 `signingConfigs`，CI 只出 debug APK。Play 要签过名的 AAB 和 upload key（keystore 不要进仓库）。 |
| 到时必做 | Play Console：建应用、隐私政策 URL、数据安全表单（要说明定位权限只用于部分 ROM 的 BLE 扫描）、内容分级、商店素材（512×512 图标、feature graphic、截图）。 |
| 风险 | 华为 SPP 在 Android 上还没真机验证（README 里就写着）。上架前至少要在一台真实 Android 手机上连一次 FreeClip。 |

## 三端共同

| 状态 | 事项 |
| --- | --- |
| 已知风险 | App 名叫 **Bose Connector**，界面上还有 Bose / HUAWEI 词标。App Store 审核指南 5.2.1 管第三方商标；用别人的品牌做 App 名有被拒风险。当前决定先不改名，被拒再说。 |
| 必做 | App Store Connect 的「App 隐私」选「不收集数据」，要和 `PrivacyInfo.xcprivacy` 一致。 |
| 必做 | 硬件配套 App 的审核备注和演示视频（Bose 连接、改降噪）。iPhone 和 Mac 商店版都只做 Bose。 |
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

# macOS 商店版：签名、沙盒、页面能不能在沙盒里起来
xcodebuild -project macos/BoseControl.xcodeproj -scheme BoseControl-AppStore \
  -configuration AppStore -destination 'platform=macOS' \
  -derivedDataPath /tmp/bose-macos -allowProvisioningUpdates build
codesign -d --entitlements :- \
  /tmp/bose-macos/Build/Products/AppStore/BoseControl.app
```

商店版跑起来后，诊断日志在
`~/Library/Containers/cain.com.bosecontrol.mac/Data/Library/Application Support/BoseControl/Diagnostics/logs`。
里面应能看到 `platform={"platform":"macos","transports":["ble"],"hub":true}`，
以及华为设备被记成 `transport-unavailable`。
