// 付款入口。只在原生宿主明确告知「这是商店版」时出现。
//
// 三条硬规则，都来自同一个判断：这个 App 的卖点是「不联网、不要账号」，
// 所以付费这件事不能反过来变成新的打扰。
//
// 1. **免费版完整可用。** 不锁任何功能。¥1 是支持开发，不是解锁。
//    锁功能会把人推回 GitHub 免费下载，对开发者是负收益。
// 2. **入口只出现一次，且可以关掉。** 不弹窗、不拦截、不重复问。
//    用户点掉之后本次运行不再出现。
// 3. **直装版完全不显示。** 由原生编译期决定，页面不自己猜。

const SUPPORT_HINT = "supportHint";

let state = {
  // 原生告知：这个宿主是否走商店（直装版 false）
  store: false,
  // 已购买 / 未购买
  owned: false,
  // 用户这次运行里点掉了提醒
  dismissed: false,
  // 正在购买
  busy: false,
};

// 页面只看这个：要不要画那颗「支持开发」的芯片。
export function shouldShowSupport() {
  return state.store && !state.owned && !state.dismissed;
}

export function purchaseState() {
  return { ...state };
}

// 原生在页面启动时注入一次。直装版不会调用，所以默认 store=false。
// 注意：切到非商店版时**只**清 store，不要动 dismissed。
// dismissed 是「用户主动点掉」的语义，把它当「不在商店里」用，
// 会让一次直装版注入把状态永久卡死，后面再进商店版也永远不显示。
export function setStoreInfo(info) {
  if (!info || typeof info !== "object") return;
  state.store = info.store === true;
  state.owned = info.owned === true;
  if (!state.store) state.busy = false;
}

// 购买回执：原生只回字符串状态，页面负责翻译成人话。
// 不把 Swift 的 Error 直接塞过来，JS 侧不该懂另一个语言的错误类型。
export function applyPurchaseResult(result) {
  state.busy = false;
  const text = typeof result === "string" ? result : "";
  if (text === "purchased") {
    state.owned = true;
    return { ok: true, key: "supportThanks" };
  }
  if (text === "cancelled") return { ok: false, key: "" };
  if (text === "pending") return { ok: false, key: "supportPending" };
  if (text === "missing") return { ok: false, key: "supportUnavailable" };
  if (text === "unsupported") return { ok: false, key: "" };
  if (text.startsWith("failed")) {
    return { ok: false, key: "supportFailed", detail: text.slice(7).trim() };
  }
  return { ok: false, key: "supportFailed", detail: text };
}

export function dismissSupport() {
  state.dismissed = true;
}

// 仅供测试重置：生产代码不应调用。
export function resetSupportState() {
  state = { store: false, owned: false, dismissed: false, busy: false };
}

export function beginPurchase() {
  state.busy = true;
  return { ...state };
}
