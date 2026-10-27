# App Store 文案与审核备注

直接复制到 App Store Connect。商店版只支持 Bose，华为不在这份文案里出现。

## 名称与副标题

| 字段 | 中文（zh-Hans） | English (U.S.) |
| --- | --- | --- |
| Name | Bose Connector | Bose Connector |
| Subtitle | 离线控制 Bose 耳机 | Control Bose headphones offline |

## 描述

**中文**

不登录、不联网，用蓝牙直接控制 Bose 耳机。官方 App 要账号、要云；这里只做一件事：Mac 直连耳机，数据不出本机。

- 模式：降噪、通透、自定义模式，机身上的模式键也能切
- 音效：均衡器、沉浸式音频、风噪滤除
- 通话与连接：多点连接、对话模式、自动接听、自动播放暂停
- 耳机：电量、设备信息、语音提示、自动关机、快捷动作
- 设置直接写进耳机，换一台设备继续用

需要先在这台 Mac 的系统设置里配好 Bose 耳机。App 不会上传任何数据，也没有账号。

Bose 是 Bose Corporation 的商标。本 App 与 Bose Corporation 没有隶属或背书关系。

**English**

Control Bose headphones over Bluetooth. No account, no cloud, no telemetry — the app talks to the headphones directly and keeps everything on your Mac.

- Modes: noise cancelling, transparency, custom modes, and the on-headset mode button
- Sound: equalizer, immersive audio, wind noise reduction
- Calls and connections: multipoint, conversation mode, auto-answer, auto-pause
- Headset: battery, device information, voice prompts, auto-off, shortcut action
- Settings are written to the headphones, so they follow the device

Pair your Bose headphones with this Mac first. The app uploads nothing and has no account.

Bose is a trademark of Bose Corporation. This app is not affiliated with or endorsed by Bose Corporation.

## 关键词

`Bose,headphones,noise cancelling,ANC,EQ,Bluetooth,offline,QuietComfort,降噪,耳机`

（100 字符以内，App Store Connect 按英文逗号分隔。）

## 分类与分级

| 字段 | 值 |
| --- | --- |
| 主分类 | 工具 / Utilities |
| 年龄分级 | 4+ |
| 价格 | 免费（按实际决定） |
| 隐私政策 URL | `https://github.com/EvilIrving/bose-control/blob/main/docs/privacy.md` |
| 支持 URL | `https://github.com/EvilIrving/bose-control/issues` |
| 营销 URL | `https://github.com/EvilIrving/bose-control` |

## App 隐私

选 **不收集数据 / Data Not Collected**。App 没有账号、分析、广告、崩溃上报，也不发网络请求；诊断日志只留在本机。

## 审核备注

**中文**

这是一个蓝牙耳机配套工具，不需要登录，也不联网。审核时需要一台已和 Mac / iPhone 配对的 Bose 耳机：

1. 打开 App，首页列出系统里已配对的 Bose 耳机。
2. 点耳机，等待连接完成，设备页会出现模式、降噪、均衡等面板。
3. 改动一项设置，耳机会立即生效。

商店版只支持 Bose。华为耳机的控制通道是经典蓝牙串口，Mac App Store 的沙盒不保证这条通道，所以商店版没有华为。App 不上传任何数据。演示视频随审核备注附上。

**English**

This is a companion app for Bluetooth headphones. There is no sign-in and no network access. Review needs a Bose headset already paired with the Mac / iPhone:

1. Open the app. The home screen lists Bose headphones paired with the system.
2. Select the headset and wait for the connection. The device page shows modes, noise cancelling, EQ, and other panels.
3. Change a setting; the headset applies it immediately.

The App Store build supports Bose only. HUAWEI earbuds use a classic Bluetooth serial channel, which the Mac App Store sandbox does not guarantee, so the store build omits them. The app uploads no data. A demo video is attached to these notes.

## 截图

| 平台 | 要求 | 状态 |
| --- | --- | --- |
| macOS | 2880×1800（或 1440×900 / 2560×1600 / 1280×800） | `store-assets/macos/01-devices-2880x1800.png` 已生成 |
| iPhone | 按 App Store Connect 当前要求，至少一张 6.9 英寸 | 需要真机 + 已连接的 Bose 耳机 |
| iPad | 按 App Store Connect 当前要求，至少一张 13 英寸 | 需要真机 + 已连接的 Bose 耳机 |

iPhone / iPad 截图要用真实连接的 Bose 控制页；模拟器没有蓝牙，截出来只有「不支持蓝牙」，不能作为商店素材。
