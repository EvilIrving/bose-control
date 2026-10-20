// 本机的蓝牙串口桥：浏览器给不了 SPP，就让这个进程代开 RFCOMM。
//   bt-bridge list                            → 打印已配对设备 JSON
//   bt-bridge open ADDRESS 1,2,3 [UUID,...]   → 打开串口；之后 stdin 收 "T <hex>"，stdout 出
//                                               "C spp" / "D <hex>" / "E <code>"
// 给了服务 UUID 就先在 SDP 里按 UUID 找端口，找不到再按给定的端口号试。
import Foundation
import IOBluetooth

func emit(_ line: String) {
    print(line)
    fflush(stdout)
}

func hexOf(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
}

func bytesOf(_ hex: String) -> Data {
    let clean = hex.filter(\.isHexDigit)
    var out = Data()
    var index = clean.startIndex
    while index < clean.endIndex {
        let next = clean.index(index, offsetBy: 2, limitedBy: clean.endIndex) ?? clean.endIndex
        if let byte = UInt8(clean[index..<next], radix: 16) { out.append(byte) }
        index = next
    }
    return out
}

func pairedDevices() -> String {
    let paired = IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice] ?? []
    let rows: [[String: Any]] = paired.compactMap { device in
        let name = device.name ?? ""
        guard !name.isEmpty else { return nil }
        return [
            "name": name,
            "address": device.addressString ?? "",
            "connected": device.isConnected(),
        ]
    }
    guard
        let data = try? JSONSerialization.data(withJSONObject: rows),
        let text = String(data: data, encoding: .utf8)
    else { return "[]" }
    return text
}

final class Opener: NSObject, IOBluetoothRFCOMMChannelDelegate {
    private let address: String
    private let channels: [BluetoothRFCOMMChannelID]
    private let services: [String]
    private var queue: [BluetoothRFCOMMChannelID] = []
    private var channel: IOBluetoothRFCOMMChannel?
    private var done = false

    init(address: String, channels: [BluetoothRFCOMMChannelID], services: [String]) {
        self.address = address
        self.channels = channels
        self.services = services
        super.init()
    }

    func start() {
        guard let device = IOBluetoothDevice(addressString: address) else {
            emit("E nodevice")
            exit(2)
        }
        if !device.isConnected() {
            _ = device.openConnection()
            var waited = 0.0
            while !device.isConnected() && waited < 8 {
                RunLoop.current.run(until: Date().addingTimeInterval(0.2))
                waited += 0.2
            }
        }
        queue = serviceChannels(device) + channels
        next(device)
    }

    // 品牌私有的控制服务，端口号只能从 SDP 里读，不能猜
    private func serviceChannels(_ device: IOBluetoothDevice) -> [BluetoothRFCOMMChannelID] {
        var ids: [BluetoothRFCOMMChannelID] = []
        for text in services {
            let uuidBytes = bytesOf(text)
            guard uuidBytes.count == 16 else { continue }
            let uuid = uuidBytes.withUnsafeBytes { raw -> IOBluetoothSDPUUID? in
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

    private func next(_ device: IOBluetoothDevice) {
        guard !done else { return }
        guard let channelID = queue.first else {
            emit("E nochannel")
            exit(3)
        }
        queue.removeFirst()
        var ref: IOBluetoothRFCOMMChannel?
        let status = device.openRFCOMMChannelAsync(&ref, withChannelID: channelID, delegate: self)
        if status != kIOReturnSuccess || ref == nil {
            next(device)
            return
        }
        channel = ref
        // 3 秒没开出来就换下一个端口
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            guard let self, !self.done else { return }
            ref?.setDelegate(nil)
            ref?.close()
            self.channel = nil
            self.next(device)
        }
    }

    func rfcommChannelOpenComplete(_ rfcommChannel: IOBluetoothRFCOMMChannel!, status error: IOReturn) {
        guard !done else { return }
        if error != kIOReturnSuccess {
            next(IOBluetoothDevice(addressString: address)!)
            return
        }
        done = true
        channel = rfcommChannel
        emit("C spp")
        readStdin()
    }

    func rfcommChannelData(_ rfcommChannel: IOBluetoothRFCOMMChannel!, data pointer: UnsafeMutableRawPointer!, length: Int) {
        guard length > 0, let pointer else { return }
        emit("D " + hexOf(Data(bytes: pointer, count: length)))
    }

    func rfcommChannelClosed(_ rfcommChannel: IOBluetoothRFCOMMChannel!) {
        emit("E closed")
        exit(0)
    }

    private func readStdin() {
        DispatchQueue.global().async {
            while let line = readLine(strippingNewline: true) {
                guard line.hasPrefix("T ") else { continue }
                let payload = bytesOf(String(line.dropFirst(2)))
                guard !payload.isEmpty, let channel = self.channel, channel.isOpen() else { continue }
                payload.withUnsafeBytes { raw in
                    guard let base = raw.baseAddress else { return }
                    _ = channel.writeSync(
                        UnsafeMutableRawPointer(mutating: base),
                        length: UInt16(payload.count)
                    )
                }
            }
            exit(0)
        }
    }
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    emit("E usage")
    exit(1)
}

if args[1] == "list" {
    emit(pairedDevices())
    exit(0)
}

if args[1] == "open", args.count >= 4 {
    let channels = args[3]
        .split(separator: ",")
        .compactMap { UInt8($0.trimmingCharacters(in: .whitespaces)) }
        .map { BluetoothRFCOMMChannelID($0) }
    let services = args.count >= 5
        ? args[4].split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        : []
    let opener = Opener(
        address: args[2],
        channels: channels.isEmpty ? [1, 2, 3] : channels,
        services: services
    )
    opener.start()
    RunLoop.main.run()
}

emit("E usage")
exit(1)
