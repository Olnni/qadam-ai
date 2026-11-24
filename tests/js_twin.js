// Помощник для test_twin.py: расчёты «Цифрового двойника» в JavaScript (как на сайте).
const path = require("path");
global.window = global;
const R = path.join(__dirname, "..");
require(path.join(R, "data", "data.js")); require(path.join(R, "data", "norm.js")); require(path.join(R, "data", "coupling.js"));
const T = require(path.join(R, "js", "twin.js"));
const D = window.QADAM_DATA, N = window.QADAM_NORM.norm, C = window.QADAM_COUPLING;
const out = { gvs: {}, comp: [], weight: {}, var: { Verbal: {}, VR: {} }, suggest: null, zero: null, hip10: null };
for (const [id, p] of Object.entries(D.patients)) {
  out.gvs[id] = {};
  for (const c of ["Baseline", "Verbal", "VR"]) {
    // GVS каждого шага по восстановленной норме
    out.gvs[id][c] = p.rec[c].map((x) => { const s = T.score([x], N); return [s.gvs.P, s.gvs.H, s.gvs.K, s.gvs.A]; });
  }
  const b = T.meanCurve(p.rec.Baseline), vb = T.variability(p.rec.Baseline);
  for (const c of ["Verbal", "VR"]) {
    const a = T.meanCurve(p.rec[c]);
    const dH = a.slice(51, 102).map((v, i) => v - b[51 + i]);
    const pr = T.compensation(C, b, dH);
    out.comp.push({ id, c, P: pr.P, K: pr.K, A: pr.A });
    const va = T.variability(p.rec[c]);
    for (const j of "PHKA") out.var[c][j] = (out.var[c][j] || 0) + (va[j] / vb[j] - 1 >= 0.3 ? 1 : 0);
  }
}
const st = D.patients.s61520_16.rec.Baseline;
out.zero = Math.max(...T.makeTwin(st, {}).steps.flat().map((v, i) => Math.abs(v - st.flat()[i])));
const d = T.deltaCurves({ hipExt: 10 });
out.hip10 = { H: d.H, other: Math.max(...d.P, ...d.K, ...d.A.map(Math.abs)) };
out.suggest = T.suggest(st, N);
process.stdout.write(JSON.stringify(out));
