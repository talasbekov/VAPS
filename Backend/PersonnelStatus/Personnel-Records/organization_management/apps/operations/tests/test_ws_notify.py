"""notify() объявляет созданную строку в сокет по коммиту.

Здесь впервые в разделе сходятся в ОДНОМ тесте ORM, транзакция и живой сокет,
и оснастка — то, что стоит прочитать до правок.

ПОЧЕМУ СИНХРОННЫЙ ОСТРОВОК. Подписчику нужна корутина (тело теста заводится
через `async_to_sync`, как в test_ws_consumer), а ORM у Django `@async_unsafe`
— вызов из потока с работающим циклом событий даёт SynchronousOnlyOperation.
Поэтому всё синхронное — ORM, транзакция и тот `group_send`, что делает
обработчик коммита, — уезжает в `_island()`, а телу теста остаётся сокет.

ПОЧЕМУ НЕ НУЖЕН django_capture_on_commit_callbacks В ОСТРОВКЕ. Тесты сокета
идут под `django_db(transaction=True)`: объемлющей тестовой транзакции нет,
`transaction.atomic()` внутри островка — НАСТОЯЩАЯ транзакция, её коммит
по-настоящему запускает on_commit, а откат по-настоящему выбрасывает
обработчик. Захват обработчиков подменял бы коммит, который и так случается,
— строго слабее. Ловушка «под обычным django_db обработчики не исполняются»
реальна, и ровно поэтому два теста НА ГЛАВНОМ ПОТОКЕ ниже фикстуру берут.

ЧЕГО ОСТРОВОК НЕ ПОКРЫВАЕТ. Настоящий отправитель (check_lagging_submissions)
целиком сюда не заводится: его посев правит настройки контроля, которые
приходят миграцией, и здесь такая правка КОММИТИТСЯ. Инвариант, ради которого
он был бы нужен, — что обработчик следует за подённой вложенной atomic —
покрыт test_inner_savepoint_rollback_discards_the_signal, без такой цены.
"""
import logging
from datetime import date

import pytest
from asgiref.sync import sync_to_async
from django.db import transaction

from organization_management.apps.operations.api.serializers import (
    OpsNotificationSerializer,
)
from organization_management.apps.operations.models_notification import (
    OpsNotification,
)
from organization_management.apps.operations.notify_service import notify

# Оснастка сокета переиспользуется целиком — своя копия разошлась бы с
# потребителем молча. `fresh_channel_layer` — autouse-фикстура, и импорт
# именно её обязателен: без неё подписки соседнего теста переживают тест и
# «не доехало» становится неотличимо от «доехало не туда».
from organization_management.apps.operations.tests.test_ws_consumer import (  # noqa: F401
    fresh_channel_layer,
    make_user,
    socket,
    token_for,
    ws_test,
)

DAY = date(2026, 6, 5)
KIND = OpsNotification.Kind.SUBMISSION_LAGGING
PAYLOAD = {"laggard_division_ids": ["div-1", "div-2"]}
NOTIFY_LOGGER = "organization_management.apps.operations.notify_service"


@pytest.fixture
def user(transactional_db):
    return make_user("ws-recipient")


@pytest.fixture
def stranger(transactional_db):
    return make_user("ws-other-recipient")


async def _island(fn):
    """Исполнить `fn` вне цикла событий и прибрать за ним.

    `thread_sensitive=True` несущее: оно приколачивает вызов к тому же потоку,
    в котором крутится `async_to_sync` теста, — а значит к его соединению с
    базой.

    Прибирать приходится своими руками: коммит здесь настоящий, и строки
    останутся за тестом. Удаление безусловное — в этом модуле островок
    единственный, кто пишет уведомления.
    """

    def _wrapped():
        try:
            return fn()
        finally:
            OpsNotification.objects.all().delete()

    return await sync_to_async(_wrapped, thread_sensitive=True)()


