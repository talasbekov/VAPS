"""Единственная точка записи в журнал раздела ОМ (порт apps/audit/services.py
из Backend/VAPS).

Правило источника сохранено дословно: НИ ОДИН модуль вне этого файла не
создаёт строки журнала напрямую. Иначе словарь событий, формат снимков и
источник времени разъедутся по вызывающим, и журнал перестанет быть одним
рассказом об одной системе.

Запись СИНХРОННА и идёт в транзакции вызывающего: откатилась мутация —
откатилась и запись о ней. Журнал рассказывает о СЛУЧИВШЕМСЯ, а не о попытках;
попытки видит HTTP-слой (старый middleware) и логи. Отложенная запись
(on_commit, очередь, отдельное соединение) здесь запрещена именно поэтому — а
не «своя транзакция запрещена»: вложенный atomic в Django всё равно откатится
вместе с внешним, и такое правило было бы недоказуемым.

Отличие от источника: словарь событий проверяется НА ЗАПИСИ, а не только
тестом покрытия. Опечатка в коде события иначе создаёт «новое» событие,
которое никто никогда не найдёт фильтром, — а найти пропажу в журнале можно
лишь тогда, когда уже поздно.

ПРАВИЛО ПОКРЫТИЯ (срез врезки). Событие пишется на КАЖДУЮ записанную строку,
а не на каждую «операцию»: мутация строки статуса даёт событие статуса,
мутация пары прикомандирования — событие пары. Поэтому возврат из
прикомандирования кладёт три строки (обе ноги и сама пара), а увольнение —
по строке на каждый закрытый статус плюс одну на сотрудника.

Соблазн писать «одну строку на операцию» отвергнут: тогда лента КОНКРЕТНОГО
статуса (entity_type+entity_id — главный разрез журнала, под него заведён
индекс) оказалась бы пуста у всего, что создано не поштучно — у ног пары, у
всей утренней пачки, — и на вопрос «кто и когда тронул вот эту строку»
журнал отвечал бы «никто». Событие операции при этом не теряется: пара и
увольнение пишут СВОЮ строку сверх построчных.
"""
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_audit import OpsAuditLog

# ── Закрытый словарь событий ─────────────────────────────────────────────
# Коды взяты из docs/registries/audit-events.yaml источника; здесь остаются
# только те, чьи мутации в раздел уже переехали. Новое событие заводится
# осознанно — добавлением сюда, а не строкой на месте вызова.

