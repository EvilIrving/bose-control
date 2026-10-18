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

final class NativeSession: BmapClientDelegate {
    let token: String
    let client = BmapClient()
    private let emit: (String) -> Void

    init(token: String, emit: @escaping (String) -> Void) {
        self.token = token
        self.emit = emit
        client.delegate = self
    }

    private func send(_ name: String, _ values: [Any] = []) {
        guard let data = try? JSONSerialization.data(withJSONObject: values + [token]),
              let json = String(data: data, encoding: .utf8) else { return }
        emit("\(name)(...\(json))")
    }

    func bmapDidConnect(name: String, link: String) {
        send("onNativeConnected", [["name": name, "link": link]])
    }
    func bmapDidFail(_ message: String) { send("onNativeError", [message]) }
    func bmapDidDisconnect() { send("onNativeDisconnected") }
    func bmapDidReceive(_ hex: String) { send("onDataReceived", [hex]) }
}

final class WebController: NSViewController, WKScriptMessageHandler, WKNavigationDelegate {
    private let brandKey = "brand"
    private var web: WKWebView!
    private var assets: WebBundleHandler?
    private var session: NativeSession?
    // 上一次发给页面的设备列表，用来把轮询里没变化的日志压掉
    private var lastDeviceList = ""

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 980, height: 900))
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor(red: 10.0 / 255, green: 10.0 / 255, blue: 10.0 / 255, alpha: 1).cgColor
    }

    private let bootBridgeJS = """
    (function () {
      function post(name, payload) {
        try { window.webkit.messageHandlers[name].postMessage(JSON.stringify(payload)); } catch (e) {}
      }
      window.addEventListener('error', function (ev) {
        var t = ev.target;
        if (t && (t.src || t.href)) {
          post('bootError', { kind: 'resource', url: t.src || t.href, tag: t.tagName || '', message: ev.message || 'resource failed' });
        } else {
          post('bootError', { kind: 'script', url: ev.filename || '', line: ev.lineno || 0,
                              message: String(ev.message), stack: (ev.error && ev.error.stack) || '' });
        }
      }, true);
      window.addEventListener('unhandledrejection', function (ev) {
        var r = ev.reason;
        post('bootError', { kind: 'rejection', message: String((r && r.message) || r), stack: (r && r.stack) || '' });
      });
      var tries = 0;
      var timer = setInterval(function () {
        if (window.__boseApp === true) { clearInterval(timer); post('appReady', { ok: true }); }
        else if (++tries > 150) { clearInterval(timer); post('appReady', { ok: false }); }
      }, 100);
    })();
    """

    override func viewDidLoad() {
        super.viewDidLoad()
        let uc = WKUserContentController()
        for name in ["bleScan", "bleConnect", "sendData", "bleDisconnect", "setBrand", "listDevices", "exportDiag", "bootError", "appReady"] {
            // 页面启动确认与启动阶段错误，见 bootBridgeJS
            uc.add(self, name: name)
        }
        uc.addUserScript(WKUserScript(source: nativeBridgeJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        uc.addUserScript(WKUserScript(source: bootBridgeJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))
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
        web.load(URLRequest(url: URL(string: startURL)!))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        reportLoadFailure("provisional", error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        reportLoadFailure("navigation", error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Diag.fail("WebView 进程被系统回收，页面已停止")
        offerNativeExport(reason: "WebView 进程被回收，页面日志可能已丢失")
    }

    // 页面起不来时没有设置页可点：原生日志 + 原生导出入口
    private func reportLoadFailure(_ stage: String, _ error: Error) {
        let ns = error as NSError
        Diag.fail("页面加载失败 \(stage) \(ns.domain)/\(ns.code) \(ns.localizedDescription)")
        offerNativeExport(reason: "页面加载失败：\(ns.domain)/\(ns.code)")
    }

    private func offerNativeExport(reason: String) {
        let alert = NSAlert()
        alert.messageText = "页面出问题了"
        alert.informativeText = reason + "\n可以导出一份原生日志，不依赖页面。"
        alert.addButton(withTitle: "导出诊断")
        alert.addButton(withTitle: "关闭")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        exportNativeOnly(reason: reason)
    }

    private func exportNativeOnly(reason: String) {
        // 页面已经坏了，结果只能由原生自己弹出来
        exportDiagnostics(pageText: nil, reason: reason) { ok, detail in
            let alert = NSAlert()
            alert.messageText = ok ? "诊断已导出" : "诊断导出失败"
            alert.informativeText = detail
            alert.addButton(withTitle: "好")
            alert.runModal()
        }
    }

    /// 唯一导出实现：pageText 为 nil 表示页面不可用（原生故障入口）。
    private func exportDiagnostics(pageText: String?, reason: String, notify: ((Bool, String) -> Void)?) {
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let url = dir.appendingPathComponent("bose-diag-\(stamp).txt")
        let head = pageText ?? "# Bose Connector 原生诊断\n\(reason)\n"
        let full = head + "\n\n==== 原生 ====\n" + Diag.systemInfo() + "\n\n" + Diag.dump() + "\n"

        func finish(_ ok: Bool, _ detail: String) {
            Diag.log("导出诊断(\(ok ? "成功" : "失败"))：\(detail)")
            if let notify {
                notify(ok, detail)
            } else {
                let payload = reportJSON(ok: ok, path: ok ? url.path : "", bytes: ok ? full.utf8.count : 0,
                                         error: ok ? nil : detail)
                js("onDiagExported(\(payload))")
            }
        }

        do {
            try full.write(to: url, atomically: true, encoding: .utf8)
            NSWorkspace.shared.activateFileViewerSelecting([url])
            finish(true, url.path)
        } catch {
            let ns = error as NSError
            finish(false, "\(ns.domain)/\(ns.code): \(ns.localizedDescription)")
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "bleScan":
            Diag.log("js bleScan（无参，只能盲扫 BLE）")
            break
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
            guard let token = body["session"] as? String else { return }
            session?.client.disconnect()
            let next = NativeSession(token: token) { [weak self] code in self?.js(code) }
            session = next
            next.client.scanAndConnect(transport: transport, address: address, channels: channels, services: services)
        case "sendData":
            guard let text = message.body as? String, let data = text.data(using: .utf8),
                  let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: String],
                  body["session"] == session?.token, let hex = body["hex"] else { return }
            session?.client.send(hex: hex)
        case "bleDisconnect":
            guard let token = message.body as? String, token == session?.token else { return }
            session?.client.disconnect()
            session = nil
        case "listDevices":
            let payload = HeadsetCatalog.json()
            // 页面自己轮询这一条（设备中心停留期间每 5 秒一次），只有内容变了才记一行
            if payload != lastDeviceList {
                lastDeviceList = payload
                Diag.log("js listDevices → \(payload)")
            }
            js("onDeviceList('\(escape(payload))')")
        case "bootError":
            if let text = message.body as? String {
                Diag.fail("页面启动错误 \(text)")
            }
        case "appReady":
            let ok = (message.body as? String)?.contains("\"ok\":true") ?? false
            if ok {
                Diag.log("页面已就绪")
            } else {
                Diag.fail("页面脚本 15 秒内没有就绪（模块未执行完）")
                offerNativeExport(reason: "页面脚本没有就绪，页面日志可能不可用")
            }
        case "exportDiag":
            guard let text = message.body as? String else { break }
            exportDiagnostics(pageText: text, reason: "", notify: nil)
        case "setBrand":
            if let id = message.body as? String {
                Diag.log("js setBrand \(id)")
                UserDefaults.standard.set(id, forKey: brandKey)
            }
        default:
            break
        }
    }

    private let nativeBridgeJS = """
    window.NativeBLE = {
      transports: ["ble", "spp"],
      hub: true,
      platform: function () { return JSON.stringify({ platform: "macos", transports: ["ble", "spp"], hub: true }); },
      bleScan: function () { window.webkit.messageHandlers.bleScan.postMessage({}); },
      bleConnect: function (payload) { window.webkit.messageHandlers.bleConnect.postMessage(String(payload)); },
      sendData: function (hex) { window.webkit.messageHandlers.sendData.postMessage(String(hex)); },
      bleDisconnect: function (session) { window.webkit.messageHandlers.bleDisconnect.postMessage(session); },
      listDevices: function () { window.webkit.messageHandlers.listDevices.postMessage({}); },
      setBrand: function (id) { window.webkit.messageHandlers.setBrand.postMessage(String(id)); },
      exportDiag: function (text) { window.webkit.messageHandlers.exportDiag.postMessage(String(text)); }
    };
    """

    private func escape(_ text: String) -> String {
        text
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\r", with: " ")
    }

    private func reportJSON(ok: Bool, path: String, bytes: Int, error: String?) -> String {
        let payload: [String: Any] = [
            "ok": ok,
            "path": path,
            "bytes": bytes,
            "error": error ?? "",
        ]
        let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{}".utf8)
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    private func js(_ code: String) {
        DispatchQueue.main.async {
            self.web.evaluateJavaScript(code) { _, error in
                if let error { Diag.fail("js error \(error.localizedDescription)") }
            }
        }
    }
}
