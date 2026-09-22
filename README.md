# tandoor-rf

Новый независимый ЛК Tandoor на Timeweb Cloud. Поэтапная разработка.

## Этап 2: вход и профиль

Минимальный стек: Node.js 22, TypeScript, Express, PostgreSQL (`pg`).

- Тестовая страница `/` (smoke test этапа 1 сохранён)
- Вход `/login`, профиль `/profile`
- Серверные сессии (opaque token + SHA-256 в БД, HttpOnly cookie `tandoor_rf_session`)
- API auth/profile с CSRF-защитой через `APP_ORIGIN`
- Отдельная проверка готовности БД: `GET /api/ready`

Без `DATABASE_URL` работают `/`, `/api/health`; auth/profile возвращают **503**.

## Архитектура

| Компонент | Описание |
|-----------|----------|
| `src/server.ts` | Express, маршруты, graceful shutdown |
| `src/auth/*` | login/logout/me, cookie, сессии, rate limit |
| `src/profile/*` | GET/PATCH своего профиля |
| `src/db/*` | пул `pg`, readiness, миграции |
| `server/migrations/` | SQL-миграции (не запускаются автоматически) |
| `public/*` | HTML/CSS/vanilla JS без CDN |

### API

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/health` | `{"status":"ok","app":"tandoor-rf"}`, `Cache-Control: no-store` |
| GET | `/api/ready` | 200 если БД и схема готовы, иначе 503 |
| POST | `/api/auth/login` | `{email,password}` → `{user}`, Set-Cookie |
| POST | `/api/auth/logout` | отзыв сессии, очистка cookie |
| GET | `/api/auth/me` | текущий пользователь или 401 |
| GET | `/api/profile/self` | свой профиль |
| PATCH | `/api/profile/self` | только `fullName`, `phone` |

Мутирующие запросы требуют заголовки `Origin: <APP_ORIGIN>` и `Content-Type: application/json`.

### Лимиты входа

| Параметр | Значение |
|----------|----------|
| Email | 5 неудачных попыток / 15 мин → блок 15 мин |
| IP | 20 неудачных попыток / 15 мин → блок 15 мин |
| Хранение счётчиков | до 24 ч, без бессрочной блокировки |

`X-Forwarded-For` **не доверяется**, пока явно не включён `TRUST_PROXY=true` (для TW — только после подтверждения схемы прокси).

## Локальный запуск

```bash
npm ci
cp .env.example .env
# отредактируйте DATABASE_URL и APP_ORIGIN

npm run build
npm run migrate
npm run bootstrap-admin   # один раз, интерактивно
npm start
```

Откройте http://localhost:3000

### Тестовая PostgreSQL

Изолированная БД для разработки и тестов:

```bash
./scripts/setup-test-db.sh
export TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test
export DATABASE_URL="$TEST_DATABASE_URL"
export APP_ORIGIN=http://127.0.0.1:3000
npm run migrate
```

Интеграционные тесты **отказываются** работать с БД без суффикса `_test`.

### Проверки

```bash
npm ci
npm run typecheck
npm test
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test npm run test:integration
npm run build
```

## Docker

```bash
docker build -t tandoor-rf .
docker run --rm -p 3000:3000 \
  -e APP_ORIGIN=http://localhost:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/tandoor_rf \
  tandoor-rf
```

Миграции и `bootstrap-admin` выполняются **вручную** до/после деплоя, не при сборке и не в entrypoint.

## Переменные окружения

| Переменная | Обязательность | Описание |
|------------|----------------|----------|
| `PORT` | нет (3000) | HTTP-порт |
| `APP_ORIGIN` | да для auth | доверенный Origin, напр. `http://localhost:3000` |
| `DATABASE_URL` | для auth | PostgreSQL URL; prod: `tandoor_rf` на TW |
| `NODE_ENV` | prod | `production` включает Secure cookie |
| `PGSSLMODE` | локально | `disable` для локальных тестов без TLS |
| `PGSSLROOTCERT` | prod TW | CA для проверки TLS |
| `TRUST_PROXY` | нет | `true` — доверять `X-Forwarded-For` (только после настройки TW) |

Пример: `.env.example`

## Будущий деплой на Timeweb Cloud

1. Согласовать и создать PostgreSQL `tandoor_rf` на TW (отдельно от старого `tandoor-platform`).
2. Задеплоить образ из проверенного коммита (Dockerfile в корне, порт **3000**).
3. Установить env: `DATABASE_URL`, `APP_ORIGIN` (технический домен TW), `NODE_ENV=production`.
4. Выполнить **вручную** (one-off job / SSH / console TW):
   ```bash
   npm run migrate
   npm run bootstrap-admin
   ```
5. Проверить `GET /api/health` и `GET /api/ready`, затем вход через `/login`.

Health check TW: `GET /api/health` (не `/api/ready`).

Документация: [Timeweb Cloud — Deploying with Dockerfile](https://timeweb.cloud/docs/apps/deploying-with-dockerfile)

## Откат на этап 1

Задеплойте коммит этапа 1 (`cc2c0db`) — приложение работает без PostgreSQL. Данные этапа 2 в БД **не удаляются** автоматически.