STATUS_CREATED = "STATUS_CREATED"
STATUS_UPDATED = "STATUS_UPDATED"
STATUS_CANCELLED = "STATUS_CANCELLED"
STATUS_COMPLETED = "STATUS_COMPLETED"
STATUS_EXTENDED = "STATUS_EXTENDED"
# Разрешение заглушки — ОДНО событие на две строки (закрытую и созданную):
# это одна операция, и разложенная на «отменил» плюс «создал» она читалась бы
# как два несвязанных решения оператора.
STATUS_CLARIFICATION_RESOLVED = "STATUS_CLARIFICATION_RESOLVED"
SECONDMENT_INITIATED = "SECONDMENT_INITIATED"
SECONDMENT_RETURN_REQUESTED = "SECONDMENT_RETURN_REQUESTED"
SECONDMENT_RETURNED = "SECONDMENT_RETURNED"
EMPLOYEE_DISMISSED = "EMPLOYEE_DISMISSED"
DAILY_SUBMISSION_SUBMITTED = "DAILY_SUBMISSION_SUBMITTED"
DAILY_SUBMISSION_AMENDED = "DAILY_SUBMISSION_AMENDED"
TOMORROW_BLOCK_OVERRIDDEN = "TOMORROW_BLOCK_OVERRIDDEN"
# Сводка — та же сущность сдачи, но СВОЁ событие: «собрал из версий детей» и
# «сдал свой день» отвечают на разные вопросы, и один код на оба лишил бы
# ленту возможности их различить.
DAILY_SUMMARY_ASSEMBLED = "DAILY_SUMMARY_ASSEMBLED"
# Пересборка «взамен» — своё событие, а не поправка сдачи: поправляют СВОЙ
# день, пересобирают ЧУЖИЕ версии, и в ленте это разные истории.
DAILY_SUMMARY_REBUILT = "DAILY_SUMMARY_REBUILT"
# Выдача личной копии сданного дня. Событие ЧТЕНИЯ в журнале мутаций —
# исключение осознанное: копию берут, чтобы предъявлять её в споре, и «кто и
# когда её получил» это и есть предмет разбирательства.
SUBMISSION_EXPORTED = "SUBMISSION_EXPORTED"
# Байты официального документа легли в приватное хранилище. Событие пишется на
# ЗАПИСЬ ФАЙЛА, а не на выпуск документа: выпуск — отдельное решение с номером,
# и приходит он своим срезом. Состояние «файл записан, выпуска нет» законно
# (выпуск откатился после записи байт), и журнал обязан уметь его показать —
# иначе на диске остаётся объект, о происхождении которого не сказано нигде.
ATTACHMENT_UPLOADED = "ATTACHMENT_UPLOADED"
# Документ выпущен: у дня появился исходящий номер. Событие ОТДЕЛЬНО от
# записи байт — записать файл и выпустить документ это разные решения, и
# первое бывает без второго (выпуск откатился), а вот второго без первого не
# бывает никогда.
DOCUMENT_ISSUED = "DOCUMENT_ISSUED"
# Прежний выпуск отозван новым «взамен исходящего №…». Событие пишется на
# ЗАМЕНЯЕМЫЙ документ, а не на заменяющий: в ленте исходящего №5 обязано
# стоять «отозван», иначе тот, кто держит на руках именно его, из журнала
# этого не узнает — а он-то и предъявляет документ.
DOCUMENT_SUPERSEDED = "DOCUMENT_SUPERSEDED"
# Байты официального документа выданы. Второе событие ЧТЕНИЯ в журнале мутаций
# (после выдачи личной копии), и по той же причине: документ берут, чтобы
# предъявлять, и «кто и когда его получил» — предмет разбирательства, а не
# статистика посещений. Пишется на ВЛОЖЕНИЕ, а не на выпуск: выдаются байты, и
# у отозванного выпуска они по-прежнему свои.
DOCUMENT_DOWNLOADED = "DOCUMENT_DOWNLOADED"
# Опубликована версия паспорта объекта. Событие пишется на ПУБЛИКАЦИЮ, а не на
# правку черновика: черновик — рабочая тетрадь, версия — утверждённый документ,
# и предмет разбирательства («каким был паспорт и кто его утвердил») — она.
PASSPORT_VERSION_PUBLISHED = "PASSPORT_VERSION_PUBLISHED"
# Охранное мероприятие: заведение и закрытие — решения с внешним следом
# (номер ОМ в бумаге). Промежуточные стадии событий не пишут: их след — сам
# агрегат (журнал штаба, назначения), а не журнал мутаций раздела.
SECURITY_EVENT_CREATED = "SECURITY_EVENT_CREATED"
SECURITY_EVENT_CLOSED = "SECURITY_EVENT_CLOSED"
# Удаление ОМ из реестра. Строка исчезает целиком — значит журнал мутаций
# остаётся ЕДИНСТВЕННЫМ следом того, что она вообще была: снимок кладётся в
# old_value целиком, иначе «куда делось ОМ-2026-118» останется без ответа.
SECURITY_EVENT_DELETED = "SECURITY_EVENT_DELETED"
# Ручной перевод ОМ на произвольный этап администратором. Исключение из
# правила выше («промежуточные стадии событий не пишут»): обычный переход —
# это пройденный этап, и его след живёт в журнале переходов, а перевод
# админом ОБХОДИТ условия этапа, то есть является решением человека, а не
# следствием работы. Без записи в журнале мутаций разбирательство «почему
# ОМ оказалось на согласовании с пустой расстановкой» упиралось бы в
# безымянный RETURN.
SECURITY_EVENT_STAGE_OVERRIDDEN = "SECURITY_EVENT_STAGE_OVERRIDDEN"
# Замещающий на объекте посещения: выдача и отзыв права (Plane «Реестр
# ОМ-24»). Это раздача ПРАВА в данных — человек получает возможность править
# расстановку своего объекта, не имея общего `event.manage`. Такое решение
# обязано быть именным: без записи разбирательство «кто пустил его в
# расстановку» упиралось бы в строку таблицы без автора.
SECURITY_EVENT_DEPUTY_ASSIGNED = "SECURITY_EVENT_DEPUTY_ASSIGNED"
SECURITY_EVENT_DEPUTY_REVOKED = "SECURITY_EVENT_DEPUTY_REVOKED"
# Операция расстановки, СДЕЛАННАЯ замещающим. Исключение из правила
# «промежуточные стадии следа не пишут» по тому же основанию, что и перевод
# этапа админом: действие совершено в обход общего права, по роли в данных, и
# его след обязан быть в журнале мутаций, а не только в самом агрегате.
SECURITY_EVENT_PLACEMENT_BY_DEPUTY = "SECURITY_EVENT_PLACEMENT_BY_DEPUTY"
# Старший объекта посещения: назначение и снятие (Plane «Реестр ОМ-35.2»).
# Пишется по тому же основанию, что и замещающий: это ИМЕННОЕ назначение
# ответственного за объект — по нему спрашивают доклад и расстановку. Без
# записи разбирательство «кто поставил его на объект и когда сняли» упиралось
# бы в поле без автора.
VISIT_OBJECT_CHIEF_ASSIGNED = "VISIT_OBJECT_CHIEF_ASSIGNED"
# Оповещение управлений о заявке департаменту (Plane №73, «Сбор сил на ОМ»).
# Пишется, потому что с этого момента начинается ответственность людей вне
# мероприятия: «нам не говорили» разбирается по строке журнала, а не по
# памяти дежурного.
FORCE_ALLOCATION_NOTIFIED = "FORCE_ALLOCATION_NOTIFIED"
# Департамент разложил СВОЮ квоту между управлениями (Plane №272, Ш-1).
# Пишется по той же причине, что и оповещение: с этого числа управление
# начинает выделять людей, и «сколько с нас просили» разбирается по строке
# журнала, а не по памяти.
FORCE_ALLOCATION_SPLIT = "FORCE_ALLOCATION_SPLIT"
# Отправка окончательного списка штабу: с этого момента за людей отвечает уже
# не департамент. Момент перехода ответственности — то, ради чего журнал и
# ведут.
FORCE_ALLOCATION_SUBMITTED = "FORCE_ALLOCATION_SUBMITTED"
# Решение штаба по присланному списку: приёмка отдаёт людей мероприятию,
# возврат отправляет заявку обратно с причиной. Оба — акты штаба, и оба
# спрашиваются потом поимённо.
FORCE_ALLOCATION_ACCEPTED = "FORCE_ALLOCATION_ACCEPTED"
FORCE_ALLOCATION_RETURNED = "FORCE_ALLOCATION_RETURNED"
VISIT_OBJECT_CHIEF_REVOKED = "VISIT_OBJECT_CHIEF_REVOKED"
# Старший МЕРОПРИЯТИЯ — старший наряда (или ГВО), названный в бюллетене
# (Plane №190). Действие ОДНО на назначение, замену и снятие: вопрос «кто
# отвечает за наряд» один, и разбирается он по одной ленте, где прежняя
# подпись стоит рядом с новой. Снятие — это `new_value` без человека, а не
# отдельная история.
#
# Отдельно от `VISIT_OBJECT_CHIEF_*` намеренно: старший наряда и старший
# объекта — разные люди с разной ответственностью, и слить их в одно действие
# значило бы отвечать на два разных вопроса одной лентой.
SECURITY_EVENT_CHIEF_SET = "SECURITY_EVENT_CHIEF_SET"
# Правка СВЕДЕНИЙ бюллетеня — название, период, время, охраняемое лицо,
# локация (Plane №192). Пишется потому, что по этим полям потом сверяют
# документы: бюллетень уже выгружен и разослан, а дата в системе изменилась —
# и вопрос «когда её поменяли и кто» обязан иметь ответ, а не догадку.
SECURITY_EVENT_DETAILS_UPDATED = "SECURITY_EVENT_DETAILS_UPDATED"
# Старший сектора на расстановке (Plane №65, «Расстановка по прототипу»).
# Пишется по тому же основанию, что и старший объекта: это именное назначение
# ответственного, по нему спрашивают доклад с сектора. Действие ОДНО на оба
# случая — назначение и снятие: вопрос «кто отвечает за сектор» один, и
# разбирается он по одной ленте, где старое значение стоит рядом с новым
# (снятие — это `new_value` без человека, а не отдельная история).
PLACEMENT_SECTOR_SENIOR_SET = "PLACEMENT_SECTOR_SENIOR_SET"
# Смена дежурства: заведение и отмена — решения с обоснованием (обход отдыха,
# причина отмены); ознакомление/заступление/завершение следа в журнале
# мутаций не оставляют — их след живёт на самой смене (штампы времени).
# Правка справочника прав (Plane №36, «П-2»). Одно действие на заведение и
# правку: вопрос «что это за право и что оно открывает» один, и разбирается он
# по одной ленте, где старое значение стоит рядом с новым.
ACCESS_PERMISSION_SAVED = "ACCESS_PERMISSION_SAVED"
# Правка роли (Plane №36, «П-3»). Действий ДВА, а не одно: «как называется
# роль» и «что она открывает» — разные вопросы, и спрашивают по ним разное.
# Слив их в одно событие заставил бы читателя ленты разбирать по содержимому
# new_value, что именно изменилось, — а лента для того и нужна, чтобы этого
# не делать.
ACCESS_ROLE_SAVED = "ACCESS_ROLE_SAVED"
ACCESS_ROLE_PERMISSIONS_CHANGED = "ACCESS_ROLE_PERMISSIONS_CHANGED"
# Учётная запись (Plane №36, «П-5»). Заведение, правка и БЛОКИРОВКА — одно
# действие: вопрос «что это за учётка и работает ли она» один, и старое
# значение стоит в записи рядом с новым. Сброс пароля — своё действие: его
# спрашивают отдельно («кому и когда меняли пароль»), и сам пароль в записи
# не появляется НИ В КАКОМ виде.
ACCESS_ACCOUNT_SAVED = "ACCESS_ACCOUNT_SAVED"
ACCESS_ACCOUNT_PASSWORD_RESET = "ACCESS_ACCOUNT_PASSWORD_RESET"
# Человек сменил СВОЙ пароль (Plane №180). Отдельное действие от сброса, а не
# то же самое с другим актором: сброс делает администратор чужой учётке и
# отдаёт временный пароль в переписку, а смена подтверждается текущим паролем
# и никакого пароля наружу не отдаёт. Разбирательство «как у него оказался
# этот пароль» упирается ровно в это различие, и по одному лишь полю актора
# его не прочесть: администратор может менять и свой собственный.
ACCESS_ACCOUNT_PASSWORD_CHANGED = "ACCESS_ACCOUNT_PASSWORD_CHANGED"
# Выдача роли ЧЕЛОВЕКУ и её снятие (Plane №107). Именно эти два действия
# меняют, кто и что может делать в системе, — и до 26.08.2026 они НЕ оставляли
# следа вовсе: справочники прав и ролей писались в журнал, а раздача — нет.
# Разбирательство «кто дал ему это право» упиралось в текущее состояние базы:
# по нему видно, что роль есть, и не видно, кто и когда её выдал.
#
# Выдача и снятие — РАЗНЫЕ действия, а не одно с флагом: их спрашивают
# порознь («кому раздавали за месяц», «у кого снимали»), и общий код заставил
# бы читателя ленты разбирать содержимое new_value.
ACCESS_ROLE_GRANTED = "ACCESS_ROLE_GRANTED"
ACCESS_ROLE_REVOKED = "ACCESS_ROLE_REVOKED"
DUTY_SHIFT_CREATED = "DUTY_SHIFT_CREATED"
DUTY_SHIFT_CANCELLED = "DUTY_SHIFT_CANCELLED"
# Настройки: принятая правка правила — решение с причиной и версией политики.
SETTINGS_UPDATED = "SETTINGS_UPDATED"
# Справочники: заведение/(де)активация/удаление значения — админ-решения.
DICTIONARY_ENTRY_CREATED = "DICTIONARY_ENTRY_CREATED"
DICTIONARY_ENTRY_SET_ACTIVE = "DICTIONARY_ENTRY_SET_ACTIVE"
DICTIONARY_ENTRY_DELETED = "DICTIONARY_ENTRY_DELETED"
# Правка значения справочника (Plane №274): заказчик просил у модуля все три
# действия — «Добавлять, удалять, редактировать», — а правки не было вовсе.
DICTIONARY_ENTRY_UPDATED = "DICTIONARY_ENTRY_UPDATED"
# Сводка ГВО: ручная правка и сброс патча — решения с внешним следом
# (сводные данные уходят в бумагу); сама база сводки следа не оставляет —
# она производная бюллетеня мероприятия.
GVO_SUMMARY_PATCHED = "GVO_SUMMARY_PATCHED"
GVO_SUMMARY_RESET = "GVO_SUMMARY_RESET"

