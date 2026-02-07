import { normalizeText, validTaste, display } from "../shared/utils.js";

const MAP_AXES = [
  { key: "country", label: "国", getValue: (record) => toCategory(record.country) },
  { key: "process", label: "精製", getValue: (record) => toCategory(record.process) },
  { key: "roast", label: "焙煎", getValue: (record) => toCategory(record.roast) },
  { key: "bitter", label: "苦味", getValue: (record) => toTasteCategory(record.bitter) },
  { key: "acid", label: "酸味", getValue: (record) => toTasteCategory(record.acid) },
  { key: "altitude_bin", label: "標高ビン", getValue: (record) => toAltitudeBin(record.altitude) }
];

const RATING_COLORS = {
  S: "#7b4e2e",
  A: "#2f8f6a",
  B: "#4e79c8",
  C: "#a35a9f"
};

function toCategory(value) {
  const text = String(value ?? "").trim();
  return text || "不明";
}

function toTasteCategory(value) {
  const taste = validTaste(value);
  return taste === null ? "不明" : String(taste);
}

function parseAltitudeRepresentative(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const range = text.match(/^(\d+(?:\.\d+)?)\s*[-〜~]\s*(\d+(?:\.\d+)?)$/);
  if (range) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    if (Number.isFinite(low) && Number.isFinite(high)) return (low + high) / 2;
    return null;
  }
  const single = Number(text.replace(/m$/i, "").trim());
  return Number.isFinite(single) ? single : null;
}

function toAltitudeBin(value) {
  const repr = parseAltitudeRepresentative(value);
  if (!Number.isFinite(repr) || repr < 0) return "不明";
  const start = Math.floor(repr / 500) * 500;
  const end = start + 499;
  return `${start}-${end}m`;
}

function isHit(record, targetSet) {
  const rating = normalizeText(record.rating).toUpperCase();
  return targetSet === "S" ? rating === "S" : rating === "S" || rating === "A";
}

