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
        view.backgroundColor = UIColor(red: 10.0 / 255, green: 10.0 / 255, blue: 10.0 / 255, alpha: 1)
        let uc = WKUserContentController()
        for name in ["bleScan", "bleConnect", "sendData", "bleDisconnect", "exportDiag", "bootError", "appReady"] {
            // 页面启动确认与启动阶段错误，见 bootBridgeJS
            uc.add(self, name: name)
        }
        uc.addUserScript(WKUserScript(source: bootBridgeJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))
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
        // 页面已经坏了，结果只能由原生自己弹出来
        exportDiagnostics(pageText: nil, reason: reason) { [weak self] ok, detail in
            guard let self else { return }
            let alert = UIAlertController(
                title: ok ? "诊断已导出" : "诊断导出失败",
                message: detail,
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "好", style: .default))
            self.present(alert, animated: true)
        }
    }

    /// 唯一导出实现：pageText 为 nil 表示页面不可用（原生故障入口）。
    private func exportDiagnostics(pageText: String?, reason: String, notify: ((Bool, String) -> Void)?) {
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = dir.appendingPathComponent("bose-diag-\(stamp).txt")
        let head = pageText ?? "# Bose Connector 原生诊断\n\(reason)\n"
        let full = head + "\n\n==== 原生 ====\n" + Diag.systemInfo() + "\n\n" + Diag.dump() + "\n"

        func finish(_ ok: Bool, _ detail: String) {
            Diag.log("导出诊断(\(ok ? "成功" : "失败"))：\(detail)")
            if let notify {
                notify(ok, detail)
                return
            }
            let payload = reportJSON(ok: ok, path: ok ? url.path : "", bytes: ok ? full.utf8.count : 0,
                                     error: ok ? nil : detail)
            js("onDiagExported(\(payload))")
        }

        do {
            try full.write(to: url, atomically: true, encoding: .utf8)
            if notify == nil {
                let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                if let pop = share.popoverPresentationController {
                    pop.sourceView = view
                    pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
                    pop.permittedArrowDirections = []
                }
                present(share, animated: true)
            }
            finish(true, url.path)
        } catch {
            let ns = error as NSError
            finish(false, "\(ns.domain)/\(ns.code): \(ns.localizedDescription)")
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
            guard let text = message.body as? String else { return }
            exportDiagnostics(pageText: text, reason: "", notify: nil)
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
