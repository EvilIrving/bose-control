// 能力探测报告：把「这台耳机到底支持什么」变成可导出的证据。
//
// 目的不是记日志，是让远程拿到文件的人能据此写机型适配：
//   - 每条命令发了什么字节、回了什么字节（十六进制原文）
//   - 回包解码出的关键字段（不是「ok」，是实际值）
//   - 结论：有 / 没有 / 报错（带 BMAP 错误码）
//   - 最后由这些结论推出「这台耳机该走哪条路」
//
// 三件事必须做到，否则报告没用：
//   1. 原始字节不截断 —— 适配靠字节，不靠描述
//   2. 区分「没回」和「回了错误」—— 前者可能是超时，后者是明确的「不支持」
//   3. 结论要能反推机型表 —— 没有结论的报告等于让人自己猜

import { bmapErrorName, keyOf } from "./bmap.js";

const MAX_BYTES = 4096;

export function toHex(bytes) {
  if (!bytes) return "";
  const view = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  return [...view].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 一条命令的探测结果。
// verdict:
//   ok       回了 STATUS/RESULT，解析出了值
//   empty    回了但解析不出值（命令在，但格式不是我们认得的那种）
//   error    回了 ERROR，code 是 BMAP 错误码（5 = OpNotSupp 最常见）
//   timeout  没有回包
//   skipped  按机型表跳过，没发
export function createProbeReport() {
  const entries = [];
  const startedAt = Date.now();

  function record({ label, packet, reply, verdict, detail, errorCode, elapsed, transport }) {
    const head = packet ? packet.slice(0, 4) : null;
    const entry = {
      label,
      key: head ? null : null,
      transport: transport ?? null,
      tx: toHex(packet).slice(0, MAX_BYTES * 2),
      rx: reply ? toHex(reply).slice(0, MAX_BYTES * 2) : "",
      txBytes: packet ? packet.length : 0,
      rxBytes: reply ? reply.length : 0,
      verdict,
      detail: detail ?? "",
      errorCode: errorCode ?? null,
      errorName: errorCode == null ? null : bmapErrorName(errorCode),
      elapsed: elapsed ?? null,
    };
    entries.push(entry);
    return entry;
  }

  return {
    record,
    entries,
    startedAt,
    // 按 verdict 统计：报告开头先给规模，读的人一眼知道是「几乎全哑」还是「只差几项」
    get summary() {
      const counts = { ok: 0, empty: 0, error: 0, timeout: 0, skipped: 0 };
      for (const entry of entries) counts[entry.verdict] = (counts[entry.verdict] ?? 0) + 1;
      return counts;
    },
  };
}

// 从探测结果反推这台耳机该走哪条路。
// 这不是猜：每一条都直接对应报告里的一个 verdict。
export function inferCapabilities(entries) {
  const find = (label) => entries.find((entry) => entry.label === label);
  const ok = (label) => find(label)?.verdict === "ok";
  const error = (label) => find(label)?.verdict === "error";
  // 按命令地址判，不按标签名：标签是中文且会改，地址是协议定义的。
  // key 从 tx 前两字节读：fblock, func。
  const keyOfEntry = (entry) => (entry.tx ? `${parseInt(entry.tx.slice(0, 2), 16)}.${parseInt(entry.tx.slice(2, 4), 16)}` : null);
  const replied = (key) => entries.some((entry) => keyOfEntry(entry) === key && entry.verdict !== "timeout" && entry.verdict !== "skipped");
  // 明确回了数据（不是 ERROR）才算「有这个能力」
  const usable = (key) => entries.some((entry) => keyOfEntry(entry) === key && entry.verdict === "ok");

  const modeEntries = entries.filter((entry) => /^m\d+$/.test(entry.label) && entry.verdict === "ok");
  const lengths = [...new Set(modeEntries.map((entry) => entry.rxBytes))].sort((a, b) => a - b);

  return {
    // 31.x 有任一可用就说明 AudioModes 块在（QC Earbuds 一代以后）
    hasAudioModes: usable("31.3") || usable("31.2") || usable("31.6") || modeEntries.length > 0,
    // 消噪三条路：回 ERROR 也算「有这条命令」，只是不支持该操作；
    // 但「有这个功能」必须是回了数据。
    hasAudioSettings: usable("31.10"),
    hasCncDirect: usable("1.5"),
    hasAnr: usable("1.6"),
    audioSettingsRefused: replied("31.10") && !usable("31.10"),
    cncDirectRefused: replied("1.5") && !usable("1.5"),
    // 31.6 回包长度直接决定字段位置，报告里要写出来
    modeConfigBytes: lengths,
    // 有没有 EQ / 多点 / 自动播放这些
    hasEq: usable("1.7"),
    hasMultipoint: usable("1.10"),
    hasStandby: usable("1.4"),
    hasVoice: usable("1.3"),
    hasSidetone: usable("1.11"),
    hasShortcut: usable("1.9"),
    hasTransport: usable("5.3"),
    // 探路包是否需要：0.1 回了但别的全哑，说明它要开局
    needsInit: replied("0.1") && !usable("2.2"),
    // 明确不支持的功能（回 OpNotSupp / FuncNotSupp），比超时更有信息量
    refused: entries
      .filter((entry) => entry.verdict === "error")
      .map((entry) => ({ label: entry.label, code: entry.errorCode, name: entry.errorName })),
    // 超时的功能：可能是慢，也可能是没有；报告里分开列
    silent: entries.filter((entry) => entry.verdict === "timeout").map((entry) => entry.label),
  };
}

// 生成给人读的报告。放最前面的必须是「能直接拿去改机型表」的东西。
export function renderProbeReport({ report, capabilities, env, profile }) {
  const lines = [];
  const summary = report.summary;
  lines.push("# Bose 能力探测报告");
  lines.push(`生成时间 ${new Date().toISOString()}（时长 ${Date.now() - report.startedAt}ms）`);
  lines.push("");
  lines.push("## 结论");
  if (profile) {
    lines.push(`命中机型表 ${profile.id}`);
  } else {
    lines.push("未命中机型表（按 DEFAULT 跑）");
  }
  const on = [];
  const off = [];
  const unknown = [];
  const push = (flag, name) => (flag ? on : off).push(name);
  push(capabilities.hasAudioModes, "AudioModes(31.x)");
  push(capabilities.hasAudioSettings, "消噪 31.10");
  push(capabilities.hasCncDirect, "消噪 1.5");
  push(capabilities.hasAnr, "ANR 1.6");
  push(capabilities.hasEq, "EQ");
  push(capabilities.hasMultipoint, "多点连接");
  push(capabilities.hasStandby, "自动关机");
  push(capabilities.hasVoice, "语音提示");
  push(capabilities.hasSidetone, "侧音");
  push(capabilities.hasShortcut, "快捷动作");
  push(capabilities.hasTransport, "播放控制");
  lines.push(`可用：${on.join(" / ") || "无"}`);
  lines.push(`没回：${off.join(" / ") || "无"}`);
  if (capabilities.modeConfigBytes.length) {
    lines.push(`31.6 回包长度：${capabilities.modeConfigBytes.join(" / ")} 字节（决定字段偏移）`);
  }
  if (capabilities.refused.length) {
    lines.push(`明确拒绝：${capabilities.refused.map((r) => `${r.label}=${r.name}(${r.code})`).join(" / ")}`);
  }
  if (capabilities.silent.length) {
    lines.push(`没有回包：${capabilities.silent.join(" / ")}`);
  }
  lines.push("");
  lines.push(`统计 ok=${summary.ok} empty=${summary.empty} error=${summary.error} timeout=${summary.timeout} skipped=${summary.skipped}`);
  lines.push("");
  if (env) {
    lines.push("## 环境");
    for (const [key, value] of Object.entries(env)) lines.push(`${key} ${value}`);
    lines.push("");
  }
  lines.push("## 逐条探测");
  lines.push("label | verdict | tx | rx | 说明");
  for (const entry of report.entries) {
    lines.push(
      [
        entry.label,
        entry.verdict + (entry.errorName ? `(${entry.errorName})` : ""),
        entry.tx || "-",
        entry.rx || "-",
        entry.detail || "-",
      ].join(" | "),
    );
  }
  return lines.join("\n");
}
