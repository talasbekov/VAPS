"""Оперативный рейтинг (§19, §22.16-22.17) — порт мок-контракта клиента.

Идентичность строк — строковые коды (`evaluation-5`, `work-item-1`): контракт
клиента оперирует ими, а не целыми PK, и сервер обязан выдавать устойчивые
идентификаторы того же вида (§19.7 «не генерируй evaluation ID на клиенте»).

Закрытые данные (score, комментарий, оценщик отдельной записи) живут ТОЛЬКО
здесь и наружу не сериализуются нигде, кроме собственной записи автора
(§19.21 «закрытость обеспечивается API»). Проекции собираются полем за полем
в apps/ops/ratings.py.

Исправление НЕ переписывает исходную оценку: создаётся замещающая запись,
исходная помечается ссылкой `superseded_by_code`, связь и причина — отдельной
строкой OpsEvaluationCorrection (§19.18).

Точки динамики — ЗАПИСАННЫЕ агрегаты закрытых периодов со СВОЕЙ версией
методики, не производное от оценок: пересчёт закрытого периода запрещён
(§19.20).
"""
from django.db import models

from organization_management.apps.operations.models import TimeStampedModel

_DIRECTIONS = ("SENIOR_TO_EMPLOYEE", "SENIOR_TO_GROUP", "EMPLOYEE_TO_SENIOR")
_METHODS = ("MANUAL", "SYSTEM_DEFAULT")
_WORK_ITEM_STATUSES = ("PENDING", "SUBMITTED")
_AUDIT_OUTCOMES = ("SUCCESS", "REJECTED")
# Виды записей журнала оценивания — ЗАКРЫТЫЙ перечень, зеркало клиентского
# `RatingAuditEventCode` (`entities/operational-rating/index.ts`). До №187
# колонка была свободной строкой, хотя экран журнала рисует подпись из
# фиксированного словаря по коду: любое значение мимо этих девяти доезжало до
# клиента и выводилось как `undefined`. Перечень держится с двух концов —
# сервер отказывает CHECK-ом, клиент не знает других значений.
_AUDIT_EVENT_CODES = (
    "EVALUATION_SUBMITTED",
    "EVALUATION_SCORE_CHANGED_FROM_INITIAL",
    "EVALUATION_LOW_SCORE_WITHOUT_COMMENT",
    "EVALUATION_CORRECTED",
    "EVALUATION_CORRECTION_REJECTED",
    "EVALUATION_ACCESS_DENIED",
    "RATING_EXPORT_REQUESTED",
    "RATING_EXPORT_DOWNLOADED",
    "RATING_EXPORT_REJECTED",
)
_EXPORT_STATES = ("QUEUED", "GENERATING", "READY", "FAILED", "CANCELLED")
_EXPORT_SCOPES = ("AGGREGATE", "INDIVIDUAL")
_DATA_STATES = (
    "READY", "INSUFFICIENT_DATA", "POLICY_UNDEFINED", "FEATURE_DISABLED",
)


class OpsRatingGroup(TimeStampedModel):
    """Группа участников (§22.16) — безопасная подпись подразделения."""

    group_code = models.CharField(max_length=100, unique=True)
    safe_label = models.CharField(max_length=255)

    class Meta:
        db_table = "ops_rating_groups"
        verbose_name = "Группа рейтинга"
        verbose_name_plural = "Группы рейтинга"
        ordering = ["safe_label", "id"]

    def __str__(self):
        return self.group_code


class OpsRatedParticipant(TimeStampedModel):
    """Оцениваемый участник. Подпись безопасная — идентификатора в ней нет."""

    participant_code = models.CharField(max_length=100, unique=True)
    safe_label = models.CharField(max_length=255)
    group_code = models.CharField(max_length=100)
    #: Кадровая запись участника (Plane №96). Плоская ссылка без FK — идиома
    #: раздела (`chief_employee_id` у ОМ, `employee_id` у временных дежурств):
    #: каскад кадровой таблицы не должен доставать до оценок, а оценка
    #: пережившего увольнение участника — факт истории, а не мусор.
    #:
    #: `NULL` значит «связь неизвестна», и это ЧЕСТНЫЙ ответ: у сеяных
    #: исторических участников кадровой записи нет вовсе. Выдумывать её нельзя
    #: — рейтинг привязался бы к чужому человеку.
    employee_id = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        db_table = "ops_rated_participants"
        verbose_name = "Участник рейтинга"
        verbose_name_plural = "Участники рейтинга"
        ordering = ["safe_label", "id"]
        indexes = [
            models.Index(
                fields=["employee_id"], name="idx_ops_rated_participant_emp"
            ),
        ]

    def __str__(self):
        return self.participant_code


