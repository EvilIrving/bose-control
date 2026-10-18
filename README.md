# Bose 本地控制

系统蓝牙已经连上耳机，只能播歌。官方 Bose App 还要再开一条 BMAP 控制通道，并且要登录美国云（`id.api.bose.io`、Gigya）。本页只走手机蓝牙 GATT，不登录。

能调：模式（安静 / 通透 / 沉浸，以及耳机里自定义的名字）、降噪强度、均衡（低音 / 人声 / 高音）、通话侧音。

## 用法

电脑上：

```bash
cd /Users/actor/Documents/code/02-local/js-bose-control
python3 server.py
```

手机和电脑同一 Wi-Fi。用 **Android Chrome** 打开终端里打印的 `https://<局域网IP>:8443/`。证书是自签的，Chrome 会警告，点高级后继续访问。点「连接 Bose」，在系统弹窗里选耳机。

iPhone 的 Safari 没有 Web Bluetooth。可装 [Bluefy](https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055) 打开同一地址。

## 限制

- 只支持带 BLE BMAP 的型号（QC Ultra、Ultra Open 等）。更老的 QC35 走 RFCOMM，浏览器控不了，可用 [bosectl](https://github.com/aaronsb/bosectl)。
- 音频仍由系统蓝牙负责。这里断开控制不会把歌停掉。
