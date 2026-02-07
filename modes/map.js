import { normalizeText } from "../shared/utils.js";

const RATING_SCORE = { S: 5, A: 3, B: 1 };

function parseAltitude(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const range = text.match(/(\d+(?:\.\d+)?)\s*[-〜~]\s*(\d+(?:\.\d+)?)/);
  if (range) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    if (Number.isFinite(low) && Number.isFinite(high)) return (low + high) / 2;
  }
  const single = Number(text.replace(/m$/i, "").trim());
  return Number.isFinite(single) ? single : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatMetric(metric, value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (metric === "sRatio") return `${(value * 100).toFixed(1)}%`;
  if (metric === "avgRating") return value.toFixed(1);
  if (metric === "altitudeMedian") return `${Math.round(value)}m`;
  return `${Math.round(value)}`;
}

function normalizeLoose(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]/g, "");
}

function scoreCandidate(queryNorm, candidateNorm) {
  if (!queryNorm || !candidateNorm) return 0;
  if (candidateNorm === queryNorm) return 120;
  if (candidateNorm.startsWith(queryNorm)) return 100;
  if (candidateNorm.includes(queryNorm)) return 70;
  if (queryNorm.includes(candidateNorm)) return 30;
  return 0;
}

export function initMap(container, context) {
  const { state, loadMapping, saveMapping, countryNormalization, openSearchWithCountry } = context;
  const isoCandidates = countryNormalization.records.map((record) => ({ code: record.iso2, name: record.enName }));
  const ui = { metric: "uniqueBeans", selectedCountryIso2: "", manageFilter: "", suggestionList: [] };

  container.innerHTML = `
    <div class="card">
      <h2>コンプリート地図</h2>
      <p class="muted">コーヒーベルトを初期表示。指標切替で国ごとの傾向を確認できます。</p>
      <div class="map-toolbar">
        <label>色分け指標
          <select id="metric-select">
            <option value="uniqueBeans">ユニーク豆数</option>
            <option value="totalRecords">総記録数</option>
            <option value="avgRating">平均評価</option>
            <option value="altitudeMedian">標高中央値</option>
            <option value="sRatio">S比率</option>
          </select>
        </label>
        <button id="fit-world" class="ghost">世界全体</button>
        <button id="open-mapping" class="ghost">マッピング管理</button>
      </div>
      <div class="map-layout">
        <div>
          <div id="map"></div>
          <div class="legend"><span>少ない</span><div class="legend-bar"></div><span>多い</span></div>
        </div>
        <aside id="country-drawer" class="country-drawer"><p class="muted">地図上の国をクリックすると詳細を表示します。</p></aside>
      </div>
    </div>
    <div class="card">
      <h3>未マッピングの国</h3>
      <p class="muted">現行レイアウトを維持しつつ、候補サジェストで登録を高速化しています。</p>
      <div id="unmapped-list"></div>
      <div class="grid-2" style="margin-top:12px;">
        <div><label>対象国</label><select id="unmapped-select"></select></div>
        <div>
          <label>マップキー（ISO2推奨）</label>
          <input id="mapping-input" type="text" placeholder="例: BR / Brazil" />
          <div id="mapping-hint" class="muted" style="font-size:12px;margin-top:4px;"></div>
          <div id="mapping-suggest" class="suggestions"></div>
        </div>
      </div>
      <button id="save-mapping" style="margin-top:12px;">マッピング保存</button>
    </div>
    <dialog id="mapping-dialog">
      <div class="dialog-body">
        <h3 style="margin-top:0;">マッピング管理</h3>
        <input id="mapping-search" type="text" placeholder="国名/ISO2で検索" />
        <div class="table-wrap" style="margin-top:10px;max-height:50vh;overflow:auto;">
          <table>
            <thead><tr><th>country表記</th><th>ISO2</th><th>件数</th><th>編集</th><th>削除</th></tr></thead>
            <tbody id="mapping-table"></tbody>
          </table>
        </div>
      </div>
      <div class="dialog-actions">
        <button id="close-mapping" class="ghost">閉じる</button>
      </div>
    </dialog>
  `;

  let mapApi = null;

  async function loadWorldData() {
    if (state.worldFeatures) return state.worldFeatures;
    const response = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
    const topo = await response.json();
    const features = topojson.feature(topo, topo.objects.countries).features;
    state.worldFeatures = features;
    return features;
  }

  function resolveSavedMappingToIso2(rawCountry) {
    const mapped = state.mapping[rawCountry];
    if (!mapped) return null;
    return countryNormalization.resolveToIso2(mapped);
  }

  function normalizeMappingTable() {
    let changed = false;
    Object.entries(state.mapping).forEach(([rawCountry, mapped]) => {
      const iso2 = countryNormalization.resolveToIso2(mapped);
      if (iso2 && mapped !== iso2) {
        state.mapping[rawCountry] = iso2;
        changed = true;
      }
    });
    if (changed) saveMapping(state.mapping);
  }

  function parseRatingScore(record) {
    const rating = normalizeText(record.rating).toUpperCase();
    if (!rating) return null;
    if (RATING_SCORE[rating] !== undefined) return RATING_SCORE[rating];
    return 0;
  }

  function buildCountryAggregation() {
    const byRawCountry = new Map();
    state.records.forEach((record) => {
      const rawCountry = String(record.country || "").trim();
      if (!rawCountry) return;
      if (!byRawCountry.has(rawCountry)) byRawCountry.set(rawCountry, []);
      byRawCountry.get(rawCountry).push(record);
    });

    const byMapCountry = new Map();
    const unmapped = [];
    byRawCountry.forEach((records, rawCountry) => {
      const iso2 = resolveSavedMappingToIso2(rawCountry);
      if (!iso2) {
        unmapped.push({ name: rawCountry, count: records.length });
        return;
      }
      if (!byMapCountry.has(iso2)) byMapCountry.set(iso2, { records: [], rawCountries: [] });
      const slot = byMapCountry.get(iso2);
      slot.records.push(...records);
      slot.rawCountries.push(rawCountry);
    });

    const aggregated = new Map();
    byMapCountry.forEach((entry, iso2) => {
      const beanCounts = new Map();
      const altitudeValues = [];
      let ratedCount = 0;
      let ratingTotal = 0;
      let sCount = 0;
      entry.records.forEach((record) => {
        const bean = String(record.bean || "").trim();
        if (bean) beanCounts.set(bean, (beanCounts.get(bean) || 0) + 1);
        const score = parseRatingScore(record);
        if (score !== null) {
          ratedCount += 1;
          ratingTotal += score;
        }
        if (normalizeText(record.rating).toUpperCase() === "S") sCount += 1;
        const altitude = parseAltitude(record.altitude);
        if (Number.isFinite(altitude)) altitudeValues.push(altitude);
      });
      const topBeans = [...beanCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      aggregated.set(iso2, {
        iso2,
        countryName: countryNormalization.getRecord(iso2)?.enName || iso2,
        rawCountries: [...new Set(entry.rawCountries)],
        totalRecords: entry.records.length,
        uniqueBeans: beanCounts.size,
        avgRating: ratedCount ? ratingTotal / ratedCount : null,
        altitudeMedian: median(altitudeValues),
        sRatio: entry.records.length ? sCount / entry.records.length : null,
        topBeans
      });
    });

    return { aggregated, unmapped: unmapped.sort((a, b) => b.count - a.count) };
  }

  function metricValue(stats, metric) {
    return stats?.[metric] ?? null;
  }

  function renderUnmapped(unmapped) {
    const list = container.querySelector("#unmapped-list");
    const select = container.querySelector("#unmapped-select");
    list.innerHTML = "";
    select.innerHTML = "";
    if (!unmapped.length) {
      list.textContent = "すべてマッピング済みです。";
      return;
    }
    const chips = document.createElement("div");
    chips.style.display = "flex";
    chips.style.flexWrap = "wrap";
    chips.style.gap = "6px";
    unmapped.forEach((entry) => {
      const chip = document.createElement("span");
      chip.className = "pill";
      chip.textContent = `${entry.name} (${entry.count})`;
      chips.appendChild(chip);
      const option = document.createElement("option");
      option.value = entry.name;
      option.textContent = entry.name;
      select.appendChild(option);
    });
    list.appendChild(chips);
  }

  function getSuggestions(text, selectedCountry) {
    const query = normalizeLoose(text || selectedCountry);
    if (!query) return [];
    return isoCandidates
      .map((candidate) => {
        const nameNorm = normalizeLoose(candidate.name);
        const codeNorm = normalizeLoose(candidate.code);
        const score = Math.max(scoreCandidate(query, nameNorm), scoreCandidate(query, codeNorm));
        return { ...candidate, score };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "en"))
      .slice(0, 5);
  }

  function renderSuggestions() {
    const host = container.querySelector("#mapping-suggest");
    host.innerHTML = "";
    if (!ui.suggestionList.length) return;
    ui.suggestionList.forEach((candidate) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suggestion-item";
      button.textContent = `${candidate.name} (${candidate.code})`;
      button.addEventListener("click", () => {
        container.querySelector("#mapping-input").value = candidate.code;
        ui.suggestionList = [];
        renderSuggestions();
        renderInputHint(candidate.code);
      });
      host.appendChild(button);
    });
  }

  function renderInputHint(value) {
    const hint = container.querySelector("#mapping-hint");
    const iso2 = countryNormalization.resolveToIso2(value);
    if (!iso2) {
      hint.textContent = "";
      return;
    }
    const rec = countryNormalization.getRecord(iso2);
    const ja = rec?.aliases?.find((alias) => /[\u3040-\u30ff\u4e00-\u9faf]/.test(alias));
    hint.textContent = `${iso2}: ${rec?.enName || iso2}${ja ? ` / ${ja}` : ""}`;
  }

  function renderDrawer(stats) {
    const drawer = container.querySelector("#country-drawer");
    if (!stats) {
      drawer.innerHTML = `<p class="muted">地図上の国をクリックすると詳細を表示します。</p>`;
      return;
    }
    const beans = stats.topBeans.length
      ? stats.topBeans.map(([name, count]) => `<li><strong>${name}</strong><span class="muted"> × ${count}</span></li>`).join("")
      : "<li class='muted'>豆データなし</li>";
    const openCountry = stats.rawCountries[0] || stats.countryName;
    drawer.innerHTML = `
      <h3 style="margin-top:0;">${stats.countryName} (${stats.iso2})</h3>
      <div class="drawer-metrics">
        <div><span class="muted">総記録数</span><strong>${stats.totalRecords}</strong></div>
        <div><span class="muted">ユニーク豆数</span><strong>${stats.uniqueBeans}</strong></div>
        <div><span class="muted">平均評価</span><strong>${formatMetric("avgRating", stats.avgRating)}</strong></div>
        <div><span class="muted">標高中央値</span><strong>${formatMetric("altitudeMedian", stats.altitudeMedian)}</strong></div>
        <div><span class="muted">S比率</span><strong>${formatMetric("sRatio", stats.sRatio)}</strong></div>
      </div>
      <p class="muted" style="margin:10px 0 6px;">登録名: ${stats.rawCountries.join(", ") || "-"}</p>
      <button id="open-search-country" class="ghost" style="width:100%;">Searchでこの国を開く</button>
      <h4 style="margin-bottom:6px;">豆一覧（上位10）</h4>
      <ol class="country-beans">${beans}</ol>
    `;
    drawer.querySelector("#open-search-country")?.addEventListener("click", () => openSearchWithCountry?.(openCountry));
  }

  function renderMappingManagement(unmapped) {
    const table = container.querySelector("#mapping-table");
    const filter = normalizeLoose(ui.manageFilter);
    const countsByRaw = new Map(unmapped.map((entry) => [entry.name, entry.count]));
    const rows = Object.entries(state.mapping)
      .map(([country, mapped]) => {
        const iso2 = countryNormalization.resolveToIso2(mapped);
        return {
          country,
          mapped: iso2 || String(mapped || "").trim(),
          count: countsByRaw.get(country) || state.records.filter((r) => String(r.country || "").trim() === country).length
        };
      })
      .filter((row) => !filter || normalizeLoose(`${row.country} ${row.mapped}`).includes(filter))
      .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country, "ja"));

    table.innerHTML = rows.length
      ? rows.map((row) => `<tr>
        <td>${row.country}</td>
        <td><input data-edit-country="${encodeURIComponent(row.country)}" type="text" value="${row.mapped}" /></td>
        <td>${row.count}</td>
        <td><button class="ghost" data-save-country="${encodeURIComponent(row.country)}">更新</button></td>
        <td><button class="ghost" data-delete-country="${encodeURIComponent(row.country)}">削除</button></td>
      </tr>`).join("")
      : "<tr><td colspan='5' class='muted'>該当なし</td></tr>";

    table.querySelectorAll("[data-save-country]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = decodeURIComponent(button.dataset.saveCountry);
        const input = table.querySelector(`[data-edit-country="${encodeURIComponent(key)}"]`);
        const value = input?.value.trim();
        const iso2 = countryNormalization.resolveToIso2(value);
        if (!iso2) return;
        state.mapping[key] = iso2;
        saveMapping(state.mapping);
        renderMap();
      });
    });

    table.querySelectorAll("[data-delete-country]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = decodeURIComponent(button.dataset.deleteCountry);
        delete state.mapping[key];
        saveMapping(state.mapping);
        renderMap();
      });
    });
  }

  async function renderMap() {
    const mapRoot = container.querySelector("#map");
    mapRoot.innerHTML = "";
    const features = await loadWorldData();
    const featureIso2 = new Map(features.map((feature) => [feature, countryNormalization.resolveFeatureToIso2(feature)]));
    const stats = buildCountryAggregation();
    const mappedStats = stats.aggregated;
    const values = [...mappedStats.values()].map((entry) => metricValue(entry, ui.metric)).filter((v) => Number.isFinite(v));
    const sorted = [...values].sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.95)] : 1;
    const scale = d3.scaleSequential(d3.interpolateYlOrBr).domain([0, Math.sqrt(Math.max(p95, 1e-6))]);

    const width = 960;
    const height = 480;
    const svg = d3.select(mapRoot).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "coffee origin map");
    const layer = svg.append("g");
    const projection = d3.geoMercator().fitSize([width, height], { type: "FeatureCollection", features });
    const path = d3.geoPath(projection);

    layer.selectAll("path")
      .data(features)
      .enter()
      .append("path")
      .attr("d", path)
      .attr("fill", (feature) => {
        const iso2 = featureIso2.get(feature);
        const row = iso2 ? mappedStats.get(iso2) : null;
        const value = metricValue(row, ui.metric);
        if (!Number.isFinite(value)) return "#f5f3ef";
        return scale(Math.sqrt(Math.min(value, p95)));
      })
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 0.5)
      .style("cursor", "pointer")
      .on("click", (_event, feature) => {
        const iso2 = featureIso2.get(feature);
        ui.selectedCountryIso2 = iso2 || "";
        renderDrawer(iso2 ? mappedStats.get(iso2) : null);
      })
      .append("title")
      .text((feature) => {
        const iso2 = featureIso2.get(feature);
        const row = iso2 ? mappedStats.get(iso2) : null;
        const label = countryNormalization.getRecord(iso2)?.enName || feature.properties?.name || iso2 || "Unknown";
        return `${label}: ${formatMetric(ui.metric, metricValue(row, ui.metric))}`;
      });

    const zoom = d3.zoom().scaleExtent([1, 8]).on("zoom", (event) => layer.attr("transform", event.transform));
    svg.call(zoom);

    function fitFeature(target, padding = 0.94) {
      const [[x0, y0], [x1, y1]] = path.bounds(target);
      const k = Math.min(8, padding / Math.max((x1 - x0) / width, (y1 - y0) / height));
      const tx = width / 2 - k * (x0 + x1) / 2;
      const ty = height / 2 - k * (y0 + y1) / 2;
      svg.transition().duration(350).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
    }

    const coffeeBelt = { type: "Feature", geometry: { type: "Polygon", coordinates: [[[-180, -35], [180, -35], [180, 35], [-180, 35], [-180, -35]]] } };
    fitFeature(coffeeBelt, 0.95);
    mapApi = { fitWorld: () => fitFeature({ type: "FeatureCollection", features }), mappedStats, unmapped: stats.unmapped };

    renderUnmapped(stats.unmapped);
    renderDrawer(mappedStats.get(ui.selectedCountryIso2));
    renderMappingManagement(stats.unmapped);
  }

  state.mapping = loadMapping();
  normalizeMappingTable();

  container.querySelector("#metric-select").addEventListener("change", (event) => {
    ui.metric = event.target.value;
    renderMap();
  });

  container.querySelector("#fit-world").addEventListener("click", () => mapApi?.fitWorld?.());

  container.querySelector("#save-mapping").addEventListener("click", () => {
    const country = container.querySelector("#unmapped-select").value;
    const value = container.querySelector("#mapping-input").value.trim();
    const iso2 = countryNormalization.resolveToIso2(value);
    if (!country || !iso2) return;
    state.mapping[country] = iso2;
    saveMapping(state.mapping);
    container.querySelector("#mapping-input").value = "";
    ui.suggestionList = [];
    renderSuggestions();
    renderInputHint("");
    renderMap();
  });

  container.querySelector("#mapping-input").addEventListener("input", (event) => {
    const selectedCountry = container.querySelector("#unmapped-select").value;
    ui.suggestionList = getSuggestions(event.target.value, selectedCountry);
    renderSuggestions();
    renderInputHint(event.target.value);
  });

  container.querySelector("#unmapped-select").addEventListener("change", () => {
    const value = container.querySelector("#mapping-input").value;
    const selectedCountry = container.querySelector("#unmapped-select").value;
    ui.suggestionList = getSuggestions(value, selectedCountry);
    renderSuggestions();
    renderInputHint(value);
  });

  const dialog = container.querySelector("#mapping-dialog");
  container.querySelector("#open-mapping").addEventListener("click", () => {
    dialog.showModal();
    renderMap();
  });
  container.querySelector("#close-mapping").addEventListener("click", () => dialog.close());
  container.querySelector("#mapping-search").addEventListener("input", (event) => {
    ui.manageFilter = event.target.value;
    renderMappingManagement(mapApi?.unmapped || []);
  });

  return { render: renderMap };
}
