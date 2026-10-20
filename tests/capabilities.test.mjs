// 平台能力缺口与错误码映射的回归：这两处最容易「看着对、实际错」。
import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = globalThis;

const { missingCapabilities, platformInfo } = await import("../web/brands.js");
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
  assert.ok(list.some((item) => item === "SPP（iOS 不开放给第三方）"), `SPP 原因要写清：${list.join(" / ")}`);
  assert.ok(list.some((item) => item.includes("设备中心")), "iOS 没有设备中心");
});

test("浏览器 + 本机串口桥：SPP 与设备中心都算可用", async () => {
  const brands = await import("../web/brands.js");
  const list = withGlobals(() => {
    globalThis.navigator = { bluetooth: {} };
    brands.setBridgeAvailable(true);
  }, missingCapabilities);
  brands.setBridgeAvailable(false);
  assert.deepEqual(list, []);
});

test("纯浏览器：BLE / SPP / 设备中心都算缺口", () => {
  const list = withGlobals(() => {}, missingCapabilities);
  assert.deepEqual(list, ["SPP", "BLE", "设备中心（枚举不到系统配对设备）"]);
});

test("服务/写入的原生错误码映射不能变", () => {
  assert.equal(linkOf(new Error("service")), "noproto");
  assert.equal(linkOf(new Error("notify")), "noproto");
  assert.equal(linkOf(new Error("write")), "failed");
  assert.equal(linkOf(new Error("spp")), "failed");
  // 带细节的错误码不在映射表里，必须退回 failed 而不是改写法
  assert.equal(linkOf(new Error("service status=133")), "failed");
});

test("Android 上 platform() 不给能力时，按桥方法兜底（真机事故回归）", () => {
  const list = withGlobals(() => {
    globalThis.NativeBLE = {
      env: () => JSON.stringify({ adapter: "on" }),
      listDevices: () => {},
      bleConnect: () => {},
      bleScan: () => {},
      sendData: () => {},
      bleDisconnect: () => {},
    };
  }, () => {
    const caps = platformInfo();
    return { caps, missing: missingCapabilities() };
  });
  assert.equal(list.caps.hub, true, "有 listDevices 就必须认为有设备中心");
  assert.deepEqual(list.caps.transports, ["ble", "spp"]);
  assert.deepEqual(list.missing, [], `不该报缺口：${list.missing.join(" / ")}`);
});

test("platform() 抛错时也不能丢掉设备中心", () => {
  const caps = withGlobals(() => {
    globalThis.NativeBLE = {
      platform: () => {
        throw new Error("Java exception was raised");
      },
      listDevices: () => {},
      bleConnect: () => {},
      sendData: () => {},
    };
  }, platformInfo);
  assert.equal(caps.hub, true);
  assert.ok(caps.transports.includes("ble"));
});
