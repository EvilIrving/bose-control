---
title: Bose Connector - Offline Direct Bluetooth Headphone Control
lang: en
permalink: /en.html
description: Direct Bluetooth control for Bose and HUAWEI headphones. No accounts, no cloud, no tracking. Settings written to hardware.
---

<div class="hero">
  <div class="hero-badge">100% Offline · Direct Bluetooth · Zero Telemetry</div>
  <h1>Bose Connector</h1>
  <p class="hero-lead">Direct Bluetooth control for Bose and HUAWEI headphones and earbuds. No accounts, no cloud sync, no tracking. Noise cancellation, custom modes, EQ, and spatial audio are written directly to hardware.</p>
  <div class="hero-actions">
    <a href="https://github.com/EvilIrving/bose-control" class="btn btn-primary" target="_blank" rel="noopener">GitHub Repository</a>
    <a href="https://github.com/EvilIrving/bose-control/releases" class="btn btn-secondary" target="_blank" rel="noopener">Download Releases</a>
  </div>
</div>

<div class="features-grid">
  <div class="feature-card">
    <h3>🔒 Pure Offline Direct Link</h3>
    <p>Official companion apps require accounts, cloud logins, and location permissions. Bose Connector connects directly over Bluetooth: Bose via BMAP, HUAWEI via SPP. No telemetry, all data stays local.</p>
  </div>
  <div class="feature-card">
    <h3>🎛️ Hardware-Level Modes &amp; ANC</h3>
    <p>Create and edit custom modes without cloud services. Adjust noise cancelling levels, wind block, and immersive audio. Written directly to firmware and synced with hardware buttons.</p>
  </div>
  <div class="feature-card">
    <h3>🎵 Hardware EQ &amp; Audio Settings</h3>
    <p>Tune 3-band equalizer (Bass / Mid / Treble), switch between Still and Motion immersive audio, and manage multipoint connections, sidetone, shortcuts, and voice prompts.</p>
  </div>
  <div class="feature-card">
    <h3>⚡ Unified Device Center</h3>
    <p>Launches into Device Center on macOS and Android, listing all paired headphones from system Bluetooth. Read real battery levels per component (Left, Right, Case) with instant switching.</p>
  </div>
</div>

## Platform Support

A single, zero-build, highly responsive web core powers the desktop, mobile, and browser clients:

| Platform | Transports | Highlights |
| --- | --- | --- |
| **macOS** | BLE + Classic Bluetooth RFCOMM / SPP | Launches into Device Center; full Bose &amp; HUAWEI control (Direct build &amp; Mac App Store build) |
| **Android** | BLE + SPP | Launches into Device Center; fast paired device switching and component-level battery readout |
| **iOS / iPadOS** | BLE (CoreBluetooth) | Clean and lightweight; supports all Bose BLE models and custom modes (SPP unavailable due to iOS limits) |
| **Chrome / Edge** | Web Bluetooth / Local Serial Bridge | Open browser to connect Bose; run with local `server.py` to enable HUAWEI serial control |

## Hardware Compatibility

Controls are capability-driven: each feature queries the headset individually. Supported panels render upon reply, while unsupported ones remain completely hidden.

- **Bose** (BMAP Protocol):
  - QuietComfort Ultra Headphones / Ultra 2 HP / QC 2 HP
  - QuietComfort Ultra Earbuds / QC Earbuds II
  - QuietComfort Headphones / QC 45
  - QuietComfort 35 / 35 II
  - QC Earbuds (1st Gen), Ultra Open Earbuds, etc.
- **HUAWEI** (Classic Bluetooth SPP):
  - HUAWEI FreeClip 2 (Fully verified on HarmonyOS 6.0 / 7.0 hardware)
  - FreeBuds / FreeClip / FreeLace series using standard SPP commands

## Quickstart

### 1. macOS
Open `macos/BoseControl.xcodeproj` in Xcode to build, or download the release package from [Releases](https://github.com/EvilIrving/bose-control/releases). Pair your headphones in macOS System Settings first, then launch the app.

### 2. Android
Download the APK from [Releases](https://github.com/EvilIrving/bose-control/releases) or GitHub Actions Artifacts. Pair the headphones in Android Bluetooth settings, open the app, and select your headset.

### 3. Run in Desktop Browser
No complex toolchain needed. Clone the repo and run with Python 3:
```bash
git clone https://github.com/EvilIrving/bose-control.git
cd bose-control
python3 server.py
```
Open the printed URL `https://127.0.0.1:8443/` in Chrome or Edge to connect.

---

## Privacy &amp; Disclaimer

- **Zero Data Collection**: No remote servers, no user accounts, no analytics, no ads. Read the [Privacy Policy](privacy.html).
- **Trademarks**: Bose is a trademark of Bose Corporation. HUAWEI is a trademark of Huawei Technologies Co., Ltd. This project is an independent open-source tool and is not affiliated with or endorsed by them.
