// 页面日志：稳定事件送原生落盘（JSONL），断桥时退到内存 + console，并标明「未持久化」。
// 界面不再展示日志，设置页只有「导出诊断」。
const MAX_LINES = 2000;

const lines = [];
let persisted = false; // 原生桥接过一次就算持久化可用
let bridgeDown = false;
let attemptId = null;

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function nativeDiag() {
  const api = globalThis.NativeBLE;
  if (api && typeof api.diagLog === "function") return (json) => api.diagLog(json);
  const handler = globalThis.webkit?.messageHandlers?.diagLog;
  if (handler) return (json) => handler.postMessage(json);
  return null;
}

function keepInMemory(line) {
  lines.push(line);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

// scope → 故障矩阵阶段：app/hub/conn 属于 D/C，tx/rx 属于 G，nat 属于 B/E/F，err 属于 I
const STAGE_BY_SCOPE = {
  app: "A",
  hub: "C",
  conn: "D",
  tx: "G",
  rx: "G",
  nat: "B",
  err: "I",
};

export function setAttempt(id) {
  attemptId = id || null;
}

export function logLine(scope, message, extra = {}) {
  const line = `${stamp()} ${String(scope).padEnd(4)} ${message}`;
  keepInMemory(line);

  const send = nativeDiag();
  if (!send) {
    bridgeDown = true;
    // 没有桥就别指望原生落盘，至少 console 里有
    console.debug(line);
    return line;
  }
  const event = {
    stage: extra.stage ?? STAGE_BY_SCOPE[scope] ?? "I",
    event: extra.event ?? scope,
    level: extra.level ?? (scope === "err" ? "error" : "info"),
    detail: message,
    attemptId: extra.attemptId ?? attemptId ?? undefined,
    scope,
  };
  try {
    send(JSON.stringify(event));
    persisted = true;
    bridgeDown = false;
  } catch (error) {
    // 记录失败本身不能再走同一条桥，否则递归
    bridgeDown = true;
    persisted = false;
    console.debug(`${line}（落盘失败：${error.message}）`);
  }
  return line;
}

export function logCount() {
  return lines.length;
}

// 导出时的「当前状态快照」：不重复整份日志，历史由原生从文件读
export function logSnapshot() {
  return {
    persisted,
    bridgeDown,
    memoryLines: lines.length,
    recent: lines.slice(-20),
  };
}
