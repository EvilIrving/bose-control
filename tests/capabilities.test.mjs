// 平台能力缺口与错误码映射的回归：这两处最容易「看着对、实际错」。
import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = globalThis;

const { missingCapabilities } = await import("../web/brands.js");
const { linkOf } = await import("../web/link.js");

function setNavigator(value) {
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
}

function withGlobals(setup, run) {
  const savedNav = globalThis.navigator;
  try {
    delete globalThis.NativeBLE;
    delete globalThis.webkit;
    setNavigator({});
    setup();
    return run();
  } finally {
    globalThis.NativeBLE = undefined;
    globalThis.webkit = undefined;
    setNavigator(savedNav);
  }
}

test("Android（ble+spp+hub）没有缺口", () => {
  const list = withGlobals(() => {
    globalThis.NativeBLE = {
      platform: () => JSON.stringify({ transports: ["ble", "spp"], hub: true }),
    };
  }, missingCapabilities);
  assert.deepEqual(list, []);
});

test("iOS 只有 bleScan 桥：不能说 BLE 不支持", () => {
  const list = withGlobals(() => {
    globalThis.webkit = { messageHandlers: { bleScan: {}, bleConnect: {}, sendData: {}, bleDisconnect: {} } };
  }, missingCapabilities);
  assert.ok(!list.some((item) => item.startsWith("BLE")), `不该出现 BLE：${list.join(" / ")}`);
  assert.ok(list.some((item) => item.includes("SPP")), "SPP 确实不可用");
  assert.ok(list.some((item) => item.includes("设备中心")), "iOS 没有设备中心");
});

test("纯浏览器：BLE / SPP / 设备中心都算缺口", () => {
  const list = withGlobals(() => {}, missingCapabilities);
  assert.deepEqual(list, ["SPP（系统不开放给第三方）", "BLE", "设备中心（枚举不到系统配对设备）"]);
});

test("服务/写入的原生错误码映射不能变", () => {
  assert.equal(linkOf(new Error("service")), "noproto");
  assert.equal(linkOf(new Error("notify")), "noproto");
  assert.equal(linkOf(new Error("write")), "failed");
  assert.equal(linkOf(new Error("spp")), "failed");
  // 带细节的错误码不在映射表里，必须退回 failed 而不是改写法
  assert.equal(linkOf(new Error("service status=133")), "failed");
});
