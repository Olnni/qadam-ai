// Qadam AI — ядро ИИ (ИИ-3 и ИИ-4) и статистика.
// Работает и в браузере, и в Node.js (для тестов): ничего не знает про страницу.
//
// ИИ-3: оценка одного шага = W · x + b, где x — 204 угла шага
//       (таз, бедро, колено, голеностоп × 51 точка), W и b — веса модели
//       PCA + Ridge, обученной в model/train.py.
// ИИ-4: объяснение — вклад участка шага в изменение оценки = W[k][i] × (после[i] − до[i]).
// Статистика и светофор — это правила, а не ИИ.
(function (root) {
  const JOINTS = ["P", "H", "K", "A"];        // таз, бедро, колено, голеностоп
  const TARGETS = ["GVS_aSagP", "GVS_aSagH", "GVS_aSagK", "GVS_aSagA", "GPS_a"];
  const METRICS = ["aMinSagH"].concat(TARGETS); // + разгибание бедра (измеряется напрямую)
  // Фазы шага (номер точки; точка × 2 = % шага)
  const PHASES = [
    { key: "ph_load", from: 0, to: 5 },     // 0–10%
    { key: "ph_mid", from: 6, to: 24 },     // 12–48%
    { key: "ph_term", from: 25, to: 30 },   // 50–60%
    { key: "ph_swing", from: 31, to: 50 },  // 62–100%
  ];

  // Оценка одного шага: для каждого показателя — сумма (вес × угол) + сдвиг.
  function predict(model, x) {
    return model.W.map((w, k) => {
      let s = model.b[k];
      for (let i = 0; i < 204; i++) if (w[i]) s += w[i] * x[i];
      return s;
    });
  }
  // Минимальный угол бедра за шаг = лучшее разгибание (измерено, не ИИ)
  const hipMin = (x) => Math.min(...x.slice(51, 102));

  function meanSdN(a) {
    const n = a.length, m = a.reduce((s, v) => s + v, 0) / n;
    return [m, n > 1 ? Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1)) : 0, n];
  }
  const meanVec = (steps) => steps[0].map((_, i) => steps.reduce((s, x) => s + x[i], 0) / steps.length);
  const curvesOf = (m) => Object.fromEntries(JOINTS.map((j, ji) => [j, m.slice(ji * 51, ji * 51 + 51)]));

  // Полный анализ: шаги «до» и «после» → оценки ИИ по каждому шагу + объяснение.
  // opts.pelvis = false — таз не измерен (видео): используется модель без таза.
  function analyze(stepsB, stepsA, model, opts = {}) {
    if (!stepsB.length || !stepsA.length) throw new Error("no steps");
    const pelvis = opts.pelvis !== false;
    const predB = stepsB.map((x) => predict(model, x));
    const predA = stepsA.map((x) => predict(model, x));
    const per = { aMinSagH: { b: stepsB.map(hipMin), a: stepsA.map(hipMin) } };
    TARGETS.forEach((tg, k) => (per[tg] = { b: predB.map((p) => p[k]), a: predA.map((p) => p[k]) }));
    const mb = meanVec(stepsB), ma = meanVec(stepsA);
    const delta = ma.map((v, i) => v - mb[i]);
    const why = {};
    TARGETS.forEach((tg, k) => {
      let best = null;
      JOINTS.forEach((j, ji) => {
        if (j === "P" && !pelvis) return;
        PHASES.forEach((ph) => {
          let c = 0, dd = 0;
          for (let p = ph.from; p <= ph.to; p++) { const i = ji * 51 + p; c += model.W[k][i] * delta[i]; dd += delta[i]; }
          if (!best || c > best.c) best = { j, ph, c, deg: dd / (ph.to - ph.from + 1) };
        });
      });
      why[tg] = best;
    });
    return {
      hint: opts.hint || "other", pelvis, per, why,
      nb: stepsB.length, na: stepsA.length,
      curvesB: curvesOf(mb), curvesA: curvesOf(ma),
      meanB: mb, meanA: ma,
    };
  }

  // Сравнение «до/после» по каждому показателю и светофор.
  // Надёжно, если |после − до| > 2·√(sd_до²/n_до + sd_после²/n_после).
  function evaluate(an, th) {
    th = th || { hip: 2, joint: 2, gps: 1 };
    const check = an.pelvis ? ["P", "K", "A"] : ["K", "A"];  // где ищем «незаметное ухудшение»
    const res = {};
    METRICS.forEach((m) => {
      const b = meanSdN(an.per[m].b), a = meanSdN(an.per[m].a), d = a[0] - b[0];
      const reliable = Math.abs(d) > 2 * Math.sqrt(b[1] ** 2 / b[2] + a[1] ** 2 / a[2]);
      const thr = m === "aMinSagH" ? th.hip : m === "GPS_a" ? th.gps : th.joint;
      const status = reliable && d < -thr ? "better" : reliable && d > thr ? "worse" : "same";
      res[m] = { b, a, d, reliable, status };
    });
    const hip = res.aMinSagH.status;
    const worse = check.filter((j) => res["GVS_aSag" + j].status === "worse");
    const gpsWorse = res.GPS_a.status === "worse";
    const light = hip === "better" ? (worse.length || gpsWorse ? "yellow" : "green") : "red";
    return { res, hip, worse, gpsWorse, light, check };
  }

  // ИИ-5 (справка): шаг → 15 «главных признаков» PCA финальной модели.
  function project(proj, x) {
    return proj.M.map((row, k) => { let s = proj.c[k]; for (let i = 0; i < 204; i++) s += row[i] * x[i]; return s; });
  }
  function centroid(proj, steps) {
    const zs = steps.map((x) => project(proj, x));
    return zs[0].map((_, k) => zs.reduce((s, z) => s + z[k], 0) / zs.length);
  }

  const api = { JOINTS, TARGETS, METRICS, PHASES, predict, hipMin, meanSdN, meanVec, curvesOf, analyze, evaluate, project, centroid };
  root.QModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
