import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LINK_TEXT, linkOf } from "../web/link.js";
import {
  FBLOCK,
  FUNC,
  OP,
  createReassembler,
  decodeAll,
  encode,
  eqPayload,
  get,
  isSegmentHeader,
  modeSwitchPayload,
  audioSettingsPayload,
  actionButtonPayload,
  favoritesPayload,
  modeConfigPayload,
  namePayload,
  parseActionButton,
  parseAudioSettings,
  parseBattery,
  parseCnc,
  parseDeviceList,
  parseEq,
  parseFavorites,
  parseFirmware,
  parseMacAddress,
  parseManufactured,
  parseModeCaps,
  parseProductId,
  productIdOf,
  parseModeConfig,
  parseAnr,
  anrPayload,
  bmapErrorName,
  isRetryableError,
  parseName,
  parseMultipoint,
  parseSidetone,
  parseStandby,
  segment,
  setGet,
  sidetonePayload,
  start,
} from "../web/bmap.js";

test("GET battery is 02 02 01 00", () => {
  assert.deepEqual([...get(FBLOCK.STATUS, FUNC.BATTERY)], [0x02, 0x02, 0x01, 0x00]);
});

test("mode switch START payload is index plus voice prompt", () => {
  assert.deepEqual(
    [...start(FBLOCK.MODES, FUNC.CURRENT_MODE, modeSwitchPayload(2, 1))],
    [0x1f, 0x03, 0x05, 0x02, 0x02, 0x01],
  );
});

test("EQ SETGET writes signed byte and band id", () => {
  assert.deepEqual(
    [...setGet(FBLOCK.SETTINGS, FUNC.EQ, eqPayload(-2, 1))],
    [0x01, 0x07, 0x02, 0x02, 0xfe, 0x01],
  );
});

test("single packet is framed with 0x00", () => {
  const chunks = segment(encode(2, 2, OP.GET));
  assert.equal(chunks.length, 1);
  assert.deepEqual([...chunks[0]], [0x00, 0x02, 0x02, 0x01, 0x00]);
});

test("long packet splits with max/current headers", () => {
  const payload = Uint8Array.from({ length: 30 }, (_, i) => i);
  const packet = encode(0x1f, 0x06, OP.STATUS, payload);
  const chunks = segment(packet, 19);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0][0], 0x10);
  assert.equal(chunks[1][0], 0x11);
  const re = createReassembler();
  assert.equal(re.push(chunks[0]), null);
  assert.deepEqual([...re.push(chunks[1])], [...packet]);
});

test("0x02 is raw BMAP, not a segment header", () => {
  assert.equal(isSegmentHeader(0x00), true);
  assert.equal(isSegmentHeader(0x10), true);
  assert.equal(isSegmentHeader(0x02), false);
});

test("decodeAll reads concatenated status packets", () => {
  const bytes = Uint8Array.of(0x02, 0x02, 0x03, 0x04, 80, 0, 0, 0, 0x01, 0x02, 0x03, 0x01, 65);
  const packets = decodeAll(bytes);
  assert.equal(packets.length, 2);
  assert.equal(packets[0].fblock, 2);
  assert.deepEqual([...packets[0].payload], [80, 0, 0, 0]);
  assert.equal(packets[1].payload[0], 65);
});

test("parseBattery reads percent and component", () => {
  assert.deepEqual(parseBattery(Uint8Array.of(87, 0, 0, 0, 41, 0, 0, 1)), [
    { level: 87, component: 0 },
    { level: 41, component: 1 },
  ]);
});

test("parseEq keeps band id and signed levels", () => {
  const bands = parseEq(Uint8Array.of(0xf6, 10, 0xfe, 1, 0xf6, 10, 3, 2));
  assert.equal(bands[0].id, 1);
  assert.equal(bands[0].current, -2);
  assert.equal(bands[0].min, -10);
  assert.equal(bands[1].id, 2);
  assert.equal(bands[1].current, 3);
});

