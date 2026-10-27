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
import { HeadsetLink, isCancelled } from "./transport.js";
import { createBoseCodec } from "./bose.js";
import { brandById, brandForName, bridgeAvailable, brandsHere, missingCapabilities, nativeHub, platformInfo, setBridgeAvailable } from "./brands.js";
import { LocalBridge } from "./bridge.js";
import { getBrand, setBrand } from "./brand.js";
import { chip, chips, fillRows, pane } from "./ui.js";
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
import { hasNative, nativeCall } from "./native.js";
import { createMenu } from "./menu.js";
import { logCount, logLine, logSnapshot } from "./log.js";
import { exportResult } from "./diag.js";
import { brandLogoSvg } from "./logos.js";

let link = new HeadsetLink(brandById("bose").codec());
const $ = (id) => document.getElementById(id);
const ui = {
  status: $("status"),
  meta: $("meta"),
  go: $("go"),
  goText: $("go-text"),
  info: $("info"),
  deviceTrigger: $("device-trigger"),
  deviceMenu: $("device-menu"),
  hint: $("hint"),
  controls: $("controls"),
  modes: $("modes"),
  cnc: $("cnc"),
  cncToggles: $("cnc-toggles"),
  eq: $("eq"),
  spatial: $("spatial"),
  sidetone: $("sidetone"),
  voice: $("voice"),
  behaviour: $("behaviour"),
  lang: $("lang"),
  settings: $("settings"),
  settingsOpen: $("settings-open"),
  playing: $("playing"),
  settingsOpenHome: $("settings-open-home"),
  settingsClose: $("settings-close"),
  diagActions: $("diag-actions"),
  toggles: $("toggles"),
  standby: $("standby"),
  transport: $("transport"),
  editor: $("mode-editor"),
  rename: $("rename"),
  shortcut: $("shortcut"),
  shortcutTitle: $("shortcut-title"),
  favorites: $("favorites"),
  headset: $("headset-actions"),
  brand: $("brand"),
  hub: $("hub"),
  pageDevices: $("page-devices"),
  pageDevice: $("page-device"),
  back: $("back"),
  devicesTitle: $("devices-title"),
  goList: $("go-list"),
  goListText: $("go-list-text"),
};

let state = {
  peers: [],
  selected: null,
  page: "devices",
  modesAll: [],
  currentMode: null,
  favorites: null,
  shortcut: null,
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
  // 每台耳机上一次读到的电量：回到设备中心、换台设备再回来都还看得见。
  // 只在本次运行里有效，没读过的不写，不编数字。
  levels: {},
};

// 页面里每一段都往 log.js 里记一行，界面上只留「导出诊断」一个按钮。
function log(line, scope = "app") {
  logLine(scope, line);
}

// 原生导出的回执：成功/失败都要有反馈，设置页重绘之后结果还在
let diagExport = null;

// 回执不能塞进 #diag-actions：那行是 nowrap 的横向滚动容器，路径一长就被滑出屏
function diagNote() {
  let note = document.getElementById("diag-export-state");
  if (!note && ui.diagActions) {
    note = document.createElement("span");
    note.id = "diag-export-state";
    note.className = "diag-note";
    ui.diagActions.after(note);
  }
  return note;
}

function exportText(result) {
  if (!result) return "";
  const fill = (key) =>
    t(key)
      .replace("{path}", result.path || "?")
      .replace("{bytes}", String(result.bytes ?? 0))
      .replace("{error}", result.error || t("unknown"));
  if (result.state === "saved") return fill("exportSaved");
  if (result.state === "savedButShareFailed") return fill("exportShareFailed");
  if (result.state === "canceled") return fill("exportCanceled");
  if (result.state === "unparsed") return t("exportUnparsed");
  return fill("exportFailed");
}

window.onDiagExported = (info) => {
  diagExport = exportResult(info);
  const text = exportText(diagExport);
  logLine(diagExport.state === "saved" ? "app" : "err", text);
  const note = diagNote();
  if (note) note.textContent = text;
};

