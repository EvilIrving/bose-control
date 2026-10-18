import {
  FBLOCK,
  FUNC,
  OP,
  SIDETONE_LABELS,
  SPATIAL_LABELS,
  audioSettingsPayload,
  cncPayload,
  eqPayload,
  get,
  modeSwitchPayload,
  parseAudioSettings,
  parseBattery,
  parseCnc,
  parseConversation,
  parseEq,
  parseModeCaps,
  parseModeConfig,
  parseMultipoint,
  parseName,
  parseSidetone,
  parseStandby,
  setGet,
  sidetonePayload,
  start,
} from "./bmap.js";
import { BoseBle } from "./ble.js";
import { hasNative } from "./native.js";

const ble = new BoseBle();
const $ = (id) => document.getElementById(id);
const ui = {
  status: $("status"),
  meta: $("meta"),
  go: $("go"),
  goText: $("go-text"),
  hint: $("hint"),
  controls: $("controls"),
  modes: $("modes"),
  cnc: $("cnc"),
  eq: $("eq"),
  spatial: $("spatial"),
  sidetone: $("sidetone"),
  toggles: $("toggles"),
  standby: $("standby"),
};

const MODE_ZH = {
  Quiet: "安静",
  Aware: "通透",
  Immersion: "沉浸",
  Cinema: "影院",
  Transparent: "通透",
};

const STANDBY = [
  { minutes: 5, label: "5′" },
  { minutes: 20, label: "20′" },
  { minutes: 60, label: "60′" },
  { minutes: 0, label: "∞" },
];

const state = {
  modes: [],
  currentMode: null,
  eq: [],
  cnc: null,
  cfg: { cnc: 5, auto: false, spatial: 0, wind: false, anc: true },
  channel15: null,
  sidetone: null,
  multipoint: null,
  conversation: null,
  standby: null,
  name: "",
  battery: [],
  hasAudioSettings: false,
  busy: false,
  hint: "",
};

function failText(err) {
  const raw = String(err?.message || err || "");
  const name = err?.name || "";
  if (raw === "none" || name === "NotFoundError") return "没有找到耳机";
  if (raw === "off" || raw === "bluetooth") return "蓝牙没打开";
  if (raw === "denied" || name === "NotAllowedError") return "没有蓝牙权限";
  if (raw === "connect" || raw === "service" || raw === "char" || name === "NetworkError") return "连接失败";
  if (raw.includes("Web Bluetooth") || raw === "no native bridge") return "这边连不了蓝牙";
  if (raw) return "连接失败";
  return "连接失败";
}

function log(line) {
  console.debug(line);
}

function modeLabel(mode) {
  const raw = (mode.name || "").trim();
  return MODE_ZH[raw] || raw;
}

function usableModes() {
  return state.modes.filter((mode) => {
    const raw = (mode.name || "").trim();
    if (!raw || /^none$/i.test(raw) || raw === "未命名") return false;
    return true;
  });
}

function batteryText() {
  if (!state.battery.length) return "";
  if (state.battery.length === 1) return `${state.battery[0].level}%`;
  return state.battery
    .map((row) => `${row.component === 1 ? "盒" : row.component === 0 ? "左" : "右"} ${row.level}%`)
    .join(" ");
}

async function ask(packet, label, timeoutMs) {
  const reply = await ble.request(packet, timeoutMs ?? 2500);
  if (reply.op === OP.ERROR) {
    const code = reply.payload[0] ?? reply.payload[1] ?? "?";
    throw new Error(`${label} ${code}`);
  }
  return reply;
}

async function tryAsk(packet, label, timeoutMs) {
  try {
    return await ask(packet, label, timeoutMs);
  } catch (err) {
    log(err.message);
    return null;
  }
}

function pane(el, on) {
  const box = el.closest("section") ?? el;
  box.hidden = !on;
}

function chips(root, items, selected, onPick) {
  root.innerHTML = "";
  items.forEach((item, index) => {
    const label = typeof item === "string" ? item : item.label;
    const key = typeof item === "string" ? index : item.key;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (key === selected ? " on" : "");
    btn.textContent = label;
    btn.addEventListener("click", () => onPick(key));
    root.appendChild(btn);
  });
}

