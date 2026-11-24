// Qadam AI — ИИ-2: разбиение непрерывной записи на шаги (циклы шага).
// Работает и в браузере, и в Node.js (для тестов).
//
// Вход: непрерывные углы суставов по времени (датчики IMU или видео).
// Выход: шаги, каждый приведён к 51 точке (0, 2, … 100% шага) — как в датасете.
//
// Как находим начало шага (касание пяткой):
//  • датчики: минимумы угла бедра (максимальное разгибание) — самый устойчивый
//    момент шага. По датасету он бывает в среднем на hipMinPct ≈ 54% шага,
//    значит касание пяткой ≈ через (100 − 54)% интервала после минимума;
//  • видео: момент, когда стопа дальше всего впереди таза (метод Zeni, 2008).
(function (root) {
  const FS = 100; // приводим запись к 100 кадрам в секунду

  function err(code, params) { const e = new Error(code); e.code = code; e.params = params || {}; return e; }
  const median = (a) => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

  /* ---------- Чтение CSV датчиков ---------- */
  // Колонки: time (с), hip, knee, ankle, pelvis (необязательно). Без time нужна частота hz.
  function parseSensorCSV(text, hz) {
    const lines = String(text).replace(/^﻿/, "").replace(/\r/g, "").split("\n").filter((l) => l.trim());
    if (lines.length < 3) throw err("err_empty");
    const first = lines[0];
    const sep = first.includes(";") ? ";" : first.includes("\t") ? "\t" : ",";
    const head = first.split(sep).map((h) => h.trim().replace(/"/g, "").toLowerCase());
    const find = (names) => head.findIndex((h) => names.includes(h));
    const col = {
      time: find(["time", "t", "time_s", "timestamp", "sec", "seconds"]),
      hip: find(["hip", "hip_flexion", "hip_angle"]),
      knee: find(["knee", "knee_flexion", "knee_angle"]),
      ankle: find(["ankle", "ankle_dorsiflexion", "ankle_angle"]),
      pelvis: find(["pelvis", "pelvic_tilt", "pelvis_tilt"]),
    };
    const miss = ["hip", "knee", "ankle"].filter((k) => col[k] < 0);
    if (miss.length) throw err("err_imu_cols", { cols: miss.join(", ") });
    const num = (s) => {
      if (s === undefined) return NaN;
      s = String(s).trim().replace(/"/g, "");
      if (sep !== ",") s = s.replace(",", ".");
      return s === "" || /^nan$/i.test(s) ? NaN : Number(s);
    };
    const out = { t: [], hip: [], knee: [], ankle: [], pelvis: col.pelvis >= 0 ? [] : null };
    for (const line of lines.slice(1)) {
      const c = line.split(sep);
      out.hip.push(num(c[col.hip])); out.knee.push(num(c[col.knee])); out.ankle.push(num(c[col.ankle]));
      if (out.pelvis) out.pelvis.push(num(c[col.pelvis]));
      out.t.push(col.time >= 0 ? num(c[col.time]) : NaN);
    }
    const n = out.hip.length;
    if (col.time < 0) {
      if (!(hz > 0)) throw err("err_imu_hz");
      out.t = out.t.map((_, i) => i / hz);
    } else {
      if (out.t.some((v) => !Number.isFinite(v))) throw err("err_imu_time");
      let dt = median(out.t.slice(1).map((v, i) => v - out.t[i]));
      if (!(dt > 0)) throw err("err_imu_time");
      if (dt > 2) { out.t = out.t.map((v) => v / 1000); dt /= 1000; } // время в миллисекундах
    }
    // Немного пропусков (NaN) заполняем линейно; если много — ошибка
    for (const k of ["hip", "knee", "ankle", "pelvis"]) {
      if (!out[k]) continue;
      const bad = out[k].filter((v) => !Number.isFinite(v)).length;
      if (bad > 0.1 * n) {
        if (k === "pelvis") { out.pelvis = null; continue; }
        throw err("err_imu_nan", { col: k });
      }
      out[k] = fillGaps(out[k]);
    }
    const dur = out.t[n - 1] - out.t[0];
    if (!(dur >= 3)) throw err("err_short", { s: Number.isFinite(dur) ? dur.toFixed(1) : "?" });
    out.hzDetected = Math.round((n - 1) / dur);
    return out;
  }

  function fillGaps(a) {
    const r = a.slice(), n = r.length;
    let last = -1;
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(r[i])) continue;
      if (last < 0) for (let k = 0; k < i; k++) r[k] = r[i];
      else for (let k = last + 1; k < i; k++) r[k] = r[last] + ((r[i] - r[last]) * (k - last)) / (i - last);
      last = i;
    }
    if (last < 0) return r;
    for (let k = last + 1; k < n; k++) r[k] = r[last];
    return r;
  }

  /* ---------- Вспомогательное ---------- */
  // Значение массива y (заданного во времена t, по возрастанию) в момент tq — линейно
  function interp(t, y, tq) {
    let lo = 0, hi = t.length - 1;
    if (tq <= t[0]) return y[0];
    if (tq >= t[hi]) return y[hi];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= tq) lo = m; else hi = m; }
    const f = (tq - t[lo]) / (t[hi] - t[lo]);
    return y[lo] + f * (y[hi] - y[lo]);
  }
  function resample(t, y, t0, n) { const out = new Array(n); for (let i = 0; i < n; i++) out[i] = interp(t, y, t0 + i / FS); return out; }
  function smooth(a, w) {
    if (w < 2) return a.slice();
    const h = Math.floor(w / 2), out = new Array(a.length);
    for (let i = 0; i < a.length; i++) {
      let s = 0, c = 0;
      for (let k = Math.max(0, i - h); k <= Math.min(a.length - 1, i + h); k++) { s += a[k]; c++; }
      out[i] = s / c;
    }
    return out;
  }
  // Длительность шага: лаг с наибольшей автокорреляцией в пределах 0.4–3 с
  function estimatePeriod(s) {
    const n = s.length, m = s.reduce((a, b) => a + b, 0) / n, x = s.map((v) => v - m);
    const minLag = Math.round(0.4 * FS), maxLag = Math.min(Math.round(3 * FS), Math.floor(n / 2));
    if (maxLag <= minLag) return null;
    const ac = [];
    for (let lag = 0; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i + lag < n; i++) sum += x[i] * x[i + lag];
      ac.push(sum / (n - lag));
    }
    const peaks = [];
    for (let l = minLag; l < maxLag; l++) if (ac[l] > ac[l - 1] && ac[l] >= ac[l + 1] && ac[l] > 0) peaks.push(l);
    if (!peaks.length) return null;
    const best = Math.max(...peaks.map((l) => ac[l]));
    const first = peaks.find((l) => ac[l] >= 0.8 * best); // первый сильный пик, а не двойной период
    // Ритм должен быть чётким: иначе это не ходьба (шум, человек стоит и т.п.)
    // (на настоящих шагах датасета это отношение ≥ 0.67, у шума — меньше)
    if (ac[first] < 0.5 * ac[0]) return null;
    return first / FS;
  }
  // Локальные максимумы: точка — наибольшая в окне ± half
  function peaks(s, half) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let ok = true;
      for (let k = Math.max(0, i - half); k <= Math.min(s.length - 1, i + half); k++) {
        if (s[k] > s[i] || (s[k] === s[i] && k < i)) { ok = false; break; }
      }
      if (ok && i > 0 && i < s.length - 1) out.push(i);
    }
    return out;
  }

  /* ---------- Главное: запись → шаги ---------- */
  // sig = { t, hip, knee, ankle, pelvis|null, trunk|null, foot|null }
  // foot — «насколько стопа впереди таза» (для видео), тогда используется метод Zeni.
  function segment(sig, opts = {}) {
    const hipMinPct = opts.hipMinPct ?? 54.4;
    // Стопа дальше всего впереди таза в среднем на 98% шага (проверено на шагах
    // датасета через модель «человечка», tests/synth.js) — почти в момент касания.
    const footPeakPct = opts.footPeakPct ?? 98;
    const t = sig.t, n0 = t.length;
    const T0 = t[0], dur = t[n0 - 1] - T0;
    if (!(dur >= 3)) throw err("err_short", { s: Number.isFinite(dur) ? dur.toFixed(1) : "?" });
    const n = Math.floor(dur * FS) + 1;
    const R = {};
    for (const k of ["hip", "knee", "ankle", "pelvis", "trunk", "foot"]) if (sig[k]) R[k] = resample(t, sig[k], T0, n);
    const method = R.foot ? "foot" : "hip";
    const base = method === "foot" ? R.foot : R.hip.map((v) => -v); // ищем максимумы
    const s = smooth(base, Math.round(0.06 * FS));
    // При ходьбе бедро двигается минимум на 10° (в датасете размах ≥ 32°)
    const hs0 = smooth(R.hip, Math.round(0.06 * FS));
    const rom = Math.max(...hs0) - Math.min(...hs0);
    if (!(rom >= 10)) throw err("err_no_rhythm");
    const period = estimatePeriod(s);
    if (!period) throw err("err_no_rhythm");
    const pk = peaks(s, Math.round(0.45 * period * FS));
    // Моменты касания пяткой (в секундах от начала).
    // Найденная точка бывает на peakPct% шага, значит касание — через (100 − peakPct)% интервала.
    const peakPct = method === "foot" ? footPeakPct : hipMinPct;
    const f = 1 - peakPct / 100;
    const hs = [];
    for (let k = 0; k + 1 < pk.length; k++) hs.push((pk[k] + f * (pk[k + 1] - pk[k])) / FS);
    const cycles = [];
    for (let k = 0; k + 1 < hs.length; k++) cycles.push({ start: hs[k], end: hs[k + 1], d: hs[k + 1] - hs[k] });
    if (cycles.length < 3) throw err("err_few_steps", { n: cycles.length });
    const med = median(cycles.map((c) => c.d));
    const tg = Array.from({ length: n }, (_, i) => i / FS);
    const steps = [];
    let dropped = 0;
    for (const c of cycles) {
      c.kept = c.d >= 0.75 * med && c.d <= 1.25 * med;
      if (!c.kept) { dropped++; continue; }
      const at = (arr) => Array.from({ length: 51 }, (_, p) => interp(tg, arr, c.start + (p / 50) * c.d));
      const P = R.pelvis ? at(R.pelvis) : new Array(51).fill(0);
      steps.push([].concat(P, at(R.hip), at(R.knee), at(R.ankle)));
      if (R.trunk) (c.trunk = at(R.trunk));
    }
    if (steps.length < 3) throw err("err_few_steps", { n: steps.length });
    const trunkCycles = cycles.filter((c) => c.kept && c.trunk).map((c) => c.trunk);
    return {
      steps, cycles, dropped, period, method,
      nFrames: n0, fs: FS, duration: dur, pelvis: !!R.pelvis,
      trunk: trunkCycles.length ? trunkCycles[0].map((_, p) => trunkCycles.reduce((a, c) => a + c[p], 0) / trunkCycles.length) : null,
      // для графика «найденные шаги»: угол бедра по времени (раз в 2 кадра — легче рисовать)
      trace: { t: tg.filter((_, i) => i % 2 === 0).map((v) => v + T0), hip: R.hip.filter((_, i) => i % 2 === 0), hs: hs.map((v) => v + T0), T0 },
    };
  }

  const api = { parseSensorCSV, segment, interp, smooth, estimatePeriod, fillGaps, FS };
  root.QGait = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
