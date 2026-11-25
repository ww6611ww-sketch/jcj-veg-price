// 產生「測試資料」：依各來源原始格式產生的虛構檔案，只匯入 test 資料集，不得匯入 official。
// 涵蓋：多市場、單一市場、0＝缺價、整日缺資料、今日無資料、不同規格、查無對照市場、缺欄位。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'test-data');
fs.mkdirSync(out, { recursive: true });
let seed = 20261125; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const jitter = (base, pct = 0.12) => Math.round(base * (1 + (rnd() * 2 - 1) * pct));
const DAYS = ['2026-11-19','2026-11-20','2026-11-21','2026-11-22','2026-11-23','2026-11-24','2026-11-25'];
const TODAY = DAYS.at(-1);
const roc = d => { const [y,m,dd] = d.split('-'); return `${+y-1911}.${m}.${dd}`; };
const trend = (i) => 1 + 0.04 * Math.sin(i * 1.3);

// 1) 台中零售（寬表 CSV，元/斤，0=無報價；刻意不含「土雞」欄位以測缺欄位）
const TC_MARKETS = ['建國市場','第一市場','第二市場','第三市場','第五市場','合作市場','豐原第一市場','大甲第一市場','東勢第一市場','清水第一市場','沙鹿市場','霧峰市場','太平市場'];
const TC = { '甘藍(平地高麗菜)':35,'青蔥':120,'花椰菜':60,'青江白菜':40,'蕹菜(空心菜)':45,'胡蘿蔔':38,'洋蔥(內銷)':40,'絲瓜':55,
  '白蝦':280,'文蛤':150,'虱目魚':110,'金目鱸':160,'吳郭魚':80,'午仔魚':220,'里肌肉':170,'後腿肉':150,'五花肉':190,'牛腱(冷凍牛肉)':0,'肉雞':95 };
const head = ['市場名稱','訪價日期', ...Object.keys(TC)];
const lines = [head.join(',')];
DAYS.forEach((d, di) => TC_MARKETS.forEach((m, mi) => {
  if (d === TODAY && mi >= 8) return;               // 今日只有 8 個市場回報
  const row = [m, d.replace(/-/g, '/')];
  for (const [col, base] of Object.entries(TC)) {
    let v = base ? jitter(base * trend(di)) : 0;
    if (col === '洋蔥(內銷)' && d === TODAY) v = 0;   // 今日尚無資料
    if (col === '絲瓜' && d === '2026-11-22') v = 0;   // 走勢缺一天
    if (col === '午仔魚' && m !== '第二市場') v = 0;     // 單一市場訪價
    if (col === '文蛤' && rnd() < 0.3) v = '';          // 空值
    if (col === '青蔥' && d === TODAY && m === '第三市場') v = 520; // 高價只標記「待確認」
    row.push(v);
  }
  lines.push(row.join(','));
}));
fs.writeFileSync(path.join(out, 'TEST_taichung_retail.csv'), '﻿' + lines.join('\r\n'));

// 2) 蔬菜批發（JSON，民國日期，元/公斤）
const VEG_MKTS = ['台北一','台北二','板橋區','三重區','宜蘭市','台中市','豐原區','永靖鄉','西螺鎮','嘉義市','高雄市','鳳山區','屏東市','台東市','花蓮市','測試未對照市場'];
const VEG = { '甘藍-初秋':30,'甘藍-改良種':26,'青蔥-日蔥':110,'花椰菜-青梗':55,'青江白菜-小梗':32,'蕹菜-小葉':38,'胡蘿蔔-清洗':30,'洋蔥-本產':28,'絲瓜-絲瓜':48 };
const veg = [];
DAYS.forEach((d, di) => { for (const m of VEG_MKTS) {
  if (d === '2026-11-23' && /台北|板橋|三重/.test(m)) { veg.push({ 交易日期: roc(d), 作物名稱: '休市', 市場名稱: m }); continue; }
  if (m === '花蓮市' && di % 2) continue;
  for (const [n, base] of Object.entries(VEG)) {
    if (rnd() < 0.08) continue;
    const avg = jitter(base * trend(di), 0.2);
    veg.push({ 交易日期: roc(d), 種類代碼: 'N04', 作物代號: 'TEST', 作物名稱: n, 市場代號: '000', 市場名稱: m,
      上價: avg * 1.4, 中價: avg, 下價: avg * 0.6, 平均價: avg, 交易量: Math.round(rnd() * 20000) });
  } } });
fs.writeFileSync(path.join(out, 'TEST_moa_veg.json'), JSON.stringify(veg));

// 3) 漁產品批發（JSON，元/公斤；白蝦分規格）
const FISH_MKTS = ['台北','三重','台中','埔心','嘉義','高雄','屏東','花蓮','台東'];
const FISH = { '白蝦':300,'白蝦(大)':360,'文蛤':120,'虱目魚':100,'金目鱸':150,'吳郭魚':70,'午仔魚':260 };
const fish = [];
DAYS.forEach((d, di) => { if (d === '2026-11-23') return; for (const m of FISH_MKTS) for (const [n, base] of Object.entries(FISH)) {
  if (rnd() < 0.2) continue; const avg = jitter(base * trend(di), 0.18);
  fish.push({ 交易日期: roc(d), 品種代碼: 'TEST', 魚貨名稱: n, 市場名稱: m, 上價: avg*1.3, 中價: avg, 下價: avg*0.7, 交易量: Math.round(rnd()*3000), 平均價: avg });
} });
fs.writeFileSync(path.join(out, 'TEST_moa_fish.json'), JSON.stringify(fish));

// 4) 毛豬（JSON，元/公斤活體）
const HOG_MKTS = ['台北市','新北市','桃園市','彰化縣','雲林縣','台南市','高雄市','屏東縣','花蓮縣','台東縣'];
const hog = [];
DAYS.forEach((d, di) => { if (d === TODAY) return; for (const m of HOG_MKTS) {
  const p = +(78 * trend(di) + (rnd() * 6 - 3)).toFixed(2);
  hog.push({ 交易日期: roc(d), 市場名稱: m, '成交頭數-平均價格': p, '規格豬-平均價格': +(p + 1.2).toFixed(2),
    '95(含)-115(含)-平均價格': +(p - 0.5).toFixed(2), '115(含)-135(不含)-平均價格': +(p + 0.8).toFixed(2), '75(含)-95(不含)-平均價格': m === '台東縣' ? 0 : +(p - 3).toFixed(2) });
} });
fs.writeFileSync(path.join(out, 'TEST_moa_hog.json'), JSON.stringify(hog));

// 5) 白肉雞（JSON）
const poultry = DAYS.map((d, di) => ({ 日期: d, 農曆: '測試', '白肉雞(2.0Kg以上)': +(33 * trend(di)).toFixed(1), '白肉雞(1.75-1.95Kg)': +(35 * trend(di)).toFixed(1),
  '白肉雞(門市價高屏)': di === 3 ? '-' : +(46 * trend(di)).toFixed(1), '雞蛋(產地)': 30 }));
fs.writeFileSync(path.join(out, 'TEST_moa_poultry.json'), JSON.stringify(poultry));
fs.writeFileSync(path.join(out, 'README.txt'), '本資料夾全部是「測試資料」：依來源格式產生的虛構價格，用於驗證畫面、計價與解析。只能匯入 test 資料集，不是真實行情。\n');
console.log('test data written to', out);
