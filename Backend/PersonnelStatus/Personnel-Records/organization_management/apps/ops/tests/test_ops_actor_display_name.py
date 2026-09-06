"""Подпись актора для экрана принимает и объект учётки, и её идентификатор.

🔴 ЧТО СТЕРЕЖЁТ (Plane №484). Докстрока `actor_display_name` обещала
ИДЕНТИФИКАТОР: внутри делался `str(actor)`, проверялся `.isdigit()` и только
тогда шёл поиск `User → Employee`. А вьюхи передают `actor=request.user` —
объект, и это ОБЩАЯ их конвенция, больше десятка мест. `str(User)` даёт
username, `.isdigit()` ложь, и функция возвращала username как есть.

Куда это попадало: поле «кем создана версия» документа «Расстановка сил» —
того самого, который подписывают и рассылают. В нём стояло `admin` вместо
фамилии. Ровно та болезнь, от которой докстрока и защищает («в реестре ОМ
такой id оказывался и в Ответственном»), только с другого конца.

Чинилось в ФУНКЦИИ, а не в двенадцати вызовах: с конвенцией вьюх разошлась
она, а не они.
"""
import pytest

from organization_management.apps.ops.security_events import actor_display_name

pytestmark = pytest.mark.django_db


@pytest.fixture
def linked(django_user_model):
    """Учётка С кадровой записью за ней — та, у которой есть ФИО."""
    from organization_management.apps.employees.models import Employee

    user = django_user_model.objects.create_user(username="adn-admin", password="x")
    employee = Employee.objects.create(
        first_name="Пётр", last_name="Ниязов", user=user
    )
    return user, employee


def test_the_user_object_gives_the_full_name_not_the_login(linked):
    """Красная на мутации «убрать ветку isinstance»: вернётся `adn-admin`."""
    user, _employee = linked

    assert actor_display_name(user) == "Ниязов П."


def test_the_identifier_still_works(linked):
    """Прежний вход не сломан: `resolve_actor_id` отдаёт id, и он в ходу."""
    user, _employee = linked

    assert actor_display_name(str(user.pk)) == "Ниязов П."
    assert actor_display_name(user.pk) == "Ниязов П."


def test_an_account_without_a_personnel_record_falls_back_to_the_login(
    django_user_model,
):
    """Учётка без кадровой привязки — ШТАТНЫЙ исход, а не сбой: сид связь не
    заполняет. И для объекта, и для идентификатора ответ один."""
    user = django_user_model.objects.create_user(username="adn-bare", password="x")

    assert actor_display_name(user) == "adn-bare"
    assert actor_display_name(str(user.pk)) == "adn-bare"


def test_nobody_is_an_empty_string_not_the_word_none():
    assert actor_display_name(None) == ""


def test_an_anonymous_visitor_is_empty_not_the_word_anonymoususer():
    """Аноним не подписывает документ словом «AnonymousUser» (Plane №897).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. `AnonymousUser` — отдельный класс, `isinstance(actor,
    User)` его не ловит; дальше идёт `str(actor)`, `.isdigit()` ложь, и строка
    уходила в поле КАК ЕСТЬ. Гарды вызывающих проверяют `actor is not None` и
    от этого не защищают: аноним не `None`, он истинный объект.

    Практически недостижимо — ручки закрыты правами, — но проверяется не
    достижимость, а ЦЕНА: «AnonymousUser» встало бы в подпись документа,
    который печатают и рассылают. Пусто честнее: пустое поле читается как
    «автор не назван», выдуманное слово — как факт.

    КРАСНАЯ ПРОБА: убери ветку `is_authenticated` — вернётся «AnonymousUser».
    """
    from django.contrib.auth.models import AnonymousUser

    assert actor_display_name(AnonymousUser()) == ""
