"""Выключатель WS раздела: `settings.OPS_WS_ENABLED`.

Гасится ТОЛЬКО знак. Строка уведомления пишется, возвращается вызывающему и
читается лентой при любом положении выключателя — иначе выключатель
инфраструктуры останавливал бы деловые операции, ради устойчивости которых он
и заведён.

Две половины держатся разными тестами: потребитель (кого и как закрывают) и
`_publish` (до чего не доходят). Сюда же — доказательство, что выключатель не
дотягивается до ленты чтения: она и есть запасной путь, ради которого сокет
можно гасить.
"""
from datetime import date, timedelta

import pytest
from django.conf import settings
from django.db import transaction
from django.test import override_settings
from rest_framework.test import APIClient

from organization_management.apps.operations.models_notification import (
    OpsNotification,
)
from organization_management.apps.operations.notify_service import notify
from organization_management.apps.operations.ws_consumers import (
    CLOSE_UNAUTHENTICATED,
    CLOSE_WS_DISABLED,
)

# Оснастка сокета — та же, что у транспорта и у публикации.
from organization_management.apps.operations.tests.test_ws_consumer import (  # noqa: F401
    URL,
    fresh_channel_layer,
    make_user,
    socket,
    token_for,
    ws_test,
)

DAY = date(2026, 6, 5)
KIND = OpsNotification.Kind.SUBMISSION_LAGGING
PAYLOAD = {"laggard_division_ids": ["div-1"]}


@pytest.fixture
def user(transactional_db):
    return make_user("ws-switch-actor")


class _RecordingChannelLayer:
    """Слой, который всё запоминает и ничего не делает."""

    def __init__(self):
        self.sends = []

    async def group_send(self, group, message):
        self.sends.append((group, message))


class _CountingAcquisition:
    """Считает ПОЛУЧЕНИЯ слоя, а не отправки.

    Выключатель обязан не доходить до `get_channel_layer()` вовсе — соединение
    к Redis открывается уже там. Поэтому подменяется сама функция получения, а
    возвращаемый ею слой нарочно негодный: дойди до него исполнение — сорвётся
    отправка, а не тихо пройдёт.
    """

    def __init__(self):
        self.calls = 0

    def __call__(self):
        self.calls += 1
        raise RuntimeError("слой не должен был понадобиться")


# ── Сам флаг ─────────────────────────────────────────────────────────────


def test_the_flag_defaults_to_enabled_and_is_a_real_bool():
    """Дефолт задаёт состояние ВСЕЙ WS-сюиты, поэтому пришпилен прямо.

    Прогон не экспортирует OPS_WS_ENABLED, и дефолт в настройках — единственное,
    что решает, идут ли тесты сокета против живого соединения. Дефолт «0» не
    «обелил» бы сюиту, а покрасил её в другом месте (закрытый сразу после
    accept сокет шлёт websocket.close там, где тесты доставки ждут
    websocket.send), и причину пришлось бы искать по следам.

    `is True`, а не проверка на истинность, — вторая половина теста: сними
    сравнение с «1», и в настройке останется СТРОКА, которая истинна и для
    «0», то есть выключатель молча перестанет выключать. Ловит это только
    тождество True.
    """
    assert settings.OPS_WS_ENABLED is True


