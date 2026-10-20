import CoreBluetooth
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
    // 品牌私有的控制服务只能按 UUID 从 SDP 里读端口，排在最前。
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

    // 内存兜底：只用于写盘失败时给界面看最近几行，导出以磁盘为准
    private static let maxMemory = 2000
    private static var memory: [String] = []
    private static let memoryLock = NSLock()

    // 持久化
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

    // 启动最早处调用一次
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
            let boot: [String: Any] = [
                "source": "native", "stage": "A", "event": "run-start",
                "level": "info", "detail": systemInfo(),
            ]
            appendLocked(boot)
            #if DEBUG
            if let v = ProcessInfo.processInfo.environment["BOSE_DIAG_SPAM"], let n = Int(v) {
                for i in 0..<n {
                    appendLocked(["source": "native", "stage": "I", "event": "spam",
                                  "level": "debug", "detail": "synthetic \(i)"])
                }
            }
            #endif
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
        emit(text)
        remember("I " + text)
        publish(source: "native", stage: stage, event: text, level: "info", attemptId: attemptId)
    }

    static func fail(_ text: String, stage: String = "G", attemptId: String? = nil) {
        logger.error("\(text, privacy: .public)")
        emit("error " + text)
        remember("E " + text)
        publish(source: "native", stage: stage, event: text, level: "error", attemptId: attemptId)
    }

    static func debug(_ text: String) {
        logger.debug("\(text, privacy: .public)")
        remember("D " + text)
        // debug 级别的收发也落盘，否则出问题只有半截证据
        publish(source: "native", stage: "G", event: text, level: "debug", attemptId: nil)
    }

    static func code(_ status: IOReturn) -> String {
        String(format: "0x%08x", UInt32(bitPattern: status))
    }

    /// 页面把结构化事件送进来（JSON 字符串），字段缺省时这里补齐
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
        let os = ProcessInfo.processInfo.operatingSystemVersionString
        let power = centralState
        let auth: String
        switch CBManager.authorization {
        case .allowedAlways: auth = "allowed"
        case .denied: auth = "denied"
        case .restricted: auth = "restricted"
        case .notDetermined: auth = "undetermined"
        @unknown default: auth = "unknown"
        }
        return "macOS \(os) / app \(version)(\(build)) / \(Host.current().localizedName ?? "-")" +
            " / bluetooth power=\(power) auth=\(auth)"
    }

    /// 同步版本：导出时调用方在主线程等一小会儿，换来一致快照
    static func exportTextSync(header: [String]) -> String {
        var result = ""
        let sem = DispatchSemaphore(value: 0)
        exportText(header: header) { text in
            result = text
            sem.signal()
        }
        _ = sem.wait(timeout: .now() + 5)
        return result.isEmpty ? (header + ["（读取持久日志超时）"]).joined(separator: "\n") : result
    }

    /// 写盘队列排空后读一致快照：只读磁盘，不把内存日志重复拼进来
    static func exportText(header: [String], completion: @escaping (String) -> Void) {
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
                        corrupt += 1 // 上次强退留下的半行：跳过，但要在抬头里写明
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
            if health != "ok" { out.append(contentsOf: ["", "==== 仅供兜底的内存日志（未持久化） ===="] + dumpLines()) }
            completion(out.joined(separator: "\n"))
        }
    }

    private static func dumpLines() -> [String] {
        memoryLock.lock()
        defer { memoryLock.unlock() }
        return memory
    }

    private static func remember(_ text: String) {
        memoryLock.lock()
        memory.append(text)
        if memory.count > maxMemory { memory.removeFirst(memory.count - maxMemory) }
        memoryLock.unlock()
    }

    private static func publish(source: String, stage: String, event: String, level: String,
                                detail: String? = nil, attemptId: String?) {
        var dict: [String: Any] = [
            "source": source, "stage": stage, "event": event, "level": level,
        ]
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
            health = health == "ok" ? "write-failed: no handle" : health
            writeFailures += 1
            return
        }
        do {
            try handle.write(contentsOf: Data(line.utf8))
            fileBytes += line.utf8.count
            if fileBytes >= maxFileBytes { try rotate() }
            if health != "ok" && health.hasPrefix("write-failed: transient") { health = "ok" }
        } catch {
            writeFailures += 1
            health = "write-failed: \(error.localizedDescription)"
            remember("E 写盘失败 \(error.localizedDescription)")
            logger.error("日志写盘失败 \(error.localizedDescription, privacy: .public)")
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

    private static func rotate() throws {
        try handle?.close()
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

    /// 只清理本目录里的 jsonl；按天数与总量淘汰最旧的，先到者先删
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