class OpsEvaluationEvent(TimeStampedModel):
    """Мероприятие оценивания (§19.14 шапка).

    `security_event_id` — необязательная привязка к живому реестру ОМ: замок
    закрытого мероприятия (§19.23) применим только к тому, что в реестре
    существует; исторические мероприятия сида живут без карточки ОМ.
    """

    event_code = models.CharField(max_length=100, unique=True)
    event_run_code = models.CharField(max_length=100)
    number = models.CharField(max_length=50)
    title = models.CharField(max_length=255)
    object_label = models.CharField(max_length=255)
    actual_starts_at = models.DateTimeField()
    actual_ends_at = models.DateTimeField()
    state_label = models.CharField(max_length=100)
    security_event_id = models.IntegerField(null=True)

    class Meta:
        db_table = "ops_evaluation_events"
        verbose_name = "Мероприятие оценивания"
        verbose_name_plural = "Мероприятия оценивания"
        ordering = ["actual_starts_at", "id"]

    def __str__(self):
        return self.event_code


class OpsEventEvaluation(TimeStampedModel):
    """Закрытая запись оценки (§19.21). Наружу не сериализуется целиком.

    `evaluator_user_id` NULL — системная оценка по умолчанию (§19.8): у неё
    оценщика нет, приписать её человеку значило бы сказать, что он смотрел
    участника. `superseded_by_code` — ссылка на замещающую запись (§19.18).
    """

    evaluation_code = models.CharField(max_length=100, unique=True)
    event_code = models.CharField(max_length=100)
    participant_code = models.CharField(max_length=100)
    evaluator_user_id = models.CharField(max_length=255, null=True)
    score = models.IntegerField()
    comment = models.TextField(null=True)
    evaluation_direction = models.CharField(max_length=30)
    method = models.CharField(max_length=20)
    basis_code = models.CharField(max_length=100, null=True)
    basis_note = models.TextField(null=True)
    evaluated_at = models.DateField()
    superseded_by_code = models.CharField(max_length=100, null=True)

    class Meta:
        db_table = "ops_event_evaluations"
        verbose_name = "Оценка мероприятия"
        verbose_name_plural = "Оценки мероприятий"
        ordering = ["evaluated_at", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(score__gte=1, score__lte=10),
                name="chk_ops_evaluation_score_scale",
            ),
            models.CheckConstraint(
                condition=models.Q(evaluation_direction__in=_DIRECTIONS),
                name="chk_ops_evaluation_direction",
            ),
            models.CheckConstraint(
                condition=models.Q(method__in=_METHODS),
                name="chk_ops_evaluation_method",
            ),
        ]

    def __str__(self):
        return self.evaluation_code


class OpsEvaluationWorkItem(TimeStampedModel):
    """Задание на оценивание (§19.7) — repository-backed, переживает refresh.

    Оценщик, target, мероприятие и направление — свойства ЗАДАНИЯ; тело
    запроса на отправку их не несёт и подменить не может (§19.7, §19.18).
    """

    work_item_code = models.CharField(max_length=100, unique=True)
    event_code = models.CharField(max_length=100)
    event_run_code = models.CharField(max_length=100)
    assignment_code = models.CharField(max_length=100)
    evaluator_user_id = models.CharField(max_length=255)
    target_participant_code = models.CharField(max_length=100, null=True)
    target_group_code = models.CharField(max_length=100, null=True)
    target_safe_label = models.CharField(max_length=255)
    target_safe_unit_label = models.CharField(max_length=255)
    post_label = models.CharField(max_length=255)
    actual_starts_at = models.DateTimeField()
    actual_ends_at = models.DateTimeField()
    participated = models.BooleanField()
    evaluation_direction = models.CharField(max_length=30)
    initial_score = models.IntegerField()
    status = models.CharField(max_length=20)
    revision = models.IntegerField()
    submitted_evaluation_code = models.CharField(max_length=100, null=True)
    submitted_at = models.DateTimeField(null=True)

    class Meta:
        db_table = "ops_evaluation_work_items"
        verbose_name = "Задание на оценивание"
        verbose_name_plural = "Задания на оценивание"
        ordering = ["target_safe_label", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(status__in=_WORK_ITEM_STATUSES),
                name="chk_ops_work_item_status",
            ),
            models.CheckConstraint(
                condition=models.Q(evaluation_direction__in=_DIRECTIONS),
                name="chk_ops_work_item_direction",
            ),
            models.CheckConstraint(
                condition=models.Q(revision__gte=1),
                name="chk_ops_work_item_revision_floor",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    initial_score__gte=1, initial_score__lte=10
                ),
                name="chk_ops_work_item_initial_score",
            ),
        ]

    def __str__(self):
        return self.work_item_code


