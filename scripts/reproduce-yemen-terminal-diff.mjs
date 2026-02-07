import { buildCountryNormalization, inspectCountryString, normalizeCountryKey } from '../shared/countryNormalization.js';

const MAP_KEY = 'coffeeCountryMapping_v1';
const LS_KEY = 'coffeeRecordsCache_v2';

const normalization = buildCountryNormalization();

const seedRecords = [
  { country: 'Yemen', bean: 'Mocha A' },
  { country: 'Y\u200bemen', bean: 'Mocha B' },
  { country: 'ＹＥ', bean: 'Mocha C' },
  { country: 'イエメン', bean: 'Mocha D' }
];

const existingTerminalStorage = {
  [MAP_KEY]: {
    Yemen: 'YD',
    'Y\u200bemen': 'YE',
    イエメン: 'YE',
    YE: 'YE'
  },
  [LS_KEY]: {
    savedAt: Date.now(),
    payload: {
      items: seedRecords,
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  }
};

const freshTerminalStorage = {
  [MAP_KEY]: {
    イエメン: 'YE'
  },
  [LS_KEY]: {
    savedAt: Date.now(),
    payload: {
      items: seedRecords,
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  }
};

function sanitizeRecords(items) {
  return (items || []).map((record) => ({ ...record, country: normalizeCountryKey(record.country) }));
}

function normalizeMapping(mapping) {
  const out = {};
  Object.entries(mapping || {}).forEach(([key, value]) => {
    const normalizedKey = normalizeCountryKey(key);
    if (!normalizedKey) return;
    out[normalizedKey] = value;
  });
  return out;
}

function aggregate(records, mapping) {
  const mappedStats = new Map();
  const byRaw = new Map();
  records.forEach((record) => {
    const rawCountry = normalizeCountryKey(record.country);
    if (!rawCountry) return;
    if (!byRaw.has(rawCountry)) byRaw.set(rawCountry, 0);
    byRaw.set(rawCountry, byRaw.get(rawCountry) + 1);
  });

  byRaw.forEach((count, rawCountry) => {
    const mappedValue = mapping[rawCountry] || rawCountry;
    const iso2 = normalization.resolveToIso2(mappedValue);
    if (!iso2) return;
    const current = mappedStats.get(iso2) || { iso2, count: 0, rawCountries: [] };
    current.count += count;
    current.rawCountries.push(rawCountry);
    mappedStats.set(iso2, current);
  });

  return { byRaw, mappedStats };
}

function dumpScenario(label, storage) {
  const records = sanitizeRecords(storage[LS_KEY].payload.items);
  const mapping = normalizeMapping(storage[MAP_KEY]);
  const { byRaw, mappedStats } = aggregate(records, mapping);

  const yemenInputs = [...byRaw.keys()].filter((country) => /yemen|イエメン|ye/i.test(country));
  const traces = yemenInputs.map((rawCountry) => {
    const mappedValue = mapping[rawCountry] || null;
    const resolvedFromMapping = normalization.resolveToIso2(mappedValue || rawCountry);
    const featureResult = normalization.resolveFeatureToIso2({ properties: { ISO_A2: 'YD', name: 'Yemen' } });
    return {
      rawCountry,
      rawCountryInspect: inspectCountryString(rawCountry),
      mappingValue: mappedValue,
      mappingValueInspect: inspectCountryString(mappedValue),
      resolveToIso2: resolvedFromMapping,
      resolveFeatureToIso2: featureResult,
      mappedStatsHas: mappedStats.has(featureResult),
      mappedStatsGet: mappedStats.get(featureResult) || null
    };
  });

  return {
    label,
    mapping,
    recordsCount: records.length,
    yemenRecordCount: yemenInputs.reduce((sum, country) => sum + (byRaw.get(country) || 0), 0),
    yemenKeys: Object.keys(mapping).filter((key) => /yemen|イエメン|ye/i.test(key)),
    traces
  };
}

const existing = dumpScenario('existing-terminal', existingTerminalStorage);
const fresh = dumpScenario('fresh-terminal', freshTerminalStorage);

console.log('=== A. terminal-diff reproduction ===');
console.log(JSON.stringify({
  localStorageDiff: {
    [MAP_KEY]: {
      existing: existingTerminalStorage[MAP_KEY],
      fresh: freshTerminalStorage[MAP_KEY]
    },
    [LS_KEY]: {
      existingRecordCount: existingTerminalStorage[LS_KEY].payload.items.length,
      freshRecordCount: freshTerminalStorage[LS_KEY].payload.items.length
    }
  },
  existing,
  fresh
}, null, 2));

console.log('\n=== C. string normalization diagnostics ===');
const targets = ['Yemen', ' Yemen ', 'Y\u200bemen', 'ＹＥ', 'Y\u0008E', 'イエメン', 'イエ\u200bメン'];
console.table(targets.map((entry) => inspectCountryString(entry)));