test("EQ 频段名有官方中英文案", async () => {
  const { setLang, eqBandName } = await import("../web/labels.js");
  setLang("zh");
  assert.equal(eqBandName(0), "低音");
  assert.equal(eqBandName(1), "中音");
  assert.equal(eqBandName(2), "高音");
  setLang("en");
  assert.equal(eqBandName(1), "Mid");
  setLang("zh");
});

test("parseCnc reads step count then current; max index is count-1", () => {
  assert.deepEqual(parseCnc(Uint8Array.of(11, 0, 1)), {
    steps: 11,
    step: 0,
    total: 11,
    enabled: true,
  });
});

test("31.10 SETGET writes cnc auto spatial wind anc", () => {
  const payload = audioSettingsPayload({
    cnc: 8,
    auto: false,
    spatial: 1,
    wind: false,
    anc: true,
  });
  assert.deepEqual(
    [...setGet(FBLOCK.MODES, FUNC.AUDIO_SETTINGS, payload)],
    [0x1f, 0x0a, 0x02, 0x05, 0x08, 0x00, 0x01, 0x00, 0x01],
  );
});

test("parseAudioSettings reads spatial as 固定空间", () => {
  const cfg = parseAudioSettings(Uint8Array.of(8, 0, 1, 0, 1));
  assert.deepEqual(cfg, { cnc: 8, auto: false, spatial: 1, wind: false, anc: true });
});

test("31.10 SETGET matches official AudioModesSettingsConfigSetGetPacket", () => {
  const payload = audioSettingsPayload({
    cnc: 4,
    auto: true,
    spatial: 2,
    wind: true,
    anc: false,
  });
  assert.deepEqual([...payload], [4, 1, 2, 1, 0]);
});

test("parseSidetone uses second byte", () => {
  assert.equal(parseSidetone(Uint8Array.of(1, 3)), 3);
});

test("sidetone SETGET is persisted then mode", () => {
  assert.deepEqual(
    [...setGet(FBLOCK.SETTINGS, FUNC.SIDETONE, sidetonePayload(2))],
    [0x01, 0x0b, 0x02, 0x02, 0x01, 0x02],
  );
});

test("multipoint GET uses bit0 enabled bit1 supported", () => {
  assert.deepEqual(parseMultipoint(Uint8Array.of(0b011)), {
    supported: true,
    enabled: true,
  });
});

test("standby GET reads minutes", () => {
  assert.equal(parseStandby(Uint8Array.of(20)), 20);
});

test("parseName skips the flag byte", () => {
  assert.equal(parseName(Uint8Array.from([0, ...Buffer.from("QC Ultra")])), "QC Ultra");
});

test("parseModeConfig prefers the 32-byte device name, including 橡胶", () => {
  const payload = new Uint8Array(48);
  payload[0] = 4;
  payload[2] = 12;
  const name = Buffer.from("橡胶");
  payload.set(name, 6);
  const mode = parseModeConfig(payload);
  assert.equal(mode.index, 4);
  assert.equal(mode.name, "橡胶");
});

test("parseFirmware keeps the raw version string", () => {
  const payload = new TextEncoder().encode("8.2.20+g34cf029");
  assert.equal(parseFirmware(payload), "8.2.20+g34cf029");
});

test("parseMacAddress formats six bytes from the headset", () => {
  assert.equal(
    parseMacAddress(Uint8Array.of(0x68, 0xf2, 0x1f, 0x0d, 0x94, 0x89)),
    "68:F2:1F:0D:94:89",
  );
});

test("parseProductId reads product id then variant", () => {
  assert.equal(parseProductId(Uint8Array.of(0x40, 0x82, 0x02)), "0x4082 · v2");
});

test("parseManufactured reads BCD day month year", () => {
  assert.equal(parseManufactured(Uint8Array.of(0x25, 0x11, 0x20, 0x26)), "2026-11-25");
});

