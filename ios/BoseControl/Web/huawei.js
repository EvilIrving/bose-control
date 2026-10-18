import { ancModeName, eqPresetName, swipeActionName, t, tapActionName, voiceLocaleName } from "./labels.js";
import { EMPTY, bytes, createParser, decode, encode, keyOf, num, text } from "./spp.js";
import { chip, chips, fillRows, pane } from "./ui.js";

// 华为耳机的控制命令，取值来自 OpenFreebuds 的 SPP 命令表，
// 每条都在 FreeClip 2 上实际跑通过（见 tests/spp.test.mjs 里的真机回包）。
const CMD = {
  info: [0x01, 0x07],
  battery: [0x01, 0x08],
  autoPauseRead: [0x2b, 0x11],
  autoPauseWrite: [0x2b, 0x10],
  doubleRead: [0x01, 0x20],
  doubleWrite: [0x01, 0x1f],
  tripleRead: [0x01, 0x26],
  tripleWrite: [0x01, 0x25],
  longRead: [0x2b, 0x17],
  longWrite: [0x2b, 0x16],
  swipeRead: [0x2b, 0x1f],
  swipeWrite: [0x2b, 0x1e],
  eqRead: [0x2b, 0x4a],
  eqWrite: [0x2b, 0x49],
  ancRead: [0x2b, 0x2a],
  ancWrite: [0x2b, 0x04],
  lowLatency: [0x2b, 0x6c],
  qualityRead: [0x2b, 0xa3],
  qualityWrite: [0x2b, 0xa2],
  voiceRead: [0x0c, 0x02],
  voiceWrite: [0x0c, 0x01],
  dualRead: [0x2b, 0x2f],
  dualList: [0x2b, 0x31],
  dualPrefer: [0x2b, 0x32],
  dualCommand: [0x2b, 0x33],
  dualEvent: [0x2b, 0x36],
  inEar: [0x2b, 0x03],
};

const LEFT = 1;
const RIGHT = 2;

// 2b33 的用法：参数类型就是动作号，值是对端的 MAC
const PEER = { connect: 1, disconnect: 2, autoOn: 4, autoOff: 5 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createHuaweiCodec() {
  let feed = createParser();
  return {
    id: "huawei",
    // 华为的控制通道是蓝牙串口（SPP），Web Bluetooth 只给 GATT，浏览器里够不着
    ble: false,
    filters: [],
    services: [],
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
      return keyOf(packet);
    },
    header(frame) {
      return decode(frame);
    },
  };
}

function hexLookup(packet, type) {
  const value = bytes(packet, type);
  if (value.length < 6) return "";
  return [...value.slice(0, 6).reverse()].map((b) => b.toString(16).padStart(2, "0")).join(":").toUpperCase();
}

// 耳机把动作码按有符号字节发出来，0xff 就是 -1（关闭）
function codes(packet, type) {
  return [...bytes(packet, type)].map((value) => (value > 127 ? value - 256 : value));
}

function tapState(packet) {
  return {
    left: num(packet, 1),
    right: num(packet, 2),
    options: codes(packet, 3),
    inCall: num(packet, 4),
  };
}

const KEY = Object.fromEntries(
  Object.entries(CMD).map(([name, cmd]) => [cmd.join("/"), name]),
);

export class HuaweiHeadset {
  constructor({ link, ui, state, refresh, log }) {
    this.link = link;
    this.ui = ui;
    this.state = state;
    this.refresh = refresh;
    this.log = log ?? (() => {});
    this.reset();
  }

  reset() {
    this.info = {};
    this.anc = null;
    this.eq = null;
    this.gestures = null;
    this.autoPause = null;
    this.lowLatency = null;
    this.quality = null;
    this.voice = null;
    this.dual = null;
    this.inEar = null;
    this.collecting = false;
  }

  async ask(cmd, params, timeout = 2500) {
    return this.link.request(encode(cmd, params), timeout);
  }

  async read(cmd, types, timeout = 2500) {
    // 耳机连续被问会闷掉，给它留一口气
    await sleep(90);
    return this.ask(cmd, types.map((type) => [type, EMPTY]), timeout);
  }

