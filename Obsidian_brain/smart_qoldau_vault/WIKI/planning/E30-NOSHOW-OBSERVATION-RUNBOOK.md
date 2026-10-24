# E30 — наблюдение подтверждённых неявок

Принято локально 2026-09-17: sourcee057a5efaf229ff1aa03426aa9256a4011165ded → main630e6cc757f5d18a4381a87f653f215691ae1790. Independent APPROVE /tmp/qoldau-noshow-observation-review/report.md,70targeted/7PG16/realAppModule compile-init-HTTP. Ownfixture cleanup подтверждён. На объединённом main354tests/49suites+lint/buildPASS, tree=reviewed/clean.

## Использование после отдельного развёртывания

GET /v1/admin/consultations/no-show-observation?from=<UTC>&to=<UTC>, действующая QUALITY_TEAM либо SUPERADMIN сессия. Оба параметра поодиночке: строгие календарные UTC даты с Z и максимум миллисекундами. from<to<=observedAt, окно<=24ч. Правила существующих guards не менялись.

Когорта: statusCOMPLETED и endedAt в [from,to). cohortCompletedCount равен clientNoShowOutcomeCount + четырём остальным outcomeCounts + completedWithoutOutcomeCount. CLIENT_NO_SHOW здесь сохранённый итог эксперта, не noShowNotifiedAt/hint. ACTIVE/SCHEDULED/CANCELLED не входят даже при заполненном outcome. Поздно записанный исход относится к окну endedAt, не scheduled/start/hint.

completedWithoutEndedAtCountAllTime — отдельная глобальная группа COMPLETED без времени завершения; приписать её выбранному окну нельзя. В ответе нет идентификаторов, персональных данных, денег, rate/ratio/threshold/penalty/alert. state=observed только при успешном согласованном SELECT; non2xx означает отсутствие наблюдения, не нули. observedAt не даёт causal AS OF исторического состояния.

## Ограничения

Не объявлять эти rawcounts долей неявок среди запланированных сессий. Знаменатель, пороги и реагирование для no-show rate/alert требуют отдельного решения. Окно24ч ограничивает входные параметры, не сканируемые строки: alltime missingendedAt счётчик глобальный, подходящий новый индекс не добавлялся. Производительность требует отдельного evidence до эксплуатационного включения. Валидация UTC вынесена в pure sharedhelper без изменения push контракта; push regression прошла. Outcome/hint/payment/business поведение не менялось. Deploy/push/sharedmigrations не выполнялись.
