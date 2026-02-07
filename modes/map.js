export function initMap(container, context) {
  const { state, loadMapping, saveMapping, ISO2_TO_NAME } = context;

  container.innerHTML = `<div class="card"><h2>コンプリート地図</h2><p class="muted">国ごとの豆の種類数（ユニーク数）を可視化。P95で上限を切り、平方根スケールで色付けしています。</p><div id="map"></div><div class="legend"><span>少ない</span><div class="legend-bar"></div><span>多い</span></div></div><div class="card"><h3>未マッピングの国</h3><p class="muted">地図側の国名またはISO2コードを登録してください。</p><div id="unmapped-list"></div><div class="grid-2" style="margin-top:12px;"><div><label>対象国</label><select id="unmapped-select"></select></div><div><label>マップキー（国名 or ISO2）</label><input id="mapping-input" type="text" placeholder="例: Brazil / BR" /></div></div><button id="save-mapping" style="margin-top:12px;">マッピング保存</button></div>`;

  async function loadWorldData() {
    if (state.worldFeatures) return state.worldFeatures;
    const response = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
    const topo = await response.json();
    const features = topojson.feature(topo, topo.objects.countries).features;
    state.worldFeatures = features;
    return features;
  }

  function resolveMapKey(jpName) {
    const mapped = state.mapping[jpName];
    if (!mapped) return null;
    const trimmed = mapped.trim();
    if (trimmed.length === 2) return ISO2_TO_NAME[trimmed.toUpperCase()] || null;
    return trimmed;
  }

  function computeCountryCounts() {
    const map = new Map();
    state.records.forEach((record) => {
      const country = String(record.country || "").trim();
      const bean = String(record.bean || "").trim();
      if (!country || !bean) return;
      if (!map.has(country)) map.set(country, new Set());
      map.get(country).add(bean);
    });
    const counts = new Map();
    map.forEach((set, country) => counts.set(country, set.size));
    return counts;
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

  async function renderMap() {
    const mapRoot = container.querySelector("#map");
    mapRoot.innerHTML = "";
    const features = await loadWorldData();
    const nameToFeature = new Map(features.map((feature) => [feature.properties.name, feature]));
    const rawCounts = computeCountryCounts();
    const mappedCounts = new Map();
    const unmapped = [];
    rawCounts.forEach((count, jpName) => {
      const mapKey = resolveMapKey(jpName);
      if (!mapKey || !nameToFeature.has(mapKey)) {
        unmapped.push({ name: jpName, count });
        return;
      }
      mappedCounts.set(mapKey, count);
    });
    const values = [...mappedCounts.values()].sort((a, b) => a - b);
    const p95 = values.length ? values[Math.floor((values.length - 1) * 0.95)] : 1;
    const scale = d3.scaleSequential(d3.interpolateYlOrBr).domain([0, Math.sqrt(p95)]);
    const width = 960;
    const height = 480;
    const svg = d3.select(mapRoot).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "coffee origin map");
    const projection = d3.geoMercator().fitSize([width, height], { type: "FeatureCollection", features });
    const path = d3.geoPath(projection);
    svg.selectAll("path").data(features).enter().append("path").attr("d", path).attr("fill", (feature) => {
      const value = mappedCounts.get(feature.properties.name) || 0;
      const capped = Math.min(value, p95);
      return value > 0 ? scale(Math.sqrt(capped)) : "#f5f3ef";
    }).attr("stroke", "#ffffff").attr("stroke-width", 0.5);
    renderUnmapped(unmapped);
  }

  state.mapping = loadMapping();
  container.querySelector("#save-mapping").addEventListener("click", () => {
    const country = container.querySelector("#unmapped-select").value;
    const value = container.querySelector("#mapping-input").value.trim();
    if (!country || !value) return;
    state.mapping[country] = value;
    saveMapping(state.mapping);
    container.querySelector("#mapping-input").value = "";
    renderMap();
  });

  return { render: renderMap };
}
