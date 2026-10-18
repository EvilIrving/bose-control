import { getLang, t } from "./labels.js";
import { chips, chip, fillRows, pane } from "./ui.js";
import { GAIA, VIVO, createGaiaCodec, encode, macBytes, macText, parseDeviceList } from "./gaia.js";

// 命令号来自 TWS-Pods-PC / HyperEars 的 vivo 逆向表，逐条在 vivo TWS 3e 上跑过；
// 多连接那组号来自官方 Android APK 反编译，并在 vivo TWS 5 上验证。
const CMD = {
  handshake: 0x0300,
  battery: 0x0207,
  noiseQuery: 0x0230,
  noiseSet: 0x0130,
  cycleQuery: 0x0231,
  cycleSet: 0x0131,
  doubleQuery: 0x0202,
  doubleSet: 0x0102,
  eqQuery: 0x0218,
  eqSet: 0x0118,
  wearQuery: 0x020d,
  find: 0x0120,
  firmware: 0x021c,
  model: 0x021b,
  serial: 0x0215,
  peerTime: 0x8509,
  replyTime: 0x0509,
  devices: 0x0249,
  devicesSet: 0x014a,
  multiToggle: 0x014c,
  deviceRemove: 0x014d,
};

// 注册通知链：发完这五条耳机才会主动推电池、佩戴、降噪
const REGISTER = [0x0202, 0x0203, 0x0204, 0x0205, 0x0206];

const NOISE = {
  0: { zh: "降噪", en: "Noise cancelling" },
  1: { zh: "关闭", en: "Off" },
  2: { zh: "通透", en: "Transparency" },
};

const EQ = {
  0: { zh: "标准", en: "Standard" },
  1: { zh: "清澈人声", en: "Clear vocal" },
  2: { zh: "超重低音", en: "Bass boost" },
  3: { zh: "清亮高音", en: "Treble boost" },
  5: { zh: "悠扬听书", en: "Audiobook" },
};

// 长按/三击触发「切换噪声控制」时的循环集合
const CYCLE = {
  0x0b: { zh: "关闭 + 通透 + 降噪", en: "Off + Transparency + NC" },
  0x0a: { zh: "通透 + 降噪", en: "Transparency + NC" },
  0x08: { zh: "关闭 + 降噪", en: "Off + NC" },
  0x09: { zh: "关闭 + 通透", en: "Off + Transparency" },
  0xff: { zh: "空", en: "Empty" },
};

// 双击动作：右耳码值 = 左耳 + 0x10，没有单独选左右的字节
const TAP = {
  0x00: { zh: "语音助手", en: "Voice assistant" },
  0x01: { zh: "播放 / 暂停", en: "Play / Pause" },
  0x02: { zh: "上一首", en: "Previous" },
  0x03: { zh: "下一首", en: "Next" },
  0x05: { zh: "翻译", en: "Translate" },
  0x06: { zh: "无", en: "Nothing" },
};

// 内部型号 id → 出厂型号名，取自 vivo 官方 App 的 tws_config.json（经 HyperEars / vivopods 整理）
const MODELS = {
  48: "DPD2135A",
  49: "DPD2135A_BLUE",
  72: "DPD2220_BASE",
  156: "DPD2430_BASE",
  176: "DPD2430F_VIVO_WHITE",
  177: "DPD2430F_VIVO_BLUE",
  180: "DPD2430F_IQOO_BLACK",
  184: "DPD2430F_JOVI_WHITE",
  190: "DPD2430F_JOVI_BLUE",
  192: "DPD2523_BASE",
  203: "DPD2523_TOP",
};

// 降噪设置尾巴（reduceModel）按型号代际不同，第三方资料只覆盖了三种。
// 与其猜型号表，不如第一次设置时按顺序试一遍、记住哪条被确认，之后固定用它。
const NOISE_SUFFIX = [[0x03], [0x03, 0x01], [0x04, 0x00]];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function nameOf(map, code) {
  const item = map[code];
  if (item) return item[getLang()] ?? item.zh;
  return `0x${Number(code).toString(16).padStart(2, "0")}`;
}

function percent(value) {
  return value != null && value >= 0 && value <= 100 ? value : null;
}

