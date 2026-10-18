import { LocalBridge } from "./bridge.js";
import { fromHex, hasNative, nativeCall, toHex } from "./native.js";

// 同时最多几条请求在途。耳机对同一条命令只回一个包，所以窗口不能开太大，
// 4 条足够把一次启动里几十条独立读取压成几轮往返，又不至于灌满蓝牙写队列。
const MAX_IN_FLIGHT = 4;

// 只管「把字节送出去、把回包收回来」，具体怎么切包、怎么认出同一命令由 codec 决定：
//   { id, filters, services, reset(), chunks(bytes, link), parse(chunk, link), key(packet), header(bytes) }
export class HeadsetLink {
  constructor(codec) {
    this.codec = codec;
    this.device = null;
    this.server = null;
    this.char = null;
    this.bridge = null;
    this.link = "ble";
    this.nativeOn = false;
    this.pending = new Map();
    this.onPacket = null;
    this.onDisconnected = null;
    this.lastError = "";
    this._queue = [];
    this._inFlight = 0;
    this._activeKeys = new Set();
    this._bindNative();
  }

  use(codec) {
    this.codec = codec;
  }

  get connected() {
    if (this.bridge) return this.bridge.open;
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
      // 这条只会在连接失败时来（原生端连上之后才上报 onNativeConnected），
      // 不清掉的话界面会一直显示「断开连接」而实际没有会话。
      this.nativeOn = false;
      this._connectWait?.reject(new Error(this.lastError));
      this._connectWait = null;
    };
  }

  async connect({ acceptAll = false, address = null, transport = null, channels = [], services = [] } = {}) {
    this.codec.reset?.();
    // 上一台的设备和连接状态不能带进这一台：原生端连接的第一件事也是先断开，
    // 留着旧值会让标题先显示上一台的名字、界面上写着「已连接」。
    this.device = null;
    this.nativeOn = false;
    // 浏览器里没有原生桥，串口只能交给本机 server.py 代开
    if (transport === "spp" && !hasNative()) {
      const bridge = new LocalBridge();
      bridge.onData = (bytes) => this.handleNotify(bytes);
      bridge.onClose = () => {
        this.bridge = null;
        this.rejectAll(new Error("蓝牙已断开"));
        this.onDisconnected?.();
      };
      await bridge.connect({ address, channels: channels.length ? channels : [1, 2, 3], services });
      this.bridge = bridge;
      this.link = "spp";
      // 桥只认地址不认名字，名字交给品牌模块自己退到默认值
      this.device = { name: "" };
      return;
    }
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
          // 品牌、传输方式、串口候选都由调用方给，原生端不认识任何品牌
          const wants = {
            brand: this.codec.id,
            transport: transport ?? (this.codec.ble ? "ble" : "spp"),
            address: address ?? "",
            channels,
            services,
          };
          // 带参数的连接只走 bleConnect：Android 的 JS 接口只吃字符串，统一发 JSON 字符串。
          // bleScan 是老桥的无参入口，进不了设备和端口，macOS 点设备中心就会连错。
          if (globalThis.NativeBLE && typeof globalThis.NativeBLE.bleConnect === "function") {
            nativeCall("bleConnect", JSON.stringify(wants));
          } else {
            nativeCall("bleScan", wants);
          }
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
    if (this.bridge) {
      this.bridge.close();
      this.bridge = null;
      return;
    }
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
    if (this.bridge) {
      for (const chunk of chunks) this.bridge.send(chunk);
      return;
    }
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

  // 同一时刻最多几条请求在途。回包按命令号（fblock.func）配对，同一个命令同时只能有一条在途，
  // 否则耳机乱序回包时会把结果配错；不同命令之间没有顺序要求，可以一起飞。
  request(packetBytes, timeoutMs = 2500) {
    const header = this.codec.header(packetBytes);
    if (!header) return Promise.reject(new Error("空数据包"));
    const key = this.codec.key(header);
    return new Promise((resolve, reject) => {
      this._queue.push({ packetBytes, timeoutMs, key, resolve, reject });
      this._pump();
    });
  }

  _pump() {
    for (let i = 0; i < this._queue.length && this._inFlight < MAX_IN_FLIGHT; ) {
      const job = this._queue[i];
      if (this._activeKeys.has(job.key)) {
        i += 1;
        continue;
      }
      this._queue.splice(i, 1);
      this._start(job);
    }
  }

  _start(job) {
    this._inFlight += 1;
    this._activeKeys.add(job.key);
    this._send(job).then(
      (packet) => {
        this._release(job.key);
        job.resolve(packet);
      },
      (err) => {
        this._release(job.key);
        job.reject(err);
      },
    );
  }

  _release(key) {
    this._inFlight -= 1;
    this._activeKeys.delete(key);
    this._pump();
  }

  _send({ packetBytes, timeoutMs, key }) {
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
    // 排队的请求不会再有回包，一起放掉
    for (const job of this._queue.splice(0)) job.reject(err);
    this._inFlight = 0;
    this._activeKeys.clear();
  }
}
