---
name: VAPS · PersonnelStatus — Visual Identity
project: VAPS
surface: PersonnelStatus
status: final
created: 2026-06-19
updated: 2026-06-20
description: >-
  Токены и семантика поверх стоковых дефолтов Mantine v7 для штабного
  инструмента учёта личного состава — после РАЗВОРОТА на донор-эталон
  (parallel-run). Визуальный язык: современный дружелюбный card-based SaaS —
  скруглённые карточки (radius="md") с мягкими тенями, воздух, KPI-плитки с
  цветными иконками категорий, круглые аватары, крупные display-числа, тёплый
  тон. Это дельта над Mantine, не дизайн-система с нуля. Поведенческое ядро
  (слепой ввод, 409/422, гейт расхода, светофор-каскад, RBAC, маскировка ИИН)
  сохранено; меняется только визуальная оболочка. Палитра статусов приведена к
  ДОНОРУ 1:1 (entities/status/model.ts, 2026-06-20) — единый light-tint для всех
  статусов; светофор / конфликты / chrome / primary НЕ изменены; есть набор
  цветов KPI-категорий.
colors:
  # === Chrome / каркас (стоковая серая шкала Mantine) — БЕЗ ИЗМЕНЕНИЙ ===
  # Имя свотча Mantine приведено рядом с hex. Light/dark — отдельные токены.
  bg: '#f8f9fa'                 # gray.0
  surface: '#ffffff'            # white
  border: '#dee2e6'             # gray.3
  text-primary: '#212529'       # gray.9
  text-secondary: '#495057'     # gray.7
  text-muted: '#868e96'         # gray.6
  bg-dark: '#1a1b1e'            # dark.7
  surface-dark: '#25262b'       # dark.6
  border-dark: '#373a40'        # dark.4
  text-primary-dark: '#c1c2c5'  # dark.0
  text-secondary-dark: '#909296'# dark.2
  text-muted-dark: '#5c5f66'    # dark.3

  # === Primary / action (Mantine blue) — БЕЗ ИЗМЕНЕНИЙ ===
  primary: '#228be6'            # blue.6
  primary-focus-ring: '#339af0' # blue.5
  primary-dark: '#4dabf7'       # blue.4
  primary-focus-ring-dark: '#74c0fc' # blue.3

  # === Светофор листа (division indicator) — БЕЗ ИЗМЕНЕНИЙ ===
  light-green: '#2f9e44'        # green.7  — сдано / совпадает
  light-orange: '#f08c00'       # orange.6 — дрейф / частично
  light-red: '#e03131'          # red.7    — не сдано / блок
  light-grey: '#adb5bd'         # gray.5   — нет данных / не требуется
  light-green-dark: '#51cf66'   # green.4
  light-orange-dark: '#ffd43b'  # yellow.4
  light-red-dark: '#ff6b6b'     # red.4
  light-grey-dark: '#5c5f66'    # dark.3

  # === Семантика конфликтов — БЕЗ ИЗМЕНЕНИЙ ===
  # hard-block = заливка строки (red), soft-warning = маркер строки (orange/yellow).
  conflict-hard-fg: '#c92a2a'        # red.9   (422)
  conflict-hard-bg: '#fff5f5'        # red.0
  conflict-soft-fg: '#e67700'        # yellow.9 (409)
  conflict-soft-bg: '#fff9db'        # yellow.0
  conflict-hard-fg-dark: '#ff8787'   # red.3
  conflict-hard-bg-dark: '#2a1414'
  conflict-soft-fg-dark: '#ffd43b'   # yellow.4
  conflict-soft-bg-dark: '#2a2410'

  # === Категориальная палитра статусов (StatusType.color) — ДОНОР 1:1 (2026-06-20) ===
  # Источник истины: донор-фронтенд entities/status/model.ts — Tailwind bg-{c}-100 text-{c}-800.
  # ЕДИНЫЙ LIGHT-TINT для ВСЕХ статусов (донор: variant="light" везде): *-fg = Tailwind -800,
  # *-bg = Tailwind -100. Цвет ВСЕГДА вторичен к текст-метке (a11y), никогда color-only.
  # КОНФЛИКТ-422 (красная заливка строки) — ОТДЕЛЬНЫЙ слой (conflict-hard-*), НЕ статус-цвет.
  status-in-service-fg: '#166534'    # green.800 — В строю (донор green, light-tint)
  status-in-service-bg: '#dcfce7'    # green.100
  status-duty: '#1e40af'             # blue.800  — На дежурстве (донор blue)
  status-duty-bg: '#dbeafe'          # blue.100
  status-rest-after-duty: '#155e75'  # cyan.800  — После дежурства (донор cyan, источник 409)
  status-rest-after-duty-bg: '#cffafe' # cyan.100
  status-study: '#3730a3'            # indigo.800 — Учёба (донор indigo)
  status-study-bg: '#e0e7ff'         # indigo.100
  status-competition: '#9d174d'      # pink.800  — Соревнования (донор pink)
  status-competition-bg: '#fce7f3'   # pink.100
  status-attached: '#115e59'         # teal.800  — Прикомандирован «+N» (донор teal)
  status-attached-bg: '#ccfbf1'      # teal.100
  status-detached: '#1f2937'         # gray.800  — Откомандирован (донор gray, view-only)
  status-detached-bg: '#f3f4f6'      # gray.100
  status-vacation: '#854d0e'         # yellow.800 — Отпуск (донор yellow)
  status-vacation-bg: '#fef9c3'      # yellow.100
  status-leave-by-report: '#92400e'  # amber.800 — Отпуск по рапорту (донор amber)
  status-leave-by-report-bg: '#fef3c7' # amber.100
  status-sick-leave: '#991b1b'       # red.800   — Больничный (донор red)
  status-sick-leave-bg: '#fee2e2'    # red.100
  status-command: '#6b21a8'          # purple.800 — Командировка (донор purple)
  status-command-bg: '#f3e8ff'       # purple.100
  status-other-absence: '#9a3412'    # orange.800 — Отсутствие по иным причинам (донор «иные», orange)
  status-other-absence-bg: '#ffedd5' # orange.100
  # --- VAPS-расширения: у донора НЕТ эквивалента, light-tint из ближайших семейств ---
  status-conference: '#3f6212'       # lime.800 — Конференция [VAPS-НОВОЕ]
  status-conference-bg: '#ecfccb'    # lime.100  [VAPS-НОВОЕ]
  status-gev: '#86198f'              # fuchsia.800 — ГЭВ [VAPS-НОВОЕ]
  status-gev-bg: '#fae8ff'           # fuchsia.100 [VAPS-НОВОЕ]
  status-before-duty: '#075985'      # sky.800 — BEFORE_DUTY (До дежурства) [VAPS-НОВОЕ]
  status-before-duty-bg: '#e0f2fe'   # sky.100  [VAPS-НОВОЕ]

  # === KPI-категории (ДОБАВЛЕНО 2026-06-19 · донор-разворот) ===
  # Цвет иконки-категории (ThemeIcon) + крупного display-числа в kpi-tile.
  # Семантика тревоги: счётчики отсутствия (отпуск/рапорт/больничные/всего-отсутствуют)
  # рисуются КРАСНЫМ числом; «В строю» — зелёным; нейтральные — по категории.
  kpi-staff: '#228be6'          # blue.6  — По штату / Всего сотрудников (нейтрально-учётный)
  kpi-in-service: '#2f9e44'     # green.7 — В строю / Работают (позитив)
  kpi-absent: '#f08c00'         # orange.6 — В отпуске/больничном / Временно отсутствуют (тревога-янтарь)
  kpi-command: '#7048e8'        # violet.7 — В командировке (фиолетовый телефон на доноре)
  kpi-vacancy: '#868e96'        # gray.6  — Вакансии (приглушённый, незаполненное)
  kpi-alert-number: '#e03131'   # red.7   — крупное ЧИСЛО для отпуск/рапорт/больничные/всего-отсутствуют
  kpi-staff-dark: '#4dabf7'     # blue.4
  kpi-in-service-dark: '#51cf66'# green.4
  kpi-absent-dark: '#ffa94d'    # orange.4
  kpi-command-dark: '#9775fa'   # violet.4
  kpi-vacancy-dark: '#909296'   # dark.2
  kpi-alert-number-dark: '#ff6b6b' # red.4

  # === Документ-специфика — БЕЗ ИЗМЕНЕНИЙ ===
  watermark-draft: '#ced4da'         # gray.4 — «ЧЕРНОВИК» watermark (полупрозрачный)
