# UC-GEN-001. Войти в систему и продлить сессию

| Поле | Значение |
|---|---|
| Модуль | Общие |
| Актор | Любая учётная запись Django (`User`, `is_active=True`) — все роли, включая `ADMIN` |
| Статус | Done |
| Основание | `config/urls.py` (`api/token/`, `api/token/refresh/`), `apps/common/jwt_serializers.py` (`CustomTokenObtainPairSerializer`), `config/settings/base.py` (`SIMPLE_JWT`, `REST_FRAMEWORK.DEFAULT_AUTHENTICATION_CLASSES`), FRONT `lib/auth-config.ts`, `lib/refresh-policy.ts`, `lib/access-token.ts`, `lib/auth.tsx`, `lib/expired-redirect.ts`, `middleware.ts`, `app/page.tsx` |
| Дата актуализации | 2026-09-08 |

## Цель
Актор получает рабочую сессию портала по логину и паролю и продолжает работать без повторного входа, пока действует refresh-токен.

## Предусловия
- Учётная запись заведена (UC-ADM-002) и активна (`is_active=True`).
- Бэкенд доступен серверу Next по `BACKEND_URL` / `NEXT_PUBLIC_API_URL` (по умолчанию `http://localhost:8100`).
- В проде задан `NEXTAUTH_SECRET` (без него `resolveNextAuthSecret()` бросает ошибку и сервер не стартует; в dev — `dev-local-secret`).

## Main Flow
1. Актор открывает форму входа `/` и вводит имя пользователя и пароль (оба поля `required`).
2. Система (NextAuth `CredentialsProvider.authorize`) отправляет `POST /api/token/` с `username`/`password`.
3. Бэкенд (`TokenObtainPairView` + `CustomTokenObtainPairSerializer`) проверяет учётные данные и возвращает `access`, `refresh` и объект `user` (`id`, `username`, `email`, `is_staff`, при наличии — `division` штатной единицы сотрудника).
4. Система кладёт токены в JWT-сессию NextAuth (cookie), срок `accessTokenExpires` читает из claim `exp` самого access-токена (`accessExpiryMs`).
5. Система переводит актора на `callbackUrl` (только внутренний путь того же origin, не `/`), иначе — на `/dashboard`.
6. При каждом чтении сессии (`/api/auth/session`) колбэк `jwt` проверяет `isExpiring` (за 60 с до `exp`); если токен истекает — выполняет `POST /api/token/refresh/` с текущим refresh-токеном (одно продление на токен, `makeOnce`).
7. Бэкенд (`TokenRefreshView`, `ROTATE_REFRESH_TOKENS=True`) выдаёт новый `access` и новый `refresh`; система сохраняет оба в сессию.
8. Клиентские запросы к бэку подписываются `Authorization: Bearer <access>` через `getAccessToken()` (кэш 15 с, дедупликация параллельных запросов сессии).
9. Актор нажимает «Выйти» — система сбрасывает кэш токена (`resetAccessToken`), завершает сессию NextAuth (`signOut`) и переводит на `/`.

## Alternative Flow
- **AF1. Неверные учётные данные / бэкенд ответил не 2xx**: шаг 3 → `authorize` возвращает `null`, форма показывает «Неверное имя пользователя или пароль».
- **AF2. Сетевая ошибка при входе (`fetch failed`, `ECONNREFUSED`)**: шаг 2 → `authorize` возвращает `null` (в консоль сервера пишется подсказка про недоступный бэкенд); форма показывает то же сообщение «Неверное имя пользователя или пароль».
- **AF3. Refresh-токен отвергнут (ответ 400/401/403, `isTokenRejected`)**: шаг 7 → в токен сессии пишется `error: "RefreshAccessTokenError"`, `accessToken` снимается; `AuthProvider` (`lib/auth.tsx`) выполняет `signOut` и уводит на `expiredLoginUrl` — `/?reason=expired&callbackUrl=<текущий путь+search+hash>`; форма входа показывает плашку «Сессия истекла — войдите заново».
- **AF4. Временный сбой продления (5xx, сеть, 200 без поля `access`)**: шаг 7 → сессия не сжигается, `accessTokenExpires` сдвигается на `REFRESH_RETRY_MS` (30 с), повтор при следующем чтении сессии.
- **AF5. Аноним открывает защищённый хостовый маршрут** (`/dashboard`, `/employees`, `/organization`, `/statuses`, `/reports`, `/settings`, `/feedback`): `middleware.ts` (next-auth/middleware) перенаправляет на `/` с `callbackUrl`. Маршруты `/security-ops/*` middleware не закрывает — их гейт держится на 403 бэка через `useOpsPermissions`.
- **AF6. Вошедший открывает `/`**: `useEffect` в `LoginScreen` сразу переводит на `safeCallbackUrl(callbackUrl)`.
- **AF7. `callbackUrl` указывает на чужой origin или на `/`**: `safeCallbackUrl` подменяет его на `/dashboard`.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `auth_user` (`User.last_login`) | update | SimpleJWT `TokenObtainPairSerializer` обновляет `last_login` при успешном входе (стандартное поведение библиотеки, `UPDATE_LAST_LOGIN` не задан явно) |
| JWT-сессия NextAuth (cookie браузера) | create / update | При входе — `accessToken`, `refreshToken`, `accessTokenExpires`, `id`, `role` (всегда `null`: бэкенд поле не отдаёт), `userData`; при продлении — новые `accessToken`/`refreshToken`; при отказе — `error` |
| Таблицы отозванных токенов (`token_blacklist`) | — | Не реализовано в коде: приложение `rest_framework_simplejwt.token_blacklist` не установлено, `BLACKLIST_AFTER_ROTATION=False`; старый refresh после ротации остаётся действительным до истечения |

