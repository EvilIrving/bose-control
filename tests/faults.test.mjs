// 第二单元：故障注入。每个用例都用真实页面模块跑，断言「能从事件字段判断卡在哪一步」，
// 不拿行数当结论。
import assert from "node:assert/strict";
import test from "node:test";
import { encode } from "../web/bmap.js";

globalThis.window = globalThis;

const { logSnapshot } = await import("../web/log.js");
const { HeadsetLink } = await import("../web/transport.js");

const ask = (fblock, func) => encode(fblock, func, 1);
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// 截页面事件：log.js 会调 NativeBLE.diagLog
function collect() {
  const events = [];
  globalThis.NativeBLE = { diagLog: (json) => events.push(JSON.parse(json)) };
  return events;
}

function codec(parse = (bytes) => [{ byteLength: bytes.length, key: "k" }]) {
  return {
    id: "test",
    reset() {},
    chunks: (bytes) => [bytes],
    parse,
    key: () => "k",
    header: () => new Uint8Array([1]),
  };
}

function native() {
  const sent = [];
  globalThis.NativeBLE = {
    ...(globalThis.NativeBLE ?? {}),
    diagLog: globalThis.NativeBLE?.diagLog,
    bleConnect(payload) {
      const wants = JSON.parse(payload);
      window.onNativeConnected('{"name":"test","link":"spp"}', wants.session);
    },
    bleDisconnect() {},
    sendData(payload) {
      sent.push(JSON.parse(payload));
    },
  };
  return sent;
}

test("G 无回包超时：事件里有 key、上限、实际耗时，并标明期间收到几帧", async () => {
  const events = collect();
  native();
  const link = new HeadsetLink(codec());
  await link.connect();
  const result = link.request(ask(1, 2), 60);
  await assert.rejects(result, /超时/);
  const timeout = events.find((e) => e.event === "request-timeout");
  assert.ok(timeout, `没有 request-timeout：${JSON.stringify(events.slice(-3))}`);
  assert.equal(timeout.level, "error");
  assert.match(timeout.detail, /key=.* limit=60ms elapsed=\d+ms framesSinceRequest=0/);
});

test("G 收到无关包：记成 unexpected-packet，而不是悄悄丢掉", async () => {
  const events = collect();
  native();
  const link = new HeadsetLink(codec());
  await link.connect();
  link.handleNotify(new Uint8Array([1, 2, 3]));
  const unexpected = events.find((e) => e.event === "unexpected-packet");
  assert.ok(unexpected, JSON.stringify(events.slice(-2)));
  assert.equal(unexpected.level, "warn");
  assert.match(unexpected.detail, /没有等待项/);
});

test("G 解析抛错：原始字节与 stack 都留下", async () => {
  const events = collect();
  native();
  const link = new HeadsetLink(codec(() => {
    throw new Error("坏帧");
  }));
  await link.connect();
  assert.throws(() => link.handleNotify(new Uint8Array([0xde, 0xad])), /坏帧/);
  const raw = events.find((e) => e.detail?.includes("raw #"));
  const bad = events.find((e) => e.event === "err" && e.detail.includes("parse 抛错"));
  assert.ok(raw && raw.detail.includes("dead"), JSON.stringify(raw));
  assert.ok(bad && bad.detail.includes("坏帧"));
});

test("G 写失败：报 write 失败并带原始消息", async () => {
  const events = collect();
  globalThis.NativeBLE = {
    ...globalThis.NativeBLE,
    bleConnect(payload) {
      window.onNativeConnected('{"name":"test","link":"spp"}', JSON.parse(payload).session);
    },
    bleDisconnect() {},
    sendData() {
      throw new Error("socket closed");
    },
  };
  const link = new HeadsetLink(codec());
  await link.connect();
  await assert.rejects(link.request(ask(1, 3), 200), /socket closed/);
  const failed = events.find((e) => e.event === "request-failed" || e.detail?.includes("写失败"));
  assert.ok(failed, JSON.stringify(events.slice(-3)));
  assert.match(failed.detail, /socket closed/);
});

test("D 连接失败：原始错误与映射后的代码同时留", async () => {
  const events = collect();
  globalThis.NativeBLE = {
    ...globalThis.NativeBLE,
    bleConnect(payload) {
      const token = JSON.parse(payload).session;
      setTimeout(() => window.onNativeError("没有找到耳机", token), 0);
    },
    bleDisconnect() {},
    sendData() {},
  };
  const link = new HeadsetLink(codec());
  await assert.rejects(link.connect(), /没有找到耳机/);
  const nat = events.find((e) => e.stage === "B" && /error/.test(e.detail ?? ""));
  assert.ok(nat, JSON.stringify(events));
  assert.match(nat.detail, /没有找到耳机/);
});

test("H 远端断开：事件里能看出是设备端断的", async () => {
  const events = collect();
  const sent = native();
  const link = new HeadsetLink(codec());
  let disconnected = false;
  link.onDisconnected = () => {
    disconnected = true;
  };
  await link.connect();
  globalThis.NativeBLE.bleDisconnect();
  window.onNativeDisconnected(link._token);
  await tick();
  assert.equal(disconnected, true);
  const nat = events.find((e) => e.stage === "B" && e.detail?.includes("disconnected"));
  assert.ok(nat, JSON.stringify(events.slice(-4)));
  assert.equal(sent.length, 0);
});
