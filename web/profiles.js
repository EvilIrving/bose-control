// Bose 机型协议差异表。
//
// 同一个功能块在不同固件上字段位置、可用操作、甚至「用哪条命令」都不一样。
// 这里把差异集中成数据，bose.js 只按表执行，不再对某个型号写 if。
//
// 判据一律来自真机回包，不按型号名猜：
//   - 先读 [0.3] 产品 ID，表里有就用表；
//   - 表里没有就返回 DEFAULT，靠「谁回包就显示谁」继续跑。
//
// 字段含义：
//   init           连上后必须先发的探路包（QC35 / QC45 不发就不回别的东西）
//   cnc            消噪写法的优先级列表：
//                    audioSettings  [31.10] SETGET，5 字节，立即生效
//                    cncDirect      [1.5]   SETGET，两字节
//                    anr            [1.6]   SETGET，四档枚举（QC35 独有）
//   audioSettings  有没有 [31.10]（决定空间音频、风噪、自动消噪能不能控）
//   modeConfig     31.6 回包字节数；40 表示 SETGET 回显，48/47/41..46 是 STATUS
//   modeWrite      写模式时发多少字节：40 带 anc，39 不带（prince 系）
//   ancToggle      模式里有没有「消噪开关」这一位
//   cncDirectSetget 只有 [1.5] 可写（QC Earbuds 一代：ModeConfig 写不动）
//   editableSlots  可编辑的自定义模式槽位
//   presetModes    固件自带、不可改的模式
//   batteryComponents 组件号 → 部件名；空表示单电池
//   batteryAggregate  合并读数用哪个组件号，合并来源是哪几个

export const BATTERY = { MAIN: 0, RIGHT: 1, LEFT: 2, CASE: 3, BOTH: 4 };

export const ANR_MODES = {
  0: "off",
  1: "high",
  2: "wind",
  3: "low",
};

const ALL_SLOTS = [4, 5, 6, 7, 8, 9, 10];

const DEFAULT = {
  id: "default",
  productIds: [],
  // 电池是 BMAP 全平台都有的，读数格式也一样：[level, _, _, component] 四字节一组
  batteryComponents: { [BATTERY.RIGHT]: "right", [BATTERY.LEFT]: "left", [BATTERY.CASE]: "case" },
  batteryAggregate: null,
  cnc: ["audioSettings", "cncDirect"],
  audioSettings: true,
  // 回退机型按最全的能力发：产品 ID 还没读到时不知道对方是什么，
  // 少发一条比多发一条代价大得多——少发意味着功能永远不出现。
  modeConfig: 48,
  modeWrite: 40,
  ancToggle: true,
  cncDirectSetget: false,
  init: null,
  presetModes: [0, 1, 2, 3],
  editableSlots: ALL_SLOTS,
  // 这条命令在哪些机型上已知不可用（省一次必然失败的请求）
  skip: [],
};