export class VivoHeadset {
  constructor({ link, ui, state, refresh, log }) {
    this.link = link;
    this.ui = ui;
    this.state = state;
    this.refresh = refresh;
    this.log = log ?? (() => {});
    this.suffix = null;
    this.reset();
  }

  reset() {
    this.battery = null;
    this.noise = null;
    this.eq = null;
    this.wear = null;
    this.cycle = null;
    this.double = null;
    this.info = {};
    this.devices = null;
    this.collecting = false;
  }

  get wire() {
    return this.link.link === "ble" ? "ble" : "spp";
  }

  // 版本用错耳机会静默不回包：握手、注册链、电量、时间应答是 v4，其余控制帧是 v3
  send(cmd, payload = [], { version = 3, timeout = 900 } = {}) {
    return this.link.request(encode(cmd, payload, { link: this.wire, version }), timeout);
  }

  async trySend(cmd, payload = [], options) {
    try {
      return await this.send(cmd, payload, options);
    } catch (err) {
      this.log(`${cmd.toString(16)}: ${err.message}`);
      return null;
    }
  }

  has(packet) {
    const payload = packet?.payload ?? new Uint8Array(0);
    return payload.length > 0 && payload[0] === 0;
  }

  async handshake() {
    const reply = await this.trySend(CMD.handshake, [], { version: 4, timeout: 2500 });
    if (reply) return true;
    // 少数机型按 v3 回；握手不通说明这条通道根本不是活的控制通道
    return Boolean(await this.trySend(CMD.handshake, [], { version: 3, timeout: 1500 }));
  }

  async register() {
    for (const cmd of REGISTER) {
      await this.trySend(cmd, [], { version: 4, timeout: 600 });
    }
  }

  async load() {
    this.reset();
    this.state.name = this.link.name || "vivo";
    if (!(await this.handshake())) return false;
    await Promise.all([this.loadBattery(), this.loadNoise(), this.loadEq(), this.loadWear(), this.loadInfo()]);
    this.refresh();
    void this.register().then(() => this.loadDevices()).then(() => this.refresh());
    return true;
  }

  async loadBattery() {
    const reply = await this.trySend(CMD.battery, [], { version: 4, timeout: 2500 });
    if (reply) this.readBattery(reply);
  }

  async loadNoise() {
    let reply = await this.trySend(CMD.noiseQuery, []);
    // 新一代按家族默认要在查询里带一个 0
    if (!reply) reply = await this.trySend(CMD.noiseQuery, [0x00]);
    if (reply) this.readNoise(reply);
  }

  async loadEq() {
    const reply = await this.trySend(CMD.eqQuery, []);
    if (reply) this.readEq(reply);
  }

  async loadWear() {
    const reply = await this.trySend(CMD.wearQuery, []);
    if (reply) this.readWear(reply);
  }

  async loadInfo() {
    const [model, firmware, serial] = await Promise.all([
      this.trySend(CMD.model, []),
      this.trySend(CMD.firmware, []),
      this.trySend(CMD.serial, []),
    ]);
    if (model) this.readModel(model);
    if (firmware) this.readFirmware(firmware);
    if (serial) this.readSerial(serial);
    this.syncInfo();
  }

  async loadDevices() {
    const reply = await this.trySend(CMD.devices, [], { timeout: 1200 });
    if (reply) this.readDevices(reply);
  }

  readBattery(packet) {
    const p = packet.payload;
    if (p.length < 4) return;
    const charge = p[4] ?? 0;
    this.battery = {
      left: percent(p[1]),
      right: percent(p[2]),
      case: percent(p[3]),
      charging: { left: Boolean(charge & 0x01), right: Boolean(charge & 0x02), case: Boolean(charge & 0x04) },
    };
    const rows = [];
    if (this.battery.left != null) rows.push({ component: 0, level: this.battery.left });
    if (this.battery.case != null) rows.push({ component: 1, level: this.battery.case });
    if (this.battery.right != null) rows.push({ component: 2, level: this.battery.right });
    // 无效读数（常见 0xFF）整项不出现，别把 0% 画上去
    this.state.battery = rows;
    this.refresh();
  }

  readNoise(packet) {
    const p = packet.payload;
    if (p.length < 2 || p[0] !== 0) return;
    this.noise = p[1];
    this.refresh();
  }

