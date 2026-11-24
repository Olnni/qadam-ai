"""
Проверка сайта в настоящем браузере (Playwright + Chromium).

Что проверяем:
  • нет ошибок в консоли браузера;
  • демо-пациенты, светофор и пример s61520_16;
  • карточка пациента → мастер «Новая запись» для входов В (лаборатория), Б (датчики), Г (демо);
  • неправильные файлы дают понятную ошибку;
  • решение врача, история, прогресс, экспорт и импорт JSON;
  • все тексты переведены на казахский (нет «сырых» ключей);
  • телефон 390 px: нет горизонтальной прокрутки.

Запуск: python tests/test_site.py   (скриншоты — в папку из аргумента или tests/screens)
"""
import functools, http.server, json, os, re, socketserver, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "tests", "screens")
EX = os.path.join(ROOT, "examples")
os.makedirs(SHOTS, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass
Handler = functools.partial(Quiet, directory=ROOT)
class Srv(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    request_queue_size = 64   # сайт грузит много файлов сразу
srv = Srv(("127.0.0.1", 0), Handler)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{PORT}/index.html"

results = []
def check(name, cond, info=""):
    results.append(bool(cond))
    print(f"  {'OK    ' if cond else 'ОШИБКА'} {name}{' — ' + str(info) if info != '' else ''}")

RAW_KEY = re.compile(r"\b[a-z]+_[A-Za-z0-9_]+\b")
ALLOWED = {"aSagP_pct_GC_0", "test_gait", "pct_GC_"}  # в текстах есть имена колонок/файлов
def raw_keys(page):
    """Ищем на странице видимый текст, похожий на непереведённый ключ (например, «lg_steps»)."""
    keys = page.evaluate("Object.keys(I18N.ru)")
    text = page.evaluate("document.body.innerText")
    return sorted({k for k in keys if re.search(r"(?<![\w.])" + re.escape(k) + r"(?![\w.])", text)})

with sync_playwright() as pw:
    br = pw.chromium.launch()
    ctx = br.new_context(viewport={"width": 1366, "height": 900}, accept_downloads=True)
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    print("\n1. Загрузка и демо-пациенты")
    page.goto(URL); page.wait_for_selector("#plist li")
    check("29 демо-пациентов в списке", page.locator("#plist li").count() == 29)
    check("16 с предупреждениями", "16" in page.inner_text("#warnCount"), page.inner_text("#warnCount"))
    pill_ok = lambda pg: pg.evaluate("(() => { const p = document.querySelector('#warnCount').getBoundingClientRect(), s = document.querySelector('.side').getBoundingClientRect(); return p.right <= s.right - 4; })()")
    check("пилюля «с предупреждениями» не вылезает за край панели", pill_ok(page))
    check("s61520_16: жёлтый светофор", "yellow" in page.get_attribute("#light", "class"))
    finds = page.inner_text("#finds")
    check("s61520_16: бедро лучше на 5.6°, таз +6.4, перенос ноги", "5.6" in finds and "6.4" in finds and "62–100" in finds)
    check("анимация нарисована", page.locator("#anim line").count() > 10)
    page.screenshot(path=os.path.join(SHOTS, "01_demo.png"), full_page=True)

    print("\n2. Карточка пациента")
    page.click("#btnNewPatient")
    page.fill("#cCode", "Иван Петров"); page.click("#btnCardSave")
    check("имя вместо кода — понятная ошибка", "латинские" in page.inner_text("#errCard"))
    page.fill("#cCode", "T-001"); page.fill("#cAge", "300"); page.click("#btnCardSave")
    check("возраст 300 — понятная ошибка", "от 1 до 25" in page.inner_text("#errCard"), page.inner_text("#errCard"))
    page.fill("#cAge", "9"); page.fill("#cWeight", "28.5"); page.fill("#cHeight", "1.32"); page.fill("#cLeg", "0.68")
    page.select_option("#cSide", "RIGHT"); page.fill("#cNotes", "тест")
    page.click("#btnCardSave")
    check("пациент сохранён и открыт мастер", page.is_visible("#wizard") and "T-001" in page.inner_text("#myList"))

    def run_wizard(src, before=None, after=None, hz=None, hint="Verbal", text=""):
        if not page.is_visible("#wizard"):
            page.click("#btnNewRec")
        page.check(f'input[name="src"][value="{src}"]', force=True)
        if before: page.set_input_files("#fB", before)
        if after: page.set_input_files("#fA", after)
        if hz:
            page.fill("#hzB", str(hz)); page.fill("#hzA", str(hz))
        if src != "demo": page.select_option("#hintSel", hint)
        page.fill("#hintText", text)
        page.click("#btnRun")
        page.wait_for_function("!document.querySelector('#btnRun').disabled")

    print("\n3. Вход В — файл лаборатории")
    run_wizard("lab", os.path.join(EX, "lab_before_s61520_16.csv"), os.path.join(EX, "lab_after_verbal_s61520_16.csv"), text="выпрями ногу")
    check("результат показан", page.is_visible("#result"))
    log = page.inner_text("#aiRun")
    check("«ИИ проанализировал N шагов до и N после»", re.search(r"\d+ .* \d+", log) is not None, log)
    check("текст подсказки виден", "выпрями ногу" in page.inner_text("#aiRunSub"))
    page.check('input[name="dec"][value="dec_change"]', force=True); page.fill("#note", "учесть таз")
    page.click("#btnSave")
    check("решение врача сохранено в историю", "учесть таз" in page.inner_text("#history"))

    print("\n4. Вход Б — датчики (синтетика)")
    run_wizard("imu", os.path.join(EX, "sensors_before_SYNTHETIC.csv"), os.path.join(EX, "sensors_after_verbal_SYNTHETIC.csv"), hint="VR")
    check("результат по датчикам показан", page.is_visible("#result") and page.inner_text("#errRun") == "", page.inner_text("#errRun"))
    check("график «найденные шаги» показан", page.locator("#traces svg").count() == 2)
    tbl = page.inner_text("#numTbl")
    check("датчики: GVS суставов считается по норме (метка «по норме»), GPS — ИИ", tbl.count("по норме") == 4 and "ИИ" in tbl)
    sub = page.inner_text("#aiRunSub")
    check("подпись «экспериментально»", "экспериментально" in sub, sub)
    page.screenshot(path=os.path.join(SHOTS, "02_imu_result.png"), full_page=True)

    print("\n5. Вход Г — демо-пациент")
    run_wizard("demo")
    check("результат по демо-данным", page.is_visible("#result"))
    check("в истории 3 сеанса", page.locator("#history > li").count() == 3)
    check("прогресс по сеансам нарисован", page.is_visible("#progress") and page.locator("#progChart circle").count() >= 6)
    page.click('#progMetric [data-m="GVS_aSagK"]')
    check("переключение показателя прогресса", "on" in page.get_attribute('#progMetric [data-m="GVS_aSagK"]', "class"))

    print("\n6. Неправильные файлы дают понятную ошибку")
    def bad(src, f, expect):
        page.click("#btnNewRec")
        run_wizard(src, f, f)
        msg = page.inner_text("#errRun")
        check(f"{src} ← {os.path.basename(f)}", expect in msg, msg)
        page.click("#btnWzCancel")
    bad("lab", os.path.join(EX, "wrong_file.csv"), "не файл лаборатории")
    bad("lab", os.path.join(EX, "sensors_before_SYNTHETIC.csv"), "файл датчиков")
    bad("imu", os.path.join(EX, "wrong_file.csv"), "Не найдены колонки")
    bad("imu", os.path.join(EX, "lab_before_s61520_16.csv"), "Не найдены колонки")
    page.click("#btnNewRec"); page.check('input[name="src"][value="lab"]', force=True); page.click("#btnRun")
    check("без файла — просьба выбрать файл", "Выберите файл" in page.inner_text("#errRun"))
    page.click("#btnWzCancel")

    print("\n7. Экспорт и импорт JSON")
    page.click("#btnCard")
    with page.expect_download() as dl:
        page.click("#btnExport")
    path = os.path.join(SHOTS, "export.json"); dl.value.save_as(path)
    data = json.load(open(path, encoding="utf-8"))
    check("в экспорте пациент и 3 сеанса", "T-001" in data["patients"] and len(data["sessions"]["T-001"]) == 3)
    page.evaluate("localStorage.clear()"); page.reload(); page.wait_for_selector("#plist li")
    check("после очистки пациентов нет", "T-001" not in page.inner_text("#myList"))
    page.click("#btnNewPatient")
    page.set_input_files("#fileImport", path)
    page.wait_for_function("document.querySelector('#ioMsg').textContent.length > 0")
    check("импорт вернул пациента", "T-001" in page.inner_text("#myList"), page.inner_text("#ioMsg"))
    page.click("#btnCardCancel")
    page.click('#myList [data-pid="my:T-001"]')
    check("история после импорта сохранилась", "учесть таз" in page.inner_text("#history"))

    print("\n8. Страница «Модель ИИ»")
    page.click('a[data-view="model"]')
    check("таблицы точности (4 сустава и без таза)", page.locator("#valTbl tr").count() == 6 and page.locator("#valTblNoP tr").count() == 6)
    check("итоги 18 и 11 из 29 для голоса", "18 / 29" in page.inner_text("#cohortTbl") and "11 / 29" in page.inner_text("#cohortTbl"))
    page.click("#btnSegCheck")
    check("живая проверка разбиения на шаги работает", page.locator("#segOut li").count() >= 5, page.inner_text("#segOut")[:120])
    page.fill("#thHip", "4")
    check("пороги меняют результаты", "18 / 29" not in page.inner_text("#cohortTbl"))
    page.click("#btnThReset")
    check("норма: таблица 4 сустава + проверка здравого смысла", page.locator("#normTbl tr").count() == 5 and "60.5" in page.inner_text("#normCheck"))
    check("компенсация: таблица таз/колено/стопа", page.locator("#compTbl tr").count() == 4 and "3.01" in page.inner_text("#compTbl"))
    check("вариабельность: таз (голос) 20/29, стопа (голос) 21/29", "20 / 29" in page.inner_text("#varTbl") and "21 / 29" in page.inner_text("#varTbl"))
    page.screenshot(path=os.path.join(SHOTS, "03_model.png"), full_page=True)

    print("\n8б. Цифровой двойник")
    page.click('a[data-view="patients"]'); page.click('#plist [data-pid="demo:s61520_16"]')
    check("стабильность шагов на экране результата", "нестабильнее" in page.inner_text("#varBox") or "стабильн" in page.inner_text("#varBox"), page.inner_text("#varBox")[-120:])
    page.click('#sessions [data-sid="__twin"]')
    check("вкладка «Цифровой двойник» открыта", page.is_visible("#twin") and not page.is_visible("#result"))
    nums = lambda: [r.locator("td").all_inner_texts() for r in page.locator("#twNums tr").all()[1:]]
    check("было = стало при нулевых ползунках", all(r[1] == r[2] for r in nums()), nums()[0])
    slide = lambda sid, v: page.evaluate("([id, v]) => { const e = document.querySelector(`[data-sl='${id}']`); e.value = v; e.dispatchEvent(new Event('input', {bubbles: true})); }", [sid, v])
    slide("hipExt", 10)
    n = nums()
    check("точный режим: бедро +10 меняет только бедро", n[1][1] != n[1][2] and n[0][1] == n[0][2] and n[2][1] == n[2][2] and n[3][1] == n[3][2], [r[:3] for r in n])
    check("4 графика с нормой", page.locator("#twCharts svg").count() == 4)
    page.click('#twMode label:has(input[value="comp"])')
    n2 = nums()
    check("режим компенсации: меняются и таз/колено/стопа", n2[0][2] != n[0][2] and n2[2][2] != n[2][2], [r[:3] for r in n2])
    check("подпись «точность умеренная»", "умеренная" in page.inner_text("#twModeNote") and "пунктир" in page.inner_text("#twModeNote"))
    check("пунктир на графиках компенсации", page.locator("#twCharts path[stroke-dasharray]").count() == 3)
    check("облако шагов нарисовано", page.locator("#twAnim polyline").count() >= 20)
    check("«что даст больше пользы»: топ-3", page.locator("#twTop li").count() == 3, page.inner_text("#twTop")[:100])
    page.locator("#twTop [data-apply]").first.click()
    check("кнопка «Показать» ставит ползунок", page.input_value("#twSliders input >> nth=0") != "0" or any(page.input_value(f"#twSliders input >> nth={i}") != "0" for i in range(5)))
    page.click("#twSave")
    check("цель терапии сохранена", "показатель" in page.inner_text("#twGoals"), page.inner_text("#twSaveMsg"))
    page.click('#sessions [data-sid="Verbal"]')
    check("цель видна в истории пациента", "Цель терапии" in page.inner_text("#history"))
    page.click('#myList [data-pid="my:T-001"]'); page.click('#sessions [data-sid="__twin"]')
    check("двойник работает на своей записи (выбор основы)", page.locator("#twBase option").count() == 6 and page.locator("#twNums tr").count() == 6)
    page.screenshot(path=os.path.join(SHOTS, "07_twin.png"), full_page=True)

    print("\n9. Казахский язык: нет непереведённых ключей")
    ru = set(page.evaluate("Object.keys(I18N.ru)")); kk = set(page.evaluate("Object.keys(I18N.kk)"))
    check("одинаковые ключи в ru и kk", ru == kk, f"нет в kk: {sorted(ru - kk)[:5]}, лишние: {sorted(kk - ru)[:5]}")
    page.click('.lang button[data-lang="kk"]')
    check("страница модели", not raw_keys(page), raw_keys(page))
    page.click('a[data-view="patients"]')
    for name, sel in [("демо-пациент", '#plist [data-pid="demo:s61520_16"]'), ("свой пациент", '#myList [data-pid="my:T-001"]')]:
        page.click(sel)
        check(f"экран результата ({name})", not raw_keys(page), raw_keys(page))
    page.click("#btnNewRec")
    for src in ["video", "imu", "lab", "demo"]:
        page.check(f'input[name="src"][value="{src}"]', force=True)
        check(f"мастер, источник {src}", not raw_keys(page), raw_keys(page))
    page.check('input[name="src"][value="lab"]', force=True); page.set_input_files("#fB", os.path.join(EX, "wrong_file.csv"))
    page.set_input_files("#fA", os.path.join(EX, "wrong_file.csv")); page.click("#btnRun")
    page.wait_for_function("document.querySelector('#errRun').textContent.length > 0")
    check("ошибка на казахском", "зертхана файлы емес" in page.inner_text("#errRun"), page.inner_text("#errRun"))
    page.click("#btnWzCancel")
    page.click('#sessions [data-sid="__twin"]')
    page.click('#twMode label:has(input[value="comp"])')
    check("цифровой двойник", not raw_keys(page), raw_keys(page))
    page.click("#btnCard")
    check("карточка пациента", not raw_keys(page), raw_keys(page))
    page.screenshot(path=os.path.join(SHOTS, "04_kk_card.png"), full_page=True)
    page.click("#btnCardCancel")
    page.click('.lang button[data-lang="ru"]')

    print("\n10. Телефон 390 px")
    m = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    mp = m.new_page()
    mp.on("pageerror", lambda e: errors.append(str(e)))
    mp.goto(URL); mp.wait_for_selector("#plist li")
    sw = lambda: mp.evaluate("document.documentElement.scrollWidth")
    check("пациенты: нет горизонтальной прокрутки", sw() <= 390, sw())
    rows = mp.evaluate("(() => { const l = document.querySelector('#plist'), b = l.querySelector('button'); return l.clientHeight / b.getBoundingClientRect().height; })()")
    check("телефон: в списке демо-пациентов видно ≥ 5 строк", rows >= 5, round(rows, 1))
    check("телефон: пилюля не вылезает за край", pill_ok(mp))
    mp.screenshot(path=os.path.join(SHOTS, "05_mobile_result.png"), full_page=True)
    mp.click("#btnNewPatient"); mp.fill("#cCode", "M-1"); mp.click("#btnCardSave")
    mp.click('label.src:has(input[value="video"])')
    check("мастер: выбор источника нажатием на карточку", mp.is_checked('input[name="src"][value="video"]'))
    check("мастер: нет горизонтальной прокрутки", sw() <= 390, sw())
    mp.screenshot(path=os.path.join(SHOTS, "06_mobile_wizard.png"), full_page=True)
    mp.goto(URL); mp.wait_for_selector("#plist li"); mp.click('#plist [data-pid="demo:s61520_16"]')
    mp.click('#sessions [data-sid="__twin"]')
    check("двойник: нет горизонтальной прокрутки", sw() <= 390, sw())
    mp.screenshot(path=os.path.join(SHOTS, "08_mobile_twin.png"), full_page=True)
    mp.goto(URL + "#model"); mp.wait_for_selector("#valTbl tr")
    check("модель ИИ: нет горизонтальной прокрутки", sw() <= 390, sw())
    m.close()

    print("\n11. Консоль браузера")
    real = [e for e in errors if "fonts.g" not in e]
    check("нет ошибок JavaScript", not real, real[:3])
    br.close()

srv.shutdown()
ok = all(results)
print(f"\nИТОГ: {sum(results)} из {len(results)} проверок пройдено —", "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" if ok else "ЕСТЬ ОШИБКИ")
sys.exit(0 if ok else 1)
