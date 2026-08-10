"""WS-транспорт личной ленты: `/ws/operations/notifications/`.

Зона ответственности потребителя: кого пускают, в чью группу он попадает и
доезжает ли конверт дословно. ЧТО отправляется в группу — зона следующего
среза (публикация из notify()); что лежит в ленте — зона селектора.

Гоняется БЕЗ pytest-asyncio (его в проекте нет) и БЕЗ daphne: корутина теста
заводится через `async_to_sync`, а сокет драйвится своим тонким коммуникатором
поверх `asgiref.testing.ApplicationCommunicator`. Импорт чего угодно из
`channels.testing` исполняет его __init__, а тот безусловно тянет
`daphne.testing`, — ставить daphne (а с ним Twisted и три C-расширения) ради
одной строки импорта незачем.

`async_to_sync` здесь не деталь оформления: он исполняет thread-sensitive
островки (`database_sync_to_async` в рукопожатии) в ЭТОМ ЖЕ потоке, поэтому
проверка учётки видит данные тестовой транзакции.
"""
import functools
import json
import re
from datetime import timedelta
from urllib.parse import unquote, urlparse

import jwt
import pytest
from asgiref.sync import async_to_sync
from asgiref.testing import ApplicationCommunicator
from channels.layers import channel_layers, get_channel_layer
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import AccessToken

from organization_management.apps.operations.api.permissions import (
    resolve_actor_id as rest_resolve_actor_id,
)
from organization_management.apps.operations.ws_auth import (
    resolve_actor_id as ws_resolve_actor_id,
)
from organization_management.apps.operations.ws_groups import (
    NOTIFY_MESSAGE_TYPE,
    group_name_for,
)
from organization_management.config.asgi import application

User = get_user_model()

URL = "/ws/operations/notifications/"
REFUSED = 4403

# Имя группы, как его проверяет channels (BaseChannelLayer.valid_group_name) —
# то самое ограничение, ради которого получатель хэшируется.
GROUP_NAME_RE = r"^[a-zA-Z\d\-_.]+$"


class WsCommunicator(ApplicationCommunicator):
    """Минимальный драйвер WebSocket поверх asgiref.

    Переизобретены только `connect`/`receive_json_from`/`disconnect`;
    `receive_output`/`receive_nothing`/`wait` — от базового класса asgiref
    (asgiref и так жёсткая зависимость channels). Единственное, что обёртка
    channels добавляет сверху, — заглушка `close_old_connections`, а она здесь
    не нужна: в базу ходит рукопожатие, и ходит оно синхронным островком.
    """

    def __init__(self, application, path, headers=None):
        parsed = urlparse(path)
        scope = {
            "type": "websocket",
            "path": unquote(parsed.path),
            "query_string": parsed.query.encode("utf-8"),
            "headers": headers or [],
            "subprotocols": [],
        }
        super().__init__(application, scope)

    async def connect(self, timeout=1):
        """(True, subprotocol) — приняли; (False, код) — отказали."""
        await self.send_input({"type": "websocket.connect"})
        response = await self.receive_output(timeout)
        if response["type"] == "websocket.close":
            return (False, response.get("code", 1000))
        assert response["type"] == "websocket.accept", response
        return (True, response.get("subprotocol", None))

    async def receive_json_from(self, timeout=1):
        response = await self.receive_output(timeout)
        assert response["type"] == "websocket.send", response
        assert isinstance(response.get("text"), str), response
        return json.loads(response["text"])

    async def disconnect(self, code=1000, timeout=1):
        await self.send_input({"type": "websocket.disconnect", "code": code})
        await self.wait(timeout)


