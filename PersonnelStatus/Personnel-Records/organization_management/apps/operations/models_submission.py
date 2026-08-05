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
from datetime import time

from django.contrib.postgres.fields import ArrayField
from django.core.exceptions import ValidationError
from django.db import models

from organization_management.apps.operations.models import TimeStampedModel

# Контрольный час по умолчанию. Живёт здесь, рядом со справочником, который
# его хранит: у настройки один дефолт, и второе его определение (например, в
# сервисе сдачи) разошлось бы с этим при первой же правке.
DEFAULT_CONTROL_HOUR = time(17, 0)


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


class OpsSubmissionControlSettings(TimeStampedModel):
    """Справочник контроля сдачи — ОДНА строка на весь раздел.

    До этого среза контрольный час жил константой в сервисе сдачи, и
    «перенести дедлайн на час» означало выкатку кода. Здесь он становится
    настройкой: строка одна, правится админом справочников, и её правка
    немедленно меняет отметку опоздания у новых сдач (сданное задним числом не
    переписывается — `late` уже записан в строке сдачи).

    СИНГЛТОН ДЕРЖИТ БАЗА, а не соглашение: `singleton_key` уникален И
    прибит CHECK'ом к единице, поэтому строк физически не может стать две.
    Одной уникальности мало — она разрешила бы «по строке на ключ», то есть
    сколько угодно наборов настроек, и раздел молча читал бы первый попавшийся.

    Отличия от источника:
    - `required_division_ids` — массив ЦЕЛЫХ (старое дерево int-pk), не UUID;
      FK нет, как и во всём разделе.
    """

    # Ключ синглтона: не «идентификатор настроек», а замок на их количество.
    singleton_key = models.PositiveSmallIntegerField(
        default=1, unique=True, editable=False
    )
    # Порог по ЛОКАЛЬНОМУ времени раздела. Это настройка, а не показание
    # часов: сервис сравнивает с ней момент сдачи (Clock), а не наоборот.
    control_hour = models.TimeField(default=DEFAULT_CONTROL_HOUR)
    # «Необходимые управления»: плоские id подразделений старого дерева.
    # Пустой список — законное состояние «никто не обязан», а не «настройки
    # не заполнены»: блокировка завтрашнего дня из пустого списка не выводится.
    required_division_ids = ArrayField(
        models.IntegerField(), default=list, blank=True
    )
    # Общий «дежурный»: кому уходит уведомление об отставании подразделения,
    # за которым не закреплён свой получатель. Плоский идентификатор актора,
    # как и всюду в разделе. Пусто — законное состояние «дежурного нет»: такое
    # подразделение просто не разрешается в получателя, и рассылка его
    # пропускает, а не шлёт в пустоту.
    default_notify_recipient = models.CharField(max_length=100, blank=True, default="")

    class Meta:
        db_table = "ops_submission_control_settings"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(singleton_key=1),
                name="chk_ops_control_settings_singleton",
            ),
            # «Дежурного нет» обязано означать ПУСТО, а не «   »: пробельная
            # строка истинна, и разрешение по ней увело бы уведомления всех
            # незакреплённых подразделений на несуществующего получателя —
            # молча и с виду успешно. Пустая строка (дефолт) законна,
            # отвергается только непустая целиком из пробелов.
            models.CheckConstraint(
                condition=~models.Q(default_notify_recipient__regex=r"^\s+$"),
                name="chk_ops_control_settings_duty_not_blank",
            ),
        ]
        verbose_name = "Настройки контроля сдачи"
        verbose_name_plural = "Настройки контроля сдачи"

    def __str__(self):
        return f"control_hour={self.control_hour}"