typography:
  # UI наследует системный шрифтовой стек Mantine. ДОБАВЛЕНА display-шкала для
  # KPI-чисел и крупных H1 (донор-язык); базовая плотность экранов смягчена с
  # size="sm" → "md", но рабочие таблицы остаются плотными (size="sm").
  display:
    note: >-
      Крупное число KPI-плитки (донор: ~32–40px, fw-700). Цвет — по категории
      или kpi-alert-number (красный для отсутствий). Mantine Title order={1}/Text fw={700} size крупный.
  h1:
    note: >-
      Заголовок экрана: крупный (Mantine Title order={1}), рядом цветная ThemeIcon,
      под ним приглушённый подзаголовок text-muted (напр. «Управление сотрудниками организации»).
  body:
    note: 'Mantine default font stack · базовая плотность экранов size="md" (тёплый воздух)'
  table:
    note: 'Mantine size="sm" ВНУТРИ карточки-контейнера — рабочие таблицы (грид ввода, журнал, список сотрудников) остаются плотными'
  label:
    note: 'Mantine default · uppercase микро-заголовки таблиц / подписи KPI по соглашению Mantine'
  mono:
    note: 'Mantine monospace стек — исх.№, ИИН last-4, коды ошибок'
  # ПЕЧАТНЫЙ КОНТРАКТ (НЕ UI-токен) — БЕЗ ИЗМЕНЕНИЙ: официальный .docx «Расход ЛС».
  # Это контракт документа, отдельный от экранной типографики — голый HTML + print.css.
  doc-print:
    note: >-
      Расход ЛС .docx — landscape, 15 колонок, шапка на КАЗАХСКОМ.
      Шрифты 16 (заголовок) / 12 (тело) / 8 (примечания) pt. ИИН = ****** + last4.
      Жирный итог «Общее». UI не трогает рендеринг документа. Печатный контракт НЕ меняется разворотом.