class _ExplodingChannelLayer:
    """Недоступный канальный слой: `group_send` всегда рвётся.

    Настоящая корутина, а не Mock: `async_to_sync` проверяет тип аргумента и
    свалился бы на Mock ДО вызова — «слой взорвался» превратилось бы в «до
    слоя не дошли». `calls` доказывает, что ветка отказа реально пройдена.
    """

    def __init__(self):
        self.calls = 0

    async def group_send(self, group, message):
        self.calls += 1
        raise RuntimeError("канальный слой недоступен")


def _explode(monkeypatch):
    """Подменяется имя, связанное в notify_service при импорте, а НЕ
    channels.layers: модуль держит свою ссылку, и подмена источника оставила
    бы сервис на настоящем слое — тест позеленел бы не по той причине."""
    layer = _ExplodingChannelLayer()
    monkeypatch.setattr(
        "organization_management.apps.operations.notify_service"
        ".get_channel_layer",
        lambda: layer,
    )
    return layer


# ── Коммит объявляет, откат — молчит ─────────────────────────────────────


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_commit_publishes_to_the_recipient_group(user):
    communicator = socket(token=token_for(user))
    assert (await communicator.connect())[0] is True

    def _work():
        with transaction.atomic():
            notify(str(user.pk), KIND, DAY, payload=PAYLOAD)
        return OpsNotification.objects.count()

    rows = await _island(_work)
    envelope = await communicator.receive_json_from(timeout=5)

    assert rows == 1
    # Код вида для клиента — это `kind` самой строки, а не второй словарь,
    # отображающий одно в другое.
    assert envelope["type"] == "SUBMISSION_LAGGING"
    assert envelope["payload"]["recipient"] == str(user.pk)
    assert envelope["payload"]["payload"] == PAYLOAD
    await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_rollback_publishes_nothing(user):
    """Сердцевина среза: откатившаяся деловая операция МОЛЧИТ.

    Построчная отправка вместо on_commit проходит все счастливые тесты и
    рвётся только здесь — в проде она объявила бы строку, которую откат унёс,
    и клиент пошёл бы за ней в 404.

    Половина «ничего не пришло» сама по себе ничего не стоит (мёртвый сокет
    тоже молчит), поэтому тот же тест следом доказывает, что сокет жив.
    """
    communicator = socket(token=token_for(user))
    assert (await communicator.connect())[0] is True

    def _rolled_back():
        try:
            with transaction.atomic():
                notify(str(user.pk), KIND, DAY, payload=PAYLOAD)
                raise RuntimeError("деловая транзакция рвётся после notify")
        except RuntimeError:
            pass
        return OpsNotification.objects.count()

    assert await _island(_rolled_back) == 0
    assert await communicator.receive_nothing(timeout=0.5) is True

    def _committed():
        with transaction.atomic():
            notify(str(user.pk), KIND, date(2026, 6, 7), payload=PAYLOAD)

    await _island(_committed)
    alive = await communicator.receive_json_from(timeout=5)
    assert alive["payload"]["business_date"] == "2026-06-07"
    await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_only_the_addressed_recipient_receives_it(user, stranger):
    """Адресуется ОДНА группа — `group_name_for(notification.recipient)`.

    Все прочие тесты здесь подписываются КАК адресат и остались бы зелёными,
    даже раздавай отправитель во всеобщую группу: «моё пришло» ничего не
    говорит о том, кому оно пришло ЕЩЁ. Это единственная ошибка среза с ценой
    в конфиденциальность: уведомление называет отставшие подразделения и
    адресовано разрешённому ответственному.
    """
    mine = socket(token=token_for(user))
    theirs = socket(token=token_for(stranger))
    assert (await mine.connect())[0] is True
    assert (await theirs.connect())[0] is True

    def _work():
        with transaction.atomic():
            notify(str(user.pk), KIND, DAY, payload=PAYLOAD)

    await _island(_work)

    delivered = await mine.receive_json_from(timeout=5)
    assert delivered["payload"]["recipient"] == str(user.pk)
    # Второй сокет доказуемо жив (рукопожатие состоялось выше) и доказуемо
    # молчит — ценность именно в паре этих половин.
    assert await theirs.receive_nothing(timeout=0.5) is True
    await mine.disconnect()
    await theirs.disconnect()


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_padded_recipient_reaches_the_stripped_group(user):
    """notify() обрезает получателя по краям, и имя группы обязано следовать
    за ХРАНИМЫМ значением, а не за аргументом вызова.

    Адресуй `_publish` аргумент — все остальные тесты модуля остались бы
    зелёными (они передают уже чистую строку), а в проде это молчаливая
    потеря: `group_name_for("  7  ")` — вполне допустимое имя группы, которую
    никто не слушает.
    """
    communicator = socket(token=token_for(user))
    assert (await communicator.connect())[0] is True

    def _work():
        with transaction.atomic():
            notify(f"  {user.pk}  ", KIND, DAY, payload=PAYLOAD)

    await _island(_work)
    delivered = await communicator.receive_json_from(timeout=5)

    assert delivered["payload"]["recipient"] == str(user.pk)
    await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_inner_savepoint_rollback_discards_the_signal(user):
    """Обработчик следует за транзакцией, в которой зарегистрирован, — включая
    точки сохранения.

    В тесте отката выше не коммитится вообще ничего, и потерянный знак там
    переопределён. Прод устроен тоньше: догон зовёт notify() в подённой
    atomic, вложенной в прогон, и один день может откатиться к своей точке
    сохранения, пока прогон коммитится. Django выбрасывает обработчики,
    зарегистрированные после откатанной точки, — это и удерживает неудавшийся
    день от объявления строки, которой не стало.

    Успешный день в том же блоке несущий: он доказывает, что ВНЕШНЯЯ
    транзакция действительно легла, и «за неудавшийся день ничего не пришло»
    говорит о точке сохранения, а не о транзакции, которой не было.
    """
    communicator = socket(token=token_for(user))
    assert (await communicator.connect())[0] is True
    committed_day = date(2026, 6, 8)

    def _work():
        with transaction.atomic():  # прогон догона: коммитится
            try:
                with transaction.atomic():  # один день: откатывается
                    notify(str(user.pk), KIND, DAY, payload=PAYLOAD)
                    raise RuntimeError("этот день рвётся после notify")
            except RuntimeError:
                pass
            notify(str(user.pk), KIND, committed_day, payload=PAYLOAD)
        return sorted(
            OpsNotification.objects.values_list("business_date", flat=True)
        )

    assert await _island(_work) == [committed_day]
    arrived = await communicator.receive_json_from(timeout=5)
    assert arrived["payload"]["business_date"] == committed_day.isoformat()
    assert await communicator.receive_nothing(timeout=0.5) is True
    await communicator.disconnect()