// 表里每一条都注明证据来源，没验过的写「未验证」，不假装验过。
const PROFILES = [
  {
    ...DEFAULT,
    id: "ultra2",
    productIds: [0x4082, 0x4083, 0x4066],
    // QC Ultra 2 HP / QC 2 HP / QC Ultra 1：31.10 直控消噪，48 字节 STATUS，
    // 写 40 字节带 anc。QC Ultra 2 真机验过 wind=45。
    modeConfig: 48,
    verify: "QC Ultra 2 HP 真机：31.2 能力、31.8 收藏、01.09 快捷动作",
  },
  {
    ...DEFAULT,
    id: "ultra2-earbuds",
    productIds: [0x4062, 0x4072, 0x4064],
    modeConfig: 48,
    // 实测组件号：01 右、02 左、03 盒、04 左右合并。合并读数优先用 04，
    // 没有就取左右里较低的那个。
    batteryComponents: {
      [BATTERY.RIGHT]: "right",
      [BATTERY.LEFT]: "left",
      [BATTERY.CASE]: "case",
    },
    batteryAggregate: { id: BATTERY.BOTH, sources: [BATTERY.RIGHT, BATTERY.LEFT] },
    verify: "QC Ultra 2 Earbuds 实测 3cffff01 / 3cffff02 / 3cffff03 / 50ffff04",
  },
  {
    ...DEFAULT,
    id: "prince",
    productIds: [0x4075, 0x4039],
    // QC Headphones / QC45：47 字节 STATUS，cnc42 auto43 spatial44 wind46，
    // 没有 anc 位，写 39 字节。QC35/QC45 需要先 GET [0.1] 才会响应后续命令。
    modeConfig: 47,
    modeWrite: 39,
    ancToggle: false,
    audioSettings: false,
    cnc: ["cncDirect"],
    presetModes: [0, 1],
    editableSlots: [2, 3],
    init: [0x00, 0x01],
    verify: "QC45 布局来自 Bose App 反编译（未真机）；prince 已验 wind=46",
  },
  {
    ...DEFAULT,
    id: "qc35",
    productIds: [0x400c, 0x4020],
    // QC35：没有 31 块，消噪是 [1.6] ANR 四档（off/high/wind/low），没有 EQ，
    // 没有多点连接，没有自动播放/接听。
    modeConfig: null,
    modeWrite: null,
    audioSettings: false,
    ancToggle: false,
    cnc: ["anr"],
    init: [0x00, 0x01],
    presetModes: [],
    editableSlots: [],
    batteryComponents: {},
    skip: ["eq", "multipoint", "autoPlay", "autoAnswer", "modes", "favorites"],
    verify: "QC35 固件 4.8.1：ANR [1.6] off/high/wind/low；块 3 是低层 NC，无实用控制",
  },
  {
    ...DEFAULT,
    id: "qc-earbuds",
    productIds: [0x402f],
    // QC Earbuds 一代：31.6 SETGET 写不动，消噪只能直写 [1.5]；
    // 四个固定模式，没有可编辑槽位。
    modeConfig: 44,
    modeWrite: null,
    audioSettings: false,
    ancToggle: false,
    cncDirectSetget: true,
    cnc: ["cncDirect"],
    presetModes: [0, 1],
    editableSlots: [],
    verify: "QC Earbuds 固件 2.0.7：ModeConfig SETGET 无效，CNC 走 [1.5]",
  },
  {
    ...DEFAULT,
    id: "ultra-open",
    productIds: [0x4068],
    // Ultra Open Earbuds：开放式，没有消噪块；有 EQ、多点连接、模式切换。
    modeConfig: 48,
    audioSettings: false,
    ancToggle: false,
    cnc: [],
    presetModes: [],
    editableSlots: [],
    verify: "Ultra Open 固件 4.0.22：读、Settings SETGET、EQ、切模式可用；无 CNC",
  },
];

const BY_ID = new Map(PROFILES.map((profile) => [profile.id, profile]));
const BY_PRODUCT = new Map();
for (const profile of PROFILES) {
  for (const id of profile.productIds) BY_PRODUCT.set(id, profile);
}

export function profileById(id) {
  return BY_ID.get(id) ?? DEFAULT;
}

// 产品 ID 还没读到时返回 DEFAULT：先按最全的能力去试，谁回包就显示谁。
export function profileFor(productId) {
  if (!productId) return DEFAULT;
  return BY_PRODUCT.get(productId & 0xffff) ?? DEFAULT;
}

// 某些功能在表里标了已知不可用。返回 false 时调用方应跳过该请求：
// 少发一条必然超时的命令，等于省 500ms。
export function supports(profile, feature) {
  if (profile.skip.includes(feature)) return false;
  if (feature === "modes") return Boolean(profile.modeConfig);
  if (feature === "eq") return true;
  if (feature === "audioSettings") return profile.audioSettings;
  if (feature === "ancToggle") return profile.ancToggle;
  return true;
}

export const DEFAULT_PROFILE = DEFAULT;
