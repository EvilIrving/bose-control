---
title: Bose Connector - 离线直连控制 Bose 与华为耳机
lang: zh-Hans
description: 不登录、不联网，用蓝牙直接控制 Bose 和华为耳机。设置写进耳机，数据不出本机。
---

<div class="hero">
  <div class="hero-badge">完全离线 · 直连控制 · 数据不出本机</div>
  <h1>Bose Connector</h1>
  <p class="hero-lead">不登录、不联网，用蓝牙直接控制 Bose 和华为耳机。无需注册账号，无需云端同步，不索取隐私权限。消噪、模式、EQ、空间音频，设置直接写进耳机固件。</p>
  <div class="hero-actions">
    <a href="https://github.com/EvilIrving/bose-control" class="btn btn-primary" target="_blank" rel="noopener">GitHub 仓库源码</a>
    <a href="https://github.com/EvilIrving/bose-control/releases" class="btn btn-secondary" target="_blank" rel="noopener">下载 Releases 安装包</a>
  </div>
</div>

<div class="features-grid">
  <div class="feature-card">
    <h3>🔒 纯离线直连</h3>
    <p>官方 App 要账号、要云、要定位权限。这里仅用蓝牙直连：Bose 走私有 BMAP 协议，华为走串口 SPP，所有通信与数据不出本机。</p>
  </div>
  <div class="feature-card">
    <h3>🎛️ 硬件级降噪与自定义模式</h3>
    <p>无需登录云端即可创建和编辑自定义模式，调整消噪等级、风噪滤除与沉浸空间音频。直接写进耳机固件，机身按键轮播即时生效。</p>
  </div>
  <div class="feature-card">
    <h3>🎵 硬件 EQ 与音频特性</h3>
    <p>调节低音/中音/高音三段均衡器，配置固定与运动沉浸式空间音频，管理多点连接、通话侧音、按键快捷动作与语音提示。</p>
  </div>
  <div class="feature-card">
    <h3>⚡ 统一设备中心</h3>
    <p>macOS 与 Android 上启动即进入设备中心，自动列出系统配对过的耳机。单机独立读取左右耳与充电盒真实电量，点选即连，无感切换。</p>
  </div>
</div>

## 平台支持

三端 App 与浏览器页面共用同一套无构建、极速响应的前端核心：

| 平台 | 通道支持 | 特性说明 |
| --- | --- | --- |
| **macOS** | BLE + 经典蓝牙 RFCOMM / SPP | 启动即进设备中心；Bose 与华为全功能支持（含直装版与 Mac App Store 版） |
| **Android** | BLE + SPP | 启动即进设备中心；支持已配对设备快速连选与细分组件电量读取 |
| **iOS / iPadOS** | BLE (CoreBluetooth) | 纯净轻量；支持 Bose 全系 BLE 控制与自定义模式管理（系统限制不开放第三方 SPP） |
| **Chrome / Edge** | Web Bluetooth / 本地串口桥 | 打开浏览器即可控制 Bose；配合本地 `server.py` 可同时接管华为串口 |

## 兼容机型

遵循「**按能力回包渲染，不按机型写死**」原则：每个功能连上后单独查询，耳机回包才画，没回包整块隐藏。

- **Bose**（BMAP 协议）：
  - QuietComfort Ultra Headphones / Ultra 2 HP / QC 2 HP
  - QuietComfort Ultra Earbuds / QC Earbuds II
  - QuietComfort Headphones / QC 45
  - QuietComfort 35 / 35 II
  - QC Earbuds（一代）、Ultra Open Earbuds 等
- **华为**（蓝牙串口 SPP）：
  - HUAWEI FreeClip 2（HarmonyOS 6.0 / 7.0 真机已完整验证）
  - FreeBuds / FreeClip / FreeLace 系列同协议机型

## 快速上手

### 1. macOS
打开工程 `macos/BoseControl.xcodeproj` 构建，或从 [Releases](https://github.com/EvilIrving/bose-control/releases) 下载直装版。在系统蓝牙配对耳机后打开 App 即可直接在设备中心使用。

### 2. Android
从 [Releases](https://github.com/EvilIrving/bose-control/releases) 下载最新 APK，或在 GitHub Actions Artifacts 中获取构建产物直接安装。在系统蓝牙配对后即可使用。

### 3. 电脑浏览器运行
无需安装编译环境，克隆仓库后使用系统内置 Python 启动：
```bash
git clone https://github.com/EvilIrving/bose-control.git
cd bose-control
python3 server.py
```
打开输出的 `https://127.0.0.1:8443/`，即可在 Chrome / Edge 中连接耳机。

---

## 隐私与免责声明

- **零数据收集**：本 App 不设服务器，无用户系统，无广告或统计埋点。详情参阅 [隐私政策](privacy.html)。
- **商标说明**：Bose 是 Bose Corporation 的商标；HUAWEI 是华为技术有限公司的商标。本项目为独立第三方开源工具，与上述公司无任何隶属、合作或背书关系。
