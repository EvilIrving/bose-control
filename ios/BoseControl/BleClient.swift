import CoreBluetooth
import Foundation

protocol BleClientDelegate: AnyObject {
    func bleDidConnect(name: String)
    func bleDidFail(_ message: String)
    func bleDidDisconnect()
    func bleDidReceive(_ hex: String)
}

final class BleClient: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    weak var delegate: BleClientDelegate?

    private var central: CBCentralManager!
    private var target: CBPeripheral?
    private var writeChar: CBCharacteristic?
    private var found: [UUID: Seen] = [:]
    private var wantScan = false
    private var scanTimer: DispatchWorkItem?
    private var connectTimer: DispatchWorkItem?
    private var reported = false

    private let scanSeconds = 6.0
    private let connectSeconds = 12.0
    private let svcApk = CBUUID(string: "0000FEBE-0000-0000-0000-000000000000")
    private let svcSig = CBUUID(string: "0000FEBE-0000-1000-8000-00805F9B34FB")
    private let charSecure = CBUUID(string: "C65B8F2F-AEE2-4C89-B758-BC4892D6F2D8")
    private let charPlain = CBUUID(string: "D417C028-9818-4354-99D1-2AC09D074591")

    private struct Seen {
        let peripheral: CBPeripheral
        let rssi: Int
        let hasFebe: Bool
        let name: String?
    }

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: .main)
    }

    func scanAndConnect() {
        if central.state == .unknown {
            wantScan = true
            return
        }
        guard central.state == .poweredOn else {
            delegate?.bleDidFail(stateText)
            return
        }
        startScan()
    }

    func send(hex: String) {
        guard let peripheral = target, let ch = writeChar else { return }
        let type: CBCharacteristicWriteType =
            ch.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse
        peripheral.writeValue(hexToData(hex), for: ch, type: type)
    }

    func disconnect() {
        cancelTimers()
        wantScan = false
        if let peripheral = target { central.cancelPeripheralConnection(peripheral) }
        reset()
    }

    private var stateText: String {
        switch central.state {
        case .poweredOn: return "蓝牙不可用"
        case .poweredOff: return "蓝牙已关闭，请先打开蓝牙"
        case .unauthorized: return "没有蓝牙权限，请到 设置 > 耳机 打开"
        case .unsupported: return "这台设备不支持蓝牙"
        case .resetting: return "蓝牙正在重置，请稍后重试"
        case .unknown: return "蓝牙权限还没确认，请允许后重试"
        @unknown default: return "蓝牙不可用"
        }
    }

    private func startScan() {
        reset()
        found.removeAll()
        wantScan = false
        central.scanForPeripherals(
            withServices: nil,
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: true]
        )
        let work = DispatchWorkItem { [weak self] in self?.finishScan() }
        scanTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + scanSeconds, execute: work)
    }

    private func finishScan() {
        central.stopScan()
        scanTimer = nil
        let candidates = found.values.filter {
            $0.hasFebe || isBose($0.name ?? $0.peripheral.name ?? "")
        }
        if let best = candidates.max(by: { $0.rssi < $1.rssi }) {
            connect(best.peripheral)
            return
        }
        // 已经连在手机上（比如正在听歌）的耳机不会出现在扫描结果里
        let known = central.retrieveConnectedPeripherals(withServices: [svcSig, svcApk])
        if let device = known.first(where: { isBose($0.name ?? "") }) ?? (known.count == 1 ? known[0] : nil) {
            connect(device)
            return
        }
        delegate?.bleDidFail("没找到耳机：确认耳机已开机、在旁边，并且没连着别的设备")
    }

    private func connect(_ peripheral: CBPeripheral) {
        reset()
        target = peripheral
        peripheral.delegate = self
        central.connect(peripheral)
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.target === peripheral, !self.reported else { return }
            self.central.cancelPeripheralConnection(peripheral)
            self.reset()
            self.delegate?.bleDidFail("连接耳机超时，请重试")
        }
        connectTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + connectSeconds, execute: work)
    }

    private func reset() {
        cancelTimers()
        target = nil
        writeChar = nil
        reported = false
    }

    private func cancelTimers() {
        scanTimer?.cancel()
        scanTimer = nil
        connectTimer?.cancel()
        connectTimer = nil
    }

    private func finish() {
        guard let peripheral = target, !reported else { return }
        reported = true
        cancelTimers()
        delegate?.bleDidConnect(name: peripheral.name ?? "Bose")
    }

    private func isFebe(_ uuid: CBUUID) -> Bool {
        uuid == svcSig || uuid == svcApk
    }

    private func isBose(_ name: String) -> Bool {
        let n = name.lowercased()
        return n.hasPrefix("bose") || n.hasPrefix("le-bose") || n.hasPrefix("qc") ||
            n.hasPrefix("quietcomfort") || n.hasPrefix("soundlink") || n.contains("bose")
    }

    private func hexToData(_ hex: String) -> Data {
        let s = hex.filter { $0.isHexDigit }
        var data = Data()
        var i = s.startIndex
        while i < s.endIndex {
            let j = s.index(i, offsetBy: 2, limitedBy: s.endIndex) ?? s.endIndex
            if let b = UInt8(s[i..<j], radix: 16) { data.append(b) }
            i = j
        }
        return data
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        guard wantScan else { return }
        if central.state == .poweredOn {
            startScan()
        } else if central.state != .unknown {
            wantScan = false
            delegate?.bleDidFail(stateText)
        }
    }

    func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        let services = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []
        let extra = advertisementData[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID] ?? []
        let localName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        found[peripheral.identifier] = Seen(
            peripheral: peripheral,
            rssi: RSSI.intValue,
            hasFebe: (services + extra).contains(where: isFebe),
            name: localName ?? peripheral.name
        )
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices(nil)
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        reset()
        delegate?.bleDidFail("耳机拒绝连接，可能已连着别的设备")
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        let wasConnected = reported
        reset()
        if wasConnected {
            delegate?.bleDidDisconnect()
        } else {
            delegate?.bleDidFail("连接被耳机断开，请重试")
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let svc = (peripheral.services ?? []).first(where: { isFebe($0.uuid) }) else {
            central.cancelPeripheralConnection(peripheral)
            reset()
            delegate?.bleDidFail("耳机没有开放 BMAP 控制服务")
            return
        }
        peripheral.discoverCharacteristics(nil, for: svc)
    }

    func peripheral(
        _ peripheral: CBPeripheral,
        didDiscoverCharacteristicsFor service: CBService,
        error: Error?
    ) {
        let chars = service.characteristics ?? []
        let ch = chars.first { $0.uuid == charSecure }
            ?? chars.first { $0.uuid == charPlain }
            ?? chars.first { $0.properties.contains(.notify) && $0.properties.contains(.write) }
        guard let ch else {
            central.cancelPeripheralConnection(peripheral)
            reset()
            delegate?.bleDidFail("找不到耳机的控制通道")
            return
        }
        writeChar = ch
        peripheral.setNotifyValue(true, for: ch)
    }

    func peripheral(
        _ peripheral: CBPeripheral,
        didUpdateNotificationStateFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        guard characteristic.uuid == writeChar?.uuid else { return }
        if error != nil || !characteristic.isNotifying {
            central.cancelPeripheralConnection(peripheral)
            reset()
            delegate?.bleDidFail("耳机拒绝了数据订阅")
            return
        }
        finish()
    }

    func peripheral(
        _ peripheral: CBPeripheral,
        didUpdateValueFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        guard characteristic.uuid == writeChar?.uuid, let data = characteristic.value, !data.isEmpty else {
            return
        }
        delegate?.bleDidReceive(data.map { String(format: "%02x", $0) }.joined())
    }
}
