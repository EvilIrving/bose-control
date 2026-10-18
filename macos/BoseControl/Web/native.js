export function hasNative() {
  return Boolean(window.NativeBLE || window.webkit?.messageHandlers?.bleScan);
}

export function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex) {
  const s = hex.replace(/[^0-9a-f]/gi, "");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function nativeCall(name, payload) {
  if (window.NativeBLE && typeof window.NativeBLE[name] === "function") {
    if (payload == null) window.NativeBLE[name]();
    else window.NativeBLE[name](payload);
    return;
  }
  const handler = window.webkit?.messageHandlers?.[name];
  if (handler) {
    handler.postMessage(payload ?? {});
    return;
  }
  throw new Error("no native bridge");
}
