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

// 原生端声明自己能连哪些传输方式；浏览器只有 Web Bluetooth。
export function nativeTransports() {
  const list = globalThis.NativeBLE?.transports;
  return Array.isArray(list) ? list : [];
}

export function brandsHere() {
  const native = nativeTransports();
  if (!native.length) return registry.filter((brand) => brand.transport === "ble" && globalThis.navigator?.bluetooth);
  return registry.filter((brand) => native.includes(brand.transport) || (brand.transport === "ble" && globalThis.navigator?.bluetooth));
}
