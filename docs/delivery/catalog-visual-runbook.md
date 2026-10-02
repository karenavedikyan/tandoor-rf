# Runbook: визуальный каталог и фотографии (R3.2 visual)

## Назначение

Контролируемая подготовка превью изображений каталога для read-only UI. Открытие каталога в браузере **не** запускает загрузку. Импорт 1С и sync фото в production **не выполнять** без отдельного решения.

Локальный каталог `CATALOG_IMAGE_SOURCE_DIR` — **не** готовая FTP-интеграция. Это только каталог файлов на диске pod/VM. Для live-проверки с реальными фото нужны: импортированный активный снимок каталога, настроенные `CATALOG_IMAGE_SOURCE_DIR` / `CATALOG_IMAGE_STORAGE_DIR`, CLI sync с `--apply`, затем проверка media API и UI.

## Переменные окружения

| Переменная | Назначение |
|------------|------------|
| `CATALOG_IMAGE_SOURCE_DIR` | Локальный каталог с файлами по путям из `onec_catalog_product_images.image_path` |
| `CATALOG_IMAGE_STORAGE_DIR` | Постоянное хранилище превью (совместимо с локальным диском / Timeweb volume) |
| `CATALOG_IMAGE_MAX_BYTES` | Лимит одного исходного файла (по умолчанию 8 MiB) |
| `CATALOG_IMAGE_MAX_PIXELS` | Лимит числа пикселей при декодировании (по умолчанию 24 Mpx) |
| `CATALOG_IMAGE_MAX_DIMENSION` | Лимит стороны исходника (по умолчанию 4096 px) |
| `CATALOG_IMAGE_PREVIEW_MAX` | Максимальная сторона WebP-превью (по умолчанию 1200 px) |
| `CATALOG_IMAGE_PROCESS_TIMEOUT_MS` | Таймаут декодирования/генерации превью (по умолчанию 10 с) |
| `CATALOG_IMAGE_SYNC_MAX_FILES` | Лимит **обрабатываемых** файлов за прогон; уже готовые verified skip не считаются (по умолчанию 500) |
| `CATALOG_IMAGE_SYNC_MAX_BYTES` | Лимит суммарно **прочитанных исходных** байт за прогон (по умолчанию 256 MiB) |
| `CATALOG_IMAGE_SYNC_MAX_RUN_MS` | Предельная длительность прогона (по умолчанию 30 мин) |
| `CATALOG_IMAGE_SYNC_MAX_RETRIES` | Повторы временных ошибок I/O (по умолчанию 2) |

FTP-адреса и секреты **не** передаются в браузер. Выдача — только через `GET /api/clients/:guid/catalog/media/:assetId` с проверкой прав на карточку клиента.

## CLI

```bash
# dry-run (по умолчанию) — без записи assets/storage; пишется только служебный журнал onec_catalog_image_sync_runs
npm run onec-catalog-image-sync:local

# явная запись готовых ассетов
npm run onec-catalog-image-sync:local -- --apply
```

Ответ CLI: `{ ok, complete, status, runId, queueComplete, stoppedByLimit, ... }`. При исключении журнал завершается со статусом `failed`, без утечки внутренних путей.

Миграции:
- `022_catalog_image_assets.sql` — `onec_catalog_image_assets`, `onec_catalog_image_sync_runs`;
- `023_catalog_image_source_sha256.sql` — `source_sha256`, `onec_catalog_image_sync_cursor`, `onec_catalog_image_sync_queue`.

## Поведение sync

1. Берутся **только** пути из активного снимка каталога (`catalogVersionId` в отчёте). Курсор и очередь привязаны к `catalog_version_id`; смена снимка начинает новую очередь.
2. Проверяется безопасный path: относительный путь внутри `CATALOG_IMAGE_SOURCE_DIR`, без `..`, URL/абсолютных путей и symlink за пределы source/storage.
3. Файл читается с лимитом `min(CATALOG_IMAGE_MAX_BYTES, остаток бюджета прогона)`; **sharp** декодирует JPEG/PNG/WebP/GIF (без анимации/мультистраничных), проверяет размеры/пиксели и генерирует WebP-превью.
4. Dry-run **только рассчитывает** результат: не пишет в `onec_catalog_image_assets`, storage, `onec_catalog_image_sync_cursor` или `onec_catalog_image_sync_queue`. Служебный журнал `onec_catalog_image_sync_runs` (CLI) по-прежнему создаётся. Следующий `--apply` продолжает с того же курсора, что и без dry-run.
5. Apply: temp-файл → verify hash/format → atomic rename → upsert в `onec_catalog_image_assets` под `pg_advisory_xact_lock` на `source_path`. Перед публикацией повторно читается исходник; устаревшая публикация отклоняется, если на диске уже другой `source_sha256`.
6. Skip готового ассета: storage verify + bounded read исходника + сравнение `source_sha256`. Чтения исходника (skip, обработка, stale-check) суммируются в `sourceBytesRead` и учитывают `CATALOG_IMAGE_SYNC_MAX_BYTES`; при исчерпании бюджета — `stoppedByLimit`, а не ложный «повреждённый файл». Skip не расходует `maxFiles`; ошибки отсутствия файла **не** блокируют очередь.
7. Статус `ready` в рабочей очереди означает реально опубликованный и проверенный объект (только `--apply`).
8. `queueComplete: false` + `stoppedByLimit: true` — нужен следующий прогон; `queueComplete: true` — все пути снимка обработаны или пропущены как ready.
9. Повреждённые/неподдерживаемые файлы отклоняются без записи в БД. При исключении после частичных публикаций CLI возвращает накопленный отчёт (`status: partial`), а не теряет счётчики.

## Откат

- UI продолжает работать без фото (честные заглушки).
- Удалить строки из `onec_catalog_image_assets` или очистить `CATALOG_IMAGE_STORAGE_DIR` — изображения снова недоступны, каталог остаётся читаемым.
- Отзыв прав на клиента — media endpoint возвращает 404, кеш `no-store`, UI очищает sessionStorage.

## Live-проверка

На фикстурах integration/browser-тестов проверены API, фильтры, иерархия, очередь sync, безопасность путей и UI. **Live FTP/реальные фото не проверялись** без настроенного источника и ручного `--apply`.
