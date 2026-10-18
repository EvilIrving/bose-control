// 全流程日志：页面里每一步都往这里写一行，出问题就点设置页「导出诊断」把整段拿走。
// 界面上不再堆日志行——那里只留一个「导出」按钮。
const MAX_LINES = 3000;

const lines = [];

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

// scope 用固定几个短词，导出后能直接 grep：app / hub / conn / tx / rx / nat / err
export function logLine(scope, message) {
  const line = `${stamp()} ${String(scope).padEnd(4)} ${message}`;
  lines.push(line);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  console.debug(line);
  return line;
}

export function logCount() {
  return lines.length;
}

export function logText(header = []) {
  return [...header, "", `---- 日志 ${lines.length} 行 ----`, ...lines].join("\n");
}
