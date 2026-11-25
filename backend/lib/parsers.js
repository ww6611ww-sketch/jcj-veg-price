// 五個來源的解析器：原始檔（CSV 或 JSON）→ 統一格式紀錄 + 解析報告。
// 欄位比對一律以「去空白、統一括號」後的名稱進行；找不到的欄位寫進報告，不猜測。
import { ITEMS } from './catalog.js';
import { lookupMarket } from './markets.js';
import { parsePrice, toPerKg, normDate } from './price.js';

export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const nonEmpty = rows.filter(r => r.some(x => x.trim() !== ''));
  const [head, ...body] = nonEmpty;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}

/** 原始內容 → 物件陣列。JSON 可為陣列或 {data|Data|result: [...]} */
export function toRows(text) {
  const t = text.replace(/^﻿/, '').trim();
  if (t.startsWith('[') || t.startsWith('{')) {
    const j = JSON.parse(t);
    if (Array.isArray(j)) return j;
    for (const k of ['data', 'Data', 'result', 'records', 'Result']) if (Array.isArray(j[k])) return j[k];
    throw new Error('JSON 內找不到資料陣列');
  }
  return parseCSV(t);
}

export const normKey = s => String(s).replace(/\s|　/g, '').replace(/（/g, '(').replace(/）/g, ')').replace(/_/g, '-');
function pick(row, ...names) {
  const m = new Map(Object.keys(row).map(k => [normKey(k), k]));
  for (const n of names) { const k = m.get(normKey(n)); if (k !== undefined) return row[k]; }
  return undefined;
}
// 欄名可能帶單位後綴，例如「白肉雞(2.0Kg以上)(元/台斤)」：以去空白、統一括號後的前綴比對
function pickPrefix(row, name) {
  const n = normKey(name);
  const k = Object.keys(row).find(k => normKey(k) === n) ?? Object.keys(row).find(k => normKey(k).startsWith(n));
  return k === undefined ? undefined : row[k];
}
const rec = (o) => ({ spec: '', scope: 'market', volume: null, ...o, perKg: toPerKg(o.price, o.rawUnit) });

// ---------- 1. 臺中市公有零售市場每日價格（data.gov.tw 84539）寬表 ----------
export function parseTaichungRetail(rows, { rawUnit = '元/斤' } = {}) {
  const report = { headersSeen: rows[0] ? Object.keys(rows[0]) : [], itemColumns: {}, badDates: 0, unmappedMarkets: [] };
  const headerSet = new Set(report.headersSeen.map(normKey));
  for (const it of ITEMS.filter(i => i.taichung)) {
    const col = it.taichung.find(c => headerSet.has(normKey(c)));
    report.itemColumns[it.id] = col ? { found: col } : { missing: it.taichung };
  }
  const records = [];
  for (const row of rows) {
    const market = String(pick(row, '市場名稱') ?? '').trim();
    const date = normDate(pick(row, '訪價日期', '日期'));
    if (!date) { report.badDates++; continue; }
    const loc = lookupMarket(market, { source: 'taichung_retail' });
    for (const it of ITEMS.filter(i => i.taichung)) {
      const c = report.itemColumns[it.id].found; if (!c) continue;
      const price = parsePrice(pick(row, c));
      if (price == null) continue; // 0 或空值＝無報價
      records.push(rec({ source: 'taichung_retail', priceType: 'retail', itemId: it.id, rawItemName: c,
        market, county: loc.county, region: loc.region, date, price, rawUnit }));
    }
  }
  return { records, report };
}

// ---------- 2. 農產品（蔬菜）批發交易行情（8066） ----------
export function parseVegWholesale(rows) {
  const report = { unmappedMarkets: new Set(), skippedRest: 0, badDates: 0 };
  const records = [];
  for (const row of rows) {
    const name = String(pick(row, '作物名稱', 'CropName') ?? '').trim();
    if (!name || name === '休市') { report.skippedRest++; continue; }
    const it = ITEMS.find(i => i.veg && name.startsWith(i.veg.prefix));
    if (!it) continue;
    const date = normDate(pick(row, '交易日期', 'TransDate')); if (!date) { report.badDates++; continue; }
    const market = String(pick(row, '市場名稱', 'MarketName') ?? '').trim();
    const price = parsePrice(pick(row, '平均價', 'Avg_Price')); if (price == null) continue;
    const loc = lookupMarket(market); if (!loc) report.unmappedMarkets.add(market);
    const spec = name.includes('-') ? name.split('-').slice(1).join('-') : '';
    records.push(rec({ source: 'moa_veg', priceType: 'wholesale', itemId: it.id, rawItemName: name, spec,
      market, county: loc?.county ?? null, region: loc?.region ?? null, date, price, rawUnit: '元/公斤',
      volume: parsePrice(pick(row, '交易量', 'Trans_Quantity')) }));
  }
  report.unmappedMarkets = [...report.unmappedMarkets];
  return { records, report };
}

