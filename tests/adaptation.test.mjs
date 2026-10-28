import assert from "node:assert/strict";
import test from "node:test";
import { createBoseSession } from "../web/bose.js";
import { decodeAll, OP } from "../web/bmap.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

function harness(productId, answers = {}) {
  const sent = [];
  const state = { info: {}, eq: [], battery: [], cfg: {}, modesAll: [] };
  const session = createBoseSession({
    state, ui: {}, refresh() {}, log() {},
    link: {
      name: "Bose", active: true,
      async request(bytes) {
        const p = decodeAll(bytes)[0];
        const key = `${p.fblock}.${p.func}`;
        sent.push(key);
        if (key === "0.3" && productId != null) {
          return { ...p, op: OP.STATUS, payload: Uint8Array.of(productId >> 8, productId & 0xff, 1) };
        }
        if (answers[key]) return { ...p, op: OP.STATUS, payload: answers[key] };
        throw new Error("unsupported");
      },
    },
  });
  return { session, sent, state };
}

test("QC35：不发 eq / 多点 / 自动播放 / 自动接听 / 任何 31.x", async () => {
  const { session, sent } = harness(0x400c);
  await session.load();
  await tick(); await tick();
  // EQ 不等认机型（并行的一条，失败代价接近零），但模式相关的一条都不能发：
  // 那是串行探测，QC35 上多问 8 个槽位就是多等几秒。
  for (const cmd of ["1.10", "1.24", "1.27", "31.2", "31.3", "31.6", "31.8", "31.7"]) {
    assert.ok(!sent.includes(cmd), `QC35 不该请求 ${cmd}`);
  }
  assert.ok(sent.includes("0.1"), "QC35 必须先发探路包 0.1");
  assert.ok(sent.includes("1.6"), "QC35 的消噪要读 1.6 ANR");
});

test("QC35 读到 ANR 后消噪上屏，且不走滑轨", async () => {
  const { session, state } = harness(0x400c, { "1.6": Uint8Array.of(2) });
  await session.load();
  await tick(); await tick();
  assert.equal(state.anr, 2);
  assert.equal(state.cnc, null, "ANR 机型没有连续档位");
  assert.equal(state.cncPath, "anr");
  assert.equal(session.ready(), true);
});

test("QC Ultra 2：照常问 31.x，不发探路包，消噪走 31.10", async () => {
  const { session, sent, state } = harness(0x4082, {
    "31.10": Uint8Array.of(5, 0, 1, 0, 1),
  });
  await session.load();
  await tick(); await tick();
  // 0.1 就是 BMAP 版本查询本身：ultra2 发它是为了版本号，不是探路。
  // 关键是它只发一次，且不发任何 31.x 之外的探路包。
  assert.equal(sent.filter((c) => c === "0.1").length, 1, "版本查询只发一次");
  assert.ok(sent.includes("31.6"), "应该读模式配置");
  assert.ok(sent.includes("1.7"), "应该读 EQ");
  assert.equal(state.hasAudioSettings, true);
  assert.equal(state.profile, "ultra2");
});

test("模式探测并行：8 个槽位总耗时接近一条，不是 8 条相加", async () => {
  const DELAY = 60;
  const state = { info: {}, eq: [], battery: [], cfg: {}, modesAll: [] };
  const session = createBoseSession({
    state, ui: {}, refresh() {}, log() {},
    link: {
      name: "Bose", active: true,
      async request(bytes) {
        const p = decodeAll(bytes)[0];
        const key = `${p.fblock}.${p.func}`;
        await new Promise((r) => setTimeout(r, DELAY));
        if (key === "0.3") return { ...p, op: OP.STATUS, payload: Uint8Array.of(0x40, 0x82, 1) };
        if (key === "31.2") return { ...p, op: OP.STATUS, payload: Uint8Array.of(2, 6, 0, 0, 0, 0x7f, 2) };
        if (key === "31.6") {
          const mode = new Uint8Array(48);
          mode[0] = p.payload[0];
          return { ...p, op: OP.STATUS, payload: mode };
        }
        throw new Error("unsupported");
      },
    },
  });
  const started = Date.now();
  const loading = session.load();
  // 等「模式已经上屏但 load 还没结束」这个中间态：串行实现下 8 个槽位要 8×DELAY，
  // 根本不会在这里出现。
  let sawPartial = false;
  for (let i = 0; i < 40 && !sawPartial; i++) {
    await new Promise((r) => setTimeout(r, 10));
    if (state.modesAll.length > 0) sawPartial = true;
  }
  assert.ok(sawPartial, "模式应在 load 结束前就陆续上屏");
  await loading;
  const elapsed = Date.now() - started;
  assert.ok(elapsed < DELAY * 6, `8 个槽位不该串成 8×${DELAY}ms，实际 ${elapsed}ms`);
});

