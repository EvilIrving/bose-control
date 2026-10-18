// OPPO / OnePlus / realme 耳机的私有控制协议（HeyMelody 的 "OPO" 协议），走经典蓝牙 RFCOMM。
// 分帧、命令号和 payload 编解码来自 OnePlus Buds 4 的逐条真机实测：
//   /tmp/opbuds/docs/protocol.md（每行标了 confirmed / likely / assumed）
// 参考实现：/tmp/opbuds/tools/probe（Python，分帧与读写）和 /tmp/oppowin（C#，命令表与解析）。
//
// 帧格式（以 opbuds 实测为准）：
//   AA <len varint(LEB128)> 00 00 <cmdId> <msgType> <seq> <plenLo> <plenHi> [payload]
// len 覆盖它自己之后的全部字节：total = 1 + varintLen + len，header = 1 + varintLen + 7，
// payload 长度必须等于 total - header。协议没有校验和，这条恒等式是唯一的完整性检查。
//
// oppowin 把 len 当单字节读、把字节 4-5 当 16 位小端命令号，这两点都被真机字节推翻：
// 0x011F 的回包是 299 字节 payload，len 字段为 b2 02（varint 306，单字节读法只得 178），
// 而字节 4 是 cmdId、字节 5 是 msgType，否则 REGISTER 的 00 85 会读成命令 0x8500。
// 解析器仍保留单字节读法兜底，但优先按 varint 解，原因见 createParser。

export const MAGIC = 0xaa;
export const EMPTY = new Uint8Array(0);

// varint 之后固定的 7 字节：00 00、cmdId、msgType、seq、plenLo、plenHi
const FIXED = 7;
const MAX_VARINT = 4;
const MAX_FRAME = 4096;

export const MSG = {
  request: 0x01,
  reply: 0x81,
  set: 0x04,
  setAck: 0x84,
  notify: 0x02,
  notifyAlt: 0x05,
  register: 0x85,
};

// 0x0204 推送的 payload[0] 选主题，剩下的字节和对应 0x81xx 回包去掉状态字节后一致。
export const TOPIC = {
  battery: 0x01,
  wear: 0x02,
  anc: 0x03,
};

// 命令号只占低字节，高字节是消息类型；注释里是常规的 16 位写法。
export const CMD = {
  hello: 0x00, // 0x0100，回包 0x8100
  productId: 0x03, // 0x0103 / 0x8103，型号 id 来自 oppowin，Buds 4 上没测过
  firmware: 0x05, // 0x0105 / 0x8105
  battery: 0x06, // 0x0106 / 0x8106
  touch: 0x08, // 0x0108 / 0x8108，读的时候必须发空 payload
  wear: 0x09, // 0x0109 / 0x8109
  anc: 0x0c, // 0x010C / 0x810C，唯一合法字段 id 是 0x01
  eq: 0x0f, // 0x010F / 0x810F
  findDevice: 0x00, // 0x0400
  touchSet: 0x01, // 0x0401
  ancSet: 0x04, // 0x0404
  eqSet: 0x06, // 0x0406
};

// HELLO 十个字节里最后那个 0x12 落在长度字段声明的帧外，是各参考实现都照抄的怪癖。
// 这里按真机字节整包发，不用 encode() 重拼（重拼会少这个字节）。
export const HELLO = Uint8Array.from([0xaa, 0x07, 0x00, 0x00, 0x00, 0x01, 0x23, 0x00, 0x00, 0x12]);

// 0x010C / 0x0404 的回读掩码。四个主档都在 Buds 4 上从手机切档后读回来过（confirmed）。
// 子档 0x0020 moderate 只是 likely，0x0040 low / 0x0080 auto 继承自 Buds Pro 3（assumed-pro3），
// 所以这里不提供子档，写操作一律发显式 16 位掩码。
export const ANC = {
  off: 0x0008,
  cancelling: 0x0010,
  transparency: 0x0100,
  adaptive: 0x0800,
};

