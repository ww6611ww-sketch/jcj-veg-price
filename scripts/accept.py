# 手機尺寸驗收：正式模式（台中 84539 實際資料）＋ 測試模式；含重開後保留狀態
import sys, json, subprocess, time
from playwright.sync_api import sync_playwright
root, out = sys.argv[1], sys.argv[2]
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8766", "-d", root], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); U = "http://localhost:8766/"
errs, res = [], {}
def ok(k, cond, got): res[k] = ("PASS" if cond else "FAIL", got)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, locale="zh-TW")
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(U); pg.wait_for_timeout(600)
    shot = lambda n: pg.screenshot(path=f"{out}/{n}.png", full_page=True)
    shot("A01_official_home_central")
    names = pg.locator(".row .name").all_inner_texts()
    ok("首頁正式：8 項蔬菜有價、其餘待確認", names[:8] == ['高麗菜','青蔥','花椰菜','青江菜','空心菜','紅蘿蔔','洋蔥','絲瓜'] and pg.locator(".pill.none").count() == 14, (names[:8], pg.locator(".pill.none").count()))
    ok("首頁正式：今日無資料提示最近 11/24", "11/24・今日無資料" in pg.locator(".row").first.inner_text(), pg.locator(".row .meta").first.inner_text())
    # 搜尋
    pg.fill("#q", "花菜"); pg.wait_for_timeout(200)
    ok("搜尋別名「花菜」", pg.locator(".row .name").all_inner_texts() == ['花椰菜'], pg.locator(".row .name").all_inner_texts())
    pg.fill("#q", "白蝦"); pg.wait_for_timeout(200)
    ok("搜尋「白蝦」顯示待確認", "待確認" in pg.locator(".row").first.inner_text(), pg.locator(".row").first.inner_text().replace("\n"," "))
    pg.fill("#q", "")
    # 詳情
    pg.click("a[href='#item-cauliflower']"); pg.wait_for_timeout(300); shot("A02_official_detail_cauliflower")
    big = pg.locator(".big .num").inner_text(); facts = pg.locator(".facts").inner_text().replace("\n"," ")
    ok("詳情：花椰菜 42 元/台斤、40–80、9 個市場、11/24", big == "42" and "40–80" in facts and "9 個市場" in facts and "11/24" in facts, (big, facts))
    ok("詳情：今日尚無資料提示", pg.locator(".notice").count() == 1, pg.locator(".notice").first.inner_text() if pg.locator(".notice").count() else None)
    ok("詳情：7 天走勢 11/19–11/25 且 11/25 無", "11/25 無資料" in (pg.locator(".chart svg").get_attribute("aria-label") or ""), pg.locator(".chart svg").get_attribute("aria-label"))
    pg.click("[data-unit=kg]"); ok("單位切換：42 元/台斤 → 70 元/公斤", pg.locator(".big .num").inner_text() == "70", pg.locator(".big .num").inner_text()); pg.click("[data-unit=jin]")
    pg.click("[data-act=fav]"); pg.wait_for_timeout(200)
    # 市場比價
    pg.click("a[href='#compare-cauliflower']"); pg.wait_for_timeout(300); shot("A03_official_compare_cauliflower")
    rows = pg.locator(".mrow").all_inner_texts()
    prices = [int(r.split("\n")[-2]) if r.split("\n")[-2].isdigit() else r for r in rows]
    ok("比價：9 市場、同日 11/24、低→高", len(rows) == 9 and prices == sorted(prices) and all("11/24" in r for r in rows), prices)
    ok("比價：清水第一市場 原始 42 元/斤 → 42 元/台斤", any("清水第一市場" in r and "原始 42 元/斤" in r and "\n42\n" in "\n"+r+"\n" for r in rows), [r.replace("\n"," ") for r in rows if "清水" in r])
    pg.click("[data-act=sort]"); p2 = pg.locator(".mrow .pill .num").all_inner_texts(); ok("比價：切換高→低", p2[0] == "80", p2)
    pg.click("[data-act=back]"); pg.wait_for_timeout(200); ok("返回鍵回到詳情", pg.locator(".bar h1").inner_text() == "花椰菜", pg.locator(".bar h1").inner_text())
    # 收藏 + 選區 + 單位 → 重開
    pg.goto(U + "#"); pg.wait_for_timeout(300); pg.click("[data-region=north]"); pg.click("[data-unit=kg]"); shot("A04_official_north_empty")
    ok("北部無已驗證來源提示", "目前沒有已驗證的來源" in pg.locator("#app").inner_text(), None)
    pg2 = ctx.new_page(); pg.close(); pg2.goto(U + "#fav"); pg2.wait_for_timeout(500)
    st = pg2.evaluate("({r: window.__jcj.S.region, u: window.__jcj.S.unit, f:[...window.__jcj.S.favs], m: window.__jcj.S.mode})")
    ok("重開後保留：北部、公斤、收藏花椰菜、正式模式", st == {"r":"north","u":"kg","f":["cauliflower"],"m":"official"}, st)
    pg2.click("[data-region=central]") if pg2.locator("[data-region=central]").count() else None
    pg2.evaluate("localStorage.setItem('jcj.region', JSON.stringify('central'))"); pg2.reload(); pg2.wait_for_timeout(400)
    ok("收藏頁顯示花椰菜（公斤）", pg2.locator(".row .name").all_inner_texts() == ["花椰菜"] and "元／公斤" in pg2.locator(".row").first.inner_text(), pg2.locator(".row").first.inner_text().replace("\n"," "))
    shot2 = lambda n: pg2.screenshot(path=f"{out}/{n}.png", full_page=True); shot2("A05_official_fav_kg")
    pg2.click("[data-unit=jin]")
    pg2.goto(U + "#item-whiteshrimp"); pg2.wait_for_timeout(300); shot2("A06_official_shrimp_pending")
    ok("白蝦詳情：單位待確認、不顯示價格", "單位待確認" in pg2.locator(".empty").inner_text() and pg2.locator(".big").count() == 0, None)
    # 異常值排除後：白蝦在正式模式仍單位待確認；用測試模式驗證「待確認」標記
    pg2.goto(U + "#"); pg2.wait_for_timeout(300); pg2.click("[data-act=sources]"); pg2.wait_for_timeout(200); pg2.screenshot(path=f"{out}/A07_sources_sheet.png")
    ok("來源面板：手動匯入成功／每日抓取失敗 分開顯示", "手動匯入：" in pg2.locator(".sheet").inner_text() and "每日抓取：" in pg2.locator(".sheet").inner_text(), None)
    pg2.click("#modeSw"); pg2.wait_for_timeout(300)
    ok("切換測試資料：顯示測試橫幅", pg2.locator(".testbar").count() == 1, None); shot2("A08_test_home")
    pg2.goto(U + "#item-scallion"); pg2.wait_for_timeout(300); shot2("A09_test_flag_detail")
    ok("高價只標記：詳情提示第三市場待確認", "第三市場 的報價高於當日中位數 3 倍" in pg2.locator("#app").inner_text(), None)
    pg2.goto(U + "#compare-scallion"); pg2.wait_for_timeout(300); shot2("A10_test_flag_compare")
    rows = pg2.locator(".mrow").all_inner_texts()
    ok("高價只標記：比價仍列出第三市場並標待確認", any("第三市場" in r and "待確認" in r for r in rows) and len(rows) == 8, [r.replace("\n"," ") for r in rows if "第三" in r])
    b.close()
srv.terminate()
for k, v in res.items(): print(v[0], k, "" if v[0] == "PASS" else v[1])
print("ERRORS:", errs)
