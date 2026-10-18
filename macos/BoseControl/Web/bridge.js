import { fromHex, toHex } from "./native.js";

// 浏览器开不了蓝牙串口，本机的 server.py 代开：这里只说 JSON，交给它转给 bt-bridge。
export class LocalBridge {
  constructor() {
    this.ws = null;
    this.open = false;
    this.onData = null;
    this.onClose = null;
    this.waiting = null;
  }

  static async reachable() {
    try {
      const res = await fetch("/api/devices", { cache: "no-store" });
      return res.ok;
    } catch {
      return false;
    }
  }

  static async list() {
    try {
      const res = await fetch("/api/devices", { cache: "no-store" });
      return res.ok ? await res.json() : [];
    } catch {
      return [];
    }
  }

  connect({ address, channels = [1, 2, 3], services = [], timeout = 12000 }) {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/bt`;
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        reject(err);
        return;
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        this.close();
        reject(new Error("timeout"));
      }, timeout);
      const settle = (err) => {
        clearTimeout(timer);
        if (this.waiting === settle) this.waiting = null;
        if (err) reject(err);
        else resolve();
      };
      this.waiting = settle;

      ws.onopen = () => {
        ws.send(JSON.stringify({ t: "open", address, channels, services }));
      };
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.t === "ok") {
          this.open = true;
          settle(null);
        } else if (msg.t === "error") {
          settle(new Error(msg.code || "bridge"));
        } else if (msg.t === "data" && this.onData) {
          this.onData(fromHex(msg.hex));
        }
      };
      ws.onclose = () => {
        const was = this.open;
        this.open = false;
        this.ws = null;
        if (this.waiting) settle(new Error("closed"));
        if (was) this.onClose?.();
      };
      ws.onerror = () => settle(new Error("bridge"));
    });
  }

  send(bytes) {
    if (!this.ws || !this.open) return;
    this.ws.send(JSON.stringify({ t: "send", hex: toHex(bytes) }));
  }

  close() {
    this.open = false;
    try {
      this.ws?.send(JSON.stringify({ t: "close" }));
      this.ws?.close();
    } catch {
      /* 已经断开 */
    }
    this.ws = null;
  }
}
