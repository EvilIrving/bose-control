import assert from "node:assert/strict";
import test from "node:test";
import { decodeAll, encode, keyOf } from "../web/bmap.js";
import { createBoseCodec } from "../web/bose.js";

globalThis.window = globalThis;
const { HeadsetLink } = await import("../web/transport.js");
const codec = {
  id: "test", reset() {}, chunks: (bytes) => [bytes],
  parse: decodeAll, key: keyOf, header: (bytes) => decodeAll(bytes)[0],
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const ask = (fblock, func) => encode(fblock, func, 1);
const reply = (fblock, func, payload = []) => encode(fblock, func, 3, payload);

function native(auto = true) {
  const sent = [], connects = [], closes = [];
  globalThis.NativeBLE = {
    bleConnect(payload) {
      const wants = JSON.parse(payload);
      connects.push(wants);
      if (auto) window.onNativeConnected('{"name":"test","link":"spp"}', wants.session);
    },
    bleDisconnect(token) { closes.push(token); },
    sendData(payload) { sent.push(JSON.parse(payload)); },
  };
  return { sent, connects, closes };
}
async function harness() {
  const io = native();
  const link = new HeadsetLink(codec);
  await link.connect();
  return { link, ...io };
}

test("不同命令同时发出去，不用等前一条回包", async () => {
  const { link, sent } = await harness();
  const a = link.request(ask(1, 1), 200), b = link.request(ask(1, 2), 200);
  await tick();
  assert.equal(sent.length, 2);
  link.handleNotify(reply(1, 1, [7]));
  link.handleNotify(reply(1, 2, [9]));
  assert.deepEqual([...((await a).payload)], [7]);
  assert.deepEqual([...((await b).payload)], [9]);
  link.dispose();
});

test("同一命令串行，不同命令最多四条在途", async () => {
  const { link, sent } = await harness();
  const jobs = [1, 1, 2, 3, 4, 5].map((f) => link.request(ask(1, f), 200));
  await tick();
  assert.equal(sent.length, 4);
  link.handleNotify(reply(1, 1, [10]));
  await tick();
  assert.equal(sent.length, 5);
  link.handleNotify(reply(1, 1, [11]));
  await tick();
  assert.equal(sent.length, 6);
  for (const f of [2, 3, 4, 5]) link.handleNotify(reply(1, f));
  const packets = await Promise.all(jobs);
  assert.equal(packets[0].payload[0], 10);
  assert.equal(packets[1].payload[0], 11);
  link.dispose();
});

test("超时让出位置，后面的请求继续跑", async () => {
  const { link } = await harness();
  await assert.rejects(link.request(ask(1, 1), 10), /超时/);
  const next = link.request(ask(1, 2), 200);
  await tick();
  link.handleNotify(reply(1, 2, [9]));
  assert.equal((await next).payload[0], 9);
  link.dispose();
});

test("主动断开立即拒绝在途与排队请求，不依赖原生回调", async () => {
  const { link, sent } = await harness();
  const jobs = [1, 2, 3, 4, 5, 6].map((f) => link.request(ask(1, f), 200));
  const done = Promise.allSettled(jobs);
  await tick();
  link.disconnect();
  assert.ok((await done).every((r) => r.status === "rejected"));
  await link.connect();
  sent.length = 0;
  const next = link.request(ask(1, 9), 200);
  await tick();
  assert.deepEqual(sent.map((p) => p.hex), ["01090100"]);
  link.handleNotify(reply(1, 9, [9]));
  await next;
  link.dispose();
});

test("断开后旧请求结算不能扩大下一轮并发窗口", async () => {
  const { link, sent } = await harness();
  const first = [1, 2, 3, 4].map((f) => link.request(ask(1, f), 200));
  const settled = Promise.allSettled(first);
  link.rejectAll(new Error("断开"));
  await settled;
  await tick();
  sent.length = 0;
  const second = [5, 6, 7, 8, 9].map((f) => link.request(ask(1, f), 200));
  const ended = Promise.allSettled(second);
  await tick();
  const count = sent.length;
  link.disconnect();
  await ended;
  assert.equal(count, 4);
});

test("写失败的等待项不能吞掉下一次同命令回包", async () => {
  const { link } = await harness();
  const write = link.write.bind(link);
  link.write = async () => { throw new Error("写失败"); };
  await assert.rejects(link.request(ask(1, 1), 100), /写失败/);
  link.write = write;
  const next = link.request(ask(1, 1), 100);
  await tick();
  link.handleNotify(reply(1, 1, [42]));
  assert.deepEqual([...((await next).payload)], [42]);
  link.dispose();
});

test("构造第二个实例不抢原生回调，显式连接才交接", async () => {
  const { connects, closes } = native(false);
  const a = new HeadsetLink(codec);
  const connecting = a.connect();
  const b = new HeadsetLink(codec);
  window.onNativeConnected('{"name":"A","link":"spp"}', connects[0].session);
  await connecting;
  assert.equal(a.name, "A");
  assert.equal(b.connected, false);
  const second = b.connect();
  assert.equal(a.connected, false);
  window.onNativeConnected('{"name":"B","link":"spp"}', connects[1].session);
  await second;
  const count = closes.length;
  a.dispose();
  assert.equal(closes.length, count);
  assert.equal(b.name, "B");
  b.dispose();
});

test("交接取消旧连接等待，旧连接回调不影响新会话", async () => {
  const { connects } = native(false);
  const a = new HeadsetLink(codec), b = new HeadsetLink(codec);
  const first = a.connect();
  const cancelled = assert.rejects(first, { code: "cancelled" });
  const second = b.connect();
  await cancelled;
  window.onNativeConnected('{"name":"old","link":"spp"}', connects[0].session);
  assert.equal(b.connected, false);
  window.onNativeConnected('{"name":"new","link":"spp"}', connects[1].session);
  await second;
  window.onNativeDisconnected(connects[0].session);
  window.onNativeError("lost", connects[0].session);
  assert.equal(b.connected, true);
  b.dispose();
});

test("旧会话接口失效，旧数据不能认领新会话请求", async () => {
  const { link, connects, sent } = await harness();
  const old = link.scope();
  await link.connect();
  await assert.rejects(old.request(ask(1, 1)), { code: "cancelled" });
  await assert.rejects(old.write(ask(1, 1)), { code: "cancelled" });
  assert.equal(sent.length, 0);
  const packet = link.request(ask(1, 1), 200);
  await tick();
  window.onDataReceived("010103012a", connects[0].session);
  window.onDataReceived("010103012b", connects[1].session);
  assert.equal((await packet).payload[0], 43);
  link.dispose();
});

test("连接带上目标、服务和唯一连接标识", async () => {
  const { connects } = native();
  const link = new HeadsetLink(codec);
  await link.connect({ address: "target", transport: "spp", channels: [2, 8], services: ["service"] });
  assert.deepEqual(connects[0], { session: connects[0].session, address: "target", transport: "spp", channels: [2, 8], services: ["service"] });
  assert.ok(connects[0].session);
  link.dispose();
});

test("交互请求在下一个空位先于后台探测发送", async () => {
  const { link, sent } = await harness();
  const jobs = [1, 2, 3, 4, 5].map((f) => link.request(ask(1, f), 200));
  jobs.push(link.request(ask(1, 9), 200, { priority: 1 }));
  const done = Promise.allSettled(jobs);
  await tick();
  link.handleNotify(reply(1, 1));
  await tick();
  assert.equal(sent[4].hex, "01090100");
  link.disconnect();
  await done;
});

test("华为发送间隔在实际写入处执行，排队不消耗回包超时", async () => {
  const times = [];
  native();
  globalThis.NativeBLE.sendData = (payload) => {
    const { session, hex } = JSON.parse(payload);
    times.push(Date.now());
    const bytes = Uint8Array.from(hex.match(/../g).map((b) => parseInt(b, 16)));
    const p = decodeAll(bytes)[0];
    queueMicrotask(() => window.onDataReceived([...reply(p.fblock, p.func, [1])].map(b => b.toString(16).padStart(2, "0")).join(""), session));
  };
  const link = new HeadsetLink({ ...codec, gapMs: 25 });
  await link.connect();
  const result = await Promise.all([1, 2, 3, 4].map(f => link.request(ask(1, f), 15)));
  assert.equal(result.length, 4);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 24);
  link.dispose();
});

test("取消等待后旧连接定时器不能关闭新 owner", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { connects, closes } = native(false);
  const a = new HeadsetLink(codec), b = new HeadsetLink(codec);
  const first = a.connect();
  const rejected = assert.rejects(first, { code: "cancelled" });
  const next = b.connect();
  window.onNativeConnected({ name: "B", link: "spp" }, connects[1].session);
  await Promise.all([rejected, next]);
  const count = closes.length;
  t.mock.timers.tick(30001);
  assert.equal(closes.length, count);
  assert.equal(b.connected, true);
  b.dispose();
});

test("Bose SPP 在任意切分下保留半包和粘包", () => {
  const a = reply(2, 2, [60, 0]), b = reply(1, 7, [1, 2, 3]);
  const bytes = Uint8Array.from([...a, ...b]);
  for (let cut = 1; cut < bytes.length; cut++) {
    const c = createBoseCodec();
    const packets = [...c.parse(bytes.slice(0, cut), "spp"), ...c.parse(bytes.slice(cut), "spp")];
    assert.equal(packets.length, 2, `cut=${cut}`);
    assert.deepEqual([...packets[0].payload], [60, 0]);
    assert.deepEqual([...packets[1].payload], [1, 2, 3]);
  }
});
