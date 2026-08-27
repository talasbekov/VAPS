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

И отдельно — СВОЙСТВА ФАЙЛА (`docProps/`). Их не видно ни в тексте, ни в
картинках, а Word держит там автора, последнего правившего и организацию.
Первая редакция сторожа их не читала, и это была не гипотеза: в ПЯТИ бланках
лежали настоящие ФИО сотрудников заказчика (Plane №177). Word показывает их в
свойствах и подставляет в поля шаблона — то есть при выгрузке они уехали бы
заказчику обратно как автор документа системы.
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


#: Поля свойств файла, в которых оказываются ЛЮДИ И ОРГАНИЗАЦИИ. Список
#: закрытый и короткий: остальные поля (даты правки, число слов, версия Word)
#: личных данных не несут, и требовать их вычистки значило бы придираться.
_PROPERTY_FIELDS = (
    "dc:creator",
    "cp:lastModifiedBy",
    "dc:title",
    "dc:subject",
    "dc:description",
    "cp:keywords",
    "Company",
    "Manager",
)


def document_properties(path):
    """Заполненные свойства файла: поле → значение.

    Читается СЫРОЙ XML, а не через `python-docx`: тот отдаёт лишь часть
    `core.xml` и не показывает `app.xml` с организацией вовсе.
    """
    found = {}
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if not name.startswith("docProps/") or not name.endswith(".xml"):
                continue
            raw = archive.read(name).decode("utf-8", errors="ignore")
            for field in _PROPERTY_FIELDS:
                match = re.search(rf"<{field}[^>]*>(.*?)</{field}>", raw, re.S)
                if match and match.group(1).strip():
                    found[field] = match.group(1).strip()
    return found


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


def test_no_template_carries_filled_in_properties():
    """У БЛАНКА СВОЙСТВ НЕТ — они пусты все до одного.

    Правило нарочно грубее, чем «нет личных данных»: пусто или не пусто —
    вопрос без толкований, а «похоже ли это на человека» — вопрос с
    толкованием, и отвечать на него разбором значит промахиваться. Первая
    редакция этой пробы искала людей по виду строки и немедленно обвинила
    бланки за автора «Smart Josparlau» — имя самой системы под тем же
    признаком «Имя Фамилия».

    Бланк — форма, а не документ: автора, организации и темы у него нет.
    Заполненное поле здесь всегда означает след того, у кого форму сняли.
    """
    leaks = {}
    for template in sorted(TEMPLATES_DIR.glob("*.docx")):
        filled = document_properties(template)
        if filled:
            leaks[template.name] = filled

    assert leaks == {}, (
        "в свойствах бланков остались значения — Word показывает их в "
        f"свойствах файла и подставляет в поля шаблона: {leaks}"
    )


def test_the_guard_would_notice_a_name_in_the_properties(tmp_path):
    """КРАСНАЯ ПРОБА проверки свойств.

    Без неё «в свойствах чисто» означало бы лишь, что разбор ничего не нашёл
    — а разбор свойств легко промахивается: полей несколько, лежат они в
    разных файлах `docProps/`, и `python-docx` показывает не все.
    """
    fake = tmp_path / "leaky.docx"
    with zipfile.ZipFile(fake, "w") as archive:
        archive.writestr(
            "docProps/core.xml",
            "<cp:coreProperties><dc:creator>Жаксыбаев Кайрат</dc:creator>"
            "</cp:coreProperties>",
        )
        archive.writestr(
            "docProps/app.xml",
            "<Properties><Company>СГО РК</Company></Properties>",
        )

    properties = document_properties(fake)

    assert properties["dc:creator"] == "Жаксыбаев Кайрат"
    assert properties["Company"] == "СГО РК"


def test_an_empty_property_is_not_a_leak(tmp_path):
    """Пустое поле и САМОЗАКРЫВАЮЩИЙСЯ тег — не находка.

    `python-docx` пересохраняет очищенное поле как `<dc:creator/>`, и разбор,
    ищущий пару тегов, такого поля не видит вовсе. Это верно по сути (значения
    нет) и опасно по формулировке: соседняя сессия чуть не приняла «тега нет»
    за «файл чист» на ещё НЕ очищенном файле. Проба закрепляет, что пустое
    поле в находки не попадает — ни в одном из двух видов записи.
    """
    fake = tmp_path / "clean.docx"
    with zipfile.ZipFile(fake, "w") as archive:
        archive.writestr(
            "docProps/core.xml",
            "<cp:coreProperties><dc:creator/><cp:lastModifiedBy>  </cp:lastModifiedBy>"
            "</cp:coreProperties>",
        )

    assert document_properties(fake) == {}