# ── Потребитель ──────────────────────────────────────────────────────────


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_ws_disabled_accepts_then_closes_with_the_disabled_code(user):
    """Сначала ПРИНЯТЬ, потом закрыть — иначе код до клиента не доедет.

    Закрытие ДО accept по ASGI даёт HTTP 403, браузер видит 1006/не чисто, и
    выключенный сокет становится неотличим от мёртвой сети: клиент отступал бы
    вечно вместо того, чтобы перейти на опрос ленты.
    """
    communicator = socket(token=token_for(user))

    with override_settings(OPS_WS_ENABLED=False):
        connected, _ = await communicator.connect()
        # Рукопожатие СОСТОЯЛОСЬ — и следом приходит честный кадр закрытия.
        assert connected is True
        closed = await communicator.receive_output(timeout=1)

    assert closed["type"] == "websocket.close"
    assert closed["code"] == CLOSE_WS_DISABLED
    await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_ws_enabled_still_accepts_and_stays_open(user):
    """Анти-вакуум к тесту выше: при включённом флаге сокет принят И живёт —
    ни одного кадра закрытия следом."""
    communicator = socket(token=token_for(user))

    connected, _ = await communicator.connect()

    assert connected is True
    assert await communicator.receive_nothing(timeout=0.5) is True
    await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_ws_disabled_never_joins_a_group(user):
    """Выключенный сокет не должен даже подписываться: подписка — это уже
    поход в канальный слой, ровно та инфраструктура, которую гасят.

    «Ничего не пришло» на закрытом сокете само по себе НИЧЕГО не значит — он и
    так закрыт. Значение придаёт контроль: ТОТ ЖЕ получатель, ТА ЖЕ посылка, но
    при включённом флаге — доезжает. Без второй половины тест остался бы
    зелёным и на потребителе, который подписывается всегда.
    """
    from channels.layers import get_channel_layer

    from organization_management.apps.operations.ws_groups import (
        NOTIFY_MESSAGE_TYPE,
        group_name_for,
    )

    message = {"type": KIND, "payload": {"for": "me"}}

    async def _send():
        await get_channel_layer().group_send(
            group_name_for(str(user.pk)),
            {"type": NOTIFY_MESSAGE_TYPE, "message": message},
        )

    off = socket(token=token_for(user))
    with override_settings(OPS_WS_ENABLED=False):
        assert (await off.connect())[0] is True
        await off.receive_output(timeout=1)  # кадр закрытия
        await _send()
        assert await off.receive_nothing(timeout=0.5) is True
    await off.disconnect()

    on = socket(token=token_for(user))
    assert (await on.connect())[0] is True
    await _send()
    assert await on.receive_json_from(timeout=1) == message
    await on.disconnect()


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_disabled_socket_disconnects_without_error(user):
    """У выключенного сокета группы не было, и разрыв не должен спотыкаться о
    её отсутствие: `getattr` в disconnect держит это и для отказа, и для
    выключателя."""
    communicator = socket(token=token_for(user))

    with override_settings(OPS_WS_ENABLED=False):
        assert (await communicator.connect())[0] is True
        await communicator.receive_output(timeout=1)
        await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@ws_test
async def test_anonymous_is_still_refused_before_accept_when_ws_disabled():
    """Порядок проверок: ИДЕНТИЧНОСТЬ, потом флаг.

    Поставь дешёвую проверку флага первой — и выключенный WS начал бы
    ПРИНИМАТЬ соединения от неаутентифицированных, то есть выключатель стал бы
    дырой в разграничении доступа. Здесь это видно по коду и по тому, что
    рукопожатие не состоялось вовсе.
    """
    communicator = socket()

    with override_settings(OPS_WS_ENABLED=False):
        connected, code = await communicator.connect()

    assert (connected, code) == (False, CLOSE_UNAUTHENTICATED)
    await communicator.disconnect()


