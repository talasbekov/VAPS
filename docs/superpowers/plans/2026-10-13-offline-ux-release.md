# Текущие UX и офлайн-карта в переносимой Linux-поставке

**Goal:** Подготовить полный переносимый выпуск текущего проверенного кода, подтвердить чтение и основные UX-сценарии в новом Linux-окружении. Основной LAN3300/8300 не обновляется.

**Design:** Штатный deploy/lan/build.py создаёт traceable source snapshot, новые образы и application/runtime archives в новом каталоге вне Git. Уже подготовленные runtime/python/node/PG/Redis/nginx images и wheel сверяются; npm lock совпал. Сборка исходников --network=none/pull=false, без замены существующих образов приложения. Rehearsal C получает новые проект/порты/тома и согласованный backup A-V2; без demo bootstrap и изменения основной базы. Проверить pending migrations до запуска, readiness, source IDs/данные/файлы и текущий frontend на реальных чтениях. Сравнить мобильные формы/версию/офлайн карту, повторить подходящие browser checks. Реальные записи — только явно выделенные fixture на C, если нужны для координат; источник и A/B сохраняются.

- [x] Прочитать штатный build/compose/AGENTS; подтвердить кеши/lock/wheel и чистый committed source. Backend source не менялся с f9900fcc.
- [x] Новая офлайн-поставка: source/image/file manifests и checksums, build logs сохранены.
- [x] Новая C: restore в пустые volumes, проверка schema/readiness/данных и файлов, текущие образы без source overlay.
- [x] Current Linux frontend: readonly/mobile/offline-map/permission checks; meaningful browser tests, review.
- [x] Записать точный scope/ограничения/артефакты в журнал и задачи, локальный commit.

Нельзя удалять прежние caches/копии/видео, менять роли/ID, запускать main maintenance либо отправлять изменения удалённо. Windows3346 и сохранённые контрольные сборки остаются отдельными доказательствами. Работа до10:00 продолжается.
