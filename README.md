# coffee-records-app

## 現状仕様（コードで確認した事実）

### 保存先とキー
このアプリは `localStorage` のみを使用します。

- `coffeeCountryMapping_v2`
  - 地図モードのマッピング本体（alias/country/display/meta）
  - 定義: `shared/countryMapping.js` の `MAP_KEY`。
- `coffeeCountryMapping_v1`
  - 旧マッピングキー。起動時に読み取り後、`v2` に取り込み、削除。
  - 定義: `shared/countryMapping.js` の `MAP_LEGACY_KEY`。
- `coffeeRecordsCache_v2`
  - API取得結果のキャッシュ。
  - 形式: `{ savedAt, payload }`。
  - `payload` は `{ items, updatedAt, fetchedAt }`。
- `coffeeSearchPrefs_v1`
  - Searchタブの列表示・ソート・フィルタ設定。

### 起動時データ取得フロー（TTL含む）

- `app.js` の `loadData(force = false)` が起動時に実行される。
- `force=false` の場合、まず `coffeeRecordsCache_v2` を参照。
- キャッシュ判定:
  - `savedAt` と `payload` が存在
  - `Date.now() - savedAt <= TTL_MS`
- `TTL_MS = 60 * 60 * 1000`（60分）
- TTL内ならキャッシュ使用（`status: キャッシュから読み込み`）。
- TTL切れ・未保存ならAPI fetchし、`coffeeRecordsCache_v2` を更新。

## 追加した運用UI（下部の運用パネルに集約）

地図モードの「運用パネル > マッピング管理」に以下を追加。

- 「地図マッピングをリセット」
  - 実行前に confirm。
  - 削除対象キー: `coffeeCountryMapping_v2`, `coffeeCountryMapping_v1`。
  - その後、デフォルトマッピングを再生成して再描画（初期状態へ復帰）。
  - 画面に「削除キー一覧」「失敗有無」を表示。
- 「データキャッシュをリセット」
  - 実行前に confirm。
  - 削除対象キー: `coffeeRecordsCache_v2`。
  - 画面に「削除キー一覧」「失敗有無」「必要なら再読込案内」を表示。

どちらもアプリ使用キーのみ削除し、全ストレージ削除は行わない実装です。

## 診断ログの見方

地図モードの「診断ログ」から対象国を選び「診断ログ出力」を押すと、UI表示と `console.info("[Map Mapping Diagnose]")` が出力されます。

- `rawCountry`
  - 記録データにある生の国名（正規化後）。
- `iso2`
  - マッピング解決結果（`resolveAliasToIso2` の結果）。
- `feature`
  - `resolveFeatureToIso2` で地図 feature 側にISO2が見つかるか。
  - `FOUND/NOT FOUND` と key（alias token 等）を表示。
- `join`
  - 集計済みデータ `mappedStats` にそのISO2で合流できたか。
  - `JOINED/NOT JOINED` を表示。

## mapped-but-unjoinable の修正入口

発生時は以下を順に確認します。

1. `shared/countryNormalization.js`
   - `resolveFeatureToIso2`
   - `FEATURE_ID_TO_ISO2`
   - `resolveToIso2`
2. `shared/countryMapping.js`
   - `tokenFromIso2`（`iso2_${lower}`）
   - `resolveAliasToIso2`
   - `normalizeModel`
3. `modes/map.js`
   - `buildCountryAggregation`（unjoinable判定）
   - `renderDiagnoseStatus` / `emitMappingTrace`

## ドミニカ国（DM）対応で今回修正した事実

- 症状例: `Dominica / iso2: DM / feature: NOT FOUND (key: iso2_dm)`。
- 修正:
  - `shared/countryNormalization.js` の `FEATURE_ID_TO_ISO2` に `"212": "DM"` を追加。
- 意図:
  - `world-atlas` feature ID 解決で `212 -> DM` が可能になり、feature判定とjoinの整合性が取れる。
- テスト追加:
  - `tests/countryNormalization.test.mjs` に `id: '212'` が `DM` に解決されるケースを追加。