  readEq(packet) {
    const p = packet.payload;
    if (p.length < 2 || p[0] !== 0) return;
    this.eq = p[1];
    this.refresh();
  }

  readWear(packet) {
    const p = packet.payload;
    if (p.length < 2) return;
    const flags = p[1];
    this.wear = {
      leftCase: Boolean(flags & 0x01),
      rightCase: Boolean(flags & 0x02),
      leftIn: Boolean(flags & 0x04),
      rightIn: Boolean(flags & 0x08),
    };
    this.refresh();
  }

  readCycle(packet) {
    const p = packet.payload;
    if (p.length < 4 || p[0] !== 0) return;
    this.cycle = { left: p[2], right: p[3] };
    this.refresh();
  }

  readDouble(packet) {
    const p = packet.payload;
    if (p.length < 3 || p[0] !== 0) return;
    this.double = { left: p[1], right: p[2] };
    this.refresh();
  }

  readModel(packet) {
    const p = packet.payload;
    if (p.length < 2) return;
    const id = p.length >= 3 ? (p[1] << 8) | p[2] : p[1];
    this.info.modelId = id;
    this.info.model = MODELS[id] ?? `0x${id.toString(16)}`;
    this.syncInfo();
  }

  // 紧凑二进制，不是字符串：00 01 02 03 04 05 09 0C → 2.5.9（第 2 / 5 / 6 字节）
  readFirmware(packet) {
    const p = packet.payload;
    if (p.length < 7) return;
    const parts = [p[2], p[5], p[6]];
    this.info.firmware = parts.every((n) => n <= 99) ? parts.join(".") : [...p].map((b) => b.toString(16).padStart(2, "0")).join("");
    this.syncInfo();
  }

  readSerial(packet) {
    const p = packet.payload;
    if (p.length < 2) return;
    const body = p.slice(1);
    const text = new TextDecoder("utf-8").decode(body).replace(/\0+$/, "");
    this.info.serial = /^[\x20-\x7e]+$/.test(text) ? text : "";
    this.syncInfo();
  }

  readDevices(packet) {
    const entries = parseDeviceList(packet.payload);
    this.devices = entries.map((entry) => ({
      mac: macText(entry.mac),
      raw: entry.mac,
      state: entry.state,
      name: entry.name,
    }));
    // 状态 2 = 已连接且当前活动设备，也就是本机
    this.local = this.devices.find((device) => device.state === 2)?.mac ?? this.local ?? "";
    this.syncInfo();
  }

  syncInfo() {
    const st = this.state;
    st.info = {
      productName: st.name,
      product: this.info.model ?? "",
      firmware: this.info.firmware ?? "",
      serial: this.info.serial ?? "",
      mac: this.local ?? "",
      hardware: this.info.modelId ? `id ${this.info.modelId}` : "",
    };
    this.refresh();
  }

  onPacket(packet) {
    switch (packet.cmd) {
      case 0x8207:
        return this.readBattery(packet);
      case 0x8230:
      case 0x8130:
        return this.readNoise(packet);
      case 0x8218:
      case 0x8118:
        return this.readEq(packet);
      case 0x820d:
        return this.readWear(packet);
      case 0x8231:
      case 0x8131:
        return this.readCycle(packet);
      case 0x8202:
        return this.readDouble(packet);
      case 0x821b:
        return this.readModel(packet);
      case 0x821c:
        return this.readFirmware(packet);
      case 0x8215:
        return this.readSerial(packet);
      case 0x8249:
        return this.readDevices(packet);
      case CMD.peerTime:
        // 耳机主动索要手机时间，主机必须应答，否则这条链一直等
        return void this.replyTime();
      default:
        return undefined;
    }
  }

  async replyTime() {
    const now = new Date();
    const payload = [
      Math.floor(now.getFullYear() / 100),
      now.getFullYear() % 100,
      now.getMonth() + 1,
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
    ];
    await this.trySend(CMD.replyTime, payload, { version: 4, timeout: 800 });
  }

