"""Бланки документов обезличены (Plane №165).

ЗАЧЕМ. Бланки в `document_templates/` сняты С ОБРАЗЦОВ заказчика, а в образцах
— настоящие охраняемые лица: ФИО и должности, даты рождения, группа крови,
аллергии, номера броней, фамилии сопровождающих и позывные. Из бланка эти
данные стираются руками, и при каждом шаге они проверялись глазами — но глаз
не правило: следующий бланк снимут с образца и забудут, а личные данные уедут
в репозиторий и в каждую его копию.

ЧЕМ СТЕРЕЖЁТСЯ. ПРИЗНАКАМИ личных данных, а не списком слов.

Первая редакция собирала запретные слова из образцов и держала рядом список
разрешённых подписей — и немедленно обвинила бланк «Сводных данных» в утечке
за слова «Аллергии», «Ограничения», «Размер». Это ПОДПИСИ КОЛОНОК, им место в
бланке; список разрешённого пришлось бы дописывать при каждом новом документе,
то есть сторож требовал бы ухода и всё равно врал. Признак описывает, КАК
ВЫГЛЯДЯТ личные данные, и от подписей не зависит.

Отдельно стерегутся КАРТИНКИ: портрет охраняемого лица лежит в `word/media/`
двоичным файлом, и проверка по тексту его не видит.
"""
import hashlib
import pathlib
import re
import zipfile

import pytest

TEMPLATES_DIR = pathlib.Path(__file__).resolve().parents[1] / "document_templates"
# Путь СЧИТАЕТСЯ ОТ ФАЙЛА ПРОБЫ, а не от cwd: прогон зовут и из корня бэкенда,
# и из каталога приложения. Уровни: tests → ops → apps → organization_management
# → Personnel-Records → PersonnelStatus → Backend → корень репозитория.
_ROOT = pathlib.Path(__file__).resolve().parents[7]
SAMPLES_DIR = _ROOT / "docs" / "PersonnelStatus"
UPLOADS_DIR = _ROOT / "Smart Josparlau (Прототип HTML)" / "uploads"

_PERSONAL = (
    # «Иванов И.» и «И.Иванов» — фамилия с инициалом.
    ("ФИО с инициалом", re.compile(r"\b[А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ]\.|\b[А-ЯЁ]\.\s?[А-ЯЁ][а-яё]{2,}")),
    # Позывной: «poz1-30», «Poz-2-18», «poz 1-30».
    ("позывной", re.compile(r"\bpoz[\s-]?\d+[-–]\d+", re.IGNORECASE)),
    # Конкретная дата в бланке — это уже данные, а не форма.
    ("дата", re.compile(r"\b\d{2}\.\d{2}\.\d{4}\b")),
    # Группа крови: «А (II) Rh +».
    ("группа крови", re.compile(r"\b[АABО0]\s?\((?:I{1,3}|IV)\)")),
    # Номер брони или комнаты: «№ 1620».
    ("номер", re.compile(r"№\s?\d{3,}")),
)


def document_text(path):
    """Весь текст `.docx`: тело, таблицы, колонтитулы — ВСЁ, куда личные
    данные могли попасть. `python-docx` показал бы только тело."""
    with zipfile.ZipFile(path) as archive:
        chunks = []
        for name in archive.namelist():
            if name.startswith("word/") and name.endswith(".xml"):
                raw = archive.read(name).decode("utf-8", errors="ignore")
                chunks.append(re.sub(r"<[^>]+>", " ", raw))
    return " ".join(chunks)


def media_hashes(path):
    """Хеши картинок внутри `.docx`.

    Сравнение по СОДЕРЖИМОМУ, а не по имени: `image1.png` называется одинаково
    у всех документов, а нас интересует, тот ли это снимок.
    """
    found = {}
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if name.startswith("word/media/"):
                found[hashlib.sha256(archive.read(name)).hexdigest()] = name
    return found


def sample_files():
    """Образцы заказчика: и присланные папкой, и лежащие в выгрузке прототипа."""
    for folder in (SAMPLES_DIR, UPLOADS_DIR):
        if folder.exists():
            yield from folder.glob("*.docx")


@pytest.fixture(scope="module")
def readable_samples():
    """Сторож сравнения: образцы обязаны читаться, иначе проверять нечего.

    Битые образцы у заказчика есть (Plane №164) — они пропускаются, но если
    не читается НИ ОДИН, проба говорит это вслух, а не зеленеет.
    """
    files = []
    for sample in sample_files():
        try:
            document_text(sample)
        except (zipfile.BadZipFile, OSError):
            continue
        files.append(sample)
    if not files:
        pytest.skip("образцов на машине нет или все они битые — сравнивать не с чем")
    return files


def test_no_template_carries_personal_data():
    """Ни в одном бланке нет ФИО, позывных, дат, групп крови и номеров броней."""
    leaks = {}
    for template in sorted(TEMPLATES_DIR.glob("*.docx")):
        text = document_text(template)
        found = []
        for label, pattern in _PERSONAL:
            hits = sorted(set(pattern.findall(text)))
            if hits:
                found.append(f"{label}: {hits[:5]}")
        if found:
            leaks[template.name] = found

    assert leaks == {}, (
        "в бланках остались личные данные из образцов заказчика — их нельзя "
        f"держать в репозитории: {leaks}"
    )


def test_the_guard_notices_every_kind_of_leak(tmp_path):
    """КРАСНАЯ ПРОБА САМОГО СТОРОЖА.

    Без неё «утечек нет» означало бы лишь, что разбор ничего не нашёл.
    Проверяется КАЖДЫЙ признак: сторож, ловящий один из пяти, стережёт пятую
    часть и молчит про остальное.
    """
    samples = {
        "ФИО с инициалом": "Шаубиденов А.",
        "позывной": "poz 1-30",
        "дата": "07.12.1986",
        "группа крови": "А (II) Rh +",
        "номер": "№ 1620",
    }
    for label, value in samples.items():
        fake = tmp_path / "leaky.docx"
        with zipfile.ZipFile(fake, "w") as archive:
            archive.writestr("word/document.xml", f"<w:t>{value}</w:t>")
        text = document_text(fake)

        caught = [name for name, pattern in _PERSONAL if pattern.search(text)]

        assert label in caught, f"сторож не заметил {label}: {value!r}"


def test_no_template_carries_a_picture_from_the_samples(readable_samples):
    """Фотографий и флагов из образцов в бланках нет.

    Замена подписей не спасает: портрет лежит двоичным файлом в
    `word/media/`, и текстовая проверка его не видит.
    """
    sample_pictures = {}
    for sample in readable_samples:
        sample_pictures.update(media_hashes(sample))

    leaks = {}
    for template in sorted(TEMPLATES_DIR.glob("*.docx")):
        same = {
            name: sample_pictures[digest]
            for digest, name in media_hashes(template).items()
            if digest in sample_pictures
        }
        if same:
            leaks[template.name] = same

    assert leaks == {}, (
        "в бланках лежат картинки из образцов заказчика (портреты и флаги) — "
        f"их нельзя держать в репозитории: {leaks}"
    )
