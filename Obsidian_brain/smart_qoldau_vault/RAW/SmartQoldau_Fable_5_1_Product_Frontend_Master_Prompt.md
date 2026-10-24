# MASTER PROMPT ДЛЯ FABLE 5.1
## SmartQoldau — бизнес-проектирование, use cases и frontend blueprint по существующему прототипу

### Исходные материалы
- Используй Superpowers скилл
- Вся документация: `/home/erda/Музыка/Obsidian_brain/smart_qoldau_vault` здесь отражай все действия
- Репозиторий: `/home/erda/Музыка/smart_qoldau`
- Прототип: загруженный архив `/home/erda/Музыка/Obsidian_brain/smart_qoldau_vault/RAW/SmartQoldau (1)`
- В архиве находятся интерактивные `.dc.html`-экраны, изображения, `ios-frame.jsx`, `support.js`, ER-схема, словарь данных, публичный сайт, клиентское приложение, интерфейсы специалиста, экспертный web-кабинет и admin-панель.

---

# 1. Роль

Работай как единая сильная продуктовая команда, совмещающая роли:

- Lead Business Analyst;
- Principal Product Manager;
- Service Designer;
- UX Architect;
- Lead Frontend Architect;
- Design System Lead;
- Product Operations Architect;
- Marketplace/EAP Product Expert;
- QA Lead;
- специалист по безопасности и конфиденциальности сервисов психологической помощи.

Твоя задача — не просто описать экраны и не просто составить список функций.

Ты должен восстановить и спроектировать целостный бизнес SmartQoldau:

1. кто пользуется платформой;
2. зачем приходит каждая роль;
3. какие действия выполняет каждая роль;
4. как роли взаимодействуют между собой;
5. какие бизнес-процессы происходят до, во время и после консультации;
6. какие существуют правила, статусы, ограничения, SLA и исключения;
7. как проходят платежи, начисления, возвраты и выплаты;
8. как работают Premium, B2B и B2G;
9. как обеспечиваются качество, безопасность и конфиденциальность;
10. каким должен быть frontend каждого продукта;
11. как реализовать frontend максимально близко к существующему прототипу;
12. как разбить работу так, чтобы продукт можно было закончить быстро, последовательно и без постоянных переделок.

Итогом должен стать implementation-ready Product Blueprint: документация такого уровня, по которой другая ИИ-модель или команда разработки сможет реализовывать продукт без догадок и без повторного изобретения бизнес-логики.

---

# 2. Главная цель

Создай единый, непротиворечивый и проверяемый план SmartQoldau с особым акцентом на frontend.

Frontend должен:

- визуально соответствовать прототипу;
- сохранять его спокойный, доверительный и современный характер;
- не превращаться в типовой SaaS-dashboard или стандартный шаблон UI-библиотеки;
- иметь завершённые сценарии, а не только красивые экраны;
- учитывать все состояния: loading, empty, error, offline, reconnect, success, blocked, forbidden, no data, no specialist, payment failed и другие;
- иметь чёткие границы между публичным сайтом, клиентским интерфейсом, интерфейсом специалиста и admin-панелью;
- не содержать кнопок без результата, фальшивых данных и декоративных функций без бизнес-процесса;
- быть полностью связанным с use cases, бизнес-правилами, статусами и доступным backend-функционалом.

Главный критерий качества:

> После утверждения документации frontend-команда должна понимать, какие продукты и экраны создавать, для какой роли, в каком состоянии, с какими действиями, данными, ограничениями, текстами и критериями приёмки — без повторных уточнений по каждой странице.

---

# 3. Режим работы

Сейчас разрешены только:

- изучение репозитория;
- изучение всех файлов прототипа;
- изучение существующего backend и тестов только для проверки доступных бизнес-возможностей;
- бизнес-анализ;
- продуктовый анализ;
- UX-аудит;
- frontend-аудит;
- создание документации;
- создание диаграмм;
- создание roadmap и backlog.

До отдельной команды запрещено:

- менять продуктовый код;
- создавать frontend-приложения;
- переносить или удалять файлы;
- менять backend;
- менять Prisma-схему;
- добавлять API;
- устанавливать зависимости;
- переписывать проект;
- начинать реализацию экранов;
- автоматически «улучшать» дизайн прототипа;
- создавать временный frontend на моках и выдавать его за готовый продукт.

После завершения планирования остановись.

Начало реализации разрешается только после команды:

`BUSINESS AND FRONTEND PLAN APPROVED — START RELEASE 1`

---

# 4. Источники истины и приоритеты

Используй источники в следующем порядке.

## 4.1. Для бизнес-поведения

1. подтверждённые решения владельца проекта;
2. существующий backend-код и автоматические тесты;
3. интерактивная логика отдельных `.dc.html`-экранов;
4. `docs/SmartQoldau-ER-Data-Dictionary.md`;
5. Investor Deck и презентационные материалы;
6. предположения.

## 4.2. Для визуального frontend

1. отдельные интерактивные `.dc.html`-экраны;
2. их состояния, inline-стили, тексты, изображения и действия;
3. PNG-референсы из `assets/screens/`;
4. обзорная страница `SmartQoldau - Прототип.dc.html`;
5. новые предложения только после явного обоснования.

Если источники расходятся, не выбирай вариант молча. Зафиксируй противоречие и предложи рекомендуемое решение.

Во всех документах используй метки:

- `[PROTOTYPE FACT]` — подтверждено прототипом;
- `[CODE FACT]` — подтверждено кодом или тестом;
- `[INFERENCE]` — логический вывод;
- `[RECOMMENDATION]` — рекомендуемое решение;
- `[DECISION REQUIRED]` — требуется решение владельца;
- `[CONTRADICTION]` — источники расходятся;
- `[OUT OF SCOPE]` — исключено из текущего релиза;
- `[RISK]` — риск.

Для каждого факта указывай конкретный файл, экран, route, функцию, модель или тест.

---

# 5. Обязательное изучение прототипа

Архив содержит около 159 файлов и более 100 HTML-прототипов. Не ограничивайся обзорной страницей и названиями файлов.

## 5.1. Изучи каждый экран

Для каждого `.dc.html`:

- открой и визуально проверь экран;
- прочитай весь видимый текст;
- изучи state;
- изучи обработчики действий;
- изучи переходы между экранами;
- изучи modal, sheet, toast и error states;
- изучи empty/loading/offline states;
- зафиксируй role и platform;
- зафиксируй, какой бизнес-процесс обслуживает экран;
- найди действия, которые никуда не ведут;
- найди переходы на отсутствующие файлы;
- найди дублирующие экраны;
- найди устаревшие версии;
- найди противоречия в текстах, ценах и статусах.

## 5.2. Раздели экосистему на реальные продуктовые поверхности

Прототип содержит как минимум:

### A. Публичный сайт SmartQoldau

- главная;
- выбор темы;
- поиск специалиста;
- каталог;
- профиль психолога;
- материалы;
- Premium;
- для бизнеса;
- для вузов;
- стать психологом;
- о нас;
- поддержка;
- пользовательское соглашение;
- политика конфиденциальности;
- cookie banner;
- переключение языка.

