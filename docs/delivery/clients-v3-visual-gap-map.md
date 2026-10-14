# Clients v3 — оставшиеся отличия от прототипа (после UI-коммита)

Эталон: [Perplexity prototype](https://www.perplexity.ai/computer/a/4f284ecc-6d26-4f4e-9d3d-36b2b7cf314c).

## Закрыто в этом коммите (код)

| Область | Было | Стало |
|---------|------|--------|
| H1 / IA | «Юрлица» перезаписывал role `pageTitle` | Ролевой `pageTitle` + subtitle для сущности |
| Entity switcher | «Юрлица» | «Клиенты» |
| Manager list | 4 колонки | 5 колонок (+ фурнитура), holding name |
| Счётчик | «N записей» | «Найдено N клиентов/ТТ…» |
| Пустой поиск | generic empty | «Ничего не найдено» + текст запроса |
| Фильтры тип/категория | single select | multiselect + `typeGuids`/`categoryGuids` (OR, whitelist) |
| Admin field map | нет route | `/clients/field-map` + `GET /api/clients/v3/field-catalog` (admin) |
| Карточка legal | скидки внутри «Юрлицо» | секция «Скидки и наценки» + empty state |

## Карточка: поле прототипа → источник → gap

| Прототип | Источник v3 detail | Gap |
|----------|-------------------|-----|
| Скидка / сумма / наценки | `discount`, `discount_amount`, `markups` | нет (read-only) |
| ЛПР (legal) | — | нет `lpr_information` на `onec_v3_legal_entities` |
| ЛПР (ТТ) | `lpr_information` JSONB | нет (read-only) |
| ИНН / TOP / field-builder | legacy filters | не в v3 exchange fixtures; фильтры не показываем |

## Действия строки прототипа

| Действие | Маршрут / API | Роли | Запись |
|----------|---------------|------|--------|
| Открыть карточку | `/clients/:guid?v3Entity=…` | read scope | нет |
| Быстрые операции прототипа | — | — | **нет контракта** — нужен перечень от владельца |

## Визуал: ещё FAIL / PARTIAL

- Row quick actions (нет backend).
- Полный field-builder (INN/TOP/…) — ждёт контракт полей v3.
- Employee cards РОП vs compact team — частичный CSS pass; не pixel parity.
- NOT RUN: fault injection retry, все роли card+return, тёмная тема всех ролей — нужен прогон capture на новом SHA.

## Вопрос владельцу (точечно)

Перечень **разрешённых** row actions (название → существующий route/API → роли) для подключения без декоративных кнопок.
