# Фирменный эталон — инвентаризация и вопросы

Аудит на **`f591f483d5d8886dfa9c4626c9f347622958f204`**.  
**Принятый визуальный прототип** и **официальный брендбук** в репозитории **не найдены** (2026-09-28).

---

## 1. Логотипы (подтверждено в репозитории)

| Файл | Назначение | Тема |
|------|------------|------|
| `public/brand/tandoor-logo-official.svg` | Полный wordmark | светлая |
| `public/brand/tandoor-logo-light.svg` | Полный wordmark | тёмная |
| `public/brand/tandoor-triangle-mark.svg` | Компактная метка (из `tandoor-platform`) | обе |

**Правило:** не перерисовывать; использовать существующие SVG локально.

---

## 2. Шрифты

| Контекст | Шрифт | Источник | Статус |
|----------|-------|----------|--------|
| **tandoor-rf (main)** | **Exo 2** (variable, локально) | `public/fonts/exo-2/` + OFL | подтверждено кодом |
| **tandoor-platform** (read-only @ `79dc78d`) | Exo 2 — UI (`--font-sans`); Open Sans — каталог (`--font-catalog`) | Google Fonts CDN в старом проекте | эталон оформления, не копировать CDN |
| **Golos** | Упомянут в задаче R0.1 как возможное расхождение с прототипом | **не найден** в `tandoor-platform` index.css @ `79dc78d` | **требует согласования владельцем** |

### Вопрос на согласование (не решён)

> Основной шрифт R1: **Exo 2** (как в tandoor-rf и старом app-shell) или **Golos** (если так в принятом прототипе)?  
> Agent **не выбирает** самостоятельно. До решения — **блокер** для финальной UI-приёмки R1.

---

## 3. Цвета и токены (подтверждено кодом)

Файл: `public/brand/legacy-tokens.css` (+ алиасы в `workspace.css`).

| Токен | Светлая | Назначение |
|-------|---------|------------|
| `--rf-bg` | `#eeeff6` | фон приложения |
| `--rf-surface` | `#ffffff` | карточки |
| `--rf-surface-muted` | `#e3e6f3` | вторичная поверхность |
| `--rf-text` | `#222631` | основной текст |
| `--rf-primary` | `hsl(82 57% 51%)` | акцент Tandoor green |
| `--rf-radius` | `0.5625rem` (9px) | скругление |

Тёмная тема: `[data-theme="dark"]` — палитра из старого `index.css` tandoor-platform (адаптирована без Tailwind).

**Правило:** не вводить новые цвета без согласования.

---

## 4. Компоненты UI (текущий main)

| Область | Реализация | Эталон |
|---------|------------|--------|
| Оболочка | sidebar ~260px / compact ~68px, header ~56px, content max ~1400px | `tandoor-platform` app-shell |
| Навигация | SVG icons (`shell-icons.js`), не emoji | монохромные иконки |
| Список клиентов | toolbar, table, mobile cards | старый ЛК / one-c legals table |
| Карточка | секции, collapsible, field rows | `/1c/legal/:id` rhythm |
| Login / profile | legacy tokens, без sidebar на login | согласовано PR #7 |

Layout CSS: `public/brand/legacy-shell.css`, `public/clients.css`, `public/styles.css`.

---

## 5. Адаптивность и состояния (подтверждено PR #7 + тестами)

- Breakpoint desktop sidebar: **1024px**
- Mobile drawer: full width, focus trap, `inert` при закрытии
- Темы: light default, toggle → localStorage `tandoor-rf-theme`
- Collapsed sidebar: только desktop; не ломает mobile drawer (fix `3a285d9`)

DOM-тесты: `test/unit/legacy-shell-dom.test.ts` (116 unit total on main).

---

## 6. Противоречия / блокеры UI

| # | Тема | Статус |
|---|------|--------|
| B1 | Принятый **визуальный прототип** не в repo | **блокер** — нужен артеfact от владельца |
| B2 | **Golos vs Exo 2** | **вопрос на согласование** |
| B3 | Open Sans для каталога | в R1 каталога нет; не переносить без scope |
| B4 | Google Fonts CDN | tandoor-rf использует **только локальные** шрифты — корректно для prod |

---

## 7. Что не является официальным брендбуком

- CSS tandoor-rf и tandoor-platform — **рабочие эталоны**, не замена PDF/FIGMA брендбука
- UI-заглушки «Подключение данных не завершено» — **не** утверждённый контент 1С
