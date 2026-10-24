# SHA-256 контроль целостности air-gap-экспорта (hd-1-5 / gap §3.10)

> **Тип:** bounded design (see [[accreditation-gap-analysis]] §3.10, `High`).
> **Статус:** РЕАЛИЗОВАНО 2026-08-22.

## Проблема

`docs/WIKI/accreditation-gap-analysis.md` §3.10: JSON+фото переносятся на терминал
вручную (USB, без сети) без контрольной суммы — порча/подмена файла при копировании
не обнаруживается перед загрузкой в терминал.

## Решение

Новый модуль `eventproject/services/export_integrity.py`:
- `sha256_bytes(data)`, `sha256_file(path)` (чанками, без загрузки файла в память целиком)
- `combined_sha256(file_hashes: dict[name, hex])` — детерминированный (сортировка по имени)
  общий хеш всего архива

**ZIP-эндпоинты** (уже архивы) — `manifest.json` дописывается последним файлом:
- `export_service.write_export_archive()` (`export_delta` не-CSV, Integration Spec v1.1)
- `file_download.py::download_photos` (легаси фото-архив)

**Однофайловые эндпоинты** — заголовок `X-Content-SHA256`:
- `export_delta?format=csv`
- `download_json`, `download_guests_json`, `download_all_guests_json`, `download_request_json`
  (легаси, через общий `_json_response()` в `file_download.py`)

## Итерация после code-review

Первая версия строила `manifest.json` через `zipf.read()` каждого уже записанного
файла архива — держало в памяти распакованное содержимое ВСЕХ фото/сканов
одновременно (риск OOM на крупных мероприятиях, ровно то, для чего эта задача
делается). Ревью (`/code-review medium`, автоматический forked-агент) поймало это
как Important-находку.

**Фикс:** хеш считается с диска чанками (`sha256_file`) **до** записи в архив —
`_add_media()`/`download_photos` больше не перечитывают уже собранный zip, а
накапливают только сами хеши (короткие строки), не байты файлов. Пиковая память —
один файл за раз, не сумма всех.

Заодно ревью отметило мёртвый код (`build_manifest` дублировал уже записанный
`attendees.json` в манифесте) — при рефакторинге под поштучное хеширование
`build_manifest` стал не нужен вообще (только тестовый API) и был удалён; тесты
переписаны на `combined_sha256` напрямую.

## Тесты

- `test_export_integrity.py` — unit (`sha256_bytes`, `sha256_file` на чанках/пустом
  файле, `combined_sha256` детерминированность/чувствительность к изменению)
- `test_export_delta.py` — `manifest.json` внутри ZIP `export_delta` покрывает
  каждый файл + `X-Content-SHA256` на CSV-варианте
- `test_export_whitelist.py` — заголовок на 4 легаси JSON-эндпоинтах +
  `manifest.json` в `download_photos`

Полный прогон: **683 теста OK** (9 skip, Postgres-only на SQLite).

## Не в скоупе

- Проверка на стороне терминала (внешний вендор, вне нашего контроля)
- Подпись манифеста (можно отдельной историей при необходимости)

## Связанные заметки

- [[accreditation-gap-analysis]] — §3.10
- [[integration-spec-v1]] — структура ZIP, которую расширяет манифест
