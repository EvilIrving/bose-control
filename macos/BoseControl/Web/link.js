export const LINK_TEXT = {
  idle: "请先连接耳机",
  busy: "正在找耳机",
  off: "需要先开启蓝牙",
  denied: "需要蓝牙权限",
  unsupported: "这边连不了蓝牙",
  notfound: "没找到耳机，再试一次",
  refused: "耳机被别的设备连着",
  noproto: "设备不支持",
  failed: "没连上，再试一次",
  lost: "请重新连接",
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
  return LINK_TEXT[link] ?? LINK_TEXT.failed;
}

function batteryLabel(component, three) {
  if (three) return component === 1 ? "盒" : component === 0 ? "左" : "右";
  return component === 0 ? "左" : component === 1 ? "右" : "电";
}

export function batteryText(rows) {
  if (!rows?.length) return "";
  if (rows.length === 1) return `${rows[0].level}%`;
  const three = rows.length >= 3;
  return rows.map((row) => `${batteryLabel(row.component, three)} ${row.level}%`).join(" ");
}