# СНЯТО в срезе врезки: STATUSES_BULK_CREATED (сводка массового обновления).
# Класть в entity_id (NOT NULL, целое) у сводки нечего — «пачка» не сущность и
# своего идентификатора не имеет, а подсунуть туда чужой id значило бы солгать
# о том, чья это лента. Сама пачка при этом из журнала не пропала: она пишется
# N строками STATUS_CREATED с ОДНИМ актором и ОДНИМ временем (record_many
# ставит момент однажды), и это ровно то, что сводка и утверждала бы. Событие,
# которого никто не пишет, — обещание фильтра, возвращающего пустоту.
ACTIONS = frozenset(
    {
        STATUS_CREATED,
        STATUS_UPDATED,
        STATUS_CANCELLED,
        STATUS_COMPLETED,
        STATUS_EXTENDED,
        STATUS_CLARIFICATION_RESOLVED,
        SECONDMENT_INITIATED,
        SECONDMENT_RETURN_REQUESTED,
        SECONDMENT_RETURNED,
        EMPLOYEE_DISMISSED,
        DAILY_SUBMISSION_SUBMITTED,
        DAILY_SUBMISSION_AMENDED,
        TOMORROW_BLOCK_OVERRIDDEN,
        DAILY_SUMMARY_ASSEMBLED,
        DAILY_SUMMARY_REBUILT,
        SUBMISSION_EXPORTED,
        ATTACHMENT_UPLOADED,
        DOCUMENT_ISSUED,
        DOCUMENT_SUPERSEDED,
        DOCUMENT_DOWNLOADED,
        PASSPORT_VERSION_PUBLISHED,
        SECURITY_EVENT_CREATED,
        SECURITY_EVENT_CLOSED,
        SECURITY_EVENT_DELETED,
        SECURITY_EVENT_STAGE_OVERRIDDEN,
        SECURITY_EVENT_DEPUTY_ASSIGNED,
        SECURITY_EVENT_DEPUTY_REVOKED,
        SECURITY_EVENT_PLACEMENT_BY_DEPUTY,
        VISIT_OBJECT_CHIEF_ASSIGNED,
        FORCE_ALLOCATION_NOTIFIED,
        FORCE_ALLOCATION_SPLIT,
        FORCE_ALLOCATION_SUBMITTED,
        FORCE_ALLOCATION_ACCEPTED,
        FORCE_ALLOCATION_RETURNED,
        VISIT_OBJECT_CHIEF_REVOKED,
        SECURITY_EVENT_CHIEF_SET,
        SECURITY_EVENT_DETAILS_UPDATED,
        PLACEMENT_SECTOR_SENIOR_SET,
        ACCESS_PERMISSION_SAVED,
        ACCESS_ROLE_SAVED,
        ACCESS_ROLE_PERMISSIONS_CHANGED,
        ACCESS_ACCOUNT_SAVED,
        ACCESS_ACCOUNT_PASSWORD_RESET,
        ACCESS_ACCOUNT_PASSWORD_CHANGED,
        ACCESS_ROLE_GRANTED,
        ACCESS_ROLE_REVOKED,
        DUTY_SHIFT_CREATED,
        DUTY_SHIFT_CANCELLED,
        SETTINGS_UPDATED,
        DICTIONARY_ENTRY_CREATED,
        DICTIONARY_ENTRY_SET_ACTIVE,
        DICTIONARY_ENTRY_DELETED,
        DICTIONARY_ENTRY_UPDATED,
        GVO_SUMMARY_PATCHED,
        GVO_SUMMARY_RESET,
    }
)

