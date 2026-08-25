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
    "RECON_FORCE_REQUEST_EMPTY": frozenset({422}),
    "DEMAND_ROWS_EMPTY": frozenset({422}),
    "FORCE_ALLOCATION_INCOMPLETE": frozenset({422}),
    "DOUBLE_ASSIGNMENT": frozenset({422}),
    "PLACEMENT_INCOMPLETE": frozenset({422}),
    "ACKNOWLEDGEMENT_INCOMPLETE": frozenset({422}),
    "CLOSURE_DIRECTIONS_INCOMPLETE": frozenset({422}),
    # Мягкий конфликт расстановки обходится причиной — 409 и overridable.
    "SOFT_CONFLICT_DETECTED": frozenset({409}),
    # ── План дежурств ────────────────────────────────────────────────────
    "PLAN_ALREADY_EXISTS": frozenset({422}),
    "PLAN_NOT_FOUND": frozenset({422}),
    "PLAN_NOT_APPROVABLE": frozenset({422}),
    "PLAN_APPROVED_LOCKED": frozenset({422}),
    "PASSPORT_REQUIRED": frozenset({422}),
    # Пересечение дня — жёсткое всегда; отдых в HARD_BLOCK-режиме — тоже 422.
    "DUTY_OVERLAP": frozenset({422}),
    "REST_AFTER_DUTY": frozenset({422}),
    # Отдых в SOFT_OVERRIDE-режиме обходится причиной — 409 и overridable.
    "DUTY_CONFLICT_DETECTED": frozenset({409}),
    # ── Боевые группы (§24, мок-контракт отдаёт все отказы 422-ми) ───────
    "INVALID_BUSINESS_DATE": frozenset({422}),
    "EMPTY_ROUTE_SET": frozenset({422}),
    "INVALID_REQUIREMENT": frozenset({422}),
    "UNKNOWN_DUTY_TYPE": frozenset({422}),
    "TOO_MANY_ROUTES": frozenset({422}),
    "UNKNOWN_ROUTE": frozenset({422}),
    "EMPTY_GROUP": frozenset({422}),
    "ALREADY_SUBMITTED": frozenset({422}),
    "REASON_REQUIRED": frozenset({422}),
    # СВОЙ код, не INVALID_STAGE_TRANSITION: контракт клиента различает их
    # буквально (STATE у боевых групп, STAGE у ОМ/статусов).
    "INVALID_STATE_TRANSITION": frozenset({422}),
    "NOT_IN_ROSTER": frozenset({422}),
    "ALREADY_ACKNOWLEDGED": frozenset({422}),
    "CONFIRMER_REQUIRED": frozenset({422}),
    "MISSING_HANDOVER": frozenset({422}),
    "ALREADY_IN_ROSTER": frozenset({422}),
    # ── Оперативный рейтинг (§19; отказы формы — 422, конфликты — 409) ───
    "RATING_DISABLED": frozenset({422}),
    "EVALUATION_ARCHIVE_LOCKED": frozenset({422}),
    "EVALUATION_ALREADY_SUBMITTED": frozenset({422}),
    "PARTICIPATION_NOT_CONFIRMED": frozenset({422}),
    "GROUP_EVALUATION_UNSUPPORTED": frozenset({422}),
    "EVALUATION_NOT_SUBMITTED": frozenset({422}),
    # §19.25: конфликт редакции — 409 и СВОЙ код, НЕ overridable: конфликт
    # версии оценки не ведётся через диалог обхода назначений.
    "EVALUATION_REVISION_MISMATCH": frozenset({409}),
    "EVALUATION_ALREADY_CORRECTED": frozenset({409}),
    # Правила формы оценки (§19.9): экран ставит сообщение рядом с полем по
    # КОДУ, а не разбирая текст.
    "SCORE_NOT_INTEGER": frozenset({422}),
    "SCORE_OUT_OF_SCALE": frozenset({422}),
    "BASIS_REQUIRED": frozenset({422}),
    "BASIS_UNKNOWN": frozenset({422}),
    "BASIS_NOTE_REQUIRED": frozenset({422}),
    "COMMENT_REQUIRED": frozenset({422}),
    "CORRECTION_REASON_REQUIRED": frozenset({422}),
    # Экспорт (§19.29).
    "SENSITIVE_EXPORT_UNAVAILABLE": frozenset({422}),
    "EXPORT_FORMAT_UNAVAILABLE": frozenset({422}),
    "EXPORT_NOT_CANCELLABLE": frozenset({422}),
    "EXPORT_NOT_READY": frozenset({422}),
    # ── Аналитика службы и мероприятий (§22; отказы — 422) ───────────────
    "UNKNOWN_PERIOD_PRESET": frozenset({422}),
    "INVALID_PERIOD": frozenset({422}),
    # Предел произвольного периода не задан политикой — период по датам не
    # принимается вовсе (снять предел из-за отсутствия владельца нельзя).
    "PERIOD_LIMIT_UNAVAILABLE": frozenset({422}),
    "PERIOD_TOO_LONG": frozenset({422}),
    # §22.12: строки drill-down обязаны принадлежать ТОМУ ЖЕ снимку, что и
    # показатель, — расхождение это отказ, а не молчаливая подмена выборки.
    "SNAPSHOT_OUTDATED": frozenset({422}),
    "UNKNOWN_METRIC": frozenset({422}),
    "UNKNOWN_LEVEL_TARGET": frozenset({422}),
    # ── Служебные отчёты (§22.18-22.28; отказы — 422) ────────────────────
    "IDEMPOTENCY_KEY_REQUIRED": frozenset({422}),
    "UNKNOWN_REPORT_TYPE": frozenset({422}),
    "UNSUPPORTED_FORMAT": frozenset({422}),
    # Срок хранения не задан политикой — файл без срока жил бы вечно.
    "RETENTION_UNAVAILABLE": frozenset({422}),
    "NO_BASE_REVISION": frozenset({422}),
    "JOB_NOT_FINISHED": frozenset({422}),
    "ARTIFACT_EXPIRED": frozenset({422}),
    # ── Настройки и справочники раздела ОМ ───────────────────────────────
    "SETTING_LOCKED": frozenset({422}),
    # Удаление требует ДОКАЗАННОГО отсутствия связей: у неотслеживаемых
    # справочников оно запрещено (используйте деактивацию).
    "DICTIONARY_USAGE_UNKNOWN": frozenset({422}),
    # Значение используется — конфликт данных, обходу не подлежит.
    "DICTIONARY_ENTRY_IN_USE": frozenset({409}),
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
    # ── Обратная связь (§28) ─────────────────────────────────────────────
    # Повторная отправка не-черновика: нагрузка верна, состояние не то.
    "FEEDBACK_ALREADY_SUBMITTED": frozenset({422}),
    # Один код на оба замка (терминальный статус И черновик) — так в
    # мок-контракте хоста: клиент различает исходы сообщением, не кодом.
    "FEEDBACK_CLOSED": frozenset({422}),
    "FEEDBACK_TRANSITION_NOT_ALLOWED": frozenset({422}),
    # Терминальный статус через разбор: закрытие — отдельная операция с
    # обязательным публичным ответом автору.
    "FEEDBACK_USE_CLOSE": frozenset({422}),
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
