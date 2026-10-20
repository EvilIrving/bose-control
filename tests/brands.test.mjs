// 品牌接线：名字归类、按机器挑通道。认错品牌的后果是点了连上一台不响应的耳机，
// 所以这里把两个品牌的名字边界钉住。
import assert from "node:assert/strict";
import test from "node:test";
import { brandById, brandForName, brandList, brandsHere, setBridgeAvailable } from "../web/brands.js";

test("注册表里只有 Bose 和华为", () => {
  assert.deepEqual(
    brandList().map((brand) => brand.id),
    ["bose", "huawei"],
  );
});

test("两个品牌的名字边界", () => {
  assert.equal(brandForName("Bose QuietComfort Ultra Headphones")?.id, "bose");
  assert.equal(brandForName("LE-Bose QC Ultra 2 HP")?.id, "bose");
  assert.equal(brandForName("HUAWEI FreeClip 2")?.id, "huawei");
  assert.equal(brandForName("FreeBuds Pro 4")?.id, "huawei");
  assert.equal(brandForName("FreeClip 2")?.id, "huawei");
});

test("认不出来的名字不硬塞品牌", () => {
  for (const name of ["Keyboard K380", "MX Master 3S", "WH-1000XM5", ""]) {
    assert.equal(brandForName(name), null, name);
  }
});

test("传输方式写死在品牌上：Bose 走 BLE，华为走串口", () => {
  assert.equal(brandById("bose").transport, "ble");
  assert.equal(brandById("huawei").transport, "spp");
});

const setNavigator = (value) => Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });

test("浏览器里只有 Web Bluetooth 时露出 Bose", () => {
  setNavigator({ bluetooth: {} });
  assert.deepEqual(brandsHere().map((brand) => brand.id), ["bose"]);
});

test("有串口桥时露出华为", () => {
  setNavigator({});
  setBridgeAvailable(true);
  assert.deepEqual(brandsHere().map((brand) => brand.id), ["huawei"]);
  setBridgeAvailable(false);
});

test("宿主既没有 BLE 也没有串口桥时什么都不露", () => {
  setNavigator({});
  assert.deepEqual(brandsHere(), []);
});
