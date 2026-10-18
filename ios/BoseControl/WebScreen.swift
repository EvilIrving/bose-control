import SwiftUI
import UIKit
import WebKit

private let assetScheme = "bose"
private let startURL = "bose://app/index.html"

// file:// 下 WKWebView 会静默拒绝加载 type="module" 脚本，改用自定义 scheme 提供同一目录。
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

struct WebScreen: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebController { WebController() }
    func updateUIViewController(_ uiViewController: WebController, context: Context) {}
}

final class NativeSession: BleClientDelegate {
    let token: String
    let client = BleClient()
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

    func bleDidConnect(name: String) { send("onNativeConnected", [["name": name, "link": "ble"]]) }
    func bleDidFail(_ message: String) { send("onNativeError", [message]) }
    func bleDidDisconnect() { send("onNativeDisconnected") }
    func bleDidReceive(_ hex: String) { send("onDataReceived", [hex]) }
}

final class WebController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    private var web: WKWebView!
    private var assets: WebBundleHandler?
    private var session: NativeSession?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 10.0 / 255, green: 10.0 / 255, blue: 10.0 / 255, alpha: 1)
        let uc = WKUserContentController()
        for name in ["bleScan", "bleConnect", "sendData", "bleDisconnect", "exportDiag"] {
            uc.add(self, name: name)
        }
        let conf = WKWebViewConfiguration()
        conf.userContentController = uc
        conf.defaultWebpagePreferences.allowsContentJavaScript = true
        conf.dataDetectorTypes = []
        conf.preferences.javaScriptCanOpenWindowsAutomatically = false
        let handler = WebBundleHandler(root: Bundle.main.resourceURL!.appendingPathComponent("Web"))
        conf.setURLSchemeHandler(handler, forURLScheme: assetScheme)
        assets = handler
        web = WKWebView(frame: view.bounds, configuration: conf)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.navigationDelegate = self
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 10.0 / 255, green: 10.0 / 255, blue: 10.0 / 255, alpha: 1)
        web.underPageBackgroundColor = UIColor(red: 10.0 / 255, green: 10.0 / 255, blue: 10.0 / 255, alpha: 1)
        web.allowsLinkPreview = false
        web.allowsBackForwardNavigationGestures = false
        web.scrollView.backgroundColor = UIColor(red: 10.0 / 255, green: 10.0 / 255, blue: 10.0 / 255, alpha: 1)
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.contentInset = .zero
        web.scrollView.delaysContentTouches = false
        web.scrollView.alwaysBounceVertical = false
        web.scrollView.alwaysBounceHorizontal = false
        web.scrollView.bouncesZoom = false
        web.scrollView.minimumZoomScale = 1
        web.scrollView.maximumZoomScale = 1
        #if DEBUG
        if #available(iOS 16.4, *) { web.isInspectable = true }
        #endif
        lockGestures()
        view.addSubview(web)
        web.load(URLRequest(url: URL(string: startURL)!))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        lockGestures()
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
        let alert = UIAlertController(title: "页面出问题了", message: reason + "\n可以导出一份原生日志。", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "导出诊断", style: .default) { [weak self] _ in
            self?.exportNativeOnly(reason: reason)
        })
        alert.addAction(UIAlertAction(title: "关闭", style: .cancel))
        present(alert, animated: true)
    }

    private func exportNativeOnly(reason: String) {
        let text = "# Bose Connector 原生诊断\n\(reason)\n" + Diag.systemInfo() + "\n\n" + Diag.dump()
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = dir.appendingPathComponent("bose-diag-\(stamp).txt")
        do {
            try text.write(to: url, atomically: true, encoding: .utf8)
            Diag.log("原生导出 → \(url.lastPathComponent)")
            let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            if let pop = share.popoverPresentationController {
                pop.sourceView = view
                pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
                pop.permittedArrowDirections = []
            }
            present(share, animated: true)
        } catch {
            Diag.fail("原生导出失败：\(error.localizedDescription)")
        }
    }

    private func lockGestures() {
        web.scrollView.minimumZoomScale = 1
        web.scrollView.maximumZoomScale = 1
        web.scrollView.bouncesZoom = false
        web.scrollView.pinchGestureRecognizer?.isEnabled = false
        disableZoom(web)
    }

    private func disableZoom(_ view: UIView) {
        for gesture in view.gestureRecognizers ?? [] {
            if let tap = gesture as? UITapGestureRecognizer, tap.numberOfTapsRequired > 1 {
                tap.isEnabled = false
            }
            if gesture is UIPinchGestureRecognizer {
                gesture.isEnabled = false
            }
        }
        for child in view.subviews { disableZoom(child) }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "bleConnect":
            guard let text = message.body as? String, let data = text.data(using: .utf8),
                  let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let token = body["session"] as? String else { return }
            session?.client.disconnect()
            let next = NativeSession(token: token) { [weak self] code in self?.js(code) }
            session = next
            next.client.scanAndConnect()
        case "sendData":
            guard let text = message.body as? String, let data = text.data(using: .utf8),
                  let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: String],
                  body["session"] == session?.token, let hex = body["hex"] else { return }
            session?.client.send(hex: hex)
        case "exportDiag":
            guard let text = message.body as? String else { return }
            let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
            let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let url = dir.appendingPathComponent("bose-diag-\(stamp).txt")
            let full = text + "\n\n==== 原生 ====\n" + Diag.systemInfo() + "\n\n" + Diag.dump() + "\n"
            do {
                try full.write(to: url, atomically: true, encoding: .utf8)
                Diag.log("导出诊断 → \(url.lastPathComponent)（\(full.utf8.count)B）")
                js("onDiagExported(\(reportJSON(ok: true, path: url.path, bytes: full.utf8.count, error: nil)))")
                let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                if let pop = share.popoverPresentationController {
                    pop.sourceView = view
                    pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
                    pop.permittedArrowDirections = []
                }
                present(share, animated: true)
            } catch {
                let detail = "\((error as NSError).domain)/\((error as NSError).code): \(error.localizedDescription)"
                Diag.log("导出诊断失败：\(detail)")
                js("onDiagExported(\(reportJSON(ok: false, path: url.path, bytes: 0, error: detail)))")
            }
        case "bleDisconnect":
            guard let token = message.body as? String, token == session?.token else { return }
            session?.client.disconnect()
            session = nil
        default:
            break
        }
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
        DispatchQueue.main.async { self.web.evaluateJavaScript(code, completionHandler: nil) }
    }
}
