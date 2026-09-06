"""Продление выдаёт НОВЫЙ refresh-токен, а не только access (Plane №787).

ДЕФЕКТ, КОТОРЫЙ ЭТИ ПРОБЫ СТЕРЕГУТ. Сессия портала скользящая: cookie
перевыпускается при каждом чтении. А refresh-токен бэкенда жил семь суток ОТ
ВХОДА и не обновлялся — `ROTATE_REFRESH_TOKENS` стоял выключенным. Значит
человек, работающий не прерываясь дольше недели, на седьмые сутки получал
отказ продления посреди работы: его уводило на форму входа, несохранённый
экран терялся, а симптом выглядел как поломка системы — бэкенд здоров, права
на месте, а из системы выкинуло. Решение заказчика 06.09.2026: продлевать
ротацией.

🔴 КРАСНОТА НА МУТАЦИИ: верни `ROTATE_REFRESH_TOKENS: False` в
`config/settings/base.py` — первая проба покраснеет на отсутствии поля
`refresh` в ответе, вторая на том, что срок нового токена не уехал вперёд.

ВТОРАЯ ПОЛОВИНА ПРАВКИ ЖИВЁТ НА КЛИЕНТЕ и здесь не проверяется: новый токен
обязан быть СОХРАНЁН в сессии (`PersonalRecordFront/lib/auth-config.ts`,
`refreshed`), иначе ротация не меняет ничего. Её стережёт живая проба
`e2e/session-refresh.spec.ts` — сервер о том, сохранил ли клиент ответ, знать
не может.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

pytestmark = pytest.mark.django_db


@pytest.fixture
def tokens():
    get_user_model().objects.create_user(username="rotator", password="пароль-стенда")
    api = APIClient()
    got = api.post(
        "/api/token/",
        {"username": "rotator", "password": "пароль-стенда"},
        format="json",
    )
    assert got.status_code == 200, got.content
    return api, got.json()


def test_the_refresh_returns_a_new_refresh_token(tokens):
    api, pair = tokens

    renewed = api.post("/api/token/refresh/", {"refresh": pair["refresh"]}, format="json")

    assert renewed.status_code == 200, renewed.content
    body = renewed.json()
    assert "refresh" in body, (
        "ответ продления не несёт нового refresh — ротация выключена, и через "
        "семь суток от входа человека выкинет посреди работы"
    )
    assert body["refresh"] != pair["refresh"], "вернулся тот же токен: замены не было"


def test_the_new_refresh_token_carries_a_later_expiry(tokens):
    """Новое окно, а не переупаковка старого.

    Проба спрашивает СРОК, а не «строка отличается»: у нового токена другой
    `jti`, поэтому строки различались бы и при неизменном `exp` — и семь суток
    от входа остались бы на месте незамеченными.
    """
    api, pair = tokens

    renewed = api.post("/api/token/refresh/", {"refresh": pair["refresh"]}, format="json")
    was = RefreshToken(pair["refresh"])
    now = RefreshToken(renewed.json()["refresh"])

    assert now["exp"] >= was["exp"]
    assert now["jti"] != was["jti"]


def test_the_new_refresh_token_works_for_the_next_renewal(tokens):
    """Цепочка не обрывается на втором звене.

    Ровно это и означает «непрерывная работа не прерывается»: продлеваться
    надо не один раз, а сколько угодно, каждым следующим токеном.
    """
    api, pair = tokens

    first = api.post("/api/token/refresh/", {"refresh": pair["refresh"]}, format="json")
    second = api.post(
        "/api/token/refresh/", {"refresh": first.json()["refresh"]}, format="json"
    )

    assert second.status_code == 200, second.content
    assert second.json()["access"]
