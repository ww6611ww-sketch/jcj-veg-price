// 單位換算與聚合。計算保留完整精度，四捨五入只在畫面上做。
export const KG_PER_JIN = 0.6;

// 可按重量換算的原始單位
const WEIGHT_UNITS = { '元/台斤': 'jin', '元/斤': 'jin', '元/公斤': 'kg' };

export function isWeightUnit(u) { return u in WEIGHT_UNITS; }

/** 轉成 元/公斤（完整精度）。不可換算者回傳 null。 */
export function toPerKg(price, rawUnit) {
  const k = WEIGHT_UNITS[rawUnit];
  if (k === 'jin') return price / KG_PER_JIN;
  if (k === 'kg') return price;
  return null;
}
export function fromPerKg(perKg, target) {
  return target === 'jin' ? perKg * KG_PER_JIN : perKg;
}

/** 有效報價：數值、有限、>0。空值與來源用以代表缺價的 0 一律視為無報價。 */
export function parsePrice(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/,/g, '').trim();
  if (s === '' || s === '-' || s === '--' || s === 'NA') return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * 依 (日期, 地區, 品項, 規格, 價格類型) 聚合。
 * 只用 region 已辨識的報價；全國或特定區域報價（scope !== 'market'）以其實際範圍另列。
 */
export function aggregate(records) {
  const groups = new Map();
  for (const r of records) {
    if (r.perKg == null || r.excluded) continue;
    const area = r.scope === 'market' ? r.region : r.scope; // e.g. 'national', 'area:高屏'
    if (!area) continue;
    const k = [r.date, area, r.itemId, r.spec, r.priceType].join('|');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = [];
  for (const [k, rs] of groups) {
    const [date, area, itemId, spec, priceType] = k.split('|');
    // 同一市場若有重複列，取其中位數一筆，避免重複計數
    const byMarket = new Map();
    for (const r of rs) {
      if (!byMarket.has(r.market)) byMarket.set(r.market, []);
      byMarket.get(r.market).push(r.perKg);
    }
    const vals = [...byMarket.values()].map(median);
    out.push({
      date, area, itemId, spec, priceType,
      medianPerKg: median(vals), minPerKg: Math.min(...vals), maxPerKg: Math.max(...vals),
      marketCount: vals.length, single: vals.length === 1,
      flaggedMarkets: [...new Set(rs.filter(r => r.flag).map(r => r.market))],
      rawUnits: [...new Set(rs.map(r => r.rawUnit))],
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** 台灣日曆日（Asia/Taipei）YYYY-MM-DD */
export function taipeiDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function lastNDays(endDate, n) {
  const [y, m, d] = endDate.split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = new Date(Date.UTC(y, m - 1, d - i));
    out.push(t.toISOString().slice(0, 10));
  }
  return out;
}

/** 民國或西元日期字串 → YYYY-MM-DD。支援 115.11.24、1151124、115/11/24、2026-11-24、2026/11/24 */
export function normDate(s) {
  const t = String(s ?? '').trim();
  let m;
  if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = t.match(/^(\d{2,3})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return `${+m[1] + 1911}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = t.match(/^(\d{3})(\d{2})(\d{2})$/))) return `${+m[1] + 1911}-${m[2]}-${m[3]}`;
  if ((m = t.match(/^(\d{4})(\d{2})(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
