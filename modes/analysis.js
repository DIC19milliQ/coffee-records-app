import { normalizeText, validTaste, display } from "../shared/utils.js";

const AXES = [
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

function isHit(record, targetSet) {
  const rating = normalizeText(record.rating).toUpperCase();
  return targetSet === "S" ? rating === "S" : rating === "S" || rating === "A";
}

function sampleClass(n) {
  if (n < 3) return "insufficient";
  if (n < 5) return "small";
  return "ok";
}

function formatRate(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function sortByHitRate(rows) {
  return [...rows].sort((a, b) => b.hitRate - a.hitRate || b.n - a.n || String(a.key).localeCompare(String(b.key), "ja"));
}

function summarize(records, allCount, targetSet, key, overallHitRate = 0) {
  const n = records.length;
  const hitCount = records.filter((record) => isHit(record, targetSet)).length;
  const hitRate = n ? hitCount / n : 0;
  return {
    key,
    n,
    hitCount,
    hitRate,
    deltaPt: hitRate - overallHitRate,
    counts: {
      S: records.filter((record) => normalizeText(record.rating).toUpperCase() === "S").length,
      A: records.filter((record) => normalizeText(record.rating).toUpperCase() === "A").length,
      B: records.filter((record) => normalizeText(record.rating).toUpperCase() === "B").length,
      C: records.filter((record) => normalizeText(record.rating).toUpperCase() === "C").length
    },
    records
  };
}

function getCellDisplay(cell) {
  if (cell.n < 3) return { rateText: "—", nText: "", className: "insufficient", canClick: false };
  if (cell.n < 5) return { rateText: formatRate(cell.hitRate), nText: `(n=${cell.n})`, className: "small", canClick: true };
  return { rateText: formatRate(cell.hitRate), nText: `n=${cell.n}`, className: "ok", canClick: true };
}

export function initAnalysis(container, context) {
  const { state } = context;
  const ui = {
    targetSet: "S",
    type: "one",
    axis1: "country",
    axis2: "process",
    filterAxis: "roast",
    filterValue: "",
    detailRecords: [],
    detailSummary: null,
    overallHitRate: 0
  };

  container.innerHTML = `
    <div class="card">
      <h2>分析モード（意思決定用）</h2>
      <p class="muted">サンプル基準：n&lt;3は表示なし、3–4は参考表示</p>
      <div class="analysis-controls">
        <div>
          <label>対象評価セット</label>
          <select id="analysis-target-set">
            <option value="S">Sのみ</option>
            <option value="SA">S + A</option>
          </select>
        </div>
        <div>
          <label>分析タイプ</label>
          <select id="analysis-type">
            <option value="one">1軸</option>
            <option value="two">2軸</option>
            <option value="two-filter">2軸 + フィルタ</option>
          </select>
        </div>
      </div>
      <div class="analysis-controls" id="axis-controls"></div>
      <p id="analysis-overall" class="muted"></p>
    </div>
    <div class="card" id="analysis-result"></div>
    <div class="card analysis-detail-panel">
      <h3>詳細パネル</h3>
      <div id="analysis-detail-summary" class="muted">行/セルを選択すると詳細を表示します。</div>
      <div class="table-wrap detail-scroll"><table><thead><tr><th>bean</th><th>rating</th><th>roast</th><th>process</th><th>note</th></tr></thead><tbody id="analysis-detail"></tbody></table></div>
    </div>`;

  function axisByKey(key) {
    return AXES.find((axis) => axis.key === key) || AXES[0];
  }

  function selectHtml(id, label, value, options) {
    const optionHtml = options.map((option) => `<option value="${option.value}" ${option.value === value ? "selected" : ""}>${option.label}</option>`).join("");
    return `<div><label>${label}</label><select id="${id}">${optionHtml}</select></div>`;
  }

  function updateAxisControls() {
    const axisOptions = AXES.map((axis) => ({ value: axis.key, label: axis.label }));
    const root = container.querySelector("#axis-controls");
    let html = selectHtml("analysis-axis1", "Axis1", ui.axis1, axisOptions);

    if (ui.type !== "one") {
      const axis2Options = axisOptions.filter((option) => option.value !== ui.axis1);
      if (!axis2Options.some((option) => option.value === ui.axis2)) ui.axis2 = axis2Options[0]?.value || ui.axis2;
      html += selectHtml("analysis-axis2", "Axis2", ui.axis2, axis2Options);
    }

    if (ui.type === "two-filter") {
      const filterAxisOptions = axisOptions.filter((option) => option.value !== ui.axis1 && option.value !== ui.axis2);
      if (!filterAxisOptions.some((option) => option.value === ui.filterAxis)) ui.filterAxis = filterAxisOptions[0]?.value || ui.filterAxis;
      html += selectHtml("analysis-filter-axis", "FilterAxis", ui.filterAxis, filterAxisOptions);

      const values = [...new Set(state.records.map((record) => axisByKey(ui.filterAxis).getValue(record)))].sort((a, b) => String(a).localeCompare(String(b), "ja"));
      if (!values.includes(ui.filterValue)) ui.filterValue = values[0] || "";
      const valueOptions = values.map((value) => ({ value, label: String(value) }));
      html += selectHtml("analysis-filter-value", "FilterValue", ui.filterValue, valueOptions);
    }

    root.innerHTML = html;
    root.querySelector("#analysis-axis1")?.addEventListener("change", (event) => {
      ui.axis1 = event.target.value;
      render();
    });
    root.querySelector("#analysis-axis2")?.addEventListener("change", (event) => {
      ui.axis2 = event.target.value;
      render();
    });
    root.querySelector("#analysis-filter-axis")?.addEventListener("change", (event) => {
      ui.filterAxis = event.target.value;
      ui.filterValue = "";
      render();
    });
    root.querySelector("#analysis-filter-value")?.addEventListener("change", (event) => {
      ui.filterValue = event.target.value;
      render();
    });
  }

  function setDetail(records, label) {
    const detailSummary = summarize(records, records.length, ui.targetSet, label, ui.overallHitRate);
    ui.detailRecords = records;
    ui.detailSummary = detailSummary;
    renderDetail();
  }

  function attachDetailHandlers() {
    container.querySelectorAll("[data-analysis-detail]").forEach((node) => {
      node.addEventListener("click", () => {
        const records = JSON.parse(decodeURIComponent(node.dataset.analysisDetail || "[]"));
        const label = decodeURIComponent(node.dataset.analysisLabel || "");
        setDetail(records, label || "選択項目");
      });
    });
  }

  function renderDetail() {
    const tbody = container.querySelector("#analysis-detail");
    const summaryEl = container.querySelector("#analysis-detail-summary");
    if (!ui.detailRecords.length || !ui.detailSummary) {
      summaryEl.textContent = "行/セルを選択すると詳細を表示します。";
      tbody.innerHTML = "<tr><td colspan='5' class='muted'>未選択</td></tr>";
      return;
    }

    summaryEl.innerHTML = `<strong>${display(ui.detailSummary.key)}</strong> | S:${ui.detailSummary.counts.S} / A:${ui.detailSummary.counts.A} / B:${ui.detailSummary.counts.B} / C:${ui.detailSummary.counts.C} | 当たり率 ${formatRate(ui.detailSummary.hitRate)} | 平均差 ${(ui.detailSummary.deltaPt * 100).toFixed(1)}pt`;

    tbody.innerHTML = ui.detailRecords.map((record) => `<tr><td>${display(record.bean)}</td><td>${display(record.rating)}</td><td>${display(record.roast)}</td><td>${display(record.process)}</td><td>${display(record.note)}</td></tr>`).join("");
  }

  function renderOneAxis(records) {
    const axis1 = axisByKey(ui.axis1);
    const rawRows = [...new Map(records.map((record) => [axis1.getValue(record), null])).keys()].map((key) => {
      const items = records.filter((record) => axis1.getValue(record) === key);
      return summarize(items, records.length, ui.targetSet, key, ui.overallHitRate);
    });

    const sorted = sortByHitRate(rawRows);
    const topRows = sorted.slice(0, 15);
    const topKeys = new Set(topRows.map((row) => row.key));
    const otherRecords = records.filter((record) => !topKeys.has(axis1.getValue(record)));
    const rows = otherRecords.length ? [...topRows, summarize(otherRecords, records.length, ui.targetSet, "その他", ui.overallHitRate)] : topRows;

    const body = rows.map((row) => {
      const displayCell = getCellDisplay(row);
      return `<tr class="expandable ${displayCell.className}" data-analysis-detail="${encodeURIComponent(JSON.stringify(row.records))}" data-analysis-label="${encodeURIComponent(String(row.key))}">
        <td>${display(row.key)}</td>
        <td>
          <div class="metric-main">${displayCell.rateText}</div>
          <div class="metric-sub">${displayCell.nText || `n=${row.n}`}</div>
        </td>
      </tr>`;
    }).join("");

    container.querySelector("#analysis-result").innerHTML = `
      <h3>主結果（1軸: ${axis1.label}）</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>カテゴリ</th><th>当たり率 / n</th></tr></thead>
        <tbody>${body || "<tr><td colspan='2'>データなし</td></tr>"}</tbody>
      </table></div>`;

    attachDetailHandlers();
  }

  function renderTwoAxis(records) {
    const axis1 = axisByKey(ui.axis1);
    const axis2 = axisByKey(ui.axis2);
    const rowKeys = [...new Set(records.map((record) => axis1.getValue(record)))].sort((a, b) => String(a).localeCompare(String(b), "ja"));
    const colKeys = [...new Set(records.map((record) => axis2.getValue(record)))].sort((a, b) => String(a).localeCompare(String(b), "ja"));

    const cells = rowKeys.flatMap((rowKey) => colKeys.map((colKey) => {
      const list = records.filter((record) => axis1.getValue(record) === rowKey && axis2.getValue(record) === colKey);
      return { rowKey, colKey, summary: summarize(list, records.length, ui.targetSet, `${rowKey} × ${colKey}`, ui.overallHitRate) };
    }));

    const gridTemplate = `180px repeat(${Math.max(colKeys.length, 1)}, minmax(90px, 1fr))`;
    const headCols = colKeys.map((colKey) => `<div class="heatmap-col-header">${display(colKey)}</div>`).join("");
    const rowsHtml = rowKeys.map((rowKey) => {
      const rowCells = colKeys.map((colKey) => {
        const cell = cells.find((item) => item.rowKey === rowKey && item.colKey === colKey)?.summary;
        if (!cell) return "<div class='heatmap-cell empty'>—</div>";
        const displayCell = getCellDisplay(cell);
        const opacity = cell.n < 3 ? 0.2 : Math.max(0.22, cell.hitRate);
        return `<button type="button" class="heatmap-cell ${displayCell.className} ${displayCell.canClick ? "clickable" : ""}" style="--heat:${opacity};" ${displayCell.canClick ? `data-analysis-detail="${encodeURIComponent(JSON.stringify(cell.records))}" data-analysis-label="${encodeURIComponent(`${rowKey} × ${colKey}`)}"` : "disabled"}>
            <div class="metric-main">${displayCell.rateText}</div>
            <div class="metric-sub">${displayCell.nText || `n=${cell.n}`}</div>
          </button>`;
      }).join("");
      return `<div class="heatmap-row-label">${display(rowKey)}</div>${rowCells}`;
    }).join("");

    container.querySelector("#analysis-result").innerHTML = `
      <h3>主結果（${axis1.label} × ${axis2.label}）</h3>
      <div class="analysis-heatmap" style="grid-template-columns:${gridTemplate};">
        <div></div>
        ${headCols}
        ${rowsHtml}
      </div>`;

    attachDetailHandlers();
  }

  function render() {
    const all = state.records;
    updateAxisControls();
    const filtered = ui.type === "two-filter" ? all.filter((record) => axisByKey(ui.filterAxis).getValue(record) === ui.filterValue) : all;
    const targetCount = filtered.filter((record) => isHit(record, ui.targetSet)).length;
    ui.overallHitRate = filtered.length ? targetCount / filtered.length : 0;
    container.querySelector("#analysis-overall").textContent = `全体当たり率: ${formatRate(ui.overallHitRate)}（対象 ${ui.targetSet === "S" ? "S" : "S+A"} / 全${filtered.length}件）`;

    if (ui.type === "one") renderOneAxis(filtered);
    else renderTwoAxis(filtered);

    renderDetail();
  }

  container.querySelector("#analysis-target-set").addEventListener("change", (event) => {
    ui.targetSet = event.target.value;
    render();
  });
  container.querySelector("#analysis-type").addEventListener("change", (event) => {
    ui.type = event.target.value;
    render();
  });

  return { render };
}
