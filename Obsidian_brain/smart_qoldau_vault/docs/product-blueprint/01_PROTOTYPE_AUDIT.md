# 01 — Аудит прототипа v2

Статус: draft · Дата: 2026-09-13 · Владелец: Product · Источники: `RAW/SmartQoldau (1)/*.dc.html` (106 файлов, извлечённый DOM+JS), `RAW/SmartQoldau (1)/{assets,uploads,docs}`, `ios-frame.jsx`, `deck-stage.js`, `image-slot.js`, `support.js`, [[11a_SCREEN_REGISTRY]], [[Расхождения в прототипе]], [[Продуктовые решения по открытым вопросам]] (Р-01…Р-27), BRIEF §3 (DEC-01…38)

> Назначение: зафиксировать, ЧТО именно нарисовано в прототипе v2 — поэкранно, с действиями, переходами и состояниями, — и отделить это от того, что в нём устарело, противоречит само себе или является демонстрационной оболочкой. Документ — вход для [[02_RELEASE_PLAN]], [[07_USER_FLOWS_AND_STATE_MACHINES]], [[11_SCREEN_SPECS]], [[13_DESIGN_SYSTEM]] и [[20_VISUAL_CHANGELOG]].

## Оглавление

1. [Метод аудита](#1-метод-аудита)
2. [Сводка](#2-сводка)
3. [Инвентаризация всех 106 файлов](#3-инвентаризация-всех-106-файлов)
4. [Действия без результата, битые переходы, файлы-сироты](#4-действия-без-результата-битые-переходы-файлы-сироты)
5. [Дубли и пересечения](#5-дубли-и-пересечения)
6. [Устаревшее](#6-устаревшее)
7. [Противоречия](#7-противоречия)
8. [Visual notes по поверхностям](#8-visual-notes-по-поверхностям)
9. [Assets](#9-assets)
10. [Выводы для следующих документов](#10-выводы-для-следующих-документов)

---

## 1. Метод аудита

### 1.1 Что проверено

| Что | Как | Объём |
|---|---|---|
| Состав прототипа | `ls` каталога `RAW/SmartQoldau (1)/` | 113 записей в корне: 106 `.dc.html`, 4 подключаемых JS/JSX (`ios-frame.jsx`, `deck-stage.js`, `image-slot.js`, `support.js`), 3 каталога (`assets/`, `uploads/`, `docs/`) — итого **159 файлов** с содержимым каталогов `[PROTOTYPE FACT]` |
| Видимый текст каждого экрана | автоматическое извлечение из `<x-dc>`-шаблона: вырезаны `<style>`, `<svg>`, `<helmet>`; `<sc-if>` → `[IF cond]`, `<sc-for>` → `[FOR list]`, `onClick` → `[BTN handler]`/`[CLICK handler]`, `placeholder` → `[INPUT "…"]`, `<img src>` → `[IMG …]` | 106 / 106 файлов, 110 588 байт текста |
| Логика каждого экрана | полный `<script data-dc-script>` каждого файла (класс `Component extends DCLogic`): `state`, методы, демо-данные, `window.location.href` | 106 / 106 файлов, ≈480 КБ JS |
| Переходы | `grep` по `"./…​.dc.html"` в шаблоне + `location.href` в JS, сверка множества ссылок с множеством файлов через `comm` | 102 уникальных цели, 0 битых |
| Обработчики без результата | скрипт: для каждого `[BTN]`/`[CLICK]` найдено определение в JS, проверено наличие `location.href`/`history.back`; отдельно — `() => {}`, `noop`, `setState({toast})` | 525 пар «экран × обработчик» |
| Кнопки без обработчика | парсер `<button>` без `onClick`, `<a>` без `href` (или `href="#"`), `<div|span style=…cursor:pointer>` без `onClick` | весь корпус |
| Палитра | `grep -o '#[0-9a-f]{6}'` по шаблонам, дедупликация внутри файла → частота «в скольких экранах встречается» | 111 уникальных hex |
| Радиусы, кегли, начертания, тени, отступы, сетка | `grep` по инлайновым стилям (прототип целиком на инлайновых стилях, CSS-классов нет) | весь корпус |
| Assets | `ls -la` + `grep` по `src="assets/…"`, `src="uploads/…"` | 3 + 25 + 19 файлов |
| Соответствие коду | [[11a_SCREEN_REGISTRY]] (столбцы «Маршрут в коде», «Статус») | 106 строк реестра |

### 1.2 Что НЕ проверялось

- **Визуальный рендер в браузере не делался.** Ни один экран не открывался; скриншотов не снималось. Все выводы о раскладке, палитре, типографике и состояниях получены из извлечённого DOM и JS. `[INFERENCE]`
- **Не проверялись** фактические контрасты в рендере (значения контраста взяты из [[Расхождения в прототипе]] №13, где они посчитаны), поведение `@media`-запросов (их в прототипе нет — все размеры фиксированные), анимации `deck-stage`, работа `image-slot` с реальными файлами-сайдкарами.
- **PNG в `assets/screens/` не открывались** — классифицированы по именам файлов, размеру и месту использования (импорт в `Презентация` / `Investor Deck`). Задача явно это разрешает.
- **Код продукта не читался заново** — статусы реализации берутся из [[11a_SCREEN_REGISTRY]] как `[CODE FACT]` пакета планирования, а не перепроверяются.

### 1.3 Договорённости о метках и ID

- `[PROTOTYPE FACT]` — подтверждено файлом прототипа (указан экран и элемент/handler).
- `[CODE FACT]` — из [[11a_SCREEN_REGISTRY]] / пакета планирования.
- `[CONTRADICTION]` — прототип противоречит себе, коду или ТЗ.
- `[DECISION REQUIRED]` — нужна ссылка на DEC-xx.
- ID экранов — из [[11a_SCREEN_REGISTRY]] (CL/EX/WB/EW/AD). Там, где одна строка реестра покрывает несколько файлов прототипа, введены **суффиксы** `a/b/c/d` (например `SCR-EX-10c`) — это не новая нумерация, а разложение существующей. Для четырёх служебных файлов, которых в реестре нет, введена новая группа `SCR-SV-01…04`. Полный список введённых ID — в §10.4.

---

## 2. Сводка

### 2.1 Числа

| Показатель | Значение | Источник |
|---|---|---|
| Файлов в прототипе всего | **159** (106 `.dc.html` + 4 скрипта рантайма + 3 изображения `assets/` + 25 PNG `assets/screens/` + 19 файлов `uploads/` + 1 `docs/*.md` + 1 каталог-словарь) | `[PROTOTYPE FACT]` `ls -R` |
| `.dc.html` | **106** | `[PROTOTYPE FACT]` |
| Продуктовых экранов | **102** | 106 − 4 служебных |
| Служебных файлов | **4**: `SmartQoldau - Прототип` (обзорная страница), `SmartQoldau - Презентация`, `SmartQoldau - Investor Deck`, `SmartQoldau - ER-схема` | `[PROTOTYPE FACT]` |
| Рамка `ios-frame` (390×844) | **64** экрана | `[PROTOTYPE FACT]` `x-import component-from-global-scope="IOSDevice"` |
| Рамка `deck-stage` (100 %,100 %) | **2** (Презентация, Investor Deck) | `[PROTOTYPE FACT]` |
| Без рамки (`plain`, desktop/компоненты) | **40** | `[PROTOTYPE FACT]` |

### 2.2 По поверхностям

| Поверхность | Экранов | Рамка | Файлы |
|---|---|---|---|
| **CM** — Client Mobile (`SmartQoldau - …`) | **31** | ios-frame 390×844 | Сплэш … Анализ |
| **EM** — Expert Mobile (`SmartQoldau Expert - …`) | **33** | ios-frame 390×844 | Сплэш … Мои жалобы и споры |
| **EW** — Expert Web (`SmartQoldau Expert Web - …`) | **12** | desktop-showcase 1440×1024 | Главная … Поддержка |
| **PW** — Public Web (`SmartQoldau.kz`, `SmartQoldau Web - …`) | **16** (14 страниц + 2 встраиваемых компонента) | `hint-size="100%,0"` / компонент | Лендинг … LangSwitch |
| **AD** — Admin Web (`SmartQoldau Admin - …`) | **10** | desktop-showcase 1440×1024 | Дашборд … Настройки |
| **Итого продуктовых** | **102** | | |
| Служебные | 4 | plain ×2, deck-stage ×2 | Прототип, ER-схема, Презентация, Investor Deck |
| **Всего `.dc.html`** | **106** | | |
| **CW** — Client Web cabinet | **0** | — | в прототипе нет вовсе (см. §10.2) `[PROTOTYPE FACT]` |

### 2.3 «4 продукта, 82 экрана» против факта — `[CONTRADICTION]` (DEC-38)

Обзорная страница `SmartQoldau - Прототип` в шапке заявляет **«4 продукта / 82 экрана»** `[PROTOTYPE FACT]`. Ни одна из двух цифр не сходится:

| Раздел обзорной страницы | Заявлено | Ссылок фактически | Файлов на поверхности | Расхождение |
|---|---|---|---|---|
| Мобильное приложение клиента | «iOS · 28 экранов» | 30 | 31 | «Анализ» вынесен в раздел «Материалы» под подписью **«03 Анализ рынка»**, хотя ведёт на `SmartQoldau - Анализ` — экран пульса с часов, а не аналитику рынка `[CONTRADICTION]` |
| Приложение специалиста — Expert | «iOS · 30 экранов» | 32 | 33 | `SmartQoldau Expert - Тарифы` **не указан вообще** (достижим только из `Expert - Профиль` и `Expert - Уведомления`) |
| Веб-кабинет специалиста | «Desktop · 12 экранов» | 12 | 12 | сходится |
| Сайт и веб-версия для клиента | «Desktop · 12 страниц» | 14 | 16 | подпись «12», список из 14; `CookieBanner` и `LangSwitch` не указаны (они `dc-import`-компоненты) |
| Админ-панель | «Desktop · 8 разделов» | 11 | 10 | список из 11 пунктов на 10 файлов: **«Рассылки» перечислены дважды** — под номерами 04 и 10; номер «09» тоже занят дважды (B2G и Настройки) `[CONTRADICTION]` |
| Материалы | «презентации и аналитика» | 3 | — | Презентация, Investor Deck, «Анализ рынка» (= CM-экран) |

- Сумма подписей разделов: 28 + 30 + 12 + 12 + 8 = **90**, а в шапке — **82**. Ни 82, ни 90 не равны фактическим **102**. `[CONTRADICTION]`
- «4 продукта» против фактических **5 поверхностей** (мобильный клиент, мобильный эксперт, веб-кабинет эксперта, публичный сайт, админка) — админка на обзорной странице есть отдельным блоком, то есть противоречит собственной шапке. `[CONTRADICTION]`
- Обзорная страница не ссылается на 5 файлов: `ER-схема`, `Прототип` (сама себя), `Expert - Тарифы`, `CookieBanner`, `LangSwitch`. `[PROTOTYPE FACT]` (`comm` списка `href` со списком файлов)

**Вывод:** числа с обзорной страницы использовать нельзя ни в одном документе. Канон — DEC-38: **102 продуктовых экрана в 5 поверхностях + 4 служебных файла**.

### 2.4 Демонстрационная оболочка — в продукт не переносится

Промпт §6 запрещает копировать в продукт элементы, которые существуют только ради показа прототипа. Полный список того, что к ней относится:

| Элемент оболочки | Где | Факт |
|---|---|---|
| Корпус iPhone: `width 402 × height 874`, `border-radius: 48`, внешняя тень `0 40px 80px rgba(0,0,0,.18)`, «динамический остров» 126×37 | `ios-frame.jsx` → 64 экрана CM/EM | `[PROTOTYPE FACT]` `IOSDevice` |
| Статус-бар **9:41** + иконки сети/Wi-Fi/батареи, home-indicator 139×5 | `ios-frame.jsx` (`IOSStatusBar`, `time = '9:41'`) | `[PROTOTYPE FACT]` |
| Фон вокруг корпуса `#f2f2f7` (iOS system grey) | обёртка всех 64 мобильных экранов: `display:flex;align-items:center;justify-content:center;background:#f2f2f7` | `[PROTOTYPE FACT]` — именно поэтому `#f2f2f7` попадает в топ-4 частотного списка палитры (64 экрана), но **токеном продукта не является** |
| Safe-area сверху: контент начинается с `padding-top: 64px` (в одном экране 60px) — компенсация острова и статус-бара | 38 экранов CM/EM | `[PROTOTYPE FACT]` — в продукте это `MediaQuery.padding.top`, а не константа |
| Desktop-showcase: внешний `min-height:100vh; background:#eef2f0; padding:24px` + внутренний «лист» `width:1440px; max-width:100%; min-height:1024px; border-radius:20px; box-shadow:0 30px 70px -30px rgba(15,63,58,0.18)` | 22 экрана EW + AD | `[PROTOTYPE FACT]` — скруглённый лист и его тень это рамка показа, а не окно приложения |
| Кнопка **«Переключиться на супер-админа (демо)»** | `Admin - Финансы`, `- Настройки`, `- B2B`, `- B2G` (handler `switchToSuper`) | `[PROTOTYPE FACT]` — переключение роли через `localStorage.sq_admin_role` |
| Шторка **«Роль доступа (демо)»** | все 10 экранов админки (`openRoleSheet`, `roleOptions`) | `[PROTOTYPE FACT]` |
| Кнопка **«Демо: имитировать одобрение»** | `Expert - Верификация` (`simulateApprove`) | `[PROTOTYPE FACT]` |
| Переключатель **«Демо: {{ demoLabel }}»** | `Expert - Входящий запрос` (`toggleDemo` — обычная/экстренная) | `[PROTOTYPE FACT]` |
| `?demo=` параметры: `notfound` (Поиск специалиста), `unavailable` (Консультации), `noshow` (Expert - Видеозвонок), `client_cancelled` (Expert - Консультация) | 4 экрана | `[PROTOTYPE FACT]` — это способ показать состояние, в продукте состояние приходит с сервера |
| Прочие URL-параметры показа: `?format=`, `?topic=`, `?priority=`, `?emergency=1`, `?status=`, `?new=1`, `?id=`, `?specialist=` | 20 экранов | `[PROTOTYPE FACT]` |
| Автопереходы по таймеру ради демонстрации: `Expert - Главная` через 10 с уходит на «Входящий запрос?emergency=1»; `Web - Поиск специалиста` через 3 с — на профиль | 2 экрана | `[PROTOTYPE FACT]` |
| `localStorage`-ключи как «бэкенд»: `sq_city`, `sq_premium`, `sq_anonymous`, `sq_expert_tier`, `sq_admin_role`, `sq_cookie_consent`, ключи плееров | 12 экранов | `[PROTOTYPE FACT]` |
| `image-slot.js` (drag-n-drop заглушки под фото) | лендинг `SmartQoldau.kz` | `[PROTOTYPE FACT]` — инструмент дизайна, не компонент продукта |
| `deck-stage.js` (навигация по слайдам, спикерские заметки, экспорт PPTX) | Презентация, Investor Deck | `[PROTOTYPE FACT]` |

---

## 3. Инвентаризация всех 106 файлов

Обозначения: **Frame** — `ios` = `ios-frame` 390×844, `desk` = desktop-showcase 1440×1024, `page` = `hint-size="100%,0"` (страница сайта), `cmp` = встраиваемый компонент (`dc-import`), `deck` = `deck-stage`. **Код** — столбец «Статус» из [[11a_SCREEN_REGISTRY]]: ✓ реализован · ◐ частично/отличается · ✗ нет · — не экран продукта. Переходы даны без префикса `SmartQoldau`. Состояния — из `[IF …]` шаблона.

### 3.1 CM — мобильное приложение клиента (31 экран)

| SCR-ID | Файл | Роль | Frame | BP | Primary action | Все actions (handlers) | Переходы | Состояния в прототипе | Assets | Код | Заметки |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SCR-CL-01 | `- Сплэш` | R-01/R-02 | ios | BP-02 | тап по экрану → онбординг | `goToOnboarding` | `- Онбординг` | — | `logo_smartqoldau.png` | ✓ | нет состояния восстановления сессии — в коде `POST /auth/refresh` |
| SCR-CL-02 | `- Онбординг` | R-01 | ios | BP-01/BP-02 | «Далее» / «Начать» | `onNext`, `onSkip` | `- Добро пожаловать` | `isSlide0..3` (4 слайда) | `onboarding-illustration.png`, логотип | ✓ | слайд 3: «Полная конфиденциальность… можно обратиться **анонимно**» — DEC-13; слайд 4: «Ответ психолога **за 1–2 минуты**» — DEC-16 |
| SCR-CL-03 | `- Добро пожаловать` | R-01 | ios | BP-02 | «Продолжить с номером телефона» | `goToRegister`, `goToPermissions` | `- Регистрация`, `- Главная` | — | логотип | ✓ | «Продолжить **анонимно**» и «Быстрый отклик — **от 1 минуты**» — DEC-13, DEC-16; ссылки на юрдокументы — `<a>` **без `href`** |
| SCR-CL-04 | `- Регистрация` | R-01→R-03 | ios | BP-02 / BP-13 | «Получить код» | `onGetCode`, `onConfirmCode`, `onBackToPhone`, `goToCorporate`, `onConfirmCorporate`, `onAcceptDisclaimer`, `goToPermissions` (×3: Google, Apple, «Войти»), `closeModal`, `onBack` | `- Главная`, `- Добро пожаловать` | `isPhoneStep`, `isCodeStep`, `isCorporateStep`, `isCorporateDisclaimer`, `isRegisteredModal`, `phoneError`, `codeError`, `corpError`, `noPhoneError` | — | ◐ | «Продолжить с Google / с Apple» — DEC-29 (не показываем); B2B-шаг `SQ-XXXX-YYYY` — DEC-18 (скрыт до R4); демо: номер `7760012288`, код `1234`, коды `SQ-KMS-2026`, `SQ-HALYK-2026`; «повторно через **00:45**» |
| SCR-CL-05 | `- Разрешения` | R-02 | ios | BP-02 | «Продолжить» | `onContinue` | `- Главная` | — | — | ✓ | микрофон / камера / уведомления |
| SCR-CL-06 | `- Главная` | R-02/R-03 | ios | BP-03/BP-04/BP-08 | «Мне нужна помощь сейчас» | 28 handlers: `openEmergencyModal`, `confirmEmergency`, `closeEmergencyModal`, `stopPropagation`, `goToAnxiety…goToOther` (9 тем), `goToChat/Audio/Video`, `goToBreathing/Music/Articles/Meditations`, `goPremium`, `goToAnalysis`, `goNewSpecialists`, `openCityPicker`/`closeCityPicker`/`c.onClick`, `goToNotifications`, `n.onClick` | `- Выбор темы` (+`?format=`), `- Каталог?topic=`, `- Каталог?new=1`, `- Экстренный поиск?format=audio`, `- Premium`, `- Анализ`, `- Уведомления`, `- Консультации`, `- Материалы`, `- Избранное`, `- Профиль`, 4 экрана контента | `isLoading` (skeleton 700 мс), `showEmergencyModal`, `showCityPicker`, `showPremiumBanner`, `c.selected` | — | ◐ | **9 плиток тем** (DEC-12); пикер города Астана/Алматы/Шымкент (DEC-28); карточка «Пульс 96 уд/мин · данные с часов» (DEC-30); баннер «Скидка 15 % … у новых специалистов» (DEC-08); «Среднее время подключения — до 2 минут» (DEC-16) |
| SCR-CL-07 | `- Выбор темы` | R-02 | ios | BP-03 | «Продолжить» | `t.onClick` (9 тем), `f.onClick` (чат/аудио/видео), `onContinue`, `goBack` | `- Поиск специалиста?format=`, `- Главная` | — | — | ✓ | тот же список 9 тем, что на главной; формат по умолчанию `audio` |
| SCR-CL-08 | `- Поиск специалиста` | R-02 | ios | BP-03 | «Отменить поиск» | `onCancel`, `onConfirmCancel`, `onKeepWaiting`, `onRetry`, `onBackHome` | `- Специалист найден?format=`, `- Главная` | `isOffline`, `isNotFound` (пустой результат), `isPriority`, `showCancelModal`, `st.showConnector` | логотип | ✓ | таймер 120 с (приоритетный 30 с); «Это займёт **не более 2 минут**»; зашитое «Сейчас онлайн: **18 специалистов**» |
| SCR-CL-09 | `- Экстренный поиск` | R-02 | ios | BP-04 | «Позвонить 103 / 112» | `callEmergency` (`tel:103`), `onCancel`, `onConfirmCancel`, `onKeepWaiting` | `- Специалист найден?format=`, `- Главная`, `tel:103` | `showCancelModal` | — | ✓ | таймер 30 с; в тексте **103 и 112**, на главной в шторке — **102 и 103**; линии **150** нет нигде (DEC-11) |
| SCR-CL-10 | `- Специалист найден` | R-02/R-05 | ios | BP-05 | «Начать консультацию» → шторка оплаты | `onStart`, `onPay`, `closePaywall`, `goToProfile`, `onOtherSpecialist`, `goPremium` | `- Чат` / `- Аудиозвонок` / `- Видеозвонок` (по `?format=`), `- Профиль психолога`, `- Поиск специалиста`, `- Premium` | `showPaywall`, `isCorporate`, `!isCorporate` | `psychologist-aigerim.jpg` | ◐ | «**30 минут** с психологом» (DEC-06); Apple Pay / Kaspi Pay (DEC-26); «Оплачено компанией» (DEC-18); комментарий в JS верно фиксирует снимок цены (DEC-05) |
| SCR-CL-11 | `- Профиль психолога` | R-02 | ios | BP-03 | «Начать консультацию» | `onStart`, `goBack`, `toggleFavorite`, `onAllReviews` | `- Выбор темы` | — | `psych-cover-flowers.jpg`, `psychologist-aigerim.jpg` | ✓ | цена **5 000 ₸** (DEC-04); статус «**Свободен сейчас**»; отзывы подписаны «**Пользователь 4821**» (другой формат, чем `#1048`); «Аудио-приветствие … за 15 секунд» — фичи нет в коде; `onAllReviews` — пустой |
| SCR-CL-12 | `- Каталог` | R-02 | ios | BP-03 | «Записаться» на карточке | `sp.onBook`, `sp.onProfile`, `goAutoMatch`, `openCityPicker`/`closeCityPicker`/`c.onClick`, `openSortPicker`/`closeSortPicker`, `onBack` | `- Специалист найден?format=audio`, `- Профиль психолога`, `- Выбор темы?topic=`, `- Главная` | `noResults` («В этом городе пока нет специалистов…»), `showCityPicker`, `showSortPicker`, `sp.isNew`, `sp.isIntern` | — | ◐ | бейдж **−15 %** у новых (DEC-08); «Психолог-практикант под супервизией {{university}}», цена **0 ₸** (DEC-17); фильтр по городу (DEC-28); демо-цены 21 000 / 24 000 ₸ |
| SCR-CL-13 | `- Избранное` | R-03 | ios | BP-07/BP-12 | «Записаться снова» | `f.onBook`, `f.onProfile`, `f.onToggle`, `n.onClick` | `- Специалист найден`, `- Профиль психолога`, 5 пунктов нижней навигации | `hasFavorites`, `noFavorites` | — | ✓ | |
| SCR-CL-14 | `- Чат` | R-02/R-03 | ios | BP-06 | отправить сообщение | `onSend`, `q.onClick` (быстрые ответы), `goToAudio`, `goToVideo`, `toggleMenu`, `onFinish`, `goHome` | `- Аудиозвонок`, `- Видеозвонок`, `- Оценка`, `- Главная` | `menuOpen`, `showTyping`, `showQuickReplies`, `m.mine` | `psychologist-aigerim.jpg` | ✓ | «🔒 Здесь безопасно говорить открыто. Все сообщения конфиденциальны» (DEC-24); «Пожаловаться» и «Сообщить о проблеме» в меню — **без обработчика** |
| SCR-CL-15 | `- Аудиозвонок` | R-02/R-03 | ios | BP-06 | завершить звонок | `endCall`, `toggleMute`, `toggleSpeaker`, `toggleMenu`, `goToChat`, `goToVideo` | `- Оценка`, `- Чат`, `- Видеозвонок` | `menuOpen` | `psychologist-aigerim.jpg` | ✓ | «Консультация защищена. **Разговор не записывается**» (DEC-24); статус специалиста — «**Сейчас консультирует**» |
| SCR-CL-16 | `- Видеозвонок` | R-02/R-03 | ios | BP-06 | завершить звонок | `endCall`, `onReconnect`, `toggleMute`, `toggleCamera`, `toggleSpeaker`, `toggleMenu` | `- Оценка` | `showError` (потеря связи), `showMenu`, `cameraOn`, `cameraOff` | `psychologist-aigerim.jpg` | ✓ | «Разговор защищён **шифрованием** и не записывается» (DEC-24); `onReconnect` только гасит модалку; «Сменить устройство» и «Справка» — без обработчика |
| SCR-CL-17 | `- Оценка` | R-03 | ios | BP-07 | «Завершить» | `st.onClick` (5 звёзд), `t.onClick` (теги), `onFinish`, `onContinueSame`, `goHome` | `- Главная` | `showTags`, `showThanks` | `psychologist-aigerim.jpg` | ✓ | «Отзыв видит **только команда качества** SmartQoldau — психолог его не увидит» — DEC-14; теги зависят от оценки (1★ «Не помогло»… 5★ «Превзошёл ожидания»); «Аудиоконсультация · **8 мин**» |
| SCR-CL-18 | `- Консультации` | R-03 | ios | BP-06/BP-07 | «Присоединиться» | `upcoming.onJoin`, `upcoming.onReschedule`, `upcoming.onCancel`, `onConfirmCancel`, `onKeepUpcoming`, `closeReschedule`, `slot.onClick`, `t.onClick` (3 вкладки), `h.onClick`, `h.onComplain`, `goNewConsultation`, `n.onClick` | `- Видеозвонок`, `- Выбор темы`, `- Подать жалобу?session=`, нижняя навигация | `showUpcomingTab`/`showActiveTab`/`showCompletedTab`, `hasUpcoming`/`noUpcoming`, `hasHistory`/`noHistory`, `upcoming.unavailable`, `h.noShow`, `h.canComplain`, `showCancelModal`, `showRescheduleSheet`, `showToast` | — | ◐ | политика отмены: > 2 ч — «средства возвращены в полном объёме», < 2 ч — «Будет возвращено **50 %** суммы, оставшаяся часть — **компенсация специалисту**» (DEC-09) |
| SCR-CL-19 | `- Материалы` | R-02/R-03 | ios | BP-08 | открыть раздел | `it.onClick` (4 карточки), `n.onClick` | `- Дыхательное упражнение`, `- Расслабляющая музыка`, `- Полезные статьи`, `- Медитации` | — | — | ✓ | это **хаб из 4 ссылок**, а не список материалов — см. §5.1 |
| SCR-CL-20 | `- Медитации` | R-03/R-04 | ios | BP-08 | воспроизвести практику | `s.onClick`, `s.onToggleFav`, `c.onClick` (категории), `togglePlay`, `togglePlayStop`, `stopFully`, `rewind15`, `forward15`, `playNext`, `restartActive`, `minimizePlayer`, `reopenPlayer`, `toggleFavActive`, `o.onClick` (таймер сна, фон) | нет (тупик — нет даже «назад» в навигацию) | `hasSessions`/`noSessions`, `playerOpen`, `miniBarVisible`, `playing`/`notPlaying`, `completed`, `hasNext` | логотип (в плеере) | ◐ | локальное хранилище избранного; таймер сна и фоновый звук — фич нет в коде |
| SCR-CL-21 | `- Полезные статьи` | R-03/R-04 | ios | BP-08 | открыть статью | `a.onClick`, `a.onToggleRead`, `a.onToggleBookmark`, `c.onClick`, `closeReader`, `shareArticle`, `toggleReaderRead`, `toggleReaderBookmark`, `rateUp`, `rateDown`, `resumeReading`, `resumeReadingStop`, `r.onClick`, `goBack` | нет | `hasArticles`/`noArticles`, `hasReader`, `hasContinueBar`, `hasSimilar`, `showBaseBack` | — | ◐ | «Продолжить чтение» с процентом прогресса; `shareArticle` не определён |
| SCR-CL-22 | `- Расслабляющая музыка` | R-03/R-04 | ios | BP-08 | воспроизвести трек | `t.onClick`, `t.onToggleFav`, `t.onToggleDownload`, `c.onClick`, `togglePlay`, `togglePlayStop`, `closePlayerStop`, `expandPlayer`, `collapsePlayer`, `playPrev`, `playNext`, `toggleShuffle`, `toggleRepeat`, `toggleSleepMenu`, `o.onClick`, `r.onClick`, `goBack` | нет | `hasTracks`/`noTracks`, `hasActive`, `expanded`, `playing`/`notPlaying`, `showSleepMenu`, `t.isDownloaded`, `hasSimilar` | — | ◐ | офлайн-загрузка треков — фичи нет в коде |
| SCR-CL-23 | `- Дыхательное упражнение` | R-02/R-03 | ios | BP-08 | «Начать» | `startSession`, `tech.onClick`, `tech.onPick`, `d.onClick`, `toggleTechniques`, `applyTechnique`, `onFinish`, `backHome`, `goToChat`, `goBack` | `- Главная`, `- Выбор темы` | `isIntro`, `isSession`, `isDone`, `showCountdown`, `showTechniques` | — | ◐ | техники (box и др.) с описанием и «Помогает при…»; после сессии — «Всё ещё тяжело? Поговорить с психологом» (хороший мост BP-08 → BP-03) |
| SCR-CL-24 | `- Premium` | R-03→R-04 | ios | BP-12 | «Оформить подписку» | `p.onClick` (2 плана), `onSubscribe`, `onBack` | `- Профиль` | `p.selected`, `p.badge`, `showSuccess` | — | ◐ | **2 990 ₸/мес, 23 900 ₸/год** (DEC-01); success-текст «Теперь **все консультации** и практики **без ограничений**» — прямо запрещён DEC-03 |
| SCR-CL-25a | `- Способы оплаты` | R-03 | ios | BP-05 | «+ Добавить карту» | `goAddCard`, `c.onRemove`, `onBack` | `- Добавить карту`, `- Профиль` | `hasCards`, `noCards` | — | ◐ | блок «ДРУГИЕ СПОСОБЫ ОПЛАТЫ: Kaspi Pay, Apple Pay, Google Pay» — три строки **без обработчиков** (DEC-26) |
| SCR-CL-25b | `- Добавить карту` | R-03 | ios | BP-05 | «Привязать карту» | `onSubmit`, `closeDeclined`, `onBack`, 4 `onChange` | `- Способы оплаты` | `formError`, `showDeclined` (отказ банка), `showSuccess` | — | ✓ | «Данные карты передаются в зашифрованном виде и не хранятся на серверах SmartQoldau» |
| SCR-CL-26 | `- Профиль` | R-02/R-03 | ios | BP-02/BP-12 | — (хаб) | `goRegister`, `goEdit`, `goSubscription`, `onLogoutClick`, `onConfirmLogout`, `closeLogoutConfirm`, `onConfirmDelete`, `closeDeleteConfirm`, `it.onClick` (10 пунктов), `n.onClick` | `- Регистрация`, `- Premium`, `- Способы оплаты`, `- Мои жалобы`, `- Добро пожаловать`, нижняя навигация | `isAnonymous`/`isNotAnonymous`, `showLogoutConfirm`, `showDeleteConfirm`, `it.value` | — | ◐ | «Гость · **Анонимный доступ · история не сохраняется**» — противоречит Р-22/DEC-13 (история device-scoped **сохраняется**); блок «Экстренные службы 102 / 103»; **7 из 10** пунктов меню — `noop` |
| SCR-CL-27 | `- Уведомления` | R-03 | ios | BP-12 | открыть уведомление | `n.onClick`, `onMarkAllRead`, `onBack` | `- Консультации`, `- Чат`, `- Оценка`, `- Мои жалобы`, `- Полезные статьи`, `- Главная` | `hasNotifications`/`noNotifications`, `hasUnread`, `n.unread` | — | ◐ | типы: no-show специалиста, напоминание **за 1 час**, решение по жалобе, подтверждение, ответ в чате, просьба оценить, новая статья (DEC-27, DEC-31) |
| SCR-CL-29 | `- Подать жалобу` | R-03 | ios | BP-07 | «Отправить жалобу» | `r.onClick` (4 причины), `onAttach`, `onSubmit`, `onGoToMyComplaints`, `onBack` | `- Мои жалобы` | `!submitted`/`submitted`, `error`, `isChat` (вложение только для чата), `r.selected` | — | ✗ Q-05 | причины: неэтичное поведение / не вышел на связь / техпроблема / другое; «Рассмотрим в течение **48 часов**» (DEC-15) |
| SCR-CL-30 | `- Мои жалобы` | R-03 | ios | BP-07 | открыть жалобу | `c.onClick`, `closeDetail`, `onBack` | нет (тупик) | `!selected`/`selected`, `noComplaints`, `c.outcome`, `selected.adminComment` | — | ✗ Q-05 | статусы: **Решено / На рассмотрении / Отклонено** |
| SCR-CL-31 | `- Анализ` | R-03 | ios | BP-12 | «Подышать» / «Поговорить» | `goToBreathing`, `goToTopics`, `goBack` | `- Дыхательное упражнение`, `- Выбор темы`, `- Главная` | `elevated` (повышенный пульс) | — | ✗ Р-25 | «Синхронизировано с **Apple Watch**», HRV, дисклеймер «Это не медицинский диагноз» (DEC-30) |

### 3.2 EM — мобильное приложение эксперта (33 экрана)

| SCR-ID | Файл | Роль | Frame | BP | Primary action | Все actions (handlers) | Переходы | Состояния в прототипе | Assets | Код | Заметки |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SCR-EX-01a | `Expert - Сплэш` | R-06 | ios | BP-09 | тап → онбординг | `goNext` | `Expert - Онбординг` | — | логотип | ✓ | |
| SCR-EX-01b | `Expert - Добро пожаловать` | R-06 | ios | BP-09 | «Продолжить с номером телефона» | `goLogin`, `goClientApp` | `Expert - Регистрация`, **`- Добро пожаловать` (клиентское приложение)** | — | логотип | ✓ | ссылки «Условия для специалистов» и «Политику конфиденциальности» — `<a>` **без `href`**; переход в клиентское приложение внутри одного прототипа — оболочка показа, не продукт |
| SCR-EX-01c | `Expert - Регистрация` | R-06 | ios | BP-09 | «Получить код» | `onGetCode`, `onConfirmCode`, `onBackToPhone`, `onBack` | `Expert - Профессиональный профиль` (новый), `Expert - Главная` (существующий), `Expert - Добро пожаловать` | `isPhoneStep`, `isCodeStep`, `phoneError`, `codeError` | — | ✓ | те же демо-константы `7760012288` / `1234`; «повторно через 00:45» |
| SCR-EX-02a | `Expert - Онбординг` | R-06 | ios | BP-09 | «Далее» / «Начать» | `onNext`, `skip` | `Expert - Добро пожаловать` | — | — | ✓ | слайды заданы в `SLIDES`, текста в разметке нет |
| SCR-EX-02b | `Expert - Профессиональный профиль` | R-06 | ios | BP-09 | «Продолжить» (шаг 1 из 2) | `onUploadPhoto`, `openCityPicker`/`closeCityPicker`/`c.onClick`, `openExperiencePicker`/`closeExperiencePicker`/`e.onClick`, `sp.onClick`, `l.onClick`, `f.onClick`, `onContinue` | `Expert - Документы` | `error`, `showCityPicker`, `showExperiencePicker` | — | ◐ | «Стоимость консультации, ₸ (диапазон **15 000–35 000**)», плейсхолдер **18500** (DEC-04); `onUploadPhoto` — пустой |
| SCR-EX-03a | `Expert - Документы` | R-06 | ios | BP-09 | «Отправить на проверку» (шаг 2 из 2) | `d.onClick` (4 документа), `onContinue`, `onSentContinue` | `Expert - Верификация` | `showSent` | — | ✓ | 4 документа: удостоверение, диплом, сертификаты, документы о квалификации; «обычно до **24 часов**» (DEC-35) |
| SCR-EX-03b | `Expert - Верификация` | R-06 | ios | BP-09 | «Перейти в приложение» (после одобрения) | `simulateApprove` (демо), `enterApp` | `Expert - Главная` | `!approved`/`approved`, `st.done` | — | ✓ | 3 шага: документы получены → проверка специалистом → профиль подтверждён |
| SCR-EX-04 | `Expert - Статус верификации` | R-06/R-08 | ios | BP-09 | — (информационный) | `goBack` | нет (тупик) | `blocked`, `pending`, «подтверждён» | — | ✓ | «Профиль временно заблокирован … Обратитесь в поддержку» (SM-17) |
| SCR-EX-05 | `Expert - Главная` | R-07 | ios | BP-10 | переключатель рабочего статуса | `openStatusSheet`/`closeStatusSheet`/`opt.onClick`, `newRequest.onAccept`, `newRequest.onDecline`, `openUpcoming`, `goNotifications`, `n.onClick` | `Expert - Входящий запрос?emergency=1` (авто через 10 с), `Expert - Заявка?format=video&status=accepted`, `Expert - Консультация`, `Expert - Уведомления`, нижняя навигация | `hasNewRequest`, `showSoonBanner`, `showOfflineNotice`, `showStatusSheet`, `hasUnread`, `opt.selected` | — | ✓ | 4 статуса: **Принимаю клиентов / Занят / Не принимаю / Временно недоступен** (SM-07); метрики дня: 4 консультации, 2 обращения, **29 500 ₸**; статистика: 247 консультаций, 4.9★, **582К ₸ за месяц** |
| SCR-EX-06 | `Expert - Доступность` | R-07 | ios | BP-10 | «Сохранить» | `d.onClick` (дни), `toggleUrgent`, `onSave`, `goBack` | `Expert - Расписание` | `showToast` («Расписание сохранено») | — | ✓ | «Принимать срочные обращения — приоритетные заявки вне очереди»; **нет** тумблера автоприёма (он есть только в EW — расхождение №6) |
| SCR-EX-07 | `Expert - Входящий запрос` | R-07 | ios | BP-10 | «Принять» | `onAccept`, `onDecline`, `toggleDemo` (демо) | `Expert - Чат/Аудио/Видео (эксперт)`, `Expert - Заявки` (по таймауту), `Expert - Главная` | `isEmergency` | — | ✓ | «Автоотклонение через **{{countdown}}с**», старт **20 с** (DEC-10); «Анонимный клиент **#7284**»; при экстренной — дисклеймер про 102/103 |
| SCR-EX-08a | `Expert - Заявки` | R-07 | ios | BP-10 | «Принять» | `t.onClick` (3 вкладки), `r.onClick`, `r.onAccept`, `r.onDecline`, `n.onClick` | `Expert - Заявка?id=&format=&status=`, нижняя навигация | `hasItems`/`noItems`, `r.showActions`, `r.statusLabel` | — | ✓ | вкладки Новые / Принятые / Завершённые; статусы «Ожидает начала консультации», «Консультация проведена»; `r.onDecline` только прячет карточку локально |
| SCR-EX-08b | `Expert - Заявка` | R-07 | ios | BP-10 | «Принять консультацию» | `onAccept`, `onDecline`, `onStart`, `goSchedule`, `goBack` | `Expert - Чат/Аудио/Видео (эксперт)`, `Expert - Консультации`, `Expert - Заявки` | `isEmergency`, `!accepted`/`accepted` | — | ✓ | «Продолжительность **50 минут**» (DEC-06 — верно); «Статус клиента: Ожидает специалиста»; «Анонимный клиент **#1048**» |
| SCR-EX-09 | `Expert - Консультации` | R-07 | ios | BP-10 | открыть консультацию | `t.onClick` (4 вкладки), `c.onClick`, `n.onClick` | `Expert - Консультация?id=&format=&status=`, нижняя навигация | `hasItems`/`noItems`, `c.cancelNote` | — | ◐ | вкладки Сегодня / Предстоящие / Завершённые / **Отменённые**; статусы «Не пришёл клиент», «**Компенсация 50 %**», «Отменено», «Завершена», «Запланирована» (DEC-09) |
| SCR-EX-10a | `Expert - Консультация` | R-07 | ios | BP-06 | «Начать консультацию» | `onStart`, `onReschedule`, `onCancel`, `onConfirmCancel`, `closeCancelModal`, `openClient`, `goBack` | `Expert - Чат/Аудио/Видео (эксперт)`, `Expert - Клиент?format=`, `Expert - Консультации` | `clientCancelled`, `completed`/`!completed`, `showCancelModal` | — | ✓ | «Стоимость **18 500 ₸**»; «Предыдущих обращений: 2 · Открыть профиль клиента ›» (Р-27); `onReschedule` — пустой |
| SCR-EX-10b | `Expert - Чат (эксперт)` | R-07 | ios | BP-06 | отправить ответ | `onSend`, `toggleMenu`, `onFinish`, `goBack` | `Expert - Завершение?format=chat`, `Expert - Главная` | `menuOpen`, `showTyping` | — | ✓ | «🔒 Сообщения конфиденциальны и защищены»; «Открыть профиль клиента» и «Сообщить о проблеме» — **без обработчика**; «Анонимный клиент **#2214**» |
| SCR-EX-10c | `Expert - Аудиозвонок (эксперт)` | R-07 | ios | BP-06 | завершить звонок | `endCall`, `onReconnect`, `toggleMute`, `toggleSpeaker` | `Expert - Завершение?format=audio` | `showError` (потеря связи) | — | ✓ | «🔒 Разговор защищён шифрованием и не записывается»; «Анонимный клиент **#3067**»; индикатор качества связи |
| SCR-EX-10d | `Expert - Видеозвонок (эксперт)` | R-07 | ios | BP-06 | завершить звонок | `endCall`, `dismissNoShow`, `toggleMute`, `toggleCamera`, `toggleSpeaker`, `toggleMenu` | `Expert - Завершение?format=video` | `showNoShow` (`?demo=noshow`), `showMenu` | `psychologist-aigerim.jpg` (как «вы») | ✓ | «Клиент не подключился … в течение **3 минут**» — совпадает с каноном; в шапке «Анонимный клиент #1048 **пользователь**» — опечатка |
| SCR-EX-11 | `Expert - Завершение` | R-07 | ios | BP-06/BP-10 | «Готово» | `o.onClick` (4 исхода), `goNotes`, `goHome` | `Expert - Заметки`, `Expert - Главная` | — | — | ✓ | исходы: состоялась (48 мин / **18 500 ₸**) · клиент не явился (0 ₸) · клиент отменил (0 ₸) · техническая проблема (0 ₸). «Начислено» = **полной цене**, комиссия не вычтена (расхождение №3, DEC-07) |
| SCR-EX-12 | `Expert - Заметки` | R-07 | ios | BP-10 | «Сохранить» | `onSave`, `goBack` | `Expert - Главная` | `showToast` | — | ✓ | «Видны только вам. **Не используйте медицинские диагнозы**» |
| SCR-EX-13a | `Expert - Доход` | R-07 | ios | BP-10 | «Выплаты» | `goPayouts`, `n.onClick` | `Expert - Выплаты`, нижняя навигация | — | — | ◐ | 29 500 ₸ сегодня / 143 000 ₸ неделя / **582 000 ₸** месяц; комиссия **не показана** (DEC-07) |
| SCR-EX-13b | `Expert - Выплаты` | R-07 | ios | BP-10 | «Вывести средства» | `onWithdraw`, `goBack` | нет (тупик) | `showToast` («Заявка на вывод отправлена») | — | ◐ | «Доступно к выводу **125 400 ₸**»; статусы Обрабатывается / Выплачено / **Отклонено**; «**** 4521 · Изменить» — **без обработчика** |
| SCR-EX-14 | `Expert - Рейтинг` | R-07 | ios | BP-10 | — (только просмотр) | `goBack` | нет (тупик) | — | — | ✓ | 4.9★ / 247 консультаций; **нет** ни «Ответить», ни «Пожаловаться» — в EW они есть (§5.2) |
| SCR-EX-15 | `Expert - Уведомления` | R-07 | ios | BP-10 | открыть уведомление | `n.onClick`, `readAll`, `goBack` | `Expert - Жалоба на вас`, `Expert - Консультации`, `Expert - Мои жалобы и споры`, `Expert - Тарифы` | `n.unread` | — | ◐ | типы: жалоба на вас · отмена <2 ч «**компенсация 50 %**» · no-show клиента «средства зачислены в полном объёме» · решение по жалобе · «**Пробный период заканчивается** … переход на Базовый тариф (15 % комиссия)» (DEC-08, DEC-09) |
| SCR-EX-16a | `Expert - Профиль` | R-07 | ios | BP-10 | — (хаб) | `goVerification`, `goTariffs`, `m.onClick` (меню), `onLogout`, `confirmLogout`, `cancelLogout`, `n.onClick` | `Expert - Редактирование профиля`, `- Мои жалобы и споры`, `- Рейтинг`, `- Расписание`, `- Выплаты`, `- Доход`, `- Уведомления`, `- Настройки`, `- Поддержка`, `- Статус верификации`, `- Тарифы`, `- Добро пожаловать` | `showLogoutModal`, `isStartTrial` | — | ◐ | «Мой тариф · {{tier}} · комиссия {{%}}» + «Пробный период: осталось N дней» (DEC-08); цена **18 500 ₸ за сессию** |
| SCR-EX-16b | `Expert - Редактирование профиля` | R-07 | ios | BP-10 | «Сохранить изменения» | `sp.onClick`, `f.onClick`, `onSave`, `goBack` | `Expert - Профиль` | `showToast` | — | ◐ | поле «Стоимость, ₸» **без указания коридора** (в анкете коридор 15 000–35 000 указан) — §7 |
| SCR-EX-17 | `Expert - Расписание` | R-07 | ios | BP-10 | открыть слот | `t.onClick` (Сегодня/Завтра/Неделя), `h.onClick`, `goAvailability`, `n.onClick` | `Expert - Консультация`, `Expert - Доступность`, нижняя навигация | `h.booking` | — | ✓ | вкладки «Завтра»/«Неделя» показывают тот же набор слотов (демо) |
| SCR-EX-18 | `Expert - Поддержка` | R-07 | ios | BP-15 | «Связаться с поддержкой» | `t.onClick` (категории), `onContact`, `goBack` | нет (тупик) | — | — | ✓ | «мы ответим **в течение рабочего дня**» (DEC-37); `onContact` — пустой |
| SCR-EX-19 | `Expert - Клиент` | R-07 | ios | BP-06/BP-10 | «Начать консультацию» | `onStart`, `goBack` | `Expert - Чат/Аудио/Видео (эксперт)` | — | — | ◐ | «Анонимный клиент #1048 · **Личные данные скрыты платформой**» — противоречит Р-27/DEC-19 (в EW клиент может быть назван по имени) |
| SCR-EX-20 | `Expert - Настройки` | R-07 | ios | BP-10 | — | `t.onClick` (2 тумблера), `l.onClick` (7 пунктов), `goBack` | `Expert - Статус верификации`, `Expert - Поддержка`, `Expert - Добро пожаловать` | `l.value` | — | ◐ | 4 из 7 пунктов (Конфиденциальность, Язык, Безопасность, Платёжные данные) — `noop` |
| SCR-EX-21 | `Expert - Тарифы` | R-07 | ios | BP-10 | «Перейти на «…»» | `p.onSelect`, `onBack` | нет (тупик) | `p.current`, `toast` | — | ✗ Q-02 | **Старт 0 ₸ / 0 %** (30 дней) · **Базовый 0 ₸ / 15 %** · **Про 12 000 ₸ / 13 %** · **Топ 20 000 ₸ / 10–11 %** (DEC-08); экран **отсутствует на обзорной странице** прототипа |
| SCR-EX-22 | `Expert - Жалоба на вас` | R-07 | ios | BP-10 | «Отправить объяснение» | `onSendExplanation`, `onBack` | нет (тупик) | `!resolved`/`resolved`, `!explanationSent`/`explanationSent` | — | ✗ Q-05 | статусы: **Ожидает вашего ответа → На рассмотрении администратором → решение** (SM-16) |
| SCR-EX-23 | `Expert - Мои жалобы и споры` | R-07 | ios | BP-10 | открыть жалобу | `c.onClick`, `onBack` | `Expert - Жалоба на вас` | `hasItems`/`!hasItems`, `c.outcome` | — | ✗ Q-05 | |

### 3.3 EW — веб-кабинет эксперта (12 экранов)

Общее для всех 12: левый сайдбар 260 px на `#0f3f3a` с 9 рабочими разделами + 3 служебные ссылки внизу (Уведомления, Поддержка, **Настройки — `noop`**); шапка «А · Айгуль Сатпаева · Принимаю клиентов»; логотип `uploads/logo_smartqoldau.png`. Ниже в столбце «Все actions» навигационные `n.onClick`/`b.onClick` не повторяются.

| SCR-ID | Файл | Роль | Frame | BP | Primary action | Все actions (handlers) | Переходы | Состояния в прототипе | Assets | Код | Заметки |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SCR-EW-01 | `Expert Web - Главная` | R-07 | desk | BP-10 | «Принять» (новая заявка) | `openStatusSheet`/`closeStatusSheet`/`opt.onClick`/`stop`, `onAccept`, `onDecline`, `openConsultation`, `goAvailability` | `Expert Web - Расписание`, `- Консультации`, все разделы | `hasNewRequest`/`!hasNewRequest` (пустое состояние), `showStatusSheet` | логотип | ✓ | таймер заявки **240 с** (DEC-10 `[CONTRADICTION]`); «Длительность ~**45 минут**» (DEC-06); «Доход сегодня **11 970 ₸**» против **29 500 ₸** в EM за тот же день |
| SCR-EW-02 | `Expert Web - Заявки` | R-07 | desk | BP-10 | «Принять» | `t.onClick` (вкладки), `f.onClick` (фильтры), `r.onAccept`, `r.onDecline` | `- Консультации`, `- Уведомления`, `- Поддержка` | `hasItems`/`noItems`, `r.emergency` («⚠ Экстренно»), `r.showActions`, `r.statusLabel` | логотип | ✓ | длительности в демо: **45 / 30 / 40 мин** — три разных (DEC-06); `clientLabel` = «Анонимный клиент #NNNN» **или** «Имя · Клиент N» (Р-27) |
| SCR-EW-03 | `Expert Web - Консультации` | R-07 | desk | BP-06 | «Начать консультацию» | `t.onClick`, `c.onStart`, поиск | `Expert Web - Видеоконсультация` | `hasItems`/`noItems`, `c.completed`/`!c.completed` | логотип | ✓ | суммы 15 500–32 000 ₸ (DEC-04) |
| SCR-EW-04 | `Expert Web - Видеоконсультация` | R-07 | desk | BP-06 | завершить звонок | `endCall`, `toggleMute`, `toggleCamera`, `toggleScreenShare`, `toggleChat` | `Expert Web - Консультации` | `showChat` (боковой чат) | — | ✓ | **демонстрация экрана** — есть только здесь; «Конфиденциальная консультация»; таймер формата `HH:MM:SS` (в моб. — `MM:SS`) |
| SCR-EW-05 | `Expert Web - Клиенты` | R-07 | desk | BP-10 | «Открыть» карточку клиента | `c.onOpen`, поиск | `Expert Web - Чаты` | `hasResults`/`!hasResults` («Ничего не найдено по запросу «…»»), `c.anon`/`!c.anon` | логотип | ✓ | «SmartQoldau **скрывает личные данные** — вы видите только то, что нужно для консультации», но в списке есть «**Марат Ж. · Клиент 1**» — Р-27 реализован, подпись раздела устарела `[CONTRADICTION]` |
| SCR-EW-06 | `Expert Web - Расписание` | R-07 | desk | BP-10 | «Настроить расписание» → «Сохранить» | `openSettings`/`closeSettings`/`stop`, `t.onClick` (День/Неделя/Месяц), `d.onClick`, `toggleEmergency`, `toggleAutoAccept` | все разделы | `isDay`/`isWeek`/`isMonth`, `showSettings`, `h.booking`, `h.isBreak`, `d.empty` («Свободно»), `m.hasBooking` | логотип | ✓ | **три вида календаря** (день/неделя/месяц) — в EM только список слотов; «**Автоматически принимать заявки**» есть только здесь (расхождение №6) |
| SCR-EW-07 | `Expert Web - Доход` | R-07 | desk | BP-10 | «Вывести средства» | `onWithdraw` (**пустой**) | все разделы | — | логотип | ◐ | «Комиссия платформы **15 %**», но таблица: 22 000 ₸ → «−330 ₸» → «3 391 ₸»; у 4 из 5 строк с разными суммами «Итого» одинаковое — **3 391 ₸** `[CONTRADICTION]` (§7 №22) |
| SCR-EW-08 | `Expert Web - Рейтинг` | R-07 | desk | BP-10 | «Ответить» на отзыв | `r.onToggleReply`, `r.onSendReply`, `r.onReport` | все разделы | `r.reply`/`!r.reply`, `r.showReplyBox`, `r.reported`/`!r.reported` | логотип | ✓ | «Напишите **публичный ответ** клиенту» — прямо противоречит тексту CL-17 «отзыв видит только команда качества» (DEC-14) |
| SCR-EW-09 | `Expert Web - Профиль` | R-07 | desk | BP-10 | «Редактировать профиль» | `onEdit` (**пустой**), `goTariffs` | **`Expert - Тарифы` (экран мобильного приложения!)** | — | логотип | ◐ | цена **18 500 ₸**; «Мой тариф … Изменить тариф» ведёт на ios-frame-экран — смешение поверхностей `[CONTRADICTION]` |
| SCR-EW-10 | `Expert Web - Уведомления` | R-07 | desk | BP-10 | «Прочитать все» | `readAll`, `n.onClick` (**без перехода**) | все разделы | `n.unread` | логотип | ✓ | среди текстов: «Видеоконсультация с клиентом #1048 начнётся **скоро**» — размытая формулировка вместо времени |
| SCR-EW-11 | `Expert Web - Чаты` | R-07 | desk | BP-06/BP-10 | выбрать переписку | `c.onClick`, `startVideo`, `startAudio` (**пустой**) | `Expert Web - Видеоконсультация` | `c.unread` | логотип | ✗ Q-17 | «Активные консультации» + правая панель «О консультации» (клиент, тема, формат, начало) — DEC-20 |
| SCR-EW-12 | `Expert Web - Поддержка` | R-07 | desk | BP-15 | «Написать в поддержку» | `t.onClick`, `onContact` (**пустой**) | все разделы | — | логотип | ✗ | «мы ответим в течение рабочего дня» (DEC-37) |

### 3.4 PW — публичный веб (16 файлов: 14 страниц + 2 компонента)

Общее для 13 страниц: шапка `max-width: 1240px; padding: 16px 32px`, sticky, `backdrop-filter: blur(10px)`; логотип 32×32 `r9`; `dc-import` CookieBanner и LangSwitch; подвал «© SmartQoldau».

| SCR-ID | Файл | Роль | Frame | BP | Primary action | Все actions (handlers) | Переходы | Состояния в прототипе | Assets | Код | Заметки |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SCR-WB-01 | `SmartQoldau.kz` | R-01 | page | BP-01 | «Мне нужна помощь» → шторка скрининга | `openEmergencyModal`, `closeEmergencyModal`, `goNormalSearch`, `stopProp`, `q.onToggle` (FAQ) | `Web - Выбор темы`, `- Каталог`, `- Материалы`, `- Premium`, `- О нас`, `- Поддержка`, `- Стать психологом`, `- Для бизнеса`, `- Для вузов`, `- Соглашение`, `- Политика`, **`- Регистрация` (ios-frame!)**, **`Expert Web - Главная`** | `showEmergencyModal`, `q.open`, `s.formatIcons` | логотип, `image-slot` под фото специалистов и мокапы | ✓ | **12 тем** (список отличается от приложения); «Можно обратиться **анонимно**» ×2; бейджи **App Store / Google Play** — `<div>` без ссылок (DEC-21); блоки «Для бизнеса»/«Для вузов» (DEC-17/18); «Войти» ведёт на мобильный экран регистрации `[CONTRADICTION]` |
| SCR-WB-02 | `Web - Каталог` | R-01 | page | BP-03 | «Смотреть профиль →» | **нет ни одного `onClick`** — фильтры это `<select>`, логика в `renderVals` | `Web - Профиль психолога?id=`, `Web - Выбор темы`, `- Регистрация`, `SmartQoldau.kz` | `noResults` («По заданным фильтрам специалисты не найдены») | логотип | ✓ | 4 фильтра-селекта **без подписей** (расхождение №13); сортировка по рейтингу/цене/опыту |
| SCR-WB-03 | `Web - Профиль психолога` | R-01 | page | BP-03 | выбрать формат → «Записаться» | `f.onClick` (формат) | `Web - Выбор темы?format=&specialist=`, `- Каталог`, `SmartQoldau.kz` | — | логотип | ◐ | «Чтобы записаться … **установите приложение** SmartQoldau» + App Store / Google Play / QR — DEC-21; отзывы подписаны «Анонимный клиент» |
| SCR-WB-04a | `Web - Выбор темы` | R-01 | page | BP-03 | «Подобрать специалиста» | `t.onClick` (11 тем), `f.onClick`, `onContinue` | `Web - Поиск специалиста?topic=&format=&specialist=`, `SmartQoldau.kz` | `specialistName` («Вы записываетесь к специалисту: …») | логотип | ✓ | **11 тем** — на одну меньше, чем на лендинге (нет «Работа и карьера») `[CONTRADICTION]` |
| SCR-WB-04b | `Web - Поиск специалиста` | R-01 | page | BP-03 | «Отменить поиск» (ссылка на главную) | **нет ни одного `onClick`** | `Web - Профиль психолога?id=&format=` (авто через **3 с**), `SmartQoldau.kz` | — | логотип | ✓ | подзаголовок «Обычно это занимает **1–2 минуты**» — пятая формулировка SLA (DEC-16); **единственная страница PW без `hint-size="100%,0"`** |
| SCR-WB-05 | `Web - Материалы` | R-01 | page | BP-08 | открыть материал | нет `onClick` | **`- Медитации`, `- Полезные статьи`, `- Расслабляющая музыка`, `- Дыхательное упражнение` (все четыре — ios-frame)**, `SmartQoldau.kz` | — | логотип | ✓ | прямым текстом: «Эти инструменты открываются **в мобильном интерфейсе** SmartQoldau» — смешение поверхностей узаконено в тексте `[CONTRADICTION]` |
| SCR-WB-06 | `Web - Premium` | R-01 | page | BP-12 | «Подключить Premium» | нет `onClick` (ссылка) | `- Регистрация` (ios-frame), `SmartQoldau.kz` | — | логотип | ✓ | **4 990 ₸/мес**, годового плана нет (DEC-01); «Оплата отдельных консультаций **не входит** в подписку» — противоречит CL-24 `[CONTRADICTION]` |
| SCR-WB-07 | `Web - Стать психологом` | R-06 | page | BP-09 | «Оставить заявку» | нет `onClick` (ссылки) | `Expert - Регистрация` (ios-frame), **`Expert Web - Главная` («Уже специалист? Войти» — без экрана входа)**, `SmartQoldau.kz` | `p.badge` | логотип | ◐ | блок **тарифов** Старт/Базовый/Про/Топ (DEC-08); «Требования к специалистам»; вход в кабинет **минуя аутентификацию** `[CONTRADICTION]` |
| SCR-WB-08 | `Web - О нас` | R-01 | page | BP-01 | «Связаться с поддержкой» | нет `onClick` | `Web - Поддержка`, `SmartQoldau.kz` | — | логотип | ✓ | три метрики: «**1–2 мин**», «Чат · Аудио · Видео», «**Анонимно** — можно обратиться без раскрытия личности» (DEC-13, DEC-16) |
| SCR-WB-09 | `Web - Поддержка` | R-01 | page | BP-15 | «Отправить» | `onSubmit` (только `setState({sent:true})`) | `SmartQoldau.kz` | `sent` (кнопка → «Отправлено ✓») | логотип | ✓ | верный дисклеймер «Эта форма **не предназначена для экстренной** психологической помощи … 102 / 103»; контакты `support@smartqoldau.kz`, `+7 700 000 00 00` (плейсхолдер) |
| SCR-WB-10a | `Web - Пользовательское соглашение` | R-01 | page | — | — | нет | `SmartQoldau.kz` | — | логотип | ◐ | «Действует с **1 августа 2026 года**»; раздел «5. Анонимный режим» (DEC-13) |
| SCR-WB-10b | `Web - Политика конфиденциальности` | R-01 | page | — | — | нет | `SmartQoldau.kz` | — | логотип | ◐ | «При **анонимном** обращении имя и фото не запрашиваются» (DEC-13) |
| SCR-WB-11 | `Web - Для бизнеса` | R-17 | page | BP-13 | «Оставить заявку» | `scrollToForm`, `onSubmit` | `SmartQoldau.kz` | `!submitted`/`submitted`, `error` | логотип | ✗ Q-06 | 6 полей формы; «Заявка обрабатывается менеджером вручную»; «**Полная анонимность**» (DEC-24); «свяжется в течение **1 рабочего дня**» |
| SCR-WB-12 | `Web - Для вузов` | R-18 | page | BP-14 | «Оставить заявку на партнёрство» | `scrollToForm`, `onSubmit` | `SmartQoldau.kz` | `!submitted`/`submitted`, `error` | логотип | ✗ Q-06/Q-07 | 7 полей; «самостоятельная регистрация студента в обход вуза не предусмотрена» (DEC-17) |
| SCR-WB-13 | `Web - CookieBanner` | R-01 | cmp | — | «Принять» | `onAccept` (`localStorage.sq_cookie_consent`) | `Web - Политика конфиденциальности` | `show` | — | ✗ | встраивается в **13** страниц через `dc-import` (DEC-32) |
| SCR-WB-14 | `Web - LangSwitch` | R-01 | cmp | — | RU / KZ | `onRu`, `onKz` | — | `showSoon` | — | ◐ | KZ показывает тост «**Қазақша нұсқа жасалып жатыр**» и **не переключает локаль** — DEC-22 `[CONTRADICTION]`, в коде kz полный (246/375/205 ключей) |

### 3.5 AD — админка (10 экранов)

Общее для всех 10: сайдбар 260 px `#0f3f3a` с 10 разделами, бейджи «Верификация 5» / «Жалобы 3», значок «замок» на разделах, закрытых для роли «Модератор»; шапка «А · Админ Ержанова · {{roleLabel}}»; шторка **«Роль доступа (демо)»** с двумя ролями (Супер-админ / Модератор).

| SCR-ID | Файл | Роль | Frame | BP | Primary action | Все actions (handlers) | Переходы | Состояния в прототипе | Assets | Код | Заметки |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SCR-AD-01 | `Admin - Дашборд` | R-19 | desk | BP-11 | перейти в проблемный раздел | `goVerification`, `goComplaints`, `openRoleSheet`/`closeRoleSheet`/`opt.onClick`/`stop` | `Admin - Верификация`, `- Жалобы`, все разделы | `showRoleSheet`, `n.badge`, `n.restricted` | логотип | ✗ E21 | «Требует внимания»: «Просроченная верификация **>24 ч** — 2 заявки», «Необработанная жалоба **>48 ч**»; поиск по платформе — `<input>` без обработчика |
| SCR-AD-02 | `Admin - Верификация` | R-11 | desk | BP-09/BP-11 | «Одобрить» / «Отклонить» | `showSpecialists`, `showInterns`, `a.onClick`, `onApprove`, `startReject`, `confirmReject`, `cancelReject`, `closePanel`, роль | все разделы | `tab==='specialists'`/`'interns'`, `selected`, `selected.isIntern`, `selected.dupIin`, `rejecting`/`!rejecting`, `toast` | логотип | ◐ Q-07 | «SLA — **24 часа**» (DEC-35); вкладка **«Студенты-практиканты»** с кодом B2G и полем «ФИО супервайзера» (DEC-17); предупреждение «**⚠ Дубликат ИИН**» — ИИН в коде не собирается; «Просмотреть» у документов — **без обработчика** |
| SCR-AD-03 | `Admin - Специалисты` | R-19 | desk | BP-11 | сменить пакет / «Заблокировать» | `sp.onClick`, `t.onClick` (пакеты), `openBanConfirm`, `confirmBan`, `closeBanConfirm`, `closePanel`, роль | все разделы | `selected`, `showBanConfirm`, `isModerator` («Доступно только супер-админу»), `toast` | логотип | ✗ E21 | фильтры «Все пакеты: Старт/Базовый/Про/Топ» (DEC-08); правая панель: последние сессии + финансовая история |
| SCR-AD-04 | `Admin - Клиенты` | R-19 | desk | BP-11 | «Заблокировать клиента» | `c.onClick`, `openBlockConfirm`, `confirmBlock`, `closeBlockConfirm`, `closePanel`, роль | все разделы | `selected`, `showBlockConfirm`, `toast` | логотип | ✗ E21 | «**Анонимные ID**, без персональных данных вне этого раздела»; ID формата `#1048`; сегменты Premium / Обычный; в коде нет `User.isBlocked` |
| SCR-AD-05 | `Admin - Жалобы` | R-12 | desk | BP-11 | «Закрыть жалобу» | `c.onClick`, `r.onClick` (решение), `onClose`, `closePanel`, роль | все разделы | `selected`, `selected.closed`/`!selected.closed`, `toast` | логотип | ✗ E20 | типы: «Клиент → специалист», «Спор по no-show», «Специалист → клиент»; решения: **Полный возврат / Частичный возврат / Отказ в жалобе / Страйк специалисту** (DEC-15, SM-16) |
| SCR-AD-06 | `Admin - Финансы` | R-14/R-19 | desk | BP-11 | «Экспортировать CSV» | `switchToSuper` (демо), роль | все разделы | `isModerator` (заглушка «Доступ ограничен»), `!isModerator` | логотип | ◐ E21 | «Доход платформы 17 350 000 ₸», «Выплачено 94 260 000 ₸», «Доход от B2B 5 400 000 ₸»; таблица «Доход по пакетам экспертов» (DEC-08); «Экспортировать CSV» — `<button>` **без обработчика** |
| SCR-AD-07 | `Admin - Рассылки` | R-19 | desk | BP-11 | «Отправить сейчас» | `t.onClick` (тип), `c.onClick` (канал), `onSendNow`, `onSchedule`, роль | все разделы | `isIncident`, `isModerator`, `c.checked`, `toast` | логотип | ✗ Q-13 | сегменты по тарифам специалистов и «Неактивные 14+ дней»; предпросмотр push; история содержит маркетинговую рассылку «**Скидка 15 % на новых специалистов**» (DEC-08, DEC-31); `onSendNow`/`onSchedule` — только тост |
| SCR-AD-08 | `Admin - B2B` | R-16/R-19 | desk | BP-13 | «+ Создать контракт» | `openCreateModal`, `onCreateContract`, `closeCreateModal`, `openInviteModal`, `onSendInvites`, `closeInviteModal`, `c.onClick`, `closePanel`, `switchToSuper`, роль | все разделы | `showCreateModal`, `createdCode`/`!createdCode`, `createError`, `selected`, `showInviteModal`, `isModerator`, `toast` | логотип | ✗ Q-06 | код `SQ-XXXX-YYYY`, единый пул сессий, скидка 10/15 %; «Продлить контракт» и «Приостановить» — `<button>` **без обработчиков** (DEC-18) |
| SCR-AD-09 | `Admin - B2G` | R-16/R-19 | desk | BP-14 | «+ Создать контракт» | `openCreateModal`, `onCreateContract`, `closeCreateModal`, `w.onClick` (модель работы), `c.onClick`, `closePanel`, `switchToSuper`, роль | все разделы | `showCreateModal`, `createdCode`/`!createdCode`, `createError`, `selected`, `isModerator` | логотип | ✗ Q-07 | код `SG-XXXX-YYYY`, номер госконтракта, супервайзеры, «Министерство здравоохранения РК» среди контрагентов (DEC-17); «Продлить»/«Приостановить» — без обработчиков |
| SCR-AD-10 | `Admin - Настройки` | R-15/R-19 | desk | BP-11 | правка справочника | `t.onClick` (4 вкладки), `removeTopic` (**пустой**), `switchToSuper`, роль | все разделы | `tab==='packages'/'topics'/'content'/'audit'`, `isModerator` | логотип | ◐ E21 | вкладки: **Пакеты** (цена/комиссия/видимость — DEC-08) · **Темы** (11 тем) · **Контент** · **Журнал действий**; кнопки «Сохранить», «Добавить», «+ Добавить материал», «Опубликовать»/«Скрыть» — **без обработчиков** |

### 3.6 Служебные файлы (4) — новые ID группы SV

| SCR-ID | Файл | Роль | Frame | Назначение | Переходы | Код | Заметки |
|---|---|---|---|---|---|---|---|
| SCR-SV-01 | `SmartQoldau - Прототип` | — | plain | обзорная страница-индекс всех экранов | **101** ссылка на другие файлы | — | источник противоречия «4 продукта, 82 экрана» (§2.3); не ссылается на `Expert - Тарифы`, `ER-схема`, `CookieBanner`, `LangSwitch` |
| SCR-SV-02 | `SmartQoldau - Презентация` | — | deck | слайды-обзор 24 экранов v1 по PNG | нет | — | использует **все 24** нумерованных PNG из `assets/screens/` — т. е. показывает **устаревший v1** (§6.1) |
| SCR-SV-03 | `SmartQoldau - Investor Deck` | — | deck | инвесторская презентация | нет | — | 6 PNG v1; бизнес-модель, TAM/SAM/SOM, конкуренты, roadmap 2026–2030 (§6.2) |
| SCR-SV-04 | `SmartQoldau - ER-схема` | — | plain | схема сущностей прототипа (USER, SPECIALIST, TARIFF, SESSION, PAYMENT/PAYOUT, COMPLAINT, B2B/B2G CONTRACT, NOTIFICATION) | нет; **на неё тоже никто не ссылается** | — | файл-сирота; модель данных v2, расходится с кодом (§7) |

---

## 4. Действия без результата, битые переходы, файлы-сироты

### 4.1 Обработчик есть, но ничего не происходит (`() => {}` / `noop`)

`[PROTOTYPE FACT]` — определение в `<script data-dc-script>`, проверено скриптом по всем 106 файлам.

| # | Экран | Текст элемента | Handler | Что делает |
|---|---|---|---|---|
| 1 | `- Профиль психолога` | «Показать все» (отзывы) | `onAllReviews` | `() => {}` |
| 2 | `- Профиль` | карандаш «редактировать» | `goEdit` | `noop` |
| 3 | `- Профиль` | «Уведомления», «Язык», «Тема оформления», «Личные данные», «Конфиденциальность», «Помощь и FAQ», «Написать в поддержку» | `it.onClick` | `noop` (**7 из 10** пунктов меню; работают только «Способы оплаты», «Мои жалобы», «Удалить аккаунт») |
| 4 | `Expert - Профессиональный профиль` | «Фото» (загрузка) | `onUploadPhoto` | `() => {}` |
| 5 | `Expert - Консультация` | «Перенести» | `onReschedule` | `() => {}` — при этом у клиента перенос работает (`CL-18`) |
| 6 | `Expert - Поддержка` | «Связаться с поддержкой» | `onContact` | `() => {}` — primary action экрана |
| 7 | `Expert - Поддержка` | категории вопроса | `t.onClick` | `() => {}` |
| 8 | `Expert - Настройки` | «Конфиденциальность», «Язык», «Безопасность», «Платёжные данные» | `l.onClick` | `() => {}` |
| 9 | `Expert Web - Поддержка` | «Написать в поддержку» | `onContact` | `() => {}` — primary action экрана |
| 10 | `Expert Web - Поддержка` | категории вопроса | `t.onClick` | `() => {}` |
| 11 | `Expert Web - Доход` | **«Вывести средства»** | `onWithdraw` | `() => {}` — primary action экрана; в EM тот же экран показывает хотя бы тост |
| 12 | `Expert Web - Профиль` | **«Редактировать профиль»** | `onEdit` | `() => {}` — primary action экрана; экрана редактирования в EW не нарисовано вовсе |
| 13 | `Expert Web - Чаты` | «Начать аудио» | `startAudio` | `() => {}` (соседний «Начать видео» — работает) |
| 14 | `Expert Web - Уведомления` | карточка уведомления | `n.onClick` | `() => {}` — в EM те же уведомления ведут на 4 разных экрана |
| 15 | `Expert Web - *` (все 12) | «Настройки» в нижнем блоке сайдбара | `bottomLinks[2].onClick` | `() => {}` — пункт меню в каждом экране кабинета |
| 16 | `Admin - Настройки` | «✕» у темы обращения | `removeTopic` | `() => {}` |

### 4.2 Действие есть, но результат — только локальный `setState` / тост, без последствий

| # | Экран | Элемент | Что происходит | Чего не хватает |
|---|---|---|---|---|
| 17 | `Expert - Выплаты` | «Вывести средства» | тост «Заявка на вывод отправлена», баланс не меняется | заявка на выплату, статус в истории (SM-14) |
| 18 | `Expert - Заявки` / `Expert Web - Заявки` | «Отклонить» | карточка исчезает из локального массива `declined` | подтверждение, причина, возврат заявки в пул (SM-09) |
| 19 | `Expert - Тарифы` | «Перейти на «Про»» | `localStorage.sq_expert_tier` + тост | оплата пакета, дата смены (DEC-08 — в R1–R3 экрана не будет) |
| 20 | `Admin - Рассылки` | «Отправить сейчас» / «Запланировать» | тост, поля очищаются | подтверждение сегмента, запись в историю, статус (SM-24) |
| 21 | `Admin - Верификация` | «Одобрить» / «Подтвердить отказ» | строка исчезает из таблицы + тост | уведомление специалисту, отражение в его статусе (SM-05) |
| 22 | `Admin - Жалобы` | «Закрыть жалобу» | строка → «закрыта» + тост | видимость решения обеим сторонам (SM-16) |
| 23 | `Admin - Специалисты` / `- Клиенты` | «Заблокировать» | тост | причина, срок, обратимость (SM-17) |
| 24 | `Admin - B2B` | «Отправить» приглашения | тост «Приглашения отправлены N» | список приглашённых, статус активации |
| 25 | `Web - Поддержка` | «Отправить» | кнопка → «Отправлено ✓» | номер тикета, что будет дальше (DEC-37) |
| 26 | `Web - Для бизнеса` / `- Для вузов` | «Оставить заявку» | экран «Заявка отправлена» | номер обращения; в коде это `PARTNERSHIP`-тикет (DEC-18) |
| 27 | `- Видеозвонок`, `Expert - Аудиозвонок (эксперт)` | «Переподключиться» | `setState({showError:false})` | реальная логика reconnect и её состояния (E28) |
| 28 | `- Добавить карту` | «Привязать карту» | валидация → `showSuccess`, карта в список не попадает | связь с `- Способы оплаты` |
| 29 | `- Подать жалобу` | «Отправить жалобу» | экран «Жалоба отправлена» | жалоба не появляется в `- Мои жалобы` (там зашитый список) |
| 30 | `Expert - Жалоба на вас` | «Отправить объяснение» | `explanationSent` | жалоба не меняется в `- Мои жалобы и споры` |
| 31 | `- Полезные статьи` | «Поделиться» | `shareArticle` **не определён** в JS вовсе | — |
| 32 | `- Расслабляющая музыка` | иконка «скачать» | `t.onToggleDownload` определён только внутри `map`, офлайн-логики нет | — |
| 33 | `- Способы оплаты` | «Удалить» карту | `c.onRemove` определён только внутри `map` над пустым демо-набором | подтверждение удаления |

`alert(` и `console.` в прототипе **не встречаются ни разу** `[PROTOTYPE FACT]` (`grep` по 106 файлам) — «мёртвые» действия сделаны через `setState`/тост, а не через заглушки-алерты.

### 4.3 Элемент выглядит кликабельным, но обработчика нет вовсе

| # | Экран | Элемент | Разметка |
|---|---|---|---|
| 34 | `Admin - Финансы` | **«Экспортировать CSV»** | `<button>` без `onClick` |
| 35 | `Admin - Настройки` | «Сохранить» (в каждой строке пакета), «Добавить» (тема), «+ Добавить материал», «Опубликовать»/«Скрыть» | `<button>` / `<div cursor:pointer>` без `onClick` |
| 36 | `Admin - B2B`, `Admin - B2G` | «Продлить контракт», «Приостановить» | `<button>` без `onClick` (по 2 на экран) |
| 37 | `Admin - Верификация` | «Просмотреть» у каждого документа | `<div cursor:pointer>` без `onClick` |
| 38 | `Expert - Выплаты` | «Изменить» (реквизиты `**** 4521`) | `<div cursor:pointer>` без `onClick` |
| 39 | `Expert - Добро пожаловать` | «Условия для специалистов», «Политику конфиденциальности» | `<a>` **без `href`** |
| 40 | `- Добро пожаловать` | «Пользовательское соглашение», «Политику конфиденциальности» | `<div cursor:pointer>` без `onClick` |
| 41 | `- Чат` | «Пожаловаться», «Сообщить о проблеме» (меню сессии) | `<div cursor:pointer>` без `onClick` |
| 42 | `- Аудиозвонок`, `- Видеозвонок` | «Сообщить о проблеме», «Сменить устройство», «Справка» | то же |
| 43 | `Expert - Чат (эксперт)`, `Expert - Видеозвонок (эксперт)` | «Открыть профиль клиента», «Сообщить о проблеме» | то же |
| 44 | `- Способы оплаты` | «Kaspi Pay», «Apple Pay», «Google Pay» | строки списка без обработчиков |
| 45 | `SmartQoldau.kz`, `Web - Профиль психолога` | «App Store», «Google Play» | `<div>` без ссылки (DEC-21 — и хорошо, что без: ссылок нет) |
| 46 | `Admin - Дашборд` | поле «Поиск по платформе…» | `<input>` без обработчиков |

**Итого действий без результата: 46 позиций** (16 пустых handler-ов + 17 «только состояние/тост» + 13 элементов без обработчика). В строках-списках (меню профиля, пункты настроек) одна позиция покрывает несколько элементов.

### 4.4 Переходы на отсутствующие файлы — битых нет

`[PROTOTYPE FACT]` Проверка: собраны все строки вида `"./….dc.html"` из шаблонов и JS всех 106 файлов (`grep -ho '"\./[^"]*\.dc\.html"'`), приведены к именам файлов, отсортированы и сопоставлены со списком реально существующих файлов через `comm -23`.

```
refs = 102 уникальных цели
files = 106
comm -23 refs files  →  (пусто)
```

**Ни одного битого перехода.** Все 102 цели существуют. Дополнительно: единственная внешняя ссылка — `tel:103` в `- Экстренный поиск`; `href="#"` встречается только в якорях лендинга (`#specialists`, `#how`, `#materials`, `#trust`) и в пункте «Главная» его же меню.

Зато есть **тупики** — экраны, из которых нет ни одного перехода (кроме `window.history.back()`): `- Медитации`, `- Полезные статьи`, `- Расслабляющая музыка`, `- Мои жалобы`, `Expert - Выплаты`, `Expert - Рейтинг`, `Expert - Статус верификации`, `Expert - Тарифы`, `Expert - Поддержка`, `Expert - Жалоба на вас`, `Expert - Аудиозвонок (эксперт)` и `Expert - Видеозвонок (эксперт)` (у последних двух есть только выход в «Завершение»). `[PROTOTYPE FACT]` `nav_files=[]` в извлечённых заголовках.

### 4.5 Файлы-сироты

`comm -13` того же сопоставления даёт **4 файла, на которые не ведёт ни один навигационный переход**:

| Файл | Статус сироты | Комментарий |
|---|---|---|
| `SmartQoldau - Прототип` | **настоящая сирота** | сама является корневым индексом — на неё не ссылается ничто, в том числе ни один экран не даёт «вернуться к списку» |
| `SmartQoldau - ER-схема` | **настоящая сирота** | не упоминается ни в одном файле, включая обзорную страницу; попасть можно только открыв файл напрямую |
| `SmartQoldau Web - CookieBanner` | **ложная сирота** | подключается как компонент через `<dc-import name="SmartQoldau Web - CookieBanner">` в **13** страницах PW `[PROTOTYPE FACT]` |
| `SmartQoldau Web - LangSwitch` | **ложная сирота** | то же — `dc-import` в тех же 13 страницах |

Отдельно: `SmartQoldau Expert - Тарифы` — не сирота (на него ведут `Expert - Профиль`, `Expert - Уведомления` и `Expert Web - Профиль`), но **отсутствует на обзорной странице**, то есть при обходе прототипа «по индексу» его не видно. `[PROTOTYPE FACT]`

---

## 5. Дубли и пересечения

### 5.1 CM «Материалы» против четырёх отдельных экранов контента

`[PROTOTYPE FACT]` `- Материалы` не содержит ни одного материала: это хаб из четырёх карточек («Дыхательные упражнения · Снижение тревоги, 2–5 минут», «Расслабляющая музыка · Для сна и концентрации», «Полезные статьи · Материалы от психологов», «Медитации · Направленные практики») плюс три счётчика (34 медитации / 11 дыхание / 6 дней подряд). Каждая карточка ведёт на **отдельный экран** со своей моделью, своим `localStorage`-ключом и своим плеером. `- Главная` дублирует те же четыре ссылки блоком «Полезные материалы» — то есть один и тот же список представлен дважды.

`[CODE FACT]` В коде (E13) это **один** экран `/materials` со списком и фильтром по `kind`, плюс `/materials/:id` — [[11a_SCREEN_REGISTRY]] CL-19, CL-20…23 («по решению №11 — один раздел»).

**Вывод: объединить.** Канон — реализованный `/materials` с фильтрами; четыре экрана прототипа разбираются на **части одного**: список + карточки + три плеера (аудио, медитация, дыхательная сессия) + ридер статьи. Решение №11 в [[Расхождения в прототипе]] закрыто владельцем 2026-09-02. Это не потеря раскладок: хаб `- Материалы` даёт заголовок и счётчики, а четыре экрана — фильтры-чипсы, карточку элемента, мини-плеер и развёрнутый плеер; всё это переносится в один экран. Нижняя навигация остаётся пятипунктовой (Главная / Консультации / Избранное / Материалы / Профиль) `[PROTOTYPE FACT]`.

### 5.2 EM против EW — 12 пар одинаковых разделов

`[PROTOTYPE FACT]` Обе поверхности эксперта рисуют один и тот же набор функций. Сопоставление и вывод по DEC-19 (EW — основной кабинет, EM — companion; уже реализованное в EM не удаляется):

| # | EM (`Expert - …`) | EW (`Expert Web - …`) | Чем отличаются | Вывод |
|---|---|---|---|---|
| 1 | `Главная` | `Главная` | EM: метрики дня + ближайшая + баннер «через 15 минут»; EW: те же метрики + график за 7 дней + «Настроить доступность». Таймер заявки **20 с** vs **240 с** | **Оставить обе.** EM — статус + оффер + ближайшая запись; EW — полный дашборд. Таймер свести к DEC-10 |
| 2 | `Заявки` + `Заявка` | `Заявки` | EW добавляет фильтры и бейдж «⚠ Экстренно»; EM добавляет экран деталей заявки | **Оставить обе**, детали заявки в EW сделать боковой панелью (как в админке) |
| 3 | `Консультации` | `Консультации` | EM: 4 вкладки, включая «Отменённые»; EW: вкладки + поиск, без «Отменённых» | **Оставить обе**, состав вкладок выровнять по EM |
| 4 | `Видеозвонок (эксперт)` | `Видеоконсультация` | EW добавляет **демонстрацию экрана** и боковой чат; EM добавляет модалку no-show | **Оставить обе** — это разные среды; но набор состояний (no-show, reconnect) должен быть общим |
| 5 | `Чат (эксперт)` | `Чаты` | EM — чат внутри активной сессии; EW — **список переписок** + правая панель «О консультации» | **Канон на EW** для списка (DEC-20, Release 3, read-only), чат сессии — на обеих |
| 6 | `Клиент` | `Клиенты` | EM: «Личные данные скрыты платформой»; EW: список + имя клиента при согласии (Р-27) | **Канон только EW** (DEC-19: «Клиент» — только веб). EM-экран из продукта исключается, его текст противоречит Р-27 |
| 7 | `Расписание` + `Доступность` | `Расписание` | EW: три вида (день/неделя/месяц) + «Автоматически принимать заявки»; EM: список слотов + отдельный экран настройки | **Оставить обе** (правило поверхностей: реализованное в EM не удаляем); тумблер автоприёма добавить в EM (расхождение №6, Р-11) |
| 8 | `Доход` + `Выплаты` | `Доход` | EW показывает **комиссию** и таблицу транзакций; EM — только «Начислено» полной суммой | **Канон на EW** по составу; EM привести к разбивке «цена − комиссия = итого» (Р-02/DEC-07) |
| 9 | `Рейтинг` | `Рейтинг` | EW: «Ответить» и «Пожаловаться» на отзыв; EM — **только просмотр** | **Канон на EW**; ответ на отзыв в EM уже реализован в коде (EX-14 ✓) — прототип EM отстал |
| 10 | `Профиль` + `Редактирование профиля` | `Профиль` | EM: меню из 10 пунктов + выход; EW: карточка + «Редактировать» (**пустой**) | **Оставить обе**; экран редактирования в EW прототипом **не нарисован** — пробел (§10.3) |
| 11 | `Уведомления` | `Уведомления` | одинаковый состав; в EM карточки ведут на 4 экрана, в EW — **никуда** | **Оставить обе**, поведение по EM |
| 12 | `Поддержка` | `Поддержка` | идентичны, обе primary-кнопки пустые | **Оставить обе** (DEC-37: эксперту — из EM и EW) |
| + | `Настройки` | пункт «Настройки» в сайдбаре — `noop` | экрана в EW нет | По 11a EW-13/EX-20: **отдельного экрана не делаем**, содержимое — в профиле |

### 5.3 «Поиск специалиста»: web против mobile

| | `- Поиск специалиста` (CM) | `Web - Поиск специалиста` (PW) |
|---|---|---|
| Состав | таймер «Осталось примерно MM:SS», 4 стадии с коннекторами, «Сейчас онлайн: 18 специалистов», ротация подсказок, «Отменить поиск» + подтверждение, состояния `isOffline` / `isNotFound` / `isPriority` | логотип, заголовок, подзаголовок, ссылка «Отменить поиск» |
| Логика | 120 с (30 с приоритет), реальный таймер | `setTimeout` 3 с → профиль психолога |
| Размер | 12 054 байт, 34 строки текста | **2 377 байт, 4 строки текста** — самый маленький продуктовый экран прототипа |

`[PROTOTYPE FACT]` Веб-версия — заглушка: ни таймера, ни отмены-подтверждения, ни пустого результата, ни офлайна. **Вывод: канон на CM**, веб-версия достраивается по мобильной (DEC-21, правило «раскладка с мобильного, меняется только расположение» — [[Расхождения в прототипе]] №14). Оба экрана остаются: это разные поверхности одного шага BP-03.

### 5.4 «Профиль психолога»: web против mobile

| Блок | CM `- Профиль психолога` | PW `Web - Профиль психолога` |
|---|---|---|
| Шапка | обложка `psych-cover-flowers.jpg` + фото + избранное | без обложки, инициал/фото-слот |
| Цена | **5 000 ₸** | **18 500 ₸** (из `PROFILES[id]`) |
| Статус | «Свободен сейчас» | нет |
| Аудио-приветствие | «Познакомьтесь с Динарой за 15 секунд» | нет |
| Образование, сертификаты | есть (2 позиции) | нет |
| Выбор формата | нет (формат выбирается позже) | **есть** (`formatChoices`) |
| Отзывы | «Пользователь 4821», «Пользователь 2093» | «Анонимный клиент» |
| Primary CTA | «Начать консультацию» → `- Выбор темы` | «Записаться» → `Web - Выбор темы?format=&specialist=`, плюс блок «установите приложение» + App Store / Google Play / QR |

`[PROTOTYPE FACT]` Это **разные экраны, а не варианты одного**: разные данные, разный CTA, разная цена одного и того же специалиста.
**Вывод: оставить оба, но свести контент.** Канон состава — CM (образование, сертификаты, статус); канон CTA в вебе — DEC-21 («Записаться» primary, «Открыть в приложении» вторичный, сторовые бейджи скрыты до публикации приложений). Цена и отзывы приводятся к единому источнику (DEC-04, DEC-05, DEC-14).

### 5.5 «Выбор темы»: web против mobile

| | CM `- Выбор темы` | PW `Web - Выбор темы` |
|---|---|---|
| Тем | **9** (Тревога и стресс, Депрессия и апатия, Панические атаки, Зависимости и срывы, Отношения и семья, Потеря и горе, Самооценка и уверенность, Выгорание и усталость, Другое) | **11** (Тревога и стресс, Отношения, Семья, Эмоциональное выгорание, Самооценка, Панические состояния, Зависимости, Жизненные кризисы, Одиночество, Проблемы со сном, Другое) |
| Иконки | эмодзи 🍃 ☁️ 📈 🚫 👥 💔 ⭐ 🔋 ⋯ | SVG-пути |
| Формат | чат / аудио / видео, по умолчанию `audio` | чат / аудио / видео, по умолчанию не выбран |
| Контекст специалиста | нет | «Вы записываетесь к специалисту: …» |

`[PROTOTYPE FACT]` Совпадают только 4 темы из 9 и 11 дословно. Списки на лендинге (**12**, добавлена «Работа и карьера») и в админке (**11**) — ещё два варианта.
**Вывод: объединить справочник, экраны оставить оба.** Канон — **12 тем из кода/Р-14** (DEC-12). Шаг «тема + формат» одинаков на обеих поверхностях; отличается только сетка (2 колонки на мобильном, 3–4 на широком) и контекст «записываетесь к специалисту» (его надо перенести и в мобильный сценарий directed-записи).

### 5.6 «Регистрация» / «Добро пожаловать»: три пары

| Пара | Файлы | Отличия | Вывод |
|---|---|---|---|
| Клиент vs эксперт: «Добро пожаловать» | `- Добро пожаловать` / `Expert - Добро пожаловать` | клиентский: 4 буллета + «Продолжить анонимно»; экспертный: 1 абзац + ссылка «Это приложение для клиентов?» | **Оставить обе** — разные продукты и разные роли (R-02 vs R-06) |
| Клиент vs эксперт: «Регистрация» | `- Регистрация` / `Expert - Регистрация` | одинаковый SMS-флоу, те же демо-константы (`7760012288`, `1234`, «повторно через 00:45»); у клиента дополнительно Google/Apple, B2B-код и дисклеймер, модалка «номер уже зарегистрирован» | **Объединить как компонент** `CMP-28 OTPInput` + общий шаг «телефон → код»; экраны остаются разными (разный набор дополнительных шагов). Google/Apple убрать (DEC-29), B2B-шаг скрыть (DEC-18) |
| Веб vs мобильный вход | `Web - *` (13 страниц) ведут «Войти» на **мобильный** `- Регистрация` | экрана веб-входа в прототипе **нет**; `Web - Стать психологом` «Уже специалист? Войти» ведёт прямо в `Expert Web - Главная` без аутентификации | **Дополнить прототип**: WB-15 «вход в вебе» реализован в коде (`/login`, SMS через BFF), в прототипе не нарисован (§10.2) `[CONTRADICTION]` |

### 5.7 Прочие пересечения, найденные при чтении

- **Экстренная шторка** нарисована дважды почти дословно: `- Главная` («Вам сейчас угрожает непосредственная опасность?… 102 · Полиция / 103 · Скорая / Нет, но нужна поддержка сейчас») и `SmartQoldau.kz` (тот же текст, «быстрее, чем любой **сайт**» вместо «любое **приложение**»). `[PROTOTYPE FACT]` → один компонент `CMP-47 ConsentSheet`/`CMP-46 EmergencyBar`, один текст (DEC-11).
- **Нижняя навигация клиента** (5 пунктов) задана заново в JS каждого из 6 экранов; **сайдбар EW** (9+3) — в каждом из 12; **сайдбар админки** (10) — в каждом из 10. `[PROTOTYPE FACT]` → `CMP-04`, `CMP-05`, `CMP-06`.
- **Центр поддержки** нарисован трижды: `Expert - Поддержка`, `Expert Web - Поддержка`, `Web - Поддержка` — с тремя разными формулировками одного обещания («ответим в течение рабочего дня» ×2 и форма без обещания срока).
- **Жалобы** нарисованы пятью экранами в трёх поверхностях: CL-29, CL-30, EX-22, EX-23, AD-05 — один процесс BP-07/BP-11, одна машина SM-16.

---

## 6. Устаревшее

### 6.1 PNG v1 в `assets/screens/` — 25 файлов, старше `.dc.html` (DEC-38)

`[PROTOTYPE FACT]` Каталог содержит **25** PNG: 24 пронумерованных скриншота (`02-splash` … `23-profile`, плюс `17b-breathing-session` и `20b-meditation-player`) и `test-mockup.png`. Нумерация 02…23 — это нумерация экранов **v1 (92 экрана, `docs/Прототип/`)**, а не v2. Признаки устаревания:

- Ни один из 25 PNG не используется продуктовым экраном — только `SmartQoldau - Презентация` (все 24 нумерованных) и `SmartQoldau - Investor Deck` (6: `02-splash`, `07-home`, `12-chat`, `13-audio`, `14-video`, `16-emergency`). `[PROTOTYPE FACT]`
- Набор не покрывает v2: нет ни одного экрана эксперта, веб-кабинета, админки, жалоб, B2B/B2G — тех самых, что составляют 71 из 102 экранов v2.
- Нумерация обрывается на `23-profile`, тогда как в v2 у клиента 31 экран.
- `01` отсутствует, `17b` и `20b` вставлены между номерами — следы ручной доклейки.
- `test-mockup.png` (766 КБ) — рабочий файл, попавший в каталог.

**Вывод:** PNG — иллюстрации презентаций, **не эталон раскладок**. Эталон — `.dc.html`. В [[11_SCREEN_SPECS]] и [[13_DESIGN_SYSTEM]] на них не ссылаться. `[RECOMMENDATION]` При правке прототипа презентации пересобрать из v2 либо явно пометить как «архив v1».

### 6.2 Тексты с правилами v1 — все цитаты

| Устаревшее | Где именно (цитата) | Канон |
|---|---|---|
| **«30 минут»** | `- Специалист найден`, шторка оплаты: «**30 минут** с психологом · {{ price }}» | 50 минут (DEC-06). Верно только в `Expert - Заявка`: «Продолжительность **50 минут**» |
| **«2 990 ₸» / «23 900 ₸»** | `- Premium`: планы «Помесячно — **2 990 ₸ / месяц**», «Годовая — **23 900 ₸ / год · 1 990 ₸/мес**, Выгода 33 %»; то же в ER-словаре: «plan — enum: monthly (2990₸) / yearly (23900₸/год)» | **4 990 ₸/мес, 39 900 ₸/год** (DEC-01) |
| **«240 с»** | `Expert Web - Главная`: `state = { …, countdown: 240 }`, на карточке «{{ requestCountdown }}с» | 45 с обычная / 20 с экстренная (DEC-10). `Expert - Входящий запрос` — 20 с |
| **«анонимно» / «Полная анонимность»** | `- Добро пожаловать`: «Конфиденциально и **анонимно**», кнопка «**Продолжить анонимно**»; `- Онбординг` слайд 3: «Можно обратиться **анонимно**»; `- Профиль`: «Гость · **Анонимный доступ · история не сохраняется**»; `SmartQoldau.kz`: «Можно обратиться **анонимно**» и FAQ «Можно ли обратиться анонимно?»; `Web - О нас`: «**Анонимно** — можно обратиться без раскрытия личности»; `Web - Профиль психолога`: «Можно обратиться анонимно»; `Web - Для бизнеса`: «**Полная анонимность**»; `Web - Пользовательское соглашение` §5 «Анонимный режим»; `Web - Политика конфиденциальности`: «При **анонимном** обращении имя и фото не запрашиваются»; `Investor Deck`: «**Полная анонимность**» (дважды); EM ×9 экранов «**Анонимный** клиент #NNNN»; `Expert - Клиент`: «Личные данные скрыты платформой»; `Expert Web - Клиенты`: «SmartQoldau **скрывает личные данные**» | «конфиденциально» (DEC-13, DEC-24). **Слово встречается в 14 файлах** — самая массовая правка текстов |
| **«все консультации без ограничений»** | `- Premium`, `showSuccess`: «Теперь **все консультации** и практики **без ограничений**» | Прямо запрещено DEC-03. Ср. `Web - Premium`: «Оплата отдельных консультаций **не входит** в подписку» |
| **9 тем на главной** | `- Главная`: `goToAnxiety … goToOther` — девять плиток | 12 тем (DEC-12); главная показывает 12 или 8 + «Все темы» |
| **«5 000 ₸»** | `- Профиль психолога`: «**5 000 ₸** / Консультация» (у Динары С.) | Коридор 2 000–15 000 ₸ (DEC-04); одна цена на всех поверхностях (DEC-05). Ср. 18 500 ₸ у той же роли в EM/EW |
| **«Продолжить с Google» / «Продолжить с Apple»** | `- Регистрация`, два `[BTN goToPermissions]` | Out of scope MVP — кнопки не показываем (DEC-29) |
| **Пикер города** | `- Главная`: «{{ city }}» + шторка «Выберите город» (Астана / Алматы / Шымкент, `localStorage.sq_city`); `- Каталог`: чипсы города + пустое состояние «В этом городе пока нет специалистов по теме» | Город не фильтр матчинга; пикер на главной **не реализуется** (DEC-28) → запись в [[20_VISUAL_CHANGELOG]] |
| **«пульс с часов»** | `- Главная`: «Ваше состояние сейчас · **Пульс 96 уд/мин · данные с часов**»; `- Анализ` целиком: «Данные с ваших **часов**…», «Синхронизировано с **Apple Watch**», HRV | Release 6; карточка скрыта (DEC-30, Р-25) |
| **«−15 % у новых специалистов»** | `- Главная`: «**Скидка 15 %** на консультации у новых специалистов»; `- Каталог`: бейдж «**-15 %**» и заголовок «Новые специалисты · -15 %»; `Admin - Рассылки`, история: «Скидка 15 % на новых специалистов» и плейсхолдер «Например: Новые специалисты со скидкой 15 %» | Часть тарифной механики — Release 4+ (DEC-08); в R1–R3 не показывать |
| **«KZ скоро»** | `Web - LangSwitch`: `onKz` → `setState({showSoon:true})`, тост «**Қазақша нұсқа жасалып жатыр**», локаль **не переключается** | Отклонено (DEC-22): ru/kz полноценно, переключатель переключает локаль |

### 6.3 Устаревшее сверх списка

| Устаревшее | Где | Канон |
|---|---|---|
| **Тарифы специалистов** Старт/Базовый/Про/Топ (0/0/12 000/20 000 ₸, комиссия 0/15/13/10–11 %) | `Expert - Тарифы` (весь экран), `Expert - Профиль` («Мой тариф»), `Expert Web - Профиль` («Изменить тариф»), `Web - Стать психологом` (блок «Тарифы»), `Admin - Настройки` (вкладка «Пакеты»), `Admin - Специалисты` (фильтр и смена пакета), `Admin - Финансы` («Доход по пакетам»), `Admin - Рассылки` (сегменты «Специалисты — Старт», «— Про/Топ»), `Expert - Уведомления` («Пробный период заканчивается»), ER-словарь | Release 4+ (DEC-08): комиссия **15 % единая** (DEC-07); перечисленные блоки **отсутствуют**, не «скоро» |
| **Интерны / практиканты** | `- Каталог` («Психолог-практикант под супервизией {{university}}», цена 0 ₸), `Admin - Верификация` (вкладка «Студенты-практиканты», код B2G, поле супервайзера), `Admin - B2G` целиком, `Web - Для вузов` целиком, `SmartQoldau.kz` (блок «ДЛЯ ВУЗОВ»), `Investor Deck` | Release 5 (DEC-17): в R1–R4 **ни одного элемента** интернов в UI |
| **B2B в клиентском пути** | `- Регистрация` (шаг «У меня есть корпоративный доступ» + дисклеймер), `- Специалист найден` (`isCorporate` → «Оплачено компанией · Списано из корпоративного пакета сессий»), `Admin - B2B`, `Web - Для бизнеса`, `SmartQoldau.kz` | Release 4 (DEC-18); в R1 — только форма «Для бизнеса» → тикет `PARTNERSHIP` |
| **«Компенсация 50 %»** при поздней отмене | `- Консультации` («Будет возвращено 50 % суммы, оставшаяся часть — компенсация специалисту»), `Expert - Консультации` (статус «Компенсация 50 %»), `Expert - Уведомления` («Отмена менее чем за 2 часа — компенсация 50 % зачислена на баланс»), ER-словарь | R1–R3: полный возврат, эксперту 0 ₸ (DEC-09, Р-01/Р-17) |
| **«Модератор»** как роль админки | все 10 экранов AD: `roleOptions = [Супер-админ, Модератор]`, «Доступ ограничен для роли «Модератор»» | 6 ролей из кода (DEC-25); «Модератор» = пресет VERIFICATION_OPERATOR + QUALITY_TEAM |
| **Kaspi Pay / Apple Pay / Google Pay** | `- Специалист найден` (кнопки в шторке), `- Способы оплаты` (блок «ДРУГИЕ СПОСОБЫ ОПЛАТЫ») | Release 2 после договора с эквайером (DEC-26); в R1 в шторке только карта |
| **Рассылки маркетингового типа** | `Admin - Рассылки` (сегменты + история маркетинговых пушей) | Release 3+, маркетинг только с opt-in (DEC-31) |
| **«Отзыв видит только команда качества»** | `- Оценка` | Относится **только к приватному полю**; публичный отзыв виден в профиле и эксперту (DEC-14) — экран правится |
| **ИИН эксперта** | `Admin - Верификация`: поле «ИИН» + предупреждение «⚠ Дубликат ИИН» с историей | `[CODE FACT]` ИИН в модели `Expert` не собирается; проверка дубликата — Release 5 (DEC-35) |
| **«Ответ психолога за 1–2 минуты» / «от 1 минуты»** | `- Онбординг` слайд 4, `- Добро пожаловать`, `Web - О нас`, `- Профиль психолога` («1–2 мин · Ответ»), `- Специалист найден` («1–2 мин · Ср. время ответа»), `Investor Deck` («От запроса до помощи — за 1–2 минуты») | «обычно до 2 минут» + честный счётчик онлайн (DEC-16) |

---

## 7. Противоречия

Строки 1–18 — обязательный набор тем промпта §7 (сопоставлены с DEC-01…38 и с нумерацией [[Расхождения в прототипе]]); строки 19–40 — найденные при сплошном чтении сверх него. Все цитаты — `[PROTOTYPE FACT]`.

| # | Где (экраны) | Что расходится | DEC / новое |
|---|---|---|---|
| 1 | `- Premium` vs `Web - Premium` vs ER-словарь | Мобильный: «Помесячно **2 990 ₸/месяц**», «Годовая **23 900 ₸/год · 1 990 ₸/мес**». Веб: «Premium **4 990 ₸ / мес**», годового плана нет. ER-словарь: «monthly (2990₸) / yearly (23900₸/год)». Три источника, две цены, разный набор планов | **DEC-01** (4 990 / 39 900); расхождение №1 |
| 2 | `- Premium` vs `Web - Premium` vs `- Специалист найден` | Про скидку на консультации не сказано **нигде**; веб прямо пишет «Оплата отдельных консультаций **не входит** в подписку», а мобильный success — «все консультации без ограничений». Скидки 10 % нет ни на одном экране, хотя она есть в коде | **DEC-02** (10 % за счёт комиссии, Q-01) |
| 3 | `- Premium` (`showSuccess`) vs `Web - Premium` (`premiumPerks`) vs `- Главная` (баннер) | Три разных списка преимуществ: мобильный экран — «приоритетный подбор · безлимит медитаций/дыхательных/статей · отмена в любой момент»; success — «**все консультации** и практики без ограничений»; веб — «…Библиотека статей без ограничений»; баннер на главной — «Приоритетный подбор … Плюс безлимит на медитации и практики» | **DEC-03**; текст «все консультации без ограничений» запрещён |
| 4 | `Expert - Профессиональный профиль` vs `- Профиль психолога` vs `- Каталог` vs `Expert Web - Консультации` vs ER-словарь | Коридор в анкете: «Стоимость консультации, ₸ (диапазон **15 000–35 000**)»; ER-словарь: «price … диапазон **15 000–35 000** (0 для практикантов)»; при этом демо-цены: **5 000 ₸** (`- Профиль психолога`), **21 000 / 24 000 ₸** (`- Каталог`), **18 500 ₸** (EM), **15 500 / 19 500 / 22 000 / 32 000 ₸** (EW), **0 ₸** (практикант) | **DEC-04** (2 000–15 000 ₸, Q-04); расхождение №5 |
| 5 | `- Специалист найден` vs `- Профиль психолога` vs EM/EW | Один и тот же специалист стоит по-разному на разных поверхностях (см. №4). Снимок цены зафиксирован **только комментарием в JS** `- Специалист найден`, ни на одном экране не показан | **DEC-05**; снимок `priceTiyn` — `[CODE FACT]` |
| 6 | `- Специалист найден` vs `Expert - Заявка` vs `Expert Web - Главная` vs `Expert Web - Заявки` vs `Expert - Завершение` vs `- Оценка` | Длительность одной и той же услуги: «**30 минут** с психологом» (шторка оплаты клиента) · «Продолжительность **50 минут**» (заявка эксперта) · «Длительность **~45 минут**» (дашборд EW) · «~**45** / ~**30** / ~**40** мин» (три разных в списке заявок EW) · факт «**48 минут**» (завершение) · «Аудиоконсультация · **8 мин**» (оценка) | **DEC-06** (50 минут); расхождение №8 |
| 7 | `Expert Web - Доход` vs `Expert - Завершение` vs `Expert - Доход` vs `Expert - Тарифы` | Комиссия показана **только** в EW («Комиссия платформы **15 %**»); в EM «Начислено **18 500 ₸**» равно полной цене; экран тарифов задаёт **четыре** ставки 0/15/13/10–11 % | **DEC-07** (15 % единая, разбивка на всех поверхностях эксперта); расхождение №3 |
| 8 | `Expert - Тарифы`, `Expert - Профиль`, `Expert Web - Профиль`, `Web - Стать психологом`, `Admin - Настройки`, `Admin - Специалисты`, `Admin - Финансы`, `Admin - Рассылки`, ER-словарь | Тарифная механика специалистов присутствует в **9 местах** и завязана на комиссию, видимость в поиске, скидку «−15 % у новых» и сегменты рассылок — целый продуктовый слой, которого нет ни в ТЗ, ни в коде | **DEC-08** (Release 4+, Q-02) |
| 9 | `- Консультации` vs `Expert - Консультации` vs `Expert - Уведомления` vs ER-словарь | Политика отмены: «< 2 ч — возвращается **50 %**, остальное — компенсация специалисту»; у эксперта статус «**Компенсация 50 %**» и пуш «компенсация 50 % зачислена на баланс»; статусы сессии в ER: `cancelled_free / cancelled_partial / noshow_client / noshow_specialist / tech_issue`. При этом другой пуш эксперту: no-show клиента — «средства зачислены **в полном объёме**» | **DEC-09** (R1–R3 — полный возврат, эксперту 0 ₸, Q-03) |
| 10 | `Expert Web - Главная` vs `Expert - Входящий запрос` | Таймер принятия заявки: **240 с** (`countdown: 240`) против **20 с** («Автоотклонение через {{countdown}}с»). Разница в 12 раз | **DEC-10** (45 с / 20 с); расхождение №2 |
| 11 | `- Главная` vs `- Экстренный поиск` vs `SmartQoldau.kz` vs `Expert - Заявка` / `- Входящий запрос` vs `Web - Поддержка` | Номера экстренных служб: «**102 · Полиция / 103 · Скорая**» (главная, лендинг, профиль, поддержка) vs «Позвонить **103 / 112**» и «можно позвонить на **103**» (экстренный поиск) vs «102 (полиция) или 103 (скорая)» (эксперту). Линии **150** нет нигде; обратного звонка/callback нет нигде | **DEC-11** (скрининг, 2 мин → broadcast, 5 мин → 150/103/112, callback только после E21-7) |
| 12 | `- Главная` / `- Выбор темы` (9) vs `Web - Выбор темы` (11) vs `SmartQoldau.kz` (12) vs `Admin - Настройки` (11) vs `Expert - Профессиональный профиль` (специализации) | Четыре разных списка тем; совпадают дословно только «Тревога и стресс» и «Другое». Лендинг добавляет «Работа и карьера», которой нет больше нигде; мобильный использует «Депрессия и апатия», «Потеря и горе», которых нет в вебе | **DEC-12** (12 тем из `backend/prisma/seed.ts`/Р-14); расхождение №4 |
| 13 | 14 файлов (полный список — §6.2) | «анонимно» / «полная анонимность» / «Анонимный клиент» — против Р-27, по которому эксперт видит клиента по имени при согласии. `Expert Web - Клиенты` уже реализует Р-27 («Марат Ж. · Клиент 1»), но в шапке того же экрана написано «SmartQoldau **скрывает личные данные**» | **DEC-13**, **DEC-24**; расхождение №10 |
| 14 | `- Оценка` vs `Expert Web - Рейтинг` vs `- Профиль психолога` | «Отзыв видит **только команда качества** SmartQoldau — психолог его не увидит» против «Напишите **публичный ответ** клиенту…» и против отзывов, показанных в публичном профиле психолога. Прямое взаимное исключение | **DEC-14** (split: публичный отзыв + приватное сообщение команде качества) |
| 15 | `- Подать жалобу`, `- Мои жалобы`, `Expert - Жалоба на вас`, `Expert - Мои жалобы и споры`, `Admin - Жалобы` | Пять экранов рисуют полноценный процесс жалоб (48 ч, причины, вложение для чата, ответ эксперта, решения «Полный возврат / Частичный возврат / Отказ / Страйк»), которого нет ни в коде, ни в ТЗ. Словари статусов разные: у клиента «Решено / На рассмотрении / Отклонено», у эксперта «Ожидает вашего ответа / На рассмотрении администратором» | **DEC-15** (принять E20, Q-05) |
| 16 | `- Онбординг`, `- Добро пожаловать`, `- Главная`, `- Поиск специалиста`, `- Профиль психолога`, `- Специалист найден`, `Web - О нас`, `Web - Поиск специалиста`, `Investor Deck` | **Пять** разных формулировок SLA: «за **1–2 минуты**» · «от **1 минуты**» · «до **2 минут**» · «**не более** 2 минут» · «**обычно** это занимает 1–2 минуты». Плюс зашитый счётчик «Сейчас онлайн: **18 специалистов**» и «1–2 мин · Ср. время ответа» как характеристика специалиста | **DEC-16** («обычно до 2 минут» + честный счётчик) |
| 17 | `- Каталог`, `Admin - Верификация`, `Admin - B2G`, `Web - Для вузов`, `SmartQoldau.kz`, `Investor Deck` | Практиканты/супервизия/B2G присутствуют как готовая функциональность (цена 0 ₸, бейдж «Психолог-практикант под супервизией», вкладка верификации, коды `SG-XXXX-YYYY`, «Учёт часов»), включая «Министерство здравоохранения РК» как контрагента | **DEC-17** (Release 5, Q-07) |
| 18 | `- Регистрация`, `- Специалист найден`, `Admin - B2B`, `Web - Для бизнеса`, `SmartQoldau.kz` | B2B присутствует сквозным сценарием: код `SQ-XXXX-YYYY` в регистрации → дисклеймер приватности → «Оплачено компанией» в оплате → контракты и приглашения в админке | **DEC-18** (Release 4, Q-06) |
| **19** | `Expert Web - *` (все 12) vs [[Расхождения в прототипе]] №10 | Сайдбар EW содержит разделы **Клиенты**, **Чаты**, **Поддержка**, **Настройки**, из которых «Настройки» — `noop` во всех 12 экранах, а экрана настроек нет вовсе | **DEC-19**, **DEC-20**; 11a EW-13 «✗ (в профиле)» |
| **20** | `Expert - Клиент` vs `Expert Web - Клиенты` | Одна и та же сущность: в EM «Анонимный клиент #1048 · **Личные данные скрыты платформой**», в EW — имя, счётчик консультаций и история. Прямое противоречие внутри одного продукта | **DEC-19** (карточка клиента — только EW) |
| **21** | `Expert Web - Доход` (таблица транзакций) | Арифметика не сходится: 22 000 ₸ → «−330 ₸» → «3 391 ₸»; 18 500 → «−333» → «3 391»; 15 500 → «−279» → «3 391»; 19 500 → «−293» → «3 391»; 32 000 → «−480» → «4 241». Комиссия ≈ **1,5 %**, а не 15 %, «Итого» **одинаково у четырёх разных сумм** и меньше комиссии + суммы | **новое**; блокирует использование экрана как эталона финансовой раскладки (DEC-07) |
| **22** | `Expert - Доход` (582 000 ₸/мес) vs `Expert Web - Доход` (248 500 ₸/мес) vs `Expert - Главная` (29 500 ₸ сегодня) vs `Expert Web - Главная` (11 970 ₸ сегодня) | Один и тот же эксперт за один и тот же период зарабатывает разные суммы на двух поверхностях — и за месяц, и за день | **новое**; ранее закрыто как Р-24 «моки, не синхронизируем» — но для эталона раскладок это мешает читать состав карточек |
| **23** | `Expert - Заявка` / `- Входящий запрос` / `- Заявки` / `- Чат` / `- Аудиозвонок` / `Expert Web - *` / `Admin - Клиенты` / `- Профиль психолога` / `Expert Web - Клиенты` | **Четыре формата обозначения клиента**: «Анонимный клиент **#1048**» (EM, EW) · «**Пользователь 4821**» и «Пользователь 2093» (отзывы в `- Профиль психолога`) · «Клиент **#1048**» (Admin - Клиенты, `Expert - Уведомления`) · «**Марат Ж. · Клиент 1**» (EW при согласии). Плюс демо-код клиента различается на соседних экранах одного сценария: #1048 / #7284 / #2214 / #3067 | **новое** → [[11_SCREEN_SPECS]] задаёт один формат |
| **24** | `- Специалист найден` / `- Профиль психолога` / `- Чат` / `- Аудиозвонок` / `Expert Web - *` | **Четыре подписи одного состояния «эксперт доступен»**: «Готова к консультации» · «Свободен сейчас» · «На связи» · «Принимаю клиентов». Плюс «Сейчас консультирует» на экране звонка описывает того же эксперта, который «На связи» в чате | **новое**; словарь статусов — [[11_UX_UI_FOUNDATION]] §5 |
| **25** | `- Главная` / `- Выбор темы` / `- Профиль психолога` / `- Каталог` / `SmartQoldau.kz` / `Web - Профиль психолога` | **Пять подписей одного действия «начать путь к консультации»**: «Мне нужна помощь сейчас» · «Продолжить» · «Начать консультацию» · «Записаться» · «Подобрать специалиста». На лендинге «Мне нужна помощь» и «Найти специалиста» стоят рядом и ведут в разные места | **новое** |
| **26** | `Expert - Консультация` / `- Клиент` / `- Консультации` / `- Аудиозвонок (эксперт)` vs CM и EW | Тема одной и той же консультации называется «**Тревожность**» на всех экранах EM и «**Тревога и стресс**» в CM, EW и справочнике тем | **новое**; следствие DEC-12 |
| **27** | `Expert - Верификация` («Проверка специалистом») vs `Admin - Верификация` («Модератор») vs `Expert - Статус верификации` | Кто проверяет документы, называется тремя способами; у эксперта шаг назван «Проверка **специалистом**» — то есть его проверяет другой специалист | **новое**; роли — DEC-25 |
| **28** | `- Подать жалобу` («Рассмотрим в течение **48 часов**») vs `Admin - Дашборд` («Необработанная жалоба **>48 ч**» как **проблема**) | Обещанный клиенту срок совпадает с порогом, после которого админка считает жалобу просроченной: выполнение обещания = нарушение SLA | **новое** → SLA жалобы должен быть строго меньше обещания |
| **29** | `- Поиск специалиста` | Текст «Это займёт **не более 2 минут**» при `seconds: 120` и пороге перехода `106` — то есть реально проходит **14 секунд**. Для приоритетного: 30 → 15, тоже 15 с | **новое**; демо-тайминги нельзя переносить как продуктовые |
| **30** | `SmartQoldau.kz`, `Web - Каталог`, `Web - Premium` («Войти» / «Подключить Premium») и `Web - Материалы` (4 ссылки) и `Expert Web - Профиль` («Изменить тариф») | Desktop-страницы ведут на **ios-frame**-экраны. `Web - Материалы` это ещё и узаконивает текстом: «Эти инструменты открываются **в мобильном интерфейсе** SmartQoldau» | **новое**; ломает поверхность — в продукте это разные приложения |
| **31** | `Web - Стать психологом` | «Уже специалист? **Войти**» ведёт прямо в `Expert Web - Главная` — **минуя аутентификацию**; экрана входа в вебе в прототипе нет вовсе | **новое**; 11a WB-15 «в прототипе нет» |
| **32** | `Expert - Добро пожаловать` | Ссылка «Это приложение для клиентов? Перейти в SmartQoldau» ведёт в **клиентское приложение** — внутри одного прототипа это работает, в продукте это два разных APK/IPA | **новое**; deep link, а не переход (см. `docs/deeplinks.md`) |
| **33** | `- Профиль` («Гость · Анонимный доступ · **история не сохраняется**») vs Р-22/DEC-13 | Гостю обещано, что история **не** сохраняется; по Р-22 гость имеет device-scoped историю, избранное, карту, повторную запись, и они переносятся при конверсии | **новое**; текст вводит в заблуждение в обратную сторону |
| **34** | `Expert - Профессиональный профиль` («диапазон 15 000–35 000») vs `Expert - Редактирование профиля` (поле «Стоимость, ₸» **без коридора**) | Коридор цены показан при регистрации и исчезает при редактировании | **новое** |
| **35** | `Admin - Верификация` (поле «ИИН», «⚠ Дубликат ИИН») vs `[CODE FACT]` модель `Expert` | ИИН не собирается в коде; прототип строит на нём проверку дубликатов | **DEC-35** (Release 5) |
| **36** | `Admin - *` (2 роли) vs `[CODE FACT]` 6 ролей | «Супер-админ / Модератор» против VERIFICATION_OPERATOR, SUPPORT_OPERATOR, QUALITY_TEAM, FINANCE_CONTROL, CONTENT_EDITOR, SUPERADMIN. Причём ограничения нарисованы только для 4 разделов (Финансы, Настройки, B2B, B2G), а Клиенты/Специалисты открыты обеим ролям | **DEC-25** (Q-09) |
| **37** | `Expert - Уведомления` («напоминание» отсутствует) vs `- Уведомления` («начнётся **через 1 час**») vs ER-словарь («Напоминание (**за 1 час**)») vs [[Расхождения в прототипе]] №9 (15 мин в вебе / 30 мин в моб.) | Срок напоминания в v2 сместился на 1 час и перестал совпадать с обеими версиями v1 | **DEC-27** (за 1 ч и за 15 мин, обе стороны, Q-11) |
| **38** | `Expert Web - Уведомления` | «Видеоконсультация с клиентом #1048 начнётся **скоро**» — единственное уведомление без времени; ср. «через 1 час», «через 15 минут» в других | **новое**; тон и точность — [[11_SCREEN_SPECS]] |
| **39** | `- Экстренный поиск` (нет апселла) vs `- Специалист найден` (в шторке оплаты «Узнать про Premium — приоритетный подбор…») | Экстренный путь ведёт в `- Специалист найден?format=`, то есть **в ту же шторку с Premium-апселлом** — апселл в экстренном пути запрещён требованием тона (BRIEF §8) | **новое** `[RISK]` |
| **40** | `SmartQoldau - Прототип` | «4 продукта / 82 экрана»; разделы объявляют 28+30+12+12+8 = 90; ссылок 99 (одна дублируется); файлов 102. Раздел «Материалы» показывает CM-экран `- Анализ` под названием «**Анализ рынка**» | **DEC-38**; §2.3 |

---

## 8. Visual notes по поверхностям

> Прототип написан **целиком на инлайновых стилях**: CSS-классов нет ни одного, единственный `<style>` в каждом файле — сброс `body{margin:0}` и подключение шрифта. Поэтому «дизайн-системы» в прототипе нет — есть повторяющиеся значения. Ниже они посчитаны, а не оценены на глаз.

### 8.1 Палитра — частотный список по всем 106 экранам

Счёт: в скольких файлах встречается hex (внутри файла дубликаты схлопнуты). Всего **111 уникальных hex** `[PROTOTYPE FACT]`.

| Hex | В скольких экранах | Роль по употреблению | Токен брифа | Замечание |
|---|---|---|---|---|
| `#0f3f3a` | **103 / 106** | основной текст, тёмные подложки (сайдбары, корпус звонка) | `ink` | самый частый цвет прототипа |
| `#0f766e` | **97** | primary: кнопки, активные состояния, акцентные иконки, ссылки | `brand.primary` | |
| `#8fa6a1` | **74** | вторичный текст, подписи, плейсхолдеры | `secondary` | **контраст 2.58 : 1 на белом — не проходит WCAG AA** (расхождение №13) |
| `#f2f2f7` | **64** | фон **вокруг** iPhone-корпуса | — | **элемент оболочки показа** (§2.4), не токен продукта: ровно 64 файла = 64 ios-frame-экрана |
| `#6b8580` | **64** | вторичный текст потемнее, описания | `secondary` | **контраст 3.97 : 1 — не проходит WCAG AA** |
| `#159a7c` | **51** | accent: success, «свободен», положительные суммы | `accent` | |
| `#e3f3ee` | **49** | chip / светлая плашка бренда | `chip` | брифом указан `#e3f3ee` — совпадает |
| `#eef2f0` | **48** | границы, разделители, нейтральная плашка | `border` | |
| `#edf2f0` | **38** | граница карточки (невыбранной) | `border` (второй) | два почти одинаковых бордера, различие 1 единица в канале |
| `#a9bdb9` | **37** | неактивная иконка нижней навигации, третичный текст | — | **токена в брифе нет** |
| `#c0392b` | **34** | danger: ошибки, блокировки, экстренное | `danger` | |
| `#f2f2f0` | **32** | нейтральная плашка «отменено/неактивно» | — | **токена в брифе нет**, легко спутать с `#f2f2f7` и `#eef2f0` |
| `#f7faf9` | **28** | surface (фон рабочей области EW/AD) | `surface` | |
| `#f8faf9` | **27** | surface, вариант | — | **дубль `#f7faf9`** |
| `#f2fbf8` | **26** | surface выбранного состояния (бренд) | `surface.brand` | |
| `#7fd6c2` | **26** | подпись «EXPERT» в сайдбаре, акцент на тёмном | — | **токена в брифе нет** |
| `#d9ede7` | 16 | разделитель на брендовой плашке | — | |
| `#c0435f` | 15 | вторичный danger (иконка «избранное», «отменить») | — | **второй danger**, не совпадает с `#c0392b` |
| `#ffffff` | 13 | белый явным hex (чаще пишется `#fff`) | `surface.base` | |
| `#c4d3cf` | 12 | неактивный элемент формы | — | |
| `#e3e9e7` | 11 | граница на нейтральной подложке | — | **третий бордер** |
| `#5b7a75` | 11 | текст на лендинге | — | |
| `#0a5951` | 11 | primary hover (`a:hover`) | — | |
| `#fdedec` / `#f5d9df` | 10 / 10 | фон danger-плашки (два варианта) | — | |
| `#f7fbfa` | 9 | фон непрочитанного уведомления | `surface` | |
| `#2ecc71` | 9 | «онлайн»-точка | — | **третий зелёный** рядом с `#159a7c` и `#0f766e` |
| `#fafcfb` | 8 | surface | `surface` | |
| `#3f5450`, `#3a5450` | 8 / 8 | текст-«тёмно-серый» | — | два варианта одного оттенка |
| `#e6efec` | 7 | граница | `border` | |
| `#c98a2e` | 7 | warning (обрабатывается, пробный период) | `warning` | |
| `#fbe7ec` | 6 | фон розовой плашки | — | |
| `#fdece3`, `#e08a4d` | 5 / 1 | warning-оранжевый (фон / текст) | `warning` (второй) | |
| `#e6f0fb`, `#3b82c4` | 5 / 4 | info (фон / текст) | `info` | |
| `#f1eafb`, `#8b5fc9` | 3 / 2 | premium/violet (фон / текст) | `premium` | |
| `#e14b3f` | 5 | «завершить звонок» | — | **четвёртый красный** |
| `#f5a623` | 4 | звёзды рейтинга | — | **токена в брифе нет** (звезда) |
| `#0a2b27`, `#0a2e2a`, `#0f2320`, `#1a2b28`, `#1f3532`, `#233a36`, `#2b3d3a`, `#2f4744` | 1–3 каждый | подложки экранов звонка | — | **8 почти одинаковых тёмных**, ни одного общего |
| ещё 60 hex | по 1–4 | разовые | — | «длинный хвост» |

**Выводы для [[13_DESIGN_SYSTEM]]:**
1. `[CONTRADICTION]` Вторичный текст в прототипе (`#6b8580` 3.97, `#8fa6a1` 2.58) **не проходит WCAG 2 AA**; в 74 и 64 экранах соответственно. Затемнённые токены из E16-A (`faint` 5.23 / `muted` 6.21 / `body` 7.29 на белом) — канон, откат к исходным цветам требует явного решения владельца (расхождение №13).
2. `[RECOMMENDATION]` Схлопнуть дубли: границы `#eef2f0` / `#edf2f0` / `#e3e9e7` / `#e6efec` → 2 токена (`border`, `border.strong`); поверхности `#f7faf9` / `#f8faf9` / `#fafcfb` / `#f7fbfa` → 2; красные `#c0392b` / `#c0435f` / `#e14b3f` → `danger` + `danger.call`; зелёные `#159a7c` / `#2ecc71` → `accent` + `status.online`; 8 тёмных подложек звонка → 1 `call.surface` + 2 оверлея.
3. `#f2f2f7` — цвет **оболочки**, а не продукта; в токены не переносить (§2.4).
4. `#a9bdb9` (неактивная иконка таб-бара), `#7fd6c2` (акцент на тёмном сайдбаре), `#f5a623` (звезда), `#f2f2f0` (нейтральная плашка) — реально используются, но токенов в брифе для них нет → `[DECISION REQUIRED]` при формировании `contracts/design-tokens.json`.

### 8.2 Радиусы

`[PROTOTYPE FACT]` Частота `border-radius` по всему корпусу: **14 px — 295**, 16 — 163, 12 — 153, 20 — 118, 18 — 62, 10 — 62, 9 — 42, 27 — 41, 26 — 29, 24 — 27, 22 — 22, 25 — 19, далее 2/8/11/13/21/23/28 — единицы.

- Промпт §8 называет шкалу 16/20/24/27/28. Факт: **доминирует 14** (карточки), затем 16 и 12; 20 — «лист» desktop-showcase и крупные блоки; 26/27 — кнопки высотой 52–54 px (`height:54;border-radius:27` — половина высоты, то есть «pill», а не радиус); 9–11 — мелкие иконки и логотип; 48 — корпус iPhone (оболочка); 9999/50 % — аватары и пилюли.
- `[RECOMMENDATION]` Шкала `radius.sm 10 · md 14 · lg 20 · xl 26 · pill 9999`; 12/16/18/22/24/25 — свести к ближайшему. Экраны-источники: `- Главная` (14 на всех плитках), `Expert Web - Главная` (20 на листе и 14 на карточках), `Admin - Дашборд` (14/12).

### 8.3 Тени

`[PROTOTYPE FACT]` Тени в прототипе задаются двумя способами: в обычном `style=` (состояние покоя) и в `style-hover=` — DC-специфичном атрибуте (состояние наведения). Считаны раздельно.

**В состоянии покоя** (`style=`) — 7 повторяющихся значений:

| Тень | Употреблений | Где | Назначение |
|---|---|---|---|
| `0 30px 70px -30px rgba(15,63,58,0.18)` | 21 | «лист» desktop-showcase (EW + AD) | **оболочка показа** |
| `0 12px 24px -8px rgba(15,118,110,0.4)` | 14 | крупные CTA | `shadow.brand` |
| `0 24px 48px -12px rgba(0,0,0,0.25)` | 12 | модалки и шторки | `shadow.modal` |
| `0 -20px 40px -16px rgba(0,0,0,0.2)` | 8 | нижние шторки (bottom sheet) | `shadow.sheet` |
| `-24px 0 48px -20px rgba(0,0,0,0.2)` | 6 | правые панели админки (drawer) | `shadow.drawer` |
| `0 14px 28px -8px rgba(225,75,63,0.5)` | 5 | кнопка «завершить звонок» | `shadow.danger` |
| `0 8px 20px -12px rgba(15,63,58,0.25)` / `0 2px 8px -4px rgba(15,63,58,0.1)` | 3 / 3 | приподнятые карточки | `shadow.card` |
| `0 40px 80px rgba(0,0,0,0.18)` | 64 (в `ios-frame.jsx`) | корпус iPhone | **оболочка показа** |

**При наведении** (`style-hover=`) — 118 употреблений, из них одно значение доминирует:

| Hover-эффект | Употреблений | Где |
|---|---|---|
| `border-color:#0f766e; box-shadow:0 8px 20px -12px rgba(15,118,110,0.4)` | **94** | карточки-ссылки (обзорная страница, каталоги, списки) |
| `box-shadow:0 8px 20px -12px rgba(15,118,110,0.4)` (без бордера) | 5 | кнопки |
| `background:rgba(255,255,255,0.1)` | 11 | пункты тёмного сайдбара (EW, AD) |
| `background:#0c5f58` | 4 | primary-кнопка при наведении |
| прочие (`#fdf1f2`, `0 10px 24px…`, danger-вариант) | 4 | разовые |

`[INFERENCE]` Единственный «фирменный» hover прототипа — «зелёная» тень + зелёный бордер. Для мобильных поверхностей (64 из 106 экранов) он бессмыслен — там нет указателя; значит это **эффект показа в браузере**, а не состояние компонента. Продуктовый эквивалент — `:hover` только на web-поверхностях и `:active`/`pressed` на мобильных.

### 8.3a Анимации

`[PROTOTYPE FACT]` **21 уникальный `@keyframes`**: `sq-home-spin` (загрузка главной), `sq-spin`, `sq-pulse`, `sq-pulse-beat`, `sq-pulse-dot`, `sq-beat`, `sq-beat-fast` (экран «Анализ», пульс), `sq-breathe` (дыхательная практика), `sq-ring`, `sq-ring-urgent` (входящий оффер), `sq-glow`, `sq-glow-pulse`, `sq-dot`, `sq-dot-b` (индикатор «печатает»), `sq-bar` (эквалайзер плеера), `sq-tip` (смена подсказок в поиске), `sq-fade`, `sq-in`, `sq-pop`, `sq-page-in`, `pulse`. `[RECOMMENDATION]` В [[13_DESIGN_SYSTEM]] это сводится к 6 ролям: spinner · pulse/heartbeat · breathe · ring (входящий вызов) · typing-dots · enter/fade — остальное дубли.

### 8.4 Типографика

`[PROTOTYPE FACT]`

- Шрифт: **Inter** (Google Fonts), подключается в каждом файле через `<helmet>`; веса **400;500;600;700;800**, на лендинге дополнительно **900**. Фолбэк — `-apple-system, BlinkMacSystemFont, sans-serif`.
- Исключение: `ios-frame.jsx` использует `-apple-system, "SF Pro", system-ui` — но это оболочка (статус-бар, навбар, клавиатура), а не контент экрана.
- Кегли (частота): **13 px — 322**, 13.5 — 310, 11 — 282, 12.5 — 232, **24 — 178**, 12 — 169, 14 — 163, 11.5 — 133, 15 — 106, 10.5 — 98, 16 — 64, 20 — 55, 17 — 44, 14.5 — 44, 26 — 39, 22 — 33, 18 — 29, 21 — 26, 15.5 — 25, 19 — 24, 38 — 16, 30/28 — по 15, 34 — 11.
- Начертания: **700 — 968**, **800 — 569**, 600 — 474, 500 — 352, 400 — 1. То есть тело текста в прототипе почти нигде не 400 — базовое начертание фактически **500–600**, заголовки 700–800.
- `[CONTRADICTION]` Полушаги `13.5`, `12.5`, `11.5`, `14.5`, `10.5`, `15.5` (в сумме > 700 употреблений) — следствие рисования, а не шкалы. `[RECOMMENDATION]` шкала `11 · 12 · 13 · 14 · 16 · 18 · 20 · 24 · 28 · 34`, начертания `500 / 600 / 700 / 800`. Экраны-источники: `- Главная` (13/11/24), `Expert Web - Главная` (13.5/11/24), `Admin - Дашборд` (12.5/11/24).

### 8.5 Сетка мобильного (CM + EM, 64 экрана)

`[PROTOTYPE FACT]`

- Внешняя обёртка: `width:100%;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f2f2f7` → `<x-import component-from-global-scope="IOSDevice" from="./ios-frame.jsx" hint-size="390,844">`.
- Внутренний холст: `position:relative;width:100%;height:100%;background:#fff;font-family:'Inter',…;overflow:hidden`.
- Скроллируемая область контента — единая формула: `position:absolute;inset:0;overflow-y:auto;padding:64px 22px <bottom>`, где `<bottom>` = **110** (экраны с таб-баром, 10 шт.), **40** (13 шт.), **32** (10 шт.), **140** (1), либо вычисляемый `{{ bottomPad }}` (3).
- То есть **боковой отступ контента — 22 px**, верхний — **64 px** (у одного экрана 60). Промпт §8 называет 26/24 px и safe-area 72 — фактические значения **22** и **64**. `[CONTRADICTION]` (мелкое, но важно для спецификаций).
- Шапка экрана — не компонент: на каждом экране собственный `display:flex;align-items:center;justify-content:space-between;margin-bottom:22px`.
- Ширина холста 390 (hint) при `IOSDevice width=402` по умолчанию — прототип задаёт 390×844, компонент нарисует 402×874 с бортом. Оба числа — оболочка.

### 8.6 Desktop: EW и AD (22 экрана)

`[PROTOTYPE FACT]`

- Внешний слой: `width:100%;min-height:100vh;display:flex;justify-content:center;background:#eef2f0;padding:24px;box-sizing:border-box` — **оболочка**.
- «Лист» приложения: `width:1440px;max-width:100%;min-height:1024px;display:flex;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 30px 70px -30px rgba(15,63,58,0.18)` — **скругление и тень — оболочка**, ширина 1440 и высота 1024 — макетная база.
- **Сайдбар: ширина 260 px**, `flex-shrink:0`, фон `#0f3f3a`, `padding:28px 18px`; логотип 34×34 `r9`; пункты `padding:11px 12px;border-radius:12px;gap:12px`, иконка 18×18 `stroke-width:1.8`, подпись 13.5/700; активный пункт — залитая плашка; hover — `rgba(255,255,255,0.1)`; внизу — блок служебных ссылок через `border-top:1px solid rgba(255,255,255,0.1)`.
- Админка добавляет к пунктам бейдж-счётчик и значок «замок» для закрытых ролью разделов.
- Правая рабочая область: фон `#f7faf9`, внутри карточки на белом.
- Детали сущности открываются **правой панелью** (drawer) с тенью `-24px 0 48px -20px rgba(0,0,0,0.2)` — во всех 6 экранах админки с таблицами и нигде в EW. `[PROTOTYPE FACT]`
- Ни одного `@media`-запроса во всём прототипе. `[PROTOTYPE FACT]` — адаптив не проектировался, он целиком на стороне реализации.

### 8.7 Desktop: публичный сайт (14 страниц)

`[PROTOTYPE FACT]`

- `hint-size="100%,0"` (у 12 из 14; `Web - Поиск специалиста` и компоненты — без) — то есть страница во всю ширину, без «листа».
- Контейнер контента: **`max-width: 1240px; margin: 0 auto; padding: 16px 32px`** (шапка) — на лендинге; внутренние страницы повторяют ту же ширину.
- Шапка: `position:sticky;top:0;z-index:100;background:rgba(255,255,255,0.92);backdrop-filter:blur(10px);border-bottom:1px solid #eef2f0`.
- Логотип 32×32 `r9` + текст 16/800 `#0f3f3a`; навигация 12/600 `#3f5450`; кнопки шапки высотой 44–48 px, `border-radius` = половина высоты.
- Ссылки: `a{color:#0f766e}` во всех файлах; `a:hover` объявлен только на сайте и в двух вариантах — `#0a5951` и `#0b5c56` `[CONTRADICTION]` (мелкое, но это два разных hover одного бренда). Все прочие наведения — через DC-атрибут `style-hover` (§8.3).
- `body{background:#fff}` на сайте против `#eef2f0` в кабинетах.

---

## 9. Assets

### 9.1 `assets/` — 3 файла

| Файл | Размер | Что это | Где используется |
|---|---|---|---|
| `onboarding-illustration.png` | 1 523 288 б | иллюстрация первого слайда онбординга | `- Онбординг`, `isSlide0` — **1 экран** |
| `psychologist-aigerim.jpg` | 2 229 744 б | фотопортрет психолога (демо-персона) | `- Специалист найден`, `- Профиль психолога`, `- Чат`, `- Аудиозвонок`, `- Видеозвонок`, `- Оценка`, `Expert - Видеозвонок (эксперт)` (как «вы») — **7 экранов** |
| `psych-cover-flowers.jpg` | 332 075 б | обложка-фон карточки психолога | `- Профиль психолога` — **1 экран** |

`[RISK]` Все три — многомегабайтные несжатые файлы (суммарно 4,0 МБ на три изображения). В продукт переносится **композиция**, а не файлы; фотографии специалистов приходят из API (`GET /experts/{id}`), иллюстрация онбординга требует пересборки в `webp`/векторе.

### 9.2 `assets/screens/` — 25 PNG (скриншоты v1)

| Файл | Классификация | Использование |
|---|---|---|
| `02-splash.png` | v1, экран запуска | Презентация, **Investor Deck** |
| `03-onboarding.png`, `04-welcome.png`, `05-registration.png`, `06-permissions.png` | v1, вход и онбординг клиента | Презентация |
| `07-home.png` | v1, главная клиента | Презентация, **Investor Deck** |
| `08-topic.png`, `09-search.png`, `10-found.png`, `11-therapist-profile.png` | v1, подбор специалиста | Презентация |
| `12-chat.png`, `13-audio.png`, `14-video.png` | v1, три формата сессии | Презентация, **Investor Deck** |
| `15-rating.png` | v1, оценка | Презентация |
| `16-emergency.png` | v1, экстренная помощь | Презентация, **Investor Deck** |
| `17-breathing.png`, `17b-breathing-session.png` | v1, дыхательные практики (список + сессия) | Презентация |
| `18-music.png` | v1, музыка | Презентация |
| `19-articles.png` | v1, статьи | Презентация |
| `20-meditation.png`, `20b-meditation-player.png` | v1, медитации (список + плеер) | Презентация |
| `21-consultations.png`, `22-history.png` | v1, консультации и история | Презентация |
| `23-profile.png` | v1, профиль клиента | Презентация |
| `test-mockup.png` | **рабочий файл**, 766 КБ, не классифицируется | **не используется нигде** |

- Покрытие: только **клиентское мобильное приложение v1**; 0 экранов эксперта, веба, админки.
- Ни один PNG не используется продуктовым экраном. `[PROTOTYPE FACT]`
- `[RECOMMENDATION]` Каталог пометить как архив v1 (DEC-38) либо удалить `test-mockup.png` и пересобрать презентации из v2.

### 9.3 `uploads/` — 19 файлов

| Файл | Размер | Что это | Где используется |
|---|---|---|---|
| `logo_smartqoldau.png` | 1 311 850 б | **логотип продукта** | **44 экрана**: все 10 AD, все 12 EW, 13 PW, `- Сплэш`, `- Онбординг`, `- Добро пожаловать`, `- Поиск специалиста`, `- Медитации` (в плеере), `Expert - Сплэш`, `Expert - Добро пожаловать`, Презентация, Investor Deck. Самый переиспользуемый asset прототипа |
| `pasted-1786016977883-0.png`, `pasted-1786017075691-0.png` | по 1 523 288 б | **дубли** `onboarding-illustration.png` (побайтово тот же размер) | не используются |
| `pasted-1786051566627-0.png` | 2 229 744 б | **дубль** `psychologist-aigerim.jpg` | не используется |
| `pasted-1786055796216-0.png` | 332 075 б | **дубль** `psych-cover-flowers.jpg` | не используется |
| `{10F6D354-…}.png` | 202 664 б | вставленный скриншот (промежуточный материал) | не используется |
| `4b2f7144-…​.png` и `{88FF079A-…}.png` | по 137 132 б | **пара дублей** вставленного скриншота | не используются |
| `{551816CA-…}.png` и `{551816CA-…-bdf5d9c8}.png` | по 123 665 б | **пара дублей** | не используются |
| `{B20565BD-…}.png` (190 105 б) и `{B20565BD-…-aa00e1b5}.png` (190 171 б) | почти-дубли | вставленные скриншоты | не используются |
| `{6A105F96-…}.png`, `{7437724A-…}.png`, `{8F21E2F5-…}.png`, `{9A161911-…}.png`, `{C3272D44-…}.png`, `{C53B8EDC-…}.png`, `{D122870A-…}.png` | 38–209 КБ | вставленные в процессе работы изображения | не используются |

**Итого:** из 19 файлов `uploads/` используется **ровно один** — логотип. Остальные 18 — рабочие вставки и дубли файлов из `assets/`. `[PROTOTYPE FACT]` (`grep` по `src="uploads/…"` во всех 106 файлах)

`[RECOMMENDATION]` В продукт переносится один asset — логотип (и его нужно пересобрать: 1,3 МБ PNG для иконки 32×32 в шапке). Остальное — материал прототипирования.

### 9.4 Скрипты рантайма (4 файла, в продукт не переносятся)

| Файл | Размер | Роль |
|---|---|---|
| `support.js` | 69 150 б | рантайм формата `.dc.html`: парсер `<x-dc>`, `sc-if`/`sc-for`, привязка `DCLogic` к React. Подключается **в каждом** из 106 файлов |
| `ios-frame.jsx` | 16 507 б | `IOSDevice`, `IOSStatusBar`, `IOSNavBar`, `IOSGlassPill`, `IOSList`, `IOSListRow`, `IOSKeyboard`. Помечен автором `@ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)` — **явное указание, что это леса, а не дизайн** |
| `deck-stage.js` | 136 293 б | веб-компонент презентации: клавиатурная навигация, спикерские заметки, миниатюры, печать/PPTX. Используют Презентация и Investor Deck |
| `image-slot.js` | 65 350 б | `<image-slot>` — заполняемая drag-n-drop заглушка под фото, состояние в сайдкаре `.image-slots.state.json`. Используется на лендинге (фото специалистов, мокапы приложения) |

### 9.5 `docs/` — 1 файл

`docs/SmartQoldau-ER-Data-Dictionary.md` (12 752 б) — словарь данных прототипа v2. Дублирует и уточняет экран `SmartQoldau - ER-схема`. `[CONTRADICTION]` расходится с кодом там же, где и экраны: Premium «monthly (2990₸) / yearly (23900₸/год)» (DEC-01), «price — диапазон 15 000–35 000» (DEC-04), «Tariff … commission 0/15/13/10–11 %» (DEC-08), статусы сессии `cancelled_partial` (DEC-09), роли «Супер-админ / Модератор» (DEC-25), «Напоминание (за 1 час)» (DEC-27).

---

## 10. Выводы для следующих документов

### 10.1 Главное

1. **Эталон раскладок — 102 `.dc.html`**, а не PNG и не обзорная страница. Числа «4 продукта / 82 экрана» использовать запрещено (DEC-38).
2. **Прототип внутренне противоречив** по 40 позициям (§7), из них 22 найдены сверх известного списка. Ни одна цифра (цена, срок, таймер, комиссия, длительность) не берётся из прототипа без сверки с DEC.
3. **46 позиций «действие без результата»** (§4) — это не дефекты прототипа, а перечень мест, где [[07_USER_FLOWS_AND_STATE_MACHINES]] и [[11_SCREEN_SPECS]] обязаны дорисовать результат: подтверждение, состояние, переход.
4. **Битых переходов нет**, но 12 экранов — тупики (§4.4): у них нет ни одного исходящего перехода. Для продукта это означает обязательный «назад» и/или нижнюю навигацию.
5. **Оболочку показа** (iPhone-корпус, 9:41, `#f2f2f7`, скруглённый «лист» 1440×1024 с тенью, демо-кнопки и `?demo=`) в продукт не переносить (§2.4).

### 10.2 Экранов нет в прототипе, но они есть в коде — «прототип нужно дополнить»

`[CODE FACT]` источник — [[11a_SCREEN_REGISTRY]].

| Что | ID | Маршрут в коде | Почему прототипа нет |
|---|---|---|---|
| **Экран согласия Р-27** («как к вам обращаться» + согласие видимости для эксперта) | `SCR-CL-32` | экран согласия (E17-3), `POST /me/expert-visibility` | решение Р-27 принято 2026-09-02, позже прототипа v2 |
| **Вход в вебе** (SMS через BFF) | `SCR-WB-15` | `/login`, `/api/auth/*` | в прототипе все «Войти» ведут на **мобильный** `- Регистрация`; `Web - Стать психологом` вообще пускает в кабинет без входа (§7 №31) |
| **Веб-кабинет клиента — 8 экранов**: заявка, ожидание подбора, консультации, чат, звонок, избранное, уведомления, профиль | `SCR-WB-16` (группа) → предлагаю развернуть в `SCR-CW-01…08` | `web/app/[locale]/(client)/*` | веб-версия клиента появилась решением Р-26 после прототипа ([[Расхождения в прототипе]] №14). В PW нарисована **только витрина** |
| **Админка — 7 разделов вне прототипа**: вход + TOTP, сотрудники, модерация профилей, флаг «рейтинг < 4.0», модерация отзывов, тикеты поддержки, контент | `SCR-AD-11…17` | `/login*`, `/staff`, `/profile-moderation`, `/flagged-experts`, `/reviews`, `/tickets*`, `/content` | реализованы, в прототип v2 не внесены |
| **Поддержка клиента** (тикеты: список, новый, карточка) | `SCR-CL-28` | `/support`, `/support/new`, `/support/:id` | в v2 поддержка у клиента только пунктом меню в `- Профиль`, и тот `noop` |
| **Редактирование профиля эксперта в вебе** | — (пробел) | профиль в кабинете | в EW есть кнопка «Редактировать профиль» (`onEdit` пустой), экрана нет |

`[RECOMMENDATION]` Все перечисленные — задача «дополнить прототип v2», а не «выдумать раскладку по ходу реализации» (CLAUDE.md: придумывать раскладку, когда для экрана есть прототип, нельзя; когда прототипа нет — раскладка берётся с соответствующего мобильного экрана по правилам адаптации E14/E15, [[Расхождения в прототипе]] №14).

### 10.3 Что передать конкретным документам

| Документ | Что забрать отсюда |
|---|---|
| [[02_RELEASE_PLAN]] | §6 (что вырезается из R1–R3: тарифы, интерны, B2B, Kaspi/Apple/Google, «−15 %», wearable, KZ-«скоро»), §10.2 (что дорисовать в прототипе) |
| [[03_ROLES_PERMISSIONS_AND_JTBD]] | §7 №36 (2 роли прототипа против 6 в коде), §3.5 (замки в сайдбаре), R-17/R-18 из PW-форм |
| [[04_BUSINESS_PROCESS_CATALOG]] | столбец BP в §3: полное покрытие BP-01…BP-15 экранами |
| [[07_USER_FLOWS_AND_STATE_MACHINES]] | §3 столбец «Состояния» (все `[IF …]`), §4 (где состояний не хватает), §4.4 (тупики), словари статусов из §7 №24 |
| [[11_SCREEN_SPECS]] | вся §3 как основа; §7 №23–26, 38 (единые формулировки), §5 (что объединяется) |
| [[13_DESIGN_SYSTEM]] | вся §8; §2.4 (что не токен); группы CMP из §5.7 |
| [[20_VISUAL_CHANGELOG]] | §6 (каждая правка текста), §2.4, DEC-28 (пикер города), §7 №30 (смешение поверхностей) |
| [[16_DECISIONS]] / [[19_DECISION_LOG_AND_OPEN_QUESTIONS]] | §7 строки 19–40 — новые расхождения сверх известных 18; строки 21, 28, 29, 39 требуют решения |

### 10.4 Введённые ID (сверх [[11a_SCREEN_REGISTRY]])

**Новая группа (4 ID):** `SCR-SV-01` Прототип · `SCR-SV-02` Презентация · `SCR-SV-03` Investor Deck · `SCR-SV-04` ER-схема — служебные файлы, в реестре 11a их нет.

**Суффиксы к существующим ID реестра** (не новая нумерация — разложение строки реестра, покрывающей несколько файлов), 22 ID:
`SCR-CL-25a/b` · `SCR-EX-01a/b/c` · `SCR-EX-02a/b` · `SCR-EX-03a/b` · `SCR-EX-08a/b` · `SCR-EX-10a/b/c/d` · `SCR-EX-13a/b` · `SCR-EX-16a/b` · `SCR-WB-04a/b` · `SCR-WB-10a/b`.

**Предложено к развёртыванию** (не введено в этом документе, решение — за [[11_SCREEN_SPECS]]): `SCR-WB-16` (веб-кабинет клиента, 8 экранов) → `SCR-CW-01…08`; `SCR-AD-11…17` (7 разделов админки вне прототипа) → развернуть по одному ID на раздел.

---

*Конец документа. Все факты о прототипе получены из извлечённого DOM и JS 106 файлов без визуального рендера (§1.2).*
