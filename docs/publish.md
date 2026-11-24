# Публикация на GitHub Pages

1. Войдите в GitHub CLI (один раз): `gh auth login` → GitHub.com → HTTPS → Login with a web browser.
2. В папке проекта:
   ```bash
   git init -b main && git add . && git commit -m "Qadam AI"
   gh repo create qadam-ai --public --source . --push
   gh api -X POST repos/{owner}/qadam-ai/pages -f "source[branch]=main" -f "source[path]=/"
   ```
3. Сайт появится по адресу `https://ВАШ-ЛОГИН.github.io/qadam-ai/` через 1–2 минуты.
4. Проверьте: ҚАЗ/РУС, демо-пациент s61520_16, «+ Новый пациент» → «Новая запись» с файлами из `examples/`, вход «видео» со своим видео.

После правок: `git add . && git commit -m "…" && git push` — сайт обновится сам.
