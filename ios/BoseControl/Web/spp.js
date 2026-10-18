// 华为耳机走蓝牙串口（SPP / RFCOMM），包格式：
//   5a | 长度(2, 大端) | 00 | 命令(2) | [参数类型(1) 参数长度(1) 值]… | CRC16(2)
// 长度从 00 那一字节算起，整包字节数 = 长度 + 5。
// CRC 是 XMODEM（多项式 0x1021，初值 0），覆盖 CRC 之前的全部字节。

export const HEAD = 0x5a;
export const EMPTY = new Uint8Array(0);

const CRC_POLY = 0x1021;

export function crc16(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? (crc << 1) ^ CRC_POLY : crc << 1;
    crc &= 0xffff;
  }
  return crc;
}

function bytesOf(value) {
  if (typeof value === "number") return Uint8Array.of(value & 0xff);
  if (value == null) return EMPTY;
  return value instanceof Uint8Array ? value : Uint8Array.from(value);
}

export function encode(cmd, params = []) {
  const body = [...cmd];
  for (const [type, value] of params) {
    const bytes = bytesOf(value);
    body.push(type & 0xff, bytes.length, ...bytes);
  }
  const frame = [HEAD, (body.length + 1) >> 8, (body.length + 1) & 0xff, 0, ...body];
  const sum = crc16(frame);
  return Uint8Array.from([...frame, sum >> 8, sum & 0xff]);
}

// 读请求：命令 + 一串只需类型、值为空的参数
export function readRequest(cmd, types) {
  return encode(
    cmd,
    types.map((type) => [type, EMPTY]),
  );
}

export function decode(frame) {
  const end = 3 + ((frame[1] << 8) | frame[2]);
  const cmd = frame.slice(4, 6);
  const params = new Map();
  let at = 6;
  while (at + 2 <= end) {
    const type = frame[at];
    const length = frame[at + 1];
    params.set(type, frame.slice(at + 2, at + 2 + length));
    at += length + 2;
  }
  return { cmd, params };
}

export function keyOf(packet) {
  return [...packet.cmd].join("/");
}

export function num(packet, ...types) {
  for (const type of types) {
    const value = packet.params.get(type);
    if (value?.length) return value[0] > 127 ? value[0] - 256 : value[0];
  }
  return null;
}

export function bytes(packet, ...types) {
  for (const type of types) {
    const value = packet.params.get(type);
    if (value?.length) return value;
  }
  return EMPTY;
}

export function text(packet, ...types) {
  const value = bytes(packet, ...types);
  if (!value.length) return "";
  return new TextDecoder("utf-8").decode(value).replace(/\0+$/, "");
}

function concat(a, b) {
  if (!a.length) return b;
  if (!b.length) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// 收字节流，吐出完整的包。长度字段不像话或者 CRC 不对就往后挪一字节重新找包头，
// 宁可丢一包也不要卡在错位的边界上。
const MAX_FRAME = 4096;

export function createParser() {
  let buf = new Uint8Array(0);
  return (chunk) => {
    buf = concat(buf, chunk);
    const out = [];
    for (;;) {
      if (buf.length < 5) break;
      if (buf[0] !== HEAD) {
        const at = buf.indexOf(HEAD, 1);
        buf = at < 0 ? new Uint8Array(0) : buf.slice(at);
        continue;
      }
      const total = ((buf[1] << 8) | buf[2]) + 5;
      if (total > MAX_FRAME) {
        buf = buf.slice(1);
        continue;
      }
      if (buf.length < total) break;
      const frame = buf.slice(0, total);
      const sum = crc16(frame.subarray(0, total - 2));
      if (sum !== ((frame[total - 2] << 8) | frame[total - 1])) {
        buf = buf.slice(1);
        continue;
      }
      buf = buf.slice(total);
      out.push(decode(frame));
    }
    return out;
  };
}
