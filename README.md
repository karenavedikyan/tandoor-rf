# tandoor-rf

Новый независимый ЛК Tandoor на Timeweb Cloud. Поэтапная разработка.

## Этап 1: smoke test

Минимальный стек (Node.js 22, TypeScript, Express) для проверки деплоя на Timeweb Cloud:

- HTML-страница с кнопкой «Проверить сервер»
- API `GET /api/health` → `{"status":"ok","app":"tandoor-rf"}`
- Без БД, авторизации и внешних зависимостей

## Локальный запуск

```bash
npm ci
npm run build
npm start
```

Приложение слушает `0.0.0.0:3000` (порт задаётся через `PORT`).

Откройте http://localhost:3000 и нажмите «Проверить сервер».

## Проверки перед деплоем

```bash
npm ci
npm run typecheck
npm test
npm run build
```

## Docker

Сборка и запуск:

```bash
docker build -t tandoor-rf .
docker run --rm -p 3000:3000 tandoor-rf
```

Проверка:

```bash
curl -i http://localhost:3000/api/health
curl http://localhost:3000/
```

## Рекомендуемые настройки Timeweb Cloud

| Параметр | Значение |
|----------|----------|
| Имя приложения | `tandoor-rf` |
| Dockerfile | корень репозитория |
| Порт | `3000` |
| Health check | `GET /api/health` |
| БД / секреты | не требуются |

Деплой выполняйте из проверенного коммита (после успешного `npm test` и `npm run build`). После деплоя проверьте приложение на техническом домене Timeweb Cloud.

Документация по деплою: [Timeweb Cloud — Deploying with Dockerfile](https://timeweb.cloud/docs/apps/deploying-with-dockerfile)

## Переменные окружения

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| `PORT` | `3000` | Порт HTTP-сервера (1–65535) |

Пример: `.env.example`
