// Синтетические записи для тестов — склеены из настоящих шагов датасета.
// Это НЕ настоящие датчики и НЕ настоящее видео: только проверка программы.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }

// Шаги (204 числа) → непрерывная запись с частотой hz. Возвращает и истинные начала шагов.
function continuous(steps, { hz = 60, seed = 1, noise = 0.3, dmin = 0.9, dmax = 1.25 } = {}) {
  const r = rng(seed);
  const knotsT = [], knots = { P: [], H: [], K: [], A: [] }, starts = [];
  let t0 = 0;
  for (const x of steps) {
    const d = dmin + (dmax - dmin) * r();
    starts.push({ t: t0, d });
    for (let p = 0; p < 50; p++) {
      knotsT.push(t0 + (p / 50) * d);
      ["P", "H", "K", "A"].forEach((j, ji) => knots[j].push(x[ji * 51 + p]));
    }
    t0 += d;
  }
  const last = steps[steps.length - 1];
  knotsT.push(t0); ["P", "H", "K", "A"].forEach((j, ji) => knots[j].push(last[ji * 51 + 50]));
  const { interp } = require("../js/gait.js");
  const n = Math.floor(t0 * hz);
  const out = { t: [], pelvis: [], hip: [], knee: [], ankle: [] };
  for (let i = 0; i < n; i++) {
    const t = i / hz;
    out.t.push(t);
    out.pelvis.push(interp(knotsT, knots.P, t) + noise * gauss(r));
    out.hip.push(interp(knotsT, knots.H, t) + noise * gauss(r));
    out.knee.push(interp(knotsT, knots.K, t) + noise * gauss(r));
    out.ankle.push(interp(knotsT, knots.A, t) + noise * gauss(r));
  }
  return { sig: out, starts, knotsT, knots };
}

// Поза одного кадра (вид сбоку) по углам: как «человечек» в анимации.
// trunk = наклон корпуса; бедро от вертикали = H − trunk.
const rad = (d) => (d * Math.PI) / 180;
function bodyPoints(P, H, K, A, { W = 640, Hh = 480, bob = 0 } = {}) {
  const L = 0.22 * Hh, Lf = 0.09 * Hh, Lt = 0.28 * Hh;
  const hip = { x: W / 2, y: 0.42 * Hh + bob };
  const th = rad(H - P), sh = rad(H - P - K), ft = sh + rad(90 + A);
  const knee = { x: hip.x + L * Math.sin(th), y: hip.y + L * Math.cos(th) };
  const ankle = { x: knee.x + L * Math.sin(sh), y: knee.y + L * Math.cos(sh) };
  const heel = { x: ankle.x - 0.25 * Lf * Math.sin(ft), y: ankle.y - 0.25 * Lf * Math.cos(ft) };
  const toe = { x: ankle.x + 0.75 * Lf * Math.sin(ft), y: ankle.y + 0.75 * Lf * Math.cos(ft) };
  const sh2 = { x: hip.x + Lt * Math.sin(rad(P)), y: hip.y - Lt * Math.cos(rad(P)) };
  return { sh: sh2, hip, knee, ankle, heel, toe };
}

// Запись → кадры «как от MediaPipe» (доли кадра, видимость).
function landmarkFrames(rec, { fps = 30, W = 640, Hh = 480, dir = 1, px = 1.0, seed = 2 } = {}) {
  const r = rng(seed);
  const { interp } = require("../js/gait.js");
  const T = rec.knotsT[rec.knotsT.length - 1];
  const IDX = { sh: 11, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 };
  const IDXR = { sh: 12, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 };
  const frames = [];
  for (let t = 0; t < T; t += 1 / fps) {
    const g = (j) => interp(rec.knotsT, rec.knots[j], t);
    const b = bodyPoints(g("P"), g("H"), g("K"), g("A"), { W, Hh, bob: 4 * Math.sin(t * 12) });
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
    for (const k in IDX) {
      const x = dir > 0 ? b[k].x : W - b[k].x;
      lm[IDX[k]] = { x: (x + px * gauss(r)) / W, y: (b[k].y + px * gauss(r)) / Hh, visibility: 0.95 };
      lm[IDXR[k]] = { x: (x + 8) / W, y: b[k].y / Hh, visibility: 0.6 }; // дальняя нога видна хуже
    }
    frames.push({ t, lm });
  }
  return frames;
}

module.exports = { rng, gauss, continuous, bodyPoints, landmarkFrames };
