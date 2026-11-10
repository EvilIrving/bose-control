# Bose Connector

[![android](https://github.com/EvilIrving/bose-control/actions/workflows/android.yml/badge.svg)](https://github.com/EvilIrving/bose-control/actions/workflows/android.yml) [![apple](https://github.com/EvilIrving/bose-control/actions/workflows/apple.yml/badge.svg)](https://github.com/EvilIrving/bose-control/actions/workflows/apple.yml)

[English](README_en.md) · [简体中文](README.md)

Direct Bluetooth control for Bose and HUAWEI headphones and earbuds. No accounts, no cloud, no telemetry.

Official companion apps require account registration, cloud services, and location permissions. Bose Connector does one thing: connects your phone or computer directly to your headset over Bluetooth. Bose uses the proprietary BMAP protocol, and HUAWEI uses the Bluetooth Serial Port Profile (SPP). All data stays local on your device.

- **Web Version**: Web Bluetooth in Chrome / Edge — open and connect to Bose directly
- **Native Apps**: macOS (BLE + RFCOMM), Android (BLE + RFCOMM), iOS (BLE)
- **Device Center**: On macOS and Android, the home screen lists all paired headsets from system Bluetooth — click to connect (also available in browser when served via `server.py`)
- **Capability-Based Rendering**: If a feature is not supported by the headset firmware, its panel is hidden completely — no empty controls

After modifying `web/`, run `scripts/sync-web.sh` before building native apps (Android, iOS, and macOS share the identical web assets).

## User Interface

Three screens; only the active screen is visible and interactive:

| Screen | Contents | Navigation |
| --- | --- | --- |
| Device Center (Home) | Paired headsets, one card per device, three lines: device name (single line, no wrap, truncated with ellipsis if too long), brand wordmark + status dot (green = connected, gray = disconnected), battery level (only shown when actually read). Connected devices appear first; sorted naturally by name within groups | Shown at launch; list refreshes automatically without a manual refresh button |
| Device Screen | Header features a clickable name dropdown listing paired headsets (current device checked; select another to switch directly), battery level next to name, followed by feature control panels | Click device card to enter; back button in top right, or press `Esc` |
| Settings Screen | Language, brand-specific settings (HUAWEI includes "Paired Devices", Bose does not), hardware info (product name / variant / firmware / serial numbers / Bluetooth MAC / hardware revision), headset actions, diagnostics | Enter via "Settings" at bottom of device screen; exit via "Done" in top right |

- Device cards display official brand wordmarks (Bose / HUAWEI) instead of plain brand text; see "Brand Attribution" for sources and trademarks. Earbud artwork is intentionally omitted.
- Battery levels reflect reported components only (never padded with 0%): three-segment display shows `Left 96% · Right 100% · Case 59%` (`L / R / Case`), or `60%` if only one component reports. Placed beside name on device screen, and at bottom of device cards in Device Center.
- Navigating back **does not disconnect**: returning to Device Center keeps the session alive and the card highlighted; clicking it returns to controls immediately without reconnecting.
- Status dot: Green = connected (active app session or alive system link), Gray = disconnected. Text status "Connected / Disconnected" is kept in `title` / `aria-label` for screen readers.
- To actually disconnect: Settings → Headset Actions → "Disconnect", or select "Disconnect" in the top-bar dropdown.
- On platforms without Device Center (iOS, standalone static web), the header dropdown lists only the current device plus "Disconnect".
- Device Center has no refresh button: it queries on launch, on returning from device screen, and on window focus; polls lightly every 5 seconds while idle on the screen. The UI does not re-render if the payload hasn't changed.
- Brand selector chips appear on hosts supporting both BLE and SPP (macOS, Android, web via `server.py`); they yield to the device list once paired devices exist. iPhone lacks SPP, so brand chips are hidden there (see below: "Managing HUAWEI Earbuds on iPhone").
- Device Center only appears on hosts capable of enumerating system-paired devices (macOS, Android, web via `server.py`). iOS and static web display a single "Connect" button.

## Brand Attribution

Wordmarks on Device Center cards are inlined as SVG in `web/logos.js`, preserving original proportions with fill set to `currentColor` to match surrounding text on dark backgrounds. Bose and HUAWEI are trademarks of their respective owners, used solely for device identification.

| Brand | Source | License / Attribution |
| --- | --- | --- |
| Bose | `logo.svg` from bose.com header; [Wikimedia Commons "Bose logo.svg"](https://commons.wikimedia.org/wiki/File:Bose_logo.svg) | Public domain |
| HUAWEI | Wikimedia Commons ["Huawei wordmark 2019.svg"](https://commons.wikimedia.org/wiki/File:Huawei_wordmark_2019.svg) | Public domain |

## Desktop Chrome / Edge

```bash
python3 server.py
```

Open the printed URL `https://127.0.0.1:8443/`.

This setup includes a local serial bridge: browsers do not support SPP natively, so `server.py` spawns `tools/bt-bridge` to handle RFCOMM, while the web page communicates over WebSocket. **This enables HUAWEI earbud control in the browser** when served by `server.py` (indicated by a successful `/api/devices` response). Without running `server.py`, only Bose via Web Bluetooth is available.

Bridge protocol: `GET /api/devices` returns paired devices; `wss://<port>/bt` sends `{open|send|close}` and receives `{ok|data|error}`.

## iOS

Project: `ios/BoseControl.xcodeproj`. WKWebView loads embedded `Web/`, CoreBluetooth connects to FEBE service.

Runs on iPhone and iPad (all 4 orientations supported). `Info.plist` includes `NSBluetoothAlwaysUsageDescription`. Install to a physical device with an Apple Developer account. App Store review classification: hardware companion tool (mention model numbers and attach a screen recording showing connection and noise cancellation adjustments).

HUAWEI earbuds are not supported on iOS because the OS does not expose classic Bluetooth SPP / RFCOMM to third-party apps. See "Managing HUAWEI Earbuds on iPhone" below.

### Installation Options on iOS

| Method | User Effort | Cost |
| --- | --- | --- |
| **TestFlight** (Recommended) | Tap invite link to install directly without a Mac | Requires Apple Developer account; CI configured |
| Self-sign with Xcode | Open in Xcode, sign with personal Apple ID, **re-sign every 7 days** | Free |
| App Store | Search and install | Requires App Store approval |

**Automated TestFlight Deployment**: `.github/workflows/testflight.yml` triggers on `v*` tags or manual dispatch. Repository secrets required (generated under App Store Connect → Users and Access → Integrations → Team Keys):

| Secret | Description |
| --- | --- |
| `ASC_KEY_ID` | API Key ID |
| `ASC_ISSUER_ID` | Issuer ID |
| `ASC_KEY` | Full content of `.p8` key file |

Prerequisite: App record created in App Store Connect matching Bundle ID (`cain.com.bosecontrol`, Team `QZZ878S3NS`). Build number uses CI run number; marketing version matches project version.

**Self-Signing**: Open `ios/BoseControl.xcodeproj` in Xcode → select personal Team under Signing & Capabilities (change Bundle ID) → connect iPhone and Run. Free accounts expire after 7 days; paid developer accounts last 1 year.

```bash
xcodebuild -project ios/BoseControl.xcodeproj -target BoseControl -sdk iphoneos
```

## macOS

Project: `macos/BoseControl.xcodeproj`. WKWebView loads embedded `Web/`.

Two build schemes:

- `BoseControl`: Direct installation, App Sandbox disabled, supports both Bose BLE and classic Bluetooth RFCOMM (HUAWEI).
- `BoseControl-AppStore`: Mac App Store build with App Sandbox enabled; retains Bose BLE only. Classic SPP is not guaranteed under sandbox restrictions, so HUAWEI devices are excluded; diagnostics are saved to `~/Downloads`, and WKWebView requires `network.client` entitlements.

Launches directly into Device Center: `IOBluetoothDevice.pairedDevices()` filters devices matching Bose / HUAWEI naming patterns, sorted by "connected first, then naturally by name", and passes them to the web view. Clicking a device connects immediately:

- **Bose**: Clicking a paired device attempts RFCOMM first without waiting for BLE scan timeouts. If RFCOMM fails, it falls back to BLE FEBE matching the target name (allowing for `LE-` prefix differences). Unspecified devices default to BLE. RFCOMM only tries known control services and candidate ports, avoiding standard audio endpoints.
- **HUAWEI**: Opens classic SPP directly. Ports are resolved from SDP by service name (`Serial Port` / `Private COM`), falling back to channels 1 / 2 / 3. Handsfree / A2DP RFCOMM channels are strictly avoided to prevent audio disruption.

```bash
xcodebuild -project macos/BoseControl.xcodeproj -scheme BoseControl -configuration Release -destination 'platform=macOS' -derivedDataPath macos/build
```

Output: `macos/build/Build/Products/Release/BoseControl.app`. Requires Bluetooth permission on first launch.

Brand selection is persisted in `UserDefaults` (custom scheme `localStorage` is session-scoped), ensuring consistent behavior across launches.

## Android (Open-Source Releases)

Directory: `android/`. Uses `WebViewAssetLoader` to serve `assets/www/`. Launches into Device Center listing `bondedDevices`, connecting upon tap.

- **Bose**: Checks for existing GATT connection on tap; otherwise attempts RFCOMM (`00000000-deca-fade-deca-deafdecacaff`) directly before falling back to target GATT. Scans only when no specific device is chosen.
- **HUAWEI**: Passes target address, connecting via standard SPP UUID or ports 1 / 2 / 3.

List sorting: Connected first, followed by natural alphanumeric sort (case-insensitive, numeric value ordering).

Permissions: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT` (Android 12+). Release builds enable `minifyEnabled` and `shrinkResources`.

If local Android SDK is not installed, open `android/` in Android Studio to build Release APK.

Alternatively, GitHub Actions builds a debug APK on every push: download from workflow run Artifacts, or download release APKs attached to `v*` tags.

### Connection Debugging on Android

```bash
adb logcat -s BOSE
```

Logs detail each step: `gatt connected` → `mtu=517` → `cccd write status=0` → data streaming begins. A `fail xxx` entry indicates where connection stalled, matching error codes in `web/link.js`.

Critical implementation details:

- **CCCD write is mandatory** (`00002902-…`): Calling `setCharacteristicNotification` only enables local OS notification forwarding; the headphones will not stream data until the CCCD descriptor is written.
- **Request MTU 517 before reading**: Default MTU 23 truncates 48-byte ModeConfig replies.
- **API 33+ callbacks**: Use `onCharacteristicChanged(gatt, ch, value)` / `writeCharacteristic(ch, bytes, type)`; deprecated interfaces fail to receive data on newer Android versions.
- If headphones are currently streaming music, BLE advertising may be suppressed; the app falls back to paired devices via RFCOMM.

### Android OEM Quirks

- **Location Permissions**: vivo official support requires location permissions and system location services enabled for BLE scanning. On Android 12+, location permission is requested for vivo, OPPO, realme, OnePlus, Xiaomi, Redmi, Huawei, Honor, and Meizu. If scanning fails while system location is off, the UI prompts "Location services required".
- **Empty Permission Result Maps**: Certain ROMs return empty result maps in `RequestMultiplePermissions`, where `values.all{}` evaluates to true on empty collections, falsely indicating granted permission. Checked individually by permission string instead.
- **Cold-Start Dialogs**: Launching permission requests before Activity reaches `RESUMED` may be dropped by the OS; requests are queued and triggered in `onResume`.
- **Outdated WebViews**: Many Android devices carry outdated System WebViews without Google Play update channels. The web entry script detects `<script type="module">` support and displays an upgrade warning instead of freezing.

## Transport Matrix

| Platform | Bose (BLE GATT) | Bose (RFCOMM) | HUAWEI (SPP) |
| --- | --- | --- | --- |
| Chrome / Edge | Supported | Not supported | Supported via `server.py` |
| iOS App | Supported | Not supported (OS limitation) | Not supported (OS limitation) |
| macOS App | Supported | Supported | Supported |
| Android App | Supported | Supported | Supported |

## Bose (BMAP)

Daily controls reside on the home screen; one-time configurations live in Settings.

| Home Screen | Settings Screen |
| --- | --- |
| Modes (create and edit custom modes) | Language |
| Noise Cancellation | Headset Name |
| EQ | Shortcut Action |
| Immersive Audio | Button Cycle |
| Sidetone | Voice Prompts |
| More: Wind Block / Multipoint / Conversation Mode | Touch Control / Auto-Answer Calls / Auto Play/Pause |
| Playback Controls: Previous / Play / Pause / Next | Auto-Off |
| | Headset Actions: Pairing Mode / Power Off / Disconnect |

### Custom Modes

Official apps require cloud logins to create custom modes; Bose Connector writes directly to the headset firmware offline.

- Headset reports available mode slots (`0x1f/0x07`); empty slots appear as a "+" icon at the end of the modes row (screen-reader label "New Mode").
- Editor configures mode name, noise cancellation level, immersive audio, and wind block. Toggling "In Button Cycle" writes to `0x1f/0x08` so physical hardware buttons cycle through it.
- Saving sends 40-byte payload via `0x1f/0x06`: slot index, prompt ID, 32-byte name, noise cancelling level, auto-cancellation, immersive audio, wind block, and ANC flags. Switched immediately via `0x1f/0x03`. Deletion uses `0x1f/0x09`.
- Names are UTF-8 encoded up to 32 bytes; truncated at clean character boundaries without splitting multi-byte sequences.
- Tapping an active editable custom mode opens its editor.

### Shortcut Actions

`0x01/0x09` reads supported action bitmasks (voice assistant, switch device, previous track, mode cycle, immersive audio, etc.). Selecting an action writes it back. "Long press" terminology derives from headset-reported button event types. Requires pressing the physical multi-function button once after configuration to activate.

Button cycle configuration (`0x1f/0x08`) is managed in Settings → Button Cycle.

### Spatial Calibration

`0x05/0x11` is **read-only**, returning raw sensor attitude data. Writing back requires proprietary cloud-based CustomTune algorithms. Writing invalid parameters causes permanent spatial audio offset, requiring recalibration in the official app.

## HUAWEI Earbuds

Supported on macOS, Android, and web via `server.py`. Device Center lists paired HUAWEI headsets (matching `HUAWEI`, `FreeBuds`, `FreeClip`, `FreeLace`, `Honor`). Clicking an entry connects directly, and the header dropdown allows instant switching between headsets.

| Host | Support Status |
| --- | --- |
| macOS App | Supported over classic Bluetooth SPP (RFCOMM) |
| Android App | Supported over SPP |
| Chrome / Edge | Supported when served via `server.py` (local serial bridge); not supported on static pages |
| iOS App | Not supported (iOS does not allow third-party classic SPP) |

### Managing HUAWEI Earbuds on iPhone

Bose Connector on iOS operates exclusively in single-brand Bose mode without a HUAWEI option. This is an OS boundary: HUAWEI control requires classic Bluetooth SPP / RFCOMM, whereas iOS CoreBluetooth only exposes BLE / GATT. Classic Bluetooth data channels are restricted to Apple MFi-certified accessories (ExternalAccessory), which HUAWEI earbuds are not.

Workarounds:
- Use HUAWEI AI Life (available on App Store for iOS 13+).
- Configure settings once on a Mac with Bose Connector: settings persist in earbud hardware, after which iPhone can be used normally for playback.

Verified model: HUAWEI FreeClip 2 (firmware HarmonyOS 6.0.0.256 and 7.0.0.516, model BTFT0027). Other FreeBuds / FreeClip models use compatible command sets and adapt automatically based on capability replies.

| Home Screen | Settings Screen |
| --- | --- |
| Sound Effects (EQ Presets) | Language |
| Low Latency | Gestures: Double Tap / Triple Tap / Long Press / Swipe |
| Pause When Removed | Voice Prompts Language |
| | Audio Quality Preference (Connection Priority / Sound Quality Priority) |
| | Paired Devices |
| | Headset Actions: Disconnect |
| | Diagnostics (Model, dual-bud serial numbers, dual-connection status) |

### Paired Devices

Settings → "Paired Devices" lists **devices remembered by the earbuds themselves** (e.g. Mac, phones), not devices paired to your computer.

- Displays name and status: Connected / —.
- **Connect / Disconnect**: Command `2b33` with action type (1 connect, 2 disconnect, 4 enable auto-connect, 5 disable auto-connect) and target MAC.
- **Auto-Connect**: Types 4 / 5.
- **Preferred Device**: Command `2b32` sets default device.
- Earbuds push notifications via `2b36` on link changes, auto-refreshing the list.

### Intentionally Excluded Features

- **Noise Cancellation**: Rendered only when earbuds report ANC capability (`2b2a` bitmap bit 1). FreeClip 2 replies with normal/transparency only; as an open-ear design, reference implementations (OpenFreebuds) also exclude ANC controls for this model.
- **Dual Connection Master Switch**: Command `2b2e` replies success on write but always returns enabled on read; firmware rejects writes, so it is presented as read-only status.
- **Rename / Power Off / Playback Controls / Custom EQ**: Commands are not available in the SPP specification for these earbuds.

### Transport Details

Frame structure in `web/spp.js`: `5a | length (2B big-endian) | 00 | command (2B) | [type 1B][length 1B][value]... | CRC16 (XMODEM)`. Packet length counts from `00`; total frame length = length + 5. CRC uses polynomial 0x1021.

Test vectors in `tests/spp.test.mjs` are captured directly from FreeClip 2 hardware runs.

Commands reference [OpenFreebuds](https://github.com/melianmiko/OpenFreebuds) Python SPP drivers. Consecutive read commands maintain a 90ms inter-packet delay to prevent firmware buffer stalls.

## Adding a Brand

Neither the host nor native bridges contain hardcoded brand logic. Adding a new brand (e.g., Samsung) touches only two locations:

1. Create `web/<brand>.js` exporting a brand descriptor:

```js
export const huaweiBrand = {
  id: "huawei",
  label: "HUAWEI",
  transport: "spp",        // "ble" for GATT, "spp" for classic serial
  channels: [1, 2, 3],     // Fallback RFCOMM channels
  services: [],            // Optional: UUIDs for SDP resolution
  matches: (name) => /huawei|freebuds/i.test(name),
  codec: createHuaweiCodec,  // { reset, chunks, parse, key, header }
  create: (ctx) => new HuaweiHeadset(ctx),
};
```

2. Register the descriptor in `web/brands.js`.

`create(ctx)` receives `{ link, ui, state, refresh, log }` and implements:

| Hook | Purpose |
| --- | --- |
| `load()` | Reads device state upon connection into session-isolated `state`; returns boolean indicating whether data was received |
| `ready()` (Optional) | Returns true once essential controls are parsed; host checks during `refresh()` without waiting for full `load()` |
| `render()` | Renders home panels (capability-driven) |
| `renderSettings()` | Renders brand-specific settings |
| `onPacket(packet)` | Handles unsolicited status pushes (battery, modes, connection events) |

Every connection uses an independent `HeadsetLink` and brand state. The brand receives an isolated `scope()`, preventing stale background jobs from writing to newer connections. Native bridges maintain a single active session token.

Native bridges (`macos/BoseControl`, `android/`, `tools/bt-bridge`) operate purely as neutral data conduits: they enumerate system-paired devices and handle byte I/O according to the requested `transport`, `address`, `channels`, and `services`.

## Hardware Compatibility

Controls are capability-driven rather than hardcoded by model: each feature sends a separate query on connection. Panels render only upon valid replies and remain hidden (along with headers) if unanswered. This allows a unified codebase to support diverse hardware including QC Ultra, QC45, NC700, and earbuds.

BMAP (Bose) and SPP (HUAWEI) share this capability-driven architecture.

### Model Variations

Differences in firmware offsets and supported commands are consolidated in `web/profiles.js`. On connection, `0x00/0x03` queries product ID; unrecognized devices fall back to `DEFAULT` profiles.

| Model | Product ID | Noise Cancellation | Mode Config | Notes |
| --- | --- | --- | --- | --- |
| QC Ultra 2 HP / QC 2 HP / QC Ultra | `4082` `4083` `4066` | `0x1f/0x0a` direct | 48-byte reply, 40-byte write | Verified on hardware; wind at byte `[45]` |
| QC Ultra 2 Earbuds / QC Earbuds II | `4062` `4072` `4064` | `0x1f/0x0a` | 48-byte reply, 40-byte write | Three-segment battery by component ID: `01` Right, `02` Left, `03` Case |
| QC Headphones / QC 45 | `4075` `4039` | `0x01/0x05` | 47-byte reply, 39-byte write | No ANC flags; initial `0x00/0x01` handshake |
| QC 35 / 35 II | `400c` `4020` | `0x01/0x06` ANR 4-step | None | High / Low / Off / Wind; initial `0x00/0x01`; no EQ, multipoint, or autoplay |
| QC Earbuds (1st Gen) | `402f` | `0x01/0x05` direct | 44-byte read-only | ModeConfig unwritable; 4 fixed modes |
| Ultra Open Earbuds | `4068` | None (open-ear) | 48-byte read-only | EQ and multipoint supported; modes fixed |

- **Three distinct noise cancellation routes**: `0x1f/0x0a` 5-byte SETGET (immediate effect with spatial/wind/auto ANC), `0x01/0x05` 2-byte continuous steps, or `0x01/0x06` 4-step ANR enum (QC35).
- **Missing fields return `null` rather than false/0**: Prevents overwriting unsupported fields during full-payload updates.
- If no BMAP replies are received after connection (e.g. connecting to unsupported third-party hardware), the app disconnects cleanly with "Device not supported" rather than remaining on a blank screen.
- Diagnostics exports include a complete capability probe report detailing raw TX/RX hex dumps, response verdicts (ok, error, timeout, skipped), and inferred capabilities.

Connection error strings are standardized in `web/link.js` (max 10 Chinese characters / compact English to prevent wrapping on narrow screens).

Verified hardware: Bose QuietComfort Ultra Headphones (2nd Gen), HUAWEI FreeClip 2. QC35, QC45, QC Earbuds, and Ultra Open definitions are cross-referenced from validated implementations.