// 页面上任何地方崩了都要留下痕迹，不然只有一行"点不动"可看
window.addEventListener("error", (ev) => {
  const where = `${ev.filename || "?"}:${ev.lineno ?? "?"}:${ev.colno ?? "?"}`;
  logLine("err", `${ev.message} @ ${where}${ev.error?.stack ? `\n${ev.error.stack}` : ""}`);
});
window.addEventListener("unhandledrejection", (ev) => {
  const reason = ev.reason;
  const detail = reason?.stack ?? reason?.message ?? String(reason);
  logLine("err", `unhandled ${detail}`);
});

// 当前这次连接用的是哪个品牌模块；宿主自己不认识任何品牌
let session = null;

function shortVersion(version) {
  return version ? String(version).split("+")[0] : "";
}

function applyLabels() {
  document.documentElement.lang = getLang() === "zh" ? "zh-CN" : "en";
  for (const el of document.querySelectorAll("[data-label]")) {
    el.textContent = t(el.dataset.label);
  }
  ui.back.setAttribute("aria-label", t("back"));
  ui.deviceTrigger.setAttribute("aria-label", t("switchDevice"));
  ui.deviceMenu.setAttribute("aria-label", t("switchDevice"));
  ui.back.title = t("back");
  ui.settingsOpenHome.setAttribute("aria-label", t("settings"));
}

function renderInfo() {
  const rows = [
    [t("productName"), state.info.productName],
    [t("product"), state.info.product],
    [t("fw"), shortVersion(state.info.firmware), state.info.firmware],
    [t("serial"), state.info.serial],
    [t("leftSerial"), state.info.leftSerial],
    [t("rightSerial"), state.info.rightSerial],
    [t("mac"), state.info.mac],
    [t("made"), state.info.made],
    [t("hardware"), state.info.hardware],
  ].filter((row) => row[1]);
  fillRows(ui.info, rows);
  pane(ui.info, rows.length > 0);
}

function renderLanguage() {
  chips(ui.lang, LANG_NAMES.map((item) => ({ key: item.id, label: item.native })), getLang(), (id) => {
    setLang(id);
    applyLabels();
    renderAll();
  });
}

// 一键导出：页面日志 + 设备列表原样 + 原生环境，交给原生写文件并调起分享
function canExportDiag() {
  return typeof window.NativeBLE?.exportDiag === "function" ||
    Boolean(window.webkit?.messageHandlers?.exportDiag);
}

