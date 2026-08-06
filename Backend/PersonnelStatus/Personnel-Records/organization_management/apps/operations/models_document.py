"""Вложение раздела ОМ — запись о файле в приватном хранилище (порт Attachment
из Backend/VAPS apps/documents/models.py).

ТАБЛИЦА РЯДОМ, как и с журналом, статусами и уведомлениями: у источника она
зовётся `documents_attachments` и живёт отдельным приложением, а раздел кладёт
её к своим. Отдельное приложение здесь ничего не купило бы — писатель у таблицы
один (выпуск расхода), и граница между ним и вложением проходила бы внутри
одного среза.

СВЯЗЬ ВСЕГДА «ВЛАДЕЛЕЦ → ВЛОЖЕНИЕ», и правило источника сохранено дословно: у
вложения нет полей владельца, ссылается на него владелец. Полиморфная ссылка
(GenericForeignKey/ContentType) запрещена — она сделала бы вложение зависимым
от того, кто на него ссылается, и любой пересчёт владельцев переписывал бы
чужую таблицу.

ОТЛИЧИЕ ОТ ИСТОЧНИКА — ИМЯ ФАЙЛА ОТДЕЛЕНО ОТ КЛЮЧА СТРОКИ. Там первичный ключ
UUID и он же имя файла на диске. Здесь ключ целый, как у всего переехавшего, а
имя файла несёт своё поле storage_key. Это не вкус: байты обязаны лечь на диск
ДО создания строки (иначе строка со ссылкой на ещё не существующий файл живёт
между двумя операциями), а целый ключ выдаёт БАЗА на вставке — знать имя заранее
с ним нельзя. Отдельный ключ снимает вопрос и попутно оставляет имя на диске
неугадываемым, хотя в адресе маршрута стоит целое.
"""
import uuid

from django.db import models

from organization_management.apps.operations.models import TimeStampedModel


class OpsAttachment(TimeStampedModel):
    """Один файл: метаданные строкой, байты — плоско в приватном каталоге.

    Метаданные здесь — ЕДИНСТВЕННЫЙ источник заголовков отдачи (имя, тип,
    размер) и предмет сверки перед выдачей (sha256). Читать их с диска на
    каждой выдаче нельзя: там лежат голые байты под неговорящим именем, и
    подмена файла не была бы отличима от нормы.
    """

    # Имя файла на диске. default=uuid4 вычисляется в питоне ДО вставки —
    # именно поэтому запись байт может идти первой (см. докстринг модуля).
    storage_key = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    # Большое целое: вопрос «а если файл больше двух гигабайт» закрывается
    # один раз здесь, а не миграцией в тот день, когда он появится.
    size = models.BigIntegerField()
    sha256 = models.CharField(max_length=64)

    class Meta:
        db_table = "ops_attachments"
        verbose_name = "Вложение раздела"
        verbose_name_plural = "Вложения раздела"
        constraints = [
            # Ограничения держит БАЗА, а не форма: строки пишет сервис через
            # .create(), то есть мимо full_clean. Поле без дефолта молча
            # принимает "" — и пустой дайджест прошёл бы как значение.
            models.CheckConstraint(
                condition=models.Q(sha256__regex=r"^[0-9a-f]{64}$"),
                name="chk_ops_attachment_sha256",
            ),
            # Ноль байт — это не файл, а следствие оборванной записи: сверка
            # такого «файла» сойдётся с его же пустым дайджестом и промолчит.
            models.CheckConstraint(
                condition=models.Q(size__gte=1),
                name="chk_ops_attachment_size_min",
            ),
            # `\S` отвергает и "", и строку из одних пробелов: имя уходит в
            # заголовок отдачи, и пустое там означало бы файл без имени.
            models.CheckConstraint(
                condition=models.Q(original_name__regex=r"\S"),
                name="chk_ops_attachment_name",
            ),
            models.CheckConstraint(
                condition=models.Q(content_type__regex=r"\S"),
                name="chk_ops_attachment_content_type",
            ),
        ]
        indexes = [
            # Разрез «найти по содержимому»: сверка байт-в-байт и будущее
            # схлопывание одинаковых файлов ведут по дайджесту, не по ключу.
            models.Index(fields=["sha256"], name="idx_ops_attachment_sha256"),
        ]

    def __str__(self):
        return f"{self.original_name} ({self.storage_key})"


