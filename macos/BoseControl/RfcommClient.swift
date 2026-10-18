import Foundation
import IOBluetooth

protocol RfcommClientDelegate: AnyObject {
    func rfcommDidConnect(name: String)
    func rfcommDidFail(_ message: String)
    func rfcommDidDisconnect()
    func rfcommDidReceive(_ hex: String)
}

final class RfcommClient: NSObject, IOBluetoothRFCOMMChannelDelegate {
    weak var delegate: RfcommClientDelegate?
    var target: String?
    var channels: [BluetoothRFCOMMChannelID] = []

    private var device: IOBluetoothDevice?
    private var channel: IOBluetoothRFCOMMChannel?
    private var channelQueue: [BluetoothRFCOMMChannelID] = []
    private var openTimer: DispatchWorkItem?
    private var reported = false
    private var opening = false

    var isOpen: Bool { channel?.isOpen() == true }

    func isConnected(_ address: String) -> Bool {
        paired().contains {
            ($0.addressString ?? "").lowercased() == address.lowercased() && $0.isConnected()
        }
    }

    var hasPairedDevice: Bool {
        !paired().isEmpty
    }

    func connect() {
        disconnect()
        guard let device = preferredDevice() else {
            delegate?.rfcommDidFail("没找到耳机：先在系统设置里配对蓝牙设备")
            return
        }
        self.device = device
        opening = true
        reported = false
        NSLog("BOSE rfcomm device %@ connected=%d", device.name ?? "", device.isConnected() ? 1 : 0)
        if device.isConnected() {
            startChannelAttempts()
            return
        }
        let status = device.openConnection(self)
        if status != kIOReturnSuccess {
            opening = false
            delegate?.rfcommDidFail("连接耳机失败")
            return
        }
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.opening, !self.reported else { return }
            if self.device?.isConnected() == true {
                self.startChannelAttempts()
                return
            }
            self.opening = false
            self.delegate?.rfcommDidFail("连接耳机超时，请重试")
        }
        openTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: work)
    }

    func send(hex: String) {
        guard let channel, channel.isOpen() else { return }
        var data = HexBytes.data(hex)
        guard !data.isEmpty else { return }
        data.withUnsafeMutableBytes { raw in
            guard let ptr = raw.baseAddress else { return }
            let n = UInt16(min(raw.count, Int(UInt16.max)))
            _ = channel.writeSync(ptr, length: n)
        }
    }

    func disconnect() {
        openTimer?.cancel()
        openTimer = nil
        opening = false
        reported = false
        channelQueue.removeAll()
        if let channel {
            channel.setDelegate(nil)
            channel.close()
        }
        channel = nil
        device = nil
    }

    @objc func connectionComplete(_ device: IOBluetoothDevice, status: IOReturn) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.opening else { return }
            if status != kIOReturnSuccess {
                self.opening = false
                self.delegate?.rfcommDidFail("连接耳机失败")
                return
            }
            self.startChannelAttempts()
        }
    }

    func rfcommChannelOpenComplete(_ rfcommChannel: IOBluetoothRFCOMMChannel!, status error: IOReturn) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.opening else { return }
            if error == kIOReturnSuccess {
                self.channel = rfcommChannel
                self.reported = true
                self.opening = false
                self.openTimer?.cancel()
                self.openTimer = nil
                self.delegate?.rfcommDidConnect(name: self.device?.name ?? "Bose")
                return
            }
            rfcommChannel?.close()
            self.openNextChannel()
        }
    }

    func rfcommChannelClosed(_ rfcommChannel: IOBluetoothRFCOMMChannel!) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let was = self.reported
            self.channel = nil
            self.reported = false
            self.opening = false
            if was { self.delegate?.rfcommDidDisconnect() }
        }
    }

    func rfcommChannelData(
        _ rfcommChannel: IOBluetoothRFCOMMChannel!,
        data dataPointer: UnsafeMutableRawPointer!,
        length dataLength: Int
    ) {
        guard dataLength > 0, let dataPointer else { return }
        let hex = HexBytes.hex(Data(bytes: dataPointer, count: dataLength))
        DispatchQueue.main.async { [weak self] in
            self?.delegate?.rfcommDidReceive(hex)
        }
    }

    private func startChannelAttempts() {
        openTimer?.cancel()
        openTimer = nil
        guard let device else {
            opening = false
            delegate?.rfcommDidFail("没找到耳机")
            return
        }
        channelQueue = channelCandidates(device)
        openNextChannel()
    }

    // 华为的控制口是标准 SPP，名字叫 Serial Port，各家型号端口号不一样，
    // 先按 SDP 里报的名字找，找不到再按最常见的 1 / 2 / 3 试。
    // 不碰 SDP 里的其它 RFCOMM 口，那可能是免提通道，写进去会打断通话。
    // 端口候选由页面按品牌给，这里只负责按顺序试；SDP 里名字像串口的插到最前面
    private func channelCandidates(_ device: IOBluetoothDevice) -> [BluetoothRFCOMMChannelID] {
        var ids: [BluetoothRFCOMMChannelID] = []
        if let spp = serialChannel(device) {
            ids.append(spp)
        }
        for id in channels where !ids.contains(id) {
            ids.append(id)
        }
        for id in discoveredChannels(device) where !ids.contains(id) {
            ids.append(id)
        }
        return ids
    }

    private func serialChannel(_ device: IOBluetoothDevice) -> BluetoothRFCOMMChannelID? {
        guard let services = device.services as? [IOBluetoothSDPServiceRecord] else { return nil }
        for record in services {
            let name = (record.getServiceName() ?? "").lowercased()
            guard name.contains("serial") || name.contains("com") else { continue }
            var channelID: BluetoothRFCOMMChannelID = 0
            if record.getRFCOMMChannelID(&channelID) == kIOReturnSuccess, channelID > 0 {
                return channelID
            }
        }
        return nil
    }

    private func openNextChannel() {
        guard let device, opening, let chID = channelQueue.first else {
            opening = false
            if !reported { delegate?.rfcommDidFail("耳机没有开放控制通道") }
            return
        }
        channelQueue.removeFirst()
        NSLog("BOSE rfcomm try channel %u", UInt(chID))
        var ch: IOBluetoothRFCOMMChannel?
        let status = device.openRFCOMMChannelAsync(&ch, withChannelID: chID, delegate: self)
        if status != kIOReturnSuccess {
            openNextChannel()
            return
        }
        channel = ch
        openTimer?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.opening, !self.reported else { return }
            ch?.setDelegate(nil)
            ch?.close()
            self.openNextChannel()
        }
        openTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: work)
    }

    private func preferredDevice() -> IOBluetoothDevice? {
        if let target,
           let hit = paired().first(where: { ($0.addressString ?? "").lowercased() == target.lowercased() }) {
            return hit
        }
        return nil
    }

    private func paired() -> [IOBluetoothDevice] {
        IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice] ?? []
    }

    private func discoveredChannels(_ device: IOBluetoothDevice) -> [BluetoothRFCOMMChannelID] {
        var ids: [BluetoothRFCOMMChannelID] = []
        let spp: [UInt8] = [
            0x00, 0x00, 0x00, 0x00, 0xDE, 0xCA, 0xFA, 0xDE,
            0xDE, 0xCA, 0xDE, 0xAF, 0xDE, 0xCA, 0xCA, 0xFF
        ]
        spp.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else { return }
            let uuid = IOBluetoothSDPUUID(bytes: base, length: spp.count)
            if let rec = device.getServiceRecord(for: uuid) {
                var channelID: BluetoothRFCOMMChannelID = 0
                if rec.getRFCOMMChannelID(&channelID) == kIOReturnSuccess, channelID > 0 {
                    ids.append(channelID)
                }
            }
        }
        if let services = device.services as? [IOBluetoothSDPServiceRecord] {
            for rec in services {
                var channelID: BluetoothRFCOMMChannelID = 0
                if rec.getRFCOMMChannelID(&channelID) == kIOReturnSuccess, channelID > 0, !ids.contains(channelID) {
                    ids.append(channelID)
                }
            }
        }
        return ids
    }
}

