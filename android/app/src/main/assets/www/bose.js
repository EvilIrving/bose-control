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
  createReassembler,
  decodeAll,
  keyOf,
  segment,
} from "./bmap.js";
import { productName } from "./products.js";
import {
  SPATIAL_OPTIONS,
  STANDBY_OPTIONS,
  SELF_VOICE_OPTIONS,
  actionName,
  eqBandName,
  pick,
  pressName,
  t,
  voiceLanguageName,
} from "./labels.js";
import { chip, chips, fillRows, pane } from "./ui.js";

// Bose 的 BMAP 实现：读全量状态、写各项设置、把面板画出来。
// 宿主只认下面这几个入口：load() / render() / renderSettings() / diagRows()。
export function createBoseSession({ link, ui, state, refresh, log }) {
// 耳机支持的功能会在一百毫秒以内回包，不回的基本就是没有这个功能，
// 所以首轮只等很短；没回的挂到后台用长一点的超时补一次 —— 界面不等它。
const READ_TIMEOUT = 500;
const RETRY_TIMEOUT = 1000;
const DETAIL_TIMEOUT = 600;
const WRITE_TIMEOUT = 2000;
// 耳机上报的模式名可能是英文（Quiet/Aware…），按当前界面语言给中文或英文；
// 已经是中文的（设备语音语言为中文时）原样显示。
const MODE_NAMES = {
  Quiet: { zh: "安静", en: "Quiet" },
  Aware: { zh: "通透", en: "Aware" },
  Immersion: { zh: "沉浸", en: "Immersion" },
  Cinema: { zh: "影院", en: "Cinema" },
  Transparent: { zh: "通透", en: "Transparent" },
};

function modeLabel(mode) {
  const raw = (mode.name || "").trim();
  const known = MODE_NAMES[raw];
  return known ? pick(known) : raw;
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
  const reply = await link.request(packet, timeoutMs ?? WRITE_TIMEOUT, { priority: timeoutMs == null || timeoutMs === WRITE_TIMEOUT ? 1 : 0 });
  if (reply.op === OP.ERROR) {
    const code = reply.payload[0] ?? reply.payload[1] ?? "?";
    throw new Error(`${label} ${code}`);
  }
  return reply;
}

async function tryAsk(packet, label, timeoutMs) {
  try {
    if (link.active === false) return null;
    const reply = await ask(packet, label, timeoutMs);
    return link.active === false ? null : reply;
  } catch (err) {
    log(err.message);
    return null;
  }
}

// 设备信息里的细节项，读不到就算了，不值得再等一次
function readDetail(packet, label, apply) {
  return tryAsk(packet, label, DETAIL_TIMEOUT).then((reply) => {
    if (reply) apply(reply);
  });
}

// 首轮没回的读取记在这里，启动完成后再统一补一次（带长超时）
let retries = [];

// 读一项设置，结果直接落到 state 上；没回就排队等后台补
function read(packet, label, apply) {
  return tryAsk(packet, label, READ_TIMEOUT).then((reply) => {
    if (reply) { apply(reply); refresh(); }
    else if (link.active !== false) retries.push({ packet, label, apply });
  });
}

async function settleRetries() {
  const jobs = retries.splice(0);
  if (!jobs.length || link.active === false) return;
  await Promise.all(
    jobs.map(async (job) => {
      const reply = await tryAsk(job.packet, job.label, RETRY_TIMEOUT);
      if (reply) job.apply(reply);
    }),
  );
  refresh();
}

async function writeAsk(packet, label) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await tryAsk(packet, label, WRITE_TIMEOUT);
    if (reply) return reply;
  }
  return null;
}

