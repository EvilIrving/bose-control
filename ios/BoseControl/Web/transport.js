import { fromHex, hasNative, nativeCall, toHex } from "./native.js";

// 只管「把字节送出去、把回包收回来」，具体怎么切包、怎么认出同一命令由 codec 决定：
//   { id, filters, services, reset(), chunks(bytes, link), parse(chunk, link), key(packet), header(bytes) }
export class HeadsetLink {
  constructor(codec) {
    this.codec = codec;
    this.device = null;
    this.server = null;
    this.char = null;
    this.link = "ble";
    this.nativeOn = false;
    this.pending = new Map();
    this.onPacket = null;
    this.onDisconnected = null;
    this.lastError = "";
    this._gate = Promise.resolve();
    this._bindNative();
  }

  use(codec) {
    this.codec = codec;
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
      this.handleNotify(fromHex(String(hex)));
    };
    window.onNativeConnected = (info) => {
      const data = typeof info === "string" ? JSON.parse(info || "{}") : info || {};
      this.nativeOn = true;
      this.link = data.link === "spp" ? "spp" : "ble";
      this.device = { name: data.name || "" };
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
    this.codec.reset?.();
    if (hasNative()) {
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
          // 只有非默认品牌才把品牌传给原生端，老桥不认参数就不会被调到
          if (this.codec.id === "bose") nativeCall("bleScan");
          else nativeCall("bleScan", { brand: this.codec.id });
        } catch (err) {
          this._connectWait = null;
          clearTimeout(timer);
          reject(err);
        }
      });
      return;
    }
    if (!this.codec.ble) throw new Error("这里连不了：" + this.codec.id);
    if (!navigator.bluetooth) {
      throw new Error("当前浏览器没有 Web Bluetooth。请用 Android Chrome。");
    }
    const options = acceptAll
      ? { acceptAllDevices: true, optionalServices: this.codec.services }
      : { filters: this.codec.filters, optionalServices: this.codec.services };
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
    for (const uuid of this.codec.services) {
      try {
        return await server.getPrimaryService(uuid);
      } catch {
        /* 试下一个 */
      }
    }
    throw new Error("no service");
  }

  async openCharacteristic(service) {
    for (const uuid of this.codec.chars ?? []) {
      try {
        return await service.getCharacteristic(uuid);
      } catch {
        /* 试下一个 */
      }
    }
    throw new Error("no characteristic");
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

  handleNotify(chunk) {
    for (const packet of this.codec.parse(chunk, this.link)) {
      this.onPacket?.(packet);
      const key = this.codec.key(packet);
      const waiters = this.pending.get(key);
      if (!waiters?.length) continue;
      waiters.shift().resolve(packet);
      if (!waiters.length) this.pending.delete(key);
    }
  }

  async write(packetBytes) {
    const chunks = this.codec.chunks(packetBytes, this.link);
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
    const header = this.codec.header(packetBytes);
    if (!header) return Promise.reject(new Error("空数据包"));
    const key = this.codec.key(header);
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
