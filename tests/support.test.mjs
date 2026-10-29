// 付费入口的行为边界：直装版不出现购买按钮，失败后不能卡在加载态。
import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = globalThis;

const {
  applyPurchaseResult,
  beginPurchase,
  dismissSupport,
  purchaseState,
  resetSupportState,
  setStoreInfo,
  shouldShowRestore,
  shouldShowSupport,
} = await import("../web/support.js");

// 每个用例都从干净状态开始：dismissed 是「用户点掉」，不能被上一个用例污染
const reset = () => resetSupportState();

test("直装版永远不显示购买入口", () => {
  reset();
  assert.equal(shouldShowSupport(), false);
  // 直装版就算硬塞 owned=false 也不该冒出来
  setStoreInfo({ store: false, owned: false });
  assert.equal(shouldShowSupport(), false);
  reset();
});

test("商店版未购买才显示；已购买不显示", () => {
  setStoreInfo({ store: true, owned: false });
  assert.equal(shouldShowSupport(), true, "商店版未购买应能看到入口");
  setStoreInfo({ store: true, owned: true });
  assert.equal(shouldShowSupport(), false, "已购买不该再问");
  reset();
});

test("用户点掉之后本次运行不再出现，且不算失败", () => {
  setStoreInfo({ store: true, owned: false });
  assert.equal(shouldShowSupport(), true);
  dismissSupport();
  assert.equal(shouldShowSupport(), false);
  reset();
});

test("购买成功即隐藏入口", () => {
  setStoreInfo({ store: true, owned: false });
  beginPurchase();
  assert.equal(purchaseState().busy, true);
  const outcome = applyPurchaseResult("purchased");
  assert.equal(outcome.ok, true);
  assert.equal(outcome.key, "supportThanks");
  assert.equal(shouldShowSupport(), false);
  assert.equal(purchaseState().busy, false, "失败或成功后都必须退出加载态");
  reset();
});

test("用户取消不是错误，不给提示也不卡住", () => {
  setStoreInfo({ store: true, owned: false });
  beginPurchase();
  const outcome = applyPurchaseResult("cancelled");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.key, "", "取消不该弹任何提示");
  assert.equal(purchaseState().busy, false);
  assert.equal(shouldShowSupport(), true, "取消后入口还在，用户可以再来");
  reset();
});

test("失败要退出加载态并说清原因", () => {
  setStoreInfo({ store: true, owned: false });
  beginPurchase();
  const outcome = applyPurchaseResult("failed: network unavailable");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.key, "supportFailed");
  assert.match(outcome.detail, /network unavailable/);
  assert.equal(purchaseState().busy, false);
  reset();
});

test("产品没配好 / 待批准各有各的说法，不混成一个失败", () => {
  setStoreInfo({ store: true, owned: false });
  assert.equal(applyPurchaseResult("missing").key, "supportUnavailable");
  assert.equal(applyPurchaseResult("pending").key, "supportPending");
  reset();
});

test("不认识的返回值当失败处理，不能静默成功", () => {
  setStoreInfo({ store: true, owned: false });
  const outcome = applyPurchaseResult("something-new");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.key, "supportFailed");
  assert.equal(shouldShowSupport(), true, "失败不该永久关掉入口");
  reset();
});

test("卸载重装后即使点掉买断，恢复购买仍在", () => {
  setStoreInfo({ store: true, owned: false });
  assert.equal(shouldShowRestore(), true);
  dismissSupport();
  assert.equal(shouldShowSupport(), false, "点掉之后不再推销");
  assert.equal(shouldShowRestore(), true, "收据没回来时恢复入口必须还在");
  reset();
});

test("恢复成功跟购买成功同一条路：owned，入口关掉", () => {
  setStoreInfo({ store: true, owned: false });
  beginPurchase();
  const outcome = applyPurchaseResult("purchased");
  assert.equal(outcome.ok, true);
  assert.equal(purchaseState().owned, true);
  assert.equal(shouldShowRestore(), false);
  assert.equal(shouldShowSupport(), false);
  reset();
});

test("恢复时这个 Apple ID 没买过，要说找不到，不能装成取消", () => {
  setStoreInfo({ store: true, owned: false });
  beginPurchase();
  const outcome = applyPurchaseResult("notfound");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.key, "supportRestoreEmpty");
  assert.equal(purchaseState().owned, false);
  assert.equal(purchaseState().busy, false);
  assert.equal(shouldShowRestore(), true);
  reset();
});

test("直装版不显示恢复购买", () => {
  setStoreInfo({ store: false, owned: false });
  assert.equal(shouldShowRestore(), false);
  reset();
});

test("connect() 不读购买状态", async () => {
  const src = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../web/app.js", import.meta.url), "utf8")
  );
  const start = src.indexOf("async function connect");
  const end = src.indexOf("\nfunction disconnect");
  assert.ok(start >= 0 && end > start, "找不到 connect()");
  assert.doesNotMatch(
    src.slice(start, end),
    /shouldShowSupport|beginPurchase|membershipLocked|iapStatus|nativeCall\("purchase/,
    "connect() 里不能出现付费判断"
  );
});

test("support 模块不导出功能开关", async () => {
  const mod = await import("../web/support.js");
  const exported = Object.keys(mod);
  for (const name of exported) {
    assert.doesNotMatch(name, /^(is|can|has)[A-Z]/, `${name} 看起来像功能开关`);
  }
});
