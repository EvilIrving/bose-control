// 未验证品牌的开关：默认关、记得住、开发时能用地址参数临时打开。
import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
};

const { setUnverified, unverifiedOn, isUnverified } = await import("../web/experimental.js");

test("默认是关的", () => {
  assert.equal(unverifiedOn(), false);
});

test("打开后写进本地存储，关掉也写", () => {
  setUnverified(true);
  assert.equal(unverifiedOn(), true);
  assert.equal(globalThis.localStorage.getItem("headset.unverified"), "1");
  setUnverified(false);
  assert.equal(unverifiedOn(), false);
  assert.equal(globalThis.localStorage.getItem("headset.unverified"), "0");
});

test("地址参数 ?unverified=1 直接打开，?unverified=0 关回去", async () => {
  globalThis.location = { search: "?unverified=1" };
  const forced = await import("../web/experimental.js?url=on");
  assert.equal(forced.unverifiedOn(), true);
  globalThis.location = { search: "?unverified=0" };
  const off = await import("../web/experimental.js?url=off");
  assert.equal(off.unverifiedOn(), false);
  delete globalThis.location;
});

test("只有 vivo / OPPO 属于未验证品牌", () => {
  assert.equal(isUnverified("vivo"), true);
  assert.equal(isUnverified("oppo"), true);
  assert.equal(isUnverified("bose"), false);
  assert.equal(isUnverified("huawei"), false);
});
