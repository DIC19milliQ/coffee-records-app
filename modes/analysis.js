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

function bucketizeRows(records, axis1, targetSet, overallTargetCount, topN = 15) {
  const byKey = new Map();
  records.forEach((record) => {
    const key = axis1.getValue(record);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(record);
  });
  const allRows = [...byKey.entries()].map(([key, items]) => summarizeCell(items, records.length, targetSet, key, overallTargetCount));
  const sortedBySize = [...allRows].sort((a, b) => b.n - a.n || b.hitRate - a.hitRate);
  const majorKeys = new Set(sortedBySize.slice(0, topN).map((row) => row.key));
  const majorRows = allRows.filter((row) => majorKeys.has(row.key));
  const otherRecords = records.filter((record) => !majorKeys.has(axis1.getValue(record)));
  const otherRow = otherRecords.length ? summarizeCell(otherRecords, records.length, targetSet, "その他", overallTargetCount) : null;
  return [...majorRows.sort((a, b) => b.deltaPt - a.deltaPt || b.n - a.n), ...(otherRow ? [otherRow] : [])];
}

function summarizeCell(records, allCount, targetSet, key, overallTargetCount) {
  const n = records.length;
  const hitCount = records.filter((record) => isHit(record, targetSet)).length;
  const overallHitCount = overallTargetCount;
  const hitRate = n ? hitCount / n : 0;
  const overallHitRate = allCount ? overallHitCount / allCount : 0;
  const deltaPt = hitRate - overallHitRate;
  const shareInTarget = overallHitCount ? hitCount / overallHitCount : 0;
  return { key, n, hitCount, hitRate, overallHitRate, deltaPt, shareInTarget, records };
}

function sampleClass(n) {
  if (n < 3) return "insufficient";
  if (n < 5) return "small";
  return "ok";
}

