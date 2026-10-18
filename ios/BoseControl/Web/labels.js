// 官方 Bose App 的中英文案，全部取自 APK 的 res/values 与 res/values-zh-rCN。
// 左侧 key 与 index.html 里的 data-label / 代码里的 label key 一致。
export const LABELS = {
  device: { zh: "技术信息", en: "Technical Info" },
  modes: { zh: "模式", en: "Modes" },
  cnc: { zh: "消噪", en: "Noise Cancellation" },
  eq: { zh: "EQ", en: "EQ" },
  spatial: { zh: "沉浸式音频", en: "Immersive Audio" },
  sidetone: { zh: "自助语音", en: "Self Voice" },
  voice: { zh: "语音提示", en: "Voice Prompts" },
  others: { zh: "其它", en: "Other" },
  standby: { zh: "自动关机", en: "Auto-Off" },

  wind: { zh: "风噪滤除", en: "Wind Block" },
  multipoint: { zh: "多点连接", en: "Multipoint" },
  conversation: { zh: "对话模式", en: "Conversation Mode" },
  touch: { zh: "触控控制", en: "Touch Control" },
  autoAnswer: { zh: "自动接听电话", en: "Auto-Answer Calls" },
  autoPlay: { zh: "自动播放/暂停", en: "Auto Play/Pause" },

  connect: { zh: "连接", en: "Connect" },
  disconnect: { zh: "断开连接", en: "Disconnect" },

  fw: { zh: "固件版本", en: "Firmware Version" },
  serial: { zh: "序列号", en: "Serial Number" },
  productName: { zh: "产品名称", en: "Product Name" },
  product: { zh: "产品变型", en: "Product Variant" },
  mac: { zh: "蓝牙 MAC 地址", en: "Bluetooth MAC Address" },
  made: { zh: "生产日期", en: "Date of Manufacture" },
  hardware: { zh: "硬件版本", en: "Hardware Revision" },
  originalName: { zh: "原始名称", en: "Original Name" },
};

export const SPATIAL_OPTIONS = [
  { zh: "关闭", en: "Off" },
  { zh: "静态", en: "Still" },
  { zh: "运动", en: "Motion" },
];

export const SELF_VOICE_OPTIONS = [
  { zh: "关闭", en: "Off" },
  { zh: "高", en: "High" },
  { zh: "中", en: "Medium" },
  { zh: "低", en: "Low" },
];

export const STANDBY_OPTIONS = [
  { minutes: 5, zh: "5 分钟", en: "5 Minutes" },
  { minutes: 10, zh: "10 分钟", en: "10 Minutes" },
  { minutes: 20, zh: "20 分钟", en: "20 Minutes" },
  { minutes: 40, zh: "40 分钟", en: "40 Minutes" },
  { minutes: 60, zh: "1 小时", en: "1 Hour" },
  { minutes: 180, zh: "3 小时", en: "3 Hours" },
  { minutes: 1440, zh: "24 小时", en: "24 Hours" },
  { minutes: 0, zh: "从不", en: "Never" },
];

export const LANG = "zh";

export function t(key) {
  return LABELS[key]?.[LANG] ?? key;
}

export function pick(option) {
  return option[LANG];
}
