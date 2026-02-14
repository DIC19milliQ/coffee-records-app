import { initSearch } from "./modes/search.js";
import { initRanking } from "./modes/ranking.js";
import { initAnalysis } from "./modes/analysis.js";
import { initMap } from "./modes/map.js";
import { buildCountryNormalization, normalizeCountryKey } from "./shared/countryNormalization.js";
import { MAP_KEY, MAP_LEGACY_KEY, applyLegacyMapping, createEmptyMappingModel, normalizeModel } from "./shared/countryMapping.js";
import { DEFAULT_VISIBLE_COLUMNS, LEGACY_ROAST_MAP, ROAST_OPTIONS, SEARCH_COLUMNS } from "./shared/labels.js";
import { normalizeText } from "./shared/utils.js";
import { DATA_CACHE_KEY, WORLD_ATLAS_CACHE_KEY, WORLD_ATLAS_CACHE_META_KEY } from "./shared/cacheKeys.js";

const API_URL = "https://script.google.com/macros/s/AKfycbwTVElQ-Ao7U2lb3MGsYFj_Qy5K0C1bSw_IPk0ZFNPV9d0mGrpOZuukZCW9rbOgtc_6/exec";
const TTL_MS = 60 * 60 * 1000;
const SEARCH_PREFS_KEY = "coffeeSearchPrefs_v1";

const DEFAULT_MAPPING = {
  "ブラジル": "BR", "コロンビア": "CO", "エチオピア": "ET", "グアテマラ": "GT", "ホンジュラス": "HN", "インドネシア": "ID", "ケニア": "KE", "ペルー": "PE", "ルワンダ": "RW", "タンザニア": "TZ", "ベトナム": "VD", "イエメン": "YE", "コスタリカ": "CR", "パナマ": "PA", "ボリビア": "BO", "ブルンジ": "BI", "エクアドル": "EC", "エルサルバドル": "SV", "インド": "IN", "ジャマイカ": "JM", "ニカラグア": "NI", "パプアニューギニア": "PG", "ウガンダ": "UG"
};
const countryNormalization = buildCountryNormalization();

const state = {
  records: [],
  updatedAt: "--",
  search: { query: "", columns: new Set(DEFAULT_VISIBLE_COLUMNS), limit: 100, sortKey: "date", sortDir: "desc", filters: { rating: new Set(), roast: new Set(), bitterMin: "", bitterMax: "", acidMin: "", acidMax: "" } },
  rankingMode: "bitter",
  worldFeatures: null,
  mappingModel: createEmptyMappingModel()
};

const statusEl = document.getElementById("status");
const updatedEl = document.getElementById("updated-at");
const reloadBtn = document.getElementById("reload");

function safeParseJson(text) { return JSON.parse(text.replace(/^﻿/, "")); }
function cacheSet(payload) { localStorage.setItem(DATA_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), payload })); }
function cacheGet() {
  try {
    const p = JSON.parse(localStorage.getItem(DATA_CACHE_KEY) || "null");
    if (!p?.savedAt || !p?.payload) return null;
    if (Date.now() - p.savedAt > TTL_MS) return null;
    return p.payload;
  } catch { return null; }
}
function loadMapping() {
  const normalizedDefaults = Object.fromEntries(
    Object.entries(DEFAULT_MAPPING)
      .map(([rawCountry, mappedValue]) => [normalizeCountryKey(rawCountry), mappedValue])
      .filter(([rawCountry]) => rawCountry)
  );
  let model = createEmptyMappingModel();
  model = applyLegacyMapping(model, normalizedDefaults, countryNormalization);
  try {
    const savedV2 = JSON.parse(localStorage.getItem(MAP_KEY) || "null");
    if (savedV2) model = normalizeModel(savedV2, countryNormalization);
  } catch {
    // ignore parse errors and fallback to defaults
  }

  try {
    const legacy = JSON.parse(localStorage.getItem(MAP_LEGACY_KEY) || "{}");
    model = applyLegacyMapping(model, legacy, countryNormalization);
    localStorage.removeItem(MAP_LEGACY_KEY);
  } catch {
    // ignore legacy parse errors
  }

  saveMapping(model);
  return model;
}
function saveMapping(model) {
  const normalized = normalizeModel(model, countryNormalization);
  normalized.updatedAt = new Date().toISOString();
  localStorage.setItem(MAP_KEY, JSON.stringify(normalized));
}

function resetMappingStorage() {
  const keys = [MAP_KEY, MAP_LEGACY_KEY];
  const removed = [];
  const failed = [];
  keys.forEach((key) => {
    try {
      localStorage.removeItem(key);
      removed.push(key);
    } catch (error) {
      failed.push({ key, error: error?.message || String(error) });
    }
  });
  state.mappingModel = loadMapping();
  state.worldFeatures = null;
  return { removed, failed };
}

function resetDataCache() {
  const targets = [
    { label: "コーヒーキャッシュ", key: DATA_CACHE_KEY },
    { label: "地図キャッシュ", key: WORLD_ATLAS_CACHE_KEY },
    { label: "地図キャッシュ", key: WORLD_ATLAS_CACHE_META_KEY }
  ];
  const removed = [];
  const failed = [];
  targets.forEach(({ label, key }) => {
    try {
      localStorage.removeItem(key);
      removed.push({ label, key });
    } catch (error) {
      failed.push({ label, key, error: error?.message || String(error) });
    }
  });
  state.worldFeatures = null;
  return { removed, failed };
}

