"""Охраняемый объект раздела ОМ — реестр объектов, на которых проводятся
охранные мероприятия и стоят посты постоянного дежурства.

ЭТО НОВАЯ СУЩНОСТЬ, А НЕ ПЕРЕЕЗД. Срезы 153–159 переносили КОНТРАКТ поверх уже
живых таблиц: у divisions, employees, staff_unit донорская форма ложилась на
существующие строки. Здесь ложиться не на что — охраняемого объекта в целевом
бэке нет ни под каким именем, и `object.manage` в списке прав RBAC до сих пор
не имел за собой ни одной таблицы.

ТАБЛИЦА РЯДОМ С ОСТАЛЬНЫМИ ОМ. Как журнал, статусы, уведомления и вложения,
объект кладётся в apps/operations отдельным models_*.py, а его адрес живёт в
приложении-оболочке apps/ops. Отдельное приложение под модель ничего бы не
купило: писатель у таблицы один — раздел ОМ, — и граница между ним и объектом
проходила бы внутри одного среза, зато взвела бы ещё один набор миграций.

СОСТОЯНИЕ ОБЪЕКТА И СОСТОЯНИЕ ПАСПОРТА — РАЗНЫЕ ПОЛЯ, и это не удвоение
одного признака. Объект может быть действующим с красным паспортом (охраняем,
но документ не в порядке) и архивным с зелёным (документ был в порядке на
момент вывода из-под охраны). Свести их в один бейдж значило бы потерять
именно ту пару, ради которой на экране две колонки.

ТРЕТЬЕГО ПРИЗНАКА — АКТУАЛЬНОСТИ ПАСПОРТА — ЗДЕСЬ НЕТ НАМЕРЕННО. Он
ПРОИЗВОДНЫЙ: считается от даты последней публикации версии и настраиваемого
интервала проверки. Хранимый флаг протух бы молча ровно в тот день, когда он и
должен был измениться. Версии паспорта и политика интервала приходят
следующими срезами, до них поле актуальности не существует вовсе.
"""
from django.db import models

from organization_management.apps.operations.models import TimeStampedModel

# Наборы допустимых кодов вынесены из класса: тело вложенного Meta не видит
# имён объемлющего класса, а ограничение обязано перечислять ровно те же коды,
# что и choices — иначе форма и база разошлись бы в том, что считать значением.
_OBJECT_STATES = ("ACTIVE", "ARCHIVED")
_PASSPORT_STATES = ("RED", "YELLOW", "GREEN")


class OpsSecurityObject(TimeStampedModel):
    """Строка реестра охраняемых объектов.

    Вид, регион и адрес — свободные строки, а не ссылки на справочники: у
    целевого бэка справочника видов объектов нет, а завести его заодно значило
    бы решить в этом срезе чужую задачу. Когда справочник появится, строка
    станет кодом — снаружи оба отдают одно и то же.
    """

    class ObjectState(models.TextChoices):
        ACTIVE = "ACTIVE", "Действующий"
        ARCHIVED = "ARCHIVED", "В архиве"

    class PassportState(models.TextChoices):
        RED = "RED", "Не оформлен"
        YELLOW = "YELLOW", "Требует доработки"
        GREEN = "GREEN", "Оформлен"

    name = models.CharField(max_length=255)
    # Код уникален и несущий: по нему идёт порядок реестра и по нему объект
    # опознают в бумаге. Автогенерации, как у divisions.Division, здесь нет
    # намеренно — сгенерированный код в документе означал бы объект, которого
    # никто не заводил.
    code = models.CharField(max_length=50, unique=True)
    # `object_type`, а не `type`: наружу поле уходит под именем контракта, но
    # внутри `type` затенял бы встроенное имя питона.
    object_type = models.CharField(max_length=100)
    region = models.CharField(max_length=255)
    address = models.CharField(max_length=500)
    # Дефолта у состояний НЕТ: «действующий по умолчанию» превратил бы
    # забытое поле в утверждение об объекте. Пусть заводящий скажет прямо.
    object_state = models.CharField(max_length=20, choices=ObjectState.choices)
    passport_state = models.CharField(max_length=10, choices=PassportState.choices)

    class Meta:
        db_table = "ops_security_objects"
        verbose_name = "Охраняемый объект"
        verbose_name_plural = "Охраняемые объекты"
        # Порядок реестра — по коду. Ключ добавлен вторым разрядом: без него
        # пагинация DRF предупреждает о нестабильной выборке, а страницы
        # могут повторять и терять строки.
        ordering = ["code", "id"]
        constraints = [
            # Ограничения держит БАЗА, а не форма: строки пишет код через
            # .create(), то есть мимо full_clean. Поле с choices и без
            # дефолта молча принимает "" — и объект без состояния прошёл бы
            # как значение.
            models.CheckConstraint(
                condition=models.Q(object_state__in=_OBJECT_STATES),
                name="chk_ops_security_object_state",
            ),
            models.CheckConstraint(
                condition=models.Q(passport_state__in=_PASSPORT_STATES),
                name="chk_ops_security_object_passport_state",
            ),
            # `\S` отвергает и "", и строку из одних пробелов. Пустой код —
            # не код: по нему идёт порядок реестра и опознание объекта, а
            # уникальность пустую строку пропускает ровно один раз.
            models.CheckConstraint(
                condition=models.Q(code__regex=r"\S"),
                name="chk_ops_security_object_code",
            ),
            models.CheckConstraint(
                condition=models.Q(name__regex=r"\S"),
                name="chk_ops_security_object_name",
            ),
        ]

    def __str__(self):
        return f"{self.code} — {self.name}"