# ── Публикация ───────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_disabled_flag_writes_the_row_and_publishes_nothing(
    monkeypatch, django_capture_on_commit_callbacks
):
    """Строка всегда, знак никогда — одной различающей парой.

    Две половины берут РАЗНЫЕ деловые дни: ключ «одно на день» сделал бы
    повтор холостым сам по себе, и «ничего не отправлено» было бы верно по
    причине, к выключателю отношения не имеющей.
    """
    layer = _RecordingChannelLayer()
    monkeypatch.setattr(
        "organization_management.apps.operations.notify_service"
        ".get_channel_layer",
        lambda: layer,
    )

    with override_settings(OPS_WS_ENABLED=False):
        with django_capture_on_commit_callbacks(execute=True):
            with transaction.atomic():
                off_row = notify("7", KIND, DAY, payload=PAYLOAD)
    assert off_row is not None
    assert OpsNotification.objects.filter(pk=off_row.pk).exists()
    assert layer.sends == [], "выключенный знак не должен отправлять ничего"

    with override_settings(OPS_WS_ENABLED=True):
        with django_capture_on_commit_callbacks(execute=True):
            with transaction.atomic():
                on_row = notify("7", KIND, DAY + timedelta(days=1), payload=PAYLOAD)
    assert on_row is not None
    assert len(layer.sends) == 1, "включённый — ровно один раз"


@pytest.mark.django_db
def test_disabled_flag_does_not_acquire_the_channel_layer(
    monkeypatch, django_capture_on_commit_callbacks
):
    """Гвард стоит ДО `get_channel_layer()`, а не внутри try.

    Смысл выключателя — не трогать рисковую инфраструктуру вовсе, а не
    аккуратно проглотить её сбой: глотать `_publish` и так умеет, поэтому «не
    упало» тут не доказывает ничего. Соединение к Redis открывается на
    получении слоя — значит и считать надо получения.
    """
    acquisition = _CountingAcquisition()
    monkeypatch.setattr(
        "organization_management.apps.operations.notify_service"
        ".get_channel_layer",
        acquisition,
    )

    with override_settings(OPS_WS_ENABLED=False):
        with django_capture_on_commit_callbacks(execute=True):
            with transaction.atomic():
                notify("7", KIND, DAY, payload=PAYLOAD)
    assert acquisition.calls == 0, "выключенный не должен доходить до Redis"

    # Контроль: при включённом флаге до той же подставки ДОХОДЯТ (а её
    # RuntimeError глотает `_publish`, как и велит договор побочного канала).
    with override_settings(OPS_WS_ENABLED=True):
        with django_capture_on_commit_callbacks(execute=True):
            with transaction.atomic():
                notify("7", KIND, DAY + timedelta(days=1), payload=PAYLOAD)
    assert acquisition.calls == 1, "анти-вакуум: включённый путь слой берёт"


@pytest.mark.django_db
def test_notify_still_returns_the_row_when_ws_is_disabled(
    django_capture_on_commit_callbacks,
):
    """Возврат notify() выключателем не затронут.

    Это не украшение: догон читает возврат и на None откатывает день и держит
    водяной знак. Верни выключенный знак None — и снятый сокет остановил бы
    деловой догон, то есть выключатель ломал бы ровно то, ради устойчивости
    чего его вводят.
    """
    with override_settings(OPS_WS_ENABLED=False):
        with django_capture_on_commit_callbacks(execute=True):
            with transaction.atomic():
                row = notify("7", KIND, DAY, payload=PAYLOAD)

    assert row is not None
    assert row.pk is not None


# ── Лента чтения — запасной путь ─────────────────────────────────────────


@pytest.mark.django_db
def test_a_notification_emitted_with_ws_off_is_served_by_the_read_api(
    django_capture_on_commit_callbacks,
):
    """Смысл всей затеи: погасив сокет, получатель по-прежнему УЗНАЁТ.

    Без этого теста «строка записана» доказывало бы только состояние базы, а
    обещание выключателя — что человек увидит уведомление другим путём.
    """
    actor = make_user("ws-switch-reader")

    with override_settings(OPS_WS_ENABLED=False):
        with django_capture_on_commit_callbacks(execute=True):
            with transaction.atomic():
                notify(str(actor.pk), KIND, DAY, payload=PAYLOAD)

        client = APIClient()
        client.force_authenticate(user=actor)
        response = client.get("/api/operations/notifications/")

    assert response.status_code == 200
    kinds = [row["kind"] for row in response.data["results"]]
    assert kinds == [KIND]
