import logging

from organization_management.apps.common.request_ip import client_ip

logger = logging.getLogger('django.server')


class LogIPMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # 🔴 ТОТ ЖЕ РАЗБОР, ЧТО У ПОДПИСИ (доводка №699 по ревью №825).
        # Здесь стоял `x_forwarded_for.split(',')[0]` — ЛЕВЫЙ хоп, который
        # вписывает сам клиент, без единой проверки доверия. Строка лога —
        # не подпись, но тот же класс уязвимости: злоумышленник управлял
        # тем, какой адрес попадёт в лог сервера про него самого.
        ip = client_ip(request)

        # Логируем метод, путь и IP
        # Вывод будет в терминале благодаря настройкам logging в settings.py
        print(f"Incoming Request: {request.method} {request.path} from IP: {ip}")

        response = self.get_response(request)
        return response