rounded:
  # ДОНОР-РАЗВОРОТ: заметные скругления вместо «наследуем дефолт».
  card: 'md'
  note: 'radius="md" (~8px) на карточках/KPI-плитках/кнопках/инпутах; аватары круглые (radius="xl"/round)'
spacing:
  # ДОНОР-РАЗВОРОТ: воздух вместо макс. плотности; исключение — рабочие таблицы.
  note: >-
    Воздушная сетка карточек: Mantine Card padding комфортный (md/lg), gap между плитками.
    KPI-плитки в responsive-ряд (~4 в строку на широком, перенос на узком).
    ИСКЛЮЧЕНИЕ: рабочие таблицы (грид ввода, журнал, список сотрудников) — плотные строки size="sm" внутри карточки-контейнера.
components:
  # === ДОБАВЛЕННЫЕ компоненты (донор-разворот) ===
  page-header:
    note: >-
      Крупный H1 ({typography.h1}) + цветная ThemeIcon слева + приглушённый подзаголовок;
      справа — экшн-зона: счётчик-чип (Badge «10 сотрудников»), «Обновить», primary
      «Добавить сотрудника» ({components.button-primary}). Mantine Group/Title/ThemeIcon.
  greeting:
    note: >-
      Тёплое приветствие по времени суток на дашборде: «Доброе утро/день/вечер, {имя}! 😊».
      Mantine Title/Text; эмодзи допустим. Сразу под ним — служебная мета (дата/время/таймзона).
  kpi-tile:
    background: '{colors.surface}'
    note: >-
      Mantine Card radius="md" shadow="xs" + подпись-категория (label, text-muted) +
      цветная ThemeIcon в углу (цвет по категории: {colors.kpi-staff}/{colors.kpi-in-service}/
      {colors.kpi-absent}/{colors.kpi-command}/{colors.kpi-vacancy}) + крупное display-число
      ({typography.display}). Числа отсутствия (отпуск/рапорт/больничные/всего-отсутствуют) —
      {colors.kpi-alert-number} (красный); «В строю» — {colors.kpi-in-service} (зелёный).
      Опц. вторая строка-подпись («Работают», «Временно отсутствуют»).
  tabs:
    note: 'Mantine Tabs — «Список сотрудников» / «Карточки». Активный таб — primary-акцент'
  toolbar-search:
    note: >-
      Строка над таблицей: поиск «Поиск по ФИО, должности, отделу…» (Mantine TextInput с иконкой),
      фильтры-селекты «Все отделы» / «Все статусы», действия «Импорт» / «Экспорт» (button-secondary).
  org-tree:
    note: >-
      Блок «Структура организации»: горизонтальное дерево по заместителям/департаментам
      (тёмная шапка-полоса с подписью узла), под каждым узлом — сетка employee-card.
      Проблемная карточка подсвечена красным (light-red рамка/фон). Это hero-блок дашборда.
  employee-card:
    background: '{colors.surface}'
    note: >-
      Карточка сотрудника (таб «Карточки» + узлы org-tree): круглый аватар (Avatar radius="xl") +
      ФИО + должность + индикатор статуса (цветная рамка/Badge по StatusType.color).
      Mantine Card radius="md" shadow="xs", hover-elevation. Проблемное состояние — красная рамка ({colors.light-red}).
  employee-row:
    note: >-
      Строка таблицы списка (плотная, size="sm" внутри карточки): чекбокс · № · ФИО (ссылка primary) ·
      Должность · Отдел · Контакты (иконки тел/почта) · Дата найма (с иконкой) · ⋯-меню (Menu).
      ИИН не в строке (раскрытие — по праву, см. iin-mask).

  # === СОХРАНЁННЫЕ компоненты (теперь живут внутри card-языка) ===
  button-primary:
    # «Добавить сотрудника», «Сдать день», «Сформировать» — основное действие.
    background: '{colors.primary}'
    foreground: '#ffffff'
    note: 'Mantine Button variant="filled" color="blue" radius="md"; часто с leftSection-иконкой (донор)'
  button-secondary:
    note: 'Mantine Button variant="default"/"outline" radius="md" — «Обновить», «Импорт», «Экспорт», «Скачать черновик», «Напомнить»'
  status-cell-tint:
    # СТАНДАРТНЫЙ бейдж ВСЕХ статусов (донор: variant="light" везде).
    background: '{colors.status-duty-bg}'
    foreground: '{colors.status-duty}'
    note: >-
      Mantine Badge variant="light" для ВСЕХ статусов (донор-эталон, единый light-tint):
      bg = status-*-bg, fg = status-*; ВСЕГДА с текст-меткой, никогда color-only.
  status-cell-solid:
    # DEPRECATED для статус-ячейки: донор использует единый light-tint.
    background: '{colors.status-sick-leave}'
    foreground: '#ffffff'
    note: >-
      DEPRECATED для статус-ячейки — донор использует единый light-tint, solid НЕ применяется
      к статусу. Красная ЗАЛИВКА СТРОКИ для 422 — отдельный conflict-hard (conflict-dialog-hard),
      не статус-цвет. Ключ сохранён для совместимости refs.
  status-cell-neutral:
    # DEPRECATED: донор красит «В строю» green light-tint, нейтральный baseline отменён.
    foreground: '{colors.status-in-service-fg}'
    note: >-
      DEPRECATED — донор красит «В строю» green light-tint (status-in-service-*),
      нейтральный baseline отменён разворотом-к-донору 2026-06-20. «В строю» теперь
      = обычный status-cell-tint. Ключ сохранён для совместимости refs.
  status-badge-plus-n:
    # Прикомандирован «+N».
    background: '{colors.status-attached-bg}'
    foreground: '{colors.status-attached}'
    note: 'Mantine Badge с числовым «+N»; teal семья (донор), light-tint'
  svetofor-dot:
    # Индикатор-точка листа в дереве подразделений.
    note: >-
      Круглый индикатор: green={colors.light-green} сдано · orange={colors.light-orange} дрейф ·
      red={colors.light-red} не сдано · grey={colors.light-grey} нет данных.
      Каскад снизу вверх; всегда дублируется текстом (N/M, «дрейф», «не подана»)
  conflict-dialog-hard:
    background: '{colors.conflict-hard-bg}'
    foreground: '{colors.conflict-hard-fg}'
    note: 'ConflictDialog/строка для 422 hard-block — красный, неоверрайдаемый, коммит блокируется'
  conflict-dialog-soft:
    background: '{colors.conflict-soft-bg}'
    foreground: '{colors.conflict-soft-fg}'
    note: 'ConflictDialog для 409 soft — orange/yellow, поле причины 10–500 симв., оверрайдаемый'
  grid-focus:
    # Клавиатурный фокус ячейки в гриде слепого ввода.
    border: '{colors.primary}'
    note: 'Толстая синяя рамка фокуса; ring={colors.primary-focus-ring}. Виден без мыши'
  readiness-panel:
    note: >-
      Панель готовности расхода (в карточке): список светофор-листов; «Не готово» (409 MARKS_INCOMPLETE)
      перечисляет отстающих поимённо (подразделение + ответственный) + кнопка «Напомнить»
  watermark-draft:
    foreground: '{colors.watermark-draft}'
    note: 'Диагональный watermark «ЧЕРНОВИК» на черновых документах; ФИНАЛ — без watermark'
  iin-mask:
    note: 'ИИН маскируется по умолчанию (******); last-4 по праву employee.sensitive.view; каждое раскрытие/скачивание — в аудит'
