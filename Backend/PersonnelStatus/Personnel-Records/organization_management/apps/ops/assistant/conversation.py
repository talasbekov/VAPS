"""Signed, short-lived documentation history. Not a persisted business record."""
from django.core import signing
import json
from .knowledge import VERSION

SALT = "smart-josparlau.documentation-dialogue.v1"
MAX_AGE = 1800


class UTF8Serializer:
    """Avoid six-byte ASCII escapes for every Cyrillic character in signed JSON."""
    def dumps(self, obj):
        return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")

    def loads(self, value):
        return json.loads(value.decode("utf-8"))


def pack(turns, actor, stamp, read_context=None):
    payload = {"actor": actor, "stamp": stamp, "version": VERSION, "turns": turns}
    if read_context is not None:
        from .read_spec import validate_spec
        payload['readContext'] = validate_spec(read_context)
    payload['turns']=list(turns)
    while True:
        token = signing.dumps(payload, salt=SALT, serializer=UTF8Serializer, compress=False)
        if len(token) <= 65536:
            return token
        if not payload['turns']:
            raise ValueError("Conversation wire limit exceeded")
        payload['turns'].pop(0)


def valid_turn(turn):
    return (isinstance(turn, dict) and set(turn) == {"question", "answer"}
            and isinstance(turn["question"], str) and len(turn["question"]) <= 4000
            and isinstance(turn["answer"], str) and len(turn["answer"]) <= 8000)


def load(token, actor, stamp):
    if token is None:
        return [], False
    if not isinstance(token, str) or len(token) > 65536:
        return [], True
    try:
        data = signing.loads(token, salt=SALT, max_age=MAX_AGE, serializer=UTF8Serializer)
        turns = data.get("turns") if isinstance(data, dict) else None
        if (not isinstance(data, dict) or set(data) not in ({"actor", "stamp", "version", "turns"}, {"actor", "stamp", "version", "turns", "readContext"})
                or data["actor"] != actor or data["stamp"] != stamp or data["version"] != VERSION
                or not isinstance(turns, list) or len(turns) > 6 or not all(valid_turn(t) for t in turns)
                or sum(len(t["question"]) + len(t["answer"]) for t in turns) > 12000):
            return [], True
        return turns, False
    except (signing.BadSignature, ValueError, TypeError):
        return [], True


def issue(turns, question, answer, actor, stamp):
    latest = {"question": question, "answer": answer}
    if not valid_turn(latest):
        raise ValueError("Invalid conversation turn")
    bounded = [*turns[-5:], latest]
    while sum(len(t["question"]) + len(t["answer"]) for t in bounded) > 12000:
        bounded.pop(0)
    return pack(bounded, actor, stamp)


def retain(turns, actor, stamp, read_context=None):
    """Keep verified documentation context without appending business records."""
    return pack(turns, actor, stamp, read_context)


def read_context(token, actor, stamp):
    if not token or load(token, actor, stamp)[1]:
        return None
    try:
        data = signing.loads(token, salt=SALT, max_age=MAX_AGE, serializer=UTF8Serializer)
    except signing.BadSignature:
        return None
    value = data.get('readContext')
    if value is not None:
        from .read_spec import validate_spec
        return validate_spec(value)
    return None
