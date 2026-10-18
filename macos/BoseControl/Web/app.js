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
import { HeadsetLink } from "./transport.js";
import { createBoseCodec } from "./bose.js";
import { brandById, brandForName, bridgeAvailable, brandsHere, nativeHub, setBridgeAvailable } from "./brands.js";
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

const link = new HeadsetLink(brandById("bose").codec());
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
  eq: $("eq"),
  spatial: $("spatial"),
  sidetone: $("sidetone"),
  voice: $("voice"),
  behaviour: $("behaviour"),
  lang: $("lang"),
  theme: $("theme"),
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
  brand: $("brand"),
  hub: $("hub"),
  pageDevices: $("page-devices"),
  pageDevice: $("page-device"),
  back: $("back"),
  devicesTitle: $("devices-title"),
  goList: $("go-list"),
  hubRefresh: $("hub-refresh"),
  goListText: $("go-list-text"),
};

const state = {
  peers: [],
  selected: null,
  page: "devices",
  batteryByAddress: {},
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

// 当前这次连接用的是哪个品牌模块；宿主自己不认识任何品牌
let session = null;

function shortVersion(version) {
  return version ? String(version).split("+")[0] : "";
}

function applyLabels() {
  for (const el of document.querySelectorAll("[data-label]")) {
    el.textContent = t(el.dataset.label);
  }
  ui.back.setAttribute("aria-label", t("back"));
  ui.deviceTrigger.setAttribute("aria-label", t("switchDevice"));
  ui.deviceMenu.setAttribute("aria-label", t("switchDevice"));
  ui.hubRefresh.setAttribute("aria-label", t("refresh"));
  ui.hubRefresh.title = t("refresh");
  ui.back.title = t("back");
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

const THEMES = ["classic", "shadcn"];
const THEME_KEY = "bose.theme";

function currentTheme() {
  const fromUrl = new URLSearchParams(location.search).get("theme");
  if (THEMES.includes(fromUrl)) return fromUrl;
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (THEMES.includes(saved)) return saved;
  } catch {
    /* storage 不可用时用默认 */
  }
  return "classic";
}

function setTheme(id) {
  if (!THEMES.includes(id)) return;
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch {
    /* 忽略写入失败 */
  }
  document.documentElement.dataset.theme = id;
}

function applyTheme() {
  const id = currentTheme();
  if (id === "classic") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = id;
  return id;
}

function renderTheme() {
  chips(
    ui.theme,
    [
      { key: "classic", label: t("themeClassic") },
      { key: "shadcn", label: t("themeShadcn") },
    ],
    currentTheme(),
    (id) => {
      setTheme(id);
      renderTheme();
    },
  );
}

function renderLanguage() {
  chips(ui.lang, LANG_NAMES.map((item) => ({ key: item.id, label: item.native })), getLang(), (id) => {
    setLang(id);
    applyLabels();
    renderAll();
  });
}

function renderSettings() {
  renderLanguage();
  renderTheme();
  session?.renderSettings?.();
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
  rows.push([t("lastError"), link.lastError || "—"]);
  if (env && env.bonded >= 0) rows.push([t("devices"), String(env.bonded)]);
  fillRows(ui.diag, rows);
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
  try {
    nativeCall("listDevices");
  } catch {
    /* 没有设备中心就停在原地 */
  }
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
  const on = link.connected;
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
  ui.hint.textContent = on ? "" : hint;
  if (!on) {
    deviceMenu.close(false);
    ui.status.textContent = "";
    ui.meta.textContent = "";
    return;
  }
  ui.status.textContent = state.name || link.name || "";
  ui.meta.textContent = batteryText(state.battery);
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
      /* 老版本桥没有这个方法 */
    }
    return;
  }
  if (!bridgeAvailable()) return;
  onDeviceList(JSON.stringify(await LocalBridge.list()));
}

function peerBattery(peer) {
  return state.batteryByAddress[peer.address] ?? "";
}

function renderHub() {
  const list = state.peers ?? [];
  ui.hub.hidden = !hubReady() || list.length === 0;
  if (ui.hub.hidden) return;
  ui.hub.innerHTML = "";

  for (const peer of list) {
    peer.brand = peer.brand ?? brandForName(peer.name)?.id ?? "bose";
    const card = document.createElement("button");
    card.type = "button";
    card.className = "peer-card";

    const name = document.createElement("span");
    name.className = "peer-name";
    name.textContent = peer.name || peer.address;

    const meta = document.createElement("b");
    const parts = [peer.connected ? t("connected") : t("notConnected"), peerBattery(peer)].filter(Boolean);
    meta.textContent = parts.join(" · ");

    const tag = document.createElement("i");
    tag.textContent = brandById(peer.brand)?.label ?? peer.brand;

    if (state.selected === peer.address && link.connected) card.classList.add("active");

    card.append(name, tag, meta);
    card.addEventListener("click", () => {
      if (state.selected === peer.address && link.connected) {
        setPage("device");
        return;
      }
      connect(peer);
    });
    ui.hub.appendChild(card);
  }


}

