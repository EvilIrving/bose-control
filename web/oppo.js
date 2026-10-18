import { getLang, t } from "./labels.js";
import {
  ANC,
  CMD,
  EMPTY,
  EQ_PRESETS,
  HELLO,
  MSG,
  TOPIC,
  ancSetPayload,
  batteryRows,
  buildRequest,
  buildSet,
  countRequest,
  createParser,
  decodeAnc,
  decodeBattery,
  decodeEqPreset,
  decodeEqPush,
  decodeFirmware,
  decodeProductId,
  decodeTouch,
  decodeWear,
  eqSetPayload,
  findPayload,
  header,
  key,
  touchSetPayload,
} from "./opo.js";
import { chip, chips, fillRows, pane } from "./ui.js";

// 两个控制服务 UUID 都出现过；Buds 4 按 UUID 连接，RFCOMM 通道号由系统 SDP 解析。
export const SERVICES = [
  "0000079a-d102-11e1-9b23-00025b00a5a5",
  "00001107-d102-11e1-9b23-00025b00a5a5",
];

// 单条读取 900ms，握手给长一点的 2s —— 耳机刚被唤醒时第一条命令经常要等。
const ASK_TIMEOUT = 900;
const HELLO_TIMEOUT = 2000;

const ANC_ORDER = [ANC.off, ANC.cancelling, ANC.transparency, ANC.adaptive];

// 四个主档掩码在 Buds 4 上 confirmed。子档 0x0020 / 0x0040 / 0x0080 只有 likely / assumed，
// 不画第二排，也不发出去。
const ANC_NAMES = {
  [ANC.off]: { zh: "关闭", en: "Off" },
  [ANC.cancelling]: { zh: "降噪", en: "Noise Cancellation" },
  [ANC.transparency]: { zh: "通透", en: "Transparency" },
  [ANC.adaptive]: { zh: "自适应", en: "Adaptive" },
};

// 预设名对应 opo.js 里 Buds 4 实测的预设号；表里没有的号按数字显示，不猜名字。
const PRESET_NAMES = {
  balanced: { zh: "均衡", en: "Balanced" },
  serenade: { zh: "小夜曲", en: "Serenade" },
  bass: { zh: "低音", en: "Bass" },
  custom: { zh: "自定义", en: "Custom" },
};

// 0x0108 动作码里文档给了名字的部分；0x07 / 0x1C / 0x1D 没命名，按数字显示。
const ACTION_NAMES = {
  0x00: { zh: "无动作", en: "Nothing" },
  0x01: { zh: "播放/暂停", en: "Play/Pause" },
  0x03: { zh: "语音助手", en: "Voice Assistant" },
  0x05: { zh: "上一曲", en: "Previous" },
  0x06: { zh: "下一曲", en: "Next" },
  0x08: { zh: "噪声控制", en: "Noise Control" },
};

