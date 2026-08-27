"""Своя учётная запись: /api/user/profile/ и /api/user/change-password/.

ЗАЧЕМ ЭТА ПОВЕРХНОСТЬ ОТДЕЛЬНО ОТ АДМИНСКОЙ. Рядом живёт
/api/operations/accounts/, и там всё закрыто правом admin.roles: администратор
заводит учётки и СБРАСЫВАЕТ чужие пароли, получая временный в ответе. Своя
смена — другое действие с другими правилами: право на неё имеет любой
вошедший, но только на себя, подтверждается она текущим паролем, и никакого
пароля в ответе нет вовсе. Слить их в одну ручку значило бы либо открыть
чужие учётки всем, либо запретить человеку менять собственный пароль без
администратора.

Адрес /api/user/ — тот, по которому уже стучится диалог «Редактировать
профиль» в шапке (features/edit-profile). До этой правки его не существовало:
обе кнопки диалога получали 404 (Plane №180, №181).
"""
import pytest
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.test import override_settings
from rest_framework.test import APIClient

from organization_management.apps.operations.models_audit import OpsAuditLog

PROFILE_URL = "/api/user/profile/"
PASSWORD_URL = "/api/user/change-password/"

# Пароль, который проходит валидаторы Django (длина, не из словаря, не только
# цифры, не похож на логин).
GOOD_PASSWORD = "Тжр7-каспий-берег"
OLD_PASSWORD = "Свх4-алатау-склон"


def logged_in(username="ivanov", password=OLD_PASSWORD, **extra):
    user = User.objects.create_user(username=username, password=password, **extra)
    api = APIClient()
    api.force_authenticate(user)
    return api, user


def audit_dump():
    """Весь журнал одной строкой — чтобы искать в нём то, чего там быть не должно."""
    return " ".join(
        f"{e.action} {e.old_value} {e.new_value} {e.reason}"
        for e in OpsAuditLog.objects.all()
    )


# ── Смена своего пароля ──────────────────────────────────────────────────────


@pytest.mark.django_db
def test_change_password_replaces_the_old_one():
    api, user = logged_in()

    response = api.post(
        PASSWORD_URL,
        {"current_password": OLD_PASSWORD, "new_password": GOOD_PASSWORD},
        format="json",
    )

    assert response.status_code == 200, response.content
    assert authenticate(username=user.username, password=GOOD_PASSWORD) is not None
    # Старый пароль перестал работать — иначе смена не смена.
    assert authenticate(username=user.username, password=OLD_PASSWORD) is None


@pytest.mark.django_db
def test_change_password_leaves_a_trace_without_the_password_itself():
    """Факт смены в журнале есть, пароля в нём нет НИ В КАКОМ виде.

    Ровно то же правило, что у админского сброса: ленту читают все, кто держит
    право на журнал, и пароль в ней отменил бы смысл смены.
    """
    api, user = logged_in()

    api.post(
        PASSWORD_URL,
        {"current_password": OLD_PASSWORD, "new_password": GOOD_PASSWORD},
        format="json",
    )

    entry = OpsAuditLog.objects.get(action="ACCESS_ACCOUNT_PASSWORD_CHANGED")
    assert entry.entity_id == user.pk
    # Актор — сам человек, а не администратор: по этому полю и отличают
    # самостоятельную смену от сброса.
    assert entry.actor_user_id == str(user.pk)
    dump = audit_dump()
    assert GOOD_PASSWORD not in dump
    assert OLD_PASSWORD not in dump


@pytest.mark.django_db
def test_change_password_rejects_a_wrong_current_password():
    api, user = logged_in()

    response = api.post(
        PASSWORD_URL,
        {"current_password": "не-тот-пароль", "new_password": GOOD_PASSWORD},
        format="json",
    )

    assert response.status_code == 400
    # Пароль остался прежним — отказ должен быть отказом, а не тихой сменой.
    assert authenticate(username=user.username, password=OLD_PASSWORD) is not None
    assert authenticate(username=user.username, password=GOOD_PASSWORD) is None
    # Неудачная попытка следа смены не оставляет: иначе лента врала бы о том,
    # что пароль менялся.
    assert not OpsAuditLog.objects.filter(
        action="ACCESS_ACCOUNT_PASSWORD_CHANGED"
    ).exists()


@pytest.mark.django_db
def test_change_password_refuses_a_weak_new_password_in_russian():
    """Слабый пароль отбивается сервером, а не только формой.

    Клиент проверяет лишь длину ≥ 8, и «12345678» его проходит. Сообщение
    приходит по-русски: его показывают человеку как есть.
    """
    api, user = logged_in()

    response = api.post(
        PASSWORD_URL,
        {"current_password": OLD_PASSWORD, "new_password": "12345678"},
        format="json",
    )

    assert response.status_code == 400
    body = response.json()
    assert "new_password" in body
    text = " ".join(body["new_password"])
    assert "пароль" in text.lower(), text
    assert authenticate(username=user.username, password=OLD_PASSWORD) is not None


@pytest.mark.django_db
def test_change_password_is_closed_to_anonymous():
    response = APIClient().post(
        PASSWORD_URL,
        {"current_password": OLD_PASSWORD, "new_password": GOOD_PASSWORD},
        format="json",
    )

    assert response.status_code in (401, 403)


