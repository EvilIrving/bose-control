// 导出结果模型：app.js 只负责用 t() 组文案、画 DOM。这句话最容易「看着对、实际错」，
// 所以单独抽出来给单测跑。

// 导出结果只有三种真实结局：文件写好了、文件写好了但没分享出去、彻底失败。
// 不能拿「文件写成功」冒充「导出成功」——用户以为能拿到文件，其实没有。
export function exportResult(info) {
  let data = info;
  if (typeof info === "string") {
    try {
      data = JSON.parse(info);
    } catch {
      data = null;
    }
  }
  if (!data || typeof data !== "object") {
    return { state: "unparsed", path: "", bytes: 0, error: "" };
  }
  const path = typeof data.path === "string" ? data.path : "";
  const bytes = Number(data.bytes ?? 0);
  const error = typeof data.error === "string" ? data.error : "";
  // saved 说了算：老宿主只给 ok，就按 ok 当 saved
  const saved = typeof data.saved === "boolean" ? data.saved : data.ok === true;
  if (!saved) return { state: "failed", path, bytes, error };
  if (data.canceled) return { state: "canceled", path, bytes, error: "" };
  if (error) return { state: "savedButShareFailed", path, bytes, error };
  return { state: "saved", path, bytes, error: "" };
}
