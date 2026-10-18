// 没在真机上验证过的品牌（vivo / OPPO 家族）默认整个关掉：它们的命令表来自第三方逆向，
// 连得上不代表能用，接错一帧可能把耳机写成别的状态。要用得自己开：
//   · 设置页「未验证的品牌」里打开，或
//   · 地址后面加 ?unverified=1（开发者快路径），?unverified=0 关回去
// 开关记在 localStorage，不联网、不上报。
const KEY = "headset.unverified";
const UNVERIFIED = new Set(["vivo", "oppo"]);

function fromUrl() {
  try {
    const value = new URLSearchParams(globalThis.location?.search ?? "").get("unverified");
    if (value === "1") return true;
    if (value === "0") return false;
  } catch {
    /* 没有 location 的宿主（测试）按存储值走 */
  }
  return null;
}

function fromStorage() {
  try {
    return globalThis.localStorage?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let on = fromUrl() ?? fromStorage();

export function unverifiedOn() {
  return on;
}

export function setUnverified(value) {
  on = Boolean(value);
  try {
    globalThis.localStorage?.setItem(KEY, on ? "1" : "0");
  } catch {
    /* 忽略写入失败，本次会话仍按内存值走 */
  }
}

export function isUnverified(brandId) {
  return UNVERIFIED.has(brandId);
}
