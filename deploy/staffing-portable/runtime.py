"""Offline staffing installer. Uses existing images; never builds or pulls."""

import argparse
import fcntl
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path


class InstallError(Exception):
    pass


def patched_ctl(text, original):
    needle = '-f docker-compose.yml "$@"'
    patched = original.replace(
        needle, '-f docker-compose.yml -f docker-compose.staffing.yml "$@"'
    )
    if needle not in original or text not in (original, patched):
        raise InstallError(
            "ctl.sh отличается от поддерживаемого комплекта. Файлы не заменены."
        )
    return patched


def patched_checksums(text, original_ctl):
    old = hashlib.sha256(original_ctl.encode()).hexdigest()
    new = hashlib.sha256(patched_ctl(original_ctl, original_ctl).encode()).hexdigest()
    matches = list(
        re.finditer(r"^([0-9a-f]{64})( [ *](?:\./)?ctl\.sh)$", text, re.MULTILINE)
    )
    if len(matches) != 1 or matches[0].group(1) not in (old, new):
        raise InstallError(
            "Контрольная сумма ctl.sh в sha256sums.txt не совпадает с поддерживаемой."
        )
    match = matches[0]
    return text[: match.start(1)] + new + text[match.end(1) :]


def overlay_config(paths):
    volumes = [
        {
            "type": "bind",
            "source": "./.staffing-import/files/" + p,
            "target": "/app/" + p,
            "read_only": True,
            "bind": {"create_host_path": False},
        }
        for p in sorted(paths)
    ]
    return {
        "services": {
            name: {"volumes": volumes} for name in ("backend", "worker", "beat")
        }
    }


def check_hashes(actual, base, replacements, *, installed):
    expected = dict(base)
    if installed:
        expected.update(replacements)
    mismatch = sorted(
        p for p in set(actual) | set(expected) if actual.get(p) != expected.get(p)
    )
    if mismatch:
        raise InstallError(
            "Версия backend не совпадает с проверенной поставкой. Отличаются файлы: "
            + ", ".join(mismatch[:8])
            + ". Автоматическое обновление остановлено."
        )


def check_mounts(config, paths, *, installed):
    targets = {"/app/" + p for p in paths}
    for name in ("backend", "worker", "beat"):
        for mount in config["services"].get(name, {}).get("volumes", []):
            target = mount["target"].rstrip("/")
            if any(t == target or t.startswith(target + "/") for t in targets):
                if installed and target in targets and mount.get("read_only"):
                    continue
                raise InstallError(
                    f"{name}: найдено другое подключение к {target}. Обновление остановлено."
                )


