// 真机向量来自 OnePlus Buds 4：payload 逐字节抄自 /tmp/opbuds/docs/protocol.md 与 oppowin 单测，
// 帧头（cmdId / msgType / seq / plen）用 opo.js 的 encode() 拼回去。文档只给 payload 时，
// 行内注释会说明 seq 的来源；没有真机依据的字节单独标成合成。
import assert from "node:assert/strict";
import test from "node:test";
import {
  ANC,
  CMD,
  EMPTY,
  HELLO,
  MSG,
  TOPIC,
  ancSetPayload,
  batteryRows,
  buildRequest,
  buildSet,
  countRequest,
  createParser,
  decodeAnc,
  decodeBattery,
  decodeEqPreset,
  decodeEqPush,
  decodeFirmware,
  decodeTouch,
  decodeWear,
  encode,
  eqSetPayload,
  findPayload,
  header,
  key,
  readVarint,
  touchSetPayload,
} from "../web/opo.js";

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const bin = (raw) => Uint8Array.from(raw.replace(/\s+/g, "").match(/../g).map((b) => parseInt(b, 16)));
const join = (...parts) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};
const reply = (cmd, seq, payload) => encode(cmd, MSG.reply, seq, bin(payload));
const push = (seq, payload) => encode(0x04, MSG.notify, seq, bin(payload));

// HELLO 回包：payload 00 ff 77 5a ea 67 0e 20 07 是文档里五次会话都一致的静态值；
// seq 0x23 按请求回显（C# 客户端按 cmdId + seq 配对）。
const HELLO_REPLY = bin("aa 10 00 00 00 81 23 09 00 00 ff 77 5a ea 67 0e 20 07");

// 电量回包：两只都在 90%、没有盒子（真机 live 读数）。seq 0x25 来自 probe 的 FIXED_SEQ。
const BATTERY_REPLY = reply(CMD.battery, 0x25, "00 02 01 5a 02 5a");
// 电量推送：topic 0x01 + 同样的 body（family 1：回包去掉状态字节）。
const BATTERY_PUSH = push(0xff, "01 02 01 5a 02 5a");

// 降噪回包：adaptive（真机）。推送 topic 0x03。
const ANC_REPLY = reply(CMD.anc, 0x42, "00 01 01 00 08");
const ANC_PUSH = push(0xff, "03 01 01 00 08");

// 佩戴回包：左入耳、右入耳、盒子在位（真机）。推送 topic 0x02。
const WEAR_REPLY = reply(CMD.wear, 0x26, "00 03 01 07 02 07 03 04");
const WEAR_PUSH = push(0xff, "02 03 01 07 02 07 03 04");

// EQ 回包 00 02 = Bass（真机）；0x0504 推送是裸的预设字节。
const EQ_REPLY = reply(CMD.eq, 0x27, "00 02");
const EQ_PUSH = encode(0x04, MSG.notifyAlt, 0x0c, bin("01"));

// 0x0108 的 74 字节回包。文档给的是 18 行表格而不是整帧 hex：顺序按「左 type01 六条 →
// 右 type01 六条 → type06 六条」还原，因为 Tier D 实测写手势时变的是第 33 字节（0 起算），
// 只有这个排法能让它正好落在右耳 type01 / gesture02 的 action（06 -> 05）上。
const TOUCH_PAYLOAD = bin(`
  00 12
  01 01 01 01  01 01 02 05  01 01 03 03  01 01 04 08  01 01 05 07  01 01 06 00
  02 01 01 01  02 01 02 06  02 01 03 03  02 01 04 08  02 01 05 07  02 01 06 00
  01 06 02 1d  01 06 03 00  01 06 06 1c
  02 06 02 1d  02 06 03 00  02 06 06 1c
`);
const TOUCH_REPLY = encode(CMD.touch, MSG.reply, 0x28, TOUCH_PAYLOAD);

// 0x011F 的 299 字节 payload：前 13 字节是文档逐字节给出的，其余按文档描述的
// 「12 字节记录、只有一个 0x08」补到 299；这里要验证的是分帧，不是内容。
function bigPayload() {
  const payload = new Uint8Array(299);
  payload.set(bin("00 00 00 00 00 04 44 ac 48 00 01 00 00"), 0);
  for (let at = 13; at + 11 < payload.length; at += 12) payload[at] = 0x08;
  return payload;
}
const BIG = encode(0x1f, MSG.reply, 0x00, bigPayload());

test("HELLO 就是真机发出的十个字节，帧只覆盖前九个", () => {
  assert.equal(hex(HELLO), "aa070000000123000012");
  const packet = header(HELLO);
  assert.equal(packet.cmdId, CMD.hello);
  assert.equal(packet.msgType, MSG.request);
  assert.equal(packet.seq, 0x23);
  assert.equal(packet.payload.length, 0);
  assert.equal(key(packet), "00:01");
});

