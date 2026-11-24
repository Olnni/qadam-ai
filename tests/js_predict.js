// Помощник для test_parity.py: считает оценки ИИ в JavaScript (как на сайте)
// и печатает JSON. Запуск: node tests/js_predict.js
const path = require("path");
const ROOT = path.join(__dirname, "..");
global.window = global;
require(path.join(ROOT, "data", "data.js"));
const M = require(path.join(ROOT, "js", "model.js"));
const D = window.QADAM_DATA;
const out = { fold: {}, final: {}, finalNoP: {}, cohort: {}, example: null };
const th = { hip: 2, joint: 2, gps: 1 };
const cnt = { Verbal: { hip: 0, green: 0, yellow: 0, red: 0 }, VR: { hip: 0, green: 0, yellow: 0, red: 0 } };
const warned = new Set();
for (const [id, p] of Object.entries(D.patients)) {
  out.fold[id] = {}; out.final[id] = {}; out.finalNoP[id] = {};
  for (const c of ["Baseline", "Verbal", "VR"]) {
    out.fold[id][c] = p.rec[c].map((x) => M.predict(p.model, x));
    out.final[id][c] = p.rec[c].map((x) => M.predict(D.model.final, x));
    out.finalNoP[id][c] = p.rec[c].map((x) => M.predict(D.model.finalNoP, x));
  }
  for (const c of ["Verbal", "VR"]) {
    const e = M.evaluate(M.analyze(p.rec.Baseline, p.rec[c], p.model, { hint: c }), th);
    cnt[c][e.light]++; if (e.hip === "better") cnt[c].hip++;
    if (e.light === "yellow") warned.add(id);
    if (id === "s61520_16" && c === "Verbal") {
      const an = M.analyze(p.rec.Baseline, p.rec[c], p.model, { hint: c });
      out.example = { hip: -e.res.aMinSagH.d, P: e.res.GVS_aSagP.d, K: e.res.GVS_aSagK.d,
        whyP: { j: an.why.GVS_aSagP.j, ph: an.why.GVS_aSagP.ph.key, deg: an.why.GVS_aSagP.deg }, light: e.light };
    }
  }
}
out.cohort = { counts: cnt, warned: warned.size };
process.stdout.write(JSON.stringify(out));
