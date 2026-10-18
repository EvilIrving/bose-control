// 耳机示意图：直接内联 Tabler Icons 的官方图形（MIT，Copyright (c) 2020-2026 Paweł Kuna），
// 没有自己做任何造型。三个图形都取自同一套，线宽一致：
//   headphones        → 头戴式
//   device-airpods    → 一副耳塞，左耳只取左声道那只、右耳取右边那只（原图就是两只分开的 path）
//   device-airpods-case → 充电仓
// 单只耳塞的 viewBox 是按原 path 的实际边界裁的，左右各 11×20，尺寸因此完全一致。
// 许可全文见仓库 README「图标来源」。

const HEADPHONES = `
<path d="M4 15a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-1a2 2 0 0 1 -2 -2l0 -3" />
<path d="M15 15a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-1a2 2 0 0 1 -2 -2l0 -3" />
<path d="M4 15v-3a8 8 0 0 1 16 0v3" />`;

// device-airpods：左边那只
const BUD_LEFT = `
<path d="M6 4a4 4 0 0 1 4 3.8l0 .2v10.5a1.5 1.5 0 0 1 -3 0v-6.5h-1a4 4 0 0 1 -4 -3.8l0 -.2a4 4 0 0 1 4 -4" />`;

// 同一张图的右边那只
const BUD_RIGHT = `
<path d="M18 4a4 4 0 0 0 -4 3.8l0 .2v10.5a1.5 1.5 0 0 0 3 0v-6.5h1a4 4 0 0 0 4 -3.8l0 -.2a4 4 0 0 0 -4 -4" />`;

const CASE = `
<path d="M21 10h-18" />
<path d="M3 8a4 4 0 0 1 4 -4h10a4 4 0 0 1 4 4v8a4 4 0 0 1 -4 4h-10a4 4 0 0 1 -4 -4l0 -8" />
<path d="M7 10v1.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5 -1.5v-1.5" />`;

function wrap(inner, viewBox) {
  return `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

// kind: "overear" | "pair"（一副耳塞） | "bud"（单只，需给 side） | "case"
export function artSvg(kind, { side = "left" } = {}) {
  if (kind === "overear") return wrap(HEADPHONES, "0 0 24 24");
  if (kind === "case") return wrap(CASE, "0 0 24 24");
  if (kind === "pair") return wrap(`${BUD_LEFT}${BUD_RIGHT}`, "0 0 24 24");
  // 原图里左耳那只在 x≈0-11，右耳那只在 x≈13-24；按各自的边界裁成同样大小
  return side === "right" ? wrap(BUD_RIGHT, "13 2 11 20") : wrap(BUD_LEFT, "0 2 11 20");
}

// 名字里带这些词的当耳塞，其余带耳机/头戴词的当头戴式；认不出来按耳塞画。
const EARBUDS = ["buds", "tws", "freebuds", "freeclip", "freelace", "enco", "earbud", "air", "clip", "fit", "pods"];

const OVER_EAR = [
  "quietcomfort",
  "qc ",
  "qc2",
  "qc3",
  "nc 700",
  "nch 700",
  "soundlink",
  "wh-1000",
  "wh1000",
  "headphone",
  "over-ear",
  "overear",
  "major",
  "tune",
];

export function formFactor(name, brand = "") {
  const n = String(name || "").toLowerCase();
  if (!n) return "buds";
  if (EARBUDS.some((key) => n.includes(key))) return "buds";
  // QC45 / QC35 这类只写型号的也归头戴式；带 earbuds 的已经在上面被拦下了
  if (/(^|\s)qc\s*\d/.test(n)) return "overear";
  if (OVER_EAR.some((key) => n.includes(key))) return "overear";
  if (brand === "bose" || brand === "huawei") return "overear";
  return "buds";
}

// 电量行按宿主的约定：0 左、1 盒、2 右。
// 带充电仓的耳塞只画一个仓（三格摆开太碎），数字写在仓下面：L / R / C。
// 没有仓读数时，左右都有就分开画两只；只有一条读数就画一副，不硬说成某一只耳朵。
export function slotPlan(kind, rows) {
  if (!rows?.length) return [];
  if (kind === "overear") return [{ art: "overear", level: rows[0]?.level }];
  const left = rows.find((row) => row.component === 0);
  const right = rows.find((row) => row.component === 2);
  const box = rows.find((row) => row.component === 1);
  if (box) {
    const parts = [];
    if (left) parts.push({ label: "L", level: left.level });
    if (right) parts.push({ label: "R", level: right.level });
    parts.push({ label: "C", level: box.level });
    return [{ art: "case", parts }];
  }
  if (left && right) {
    return [
      { art: "bud", side: "left", label: "L", level: left.level },
      { art: "bud", side: "right", label: "R", level: right.level },
    ];
  }
  return [{ art: "pair", level: (left ?? right)?.level ?? rows[0].level }];
}

export function artIcon(name, brand) {
  const span = document.createElement("span");
  span.className = "peer-art";
  const kind = formFactor(name, brand);
  span.innerHTML = artSvg(kind === "overear" ? "overear" : "pair");
  return span;
}

export function renderArtRow(root, { name, brand, battery }) {
  const slots = slotPlan(formFactor(name, brand), battery);
  root.innerHTML = "";
  root.hidden = slots.length === 0;
  if (!slots.length) return;
  for (const slot of slots) {
    const box = document.createElement("div");
    box.className = "art-slot";
    box.innerHTML = artSvg(slot.art, { side: slot.side });
    const parts = slot.parts ?? (slot.level != null ? [{ label: slot.label, level: slot.level }] : []);
    if (parts.length) {
      const line = document.createElement("div");
      line.className = "art-levels";
      for (const part of parts) {
        const item = document.createElement("span");
        if (part.label) {
          const tag = document.createElement("i");
          tag.textContent = part.label;
          item.appendChild(tag);
        }
        const level = document.createElement("b");
        level.textContent = `${part.level}%`;
        item.appendChild(level);
        line.appendChild(item);
      }
      box.appendChild(line);
    }
    root.appendChild(box);
  }
}