class OpsEvaluationCorrection(TimeStampedModel):
    """Исправление (§19.18): отдельная запись «что чем замещено и почему»."""

    correction_code = models.CharField(max_length=100, unique=True)
    original_evaluation_code = models.CharField(max_length=100)
    replacement_evaluation_code = models.CharField(max_length=100)
    reason = models.TextField()
    corrected_by = models.CharField(max_length=255)
    corrected_at = models.DateTimeField()
    revision = models.IntegerField()

    class Meta:
        db_table = "ops_evaluation_corrections"
        verbose_name = "Исправление оценки"
        verbose_name_plural = "Исправления оценок"
        ordering = ["corrected_at", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(reason__regex=r"\S"),
                name="chk_ops_correction_reason",
            ),
        ]

    def __str__(self):
        return self.correction_code


class OpsRatingIdempotencyRecord(TimeStampedModel):
    """§19.26: выполненная операция по ключу. Хранится РЕЗУЛЬТАТ
    (идентификаторы, не значения: снимок ответа нёс бы закрытый комментарий)."""

    key = models.CharField(max_length=255)
    operation = models.CharField(max_length=20)
    work_item_code = models.CharField(max_length=100)
    evaluation_code = models.CharField(max_length=100)

    class Meta:
        db_table = "ops_rating_idempotency"
        verbose_name = "Идемпотентность рейтинга"
        verbose_name_plural = "Идемпотентность рейтинга"
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["key", "operation"],
                name="uniq_ops_rating_idem_key_op",
            ),
        ]

    def __str__(self):
        return f"{self.operation}:{self.key}"


class OpsRatingAuditEntry(TimeStampedModel):
    """Журнал оценивания (§19.27) — СВОЙ, не общий журнал раздела: общий
    экран аудита читают люди без права на рейтинг.

    Запись по построению не несёт значения оценки и комментария: таких полей
    в модели нет.

    ⚠️ `event_code` ЗДЕСЬ — НЕ КОД МЕРОПРИЯТИЯ. Это вид записи журнала
    (`EVALUATION_SUBMITTED`, `RATING_EXPORT_REQUESTED`, …); код охранного
    мероприятия лежит рядом, в `security_event_code`. Имя унаследовано от
    клиентского контракта, где `eventCode` означает «событие журнала», и
    менять его нельзя — оно уезжает наружу как `eventCode` и типизировано на
    клиенте.

    Ловушка настоящая, а не гипотетическая: у соседних моделей раздела
    (`OpsEventEvaluation`, `OpsEvaluationWorkItem`, `OpsEvaluationEvent`) поле
    с ТЕМ ЖЕ именем означает третье — код кампании оценивания (`event-1`).
    27.08.2026 на этом чуть не потеряли журнал: при очистке мероприятий
    (Plane №186) 33 строки отсюда были посчитаны привязанными к ОМ по имени
    колонки, и удаление по ней снесло бы журнал целиком. Спас сухой прогон.
    Отсюда CHECK ниже: код мероприятия вида `ОМ-2026-1` в эту колонку теперь
    физически не ложится.
    """

    entry_code = models.CharField(max_length=100, unique=True)
    occurred_at = models.DateTimeField()
    actor_user_id = models.CharField(max_length=255, null=True)
    # Вид записи журнала, не мероприятие — см. докстринг выше.
    event_code = models.CharField(max_length=100)
    outcome = models.CharField(max_length=20)
    reason_code = models.CharField(max_length=100, null=True)
    security_event_code = models.CharField(max_length=100, null=True)
    event_run_code = models.CharField(max_length=100, null=True)
    assignment_code = models.CharField(max_length=100, null=True)
    evaluation_code = models.CharField(max_length=100, null=True)
    correction_code = models.CharField(max_length=100, null=True)
    request_id = models.CharField(max_length=255, null=True)
    revision = models.IntegerField(null=True)

    class Meta:
        db_table = "ops_rating_audit_entries"
        verbose_name = "Журнал оценивания"
        verbose_name_plural = "Журнал оценивания"
        ordering = ["-occurred_at", "-id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(outcome__in=_AUDIT_OUTCOMES),
                name="chk_ops_rating_audit_outcome",
            ),
            models.CheckConstraint(
                condition=models.Q(event_code__in=_AUDIT_EVENT_CODES),
                name="chk_ops_rating_audit_event_code",
            ),
        ]

    def __str__(self):
        return self.entry_code