# Типы сущностей журнала — тоже закрытый мир: по ним ищут ленту объекта, и
# «employee_status» против «status» развалили бы поиск надвое.
ENTITY_STATUS = "employee_status"
ENTITY_SECONDMENT = "secondment"
ENTITY_EMPLOYEE = "employee"
ENTITY_SUBMISSION = "daily_submission"
# Обход блокировки — СВОЯ сущность, а не событие сдачи: у него нет ни
# подразделения, ни версии, и в ленте конкретной сдачи он рассказывал бы о
# решении, принятом не про неё.
ENTITY_TOMORROW_BLOCK_OVERRIDE = "tomorrow_block_override"
# Вложение — СВОЯ сущность, а не документ: строка о файле переживает и выпуск,
# и его замену, а лента конкретного файла отвечает на вопрос «эти байты откуда
# взялись и кто их забирал».
ENTITY_ATTACHMENT = "attachment"
# Выпуск — своя сущность, а не вложение: у ленты выпуска ось «исходящий
# номер», и события замены документа рассказывают про номер, а не про байты
# (байты заменённого выпуска не меняются вовсе).
ENTITY_ISSUED_DOCUMENT = "issued_document"
# Охраняемый объект: лента отвечает «что происходило с этим объектом и его
# паспортом»; ключ — целочисленный pk строки реестра.
ENTITY_SECURITY_OBJECT = "security_object"
# Охранное мероприятие — своя лента: у него ось «код ОМ», а не объект.
ENTITY_SECURITY_EVENT = "security_event"
ENTITY_DUTY_SHIFT = "duty_shift"
ENTITY_POLICY_SETTING = "policy_setting"
ENTITY_DICTIONARY_ENTRY = "dictionary_entry"
# Справочники доступа (Plane №36): право и роль. Правка доступа — именное
# решение, по которому потом спрашивают «кто и когда открыл эту ручку».
ENTITY_PERMISSION = "access_permission"
ENTITY_ROLE = "access_role"
ENTITY_ACCOUNT = "access_account"
# Назначение роли человеку: сущность отдельная от роли и от учётки, потому что
# отвечает на свой вопрос — «кому, что и в какой области».
ENTITY_USER_ROLE = "access_user_role"

