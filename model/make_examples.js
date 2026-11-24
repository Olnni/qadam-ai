// Создаёт примеры файлов «носимых датчиков» для проверки входа Б на сайте.
// ВНИМАНИЕ: это СИНТЕТИКА. Настоящие шаги пациента s61520_16 из датасета KU Leuven
// склеены в непрерывный сигнал (100 Гц, случайная длительность шага, шум 0.3°).
// Настоящих данных носимых датчиков у нас нет.
// Запуск: node model/make_examples.js
const fs = require("fs"), path = require("path");
global.window = global;
require(path.join(__dirname, "..", "data", "data.js"));
const S = require(path.join(__dirname, "..", "tests", "synth.js"));
const p = window.QADAM_DATA.patients.s61520_16;
const write = (name, steps, seed) => {
  const { sig } = S.continuous(steps.slice(0, 15), { hz: 100, seed, noise: 0.3 });
  const rows = sig.t.map((t, i) => [t.toFixed(2), sig.hip[i].toFixed(2), sig.knee[i].toFixed(2), sig.ankle[i].toFixed(2), sig.pelvis[i].toFixed(2)].join(","));
  fs.writeFileSync(path.join(__dirname, "..", "examples", name), "time,hip,knee,ankle,pelvis\n" + rows.join("\n") + "\n");
  console.log(name, sig.t.length, "строк");
};
write("sensors_before_SYNTHETIC.csv", p.rec.Baseline, 101);
write("sensors_after_verbal_SYNTHETIC.csv", p.rec.Verbal, 102);
fs.writeFileSync(path.join(__dirname, "..", "examples", "wrong_file.csv"), "name,score\nAlice,5\nBob,7\n");
console.log("wrong_file.csv — неправильный файл для проверки сообщения об ошибке");
