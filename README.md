# coffee-records-app

## Mapモードの地図データ参照方式（コード事実）

- Mapモードは `modes/map.js` の `loadWorldData()` で world-atlas を読み込みます。
- 参照元は `shared/cacheKeys.js` の `WORLD_ATLAS_URL` で、現在は `https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json` です。
- 取得後は `topojson.feature(topo, topo.objects.countries).features` に変換し、実行中メモリとして `state.worldFeatures` に保持します（`app.js` の `state`）。
- さらにアプリ側キャッシュとして `localStorage` に保存し、TTL内は再利用します（詳細は次節）。

## 地図データキャッシュ仕様（countries-50m向け）

### 保存先
`localStorage`

### キー
- `worldAtlasCache_v1`: countries-50m TopoJSON本文（文字列）
- `worldAtlasCacheMeta_v1`: メタ情報（`savedAt`, `ttlMs`, `url`）

### TTL
- `WORLD_ATLAS_TTL_MS = 14 * 24 * 60 * 60 * 1000`（14日）
- 理由: world-atlas は頻繁に変わらないため、50mの追加ロードを長期キャッシュで吸収するため。

### 更新条件
- TTL内: `worldAtlasCache_v1` を読み込み（fetchしない）
- TTL切れ/未保存/パース失敗: `countries-50m` を再fetchして両キーを更新

### 診断ログ（地図取得系）
`console.info("[Map] world atlas loaded", { source, url, featureCount })`
- `source: "network"` = fetchで取得
- `source: "cache"` = localStorageキャッシュを使用

## データキャッシュ全体（コーヒー + 地図）

### コーヒーデータキャッシュ
- キー: `coffeeRecordsCache_v2`
- TTL: `TTL_MS = 60 * 60 * 1000`（60分）

### 「データキャッシュをリセット」で削除される対象
Mapモードの「データキャッシュをリセット」は confirm 後に次をキー限定で削除します。

- コーヒーキャッシュ
  - `coffeeRecordsCache_v2`
- 地図キャッシュ
  - `worldAtlasCache_v1`
  - `worldAtlasCacheMeta_v1`

`#reset-status` には、削除した項目（コーヒーキャッシュ/地図キャッシュ）、キー名、失敗有無を表示します。

## diagnose の見方

Mapモード > 診断ログで「診断ログ出力」を押すと、UIと `console.info("[Map Mapping Diagnose]")` へ結果が出ます。

- `rawCountry`: 記録の国名（正規化後）
- `iso2`: `resolveAliasToIso2` で解決されたISO2
- `feature`: そのISO2が地図feature集合に存在するか（`FOUND/NOT FOUND`）
- `join`: そのISO2で集計結果に合流できたか（`JOINED/NOT JOINED`）

## mapped-but-unjoinable の修正入口

1. `shared/countryNormalization.js`
   - `resolveFeatureToIso2`
   - `resolveToIso2`
   - `FEATURE_ID_TO_ISO2`（最後のフォールバック）
2. `shared/countryMapping.js`
   - `resolveAliasToIso2`
   - `tokenFromIso2`
   - `normalizeModel`
3. `modes/map.js`
   - `buildCountryAggregation`（feature未存在/合流判定）
   - `renderDiagnoseStatus` / `emitMappingTrace`

## Dominica（DM）改善の事実

- 地図参照元を `countries-110m` から `countries-50m` へ切替。
- `resolveFeatureToIso2` は `ISO_A2/ISO_A3/name` を優先し、必要時のみ `feature.id` + `FEATURE_ID_TO_ISO2` へフォールバックする順に調整。
- 実確認として、`countries-50m` 由来 feature に対して `Dominica (id: 212)` が `DM` に解決されるテスト/診断を実施。
