import { normalizeCountryKey } from "./countryNormalization.js";

export const MAP_KEY = "coffeeCountryMapping_v2";
export const MAP_LEGACY_KEY = "coffeeCountryMapping_v1";

function normalizeToken(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[^a-z0-9_-]/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

export function tokenFromIso2(iso2) {
  const code = String(iso2 || "").toUpperCase().trim();
  return code ? `iso2_${code.toLowerCase()}` : "";
}

export function createEmptyMappingModel() {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    aliasLayer: {},
    countryLayer: {},
    displayLayer: {},
    aliasMeta: {}
  };
}

export function cloneMappingModel(model) {
  return JSON.parse(JSON.stringify(model));
}

export function normalizeModel(model, countryNormalization) {
  const next = createEmptyMappingModel();
  const source = model || {};
  Object.entries(source.aliasLayer || {}).forEach(([rawCountry, token]) => {
    const normalizedRaw = normalizeCountryKey(rawCountry);
    const normalizedToken = normalizeToken(token);
    if (!normalizedRaw || !normalizedToken) return;
    next.aliasLayer[normalizedRaw] = normalizedToken;
  });
  Object.entries(source.countryLayer || {}).forEach(([token, isoValue]) => {
    const normalizedToken = normalizeToken(token);
    const iso2 = countryNormalization.resolveToIso2(isoValue);
    if (!normalizedToken || !iso2) return;
    next.countryLayer[normalizedToken] = iso2;
  });
  Object.entries(source.displayLayer || {}).forEach(([token, label]) => {
    const normalizedToken = normalizeToken(token);
    const text = normalizeCountryKey(label);
    if (!normalizedToken || !text) return;
    next.displayLayer[normalizedToken] = text;
  });
  Object.entries(source.aliasMeta || {}).forEach(([rawCountry, meta]) => {
    const normalizedRaw = normalizeCountryKey(rawCountry);
    if (!normalizedRaw) return;
    next.aliasMeta[normalizedRaw] = {
      updatedAt: meta?.updatedAt || source.updatedAt || new Date().toISOString()
    };
  });
  next.updatedAt = source.updatedAt || new Date().toISOString();
  return next;
}

export function applyLegacyMapping(model, legacyMapping, countryNormalization) {
  const next = cloneMappingModel(model);
  Object.entries(legacyMapping || {}).forEach(([rawCountry, value]) => {
    const normalizedRaw = normalizeCountryKey(rawCountry);
    const iso2 = countryNormalization.resolveToIso2(value);
    if (!normalizedRaw || !iso2) return;
    const token = tokenFromIso2(iso2);
    next.aliasLayer[normalizedRaw] = token;
    next.countryLayer[token] = iso2;
    next.displayLayer[token] = countryNormalization.getRecord(iso2)?.enName || iso2;
    next.aliasMeta[normalizedRaw] = { updatedAt: new Date().toISOString() };
  });
  next.updatedAt = new Date().toISOString();
  return next;
}

export function resolveAliasToIso2(rawCountry, model) {
  const normalizedRaw = normalizeCountryKey(rawCountry);
  if (!normalizedRaw) return { rawCountry: "", aliasToken: null, iso2: null };
  const aliasToken = model.aliasLayer[normalizedRaw] || null;
  const iso2 = aliasToken ? model.countryLayer[aliasToken] || null : null;
  return { rawCountry: normalizedRaw, aliasToken, iso2 };
}

export function upsertMapping(model, { rawCountry, token, iso2, displayName }) {
  const normalizedRaw = normalizeCountryKey(rawCountry);
  const normalizedToken = normalizeToken(token);
  const normalizedDisplay = normalizeCountryKey(displayName);
  if (!normalizedRaw || !normalizedToken || !iso2) return model;
  model.aliasLayer[normalizedRaw] = normalizedToken;
  model.countryLayer[normalizedToken] = String(iso2).toUpperCase();
  if (normalizedDisplay) model.displayLayer[normalizedToken] = normalizedDisplay;
  model.aliasMeta[normalizedRaw] = { updatedAt: new Date().toISOString() };
  model.updatedAt = new Date().toISOString();
  return model;
}

export function deleteAlias(model, rawCountry) {
  const normalizedRaw = normalizeCountryKey(rawCountry);
  if (!normalizedRaw) return model;
  delete model.aliasLayer[normalizedRaw];
  delete model.aliasMeta[normalizedRaw];
  model.updatedAt = new Date().toISOString();
  return model;
}
