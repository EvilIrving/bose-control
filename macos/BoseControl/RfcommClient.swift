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

    private var device: IOBluetoothDevice?
    private var channel: IOBluetoothRFCOMMChannel?
    private var channelQueue: [BluetoothRFCOMMChannelID] = []
    private var openTimer: DispatchWorkItem?
    private var reported = false
    private var opening = false

    var isOpen: Bool { channel?.isOpen() == true }

    var hasConnectedBose: Bool {
        boseDevices().contains { $0.isConnected() }
    }

    var hasPairedBose: Bool {
        !boseDevices().isEmpty
    }

    func connect() {
        disconnect()
        guard let device = preferredDevice() else {
            delegate?.rfcommDidFail("没找到耳机：先在系统设置里配对 Bose")
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
        var ids: [BluetoothRFCOMMChannelID] = [2, 8]
        for id in discoveredChannels(device) where !ids.contains(id) {
            ids.append(id)
        }
        channelQueue = ids
        openNextChannel()
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
        let devices = boseDevices()
        return devices.first { $0.isConnected() } ?? devices.first
    }

    private func boseDevices() -> [IOBluetoothDevice] {
        (IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice] ?? []).filter {
            NameMatch.isBose($0.name ?? "")
        }
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
