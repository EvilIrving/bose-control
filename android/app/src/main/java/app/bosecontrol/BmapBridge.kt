package app.bosecontrol

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothSocket
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.FileProvider
import android.webkit.JavascriptInterface
import android.webkit.WebView
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

@SuppressLint("MissingPermission")
class BmapBridge(
    private val activity: MainActivity,
    private val web: WebView,
) {
    private val main = Handler(Looper.getMainLooper())
    private val adapter: BluetoothAdapter?
        get() = activity.getSystemService(BluetoothManager::class.java)?.adapter

    private var gatt: BluetoothGatt? = null
    private var writeChar: BluetoothGattCharacteristic? = null
    private var spp: BluetoothSocket? = null
    private var sppThread: Thread? = null
    private var link = "ble"
    @Volatile private var gen = 0
    private var session = ""
    @Volatile private var openingSocket: BluetoothSocket? = null
    private var scanCallback: ScanCallback? = null
    private var scanTimeout: Runnable? = null

    private var wantTransport = "ble"
    private var wantAddress: String? = null
    private var wantChannels = listOf(1, 2, 3)
    private var wantServices = listOf<String>()
    private var sppTried = false
    private val gattWrites = java.util.ArrayDeque<ByteArray>()
    private var writingGatt = false

    @JavascriptInterface
    fun bleScan() {
        wantTransport = "ble"
        wantAddress = null
        main.post { activity.requestBtThenScan() }
    }

    /** 页面按品牌选好路线：ble 走 GATT 扫描，spp 走指定设备的蓝牙串口。 */
    @JavascriptInterface
    fun bleConnect(payload: String) {
        val json = runCatching { org.json.JSONObject(payload) }.getOrNull() ?: return
        val token = json.optString("session")
        main.post {
            close()
            session = token
            wantTransport = json.optString("transport", "ble")
            wantAddress = json.optString("address").takeIf { it.isNotEmpty() }
            val channels = json.optJSONArray("channels")
            wantChannels = if (channels == null) emptyList() else
                (0 until channels.length()).map { channels.optInt(it) }.filter { it > 0 }
            val services = json.optJSONArray("services")
            wantServices = if (services == null) emptyList() else
                (0 until services.length()).map { services.optString(it) }.filter { it.isNotEmpty() }
            activity.requestBtPermission { if (session == token) scanInternal() }
        }
    }

    /** 已配对设备列表，页面自己做品牌归类。 */
    @JavascriptInterface
    fun listDevices() {
        // 12+ 读 bondedDevices 要 BLUETOOTH_CONNECT，没有就先申请，拿到再回一次
        if (!activity.hasBtPermission()) {
            main.post { activity.requestBtPermission { listDevices() } }
            return
        }
        val ad = adapter
        if (ad == null) {
            js("onDeviceList('[]')")
            return
        }
        val live = connectedAddresses()
        val peers = ad.bondedDevices.orEmpty()
            .mapNotNull { device ->
                val address = device.address ?: return@mapNotNull null
                // 名字可能是空的（只配对过一次、名字没缓存下来），退回别名再退回地址：
                // 静默丢掉会让首页凭空少一台，也看不出是原生没给还是品牌没认上
                val name = device.name?.takeIf { it.isNotBlank() }
                    ?: deviceAlias(device)
                    ?: address
                PeerRow(name, address, live.contains(address.lowercase()))
            }
            .sortedWith(peerOrder)
        // 每一步一行：配了几台、每台叫什么，`adb logcat -s BOSE` 直接看
        Diag.add("hub", "listDevices bonded=${peers.size} " + peers.joinToString(" | ") { "${it.name}@${it.address}" })
        val json = peers.joinToString(",", "[", "]") { peer ->
            "{\"name\":\"" + escapeJson(peer.name) + "\",\"address\":\"" + escapeJson(peer.address) +
                "\",\"connected\":" + peer.connected + "}"
        }
        // 这一整串要塞进单引号里执行，名字里的 ' 和 \ 必须先转义
        val safe = json.replace("\\", "\\\\").replace("'", "\\'")
        js("onDeviceList('$safe')")
    }

    private data class PeerRow(val name: String, val address: String, val connected: Boolean)

    private fun deviceAlias(device: BluetoothDevice): String? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) device.alias?.takeIf { it.isNotBlank() } else null

    // 顺序要稳定：已连接在前，组内按名字自然序（数字按数值比，"QC 2" 在 "QC 10" 前，不分大小写）。
    private val peerOrder = Comparator<PeerRow> { a, b ->
        when {
            a.connected && !b.connected -> -1
            !a.connected && b.connected -> 1
            else -> naturalCompare(a.name, b.name)
        }
    }

    private fun naturalCompare(a: String, b: String): Int {
        var i = 0
        var j = 0
        while (i < a.length && j < b.length) {
            val ca = a[i]
            val cb = b[j]
            if (ca.isDigit() && cb.isDigit()) {
                var endA = i
                while (endA < a.length && a[endA].isDigit()) endA++
                var endB = j
                while (endB < b.length && b[endB].isDigit()) endB++
                val numA = a.substring(i, endA).trimStart('0')
                val numB = b.substring(j, endB).trimStart('0')
                if (numA.length != numB.length) return numA.length - numB.length
                val byNumber = numA.compareTo(numB)
                if (byNumber != 0) return byNumber
                i = endA
                j = endB
                continue
            }
            val byChar = ca.lowercaseChar().compareTo(cb.lowercaseChar())
            if (byChar != 0) return byChar
            i++
            j++
        }
        return (a.length - i) - (b.length - j)
    }

    /** 系统认为正在连着的外设地址（GATT + 各音频 profile）。 */
    private fun connectedAddresses(): Set<String> {
        val mgr = activity.getSystemService(BluetoothManager::class.java) ?: return emptySet()
        val profiles = listOf(
            BluetoothProfile.GATT,
            BluetoothProfile.A2DP,
            BluetoothProfile.HEADSET,
        )
        val out = mutableSetOf<String>()
        for (profile in profiles) {
            runCatching {
                mgr.getConnectedDevices(profile).orEmpty().forEach { out.add((it.address ?: "").lowercase()) }
            }.onFailure {
                Diag.add("bt", "getConnectedDevices($profile) 失败 ${it.javaClass.simpleName}: ${it.message}")
            }
        }
        return out
    }

    private fun escapeJson(text: String) = text.replace("\\", "\\\\").replace("\"", "\\\"")

    @JavascriptInterface
    fun sendData(payload: String) {
        val body = runCatching { org.json.JSONObject(payload) }.getOrNull() ?: return
        val token = body.optString("session")
        val bytes = hexToBytes(body.optString("hex"))
        main.post { if (token == session) write(bytes) }
    }

    @JavascriptInterface
    fun bleDisconnect(token: String) {
        log("js bleDisconnect token=$token")
        main.post {
            if (token == session) {
                close()
                session = ""
            }
        }
    }

    /** 页面问平台能力：能走哪几条路、有没有设备中心。 */
    @JavascriptInterface
    fun platform(): String {
        return "{\"platform\":\"android\",\"transports\":[\"ble\",\"spp\"],\"hub\":true}"
    }

    /** 页面日志落盘：来源由原生补，字段缺省不报错 */
    @JavascriptInterface
    fun diagLog(json: String) {
        Diag.pageEvent(json)
    }

    /** 诊断用：系统/机型/权限/蓝牙开关/已配对台数，任何一项读不到都不抛。 */
    @JavascriptInterface
    fun env(): String {
        fun granted(name: String): String = runCatching {
            if (activity.checkSelfPermission(name) == PackageManager.PERMISSION_GRANTED) "granted" else "denied"
        }.getOrElse { "unknown" }

        val json = org.json.JSONObject()
        val errors = org.json.JSONArray()
        fun step(name: String, block: () -> Unit) {
            try {
                block()
            } catch (e: Exception) {
                errors.put("$name: ${e.javaClass.simpleName}: ${e.message}")
            }
        }

        step("platform") { json.put("platform", "android") }
        step("sdk") { json.put("sdk", Build.VERSION.SDK_INT) }
        step("release") { json.put("release", Build.VERSION.RELEASE) }
        step("oem") { json.put("oem", Build.MANUFACTURER) }
        step("model") { json.put("model", Build.MODEL) }
        step("app") {
            val info = activity.packageManager.getPackageInfo(activity.packageName, 0)
            json.put("app", info.versionName ?: "?")
            @Suppress("DEPRECATION")
            json.put("appCode", info.versionCode)
        }
        step("webview") {
            val pkg = androidx.webkit.WebViewCompat.getCurrentWebViewPackage(activity)
            json.put("webview", pkg?.let { "${it.packageName} ${it.versionName}" } ?: "unknown")
        }
        step("adapter") {
            val ad = adapter
            json.put("adapter", when {
                ad == null -> "absent"
                ad.isEnabled -> "on"
                else -> "off"
            })
        }
        step("bonded") {
            val ad = adapter
            json.put("bonded", ad?.bondedDevices?.size ?: -1)
            json.put("bose", ad?.bondedDevices?.count { isBose(it.name ?: "") } ?: -1)
        }
        step("perm") {
            val perm = org.json.JSONObject()
            val api31 = Build.VERSION.SDK_INT >= 31
            perm.put("scan", if (api31) granted(Manifest.permission.BLUETOOTH_SCAN) else "not-applicable")
            perm.put("connect", if (api31) granted(Manifest.permission.BLUETOOTH_CONNECT) else "not-applicable")
            perm.put("fineLocation", granted(Manifest.permission.ACCESS_FINE_LOCATION))
            perm.put("coarseLocation", granted(Manifest.permission.ACCESS_COARSE_LOCATION))
            perm.put(
                "locationService",
                when (activity.locationEnabledOrNull()) {
                    true -> "on"
                    false -> "off"
                    else -> "unknown"
                },
            )
            json.put("perm", perm)
        }
        if (errors.length() > 0) json.put("errors", errors)
        return json.toString()
    }

    @JavascriptInterface
    fun exportDiag(text: String) {
        writeDiagnostics(text, "page")
    }

    /**
     * 唯一的导出实现：页面按钮和错误横幅都走这里。
     * 写入与分享分开——分享失败不影响已经生成的文件，也不会把文件删掉。
     */
    fun writeDiagnostics(text: String, origin: String) {
        main.post {
            var file: File? = null
            val reason = runCatching {
                val name = "bose-diag-" +
                    SimpleDateFormat("yyyyMMdd-HHmmss-SSS", Locale.US).format(Date()) + ".txt"
                // 只从持久文件取历史 + 当前快照；内存日志仅在写盘失败时兜底
                val full = text + "\n\n==== 原生 ====\n" + Diag.systemInfo(activity) +
                    "\n" + env() + "\n\n" + Diag.exportTextSync(listOf("==== 当前状态 ====")) + "\n"
                val root = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: activity.filesDir
                val dir = File(root, "diagnostics").apply { mkdirs() }
                val target = File(dir, name)
                file = target // 先持有引用：写到一半抛异常时也要能删掉这个半成品
                target.writeBytes(full.toByteArray())
                if (!target.exists() || target.length() == 0L) {
                    runCatching { target.delete() }
                    error("写入后文件为空")
                }
                Diag.add("diag", "导出 → ${target.absolutePath}（${target.length()}B）")
                null
            }.getOrElse { "${it.javaClass.simpleName}: ${it.message}" }

            if (reason != null) {
                Diag.add("diag", "导出失败（$origin）：$reason")
                runCatching { file?.takeIf { it.exists() }?.delete() }
                notifyExport(origin, ok = false, file = null, shareError = null, error = reason)
                return@post
            }

            val target = file!!
            val shareError = runCatching {
                val uri = FileProvider.getUriForFile(activity, activity.packageName + ".diag", target)
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                activity.startActivity(Intent.createChooser(send, "导出诊断"))
                null
            }.getOrElse { "${it.javaClass.simpleName}: ${it.message}" }

            if (shareError != null) {
                // 文件已经写好，保留；只报告分享失败
                Diag.add("diag", "分享失败（$origin）：$shareError；文件保留 ${target.absolutePath}")
            }
            notifyExport(origin, ok = true, file = target, shareError = shareError, error = null)
        }
    }

    /** 页面还活着就回调页面；页面挂了（错误横幅入口）就用 Toast 给用户看。 */
    private fun notifyExport(origin: String, ok: Boolean, file: File?, shareError: String?, error: String?) {
        // saved = 文件真的写好了；ok 只有「写好且分享出去」才为 true，
        // shareError 单独回传，界面要能说「已保存但分享失败」
        val payload = org.json.JSONObject()
            .put("ok", ok && shareError == null)
            .put("saved", ok)
            .put("path", file?.absolutePath ?: "")
            .put("bytes", file?.length() ?: 0)
            .put("error", shareError ?: error ?: "")
        if (origin == "page") {
            web.evaluateJavascript("onDiagExported(${payload})", null)
        } else {
            val text = when {
                !ok -> "导出失败：${error ?: "未知原因"}"
                shareError != null -> "已保存，分享失败：${file?.absolutePath}（$shareError）"
                else -> "已导出：${file?.absolutePath}"
            }
            android.widget.Toast.makeText(activity, text, android.widget.Toast.LENGTH_LONG).show()
            Diag.add("diag", "原生入口反馈：$text")
        }
    }

    fun scanInternal() {
        log("scan transport=${wantTransport ?: "-"} address=${wantAddress ?: "-"} channels=$wantChannels services=${wantServices.size}")
        val ad = adapter ?: return fail("adapter")
        if (!ad.isEnabled) return fail("off")
        close()
        val mine = ++gen
        sppTried = false
        if (wantTransport == "spp") {
            val target = wantAddress
            if (target.isNullOrEmpty()) return fail("none")
            return openSpp(ad, target, mine)
        }
        val mgr = activity.getSystemService(BluetoothManager::class.java)
        // 已经连在系统上的耳机不会广播，先直接拿现成的 GATT 连接
        val already = mgr?.getConnectedDevices(BluetoothProfile.GATT).orEmpty()
            .firstOrNull { if (wantAddress != null) it.address.equals(wantAddress, ignoreCase = true) else isBose(it.name ?: "") }
        if (already != null) {
            log("gatt already connected: ${already.name}")
            connectGatt(already, mine)
            return
        }

        if (wantAddress != null) {
            log("known target, open control channel directly")
            trySpp(ad, mine)
            return
        }
        val scanner = ad.bluetoothLeScanner ?: return fail("off")
        val seen = LinkedHashMap<String, BluetoothDevice>()
        var settled = false

        fun settle() {
            if (settled) return
            settled = true
            scanCallback?.let { runCatching { scanner.stopScan(it) } }
            scanCallback = null
            scanTimeout?.let { main.removeCallbacks(it) }
            scanTimeout = null
        }

        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                if (settled || mine != gen) return
                val device = result.device
                val name = result.scanRecord?.deviceName ?: device.name ?: return
                if (wantAddress != null && !device.address.equals(wantAddress, ignoreCase = true)) return
                if (wantAddress == null && !isBose(name)) return
                log("found $name")
                seen[device.address] = device
                settle()
                connectGatt(device, mine)
            }

            override fun onScanFailed(errorCode: Int) {
                if (mine != gen) return
                log("scan failed $errorCode")
                settle()
                fail(if (!activity.locationEnabled()) "location" else "scan")
            }
        }
        scanCallback = cb
        runCatching { scanner.startScan(cb) }.onFailure {
            log("startScan threw ${it.message}")
            settle()
            return fail("scan")
        }

        val timeout = Runnable {
            if (mine != gen) return@Runnable
            settle()
            val bonded = ad.bondedDevices?.firstOrNull { isBose(it.name ?: "") }
            when {
                seen.isNotEmpty() -> connectGatt(seen.values.first(), mine)
                bonded != null -> {
                    log("scan timeout, try bonded ${bonded.name}")
                    connectGatt(bonded, mine)
                }
                else -> trySpp(ad, mine)
            }
        }
        scanTimeout = timeout
        main.postDelayed(timeout, 8000)
    }

    private fun connectGatt(device: BluetoothDevice, mine: Int) {
        link = "ble"
        var discovered = false
        var ready = false
        main.postDelayed({
            if (mine == gen && !ready && gatt != null) {
                log("connect timeout")
                fallback(mine)
            }
        }, 15000)
        fun discover(g: BluetoothGatt) {
            if (discovered || mine != gen || g !== gatt) return
            discovered = true
            g.discoverServices()
        }
        val cb = object : BluetoothGattCallback() {
            override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
                if (mine != gen || g !== gatt) {
                    runCatching { g.close() }
                    return
                }
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    log("gatt connected status=$status")
                    if (!g.requestMtu(517)) discover(g)
                    // 有的机型 requestMtu 不回调 onMtuChanged，兜一个超时直接发现服务
                    main.postDelayed({ if (mine == gen) discover(g) }, 1500)
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    log("gatt disconnected status=$status")
                    if (status == BluetoothGatt.GATT_SUCCESS) {
                        event("onNativeDisconnected", mine)
                    } else {
                        fallback(mine)
                    }
                }
            }

            override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
                if (mine != gen || g !== gatt) return
                log("mtu=$mtu status=$status")
                discover(g)
            }

            override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
                if (mine != gen || g !== gatt) return
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    Diag.add("bt", "discoverServices 失败 status=$status（session=$session）")
                    return fail("service", mine)
                }
                val svc = g.getService(SVC_APK) ?: g.getService(SVC_SIG) ?: return fail("service")
                val ch = svc.getCharacteristic(CHAR_SECURE)
                    ?: svc.getCharacteristic(CHAR_PLAIN)
                    ?: return fail("char")
                writeChar = ch
                if (!g.setCharacteristicNotification(ch, true)) return fail("notify")
                val cccd = ch.getDescriptor(CCCD) ?: return fail("notify")
                // 只调 setCharacteristicNotification 不会让耳机开始推数据，必须自己写 CCCD
                val value = if ((ch.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0) {
                    BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                } else {
                    BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
                }
                val ok = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    g.writeDescriptor(cccd, value) == BluetoothStatusCodes.SUCCESS
                } else {
                    @Suppress("DEPRECATION")
                    cccd.value = value
                    @Suppress("DEPRECATION")
                    g.writeDescriptor(cccd)
                }
                if (!ok) {
                    Diag.add("bt", "cccd 写入调用失败 uuid=${ch.uuid} props=${ch.properties}")
                    fail("notify")
                }
            }

            override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
                if (mine != gen || g !== gatt) return
                if (descriptor.uuid != CCCD) return
                log("cccd write status=$status")
                if (status != BluetoothGatt.GATT_SUCCESS) return fail("notify")
                ready = true
                connected(device.name ?: "Bose", "ble", mine)
            }

            override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic, value: ByteArray) {
                if (mine != gen) return
                if (g === gatt) event("onDataReceived", mine, bytesToHex(value))
            }

            @Deprecated("Deprecated in Java")
            @Suppress("DEPRECATION")
            override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic) {
                if (mine != gen) return
                val value = ch.value ?: return
                if (g === gatt) event("onDataReceived", mine, bytesToHex(value))
            }

            override fun onCharacteristicWrite(g: BluetoothGatt, ch: BluetoothGattCharacteristic, status: Int) {
                main.post {
                    if (mine != gen || g !== gatt) return@post
                    writingGatt = false
                    if (status != BluetoothGatt.GATT_SUCCESS) {
                        log("gatt write 失败 status=$status（session=$session）")
                        gattWrites.clear()
                        fail("write", mine)
                    } else flushGatt()
                }
            }
        }
        gatt = runCatching {
            device.connectGatt(activity, false, cb, BluetoothDevice.TRANSPORT_LE, BluetoothDevice.PHY_LE_1M_MASK, main)
        }.onFailure { log("connectGatt threw ${it.message}") }.getOrNull()
        if (gatt == null) fail("connect")
    }

    // 串口写必须按顺序，每次开一个线程会把两帧写岔，所以固定一个写线程排队
    private val sppWriter = java.util.concurrent.Executors.newSingleThreadExecutor()

    private fun write(bytes: ByteArray) {
        val socket = spp
        val mine = gen
        if (socket?.isConnected == true) {
            sppWriter.execute {
                try {
                    if (mine != gen) return@execute
                    socket.outputStream.write(bytes)
                    socket.outputStream.flush()
                    log("spp write ${bytes.size}B")
                } catch (error: Exception) {
                    Diag.add("bt", "spp write 失败 ${error.message}")
                    fail("write", mine)
                }
            }
            return
        }
        gattWrites.addLast(bytes)
        flushGatt()
    }

    private fun flushGatt() {
        if (writingGatt || gattWrites.isEmpty()) return
        val ch = writeChar ?: return fail("write")
        val g = gatt ?: return fail("write")
        val bytes = gattWrites.removeFirst()
        writingGatt = true
        val type = if ((ch.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) {
            BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        } else {
            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        }
        val ok = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            g.writeCharacteristic(ch, bytes, type) == BluetoothStatusCodes.SUCCESS
        } else {
            @Suppress("DEPRECATION")
            ch.value = bytes
            @Suppress("DEPRECATION")
            ch.writeType = type
            @Suppress("DEPRECATION")
            g.writeCharacteristic(ch)
        }
        if (!ok) {
            writingGatt = false
            gattWrites.clear()
            fail("write")
        }
    }

    // GATT 连不上时（典型是耳机正连着手机，BLE 通道被占），退到已配对设备的 RFCOMM
    private fun fallback(mine: Int) {
        if (mine != gen) return
        val previous = gatt
        gatt = null
        writeChar = null
        runCatching { previous?.close() }
        val ad = adapter
        if (!sppTried && ad != null && ad.bondedDevices?.any {
            if (wantAddress != null) it.address.equals(wantAddress, ignoreCase = true) else isBose(it.name ?: "")
        } == true) {
            log("gatt unusable, fall back to rfcomm")
            trySpp(ad, mine)
        } else {
            fail("connect")
        }
    }

    /** 页面指定了设备和端口，按顺序试：品牌服务 UUID 优先，再标准 SPP UUID，最后按端口号反射打开。 */
    private fun openSpp(ad: BluetoothAdapter, address: String, mine: Int) {
        val device = ad.getRemoteDevice(address)
        val services = wantServices.toList()
        val channels = wantChannels.toList()
        Thread {
            val sockets = mutableListOf<BluetoothSocket>()
            for (uuid in services) {
                runCatching { sockets.add(device.createInsecureRfcommSocketToServiceRecord(UUID.fromString(uuid))) }
            }
            runCatching { sockets.add(device.createInsecureRfcommSocketToServiceRecord(SPP_UUID)) }
            for (channel in channels) {
                runCatching {
                    val method = device.javaClass.getMethod("createInsecureRfcommSocket", Int::class.javaPrimitiveType!!)
                    val sock = method.invoke(device, channel) as BluetoothSocket
                    sockets.add(sock)
                }
            }
            log("spp 候选 ${sockets.size} 个（服务 ${services.size} / 端口 ${channels.joinToString(",")}）")
            for (sock in sockets) {
                try {
                    if (!trackOpening(sock, mine)) { sock.close(); return@Thread }
                    sock.connect()
                    log("spp connected ${sock.remoteDevice.address}")
                    synchronized(this) { if (openingSocket === sock) openingSocket = null }
                    if (mine != gen) {
                        runCatching { sock.close() }
                        return@Thread
                    }
                    main.post {
                        if (mine != gen) { runCatching { sock.close() }; return@post }
                        spp = sock
                        link = "spp"
                        connected(device.name ?: "耳机", "spp", mine)
                        sppThread = Thread { readSpp(sock, mine) }.also { it.start() }
                    }
                    return@Thread
                } catch (error: Exception) {
                    log("spp 端口失败 ${error.message}")
                    runCatching { sock.close() }
                }
            }
            if (mine == gen) fail("spp", mine)
        }.start()
    }

    private fun trySpp(ad: BluetoothAdapter, mine: Int) {
        sppTried = true
        val bonded = ad.bondedDevices?.firstOrNull {
            if (wantAddress != null) it.address.equals(wantAddress, ignoreCase = true) else isBose(it.name ?: "")
        } ?: return fail("none", mine)
        Thread {
            try {
                val sock = bonded.createInsecureRfcommSocketToServiceRecord(SPP_UUID)
                if (!trackOpening(sock, mine)) { sock.close(); return@Thread }
                sock.connect()
                synchronized(this) { if (openingSocket === sock) openingSocket = null }
                if (mine != gen) {
                    runCatching { sock.close() }
                    return@Thread
                }
                main.post {
                    if (mine != gen) { runCatching { sock.close() }; return@post }
                    spp = sock
                    link = "spp"
                    connected(bonded.name ?: "Bose", "spp", mine)
                    sppThread = Thread { readSpp(sock, mine) }.also { it.start() }
                }
            } catch (error: Exception) {
                main.post {
                    if (mine != gen) return@post
                    log("rfcomm failed ${error.message}, try target gatt")
                    runCatching { openingSocket?.close() }
                    openingSocket = null
                    connectGatt(bonded, mine)
                }
            }
        }.start()
    }

    private fun readSpp(sock: BluetoothSocket, mine: Int) {
        val buf = ByteArray(512)
        try {
            while (true) {
                val n = sock.inputStream.read(buf)
                if (n <= 0) break
                log("spp read ${n}B")
                event("onDataReceived", mine, bytesToHex(buf.copyOf(n)))
            }
        } catch (error: Exception) {
            log("spp read 中断 ${error.message}")
        }
        event("onNativeDisconnected", mine)
    }

    private fun connected(name: String, kind: String, mine: Int) {
        event("onNativeConnected", mine, org.json.JSONObject().put("name", name).put("link", kind))
    }

    fun fail(msg: String, mine: Int = gen) {
        if (mine != gen) return
        log("fail $msg")
        event("onNativeError", mine, msg)
    }

    private fun event(name: String, mine: Int, vararg values: Any) {
        main.post {
            if (mine != gen) return@post
            val args = org.json.JSONArray()
            values.forEach { args.put(it) }
            args.put(session)
            web.evaluateJavascript("$name(...$args)", null)
        }
    }

    @Synchronized
    private fun trackOpening(socket: BluetoothSocket, mine: Int): Boolean {
        if (mine != gen) return false
        openingSocket = socket
        return true
    }

    @Synchronized
    private fun close() {
        gen += 1
        gattWrites.clear()
        writingGatt = false
        scanTimeout?.let { main.removeCallbacks(it) }
        scanTimeout = null
        scanCallback?.let { cb -> runCatching { adapter?.bluetoothLeScanner?.stopScan(cb) } }
        scanCallback = null
        runCatching { openingSocket?.close() }
        openingSocket = null
        runCatching { spp?.close() }
        spp = null
        sppThread = null
        runCatching { gatt?.disconnect() }
        runCatching { gatt?.close() }
        gatt = null
        writeChar = null
    }

    private fun js(code: String) {
        main.post { runCatching { web.evaluateJavascript(code, null) } }
    }

    private fun log(line: String) {
        Diag.add("bt", line)
    }

    companion object {
        private const val TAG = "BOSE"
        private val CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        private val SVC_SIG = UUID.fromString("0000febe-0000-1000-8000-00805f9b34fb")
        private val SVC_APK = UUID.fromString("0000febe-0000-0000-0000-000000000000")
        private val CHAR_SECURE = UUID.fromString("c65b8f2f-aee2-4c89-b758-bc4892d6f2d8")
        private val CHAR_PLAIN = UUID.fromString("d417c028-9818-4354-99d1-2ac09d074591")
        private val SPP_UUID = UUID.fromString("00000000-deca-fade-deca-deafdecacaff")

        fun isBose(name: String): Boolean {
            val n = name.lowercase()
            return n.startsWith("bose") || n.startsWith("le-bose") || n.startsWith("qc") ||
                n.startsWith("quietcomfort") || n.startsWith("soundlink") || n.contains("bose")
        }

        fun bytesToHex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

        fun hexToBytes(hex: String): ByteArray {
            val s = hex.filter { it in "0123456789abcdefABCDEF" }
            return ByteArray(s.length / 2) { i ->
                s.substring(i * 2, i * 2 + 2).toInt(16).toByte()
            }
        }
    }
}

