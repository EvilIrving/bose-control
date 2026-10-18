export const OP = {
  SET: 0,
  GET: 1,
  SETGET: 2,
  STATUS: 3,
  ERROR: 4,
  START: 5,
  RESULT: 6,
  PROCESSING: 7,
};

export const FBLOCK = {
  PRODUCT: 0x00,
  SETTINGS: 0x01,
  STATUS: 0x02,
  DEVICE: 0x04,
  AUDIO: 0x05,
  CONTROL: 0x07,
  HEARING: 0x0c,
  AUTH: 0x12,
  MODES: 0x1f,
};

export const FUNC = {
  BMAP_VERSION: 0x01,
  PRODUCT_ID: 0x03,
  NAME: 0x02,
  VOICE_PROMPTS: 0x03,
  STANDBY: 0x04,
  CNC: 0x05,
  FIRMWARE: 0x05,
  MAC_ADDRESS: 0x06,
  SERIAL_NUMBER: 0x07,
  MANUFACTURED: 0x08,
  HARDWARE_REVISION: 0x0a,
  GUID: 0x0c,
  ORIGINAL_NAME: 0x0f,
  COMPONENT_ID: 0x11,
  LE_AUDIO: 0x17,
  EQ: 0x07,
  BUTTONS: 0x09,
  MULTIPOINT: 0x0a,
  SIDETONE: 0x0b,
  CONVERSATION: 0x0d,
  AUTO_PLAY_PAUSE: 0x18,
  AUTO_ANSWER: 0x1b,
  DISABLE_CAPTOUCH: 0x22,
  BATTERY: 0x02,
  POWER: 0x04,
  GET_ALL_MODES: 0x01,
  MODE_CAPS: 0x02,
  CURRENT_MODE: 0x03,
  MODE_CONFIG: 0x06,
  USER_INDICES: 0x07,
  FAVORITES: 0x08,
  MODE_RESET: 0x09,
  AUDIO_SETTINGS: 0x0a,
  DEVICE_LIST: 0x04,
  PAIRING: 0x08,
  TRANSPORT: 0x03,
};

export const PROMPTS = {
  0: "未命名",
  1: "安静",
  2: "通透",
  3: "通透",
  4: "通透",
  5: "掩蔽",
  6: "舒适",
  7: "通勤",
  8: "户外",
  9: "运动",
  10: "家中",
  11: "工作",
  12: "音乐",
  13: "专注",
  14: "放松",
  15: "飞行",
  16: "机场",
  17: "驾驶",
  18: "训练",
  19: "健身",
  20: "跑步",
  21: "步行",
  22: "徒步",
  23: "交谈",
  24: "通话",
  25: "耳语",
  26: "助听",
  27: "学习",
  28: "播客",
  29: "有声书",
  30: "平静",
  31: "睡眠",
  32: "冥想",
  33: "瑜伽",
  34: "沉浸",
  35: "立体声",
  36: "影院",
};


export function encode(fblock, func, operator, payload = new Uint8Array()) {
  const body = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
  const out = new Uint8Array(4 + body.length);
  out[0] = fblock;
  out[1] = func;
  out[2] = operator & 0x0f;
  out[3] = body.length;
  out.set(body, 4);
  return out;
}

export function get(fblock, func, payload) {
  return encode(fblock, func, OP.GET, payload ?? new Uint8Array());
}

export function setGet(fblock, func, payload) {
  return encode(fblock, func, OP.SETGET, payload);
}

export function start(fblock, func, payload) {
  return encode(fblock, func, OP.START, payload);
}

export function decodeAll(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const packets = [];
  let pos = 0;
  while (pos + 4 <= data.length) {
    const length = data[pos + 3];
    if (pos + 4 + length > data.length) break;
    packets.push({
      fblock: data[pos],
      func: data[pos + 1],
      op: data[pos + 2] & 0x0f,
      payload: data.slice(pos + 4, pos + 4 + length),
    });
    pos += 4 + length;
  }
  return packets;
}