function exportDiag() {
  const env = nativeEnv();
  const header = [
    `# Bose Connector 诊断`,
    `时间 ${new Date().toString()}`,
    `UA ${navigator.userAgent}`,
    `屏幕 ${screen.width}x${screen.height} dpr=${devicePixelRatio} 语言 ${navigator.language} 时区 ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    `WebView ${(String(navigator.userAgent).match(/Chrome\/(\d+)/) || [])[1] ?? "非 Chromium"}`,
    `原生平台 ${env ? JSON.stringify(env) : hasNative() ? "原生（宿主没有 env 接口）" : "浏览器"}`,
    `页面能力 ${JSON.stringify(platformInfo())} / hub=${nativeHub()} / bridge=${bridgeAvailable()} / brands=${brandsHere().map((b) => b.id).join(",")}`,
    `当前品牌 ${getBrand()} / 页面 ${state.page} / link ${state.link} / busy ${state.busy}`,
    `设备名 ${state.name || link.name || "—"} / 通道 ${link.link} / 错误 ${link.lastError || "—"}`,
    `配对表 原生给了 ${peerDiag.total} 台，能用 ${peerDiag.matched} 台` +
      (peerDiag.dropped.length ? `，没显示：${peerDiag.dropped.join(" / ")}` : ""),
    `不支持 ${missingCapabilities().join(" / ") || "无"}`,
    `页面日志 ${logCount()} 行（历史以原生持久文件为准）`,
  ];
  const snap = logSnapshot();
  header.push(`页面落盘 ${snap.persisted ? "正常" : "不可用"}`,
    `最近 20 行（仅快照，完整历史见下）`,
    ...snap.recent);
  const text = header.join("\n");
  log(`导出诊断 ${text.length} 字符`);
  try {
    nativeCall("exportDiag", text);
  } catch (err) {
    log(`导出失败：${err.message}`, "err");
  }
}

function deviceSettingPanes() {
  return [
    ui.rename,
    ui.shortcut,
    ui.favorites,
    ui.voice,
    ui.behaviour,
    ui.standby,
    ui.playing,
    ui.info,
    ui.headset,
  ];
}

function hideDeviceSettings() {
  for (const el of deviceSettingPanes()) pane(el, false);
}

function renderSettings() {
  renderLanguage();
  if (sessionLive()) {
    renderInfo();
    session?.renderSettings?.();
  } else {
    hideDeviceSettings();
  }
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
  ui.diagActions.replaceChildren();
  const canExport = canExportDiag();
  if (canExport) {
    const btn = chip(t("exportDiag"), false);
    btn.addEventListener("click", exportDiag);
    ui.diagActions.appendChild(btn);
  }
  const note = diagNote();
  if (note) note.textContent = canExport && diagExport ? exportText(diagExport) : "";
  pane(ui.diagActions, canExport || Boolean(diagExport));
}

function setPage(page) {
  const changed = state.page !== page;
  state.page = page;
  ui.pageDevices.classList.toggle("current", page === "devices");
  ui.pageDevice.classList.toggle("current", page === "device");
  // 进设备页永远从头看，别带着上一次的滚动位置
  if (changed && page === "device") ui.pageDevice.scrollTop = 0;
}

function backToDevices() {
  if (ui.settings.classList.contains("open")) {
    closeSettings();
    return;
  }
  setPage("devices");
  // 原生设备中心和本机串口桥走同一条刷新路径（桥这条以前漏了）
  refreshPeers();
}

// 「连上了」= 通道开着，而且这一台真的回过包（state.link 只有 session.load() 成功才变 ready）。
// 系统蓝牙链路不算数：App 关了控制通道之后链路还会挂一阵，卡片照它写就会骗人——
// 显示已连接、点进去其实得重连、重读一遍。
function sessionLive() {
  return link.connected && state.link === "ready";
}

let paintQueued = false;

// 每个回包都会调它，合并到一帧里画一次，省得连点的时候一直重排
function renderAll() {
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    paintAll();
  });
}

function paintAll() {
  const on = sessionLive();
  const level = on ? batteryText(state.battery) : "";
  // 先记账再画列表，不然方块上的电量会晚一帧
  if (on && state.selected && level) state.levels[state.selected] = level;
  const page = state.page === "device" ? "device" : "devices";
  setPage(page);
  renderBrand();
  renderHub();
  ui.controls.hidden = !on;
  // 设置页里的断开按钮不做加载态，它只负责断开
  ui.go.disabled = false;
  ui.goText.textContent = on ? t("disconnect") : t("connect");
  ui.goList.classList.toggle("busy", state.busy);
  // 有设备中心时，选设备靠列表；浏览器 / iOS / Android 还得靠这个按钮
  ui.goList.hidden = hubReady() && (state.peers ?? []).length > 0;
  ui.goListText.textContent = t("connect");
  ui.back.hidden = !hubReady() || page !== "device";
  ui.deviceTrigger.hidden = !on;
  // 只在真有事的时候提示，别在首页堆一句「请先连接耳机」
  const hint = state.busy ? linkText("busy") : state.link === "idle" || state.link === "ready" ? "" : linkText(state.link);
  const hintPage = page === "device" ? ui.pageDevice : ui.pageDevices;
  if (ui.hint.parentElement !== hintPage) hintPage.appendChild(ui.hint);
  ui.hint.textContent = on ? "" : hint;
  if (!on) {
    deviceMenu.close(false);
    ui.status.textContent = "";
    ui.meta.textContent = "";
    hideDeviceSettings();
    return;
  }
  ui.status.textContent = state.name || link.name || "";
  ui.meta.textContent = level;
  if (deviceMenu.isOpen()) renderDeviceMenu();
  renderInfo();
  session?.render?.();
}

// 有原生设备中心（目前是 macOS）就直接列出系统里已配对的耳机，点一台控一台；
// 没有的话退回「品牌芯片 + 连接」的老路。
function hubReady() {
  return nativeHub() || bridgeAvailable();
}

// 设备列表：原生端给，或者本机串口桥给
async function loadPeers() {
  if (nativeHub()) {
    try {
      nativeCall("listDevices");
    } catch {
      /* 老版本桥没有这个方法，也没有设备中心可刷新 */
      peerPending = false;
    }
    return;
  }
  if (!bridgeAvailable()) return;
  try {
    onDeviceList(JSON.stringify(await LocalBridge.list()));
  } catch (err) {
    // 桥断了：这一条回不来，别把后面的自动刷新一起卡死
    peerPending = false;
    log(`设备列表拿不到：${err.message}`);
  }
}

let hubSignature = "";

function renderHub() {
  const list = state.peers ?? [];
  ui.hub.hidden = !hubReady() || list.length === 0;
  if (ui.hub.hidden) { hubSignature = ""; return; }
  const signature = JSON.stringify([list, state.selected, sessionLive(), state.levels, getLang()]);
  if (signature === hubSignature) return;
  hubSignature = signature;
  ui.hub.innerHTML = "";

  for (const peer of list) {
    peer.brand = peer.brand ?? brandForName(peer.name)?.id ?? "bose";
    const card = document.createElement("button");
    card.type = "button";
    card.className = "peer-card";

    const live = sessionLive() && state.selected === peer.address;
    // 绿点连着、灰点没连；文字只留在 title / aria-label 里，不再占一行
    const on = live || peer.connected;
    const status = t(on ? "connected" : "notConnected");

    // 第一行：设备名单独一行、不许换行，太长只出省略号
    const name = document.createElement("span");
    name.className = "peer-name";
    name.textContent = peer.name || peer.address;
    name.title = peer.name || peer.address;

    // 第二行：厂商词标 + 状态点；品牌文字只留在 title / aria-label 里
    const tag = document.createElement("i");
    tag.className = "peer-brand";
    const brandLabel = brandById(peer.brand)?.label ?? peer.brand;
    const mark = brandLogoSvg(peer.brand);
    if (mark) {
      tag.dataset.brand = peer.brand;
      tag.title = brandLabel;
      tag.setAttribute("aria-label", brandLabel);
      tag.innerHTML = mark;
    } else {
      tag.textContent = brandLabel;
    }

    const dot = document.createElement("span");
    dot.className = on ? "dot on" : "dot";
    dot.title = status;
    dot.setAttribute("aria-label", status);

    const meta = document.createElement("div");
    meta.className = "peer-meta";
    meta.append(tag, dot);

    card.append(name, meta);

    // 电量：读过的那台都有，没读过就空着，不编数字
    const level = state.levels[peer.address] ?? "";
    if (level) {
      const levels = document.createElement("b");
      levels.className = "peer-levels";
      levels.textContent = level;
      card.append(levels);
    }

    if (live) card.classList.add("active");

    card.addEventListener("click", () => {
      if (sessionLive() && state.selected === peer.address) {
        setPage("device");
        return;
      }
      connect(peer);
    });
    ui.hub.appendChild(card);
  }


}

// 上一次设备列表的内容签名：一样的回包不再重画
let peersSig = null;

let droppedSig = "";
// 原生给到的配对表识别结果，固定留在诊断里：日志区会被耳机读取淹没，丢了就查不到
let peerDiag = { total: 0, matched: 0, dropped: [] };

// 少一台时最需要知道的是「为什么」，不是「少了几台」
function exclusionReason(name, usable) {
  const n = String(name || "").trim();
  if (!n) return "no-name";
  const brand = brandForName(n);
  if (brand && !usable.has(brand.id)) return "transport-unavailable";
  return "no-match";
}

window.onDeviceList = (json) => {
  peerPending = false;
  const startedAt = performance.now();
  let rows = [];
  try {
    rows = JSON.parse(json);
  } catch {
    rows = [];
  }
  // 原生端只负责把配对设备全给出来，认品牌是这边的事；认不出的（键盘、鼠标、手机）直接丢掉，
  // 这台宿主没有对应通道的品牌也丢掉（商店版只报 BLE，华为卡片点进去也连不上），
  // 但要在诊断里留一行：少一台时得能分清是原生没给、没认上、还是这台机器走不通
  const usable = new Set(brandsHere().map((brand) => brand.id));
  const brandId = (peer) => brandForName(peer.name)?.id ?? null;
  const dropped = rows
    .filter((peer) => {
      const id = brandId(peer);
      return !id || !usable.has(id);
    })
    .map((peer) => peer.name || peer.address);
  peerDiag = { total: rows.length, matched: rows.length - dropped.length, dropped };
  logLine("hub", `enumerate-end 原生给了 ${rows.length} 台，能用 ${peerDiag.matched}`, {
    stage: "C", event: "enumerate-end",
    detail: rows.map((p) => `${p.name || "(无名)"}@${p.address || "-"}=${brandForName(p.name)?.id ?? "no-match"}`).join(" | ")
      + ` 用时=${Math.round(performance.now() - startedAt)}ms`,
  });
  // 逐台写排除原因：以后少一台，直接看是没名字还是没匹配上
  for (const row of rows) {
    const id = brandId(row);
    if (id && usable.has(id)) continue;
    const reason = exclusionReason(row.name, usable);
    logLine("hub", `excluded ${row.name || "(无名)"}@${row.address || "-"} reason=${reason}`, {
      stage: "C", event: "device-excluded", level: "info",
      detail: `${reason} name=${row.name || ""} address=${row.address || ""}`,
    });
  }
  // 设置页开着的时候列表还在轮询，识别结果要跟着更新
  if (ui.settings.classList.contains("open")) renderDiag();
  const droppedNow = dropped.join("\u0000");
  if (droppedNow !== droppedSig) {
    droppedSig = droppedNow;
    if (dropped.length) log(`配对 ${rows.length} 台，没显示：${dropped.join(" / ")}`);
  }
  state.peers = rows
    .map((peer) => ({ ...peer, brand: brandId(peer) }))
    .filter((peer) => peer.brand && usable.has(peer.brand));
  // 轮询里大部分回包一模一样，内容没变就不重画：重画会把手指底下的方块换掉
  const sig = state.peers
    .map((peer) => [peer.name ?? "", peer.address ?? "", peer.brand ?? "", Boolean(peer.connected)].join("\u0000"))
    .join("\n");
  if (sig === peersSig) return;
  peersSig = sig;
  renderAll();
};


function renderBrand() {
  const list = brandsHere();
  const hubOn = hubReady() && (state.peers ?? []).length > 0;
  ui.brand.hidden = hubOn || list.length < 2 || sessionLive() || state.busy;
  if (ui.brand.hidden) return;
  chips(
    ui.brand,
    list.map((brand) => ({ key: brand.id, label: brand.label })),
    getBrand(),
    (id) => {
      setBrand(id);
      state.link = "idle";
      renderAll();
    },
  );
}

function resetDevice() {
  session?.reset?.();
  session = null;
  ui.editor.hidden = true;
  ui.editor.replaceChildren();
  state = {
    ...state,
    name: "", battery: [], eq: [], cnc: null, modesAll: [], currentMode: null,
    favorites: null, shortcut: null, editing: null, hasTransport: false,
    hasAudioSettings: false, channel15: null, sidetone: null, multipoint: null,
    conversation: null, standby: null, voice: null, captouch: null, autoAnswer: null, autoPlay: null,
    cfg: { cnc: 5, auto: false, spatial: 0, wind: false, anc: true },
    info: { product: "", productName: "", firmware: "", serial: "", mac: "", made: "", hardware: "" },
  };
}

async function connect(peer = null) {
  if (state.busy) return;
  link.dispose();
  resetDevice();
  state.busy = true;
  state.link = "idle";
  state.selected = peer?.address ?? null;
  renderAll();
  const brandId = peer?.brand ?? getBrand();
  const brand = brandById(brandId) ?? brandById("bose");
  if (peer) setBrand(brand.id);
  setPage("device");
  const current = new HeadsetLink(brand.codec());
  link = current;
  const started = performance.now();
  logLine("conn", `attempt-start brand=${brand.id} transport=${brand.transport} address=${peer?.address ?? "-"} services=${(brand.services ?? []).length} channels=${(brand.channels ?? []).join(",")}`,
    { stage: "D", event: "attempt-start", attemptId: peer?.address ?? null });
  const elapsed = () => Math.round(performance.now() - started);
  current.onDisconnected = () => {
    if (link !== current) return;
    state.busy = false;
    resetDevice();
    state.link = "lost";
    setPage("devices");
    refreshPeers();
    renderAll();
  };
  log(`connect ${brand.id} start`);
  try {
    await current.connect({
      acceptAll: false,
      address: peer?.address,
      transport: brand.transport,
      channels: brand.channels ?? [],
      services: brand.services ?? [],
    });
    if (link !== current || !current.active) return;
    log(`connect channel ${elapsed()}ms`);
    if (current.link !== brand.transport) {
      logLine("conn", `transport-switched requested=${brand.transport} actual=${current.link}`, {
        stage: "D", event: "transport-switched", level: "warn", attemptId: peer?.address ?? null,
      });
    }
    const scope = current.scope();
    const refresh = () => {
      if (link !== current || !scope.active) return;
      if (state.link !== "ready" && session?.ready?.()) {
        state.link = "ready";
        state.busy = false;
        log(`connect usable ${elapsed()}ms`);
      }
      renderAll();
    };
    session = brand.create({ link: scope, ui, state, refresh, log: (line) => {
      if (scope.active) log(line);
    } });
    const activeSession = session;
    current.onPacket = (packet) => activeSession.onPacket?.(packet);
    const supported = await activeSession.load();
    if (link !== current || !scope.active) return;
    if (supported) {
      if (state.link !== "ready") log(`connect usable ${elapsed()}ms`);
      state.link = "ready";
      log(`connect initial reads ${elapsed()}ms`);
    } else {
      // 连上了但一条数据都没回来：断开并退回设备中心，别留一个空白设备页
      state.link = "noproto";
      link.disconnect();
      setPage("devices");
    }
  } catch (err) {
    if (link !== current || isCancelled(err)) return;
    // 原始错误码单独留一份：界面用映射后的文案，排查要能看见原话
    logLine("conn", `attempt-failed code=${linkOf(err)} raw=${err.message} elapsed=${Math.round(performance.now() - started)}ms`,
      { stage: "D", event: "attempt-failed", level: "error", attemptId: peer?.address ?? null });
    current.disconnect(err);
    state.link = linkOf(err);
    setPage("devices");
  }
  state.busy = false;
  // 连上或者连失败都刷新一次：卡片状态不能停在连接前的快照上（连着的那台写着「未连接」，
  // 失败弹回时也一样）
  refreshPeers();
  renderAll();
}

function disconnect() {
  logLine("conn", "disconnect by=user", { stage: "H", event: "disconnect" });
  state.link = "idle";
  link.disconnect();
  state.busy = false;
  resetDevice();
  setPage("devices");
  renderAll();
  refreshPeers();
}

// 设备中心不靠手动刷新：启动、回到这一页、窗口重新可见、打开设备下拉时各拉一次，
// 停在这一页期间每 5 秒再轻拉一次。上一条还没回就不发下一条——Android 没给权限时
// 那条会停在系统弹窗上，轮询会把弹窗叠起来；回包内容没变也不重画，免得把手底下的方块换掉。
const PEER_POLL_MS = 5000;
let peerPending = false;

function refreshPeers() {
  if (!hubReady()) return;
  peerPending = true;
  loadPeers();
}

function autoRefreshPeers() {
  if (peerPending) return;
  refreshPeers();
}

function peersOnScreen() {
  return hubReady() && state.page === "devices" && document.visibilityState !== "hidden";
}

setInterval(() => {
  if (peersOnScreen()) autoRefreshPeers();
}, PEER_POLL_MS);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) autoRefreshPeers();
});

window.addEventListener("focus", autoRefreshPeers);

// 顶栏下拉：正在连的那台打勾，选别的直接换过去
const deviceMenu = createMenu({
  trigger: ui.deviceTrigger,
  panel: ui.deviceMenu,
  onOpen: () => {
    renderDeviceMenu();
    refreshPeers();
  },
});

function renderDeviceMenu() {
  const items = [];
  for (const peer of state.peers ?? []) {
    const label = peer.name || peer.address;
    const live = sessionLive() && state.selected === peer.address;
    const meta = [brandById(peer.brand)?.label ?? peer.brand, live || peer.connected ? t("connected") : t("notConnected")]
      .filter(Boolean)
      .join(" · ");
    items.push({
      key: peer.address || label,
      label,
      meta,
      checked: live,
      run: () => {
        if (sessionLive() && state.selected === peer.address) return;
        connect(peer);
      },
    });
  }
  if (!items.length) {
    items.push({
      key: "current",
      label: state.name || link.name || t("notConnected"),
      meta: sessionLive() ? t("connected") : "",
      checked: sessionLive(),
      disabled: true,
    });
  }
  if (sessionLive()) {
    items.push({ key: "disconnect", label: t("disconnect"), separator: true, danger: true, run: disconnect });
  }
  deviceMenu.setItems(items);
}

ui.go.addEventListener("click", () => {
  if (state.busy) return;
  if (sessionLive()) disconnect();
  else connect();
});

ui.back.addEventListener("click", backToDevices);

ui.goList.addEventListener("click", () => connect());

document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  if (ui.settings.classList.contains("open")) closeSettings();
  else if (deviceMenu.isOpen()) deviceMenu.close(true);
  else if (state.page === "device") backToDevices();
});

function openSettings() {
  ui.settings.classList.add("open");
  renderSettings();
}

function closeSettings() {
  ui.settings.classList.remove("open");
}

ui.settingsOpen.addEventListener("click", openSettings);
// 首页也能进设置：连不上时（例如「设备不支持」）用户照样要能看诊断、导日志
ui.settingsOpenHome.addEventListener("click", openSettings);
ui.settingsClose.addEventListener("click", closeSettings);

applyLabels();
window.__boseApp = true;
if (!navigator.bluetooth && !hasNative()) {
  ui.go.disabled = true;
  state.link = "unsupported";
}
for (const line of window.__bootErrors ?? []) logLine("err", `boot ${line}`);
logLine("app", `boot ua=${navigator.userAgent}`);
logLine("app", `platform=${JSON.stringify(platformInfo())}`);
renderAll();
if (hasNative()) {
  if (hubReady()) {
    refreshPeers();
  } else {
    connect();
  }
} else {
  // 浏览器：本机跑着 server.py 就有串口桥，华为这类耳机也能控
  LocalBridge.reachable().then((up) => {
    setBridgeAvailable(up);
    if (up) loadPeers();
    renderAll();
  });
}
