import {
  FBLOCK,
  FUNC,
  OP,
  TRANSPORT,
  actionButtonPayload,
  audioSettingsPayload,
  cncPayload,
  eqPayload,
  favoritesPayload,
  get,
  modeConfigPayload,
  modeSwitchPayload,
  namePayload,
  parseActionButton,
  parseAudioSettings,
  parseBattery,
  parseCnc,
  parseConversation,
  parseDeviceList,
  parseEq,
  parseFavorites,
  parseFirmware,
  parseMacAddress,
  parseManufactured,
  flagPayload,
  parseComponentId,
  parseFlag,
  parseGuid,
  parseProductId,
  productIdOf,
  parseVoicePrompts,
  voicePromptPayload,
  parseSerialNumber,
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
import { batteryText, linkOf, linkText } from "./link.js";
import { productName } from "./products.js";
import {
  LANG_NAMES,
  SPATIAL_OPTIONS,
  STANDBY_OPTIONS,
  SELF_VOICE_OPTIONS,
  actionName,
  eqBandName,
  getLang,
  pick,
  pressName,
  setLang,
  t,
  voiceLanguageName,
} from "./labels.js";
import { hasNative } from "./native.js";

const ble = new BoseBle();
const $ = (id) => document.getElementById(id);
const ui = {
  status: $("status"),
  meta: $("meta"),
  go: $("go"),
  goText: $("go-text"),
  info: $("info"),
  deviceToggle: $("device-toggle"),
  hint: $("hint"),
  controls: $("controls"),
  modes: $("modes"),
  cnc: $("cnc"),
  eq: $("eq"),
  spatial: $("spatial"),
  sidetone: $("sidetone"),
  voice: $("voice"),
  behaviour: $("behaviour"),
  lang: $("lang"),
  settings: $("settings"),
  settingsOpen: $("settings-open"),
  settingsClose: $("settings-close"),
  diag: $("diag"),
  toggles: $("toggles"),
  standby: $("standby"),
  transport: $("transport"),
  editor: $("mode-editor"),
  rename: $("rename"),
  shortcut: $("shortcut"),
  shortcutTitle: $("shortcut-title"),
  favorites: $("favorites"),
  devices: $("devices"),
  headset: $("headset-actions"),
};

const MODE_ZH = {
  Quiet: "安静",
  Aware: "通透",
  Immersion: "沉浸",
  Cinema: "影院",
  Transparent: "通透",
};

const state = {
  modesAll: [],
  currentMode: null,
  favorites: null,
  shortcut: null,
  devices: [],
  editing: null,
  hasTransport: false,
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
  info: {
    product: "",
    productName: "",
    firmware: "",
    serial: "",
    mac: "",
    made: "",
    hardware: "",
    guid: "",
    originalName: "",
    component: "",
    leAudio: "",
  },
  voice: null,
  captouch: null,
  autoAnswer: null,
  autoPlay: null,
  busy: false,
  link: "idle",
};

function log(line) {
  console.debug(line);
}

function modeLabel(mode) {
  const raw = (mode.name || "").trim();
  return MODE_ZH[raw] || raw;
}

function usableModes() {
  return state.modesAll.filter((mode) => (mode.configured || !mode.editable) && !isPlaceholder(mode));
}

function isPlaceholder(mode) {
  const raw = (mode.name || "").trim();
  return !raw || /^none$/i.test(raw) || raw === "未命名";
}

function freeSlot() {
  return state.modesAll.find((mode) => mode.editable && (!mode.configured || isPlaceholder(mode)));
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

async function readInfo(packet, label) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const reply = await tryAsk(packet, label, 1200);
    if (reply) return reply;
  }
  return null;
}

async function probe(packet, label, timeoutMs = 800) {
  const first = await tryAsk(packet, label, timeoutMs);
  if (first) return first;
  return tryAsk(packet, label, timeoutMs * 2);
}

async function supported(packet, label, timeoutMs = 700) {
  try {
    await ble.request(packet, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

async function writeAsk(packet, label) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await tryAsk(packet, label);
    if (reply) return reply;
  }
  return null;
}

function pane(el, on) {
  const box = el.closest("section") ?? el;
  box.hidden = !on;
}

function chip(label, on) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chip" + (on ? " on" : "");
  btn.textContent = label;
  return btn;
}