ENTITY_TYPES = frozenset(
    {
        ENTITY_STATUS,
        ENTITY_SECONDMENT,
        ENTITY_EMPLOYEE,
        ENTITY_SUBMISSION,
        ENTITY_TOMORROW_BLOCK_OVERRIDE,
        ENTITY_ATTACHMENT,
        ENTITY_ISSUED_DOCUMENT,
        ENTITY_SECURITY_OBJECT,
        ENTITY_SECURITY_EVENT,
        ENTITY_DUTY_SHIFT,
        ENTITY_POLICY_SETTING,
        ENTITY_DICTIONARY_ENTRY,
        ENTITY_PERMISSION,
        ENTITY_ROLE,
        ENTITY_ACCOUNT,
        ENTITY_USER_ROLE,
    }
)


def _build(
    *,
    actor,
    action,
    entity_type,
    entity_id=None,
    entity_key=None,
    created_at=None,
    old_value=None,
    new_value=None,
    reason="",
):
    """Проверить событие и собрать (НЕ сохранённую) строку журнала.

    Пустой актор, незнакомое действие или незнакомый тип сущности — ValueError
    и никакой записи: это дефекты вызывающего кода, а не ситуация данных, и
    молчаливо записанный мусор в журнале хуже его отсутствия. Проверка живёт
    здесь, а не в record(), чтобы пачка не могла записаться в обход неё.
    """
    if not actor or not str(actor).strip():
        raise ValueError("запись в журнал требует непустого актора")
    if action not in ACTIONS:
        raise ValueError(f"неизвестное событие журнала: {action!r}")
    if entity_type not in ENTITY_TYPES:
        raise ValueError(f"неизвестный тип сущности журнала: {entity_type!r}")
    # Ключ обязателен, но ровно один: строка без обоих не указывает ни на
    # что, а с обоими — на два разных объекта.
    if (entity_id is None) == (entity_key is None):
        raise ValueError(
            "строка журнала требует РОВНО одного ключа: entity_id или entity_key"
        )
    return OpsAuditLog(
        actor_user_id=str(actor),
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_key=entity_key,
        old_value=old_value,
        new_value=new_value,
        reason=reason,
        created_at=created_at,
    )


