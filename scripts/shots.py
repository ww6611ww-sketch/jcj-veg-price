import sys, json, subprocess, time
from playwright.sync_api import sync_playwright
root, out = sys.argv[1], sys.argv[2]
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8765", "-d", root], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errs = []
cases = [
 ("01_official_home", "official", "central", "#/"),
 ("02_test_home", "test", "central", "#/"),
 ("03_detail_cabbage", "test", "central", "#/item/cabbage"),
 ("04_detail_onion_nodata_today", "test", "central", "#/item/onion"),
 ("05_detail_luffa_gap", "test", "central", "#/item/luffa"),
 ("06_compare_cabbage", "test", "central", "#/compare/cabbage"),
 ("07_compare_threadfin_single", "test", "central", "#/compare/threadfin"),
 ("08_fav_empty", "test", "central", "#/fav"),
 ("09_east_home", "test", "east", "#/"),
 ("10_detail_whiteshrimp", "test", "north", "#/item/whiteshrimp"),
 ("11_detail_beef_none", "test", "central", "#/item/beefshank"),
 ("12_detail_hog", "test", "south", "#/item/livehog"),
]
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, mode, region, h in cases:
        ctx = b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, locale="zh-TW")
        ctx.add_init_script(f"localStorage.setItem('jcj.mode', JSON.stringify('{mode}'));localStorage.setItem('jcj.region', JSON.stringify('{region}'));")
        pg = ctx.new_page()
        pg.on("pageerror", lambda e, n=name: errs.append((n, str(e))))
        pg.on("console", lambda m, n=name: m.type=="error" and errs.append((n, m.text)))
        pg.goto(f"http://localhost:8765/{h}"); pg.wait_for_timeout(500)
        pg.screenshot(path=f"{out}/{name}.png", full_page=True)
        ctx.close()
    # 互動：選區記憶、單位切換、收藏、搜尋
    ctx = b.new_context(viewport={"width":390,"height":844}); pg = ctx.new_page()
    pg.add_init_script("localStorage.setItem('jcj.mode', JSON.stringify('test'))")
    pg.goto("http://localhost:8765/#/"); pg.wait_for_timeout(400)
    r = {}
    r["default_region"] = pg.locator("[data-region][aria-pressed=true]").inner_text()
    pg.click("[data-region=south]"); pg.reload(); pg.wait_for_timeout(400)
    r["remembered_region"] = pg.locator("[data-region][aria-pressed=true]").inner_text()
    pg.click("[data-region=central]")
    jin = pg.locator(".row .pill .num").first.inner_text()
    pg.click("[data-unit=kg]"); kg = pg.locator(".row .pill .num").first.inner_text(); r["first_row_jin_kg"] = (jin, kg)
    pg.click("[data-unit=jin]")
    pg.fill("#q", "蝦"); pg.wait_for_timeout(200); r["search_蝦"] = pg.locator(".row .name").all_inner_texts()
    pg.fill("#q", "披薩"); pg.wait_for_timeout(200); r["search_none"] = pg.locator(".empty h2").inner_text()
    pg.fill("#q", ""); pg.click("[data-cat=meat]"); r["meat_rows"] = pg.locator(".row .name").all_inner_texts()
    pg.goto("http://localhost:8765/#/item/cabbage"); pg.wait_for_timeout(300); pg.click("[data-act=fav]")
    pg.goto("http://localhost:8765/#/fav"); pg.wait_for_timeout(300); r["favs"] = pg.locator(".row .name").all_inner_texts()
    pg.screenshot(path=f"{out}/13_fav_with_item.png", full_page=True)
    pg.goto("http://localhost:8765/#/"); pg.wait_for_timeout(300); pg.click("[data-act=sources]"); pg.wait_for_timeout(200)
    pg.screenshot(path=f"{out}/14_sources_sheet.png")
    print(json.dumps(r, ensure_ascii=False, indent=1))
    b.close()
srv.terminate()
print("ERRORS:", errs)
