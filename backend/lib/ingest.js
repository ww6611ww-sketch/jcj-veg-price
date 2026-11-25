import { PARSERS, toRows } from './parsers.js';
import { ITEMS, itemById } from './catalog.js';
import { median } from './price.js';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCES_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sources.json');
export function sourceConfig(id) {
  try { return JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8')).sources.find(s => s.id === id) || {}; } catch { return {}; }
}

/**
 * 1) 明確排除：比對 來源＋原始品名＋市場＋原始值，全部相同才排除；市場改報新值即不再排除，重新判斷。
 *    原始紀錄保留，記下 excluded（排除原因）。
 */
export function applyExclusions(records, exclusions = []) {
  let n = 0;
  for (const r of records) {
    const x = exclusions.find(e => e.market === r.market && e.rawItemName === r.rawItemName && Number(e.price) === r.price);
    r.excluded = x ? x.reason : null;
    if (x) n++;
  }
  return n;
}

/**
 * 2) 高價標記（只標記，不排除）：同來源、同日、同地區、同品項與規格、同價格類型、同原始單位，
 *    每市場取一筆有效價（同市場多筆取中位數）；至少 3 個市場時，高於中位數 3 倍者標「待確認」。
 *    已排除的紀錄不參與計算。
 */
export function flagHighPrices(records) {
  const g = new Map();
  for (const r of records) {
    r.flag = null;
    if (r.excluded) continue;
    const area = r.scope === 'market' ? r.region : r.scope;
    const k = [r.source, r.date, area, r.itemId, r.spec, r.priceType, r.rawUnit].join('|');
    if (!g.has(k)) g.set(k, new Map());
    const byM = g.get(k);
    if (!byM.has(r.market)) byM.set(r.market, []);
    byM.get(r.market).push(r);
  }
  const flagged = [];
  for (const byM of g.values()) {
    if (byM.size < 3) continue;
    const perMarket = [...byM.values()].map(rs => median(rs.map(r => r.price)));
    const m = median(perMarket);
    for (const rs of byM.values()) {
      const v = median(rs.map(r => r.price));
      if (v > 3 * m) for (const r of rs) { r.flag = `待確認：高於當日中位數 ${m} 的 3 倍`; flagged.push(r); }
    }
  }
  return flagged;
}

/**
 * 同一份原始檔內同鍵（來源＋日期＋市場＋原始品名＋價格類型）重複的列：合併成一筆。
 * 有交易量時按交易量加權平均，否則取平均；報告記錄合併筆數與範例。
 */
export function mergeDuplicates(records, report) {
  const g = new Map();
  for (const r of records) { const k = [r.source, r.date, r.market, r.rawItemName, r.priceType].join('|'); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
  const out = []; const examples = []; let merged = 0;
  for (const rs of g.values()) {
    if (rs.length === 1) { out.push(rs[0]); continue; }
    merged += rs.length - 1;
    const prices = rs.map(r => r.price), vols = rs.map(r => r.volume || 0), vsum = vols.reduce((a, b) => a + b, 0);
    const price = vsum > 0 ? rs.reduce((a, r) => a + r.price * (r.volume || 0), 0) / vsum : prices.reduce((a, b) => a + b, 0) / prices.length;
    const p = Math.round(price * 100) / 100;
    const allSame = prices.every(x => x === prices[0]);
    if (examples.length < 5 && !allSame) examples.push({ date: rs[0].date, market: rs[0].market, item: rs[0].rawItemName, prices, volumes: vols, merged: p });
    out.push({ ...rs[0], price: allSame ? prices[0] : p, perKg: rs[0].perKg == null ? null : (allSame ? rs[0].perKg : rs[0].perKg / rs[0].price * p), volume: vsum || rs[0].volume, mergedFrom: rs.length });
  }
  report.duplicates = { merged, examples };
  return out;
}

export function parseSource(source, text, opts = {}) {
  const parser = PARSERS[source];
  if (!parser) throw new Error(`未知來源 ${source}`);
  const rows = toRows(text);
  const parsed = parser(rows, opts);
  const report = parsed.report;
  const records = mergeDuplicates(parsed.records, report);
  const cfg = opts.config ?? sourceConfig(source);
  report.excludedCount = applyExclusions(records, cfg.exclusions);
  report.excluded = summarizeGroups(records.filter(r => r.excluded), 'excluded');
  report.flagged = summarizeGroups(flagHighPrices(records), 'flag');
  return { rows, records, report };
}

/**
 * 匯入一份原始檔：存原始檔 → 解析 → 冪等寫入。解析失敗或沒有可用報價時不動既有資料。
 * minDate：只寫入此日期（含）之後的紀錄（保留期限）。
 */
export function ingest(store, source, text, { ext = 'json', fetchedAt = new Date().toISOString(), opts, via = 'manual', minDate = null, extra = {} } = {}) {
  const setSt = patch => store.setStatus(source, { [via]: { ...(store.status[source]?.[via] || {}), ...patch } });
  const rawFile = store.saveRaw(source, text, ext, fetchedAt);
  const latestBefore = store.latestDate(source);
  let parsed;
  try { parsed = parseSource(source, text, opts); }
  catch (e) {
    setSt({ ...extra, lastAttemptAt: fetchedAt, lastError: `解析失敗：${e.message}`, lastRawFile: rawFile });
    throw e;
  }
  const { report, rows } = parsed;
  const all = parsed.records;
  const records = minDate ? all.filter(r => r.date >= minDate) : all;
  const base = { rows: rows.length, parsed: all.length, inWindow: records.length, rawFile, report, latestBefore,
    latestInFile: all.reduce((m, r) => (!r.excluded && r.date > m ? r.date : m), '') || null };
  if (records.length === 0) {
    setSt({ ...extra, lastAttemptAt: fetchedAt, lastError: '原始檔沒有可用報價（保留先前資料）', lastRawFile: rawFile });
    return { ...base, records: 0, inserted: 0, changed: 0, unchanged: 0, updated: 0, newData: false, latestAfter: latestBefore };
  }
  const res = store.upsert(records, { fetchedAt, rawFile, via });
  const latestAfter = store.latestDate(source);
  const newData = res.inserted > 0 || res.changed > 0;
  setSt({ ...extra, lastAttemptAt: fetchedAt, lastSuccessAt: fetchedAt, lastError: null, latestDate: latestAfter, lastRawFile: rawFile,
    lastCounts: { rows: rows.length, parsed: all.length, inWindow: records.length, ...res }, newData,
    lastNewDataAt: newData ? fetchedAt : (store.status[source]?.[via]?.lastNewDataAt ?? null) });
  return { ...base, records: records.length, ...res, newData, latestAfter };
}

/** 給人看的驗證報告：最新日期、市場數、各品項最近一次有效報價。 */
export function summarize(allRecords, focusIds = []) {
  const records = allRecords.filter(r => !r.excluded);
  const dates = [...new Set(records.map(r => r.date))].sort();
  const latest = dates.at(-1) ?? null;
  const marketsAll = [...new Set(records.map(r => r.market))];
  const marketsLatest = [...new Set(records.filter(r => r.date === latest).map(r => r.market))];
  const perItem = {};
  for (const it of ITEMS) {
    const rs = records.filter(r => r.itemId === it.id);
    if (!rs.length) continue;
    const d = rs.reduce((m, r) => (r.date > m ? r.date : m), '');
    const day = rs.filter(r => r.date === d);
    perItem[it.id] = {
      name: it.name, latestValidDate: d, rawUnits: [...new Set(day.map(r => r.rawUnit))],
      marketCountThatDay: new Set(day.map(r => r.market)).size,
      medianRaw: median(day.map(r => r.price)), minRaw: Math.min(...day.map(r => r.price)), maxRaw: Math.max(...day.map(r => r.price)),
      specs: [...new Set(day.map(r => r.spec).filter(Boolean))],
      daysWithData: new Set(rs.map(r => r.date)).size,
    };
  }
  const missingItems = ITEMS.filter(i => !perItem[i.id]).map(i => i.name);
  return { dates: { first: dates[0] ?? null, latest, count: dates.length }, marketsAll, marketsLatest, perItem,
    focus: Object.fromEntries(focusIds.map(id => [itemById[id].name, perItem[id] ?? '原始檔內無有效報價'])), missingItems };
}

export function summarizeGroups(list, key) {
  const m = new Map();
  for (const r of list) {
    const k = `${r.market}｜${r.rawItemName}`;
    const e = m.get(k) || { market: r.market, item: r.rawItemName, days: 0, values: new Set(), first: r.date, last: r.date, reason: r[key] };
    e.days++; e.values.add(r.price); if (r.date < e.first) e.first = r.date; if (r.date > e.last) e.last = r.date; m.set(k, e);
  }
  return [...m.values()].map(e => ({ ...e, values: [...e.values].slice(0, 5) })).sort((a, b) => b.days - a.days);
}
