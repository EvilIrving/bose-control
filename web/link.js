import { getLang, pick } from "./labels.js";

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
// 电量前面那个组件名。组件号是耳机自己报的固定编号，不是回包里的位置：
// QC Ultra 2 Earbuds 实测 0x01 右、0x02 左、0x03 盒；单电池机型只有 0x00。
// 以前把 1 当成「盒」、把 0 当成「左」，三段电量"左 96% · 右 100% · 盒 59%"
// 实际显示的是错位的值。
const COMPONENT_LABEL = {
  0: { zh: "电量", en: "Battery" },
  1: { zh: "右", en: "R" },
  2: { zh: "左", en: "L" },
  3: { zh: "盒", en: "Case" },
  4: { zh: "左右", en: "Buds" },
};

function batteryLabel(component) {
  const label = COMPONENT_LABEL[component];
  if (!label) return getLang() === "zh" ? "电量" : "Battery";
  return pick(label);
}

// 多段读数按组件号排序：右、左、盒。耳机报的顺序不保证稳定，
// 同一台设备两次读回来的顺序不一样会让界面上的数字跳位置。
const COMPONENT_ORDER = [1, 2, 3, 4, 0];

export function batteryText(rows) {
  if (!rows?.length) return "";
  if (rows.length === 1) return `${rows[0].level}%`;
  const sorted = [...rows].sort(
    (a, b) => COMPONENT_ORDER.indexOf(a.component) - COMPONENT_ORDER.indexOf(b.component),
  );
  // 0x04 是左右合并读数，只有左右单读数缺失时才有意义；两者都在就不重复报
  const withoutAggregate = sorted.some((row) => row.component === 1 || row.component === 2)
    ? sorted.filter((row) => row.component !== 4)
    : sorted;
  return withoutAggregate.map((row) => `${batteryLabel(row.component)} ${row.level}%`).join(" · ");
}
