// Qadam AI — анимация «человечка» по средним кривым суставов (51 кадр, по кругу).
// Вид сбоку, идёт вправо, y вниз, тазобедренный сустав — начало координат:
//   бедро от вертикали θт = H − P;  голень θг = θт − K;  стопа θс = θг + 90° + A.
// Вторая нога — та же кривая со сдвигом на 50% (копия, бледная).
(function (root) {
  const SEG = 62, FOOT = 22, rad = (d) => (d * Math.PI) / 180;

  function leg(c, i, hx) {
    const P = c.P[i], H = c.H[i], K = c.K[i], A = c.A[i];
    const th = rad(H - P), sh = rad(H - P - K), ft = sh + rad(90 + A);
    const kx = hx + SEG * Math.sin(th), ky = SEG * Math.cos(th);
    const ax = kx + SEG * Math.sin(sh), ay = ky + SEG * Math.cos(sh);
    return { kx, ky, ax, ay, tx: ax + FOOT * Math.sin(ft), ty: ay + FOOT * Math.cos(ft), hx: ax - 6 * Math.sin(ft), hy: ay - 6 * Math.cos(ft) };
  }

  // c — кривые {P,H,K,A}; trunkMode: "pelvis" (таз измерен, корпус не измерялся),
  // "video" (P = наклон корпуса по видео), "none" (ничего выше бедра не измерено)
  function figure(c, cx, colors, frame, trunkMode, label) {
    const i = frame, j = (frame + 25) % 51;
    const a = leg(c, i, cx), b = leg(c, j, cx);
    const hipY = 285 - Math.max(a.ay, a.ty, a.hy, b.ay, b.ty, b.hy);  // самая низкая точка — на «дорожке»
    const X = (v) => v.toFixed(1), Y = (v) => (v + hipY).toFixed(1);
    const ink = "#102a26", col = (k) => colors[k] || ink;
    const ln = (x1, y1, x2, y2, w, s, o = 1, extra = "") => `<line x1="${X(x1)}" y1="${Y(y1)}" x2="${X(x2)}" y2="${Y(y2)}" stroke="${s}" stroke-width="${w}" stroke-linecap="round" opacity="${o}" ${extra}/>`;
    const dot = (x, y, k, r) => `<circle cx="${X(x)}" cy="${Y(y)}" r="${r}" fill="${col(k)}"/>`;
    let top = "";
    if (trunkMode === "video") {
      // Реальный наклон корпуса с видео: сплошная линия до плеча
      const sx = cx + 96 * Math.sin(rad(c.P[i])), sy = -96 * Math.cos(rad(c.P[i]));
      top = ln(cx, 0, sx, sy, 7, "#5e6f6b") +
        `<circle cx="${X(sx + 6 * Math.sin(rad(c.P[i])))}" cy="${Y(sy - 16)}" r="13" fill="none" stroke="#5e6f6b" stroke-width="2"/>`;
    } else {
      const P = trunkMode === "pelvis" ? c.P[i] : 0;
      const px = cx + 26 * Math.sin(rad(P)), py = -26 * Math.cos(rad(P));
      top = ln(px, py, px, py - 70, 5, "#9aa6a3", 0.8, 'stroke-dasharray="2 7"') +
        `<circle cx="${X(px)}" cy="${Y(py - 84)}" r="13" fill="none" stroke="#9aa6a3" stroke-width="2" stroke-dasharray="3 4"/>` +
        (trunkMode === "pelvis" ? ln(cx, 0, px, py, 9, col("P")) : "");
    }
    return ln(cx, 0, b.kx, b.ky, 5, ink, 0.2) + ln(b.kx, b.ky, b.ax, b.ay, 5, ink, 0.2) + ln(b.hx, b.hy, b.tx, b.ty, 4, ink, 0.2) +
      top +
      ln(cx, 0, a.kx, a.ky, 6, ink) + ln(a.kx, a.ky, a.ax, a.ay, 6, ink) + ln(a.hx, a.hy, a.tx, a.ty, 5, ink) +
      dot(cx, 0, "H", 7) + dot(a.kx, a.ky, "K", 7) + dot(a.ax, a.ay, "A", 6) +
      `<text x="${cx}" y="${(Math.max(20, hipY - 130)).toFixed(0)}" text-anchor="middle" font-size="11" fill="#9aa6a3">${label}</text>`;
  }

  // svg — элемент <svg>; o = { curvesB, curvesA, colors, frame, trunkMode, titles:{b,a}, step, topLabel }
  function draw(svg, o) {
    svg.innerHTML =
      `<text x="190" y="20" text-anchor="middle" font-size="15" font-weight="700" fill="#5e6f6b">${o.titles.b}</text>
       <text x="490" y="20" text-anchor="middle" font-size="15" font-weight="700" fill="#0f6e56">${o.titles.a}</text>
       <line x1="80" y1="285" x2="300" y2="285" stroke="#d3dcda" stroke-width="2"/><line x1="380" y1="285" x2="600" y2="285" stroke="#d3dcda" stroke-width="2"/>` +
      figure(o.curvesB, 190, {}, o.frame, o.trunkMode, o.topLabel) + figure(o.curvesA, 490, o.colors, o.frame, o.trunkMode, o.topLabel) +
      `<text x="340" y="310" text-anchor="middle" font-size="13" fill="#5e6f6b">${o.step}</text>`;
  }

  root.QAnim = { draw, leg };
})(typeof window !== "undefined" ? window : globalThis);
