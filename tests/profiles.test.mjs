// 机型表和电量文案：这两处「看着对、实际错」的代价最高——电量标错人不会发现，
// 机型表选错整块功能消失。
import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = globalThis;

const { profileFor, profileById, supports, DEFAULT_PROFILE } = await import("../web/profiles.js");
const { setLang } = await import("../web/labels.js");
const { batteryText } = await import("../web/link.js");

test("产品 ID 落到正确的机型表", () => {
  assert.equal(profileFor(0x4082).id, "ultra2", "QC Ultra 2 HP");
  assert.equal(profileFor(0x4062).id, "ultra2-earbuds", "QC Ultra 2 Earbuds");
  assert.equal(profileFor(0x4075).id, "prince", "QC Headphones");
  assert.equal(profileFor(0x4039).id, "prince", "QC45");
  assert.equal(profileFor(0x400c).id, "qc35", "QC35");
  assert.equal(profileFor(0x4020).id, "qc35", "QC35 II");
  assert.equal(profileFor(0x402f).id, "qc-earbuds", "QC Earbuds");
  assert.equal(profileFor(0x4068).id, "ultra-open", "Ultra Open");
});

test("没见过的产品 ID 回退到最全能力，不是空白", () => {
  const unknown = profileFor(0x1234);
  assert.equal(unknown.id, "default");
  assert.equal(unknown.modeConfig, DEFAULT_PROFILE.modeConfig);
  assert.equal(supports(unknown, "modes"), true, "回退机型必须照常问模式");
  assert.equal(profileFor(0).id, "default", "还没读到产品 ID 时也用回退");
});

test("QC35 不该发的命令都标了 skip", () => {
  const qc35 = profileById("qc35");
  for (const feature of ["eq", "multipoint", "autoPlay", "autoAnswer", "modes"]) {
    assert.equal(supports(qc35, feature), false, `QC35 不该请求 ${feature}`);
  }
  assert.equal(supports(qc35, "audioSettings"), false);
});

test("QC35 的消噪走 ANR，QC Earbuds 走直写，ultra2 走 31.10", () => {
  assert.deepEqual(profileById("qc35").cnc, ["anr"]);
  assert.deepEqual(profileById("qc-earbuds").cnc, ["cncDirect"]);
  assert.equal(profileById("qc-earbuds").cncDirectSetget, true);
  assert.deepEqual(profileById("ultra2").cnc, ["audioSettings", "cncDirect"]);
  assert.deepEqual(profileById("ultra-open").cnc, [], "开放式没有消噪");
});

test("anc 位只在真有这个位的机型上存在", () => {
  assert.equal(profileById("ultra2").ancToggle, true);
  assert.equal(profileById("prince").ancToggle, false);
  assert.equal(profileById("prince").modeWrite, 39);
  assert.equal(profileById("qc35").ancToggle, false);
});

test("需要探路包的机型只有 QC35 / QC45", () => {
  assert.deepEqual(profileById("qc35").init, [0x00, 0x01]);
  assert.deepEqual(profileById("prince").init, [0x00, 0x01]);
  assert.equal(profileById("ultra2").init, null);
});

test("电量文案：组件号 → 部件名，多段按右/左/盒排", () => {
  setLang("zh");
  const rows = [
    { level: 59, component: 3 },
    { level: 96, component: 1 },
    { level: 100, component: 2 },
  ];
  assert.equal(batteryText(rows), "右 96% · 左 100% · 盒 59%");
  assert.equal(batteryText([{ level: 60, component: 0 }]), "60%");

  setLang("en");
  assert.equal(
    batteryText([{ level: 96, component: 1 }, { level: 100, component: 2 }, { level: 59, component: 3 }]),
    "R 96% · L 100% · Case 59%",
  );
  setLang("zh");
});

test("左右单读数都在时不重复报合并读数", () => {
  setLang("zh");
  const both = [
    { level: 96, component: 1 },
    { level: 100, component: 2 },
    { level: 60, component: 4 },
  ];
  assert.equal(batteryText(both), "右 96% · 左 100%");
});
