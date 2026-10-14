# Clients — визуальное соответствие прототипу

PR: https://github.com/karenavedikyan/tandoor-rf/pull/78 (draft), HEAD `5504374`.

Эталон: [Perplexity prototype](https://www.perplexity.ai/computer/a/4f284ecc-6d26-4f4e-9d3d-36b2b7cf314c).  
Сохранённые PNG эталона: store `media/clients-v3-visual-review/prototype/`.  
Пары «эталон / реализация» для этого PR: store `media/clients-visual-pr/`.

## Экраны (роли)

| Экран | Desktop light | Desktop dark | Mobile |
|-------|---------------|--------------|--------|
| manager — список «Моя база» | parity pass (композиция/KPI/таблица) | **исправлено**: фон content-area и поверхности | **исправлено**: карточки списка, отступы |
| assistant — баннер замещения | стиль баннера в палитре Golos | dark tokens | mobile spacing |
| regional — вход + KPI | PARTIAL (заголовки роли OK) | dark tokens | PARTIAL |
| rop — KPI + «Моя база» / команда | PARTIAL (compact team vs employee cards) | dark tokens | PARTIAL |
| director — «Все клиенты» / teams grid | PARTIAL | dark tokens | PARTIAL |
| admin — 1C bar + field map link | PARTIAL (bar layout) | dark tokens | PARTIAL |

## Закрыто в этом PR (только presentation)

- Тёмная тема для `.clients-design-page .legacy-content` (палитра как у карточки клиента).
- Hover строк таблицы через `--rf-row-hover`, без hardcoded `#fafbfc`.
- Mobile list cards: заголовок — ссылка `.clients-link`, метаданные — отдельные строки `.clients-card__line`.
- Desktop padding content `24px 28px`, multiselect filters/chips, sticky search на mobile.
- Ссылки в таблице v3 — класс `.clients-link` (цвет прототипа).

## Оставшиеся visual gaps

- Pixel parity KPI/employee card vs прототип (прототип — другой IA: нет отдельной «карточки сотрудника» у manager в эталоне).
- Фильтры: прототип — field-builder + chip row; реализация — v3 multiselect + chips активных фильтров (визуально ближе, но не 1:1).
- Row quick actions / декоративные кнопки строки — в прототипе есть, в продукте не показываем.
- РОП «Моя команда»: compact team vs полноразмерные employee cards прототипа.
- Admin «По командам» / field map — layout PARTIAL.

## Functional gaps (вне scope PR)

- Row actions без API-контракта.
- Field-builder (INN/TOP/…) и legacy-only поля фильтров.
- ЛПР на legal entity, публикация `#орк` и прочие R2-контракты.

## Проверки

- `npm run typecheck`, `npm run build`
- Browser: `clients-v3*.test.ts`, `clients-v3-roles-entry.browser.test.ts`, `clients-v3-visual-acceptance.browser.test.ts` (capture)
