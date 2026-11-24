// Qadam AI — «Цифровой двойник походки»: расчёты (браузер и Node.js).
//
// Врач двигает ползунок → к кривой сустава в нужной фазе шага плавно прибавляется
// изменение угла → пересчитываем отклонение от восстановленной нормы (как в лаборатории):
//     GVS сустава = √( среднее по 51 точке (угол − норма)² ), затем среднее по шагам.
// Наш общий показатель = √(среднее GVS² по суставам) — НЕ полный GPS лаборатории
// (в GPS лаборатории есть и другие плоскости движения).
// Режим «с прогнозом компенсации»: модель (data/coupling.js) по изменению бедра
// ориентировочно добавляет изменения таза, колена и стопы.
(function (root) {
  const JOINTS = ["P", "H", "K", "A"];
  // Ползунки. sign: как значение ползунка превращается в изменение угла
  // (для бедра «+» = сильнее разгибание = угол меньше).
  const SLIDERS = [
    { id: "hipExt", j: "H", from: 50, to: 60, min: -15, max: 15, sign: -1 },   // бедро: разгибание в конце опоры
    { id: "kneeMid", j: "K", from: 12, to: 48, min: -15, max: 15, sign: 1 },   // колено: сгибание в середине опоры
    { id: "kneeSwing", j: "K", from: 62, to: 100, min: -20, max: 20, sign: 1 }, // колено: сгибание при переносе
    { id: "ankleStance", j: "A", from: 0, to: 60, min: -10, max: 10, sign: 1 }, // голеностоп в опоре
    { id: "pelvisTilt", j: "P", from: 0, to: 100, min: -10, max: 10, sign: 1, full: true }, // таз: наклон вперёд
  ];
  const TAPER = 10; // ширина мягкого края окна, % шага

  // Вес изменения в точке шага p (0…100%): 1 внутри фазы, плавно до 0 на краях (по кругу: шаг — цикл)
  function weight(s, pct) {
    if (s.full) return 1;
    if (pct >= s.from && pct <= s.to) return 1;
    const d = Math.min(
      ...[s.from, s.to].map((e) => { const x = Math.abs(pct - e); return Math.min(x, 100 - x); })
    );
    return d < TAPER ? 0.5 * (1 + Math.cos((Math.PI * d) / TAPER)) : 0;
  }
  // Изменение кривых от ползунков: {P:[51],H:[51],K:[51],A:[51]}
  function deltaCurves(params) {
    const d = { P: new Array(51).fill(0), H: new Array(51).fill(0), K: new Array(51).fill(0), A: new Array(51).fill(0) };
    for (const s of SLIDERS) {
      const v = params[s.id] || 0;
      if (!v) continue;
      for (let i = 0; i < 51; i++) d[s.j][i] += s.sign * v * weight(s, i * 2);
    }
    return d;
  }
  const meanCurve = (steps) => steps[0].map((_, i) => steps.reduce((a, x) => a + x[i], 0) / steps.length);

  // Прогноз компенсации: вход Δбедро(51) + исходные средние кривые (204) → ΔP, ΔK, ΔA
  function compensation(coupling, base204, dH) {
    const x = dH.concat(base204);
    const out = {};
    for (const j of ["P", "K", "A"]) {
      const m = coupling.model[j];
      out[j] = m.W.map((w, k) => { let s = m.b[k]; for (let i = 0; i < x.length; i++) s += w[i] * x[i]; return s; });
    }
    return out;
  }

  // Шаги двойника: каждый реальный шаг + изменение (облако шагов сохраняет вариабельность)
  function makeTwin(steps, params, opts = {}) {
    const d = deltaCurves(params);
    let comp = null;
    if (opts.compensate && opts.coupling && d.H.some((v) => v !== 0)) {
      comp = compensation(opts.coupling, meanCurve(steps), d.H);
      for (const j of ["P", "K", "A"]) for (let i = 0; i < 51; i++) d[j][i] += comp[j][i];
    }
    const flat = [].concat(d.P, d.H, d.K, d.A);
    return { steps: steps.map((x) => x.map((v, i) => v + flat[i])), delta: d, comp };
  }

  // Отклонение от нормы по каждому суставу (среднее по шагам) и общий показатель
  function score(steps, norm, pelvis = true) {
    const joints = pelvis ? JOINTS : ["H", "K", "A"];
    const per = { P: [], H: [], K: [], A: [] }, idx = [];
    for (const x of steps) {
      let sq = 0;
      for (const j of joints) {
        const ji = JOINTS.indexOf(j), n = norm[j];
        let s = 0;
        for (let i = 0; i < 51; i++) s += (x[ji * 51 + i] - n[i]) ** 2;
        const g = Math.sqrt(s / 51);
        per[j].push(g); sq += g * g;
      }
      idx.push(Math.sqrt(sq / joints.length));
    }
    const m = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
    return { gvs: { P: m(per.P), H: m(per.H), K: m(per.K), A: m(per.A) }, index: m(idx), joints };
  }

  // Индекс вариабельности: среднее по 51 точке SD угла между шагами (°)
  function variability(steps) {
    const out = {};
    JOINTS.forEach((j, ji) => {
      let s = 0;
      for (let i = 0; i < 51; i++) {
        const v = steps.map((x) => x[ji * 51 + i]);
        const mu = v.reduce((a, b) => a + b, 0) / v.length;
        s += Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(1, v.length - 1));
      }
      out[j] = s / 51;
    });
    return out;
  }

  // «Что даст больше пользы»: каждый ползунок на +5 и −5 (точный режим), топ по снижению показателя
  function suggest(steps, norm, pelvis = true, top = 3) {
    const base = score(steps, norm, pelvis).index;
    const res = [];
    for (const s of SLIDERS) {
      if (s.j === "P" && !pelvis) continue;
      for (const v of [5, -5]) {
        const tw = score(makeTwin(steps, { [s.id]: v }).steps, norm, pelvis).index;
        res.push({ id: s.id, value: v, before: base, after: tw, change: tw - base });
      }
    }
    return res.filter((r) => r.change < 0).sort((a, b) => a.change - b.change).slice(0, top);
  }

  const api = { JOINTS, SLIDERS, weight, deltaCurves, compensation, makeTwin, score, variability, suggest, meanCurve };
  root.QTwin = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
