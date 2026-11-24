"""
Qadam AI — обучение модели ИИ.

Что делает этот скрипт (простыми словами):
1. Читает CSV-файлы датасета (29 детей с ДЦП, 3 режима ходьбы).
2. Берёт кривые суставов за каждый шаг: таз, бедро, колено, стопа (по 51 точке).
3. Учит ИИ по этим кривым оценивать отклонение каждого сустава от нормы
   (GVS) и общую оценку походки (GPS). Правильные ответы дала лаборатория.
4. Честно проверяет ИИ: каждого ребёнка проверяем моделью, которая
   НЕ видела этого ребёнка при обучении (Leave-One-Child-Out).
5. Сохраняет модель и сырые записи в data/data.js, чтобы сайт работал без сервера.
   Все оценки на сайте считает ИИ прямо в браузере.

Запуск (из папки проекта):
    python model/train.py
"""

import json
import os
import sys
from datetime import date

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.linear_model import Ridge
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "dataset")
OUT_JS = os.path.join(ROOT, "data", "data.js")
OUT_METRICS = os.path.join(ROOT, "model", "metrics.json")

CONDITIONS = ["Baseline", "Verbal", "VR"]   # без подсказки, голос, VR
JOINTS = ["P", "H", "K", "A"]                 # таз, бедро, колено, стопа
TARGETS = ["GVS_aSagP", "GVS_aSagH", "GVS_aSagK", "GVS_aSagA", "GPS_a"]
N_COMPONENTS = 15   # сколько «главных признаков» оставляет PCA
ALPHA = 1.0         # сила регуляризации Ridge (защита от переобучения)


def read_csv(name):
    # В датасете разделитель ";" и десятичная запятая
    return pd.read_csv(os.path.join(DATASET, name), sep=";", decimal=",")


def curve_columns(df):
    cols = []
    for j in JOINTS:
        cols += [c for c in df.columns if c.startswith(f"aSag{j}_pct_GC_")]
    assert len(cols) == 4 * 51, "Ожидалось 4 сустава по 51 точке"
    return cols


# ---------- 1. Читаем данные ----------
kin, disc = [], []
for cond in CONDITIONS:
    k = read_csv(f"Kinematics_Kinetics_{cond}.csv")
    d = read_csv(f"Discrete_Parameters_{cond}.csv")
    assert (k["subject"].values == d["subject"].values).all()
    k = k.copy()
    k["cond"] = cond
    d["cond"] = cond
    kin.append(k)
    disc.append(d)
kin = pd.concat(kin, ignore_index=True)
disc = pd.concat(disc, ignore_index=True)
cols = curve_columns(kin)

X = kin[cols].values            # 2606 шагов × 204 числа
Y = disc[TARGETS].values        # правильные ответы лаборатории
groups = kin["subject"].values  # код ребёнка
print(f"Шагов: {len(X)}, детей: {len(set(groups))}")


def make_model():
    return make_pipeline(StandardScaler(), PCA(N_COMPONENTS, random_state=0), Ridge(alpha=ALPHA))


# Вся цепочка (нормализация → PCA → Ridge) линейная, поэтому её можно
# «сжать» в одну простую формулу: оценка = веса · 204 числа шага + сдвиг.
# Такую формулу легко посчитать на сайте и легко объяснить, какие участки
# шага сильнее всего влияют на оценку ИИ.
def to_weights(model):
    scaler, pca, ridge = model.named_steps.values()
    W = (ridge.coef_ @ pca.components_) / scaler.scale_          # 5 × 204
    b = ridge.intercept_ - W @ scaler.mean_ - ridge.coef_ @ pca.components_ @ pca.mean_
    return W, b


# ---------- 2. Честная проверка: ребёнок, которого модель не видела ----------
def loso(X, title):
    """Leave-One-Subject-Out: каждый ребёнок проверяется моделью, обученной без него."""
    oof = np.zeros_like(Y)        # предсказания ИИ для каждого шага
    base = np.zeros_like(Y)       # «глупое угадывание»: среднее по остальным детям
    fold_weights = {}             # отдельная модель для каждого ребёнка — обучена БЕЗ него
    for train_idx, test_idx in LeaveOneGroupOut().split(X, Y, groups):
        m = make_model().fit(X[train_idx], Y[train_idx])
        oof[test_idx] = m.predict(X[test_idx])
        base[test_idx] = Y[train_idx].mean(axis=0)
        W, b = to_weights(m)
        assert np.allclose(X[test_idx] @ W.T + b, oof[test_idx], atol=1e-6)
        fold_weights[groups[test_idx[0]]] = (W, b)
    metrics = {}
    print(f"\n{title} (средняя ошибка, меньше — лучше):")
    for i, t in enumerate(TARGETS):
        mae = float(np.abs(oof[:, i] - Y[:, i]).mean())
        base_mae = float(np.abs(base[:, i] - Y[:, i]).mean())
        r = float(np.corrcoef(oof[:, i], Y[:, i])[0, 1])
        metrics[t] = {"mae": round(mae, 2), "baseMae": round(base_mae, 2), "r": round(r, 2)}
        print(f"  {t:10s}  ИИ: {mae:5.2f}   угадывание: {base_mae:5.2f}   корреляция: {r:.2f}")
    return metrics, fold_weights


