// 品牌词标：设备中心卡片第二行用它替代品牌文字，四个品牌一个都不能少。
// 顺便钉住两条底线：颜色一律走 currentColor（深色底上随文字渲染）、
// 图形只做装饰（语义在宿主的 aria-label 里）。
import assert from "node:assert/strict";
import test from "node:test";
import { brandLogoSvg } from "../web/logos.js";

const BRANDS = ["bose", "huawei", "vivo", "oppo"];

test("四个品牌的词标都拿得到，而且带 viewBox", () => {
  for (const id of BRANDS) {
    const svg = brandLogoSvg(id);
    assert.ok(svg, `${id} 的词标没了`);
    assert.match(svg, /^<svg [^>]*viewBox="0 0 [\d. ]+"/, `${id} 缺 viewBox`);
  }
});

test("词标不夹带颜色，统一随 currentColor 渲染", () => {
  for (const id of BRANDS) {
    const svg = brandLogoSvg(id);
    assert.match(svg, /fill="currentColor"/, `${id} 没挂 currentColor`);
    assert.doesNotMatch(svg, /#[0-9a-fA-F]{3,8}/, `${id} 里写死了颜色`);
    assert.doesNotMatch(svg, /style=|rgb\(|hsl\(/, `${id} 里有内联样式`);
  }
});

test("没登记的品牌返回 null，宿主退回文字", () => {
  assert.equal(brandLogoSvg("sony"), null);
  assert.equal(brandLogoSvg(undefined), null);
});

test("词标是装饰，对读屏隐藏", () => {
  for (const id of BRANDS) {
    assert.match(brandLogoSvg(id), /aria-hidden="true"/, `${id} 没对读屏隐藏`);
  }
});
