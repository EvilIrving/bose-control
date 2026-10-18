// 下面的每一帧都是 HUAWEI FreeClip 2 真机抓的（macOS + RFCOMM channel 1），
// 我们自己发的请求也逐字节对齐当时耳机接受过的那一包。
import assert from "node:assert/strict";
import test from "node:test";
import { bytes, createParser, crc16, decode, encode, num, readRequest, text } from "../web/spp.js";

const hex = (data) => [...data].map((b) => b.toString(16).padStart(2, "0")).join("");
const bin = (raw) => Uint8Array.from(raw.match(/../g).map((b) => parseInt(b, 16)));

const R = {
  notify: "5a00030001063ebd",
  battery: "5a001b000108010164020364644203030000000402140a0502010006010a7efd",
  info: "5a011500010702020167030e484c3153414b4d325f5665722e4107204861726d6f6e794f5320362e302e302e323536284630303348303033433030290910354650545132363632373030393539360a0f42544654303032372d3030303136370f08425446543030323718254c2d545130373134323635543035373339302c522d5451303731343236364c3036303637371901021b063ac72e79e5c01d06a6eac53301001e06fca79c330100200689f92f79e5c02101011c604d45554349452f6c2b517350566f58594e674f437857685a4862767652326b666e78646f4479517157534e445a742f6a4169454136764836686a4355625435536962447342563148744365533545613456492b41647365385737494e4375513d8f80",
  eq: "5a0014002b4a0101010201010304010a030904010108006af7",
  anc: "5a000a002b2a01020000020105b843",
  voice: "5a0013000c02030b7a682d434e2c656e2d4742040101eea7",
  doubleTap: "5a001a000120010101020101030501020700ff040100050100060200ffb2dd",
  longTap: "5a002a002b170101ff0201ff030f000102030405060708090a0e0f11ff0401ff0501ff060200ff0901000a0100b8b0",
  swipe: "5a000e002b1f01010102010103030001ff8a5c",
  dual: "5a003b002b3102010203010004066203bb1ee95c05010106010407010008010109134163746f72e79a844d6163426f6f6b2050726f0a01010b01000c01009afe",
};

const T = {
  info: "5a004300010700000100020003000400050006000700080009000a000b000c000d000e000f0010001100120013001400150016001700180019001a001b001c001d001e001f008be9",
  battery: "5a0009000108010002000300fbb9",
  autoPause: "5a0005002b110100772a",
  doubleTap: "5a000b0001200100020003000400bde4",
  anc: "5a0007002b2a010002001d33",
  eq: "5a0013002b4a01000200030004000500060007000800e90c",
  ancAware: "5a0007002b04010202ffaabf",
  swipeOff: "5a0009002b1e0101ff0201ff9d9b",
  voiceEn: "5a000d000c010105656e2d4742020101c23a",
  longTap14: "5a0006002b1601010e7f20",
  dualOff: "5a0006002b2e01010037c4",
  quality1: "5a0006002ba2010101b5ef",
  lowLatency: "5a0006002b6c010101a411",
};

test("真机回包的 CRC 都能认", () => {
  for (const [name, raw] of Object.entries(R)) {
    const frame = bin(raw);
    const total = ((frame[1] << 8) | frame[2]) + 5;
    assert.equal(total, frame.length, `${name} 长度字段和实际字节数要一致`);
    assert.equal(hex(new Uint8Array(crc16(frame.subarray(0, total - 2)).toString(16).padStart(4, "0").match(/../g).map((b) => parseInt(b, 16)))), hex(frame.subarray(total - 2)), `${name} CRC`);
  }
});

