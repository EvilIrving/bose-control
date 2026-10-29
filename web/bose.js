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
  modeConfigLayout,
  parseAnr,
  anrPayload,
  ANR_LABELS,
  isRetryableError,
  bmapErrorName,
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
import { chip, chips, fillRows, pane, refill, revealSelection } from "./ui.js";
import { profileFor, profileById, supports, DEFAULT_PROFILE } from "./profiles.js";
import { createProbeReport, inferCapabilities, renderProbeReport } from "./probe.js";

// Bose 的 BMAP 实现：读全量状态、写各项设置、把面板画出来。
// 宿主只认下面这几个入口：load() / render() / renderSettings() / diagRows()。
export function createBoseSession({ link, ui, state, refresh, log }) {
// 机型差异全部来自这张表（web/profiles.js）。一开始用 DEFAULT：产品 ID 还没读到，
// 先按最全的能力去问，谁回包就显示谁；读到 0.3 之后再换成这台耳机真正的布局。
let profile = DEFAULT_PROFILE;
// 拖消噪时不要让回包 / 写完成把滑轨 DOM 拆掉重装，否则指针丢了、旧值又盖回来。
let cncGesture = false;
let cncBusy = false;
let cncWanted = null;
// 连上后先发的探路包（QC35 / QC45 不发就不回别的东西），由 loadDevice 发。
let inited = false;
// 能力探测报告：每条命令的 tx/rx 原文 + 结论。导出诊断时一并带出，
// 用户连不上时靠它反推这台耳机支持什么。
const report = createProbeReport();
// 耳机支持的功能会在一百毫秒以内回包，不回的基本就是没有这个功能，
// 所以首轮只等很短；没回的挂到后台用长一点的超时补一次 —— 界面不等它。
const READ_TIMEOUT = 500;
const RETRY_TIMEOUT = 1000;
// 设备信息整块（MAC / 序列号 / GUID / 原厂名称…）耳机回得慢：QC Ultra 2 上实测 1.4s 上下，
// 600ms 那一档会把已经读到的值当超时丢掉，而这批详情本来就在后台读（load() 不等它），
// 所以给它一个跟设备实际延迟同量级的预算。
const DETAIL_TIMEOUT = 2000;
// 认机型的预算：产品 ID 跟电量是同一批回包，实测百毫秒级；给到 700ms 已经
// 容忍了慢固件。超时就走 DEFAULT 把功能全部问一遍，不能让首屏等型号。
const IDENTIFY_TIMEOUT = 700;
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

// BMAP 的 ERROR 回包要分类，不能一律当失败：
//   OpNotSupp(5) / FuncNotSupp(4) / FblockNotSupp(3) 是「这台耳机没有这条路」，
//     重发同一条命令只会把同一个错误再问一遍，还多花一个超时；
//   DataUnavailable(7) / Runtime(8) / Timeout(9) 才是值得再试一次的。
// 把 code 挂在 error 上，调用方据此决定要不要重试。
class BmapError extends Error {
  constructor(label, code) {
    super(`${label} ${bmapErrorName(code)}(${code})`);
    this.name = "BmapError";
    this.code = code;
    this.retryable = isRetryableError(code);
  }
}

async function ask(packet, label, timeoutMs) {
  const reply = await link.request(packet, timeoutMs ?? WRITE_TIMEOUT, { priority: timeoutMs == null || timeoutMs === WRITE_TIMEOUT ? 1 : 0 });
  if (reply.op === OP.ERROR) {
    throw new BmapError(label, reply.payload[0] ?? reply.payload[1] ?? 0);
  }
  return reply;
}

async function tryAsk(packet, label, timeoutMs) {
  const started = Date.now();
  // 请求是编码后的字节，用它解出来的头拿 key，日志里就能直接对上是哪条命令
  const head = decodeAll(packet)[0];
  const key = head ? keyOf(head) : "?";
  try {
    if (link.active === false) return null;
    const reply = await ask(packet, label, timeoutMs);
    if (link.active === false) return null;
    log(`cmd ${label} key=${key} ok elapsed=${Date.now() - started}ms`);
    // 探测报告：原始字节一起进去。适配靠字节，不靠「ok」两个字。
    report.record({
      label, packet, reply: reply.payload, verdict: reply.payload.length ? "ok" : "empty",
      detail: `key=${key} op=${reply.op}`, elapsed: Date.now() - started,
    });
    return reply;
  } catch (err) {
    // 失败也要落一条：能力矩阵靠「有没有回包」判断，不是靠猜
    log(`cmd ${label} key=${key} fail=${err.message} elapsed=${Date.now() - started}ms`);
    // 区分两种失败，这是报告最有信息量的地方：
    //   回了 ERROR → 明确拒绝，说明命令存在但这条路不给走
    //   没回包   → 可能慢、可能没有，要分开列
    if (err.code != null) {
      report.record({
        label, packet, verdict: "error", errorCode: err.code,
        detail: `key=${key} ${err.message}`, elapsed: Date.now() - started,
      });
    } else {
      report.record({
        label, packet, verdict: "timeout",
        detail: `key=${key} ${err.message}`, elapsed: Date.now() - started,
      });
    }
    return null;
  }
}

// 按机型表决定发不发。不发也要记一笔：报告里要能分清
// 「这台耳机没有这项」和「我们根本没问」，否则拿到文件只能猜。
function choose(feature, label, run) {
  if (supports(profile, feature)) return run();
  report.record({ label, packet: null, verdict: "skipped", detail: `机型表 ${profile.id} 标记跳过 ${feature}` });
  return Promise.resolve();
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
    try {
      return await ask(packet, label, WRITE_TIMEOUT);
    } catch (err) {
      // 只有「暂时失败」才值得再发一次；OpNotSupp 这类再发一次是同一个结果
      if (err.code == null || !err.retryable) {
        log(`write ${label} 不重试：${err.message}`);
        return null;
      }
      if (attempt === 1) log(`write ${label} 重试后仍失败：${err.message}`);
    }
  }
  return null;
}