### B. Клиентский mobile-first интерфейс

- splash;
- onboarding;
- welcome;
- регистрация и анонимный вход;
- разрешения;
- главная;
- выбор темы и формата;
- автоматический поиск;
- экстренный поиск;
- найденный специалист;
- каталог;
- профиль специалиста;
- оплата;
- чат;
- аудио;
- видео;
- оценка;
- консультации;
- избранное;
- материалы;
- дыхание;
- музыка;
- статьи;
- медитации;
- Premium;
- уведомления;
- жалобы;
- профиль;
- платёжные методы;
- wearable/эмоциональный анализ.

### C. Mobile-интерфейс специалиста

- onboarding и вход;
- профессиональный профиль;
- документы;
- верификация;
- статус верификации;
- главная;
- рабочий статус;
- входящий запрос;
- заявка;
- заявки;
- консультация;
- чат;
- аудио;
- видео;
- заметки;
- завершение;
- клиент;
- расписание;
- доступность;
- доход;
- выплаты;
- рейтинг;
- тарифы;
- жалобы и споры;
- профиль;
- настройки;
- уведомления;
- поддержка.

### D. Web-кабинет специалиста

- главная;
- заявки;
- консультации;
- клиенты;
- чаты;
- видеоконсультация;
- расписание;
- доход;
- рейтинг;
- профиль;
- уведомления;
- поддержка.

### E. Admin-панель

- дашборд;
- верификация;
- жалобы;
- клиенты;
- специалисты;
- финансы;
- рассылки;
- B2C;
- B2B;
- B2G;
- настройки.

Не считай наличие экранов доказательством того, что все эти продукты должны быть полностью реализованы в первом релизе.

Сначала определи назначение каждой поверхности и устранение ненужного дублирования.

---

# 6. Важное правило для frontend: отличай product UI от демонстрационной рамки

В прототипе часть mobile-экранов показана внутри `ios-frame.jsx`, а desktop-интерфейсы размещены внутри большой закруглённой showcase-области.

Не копируй демонстрационную оболочку в production автоматически.

## Для mobile

- не рисуй искусственный iPhone-корпус внутри настоящего приложения;
- не дублируй системный status bar;
- используй safe-area inset;
- сохраняй внутреннюю сетку, типографику, навигацию, карточки, цвета и композицию прототипа.

## Для Expert Web и Admin

- не делай искусственный «макет в макете», если приложение должно занимать весь viewport;
- сохрани sidebar, внутренние отступы, card system, таблицы, header и визуальную иерархию;
- отдельно укажи, какие внешние поля, фон и закругление относятся к showcase, а какие — к продукту.

---

# 7. Сначала проведи аудит противоречий

Обязательно проверь и разреши следующие известные несогласованности.

1. В mobile Premium указаны `2 990 ₸/месяц` и `23 900 ₸/год`, а на публичном сайте — `4 990 ₸/месяц`.
2. В одном профиле специалиста цена `5 000 ₸`, в других материалах встречаются `15 000–35 000 ₸` и `18 500 ₸`.
3. После активации Premium есть текст, будто «все консультации и практики без ограничений», хотя на web-странице сказано, что консультации оплачиваются отдельно.
4. После консультации клиенту показывается сообщение, что отзыв видит только команда качества, но в публичном профиле отображаются отзывы. Необходимо разделить private quality feedback и public review.
5. Анонимный режим заявлен как полноценный, но история, избранное, жалобы, платежи и повторная запись требуют устойчивой идентичности.
6. Список тем на разных экранах отличается; ER-словарь содержит 12 тем, mobile home показывает другой набор.
7. Заявлено подключение специалиста за 1–2 минуты, но отсутствует доказанная операционная модель, гарантирующая такой SLA.
8. «Экстренная помощь» не должна восприниматься как замена 102/103 или медицинской/кризисной службе.
9. Практиканты и супервайзеры описаны в B2G и ER-словаре, но их полноценные интерфейсы и процессы отсутствуют.
10. Mobile Expert и Expert Web частично дублируют друг друга без чёткой границы ответственности.
11. Обзорная страница прототипа сообщает другое число экранов, чем фактически находится в архиве.
12. PNG-референсы могут быть старше отдельных `.dc.html`-экранов.
13. Публичный сайт ссылается на App Store/Google Play, но фактический статус мобильного приложения необходимо проверить.
14. RU/KZ-переключатель содержит заглушку вместо полноценной локализации.
15. В разных источниках продукт может описываться как психологическая либо психологическая и юридическая помощь. Текущий прототип ориентирован на психологическую поддержку; юридические консультации нельзя добавлять без отдельного решения.
16. Утверждения о «полной анонимности», «шифровании» и «разговор не записывается» должны соответствовать реальной модели данных и инфраструктуре.
17. Тарифы специалистов, комиссии и видимость должны быть одинаковыми в Investor Deck, admin, Expert и финансовой модели.
18. Правила отмены, no-show, возврата и компенсации должны быть едиными во всех интерфейсах.

Для каждого противоречия:

- укажи источники;
- объясни бизнес-риск;
- предложи основное решение;
- предложи альтернативу;
- укажи, какое решение должен подтвердить владелец;
- после утверждения назначь один canonical value или canonical rule.

---

# 8. Определи продукт до описания экранов

Создай чёткое определение SmartQoldau.

Опиши:

- проблему пользователя;
- ценностное предложение;
- основную аудиторию;
- основной рынок запуска;
- ключевой момент ценности;
- основной happy path;
- границы ответственности платформы;
- что продукт делает;
- чего продукт не делает;
- MVP;
- Release 1;
- следующие релизы;
- out of scope.

Не называй все функции прототипа MVP.

Подготовь рекомендуемую очередность:

1. обязательное для запуска;
2. обязательное вскоре после запуска;
3. дифференцирующие функции;
4. экспериментальные функции;
5. функции, которые необходимо временно исключить.

Wearable-анализ, большая контентная библиотека, расширенная B2G-модель, AI и сложные Premium-механики не должны автоматически блокировать запуск core marketplace.

---

# 9. Полная модель ролей

Не ограничивайся ролями «клиент», «психолог» и «администратор».

Обязательно проанализируй следующие роли.

## 9.1. Посетитель публичного сайта

- изучает продукт;
- смотрит каталог;
- читает профиль;
- выбирает тему;
- начинает поиск;
- отправляет B2B/B2G-заявку;
- оставляет заявку специалиста;
- читает юридические документы.

## 9.2. Анонимный клиент

- получает временную идентичность;
- может начать консультацию без публичного имени;
- имеет ограниченный или временный доступ к истории;
- должен понимать последствия анонимного режима.

## 9.3. Зарегистрированный клиент

- управляет профилем;
- хранит историю;
- оплачивает;
- добавляет в избранное;
- повторно записывается;
- подаёт жалобу;
- управляет Premium.

## 9.4. Corporate/B2B-клиент

- активирует доступ по коду;
- использует корпоративный пакет;
- сохраняет конфиденциальность от работодателя;
- понимает, что покрывает пакет и что требует доплаты.

## 9.5. Premium-клиент

