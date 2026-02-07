export function createNoteSheet(container, { prefix, title = "ノート" } = {}) {
  container.insertAdjacentHTML("beforeend", `<div id="${prefix}-sheet-backdrop" class="sheet-backdrop"></div><section id="${prefix}-sheet" class="sheet" aria-label="${title}"><div class="sheet-header"><strong>${title}</strong><button id="${prefix}-sheet-close" class="ghost">閉じる</button></div><div class="sheet-content"><p id="${prefix}-sheet-note" class="sheet-note">ノート未記録</p></div></section>`);

  const backdrop = container.querySelector(`#${prefix}-sheet-backdrop`);
  const sheet = container.querySelector(`#${prefix}-sheet`);
  const closeButton = container.querySelector(`#${prefix}-sheet-close`);
  const noteEl = container.querySelector(`#${prefix}-sheet-note`);

  function close() {
    backdrop.classList.remove("open");
    sheet.classList.remove("open");
  }

  function open(note) {
    noteEl.textContent = String(note || "").trim() || "ノート未記録";
    backdrop.classList.add("open");
    sheet.classList.add("open");
  }

  closeButton.addEventListener("click", close);
  backdrop.addEventListener("click", close);

  return { open, close };
}
