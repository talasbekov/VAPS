"""Оперативный рейтинг (§19, §22.16-22.17) — серверная реализация контракта
клиента (features/ratings): порт мок-репозитория и его чистой модели ДОСЛОВНО.

Агрегат считает СЕРВЕР (§19.19): среднее учтённых оценок периода политики,
округлённое до одного знака здесь, а не в вёрстке. Закрытые данные (score,
оценщик, комментарий чужой записи) не сериализуются наружу нигде: проекции
собираются полем за полем, и новое закрытое поле в них не попадёт само
(§19.21). Отсутствие агрегата — состояние с причиной, а не ноль (§19.2).

Журнал оценивания (§19.27) — СВОЙ, не общий журнал раздела: общий экран
аудита читают люди без права на рейтинг. Запись об отказе идёт СВОЕЙ
транзакцией — внутри отклонённой она откатилась бы вместе с ней.
"""
import datetime as dt
import math
import uuid

from django.db import transaction

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
)
from organization_management.apps.operations.models_rating import (
    OpsEvaluationCorrection,
    OpsEvaluationEvent,
    OpsEvaluationWorkItem,
    OpsEventEvaluation,
    OpsRatedParticipant,
    OpsRatingAuditEntry,
    OpsRatingDynamicsPoint,
    OpsRatingExportArtifact,
    OpsRatingExportJob,
    OpsRatingFeatureFlags,
    OpsRatingGroup,
    OpsRatingIdempotencyRecord,
    OpsRatingNotification,
)
from organization_management.apps.operations.models_settings import (
    OpsPolicySectionVersion,
    OpsPolicySetting,
)

# ── Права (§19.22 перечисляет их порознь — здесь они и заведены порознь) ────
VIEW_AGGREGATE_PERMISSION = "rating.view_aggregate"
VIEW_ANALYTICS_PERMISSION = "analytics.view"
EVALUATE_PERMISSION = "rating.evaluate"
CORRECT_PERMISSION = "rating.correct"
VIEW_CHAIN_PERMISSION = "rating.view_correction_chain"
VIEW_AUDIT_PERMISSION = "rating.view_audit"
EXPORT_PERMISSION = "rating.export"

RATING_SCALE_MIN = 1
RATING_SCALE_MAX = 10
RATING_DEFAULT_SCORE = 8
AUDIT_PAGE_SIZE = 20
REGISTRY_PAGE_SIZE = 10

_SECTION = "RATING_POLICY"
_PERIOD_CODE = "RATING.PERIOD.PARAMETER"
_MIN_EVALUATIONS_CODE = "RATING.MIN_EVALUATIONS.PARAMETER"
_SUPPRESSION_CODE = "RATING.SUPPRESSION_MIN_GROUP.PARAMETER"

# Основания оценки (§19.10): перечень отдаёт СЕРВЕР, не справочник в коде
# экрана. Коды — те же, что в мок-контракте: мок и есть контракт.
EVALUATION_BASES = [
    {"code": "EXECUTION_OF_DUTIES", "label": "Исполнение обязанностей",
     "requiresNote": False},
    {"code": "TIMELY_ARRIVAL", "label": "Своевременное прибытие",
     "requiresNote": False},
    {"code": "DISCIPLINE", "label": "Дисциплина", "requiresNote": False},
    {"code": "POST_KNOWLEDGE", "label": "Знание задач поста",
     "requiresNote": False},
    {"code": "ORDERS_EXECUTION", "label": "Исполнение указаний",
     "requiresNote": False},
    {"code": "INTERACTION", "label": "Взаимодействие", "requiresNote": False},
    {"code": "NON_STANDARD_SITUATION",
     "label": "Действия в нестандартной ситуации", "requiresNote": False},
    {"code": "OTHER", "label": "Другое", "requiresNote": True},
]

RATING_EXPORT_FORMATS = ["CSV"]

# ── §35-блоки: чего нет и почему. Едут клиенту вместе с ответом — иначе
# агрегат читался бы как «учтено всё, что бывает». Тексты — мок-контракта. ──
UNAVAILABLE_RATING_FACTORS = [
    {
        "code": "EVALUATOR_WEIGHTS",
        "label": "Веса оценщиков",
        "reason": (
            "Модель весов оценщиков не заведена: §19.19 запрещает определять "
            "их на клиенте, а серверной методики весов в этой сборке нет. Все "
            "учтённые оценки равнозначны, и это сказано прямо, а не спрятано "
            "за словом «агрегат»."
        ),
    },
    {
        "code": "GROUP_EVALUATION",
        "label": "Распределение групповой оценки",
        "reason": (
            "Групповое оценивание (§19.13) не реализовано — распределять "
            "нечего. Показать долю групповой оценки значило бы объявить "
            "существующим механизм, которого нет."
        ),
    },
    {
        "code": "DUTY_SHIFTS",
        "label": "Суточные дежурства",
        "reason": (
            "В оперативный рейтинг мероприятий суточные дежурства не "
            "включаются без отдельного подтверждённого contract (§19.1). "
            "Смены дежурств учитываются аналитикой службы и в рейтинг не "
            "переносятся."
        ),
    },
    {
        "code": "SERVICE_HOURS",
        "label": "Фактические часы службы",
        "reason": (
            "Часы — не оценка (§19.2 `ServiceHoursEntry`). Повышать рейтинг "
            "за количество часов прямо запрещено, поэтому они не участвуют в "
            "расчёте ни с каким знаком."
        ),
    },
]

UNAVAILABLE_VIEWS = [
    {
        "code": "OWN_RATING",
        "label": "Собственный рейтинг смотрящего",
        "reason": (
            "Связь учётной записи с карточкой сотрудника в разделе не "
            "определена, поэтому «мой рейтинг» показать не на ком. Подставить "
            "сюда любого сотрудника значило бы приписать смотрящему чужую "
            "оценку."
        ),
    },
    {
        "code": "SENSITIVE_EVALUATIONS",
        "label": "Отдельные оценки и оценщики",
        "reason": (
            "Просмотр отдельной оценки требует sensitive permission, "
            "organization scope, event scope и срока полномочия одновременно "
            "(§19.21 «контролёр рейтинга»). Ни одна операция этого среза их "
            "не отдаёт: закрытые данные не покидают сервер, а не прячутся в "
            "вёрстке."
        ),
    },
    {
        "code": "RATING_DYNAMICS_FORECAST",
        "label": "Прогноз и сглаживание динамики",
        "reason": (
            "График §19.20 строится ТОЛЬКО по записанным серверным точкам. "
            "Тренд, скользящее среднее и достроенные промежуточные значения "
            "не показываются: это было бы вычисление на клиенте поверх "
            "агрегатов, а старые точки пересчитывать запрещено прямо."
        ),
    },
]

UNAVAILABLE_ANALYTICS_VIEWS = [
    {
        "code": "FORBIDDEN_BY_2216",
        "label": (
            "Отдельная оценка, оценщик, комментарий, доля ручных оценок, "
            "таблица лидеров, место"
        ),
        "reason": (
            "§22.16 перечисляет это списком запрещённого в общем отчёте. Их "
            "нет не в вёрстке, а в ответе API: отчёт оперирует агрегатами "
            "групп и полосами распределения, отдельного участника в нём не "
            "найти."
        ),
    },
    {
        "code": "PROTOTYPE_METRICS_REMOVED",
        "label": (
            "Показатели прототипа: «Авто-оценок», «Стандартных оценок», "
            "«Оценок ниже 6»"
        ),
        "reason": (
            "§22.17 требует удалить эту логику целиком. Первые две — "
            "выдуманные константы прототипа, третья прямо запрещена как "
            "количество низких оценок. Заменены распределением по полосам, "
            "где восьмёрка — стандартное выполнение."
        ),
    },
    {
        "code": "NO_OVERALL_MEAN",
        "label": "Общее среднее по всем участникам",
        "reason": (
            "Вместе с опубликованными средними и размерами остальных групп "
            "общее среднее восстанавливает подавленное значение арифметикой "
            "(§22.17 «не пытайся восстановить скрытое значение из других "
            "показателей»). §22.16 его и не требует."
        ),
    },
]

UNAVAILABLE_WORKSPACE_VIEWS = [
    {
        "code": "REPLACED_BEFORE_START",
        "label": "Исключение заменённого до заступления",
        "reason": (
            "§19.33: заменённый до заступления сотрудник не должен получать "
            "итоговую оценку. Задания формируются по фактическому составу, а "
            "снимка замен (кто был заявлен и заменён до заступления) в данных "
            "мероприятий нет — демонстрировать исключение не на ком. Правило "
            "действует косвенно: задание без подтверждённого участия оценку "
            "не принимает (PARTICIPATION_NOT_CONFIRMED)."
        ),
    },
    {
        "code": "GROUP_EVALUATION",
        "label": "Групповая оценка",
        "reason": (
            "§19.13 требует показать состав группы на момент мероприятия и "
            "фактический состав. Таких снимков нигде не записано, а без них "
            "групповая оценка была бы оценкой неизвестно кого. Копировать её "
            "каждому участнику прямо запрещено, поэтому направление "
            "объявлено, но заданий этого вида нет."
        ),
    },
    {
        "code": "ARCHIVE_ADDENDUM",
        "label": "Архивное дополнение к исправлению",
        "reason": (
            "§19.18: исправление после формирования архива обязано создавать "
            "разрешённое дополнение, связанное с исходным snapshot, не "
            "переписывая его manifest. Архив мероприятия в этой сборке не "
            "формируется вовсе, поэтому дополнение не к чему привязать — а "
            "сделать вид, что оно есть, значило бы пообещать неизменность "
            "архива, которой никто не обеспечивает."
        ),
    },
    {
        "code": "CORRECT_FOREIGN_EVALUATION",
        "label": "Исправление ЧУЖОЙ оценки",
        "reason": (
            "§19.21 «контролёр рейтинга» требует sensitive permission, "
            "organization scope, event scope и срок полномочия ОДНОВРЕМЕННО. "
            "Ни scope, ни срока полномочия в этой сборке нет, поэтому "
            "исправление ограничено собственной записью: право без scope "
            "пускало бы правку любой оценки в системе."
        ),
    },
    {
        "code": "RECOGNITION_AND_REMARK",
        "label": "Фильтры «С благодарностью», «С замечанием», «Исправленные»",
        "reason": (
            "§19.11 запрещает выводить тип из одного лишь значения: высокая "
            "оценка не равна благодарности, низкая — взысканию. "
            "Подтверждённых сущностей поощрения и замечания в контракте нет, "
            "а придумывать backend codes нельзя."
        ),
    },
    {
        "code": "BULK_DEFAULT",
        "label": "Кнопка «Применить 8 всем»",
        "reason": (
            "§19.8 называет её поимённо среди запрещённых. Восьмёрка означает "
            "стандартное выполнение без зафиксированного основания для "
            "снижения, и проставить её списком значило бы объявить это про "
            "людей, которых оценщик не смотрел."
        ),
    },
    {
        "code": "RECEIVED_EVALUATIONS",
        "label": "Оценки, полученные смотрящим от других",
        "reason": (
            "§19.14 «Не показывай пользователю оценки, полученные им от "
            "других лиц». Их нет в ответе: очередь и отправленные отбираются "
            "по оценщику, а не фильтруются на экране."
        ),
    },
]

