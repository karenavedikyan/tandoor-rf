# Сценарии приёмки доступа — R1.3-prep

**Назначение:** спецификация **будущих** интеграционных и e2e тестов R1.3 / R4.3.  
**Не является** отчётом о выполненных проверках.  
**SHA main (база):** `d2ece0bede51a4543c0ab8c7c9b30435fabefed0`  
**См.:** [access-matrix.md](./access-matrix.md) · [access-rules.md](./access-rules.md)

## Условные обозначения

- **M-A**, **M-B** — менеджеры с разными `employee_id` и непересекающимися клиентами.
- **ROP-1** — РОП команды M-A.
- **REG-1** — региональный с назначением только на **ТТ-X**.
- **ASST-1** — ассистent.
- **C1**, **C2** — клиенты (GUID); **C1** ∈ M-A, **C2** ∈ M-B.
- **TT-X** — торговая точка; **H1** — холдинг.

---

## 1. Два менеджера с разными клиентами

| ID | Условие | Действие | Ожидаемый результат |
|----|---------|----------|---------------------|
| ACC-01 | M-A active, link 1С OK, клиенты C1∈M-A | `GET /api/clients` | 200; items **только** C1 (и свои); total = count своих |
| ACC-02 | M-A | `GET /api/clients/{C2}` | **404** (или 403 по политике); тело без данных C2 |
| ACC-03 | M-A | `GET /clients/{C2}` UI | «не найден» / «нет доступа»; без leak имени |
| ACC-04 | M-B | `GET /api/clients?q=<имя C1>` | 200; items **пусто**; total=0 |
| ACC-05 | M-A | фильтр manager= M-B employee | options **не содержат** чужих; list пуст |

---

## 2. Прямой запрос чужого ID

| ID | Условие | Действие | Ожидаемый результат |
|----|---------|----------|---------------------|
| ACC-10 | M-A | `GET /api/clients/{C2}` | 404/403; JSON error без PII |
| ACC-11 | M-A | перебор UUID (rate limited) | нет diff timing/size для exist vs forbidden |
| ACC-12 | M-A | export/bulk (будущее) | только C1; audit log |

---

## 3. РОП своей и чужой команды

| ID | Условие | Действие | Ожидаемый результат |
|----|---------|----------|---------------------|
| ACC-20 | ROP-1, команда {M-A} | `GET /api/clients` | все клиенты менеджеров команды |
| ACC-21 | ROP-1 | `GET /api/clients/{C2}` (M-B вне команды) | 404/403 |
| ACC-22 | ROP-1 | создать delegation M-A → ASST-1 | 201; audit |
| ACC-23 | ROP-2 (чужая команда) | `GET /api/clients` клиентов ROP-1 | без данных ROP-1 |

---

## 4. Региональный — назначение только на одну ТТ

| ID | Условие | Действие | Ожидаемый результат |
|----|---------|----------|---------------------|
| ACC-30 | REG-1 grant только TT-X | list clients | только клиенты/контекст TT-X |
| ACC-31 | REG-1, TT-X ⊂ H1 | открыть финансы/коммерцию H1 | **запрещено** или «недоступно» |
| ACC-32 | REG-1, другая TT-Y same city | `GET` TT-Y | 404/403 |
| ACC-33 | REG-1 | filter by region=city | **не расширяет** scope beyond grants |

---

## 5. Ассистент: до, во время, после замещения

| ID | Условие | Действие | Ожидаемый результат |
|----|---------|----------|---------------------|
| ACC-40 | delegation draft, starts завтра | ASST-1 `GET /api/clients/{C1}` | 404/403 |
| ACC-41 | delegation active, C1 in scope | ASST-1 `GET /api/clients/{C1}` | 200; рабочие поля; **не** admin endpoints |
| ACC-42 | active | ASST-1 `GET /api/clients/{C2}` | 404/403 |
| ACC-43 | ends_at прошло | ASST-1 `GET /api/clients/{C1}` | 404/403 немедленно |
| ACC-44 | после отзыва | M-A `GET` задачи/черновики ASST | работа возвращена; история ASST видна в audit |