function saveSearchPrefs() {
  const f = state.search.filters;
  const payload = { columns: [...state.search.columns], sortKey: state.search.sortKey, sortDir: state.search.sortDir, filters: { rating: [...f.rating], roast: [...f.roast], bitterMin: f.bitterMin, bitterMax: f.bitterMax, acidMin: f.acidMin, acidMax: f.acidMax } };
  localStorage.setItem(SEARCH_PREFS_KEY, JSON.stringify(payload));
}
function loadSearchPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(SEARCH_PREFS_KEY) || "null");
    if (!p) return;
    const keys = new Set(SEARCH_COLUMNS.map((c) => c.key));
    const cols = (p.columns || []).filter((k) => keys.has(k));
    state.search.columns = new Set(cols.length ? cols : DEFAULT_VISIBLE_COLUMNS);
    if (["asc", "desc"].includes(p.sortDir)) state.search.sortDir = p.sortDir;
    if (keys.has(p.sortKey) || p.sortKey === "date") state.search.sortKey = p.sortKey || "date";
    const f = p.filters || {};
    state.search.filters.rating = new Set(f.rating || []);
    const normalizedRoast = (f.roast || []).map((r) => LEGACY_ROAST_MAP[r] || r).filter((r) => ROAST_OPTIONS.includes(r));
    state.search.filters.roast = new Set(normalizedRoast);
    state.search.filters.bitterMin = f.bitterMin ?? "";
    state.search.filters.bitterMax = f.bitterMax ?? "";
    state.search.filters.acidMin = f.acidMin ?? "";
    state.search.filters.acidMax = f.acidMax ?? "";
  } catch {}
}

function isHeaderRow(record) {
  const fields = ["region", "country", "bean", "altitude", "process", "roast", "price", "rating", "bitter", "acid", "note", "shop", "date"];
  return fields.some((field) => normalizeText(record[field]) === field);
}

function sanitizeRecords(items) {
  if (!Array.isArray(items)) return [];
  const fields = ["region", "country", "bean", "altitude", "process", "roast", "price", "rating", "bitter", "acid", "note", "shop", "date"];
  return items.filter((i) => i && typeof i === "object").filter((i) => !isHeaderRow(i)).map((i) => {
    const c = {};
    fields.forEach((k) => { c[k] = i[k] ?? ""; });
    c.country = normalizeCountryKey(c.country);
    c._norm = {};
    fields.forEach((k) => { c._norm[k] = normalizeText(c[k]); });
    return c;
  });
}

async function fetchRecords() {
  statusEl.textContent = "取得中...";
  const response = await fetch(API_URL, { method: "GET" });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return safeParseJson(await response.text());
}

const modes = {
  search: initSearch(document.getElementById("mode-search"), { state, saveSearchPrefs }),
  ranking: initRanking(document.getElementById("mode-ranking"), { state }),
  analysis: initAnalysis(document.getElementById("mode-analysis"), { state }),
  map: initMap(document.getElementById("mode-map"), {
    state,
    loadMapping,
    saveMapping,
    countryNormalization,
    openSearchWithCountry,
    resetMappingStorage,
    resetDataCache
  })
};

function renderAll() {
  modes.search.render();
  modes.ranking.render();
  modes.analysis.render();
  modes.map.render();
}


function activateTab(tabName) {
  document.querySelectorAll("nav button").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${tabName}`));
}

function setupTabs() {
  document.querySelectorAll("nav button").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.tab)));
}

function openSearchWithCountry(country) {
  const value = String(country || "").trim();
  if (!value) return;
  state.search.query = value;
  state.search.limit = 100;
  activateTab("search");
  document.querySelector("#mode-search #search-input").value = value;
  modes.search.render();
}

async function loadData(force = false) {
  reloadBtn.disabled = true;
  try {
    if (!force) {
      const cached = cacheGet();
      if (cached) {
        state.records = sanitizeRecords(cached.items || []);
        state.updatedAt = cached.updatedAt || cached.fetchedAt || "--";
        statusEl.textContent = "キャッシュから読み込み";
        updatedEl.textContent = state.updatedAt;
        renderAll();
        return;
      }
    }
    const data = await fetchRecords();
    const fetchedAt = new Date().toISOString();
    cacheSet({ items: data.items || [], updatedAt: data.updatedAt, fetchedAt });
    state.records = sanitizeRecords(data.items || []);
    state.updatedAt = data.updatedAt || fetchedAt;
    statusEl.textContent = "APIから読み込み";
    updatedEl.textContent = state.updatedAt;
    renderAll();
  } catch (error) {
    statusEl.textContent = `エラー: ${error.message}`;
  } finally {
    reloadBtn.disabled = false;
  }
}

reloadBtn.addEventListener("click", () => {
  localStorage.removeItem(DATA_CACHE_KEY);
  loadData(true);
});

loadSearchPrefs();
setupTabs();
loadData();
