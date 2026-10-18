import SwiftUI
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

final class WebController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, BleClientDelegate {
    private var web: WKWebView!
    private var assets: WebBundleHandler?
    private let ble = BleClient()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let uc = WKUserContentController()
        for name in ["bleScan", "sendData", "bleDisconnect"] {
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
        web.backgroundColor = .black
        web.underPageBackgroundColor = .black
        web.allowsLinkPreview = false
        web.allowsBackForwardNavigationGestures = false
        web.scrollView.backgroundColor = .black
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
        ble.delegate = self
        web.load(URLRequest(url: URL(string: startURL)!))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        lockGestures()
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
        case "bleScan":
            ble.scanAndConnect()
        case "sendData":
            if let hex = message.body as? String { ble.send(hex: hex) }
        case "bleDisconnect":
            ble.disconnect()
        default:
            break
        }
    }

    func bleDidConnect(name: String) {
        js("onNativeConnected('{\"name\":\"\(escape(name))\",\"link\":\"ble\"}')")
    }

    func bleDidFail(_ message: String) {
        js("onNativeError('\(escape(message))')")
    }

    func bleDidDisconnect() {
        js("onNativeDisconnected()")
    }

    func bleDidReceive(_ hex: String) {
        js("onDataReceived('\(hex)')")
    }

    private func escape(_ text: String) -> String {
        text
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\r", with: " ")
    }

    private func js(_ code: String) {
        DispatchQueue.main.async { self.web.evaluateJavaScript(code, completionHandler: nil) }
    }
}