metrics, fold_weights = loso(X, "Точность ИИ, все 4 сустава (204 числа)")

# Модель БЕЗ таза: для видео, где наклон таза надёжно не измерить.
# Вход — только бедро, колено, голеностоп (3 × 51 = 153 числа).
NO_P = np.arange(51, 204)
metrics_noP, _ = loso(X[:, NO_P], "Точность ИИ без таза (153 числа, для видео)")

# ---------- 3. Финальные модели на всех детях (для новых записей) ----------
final = make_model().fit(X, Y)
W_final, b_final = to_weights(final)
assert np.allclose(X[:50] @ W_final.T + b_final, final.predict(X[:50]), atol=1e-6)

# Финальная модель без таза. Веса таза = 0, чтобы сайт считал её той же формулой W·x + b.
final_noP = make_model().fit(X[:, NO_P], Y)
W_noP_short, b_noP = to_weights(final_noP)
W_noP = np.zeros((len(TARGETS), 204))
W_noP[:, NO_P] = W_noP_short

r6 = lambda a: [float(f"{v:.6g}") for v in np.ravel(a)]
pack = lambda W, b: {"W": [r6(row) for row in W], "b": r6(b)}

# ---------- 3б. «Похожие походки» (справка): проекция шага в пространство PCA ----------
# z = M·x + c — те же 15 «главных признаков», что использует финальная модель.
scaler, pca, _ = final.named_steps.values()
M = pca.components_ / scaler.scale_
c = -M @ scaler.mean_ - pca.components_ @ pca.mean_
assert np.allclose(X[:5] @ M.T + c, pca.transform(scaler.transform(X[:5])), atol=1e-6)

# ---------- 3в. Подсказка для разбиения записи на шаги ----------
# Самый устойчивый момент шага — максимальное разгибание бедра (минимум угла бедра).
# Запоминаем, на каком проценте шага он в среднем бывает.
hip_min_pct = (X[:, 51:102].argmin(axis=1) * 2).astype(float)
gait_meta = {"hipMinPct": round(float(hip_min_pct.mean()), 2), "hipMinPctSd": round(float(hip_min_pct.std()), 2)}
print(f"\nМинимум угла бедра: {gait_meta['hipMinPct']}% шага (разброс ±{gait_meta['hipMinPctSd']}%)")

model_json = {
    "targets": TARGETS,
    "final": pack(W_final, b_final),
    "finalNoP": pack(W_noP, b_noP),
    "metrics": metrics,
    "metricsNoP": metrics_noP,
    "nComponents": N_COMPONENTS,
    "trainedOnSteps": int(len(X)),
    "proj": {"M": [[float(f"{v:.5g}") for v in row] for row in M], "c": r6(c)},
    "gait": gait_meta,
}


# ---------- 4. Данные пациентов для сайта ----------
# На сайт попадают СЫРЫЕ записи: 204 угла на каждый шаг — то, что выдаёт прибор.
# Оценки лаборатории ("lab") нужны только на странице «Точность модели».
def stats(values):
    v = np.asarray(values, dtype=float)
    v = v[~np.isnan(v)]
    return [round(float(v.mean()), 2), round(float(v.std(ddof=1)), 2), int(len(v))]


patients = {}
for subj in sorted(set(groups), key=lambda s: int(s.split("_")[1])):
    info = disc[disc["subject"] == subj].iloc[0]
    info_k = kin[kin["subject"] == subj].iloc[0]
    W, b = fold_weights[subj]
    p = {
        "side": info["side"],
        "weight": round(float(info["weight"]), 1),
        "height": round(float(info["height"]), 2),
        "leg": round(float(info_k["LegLength"]), 2) if "LegLength" in info_k else None,
        "model": pack(W, b),   # модель, которая этого пациента не видела
        "rec": {},             # записи: шаги × 204 угла
        "lab": {},             # оценки лаборатории — только для проверки точности
    }
    for cond in CONDITIONS:
        mask = (kin["subject"] == subj).values & (kin["cond"] == cond).values
        p["rec"][cond] = [[round(float(v), 1) for v in row] for row in X[mask]]
        p["lab"][cond] = {m: stats(disc.loc[mask, m]) for m in TARGETS}
    patients[subj] = p

data = {
    "meta": {
        "source": "De Mulder T. et al., KU Leuven RDR, 2024, doi:10.48804/JUNNWW",
        "license": "CC-BY-NC-SA-4.0",
        "built": date.today().isoformat(),
    },
    "model": model_json,
    "patients": patients,
}

os.makedirs(os.path.dirname(OUT_JS), exist_ok=True)
with open(OUT_JS, "w", encoding="utf-8") as f:
    f.write("// Создано автоматически скриптом model/train.py. Не редактируйте вручную.\n")
    f.write("// Данные: " + data["meta"]["source"] + ", лицензия CC-BY-NC-SA-4.0\n")
    f.write("window.QADAM_DATA = ")
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")
with open(OUT_METRICS, "w", encoding="utf-8") as f:
    json.dump({"all4joints": metrics, "noPelvis": metrics_noP, "gait": gait_meta}, f, ensure_ascii=False, indent=2)

print(f"\nГотово: {OUT_JS} ({os.path.getsize(OUT_JS) // 1024} КБ)")