test("hint stays on one line on a narrow phone", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const css = readFileSync(join(dir, "../web/styles.css"), "utf8");
  assert.match(css.match(/#hint \{([^}]*)\}/)[1], /white-space: nowrap/);
  assert.match(css.match(/#hint \{([^}]*)\}/)[1], /min-height: 1\.4em/);
  // 设备中心就是首页，提示一直挂在那一页上
  assert.match(css.match(/#hint \{([^}]*)\}/)[1], /display: block/);
  for (const [key, text] of Object.entries(LINK_TEXT)) {
    assert.ok(text.zh.length <= 10, `中文提示太长 (${key}): ${text.zh}`);
    assert.ok(text.en.length <= 32, `英文提示太长 (${key}): ${text.en}`);
  }
});

test("linkOf turns native codes into one state each", () => {
  const cases = [
    ["none", "notfound"],
    ["NotFoundError", "notfound"],
    ["off", "off"],
    ["adapter", "off"],
    ["bluetooth", "off"],
    ["permission", "denied"],
    ["denied", "denied"],
    ["NotAllowedError", "denied"],
    ["unsupported", "unsupported"],
    ["no native bridge", "unsupported"],
    ["service", "noproto"],
    ["char", "noproto"],
    ["notify", "noproto"],
    ["refused", "refused"],
    ["dropped", "refused"],
    ["timeout", "failed"],
    ["connect", "failed"],
    ["write", "failed"],
    ["spp", "failed"],
    ["scan", "failed"],
    ["mtu", "failed"],
    ["descriptor", "failed"],
  ];
  for (const [code, link] of cases) assert.equal(linkOf(new Error(code)), link, code);
  assert.equal(linkOf({ name: "NotAllowedError", message: "boom" }), "denied");
  assert.equal(linkOf("Failed to execute 'requestDevice' on 'Bluetooth'"), "failed");
  assert.equal(linkOf("没找到耳机：确认耳机已开机"), "notfound");
  assert.equal(linkOf("蓝牙已关闭，请先打开蓝牙"), "off");
  assert.equal(linkOf(""), "failed");
  assert.equal(linkOf(undefined), "failed");
});


test("切换语言会换掉界面文案", async () => {
  const { setLang, t, voiceLanguageName } = await import("../web/labels.js");
  setLang("zh");
  assert.equal(t("disconnect"), "断开连接");
  assert.equal(voiceLanguageName(8), "中文");
  setLang("en");
  assert.equal(t("disconnect"), "Disconnect");
  assert.equal(voiceLanguageName(8), "Chinese");
  setLang("zh");
});

test("产品 ID 能从回包取出并映射到官方型号名", async () => {
  const { productName } = await import("../web/products.js");
  const payload = Uint8Array.of(0x40, 0x82, 0x02);
  assert.equal(productIdOf(payload), 16514);
  assert.equal(productName(productIdOf(payload)), "Bose QC Ultra 2 HP");
  assert.equal(productName(0x9999), "");
});

test("所有文案都有中英两份", async () => {
  const { LABELS, SPATIAL_OPTIONS, SELF_VOICE_OPTIONS, STANDBY_OPTIONS, VOICE_LANGUAGES } = await import(
    "../web/labels.js"
  );
  for (const [key, value] of Object.entries(LABELS)) {
    assert.ok(value.zh, `缺少中文: ${key}`);
    assert.ok(value.en, `缺少英文: ${key}`);
  }
  for (const list of [SPATIAL_OPTIONS, SELF_VOICE_OPTIONS, STANDBY_OPTIONS]) {
    for (const option of list) {
      assert.ok(option.zh && option.en, `选项缺少文案: ${JSON.stringify(option)}`);
    }
  }
  for (const [id, name] of Object.entries(VOICE_LANGUAGES)) {
    assert.ok(name.zh && name.en, `语言缺少文案: ${id}`);
  }
});

test("每个 data-label 都有官方中英文案", async () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(join(dir, "../web/index.html"), "utf8");
  const { LABELS } = await import("../web/labels.js");
  const keys = [...html.matchAll(/data-label="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 8, "data-label 数量不对");
  for (const key of keys) {
    assert.ok(LABELS[key]?.zh, `缺少中文文案: ${key}`);
    assert.ok(LABELS[key]?.en, `缺少英文文案: ${key}`);
  }
});

test("web files are a complete page", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(join(dir, "../web/index.html"), "utf8");
  assert.match(html, />连接</);
  assert.match(html, /id="info"/);
  assert.match(html, /id="modes"/);
  assert.match(html, /id="cnc"/);
  assert.match(html, /id="eq"/);
  assert.match(html, /id="spatial"/);
  assert.match(html, /id="sidetone"/);
  assert.match(html, /id="hint"/);
  assert.match(html, /id="device-trigger"/);
  assert.match(html, /id="device-menu"/);
  assert.match(html, /id="diag-actions"/);
  assert.match(html, /"noModule" in HTMLScriptElement\.prototype/);
  assert.ok(html.indexOf('id="info"') > html.indexOf('id="settings"'), "设备信息卡在设置页");
  assert.ok(html.indexOf('id="device-menu"') < html.indexOf('<main'), "设备下拉在顶栏里");
  assert.doesNotMatch(html, /fold-label/);
  assert.match(html, /app\.js/);
  assert.doesNotMatch(html, /不登录|本地控制|走 \[31\.10\]|刷新|其他/);
});

test("31.8 favorites round-trips the官方 bitmask order", () => {
  const payload = favoritesPayload(11, [0, 9]);
  assert.deepEqual([...payload], [11, 0b00000010, 0b00000001]);
  assert.deepEqual(parseFavorites(payload), { count: 11, indices: [0, 9] });
});

test("31.8 parses a device mask back to indices", () => {
  assert.deepEqual(parseFavorites(Uint8Array.of(16, 0b00000100, 0b00000011)), {
    count: 16,
    indices: [0, 1, 10],
  });
});

test("31.6 SETGET is 40 bytes: index, prompt, 32-byte name, cnc, auto, spatial, wind, anc", () => {
  const payload = modeConfigPayload({
    index: 4,
    prompt: [0, 0],
    name: "橡胶",
    cnc: 8,
    auto: false,
    spatial: 1,
    wind: true,
    anc: true,
  });
  assert.equal(payload.length, 40);
  assert.equal(payload[0], 4);
  assert.deepEqual([...payload.slice(1, 3)], [0, 0]);
  assert.equal(new TextDecoder().decode(payload.slice(3, 9)), "橡胶");
  assert.equal(payload[9], 0, "名字后面要留 NUL");
  assert.deepEqual([...payload.slice(35)], [8, 0, 1, 1, 1]);
});

test("31.6 truncates a long name without splitting a UTF-8 sequence", () => {
  const payload = modeConfigPayload({ index: 5, name: "一一一一一一一一一一一一", cnc: 5 });
  const bytes = payload.slice(3, 35);
  const text = new TextDecoder().decode(bytes).replace(/\0+$/, "");
  assert.equal(text, "一一一一一一一一一一");
  assert.equal(bytes[30], 0);
});

test("1.9 SETGET carries button id, event type and action", () => {
  const config = { buttonId: 128, eventType: 9 };
  assert.deepEqual([...setGet(FBLOCK.SETTINGS, FUNC.BUTTONS, actionButtonPayload(config, 19))], [
    0x01, 0x09, 0x02, 0x03, 128, 9, 19,
  ]);
});

test("1.9 reply lists supported actions and the current one", () => {
  const payload = new Uint8Array(11);
  payload[0] = 128;
  payload[1] = 9;
  payload[2] = 19;
  payload[6] = 0b00010010;
  payload[9] = 0b00000001;
  const config = parseActionButton(payload);
  assert.equal(config.buttonId, 128);
  assert.equal(config.eventType, 9);
  assert.equal(config.action, 19);
  assert.deepEqual(config.supported, [1, 4]);
  assert.deepEqual(config.unavailable, [8]);
});

test("4.4 device list is a connected bitmap plus six bytes per device", () => {
  const payload = Uint8Array.of(
    0b00000011,
    0x40, 0x58, 0x46, 0xf3, 0xf2, 0x18,
    0x68, 0xf2, 0x1f, 0x0d, 0x94, 0x89,
  );
  assert.deepEqual(parseDeviceList(payload), [
    { mac: "40:58:46:F3:F2:18", connected: true },
    { mac: "68:F2:1F:0D:94:89", connected: true },
  ]);
  assert.deepEqual(parseDeviceList(Uint8Array.of(0)), []);
});

test("transport, power and pairing use one-byte START payloads", () => {
  assert.deepEqual([...start(FBLOCK.AUDIO, FUNC.TRANSPORT, Uint8Array.of(3))], [0x05, 0x03, 0x05, 0x01, 3]);
  assert.deepEqual([...start(FBLOCK.CONTROL, FUNC.POWER, Uint8Array.of(0))], [0x07, 0x04, 0x05, 0x01, 0]);
  assert.deepEqual([...start(FBLOCK.DEVICE, FUNC.PAIRING, Uint8Array.of(1))], [0x04, 0x08, 0x05, 0x01, 1]);
});

test("1.2 SETGET sends the raw UTF-8 name", () => {
  assert.deepEqual([...namePayload("我的耳机")], [...new TextEncoder().encode("我的耳机")]);
});

test("快捷动作文案覆盖官方枚举，未知值回落到编号", async () => {
  const { actionName, pressName, setLang } = await import("../web/labels.js");
  setLang("zh");
  assert.equal(actionName(8), "切换设备");
  assert.equal(actionName(11), "上一曲");
  assert.equal(actionName(19), "沉浸式音频");
  assert.equal(actionName(22), "按键 22");
  assert.equal(pressName(9), "长按");
  setLang("en");
  assert.equal(actionName(8), "Switch Device");
  assert.equal(pressName(9), "Long Press");
  setLang("zh");
});

test("自定义模式与快捷键的容器都在页面里", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(join(dir, "../web/index.html"), "utf8");
  for (const id of ["mode-editor", "transport", "rename", "shortcut", "favorites", "playing", "headset-actions"]) {
    assert.match(html, new RegExp(`id="${id}"`), `缺少 ${id}`);
  }
  assert.ok(html.indexOf('id="shortcut"') > html.indexOf('id="settings"'), "快捷键在设置页");
  assert.ok(html.indexOf('id="transport"') < html.indexOf('id="settings"'), "播放控制在主页");
});

test("QC Ultra 2 HP 真机回包：31.2 能力 04 07 00 00 00 7f 02", () => {
  const caps = parseModeCaps(Uint8Array.of(0x04, 0x07, 0x00, 0x00, 0x00, 0x7f, 0x02));
  assert.deepEqual(caps, { bose: 4, user: 7, flags: 0x7f });
});

test("QC Ultra 2 HP 真机回包：31.8 收藏 0b 00 07 是模式 0/1/2", () => {
  assert.deepEqual(parseFavorites(Uint8Array.of(0x0b, 0x00, 0x07)), {
    count: 11,
    indices: [0, 1, 2],
  });
});

test("QC Ultra 2 HP 真机回包：01.09 快捷动作只报 4 个可用项", () => {
  const config = parseActionButton(
    Uint8Array.of(0x80, 0x09, 0x13, 0x00, 0x09, 0x40, 0x02),
  );
  assert.deepEqual(config, {
    buttonId: 128,
    eventType: 9,
    action: 19,
    supported: [1, 14, 16, 19],
    unavailable: [],
  });
});

// ---- 机型适配：这些数字都来自真机抓包，改错就必须红 ----

test("电量按组件号认部件：01 右、02 左、03 盒（不是按位置）", () => {
  // QC Ultra 2 Earbuds 真机：[level, _, _, component] 四字节一组
  const rows = parseBattery(
    Uint8Array.from([0x3c, 0xff, 0xff, 0x01, 0x3c, 0xff, 0xff, 0x02, 0x50, 0xff, 0xff, 0x03, 0x3c, 0xff, 0xff, 0x04]),
  );
  assert.deepEqual(rows, [
    { level: 60, component: 1 },
    { level: 60, component: 2 },
    { level: 80, component: 3 },
    { level: 60, component: 4 },
  ]);
});

test("电量同一组件重复上报时保留第一条，0xFF 不当电量", () => {
  const rows = parseBattery(
    Uint8Array.from([0x50, 0xff, 0xff, 0x01, 0x10, 0xff, 0xff, 0x01, 0xff, 0xff, 0xff, 0x03]),
  );
  assert.deepEqual(rows, [{ level: 80, component: 1 }]);
});

test("31.6 回包按长度分家：48 字节 ultra2 / 47 prince / 40 SETGET 回显", () => {
  const status48 = new Uint8Array(48);
  status48[0] = 2;
  status48[42] = 7; // cnc
  status48[44] = 2; // spatial
  status48[45] = 1; // wind（不是 46！）
  status48[46] = 0;
  status48[47] = 0;
  const ultra = parseModeConfig(status48);
  assert.equal(ultra.layout, "ultra2");
  assert.equal(ultra.cnc, 7);
  assert.equal(ultra.wind, true, "wind 在 45，读到 46 会错");
  assert.equal(ultra.anc, false);

  const status47 = new Uint8Array(47);
  status47[0] = 0;
  status47[42] = 9;
  status47[46] = 1; // prince 的 wind 在 46
  const prince = parseModeConfig(status47);
  assert.equal(prince.layout, "prince");
  assert.equal(prince.wind, true);
  assert.equal(prince.anc, null, "prince 没有 anc 位，不能当成关着");

  const echo40 = new Uint8Array(40);
  echo40[0] = 5;
  echo40[3] = 0x41; // 名字从 3 起，不是在 6
  echo40[35] = 8;
  echo40[37] = 1;
  echo40[38] = 1;
  echo40[39] = 1;
  const echo = parseModeConfig(echo40);
  assert.equal(echo.layout, "echo40");
  assert.equal(echo.name, "A");
  assert.equal(echo.cnc, 8);
  assert.equal(echo.anc, true);
});

test("写模式：没有 anc 位的机型只发 39 字节", () => {
  const full = modeConfigPayload({ index: 4, name: "x", cnc: 5, anc: true });
  assert.equal(full.length, 40);
  const noAnc = modeConfigPayload({ index: 4, name: "x", cnc: 5, anc: null });
  assert.equal(noAnc.length, 39);
  assert.equal(noAnc[38], 0, "风噪位还在 38");
});

test("BMAP 错误码：OpNotSupp 不重试，Runtime / Timeout 才重试", () => {
  assert.equal(bmapErrorName(5), "OpNotSupp");
  assert.equal(bmapErrorName(20), "InsecureTransport");
  assert.equal(isRetryableError(5), false, "重复问一次 OpNotSupp 还是同一个回答");
  assert.equal(isRetryableError(4), false);
  assert.equal(isRetryableError(3), false);
  for (const code of [7, 8, 9]) {
    assert.equal(isRetryableError(code), true, `错误码 ${code} 应该可以再试`);
  }
});

test("[1.6] ANR 四档：off/high/wind/low，未知值不冒充", () => {
  assert.equal(parseAnr(Uint8Array.of(0)), 0);
  assert.equal(parseAnr(Uint8Array.of(1)), 1);
  assert.equal(parseAnr(Uint8Array.of(2)), 2);
  assert.equal(parseAnr(Uint8Array.of(3)), 3);
  assert.equal(parseAnr(Uint8Array.of(9)), null, "未知档位不能当成合法值");
  assert.deepEqual([...anrPayload(2)], [2]);
});
