"""
Проверка входа А (видео → MediaPipe → углы → шаги → ИИ) в настоящем браузере.

  python tests/test_video.py                 — без своего видео: создаём в браузере 6-секундное
                                               видео с нарисованным человечком. Проверяем, что
                                               MediaPipe загружается, кадры обрабатываются, а
                                               результат или ошибка понятны (без сбоев).
  python tests/test_video.py walk.mp4        — ваше видео (сбоку, 10–20 шагов): прогоняется
  python tests/test_video.py before.mp4 after.mp4   весь путь, сохраняется скриншот со скелетом.

Нужен интернет (модель MediaPipe грузится с CDN).
ВАЖНО: тест проверяет, что программа работает. Точность углов по видео он НЕ проверяет —
для этого нужно сравнение с лабораторией.
"""
import base64, functools, http.server, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "screens"); os.makedirs(OUT, exist_ok=True)
videos = sys.argv[1:3]

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=ROOT))
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
    br = pw.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    page = br.new_page(viewport={"width": 1366, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
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
    if page.is_visible("#result"):
        page.screenshot(path=os.path.join(OUT, "video_result.png"), full_page=True)
        print("Результат:", page.inner_text("#light"), "| скриншот: tests/screens/video_result.png")
    print("Ошибки JavaScript:", errors or "нет")
    ok = loaded and not errors and (bool(err) or page.is_visible("#result"))
    print("\nИТОГ:", "ПРОГРАММА ОТРАБОТАЛА КОРРЕКТНО" if ok else "ЕСТЬ ПРОБЛЕМЫ")
    br.close()
srv.shutdown()
sys.exit(0 if ok else 1)
