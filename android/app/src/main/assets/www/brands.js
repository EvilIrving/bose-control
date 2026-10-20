import { boseBrand } from "./bose.js";
import { logLine } from "./log.js";
import { huaweiBrand } from "./huawei.js";

// 加一个品牌 = 新建一个模块导出 brand 描述符，再在这个数组里加一行。
//   { id, label, transport: "ble" | "spp", channels?, services?,
//     matches(name), codec(), create({ link, ui, state, refresh, log }) }
// create() 返回的东西宿主只认四个入口：load() / render() / renderSettings() / onPacket()。
const registry = [boseBrand, huaweiBrand];

export function brandList() {
  return registry;
}

export function brandById(id) {
  return registry.find((brand) => brand.id === id) ?? null;
}

export function brandForName(name) {
  return registry.find((brand) => brand.matches(name)) ?? null;
}

// 原生端声明自己能连哪些传输方式；浏览器里 ble 走 Web Bluetooth，spp 走本机 server.py 的串口桥。
// 原生端用 platform() 报能力：Android 的 JS 接口只有方法，读不到属性，所以统一走这一条。
// 真机事故：Android 上 platform() 没给回平台能力，页面就认定「这台机器没有设备中心」，
// 于是连 listDevices 都不调，首页永远看不到华为。所以这里 platform() 不可用时按桥实际
// 暴露的方法兜底判断，并把探测过程写进诊断。
export function platformInfo() {
  const api = globalThis.NativeBLE;
  let reported = null;
  try {
    if (typeof api?.platform === "function") {
      const raw = api.platform();
      const parsed = JSON.parse(raw || "{}");
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) return parsed;
      report(`platform() 返回空：${String(raw).slice(0, 120)}`);
    } else if (api) {
      report("桥上没有 platform()");
    }
  } catch (err) {
    report(`platform() 抛错：${err?.message ?? err}`);
  }
  // 兜底：按桥暴露的方法判断能力
  const transports = [];
  if (typeof api?.bleConnect === "function" || typeof api?.bleScan === "function") transports.push("ble");
  if (typeof api?.sendData === "function") transports.push("spp");
  const hub = typeof api?.listDevices === "function";
  if (transports.length || hub) {
    report(`按桥方法兜底：transports=${transports.join(",") || "-"} hub=${hub}`, "warn");
    return { platform: "bridge-probe", transports, hub };
  }
  const list = api?.transports;
  if (Array.isArray(list)) return { transports: list, hub: api?.hub === true };
  if (api) report("桥上看不到任何可用方法");
  return {};
}

let platformReported = "";
function report(detail, level = "info") {
  if (detail === platformReported) return; // 轮询里不重复刷
  platformReported = detail;
  logLine("nat", detail, { stage: "B", event: "platform-probe", level });
}

export function nativeTransports() {
  const list = platformInfo().transports;
  return Array.isArray(list) ? list : [];
}

export function nativeHub() {
  return platformInfo().hub === true;
}

// 本机串口桥可用时，浏览器也能控制走 SPP 的耳机
let bridgeUp = false;

export function setBridgeAvailable(on) {
  bridgeUp = on;
}

export function bridgeAvailable() {
  return bridgeUp;
}

// 原生端的 BLE 通道是为 Bose 的 FEBE 服务写死的，别的品牌想在 GATT 上说话只能走浏览器的 Web Bluetooth。
// 所以原生桥没有这条通道、但浏览器有 Web Bluetooth 时也算可用，免得在 iPhone 上露出一条连不上的路。
function canUse(brand, native, webBle) {
  const transport = brand.transport;
  return (
    native.includes(transport) ||
    (transport === "ble" && webBle) ||
    (transport === "spp" && bridgeUp)
  );
}

// 这台宿主走不通的路。导出诊断要写明，不然看日志的人会当成 bug。
// iOS 没有 platform()，只能看桥暴露了哪些入口：有 bleScan 就说明 BLE 可用。
export function missingCapabilities() {
  const caps = platformInfo();
  const transports = Array.isArray(caps.transports) ? caps.transports : [];
  const isIOS = typeof globalThis.webkit?.messageHandlers?.bleScan !== "undefined";
  const hasBle = transports.includes("ble") || isIOS || Boolean(globalThis.navigator?.bluetooth);
  // 浏览器 + 本机 server.py 的串口桥也能走 SPP；hub 说的是设备中心，不是 SPP
  const hasSpp = transports.includes("spp") || bridgeUp;
  const hasHub = caps.hub === true || bridgeUp;
  const list = [];
  // 只有 iOS 是系统层面不给第三方 SPP，原因写出来；别的平台没这条通道就直说
  if (!hasSpp) list.push(isIOS ? "SPP（iOS 不开放给第三方）" : "SPP");
  if (!hasBle) list.push("BLE");
  if (!hasHub) list.push("设备中心（枚举不到系统配对设备）");
  return list;
}

export function brandsHere() {
  const native = nativeTransports();
  const webBle = Boolean(globalThis.navigator?.bluetooth);
  return registry.filter((brand) => canUse(brand, native, webBle));
}