- получает только чётко утверждённые преимущества;
- не должен видеть ложное обещание бесплатных консультаций, если они не входят в подписку.

## 9.6. Профессиональный специалист

- проходит верификацию;
- настраивает профиль, расписание и доступность;
- получает заявки;
- проводит консультации;
- получает доход;
- отвечает на отзывы и жалобы;
- управляет тарифом.

## 9.7. Студент-практикант

- подключается только через B2G-контракт;
- подтверждает вуз, курс и специальность;
- работает только с разрешёнными темами;
- консультирует только при явном согласии клиента;
- не принимает emergency, тяжёлые темы и случаи вне компетенции;
- работает под супервизией;
- накапливает подтверждённые часы практики.

## 9.8. Супервайзер

- принимает студентов;
- контролирует нагрузку;
- проводит супервизию;
- подтверждает часы;
- оформляет замечания;
- не получает неограниченный доступ к приватным данным клиента.

## 9.9. Модератор/верификатор

- проверяет документы;
- принимает или отклоняет заявку;
- запрашивает повторную загрузку;
- рассматривает жалобы в пределах полномочий;
- не видит финансы и системные настройки без необходимости.

## 9.10. Специалист команды качества

- анализирует private feedback;
- расследует спорные консультации;
- отслеживает повторные жалобы;
- рекомендует предупреждение, страйк или блокировку.

## 9.11. Сотрудник поддержки

- обрабатывает технические, аккаунтные и платёжные обращения;
- отделяет обычную поддержку от кризисной ситуации и жалобы;
- передаёт обращения по маршруту эскалации.

## 9.12. Финансовый сотрудник

- сверяет платежи;
- подтверждает возвраты;
- контролирует выплаты;
- работает с отклонёнными выплатами;
- не имеет доступа к содержанию консультаций.

## 9.13. Контент-менеджер

- создаёт и редактирует материалы;
- отправляет их на профессиональную проверку;
- публикует, локализует и архивирует;
- управляет Premium-доступом к материалам.

## 9.14. B2B/B2G-менеджер

- получает lead;
- квалифицирует;
- формирует предложение;
- создаёт контракт;
- передаёт клиента на сопровождение;
- продлевает контракт.

## 9.15. Представитель компании

- заключает договор;
- получает коды или приглашения;
- видит только агрегированную статистику;
- не видит личности, темы, специалистов и содержание консультаций сотрудников.

## 9.16. Сотрудник компании

- активирует доступ;
- использует сессии;
- может доплачивать за непокрытые услуги;
- сохраняет конфиденциальность.

## 9.17. Представитель вуза/ведомства

- заключает соглашение;
- подключает студентов;
- назначает кураторов;
- получает только допустимую статистику и подтверждение часов.

## 9.18. Супер-администратор

- управляет платформой;
- управляет ролями;
- контролирует финансы, B2B/B2G, настройки, блокировки и audit log;
- не должен выполнять опасные действия без подтверждения и журналирования.

## 9.19. System Actor

- matching;
- таймеры;
- уведомления;
- подписки;
- автоотмена;
- возвраты;
- выплаты;
- escalation;
- audit.

Для каждой роли создай карточку:

- Role ID;
- описание;
- business goal;
- JTBD;
- вход в систему;
- доступные поверхности;
- разрешённые действия;
- запрещённые действия;
- видимые данные;
- скрытые данные;
- ответственность;
- связанные процессы;
- KPI;
- риски;
- lifecycle роли.

Создай RBAC/ABAC-матрицу:

`Role × Resource × Action × Condition × Data visibility`.

---

# 10. Спроектируй все бизнес-процессы

Для каждого процесса создай:

- Process ID;
- название;
- business outcome;
- trigger;
- actors;
- systems;
- preconditions;
- основной flow;
- decision points;
- alternative flows;
- exception flows;
- state transitions;
- SLA/timers;
- notifications;
- money movement;
- audit events;
- analytics events;
- privacy constraints;
- completion criteria;
- unresolved decisions.

Используй Mermaid sequence/flowchart/state diagrams. Если возможно — BPMN-подобные swimlanes.

## 10.1. Обязательные группы процессов

### Acquisition и публичный сайт

- знакомство с продуктом;
- просмотр каталога;
- просмотр профиля;
- начало подбора с сайта;
- переход к клиентскому интерфейсу;
- заявка «Стать психологом»;
- B2B lead;
- B2G lead;
- обращение в поддержку;
- consent/cookie/legal flow.

### Доступ клиента

- анонимный вход;
- регистрация по телефону;
- OTP;
- повторный вход;
- corporate code;
- создание устойчивого аккаунта из anonymous session;
- разрешения камеры/микрофона/push;
- выход;
- удаление аккаунта;
- экспорт данных;
- отзыв согласий.

### Подбор специалиста

- выбор темы;
- выбор формата;
- выбор города/языка;
- автоматический matching;
- Premium priority;
- ручной каталог;
- directed booking;
- specialist not found;
- offline during search;
- отмена поиска;
- повторный поиск;
- urgent support;
- immediate danger flow 102/103.

### Оплата

- retail card;
- Kaspi Pay;
- Apple Pay/Google Pay;
- корпоративная сессия;
- бесплатная/льготная сессия практиканта;
- payment authorization;
- successful payment;
- declined payment;
- retry;
- price snapshot;
- чек;
- refund;
- partial refund;
- chargeback/dispute;
- subscription payment.

### Консультация

- instant consultation;
- scheduled consultation;
- join;
- waiting room;
- chat;
- audio;
- video;
- escalation chat → audio → video;
- camera/microphone denied;
- network loss;
- reconnect;
- смена устройства;
- завершение клиентом;
- завершение специалистом;
- technical issue;
- client no-show;
- specialist no-show;
- cancellation;
- reschedule;
- session timeout;
- support incident.

### После консультации

- private quality feedback;
- public review;
- skip feedback;
- favorite;
- repeat booking;
- продолжение с тем же специалистом;
- complaint within allowed period;
- complaint after deadline;
- resolution notification;
- история;
- удаление или retention данных.

### Самопомощь и контент

- просмотр материалов;
- Premium lock;
- breathing session;
- meditation session;
- music playback;
- article reading;
- favorite/save;
- completion tracking;
- контентная рекомендация после консультации;
- публикация материала;
- professional review;
- localization;
- archive.

### Специалист: onboarding и допуск

- регистрация;
- professional profile;
- photo;
- specialties;
- languages;
- formats;
- price;
- upload documents;
- submit verification;
- approve;
- reject;
- request reupload;
- duplicate IIN;
- block;
- restore access;
- тариф и trial.

### Специалист: ежедневная работа

- настройка расписания;
- availability;
- work status;
- heartbeat/presence;
- enable/disable urgent requests;
- incoming request;
- accept;
- decline;
- timeout;
- auto-accept;
- консультация;
- private note;
- completion/outcome;
- доход;
- payout request;
- payout failed;
- review reply;
- complaint response;
- support ticket.

### Admin и operations