function renderModes() {
  const modes = usableModes();
  pane(ui.modes, modes.length > 0);
  ui.modes.innerHTML = "";
  for (const mode of modes) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (mode.index === state.currentMode ? " on" : "");
    btn.textContent = modeLabel(mode);
    btn.addEventListener("click", () => switchMode(mode.index));
    ui.modes.appendChild(btn);
  }
}

function cncMax() {
  const steps = state.cnc?.steps;
  if (!steps) return 10;
  return Math.max(0, steps - 1);
}

function cncShown() {
  if (state.cnc?.step != null) return state.cnc.step;
  if (state.cfg.cnc != null) return state.cfg.cnc;
  return 0;
}

function slider(row, { min, max, value, onChange }) {
  const track = document.createElement("div");
  track.className = "track";
  const fill = document.createElement("i");
  const num = document.createElement("b");
  let current = value;
  let held = false;
  let sendAt = 0;
  const paint = () => {
    const t = (current - min) / Math.max(1, max - min);
    fill.style.width = `${Math.max(0, Math.min(1, t)) * 100}%`;
    num.textContent = String(current);
  };
  const send = () => {
    sendAt = 0;
    onChange(current);
  };
  const apply = (clientX) => {
    const box = track.getBoundingClientRect();
    const t = (clientX - box.left) / box.width;
    current = Math.max(min, Math.min(max, Math.round(min + t * (max - min))));
    paint();
    if (!sendAt) sendAt = setTimeout(send, 80);
  };
  track.addEventListener("pointerdown", (ev) => {
    held = true;
    track.setPointerCapture(ev.pointerId);
    apply(ev.clientX);
  });
  track.addEventListener("pointermove", (ev) => {
    if (held) apply(ev.clientX);
  });
  const flush = () => {
    held = false;
    if (!sendAt) return;
    clearTimeout(sendAt);
    send();
  };
  track.addEventListener("pointerup", flush);
  track.addEventListener("pointercancel", flush);
  track.appendChild(fill);
  paint();
  row.append(track, num);
}

function renderCnc() {
  pane(ui.cnc, true);
  ui.cnc.innerHTML = "";
  ui.cnc.className = "band cnc-band";
  const max = cncMax();
  slider(ui.cnc, {
    min: 0,
    max,
    value: Math.min(cncShown(), max),
    onChange: setCnc,
  });
}

function bandRow(band) {
  const row = document.createElement("div");
  row.className = "band";
  const name = document.createElement("span");
  name.textContent = band.name;
  row.appendChild(name);
  slider(row, {
    min: band.min,
    max: band.max,
    value: band.current,
    onChange: (value) => {
      band.current = value;
      tryAsk(setGet(FBLOCK.SETTINGS, FUNC.EQ, eqPayload(value, band.id)), band.name);
    },
  });
  return row;
}

function renderEq() {
  pane(ui.eq, state.eq.length > 0);
  ui.eq.innerHTML = "";
  for (const band of state.eq) ui.eq.appendChild(bandRow(band));
}

function renderSpatial() {
  pane(ui.spatial, state.hasAudioSettings);
  if (!state.hasAudioSettings) return;
  chips(ui.spatial, SPATIAL_LABELS, state.cfg.spatial ?? 0, setSpatial);
}

function renderSidetone() {
  pane(ui.sidetone, state.sidetone != null);
  if (state.sidetone == null) return;
  chips(ui.sidetone, SIDETONE_LABELS, state.sidetone, setSidetone);
}

function renderToggles() {
  ui.toggles.innerHTML = "";
  const items = [
    { key: "wind", label: "防风噪", on: state.cfg.wind, show: state.hasAudioSettings, run: () => setWind(!state.cfg.wind) },
    { key: "mp", label: "双连", on: state.multipoint?.enabled, show: state.multipoint != null, run: () => setMultipoint(!state.multipoint.enabled) },
    { key: "talk", label: "对话", on: state.conversation, show: state.conversation != null, run: () => setConversation(!state.conversation) },
  ];
  let n = 0;
  for (const item of items) {
    if (item.show === false) continue;
    n += 1;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (item.on ? " on" : "");
    btn.textContent = item.label;
    btn.addEventListener("click", item.run);
    ui.toggles.appendChild(btn);
  }
  pane(ui.toggles, n > 0);
}