class OpsDivisionNotifyRecipient(TimeStampedModel):
    """Кому уходит уведомление об отставании ЭТОГО подразделения.

    Уведомление раздела (предыдущий срез) адресуется строкой — и до сих пор
    эту строку было неоткуда взять: модель знала КОМУ, но не знала, кто «кому»
    для отставшего подразделения. Здесь закрывается ровно этот разрыв, и
    закрывается СПРАВОЧНИКОМ: ответственный за сдачу — не свойство дерева
    подразделений (у одного начальника может быть несколько управлений, и
    смена дежурства не переставляет узлы), а настройка, которую заводят руками.

    Уровень строки — подразделение, и получатель у него ОДИН (`unique`). Двое
    ответственных означали бы два уведомления на один факт, а «одно на день»
    держится по получателю — то есть обещание не рассылать дубликатов
    выполнялось бы для каждого из них по отдельности и нарушалось бы для
    факта. Нужен второй адресат — это подписка, другая таблица и другой срез.

    Незакреплённое подразделение падает на общего дежурного из настроек
    контроля сдачи; нет и его — подразделение не разрешается вовсе, и
    рассылка его пропускает.

    Непустоту получателя держит БД (regex по непробельному символу): `.create()`
    и `bulk_create()` не зовут `full_clean`, и инвариант, живущий только в
    коде, обходит любой перенос данных. `clean()` рядом — не дубль, а вежливость
    формы: он ОБРЕЗАЕТ края (то же обрезание потом делает и разрешение) и
    отвечает администратору внятной ошибкой вместо 500-й от базы.

    Отличия от источника: `division_id` — целое (старое дерево int-pk), не UUID;
    FK нет, как и во всём разделе.
    """

    # Плоская ссылка на подразделение старого дерева. Один получатель на
    # подразделение — см. докстринг.
    division_id = models.IntegerField(unique=True)
    # Плоский идентификатор актора-получателя; непустой (см. CHECK ниже).
    recipient = models.CharField(max_length=100)

    class Meta:
        db_table = "ops_division_notify_recipients"
        constraints = [
            # ~Q(regex=r"^\s*$") отвергает и "", и «   »: закрепление за
            # пустым получателем — это не «дежурного нет» (для этого просто не
            # заводят строку), а строка, которая ОБЕЩАЕТ адресата и не даёт его.
            models.CheckConstraint(
                condition=~models.Q(recipient__regex=r"^\s*$"),
                name="chk_ops_notify_recipient_not_blank",
            ),
        ]
        verbose_name = "Получатель уведомлений подразделения"
        verbose_name_plural = "Получатели уведомлений подразделений"

    def clean(self):
        super().clean()
        stripped = (self.recipient or "").strip()
        if not stripped:
            raise ValidationError({"recipient": "Получатель не может быть пустым."})
        self.recipient = stripped

    def __str__(self):
        return f"{self.division_id} → {self.recipient}"


class OpsTomorrowBlockOverride(TimeStampedModel):
    """Законный обход блокировки завтрашнего дня — одна строка на дату.

    Блокировка (вывод предыдущего среза) закрывает завтрашний расход, пока
    хоть одно «необходимое управление» не сдало день. Обход разрешает
    сформировать расход всё равно — но не молча: строка НЕСЁТ ОТВЕТСТВЕННОГО
    (`overridden_by`), время (`created_at`) и причину (`reason`). Обход без
    следа был бы неотличим от выключенной блокировки.

    ПОДАТНЫЙ УРОВЕНЬ — ДАТА, а не подразделение: блокировка общая (закрывает
    любой отстающий), поэтому и снимается она целиком. Обход «на одно
    управление» обещал бы избирательность, которой в выводе нет.

    Непустоту причины и ответственного держит БД (regex по непробельному
    символу), а не только гард сервиса: `.create()` не зовёт full_clean, и
    инвариант, живущий лишь в коде, обходится любым переносом данных.

    Отличия от источника:
    - актор и ссылки плоские (как во всём разделе), FK нет;
    - отзыва обхода нет ни там, ни здесь: строка неотзывна, и защита от
      опечатки в далёкой дате — на слое маршрута (верхний горизонт).
    """

    business_date = models.DateField(unique=True)
    reason = models.TextField()
    overridden_by = models.CharField(max_length=100)

    class Meta:
        db_table = "ops_tomorrow_block_overrides"
        constraints = [
            # ~Q(regex=r"^\s*$") отвергает и "", и «   »: обход, объяснённый
            # пробелами, был бы объяснён ничем.
            models.CheckConstraint(
                condition=~models.Q(reason__regex=r"^\s*$"),
                name="chk_ops_tomorrow_override_reason",
            ),
            models.CheckConstraint(
                condition=~models.Q(overridden_by__regex=r"^\s*$"),
                name="chk_ops_tomorrow_override_actor",
            ),
        ]
        verbose_name = "Обход блокировки на завтра"
        verbose_name_plural = "Обходы блокировки на завтра"

    def __str__(self):
        return f"обход {self.business_date} — {self.overridden_by}"