- verification queue;
- complaint investigation;
- request specialist explanation;
- refund decision;
- strike;
- temporary restriction;
- permanent block;
- client block;
- payout review;
- financial reconciliation;
- broadcast;
- incident notification;
- manage topics;
- manage tariffs;
- manage content;
- audit log;
- role change;
- dangerous action confirmation.

### B2C
допиши сам

### B2B

- lead;
- qualification;
- commercial proposal;
- contract;
- invoice/payment;
- session pool;
- corporate code;
- email invitations;
- employee activation;
- usage;
- exhausted pool;
- extra payment;
- aggregate reporting;
- renewal;
- suspension;
- termination.

### B2G и практика

- lead;
- agreement;
- student code;
- student registration;
- verification;
- supervisor assignment;
- consent from client;
- topic restriction;
- session under supervision;
- incident escalation;
- supervision review;
- hours confirmation;
- university report;
- student suspension;
- conversion from intern to professional specialist.

---

# 11. Создай полный каталог Use Cases

Use cases должны быть не общими описаниями, а проверяемыми контрактами поведения.

## 11.1. Формат каждого Use Case

```markdown
# UC-XXX — Название

## Business goal
## Primary actor
## Supporting actors
## Trigger
## Preconditions
## Permissions
## Input data
## Main success scenario
1.
2.
3.

## Alternative flows
### A1 — ...

## Exception flows
### E1 — ...

## Business rules
- BR-...

## State transitions
## Timers and SLA
## Notifications
## Payment/financial effect
## Privacy and data visibility
## Audit events
## Analytics events
## Related prototype screens
## Existing backend support
## Backend gaps
## Postconditions
## Acceptance criteria
## Gherkin scenarios
## Open decisions
```

## 11.2. Минимальный обязательный реестр Use Cases

Создай отдельные use cases минимум для:

### Public

- PUB-001 — посетитель изучает главную;
- PUB-002 — выбирает тему;
- PUB-003 — запускает поиск;
- PUB-004 — просматривает каталог;
- PUB-005 — просматривает профиль специалиста;
- PUB-006 — отправляет заявку специалиста;
- PUB-007 — отправляет B2B lead;
- PUB-008 — отправляет B2G lead;
- PUB-009 — обращается в поддержку;
- PUB-010 — принимает cookie policy;
- PUB-011 — переключает язык.

### Client identity

- CLI-001 — продолжает анонимно;
- CLI-002 — регистрируется по телефону;
- CLI-003 — подтверждает OTP;
- CLI-004 — повторно запрашивает OTP;
- CLI-005 — активирует corporate code;
- CLI-006 — связывает anonymous session с аккаунтом;
- CLI-007 — выходит;
- CLI-008 — удаляет аккаунт;
- CLI-009 — отзывает разрешение;
- CLI-010 — восстанавливает сессию после перезапуска.

### Discovery and matching

- MAT-001 — выбирает тему;
- MAT-002 — выбирает формат;
- MAT-003 — запускает автоматический подбор;
- MAT-004 — отменяет поиск;
- MAT-005 — повторяет поиск после отсутствия экспертов;
- MAT-006 — продолжает поиск после reconnect;
- MAT-007 — получает Premium priority;
- MAT-008 — выбирает специалиста из каталога;
- MAT-009 — просматривает профиль;
- MAT-010 — запрашивает другого специалиста;
- MAT-011 — начинает urgent support flow;
- MAT-012 — получает рекомендацию 102/103 при непосредственной угрозе.

### Payments

- PAY-001 — оплачивает картой;
- PAY-002 — добавляет карту;
- PAY-003 — получает decline;
- PAY-004 — оплачивает Kaspi Pay;
- PAY-005 — оплачивает Apple/Google Pay;
- PAY-006 — использует корпоративный пакет;
- PAY-007 — оплачивает непокрытую часть;
- PAY-008 — получает полный refund;
- PAY-009 — получает partial refund;
- PAY-010 — покупает Premium;
- PAY-011 — отключает автопродление;
- PAY-012 — получает уведомление об окончании подписки.

### Consultation

- CON-001 — начинает instant chat;
- CON-002 — начинает instant audio;
- CON-003 — начинает instant video;
- CON-004 — присоединяется к scheduled session;
- CON-005 — переключается chat → audio;
- CON-006 — переключается audio → video;
- CON-007 — теряет соединение;
- CON-008 — reconnect;
- CON-009 — запрещает camera/microphone;
- CON-010 — завершает консультацию;
- CON-011 — специалист завершает консультацию;
- CON-012 — клиент не пришёл;
- CON-013 — специалист не пришёл;
- CON-014 — фиксируется technical issue;
- CON-015 — клиент переносит консультацию;
- CON-016 — клиент отменяет больше чем за установленный срок;
- CON-017 — клиент отменяет поздно;
- CON-018 — создаётся support incident.

### Post-session

- PST-001 — оставляет private quality feedback;
- PST-002 — публикует review;
- PST-003 — пропускает feedback;
- PST-004 — добавляет специалиста в favorite;
- PST-005 — повторно записывается;
- PST-006 — подаёт complaint;
- PST-007 — отслеживает complaint;
- PST-008 — получает resolution;
- PST-009 — пытается пожаловаться после deadline.

### Expert onboarding

- EXP-001 — регистрируется;
- EXP-002 — заполняет профиль;
- EXP-003 — задаёт цену;
- EXP-004 — загружает документы;
- EXP-005 — отправляет на проверку;
- EXP-006 — получает approval;
- EXP-007 — получает rejection;
- EXP-008 — загружает повторно;
- EXP-009 — выбирает тариф;
- EXP-010 — проходит trial;
- EXP-011 — блокируется;
- EXP-012 — восстанавливается через support.

### Expert work

- EOP-001 — меняет work status;
- EOP-002 — настраивает расписание;
- EOP-003 — включает urgent requests;
- EOP-004 — получает offer;
- EOP-005 — принимает offer;
- EOP-006 — отклоняет offer;
- EOP-007 — offer истекает;
- EOP-008 — открывает client context;
- EOP-009 — проводит chat;
- EOP-010 — проводит audio/video;
- EOP-011 — создаёт private note;
- EOP-012 — завершает с outcome;
- EOP-013 — просматривает income;
- EOP-014 — запрашивает payout;
- EOP-015 — отвечает на review;
- EOP-016 — отвечает на complaint.

### Admin

- ADM-001 — проверяет обычного специалиста;
- ADM-002 — проверяет практиканта;
- ADM-003 — выявляет duplicate IIN;
- ADM-004 — назначает supervisor;
- ADM-005 — запрашивает reupload;
- ADM-006 — расследует complaint;
- ADM-007 — выдаёт refund;
- ADM-008 — выдаёт strike;
- ADM-009 — блокирует специалиста;
- ADM-010 — блокирует клиента;
- ADM-011 — обрабатывает payout issue;
- ADM-012 — создаёт broadcast;
- ADM-013 — изменяет tariff configuration;
- ADM-014 — управляет topics;
- ADM-015 — публикует content;
- ADM-016 — просматривает audit log.

### B2B/B2G

