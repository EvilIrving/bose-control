import { getLang } from "./labels.js";

export const LINK_TEXT = {
  idle: { zh: "请先连接耳机", en: "Connect headphones first" },
  busy: { zh: "正在搜索耳机", en: "Searching for headphones" },
  off: { zh: "请开启蓝牙", en: "Turn on Bluetooth" },
  denied: { zh: "需要蓝牙权限", en: "Bluetooth permission required" },
  unsupported: { zh: "不支持蓝牙", en: "Bluetooth unsupported" },
  notfound: { zh: "未找到耳机，请重试", en: "Headphones not found, retry" },
  refused: { zh: "耳机已被占用", en: "In use by another device" },
  noproto: { zh: "设备不支持", en: "Device not supported" },
  failed: { zh: "连接失败，请重试", en: "Connection failed, retry" },
  lost: { zh: "连接已断开，请重连", en: "Please reconnect" },
  location: { zh: "请开启定位服务", en: "Enable location services" },
};

const LINK_BY_CODE = {
  none: "notfound",
  NotFoundError: "notfound",
  off: "off",
  bluetooth: "off",
  adapter: "off",
  permission: "denied",
  denied: "denied",
  NotAllowedError: "denied",
  SecurityError: "denied",
  unsupported: "unsupported",
  "no native bridge": "unsupported",
  service: "noproto",
  char: "noproto",
  notify: "noproto",
  refused: "refused",
  scan: "failed",
  location: "location",
  dropped: "refused",
  connect: "failed",
  write: "failed",
  spp: "failed",
  timeout: "failed",
  resetting: "failed",
  unknown: "failed",
  NetworkError: "failed",
};

export function linkOf(err) {
  const raw = String(err?.message ?? err ?? "").trim();
  const known = LINK_BY_CODE[raw] || LINK_BY_CODE[err?.name];
  if (known) return known;
  if (/Web Bluetooth/i.test(raw)) return "unsupported";
  if (/没找到|找不到|no device/i.test(raw)) return "notfound";
  if (/权限/.test(raw)) return "denied";
  if (/(关闭|没开|未开|打开蓝牙)/.test(raw)) return "off";
  if (/(控制服务|控制通道|订阅|不支持控制)/.test(raw)) return "noproto";
  return "failed";
}

export function linkText(link) {
  const item = LINK_TEXT[link] ?? LINK_TEXT.failed;
  return item[getLang()] ?? item.zh;
}

// 顶栏那一小串电量：一条读数就只写百分比，多段才带 L / R / C
function batteryLabel(component, three) {
  const zh = getLang() === "zh";
  if (three) return component === 1 ? (zh ? "盒" : "Case") : component === 0 ? (zh ? "左" : "L") : zh ? "右" : "R";
  return component === 0 ? (zh ? "左" : "L") : component === 1 ? (zh ? "右" : "R") : zh ? "电" : "Battery";
}

export function batteryText(rows) {
  if (!rows?.length) return "";
  if (rows.length === 1) return `${rows[0].level}%`;
  const three = rows.length >= 3;
  return rows.map((row) => `${batteryLabel(row.component, three)} ${row.level}%`).join(" · ");
}