def record(
    *,
    actor,
    action,
    entity_type,
    entity_id=None,
    entity_key=None,
    old_value=None,
    new_value=None,
    reason="",
):
    """Добавить строку журнала и вернуть её.

    actor — идентичность, которую вызывающий УЖЕ держит (из контракта
    аутентификации или системная метка); читать её из запроса здесь нельзя,
    сервисы раздела о запросе не знают вовсе.
    """
    entry = _build(
        actor=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_key=entity_key,
        old_value=old_value,
        new_value=new_value,
        reason=reason,
        # Время — через часы раздела, никогда не auto_now_add.
        created_at=Clock.now(),
    )
    entry.save()
    return entry


def record_many(entries):
    """Добавить строки журнала ОДНИМ запросом и вернуть их.

    Существует ради путей с постоянным числом запросов (массовое обновление):
    там record() в цикле дал бы N вставок и вернул бы ровно ту зависимость
    числа запросов от числа строк, от которой умер донор. Проверка события та
    же самая и на КАЖДУЮ строку — пачка не льгота, а способ доставки.

    Время ставится ОДНАЖДЫ на всю пачку, а не построчно: это одна операция
    одного актора, и одинаковый момент — то единственное, чем строки пачки
    отличимы от N независимых записей (сводной строки у пачки нет, см. ACTIONS).
    """
    entries = list(entries)
    if not entries:
        return []
    now = Clock.now()
    rows = [_build(created_at=now, **entry) for entry in entries]
    return OpsAuditLog.objects.bulk_create(rows)


