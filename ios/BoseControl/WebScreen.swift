import SwiftUI
import WebKit

struct WebScreen: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebController { WebController() }
    func updateUIViewController(_ uiViewController: WebController, context: Context) {}
}

final class WebController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, BleClientDelegate {
    private var web: WKWebView!
    private let ble = BleClient()
    private let scheme = BundleScheme()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let uc = WKUserContentController()
        for name in ["bleScan", "sendData", "bleDisconnect", "console"] {
            uc.add(self, name: name)
        }
        uc.addUserScript(WKUserScript(source: Self.bootScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let conf = WKWebViewConfiguration()
        conf.userContentController = uc
        conf.setURLSchemeHandler(scheme, forURLScheme: "app")
        conf.defaultWebpagePreferences.allowsContentJavaScript = true
        conf.dataDetectorTypes = []
        conf.preferences.javaScriptCanOpenWindowsAutomatically = false
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
        lockGestures()
        view.addSubview(web)
        ble.delegate = self
        web.load(URLRequest(url: URL(string: "app://localhost/index.html")!))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        lockGestures()
        NSLog("BOSE page ready")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        NSLog("BOSE page fail %@", error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        NSLog("BOSE page provisional %@", error.localizedDescription)
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
            NSLog("BOSE js bleScan")
            ble.scanAndConnect()
        case "sendData":
            if let hex = message.body as? String { ble.send(hex: hex) }
        case "bleDisconnect":
            ble.disconnect()
        case "console":
            NSLog("BOSE js %@", String(describing: message.body))
        default:
            break
        }
    }

    func bleDidConnect(name: String) {
        let payload: [String: String] = ["name": name, "link": "ble"]
        let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{}".utf8)
        let json = String(data: data, encoding: .utf8) ?? "{}"
        js("onNativeConnected(\(json))")
    }

    func bleDidFail(_ message: String) {
        js("onNativeError(\(Self.quote(message)))")
    }

    func bleDidDisconnect() {
        js("onNativeDisconnected()")
    }

    func bleDidReceive(_ hex: String) {
        js("onDataReceived(\(Self.quote(hex)))")
    }

    private func js(_ code: String) {
        DispatchQueue.main.async { self.web.evaluateJavaScript(code, completionHandler: nil) }
    }

    private static func quote(_ s: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: s, options: [.fragmentsAllowed])) ?? Data("\"\"".utf8)
        return String(data: data, encoding: .utf8) ?? "\"\""
    }

    private static let bootScript = """
    window.__boseNative = true;
    window.NativeBLE = {
      bleScan() { window.webkit.messageHandlers.bleScan.postMessage({}); },
      sendData(hex) { window.webkit.messageHandlers.sendData.postMessage(String(hex || "")); },
      bleDisconnect() { window.webkit.messageHandlers.bleDisconnect.postMessage({}); }
    };
    (function () {
      const send = (t, a) => {
        try {
          window.webkit.messageHandlers.console.postMessage(t + " " + Array.from(a).map(String).join(" "));
        } catch (e) {}
      };
      const wrap = (name) => {
        const orig = console[name].bind(console);
        console[name] = function () { send(name, arguments); orig.apply(null, arguments); };
      };
      wrap("log"); wrap("debug"); wrap("warn"); wrap("error");
      window.addEventListener("error", (e) => send("error", [e.message, e.filename, e.lineno]));
      window.addEventListener("unhandledrejection", (e) => send("reject", [e.reason]));
    })();
    """
}

final class BundleScheme: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(NSError(domain: "app", code: 400))
            return
        }
        var name = url.path
        if name.hasPrefix("/") { name.removeFirst() }
        if name.isEmpty { name = "index.html" }
        let file = Bundle.main.resourceURL!
            .appendingPathComponent("Web")
            .appendingPathComponent((name as NSString).lastPathComponent)
        guard let data = try? Data(contentsOf: file) else {
            NSLog("BOSE missing %@", file.lastPathComponent)
            urlSchemeTask.didFailWithError(NSError(domain: "app", code: 404))
            return
        }
        let mime: String
        switch file.pathExtension.lowercased() {
        case "html": mime = "text/html"
        case "js": mime = "text/javascript"
        case "css": mime = "text/css"
        case "png": mime = "image/png"
        default: mime = "application/octet-stream"
        }
        let resp = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": "\(mime); charset=utf-8",
                "Cache-Control": "no-cache",
            ]
        )!
        urlSchemeTask.didReceive(resp)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
