import { boseBrand } from "./bose.js";
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

export function brandsHere() {
  const native = nativeTransports();
  const webBle = Boolean(globalThis.navigator?.bluetooth);
  if (!native.length) {
    return registry.filter(
      (brand) => (brand.transport === "ble" && webBle) || (brand.transport === "spp" && bridgeUp),
    );
  }
  return registry.filter(
    (brand) => native.includes(brand.transport) || (brand.transport === "ble" && webBle) || (brand.transport === "spp" && bridgeUp),
  );
}