// 0x010F 的预设号，Buds 4 上逐个选中后读回（confirmed）。0x03 / 0x05-0x07 固件照收不误，
// 但不映射任何 DSP 曲线，所以写之前必须用这张表校验，设备自己不会拒绝。
export const EQ_PRESETS = {
  0: "balanced",
  1: "serenade",
  2: "bass",
  4: "custom",
};

function bytesOf(payload) {
  if (payload == null) return EMPTY;
  if (typeof payload === "number") return Uint8Array.of(payload & 0xff);
  return payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
}

function writeVarint(value) {
  const out = [];
  let rest = value;
  do {
    const chunk = rest & 0x7f;
    rest >>= 7;
    out.push(rest ? chunk | 0x80 : chunk);
  } while (rest);
  return out;
}

// 返回 { state: "ok" | "wait" | "fail", value, size }：wait 表示还缺字节，fail 表示这段不是 varint。
export function readVarint(bytes, at = 1) {
  let value = 0;
  let shift = 0;
  for (let i = 0; i < MAX_VARINT; i++) {
    const pos = at + i;
    if (pos >= bytes.length) return { state: "wait", value: 0, size: i };
    const byte = bytes[pos];
    value |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) return { state: "ok", value, size: i + 1 };
    shift += 7;
  }
  return { state: "fail", value: 0, size: MAX_VARINT };
}