class OpsObjectSector(TimeStampedModel):
    """Сектор действующей редакции паспорта (черновик).

    Секторы и посты — РЕЛЯЦИОННЫЕ строки, а не JSON: их правит форма паспорта
    построчно, и у каждой строки своя валидация. JSON здесь появляется только
    в снимке опубликованной версии (OpsPassportVersion.sectors_snapshot) — по
    той же причине, по какой снимок сданного дня лежит JSONB: опубликованное
    неизменяемо и живёт вне досягаемости правок черновика.
    """

    security_object = models.ForeignKey(
        OpsSecurityObject, on_delete=models.CASCADE, related_name="sectors"
    )
    name = models.CharField(max_length=255)
    # Порядок задаёт оператор перестановкой строк формы; ключ — тай-брейкер
    # против нестабильной выборки (мерка Meta.ordering реестра объектов).
    position = models.PositiveIntegerField()

    class Meta:
        db_table = "ops_object_sectors"
        verbose_name = "Сектор паспорта объекта"
        verbose_name_plural = "Секторы паспорта объекта"
        ordering = ["position", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(name__regex=r"\S"),
                name="chk_ops_object_sector_name",
            ),
        ]

    def __str__(self):
        return f"{self.security_object_id}#{self.position} {self.name}"


class OpsSecurityPost(TimeStampedModel):
    """Пост постоянного дежурства на секторе черновика паспорта."""

    sector = models.ForeignKey(
        OpsObjectSector, on_delete=models.CASCADE, related_name="posts"
    )
    name = models.CharField(max_length=255)
    task = models.CharField(max_length=1000, blank=True)
    requirements = models.CharField(max_length=1000, blank=True)
    position = models.PositiveIntegerField()

    class Meta:
        db_table = "ops_security_posts"
        verbose_name = "Пост паспорта объекта"
        verbose_name_plural = "Посты паспорта объекта"
        ordering = ["position", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(name__regex=r"\S"),
                name="chk_ops_security_post_name",
            ),
        ]

    def __str__(self):
        return f"{self.sector_id}#{self.position} {self.name}"


class OpsPassportVersion(TimeStampedModel):
    """Опубликованная версия паспорта — неизменяема после публикации.

    ``sectors_snapshot`` — глубокая копия секторов черновика НА МОМЕНТ
    публикации в форме контракта клиента (camelCase, как в снимке сданного
    дня): дальнейшая правка черновика версию не трогает. На одну дату
    ``effective_from`` — не более одной версии (уникальность держит база, а не
    проверка в сервисе: у гонки двух публикаций сервис-проверка зелёная у
    обеих).
    """

    security_object = models.ForeignKey(
        OpsSecurityObject,
        on_delete=models.CASCADE,
        related_name="passport_versions",
    )
    version_number = models.PositiveIntegerField()
    effective_from = models.DateField()
    published_at = models.DateTimeField()
    # Идентичность из контракта запроса (resolve_actor_id), как actor журнала.
    published_by = models.CharField(max_length=255)
    note = models.CharField(max_length=1000, blank=True)
    sectors_snapshot = models.JSONField()

    class Meta:
        db_table = "ops_passport_versions"
        verbose_name = "Версия паспорта объекта"
        verbose_name_plural = "Версии паспорта объекта"
        ordering = ["version_number", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["security_object", "version_number"],
                name="uniq_ops_passport_version_number",
            ),
            models.UniqueConstraint(
                fields=["security_object", "effective_from"],
                name="uniq_ops_passport_version_effective_from",
            ),
            # Числовой пол держит база: version_number == 0 из забытого
            # инкремента прошёл бы PositiveIntegerField (он запрещает лишь
            # отрицательные).
            models.CheckConstraint(
                condition=models.Q(version_number__gte=1),
                name="chk_ops_passport_version_number_floor",
            ),
        ]

    def __str__(self):
        return f"{self.security_object_id} v{self.version_number}"


class OpsPassportFreshnessPolicy(TimeStampedModel):
    """Действующая политика актуальности паспорта (§21.7).

    Хранимая строка-синглтон, а не константа в коде: каждый посчитанный
    результат несёт версию политики, по которой посчитан, и правка интервала
    обязана менять версию. Дефолты сида повторяют настройки раздела:
    интервал 120 дней, порог «скоро» 25% интервала.
    """

    singleton_key = models.PositiveSmallIntegerField(default=1, unique=True)
    version = models.CharField(max_length=50)
    verification_interval_days = models.PositiveIntegerField()
    due_soon_percent = models.PositiveIntegerField()

    class Meta:
        db_table = "ops_passport_freshness_policy"
        verbose_name = "Политика актуальности паспорта"
        verbose_name_plural = "Политика актуальности паспорта"
        constraints = [
            # Пол и потолок держит база (мерка version_number выше): нулевой
            # интервал делал бы каждый паспорт просроченным в день публикации,
            # а порог за пределами доли — не доля.
            models.CheckConstraint(
                condition=models.Q(verification_interval_days__gte=1),
                name="chk_ops_freshness_interval_floor",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    due_soon_percent__gte=0, due_soon_percent__lte=100
                ),
                name="chk_ops_freshness_percent_range",
            ),
            models.CheckConstraint(
                condition=models.Q(version__regex=r"\S"),
                name="chk_ops_freshness_policy_version",
            ),
        ]

    def __str__(self):
        return f"policy {self.version}"
