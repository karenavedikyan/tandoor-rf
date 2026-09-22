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
| Email | до 5 попыток за 15 мин → 6-я получает **429** + `Retry-After` |
| IP | до 20 попыток за 15 мин (любые email) → 21-я получает **429** |
| Хранение счётчиков | до 24 ч, без бессрочной блокировки |

Попытка резервируется **атомарно до проверки пароля**. Успешный вход сбрасывает только email-bucket; IP-защита сохраняется.

`X-Forwarded-For` **игнорируется**, пока не задан `TRUSTED_PROXIES` и socket не принадлежит доверенному прокси/CIDR. До проверки схемы TW посетители за одним NAT могут делить IP-лимит — это ожидаемое ограничение.

### Выход из системы

- Успешный `POST /api/auth/logout` отзывает серверную сессию и просит браузер удалить cookie.
- Если отзыв сессии в БД не удался, API возвращает **503** и **не** сообщает об успехе; cookie может остаться локально, но повторный выход следует попробовать снова.

## Локальный запуск

```bash
npm ci
cp .env.example .env
# отредактируйте DATABASE_URL (только test/local) и APP_ORIGIN

npm run build
npm run migrate:local
npm run bootstrap-admin:local   # один раз, интерактивно
npm run start:local
```

Команды `*:local` загружают переменные из `.env` через встроенный механизм Node.js 22 (`--env-file=.env`). Файл `.env` не коммитится.

Для production-like запуска используйте `npm start` и передавайте env через платформу деплоя.

### Тестовая PostgreSQL

Изолированная БД для разработки и тестов:

```bash
./scripts/setup-test-db.sh
export TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test
export DATABASE_URL="$TEST_DATABASE_URL"
export APP_ORIGIN=http://127.0.0.1:3000
export PGSSLMODE=disable
npm run migrate
```

Интеграционные тесты и `scripts/smoke-local.sh` **отказываются** работать с БД без суффикса `_test`.

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test ./scripts/smoke-local.sh
```

### Проверки

```bash
npm ci
npm run typecheck
npm test
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/tandoor_rf_test npm run test:integration
npm run build
npm run build   # повторная сборка без dist/public/public
```

Bootstrap PTY integration tests use the `node-pty` devDependency and require a real pseudo-terminal. When PTY tooling is unavailable, those tests report an explicit SKIP reason instead of a silent pass.

## Docker

```bash
docker build -t tandoor-rf .
docker run --rm -p 3000:3000 \
  -e NODE_ENV=production \
  -e APP_ORIGIN=https://your-app.example \
  -e DATABASE_URL=postgresql://user:pass@host:5432/tandoor_rf \
  -e PGSSLROOTCERT=/path/to/ca.pem \
  tandoor-rf
```

Миграции и `bootstrap-admin` выполняются **вручную** до/после деплоя, не при сборке и не в entrypoint.

## Переменные окружения

| Переменная | Обязательность | Описание |
|------------|----------------|----------|
| `PORT` | нет (3000) | HTTP-порт |
| `APP_ORIGIN` | да для auth | доверенный Origin, напр. `http://localhost:3000` |
| `DATABASE_URL` | для auth | PostgreSQL URL; prod: `tandoor_rf` на TW |
| `TEST_DATABASE_URL` | smoke/tests | только `tandoor_rf_test` или `*_test` |
| `NODE_ENV` | prod | `production` включает Secure cookie и обязательный TLS к PostgreSQL |
| `PGSSLMODE` | локально | `disable` только для local/test/development |
| `PGSSLROOTCERT` | prod TW | PEM-содержимое CA **или** абсолютный путь к PEM-файлу |
| `TRUSTED_PROXIES` | нет | CSV доверенных IP/CIDR прокси для цепочки `X-Forwarded-For` |

В **production** запрещены `PGSSLMODE=disable` и `sslmode=disable|no-verify` в URL.

Пример: `.env.example`

## Будущий деплой на Timeweb Cloud

1. Согласовать и создать PostgreSQL `tandoor_rf` на TW (отдельно от старого `tandoor-platform`).
2. Задеплоить образ из проверенного коммита (Dockerfile в корне, порт **3000**).
3. Установить env: `DATABASE_URL`, `APP_ORIGIN` (технический домен TW), `NODE_ENV=production`, `PGSSLROOTCERT`.
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
