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
    private var pendingScan = false
    private var connecting = false
    private var notified = false
    private var found: [UUID: CBPeripheral] = [:]
    private var scanWork: DispatchWorkItem?
    private var notifyWork: DispatchWorkItem?

    private let svcApk = CBUUID(string: "0000FEBE-0000-0000-0000-000000000000")
    private let svcSig = CBUUID(string: "FEBE")
    private let charSecure = CBUUID(string: "C65B8F2F-AEE2-4C89-B758-BC4892D6F2D8")
    private let charPlain = CBUUID(string: "D417C028-9818-4354-99D1-2AC09D074591")

    override init() {
        super.init()
        central = CBCentralManager(
            delegate: self,
            queue: .main,
            options: [CBCentralManagerOptionShowPowerAlertKey: true]
        )
    }

    func scanAndConnect() {
        NSLog("BOSE scan")
        found.removeAll()
        connecting = false
        notified = false
        pendingScan = true
        scanWork?.cancel()
        notifyWork?.cancel()
        if let p = target { central.cancelPeripheralConnection(p) }
        target = nil
        writeChar = nil
        startIfReady()
    }

    func send(hex: String) {
        guard let p = target, let ch = writeChar else { return }
        let data = hexToData(hex)
        let type: CBCharacteristicWriteType = ch.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse
        p.writeValue(data, for: ch, type: type)
    }

    func disconnect() {
        pendingScan = false
        connecting = false
        scanWork?.cancel()
        notifyWork?.cancel()
        central.stopScan()
        if let p = target { central.cancelPeripheralConnection(p) }
        target = nil
        writeChar = nil
    }

    private func startIfReady() {
        guard pendingScan else { return }
        switch central.state {
        case .poweredOn:
            pendingScan = false
            let connected = central.retrieveConnectedPeripherals(withServices: [svcApk, svcSig])
            for p in connected {
                NSLog("BOSE already %@", p.name ?? p.identifier.uuidString)
                found[p.identifier] = p
            }
            if let p = pick() {
                connect(p)
                return
            }
            NSLog("BOSE scanning")
            central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
            let work = DispatchWorkItem { [weak self] in self?.finishScan() }
            scanWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: work)
        case .unauthorized, .unsupported, .poweredOff:
            pendingScan = false
            NSLog("BOSE bt state %d", central.state.rawValue)
            delegate?.bleDidFail("bluetooth")
        default:
            NSLog("BOSE bt wait %d", central.state.rawValue)
        }
    }

    private func finishScan() {
        guard !connecting else { return }
        central.stopScan()
        if let p = pick() {
            connect(p)
            return
        }
        NSLog("BOSE none")
        delegate?.bleDidFail("none")
    }

    private func pick() -> CBPeripheral? {
        found.values.first { isBose($0.name ?? "") } ?? found.values.first
    }

    private func connect(_ p: CBPeripheral) {
        guard !connecting else { return }
        connecting = true
        scanWork?.cancel()
        central.stopScan()
        target = p
        p.delegate = self
        NSLog("BOSE connect %@", p.name ?? p.identifier.uuidString)
        central.connect(p, options: nil)
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        NSLog("BOSE state %d", central.state.rawValue)
        startIfReady()
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let advName = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? peripheral.name ?? ""
        let svcs = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID]) ?? []
        let hasFebe = svcs.contains(svcApk) || svcs.contains(svcSig)
        guard hasFebe || isBose(advName) else { return }
        NSLog("BOSE found %@", advName.isEmpty ? peripheral.identifier.uuidString : advName)
        found[peripheral.identifier] = peripheral
        connect(peripheral)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        NSLog("BOSE didConnect")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            guard let self, self.target?.identifier == peripheral.identifier else { return }
            peripheral.discoverServices([self.svcApk, self.svcSig])
        }
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        NSLog("BOSE failConnect %@", error?.localizedDescription ?? "")
        connecting = false
        delegate?.bleDidFail("connect")
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        NSLog("BOSE disconnect")
        connecting = false
        notified = false
        writeChar = nil
        delegate?.bleDidDisconnect()
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        if let error {
            NSLog("BOSE services %@", error.localizedDescription)
        }
        let svcs = peripheral.services ?? []
        if let svc = svcs.first(where: { $0.uuid == svcApk || $0.uuid == svcSig }) {
            peripheral.discoverCharacteristics(nil, for: svc)
            return
        }
        if svcs.isEmpty {
            NSLog("BOSE rediscover")
            peripheral.discoverServices(nil)
            return
        }
        NSLog("BOSE no febe")
        connecting = false
        delegate?.bleDidFail("service")
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        let chars = service.characteristics ?? []
        writeChar =
            chars.first { $0.uuid == charSecure } ??
            chars.first { $0.uuid == charPlain } ??
            chars.first {
                $0.properties.contains(.notify) &&
                    ($0.properties.contains(.write) || $0.properties.contains(.writeWithoutResponse))
            }
        guard let ch = writeChar else {
            NSLog("BOSE no char")
            connecting = false
            delegate?.bleDidFail("char")
            return
        }
        NSLog("BOSE char %@", ch.uuid.uuidString)
        peripheral.setNotifyValue(true, for: ch)
        let work = DispatchWorkItem { [weak self] in
            self?.announceConnected(peripheral)
        }
        notifyWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2, execute: work)
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        if let error {
            NSLog("BOSE notify %@", error.localizedDescription)
        } else {
            NSLog("BOSE notify on")
        }
        announceConnected(peripheral)
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let data = characteristic.value else { return }
        delegate?.bleDidReceive(data.map { String(format: "%02x", $0) }.joined())
    }

    private func announceConnected(_ peripheral: CBPeripheral) {
        guard !notified else { return }
        notified = true
        notifyWork?.cancel()
        delegate?.bleDidConnect(name: peripheral.name ?? "Bose")
    }

    private func isBose(_ name: String) -> Bool {
        let n = name.lowercased()
        return n.hasPrefix("bose") || n.hasPrefix("le-bose") || n.hasPrefix("le-qc") ||
            n.hasPrefix("qc") || n.hasPrefix("quietcomfort") || n.hasPrefix("soundlink") ||
            n.contains("bose")
    }

    private func hexToData(_ hex: String) -> Data {
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
}
