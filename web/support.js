// 付款入口。只在原生宿主明确告知「这是商店版」时出现。
// 文案跟 ASC 一样叫永久会员，不写支持/捐赠。
// 买断文案可以关掉，恢复购买不能关。直装版完全不显示，由原生编译期决定。

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

// 页面只看这个：要不要画永久会员入口。
export function shouldShowSupport() {
  return state.store && !state.owned && !state.dismissed;
}

// 卸载重装后本地收据可能还没到。点掉买断提醒之后，恢复购买仍要能找到。
export function shouldShowRestore() {
  return state.store && !state.owned;
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
  if (text === "notfound") return { ok: false, key: "supportRestoreEmpty" };
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
