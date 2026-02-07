import { SEARCH_COLUMNS, DEFAULT_VISIBLE_COLUMNS, ROAST_OPTIONS, LEGACY_ROAST_MAP } from "../shared/labels.js";
import { debounce, display, formatDate, getDateValue, normalizeText, validTaste } from "../shared/utils.js";

export function initSearch(container, context) {
  const { state, saveSearchPrefs } = context;

  container.innerHTML = `<div class="card"><h2>検索 / 図鑑</h2><div class="filters"><input id="search-input" type="text" placeholder="キーワードを入力（スペースでAND検索）" /><span class="result-count" id="search-count">0件</span></div><div class="quick-filters" id="quick-filters"></div><h3 style="margin:14px 0 6px;font-size:0.95rem;">表示列</h3><div class="checkbox-grid" id="search-columns"></div></div><div class="card"><div class="table-wrap"><table><thead><tr id="search-head"></tr></thead><tbody id="search-results"></tbody></table></div><div style="margin-top:12px;"><button id="show-more" class="ghost">もっと見る</button></div></div><div id="sheet-backdrop" class="sheet-backdrop"></div><section id="record-sheet" class="sheet" aria-label="記録詳細"><div class="sheet-header"><strong id="sheet-title">記録詳細</strong><button id="sheet-close" class="ghost">閉じる</button></div><div class="sheet-content"><h3 style="margin-top:0;">ノート</h3><p id="sheet-note" class="sheet-note">ノートなし</p><details id="sheet-sub" class="sub-toggle"><summary>サブ情報を表示 ▾</summary><div id="sheet-sub-content" style="margin-top:8px;"></div></details><h3 style="margin-bottom:6px;">近い味の記録</h3><ol id="sheet-similar" class="similar-list"></ol></div></section>`;

  function normalizeLegacyRoast(values = []) {
    return values
      .map((value) => LEGACY_ROAST_MAP[value] || value)
      .filter((value) => ROAST_OPTIONS.includes(value));
  }

  function renderQuickFilters() {
    const wrap = container.querySelector("#quick-filters");
    const f = state.search.filters;
    const makeChecks = (key, title, options) => `<div class="filter-group"><h3>${title}</h3><div class="option-list">${options.map((op)=>`<label><input type="checkbox" data-filter="${key}" value="${op}" ${f[key].has(op)?"checked":""}/> ${op}</label>`).join("")}</div></div>`;
    wrap.innerHTML = [
      makeChecks("rating", "評価", ["S", "A", "B", "C"]),
      makeChecks("roast", "焙煎", ROAST_OPTIONS),
      `<div class="filter-group"><h3>苦味 / 酸味</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"><label>苦味最小<input id="f-bitter-min" type="number" min="1" max="5" value="${f.bitterMin}"></label><label>苦味最大<input id="f-bitter-max" type="number" min="1" max="5" value="${f.bitterMax}"></label><label>酸味最小<input id="f-acid-min" type="number" min="1" max="5" value="${f.acidMin}"></label><label>酸味最大<input id="f-acid-max" type="number" min="1" max="5" value="${f.acidMax}"></label></div></div>`
    ].join("");

    wrap.querySelectorAll("input[data-filter]").forEach((input) => input.addEventListener("change", () => {
      const key = input.dataset.filter;
      if (input.checked) f[key].add(input.value);
      else f[key].delete(input.value);
      state.search.limit = 100;
      saveSearchPrefs();
      renderSearchResults();
    }));

    [["f-bitter-min", "bitterMin"], ["f-bitter-max", "bitterMax"], ["f-acid-min", "acidMin"], ["f-acid-max", "acidMax"]].forEach(([id, key]) => {
      const el = container.querySelector(`#${id}`);
      el.addEventListener("input", () => {
        f[key] = el.value;
        state.search.limit = 100;
        saveSearchPrefs();
        renderSearchResults();
      });
    });
  }

  function setupSearchColumns() {
    const columnsContainer = container.querySelector("#search-columns");
    columnsContainer.innerHTML = "";
    SEARCH_COLUMNS.forEach((col) => {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.search.columns.has(col.key);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.search.columns.add(col.key);
        else state.search.columns.delete(col.key);
        saveSearchPrefs();
        renderSearchResults();
      });
      label.append(checkbox, ` ${col.label}`);
      columnsContainer.appendChild(label);
    });
  }

  function buildSearchHead() {
    const head = container.querySelector("#search-head");
    const visible = SEARCH_COLUMNS.filter((c) => state.search.columns.has(c.key));
    if (!visible.length) visible.push(...SEARCH_COLUMNS.filter((c) => DEFAULT_VISIBLE_COLUMNS.includes(c.key)));
    head.innerHTML = visible.map((c) => `<th class="sortable" data-key="${c.key}">${c.label}${state.search.sortKey===c.key ? (state.search.sortDir==='asc'?' ▲':' ▼') : ''}</th>`).join("");
    head.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (state.search.sortKey === key) state.search.sortDir = state.search.sortDir === "asc" ? "desc" : "asc";
      else {
        state.search.sortKey = key;
        state.search.sortDir = "asc";
      }
      saveSearchPrefs();
      renderSearchResults();
    }));
    return visible;
  }

  function applyFilters(records) {
    const tokens = normalizeText(state.search.query).split(/\s+/).filter(Boolean);
    const f = state.search.filters;
    return records.filter((record) => {
      const allText = SEARCH_COLUMNS.map((c) => record._norm[c.key]).join(" ");
      if (!tokens.every((token) => allText.includes(token))) return false;
      if (f.rating.size && !f.rating.has(String(record.rating || "").trim())) return false;
      if (f.roast.size && !f.roast.has(String(record.roast || "").trim())) return false;
      const b = validTaste(record.bitter);
      const a = validTaste(record.acid);
      const within = (v, min, max) => (min === "" || (v !== null && v >= Number(min))) && (max === "" || (v !== null && v <= Number(max)));
      return within(b, f.bitterMin, f.bitterMax) && within(a, f.acidMin, f.acidMax);
    });
  }

  function compareRecords(a, b) {
    const key = state.search.sortKey;
    const dir = state.search.sortDir === "asc" ? 1 : -1;
    if (key === "date") {
      const ta = getDateValue(a.date);
      const tb = getDateValue(b.date);
      if (ta === null && tb === null) return 0;
      if (ta === null) return 1;
      if (tb === null) return -1;
      return (ta - tb) * dir;
    }
    const na = Number(a[key]);
    const nb = Number(b[key]);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return (na - nb) * dir;
    const s = String(a[key] || "").localeCompare(String(b[key] || ""), "ja");
    if (s !== 0) return s * dir;
    return (getDateValue(b.date) || -Infinity) - (getDateValue(a.date) || -Infinity);
  }

  function similarTaste(record) {
    const b = validTaste(record.bitter);
    const a = validTaste(record.acid);
    if (b === null || a === null) return [];
    return state.records.map((r) => ({ r, db: validTaste(r.bitter), da: validTaste(r.acid) }))
      .filter((x) => x.r !== record && x.db !== null && x.da !== null)
      .map((x) => ({ record: x.r, dist: (x.db - b) ** 2 + (x.da - a) ** 2 }))
      .sort((x, y) => x.dist - y.dist)
      .slice(0, 5);
  }

  function openRecordSheet(record) {
    container.querySelector("#sheet-title").textContent = `${display(record.bean)} / ${display(record.country)}`;
    container.querySelector("#sheet-note").textContent = record.note || "ノートなし";
    container.querySelector("#sheet-sub-content").innerHTML = `<div class="muted">苦味: ${display(record.bitter)} / 酸味: ${display(record.acid)}</div><div class="muted">ショップ: ${display(record.shop)}</div><div class="muted">価格: ${display(record.price)}</div><div class="muted">日付: ${formatDate(record.date)}</div>`;
    const similar = similarTaste(record);
    container.querySelector("#sheet-similar").innerHTML = similar.length ? similar.map(({ record: r, dist }) => `<li>${display(r.bean)} (${display(r.country)}) / 苦味:${display(r.bitter)} 酸味:${display(r.acid)} / ${formatDate(r.date)} <span class="muted">(距離:${dist.toFixed(2)})</span></li>`).join("") : "<li>比較可能な記録がありません</li>";
    container.querySelector("#sheet-backdrop").classList.add("open");
    container.querySelector("#record-sheet").classList.add("open");
    container.querySelector("#sheet-sub").open = false;
  }

  function closeRecordSheet() {
    container.querySelector("#sheet-backdrop").classList.remove("open");
    container.querySelector("#record-sheet").classList.remove("open");
  }

  function renderSearchResults() {
    const tbody = container.querySelector("#search-results");
    tbody.innerHTML = "";
    const visible = buildSearchHead();
    const results = applyFilters(state.records).sort(compareRecords);
    container.querySelector("#search-count").textContent = `${results.length}件`;
    results.slice(0, state.search.limit).forEach((record) => {
      const row = document.createElement("tr");
      row.classList.add("expandable");
      row.innerHTML = visible.map((col) => `<td>${col.key === 'date' ? formatDate(record.date) : display(record[col.key])}</td>`).join("");
      row.addEventListener("click", () => openRecordSheet(record));
      tbody.appendChild(row);
    });
    container.querySelector("#show-more").style.display = results.length > state.search.limit ? "inline-flex" : "none";
  }

  const input = container.querySelector("#search-input");
  input.value = state.search.query;
  const debounced = debounce((value) => {
    state.search.query = value;
    state.search.limit = 100;
    renderSearchResults();
  }, 200);
  input.addEventListener("input", (event) => debounced(event.target.value));
  container.querySelector("#show-more").addEventListener("click", () => {
    state.search.limit += 100;
    renderSearchResults();
  });
  container.querySelector("#sheet-close").addEventListener("click", closeRecordSheet);
  container.querySelector("#sheet-backdrop").addEventListener("click", closeRecordSheet);

  state.search.filters.roast = new Set(normalizeLegacyRoast([...state.search.filters.roast]));

  return {
    render() {
      renderQuickFilters();
      setupSearchColumns();
      renderSearchResults();
    }
  };
}
