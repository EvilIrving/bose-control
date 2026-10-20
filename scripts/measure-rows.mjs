// 量一遍所有 chip 行在真实窄屏下会不会溢出。
//   node scripts/measure-rows.mjs [宽 ...]
// 默认量 390（手机）和 1280（桌面），中英各一次。
//
// 为什么不用 `chrome --headless --window-size=390,844`：macOS 上那个窗口会被夹到 500 宽，
// 量出来是桌面分支的布局。这里走 CDP 的 Emulation.setDeviceMetricsOverride 拿真视口。
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "web");
const CHROME =
  process.env.CHROME ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WIDTHS = process.argv.slice(2).map(Number).filter(Boolean);
const sizes = WIDTHS.length ? WIDTHS : [390, 1280];

const FIXTURE = `<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/styles.css"></head><body>
<section id="settings" class="open"></section>
<script type="module">
import * as L from "/labels.js";
import { chips } from "/ui.js";
const zh = L.getLang() === "zh";
const modes = zh
  ? ["消噪", "通透", "沉浸式音频", "自定义模式一", "自定义模式二", "电影", "夜间", "通话"]
  : ["Quiet", "Aware", "Immersive Audio", "Custom Mode One", "Custom Mode Two", "Cinema", "Night", "Call"];
const rows = [
  ["modes", modes.map((label, i) => ({ key: i, label })), 0],
  ["cnc", Array.from({ length: 11 }, (_, i) => ({ key: i, label: String(i) })), 5],
  ["spatial", L.SPATIAL_OPTIONS.map((o, i) => ({ key: i, label: L.pick(o) })), 1],
  ["sidetone", L.SELF_VOICE_OPTIONS.map((o, i) => ({ key: i, label: L.pick(o) })), 2],
  ["toggles", zh ? ["风噪检测", "多点连接", "对话模式"] : ["Wind Block", "Multipoint", "Conversation"].map((label, i) => ({ key: i, label })), -1],
  ["transport", ["prev", "play", "pause", "next"].map((k) => ({ key: k, label: L.t(k) })), -1],
  ["lang", L.LANG_NAMES.map((l) => ({ key: l.id, label: l.native })), 0],
  ["favorites", modes.map((label, i) => ({ key: i, label })), 1],
  ["voice", Object.keys(L.VOICE_LANGUAGES).map((k) => ({ key: k, label: L.voiceLanguageName(Number(k)) })), 0],
  ["behaviour", ["touch", "autoAnswer", "autoPlay"].map((k) => ({ key: k, label: L.t(k) })), -1],
  ["standby", L.STANDBY_OPTIONS.map((o) => ({ key: o.minutes, label: L.pick(o) })), 0],
];
const box = document.getElementById("settings");
for (const [id, items, sel] of rows) {
  const h = document.createElement("h2");
  h.textContent = id;
  const el = document.createElement("div");
  el.id = id;
  el.className = id === "cnc" ? "levels" : "chips";
  box.append(h, el);
  chips(el, items, sel < 0 ? null : sel, () => {});
}
// Bose 的快捷动作：#shortcut 只是容器，chip 行在里面（华为往里放手势组）
const groups = document.createElement("div");
groups.id = "shortcut";
const row = document.createElement("div");
row.className = "chips";
row.id = "shortcut-row";
groups.appendChild(row);
box.append(groups);
chips(row, [-1, 0, 1, 2, 7, 10, 18, 19].map((c) => ({ key: c, label: L.tapActionName(c) })), 0, () => {});
</script></body></html>`;

const MIME = { ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".html": "text/html" };
const server = createServer(async (req, res) => {
  const path = req.url.split("?")[0];
  try {
    const body = path === "/" ? FIXTURE : await readFile(join(WEB, path));
    res.writeHead(200, {
      "content-type": path === "/" ? "text/html" : MIME[path.slice(path.lastIndexOf("."))] ?? "text/plain",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const profile = join(tmpdir(), "bose-measure-rows");
const debugPort = 9223;
const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--disable-extensions",
  "--no-first-run",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  `http://127.0.0.1:${port}/?lang=zh`,
], { stdio: process.env.CHROME_LOG ? "inherit" : "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
for (let i = 0; i < 60 && !page; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    page = targets.find((t) => t.type === "page" && t.url.startsWith("http://127.0.0.1:"));
  } catch {
    /* 还没起来 */
  }
  if (!page) await sleep(250);
}
if (!page) { console.error(await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).text()); throw new Error("Chrome 没起来"); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
await send("Page.enable");
await send("Log.enable");
await send("Runtime.enable");
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Runtime.exceptionThrown") console.error("EXC:", m.params.exceptionDetails.text, m.params.exceptionDetails.exception?.description);
  if (m.method === "Log.entryAdded") console.error("LOG:", m.params.entry.level, m.params.entry.text);
});

const MEASURE = `JSON.stringify([...document.querySelectorAll(".chips, .levels")].map((el) => ({
  id: el.id || "(内层)", view: el.clientWidth, content: el.scrollWidth, kids: el.children.length,
}))`;

const evalRows = async () => {
  for (let i = 0; i < 30; i++) {
    const out = await send("Runtime.evaluate", { expression: MEASURE, returnByValue: true });
    if (typeof out.result?.value === "string") return JSON.parse(out.result.value);
    await sleep(200);
  }
  throw new Error("页面没画出行来");
};

console.log("行".padEnd(12) + sizes.map((w) => `${w}px 溢出`.padEnd(12)).join("") );
for (const lang of ["zh", "en"]) {
  const results = new Map();
  for (const width of sizes) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/?lang=${lang}` });
    await sleep(700);
    const rows = await evalRows();
    for (const r of rows) results.set(r.id, { ...(results.get(r.id) ?? {}), [width]: r.content - r.view });
  }
  console.log(`\n${lang === "zh" ? "中文" : "English"}`);
  for (const [id, byWidth] of results) {
    console.log(id.padEnd(12) + sizes.map((w) => `${byWidth[w]}px`.padEnd(12)).join(""));
  }
}

ws.close();
chrome.kill();
server.close();
process.exit(0);
