---
name: feedback_schema_ref_equal_component_differs
description: Совпадение $ref в ответе не означает совпадения схемы — сверять компонент целиком
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e3b9b3a2-8005-48d7-86bc-1004854ac063
---

Проба «замена ручной обёртки на автовыводимую даёт байт-в-байт ту же схему» была
верна только для строки ответа (`$ref: '#/components/schemas/Paginated…List'`).
Сам компонент разъехался: у автовыводимого DRF-варианта есть `example`/`format: uri`
у next/previous, и next/previous НЕ попадают в `required` (у ручного
inline_serializer попадали).

**Why:** сравнение по точке использования ($ref, путь, статус) не видит правку
в разделяемом `components/schemas` — а именно оттуда клиентский кодоген берёт
типы (required → `next: string` vs `next?: string`).

**How to apply:** до/после сверять ПОЛНЫЙ дамп
`SchemaGenerator().get_schema(request=None, public=True)` через diff, не отдельные
узлы. Если расхождение однородно по всем вьюхам и совпадает с уже принятым
образцом (в ОМ — NotificationViewSet, у которого автообёртка с самого начала) —
это выравнивание по образцу, а не «ручной вызов несущий». Связано с
[[feedback_redundant_guards_vacuous_probe]], [[feedback_spectacular_list_action_array]].