UNAVAILABLE_REGISTRY_VIEWS = [
    {
        "code": "SENSITIVE_COLUMNS",
        "label": "Score, комментарий, основание и оценщик отдельной записи",
        "reason": (
            "§19.16: держателю права на агрегат они закрыты, а "
            "sensitive-просмотр по §19.21 требует organization scope, event "
            "scope и срока полномочия одновременно — ни того, ни другого в "
            "сборке нет. Поэтому колонок не «нет на экране»: этих полей нет "
            "в ответе API, и подпись «Детали оценки закрыты» стоит на их "
            "месте честно."
        ),
    },
    {
        "code": "RECOGNITION_FILTERS",
        "label": "Фильтры «С благодарностью» и «С замечанием»",
        "reason": (
            "§19.11 запрещает выводить тип из значения оценки, а "
            "подтверждённых сущностей поощрения и замечания в контракте нет. "
            "Фильтр по несуществующему признаку молча возвращал бы пустой "
            "список и читался бы как «таких нет»."
        ),
    },
    {
        "code": "DOCUMENT_FILTER",
        "label": "Фильтр «Только с документами» и колонка документа",
        "reason": (
            "Документ считается прикреплённым только после ответа сервера "
            "(§19.11), а хранилища вложений у оценок нет вовсе (§35). Пустая "
            "колонка утверждала бы, что документов нет ни у одной записи."
        ),
    },
    {
        "code": "SERVICE_RESULT",
        "label": "Колонка «Результат службы»",
        "reason": (
            "§19 разделяет оценку и фактическое время службы "
            "(`ServiceHoursEntry`) — это разные сущности из разных "
            "источников. Показать их в одной строке значило бы объявить "
            "связь, которой никто не подтверждал."
        ),
    },
]

UNAVAILABLE_AUDIT_VIEWS = [
    {
        "code": "AUDIT_SENSITIVE_VALUES",
        "label": "Старое и новое значение оценки, комментарии, оценщик",
        "reason": (
            "§19.27 отдаёт их отдельной audit privacy permission, а §19.21 "
            "требует к ней тот же scope и срок полномочия, что и к "
            "sensitive-просмотру. Ни того, ни другого в сборке нет, поэтому "
            "значений нет в записи журнала вовсе — иначе «обычный "
            "пользователь раскрывал бы закрытые оценки через общий экран "
            "аудита» (§19.27)."
        ),
    },
    {
        "code": "AUDIT_EXPORT",
        "label": "Экспорт журнала",
        "reason": (
            "§19.29 требует отдельного права на экспорт и собственной "
            "audit-записи о нём. Выгрузка §19.29 сделана для АГРЕГИРОВАННОЙ "
            "СВОДКИ; журнал — другой раздел с другим правом "
            "(`rating.view_audit`), и своего генератора у него нет. Кнопка "
            "здесь обещала бы файл, которого никто не собирает."
        ),
    },
]

UNAVAILABLE_NOTIFICATION_VIEWS = [
    {
        "code": "AGGREGATE_UPDATED_NOTICE",
        "label": "Уведомление «Итоговая сводка оперативного рейтинга обновлена»",
        "reason": (
            "§19.28 называет его допустимым, но адресатов у него нет: "
            "перечня людей с правом на агрегат в системе не существует "
            "(права резолвятся для запрашивающего, а не перечисляются). "
            "Разослать «всем» значило бы придумать список получателей, а "
            "адресовать себе — сделать вид, что уведомление работает."
        ),
    },
    {
        "code": "EMPLOYEE_NOTICE",
        "label": "Уведомления оцениваемому сотруднику",
        "reason": (
            "Связь учётной записи с карточкой сотрудника в разделе не "
            "определена, поэтому доставить уведомление «вашу оценку "
            "исправили» некому. Отправить его оценщику вместо участника "
            "значило бы адресовать чужое сообщение."
        ),
    },
]

UNAVAILABLE_EXPORT_FORMATS = [
    {
        "code": "XLSX",
        "label": "XLSX",
        "reason": (
            "§19.29 называет формат, но генератора книги XLSX в сборке нет: "
            "файл собирал бы браузер из уже полученных строк, то есть "
            "выгрузка перестала бы быть серверной операцией с правом и "
            "audit. Доступен CSV — он открывается тем же табличным "
            "редактором."
        ),
    },
    {
        "code": "PDF",
        "label": "PDF",
        "reason": (
            "§19.29 называет формат, но генератора PDF в сборке нет. "
            "Печатная форма — отдельный механизм (§9.15) со своим макетом и "
            "владельцем; выдать за PDF-выгрузку окно печати браузера значило "
            "бы назвать файлом то, что файлом не является."
        ),
    },
]

UNAVAILABLE_EXPORT_SCOPES = [
    {
        "code": "INDIVIDUAL",
        "label": "Экспорт индивидуальных оценок (sensitive export)",
        "reason": (
            "§19.29 требует под него отдельного permission и audit-записи, "
            "но §19.21 требует к закрытым данным ещё organization scope, "
            "event scope и срок полномочия. Ни того, ни другого в сборке "
            "нет — и право без них охраняло бы выгрузку только на словах: у "
            "эталонного администратора wildcard, и файл с отдельными score, "
            "оценщиками и комментариями собрался бы для того, кому никакого "
            "scope не выдавали. Отказ фиксируется в журнале оценивания "
            "(§19.27)."
        ),
    },
]

_DATA_STATE_EXPORT_LABEL = {
    "READY": "Рассчитан",
    "INSUFFICIENT_DATA": "Недостаточно оценок",
    "POLICY_UNDEFINED": "Методика не определена",
    "FEATURE_DISABLED": "Функция выключена",
}

AGGREGATE_EXPORT_COLUMNS = [
    "Участник", "Агрегат", "Учтено оценок", "Период с", "Период по",
    "Методика", "Состояние",
]

# Полосы распределения (§22.17): полуоткрытые, восьмёрка начинает свою
# полосу, верхняя замкнута — 10 конец шкалы.
DISTRIBUTION_BANDS = [
    {"code": "BAND_BELOW_5", "label": "ниже 5", "from": 1, "toExclusive": 5},
    {"code": "BAND_5_7", "label": "5,0–6,9", "from": 5, "toExclusive": 7},
    {"code": "BAND_7_8", "label": "7,0–7,9", "from": 7, "toExclusive": 8},
    {"code": "BAND_8_9", "label": "8,0–8,9 (стандартное выполнение — 8)",
     "from": 8, "toExclusive": 9},
    {"code": "BAND_9_10", "label": "9,0–10", "from": 9,
     "toExclusive": 10.0001},
]


def has_perm(perms, code):
    return "*" in perms or code in perms


def _permission_denied(code):
    return DomainError(
        "PERMISSION_DENIED", 403, detail={"permission": code},
        message="Недостаточно прав.",
    )


def _not_found(entity_id):
    return DomainError(
        "ENTITY_NOT_FOUND", 404, detail={"id": str(entity_id)},
        message="Запись не найдена.",
    )


def _iso(value):
    return value.isoformat() if value is not None else None


def _stamp_code(obj, field, prefix):
    """Устойчивый серверный идентификатор из PK — двумя шагами в той же
    транзакции: счёт строк под гонкой дал бы коллизию уникального кода."""
    setattr(obj, field, f"{prefix}-{obj.pk}")
    obj.save(update_fields=[field, "updated_at"])
    return getattr(obj, field)


def _tmp_code():
    return f"tmp-{uuid.uuid4().hex}"


# ── Политика и флаги ────────────────────────────────────────────────────────


def read_rating_policy():
    """`None` — методика не определена: ОТДЕЛЬНОЕ состояние, а не повод взять
    значения по умолчанию (§19.19 требует «Методика расчёта не определена»).
    Политика неполна — тоже `None`: посчитать по половине методики и
    подписать её версией значило бы соврать о том, как получено число."""
    version_row = OpsPolicySectionVersion.objects.filter(
        section_code=_SECTION
    ).first()
    if version_row is None or not version_row.version:
        return None
    period_days = None
    min_evaluations = None
    for row in OpsPolicySetting.objects.filter(section_code=_SECTION):
        if not isinstance(row.value, (int, float)) or isinstance(
            row.value, bool
        ):
            continue
        if row.setting_code == _PERIOD_CODE:
            period_days = int(row.value)
        if row.setting_code == _MIN_EVALUATIONS_CODE:
            min_evaluations = int(row.value)
    if period_days is None or min_evaluations is None:
        return None
    return {
        "periodDays": period_days,
        "minEvaluations": min_evaluations,
        "policyVersion": version_row.version,
    }


def read_suppression_min_group():
    """Порог безопасной агрегации (§22.17). `None` — правило не задано:
    подставить умолчание значило бы выбрать порог приватности в коде."""
    row = OpsPolicySetting.objects.filter(
        section_code=_SECTION, setting_code=_SUPPRESSION_CODE
    ).first()
    if row is None or isinstance(row.value, bool) or not isinstance(
        row.value, (int, float)
    ):
        return None
    return int(row.value)


def read_feature_flags():
    """Флаги — обязаны быть настроены (мерка read_conflict_policy дежурств):
    отсутствующая строка — не «выключено», а незасеянный раздел."""
    flags = OpsRatingFeatureFlags.objects.filter(singleton_key=1).first()
    if flags is None:
        raise DomainError(
            "VALIDATION_ERROR", 422,
            detail={"flags": ["Флаги оперативного рейтинга не настроены."]},
            message="Флаги оперативного рейтинга не настроены.",
        )
    return flags


def _capabilities(flags):
    return {
        "operationalRatings": flags.operational_ratings,
        "ratingConflicts": flags.rating_conflicts,
    }


# ── Расчёт агрегата (§19.19) ────────────────────────────────────────────────


def round_aggregate(value):
    """Каноническое округление до одного знака — ЗДЕСЬ, на сервере.

    Половинка округляется ВВЕРХ (Math.round контракта): встроенный round()
    Python — банковский и на точных .5 давал бы другое число, чем экран
    видел в мок-режиме (82.5 → 82 вместо 83)."""
    return math.floor(value * 10 + 0.5) / 10


def period_start(business_date, period_days):
    """Начало периода: `periodDays` суток назад, включая бизнес-дату."""
    return business_date - dt.timedelta(days=period_days - 1)


def included_evaluations(evaluations, participant_code, starts_at, ends_at):
    """Учтённые в агрегате: в периоде и НЕ вытесненные исправлением."""
    return [
        item for item in evaluations
        if item.participant_code == participant_code
        and item.superseded_by_code is None
        and starts_at <= item.evaluated_at <= ends_at
    ]


