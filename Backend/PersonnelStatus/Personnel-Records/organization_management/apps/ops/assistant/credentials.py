"""Versioned authenticated storage; plaintext is accepted only for legacy rows."""
import base64

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from django.conf import settings
from django.views.decorators.debug import sensitive_variables

FORMAT = 'fernet-v1'
UNAVAILABLE = 'Сохранённый ключ ИИ не удалось прочитать. Укажите новый ключ или явно удалите сохранённый; проверьте серверные ключи шифрования.'


class CredentialUnavailable(ValueError):
    def __init__(self):
        super().__init__(UNAVAILABLE)


@sensitive_variables()
def keyring():
    """Explicit keys lead; domain-separated server-secret keys support upgrades."""
    try:
        configured = getattr(settings, 'OPS_ASSISTANT_CREDENTIAL_KEYS', '')
        values = [part.strip() for part in configured.split(',') if part.strip()] if isinstance(configured, str) else list(configured)
        if len(values) > 5:
            raise ValueError
        keys = [Fernet(value.encode('ascii') if isinstance(value, str) else value) for value in values]
        secrets = [settings.SECRET_KEY, *getattr(settings, 'SECRET_KEY_FALLBACKS', [])]
        if not secrets[0] or len(secrets) > 6:
            raise ValueError
        for secret in secrets:
            material = HKDF(algorithm=hashes.SHA256(), length=32,
                            salt=b'smart-josparlau-ai-credentials-v1',
                            info=b'api-key-at-rest').derive(secret.encode('utf-8'))
            keys.append(Fernet(base64.urlsafe_b64encode(material)))
        return keys
    except (ValueError, TypeError, UnicodeError, AttributeError):
        raise CredentialUnavailable() from None


@sensitive_variables()
def seal(plaintext):
    if not plaintext:
        return ''
    return keyring()[0].encrypt(plaintext.encode('utf-8')).decode('ascii')


@sensitive_variables()
def unseal(stored, storage_format):
    if not stored:
        return ''
    if storage_format == 'plain':
        return stored
    if storage_format != FORMAT:
        raise CredentialUnavailable()
    try:
        return MultiFernet(keyring()).decrypt(stored.encode('ascii')).decode('utf-8')
    except (InvalidToken, ValueError, UnicodeError):
        raise CredentialUnavailable() from None


@sensitive_variables()
def needs_rotation(stored, storage_format):
    if not stored:
        return False
    plaintext = unseal(stored, storage_format)
    if storage_format != FORMAT:
        return True
    try:
        return keyring()[0].decrypt(stored.encode('ascii')).decode('utf-8') != plaintext
    except InvalidToken:
        return True