export function segment(packet, dataBytesPerSegment = 19) {
  const src = packet instanceof Uint8Array ? packet : Uint8Array.from(packet);
  if (src.length <= dataBytesPerSegment) {
    const out = new Uint8Array(1 + src.length);
    out[0] = 0x00;
    out.set(src, 1);
    return [out];
  }
  const maxIndex = Math.ceil(src.length / dataBytesPerSegment) - 1;
  const chunks = [];
  for (let i = 0; i <= maxIndex; i++) {
    const slice = src.slice(i * dataBytesPerSegment, (i + 1) * dataBytesPerSegment);
    const out = new Uint8Array(1 + slice.length);
    out[0] = (maxIndex << 4) | i;
    out.set(slice, 1);
    chunks.push(out);
  }
  return chunks;
}

export function isSegmentHeader(byte) {
  const max = byte >> 4;
  const cur = byte & 0x0f;
  return cur <= max;
}

export function createReassembler() {
  const parts = [];
  let expected = 0;
  return {
    push(chunk) {
      const data = chunk instanceof Uint8Array ? chunk : Uint8Array.from(chunk);
      if (data.length === 0) return null;
      if (!isSegmentHeader(data[0])) return data;
      const max = data[0] >> 4;
      const cur = data[0] & 0x0f;
      const body = data.slice(1);
      if (max === 0) return body;
      if (cur === 0) {
        parts.length = 0;
        expected = max;
      }
      parts[cur] = body;
      if (parts.length === expected + 1 && parts.every(Boolean)) {
        const total = parts.reduce((n, p) => n + p.length, 0);
        const out = new Uint8Array(total);
        let o = 0;
        for (const p of parts) {
          out.set(p, o);
          o += p.length;
        }
        parts.length = 0;
        return out;
      }
      return null;
    },
  };
}

function i8(n) {
  return n < 128 ? n : n - 256;
}

function cstr(bytes) {
  let end = bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      end = i;
      break;
    }
  }
  return new TextDecoder().decode(bytes.slice(0, end)).replace(/\0/g, "").trim();
}

export function parseBattery(payload) {
  if (!payload.length) return [];
  if (payload.length % 4 === 0 && payload.length >= 4) {
    const rows = [];
    for (let i = 0; i + 3 < payload.length; i += 4) {
      if (payload[i] <= 100) {
        rows.push({ level: payload[i], component: payload[i + 3] });
      }
    }
    if (rows.length) return rows;
  }
  return [{ level: payload[0], component: 0 }];
}

export function parseFirmware(payload) {
  return cstr(payload);
}

export function parseSerialNumber(payload) {
  return cstr(payload);
}

export function parseMacAddress(payload) {
  if (payload.length !== 6) return "";
  return [...payload].map((b) => b.toString(16).padStart(2, "0")).join(":").toUpperCase();
}

export function productIdOf(payload) {
  if (payload.length < 2) return 0;
  return ((payload[0] & 0xff) << 8) | (payload[1] & 0xff);
}

export function parseProductId(payload) {
  if (payload.length < 3) return "";
  const id = ((payload[0] & 0xff) << 8) | (payload[1] & 0xff);
  return `0x${id.toString(16).padStart(4, "0").toUpperCase()} · v${payload[2]}`;
}

