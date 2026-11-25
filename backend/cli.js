#!/usr/bin/env node
// 用法：
//   node cli.js inspect --source taichung_retail --file 下載檔.csv        只解析、印出驗證報告，不寫入
//   node cli.js import  --source taichung_retail --file 下載檔.csv [--dataset official|test]
//   node cli.js fetch   [--date 2026-11-25] [--days 7]                      依台灣時間抓取所有有下載網址的來源
//   node cli.js export  [--today 2026-11-25] [--datasets official]          輸出 App 資料（official.json、test.json）
//   node cli.js fetch   --only taichung_retail                              只抓指定來源
//   node cli.js prune                                                       只保留近 JCJ_KEEP_DAYS（預設 60）天
//   node cli.js sample  --source taichung_retail --market 清水第一市場 --item cauliflower [--url 部署網址/data/official.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.js';
import { ingest, parseSource, summarize } from './lib/ingest.js';
import { buildAppData } from './lib/export.js';
import { taipeiDate, lastNDays } from './lib/price.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(3).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const cmd = process.argv[2];
const DATA = process.env.JCJ_DATA_DIR || path.join(here, 'data');
const APP_OUT = process.env.JCJ_APP_OUT || path.join(here, '..', 'app', 'www', 'data');
const { sources } = JSON.parse(fs.readFileSync(path.join(here, 'sources.json'), 'utf8'));
const FOCUS = ['cauliflower', 'onion', 'whiteshrimp', 'porkbelly'];
const KEEP_DAYS = Number(process.env.JCJ_KEEP_DAYS || 60);

function runSummary(rep) {
  const rows = rep.sources.map(r => `| ${r.name} | ${r.http ?? '—'} | ${r.parsed ?? '—'} | ${r.inWindow ?? '—'} | ${r.inserted ?? '—'} | ${r.changed ?? '—'} | ${r.unchanged ?? '—'} | ${r.latestBefore ?? '—'} → ${r.latestAfter ?? '—'} | ${r.verdict || r.error} |`).join('\n');
  return `## 抓取結果（${rep.trigger}，台灣日期 ${rep.taipeiDate}）\n\n| 來源 | HTTP | 解析筆數 | 保留期內 | 新增 | 更正 | 未變 | 最新訪價日 | 判定 |\n|---|---|---|---|---|---|---|---|---|\n${rows}\n\n保留 ${rep.keepFrom} 之後的紀錄；本次清除 ${rep.pruned} 筆過期紀錄。\n`;
}

const rocDate = d => { const [y, m, dd] = d.split('-'); return `${+y - 1911}.${m}.${dd}`; };