test("0x8100 回包按命令 + 消息类型族和 HELLO 配上", () => {
  const packet = header(HELLO_REPLY);
  assert.equal(packet.cmdId, CMD.hello);
  assert.equal(packet.msgType, MSG.reply);
  assert.equal(hex(packet.payload), "00ff775aea670e2007");
  assert.equal(key(packet), key(header(HELLO)));
});

test("请求字节和文档 tx 逐字节一致", () => {
  // 文档 Tier C 的真机 tx：aa 08 0000 06 04 .. 01 00 07（seq 位置文档写作 ..）
  assert.equal(hex(buildSet(CMD.eqSet, eqSetPayload(0x07), 0x00)), "aa080000060400010007");
  // 文档 Tier B 的 ANC 写 payload：16 位小端掩码
  assert.equal(hex(ancSetPayload(ANC.adaptive)), "01010008");
  assert.equal(hex(ancSetPayload(0x0040)), "01014000");
  // 0x010C 的读请求 payload
  assert.equal(hex(countRequest([0x01])), "0101");
  // 文档 Tier A 的查找耳机 payload
  assert.equal(hex(findPayload([0x01])), "0101");
  assert.equal(hex(findPayload([0x02])), "0102");
  assert.equal(hex(findPayload([0x01, 0x02])), "020102");
  // 文档 Tier D 的手势写 payload：右耳 type01 gesture02 -> previous(0x05)
  assert.equal(hex(touchSetPayload({ side: 0x02, type: 0x01, gesture: 0x02 }, 0x05)), "0102010205");
  // 0x0108 读必须发空 payload；0x0106 也是空 payload
  assert.equal(hex(buildRequest(CMD.touch, EMPTY, 0x28)), "aa0700000801280000");
  assert.equal(hex(buildRequest(CMD.battery, EMPTY, 0x25)), "aa0700000601250000");
});

test("电量回包和推送都按 raw & 0x7f 解", () => {
  const rows = decodeBattery(header(BATTERY_REPLY).payload);
  assert.deepEqual(rows, [
    { id: 1, level: 90, charging: false },
    { id: 2, level: 90, charging: false },
  ]);
  assert.deepEqual(decodeBattery(header(BATTERY_PUSH).payload), rows);
  assert.equal(header(BATTERY_PUSH).payload[0], TOPIC.battery);
});

test("电量映射到宿主 component：0 左 / 1 盒 / 2 右，按 component 升序", () => {
  // 左 90、右 90、盒 20（盒的 03 14 是文档里入盒后新出现的条目）
  const rows = batteryRows(bin("00 03 01 5a 02 5a 03 14"));
  assert.deepEqual(rows, [
    { component: 0, level: 90 },
    { component: 1, level: 20 },
    { component: 2, level: 90 },
  ]);
});

test("0x80 是充电位（assumed-gb，Buds 4 没抓到充电样本）", () => {
  // 这一条 payload 来自 oppowin 的单测，不是真机抓包
  assert.deepEqual(decodeBattery(bin("00 01 01 da")), [{ id: 1, level: 90, charging: true }]);
});

test("降噪回包和推送都给同一个 16 位掩码", () => {
  assert.equal(decodeAnc(header(ANC_REPLY).payload), ANC.adaptive);
  assert.equal(decodeAnc(header(ANC_PUSH).payload), ANC.adaptive);
  assert.equal(header(ANC_PUSH).payload[0], TOPIC.anc);
  // 真机切到通透时的读数
  assert.equal(decodeAnc(bin("00 01 01 00 01")), ANC.transparency);
  // 参数被拒的错误形状：02 18 0c 20 xx，不能当成状态
  assert.equal(decodeAnc(bin("02 18 0c 20 01")), null);
});

test("佩戴标志位按 bit0 出盒 / bit1 入耳 / bit2 在位解", () => {
  const rows = decodeWear(header(WEAR_REPLY).payload);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { id: 1, raw: 0x07, outOfCase: true, inEar: true, present: true });
  assert.deepEqual(rows[2], { id: 3, raw: 0x04, outOfCase: false, inEar: false, present: true });
  assert.deepEqual(decodeWear(header(WEAR_PUSH).payload), rows);
  // 拿在手里：出盒但没入耳
  const hand = decodeWear(bin("00 01 01 05"))[0];
  assert.equal(hand.outOfCase, true);
  assert.equal(hand.inEar, false);
});

test("EQ 回包和 0x0504 推送都给出预设号", () => {
  assert.equal(decodeEqPreset(header(EQ_REPLY).payload), 2);
  assert.equal(decodeEqPush(header(EQ_PUSH).payload), 1);
  // 固件会接受表外的值（0x03 / 0x05-0x07），这里如实解出来，让界面回退成数字
  assert.equal(decodeEqPreset(bin("00 07")), 7);
});

