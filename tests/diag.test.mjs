// 诊断摘要取值与导出回执：这两块都是「看着对、实际错」的高危点，用真函数跑。
import assert from "node:assert/strict";
import test from "node:test";

const { btStateKey, exportResultText, locationKey } = await import("../web/diag.js");

test("蓝牙状态按新 schema 分 on / off / absent / 未知", () => {
  assert.equal(btStateKey({ adapter: "on" }), "btOn");
  assert.equal(btStateKey({ adapter: "off" }), "btOff");
  assert.equal(btStateKey({ adapter: "absent" }), "btNone");
  assert.equal(btStateKey({ adapter: "weird" }), "btUnknown");
  assert.equal(btStateKey({}), "btUnknown");
  assert.equal(btStateKey(null), null, "宿主没有 env 时界面显示破折号");
});

test("定位状态读 perm.locationService，缺字段不冒充关闭", () => {
  assert.equal(locationKey({ perm: { locationService: "on" } }), "btOn");
  assert.equal(locationKey({ perm: { locationService: "off" } }), "btOff");
  assert.equal(locationKey({ perm: { locationService: "unknown" } }), "btUnknown");
  assert.equal(locationKey({ perm: {} }), "btUnknown");
  assert.equal(locationKey({}), "btUnknown");
});

test("导出回执：成功给路径与字节数", () => {
  const result = exportResultText({ ok: true, path: "/sdcard/x.txt", bytes: 1234 });
  assert.equal(result.ok, true);
  assert.ok(result.text.includes("/sdcard/x.txt"));
  assert.ok(result.text.includes("1234B"));
});

test("导出回执：失败给原因，字符串形式也认", () => {
  const fromString = exportResultText(JSON.stringify({ ok: false, error: "java.io.IOException: 只读" }));
  assert.equal(fromString.ok, false);
  assert.ok(fromString.text.includes("只读"), fromString.text);
});

test("导出回执：解析不了也要有话说", () => {
  for (const bad of ["not json", "", null, undefined, 42]) {
    const result = exportResultText(bad);
    assert.equal(result.ok, false);
    assert.ok(result.text.length > 0);
  }
});
