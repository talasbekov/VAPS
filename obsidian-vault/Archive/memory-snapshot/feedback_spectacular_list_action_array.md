---
name: spectacular-list-action-array
description: "drf-spectacular оборачивает 200 в массив по ИМЕНИ экшена list, а не по форме ответа — schema.d.ts врёт при верном рантайме"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 913c8486-c976-4cc1-a4f8-9c4f7bfaf9e1
---

Если ViewSet-экшен называется `list`, drf-spectacular объявляет ответ **массивом**
независимо от реальной формы тела: `_is_list_view` смотрит `self.view.action ==
'list'` (openapi.py:145-147), дальше `build_array_type` (openapi.py:1527-1541).
Объектный ответ `{business_date, division_id, rows}` уезжает в схему как
`type: array, items: $ref`.

Лечится `extend_schema_serializer(many=False)` — **декоратор КЛАССА**, поэтому
`inline_serializer` (возвращает экземпляр) не подходит: нужен отдельный класс
сериализатора ответа. Прецедент в репо — `_SingleIssuedExpenseReport`
(`apps/operations/submissions/api/views.py:126-129`).

**Why:** дефект тихий в самом опасном смысле — рантайм-тело правильное, тесты
API зелёные, `test_schema_drift` зелёный (он сравнивает schema.yaml со
свежесгенерированным собой), grep пути в schema.d.ts зелёный. Врёт только
типизация у потребителя-фронта, и всплывает это через стори, у другого агента.

**How to apply:** в любой стори, добавляющей `def list` с объектным (не
списочным) ответом, заводить AC, ассертящий ФОРМУ в schema.yaml:
`get.responses.'200'.content.'application/json'.schema` обязан быть `$ref`, а не
`type: array`. Проверять красной пробой — снять `many=False` и убедиться, что
схема действительно ломается (в 10.1b проба покраснела). ⚠️ Прецеденты на
`@action` (например `ExpenseReportViewSet.period`) этой ловушки НЕ содержат — у
них имя экшена не `list`, и копирование их `@extend_schema` вводит в заблуждение.
См. [[vaps-verify-against-raise-sites]], [[redundant-guards-vacuous-probe]].
