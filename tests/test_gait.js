// Проверка ИИ-2 (разбиение на шаги) и геометрии ИИ-1 (углы по точкам скелета).
// Синтетические записи склеены из НАСТОЯЩИХ шагов датасета (они идут подряд без разрывов).
// Запуск: node tests/test_gait.js
const path = require("path");
global.window = global;
require(path.join(__dirname, "..", "data", "data.js"));
const M = require("../js/model.js");
const G = require("../js/gait.js");
const Pz = require("../js/pose.js");
const S = require("./synth.js");
const D = window.QADAM_DATA;
const th = { hip: 2, joint: 2, gps: 1 };
const conds = ["Baseline", "Verbal", "VR"];
const pct = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
let ok = true;
const check = (name, cond, info) => { console.log(`  ${cond ? "OK    " : "ОШИБКА"} ${name}${info ? " — " + info : ""}`); ok &&= cond; };

// Сравнение найденных шагов с настоящими
function compare(seg, rec, steps) {
  const startErr = [], rmse = [];
  for (const c of seg.cycles.filter((c) => c.kept)) {
    let bi = 0;
    rec.starts.forEach((s, i) => { if (Math.abs(s.t - c.start) < Math.abs(rec.starts[bi].t - c.start)) bi = i; });
    startErr.push((Math.abs(rec.starts[bi].t - c.start) / rec.starts[bi].d) * 100);
  }
  const kept = seg.cycles.filter((c) => c.kept);
  kept.forEach((c, ci) => {
    let bi = 0;
    rec.starts.forEach((s, i) => { if (Math.abs(s.t - c.start) < Math.abs(rec.starts[bi].t - c.start)) bi = i; });
    const x = seg.steps[ci], y = steps[bi];
    // таз сравниваем только если он был в записи
    const from = seg.pelvis ? 0 : 51;
    let s = 0; for (let i = from; i < 204; i++) s += (x[i] - y[i]) ** 2;
    rmse.push(Math.sqrt(s / (204 - from)));
  });
  return { startErr, rmse };
}

function run(label, makeSeg) {
  console.log(`\n${label}`);
  const startErr = [], rmse = [], scoreDiff = { GVS_aSagP: [], GVS_aSagH: [], GVS_aSagK: [], GVS_aSagA: [], GPS_a: [] };
  let nIn = 0, nOut = 0, dropped = 0, lightSame = 0, lightTotal = 0;
  let seed = 10;
  for (const [id, p] of Object.entries(D.patients)) {
    const segs = {};
    for (const c of conds) {
      const steps = p.rec[c];
      const { seg, rec } = makeSeg(steps, seed++);
      segs[c] = seg;
      nIn += steps.length; nOut += seg.steps.length; dropped += seg.dropped;
      const cmp = compare(seg, rec, steps);
      startErr.push(...cmp.startErr); rmse.push(...cmp.rmse);
      const model = seg.pelvis ? p.model : D.model.finalNoP;
      const a = steps.map((x) => M.predict(model, x)), b = seg.steps.map((x) => M.predict(model, x));
      M.TARGETS.forEach((tg, k) => scoreDiff[tg].push(Math.abs(mean(b.map((v) => v[k])) - mean(a.map((v) => v[k])))));
    }
    for (const c of ["Verbal", "VR"]) {
      const pel = segs.Baseline.pelvis;
      const model = pel ? p.model : D.model.finalNoP;
      const truth = M.evaluate(M.analyze(p.rec.Baseline, p.rec[c], model, { pelvis: pel }), th).light;
      const got = M.evaluate(M.analyze(segs.Baseline.steps, segs[c].steps, model, { pelvis: pel }), th).light;
      lightTotal++; if (truth === got) lightSame++;
    }
  }
  console.log(`  шагов в записи: ${nIn}, найдено и оставлено: ${nOut}, отброшено как аномальные: ${dropped}`);
  console.log(`  ошибка начала шага: медиана ${pct(startErr, 0.5).toFixed(1)}%, 90% шагов — до ${pct(startErr, 0.9).toFixed(1)}% шага`);
  console.log(`  отличие кривых от настоящих (RMSE): медиана ${pct(rmse, 0.5).toFixed(2)}°, 90% — до ${pct(rmse, 0.9).toFixed(2)}°`);
  console.log(`  средняя оценка ИИ за сеанс, отличие от настоящих шагов (медиана / макс):`);
  for (const tg in scoreDiff) if (scoreDiff[tg].length) console.log(`     ${tg.padEnd(10)} ${pct(scoreDiff[tg], 0.5).toFixed(2)} / ${Math.max(...scoreDiff[tg]).toFixed(2)}`);
  console.log(`  светофор совпал с расчётом по настоящим шагам: ${lightSame} из ${lightTotal}`);
  return { nIn, nOut, startErr, rmse, scoreDiff, lightSame, lightTotal };
}