- B2B-001 — создаёт contract;
- B2B-002 — генерирует corporate code;
- B2B-003 — приглашает сотрудников;
- B2B-004 — сотрудник активирует доступ;
- B2B-005 — расходуется session pool;
- B2B-006 — представитель получает aggregate report;
- B2B-007 — продлевает contract;
- B2B-008 — приостанавливает contract;
- B2G-001 — создаёт agreement;
- B2G-002 — регистрирует student;
- B2G-003 — проверяет student;
- B2G-004 — назначает supervisor;
- B2G-005 — ограничивает topics;
- B2G-006 — получает согласие клиента;
- B2G-007 — student проводит session;
- B2G-008 — supervisor проводит review;
- B2G-009 — подтверждаются practice hours;
- B2G-010 — university получает report;
- B2G-011 — student suspends;
- B2G-012 — student converts to professional.

Добавь отсутствующие use cases, найденные в прототипе или backend.

---

# 12. Каталог бизнес-правил

Создай нумерованный каталог `BR-XXX`.

Для каждого правила:

- правило;
- причина;
- affected roles;
- use cases;
- prototype evidence;
- current backend support;
- frontend effect;
- exception;
- owner;
- priority.

Обязательно определить правила следующих групп.

## 12.1. Анонимность

- что означает «анонимно»;
- какие данные всё равно обрабатываются;
- что сохраняется;
- доступна ли оплата;
- доступна ли жалоба;
- доступна ли история;
- когда требуется регистрация;
- как anonymous identity преобразуется в account.

## 12.2. Matching

- приоритеты;
- topic compatibility;
- language;
- format;
- availability;
- city relevance;
- rating;
- intern restrictions;
- Premium priority;
- retry;
- timeout;
- fairness;
- срочные запросы.

## 12.3. Цена и платежи

- price snapshot;
- момент списания;
- момент начисления;
- refund rules;
- late cancellation;
- no-show;
- tech issue;
- payment fee;
- corporate coverage;
- intern pricing;
- receipt;
- dispute.

## 12.4. Тарифы специалиста

- Start;
- Basic;
- Pro;
- Top;
- monthly fee;
- commission;
- visibility;
- trial;
- переход;
- просрочка;
- downgrade;
- блокировка.

## 12.5. Reviews и complaints

- private feedback versus public review;
- moderation;
- reply;
- complaint deadline;
- evidence;
- expert response deadline;
- resolution;
- refund;
- strike;
- appeal;
- repeated complaints.

## 12.6. Premium

- canonical price;
- monthly/yearly plan;
- exact benefits;
- отсутствие или наличие скидки на консультации;
- content access;
- priority matching;
- auto-renewal;
- cancellation;
- grace period;
- refund.

## 12.7. B2B privacy

- employer receives aggregate data only;
- minimum aggregation threshold;
- no topics;
- no specialist names;
- no consultation content;
- no individual usage history;
- employee departure;
- exhausted pool.

## 12.8. B2G/intern

- consent;
- allowed topics;
- forbidden topics;
- emergency ban;
- supervisor capacity;
- session review;
- privacy;
- hours;
- complaint handling;
- conversion criteria.

## 12.9. Safety

- SmartQoldau не является экстренной службой;
- direct danger → 102/103;
- urgent emotional support отделено от непосредственной угрозы;
- специалист не должен давать медицинский диагноз;
- wearable analysis — не медицинская диагностика;
- minors policy;
- suicide/self-harm escalation должен быть отдельно согласован с профильным специалистом и юристом;
- все обещания должны соответствовать реальной операционной способности.

---

# 13. Жизненные циклы и state machines

Создай state machine для:

- visitor/anonymous/registered client;
- corporate access;
- Premium subscription;
- expert application;
- verification;
- document;
- work availability;
- request;
- candidate offer;
- scheduled booking;
- consultation;
- payment;
- refund;
- payout;
- review;
- complaint;
- specialist sanction;
- B2B contract;
- B2G contract;
- intern;
- supervision;
- content item;
- support ticket.

Для каждого transition укажи:

- actor;
- command;
- preconditions;
- previous state;
- next state;
- timers;
- side effects;
- notifications;
- financial effect;
- rollback possibility;
- frontend response.

Frontend не должен придумывать свои статусы. Все labels и badges должны происходить из единого state catalog.

---

# 14. Операционная и финансовая модель

Подготовь не только UI-документы, но и реальный бизнес-план выполнения процессов.

## 14.1. Operations

Определи:

- кто и когда проверяет специалистов;
- SLA верификации;
- кто следит за очередью жалоб;
- SLA ответа специалиста;
- SLA решения;
- кто утверждает refund;
- кто подтверждает payout;
- кто реагирует на incident;
- кто сопровождает B2B/B2G;
- какие процессы автоматические;
- какие ручные;
- где нужен принцип четырёх глаз;
- что обязательно журналируется;
- минимальный состав операционной команды для пилота.

Создай RACI для ключевых процессов.

## 14.2. Supply-demand model

Проверь реалистичность обещания «специалист за 1–2 минуты».

Опиши:

- минимальное число online-специалистов;
- concurrency;
- среднюю длительность сессии;
- accept rate;
- timeout;
- часы пик;
- резерв urgent capacity;
- что показывать клиенту при недостатке supply;
- какой SLA можно обещать на старте.

## 14.3. Revenue streams

- take rate с консультаций;
- monthly fee специалистов;
- Premium;
- B2B packages;
- B2G model;
- potential partner revenue.

## 14.4. Unit economics framework

Не выдумывай неподтверждённые числа. Создай формулы и таблицу assumptions:

- GMV;
- average session price;
- commission;
- payment fee;
- expert payout;
- refund rate;
- support cost;
- video infrastructure cost;
- CAC;
- activation rate;
- repeat rate;
- retention;
- ARPU;
- contribution margin;
- B2B contract margin.

Отдельно укажи, какие числа требуют подтверждения владельца.

## 14.5. KPI tree

Обязательно включи:

- visitor → registration conversion;
- registration → first request;
- search success rate;
- time to match;
- offer acceptance;
- payment success;
- session completion;
- no-show;
- reconnect success;
- repeat booking;
- retention;
- average rating;
- complaint rate;
- refund rate;
- verification time;
- expert activation;
- expert utilization;
- payout time;
- Premium conversion/churn;
- B2B pool utilization;
- B2G practice completion;
- content engagement.

---

# 15. Главный акцент — frontend blueprint

Frontend должен быть описан не как набор страниц, а как связанная продуктовая система.

## 15.1. Рекомендуемое разделение поверхностей

Сравни варианты и дай итоговую рекомендацию, но используй как исходный ориентир:

### Public Web

Назначение:

- acquisition;
- trust;
- SEO;
- каталог и профили;
- B2B/B2G lead generation;
- specialist acquisition;
- legal/support.

Не должен пытаться полностью копировать личный кабинет.

### Client Mobile-First Product

Назначение:

- быстрый вход;
- поиск;
- оплата;
- консультация;
- post-session;
- история;
- self-help.

Это основной продукт клиента.

### Expert Web

Рекомендуемый основной рабочий кабинет:

- расписание;
- заявки;
- консультации;
- чаты;
- клиенты;
- доход;
- профиль;
- рейтинг.

