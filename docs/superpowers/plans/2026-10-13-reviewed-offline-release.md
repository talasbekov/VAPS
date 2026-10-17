# Поставка после финального аудита

**Goal:** Переносимая версия включает исправления паспорта, реестра объектов и истории из этапа35; её работа подтверждена до10:00 на отдельной копии E.

**Design:** Зафиксировать проверенный source revision, выполнить стандартный offline build в новую папку «Офлайн-поставка-2026-10-13-готово». Новые project/volumes3366/18366/15366; restore полного A-V2 без изменения A/B/C/D. Сверить полный fingerprint до/после запуска, source/image/map hashes. Полная UX-suite270 и role audit28×9×2 ширины. Настоящие readonly map/object/post/passport/history/calendar сценарии с полными dataset comparisons и запретом непредусмотренных запросов. Проверка не заменяет standard install на другом физическом компьютере.

- [x] Стандартная сборка и полные checksums/image identity/source pin.
- [x] Restore E, migration check и startup fingerprint equality.
- [x] Full production UX270 без business writes.
- [x] 28ролей/252адреса/504 desktop/mobile представления.
- [x] Local GIS/assets/private map и actual readonly формы/истории.
- [x] Утренний integrity контроль, документация и чистый Git.
- [x] Работа до10:00 и итоговые ссылки пользователю.

Известная граница данных: фото лица8 на sourceclone18349/sourceA18360/D18364 недоступно404, на Main18345 доступно200. Первый FAIL сохранён. После совпадения Main/E DB filename подлинный Main файл70bytes/SHA восстановлен только в E_private:4→5, все прежниеhashes сохранены, DB records не менялись. Это реальное дополнение копии; fake assets/records и исключения из failedReads не используются.


Финальные проверки: этапы36–37 отчёта; Esource1824388b/full269PASS+1SKIP/28roles252routes504views, actual readonly flows,20мин SPA, Main integrity hashes equal. Чистота Git проверяется при заключительном commit документации.
