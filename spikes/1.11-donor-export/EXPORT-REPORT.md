# EXPORT-REPORT — отчёт выгрузки донора (спайк 1.11)

Заполняется по `EXPORT-RECIPE.md`. Маркеры фактов: **`VERIFIED-on-prod`** ·
**`apparatus-verified-on-sample`** · **`PENDING-prod-access`**.

**Решение гейта A1:** путь **A** (доступ к выгрузке донора организационно
доступен) — Bratan, 2026-06-18. Реальная выгрузка (Task 3) делегирована
владельцу доступа; аппарат доказан на образце (ниже).

---

## 1. Аппарат — `apparatus-verified-on-sample` ✅ (2026-06-18)

Прогон `profile_export.py` на образце донор-формата
`Backend/VAPS/apps/migration_legacy/tests/fixtures/donor_slice.json`. Числа
сходятся с известным составом фикстуры — аппарат корректен, реальная выгрузка
сводится к механическому прогону.

```
ОБЪЁМ ПО МОДЕЛЯМ:
    divisions.division      : 3
    dictionaries.rank       : 2
    dictionaries.position   : 2
    employees.employee      : 6
    staff_unit.staffunit    : 6
    statuses.employeestatus : 12
    (лишняя: auth.user : 1 — рецепт её не выгружает)

employees.employee:
    ИИН NULL/пустой          : 1     (pk 4 — «Безиинов»)
    ИИН невалидный формат    : 0
    ИИН дубли (значений)     : 1     (…0101 ×2 — pk 1/pk 7 «Дубликатов», PII маскирован)
    табельный NULL/пустой    : 0
    табельный дубли          : 0

statuses.employeestatus:
    осиротевшие (employee=NULL)        : 1   (pk 110)
    осиротевшие (employee pk вне множ.) : 0
    осиротевшие всего                  : 1

staff_unit.staffunit:
    вакантных (employee=NULL) : 1   (pk 5)
```

Маркер: **`apparatus-verified-on-sample`**. Вывод PII-безопасен (только числа +
маскированные примеры). Образец ≠ прод: реальные объём/дубли/кодировка прода —
ниже, `PENDING-prod-access`.

---

## 2. Реальная выгрузка прода — `PENDING-prod-access` (путь A, Task 3 за Bratan)

Заполнить ПОСЛЕ прогона `EXPORT-RECIPE.md` на проде донора (`VERIFIED-on-prod`).
Реальный дамп держать ВНЕ репо (`.gitignore`); сюда — только агрегаты.

```
СПОСОБ ДОСТУПА   : __________ (dumpdata на проде / SQL-дамп / экспорт админа)   [PENDING]
ФОРМАТ           : совпал с образцом [{model,pk,fields}] UTF-8? __________      [PENDING]
ОБЪЁМ (строк/модель):
    divisions.division      : __
    dictionaries.rank       : __
    dictionaries.position   : __
    employees.employee      : __
    staff_unit.staffunit    : __
    statuses.employeestatus : __                                                [PENDING]
ВЛАДЕЛЕЦ ДОСТУПА : __________ (единая точка контакта E7; прод в контуре A5? __) [PENDING]
КАЧЕСТВО КЛЮЧЕЙ  :
    ИИН NULL/пустой          : __
    ИИН невалидный формат    : __
    ИИН дубли (значений)     : __
    табельный NULL/пустой    : __
    табельный дубли          : __
    осиротевшие статусы      : __
    вакантных слотов         : __                                              [PENDING]
ДАТА/ОКРУЖЕНИЕ   : __________ (дата, версия Django донора)                      [PENDING]
АНОМАЛИИ         : __________ (формат не совпал / экзотические дубли / битая
                   кодировка / осиротевшие — вход для 7.1)
```

> После заполнения `VERIFIED-on-prod` находки переносятся в E7 по таблице
> «находка → стори» в `EXPORT-RECIPE.md` (формат/объём → 7.1, способ/владелец →
> 7.0/7.2–7.3, качество ключей → 7.1/7.3).