// 通用手势里只有这三个有真机名字（Gadgetbridge 的 16 位码 0201/0301/0401 拆成 type+gesture）。
const GESTURES = [
  { gesture: 0x02, key: "doubleTap" },
  { gesture: 0x03, key: "tripleTap" },
  { gesture: 0x04, key: "longPress" },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function presetName(id) {
  const item = PRESET_NAMES[EQ_PRESETS[id]];
  if (item) return item[getLang()];
  return getLang() === "zh" ? `预设 ${id}` : `Preset ${id}`;
}

function ancName(mask) {
  const item = ANC_NAMES[mask];
  return item ? item[getLang()] : `0x${mask.toString(16).padStart(4, "0").toUpperCase()}`;
}

function actionName(code) {
  const item = ACTION_NAMES[code];
  if (item) return item[getLang()];
  const hex = code.toString(16).padStart(2, "0").toUpperCase();
  return getLang() === "zh" ? `动作 0x${hex}` : `Action 0x${hex}`;
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// 用读回来的整张表做预期值：只改目标记录的 action 字节，其余原样留着。
function editedTable(before, record, action) {
  const expected = before.slice();
  for (let at = 2; at + 3 < expected.length; at += 4) {
    if (expected[at] === record.side && expected[at + 1] === record.type && expected[at + 2] === record.gesture) {
      expected[at + 3] = action & 0xff;
      return expected;
    }
  }
  return null;
}

export function createOpoCodec() {
  let feed = createParser();
  return {
    id: "oppo",
    // 控制通道是经典蓝牙 RFCOMM，Web Bluetooth 只给 GATT，浏览器里够不着
    ble: false,
    filters: [],
    services: SERVICES,
    reset() {
      feed = createParser();
    },
    chunks(frame) {
      return [frame];
    },
    parse(chunk) {
      return feed(chunk);
    },
    key(packet) {
      return key(packet);
    },
    header(frame) {
      return header(frame);
    },
  };
}

export class OppoHeadset {
  constructor({ link, ui, state, refresh, log }) {
    this.link = link;
    this.ui = ui;
    this.state = state;
    this.refresh = refresh;
    this.log = log ?? (() => {});
    this.reset();
  }

  reset() {
    this.seq = 0;
    this.info = {};
    this.battery = null;
    this.anc = null;
    this.eq = null;
    this.wear = null;
    this.touch = null;
  }

  // 回包按 cmdId:seq 配对，所以每条请求都要有自己的 seq；0xFF 留给推送。
  nextSeq() {
    this.seq = this.seq >= 0xfe ? 1 : this.seq + 1;
    return this.seq;
  }

  ask(cmd, payload = EMPTY, timeout = ASK_TIMEOUT) {
    return this.link.request(buildRequest(cmd, payload, this.nextSeq()), timeout);
  }

  // 写操作是消息类型 0x04，回包是 0x84；用 ask() 发会被设备当成读请求。
  askSet(cmd, payload = EMPTY, timeout = ASK_TIMEOUT) {
    return this.link.request(buildSet(cmd, payload, this.nextSeq()), timeout);
  }

  async tryRead(cmd, payload = EMPTY, timeout = ASK_TIMEOUT) {
    try {
      return await this.ask(cmd, payload, timeout);
    } catch (err) {
      this.log(err.message);
      return null;
    }
  }

  async handshake() {
    try {
      await this.link.request(HELLO, HELLO_TIMEOUT);
      return true;
    } catch (err) {
      this.log(err.message);
      return false;
    }
  }

  async load() {
    this.reset();
    this.state.name = this.link.name || "OPPO";
    if (!(await this.handshake())) return false;
    await this.readAll();
    this.refresh();
    if (!this.answered()) {
      // 握手回来了但所有读取都超时：耳机可能刚被唤醒，补一轮再画界面。
      await sleep(200);
      await this.readAll();
      this.refresh();
    }
    return true;
  }

  answered() {
    return Boolean(this.battery || this.wear || this.touch || this.info.firmware) || this.anc != null || this.eq != null;
  }

  // 每条都是独立的一问一答，没有先后依赖，全部一起发；单条超时不影响别的。
  async readAll() {
    const [battery, anc, eq, wear, touch, firmware, product] = await Promise.all([
      this.tryRead(CMD.battery),
      this.tryRead(CMD.anc, countRequest([0x01])),
      this.tryRead(CMD.eq),
      this.tryRead(CMD.wear),
      this.tryRead(CMD.touch),
      this.tryRead(CMD.firmware),
      this.tryRead(CMD.productId),
    ]);
    if (battery) this.setBattery(battery.payload);
    if (anc) this.setAnc(anc.payload);
    if (eq) this.setEq(eq.payload);
    if (wear) this.setWear(wear.payload);
    if (touch) this.touch = decodeTouch(touch.payload);
    if (firmware) this.info.firmware = decodeFirmware(firmware.payload);
    if (product) this.info.product = decodeProductId(product.payload);
    this.syncInfo();
  }

  syncInfo() {
    this.state.info = {
      productName: this.state.name,
      product: this.info.product ?? "",
      firmware: this.info.firmware ?? "",
      serial: "",
      mac: "",
      hardware: "",
    };
  }

  setBattery(payload) {
    const rows = decodeBattery(payload);
    const battery = batteryRows(payload);
    if (!battery.length) return;
    this.battery = rows;
    this.state.battery = battery;
  }

  setAnc(payload) {
    const mask = decodeAnc(payload);
    if (mask != null) this.anc = mask;
  }

  setEq(payload) {
    const preset = decodeEqPreset(payload);
    if (preset != null) this.eq = preset;
  }

  setWear(payload) {
    const rows = decodeWear(payload);
    if (rows.length) this.wear = rows;
  }

  // 推送是主通道：0x0204 按第一个字节分主题（电池 / 佩戴 / 降噪），0x0504 直接带预设号。
  onPacket(packet) {
    if (packet.msgType === MSG.notify && packet.cmdId === 0x04) {
      const topic = packet.payload[0];
      if (topic === TOPIC.battery) this.setBattery(packet.payload);
      else if (topic === TOPIC.wear) this.setWear(packet.payload);
      else if (topic === TOPIC.anc) this.setAnc(packet.payload);
      else return;
      this.refresh();
      return;
    }
    if (packet.msgType === MSG.notifyAlt && packet.cmdId === 0x04) {
      const preset = decodeEqPush(packet.payload);
      if (preset == null) return;
      this.eq = preset;
      this.refresh();
    }
  }

  async setNoise(mask) {
    if (!ANC_NAMES[mask]) return;
    try {
      await this.askSet(CMD.ancSet, ancSetPayload(mask));
    } catch (err) {
      this.log(err.message);
      return;
    }
    // ack 只证明参数没被拒，状态是否真的变了要回读 0x010C。
    await sleep(600);
    const back = await this.tryRead(CMD.anc, countRequest([0x01]));
    if (back) this.setAnc(back.payload);
    this.refresh();
  }

  async setPreset(id) {
    // 固件不校验预设号（0x00-0x07 全收），客户端必须自己挡住表外的值。
    if (!EQ_PRESETS[id]) return;
    try {
      await this.askSet(CMD.eqSet, eqSetPayload(id));
    } catch (err) {
      this.log(err.message);
      return;
    }
    // 写后必须回读 0x010F 确认；0x0504 推送也会带来新值。
    await sleep(400);
    const back = await this.tryRead(CMD.eq);
    if (back) this.setEq(back.payload);
    this.refresh();
  }

  async setGesture(target, action) {
    // 先读整张表，用读到的 side/type/gesture 原样回传，只换 action；写完再读一遍，
    // 逐字节确认全表只有目标那一个字节变了。
    const before = await this.tryRead(CMD.touch);
    if (!before) {
      this.log("0x0108 读取超时，未写手势");
      return;
    }
    const table = decodeTouch(before.payload);
    const record = table.records.find(
      (item) => item.side === target.side && item.type === target.type && item.gesture === target.gesture,
    );
    if (!record) return;
    const expected = editedTable(table.raw, record, action);
    try {
      await this.askSet(CMD.touchSet, touchSetPayload(record, action));
    } catch (err) {
      this.log(err.message);
      return;
    }
    await sleep(500);
    const after = await this.tryRead(CMD.touch);
    if (after) {
      const next = decodeTouch(after.payload);
      this.touch = next;
      if (!expected || !sameBytes(expected, next.raw)) this.log("手势表回读与预期不一致");
    }
    this.refresh();
  }

  // 提示音几秒后自己停，协议里没有停止命令，所以发完即结束，不做「停止」控件。
  async find(ids) {
    try {
      await this.askSet(CMD.findDevice, findPayload(ids));
    } catch (err) {
      this.log(err.message);
    }
  }

  render() {
    const ui = this.ui;
    pane(ui.modes, false);
    ui.editor.hidden = true;
    pane(ui.spatial, false);
    pane(ui.sidetone, false);
    pane(ui.transport, false);

    // 读不到就整块不画，不拿某个型号的固定值当默认。
    pane(ui.cnc, this.anc != null);
    if (this.anc != null) {
      ui.cnc.className = "chips";
      chips(
        ui.cnc,
        ANC_ORDER.map((mask) => ({ key: mask, label: ancName(mask) })),
        this.anc,
        (mask) => this.setNoise(mask),
      );
    }

    pane(ui.eq, this.eq != null);
    if (this.eq != null) {
      ui.eq.className = "chips";
      chips(
        ui.eq,
        Object.keys(EQ_PRESETS).map(Number).map((id) => ({ key: id, label: presetName(id) })),
        this.eq,
        (id) => this.setPreset(id),
      );
    }

    // 0x010D 的 17 个 feature id 没有可信名字（文档明说仍未命名），不画猜测出来的开关。
    ui.toggles.className = "chips";
    ui.toggles.innerHTML = "";
    pane(ui.toggles, false);

    this.renderSettings();
  }

  renderSettings() {
    const ui = this.ui;
    pane(ui.rename, false);
    pane(ui.favorites, false);
    pane(ui.voice, false);
    pane(ui.behaviour, false);
    pane(ui.standby, false);
    this.renderFind();
    this.renderGestures();
    // 已配对设备（0x0112）不在这一版要做的命令表里，面板保持隐藏。
    pane(ui.devices, false);
    this.renderDiag();
  }

  renderFind() {
    const box = this.ui.headset;
    box.innerHTML = "";
    const targets = [
      { ids: [0x01], label: t("left") },
      { ids: [0x02], label: t("right") },
      { ids: [0x01, 0x02], label: `${t("left")} + ${t("right")}` },
    ];
    for (const target of targets) {
      const btn = chip(target.label, false);
      btn.addEventListener("click", () => this.find(target.ids));
      box.appendChild(btn);
    }
    pane(box, true);
  }

  renderGestures() {
    const ui = this.ui;
    const box = ui.shortcut;
    box.innerHTML = "";
    ui.shortcutTitle.textContent = t("gestures");
    const general = (this.touch?.records ?? []).filter((record) => record.type === 0x01);
    if (!general.length) {
      pane(box, false);
      return;
    }
    // 可选动作只从设备自己存着的表里取，不发明设备没存过的动作码。
    const actions = [...new Set(general.map((record) => record.action))].sort((a, b) => a - b);
    for (const item of GESTURES) {
      for (const side of [0x01, 0x02]) {
        const record = general.find((row) => row.gesture === item.gesture && row.side === side);
        if (!record) continue;
        box.appendChild(this.gestureRow(item, side, record.action, actions));
      }
    }
    pane(box, box.childElementCount > 0);
  }

  gestureRow(item, side, current, actions) {
    const box = document.createElement("div");
    box.className = "gesture";
    const head = document.createElement("b");
    head.textContent = `${t(item.key)} · ${t(side === 0x01 ? "left" : "right")}`;
    const list = document.createElement("div");
    list.className = "chips";
    chips(
      list,
      actions.map((action) => ({ key: action, label: actionName(action) })),
      current,
      (action) => this.setGesture({ side, type: 0x01, gesture: item.gesture }, action),
    );
    box.append(head, list);
    return box;
  }

  renderDiag() {
    const rows = [];
    for (const side of [0x01, 0x02]) {
      const row = this.wear?.find((item) => item.id === side);
      if (!row) continue;
      rows.push([`${t("inEar")} · ${t(side === 0x01 ? "left" : "right")}`, t(row.inEar ? "stateOn" : "stateOff")]);
    }
    rows.push([t("lastError"), this.link.lastError || "—"]);
    fillRows(this.ui.diag, rows);
  }
}

export const oppoBrand = {
  id: "oppo",
  label: "OPPO / OnePlus",
  // 控制走经典蓝牙 RFCOMM，没有 GATT 通道
  transport: "spp",
  channels: [1, 2, 3],
  services: SERVICES,
  matches: (name) => {
    const n = String(name || "").toLowerCase();
    if (["bose", "huawei", "华为"].some((hint) => n.includes(hint))) return false;
    return ["oppo", "enco", "oneplus", "realme"].some((hint) => n.includes(hint));
  },
  codec: createOpoCodec,
  create: (ctx) => new OppoHeadset(ctx),
};
