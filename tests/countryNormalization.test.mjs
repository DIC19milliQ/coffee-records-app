import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCountryNormalization } from '../shared/countryNormalization.js';

const normalization = buildCountryNormalization();

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

test('resolveFeatureToIso2 canonicalizes legacy feature IDs', () => {
  assert.equal(normalization.resolveFeatureToIso2({ properties: { ISO_A2: 'YD' } }), 'YE');
  assert.equal(normalization.resolveFeatureToIso2({ properties: { ISO_A2: 'YE' } }), 'YE');
});
