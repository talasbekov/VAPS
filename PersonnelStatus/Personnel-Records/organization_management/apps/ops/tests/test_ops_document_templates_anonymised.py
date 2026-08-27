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
import html
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

#: Пробел ВНУТРИ строки — но не перевод строки. Абзацы и ячейки таблицы
#: разделены в `document_text` переводом строки, и признак не имеет права
#: через него перешагивать: «Резерв» в одной ячейке и «А.ж.» (казахское
#: «ағымдағы жылдың», «текущего года») в начале следующего абзаца — не
#: «Резерв А.», а два разных куска бланка (Plane №183).
_INLINE = r"[^\S\n]"

_PERSONAL = (
    # «Иванов И.» и «И.Иванов» — фамилия с инициалом.
    ("ФИО с инициалом", re.compile(
        rf"\b[А-ЯЁ][а-яё]{{2,}}{_INLINE}{{1,3}}[А-ЯЁ]\.|\b[А-ЯЁ]\.{_INLINE}?[А-ЯЁ][а-яё]{{2,}}"
    )),
    # Позывной ДВУХ ЗАПИСЕЙ: «poz1-30», «Poz-2-18», «poz 1-30» — и «SR-133»,
    # «ПОЗ 14». Вторая форма (буквы, дефис, число, БЕЗ числа перед дефисом)
    # сторожу была не видна, и через эту дыру в бланк расстановки уехали 73
    # позывных и 64 настоящие фамилии сотрудников заказчика: «Күзет офицері:
    # Абдрахманов SR-133;» (найдено выгрузкой на стенде, Plane №164).
    ("позывной", re.compile(
        rf"\b(?:poz|sr|поз)(?:{_INLINE}|-|–)?\d+(?:{_INLINE}?[-–]{_INLINE}?\d+)?\b",
        re.IGNORECASE,
    )),
    # Фамилия БЕЗ инициала и без позывного рядом: в образцах расстановки людей
    # пишут и так — столбцом, где позывной стоит в соседней ячейке. Признак
    # требует характерного окончания, а не «слова с большой буквы»: иначе под
    # него попали бы казахские подписи формы, и сторож обвинял бы бланк за то,
    # ради чего бланк существует.
    ("фамилия", re.compile(
        r"\b[А-ЯЁӘҒҚҢӨҰҮҺІ][а-яёәғқңөұүһі]{2,}"
        r"(?:ов|ев|ин|нов|баев|аев|иев|бек|улы|ұлы|қызы|кызы)\b"
    )),
    # Конкретная дата в бланке — это уже данные, а не форма.
    ("дата", re.compile(r"\b\d{2}\.\d{2}\.\d{4}\b")),
    # Группа крови: «А (II) Rh +».
    ("группа крови", re.compile(rf"\b[АABО0]{_INLINE}?\((?:I{{1,3}}|IV)\)")),
    # Номер брони или комнаты: «№ 1620».
    ("номер", re.compile(rf"№{_INLINE}?\d{{3,}}")),
)


#: Абзац `<w:p>` и ячейка таблицы `<w:tc>` — НАСТОЯЩИЕ границы текста: то,
#: что стоит по разные стороны от них, читатель бланка видит как разные
#: куски, а не как одну фразу. Мягкий перенос `<w:br/>` внутри абзаца —
#: тоже граница: читатель видит две строки, а не одну фразу.
_BLOCK_END = re.compile(r"</w:(?:p|tc|tr)>|<w:(?:br|cr)\s*/?>")
#: Содержимое одного текстового прогона. Word рвёт прогоны где угодно —
#: посреди слова, на смене начертания, после проверки орфографии, — поэтому
#: внутри абзаца прогоны склеиваются ВПЛОТНУЮ, без разделителя: так же, как
#: их показывает Word. Разделитель здесь прятал бы «Ива|нов И.» от сторожа.
_RUN_TEXT = re.compile(r"<w:t(?:\s[^>]*)?>(.*?)</w:t>", re.S)


def document_text(path):
    """Весь текст `.docx`: тело, таблицы, колонтитулы — ВСЁ, куда личные
    данные могли попасть. `python-docx` показал бы только тело.

    Текст собирается ПО АБЗАЦАМ И ЯЧЕЙКАМ, а не заменой всех тегов на пробел.
    Прежняя редакция склеивала документ в одну строку, и признак «ФИО с
    инициалом» перешагивал через границу ячейки: слово «Резерв» в конце одной
    и «А.ж.» в начале следующей читались как «Резерв А.» — бланк расстановки
    краснел на пустом месте (Plane №183). Внутри абзаца прогоны, наоборот,
    склеиваются вплотную: Word рвёт их посреди слова, и разделитель между
    ними спрятал бы настоящую фамилию.
    """
    lines = []
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if not (name.startswith("word/") and name.endswith(".xml")):
                continue
            raw = archive.read(name).decode("utf-8", errors="ignore")
            for block in _BLOCK_END.split(raw):
                text = html.unescape("".join(_RUN_TEXT.findall(block)))
                if text.strip():
                    lines.append(text)
    return "\n".join(lines)


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
        "фамилия": "Абдрахманов",
    }
    #: Вторая запись позывного — та самая, через которую утекли фамилии
    #: (Plane №164). Проверяется отдельной строкой, а не заменой первой:
    #: сторож обязан видеть ОБЕ.
    samples_extra = {"позывной": "SR-133"}
    for label, value in list(samples.items()) + list(samples_extra.items()):
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


