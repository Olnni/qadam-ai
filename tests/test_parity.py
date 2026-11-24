"""
Проверка: JavaScript на сайте считает те же оценки ИИ, что и Python (scikit-learn).

1. Python заново обучает модели так же, как model/train.py.
2. Node.js считает оценки по весам из data/data.js через js/model.js.
3. Сравниваем все 2606 шагов: разница должна быть меньше 0.02.
4. Проверяем итоговые цифры по 29 пациентам (18/11/7, 19/12/7, 16 с предупреждениями).

Запуск: python tests/test_parity.py
"""
import json, os, subprocess, sys
import numpy as np, pandas as pd
from sklearn.decomposition import PCA
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOL = 0.02

def load_data_js():
    txt = open(os.path.join(ROOT, "data", "data.js"), encoding="utf-8").read()
    return json.loads(txt[txt.index("{"): txt.rstrip().rstrip(";").rindex("}") + 1])

D = load_data_js()
TARGETS = D["model"]["targets"]

# Те же данные, на которых обучали
kin, disc = [], []
for c in ["Baseline", "Verbal", "VR"]:
    k = pd.read_csv(os.path.join(ROOT, "dataset", f"Kinematics_Kinetics_{c}.csv"), sep=";", decimal=",")
    d = pd.read_csv(os.path.join(ROOT, "dataset", f"Discrete_Parameters_{c}.csv"), sep=";", decimal=",")
    k = k.copy(); k["cond"] = c; kin.append(k); disc.append(d)
kin = pd.concat(kin, ignore_index=True); disc = pd.concat(disc, ignore_index=True)
cols = [c for j in "PHKA" for c in kin.columns if c.startswith(f"aSag{j}_pct_GC_")]
X, Y, G = kin[cols].values, disc[TARGETS].values, kin["subject"].values
mk = lambda: make_pipeline(StandardScaler(), PCA(15, random_state=0), Ridge(alpha=1.0))

js = json.loads(subprocess.run(["node", os.path.join(ROOT, "tests", "js_predict.js")],
                               capture_output=True, text=True, check=True).stdout)

final = mk().fit(X, Y)
final_noP = mk().fit(X[:, 51:], Y)
worst = {"fold": 0.0, "final": 0.0, "finalNoP": 0.0}
n = 0
for sid, p in D["patients"].items():
    fold = mk().fit(X[G != sid], Y[G != sid])   # модель без этого ребёнка
    for c in ["Baseline", "Verbal", "VR"]:
        x = np.array(p["rec"][c])             # ровно те числа, что получает сайт
        n += len(x)
        worst["fold"] = max(worst["fold"], np.abs(fold.predict(x) - np.array(js["fold"][sid][c])).max())
        worst["final"] = max(worst["final"], np.abs(final.predict(x) - np.array(js["final"][sid][c])).max())
        worst["finalNoP"] = max(worst["finalNoP"], np.abs(final_noP.predict(x[:, 51:]) - np.array(js["finalNoP"][sid][c])).max())

ok = True
print(f"Проверено шагов: {n}")
for k, v in worst.items():
    flag = v < TOL; ok &= flag
    print(f"  {k:9s} макс. разница Python↔JS = {v:.5f}  {'OK' if flag else 'ОШИБКА'}")

cnt = js["cohort"]["counts"]
print("\nИтоги по 29 пациентам (JS):")
print(f"  Голос: бедро лучше {cnt['Verbal']['hip']}, жёлтый {cnt['Verbal']['yellow']}, зелёный {cnt['Verbal']['green']}, красный {cnt['Verbal']['red']}")
print(f"  VR:    бедро лучше {cnt['VR']['hip']}, жёлтый {cnt['VR']['yellow']}, зелёный {cnt['VR']['green']}, красный {cnt['VR']['red']}")
print(f"  С предупреждениями: {js['cohort']['warned']}")
exp = (cnt["Verbal"]["hip"], cnt["Verbal"]["yellow"], cnt["Verbal"]["green"], cnt["VR"]["hip"], cnt["VR"]["yellow"], cnt["VR"]["green"], js["cohort"]["warned"])
flag = exp == (18, 11, 7, 19, 12, 7, 16); ok &= flag
print("  Совпадает с заявленными 18/11/7, 19/12/7, 16:", "OK" if flag else f"НЕТ {exp}")
e = js["example"]
print(f"\nПример s61520_16, голос: бедро лучше на {e['hip']:.1f}°, таз {e['P']:+.1f}, колено {e['K']:+.1f}; "
      f"сильнее всего повлиял {e['whyP']['j']} в фазе {e['whyP']['ph']} ({e['whyP']['deg']:+.1f}°)")
flag = abs(e["hip"] - 5.6) < 0.05 and abs(e["P"] - 6.4) < 0.05 and abs(e["K"] - 4.7) < 0.05 and e["whyP"]["ph"] == "ph_swing"
ok &= flag
print("  Совпадает с заявленным (5.6 / +6.4 / +4.7 / перенос ноги):", "OK" if flag else "НЕТ")
print("\nИТОГ:", "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" if ok else "ЕСТЬ ОШИБКИ")
sys.exit(0 if ok else 1)
