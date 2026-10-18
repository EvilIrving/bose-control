// 用假 link 跑一遍 vivo 的启动流程：证明握手、电量、降噪、EQ、佩戴、信息这几条
// 一次性读回来的东西被正确落到了宿主状态上。字节都按 GAIA 规则拼，语义见 web/gaia.js 的注释。
import assert from "node:assert/strict";
import test from "node:test";
import { createParser, decode } from "../web/gaia.js";
import { VivoHeadset } from "../web/vivo.js";

const frame = (version, vendor, cmd, payload = []) =>
  Uint8Array.from([0xff, version, 0, payload.length, vendor >> 8, vendor & 0xff, cmd >> 8, cmd & 0xff, ...payload]);

const REPLY = {
  0x0300: frame(4, 0x000a, 0x8300, [0x00]),
  0x0207: frame(4, 0x001b, 0x8207, [0x00, 0x55, 0x5e, 0xff, 0x02]),
  0x0230: frame(3, 0x001b, 0x8230, [0x00, 0x02, 0x04]),
  0x0218: frame(3, 0x001b, 0x8218, [0x00, 0x02]),
  0x020d: frame(3, 0x001b, 0x820d, [0x00, 0x0c]),
  0x021b: frame(3, 0x001b, 0x821b, [0x00, 0x00, 0xc0]),
  0x021c: frame(3, 0x001b, 0x821c, [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x09, 0x0c]),
  0x0215: frame(3, 0x001b, 0x8215, [0x00, ...new TextEncoder().encode("ABC123")]),
  0x0249: frame(
    3,
    0x001b,
    0x8249,
    [0x00, 0x01, 0xaa, 0xbb, 0xcc, 0x44, 0x55, 0x66, 0x38, 0x01, 0x0c, 0x02, 0x03, ...new TextEncoder().encode("Mac")],
  ),
};

class FakeLink {
  constructor(replies = REPLY) {
    this.link = "spp";
    this.name = "vivo TWS 3e";
    this.lastError = "";
    this.sent = [];
    this.replies = { ...replies };
  }

  async request(bytes, timeout) {
    const [packet] = createParser("spp")(bytes);
    this.sent.push(packet.cmd);
    const custom = this.handler?.(packet);
    if (custom) return decode(custom, "spp");
    const reply = this.replies[packet.cmd];
    if (!reply) throw new Error(`timeout ${packet.cmd.toString(16)}`);
    return decode(reply, "spp");
  }
}

function setup(replies) {
  const link = new FakeLink(replies);
  const state = { name: "", battery: [], info: {} };
  const session = new VivoHeadset({ link, ui: {}, state, refresh: () => {}, log: () => {} });
  return { link, state, session };
}

test("启动一趟把电量、降噪、EQ、佩戴、型号都读回来", async () => {
  const { link, state, session } = setup();
  assert.equal(await session.load(), true);
  // 宿主按「左 / 盒 / 右」顺序画电量，盒这一项 0xff 无效就不出现
  assert.deepEqual(state.battery, [
    { component: 0, level: 85 },
    { component: 2, level: 94 },
  ]);
  assert.equal(session.noise, 2);
  assert.equal(session.eq, 2);
  assert.equal(session.wear.leftIn, true);
  assert.equal(session.wear.rightIn, true);
  assert.equal(session.info.firmware, "2.5.9");
  assert.equal(session.info.model, "DPD2523_BASE");
  assert.equal(session.info.serial, "ABC123");
  assert.equal(state.info.firmware, "2.5.9");
  // 握手是 v4，控制帧是 v3：版本用错耳机会静默不回包
  assert.equal(link.sent[0], 0x0300);
});

test("注册链之后才去读多连接，设备列表能解析出来", async () => {
  const { session, state } = setup();
  await session.load();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(session.devices.length, 1);
  assert.equal(session.devices[0].name, "Mac");
  assert.equal(session.devices[0].state, 0x02);
  assert.equal(session.local, "AA:BB:CC:44:55:66");
  assert.equal(state.info.mac, "AA:BB:CC:44:55:66");
});

test("握手不回包就判定这条通道不是控制通道", async () => {
  const { state, session } = setup({});
  assert.equal(await session.load(), false);
  assert.deepEqual(state.battery, []);
});

test("降噪设置的 reduceModel 尾巴按型号试，通了就记住", async () => {
  const { link, session } = setup({ 0x0300: REPLY[0x0300] });
  // 只有尾巴是 [mode, 03, 01] 的那种才回包，模拟「型号不认识第一种写法」
  link.handler = (packet) =>
    packet.cmd === 0x0130 && packet.payload.length === 3 ? frame(3, 0x001b, 0x8130, [0x00, 0x00]) : null;
  await session.load();
  await session.setNoise(0);
  const tries = link.sent.filter((cmd) => cmd === 0x0130).length;
  assert.equal(tries, 2);
  assert.deepEqual(session.suffix, [0x03, 0x01]);
  assert.equal(session.noise, 0);
});

test("耳机主动要时间就回一帧纯二进制时间", async () => {
  const { link, session } = setup({ 0x0509: frame(4, 0x001b, 0x8509, []) });
  session.onPacket(decode(frame(3, 0x001b, 0x8509, [0x00]), "spp"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(link.sent.includes(0x0509));
});
