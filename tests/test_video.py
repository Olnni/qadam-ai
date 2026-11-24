"""
Проверка входа А (видео → MediaPipe → углы → шаги → ИИ) в настоящем браузере.

  python tests/test_video.py                 — без своего видео: создаём в браузере 6-секундное
                                               видео с нарисованным человечком. Проверяем, что
                                               MediaPipe загружается, кадры обрабатываются, а
                                               результат или ошибка понятны (без сбоев).
  python tests/test_video.py walk.mp4        — ваше видео (сбоку, 10–20 шагов): прогоняется
  python tests/test_video.py before.mp4 after.mp4   весь путь, сохраняется скриншот со скелетом.
  Видео с iPhone (.MOV, HEVC): добавьте --chrome, чтобы открыть их в Google Chrome.

Нужен интернет (модель MediaPipe грузится с CDN).
ВАЖНО: тест проверяет, что программа работает. Точность углов по видео он НЕ проверяет —
для этого нужно сравнение с лабораторией.
"""
import base64, functools, http.server, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "screens"); os.makedirs(OUT, exist_ok=True)
args = [a for a in sys.argv[1:] if not a.startswith("--")]
videos = args[0:2]
# Видео с iPhone (HEVC/H.265) тестовый Chromium не открывает — используйте --chrome (ваш Google Chrome)
CHANNEL = "chrome" if "--chrome" in sys.argv else ("msedge" if "--edge" in sys.argv else None)
SHOT = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--shot=")), "video_result.png")

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
class Srv(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    request_queue_size = 64   # сайт грузит много файлов сразу
srv = Srv(("127.0.0.1", 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}/index.html"

MAKE_VIDEO = """async () => {
  // Нарисованный человечек идёт на месте 6 секунд (углы — из демо-пациента)
  const c = document.createElement('canvas'); c.width = 480; c.height = 360;
  const g = c.getContext('2d'); const rec = new MediaRecorder(c.captureStream(30), {mimeType: 'video/webm'});
  const parts = []; rec.ondataavailable = e => parts.push(e.data);
  const x = QADAM_DATA.patients.s61520_16.rec.Baseline[0]; const r = d => d*Math.PI/180;
  rec.start(); const t0 = performance.now();
  await new Promise(done => { const draw = () => {
    const t = (performance.now() - t0) / 1000, i = Math.floor((t % 1) * 50);
    g.fillStyle = '#ddd'; g.fillRect(0, 0, 480, 360); g.strokeStyle = '#333'; g.lineWidth = 14; g.lineCap = 'round';
    const leg = (k) => { const th = r(x[51+k]-x[k]), sh = th - r(x[102+k]);
      const kx = 240+80*Math.sin(th), ky = 170+80*Math.cos(th), ax = kx+80*Math.sin(sh), ay = ky+80*Math.cos(sh);
      g.beginPath(); g.moveTo(240,170); g.lineTo(kx,ky); g.lineTo(ax,ay); g.lineTo(ax+30,ay); g.stroke(); };
    leg(i); leg((i+25)%50);
    g.beginPath(); g.moveTo(240,170); g.lineTo(240,60); g.stroke(); g.beginPath(); g.arc(240,40,22,0,7); g.fillStyle='#333'; g.fill();
    if (t < 6) requestAnimationFrame(draw); else { rec.stop(); }
  }; rec.onstop = done; draw(); });
  const b = new Blob(parts, {type: 'video/webm'}); const buf = new Uint8Array(await b.arrayBuffer());
  let s = ''; for (let k = 0; k < buf.length; k++) s += String.fromCharCode(buf[k]); return btoa(s);
}"""

with sync_playwright() as pw:
    br = pw.chromium.launch(channel=CHANNEL, args=["--autoplay-policy=no-user-gesture-required"])
    page = br.new_page(viewport={"width": 1366, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(e.stack or str(e)))
    page.goto(URL); page.wait_for_selector("#plist li")
    page.click("#btnNewPatient"); page.fill("#cCode", "VIDEO-TEST"); page.click("#btnCardSave")
    page.click('label.src:has(input[value="video"])')
    if videos:
        page.set_input_files("#fB", videos[0]); page.set_input_files("#fA", videos[-1])
        print("Видео:", videos)
    else:
        data = base64.b64decode(page.evaluate(MAKE_VIDEO))
        f = {"name": "stick_figure.webm", "mimeType": "video/webm", "buffer": data}
        page.set_input_files("#fB", f); page.set_input_files("#fA", f)
        print(f"Создано тестовое видео с нарисованным человечком: {len(data)//1024} КБ")
    page.click("#btnRun")
    page.wait_for_function("!document.querySelector('#btnRun').disabled", timeout=600000)
    print("\nЖурнал анализа на сайте:")
    for li in page.locator("#runLog li").all_inner_texts(): print("  ", li)
    err = page.inner_text("#errRun")
    log = page.inner_text("#runLog")
    loaded = "MediaPipe" in log and ("готово" in log)
    print("\nMediaPipe загрузился:", "да" if loaded else "НЕТ")
    if err: print("Сообщение для пользователя:", err)
    res_ok = page.is_visible("#result")
    if res_ok:
        page.wait_for_timeout(1500)
        page.screenshot(path=os.path.join(OUT, SHOT), full_page=True)
        print("Светофор:", page.inner_text("#light"))
        print("\nТаблица (до → после):")
        for row in page.locator("#numTbl tr").all()[1:]:
            c = row.locator("td").all_inner_texts()
            if len(c) < 6: print(f"   {c[0].splitlines()[0]:42s} {c[-1]}"); continue
            print(f"   {c[0].splitlines()[0]:42s} {c[2]:>12s} → {c[3]:>12s}   {c[4]}  ({c[5]})")
        print("\nВыводы ИИ:")
        for li in page.locator("#finds li").all_inner_texts(): print("   •", li.replace("\n", " "))
        print("\nСкриншот: tests/screens/" + SHOT)
        # Цифровой двойник на записи с видео: таза нет → предупреждение, компенсация выключена
        page.click('#sessions [data-sid="__twin"]')
        warn = page.is_visible("#twWarn"); comp_off = page.is_disabled('input[name="twm"][value="comp"]')
        page.evaluate("() => { const e = document.querySelector(\"[data-sl='kneeSwing']\"); e.value = 10; e.dispatchEvent(new Event('input', {bubbles: true})); }")
        rows = [r.locator("td").all_inner_texts() for r in page.locator("#twNums tr").all()[1:]]
        print("\nЦифровой двойник на видео:", "предупреждение показано" if warn else "НЕТ предупреждения",
              "| компенсация выключена" if comp_off else "| компенсация НЕ выключена")
        for r in rows: print("   ", " | ".join(r))
        twin_ok = warn and comp_off and "не измерено" in rows[0][1]
    print("Ошибки JavaScript:", errors or "нет")
    twin_ok = locals().get("twin_ok", True)
    ok = loaded and not errors and twin_ok and (bool(err) or res_ok)
    print("\nИТОГ:", "ПРОГРАММА ОТРАБОТАЛА КОРРЕКТНО" if ok else "ЕСТЬ ПРОБЛЕМЫ")
    br.close()
srv.shutdown()
sys.exit(0 if ok else 1)
