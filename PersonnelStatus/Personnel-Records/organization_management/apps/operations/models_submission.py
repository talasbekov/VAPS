"""Сдача дня раздела ОМ (порт DailySubmission из Backend/VAPS
apps/operations/submissions/models/daily_submission.py).

Строка — это ВЕРСИЯ заявления подразделения о дне: «на такое-то число у меня
вот такой список и вот такие факты». Заявление иммутабельно: поправка задним
числом не переписывает снимок, а рождает НОВУЮ версию (тем и отличается
сдача от таблицы, которую правят). Отсюда денормализованные ФИО и звание в
снимке — сдача говорит о том, как было НА МОМЕНТ сдачи, и позднее
переименование не должно менять сданное.

Снимок САМОДОСТАТОЧЕН: расход и светофор выводятся из него и бизнес-даты, не
перезапрашивая живые данные. Иначе «сданный вчера день» менялся бы каждый раз,
когда кто-то правит статус, — и подпись под ним ничего не значила бы.

Форма snapshot (её строит билдер — отдельный срез; здесь контракт)::

    {
      "schema_version": <int>,
      "roster": [                      # знаменатель: ВЕСЬ список на дату
        {"employee_id": <int>, "full_name": <str>, "rank": <str>},
        ...
      ],
      "rows": [                        # действующие интервалы-ФАКТЫ статусов
        {
          "employee_id": <int>,
          "status_type_code": <str>,
          "status_id": <int>,
          "date_start": "YYYY-MM-DD",  # полуинтервал [начало, конец)
          "date_end": "YYYY-MM-DD",
          "source": <str>
        },
        ...
      ]
    }

Здесь ИНТЕРВАЛЫ, а не выведенные состояния: PLANNED/ACTIVE, колонки расхода и
цвет светофора считаются на чтении из снимка и даты. Сотрудник без единого
факта остаётся в roster (он в строю) и не появляется в rows. Штат и вакансии
снимок не хранит — это другая ось, её знает расход.

Отличия от источника:
- division_id / employee_id / status_id — целые, плоские ссылки на старую
  структуру (в источнике UUID); FK нет намеренно, как и во всём разделе.
- submitted_by — строка (str(User.pk) или системная метка), как актор журнала.
"""
from django.db import models

from organization_management.apps.operations.models import TimeStampedModel


class OpsDailySubmission(TimeStampedModel):
    """Одна версия сдачи подразделения за бизнес-дату.

    На уровне БД гарантируется НЕ БОЛЕЕ одной текущей версии на
    (подразделение, день) и различность номеров версий. Инвариант «РОВНО
    одна текущая» — прикладной: его держит сервис, переключая is_current в
    одной транзакции. База не умеет требовать существования строки, но не
    даёт двум быть текущими одновременно — а это ровно та половина, которая
    ломается от гонки.
    """

    class Event(models.TextChoices):
        CONFIRMED_NO_CHANGES = "CONFIRMED_NO_CHANGES", "Подтверждено без изменений"
        CHANGED = "CHANGED", "Изменено"
        AMENDED = "AMENDED", "Исправлено"

    division_id = models.IntegerField()
    business_date = models.DateField()
    version = models.PositiveIntegerField(default=1)
    # Первая версия текущая по природе; частичное ограничение ниже держит «не
    # более одной», поправка переключает флаг в одной транзакции.
    is_current = models.BooleanField(default=True)
    # БЕЗ дефолта: событие — суть строки, а не её настройка. Молчаливое ""
    # отсекает CHECK ниже (choices на пути create() не проверяются).
    event = models.CharField(max_length=50, choices=Event.choices)
    submitted_by = models.CharField(max_length=100)
    # Время СДАЧИ, а не таймстамп строки: ставится сервисом через часы
    # раздела. auto_now_add украл бы у него управляемые часы, и перенос
    # данных лёг бы временем импорта.
    submitted_at = models.DateTimeField()
    late = models.BooleanField(default=False)
    snapshot = models.JSONField(default=dict)
    # Атрибуты поправки: у AMENDED обязательны (см. CHECK), у первичной сдачи
    # пусты. default="" (не null), чтобы create() без них оставался валиден.
    reason = models.TextField(blank=True, default="")
    sanction = models.CharField(max_length=255, blank=True, default="")
    # Плоская ссылка на статус, вызвавший поправку. Может отсутствовать:
    # ручная поправка не обязана указывать конкретную строку.
    triggered_by_status_id = models.PositiveBigIntegerField(null=True, blank=True)

    class Meta:
        db_table = "ops_daily_submissions"
        constraints = [
            models.UniqueConstraint(
                fields=["division_id", "business_date"],
                condition=models.Q(is_current=True),
                name="unique_ops_submission_current",
            ),
            models.UniqueConstraint(
                fields=["division_id", "business_date", "version"],
                name="unique_ops_submission_version",
            ),
            # Зеркало Event.values; расхождение ловит тест словаря.
            models.CheckConstraint(
                condition=models.Q(
                    event__in=["CONFIRMED_NO_CHANGES", "CHANGED", "AMENDED"]
                ),
                name="chk_ops_submission_event",
            ),
            # Версии нумеруются с 1: авто-CHECK положительного поля пропускает 0.
            models.CheckConstraint(
                condition=models.Q(version__gte=1),
                name="chk_ops_submission_version_min",
            ),
            # Поправка ОБЯЗАНА быть объяснена: причина и санкция содержательны.
            # regex r"\S" (есть непробельный символ) отвергает и "", и "   " —
            # иначе пробельно-пустая поправка проходила бы как объяснённая.
            # Оба поля не-null по объявлению, поэтому NULL-щели у ветки нет.
            models.CheckConstraint(
                condition=(
                    ~models.Q(event="AMENDED")
                    | (models.Q(reason__regex=r"\S") & models.Q(sanction__regex=r"\S"))
                ),
                name="chk_ops_submission_amended_explained",
            ),
        ]
        indexes = [
            # Разрез чтения: «версии подразделения за день, свежие первыми».
            models.Index(
                fields=["division_id", "business_date", "-version"],
                name="idx_ops_submission_lookup",
            ),
        ]
        verbose_name = "Сдача дня"
        verbose_name_plural = "Сдачи дня"

    def __str__(self):
        return f"{self.division_id} {self.business_date} v{self.version}"