test("74 字节手势表能解出 18 条记录", () => {
  assert.equal(TOUCH_PAYLOAD.length, 74);
  assert.equal(TOUCH_PAYLOAD[33], 0x06, "第 33 字节是右耳双击动作，实测写手势时它从 06 变 05");
  const table = decodeTouch(header(TOUCH_REPLY).payload);
  assert.equal(table.records.length, 18);
  const find = (side, type, gesture) =>
    table.records.find((row) => row.side === side && row.type === type && row.gesture === gesture);
  assert.equal(find(0x01, 0x01, 0x02).action, 0x05);
  assert.equal(find(0x02, 0x01, 0x02).action, 0x06);
  assert.equal(find(0x01, 0x06, 0x02).action, 0x1d);
  assert.deepEqual(find(0x02, 0x06, 0x06), { side: 0x02, type: 0x06, gesture: 0x06, action: 0x1c });
});

test("固件是 ASCII 逗号分隔串，原样返回不分组", () => {
  const ascii = new TextEncoder().encode("1,2,138,2,2,138,3,1,01,3,2,105");
  const payload = Uint8Array.from([0x00, 0x04, ...ascii]);
  assert.equal(decodeFirmware(payload), "1,2,138,2,2,138,3,1,01,3,2,105");
});

test("299 字节 payload 的帧，len 是 varint b2 02", () => {
  assert.equal(BIG.length, 309);
  assert.equal(hex(BIG.slice(0, 10)), "aab20200001f81002b01");
  const len = readVarint(BIG, 1);
  assert.equal(len.state, "ok");
  assert.equal(len.value, 306);
  assert.equal(len.size, 2);
  assert.equal(1 + len.size + len.value, 309);
  assert.equal(BIG[8] | (BIG[9] << 8), 299);
});

test("同一帧单字节读法会错帧：0xb2 只算出 180 字节", () => {
  // 这正是 0x011F 曾被记成「不回包」的原因：单字节模型把 309 字节的帧切成 180 字节。
  assert.equal(2 + BIG[1], 180);
  // 用单字节模型读出来的「整帧」长度和真帧对不上，也不可能切出 299 字节 payload
  assert.notEqual(2 + BIG[1], BIG.length);
});

test("粘包：一帧里两个包都出来", () => {
  const packets = createParser()(join(BATTERY_REPLY, ANC_REPLY));
  assert.equal(packets.length, 2);
  assert.equal(packets[0].cmdId, CMD.battery);
  assert.equal(decodeAnc(packets[1].payload), ANC.adaptive);
});

test("半包等齐再出，299 字节大帧按任意切片都能对齐", () => {
  const feed = createParser();
  assert.equal(feed(BIG.slice(0, 40)).length, 0);
  assert.equal(feed(BIG.slice(40, 200)).length, 0);
  const rest = feed(BIG.slice(200));
  assert.equal(rest.length, 1);
  assert.equal(rest[0].payload.length, 299);

  // 大帧 + 推送 + 回包粘在一起，按 7 字节一片喂
  const stream = join(BIG, BATTERY_PUSH, WEAR_REPLY);
  const feed2 = createParser();
  const packets = [];
  for (let at = 0; at < stream.length; at += 7) packets.push(...feed2(stream.slice(at, at + 7)));
  assert.equal(packets.length, 3);
  assert.equal(packets[0].cmdId, 0x1f);
  assert.equal(packets[0].payload.length, 299);
  assert.equal(hex(packets[1].payload), "0102015a025a");
  assert.equal(decodeWear(packets[2].payload)[0].inEar, true);
});

test("坏帧和垃圾字节不卡解析器，后面的好帧照样切出来", () => {
  const broken = BATTERY_REPLY.slice();
  broken[8] ^= 0xff; // plen 谎报，和长度字段对不上
  const feed = createParser();
  assert.equal(feed(broken).length, 0);
  const packets = feed(WEAR_REPLY);
  assert.equal(packets.length, 1);
  assert.equal(decodeWear(packets[0].payload).length, 3);

  // 长度连固定头都装不下：只丢一个字节，接着找下一个 0xAA
  const feed2 = createParser();
  assert.equal(feed2(Uint8Array.from([0xaa, 0x03, 0x00, 0x00])).length, 0);
  assert.equal(feed2(BATTERY_REPLY).length, 1);
});

test("HELLO 尾随的 0x12 不挡住后面的回包", () => {
  const packets = createParser()(join(HELLO, HELLO_REPLY));
  assert.equal(packets.length, 2);
  assert.equal(key(packets[0]), key(packets[1]));
});

test("varint 不自洽时退回单字节 len 读法", () => {
  // 单字节长度 151（高位置 1），按 varint 会读成 0x97 0x00 = 23，plen 立刻对不上
  const payload = new Uint8Array(144);
  payload[0] = 0x5a;
  const single = Uint8Array.from([0xaa, 151, 0x00, 0x00, 0x06, 0x81, 0x25, 144, 0, ...payload]);
  assert.equal(single.length, 153);
  const packets = createParser()(join(single, BATTERY_REPLY));
  assert.equal(packets.length, 2);
  assert.equal(packets[0].cmdId, CMD.battery);
  assert.equal(packets[0].payload.length, 144);
  assert.equal(packets[1].payload.length, 6);
});
