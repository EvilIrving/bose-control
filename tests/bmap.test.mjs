import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
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
  parseAudioSettings,
  parseBattery,
  parseCnc,
  parseEq,
  parseFirmware,
  parseMacAddress,
  parseManufactured,
  parseProductId,
  parseModeConfig,
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

test("parseEq maps band 1 to 人声 and signed current", () => {
  const bands = parseEq(Uint8Array.of(0xf6, 10, 0xfe, 1, 0xf6, 10, 3, 2));
  assert.equal(bands[0].name, "人声");
  assert.equal(bands[0].current, -2);
  assert.equal(bands[0].min, -10);
  assert.equal(bands[1].name, "高音");
  assert.equal(bands[1].current, 3);
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
  assert.match(html, /app\.js/);
  assert.doesNotMatch(html, /不登录|本地控制|走 \[31\.10\]|刷新|其他/);
});