def ws_test(fn):
    """Тело теста — корутина; запускается своим циклом событий."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return async_to_sync(fn)(*args, **kwargs)

    return wrapper


@pytest.fixture(autouse=True)
def fresh_channel_layer():
    """Свой слой на тест: подписки предыдущего теста иначе переживают его и
    делают «не доехало» неотличимым от «доехало не туда»."""
    channel_layers.backends = {}
    yield
    channel_layers.backends = {}


def make_user(username="ws-actor", **kwargs):
    return User.objects.create_user(username=username, password="x", **kwargs)


def token_for(user):
    """Токен собирается из полей объекта, в базу не ходит — поэтому звать его
    из корутины теста можно, в отличие от посева."""
    return str(AccessToken.for_user(user))


# Посев — только фикстурами: ORM из корутины недоступен
# (SynchronousOnlyOperation), а тела тестов ниже — корутины.


@pytest.fixture
def user(transactional_db):
    return make_user()


@pytest.fixture
def stranger(transactional_db):
    return make_user("ws-stranger")


@pytest.fixture
def deactivated_token(user):
    token = token_for(user)
    User.objects.filter(pk=user.pk).update(is_active=False)
    return token


@pytest.fixture
def deleted_token(user):
    token = token_for(user)
    User.objects.filter(pk=user.pk).delete()
    return token


def socket(path=URL, token=None):
    if token is not None:
        path = f"{path}?token={token}"
    return WsCommunicator(application, path)


async def publish(recipient, message):
    """Отправка в группу получателя — ровно то, что будет делать notify()
    следующим срезом (и через ТУ ЖЕ функцию имени группы)."""
    await get_channel_layer().group_send(
        group_name_for(recipient), {"type": NOTIFY_MESSAGE_TYPE, "message": message}
    )


# ── Кого пускают ─────────────────────────────────────────────────────────


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_valid_token_is_accepted(user):
    communicator = socket(token=token_for(user))

    connected, _ = await communicator.connect()

    assert connected is True
    await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_handshake_without_token_is_refused_with_4403():
    """Отказ, а не «принять и молчать»: принятый сокет без права слушать
    неотличим для клиента от тишины, и он переподключался бы вечно."""
    communicator = socket()

    connected, code = await communicator.connect()

    assert connected is False
    assert code == REFUSED
    await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_garbage_token_is_refused():
    communicator = socket(token="definitely-not-a-token")

    connected, code = await communicator.connect()

    assert (connected, code) == (False, REFUSED)
    await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_expired_token_is_refused(user):
    expired = AccessToken.for_user(user)
    expired.set_exp(lifetime=timedelta(seconds=-10))
    communicator = socket(token=str(expired))

    connected, code = await communicator.connect()

    assert (connected, code) == (False, REFUSED)
    await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_token_signed_by_another_key_is_refused(user):
    """Форма верна, срок жив, user_id настоящий — чужая только подпись.
    Отклонить это может исключительно её проверка."""
    payload = jwt.decode(
        token_for(user), options={"verify_signature": False}, algorithms=["HS256"]
    )
    forged = jwt.encode(payload, "another-issuer-entirely-" + "9" * 40, "HS256")
    communicator = socket(token=forged)

    connected, code = await communicator.connect()

    assert (connected, code) == (False, REFUSED)
    await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_token_of_a_deactivated_user_is_refused(deactivated_token):
    """Расхождение с REST здесь стоило бы восьми часов (жизнь токена), в
    течение которых уволенному продолжала бы ехать лента, — при том что HTTP
    отказал бы ему сразу. Проверку делает та же `JWTAuthentication`."""
    communicator = socket(token=deactivated_token)

    connected, code = await communicator.connect()

    assert (connected, code) == (False, REFUSED)
    await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_token_of_a_deleted_user_is_refused(deleted_token):
    communicator = socket(token=deleted_token)

    connected, code = await communicator.connect()

    assert (connected, code) == (False, REFUSED)
    await communicator.disconnect()


# ── В чью группу попадают ────────────────────────────────────────────────


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_message_reaches_the_socket_verbatim(user):
    """Конверт ретранслируется дословно: потребитель не знает видов
    уведомлений и ничего в конверте не пересобирает."""
    communicator = socket(token=token_for(user))
    connected, _ = await communicator.connect()
    assert connected is True
    envelope = {
        "type": "SUBMISSION_LAGGING",
        "payload": {
            "id": 7,
            "read_at": None,
            "late": False,
            "laggard_division_ids": [1, 2],
        },
    }

    await publish(str(user.pk), envelope)

    assert await communicator.receive_json_from() == envelope
    await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_message_for_another_recipient_does_not_leak(user, stranger):
    """Анти-вакуум: «ничего не пришло» зелено и на мёртвом сокете, поэтому
    тот же сокет следом получает СВОЁ."""
    communicator = socket(token=token_for(user))
    connected, _ = await communicator.connect()
    assert connected is True
    own = {"type": "SUBMISSION_LAGGING", "payload": {"for": "me"}}

    await publish(str(stranger.pk), {"type": "SUBMISSION_LAGGING", "payload": {}})
    assert await communicator.receive_nothing(timeout=0.3) is True

    await publish(str(user.pk), own)
    assert await communicator.receive_json_from() == own
    await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_group_follows_the_token_not_the_client_supplied_identity(
    user, stranger
):
    """Соединение здесь ЗАКОННО принимают (токен настоящий) — вопрос в том, в
    чью группу оно попало, и отвечает на него только доставка. Клиент при этом
    кричит чужой идентичностью во все параметры, какими распоряжается."""
    path = f"{URL}?token={token_for(user)}&user_id={stranger.pk}&recipient={stranger.pk}"
    communicator = WsCommunicator(application, path)
    connected, _ = await communicator.connect()
    assert connected is True
    own = {"type": "SUBMISSION_LAGGING", "payload": {"for": "me"}}

    await publish(str(stranger.pk), {"type": "SUBMISSION_LAGGING", "payload": {}})
    assert await communicator.receive_nothing(timeout=0.3) is True

    await publish(str(user.pk), own)
    assert await communicator.receive_json_from() == own
    await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_disconnected_socket_leaves_its_group(user):
    """Без group_discard слой копил бы мёртвые каналы группы на каждое
    переподключение клиента."""
    communicator = socket(token=token_for(user))
    connected, _ = await communicator.connect()
    assert connected is True
    layer = get_channel_layer()
    group = group_name_for(str(user.pk))
    assert layer.groups.get(group)

    await communicator.disconnect()

    assert not layer.groups.get(group)


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_inbound_frames_are_ignored_and_the_socket_survives_them(user):
    """Клиент только слушает, поэтому кадры снаружи не разбираются. Кадр,
    уронивший бы потребителя, порвал бы сокет — доставка следом это исключает."""
    communicator = socket(token=token_for(user))
    connected, _ = await communicator.connect()
    assert connected is True
    own = {"type": "SUBMISSION_LAGGING", "payload": {"after": "garbage"}}

    await communicator.send_input({"type": "websocket.receive", "text": "not json{{"})
    await communicator.send_input(
        {"type": "websocket.receive", "bytes": b"\x00\x01"}
    )
    assert await communicator.receive_nothing(timeout=0.3) is True

    await publish(str(user.pk), own)
    assert await communicator.receive_json_from() == own
    await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_refused_handshake_survives_disconnect():
    """У отклонённого рукопожатия группы не было: `self.group` здесь ещё не
    существует, и обращение к нему в disconnect() дало бы AttributeError на
    каждый отказ."""
    communicator = socket()
    connected, _ = await communicator.connect()
    assert connected is False

    await communicator.disconnect()


# ── Адрес доставки ───────────────────────────────────────────────────────


@pytest.mark.django_db
def test_ws_actor_id_matches_the_rest_one(rf, user):
    """Идентичность сокета и HTTP-ленты — одна и та же строка.

    Разойдись они (скажем, WS взял бы `sub`, а REST — `str(User.pk)`), это не
    упало бы нигде: уведомления писались бы одному адресу, а сокет слушал
    другой, и наружу это вышло бы тишиной в ленте.
    """
    scope = {"type": "websocket", "query_string": f"token={token_for(user)}".encode()}

    request = rf.get("/api/operations/notifications/")
    request.user = user

    assert ws_resolve_actor_id(scope) == rest_resolve_actor_id(request) == str(user.pk)


@pytest.mark.django_db
def test_ws_actor_id_is_none_without_token():
    assert ws_resolve_actor_id({"type": "websocket", "query_string": b""}) is None


# ── Имя группы ───────────────────────────────────────────────────────────


def test_group_name_is_deterministic():
    assert group_name_for("42") == group_name_for("42")


@pytest.mark.parametrize(
    "recipient",
    ["42", "op-1@example.com", "urn:actor:42", "Иванов.И.И", " padded ", "x" * 100],
)
def test_group_name_is_valid_for_hostile_ids(recipient):
    name = group_name_for(recipient)

    assert re.match(GROUP_NAME_RE, name), name
    assert len(name) <= 100


def test_group_names_differ_for_different_recipients():
    assert group_name_for("42") != group_name_for("43")


def test_group_name_rejects_blank_recipient():
    with pytest.raises(ValueError):
        group_name_for("   ")


def test_group_name_ignores_surrounding_whitespace():
    """notify() обрезает получателя при записи; разойдись обрезка здесь —
    писали бы одному адресу, а слушали другой, и это была бы тишина, не
    ошибка."""
    assert group_name_for(" 42 ") == group_name_for("42")


# ── Соседний сокет ───────────────────────────────────────────────────────


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_old_notifications_socket_is_not_hijacked(user):
    """`/ws/notifications/` остаётся за старым проектом.

    У него своя идентичность (сессия) и свои группы `user_<pk>`; перехвати
    раздел этот путь, старые экраны молча перестали бы получать свои
    уведомления. Аноним не нужен и ему — но закрывает он БЕЗ нашего 4403, и
    токен раздела для него ничего не значит.

    disconnect() здесь НЕ зовётся намеренно: у старого потребителя отказанное
    рукопожатие роняет `disconnect` (AttributeError на `self.user_group`,
    consumers.py:20) — дефект, существующий до переезда, и чинить его здесь
    было бы правкой чужого сокета. Свой потребитель от этой ошибки закрыт
    отдельным тестом выше.
    """
    communicator = WsCommunicator(
        application, f"/ws/notifications/?token={token_for(user)}"
    )

    connected, code = await communicator.connect()

    assert connected is False
    assert code != REFUSED
