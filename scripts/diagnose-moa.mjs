// 只讀診斷：測試農業部蔬菜 API 日期／分頁參數，並抽查漁產同檔重複列的差異欄位。不寫入任何資料。
const B = 'https://data.moa.gov.tw/Service/OpenData/FromM/';
const get = async u => { const t0 = Date.now(); try { const r = await fetch(u, { signal: AbortSignal.timeout(120000) }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt.replace(/^﻿/, '')); } catch {} return { u, http: r.status, bytes: txt.length, ms: Date.now() - t0, rows: Array.isArray(j) ? j.length : null, j, head: Array.isArray(j) ? null : txt.slice(0, 200) }; } catch (e) { return { u, err: e.message }; } };
const dates = j => { if (!Array.isArray(j)) return null; const m = {}; for (const r of j) { const d = r['交易日期'] ?? r.TransDate; m[d] = (m[d] || 0) + 1; } return Object.fromEntries(Object.entries(m).sort()); };
const out = { veg: [], fish: {} };
const V = B + 'FarmTransData.aspx';
for (const q of ['', '?StartDate=115.11.19&EndDate=115.11.19', '?Start_time=115.11.19&End_time=115.11.19', '?$top=100', '?$top=100&$skip=9999', '?StartDate=115.11.19&EndDate=115.11.25&$top=50000', '?StartDate=115.11.19&EndDate=115.11.25&$skip=9999',
  '?StartDate=1151119&EndDate=1151119', '?TcType=N04', '?Crop=甘藍', '?CropName=甘藍']) {
  const r = await get(V + q); out.veg.push({ q: q || '(無參數)', http: r.http, rows: r.rows, bytes: r.bytes, err: r.err, head: r.head, dates: dates(r.j), keys: Array.isArray(r.j) && r.j[0] ? Object.keys(r.j[0]) : undefined });
}
const v1 = await get('https://data.moa.gov.tw/api/v1/AgriProductsTransType/?Start_time=115.11.19&End_time=115.11.19&CropName=%E7%94%98%E8%97%8D');
out.vegApiV1 = { http: v1.http, bytes: v1.bytes, err: v1.err, head: (v1.head || JSON.stringify(v1.j)?.slice(0, 300)) };
// 漁產：重複鍵的列差在哪些欄位
const f = await get(B + 'AquaticTransData.aspx');
if (Array.isArray(f.j)) {
  const g = new Map();
  for (const r of f.j) { const k = [r['交易日期'], r['市場名稱'], r['魚貨名稱']].join('|'); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
  const dups = [...g.values()].filter(rs => rs.length > 1);
  const diffFields = {};
  for (const rs of dups) for (const k of Object.keys(rs[0])) if (new Set(rs.map(r => JSON.stringify(r[k]))).size > 1) diffFields[k] = (diffFields[k] || 0) + 1;
  const byName = {}; for (const rs of dups) byName[rs[0]['魚貨名稱']] = (byName[rs[0]['魚貨名稱']] || 0) + 1;
  const codeName = {}; for (const r of f.j) { const n = r['魚貨名稱']; if (['白蝦', '文蛤', '虱目魚', '金目鱸', '吳郭魚', '午仔魚'].some(x => n.includes(x))) { (codeName[n] ||= new Set()).add(r['品種代碼']); } }
  out.fish = { http: f.http, rows: f.rows, keys: Object.keys(f.j[0]), dupGroups: dups.length, dupRows: dups.reduce((a, rs) => a + rs.length, 0), 差異欄位: diffFields, 重複群組依魚名: byName,
    目標魚名的品種代碼: Object.fromEntries(Object.entries(codeName).map(([k, v]) => [k, [...v]])), 範例: dups.filter(rs => ['白蝦', '文蛤', '虱目魚', '金目鱸', '吳郭魚', '午仔魚'].some(x => rs[0]['魚貨名稱'].includes(x))).slice(0, 6) };
}
console.log('DIAG_JSON_START'); console.log(JSON.stringify(out, null, 1)); console.log('DIAG_JSON_END');
