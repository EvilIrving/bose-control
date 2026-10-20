// 日志链路本身的回归：容量、收包原始字节、解析抛错时的证据保留。
import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = globalThis;
const { logCount, logLine, logSnapshot } = await import("../web/log.js");

// transport 里 logLine 走 console.debug，测试期间截下来看内容
function capture(fn) {
  const seen = [];
  const original = console.debug;
  console.debug = (line) => seen.push(String(line));
  try {
    fn();
  } finally {
    console.debug = original;
  }
  return seen;
}

test("页面日志有内存上限，超出从最早的丢", () => {
  for (let i = 0; i < 2400; i += 1) logLine("test", `第 ${i} 行`);
  assert.equal(logCount(), 2000);
  const snap = logSnapshot();
  assert.equal(snap.memoryLines, 2000);
  assert.ok(snap.recent.some((line) => line.includes("第 2399 行")), "最新的还在");
  assert.ok(!snap.recent.some((line) => line.includes("第 0 行")), "最早的已经丢掉");
});

test("没有原生桥时标记为未持久化，并且不递归", () => {
  const saved = globalThis.NativeBLE;
  const savedDebug = console.debug;
  globalThis.NativeBLE = undefined;
  let printed = 0;
  console.debug = () => { printed += 1; };
  try {
    logLine("app", "断桥一行");
    const snap = logSnapshot();
    assert.equal(snap.persisted, false);
    assert.equal(snap.bridgeDown, true);
    assert.ok(printed >= 1, "断桥时退到 console");
  } finally {
    globalThis.NativeBLE = saved;
    console.debug = savedDebug;
  }
});

test("原生桥接住事件时标记为已持久化", () => {
  const saved = globalThis.NativeBLE;
  const seen = [];
  globalThis.NativeBLE = { diagLog: (json) => seen.push(JSON.parse(json)) };
  try {
    logLine("conn", "连接开始", { attemptId: "s-1", event: "connect-start" });
    const snap = logSnapshot();
    assert.equal(snap.persisted, true);
    const event = seen.at(-1);
    assert.equal(event.stage, "D");
    assert.equal(event.attemptId, "s-1");
    assert.equal(event.event, "connect-start");
    assert.equal(event.source, undefined, "source 由原生补");
  } finally {
    globalThis.NativeBLE = saved;
  }
});

test("收包先落原始字节：80 字节完整留着，不截断", async () => {
  const { HeadsetLink } = await import("../web/transport.js");
  const codec = {
    id: "test", reset() {}, chunks: (b) => [b],
    parse: () => [], key: () => "k", header: () => new Uint8Array([1]),
  };
  const link = new HeadsetLink(codec);
  const chunk = new Uint8Array(80).map((_, i) => i & 0xff);
  const lines = capture(() => link.handleNotify(chunk));
  const raw = lines.find((l) => l.includes("raw #"));
  assert.ok(raw, `要有 raw 行：${lines.join(" | ")}`);
  const hex = raw.split("B ")[1];
  assert.equal(hex.length, 160, "80 字节 = 160 个 hex 字符，全部保留");
  assert.ok(!hex.includes("…"), "不能截断");
});

test("长包按 128 字节切片，拼回去等于原始流", async () => {
  const { HeadsetLink } = await import("../web/transport.js");
  const codec = {
    id: "test", reset() {}, chunks: (b) => [b],
    parse: () => [], key: () => "k", header: () => new Uint8Array([1]),
  };
  const link = new HeadsetLink(codec);
  const chunk = new Uint8Array(200).map((_, i) => (i * 7) & 0xff);
  const lines = capture(() => link.handleNotify(chunk));
  const raw = lines.filter((l) => l.includes("raw #"));
  assert.equal(raw.length, 2, `200B 应切两片：${raw.join(" | ")}`);
  const joined = raw.map((l) => l.split("B ")[1]).join("");
  const expected = Array.from(chunk).map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(joined, expected, "两片拼起来必须等于原始字节");
  assert.ok(raw[0].includes("0-128/200B"), raw[0]);
  assert.ok(raw[1].includes("128-200/200B"), raw[1]);
});

test("解析抛错：原始包先记下，异常重新抛出，不变成超时", async () => {
  const { HeadsetLink } = await import("../web/transport.js");
  const codec = {
    id: "test", reset() {}, chunks: (b) => [b],
    parse: () => {
      throw new Error("坏帧");
    },
    key: () => "k", header: () => new Uint8Array([1]),
  };
  const link = new HeadsetLink(codec);
  const lines = [];
  const original = console.debug;
  console.debug = (line) => lines.push(String(line));
  try {
    assert.throws(() => link.handleNotify(new Uint8Array([0xde, 0xad, 0xbe, 0xef])), /坏帧/);
  } finally {
    console.debug = original;
  }
  assert.ok(lines.some((l) => l.includes("raw #1 0-4/4B deadbeef")), lines.join(" | "));
  const failure = lines.find((l) => l.includes("parse 抛错"));
  assert.ok(failure, "异常要有一条");
  assert.ok(failure.includes("坏帧"), failure);
});
