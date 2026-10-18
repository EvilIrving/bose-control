// vivo / iQOO 的 GAIA 帧。下面的字节都来自 TWS-Pods-PC 与 vivopods-mac 的真机抓包记录：
// 串口侧是 vivo TWS 3e，GATT 侧是 vivo TWS 5。
import assert from "node:assert/strict";
import test from "node:test";
import { GAIA, VIVO, createParser, decode, encode, keyOf, parseDeviceList } from "../web/gaia.js";

const hex = (data) => [...data].map((b) => b.toString(16).padStart(2, "0")).join("");
const bin = (raw) => Uint8Array.from(raw.replace(/\s/g, "").match(/../g).map((b) => parseInt(b, 16)));

test("串口帧头和官方 App 抓到的字节一致", () => {
  // 电量查询：官方 Android App 发 FF040000001B0207（v4、vendor 001B、命令 0207）
  assert.equal(hex(encode(0x0207, [], { version: 4 })), "ff040000001b0207");
  // 握手用 GAIA 标准 vendor 000A
  assert.equal(hex(encode(0x0300, [], { version: 4, vendor: GAIA })), "ff040000000a0300");
  // 其余控制帧是 v3：设置降噪 payload 用 TWS 3e 的 [mode, 03]
  assert.equal(hex(encode(0x0130, [1, 0x03], { version: 3 })), "ff030002001b01300103");
});

test("GATT 侧是裸 content，没有 FF 帧头", () => {
  assert.equal(hex(encode(0x0207, [], { link: "ble", version: 4 })), "001b0207");
  // 时间应答：7 字节纯二进制，不是 BCD
  const payload = [20, 26, 8, 6, 11, 12, 29];
  assert.equal(hex(encode(0x0509, payload, { link: "ble", version: 4 })), "001b0509141a08060b0c1d");
});

test("两条通道收到的帧都能解析回同一个命令", () => {
  const spp = decode(bin("ff040000001b0207"), "spp");
  assert.deepEqual({ vendor: spp.vendor, cmd: spp.cmd, version: spp.version }, { vendor: VIVO, cmd: 0x0207, version: 4 });
  const ble = decode(bin("001b850900"), "ble");
  assert.deepEqual({ vendor: ble.vendor, cmd: ble.cmd }, { vendor: VIVO, cmd: 0x8509 });
  assert.deepEqual([...ble.payload], [0x00]);
});

test("回包命令 = 请求命令 | 0x8000，配对键对得上", () => {
  const ask = decode(bin("ff030000001b0230"), "spp");
  const reply = decode(bin("ff030003001b8230020104"), "spp");
  assert.equal(keyOf(ask), keyOf(reply));
});

test("串口解析器能处理半包、粘包和 xor 校验帧", () => {
  const parse = createParser("spp");
  // 半包：只给前 6 字节，什么都不该吐出来
  assert.deepEqual(parse(bin("ff03000500")), []);
  // 剩下的字节到达，凑出完整的一包电量上报
  const rest = bin("1b8207005541 5e 01");
  const packets = parse(rest);
  assert.equal(packets.length, 1);
  assert.deepEqual([...packets[0].payload], [0x00, 0x55, 0x41, 0x5e, 0x01]);

  // 粘包：两帧一次到达
  const two = parse(bin("ff030003001b8230020104 ff030005001b820700 55 5e ff 00"));
  assert.deepEqual(
    two.map((packet) => packet.cmd),
    [0x8230, 0x8207],
  );

  // flags = 01 表示末尾带 xor 校验
  const body = [...bin("ff030103001b8230020104")];
  const sum = body.reduce((acc, byte) => acc ^ byte, 0);
  const withXor = Uint8Array.from([...body, sum]);
  const checked = createParser("spp")(withXor);
  assert.equal(checked.length, 1);
  assert.equal(checked[0].cmd, 0x8230);
  const broken = Uint8Array.from([...body, sum ^ 0xff]);
  assert.deepEqual(createParser("spp")(broken), []);
});

test("GATT 通知一块就是一条，短包先存着", () => {
  const parse = createParser("ble");
  assert.deepEqual(parse(bin("001b")), []);
  const packets = parse(bin("821b01"));
  assert.equal(packets.length, 1);
  assert.equal(packets[0].cmd, 0x821b);
  assert.deepEqual([...packets[0].payload], [0x01]);
});

test("电量字节 >100 视为该项无效", () => {
  const packet = decode(bin("ff030004001b820700 55 5e ff 00"), "spp");
  const [status, left, right, box] = packet.payload;
  const pct = (value) => (value >= 0 && value <= 100 ? value : null);
  assert.equal(status, 0);
  assert.equal(pct(left), 85);
  assert.equal(pct(right), 94);
  assert.equal(pct(box), null);
});

test("佩戴 flags：bit0/1 在盒，bit2/3 佩戴", () => {
  const flags = (byte) => ({
    leftCase: Boolean(byte & 0x01),
    rightCase: Boolean(byte & 0x02),
    leftIn: Boolean(byte & 0x04),
    rightIn: Boolean(byte & 0x08),
  });
  // 位序：bit0 左在盒、bit1 右在盒、bit2 左佩戴、bit3 右佩戴（不是每耳连续两位）
  assert.deepEqual(flags(0x07), { leftCase: true, rightCase: true, leftIn: true, rightIn: false });
  assert.deepEqual(flags(0x05), { leftCase: true, rightCase: false, leftIn: true, rightIn: false });
  assert.deepEqual(flags(0x04), { leftCase: false, rightCase: false, leftIn: true, rightIn: false });
  assert.deepEqual(flags(0x0c), { leftCase: false, rightCase: false, leftIn: true, rightIn: true });
});

test("多连接列表按 [MAC6][未知3][状态][名长][名字] 逐台切出来", () => {
  const mac = (tail) => [0xaa, 0xbb, 0xcc, 0x44, 0x55, tail];
  const payload = [
    0x00,
    0x03,
    ...mac(0x66),
    0x38,
    0x01,
    0x0c,
    0x02,
    0x04,
    ...new TextEncoder().encode("Mac1"),
    0xdd,
    0xee,
    0xff,
    0x77,
    0x88,
    0x99,
    0x5a,
    0x02,
    0x0c,
    0x00,
    0x05,
    ...new TextEncoder().encode("Phone"),
    0x11,
    0x22,
    0x33,
    0xaa,
    0xbb,
    0xcc,
    0x5a,
    0x41,
    0x1c,
    0x00,
    0x03,
    ...new TextEncoder().encode("Pad"),
  ];
  const devices = parseDeviceList(Uint8Array.from(payload));
  assert.equal(devices.length, 3);
  assert.equal(devices[0].name, "Mac1");
  assert.equal(devices[0].state, 0x02);
  assert.equal(devices[1].name, "Phone");
  assert.equal(devices[2].name, "Pad");
});

test("设置多连接列表下发的是全量 7 字节表", () => {
  const entries = [
    { mac: [0xaa, 0xbb, 0xcc, 0x44, 0x55, 0x66], state: 0x02 },
    { mac: [0xdd, 0xee, 0xff, 0x77, 0x88, 0x99], state: 0x00 },
  ];
  const payload = entries.flatMap((entry) => [...entry.mac, entry.state]);
  assert.equal(hex(encode(0x014a, payload, { version: 3 })), "ff03000e001b014aaabbcc44556602ddeeff77889900");
});
