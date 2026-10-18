import IOBluetooth
import AppKit
import SwiftUI
import WebKit

private let assetScheme = "bose"
private let startURL = "bose://app/index.html"

final class WebBundleHandler: NSObject, WKURLSchemeHandler {
    private let root: URL

    init(root: URL) {
        self.root = root.standardizedFileURL
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let rel = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let file = root.appendingPathComponent(rel.isEmpty ? "index.html" : rel).standardizedFileURL
        guard file.path.hasPrefix(root.path), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(NSError(domain: assetScheme, code: 404))
            return
        }
        let mime: String
        switch file.pathExtension.lowercased() {
        case "html": mime = "text/html"
        case "js": mime = "text/javascript"
        case "css": mime = "text/css"
        case "png": mime = "image/png"
        case "svg": mime = "image/svg+xml"
        default: mime = "application/octet-stream"
        }
        let response = URLResponse(
            url: url,
            mimeType: mime,
            expectedContentLength: data.count,
            textEncodingName: "utf-8"
        )
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

struct WebScreen: NSViewControllerRepresentable {
    func makeNSViewController(context: Context) -> WebController { WebController() }
    func updateNSViewController(_ nsViewController: WebController, context: Context) {}
}

final class WebController: NSViewController, WKScriptMessageHandler, WKNavigationDelegate, BmapClientDelegate {
    private let brandKey = "brand"
    private var web: WKWebView!
    private var assets: WebBundleHandler?
    private let bmap = BmapClient()

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 980, height: 900))
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor(red: 10.0 / 255, green: 10.0 / 255, blue: 10.0 / 255, alpha: 1).cgColor
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let uc = WKUserContentController()
        for name in ["bleScan", "bleConnect", "sendData", "bleDisconnect", "setBrand", "listDevices"] {
            uc.add(self, name: name)
        }
        uc.addUserScript(WKUserScript(source: nativeBridgeJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // 自定义 scheme 下 localStorage 只在本次会话里有效，品牌得由原生端记住，
        // 否则下次启动又回到 Bose，自动连接会连错设备。
        let stored = UserDefaults.standard.string(forKey: brandKey) ?? "bose"
        uc.addUserScript(WKUserScript(
            source: "window.NativeBrand = \"\(stored)\";",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        let conf = WKWebViewConfiguration()
        conf.userContentController = uc
        conf.defaultWebpagePreferences.allowsContentJavaScript = true
        conf.preferences.javaScriptCanOpenWindowsAutomatically = false
        let handler = WebBundleHandler(root: Bundle.main.resourceURL!.appendingPathComponent("Web"))
        conf.setURLSchemeHandler(handler, forURLScheme: assetScheme)
        assets = handler
        web = WKWebView(frame: view.bounds, configuration: conf)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        web.underPageBackgroundColor = .black
        web.allowsMagnification = false
        web.allowsBackForwardNavigationGestures = false
        web.allowsLinkPreview = false
        #if DEBUG
        if #available(macOS 13.3, *) { web.isInspectable = true }
        #endif
        view.addSubview(web)
        bmap.delegate = self
        web.load(URLRequest(url: URL(string: startURL)!))
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "bleScan":
            Diag.log("js bleScan（无参，只能盲扫 BLE）")
            bmap.scanAndConnect(transport: "ble", address: nil, channels: [])
        case "bleConnect":
            // 页面统一发 JSON 字符串，Android 的 JS 接口只认字符串，这边跟着一起
            var body: [String: Any] = [:]
            if let text = message.body as? String, let data = text.data(using: .utf8) {
                Diag.log("js bleConnect \(text)")
                body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            } else if let dict = message.body as? [String: Any] {
                Diag.log("js bleConnect \(dict)")
                body = dict
            }
            let transport = body["transport"] as? String ?? "ble"
            let address = body["address"] as? String
            let channels = (body["channels"] as? [Int] ?? []).map { BluetoothRFCOMMChannelID($0) }
            let services = body["services"] as? [String] ?? []
            bmap.scanAndConnect(transport: transport, address: address, channels: channels, services: services)
        case "sendData":
            if let hex = message.body as? String {
                Diag.debug("js sendData \(hex)")
                bmap.send(hex: hex)
            }
        case "bleDisconnect":
            Diag.log("js bleDisconnect")
            bmap.disconnect()
        case "listDevices":
            let payload = HeadsetCatalog.json()
            Diag.log("js listDevices → \(payload)")
            js("onDeviceList('\(escape(payload))')")
        case "setBrand":
            if let id = message.body as? String {
                Diag.log("js setBrand \(id)")
                UserDefaults.standard.set(id, forKey: brandKey)
            }
        default:
            break
        }
    }

    func bmapDidConnect(name: String, link: String) {
        js("onNativeConnected('{\"name\":\"\(escape(name))\",\"link\":\"\(escape(link))\"}')")
    }

    func bmapDidFail(_ message: String) {
        js("onNativeError('\(escape(message))')")
    }

    func bmapDidDisconnect() {
        js("onNativeDisconnected()")
    }

    func bmapDidReceive(_ hex: String) {
        js("onDataReceived('\(hex)')")
    }

    private let nativeBridgeJS = """
    window.NativeBLE = {
      transports: ["ble", "spp"],
      hub: true,
      platform: function () { return JSON.stringify({ platform: "macos", transports: ["ble", "spp"], hub: true }); },
      bleScan: function () { window.webkit.messageHandlers.bleScan.postMessage({}); },
      bleConnect: function (payload) { window.webkit.messageHandlers.bleConnect.postMessage(String(payload)); },
      sendData: function (hex) { window.webkit.messageHandlers.sendData.postMessage(String(hex)); },
      bleDisconnect: function () { window.webkit.messageHandlers.bleDisconnect.postMessage({}); },
      listDevices: function () { window.webkit.messageHandlers.listDevices.postMessage({}); },
      setBrand: function (id) { window.webkit.messageHandlers.setBrand.postMessage(String(id)); }
    };
    """

    private func escape(_ text: String) -> String {
        text
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\r", with: " ")
    }

    private func js(_ code: String) {
        DispatchQueue.main.async {
            self.web.evaluateJavaScript(code) { _, error in
                if let error { Diag.fail("js error \(error.localizedDescription)") }
            }
        }
    }
}
