// Qadam AI — ИИ-1: распознавание позы на видео (MediaPipe Pose Landmarker, Google).
// Модель предобучена Google; мы её не обучали. Работает в браузере, модель
// загружается с CDN (нужен интернет). Видео никуда не отправляется.
//
// Математика углов (вид сбоку, y вниз, «вперёд» = направление ходьбы):
//   корпус  = наклон линии бедро→плечо от вертикали (вперёд +)
//   бедро   = угол бедра от вертикали + наклон корпуса (бедро относительно корпуса)
//   колено  = бедро(от вертикали) − голень(от вертикали)   (= 180° − внутренний угол)
//   стопа   = стопа(пятка→носок) − голень − 90°             (тыльное сгибание +)
// ВАЖНО: в лаборатории бедро измеряется относительно ТАЗА, а здесь — относительно
// корпуса. Таз по 2D-видео надёжно не измерить. Точность углов по видео
// с лабораторией не сверялась.
(function (root) {
  const VERSION = "0.10.21";
  const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
  const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";
  const IDX = {
    LEFT: { sh: 11, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 },
    RIGHT: { sh: 12, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 },
  };
  const LEG = ["hip", "knee", "ankle", "heel", "toe"];
  const deg = (r) => (r * 180) / Math.PI;
  function err(code, params) { const e = new Error(code); e.code = code; e.params = params || {}; return e; }
  const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

  /* ---------- Чистая математика (проверяется тестом) ---------- */
  // Какая нога ближе к камере: у неё точки видны лучше
  function chooseSide(frames) {
    const vis = (side) => {
      let s = 0, c = 0;
      for (const f of frames) if (f.lm) for (const k of LEG) { s += f.lm[IDX[side][k]].visibility ?? 1; c++; }
      return c ? s / c : 0;
    };
    return vis("LEFT") >= vis("RIGHT") ? "LEFT" : "RIGHT";
  }

  // Углы по точкам скелета. frames: [{ t, lm: [33 точки {x, y, visibility}] | null }],
  // x, y — доли ширины и высоты кадра (так отдаёт MediaPipe).
  function anglesFromLandmarks(frames, opts) {
    const { width, height } = opts;
    const side = opts.side || chooseSide(frames);
    const I = IDX[side];
    const minVis = opts.minVis ?? 0.5;
    const P = (lm, k) => ({ x: lm[I[k]].x * width, y: lm[I[k]].y * height, v: lm[I[k]].visibility ?? 1 });
    // Направление ходьбы: носок впереди пятки
    const dir = Math.sign(median(frames.filter((f) => f.lm).map((f) => f.lm[I.toe].x - f.lm[I.heel].x))) || 1;
    const out = { t: [], hip: [], knee: [], ankle: [], trunk: [], foot: [], side, dir, valid: 0 };
    for (const f of frames) {
      out.t.push(f.t);
      const ok = f.lm && ["sh"].concat(LEG).every((k) => P(f.lm, k).v >= minVis);
      if (!ok) { for (const k of ["hip", "knee", "ankle", "trunk", "foot"]) out[k].push(NaN); continue; }
      out.valid++;
      const p = {};
      for (const k of ["sh"].concat(LEG)) { const q = P(f.lm, k); p[k] = { x: q.x * dir, y: q.y }; }
      const fromDown = (a, b) => deg(Math.atan2(b.x - a.x, b.y - a.y));  // от вертикали вниз, вперёд +
      const trunk = deg(Math.atan2(p.sh.x - p.hip.x, p.hip.y - p.sh.y));  // от вертикали вверх, вперёд +
      const thigh = fromDown(p.hip, p.knee), shank = fromDown(p.knee, p.ankle), foot = fromDown(p.heel, p.toe);
      out.trunk.push(trunk);
      out.hip.push(thigh + trunk);
      out.knee.push(thigh - shank);
      out.ankle.push(foot - shank - 90);
      out.foot.push(((p.heel.x + p.toe.x) / 2 - p.hip.x) / height); // насколько стопа впереди таза
    }
    out.validShare = frames.length ? out.valid / frames.length : 0;
    return out;
  }

  // Сглаживание фильтром Савицкого–Голея (окно 7, полином 2) после заполнения пропусков
  const SG7 = [-2, 3, 6, 7, 6, 3, -2].map((v) => v / 21);
  function savgol(a) {
    const n = a.length, out = a.slice();
    for (let i = 3; i < n - 3; i++) { let s = 0; for (let k = -3; k <= 3; k++) s += SG7[k + 3] * a[i + k]; out[i] = s; }
    return out;
  }
  // Готовим сигнал для gait.segment
  function toSignal(ang, fillGaps) {
    if (ang.validShare < 0.6) throw err("err_pose_few", { pct: Math.round(ang.validShare * 100) });
    const s = { t: ang.t, pelvis: null };
    for (const k of ["hip", "knee", "ankle", "trunk", "foot"]) s[k] = savgol(fillGaps(ang[k]));
    return s;
  }

  /* ---------- Браузер: MediaPipe ---------- */
  let landmarkerPromise = null;
  function loadLandmarker() {
    if (landmarkerPromise) return landmarkerPromise;
    landmarkerPromise = (async () => {
      let vision;
      try { vision = await import(`${CDN}/vision_bundle.mjs`); } catch (e) { throw err("err_mp_load"); }
      const fileset = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      const make = (delegate) => vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO", numPoses: 1,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      try { return await make("GPU"); } catch (e) { return await make("CPU"); }
    })();
    landmarkerPromise.catch(() => (landmarkerPromise = null));
    return landmarkerPromise;
  }

  // Проходим видео кадр за кадром (fps кадров в секунду) и находим позу.
  async function processVideo(file, { fps = 30, maxSec = 40, onProgress, canvas } = {}) {
    const lmk = await loadLandmarker();
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.preload = "auto"; video.src = url;
    await new Promise((ok, no) => { video.onloadeddata = ok; video.onerror = () => no(err("err_video")); });
    if (!video.videoWidth) throw err("err_video");
    const dur = Math.min(video.duration || 0, maxSec);
    if (!(dur >= 3)) throw err("err_short", { s: (video.duration || 0).toFixed(1) });
    const seek = (t) => new Promise((ok) => { video.onseeked = () => ok(); video.currentTime = t; });
    const frames = [];
    const total = Math.floor(dur * fps);
    const ctx = canvas ? canvas.getContext("2d") : null;
    if (canvas) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
    let found = 0;
    for (let i = 0; i < total; i++) {
      const t = 0.01 + i / fps;
      await seek(t);
      const r = lmk.detectForVideo(video, Math.round(t * 1000));
      const lm = r.landmarks && r.landmarks[0] ? r.landmarks[0].map((p) => ({ x: p.x, y: p.y, visibility: p.visibility })) : null;
      if (lm) found++;
      frames.push({ t, lm });
      if (ctx && i % 3 === 0) { ctx.drawImage(video, 0, 0); if (lm) drawSkeleton(ctx, lm, canvas.width, canvas.height, null); }
      if (onProgress && (i % 5 === 0 || i === total - 1)) { onProgress(i + 1, total, found); await new Promise((r2) => setTimeout(r2, 0)); }
    }
    return { frames, width: video.videoWidth, height: video.videoHeight, url, duration: dur, fullDuration: video.duration, fps };
  }

  // Скелет поверх видео: нога со стороны камеры — ярко, другая — бледно
  function drawSkeleton(ctx, lm, w, h, side) {
    const lines = [[11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32], [11, 13], [13, 15], [12, 14], [14, 16]];
    const near = side ? new Set(Object.values(IDX[side])) : null;
    const lw = Math.max(2, w / 250);
    for (const [a, b] of lines) {
      const on = !near || (near.has(a) && near.has(b));
      ctx.strokeStyle = on ? "#1d9e75" : "rgba(255,255,255,.55)";
      ctx.lineWidth = on ? lw * 1.6 : lw;
      ctx.beginPath(); ctx.moveTo(lm[a].x * w, lm[a].y * h); ctx.lineTo(lm[b].x * w, lm[b].y * h); ctx.stroke();
    }
    for (const i of near ? [...near] : [11, 12, 23, 24, 25, 26, 27, 28]) {
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(lm[i].x * w, lm[i].y * h, lw * 1.8, 0, 7); ctx.fill();
      ctx.strokeStyle = "#0f6e56"; ctx.lineWidth = lw * 0.8; ctx.stroke();
    }
  }

  const api = { IDX, chooseSide, anglesFromLandmarks, savgol, toSignal, loadLandmarker, processVideo, drawSkeleton, MODEL_URL, CDN };
  root.QPose = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