### Expert Mobile Companion

Назначение должно быть ограничено сценариями, где мобильность действительно нужна:

- push;
- быстро принять/отклонить заявку;
- изменить status;
- провести консультацию;
- посмотреть ближайшую запись;
- срочная поддержка.

Не дублируй весь Expert Web без бизнес-необходимости.

### Admin Web

Только desktop-first operational interface.

После анализа зафиксируй canonical surface для каждого use case.

## 15.2. Information Architecture

Для каждой поверхности создай:

- sitemap;
- route map;
- navigation hierarchy;
- entry points;
- deep links;
- role guards;
- cross-product transitions;
- back behavior;
- browser/mobile history behavior;
- notification destinations.

## 15.3. Screen Manifest

Для каждого экрана создай запись:

```markdown
# SCR-XXX — Название

- Product surface:
- Role:
- Route:
- Prototype file:
- Reference screenshot:
- Related use cases:
- Business purpose:
- Entry points:
- Exit points:
- Required data:
- Permissions:
- Primary action:
- Secondary actions:
- Destructive actions:
- Sections in visual order:
- Components:
- Copy:
- Validation:
- Loading state:
- Skeleton:
- Empty state:
- Partial data state:
- Error state:
- Offline state:
- Reconnect state:
- Success state:
- Forbidden/blocked state:
- Responsive behavior:
- Accessibility:
- Analytics events:
- Backend support:
- Acceptance criteria:
- Visual acceptance criteria:
```

Ни один экран не считается описанным, если определён только happy path.

## 15.4. Screen-to-process validation

Для каждого экрана проверь:

- какой use case он обслуживает;
- что было до него;
- что происходит после;
- кто принимает решение;
- какая операция реально выполняется;
- что происходит при ошибке;
- есть ли undo/confirmation;
- какой status изменяется;
- какие уведомления уходят;
- какие деньги перемещаются;
- кто видит результат.

Удаляй или объединяй экран только после доказательства, что бизнес-сценарий не теряется.

---

# 16. Визуальная система прототипа — обязательный visual contract

Не делай редизайн с нуля.

Сначала извлеки design tokens из прототипа и зафиксируй их семантически.

## 16.1. Базовое визуальное направление

Прототип использует:

- `Inter`;
- спокойную бело-зелёную палитру;
- тёмно-зелёный основной текст и sidebar;
- teal primary actions;
- светлые muted surfaces;
- большие округления;
- тонкие borders;
- лёгкие shadows;
- минимальную визуальную агрессию;
- ясную эмоционально безопасную коммуникацию.

Зафиксируй как отправную палитру:

- `--color-ink: #0F3F3A`;
- `--color-primary: #0F766E`;
- `--color-primary-accent: #159A7C`;
- `--color-text-secondary: #6B8580`;
- `--color-text-muted: #8FA6A1`;
- `--color-surface: #FFFFFF`;
- `--color-surface-soft: #F7FAF9`;
- `--color-surface-tint: #F2FBF8`;
- `--color-border: #EEF2F0`;
- `--color-danger: #C0392B`;
- warning, info, success и premium должны быть извлечены из прототипа и оформлены семантическими токенами.

Не используй raw hex в компонентах после создания tokens.

## 16.2. Геометрия

Сохрани характер:

- cards: преимущественно 14–20 px radius;
- крупные action cards/modals: 22–28 px;
- pills: полностью округлённые;
- borders: тонкие 1–1.5 px;
- touch targets: минимум 44×44;
- спокойные, мягкие shadows;
- плотность mobile и desktop должна соответствовать прототипу.

## 16.3. Mobile reference

Основной reference viewport:

- `390 × 844`;
- safe areas;
- нижняя навигация;
- vertical scrolling;
- mobile-first hierarchy;
- одна главная action на экран;
- bottom sheets вместо desktop dialogs, где это соответствует прототипу.

## 16.4. Desktop reference

- Public Web: content max-width около `1240 px`;
- Expert Web: reference около `1440 × 1024`, sidebar около `260 px`;
- Admin: reference около `1520 × 1024`, sidebar около `250 px`;
- дополнительно проверь `1280`, `1440`, `1920` ширины;
- таблицы не должны разрушаться;
- filters и panels должны иметь responsive-поведение.

## 16.5. Запрещённый визуальный drift

Запрещено без отдельного решения:

- заменять палитру;
- использовать стандартный синий SaaS-style;
- добавлять тяжёлые gradients;
- менять Inter;
- делать все cards одинаковыми;
- использовать default shadcn-style без адаптации;
- добавлять glassmorphism;
- добавлять лишние illustrations;
- увеличивать sidebar или typography произвольно;
- превращать mobile layout в уменьшенный desktop;
- добавлять emoji там, где в прототипе используются icons;
- использовать разные badges для одинаковых статусов;
- менять смысл текстов ради красоты.

## 16.6. Existing assets

Используй существующие:

- logo;
- psychologist images;
- onboarding illustration;
- content covers;
- screenshots как references.

Не заменяй их случайными stock-фото без необходимости.

## 16.7. Design System Inventory

Определи и опиши компоненты:

- AppShell;
- PublicHeader;
- MobileHeader;
- BottomNavigation;
- ExpertSidebar;
- AdminSidebar;
- PageHeader;
- PrimaryButton;
- SecondaryButton;
- DestructiveButton;
- IconButton;
- Card;
- TopicCard;
- SpecialistCard;
- StatusBadge;
- Timer;
- SearchProgress;
- EmptyState;
- ErrorState;
- OfflineBanner;
- Modal;
- BottomSheet;
- Drawer/DetailPanel;
- Tabs;
- Filter;
- Table;
- FormField;
- OTPInput;
- FileUpload;
- PaymentMethod;
- ChatBubble;
- Composer;
- CallControls;
- ScheduleGrid;
- Rating;
- ReviewCard;
- ComplaintTimeline;
- FinanceMetric;
- ContractUsage;
- NotificationItem;
- ContentCard;
- AudioPlayer;
- MeditationPlayer;
- Toast;
- Skeleton.

Для каждого компонента:

- variants;
- states;
- tokens;
- accessibility;
- platform differences;
- prototype examples;
- forbidden misuse.

---

# 17. Frontend state completeness

Каждый экран и компонент должен иметь предусмотренные состояния.

Обязательный checklist:

- initial;
- loading;
- slow loading;
- skeleton;
- empty;
- success;
- partial success;
- validation error;
- server error;
- permission denied;
- forbidden;
- account blocked;
- offline;
- reconnecting;
- stale data;
- no specialist;
- expired offer;
- payment processing;
- payment declined;
- payment succeeded;
- subscription expired;
- session upcoming;
- session active;
- session ended;
- complaint pending;
- complaint resolved;
- verification pending;
- verification rejected;
- document reupload;
- payout pending;
- payout failed;
- contract expiring;
- exhausted corporate pool.

Не используй только toast там, где требуется persistent state или recovery action.

---

# 18. Тексты, язык и доверие

Создай Content Matrix:

