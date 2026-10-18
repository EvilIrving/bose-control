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
};

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

async function ask(packet, label) {
  const reply = await ble.request(packet);
  if (reply.op === OP.ERROR) {
    const code = reply.payload[0] ?? reply.payload[1] ?? "?";
    throw new Error(`${label} ${code}`);
  }
  return reply;
}

async function tryAsk(packet, label) {
  try {
    return await ask(packet, label);
  } catch (err) {
    log(err.message);
    return null;
  }
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
  ui.modes.innerHTML = "";
  for (const mode of usableModes()) {
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

function renderCnc() {
  const max = cncMax();
  const shown = Math.min(cncShown(), max);
  ui.cnc.innerHTML = "";
  for (let i = 0; i <= max; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = String(i);
    if (i === shown) btn.className = "on";
    btn.addEventListener("click", () => setCnc(i));
    ui.cnc.appendChild(btn);
  }
}

function bandRow(band) {
  const row = document.createElement("div");
  row.className = "band";
  const name = document.createElement("span");
  name.textContent = band.name;
  const track = document.createElement("div");
  track.className = "track";
  const fill = document.createElement("i");
  const num = document.createElement("b");
  const paint = () => {
    const t = (band.current - band.min) / Math.max(1, band.max - band.min);
    fill.style.width = `${Math.max(0, Math.min(1, t)) * 100}%`;
    num.textContent = String(band.current);
  };
  const apply = async (clientX) => {
    const box = track.getBoundingClientRect();
    const t = (clientX - box.left) / box.width;
    const value = Math.round(band.min + t * (band.max - band.min));
    band.current = Math.max(band.min, Math.min(band.max, value));
    paint();
    await tryAsk(setGet(FBLOCK.SETTINGS, FUNC.EQ, eqPayload(band.current, band.id)), band.name);
  };
  track.addEventListener("pointerdown", (ev) => {
    track.setPointerCapture(ev.pointerId);
    apply(ev.clientX);
  });
  track.addEventListener("pointermove", (ev) => {
    if (ev.buttons) apply(ev.clientX);
  });
  track.appendChild(fill);
  paint();
  row.append(name, track, num);
  return row;
}

function renderEq() {
  ui.eq.innerHTML = "";
  for (const band of state.eq) ui.eq.appendChild(bandRow(band));
}

function renderSpatial() {
  if (!state.hasAudioSettings) {
    ui.spatial.hidden = true;
    return;
  }
  ui.spatial.hidden = false;
  chips(ui.spatial, SPATIAL_LABELS, state.cfg.spatial ?? 0, setSpatial);
}

function renderSidetone() {
  if (state.sidetone == null) {
    ui.sidetone.hidden = true;
    return;
  }
  ui.sidetone.hidden = false;
  chips(ui.sidetone, SIDETONE_LABELS, state.sidetone, setSidetone);
}

function renderToggles() {
  ui.toggles.innerHTML = "";
  const items = [
    { key: "wind", label: "防风噪", on: state.cfg.wind, show: state.hasAudioSettings, run: () => setWind(!state.cfg.wind) },
    { key: "mp", label: "双连", on: state.multipoint?.enabled, show: state.multipoint != null, run: () => setMultipoint(!state.multipoint.enabled) },
    { key: "talk", label: "对话", on: state.conversation, show: state.conversation != null, run: () => setConversation(!state.conversation) },
  ];
  for (const item of items) {
    if (item.show === false) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (item.on ? " on" : "");
    btn.textContent = item.label;
    btn.addEventListener("click", item.run);
    ui.toggles.appendChild(btn);
  }
}

function renderStandby() {
  if (state.standby == null) {
    ui.standby.hidden = true;
    return;
  }
  ui.standby.hidden = false;
  chips(
    ui.standby,
    STANDBY.map((x) => ({ key: x.minutes, label: x.label })),
    state.standby,
    setStandby,
  );
}

function renderAll() {
  const on = ble.connected;
  ui.controls.hidden = !on;
  ui.go.textContent = on ? "断开" : "连接";
  ui.go.disabled = false;
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
  await tryAsk(get(FBLOCK.PRODUCT, FUNC.BMAP_VERSION), "init");

  const nameReply = await tryAsk(get(FBLOCK.SETTINGS, FUNC.NAME), "名称");
  if (nameReply) state.name = parseName(nameReply.payload) || ble.name;

  const batReply = await tryAsk(get(FBLOCK.STATUS, FUNC.BATTERY), "电量");
  if (batReply) state.battery = parseBattery(batReply.payload);

  const eqReply = await tryAsk(get(FBLOCK.SETTINGS, FUNC.EQ), "均衡");
  if (eqReply) state.eq = parseEq(eqReply.payload);

  const cncReply = await tryAsk(get(FBLOCK.SETTINGS, FUNC.CNC), "降噪");
  if (cncReply) state.cnc = parseCnc(cncReply.payload);

  const cfgReply = await tryAsk(get(FBLOCK.MODES, FUNC.AUDIO_SETTINGS), "音效");
  state.hasAudioSettings = false;
  if (cfgReply) {
    const cfg = parseAudioSettings(cfgReply.payload);
    if (cfg) {
      state.cfg = cfg;
      state.hasAudioSettings = true;
    }
  }

  const sideReply = await tryAsk(get(FBLOCK.SETTINGS, FUNC.SIDETONE), "侧音");
  if (sideReply) state.sidetone = parseSidetone(sideReply.payload);

  const mpReply = await tryAsk(get(FBLOCK.SETTINGS, FUNC.MULTIPOINT), "双连");
  if (mpReply) state.multipoint = parseMultipoint(mpReply.payload);

  const talkReply = await tryAsk(get(FBLOCK.SETTINGS, FUNC.CONVERSATION), "对话");
  if (talkReply) state.conversation = parseConversation(talkReply.payload);

  const autoReply = await tryAsk(get(FBLOCK.SETTINGS, FUNC.STANDBY), "关机");
  if (autoReply) state.standby = parseStandby(autoReply.payload);

  await loadModes();
  renderAll();
}

async function loadModes() {
  state.modes = [];
  const current = await tryAsk(get(FBLOCK.MODES, FUNC.CURRENT_MODE), "当前");
  if (current?.payload.length) state.currentMode = current.payload[0];
  const caps = await tryAsk(get(FBLOCK.MODES, FUNC.MODE_CAPS), "能力");
  const parsed = caps ? parseModeCaps(caps.payload) : null;
  const n = Math.min(16, parsed ? parsed.bose + parsed.user || 8 : 8);
  for (let i = 0; i < n; i++) {
    const reply = await tryAsk(get(FBLOCK.MODES, FUNC.MODE_CONFIG, Uint8Array.of(i)), `m${i}`);
    if (!reply) continue;
    const mode = parseModeConfig(reply.payload);
    if (mode) state.modes.push(mode);
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
  if (state.channel15 !== false) {
    const reply = await tryAsk(setGet(FBLOCK.SETTINGS, FUNC.CNC, cncPayload(level, 1)), "降噪");
    if (reply) {
      state.channel15 = true;
      if (state.cnc) state.cnc.step = level;
      else state.cnc = { steps: cncMax() + 1, step: level, total: cncMax() + 1, enabled: true };
      renderCnc();
      return;
    }
    state.channel15 = false;
  }
  if (!(await writeAudioSettings({ ...state.cfg, cnc: level, anc: true }))) return;
  if (state.cnc) state.cnc.step = level;
  else state.cnc = { steps: cncMax() + 1, step: level, total: cncMax() + 1, enabled: true };
  renderCnc();
}

async function connect() {
  ui.go.disabled = true;
  try {
    await ble.connect({ acceptAll: false });
    await loadDevice();
  } catch (err) {
    log(err.message);
    renderAll();
  }
}

ui.go.addEventListener("click", () => {
  if (ble.connected) {
    ble.disconnect();
    renderAll();
    return;
  }
  connect();
});

ble.onDisconnected = () => renderAll();

if (!navigator.bluetooth && !hasNative()) ui.go.disabled = true;
else renderAll();