// ---------- А. Датчики: углы по времени → шаги ----------
const A = run("А) Синтетические записи датчиков (60 Гц, шум 0.3°, шаги 0.9–1.25 с), 87 записей:", (steps, seed) => {
  const rec = S.continuous(steps, { hz: 60, seed, noise: 0.3 });
  const seg = G.segment(rec.sig, { hipMinPct: D.model.gait.hipMinPct });
  return { seg, rec };
});
check("найдено ≥ 90% шагов", A.nOut >= 0.9 * A.nIn, `${A.nOut}/${A.nIn}`);
check("медианная ошибка начала шага ≤ 5%", pct(A.startErr, 0.5) <= 5);
check("светофор совпадает ≥ 80% сеансов", A.lightSame >= 0.8 * A.lightTotal, `${A.lightSame}/${A.lightTotal}`);

// ---------- Чтение CSV датчиков ----------
console.log("\nЧтение CSV датчиков:");
const rec0 = S.continuous(D.patients.s61520_16.rec.Baseline, { hz: 100, seed: 1 });
const csv = "time;hip;knee;ankle;pelvis\n" + rec0.sig.t.map((t, i) => [t.toFixed(3), rec0.sig.hip[i].toFixed(2), rec0.sig.knee[i].toFixed(2), rec0.sig.ankle[i].toFixed(2), rec0.sig.pelvis[i].toFixed(2)].join(";").replace(/\./g, ",")).join("\n");
const parsed = G.parseSensorCSV(csv);
check("CSV с «;» и десятичной запятой читается", parsed.hip.length === rec0.sig.t.length && parsed.pelvis !== null, `${parsed.hzDetected} Гц`);
const csv2 = "hip,knee,ankle\n" + rec0.sig.t.map((t, i) => [rec0.sig.hip[i], rec0.sig.knee[i], rec0.sig.ankle[i]].join(",")).join("\n");
check("CSV без времени + частота 100 Гц", G.parseSensorCSV(csv2, 100).t[100] === 1);
const errCode = (f) => { try { f(); return "нет ошибки"; } catch (e) { return e.code || e.message; } };
check("без частоты и без time → понятная ошибка", errCode(() => G.parseSensorCSV(csv2)) === "err_imu_hz");
check("нет колонки knee → понятная ошибка", errCode(() => G.parseSensorCSV("time,hip,ankle\n0,1,2\n1,2,3\n2,3,4")) === "err_imu_cols");
check("слишком короткая запись → понятная ошибка", errCode(() => G.parseSensorCSV("time,hip,knee,ankle\n0,1,2,3\n0.1,1,2,3\n0.2,1,2,3")) === "err_short");
check("шум без ритма шага → понятная ошибка", ["err_no_rhythm", "err_few_steps"].includes(errCode(() => {
  const r = S.rng(5); const t = Array.from({ length: 500 }, (_, i) => i / 100), z = () => t.map(() => r());
  G.segment({ t, hip: z(), knee: z(), ankle: z(), pelvis: null });
})));