test("31.10 只读一次：第一批和消噪探测不重复发", async () => {
  const sent = [];
  const state = { info: {}, eq: [], battery: [], cfg: {}, modesAll: [] };
  const session = createBoseSession({
    state, ui: {}, refresh() {}, log() {},
    link: {
      name: "Bose", active: true,
      async request(bytes) {
        const p = decodeAll(bytes)[0];
        const key = `${p.fblock}.${p.func}`;
        sent.push(key);
        if (key === "0.3") return { ...p, op: OP.STATUS, payload: Uint8Array.of(0x40, 0x82, 1) };
        if (key === "31.10") return { ...p, op: OP.STATUS, payload: Uint8Array.of(5, 0, 0, 0, 1) };
        throw new Error("x");
      },
    },
  });
  await session.load();
  assert.equal(sent.filter((c) => c === "31.10").length, 1, "31.10 重复发会让回包互相抢 key");
  assert.equal(state.cncPath, "audioSettings");
});

test("ANR 机型：cncPath 在 refresh 之前定下来，否则 ANR 行会被当成没有消噪隐藏", async () => {
  const state = { info: {}, eq: [], battery: [], cfg: {}, modesAll: [] };
  const seen = [];
  const session = createBoseSession({
    state, ui: {}, log() {},
    refresh() { seen.push(state.cncPath ?? null); },
    link: {
      name: "Bose", active: true,
      async request(bytes) {
        const p = decodeAll(bytes)[0];
        const key = `${p.fblock}.${p.func}`;
        if (key === "0.3") return { ...p, op: OP.STATUS, payload: Uint8Array.of(0x40, 0x0c, 1) };
        if (key === "1.6") return { ...p, op: OP.STATUS, payload: Uint8Array.of(2) };
        throw new Error("x");
      },
    },
  });
  await session.load();
  assert.equal(state.anr, 2);
  assert.equal(state.cncPath, "anr");
  const withAnr = seen.filter((p) => p === "anr");
  assert.ok(withAnr.length > 0, `ANR 读到的每次 refresh 都应已带 anr 路径，实际 ${JSON.stringify(seen)}`);
});

// ---- 诊断报告：用户连不上时，靠它反推机型适配 ----

test("探测报告：区分「明确拒绝」和「没回包」，两者含义完全不同", async () => {
  const state = { info: {}, eq: [], battery: [], cfg: {}, modesAll: [] };
  const session = createBoseSession({
    state, ui: {}, refresh() {}, log() {},
    link: {
      name: "Bose", active: true,
      async request(bytes) {
        const p = decodeAll(bytes)[0];
        const key = `${p.fblock}.${p.func}`;
        if (key === "0.3") return { ...p, op: OP.STATUS, payload: Uint8Array.of(0x40, 0x82, 1) };
        // 1.7 明确拒绝：OpNotSupp
        if (key === "1.7") return { ...p, op: OP.ERROR, payload: Uint8Array.of(5) };
        throw new Error("timeout");
      },
    },
  });
  await session.load();
  const text = session.diagReport();
  assert.match(text, /明确拒绝/, "要能看出哪些是被耳机拒绝的");
  assert.match(text, /均衡=OpNotSupp\(5\)/, `被拒绝的具体是哪条要看得出：\n${text.slice(0, 800)}`);
  assert.match(text, /没有回包/, "超时的要单独列");
  assert.match(text, /机型表/, "要写命中了哪个机型");
});

