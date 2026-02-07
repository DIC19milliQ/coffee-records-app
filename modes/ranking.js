import { createNoteSheet } from "../shared/noteSheet.js";
import { display, validTaste } from "../shared/utils.js";

const RATING_ORDER = { S: 4, A: 3, B: 2, C: 1 };

export function initRanking(container, context) {
  const { state } = context;
  container.innerHTML = `<div class="card"><h2>苦味/酸味 検索</h2><div class="mode-buttons" id="ranking-modes"><button data-mode="bitter" class="active">苦味のみ</button><button data-mode="both">苦味 + 酸味</button><button data-mode="diff">差分 (苦味 - 酸味)</button></div><div class="grid-2" style="margin-top:12px;"><div><label>苦味 (1-5)</label><input id="input-bitter" type="number" min="1" max="5" step="1" value="3" /></div><div><label>酸味 (1-5)</label><input id="input-acid" type="number" min="1" max="5" step="1" value="3" /></div><div><label>差分 (苦味 - 酸味)</label><input id="input-diff" type="number" min="-4" max="4" step="1" value="0" /></div></div><p class="muted" id="ranking-note"></p></div><div class="card"><div class="table-wrap"><table><thead><tr><th>国</th><th>豆</th><th>焙煎</th><th>苦味</th><th>酸味</th><th>評価</th></tr></thead><tbody id="ranking-results"></tbody></table></div></div>`;
  const noteSheet = createNoteSheet(container, { prefix: "ranking", title: "ノート" });

  function computeScore(record) {
    const bitter = validTaste(record.bitter);
    const acid = validTaste(record.acid);
    if (bitter === null || acid === null) return null;
    const inputBitter = Number(container.querySelector("#input-bitter").value) || 3;
    const inputAcid = Number(container.querySelector("#input-acid").value) || 3;
    const inputDiff = Number(container.querySelector("#input-diff").value) || 0;
    if (state.rankingMode === "bitter") return Math.abs(bitter - inputBitter);
    if (state.rankingMode === "both") return Math.hypot(bitter - inputBitter, acid - inputAcid);
    return Math.abs((bitter - acid) - inputDiff);
  }

  function rankingNote() {
    const b = Number(container.querySelector("#input-bitter").value) || 3;
    const a = Number(container.querySelector("#input-acid").value) || 3;
    const d = Number(container.querySelector("#input-diff").value) || 0;
    if (state.rankingMode === "bitter") return `基準：苦味=${b}（近い順）`;
    if (state.rankingMode === "both") return `基準：苦味=${b}, 酸味=${a}（近い順）`;
    return `基準：差分=${d}（|苦味-酸味| が近い順）`;
  }

  function openNote(record) {
    noteSheet.open(record.note);
  }

  function renderRanking() {
    container.querySelector("#ranking-note").textContent = rankingNote();
    const tbody = container.querySelector("#ranking-results");
    tbody.innerHTML = "";
    state.records
      .map((record) => ({ record, score: computeScore(record) }))
      .filter((x) => x.score !== null)
      .sort((a, b) => {
        const scoreDiff = a.score - b.score;
        if (scoreDiff !== 0) return scoreDiff;
        const ra = RATING_ORDER[(String(a.record.rating || "").trim().toUpperCase())] || 0;
        const rb = RATING_ORDER[(String(b.record.rating || "").trim().toUpperCase())] || 0;
        if (ra !== rb) return rb - ra;
        const country = String(a.record.country || "").localeCompare(String(b.record.country || ""), "ja");
        if (country !== 0) return country;
        return String(a.record.bean || "").localeCompare(String(b.record.bean || ""), "ja");
      })
      .forEach(({ record }) => {
        const row = document.createElement("tr");
        row.classList.add("expandable");
        row.innerHTML = `<td>${display(record.country)}</td><td>${display(record.bean)}</td><td>${display(record.roast)}</td><td>${display(record.bitter)}</td><td>${display(record.acid)}</td><td>${display(record.rating)}</td>`;
        row.addEventListener("click", () => openNote(record));
        tbody.appendChild(row);
      });
  }

  container.querySelector("#ranking-modes").addEventListener("click", (event) => {
    if (event.target.tagName !== "BUTTON") return;
    state.rankingMode = event.target.dataset.mode;
    container.querySelectorAll("#ranking-modes button").forEach((btn) => btn.classList.remove("active"));
    event.target.classList.add("active");
    renderRanking();
  });
  ["input-bitter", "input-acid", "input-diff"].forEach((id) => container.querySelector(`#${id}`).addEventListener("input", renderRanking));
  return { render: renderRanking };
}
