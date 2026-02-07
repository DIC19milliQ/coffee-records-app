import { buildCountryNormalization } from '../shared/countryNormalization.js';

const normalization = buildCountryNormalization();
const legacyTable = normalization.legacyIso2ToCanonical;

function makeFeature(iso2, name) {
  return {
    id: null,
    properties: {
      ISO_A2: iso2,
      iso_a2: iso2,
      name
    }
  };
}

function resolveToIso2PreFix(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  const rec = normalization.records.find((entry) => entry.iso2 === upper);
  if (rec) return upper;
  const byIso3 = normalization.records.find((entry) => entry.iso3 === upper);
  if (byIso3) return byIso3.iso2;
  const key = String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]/g, '');
  for (const entry of normalization.records) {
    if (entry.aliases.some((alias) => String(alias || '').toLowerCase().normalize('NFKC').replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]/g, '') === key)) {
      return entry.iso2;
    }
  }
  return null;
}

function getCanonicalName(iso2) {
  return normalization.getRecord(iso2)?.enName || iso2;
}

function chain(mappedValue, featureIso2Code, usePreFixResolver = false) {
  const canonicalName = getCanonicalName('YE');
  const feature = makeFeature(featureIso2Code, canonicalName);
  const resolver = usePreFixResolver ? resolveToIso2PreFix : normalization.resolveToIso2;
  const mappedIso2 = resolver(mappedValue);

  // resolveFeatureToIso2 internally uses current resolver, so pre-fix simulation is explicit:
  const featureIso2 = usePreFixResolver ? resolver(feature.properties.ISO_A2) || resolver(feature.properties.name) : normalization.resolveFeatureToIso2(feature);
  const mappedStats = new Map();
  if (mappedIso2) mappedStats.set(mappedIso2, { count: 1 });
  return {
    mappedValue,
    featureCode: featureIso2Code,
    mappedIso2,
    featureIso2,
    joinHit: Boolean(featureIso2 && mappedStats.has(featureIso2))
  };
}

console.log('=== Yemen chain reproduction ===');
console.log('Before fix simulation (legacy code not canonicalized):');
console.table([
  chain('YE', 'YD', true),
  chain('YD', 'YD', true)
]);

console.log('After fix (legacy code canonicalized):');
console.table([
  chain('YE', 'YD', false),
  chain('YD', 'YD', false),
  chain('YE', 'YE', false),
  chain('YD', 'YE', false)
]);

console.log('\n=== Legacy ISO2 diagnosis matrix ===');
const matrix = Object.entries(legacyTable).map(([legacyIso2, canonicalIso2]) => {
  const canonicalName = getCanonicalName(canonicalIso2);
  const resolveLegacy = normalization.resolveToIso2(legacyIso2);
  const resolveCanonical = normalization.resolveToIso2(canonicalIso2);

  const featureLegacy = makeFeature(legacyIso2, canonicalName);
  const featureCanonical = makeFeature(canonicalIso2, canonicalName);

  const featureLegacyIso2 = normalization.resolveFeatureToIso2(featureLegacy);
  const featureCanonicalIso2 = normalization.resolveFeatureToIso2(featureCanonical);

  const mappedStats = new Map([[resolveCanonical, { count: 1 }]]);
  const canJoinLegacyFeature = Boolean(featureLegacyIso2 && mappedStats.has(featureLegacyIso2));
  const canJoinCanonicalFeature = Boolean(featureCanonicalIso2 && mappedStats.has(featureCanonicalIso2));

  const status = (resolveLegacy === canonicalIso2
    && resolveCanonical === canonicalIso2
    && canJoinLegacyFeature
    && canJoinCanonicalFeature)
    ? '問題なし'
    : '要修正';

  return {
    legacyIso2,
    canonicalIso2,
    resolveToIso2Legacy: resolveLegacy,
    resolveToIso2Canonical: resolveCanonical,
    featureLegacyIso2,
    featureCanonicalIso2,
    canJoinLegacyFeature,
    canJoinCanonicalFeature,
    status
  };
});
console.table(matrix);

const needsFix = matrix.filter((row) => row.status === '要修正');
if (needsFix.length) {
  console.log('\n要修正コード:');
  console.table(needsFix);
  process.exitCode = 1;
}