function renderStandby() {
  pane(ui.standby, state.standby != null);
  if (state.standby == null) return;
  chips(
    ui.standby,
    STANDBY.map((x) => ({ key: x.minutes, label: x.label })),
    state.standby,
    setStandby,
  );
}

function renderAll() {
  const on = ble.connected;
  const idle = !on;
  document.body.classList.toggle("idle", idle);
  ui.controls.hidden = !on;
  ui.go.classList.toggle("busy", state.busy && idle);
  ui.go.disabled = false;
  ui.goText.textContent = on ? "断开" : "连接";
  ui.hint.textContent = idle && !state.busy ? state.hint : "";
  if (!on) {
    ui.status.textContent = "";
    ui.meta.textContent = "";
    return;
  }
  ui.status.textContent = state.name || ble.name || "";
  ui.meta.textContent = batteryText();
  renderModes();
  renderCnc();
  renderEq();
  renderSpatial();
  renderSidetone();
  renderToggles();
  renderStandby();
}

async function loadDevice() {
  await tryAsk(get(FBLOCK.PRODUCT, FUNC.BMAP_VERSION), "init", 1200);

  const nameReply = await tryAsk(get(FBLOCK.SETTINGS, FUNC.NAME), "名称", 1200);
  if (nameReply) state.name = parseName(nameReply.payload) || ble.name;

  const batReply = await tryAsk(get(FBLOCK.STATUS, FUNC.BATTERY), "电量", 1200);
  if (batReply) state.battery = parseBattery(batReply.payload);

  const eqReply = await tryAsk(get(FBLOCK.SETTINGS, FUNC.EQ), "均衡", 1200);
  if (eqReply) state.eq = parseEq(eqReply.payload);

  const cfgReply = await tryAsk(get(FBLOCK.MODES, FUNC.AUDIO_SETTINGS), "音效", 1200);
  state.hasAudioSettings = false;
  if (cfgReply) {
    const cfg = parseAudioSettings(cfgReply.payload);
    if (cfg) {
      state.cfg = cfg;
      state.hasAudioSettings = true;
      state.channel15 = false;
      state.cnc = { steps: 11, step: cfg.cnc, total: 11, enabled: true };
    }
  }

  const cncReply = await tryAsk(get(FBLOCK.SETTINGS, FUNC.CNC), "降噪", 800);
  if (cncReply) {
    state.cnc = parseCnc(cncReply.payload);
    if (state.hasAudioSettings && state.cfg.cnc != null) state.cnc.step = state.cfg.cnc;
  }

  renderAll();

  const sideReply = await tryAsk(get(FBLOCK.SETTINGS, FUNC.SIDETONE), "侧音", 800);
  if (sideReply) state.sidetone = parseSidetone(sideReply.payload);

  const mpReply = await tryAsk(get(FBLOCK.SETTINGS, FUNC.MULTIPOINT), "双连", 800);
  if (mpReply) state.multipoint = parseMultipoint(mpReply.payload);

  const talkReply = await tryAsk(get(FBLOCK.SETTINGS, FUNC.CONVERSATION), "对话", 500);
  if (talkReply) state.conversation = parseConversation(talkReply.payload);

  const autoReply = await tryAsk(get(FBLOCK.SETTINGS, FUNC.STANDBY), "关机", 500);
  if (autoReply) state.standby = parseStandby(autoReply.payload);

  if (state.hasAudioSettings) {
    const ok = await writeAudioSettings({ ...state.cfg });
    log(ok ? "write-ok" : "write-fail");
  }

  renderAll();
  await loadModes();
  renderAll();
}