def _docx_with_body(path, body_xml):
    """Минимальный `.docx` с заданным телом — для проб самого сторожа."""
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", body_xml)
    return path


def test_the_guard_does_not_read_across_a_line_boundary(tmp_path):
    """КРАСНАЯ ПРОБА ГРАНИЦЫ (Plane №183).

    Мягкий перенос `<w:br/>` — один-единственный тег, и прежняя редакция
    `document_text` меняла его на ОДИН пробел: «Резерв» в конце строки и
    «А.ж.» («ағымдағы жылдың» — текущего года) в начале следующей склеивались
    в «Резерв А.» и обвиняли бланк расстановки. Границу держит только перевод
    строки: верните замену тегов пробелом — проба покраснеет.

    Перенос выбран нарочно вместо границы ячейки: ячеек разделяет с десяток
    тегов, и склейка дала бы столько же пробелов — признак не сработал бы и
    без границы, то есть проба стерегла бы не то, ради чего написана.
    """
    fake = _docx_with_body(
        tmp_path / "soft-break.docx",
        "<w:p><w:r><w:t>Резерв</w:t><w:br/>"
        '<w:t xml:space="preserve">А.ж. 20 сәуір</w:t></w:r></w:p>',
    )

    text = document_text(fake)

    assert "Резерв" in text and "А.ж." in text, "текст строк потерян"
    caught = [name for name, pattern in _PERSONAL if pattern.search(text)]
    assert caught == [], f"сторож склеил соседние строки в личные данные: {caught}"


def test_the_guard_does_not_read_across_a_cell_boundary(tmp_path):
    """Соседние ячейки таблицы — тоже не одна фраза.

    Это ровно случай бланка расстановки: «Резерв» стоит отдельной ячейкой,
    следующий абзац начинается с «А.ж.».
    """
    fake = _docx_with_body(
        tmp_path / "two-cells.docx",
        "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Резерв</w:t></w:r></w:p></w:tc>"
        "<w:tc><w:p><w:r><w:t>А.ж. 20 сәуір</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
    )

    caught = [name for name, pattern in _PERSONAL if pattern.search(document_text(fake))]

    assert caught == [], f"сторож склеил соседние ячейки в личные данные: {caught}"


def test_a_wide_gap_inside_one_line_is_not_a_name(tmp_path):
    r"""Разрядка внутри строки — вёрстка, а не фамилия с инициалом.

    Признак ограничен тремя пробелами нарочно: `\s+` без границы принимал за
    «Иванов И.» слово и инициал, разнесённые по разным концам строки табами.
    """
    fake = _docx_with_body(
        tmp_path / "wide-gap.docx",
        '<w:p><w:r><w:t xml:space="preserve">Резерв' + " " * 23 + 'А.ж.</w:t></w:r></w:p>',
    )

    caught = [name for name, pattern in _PERSONAL if pattern.search(document_text(fake))]

    assert caught == [], f"разрядка принята за личные данные: {caught}"


def test_the_guard_still_sees_a_name_split_across_runs(tmp_path):
    """ОБРАТНАЯ СТОРОНА ТОЙ ЖЕ ГРАНИЦЫ.

    Word рвёт прогоны где угодно — посреди слова, на смене начертания. Внутри
    ОДНОГО абзаца такие куски обязаны склеиваться вплотную, иначе граница,
    введённая ради «Резерв А.», спрячет настоящую фамилию. Проба падает, если
    в `document_text` между прогонами появится разделитель.
    """
    fake = _docx_with_body(
        tmp_path / "split-run.docx",
        "<w:p><w:r><w:t>Шауби</w:t></w:r><w:r><w:t>денов</w:t></w:r>"
        '<w:r><w:t xml:space="preserve"> А.</w:t></w:r></w:p>',
    )

    text = document_text(fake)

    assert "Шаубиденов А." in text, f"прогоны не склеились: {text!r}"
    caught = [name for name, pattern in _PERSONAL if pattern.search(text)]
    assert "ФИО с инициалом" in caught, "фамилия, разорванная прогонами, не поймана"
