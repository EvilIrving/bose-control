// 示意图按形态挑：头戴式 / 耳塞 / 充电仓。图形是 Tabler Icons 内联的，这里只钉住挑选规则和
// 「左右耳不是同一张图」这件事。
import assert from "node:assert/strict";
import test from "node:test";
import { artSvg, formFactor, slotPlan } from "../web/art.js";

test("名字能区分头戴式和耳塞", () => {
  const cases = {
    "Bose QuietComfort Ultra 2 HP": "overear",
    "Bose QC45": "overear",
    "Bose NC 700": "overear",
    "Bose SoundLink Max": "overear",
    "Sony WH-1000XM5": "overear",
    "Bose QuietComfort Ultra Earbuds": "buds",
    "HUAWEI FreeClip 2": "buds",
    "HUAWEI FreeBuds Pro 4": "buds",
    "OPPO Enco X3": "buds",
    "OnePlus Buds 4": "buds",
    "vivo TWS 3e": "buds",
    "iQOO TWS 1e": "buds",
  };
  for (const [name, kind] of Object.entries(cases)) {
    assert.equal(formFactor(name), kind, name);
  }
});

test("认不出来按耳塞画，不猜头戴式", () => {
  assert.equal(formFactor(""), "buds");
  assert.equal(formFactor("Unknown Headset"), "buds");
});

test("左右耳用同一张图里分开的两只，各自裁到自己的边界", () => {
  const left = artSvg("buds", { side: "left" });
  const right = artSvg("buds", { side: "right" });
  assert.notEqual(left, right);
  assert.match(left, /viewBox="0 2 11 20"/);
  assert.match(right, /viewBox="13 2 11 20"/);
  // 两只都只带一条 path，不是把整副耳机塞进一格
  assert.equal((left.match(/<path /g) ?? []).length, 1);
  assert.equal((right.match(/<path /g) ?? []).length, 1);
});

test("一副耳塞就是原图里那两只，不裁", () => {
  const pair = artSvg("pair");
  assert.match(pair, /viewBox="0 0 24 24"/);
  assert.equal((pair.match(/<path /g) ?? []).length, 2);
  assert.notEqual(pair, artSvg("bud", { side: "left" }));
  assert.notEqual(pair, artSvg("bud", { side: "right" }));
});

test("只有一条读数时画一副，不冒充某一只耳朵", () => {
  // 华为只报一个全局电量时，宿主拿到的是 [{component:0}]，不能标成 L
  assert.deepEqual(slotPlan("buds", [{ component: 0, level: 64 }]), [{ art: "pair", level: 64 }]);
  // 左右都有才分开画
  assert.deepEqual(slotPlan("buds", [{ component: 0, level: 85 }, { component: 2, level: 94 }]), [
    { art: "bud", side: "left", label: "L", level: 85 },
    { art: "bud", side: "right", label: "R", level: 94 },
  ]);
  // 有盒子就只画一个仓，三段电量写在仓下面
  assert.deepEqual(slotPlan("buds", [{ component: 0, level: 85 }, { component: 1, level: 20 }, { component: 2, level: 94 }]), [
    {
      art: "case",
      parts: [
        { label: "L", level: 85 },
        { label: "R", level: 94 },
        { label: "C", level: 20 },
      ],
    },
  ]);
  // 只有盒子读数
  assert.deepEqual(slotPlan("buds", [{ component: 1, level: 20 }]), [{ art: "case", parts: [{ label: "C", level: 20 }] }]);
  // 头戴式永远是一只耳机，不拆左右
  assert.deepEqual(slotPlan("overear", [{ component: 0, level: 88 }]), [{ art: "overear", level: 88 }]);
});

test("头戴式和充电仓各是自己的图形", () => {
  const over = artSvg("overear");
  const box = artSvg("case");
  assert.match(over, /viewBox="0 0 24 24"/);
  assert.match(box, /viewBox="0 0 24 24"/);
  assert.notEqual(over, box);
  assert.equal((over.match(/<path /g) ?? []).length, 3);
  assert.equal((box.match(/<path /g) ?? []).length, 3);
});