---

## Brand & Style

PersonnelStatus — внутренний штабной инструмент учёта личного состава: закрытый контур (LAN), русский UI, работа за столом весь день. После **РАЗВОРОТА на донор-эталон** (parallel-run) визуальный язык — **современный дружелюбный card-based SaaS-штаб**: скруглённые карточки с мягкими тенями, воздух между блоками, KPI-плитки с крупными цветными числами, круглые аватары, цветные иконки категорий, тёплый человеческий тон. Цель — воспроизвести визуальный язык донора, чтобы parallel-run выглядел узнаваемо для штабиста.

Это **дельта над Mantine v7**, а не дизайн-система с нуля — Mantine этот язык умеет штатно: `Card` (radius/shadow), `ThemeIcon`, `Avatar`, `Tabs`, `Badge`. Tailwind подключён только для лейаута (preflight off), не для визуальной идентичности. Тёмная тема — в скоупе: токены спроектированы семантически (light + dark рядом, через штатные `dark.x` Mantine).

Важно: **сменилась только визуальная оболочка**. Поведенческое ядро сохранено как есть — клавиатурный слепой ввод, семантика конфликтов 409/422, гейт расхода со списком отстающих, светофор-каскад готовности, RBAC scope-gating, маскировка ИИН, аудит. Тёплый тон и воздух не отменяют штабную плотность данных там, где она нужна: **рабочие таблицы (грид ввода, журнал, список сотрудников) остаются информационно-плотными внутри карточки-контейнера.**

## Colors

Палитра — стоковые токены Mantine, размеченные по семантическим ролям. Сохранённое ядро (chrome, primary, светофор, конфликты, статусы) разворот **не меняет**; добавлен набор **KPI-категорий** для дашборда и плиток.

> **Визуальная опора:** донор-скриншоты — [`imports/etalon-rashod-dashboard.png`](imports/etalon-rashod-dashboard.png), [`imports/etalon-rashod-dashboard-2.png`](imports/etalon-rashod-dashboard-2.png), [`imports/etalon-employees-list.png`](imports/etalon-employees-list.png) — визуальный эталон. Палитра в действии — [`mockups/color-themes-1.html`](mockups/color-themes-1.html). Спайн — контракт; мокапы и скриншоты иллюстрируют, **при конфликте побеждает спайн**.

