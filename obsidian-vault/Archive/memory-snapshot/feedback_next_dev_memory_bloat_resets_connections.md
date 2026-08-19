---
name: feedback-next-dev-memory-bloat-resets-connections
description: "«Падают разные спеки на /api/auth/csrf/» = раздувшийся next dev (6.7 ГБ), а не дефект приложения"
metadata:
  node_type: memory
  type: feedback
---

После долгого прогона (44 минуты обхода, 176 спек) процесс `next dev` в
PersonalRecordFront вырос до **6.7 ГБ RSS** при 14 ГБ на машине и 1 ГБ
свободной. В таком состоянии он рвёт соединения: спеки падают на самом первом
запросе `GET /api/auth/csrf/` — то `TimeoutError`, то `read ECONNRESET`, каждый
прогон на РАЗНОЙ спеке. Приложение при этом исправно: `curl` того же адреса
отвечает 200 за 0.25 с.

**Признак:** падает не сценарий, а вход в него; виновник меняется от прогона к
прогону; свободная память в однозначных гигабайтах.

**Лечение:** остановить и поднять стенд заново (`preview_stop` + `preview_start`),
затем догнать оставшиеся спеки через `-g "persona observer|persona erda"`.
Проверять `ps aux | grep next-server` на RSS ДО обвинения кода.

Родственно [[feedback-stand-postgres-conn-exhaustion]] (тот же почерк «разные
спеки, поодиночке зелёные», но виновник — Postgres на 5434) и
[[project-test-db-collision-parallel-sessions]].
