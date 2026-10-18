// 下拉菜单：一个按钮触发，面板里是可点的行。
// 只做这个页面需要的事：点外面关掉、Esc 关掉并把焦点还给按钮、上下键在行之间走。
export function createMenu({ trigger, panel, onOpen }) {
  let items = [];

  const rows = () => [...panel.querySelectorAll('[role="menuitem"]:not([disabled])')];
  const isOpen = () => panel.classList.contains("open");

  function paint() {
    panel.innerHTML = "";
    let group = "";
    for (const item of items) {
      if (item.separator) {
        const line = document.createElement("div");
        line.className = "menu-sep";
        panel.appendChild(line);
        group = "";
      }
      if (item.group && item.group !== group) {
        group = item.group;
        const head = document.createElement("div");
        head.className = "menu-group";
        head.textContent = group;
        panel.appendChild(head);
      }
      const row = document.createElement("button");
      row.type = "button";
      row.className = "menu-item" + (item.danger ? " danger" : "");
      row.setAttribute("role", "menuitem");
      row.disabled = Boolean(item.disabled);

      const label = document.createElement("span");
      label.className = "menu-label";
      label.textContent = item.label;
      row.appendChild(label);

      if (item.meta) {
        const meta = document.createElement("span");
        meta.className = "menu-meta";
        meta.textContent = item.meta;
        row.appendChild(meta);
      }

      const mark = document.createElement("i");
      mark.className = "menu-check" + (item.checked ? " on" : "");
      row.appendChild(mark);

      row.addEventListener("click", () => {
        if (item.keepOpen) {
          item.run?.();
          paint();
          return;
        }
        close(true);
        item.run?.();
      });
      panel.appendChild(row);
    }
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "menu-empty";
      empty.textContent = "没有可切换的设备";
      panel.appendChild(empty);
    }
  }

  function open() {
    if (isOpen()) return;
    onOpen?.();
    paint();
    panel.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    rows()[0]?.focus();
  }

  function close(refocus) {
    if (!isOpen()) return;
    panel.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");
    if (refocus) trigger.focus();
  }

  function toggle() {
    if (isOpen()) close(true);
    else open();
  }

  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.addEventListener("click", (ev) => {
    ev.stopPropagation();
    toggle();
  });

  panel.addEventListener("keydown", (ev) => {
    const list = rows();
    const at = list.indexOf(document.activeElement);
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      close(true);
      return;
    }
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (!list.length) return;
      const step = ev.key === "ArrowDown" ? 1 : -1;
      const next = at < 0 ? 0 : (at + step + list.length) % list.length;
      list[next].focus();
      return;
    }
    if (ev.key === "Home" || ev.key === "End") {
      ev.preventDefault();
      (ev.key === "Home" ? list[0] : list[list.length - 1])?.focus();
    }
  });

  document.addEventListener(
    "pointerdown",
    (ev) => {
      if (!isOpen()) return;
      if (panel.contains(ev.target) || trigger.contains(ev.target)) return;
      close(false);
    },
    true,
  );

  return {
    isOpen,
    open,
    close,
    setItems(next) {
      items = next;
      if (isOpen()) paint();
    },
  };
}
