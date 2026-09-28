# Synthetic 1C clients fixtures (R0.2)

Обезличенные примеры для **локальных unit-тестов** валидатора `validateClientsFileBytes`.

- **Значения вымышлены**; форма основана на структурном аудите снимка 23.09.2026; **это не исходная выгрузка**.
- `extra-unknown-fields.json`: `Discount` (string), `DiscountAmount` (number), `Markups[]` с `Name`/`Percentage` — только для теста `EXTRA_FIELDS`.
- Не коммитить сюда реальные FTP-файлы или PII.

См. [docs/delivery/clients-field-contract.md](../../docs/delivery/clients-field-contract.md).
