"""Идентичность WS-рукопожатия раздела (порт apps/core/auth/ws.py из
Backend/VAPS, переложенный на SimpleJWT старого проекта).

Токен едет В СТРОКЕ ЗАПРОСА, потому что браузерный `WebSocket` не умеет
ставить заголовки: весь транспорт идентичности REST (`Authorization: Bearer`)
физически недоступен клиенту. Плата — токен попадает в журнал доступа
веб-сервера; закрывается это конфигурацией `/ws/` (логировать путь без
аргументов), а не выбором другого места для токена.

Правила приёма токена НЕ переписаны своими руками, а взяты у той же
`JWTAuthentication`, что стоит в REST_FRAMEWORK: и подпись с истечением
(`get_validated_token`), и существование с активностью учётки (`get_user`).
Своя проверка «разобрать payload и взять user_id» выглядела бы эквивалентной,
но разошлась бы ровно там, где это дорого: сокет уволенного (is_active=False)
продолжал бы получать ленту до конца жизни токена — восемь часов, — тогда как
REST отказал бы ему сразу.

Отказ — это `None`, а не исключение: закрыть рукопожатие кодом 4403 должен
потребитель. Исключение отсюда всплыло бы непрозрачной ASGI-500 без кода
закрытия, и клиент не отличил бы «не пустили» от «сеть умерла».
"""
from urllib.parse import parse_qs

from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication

from organization_management.apps.operations.services import LegacyRoleSync


def _query_params(scope):
    """`scope["query_string"]` — сырые bytes, а не разобранный QueryDict."""
    return parse_qs(scope.get("query_string", b"").decode("utf-8", "replace"))


def resolve_actor_id(scope):
    """user_id RBAC для рукопожатия, либо None (аноним).

    ХОДИТ В БАЗУ (`get_user`) — поэтому зовётся из потребителя через
    `database_sync_to_async`, а не напрямую из корутины.

    Возвращает ровно то же, что `api.permissions.resolve_actor_id` вернул бы
    для этого пользователя по HTTP: адрес доставки обязан совпадать с
    получателем, которого пишет notify(), иначе расхождение проявится не
    ошибкой, а тишиной в сокете.
    """
    values = _query_params(scope).get("token") or []
    raw = values[0] if values else ""
    if not raw:
        return None
    backend = JWTAuthentication()
    try:
        user = backend.get_user(backend.get_validated_token(raw))
    except AuthenticationFailed:
        # InvalidToken — подкласс AuthenticationFailed, поэтому одна ветка
        # накрывает и негодный токен, и негодную учётку. Логировать нечего:
        # ни идентичности, ни безопасного к записи payload здесь нет.
        return None
    return LegacyRoleSync.actor_id_for_user(user)
