// vivo / iQOO TWS 用的是 GAIA 帧。同一套命令跑两条物理通道，帧封装不一样：
//   蓝牙串口（RFCOMM 服务 00000837-…，官方 Android App 走这条）
//     FF | ver | flags | len | vendor(2) | cmd(2) | payload [xor]   ← len 只算 payload
//   BLE GATT（服务 00001100-…，官方 iOS App 走这条）
//     vendor(2) | cmd(2) | payload                                  ← 裸 content，没有帧头
// GATT 侧不需要帧头，因为 GATT 自己给了消息边界和长度。
// 帧结构、命令号、版本分层来自 TWS-Pods-PC 上游 HyperEars 的逆向；
// 「GATT 是裸 content」这条是在 vivo TWS 5 上抓包确认的（vivopods-mac）。
// 版本用错耳机会静默不回包，所以 encode 的默认值按命令给，见 vivo.js 的 versionOf()。

export const VIVO = 0x001b;
export const GAIA = 0x000a;

const HEAD = 0xff;
const MAX_FRAME = 4096;

function concat(a, b) {
  if (!a.length) return b;
  if (!b.length) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function encode(cmd, payload = [], { link = "spp", version = 3, vendor = VIVO } = {}) {
  const body = [vendor >> 8, vendor & 0xff, (cmd >> 8) & 0xff, cmd & 0xff, ...payload];
  if (link === "ble") return Uint8Array.from(body);
  return Uint8Array.from([HEAD, version & 0xff, 0, payload.length & 0xff, ...body]);
}

export function decode(frame, link = "spp") {
  if (link === "ble") {
    if (frame.length < 4) return null;
    return {
      vendor: (frame[0] << 8) | frame[1],
      cmd: (frame[2] << 8) | frame[3],
      payload: frame.slice(4),
      version: 0,
    };
  }
  if (frame.length < 8 || frame[0] !== HEAD) return null;
  const wide = (frame[2] & 0x02) !== 0;
  const at = wide ? 5 : 4;
  return {
    vendor: (frame[at] << 8) | frame[at + 1],
    cmd: (frame[at + 2] << 8) | frame[at + 3],
    payload: frame.slice(at + 4),
    version: frame[1],
  };
}

export function keyOf(packet) {
  return `${packet.vendor}:${packet.cmd & 0x7fff}`;
}

// GATT 通知自带消息边界，一块就是一条；串口是字节流，得靠 FF 包头和长度字段切。
// GATT 侧的代价：一条消息如果被拆到两次通知里就拼不回来。抓包里没有这种情况（MTU 够长），
// 真遇上了只能丢包，不能靠猜字节边界。
export function createParser(link = "spp") {
  if (link === "ble") {
    let pending = new Uint8Array(0);
    return (chunk) => {
      const message = concat(pending, chunk);
      pending = new Uint8Array(0);
      if (message.length < 4) {
        pending = message;
        return [];
      }
      const packet = decode(message, "ble");
      return packet ? [packet] : [];
    };
  }
  let buf = new Uint8Array(0);
  return (chunk) => {
    buf = concat(buf, chunk);
    const out = [];
    for (;;) {
      if (buf.length < 4) break;
      if (buf[0] !== HEAD) {
        const at = buf.indexOf(HEAD, 1);
        buf = at < 0 ? new Uint8Array(0) : buf.slice(at);
        continue;
      }
      const wide = (buf[2] & 0x02) !== 0;
      const head = wide ? 9 : 8;
      if (buf.length < head) break;
      const len = wide ? buf[3] | (buf[4] << 8) : buf[3];
      const total = head + len + ((buf[2] & 0x01) !== 0 ? 1 : 0);
      if (total > MAX_FRAME) {
        buf = buf.slice(1);
        continue;
      }
      if (buf.length < total) break;
      const frame = buf.slice(0, total);
      if ((frame[2] & 0x01) !== 0 && xorOf(frame.subarray(0, total - 1)) !== frame[total - 1]) {
        buf = buf.slice(1);
        continue;
      }
      buf = buf.slice(total);
      out.push(decode(frame, "spp"));
    }
    return out;
  };
}

function xorOf(bytes) {
  let sum = 0;
  for (const byte of bytes) sum ^= byte;
  return sum;
}

export function createGaiaCodec() {
  // 两条通道的切包方式不同，各留一个解析器；连接方式变了就重建
  const parsers = new Map();
  return {
    id: "vivo",
    ble: true,
    filters: [{ namePrefix: "vivo" }, { namePrefix: "Vivo" }, { namePrefix: "iQOO" }, { namePrefix: "iQoo" }],
    services: ["00001100-d102-11e1-9b23-00025b00a5a5"],
    chars: ["00001101-d102-11e1-9b23-00025b00a5a5"],
    reset() {
      parsers.clear();
    },
    chunks(frame) {
      return [frame];
    },
    parse(chunk, link = "spp") {
      if (!parsers.has(link)) parsers.set(link, createParser(link));
      return parsers.get(link)(chunk).filter(Boolean);
    },
    key(packet) {
      return keyOf(packet);
    },
    header(bytes) {
      return decode(bytes, bytes[0] === HEAD ? "spp" : "ble");
    },
  };
}

// 多连接列表：[全局状态][数量] 然后每台 [MAC 6][未知 3][状态 1][名长 1][UTF-8 名]
export function parseDeviceList(payload) {
  if (payload.length < 2) return [];
  const count = payload[1];
  const out = [];
  let at = 2;
  for (let i = 0; i < count && at + 11 <= payload.length; i++) {
    const mac = payload.slice(at, at + 6);
    at += 9;
    const state = payload[at];
    const length = payload[at + 1];
    at += 2;
    const name = new TextDecoder("utf-8").decode(payload.slice(at, at + length));
    at += length;
    out.push({ mac, state, name });
  }
  return out;
}

export function macText(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
}

export function macBytes(text) {
  const parts = String(text || "").split(/[:-]/).filter(Boolean);
  if (parts.length !== 6) return null;
  const out = new Uint8Array(6);
  for (let i = 0; i < 6; i++) {
    const value = parseInt(parts[i], 16);
    if (Number.isNaN(value)) return null;
    out[i] = value & 0xff;
  }
  return out;
}
