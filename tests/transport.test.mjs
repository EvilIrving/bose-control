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