window.onDeviceList = (json) => {
  let rows = [];
  try {
    rows = JSON.parse(json);
  } catch {
    rows = [];
  }
  // 原生端只负责把配对设备全给出来，认品牌是这边的事；认不出的（键盘、鼠标、手机）直接丢掉
  state.peers = rows
    .map((peer) => ({ ...peer, brand: brandForName(peer.name)?.id }))
    .filter((peer) => peer.brand);
  renderAll();
};


function renderBrand() {
  const list = brandsHere();
  const hubOn = hubReady() && (state.peers ?? []).length > 0;
  ui.brand.hidden = hubOn || list.length < 2 || link.connected || state.busy;
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
  state.name = "";
  state.battery = [];
  state.eq = [];
  state.cnc = null;
  state.modesAll = [];
  state.favorites = null;
  state.shortcut = null;
  state.devices = [];
  state.hasTransport = false;
  state.info = { product: "", productName: "", firmware: "", serial: "", mac: "", made: "", hardware: "" };
}

async function connect(peer = null) {
  if (state.busy) return;
  state.busy = true;
  state.link = "idle";
  state.selected = peer?.address ?? null;
  resetDevice();
  renderAll();
  const brandId = peer?.brand ?? getBrand();
  const brand = brandById(brandId) ?? brandById("bose");
  if (peer) setBrand(brand.id);
  setPage("device");
  link.use(brand.codec());
  session = brand.create({ link, ui, state, refresh: () => renderAll(), log });
  link.onPacket = (packet) => session?.onPacket?.(packet);
  try {
    await link.connect({
      acceptAll: false,
      address: peer?.address,
      transport: brand.transport,
      channels: brand.channels ?? [],
      services: brand.services ?? [],
    });
    ui.status.textContent = link.name || "";
    if (await session.load()) {
      state.link = "ready";
    } else {
      // 连上了但一条数据都没回来：断开并退回设备中心，别留一个空白设备页
      state.link = "noproto";
      link.disconnect();
      setPage("devices");
    }
  } catch (err) {
    log(err.message);
    state.link = linkOf(err);
  }
  state.busy = false;
  if (link.connected && state.selected) {
    state.batteryByAddress[state.selected] = batteryText(state.battery);
  }
  renderAll();
}

function disconnect() {
  state.link = "idle";
  link.disconnect();
  setPage("devices");
  renderAll();
  refreshPeers();
}

function refreshPeers() {
  loadPeers();
}

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
    const meta = [
      brandById(peer.brand)?.label ?? peer.brand,
      peer.connected ? t("connected") : t("notConnected"),
      peerBattery(peer),
    ]
      .filter(Boolean)
      .join(" · ");
    items.push({
      key: peer.address || label,
      label,
      meta,
      checked: link.connected && state.selected === peer.address,
      run: () => {
        if (link.connected && state.selected === peer.address) return;
        connect(peer);
      },
    });
  }
  if (!items.length) {
    items.push({
      key: "current",
      label: state.name || link.name || t("notConnected"),
      meta: [batteryText(state.battery), link.connected ? t("connected") : ""].filter(Boolean).join(" · "),
      checked: link.connected,
      disabled: true,
    });
  }
  if (hubReady() && (state.peers ?? []).length) {
    items.push({ key: "refresh", label: t("refresh"), separator: true, run: refreshPeers });
  }
  if (link.connected) {
    items.push({ key: "disconnect", label: t("disconnect"), danger: true, run: disconnect });
  }
  deviceMenu.setItems(items);
}

ui.go.addEventListener("click", () => {
  if (state.busy) return;
  if (link.connected) disconnect();
  else connect();
});

ui.back.addEventListener("click", backToDevices);

ui.hubRefresh.addEventListener("click", refreshPeers);

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
ui.settingsClose.addEventListener("click", closeSettings);

link.onDisconnected = () => {
  state.busy = false;
  resetDevice();
  if (state.link === "ready") state.link = "lost";
  setPage("devices");
  renderAll();
};

applyTheme();
applyLabels();
window.__boseApp = true;
if (!navigator.bluetooth && !hasNative()) {
  ui.go.disabled = true;
  state.link = "unsupported";
}
renderAll();
if (hasNative()) {
  if (hubReady()) {
    nativeCall("listDevices");
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
