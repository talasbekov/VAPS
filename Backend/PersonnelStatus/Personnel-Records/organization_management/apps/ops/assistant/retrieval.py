"""Bounded lexical retrieval within an already authorized corpus."""
import re


def words(value):
    return {word[:6] for word in re.findall(r"[\w]+", value.lower().replace("ё", "е")) if len(word) > 2}


def retrieve(question, verified_turns, permitted, limit=6):
    current = words(question)
    followup = len(current) < 3 or bool(current & {"дальше", "следую", "потом", "уточни", "подроб"})
    previous = words(" ".join(turn["question"] + " " + turn["answer"] for turn in verified_turns[-1:])) if followup else set()
    def score(row):
        title, body = words(row.title), words(row.text)
        return (len(current & title) * 8 + len(current & body) * 2
                + len(previous & title) * 3 + len(previous & body))
    ranked = sorted(enumerate(permitted), key=lambda item: (-score(item[1]), not item[1].id.startswith("guide_"), item[0]))
    return [row for _, row in ranked if score(row) > 0][:max(0, min(limit, 6))]