def build_summary(participant, evaluations, policy, feature_enabled,
                  business_date, calculated_at):
    """Сводка одного сотрудника. Порядок проверок значим: выключенная функция
    отвечает раньше отсутствующей политики, политика — раньше счёта оценок."""
    base = {
        # `employeeId` — КОД УЧАСТНИКА рейтинга, а не кадровый id, и таким
        # остаётся: по нему ходят три экрана раздела (сводка, динамика,
        # карточка участника) и ручки `?employee=`. Имя поля неточное, но это
        # существующий контракт; переименование — отдельный шаг, а не побочный
        # эффект правки расстановки.
        "employeeId": participant.participant_code,
        # Кадровая ссылка ДОБАВЛЕНА РЯДОМ (Plane №96). Расстановка ищет рейтинг
        # по кадровому id, и до этой правки не находила его никогда. `null`
        # значит «участник не связан с кадрами» — честный ответ: у сеяных
        # исторических участников кадровой записи нет вовсе, и подставлять
        # вместо неё код участника значило бы отдать расстановке строку,
        # которая совпадёт с чужим человеком.
        "personnelId": (
            str(participant.employee_id)
            if participant.employee_id is not None
            else None
        ),
        "safeLabel": participant.safe_label,
        "aggregateRating": None,
        "evaluationsCount": 0,
        "periodStartsAt": None,
        "periodEndsAt": None,
        "calculationPolicyVersion": (
            policy["policyVersion"] if policy is not None else None
        ),
        "calculatedAt": calculated_at,
    }
    if not feature_enabled:
        return {
            **base, "calculationPolicyVersion": None,
            "dataState": "FEATURE_DISABLED",
        }
    if policy is None:
        return {**base, "dataState": "POLICY_UNDEFINED"}
    starts_at = period_start(business_date, policy["periodDays"])
    included = included_evaluations(
        evaluations, participant.participant_code, starts_at, business_date
    )
    with_period = {
        **base,
        "evaluationsCount": len(included),
        "periodStartsAt": starts_at.isoformat(),
        "periodEndsAt": business_date.isoformat(),
    }
    if len(included) < policy["minEvaluations"]:
        return {**with_period, "dataState": "INSUFFICIENT_DATA"}
    total = sum(item.score for item in included)
    return {
        **with_period,
        "aggregateRating": round_aggregate(total / len(included)),
        "dataState": "READY",
    }


def _all_summaries(flags, policy):
    """Сводки всех участников тем же расчётом, что и экран. Порядок — по
    подписи: сортировка по значению — таблица лидеров, запрещённая §22.16."""
    business_date = Clock.today_local()
    calculated_at = Clock.now().isoformat()
    evaluations = list(OpsEventEvaluation.objects.all())
    participants = list(OpsRatedParticipant.objects.all())
    summaries = [
        build_summary(
            participant, evaluations, policy, flags.operational_ratings,
            business_date, calculated_at,
        )
        for participant in participants
    ]
    summaries.sort(key=lambda item: item["safeLabel"])
    return summaries


# ── Сводка, динамика, карточка, аналитика ───────────────────────────────────


def list_operational_ratings():
    flags = read_feature_flags()
    policy = read_rating_policy()
    return {
        "results": _all_summaries(flags, policy),
        # Методика не едет клиенту, когда функция выключена: она бы
        # утверждала, что расчёт по ней идёт.
        "policy": policy if flags.operational_ratings else None,
        "capabilities": _capabilities(flags),
        "unavailableFactors": UNAVAILABLE_RATING_FACTORS,
        "unavailableViews": UNAVAILABLE_VIEWS,
    }


def _serialize_point(point):
    return {
        "employeeId": point.participant_code,
        "period": point.period,
        "periodStartsAt": point.period_starts_at.isoformat(),
        "periodEndsAt": point.period_ends_at.isoformat(),
        "aggregateRating": point.aggregate_rating,
        "evaluationsCount": point.evaluations_count,
        "policyVersion": point.policy_version,
        "dataState": point.data_state,
        "recordedAt": point.recorded_at.isoformat(),
    }


def policy_boundaries(points):
    """Границы смены методики — по ВСЕМУ ряду, включая точки без агрегата:
    методика могла смениться на периоде, за который данных не хватило."""
    boundaries = []
    for previous, point in zip(points, points[1:]):
        if previous.policy_version == point.policy_version:
            continue
        boundaries.append({
            "period": point.period,
            "fromPolicyVersion": previous.policy_version,
            "toPolicyVersion": point.policy_version,
        })
    return boundaries


def rating_dynamics(employee_id):
    """Динамика (§19.20): точки отдаются КАК ЕСТЬ — ни одно поле не
    пересчитывается. Серверная работа — отбор, порядок и границы методики."""
    flags = read_feature_flags()
    policy = read_rating_policy()
    # Порядок сида, не подписи: участник по умолчанию — первый заведённый,
    # как в мок-контракте (RATED_EMPLOYEES[0]).
    participants = list(OpsRatedParticipant.objects.order_by("id"))
    participant = next(
        (item for item in participants
         if item.participant_code == employee_id),
        participants[0] if participants else None,
    )
    if participant is None:
        raise _not_found(employee_id or "")
    points = (
        list(
            OpsRatingDynamicsPoint.objects.filter(
                participant_code=participant.participant_code
            ).order_by("period_starts_at", "id")
        )
        if flags.operational_ratings
        else []
    )
    return {
        "employeeId": participant.participant_code,
        "safeLabel": participant.safe_label,
        "points": [_serialize_point(point) for point in points],
        "boundaries": policy_boundaries(points),
        "currentPolicy": (
            policy if flags.operational_ratings and policy is not None
            else None
        ),
        "currentPolicyHasClosedPeriods": (
            policy is not None
            and any(
                point.policy_version == policy["policyVersion"]
                for point in points
            )
        ),
        "capabilities": {"operationalRatings": flags.operational_ratings},
        "employees": [
            {"employeeId": item.participant_code, "safeLabel": item.safe_label}
            for item in participants
        ],
    }


def rating_employee_detail(employee_id):
    """Карточка при праве только на агрегат (§19.17): ни одного поля
    отдельных оценок и оценщиков.

    `employee` ОБЯЗАТЕЛЕН. Без него ручка отвечала 404 `ENTITY_NOT_FOUND`
    с пустым `details.id` (Plane №63) — а это неверно по смыслу: записи не
    «нет», её не спросили. Отсутствие обязательного параметра — ошибка
    запроса, и отвечать на неё надо так же, как соседние ручки отвечают на
    неуказанный период или подразделение.
    """
    if not str(employee_id or "").strip():
        raise DomainError(
            "VALIDATION_ERROR", 400,
            detail={"employee": ["Укажите сотрудника."]},
            message="Проверьте заполнение формы.",
        )
    flags = read_feature_flags()
    policy = read_rating_policy()
    participant = OpsRatedParticipant.objects.filter(
        participant_code=employee_id or ""
    ).first()
    if participant is None:
        raise _not_found(employee_id or "")
    group = OpsRatingGroup.objects.filter(
        group_code=participant.group_code
    ).first()
    evaluations = list(OpsEventEvaluation.objects.all())
    points = (
        list(
            OpsRatingDynamicsPoint.objects.filter(
                participant_code=participant.participant_code
            ).order_by("period_starts_at", "id")
        )
        if flags.operational_ratings
        else []
    )
    return {
        "employeeId": participant.participant_code,
        "safeLabel": participant.safe_label,
        "unitSafeLabel": group.safe_label if group is not None else "—",
        "summary": build_summary(
            participant, evaluations, policy, flags.operational_ratings,
            Clock.today_local(), Clock.now().isoformat(),
        ),
        "points": [_serialize_point(point) for point in points],
        "unavailableViews": UNAVAILABLE_REGISTRY_VIEWS,
    }


def rating_analytics():
    """Отчёт §22.16-22.17. Порядок причин непубликации значим: выключенная
    функция → отсутствующая методика → незаданный порог приватности."""
    flags = read_feature_flags()
    policy = read_rating_policy()
    suppression = read_suppression_min_group()
    base = {
        "policy": policy if flags.operational_ratings else None,
        "periodStartsAt": None,
        "periodEndsAt": None,
        "calculatedAt": Clock.now().isoformat(),
        "suppressionMinGroupSize": suppression,
        "figures": None,
        "capabilities": {"operationalRatings": flags.operational_ratings},
        "unavailableViews": UNAVAILABLE_ANALYTICS_VIEWS,
    }
    if not flags.operational_ratings:
        return {**base, "unpublishedReason": "FEATURE_DISABLED"}
    if policy is None:
        return {**base, "unpublishedReason": "POLICY_UNDEFINED"}
    if suppression is None:
        return {**base, "unpublishedReason": "SUPPRESSION_UNDEFINED"}

    summaries = _all_summaries(flags, policy)
    corrected = OpsEventEvaluation.objects.exclude(
        superseded_by_code=None
    ).count()
    return {
        **base,
        "periodStartsAt": (
            summaries[0]["periodStartsAt"] if summaries else None
        ),
        "periodEndsAt": summaries[0]["periodEndsAt"] if summaries else None,
        "unpublishedReason": None,
        "figures": _build_analytics_figures(summaries, suppression, corrected),
    }


def _build_analytics_figures(summaries, min_group_size, corrected):
    """§22.17: подавленная группа не считается ВОВСЕ — «посчитать и не
    показать» оставило бы значение в ответе API. Общего среднего нет и не
    должно появиться (восстановление скрытого арифметикой)."""
    ready = [item for item in summaries if item["dataState"] == "READY"]
    distribution = [
        {
            "code": band["code"],
            "label": band["label"],
            "count": len([
                item for item in ready
                if item["aggregateRating"] is not None
                and band["from"] <= item["aggregateRating"]
                < band["toExclusive"]
            ]),
        }
        for band in DISTRIBUTION_BANDS
    ]
    participants = {
        item.participant_code: item
        for item in OpsRatedParticipant.objects.all()
    }
    groups = []
    for group in OpsRatingGroup.objects.all():
        member_codes = {
            code for code, row in participants.items()
            if row.group_code == group.group_code
        }
        members = [
            item for item in summaries if item["employeeId"] in member_codes
        ]
        rated = [
            item for item in members if item["aggregateRating"] is not None
        ]
        if not rated:
            groups.append({
                "groupCode": group.group_code,
                "safeLabel": group.safe_label,
                "state": "NO_AGGREGATE",
                "aggregateRating": None,
                "ratedCount": 0,
                "memberCount": len(members),
            })
            continue
        if len(rated) < min_group_size:
            groups.append({
                "groupCode": group.group_code,
                "safeLabel": group.safe_label,
                "state": "SUPPRESSED",
                "aggregateRating": None,
                "ratedCount": len(rated),
                "memberCount": len(members),
            })
            continue
        total = sum(item["aggregateRating"] for item in rated)
        groups.append({
            "groupCode": group.group_code,
            "safeLabel": group.safe_label,
            "state": "READY",
            "aggregateRating": round_aggregate(total / len(rated)),
            "ratedCount": len(rated),
            "memberCount": len(members),
        })
    groups.sort(key=lambda item: item["safeLabel"])
    return {
        "ratedParticipants": len(ready),
        "coveredParticipants": len([
            item for item in summaries if item["evaluationsCount"] > 0
        ]),
        "totalParticipants": len(summaries),
        "withoutAggregate": len([
            item for item in summaries if item["dataState"] != "READY"
        ]),
        "correctedEvaluations": corrected,
        "distribution": distribution,
        "groups": groups,
    }


