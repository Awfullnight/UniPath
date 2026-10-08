# UniPath — Final deployment build

Единая адаптивная сборка платформы: email-авторизация, отдельные кабинеты, IELTS/SAT mock, диагностика, обучение, портфолио, application/roadmap и закрытая аналитика куратора.

### Demo/local
Открывай `index.html` напрямую. Данные хранятся только в браузере.

### Cloud
Заполни `config.js` значениями Supabase. После этого данные и файлы работают через облако, а сессии доступны на разных устройствах.

### Production
Смотри `DEPLOY_NOW.md`. Перед реальным запуском обязательно проверь RLS и не публикуй service_role/secret key.

### Official work-plan integration

The curator workspace includes the official 2026/2027 counsellor work-plan requirements from the uploaded document, with a requirements matrix, annual calendar, evidence/status tracking and report metrics.