  async tryRead(cmd, types, timeout = 900) {
    try {
      return await this.read(cmd, types, timeout);
    } catch (err) {
      this.log(err.message);
      return null;
    }
  }

  // 探测能力：先短等一次（耳机支持的命令一百毫秒内就回），没回的交给调用方决定要不要补
  async probe(cmd, types, timeout = 900) {
    return this.tryRead(cmd, types, timeout);
  }

  // 一趟能读多少读多少；onlyMissing 只补上一趟没读到的，slow 用长一点的超时再问
  async load() {
    this.reset();
    this.state.name = this.link.name || "HUAWEI";
    await this.loadPass(false, false);
    this.refresh();
    // 手势和已配对设备只影响设置页，放后台读
    void Promise.all([this.loadGestures(), this.loadDual()]).then(() => this.refresh());
    if (!this.answered()) {
      // 一条都没回来：可能连着但耳机还没醒。补一轮再判断「不支持」
      await sleep(200);
      await this.loadPass(false, true);
      this.refresh();
    } else if (this.missing()) {
      // 只缺几项（耳机刚唤醒、或者正被别的连接占着）：后台补，已经能用的界面不等
      void this.retryMissing();
    }
    return this.answered();
  }

  answered() {
    return Boolean(this.info.model || this.battery || this.eq || this.anc);
  }

  async retryMissing() {
    await sleep(150);
    await this.loadPass(true, true);
    this.refresh();
  }

  // 开关类项不在启动的关键路径上；手势和已配对设备更是只在设置页里看得到
  missing() {
    return (
      !this.info.model || !this.battery || !this.anc || !this.eq ||
      this.autoPause == null || this.lowLatency == null || this.quality == null || !this.voice
    );
  }

  async loadPass(onlyMissing, slow) {
    const jobs = [];
    const job = (condition, run) => {
      if (condition) jobs.push(run());
    };
    const infoTimeout = slow ? 2000 : 800;
    const timeout = slow ? 1500 : 600;
    // 每条命令都是独立的一问一答，没有先后依赖，一起问完拉倒
    job(!onlyMissing || !this.info.model, () =>
      this.probe(CMD.info, [...Array(32).keys()], infoTimeout).then((info) => {
        if (info) this.readInfo(info);
        this.syncInfo();
      }),
    );
    job(!onlyMissing || !this.battery, () =>
      this.probe(CMD.battery, [1, 2, 3], infoTimeout).then((battery) => {
        if (battery) this.readBattery(battery);
      }),
    );
    job(!onlyMissing || !this.anc, () =>
      this.probe(CMD.ancRead, [1, 2], timeout).then((anc) => {
        if (anc) this.readAnc(anc);
      }),
    );
    job(!onlyMissing || !this.eq, () =>
      this.probe(CMD.eqRead, [1, 2, 3, 4, 5, 6, 7, 8], timeout).then((eq) => {
        if (eq) this.readEq(eq);
      }),
    );
    job(!onlyMissing || this.autoPause == null, () =>
      this.probe(CMD.autoPauseRead, [1], timeout).then((reply) => {
        if (reply) this.autoPause = num(reply, 1) === 1;
      }),
    );
    job(!onlyMissing || this.lowLatency == null, () =>
      this.probe(CMD.lowLatency, [2], timeout).then((reply) => {
        if (reply) this.lowLatency = num(reply, 2) === 1;
      }),
    );
    job(!onlyMissing || this.quality == null, () =>
      this.probe(CMD.qualityRead, [1], timeout).then((quality) => {
        if (quality) this.readQuality(quality);
      }),
    );
    job(!onlyMissing || !this.voice, () =>
      this.probe(CMD.voiceRead, [1, 2, 3], timeout).then((voice) => {
        if (voice) this.readVoice(voice);
      }),
    );
    await Promise.all(jobs);
  }

  syncInfo() {
    const st = this.state;
    st.info = {
      productName: st.name,
      product: this.info.submodel ?? "",
      firmware: this.info.firmware ?? "",
      serial: this.info.serial ?? "",
      mac: this.info.mac ?? "",
      made: "",
      hardware: this.info.hardware ?? "",
      leftSerial: this.info.left ?? "",
      rightSerial: this.info.right ?? "",
    };
  }

