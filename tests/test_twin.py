"""
Проверка «Цифрового двойника»:
  1. восстановленная норма: JS считает GVS так же, как формула, и близко к лаборатории;
  2. модель компенсации: JS (формула W·x+b) = scikit-learn;
  3. ползунки меняют только свой сустав и только в своей фазе;
  4. вариабельность: сколько детей с ростом ≥30% при подсказке.
Запуск: python tests/test_twin.py
"""
import json, os, subprocess, sys
import numpy as np, pandas as pd
from sklearn.decomposition import PCA
from sklearn.linear_model import RidgeCV
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ok = True
def check(name, cond, info=""):
    global ok; ok &= bool(cond)
    print(f"  {'OK    ' if cond else 'ОШИБКА'} {name}{' — ' + str(info) if info != '' else ''}")

js = json.loads(subprocess.run(["node", os.path.join(ROOT, "tests", "js_twin.js")], capture_output=True, text=True, check=True).stdout)
txt = open(os.path.join(ROOT, "data", "norm.js"), encoding="utf-8").read()
NORM = json.loads(txt[txt.index("{"): txt.rstrip().rstrip(";").rindex("}") + 1])["norm"]

print("1. Восстановленная норма")
kin, disc = [], []
for c in ["Baseline", "Verbal", "VR"]:
    kin.append(pd.read_csv(os.path.join(ROOT, "dataset", f"Kinematics_Kinetics_{c}.csv"), sep=";", decimal=",").copy().assign(cond=c))
    disc.append(pd.read_csv(os.path.join(ROOT, "dataset", f"Discrete_Parameters_{c}.csv"), sep=";", decimal=","))
kin = pd.concat(kin, ignore_index=True); disc = pd.concat(disc, ignore_index=True)
worst, maes = 0.0, {}
for ji, j in enumerate("PHKA"):
    X = kin[[c for c in kin.columns if c.startswith(f"aSag{j}_pct_GC_")]].values
    py = np.sqrt(((X - np.array(NORM[j])) ** 2).mean(axis=1))
    jsv = np.concatenate([np.array(js["gvs"][s][c])[:, ji] for s in js["gvs"] for c in ["Baseline", "Verbal", "VR"]])
    # данные сайта округлены до 0.1°, поэтому сравниваем с лабораторией, а не побитово
    lab = disc[f"GVS_aSag{j}"].values
    maes[j] = float(np.nanmean(np.abs(py - lab)))
    worst = max(worst, abs(float(np.nanmean(jsv)) - float(np.nanmean(py))))
check("JS и Python дают одинаковое среднее GVS (данные сайта округлены до 0,1°)", worst < 0.05, f"макс. разница {worst:.3f}")
check("GVS по норме близок к лаборатории (ошибка < 1,2 на всех 2606 шагах)", all(v < 1.2 for v in maes.values()), {k: round(v, 2) for k, v in maes.items()})

print("2. Модель компенсации: JS = scikit-learn")
mc = {}
for c in ["Baseline", "Verbal", "VR"]:
    k = kin[kin.cond == c]
    mc[c] = k.groupby("subject")[[col for j in "PHKA" for col in k.columns if col.startswith(f"aSag{j}_pct_GC_")]].mean()
subs = sorted(mc["Baseline"].index, key=lambda s: int(s.split("_")[1]))
X, Y = [], {j: [] for j in "PKA"}
for s in subs:
    b = mc["Baseline"].loc[s].values
    for c in ["Verbal", "VR"]:
        d = mc[c].loc[s].values - b
        X.append(np.concatenate([d[51:102], b]))
        for ji, j in enumerate("PHKA"):
            if j in Y: Y[j].append(d[ji*51:(ji+1)*51])
X = np.array(X)
diff = 0.0
for j in "PKA":
    m = make_pipeline(StandardScaler(), PCA(8, random_state=0), RidgeCV(alphas=np.logspace(-2, 4, 25))).fit(X, np.array(Y[j]))
    pred = m.predict(X)
    jsp = np.array([e[j] for e in js["comp"]])  # данные сайта округлены → небольшая разница
    diff = max(diff, float(np.abs(pred - jsp).max()))
check("прогноз компенсации JS ≈ scikit-learn", diff < 0.1, f"макс. разница {diff:.4f}°")

print("3. Ползунки")
check("все ползунки на 0 → двойник = исходные шаги", js["zero"] == 0)
H = np.array(js["hip10"]["H"])
check("бедро +10 (разгибание): угол −10° на 50–60%, 0 вне 40–70%, другие суставы не меняются",
      np.allclose(H[25:31], -10) and np.allclose(H[:20], 0) and np.allclose(H[36:], 0) and js["hip10"]["other"] == 0)
print("   топ-3 для s61520_16:", [(s["id"], s["value"], round(s["change"], 2)) for s in js["suggest"]])
check("«что даст больше пользы» находит улучшения", len(js["suggest"]) == 3 and all(s["change"] < 0 for s in js["suggest"]))

print("4. Вариабельность: детей с ростом ≥30% при подсказке (из 29)")
v = js["var"]
print("   голос:", v["Verbal"], " VR:", v["VR"])
check("таз (голос) 20/29 и стопа (голос) 21/29", v["Verbal"]["P"] == 20 and v["Verbal"]["A"] == 21)
print("\nИТОГ:", "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" if ok else "ЕСТЬ ОШИБКИ")
sys.exit(0 if ok else 1)