function renderModes() {
  if (link.active === false) return;
  const modes = usableModes();
  const free = freeSlot();
  pane(ui.modes, modes.length > 0 || Boolean(free));
  refill(ui.modes, (row) => {
    for (const mode of modes) {
      const btn = chip(modeLabel(mode), mode.index === state.currentMode);
      btn.addEventListener("click", () => {
        if (mode.editable && mode.index === state.currentMode) openEditor(mode.index);
        else switchMode(mode.index);
      });
      row.appendChild(btn);
    }
    if (!free) return;
    const btn = chip("＋", false);
    btn.classList.add("plus");
    btn.setAttribute("aria-label", t("create"));
    btn.title = t("create");
    btn.addEventListener("click", () => openEditor(free.index));
    row.appendChild(btn);
  });
  // 机身按键也能切模式，切到的那颗可能在滑走的位置上
  revealSelection(ui.modes, state.currentMode);
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

function slider(row, { min, max, value, onChange, live }) {
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
    if (live) cncGesture = true;
    track.setPointerCapture(ev.pointerId);
    apply(ev.clientX);
  });
  track.addEventListener("pointermove", (ev) => {
    if (held) apply(ev.clientX);
  });
  const flush = () => {
    held = false;
    if (live) cncGesture = false;
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
  // ANR 机型（QC35 / QC45）没有连续档位，画枚举行，不画滑轨
  if (state.cncPath === "anr") {
    pane(ui.cnc, true);
    ui.cnc.className = "chips";
    const options = [1, 0, 3, 2]; // high / off / low / wind，跟官方 App 的排列一致
    chips(
      ui.cnc,
      options.filter((level) => ANR_LABELS[level]).map((level) => ({ key: level, label: t(`anr_${ANR_LABELS[level]}`) })),
      state.anr,
      setAnr,
    );
    return;
  }
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
    live: true,
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

// 消噪这一组：滑轨 + 自动消噪 / 风噪滤除两个开关。
// 自动消噪开着时由耳机按环境自己调等级，手动值不生效；拖滑轨就会把手动值写下去并关掉自动。
function renderCncToggles() {
  if (link.active === false) return;
  const box = ui.cncToggles;
  if (!box) return;
  box.innerHTML = "";
  if (!state.hasAudioSettings) {
    pane(box, false);
    return;
  }
  const auto = chip(t("autoCnc"), Boolean(state.cfg.auto));
  auto.addEventListener("click", () => setAuto(!state.cfg.auto));
  const wind = chip(t("wind"), Boolean(state.cfg.wind));
  wind.addEventListener("click", () => setWind(!state.cfg.wind));
  box.append(auto, wind);
  pane(box, true);
}

function renderToggles() {
  if (link.active === false) return;
  renderCncToggles();
  const items = [
    { key: "mp", label: t("multipoint"), on: state.multipoint?.enabled, show: state.multipoint != null, run: () => setMultipoint(!state.multipoint.enabled) },
    { key: "talk", label: t("conversation"), on: state.conversation, show: state.conversation != null, run: () => setConversation(!state.conversation) },
  ];
  let n = 0;
  refill(ui.toggles, (row) => {
    for (const item of items) {
      if (item.show === false) continue;
      n += 1;
      const btn = chip(item.label, item.on);
      btn.addEventListener("click", item.run);
      row.appendChild(btn);
    }
  });
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
  refill(ui.behaviour, (row) => {
    for (const item of items) {
      if (item.show === false) continue;
      n += 1;
      const btn = chip(item.label, item.on);
      btn.addEventListener("click", item.run);
      row.appendChild(btn);
    }
  });
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
  // #shortcut 装的是「组」（华为往里放手势组），chip 行得自己建才吃得到 .chips 的横向滚动。
  // 行要复用：重建会连「上一轮选中值」和用户滑到的位置一起丢掉。
  // 只摘别家的残留，不搬自己：replaceChildren 会把自己也先摘下来，scrollLeft 跟着归零
  const row = ui.shortcut.querySelector(":scope > .chips") ?? document.createElement("div");
  row.className = "chips";
  for (const child of [...ui.shortcut.children]) if (child !== row) child.remove();
  if (row.parentElement !== ui.shortcut) ui.shortcut.append(row);
  chips(
    row,
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

// 认机型：读一次 [0.3]，命中表就换表。读不到就维持 DEFAULT（最全能力）。
// 有自己的短预算：这条慢或没回，不能把整张首屏拖住。
async function identify() {
  const reply = await tryAsk(get(FBLOCK.PRODUCT, FUNC.PRODUCT_ID), "型号", IDENTIFY_TIMEOUT);
  if (!reply) {
    log("identify 超时，按 DEFAULT 继续");
    return;
  }
  const id = productIdOf(reply.payload);
  updateProfile(id);
  state.info.product = parseProductId(reply.payload);
  state.info.productName = productName(id);
  refresh();
}

// 机型表换掉之后，界面上按旧表画出来的东西要重画一遍：QC35 没有模式行、
// QC Earbuds 没有可编辑槽位，都不应该等用户点一下才发现是空的。
function updateProfile(productId) {
  const next = profileFor(productId);
  if (next.id === profile.id) return;
  log(`profile ${profile.id} → ${next.id} (product=0x${(productId ?? 0).toString(16)})`);
  profile = next;
  state.profile = profile.id;
  refresh();
}

// 消噪在本项目里有三条完全不同的路，同一台耳机只走其中一条：
//   audioSettings  [31.10] SETGET 五字节，能立即生效，还顺带给出空间音频/风噪/自动消噪
//   cncDirect      [1.5]   SETGET 两字节，连续档位（QC Earbuds 一代、部分旧固件）
//   anr            [1.6]   SETGET 一字节，四档枚举（QC35 / QC45）
// 以前只试前两条，QC35 的消噪根本不上屏。
function loadCnc(sharedAudioSettings = null) {
  const order = profile.cnc ?? [];
  if (!order.length) return Promise.resolve();
  return (async () => {
    for (const kind of order) {
      if (link.active === false) return;
      if (kind === "audioSettings") {
        // 31.10 只发一次：第一批已经发过了就等同一个 Promise，拿到结果后再判路径。
        if (sharedAudioSettings) {
          await sharedAudioSettings;
          if (state.hasAudioSettings) {
            state.cncPath = "audioSettings";
            if (state.cnc) state.cnc.step = state.cfg.cnc;
            refresh();
            return;
          }
          continue;
        }
        if (state.hasAudioSettings) {
          state.cncPath = "audioSettings";
          if (state.cnc) state.cnc.step = state.cfg.cnc;
          refresh();
          return;
        }
        const reply = await tryAsk(get(FBLOCK.MODES, FUNC.AUDIO_SETTINGS), "音效", READ_TIMEOUT);
        if (reply) {
          state.cncPath = "audioSettings";
          applyCfg(reply);
          return;
        }
        continue;
      }
      if (kind === "cncDirect") {
        const reply = await tryAsk(get(FBLOCK.SETTINGS, FUNC.CNC), "降噪", READ_TIMEOUT);
        if (reply) {
          applyCnc(reply);
          state.cncPath = "cncDirect";
          return;
        }
        continue;
      }
      if (kind === "anr") {
        const reply = await tryAsk(get(FBLOCK.SETTINGS, FUNC.ANR), "ANR", READ_TIMEOUT);
        if (reply) {
          // cncPath 必须在 applyAnr 之前定下来：applyAnr 里的 refresh 会马上重画，
          // 那时如果路径还是空的，renderCnc 会走滑轨分支、把 ANR 行当成“没有消噪”隐藏。
          state.cncPath = "anr";
          applyAnr(reply);
          return;
        }
      }
    }
  })();
}

// QC35 / QC45 的 ANR 是四档枚举，不是滑轨。state.anr 存当前档位，
// state.cnc 置 null，让控件渲染走「枚举」分支而不是拉一条 0..10 的滑轨。
function applyAnr(reply) {
  const level = parseAnr(reply.payload);
  if (level == null) return;
  state.anr = level;
  state.cnc = null;
  refresh();
}

async function loadDevice() {
  retries = [];
  // 「正在播放」是华为双连接列表里的状态，Bose 没有这一项，先隐藏
  if (ui.playing) pane(ui.playing, false);
  // 认机型：先发，不阻塞下面全平台都有的那几条（版本 / 电量 / 名称）。
  // EQ、31.x、消噪依赖机型，它们在 await identified 之后才发。
  // 以前是先平行发第一批、在回调里再换表，结果是 QC35 被问了 EQ、多点、自动播放
  // 这些它根本没有的命令，每条等满 500ms 超时。
  // 「读到再改」不算适配，适配是在发之前就知道该发什么。
  const identified = identify();
  const [versionReply] = await Promise.all([
    tryAsk(get(FBLOCK.PRODUCT, FUNC.BMAP_VERSION), "init", READ_TIMEOUT),
    read(get(FBLOCK.STATUS, FUNC.BATTERY), "电量", (reply) => {
      state.battery = parseBattery(reply.payload);
    }),
    read(get(FBLOCK.SETTINGS, FUNC.NAME), "名称", (reply) => {
      state.name = parseName(reply.payload) || link.name;
    }),
    // EQ 不等认机型：它是并行的一条，回不回都不阻塞首屏；
    // 没有 EQ 的机型（QC35）回 FuncNotSupp 而不是超时，代价接近零。
    // 真正要等的是 loadModes——那是串行的，等错代价是几秒。
    read(get(FBLOCK.SETTINGS, FUNC.EQ), "均衡", (reply) => {
      state.eq = parseEq(reply.payload);
    }),
    identified,
  ]);
  log(versionReply ? `init-ok profile=${profile.id}` : `init-silent profile=${profile.id}`);
  // QC35 / QC45 不先 GET [0.1] 就什么都不回。凑巧 [0.1] 就是 BMAP 版本查询，
  // 上面已经发过就不用再发一遍。
  const probeKey = profile.init ? `${profile.init[0]}.${profile.init[1]}` : null;
  const versionKey = `${FBLOCK.PRODUCT}.${FUNC.BMAP_VERSION}`;
  if (probeKey && probeKey !== versionKey) {
    inited = true;
    await tryAsk(get(profile.init[0], profile.init[1]), "probe", READ_TIMEOUT);
  }
  // 第二批：真正依赖机型的那几条。
  //
  // 这里省的是**串行**的代价，不是并行的：loadModes 是一个槽位一条地发，
  // QC35 以前按「猜 8 个槽位」一个个问，每条 500ms，首屏要多等 4 秒才交出去。
  // 并行的那几条多问一次几乎不花时间，所以 EQ 留在第一批。
  // 31.10 只发一次：loadCnc 要读同一个地址，但它拿的是下面这个 Promise，
  // 不是自己再发一条。两条同时发会让回包互相抢、也可能写同一个 key。
  const audioSettingsRead = choose("audioSettings", "音效", () =>
    read(get(FBLOCK.MODES, FUNC.AUDIO_SETTINGS), "音效", applyCfg));
  await Promise.all([
    audioSettingsRead ?? Promise.resolve(),
    loadCnc(audioSettingsRead),
    loadModes(),
  ]);

  // 音效设置和降噪都能回的时候，降噪档位以音效包为准
  state.hasAudioSettings = Boolean(state.hasAudioSettings);

  refresh();

  if (link.active === false) return false;
  // 剩余主页功能、设置和信息继续读取，不阻塞已回包的控制。
  // 表里标了 skip 的整条不发：QC35 上 1.7/1.10/1.24 这些必然超时，白等 500ms。
  await Promise.all([
    read(get(FBLOCK.PRODUCT, FUNC.FIRMWARE), "固件", (reply) => {
      state.info.firmware = parseFirmware(reply.payload);
    }),
    read(get(FBLOCK.SETTINGS, FUNC.SIDETONE), "侧音", (reply) => {
      state.sidetone = parseSidetone(reply.payload);
    }),
    choose("multipoint", "双连", () =>
      read(get(FBLOCK.SETTINGS, FUNC.MULTIPOINT), "双连", (reply) => {
        state.multipoint = parseMultipoint(reply.payload);
      })),
    read(get(FBLOCK.SETTINGS, FUNC.CONVERSATION), "对话", (reply) => {
      state.conversation = parseConversation(reply.payload);
    }),
    read(get(FBLOCK.SETTINGS, FUNC.STANDBY), "关机", (reply) => {
      state.standby = parseStandby(reply.payload);
    }),
    read(get(FBLOCK.SETTINGS, FUNC.VOICE_PROMPTS), "语音提示", (reply) => {
      state.voice = parseVoicePrompts(reply.payload);
    }),
    choose("autoPlay", "自动播放", () =>
      read(get(FBLOCK.SETTINGS, FUNC.AUTO_PLAY_PAUSE), "自动播放", (reply) => {
        state.autoPlay = parseFlag(reply.payload);
      })),
    choose("autoAnswer", "自动接听", () =>
      read(get(FBLOCK.SETTINGS, FUNC.AUTO_ANSWER), "自动接听", (reply) => {
        state.autoAnswer = parseFlag(reply.payload);
      })),
    read(get(FBLOCK.SETTINGS, FUNC.DISABLE_CAPTOUCH), "触控", (reply) => {
      state.captouch = parseFlag(reply.payload);
    }),
    read(get(FBLOCK.SETTINGS, FUNC.BUTTONS), "快捷", (reply) => {
      state.shortcut = parseActionButton(reply.payload);
    }),
    read(get(FBLOCK.AUDIO, FUNC.TRANSPORT), "播放", () => {
      state.hasTransport = true;
    }),
  ]);

  refresh();
  log("mode-defs " + state.modesAll.map((m) =>
    `${m.index}:${m.name || "-"}:cnc=${m.cnc ?? "-"}:auto=${m.auto ? 1 : 0}:spatial=${m.spatial ?? "-"}:wind=${m.wind ? 1 : 0}:anc=${m.anc === false ? 0 : 1}`,
  ).join(" | "));
  log(`caps modes=${state.modesAll.length} eq=${state.eq.length} cnc=${Boolean(state.cnc)} ` +
    `spatial=${state.hasAudioSettings} sidetone=${state.sidetone != null} ` +
    `multipoint=${state.multipoint != null} conversation=${state.conversation != null} ` +
    `standby=${state.standby != null} voice=${state.voice != null} captouch=${state.captouch != null} ` +
    `autoAnswer=${state.autoAnswer != null} autoPlay=${state.autoPlay != null} transport=${state.hasTransport}`);
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
      state.info.leAudio = Boolean(parseFlag(reply.payload));
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
  // 表里没有 31.6（QC35）就不发任何模式请求：以前发 8 条必然超时的命令，
  // 首屏要多等好几秒，而且每次都白等。
  if (!profile.modeConfig) {
    refresh();
    return;
  }
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
  // 表里给了可编辑槽位就以表为准：能力包不回的时候，靠猜的 8 个槽位
  // 在 QC Earbuds 上会多打 8 条失败请求。
  const fromTable = profile.editableSlots.length > 0;
  const indices = fromTable
    ? [...new Set([...Array.from({ length: Math.max(builtin, profile.presetModes.length) }, (_, i) => i), ...profile.editableSlots])]
    : [
      ...new Set([
        ...Array.from({ length: builtin }, (_, i) => i),
        ...users,
        ...Array.from({ length: guessing ? 8 : 0 }, (_, i) => builtin + i),
      ]),
    ];
  // 每个槽位一条地串行问是以前的首屏瓶颈：QC35 猜 8 个槽位 × 500ms = 4 秒。
  // 不同槽位是不同的 key，transport 本来就允许并行（MAX_IN_FLIGHT = 4），
  // 所以这里一次发完，谁的先回先画。
  // 猜槽位（能力包没回）的机型仍然用短超时 + 早停：多问的那几个不存在。
  const guessTimeout = guessing && !fromTable ? READ_TIMEOUT : READ_TIMEOUT * 2;
  const results = await Promise.all(
    indices.map((index) =>
      tryAsk(get(FBLOCK.MODES, FUNC.MODE_CONFIG, Uint8Array.of(index)), `m${index}`, guessTimeout)
        .then((reply) => ({ index, reply })),
    ),
  );
  if (link.active === false) return;
  for (const { index, reply } of results) {
    if (!reply) continue;
    const mode = parseModeConfig(reply.payload);
    if (mode) state.modesAll.push(mode);
  }
  state.modesAll.sort((a, b) => a.index - b.index);
  refresh();
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
  // parseModeConfig 在机型没有这个字段时给 null，不是 0。
  // 这里必须保留 null 或交给旧值，否则「无风噪」会被误写成「风噪关」，
  // 下一次整包重写就把耳机的风噪给改了。
  const applied = {
    cnc: mode.cnc ?? state.cfg.cnc,
    auto: mode.auto == null ? state.cfg.auto : Boolean(mode.auto),
    spatial: mode.spatial ?? state.cfg.spatial,
    wind: mode.wind == null ? state.cfg.wind : Boolean(mode.wind),
    anc: mode.anc == null ? state.cfg.anc : mode.anc,
  };
  state.cfg = applied;
  if (state.cnc && applied.cnc != null) state.cnc = { ...state.cnc, step: applied.cnc, enabled: applied.anc };
  log(`mode ${index} layout=${mode.layout} applied cnc=${applied.cnc} auto=${applied.auto} spatial=${applied.spatial} wind=${applied.wind} anc=${applied.anc}`);
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
    // 没有 anc 位的机型存 null，编辑器据此不渲染那个开关（始终开着的开关就是噪声）
    anc: mode.anc == null ? null : mode.anc,
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

  // 顺序跟设备页一致：消噪 → 沉浸式音频 → 风噪滤除 → 自适应 → 机身可切换
  const labeled = (labelKey, build) => {
    const wrap = document.createElement("div");
    wrap.className = "edit-row";
    const name = document.createElement("span");
    name.className = "edit-label";
    name.textContent = t(labelKey);
    wrap.appendChild(name);
    wrap.appendChild(build());
    ui.editor.appendChild(wrap);
    return wrap;
  };

  labeled("cnc", () => {
    const band = document.createElement("div");
    band.className = "band cnc-band";
    slider(band, {
      min: 0,
      max: cncMax(),
      value: Math.min(edit.cnc ?? 0, cncMax()),
      onChange: (value) => {
        edit.cnc = value;
      },
    });
    return band;
  });

  if (state.hasAudioSettings) {
    labeled("spatial", () => {
      const row = document.createElement("div");
      row.className = "chips";
      SPATIAL_OPTIONS.forEach((option, optionIndex) => {
        const btn = chip(pick(option), edit.spatial === optionIndex);
        btn.addEventListener("click", () => {
          edit.spatial = optionIndex;
          renderEditor();
        });
        row.appendChild(btn);
      });
      return row;
    });
  }

  labeled("wind", () => {
    const row = document.createElement("div");
    row.className = "chips";
    const btn = chip(t(edit.wind ? "stateOn" : "stateOff"), edit.wind);
    btn.addEventListener("click", () => {
      edit.wind = !edit.wind;
      renderEditor();
    });
    row.appendChild(btn);
    return row;
  });

  labeled("autoCnc", () => {
    const row = document.createElement("div");
    row.className = "chips";
    const btn = chip(t(edit.auto ? "stateOn" : "stateOff"), edit.auto);
    btn.addEventListener("click", () => {
      edit.auto = !edit.auto;
      renderEditor();
    });
    row.appendChild(btn);
    return row;
  });

  if (state.favorites) {
    labeled("cycle", () => {
      const row = document.createElement("div");
      row.className = "chips";
      const btn = chip(t(edit.cycle ? "stateOn" : "stateOff"), edit.cycle);
      btn.addEventListener("click", () => {
        edit.cycle = !edit.cycle;
        renderEditor();
      });
      row.appendChild(btn);
      return row;
    });
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
        // 没有 anc 位的机型（prince 系）传 null，modeConfigPayload 会发39 字节；
        // 之前一律发 40，多出来的那个字节会被当成 anc 位或者直接被拒。
        anc: profile.ancToggle ? edit.anc : null,
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
  renderCncToggles();
}

async function setAuto(on) {
  if (!(await writeAudioSettings({ ...state.cfg, auto: on, anc: true }))) return;
  renderCncToggles();
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

// 写消噪时也按同一张表的优先级选路，不能拿“先试哪条”当成猜。
// 与读的区别：写失败了要能回退到下一条，写成功了不再问。
async function setCnc(level) {
  cncWanted = level;
  if (cncBusy) return;
  cncBusy = true;
  try {
    while (cncWanted != null && link.active !== false) {
      const next = cncWanted;
      cncWanted = null;
      const ok = await writeCnc(next);
      if (!ok) {
        log(`setCnc ${next} 失败：这台耳机没有可用的消噪写入路径`);
        if (!cncGesture) renderCnc();
        return;
      }
      if (state.cnc) state.cnc.step = next;
      else state.cnc = { steps: cncMax() + 1, step: next, total: cncMax() + 1, enabled: true };
      state.cfg.cnc = next;
      renderCncToggles();
    }
  } finally {
    cncBusy = false;
  }
}

async function writeCnc(level) {
  const order = profile.cnc ?? [];
  // 自动消噪开着的时候手动等级不会生效：拖滑轨就当成「我要手动」，把 auto 一起关掉
  if (order.includes("audioSettings")) {
    if (state.cfg.auto) {
      if (await writeAudioSettings({ ...state.cfg, cnc: level, auto: false, anc: true })) return true;
    } else if (await writeAudioSettings({ ...state.cfg, cnc: level, anc: true })) {
      return true;
    }
  }
  if (order.includes("cncDirect")) {
    const reply = await writeAsk(setGet(FBLOCK.SETTINGS, FUNC.CNC, cncPayload(level, 1)), "降噪");
    if (reply) {
      state.cncPath = "cncDirect";
      return true;
    }
  }
  return false;
}

// QC35 / QC45：一字节枚举直接写回，写完读一次确认。
async function setAnr(level) {
  const reply = await writeAsk(setGet(FBLOCK.SETTINGS, FUNC.ANR, anrPayload(level)), "ANR");
  if (!reply) return;
  const back = await tryAsk(get(FBLOCK.SETTINGS, FUNC.ANR), "ANR", READ_TIMEOUT);
  if (back) applyAnr(back);
  else {
    state.anr = level;
    renderCnc();
  }
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
    renderHeadset();
  }

  // 耳机不只会回包，也会主动推：（机身按键切了模式、降噪按钮、电量变化、
  // 另一台设备连上又断开）。这些包没人在等，以前被 transport 当成 unexpected-packet
  // 丢掉，界面就停在旧值上，直到用户自己重进一次。
  // 能用回包解出来的字段就当场解，解不出来的不回空话。
  function onPacket(packet) {
    if (link.active === false) return;
    const key = keyOf(packet);
    if (packet.op !== OP.STATUS) return;
    switch (key) {
      case "1.2": // 名称被别的 App 或耳机自己改了
        state.name = parseName(packet.payload) || state.name;
        break;
      case "1.5": // CNC 被机身按钮改了
        if (cncGesture || cncBusy) return;
        if (state.cncPath !== "anr") {
          applyCnc(packet);
          return;
        }
        break;
      case "1.6": // ANR 被机身按钮改了（QC35 / QC45）
        applyAnr(packet);
        return;
      case "1.10": // 另一台设备连入 / 断开改掉了多点连接
        state.multipoint = parseMultipoint(packet.payload);
        break;
      case "2.2": // 电量变化
        state.battery = parseBattery(packet.payload);
        break;
      case "31.3": // 机身模式键切了模式
        if (packet.payload.length) {
          state.currentMode = packet.payload[0];
          renderModes();
        }
        return;
      case "31.10": // 消噪 / 空间音频 / 风噪被别的控制端改了
        if (cncGesture || cncBusy) return;
        applyCfg(packet);
        return;
      default:
        return;
    }
    log(`notify ${key} ${packet.payload.length}B`);
    refresh();
  }

  return {
    ready: () => Boolean(state.eq.length || state.cnc || state.anr != null || usableModes().length || state.hasAudioSettings),
    load: loadDevice,
    reset: closeEditor,
    render,
    renderSettings: renderBoseSettings,
    onPacket,
    // 导出诊断时把探测报告带出去。这是「用户连不上」时唯一能用的证据：
    // 完整字节、每条结论、以及由结论反推出来的能力矩阵。
    diagReport: () => {
      const capabilities = inferCapabilities(report.entries);
      return renderProbeReport({ report, capabilities, profile });
    },
    diagRows: () => {
      const capabilities = inferCapabilities(report.entries);
      const on = [];
      if (capabilities.hasAudioModes) on.push("31.x");
      if (capabilities.hasAudioSettings) on.push("31.10");
      if (capabilities.hasCncDirect) on.push("1.5");
      if (capabilities.hasAnr) on.push("ANR");
      if (capabilities.hasEq) on.push("EQ");
      return [
        ["机型", profile.id],
        ["探测", `${report.summary.ok} 通 / ${report.summary.error} 拒 / ${report.summary.timeout} 无声`],
        ["可用", on.join(" / ") || "无"],
        ...(capabilities.modeConfigBytes.length
          ? [["31.6 回包", `${capabilities.modeConfigBytes.join("/")} 字节`]]
          : []),
      ];
    },
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
