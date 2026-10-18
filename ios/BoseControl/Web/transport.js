import { LocalBridge } from "./bridge.js";
import { fromHex, hasNative, nativeCall, toHex } from "./native.js";
import { logLine } from "./log.js";

const MAX_IN_FLIGHT = 4;
let nativeOwner = null;
let nextSession = 0;
const sessionPrefix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let installedWindow = null;

export function cancelled() {
  return Object.assign(new Error("会话已结束"), { code: "cancelled" });
}

export function isCancelled(error) {
  return error?.code === "cancelled";
}

function installNativeRouter() {
  if (installedWindow === window) return;
  installedWindow = window;
  window.onNativeConnected = (info, token) => nativeOwner?._native("connected", info, token);
  window.onNativeDisconnected = (token) => nativeOwner?._native("disconnected", null, token);
  window.onNativeError = (error, token) => nativeOwner?._native("error", error, token);
  window.onDataReceived = (hex, token) => nativeOwner?._native("data", hex, token);
}

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
    this._epoch = 0;
    this._closed = false;
    this._token = null;
    this._connectWait = null;
    this._writeTail = Promise.resolve();
    this._lastWriteAt = 0;
    installNativeRouter();
  }

  get connected() {
    if (this.bridge) return this.bridge.open;
    if (this.nativeOn) return true;
    return Boolean(this.server?.connected && this.char);
  }

  get name() {
    return this.device?.name ?? "";
  }

  get active() {
    return !this._closed;
  }

  _check(epoch) {
    if (this._closed || epoch !== this._epoch) throw cancelled();
  }

  _native(kind, value, token) {
    if (this._closed || token !== this._token) return;
    if (kind === "connected") {
      if (!this._connectWait) {
        logLine("nat", `connected token=${token} 但当前不在等连接，丢掉`);
        return;
      }
      const data = typeof value === "string" ? JSON.parse(value || "{}") : value || {};
      this.nativeOn = true;
      this.link = data.link === "spp" ? "spp" : "ble";
      this.device = { name: data.name || "" };
      logLine("nat", `connected name="${this.device.name}" link=${this.link} token=${token}`);
      this._connectWait.resolve();
    } else if (kind === "data") {
      if (this.nativeOn) this.handleNotify(fromHex(String(value)));
    } else {
      const error = new Error(kind === "error" ? String(value || "native error") : "lost");
      this.lastError = error.message;
      logLine("nat", `${kind} ${error.message} token=${token}`);
      const connecting = Boolean(this._connectWait);
      this.disconnect(error);
      if (!connecting) this.onDisconnected?.();
    }
  }

  // A brand holds this connection-scoped view, never a reusable transport instance.
  scope() {
    const link = this;
    const epoch = this._epoch;
    return {
      get active() { return !link._closed && epoch === link._epoch; },
      get connected() { return this.active && link.connected; },
      get name() { return this.active ? link.name : ""; },
      get link() { return link.link; },
      get nativeOn() { return this.active && link.nativeOn; },
      get lastError() { return link.lastError; },
      request(bytes, timeout, options) {
        if (!this.active) return Promise.reject(cancelled());
        return link.request(bytes, timeout, options);
      },
      write(bytes) {
        if (!this.active) return Promise.reject(cancelled());
        return link.write(bytes);
      },
    };
  }

  async connect({ acceptAll = false, address = null, transport = null, channels = [], services = [] } = {}) {
    this.disconnect();
    this._closed = false;
    const epoch = this._epoch;
    this.codec.reset?.();
    this.lastError = "";
    this._lastWriteAt = 0;
    if (hasNative()) {
      if (nativeOwner && nativeOwner !== this) nativeOwner.disconnect();
      nativeOwner = this;
      this._token = `${sessionPrefix}-${++nextSession}`;
      const token = this._token;
      await new Promise((resolve, reject) => {
        const settle = (error) => {
          clearTimeout(timer);
          this._connectWait = null;
          if (error) reject(error);
          else resolve();
        };
        const timer = setTimeout(() => {
          if (epoch !== this._epoch) return;
          this.lastError = "timeout";
          this.disconnect(new Error("timeout"));
        }, 30000);
        this._connectWait = { resolve: () => settle(), reject: settle };
        try {
          nativeCall("bleConnect", JSON.stringify({
            session: token,
            transport: transport ?? (this.codec.ble ? "ble" : "spp"),
            address: address ?? "",
            channels,
            services,
          }));
        } catch (error) {
          this.disconnect(error);
        }
      });
      this._check(epoch);
      return;
    }
    if (transport === "spp") {
      const bridge = new LocalBridge();
      this.bridge = bridge;
      bridge.onData = (bytes) => {
        if (!this._closed && epoch === this._epoch) this.handleNotify(bytes);
      };
      bridge.onClose = () => {
        if (this._closed || epoch !== this._epoch) return;
        this.disconnect(new Error("lost"));
        this.onDisconnected?.();
      };
      await bridge.connect({ address, channels: channels.length ? channels : [1, 2, 3], services });
      this._check(epoch);
      this.link = "spp";
      this.device = { name: "" };
      return;
    }
    if (!this.codec.ble) throw new Error("noproto");
    if (!navigator.bluetooth) throw new Error("unsupported");
    const options = acceptAll
      ? { acceptAllDevices: true, optionalServices: this.codec.services }
      : { filters: this.codec.filters, optionalServices: this.codec.services };
    const device = await navigator.bluetooth.requestDevice(options);
    this._check(epoch);
    this.device = device;
    device.addEventListener("gattserverdisconnected", () => {
      if (this._closed || epoch !== this._epoch) return;
      this.disconnect(new Error("lost"));
      this.onDisconnected?.();
    });
    const server = await device.gatt.connect();
    if (this._closed || epoch !== this._epoch) {
      server.disconnect();
      throw cancelled();
    }
    this.server = server;
    const service = await this.openService(server);
    this._check(epoch);
    const char = await this.openCharacteristic(service);
    this._check(epoch);
    await char.startNotifications();
    this._check(epoch);
    char.addEventListener("characteristicvaluechanged", (ev) => {
      if (this._closed || epoch !== this._epoch) return;
      const value = ev.target.value;
      this.handleNotify(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    });
    this.char = char;
    this.link = "ble";
  }

  async openService(server) {
    for (const uuid of this.codec.services) {
      try {
        return await server.getPrimaryService(uuid);
      } catch { /* Try the next advertised control service. */ }
    }
    throw new Error("service");
  }

  async openCharacteristic(service) {
    for (const uuid of this.codec.chars ?? []) {
      try {
        return await service.getCharacteristic(uuid);
      } catch { /* Try the alternate control characteristic. */ }
    }
    throw new Error("char");
  }

  disconnect(error = cancelled()) {
    const owner = nativeOwner === this;
    const token = this._token;
    this._closed = true;
    this._writeTail = Promise.resolve();
    this._connectWait?.reject(error);
    this.rejectAll(error);
    if (owner) {
      nativeOwner = null;
      try { nativeCall("bleDisconnect", token); } catch { /* Bridge may have been removed. */ }
    }
    this._token = null;
    this.nativeOn = false;
    this.bridge?.close();
    this.bridge = null;
    this.device?.gatt?.disconnect();
    this.device = null;
    this.server = null;
    this.char = null;
  }

  dispose() {
    this.disconnect();
    this.onPacket = null;
    this.onDisconnected = null;
  }

  handleNotify(chunk) {
    if (this._closed) return;
    const packets = this.codec.parse(chunk, this.link);
    logLine("rx", `${chunk.length}B ${toHex(chunk).slice(0, 96)}${packets.length ? "" : "（未成帧）"}`);
    for (const packet of packets) {
      const key = this.codec.key(packet);
      const waited = this.pending.has(key);
      logLine("rx", `key=${key} ${packet.byteLength ?? packet.length ?? "?"}B ${waited ? "有等待项" : "无等待项"}`);
      this.pending.get(key)?.finish(null, packet);
      this.onPacket?.(packet);
    }
  }

  write(packetBytes, onSend = () => {}) {
    const epoch = this._epoch;
    const send = async () => {
      this._check(epoch);
      const gap = this.codec.gapMs ?? 0;
      const wait = this._lastWriteAt + gap - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this._check(epoch);
      this._lastWriteAt = Date.now();
      onSend();
      const chunks = this.codec.chunks(packetBytes, this.link);
      const via = this.bridge ? "bridge" : this.nativeOn ? "native" : "webble";
      logLine("tx", `write ${packetBytes.length}B → ${chunks.length} 包 via ${via} key=${this.codec.key(this.codec.header(packetBytes))}`);
      for (const chunk of chunks) {
        this._check(epoch);
        if (this.bridge) this.bridge.send(chunk);
        else if (this.nativeOn && nativeOwner === this) {
          nativeCall("sendData", JSON.stringify({ session: this._token, hex: toHex(chunk) }));
        } else if (this.char) {
          const buf = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
          if (this.char.properties.writeWithoutResponse) await this.char.writeValueWithoutResponse(buf);
          else await this.char.writeValue(buf);
        } else throw new Error("lost");
      }
    };
    const result = this._writeTail.then(send);
    this._writeTail = result.catch(() => {});
    return result;
  }

  request(packetBytes, timeoutMs = 2500, { priority = 0 } = {}) {
    if (this._closed) return Promise.reject(cancelled());
    const header = this.codec.header(packetBytes);
    if (!header) return Promise.reject(new Error("空数据包"));
    const key = this.codec.key(header);
    return new Promise((resolve, reject) => {
      this._queue.push({ packetBytes, timeoutMs, priority, key, resolve, reject });
      this._queue.sort((a, b) => b.priority - a.priority);
      this._pump();
    });
  }

  _pump() {
    for (let i = 0; i < this._queue.length && this._inFlight < MAX_IN_FLIGHT;) {
      const job = this._queue[i];
      if (this._activeKeys.has(job.key)) { i += 1; continue; }
      this._queue.splice(i, 1);
      this._start(job);
    }
  }

  _start(job) {
    this._inFlight += 1;
    this._activeKeys.add(job.key);
    let timer;
    let settled = false;
    const finish = (error, packet) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.pending.delete(job.key);
      this._activeKeys.delete(job.key);
      this._inFlight -= 1;
      if (error) job.reject(error);
      else job.resolve(packet);
      this._pump();
    };
    this.pending.set(job.key, { finish });
    const started = Date.now();
    this.write(job.packetBytes, () => {
      if (!settled) timer = setTimeout(() => {
        logLine("tx", `key=${job.key} 超时 ${job.timeoutMs}ms（已等 ${Date.now() - started}ms）`);
        finish(new Error(`超时 ${job.key}`));
      }, job.timeoutMs);
    }).catch((error) => {
      logLine("tx", `key=${job.key} 写失败 ${error.message}`);
      finish(error);
    });
  }

  rejectAll(error) {
    logLine("conn", `rejectAll ${error?.message || ""}（队列 ${this._queue.length} / 在途 ${this.pending.size}）`);
    this._epoch += 1;
    for (const job of this._queue.splice(0)) job.reject(error);
    for (const item of [...this.pending.values()]) item.finish(error);
  }
}