---

## 6. Два одновременных замещения

| ID | Условие | Действие | Ожидаемый результат |
|----|---------|----------|---------------------|
| ACC-50 | ASST-1: M-A→C1 и M-B→C2 active | list | C1 ∪ C2 |
| ACC-51 | ASST-1 | `GET C1`, `GET C2` | оба 200 |
| ACC-52 | отозвать только M-A delegation | `GET C1` | 403; `GET C2` still 200 |

---

## 7. Досрочный отзыв

| ID | Условие | Действие | Ожидаемый результат |
|----|---------|----------|---------------------|
| ACC-60 | active delegation | ROP revoke | status=revoked; ASST теряет доступ на след. запрос |
| ACC-61 | revoked | ASST повтор `GET C1` | 404/403 |
| ACC-62 | revoked | audit | revoke_reason, revoked_by записаны |

---

## 8. Отсутствующая и конфликтная привязка к 1С

| ID | Условие | Действие | Ожидаемый результат |
|----|---------|----------|---------------------|
| ACC-70 | user без `user_onec_link` | login | OK (если active) |
| ACC-71 | нет link | `GET /api/clients` | 403 или 200 empty + warning (**на согласование**) |
| ACC-72 | 2 users → 1 employee_id | любой clients API | 403 до разрешения конфликта |
| ACC-73 | auto-match по email= name_manager | система | **не выполняется**; no link created |

---

## 9. Заблокированная учётная запись

| ID | Условие | Действие | Ожидаемый результат |
|----|---------|----------|---------------------|
| ACC-80 | status=disabled | login | 401 идентичный unknown user |
| ACC-81 | disabled, старая session cookie | `GET /api/clients` | 401 |
| ACC-82 | invited (не active) | login | отказ (**уточнить** политику invited) |

---

## 10. Утечка через поиск, фильтры, счётчики, экспорт

| ID | Условие | Действие | Ожидаемый результат |
|----|---------|----------|---------------------|
| ACC-90 | M-A | `GET /api/clients/options` | managers/holdings **только** из scope M-A |
| ACC-91 | M-A | `GET /api/clients` total | = count(C own), не 3808 |
| ACC-92 | M-A | search substring имени C2 | 0 results |
| ACC-93 | M-A | phone filter matching C2 phone | 0 results |
| ACC-94 | M-A | export | только C1; event in audit |
| ACC-95 | M-A после admin visit same browser | back button | no cached admin JSON (no-store) |

---

## 11. Скрытые комментарии рекламации (R2.4)

| ID | Условие | Действие | Ожидаемый результат |
|----|---------|----------|---------------------|
| ACC-100 | M-A имеет C1 | открыть рекламацию C1 | только **published summary** |
| ACC-101 | M-A | API claim detail | нет internal comments, assignee chat |
| ACC-102 | M-A | попытка ID задачи B24 напрямую | 403/redirect B24 with own ACL |

---

## 12. Дополнительные сценарии (admin, director, hierarchy)

| ID | Условие | Действие | Ожидаемый результат |
|----|---------|----------|---------------------|
| ACC-110 | admin | `GET /api/clients` | 200 all (current behavior) |
| ACC-111 | director confirmed | list | все sales clients |
| ACC-112 | manager grant holding H1 | open legal entity L2 not in H1 | 404 |
| ACC-113 | grant TT-X only | aggregate sales H1 | «недоступно», не fake TT split |

---

## Статус

| Категория | Сценариев | Автотесты R1.3 |
|-----------|-----------|----------------|
| Менеджеры / IDOR | ACC-01…12 | ❌ не реализованы |
| РОП / regional | ACC-20…33 | ❌ |
| Ассистент / delegation | ACC-40…62 | ❌ (R4.3) |
| Identity / block | ACC-70…82 | частично auth tests |
| Leak vectors | ACC-90…95 | ❌ |
| Claims | ACC-100…102 | ❌ (R2.4) |

**Текущий факт:** integration `clients-workspace.test.ts` проверяет **403 для manager** (admin-only), не scope по назначениям.
