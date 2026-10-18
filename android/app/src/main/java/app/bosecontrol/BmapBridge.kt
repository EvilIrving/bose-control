package app.bosecontrol

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothSocket
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.os.Handler
import android.os.Looper
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

    @JavascriptInterface
    fun bleScan() {
        main.post { activity.requestBtThenScan() }
    }

    @JavascriptInterface
    fun sendData(hex: String) {
        val bytes = hexToBytes(hex)
        main.post {
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
                return@post
            }
            val ch = writeChar ?: return@post fail("write")
            val g = gatt ?: return@post fail("write")
            ch.value = bytes
            g.writeCharacteristic(ch)
        }
    }

    @JavascriptInterface
    fun bleDisconnect() {
        main.post { close() }
    }

    fun scanInternal() {
        val ad = adapter ?: return fail("adapter")
        close()
        val mgr = activity.getSystemService(BluetoothManager::class.java)
        val already = mgr?.getConnectedDevices(BluetoothProfile.GATT).orEmpty()
            .firstOrNull { isBose(it.name ?: "") }
        if (already != null) {
            connectGatt(already)
            return
        }
        val bonded = ad.bondedDevices?.firstOrNull { isBose(it.name ?: "") }
        val seen = LinkedHashMap<String, BluetoothDevice>()
        if (bonded != null) seen[bonded.address] = bonded
        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val d = result.device
                val name = d.name ?: return
                if (!isBose(name)) return
                seen[d.address] = d
                ad.bluetoothLeScanner?.stopScan(this)
                main.removeCallbacksAndMessages(null)
                connectGatt(d)
            }
        }
        ad.bluetoothLeScanner?.startScan(cb)
        main.postDelayed({
            ad.bluetoothLeScanner?.stopScan(cb)
            val device = seen.values.firstOrNull()
            if (device == null) {
                trySpp(ad)
            } else {
                connectGatt(device)
            }
        }, 8000)
    }

    private fun connectGatt(device: BluetoothDevice) {
        link = "ble"
        gatt = device.connectGatt(activity, false, object : BluetoothGattCallback() {
            override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    g.discoverServices()
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    js("onNativeDisconnected()")
                }
            }

            override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
                val svc = g.getService(SVC_APK) ?: g.getService(SVC_SIG) ?: return fail("service")
                val ch = svc.getCharacteristic(CHAR_SECURE)
                    ?: svc.getCharacteristic(CHAR_PLAIN)
                    ?: return fail("char")
                writeChar = ch
                g.setCharacteristicNotification(ch, true)
                connected(device.name ?: "Bose", "ble")
            }

            override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic) {
                val hex = bytesToHex(ch.value ?: return)
                js("onDataReceived('$hex')")
            }
        })
    }

    private fun trySpp(ad: BluetoothAdapter) {
        val bonded = ad.bondedDevices?.firstOrNull { isBose(it.name ?: "") }
            ?: return fail("none")
        Thread {
            try {
                val sock = bonded.createInsecureRfcommSocketToServiceRecord(SPP_UUID)
                sock.connect()
                spp = sock
                link = "spp"
                sppThread = Thread { readSpp(sock) }.also { it.start() }
                connected(bonded.name ?: "Bose", "spp")
            } catch (_: Exception) {
                fail("spp")
            }
        }.start()
    }

    private fun readSpp(sock: BluetoothSocket) {
        val buf = ByteArray(512)
        try {
            while (true) {
                val n = sock.inputStream.read(buf)
                if (n <= 0) break
                val hex = bytesToHex(buf.copyOf(n))
                js("onDataReceived('$hex')")
            }
        } catch (_: Exception) {
        }
        js("onNativeDisconnected()")
    }

    private fun connected(name: String, kind: String) {
        val safe = name.replace("'", "\\'")
        js("onNativeConnected('{\"name\":\"$safe\",\"link\":\"$kind\"}')")
    }

    fun fail(msg: String) {
        js("onNativeError('$msg')")
    }

    private fun close() {
        try {
            spp?.close()
        } catch (_: Exception) {
        }
        spp = null
        try {
            gatt?.close()
        } catch (_: Exception) {
        }
        gatt = null
        writeChar = null
    }

    private fun js(code: String) {
        main.post { web.evaluateJavascript(code, null) }
    }

    companion object {
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