export function parseManufactured(payload) {
  if (payload.length !== 4) return "";
  const nibbles = [];
  for (const byte of payload) nibbles.push(byte >> 4, byte & 0x0f);
  const day = nibbles[0] * 10 + nibbles[1];
  const month = nibbles[2] * 10 + nibbles[3];
  const year = nibbles[4] * 1000 + nibbles[5] * 100 + nibbles[6] * 10 + nibbles[7];
  if (!day || !month || year < 1900) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseVoicePrompts(payload) {
  if (!payload.length) return null;
  const head = payload[0];
  const language = head & 0x1f;
  const bitmap =
    payload.length >= 5
      ? ((payload[1] << 24) | (payload[2] << 16) | (payload[3] << 8) | payload[4]) >>> 0
      : 0;
  const supported = [];
  for (let id = 0; id < 23; id++) {
    if ((bitmap >>> id) & 1) supported.push(id);
  }
  return {
    enabled: Boolean((head >> 5) & 1),
    togglable: Boolean((head >> 6) & 1),
    language,
    supported,
  };
}

export function voicePromptPayload(enabled, language) {
  return Uint8Array.of(((enabled ? 1 : 0) << 5) | (language & 0x1f));
}

export function parseFlag(payload) {
  return Boolean(payload[0] & 1);
}

export function flagPayload(on) {
  return Uint8Array.of(on ? 1 : 0);
}

export function parseGuid(payload) {
  if (payload.length !== 16) return "";
  const hex = [...payload].map((b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ]
    .join("-")
    .toUpperCase();
}

export function parseComponentId(payload) {
  if (payload.length < 7) return payload.length ? `组件 ${payload[0]}` : "";
  return `组件 ${payload[0]} · ${parseMacAddress(payload.slice(1, 7))}`;
}

export function parseName(payload) {
  if (payload.length < 2) return cstr(payload);
  return cstr(payload.slice(1));
}

export function parseCnc(payload) {
  if (payload.length < 3) return null;
  return {
    steps: payload[0],
    step: payload[1],
    total: payload[0],
    enabled: Boolean(payload[2] & 0x01),
  };
}

export function parseAudioSettings(payload) {
  if (payload.length < 5) return null;
  return {
    cnc: payload[0],
    auto: payload[1] !== 0,
    spatial: payload[2],
    wind: payload[3] !== 0,
    anc: payload[4] !== 0,
  };
}

export function audioSettingsPayload(cfg) {
  return Uint8Array.of(
    cfg.cnc & 0xff,
    cfg.auto ? 1 : 0,
    cfg.spatial & 0xff,
    cfg.wind ? 1 : 0,
    cfg.anc ? 1 : 0,
  );
}

export function parseEq(payload) {
  const bands = [];
  for (let i = 0; i + 3 < payload.length; i += 4) {
    bands.push({
      id: payload[i + 3],
      min: i8(payload[i]),
      max: i8(payload[i + 1]),
      current: i8(payload[i + 2]),
    });
  }
  return bands;
}

export function parseSidetone(payload) {
  if (payload.length < 2) return 0;
  return payload[1];
}

export function parseMultipoint(payload) {
  const b = payload[0] ?? 0;
  return {
    supported: Boolean((b >> 1) & 1),
    enabled: Boolean(b & 1),
  };
}

export function parseStandby(payload) {
  if (!payload.length) return 0;
  if (payload.length < 3) return payload[0];
  return payload[0] | (payload[2] << 8);
}

export function parseConversation(payload) {
  return Boolean((payload[0] ?? 0) & 1);
}

export function parseModeCaps(payload) {
  if (!payload.length) return { bose: 0, user: 0, flags: 0 };
  return {
    bose: payload[0],
    user: payload[1] ?? 0,
    flags: payload[5] ?? 0,
  };
}

export function parseModeConfig(payload) {
  if (payload.length < 6) return null;
  const promptId = payload[2];
  const nameFromDevice = payload.length >= 38 ? cstr(payload.slice(6, 38)) : "";
  const promptName = PROMPTS[promptId] ?? "";
  return {
    index: payload[0],
    prompt: [payload[1] ?? 0, promptId],
    promptId,
    name: nameFromDevice || promptName || `模式 ${payload[0]}`,
    editable: payload[3] === 1,
    configured: payload.length > 4 ? payload[4] === 1 : true,
    favorite: payload.length > 5 ? payload[5] === 1 : false,
    cnc: payload.length > 42 ? payload[42] : null,
    auto: payload.length > 43 ? payload[43] === 1 : false,
    spatial: payload.length > 44 ? payload[44] : null,
    wind: payload.length > 46 ? payload[46] === 1 : false,
    anc: payload.length > 47 ? payload[47] === 1 : false,
  };
}

// SETGET 31.6 payload is 40 bytes: mode, prompt(2), name(32), cnc, auto, spatial, wind, anc.
// The 48-byte reply packs the same tail at 42/43/44/46/47 behind a mutability bitfield at 41.
export function modeConfigPayload(mode) {
  const out = new Uint8Array(40);
  out[0] = mode.index & 0xff;
  out[1] = mode.prompt?.[0] ?? 0;
  out[2] = mode.prompt?.[1] ?? 0;
  putCstr(out, 3, mode.name, 32);
  out[35] = (mode.cnc ?? 0) & 0xff;
  out[36] = mode.auto ? 1 : 0;
  out[37] = (mode.spatial ?? 0) & 0xff;
  out[38] = mode.wind ? 1 : 0;
  out[39] = mode.anc ? 1 : 0;
  return out;
}

function putCstr(out, offset, text, size) {
  const bytes = new TextEncoder().encode(String(text ?? "").trim());
  let n = Math.min(bytes.length, size - 1);
  while (n > 0 && (bytes[n] & 0xc0) === 0x80) n -= 1;
  out.set(bytes.slice(0, n), offset);
}

// 31.8 packs the count first, then a bitmask whose first byte holds the highest eight indices.
export function parseFavorites(payload) {
  if (!payload.length) return null;
  const count = payload[0];
  const maskBytes = Math.ceil(count / 8);
  const indices = [];
  for (let i = maskBytes; i >= 1; i--) {
    const byte = payload[i] ?? 0;
    for (let bit = 0; bit < 8; bit++) {
      if ((byte >> bit) & 1) indices.push((maskBytes - i) * 8 + bit);
    }
  }
  return { count, indices: indices.filter((index) => index < count) };
}

export function favoritesPayload(count, indices) {
  const maskBytes = Math.ceil(Math.max(1, count) / 8);
  const out = new Uint8Array(maskBytes + 1);
  out[0] = count & 0xff;
  for (const index of indices) {
    if (index < 0 || index >= count) continue;
    out[maskBytes - Math.floor(index / 8)] |= 1 << index % 8;
  }
  return out;
}

function bitsOf(bytes) {
  const bits = [];
  for (let i = 0; i < bytes.length * 8; i++) {
    if ((bytes[bytes.length - 1 - Math.floor(i / 8)] >> i % 8) & 1) bits.push(i);
  }
  return bits;
}

// 1.9 replies with button id, event type, current action, then support bitfields.
export function parseActionButton(payload) {
  if (payload.length < 3) return null;
  const supported = bitsOf(payload.slice(3, Math.min(7, payload.length))).filter((id) => id > 0);
  const unavailable =
    payload.length > 7
      ? bitsOf(payload.slice(7, Math.min(11, payload.length))).filter((id) => id > 0)
      : [];
  return {
    buttonId: payload[0],
    eventType: payload[1],
    action: payload[2],
    supported: supported.filter((id) => !unavailable.includes(id)),
    unavailable,
  };
}

export function actionButtonPayload(config, action) {
  return Uint8Array.of(config.buttonId, config.eventType, action & 0xff);
}

// 4.4: connected bitmap, then six bytes per paired device.
export function parseDeviceList(payload) {
  if (payload.length <= 1) return [];
  const connected = payload[0];
  const devices = [];
  for (let i = 1; i + 5 < payload.length; i += 6) {
    devices.push({
      mac: parseMacAddress(payload.slice(i, i + 6)),
      connected: Boolean((connected >> devices.length) & 1),
    });
  }
  return devices;
}

export function namePayload(name) {
  return new TextEncoder().encode(String(name ?? "").trim());
}

export const TRANSPORT = { play: 1, pause: 2, next: 3, prev: 4 };

export function eqPayload(value, bandId) {
  return Uint8Array.of(value & 0xff, bandId);
}

export function sidetonePayload(level) {
  return Uint8Array.of(1, level & 0xff);
}

export function modeSwitchPayload(index, voicePrompt = 1) {
  return Uint8Array.of(index & 0xff, voicePrompt ? 1 : 0);
}

export function cncPayload(level, enabled = 1) {
  return Uint8Array.of(level & 0xff, enabled ? 1 : 0);
}

export function keyOf(packet) {
  return `${packet.fblock}.${packet.func}`;
}
