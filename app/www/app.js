/* 今日菜價 v0.1 — 單檔前端，無建置步驟。資料由後端輸出 data/official.json、data/test.json。 */
(() => {
  'use strict';
  const VERSION = '0.1.0';
  const KG_PER_JIN = 0.6;
  const TYPE_ORDER = ['retail', 'wholesale', 'poultry', 'hog_auction'];

  // ---------- 本機儲存（失敗時退回記憶體） ----------
  const mem = {};
  const store = {
    get(k, d) { try { const v = localStorage.getItem('jcj.' + k); return v == null ? d : JSON.parse(v); } catch { return k in mem ? mem[k] : d; } },
    set(k, v) { mem[k] = v; try { localStorage.setItem('jcj.' + k, JSON.stringify(v)); } catch {} },
  };

  const S = {
    region: store.get('region', 'central'),
    unit: store.get('unit', 'jin'),
    mode: store.get('mode', 'official'),
    favs: new Set(store.get('favs', [])),
    cat: null, q: '', sortAsc: true, combo: {},
    data: { official: null, test: null },
  };
  const D = () => S.data[S.mode];

  // ---------- 工具 ----------
  const $app = document.getElementById('app');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const unitLabel = () => (S.unit === 'jin' ? '元／台斤' : '元／公斤');
  const conv = perKg => (S.unit === 'jin' ? perKg * KG_PER_JIN : perKg);
  const fmt = perKg => { const v = conv(perKg); return v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10); };
  const md = d => { const [, m, dd] = d.split('-'); return `${+m}/${+dd}`; };
  const lastNDays = (end, n) => { const [y, m, d] = end.split('-').map(Number); return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1, d - (n - 1 - i))).toISOString().slice(0, 10)); };
  const taipeiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const today = () => (D()?.isTest ? D().today : taipeiToday());
  const item = id => D().items.find(i => i.id === id);
  const typeLabel = t => D().priceTypes[t]?.label ?? t;
  const areaLabel = a => (a === 'national' ? '全國產地' : a?.startsWith('area:') ? a.slice(5) + '地區' : D().regions[a] ?? a);
  const comboKey = c => [c.t, c.s, c.a].join('~');
  const parseCombo = k => { const [t, s, a] = (k || '').split('~'); return t ? { t, s: s ?? '', a } : null; };
  const comboName = c => [typeLabel(c.t), c.s, c.a !== S.region ? areaLabel(c.a) : ''].filter(Boolean).join('・');

  const thumb = (it, cls = 'thumb') => it.img
    ? `<img class="${cls}" src="img/${it.img}.webp" alt="">`
    : `<span class="${cls} ph" aria-hidden="true">${esc(it.name[0])}</span>`;
  const ICON = {
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    heart: f => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z" fill="${f ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2"/></svg>`,
    shop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9 5 4h14l2 5v1a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM5 13v7h14v-7M10 20v-4h4v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="m15.5 15.5 5 5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  };

  // ---------- 資料查詢 ----------
  const isPending = id => (D().sources || []).some(s => (s.pendingItems || []).includes(id));
  const inRegion = a => a === S.region || a === 'national' || (a === 'area:高屏' && S.region === 'south');

  /** 某品項在目前地區可用的價格組合（價格類型＋規格＋範圍），依預設優先序排列 */
  function combosFor(id) {
    const t = today(), m = new Map();
    for (const g of D().aggs) {
      if (g.i !== id || !inRegion(g.a) || g.d > t) continue;
      const k = comboKey(g), cur = m.get(k);
      if (!cur || g.d > cur.latest.d) m.set(k, { t: g.t, s: g.s, a: g.a, latest: g });
    }
    return [...m.values()].sort((x, y) =>
      TYPE_ORDER.indexOf(x.t) - TYPE_ORDER.indexOf(y.t) ||
      (x.a === S.region ? 0 : 1) - (y.a === S.region ? 0 : 1) ||
      (y.s === '規格豬') - (x.s === '規格豬') || y.latest.n - x.latest.n || x.s.localeCompare(y.s, 'zh-Hant'));
  }
  const series = (id, c) => {
    const days = lastNDays(today(), 7);
    return days.map(d => ({ d, g: D().aggs.find(g => g.i === id && g.d === d && g.t === c.t && g.s === c.s && g.a === c.a) || null }));
  };
  const marketWord = c => (c.t === 'retail' ? '訪價' : '報價');
  const countText = (g, c) => (g.n === 1 ? `單一市場${marketWord(c)}` : `${g.n} 個市場有效${marketWord(c)}`);
  const dateText = g => (g.d === today() ? `今日 ${md(g.d)}` : `${md(g.d)}`);

  // ---------- 共用片段 ----------
  function testBar() { return D()?.isTest ? '<div class="testbar" role="status">⚠ 測試資料・非真實行情</div>' : ''; }
  function unitSeg() {
    return `<div class="seg units" role="group" aria-label="價格單位">
      <button data-unit="jin" aria-pressed="${S.unit === 'jin'}">台斤</button>
      <button data-unit="kg" aria-pressed="${S.unit === 'kg'}">公斤</button></div>`;
  }
  function subBar(title, back = true) {
    return `<header class="bar">${back ? `<button class="iconbtn" data-act="back" aria-label="返回">${ICON.back}</button>` : '<span style="width:48px"></span>'}
      <h1>${esc(title)}</h1>${D()?.isTest ? '<span class="badge test">測試資料</span>' : '<span style="width:48px"></span>'}</header>`;
  }
  function itemRow(it) {
    const cs = combosFor(it.id), c = cs[0];
    if (!c) { const pend = isPending(it.id);
      return `<a class="row" href="#item-${it.id}" aria-label="${esc(it.name)}，${pend ? '單位待確認' : '無報價'}">${thumb(it)}
      <div class="mid"><div class="name">${esc(it.name)}</div><div class="meta">${pend ? '台中訪價有資料，單位待確認，暫不顯示' : '近 14 日此地區無報價'}</div></div>
      <div class="pill none"><span class="num">${pend ? '待確認' : '無報價'}</span></div>${ICON.chev}</a>`; }
    const g = c.latest, isToday = g.d === today();
    const range = g.n > 1 ? `${fmt(g.min)}–${fmt(g.max)}` : `單一市場`;
    return `<a class="row" href="#item-${it.id}" data-setcombo="${esc(it.id)}|${esc(comboKey(c))}" aria-label="${esc(it.name)} ${esc(comboName(c))} ${fmt(g.med)} ${unitLabel()}">
      ${thumb(it)}
      <div class="mid"><div class="name">${esc(it.name)}</div>
        <div><span class="tag">${esc(typeLabel(c.t))}</span>${c.s ? `<span class="tag">${esc(c.s)}</span>` : ''}${c.a !== S.region ? `<span class="tag">${esc(areaLabel(c.a))}</span>` : ''}</div>
        <div class="meta">${range}・${md(g.d)}${isToday ? '' : '<b class="warnt">・今日無資料</b>'}</div></div>
      <div class="pill"><span class="num">${fmt(g.med)}</span><small>${unitLabel()}</small></div>${ICON.chev}</a>`;
  }
  function noVerified() {
    return `<div class="empty"><h2>暫無已驗證資料</h2>
      <p>正式行情要等官方原始檔核對完欄位、日期與單位後才會顯示。</p>
      ${sourceList()}
      ${S.data.test ? '<button class="linkbtn" data-act="mode-test">先用測試資料預覽畫面</button>' : ''}</div>`;
  }
  function sourceList() {
    return `<ul class="srclist">${D().sources.map(s => {
      const cls = s.state === '已接通' ? 'ok' : s.state === '測試資料' ? 'test' : 'wait';
      const hm = t => t ? new Date(t).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
      const extra = D().isTest ? '' : `<br><small>手動匯入：${s.manual?.at ? hm(s.manual.at) + ' 成功' : '尚無'}・每日抓取：${s.scheduled?.error ? `${hm(s.scheduled.tried)} 失敗` : s.scheduled?.at ? `${hm(s.scheduled.at)} 成功${s.scheduled.newData ? '（有新資料）' : '（來源沒有新資料）'}` : '尚未執行'}</small>${s.pendingItems?.length ? `<br><small>單位待確認：${s.pendingItems.map(i => esc(item(i)?.name ?? i)).join('、')}</small>` : ''}`;
      return `<li><span>${esc(s.name)}<br><small>${esc(typeLabel(s.priceType))}${s.latestDate ? `・最新資料 ${md(s.latestDate)}` : ''}</small>${extra}</span><span class="state ${cls}">${esc(s.state)}</span></li>`;
    }).join('')}</ul>`;
  }

  // ---------- 頁面 ----------
  function viewHome() {
    const d = D(), q = S.q.trim();
    const regions = Object.entries(d.regions).map(([k, v]) => `<button data-region="${k}" aria-pressed="${S.region === k}">${v}</button>`).join('');
    const catImg = { veg: 'cabbage', seafood: 'shrimp', meat: 'pork_belly' };
    const cats = Object.entries(d.categories).map(([k, v]) =>
      `<button class="cat" data-cat="${k}" aria-pressed="${S.cat === k}"><img src="img/${catImg[k]}.webp" alt=""><span>${v}</span></button>`).join('');
    let items = d.items.filter(i => (!S.cat || i.cat === S.cat) && (!q || i.name.includes(q) || i.alias.some(a => a.includes(q))));
    const has = items.filter(i => combosFor(i.id).length), none = items.filter(i => !combosFor(i.id).length);
    const anyData = d.aggs.length > 0;
    let body;
    if (!anyData) body = noVerified();
    else if (!items.length) body = `<div class="empty"><h2>找不到「${esc(q)}」</h2><p>試試「高麗菜」「白蝦」「五花肉」</p></div>`;
    else body = `${!has.length && !q ? `<div class="notice">${esc(d.regions[S.region])}目前沒有已驗證的來源（正式行情只接通台中菜市場訪價）。</div>` : ''}<div class="list">${has.map(itemRow).join('')}</div>${none.length ? `<div class="section-t">此地區暫無報價</div><div class="list">${none.map(itemRow).join('')}</div>` : ''}`;
    return `${testBar()}
      <header class="home-head"><img src="img/basket.webp" alt=""><h1>今日菜價</h1>${d.isTest ? '<span class="badge test">測試資料</span>' : ''}</header>
      ${originBar()}
      <div class="seg regions" role="group" aria-label="地區">${regions}</div>
      <label class="search">${ICON.search}<span class="sr">搜尋食材</span><input type="search" id="q" placeholder="搜尋食材" value="${esc(S.q)}" enterkeyhint="search" autocomplete="off"></label>
      <div class="cats" role="group" aria-label="分類">${cats}</div>
      <div class="toolbar"><span class="meta">${esc(d.regions[S.region])}・${S.cat ? esc(d.categories[S.cat]) : '全部'}・${items.length} 項</span>${unitSeg()}</div>
      ${body}
      <p class="foot"><button class="linkbtn" data-act="sources">資料來源與狀態</button><br>v${VERSION}</p>`;
  }

  function chartSVG(pts) {
    const vals = pts.filter(p => p.g).map(p => conv(p.g.med));
    if (!vals.length) return '<p class="meta">近 7 天無資料</p>';
    const W = 340, H = 170, L = 52, R = 24, T = 14, B = 28;
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = Math.max((hi - lo) * 0.25, hi * 0.05, 1); lo = Math.max(0, lo - pad); hi = hi + pad;
    const x = i => L + (i * (W - L - R)) / 6, y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const ticks = [lo, (lo + hi) / 2, hi];
    let segs = [], cur = [];
    pts.forEach((p, i) => { if (p.g) cur.push([x(i), y(conv(p.g.med))]); else { if (cur.length) segs.push(cur); cur = []; } });
    if (cur.length) segs.push(cur);
    const tf = v => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="近 7 天中位數走勢：${pts.map(p => `${md(p.d)} ${p.g ? fmt(p.g.med) : '無資料'}`).join('，')}">
      ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e6e6dc"/><text x="${L - 14}" y="${y(v) + 4}" text-anchor="end" font-size="12" fill="#4a5a52">${tf(v)}</text>`).join('')}
      ${segs.map(s => `<polygon points="${s[0][0]},${H - B} ${s.map(p => p.join(',')).join(' ')} ${s.at(-1)[0]},${H - B}" fill="#E3EED5" opacity=".7"/><polyline points="${s.map(p => p.join(',')).join(' ')}" fill="none" stroke="#1f7a4f" stroke-width="3" stroke-linejoin="round"/>`).join('')}
      ${pts.map((p, i) => p.g
        ? `<circle cx="${x(i)}" cy="${y(conv(p.g.med))}" r="5" fill="#fff" stroke="#1f7a4f" stroke-width="2.5"/>`
        : `<text x="${x(i)}" y="${H - B - 6}" text-anchor="middle" font-size="11" fill="#8a8f85">無</text>`).join('')}
      ${pts.map((p, i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="12" fill="${p.g ? '#14201b' : '#9aa094'}" font-weight="${p.d === today() ? 800 : 400}">${md(p.d)}</text>`).join('')}
    </svg>`;
  }

  function viewItem(id, ck) {
    const it = item(id); if (!it) return viewHome();
    const cs = combosFor(id);
    const c = cs.find(x => comboKey(x) === ck) || cs[0];
    const fav = S.favs.has(id);
    const favBtn = `<button class="btn ${fav ? 'primary' : 'secondary'}" data-act="fav" data-id="${id}" aria-pressed="${fav}">${ICON.heart(fav)}${fav ? '已收藏' : '收藏'}</button>`;
    if (!c) return `${testBar()}${subBar(it.name)}<div class="hero">${thumb(it)}</div>
      <div class="empty"><h2>${isPending(id) ? '單位待確認' : D().aggs.length ? '近 14 日此地區無報價' : '暫無已驗證資料'}</h2><p>${isPending(id) ? `台中菜市場訪價有「${esc(it.name)}」的報價，但官方資料未註明此品項單位，確認前不顯示價格。` : `${esc(D().regions[S.region])}目前沒有「${esc(it.name)}」的已驗證報價。可切換地區查看。`}</p></div>
      <div class="actions" style="grid-template-columns:1fr">${favBtn}</div>`;
    const g = c.latest, isToday = g.d === today();
    const chips = cs.length > 1 ? `<div class="chips" role="group" aria-label="價格類型與規格">${cs.map(x =>
      `<button class="chip" data-combo="${esc(comboKey(x))}" aria-pressed="${comboKey(x) === comboKey(c)}">${esc(comboName(x))}</button>`).join('')}</div>` : '';
    return `${testBar()}${subBar(it.name)}
      <div class="hero">${thumb(it)}</div>${chips}
      <div class="pricebox"><span class="ptype">${esc(typeLabel(c.t))}</span>${c.s ? ` <span class="tag" style="font-size:15px">${esc(c.s)}</span>` : ''}
        <div class="big"><span class="num">${fmt(g.med)}</span><span class="u">${unitLabel()}</span></div>
        ${unitSeg()}</div>
      ${isToday ? '' : `<div class="notice">今日尚無資料・最近有效${c.t === 'retail' ? '訪價' : '報價'}日 ${md(g.d)}</div>`}
      ${g.fl ? `<div class="notice">${g.fl.map(esc).join('、')} 的報價高於當日中位數 3 倍，標記「待確認」，仍計入中位數與範圍。</div>` : ''}
      <div class="facts">
        <div class="fact"><span>資料日期</span><b>${dateText(g)}</b></div>
        <div class="fact"><span>有效市場數</span><b>${g.n === 1 ? `單一市場${marketWord(c)}` : `${g.n} 個市場`}</b></div>
        <div class="fact"><span>參考價</span><b>${g.n > 1 ? '各市場中位數' : '單一市場價'}</b></div>
        <div class="fact"><span>範圍（最低–最高）</span><b>${g.n > 1 ? `${fmt(g.min)}–${fmt(g.max)}` : '—'}</b></div>
      </div>
      <div class="card chart"><h2>近 7 天</h2>${chartSVG(series(id, c))}</div>
      <p class="rawnote">${c.t === 'retail' ? '來源：臺中市公有零售市場訪價・' : ''}範圍：${esc(areaLabel(c.a))}・原始單位：${esc(g.u.join('、'))}・1 台斤＝0.6 公斤</p>
      <div class="actions">${favBtn}<a class="btn secondary" href="#compare-${id}">${ICON.shop}市場比價</a></div>`;
  }

  function viewCompare(id, ck) {
    const d = D();
    if (!d.aggs.length) return `${testBar()}${subBar('市場比價', false)}${noVerified()}`;
    const withData = d.items.filter(i => combosFor(i.id).length);
    const it = item(id) || withData[0] || d.items[0];
    const cs = combosFor(it.id);
    const c = cs.find(x => comboKey(x) === ck) || cs[0];
    const opts = d.items.map(i => `<option value="${i.id}"${i.id === it.id ? ' selected' : ''}>${esc(i.name)}</option>`).join('');
    let body;
    if (!c) body = `<div class="empty"><h2>此地區無報價</h2><p>${esc(d.regions[S.region])}近 14 日沒有「${esc(it.name)}」的報價。</p></div>`;
    else {
      const date = c.latest.d;
      let qs = d.quotes.filter(q => q.i === it.id && q.t === c.t && q.s === c.s && q.a === c.a && q.d === date);
      qs.sort((a, b) => (S.sortAsc ? a.k - b.k : b.k - a.k));
      const chips = cs.length > 1 ? `<div class="chips">${cs.map(x => `<button class="chip" data-combo="${esc(comboKey(x))}" aria-pressed="${comboKey(x) === comboKey(c)}">${esc(comboName(x))}</button>`).join('')}</div>` : '';
      body = `${chips}<div class="cmp-head"><span>${esc(typeLabel(c.t))}${c.s ? '・' + esc(c.s) : ''}・${esc(areaLabel(c.a))}・${dateText(c.latest)}・${qs.length} 筆</span>
        <button class="sortbtn" data-act="sort">${S.sortAsc ? '低→高' : '高→低'}</button></div>
        ${date !== today() ? `<div class="notice">今日尚無資料・以下為最近有效日 ${md(date)}</div>` : ''}
        ${c.a === 'national' ? '<div class="notice">此為全國產地行情，不分市場。</div>' : ''}
        <div class="list">${qs.map((q, i) => `<div class="mrow">${ICON.shop}<div class="mid" style="flex:1"><div class="mname">${esc(q.m)}</div>
          <div class="meta">${i === 0 && qs.length > 1 ? `<span class="rank">${S.sortAsc ? '最低' : '最高'}</span> ` : ''}${q.f ? '<span class="flagt">待確認</span> ' : ''}${q.c && c.t !== 'retail' ? esc(q.c) + '・' : ''}${md(q.d)}・原始 ${q.p} ${esc(q.u)}</div></div>
          <div class="pill"><span class="num">${fmt(q.k)}</span><small>${unitLabel()}</small></div></div>`).join('')}</div>`;
    }
    return `${testBar()}${subBar('市場比價', !!id)}
      <div class="selectwrap"><label class="sr" for="cmpitem">食材</label><select id="cmpitem">${opts}</select></div>
      <div class="toolbar" style="margin-top:8px"><span class="meta">${esc(d.regions[S.region])}</span>${unitSeg()}</div>${body}`;
  }

  function viewFav() {
    const favs = D().items.filter(i => S.favs.has(i.id));
    return `${testBar()}${subBar('收藏', false)}
      <div class="toolbar" style="margin-top:12px"><span class="meta">${esc(D().regions[S.region])}・${favs.length} 項</span>${unitSeg()}</div>
      ${favs.length ? `<div class="list">${favs.map(itemRow).join('')}</div>` : '<div class="empty"><h2>還沒有收藏</h2><p>在食材頁按「收藏」，常買的菜就會出現在這裡。收藏只存在這支手機。</p></div>'}`;
  }

  function openSources() {
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="資料來源"><h2>資料來源與狀態</h2>
      <p class="meta">目前顯示：${D().isTest ? '測試資料（虛構價格）' : '正式行情'}${S.origin === 'online' ? '・線上取得' : S.origin === 'bundled' ? '・App 內附（離線）' : ''}</p>${sourceList()}
      ${S.data.test ? `<label class="switch"><span>預覽測試資料</span><input type="checkbox" id="modeSw" ${S.mode === 'test' ? 'checked' : ''}></label>` : ''}
      <p class="meta">測試資料只用來檢查畫面與計算，與正式行情分開存放，不會混入。</p>
      <button class="btn secondary" style="width:100%;margin-top:10px" data-act="close">關閉</button></div>`;
    document.body.appendChild(bg);
    bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-act=close]')) bg.remove(); });
    bg.querySelector('#modeSw')?.addEventListener('change', e => { setMode(e.target.checked ? 'test' : 'official'); bg.remove(); });
  }

  // ---------- 路由與事件 ----------
  function route() {
    if (!D()) return;
    const h = (location.hash || '').slice(1);
    const m = h.match(/^(item|compare)-([a-z]+)$/);
    const seg = m ? [m[1], m[2]] : h === 'fav' || h === 'compare' ? [h] : [];
    const ck = seg[1] ? S.combo[seg[1]] : null;
    let tab = 'home', html;
    if (seg[0] === 'item') html = viewItem(seg[1], ck);
    else if (seg[0] === 'compare') { tab = 'compare'; html = viewCompare(seg[1], ck); }
    else if (seg[0] === 'fav') { tab = 'fav'; html = viewFav(); }
    else html = viewHome();
    document.body.classList.toggle('testmode', !!D().isTest);
    $app.innerHTML = html;
    document.querySelectorAll('.tabbar a').forEach(a => a.toggleAttribute('aria-current', a.dataset.tab === tab) && a.setAttribute('aria-current', 'page'));
    const q = document.getElementById('q');
    if (q) q.addEventListener('input', e => { S.q = e.target.value; const pos = e.target.selectionStart; route(); const n = document.getElementById('q'); n.focus(); n.setSelectionRange(pos, pos); });
    const sel = document.getElementById('cmpitem');
    if (sel) sel.addEventListener('change', e => { location.hash = `#compare-${e.target.value}`; });
  }
  function setMode(m) { S.mode = m; store.set('mode', m); route(); }

  document.addEventListener('click', e => {
    const lk = e.target.closest('a[data-setcombo]');
    if (lk) { const [id, k] = lk.dataset.setcombo.split('|'); S.combo[id] = k; }
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.region) { S.region = t.dataset.region; store.set('region', S.region); route(); }
    else if (t.dataset.unit) { S.unit = t.dataset.unit; store.set('unit', S.unit); route(); }
    else if (t.dataset.cat) { S.cat = S.cat === t.dataset.cat ? null : t.dataset.cat; route(); }
    else if (t.dataset.combo) { const id = (location.hash.match(/-([a-z]+)$/) || [])[1]; if (id) { S.combo[id] = t.dataset.combo; route(); } }
    else if (t.dataset.act === 'back') { if (S.depth > 0) history.back(); else { const id = (location.hash.match(/^#compare-([a-z]+)$/) || [])[1]; location.hash = id ? `#item-${id}` : ''; } }
    else if (t.dataset.act === 'fav') { const id = t.dataset.id; S.favs.has(id) ? S.favs.delete(id) : S.favs.add(id); store.set('favs', [...S.favs]); route(); }
    else if (t.dataset.act === 'sort') { S.sortAsc = !S.sortAsc; route(); }
    else if (t.dataset.act === 'sources') openSources();
    else if (t.dataset.act === 'mode-test') setMode('test');
    else if (t.dataset.act === 'reload') { t.textContent = '連線中…'; load(); }
  });
  S.depth = 0;
  window.addEventListener('hashchange', () => { S.depth++; route(); window.scrollTo(0, 0); });

  // Android 實體返回鍵（Capacitor App 外掛）
  try {
    const App = window.Capacitor?.Plugins?.App;
    App?.addListener('backButton', () => { const h = location.hash; if (!h || h === '#') App.exitApp(); else { const id = (h.match(/^#compare-([a-z]+)$/) || [])[1]; location.hash = id ? `#item-${id}` : ''; } });
  } catch {}

  // 資料來源：online＝已部署網址的最新行情；bundled＝連不到時改用 App 內附資料；site＝網頁版同網址資料
  async function load() {
    const REMOTE = window.JCJ_DATA_BASE || '';
    const tryGet = async (u, ms = 8000) => { try { const r = await fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(ms) }); return r.ok ? r.json() : null; } catch { return null; } };
    let o = null;
    if (REMOTE) { o = await tryGet(`${REMOTE}/official.json`); S.origin = o ? 'online' : 'bundled'; S.remoteTriedAt = new Date().toISOString(); }
    if (!o) { o = await tryGet('data/official.json'); if (!REMOTE) S.origin = 'site'; }
    const t = await tryGet('data/test.json');
    S.data.official = o || { dataset: 'official', isTest: false, aggs: [], quotes: [], items: t?.items || [], sources: [], regions: t?.regions, priceTypes: t?.priceTypes, categories: t?.categories };
    S.data.test = t;
    if (S.mode === 'test' && !t) S.mode = 'official';
    route();
  }
  // 行情來源提示：只在 App（有設定線上網址）顯示
  function originBar() {
    const d = S.data.official; if (!d || D()?.isTest || S.origin === 'site' || !S.origin) return '';
    const lat = (d.sources || []).map(s => s.latestDate).filter(Boolean).sort().at(-1);
    const gen = d.generatedAt ? new Date(d.generatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
    return S.origin === 'online'
      ? `<div class="originbar ok" data-origin="online">線上行情・更新於 ${gen}${lat ? `・最近訪價日 ${md(lat)}` : ''}</div>`
      : `<div class="originbar off" data-origin="bundled" role="status"><b>目前無法連線，顯示 App 內附資料</b><br>資料產生於 ${gen}${lat ? `・最近訪價日 ${md(lat)}` : ''}<br><button class="linkbtn" data-act="reload">重新連線</button></div>`;
  }
  window.__jcj = { S, version: VERSION, reload: () => load() };
  load();
})();