function formatRate(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function sortByHitRate(rows) {
  return [...rows].sort((a, b) => b.hitRate - a.hitRate || b.n - a.n || String(a.key).localeCompare(String(b.key), "ja"));
}

function summarize(records, targetSet, label, overallHitRate = 0) {
  const n = records.length;
  const hitCount = records.filter((record) => isHit(record, targetSet)).length;
  const hitRate = n ? hitCount / n : 0;
  return { label, n, hitRate, deltaPt: hitRate - overallHitRate, records };
}

function getCellDisplay(cell) {
  if (cell.n < 3) return { rateText: "—", nText: "", className: "insufficient", clickEnabled: false };
  if (cell.n < 5) return { rateText: formatRate(cell.hitRate), nText: `(n=${cell.n})`, className: "small", clickEnabled: true };
  return { rateText: formatRate(cell.hitRate), nText: `n=${cell.n}`, className: "ok", clickEnabled: true };
}

export function initMapping(container, context) {
  const { state } = context;
  const ui = {
    ratings: new Set(["S", "A", "B", "C"]),
    mapType: "taste",
    bubbleMode: "total",
    axis1: "country",
    axis2: "roast",
    targetSet: "S",
    drillAxis1: "",
    detail: []
  };

  container.innerHTML = `
    <div class="card">
      <h2>マッピング（探索用）</h2>
      <div class="quick-filters">
        <div class="filter-group">
          <h3>評価フィルタ（複数選択可）</h3>
          <div class="option-list" id="map-rating-filters"></div>
        </div>
        <div>
          <label>表示タイプ</label>
          <select id="map-type">
            <option value="taste">苦味×酸味（バブル）</option>
            <option value="category">カテゴリ×カテゴリ（ヒートマップ or 代替表示）</option>
          </select>
        </div>
      </div>
      <div id="map-extra-controls" class="analysis-controls" style="margin-top:12px;"></div>
      <div id="map-main" class="mapping-main"></div>
    </div>
    <div class="card analysis-detail-panel">
      <h3>詳細パネル（豆一覧）</h3>
      <div class="table-wrap detail-scroll"><table><thead><tr><th>bean</th><th>rating</th><th>roast</th><th>process</th><th>note</th></tr></thead><tbody id="map-detail"></tbody></table></div>
    </div>`;

  function renderRatingFilters() {
    const root = container.querySelector("#map-rating-filters");
    root.innerHTML = ["S", "A", "B", "C"].map((rating) => `<label><input type="checkbox" value="${rating}" ${ui.ratings.has(rating) ? "checked" : ""}/> ${rating}</label>`).join("");
    root.querySelectorAll("input[type='checkbox']").forEach((input) => {
      input.addEventListener("change", (event) => {
        const rating = event.target.value;
        if (event.target.checked) ui.ratings.add(rating);
        else ui.ratings.delete(rating);
        render();
      });
    });
  }

  function filteredRecords() {
    return state.records.filter((record) => ui.ratings.has(normalizeText(record.rating).toUpperCase()));
  }

  function setDetail(records) {
    ui.detail = records;
    renderDetail();
  }

  function renderDetail() {
    const tbody = container.querySelector("#map-detail");
    if (!ui.detail.length) {
      tbody.innerHTML = "<tr><td colspan='5' class='muted'>未選択</td></tr>";
      return;
    }
    tbody.innerHTML = ui.detail.map((record) => `<tr><td>${display(record.bean)}</td><td>${display(record.rating)}</td><td>${display(record.roast)}</td><td>${display(record.process)}</td><td>${display(record.note)}</td></tr>`).join("");
  }

  function bubbleRadius(value, max) {
    return 6 + Math.sqrt(value / Math.max(1, max)) * 18;
  }

  function renderBubbleLegend(maxN) {
    const marks = [1, 3, 5].filter((value) => value <= maxN);
    const useMarks = marks.length ? marks : [1];
    return `<div class="bubble-legend">${useMarks.map((n) => `<span class="bubble-legend-item"><span class="bubble-size" style="width:${bubbleRadius(n, maxN) * 2}px;height:${bubbleRadius(n, maxN) * 2}px;"></span>n=${n}</span>`).join("")}</div>`;
  }

  function renderTasteBubble(records) {
    const controls = container.querySelector("#map-extra-controls");
    controls.innerHTML = `
      <div><label>バブル表示</label><select id="bubble-mode"><option value="total" ${ui.bubbleMode === "total" ? "selected" : ""}>合計バブル</option><option value="rating" ${ui.bubbleMode === "rating" ? "selected" : ""}>評価別バブル</option></select></div>`;
    controls.querySelector("#bubble-mode")?.addEventListener("change", (event) => {
      ui.bubbleMode = event.target.value;
      render();
    });

    const valid = records.map((record) => {
      const bitter = validTaste(record.bitter);
      const acid = validTaste(record.acid);
      if (bitter === null || acid === null) return null;
      return { record, bitter, acid, rating: normalizeText(record.rating).toUpperCase() };
    }).filter(Boolean);

    const width = 720;
    const height = 360;
    const pad = 40;
    const xScale = (value) => pad + ((value - 1) / 4) * (width - pad * 2);
    const yScale = (value) => height - pad - ((value - 1) / 4) * (height - pad * 2);

    const main = container.querySelector("#map-main");
    main.innerHTML = `<div class="mapping-frame"><p class="muted">有効データ ${valid.length}件（1-5以外の苦味/酸味は除外）</p><svg id="taste-bubble" viewBox="0 0 ${width} ${height}" role="img" aria-label="苦味と酸味のバブルマップ"></svg><div id="bubble-legend-wrap"></div></div>`;
    const svg = d3.select(container.querySelector("#taste-bubble"));

    [1, 2, 3, 4, 5].forEach((v) => {
      svg.append("line").attr("x1", xScale(v)).attr("y1", pad).attr("x2", xScale(v)).attr("y2", height - pad).attr("stroke", "#f0e8de");
      svg.append("line").attr("x1", pad).attr("y1", yScale(v)).attr("x2", width - pad).attr("y2", yScale(v)).attr("stroke", "#f0e8de");
      svg.append("text").attr("x", xScale(v)).attr("y", height - 14).attr("text-anchor", "middle").attr("font-size", 12).text(v);
      svg.append("text").attr("x", 16).attr("y", yScale(v) + 4).attr("text-anchor", "middle").attr("font-size", 12).text(v);
    });
    svg.append("line").attr("x1", pad).attr("y1", height - pad).attr("x2", width - pad).attr("y2", height - pad).attr("stroke", "#b6aaa0");
    svg.append("line").attr("x1", pad).attr("y1", pad).attr("x2", pad).attr("y2", height - pad).attr("stroke", "#b6aaa0");
    svg.append("text").attr("x", width / 2).attr("y", height - 2).attr("text-anchor", "middle").attr("font-size", 13).text("酸味");
    svg.append("text").attr("x", 16).attr("y", 20).attr("font-size", 13).text("苦味");

    let bubbles = [];
    if (ui.bubbleMode === "total") {
      const byPoint = new Map();
      valid.forEach(({ record, bitter, acid }) => {
        const key = `${bitter}-${acid}`;
        if (!byPoint.has(key)) byPoint.set(key, []);
        byPoint.get(key).push(record);
      });
      bubbles = [...byPoint.entries()].map(([key, list]) => {
        const [bitter, acid] = key.split("-").map(Number);
        return { key, bitter, acid, n: list.length, records: list, fill: "#c8783b", stroke: "#8b3f1f" };
      });
    } else {
      const offsets = {
        S: { x: -10, y: -10 },
        A: { x: 10, y: -10 },
        B: { x: -10, y: 10 },
        C: { x: 10, y: 10 }
      };
      const byPointAndRating = new Map();
      valid.forEach(({ record, bitter, acid, rating }) => {
        if (!["S", "A", "B", "C"].includes(rating)) return;
        const key = `${bitter}-${acid}-${rating}`;
        if (!byPointAndRating.has(key)) byPointAndRating.set(key, []);
        byPointAndRating.get(key).push(record);
      });
      bubbles = [...byPointAndRating.entries()].map(([key, list]) => {
        const [bitter, acid, rating] = key.split("-");
        return {
          key,
          bitter: Number(bitter),
          acid: Number(acid),
          n: list.length,
          records: list,
          rating,
          fill: RATING_COLORS[rating],
          stroke: "#2f2a24",
          dx: offsets[rating].x,
          dy: offsets[rating].y
        };
      });
      const colorLegend = ["S", "A", "B", "C"].map((rating) => `<span class="bubble-legend-item"><span class="rating-dot" style="background:${RATING_COLORS[rating]};"></span>${rating}</span>`).join("");
      main.insertAdjacentHTML("beforeend", `<div class="bubble-legend">${colorLegend}</div>`);
    }

    const maxN = Math.max(1, ...bubbles.map((bubble) => bubble.n));
    container.querySelector("#bubble-legend-wrap").innerHTML = renderBubbleLegend(maxN);

    const circles = svg.selectAll("circle").data(bubbles).enter().append("circle")
      .attr("cx", (d) => xScale(d.acid) + (d.dx || 0))
      .attr("cy", (d) => yScale(d.bitter) + (d.dy || 0))
      .attr("r", (d) => bubbleRadius(d.n, maxN))
      .attr("fill", (d) => d.fill)
      .attr("fill-opacity", 0.55)
      .attr("stroke", (d) => d.stroke)
      .style("cursor", "pointer")
      .on("click", (_event, d) => setDetail(d.records));

    circles.append("title").text((d) => `${d.rating ? `${d.rating} / ` : ""}苦味${d.bitter} / 酸味${d.acid} / n=${d.n}`);
  }

  function renderCategoryHeatmap(records, axis1, axis2) {
    const rows = [...new Set(records.map((record) => axis1.getValue(record)))].sort((a, b) => String(a).localeCompare(String(b), "ja"));
    const cols = [...new Set(records.map((record) => axis2.getValue(record)))].sort((a, b) => String(a).localeCompare(String(b), "ja"));
    const overallHitRate = records.length ? records.filter((record) => isHit(record, ui.targetSet)).length / records.length : 0;

    if (rows.length > 15 || cols.length > 15) {
      renderCategoryFallback(records, axis1, axis2, overallHitRate);
      return;
    }

    const gridTemplate = `180px repeat(${Math.max(cols.length, 1)}, minmax(90px, 1fr))`;
    const header = cols.map((col) => `<div class="heatmap-col-header">${display(col)}</div>`).join("");
    const body = rows.map((row) => {
      const cells = cols.map((col) => {
        const list = records.filter((record) => axis1.getValue(record) === row && axis2.getValue(record) === col);
        const summary = summarize(list, ui.targetSet, `${row} × ${col}`, overallHitRate);
        const stateLabel = getCellDisplay(summary);
        const opacity = summary.n < 3 ? 0.2 : Math.max(0.22, summary.hitRate);
        return `<button type="button" class="heatmap-cell ${stateLabel.className} ${stateLabel.clickEnabled ? "clickable" : ""}" style="--heat:${opacity};" ${stateLabel.clickEnabled ? `data-map-detail="${encodeURIComponent(JSON.stringify(list))}"` : "disabled"}>
          <div class="metric-main">${stateLabel.rateText}</div>
          <div class="metric-sub">${stateLabel.nText || `n=${summary.n}`}</div>
        </button>`;
      }).join("");
      return `<div class="heatmap-row-label">${display(row)}</div>${cells}`;
    }).join("");

    container.querySelector("#map-main").innerHTML = `
      <div class="mapping-frame">
        <p class="muted">サンプル基準：n&lt;3は表示なし、3–4は参考表示</p>
        <div class="heatmap-legend"><span>0%</span><div class="legend-bar"></div><span>100%</span></div>
        <div class="analysis-heatmap" style="grid-template-columns:${gridTemplate};">
          <div></div>
          ${header}
          ${body}
        </div>
      </div>`;

    container.querySelectorAll("[data-map-detail]").forEach((cell) => {
      cell.addEventListener("click", () => setDetail(JSON.parse(decodeURIComponent(cell.dataset.mapDetail || "[]"))));
    });
  }

  function renderCategoryFallback(records, axis1, axis2, overallHitRate) {
    const byAxis1 = [...new Set(records.map((record) => axis1.getValue(record)))].map((key) => {
      const list = records.filter((record) => axis1.getValue(record) === key);
      return summarize(list, ui.targetSet, key, overallHitRate);
    });

    const top = sortByHitRate(byAxis1).slice(0, 15);
    if (!top.some((row) => row.label === ui.drillAxis1)) ui.drillAxis1 = top[0]?.label || "";

    const selectedAxis1Records = records.filter((record) => axis1.getValue(record) === ui.drillAxis1);
    const byAxis2 = [...new Set(selectedAxis1Records.map((record) => axis2.getValue(record)))].map((key) => {
      const list = selectedAxis1Records.filter((record) => axis2.getValue(record) === key);
      return summarize(list, ui.targetSet, key, overallHitRate);
    });

    const axis1Rows = top.map((row) => `<tr class="expandable ${ui.drillAxis1 === row.label ? "active" : ""}" data-drill-axis1="${encodeURIComponent(row.label)}"><td>${display(row.label)}</td><td>${formatRate(row.hitRate)}</td><td>n=${row.n}</td></tr>`).join("");
    const axis2Rows = sortByHitRate(byAxis2).map((row) => `<tr class="expandable" data-map-detail="${encodeURIComponent(JSON.stringify(row.records))}"><td>${display(row.label)}</td><td>${row.n < 3 ? "—" : formatRate(row.hitRate)}</td><td>n=${row.n}</td></tr>`).join("");

    container.querySelector("#map-main").innerHTML = `
      <div class="mapping-frame">
        <p class="muted">カテゴリ数が多いため、ランキング表＋ドリルダウン表示に自動切替しています。</p>
        <div class="grid-2">
          <div>
            <h4>${axis1.label} 上位15</h4>
            <div class="table-wrap"><table><thead><tr><th>${axis1.label}</th><th>当たり率</th><th>n</th></tr></thead><tbody>${axis1Rows || "<tr><td colspan='3'>データなし</td></tr>"}</tbody></table></div>
          </div>
          <div>
            <h4>${axis2.label} 内訳（${display(ui.drillAxis1)}）</h4>
            <div class="table-wrap"><table><thead><tr><th>${axis2.label}</th><th>当たり率</th><th>n</th></tr></thead><tbody>${axis2Rows || "<tr><td colspan='3'>データなし</td></tr>"}</tbody></table></div>
          </div>
        </div>
      </div>`;

    container.querySelectorAll("[data-drill-axis1]").forEach((row) => {
      row.addEventListener("click", () => {
        ui.drillAxis1 = decodeURIComponent(row.dataset.drillAxis1 || "");
        render();
      });
    });
    container.querySelectorAll("[data-map-detail]").forEach((row) => {
      row.addEventListener("click", () => setDetail(JSON.parse(decodeURIComponent(row.dataset.mapDetail || "[]"))));
    });
  }

  function renderCategoryMap(records) {
    const controls = container.querySelector("#map-extra-controls");
    const axis1Options = MAP_AXES.map((axis) => `<option value="${axis.key}" ${axis.key === ui.axis1 ? "selected" : ""}>${axis.label}</option>`).join("");
    const axis2Candidates = MAP_AXES.filter((axis) => axis.key !== ui.axis1);
    if (!axis2Candidates.some((axis) => axis.key === ui.axis2)) ui.axis2 = axis2Candidates[0]?.key || ui.axis2;
    const axis2Options = axis2Candidates.map((axis) => `<option value="${axis.key}" ${axis.key === ui.axis2 ? "selected" : ""}>${axis.label}</option>`).join("");
    controls.innerHTML = `
      <div><label>Axis1</label><select id="map-axis1">${axis1Options}</select></div>
      <div><label>Axis2</label><select id="map-axis2">${axis2Options}</select></div>
      <div><label>対象評価セット</label><select id="map-target-set"><option value="S" ${ui.targetSet === "S" ? "selected" : ""}>Sのみ</option><option value="SA" ${ui.targetSet === "SA" ? "selected" : ""}>S + A</option></select></div>`;

    controls.querySelector("#map-axis1")?.addEventListener("change", (event) => {
      ui.axis1 = event.target.value;
      ui.drillAxis1 = "";
      render();
    });
    controls.querySelector("#map-axis2")?.addEventListener("change", (event) => {
      ui.axis2 = event.target.value;
      render();
    });
    controls.querySelector("#map-target-set")?.addEventListener("change", (event) => {
      ui.targetSet = event.target.value;
      render();
    });

    const axis1 = MAP_AXES.find((axis) => axis.key === ui.axis1) || MAP_AXES[0];
    const axis2 = MAP_AXES.find((axis) => axis.key === ui.axis2) || MAP_AXES[1];
    renderCategoryHeatmap(records, axis1, axis2);
  }

  function render() {
    const records = filteredRecords();
    const controls = container.querySelector("#map-extra-controls");
    if (ui.mapType === "taste") {
      renderTasteBubble(records);
    } else {
      renderCategoryMap(records);
    }
    if (ui.mapType === "taste") controls.querySelector("#map-axis1");
    renderDetail();
  }

  renderRatingFilters();
  container.querySelector("#map-type").addEventListener("change", (event) => {
    ui.mapType = event.target.value;
    ui.detail = [];
    render();
  });

  return { render };
}