  readInfo(packet) {
    this.info = {
      hardware: text(packet, 3),
      firmware: text(packet, 7),
      serial: text(packet, 9),
      submodel: text(packet, 10),
      model: text(packet, 15),
      mac: hexLookup(packet, 32),
      left: "",
      right: "",
    };
    const perEar = text(packet, 24);
    if (perEar.includes(",")) {
      const [left, right] = perEar.split(",");
      this.info.left = left.replace(/^L-/, "");
      this.info.right = right.replace(/^R-/, "");
    }
  }

  // 设备中心只想要电量，别把整套 load 跑一遍
  async probeBattery() {
    const reply = await this.tryRead(CMD.battery, [1, 2, 3], 2000);
    return reply ? this.batteryRows(reply) : null;
  }

  batteryRows(packet) {
    const parts = bytes(packet, 2);
    if (parts.length === 3) {
      return [
        { component: 0, level: parts[0] },
        { component: 1, level: parts[2] },
        { component: 2, level: parts[1] },
      ];
    }
    const level = num(packet, 1);
    return level == null ? [] : [{ component: 0, level }];
  }

  readBattery(packet) {
    const parts = bytes(packet, 2);
    const charging = bytes(packet, 3);
    this.battery = {
      global: num(packet, 1),
      left: parts[0],
      right: parts[1],
      case: parts[2],
      charging: charging.length >= 3 ? charging.reduce((sum, v) => sum + (v === 1 ? 1 : 0), 0) : 0,
    };
    // 示意图认「左 / 盒 / 右」这个顺序
    this.state.battery = this.batteryRows(packet);
  }

  readAnc(packet) {
    const data = bytes(packet, 1);
    const bitmap = num(packet, 2);
    const modes = [];
    if (bitmap == null) modes.push(0, 1, 2);
    else for (let mode = 0; mode < 3; mode++) if (bitmap & (1 << mode)) modes.push(mode);
    this.anc = { mode: data.length >= 2 ? data[1] : 0, level: data[0] ?? null, modes };
  }

  readEq(packet) {
    this.eq = { current: num(packet, 2), presets: [...bytes(packet, 3)] };
  }

  readQuality(packet) {
    this.quality = num(packet, 2);
  }

  readVoice(packet) {
    const list = text(packet, 3);
    const options = list.split(",").map((item) => item.trim()).filter(Boolean);
    this.voice = { options, current: this.voice?.current ?? "" };
  }

  // 丢一包就少一块面板的读取，补一次长超时的；其余用 probe
  async probeRetry(cmd, types, timeout = 900) {
    const first = await this.probe(cmd, types, timeout);
    return first ?? this.probe(cmd, types, timeout * 2);
  }

  async loadGestures() {
    const [double, triple, long, swipe] = await Promise.all([
      this.probeRetry(CMD.doubleRead, [1, 2, 3, 4]),
      this.probeRetry(CMD.tripleRead, [1, 2, 3, 4]),
      this.probeRetry(CMD.longRead, [1, 2, 3, 4]),
      this.probeRetry(CMD.swipeRead, [1, 2, 3]),
    ]);
    const out = {};
    if (double) out.double = tapState(double);
    if (triple) out.triple = tapState(triple);
    if (long) out.long = tapState(long);
    if (swipe) out.swipe = { value: num(swipe, 1), options: codes(swipe, 3) };
    this.gestures = Object.keys(out).length ? out : null;
  }

  async loadDual() {
    const enabled = await this.probeRetry(CMD.dualRead, [1]);
    if (!enabled) return;
    this.dual = { enabled: num(enabled, 1) === 1, devices: [] };
    await this.loadDevices();
  }

  // 耳机是一台一台把已配对设备推上来的，没有总回包，只能等一小会儿收齐
  async loadDevices() {
    if (!this.dual) return;
    this.dual.devices = [];
    this.collecting = true;
    try {
      await this.link.write(encode(CMD.dualList, [[1, EMPTY]]));
    } catch (err) {
      this.log(err.message);
    }
    await sleep(1200);
    this.collecting = false;
    this.dual.devices.sort((a, b) => a.index - b.index);
  }

