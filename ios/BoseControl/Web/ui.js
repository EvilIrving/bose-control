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

export function chips(root, items, selected, onPick) {
  const on = (key) => (Array.isArray(selected) ? selected.includes(key) : key === selected);
  root.innerHTML = "";
  items.forEach((item, index) => {
    const label = typeof item === "string" ? item : item.label;
    const key = typeof item === "string" ? index : item.key;
    const btn = chip(label, on(key));
    btn.addEventListener("click", () => onPick(key));
    root.appendChild(btn);
  });
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
