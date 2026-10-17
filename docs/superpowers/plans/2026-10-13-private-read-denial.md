# Паспорт, реестр объектов и история после отказа чтения

**Goal:** После подтверждённого отказа чтения не показывать старый паспорт, опубликованную версию, агрегаты реестра или строки истории до успешного GET.

**Design:** Переиспользовать проверенный actual Query/AbortSignal guard. Маскировать data в object registry/detail и двух history hooks при persistent denial. Обычный503 оставляет readonly данные; история получает inline Retry без закрытия окна. Права, сервер и mutations не меняются. Следующая переносимая поставка фиксируется после этого важного финального аудита; предыдущая D и её evidence сохраняются.

- [x] Browser RED: detail/version403→503, history403, registry denied aggregates.
- [x] Guard в четырёх hooks, inline history retry и состояние недоступности.
- [x] Typecheck, affected dev/production, source/helper review, gate.
- [x] Фактические readonly данные подтверждены; повтор итоговой Linux-поставки — план2026-10-13-reviewed-offline-release.
- [x] Журнал/задачи и source revision.