  async setNoise(mode) {
    const tried = this.suffix ? [this.suffix] : NOISE_SUFFIX;
    for (const suffix of tried) {
      const reply = await this.trySend(CMD.noiseSet, [mode, ...suffix], { timeout: 1500 });
      if (reply && this.has(reply)) {
        this.suffix = suffix;
        this.noise = mode;
        this.refresh();
        return;
      }
    }
    this.log("设置降噪没有回包");
  }

  async setEq(id) {
    const ack = await this.trySend(CMD.eqSet, [id], { timeout: 1500 });
    const back = await this.trySend(CMD.eqQuery, []);
    if (back) this.readEq(back);
    else if (ack && this.has(ack)) {
      this.eq = id;
      this.refresh();
    }
  }

  async setCycle(side, code) {
    if (!this.cycle) return;
    const next = { ...this.cycle, [side]: code };
    const reply = await this.trySend(CMD.cycleSet, [0x05, next.left, next.right], { timeout: 1500 });
    if (reply && this.has(reply)) {
      this.cycle = next;
      this.refresh();
    }
  }

  async setDouble(side, code) {
    if (!this.double) return;
    const next = { ...this.double, [side]: code };
    const reply = await this.trySend(CMD.doubleSet, [next.left, next.right], { timeout: 1500 });
    if (reply && this.has(reply)) {
      this.double = next;
      this.refresh();
    }
  }

  async find() {
    await this.trySend(CMD.find, [0x01], { timeout: 1200 });
  }

  // 0x014A 收的是全量列表，每台 7 字节。只改目标那一台，其余必须原样回传：
  // 把它们统一写成 1 会把当前活动设备从 0x02 降级成 0x01。
  async writeDevices(target, state) {
    if (!this.devices?.length) return false;
    const payload = [];
    for (const device of this.devices) {
      const value = device.mac === target ? state : device.state;
      payload.push(...device.raw, value);
    }
    const reply = await this.trySend(CMD.devicesSet, payload, { timeout: 1500 });
    if (!reply) return false;
    await sleep(600);
    await this.loadDevices();
    return this.has(reply);
  }

  async switchDevice(mac) {
    await this.writeDevices(mac, 0x02);
  }

  async dropDevice(mac) {
    await this.writeDevices(mac, 0x00);
  }

  async removeDevice(mac) {
    const local = macBytes(this.local);
    const target = macBytes(mac);
    if (!local || !target) return;
    await this.trySend(CMD.deviceRemove, [...target, ...local], { timeout: 1500 });
    await sleep(600);
    await this.loadDevices();
  }

  render() {
    const ui = this.ui;
    pane(ui.modes, false);
    pane(ui.cnc, this.noise != null);
    if (this.noise != null) {
      ui.cnc.className = "chips";
      chips(
        ui.cnc,
        Object.keys(NOISE).map((mode) => ({ key: Number(mode), label: nameOf(NOISE, mode) })),
        this.noise,
        (mode) => this.setNoise(mode),
      );
    }

    pane(ui.eq, this.eq != null);
    if (this.eq != null) {
      ui.eq.className = "chips";
      chips(
        ui.eq,
        Object.keys(EQ).map((id) => ({ key: Number(id), label: nameOf(EQ, id) })),
        this.eq,
        (id) => this.setEq(id),
      );
    }

    pane(ui.spatial, false);
    pane(ui.sidetone, false);
    pane(ui.transport, false);
    pane(ui.toggles, false);
    this.renderSettings();
  }

  renderSettings() {
    const ui = this.ui;
    pane(ui.rename, false);
    pane(ui.favorites, false);
    pane(ui.standby, false);
    pane(ui.voice, false);
    pane(ui.behaviour, false);
    this.renderActions();
    this.renderGestures();
    this.renderDevices();
    this.renderDiag();
  }

  renderActions() {
    const box = this.ui.headset;
    box.innerHTML = "";
    const button = chip(getLang() === "zh" ? "查找耳机" : "Find earbuds", false);
    button.addEventListener("click", () => this.find());
    box.appendChild(button);
    pane(box, true);
  }

