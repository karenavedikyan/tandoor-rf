# Clients — визуальное соответствие прототипу (#clients)

PR: https://github.com/karenavedikyan/tandoor-rf/pull/78 (draft), HEAD `3a9e7e3` (presentation code `3ffaf82`).

Эталон: [Perplexity «3. Клиентская база»](https://www.perplexity.ai/computer/a/4f284ecc-6d26-4f4e-9d3d-36b2b7cf314c) (`#clients`, не экран #exchange «28. Клиенты, ТТ и ответственные»).

Скриншоты реализации (#clients): store `media/clients-visual-pr/captures-3ffaf82/`.  
PNG из `media/clients-v3-visual-review/prototype/` — IA exchange; не использовать как эталон #clients без проверки.

## Экраны (роли)

| Экран | Desktop light | Desktop dark | Mobile |
|-------|---------------|--------------|--------|
| manager — «Моя база» | KPI band + dense toolbar (search + multiselect + «Сбросить» в одну строку) | content/surface/tables/teams в палитре Golos | плоский список, dividers |
| assistant — замещение | баннер + compact employee + KPI | dark tokens | spacing списка |
| regional | как manager (dense filters) | dark tokens | список |
| rop / director / admin | KPI 3/5 кол., compact teams, employee строка | toolbar/results/KPI/teams контрастнее | teams/list |
| карточка клиента (v3) | секции, back-link, wrap UUID/SHA | секции + back-link | wrap длинных значений |

## Закрыто в PR (только CSS + presentation markup v3 list/card)

- **Шапка / KPI:** `clients-role-head` — compact employee + scope (без большой карточки); KPI в `clients-kpi-band` (существующие показатели, без новых расчётов).
- **Порядок chrome:** manager/regional — `clients-manager-chrome` до view-switcher; 1C update в `clients-page-header`.
- **Фильтры manager/regional desktop:** `clients-toolbar--dense` — одна строка: поиск, multiselect, «Сбросить», entity/columns; меньше vertical gap; без field-builder/chips exchange.
- **Teams / dark:** плоский `clients-compact-team-list`, плотные rows; dark — таблицы, KPI band, teams, toolbar/results shell.
- **Список mobile:** один контейнер, `.clients-link` на заголовках.
- **Карточка:** `client-card-prototype.css` — секции v3, `client-detail-back`, `overflow-wrap` / `word-break` для dd, pre, code, UUID.
- **Sidebar dark logo:** `legacy-shell.css` overlay на `.legacy-sidebar__brand`.

## Оставшееся (visual, не блокирует merge по scope)

- Pixel-perfect vs live Perplexity без сохранённого reference PNG именно для #clients.
- Декоративные row actions прототипа — намеренно не показываем.
- Admin «По командам» / field map — мелкие отличия сетки vs прототип.

## Functional (вне scope PR)

- Row actions, field-builder INN/TOP, API/SQL/auth/navigation/1С/Bitrix24.

## Final review captures (3a9e7e3)

- **Git SHA:** `3a9e7e3` (`3a9e7e366aa139a260209bb715fa3b8c44bb07f5`)
- **Roster state:** director/admin → teams → ROP One → **navigation to `ropEmployee` roster** (не mislabeled collapsed overview); responsibles loaded.
- **DOM verified:** `.clients-team-member-row__name` — Manager One, Manager Two, Regional One, Hardware One.
- **API artifact zip:** `artifacts/clients-pr78-final-review-3a9e7e3.zip` (PNG + `FILES.txt`).
- **Store copies:** `/cursor/stores/self/media/clients-visual-pr/final-review-3a9e7e3/` — все `impl*.png` и `impl/teams-expanded-{desktop,mobile}.png` из zip.

| Capture | File |
|---------|------|
| Director roster expanded desktop 1440×900 | `impl-director-rop-roster-expanded-desktop-1440x900.png` |
| Director roster expanded mobile 390×844 | `impl-director-rop-roster-expanded-mobile-390x844.png` |
| Admin roster expanded desktop | `impl-admin-rop-roster-expanded-desktop-1440x900.png` |
| ROP own team base desktop | `impl-rop-own-team-base-desktop-1440x900.png` |
| Manager entry desktop / mobile / dark | `impl-manager-entry-desktop-1440x900.png`, `impl-manager-entry-mobile-390x844.png`, `impl-manager-entry-desktop-dark-1440x900.png` |
| Admin entry desktop | `impl-admin-entry-desktop-1440x900.png` |
| Aliases (expanded roster) | `impl/teams-expanded-desktop.png`, `impl/teams-expanded-mobile.png` |

## Проверки (HEAD `3a9e7e3`)

- `npm run typecheck`, `npm run build` — OK
- `clients-v3-roles-entry.browser.test.ts` — 6/6
- `clients-v3.browser.test.ts` — 12/12
- `clients-v3-visual-acceptance.browser.test.ts` — 9/9; captures → `media/clients-visual-pr/captures-3ffaf82/`
