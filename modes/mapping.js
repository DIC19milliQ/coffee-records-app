import { normalizeText, validTaste, display } from "../shared/utils.js";

const MAP_AXES = [
  { key: "country", label: "国", getValue: (record) => toCategory(record.country) },
  { key: "process", label: "精製", getValue: (record) => toCategory(record.process) },
  { key: "roast", label: "焙煎", getValue: (record) => toCategory(record.roast) },
  { key: "bitter", label: "苦味", getValue: (record) => toTasteCategory(record.bitter) },
  { key: "acid", label: "酸味", getValue: (record) => toTasteCategory(record.acid) },
  { key: "altitude_bin", label: "標高ビン", getValue: (record) => toAltitudeBin(record.altitude) }
];

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

function sampleClass(n) {
  if (n < 3) return "insufficient";
  if (n < 5) return "small";
  return "ok";
}

function formatRate(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function isHit(record, targetSet) {
  const rating = normalizeText(record.rating).toUpperCase();
  return targetSet === "S" ? rating === "S" : rating === "S" || rating === "A";
}

export function initMapping(container, context) {
  const { state } = context;
  const ui = {
    ratings: new Set(["S", "A", "B", "C"]),
    mapType: "taste",
    axis1: "country",
    axis2: "roast",
    targetSet: "S",
    detail: []
  };

  container.innerHTML = `
    <div class="card">
      <h2>マッピング（探索用）</h2>
      <div class="quick-filters">
        <div class="filter-group">
          <h3>評価フィルタ（絞り込み）</h3>
          <div class="option-list" id="map-rating-filters"></div>
        </div>
        <div>
          <label>マップタイプ</label>
          <select id="map-type">
            <option value="taste">苦味 × 酸味（バブル集計）</option>
            <option value="category">カテゴリ × カテゴリ（ヒートマップ）</option>
          </select>
        </div>
      </div>
      <div id="map-extra-controls" class="analysis-controls" style="margin-top:12px;"></div>
      <div id="map-main"></div>
    </div>
    <div class="card">
      <h3>選択セル/座標の豆一覧</h3>
      <div class="table-wrap"><table><thead><tr><th>豆</th><th>国</th><th>焙煎</th><th>精製</th><th>苦味</th><th>酸味</th><th>評価</th></tr></thead><tbody id="map-detail"></tbody></table></div>
    </div>`;

  function renderRatingFilters() {
    const root = container.querySelector("#map-rating-filters");
    const ratings = ["S", "A", "B", "C"];
    root.innerHTML = ratings.map((rating) => `<label><input type="checkbox" value="${rating}" ${ui.ratings.has(rating) ? "checked" : ""}/> ${rating}</label>`).join("");
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

  function renderDetail() {
    const tbody = container.querySelector("#map-detail");
    if (!ui.detail.length) {
      tbody.innerHTML = "<tr><td colspan='7' class='muted'>未選択</td></tr>";
      return;
    }
    tbody.innerHTML = ui.detail.map((record) => `<tr><td>${display(record.bean)}</td><td>${display(record.country)}</td><td>${display(record.roast)}</td><td>${display(record.process)}</td><td>${display(record.bitter)}</td><td>${display(record.acid)}</td><td>${display(record.rating)}</td></tr>`).join("");
  }

  function renderTasteBubble(records) {
    const valid = records.filter((record) => validTaste(record.bitter) !== null && validTaste(record.acid) !== null);
    const byPoint = new Map();
    valid.forEach((record) => {
      const b = validTaste(record.bitter);
      const a = validTaste(record.acid);
      const key = `${b}-${a}`;
      if (!byPoint.has(key)) byPoint.set(key, []);
      byPoint.get(key).push(record);
    });
    const points = [...byPoint.entries()].map(([key, pointRecords]) => {
      const [bitter, acid] = key.split("-").map(Number);
      return { key, bitter, acid, n: pointRecords.length, records: pointRecords };
    });
    const maxN = Math.max(1, ...points.map((point) => point.n));
    const width = 700;
    const height = 380;
    const pad = 44;
    const xScale = (value) => pad + ((value - 1) / 4) * (width - pad * 2);
    const yScale = (value) => height - pad - ((value - 1) / 4) * (height - pad * 2);

    container.querySelector("#map-main").innerHTML = `
      <p class="muted">有効データ ${valid.length}件（1-5以外の苦味/酸味は除外）</p>
      <svg id="taste-bubble" viewBox="0 0 ${width} ${height}" role="img" aria-label="苦味と酸味のバブルマップ"></svg>`;

    const svg = d3.select(container.querySelector("#taste-bubble"));
    svg.append("line").attr("x1", pad).attr("y1", height - pad).attr("x2", width - pad).attr("y2", height - pad).attr("stroke", "#b6aaa0");
    svg.append("line").attr("x1", pad).attr("y1", pad).attr("x2", pad).attr("y2", height - pad).attr("stroke", "#b6aaa0");
    [1, 2, 3, 4, 5].forEach((v) => {
      svg.append("text").attr("x", xScale(v)).attr("y", height - 14).attr("text-anchor", "middle").attr("font-size", 12).text(v);
      svg.append("text").attr("x", 20).attr("y", yScale(v) + 4).attr("text-anchor", "middle").attr("font-size", 12).text(v);
    });
    svg.append("text").attr("x", width / 2).attr("y", height - 2).attr("text-anchor", "middle").attr("font-size", 13).text("酸味");
    svg.append("text").attr("x", 16).attr("y", 20).attr("font-size", 13).text("苦味");

    const circles = svg.selectAll("circle").data(points).enter().append("circle")
      .attr("cx", (d) => xScale(d.acid))
      .attr("cy", (d) => yScale(d.bitter))
      .attr("r", (d) => 8 + (Math.sqrt(d.n / maxN) * 24))
      .attr("fill", "#c8783b")
      .attr("fill-opacity", 0.55)
      .attr("stroke", "#8b3f1f")
      .style("cursor", "pointer")
      .on("click", (_event, d) => {
        ui.detail = d.records;
        renderDetail();
      });

    circles.append("title").text((d) => `苦味${d.bitter} / 酸味${d.acid} / ${d.n}件`);
  }

  function renderCategoryMap(records) {
    const controls = container.querySelector("#map-extra-controls");
    const axisOptions = MAP_AXES.map((axis) => `<option value="${axis.key}" ${axis.key === ui.axis1 ? "selected" : ""}>${axis.label}</option>`).join("");
    const axis2Options = MAP_AXES.filter((axis) => axis.key !== ui.axis1).map((axis) => `<option value="${axis.key}" ${axis.key === ui.axis2 ? "selected" : ""}>${axis.label}</option>`).join("");
    controls.innerHTML = `
      <div><label>Axis1</label><select id="map-axis1">${axisOptions}</select></div>
      <div><label>Axis2</label><select id="map-axis2">${axis2Options}</select></div>
      <div><label>対象評価セット</label><select id="map-target-set"><option value="S" ${ui.targetSet === "S" ? "selected" : ""}>Sのみ</option><option value="SA" ${ui.targetSet === "SA" ? "selected" : ""}>S + A</option></select></div>`;

    controls.querySelector("#map-axis1").addEventListener("change", (event) => { ui.axis1 = event.target.value; render(); });
    controls.querySelector("#map-axis2").addEventListener("change", (event) => { ui.axis2 = event.target.value; render(); });
    controls.querySelector("#map-target-set").addEventListener("change", (event) => { ui.targetSet = event.target.value; render(); });

    const axis1 = MAP_AXES.find((axis) => axis.key === ui.axis1) || MAP_AXES[0];
    const axis2 = MAP_AXES.find((axis) => axis.key === ui.axis2) || MAP_AXES[1];
    const rows = [...new Set(records.map((record) => axis1.getValue(record)))].sort((a, b) => String(a).localeCompare(String(b), "ja"));
    const cols = [...new Set(records.map((record) => axis2.getValue(record)))].sort((a, b) => String(a).localeCompare(String(b), "ja"));
    const overallHitRate = records.length ? records.filter((record) => isHit(record, ui.targetSet)).length / records.length : 0;

    const table = rows.map((row) => {
      const cells = cols.map((col) => {
        const list = records.filter((record) => axis1.getValue(record) === row && axis2.getValue(record) === col);
        const n = list.length;
        const cls = sampleClass(n);
        if (cls === "insufficient") return `<td title="n=${n}">—</td>`;
        const hitRate = n ? list.filter((record) => isHit(record, ui.targetSet)).length / n : 0;
        const deltaPt = hitRate - overallHitRate;
        const note = cls === "small" ? " (参考)" : "";
        return `<td class="expandable" data-map-detail='${encodeURIComponent(JSON.stringify(list))}' title="n=${n}">${formatRate(hitRate)} / Δ${(deltaPt * 100).toFixed(1)}pt / n=${n}${note}</td>`;
      }).join("");
      return `<tr><th>${row}</th>${cells}</tr>`;
    }).join("");

    container.querySelector("#map-main").innerHTML = `<p class="muted">n&lt;3 は “—” 表示。全体基準 hitRate: ${formatRate(overallHitRate)}</p><div class="table-wrap"><table><thead><tr><th>${axis1.label} \\ ${axis2.label}</th>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${table || "<tr><td>データなし</td></tr>"}</tbody></table></div>`;
    container.querySelectorAll("[data-map-detail]").forEach((cell) => {
      cell.addEventListener("click", () => {
        ui.detail = JSON.parse(decodeURIComponent(cell.dataset.mapDetail));
        renderDetail();
      });
    });
  }

  function render() {
    const records = filteredRecords();
    const controls = container.querySelector("#map-extra-controls");
    if (ui.mapType === "taste") {
      controls.innerHTML = "";
      renderTasteBubble(records);
    } else {
      renderCategoryMap(records);
    }
    renderDetail();
  }

  renderRatingFilters();
  container.querySelector("#map-type").addEventListener("change", (event) => {
    ui.mapType = event.target.value;
    render();
  });

  return { render };
}
