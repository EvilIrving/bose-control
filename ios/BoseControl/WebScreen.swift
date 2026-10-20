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
      var t0 = Date.now();
      var reported = false;
      function report(ok, why) {
        if (reported) return;
        reported = true;
        post('appReady', { ok: ok, reason: why, elapsedMs: Date.now() - t0 });
      }
      window.addEventListener('load', function () {
        setTimeout(function () {
          report(window.__boseApp === true, 'load-check');
        }, 800);
      });
      var timer = setInterval(function () {
        if (window.__boseApp === true) { clearInterval(timer); report(true, 'poll'); }
        else if (Date.now() - t0 > 15000) { clearInterval(timer); report(false, 'poll-timeout'); }
      }, 100);
    })();
    """

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 10.0 / 255, green: 10.0 / 255, blue: 10.0 / 255, alpha: 1)
        let uc = WKUserContentController()
        for name in ["bleScan", "bleConnect", "sendData", "bleDisconnect", "exportDiag", "bootError", "appReady", "diagLog"] {
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
        #if DEBUG
        scheduleSelfTestIfAsked()
        #endif
    }

    #if DEBUG
    /// 只给自检用：模拟器里跑 `SIMCTL_CHILD_BOSE_DIAG_SELFTEST=1` 时会导出一份到 Documents。
    private func scheduleSelfTestIfAsked() {
        guard ProcessInfo.processInfo.environment["BOSE_DIAG_SELFTEST"] == "1" else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak self] in
            guard let self else { return }
            let missing = ProcessInfo.processInfo.environment["BOSE_DIAG_MISSING"] == "1"
            let head = missing ? "页面未启动，页面日志不可用（selftest）" : "# Bose Connector 诊断 selftest\n"
            let out = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("bose-selftest.txt")
            let full = head + "\n\n==== 原生 ====\n" + Diag.systemInfo() + "\n\n" + Diag.dump() + "\n"
            do {
                try full.write(to: out, atomically: true, encoding: .utf8)
                NSLog("SELFTEST ok path=\(out.path)")
            } catch {
                NSLog("SELFTEST fail \(error.localizedDescription)")
            }
        }
    }
    #endif

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

    private enum ExportOutcome {
        case saved(path: String, bytes: Int)
        case shareFailed(path: String, bytes: Int, detail: String)
        case canceled(path: String, bytes: Int)
        case writeFailed(detail: String)

        var payload: [String: Any] {
            switch self {
            case let .saved(path, bytes):
                return ["ok": true, "saved": true, "canceled": false, "path": path, "bytes": bytes, "error": ""]
            case let .shareFailed(path, bytes, detail):
                return ["ok": false, "saved": true, "canceled": false, "path": path, "bytes": bytes, "error": detail]
            case let .canceled(path, bytes):
                return ["ok": false, "saved": true, "canceled": true, "path": path, "bytes": bytes, "error": ""]
            case let .writeFailed(detail):
                return ["ok": false, "saved": false, "canceled": false, "path": "", "bytes": 0, "error": detail]
            }
        }

        var isFailure: Bool {
            if case .writeFailed = self { return true }
            if case .shareFailed = self { return true }
            return false
        }

        var summary: String {
            switch self {
            case let .saved(path, bytes): return "已导出：\(path)（\(bytes)B）"
            case let .shareFailed(path, _, detail): return "已保存，分享失败：\(path)（\(detail)）"
            case let .canceled(path, _): return "已保存，未分享：\(path)"
            case let .writeFailed(detail): return "导出失败：\(detail)"
            }
        }
    }

    private func exportNativeOnly(reason: String) {
        exportDiagnostics(pageText: nil, reason: reason) { [weak self] outcome in
            guard let self else { return }
            // 分享面板已经关了，这时才弹结果，避免 UIKit already presenting
            let alert = UIAlertController(
                title: outcome.isFailure ? "诊断导出失败" : "诊断已导出",
                message: outcome.summary,
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "好", style: .default))
            self.present(alert, animated: true)
        }
    }

    /// 唯一导出实现：两种来源都真把文件交出去，写入结果与分享结果分开报。
    private func exportDiagnostics(pageText: String?, reason: String, notify: ((ExportOutcome) -> Void)?) {
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let unique = UUID().uuidString.prefix(8)
        let url = dir.appendingPathComponent("bose-diag-\(stamp)-\(unique).txt")
        let head = pageText ?? "# Bose Connector 原生诊断\n\(reason)\n"
        // 只从持久文件取历史 + 当前快照；内存日志只在写盘失败时兜底附上
        let full = Diag.exportTextSync(header: [head, "", "==== 原生 ====", Diag.systemInfo()])

        do {
            try full.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            let ns = error as NSError
            let detail = "\(ns.domain)/\(ns.code): \(ns.localizedDescription)"
            Diag.fail("导出诊断写入失败：\(detail)")
            deliver(.writeFailed(detail: detail), notify: notify)
            return
        }

        Diag.log("导出诊断已写入 \(url.lastPathComponent)（\(full.utf8.count)B）")
        let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        if let pop = share.popoverPresentationController {
            pop.sourceView = view
            pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
            pop.permittedArrowDirections = []
        }
        share.completionWithItemsHandler = { [weak self] _, completed, _, error in
            let outcome: ExportOutcome
            if let error {
                let ns = error as NSError
                outcome = .shareFailed(
                    path: url.path,
                    bytes: full.utf8.count,
                    detail: "\(ns.domain)/\(ns.code): \(ns.localizedDescription)"
                )
            } else if completed {
                outcome = .saved(path: url.path, bytes: full.utf8.count)
            } else {
                // 用户取消：文件留着，不宣称分享成功
                outcome = .canceled(path: url.path, bytes: full.utf8.count)
            }
            Diag.log("导出分享结果：\(outcome.summary)")
            guard let self else { return }
            self.deliver(outcome, notify: notify)
        }
        present(share, animated: true)
    }

    private func deliver(_ outcome: ExportOutcome, notify: ((ExportOutcome) -> Void)?) {
        if let notify {
            notify(outcome)
        } else {
            js("onDiagExported(\(jsonText(outcome.payload)))")
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
        case "diagLog":
            if let text = message.body as? String { Diag.pageEvent(text) }
        case "bootError":
            if let text = message.body as? String {
                Diag.fail("页面启动错误 \(text)", stage: "A")
            }
        case "appReady":
            let raw = (message.body as? String) ?? "{}"
            let data = raw.data(using: .utf8) ?? Data()
            let info = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            let ok = info["ok"] as? Bool ?? false
            let why = info["reason"] as? String ?? "unknown"
            let elapsed = info["elapsedMs"] as? Int ?? -1
            if ok {
                Diag.log("页面已就绪（\(why) \(elapsed)ms）", stage: "A")
            } else {
                Diag.fail("页面没有就绪（触发=\(why) 耗时=\(elapsed)ms，见上面的启动错误）", stage: "A")
                offerNativeExport(reason: "页面没有就绪（\(why) \(elapsed)ms）")
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

    private func jsonText(_ payload: [String: Any]) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{}".utf8)
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    private func js(_ code: String) {
        DispatchQueue.main.async { self.web.evaluateJavaScript(code, completionHandler: nil) }
    }
}