// ---------- Б. Геометрия видео: точки скелета → углы ----------
console.log("\nБ) Геометрия: синтетические точки скелета (как от MediaPipe) → углы:");
const st = D.patients.s61520_16.rec.Baseline;
const recV = S.continuous(st, { hz: 200, seed: 3, noise: 0 });
for (const dir of [1, -1]) {
  const fr = S.landmarkFrames(recV, { fps: 30, dir, px: 0 });
  const ang = Pz.anglesFromLandmarks(fr, { width: 640, height: 480 });
  let e = { hip: 0, knee: 0, ankle: 0, trunk: 0 };
  const { interp } = G;
  fr.forEach((f, i) => {
    const g = (j) => interp(recV.knotsT, recV.knots[j], f.t);
    e.hip = Math.max(e.hip, Math.abs(ang.hip[i] - g("H")));
    e.knee = Math.max(e.knee, Math.abs(ang.knee[i] - g("K")));
    e.ankle = Math.max(e.ankle, Math.abs(ang.ankle[i] - g("A")));
    e.trunk = Math.max(e.trunk, Math.abs(ang.trunk[i] - g("P")));
  });
  check(`идёт ${dir > 0 ? "вправо" : "влево"}: сторона ${ang.side}, углы совпадают точно (без шума)`,
    ang.side === "LEFT" && Math.max(e.hip, e.knee, e.ankle, e.trunk) < 1e-6,
    `макс. ошибка ${Math.max(e.hip, e.knee, e.ankle, e.trunk).toExponential(1)}°`);
}

const V = run("В) Видео-путь целиком: точки скелета 30 к/с + шум 1 пиксель → углы → шаги (метод Zeni), без таза:", (steps, seed) => {
  const rec = S.continuous(steps, { hz: 200, seed, noise: 0 });
  const fr = S.landmarkFrames(rec, { fps: 30, dir: seed % 2 ? 1 : -1, px: 1, seed });
  const sig = Pz.toSignal(Pz.anglesFromLandmarks(fr, { width: 640, height: 480 }), G.fillGaps);
  const seg = G.segment(sig, {});
  return { seg, rec };
});
check("найдено ≥ 90% шагов", V.nOut >= 0.9 * V.nIn, `${V.nOut}/${V.nIn}`);
check("медианная ошибка начала шага ≤ 5%", pct(V.startErr, 0.5) <= 5);
// ---------- Г. Видео, где человек несколько раз проходит через кадр ----------
console.log("\nГ) Видео из нескольких проходов (человек исчезает на 0.7 с и появляется снова):");
{
  const steps = D.patients.s61520_16.rec.Baseline.slice(0, 20);
  const rec = S.continuous(steps, { hz: 200, seed: 7, noise: 0 });
  const fr = S.landmarkFrames(rec, { fps: 30, px: 1, seed: 7 });
  // вырезаем 3 «паузы» по 0.7 с: человека нет в кадре
  const T = fr[fr.length - 1].t;
  fr.forEach((f) => { [0.25, 0.5, 0.75].forEach((q) => { if (Math.abs(f.t - q * T) < 0.35) f.lm = null; }); });
  const passes = Pz.splitPasses(fr);
  const sigs = passes.map((p) => Pz.toSignal(Pz.anglesFromLandmarks(p, { width: 640, height: 480 }), G.fillGaps));
  const seg = G.segmentPasses(sigs, {});
  const { startErr } = compare(seg, rec, steps);
  check("найдены 4 прохода", passes.length === 4, passes.length);
  check("шаги найдены внутри проходов, ошибка начала ≤ 5%", seg.steps.length >= 8 && pct(startErr, 0.5) <= 5,
    `шагов ${seg.steps.length} из ${steps.length}, медианная ошибка ${pct(startErr, 0.5).toFixed(1)}%`);
}

console.log("\n  Важно: это проверка ПРОГРАММЫ на идеальных синтетических точках. Точность MediaPipe на");
console.log("  настоящем видео детей с ДЦП и сравнение с лабораторией этим тестом НЕ проверяются.");
console.log("\nИТОГ:", ok ? "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" : "ЕСТЬ ОШИБКИ");
process.exit(ok ? 0 : 1);