enum NameMatch {
    static func isBose(_ name: String) -> Bool {
        let n = name.lowercased()
        return n.hasPrefix("bose") || n.hasPrefix("le-bose") || n.hasPrefix("qc") ||
            n.hasPrefix("quietcomfort") || n.hasPrefix("soundlink") || n.contains("bose")
    }

    static func isHuawei(_ name: String) -> Bool {
        let n = name.lowercased()
        let keys = ["huawei", "freebuds", "freeclip", "freelace", "honor", "荣耀", "华为"]
        return keys.contains { n.contains($0) }
    }
}

enum HexBytes {
    static func data(_ hex: String) -> Data {
        let s = hex.filter(\.isHexDigit)
        var data = Data()
        var i = s.startIndex
        while i < s.endIndex {
            let j = s.index(i, offsetBy: 2, limitedBy: s.endIndex) ?? s.endIndex
            if let b = UInt8(s[i..<j], radix: 16) { data.append(b) }
            i = j
        }
        return data
    }

    static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}

// 设备中心的数据来源：系统里已经配对过的耳机，按品牌归类。
// 只读，不开任何控制通道，所以可以随时调。
enum HeadsetCatalog {
    static func json() -> String {
        let paired = IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice] ?? []
        var rows: [[String: Any]] = []
        for device in paired {
            let name = device.name ?? ""
            guard !name.isEmpty else { continue }
            rows.append([
                "name": name,
                "address": device.addressString ?? "",
                "connected": device.isConnected(),
            ])
        }
        var seen = Set<String>()
        rows = rows.filter { row in
            let key = (row["name"] as? String ?? "").lowercased()
            guard !key.isEmpty else { return true }
            if seen.contains(key) { return false }
            seen.insert(key)
            return true
        }
        // 已连接的排前面，组内按名字自然顺序（不分大小写），保证每次刷新顺序都一样
        rows.sort { lhs, rhs in
            let l = lhs["connected"] as? Bool ?? false
            let r = rhs["connected"] as? Bool ?? false
            if l != r { return l }
            let ln = lhs["name"] as? String ?? ""
            let rn = rhs["name"] as? String ?? ""
            return ln.localizedStandardCompare(rn) == .orderedAscending
        }
        guard let data = try? JSONSerialization.data(withJSONObject: rows),
              let text = String(data: data, encoding: .utf8) else { return "[]" }
        return text
    }

}
