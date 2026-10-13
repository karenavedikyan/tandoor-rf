# Приёмка: раздел «Клиенты» v3 по прототипу

Ветка UI: `cursor/clients-v3-prototype-ui-9e11` (от актуального `main` после merge PR #76).

Прототип: https://www.perplexity.ai/computer/a/4f284ecc-6d26-4f4e-9d3d-36b2b7cf314c

Production в рамках этой задачи **не изменялся**.

## Матрица ролей

| Роль | Стартовый экран (меню → `clientsHref`) | Отличия интерфейса | Область доступа (сервер) | Проверки | Статус |
|------|----------------------------------------|--------------------|---------------------------|----------|--------|
| manager | `v3mode=1`, `v3entity=legal`, `view=all` | «Мои клиенты», portfolio design, без переключателя представлений | v3 list/detail в scope менеджера | unit presentation + browser v3 (manager user) | PASS (частично) |
| regional_manager | `v3entity=retail`, `entity=outlets` | «Мои торговые точки» | outlets/retail в scope | unit presentation | NOT RUN (browser по роли) |
| rop | `view=teams`, `v3view=teams` | команды, навигация РОП | teams + v3 после выбора ответственного | unit presentation | NOT RUN (browser по роли) |
| director | `view=teams`, director layout | обзор отдела, ревизии read-only | fullClientBase | unit presentation | NOT RUN |
| admin | `view=teams`, director layout | полная база, ревизии с записью | admin policies | integration sync-status v3 | PASS (частично) |
| assistant | как manager | замещение | scoped | unit presentation | NOT RUN |

## Дефекты (регрессия)

| Сценарий | Статус |
|----------|--------|
| `v3view=all` + `view=teams` → список v3, не «Выберите РОП» | PASS (unit + browser) |
| Возврат из карточки: `return` содержит `view=all` согласованно с `v3view` | PASS (browser) |
| sync-status: v3 apply при пустом legacy journal → не `never` | PASS (integration) |

## Оставшиеся отличия от прототипа

- Полный визуальный паритет каркаса/типографики/плотности — в работе; переиспользуются `clients-design.css`, portfolio chrome по ролям.
- Скриншоты сравнения по всем ролям — требуют прогона browser acceptance с legacy fixtures (four-roles) и v3 seed; в этом PR приоритет — v3 + навигация + freshness.
- Мобильный эталон прототипа — проверен только в `clients-v3.browser.test.ts` (manager).

## Критерии PASS задачи

- [x] Единое состояние URL `view` / `v3view` / `v3entity` при v3mode
- [x] Ролевой `clientsHref` с v3-параметрами
- [x] Freshness по v3 при активном exchange v3
- [ ] Полный визуальный паритет всех ролей с прототипом (открытый пункт)