def write_private(path, data, *, exclusive=False, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_name(path.name + ".new-" + uuid.uuid4().hex)
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fchmod(stream.fileno(), mode)
            os.fsync(stream.fileno())
        if exclusive:
            # Atomic publication without overwriting an existing original/marker.
            os.link(temp, path)
        else:
            os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


class Installer:
    def __init__(self, args):
        self.args = args
        self.package = Path(__file__).resolve().parent
        self.stack = args.stack.resolve()
        self.xlsx = args.xlsx.resolve(strict=True)
        self.config_path = args.config.resolve(strict=True) if args.config else None
        self.home = self.stack / ".staffing-import"
        self.manifest = json.loads((self.package / "manifest.json").read_text())
        self.original_ctl = self.manifest["ctl"]
        self.ctl = self.stack / "ctl.sh"
        self.pending_path = self.home / "pending.json"
        self.pending = self.pending_path.is_file()
        self.installed = False
        self.stopped = False
        self.started_install = self.pending
        for path in (self.stack, self.package, self.xlsx, self.config_path):
            if path and any(c in str(path) for c in (":", "\n", "\r")):
                raise InstallError(
                    "Пути для Docker не должны содержать двоеточие или перевод строки."
                )

    def compose(self, *args, capture=False, input_data=None, output=None):
        result = subprocess.run(
            ["bash", str(self.ctl), *args],
            cwd=self.stack,
            input=input_data,
            stdout=subprocess.PIPE if capture else output,
            stderr=subprocess.PIPE if capture else None,
            check=False,
        )
        if result.returncode:
            # Captured config may contain credentials, so never reproduce it.
            raise InstallError(
                f"Команда Docker Compose {args[0]} завершилась с кодом {result.returncode}."
            )
        return result.stdout if capture else None

    def oneoff(self, *command, capture=False, source=False, reports=None):
        mounts = ["-v", f"{self.package}:/opt/staffing-package:ro"]
        if source:
            mounts += ["-v", f"{self.xlsx}:/opt/staffing.xlsx:ro"]
            if self.config_path:
                mounts += ["-v", f"{self.config_path}:/opt/staffing-config.json:ro"]
        if reports:
            mounts += ["-v", f"{reports}:/opt/staffing-reports"]
        return self.compose(
            "run",
            "--rm",
            "--no-deps",
            "-T",
            "--entrypoint",
            "python",
            *mounts,
            "backend",
            *command,
            capture=capture,
        )

    def roster_args(self):
        result = ["/opt/staffing.xlsx", "--match-dictionary-names"]
        if self.args.skip_invalid_iin:
            result.append("--skip-invalid-iin")
        if self.args.sheet:
            result += ["--sheet", self.args.sheet]
        if self.config_path:
            result += ["--config", "/opt/staffing-config.json"]
        return result

    def verify(self):
        for name in ("ctl.sh", "docker-compose.yml", "images.env", ".env"):
            if not (self.stack / name).is_file():
                raise InstallError(
                    f"В папке комплекта отсутствует {name}. Укажите --stack."
                )
        current_ctl = self.ctl.read_text()
        patched = patched_ctl(current_ctl, self.original_ctl)
        self.installed = current_ctl == patched
        if self.pending:
            marker = json.loads(self.pending_path.read_text())
            if (
                marker.get("package_sha256")
                != hashlib.sha256(
                    (self.package / "manifest.json").read_bytes()
                ).hexdigest()
            ):
                raise InstallError(
                    "Незавершённая установка относится к другому выпуску загрузчика."
                )
        if (
            not self.pending
            and self.installed != (self.home / "manifest.json").is_file()
        ):
            raise InstallError(
                "Незавершённая установка: ctl.sh и .staffing-import не согласованы. "
                "Сохраните каталог и журнал для восстановления."
            )
        if self.installed or self.pending:
            expected_overlay = overlay_config(self.manifest["files"])
            overlay_path = self.stack / "docker-compose.staffing.yml"
            if (self.installed and not overlay_path.is_file()) or (
                overlay_path.exists()
                and json.loads(overlay_path.read_text()) != expected_overlay
            ):
                raise InstallError(
                    "Подключение файлов загрузчика изменено или отсутствует."
                )
            saved_manifest = self.home / "manifest.json"
            if (
                saved_manifest.exists()
                and saved_manifest.read_bytes()
                != (self.package / "manifest.json").read_bytes()
            ):
                raise InstallError(
                    "На сервере уже установлен другой выпуск загрузчика."
                )
        elif (self.stack / "docker-compose.staffing.yml").exists():
            raise InstallError(
                "docker-compose.staffing.yml уже существует и не принадлежит установщику."
            )
        checksums = self.stack / "sha256sums.txt"
        if checksums.exists():
            patched_checksums(checksums.read_text(), self.original_ctl)
        # Validate all bundled bytes before stopping any service.
        for rel, digest in self.manifest["files"].items():
            if (
                hashlib.sha256((self.package / "files" / rel).read_bytes()).hexdigest()
                != digest
            ):
                raise InstallError("Повреждён пакет файлов загрузчика.")
        config = json.loads(self.compose("config", "--format", "json", capture=True))
        if not {"backend", "worker", "beat", "db", "frontend", "proxy"} <= set(
            config["services"]
        ):
            raise InstallError("Ожидается состав сервисов штатного LAN-комплекта.")
        for name, service in config["services"].items():
            if service.get("build") or service.get("pull_policy") != "never":
                raise InstallError(
                    f"{name}: для закрытой сети требуется pull_policy: never."
                )
        if (
            len(
                {
                    config["services"][name]["image"]
                    for name in ("backend", "worker", "beat")
                }
            )
            != 1
        ):
            raise InstallError(
                "backend, worker и beat должны использовать один образ приложения."
            )
        check_mounts(config, self.manifest["files"], installed=self.installed)
        if self.installed:
            for name in ("backend", "worker", "beat"):
                mounts = {
                    v["target"]: v for v in config["services"][name].get("volumes", [])
                }
                for rel in self.manifest["files"]:
                    mount = mounts.get("/app/" + rel, {})
                    if (
                        Path(mount.get("source", "/missing")).resolve()
                        != (self.home / "files" / rel).resolve()
                    ):
                        raise InstallError(
                            f"{name}: подключён другой источник файла {rel}."
                        )
        actual = json.loads(
            self.oneoff("/opt/staffing-package/fingerprint.py", capture=True)
        )
        mismatch = None
        for variant in self.manifest.get("base_variants", [{}]):
            base = {**self.manifest["base_files"], **variant}
            try:
                check_hashes(
                    actual, base, self.manifest["files"], installed=self.installed
                )
                break
            except InstallError as exc:
                mismatch = exc
        else:
            raise mismatch
        if not self.installed:
            self.oneoff("manage.py", "migrate", "--check", capture=True)
        print("Версия контейнера и настройки комплекта подходят.", flush=True)

    def backup(self):
        directory = self.home / "backups"
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = directory / (
            time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8] + ".dump"
        )
        partial = path.with_suffix(".partial")
        fd = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as stream:
            self.compose(
                "exec",
                "-T",
                "db",
                "sh",
                "-c",
                'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc',
                output=stream,
            )
        # Ask pg_restore to read the archive before marking the backup complete.
        with partial.open("rb") as stream:
            result = subprocess.run(
                ["bash", str(self.ctl), "exec", "-T", "db", "pg_restore", "--list"],
                cwd=self.stack,
                stdin=stream,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        if result.returncode or partial.stat().st_size == 0:
            raise InstallError(
                "Не удалось проверить резервную копию. Запись в базу не начата."
            )
        os.replace(partial, path)
        print(f"Резервная копия базы: {path}", flush=True)
        return path

    def install(self):
        self.started_install = True
        for rel, digest in self.manifest["files"].items():
            data = (self.package / "files" / rel).read_bytes()
            if hashlib.sha256(data).hexdigest() != digest:
                raise InstallError("Повреждён пакет файлов загрузчика.")
            write_private(self.home / "files" / rel, data)
        before = self.home / "ctl.sh.before"
        if before.exists():
            if before.read_text() != self.original_ctl:
                raise InstallError(
                    "Сохранённый исходный ctl.sh отличается от ожидаемого."
                )
        else:
            write_private(before, self.original_ctl.encode(), exclusive=True)
        checksums = self.stack / "sha256sums.txt"
        if checksums.exists():
            checksum_backup = self.home / "sha256sums.txt.before"
            current_sums = checksums.read_text()
            updated_sums = patched_checksums(current_sums, self.original_ctl)
            if not checksum_backup.exists():
                write_private(checksum_backup, current_sums.encode(), exclusive=True)
            elif (
                patched_checksums(checksum_backup.read_text(), self.original_ctl)
                != updated_sums
            ):
                raise InstallError(
                    "Файл контрольных сумм изменился после начала установки."
                )
        write_private(
            self.stack / "docker-compose.staffing.yml",
            json.dumps(overlay_config(self.manifest["files"]), indent=2).encode(),
        )
        write_private(
            self.home / "manifest.json", (self.package / "manifest.json").read_bytes()
        )
        mode = self.ctl.stat().st_mode & 0o777
        write_private(
            self.ctl,
            patched_ctl(self.original_ctl, self.original_ctl).encode(),
            mode=mode,
        )
        if checksums.exists():
            write_private(checksums, updated_sums.encode())
        # Compose executes the original image, with only our files mounted read-only.
        self.oneoff("manage.py", "migrate", "--noinput")
        self.installed = True

    def start(self):
        self.compose(
            "up",
            "-d",
            "--pull",
            "never",
            "--no-build",
            "--wait",
            "--wait-timeout",
            "600",
            "backend",
            "worker",
            "beat",
            "frontend",
            "proxy",
        )
        self.stopped = False

    def run(self):
        self.verify()
        self.oneoff("/opt/staffing-package/probe.py", *self.roster_args(), source=True)
        if not self.args.apply and self.pending:
            raise InstallError(
                "Установка прервалась. Повторите эту команду с --apply для её завершения."
            )
        if not self.args.apply and not self.installed:
            print(
                "Файл проверен. База и приложение не изменены. "
                "Для установки загрузчика и импорта повторите команду с --apply."
            )
            return
        if self.args.apply:
            needs_install = not self.installed or self.pending
            if needs_install:
                if not self.pending:
                    write_private(
                        self.pending_path,
                        json.dumps(
                            {
                                "package_sha256": hashlib.sha256(
                                    (self.package / "manifest.json").read_bytes()
                                ).hexdigest()
                            }
                        ).encode(),
                        exclusive=True,
                    )
                    self.pending = True
                print(
                    "Подключение загрузчика: краткая остановка приложения, резервная копия и миграции.",
                    flush=True,
                )
                self.stopped = True
                self.compose(
                    "stop",
                    "--timeout",
                    "60",
                    "proxy",
                    "frontend",
                    "beat",
                    "worker",
                    "backend",
                )
            self.backup()
            if needs_install:
                self.install()
                self.start()
                self.pending_path.unlink()
                self.pending = False
            else:
                # Also resumes a previously interrupted migration/start on our exact version.
                self.oneoff("manage.py", "migrate", "--noinput")
                self.start()
        report_dir = (
            self.home
            / "reports"
            / (time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8])
        )
        report_dir.mkdir(parents=True, mode=0o700)
        command = ["manage.py", "import_staffing_xlsx", *self.roster_args()]
        self.oneoff(
            *command,
            "--report",
            "/opt/staffing-reports/preview.json",
            source=True,
            reports=report_dir,
        )
        if self.args.apply:
            self.oneoff(
                *command,
                "--apply",
                "--report",
                "/opt/staffing-reports/applied.json",
                source=True,
                reports=report_dir,
            )
            print("Импорт завершён. Отчёты: " + str(report_dir))
        else:
            print("Сверка с базой выполнена без записи. Отчёт: " + str(report_dir))