async function loadModes() {
  state.modes = [];
  const current = await tryAsk(get(FBLOCK.MODES, FUNC.CURRENT_MODE), "当前", 900);
  if (current?.payload.length) state.currentMode = current.payload[0];
  const caps = await tryAsk(get(FBLOCK.MODES, FUNC.MODE_CAPS), "能力", 900);
  const parsed = caps ? parseModeCaps(caps.payload) : null;
  const n = Math.min(16, parsed ? parsed.bose + parsed.user || 8 : 8);
  let miss = 0;
  for (let i = 0; i < n; i++) {
    const reply = await tryAsk(get(FBLOCK.MODES, FUNC.MODE_CONFIG, Uint8Array.of(i)), `m${i}`, 900);
    if (!reply) {
      miss += 1;
      if (miss >= 2) break;
      continue;
    }
    miss = 0;
    const mode = parseModeConfig(reply.payload);
    if (mode) state.modes.push(mode);
    renderModes();
  }
  state.modes = usableModes();
}

async function switchMode(index) {
  const reply = await tryAsk(
    start(FBLOCK.MODES, FUNC.CURRENT_MODE, modeSwitchPayload(index, 1)),
    "模式",
  );
  if (!reply) return;
  state.currentMode = index;
  renderModes();
}

async function writeAudioSettings(next) {
  const reply = await tryAsk(
    setGet(FBLOCK.MODES, FUNC.AUDIO_SETTINGS, audioSettingsPayload(next)),
    "音效",
  );
  if (!reply) return false;
  state.cfg = next;
  return true;
}

async function setSpatial(mode) {
  if (!(await writeAudioSettings({ ...state.cfg, spatial: mode }))) return;
  renderSpatial();
}

async function setWind(on) {
  if (!(await writeAudioSettings({ ...state.cfg, wind: on }))) return;
  renderToggles();
}

async function setSidetone(level) {
  const reply = await tryAsk(
    setGet(FBLOCK.SETTINGS, FUNC.SIDETONE, sidetonePayload(level)),
    "侧音",
  );
  if (!reply) return;
  state.sidetone = level;
  renderSidetone();
}

async function setMultipoint(on) {
  const reply = await tryAsk(
    setGet(FBLOCK.SETTINGS, FUNC.MULTIPOINT, Uint8Array.of(on ? 1 : 0)),
    "双连",
  );
  if (!reply) return;
  state.multipoint = { ...state.multipoint, enabled: on };
  renderToggles();
}

async function setConversation(on) {
  const reply = await tryAsk(
    setGet(FBLOCK.SETTINGS, FUNC.CONVERSATION, Uint8Array.of(on ? 1 : 0)),
    "对话",
  );
  if (!reply) return;
  state.conversation = on;
  renderToggles();
}

async function setStandby(minutes) {
  const reply = await tryAsk(
    setGet(FBLOCK.SETTINGS, FUNC.STANDBY, Uint8Array.of(minutes & 0xff)),
    "自动关",
  );
  if (!reply) return;
  state.standby = minutes;
  renderStandby();
}

async function setCnc(level) {
  if (state.hasAudioSettings || state.channel15 === false) {
    if (!(await writeAudioSettings({ ...state.cfg, cnc: level, anc: true }))) return;
  } else {
    const reply = await tryAsk(setGet(FBLOCK.SETTINGS, FUNC.CNC, cncPayload(level, 1)), "降噪", 800);
    if (reply) state.channel15 = true;
    else {
      state.channel15 = false;
      if (!(await writeAudioSettings({ ...state.cfg, cnc: level, anc: true }))) return;
    }
  }
  if (state.cnc) state.cnc.step = level;
  else state.cnc = { steps: cncMax() + 1, step: level, total: cncMax() + 1, enabled: true };
  state.cfg.cnc = level;
}

async function connect() {
  if (state.busy) return;
  state.busy = true;
  state.hint = "";
  renderAll();
  try {
    await ble.connect({ acceptAll: false });
    ui.status.textContent = ble.name || "";
    await loadDevice();
    state.hint = "";
  } catch (err) {
    log(err.message);
    state.hint = failText(err);
  }
  state.busy = false;
  renderAll();
}

ui.go.addEventListener("click", () => {
  if (state.busy) return;
  if (ble.connected) {
    ble.disconnect();
    renderAll();
    return;
  }
  connect();
});

ble.onDisconnected = () => {
  state.busy = false;
  renderAll();
};

window.__boseApp = true;
if (!navigator.bluetooth && !hasNative()) ui.go.disabled = true;
renderAll();
if (hasNative()) connect();
