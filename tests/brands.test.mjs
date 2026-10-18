// 品牌接线：名字归类、按机器挑通道。认错品牌的后果是点了连上一台不响应的耳机，
// 所以这里把四个品牌的名字边界钉住。
import assert from "node:assert/strict";
import test from "node:test";
import { brandById, brandForName, brandList, brandsHere, setBridgeAvailable, transportFor } from "../web/brands.js";
import { setUnverified, unverifiedOn } from "../web/experimental.js";

test("四个品牌都在注册表里", () => {
  assert.deepEqual(
    brandList().map((brand) => brand.id),
    ["bose", "huawei", "oppo", "vivo"],
  );
});

test("华为和 Bose 一直认得出；vivo / OPPO 默认认都不认", () => {
  assert.equal(unverifiedOn(), false, "默认必须是关的");
  assert.equal(brandForName("Bose QuietComfort Ultra Headphones")?.id, "bose");
  assert.equal(brandForName("LE-Bose QC Ultra 2 HP")?.id, "bose");
  assert.equal(brandForName("HUAWEI FreeClip 2")?.id, "huawei");
  assert.equal(brandForName("FreeBuds Pro 4")?.id, "huawei");
  for (const name of ["OPPO Enco X3", "OnePlus Buds 4", "realme Buds Air 6", "vivo TWS 3e", "iQOO TWS 1e"]) {
    assert.equal(brandForName(name), null, name);
  }
});

test("打开未验证品牌开关后，vivo / OPPO 才归得上", () => {
  setUnverified(true);
  const cases = {
    "OPPO Enco X3": "oppo",
    "OnePlus Buds 4": "oppo",
    "realme Buds Air 6": "oppo",
    "vivo TWS 3e": "vivo",
    "vivo TWS 5 Pro": "vivo",
    "iQOO TWS 1e": "vivo",
  };
  for (const [name, id] of Object.entries(cases)) {
    assert.equal(brandForName(name)?.id, id, name);
  }
  // 华为的名字不能被 vivo / OPPO 抢走
  assert.equal(brandForName("HUAWEI FreeClip 2")?.id, "huawei");
  setUnverified(false);
});

test("认不出来的名字不硬塞品牌", () => {
  for (const name of ["Keyboard K380", "MX Master 3S", "WH-1000XM5", ""]) {
    assert.equal(brandForName(name), null, name);
  }
});

test("vivo 的 GATT 只在浏览器里当备用通道；OPPO 只有串口", () => {
  assert.equal(transportFor(brandById("vivo")), "spp");
  assert.equal(brandById("vivo").alt, "ble");
  assert.equal(brandById("oppo").alt, undefined);
  // 串口端口号不写死：两个品牌都是按 SDP 里的服务 UUID 找
  assert.ok(brandById("vivo").services[0].startsWith("00000837"));
  assert.ok(brandById("oppo").services.includes("0000079a-d102-11e1-9b23-00025b00a5a5"));
});

const setNavigator = (value) => Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });

test("浏览器里有 Web Bluetooth 时，默认只露 Bose；开了开关才多一个 vivo 的 GATT", () => {
  setNavigator({ bluetooth: {} });
  assert.deepEqual(brandsHere().map((brand) => brand.id), ["bose"]);
  setUnverified(true);
  assert.deepEqual(brandsHere().map((brand) => brand.id), ["bose", "vivo"]);
  // 串口桥不在，vivo 就只能走 GATT
  assert.equal(transportFor(brandById("vivo")), "ble");
  // 手机端的原生 BLE 通道只为 Bose 写死，vivo 的 GATT 不能当成原生通道用
  globalThis.NativeBLE = { platform: () => JSON.stringify({ transports: ["ble"], hub: false }) };
  assert.deepEqual(brandsHere().map((brand) => brand.id), ["bose"]);
  delete globalThis.NativeBLE;
  setUnverified(false);
});

test("有串口桥时默认只多一个华为；开了开关才把 OPPO / vivo 放出来", () => {
  setNavigator({});
  setBridgeAvailable(true);
  assert.deepEqual(brandsHere().map((brand) => brand.id), ["huawei"]);
  setUnverified(true);
  assert.deepEqual(brandsHere().map((brand) => brand.id), ["huawei", "oppo", "vivo"]);
  // 串口桥在，vivo 优先走串口
  assert.equal(transportFor(brandById("vivo")), "spp");
  setUnverified(false);
  setBridgeAvailable(false);
});
