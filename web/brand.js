import { brandById, brandsHere } from "./brands.js";

const STORAGE_KEY = "headset.brand";

// 运行时选中的品牌。原生注入的 NativeBrand 只是启动时的快照，
// 从设备中心点了另一台耳机之后它不会跟着变，所以这里要单独记。
let current = "";

// 原生端在启动脚本里塞进来的上次选择；浏览器和 iOS/Android 端没有这个变量
function nativeBrand() {
  const value = globalThis.NativeBrand;
  return typeof value === "string" ? value : "";
}

export function getBrand() {
  let saved = "";
  try {
    saved = localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    /* storage 不可用时按默认品牌 */
  }
  const here = brandsHere().map((brand) => brand.id);
  return [current, nativeBrand(), saved].find((id) => here.includes(id)) ?? here[0] ?? "bose";
}

export function setBrand(id) {
  if (!brandById(id)) return;
  current = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* 忽略写入失败 */
  }
  try {
    globalThis.NativeBLE?.setBrand?.(id);
  } catch {
    /* 老版本桥没有这个方法 */
  }
}
