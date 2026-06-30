from django.db import models

from apps.operations.models import TimeStampedModel


class DailySubmission(TimeStampedModel):
    """Версионируемое иммутабельное заявление-факт о сдаче дня (ARCH-DATA-021).

    Одна строка — одна версия сдачи подразделения за ``business_date``. БД
    гарантирует НЕ БОЛЕЕ одной текущей версии на (подразделение, день)
    (partial-unique по ``is_current`` — состояние «ноль текущих» на уровне БД
    допустимо) и «версии различны» (unique по ``version``). Инвариант «РОВНО
    одна текущая» — ПРИКЛАДНОЙ: его держит сервис (5.3/5.4), переключая
    ``is_current`` в одной транзакции; БД лишь не даёт двум строкам быть
    текущими одновременно. На этих инвариантах строятся сервис сдачи (5.3),
    amendment-flow (5.4) и derived-расход.

    Иммутабельность (ARCH-DATA-021): после создания ``snapshot`` не
    переписывается — поправка кадров задним числом порождает НОВУЮ версию
    (5.4), а не правит прошлую. Поэтому ФИО/звание в снапшоте денормализованы:
    сдача — это заявление-на-момент-T.

    Форма ``snapshot`` (строит билдер 5.3a `build_division_snapshot`, здесь
    контракт). SELF-CONTAINED: ``roster`` — denominator (КАЖДЫЙ сотрудник
    списочного состава на дату, денорм. ФИО/звание), ``rows`` — действующие
    интервалы-факты статусов. derive(снапшот, дата) считает расход ТОЛЬКО
    отсюда, не перезапрашивая live-данные (фундамент иммутабельности 5.10)::

        {
          "schema_version": <int>,
          "roster": [                          # denominator: ВСЕ люди списка на дату
            {
              "employee_id": <uuid str>,
              "full_name": <str>,            # денормализовано на момент сдачи
              "rank": <str>                  # денормализовано (Rank.name «как было»)
            },
            ...
          ],
          "rows": [                            # действующие интервалы-факты статусов
            {
              "employee_id": <uuid str>,
              "status_type_code": <str>,
              "status_id": <int>,            # pk EmployeeStatus
              "date_start": <"YYYY-MM-DD">,  # полуоткрытый [date_start, date_end)
              "date_end": <"YYYY-MM-DD">,
              "source": <str>               # EmployeeStatus.Source
            },
            ...
          ]
        }

    Это denominator + ИНТЕРВАЛЫ-ФАКТЫ (поля EmployeeStatus), а НЕ derived-
    состояния: state (PLANNED/ACTIVE), расход и светофор выводятся из
    ``snapshot`` + ``business_date`` на чтении (derived-first, ARCH-DATA-022/
    023; сотрудник без факта → «В строю»). Штат/вакансии снапшот НЕ хранит
    (отдельная ось). Сотрудник без статусов остаётся в ``roster`` (denominator),
    но не появляется в ``rows``.
    """

    class Event(models.TextChoices):
        CONFIRMED_NO_CHANGES = "CONFIRMED_NO_CHANGES", "Подтверждено без изменений"
        CHANGED = "CHANGED", "Изменено"
        AMENDED = "AMENDED", "Исправлено"

    # ARCH-003: flat cross-context reference to core_divisions, never an FK.
    division_id = models.UUIDField()
    # ARCH-DATA-023: calendar business day this submission speaks for.
    business_date = models.DateField()
    version = models.PositiveIntegerField(default=1)
    # First version is current by nature; the partial-unique below guarantees
    # at most one current per day, 5.4 flips the flag on amendment (one txn).
    is_current = models.BooleanField(default=True)
    # Required, no default: 5.3 always sets CONFIRMED_NO_CHANGES/CHANGED, 5.4
    # sets AMENDED — событие есть суть строки. AMENDED forward-seeded for 5.4.
    event = models.CharField(max_length=50, choices=Event.choices)
    # ARCH-007: external account id as a flat string, never an FK.
    submitted_by = models.CharField(max_length=100)
    # Append-once: set by the 5.3 service via Clock.now() (mirror of
    # AuditLog.created_at) — это ВРЕМЯ СДАЧИ, не аудит-таймстамп строки. NOT
    # auto_now_add: auto would steal the managed-clock semantics.
    submitted_at = models.DateTimeField()
    late = models.BooleanField(default=False)
    # Denormalised interval-facts; form documented above. Populated by 5.3.
    snapshot = models.JSONField(default=dict)
    # Amendment attributes (5.4a). For event=AMENDED these carry «причина / санкция /
    # ссылка на ретро-правку» (ARCH-DATA-021 L288); required for AMENDED, blank for
    # the 5.3 first-submission events (CheckConstraint below holds the asymmetry).
    # default="" (not null) so 5.3 create() — which never passes them — stays valid.
    reason = models.TextField(blank=True, default="")
    sanction = models.CharField(max_length=255, blank=True, default="")
    # ARCH-003: flat reference to the triggering EmployeeStatus surrogate PK
    # (integer BigAutoField), never an FK. Nullable: a manual amendment need not
    # cite a specific status. 5.4b populates it from the retro-edit hook.
    triggered_by_status_id = models.PositiveBigIntegerField(null=True, blank=True)

    class Meta:
        db_table = "ops_daily_submissions"
        constraints = [
            # ARCH-DATA-021: ровно одна текущая версия на (подразделение, день).
            models.UniqueConstraint(
                fields=["division_id", "business_date"],
                condition=models.Q(is_current=True),
                name="unique_daily_submission_current",
            ),
            # Версии одного дня различны.
            models.UniqueConstraint(
                fields=["division_id", "business_date", "version"],
                name="unique_daily_submission_version",
            ),
            # event без дефолта → `.objects.create()` без него запишет "";
            # CharField.choices не валидируется на пути create(). DB-гард держит
            # словарь событий (зеркало Event.values — drift ловит
            # test_event_check_covers_event_choices).
            models.CheckConstraint(
                condition=models.Q(
                    event__in=["CONFIRMED_NO_CHANGES", "CHANGED", "AMENDED"]
                ),
                name="chk_daily_submission_event",
            ),
            # Версии нумеруются с 1 (auto-CHECK поля — `>= 0`, пропускает 0).
            models.CheckConstraint(
                condition=models.Q(version__gte=1),
                name="chk_daily_submission_version_min",
            ),
            # 5.4a: AMENDED-версия ОБЯЗАНА нести содержательные reason+sanction
            # (видимая поправка, ARCH-DATA-021 L288). Не-AMENDED строки (первичная
            # сдача 5.3) не ограничены. Сервис amend_day отбивает пустые раньше (400)
            # и strip'ит; это DB-backstop против «тихого пустого» прямого create().
            # `__regex=r"\S"` (есть хоть один НЕ-пробельный символ) отвергает И ""
            # И whitespace-only "   " — иначе backstop пропускал бы пробельно-пустую
            # AMENDED-строку (code-review проход 1). Зеркало chk_*_event/version_min.
            models.CheckConstraint(
                condition=(
                    ~models.Q(event="AMENDED")
                    | (models.Q(reason__regex=r"\S") & models.Q(sanction__regex=r"\S"))
                ),
                name="chk_daily_submission_amended_requires_reason_sanction",
            ),
        ]
        indexes = [
            models.Index(
                fields=["division_id", "business_date", "-version"],
                name="idx_daily_submission_lookup",
            ),
        ]
        verbose_name = "Сдача дня"
        verbose_name_plural = "Сдачи дня"

    def __str__(self):
        return f"{self.division_id} {self.business_date} v{self.version}"