test("探测报告带原始字节：tx / rx 都是十六进制原文，不改写", async () => {
  const state = { info: {}, eq: [], battery: [], cfg: {}, modesAll: [] };
  const session = createBoseSession({
    state, ui: {}, refresh() {}, log() {},
    link: {
      name: "Bose", active: true,
      async request(bytes) {
        const p = decodeAll(bytes)[0];
        const key = `${p.fblock}.${p.func}`;
        if (key === "0.3") return { ...p, op: OP.STATUS, payload: Uint8Array.of(0x40, 0x82, 1) };
        if (key === "2.2") return { ...p, op: OP.STATUS, payload: Uint8Array.of(0x50, 0, 0, 0) };
        throw new Error("x");
      },
    },
  });
  await session.load();
  const text = session.diagReport();
  // 电量那条请求是 02 02 01 00，回包 50 00 00 00，两个都要原样在报告里
  assert.match(text, /02020100/, `请求字节要留着：\n${text.slice(0, 1200)}`);
  assert.match(text, /50000000/, "回包字节也要留着");
});

test("探测报告能反推 31.6 回包长度，那是字段偏移的依据", async () => {
  const state = { info: {}, eq: [], battery: [], cfg: {}, modesAll: [] };
  const session = createBoseSession({
    state, ui: {}, refresh() {}, log() {},
    link: {
      name: "Bose", active: true,
      async request(bytes) {
        const p = decodeAll(bytes)[0];
        const key = `${p.fblock}.${p.func}`;
        if (key === "0.3") return { ...p, op: OP.STATUS, payload: Uint8Array.of(0x40, 0x75, 1) };
        if (key === "31.2") return { ...p, op: OP.STATUS, payload: Uint8Array.of(2, 2, 0, 0, 0, 0, 0) };
        if (key === "31.6") return { ...p, op: OP.STATUS, payload: new Uint8Array(47) };
        throw new Error("x");
      },
    },
  });
  await session.load();
  const text = session.diagReport();
  assert.match(text, /31\.6 回包长度：47 字节/, `报告要直接写出长度：\n${text.slice(0, 900)}`);
  assert.match(text, /命中机型表 prince/, "0x4075 应该是 prince");
});

test("按机型表跳过的项也记一笔，不能和「问了没回」混为一谈", async () => {
  const state = { info: {}, eq: [], battery: [], cfg: {}, modesAll: [] };
  const session = createBoseSession({
    state, ui: {}, refresh() {}, log() {},
    link: {
      name: "Bose", active: true,
      async request(bytes) {
        const p = decodeAll(bytes)[0];
        const key = `${p.fblock}.${p.func}`;
        if (key === "0.3") return { ...p, op: OP.STATUS, payload: Uint8Array.of(0x40, 0x0c, 1) };
        throw new Error("x");
      },
    },
  });
  await session.load();
  const text = session.diagReport();
  assert.match(text, /skipped/, "QC35 跳过的项要标 skipped");
  assert.match(text, /机型表 qc35 标记跳过/, `跳过的原因要写清：\n${text.slice(0, 900)}`);
});

test("设置页的探测摘要不用导出也能看", async () => {
  const state = { info: {}, eq: [], battery: [], cfg: {}, modesAll: [] };
  const session = createBoseSession({
    state, ui: {}, refresh() {}, log() {},
    link: {
      name: "Bose", active: true,
      async request(bytes) {
        const p = decodeAll(bytes)[0];
        if (`${p.fblock}.${p.func}` === "0.3") return { ...p, op: OP.STATUS, payload: Uint8Array.of(0x40, 0x82, 1) };
        if (`${p.fblock}.${p.func}` === "31.10") return { ...p, op: OP.STATUS, payload: Uint8Array.of(5, 0, 0, 0, 1) };
        throw new Error("x");
      },
    },
  });
  await session.load();
  const rows = session.diagRows();
  assert.ok(rows.some(([k]) => k === "机型"), JSON.stringify(rows));
  assert.ok(rows.some(([k, v]) => k === "探测" && v.includes("通")), JSON.stringify(rows));
  assert.ok(rows.some(([k, v]) => k === "可用" && v.includes("31.10")), JSON.stringify(rows));
});