- screen;
- element;
- RU text;
- KZ text status;
- purpose;
- tone;
- legal sensitivity;
- error copy;
- recovery copy;
- owner.

Тон:

- спокойный;
- уважительный;
- не осуждающий;
- конкретный;
- без медицинских обещаний;
- без давления;
- без ложной срочности;
- без манипулятивного Premium upsell в кризисном состоянии.

Отдельно проверь:

- emergency texts;
- payment texts;
- refund texts;
- anonymous mode;
- reviews;
- complaints;
- B2B confidentiality;
- intern consent;
- account deletion;
- wearable disclaimer.

RU и KZ должны проектироваться с самого начала. Не оставляй архитектуру интерфейса, рассчитанную только на короткие русские строки.

---

# 19. Accessibility и inclusive UX

Требования:

- WCAG 2.2 AA как цель;
- contrast audit;
- keyboard navigation для web/admin;
- visible focus;
- screen reader labels;
- semantic headings;
- form errors associated with fields;
- captions/alternative communication options;
- reduced motion;
- 44×44 touch targets;
- не использовать цвет как единственный status signal;
- поддерживать увеличение текста;
- избегать перегрузки пользователя в тревожном состоянии;
- учитывать слабое соединение и недорогие устройства.

---

# 20. Связь frontend с существующим backend

Не требуется перепроектировать backend в этой задаче, но frontend-план обязан быть реалистичным.

Создай матрицу:

`Screen/Use Case → Existing endpoint/event/model/test → Support status → Gap → Required backend work`.

Статусы:

- `SUPPORTED`;
- `PARTIALLY_SUPPORTED`;
- `UI_ONLY`;
- `BACKEND_ONLY`;
- `MISSING`;
- `CONTRADICTED`;
- `UNKNOWN`.

Правила:

- frontend не обращается напрямую к БД;
- frontend не принимает окончательные решения о permission;
- frontend не дублирует matching и financial rules;
- временные fixtures допустимы только для UI development;
- mock не считается завершённой функцией;
- если API отсутствует, создай dependency story;
- никакие fake buttons не остаются в release build;
- UI labels должны соответствовать реальным backend states.

---

# 21. Как закончить проект быстрее и с меньшим числом переделок

## 21.1. Decision policy

Не задавай вопрос по каждой мелочи.

При неоднозначности:

1. найди доказательства;
2. предложи рекомендуемый вариант;
3. опиши альтернативу;
4. оцени влияние;
5. продолжай с recommendation, если решение обратимо и не связано с безопасностью, законом, деньгами или необратимой архитектурой.

В конце вынеси максимум 10–15 действительно блокирующих решений владельца.

## 21.2. Scope freeze

После утверждения:

- canonical roles фиксируются;
- canonical prices фиксируются;
- canonical states фиксируются;
- canonical navigation фиксируется;
- canonical screen inventory фиксируется;
- изменения проходят через Decision Log;
- новые функции не добавляются внутрь текущего release без пересмотра сроков.

## 21.3. Vertical slices

Не планируй подход:

- сначала все экраны;
- потом все API;
- потом тесты.

Каждый slice должен завершать пользовательский outcome:

- UI;
- states;
- API integration;
- permissions;
- analytics;
- tests;
- visual validation;
- acceptance.

## 21.4. Рекомендуемая последовательность релизов

Проверь и уточни, но используй как стартовую гипотезу.

### Release 0 — Foundation and Decisions

- canonical business rules;
- roles;
- state catalog;
- screen inventory;
- design tokens;
- components;
- API gap matrix;
- critical safety decisions.

### Release 1 — Core Marketplace

- public landing/catalog/profile;
- client onboarding/auth/anonymous;
- topic/format;
- matching/manual choice;
- specialist onboarding/verification;
- availability/offers;
- basic admin verification;
- one end-to-end consultation format;
- post-session feedback.

### Release 2 — Full Consultation and Payments

- chat/audio/video;
- payment methods;
- cancellation/no-show/refund;
- schedule;
- income/payout;
- complaints;
- admin finance basics.

### Release 3 — Retention

- favorites;
- repeat booking;
- reviews;
- notifications;
- content;
- Premium.

### Release 4 — B2B

- contracts;
- employee activation;
- session pool;
- aggregate reports;
- renewals.

### Release 5 — B2G and Interns

- students;
- supervisors;
- consent;
- restrictions;
- supervision;
- practice hours.

### Release 6 — Experiments

- wearable analysis;
- advanced AI;
- expanded personalization.

Если другая последовательность лучше подтверждается backend и рынком — предложи её с аргументами.

---

# 22. Формат эпиков и историй

## 22.1. Epic

```markdown
# EPIC-XXX — Название

## Business outcome
## User roles
## Included use cases
## Included screens
## Scope
## Out of scope
## Business rules
## State transitions
## Dependencies
## Backend support
## Frontend components
## Analytics
## Security/privacy
## Risks
## Acceptance evidence
## Rollback
## Complexity
```

## 22.2. Story

```markdown
# STORY-XXX — Название

## User outcome
## Context
## Exact scope
## Explicitly forbidden changes
## Prototype references
## Screens/states
## Required components
## Data/API/events
## Permissions
## Business rules
## Copy
## Responsive behavior
## Accessibility
## Acceptance criteria
## Gherkin
## Required tests
## Visual QA checklist
## Manual test path
## Definition of Done
```

Запрещены истории:

- «сделать красивый экран»;
- «улучшить UX»;
- «подключить backend»;
- «сделать мобильную версию»;
- «доработать админку».

Каждая story должна завершаться наблюдаемым пользовательским результатом.

---

# 23. Frontend Quality Gates

Экран или flow считается готовым только при выполнении всех gate.

## Gate A — Business

- use case утверждён;
- правила утверждены;
- состояния определены;
- роли и permissions определены;
- цены и тексты не противоречат другим поверхностям.

## Gate B — Visual

- есть prototype reference;
- layout соответствует;
- tokens соответствуют;
- typography соответствует;
- spacing/radius соответствует;
- assets соответствуют;
- отсутствует unapproved visual drift.

## Gate C — Functional

- все действия работают;
- нет dead buttons;
- данные реальные;
- ошибки имеют recovery;
- back/deep-link behavior работает;
- permissions работают.

## Gate D — Integration

- API contract подтверждён;
- WS/realtime states учтены;
- no mock в production;
- status mapping canonical;
- retry/idempotency учтены.

## Gate E — Quality

- unit/component tests;
- integration tests;
- critical E2E;
- accessibility;
- responsive;
- visual regression;
- performance smoke;
- copy review.

---

# 24. Visual regression strategy

Для каждого canonical screen подготовь reference screenshot.

Проверяй минимум:

- client mobile: `390×844`;
- public web: `1440×1024` и `390×844`;
- expert web: `1440×1024`;
- admin: `1520×1024`;
- дополнительные desktop widths: `1280` и `1920`.

Сравнивай:

- hierarchy;
- alignment;
- section order;
- component size;
- spacing;
- typography;
- colors;
- radii;
- borders;
- assets;
- empty/error states.