- **Chrome / каркас** — серая шкала Mantine: `bg` `{colors.bg}` (gray.0) / `surface` `{colors.surface}` (white, фон карточек) / `border` `{colors.border}` (gray.3); текст `{colors.text-primary}` (gray.9) · `{colors.text-secondary}` (gray.7) · `{colors.text-muted}` (gray.6, подзаголовки и подписи KPI). Тёмная — `dark.7/.6/.4` + `dark.0/.2/.3`.
- **Primary / action** — `{colors.primary}` `#228be6` (blue.6) в light, `{colors.primary-dark}` `#4dabf7` (blue.4) в dark. Кольцо фокуса — blue.5 / blue.3. Кнопки действия («Добавить сотрудника», «Сдать день»), активная навигация/таб, ссылки-ФИО, рамка фокуса грида. Не используется для статусов и светофора.
- **KPI-категории (новое)** — цвет иконки-категории (ThemeIcon) и крупного display-числа в `kpi-tile`: По штату/Всего `{colors.kpi-staff}` (blue.6) · В строю/Работают `{colors.kpi-in-service}` (green.7) · В отпуске/больничном `{colors.kpi-absent}` (orange.6) · В командировке `{colors.kpi-command}` (violet.7 — «фиолетовый телефон» донора) · Вакансии `{colors.kpi-vacancy}` (gray.6). **Семантика тревоги:** счётчики отсутствия (Всего отсутствуют, Отпуск, Отпуск по рапорту, Больничные) рисуют **крупное число красным** `{colors.kpi-alert-number}` (red.7); «В строю» — зелёным. В dark — насыщеннее (см. `kpi-*-dark`).
- **Светофор листа (division indicator)** — без изменений: сдано/совпадает `{colors.light-green}` `#2f9e44` (green.7) · дрейф/частично `{colors.light-orange}` `#f08c00` (orange.6) · не сдано/блок `{colors.light-red}` `#e03131` (red.7) · нет данных/не требуется `{colors.light-grey}` `#adb5bd` (gray.5). В dark — насыщеннее (green.4 / yellow.4 / red.4 / dark.3).
- **Семантика конфликтов** — без изменений, должны читаться как разные сигналы: **hard-block (422, неоверрайдаемый)** = красный (`{colors.conflict-hard-fg}` red.9 на заливке red.0), **заливка строки** + блок коммита; **soft-warning (409, оверрайдаемый)** = оранжево-жёлтый (`{colors.conflict-soft-fg}` yellow.9 на yellow.0), **маркер строки** + ConflictDialog с полем причины. Деление hard/soft конфигурируется при деплое.
- **Категориальная палитра статусов (StatusType.color)** — приведена к **донору 1:1** (`entities/status/model.ts`, Tailwind `bg-{c}-100 text-{c}-800`), см. таблицу. Правило: **цвет всегда вторичен к текст-метке, никогда color-only** (a11y); **единый light-tint по палитре донора для ВСЕХ статусов** (Mantine Badge `variant="light"`: bg = `status-*-bg`, fg = `status-*`). Прежние правила «В строю без заливки» и «solid для hard-block» на статус-ячейке **отменены** — «В строю» теперь green light-tint как остальные. Красная **заливка строки для 422** — отдельный слой конфликтов (`conflict-hard-*`), а не статус-цвет.

| Статус | Цвет донора | Свотч (bg/fg) | Стиль |
|---|---|---|---|
| В строю | green | green.100 / green.800 | light-tint |
| Отпуск | yellow | yellow.100 / yellow.800 | light-tint |
| Отпуск по рапорту | amber | amber.100 / amber.800 | light-tint |
| Больничный | red | red.100 / red.800 | light-tint |
| Командировка | purple | purple.100 / purple.800 | light-tint |
| Учёба | indigo | indigo.100 / indigo.800 | light-tint |
| Соревнования | pink | pink.100 / pink.800 | light-tint |
| Отсутствие по иным причинам | orange | orange.100 / orange.800 | light-tint |
| На дежурстве | blue | blue.100 / blue.800 | light-tint |
| После дежурства (REST) | cyan | cyan.100 / cyan.800 | light-tint · источник 409 |
| Прикомандирован (+N) | teal | teal.100 / teal.800 | light-tint · бейдж «+N» |
| Откомандирован | gray | gray.100 / gray.800 | light-tint · view-only |
| Конференция `[VAPS-НОВОЕ]` | lime | lime.100 / lime.800 | light-tint (нет у донора) |
| ГЭВ `[VAPS-НОВОЕ]` | fuchsia | fuchsia.100 / fuchsia.800 | light-tint (нет у донора) |
| BEFORE_DUTY (До дежурства) `[VAPS-НОВОЕ]` | sky | sky.100 / sky.800 | light-tint (нет у донора) |

