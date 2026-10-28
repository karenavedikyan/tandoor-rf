# Tan-tracker tt56 → LK parity map

**Эталон (только чтение):** SHA `7f28457d3f76d262f4b0c7313c865ad3b482c866`, worktree `.tt56-prototype-ref/`.  
**Реализация:** ветка `cursor/tan-tracker-lk-tt56-20261028`, от `origin/main`.

Перенос = копия DOM/CSS/поведения tt56 + серверные данные/пraва. Демо-обходы в LK **скрыты/отключены по мере реализации**; полная зачистка demo-copy и public recipient — см. статус ниже.

## Baseline прототипа (tt56)

| Проверка | Результат |
|----------|-----------|
| QA `tan-tracker-*-qa.js` (26 файлов) | **582** проверки, 0 failures (прогон на эталоне `7f28457`, Node 22 + Playwright) |
| Скриншоты | `qa-screens/tt56/` в эталоне |
| Запуск | `cd .tt56-prototype-ref && node run-browser-qa.mjs <file>` |

## Исходники → рабочие файлы

| Эталон (tt56) | LK |
|---------------|-----|
| `site/tan-tracker.js` | `public/tan-tracker/tan-tracker.js` (+ `#tt-root-host`, `hydrateFromServer`, без seed в LK) |
| `site/tan-tracker.css`, `tan-tracker-ui.css` | `public/tan-tracker/*.css` (копия) |
| `site/tan-tracker-attachments.js` | `public/tan-tracker/tan-tracker-attachments.js` (адаптация upload → API — **в работе**) |
| `site/tan-tracker-scope.js` | `public/tan-tracker/tan-tracker-scope.js` (UI) + `src/tan-tracker/scope.ts` (сервер) |
| `site/assets/qrcode-generator.js` | `public/tan-tracker/assets/qrcode-generator.js` |
| `site/index.html` (порядок CSS/JS) | `public/tan-tracker.html` + `tan-tracker-lk-shell.js` + `tan-tracker-lk-boot.js` + `tan-tracker-lk-theme.css` (мост `--rf-*` → `--surface`/`--text`) |
| `run-browser-qa.mjs`, `tan-tracker-*-qa.js` | Перенос/адаптация к `/api/tan-tracker` — **следующий этап** |
| Seed orders/contacts | PostgreSQL `052_tan_tracker.sql` + `/api/tan-tracker/bootstrap` |

## Экраны и состояния

| Экран / состояние | Эталон | LK API / UI | Тест | Статус |
|-------------------|--------|-------------|------|--------|
| Реестр (таблица 1440, карточки 390, фильтры, поиск) | `registryView` | `tan-tracker.js` + `GET bootstrap` | `tan-tracker-redesign-qa.js` | UI скопирован; данные с сервера — **частично** (bootstrap) |
| Мастер 4 шага | `createView` / `wizardShell` | `POST /transfers` + `tan-tracker-lk-api.js` | wizard QA | API **да**; browser QA на LK — **нет** |
| Карточка передачи | `detailView` | `tan-tracker.js` | detail-* QA | UI да; pending cancel/change + code verify — **API да** |
| Меню «⋯» popover | tt56 overflow | CSS/JS tt56 | redesign QA | UI да |
| Код / QR handoff | `codeView`, QR host | `POST .../code/generate|verify` | demo-code QA | Код **да**; QR signed links — **нет** |
| Экран получателя | `recipientScreen` | `/tan-tracker/recipient` route | attachments/recipient QA | **нет** (отдельный public route) |
| Terminal / former sender | `detailView` variants | server scope | former-sender QA | scope TS; UI — с данными |
| Завершение цепочки | `completed` status | `tt_transfers.status` | relay/terminal QA | схема да; логика — **нет** |

## Обязательные отличия production (не баг)

| Элемент прототипа | В LK |
|-------------------|------|
| `?role=&tt_emp=` переключение роли | **Удалено** — роль из сессии |
| Demo settings, «Действовать как…», demo employee select | **Скрыто** (`tt-lk-mode`) |
| «Подтвердить номер (демо)», demo OTP | **Замена** SMS-провайдером; без конфига — fail-closed (`PhoneVerificationUnavailableError`) |
| `seedOrders` / localStorage | **Нет** — PostgreSQL |
| In-memory attachments | **Private storage** + `tt_transfer_attachments` |

## Блокеры (честно)

1. **SMS/OTP:** провайдер не подключён; `TT_PHONE_VERIFICATION_PROVIDER=test` только в тестах.
2. **Остаток API:** attachments upload/download, QR handoff, public recipient + phone verify, complete-order explicit.
3. **E2E против живого API:** integration `test/integration/tan-tracker-bootstrap-scope.test.ts` (нужен `TEST_DATABASE_URL`); 26 прототипных QA — только на эталоне `7f28457`.

## Следующие шаги исполнителя

1. Реализовать mutations + invitation versioning + rate limits.
2. Подключить `tan-tracker-attachments.js` к `POST/GET /api/tan-tracker/.../attachments`.
3. Public recipient route без ЛК shell + phone verify flow.
4. Адаптировать 26 QA-скриптов к `npm run test:browser` / integration.