  onPacket(packet) {
    const name = KEY[keyOf(packet)];
    if (name === "dualList") {
      if (!this.collecting) return;
      const mac = hexLookup(packet, 4);
      if (!mac) return;
      const state = num(packet, 5) ?? 0;
      this.dual?.devices.push({
        index: num(packet, 3) ?? 0,
        mac,
        name: text(packet, 9),
        connected: state > 0,
        playing: state === 9,
        preferred: num(packet, 7) === 1,
        autoConnect: num(packet, 8) === 1,
      });
      return;
    }
    if (name === "dualEvent") {
      this.loadDual().then(() => this.refresh());
      return;
    }
    if (name === "eqRead") {
      this.readEq(packet);
      this.refresh();
      return;
    }
    if (name === "ancRead") {
      this.readAnc(packet);
      this.refresh();
      return;
    }
    if (name === "battery") {
      this.readBattery(packet);
      this.refresh();
      return;
    }
    if (name === "inEar") {
      const value = num(packet, 8, 9);
      if (value != null) {
        this.inEar = value === 1;
        this.refresh();
      }
    }
  }

  async setAnc(mode) {
    // 写 [模式, 开关位]：正常模式第二位是 0，其余是 0xff
    try {
      await this.ask(CMD.ancWrite, [[1, [mode, mode === 0 ? 0 : 0xff]]]);
    } catch (err) {
      this.log(err.message);
      return;
    }
    const back = await this.tryRead(CMD.ancRead, [1, 2]);
    if (back) this.readAnc(back);
    this.refresh();
  }

  async setEq(id) {
    try {
      await this.ask(CMD.eqWrite, [[1, id]]);
    } catch (err) {
      this.log(err.message);
      return;
    }
    const back = await this.tryRead(CMD.eqRead, [1, 2, 3]);
    if (back) this.readEq(back);
    this.refresh();
  }

  async setAutoPause(on) {
    try {
      await this.ask(CMD.autoPauseWrite, [[1, on ? 1 : 0]]);
    } catch (err) {
      this.log(err.message);
      return;
    }
    this.autoPause = on;
    this.refresh();
  }

  async setLowLatency(on) {
    try {
      await this.ask(CMD.lowLatency, [[1, on ? 1 : 0]]);
    } catch (err) {
      this.log(err.message);
      return;
    }
    await sleep(600);
    const back = await this.tryRead(CMD.lowLatency, [2]);
    this.lowLatency = back ? num(back, 2) === 1 : on;
    this.refresh();
  }

  async setQuality(value) {
    try {
      await this.ask(CMD.qualityWrite, [[1, value]]);
    } catch (err) {
      this.log(err.message);
      return;
    }
    const back = await this.tryRead(CMD.qualityRead, [1]);
    this.quality = back ? num(back, 2) : value;
    this.refresh();
  }

  async setVoice(locale) {
    const payload = [...new TextEncoder().encode(locale)];
    try {
      await this.ask(CMD.voiceWrite, [
        [1, payload],
        [2, 1],
      ]);
    } catch (err) {
      this.log(err.message);
      return;
    }
    // 耳机不回当前语音语言，只认写入成功
    this.voice = { ...this.voice, current: locale };
    this.refresh();
  }

  async setTap(writeCmd, side, code) {
    try {
      await this.ask(writeCmd, [[side, code]]);
    } catch (err) {
      this.log(err.message);
      return;
    }
    await this.loadGestures();
    this.refresh();
  }

  macBytes(mac) {
    return Uint8Array.from(mac.split(":").map((part) => parseInt(part, 16)));
  }

  // 连接 / 断开 / 自动连接都是「发一条就走」，回包只有状态码，效果靠 2b36 事件和重新枚举确认
  async peerCommand(kind, mac) {
    try {
      await this.link.write(encode(CMD.dualCommand, [[PEER[kind], this.macBytes(mac)]]));
    } catch (err) {
      this.log(err.message);
      return;
    }
    await sleep(1500);
    await this.loadDual();
    this.refresh();
  }

  async preferPeer(mac) {
    try {
      await this.link.write(encode(CMD.dualPrefer, [[1, this.macBytes(mac)]]));
    } catch (err) {
      this.log(err.message);
      return;
    }
    await sleep(1200);
    await this.loadDual();
    this.refresh();
  }

