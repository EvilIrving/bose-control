import CoreBluetooth
import Foundation
import UIKit
import os

// 全流程日志：统一日志一行 + 环形缓冲，导出诊断时整段带走。
enum Diag {
    static let subsystem = "cain.com.bosecontrol"
    private static let logger = Logger(subsystem: subsystem, category: "bt")

    private static let maxMemory = 2000
    private static var memory: [String] = []
    private static let memoryLock = NSLock()

    private static let writeQueue = DispatchQueue(label: "diag.write")
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds, .withTimeZone]
        return f
    }()
    private static var runId = ""
    private static var logDir: URL?
    private static var handle: FileHandle?
    private static var fileBytes = 0
    private static var fileSeq = 0
    private static var maxFileBytes = 1 << 20
    private static var maxTotalBytes = 10 << 20
    private static var maxAgeDays = 7
    private static var health = "not-started"
    private static var writeFailures = 0
    private static var started = false

    static var centralState = "not-observed"

    static func start() {
        memoryLock.lock()
        if started { memoryLock.unlock(); return }
        started = true
        memoryLock.unlock()

        #if DEBUG
        let env = ProcessInfo.processInfo.environment
        if let v = env["BOSE_DIAG_MAX_FILE"], let n = Int(v) { maxFileBytes = max(512, n) }
        if let v = env["BOSE_DIAG_MAX_TOTAL"], let n = Int(v) { maxTotalBytes = max(1024, n) }
        if let v = env["BOSE_DIAG_MAX_DAYS"], let n = Int(v) { maxAgeDays = max(0, n) }
        #endif

        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        #if DEBUG
        let dir = ProcessInfo.processInfo.environment["BOSE_DIAG_DIR"].map {
            URL(fileURLWithPath: $0, isDirectory: true)
        } ?? base.appendingPathComponent("BoseControl/Diagnostics/logs", isDirectory: true)
        #else
        let dir = base.appendingPathComponent("BoseControl/Diagnostics/logs", isDirectory: true)
        #endif
        runId = "\(Int(Date().timeIntervalSince1970))-\(ProcessInfo.processInfo.processIdentifier)"
        writeQueue.sync {
            do {
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                logDir = dir
                removeExpired()
                openNextFile()
                health = "ok"
            } catch {
                health = "write-failed: \(error.localizedDescription)"
            }
            appendLocked(["source": "native", "stage": "A", "event": "run-start",
                          "level": "info", "detail": systemInfo()])
        }
    }

    static func info() -> [String: Any] {
        writeQueue.sync {
            ["runId": runId, "dir": logDir?.path ?? "", "health": health,
             "writeFailures": writeFailures, "files": listFiles().map { $0.lastPathComponent }]
        }
    }

    static func log(_ text: String, stage: String = "G", attemptId: String? = nil) {
        logger.notice("\(text, privacy: .public)")
        remember("I " + text)
        publish(source: "native", stage: stage, event: text, level: "info", attemptId: attemptId)
    }

    static func fail(_ text: String, stage: String = "G", attemptId: String? = nil) {
        logger.error("\(text, privacy: .public)")
        remember("E " + text)
        publish(source: "native", stage: stage, event: text, level: "error", attemptId: attemptId)
    }

    // 传输层自己的阶段：BLE 是 E（BLE 配置）。BleClient 一律走 ble*，调用点不用每条都写 stage。
    static func ble(_ text: String, attemptId: String? = nil) { log(text, stage: "E", attemptId: attemptId) }
    static func bleFail(_ text: String, attemptId: String? = nil) { fail(text, stage: "E", attemptId: attemptId) }

    static func pageEvent(_ json: String) {
        guard let data = json.data(using: .utf8),
              var dict = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            publish(source: "page", stage: "I", event: "bad-payload", level: "error",
                    detail: String(json.prefix(200)), attemptId: nil)
            return
        }
        dict["source"] = "page"
        append(dict)
    }

    static func dump() -> String {
        memoryLock.lock()
        defer { memoryLock.unlock() }
        return memory.joined(separator: "\n")
    }

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

    static func exportTextSync(header: [String]) -> String {
        var result = ""
        let sem = DispatchSemaphore(value: 0)
        writeQueue.async {
            let files = listFiles()
            var lines: [String] = []
            var corrupt = 0
            for file in files {
                guard let text = try? String(contentsOf: file, encoding: .utf8) else { continue }
                for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
                    if (try? JSONSerialization.jsonObject(with: Data(line.utf8))) != nil {
                        lines.append(String(line))
                    } else {
                        corrupt += 1
                    }
                }
            }
            let meta = [
                "runId=\(runId)",
                "dir=\(logDir?.path ?? "")",
                "health=\(health)",
                "writeFailures=\(writeFailures)",
                "files=\(files.count)",
                "bytes=\(files.reduce(0) { $0 + ((try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) })",
                "retention=maxFile=\(maxFileBytes)B total=\(maxTotalBytes)B age=\(maxAgeDays)d",
                "corruptLines=\(corrupt)",
                "memoryFallback=\(health == "ok" ? "not-used" : "recent \(memory.count) lines kept in memory only")",
            ]
            var out = header + meta + ["", "==== 持久日志（JSONL，按时间顺序） ===="]
            out.append(contentsOf: lines)
            if health != "ok" {
                memoryLock.lock()
                let recent = memory
                memoryLock.unlock()
                out.append(contentsOf: ["", "==== 仅供兜底的内存日志（未持久化） ===="] + recent)
            }
            result = out.joined(separator: "\n")
            sem.signal()
        }
        _ = sem.wait(timeout: .now() + 5)
        return result.isEmpty ? (header + ["（读取持久日志超时）"]).joined(separator: "\n") : result
    }

    private static func remember(_ text: String) {
        memoryLock.lock()
        memory.append(text)
        if memory.count > maxMemory { memory.removeFirst(memory.count - maxMemory) }
        memoryLock.unlock()
    }

    private static func publish(source: String, stage: String, event: String, level: String,
                                detail: String? = nil, attemptId: String?) {
        var dict: [String: Any] = ["source": source, "stage": stage, "event": event, "level": level]
        if let detail { dict["detail"] = detail }
        if let attemptId { dict["attemptId"] = attemptId }
        append(dict)
    }

    private static func append(_ dict: [String: Any]) {
        writeQueue.async { appendLocked(dict) }
    }

    private static func appendLocked(_ dict: [String: Any]) {
        var record = dict
        record["timestamp"] = iso.string(from: Date())
        record["runId"] = runId
        // 不转义斜杠：日志里的 URL 要能直接读
        guard let data = try? JSONSerialization.data(withJSONObject: record, options: [.withoutEscapingSlashes]),
              var line = String(data: data, encoding: .utf8) else { return }
        line += "\n"
        guard let handle else {
            writeFailures += 1
            health = "write-failed: no handle"
            return
        }
        do {
            try handle.write(contentsOf: Data(line.utf8))
            fileBytes += line.utf8.count
            if fileBytes >= maxFileBytes { rotate() }
        } catch {
            writeFailures += 1
            health = "write-failed: \(error.localizedDescription)"
            remember("E 写盘失败 \(error.localizedDescription)")
        }
    }

    private static func openNextFile() {
        guard let dir = logDir else { return }
        fileSeq += 1
        let url = dir.appendingPathComponent(String(format: "diag-%@-%03d.jsonl", runId, fileSeq))
        FileManager.default.createFile(atPath: url.path, contents: nil)
        handle = try? FileHandle(forWritingTo: url)
        fileBytes = 0
    }

    private static func rotate() {
        try? handle?.close()
        handle = nil
        openNextFile()
        removeExpired()
    }

    private static func listFiles() -> [URL] {
        guard let dir = logDir else { return [] }
        let urls = (try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey],
            options: [.skipsHiddenFiles])) ?? []
        return urls.filter { $0.pathExtension == "jsonl" }.sorted { a, b in
            let da = (try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let db = (try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return da < db
        }
    }

    private static func removeExpired() {
        var files = listFiles()
        if maxAgeDays >= 0 {
            let cutoff = Date().addingTimeInterval(-Double(maxAgeDays) * 86400)
            for file in files {
                let date = (try? file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? Date()
                if date < cutoff { try? FileManager.default.removeItem(at: file) }
            }
            files = listFiles()
        }
        func total() -> Int {
            files.reduce(0) { $0 + ((try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
        }
        while total() > maxTotalBytes && !files.isEmpty {
            try? FileManager.default.removeItem(at: files.removeFirst())
        }
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
        Diag.log("scanAndConnect state=\(central.state.rawValue)", stage: "B")
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
            Diag.bleFail("send 时还没有写通道")
            return
        }
        Diag.ble("write \(hex.count / 2)B")
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
        if let error { Diag.bleFail("写失败 \(error.localizedDescription)") }
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
        Diag.ble("scan start（\(Int(scanSeconds))s）")
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
        Diag.bleFail("scan 扫完没有候选（看到 \(found.count) 台）")
        delegate?.bleDidFail("none")
    }

    private func connect(_ peripheral: CBPeripheral) {
        Diag.ble("connect \(peripheral.name ?? peripheral.identifier.uuidString)")
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
        Diag.log("central state=\(stateCode)", stage: "B")
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
        Diag.ble("gatt connected \(peripheral.name ?? "-")")
        peripheral.discoverServices([svcApk, svcSig])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        guard peripheral === target else { return }
        Diag.bleFail("connect 失败 \(error?.localizedDescription ?? "-")")
        reset()
        delegate?.bleDidFail("refused")
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        guard peripheral === target else { return }
        Diag.ble("disconnected reported=\(reported) err=\(error?.localizedDescription ?? "-")")
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
        if let error { Diag.bleFail("discoverServices 失败 \(error.localizedDescription)") }
        guard let svc = (peripheral.services ?? []).first(where: { isFebe($0.uuid) }) else {
            Diag.bleFail("没有 FEBE 服务（\(peripheral.services?.count ?? 0) 个服务）")
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
        if let error { Diag.bleFail("discoverCharacteristics 失败 \(error.localizedDescription)") }
        let chars = service.characteristics ?? []
        let ch = chars.first { $0.uuid == charSecure }
            ?? chars.first { $0.uuid == charPlain }
            ?? chars.first { $0.properties.contains(.notify) && $0.properties.contains(.write) }
        guard let ch else {
            Diag.bleFail("没有可写的控制特征（\(chars.count) 个）")
            central.cancelPeripheralConnection(peripheral)
            reset()
            delegate?.bleDidFail("char")
            return
        }
        writeChar = ch
        Diag.ble("notify on \(ch.uuid.uuidString)")
        peripheral.setNotifyValue(true, for: ch)
    }

    func peripheral(
        _ peripheral: CBPeripheral,
        didUpdateNotificationStateFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        guard peripheral === target, characteristic.uuid == writeChar?.uuid else { return }
        if error != nil || !characteristic.isNotifying {
            Diag.bleFail("notify 失败 \(error?.localizedDescription ?? "not notifying")")
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
        if let error { Diag.bleFail("读取失败 \(error.localizedDescription)") }
        guard peripheral === target, characteristic.uuid == writeChar?.uuid, let data = characteristic.value, !data.isEmpty else {
            return
        }
        Diag.ble("read \(data.count)B")
        delegate?.bleDidReceive(data.map { String(format: "%02x", $0) }.joined())
    }
}
