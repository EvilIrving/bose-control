import assert from "node:assert/strict";
import test from "node:test";
import { createBoseSession } from "../web/bose.js";
import { decodeAll, OP } from "../web/bmap.js";
import { HuaweiHeadset } from "../web/huawei.js";
import { decode, encode } from "../web/spp.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("Bose EQ 已回时即可使用，不等慢模式与设置；完整探测保留", async () => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const sent = [];
  const state = { info: {}, eq: [], battery: [], cfg: {}, modesAll: [] };
  let refreshes = 0;
  const session = createBoseSession({
    state, ui: {}, refresh: () => { refreshes++; }, log() {},
    link: {
      name: "Bose", active: true,
      async request(bytes) {
        const packet = decodeAll(bytes)[0];
        sent.push(`${packet.fblock}.${packet.func}`);
        if (packet.fblock === 1 && packet.func === 7) {
          return { ...packet, op: OP.STATUS, payload: Uint8Array.of(0xf6, 10, 0, 1) };
        }
        await wait;
        throw new Error("unsupported");
      },
    },
  });
  let finished = false;
  const loading = session.load().then((result) => { finished = true; return result; });
  await tick();
  assert.equal(finished, false);
  assert.equal(session.ready(), true);
  assert.equal(state.eq[0].current, 0);
  assert.ok(refreshes > 0);
  release();
  assert.equal(await loading, true);
  await tick();
  for (const command of ["1.11", "1.3", "1.9", "5.3", "31.2", "31.6"]) {
    assert.ok(sent.includes(command), `original capability still probed: ${command}`);
  }
  // 「已配对设备」不再显示，也不再读耳机自己的配对表
  assert.ok(!sent.includes("4.4"), "device list 不该再被请求");
});

test("华为 EQ 已回时即可使用，不等语音和音质偏好", async () => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const state = { info: {}, battery: [] };
  const session = new HuaweiHeadset({
    state, ui: {}, refresh() {}, log() {},
    link: {
      name: "HUAWEI", active: true,
      async request(bytes) {
        const packet = decode(bytes);
        if (packet.cmd[0] === 0x2b && packet.cmd[1] === 0x4a) {
          return decode(encode([0x2b, 0x4a], [[2, 0], [3, [0, 1]]]));
        }
        await wait;
        throw new Error("unsupported");
      },
    },
  });
  let finished = false;
  const loading = session.load().then((result) => { finished = true; return result; });
  await tick();
  assert.equal(finished, false);
  assert.equal(session.ready(), true);
  assert.deepEqual(session.eq.presets, [0, 1]);
  session.link.active = false;
  release();
  await loading;
});