  renderGestures() {
    const ui = this.ui;
    const box = ui.shortcut;
    box.innerHTML = "";
    ui.shortcutTitle.textContent = t("gestures");
    const rows = [];
    if (this.cycle) {
      rows.push(this.row(`${t("longPress")} · ${t("left")}`, Object.keys(CYCLE), this.cycle.left, (code) => this.setCycle("left", code), (code) => nameOf(CYCLE, code)));
      rows.push(this.row(`${t("longPress")} · ${t("right")}`, Object.keys(CYCLE), this.cycle.right, (code) => this.setCycle("right", code), (code) => nameOf(CYCLE, code)));
    }
    if (this.double) {
      const left = Object.keys(TAP).map(Number);
      const right = left.map((code) => code + 0x10);
      // 右耳的码值 = 左耳 + 0x10，名字表只按左耳存
      const tapName = (code) => nameOf(TAP, code & 0x0f);
      rows.push(this.row(`${t("doubleTap")} · ${t("left")}`, left, this.double.left, (code) => this.setDouble("left", code), tapName));
      rows.push(this.row(`${t("doubleTap")} · ${t("right")}`, right, this.double.right, (code) => this.setDouble("right", code), tapName));
    }
    for (const row of rows) box.appendChild(row);
    pane(box, rows.length > 0);
  }

  row(title, options, current, onPick, label) {
    const box = document.createElement("div");
    box.className = "gesture";
    const head = document.createElement("b");
    head.textContent = title;
    const list = document.createElement("div");
    list.className = "chips";
    chips(
      list,
      options.map((code) => ({ key: Number(code), label: label(Number(code)) })),
      current,
      onPick,
    );
    box.append(head, list);
    return box;
  }

  renderDevices() {
    const ui = this.ui;
    pane(ui.devices, Boolean(this.devices?.length));
    if (!this.devices?.length) return;
    ui.devices.innerHTML = "";
    for (const device of this.devices) {
      const row = document.createElement("div");
      row.className = "peer";
      const head = document.createElement("div");
      head.className = "peer-head";
      const name = document.createElement("span");
      name.textContent = device.name || device.mac;
      const state = document.createElement("b");
      state.textContent =
        device.state === 0x02 ? t("playing") : device.state === 0x01 ? t("connected") : t("notConnected");
      head.append(name, state);

      const acts = document.createElement("div");
      acts.className = "chips";
      const add = (label, on, run) => {
        const button = chip(label, on);
        button.addEventListener("click", run);
        acts.appendChild(button);
      };
      if (device.mac !== this.local) {
        add(t("connect"), false, () => this.switchDevice(device.mac));
        add(t("disconnect"), false, () => this.dropDevice(device.mac));
        add(t("remove"), false, () => this.removeDevice(device.mac));
      }
      row.append(head, acts);
      ui.devices.appendChild(row);
    }
  }

  renderDiag() {
    const rows = [
      [t("bridge"), this.wire === "ble" ? "BLE GATT" : "SPP"],
      [t("inEar"), this.wear ? this.wearText(this.wear) : "—"],
      [t("peers"), String(this.devices?.length ?? 0)],
      [t("lastError"), this.link.lastError || "—"],
    ];
    fillRows(this.ui.diag, rows);
  }

  wearText(wear) {
    const side = (inEar, inCase) => (inEar ? t("stateOn") : inCase ? t("notConnected") : t("stateOff"));
    return `${t("left")} ${side(wear.leftIn, wear.leftCase)} · ${t("right")} ${side(wear.rightIn, wear.rightCase)}`;
  }
}

export const vivoBrand = {
  id: "vivo",
  label: "vivo / iQOO",
  // 官方 Android App 走私有串口，官方 iOS App 走 BLE GATT；两条都能用，帧封装不同
  transport: "spp",
  alt: "ble",
  // vivo 的端口号没有文档，只能按 SDP 里的私有服务 UUID 找
  channels: [],
  services: ["00000837-d102-11e1-9b23-00025b00a5a5"],
  matches: (name) => {
    const n = String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!n) return false;
    if (["bose", "huawei", "freebuds", "freeclip", "honor"].some((key) => n.includes(key))) return false;
    return n.startsWith("vivo") || n.startsWith("iqoo") || n.includes("vivotws") || n.includes("iqootws");
  },
  codec: createGaiaCodec,
  create: (ctx) => new VivoHeadset(ctx),
};

export { CMD as VIVO_CMD, VIVO, GAIA };
