"""Демо-учётки: по одной на роль, с областью видимости и без зашитого пароля (№226).

Пробы стерегут:

1. КОМАНДА ВООБЩЕ РАБОТАЕТ. Прежняя падала `AttributeError` на первом вызове —
   обращалась к перечислению, которого у модели нет, — и знала об этом только
   строка в `Status.md`. Первая же проба ловит именно это.
2. РОЛИ БЕРУТСЯ ИЗ БАЗЫ: добавили роль в справочник — появилась учётка, без
   правки кода.
3. ОБЛАСТЬ ВИДИМОСТИ спрашивается У РОЛИ: требующая её роль получает
   подразделение своего уровня, не требующая — не получает ничего (модель
   запрещает и это проверяет сама).
4. ПАРОЛЬ НЕ ЗАШИТ: без пароля — внятный отказ, а не учётка с общеизвестным
   `demo123` и доступом в Admin.
5. ПОВТОР не плодит учёток и возвращает доступ (пароль ставится заново).
"""
import pytest
from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError

from organization_management.apps.common.models import Role, UserRole
from organization_management.apps.divisions.models import Division

pytestmark = pytest.mark.django_db

PASSWORD = "проверка-прав-27-08"


@pytest.fixture
def roles():
    department = Division.objects.create(
        name="Первый департамент", code="dm-dep", division_type=Division.DivisionType.DEPARTMENT
    )
    directorate = Division.objects.create(
        name="Первое управление", code="dm-dir",
        division_type=Division.DivisionType.DIRECTORATE, parent=department,
    )
    # `requires_scope` повторяет стенд: область нужна руководителю департамента
    # и НЕ нужна наблюдателю — модель запрещает назначать её роли, которая её не
    # требует, и обратное сочетание падало бы ValidationError.
    Role.objects.create(code="ROLE_1", name="Наблюдатель организации", requires_scope=False)
    Role.objects.create(code="ROLE_3", name="Руководитель департамента", requires_scope=True)
    Role.objects.create(code="ROLE_6", name="Руководитель управления", requires_scope=True)
    return {"department": department, "directorate": directorate}


def test_the_command_runs_at_all(roles):
    call_command("setup_demo_roles", "--password", PASSWORD)

    assert User.objects.filter(username__startswith="demo_").count() == 3


def test_a_new_role_gets_an_account_without_touching_the_code(roles):
    Role.objects.create(code="ROLE_9", name="Особая роль", requires_scope=False)

    call_command("setup_demo_roles", "--password", PASSWORD)

    assert User.objects.filter(username="demo_role_9").exists()


def test_scoped_roles_get_a_real_division(roles):
    call_command("setup_demo_roles", "--password", PASSWORD)

    head_of_department = UserRole.objects.get(user__username="demo_role_3")
    head_of_directorate = UserRole.objects.get(user__username="demo_role_6")
    observer = UserRole.objects.get(user__username="demo_role_1")

    assert head_of_department.scope_division == roles["department"]
    assert head_of_directorate.scope_division == roles["directorate"]
    assert observer.scope_division is None, "наблюдателю организации область не сужают"


def test_without_a_password_it_refuses_and_says_why(roles, monkeypatch):
    monkeypatch.delenv("DEMO_USERS_PASSWORD", raising=False)

    with pytest.raises(CommandError) as error:
        call_command("setup_demo_roles")

    assert "пароль" in str(error.value).lower()
    assert not User.objects.filter(username__startswith="demo_").exists()


def test_the_password_can_be_given_by_the_environment(roles, monkeypatch):
    monkeypatch.setenv("DEMO_USERS_PASSWORD", PASSWORD)

    call_command("setup_demo_roles")

    assert User.objects.get(username="demo_role_1").check_password(PASSWORD)


def test_the_second_run_restores_access_without_duplicating(roles):
    call_command("setup_demo_roles", "--password", PASSWORD)
    before = list(User.objects.filter(username__startswith="demo_").values_list("id", flat=True))

    call_command("setup_demo_roles", "--password", "другой-пароль-27-08")

    assert list(User.objects.filter(username__startswith="demo_").values_list("id", flat=True)) == before
    assert User.objects.get(username="demo_role_1").check_password("другой-пароль-27-08")


def test_the_empty_role_book_is_a_loud_refusal():
    with pytest.raises(CommandError) as error:
        call_command("setup_demo_roles", "--password", PASSWORD)

    assert "ролей пуст" in str(error.value)
