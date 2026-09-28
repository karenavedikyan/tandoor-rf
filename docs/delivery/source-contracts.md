# Контракты источников данных

Аудит на **`f591f483d5d8886dfa9c4626c9f347622958f204`**. Утверждения помечены по уровню доказательства.

---

## 1. Обмен 1С → FTP → PostgreSQL

### Подтверждено кодом

| Параметр | Значение | Где |
|----------|----------|-----|
| Путь файла | `{ONEC_FTP_BASE_PATH}/clients/all_clients.json` | `src/onec-clients/constants.ts` |
| Транспорт | Plain FTP (`ONEC_FTP_SECURITY=plain`), read-only CLI | `README.md`, `src/onec-ftp/*` |
| Лимиты | 10 MiB, 50 000 записей, 60 с read deadline | `src/onec-clients/constants.ts` |
| Режим по умолчанию | dry-run (без записи в БД) | `src/onec-clients/cli-args.ts` |
| Apply | `--apply --expected-sha256 <64 hex>` | `README.md` |
| Журнал | `onec_client_import_runs` | `server/migrations/002_onec_clients.sql` |

### Подтверждено тестами

- Валидация JSON, UUID, дубликатов, BOM (`test/unit/onec-clients-validate.test.ts`)
- Импорт apply/dry-run, advisory lock, hash mismatch (`test/integration/onec-clients-import.test.ts`)
- FTP probe mock (`test/unit/onec-ftp-probe.test.ts`)

### Требует проверки источника (не в репозитории)

- Фактическая периодичность выгрузки 1С на FTP
- Бизнес-полнота файла «все клиенты» с точки зрения 1С-специалиста
- Единицы и структура полей `Markups`, `Discount`, `DiscountAmount` в **новых** JSON (упоминались в задачах; **не** в `KNOWN_CLIENT_KEYS`)

---

## 2. Поля JSON `all_clients.json` (текущий контракт импорта)

### Подтверждено кодом — 8 обязательных ключей

| JSON-ключ | Колонка `onec_clients` | Обязательность | Отображение в API/UI |
|-----------|------------------------|----------------|----------------------|
| `guid_client` | `guid_client` PK | да | list + detail `guid` |
| `name_client` | `name_client` | да | list + detail `name` |
| `guid_holding` | `guid_holding` | да (пустая строка → NULL) | holding.id / filter |
| `name_holding` | `name_holding` | да | holding.name |
| `guid_manager` | `guid_manager` | да | manager.id / admin filter |
| `name_manager` | `name_manager` | да | manager.name |
| `address` | `address` | да (пустой → warning) | list + detail |
| `telephone` | `telephone` JSONB array | да (пустой → warning) | phonePreview / phones |

Источник: `src/onec-clients/constants.ts`, `src/onec-clients/validate.ts`, `src/clients/dto.ts`.

### Игнорируется при импорте

- Любые **дополнительные** ключи объекта → warning `unknown_field`, **без сохранения**

### Не в схеме БД / API (нужна новая выгрузка + согласование)

| Группа | Примеры полей (из UI-заглушек / старого ЛК) | Статус |
|--------|---------------------------------------------|--------|
| Реквизиты | legal name, INN, KPP, OGRN, MA, region, city, email | UI placeholder only |
| Команда | regional manager, furniture manager, ROP | UI placeholder only |
| Коммерция | client type, payment form, discount, markups, plan | UI placeholder only |
| Торговые точки | store list, delivery points | UI: «ещё не подключены» |
| Связи | user ↔ employee 1C, legal hierarchy | **нет** |

---

## 3. Связи сущностей

### Подтверждено кодом

- **`users` ↔ `onec_clients`:** явный комментарий миграции «no FK to users»; join отсутствует
- **`guid_holding`:** атрибут строки клиента; **не** нормализованная таблица холдингов
- **`guid_manager`:** UUID менеджера **из 1С** на записи клиента; **не** `users.id` и **не** профиль ЛК
- **`guid_client`:** смысл «клиент» в UI; задача уточняет, что это **не** утверждение «юрлицо» или «ТТ»

### Запрещено без контракта

- Связывать холдинг / юрлицо / ТТ / адрес доставки по совпадению `name_*` или `address`
- Показывать фиктивные значения для неподключённых полей (в UI: «Подключение данных не завершено»)

---

## 4. Auth и область видимости

### Подтверждено кодом

| API | Доступ |
|-----|--------|
| `/api/auth/login`, `/api/auth/logout`, `/api/auth/me` | auth flow |
| `/api/profile/self` | любой активный пользователь |
| `/api/clients/*` | **`requireAdmin`** — только `role === 'admin'` |

Фильтр `?manager=<uuid>` — **ручной фильтр администратора**, не автоматическая «моя база».

### Подтверждено тестами

- Все роли кроме `admin` → 403 на `/api/clients` (`test/integration/clients-workspace.test.ts`)
- 401 без сессии; disabled user не логинится

### Нужно реализовать для R1

- Таблица/поле связи пользователя ЛК с ID сотрудника 1С
- Серверные правила: manager → свои клиенты; regional / ROP → согласованная иерархия (**требует бизнес-спецификации**, не только код)

---

## 5. Актуальность данных

| Сигнал | Источник | UI |
|--------|----------|-----|
| Время загрузки **строки** | `onec_clients.last_imported_at` | detail: «Загрузка записи … (МСК)» |
| Последний **успешный** импорт | `onec_client_import_runs` | list: sync-status |
| Время изменения в 1С | **нет в контракте** | **не** показывается (корректно) |

---

## 6. HTML / API граница

- `GET /clients`, `GET /clients/:guid` — HTML оболочка **без auth** (подтверждено integration test)
- Данные — только через `/api/clients/*` под admin-сессией + frontend `ensureAdminAccess`