function chips(root, items, selected, onPick) {
  const on = (key) => (Array.isArray(selected) ? selected.includes(key) : key === selected);
  root.innerHTML = "";
  items.forEach((item, index) => {
    const label = typeof item === "string" ? item : item.label;
    const key = typeof item === "string" ? index : item.key;
    const btn = chip(label, on(key));
    btn.addEventListener("click", () => onPick(key));
    root.appendChild(btn);
  });
}

function fillRows(root, rows) {
  root.innerHTML = "";
  for (const [key, value, title] of rows) {
    const line = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = key;
    const bold = document.createElement("b");
    bold.textContent = value;
    if (title) bold.title = title;
    line.append(label, bold);
    root.appendChild(line);
  }
}

function shortVersion(version) {
  return version ? String(version).split("+")[0] : "";
}

function applyLabels() {
  for (const el of document.querySelectorAll("[data-label]")) {
    el.textContent = t(el.dataset.label);
  }
}

function renderInfo() {
  const rows = [
    [t("productName"), state.info.productName],
    [t("product"), state.info.product],
    [t("fw"), shortVersion(state.info.firmware), state.info.firmware],
    [t("serial"), state.info.serial],
    [t("mac"), state.info.mac],
    [t("made"), state.info.made],
    [t("hardware"), state.info.hardware],
  ].filter((row) => row[1]);
  fillRows(ui.info, rows);
  ui.deviceToggle.hidden = rows.length === 0;
  if (rows.length === 0) setInfo(false);
}

function setInfo(open) {
  ui.deviceToggle.setAttribute("aria-expanded", String(open));
  ui.info.hidden = !open;
}

