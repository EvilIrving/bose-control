import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../web/styles.css"),
  "utf8",
);

const rule = (selector) => {
  const found = css.match(new RegExp(`${selector} \\{([^}]*)\\}`));
  assert.ok(found, `缺少规则 ${selector}`);
  return found[1];
};

test("chip 行放不下就横向滑，不换行", () => {
  const row = rule("\\.chips,\\s*\\.levels,\\s*\\.row");
  assert.match(row, /flex-wrap: nowrap/);
  assert.match(row, /overflow-x: auto/);
});

test("整份样式表里没有会换行的 flex 行", () => {
  assert.ok(!/flex-wrap:\s*wrap/.test(css), "还有 flex 行在换行");
});

test("模式行不再靠截断塞进一行", () => {
  assert.ok(!/\.dense/.test(css), "dense 截断规则还在");
  assert.match(rule("#modes \\.chip"), /flex: none/);
});

test("分段控件放不下时也横向滑，按钮不缩到看不见", () => {
  assert.match(css, /\.levels button \{[^}]*flex: 1 0 auto/);
});

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../web/index.html"), "utf8");

// index.html 里哪些容器本来就知道是 chip 行。少一个就等于那一行静默掉出了横向滚动。
// 新加一行不用改这里（下面的检查按 HTML 实际带 class 的容器跑），但这几个必须一直在。
const CHIP_ROWS = [
  "brand",
  "modes",
  "cnc",
  "spatial",
  "sidetone",
  "toggles",
  "transport",
  "lang",
  "favorites",
  "voice",
  "behaviour",
  "standby",
  "headset-actions",
  "diag-actions",
];

// 只匹配「选择器就是 #id」的规则：`#modes .chip` 这种后代规则不管
// chip 行本身的布局，不能误报。#shortcut-title 这类前缀相同的 id 也要排除。
const ownRule = (id) =>
  css.match(new RegExp(`(?:^|[},])\\s*(?:[^{}]*[,\\s]\\s*)?#${id}(?![\\w-])[^{}\\s]*(?:\\s*,[^{}]*)?\\s*\\{([^}]*)\\}`, "m"));

const OVERRIDES = /\b(display|flex-direction|flex-wrap|grid-template[\w-]*|grid-auto[\w-]*|overflow[\w-]*)\s*:/;

test("已知的 chip 行都还挂在 .chips / .levels 上", () => {
  const ids = [...html.matchAll(/<div\b[^>]*>/g)]
    .filter(([tag]) => /class="[^"]*\b(chips|levels)\b/.test(tag))
    .map(([tag]) => (tag.match(/id="([^"]+)"/) || [])[1])
    .filter(Boolean);
  for (const id of CHIP_ROWS) assert.ok(ids.includes(id), `#${id} 掉出了 .chips / .levels`);
});

test("chip 行的布局不被 id 规则改掉", () => {
  const ids = [...html.matchAll(/<div\b[^>]*>/g)]
    .filter(([tag]) => /class="[^"]*\b(chips|levels)\b/.test(tag))
    .map(([tag]) => (tag.match(/id="([^"]+)"/) || [])[1])
    .filter(Boolean);
  for (const id of ids) {
    const own = ownRule(id);
    assert.ok(!own || !OVERRIDES.test(own[1]), `#${id} 被 id 规则改了布局，掉出横向滚动`);
  }
});

test("#shortcut 只是容器，不自己吃样式", () => {
  assert.ok(!ownRule("shortcut"), "又给 #shortcut 加样式了，它会掉出 .chips 的横向滚动");
});
