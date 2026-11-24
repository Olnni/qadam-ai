"""
Qadam AI — восстановление нормативных кривых (основа «Цифрового двойника»).

Простыми словами:
  Лаборатория считает отклонение сустава от нормы (GVS) так:
      GVS = корень( среднее по 51 точке (угол ребёнка − угол нормы)² )
  Самой нормы (кривых здоровых детей) в датасете нет. Но для каждого из 2606 шагов
  известны и кривая, и GVS. Подбираем такую кривую нормы (51 число на сустав),
  при которой эта формула лучше всего повторяет GVS лаборатории (least_squares).
  Небольшой штраф за «ломаную» кривую (вторые разности) делает норму гладкой.

Проверка: норму подбираем без одного ребёнка и считаем ошибку GVS на нём
(Leave-One-Subject-Out). Результат: data/norm.js (для сайта) и data/norm_metrics.json.

Запуск: python model/fit_norm.py
"""
import json, os
import numpy as np, pandas as pd
from scipy.optimize import least_squares

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DS = os.path.join(ROOT, "dataset")
JOINTS = ["P", "H", "K", "A"]
NAMES = {"P": "таз", "H": "бедро", "K": "колено", "A": "голеностоп"}
SMOOTH = {"P": 3.0, "H": 1.0, "K": 1.0, "A": 1.0}   # сила штрафа за негладкость (для таза больше)

kin, disc = [], []
for c in ["Baseline", "Verbal", "VR"]:
    k = pd.read_csv(os.path.join(DS, f"Kinematics_Kinetics_{c}.csv"), sep=";", decimal=",")
    d = pd.read_csv(os.path.join(DS, f"Discrete_Parameters_{c}.csv"), sep=";", decimal=",")
    kin.append(k.copy()); disc.append(d)
kin = pd.concat(kin, ignore_index=True); disc = pd.concat(disc, ignore_index=True)
groups = kin["subject"].values


def curves(j):
    cols = [c for c in kin.columns if c.startswith(f"aSag{j}_pct_GC_")]
    assert len(cols) == 51
    return kin[cols].values


def fit(X, g, lam):
    """Подбор нормы n (51 точка): RMS(X − n) ≈ GVS для каждого шага."""
    start = X[np.argsort(g)[:50]].mean(axis=0)   # 50 шагов с наименьшим GVS
    def resid(n):
        r = np.sqrt(((X - n) ** 2).mean(axis=1)) - g
        d2 = np.roll(n, 1) - 2 * n + np.roll(n, -1)   # шаг — цикл, поэтому по кругу
        return np.concatenate([r, lam * d2])
    return least_squares(resid, start, method="trf").x


gvs_of = lambda X, n: np.sqrt(((X - n) ** 2).mean(axis=1))

norm, metrics = {}, {}
print("Восстановление нормы. Ошибка GVS на детях, которых подбор НЕ видел (LOSO):")
for j in JOINTS:
    X = curves(j)
    g = disc[f"GVS_aSag{j}"].values
    ok = np.isfinite(g) & np.isfinite(X).all(axis=1)
    X, g, gr = X[ok], g[ok], groups[ok]
    oof = np.zeros_like(g)
    for s in np.unique(gr):
        tr, te = gr != s, gr == s
        oof[te] = gvs_of(X[te], fit(X[tr], g[tr], SMOOTH[j]))
    n = fit(X, g, SMOOTH[j])
    mae = float(np.abs(oof - g).mean())
    r = float(np.corrcoef(oof, g)[0, 1])
    norm[j] = [round(float(v), 3) for v in n]
    metrics[j] = {"mae": round(mae, 3), "r": round(r, 4), "steps": int(ok.sum()),
                  "min": round(float(n.min()), 1), "max": round(float(n.max()), 1),
                  "argmin_pct": int(n.argmin()) * 2, "argmax_pct": int(n.argmax()) * 2}
    print(f"  {NAMES[j]:11s} ошибка GVS {mae:.3f}   корреляция {r:.4f}   "
          f"норма от {n.min():6.1f}° ({n.argmin()*2}%) до {n.max():6.1f}° ({n.argmax()*2}%)")

# Похожа ли норма на обычную ходьбу?
K, H = np.array(norm["K"]), np.array(norm["H"])
checks = {
    "knee_swing_peak": round(float(K[31:].max()), 1),        # колено при переносе ≈ 55–60°
    "hip_min_late_stance": round(float(H[20:31].min()), 1),  # бедро в конце опоры ≈ −5…0°
}
print(f"\nПроверка на здравый смысл: колено при переносе — {checks['knee_swing_peak']}° (ожидаем ~55–60°), "
      f"бедро в конце опоры — {checks['hip_min_late_stance']}° (ожидаем ~−5…0°)")

out = {"norm": norm, "metrics": metrics, "checks": checks,
       "method": "least_squares: RMS(curve − norm) ≈ GVS лаборатории, штраф за вторые разности, LOSO"}
with open(os.path.join(ROOT, "data", "norm_metrics.json"), "w", encoding="utf-8") as f:
    json.dump({"metrics": metrics, "checks": checks}, f, ensure_ascii=False, indent=2)
with open(os.path.join(ROOT, "data", "norm.js"), "w", encoding="utf-8") as f:
    f.write("// Создано model/fit_norm.py. Восстановленные нормативные кривые (норма лаборатории KU Leuven).\n")
    f.write("window.QADAM_NORM = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
print("\nГотово: data/norm.js, data/norm_metrics.json")
