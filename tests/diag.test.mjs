// 诊断摘要取值与导出回执：这两块都是「看着对、实际错」的高危点，用真函数跑。
import assert from "node:assert/strict";
import test from "node:test";

const { btStateKey, exportResult, locationKey } = await import("../web/diag.js");

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

test("导出结果：文件写好了", () => {
  const result = exportResult({ ok: true, saved: true, path: "/sdcard/x.txt", bytes: 1234, error: "" });
  assert.equal(result.state, "saved");
  assert.equal(result.path, "/sdcard/x.txt");
  assert.equal(result.bytes, 1234);
});

test("导出结果：文件写好了但分享失败，不能算成功", () => {
  const result = exportResult({
    ok: false,
    saved: true,
    path: "/sdcard/x.txt",
    bytes: 99,
    error: "android.content.ActivityNotFoundException: no activity",
  });
  assert.equal(result.state, "savedButShareFailed");
  assert.ok(result.error.includes("ActivityNotFound"), result.error);
  assert.equal(result.bytes, 99);
});

test("导出结果：彻底失败", () => {
  const result = exportResult(JSON.stringify({ ok: false, saved: false, error: "java.io.IOException: 只读" }));
  assert.equal(result.state, "failed");
  assert.ok(result.error.includes("只读"));
});

test("导出结果：解析不了也要有状态", () => {
  for (const bad of ["not json", "", null, undefined, 42]) {
    assert.equal(exportResult(bad).state, "unparsed");
  }
});
