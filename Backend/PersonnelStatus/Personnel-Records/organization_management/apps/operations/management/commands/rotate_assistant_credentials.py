"""Explicit storage upgrade/rotation; no secret is printed or sent to a model."""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.views.decorators.debug import sensitive_variables

from organization_management.apps.operations.models_assistant_connection import OpsAssistantConnection
from organization_management.apps.ops.assistant import credentials


class Command(BaseCommand):
    help = 'Проверить хранение ключа ИИ; --apply шифрует прежний ключ или обновляет ключ шифрования.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true')

    @transaction.atomic
    @sensitive_variables()
    def handle(self, *args, **options):
        row = OpsAssistantConnection.objects.select_for_update().filter(pk=1).first()
        if row is None or not row.api_key:
            self.stdout.write('Ключ ИИ не сохранён. Изменений нет.')
            return
        try:
            rotate = credentials.needs_rotation(row.api_key, row.api_key_format)
            if rotate and options['apply']:
                row.api_key = credentials.seal(credentials.unseal(row.api_key, row.api_key_format))
                row.api_key_format = credentials.FORMAT
                row.save(update_fields=['api_key', 'api_key_format'])
        except credentials.CredentialUnavailable:
            raise CommandError('Ключ ИИ не читается текущими серверными ключами. Данные не изменены; восстановите прежний ключ шифрования или задайте новый ключ API в настройках.') from None
        if not rotate:
            self.stdout.write('Ключ ИИ уже зашифрован действующим ключом. Изменений нет.')
        elif options['apply']:
            self.stdout.write('Хранение ключа ИИ обновлено. Параметры подключения и версия конфигурации сохранены.')
        else:
            self.stdout.write('Требуется обновить хранение ключа ИИ. Проверка без изменений; для применения используйте --apply.')