# ── Рабочее пространство оценивания (§19.14) ────────────────────────────────


def _basis_label(code):
    if code is None:
        return None
    for basis in EVALUATION_BASES:
        if basis["code"] == code:
            return basis["label"]
    return code


def _work_item_view(item):
    """Проекция задания наружу — ПОЛЕМ ЗА ПОЛЕМ, без оценщика (§19.7)."""
    return {
        "id": item.work_item_code,
        "securityEventId": item.event_code,
        "eventRunId": item.event_run_code,
        "assignmentId": item.assignment_code,
        "targetEmployeeId": item.target_participant_code,
        "targetGroupId": item.target_group_code,
        "targetSafeLabel": item.target_safe_label,
        "targetSafeUnitLabel": item.target_safe_unit_label,
        "postLabel": item.post_label,
        "actualStartsAt": item.actual_starts_at.isoformat(),
        "actualEndsAt": item.actual_ends_at.isoformat(),
        "participated": item.participated,
        "evaluationDirection": item.evaluation_direction,
        "initialScore": item.initial_score,
        "status": item.status,
        "revision": item.revision,
        "submittedEvaluationId": item.submitted_evaluation_code,
        "submittedAt": _iso(item.submitted_at),
    }


def _submitted_view(item, evaluations_by_code, actor):
    """Собственная отправленная оценка — ТОЛЬКО для записи, автором которой
    является запрашивающий: чужой комментарий не доезжает до браузера вовсе."""
    if item.submitted_evaluation_code is None or item.submitted_at is None:
        return None
    evaluation = evaluations_by_code.get(item.submitted_evaluation_code)
    if evaluation is None or evaluation.evaluator_user_id != actor:
        return None
    return {
        "workItemId": item.work_item_code,
        "evaluationId": evaluation.evaluation_code,
        "targetSafeLabel": item.target_safe_label,
        "postLabel": item.post_label,
        "evaluationDirection": evaluation.evaluation_direction,
        "method": evaluation.method,
        "score": evaluation.score,
        "basisLabel": _basis_label(evaluation.basis_code),
        "basisNote": evaluation.basis_note,
        "comment": evaluation.comment,
        "submittedAt": item.submitted_at.isoformat(),
        "revision": item.revision,
    }


def _summarize_queue(items):
    submitted = len([item for item in items if item.status == "SUBMITTED"])
    return {
        "total": len(items),
        "submitted": submitted,
        "remaining": len(items) - submitted,
    }


def _event_progress(items):
    """Сводка по мероприятию — работа ВСЕХ оценщиков; значений оценок нет."""
    directions = []
    for item in items:
        if item.evaluation_direction not in directions:
            directions.append(item.evaluation_direction)
    return {
        "participants": len({
            item.target_participant_code
            or item.target_group_code
            or item.work_item_code
            for item in items
        }),
        "counters": _summarize_queue(items),
        "byDirection": [
            {
                "direction": direction,
                "counters": _summarize_queue([
                    item for item in items
                    if item.evaluation_direction == direction
                ]),
            }
            for direction in directions
        ],
    }


def _serialize_event(event):
    return {
        "securityEventId": event.event_code,
        "number": event.number,
        "title": event.title,
        "objectLabel": event.object_label,
        "actualStartsAt": event.actual_starts_at.isoformat(),
        "actualEndsAt": event.actual_ends_at.isoformat(),
        "stateLabel": event.state_label,
    }


def evaluation_workspace(actor, perms, event_id):
    """Очередь отбирается ПО ОЦЕНЩИКУ на сервере (§19.14): чужие задания и
    чужие оценки в ответ не попадают, а не скрываются вёрсткой."""
    flags = read_feature_flags()
    policy = read_rating_policy()
    base = {
        "bases": EVALUATION_BASES,
        "policy": policy,
        "loadedAt": Clock.now().isoformat(),
        "capabilities": {"operationalRatings": flags.operational_ratings},
        "unavailableViews": UNAVAILABLE_WORKSPACE_VIEWS,
    }
    if not flags.operational_ratings:
        return {
            **base,
            "events": [], "selectedEvent": None, "pending": [],
            "submitted": [],
            "queue": {"total": 0, "submitted": 0, "remaining": 0},
            "eventProgress": None,
            "unavailableReason": "FEATURE_DISABLED",
        }

    mine = list(
        OpsEvaluationWorkItem.objects.filter(evaluator_user_id=actor)
    )
    my_event_codes = {item.event_code for item in mine}
    events = [
        _serialize_event(event)
        for event in OpsEvaluationEvent.objects.all()
        if event.event_code in my_event_codes
    ]
    selected = next(
        (event for event in events if event["securityEventId"] == event_id),
        events[0] if events else None,
    )
    scoped = (
        []
        if selected is None
        else [
            item for item in mine
            if item.event_code == selected["securityEventId"]
        ]
    )
    # Порядок задаёт СЕРВЕР и задаёт его по подписи участника: очередь по
    # начальной оценке была бы подсказкой «кого снижать».
    ordered = sorted(scoped, key=lambda item: item.target_safe_label)
    evaluations_by_code = {
        item.evaluation_code: item
        for item in OpsEventEvaluation.objects.all()
    }
    submitted_views = [
        view for view in (
            _submitted_view(item, evaluations_by_code, actor)
            for item in ordered if item.status == "SUBMITTED"
        )
        if view is not None
    ]
    event_items = (
        []
        if selected is None
        else list(
            OpsEvaluationWorkItem.objects.filter(
                event_code=selected["securityEventId"]
            )
        )
    )
    return {
        **base,
        "events": events,
        "selectedEvent": selected,
        "pending": [
            _work_item_view(item)
            for item in ordered if item.status == "PENDING"
        ],
        "submitted": submitted_views,
        "queue": _summarize_queue(scoped),
        # Сводка мероприятия — работа ВСЕХ оценщиков, отдельное право
        # (§19.14). Без права её нет в ответе, а не скрыта.
        "eventProgress": (
            _event_progress(event_items)
            if selected is not None
            and has_perm(perms, VIEW_AGGREGATE_PERMISSION)
            else None
        ),
        "unavailableReason": None,
    }


# ── Журнал (§19.27) и уведомления (§19.28) ──────────────────────────────────


def _audit_entry_row(*, actor, event_code, outcome, reason_code=None,
                     item=None, evaluation_code=None, correction_code=None,
                     request_id=None, revision=None):
    """Запись журнала — ПОЛЕМ ЗА ПОЛЕМ: значения оценки и комментария среди
    параметров нет, поэтому запись их нести не может."""
    row = OpsRatingAuditEntry.objects.create(
        entry_code=_tmp_code(),
        occurred_at=Clock.now(),
        actor_user_id=actor,
        event_code=event_code,
        outcome=outcome,
        reason_code=reason_code,
        security_event_code=item.event_code if item is not None else None,
        event_run_code=item.event_run_code if item is not None else None,
        assignment_code=item.assignment_code if item is not None else None,
        evaluation_code=evaluation_code,
        correction_code=correction_code,
        request_id=request_id,
        revision=(
            revision if revision is not None
            else (item.revision if item is not None else None)
        ),
    )
    _stamp_code(row, "entry_code", "rating-audit")
    return row


def record_rejection(*, actor, event_code, reason_code, work_item_code=None,
                     request_id=None):
    """Запись об отказе — СВОЕЙ транзакцией: внутри отклонённой мутации она
    исчезла бы вместе с откатом, а журнал обязан отказ помнить (§19.27)."""
    with transaction.atomic():
        item = (
            OpsEvaluationWorkItem.objects.filter(
                work_item_code=work_item_code
            ).first()
            if work_item_code is not None
            else None
        )
        _audit_entry_row(
            actor=actor, event_code=event_code, outcome="REJECTED",
            reason_code=reason_code, item=item, request_id=request_id,
        )


