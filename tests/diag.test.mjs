// 导出回执：成功/失败的分冶是「看着对、实际错」的高危点，用真函数跑。
import assert from "node:assert/strict";
import test from "node:test";

const { exportResult } = await import("../web/diag.js");

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

test("导出结果：用户取消分享，文件在但不算成功", () => {
  const result = exportResult({ ok: false, saved: true, canceled: true, path: "/sdcard/x.txt", bytes: 88 });
  assert.equal(result.state, "canceled");
  assert.equal(result.bytes, 88);
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
