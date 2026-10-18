package app.bosecontrol

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var bridge: BmapBridge

    private var pendingScan = false

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
        if (btPermissions.all { granted[it] == true }) bridge.scanInternal()
        else bridge.fail("permission")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(false)
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#0b0b0b"))
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
        web.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: android.webkit.WebResourceRequest,
            ) = loader.shouldInterceptRequest(request.url)
        }
        bridge = BmapBridge(this, web)
        web.addJavascriptInterface(bridge, "NativeBLE")
        setContentView(web)
        web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
    }

    fun requestBtThenScan() {
        val perms = btPermissions
        val missing = perms.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) {
            bridge.scanInternal()
            return
        }
        // 冷启动时 activity 还没到 RESUMED，这时 launch 可能被系统丢掉，等 onResume 再弹
        if (!lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) {
            pendingScan = true
            return
        }
        ask.launch(perms)
    }

    companion object {
        private val OEM_NEEDS_LOCATION = listOf("vivo", "oppo", "realme", "oneplus", "xiaomi", "redmi", "huawei", "honor", "meizu")
    }

    override fun onResume() {
        super.onResume()
        if (pendingScan) {
            pendingScan = false
            requestBtThenScan()
        }
    }
}
