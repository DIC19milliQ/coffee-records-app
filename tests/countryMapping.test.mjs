import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCountryNormalization, normalizeCountryKey } from '../shared/countryNormalization.js';
import { applyLegacyMapping, createEmptyMappingModel, normalizeModel, resolveAliasToIso2, tokenFromIso2, upsertMapping } from '../shared/countryMapping.js';

const normalization = buildCountryNormalization();

test('legacy single-layer mapping migrates into alias/country layers', () => {
  const model = applyLegacyMapping(createEmptyMappingModel(), { 'China mainland': 'CN' }, normalization);
  const resolved = resolveAliasToIso2('China mainland', model);
  assert.equal(resolved.aliasToken, tokenFromIso2('CN'));
  assert.equal(resolved.iso2, 'CN');
});

test('normalizeModel enforces key normalization', () => {
  const model = normalizeModel({
    aliasLayer: { ' China\u200b mainland ': 'iso2_cn' },
    countryLayer: { iso2_cn: 'cn' },
    displayLayer: { iso2_cn: ' China ' }
  }, normalization);
  assert.equal(Object.keys(model.aliasLayer)[0], normalizeCountryKey('China mainland'));
  assert.equal(model.countryLayer.iso2_cn, 'CN');
});

test('upsertMapping stores display/internal key split', () => {
  const model = createEmptyMappingModel();
  upsertMapping(model, { rawCountry: 'People\'s Republic of China', token: 'china_token', iso2: 'CN', displayName: 'China' });
  const resolved = resolveAliasToIso2('People\'s Republic of China', model);
  assert.equal(resolved.aliasToken, 'china_token');
  assert.equal(model.displayLayer.china_token, 'China');
  assert.equal(resolved.iso2, 'CN');
});
