export const SEARCH_COLUMNS = [
  { key: "country", label: "国" },
  { key: "bean", label: "豆" },
  { key: "altitude", label: "標高" },
  { key: "process", label: "精製" },
  { key: "roast", label: "焙煎" },
  { key: "rating", label: "評価" },
  { key: "shop", label: "ショップ" },
  { key: "price", label: "価格" },
  { key: "bitter", label: "苦味" },
  { key: "acid", label: "酸味" },
  { key: "date", label: "日付" },
  { key: "region", label: "地域" },
  { key: "note", label: "ノート" }
];

export const DEFAULT_VISIBLE_COLUMNS = ["country", "bean", "altitude", "process", "roast", "rating"];
export const ROAST_OPTIONS = ["浅煎り", "中浅煎り", "中煎り", "中深煎り", "深煎り"];
export const LEGACY_ROAST_MAP = { "浅": "浅煎り", "中": "中煎り", "中深": "中深煎り", "深": "深煎り" };