function renderModes() {
  const modes = usableModes();
  const free = freeSlot();
  pane(ui.modes, modes.length > 0 || Boolean(free));
  ui.modes.innerHTML = "";
  for (const mode of modes) {
    const btn = chip(modeLabel(mode), mode.index === state.currentMode);
    btn.addEventListener("click", () => {
      if (mode.editable && mode.index === state.currentMode) openEditor(mode.index);
      else switchMode(mode.index);
    });
    ui.modes.appendChild(btn);
  }
  if (free) {
    const btn = chip(`＋ ${t("create")}`, false);
    btn.addEventListener("click", () => openEditor(free.index));
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
  pane(ui.cnc, state.cnc != null);
  if (state.cnc == null) return;
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
  name.textContent = eqBandName(band.id);
  row.appendChild(name);
  slider(row, {
    min: band.min,
    max: band.max,
    value: band.current,
    onChange: (value) => {
      band.current = value;
      tryAsk(setGet(FBLOCK.SETTINGS, FUNC.EQ, eqPayload(value, band.id)), eqBandName(band.id));
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
  chips(
    ui.spatial,
    SPATIAL_OPTIONS.map((option, index) => ({ key: index, label: pick(option) })),
    state.cfg.spatial ?? 0,
    setSpatial,
  );
}

function renderSidetone() {
  pane(ui.sidetone, state.sidetone != null);
  if (state.sidetone == null) return;
  chips(
    ui.sidetone,
    SELF_VOICE_OPTIONS.map((option, index) => ({ key: index, label: pick(option) })),
    state.sidetone,
    setSidetone,
  );
}

function renderVoice() {
  const voice = state.voice;
  pane(ui.voice, Boolean(voice && voice.supported.length));
  if (!voice || !voice.supported.length) return;
  chips(
    ui.voice,
    voice.supported.map((id) => ({ key: id, label: voiceLanguageName(id) })),
    voice.language,
    (id) => setVoicePrompt(voice.enabled, id),
  );
}

function renderToggles() {
  const items = [
    { key: "wind", label: t("wind"), on: state.cfg.wind, show: state.hasAudioSettings, run: () => setWind(!state.cfg.wind) },
    { key: "mp", label: t("multipoint"), on: state.multipoint?.enabled, show: state.multipoint != null, run: () => setMultipoint(!state.multipoint.enabled) },
    { key: "talk", label: t("conversation"), on: state.conversation, show: state.conversation != null, run: () => setConversation(!state.conversation) },
  ];
  let n = 0;
  ui.toggles.innerHTML = "";
  for (const item of items) {
    if (item.show === false) continue;
    n += 1;
    const btn = chip(item.label, item.on);
    btn.addEventListener("click", item.run);
    ui.toggles.appendChild(btn);
  }
  pane(ui.toggles, n > 0);
}

function renderBehaviour() {
  const items = [
    { key: "touch", label: t("touch"), on: state.captouch === false, show: state.captouch != null, run: () => setCaptouchDisabled(!state.captouch) },
    { key: "answer", label: t("autoAnswer"), on: state.autoAnswer, show: state.autoAnswer != null, run: () => setAutoAnswer(!state.autoAnswer) },
    { key: "play", label: t("autoPlay"), on: state.autoPlay, show: state.autoPlay != null, run: () => setAutoPlayPause(!state.autoPlay) },
  ];
  let n = 0;
  ui.behaviour.innerHTML = "";
  for (const item of items) {
    if (item.show === false) continue;
    n += 1;
    const btn = chip(item.label, item.on);
    btn.addEventListener("click", item.run);
    ui.behaviour.appendChild(btn);
  }
  pane(ui.behaviour, n > 0);
}

function renderTransport() {
  pane(ui.transport, state.hasTransport);
  if (!state.hasTransport) return;
  chips(
    ui.transport,
    [
      { key: "prev", label: t("prev") },
      { key: "play", label: t("play") },
      { key: "pause", label: t("pause") },
      { key: "next", label: t("next") },
    ],
    null,
    (key) => tryAsk(start(FBLOCK.AUDIO, FUNC.TRANSPORT, Uint8Array.of(TRANSPORT[key])), "播放"),
  );
}

function renderFavorites() {
  const modes = usableModes();
  const favorites = state.favorites;
  pane(ui.favorites, Boolean(favorites && modes.length));
  if (!favorites || !modes.length) return;
  chips(
    ui.favorites,
    modes.map((mode) => ({ key: mode.index, label: modeLabel(mode) })),
    favorites.indices,
    toggleFavorite,
  );
}

function renderShortcut() {
  const config = state.shortcut;
  pane(ui.shortcut, Boolean(config && config.supported.length));
  ui.shortcutTitle.textContent = config
    ? `${t("shortcut")} · ${pressName(config.eventType)}`
    : t("shortcut");
  if (!config || !config.supported.length) return;
  chips(
    ui.shortcut,
    config.supported.map((id) => ({ key: id, label: actionName(id) })),
    config.action,
    setShortcut,
  );
}

function renderRename() {
  pane(ui.rename, Boolean(state.name));
  if (!state.name) return;
  let input = ui.rename.querySelector("input");
  if (!input) {
    input = document.createElement("input");
    input.type = "text";
    input.className = "text";
    input.maxLength = 30;
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") saveName();
    });
    const save = chip(t("save"), false);
    save.addEventListener("click", saveName);
    ui.rename.append(input, save);
  }
  if (document.activeElement !== input) input.value = state.name;
}

function renderDevices() {
  pane(ui.devices, state.devices.length > 0);
  if (!state.devices.length) return;
  fillRows(
    ui.devices,
    state.devices.map((device) => [device.mac, device.connected ? t("connected") : "—"]),
  );
}

function renderHeadset() {
  ui.headset.innerHTML = "";
  const pair = chip(t("pair"), false);
  armedClick(pair, () =>
    tryAsk(start(FBLOCK.DEVICE, FUNC.PAIRING, Uint8Array.of(1)), "配对"),
  );
  const off = chip(t("powerOff"), false);
  armedClick(off, () => tryAsk(start(FBLOCK.CONTROL, FUNC.POWER, Uint8Array.of(0)), "关机"));
  ui.headset.append(pair, off);
  pane(ui.headset, true);
}

function renderLanguage() {
  chips(ui.lang, LANG_NAMES.map((item) => ({ key: item.id, label: item.native })), getLang(), (id) => {
    setLang(id);
    applyLabels();
    renderAll();
    renderEditor();
  });
}

function renderSettings() {
  renderLanguage();
  renderRename();
  renderShortcut();
  renderFavorites();
  renderVoice();
  renderBehaviour();
  renderStandby();
  renderDevices();
  renderHeadset();
  renderDiag();
}

function nativeEnv() {
  try {
    if (window.NativeBLE && typeof window.NativeBLE.env === "function") {
      return JSON.parse(window.NativeBLE.env());
    }
  } catch {
    /* 老版本桥没有 env */
  }
  return null;
}

function renderDiag() {
  const chrome = (String(navigator.userAgent).match(/Chrome\/(\d+)/) || [])[1] || "?";
  const env = nativeEnv();
  const bt = !env ? "—" : env.adapter === 1 ? t("btOn") : env.adapter === 2 ? t("btOff") : t("btNone");
  const rows = [
    ["WebView", `Chromium ${chrome}`],
    [t("bridge"), hasNative() ? "OK" : "—"],
    [t("btState"), bt],
  ];
  if (env && typeof env.loc !== "undefined") {
    rows.push([t("location"), env.loc === 1 ? t("btOn") : t("btOff")]);
  }
  rows.push([t("lastError"), ble.lastError || "—"]);
  if (env && env.bonded >= 0) rows.push([t("devices"), String(env.bonded)]);
  fillRows(ui.diag, rows);
}

function renderStandby() {
  pane(ui.standby, state.standby != null);
  if (state.standby == null) return;
  chips(
    ui.standby,
    STANDBY_OPTIONS.map((option) => ({ key: option.minutes, label: pick(option) })),
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
  ui.goText.textContent = on ? t("disconnect") : t("connect");
  ui.hint.textContent = idle ? (state.busy ? linkText("busy") : linkText(state.link)) : "";
  if (!on) {
    ui.status.textContent = "";
    ui.meta.textContent = "";
    return;
  }
  ui.status.textContent = state.name || ble.name || "";
  ui.meta.textContent = batteryText(state.battery);
  renderInfo();
  renderModes();
  renderCnc();
  renderEq();
  renderSpatial();
  renderSidetone();
  renderVoice();
  renderToggles();
  renderTransport();
  renderSettings();
}

async function loadDevice() {
  await tryAsk(get(FBLOCK.PRODUCT, FUNC.BMAP_VERSION), "init", 1200);

  const productReply = await readInfo(get(FBLOCK.PRODUCT, FUNC.PRODUCT_ID), "型号", 1200);
  if (productReply) {
    state.info.product = parseProductId(productReply.payload);
    state.info.productName = productName(productIdOf(productReply.payload));
  }

  const firmwareReply = await readInfo(get(FBLOCK.PRODUCT, FUNC.FIRMWARE), "固件", 1200);
  if (firmwareReply) state.info.firmware = parseFirmware(firmwareReply.payload);

  const serialReply = await readInfo(get(FBLOCK.PRODUCT, FUNC.SERIAL_NUMBER), "序列号", 1200);
  if (serialReply) state.info.serial = parseSerialNumber(serialReply.payload);

  const macReply = await readInfo(get(FBLOCK.PRODUCT, FUNC.MAC_ADDRESS), "MAC", 1200);
  if (macReply) state.info.mac = parseMacAddress(macReply.payload);

  const guidReply = await readInfo(get(FBLOCK.PRODUCT, FUNC.GUID), "GUID", 1200);
  if (guidReply) state.info.guid = parseGuid(guidReply.payload);

  const originalReply = await readInfo(get(FBLOCK.PRODUCT, FUNC.ORIGINAL_NAME), "原厂名称", 1200);
  if (originalReply) state.info.originalName = parseFirmware(originalReply.payload);

  const componentReply = await readInfo(get(FBLOCK.PRODUCT, FUNC.COMPONENT_ID), "组件", 1200);
  if (componentReply) state.info.component = parseComponentId(componentReply.payload);

  const leAudioReply = await readInfo(get(FBLOCK.PRODUCT, FUNC.LE_AUDIO), "LE Audio", 1200);
  if (leAudioReply) state.info.leAudio = parseFlag(leAudioReply.payload) ? "支持" : "不支持";

  const madeReply = await readInfo(get(FBLOCK.PRODUCT, FUNC.MANUFACTURED), "生产日期", 1200);
  if (madeReply) state.info.made = parseManufactured(madeReply.payload);

  const hardwareReply = await readInfo(get(FBLOCK.PRODUCT, FUNC.HARDWARE_REVISION), "硬件", 1200);
  if (hardwareReply) state.info.hardware = parseFirmware(hardwareReply.payload);

  const nameReply = await tryAsk(get(FBLOCK.SETTINGS, FUNC.NAME), "名称", 1200);
  if (nameReply) state.name = parseName(nameReply.payload) || ble.name;

  const batReply = await readInfo(get(FBLOCK.STATUS, FUNC.BATTERY), "电量");
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

  const cncReply = await probe(get(FBLOCK.SETTINGS, FUNC.CNC), "降噪", 800);
  if (cncReply) {
    state.cnc = parseCnc(cncReply.payload);
    if (state.hasAudioSettings && state.cfg.cnc != null) state.cnc.step = state.cfg.cnc;
  }

  renderAll();

  const sideReply = await probe(get(FBLOCK.SETTINGS, FUNC.SIDETONE), "侧音", 800);
  if (sideReply) state.sidetone = parseSidetone(sideReply.payload);

  const mpReply = await probe(get(FBLOCK.SETTINGS, FUNC.MULTIPOINT), "双连", 800);
  if (mpReply) state.multipoint = parseMultipoint(mpReply.payload);

  const talkReply = await probe(get(FBLOCK.SETTINGS, FUNC.CONVERSATION), "对话", 500);
  if (talkReply) state.conversation = parseConversation(talkReply.payload);

  const autoReply = await probe(get(FBLOCK.SETTINGS, FUNC.STANDBY), "关机", 500);
  if (autoReply) state.standby = parseStandby(autoReply.payload);

  if (state.hasAudioSettings) {
    const ok = await writeAudioSettings({ ...state.cfg });
    log(ok ? "write-ok" : "write-fail");
  }

  renderAll();
  const voiceReply = await readInfo(get(FBLOCK.SETTINGS, FUNC.VOICE_PROMPTS), "语音提示");
  if (voiceReply) state.voice = parseVoicePrompts(voiceReply.payload);

  const autoPlayReply = await readInfo(get(FBLOCK.SETTINGS, FUNC.AUTO_PLAY_PAUSE), "自动播放");
  if (autoPlayReply) state.autoPlay = parseFlag(autoPlayReply.payload);

  const autoAnswerReply = await readInfo(get(FBLOCK.SETTINGS, FUNC.AUTO_ANSWER), "自动接听");
  if (autoAnswerReply) state.autoAnswer = parseFlag(autoAnswerReply.payload);

  const captouchReply = await readInfo(get(FBLOCK.SETTINGS, FUNC.DISABLE_CAPTOUCH), "触控");
  if (captouchReply) state.captouch = parseFlag(captouchReply.payload);

  const shortcutReply = await tryAsk(get(FBLOCK.SETTINGS, FUNC.BUTTONS), "快捷", 900);
  if (shortcutReply) state.shortcut = parseActionButton(shortcutReply.payload);

  const devicesReply = await tryAsk(get(FBLOCK.DEVICE, FUNC.DEVICE_LIST), "设备列表", 900);
  if (devicesReply) state.devices = parseDeviceList(devicesReply.payload);

  state.hasTransport = await supported(get(FBLOCK.AUDIO, FUNC.TRANSPORT), "播放");

  await loadModes();
  renderAll();
}

async function loadModes() {
  state.modesAll = [];
  state.favorites = null;
  const current = await tryAsk(get(FBLOCK.MODES, FUNC.CURRENT_MODE), "当前", 900);
  if (current?.payload.length) state.currentMode = current.payload[0];
  const capsReply = await tryAsk(get(FBLOCK.MODES, FUNC.MODE_CAPS), "能力", 900);
  const caps = capsReply ? parseModeCaps(capsReply.payload) : null;
  const builtin = caps?.bose ?? 0;
  const userReply = await tryAsk(get(FBLOCK.MODES, FUNC.USER_INDICES), "用户模式", 900);
  const users = userReply?.payload.length
    ? [...userReply.payload]
    : Array.from({ length: caps?.user ?? 0 }, (_, i) => builtin + i);
  const indices = [...new Set([...Array.from({ length: builtin }, (_, i) => i), ...users])];
  if (!indices.length) indices.push(0, 1, 2, 3, 4, 5, 6, 7);
  for (const index of indices) {
    const reply = await tryAsk(
      get(FBLOCK.MODES, FUNC.MODE_CONFIG, Uint8Array.of(index)),
      `m${index}`,
      900,
    );
    if (!reply) continue;
    const mode = parseModeConfig(reply.payload);
    if (mode) state.modesAll.push(mode);
    renderModes();
  }
  const favoritesReply = await tryAsk(get(FBLOCK.MODES, FUNC.FAVORITES), "循环", 900);
  if (favoritesReply) state.favorites = parseFavorites(favoritesReply.payload);
}

async function switchMode(index) {
  const reply = await tryAsk(
    start(FBLOCK.MODES, FUNC.CURRENT_MODE, modeSwitchPayload(index, 1)),
    "模式",
  );
  if (!reply) return;
  if (state.editing && state.editing.index !== index) closeEditor();
  state.currentMode = index;
  renderModes();
}

function openEditor(index) {
  const mode = state.modesAll.find((item) => item.index === index);
  if (!mode) return;
  const blank = isPlaceholder(mode);
  state.editing = {
    index,
    isNew: blank && mode.editable,
    prompt: blank ? [0, 0] : mode.prompt,
    name: blank ? "" : mode.name,
    cnc: blank ? state.cfg.cnc ?? 0 : mode.cnc ?? 0,
    auto: Boolean(mode.auto),
    spatial: mode.spatial ?? state.cfg.spatial ?? 0,
    wind: Boolean(mode.wind),
    anc: mode.anc !== false,
    cycle: Boolean(state.favorites?.indices.includes(index)),
  };
  renderEditor();
  ui.editor.scrollIntoView({ block: "nearest" });
}

function closeEditor() {
  state.editing = null;
  renderEditor();
}

function renderEditor() {
  const edit = state.editing;
  ui.editor.innerHTML = "";
  ui.editor.hidden = !edit;
  if (!edit) return;

  const title = document.createElement("h2");
  title.textContent = edit.isNew ? t("create") : t("edit");
  ui.editor.appendChild(title);

  const field = document.createElement("div");
  field.className = "field";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "text";
  input.maxLength = 30;
  input.value = edit.name;
  input.placeholder = t("modeName");
  input.addEventListener("input", () => {
    edit.name = input.value;
  });
  field.appendChild(input);
  ui.editor.appendChild(field);

  const band = document.createElement("div");
  band.className = "band";
  const label = document.createElement("span");
  label.textContent = t("cnc");
  band.appendChild(label);
  slider(band, {
    min: 0,
    max: cncMax(),
    value: Math.min(edit.cnc ?? 0, cncMax()),
    onChange: (value) => {
      edit.cnc = value;
    },
  });
  ui.editor.appendChild(band);

  const flags = document.createElement("div");
  flags.className = "chips";
  const flag = (key, on, run) => {
    const btn = chip(t(key), on);
    btn.addEventListener("click", () => {
      run();
      renderEditor();
    });
    flags.appendChild(btn);
  };
  flag("autoCnc", edit.auto, () => {
    edit.auto = !edit.auto;
  });
  flag("wind", edit.wind, () => {
    edit.wind = !edit.wind;
  });
  if (state.favorites) {
    flag("cycle", edit.cycle, () => {
      edit.cycle = !edit.cycle;
    });
  }
  ui.editor.appendChild(flags);

  if (state.hasAudioSettings) {
    const spatial = document.createElement("div");
    spatial.className = "chips";
    SPATIAL_OPTIONS.forEach((option, optionIndex) => {
      const btn = chip(pick(option), edit.spatial === optionIndex);
      btn.addEventListener("click", () => {
        edit.spatial = optionIndex;
        renderEditor();
      });
      spatial.appendChild(btn);
    });
    ui.editor.appendChild(spatial);
  }

  const actions = document.createElement("div");
  actions.className = "chips";
  const save = chip(t("save"), false);
  save.addEventListener("click", saveMode);
  const cancel = chip(t("cancel"), false);
  cancel.addEventListener("click", closeEditor);
  actions.append(save, cancel);
  if (!edit.isNew) {
    const remove = chip(t("remove"), false);
    armedClick(remove, removeMode);
    actions.appendChild(remove);
  }
  ui.editor.appendChild(actions);
}

async function saveMode() {
  const edit = state.editing;
  if (!edit) return;
  const name = edit.name.trim();
  if (!name) return;
  const reply = await writeAsk(
    setGet(
      FBLOCK.MODES,
      FUNC.MODE_CONFIG,
      modeConfigPayload({
        index: edit.index,
        prompt: edit.prompt,
        name,
        cnc: edit.cnc,
        auto: edit.auto,
        spatial: edit.spatial,
        wind: edit.wind,
        anc: edit.anc,
      }),
    ),
    "模式",
  );
  if (!reply) return;
  const saved = parseModeConfig(reply.payload);
  if (!saved) return;
  const slot = state.modesAll.findIndex((item) => item.index === edit.index);
  if (slot >= 0) state.modesAll[slot] = saved;
  else state.modesAll.push(saved);
  const listed = Boolean(state.favorites?.indices.includes(edit.index));
  if (edit.cycle !== listed) await writeFavorites(toggled(edit.index, edit.cycle));
  closeEditor();
  renderAll();
  if (edit.isNew) await switchMode(edit.index);
}

async function removeMode() {
  const edit = state.editing;
  if (!edit) return;
  const reply = await tryAsk(start(FBLOCK.MODES, FUNC.MODE_RESET, Uint8Array.of(edit.index)), "删除");
  if (!reply) return;
  if (state.favorites?.indices.includes(edit.index)) await writeFavorites(toggled(edit.index, false));
  closeEditor();
  await loadModes();
  renderAll();
}

function toggled(index, on) {
  const listed = state.favorites?.indices ?? [];
  if (on) return listed.includes(index) ? listed : [...listed, index].sort((a, b) => a - b);
  return listed.filter((item) => item !== index);
}

async function writeFavorites(indices) {
  const count = state.favorites?.count ?? 0;
  if (!count) return false;
  const reply = await writeAsk(
    setGet(FBLOCK.MODES, FUNC.FAVORITES, favoritesPayload(count, indices)),
    "循环",
  );
  if (!reply) return false;
  state.favorites = parseFavorites(reply.payload) ?? { count, indices };
  return true;
}

async function toggleFavorite(index) {
  if (!(await writeFavorites(toggled(index, !state.favorites?.indices.includes(index))))) return;
  renderFavorites();
}

async function setShortcut(action) {
  const config = state.shortcut;
  if (!config) return;
  const reply = await writeAsk(
    setGet(FBLOCK.SETTINGS, FUNC.BUTTONS, actionButtonPayload(config, action)),
    "快捷",
  );
  if (!reply) return;
  state.shortcut = parseActionButton(reply.payload) ?? { ...config, action };
  renderShortcut();
}

async function saveName() {
  const input = ui.rename.querySelector("input");
  if (!input) return;
  const name = input.value.trim();
  if (!name || name === state.name) return;
  const reply = await writeAsk(setGet(FBLOCK.SETTINGS, FUNC.NAME, namePayload(name)), "名称");
  if (!reply) {
    input.value = state.name;
    return;
  }
  state.name = parseName(reply.payload) || name;
  input.value = state.name;
  renderAll();
}

function armedClick(btn, run) {
  btn.addEventListener("click", () => {
    if (btn.dataset.armed === "1") {
      btn.dataset.armed = "";
      btn.classList.remove("arm");
      btn.textContent = btn.dataset.label;
      run();
      return;
    }
    btn.dataset.armed = "1";
    btn.dataset.label = btn.textContent;
    btn.classList.add("arm");
    btn.textContent = t("again");
    setTimeout(() => {
      if (btn.dataset.armed !== "1") return;
      btn.dataset.armed = "";
      btn.classList.remove("arm");
      btn.textContent = btn.dataset.label;
    }, 4000);
  });
}

async function writeAudioSettings(next) {
  const reply = await writeAsk(
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
  const reply = await writeAsk(
    setGet(FBLOCK.SETTINGS, FUNC.SIDETONE, sidetonePayload(level)),
    "侧音",
  );
  if (!reply) return;
  state.sidetone = level;
  renderSidetone();
}

async function setMultipoint(on) {
  const reply = await writeAsk(
    setGet(FBLOCK.SETTINGS, FUNC.MULTIPOINT, Uint8Array.of(on ? 1 : 0)),
    "双连",
  );
  if (!reply) return;
  state.multipoint = { ...state.multipoint, enabled: on };
  renderToggles();
}

async function setConversation(on) {
  const reply = await writeAsk(
    setGet(FBLOCK.SETTINGS, FUNC.CONVERSATION, Uint8Array.of(on ? 1 : 0)),
    "对话",
  );
  if (!reply) return;
  state.conversation = on;
  renderToggles();
}

async function setStandby(minutes) {
  const reply = await writeAsk(
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
    const reply = await writeAsk(setGet(FBLOCK.SETTINGS, FUNC.CNC, cncPayload(level, 1)), "降噪", 800);
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

async function setVoicePrompt(enabled, language) {
  const reply = await writeAsk(
    setGet(FBLOCK.SETTINGS, FUNC.VOICE_PROMPTS, voicePromptPayload(enabled, language)),
    "语音提示",
  );
  if (!reply) return false;
  state.voice = { ...state.voice, enabled, language };
  renderVoice();
  return true;
}

async function setCaptouchDisabled(disabled) {
  const reply = await writeAsk(
    setGet(FBLOCK.SETTINGS, FUNC.DISABLE_CAPTOUCH, flagPayload(disabled)),
    "触控",
  );
  if (!reply) return false;
  state.captouch = disabled;
  renderToggles();
  return true;
}

async function setAutoAnswer(on) {
  const reply = await writeAsk(setGet(FBLOCK.SETTINGS, FUNC.AUTO_ANSWER, flagPayload(on)), "自动接听");
  if (!reply) return false;
  state.autoAnswer = on;
  renderToggles();
  return true;
}

async function setAutoPlayPause(on) {
  const reply = await writeAsk(
    setGet(FBLOCK.SETTINGS, FUNC.AUTO_PLAY_PAUSE, flagPayload(on)),
    "自动播放",
  );
  if (!reply) return false;
  state.autoPlay = on;
  renderToggles();
  return true;
}

function hasBmapData() {
  return Boolean(
    state.name || state.battery.length || state.eq.length || state.cnc ||
    state.modesAll.length || state.info.product || state.info.firmware,
  );
}

function resetDevice() {
  state.modesAll = [];
  state.favorites = null;
  state.shortcut = null;
  state.devices = [];
  state.hasTransport = false;
  state.info = { product: "", firmware: "", serial: "", mac: "", made: "", hardware: "" };
  closeEditor();
}

async function connect() {
  if (state.busy) return;
  state.busy = true;
  state.link = "idle";
  resetDevice();
  renderAll();
  try {
    await ble.connect({ acceptAll: false });
    ui.status.textContent = ble.name || "";
    await loadDevice();
    if (hasBmapData()) {
      state.link = "ready";
    } else {
      state.link = "noproto";
      ble.disconnect();
    }
  } catch (err) {
    log(err.message);
    state.link = linkOf(err);
  }
  state.busy = false;
  renderAll();
}

ui.go.addEventListener("click", () => {
  if (state.busy) return;
  if (ble.connected) {
    state.link = "idle";
    ble.disconnect();
    renderAll();
    return;
  }
  connect();
});

ui.settingsOpen.addEventListener("click", () => {
  ui.settings.hidden = false;
  renderSettings();
});

ui.settingsClose.addEventListener("click", () => {
  ui.settings.hidden = true;
});

ui.deviceToggle.addEventListener("click", () => {
  setInfo(ui.deviceToggle.getAttribute("aria-expanded") !== "true");
});

ble.onDisconnected = () => {
  state.busy = false;
  resetDevice();
  setInfo(false);
  if (state.link === "ready") state.link = "lost";
  renderAll();
};

applyLabels();
window.__boseApp = true;
if (!navigator.bluetooth && !hasNative()) {
  ui.go.disabled = true;
  state.link = "unsupported";
}
renderAll();
if (hasNative()) connect();