class OpsDocumentSequence(models.Model):
    """Счётчик номеров документов по паре (вид, год) — порт DocumentSequence.

    Служебная строка: наружу не отдаётся, в Admin не регистрируется, событий
    журнала не имеет. Её единственный читатель и писатель — выдача номера, и
    номер выдаётся ТОЛЬКО внутри транзакции того, кто выпускает документ.

    ПОЧЕМУ НЕ ПОСЛЕДОВАТЕЛЬНОСТЬ БАЗЫ (SEQUENCE, IDENTITY, AutoField). Она не
    транзакционна: взятый nextval() при откате НЕ возвращается, и каждый
    несостоявшийся выпуск съедал бы номер. Для внутреннего ключа это норма — на
    то он и суррогатный, — но здесь номер уходит в исходящий документ и в
    переписку. Пропуск в исходящих номерах означает утрату документа, и
    объясняться придётся не тому, кто выбирал тип колонки. Обычное целое под
    построчным замком откатывается вместе с транзакцией: следующий выпуск
    возьмёт тот же номер, дырки не будет.

    ГОД — ЧАСТЬ КЛЮЧА, а не поле строки: нумерация исходящих начинается заново
    каждый год, и новый год это просто новая строка счётчика, стартующая с
    нуля. Уникальность пары несущая — на неё опирается заведение новой строки в
    гонке двух первых за год выпусков.

    Отличия от источника: имя таблицы под ops_, целый первичный ключ. Ключ
    строки счётчика — НЕ номер документа, его транзакционность безразлична.
    """

    doc_type = models.CharField(max_length=50)
    year = models.PositiveIntegerField()
    last_number = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "ops_document_sequences"
        verbose_name = "Счётчик номеров документов"
        verbose_name_plural = "Счётчики номеров документов"
        constraints = [
            # Несущее ограничение, а не гигиена: заведение строки нового года
            # идёт через get_or_create, и в гонке двух транзакций проигравшая
            # сериализуется именно на этом уникальном индексе. Сними его — и
            # год начнётся с ДВУХ параллельных счётчиков, каждый со своей
            # единицей, то есть с двух документов под номером 1.
            models.UniqueConstraint(
                fields=["doc_type", "year"],
                name="uq_ops_document_sequence_type_year",
            ),
            # Осознанный дубль встроенной проверки положительного поля: имя
            # ограничения греппается и переживает смену типа колонки.
            models.CheckConstraint(
                condition=models.Q(last_number__gte=0),
                name="chk_ops_document_sequence_last_number",
            ),
            # Диапазон против перепутанных аргументов: year=6 или year=20026
            # завели бы отдельную вечную нумерацию, которую никто не ищет.
            models.CheckConstraint(
                condition=models.Q(year__gte=2000) & models.Q(year__lte=2200),
                name="chk_ops_document_sequence_year_range",
            ),
            models.CheckConstraint(
                condition=models.Q(doc_type__regex=r"\S"),
                name="chk_ops_document_sequence_doc_type",
            ),
        ]

    def __str__(self):
        return f"{self.doc_type}/{self.year}: {self.last_number}"


