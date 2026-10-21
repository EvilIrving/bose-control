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
    private var connecting = false
    private var scanTimer: DispatchWorkItem?
    private var connectTimer: DispatchWorkItem?
    private var reported = false
    var targetName: String?
    private var writeQueue: [Data] = []
    private var writing = false

    private let scanSeconds = 8.0
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
        guard target != nil, writeChar != nil else { return }
        writeQueue.append(hexToData(hex))
        flushWrites()
    }

    private func flushWrites() {
        guard !writing, let peripheral = target, let ch = writeChar else { return }
        let type: CBCharacteristicWriteType = ch.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse
        while !writeQueue.isEmpty {
            if type == .withoutResponse && !peripheral.canSendWriteWithoutResponse { return }
            let data = writeQueue.removeFirst()
            if type == .withResponse { writing = true }
            Diag.bleDebug("ble tx \(data.count)B \(HexBytes.hex(data))")
            peripheral.writeValue(data, for: ch, type: type)
            if writing { return }
        }
    }

    func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
        guard peripheral === target else { return }
        flushWrites()
    }

    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral === target else { return }
        if let error { Diag.bleFail("ble 写失败 \(error.localizedDescription)") }
        writing = false
        if error != nil {
            writeQueue.removeAll()
            delegate?.bleDidFail("write")
        } else { flushWrites() }
    }

    private func matchesTarget(_ name: String?) -> Bool {
        guard let targetName else { return isBose(name ?? "") }
        func normalized(_ value: String) -> String {
            let lower = value.lowercased()
            return lower.hasPrefix("le-") ? String(lower.dropFirst(3)) : lower
        }
        return normalized(name ?? "") == normalized(targetName)
    }

    func disconnect() {
        central.stopScan()
        cancelTimers()
        wantScan = false
        connecting = false
        if let peripheral = target { central.cancelPeripheralConnection(peripheral) }
        reset()
    }

    private var stateText: String {
        switch central.state {
        case .poweredOn: return "蓝牙不可用"
        case .poweredOff: return "蓝牙已关闭，请先打开蓝牙"
        case .unauthorized: return "没有蓝牙权限，请到系统设置打开"
        case .unsupported: return "这台电脑不支持蓝牙"
        case .resetting: return "蓝牙正在重置，请稍后重试"
        case .unknown: return "蓝牙权限还没确认，请允许后重试"
        @unknown default: return "蓝牙不可用"
        }
    }

    private func startScan() {
        reset()
        found.removeAll()
        wantScan = false
        connecting = false
        let known = central.retrieveConnectedPeripherals(withServices: [svcSig, svcApk])
        if let device = known.first(where: { matchesTarget($0.name) }) ?? (targetName == nil && known.count == 1 ? known[0] : nil) {
            Diag.ble("ble retrieveConnected \(device.name ?? "-")")
            connect(device)
            return
        }
        Diag.ble("ble scan start（retrieveConnected 命中 \(known.count) 台）")
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
        guard !connecting else { return }
        let candidates = found.values.filter {
            targetName != nil ? matchesTarget($0.name ?? $0.peripheral.name) : ($0.hasFebe || isBose($0.name ?? $0.peripheral.name ?? ""))
        }
        if let best = candidates.max(by: { $0.rssi < $1.rssi }) {
            Diag.ble("ble 扫描命中 \(candidates.count) 台，选 \(best.name ?? best.peripheral.identifier.uuidString) rssi=\(best.rssi)")
            connect(best.peripheral)
            return
        }
        Diag.bleFail("ble 扫完没有候选（广播里看到 \(found.count) 台）")
        delegate?.bleDidFail("没找到耳机：确认耳机已开机、在旁边")
    }

    private func connect(_ peripheral: CBPeripheral) {
        connecting = true
        target = peripheral
        peripheral.delegate = self
        Diag.ble("ble connect \(peripheral.name ?? "-") \(peripheral.identifier.uuidString)")
        central.connect(peripheral)
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.target === peripheral, !self.reported else { return }
            self.central.cancelPeripheralConnection(peripheral)
            self.reset()
            Diag.bleFail("ble 连接 12 秒超时")
            self.delegate?.bleDidFail("连接耳机超时，请重试")
        }
        connectTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + connectSeconds, execute: work)
    }

    private func reset() {
        cancelTimers()
        target = nil
        writeChar = nil
        writeQueue.removeAll()
        writing = false
        reported = false
        connecting = false
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
        NameMatch.isBose(name)
    }

    private func hexToData(_ hex: String) -> Data {
        HexBytes.data(hex)
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        Diag.centralState = stateText
        Diag.log("central state=\(stateText)", stage: "B")
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
        let seen = Seen(
            peripheral: peripheral,
            rssi: RSSI.intValue,
            hasFebe: (services + extra).contains(where: isFebe),
            name: localName ?? peripheral.name
        )
        found[peripheral.identifier] = seen
        guard !connecting else { return }
        if targetName != nil ? matchesTarget(seen.name) : (seen.hasFebe || isBose(seen.name ?? "")) {
            central.stopScan()
            scanTimer?.cancel()
            scanTimer = nil
            connect(peripheral)
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard peripheral === target else { return }
        peripheral.discoverServices([svcApk, svcSig])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        guard peripheral === target else { return }
        reset()
        Diag.bleFail("ble didFailToConnect \(error.map { String(describing: $0) } ?? "-")")
        delegate?.bleDidFail("耳机拒绝 BLE 连接")
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        guard peripheral === target else { return }
        let wasConnected = reported
        reset()
        if wasConnected {
            Diag.ble("ble 断开 \(error.map { String(describing: $0) } ?? "-")")
            delegate?.bleDidDisconnect()
        } else {
            Diag.bleFail("ble 还没连上就断了 \(error.map { String(describing: $0) } ?? "-")")
            delegate?.bleDidFail("BLE 连接被断开")
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard peripheral === target else { return }
        if let error { Diag.bleFail("ble discoverServices 失败 \(error.localizedDescription)") }
        guard let svc = (peripheral.services ?? []).first(where: { isFebe($0.uuid) }) else {
            central.cancelPeripheralConnection(peripheral)
            reset()
            Diag.bleFail("ble 没有 FEBE 服务，服务列表 \((peripheral.services ?? []).map(\.uuid.uuidString))")
            delegate?.bleDidFail("耳机没有开放 BMAP 控制服务")
            return
        }
        Diag.ble("ble 有 FEBE 服务 \(svc.uuid.uuidString)，读特征")
        peripheral.discoverCharacteristics(nil, for: svc)
    }

    func peripheral(
        _ peripheral: CBPeripheral,
        didDiscoverCharacteristicsFor service: CBService,
        error: Error?
    ) {
        guard peripheral === target else { return }
        if let error { Diag.bleFail("ble discoverCharacteristics 失败 \(error.localizedDescription)") }
        let chars = service.characteristics ?? []
        let ch = chars.first { $0.uuid == charSecure }
            ?? chars.first { $0.uuid == charPlain }
            ?? chars.first { $0.properties.contains(.notify) && $0.properties.contains(.write) }
        guard let ch else {
            central.cancelPeripheralConnection(peripheral)
            reset()
            Diag.bleFail("ble 找不到控制特征，特征列表 \(chars.map(\.uuid.uuidString))")
            delegate?.bleDidFail("找不到耳机的控制通道")
            return
        }
        Diag.ble("ble 用特征 \(ch.uuid.uuidString) 订阅通知")
        writeChar = ch
        peripheral.setNotifyValue(true, for: ch)
    }

    func peripheral(
        _ peripheral: CBPeripheral,
        didUpdateNotificationStateFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        guard peripheral === target, characteristic.uuid == writeChar?.uuid else { return }
        if error != nil || !characteristic.isNotifying {
            central.cancelPeripheralConnection(peripheral)
            reset()
            Diag.bleFail("ble 订阅失败 \(error.map { String(describing: $0) } ?? "-") notifying=\(characteristic.isNotifying)")
            delegate?.bleDidFail("耳机拒绝了数据订阅")
            return
        }
        Diag.ble("ble 订阅成功")
        finish()
    }

    func peripheral(
        _ peripheral: CBPeripheral,
        didUpdateValueFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        if let error { Diag.bleFail("ble 读取失败 \(error.localizedDescription)") }
        guard peripheral === target, characteristic.uuid == writeChar?.uuid, let data = characteristic.value, !data.isEmpty else {
            return
        }
        Diag.bleDebug("ble rx \(data.count)B \(HexBytes.hex(data))")
        delegate?.bleDidReceive(HexBytes.hex(data))
    }
}
