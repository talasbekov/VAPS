"""Тестовая БД не должна называться одинаково в разных чекаутах проекта.

Общее имя test_personnel_records на весь сервер приводило к гонке: два
параллельных прогона из разных чекаутов делили одну базу, и тот, кто
заканчивал первым, удалял её из-под второго. Второй падал посреди прогона
с «database does not exist» и «relation ... does not exist», а если
соседний чекаут был на другой версии Django — то и с IntegrityError на
django_content_type.name, колонке, которой в Django 5 нет.

Падало при этом всегда в TestDatabaseGuarantee, и выглядело дефектом
ограничений БД, хотя причина была в имени базы. Тест закрепляет
разъезд имён, потому что вернуть общее имя можно одной строкой, не
сломав больше ничего: гонка воспроизводится только при параллельном
прогоне и на одиночном зелёном гейте невидима.

Лежит в apps/operations, а не в tests/ у корня, потому что гейт раздела
гоняется как `pytest organization_management/apps/operations` — в корневой
каталог он не заглядывает, и тест бы молча не исполнялся.
"""
import hashlib
import os

from django.conf import settings
from django.test import SimpleTestCase


class TestTestDatabaseIsolation(SimpleTestCase):
    def test_test_db_name_is_not_the_shared_default(self):
        name = settings.DATABASES["default"]["TEST"]["NAME"]
        assert name, "имя тестовой БД должно быть задано явно"
        # Ровно то имя, которое Django выводит по умолчанию и которое
        # делили между собой чекауты. Держится в ЛЮБОМ режиме — и под
        # PR_TEST_DB_NAME тоже: ручка разводит прогоны, а не возвращает
        # общее имя.
        assert name != "test_personnel_records"

    def test_test_db_name_is_tied_to_this_checkout(self):
        name = settings.DATABASES["default"]["TEST"]["NAME"]

        # PR_TEST_DB_NAME — штатный обход для ДВУХ ОДНОВРЕМЕННЫХ прогонов
        # внутри одного чекаута: метка выводится из пути и у них совпадает,
        # так что развести их может только явное имя (settings/test.py).
        # Требовать метку и от него — требовать несовместимого: обход по
        # инструкции краснил этот тест, и звали его как раз тогда, когда
        # прогон и без того шёл в спорной обстановке.
        override = os.environ.get("PR_TEST_DB_NAME")
        if override:
            # Не skip: ручка обязана исполняться. Промолчи тест здесь —
            # settings, перестав её читать, вернули бы прогоны в общую базу,
            # и ровно в этом режиме этого никто бы не заметил.
            assert name == override, f"{name!r} не равно PR_TEST_DB_NAME"
            return

        tag = hashlib.sha1(str(settings.BASE_DIR).encode()).hexdigest()[:8]
        # Метка выводится из пути чекаута: у соседнего каталога она другая,
        # значит базы не пересекутся. Стабильность между прогонами тоже
        # важна — иначе каждый запуск плодил бы новую базу.
        assert name.endswith(tag), f"{name!r} не привязано к {settings.BASE_DIR}"
