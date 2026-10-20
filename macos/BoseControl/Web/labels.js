// 官方 Bose App 的中英文案，全部取自 APK 的 res/values 与 res/values-zh-rCN。
// 左侧 key 与 index.html 里的 data-label / 代码里的 label key 一致。
export const LANGS = ["zh", "en"];

export const LANG_NAMES = [
  { id: "zh", native: "中文" },
  { id: "en", native: "English" },
];

const STORAGE_KEY = "bose.lang";

function detect() {
  if (typeof location !== "undefined") {
    const fromUrl = new URLSearchParams(location.search).get("lang");
    if (LANGS.includes(fromUrl)) return fromUrl;
  }
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
  deviceInfo: { zh: "设备信息", en: "Device Info" },
  switchDevice: { zh: "切换设备", en: "Switch Device" },
  headset: { zh: "耳机操作", en: "Headset Actions" },

  diag: { zh: "诊断", en: "Diagnostics" },
  bridge: { zh: "原生桥", en: "Native bridge" },
  btState: { zh: "蓝牙", en: "Bluetooth" },
  btOn: { zh: "已开启", en: "On" },
  btOff: { zh: "已关闭", en: "Off" },
  btNone: { zh: "不可用", en: "Unavailable" },
  btUnknown: { zh: "未知", en: "Unknown" },
  lastError: { zh: "上次错误", en: "Last error" },
  exportDiag: { zh: "导出诊断", en: "Export diagnostics" },
  exportSaved: { zh: "已导出：{path}（{bytes}B）", en: "Saved: {path} ({bytes}B)" },
  exportShareFailed: { zh: "已保存但分享失败：{path}（{error}）", en: "Saved but share failed: {path} ({error})" },
  exportFailed: { zh: "导出失败：{error}", en: "Export failed: {error}" },
  exportCanceled: { zh: "已保存，未分享：{path}", en: "Saved, not shared: {path}" },
  exportUnparsed: { zh: "导出结果解析失败", en: "Could not read export result" },
  location: { zh: "定位", en: "Location" },

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
  model: { zh: "型号", en: "Model" },
  fw: { zh: "固件版本", en: "Firmware Version" },
  serial: { zh: "序列号", en: "Serial Number" },
  mac: { zh: "蓝牙 MAC 地址", en: "Bluetooth MAC Address" },
  made: { zh: "生产日期", en: "Date of Manufacture" },
  hardware: { zh: "硬件版本", en: "Hardware Revision" },
  originalName: { zh: "原始名称", en: "Original Name" },
  leftSerial: { zh: "左耳序列号", en: "Left Serial" },
  rightSerial: { zh: "右耳序列号", en: "Right Serial" },

  brand: { zh: "品牌", en: "Brand" },
  gestures: { zh: "手势", en: "Gestures" },
  doubleTap: { zh: "双击", en: "Double Tap" },
  tripleTap: { zh: "三击", en: "Triple Tap" },
  longPress: { zh: "长按", en: "Long Press" },
  swipe: { zh: "滑动", en: "Swipe" },
  left: { zh: "左", en: "Left" },
  right: { zh: "右", en: "Right" },
  ancNormal: { zh: "正常", en: "Off" },
  ancCancel: { zh: "降噪", en: "Cancelling" },
  ancAware: { zh: "通透", en: "Awareness" },
  dualConnect: { zh: "双连接", en: "Dual Connection" },
  lowLatency: { zh: "低延迟", en: "Low Latency" },
  autoPause: { zh: "摘下暂停", en: "Auto Pause" },
  inEar: { zh: "佩戴", en: "In Ear" },
  voiceLanguage: { zh: "语音语言", en: "Voice Language" },
  soundQuality: { zh: "音质偏好", en: "Sound Quality" },
  sqConnectivity: { zh: "连接优先", en: "Connection First" },
  sqQuality: { zh: "音质优先", en: "Quality First" },
  huaweiApp: { zh: "华为耳机要用 App", en: "Use the app for HUAWEI" },
  stateOn: { zh: "已开启", en: "On" },
  autoConnect: { zh: "自动连接", en: "Auto Connect" },
  preferred: { zh: "常用", en: "Preferred" },
  playing: { zh: "正在播放", en: "Playing" },
  refresh: { zh: "刷新", en: "Refresh" },
  peers: { zh: "已配对数量", en: "Paired" },
  notConnected: { zh: "未连接", en: "Not connected" },
  devicesTitle: { zh: "设备", en: "Devices" },
  back: { zh: "返回", en: "Back" },
  stateOff: { zh: "已关闭", en: "Off" },
};

// 华为耳机手势动作码，来自耳机自己上报的可用列表
export const TAP_ACTIONS = {
  "-1": { zh: "关闭", en: "Off" },
  0: { zh: "语音助手", en: "Voice Assistant" },
  1: { zh: "播放/暂停", en: "Play/Pause" },
  2: { zh: "下一曲", en: "Next Track" },
  7: { zh: "上一曲", en: "Previous Track" },
  10: { zh: "噪声控制", en: "Noise Control" },
  18: { zh: "音量 +", en: "Volume Up" },
  19: { zh: "音量 -", en: "Volume Down" },
};

export const EQ_PRESETS = {
  1: { zh: "默认", en: "Default" },
  2: { zh: "低音增强", en: "Bass Boost" },
  3: { zh: "高音增强", en: "Treble Boost" },
  9: { zh: "人声", en: "Voice" },
};

const ANC_MODES = {
  0: { zh: "正常", en: "Off" },
  1: { zh: "降噪", en: "Cancelling" },
  2: { zh: "通透", en: "Awareness" },
};

const LOCALES = {
  "zh-CN": { zh: "中文", en: "Chinese" },
  "zh-HK": { zh: "粤语", en: "Cantonese" },
  "en-GB": { zh: "英语（英）", en: "English (UK)" },
  "en-US": { zh: "英语（美）", en: "English (US)" },
  "ja-JP": { zh: "日语", en: "Japanese" },
  "ko-KR": { zh: "韩语", en: "Korean" },
  "de-DE": { zh: "德语", en: "German" },
  "fr-FR": { zh: "法语", en: "French" },
  "es-ES": { zh: "西班牙语", en: "Spanish" },
  "it-IT": { zh: "意大利语", en: "Italian" },
  "pt-BR": { zh: "葡萄牙语（巴）", en: "Portuguese (BR)" },
  "ru-RU": { zh: "俄语", en: "Russian" },
};

export function tapActionName(code) {
  const item = TAP_ACTIONS[code];
  return item ? item[lang] : lang === "zh" ? `动作 ${code}` : `Action ${code}`;
}

export function eqPresetName(id) {
  const item = EQ_PRESETS[id];
  return item ? item[lang] : lang === "zh" ? `预设 ${id}` : `Preset ${id}`;
}

export function ancModeName(mode) {
  const item = ANC_MODES[mode];
  return item ? item[lang] : String(mode);
}

export function sideName(side) {
  return t(side === 2 ? "right" : "left");
}

// 滑动只有「音量调节 / 关闭」两种可选，0 和 1 都是音量
const SWIPE_ACTIONS = {
  "-1": { zh: "关闭", en: "Off" },
  0: { zh: "音量调节", en: "Volume" },
  1: { zh: "音量调节", en: "Volume" },
};

export function swipeActionName(code) {
  const item = SWIPE_ACTIONS[code];
  return item ? item[lang] : lang === "zh" ? `动作 ${code}` : `Action ${code}`;
}

export function voiceLocaleName(code) {
  const item = LOCALES[code];
  return item ? item[lang] : code;
}

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
