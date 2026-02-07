export const normalizeText = (v) => String(v ?? "").replace(/^﻿/, "").normalize("NFKC").toLowerCase().trim();
export const validTaste = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
};
export function formatDate(v) {
  if (!v) return "未記録";
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return "未記録";
  const d = new Date(t);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}
export function getDateValue(v) {
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}
export const display = (v) => String(v || "").trim() || "未記録";
export function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