class OpsRatingNotification(TimeStampedModel):
    """Уведомление раздела (§19.28). Текст НЕ хранится — только код: готовая
    строка однажды была бы собрана из закрытых полей и не замечена."""

    notification_code = models.CharField(max_length=100, unique=True)
    notified_at = models.DateTimeField()
    recipient_user_id = models.CharField(max_length=255)
    code = models.CharField(max_length=100)
    deep_link = models.CharField(max_length=500)
    security_event_code = models.CharField(max_length=100, null=True)

    class Meta:
        db_table = "ops_rating_notifications"
        verbose_name = "Уведомление рейтинга"
        verbose_name_plural = "Уведомления рейтинга"
        ordering = ["-notified_at", "-id"]

    def __str__(self):
        return self.notification_code


class OpsRatingExportJob(TimeStampedModel):
    """Работа экспорта (§19.29). Ссылки на файл не несёт: файл выдаётся
    отдельной операцией с повторной проверкой права и состояния."""

    export_job_code = models.CharField(max_length=100, unique=True)
    scope = models.CharField(max_length=20)
    format = models.CharField(max_length=10)
    state = models.CharField(max_length=20)
    requested_at = models.DateTimeField()
    requested_by = models.CharField(max_length=255)
    finished_at = models.DateTimeField(null=True)
    failure_code = models.CharField(max_length=100, null=True)
    safe_failure_message = models.TextField(null=True)
    artifact_code = models.CharField(max_length=100, null=True)
    idempotency_key = models.CharField(max_length=255, unique=True)

    class Meta:
        db_table = "ops_rating_export_jobs"
        verbose_name = "Выгрузка рейтинга"
        verbose_name_plural = "Выгрузки рейтинга"
        ordering = ["-requested_at", "-id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(state__in=_EXPORT_STATES),
                name="chk_ops_rating_export_state",
            ),
            models.CheckConstraint(
                condition=models.Q(scope__in=_EXPORT_SCOPES),
                name="chk_ops_rating_export_scope",
            ),
        ]

    def __str__(self):
        return self.export_job_code


class OpsRatingExportArtifact(TimeStampedModel):
    """Файл выгрузки. Собирается РОВНО на переходе работы в READY и больше
    не пересобирается; методика заморожена В ФАЙЛЕ (§19.20)."""

    artifact_code = models.CharField(max_length=100, unique=True)
    export_job_code = models.CharField(max_length=100)
    scope = models.CharField(max_length=20)
    format = models.CharField(max_length=10)
    file_name = models.CharField(max_length=255)
    generated_at = models.DateTimeField()
    policy_version = models.CharField(max_length=100, null=True)
    row_count = models.IntegerField()
    content = models.TextField()

    class Meta:
        db_table = "ops_rating_export_artifacts"
        verbose_name = "Файл выгрузки рейтинга"
        verbose_name_plural = "Файлы выгрузок рейтинга"
        ordering = ["-generated_at", "-id"]

    def __str__(self):
        return self.artifact_code


class OpsRatingDynamicsPoint(TimeStampedModel):
    """Точка динамики (§19.20): ЗАПИСАННЫЙ агрегат закрытого периода со своей
    версией методики. NULL-агрегат — «за период агрегата нет», не ноль."""

    participant_code = models.CharField(max_length=100)
    period = models.CharField(max_length=10)
    period_starts_at = models.DateField()
    period_ends_at = models.DateField()
    aggregate_rating = models.FloatField(null=True)
    evaluations_count = models.IntegerField()
    policy_version = models.CharField(max_length=100)
    data_state = models.CharField(max_length=30)
    recorded_at = models.DateTimeField()

    class Meta:
        db_table = "ops_rating_dynamics_points"
        verbose_name = "Точка динамики рейтинга"
        verbose_name_plural = "Точки динамики рейтинга"
        ordering = ["participant_code", "period_starts_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["participant_code", "period"],
                name="uniq_ops_dynamics_participant_period",
            ),
            models.CheckConstraint(
                condition=models.Q(data_state__in=_DATA_STATES),
                name="chk_ops_dynamics_data_state",
            ),
        ]

    def __str__(self):
        return f"{self.participant_code}:{self.period}"


class OpsRatingFeatureFlags(TimeStampedModel):
    """§19.3: независимые флаги функции. Лежат В ДАННЫХ, а не в сборке:
    выключенная функция обязана давать честное состояние недоступности."""

    singleton_key = models.PositiveSmallIntegerField(primary_key=True)
    operational_ratings = models.BooleanField()
    rating_conflicts = models.BooleanField()

    class Meta:
        db_table = "ops_rating_feature_flags"
        verbose_name = "Флаги рейтинга"
        verbose_name_plural = "Флаги рейтинга"

    def __str__(self):
        return f"flags:{self.singleton_key}"
