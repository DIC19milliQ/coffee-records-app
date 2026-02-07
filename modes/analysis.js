import { normalizeText, validTaste } from "../shared/utils.js";

export function initAnalysis(container, context) {
  const { state } = context;
  container.innerHTML = `<div class="grid-2"><div class="card"><h2>高評価豆の共通点</h2><div class="filters"><label><input type="radio" name="rating-filter" value="S" checked /> Sのみ</label><label><input type="radio" name="rating-filter" value="SA" /> S + A</label></div><p id="analysis-sample" class="muted"></p><div id="analysis-traits"></div></div><div class="card"><h2>苦味 x 酸味 マップ</h2><div class="chart-container"><canvas id="scatter" width="640" height="360"></canvas></div><div class="legend"><span class="tag">S</span><span class="tag">A</span><span class="tag">B</span><span class="tag">C</span><span class="tag">その他</span></div></div></div><div class="card"><h2>AI分析（準備中）</h2><p class="muted">現在は集計結果の確認のみ。将来は集計結果をAIに渡す想定です。</p><button id="ai-button">AI分析へ切替</button></div><dialog id="ai-dialog"><div class="dialog-body"><h3>AI分析は準備中です</h3><p class="muted">今後は集計データのみをAIに渡して分析する想定です。現時点ではAPI連携は行いません。</p></div><div class="dialog-actions"><button id="ai-close" class="ghost">閉じる</button></div></dialog>`;

  function ratingColor(rating) {
    const value = normalizeText(rating).toUpperCase();
    if (value === "S") return "#d35400";
    if (value === "A") return "#e67e22";
    if (value === "B") return "#f0b27a";
    if (value === "C") return "#f5cba7";
    return "#bfc9ca";
  }

  function renderScatter() {
    const canvas = container.querySelector("#scatter");
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    const p = 40;
    ctx.strokeStyle = "#d0c4b7";
    ctx.beginPath();
    ctx.moveTo(p, p);
    ctx.lineTo(p, height - p);
    ctx.lineTo(width - p, height - p);
    ctx.stroke();
    ctx.fillStyle = "#6c6156";
    ctx.font = "12px sans-serif";
    ctx.fillText("苦味", 8, 20);
    ctx.fillText("酸味", width - 40, height - 12);
    state.records.map((r) => ({ b: validTaste(r.bitter), a: validTaste(r.acid), rating: r.rating })).filter((pt) => pt.b !== null && pt.a !== null).forEach((pt) => {
      const x = p + ((pt.a - 1) / 4) * (width - p * 2);
      const y = height - p - ((pt.b - 1) / 4) * (height - p * 2);
      ctx.fillStyle = ratingColor(pt.rating);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function renderAnalysis() {
    const filterValue = container.querySelector("input[name='rating-filter']:checked").value;
    const filtered = state.records.filter((record) => {
      const rating = normalizeText(record.rating).toUpperCase();
      return filterValue === "S" ? rating === "S" : rating === "S" || rating === "A";
    });
    container.querySelector("#analysis-sample").textContent = filtered.length < 5 ? `対象 ${filtered.length}件: サンプルが少ないため参考程度です。` : `対象 ${filtered.length}件の傾向`;
    const fields = ["country", "process", "roast", "bitter", "acid", "altitude", "shop"];
    const labelMap = { bitter: "苦味", acid: "酸味", country: "国", process: "精製", roast: "焙煎", altitude: "標高", shop: "ショップ" };
    const traits = container.querySelector("#analysis-traits");
    traits.innerHTML = "";
    fields.forEach((field) => {
      const counts = new Map();
      filtered.forEach((record) => {
        const value = record[field] ? String(record[field]).trim() : "(不明)";
        counts.set(value, (counts.get(value) || 0) + 1);
      });
      const total = filtered.length || 1;
      const list = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([v, c]) => `${v}: ${((c / total) * 100).toFixed(0)}% (${c})`).join(" / ");
      const p = document.createElement("p");
      p.innerHTML = `<strong>${labelMap[field] || field}</strong>: ${list}`;
      traits.appendChild(p);
    });
    renderScatter();
  }

  container.querySelectorAll("input[name='rating-filter']").forEach((input) => input.addEventListener("change", renderAnalysis));
  const dialog = container.querySelector("#ai-dialog");
  container.querySelector("#ai-button").addEventListener("click", () => dialog.showModal());
  container.querySelector("#ai-close").addEventListener("click", () => dialog.close());

  return { render: renderAnalysis };
}
