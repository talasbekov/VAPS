from django.db import models

from apps.core.models import UUIDTimeStampedModel

# Тип документа «расход» — единственный выпускаемый тип v1 (Story 6.5, Д6).
# Живёт рядом с моделью выпуска: сервис выпуска (operations) и счётчик номеров
# (DocumentSequence) читают ОДИН литерал, паритет тестам 6.2.
EXPENSE_DOC_TYPE = "расход"


class Attachment(UUIDTimeStampedModel):
    """Единая запись о файле в приватном хранилище (Story 6.1, AR-7).

    Байты лежат вне MEDIA_URL под именем ``{root}/{id}`` (UUID PK = имя файла
    на диске, Д2); отдача — только через X-Accel-Redirect (сервисный контракт в
    ``apps.documents.services``). Метаданные (``original_name``/``content_type``/
    ``size``/``sha256``) — единственный источник Content-* заголовков скачивания.

    Контракт связей (Ловушка №1, «явные FK — не GenericFK» × ARCH-003):
    у Attachment НЕТ owner-полей — направление связи всегда «владелец →
    Attachment». Владелец внутри app ``documents`` (например, документ выпуска
    6.5) ссылается обычным FK; сущность другого контекста (core/operations) —
    плоским ``UUIDField attachment_id``, НИКОГДА не FK через границу.
    ``GenericForeignKey``/``ContentType``-полиморфизм — запрещён.

    Бизнес-модель — НЕ регистрировать в Django Admin (Admin = только
    справочники; мимо сервиса = мимо аудита/прав).
    """

    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    # BigInteger (Д10): снимает вопрос >2ГБ навсегда; floor ≥ 1 — DB-констрейнт.
    size = models.BigIntegerField()
    sha256 = models.CharField(max_length=64)

    class Meta:
        db_table = "documents_attachments"
        constraints = [
            # Поля без дефолта → `.objects.create()` не валидирует форму
            # (урок chk_daily_submission_event): DB-гард держит канонический
            # lowercase-hex дайджест и непустые метаданные.
            models.CheckConstraint(
                condition=models.Q(sha256__regex=r"^[0-9a-f]{64}$"),
                name="chk_attachment_sha256_format",
            ),
            # Пустой файл (size=0) отбит формой (Д9); floor — DB-backstop.
            models.CheckConstraint(
                condition=models.Q(size__gte=1),
                name="chk_attachment_size_min",
            ),
            # `\S` (хоть один НЕ-пробельный символ) отвергает и "" и
            # whitespace-only (зеркало chk_daily_submission_amended_*).
            models.CheckConstraint(
                condition=models.Q(original_name__regex=r"\S"),
                name="chk_attachment_original_name_not_blank",
            ),
            models.CheckConstraint(
                condition=models.Q(content_type__regex=r"\S"),
                name="chk_attachment_content_type_not_blank",
            ),
        ]
        indexes = [
            # Поиск по дайджесту (сверка байт-в-байт 6.7, будущая дедупликация).
            models.Index(fields=["sha256"], name="idx_attachment_sha256"),
        ]
        verbose_name = "Вложение"
        verbose_name_plural = "Вложения"

    def __str__(self):
        return f"{self.original_name} ({self.id})"


class DocumentSequence(models.Model):
    """Счётчик номеров документов по паре (doc_type, year) — Story 6.2, AR-7.

    Internal bookkeeping (зеркало ``core.Watermark``): bare-модель без API,
    Admin и аудита; наружу не отдаётся. Номер выдаётся ТОЛЬКО через
    ``apps.documents.services.allocate_number`` ВНУТРИ транзакции финализации
    вызывающего (6.5): сервис берёт row-лок ``select_for_update`` и держит его
    до коммита — откат транзакции отменяет и инкремент, дырки в нумерации нет
    (gap-tolerant). Прямой UPDATE строки = мимо лока = lost update / дубль
    номера — запрещён.

    MUST NOT: Postgres SEQUENCE в любой форме (``CREATE SEQUENCE``,
    ``GENERATED … AS IDENTITY``, ``AutoField``/``serial`` для номера) —
    ``nextval()`` не транзакционен: взятый номер при откате не возвращается →
    дырка. Наша механика — обычная integer-колонка ``last_number`` + row-лок
    (architecture.md §Process Patterns «Нумерация документов»). PK самой
    строки счётчика — неявный BigAutoField: это НЕ номер документа, его
    транзакционность не важна.

    Year-rollover (§82.3): новый ``(doc_type, year)`` бутстрапится
    ``get_or_create`` под защитой ``uq_document_sequence_doc_type_year``
    (unique-констрейнт load-bearing — гонка двух транзакций сериализуется на
    unique-индексе + row-локе); счётчик нового года стартует с 1.
    """

    doc_type = models.CharField(max_length=50)
    year = models.PositiveIntegerField()
    last_number = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "documents_document_sequences"
        constraints = [
            # Load-bearing для bootstrap-гонки: get_or_create в сервисе
            # опирается на этот unique при проигрыше INSERT-гонки (savepoint
            # → повторный get). Не декорация.
            models.UniqueConstraint(
                fields=["doc_type", "year"],
                name="uq_document_sequence_doc_type_year",
            ),
            # Осознанный дубль встроенного чека позитив-филда именованным
            # констрейнтом (зеркало chk_daily_submission_version_min):
            # greppable и переживает смену типа поля.
            models.CheckConstraint(
                condition=models.Q(last_number__gte=0),
                name="chk_document_sequence_last_number_min",
            ),
            # Диапазон-гвард против перепутанных аргументов (year=6,
            # year=20026); в сервисе продублирован на границе.
            models.CheckConstraint(
                condition=models.Q(year__gte=2000) & models.Q(year__lte=2200),
                name="chk_document_sequence_year_range",
            ),
            # `\S` (хоть один НЕ-пробельный символ) отвергает и "" и
            # whitespace-only (зеркало chk_attachment_*_not_blank).
            models.CheckConstraint(
                condition=models.Q(doc_type__regex=r"\S"),
                name="chk_document_sequence_doc_type_not_blank",
            ),
        ]
        verbose_name = "Счётчик номеров документов"
        verbose_name_plural = "Счётчики номеров документов"

    def __str__(self):
        return f"{self.doc_type}/{self.year}: {self.last_number}"