test("发出去的请求和耳机当场接受过的字节一致", () => {
  assert.equal(hex(readRequest([0x01, 0x07], [...Array(32).keys()])), T.info);
  assert.equal(hex(readRequest([0x01, 0x08], [1, 2, 3])), T.battery);
  assert.equal(hex(readRequest([0x2b, 0x11], [1])), T.autoPause);
  assert.equal(hex(readRequest([0x01, 0x20], [1, 2, 3, 4])), T.doubleTap);
  assert.equal(hex(readRequest([0x2b, 0x2a], [1, 2])), T.anc);
  assert.equal(hex(readRequest([0x2b, 0x4a], [1, 2, 3, 4, 5, 6, 7, 8])), T.eq);
  assert.equal(hex(encode([0x2b, 0x04], [[1, [0x02, 0xff]]])), T.ancAware);
  assert.equal(hex(encode([0x2b, 0x1e], [[1, 0xff], [2, 0xff]])), T.swipeOff);
  assert.equal(hex(encode([0x0c, 0x01], [[1, new TextEncoder().encode("en-GB")], [2, 1]])), T.voiceEn);
  assert.equal(hex(encode([0x2b, 0x16], [[1, 14]])), T.longTap14);
  assert.equal(hex(encode([0x2b, 0x2e], [[1, 0]])), T.dualOff);
  assert.equal(hex(encode([0x2b, 0xa2], [[1, 1]])), T.quality1);
  assert.equal(hex(encode([0x2b, 0x6c], [[1, 1]])), T.lowLatency);
});

test("解析回来的字段和耳机报的一致", () => {
  const info = decode(bin(R.info));
  assert.equal(text(info, 15), "BTFT0027");
  assert.equal(text(info, 10), "BTFT0027-000167");
  assert.equal(text(info, 7), "HarmonyOS 6.0.0.256(F003H003C00)");
  assert.equal(text(info, 9), "5FPTQ26627009596");
  assert.equal(text(info, 3), "HL1SAKM2_Ver.A");
  assert.equal(text(info, 24), "L-TQ0714265T057390,R-TQ0714266L060677");
  const mac = [...bytes(info, 32).slice(0, 6)].reverse();
  assert.equal(hex(mac).toUpperCase(), "C0E5792FF989");

  const battery = decode(bin(R.battery));
  assert.equal(num(battery, 1), 100);
  assert.deepEqual([...bytes(battery, 2)], [100, 100, 66]);

  const eq = decode(bin(R.eq));
  assert.equal(num(eq, 2), 1);
  assert.deepEqual([...bytes(eq, 3)], [1, 10, 3, 9]);

  const anc = decode(bin(R.anc));
  assert.deepEqual([...bytes(anc, 1)], [0, 0]);
  assert.equal(num(anc, 2), 5);

  assert.equal(text(decode(bin(R.voice)), 3), "zh-CN,en-GB");

  const tap = decode(bin(R.doubleTap));
  assert.equal(num(tap, 1), 1);
  assert.deepEqual(
    [...bytes(tap, 3)].map((v) => (v > 127 ? v - 256 : v)),
    [1, 2, 7, 0, -1],
  );

  const long = decode(bin(R.longTap));
  assert.deepEqual(
    [...bytes(long, 3)].map((v) => (v > 127 ? v - 256 : v)),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 15, 17, -1],
  );

  const swipe = decode(bin(R.swipe));
  assert.deepEqual(
    [...bytes(swipe, 3)].map((v) => (v > 127 ? v - 256 : v)),
    [0, 1, -1],
  );

  const dual = decode(bin(R.dual));
  assert.equal(num(dual, 2), 2);
  assert.equal(num(dual, 3), 0);
  assert.equal(hex([...bytes(dual, 4)].reverse()), "5ce91ebb0362");
  assert.equal(num(dual, 5), 1);
  assert.equal(text(dual, 9), "Actor的MacBook Pro");
});

test("分包、粘包、垃圾字节都能对齐", () => {
  const feed = createParser();
  const raw = bin(R.info);
  assert.equal(feed(raw.subarray(0, 3)).length, 0);
  assert.equal(feed(raw.subarray(3, 100)).length, 0);
  const rest = feed(raw.subarray(100));
  assert.equal(rest.length, 1);
  assert.equal(text(rest[0], 15), "BTFT0027");

  const feed2 = createParser();
  const junk = Uint8Array.from([0x00, 0x11, 0x5a, 0x99, ...bin(R.notify), ...bin(R.battery)]);
  const packets = feed2(junk);
  assert.equal(packets.length, 2);
  assert.equal(num(packets[1], 1), 100);

  const feed3 = createParser();
  const broken = bin(R.battery);
  broken[broken.length - 1] ^= 0xff;
  assert.equal(feed3(broken).length, 0);
  assert.equal(feed3(bin(R.notify)).length, 1);
});
