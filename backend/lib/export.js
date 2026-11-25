// 輸出 App 用資料。正式與測試各一檔；正式只收 sources.json 標記 verified 的來源。
import { aggregate, lastNDays } from './price.js';
import { ITEMS, PRICE_TYPES, CATEGORIES } from './catalog.js';
import { REGIONS } from './markets.js';

export function buildAppData({ store, sources, today, dataset, generatedAt = new Date().toISOString() }) {
  const window = new Set(lastNDays(today, 14));
  const verifiedIds = new Set(sources.filter(s => dataset === 'test' || s.verified).map(s => s.id));
  // 正式資料：來源已驗證，且品項在該來源的 verifiedItems（單位等已逐項核對）內
  const itemOk = new Map(sources.map(s => [s.id, s.verifiedItems ? new Set(s.verifiedItems) : null]));
  const recs = store.all().filter(r => verifiedIds.has(r.source) && window.has(r.date) && r.date <= today && !r.excluded
    && (dataset === 'test' || !itemOk.get(r.source) || itemOk.get(r.source).has(r.itemId)));
  const aggs = aggregate(recs).map(a => ({
    d: a.date, a: a.area, i: a.itemId, s: a.spec, t: a.priceType,
    med: a.medianPerKg, min: a.minPerKg, max: a.maxPerKg, n: a.marketCount, u: a.rawUnits, fl: a.flaggedMarkets.length ? a.flaggedMarkets : undefined,
  }));
  const quotes = recs.filter(r => r.perKg != null && (r.scope !== 'market' || r.region)).map(r => ({
    d: r.date, a: r.scope === 'market' ? r.region : r.scope, i: r.itemId, s: r.spec, t: r.priceType,
    m: r.market, c: r.county, k: r.perKg, p: r.price, u: r.rawUnit, src: r.source, f: r.flag ? 1 : undefined,
  }));
  return {
    dataset, isTest: dataset === 'test', generatedAt, today,
    regions: REGIONS, priceTypes: PRICE_TYPES, categories: CATEGORIES,
    items: ITEMS.map(({ id, name, cat, img, alias }) => ({ id, name, cat, img: img ?? null, alias })),
    sources: sources.map(s => {
      const st = store.status[s.id] || {};
      const enabled = verifiedIds.has(s.id);
      const has = recs.some(r => r.source === s.id);
      return { id: s.id, name: s.name, priceType: s.priceType, page: s.datasetPage,
        state: dataset === 'test' ? (has ? '測試資料' : '暫無資料') : !enabled ? '待確認' : has ? '已接通' : '暫無資料',
        latestDate: enabled ? (recs.filter(r => r.source === s.id).reduce((m, r) => (r.date > m ? r.date : m), '') || null) : null,
        manual: st.manual ? { at: st.manual.lastSuccessAt ?? null, error: st.manual.lastError ?? null } : null,
        scheduled: st.scheduled ? { at: st.scheduled.lastSuccessAt ?? null, error: st.scheduled.lastError ?? null, tried: st.scheduled.lastAttemptAt ?? null, newData: st.scheduled.newData ?? null, lastNewDataAt: st.scheduled.lastNewDataAt ?? null, trigger: st.scheduled.trigger ?? null } : null,
        pendingItems: dataset === 'test' ? [] : (s.pendingUnitItems || []) };
    }),
    aggs, quotes,
  };
}