  async refreshPeers() {
    await this.loadDual();
    this.refresh();
  }

  async setSwipe(code) {
    try {
      await this.ask(CMD.swipeWrite, [
        [1, code],
        [2, code],
      ]);
    } catch (err) {
      this.log(err.message);
      return;
    }
    await this.loadGestures();
    this.refresh();
  }

  render() {
    const ui = this.ui;
    pane(ui.modes, false);
    ui.editor.hidden = true;

    // 只有耳机真的报了「降噪」这一档，才认为它有消噪能力。
    // FreeClip 2 这类开放式耳机也会回 2b2a（正常 / 通透），但没有降噪，
    // 参考实现 OpenFreebuds 同样把它的 ANC 面板排除在外，所以这里不渲染。
    const modes = this.anc?.modes ?? [];
    const hasAnc = modes.includes(1) || (this.anc?.mode ?? 0) !== 0;
    pane(ui.cnc, hasAnc && modes.length > 1);
    if (hasAnc && modes.length > 1) {
      ui.cnc.className = "chips";
      chips(ui.cnc, modes.map((mode) => ({ key: mode, label: ancModeName(mode) })), this.anc.mode, (mode) =>
        this.setAnc(mode),
      );
    }

    pane(ui.eq, Boolean(this.eq?.presets.length));
    if (this.eq?.presets.length) {
      ui.eq.className = "chips";
      chips(
        ui.eq,
        this.eq.presets.map((id) => ({ key: id, label: eqPresetName(id) })),
        this.eq.current,
        (id) => this.setEq(id),
      );
    }

    pane(ui.spatial, false);
    pane(ui.sidetone, false);
    pane(ui.transport, false);

    const toggles = [];
    if (this.lowLatency != null) {
      toggles.push({ label: t("lowLatency"), on: this.lowLatency, run: () => this.setLowLatency(!this.lowLatency) });
    }
    if (this.autoPause != null) {
      toggles.push({ label: t("autoPause"), on: this.autoPause, run: () => this.setAutoPause(!this.autoPause) });
    }
    ui.toggles.className = "chips";
    ui.toggles.innerHTML = "";
    for (const item of toggles) {
      const btn = chip(item.label, item.on);
      btn.addEventListener("click", item.run);
      ui.toggles.appendChild(btn);
    }
    pane(ui.toggles, toggles.length > 0);

    this.renderSettings();
  }

  renderSettings() {
    const ui = this.ui;
    pane(ui.rename, false);
    pane(ui.favorites, false);
    pane(ui.standby, false);
    ui.headset.innerHTML = "";
    this.renderGestures();
    this.renderVoice();
    this.renderQuality();
    this.renderDevices();
    this.renderDiag();
  }

  renderGestures() {
    const ui = this.ui;
    const g = this.gestures;
    const box = ui.shortcut;
    box.innerHTML = "";
    ui.shortcutTitle.textContent = t("gestures");
    if (!g) {
      pane(box, false);
      return;
    }
    const rows = [];
    if (g.double) rows.push(...this.tapRows(t("doubleTap"), g.double, CMD.doubleWrite));
    if (g.triple) rows.push(...this.tapRows(t("tripleTap"), g.triple, CMD.tripleWrite));
    if (g.long) rows.push(...this.tapRows(t("longPress"), g.long, CMD.longWrite));
    if (g.swipe) {
      rows.push(
        this.gestureRow(t("swipe"), this.swipeOptions(g.swipe), g.swipe.value, (code) => this.setSwipe(code), swipeActionName),
      );
    }
    for (const row of rows) box.appendChild(row);
    pane(box, rows.length > 0);
  }

  tapRows(title, state, writeCmd) {
    const rows = [];
    for (const side of [LEFT, RIGHT]) {
      const current = side === LEFT ? state.left : state.right;
      const options = state.options.length ? state.options : [current];
      rows.push(
        this.gestureRow(
          `${title} · ${t(side === LEFT ? "left" : "right")}`,
          options,
          current,
          (code) => this.setTap(writeCmd, side, code),
          tapActionName,
        ),
      );
    }
    return rows;
  }

