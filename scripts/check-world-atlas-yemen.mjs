import { buildCountryNormalization } from '../shared/countryNormalization.js';

const normalization = buildCountryNormalization();
const URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

async function run() {
  try {
    const response = await fetch(URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const topo = await response.json();
    const geometries = topo?.objects?.countries?.geometries || [];
    const candidate = geometries.find((geometry) => String(geometry.id) === '887');

    console.log('CDN fetch status: ok');
    console.log('geometry count:', geometries.length);
    console.log('Yemen candidate by id=887:', candidate || null);

    const syntheticFeature = {
      id: candidate?.id || '887',
      properties: {
        ISO_A2: 'YD',
        ISO_A3: 'YEM',
        name: 'Yemen'
      }
    };

    console.log('resolveFeatureToIso2(synthetic Yemen):', normalization.resolveFeatureToIso2(syntheticFeature));
  } catch (error) {
    console.warn('CDN fetch failed in this environment:', error.message);
    const syntheticFeature = { properties: { ISO_A2: 'YD', ISO_A3: 'YEM', name: 'Yemen' } };
    console.log('Fallback resolveFeatureToIso2(synthetic Yemen):', normalization.resolveFeatureToIso2(syntheticFeature));
    process.exitCode = 2;
  }
}

await run();