def status_snapshot(status):
    """Снимок строки статуса для полей old_value/new_value.

    JSON-безопасный и ПЛОСКИЙ: даты строками, никаких объектов модели —
    журнал переживает и удаление типа из справочника, и смену схемы, потому
    что хранит значения, а не ссылки.
    """
    return {
        "status_id": status.pk,
        "employee_id": status.employee_id,
        "status_type_code": status.status_type_code,
        "date_start": str(status.date_start),
        "date_end": str(status.date_end),
        "source": status.source,
        "comment": status.comment,
        "document_basis": status.document_basis,
        "cancelled_at": (
            status.cancelled_at.isoformat() if status.cancelled_at else None
        ),
        "cancelled_by": status.cancelled_by,
        "cancelled_reason": status.cancelled_reason,
    }


def secondment_snapshot(secondment):
    """Снимок пары прикомандирования — по тому же правилу, что и статус."""
    return {
        "secondment_id": secondment.pk,
        "employee_id": secondment.employee_id,
        "out_status_id": secondment.out_status_id,
        "in_status_id": secondment.in_status_id,
        "from_division_id": secondment.from_division_id,
        "to_division_id": secondment.to_division_id,
        "return_requested_at": (
            secondment.return_requested_at.isoformat()
            if secondment.return_requested_at
            else None
        ),
        "return_requested_by": secondment.return_requested_by,
        "return_confirmed_at": (
            secondment.return_confirmed_at.isoformat()
            if secondment.return_confirmed_at
            else None
        ),
        "return_confirmed_by": secondment.return_confirmed_by,
    }


def submission_snapshot(submission):
    """Снимок версии сдачи дня — по тому же правилу, что и статус.

    Сам снимок ДНЯ сюда не кладётся: он иммутабельно живёт в своей строке, а
    в журнале раздулся бы до сотен килобайт на событие. Для восстановления
    достаточно ссылки на строку.

    Атрибуты поправки входят БЕЗУСЛОВНО, хотя у первичной сдачи они пусты
    (отличие от источника: там они надстраиваются вызывающим только над
    версиями-поправками). Условная форма означала бы, что две записи об одном
    типе сущности несут разный набор ключей, и читатель ленты не смог бы
    опереться ни на один — отсутствие ключа неотличимо от «причины не было».
    """
    return {
        "submission_id": submission.pk,
        "division_id": submission.division_id,
        "business_date": str(submission.business_date),
        "version": submission.version,
        "event": submission.event,
        "late": submission.late,
        "is_current": submission.is_current,
        "submitted_at": submission.submitted_at.isoformat(),
        "reason": submission.reason,
        "sanction": submission.sanction,
        "triggered_by_status_id": submission.triggered_by_status_id,
    }