Принцип: палитра статусов **зеркалит донора 1:1** — каждый статус несёт собственный спокойный light-tint (светлый фон `-100` + насыщенный текст `-800`), включая «В строю» (green), который больше не нейтральный baseline. Три статуса, которых у донора нет (Конференция, ГЭВ, BEFORE_DUTY), помечены `[VAPS-НОВОЕ]` и получили соседние light-tint (lime / fuchsia / sky). Палитра статусов-ячеек и палитра KPI-категорий — разные слои: первая описывает строку человека, вторая — сводный счётчик. Красная заливка строки для конфликта-422 (`conflict-hard-*`) — третий, отдельный слой, не путать со статус-цветом.

## Typography

UI наследует **системный шрифтовой стек Mantine**. Разворот **добавляет display-шкалу** для донор-языка: крупные H1-заголовки экранов (Mantine `Title order={1}` с цветной `ThemeIcon` рядом и приглушённым подзаголовком под ним, напр. «Управление персоналом» / «Управление сотрудниками организации») и **крупные display-числа KPI-плиток** (~32–40px, fw-700, цвет по категории или красный `{colors.kpi-alert-number}` для отсутствий). Базовая плотность экранов смягчена `size="sm"` → `"md"` (тёплый воздух).

**Исключение по плотности:** рабочие таблицы (грид ввода, журнал расходов, список сотрудников) остаются плотными — `size="sm"` **внутри** карточки-контейнера. Моноширинный стек Mantine — для технических строк: исходящий номер, ИИН last-4, коды ошибок. Заголовки таблиц / подписи KPI — uppercase микро-метки по соглашению Mantine.

Отдельно стоит **печатный контракт официального расхода** — это **контракт документа, а не UI-токен, и разворот его НЕ меняет**. Расход ЛС `.docx`: landscape, 15 колонок, **шапка на казахском**, шрифты **16 / 12 / 8 pt** (заголовок / тело / примечания), жирный итог «Общее», ИИН = `****** + last4`. Рендерится как голый HTML + `print.css`; экранная типографика его не определяет. Значения зафиксированы в `typography.doc-print.note` как договор, не как живой токен темы.

## Layout & Spacing

**Воздушная сетка карточек.** Контентные блоки — Mantine `Card` (`radius="md"`, `shadow="sm"`/`"xs"`, комфортный padding md/lg). Главные паттерны донора:

- **Дашборд (hero):** `greeting` (тёплое приветствие) → ряд `kpi-tile` (responsive, ~4 в строку, перенос на узком) → блок `org-tree` («Структура организации»).
- **Управление персоналом:** `page-header` (крупный H1 + правые экшены) → ряд из 4 `kpi-tile` → `tabs` (Список/Карточки) → `toolbar-search` (поиск + фильтры + Импорт/Экспорт) → карточка с таблицей/сеткой сотрудников.

Базовая плотность экранов — `size="md"` с воздухом между блоками (НЕ `size="sm"` по умолчанию, как было до разворота). **Исключение:** рабочие таблицы остаются плотными (`size="sm"`, компактные строки, zebra) **внутри** карточки-контейнера, с **виртуализацией всех длинных списков** (TanStack Virtual). Десктоп-веб, штабист за столом; сайдбар-навигация роль-фильтрованная.

Жёсткие рамки производительности по-прежнему в силе и влияют на визуальные решения: бандл **≤300 КБ gzip**, **Firefox ~100**, 4 ГБ RAM / без GPU, **без runtime CSS-in-JS** (статические токены). Card-язык реализуется штатными вариантами Mantine (Card/shadow/radius) — карточки и тени «бесплатны», без кастомного runtime-CSS.

## Elevation & Depth

**Мягкие тени** (Mantine `shadow="xs"`/`"sm"`) на карточках, KPI-плитках и узлах оргструктуры — поверхности приподняты над фоном `bg` (gray.0). На интерактивных карточках (`employee-card`, кликабельные KPI/узлы) — **hover-elevation** (тень повышается, лёгкий подъём). Это прямой разворот прежней «плоской» постуры. Тени остаются мягкими и неагрессивными, чтобы плотные рабочие таблицы внутри карточек читались спокойно.

## Shapes

**Заметные скругления** — `radius="md"` (~8px, см. `rounded.card`) на карточках, KPI-плитках, кнопках и инпутах. **Аватары — круглые** (`Avatar radius="xl"`/round) в `employee-card`, узлах оргструктуры и (опц.) строках. Светофор-индикатор — по-прежнему круглая точка-dot.

## Components

Все компоненты — Mantine как есть; ниже — **визуальные дельты и семантические роли**. После разворота сохранённые компоненты живут **внутри card-языка** (на поверхностях-карточках, со скруглением и тенями). Компоненты в собранном виде — донор-скриншоты в [`imports/`](imports/) и мокапы [`mockups/key-daily-grid.html`](mockups/key-daily-grid.html) / [`mockups/key-rashod.html`](mockups/key-rashod.html) (переснятны под card-язык донора 2026-06-20).

**Добавленные (донор-разворот):**

