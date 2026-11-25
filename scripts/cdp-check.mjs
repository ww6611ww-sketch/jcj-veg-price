// 透過 WebView 除錯通道（Chrome DevTools Protocol）讀取 App 畫面狀態並驗證
// 用法：node cdp-check.mjs online|offline <預期 generatedAt> <預期最近訪價日>
import fs from 'node:fs';
const [mode, expectGen, expectLatest] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let list = [];
for (let i = 0; i < 30 && !list.length; i++) { try { list = (await (await fetch('http://127.0.0.1:9222/json')).json()).filter(p => p.type === 'page'); } catch {} if (!list.length) await sleep(1000); }
if (!list.length) { console.error('找不到 WebView 頁面'); process.exit(1); }
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const call = (method, params) => new Promise(res => { const i = ++id; const h = e => { const m = JSON.parse(e.data); if (m.id === i) { ws.removeEventListener('message', h); res(m.result); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => (await call('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }))?.result?.value;
for (let i = 0; i < 40; i++) { if (await ev('!!(window.__jcj && window.__jcj.S.origin && window.__jcj.S.data.official && document.querySelector(".row"))')) break; await sleep(1000); }
const home = await ev(`(() => { const S = window.__jcj.S, d = S.data.official; return { origin: S.origin, dataBase: window.JCJ_DATA_BASE || '', generatedAt: d.generatedAt,
  latest: (d.sources || []).map(s => s.latestDate).filter(Boolean).sort().at(-1) || null, bar: (document.querySelector('.originbar') || {}).innerText || '',
  firstRow: (document.querySelector('.row') || {}).innerText || '', ua: navigator.userAgent }; })()`);
await ev(`location.hash = '#compare-cauliflower'`); await sleep(2000);
const cmp = await ev(`[...document.querySelectorAll('.mrow')].map(r => r.innerText.replace(/\\n/g, ' ')).find(t => t.includes('清水第一市場')) || ''`);
await ev(`location.hash = ''`); await sleep(800);
const out = { 情境: mode, ...home, 比價列_清水第一市場花椰菜: cmp };
const checks = mode === 'online'
  ? { 來源為線上: home.origin === 'online', 取得已部署資料: home.generatedAt === expectGen, 顯示線上提示: home.bar.includes('線上行情'), 最近訪價日正確: home.latest === expectLatest, 比價有資料: cmp.includes('元／台斤') }
  : { 來源為內附: home.origin === 'bundled', 顯示離線提示: home.bar.includes('目前無法連線'), 提示含訪價日: home.bar.includes('最近訪價日'), 最近訪價日正確: home.latest === expectLatest, 比價有資料: cmp.includes('元／台斤') };
out.檢查 = checks; out.通過 = Object.values(checks).every(Boolean);
console.log(JSON.stringify(out, null, 2));
fs.writeFileSync(`e2e-${mode}.json`, JSON.stringify(out, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n## 模擬器實測：${mode === 'online' ? '連線' : '斷網'}\n\n` + Object.entries({ ...home, 比價列: cmp }).map(([k, v]) => `- ${k}：${v}`.replace(/\n/g, ' / ')).join('\n') + '\n' + Object.entries(checks).map(([k, v]) => `- ${v ? '✅' : '❌'} ${k}`).join('\n') + '\n');
ws.close();
if (!out.通過) process.exit(1);
