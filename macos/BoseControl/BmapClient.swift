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

    func scanAndConnect() {
        disconnect()
        reported = false
        if rfcomm.hasConnectedBose {
            NSLog("BOSE rfcomm first: classic already connected")
            rfcomm.connect()
            return
        }
        NSLog("BOSE ble first")
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
        NSLog("BOSE ble connected %@", name)
        delegate?.bmapDidConnect(name: name, link: "ble")
    }

    func bleDidFail(_ message: String) {
        guard !reported else { return }
        if rfcomm.hasPairedBose {
            NSLog("BOSE ble fail, try rfcomm: %@", message)
            rfcomm.connect()
            return
        }
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
        NSLog("BOSE rfcomm connected %@", name)
        delegate?.bmapDidConnect(name: name, link: "spp")
    }

    func rfcommDidFail(_ message: String) {
        guard !reported else { return }
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
