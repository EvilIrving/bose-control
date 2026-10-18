import Foundation
import IOBluetooth
import os

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
    var services: [String] = []

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

    var hasPairedDevice: Bool { preferredDevice() != nil }
    var targetName: String? { preferredDevice()?.name }

    func connect() {
        disconnect()
        guard let device = preferredDevice() else {
            Diag.fail("rfcomm target=\(target ?? "-") 不在已配对列表里（\(paired().count) 台）")
            delegate?.rfcommDidFail("没找到耳机：先在系统设置里配对蓝牙设备")
            return
        }
        self.device = device
        opening = true
        reported = false
        Diag.log("rfcomm device \(device.name ?? "-") \(device.addressString ?? "-") connected=\(device.isConnected())")
        if device.isConnected() {
            startChannelAttempts()
            return
        }
        let status = device.openConnection(self)
        if status != kIOReturnSuccess {
            opening = false
            Diag.fail("rfcomm openConnection \(Diag.code(status))")
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
            Diag.fail("rfcomm 8 秒没连上（classic 链路）")
            self.delegate?.rfcommDidFail("连接耳机超时，请重试")
        }
        openTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: work)
    }

    func send(hex: String) {
        guard let channel, channel.isOpen() else { return }
        var data = HexBytes.data(hex)
        guard !data.isEmpty else { return }
        let status = data.withUnsafeMutableBytes { raw -> IOReturn in
            guard let ptr = raw.baseAddress else { return kIOReturnError }
            let n = UInt16(min(raw.count, Int(UInt16.max)))
            return channel.writeSync(ptr, length: n)
        }
        if status != kIOReturnSuccess {
            Diag.fail("rfcomm 写 \(data.count)B 失败 \(Diag.code(status))")
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
                Diag.fail("rfcomm connectionComplete \(Diag.code(status))")
                self.delegate?.rfcommDidFail("连接耳机失败")
                return
            }
            self.startChannelAttempts()
        }
    }

    func rfcommChannelOpenComplete(_ rfcommChannel: IOBluetoothRFCOMMChannel!, status error: IOReturn) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.opening, rfcommChannel === self.channel else { return }
            if error == kIOReturnSuccess {
                self.channel = rfcommChannel
                self.reported = true
                self.opening = false
                self.openTimer?.cancel()
                self.openTimer = nil
                Diag.log("rfcomm channel \(rfcommChannel.getID()) open")
                self.delegate?.rfcommDidConnect(name: self.device?.name ?? "Bose")
                return
            }
            Diag.fail("rfcomm channel \(rfcommChannel.getID()) open \(Diag.code(error))")
            rfcommChannel?.close()
            self.openNextChannel()
        }
    }

    func rfcommChannelClosed(_ rfcommChannel: IOBluetoothRFCOMMChannel!) {
        DispatchQueue.main.async { [weak self] in
            guard let self, rfcommChannel === self.channel else { return }
            let was = self.reported
            self.channel = nil
            self.reported = false
            self.opening = false
            Diag.log("rfcomm channel closed (wasConnected=\(was))")
            if was { self.delegate?.rfcommDidDisconnect() }
        }
    }

    func rfcommChannelData(
        _ rfcommChannel: IOBluetoothRFCOMMChannel!,
        data dataPointer: UnsafeMutableRawPointer!,
        length dataLength: Int
    ) {
        guard rfcommChannel === channel, dataLength > 0, let dataPointer else { return }
        let hex = HexBytes.hex(Data(bytes: dataPointer, count: dataLength))
        Diag.debug("rfcomm rx \(dataLength)B \(hex)")
        DispatchQueue.main.async { [weak self] in
            self?.delegate?.rfcommDidReceive(hex)
        }
    }

    private func startChannelAttempts() {
        openTimer?.cancel()
        openTimer = nil
        guard let device else {
            opening = false
            Diag.fail("rfcomm 没有设备对象，放弃")
            delegate?.rfcommDidFail("没找到耳机")
            return
        }
        channelQueue = channelCandidates(device)
        Diag.log("rfcomm 候选通道 \(channelQueue)")
        openNextChannel()
    }

    // 华为的控制口是标准 SPP，名字叫 Serial Port，各家型号端口号不一样，
    // 先按 SDP 里报的名字找，找不到再按最常见的 1 / 2 / 3 试。
    // 不碰 SDP 里的其它 RFCOMM 口，那可能是免提通道，写进去会打断通话。
    // 端口候选由页面按品牌给，这里只负责按顺序试。
    // 品牌私有控制服务（vivo 0x0837、OPPO 0x079A）只能按 UUID 从 SDP 里读端口，排在最前。
    private func channelCandidates(_ device: IOBluetoothDevice) -> [BluetoothRFCOMMChannelID] {
        var ids: [BluetoothRFCOMMChannelID] = []
        for id in serviceChannels(device) where !ids.contains(id) {
            ids.append(id)
        }
        if let spp = serialChannel(device), !ids.contains(spp) {
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

    private func serviceChannels(_ device: IOBluetoothDevice) -> [BluetoothRFCOMMChannelID] {
        var ids: [BluetoothRFCOMMChannelID] = []
        for text in services {
            let data = HexBytes.data(text)
            guard data.count == 16 else { continue }
            let uuid = data.withUnsafeBytes { raw -> IOBluetoothSDPUUID? in
                guard let base = raw.baseAddress else { return nil }
                return IOBluetoothSDPUUID(bytes: base, length: 16)
            }
            guard let uuid, let record = device.getServiceRecord(for: uuid) else { continue }
            var channelID: BluetoothRFCOMMChannelID = 0
            if record.getRFCOMMChannelID(&channelID) == kIOReturnSuccess, channelID > 0 {
                ids.append(channelID)
            }
        }
        return ids
    }

    private func serialChannel(_ device: IOBluetoothDevice) -> BluetoothRFCOMMChannelID? {
        guard let services = device.services as? [IOBluetoothSDPServiceRecord] else { return nil }
        // "Serial Port" 才是控制口。同一台华为耳机还会报几条 "Private COM"，排在前面的那条
        // 能开、也能推一条通知，但写进去没人回，页面就成了「设备不支持」。
        // 只认 "serial"：早先还按 "com" 兜底，结果 Bose 的服务记录叫 QuietComfort…，
        // 被当成控制口塞到候选最前面，开了 24 号口却一条 BMAP 回包都没有。
        for record in services {
            let name = (record.getServiceName() ?? "").lowercased()
            guard name.contains("serial") else { continue }
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
            if !reported {
                Diag.fail("rfcomm 候选通道都开不了")
                delegate?.rfcommDidFail("耳机没有开放控制通道")
            }
            return
        }
        channelQueue.removeFirst()
        Diag.log("rfcomm open channel \(chID)")
        var ch: IOBluetoothRFCOMMChannel?
        let status = device.openRFCOMMChannelAsync(&ch, withChannelID: chID, delegate: self)
        if status != kIOReturnSuccess {
            Diag.fail("rfcomm open channel \(chID) 立即失败 \(Diag.code(status))")
            openNextChannel()
            return
        }
        channel = ch
        openTimer?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.opening, !self.reported else { return }
            Diag.log("rfcomm channel \(chID) 3 秒没开成，下一个")
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

// 日志得能事后查到：NSLog 的参数在统一日志里是 <private>，等于没打。
// 这里固定 subsystem，值一律 public，同时写一份 stderr（直接跑可执行文件时看得到）。
//   log stream --predicate 'subsystem == "cain.com.bosecontrol.mac"'
//   log show --last 10m --predicate 'subsystem == "cain.com.bosecontrol.mac"' --info --debug
enum Diag {
    static let subsystem = "cain.com.bosecontrol.mac"
    private static let logger = Logger(subsystem: subsystem, category: "bt")
    private static let stderrQueue = DispatchQueue(label: "diag.stderr")
    // 环形缓冲：导出诊断时整段带走，用户不用再截图
    private static let maxLines = 2000
    private static var buffer: [String] = []
    private static let bufferLock = NSLock()
    private static let stamp: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f
    }()

    static func log(_ text: String) {
        logger.notice("\(text, privacy: .public)")
        emit(text)
        remember("I " + text)
    }

    static func fail(_ text: String) {
        logger.error("\(text, privacy: .public)")
        emit("error " + text)
        remember("E " + text)
    }

    static func dump() -> String {
        bufferLock.lock()
        defer { bufferLock.unlock() }
        return buffer.joined(separator: "\n")
    }

    static func systemInfo() -> String {
        let info = Bundle.main.infoDictionary ?? [:]
        let version = info["CFBundleShortVersionString"] as? String ?? "?"
        let build = info["CFBundleVersion"] as? String ?? "?"
        let os = ProcessInfo.processInfo.operatingSystemVersionString
        return "macOS \(os) / app \(version)(\(build)) / \(Host.current().localizedName ?? "-")"
    }

    private static func remember(_ text: String) {
        let line = stamp.string(from: Date()) + " " + text
        bufferLock.lock()
        buffer.append(line)
        if buffer.count > maxLines { buffer.removeFirst(buffer.count - maxLines) }
        bufferLock.unlock()
    }

    // 每个数据包一行，默认级别看不到，排查时加 --debug 才出
    static func debug(_ text: String) {
        logger.debug("\(text, privacy: .public)")
        remember("D " + text)
    }

    static func code(_ status: IOReturn) -> String {
        String(format: "0x%08x", UInt32(bitPattern: status))
    }

    private static func emit(_ text: String) {
        guard let data = (text + "\n").data(using: .utf8) else { return }
        stderrQueue.async { FileHandle.standardError.write(data) }
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
