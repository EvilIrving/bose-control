// macOS 端 BLE 枚举小工具：回答「这副耳机到底暴露了哪些 GATT 服务」。
//
// 为什么需要它：iPhone 上只有 CoreBluetooth（GATT / L2CAP CoC）和 MFi 的
// ExternalAccessory 三条通道给第三方。判断某副耳机能不能在 iPhone 上控，
// 第一步是看它在 GATT 上有没有成对的写 / notify 特征值。macOS 和 iOS 用的是
// 同一套 CoreBluetooth，所以这里看得到的东西，iPhone 上大概率也看得到。
//
// 编译（命令行工具需要把 Info.plist 塞进二进制，否则 CoreBluetooth 拿不到权限）：
//   plist=$(mktemp -t bledump).plist
//   printf '%s' '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>cain.com.bosecontrol.bledump</string><key>CFBundleName</key><string>ble-dump</string><key>NSBluetoothAlwaysUsageDescription</key><string>枚举耳机暴露的 GATT 服务</string></dict></plist>' > "$plist"
//   swiftc -swift-version 5 tools/ble-dump.swift -o tools/ble-dump \
//     -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$plist"
//
// 用法：
//   tools/ble-dump                             扫 8 秒，列设备（名字 / RSSI / 广播服务 / 厂商数据）
//   tools/ble-dump --name freeclip             连第一台名字含 freeclip 的，dump 服务 / 特征值 / 描述符
//   tools/ble-dump --name xm4 --watch 60       订阅所有 notify 特征值，打印 60 秒收到的原始字节
//   tools/ble-dump --name xm4 --write UUID=5a0000   连上后往该特征值写一串十六进制
// 退出码：没连上或没匹配到设备 = 1，方便脚本里判断。

import CoreBluetooth
import Foundation

let opts = CommandLine.arguments.dropFirst()
func value(_ flag: String) -> String? {
    guard let i = opts.firstIndex(of: flag) else { return nil }
    let next = opts.index(after: i)
    return next < opts.endIndex ? opts[next] : nil
}
let nameFilter = value("--name")?.lowercased()
let scanSeconds = Double(value("--secs") ?? "") ?? 8
let watchSeconds = Double(value("--watch") ?? "") ?? 0
let writeSpec = value("--write")

func hex(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
}

func stamp() -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.string(from: Date())
}

let propertyNames: [(CBCharacteristicProperties, String)] = [
    (.broadcast, "broadcast"), (.read, "read"), (.writeWithoutResponse, "write-no-resp"),
    (.write, "write"), (.notify, "notify"), (.indicate, "indicate"),
    (.authenticatedSignedWrites, "signed-write"), (.extendedProperties, "extended"),
    (.notifyEncryptionRequired, "notify-enc"), (.indicateEncryptionRequired, "indicate-enc"),
]

func props(_ p: CBCharacteristicProperties) -> String {
    let on = propertyNames.filter { p.contains($0.0) }.map(\.1)
    return on.isEmpty ? "none" : on.joined(separator: "|")
}

