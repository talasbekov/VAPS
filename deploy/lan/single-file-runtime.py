"""Embedded by build-single-file.py; uses only the Linux Python standard library."""
import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile


def sha_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description='Smart: обновление с сохранением базы сервера.')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='Только проверка совместимости')
    mode.add_argument('--verify-only', action='store_true', help='Только проверка и распаковка файла; без Docker')
    parser.add_argument('--stack', help='Папка установленного Smart, если автоматический поиск неоднозначен')
    args = parser.parse_args(sys.argv[2:])
    if sys.version_info < (3, 9):
        raise RuntimeError('Требуется Python 3.9 или новее')
    os.umask(0o077)
    launcher = Path(sys.argv[1]).resolve(strict=True)
    print('Проверяем целостность встроенного пакета…', flush=True)
    with launcher.open('rb') as stream:
        if launcher.stat().st_size <= PAYLOAD_BYTES:
            raise RuntimeError('Файл обновления обрезан')
        stream.seek(-PAYLOAD_BYTES, os.SEEK_END)
        digest = hashlib.sha256()
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            digest.update(block)
    if digest.hexdigest() != PAYLOAD_SHA256:
        raise RuntimeError('Контрольная сумма пакета не совпала. Скопируйте файл заново.')
    with zipfile.ZipFile(launcher) as archive:
        names = archive.namelist()
        roots = set()
        for item in archive.infolist():
            parts = PurePosixPath(item.filename).parts
            if (len(parts) != 2 or any(p in ('', '.', '..', '/') for p in parts)
                    or '\\' in item.filename or item.is_dir()
                    or stat.S_ISLNK(item.external_attr >> 16)):
                raise RuntimeError('Недопустимый путь в архиве')
            roots.add(parts[0])
        if len(roots) != 1 or len(names) != len(set(names)):
            raise RuntimeError('Некорректная структура пакета')
        root = roots.pop()
        if root + '/SHA256SUMS' not in names or root + '/update-with-migrations.py' not in names:
            raise RuntimeError('Пакет обновления неполный')
        expected = {}
        # splitlines deliberately accepts LF and Windows CRLF without changing the payload.
        for line in archive.read(root + '/SHA256SUMS').decode('utf-8').splitlines():
            match = re.fullmatch(r'([0-9a-f]{64})  ([^/\\]+)', line)
            if not match or match[2] in expected or match[2] in ('.', '..'):
                raise RuntimeError('Некорректный список контрольных сумм')
            expected[match[2]] = match[1]
        if set(names) != {root + '/' + n for n in expected} | {root + '/SHA256SUMS'}:
            raise RuntimeError('Список файлов не соответствует контрольным суммам')
        needed = sum(item.file_size for item in archive.infolist()) + 64 * 1024 * 1024
        if shutil.disk_usage(Path.cwd()).free < needed:
            raise RuntimeError('Недостаточно места для распаковки пакета')
        folder = Path(tempfile.mkdtemp(prefix='smart-update-', dir=Path.cwd()))
        print('Файлы обновления: ' + str(folder), flush=True)
        archive.extractall(folder)
    package = folder / root
    for name, expected_hash in expected.items():
        if sha_file(package / name) != expected_hash:
            raise RuntimeError('Ошибка контрольной суммы: ' + name)
    print('Пакет проверен: ' + str(len(expected)) + ' файлов. База ноутбука не импортируется.', flush=True)
    if args.verify_only:
        print('Проверка завершена. Обновление не запускалось.', flush=True)
        return 0
    command = [sys.executable, str(package / 'update-with-migrations.py'),
               '--check' if args.check else '--apply']
    if args.stack:
        command.extend(['--stack', str(Path(args.stack).resolve())])
    print('Ищем действующий Smart. Проверка совместимости выполняется до остановки приложения.', flush=True)
    if not args.check:
        print('Запускаем обновление: резервная копия базы сервера, пробное восстановление, миграции и образы.', flush=True)
    result = subprocess.run(command, cwd=package)
    if result.returncode:
        print('Обновлятор остановился с ошибкой. Сохраните вывод; не удаляйте резервную копию и lock.', file=sys.stderr)
    return result.returncode


try:
    sys.exit(main())
except (OSError, ValueError, RuntimeError, zipfile.BadZipFile, KeyboardInterrupt) as error:
    print('ОШИБКА: ' + str(error), file=sys.stderr)
    sys.exit(1)