class IssuedDocument(UUIDTimeStampedModel):
    """Выпуск официального документа: файл + sha256 + номер (Story 6.5).

    Одна строка — один выпуск: номер из ``allocate_number`` + FK на
    ``Attachment`` с зафиксированными байтами (снапшот-семантика «байт-в-байт
    + хэш», §82.1-82.3). Строка иммутабельна по содержимому: amendment сдачи
    порождает НОВЫЙ выпуск «взамен исх. №…» (``supersedes`` → прежний выпуск,
    прежний ``ISSUED→SUPERSEDED``; его Attachment/байты не трогаются).

    Cross-context ссылки — плоские id (ARCH-003): ``division_id`` (UUID
    core_divisions), ``submission_id``/``submission_version`` (int-PK и версия
    ``ops_daily_submissions``) — НИКОГДА не FK через границу. FK внутри app:
    ``attachment`` (PROTECT — выпуск номерован и аудирован, байты не удалить),
    ``supersedes`` (self, PROTECT — цепь выпусков не рвётся).

    Инварианты БД: unique ``(doc_type, year, number)``; НЕ БОЛЕЕ одного
    ISSUED на ``(doc_type, division_id, business_date)`` (partial-unique;
    «ровно один после первого выпуска» — прикладной инвариант сервиса,
    зеркало канона DailySubmission); ``supersedes`` непуст ⇒ ``reason``
    непуст. Писатель ОДИН — ``issue_expense_document``
    (apps/operations/submissions/services/document_release_service.py).

    Бизнес-модель — НЕ регистрировать в Django Admin (Admin = только
    справочники); hard delete запрещён (architecture §Process Patterns) —
    delete-путей не заводить.
    """

    class Status(models.TextChoices):
        ISSUED = "ISSUED", "Выпущен"
        SUPERSEDED = "SUPERSEDED", "Заменён"

    doc_type = models.CharField(max_length=50)
    number = models.PositiveIntegerField()
    year = models.PositiveIntegerField()
    business_date = models.DateField()
    # ARCH-003: flat cross-context reference to core_divisions, never an FK.
    division_id = models.UUIDField()
    # ARCH-003: flat int-PK of the issued ops_daily_submissions row + its
    # version — what exactly this выпуск fixed, without a cross-context FK.
    submission_id = models.PositiveBigIntegerField()
    submission_version = models.PositiveIntegerField()
    attachment = models.ForeignKey(
        Attachment, on_delete=models.PROTECT, related_name="issued_documents"
    )
    supersedes = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="superseded_by",
    )
    # БЕЗ default: сервис всегда пишет ISSUED явно — молчаливое "" ловит CHECK.
    status = models.CharField(max_length=20, choices=Status.choices)
    # reason выпускаемой сдачи ("" у v1, непустой у AMENDED) — потому blank
    # допустим и при supersedes=None (первый выпуск amended-сдачи несёт reason).
    reason = models.TextField(blank=True, default="")

    class Meta:
        db_table = "documents_issued_documents"
        constraints = [
            # §82.3: номер уникален внутри (тип, год) — гарантия counter-канала.
            models.UniqueConstraint(
                fields=["doc_type", "year", "number"],
                name="uq_issued_document_number",
            ),
            # НЕ БОЛЕЕ одного действующего выпуска на (тип, подразделение,
            # день); флип ISSUED→SUPERSEDED освобождает слот (канон
            # unique_daily_submission_current).
            models.UniqueConstraint(
                fields=["doc_type", "division_id", "business_date"],
                condition=models.Q(status="ISSUED"),
                name="uq_issued_document_current",
            ),
            # status без дефолта → `.objects.create()` не валидирует choices;
            # DB-гард держит словарь состояний (зеркало chk_daily_submission_event).
            models.CheckConstraint(
                condition=models.Q(status__in=["ISSUED", "SUPERSEDED"]),
                name="chk_issued_document_status",
            ),
            # Номера выдаются с 1 (auto-CHECK позитив-филда пропускает 0).
            models.CheckConstraint(
                condition=models.Q(number__gte=1),
                name="chk_issued_document_number_min",
            ),
            models.CheckConstraint(
                condition=models.Q(doc_type__regex=r"\S"),
                name="chk_issued_document_doc_type_not_blank",
            ),
            # «Взамен исх. №» обязан нести причину замены (зеркало
            # chk_daily_submission_amended_requires_reason_sanction); обратное
            # НЕ требуется — первый выпуск amended-сдачи несёт reason без
            # supersedes.
            models.CheckConstraint(
                condition=(
                    ~models.Q(supersedes__isnull=False) | models.Q(reason__regex=r"\S")
                ),
                name="chk_issued_document_supersede_reason",
            ),
        ]
        indexes = [
            models.Index(
                fields=["division_id", "business_date"],
                name="idx_issued_document_lookup",
            ),
        ]
        verbose_name = "Выпуск документа"
        verbose_name_plural = "Выпуски документов"

    def __str__(self):
        return f"{self.doc_type} №{self.number}/{self.year} ({self.status})"
