# Сверка опубликованного снимка без потери черновиков

**Goal:** Просмотр старой версии из истории сохраняет черновики постов и публикации на текущем экране. Полная ссылка остаётся для копирования и новой вкладки.

**Design:** Обычный click/Enter версии открывает readonly dialog на текущем паспорте. Модифицированный click и исходный href сохраняют обычное поведение ссылки. Dialog показывает version.sectors/metadata, закрывается с возвратом фокуса. Снимок в dialog и отдельной странице использует один чистый компонент. Cached transient read failure повторяется внутри dialog; потеря доступа/снимка закрывает просмотр и не открывает его автоматически после возврата. Никаких новых запросов/записей при открытии snapshot.

- [x] Подтвердить RED реального сценария: набрать оба draft, открыть версию и вернуться — дата/примечание теряются.
- [x] Bounded readonly preview + общий snapshot body, href/back и доступные controls.
- [x] Browser draft/focus/snapshot/mobile/403/permission/missing-reappears/transient retry; прежние full-page version cases сохранить как explicit deep-link.
- [x] Review/typecheck/gate/production и настоящий readonly проход, документы/локальный commit.

Другие переходы страницы и глобальное хранение draft этим этапом не меняются. Основная база и frozen memory controls не меняются. Работа до10:00 продолжается.