async function main() {
  if (cmd === 'inspect' || cmd === 'import') {
    const text = fs.readFileSync(args.file, 'utf8');
    if (cmd === 'inspect') {
      const { rows, records, report } = parseSource(args.source, text);
      console.log(JSON.stringify({ file: args.file, rows: rows.length, validRecords: records.length, report,
        summary: summarize(records, args.source === 'taichung_retail' ? FOCUS : []) }, null, 2));
      return;
    }
    const store = new Store(DATA, args.dataset || 'official');
    const res = ingest(store, args.source, text, { ext: path.extname(args.file).slice(1) || 'txt' });
    console.log(JSON.stringify({ ...res, report: undefined, summary: summarize(store.all().filter(r => r.source === args.source), FOCUS) }, null, 2));
    return;
  }
  if (cmd === 'fetch') {
    // 依台灣時間抓取。--only 指定來源；JCJ_TRIGGER 記錄觸發方式（schedule／workflow_dispatch／local）。
    const end = args.date || taipeiDate();
    const days = lastNDays(end, Number(args.days || 7));
    const minDate = lastNDays(end, KEEP_DAYS)[0];
    const only = args.only ? args.only.split(',') : null;
    const trigger = process.env.JCJ_TRIGGER || 'local';
    const store = new Store(DATA, 'official');
    const report = { runAt: new Date().toISOString(), trigger, taipeiDate: end, keepFrom: minDate, sources: [] };
    for (const s of sources.filter(s => !only || only.includes(s.id))) {
      const fetchedAt = new Date().toISOString();
      const r = { id: s.id, name: s.name, url: null, http: null, bytes: null, ok: false };
      const fail = msg => { r.error = msg; store.setStatus(s.id, { scheduled: { ...(store.status[s.id]?.scheduled || {}), lastAttemptAt: fetchedAt, lastError: msg, httpStatus: r.http, trigger } }); };
      if (!s.downloadUrl && !process.env['JCJ_URL_' + s.id]) { fail('尚未設定下載網址'); report.sources.push(r); continue; }
      r.url = (process.env['JCJ_URL_' + s.id] || s.downloadUrl).replace('{rocStart}', rocDate(days[0])).replace('{rocEnd}', rocDate(days.at(-1)));
      let text;
      try {
        const one = async u => {
          const res = await fetch(u, { signal: AbortSignal.timeout(90000), headers: { 'User-Agent': 'jcj-veg-price/0.1 (+opendata)' } });
          r.http = res.status; r.contentType = res.headers.get('content-type');
          const t = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}：${t.slice(0, 200).replace(/\s+/g, ' ')}`);
          return t;
        };
        if (s.paging) {
          // 官方每次最多回 pageSize 列（新到舊），以 $skip 翻頁直到不足一頁
          const all = []; r.pages = [];
          for (let p = 0; p < (s.paging.maxPages || 10); p++) {
            const u = `${r.url}${r.url.includes('?') ? '&' : '?'}$top=${s.paging.pageSize}&$skip=${p * s.paging.pageSize}`;
            const arr = JSON.parse((await one(u)).replace(/^\uFEFF/, ''));
            if (!Array.isArray(arr)) throw new Error('分頁回傳不是陣列');
            all.push(...arr); r.pages.push(arr.length);
            if (arr.length < s.paging.pageSize) break;
          }
          text = JSON.stringify(all);
        } else text = await one(r.url);
        r.bytes = Buffer.byteLength(text);
      } catch (e) {
        // 抓取失敗：records.json 不動 → 保留最後一次有效資料
        fail(`抓取失敗：${e.message}${e.cause ? `（${[e.cause.code, e.cause.message].filter(Boolean).join(' ')}）` : ''}`);
        report.sources.push(r); continue;
      }
      try {
        const x = ingest(store, s.id, text, { ext: s.format?.startsWith('CSV') ? 'csv' : 'json', fetchedAt, via: 'scheduled', minDate,
          extra: { httpStatus: r.http, bytes: r.bytes, trigger } });
        Object.assign(r, { ok: x.records > 0, rows: x.rows, parsed: x.parsed, inWindow: x.inWindow, inserted: x.inserted, changed: x.changed,
          unchanged: x.unchanged, latestBefore: x.latestBefore, latestInFile: x.latestInFile, latestAfter: x.latestAfter, newData: x.newData,
          excluded: x.report.excludedCount ?? 0, flaggedGroups: x.report.flagged?.length ?? 0, rawFile: x.rawFile,
          duplicatesMerged: x.report.duplicates?.merged ?? 0, duplicateExamples: x.report.duplicates?.examples ?? [], unmappedMarkets: x.report.unmappedMarkets ?? [] });
        r.verdict = !x.records ? '抓取成功，但原始檔沒有可用報價（保留先前資料）'
          : x.newData ? (x.latestAfter > (x.latestBefore || '') ? `有新訪價：最新日 ${x.latestBefore} → ${x.latestAfter}` : '有新增或更正的報價（最新日未變）')
          : '抓取成功，來源沒有新資料';
      } catch (e) { r.error = `解析失敗：${e.message}`; }
      report.sources.push(r);
    }
    const pruned = store.prune(minDate);
    report.pruned = pruned;
    fs.writeFileSync(path.join(DATA, 'official', 'last-run.json'), JSON.stringify(report, null, 2));
    for (const r of report.sources) console.log(r.id, r.ok ? 'OK' : 'FAIL', r.http ?? '-', r.verdict || r.error);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, runSummary(report));
    return;
  }
  if (cmd === 'purge') {
    // 一次性遷移：node cli.js purge --source moa_fish --legacy-fish
    const store = new Store(DATA, 'official');
    const n = store.purge(r => r.source === args.source && (!('legacy-fish' in args) || !String(r.rawItemName).includes('#')));
    console.log('purged', n);
    return;
  }
  if (cmd === 'prune') {
    const store = new Store(DATA, 'official');
    const minDate = lastNDays(args.today || taipeiDate(), KEEP_DAYS)[0];
    console.log('removed', store.prune(minDate), 'kept from', minDate, 'records', store.all().length);
    return;
  }
  if (cmd === 'sample') {
    // 原始報價 ↔ App 資料（↔ 已部署網頁）對照：node cli.js sample --source taichung_retail --market 清水第一市場 --item cauliflower [--url https://.../data/official.json]
    const store = new Store(DATA, 'official');
    const rec = store.all().filter(r => r.source === args.source && r.market === args.market && r.itemId === args.item && !r.excluded)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!rec) { console.log('找不到對應原始報價'); return; }
    // 原始檔：先找該筆紀錄首次取得的檔案；不在本機時（例如 CI），改用本次抓取的原始檔，並確認同市場同日同品項的值一致
    const st = store.status[args.source] || {};
    let rawText = null, rawUsed = null;
    for (const f of [rec.rawFile, st.scheduled?.lastRawFile, st.manual?.lastRawFile].filter(Boolean)) {
      try { rawText = fs.readFileSync(path.join(DATA, 'official', f), 'utf8'); rawUsed = f; break; } catch {}
    }
    const rawRow = rawText && JSON.parse(rawText.replace(/^\uFEFF/, '')).find?.(x => x['市場名稱'] === rec.market && String(x['訪價日期']).replace(/\D/g, '') === rec.date.replace(/-/g, ''));
    const local = JSON.parse(fs.readFileSync(path.join(APP_OUT, 'official.json'), 'utf8'));
    const pick = d => d.quotes.find(q => q.m === rec.market && q.i === rec.itemId && q.d === rec.date);
    const out = { rawFile: rawUsed, rawNote: rawText ? undefined : `原始檔 ${rec.rawFile} 不在本機（存於該次執行的 artifact）`, raw: rawRow ? { 市場名稱: rawRow['市場名稱'], 訪價日期: rawRow['訪價日期'], [rec.rawItemName]: rawRow[rec.rawItemName] ?? rawRow[Object.keys(rawRow).find(k => k.replace(/（/g, '(').replace(/）/g, ')') === rec.rawItemName)] } : null,
      stored: { date: rec.date, price: rec.price, rawUnit: rec.rawUnit, fetchedAt: rec.fetchedAt, via: rec.via, rawFile: rec.rawFile },
      appData: (q => q && { 元每台斤: +(q.k * 0.6).toFixed(2), 元每公斤: +q.k.toFixed(2), 資料日: q.d })(pick(local)) };
    if (args.url) { const web = await (await fetch(args.url, { cache: 'no-store' })).json(); out.deployed = (q => q && { 元每台斤: +(q.k * 0.6).toFixed(2), 資料日: q.d, generatedAt: web.generatedAt })(pick(web)); }
    console.log(JSON.stringify(out, null, 2));
    if (args.out) fs.writeFileSync(args.out, JSON.stringify({ market: rec.market, item: rec.itemId, date: rec.date, ...out }, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### 原始報價 ↔ 網頁對照\n\n\`\`\`json\n${JSON.stringify(out, null, 2)}\n\`\`\`\n`);
    return;
  }
  if (cmd === 'export') {
    const today = args.today || taipeiDate();
    fs.mkdirSync(APP_OUT, { recursive: true });
    for (const dataset of (args.datasets || 'official,test').split(',')) {
      const store = new Store(DATA, dataset);
      const data = buildAppData({ store, sources, today: dataset === 'test' ? (args.testToday || today) : today, dataset });
      fs.writeFileSync(path.join(APP_OUT, `${dataset}.json`), JSON.stringify(data));
      console.log(dataset, { aggs: data.aggs.length, quotes: data.quotes.length, sources: data.sources.map(s => `${s.id}:${s.state}`).join(' ') });
    }
    return;
  }
  console.log('指令：inspect | import | fetch | export');
}
main().catch(e => { console.error(e.message); process.exit(1); });