final class Dumper: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    var central: CBCentralManager!
    var seen: [UUID: (CBPeripheral, String, Int)] = [:]
    var target: CBPeripheral?
    var done = false
    var connected = false

    func start() {
        central = CBCentralManager(delegate: self, queue: nil)
    }

    func finish(_ code: Int32) -> Never {
        if !done {
            done = true
            if let p = target, p.state != .disconnected { central.cancelPeripheralConnection(p) }
            central.stopScan()
            print("[\(stamp())] 结束（exit \(code)）")
        }
        exit(code)
    }

    func centralManagerDidUpdateState(_ c: CBCentralManager) {
        switch c.state {
        case .poweredOn:
            print("[\(stamp())] 蓝牙就绪，开始扫描 \(scanSeconds)s\(nameFilter.map { "，找名字含 “\($0)”" } ?? "")")
            c.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
            DispatchQueue.main.asyncAfter(deadline: .now() + scanSeconds) { self.scanDone() }
        case .unauthorized:
            print("蓝牙权限被拒（系统设置 → 隐私与安全性 → 蓝牙，给终端或本工具授权）；TCC 拒绝时 CoreBluetooth 不会返回任何设备")
            finish(1)
        case .poweredOff, .unsupported:
            print("蓝牙不可用：\(c.state.rawValue)")
            finish(1)
        default:
            break
        }
    }

    func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? p.name ?? ""
        // 同一台设备会反复上报，这里只保留第一次，避免刷屏
        let first = seen[p.identifier] == nil
        seen[p.identifier] = (p, name, RSSI.intValue)
        guard first else { return }
        let services = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID])?.map(\.uuidString) ?? []
        var line = "[\(stamp())] \(name.isEmpty ? "(无名)" : name) rssi=\(RSSI) id=\(p.identifier.uuidString)"
        if !services.isEmpty { line += " 广播服务=\(services.joined(separator: ","))" }
        if let mfg = advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data {
            line += " 厂商数据=\(hex(mfg))"
        }
        print(line)
    }

    func scanDone() {
        central.stopScan()
        guard let filter = nameFilter else {
            print("[\(stamp())] 扫描结束，看到 \(seen.count) 台设备。加 --name <子串> 连其中一台看服务")
            finish(0)
        }
        // 先用广播里的名字匹配；没匹配到再退回已缓存的外设名字（有些设备只在 GATT 里带名字）
        let hit = seen.values.first { $0.1.lowercased().contains(filter) }
            ?? seen.values.first { $0.0.name?.lowercased().contains(filter) == true }
        guard let hit else {
            print("[\(stamp())] 没找到名字含 “\(filter)” 的设备，共看到 \(seen.count) 台")
            finish(1)
        }
        target = hit.0
        hit.0.delegate = self
        print("[\(stamp())] 连接 \(hit.0.name ?? hit.1) …")
        central.connect(hit.0, options: nil)
    }

    func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) {
        connected = true
        print("[\(stamp())] 已连接，发现全部服务（GATT 缓存需要几秒）")
        p.discoverServices(nil)
    }

    func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        print("连接失败：\(error?.localizedDescription ?? "-")")
        finish(1)
    }

    func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        print("[\(stamp())] 已断开：\(error?.localizedDescription ?? "无错误")")
        if !done { finish(connected ? 0 : 1) }
    }

    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        if let error { print("发现服务失败：\(error.localizedDescription)") }
        let services = p.services ?? []
        print("[\(stamp())] 服务 \(services.count) 个")
        for s in services {
            print("  服务 \(s.uuid.uuidString)\(s.isPrimary ? "" : " (secondary)")")
            p.discoverCharacteristics(nil, for: s)
        }
        if services.isEmpty { finish(0) }
    }

    func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
        if let error { print("  特征值发现失败 \(s.uuid.uuidString)：\(error.localizedDescription)") }
        for ch in s.characteristics ?? [] {
            print("    特征值 \(ch.uuid.uuidString) [\(props(ch.properties))]")
            p.discoverDescriptors(for: ch)
            if ch.properties.contains(.notify) || ch.properties.contains(.indicate) {
                p.setNotifyValue(true, for: ch)
            }
            if let spec = writeSpec, let eq = spec.firstIndex(of: "=") {
                let uuid = String(spec[spec.startIndex..<eq]).lowercased()
                let bytes = String(spec[spec.index(after: eq)...])
                if ch.uuid.uuidString.lowercased().contains(uuid) {
                    let type: CBCharacteristicWriteType = ch.properties.contains(.write) ? .withResponse : .withoutResponse
                    let data = stride(from: 0, to: bytes.count, by: 2).compactMap { i -> UInt8? in
                        let start = bytes.index(bytes.startIndex, offsetBy: i)
                        let end = bytes.index(start, offsetBy: 2, limitedBy: bytes.endIndex) ?? bytes.endIndex
                        return UInt8(bytes[start..<end], radix: 16)
                    }
                    print("    写入 \(Data(data).map { String(format: "%02x", $0) }.joined()) 到 \(ch.uuid.uuidString)")
                    p.writeValue(Data(data), for: ch, type: type)
                }
            }
        }
        if watchSeconds > 0 {
            DispatchQueue.main.asyncAfter(deadline: .now() + watchSeconds) {
                print("[\(stamp())] 观察窗口结束")
                self.finish(0)
            }
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.finish(0) }
        }
    }

    func peripheral(_ p: CBPeripheral, didDiscoverDescriptorsFor ch: CBCharacteristic, error: Error?) {
        for d in ch.descriptors ?? [] {
            let value = (d.value as? Data).map { hex($0) } ?? "-"
            print("      描述符 \(d.uuid.uuidString) = \(value)")
        }
    }

    func peripheral(_ p: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
        guard let data = ch.value else { return }
        print("[\(stamp())] ← \(ch.uuid.uuidString) \(data.count)B \(hex(data))")
    }

    func peripheral(_ p: CBPeripheral, didWriteValueFor ch: CBCharacteristic, error: Error?) {
        if let error { print("    写入失败 \(ch.uuid.uuidString)：\(error.localizedDescription)") }
    }
}

let dumper = Dumper()
dumper.start()
DispatchQueue.main.asyncAfter(deadline: .now() + scanSeconds + watchSeconds + 25) {
    print("超时退出")
    dumper.finish(1)
}
RunLoop.main.run()