  swipeOptions(state) {
    // 耳机给的是 [0, 1, -1]，0 和 1 都是音量调节，只留一个
    const seen = new Set();
    const out = [];
    for (const code of state.options) {
      const label = swipeActionName(code);
      if (seen.has(label)) continue;
      seen.add(label);
      out.push(code);
    }
    return out.length ? out : [state.value];
  }

  gestureRow(title, options, current, onPick, label = (code) => String(code)) {
    const box = document.createElement("div");
    box.className = "gesture";
    const head = document.createElement("b");
    head.textContent = title;
    const list = document.createElement("div");
    list.className = "chips";
    chips(
      list,
      options.map((code) => ({ key: code, label: label(code) })),
      current,
      onPick,
    );
    box.append(head, list);
    return box;
  }

  renderVoice() {
    const voice = this.voice;
    pane(this.ui.voice, Boolean(voice?.options.length));
    if (!voice?.options.length) return;
    chips(
      this.ui.voice,
      voice.options.map((code) => ({ key: code, label: voiceLocaleName(code) })),
      voice.current,
      (code) => this.setVoice(code),
    );
  }

  renderQuality() {
    const ui = this.ui;
    pane(ui.behaviour, this.quality != null);
    if (this.quality == null) return;
    chips(
      ui.behaviour,
      [
        { key: 0, label: t("sqConnectivity") },
        { key: 1, label: t("sqQuality") },
      ],
      this.quality,
      (value) => this.setQuality(value),
    );
  }

  renderDevices() {
    const ui = this.ui;
    const dual = this.dual;
    pane(ui.devices, Boolean(dual));
    if (!dual) return;
    ui.devices.innerHTML = "";

    for (const device of dual.devices) {
      const row = document.createElement("div");
      row.className = "peer";

      const head = document.createElement("div");
      head.className = "peer-head";
      const name = document.createElement("span");
      name.textContent = device.name || device.mac;
      const state = document.createElement("b");
      state.textContent = device.playing ? t("playing") : device.connected ? t("connected") : "—";
      head.append(name, state);

      const acts = document.createElement("div");
      acts.className = "chips";
      const add = (label, on, run) => {
        const btn = chip(label, on);
        btn.addEventListener("click", run);
        acts.appendChild(btn);
        return btn;
      };
      if (device.connected) add(t("disconnect"), false, () => this.peerCommand("disconnect", device.mac));
      else add(t("connect"), false, () => this.peerCommand("connect", device.mac));
      add(t("autoConnect"), device.autoConnect, () =>
        this.peerCommand(device.autoConnect ? "autoOff" : "autoOn", device.mac),
      );
      if (device.preferred) add(t("preferred"), true, () => this.refreshPeers());
      else add(t("preferred"), false, () => this.preferPeer(device.mac));

      row.append(head, acts);
      ui.devices.appendChild(row);
    }

    const actions = document.createElement("div");
    actions.className = "chips";
    const refresh = chip(t("refresh"), false);
    refresh.addEventListener("click", () => this.refreshPeers());
    actions.appendChild(refresh);
    ui.devices.appendChild(actions);
  }

  renderDiag() {
    const ui = this.ui;
    const rows = [
      [t("bridge"), this.link.nativeOn ? "OK" : "—"],
      [t("dualConnect"), this.dual ? t(this.dual.enabled ? "stateOn" : "stateOff") : "—"],
      [t("peers"), String(this.dual?.devices.length ?? 0)],
    ];
    if (this.inEar != null) rows.push([t("inEar"), t(this.inEar ? "stateOn" : "stateOff")]);
    rows.push([t("lastError"), this.link.lastError || "—"]);
    fillRows(ui.diag, rows);
  }
}

export const huaweiBrand = {
  id: "huawei",
  label: "HUAWEI",
  // 控制走蓝牙串口，没有 GATT 通道
  transport: "spp",
  channels: [1, 2, 3],
  matches: (name) => {
    const n = String(name || "").toLowerCase();
    return ["huawei", "freebuds", "freeclip", "freelace", "honor", "荣耀", "华为"].some((key) => n.includes(key));
  },
  codec: createHuaweiCodec,
  create: (ctx) => new HuaweiHeadset(ctx),
};
