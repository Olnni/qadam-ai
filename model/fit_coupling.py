"""
Qadam AI — модель компенсации для «Цифрового двойника»: как отреагирует тело,
если изменить движение бедра.

Простыми словами:
  У каждого ребёнка есть средняя ходьба без подсказки и с подсказкой (голос, VR).
  Подсказка меняла бедро, а таз, колено и стопа менялись «сами» — это и есть компенсация.
  29 детей × 2 подсказки = 58 примеров.
  Вход:  изменение средней кривой бедра (51 точка) + исходные средние кривые 4 суставов (204).
  Выход: изменение средней кривой таза, колена и стопы (по 51 точке, отдельная модель на сустав).
  Модель: StandardScaler → PCA(8) → RidgeCV. Она линейная, поэтому сохраняется как формула W·x + b.

Проверка: Leave-One-Subject-Out против прогноза «ничего не изменится» (нулевое изменение).
Результат: data/coupling.js (для сайта) и data/coupling_metrics.json.

Запуск: python model/fit_coupling.py
"""
import json, os
import numpy as np, pandas as pd
from sklearn.decomposition import PCA
from sklearn.linear_model import RidgeCV
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DS = os.path.join(ROOT, "dataset")
JOINTS = ["P", "H", "K", "A"]
OUT_J = ["P", "K", "A"]
NAMES = {"P": "таз", "K": "колено", "A": "стопа"}

mean_curves = {}
for c in ["Baseline", "Verbal", "VR"]:
    k = pd.read_csv(os.path.join(DS, f"Kinematics_Kinetics_{c}.csv"), sep=";", decimal=",")
    cols = [col for j in JOINTS for col in k.columns if col.startswith(f"aSag{j}_pct_GC_")]
    mean_curves[c] = k.groupby("subject")[cols].mean()
subjects = sorted(mean_curves["Baseline"].index, key=lambda s: int(s.split("_")[1]))

Xs, Ys, G = [], {j: [] for j in OUT_J}, []
for s in subjects:
    base = mean_curves["Baseline"].loc[s].values           # 204: P, H, K, A
    for c in ["Verbal", "VR"]:
        after = mean_curves[c].loc[s].values
        d = after - base
        Xs.append(np.concatenate([d[51:102], base]))       # Δбедро (51) + исходные кривые (204)
        for ji, j in enumerate(JOINTS):
            if j in OUT_J:
                Ys[j].append(d[ji * 51:(ji + 1) * 51])
        G.append(s)
X, G = np.array(Xs), np.array(G)
print(f"Примеров: {len(X)} ({len(subjects)} детей × 2 подсказки), признаков: {X.shape[1]}")

make = lambda: make_pipeline(StandardScaler(), PCA(8, random_state=0), RidgeCV(alphas=np.logspace(-2, 4, 25)))


def to_weights(m):
    sc, pca, ridge = m.named_steps.values()
    W = (ridge.coef_ @ pca.components_) / sc.scale_                      # 51 × 255
    b = ridge.intercept_ - W @ sc.mean_ - ridge.coef_ @ pca.components_ @ pca.mean_
    return W, b


rmse = lambda a, b: np.sqrt(((a - b) ** 2).mean(axis=1))
metrics, export = {}, {}
print("\nПрогноз изменения кривой (RMSE, °) на детях, которых модель НЕ видела (LOSO):")
for j in OUT_J:
    Y = np.array(Ys[j])
    pred = np.zeros_like(Y)
    for s in subjects:
        tr, te = G != s, G == s
        pred[te] = make().fit(X[tr], Y[tr]).predict(X[te])
    e_model, e_zero = rmse(pred, Y), rmse(np.zeros_like(Y), Y)
    better = float((e_model < e_zero).mean())
    m = make().fit(X, Y)
    W, b = to_weights(m)
    assert np.allclose(X @ W.T + b, m.predict(X), atol=1e-6)
    metrics[j] = {"rmse": round(float(e_model.mean()), 2), "rmseZero": round(float(e_zero.mean()), 2),
                  "betterShare": round(better, 3), "n": int(len(Y)),
                  "alpha": float(m.named_steps["ridgecv"].alpha_)}
    export[j] = {"W": [[float(f"{v:.5g}") for v in row] for row in W], "b": [float(f"{v:.5g}") for v in b]}
    print(f"  {NAMES[j]:7s} модель {e_model.mean():.2f}   «ничего не изменится» {e_zero.mean():.2f}   "
          f"модель лучше в {better*100:.0f}% случаев")

out = {"model": export, "metrics": metrics,
       "input": "dH (51) + base P,H,K,A (204)", "output": "dP, dK, dA (51 each)"}
with open(os.path.join(ROOT, "data", "coupling_metrics.json"), "w", encoding="utf-8") as f:
    json.dump(metrics, f, ensure_ascii=False, indent=2)
with open(os.path.join(ROOT, "data", "coupling.js"), "w", encoding="utf-8") as f:
    f.write("// Создано model/fit_coupling.py. Модель компенсации (ориентировочно, 29 детей).\n")
    f.write("window.QADAM_COUPLING = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
print("\nГотово: data/coupling.js, data/coupling_metrics.json")
