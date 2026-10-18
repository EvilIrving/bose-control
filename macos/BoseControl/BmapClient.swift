import IOBluetooth
import Foundation

protocol BmapClientDelegate: AnyObject {
    func bmapDidConnect(name: String, link: String)
    func bmapDidFail(_ message: String)
    func bmapDidDisconnect()
    func bmapDidReceive(_ hex: String)
}

final class BmapClient: NSObject, BleClientDelegate, RfcommClientDelegate {
    weak var delegate: BmapClientDelegate?

    private let ble = BleClient()
    private let rfcomm = RfcommClient()
    private var link = "ble"
    private var reported = false

    override init() {
        super.init()
        ble.delegate = self
        rfcomm.delegate = self
    }

    // 页面告诉我们用哪条路：ble（Bose 的 GATT）还是 spp（蓝牙串口），以及串口端口与
    // 品牌控制服务的 UUID 候选。这里不认识品牌，加新品牌不用改这个文件。
    func scanAndConnect(transport: String, address: String?, channels: [BluetoothRFCOMMChannelID], services: [String] = []) {
        disconnect()
        reported = false
        rfcomm.target = address
        rfcomm.channels = channels
        rfcomm.services = services
        if transport == "spp" {
            Diag.log("spp connect \(address ?? "-") channels=\(channels) services=\(services)")
            rfcomm.connect()
            return
        }
        if let address, rfcomm.isConnected(address) {
            Diag.log("classic 已连接，直接走 rfcomm")
            rfcomm.connect()
            return
        }
        Diag.log("ble 先扫")
        ble.scanAndConnect()
    }

    func send(hex: String) {
        if rfcomm.isOpen {
            rfcomm.send(hex: hex)
            return
        }
        ble.send(hex: hex)
    }

    func disconnect() {
        ble.disconnect()
        rfcomm.disconnect()
        reported = false
        link = "ble"
    }

    func bleDidConnect(name: String) {
        reported = true
        link = "ble"
        Diag.log("ble connected \(name)")
        delegate?.bmapDidConnect(name: name, link: "ble")
    }

    func bleDidFail(_ message: String) {
        guard !reported else { return }
        if rfcomm.hasPairedDevice {
            Diag.fail("ble 失败（\(message)），改试 rfcomm")
            rfcomm.connect()
            return
        }
        Diag.fail("ble 失败（\(message)），也没有已配对设备")
        delegate?.bmapDidFail(message)
    }

    func bleDidDisconnect() {
        guard reported, link == "ble" else { return }
        reported = false
        delegate?.bmapDidDisconnect()
    }

    func bleDidReceive(_ hex: String) {
        delegate?.bmapDidReceive(hex)
    }

    func rfcommDidConnect(name: String) {
        reported = true
        link = "spp"
        Diag.log("rfcomm connected \(name)")
        delegate?.bmapDidConnect(name: name, link: "spp")
    }

    func rfcommDidFail(_ message: String) {
        guard !reported else { return }
        Diag.fail("rfcomm 失败：\(message)")
        delegate?.bmapDidFail(message)
    }

    func rfcommDidDisconnect() {
        guard reported, link == "spp" else { return }
        reported = false
        delegate?.bmapDidDisconnect()
    }

    func rfcommDidReceive(_ hex: String) {
        delegate?.bmapDidReceive(hex)
    }
}