# ── Знак отслеживает изменение состояния, а не вызов ─────────────────────


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_repeat_call_publishes_nothing(user):
    """Догон по устройству переспрашивает уже пройденные дни. Отправка на
    каждый вызов, а не на созданную строку, превратила бы один повтор в шквал
    дубликатов о строках, которые не менялись."""
    communicator = socket(token=token_for(user))
    assert (await communicator.connect())[0] is True

    def _work():
        with transaction.atomic():
            notify(str(user.pk), KIND, DAY, payload=PAYLOAD)
            notify(str(user.pk), KIND, DAY, payload={"проигнорирован": True})
        return OpsNotification.objects.count()

    assert await _island(_work) == 1
    assert (await communicator.receive_json_from(timeout=5))["type"] == KIND.value
    # Второй вызов был холостым в базе — значит обязан быть холостым и на
    # проводе.
    assert await communicator.receive_nothing(timeout=0.5) is True
    await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_repeat_call_in_a_separate_transaction_publishes_nothing(user):
    """Тот же инвариант в той форме, в какой его производит прод.

    Тест выше делает оба вызова в ОДНОЙ транзакции, где второй бьётся о
    строку, которую она же и написала: get_or_create читает своё
    незакоммиченное состояние. Догон делает другое — переспрашивает день,
    уведомление о котором закоммитил ПРЕДЫДУЩИЙ прогон, и `created` там
    приходит из строки, прочитанной обратно из базы. Флаг, проверенный лишь
    внутри одной транзакции, про этот путь ничего не доказал.
    """
    communicator = socket(token=token_for(user))
    assert (await communicator.connect())[0] is True

    def _work():
        with transaction.atomic():
            notify(str(user.pk), KIND, DAY, payload=PAYLOAD)
        # Полностью отдельная транзакция — перезапуск догона.
        with transaction.atomic():
            notify(str(user.pk), KIND, DAY, payload={"проигнорирован": True})
        return OpsNotification.objects.count()

    assert await _island(_work) == 1
    assert (await communicator.receive_json_from(timeout=5))["type"] == KIND.value
    assert await communicator.receive_nothing(timeout=0.5) is True
    await communicator.disconnect()


