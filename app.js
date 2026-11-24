// Qadam AI — интерфейс приложения.
// ИИ: js/pose.js (поза на видео), js/gait.js (шаги), js/model.js (оценка и объяснение).
// Здесь — карточки пациентов, мастер новой записи, экран результата, история и прогресс.

const DATA = window.QADAM_DATA;
const MODEL = DATA.model;
const PATIENTS = DATA.patients;
const DEMO_IDS = Object.keys(PATIENTS);
const { JOINTS, TARGETS, METRICS } = QModel;
const CONDS = ["Verbal", "VR"];

const state = {
  lang: "ru", pid: "demo:s61520_16", sid: "Verbal", mode: "result",
  editing: null, frame: 0, playing: true, an: null, ev: null, sess: null,
  progMetric: "GPS_a", live: {}, running: false, mdPatient: "s61520_16",
};

/* ================= Хранилище (только этот браузер) ================= */
const STORE_KEY = "qadam_store_v2";
let store = { patients: {}, sessions: {}, demoNotes: {}, th: null };
let storageOk = true;
function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (s && typeof s === "object") store = Object.assign({ patients: {}, sessions: {}, demoNotes: {}, th: null }, s);
  } catch (e) { storageOk = false; }
}
function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); storageOk = true; } catch (e) { storageOk = false; }
  return storageOk;
}