Pixel diff используй как сигнал, а не единственную проверку. Для статичных областей отклонения должны быть минимальными. Все намеренные отличия внеси в `VISUAL_CHANGELOG.md` с причиной и approval status.

---

# 25. Обязательные документы

Создай каталог:

`docs/product-blueprint/`

## `00_INDEX.md`

- порядок чтения;
- статус документов;
- owners;
- decision status;
- ссылки.

## `01_PROTOTYPE_AUDIT.md`

- inventory всех экранов;
- surface;
- role;
- actions;
- transitions;
- states;
- duplicate/stale/broken screens;
- visual notes.

## `02_PRODUCT_SCOPE.md`

- product definition;
- value proposition;
- MVP;
- releases;
- out of scope;
- recommendations.

## `03_ROLES_PERMISSIONS_AND_JTBD.md`

- role cards;
- JTBD;
- permissions;
- data visibility;
- lifecycle;
- RBAC/ABAC matrix.

## `04_BUSINESS_PROCESS_CATALOG.md`

- end-to-end processes;
- swimlanes;
- SLA;
- RACI;
- exception handling.

## `05_USE_CASE_CATALOG.md`

- полный реестр;
- все detailed use cases;
- Gherkin.

## `06_BUSINESS_RULES.md`

- BR catalog;
- canonical rules;
- contradictions;
- rule owners.

## `07_STATE_AND_LIFECYCLE_MODELS.md`

- все state machines;
- transitions;
- timers;
- frontend labels.

## `08_MONETIZATION_AND_UNIT_ECONOMICS.md`

- revenue;
- commissions;
- Premium;
- payment/refund/payout;
- formulas;
- assumptions.

## `09_B2B_B2G_OPERATING_MODEL.md`

- sales funnel;
- contracts;
- privacy;
- session pool;
- interns;
- supervisors;
- reports.

## `10_SAFETY_PRIVACY_AND_TRUST.md`

- crisis boundary;
- consent;
- minors;
- anonymous mode;
- data access;
- retention;
- claims audit.

## `11_FRONTEND_INFORMATION_ARCHITECTURE.md`

- surfaces;
- sitemap;
- routes;
- navigation;
- platform ownership;
- cross-product links.

## `12_SCREEN_MANIFEST_AND_SPECS.md`

- все canonical screens;
- all states;
- interactions;
- data;
- acceptance.

## `13_DESIGN_SYSTEM_AND_VISUAL_CONTRACT.md`

- tokens;
- typography;
- spacing;
- components;
- variants;
- exact prototype mapping;
- forbidden drift.

## `14_CONTENT_AND_LOCALIZATION_MATRIX.md`

- RU copy;
- KZ requirements;
- errors;
- trust/safety language;
- owner.

## `15_BACKEND_SUPPORT_AND_GAP_MATRIX.md`

- screen/use case → API/event/model/test;
- gaps;
- dependencies;
- no fake frontend logic.

## `16_RELEASE_ROADMAP_AND_BACKLOG.md`

- releases;
- epics;
- stories;
- dependencies;
- sequence;
- priorities.

## `17_QA_AND_ACCEPTANCE_PLAN.md`

- functional;
- E2E;
- visual;
- accessibility;
- responsive;
- performance;
- security;
- release gates.

## `18_TRACEABILITY_MATRIX.md`

`Business goal → Role → Process → Use Case → Rule → State → Screen → API/Event → Test → Epic → Story`

## `19_DECISION_LOG_AND_OPEN_QUESTIONS.md`

- decisions;
- recommendation;
- alternatives;
- impact;
- owner;
- deadline;
- status.

## `20_VISUAL_CHANGELOG.md`

- prototype reference;
- intended difference;
- reason;
- approval;
- affected screens.

## Machine-readable files

Создай:

- `product-manifest.yaml`;
- `roles.yaml`;
- `use-cases.yaml`;
- `business-rules.yaml`;
- `state-catalog.yaml`;
- `screen-manifest.yaml`;
- `route-manifest.yaml`;
- `traceability.yaml`.

Они должны быть индексами, а не копиями длинных markdown-документов.

---

# 26. Проверки документации перед выдачей

Проведи пять обязательных проходов.

## Pass 1 — Prototype Coverage

- каждый экран учтён;
- каждый action учтён;
- каждая surface учтена;
- каждый asset классифицирован;
- нет потерянных flow.

## Pass 2 — Business Consistency

- одинаковые цены;
- одинаковые статусы;
- одинаковые правила refunds;
- одинаковые тарифы;
- одинаковая роль Premium;
- одинаковая privacy-модель;
- одинаковые названия тем.

## Pass 3 — Role and Process Completeness

- каждый process имеет owner;
- каждый handoff описан;
- каждый exception имеет обработку;
- каждый manual operation имеет SLA;
- каждый финансовый шаг имеет ответственную роль.

## Pass 4 — Frontend Readiness

- каждый use case имеет screens;
- каждый screen имеет all states;
- каждый screen имеет prototype reference;
- каждый screen имеет backend support status;
- нет dead buttons;
- нет неописанного navigation behavior;
- нет generic design drift.

## Pass 5 — Red Team

Попытайся опровергнуть план:

- не слишком ли много поверхностей для первого релиза;
- не дублируются ли Expert Mobile и Web;
- реалистичен ли SLA 1–2 минуты;
- не обещает ли UI невозможную анонимность;
- не вводит ли Premium в заблуждение;
- безопасен ли urgent flow;
- реалистична ли B2G-модель;
- нет ли функций без операционной команды;
- можно ли действительно реализовать roadmap вертикальными срезами;
- сможет ли новая ИИ-сессия выполнить story без догадок.

Исправь документы после каждого прохода.

---

# 27. Финальный формат ответа

После создания документов верни отчёт строго в таком формате.

## 1. Что было изучено

- количество файлов;
- количество экранов;
- продукты/surfaces;
- repository areas.

## 2. Главный продуктовый диагноз

Не более 15 пунктов.

## 3. Рекомендуемая модель продукта

- Public Web;
- Client;
- Expert Web;
- Expert Mobile;
- Admin;
- B2B;
- B2G.

## 4. Canonical роли

Краткий список.

## 5. Canonical business processes

Краткий список.

## 6. Главные противоречия и рекомендации

Таблица:

`Issue → Recommendation → Alternative → Owner decision`.

## 7. MVP и следующие релизы

Покажи scope по релизам.

## 8. Frontend-направление

- visual system;
- surface boundaries;
- screen count;
- component strategy;
- prototype fidelity strategy.

## 9. Backend gap summary

- supported;
- partial;
- missing;
- blockers.

## 10. Первые 10 эпиков

- business outcome;
- dependencies;
- release.

## 11. Блокирующие решения владельца

Максимум 10–15 вопросов. Для каждого:

- recommendation;
- alternative;
- impact if delayed.

## 12. Созданные документы

Пути.

## 13. Проверка качества

- prototype coverage;
- business consistency;
- frontend readiness;
- traceability;
- red-team result.

Заверши строкой:

`PRODUCT AND FRONTEND BLUEPRINT COMPLETE — IMPLEMENTATION NOT STARTED`

После этого остановись и не начинай реализацию.
