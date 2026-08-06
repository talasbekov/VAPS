"""Личная лента уведомлений: чей ответ, что новее и в каком порядке.

Проверяется не «выбирает строки» — это делает ORM, — а три несущих правила
селектора: безусловная область видимости по получателю, СТРОГИЙ курсор и
полный порядок с разрывом ничьей. Плюс громкий отказ на пустом получателе:
несущий фильтр не имеет права молча вырождаться в пустую выдачу.
"""
from datetime import date, datetime, timedelta, timezone

import pytest

from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.operations.selectors import OpsNotificationSelector

pytestmark = pytest.mark.django_db

DAY = date(2026, 8, 5)
T0 = datetime(2026, 8, 5, 12, 0, tzinfo=timezone.utc)


def make(recipient, *, day=DAY, created_at=None):
    """Уведомление с УПРАВЛЯЕМЫМ created_at.

    created_at — auto_now_add, поэтому время проставляется вторым проходом
    через update(): порядок ленты иначе нечем задать, а именно он и проверяется.
    """
    row = OpsNotification.objects.create(
        recipient=recipient,
        kind=OpsNotification.Kind.SUBMISSION_LAGGING,
        business_date=day,
    )
    if created_at is not None:
        OpsNotification.objects.filter(pk=row.pk).update(created_at=created_at)
        row.refresh_from_db()
    return row


# ── Область видимости ────────────────────────────────────────────────────


def test_the_feed_holds_only_the_callers_own_rows():
    mine = make("7")
    make("8", day=DAY - timedelta(days=1))

    assert list(OpsNotificationSelector.list("7")) == [mine]


def test_another_recipients_row_is_unreachable_even_when_it_is_the_only_one():
    """Чужую строку отсюда не достать: фильтр по получателю БЕЗУСЛОВЕН.

    Это и есть разграничение доступа — не «не выдаётся без права», а нет
    запроса, который её вернёт. Проба со ВСЕЙ таблицей из чужих строк ловит
    фильтр, наложенный «только когда что-то своё уже нашлось».
    """
    make("8")

    assert list(OpsNotificationSelector.list("7")) == []


def test_the_recipient_is_trimmed_the_same_way_notify_trims_it():
    """«7 » и «7» — один человек на обоих концах.

    notify() обрезает получателя при записи. Не обрезать при чтении значило бы,
    что писали одному, а читает другой, — и лента вернулась бы пустой, а пустота
    неотличима от «уведомлений нет».
    """
    mine = make("7")

    assert list(OpsNotificationSelector.list(" 7 ")) == [mine]


# ── Курсор ───────────────────────────────────────────────────────────────


def test_since_is_a_strict_lower_bound():
    """Строка, ЛЕЖАЩАЯ на границе, второй раз не приходит.

    Курсор опроса ставится по времени последней виденной строки. Нестрогая
    граница возвращала бы её при каждом опросе, и экран показывал бы одно и то
    же уведомление как новое снова и снова.
    """
    seen = make("7", created_at=T0)
    fresh = make("7", day=DAY - timedelta(days=1), created_at=T0 + timedelta(minutes=1))

    rows = list(OpsNotificationSelector.list("7", since=seen.created_at))

    assert rows == [fresh]


def test_without_since_nothing_is_cut_off():
    old = make("7", created_at=T0 - timedelta(days=30))

    assert list(OpsNotificationSelector.list("7")) == [old]


def test_the_cursor_does_not_leak_past_the_recipient_filter():
    """Курсор сужает СВОЮ ленту, а не открывает чужую."""
    make("8", created_at=T0 + timedelta(minutes=5))
    mine = make("7", created_at=T0 + timedelta(minutes=1))

    assert list(OpsNotificationSelector.list("7", since=T0)) == [mine]


# ── Порядок ──────────────────────────────────────────────────────────────


def test_the_newest_comes_first():
    old = make("7", day=DAY - timedelta(days=2), created_at=T0)
    middle = make("7", day=DAY - timedelta(days=1), created_at=T0 + timedelta(hours=1))
    newest = make("7", day=DAY, created_at=T0 + timedelta(hours=2))

    # Три строки, и посев НЕ совпадает с итоговым порядком: на двух и на
    # «уже отсортированной» фикстуре ассерт прошёл бы и без сортировки вовсе.
    assert list(OpsNotificationSelector.list("7")) == [newest, middle, old]


def test_rows_sharing_a_timestamp_are_broken_by_id():
    """Равное время — обычное дело, а не край.

    Догон рассылает всех отставших дня одним проходом, и строки ложатся с
    одинаковым created_at. Без второго ключа страничная выдача теряла бы и
    дублировала их между страницами.

    Сам по себе этот ассерт разрыв ничьей НЕ удерживает — проба показала, что
    со снятым вторым ключом он остаётся зелёным: planner берёт индекс ленты
    (recipient, -created_at, id), и порядок по id даёт индекс, а не запрос.
    Настоящий гвард — буквальный пин ключей ниже; здесь проверяется, что
    равновременные строки вообще выходят в осмысленном порядке.
    """
    first = make("7", day=DAY, created_at=T0)
    second = make("7", day=DAY - timedelta(days=1), created_at=T0)
    third = make("7", day=DAY - timedelta(days=2), created_at=T0)

    assert list(OpsNotificationSelector.list("7")) == [first, second, third]


def test_the_ordering_is_pinned_literally():
    """Порядок пинится буквально: поведенческая проба его не удержит.

    Часть перестановок ключей даёт ту же выдачу на любой конкретной фикстуре —
    расхождение вылезет на странице у живого читателя, а не в тесте.
    Разойтись с индексом ленты (recipient, -created_at, id) нельзя ещё и
    поэтому: база начала бы пересортировывать каждую страницу.
    """
    assert OpsNotificationSelector.list("7").query.order_by == ("-created_at", "id")


# ── Отказ ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("bad", ["", "   ", None, 7])
def test_a_blank_actor_is_refused_rather_than_returning_an_empty_feed(bad):
    """Пустая выдача выдала бы сбой несущего фильтра за законный ответ.

    Целое 7 отвергается наравне с пустой строкой: получатель хранится СТРОКОЙ,
    и сравнение с целым молча не нашло бы ничего.
    """
    make("7")

    with pytest.raises(ValueError, match="получателя"):
        OpsNotificationSelector.list(bad)
