// 传输层是启动快慢的总闸门：同一条命令只能一条在途（回包按 fblock.func 配对），
// 不同命令必须能一起飞，否则一次启动的几十次读取就只能一路排队。
import assert from "node:assert/strict";
import test from "node:test";
import { decodeAll, encode, keyOf } from "../web/bmap.js";

globalThis.window = globalThis;

const codec = {
  id: "test",
  reset() {},
  chunks: (bytes) => [bytes],
  parse: (chunk) => decodeAll(chunk),
  key: (packet) => keyOf(packet),
  header: (bytes) => decodeAll(bytes)[0],
};

const { HeadsetLink } = await import("../web/transport.js");

function reply(fblock, func, payload = []) {
  return Uint8Array.from([fblock, func, 3, payload.length, ...payload]);
}

function harness() {
  const sent = [];
  globalThis.NativeBLE = {
    sendData(hex) {
      sent.push(hex);
    },
  };
  const link = new HeadsetLink(codec);
  link.nativeOn = true;
  return { link, sent };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const ask = (fblock, func) => encode(fblock, func, 1);

test("不同命令同时发出去，不用等前一条回包", async () => {
  const { link, sent } = harness();
  const a = link.request(ask(1, 1), 200);
  const b = link.request(ask(1, 2), 200);
  await tick();
  assert.equal(sent.length, 2, "两条命令都应该已经写出去");
  link.handleNotify(reply(1, 1, [7]));
  link.handleNotify(reply(1, 2, [9]));
  assert.deepEqual([...((await a).payload)], [7]);
  assert.deepEqual([...((await b).payload)], [9]);
});

test("同一条命令一次只飞一条，回包按顺序配对", async () => {
  const { link, sent } = harness();
  const first = link.request(ask(1, 5), 200);
  const second = link.request(ask(1, 5), 200);
  await tick();
  assert.equal(sent.length, 1, "第二条同命令要等第一条回来");
  link.handleNotify(reply(1, 5, [1]));
  await tick();
  assert.equal(sent.length, 2);
  link.handleNotify(reply(1, 5, [2]));
  assert.deepEqual([...((await first).payload)], [1]);
  assert.deepEqual([...((await second).payload)], [2]);
});

test("同时在途的请求有上限，回包后继续放行", async () => {
  const { link, sent } = harness();
  const jobs = [1, 2, 3, 4, 5].map((func) => link.request(ask(1, func), 200));
  await tick();
  assert.equal(sent.length, 4, "第 5 条要等有空位");
  link.handleNotify(reply(1, 1, []));
  await tick();
  assert.equal(sent.length, 5);
  for (const func of [2, 3, 4, 5]) link.handleNotify(reply(1, func, []));
  await Promise.all(jobs);
});

test("超时的请求让出位置，后面的继续跑", async () => {
  const { link, sent } = harness();
  const slow = link.request(ask(1, 1), 30);
  await tick();
  assert.equal(sent.length, 1);
  await assert.rejects(slow, /超时/);
  const next = link.request(ask(1, 2), 200);
  await tick();
  assert.equal(sent.length, 2);
  link.handleNotify(reply(1, 2, []));
  await next;
});

test("断开时排队中的请求一起失败，不会留下悬着的 Promise", async () => {
  const { link } = harness();
  const busy = [1, 2, 3, 4].map((func) => link.request(ask(1, func), 500));
  const queued = link.request(ask(1, 9), 500);
  await tick();
  link.rejectAll(new Error("蓝牙已断开"));
  await assert.rejects(queued, /蓝牙已断开/);
  for (const job of busy) await assert.rejects(job, /蓝牙已断开/);
});

// WKWebView 里 window.webkit 一定存在，早先按这个判成「老桥」，退回无参的 bleScan，
// 带过去的设备和串口就丢了：设备中心里明明连着，点进去却报「没找到耳机」。
test("WKWebView 里连接带上设备和串口，不走无参的 bleScan", async () => {
  const calls = [];
  globalThis.window = globalThis;
  globalThis.NativeBLE = {
    bleScan: () => calls.push({ name: "bleScan" }),
    bleConnect: (payload) => calls.push({ name: "bleConnect", payload }),
    sendData() {},
    bleDisconnect() {},
  };
  globalThis.webkit = { messageHandlers: { bleScan: { postMessage() {} } } };
  try {
    const link = new HeadsetLink(codec);
    const connecting = link.connect({
      address: "c0-e5-79-2f-f9-89",
      transport: "spp",
      channels: [1, 2, 3],
      services: ["0000079a-d102-11e1-9b23-00025b00a5a5"],
    });
    assert.equal(calls.length, 1, "只该发一条连接请求");
    assert.equal(calls[0].name, "bleConnect");
    const wants = JSON.parse(calls[0].payload);
    assert.equal(wants.address, "c0-e5-79-2f-f9-89");
    assert.equal(wants.transport, "spp");
    assert.deepEqual(wants.channels, [1, 2, 3]);
    // 品牌私有控制服务的 UUID 要传到原生端，由它去 SDP 里取端口号
    assert.deepEqual(wants.services, ["0000079a-d102-11e1-9b23-00025b00a5a5"]);
    window.onNativeConnected('{"name":"HUAWEI FreeClip 2","link":"spp"}');
    await connecting;
    assert.equal(link.connected, true);
  } finally {
    delete globalThis.NativeBLE;
    delete globalThis.webkit;
  }
});

// 界面上的「已连接」必须跟着 App 自己的会话走。原生端在开始连新设备时会先把旧通道断掉，
// 但不会补一条 onNativeDisconnected；JS 这边要是留着上一台的 nativeOn 和设备名，
// 就会「卡片写着已连接、标题还是上一台，其实什么也没连着」。
test("换设备时先清掉上一台的连接状态和名字", async () => {
  globalThis.window = globalThis;
  globalThis.NativeBLE = { bleConnect() {}, sendData() {}, bleDisconnect() {} };
  try {
    const link = new HeadsetLink(codec);
    const first = link.connect({ address: "c0-e5-79-2f-f9-89", transport: "spp" });
    window.onNativeConnected('{"name":"HUAWEI FreeClip 2","link":"spp"}');
    await first;
    assert.equal(link.connected, true);
    assert.equal(link.name, "HUAWEI FreeClip 2");

    const second = link.connect({ address: "68-f2-1f-0d-94-89", transport: "spp" });
    assert.equal(link.connected, false, "新一次连接开始时不能沿用上一台的连接状态");
    assert.equal(link.name, "", "标题不能先显示上一台的名字");
    // 连不上就直说连不上，别让按钮一直挂着「断开连接」
    window.onNativeError("spp");
    await assert.rejects(second);
    assert.equal(link.connected, false, "连接失败之后不能说已连接");
  } finally {
    delete globalThis.NativeBLE;
  }
});
