import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toPerKg, fromPerKg, parsePrice, median, aggregate, normDate, lastNDays, taipeiDate } from '../lib/price.js';
import { lookupMarket } from '../lib/markets.js';
import { parseSource } from '../lib/ingest.js';
import { ingest, summarize } from '../lib/ingest.js';
import { Store } from '../lib/store.js';
import { buildAppData } from '../lib/export.js';

const FX = path.join(import.meta.dirname, '..', 'fixtures', 'test-data');
const read = f => fs.readFileSync(path.join(FX, f), 'utf8');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jcj-'));

test('單位換算：1 台斤 = 0.6 公斤，保留精度', () => {
  assert.equal(toPerKg(35, '元/斤'), 35 / 0.6);
  assert.equal(fromPerKg(toPerKg(35, '元/台斤'), 'jin'), 35);
  assert.equal(toPerKg(100, '元/公斤'), 100);
  assert.equal(toPerKg(10, '元/顆'), null); // 非重量單位不換算
  assert.ok(Math.abs(toPerKg(33, '元/斤') - 55) < 1e-9);
});

test('0、空值、橫線視為無報價', () => {
  for (const v of [0, '0', '', null, undefined, '-', 'NA', -3]) assert.equal(parsePrice(v), null);
  assert.equal(parsePrice('1,234.5'), 1234.5);
});

