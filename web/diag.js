// 诊断摘要的取值规则抽在这里：app.js 只负责翻译成文案和画 DOM，
// 规则本身可以被单测直接调用（adapter 新 schema、定位状态、导出结果三处最易写错）。

export function btStateKey(env) {
  if (!env) return null; // 宿主没有 env 接口，界面显示「—」
  switch (env.adapter) {
    case "on":
      return "btOn";
    case "off":
      return "btOff";
    case "absent":
      return "btNone";
    default:
      return "btUnknown";
  }
}

export function locationKey(env) {
  const state = env?.perm?.locationService ?? env?.loc;
  if (state === "on" || state === 1) return "btOn";
  if (state === "off" || state === 0) return "btOff";
  return "btUnknown";
}

// 原生导出的回执：成功给路径，失败给原因。解析不了也要有话说，不能空着。
export function exportResultText(info) {
  let data = info;
  if (typeof info === "string") {
    try {
      data = JSON.parse(info);
    } catch {
      data = null;
    }
  }
  if (!data || typeof data !== "object") return { ok: false, text: "导出结果解析失败" };
  if (data.ok) {
    const bytes = Number(data.bytes ?? 0);
    return { ok: true, text: `已导出：${data.path || "?"}（${bytes}B）` };
  }
  return { ok: false, text: `导出失败：${data.error || "未知原因"}` };
}
