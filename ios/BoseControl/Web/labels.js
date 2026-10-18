// 官方 Bose App 的中英文案，全部取自 APK 的 res/values 与 res/values-zh-rCN。
// 左侧 key 与 index.html 里的 data-label / 代码里的 label key 一致。
export const LANGS = ["zh", "en"];

export const LANG_NAMES = [
  { id: "zh", native: "中文" },
  { id: "en", native: "English" },
];

const STORAGE_KEY = "bose.lang";

function detect() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (LANGS.includes(saved)) return saved;
  } catch {
    /* storage 不可用时按系统语言 */
  }
  const nav = String(navigator.language || "").toLowerCase();
  return nav.startsWith("zh") ? "zh" : "en";
}

let lang = detect();

export function getLang() {
  return lang;
}

export function setLang(next) {
  if (!LANGS.includes(next)) return;
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* 忽略写入失败 */
  }
}

export const LABELS = {
  settings: { zh: "设置", en: "Settings" },
  done: { zh: "完成", en: "Done" },
  language: { zh: "语言", en: "Language" },

  device: { zh: "技术信息", en: "Technical Info" },
  modes: { zh: "模式", en: "Modes" },
  cnc: { zh: "消噪", en: "Noise Cancellation" },
  eq: { zh: "EQ", en: "EQ" },
  spatial: { zh: "沉浸式音频", en: "Immersive Audio" },
  sidetone: { zh: "自助语音", en: "Self Voice" },
  voice: { zh: "语音提示", en: "Voice Prompts" },
  others: { zh: "其它", en: "Other" },
  standby: { zh: "自动关机", en: "Auto-Off" },
  playback: { zh: "播放控制", en: "Playback" },

  name: { zh: "耳机名称", en: "Headset Name" },
  shortcut: { zh: "快捷动作", en: "Shortcut" },
  favorites: { zh: "机身模式循环", en: "Headset Mode Cycle" },
  devices: { zh: "已配对设备", en: "Paired Devices" },
  headset: { zh: "耳机操作", en: "Headset Actions" },

  diag: { zh: "诊断", en: "Diagnostics" },
  bridge: { zh: "原生桥", en: "Native bridge" },
  btState: { zh: "蓝牙", en: "Bluetooth" },
  btOn: { zh: "已开启", en: "On" },
  btOff: { zh: "已关闭", en: "Off" },
  btNone: { zh: "不可用", en: "Unavailable" },
  lastError: { zh: "上次错误", en: "Last error" },

  create: { zh: "新建模式", en: "New Mode" },
  edit: { zh: "编辑模式", en: "Edit Mode" },
  modeName: { zh: "名称", en: "Name" },
  autoCnc: { zh: "自动消噪", en: "Auto Noise Cancellation" },
  cycle: { zh: "机身可切换", en: "On Headset" },
  save: { zh: "保存", en: "Save" },
  cancel: { zh: "取消", en: "Cancel" },
  remove: { zh: "删除", en: "Delete" },

  prev: { zh: "上一曲", en: "Previous" },
  play: { zh: "播放", en: "Play" },
  pause: { zh: "暂停", en: "Pause" },
  next: { zh: "下一曲", en: "Next" },

  pair: { zh: "进入配对", en: "Pairing Mode" },
  powerOff: { zh: "关机", en: "Power Off" },
  again: { zh: "再点一次", en: "Tap Again" },
  connected: { zh: "已连接", en: "Connected" },
  press: { zh: "按键", en: "Button" },

  wind: { zh: "风噪滤除", en: "Wind Block" },
  multipoint: { zh: "多点连接", en: "Multipoint" },
  conversation: { zh: "对话模式", en: "Conversation Mode" },
  touch: { zh: "触控控制", en: "Touch Control" },
  autoAnswer: { zh: "自动接听电话", en: "Auto-Answer Calls" },
  autoPlay: { zh: "自动播放/暂停", en: "Auto Play/Pause" },

  connect: { zh: "连接", en: "Connect" },
  disconnect: { zh: "断开连接", en: "Disconnect" },

  productName: { zh: "产品名称", en: "Product Name" },
  product: { zh: "产品变型", en: "Product Variant" },
  fw: { zh: "固件版本", en: "Firmware Version" },
  serial: { zh: "序列号", en: "Serial Number" },
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

// 语言名来自 VoicePromptLanguage 枚举；官方没有本地化表，中文名按枚举直译。
export const VOICE_LANGUAGES = {
  0: { zh: "英语（英）", en: "English (UK)" },
  1: { zh: "英语（美）", en: "English (US)" },
  2: { zh: "法语", en: "French" },
  3: { zh: "意大利语", en: "Italian" },
  4: { zh: "德语", en: "German" },
  5: { zh: "西班牙语（欧）", en: "Spanish (EU)" },
  6: { zh: "西班牙语（墨）", en: "Spanish (MX)" },
  7: { zh: "葡萄牙语（巴西）", en: "Portuguese (BR)" },
  8: { zh: "中文", en: "Chinese" },
  9: { zh: "韩语", en: "Korean" },
  10: { zh: "俄语", en: "Russian" },
  11: { zh: "波兰语", en: "Polish" },
  12: { zh: "希伯来语", en: "Hebrew" },
  13: { zh: "土耳其语", en: "Turkish" },
  14: { zh: "荷兰语", en: "Dutch" },
  15: { zh: "日语", en: "Japanese" },
  16: { zh: "粤语", en: "Cantonese" },
  17: { zh: "阿拉伯语", en: "Arabic" },
  18: { zh: "瑞典语", en: "Swedish" },
  19: { zh: "丹麦语", en: "Danish" },
  20: { zh: "挪威语", en: "Norwegian" },
  21: { zh: "芬兰语", en: "Finnish" },
  22: { zh: "印地语", en: "Hindi" },
};

// 官方名称：equalizer_bass_value / equalizer_mid_value / equalizer_treble_value
// 以及 low_mid / high_mid 两个扩展频段。
export const EQ_BANDS = {
  0: { zh: "低音", en: "Bass" },
  1: { zh: "中音", en: "Mid" },
  2: { zh: "高音", en: "Treble" },
  3: { zh: "低中频", en: "Low-Mid" },
  4: { zh: "中高频", en: "High-Mid" },
};

export function eqBandName(id) {
  return EQ_BANDS[id]?.[lang] ?? String(id);
}

export function t(key) {
  return LABELS[key]?.[lang] ?? key;
}

// ActionButtonMode：官方枚举。22/23/24/25/26 在 App 里没有面向用户的含义，按 id 显示。
const ACTIONS = {
  0: { zh: "未设置", en: "Not Set" },
  1: { zh: "语音助手", en: "Voice Assistant" },
  2: { zh: "消噪", en: "Noise Cancellation" },
  3: { zh: "电量播报", en: "Battery Level" },
  4: { zh: "播放/暂停", en: "Play/Pause" },
  5: { zh: "提高消噪", en: "More Cancellation" },
  6: { zh: "降低消噪", en: "Less Cancellation" },
  7: { zh: "唤醒词", en: "Wake Word" },
  8: { zh: "切换设备", en: "Switch Device" },
  9: { zh: "对话模式", en: "Conversation Mode" },
  10: { zh: "下一曲", en: "Next Track" },
  11: { zh: "上一曲", en: "Previous Track" },
  12: { zh: "读取通知", en: "Read Notifications" },
  13: { zh: "风噪模式", en: "Wind Mode" },
  14: { zh: "无动作", en: "No Action" },
  15: { zh: "客户端交互", en: "Client Interaction" },
  16: { zh: "Spotify", en: "Spotify" },
  17: { zh: "模式轮播", en: "Mode Carousel" },
  18: { zh: "音量预设", en: "Volume Preset" },
  19: { zh: "沉浸式音频", en: "Immersive Audio" },
  20: { zh: "线路输入", en: "Line In" },
  21: { zh: "设备联动", en: "Linking" },
  27: { zh: "Alexa", en: "Alexa" },
};

export function actionName(id) {
  return ACTIONS[id]?.[lang] ?? `${t("press")} ${id}`;
}

const PRESSES = {
  3: { zh: "短按", en: "Short Press" },
  4: { zh: "单击", en: "Single Press" },
  6: { zh: "双击", en: "Double Press" },
  8: { zh: "三击", en: "Triple Press" },
  9: { zh: "长按", en: "Long Press" },
  10: { zh: "超长按", en: "Very Long Press" },
};

export function pressName(eventType) {
  return PRESSES[eventType]?.[lang] ?? `${t("press")} ${eventType}`;
}

export function pick(option) {
  return option?.[lang] ?? "";
}

export function voiceLanguageName(id) {
  return VOICE_LANGUAGES[id]?.[lang] ?? String(id);
}
