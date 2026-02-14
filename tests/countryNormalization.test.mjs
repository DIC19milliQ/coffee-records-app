import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCountryNormalization, inspectCountryString, normalizeCountryKey } from '../shared/countryNormalization.js';

const normalization = buildCountryNormalization();

function aggregateByCountry(records, mapping) {
  const grouped = new Map();
  records.forEach((record) => {
    const rawCountry = normalizeCountryKey(record.country);
    if (!rawCountry) return;
    const mappedValue = mapping[rawCountry] || rawCountry;
    const iso2 = normalization.resolveToIso2(mappedValue);
    if (!iso2) return;
    grouped.set(iso2, (grouped.get(iso2) || 0) + 1);
  });
  return grouped;
}

test('legacy ISO2 is canonicalized to current ISO2', () => {
  Object.entries(normalization.legacyIso2ToCanonical).forEach(([legacyIso2, canonicalIso2]) => {
    assert.equal(normalization.resolveToIso2(legacyIso2), canonicalIso2, `${legacyIso2} should resolve to ${canonicalIso2}`);
  });
});

test('YE and YD both resolve to YE', () => {
  assert.equal(normalization.resolveToIso2('YE'), 'YE');
  assert.equal(normalization.resolveToIso2('YD'), 'YE');
  assert.equal(normalization.resolveToIso2(' y d '), 'YE');
});

test('Vietnam aliases resolve to VD for map feature compatibility', () => {
  assert.equal(normalization.resolveToIso2('Vietnam'), 'VD');
  assert.equal(normalization.resolveToIso2('Viet Nam'), 'VD');
  assert.equal(normalization.resolveToIso2('ベトナム'), 'VD');
  assert.equal(normalization.resolveToIso2('vn'), 'VD');
});

test('resolveFeatureToIso2 prioritizes ISO/name properties and then falls back to feature.id table', () => {
  assert.equal(normalization.resolveFeatureToIso2({ id: '156', properties: { ISO_A2: 'YE' } }), 'YE');
  assert.equal(normalization.resolveFeatureToIso2({ id: '156', properties: { name: 'China mainland' } }), 'CN');
  assert.equal(normalization.resolveFeatureToIso2({ properties: { ISO_A2: 'YD' } }), 'YE');
  assert.equal(normalization.resolveFeatureToIso2({ properties: { ISO_A2: 'YE' } }), 'YE');
});


test('resolveFeatureToIso2 resolves Dominica feature id 212 to DM', () => {
  assert.equal(normalization.resolveFeatureToIso2({ id: '212', properties: { name: 'Dominica' } }), 'DM');
});

test('normalizeCountryKey collapses invisible/control characters', () => {
  assert.equal(normalizeCountryKey('Y\u200bemen'), 'Yemen');
  assert.equal(normalizeCountryKey('  イエ\u200bメン  '), 'イエメン');
  assert.equal(normalizeCountryKey('ＹＥ'), 'YE');
});

test('inspectCountryString exposes normalization deltas', () => {
  const inspected = inspectCountryString(' Y\u200bD ');
  assert.equal(inspected.trimmed, 'Y\u200bD');
  assert.equal(inspected.normalizedKey, 'YD');
  assert.equal(inspected.hasInvisibleOrControl, true);
});

test('first device and existing device produce same Yemen aggregation after key normalization', () => {
  const records = [
    { country: 'Yemen', bean: 'A' },
    { country: 'Y\u200bemen', bean: 'B' },
    { country: 'ＹＥ', bean: 'C' }
  ];

  const freshDeviceMapping = {
    Yemen: 'YE'
  };

  const existingDeviceMapping = {
    Yemen: 'YD',
    'Y\u200bemen': 'YE',
    YE: 'YE'
  };

  const fresh = aggregateByCountry(records, freshDeviceMapping);
  const existing = aggregateByCountry(records, existingDeviceMapping);

  assert.equal(fresh.get('YE'), 3);
  assert.equal(existing.get('YE'), 3);
});
