# Тандор: короткий пилот кода приёма в Telegram и MAX

**Task:** `TANBOT-RECEIPT-CODE-PILOT-20261029`  
**Branch:** `cursor/tanbot-max-stage1-20261029`  
**Status:** код подготовлен; **живой пилот не запущен** (нет merge/deploy, реальных webhook/сообщений, production migrations).

## Цель

Один рабочий процесс: получатель B получает **код приёма** в привязанном Telegram или MAX боте и передаёт его A; A вводит код в Тан-трекере. Выпуск кода **не** принимает передачу.

## Участники и данные

| Роль | Действие |
|------|----------|
| **A (передающий)** | Создаёт учебные передачи, вводит код от B в LK |
| **B (получатель)** | Привязки Telegram и MAX отдельно, согласие на канал |
| **C** | Только автоматический QA (запрет чужого кода), не живой участник |

Учебные передачи (без клиентских документов): **P-TG-01** (Telegram), **P-MAX-01** (MAX).

## Environment (default-off)

| Variable | Default | Purpose |
|----------|---------|---------|
| `TANBOT_HANDOFF_CODE_PILOT_ENABLED` | `false` | Сценарий «Получить код» в ботах |
| `TANBOT_TELEGRAM_*` / `TANBOT_MAX_*` | см. `.env.example` | Каналы независимы; master-off блокирует выдачу и **включение** MAX-уведомлений |
| `TT_HANDOFF_OTP_PEPPER` | server secret | Канонические коды (`tt_handoff_codes`) |

Пилот не включает внешних получателей, новый дизайн tt56, отчёты, 1С/Bitrix.

## Внешние предусловия (оператор)

Без них статус: **код готов / живой пилот заблокирован**.

1. Закрытый HTTPS-стенд (не production); БД не сбрасывается.
2. Секреты (токены, webhook secret, pepper) — только в защищённой конфигурации сервера.
3. Read-only проверка ботов и каналов (Telegram username, MAX bot + TLS trust chain).
4. Согласованные webhook/worker/delivery **только** для пилота; рабочие боты не перезаписываются вслепую.
5. Реальный MAX API/TLS через credential-proxy **не** считается подтверждённым только наличием CA bundle в backend.

## Операторский сценарий (Telegram)

1. A создаёт `P-TG-01`, назначает B ожидающим получателем.
2. B открывает Telegram-бота → список pending → **Получить код** (callback) или `/code`.
3. B сообщает код A; в протоколе — факт выдачи, **не** сам код.
4. A: неверный код → holder не меняется; верный код → принятие B; reload — история и holder сохранены; повтор кода отклонён.

## Операторский сценарий (MAX)

1. A создаёт `P-MAX-01`, назначает B.
2. B в MAX-боте → выбор передачи → **Получить код** (callback).
3. Код только в MAX; A подтверждает в LK.
4. Opt-out/disconnect MAX не меняет Telegram-согласие.

## Безопасное отключение

1. `TANBOT_HANDOFF_CODE_PILOT_ENABLED=false`
2. Остановить **только** pilot worker/subscriptions (по stage1 runbook), не трогая прочие интеграции.
3. БД и историю не очищать.

## Шаблон согласования (не является разрешением)

«Разрешаю пилот на [закрытый адрес] версии [SHA] для A=[сотрудник], B=[сотрудник]: две учебные передачи, коды только в личных чатах B, без клиентских данных. Webhook/worker: [перечень]. Production и массовая рассылка не разрешены».

## Три критерия приёмки (протокол)

| Критерий | Успех | Результат (Cursor QA) |
|----------|--------|------------------------|
| Правильный получатель | B получает код своей pending-передачи в TG и MAX; C — нет | См. отчёт сдачи (integration) |
| Одноразовость | Неверный/истёкший/использованный код отклонён; повтор update не создаёт новый код | См. отчёт сдачи |
| Сохранность | Одно принятие, holder/история после reload; retry доставки без повторной выдачи | Частично integration; browser NOT_RUN |

Поля протокола: SHA, среда, учебный номер, канал, PASS/FAIL, holder до/после, число событий принятия, код ошибки. **Не** сохранять код, токены, raw webhook с ПДн.

## Целевые команды проверки (без секретов)

```bash
npm run typecheck
npm run build
npm test
NODE_ENV=test PGSSLMODE=disable npm run test:integration -- test/integration/tanbot-handoff-code-pilot.test.ts
NODE_ENV=test PGSSLMODE=disable node --import tsx --test test/unit/tanbot-max-delivery-transport.test.ts test/unit/tanbot-max-update-parse-shapes.test.ts
```

Browser happy-path (оператор + Computer): два коротких прогона по каналу — **NOT_RUN** в автоматической сдаче Cursor.
