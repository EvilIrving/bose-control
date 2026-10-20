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
  assert.match(rule("\\.levels button"), /flex: 1 0 auto/);
});