# ── Мёртвый слой не меняет в notify() ничего ─────────────────────────────


@pytest.mark.django_db
def test_channel_layer_failure_is_non_fatal(
    monkeypatch, django_capture_on_commit_callbacks
):
    """Ветка транзакции: обработчик идёт после коммита, вне `try` самого
    notify(), — потому у `_publish` и есть свой.

    Здесь фикстура ОБЯЗАТЕЛЬНА: тест идёт на главном потоке, чью транзакцию
    pytest-django никогда не коммитит, и без неё обработчик не исполнился бы
    вовсе — тест был бы вакуумным.

    Утверждаются оба следствия. Одного «не упало» мало: регресс, который
    реально читает догон, — это возврат None, из которого получается ошибка,
    откат дня и застрявший знак, то есть сбой ЗНАКА остановил бы деловой
    догон.
    """
    layer = _explode(monkeypatch)

    with django_capture_on_commit_callbacks(execute=True):
        with transaction.atomic():
            row = notify("7", KIND, DAY, payload=PAYLOAD)

    assert row is not None
    assert OpsNotification.objects.filter(
        recipient="7", kind=KIND, business_date=DAY
    ).exists()
    # Анти-вакуум: до слоя действительно дошли, и он действительно взорвался.
    assert layer.calls == 1


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_autocommit_layer_failure_is_non_fatal(monkeypatch):
    """Ветка autocommit — отдельный путь исполнения, больше ничем не покрытый.

    Без объемлющей atomic `transaction.on_commit` зовёт обработчик НЕМЕДЛЕННО
    и построчно, то есть внутри `try` самого notify(). Без гварда в `_publish`
    исключение проглотилось бы ТАМ, и notify() вернул бы None — тот же
    регресс, достигнутый с другой стороны.
    """
    layer = _explode(monkeypatch)

    def _work():
        row = notify("7", KIND, DAY, payload=PAYLOAD)
        return row, OpsNotification.objects.count(), layer.calls

    row, rows, calls = await _island(_work)

    assert row is not None
    assert rows == 1
    assert calls == 1


@pytest.mark.django_db
def test_publish_failure_is_logged(
    monkeypatch, caplog, django_capture_on_commit_callbacks
):
    """Сбой требуется не только проглотить, но и записать; тесты выше
    доказывают лишь глотание.

    Молча проглоченное исключение — это невидимая авария: доставка могла бы
    встать у всех разом, а гейт, вызывающий, база и все остальные тесты
    остались бы зелёными. Невидимость здесь по устройству, и журнал —
    единственное, что её вскрывает.
    """
    layer = _explode(monkeypatch)
    caplog.set_level(logging.ERROR, logger=NOTIFY_LOGGER)

    with django_capture_on_commit_callbacks(execute=True):
        with transaction.atomic():
            row = notify("7", KIND, DAY, payload=PAYLOAD)

    assert row is not None and layer.calls == 1
    records = [r for r in caplog.records if r.name == NOTIFY_LOGGER]
    assert len(records) == 1, records
    # `logger.exception`, а не `logger.error`: без следа стека оператор узнаёт
    # ЧТО сломалось и никогда — почему.
    assert records[0].exc_info is not None
    # Утверждается по `args`, а не по собранной строке: это те самые поля,
    # которые называет договор, и привязка к значениям не рвёт тест от
    # косметической переформулировки.
    assert "7" in records[0].args
    assert KIND in records[0].args
    assert DAY in records[0].args
    # Структурно и без ПДн: payload называет отставшие подразделения и в
    # строку журнала попасть не должен.
    assert "div-1" not in records[0].getMessage()


