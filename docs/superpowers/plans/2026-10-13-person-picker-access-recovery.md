# Восстановление справочника лиц в связанных формах

**Goal:** Выбор лица в ГВО, создании и правке бюллетеня не показывает запрещённый cached каталог; повтор чтения сохраняет форму и поиск.

**Design:** Маскировать hook.data при readAccessBlocked для всех consumers, сохраняя фактический Query cache. В ГВО/Edit inline Retry, новые варианты недоступны при текущем read failure. Saved event snapshot names используются только в выбранных chips/remove ARIA правки, без добавления в options; выбранные ID и поля мероприятия не очищаются. Create не получает копию прежнего каталога для labels. Права и backend/payload не меняются.

- [x] Browser RED GVO403/404→503, transient choice и открытые options Create/Edit.
- [x] Общая mask, inline recovery и selected snapshot labels.
- [x] Browser/native/typecheck/review/gate и production affected checks.
- [x] Настоящий readonly OM24 и3widths без записи, полный event/summary/catalog до/после равны.
- [x] Журнал/задачи и commit; source freeze подготовлен, итоговая поставка — следующий план.
