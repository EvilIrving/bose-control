import CoreBluetooth
import Foundation
import UIKit
import os

// 全流程日志：统一日志一行 + 环形缓冲，导出诊断时整段带走。
enum Diag {
    static let subsystem = "cain.com.bosecontrol"
    private static let logger = Logger(subsystem: subsystem, category: "bt")
    private static let maxLines = 2000
    private static var buffer: [String] = []
    private static let lock = NSLock()
    private static let stamp: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f
    }()

    static func log(_ text: String) {
        logger.notice("\(text, privacy: .public)")
        remember("I " + text)
    }

    static func fail(_ text: String) {
        logger.error("\(text, privacy: .public)")
        remember("E " + text)
    }

    static func dump() -> String {
        lock.lock()
        defer { lock.unlock() }
        return buffer.joined(separator: "\n")
    }

    static var centralState = "not-observed"

    static func systemInfo() -> String {
        let info = Bundle.main.infoDictionary ?? [:]
        let version = info["CFBundleShortVersionString"] as? String ?? "?"
        let build = info["CFBundleVersion"] as? String ?? "?"
        let auth: String
        switch CBManager.authorization {
        case .allowedAlways: auth = "allowed"
        case .denied: auth = "denied"
        case .restricted: auth = "restricted"
        case .notDetermined: auth = "undetermined"
        @unknown default: auth = "unknown"
        }
        return "iOS \(UIDevice.current.systemVersion) / \(UIDevice.current.model) / app \(version)(\(build))" +
            " / central=\(centralState) auth=\(auth)"
    }

    private static func remember(_ text: String) {
        let line = stamp.string(from: Date()) + " " + text
        lock.lock()
        buffer.append(line)
        if buffer.count > maxLines { buffer.removeFirst(buffer.count - maxLines) }
        lock.unlock()
    }
}

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
    private var writeQueue: [(Data, CBCharacteristic)] = []
    private var writing = false

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
        Diag.log("scanAndConnect state=\(central.state.rawValue)")
        if central.state == .unknown {
            wantScan = true
            return
        }
        guard central.state == .poweredOn else {
            delegate?.bleDidFail(stateCode)
            return
        }
        startScan()
    }

    func send(hex: String) {
        guard let ch = writeChar else {
            Diag.fail("send 时还没有写通道")
            return
        }
        Diag.log("write \(hex.count / 2)B")
        writeQueue.append((hexToData(hex), ch))
        flushWrites()
    }

    /// CoreBluetooth 在 withoutResponse 缓冲满时会静默丢包，必须按 canSendWriteWithoutResponse 排队。
    private func flushWrites() {
        guard !writing, let peripheral = target, let (data, ch) = writeQueue.first else { return }
        let useWithoutResponse = ch.properties.contains(.writeWithoutResponse)
        if useWithoutResponse {
            guard peripheral.canSendWriteWithoutResponse else { return }
            let limit = peripheral.maximumWriteValueLength(for: .withoutResponse)
            guard data.count <= limit else {
                writeQueue.removeAll()
                delegate?.bleDidFail("write")
                return
            }
            writeQueue.removeFirst()
            peripheral.writeValue(data, for: ch, type: .withoutResponse)
            flushWrites()
        } else {
            let limit = peripheral.maximumWriteValueLength(for: .withResponse)
            guard data.count <= limit else {
                writeQueue.removeAll()
                delegate?.bleDidFail("write")
                return
            }
            writeQueue.removeFirst()
            writing = true
            peripheral.writeValue(data, for: ch, type: .withResponse)
        }
    }

    func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
        guard peripheral === target else { return }
        flushWrites()
    }

    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        if let error { Diag.fail("写失败 \(error.localizedDescription)") }
        guard peripheral === target else { return }
        writing = false
        if error != nil {
            writeQueue.removeAll()
            delegate?.bleDidFail("write")
            return
        }
        flushWrites()
    }

    func disconnect() {
        central.stopScan()
        cancelTimers()
        wantScan = false
        if let peripheral = target { central.cancelPeripheralConnection(peripheral) }
        reset()
    }

    // 上报稳定的错误码，中文文案统一由 web/link.js 负责
    private var stateCode: String {
        switch central.state {
        case .poweredOff: return "off"
        case .unauthorized: return "denied"
        case .unsupported: return "unsupported"
        case .resetting: return "resetting"
        default: return "unknown"
        }
    }

    private func startScan() {
        Diag.log("scan start（\(Int(scanSeconds))s）")
        reset()
        found.removeAll()
        wantScan = false
        // 已经连在手机上（比如正在听歌）的耳机不会出现在扫描结果里，先问系统要现成的，
        // 否则要白等一轮扫描才轮到它
        if let ready = connectedBose() {
            connect(ready)
            return
        }
        central.scanForPeripherals(
            withServices: nil,
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: true]
        )
        let work = DispatchWorkItem { [weak self] in self?.finishScan() }
        scanTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + scanSeconds, execute: work)
    }

    private func connectedBose() -> CBPeripheral? {
        let known = central.retrieveConnectedPeripherals(withServices: [svcSig, svcApk])
        return known.first(where: { isBose($0.name ?? "") }) ?? (known.count == 1 ? known[0] : nil)
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
        if let ready = connectedBose() {
            connect(ready)
            return
        }
        Diag.fail("scan 扫完没有候选（看到 \(found.count) 台）")
        delegate?.bleDidFail("none")
    }

    private func connect(_ peripheral: CBPeripheral) {
        Diag.log("connect \(peripheral.name ?? peripheral.identifier.uuidString)")
        reset()
        target = peripheral
        peripheral.delegate = self
        central.connect(peripheral)
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.target === peripheral, !self.reported else { return }
            self.central.cancelPeripheralConnection(peripheral)
            self.reset()
            self.delegate?.bleDidFail("timeout")
        }
        connectTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + connectSeconds, execute: work)
    }

    private func reset() {
        cancelTimers()
        target = nil
        writeChar = nil
        reported = false
        writeQueue.removeAll()
        writing = false
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
        Diag.centralState = stateCode
        Diag.log("central state=\(stateCode)")
        guard wantScan else { return }
        if central.state == .poweredOn {
            startScan()
        } else if central.state != .unknown {
            wantScan = false
            delegate?.bleDidFail(stateCode)
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
        guard target == nil else { return }
        let seen = Seen(
            peripheral: peripheral,
            rssi: RSSI.intValue,
            hasFebe: (services + extra).contains(where: isFebe),
            name: localName ?? peripheral.name
        )
        found[peripheral.identifier] = seen
        if seen.hasFebe || isBose(seen.name ?? "") {
            central.stopScan()
            connect(peripheral)
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard peripheral === target else { return }
        Diag.log("gatt connected \(peripheral.name ?? "-")")
        peripheral.discoverServices([svcApk, svcSig])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        guard peripheral === target else { return }
        Diag.fail("connect 失败 \(error?.localizedDescription ?? "-")")
        reset()
        delegate?.bleDidFail("refused")
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        guard peripheral === target else { return }
        Diag.log("disconnected reported=\(reported) err=\(error?.localizedDescription ?? "-")")
        let wasConnected = reported
        reset()
        if wasConnected {
            delegate?.bleDidDisconnect()
        } else {
            delegate?.bleDidFail("dropped")
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard peripheral === target else { return }
        if let error { Diag.fail("discoverServices 失败 \(error.localizedDescription)") }
        guard let svc = (peripheral.services ?? []).first(where: { isFebe($0.uuid) }) else {
            Diag.fail("没有 FEBE 服务（\(peripheral.services?.count ?? 0) 个服务）")
            central.cancelPeripheralConnection(peripheral)
            reset()
            delegate?.bleDidFail("service")
            return
        }
        peripheral.discoverCharacteristics(nil, for: svc)
    }

    func peripheral(
        _ peripheral: CBPeripheral,
        didDiscoverCharacteristicsFor service: CBService,
        error: Error?
    ) {
        guard peripheral === target else { return }
        if let error { Diag.fail("discoverCharacteristics 失败 \(error.localizedDescription)") }
        let chars = service.characteristics ?? []
        let ch = chars.first { $0.uuid == charSecure }
            ?? chars.first { $0.uuid == charPlain }
            ?? chars.first { $0.properties.contains(.notify) && $0.properties.contains(.write) }
        guard let ch else {
            Diag.fail("没有可写的控制特征（\(chars.count) 个）")
            central.cancelPeripheralConnection(peripheral)
            reset()
            delegate?.bleDidFail("char")
            return
        }
        writeChar = ch
        Diag.log("notify on \(ch.uuid.uuidString)")
        peripheral.setNotifyValue(true, for: ch)
    }

    func peripheral(
        _ peripheral: CBPeripheral,
        didUpdateNotificationStateFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        guard peripheral === target, characteristic.uuid == writeChar?.uuid else { return }
        if error != nil || !characteristic.isNotifying {
            Diag.fail("notify 失败 \(error?.localizedDescription ?? "not notifying")")
            central.cancelPeripheralConnection(peripheral)
            reset()
            delegate?.bleDidFail("notify")
            return
        }
        finish()
    }

    func peripheral(
        _ peripheral: CBPeripheral,
        didUpdateValueFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        if let error { Diag.fail("读取失败 \(error.localizedDescription)") }
        guard peripheral === target, characteristic.uuid == writeChar?.uuid, let data = characteristic.value, !data.isEmpty else {
            return
        }
        Diag.log("read \(data.count)B")
        delegate?.bleDidReceive(data.map { String(format: "%02x", $0) }.joined())
    }
}
