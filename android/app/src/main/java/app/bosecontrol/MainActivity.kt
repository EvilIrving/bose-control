package app.bosecontrol

import android.Manifest
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebResourceErrorCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewCompat

class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var bridge: BmapBridge
    private lateinit var banner: TextView

    private var pending: (() -> Unit)? = null
    private var pendingAction: (() -> Unit)? = null
    private var lastJsError = ""

    // vivo / OPPO / 小米 等 ROM 会把 BLE 扫描额外挂在「定位」上，12+ 也要定位权限
    private val oemNeedsLocation: Boolean
        get() = Build.VERSION.SDK_INT >= 31 && OEM_NEEDS_LOCATION.any {
            Build.MANUFACTURER.contains(it, ignoreCase = true) || Build.BRAND.contains(it, ignoreCase = true)
        }

    private val btPermissions: Array<String>
        get() {
            if (Build.VERSION.SDK_INT < 31) return arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
            val base = arrayOf(
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT,
            )
            return if (oemNeedsLocation) base + Manifest.permission.ACCESS_FINE_LOCATION else base
        }

    fun locationEnabled(): Boolean {
        val lm = getSystemService(LocationManager::class.java) ?: return false
        return lm.isLocationEnabled
    }

    private val ask = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { granted ->
        // 有的 ROM 会回一个空的 map，values.all{} 对空 map 恒为 true，必须按 key 查
        Diag.add("bt", "权限回调 ${granted.entries.joinToString { "${it.key.substringAfterLast('.')}=${it.value}" }}")
        if (btPermissions.all { granted[it] == true }) {
            val action = pendingAction ?: { bridge.scanInternal() }
            pendingAction = null
            action()
        } else {
            pendingAction = null
            bridge.fail("permission")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        WebView.setWebContentsDebuggingEnabled(debuggable)

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#0a0a0a"))
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.isLongClickable = false
        web.setOnLongClickListener { true }
        web.isHapticFeedbackEnabled = false
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.cacheMode = WebSettings.LOAD_NO_CACHE
        web.settings.allowFileAccess = false
        web.settings.setSupportZoom(false)
        web.settings.builtInZoomControls = false
        web.settings.displayZoomControls = false
        web.settings.textZoom = 100

        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                val line = "[js] ${msg.message()} @${msg.sourceId()}:${msg.lineNumber()}"
                Diag.add("web", line)
                if (msg.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    lastJsError = "${msg.message()} (:${msg.lineNumber()})"
                    Diag.add("web", "页面报错 ${lastJsError}")
                }
                return true
            }
        }

        web.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ) = loader.shouldInterceptRequest(request.url)

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceErrorCompat,
            ) {
                Diag.add("web", "page error ${error.errorCode} ${error.description} for ${request.url}")
                if (request.isForMainFrame) {
                    showBanner("页面没加载出来：${error.errorCode} ${error.description}")
                }
            }

            override fun onPageFinished(view: WebView, url: String) {
                Diag.add("web", "page finished $url")
                view.evaluateJavascript("window.__boseApp === true") { value ->
                    if (value != "true") {
                        val tail = if (lastJsError.isEmpty()) "" else "（$lastJsError）"
                        Diag.add("web", "页面脚本没跑起来$tail")
                        showBanner("页面脚本没跑起来$tail")
                    }
                }
            }
        }

        bridge = BmapBridge(this, web)
        web.addJavascriptInterface(bridge, "NativeBLE")

        banner = TextView(this).apply {
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#E6111111"))
            textSize = 12f
            setPadding(32, 72, 32, 32)
            visibility = View.GONE
        }

        val root = FrameLayout(this)
        root.addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        root.addView(
            banner,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP,
            ),
        )
        setContentView(root)
        web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
    }

    /** 页面起不来时把关键信息直接糊在屏幕上，省得还要连 adb。 */
    private fun showBanner(head: String) {
        val pkg = runCatching { WebViewCompat.getCurrentWebViewPackage(this) }.getOrNull()
        val webView = pkg?.let { "${it.packageName} ${it.versionName}" } ?: "未知"
        val text = buildString {
            append(head).append("\n")
            append("WebView: ").append(webView).append("\n")
            append("Android ").append(Build.VERSION.RELEASE)
            append(" / ").append(Build.MANUFACTURER).append(" ").append(Build.MODEL).append("\n")
            append("看 logcat -s BOSE 或重新打开 App 后导出诊断")
        }
        Diag.add("web", "banner: $text")
        runOnUiThread {
            banner.text = text
            banner.visibility = View.VISIBLE
        }
    }

    fun hasBtPermission(): Boolean =
        btPermissions.all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

    /** 统一入口：有权限就直接干，没有就先申请。冷启动时挂起，onResume 再弹。 */
    fun requestBtPermission(then: () -> Unit) {
        if (hasBtPermission()) {
            then()
            return
        }
        // 冷启动时 activity 还没到 RESUMED，这时 launch 可能被系统丢掉，等 onResume 再弹
        if (!lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) {
            pending = then
            return
        }
        pendingAction = then
        ask.launch(btPermissions)
    }

    fun requestBtThenScan() {
        requestBtPermission { bridge.scanInternal() }
    }

    override fun onResume() {
        super.onResume()
        val action = pending
        if (action != null) {
            pending = null
            requestBtPermission(action)
        }
    }

    companion object {
        private const val TAG = "BOSE"
        private val OEM_NEEDS_LOCATION = listOf(
            "vivo", "oppo", "realme", "oneplus", "xiaomi", "redmi", "huawei", "honor", "meizu",
        )
    }
}
