export const $ = (id) => document.getElementById(id);

export function pane(el, on) {
  const box = el.closest("section") ?? el;
  box.hidden = !on;
}

export function chip(label, on) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chip" + (on ? " on" : "");
  btn.textContent = label;
  return btn;
}

// 重画一行时保留横向位置：chip 行溢出后会被重画，弹回开头等于让用户白滑
export function refill(root, build) {
  const left = root.scrollLeft;
  root.innerHTML = "";
  build(root);
  if (left) root.scrollLeft = left;
}

// 把一颗 chip 滑进视野。只动这一行的横向位置，不碰页面纵向（scrollIntoView 会连页面一起滚）
export function reveal(root, el) {
  if (!el) return;
  const box = root.getBoundingClientRect();
  const item = el.getBoundingClientRect();
  if (item.left < box.left) root.scrollLeft += item.left - box.left;
  else if (item.right > box.right) root.scrollLeft += item.right - box.right;
}

// 选中值或内容宽度真的变了才 reveal（切语言时值不变但标签变宽，当前值会被甩出屏）。
// 没有布局盒（隐藏、还没进文档）就不记账，否则这次「首次 reveal」会被永久吃掉。
// 键不算 scrollLeft，所以用户滑到哪都不抢。
const shownSelection = new WeakMap();

export function revealSelection(root, selected) {
  if (!root.clientWidth) return;
  const seen = `${selected}\u0000${root.scrollWidth}`;
  if (shownSelection.get(root) === seen) return;
  shownSelection.set(root, seen);
  reveal(root, root.querySelector(".on"));
}

export function chips(root, items, selected, onPick) {
  const on = (key) => (Array.isArray(selected) ? selected.includes(key) : key === selected);
  refill(root, (box) => {
    items.forEach((item, index) => {
      const label = typeof item === "string" ? item : item.label;
      const key = typeof item === "string" ? index : item.key;
      const btn = chip(label, on(key));
      btn.addEventListener("click", () => onPick(key));
      box.appendChild(btn);
    });
  });
  // 单选行里带 .on 的那颗就是「当前值」：滑出屏就等于看不见当前值（耳机按键也能改它）。
  // 多选行（机身模式循环）不抢滚动位置，否则点一颗就被拽回第一颗选中项
  if (!Array.isArray(selected)) revealSelection(root, selected);
}

export function fillRows(root, rows) {
  root.innerHTML = "";
  for (const [key, value, title] of rows) {
    const line = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = key;
    const bold = document.createElement("b");
    bold.textContent = value;
    if (title) bold.title = title;
    line.append(label, bold);
    root.appendChild(line);
  }
}