export function encode(cmdId, msgType, seq, payload = EMPTY) {
  const body = bytesOf(payload);
  const head = [
    MAGIC,
    ...writeVarint(FIXED + body.length),
    0,
    0,
    cmdId & 0xff,
    msgType & 0xff,
    seq & 0xff,
    body.length & 0xff,
    (body.length >> 8) & 0xff,
  ];
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

export function buildRequest(cmd, payload = EMPTY, seq = 0) {
  return encode(cmd, MSG.request, seq, payload);
}

export function buildSet(cmd, payload = EMPTY, seq = 0) {
  return encode(cmd, MSG.set, seq, payload);
}

// 读请求的统一形状：[count][id...]。0x0106 / 0x0109 发空 payload，0x010C 发 01 01，
// 0x0108 必须为空（它忽略请求 payload，三种不同 payload 的回包逐字节相同）。
export function countRequest(ids) {
  return Uint8Array.from([ids.length, ...ids]);
}

// [count][id][valueLo][valueHi]，value 是回读掩码，16 位小端。
export function ancSetPayload(mask) {
  return Uint8Array.from([0x01, 0x01, mask & 0xff, (mask >> 8) & 0xff]);
}

// 0x0406 只收一个裸字节。
export function eqSetPayload(preset) {
  return Uint8Array.of(preset & 0xff);
}

// [count][id...]；01 左、02 右、02 01 02 双耳。提示音自己会停，协议里没有停止命令。
export function findPayload(ids) {
  return countRequest(ids);
}

// 0x0401：[count=1] + 一条 0x0108 记录，只换最后的 action 字节。
export function touchSetPayload(record, action) {
  return Uint8Array.from([0x01, record.side & 0xff, record.type & 0xff, record.gesture & 0xff, action & 0xff]);
}

// 电量：payload[0] 是状态（0x8106）或主题（0x0204 topic 0x01），payload[1] 是条数，
// 之后每条 [id][raw]，percent = raw & 0x7f，0x80 是充电位。id 1 左 / 2 右 / 3 盒。
export function decodeBattery(payload) {
  if (payload.length < 2) return [];
  const count = payload[1];
  if (2 + count * 2 > payload.length) return [];
  const rows = [];
  for (let i = 0; i < count; i++) {
    const at = 2 + i * 2;
    const raw = payload[at + 1];
    rows.push({ id: payload[at], level: raw & 0x7f, charging: (raw & 0x80) !== 0 });
  }
  return rows;
}

// 协议 id -> 宿主 state.battery 的 component：示意图按 0 左 / 1 盒 / 2 右 渲染。
const BATTERY_COMPONENT = { 1: 0, 2: 2, 3: 1 };

// 电量行按宿主的 component 顺序排好；不认识的 id 直接丢掉。
export function batteryRows(payload) {
  return decodeBattery(payload)
    .filter((row) => BATTERY_COMPONENT[row.id] != null)
    .map((row) => ({ component: BATTERY_COMPONENT[row.id], level: row.level }))
    .sort((a, b) => a.component - b.component);
}

// 佩戴：每条 [id][flags]，bit0 出盒、bit1 入耳、bit2 在位。id 1 左 / 2 右 / 3 盒。
export function decodeWear(payload) {
  if (payload.length < 2) return [];
  const count = payload[1];
  if (2 + count * 2 > payload.length) return [];
  const rows = [];
  for (let i = 0; i < count; i++) {
    const at = 2 + i * 2;
    const flags = payload[at + 1];
    rows.push({
      id: payload[at],
      raw: flags,
      outOfCase: (flags & 0x01) !== 0,
      inEar: (flags & 0x02) !== 0,
      present: (flags & 0x04) !== 0,
    });
  }
  return rows;
}

// 降噪：每条 [id][maskLo][maskHi]，只有 id 0x01 有效。返回 16 位掩码，认不出返回 null。
export function decodeAnc(payload) {
  if (payload.length < 2) return null;
  const count = payload[1];
  if (2 + count * 3 > payload.length) return null;
  for (let i = 0; i < count; i++) {
    const at = 2 + i * 3;
    if (payload[at] !== 0x01) continue;
    return payload[at + 1] | (payload[at + 2] << 8);
  }
  return null;
}

// 0x810F 回包：[status][preset]。
export function decodeEqPreset(payload) {
  return payload.length >= 2 ? payload[1] : null;
}

// 0x0504 推送：裸的预设字节。
export function decodeEqPush(payload) {
  return payload.length >= 1 ? payload[0] : null;
}

// 0x8108 回包：[status][count] 然后 count 条 [side][type][gesture][action]。
// 同时保留原始 payload，写手势时用它做「只有一个字节变了」的逐字节比对。
export function decodeTouch(payload) {
  if (payload.length < 2) return { records: [], raw: payload };
  const count = payload[1];
  if (2 + count * 4 > payload.length) return { records: [], raw: payload };
  const records = [];
  for (let i = 0; i < count; i++) {
    const at = 2 + i * 4;
    records.push({
      side: payload[at],
      type: payload[at + 1],
      gesture: payload[at + 2],
      action: payload[at + 3],
    });
  }
  return { records, raw: payload };
}

// 0x8105 的 payload 是 [status][?] + ASCII 逗号分隔串，例如 1,2,138,...。
// 文档里 4x3 的分组只是“leading reading”，没有长度字段强制，所以原样返回字符串。
export function decodeFirmware(payload) {
  if (payload.length < 2) return "";
  return new TextDecoder("utf-8").decode(payload.slice(2)).replace(/\0+$/, "").trim();
}

// 0x8103：[status=0][id 3 字节小端]，按 oppowin 的 6 位大写十六进制显示。
export function decodeProductId(payload) {
  if (payload.length < 4 || payload[0] !== 0) return "";
  const id = payload[1] | (payload[2] << 8) | (payload[3] << 16);
  return id.toString(16).toUpperCase().padStart(6, "0");
}

// 请求和回包按命令 + 消息类型族配对：回包是请求的 0x01→0x81、设置 0x04→0x84，去掉最高位后同一个值，
// 而主动上报是 0x02 / 0x05，永远对不上请求。不把 seq 算进去是故意的：不同固件对回包 seq 的处理
// 不一样（参考实现里有回显的、也有写 0xFF 的），带上 seq 会让没回显的机型全部超时。
// 同一条命令同时只飞一条由 transport 的 _activeKeys 保证，所以不需要 seq 来区分并发。
export function key(packet) {
  const pad = (value) => value.toString(16).padStart(2, "0");
  return `${pad(packet.cmdId)}:${pad(packet.msgType & 0x7f)}`;
}

// 从缓冲区开头的 0xAA 试出整帧，返回 { state, total, header }。
function varintFrame(bytes) {
  const len = readVarint(bytes, 1);
  if (len.state === "wait") return { state: "wait" };
  if (len.state === "fail" || len.value < FIXED) return { state: "fail" };
  const total = 1 + len.size + len.value;
  const header = 1 + len.size + FIXED;
  if (total > MAX_FRAME) return { state: "fail" };
  if (bytes.length < total) return { state: "wait" };
  return payloadMatches(bytes, total, header) ? { state: "ok", total, header } : { state: "fail" };
}

// oppowin / 部分固件的单字节长度读法，作为 varint 不自洽时的兜底。
function singleFrame(bytes) {
  if (bytes.length < 2) return { state: "wait" };
  const len = bytes[1];
  if (len < FIXED) return { state: "fail" };
  const total = 2 + len;
  const header = 1 + 1 + FIXED;
  if (total > MAX_FRAME) return { state: "fail" };
  if (bytes.length < total) return { state: "wait" };
  return payloadMatches(bytes, total, header) ? { state: "ok", total, header } : { state: "fail" };
}

// plen 必须等于 total - header。没有 CRC，这是唯一能判定“长度字段和内容对得上”的条件。
function payloadMatches(bytes, total, header) {
  const base = header - FIXED;
  const plen = bytes[base + 5] | (bytes[base + 6] << 8);
  return plen === total - header;
}

function packetOf(bytes, header, total) {
  const base = header - FIXED;
  return {
    cmdId: bytes[base + 2],
    msgType: bytes[base + 3],
    seq: bytes[base + 4],
    payload: bytes.slice(header, total),
  };
}

function concat(a, b) {
  if (!a.length) return b;
  if (!b.length) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// 收字节流，吐出完整的包。按方向要求：先按 LEB128 读 len；varint 头与 plen 对不上时再按
// 单字节 len 试；两种都不自洽就丢一个字节重新找 0xAA。
// 只有 varint 还缺字节时才等——否则一个错位的 0xAA（长度看起来很大）会把后面的好帧一起吞掉。
export function createParser() {
  let buf = new Uint8Array(0);
  return (chunk) => {
    buf = concat(buf, chunk);
    const out = [];
    for (;;) {
      if (!buf.length) break;
      if (buf[0] !== MAGIC) {
        const at = buf.indexOf(MAGIC);
        if (at < 0) {
          buf = EMPTY;
          break;
        }
        buf = buf.slice(at);
        continue;
      }
      const wide = varintFrame(buf);
      if (wide.state === "ok") {
        out.push(packetOf(buf, wide.header, wide.total));
        buf = buf.slice(wide.total);
        continue;
      }
      const narrow = singleFrame(buf);
      if (narrow.state === "ok") {
        out.push(packetOf(buf, narrow.header, narrow.total));
        buf = buf.slice(narrow.total);
        continue;
      }
      if (wide.state === "wait" && buf.length <= MAX_FRAME) break;
      buf = buf.slice(1);
    }
    return out;
  };
}

// 请求字节 -> 包，交给 transport 算 key。HELLO 这种尾随字节不参与，只取声明的那一帧。
export function header(bytes) {
  if (!bytes?.length || bytes[0] !== MAGIC) return null;
  const wide = varintFrame(bytes);
  if (wide.state === "ok") return packetOf(bytes, wide.header, wide.total);
  const narrow = singleFrame(bytes);
  return narrow.state === "ok" ? packetOf(bytes, narrow.header, narrow.total) : null;
}
