# F6 — отчёт о дозаполнении и сверке (Draft)

**Дата (UTC):** 2026-10-08  
**Base:** `main` @ `feb4baa` (merge PR #69, F5)  
**Ветка:** `cursor/f6-data-verification-9e11`  
**Статус:** локальная test-БД и read-only источники проверены; **production apply не выполнялся**. Серия F **не** закрыта.

---

## 1. Доступность источника (read-only)

| Проверка | Результат (агент 2026-10-08) |
|----------|------------------------------|
| `/LC/clients/all_clients.json` на VM агента | **недоступен** (readable: false) |
| `AUDIT_CLIENTS_PATH` | **не задан** |
| Historical audit fixture | **есть** — `test/fixtures/onec-clients/recovered-exchange-structure.json` |

**Historical audit (не «актуальная выгрузка»):**

| Поле | Значение |
|------|----------|
| capturedAt | 2026-10-04T09:48:27.658Z |
| auditedAt | 2026-10-08 |
| SHA-256 | `b439063b1602743ab1df56ee6390ba9d3cc64dce7cdc24763c3d4d7176c74b74` |
| bytes | 20 956 436 |
| clients / outlets | 3 087 / 473 |
| freshFtpRead | false |

**Заполненность ключей F2–F5 (агрегаты, без значений):**

| JSON-путь | present | nonempty |
|-----------|---------|----------|
| `Оптовик_Топ150` | 3087 | 3087 |
| `Оптовик_КатегорияТорговойТочкиТандор` | 3087 | 2961 |
| `Контрагент` | 3087 | 3087 |
| `НаименованиеПолное` | 3087 | 3087 |
| `ЮрФизЛицо` | 3087 | 3087 |
| `Оптовик_ОГРН` | 3087 | 2489 |
| `Оптовик_ОсновнойДоговор` | 3087 | 2627 |
| `Оптовик_ОсновноеСоглашение` | 3087 | 2698 |
| `Код` | 3087 | 3087 |

Повторный probe: `node --import tsx scripts/f6-source-availability-check.ts`.

---

## 2. Матрица приёмки F1–F5

См. [f6-acceptance-matrix-f1-f5.md](./f6-acceptance-matrix-f1-f5.md).

---

## 3. Локальная test-БД: regular-update / backfill

**Прогон 2026-10-08 (после усиления приёмки):**

| Suite | Команда | tests | pass | fail |
|-------|---------|-------|------|------|
| F6 unit | `node --import tsx --test test/unit/f6-source-availability.test.ts` | 1 | 1 | 0 |
| F6 combined backfill | `test/integration/onec-f6-combined-f2-f5-backfill.test.ts` | 3 | 3 | 0 |
| F6 API scope | `test/integration/clients-f6-api-access-scope.test.ts` | 4 | 4 | 0 |
| F6 browser 1440/390 | `test/browser/clients-f6-prototype-local.browser.test.ts` | 1 | 1 | 0 |
| F2 backfill + gates | `test/integration/onec-f2-wholesale-upgrade-backfill.test.ts` | 8 | 8 | 0 |
| F3 backfill | `test/integration/onec-f3-counterparty-upgrade-backfill.test.ts` | 5 | 5 | 0 |
| F4 backfill | `test/integration/onec-f4-client-contract-upgrade-backfill.test.ts` | 5 | 5 | 0 |
| F5 backfill | `test/integration/onec-f5-client-code-upgrade-backfill.test.ts` | 4 | 4 | 0 |
| typecheck | `npm run typecheck` | — | ok | — |
| build | `npm run build` | — | ok | — |

**F6 combined (детали):** после gap проверяются **все четыре** блока (`wholesaleExchange`, `counterparty`, `clientContract`, `clientCode`) и **полный** LPR (включая `bonus: "0"`). Rollback D: в транзакции записаны все 4 блока; после ERROR snapshot совпадает с pre-apply gap; recovery + repeat → `NO_CHANGES`.

Extended confirmation **не** обходился; force/hash substitution **не** использовались.

---

## 4. API scope (real app, без mock)

| Роль | Проверка | Тест |
|------|----------|------|
| admin | F2–F5 list + card | `clients-f6-api-access-scope.test.ts` (4/4 pass) |
| director | full base, F2–F5 card | да |
| manager | доступная ТТ + LPR; соседняя ТТ скрыта в list/detail/filter; foreign 404 | да |
| preview | scope как manager; write review 403 | да |

---

## 5. UI 1440 / 390 vs прототип

**Эталон:** https://www.perplexity.ai/computer/a/4f284ecc-6d26-4f4e-9d3d-36b2b7cf314c  
**Проверка:** локальный сервер + test-DB, **без** mock API — `clients-f6-prototype-local.browser.test.ts`.

**Подтверждено локально (real API, 1/1 pass):** видимая форма фильтра → list 200 → карточка с **раскрытыми** значениями F2–F5 и F1 LPR на синтетической ТТ; back → reload → reset; `waitForResponse` на GET `/api/clients` **до** goto/reload/click/change; guards `pageerror` + 5xx.

**Расхождения / не проверено (не заявлять parity):**

| Тема | Статус |
|------|--------|
| Полный pixel-perfect прототип F6 URL | **не** загружался на агенте (timeout); side-by-side **не** выполнен |
| Секции «Расчёты и договор» (оплата, лимиты, бухгалтерия) | в JSON F1–F5 **нет** подтверждённых ключей — placeholder UI |
| Справочник юрлиц 0..N, ИНН, city, cashback | **не** подключены (`hasSource: false`) |
| Production данные и scope на реальных 3k клиентов | **не** проверено в F6 Draft |

Скриншоты (local real API, раскрытые значения):

- `/opt/cursor/artifacts/screenshots/f6-local-list-desktop-1440.png`
- `/opt/cursor/artifacts/screenshots/f6-local-card-desktop-1440-expanded.png`
- `/opt/cursor/artifacts/screenshots/f6-local-card-mobile-390-expanded.png`

---

## 6. Production runbook

См. [f6-production-regular-update-runbook.md](./f6-production-regular-update-runbook.md). **Apply на prod не запускался.**

---

## 7. Оставшиеся пробелы

- Read-only доступ к **актуальному** `all_clients.json` на Computer (SHA, counts) и post-apply сверка fill-rates в prod.
- F6 URL прототип — ручная или staging сверка секций «Холдинг / юрлица», «Магазин и доставка», «Особенности работы».
- Неподтверждённые поля и справочники 0..N — вне F6.
- **Серия F не завершена** до production verification.
