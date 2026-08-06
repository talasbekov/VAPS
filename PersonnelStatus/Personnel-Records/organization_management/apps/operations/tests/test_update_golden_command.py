"""Команда обновления эталона: что она пишет и когда молчит.

Три свойства несут срез. На нетронутом коде она НИЧЕГО не пишет — иначе каждый
её запуск выглядел бы изменением эталона в git. `--check` не трогает файлы и
отличается от обычного прогона НЕ ТОЛЬКО текстом: расхождение обязано быть
заметно автоматике. И записывает она ровно то, что читает сверка, — иначе
эталон разошёлся бы с тестом, оставаясь зелёным.

Все пробы идут на КОПИИ набора: правка настоящего эталона из теста сделала бы
прогон необратимым, а соседние тесты — зависимыми от порядка.
"""
import json
import shutil

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from organization_management.apps.operations import golden
from organization_management.apps.operations.management.commands import update_golden

REAL_ROOT = update_golden.GOLDEN_ROOT


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    """Копия набора эталона в своём каталоге."""
    root = tmp_path / "golden"
    shutil.copytree(REAL_ROOT, root)
    monkeypatch.setattr(update_golden, "GOLDEN_ROOT", root)
    return root


def run(**options):
    call_command("update_golden", **options)


def case_of(root, name="case_001_ordinary_day"):
    return root / name


# ── Молчит, когда нечего менять ──────────────────────────────────────────


def test_an_untouched_set_is_left_alone(sandbox, capsys):
    """Если бы команда переписывала файлы всегда, каждый её прогон попадал бы в
    git как изменение эталона — и настоящий дрейф утонул бы в шуме."""
    before = {
        path: path.read_bytes()
        for path in sandbox.rglob("*")
        if path.is_file()
    }

    run()

    assert capsys.readouterr().out.strip().startswith("Эталон совпадает")
    assert {path: path.read_bytes() for path in before} == before


def test_an_untouched_set_passes_the_check(sandbox):
    run(check=True)


def test_the_files_are_not_even_touched_when_content_matches(sandbox):
    """Не «содержимое то же», а файл НЕ ПЕРЕПИСАН: переписанный тем же
    содержимым меняет время изменения и всё равно виден инструментам."""
    document = case_of(sandbox) / golden.DOCUMENT_FILE
    before = document.stat().st_mtime_ns

    run()

    assert document.stat().st_mtime_ns == before


# ── Пишет, когда эталон разошёлся ────────────────────────────────────────


def _spoil(case):
    """Испортить хранимый эталон — так же выглядел бы дрейф кода."""
    (case / golden.DOCUMENT_FILE).write_bytes(b"<w:body/>")


def test_a_drifted_document_is_rewritten(sandbox, capsys):
    case = case_of(sandbox)
    _spoil(case)

    run()

    assert "обновлён" in capsys.readouterr().out
    inputs = golden.load_case(
        json.loads((case / golden.INPUT_FILE).read_text(encoding="utf-8"))
    )
    assert (case / golden.DOCUMENT_FILE).read_bytes() == golden.expected_document(
        inputs
    )


def test_drifted_numbers_are_rewritten(sandbox):
    case = case_of(sandbox)
    (case / golden.NUMBERS_FILE).write_text("{}\n", encoding="utf-8")

    run()

    stored = json.loads((case / golden.NUMBERS_FILE).read_text(encoding="utf-8"))
    assert stored != {}


def test_what_is_written_is_written_canonically(sandbox):
    """Эталон читают глазами: записанный иначе, чем ожидает сверка, он краснил
    бы её на следующем же прогоне."""
    case = case_of(sandbox)
    (case / golden.NUMBERS_FILE).write_text("{}\n", encoding="utf-8")

    run()

    raw = (case / golden.NUMBERS_FILE).read_text(encoding="utf-8")
    assert raw == golden.dumps(json.loads(raw))


# ── Режим проверки ───────────────────────────────────────────────────────


def test_check_refuses_loudly_when_the_set_has_drifted(sandbox):
    """Ненулевой выход, а не только текст: «разошлось» обязано отличаться от
    «всё в порядке» так, чтобы это заметила автоматика."""
    _spoil(case_of(sandbox))

    with pytest.raises(CommandError) as exc:
        run(check=True)

    assert "case_001_ordinary_day" in str(exc.value)


def test_check_does_not_repair_what_it_found(sandbox):
    """Иначе проверка чинила бы то, о чём сообщает, и второй её запуск подряд
    отвечал бы «всё в порядке» — расхождение исчезло бы незамеченным."""
    case = case_of(sandbox)
    _spoil(case)

    with pytest.raises(CommandError):
        run(check=True)

    assert (case / golden.DOCUMENT_FILE).read_bytes() == b"<w:body/>"


# ── Выбор случая и отказы ────────────────────────────────────────────────


def test_a_single_case_can_be_updated_alone(sandbox):
    first, second = case_of(sandbox), case_of(sandbox, "case_002_empty_division")
    _spoil(first)
    _spoil(second)

    run(case=first.name)

    assert (first / golden.DOCUMENT_FILE).read_bytes() != b"<w:body/>"
    assert (second / golden.DOCUMENT_FILE).read_bytes() == b"<w:body/>"


def test_an_unknown_case_is_refused(sandbox):
    with pytest.raises(CommandError):
        run(case="case_999_no_such_thing")


def test_an_empty_set_is_refused_rather_than_reported_as_fine(sandbox):
    """Молчаливый успех означал бы «эталон в порядке» там, где эталона нет."""
    for path in sandbox.iterdir():
        shutil.rmtree(path)

    with pytest.raises(CommandError):
        run()


def test_a_case_without_an_input_is_refused(sandbox):
    case = case_of(sandbox)
    (case / golden.INPUT_FILE).unlink()

    with pytest.raises(CommandError):
        run()
