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
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
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
    private var gen = 0
    private var scanCallback: ScanCallback? = null
    private var scanTimeout: Runnable? = null

    @JavascriptInterface
    fun bleScan() {
        main.post { activity.requestBtThenScan() }
    }

    @JavascriptInterface
    fun sendData(hex: String) {
        val bytes = hexToBytes(hex)
        main.post { write(bytes) }
    }

    @JavascriptInterface
    fun bleDisconnect() {
        main.post { close() }
    }

    fun scanInternal() {
        val ad = adapter ?: return fail("adapter")
        if (!ad.isEnabled) return fail("off")
        close()
        val mine = ++gen
        val mgr = activity.getSystemService(BluetoothManager::class.java)
        // 已经连在系统上的耳机不会广播，先直接拿现成的 GATT 连接
        val already = mgr?.getConnectedDevices(BluetoothProfile.GATT).orEmpty()
            .firstOrNull { isBose(it.name ?: "") }
        if (already != null) {
            log("gatt already connected: ${already.name}")
            connectGatt(already, mine)
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
                if (settled) return
                val device = result.device
                val name = result.scanRecord?.deviceName ?: device.name ?: return
                if (!isBose(name)) return
                log("found $name")
                seen[device.address] = device
                settle()
                connectGatt(device, mine)
            }

            override fun onScanFailed(errorCode: Int) {
                log("scan failed $errorCode")
                settle()
                fail("scan")
            }
        }
        scanCallback = cb
        runCatching { scanner.startScan(cb) }.onFailure {
            log("startScan threw ${it.message}")
            settle()
            return fail("scan")
        }

        val timeout = Runnable {
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
            if (mine == gen && !ready) {
                log("connect timeout")
                fallback(mine)
            }
        }, 15000)
        fun discover(g: BluetoothGatt) {
            if (discovered || mine != gen) return
            discovered = true
            g.discoverServices()
        }
        val cb = object : BluetoothGattCallback() {
            override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
                if (mine != gen) {
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
                        js("onNativeDisconnected()")
                    } else {
                        fallback(mine)
                    }
                }
            }

            override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
                if (mine != gen) return
                log("mtu=$mtu status=$status")
                discover(g)
            }

            override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
                if (mine != gen) return
                if (status != BluetoothGatt.GATT_SUCCESS) return fail("service")
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
                if (!ok) fail("notify")
            }

            override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
                if (mine != gen) return
                if (descriptor.uuid != CCCD) return
                log("cccd write status=$status")
                if (status != BluetoothGatt.GATT_SUCCESS) return fail("notify")
                ready = true
                connected(device.name ?: "Bose", "ble")
            }

            override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic, value: ByteArray) {
                if (mine != gen) return
                js("onDataReceived('${bytesToHex(value)}')")
            }

            @Deprecated("Deprecated in Java")
            @Suppress("DEPRECATION")
            override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic) {
                if (mine != gen) return
                val value = ch.value ?: return
                js("onDataReceived('${bytesToHex(value)}')")
            }

            override fun onCharacteristicWrite(g: BluetoothGatt, ch: BluetoothGattCharacteristic, status: Int) {
                if (mine != gen) return
                if (status != BluetoothGatt.GATT_SUCCESS) log("write failed status=$status")
            }
        }
        gatt = runCatching {
            device.connectGatt(activity, false, cb, BluetoothDevice.TRANSPORT_LE)
        }.onFailure { log("connectGatt threw ${it.message}") }.getOrNull()
        if (gatt == null) fail("connect")
    }

    private fun write(bytes: ByteArray) {
        val socket = spp
        if (socket?.isConnected == true) {
            Thread {
                try {
                    socket.outputStream.write(bytes)
                    socket.outputStream.flush()
                } catch (_: Exception) {
                    fail("write")
                }
            }.start()
            return
        }
        val ch = writeChar ?: return fail("write")
        val g = gatt ?: return fail("write")
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
        if (!ok) fail("write")
    }

    // GATT 连不上时（典型是耳机正连着手机，BLE 通道被占），退到已配对设备的 RFCOMM
    private fun fallback(mine: Int) {
        if (mine != gen) return
        runCatching { gatt?.close() }
        gatt = null
        writeChar = null
        val ad = adapter
        if (ad != null && ad.bondedDevices?.any { isBose(it.name ?: "") } == true) {
            log("gatt unusable, fall back to rfcomm")
            trySpp(ad, mine)
        } else {
            fail("connect")
        }
    }

    private fun trySpp(ad: BluetoothAdapter, mine: Int) {
        val bonded = ad.bondedDevices?.firstOrNull { isBose(it.name ?: "") }
            ?: return fail("none")
        Thread {
            try {
                val sock = bonded.createInsecureRfcommSocketToServiceRecord(SPP_UUID)
                sock.connect()
                if (mine != gen) {
                    runCatching { sock.close() }
                    return@Thread
                }
                spp = sock
                link = "spp"
                sppThread = Thread { readSpp(sock, mine) }.also { it.start() }
                connected(bonded.name ?: "Bose", "spp")
            } catch (_: Exception) {
                fail("spp")
            }
        }.start()
    }

    private fun readSpp(sock: BluetoothSocket, mine: Int) {
        val buf = ByteArray(512)
        try {
            while (true) {
                val n = sock.inputStream.read(buf)
                if (n <= 0) break
                js("onDataReceived('${bytesToHex(buf.copyOf(n))}')")
            }
        } catch (_: Exception) {
        }
        if (mine == gen) js("onNativeDisconnected()")
    }

    private fun connected(name: String, kind: String) {
        val safe = name.replace("'", "\\'")
        js("onNativeConnected('{\"name\":\"$safe\",\"link\":\"$kind\"}')")
    }

    fun fail(msg: String) {
        log("fail $msg")
        js("onNativeError('$msg')")
    }

    private fun close() {
        gen += 1
        scanTimeout?.let { main.removeCallbacks(it) }
        scanTimeout = null
        scanCallback?.let { cb -> runCatching { adapter?.bluetoothLeScanner?.stopScan(cb) } }
        scanCallback = null
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
        Log.i(TAG, line)
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
