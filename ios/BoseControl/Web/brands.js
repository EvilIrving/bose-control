import { boseBrand } from "./bose.js";
import { unverifiedOn } from "./experimental.js";
import { huaweiBrand } from "./huawei.js";
import { oppoBrand } from "./oppo.js";
import { vivoBrand } from "./vivo.js";

// 加一个品牌 = 新建一个模块导出 brand 描述符，再在这个数组里加一行。
//   { id, label, transport: "ble" | "spp", alt?, channels?, services?,
//     matches(name), codec(), create({ link, ui, state, refresh, log }) }
// create() 返回的东西宿主只认四个入口：load() / render() / renderSettings() / onPacket()。
// alt 是备用通道：主通道这台机器上没有时才会用到（vivo 的 BLE GATT 只在浏览器里能走通）。
const registry = [boseBrand, huaweiBrand, oppoBrand, vivoBrand];

// vivo / OPPO 的命令表来自第三方逆向、没在真机上跑过，默认不出现在任何地方，
// 要在设置里（或 ?unverified=1）自己打开。见 experimental.js。
export function brandEnabled(brand) {
  return unverifiedOn() || !["vivo", "oppo"].includes(brand.id);
}

export function brandList() {
  return registry;
}

export function brandById(id) {
  return registry.find((brand) => brand.id === id) ?? null;
}

export function brandForName(name) {
  return registry.find((brand) => brandEnabled(brand) && brand.matches(name)) ?? null;
}

// 原生端声明自己能连哪些传输方式；浏览器里 ble 走 Web Bluetooth，spp 走本机 server.py 的串口桥。
// 原生端用 platform() 报能力：Android 的 JS 接口只有方法，读不到属性，所以统一走这一条。
export function platformInfo() {
  try {
    const fn = globalThis.NativeBLE?.platform;
    if (typeof fn === "function") return JSON.parse(fn() || "{}");
  } catch {
    /* 老桥没有 platform() */
  }
  const list = globalThis.NativeBLE?.transports;
  if (Array.isArray(list)) return { transports: list, hub: globalThis.NativeBLE?.hub === true };
  return {};
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
// 所以 alt 只在「没有原生桥、但浏览器有 Web Bluetooth」时算可用，免得在 iPhone 上露出一条连不上的路。
function canUse(brand, transport, native, webBle) {
  if (transport !== brand.transport) return transport === "ble" && webBle && native.length === 0;
  if (!native.length) return (transport === "ble" && webBle) || (transport === "spp" && bridgeUp);
  return native.includes(transport) || (transport === "ble" && webBle) || (transport === "spp" && bridgeUp);
}

function transportsOf(brand) {
  return [brand.transport, brand.alt].filter(Boolean);
}

export function brandsHere() {
  const native = nativeTransports();
  const webBle = Boolean(globalThis.navigator?.bluetooth);
  return registry
    .filter(brandEnabled)
    .filter((brand) => transportsOf(brand).some((transport) => canUse(brand, transport, native, webBle)));
}

// 这台机器上这个品牌该用哪条通道连：主通道能用就用主通道，不能再退到 alt。
export function transportFor(brand) {
  const native = nativeTransports();
  const webBle = Boolean(globalThis.navigator?.bluetooth);
  return transportsOf(brand).find((transport) => canUse(brand, transport, native, webBle)) ?? brand.transport;
}
