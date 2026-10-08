# UniPath — запуск онлайн до проверки

## 1. Supabase
1. Создай проект на https://supabase.com/.
2. В SQL Editor выполни целиком `supabase_schema.sql`.
3. Authentication → Providers → Email: включи email/password.
4. Authentication → URL Configuration: поставь production Site URL `https://ВАШ-ДОМЕН/` и Redirect URL `https://ВАШ-ДОМЕН/**`. Для теста можно добавить `http://localhost:8080/**`.
5. В Authentication → Users создай аккаунт куратора.
6. Скопируй его UUID и один раз выполни:

```sql
insert into public.staff_roles(user_id, role)
values ('UUID-КУРАТОРА', 'curator');
```

7. Project Settings → API: возьми Project URL и Publishable key / anon key.
8. В `config.js`:

```js
window.UNIPATH_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "YOUR-PUBLISHABLE-KEY"
};
```

В браузер нельзя помещать service_role/secret key.

## 2. Email
Подтверждение email и сброс пароля требуют доставки почты. Для production настрой custom SMTP в Supabase Auth; стандартный тестовый SMTP имеет жёсткие ограничения.

## 3. Домен
Для `.uz` проверь имя через официальный сервис WHOIS: https://whois.uz/ . Основной кандидат — `unipath.uz`, но его доступность нужно проверить перед покупкой.

## 4. Интернет
Самый быстрый путь для этой статической сборки — Vercel Drop: https://vercel.com/drop
1. Создай аккаунт Vercel.
2. Перетащи папку `UniPath_FINAL`.
3. Deploy.
4. Project → Settings → Domains → Add Domain.
5. Введи купленный домен и внеси DNS-записи, которые покажет Vercel.

## 5. Телефон
Сайт адаптивный: боковая панель заменяется мобильным меню, формы используют удобные touch targets, таблицы прокручиваются внутри карточек. Добавлены manifest + service worker для установки как PWA в поддерживаемых браузерах.

## 6. Перед проверкой
Прогони регистрацию двух разных учеников, вход/выход, IELTS, SAT, диагностику, сертификат, урок, roadmap и открой кабинет куратора с телефона/ноутбука. Убедись, что данные появились в аналитике.

## 7. Work-plan check
Open Curator → Талаплар / План. The matrix is mapped to the official 2026/2027 work plan; automatic items use platform metrics, while manual items are closed by the curator with evidence/notes.
