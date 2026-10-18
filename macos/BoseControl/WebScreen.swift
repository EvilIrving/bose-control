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
    private var web: WKWebView!
    private var assets: WebBundleHandler?
    private let bmap = BmapClient()

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 980, height: 900))
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.black.cgColor
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let uc = WKUserContentController()
        for name in ["bleScan", "sendData", "bleDisconnect"] {
            uc.add(self, name: name)
        }
        uc.addUserScript(WKUserScript(source: nativeBridgeJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        uc.addUserScript(WKUserScript(source: hideScrollCSS, injectionTime: .atDocumentStart, forMainFrameOnly: false))
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
        hideScrollers(web)
        bmap.delegate = self
        web.load(URLRequest(url: URL(string: startURL)!))
    }

    override func viewDidLayout() {
        super.viewDidLayout()
        hideScrollers(web)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        hideScrollers(webView)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "bleScan":
            bmap.scanAndConnect()
        case "sendData":
            if let hex = message.body as? String { bmap.send(hex: hex) }
        case "bleDisconnect":
            bmap.disconnect()
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

    private func hideScrollers(_ view: NSView?) {
        guard let view else { return }
        if let scroll = view as? NSScrollView {
            scroll.hasVerticalScroller = false
            scroll.hasHorizontalScroller = false
            scroll.autohidesScrollers = true
            scroll.scrollerStyle = .overlay
            scroll.verticalScrollElasticity = .none
            scroll.horizontalScrollElasticity = .none
        }
        if let scroller = view as? NSScroller {
            scroller.isHidden = true
            scroller.alphaValue = 0
        }
        view.subviews.forEach { hideScrollers($0) }
    }

    private let nativeBridgeJS = """
    window.NativeBLE = {
      bleScan: function () { window.webkit.messageHandlers.bleScan.postMessage({}); },
      sendData: function (hex) { window.webkit.messageHandlers.sendData.postMessage(String(hex)); },
      bleDisconnect: function () { window.webkit.messageHandlers.bleDisconnect.postMessage({}); }
    };
    """

    private let hideScrollCSS = """
    document.documentElement.style.scrollbarWidth = 'none';
    var s = document.createElement('style');
    s.textContent = 'html,body,main,*{scrollbar-width:none!important;-ms-overflow-style:none!important}::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}';
    document.documentElement.appendChild(s);
    """

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