- **Page header** — `page-header`: крупный H1 ({typography.h1}) + цветная `ThemeIcon` слева + приглушённый подзаголовок; справа — счётчик-чип (`Badge` «10 сотрудников»), «Обновить» (`button-secondary`), primary «Добавить сотрудника» (`button-primary`).
- **Greeting** — `greeting`: тёплое приветствие по времени суток на дашборде («Доброе утро/день/вечер, {имя}! 😊»), эмодзи допустим; под ним — служебная мета (дата/время/таймзона Asia/Qyzylorda).
- **KPI tile** — `kpi-tile`: `Card` radius="md" shadow="xs" с подписью-категорией, цветной `ThemeIcon` в углу (цвет по категории — `{colors.kpi-staff}`/`{colors.kpi-in-service}`/`{colors.kpi-absent}`/`{colors.kpi-command}`/`{colors.kpi-vacancy}`) и крупным display-числом ({typography.display}). Числа отсутствия — красные (`{colors.kpi-alert-number}`), «В строю» — зелёное. Опц. вторая подпись («Работают», «Временно отсутствуют»).
- **Tabs** — `tabs`: Mantine `Tabs` «Список сотрудников» / «Карточки»; активный таб — primary-акцент.
- **Toolbar search** — `toolbar-search`: поиск «Поиск по ФИО, должности, отделу…» (`TextInput` с иконкой) + фильтры-селекты «Все отделы» / «Все статусы» + «Импорт» / «Экспорт» (`button-secondary`).
- **Org tree** — `org-tree`: hero-блок «Структура организации» — горизонтальное дерево по заместителям/департаментам (тёмная шапка-полоса узла), под каждым узлом — сетка `employee-card`. Проблемный узел/карточка подсвечены красным (`{colors.light-red}`).
- **Employee card** — `employee-card`: круглый аватар + ФИО + должность + индикатор статуса (цветная рамка/`Badge` по StatusType.color). `Card` radius="md" shadow="xs", hover-elevation; проблемное состояние — красная рамка.
- **Employee row** — `employee-row`: плотная строка таблицы (size="sm" внутри карточки): чекбокс · № · ФИО (ссылка primary) · Должность · Отдел · Контакты (иконки тел/почта) · Дата найма (с иконкой) · ⋯-меню. ИИН в строке не показывается (раскрытие — по праву, см. `iin-mask`).

**Сохранённые (поведенческое ядро, теперь в card-языке):**

- **Status cell / badge** — Mantine `Badge`. **Единый light-tint (`variant="light"`) для ВСЕХ статусов** по палитре донора (`status-cell-tint`: bg = `status-*-bg`, fg = `status-*`). «В строю» — **green light-tint** как остальные (прежний нейтральный baseline `status-cell-neutral` отменён/deprecated). «Прикомандирован» — числовой бейдж **«+N»** (`status-badge-plus-n`, teal у донора). «Откомандирован» — gray light-tint, view-only. `status-cell-solid` к статус-ячейке **не применяется** (deprecated; красная заливка строки для 422 — отдельный `conflict-hard`). Цвет всегда с текст-меткой.
- **Светофор-индикатор (dot)** — `svetofor-dot`: круглая точка листа в дереве подразделений. green/orange/red/grey по светофор-токенам. Каскадирует снизу вверх; **всегда дублируется текстом** (`48/48`, «3 в дрейфе», «сводка не подана», «—»).
- **ConflictDialog** — два визуально разных режима: `conflict-dialog-hard` (422, красный, заливка строки, неоверрайдаемый, коммит блокируется) и `conflict-dialog-soft` (409, orange/yellow маркер, оверрайдаемый, поле причины 10–500 символов → в аудит).
- **Grid focus state** — `grid-focus`: толстая синяя рамка (`{colors.primary}` + кольцо `{colors.primary-focus-ring}`) на ячейке грида слепого ввода. Клавиатурная навигация без мыши (Enter↓ / Tab→ / Esc) требует видимого фокуса. Грид живёт в карточке-контейнере, но остаётся плотным.
- **Buttons** — `button-primary` (Mantine `variant="filled"` blue.6, radius="md", часто с leftSection-иконкой): «Добавить сотрудника», «Сдать день», «Сформировать». `button-secondary` (`variant="default"`/`outline"`, radius="md"): «Обновить», «Импорт», «Экспорт», «Скачать черновик», «Напомнить».
- **Readiness panel** — `readiness-panel`: панель готовности на экране расхода (в карточке). Светофор-список листов; «Не готово» (409 MARKS_INCOMPLETE) перечисляет отстающих поимённо (подразделение + ответственный) с кнопкой «Напомнить».
- **Watermark «ЧЕРНОВИК»** — `watermark-draft`: диагональный полупрозрачный gray.4 watermark на черновых документах. ФИНАЛ — без watermark.
- **IIN masking** — `iin-mask`: ИИН маскируется по умолчанию (`******`); last-4 — только по праву `employee.sensitive.view`; в `.docx` всегда `****** + last4`; каждое раскрытие/скачивание — в аудит.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Строить экраны из **карточек** (radius="md") с **мягкими тенями** и воздухом — язык донора | Возвращаться к строгой плоской серой постуре «характер не цветом» (устарела разворотом) |
| Держать **рабочие таблицы плотными** (size="sm") **внутри** карточки-контейнера | Раздувать рабочие таблицы воздухом — теряется штабная плотность данных |
| **KPI-числа отсутствия** (отпуск/рапорт/больничные/всего-отсутствуют) рисовать **красными**, «В строю» — зелёным | Делать все KPI-числа одного цвета — пропадает мгновенный сигнал тревоги |
| Использовать **круглые аватары** и тёплое **приветствие по имени** на дашборде | Сухой казённый тон без человечности (разворот ввёл тёплый голос + эмодзи на дашборде) |
| Красить **все статусы единым light-tint по палитре донора** (включая «В строю» = green) | Возвращать «В строю» к нейтральному baseline без заливки (отменено разворотом-к-донору) |
| Всегда сопровождать **цвет текст-меткой** (a11y) — и в статусах, и в KPI | Полагаться на цвет в одиночку (color-only статусы/счётчики) |
| Брать статус-цвета **1:1 из донора** (`entities/status/model.ts`, bg `-100` / fg `-800`) | Применять solid-заливку к статус-ячейке (донор использует только light-tint) |
| Держать **422 (красный, заливка) и 409 (orange/yellow, маркер) визуально разными** | Сливать hard- и soft-конфликты в один цвет/стиль |
| Опираться на **штатные варианты Mantine** (Card/shadow/radius/ThemeIcon/Avatar); дельта минимальна | Добавлять кастомный runtime-CSS под card-язык (вес ≤300 КБ, без runtime CSS-in-JS) |
| Маскировать **ИИН по умолчанию**; last-4 только по праву + аудит | Показывать полный ИИН в UI/документе/карточке без права и записи в аудит |
| Дублировать **светофор текстом** (N/M, «дрейф», «не подана») | Передавать состояние листа только цветом точки |
| Делать **фокус грида видимым** толстой синей рамкой | Прятать клавиатурный фокус — ломается слепой ввод без мыши |

