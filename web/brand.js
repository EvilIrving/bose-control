export const BRANDS = {
  bose: { id: "bose", label: "Bose" },
  huawei: { id: "huawei", label: "华为 HUAWEI" },
};

const STORAGE_KEY = "headset.brand";

// 原生端用 window.NativeBLE.brands 声明自己认哪个品牌；浏览器里只有 Bose 的 Web Bluetooth。
function nativeBrands() {
  const list = globalThis.NativeBLE?.brands;
  return Array.isArray(list) ? list : [];
}

// 原生端在启动脚本里塞进来的上次选择；浏览器和 iOS/Android 端没有这个变量
function nativeBrand() {
  const value = globalThis.NativeBrand;
  return typeof value === "string" ? value : "";
}

export function brandsHere() {
  return [...new Set(["bose", ...nativeBrands()])].filter((id) => BRANDS[id]);
}

export function getBrand() {
  let saved = "";
  try {
    saved = localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    /* storage 不可用时按默认品牌 */
  }
  return [nativeBrand(), saved].find((id) => brandsHere().includes(id)) ?? "bose";
}

export function setBrand(id) {
  if (!brandsHere().includes(id)) return;
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