function formatRate(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function renderMetric(cell, allowInsufficient = false) {
  const cls = sampleClass(cell.n);
  if (cls === "insufficient" && !allowInsufficient) return "—";
  return `${formatRate(cell.hitRate)} / Δ${(cell.deltaPt * 100).toFixed(1)}pt / n=${cell.n}`;
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
    selectedDetail: []
  };

  container.innerHTML = `
    <div class="card">
      <h2>分析モード（意思決定用）</h2>
      <p class="muted">注記: n&lt;3 はサンプル不足で “—” 表示、3≦n&lt;5 は参考表示です。</p>
      <div class="analysis-controls">
        <div>
          <label>1) 対象評価セット</label>
          <select id="analysis-target-set">
            <option value="S">Sのみ</option>
            <option value="SA">S + A</option>
          </select>
        </div>
        <div>
          <label>2) 分析タイプ</label>
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
    <div class="card">
      <h3>詳細パネル</h3>
      <p class="muted">行/セルを選択すると該当する豆を表示します。</p>
      <div class="table-wrap"><table><thead><tr><th>豆</th><th>国</th><th>焙煎</th><th>精製</th><th>苦味</th><th>酸味</th><th>評価</th><th>メモ</th></tr></thead><tbody id="analysis-detail"></tbody></table></div>
    </div>`;

  function axisByKey(key) {
    return AXES.find((axis) => axis.key === key) || AXES[0];
  }

  function selectHtml(id, value, options) {
    const optionHtml = options.map((option) => `<option value="${option.value}" ${option.value === value ? "selected" : ""}>${option.label}</option>`).join("");
    return `<div><label>${id}</label><select id="${id}">${optionHtml}</select></div>`;
  }

  function updateAxisControls() {
    const axisOptions = AXES.map((axis) => ({ value: axis.key, label: axis.label }));
    const root = container.querySelector("#axis-controls");
    let html = selectHtml("analysis-axis1", ui.axis1, axisOptions);
    if (ui.type !== "one") html += selectHtml("analysis-axis2", ui.axis2, axisOptions.filter((option) => option.value !== ui.axis1));
    if (ui.type === "two-filter") {
      html += selectHtml("analysis-filter-axis", ui.filterAxis, axisOptions.filter((option) => option.value !== ui.axis1 && option.value !== ui.axis2));
      const values = [...new Set(state.records.map((record) => axisByKey(ui.filterAxis).getValue(record)))].sort((a, b) => String(a).localeCompare(String(b), "ja"));
      const valueOptions = values.map((value) => ({ value, label: String(value) }));
      if (!values.includes(ui.filterValue)) ui.filterValue = values[0] || "";
      html += selectHtml("analysis-filter-value", ui.filterValue, valueOptions);
    }
    root.innerHTML = html;
    root.querySelector("#analysis-axis1")?.addEventListener("change", (event) => {
      ui.axis1 = event.target.value;
      if (ui.axis2 === ui.axis1) ui.axis2 = AXES.find((axis) => axis.key !== ui.axis1)?.key || ui.axis1;
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

  function attachDetailClickHandlers() {
    container.querySelectorAll("[data-detail-index]").forEach((row) => {
      row.addEventListener("click", () => {
        const index = Number(row.dataset.detailIndex);
        if (Number.isInteger(index)) {
          const details = JSON.parse(decodeURIComponent(row.dataset.detailPayload || "[]"));
          ui.selectedDetail = details;
          renderDetail();
        }
      });
    });
  }

  function renderDetail() {
    const tbody = container.querySelector("#analysis-detail");
    tbody.innerHTML = "";
    if (!ui.selectedDetail.length) {
      tbody.innerHTML = "<tr><td colspan='8' class='muted'>未選択</td></tr>";
      return;
    }
    ui.selectedDetail.forEach((record) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${display(record.bean)}</td><td>${display(record.country)}</td><td>${display(record.roast)}</td><td>${display(record.process)}</td><td>${display(record.bitter)}</td><td>${display(record.acid)}</td><td>${display(record.rating)}</td><td>${display(record.note)}</td>`;
      tbody.appendChild(tr);
    });
  }

  function renderOneAxis(records) {
    const axis1 = axisByKey(ui.axis1);
    const overallTargetCount = records.filter((record) => isHit(record, ui.targetSet)).length;
    const rows = bucketizeRows(records, axis1, ui.targetSet, overallTargetCount);
    const result = container.querySelector("#analysis-result");
    const htmlRows = rows.map((row, index) => {
      const cls = sampleClass(row.n);
      const note = cls === "insufficient" ? "サンプル不足" : cls === "small" ? "参考" : "";
      const metric = cls === "insufficient" ? "—" : `${formatRate(row.hitRate)} / Δ${(row.deltaPt * 100).toFixed(1)}pt`;
      return `<tr class="expandable ${cls}" data-detail-index="${index}" data-detail-payload='${encodeURIComponent(JSON.stringify(row.records))}'><td>${row.key}</td><td>${row.n}</td><td>${metric}</td><td>${formatRate(row.shareInTarget)}</td><td>${note}</td></tr>`;
    }).join("");
    result.innerHTML = `<h3>結果: 1軸 (${axis1.label})</h3><div class="table-wrap"><table><thead><tr><th>カテゴリ</th><th>n</th><th>hitRate / deltaPt</th><th>shareInTarget</th><th>注記</th></tr></thead><tbody>${htmlRows || "<tr><td colspan='5'>データなし</td></tr>"}</tbody></table></div>`;
    attachDetailClickHandlers();
  }

  function renderTwoAxis(records) {
    const axis1 = axisByKey(ui.axis1);
    const axis2 = axisByKey(ui.axis2);
    const rows = [...new Set(records.map((record) => axis1.getValue(record)))].sort((a, b) => String(a).localeCompare(String(b), "ja"));
    const cols = [...new Set(records.map((record) => axis2.getValue(record)))].sort((a, b) => String(a).localeCompare(String(b), "ja"));
    const matrix = new Map();
    const overallTargetCount = records.filter((record) => isHit(record, ui.targetSet)).length;
    rows.forEach((rowKey) => {
      cols.forEach((colKey) => {
        const cellRecords = records.filter((record) => axis1.getValue(record) === rowKey && axis2.getValue(record) === colKey);
        matrix.set(`${rowKey}__${colKey}`, summarizeCell(cellRecords, records.length, ui.targetSet, `${rowKey}/${colKey}`, overallTargetCount));
      });
    });
    let detailIndex = 0;
    const bodyHtml = rows.map((rowKey) => {
      const cells = cols.map((colKey) => {
        const cell = matrix.get(`${rowKey}__${colKey}`);
        const metric = renderMetric(cell);
        const canShow = metric !== "—";
        const note = sampleClass(cell.n) === "small" ? " (参考)" : "";
        const attrs = canShow ? `class="expandable" data-detail-index="${detailIndex++}" data-detail-payload='${encodeURIComponent(JSON.stringify(cell.records))}'` : "";
        return `<td ${attrs} title="n=${cell.n}">${metric}${canShow ? note : ""}</td>`;
      }).join("");
      return `<tr><th>${rowKey}</th>${cells}</tr>`;
    }).join("");
    const headHtml = cols.map((col) => `<th>${col}</th>`).join("");
    const result = container.querySelector("#analysis-result");
    result.innerHTML = `<h3>結果: ${axis1.label} × ${axis2.label}</h3><div class="table-wrap"><table><thead><tr><th>${axis1.label} \ ${axis2.label}</th>${headHtml}</tr></thead><tbody>${bodyHtml || "<tr><td>データなし</td></tr>"}</tbody></table></div>`;
    attachDetailClickHandlers();
  }

  function render() {
    const all = state.records;
    const filtered = ui.type === "two-filter"
      ? all.filter((record) => axisByKey(ui.filterAxis).getValue(record) === ui.filterValue)
      : all;
    const targetCount = filtered.filter((record) => isHit(record, ui.targetSet)).length;
    const overallHitRate = filtered.length ? targetCount / filtered.length : 0;
    container.querySelector("#analysis-overall").textContent = `全体基準 hitRate: ${formatRate(overallHitRate)} （対象 ${ui.targetSet === "S" ? "S" : "S+A"} / 全${filtered.length}件）`;
    updateAxisControls();
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