/** 全流程日志：logcat 一行 + 环形缓冲，导出诊断时整段带走。 */
object Diag {
    private const val TAG = "BOSE"
    private const val MAX_MEMORY = 2000

    private val memory = ArrayDeque<String>(MAX_MEMORY)
    private val memoryLock = Any()
    private val executor = java.util.concurrent.Executors.newSingleThreadExecutor { r ->
        Thread(r, "diag-writer")
    }
    private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US)

    @Volatile private var runId = ""
    @Volatile private var health = "not-started"
    @Volatile private var writeFailures = 0
    private var dir: File? = null
    private var stream: java.io.FileOutputStream? = null
    private var fileBytes = 0L
    private var fileSeq = 0
    private var maxFileBytes = 1L shl 20
    private var maxTotalBytes = 10L shl 20
    private var maxAgeDays = 7
    private var started = false

    /** 启动最早处调用一次：建目录、清过期、开文件、写 run-start */
    @Synchronized
    fun start(context: android.content.Context) {
        if (started) return
        started = true
        runId = "${System.currentTimeMillis() / 1000}-${android.os.Process.myPid()}"
        val target = dir ?: File(File(context.filesDir, "diagnostics"), "logs")
        executor.execute {
            try {
                target.mkdirs()
                dir = target
                removeExpired()
                openNextFile()
                health = "ok"
            } catch (e: Exception) {
                health = "write-failed: ${e.javaClass.simpleName}: ${e.message}"
            }
            append(
                mapOf(
                    "source" to "native", "stage" to "A", "event" to "run-start",
                    "level" to "info", "detail" to systemInfo(context),
                ),
            )
        }
    }

    fun add(scope: String, message: String) {
        Log.d(TAG, "$scope $message")
        synchronized(memoryLock) {
            if (memory.size >= MAX_MEMORY) memory.removeFirst()
            memory.addLast("$scope $message")
        }
        append(mapOf("source" to "native", "stage" to "G", "event" to scope,
            "level" to "info", "detail" to message))
    }

    /** 页面把结构化事件送进来（JSON 字符串） */
    fun pageEvent(json: String) {
        val parsed = runCatching { org.json.JSONObject(json) }.getOrNull()
        if (parsed == null) {
            append(mapOf("source" to "page", "stage" to "I", "event" to "bad-payload",
                "level" to "error", "detail" to json.take(200)))
            return
        }
        val map = mutableMapOf<String, Any?>()
        parsed.keys().forEach { key -> map[key] = parsed.opt(key) }
        map["source"] = "page"
        append(map)
    }

    fun dump(): String = synchronized(memoryLock) { memory.joinToString("\n") }

    fun infoJson(): String = org.json.JSONObject()
        .put("runId", runId)
        .put("dir", dir?.absolutePath ?: "")
        .put("health", health)
        .put("writeFailures", writeFailures)
        .put("files", listFiles().joinToString(",") { it.name })
        .toString()

    /** 写盘队列排空后读一致快照：只读磁盘；写盘失败时才把内存兜底附上 */
    fun exportTextSync(header: List<String>): String {
        val future = executor.submit<String> {
            val files = listFiles()
            val lines = mutableListOf<String>()
            var corrupt = 0
            for (file in files) {
                runCatching {
                    file.forEachLine { line ->
                        if (line.isBlank()) return@forEachLine
                        val ok = runCatching { org.json.JSONObject(line) }.isSuccess
                        if (ok) lines.add(line) else corrupt++
                    }
                }
            }
            val meta = listOf(
                "runId=$runId",
                "dir=${dir?.absolutePath ?: ""}",
                "health=$health",
                "writeFailures=$writeFailures",
                "files=${files.size}",
                "bytes=${files.sumOf { it.length() }}",
                "retention=maxFile=${maxFileBytes}B total=${maxTotalBytes}B age=${maxAgeDays}d",
                "corruptLines=$corrupt",
                "memoryFallback=${if (health == "ok") "not-used" else "recent ${synchronized(memoryLock) { memory.size }} lines kept in memory only"}",
            )
            val out = mutableListOf<String>()
            out.addAll(header)
            out.addAll(meta)
            out.add("")
            out.add("==== 持久日志（JSONL，按时间顺序） ====")
            out.addAll(lines)
            if (health != "ok") {
                out.add("")
                out.add("==== 仅供兜底的内存日志（未持久化） ====")
                out.addAll(synchronized(memoryLock) { memory.toList() })
            }
            out.joinToString("\n")
        }
        return runCatching { future.get(5, java.util.concurrent.TimeUnit.SECONDS) }
            .getOrElse { (header + "（读取持久日志失败：${it.message}）").joinToString("\n") }
    }

    fun systemInfo(context: android.content.Context?): String {
        val pkg = context?.packageManager?.let {
            runCatching { it.getPackageInfo(context.packageName, 0) }.getOrNull()
        }
        val version = pkg?.versionName ?: "?"
        return "Android ${Build.VERSION.RELEASE} (sdk ${Build.VERSION.SDK_INT}) / " +
            "${Build.MANUFACTURER} ${Build.MODEL} / app $version"
    }

    private fun append(dict: Map<String, Any?>) {
        executor.execute { appendLocked(dict) }
    }

    private fun appendLocked(dict: Map<String, Any?>) {
        val record = org.json.JSONObject()
        runCatching {
            dict.forEach { (k, v) -> if (v != null) record.put(k, v) }
            record.put("timestamp", iso.format(Date()))
            record.put("runId", runId)
        }.onFailure { return }
        val line = record.toString() + "\n"
        val out = stream
        if (out == null) {
            writeFailures++
            health = "write-failed: no stream"
            return
        }
        runCatching {
            out.write(line.toByteArray())
            out.flush()
            fileBytes += line.toByteArray().size
            if (fileBytes >= maxFileBytes) rotate()
        }.onFailure { e ->
            writeFailures++
            health = "write-failed: ${e.javaClass.simpleName}: ${e.message}"
            Log.e(TAG, "日志写盘失败 ${e.message}")
        }
    }

    private fun openNextFile() {
        val base = dir ?: return
        fileSeq++
        val file = File(base, String.format(Locale.US, "diag-%s-%03d.jsonl", runId, fileSeq))
        stream = java.io.FileOutputStream(file, true)
        fileBytes = file.length()
    }

    private fun rotate() {
        runCatching { stream?.close() }
        stream = null
        openNextFile()
        removeExpired()
    }

    private fun listFiles(): List<File> {
        val base = dir ?: return emptyList()
        return base.listFiles { f -> f.isFile && f.name.endsWith(".jsonl") }
            ?.sortedBy { it.lastModified() } ?: emptyList()
    }

    /** 只清理本目录的 jsonl：先按天数，再按总量淘汰最旧 */
    private fun removeExpired() {
        var files = listFiles()
        if (maxAgeDays >= 0) {
            val cutoff = System.currentTimeMillis() - maxAgeDays * 86400_000L
            files.filter { it.lastModified() < cutoff }.forEach { it.delete() }
            files = listFiles()
        }
        while (files.sumOf { it.length() } > maxTotalBytes && files.isNotEmpty()) {
            files.first().delete()
            files = files.drop(1)
        }
    }
}
