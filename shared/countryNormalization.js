function normalizeLoose(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]/g, "");
}

const ISO3_BY_ISO2 = {
  BR: "BRA", CO: "COL", ET: "ETH", GT: "GTM", HN: "HND", ID: "IDN", KE: "KEN", PE: "PER", RW: "RWA", TZ: "TZA", VN: "VNM", YE: "YEM", CR: "CRI", PA: "PAN", BO: "BOL", BI: "BDI", EC: "ECU", SV: "SLV", IN: "IND", JM: "JAM", NI: "NIC", PG: "PNG", UG: "UGA", US: "USA", JP: "JPN", TH: "THA"
};

const EXTRA_ALIASES = {
  US: ["United States", "United States of America", "アメリカ", "米国"],
  GB: ["UK", "U.K.", "United Kingdom", "イギリス"],
  CZ: ["Czechia", "Czech Republic"],
  KR: ["South Korea", "Korea, Republic of", "韓国"],
  KP: ["North Korea"],
  LA: ["Laos", "Lao People's Democratic Republic"],
  MM: ["Myanmar", "Burma"],
  VN: ["Vietnam", "Viet Nam", "ベトナム"],
  TW: ["Taiwan", "台湾"],
  RU: ["Russia", "Russian Federation"],
  MD: ["Moldova", "Moldova, Republic of"],
  VE: ["Venezuela", "Venezuela, Bolivarian Republic of"],
  TZ: ["Tanzania", "Tanzania, United Republic of"],
  PS: ["Palestine", "State of Palestine"],
  SY: ["Syria", "Syrian Arab Republic"],
  IR: ["Iran", "Iran, Islamic Republic of"],
  BN: ["Brunei", "Brunei Darussalam"],
  FM: ["Micronesia", "Micronesia, Federated States of"],
  TH: ["Thailand", "Kingdom of Thailand", "タイ"]
};

export function buildCountryNormalization(additionalAliases = {}) {
  const byIso2 = new Map();

  const pushRecord = (iso2, enName, jaName) => {
    const code = String(iso2 || "").toUpperCase().trim();
    if (!/^[A-Z]{2}$/.test(code)) return;
    if (byIso2.has(code)) return;
    const aliases = new Set([code, enName]);
    if (jaName && jaName !== code) aliases.add(jaName);
    (EXTRA_ALIASES[code] || []).forEach((a) => aliases.add(a));
    (additionalAliases[code] || []).forEach((a) => aliases.add(a));
    byIso2.set(code, {
      iso2: code,
      iso3: ISO3_BY_ISO2[code] || null,
      enName,
      aliases: [...aliases].filter(Boolean)
    });
  };

  try {
    const dnEn = new Intl.DisplayNames(["en"], { type: "region" });
    const dnJa = new Intl.DisplayNames(["ja"], { type: "region" });
    for (let i = 65; i <= 90; i += 1) {
      for (let j = 65; j <= 90; j += 1) {
        const code = String.fromCharCode(i, j);
        const enName = dnEn.of(code);
        if (!enName || enName === code || /Unknown Region/i.test(enName)) continue;
        const jaName = dnJa.of(code);
        pushRecord(code, enName, jaName);
      }
    }
  } catch (error) {
    console.warn("Failed to build country normalization via Intl.DisplayNames", error);
  }

  if (!byIso2.size) {
    Object.entries(ISO3_BY_ISO2).forEach(([iso2, iso3]) => {
      pushRecord(iso2, iso2, iso2);
      const record = byIso2.get(iso2);
      record.iso3 = iso3;
    });
    console.warn("Country normalization fallback is active; names may be limited.");
  }

  const byIso3 = new Map();
  const byAlias = new Map();
  byIso2.forEach((record) => {
    if (record.iso3) byIso3.set(record.iso3.toUpperCase(), record.iso2);
    record.aliases.forEach((alias) => {
      const key = normalizeLoose(alias);
      if (!key) return;
      if (!byAlias.has(key)) byAlias.set(key, record.iso2);
    });
  });

  const records = [...byIso2.values()].sort((a, b) => a.enName.localeCompare(b.enName, "en"));

  function resolveToIso2(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const upper = raw.toUpperCase();
    if (/^[A-Z]{2}$/.test(upper) && byIso2.has(upper)) return upper;
    if (/^[A-Z]{3}$/.test(upper) && byIso3.has(upper)) return byIso3.get(upper);
    return byAlias.get(normalizeLoose(raw)) || null;
  }

  function getRecord(iso2) {
    return byIso2.get(String(iso2 || "").toUpperCase()) || null;
  }

  function resolveFeatureToIso2(feature) {
    if (!feature) return null;
    const props = feature.properties || {};
    const candidates = [
      feature.id,
      props.ISO_A2,
      props.iso_a2,
      props.ISO2,
      props.iso2,
      props.ISO_A3,
      props.iso_a3,
      props.ISO3,
      props.iso3,
      props.name,
      props.NAME,
      props.ADMIN,
      props.admin,
      props.NAME_EN,
      props.name_en
    ].filter((v) => v !== undefined && v !== null && String(v).trim());

    for (const candidate of candidates) {
      const resolved = resolveToIso2(String(candidate));
      if (resolved) return resolved;
    }
    return null;
  }

  return { records, resolveToIso2, getRecord, resolveFeatureToIso2 };
}