/* ================= Тексты ================= */
function tl(lang, key, p) {
  let s = (I18N[lang] || I18N.ru)[key] ?? I18N.ru[key] ?? key;
  if (p) for (const k in p) s = s.split("{" + k + "}").join(p[k]);
  return s;
}
const t = (key, p) => tl(state.lang, key, p);
const $ = (id) => document.getElementById(id);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const sign = (v) => (v > 0 ? "+" : "") + fmt(v);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const locale = () => (state.lang === "kk" ? "kk-KZ" : "ru-RU");
const fdate = (iso) => { const d = new Date(iso); return d.toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", year: "2-digit" }) + " " + d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }); };
function uerr(code, params) { const e = new Error(code); e.code = code; e.params = params || {}; return e; }
function errText(e) {
  if (e && e.code && I18N.ru[e.code]) return t(e.code, e.params);
  return t("err_generic", { msg: e && e.message ? e.message : String(e) });
}

/* ================= Пороги ================= */
const TH_DEFAULT = { hip: 2, joint: 2, gps: 1 };
function thresholds() {
  const v = (id, d) => { const x = parseFloat($(id).value); return Number.isFinite(x) && x >= 0 ? x : d; };
  return { hip: v("thHip", 2), joint: v("thJoint", 2), gps: v("thGps", 1) };
}

/* ================= Пациенты и сеансы ================= */
const isDemo = (pid) => pid.startsWith("demo:");
const codeOf = (pid) => pid.slice(pid.indexOf(":") + 1);
function sessionsOf(pid) {
  if (isDemo(pid)) return CONDS.map((c) => ({ id: c, demo: true, source: "demo", hint: c, hintText: "" }));
  return (store.sessions[codeOf(pid)] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
}

// Анализ сеанса. Для демо-пациентов — модель, которая этого ребёнка НЕ видела.
const cache = new Map();
function analysisOf(pid, s) {
  const key = pid + "|" + s.id;
  if (cache.has(key)) return cache.get(key);
  let an;
  if (isDemo(pid)) {
    const p = PATIENTS[codeOf(pid)];
    an = QModel.analyze(p.rec.Baseline, p.rec[s.id], p.model, { hint: s.id });
    an.modelName = "loso";
  } else {
    const pel = !!(s.before.pelvis && s.after.pelvis);
    let model = pel ? MODEL.final : MODEL.finalNoP, name = pel ? "final" : "nop";
    if (s.source === "demo" && PATIENTS[s.demoRef]) { model = PATIENTS[s.demoRef].model; name = "loso"; }
    an = QModel.analyze(s.before.steps, s.after.steps, model, { hint: s.hint, pelvis: pel });
    an.modelName = name;
    an.trunkB = s.before.trunk || null; an.trunkA = s.after.trunk || null;
  }
  cache.set(key, an);
  return an;
}
const evalOf = (pid, s) => QModel.evaluate(analysisOf(pid, s), thresholds());

/* ================= Список пациентов ================= */
function renderLists() {
  const q = $("search").value.trim().toLowerCase();
  const mine = Object.keys(store.patients).sort();
  $("myList").innerHTML = mine.length
    ? mine.filter((c) => !q || c.toLowerCase().includes(q)).map((c) => {
      const pid = "my:" + c;
      const dots = sessionsOf(pid).slice(-5).map((s) => `<i class="sd ${evalOf(pid, s).light}"></i>`).join("");
      return `<li><button data-pid="${esc(pid)}" class="${pid === state.pid ? "on" : ""}">${esc(c)}<span class="badges">${dots}</span></button></li>`;
    }).join("")
    : `<li class="small muted pad">${t("my_empty")}</li>`;
  let warn = 0;
  $("plist").innerHTML = DEMO_IDS.map((id) => {
    const pid = "demo:" + id;
    const [lv, lr] = CONDS.map((c) => evalOf(pid, { id: c }).light);
    if (lv === "yellow" || lr === "yellow") warn++;
    if (q && !id.toLowerCase().includes(q)) return "";
    return `<li><button data-pid="${pid}" class="${pid === state.pid ? "on" : ""}">${id}
      <span class="badges"><span class="bd ${lv}">${t("badge_verbal")}</span><span class="bd ${lr}">VR</span></span></button></li>`;
  }).join("");
  $("warnCount").textContent = t("warn_count", { n: warn });
}

/* ================= Главный экран ================= */
function currentSession() {
  const list = sessionsOf(state.pid);
  return list.find((s) => s.id === state.sid) || list[list.length - 1] || null;
}

function render() {
  const pid = state.pid, demo = isDemo(pid), code = codeOf(pid);
  if (!demo && !store.patients[code]) { state.pid = "demo:s61520_16"; state.sid = "Verbal"; return render(); }
  // Заголовок
  if (state.mode === "card" && !state.editing) {
    $("pTitle").textContent = t("card_new");
    $("pInfo").textContent = "";
  } else if (demo) {
    const p = PATIENTS[code];
    $("pTitle").innerHTML = `${esc(t("p_title", { id: code }))} <span class="tag m">${t("tag_demo")}</span>`;
    $("pInfo").textContent = t("p_info_demo", { side: t("side_" + p.side), w: p.weight, h: p.height, leg: p.leg ?? "—" });
  } else {
    const c = store.patients[code];
    $("pTitle").textContent = t("p_title", { id: code });
    const parts = [];
    if (c.age) parts.push(t("i_age", { v: c.age }));
    if (c.weight) parts.push(t("i_w", { v: c.weight }));
    if (c.height) parts.push(t("i_h", { v: c.height }));
    if (c.leg) parts.push(t("i_leg", { v: c.leg }));
    parts.push(t("i_side", { v: t("side_" + (c.side || "LEFT")) }));
    $("pInfo").textContent = parts.join(" · ") + (c.notes ? " — " + c.notes : "");
  }
  $("pActions").classList.toggle("hidden", demo || (state.mode === "card" && !state.editing));
  // Сеансы
  const list = sessionsOf(pid);
  const sess = currentSession();
  $("sessions").innerHTML = state.mode === "card" && !state.editing ? "" : list.map((s) => {
    const label = demo ? t("sess_" + s.id) : `${fdate(s.date)} · ${t("cond_" + s.hint)}`;
    const on = sess && s.id === sess.id && state.mode === "result";
    return `<button class="seg ${on ? "on" : ""}" data-sid="${esc(s.id)}"><i class="sd ${evalOf(pid, s).light}"></i>${esc(label)}</button>`;
  }).join("") + (demo ? `<span class="small muted demo-note">${t("demo_note")}</span>` : "");
  // Панели
  $("cardPanel").classList.toggle("hidden", state.mode !== "card");
  $("wizard").classList.toggle("hidden", state.mode !== "wizard");
  const showRes = state.mode === "result" && !!sess;
  $("result").classList.toggle("hidden", !showRes);
  $("empty").classList.toggle("hidden", !(state.mode === "result" && !sess));
  $("progress").classList.toggle("hidden", !(state.mode === "result" && list.length > 0));
  if (state.mode === "result" && list.length) renderProgress(pid, list);
  if (!showRes) { state.an = null; return; }
  state.sid = sess.id;
  state.sess = sess;
  state.an = analysisOf(pid, sess);
  state.ev = QModel.evaluate(state.an, thresholds());
  renderResult(pid, sess, state.an, state.ev);
}

/* ================= Экран результата ================= */
function renderResult(pid, sess, an, ev) {
  $("aiRun").textContent = t("ai_run", { nb: an.nb, na: an.na });
  const sub = [t("src_name_" + sess.source)];
  if (sess.hintText) sub.push(t("hint_label", { text: sess.hintText }));
  sub.push(t("ai_model_" + an.modelName));
  $("aiRunSub").textContent = sub.join(" · ");
  const light = $("light");
  light.className = "light " + ev.light;
  light.textContent = t("light_" + ev.light);
  renderSource(sess, an);
  renderFinds(pid, sess, an, ev);
  renderTable(an, ev);
  renderCharts(an, ev);
  renderParent(sess, an, ev);
  renderHistory(pid);
  renderSimilar(pid, sess, an);
  $("animNote").textContent = t(an.pelvis ? "anim_note" : an.trunkB ? "anim_note_video" : "anim_note_nop");
  drawAnim();
  updatePlay();
}

// Откуда данные: видео со скелетом и найденные шаги
function renderSource(sess, an) {
  const panel = $("srcPanel");
  const hasTrace = sess.before && sess.before.trace;
  if (isDemo(state.pid) || !(sess.source === "video" || sess.source === "imu")) { panel.classList.add("hidden"); return; }
  panel.classList.remove("hidden");
  $("srcTitle").textContent = t(sess.source === "video" ? "src_panel_video" : "src_panel_imu");
  const live = state.live[sess.id];
  const vp = $("vidPair");
  if (sess.source === "video" && live) {
    vp.innerHTML = ["before", "after"].map((w) => `<figure class="vid"><div class="vbox"><video src="${live[w].url}" controls muted playsinline preload="auto"></video><canvas></canvas></div><figcaption>${t(w)} · ${t("side_cam", { side: t("side_" + live[w].side) })}</figcaption></figure>`).join("");
    vp.querySelectorAll(".vid").forEach((fig, k) => attachSkeleton(fig, live[k ? "after" : "before"]));
  } else if (sess.source === "video") vp.innerHTML = `<p class="small muted">${t("video_not_saved")}</p>`;
  else vp.innerHTML = "";
  $("traces").innerHTML = hasTrace ? ["before", "after"].map((w) => traceSVG(sess[w], t(w))).join("") : "";
  $("srcNote").textContent = sess.source === "video" ? t("video_exp_note") : t("imu_note");
}

function attachSkeleton(fig, live) {
  const video = fig.querySelector("video"), canvas = fig.querySelector("canvas");
  canvas.width = live.width; canvas.height = live.height;
  const ctx = canvas.getContext("2d");
  const drawAt = () => {
    const i = Math.max(0, Math.min(live.frames.length - 1, Math.round((video.currentTime - 0.01) * live.fps)));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const lm = live.frames[i] && live.frames[i].lm;
    if (lm) QPose.drawSkeleton(ctx, lm, canvas.width, canvas.height, live.side);
  };
  const loop = () => { drawAt(); if (!video.paused && !video.ended) requestAnimationFrame(loop); };
  video.addEventListener("play", loop);
  video.addEventListener("seeked", drawAt);
  video.addEventListener("loadeddata", drawAt);
}

// График угла бедра по времени с найденными началами шагов
function traceSVG(rec, title) {
  const tr = rec.trace, W = 520, H = 120, L = 34, B = 20, T = 8, R = 8;
  const lo = Math.floor(Math.min(...tr.hip) / 10) * 10, hi = Math.ceil(Math.max(...tr.hip) / 10) * 10 || lo + 10;
  const t0 = tr.t[0], t1 = tr.t[tr.t.length - 1];
  const x = (v) => L + ((v - t0) / (t1 - t0 || 1)) * (W - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const path = tr.t.map((v, i) => `${i ? "L" : "M"}${x(v).toFixed(1)} ${y(tr.hip[i]).toFixed(1)}`).join(" ");
  const marks = tr.hs.map((v) => `<line x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="#ef9f27" stroke-width="1.5" stroke-dasharray="3 3"/>`).join("");
  return `<div class="trace"><h4>${esc(title)} — ${t("trace_title", { n: rec.info.nSteps, d: rec.info.dropped || 0 })}</h4>
    <svg viewBox="0 0 ${W} ${H}">${marks}<path d="${path}" fill="none" stroke="#1d9e75" stroke-width="1.6"/>
    <text x="${L - 4}" y="${y(hi) + 4}" font-size="10" text-anchor="end" fill="#5e6f6b">${hi}°</text>
    <text x="${L - 4}" y="${y(lo) + 4}" font-size="10" text-anchor="end" fill="#5e6f6b">${lo}°</text>
    <text x="${L}" y="${H - 5}" font-size="10" fill="#5e6f6b">0 ${t("sec")}</text>
    <text x="${W - R}" y="${H - 5}" font-size="10" text-anchor="end" fill="#5e6f6b">${(t1 - t0).toFixed(1)} ${t("sec")}</text></svg>
    <p class="small muted">${t("trace_legend")}</p></div>`;
}

function compareHints(pid) {
  // Есть и голос, и VR — сравниваем последние сеансы каждого вида
  const list = sessionsOf(pid);
  const last = (h) => list.filter((s) => s.hint === h).pop();
  const sv = last("Verbal"), sr = last("VR");
  if (!sv || !sr) return null;
  const v = evalOf(pid, sv).res, w = evalOf(pid, sr).res, th = thresholds();
  const hv = v.aMinSagH.a[0], hr = w.aMinSagH.a[0], gv = v.GPS_a.a[0], gr = w.GPS_a.a[0];
  const score = (h, g) => h / th.hip + g / th.gps;
  const verdict = Math.abs(hv - hr) < th.hip && Math.abs(gv - gr) < th.gps ? "verdict_same" : score(hv, gv) > score(hr, gr) ? "verdict_vr" : "verdict_verbal";
  return t("f_compare", { gv: fmt(gv), gr: fmt(gr), hv: fmt(hv), hr: fmt(hr), verdict: t(verdict) });
}

function renderFinds(pid, sess, an, ev) {
  const out = [];
  const r = ev.res;
  const jn = (j) => t("jn_" + j);
  if (ev.hip === "better") out.push(["good", t("f_hip_good", { d: fmt(-r.aMinSagH.d) })]);
  else if (ev.hip === "worse") out.push(["bad", t("f_hip_worse", { d: fmt(r.aMinSagH.d) })]);
  else out.push(["", t("f_hip_none", { d: sign(r.aMinSagH.d) })]);
  ev.check.forEach((j) => {
    const x = r["GVS_aSag" + j];
    if (x.status === "worse") {
      const w = an.why["GVS_aSag" + j];
      const why = t("f_why", { jointc: t("jc_" + w.j), phase: t(w.ph.key), from: w.ph.from * 2, to: w.ph.to * 2, deg: sign(w.deg) });
      out.push(["bad", t("f_worse", { Joint: cap(jn(j)), d: fmt(x.d) }) + `<span class="why">${why}</span>`]);
    }
    if (x.status === "better") out.push(["good", t("f_better", { Joint: cap(jn(j)), d: fmt(-x.d) })]);
  });
  if (ev.gpsWorse) {
    const w = an.why.GPS_a;
    out.push(["bad", t("f_gps", { d: fmt(r.GPS_a.d) }) + `<span class="why">${t("f_why", { jointc: t("jc_" + w.j), phase: t(w.ph.key), from: w.ph.from * 2, to: w.ph.to * 2, deg: sign(w.deg) })}</span>`]);
  }
  if (ev.worse.length && ev.hip === "better") out.push(["idea", t("f_suggest", { joints: ev.worse.map(jn).join(", ") })]);
  if (ev.hip !== "better") out.push(["idea", t("f_suggest_none")]);
  const cmp = compareHints(pid);
  if (cmp) out.push(["idea", cmp]);
  // Отклонение от нормы не бывает меньше нуля. Если ИИ выдал < 0 — запись слишком
  // отличается от лабораторных, на которых училась модель: предупреждаем врача.
  const ood = TARGETS.filter((tg) => (an.pelvis || tg !== "GVS_aSagP") && Math.min(ev.res[tg].b[0], ev.res[tg].a[0]) < 0);
  if (ood.length) out.unshift(["bad", t("f_ood", { list: ood.map((tg) => t("m_" + tg)).join("; ") })]);
  if (!an.pelvis) out.push(["note", t("f_nopelvis")]);
  if (sess.source === "video") out.push(["note", t("video_exp_short")]);
  out.push(["note", t("f_lowacc")]);
  out.push(["note", t("f_footer")]);
  $("finds").innerHTML = out.map(([c, s]) => `<li class="${c}">${s}</li>`).join("");
}

// Мини-график: каждая точка — оценка ИИ для одного шага
function strip(b, a) {
  const all = b.concat(a), lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const x = (v) => 6 + ((v - lo) / span) * 208;
  const dots = (arr, y, col) => arr.map((v) => `<circle cx="${x(v).toFixed(1)}" cy="${y}" r="2.6" fill="${col}" opacity=".75"/>`).join("");
  const mb = QModel.meanSdN(b)[0], ma = QModel.meanSdN(a)[0];
  return `<svg class="strip" viewBox="0 0 220 34">${dots(b, 9, "#9aa6a3")}${dots(a, 25, "#1d9e75")}
    <line x1="${x(mb)}" y1="2" x2="${x(mb)}" y2="16" stroke="#5e6f6b" stroke-width="2"/>
    <line x1="${x(ma)}" y1="18" x2="${x(ma)}" y2="32" stroke="#0f6e56" stroke-width="2"/></svg>`;
}

function renderTable(an, ev) {
  let h = `<tr><th>${t("th_metric")}</th><th>${t("th_steps")}</th><th>${t("before")}</th><th>${t("after")}</th><th>${t("th_change")}</th><th>${t("th_reliable")}</th></tr>`;
  METRICS.forEach((m) => {
    const r = ev.res[m];
    const approx = !an.pelvis && m === "GVS_aSagP";
    const cls = approx ? "same" : r.status === "worse" ? "up" : r.status === "better" ? "down" : "same";
    const tag = m === "aMinSagH" ? `<span class="tag m">${t("tag_measured")}</span>` : approx ? `<span class="tag w">${t("tag_approx")}</span>` : `<span class="tag">${t("tag_ai")}</span>`;
    const acc = m !== "aMinSagH" ? `<span class="acc ${accLevel(m, an.pelvis)}">${t("acc_short", { lvl: t(accLevel(m, an.pelvis)) })}</span>` : "";
    h += `<tr><td>${t("m_" + m)}${tag}${acc}</td><td>${strip(an.per[m].b, an.per[m].a)}</td>
      <td>${fmt(r.b[0])} ± ${fmt(r.b[1])}</td><td>${fmt(r.a[0])} ± ${fmt(r.a[1])}</td>
      <td class="${cls}">${sign(r.d)}${approx ? "" : " · " + t("w_" + r.status)}</td><td>${approx ? t("not_in_light") : r.reliable ? t("yes") : t("no_spread")}</td></tr>`;
  });
  $("numTbl").innerHTML = h;
}

/* ================= Кривые с подсветкой участка ================= */
function chartSVG(b, a, bands) {
  const W = 260, H = 150, L = 34, B = 22, T = 8, R = 8;
  const all = b.concat(a);
  let lo = Math.floor(Math.min(...all) / 5) * 5, hi = Math.ceil(Math.max(...all) / 5) * 5;
  if (hi === lo) hi = lo + 5;
  const x = (i) => L + (i / 50) * (W - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const path = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const band = bands.map((ph) => `<rect x="${x(ph.from)}" y="${T}" width="${x(ph.to) - x(ph.from)}" height="${H - T - B}" fill="#fcebeb"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}">${band}
    <line x1="${L}" y1="${y(lo)}" x2="${W - R}" y2="${y(lo)}" stroke="#e1e8e6"/>
    <text x="${L - 4}" y="${y(hi) + 4}" font-size="10" text-anchor="end" fill="#5e6f6b">${hi}</text>
    <text x="${L - 4}" y="${y(lo) + 4}" font-size="10" text-anchor="end" fill="#5e6f6b">${lo}</text>
    <text x="${L}" y="${H - 6}" font-size="10" fill="#5e6f6b">0%</text>
    <text x="${W - R}" y="${H - 6}" font-size="10" text-anchor="end" fill="#5e6f6b">100%</text>
    <path d="${path(b)}" fill="none" stroke="#9aa6a3" stroke-width="2"/>
    <path d="${path(a)}" fill="none" stroke="#1d9e75" stroke-width="2.5"/></svg>`;
}
function renderCharts(an, ev) {
  const bands = { P: [], H: [], K: [], A: [] };
  ev.worse.forEach((j) => { const w = an.why["GVS_aSag" + j]; if (w) bands[w.j].push(w.ph); });
  if (ev.gpsWorse && an.why.GPS_a) bands[an.why.GPS_a.j].push(an.why.GPS_a.ph);
  const legend = `<p class="small muted"><span style="color:#9aa6a3">━ ${t("before")}</span> &nbsp;<span style="color:#1d9e75">━ ${t("after")}</span></p>`;
  $("charts").innerHTML = JOINTS.map((j) => {
    if (j === "P" && !an.pelvis) {
      if (an.trunkB && an.trunkA) return `<div class="chart"><h4>${t("j_trunk")} <span class="tag m">${t("tag_measured")}</span></h4>${chartSVG(an.trunkB, an.trunkA, [])}${legend}</div>`;
      return `<div class="chart"><h4>${t("j_P")}</h4><p class="small muted nodata">${t("not_measured")}</p></div>`;
    }
    return `<div class="chart"><h4>${t("j_" + j)}</h4>${chartSVG(an.curvesB[j], an.curvesA[j], bands[j])}${legend}</div>`;
  }).join("");
}

/* ================= Сообщение родителям (казахский и русский) ================= */
function parentText(lang, sess, an, ev) {
  const raw = tl(lang, "cond_" + an.hint);
  let hint = raw.startsWith("VR") ? raw : raw.charAt(0).toLowerCase() + raw.slice(1);
  if (sess.hintText) hint += ": «" + sess.hintText + "»";
  const lines = [tl(lang, "p_intro", { hint }), ev.hip === "better" ? tl(lang, "p_hip_good") : tl(lang, "p_hip_none")];
  if (ev.worse.length) lines.push(tl(lang, "p_worse", { joints: ev.worse.map((j) => tl(lang, "jn_" + j)).join(", ") }));
  else if (ev.hip === "better") lines.push(tl(lang, "p_ok"));
  lines.push(tl(lang, "p_end"));
  return lines.join("\n");
}
function renderParent(sess, an, ev) {
  const order = state.lang === "kk" ? ["kk", "ru"] : ["ru", "kk"];
  $("parent").innerHTML = order.map((l) => `<div class="pmsg"><b>${l === "kk" ? "Қазақша" : "Русский"}</b><p>${esc(parentText(l, sess, an, ev))}</p></div>`).join("");
}

/* ================= Анимация ================= */
function drawAnim() {
  const an = state.an;
  if (!an) return;
  const ev = state.ev, colors = {};
  const paint = (k, s) => { if (s === "worse") colors[k] = "#d23b3a"; if (s === "better") colors[k] = "#3b8a1e"; };
  paint("H", ev.hip);
  ev.check.forEach((j) => paint(j, ev.res["GVS_aSag" + j].status));
  let cb = an.curvesB, ca = an.curvesA, mode = "pelvis", top = t("anim_trunk_no");
  if (!an.pelvis) {
    if (an.trunkB && an.trunkA) { cb = Object.assign({}, cb, { P: an.trunkB }); ca = Object.assign({}, ca, { P: an.trunkA }); mode = "video"; top = t("anim_trunk_video"); }
    else mode = "none";
  }
  QAnim.draw($("anim"), {
    curvesB: cb, curvesA: ca, colors, frame: state.frame, trunkMode: mode, topLabel: top,
    titles: { b: t("cond_Baseline"), a: t("cond_" + an.hint) }, step: t("step_pct", { p: state.frame * 2 }),
  });
}
function updatePlay() { $("btnPlay").textContent = state.playing ? "❚❚ " + t("btn_pause") : "▶ " + t("btn_play"); }
let tick = 0;
setInterval(() => {
  const sp = parseInt($("speed").value, 10) || 2;
  if (!state.playing || !state.an || ++tick % (5 - sp)) return;
  state.frame = (state.frame + 1) % 51;
  drawAnim();
}, 22);

/* ================= Решение врача и история ================= */
function decisionsOf(pid, s) {
  if (isDemo(pid)) return store.demoNotes[codeOf(pid) + "|" + s.id] || [];
  return s.decisions || [];
}
function renderHistory(pid) {
  const rows = [];
  sessionsOf(pid).forEach((s) => {
    const label = isDemo(pid) ? t("sess_" + s.id) : `${fdate(s.date)} · ${t("cond_" + s.hint)}${s.hintText ? " «" + s.hintText + "»" : ""}`;
    const ev = evalOf(pid, s);
    const decs = decisionsOf(pid, s);
    rows.push(`<li><i class="sd ${ev.light}"></i><b>${esc(label)}</b>${decs.length ? "" : ` — <span class="muted">${t("no_decision")}</span>`}
      ${decs.map((d) => `<div class="dec">${esc(fdate(d.time))} · ${esc(t(d.dec))}${d.note ? " — " + esc(d.note) : ""}</div>`).join("")}</li>`);
  });
  $("history").innerHTML = rows.join("") || `<li>${t("history_empty")}</li>`;
}
function saveDecision() {
  const msg = $("saveMsg"), dec = document.querySelector('input[name="dec"]:checked');
  if (!dec) { msg.textContent = t("err_decision"); msg.className = "small err"; return; }
  const item = { time: new Date().toISOString(), dec: dec.value, note: $("note").value.trim() };
  const pid = state.pid, s = state.sess;
  if (isDemo(pid)) { const k = codeOf(pid) + "|" + s.id; (store.demoNotes[k] = store.demoNotes[k] || []).push(item); }
  else { const real = store.sessions[codeOf(pid)].find((x) => x.id === s.id); (real.decisions = real.decisions || []).push(item); }
  msg.textContent = saveStore() ? t("saved") : t("storage_off");
  msg.className = "small";
  $("note").value = "";
  dec.checked = false;
  renderHistory(pid);
}
function downloadText(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: (type || "text/plain") + ";charset=utf-8" }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function downloadHistory() {
  const pid = state.pid, lines = [t("p_title", { id: codeOf(pid) })];
  sessionsOf(pid).forEach((s) => {
    const ev = evalOf(pid, s);
    lines.push(`${isDemo(pid) ? t("sess_" + s.id) : fdate(s.date) + " · " + t("cond_" + s.hint) + (s.hintText ? " «" + s.hintText + "»" : "")} | ${t("light_" + ev.light)} | GPS ${fmt(ev.res.GPS_a.b[0])} → ${fmt(ev.res.GPS_a.a[0])}`);
    decisionsOf(pid, s).forEach((d) => lines.push(`   ${fdate(d.time)} | ${t(d.dec)} | ${d.note || ""}`));
  });
  downloadText(`qadam-${codeOf(pid)}.txt`, lines.join("\n"));
}

/* ================= ИИ-5: похожие походки (справка) ================= */
let demoCentroids = null;
function renderSimilar(pid, sess, an) {
  const box = $("sim");
  if (!an.pelvis) { box.innerHTML = `<p class="small muted">${t("sim_nop")}</p>`; return; }
  if (!demoCentroids) demoCentroids = DEMO_IDS.map((id) => ({ id, z: QModel.centroid(MODEL.proj, PATIENTS[id].rec.Baseline) }));
  const self = isDemo(pid) ? codeOf(pid) : sess.demoRef || null;
  const steps = isDemo(pid) ? PATIENTS[self].rec.Baseline : sess.before.steps;
  const z = QModel.centroid(MODEL.proj, steps);
  const near = demoCentroids.filter((d) => d.id !== self)
    .map((d) => ({ id: d.id, dist: Math.sqrt(d.z.reduce((s, v, k) => s + (v - z[k]) ** 2, 0)) }))
    .sort((a, b) => a.dist - b.dist).slice(0, 3);
  box.innerHTML = `<div class="chips">${near.map((n) => {
    const lv = evalOf("demo:" + n.id, { id: "Verbal" }).light, lr = evalOf("demo:" + n.id, { id: "VR" }).light;
    return `<button class="chip" data-pid="demo:${n.id}">${n.id} <span class="bd ${lv}">${t("badge_verbal")}</span><span class="bd ${lr}">VR</span></button>`;
  }).join("")}</div>`;
}

/* ================= Прогресс по сеансам ================= */
function renderProgress(pid, list) {
  const metrics = ["GPS_a", "aMinSagH", "GVS_aSagP", "GVS_aSagH", "GVS_aSagK", "GVS_aSagA"];
  $("progMetric").innerHTML = metrics.map((m) => `<button class="chip ${m === state.progMetric ? "on" : ""}" data-m="${m}">${t("pm_" + m)}</button>`).join("");
  const m = state.progMetric;
  const pts = list.map((s) => {
    const an = analysisOf(pid, s), ev = QModel.evaluate(an, thresholds());
    const skip = !an.pelvis && m === "GVS_aSagP";
    return { label: isDemo(pid) ? t("sess_" + s.id) : fdate(s.date).split(" ")[0] + " · " + t("cond_short_" + s.hint), b: skip ? null : ev.res[m].b, a: skip ? null : ev.res[m].a, light: ev.light };
  });
  const vals = pts.flatMap((p) => (p.b ? [p.b[0] - p.b[1], p.b[0] + p.b[1], p.a[0] - p.a[1], p.a[0] + p.a[1]] : []));
  if (!vals.length) { $("progChart").innerHTML = `<p class="small muted">${t("not_measured")}</p>`; return; }
  const W = 640, H = 210, L = 44, R = 14, T = 12, B = 46;
  let lo = Math.floor(Math.min(...vals)), hi = Math.ceil(Math.max(...vals));
  if (hi - lo < 2) { hi += 1; lo -= 1; }
  const n = pts.length, step = (W - L - R) / Math.max(n, 1);
  const x = (i) => L + step * (i + 0.5), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  let g = "";
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#eef2f1"/><text x="${L - 6}" y="${y(v) + 4}" font-size="10" text-anchor="end" fill="#5e6f6b">${v.toFixed(1)}</text>`;
  }
  const bar = (cx, s, col) => `<line x1="${cx}" x2="${cx}" y1="${y(s[0] - s[1])}" y2="${y(s[0] + s[1])}" stroke="${col}" stroke-width="2" opacity=".5"/><circle cx="${cx}" cy="${y(s[0])}" r="5" fill="${col}"/>`;
  let lineA = "";
  pts.forEach((p, i) => {
    if (!p.b) return;
    g += bar(x(i) - 7, p.b, "#9aa6a3") + bar(x(i) + 7, p.a, "#1d9e75");
    lineA += `${lineA ? "L" : "M"}${(x(i) + 7).toFixed(1)} ${y(p.a[0]).toFixed(1)}`;
  });
  pts.forEach((p, i) => {
    const lbl = p.label.length > 18 ? p.label.slice(0, 17) + "…" : p.label;
    g += `<circle cx="${x(i)}" cy="${H - B + 14}" r="4" class="ld ${p.light}"/><text x="${x(i)}" y="${H - B + 32}" font-size="10" text-anchor="middle" fill="#5e6f6b">${esc(lbl)}</text>`;
  });
  $("progChart").innerHTML = `<svg class="prog" viewBox="0 0 ${W} ${H}">${g}<path d="${lineA}" fill="none" stroke="#1d9e75" stroke-width="1.5" stroke-dasharray="4 4"/></svg>
    <p class="small muted"><span style="color:#9aa6a3">● ${t("before")}</span> &nbsp; <span style="color:#1d9e75">● ${t("after")}</span> &nbsp; ${t("prog_lower")}</p>`;
}

/* ================= Карточка пациента ================= */
const CARD_FIELDS = { cCode: "code", cAge: "age", cWeight: "weight", cHeight: "height", cLeg: "leg", cSide: "side", cNotes: "notes" };
function openCard(code) {
  state.editing = code || null;
  const c = code ? store.patients[code] : { side: "LEFT" };
  for (const [id, k] of Object.entries(CARD_FIELDS)) $(id).value = c[k] ?? (k === "side" ? "LEFT" : "");
  $("btnCardDelete").classList.toggle("hidden", !code);
  $("errCard").textContent = ""; $("ioMsg").textContent = "";
  if (!code) state.pid = state.pid; // заголовок «Новый пациент»
  state.mode = "card";
  render();
  $("cCode").focus();
}
function saveCard() {
  const e = $("errCard");
  const code = $("cCode").value.trim();
  if (!/^[A-Za-z0-9_\-]{2,24}$/.test(code)) { e.textContent = t("err_code"); return; }
  if (code !== state.editing && store.patients[code]) { e.textContent = t("err_code_taken"); return; }
  const num = (id, lo, hi) => {
    const s = $(id).value.trim(); if (!s) return null;
    const v = parseFloat(s.replace(",", "."));
    if (!Number.isFinite(v) || v < lo || v > hi) throw uerr("err_range", { f: $(id).closest("label").querySelector("span").textContent, lo, hi });
    return v;
  };
  let card;
  try {
    card = { code, age: num("cAge", 1, 25), weight: num("cWeight", 5, 150), height: num("cHeight", 0.5, 2.2), leg: num("cLeg", 0.2, 1.2), side: $("cSide").value, notes: $("cNotes").value.trim() };
  } catch (x) { e.textContent = errText(x); return; }
  const old = state.editing;
  if (old && old !== code) {
    store.sessions[code] = store.sessions[old] || [];
    delete store.sessions[old]; delete store.patients[old];
    cache.clear();
  }
  card.created = (old && store.patients[old] && store.patients[old].created) || new Date().toISOString();
  store.patients[code] = card;
  store.sessions[code] = store.sessions[code] || [];
  if (!saveStore()) e.textContent = t("storage_off");
  state.pid = "my:" + code;
  state.editing = null;
  // новый пациент — сразу к новой записи; старый — к результатам
  state.mode = old ? "result" : "wizard";
  if (state.mode === "wizard") openWizard();
  renderLists(); render();
}
function deleteCard() {
  const code = state.editing;
  if (!code || !confirm(t("confirm_delete", { id: code }))) return;
  delete store.patients[code]; delete store.sessions[code];
  saveStore(); cache.clear();
  state.pid = "demo:s61520_16"; state.sid = "Verbal"; state.mode = "result"; state.editing = null;
  renderLists(); render();
}
function exportJSON() {
  const data = { app: "qadam-ai", version: 2, exported: new Date().toISOString(), patients: store.patients, sessions: store.sessions, demoNotes: store.demoNotes };
  downloadText(`qadam-patients-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), "application/json");
  $("ioMsg").textContent = t("exported", { n: Object.keys(store.patients).length });
}
async function importJSON(file) {
  const msg = $("ioMsg");
  try {
    const d = JSON.parse(await readFile(file));
    if (!d || d.app !== "qadam-ai" || typeof d.patients !== "object") throw uerr("err_import");
    let np = 0, ns = 0;
    for (const [code, card] of Object.entries(d.patients)) {
      if (!/^[A-Za-z0-9_\-]{2,24}$/.test(code)) continue;
      store.patients[code] = Object.assign({}, card, { code });
      const have = store.sessions[code] || [];
      for (const s of (d.sessions && d.sessions[code]) || []) {
        if (!s || !s.id || !s.before || !s.after || !Array.isArray(s.before.steps) || !Array.isArray(s.after.steps)) continue;
        const ok = (st) => st.length >= 2 && st.every((x) => Array.isArray(x) && x.length === 204 && x.every(Number.isFinite));
        if (!ok(s.before.steps) || !ok(s.after.steps)) continue;
        const i = have.findIndex((x) => x.id === s.id);
        if (i >= 0) have[i] = s; else have.push(s);
        ns++;
      }
      store.sessions[code] = have; np++;
    }
    if (d.demoNotes && typeof d.demoNotes === "object") Object.assign(store.demoNotes, d.demoNotes);
    saveStore(); cache.clear();
    msg.textContent = t("imported", { np, ns });
    renderLists();
  } catch (e) { msg.textContent = e.code ? errText(e) : t("err_import"); }
}

/* ================= Мастер «Новая запись» ================= */
const readFile = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(uerr("err_read", { name: f.name })); r.readAsText(f); });

function openWizard() {
  state.mode = "wizard";
  $("runLog").innerHTML = ""; $("errRun").textContent = "";
  $("runBar").classList.add("hidden"); $("runPreview").classList.add("hidden");
  $("hintText").value = "";
  const cur = document.querySelector('input[name="src"]:checked');
  if (!cur) document.querySelector('input[name="src"][value="lab"]').checked = true;
  renderWizardInputs();
}
function srcValue() { const r = document.querySelector('input[name="src"]:checked'); return r ? r.value : null; }
function renderWizardInputs() {
  const src = srcValue();
  document.querySelectorAll(".src").forEach((l) => l.classList.toggle("on", l.querySelector("input").checked));
  $("srcHelp").innerHTML = src ? t("help_" + src) : "";
  const fileIn = (id, accept) => `<label class="file"><span>${t("choose_file")}</span><input type="file" id="${id}" accept="${accept}"></label>`;
  const hz = (id) => `<label class="inline small"><span>${t("hz_label")}</span><input type="number" id="${id}" min="10" max="2000" step="1" placeholder="100"></label>`;
  const ex = (f) => `<a class="small" href="examples/${f}" download>${t("example")}: ${f}</a>`;
  let b = "", a = "";
  if (src === "video") { b = fileIn("fB", "video/*"); a = fileIn("fA", "video/*"); }
  if (src === "imu") { b = fileIn("fB", ".csv,.txt") + hz("hzB") + ex("sensors_before_SYNTHETIC.csv"); a = fileIn("fA", ".csv,.txt") + hz("hzA") + ex("sensors_after_verbal_SYNTHETIC.csv"); }
  if (src === "lab") { b = fileIn("fB", ".csv,.txt") + ex("lab_before_s61520_16.csv"); a = fileIn("fA", ".csv,.txt") + ex("lab_after_verbal_s61520_16.csv"); }
  if (src === "demo") {
    b = `<label><span>${t("demo_pick")}</span><select id="demoSel">${DEMO_IDS.map((id) => `<option ${id === "s61520_16" ? "selected" : ""}>${id}</option>`).join("")}</select></label><p class="small muted">${t("demo_before")}</p>`;
    a = `<label><span>${t("demo_cond")}</span><select id="demoCond"><option value="Verbal">${t("cond_Verbal")}</option><option value="VR">${t("cond_VR")}</option></select></label>`;
  }
  $("inBefore").innerHTML = b; $("inAfter").innerHTML = a;
  if (src === "demo") {
    $("hintSel").value = "Verbal";
    $("demoCond").addEventListener("change", (e) => ($("hintSel").value = e.target.value));
  }
}

// Файл лаборатории: строка — шаг, колонки aSagP/H/K/A_pct_GC_0…1000
const LAB_COLS = [];
JOINTS.forEach((j) => { for (let p = 0; p <= 1000; p += 20) LAB_COLS.push(`aSag${j}_pct_GC_${p}`); });
function parseLab(text) {
  const lines = String(text).replace(/^﻿/, "").replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (lines.length < 2) throw uerr("err_empty");
  const sep = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const head = lines[0].split(sep).map((h) => h.trim().replace(/"/g, ""));
  const idx = LAB_COLS.map((c) => head.indexOf(c));
  const miss = LAB_COLS.filter((c, i) => idx[i] < 0);
  if (miss.length) {
    const low = head.map((h) => h.toLowerCase());
    if (low.includes("hip") && low.includes("knee")) throw uerr("err_lab_is_imu");
    throw uerr("err_lab_cols", { n: miss.length, ex: miss.slice(0, 2).join(", ") });
  }
  const steps = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split(sep);
    const x = idx.map((i) => { let s = String(cells[i] ?? "").replace(/"/g, "").trim(); if (sep !== ",") s = s.replace(",", "."); return s === "" ? NaN : Number(s); });
    if (x.every(Number.isFinite)) steps.push(x); else skipped++;
  }
  if (steps.length < 2) throw uerr("err_lab_few", { n: steps.length });
  return { steps, skipped, rows: lines.length - 1 };
}

const r1 = (x) => Math.round(x * 10) / 10;
const roundSteps = (steps) => steps.map((x) => x.map(r1));
const roundTrace = (tr) => tr && { t: tr.t.map((v) => Math.round(v * 100) / 100), hip: tr.hip.map(r1), hs: tr.hs.map((v) => Math.round(v * 1000) / 1000), T0: tr.T0 };

async function runWizard() {
  if (state.running) return;
  const log = (s, cls) => { const li = document.createElement("li"); li.innerHTML = s; if (cls) li.className = cls; $("runLog").appendChild(li); return li; };
  const bar = $("runBar"), fill = bar.querySelector("i");
  $("runLog").innerHTML = ""; $("errRun").textContent = "";
  state.running = true; $("btnRun").disabled = true;
  try {
    const src = srcValue();
    if (!src) throw uerr("err_src");
    const recs = {}, live = {};
    let demoRef = null;
    for (const which of ["before", "after"]) {
      const label = t(which);
      if (src === "demo") {
        demoRef = $("demoSel").value;
        const cond = which === "before" ? "Baseline" : $("demoCond").value;
        const steps = PATIENTS[demoRef].rec[cond];
        log(t("lg_demo", { which: label, id: demoRef, cond: t("cond_" + cond), n: steps.length }));
        recs[which] = { steps, pelvis: true, trunk: null, info: { nSteps: steps.length, demo: demoRef + " / " + cond } };
        continue;
      }
      const f = $(which === "before" ? "fB" : "fA").files[0];
      if (!f) throw uerr("err_file_missing", { which: label });
      if (src === "lab") {
        const text = await readFile(f);
        const r = parseLab(text);
        log(t("lg_lab", { which: label, name: esc(f.name), rows: r.rows, n: r.steps.length, sk: r.skipped }));
        recs[which] = { steps: r.steps, pelvis: true, trunk: null, info: { file: f.name, nSteps: r.steps.length, skipped: r.skipped } };
      }
      if (src === "imu") {
        const text = await readFile(f);
        const hz = parseFloat($(which === "before" ? "hzB" : "hzA").value);
        const sig = QGait.parseSensorCSV(text, hz);
        log(t("lg_frames", { which: label, name: esc(f.name), n: sig.t.length, hz: sig.hzDetected, s: (sig.t[sig.t.length - 1] - sig.t[0]).toFixed(1), pel: t(sig.pelvis ? "yes" : "no") }));
        const seg = QGait.segment(sig, { hipMinPct: MODEL.gait.hipMinPct });
        log(t("lg_steps", { n: seg.steps.length, d: seg.dropped, T: seg.period.toFixed(2) }));
        recs[which] = { steps: seg.steps, pelvis: seg.pelvis, trunk: null, trace: seg.trace, info: { file: f.name, nFrames: sig.t.length, nSteps: seg.steps.length, dropped: seg.dropped } };
      }
      if (src === "video") {
        const li = log(t("lg_mp_load"));
        await QPose.loadLandmarker();
        li.innerHTML += " " + t("lg_ok");
        bar.classList.remove("hidden"); fill.style.width = "0%";
        const prev = $("runPreview"); prev.classList.remove("hidden");
        const pl = log(t("lg_video", { which: label, name: esc(f.name) }));
        const res = await QPose.processVideo(f, {
          canvas: prev,
          onProgress: (i, n, found) => { fill.style.width = ((100 * i) / n).toFixed(1) + "%"; pl.innerHTML = t("lg_video_prog", { which: label, i, n, found }); },
        });
        if (res.fullDuration > res.duration + 0.5) log(t("lg_cut", { s: res.duration.toFixed(0) }), "warn");
        const ang = QPose.anglesFromLandmarks(res.frames, { width: res.width, height: res.height });
        log(t("lg_pose", { found: ang.valid, n: res.frames.length, side: t("side_" + ang.side) }));
        if (ang.validShare < 0.6) QPose.toSignal(ang, QGait.fillGaps); // понятная ошибка «мало кадров с позой»
        // Человек может несколько раз пройти через кадр — шаги ищем в каждом проходе отдельно
        const passes = QPose.splitPasses(res.frames);
        const sigs = [];
        for (const pf of passes) {
          try { sigs.push(QPose.toSignal(QPose.anglesFromLandmarks(pf, { width: res.width, height: res.height, side: ang.side }), QGait.fillGaps)); } catch (e) { /* проход без уверенной позы пропускаем */ }
        }
        if (passes.length > 1) log(t("lg_passes", { n: passes.length, u: sigs.length }));
        const seg = sigs.length > 1 ? QGait.segmentPasses(sigs, {}) : QGait.segment(QPose.toSignal(ang, QGait.fillGaps), {});
        log(t("lg_steps", { n: seg.steps.length, d: seg.dropped, T: seg.period.toFixed(2) }));
        recs[which] = { steps: seg.steps, pelvis: false, trunk: seg.trunk.map(r1), trace: seg.trace, info: { file: f.name, nFrames: res.frames.length, posed: ang.valid, nSteps: seg.steps.length, dropped: seg.dropped, side: ang.side } };
        live[which] = { url: res.url, frames: res.frames, side: ang.side, width: res.width, height: res.height, fps: res.fps };
      }
    }
    const pel = recs.before.pelvis && recs.after.pelvis;
    const code = codeOf(state.pid);
    const sess = {
      id: "s" + Date.now().toString(36), date: new Date().toISOString(), source: src,
      hint: $("hintSel").value, hintText: $("hintText").value.trim(), demoRef,
      before: Object.assign({}, recs.before, { steps: roundSteps(recs.before.steps), trace: roundTrace(recs.before.trace) }),
      after: Object.assign({}, recs.after, { steps: roundSteps(recs.after.steps), trace: roundTrace(recs.after.trace) }),
      decisions: [],
    };
    const an = analysisOf(state.pid, sess);
    log(t("lg_ai", { n: an.nb + an.na, nb: an.nb, na: an.na, model: t("ai_model_" + an.modelName) }), "done");
    store.sessions[code] = store.sessions[code] || [];
    store.sessions[code].push(sess);
    if (!saveStore()) log(t("storage_off"), "warn");
    state.live[sess.id] = Object.keys(live).length ? live : undefined;
    state.sid = sess.id; state.mode = "result";
    renderLists(); render();
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    $("errRun").textContent = errText(e);
    if (e && !e.code) console.warn(e);
  } finally {
    state.running = false; $("btnRun").disabled = false; bar.classList.add("hidden");
  }
}

/* ================= Страница «Модель ИИ» ================= */
function accLevel(tg, pelvis = true) {
  const m = (pelvis ? MODEL.metrics : MODEL.metricsNoP)[tg], r = m.mae / m.baseMae;
  return r < 0.55 ? "acc_good" : r < 0.8 ? "acc_mid" : "acc_low";
}
function accTable(metrics, pelvis) {
  return `<tr><th>${t("th_metric")}</th><th>${t("th_mae")}</th><th>${t("th_base")}</th><th>${t("th_r")}</th><th>${t("th_level")}</th></tr>` +
    TARGETS.map((tg) => { const m = metrics[tg]; return `<tr><td>${t("m_" + tg)}${!pelvis && tg === "GVS_aSagP" ? ` <span class="tag w">${t("tag_approx")}</span>` : ""}</td><td>${m.mae}</td><td>${m.baseMae}</td><td>${m.r}</td><td>${t(accLevel(tg, pelvis))}</td></tr>`; }).join("");
}
function renderModel() {
  $("valText").textContent = t("md_val_text", { n: MODEL.trainedOnSteps });
  $("valTbl").innerHTML = accTable(MODEL.metrics, true);
  $("valTblNoP").innerHTML = accTable(MODEL.metricsNoP, false);
  const sel = $("mdPatient");
  if (!sel.options.length) sel.innerHTML = DEMO_IDS.map((id) => `<option>${id}</option>`).join("");
  sel.value = state.mdPatient;
  const id = state.mdPatient, p = PATIENTS[id];
  $("cmpTitle").textContent = t("md_patient", { id });
  let h = `<tr><th>${t("th_metric")}</th>` + ["Baseline", "Verbal", "VR"].map((c) => `<th>${t("cond_" + c)}: ${t("th_lab")} / ${t("th_ai")}</th>`).join("") + "</tr>";
  TARGETS.forEach((tg) => {
    h += `<tr><td>${t("m_" + tg)}</td>` + ["Baseline", "Verbal", "VR"].map((c) => {
      const ai = c === "Baseline" ? analysisOf("demo:" + id, { id: "Verbal" }).per[tg].b : analysisOf("demo:" + id, { id: c }).per[tg].a;
      return `<td>${fmt(p.lab[c][tg][0])} / ${fmt(QModel.meanSdN(ai)[0])}</td>`;
    }).join("") + "</tr>";
  });
  $("cmpTbl").innerHTML = h;
  const cnt = { Verbal: { hip: 0, green: 0, yellow: 0, red: 0 }, VR: { hip: 0, green: 0, yellow: 0, red: 0 } };
  DEMO_IDS.forEach((i) => CONDS.forEach((c) => { const e = evalOf("demo:" + i, { id: c }); cnt[c][e.light]++; if (e.hip === "better") cnt[c].hip++; }));
  const row = (k, f) => `<tr><td>${t(k)}</td><td>${cnt.Verbal[f]} / ${DEMO_IDS.length}</td><td>${cnt.VR[f]} / ${DEMO_IDS.length}</td></tr>`;
  $("cohortTbl").innerHTML = `<tr><th></th><th>${t("cond_Verbal")}</th><th>${t("cond_VR")}</th></tr>` +
    row("c_hip", "hip") + row("c_yellow", "yellow") + row("c_green", "green") + row("c_red", "red");
}

// Живая проверка разбиения на шаги: склеиваем настоящие шаги пациента в непрерывный
// сигнал (100 Гц, длительность шага меняется 0.9–1.2 с) и ищем шаги заново.
function synthSignal(steps, phase) {
  const kt = [], k = { P: [], H: [], K: [], A: [] }, starts = [];
  let t0 = 0;
  steps.forEach((x, s) => {
    const d = 1.05 + 0.15 * Math.sin(1.7 * s + phase);
    starts.push({ t: t0, d });
    for (let p = 0; p < 50; p++) { kt.push(t0 + (p / 50) * d); JOINTS.forEach((j, ji) => k[j].push(x[ji * 51 + p])); }
    t0 += d;
  });
  const last = steps[steps.length - 1];
  kt.push(t0); JOINTS.forEach((j, ji) => k[j].push(last[ji * 51 + 50]));
  const n = Math.floor(t0 * 100), sig = { t: [], pelvis: [], hip: [], knee: [], ankle: [] };
  for (let i = 0; i < n; i++) {
    const tt = i / 100; sig.t.push(tt);
    sig.pelvis.push(QGait.interp(kt, k.P, tt)); sig.hip.push(QGait.interp(kt, k.H, tt));
    sig.knee.push(QGait.interp(kt, k.K, tt)); sig.ankle.push(QGait.interp(kt, k.A, tt));
  }
  return { sig, starts };
}
function segCheck() {
  const id = state.mdPatient, p = PATIENTS[id];
  const out = [`<li><b>${t("seg_patient", { id })}</b></li>`];
  const got = {};
  ["Baseline", "Verbal", "VR"].forEach((c, ci) => {
    const { sig, starts } = synthSignal(p.rec[c], ci);
    const seg = QGait.segment(sig, { hipMinPct: MODEL.gait.hipMinPct });
    const errs = seg.cycles.filter((cy) => cy.kept).map((cy) => {
      const s = starts.reduce((b, x) => (Math.abs(x.t - cy.start) < Math.abs(b.t - cy.start) ? x : b));
      return (100 * Math.abs(s.t - cy.start)) / s.d;
    }).sort((a, b) => a - b);
    got[c] = seg.steps;
    out.push(`<li>${t("seg_line", { cond: t("cond_" + c), n: p.rec[c].length, f: seg.steps.length, d: seg.dropped, e: errs[Math.floor(errs.length / 2)].toFixed(1) })}</li>`);
  });
  CONDS.forEach((c) => {
    const truth = QModel.evaluate(QModel.analyze(p.rec.Baseline, p.rec[c], p.model, {}), thresholds()).light;
    const rec = QModel.evaluate(QModel.analyze(got.Baseline, got[c], p.model, {}), thresholds()).light;
    out.push(`<li class="${truth === rec ? "done" : "warn"}">${t("seg_light", { cond: t("cond_" + c), a: t("lt_" + truth), b: t("lt_" + rec) })}</li>`);
  });
  out.push(`<li class="small muted">${t("seg_note")}</li>`);
  $("segOut").innerHTML = out.join("");
}

/* ================= Язык и навигация ================= */
function applyLang() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
  document.querySelectorAll(".lang button").forEach((b) => b.classList.toggle("on", b.dataset.lang === state.lang));
  try { localStorage.setItem("qadam_lang", state.lang); } catch (e) {}
  if (state.mode === "wizard") renderWizardInputs();
  renderLists(); render(); renderModel();
  if ($("segOut").innerHTML) segCheck();
}
function route() {
  const v = location.hash === "#model" ? "model" : "patients";
  $("view-patients").classList.toggle("hidden", v !== "patients");
  $("view-model").classList.toggle("hidden", v !== "model");
  document.querySelectorAll(".top nav a").forEach((a) => a.classList.toggle("on", a.dataset.view === v));
  if (v === "model") renderModel();
}
function selectPatient(pid) {
  state.pid = pid;
  state.sid = isDemo(pid) ? "Verbal" : (sessionsOf(pid).slice(-1)[0] || {}).id;
  state.mode = "result";
  renderLists(); render();
  if (location.hash === "#model") location.hash = "#patients";
}

/* ================= Запуск ================= */
{
  loadStore();
  try { state.lang = localStorage.getItem("qadam_lang") || "ru"; } catch (e) {}
  if (store.th) { $("thHip").value = store.th.hip; $("thJoint").value = store.th.joint; $("thGps").value = store.th.gps; }
  document.querySelectorAll(".lang button").forEach((b) => b.addEventListener("click", () => { state.lang = b.dataset.lang; applyLang(); }));
  $("search").addEventListener("input", renderLists);
  const pick = (e) => { const b = e.target.closest("[data-pid]"); if (b) { selectPatient(b.dataset.pid); window.scrollTo({ top: 0, behavior: "smooth" }); } };
  $("plist").addEventListener("click", pick);
  $("myList").addEventListener("click", pick);
  $("sim").addEventListener("click", pick);
  $("sessions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sid]");
    if (!b) return;
    state.sid = b.dataset.sid; state.mode = "result";
    render();
  });
  $("progMetric").addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (b) { state.progMetric = b.dataset.m; render(); } });
  $("btnNewPatient").addEventListener("click", () => openCard(null));
  $("btnCard").addEventListener("click", () => openCard(codeOf(state.pid)));
  $("btnNewRec").addEventListener("click", () => { openWizard(); render(); });
  $("btnCardSave").addEventListener("click", saveCard);
  $("btnCardCancel").addEventListener("click", () => { state.mode = "result"; state.editing = null; render(); });
  $("btnCardDelete").addEventListener("click", deleteCard);
  $("btnExport").addEventListener("click", exportJSON);
  $("fileImport").addEventListener("change", (e) => { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ""; });
  $("sources").addEventListener("change", renderWizardInputs);
  $("btnRun").addEventListener("click", runWizard);
  $("btnWzCancel").addEventListener("click", () => { state.mode = "result"; render(); });
  $("btnPlay").addEventListener("click", () => { state.playing = !state.playing; updatePlay(); });
  ["thHip", "thJoint", "thGps"].forEach((id) => $(id).addEventListener("input", () => {
    store.th = thresholds(); saveStore(); renderLists(); render(); renderModel();
  }));
  $("btnThReset").addEventListener("click", () => {
    $("thHip").value = TH_DEFAULT.hip; $("thJoint").value = TH_DEFAULT.joint; $("thGps").value = TH_DEFAULT.gps;
    store.th = null; saveStore(); renderLists(); render(); renderModel();
  });
  $("mdPatient").addEventListener("change", (e) => { state.mdPatient = e.target.value; renderModel(); $("segOut").innerHTML = ""; });
  $("btnSegCheck").addEventListener("click", segCheck);
  $("btnSave").addEventListener("click", saveDecision);
  $("btnDownload").addEventListener("click", downloadHistory);
  $("btnCopy").addEventListener("click", async () => {
    const b = $("btnCopy");
    const text = ["ru", "kk"].map((l) => parentText(l, state.sess, state.an, state.ev)).join("\n\n");
    try { await navigator.clipboard.writeText(text); b.textContent = t("copied"); } catch (e) { b.textContent = t("copy_fail"); }
    setTimeout(() => (b.textContent = t("btn_copy")), 1500);
  });
  window.addEventListener("hashchange", route);
  applyLang();
  route();
}