function renderModes() {
  if (link.active === false) return;
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
    const btn = chip("＋", false);
    btn.classList.add("plus");
    btn.setAttribute("aria-label", t("create"));
    btn.title = t("create");
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
  const rail = document.createElement("div");
  rail.className = "rail";
  const fill = document.createElement("i");
  const thumb = document.createElement("u");
  const num = document.createElement("b");
  let current = value;
  let held = false;
  let sendAt = 0;
  const paint = () => {
    const ratio = Math.max(0, Math.min(1, (current - min) / Math.max(1, max - min)));
    fill.style.width = `${ratio * 100}%`;
    thumb.style.left = `${ratio * 100}%`;
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
  rail.append(fill, thumb);
  track.appendChild(rail);
  paint();
  row.append(track, num);
}

function renderCnc() {
  if (link.active === false) return;
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
  if (link.active === false) return;
  pane(ui.eq, state.eq.length > 0);
  ui.eq.className = "";
  ui.eq.innerHTML = "";
  for (const band of state.eq) ui.eq.appendChild(bandRow(band));
}

function renderSpatial() {
  if (link.active === false) return;
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
  if (link.active === false) return;
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
  if (link.active === false) return;
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
  if (link.active === false) return;
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
  if (link.active === false) return;
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
  if (link.active === false) return;
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
  if (link.active === false) return;
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
  if (link.active === false) return;
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
  if (link.active === false) return;
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
  if (link.active === false) return;
  pane(ui.devices, state.devices.length > 0);
  if (!state.devices.length) return;
  fillRows(
    ui.devices,
    state.devices.map((device) => [device.mac, device.connected ? t("connected") : "—"]),
  );
}

function renderHeadset() {
  if (link.active === false) return;
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

function renderStandby() {
  if (link.active === false) return;
  pane(ui.standby, state.standby != null);
  if (state.standby == null) return;
  chips(
    ui.standby,
    STANDBY_OPTIONS.map((option) => ({ key: option.minutes, label: pick(option) })),
    state.standby,
    setStandby,
  );
}

function applyCfg(reply) {
  const cfg = parseAudioSettings(reply.payload);
  if (!cfg) return;
  state.cfg = cfg;
  state.hasAudioSettings = true;
  state.channel15 = false;
  state.cnc = { steps: 11, step: cfg.cnc, total: 11, enabled: true };
  refresh();
}

function applyCnc(reply) {
  const cnc = parseCnc(reply.payload);
  if (!cnc) return;
  state.cnc = cnc;
  if (state.hasAudioSettings && state.cfg.cnc != null) state.cnc.step = state.cfg.cnc;
  refresh();
}

async function loadDevice() {
  retries = [];
  // 第一批：屏幕上立刻要看的东西。彼此不依赖，一起飞，屏幕不再等全量读完才出内容。
  const [versionReply] = await Promise.all([
    tryAsk(get(FBLOCK.PRODUCT, FUNC.BMAP_VERSION), "init", READ_TIMEOUT),
    read(get(FBLOCK.STATUS, FUNC.BATTERY), "电量", (reply) => {
      state.battery = parseBattery(reply.payload);
    }),
    read(get(FBLOCK.SETTINGS, FUNC.EQ), "均衡", (reply) => {
      state.eq = parseEq(reply.payload);
    }),
    read(get(FBLOCK.MODES, FUNC.AUDIO_SETTINGS), "音效", applyCfg),
    read(get(FBLOCK.SETTINGS, FUNC.CNC), "降噪", applyCnc),
    loadModes(),
    read(get(FBLOCK.SETTINGS, FUNC.NAME), "名称", (reply) => {
      state.name = parseName(reply.payload) || link.name;
    }),
  ]);
  log(versionReply ? "init-ok" : "init-silent");

  // 音效设置和降噪都能回的时候，降噪档位以音效包为准
  state.hasAudioSettings = Boolean(state.hasAudioSettings);

  refresh();

  if (link.active === false) return false;
  // 剩余主页功能、设置和信息继续读取，不阻塞已回包的控制。
  await Promise.all([
    read(get(FBLOCK.PRODUCT, FUNC.PRODUCT_ID), "型号", (reply) => {
      state.info.product = parseProductId(reply.payload);
      state.info.productName = productName(productIdOf(reply.payload));
    }),
    read(get(FBLOCK.PRODUCT, FUNC.FIRMWARE), "固件", (reply) => {
      state.info.firmware = parseFirmware(reply.payload);
    }),
    read(get(FBLOCK.SETTINGS, FUNC.SIDETONE), "侧音", (reply) => {
      state.sidetone = parseSidetone(reply.payload);
    }),
    read(get(FBLOCK.SETTINGS, FUNC.MULTIPOINT), "双连", (reply) => {
      state.multipoint = parseMultipoint(reply.payload);
    }),
    read(get(FBLOCK.SETTINGS, FUNC.CONVERSATION), "对话", (reply) => {
      state.conversation = parseConversation(reply.payload);
    }),
    read(get(FBLOCK.SETTINGS, FUNC.STANDBY), "关机", (reply) => {
      state.standby = parseStandby(reply.payload);
    }),
    read(get(FBLOCK.SETTINGS, FUNC.VOICE_PROMPTS), "语音提示", (reply) => {
      state.voice = parseVoicePrompts(reply.payload);
    }),
    read(get(FBLOCK.SETTINGS, FUNC.AUTO_PLAY_PAUSE), "自动播放", (reply) => {
      state.autoPlay = parseFlag(reply.payload);
    }),
    read(get(FBLOCK.SETTINGS, FUNC.AUTO_ANSWER), "自动接听", (reply) => {
      state.autoAnswer = parseFlag(reply.payload);
    }),
    read(get(FBLOCK.SETTINGS, FUNC.DISABLE_CAPTOUCH), "触控", (reply) => {
      state.captouch = parseFlag(reply.payload);
    }),
    read(get(FBLOCK.SETTINGS, FUNC.BUTTONS), "快捷", (reply) => {
      state.shortcut = parseActionButton(reply.payload);
    }),
    read(get(FBLOCK.DEVICE, FUNC.DEVICE_LIST), "设备列表", (reply) => {
      state.devices = parseDeviceList(reply.payload);
    }),
    read(get(FBLOCK.AUDIO, FUNC.TRANSPORT), "播放", () => {
      state.hasTransport = true;
    }),
  ]);

  refresh();
  // 补读和设备详情都不在关键路径上，界面先交出去
  void settleRetries().then(loadDetail);
  // 连上了但一个 BMAP 回包都没有（比如连到别家耳机），宿主据此判定「设备不支持」
  return Boolean(
    state.name || state.battery.length || state.eq.length || state.cnc ||
    state.modesAll.length || state.info.product || state.info.firmware,
  );
}

// 详情只在设备信息面板里看得到，留在后台读。
async function loadDetail() {
  if (link.active === false) return;
  await Promise.all([
    readDetail(get(FBLOCK.PRODUCT, FUNC.SERIAL_NUMBER), "序列号", (reply) => {
      state.info.serial = parseSerialNumber(reply.payload);
    }),
    readDetail(get(FBLOCK.PRODUCT, FUNC.MAC_ADDRESS), "MAC", (reply) => {
      state.info.mac = parseMacAddress(reply.payload);
    }),
    readDetail(get(FBLOCK.PRODUCT, FUNC.GUID), "GUID", (reply) => {
      state.info.guid = parseGuid(reply.payload);
    }),
    readDetail(get(FBLOCK.PRODUCT, FUNC.ORIGINAL_NAME), "原厂名称", (reply) => {
      state.info.originalName = parseFirmware(reply.payload);
    }),
    readDetail(get(FBLOCK.PRODUCT, FUNC.COMPONENT_ID), "组件", (reply) => {
      state.info.component = parseComponentId(reply.payload);
    }),
    readDetail(get(FBLOCK.PRODUCT, FUNC.LE_AUDIO), "LE Audio", (reply) => {
      state.info.leAudio = parseFlag(reply.payload) ? "支持" : "不支持";
    }),
    readDetail(get(FBLOCK.PRODUCT, FUNC.MANUFACTURED), "生产日期", (reply) => {
      state.info.made = parseManufactured(reply.payload);
    }),
    readDetail(get(FBLOCK.PRODUCT, FUNC.HARDWARE_REVISION), "硬件", (reply) => {
      state.info.hardware = parseFirmware(reply.payload);
    }),
  ]);
  refresh();
}

async function loadModes() {
  state.modesAll = [];
  state.favorites = null;
  const [current, capsReply, favoritesReply] = await Promise.all([
    tryAsk(get(FBLOCK.MODES, FUNC.CURRENT_MODE), "当前", READ_TIMEOUT),
    tryAsk(get(FBLOCK.MODES, FUNC.MODE_CAPS), "能力", READ_TIMEOUT),
    tryAsk(get(FBLOCK.MODES, FUNC.FAVORITES), "循环", READ_TIMEOUT),
  ]);
  if (current?.payload.length) state.currentMode = current.payload[0];
  if (favoritesReply) state.favorites = parseFavorites(favoritesReply.payload);
  const caps = capsReply ? parseModeCaps(capsReply.payload) : null;
  const builtin = caps?.bose ?? 0;
  const userReply = caps?.user
    ? null
    : await tryAsk(get(FBLOCK.MODES, FUNC.USER_INDICES), "用户模式", READ_TIMEOUT);
  const users = userReply?.payload.length
    ? [...userReply.payload]
    : Array.from({ length: caps?.user ?? 0 }, (_, i) => builtin + i);
  const guessing = users.length === 0;
  const indices = [
    ...new Set([
      ...Array.from({ length: builtin }, (_, i) => i),
      ...users,
      ...Array.from({ length: guessing ? 8 : 0 }, (_, i) => builtin + i),
    ]),
  ];
  let miss = 0;
  for (const index of indices) {
    if (link.active === false) return;
    const reply = await tryAsk(
      get(FBLOCK.MODES, FUNC.MODE_CONFIG, Uint8Array.of(index)),
      `m${index}`,
      guessing ? READ_TIMEOUT : READ_TIMEOUT * 2,
    );
    if (!reply) {
      if (!guessing) continue;
      miss += 1;
      if (miss >= 2) break;
      continue;
    }
    miss = 0;
    const mode = parseModeConfig(reply.payload);
    if (mode) state.modesAll.push(mode);
    refresh();
  }
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

  // 模式是「消噪等级 + 自适应 + 空间音频 + 风噪 + 消噪开关」一整套：
  // 切完必须把这些值读回来，否则后面动一个滑轨（会整包重写）就把模式里的设置改回去了。
  const config = await tryAsk(
    get(FBLOCK.MODES, FUNC.MODE_CONFIG, Uint8Array.of(index)),
    `m${index}`,
  );
  if (!config) return;
  const mode = parseModeConfig(config.payload);
  if (!mode) return;
  const applied = {
    cnc: mode.cnc ?? state.cfg.cnc,
    auto: Boolean(mode.auto),
    spatial: mode.spatial ?? state.cfg.spatial,
    wind: Boolean(mode.wind),
    anc: mode.anc !== false,
  };
  state.cfg = applied;
  if (state.cnc) state.cnc = { ...state.cnc, step: applied.cnc, enabled: applied.anc };
  log(`mode ${index} applied cnc=${applied.cnc} auto=${applied.auto} spatial=${applied.spatial} wind=${applied.wind} anc=${applied.anc}`);
  renderCnc();
  renderSpatial();
  renderToggles();
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
  if (link.active === false) return;
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
  refresh();
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
  refresh();
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
  refresh();
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

  function render() {
    renderModes();
    renderCnc();
    renderEq();
    renderSpatial();
    renderSidetone();
    renderVoice();
    renderToggles();
    renderTransport();
    renderBoseSettings();
  }

  function renderBoseSettings() {
    renderRename();
    renderShortcut();
    renderFavorites();
    renderVoice();
    renderBehaviour();
    renderStandby();
    renderDevices();
    renderHeadset();
  }

  return {
    ready: () => Boolean(state.eq.length || state.cnc || usableModes().length || state.hasAudioSettings),
    load: loadDevice,
    reset: closeEditor,
    render,
    renderSettings: renderBoseSettings,
    onPacket: null,
    diagRows: null,
  };
}

export const boseBrand = {
  id: "bose",
  label: "Bose",
  transport: "ble",
  services: ["0000febe-0000-0000-0000-000000000000", "0000febe-0000-1000-8000-00805f9b34fb"],
  channels: [2, 8],
  matches: (name) => NameMatch.isBose(name),
  codec: createBoseCodec,
  create: createBoseSession,
};

// 判名字的规则放在这里，原生端不再认品牌
const NameMatch = {
  isBose: (name) => {
    const n = String(name || "").toLowerCase();
    return (
      n.startsWith("bose") || n.startsWith("le-bose") || n.startsWith("qc") ||
      n.startsWith("quietcomfort") || n.startsWith("soundlink") || n.includes("bose")
    );
  },
};

const BMAP_SERVICE = "0000febe-0000-1000-8000-00805f9b34fb";
const BMAP_SERVICE_APK = "0000febe-0000-0000-0000-000000000000";
const CHAR_SECURE = "c65b8f2f-aee2-4c89-b758-bc4892d6f2d8";
const CHAR_PLAIN = "d417c028-9818-4354-99d1-2ac09d074591";

export function createBoseCodec() {
  let reassembler = createReassembler();
  let buffer = new Uint8Array();
  return {
    id: "bose",
    ble: true,
    filters: [
      { namePrefix: "Bose" },
      { namePrefix: "LE-Bose" },
      { namePrefix: "LE-QC" },
      { namePrefix: "QC" },
      { namePrefix: "QuietComfort" },
      { namePrefix: "SoundLink" },
      { services: [BMAP_SERVICE] },
      { services: [BMAP_SERVICE_APK] },
    ],
    services: [BMAP_SERVICE_APK, BMAP_SERVICE],
    chars: [CHAR_SECURE, CHAR_PLAIN],
    reset() {
      reassembler = createReassembler();
      buffer = new Uint8Array();
    },
    // SPP 自己就是整包流，BLE 上要按 20 字节切片
    chunks(bytes, link) {
      return link === "spp" ? [bytes] : segment(bytes);
    },
    parse(chunk, link) {
      if (link !== "spp") {
        const assembled = reassembler.push(chunk);
        return assembled ? decodeAll(assembled) : [];
      }
      const incoming = new Uint8Array(buffer.length + chunk.length);
      incoming.set(buffer);
      incoming.set(chunk, buffer.length);
      let end = 0;
      while (end + 4 <= incoming.length && end + 4 + incoming[end + 3] <= incoming.length) {
        end += 4 + incoming[end + 3];
      }
      buffer = incoming.slice(end);
      return decodeAll(incoming.subarray(0, end));
    },
    key(packet) {
      return keyOf(packet);
    },
    header(bytes) {
      return decodeAll(bytes)[0];
    },
  };
}
