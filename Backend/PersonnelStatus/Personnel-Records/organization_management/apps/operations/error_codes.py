"""Закрытый словарь кодов отказа раздела ОМ.

У СОБЫТИЙ ЖУРНАЛА такой словарь был с самого начала, у кодов отказа — нет, и это
несимметрично без причины. Код отказа — ЧАСТЬ ДОГОВОРА с клиентом: по нему
ветвится интерфейс (показать диалог обхода, увести на форму, предложить
повторить). Опечатка в коде не ломает ничего заметного на сервере — ответ уходит,
статус верный, — но клиент такой код не сматчит никогда и молча свалится в ветку
«неизвестная ошибка». Найти это можно лишь тогда, когда оператор уже не понял,
что произошло.

СЛОВАРЬ СТРОИТСЯ ОТ RAISE-САЙТОВ, а не от реестра донора: в донорском
docs/registries/error-codes.yaml лежат коды, которых раздел не поднимает никогда
(и наоборот). Сверять договор с бумагой, а не с кодом, — способ узаконить
фантом.

КАЖДОМУ КОДУ ОБЪЯВЛЕН ДОПУСТИМЫЙ СТАТУС, и почти у всех он один. Это не
формальность: клиент ветвится по КОДУ, и один и тот же код, приходящий то 400, то
404, заставил бы его ветвиться ещё и по статусу — то есть договор перестал бы
быть договором.

Исключение ровно одно и оно осознанное — VALIDATION_ERROR. Это общий код
раздела, и он покрывает две разные по природе беды: неверную НАГРУЗКУ (400) и
состояние, при котором операция невозможна (422). Разделять их на два кода
пришлось бы во всех вызывающих сразу; пока оба смысла живут под одним кодом,
допустимые статусы перечислены здесь ЯВНО — чтобы это было решением, а не
случайностью.
"""

# Код → допустимые HTTP-статусы.
CODES = {
    # ── Общие ────────────────────────────────────────────────────────────
    # 400 — беда в нагрузке (пустая причина, поле неизменяемо, дата не
    # разбирается); 422 — нагрузка верна, но операция в этом состоянии
    # невозможна (у сотрудника нет штатной единицы). См. докстринг модуля.
    "VALIDATION_ERROR": frozenset({400, 422}),
    "ENTITY_NOT_FOUND": frozenset({404}),
    # ── Охранные мероприятия (жизненный цикл ОМ, порт мок-контракта) ─────
    # Общий отказ «не та стадия» — 422: нагрузка верна, состояние не то.
    "INVALID_STAGE_TRANSITION": frozenset({422}),
    "BULLETIN_INCOMPLETE": frozenset({422}),
    # Свой код у кнопки импорта: та же стадийная беда, но своя подсказка.
    "RECON_STAGE_REQUIRED": frozenset({422}),
    "NO_PASSPORT_VERSION": frozenset({422}),
    "PASSPORT_VERSION_NOT_FOUND": frozenset({422}),
    "NOTHING_TO_IMPORT": frozenset({422}),
    "RECON_CHECKLIST_INCOMPLETE": frozenset({422}),
    "RECON_SECTOR_POSTS_EMPTY": frozenset({422}),
    "DEMAND_ROWS_EMPTY": frozenset({422}),
    "FORCE_ALLOCATION_INCOMPLETE": frozenset({422}),
    "DOUBLE_ASSIGNMENT": frozenset({422}),
    "PLACEMENT_INCOMPLETE": frozenset({422}),
    "ACKNOWLEDGEMENT_INCOMPLETE": frozenset({422}),
    "CLOSURE_DIRECTIONS_INCOMPLETE": frozenset({422}),
    # Мягкий конфликт расстановки обходится причиной — 409 и overridable.
    "SOFT_CONFLICT_DETECTED": frozenset({409}),
    "PERMISSION_DENIED": frozenset({403}),
    # ── Статусы ──────────────────────────────────────────────────────────
    "INVALID_STATUS_TYPE": frozenset({422}),
    "UNRESOLVABLE_STATUS_TYPE": frozenset({422}),
    "INVALID_DATE_RANGE": frozenset({422}),
    "DATE_OUTSIDE_EMPLOYMENT": frozenset({422}),
    # Уволенному статус не заводят. Отдельный код, а не DATE_OUTSIDE_EMPLOYMENT:
    # тот про ДАТЫ (интервал вышел за границы найма) и предполагает, что границы
    # заполнены, — а уволить можно и не проставив дату увольнения.
    "EMPLOYEE_NOT_EMPLOYED": frozenset({422}),
    "MAX_DURATION_EXCEEDED": frozenset({422}),
    "INVALID_LIFECYCLE_TRANSITION": frozenset({422}),
    "AUTO_STATUS_READONLY": frozenset({422}),
    # Жёсткое пересечение не обходится никогда — потому 422, а не 409.
    "OVERLAPPING_HARD_STATUS": frozenset({422}),
    # Мягкое обходится причиной — потому 409 и overridable.
    "STATUS_OVERLAP_WARNING": frozenset({409}),
    # ── Сдача дня ────────────────────────────────────────────────────────
    "BUSINESS_DATE_OUT_OF_WINDOW": frozenset({422}),
    "DAY_ALREADY_SUBMITTED": frozenset({409}),
    "DAY_NOT_SUBMITTED": frozenset({404}),
    "NO_SUBMISSION_TO_AMEND": frozenset({422}),
    "AMENDMENT_REASON_REQUIRED": frozenset({422}),
    "SNAPSHOT_SCHEMA_UNSUPPORTED": frozenset({422}),
    "SUMMARY_CHILDREN_NOT_SUBMITTED": frozenset({422}),
    "TOMORROW_BLOCKED": frozenset({422}),
    "TOMORROW_BLOCK_ALREADY_OVERRIDDEN": frozenset({409}),
    # ── Документы ────────────────────────────────────────────────────────
    "DOCUMENT_ALREADY_ISSUED": frozenset({409}),
    "DOCUMENT_NOT_ISSUED": frozenset({409}),
    # Порча хранилища — сбой СЕРВЕРА: спрашивающий имеет право на документ.
    "DOCUMENT_INTEGRITY_FAILED": frozenset({500}),
}


def assert_known(code, http_status):
    """Проверить пару (код, статус) по словарю. Нарушение — ValueError.

    ValueError, а не доменный отказ: незнакомый код это дефект ВЫЗЫВАЮЩЕГО
    КОДА, а не ситуация данных, и превращать его в ответ клиенту значило бы
    отвечать опечаткой на осмысленный запрос.

    Проверка живёт здесь, а не в тесте покрытия, по той же причине, по которой
    словарь событий журнала проверяется на записи: тест видит только те пути,
    по которым прошёл, а конструктор — все.
    """
    allowed = CODES.get(code)
    if allowed is None:
        raise ValueError(
            f"неизвестный код отказа раздела: {code!r} "
            f"(заводится добавлением в error_codes.CODES)"
        )
    if http_status not in allowed:
        raise ValueError(
            f"код {code!r} объявлен со статусами {sorted(allowed)}, "
            f"поднят с {http_status}"
        )
