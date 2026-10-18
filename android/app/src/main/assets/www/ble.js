import { createReassembler, decodeAll, keyOf, segment } from "./bmap.js";
import { fromHex, hasNative, nativeCall, toHex } from "./native.js";

export const BMAP_SERVICE = "0000febe-0000-1000-8000-00805f9b34fb";
export const BMAP_SERVICE_APK = "0000febe-0000-0000-0000-000000000000";
export const CHAR_SECURE = "c65b8f2f-aee2-4c89-b758-bc4892d6f2d8";
export const CHAR_PLAIN = "d417c028-9818-4354-99d1-2ac09d074591";

const SERVICES = [BMAP_SERVICE, BMAP_SERVICE_APK];

const NAME_FILTERS = [
  { namePrefix: "Bose" },
  { namePrefix: "LE-Bose" },
  { namePrefix: "LE-QC" },
  { namePrefix: "QC" },
  { namePrefix: "QuietComfort" },
  { namePrefix: "SoundLink" },
  { services: [BMAP_SERVICE] },
  { services: [BMAP_SERVICE_APK] },
];

export class BoseBle {
  constructor() {
    this.device = null;
    this.server = null;
    this.char = null;
    this.link = "ble";
    this.nativeOn = false;
    this.reassembler = createReassembler();
    this.pending = new Map();
    this.onPacket = null;
    this.onDisconnected = null;
    this.lastError = "";
    this._gate = Promise.resolve();
    this._bindNative();
  }

  get connected() {
    if (this.nativeOn) return this.nativeOn;
    return Boolean(this.server?.connected && this.char);
  }

  get name() {
    return this.device?.name ?? "";
  }

  _bindNative() {
    window.onDataReceived = (hex) => {
      const bytes = fromHex(String(hex));
      if (this.link === "spp") {
        this.handleNotify(bytes, true);
      } else {
        this.handleNotify(bytes, false);
      }
    };
    window.onNativeConnected = (info) => {
      const data = typeof info === "string" ? JSON.parse(info || "{}") : info || {};
      this.nativeOn = true;
      this.link = data.link === "spp" ? "spp" : "ble";
      this.device = { name: data.name || "Bose" };
      this._connectWait?.resolve();
      this._connectWait = null;
    };
    window.onNativeDisconnected = () => {
      this.nativeOn = false;
      this.char = null;
      this.server = null;
      this.rejectAll(new Error("蓝牙已断开"));
      this._connectWait?.reject(new Error("蓝牙已断开"));
      this._connectWait = null;
      this.onDisconnected?.();
    };
    window.onNativeError = (msg) => {
      this.lastError = String(msg || "native error");
      this._connectWait?.reject(new Error(this.lastError));
      this._connectWait = null;
    };
  }

  async connect({ acceptAll = false } = {}) {
    if (hasNative()) {
      this.reassembler = createReassembler();
      this.lastError = "";
      await new Promise((resolve, reject) => {
        // 原生端可能永远不回包（权限弹窗被系统吞掉、扫描被拦），超时就得放行重试
        const timer = setTimeout(() => {
          if (!this._connectWait) return;
          this._connectWait = null;
          this.lastError = "timeout";
          try {
            nativeCall("bleDisconnect");
          } catch {
            /* ignore */
          }
          reject(new Error("timeout"));
        }, 30000);
        this._connectWait = {
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          },
        };
        try {
          nativeCall("bleScan");
        } catch (err) {
          this._connectWait = null;
          clearTimeout(timer);
          reject(err);
        }
      });
      return;
    }
    if (!navigator.bluetooth) {
      throw new Error("当前浏览器没有 Web Bluetooth。请用 Android Chrome。");
    }
    const options = acceptAll
      ? { acceptAllDevices: true, optionalServices: SERVICES }
      : { filters: NAME_FILTERS, optionalServices: SERVICES };
    const device = await navigator.bluetooth.requestDevice(options);
    device.addEventListener("gattserverdisconnected", () => {
      this.char = null;
      this.server = null;
      this.rejectAll(new Error("蓝牙已断开"));
      this.onDisconnected?.();
    });
    const server = await device.gatt.connect();
    const service = await this.openService(server);
    const char = await this.openCharacteristic(service);
    await char.startNotifications();
    char.addEventListener("characteristicvaluechanged", (ev) => {
      this.handleNotify(new Uint8Array(ev.target.value.buffer));
    });
    this.device = device;
    this.server = server;
    this.char = char;
  }

  async openService(server) {
    try {
      return await server.getPrimaryService(BMAP_SERVICE_APK);
    } catch {
      return await server.getPrimaryService(BMAP_SERVICE);
    }
  }

  async openCharacteristic(service) {
    try {
      return await service.getCharacteristic(CHAR_SECURE);
    } catch {
      return await service.getCharacteristic(CHAR_PLAIN);
    }
  }

  disconnect() {
    if (hasNative()) {
      try {
        nativeCall("bleDisconnect", {});
      } catch {
        /* ignore */
      }
      this.nativeOn = false;
      return;
    }
    try {
      this.device?.gatt?.disconnect();
    } catch {
      /* already gone */
    }
    this.char = null;
    this.server = null;
  }

  handleNotify(chunk, raw = false) {
    const assembled = raw ? chunk : this.reassembler.push(chunk);
    if (!assembled) return;
    const packets = decodeAll(assembled);
    for (const packet of packets) {
      this.onPacket?.(packet);
      const waiters = this.pending.get(keyOf(packet));
      if (!waiters?.length) continue;
      if (packet.op === 7) continue;
      waiters.shift().resolve(packet);
      if (!waiters.length) this.pending.delete(keyOf(packet));
    }
  }

  async write(packetBytes) {
    const chunks = this.link === "spp" ? [packetBytes] : segment(packetBytes);
    if (hasNative() && this.nativeOn) {
      for (const chunk of chunks) nativeCall("sendData", toHex(chunk));
      return;
    }
    if (!this.char) throw new Error("未连接");
    for (const chunk of chunks) {
      const buf = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
      if (this.char.properties.writeWithoutResponse) {
        await this.char.writeValueWithoutResponse(buf);
      } else {
        await this.char.writeValue(buf);
      }
    }
  }

  request(packetBytes, timeoutMs = 2500) {
    const run = () => this._requestOnce(packetBytes, timeoutMs);
    const p = this._gate.then(run, run);
    this._gate = p.then(
      () => {},
      () => {},
    );
    return p;
  }

  _requestOnce(packetBytes, timeoutMs) {
    const header = decodeAll(packetBytes)[0];
    if (!header) return Promise.reject(new Error("空数据包"));
    const key = keyOf(header);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const list = this.pending.get(key) ?? [];
        this.pending.set(
          key,
          list.filter((item) => item.reject !== fail),
        );
        fail(new Error(`超时 ${key}`));
      }, timeoutMs);
      const fail = (err) => {
        clearTimeout(timer);
        reject(err);
      };
      const ok = (packet) => {
        clearTimeout(timer);
        resolve(packet);
      };
      const list = this.pending.get(key) ?? [];
      list.push({ resolve: ok, reject: fail });
      this.pending.set(key, list);
      this.write(packetBytes).catch(fail);
    });
  }

  rejectAll(err) {
    for (const list of this.pending.values()) {
      for (const item of list) item.reject(err);
    }
    this.pending.clear();
  }
}
