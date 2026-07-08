"""Story 6.4 — cmap-гвард вендоренных шрифтов PDF (AC-4).

Чистые тесты (БЕЗ ``django_db``): fontTools читает TTF напрямую. Гвард
гарантирует, что ОБА вендоренных Liberation Serif (Regular и Bold) покрывают
каждый символ канона §8: kk-титул (включая Ә/Ө/Ү/І/Һ/Ғ-класс), лейблы шапки,
«ИТОГО», хвост усечения «… ещё», цифры/пунктуацию ``_member_line``
(«—», «–», «.», «+») и ПОЛНЫЙ ru/kk-алфавит обеих регистров — ФИО членов,
звания и имена подразделений приходят ДАННЫМИ и не ограничены буквами
лейблов. Пропавший глиф в PDF — молчаливый tofu-квадрат, поэтому дыра в
cmap обязана валить гейт, а не ревью глазами.

fontTools — транзитивная зависимость fpdf2 (отдельно НЕ пинится, Task 2).
"""

from pathlib import Path

import pytest
from fontTools.ttLib import TTFont

from apps.documents.generators.expense_docx import (
    DOCX_COLUMN_LABELS,
    _FIXED_HEAD,
    _TOTALS_LABEL,
)

FONTS_DIR = Path(__file__).resolve().parents[1] / "generators" / "fonts"
FONT_FILES = ("LiberationSerif-Regular.ttf", "LiberationSerif-Bold.ttf")

# Канон текста PDF: kk-титул + полный класс специфичных kk-букв (обе
# регистровые формы), вся шапка, ИТОГО, хвост усечения, цифры и пунктуация
# _member_line (тире имени «—», тире периода «–», точки дат, «+N») + полный
# ru-алфавит: ФИО/звания/имена подразделений — произвольные данные (тофу
# на «Хасенов»/«Юрий» не должен зависеть от того, какие буквы случились в
# лейблах шапки).
_CANON_TEXT = "".join(
    (
        "ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ ЖЫЛҒЫ",
        "ӘәӨөҮүІіҺһҒғҚқҢңҰұ",
        "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ",
        "абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
        *DOCX_COLUMN_LABELS.values(),
        *_FIXED_HEAD,
        _TOTALS_LABEL,
        "… ещё",
        "0123456789",
        "—–.+ ",
    )
)
# Пробельные не сравниваем по одному (нет '\n'-глифа и не надо), но сам
# пробел — печатаемый символ канона и обязан быть в cmap.
REQUIRED_CHARS = {c for c in _CANON_TEXT if not c.isspace()} | {" "}


def test_license_vendored_next_to_fonts():
    license_path = FONTS_DIR / "LICENSE"
    assert license_path.is_file(), "текст SIL OFL 1.1 обязан лежать рядом с .ttf"
    text = license_path.read_text(encoding="utf-8")
    assert "SIL OPEN FONT LICENSE" in text
    assert "Liberation" in text


@pytest.mark.parametrize("font_file", FONT_FILES)
def test_cmap_covers_every_canon_char(font_file):
    path = FONTS_DIR / font_file
    assert path.is_file(), f"вендоренный шрифт отсутствует: {path}"
    cmap = TTFont(str(path)).getBestCmap()
    missing = sorted(c for c in REQUIRED_CHARS if ord(c) not in cmap)
    assert missing == [], f"{font_file} не покрывает глифы: {missing!r}"