## Бизнес-требования (BR)
- **BR1.** Access-токен живёт 8 часов (`ACCESS_TOKEN_LIFETIME`), refresh-токен — 7 суток (`REFRESH_TOKEN_LIFETIME`); каждое продление выдаёт новый refresh с новым 7-суточным окном (`ROTATE_REFRESH_TOKENS=True`).
- **BR2.** Окно простоя сессии NextAuth — 7 суток (`session.maxAge = 7*24*60*60`); cookie скользящая — перевыпускается при каждом чтении сессии.
- **BR3.** Токен несёт только идентичность: `username`, `email`, `is_staff`, `is_superuser`, `employee_id`, `employee_full_name`, `employee_personnel_number`. Права в токен не кладутся — их отдаёт `/api/operations/my-permissions/` (см. UC-ADM-001).
- **BR4.** Продление считается запущенным за `EXPIRY_SKEW_MS` = 60 с до `exp`; если `exp` прочитать не удалось — токену верят `UNKNOWN_EXPIRY_MS` = 120 с.
- **BR5.** Сессия сжигается только по ответу сервера 400/401/403 на `/api/token/refresh/`; любой другой отказ — временный, повтор не чаще раза в 30 с.
- **BR6.** Одновременные чтения сессии порождают одно продление на refresh-токен (`makeOnce`); кэш access-токена на клиенте — 15 с, при выходе сбрасывается явно.
- **BR7.** После входа актор возвращается на адрес, с которого его развернули (`callbackUrl`), включая `search` и `hash`; внешние адреса и `/` заменяются на `/dashboard`.
- **BR8.** `DEFAULT_PERMISSION_CLASSES = AllowAny` — аутентификация JWT обязательна не по умолчанию, а по решению каждого вьюсета (`IsAuthenticated`, `require_permission`, `permission_map`).

## Требования к логированию
- Бэкенд: `LogIPMiddleware` печатает каждый входящий запрос `Incoming Request: <method> <path> from IP: <ip>` через `print` (в т.ч. `POST /api/token/`, `POST /api/token/refresh/`). Обработчик логирования один — `console`.
- Фронт (сервер Next): `console.log` адреса бэкенда, статуса и заголовков ответа `/api/token/`, объекта `user` из ответа; токены печатаются как `[REDACTED]`. `console.error` при отказе входа/продления, `console.warn("Token refresh postponed", why)` при временном отказе.
- Аудит входа/выхода/продления в `OpsAuditLog` или `audit.AuditLog`: `Не реализовано в коде` (`AuditMiddleware` не пишет запись — путь `/api/token/` не разбирается в `ContentType`).
- Учёт неудачных попыток входа, блокировка по числу попыток: `Не реализовано в коде`.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| Любая активная учётная запись Django (все роли `ROLE_PERMISSIONS`, включая `ADMIN`) | полный (вход, продление, выход) | `TokenObtainPairView` / `TokenRefreshView` (SimpleJWT) без кодов прав раздела; `JWTAuthentication` — единственный класс аутентификации DRF |
| Заблокированная учётная запись (`is_active=False`) | нет | SimpleJWT отказывает во входе и в `get_user` при продлении (стандартная проверка `is_active`) |

## Требования к UX/UI
- Экран «Вход в систему» — страница `/` (`app/page.tsx`), заголовок «Расход Организации», карточка формы.
- Состав: поле «Имя пользователя» (`required`, `autoComplete="username"`), поле «Пароль» (`required`, `autoComplete="current-password"`), кнопка «Войти» (в процессе — «Вход…», `disabled`), декоративные плитки «Сбор сил на ОМ» и «Контроль доступа» (без действий).
- Состояния: плашка «Сессия истекла — войдите заново» (не destructive) при `?reason=expired` и пустой ошибке формы; красный `Alert` с текстом ошибки после неудачной попытки («Неверное имя пользователя или пароль»; для исключений — сообщения по подстроке `500`/`404`/`401|403` или текст ошибки).
- Выход: пункт «Выйти» в выпадающем меню шапки (`components/navigation/header.tsx`).
- Масок и подсказок о требованиях к паролю на форме входа нет.

## Открытые вопросы
- Сообщение об ошибке одно и то же для неверного пароля и для недоступного бэкенда (`authorize` в обоих случаях возвращает `null`) — актор не отличает свою ошибку от сбоя сервера.
- `BLACKLIST_AFTER_ROTATION=False` и приложение `token_blacklist` не установлено: старые refresh-токены после ротации не отзываются (в комментарии `SIMPLE_JWT` вопрос вынесен карточкой в «Предложено Claude»).
- Комментарий в `lib/auth-config.ts` («ROTATE_REFRESH_TOKENS на сервере выключен», «BLACKLIST_AFTER_ROTATION=True уже стоит») расходится с текущими настройками бэкенда (ротация включена, blacklist выключен); код при этом работает в обоих режимах.
- `token.role` в сессии всегда `null` (бэкенд `role` не отдаёт с Plane №352), поле остаётся в `authorize`/`jwt`/`session` как мёртвый код.
- Срок жизни refresh-токена продублирован константой `REFRESH_TOKEN_LIFETIME_SECONDS` на клиенте; расхождение с `SIMPLE_JWT` не проверяется.
- Предупреждение о скором принудительном выходе: `Не реализовано в коде` (в комментарии `session.maxAge` — «вопрос к заказчику, заведён карточкой»).