test('中位數：奇數、偶數', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test('日期：民國與西元格式、台灣日曆日', () => {
  assert.equal(normDate('115.11.25'), '2026-11-25');
  assert.equal(normDate('1151125'), '2026-11-25');
  assert.equal(normDate('2026/11/5'), '2026-11-05');
  assert.equal(normDate('垃圾'), null);
  assert.deepEqual(lastNDays('2026-03-02', 3), ['2026-02-28', '2026-03-01', '2026-03-02']);
  assert.equal(taipeiDate(new Date('2026-11-24T16:30:00Z')), '2026-11-25'); // UTC 16:30 = 台北隔日 00:30
});

test('市場分區：可辨識才分區，未知回傳 null', () => {
  assert.equal(lookupMarket('台北二').region, 'north');
  assert.equal(lookupMarket('宜蘭市').region, 'north');
  assert.equal(lookupMarket('西螺鎮').region, 'central');
  assert.equal(lookupMarket('台東市').region, 'east');
  assert.equal(lookupMarket('測試未對照市場'), null);
  assert.equal(lookupMarket('任何名稱', { source: 'taichung_retail' }).region, 'central');
});

test('聚合：中位數、範圍、市場數、單一市場；同市場重複列不重複計數', () => {
  const base = { date: '2026-11-25', scope: 'market', region: 'central', itemId: 'cabbage', spec: '', priceType: 'retail', rawUnit: '元/斤' };
  const rs = [30, 36, 33, 33].map((p, i) => ({ ...base, market: i < 3 ? `M${i}` : 'M2', price: p, perKg: toPerKg(p, '元/斤') }));
  const [a] = aggregate(rs);
  assert.equal(a.marketCount, 3);
  assert.equal(fromPerKg(a.medianPerKg, 'jin'), 33);
  assert.equal(fromPerKg(a.minPerKg, 'jin'), 30);
  const [s] = aggregate([rs[0]]);
  assert.equal(s.single, true);
});

test('台中零售解析：寬表、0＝缺價、缺欄位回報', () => {
  const { records, report } = parseSource('taichung_retail', read('TEST_taichung_retail.csv'));
  assert.ok(report.itemColumns.cabbage.found);
  assert.ok(report.itemColumns.nativechicken.missing); // 測試檔刻意不含土雞欄
  assert.equal(records.filter(r => r.itemId === 'beefshank').length, 0); // 全 0
  assert.equal(records.filter(r => r.itemId === 'onion' && r.date === '2026-11-25').length, 0);
  assert.ok(records.every(r => r.price > 0 && r.rawUnit === '元/斤' && r.region === 'central'));
  const s = summarize(records, ['cauliflower', 'onion', 'whiteshrimp', 'porkbelly']);
  assert.equal(s.dates.latest, '2026-11-25');
  assert.equal(s.marketsLatest.length, 8);
  assert.equal(s.focus['洋蔥'].latestValidDate, '2026-11-24');
  assert.equal(new Set(records.filter(r => r.itemId === 'threadfin').map(r => r.market)).size, 1);
});

test('批發／漁產／毛豬／白肉雞解析', () => {
  const v = parseSource('moa_veg', read('TEST_moa_veg.json'));
  assert.ok(v.report.unmappedMarkets.includes('測試未對照市場'));
  assert.ok(v.report.skippedRest > 0);
  assert.ok(v.records.some(r => r.itemId === 'cabbage' && r.spec === '初秋'));
  assert.ok(v.records.every(r => r.rawUnit === '元/公斤'));
  const f = parseSource('moa_fish', read('TEST_moa_fish.json'));
  const specs = new Set(f.records.filter(r => r.itemId === 'whiteshrimp').map(r => r.spec));
  assert.deepEqual([...specs].sort(), ['', '白蝦(大)']);
  const h = parseSource('moa_hog', read('TEST_moa_hog.json'));
  assert.ok(h.records.every(r => r.itemId === 'livehog' && r.priceType === 'hog_auction'));
  assert.equal(h.records.filter(r => r.market === '台東縣' && r.spec === '75–95 公斤').length, 0);
  const p = parseSource('moa_poultry', read('TEST_moa_poultry.json'));
  assert.ok(p.records.some(r => r.scope === 'national'));
  assert.equal(p.records.filter(r => r.scope === 'area:高屏').length, 6); // 一天是 '-'
});

test('冪等：同一檔重跑只更新；解析失敗保留最後有效資料；測試與正式隔離', () => {
  const root = tmp();
  const st = new Store(root, 'test');
  const t = read('TEST_taichung_retail.csv');
  const r1 = ingest(st, 'taichung_retail', t, { ext: 'csv' });
  const r2 = ingest(st, 'taichung_retail', t, { ext: 'csv' });
  assert.equal(r2.inserted, 0);
  assert.equal(r2.updated, r1.inserted);
  const before = st.all().length;
  assert.throws(() => ingest(st, 'taichung_retail', '{"oops": 1}', { ext: 'json' }));
  assert.equal(new Store(root, 'test').all().length, before);
  assert.match(st.status.taichung_retail.manual.lastError, /解析失敗/);
  assert.equal(new Store(root, 'official').all().length, 0);
  assert.ok(fs.readdirSync(path.join(root, 'test', 'raw', 'taichung_retail')).length > 0);
});

test('匯出：正式只收已驗證來源；未驗證顯示待確認', () => {
  const root = tmp();
  const st = new Store(root, 'official');
  ingest(st, 'taichung_retail', read('TEST_taichung_retail.csv'), { ext: 'csv' });
  const sources = [{ id: 'taichung_retail', name: 'x', verified: false }, { id: 'moa_veg', name: 'y', verified: true }];
  const d = buildAppData({ store: st, sources, today: '2026-11-25', dataset: 'official' });
  assert.equal(d.aggs.length, 0);
  assert.equal(d.sources[0].state, '待確認');
  assert.equal(d.sources[1].state, '暫無資料');
  const d2 = buildAppData({ store: st, sources: [{ ...sources[0], verified: true }], today: '2026-11-25', dataset: 'official' });
  assert.ok(d2.aggs.length > 0);
  assert.equal(d2.isTest, false);
});

test('匯出：正式只輸出 verifiedItems；待確認單位品項不顯示', () => {
  const root = tmp(); const st = new Store(root, 'official');
  ingest(st, 'taichung_retail', read('TEST_taichung_retail.csv'), { ext: 'csv' });
  const src = [{ id: 'taichung_retail', name: 'x', verified: true, verifiedItems: ['cabbage'], pendingUnitItems: ['whiteshrimp'] }];
  const d = buildAppData({ store: st, sources: src, today: '2026-11-25', dataset: 'official' });
  assert.deepEqual([...new Set(d.aggs.map(a => a.i))], ['cabbage']);
  assert.deepEqual(d.sources[0].pendingItems, ['whiteshrimp']);
});

test('明確排除：來源＋品名＋市場＋原始值完全相同才排除；改報新值即重新判斷', () => {
  const cfg = { exclusions: [{ market: '南屯市場', rawItemName: '白蝦', price: 7600, reason: '重複異常值' }] };
  const mk = v => JSON.stringify([['南屯市場', v], ['清水第一市場', 224], ['中義市場', 384], ['合作市場', 272]].map(([m, p]) => ({ 市場名稱: m, 訪價日期: '20261124', 白蝦: String(p) })));
  const a = parseSource('taichung_retail', mk(7600), { config: cfg });
  const x = a.records.find(r => r.market === '南屯市場');
  assert.equal(x.excluded, '重複異常值'); assert.equal(x.price, 7600); // 原始紀錄保留
  assert.equal(a.report.excludedCount, 1);
  const [g] = aggregate(a.records);
  assert.equal(g.marketCount, 3);
  const b = parseSource('taichung_retail', mk(300), { config: cfg });  // 改報新值
  assert.equal(b.records.find(r => r.market === '南屯市場').excluded, null);
  assert.equal(aggregate(b.records)[0].marketCount, 4);
  const c = parseSource('taichung_retail', mk(7600), { config: { exclusions: [{ ...cfg.exclusions[0], market: '第五市場' }] } }); // 市場不同不排除
  assert.equal(c.records.find(r => r.market === '南屯市場').excluded, null);
});

test('高價只標記：>3 倍中位數標「待確認」但仍計入中位數與範圍', () => {
  const rows = [['A', 100], ['B', 110], ['C', 120], ['D', 400]].map(([m, p]) => ({ 市場名稱: m, 訪價日期: '20261124', 青蔥: String(p) }));
  const { records, report } = parseSource('taichung_retail', JSON.stringify(rows), { config: {} });
  const d = records.find(r => r.market === 'D');
  assert.match(d.flag, /^待確認/); assert.equal(d.excluded, null);
  assert.equal(report.flagged[0].market, 'D');
  const [g] = aggregate(records);
  assert.equal(g.marketCount, 4); assert.equal(Math.round(g.maxPerKg * 0.6), 400); assert.deepEqual(g.flaggedMarkets, ['D']);
  // 3 倍整數邊界不標；不足 3 市場不判定
  const r2 = parseSource('taichung_retail', JSON.stringify([['A', 100], ['B', 100], ['C', 300]].map(([m, p]) => ({ 市場名稱: m, 訪價日期: '20261124', 青蔥: String(p) }))), { config: {} });
  assert.equal(r2.records.filter(r => r.flag).length, 0);
  const r3 = parseSource('taichung_retail', JSON.stringify([['A', 100], ['B', 900]].map(([m, p]) => ({ 市場名稱: m, 訪價日期: '20261124', 青蔥: String(p) }))), { config: {} });
  assert.equal(r3.records.filter(r => r.flag).length, 0);
});

test('高價標記分組：每市場一筆、不同單位不混比', async () => {
  const { flagHighPrices } = await import('../lib/ingest.js');
  const base = { source: 's', date: '2026-11-24', itemId: 'x', spec: '', priceType: 'retail', scope: 'market', region: 'central', rawUnit: '元/斤' };
  // A 市場重複 3 列高價只算一筆：A,B,C 三市場 → 中位數 110，A=500 被標
  const rs = [['A', 500], ['A', 500], ['A', 500], ['B', 100], ['C', 110]].map(([m, p]) => ({ ...base, market: m, price: p }));
  flagHighPrices(rs);
  assert.equal(rs.filter(r => r.flag).length, 3);
  const kg = [['A', 500, '元/公斤'], ['B', 100, '元/斤'], ['C', 110, '元/斤']].map(([m, p, u]) => ({ ...base, market: m, price: p, rawUnit: u }));
  flagHighPrices(kg);
  assert.equal(kg.filter(r => r.flag).length, 0); // 每組都不足 3 市場
});

const REAL = process.env.JCJ_REAL_TAICHUNG || ''; // 選用：官方 84539 原始檔路徑（不納入 repo）
test('實檔：白蝦 11/24 排除南屯 7600 後為 5 市場、200–384、中位數 272', { skip: !REAL || !fs.existsSync(REAL) }, () => {
  const { records, report } = parseSource('taichung_retail', fs.readFileSync(REAL, 'utf8'));
  const day = records.filter(r => r.itemId === 'whiteshrimp' && r.date === '2026-11-24');
  assert.equal(day.length, 6);
  assert.equal(day.find(r => r.market === '南屯市場').excluded !== null, true);
  const [g] = aggregate(day);
  assert.equal(g.marketCount, 5);
  assert.equal(Math.round(g.minPerKg * 0.6), 200); assert.equal(Math.round(g.maxPerKg * 0.6), 384); assert.equal(Math.round(g.medianPerKg * 0.6), 272);
  assert.deepEqual(report.excluded.map(e => `${e.market}/${e.item}/${e.values[0]}`).sort(), ['南屯市場/文蛤/2160', '南屯市場/白蝦/7600', '第五市場/虱目魚/1480']);
});

test('白肉雞：欄名帶單位後綴也能對上', () => {
  const rows = [{ '日期': '2026/11/24', '農曆': 'x', '白肉雞(2.0Kg以上)(元/台斤)': '33.5', '白肉雞(1.75-1.95Kg)(元/台斤)': '35', '白肉雞(門市價高屏)(元/台斤)': '46' }];
  const { records } = parseSource('moa_poultry', JSON.stringify(rows), { config: {} });
  assert.equal(records.length, 3);
  assert.ok(records.every(r => r.rawUnit === '元/台斤'));
  assert.equal(records.find(r => r.scope === 'area:高屏').price, 46);
});

test('同一份資料重跑：紀錄檔內容不變（不重寫抓取時間）', () => {
  const root = tmp(); const st = new Store(root, 'official');
  const text = read('TEST_taichung_retail.csv');
  ingest(st, 'taichung_retail', text, { ext: 'csv', fetchedAt: '2026-11-25T00:00:00Z' });
  const before = fs.readFileSync(st.file, 'utf8');
  const r = ingest(st, 'taichung_retail', text, { ext: 'csv', fetchedAt: '2026-11-25T06:00:00Z', via: 'scheduled' });
  assert.equal(r.inserted + r.changed, 0); assert.equal(r.newData, false);
  assert.equal(fs.readFileSync(st.file, 'utf8'), before);
  assert.equal(st.status.taichung_retail.scheduled.lastSuccessAt, '2026-11-25T06:00:00Z');
});
