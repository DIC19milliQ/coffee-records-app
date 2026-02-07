import { normalizeText } from "../shared/utils.js";
import { inspectCountryString, normalizeCountryKey } from "../shared/countryNormalization.js";
import { deleteAlias, resolveAliasToIso2, tokenFromIso2, upsertMapping } from "../shared/countryMapping.js";

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
  return String(text || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]/g, "");
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
  const ui = {
    metric: "uniqueBeans",
    selectedCountryIso2: "",
    manageFilter: "",
    suggestionList: [],
    unknownCountrySignature: "",
    selectedUnjoinableIso2: "",
    latestSaveStatus: "",
    focusIso2: "",
    selectedDiagnoseCountry: ""
  };
  let countryAliasIndex = new Map();
  let aliasDictionaryLoaded = false;

  container.innerHTML = `
    <div class="card">
      <h2>産地マップ（記録・傾向）</h2>
      <p class="muted">コーヒーベルトを初期表示。薄灰色=未合流、薄茶色=値ゼロ/最小を表します。</p>
      <div id="mapping-save-status" class="muted"></div>
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
        <label>診断対象国
          <select id="diagnose-country-select"></select>
        </label>
        <button id="diagnose-selected" class="ghost">診断ログ出力</button>
      </div>
      <div id="diagnose-status" class="muted">使い方: ①「診断対象国」を選ぶ ②「診断ログ出力」を押す。</div>
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
    <div class="card">
      <h3>mapped-but-unjoinable</h3>
      <p class="muted">マッピング済みだが地図に合流できない国を表示します。</p>
      <div id="unjoinable-list"></div>
    </div>
    <dialog id="mapping-dialog">
      <div class="dialog-body">
        <h3 style="margin-top:0;">マッピング管理</h3>
        <input id="mapping-search" type="text" placeholder="国名/ISO2/内部キーで検索" />
        <div class="table-wrap" style="margin-top:10px;max-height:50vh;overflow:auto;">
          <table>
            <thead><tr><th>country表記</th><th>表示名</th><th>内部キー</th><th>resolved iso2</th><th>feature存在</th><th>集計合流</th><th>最終更新</th><th>編集</th><th>削除</th></tr></thead>
            <tbody id="mapping-table"></tbody>
          </table>
        </div>
        <section id="mapping-guide" class="mapping-guide"></section>
      </div>
      <div class="dialog-actions">
        <button id="close-mapping" class="ghost">閉じる</button>
      </div>
    </dialog>
  `;

  let mapApi = null;

  function loadFeatureIso2Set(features) {
    return new Set(features.map((feature) => countryNormalization.resolveFeatureToIso2(feature)).filter(Boolean));
  }

  function emitMappingTrace(rawCountry, report) {
    console.info("[Map Mapping Diagnose]", {
      rawCountry,
      trace: report,
      rawCountryDiagnostics: inspectCountryString(rawCountry)
    });
  }

  async function loadWorldData() {
    if (state.worldFeatures) return state.worldFeatures;
    const response = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
    const topo = await response.json();
    const features = topojson.feature(topo, topo.objects.countries).features;
    state.worldFeatures = features;
    return features;
  }

  async function loadCountryAliases() {
    if (aliasDictionaryLoaded) return;
    aliasDictionaryLoaded = true;
    try {
      const response = await fetch("./data/country_aliases.json");
      if (!response.ok) throw new Error(`Failed to fetch country aliases: ${response.status}`);
      const payload = await response.json();
      const entries = Object.entries(payload?.aliases || {});
      countryAliasIndex = new Map(entries.map(([alias, canonical]) => [normalizeLoose(alias), String(canonical || "").trim()]));
    } catch (error) {
      console.warn("Country alias dictionary could not be loaded.", error);
      countryAliasIndex = new Map();
    }
  }

  function resolveRawCountryFallbackIso2(rawCountry) {
    const raw = normalizeCountryKey(rawCountry);
    if (!raw) return null;
    const directIso2 = countryNormalization.resolveToIso2(raw);
    if (directIso2) return directIso2;
    const aliasCanonical = countryAliasIndex.get(normalizeLoose(raw));
    if (!aliasCanonical) return null;
    return countryNormalization.resolveToIso2(aliasCanonical);
  }

  function seedMappingFromRecords() {
    const rawCountries = [...new Set(state.records.map((record) => normalizeCountryKey(record.country)).filter(Boolean))];
    const unresolved = [];
    let changed = false;

    rawCountries.forEach((rawCountry) => {
      const resolved = resolveAliasToIso2(rawCountry, state.mappingModel);
      if (resolved.iso2) return;
      const fallbackIso2 = resolveRawCountryFallbackIso2(rawCountry);
      if (!fallbackIso2) {
        unresolved.push(rawCountry);
        return;
      }
      upsertMapping(state.mappingModel, {
        rawCountry,
        token: tokenFromIso2(fallbackIso2),
        iso2: fallbackIso2,
        displayName: countryNormalization.getRecord(fallbackIso2)?.enName || fallbackIso2
      });
      changed = true;
    });

    const signature = unresolved.sort((a, b) => a.localeCompare(b, "ja")).join("|");
    if (signature && signature !== ui.unknownCountrySignature) {
      console.warn("[Map] country_aliases に未登録の country が見つかりました:", unresolved);
    }
    ui.unknownCountrySignature = signature;
    if (changed) saveMapping(state.mappingModel);
  }

  function parseRatingScore(record) {
    const rating = normalizeText(record.rating).toUpperCase();
    if (!rating) return null;
    if (RATING_SCORE[rating] !== undefined) return RATING_SCORE[rating];
    return 0;
  }

  function buildCountryAggregation(featureIso2Set) {
    const byRawCountry = new Map();
    state.records.forEach((record) => {
      const rawCountry = normalizeCountryKey(record.country);
      if (!rawCountry) return;
      if (!byRawCountry.has(rawCountry)) byRawCountry.set(rawCountry, []);
      byRawCountry.get(rawCountry).push(record);
    });

    const byMapCountry = new Map();
    const unmapped = [];
    const unjoinable = [];

    byRawCountry.forEach((records, rawCountry) => {
      const resolved = resolveAliasToIso2(rawCountry, state.mappingModel);
      if (!resolved.iso2) {
        unmapped.push({ name: rawCountry, count: records.length });
        return;
      }
      if (!featureIso2Set.has(resolved.iso2)) {
        unjoinable.push({ rawCountry, iso2: resolved.iso2, reason: "feature-not-found", count: records.length });
      }
      if (!byMapCountry.has(resolved.iso2)) byMapCountry.set(resolved.iso2, { records: [], rawCountries: [] });
      const slot = byMapCountry.get(resolved.iso2);
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

    return {
      aggregated,
      unmapped: unmapped.sort((a, b) => b.count - a.count),
      unjoinable: unjoinable.sort((a, b) => b.count - a.count)
    };
  }

  function validateMappingSave(rawCountry, iso2, featureIso2Set, mappedStats) {
    const checks = {
      mappedIso2Resolved: Boolean(iso2),
      featureExists: iso2 ? featureIso2Set.has(iso2) : false,
      mappedStatsJoinable: iso2 ? mappedStats.has(iso2) : false
    };
    return {
      rawCountry,
      iso2,
      checks,
      status: checks.mappedIso2Resolved && checks.featureExists && checks.mappedStatsJoinable ? "ok" : "warning"
    };
  }


  function pickReportCheck(report, legacyKey, nestedKey) {
    if (typeof report?.[legacyKey] === "boolean") return report[legacyKey];
    if (typeof report?.checks?.[nestedKey] === "boolean") return report.checks[nestedKey];
    return false;
  }

  function renderDiagnoseStatus(report) {
    const host = container.querySelector("#diagnose-status");
    if (!host) return;
    if (!report) {
      host.classList.add("is-warning");
      host.textContent = "対象国を選択してください（上部の「診断対象国」から選べます）";
      return;
    }
    const hasFeature = pickReportCheck(report, "hasFeature", "featureExists");
    const hasJoin = pickReportCheck(report, "hasJoin", "mappedStatsJoinable");
    const featureDetail = report.featureKey || report.aliasToken || "-";
    host.classList.toggle("is-warning", !hasFeature || !hasJoin);
    host.textContent = [
      `rawCountry: ${report.rawCountry || "-"}`,
      `iso2: ${report.iso2 || "-"}`,
      `feature: ${hasFeature ? "FOUND" : "NOT FOUND"} (key: ${featureDetail})`,
      `join: ${hasJoin ? "JOINED" : "NOT JOINED"}`
    ].join("\n");
  }

  function renderNoGuide(rows) {
    const host = container.querySelector("#mapping-guide");
    if (!host) return;
    const featureNo = rows.filter((row) => !row.featureExists);
    const joinNo = rows.filter((row) => row.featureExists && !row.joinable);
    if (!featureNo.length && !joinNo.length) {
      host.innerHTML = `<h4>NO項目の対処ガイド</h4><p class="muted" style="margin:0;">現在、NO項目はありません。</p>`;
      return;
    }
    const sections = [];
    if (featureNo.length) {
      sections.push(`
        <div style="margin-bottom:8px;">
          <strong>feature存在 = NO（${featureNo.length}件）</strong>
          <ul>
            <li>問題: 解決したISO2が地図featureに存在しない、またはISO_A2/ISO_A3/name/id解決でヒットしていません。</li>
            <li>次の行動: rawCountry→iso2の解決結果を確認し、国名正規化/aliasを追加してください。</li>
            <li>次の行動: feature解決ロジックと地図データのISOキーを照合し、必要に応じて地図データ更新を検討してください。</li>
          </ul>
        </div>`);
    }
    if (joinNo.length) {
      sections.push(`
        <div>
          <strong>集計合流 = NO（${joinNo.length}件）</strong>
          <ul>
            <li>問題: 集計キーがISO2に揃っていない、またはrawCountry→iso2正規化が不一致で最終照合に失敗しています。</li>
            <li>次の行動: 診断ログでrawCountry/iso2を確認し、alias・正規化ルールを追加してください。</li>
            <li>次の行動: 既存保存値の後方互換変換（旧トークン→ISO2）と候補生成/最終照合の非対称を確認してください。</li>
          </ul>
        </div>`);
    }
    host.innerHTML = `<h4>NO項目の対処ガイド</h4>${sections.join("")}`;
  }
  function renderSaveStatus(report) {
    const host = container.querySelector("#mapping-save-status");
    if (!report) {
      host.textContent = "";
      return;
    }
    const { rawCountry, iso2, checks } = report;
    if (report.status === "ok") {
      host.textContent = `保存成功: ${rawCountry} → ${iso2}（地図・集計に反映済み）`;
      return;
    }
    host.textContent = `保存済みだが未反映の可能性: ${rawCountry} → ${iso2 || "-"} / iso2:${checks.mappedIso2Resolved ? "ok" : "ng"} feature:${checks.featureExists ? "ok" : "ng"} join:${checks.mappedStatsJoinable ? "ok" : "ng"}`;
  }

  function metricValue(stats, metric) {
    return stats?.[metric] ?? null;
  }

  function listRawCountriesByCount() {
    const counts = new Map();
    state.records.forEach((record) => {
      const rawCountry = normalizeCountryKey(record.country);
      if (!rawCountry) return;
      counts.set(rawCountry, (counts.get(rawCountry) || 0) + 1);
    });
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"));
  }

  function renderDiagnoseCountryOptions() {
    const select = container.querySelector("#diagnose-country-select");
    if (!select) return;
    const options = listRawCountriesByCount();
    const preferred = ui.selectedDiagnoseCountry || select.value;
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = options.length ? "診断対象国を選択" : "診断対象国なし";
    select.appendChild(placeholder);
    options.forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.name;
      option.textContent = `${entry.name} (${entry.count})`;
      select.appendChild(option);
    });
    if (preferred && options.some((entry) => entry.name === preferred)) {
      select.value = preferred;
    }
    ui.selectedDiagnoseCountry = select.value;
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

  function renderUnjoinable(unjoinable) {
    const host = container.querySelector("#unjoinable-list");
    host.innerHTML = "";
    if (!unjoinable.length) {
      host.textContent = "該当なし";
      return;
    }
    host.innerHTML = `<ul>${unjoinable.map((entry) => `<li>${entry.rawCountry} → ${entry.iso2} (${entry.reason}, ${entry.count}件)</li>`).join("")}</ul>`;
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
    hint.textContent = `${iso2}: ${rec?.enName || iso2} / internalKey: ${tokenFromIso2(iso2)}`;
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
      </div>
      <button id="open-search-country" class="ghost" style="width:100%;">Searchでこの国を開く</button>
      <ol class="country-beans">${beans}</ol>
    `;
    drawer.querySelector("#open-search-country")?.addEventListener("click", () => openSearchWithCountry?.(openCountry));
  }

  function renderMappingManagement(unmapped, featureIso2Set, mappedStats) {
    const table = container.querySelector("#mapping-table");
    const filter = normalizeLoose(ui.manageFilter);
    const countsByRaw = new Map(unmapped.map((entry) => [entry.name, entry.count]));

    const rows = Object.entries(state.mappingModel.aliasLayer)
      .map(([country, token]) => {
        const iso2 = state.mappingModel.countryLayer[token] || null;
        return {
          country,
          token,
          displayName: state.mappingModel.displayLayer[token] || "",
          iso2: iso2 || "",
          featureExists: iso2 ? featureIso2Set.has(iso2) : false,
          joinable: iso2 ? mappedStats.has(iso2) : false,
          updatedAt: state.mappingModel.aliasMeta[country]?.updatedAt || "-",
          count: countsByRaw.get(country) || state.records.filter((r) => normalizeCountryKey(r.country) === country).length
        };
      })
      .filter((row) => !filter || normalizeLoose(`${row.country} ${row.iso2} ${row.token} ${row.displayName}`).includes(filter))
      .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country, "ja"));

    table.innerHTML = rows.length
      ? rows.map((row) => `<tr>
        <td>${row.country}</td>
        <td><input data-edit-display="${encodeURIComponent(row.country)}" type="text" value="${row.displayName}" /></td>
        <td>${row.token}</td>
        <td><input data-edit-iso2="${encodeURIComponent(row.country)}" type="text" value="${row.iso2}" /></td>
        <td><span class="status-chip ${row.featureExists ? "yes" : "no"}">${row.featureExists ? "YES" : "NO"}</span></td>
        <td><span class="status-chip ${row.joinable ? "yes" : "no"}">${row.joinable ? "YES" : "NO"}</span></td>
        <td>${row.updatedAt}</td>
        <td><button class="ghost" data-save-country="${encodeURIComponent(row.country)}">更新</button></td>
        <td><button class="ghost" data-delete-country="${encodeURIComponent(row.country)}">削除</button></td>
      </tr>`).join("")
      : "<tr><td colspan='9' class='muted'>該当なし</td></tr>";

    renderNoGuide(rows);

    table.querySelectorAll("[data-save-country]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = decodeURIComponent(button.dataset.saveCountry);
        const isoInput = table.querySelector(`[data-edit-iso2="${encodeURIComponent(key)}"]`);
        const labelInput = table.querySelector(`[data-edit-display="${encodeURIComponent(key)}"]`);
        const iso2 = countryNormalization.resolveToIso2(normalizeCountryKey(isoInput?.value));
        if (!iso2) return;
        upsertMapping(state.mappingModel, {
          rawCountry: key,
          token: tokenFromIso2(iso2),
          iso2,
          displayName: normalizeCountryKey(labelInput?.value) || countryNormalization.getRecord(iso2)?.enName || iso2
        });
        saveMapping(state.mappingModel);
        ui.focusIso2 = iso2;
        renderMap();
      });
    });

    table.querySelectorAll("[data-delete-country]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = decodeURIComponent(button.dataset.deleteCountry);
        deleteAlias(state.mappingModel, key);
        saveMapping(state.mappingModel);
        renderMap();
      });
    });
  }

  async function renderMap() {
    await loadCountryAliases();
    seedMappingFromRecords();
    const mapRoot = container.querySelector("#map");
    mapRoot.innerHTML = "";
    const features = await loadWorldData();
    const featureIso2 = new Map(features.map((feature) => [feature, countryNormalization.resolveFeatureToIso2(feature)]));
    const featureIso2Set = loadFeatureIso2Set(features);
    const stats = buildCountryAggregation(featureIso2Set);
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
        if (!iso2) return "#e6e6e6";
        const row = mappedStats.get(iso2) || null;
        if (!row) return "#d9d9d9";
        const value = metricValue(row, ui.metric);
        if (!Number.isFinite(value)) return "#f5f3ef";
        return scale(Math.sqrt(Math.min(value, p95)));
      })
      .attr("stroke", (feature) => {
        const iso2 = featureIso2.get(feature);
        return ui.focusIso2 && iso2 === ui.focusIso2 ? "#c0392b" : "#ffffff";
      })
      .attr("stroke-width", (feature) => {
        const iso2 = featureIso2.get(feature);
        return ui.focusIso2 && iso2 === ui.focusIso2 ? 2 : 0.5;
      })
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
        const joined = iso2 && row ? "joined" : "unjoined";
        return `${label}: ${formatMetric(ui.metric, metricValue(row, ui.metric))} (${joined})`;
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

    if (ui.focusIso2) {
      const focusFeature = features.find((feature) => featureIso2.get(feature) === ui.focusIso2);
      if (focusFeature) fitFeature(focusFeature, 0.6);
      ui.focusIso2 = "";
    } else {
      const coffeeBelt = { type: "Feature", geometry: { type: "Polygon", coordinates: [[[-180, -35], [180, -35], [180, 35], [-180, 35], [-180, -35]]] } };
      fitFeature(coffeeBelt, 0.95);
    }

    mapApi = { fitWorld: () => fitFeature({ type: "FeatureCollection", features }), mappedStats, unmapped: stats.unmapped, featureIso2Set };

    renderDiagnoseCountryOptions();
    renderUnmapped(stats.unmapped);
    renderUnjoinable(stats.unjoinable);
    renderSaveStatus(ui.latestSaveStatus);
    renderDrawer(mappedStats.get(ui.selectedCountryIso2));
    renderMappingManagement(stats.unmapped, featureIso2Set, mappedStats);
  }

  state.mappingModel = loadMapping();

  container.querySelector("#metric-select").addEventListener("change", (event) => {
    ui.metric = event.target.value;
    renderMap();
  });

  container.querySelector("#fit-world").addEventListener("click", () => mapApi?.fitWorld?.());

  container.querySelector("#save-mapping").addEventListener("click", async () => {
    const country = container.querySelector("#unmapped-select").value;
    const value = normalizeCountryKey(container.querySelector("#mapping-input").value);
    const iso2 = countryNormalization.resolveToIso2(value);
    if (!country || !iso2) return;

    upsertMapping(state.mappingModel, {
      rawCountry: country,
      token: tokenFromIso2(iso2),
      iso2,
      displayName: countryNormalization.getRecord(iso2)?.enName || iso2
    });
    saveMapping(state.mappingModel);
    ui.focusIso2 = iso2;
    await renderMap();
    const report = validateMappingSave(country, iso2, mapApi?.featureIso2Set || new Set(), mapApi?.mappedStats || new Map());
    ui.latestSaveStatus = report;
    renderSaveStatus(report);
    emitMappingTrace(country, report);

    container.querySelector("#mapping-input").value = "";
    ui.suggestionList = [];
    renderSuggestions();
    renderInputHint("");
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
    const diagnoseSelect = container.querySelector("#diagnose-country-select");
    if (diagnoseSelect && selectedCountry) {
      diagnoseSelect.value = selectedCountry;
      ui.selectedDiagnoseCountry = diagnoseSelect.value;
    }
  });

  container.querySelector("#diagnose-country-select").addEventListener("change", (event) => {
    ui.selectedDiagnoseCountry = event.target.value;
  });

  const dialog = container.querySelector("#mapping-dialog");
  container.querySelector("#open-mapping").addEventListener("click", () => {
    dialog.showModal();
    renderMap();
  });
  container.querySelector("#close-mapping").addEventListener("click", () => dialog.close());
  container.querySelector("#mapping-search").addEventListener("input", (event) => {
    ui.manageFilter = event.target.value;
    renderMappingManagement(mapApi?.unmapped || [], mapApi?.featureIso2Set || new Set(), mapApi?.mappedStats || new Map());
  });

  container.querySelector("#diagnose-selected").addEventListener("click", () => {
    const country = container.querySelector("#diagnose-country-select").value;
    if (!country) {
      renderDiagnoseStatus(null);
      return;
    }
    const resolved = resolveAliasToIso2(country, state.mappingModel);
    const report = {
      rawCountry: country,
      aliasToken: resolved.aliasToken,
      iso2: resolved.iso2,
      hasFeature: resolved.iso2 ? (mapApi?.featureIso2Set || new Set()).has(resolved.iso2) : false,
      hasJoin: resolved.iso2 ? (mapApi?.mappedStats || new Map()).has(resolved.iso2) : false
    };
    renderDiagnoseStatus(report);
    emitMappingTrace(country, report);
  });

  return { render: renderMap };
}
