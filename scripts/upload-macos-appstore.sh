#!/bin/sh
# 归档 Mac App Store 版并上传到 App Store Connect。
# 前提：App Store Connect 里已有 cain.com.bosecontrol.mac 的 App 记录；
# 没有记录时 exportArchive 会报 "App record ... not found"。
set -eu
cd "$(dirname "$0")/.."

xcodebuild -project macos/BoseControl.xcodeproj -scheme BoseControl-AppStore \
  -configuration AppStore -destination 'generic/platform=macOS' \
  -archivePath build/BoseControl.xcarchive -allowProvisioningUpdates archive

xcodebuild -exportArchive -archivePath build/BoseControl.xcarchive \
  -exportPath build/export -exportOptionsPlist macos/ExportOptions-AppStore.plist \
  -allowProvisioningUpdates