@pytest.mark.django_db
def test_missing_channel_layer_is_non_fatal(
    monkeypatch, django_capture_on_commit_callbacks
):
    """Ненастроенный CHANNEL_LAYERS отдаёт из `get_channel_layer()` None, и
    сбой случается на ПОЛУЧЕНИИ слоя: `None.group_send` даёт AttributeError
    ещё до попытки отправки.

    Отдельной ветки для этого срез не заводит, полагаясь на общий
    `except Exception`, — и вот тест, который держит это решение верным.
    Сужение except до транспортных ошибок (совершенно правдоподобная правка
    «не будем глотать настоящие ошибки») открывает ровно эту дыру, а
    AttributeError из обработчика коммита всплывает у вызывающего ПОСЛЕ того,
    как деловое изменение закоммичено.
    """
    monkeypatch.setattr(
        "organization_management.apps.operations.notify_service"
        ".get_channel_layer",
        lambda: None,
    )

    with django_capture_on_commit_callbacks(execute=True):
        with transaction.atomic():
            row = notify("7", KIND, DAY, payload=PAYLOAD)

    assert row is not None
    assert OpsNotification.objects.filter(
        recipient="7", kind=KIND, business_date=DAY
    ).exists()


# ── Конверт совпадает с лентой чтения и доезжает целым ───────────────────


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_ws_envelope_matches_read_api_projection(user):
    """ПОЛНОЕ равенство значений с проекцией ленты, а не совпадение ключей.

    Экран кладёт ряды из сокета в тот же кэш, что и ряды
    `GET /api/operations/notifications/`; расхождение в одном лишь формате
    момента сломало бы там порядок, а в ленте — курсор `?since=`, и сравнение
    наборов ключей осталось бы через это зелёным. Форматы расходятся, если не
    поправить: created_at хранится в UTC, а лента печатает в поясе проекта.

    Тест импортирует сериализатор намеренно — сервису этого нельзя (обратное
    направление слоёв), и, не импортируй его тест, договор не держало бы
    ничто.
    """
    communicator = socket(token=token_for(user))
    assert (await communicator.connect())[0] is True

    def _work():
        with transaction.atomic():
            row = notify(str(user.pk), KIND, DAY, payload=PAYLOAD)
        return OpsNotificationSerializer(row).data

    projection = await _island(_work)
    envelope = await communicator.receive_json_from(timeout=5)

    assert envelope["payload"] == projection
    await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_envelope_survives_serialisation_to_the_wire(user):
    """Слой → потребитель → `json.dumps` → провод.

    Потребитель гонит по конверту `json.dumps`, который рвётся на
    `date`/`datetime`, а на настоящем слое к этому добавляется msgpack у
    channels_redis (в тестах слой в памяти, и эту половину здесь не пройти —
    зато .isoformat() в `_publish` держат обе). Ни одна из стадий не
    существует там, где тест сравнивает словари в памяти.
    """
    communicator = socket(token=token_for(user))
    assert (await communicator.connect())[0] is True

    def _work():
        with transaction.atomic():
            notify(str(user.pk), KIND, DAY, payload=PAYLOAD)

    await _island(_work)
    payload = (await communicator.receive_json_from(timeout=5))["payload"]

    assert isinstance(payload["business_date"], str)
    assert isinstance(payload["created_at"], str)
    assert payload["business_date"] == DAY.isoformat()
    assert payload["read_at"] is None
    # Печатается в поясе проекта, как лента чтения, а не голым UTC.
    assert payload["created_at"].endswith("+05:00")
    await communicator.disconnect()
