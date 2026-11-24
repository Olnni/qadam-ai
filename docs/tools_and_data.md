# Список ИИ-сервисов, инструментов и источников данных

## Данные

| Что | Источник | Лицензия | Как используем |
|---|---|---|---|
| Кривые суставов (таз, бедро, колено, голеностоп) и оценки GPS/GVS 29 детей с ДЦП, 3 режима (без подсказки, голос, VR), 2606 шагов | De Mulder T., Adams H., Dewit T., Molenaers G., Van Campenhout A., Desloovere K. (2024), KU Leuven RDR, https://doi.org/10.48804/JUNNWW | CC-BY-NC-SA-4.0 | обучение и проверка ИИ, демо-пациенты, синтетические примеры датчиков |

Синтетические файлы `examples/sensors_*_SYNTHETIC.csv` созданы нами из шагов этого же датасета. Настоящих записей датчиков и видео детей у нас нет.

## Литература

- De Mulder T. et al. *A Comparison of the Immediate Effects of Verbal and Virtual Reality Feedback on Gait in Children with Cerebral Palsy.* Children, 2024, 11, 524.
- Kidziński Ł. et al. *Deep neural networks enable quantitative movement analysis using single-camera videos.* Nature Communications, 2020, 11:4054 — анализ походки детей с ДЦП по видео возможен (обоснование входа «видео»).
- Zeni J.A., Richards J.G., Higginson J.S. *Two simple methods for determining gait events during treadmill and overground walking using kinematic data.* Gait & Posture, 2008 — метод поиска касания пяткой по положению стопы.

## ИИ

| Сервис / библиотека | Для чего | Обучали ли мы |
|---|---|---|
| **MediaPipe Pose Landmarker** (Google), `@mediapipe/tasks-vision@0.10.21`, модель `pose_landmarker_full` | поиск суставов на кадрах видео прямо в браузере | нет, готовая предобученная модель |
| **scikit-learn** (StandardScaler → PCA(15) → Ridge) | наша модель оценки отклонений GVS/GPS по 204 углам шага; модель без таза для видео | да, `model/train.py` |
| **SciPy** (`least_squares`) | восстановление нормативных кривых по GVS лаборатории | да, `model/fit_norm.py` |
| **scikit-learn** (StandardScaler → PCA(8) → RidgeCV) | модель компенсации для «Цифрового двойника» | да, `model/fit_coupling.py` |
| **pandas, NumPy** | чтение CSV, подготовка данных | — |
| **Claude, Claude Code** (Anthropic) | помощь в анализе данных, написании кода, тестов и текстов | — |

## Программы и хостинг

| Инструмент | Для чего |
|---|---|
| HTML, CSS, JavaScript (без сборки и фреймворков) | сайт; модель ИИ считается в браузере |
| Python 3.12 | обучение модели, тесты |
| Node.js | тесты JavaScript-модулей |
| Playwright + Chromium | проверка сайта в браузере |
| jsDelivr CDN, Google Cloud Storage | загрузка библиотеки и модели MediaPipe |
| Google Fonts (Manrope) | шрифт |
| GitHub, GitHub Pages | открытый код и бесплатный хостинг сайта |
