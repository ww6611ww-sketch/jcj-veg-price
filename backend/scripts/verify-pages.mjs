// 讀已部署網頁的 official.json：與 repo 輸出比對，並以 sample.json 對照一筆原始報價
import fs from 'node:fs';
const url = process.argv[2];
const root = new URL('../..', import.meta.url).pathname;
const local = JSON.parse(fs.readFileSync(root + 'app/www/data/official.json', 'utf8'));
const sm = JSON.parse(fs.readFileSync(root + 'backend/data/official/sample.json', 'utf8'));
const web = await (await fetch(url, { cache: 'no-store' })).json();
const tc = d => d.sources.find(s => s.id === 'taichung_retail');
const q = web.quotes.find(q => q.m === sm.market && q.i === sm.item && q.d === sm.date);
const out = {
  網頁網址: url, 網頁generatedAt: web.generatedAt, repo_generatedAt: local.generatedAt,
  網頁台中最新訪價日: tc(web).latestDate, repo台中最新訪價日: tc(local).latestDate,
  原始報價: JSON.stringify(sm.raw), App匯出_元每台斤: sm.appData?.['元每台斤'], 網頁_元每台斤: q ? +(q.k * 0.6).toFixed(2) : null, 對照日: sm.date,
};
out.資料一致 = out.網頁generatedAt === out.repo_generatedAt;
out.報價一致 = out.網頁_元每台斤 !== null && out.網頁_元每台斤 === out.App匯出_元每台斤;
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n## 網頁驗證\n\n' + Object.entries(out).map(([k, v]) => `- ${k}：${v}`).join('\n') + '\n');
if (!out.資料一致 || !out.報價一致) process.exit(1);