class OpsIssuedDocument(TimeStampedModel):
    """Выпуск официального документа: номер, день, зафиксированные байты.

    Одна строка — один выпуск. Содержимое её неизменно: поправка сдачи не
    правит выпуск, а порождает НОВЫЙ «взамен исходящего №…», прежний уходит в
    «заменён», и его байты не трогаются вовсе. Иначе предъявленный вчера
    документ задним числом менял бы содержание, и спор о том, что было
    подписано, стал бы неразрешим.

    ССЫЛКИ НАРУЖУ — ПЛОСКИЕ ЦЕЛЫЕ, как и во всём переехавшем: division_id и
    submission_id указывают в старую структуру, но не внешними ключами. PROTECT
    ломал бы каскады старой структуры, а CASCADE удалил бы ВЫПУЩЕННЫЙ документ
    вслед за перестройкой подразделения — то есть стёр бы исходящий номер.

    ВНУТРИ ПРИЛОЖЕНИЯ — НАСТОЯЩИЕ ВНЕШНИЕ КЛЮЧИ, оба с PROTECT: байты
    выпущенного документа удалить нельзя, и цепь «взамен» рваться не должна —
    иначе «взамен исходящего №5» указывало бы в пустоту.

    Отличия от источника: имя таблицы под ops_, целые ключи и плоские ссылки.
    """

    class Status(models.TextChoices):
        ISSUED = "ISSUED", "Выпущен"
        SUPERSEDED = "SUPERSEDED", "Заменён"

    doc_type = models.CharField(max_length=50)
    number = models.PositiveIntegerField()
    year = models.PositiveIntegerField()
    business_date = models.DateField()
    division_id = models.IntegerField()
    # Что именно зафиксировал выпуск: строка сдачи И её версия. Без версии
    # ссылка указывала бы на «сдачу вообще», а поправка меняет её содержание —
    # и документ перестал бы говорить, ЧТО он напечатал.
    submission_id = models.PositiveBigIntegerField()
    submission_version = models.PositiveIntegerField()
    attachment = models.ForeignKey(
        OpsAttachment, on_delete=models.PROTECT, related_name="issued_documents"
    )
    supersedes = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="superseded_by",
    )
    # БЕЗ дефолта: состояние всегда пишется явно, а молчаливое "" ловит CHECK.
    status = models.CharField(max_length=20, choices=Status.choices)
    # Причина выпуска: пустая у первого, непустая у выпуска поправленной сдачи.
    reason = models.TextField(blank=True, default="")

    class Meta:
        db_table = "ops_issued_documents"
        verbose_name = "Выпуск документа"
        verbose_name_plural = "Выпуски документов"
        constraints = [
            # Номер уникален внутри (вид, год) — это и есть обещание счётчика,
            # закреплённое базой. Счётчик может ошибиться (чужая правка строки
            # мимо замка), уникальность — нет.
            models.UniqueConstraint(
                fields=["doc_type", "year", "number"],
                name="uq_ops_issued_document_number",
            ),
            # НЕ БОЛЕЕ ОДНОГО действующего выпуска на (вид, подразделение, день).
            # Частичное — по состоянию: заменённых на один день сколько угодно,
            # это история, а действующий ровно один. Без условия ограничение
            # запретило бы вторую версию вовсе, то есть запретило бы поправку.
            models.UniqueConstraint(
                fields=["doc_type", "division_id", "business_date"],
                condition=models.Q(status="ISSUED"),
                name="uq_ops_issued_document_current",
            ),
            # Словарь состояний держит БАЗА: choices проверяются только формами,
            # а строки пишет сервис через .create() — то есть мимо.
            models.CheckConstraint(
                condition=models.Q(status__in=["ISSUED", "SUPERSEDED"]),
                name="chk_ops_issued_document_status",
            ),
            # Замена без причины — молчаливая подмена документа. Указал, ЧТО
            # заменяешь, — обязан сказать, ПОЧЕМУ. `\S` (а не «не пусто»):
            # строка из пробелов такой же немой ответ, как и пустая.
            models.CheckConstraint(
                condition=models.Q(supersedes__isnull=True)
                | models.Q(reason__regex=r"\S"),
                name="chk_ops_issued_document_supersede_reason",
            ),
            # Нулевой номер означал бы документ, которого не выдавали.
            models.CheckConstraint(
                condition=models.Q(number__gte=1),
                name="chk_ops_issued_document_number_min",
            ),
            models.CheckConstraint(
                condition=models.Q(year__gte=2000) & models.Q(year__lte=2200),
                name="chk_ops_issued_document_year_range",
            ),
            # Замена САМОГО СЕБЯ — цикл длины один: строка «взамен себя»
            # проходит любую проверку ссылки и делает цепь выпусков
            # неразрешимой. Циклы длиннее база не ловит — их не даёт порядок
            # создания (заменяемый существует раньше заменяющего).
            models.CheckConstraint(
                condition=~models.Q(supersedes=models.F("id")),
                name="chk_ops_issued_document_no_self_supersede",
            ),
        ]
        indexes = [
            # Разрез «что выпущено по этому подразделению за период» — основной
            # для реестра выпусков.
            models.Index(
                fields=["division_id", "-business_date", "id"],
                name="idx_ops_issued_doc_registry",
            ),
        ]

    def __str__(self):
        return f"{self.doc_type} №{self.number}/{self.year} ({self.status})"
