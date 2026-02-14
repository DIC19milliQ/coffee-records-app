function normalizeLoose(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]/g, "");
}

const INVISIBLE_AND_CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;

export function normalizeCountryKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(INVISIBLE_AND_CONTROL, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function inspectCountryString(value) {
  const raw = String(value || "");
  return {
    raw,
    trimmed: raw.trim(),
    nfkc: raw.normalize("NFKC"),
    normalizedKey: normalizeCountryKey(raw),
    hasInvisibleOrControl: /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/.test(raw),
    codePoints: [...raw].map((char) => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`)
  };
}

const ISO3_BY_ISO2 = {
  BR: "BRA", CO: "COL", ET: "ETH", GT: "GTM", HN: "HND", ID: "IDN", KE: "KEN", PE: "PER", RW: "RWA", TZ: "TZA", VD: "VNM", YE: "YEM", CR: "CRI", PA: "PAN", BO: "BOL", BI: "BDI", EC: "ECU", SV: "SLV", IN: "IND", JM: "JAM", NI: "NIC", PG: "PNG", UG: "UGA", US: "USA", JP: "JPN", TH: "THA"
};


const FEATURE_ID_TO_ISO2 = {
  "76": "BR", "170": "CO", "231": "ET", "320": "GT", "340": "HN", "360": "ID", "404": "KE", "604": "PE", "646": "RW", "834": "TZ", "704": "VD", "887": "YE", "188": "CR", "591": "PA", "68": "BO", "108": "BI", "218": "EC", "222": "SV", "356": "IN", "388": "JM", "558": "NI", "598": "PG", "800": "UG", "764": "TH", "156": "CN", "392": "JP", "104": "MM", "212": "DM", "214": "DO", "840": "US", "826": "GB"
};

const LEGACY_ISO2_TO_CANONICAL = {
  BU: "MM",
  DD: "DE",
  FX: "FR",
  TP: "TL",
  VN: "VD",
  YD: "YE",
  YU: "RS",
  ZR: "CD"
};

const EXTRA_ALIASES = {
  US: ["United States", "United States of America", "アメリカ", "米国"],
  GB: ["UK", "U.K.", "United Kingdom", "イギリス"],
  CZ: ["Czechia", "Czech Republic"],
  KR: ["South Korea", "Korea, Republic of", "韓国"],
  KP: ["North Korea"],
  LA: ["Laos", "Lao People's Democratic Republic"],
  MM: ["Myanmar", "Burma"],
  VD: ["Vietnam", "Viet Nam", "ベトナム"],
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

  if (!byIso2.has("VD") && byIso2.has("VN")) {
    const vnRecord = byIso2.get("VN");
    byIso2.set("VD", {
      ...vnRecord,
      iso2: "VD",
      iso3: "VNM",
      aliases: [...new Set([...(vnRecord.aliases || []), "VD", ...(EXTRA_ALIASES.VD || [])])]
    });
  }

  const byIso3 = new Map();
  const byAlias = new Map();
  byIso2.forEach((record) => {
    if (record.iso3) byIso3.set(record.iso3.toUpperCase(), LEGACY_ISO2_TO_CANONICAL[record.iso2] || record.iso2);
    record.aliases.forEach((alias) => {
      const key = normalizeLoose(alias);
      if (!key) return;
      if (!byAlias.has(key)) byAlias.set(key, LEGACY_ISO2_TO_CANONICAL[record.iso2] || record.iso2);
    });
  });

  Object.entries(LEGACY_ISO2_TO_CANONICAL).forEach(([legacyIso2, canonicalIso2]) => {
    if (!byIso2.has(canonicalIso2)) return;
    byAlias.set(normalizeLoose(legacyIso2), canonicalIso2);
  });

  const records = [...byIso2.values()].sort((a, b) => a.enName.localeCompare(b.enName, "en"));

  function resolveToIso2(value) {
    const raw = normalizeCountryKey(value);
    if (!raw) return null;
    const upper = raw.toUpperCase();
    if (/^[A-Z]{2}$/.test(upper) && LEGACY_ISO2_TO_CANONICAL[upper]) return LEGACY_ISO2_TO_CANONICAL[upper];
    if (/^[A-Z]{2}$/.test(upper) && byIso2.has(upper)) return upper;
    if (/^[A-Z]{3}$/.test(upper) && byIso3.has(upper)) return byIso3.get(upper);
    const resolved = byAlias.get(normalizeLoose(raw)) || null;
    return resolved ? (LEGACY_ISO2_TO_CANONICAL[resolved] || resolved) : null;
  }

  function getRecord(iso2) {
    return byIso2.get(String(iso2 || "").toUpperCase()) || null;
  }

  function resolveFeatureToIso2(feature) {
    if (!feature) return null;
    const props = feature.properties || {};

    const isoCandidates = [
      props.ISO_A2,
      props.iso_a2,
      props.ISO2,
      props.iso2,
      props.ISO_A3,
      props.iso_a3,
      props.ISO3,
      props.iso3
    ].filter((v) => v !== undefined && v !== null && String(v).trim());
    for (const candidate of isoCandidates) {
      const resolved = resolveToIso2(String(candidate));
      if (resolved) return resolved;
    }

    const nameCandidates = [
      props.name,
      props.NAME,
      props.ADMIN,
      props.admin,
      props.NAME_EN,
      props.name_en
    ].filter((v) => v !== undefined && v !== null && String(v).trim());
    for (const candidate of nameCandidates) {
      const resolved = resolveToIso2(String(candidate));
      if (resolved) return resolved;
    }

    const idCandidates = [feature.id, props.id, props.ID].filter((v) => v !== undefined && v !== null && String(v).trim());
    for (const candidate of idCandidates) {
      const idKey = String(candidate).trim();
      const resolvedById = resolveToIso2(idKey);
      if (resolvedById) return resolvedById;
      const resolvedByIdTable = FEATURE_ID_TO_ISO2[idKey];
      if (resolvedByIdTable) return LEGACY_ISO2_TO_CANONICAL[resolvedByIdTable] || resolvedByIdTable;
    }
    return null;
  }

  return {
    records,
    resolveToIso2,
    getRecord,
    resolveFeatureToIso2,
    legacyIso2ToCanonical: { ...LEGACY_ISO2_TO_CANONICAL }
  };
}