def main():
    parser = argparse.ArgumentParser(
        prog="import-staffing.sh",
        description="Штатка XLSX в существующий Docker-комплект, без интернета и пересборки.",
    )
    parser.add_argument("xlsx", type=Path, help="Путь к XLSX на этом сервере")
    parser.add_argument(
        "--stack",
        type=Path,
        default=Path.cwd(),
        help="Папка с ctl.sh, images.env и .env",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Резервная копия, установка файлов/миграций и импорт",
    )
    parser.add_argument(
        "--skip-invalid-iin",
        action="store_true",
        help="Загрузить неверный ИИН как незаполненный",
    )
    parser.add_argument("--sheet")
    parser.add_argument("--config", type=Path)
    args = parser.parse_args()
    installer = None
    lock = None
    try:
        installer = Installer(args)
        # The lock lives on the existing ctl file's sibling, not inside temporary extraction.
        lock_path = installer.stack / ".staffing-import.lock"
        lock = os.fdopen(os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600), "w")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise InstallError(
                "Другой запуск загрузчика ещё работает с этим комплектом."
            ) from None
        installer.run()
    except (InstallError, OSError, ValueError) as exc:
        print("ОШИБКА: " + str(exc), file=sys.stderr)
        if installer and installer.stopped:
            if not installer.started_install:
                print(
                    "Установка не начата; возобновляю прежнее приложение.",
                    file=sys.stderr,
                )
                try:
                    installer.start()
                except InstallError:
                    print(
                        "Не удалось запустить приложение; проверьте bash ctl.sh ps / logs.",
                        file=sys.stderr,
                    )
            else:
                print(
                    "Обновление остановлено. Резервная копия в .staffing-import/backups. "
                    "Сохраните .staffing-import и журнал ошибки; не удаляйте тома Docker.",
                    file=sys.stderr,
                )
        return 1
    finally:
        if lock:
            lock.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