def rating_audit(page):
    """Журнал: от свежего к старому — его читают, чтобы увидеть последнее."""
    ordered = list(OpsRatingAuditEntry.objects.all())
    page_count = max(1, -(-len(ordered) // AUDIT_PAGE_SIZE))
    safe_page = min(max(1, page), page_count)
    start = (safe_page - 1) * AUDIT_PAGE_SIZE
    return {
        "results": [
            {
                "id": entry.entry_code,
                "occurredAt": entry.occurred_at.isoformat(),
                "actorUserId": entry.actor_user_id,
                "eventCode": entry.event_code,
                "outcome": entry.outcome,
                "reasonCode": entry.reason_code,
                "securityEventId": entry.security_event_code,
                "eventRunId": entry.event_run_code,
                "assignmentId": entry.assignment_code,
                "evaluationId": entry.evaluation_code,
                "correctionId": entry.correction_code,
                "requestId": entry.request_id,
                "revision": entry.revision,
            }
            for entry in ordered[start:start + AUDIT_PAGE_SIZE]
        ],
        "total": len(ordered),
        "page": safe_page,
        "pageCount": page_count,
        "unavailableViews": UNAVAILABLE_AUDIT_VIEWS,
    }


def _notification_row(*, recipient, code, deep_link, security_event_code):
    row = OpsRatingNotification.objects.create(
        notification_code=_tmp_code(),
        notified_at=Clock.now(),
        recipient_user_id=recipient,
        code=code,
        deep_link=deep_link,
        security_event_code=security_event_code,
    )
    _stamp_code(row, "notification_code", "rating-notification")
    return row


def rating_notifications(actor):
    """Только СВОИ: отбор по адресату делает СЕРВЕР — чужие в ответ не
    попадают, поэтому и права «видеть чужие» нет: охранять им нечего."""
    rows = OpsRatingNotification.objects.filter(
        recipient_user_id=actor or ""
    )
    return {
        "results": [
            {
                "id": row.notification_code,
                "createdAt": row.notified_at.isoformat(),
                "recipientUserId": row.recipient_user_id,
                "code": row.code,
                "deepLink": row.deep_link,
                "securityEventId": row.security_event_code,
            }
            for row in rows
        ],
        "unavailableViews": UNAVAILABLE_NOTIFICATION_VIEWS,
    }


# ── Отправка и исправление оценки (§19.7-19.10, §19.18) ─────────────────────


def _validate_submission(score, basis_code, basis_note, comment):
    """Поднимает ПЕРВОЕ нарушение — порядок проверок закреплён контрактом:
    человеку с оценкой 12 и пустым комментарием сначала говорят про шкалу.

    DomainError поднимается ЛИТЕРАЛЬНО на каждом правиле: скан покрытия
    кодов читает только литеральные конструкции, и код в переменной значился
    бы «обещанием, которое не исполнится» (ловушка срезов B1/C2)."""
    if not isinstance(score, int) or isinstance(score, bool):
        raise DomainError(
            "SCORE_NOT_INTEGER", 422,
            message="Оценка выставляется целым значением шкалы.",
        )
    if score < RATING_SCALE_MIN or score > RATING_SCALE_MAX:
        raise DomainError(
            "SCORE_OUT_OF_SCALE", 422,
            message=f"Оценка вне шкалы {RATING_SCALE_MIN}–{RATING_SCALE_MAX}.",
        )
    code = basis_code or ""
    if code == "":
        raise DomainError(
            "BASIS_REQUIRED", 422, message="Укажите основание оценки.",
        )
    basis = next(
        (item for item in EVALUATION_BASES if item["code"] == code), None
    )
    if basis is None:
        raise DomainError(
            "BASIS_UNKNOWN", 422, message="Неизвестное основание оценки.",
        )
    if basis["requiresNote"] and (basis_note or "").strip() == "":
        raise DomainError(
            "BASIS_NOTE_REQUIRED", 422,
            message=f"Основание «{basis['label']}» требует пояснения.",
        )
    # §19.10: основание НЕ заменяет обязательный комментарий при значении
    # ниже 8 — проверка стоит ПОСЛЕ основания и не отменяется им.
    if score < RATING_DEFAULT_SCORE and (comment or "").strip() == "":
        raise DomainError(
            "COMMENT_REQUIRED", 422,
            message=f"Оценка ниже {RATING_DEFAULT_SCORE} требует "
                    "комментария с конкретной причиной.",
        )


def _conflict_details(item, evaluations_by_code):
    """§19.25: актуальная редакция и действующие значения записи — иначе
    экрану нечем показать diff того, что изменилось за время заполнения."""
    current = (
        evaluations_by_code.get(item.submitted_evaluation_code)
        if item.submitted_evaluation_code is not None
        else None
    )
    return {
        "currentRevision": item.revision,
        "currentScore": current.score if current is not None else None,
        "currentBasisLabel": _basis_label(
            current.basis_code if current is not None else None
        ),
        "currentComment": current.comment if current is not None else None,
        "currentEvaluationId": (
            current.evaluation_code if current is not None else None
        ),
    }


def _event_closure(event_code):
    """§19.23: закрыто ли мероприятие в живом реестре ОМ. `None` — карточки
    ОМ у мероприятия нет (историческое): замок неприменим — закрытым может
    быть только то, что существует."""
    event = OpsEvaluationEvent.objects.filter(event_code=event_code).first()
    if event is None or event.security_event_id is None:
        return None
    registry_row = OpsSecurityEvent.objects.filter(
        pk=event.security_event_id
    ).first()
    if registry_row is None:
        return None
    # Владелец факта — ШТАМП закрытия, а не имя стадии: пост-архивные
    # состояния не должны отвязать замок молча.
    return registry_row.closed_at is not None or registry_row.stage == "CLOSED"


def _blank_to_none(value):
    trimmed = (value or "").strip()
    return trimmed if trimmed != "" else None


def _my_queue(actor, event_code):
    return list(
        OpsEvaluationWorkItem.objects.filter(
            evaluator_user_id=actor, event_code=event_code
        )
    )


def submit_evaluation(actor, perms, work_item_code, body):
    """Отправка оценки (§19.7-19.10). Оценщик — из учётной записи,
    target/мероприятие/направление — из ЗАДАНИЯ: тело их не несёт и подменить
    не может. Проверка формы выполняется ЗАНОВО на серверных данных."""
    if not has_perm(perms, EVALUATE_PERMISSION):
        record_rejection(
            actor=actor, event_code="EVALUATION_ACCESS_DENIED",
            reason_code="PERMISSION_DENIED", work_item_code=work_item_code,
            request_id=body.get("idempotencyKey"),
        )
        raise _permission_denied(EVALUATE_PERMISSION)
    idempotency_key = str(body.get("idempotencyKey") or "")
    try:
        with transaction.atomic():
            # §19.26: повтор с тем же ключом возвращает ПРЕЖНИЙ результат и
            # не создаёт второй оценки. Проверка стоит до всех прочих.
            done = OpsRatingIdempotencyRecord.objects.filter(
                key=idempotency_key, operation="submit"
            ).first()
            evaluations_by_code = {
                row.evaluation_code: row
                for row in OpsEventEvaluation.objects.all()
            }
            if done is not None:
                repeated = OpsEvaluationWorkItem.objects.filter(
                    work_item_code=done.work_item_code
                ).first()
                view = (
                    _submitted_view(repeated, evaluations_by_code, actor)
                    if repeated is not None
                    else None
                )
                if repeated is not None and view is not None:
                    return {
                        "workItem": _work_item_view(repeated),
                        "submitted": view,
                        "queue": _summarize_queue(
                            _my_queue(actor, repeated.event_code)
                        ),
                    }
            item = (
                OpsEvaluationWorkItem.objects.select_for_update()
                .filter(work_item_code=work_item_code)
                .first()
            )
            # Чужое задание — 404, а не 403: отказ по праву подтвердил бы,
            # что задание существует и кем-то оценивается.
            if item is None or item.evaluator_user_id != actor:
                raise _not_found(work_item_code)
            flags = read_feature_flags()
            if not flags.operational_ratings:
                raise DomainError(
                    "RATING_DISABLED", 422,
                    message="Оперативный рейтинг выключен: оценки не "
                            "принимаются.",
                )
            # §19.23: закрытое мероприятие обычная rating mutation не
            # изменяет. Замок стоит ДО состояния задания и правил формы.
            if _event_closure(item.event_code) is True:
                raise DomainError(
                    "EVALUATION_ARCHIVE_LOCKED", 422,
                    message="Мероприятие закрыто, архив сформирован: оценка "
                            "оформляется только разрешённым дополнением, "
                            "которого в контракте нет.",
                )
            if item.status != "PENDING":
                raise DomainError(
                    "EVALUATION_ALREADY_SUBMITTED", 422,
                    message="Оценка по этому заданию уже отправлена. "
                            "Исправление — отдельная операция (§19.18).",
                )
            # §19.33/§19.35: оценивается фактический участник.
            if not item.participated:
                raise DomainError(
                    "PARTICIPATION_NOT_CONFIRMED", 422,
                    message="Фактическое участие сотрудника не подтверждено.",
                )
            if item.target_participant_code is None:
                raise DomainError(
                    "GROUP_EVALUATION_UNSUPPORTED", 422,
                    message="Групповая оценка не поддерживается: состав "
                            "группы на момент мероприятия не записан.",
                )
            # Редакция задания: человек отправляет ту версию, которую видел.
            if item.revision != body.get("revision"):
                raise DomainError(
                    "EVALUATION_REVISION_MISMATCH", 409,
                    detail=_conflict_details(item, evaluations_by_code),
                    message="Задание изменилось: сравните значения и решите, "
                            "что отправлять.",
                )
            _validate_submission(
                body.get("score"), body.get("basisCode"),
                body.get("basisNote"), body.get("comment"),
            )

            now = Clock.now()
            evaluation = OpsEventEvaluation.objects.create(
                evaluation_code=_tmp_code(),
                event_code=item.event_code,
                participant_code=item.target_participant_code,
                evaluator_user_id=actor,
                score=body.get("score"),
                comment=_blank_to_none(body.get("comment")),
                evaluation_direction=item.evaluation_direction,
                method="MANUAL",
                basis_code=body.get("basisCode"),
                basis_note=_blank_to_none(body.get("basisNote")),
                evaluated_at=Clock.today_local(),
                superseded_by_code=None,
            )
            # Идентификатор генерирует СЕРВЕР (§19.7) и он устойчив.
            _stamp_code(evaluation, "evaluation_code", "evaluation")
            item.status = "SUBMITTED"
            item.revision = item.revision + 1
            item.submitted_evaluation_code = evaluation.evaluation_code
            item.submitted_at = now
            item.save(update_fields=[
                "status", "revision", "submitted_evaluation_code",
                "submitted_at", "updated_at",
            ])
            evaluations_by_code[evaluation.evaluation_code] = evaluation
            # §19.28: уведомление живёт в ТОЙ ЖЕ транзакции, что и оценка, —
            # отдельное пережило бы неудавшийся коммит.
            _notification_row(
                recipient=actor or "",
                code="EVALUATION_SUBMITTED",
                deep_link=f"/security-ops/ratings/workspace?event={item.event_code}",
                security_event_code=item.event_code,
            )
            _audit_entry_row(
                actor=actor, event_code="EVALUATION_SUBMITTED",
                outcome="SUCCESS", item=item,
                evaluation_code=evaluation.evaluation_code,
                request_id=idempotency_key,
            )
            # §19.27: изменение значения относительно начального — отдельное
            # событие: отправка восьмёрки и снижение — разные факты.
            if evaluation.score != item.initial_score:
                _audit_entry_row(
                    actor=actor,
                    event_code="EVALUATION_SCORE_CHANGED_FROM_INITIAL",
                    outcome="SUCCESS", item=item,
                    evaluation_code=evaluation.evaluation_code,
                    request_id=idempotency_key,
                )
            # В записи идемпотентности только идентификаторы: снимок ответа
            # нёс бы закрытый комментарий целиком.
            OpsRatingIdempotencyRecord.objects.create(
                key=idempotency_key, operation="submit",
                work_item_code=item.work_item_code,
                evaluation_code=evaluation.evaluation_code,
            )
            submitted = _submitted_view(item, evaluations_by_code, actor)
            if submitted is None:
                raise RuntimeError(
                    "ratings: отправленная оценка не собралась в проекцию"
                )
            return {
                "workItem": _work_item_view(item),
                "submitted": submitted,
                "queue": _summarize_queue(_my_queue(actor, item.event_code)),
            }
    except DomainError as error:
        # Отказ пишется СВОЕЙ транзакцией. Попытка снижения без комментария
        # названа своим событием — §19.27 перечисляет её отдельно.
        if error.http_status in (409, 422):
            record_rejection(
                actor=actor,
                event_code=(
                    "EVALUATION_LOW_SCORE_WITHOUT_COMMENT"
                    if error.code == "COMMENT_REQUIRED"
                    else "EVALUATION_ACCESS_DENIED"
                ),
                reason_code=error.code,
                work_item_code=work_item_code,
                request_id=idempotency_key,
            )
        raise


def _build_chain(evaluations, corrections, current_code):
    """Цепочка исправлений (§19.17) — ОТ КОРНЯ вперёд по ссылкам замещения,
    а не сортировкой по времени: время говорит, когда записи появились, а
    цепочка — что чем замещено."""
    by_code = {item.evaluation_code: item for item in evaluations}
    root = by_code.get(current_code)
    if root is None:
        return []
    guard = 0
    while guard <= 50:
        previous = next(
            (item for item in evaluations
             if item.superseded_by_code == root.evaluation_code),
            None,
        )
        if previous is None:
            break
        root = previous
        guard += 1

    links = []
    node = root
    while node is not None and len(links) <= 50:
        correction = next(
            (item for item in corrections
             if item.original_evaluation_code == node.evaluation_code),
            None,
        )
        links.append({
            "correctionId": (
                correction.correction_code if correction is not None else None
            ),
            "evaluationId": node.evaluation_code,
            "score": node.score,
            "basisLabel": _basis_label(node.basis_code),
            "basisNote": node.basis_note,
            "comment": node.comment,
            # Старое значение остаётся видимым вместе с причиной замещения:
            # §19.18 «нельзя скрыть старое значение».
            "supersededReason": (
                correction.reason if correction is not None else None
            ),
            "supersededAt": (
                correction.corrected_at.isoformat()
                if correction is not None else None
            ),
            "current": node.superseded_by_code is None,
        })
        node = (
            by_code.get(node.superseded_by_code)
            if node.superseded_by_code is not None
            else None
        )
    return links


def submitted_evaluation_detail(actor, perms, work_item_code):
    """Карточка отправленной оценки (§19.17) — только СВОЕЙ. Отдельная
    операция: §19.18 шаг 3 требует перезагрузить актуальную редакцию."""
    if not has_perm(perms, EVALUATE_PERMISSION):
        raise _permission_denied(EVALUATE_PERMISSION)
    flags = read_feature_flags()
    item = OpsEvaluationWorkItem.objects.filter(
        work_item_code=work_item_code
    ).first()
    if item is None or item.evaluator_user_id != actor:
        # §19.27 «запрещённая попытка просмотра»: наружу 404 (существование
        # записи не подтверждаем), но в журнале попытка остаётся.
        record_rejection(
            actor=actor, event_code="EVALUATION_ACCESS_DENIED",
            reason_code="FOREIGN_EVALUATION", work_item_code=work_item_code,
        )
        raise _not_found(work_item_code)
    evaluations = list(OpsEventEvaluation.objects.all())
    evaluations_by_code = {row.evaluation_code: row for row in evaluations}
    submitted = _submitted_view(item, evaluations_by_code, actor)
    if submitted is None:
        raise _not_found(work_item_code)
    corrections = list(OpsEvaluationCorrection.objects.all())
    return {
        "workItem": _work_item_view(item),
        "submitted": submitted,
        # Цепочка — СВОЁ право (§19.22): видеть, что запись правили, —
        # контрольная функция, отдельная от права её править.
        "chain": (
            _build_chain(evaluations, corrections, submitted["evaluationId"])
            if has_perm(perms, VIEW_CHAIN_PERMISSION)
            else None
        ),
        "bases": EVALUATION_BASES,
        # Право решает СЕРВЕР и присылает готовым: кнопка, выключенная
        # только на клиенте, ограничением доступа не является.
        "canCorrect": (
            has_perm(perms, CORRECT_PERMISSION)
            and flags.operational_ratings
        ),
        "loadedAt": Clock.now().isoformat(),
    }


def correct_evaluation(actor, perms, work_item_code, body):
    """Исправление (§19.18): исходная запись НЕ переписывается — создаётся
    замещающая, исходная помечается ссылкой, связь и причина — отдельной
    записью. Агрегат после этого считает сервер (§19.19)."""
    if not has_perm(perms, CORRECT_PERMISSION):
        record_rejection(
            actor=actor, event_code="EVALUATION_ACCESS_DENIED",
            reason_code="PERMISSION_DENIED", work_item_code=work_item_code,
            request_id=body.get("idempotencyKey"),
        )
        raise _permission_denied(CORRECT_PERMISSION)
    idempotency_key = str(body.get("idempotencyKey") or "")
    try:
        with transaction.atomic():
            done = OpsRatingIdempotencyRecord.objects.filter(
                key=idempotency_key, operation="correct"
            ).first()
            evaluations = list(OpsEventEvaluation.objects.all())
            evaluations_by_code = {
                row.evaluation_code: row for row in evaluations
            }
            corrections = list(OpsEvaluationCorrection.objects.all())
            if done is not None:
                repeated = OpsEvaluationWorkItem.objects.filter(
                    work_item_code=done.work_item_code
                ).first()
                view = (
                    _submitted_view(repeated, evaluations_by_code, actor)
                    if repeated is not None
                    else None
                )
                if repeated is not None and view is not None:
                    return {
                        "workItem": _work_item_view(repeated),
                        "submitted": view,
                        "chain": (
                            _build_chain(
                                evaluations, corrections,
                                done.evaluation_code,
                            )
                            if has_perm(perms, VIEW_CHAIN_PERMISSION)
                            else None
                        ),
                    }
            item = (
                OpsEvaluationWorkItem.objects.select_for_update()
                .filter(work_item_code=work_item_code)
                .first()
            )
            # Чужая запись — 404: исправлять её нельзя вовсе (§19.21), и
            # отказ по праву подтвердил бы её существование.
            if item is None or item.evaluator_user_id != actor:
                raise _not_found(work_item_code)
            flags = read_feature_flags()
            if not flags.operational_ratings:
                raise DomainError(
                    "RATING_DISABLED", 422,
                    message="Оперативный рейтинг выключен: исправления не "
                            "принимаются.",
                )
            original_code = item.submitted_evaluation_code
            if item.status != "SUBMITTED" or original_code is None:
                raise DomainError(
                    "EVALUATION_NOT_SUBMITTED", 422,
                    message="Исправлять нечего: оценка по заданию ещё не "
                            "отправлена.",
                )
            if item.revision != body.get("revision"):
                raise DomainError(
                    "EVALUATION_REVISION_MISMATCH", 409,
                    detail=_conflict_details(item, evaluations_by_code),
                    message="Запись изменилась: сравните значения и решите, "
                            "что отправлять.",
                )
            original = evaluations_by_code.get(original_code)
            if original is None:
                raise _not_found(original_code)
            # §19.25: «уже исправлена» — ОТДЕЛЬНЫЙ конфликт: редакция могла
            # совпасть, а запись уже быть вытесненной.
            if original.superseded_by_code is not None:
                raise DomainError(
                    "EVALUATION_ALREADY_CORRECTED", 409,
                    detail=_conflict_details(item, evaluations_by_code),
                    message="Эта запись уже исправлена: откройте действующую "
                            "и повторите.",
                )
            _validate_submission(
                body.get("score"), body.get("basisCode"),
                body.get("basisNote"), body.get("comment"),
            )
            # Причина проверяется ПОСЛЕДНЕЙ: сначала должно быть корректно
            # то, что исправляют (§19.18 шаг 6-7).
            if (body.get("reason") or "").strip() == "":
                raise DomainError(
                    "CORRECTION_REASON_REQUIRED", 422,
                    message="Укажите причину исправления оценки.",
                )

            now = Clock.now()
            # Оценщик, target, мероприятие и направление наследуются от
            # исходной записи — §19.18 запрещает их менять.
            replacement = OpsEventEvaluation.objects.create(
                evaluation_code=_tmp_code(),
                event_code=original.event_code,
                participant_code=original.participant_code,
                evaluator_user_id=original.evaluator_user_id,
                score=body.get("score"),
                comment=_blank_to_none(body.get("comment")),
                evaluation_direction=original.evaluation_direction,
                method=original.method,
                basis_code=body.get("basisCode"),
                basis_note=_blank_to_none(body.get("basisNote")),
                evaluated_at=original.evaluated_at,
                superseded_by_code=None,
            )
            _stamp_code(replacement, "evaluation_code", "evaluation")
            # Исходная запись остаётся в истории — меняется ровно одна
            # ссылка.
            original.superseded_by_code = replacement.evaluation_code
            original.save(update_fields=["superseded_by_code", "updated_at"])
            correction = OpsEvaluationCorrection.objects.create(
                correction_code=_tmp_code(),
                original_evaluation_code=original.evaluation_code,
                replacement_evaluation_code=replacement.evaluation_code,
                reason=(body.get("reason") or "").strip(),
                corrected_by=actor or "",
                corrected_at=now,
                revision=item.revision,
            )
            _stamp_code(correction, "correction_code", "correction")
            item.revision = item.revision + 1
            item.submitted_evaluation_code = replacement.evaluation_code
            item.submitted_at = now
            item.save(update_fields=[
                "revision", "submitted_evaluation_code", "submitted_at",
                "updated_at",
            ])
            evaluations = list(OpsEventEvaluation.objects.all())
            evaluations_by_code = {
                row.evaluation_code: row for row in evaluations
            }
            corrections.append(correction)
            # Адресат — АВТОР исходной записи, а не тот, кто исправил
            # (§19.28): адресность взята из записи, а не из нажавшего кнопку.
            _notification_row(
                recipient=original.evaluator_user_id or actor or "",
                code="EVALUATION_CORRECTED",
                deep_link=f"/security-ops/ratings/workspace?event={item.event_code}",
                security_event_code=item.event_code,
            )
            _audit_entry_row(
                actor=actor, event_code="EVALUATION_CORRECTED",
                outcome="SUCCESS", item=item,
                evaluation_code=replacement.evaluation_code,
                correction_code=correction.correction_code,
                request_id=idempotency_key,
            )
            OpsRatingIdempotencyRecord.objects.create(
                key=idempotency_key, operation="correct",
                work_item_code=item.work_item_code,
                evaluation_code=replacement.evaluation_code,
            )
            submitted = _submitted_view(item, evaluations_by_code, actor)
            if submitted is None:
                raise RuntimeError(
                    "ratings: исправленная оценка не собралась в проекцию"
                )
            return {
                "workItem": _work_item_view(item),
                "submitted": submitted,
                "chain": (
                    _build_chain(
                        evaluations, corrections,
                        replacement.evaluation_code,
                    )
                    if has_perm(perms, VIEW_CHAIN_PERMISSION)
                    else None
                ),
            }
    except DomainError as error:
        if error.http_status in (409, 422):
            record_rejection(
                actor=actor, event_code="EVALUATION_CORRECTION_REJECTED",
                reason_code=error.code, work_item_code=work_item_code,
                request_id=idempotency_key,
            )
        raise


# ── Реестр итоговых оценок (§19.15-19.16) ───────────────────────────────────


def evaluation_registry(filters):
    """Строка собирается ПОЛЕМ ЗА ПОЛЕМ из закрытой записи: ни score, ни
    комментарий, ни основание, ни оценщик в неё не попадают (§19.16, §19.21).
    Отбор и страница считаются здесь же."""
    flags = read_feature_flags()
    policy = read_rating_policy()
    business_date = Clock.today_local()
    calculated_at = Clock.now().isoformat()
    participants = {
        row.participant_code: row
        for row in OpsRatedParticipant.objects.all()
    }
    groups = {
        row.group_code: row for row in OpsRatingGroup.objects.all()
    }
    events = {
        row.event_code: row for row in OpsEvaluationEvent.objects.all()
    }
    evaluations = list(OpsEventEvaluation.objects.all())
    corrections = list(OpsEvaluationCorrection.objects.all())
    replacement_codes = {
        item.replacement_evaluation_code for item in corrections
    }
    work_items_by_evaluation = {
        item.submitted_evaluation_code: item
        for item in OpsEvaluationWorkItem.objects.exclude(
            submitted_evaluation_code=None
        )
    }
    summaries = {
        code: build_summary(
            participant, evaluations, policy, flags.operational_ratings,
            business_date, calculated_at,
        )
        for code, participant in participants.items()
    }

    rows = []
    if flags.operational_ratings:
        for evaluation in evaluations:
            participant = participants.get(evaluation.participant_code)
            group = (
                groups.get(participant.group_code)
                if participant is not None
                else None
            )
            event = events.get(evaluation.event_code)
            work_item = work_items_by_evaluation.get(
                evaluation.evaluation_code
            )
            summary = summaries.get(evaluation.participant_code)
            rows.append({
                # Идентификатор СТРОКИ, а не оценки: по идентификатору
                # закрытой записи её можно было бы спрашивать поимённо.
                "rowId": f"row-{evaluation.evaluation_code}",
                "employeeId": evaluation.participant_code,
                "employeeSafeLabel": (
                    participant.safe_label if participant is not None else "—"
                ),
                "unitSafeLabel": (
                    group.safe_label if group is not None else "—"
                ),
                "eventNumber": event.number if event is not None else "—",
                "eventTitle": event.title if event is not None else "—",
                "objectLabel": (
                    event.object_label if event is not None else "—"
                ),
                "postLabel": (
                    work_item.post_label if work_item is not None else None
                ),
                # `null`, а не `false`: отсутствие сведений об участии и
                # зафиксированное неучастие — разные утверждения.
                "participated": (
                    work_item.participated if work_item is not None else None
                ),
                "evaluationDirection": evaluation.evaluation_direction,
                "method": evaluation.method,
                "evaluatedAt": evaluation.evaluated_at.isoformat(),
                # Признак исправления — по цепочке, а не сравнением значений.
                "corrected": (
                    evaluation.superseded_by_code is not None
                    or evaluation.evaluation_code in replacement_codes
                ),
                "aggregateRating": (
                    summary["aggregateRating"]
                    if summary is not None else None
                ),
                "aggregateState": (
                    summary["dataState"]
                    if summary is not None else "INSUFFICIENT_DATA"
                ),
            })

    filtered = [row for row in rows if _matches_filters(row, filters)]
    # Порядок задаёт сервер: свежие раньше, при равной дате — по подписи.
    # Сортировка по агрегату была бы таблицей лидеров (§22.16). Две стабильные
    # сортировки: сначала подпись по возрастанию, затем дата по убыванию.
    filtered.sort(key=lambda row: row["employeeSafeLabel"])
    filtered.sort(key=lambda row: row["evaluatedAt"], reverse=True)
    page_count = max(1, -(-len(filtered) // REGISTRY_PAGE_SIZE))
    safe_page = min(max(1, filters.get("page", 1)), page_count)
    start = (safe_page - 1) * REGISTRY_PAGE_SIZE
    ordered_events = sorted(events.values(), key=lambda row: row.number)
    ordered_groups = sorted(groups.values(), key=lambda row: row.safe_label)
    ordered_participants = sorted(
        participants.values(), key=lambda row: row.safe_label
    )
    return {
        "results": filtered[start:start + REGISTRY_PAGE_SIZE],
        "total": len(filtered),
        "page": safe_page,
        "pageCount": page_count,
        # Значения фильтров даёт СЕРВЕР (§19.15): автодополнение не собирает
        # список из полученных строк.
        "options": {
            "events": [
                {"value": row.number, "label": f"{row.number} — {row.title}"}
                for row in ordered_events
            ],
            "units": [
                {"value": row.safe_label, "label": row.safe_label}
                for row in ordered_groups
            ],
            "employees": [
                {"value": row.participant_code, "label": row.safe_label}
                for row in ordered_participants
            ],
        },
        "policy": policy if flags.operational_ratings else None,
        "capabilities": {"operationalRatings": flags.operational_ratings},
        # Sensitive-колонок нет ни у кого: право под них не заведено (§19.21).
        "columns": {"sensitiveDetails": False},
        "unavailableViews": UNAVAILABLE_REGISTRY_VIEWS,
    }


def _matches_filters(row, filters):
    if filters.get("from") and row["evaluatedAt"] < filters["from"]:
        return False
    # Границы периода ВКЛЮЧИТЕЛЬНЫ с обеих сторон: «с 1 по 31» без
    # последнего дня — самая тихая ошибка отчётного периода.
    if filters.get("to") and row["evaluatedAt"] > filters["to"]:
        return False
    if filters.get("event") and row["eventNumber"] != filters["event"]:
        return False
    if filters.get("unit") and row["unitSafeLabel"] != filters["unit"]:
        return False
    if filters.get("employee") and row["employeeId"] != filters["employee"]:
        return False
    if (
        filters.get("direction")
        and row["evaluationDirection"] != filters["direction"]
    ):
        return False
    if filters.get("method") and row["method"] != filters["method"]:
        return False
    if filters.get("correctedOnly") and not row["corrected"]:
        return False
    search = (filters.get("search") or "").strip().lower()
    if search:
        # Поиск идёт ТОЛЬКО по безопасным подписям: искать по комментарию
        # значило бы раскрывать закрытый текст по одной букве за запрос.
        haystack = " ".join([
            row["employeeSafeLabel"], row["unitSafeLabel"],
            row["eventNumber"], row["eventTitle"], row["objectLabel"],
            row["postLabel"] or "",
        ]).lower()
        if search not in haystack:
            return False
    return True


# ── Экспорт (§19.29) ────────────────────────────────────────────────────────


def _csv_field(value):
    """Кавычки удваиваются; поле в кавычках при разделителе/кавычке/переводе
    строки. Осознанный дубль генератора отчётного реестра — разные файлы."""
    if any(char in value for char in ('"', ";", "\n")):
        return '"' + value.replace('"', '""') + '"'
    return value


def _aggregate_export_content(summaries, policy):
    """Содержимое выгрузки: отсутствие агрегата печатается СОСТОЯНИЕМ и
    пустой клеткой, а не нулём (§19.19 «не показывай 0,0»)."""
    header = "# Оперативный рейтинг: агрегированная сводка"
    if policy is not None:
        header += f", методика {policy['policyVersion']}"
    lines = [
        header,
        ";".join(_csv_field(column) for column in AGGREGATE_EXPORT_COLUMNS),
    ]
    for summary in summaries:
        lines.append(";".join(
            _csv_field(value) for value in [
                summary["safeLabel"],
                (
                    f"{summary['aggregateRating']:.1f}"
                    if summary["aggregateRating"] is not None else ""
                ),
                str(summary["evaluationsCount"]),
                summary["periodStartsAt"] or "",
                summary["periodEndsAt"] or "",
                summary["calculationPolicyVersion"] or "",
                _DATA_STATE_EXPORT_LABEL[summary["dataState"]],
            ]
        ))
    return "\n".join(lines) + "\n"


def _export_file_name(scope, fmt, business_date):
    prefix = (
        "operational-rating-aggregate"
        if scope == "AGGREGATE"
        else "operational-rating"
    )
    return f"{prefix}-{business_date.isoformat()}.{fmt.lower()}"


def _serialize_job(job):
    return {
        "exportJobId": job.export_job_code,
        "scope": job.scope,
        "format": job.format,
        "state": job.state,
        "createdAt": job.requested_at.isoformat(),
        "createdBy": job.requested_by,
        "finishedAt": _iso(job.finished_at),
        "failureCode": job.failure_code,
        "safeFailureMessage": job.safe_failure_message,
        "artifactId": job.artifact_code,
        "idempotencyKey": job.idempotency_key,
    }


def _serialize_artifact_summary(artifact):
    """Артефакт В СПИСКЕ — без содержимого: файл едет только в ответе на
    скачивание (§19.29)."""
    return {
        "artifactId": artifact.artifact_code,
        "exportJobId": artifact.export_job_code,
        "scope": artifact.scope,
        "format": artifact.format,
        "fileName": artifact.file_name,
        "generatedAt": artifact.generated_at.isoformat(),
        "policyVersion": artifact.policy_version,
        "rowCount": artifact.row_count,
    }


def _advance_export(flags, job):
    """§19.29: ступень выполняется на ЧТЕНИИ — фонового исполнителя нет.
    Файл собирается РОВНО на переходе в READY и больше не пересобирается."""
    if job.state in ("READY", "FAILED", "CANCELLED"):
        return
    if job.state == "QUEUED":
        job.state = "GENERATING"
        job.save(update_fields=["state", "updated_at"])
        return
    # Выключенная за время сборки функция — СОСТОЯНИЕ работы, а не
    # исключение наружу: одна неудачная выгрузка не роняет чтение списка.
    if not flags.operational_ratings:
        job.state = "FAILED"
        job.finished_at = Clock.now()
        job.failure_code = "RATING_DISABLED"
        job.safe_failure_message = (
            "Оперативный рейтинг выключен: сводки, по которой собирается "
            "файл, не существует."
        )
        job.save(update_fields=[
            "state", "finished_at", "failure_code", "safe_failure_message",
            "updated_at",
        ])
        return
    policy = read_rating_policy()
    summaries = _all_summaries(flags, policy)
    generated_at = Clock.now()
    artifact = OpsRatingExportArtifact.objects.create(
        artifact_code=f"rating-export-artifact-{job.export_job_code}",
        export_job_code=job.export_job_code,
        scope=job.scope,
        format=job.format,
        file_name=_export_file_name(
            job.scope, job.format, Clock.today_local()
        ),
        generated_at=generated_at,
        # Методика замораживается В ФАЙЛЕ: её могли сменить после выгрузки
        # (§19.20).
        policy_version=(
            policy["policyVersion"] if policy is not None else None
        ),
        row_count=len(summaries),
        content=_aggregate_export_content(summaries, policy),
    )
    job.state = "READY"
    job.finished_at = generated_at
    job.artifact_code = artifact.artifact_code
    job.save(update_fields=[
        "state", "finished_at", "artifact_code", "updated_at",
    ])


def list_rating_exports(actor, perms):
    """Свои работы (§19.29): чужие в ответ не попадают. Продвигаются ВСЕ
    работы — ступень выполняется на чтении, чужая иначе застряла бы."""
    if not has_perm(perms, EXPORT_PERMISSION):
        raise _permission_denied(EXPORT_PERMISSION)
    flags = read_feature_flags()
    with transaction.atomic():
        for job in OpsRatingExportJob.objects.select_for_update():
            _advance_export(flags, job)
    mine = [
        job for job in OpsRatingExportJob.objects.all()
        if job.requested_by == (actor or "")
    ]
    mine_codes = {job.export_job_code for job in mine}
    artifacts = [
        artifact for artifact in OpsRatingExportArtifact.objects.all()
        if artifact.export_job_code in mine_codes
    ]
    return {
        "results": [_serialize_job(job) for job in mine],
        "artifacts": [
            _serialize_artifact_summary(artifact) for artifact in artifacts
        ],
        "formats": RATING_EXPORT_FORMATS,
        "unavailableFormats": UNAVAILABLE_EXPORT_FORMATS,
        "unavailableScopes": UNAVAILABLE_EXPORT_SCOPES,
        "capabilities": {"operationalRatings": flags.operational_ratings},
        "serverTime": Clock.now().isoformat(),
    }


def create_rating_export(actor, perms, body):
    """Заказ выгрузки (§19.29): работа создаётся в QUEUED и никакой ссылки
    на файл не несёт. Audit-запись — в ТОЙ ЖЕ транзакции, что и работа."""
    idempotency_key = str(body.get("idempotencyKey") or "")
    if not has_perm(perms, EXPORT_PERMISSION):
        record_rejection(
            actor=actor, event_code="RATING_EXPORT_REJECTED",
            reason_code="PERMISSION_DENIED", request_id=idempotency_key,
        )
        raise _permission_denied(EXPORT_PERMISSION)
    # Проверка режима и формата — ДО транзакции и независимо от прав:
    # индивидуальная выгрузка не выдаётся никому, включая администратора с
    # wildcard (§19.21 — нет ни scope, ни срока полномочия).
    if body.get("scope") == "INDIVIDUAL":
        record_rejection(
            actor=actor, event_code="RATING_EXPORT_REJECTED",
            reason_code="SENSITIVE_EXPORT_UNAVAILABLE",
            request_id=idempotency_key,
        )
        raise DomainError(
            "SENSITIVE_EXPORT_UNAVAILABLE", 422,
            message="Выгрузка индивидуальных оценок не выдаётся: закрытые "
                    "данные требуют scope и срока полномочия, которых в "
                    "этой сборке нет (§19.21).",
        )
    if body.get("format") not in RATING_EXPORT_FORMATS:
        record_rejection(
            actor=actor, event_code="RATING_EXPORT_REJECTED",
            reason_code="EXPORT_FORMAT_UNAVAILABLE",
            request_id=idempotency_key,
        )
        raise DomainError(
            "EXPORT_FORMAT_UNAVAILABLE", 422,
            message="Формат не собирается в этой сборке: доступен CSV.",
        )
    if body.get("scope") != "AGGREGATE":
        raise DomainError(
            "VALIDATION_ERROR", 400,
            detail={"scope": ["Неизвестный режим выгрузки."]},
            message="Проверьте заполнение формы.",
        )
    with transaction.atomic():
        # §19.26: повтор с тем же ключом возвращает ПРЕЖНЮЮ работу — иначе
        # журнал сообщил бы, что данные покидали систему дважды.
        repeated = OpsRatingExportJob.objects.filter(
            idempotency_key=idempotency_key
        ).first()
        if repeated is not None:
            return {"job": _serialize_job(repeated)}
        job = OpsRatingExportJob.objects.create(
            export_job_code=_tmp_code(),
            scope=body.get("scope"),
            format=body.get("format"),
            state="QUEUED",
            requested_at=Clock.now(),
            requested_by=actor or "",
            finished_at=None,
            failure_code=None,
            safe_failure_message=None,
            artifact_code=None,
            idempotency_key=idempotency_key,
        )
        _stamp_code(job, "export_job_code", "rating-export")
        _audit_entry_row(
            actor=actor, event_code="RATING_EXPORT_REQUESTED",
            outcome="SUCCESS", request_id=idempotency_key,
        )
        return {"job": _serialize_job(job)}


def cancel_rating_export(actor, perms, export_job_code):
    """Отмена (§19.29): только незавершённой работы — CANCELLED на готовом
    файле означало бы, что его не существует."""
    if not has_perm(perms, EXPORT_PERMISSION):
        raise _permission_denied(EXPORT_PERMISSION)
    with transaction.atomic():
        job = (
            OpsRatingExportJob.objects.select_for_update()
            .filter(export_job_code=export_job_code)
            .first()
        )
        # Чужая работа — 404, а не 403: отказ по праву подтвердил бы, что
        # выгрузка существует и кем-то заказана.
        if job is None or job.requested_by != (actor or ""):
            raise _not_found(export_job_code)
        if job.state not in ("QUEUED", "GENERATING"):
            raise DomainError(
                "EXPORT_NOT_CANCELLABLE", 422,
                message="Работа уже завершена: отменять нечего.",
            )
        job.state = "CANCELLED"
        job.finished_at = Clock.now()
        job.save(update_fields=["state", "finished_at", "updated_at"])
        return {"job": _serialize_job(job)}


def download_rating_export(actor, perms, artifact_code):
    """Выдача файла (§19.29): ОТДЕЛЬНАЯ операция, повторно проверяющая
    право, владельца и состояние. Запись в журнал — о ВЫДАЧЕ."""
    if not has_perm(perms, EXPORT_PERMISSION):
        record_rejection(
            actor=actor, event_code="RATING_EXPORT_REJECTED",
            reason_code="PERMISSION_DENIED",
        )
        raise _permission_denied(EXPORT_PERMISSION)
    with transaction.atomic():
        artifact = OpsRatingExportArtifact.objects.filter(
            artifact_code=artifact_code
        ).first()
        job = (
            OpsRatingExportJob.objects.filter(
                export_job_code=artifact.export_job_code
            ).first()
            if artifact is not None
            else None
        )
        if (
            artifact is None
            or job is None
            or job.requested_by != (actor or "")
        ):
            raise _not_found(artifact_code)
        # Состояние работы перепроверяется ЗАНОВО: файл отменённой или
        # упавшей работы выдавать нечем.
        if job.state != "READY":
            raise DomainError(
                "EXPORT_NOT_READY", 422,
                message="Файл не выдан: работа не в состоянии «Готов».",
            )
        _audit_entry_row(
            actor=actor, event_code="RATING_EXPORT_DOWNLOADED",
            outcome="SUCCESS", request_id=job.idempotency_key,
        )
        return {"fileName": artifact.file_name, "content": artifact.content}


# ── Оценивание, заведённое закрытием ОМ ─────────────────────────────────────
#
# Заказчик: «Рейтинг необходимо добавить в систему, оценивание на каждом ОМ»
# (Plane №96). До этого мероприятия оценивания заводил ТОЛЬКО сид: из живого
# реестра ОМ не создавалось ни одного, и рейтинг у настоящих людей взяться не
# мог ниоткуда — даже после того, как участника связали с кадрами.
#
# Момент заведения — ЗАКРЫТИЕ ОМ, а не создание: оценивать нечего, пока люди
# не отработали, и пустое мероприятие оценивания висело бы в очереди оценщика
# с первого дня.


def _participant_code_for(employee_id):
    """Код участника по кадровому id. Форма та же, что разбирает миграция
    0048, — иначе связь пришлось бы описывать в двух местах по-разному."""
    return f"employee-{employee_id}"


@transaction.atomic
def open_evaluation_for_event(event, *, actor):
    """Завести мероприятие оценивания по закрытому ОМ и задания по составу.

    Возвращает `OpsEvaluationEvent` либо `None`, когда оценивать некого.

    Повторный вызов НИЧЕГО не плодит: код мероприятия оценивания выводится из
    кода ОМ, а задания — из пары «мероприятие + участник». Закрытие ОМ бывает
    один раз, но ручку зовут и миграции, и возможный повтор после отката.
    """
    assignments = [
        row for row in (event.placement_assignments or [])
        if str(row.get("employeeId") or "").isdigit()
    ]
    if not assignments:
        # Расстановки нет — оценивать некого. Пустое мероприятие оценивания
        # было бы шумом в очереди: оценщик открыл бы его и закрыл.
        return None

    event_code = f"security-event-{event.pk}"
    starts_at = event.closed_at or Clock.now()
    evaluation_event, _ = OpsEvaluationEvent.objects.update_or_create(
        event_code=event_code,
        defaults={
            "event_run_code": f"{event_code}-run-1",
            "number": event.code,
            "title": event.title,
            "object_label": event.object_name or "",
            "actual_starts_at": starts_at,
            "actual_ends_at": starts_at,
            "state_label": "Завершено",
            "security_event_id": event.pk,
        },
    )

    posts = {str(row.get("id")): row for row in (event.recon_sector_posts or [])}
    for assignment in assignments:
        employee_id = int(assignment["employeeId"])
        code = _participant_code_for(employee_id)
        post = posts.get(str(assignment.get("postId")), {})
        participant, _ = OpsRatedParticipant.objects.update_or_create(
            participant_code=code,
            defaults={
                # Подпись безопасная — идентификатора в ней нет (§19.14).
                "safe_label": assignment.get("employeeName") or code,
                # Группа рейтинга — подразделение человека на момент
                # мероприятия: рейтинг сравнивают внутри группы, и брать
                # сегодняшнее подразделение значило бы менять группу задним
                # числом при каждом переводе.
                "group_code": str(assignment.get("divisionId") or "unknown"),
                "employee_id": employee_id,
            },
        )
        OpsEvaluationWorkItem.objects.update_or_create(
            work_item_code=f"{event_code}-{code}",
            defaults={
                "event_code": event_code,
                "event_run_code": evaluation_event.event_run_code,
                "assignment_code": str(assignment.get("id") or ""),
                # Оценивает ТОТ, КТО ЗАКРЫЛ мероприятие: он его вёл и видел
                # людей на постах. Приписать оценивание старшему объекта
                # нельзя — `chief_employee_id` это КАДРОВАЯ запись, а задание
                # адресуется учётной записи, и однозначного моста между ними
                # в системе нет.
                "evaluator_user_id": str(actor or ""),
                "target_participant_code": participant.participant_code,
                "target_group_code": None,
                "target_safe_label": participant.safe_label,
                "target_safe_unit_label": assignment.get("divisionName") or "",
                "post_label": post.get("post") or post.get("task") or "",
                "actual_starts_at": evaluation_event.actual_starts_at,
                "actual_ends_at": evaluation_event.actual_ends_at,
                "participated": True,
                "evaluation_direction": "SENIOR_TO_EMPLOYEE",
                # Начальное значение даёт СЕРВЕР (§19.8), не оценщик.
                "initial_score": RATING_DEFAULT_SCORE,
                "status": "PENDING",
                "revision": 1,
                "submitted_evaluation_code": None,
                "submitted_at": None,
            },
        )
    return evaluation_event
