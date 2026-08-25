"""У КАЖДОГО действия журнала есть русская подпись на экране.

ЗАЧЕМ ЭТА ПРОБА ЖИВЁТ В БЭКЕНДЕ, а карта подписей — на клиенте. Закрытый мир
кодов ведёт сервер (`ACTIONS`), и растёт он оттуда же: новое действие
заводится строкой в `audit_service`, а подпись к нему дописывают на экране —
или забывают. Забытая подпись не ломает ничего: экран печатает код как есть,
и человек читает `SECURITY_EVENT_PLACEMENT_BY_DEPUTY` вместо «Расстановка
изменена замещающим» (Plane №46). Такое замечают через недели, и только те,
кто и так знает коды.

Сторож стоит там, где растёт список, — иначе он бы стерёг вчерашний.

Карта читается ИЗ ИСХОДНИКА, а не из собранного бандла: подпись — это
литерал, и разбор ключей объекта отвечает на единственный вопрос, который
здесь задан, — «для какого кода она написана».
"""
import pathlib
import re

from organization_management.apps.operations.audit_service import ACTIONS

# Фронт лежит соседом бэкенда в одном репозитории; путь считается от файла
# пробы, а не от cwd — прогон зовут и из корня, и из каталога приложения.
LABELS_FILE = (
    pathlib.Path(__file__).resolve().parents[5]
    / "PersonalRecordFront"
    / "entities"
    / "audit-log"
    / "index.ts"
)
# Ключ карты: `ИМЯ_ДЕЙСТВИЯ: "подпись",` — имена действий заглавные с
# подчёркиваниями, поэтому чужие ключи файла под шаблон не попадают.
KEY_PATTERN = re.compile(r"^\s{2}([A-Z][A-Z0-9_]+):\s*\"", re.MULTILINE)


def labelled_actions():
    assert LABELS_FILE.exists(), (
        f"карта подписей действий не найдена: {LABELS_FILE}. "
        "Фронт переехал — поправьте путь, а не удаляйте сторожа."
    )
    source = LABELS_FILE.read_text(encoding="utf-8")
    marker = "export const AUDIT_ACTION_LABEL"
    assert marker in source, (
        "в файле нет карты AUDIT_ACTION_LABEL — её переименовали или снесли; "
        "без неё экран аудита снова печатает коды машинными строками"
    )
    body = source[source.index(marker) :]
    body = body[: body.index("};")]
    return set(KEY_PATTERN.findall(body))


def test_audit_action_labels_cover_every_action():
    """Каждое действие сервера названо по-русски на экране."""
    missing = ACTIONS - labelled_actions()

    assert missing == set(), (
        "у этих действий нет подписи на экране аудита — они приедут туда "
        f"машинной строкой: {sorted(missing)}"
    )


def test_audit_action_labels_have_no_phantom_codes():
    """И обратно: подпись без действия — обещание, которого не бывает.

    Такой ключ переживает переименование кода на сервере и делает вид, что
    подпись есть, — а на экран приходит новый код без неё.
    """
    phantom = labelled_actions() - ACTIONS

    assert phantom == set(), (
        "эти подписи не соответствуют ни одному действию сервера: "
        f"{sorted(phantom)}"
    )