@pytest.mark.django_db
def test_change_password_touches_only_the_caller():
    """Чужую учётку через эту ручку не достать — параметра адресата в ней нет.

    Проба стережёт именно это: попытка передать чужой идентификатор в теле не
    должна ни менять чужой пароль, ни приниматься молча.
    """
    api, caller = logged_in("ivanov")
    other = User.objects.create_user(username="petrov", password=OLD_PASSWORD)

    api.post(
        PASSWORD_URL,
        {
            "current_password": OLD_PASSWORD,
            "new_password": GOOD_PASSWORD,
            "user_id": other.pk,
            "username": other.username,
        },
        format="json",
    )

    other.refresh_from_db()
    assert authenticate(username="petrov", password=OLD_PASSWORD) is not None
    assert authenticate(username="petrov", password=GOOD_PASSWORD) is None


@pytest.mark.django_db
@override_settings(
    # В тестовых настройках кэш — DummyCache, а счётчик частоты живёт именно в
    # кэше: под ним ограничение молча не работает вовсе и проба всегда была бы
    # зелёной. Здесь подставляется настоящий кэш — тот же locmem, что стоит на
    # стенде (`settings/sqlite.py`).
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
)
def test_change_password_stops_answering_after_a_run_of_attempts():
    """Перебор текущего пароля упирается в ограничение частоты.

    Ручка честно отвечает, подошёл ли текущий пароль, — то есть без
    ограничения она оракул для того, кто уже сидит в чужой сессии. Ставка
    задана областью `change-password`; проба стережёт, что область
    действительно подключена, а не только объявлена в настройках.
    """
    from django.core.cache import cache

    # Счётчик частоты переживает соседние пробы: без сброса результат зависел
    # бы от порядка прогона.
    cache.clear()
    api, user = logged_in()

    codes = [
        api.post(
            PASSWORD_URL,
            {"current_password": f"мимо-{i}", "new_password": GOOD_PASSWORD},
            format="json",
        ).status_code
        for i in range(12)
    ]

    assert 429 in codes, codes
    # Ограничение не открыло дверь: пароль всё тот же.
    assert authenticate(username=user.username, password=OLD_PASSWORD) is not None
    cache.clear()


# ── Свой профиль ─────────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_profile_patch_saves_name_and_email():
    api, user = logged_in(first_name="Иван", last_name="Иванов", email="i@vaps.kz")

    response = api.patch(
        PROFILE_URL,
        {"first_name": "Пётр", "last_name": "Петров", "email": "p@vaps.kz"},
        format="json",
    )

    assert response.status_code == 200, response.content
    user.refresh_from_db()
    assert (user.first_name, user.last_name, user.email) == (
        "Пётр",
        "Петров",
        "p@vaps.kz",
    )


@pytest.mark.django_db
def test_profile_patch_returns_the_shape_the_dialog_reads():
    """Ответ содержит поля, которые клиент кладёт в форму (UpdateProfileResponse).

    `name` собран сервером: диалог показывает его в шапке и разбирает обратно
    на имя и фамилию при следующем открытии.
    """
    api, user = logged_in(first_name="Иван", last_name="Иванов", email="i@vaps.kz")

    body = api.patch(PROFILE_URL, {"first_name": "Пётр"}, format="json").json()

    assert body["id"] == user.pk
    assert body["first_name"] == "Пётр"
    assert body["last_name"] == "Иванов"
    assert body["email"] == "i@vaps.kz"
    assert body["name"] == "Пётр Иванов"


@pytest.mark.django_db
def test_profile_patch_ignores_fields_that_are_not_the_users_to_change():
    """Права, логин и пароль через профиль не проходят.

    Профиль правит сам человек и без всякого права — значит принимать здесь
    можно РОВНО то, что человеку про себя менять позволено. Приняв is_staff,
    ручка раздавала бы администратора по запросу.
    """
    api, user = logged_in()

    api.patch(
        PROFILE_URL,
        {
            "first_name": "Пётр",
            "username": "root",
            "is_staff": True,
            "is_superuser": True,
            "password": "подсунутый-пароль",
        },
        format="json",
    )

    user.refresh_from_db()
    assert user.first_name == "Пётр"
    assert user.username == "ivanov"
    assert user.is_staff is False
    assert user.is_superuser is False
    assert authenticate(username="ivanov", password="подсунутый-пароль") is None
    assert authenticate(username="ivanov", password=OLD_PASSWORD) is not None


@pytest.mark.django_db
def test_profile_patch_rejects_an_email_taken_by_someone_else():
    """Почта — то, по чему человека ищут и чем ему пишут; две одинаковых лгут.

    Django на уникальность email не смотрит вовсе, поэтому проверка своя.
    """
    User.objects.create_user(username="petrov", password=OLD_PASSWORD, email="p@vaps.kz")
    api, user = logged_in("ivanov", email="i@vaps.kz")

    response = api.patch(PROFILE_URL, {"email": "p@vaps.kz"}, format="json")

    assert response.status_code == 400
    user.refresh_from_db()
    assert user.email == "i@vaps.kz"


@pytest.mark.django_db
def test_profile_is_closed_to_anonymous():
    response = APIClient().patch(PROFILE_URL, {"first_name": "Пётр"}, format="json")

    assert response.status_code in (401, 403)


@pytest.mark.django_db
def test_profile_get_returns_the_current_user():
    """Диалог засевается из сессии, но своя учётка должна читаться и с сервера.

    Без чтения клиент знал бы о себе только то, что попало в токен при входе, —
    а токен живёт восемь часов и правку профиля не замечает.
    """
    api, user = logged_in(first_name="Иван", last_name="Иванов", email="i@vaps.kz")

    response = api.get(PROFILE_URL)

    assert response.status_code == 200, response.content
    assert response.json()["id"] == user.pk
    assert response.json()["name"] == "Иван Иванов"
