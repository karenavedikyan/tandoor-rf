# Приёмка: раздел «Клиенты» v3 по прототипу

PR: https://github.com/karenavedikyan/tandoor-rf/pull/77  
Production **не изменялся**.

## Матрица ролей (функция / ACL / UI / desktop-mobile)

| Роль | Старт (меню) | Функция | ACL / scope | UI vs прототип | Desktop | Mobile |
|------|--------------|---------|-------------|----------------|---------|--------|
| manager | `v3entity=legal`, `view=all` | список v3, фильтры, карточка | только свои юрлица/ТТ | portfolio chrome, ролевые колонки | browser entry + v3 flow | `.clients-card__meta` в browser |
| regional_manager | `v3entity=retail`, `entity=outlets` | retail list | retail scope | retail-first entry | browser entry | NOT RUN |
| rop | `view=teams`, `v3view=teams` | teams → ответственный → list | команда РОП | teams default | browser entry | NOT RUN |
| director | `view=teams` | обзор отдела | fullClientBase | director layout | browser entry | NOT RUN |
| admin | director layout | teams↔all, v3 filters | admin | как director + admin | browser 5/5 | mobile в browser #5 |
| assistant | как manager (presentation) | — | scoped | — | NOT RUN | NOT RUN |

Скриншоты реализации (локальная приёмка): `/opt/cursor/artifacts/screenshots/impl-role-*.png`  
Эталон прототипа: `/opt/cursor/artifacts/screenshots/prototype-*.png`

## Исправления по ревью PR #77

| Замечание | Статус |
|-----------|--------|
| Перенос выбора ответственного manager/regional/hardware в v3 API | PASS — `v3ResponsibleFromLegacyState` (kind до stale `responsibleGuid`), `legacyStringField` для `ropEmployee`/`v3type`, `loadSource=url` vs navigation |
| Очистка ответственного / смена A→B | PASS — unit + browser (M1/M2, сброс на «Все клиенты») |
| Compact teams на v3 | PASS — `useExchangeV3` → `/api/clients/v3/org-structure/.../responsibles` |
| URL не перетирает user action | PASS |
| sync-status read-only + expired pending job | PASS — integration (requested_at/expires_at) |
| Browser: карточка (тип/категория, РОП), nested holding | PASS — browser #5 |
| Role menu entry regional/ROP/director | PASS — `clients-v3-roles-entry.browser.test.ts` |

## Команды тестов (Node 22.14.0)

- `npm run typecheck` — PASS  
- `npm run build` — PASS  
- `npm test` — 694/694 PASS  
- `node --import tsx --test test/integration/clients-v3-api.test.ts` — 6/6 PASS  
- `node --import tsx --test test/browser/clients-v3.browser.test.ts` — 5/5 PASS, exit 0  
- `node --import tsx --test test/browser/clients-v3-roles-entry.browser.test.ts` — 4/4 PASS, exit 0  

## Оставшиеся отличия

- Полный визуальный паритет regional/ROP/director **по всем вкладкам и действиям** vs прототип — только entry + часть browser; mobile для regional/ROP/director — **NOT RUN**.  
- Часть legacy-колонок прототипа вне v3 list DTO.  
- Скриншоты прототипа Perplexity — внешний эталон, сравнение с `impl-role-*.png` вручную.