<!-- GAPS:
- ВИЗУАЛЬНАЯ ЭКСТРАПОЛЯЦИЯ (только облик): визуальная система выведена из 3 скриншотов донора (imports/etalon-rashod-dashboard.png, -2.png, etalon-employees-list.png). Дашборд (greeting + KPI-ряд + org-tree) и список сотрудников (page-header + 4 KPI + табы + toolbar + таблица) показаны прямо. Остальные экраны визуально НЕ показаны — одеты в тот же card-язык (облик extrapolated). По ПОВЕДЕНИЮ они помечены в EXPERIENCE.md как [VAPS-НОВОЕ vs донор] (осознанные расхождения, у донора их нет):
  · слепой грид ввода статусов (плотная таблица в карточке-контейнере, grid-focus, ConflictDialog);
  · экран генерации расхода .docx (readiness-panel + статусы джобы + журнал исх.№ в карточках);
  · дерево-светофор готовности (svetofor-dot; визуально сближено с org-tree донора, но семантика — каскад готовности, не штатка).
- KPI-категории: точные hex иконок донора не пипеткованы — взяты штатные свотчи Mantine ближайшего семейства (blue.6/green.7/orange.6/violet.7/gray.6 + red.7 для тревожных чисел). «Фиолетовый телефон» командировки → violet.7 #7048e8 (донор visibly violet, не grape). Если нужен пиксель-точный донор-hex — пипетковать из PNG; в текстовых источниках их нет.
- Числовые значения display-шкалы (px KPI-числа, order H1) и точная shadow-ступень (xs vs sm на конкретном блоке) выведены из вида донора как ориентир (~32–40px число), но не зафиксированы как жёсткие литералы — следуем spec-паттерну inheritance от Mantine; уточняются при сборке мокапов.
- spacing/rounded: вынесена card-ступень (radius="md") как контракт разворота; полная числовая spacing-шкала по-прежнему наследует дефолт Mantine (note вместо литералов) — источники не задают пиксельную сетку.
- Мокапы key-daily-grid.html / key-rashod.html переснятны под card-язык донора (2026-06-20); color-themes-1.html — доразворотный артефакт палитры (исторический). Дашборд и список сотрудников: визуальный эталон = донор-скриншоты в imports/ (отдельные мокапы не делали).
- Палитра статусов приведена к донору 1:1 (entities/status/model.ts) 2026-06-20; единый light-tint; VAPS-расширения (Конференция/ГЭВ/BEFORE_DUTY) — нет у донора, tagged.
- СОХРАНЁНО без изменений (разворот не трогает): chrome, primary, светофор, конфликты 409/422 (включая красную заливку строки conflict-hard-* для 422 — это слой конфликтов, не статус-цвет), watermark, iin-mask, печатный контракт .docx. ИЗМЕНЕНО 2026-06-20: StatusType.color приведён к донору (единый light-tint, bg -100 / fg -800); прежняя коллизия teal/cyan снята — у донора Учёба=indigo, После дежурства=cyan, Прикомандирован=teal, BEFORE_DUTY=sky[VAPS-НОВОЕ].
-->