// ---------- 3. 漁產品批發交易行情（7299） ----------
export function parseFishWholesale(rows) {
  const report = { unmappedMarkets: new Set(), badDates: 0 };
  const records = [];
  for (const row of rows) {
    const name = String(pick(row, '魚貨名稱', '品種名稱', 'FishName') ?? '').trim();
    const it = ITEMS.find(i => i.fish && name.includes(i.fish.includes)); if (!it) continue;
    const date = normDate(pick(row, '交易日期', 'TransDate')); if (!date) { report.badDates++; continue; }
    const market = String(pick(row, '市場名稱', 'MarketName') ?? '').trim();
    const price = parsePrice(pick(row, '平均價', 'Avg_Price')); if (price == null) continue;
    const loc = lookupMarket(market); if (!loc) report.unmappedMarkets.add(market);
    const code = String(pick(row, '品種代碼', 'FishCode') ?? '').trim();
    const base = name === it.fish.includes || name === it.name ? '' : name; // 不同名稱規格（如「虱目魚肚」）分開比較
    records.push(rec({ source: 'moa_fish', priceType: 'wholesale', itemId: it.id, rawItemName: code ? `${name}#${code}` : name, fishCode: code || null,
      spec: it.fish.specByCode && code ? [base, `品種代碼 ${code}`].filter(Boolean).join(' ') : base, // 同名不同代碼（如午仔魚 1272／2271）分開比較
      market, county: loc?.county ?? null, region: loc?.region ?? null, date, price, rawUnit: '元/公斤',
      volume: parsePrice(pick(row, '交易量', 'Trans_Quantity')) }));
  }
  report.unmappedMarkets = [...report.unmappedMarkets];
  return { records, report };
}

// ---------- 4. 毛豬交易行情（農業部 026／data.gov.tw 7296）活體拍賣價，元/公斤 ----------
const HOG_SPECS = [
  ['規格豬-平均價格', '規格豬'],
  ['95(含)-115(含)-平均價格', '95–115 公斤'],
  ['115(含)-135(不含)-平均價格', '115–135 公斤'],
  ['75(含)-95(不含)-平均價格', '75–95 公斤'],
];
export function parseHog(rows) {
  const report = { unmappedMarkets: new Set(), badDates: 0, specFields: {} };
  const records = [];
  for (const row of rows) {
    const date = normDate(pick(row, '交易日期')); if (!date) { report.badDates++; continue; }
    const market = String(pick(row, '市場名稱') ?? '').trim();
    if (!market || /總計|合計|全國/.test(market)) continue;
    const loc = lookupMarket(market); if (!loc) report.unmappedMarkets.add(market);
    for (const [field, spec] of HOG_SPECS) {
      const v = pick(row, field);
      report.specFields[spec] = v !== undefined;
      const price = parsePrice(v); if (price == null) continue;
      records.push(rec({ source: 'moa_hog', priceType: 'hog_auction', itemId: 'livehog', rawItemName: field, spec,
        market, county: loc?.county ?? null, region: loc?.region ?? null, date, price, rawUnit: '元/公斤' }));
    }
  }
  report.unmappedMarkets = [...report.unmappedMarkets];
  return { records, report };
}

// ---------- 5. 家禽交易行情（白肉雞，7536）全國／高屏行情 ----------
// 原始單位以 sources.json 設定，未經原始檔核對前標為待確認。
export function parsePoultry(rows, { rawUnit = '元/台斤' } = {}) {
  const report = { badDates: 0, fields: {} };
  const defs = [
    ['白肉雞(2.0Kg以上)', '2.0 公斤以上', 'national', '全國產地'],
    ['白肉雞(1.75-1.95Kg)', '1.75–1.95 公斤', 'national', '全國產地'],
    ['白肉雞(門市價高屏)', '高屏門市價', 'area:高屏', '高屏地區'],
  ];
  const records = [];
  for (const row of rows) {
    const date = normDate(pick(row, '日期', '交易日期')); if (!date) { report.badDates++; continue; }
    for (const [field, spec, scope, market] of defs) {
      const v = pickPrefix(row, field); report.fields[field] = v !== undefined;
      const price = parsePrice(v); if (price == null) continue;
      records.push(rec({ source: 'moa_poultry', priceType: 'poultry', itemId: 'broiler', rawItemName: field, spec,
        market, county: null, region: scope === 'area:高屏' ? 'south' : null, scope, date, price, rawUnit }));
    }
  }
  return { records, report };
}

export const PARSERS = {
  taichung_retail: parseTaichungRetail, moa_veg: parseVegWholesale, moa_fish: parseFishWholesale,
  moa_hog: parseHog, moa_poultry: parsePoultry,
};
