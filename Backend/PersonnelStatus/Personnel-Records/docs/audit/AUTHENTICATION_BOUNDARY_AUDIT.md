# AUTHENTICATION_BOUNDARY_AUDIT

## 1. Current Authentication Mechanism
В текущей реализации аутентификация построена поверх `rest_framework_simplejwt.authentication.JWTAuthentication`.
Парольная аутентификация и выдача токенов (Login) происходят локально через эндпоинт, который использует `CustomTokenObtainPairSerializer`. В настройках DRF для `DEFAULT_AUTHENTICATION_CLASSES` глобально выставлен JWTAuthentication.

## 2. Current User, Role, and Division Structure
Архитектура идентификации разделена на три основных слоя:
1. `auth.User`: Базовая модель аутентификации Django (логин, пароль, is_staff, is_superuser).
2. `UserRole`: Связь 1-к-1 с `User` (через `related_name='role_info'`). Содержит привязку к справочнику `Role`, а также явные поля `scope_division` (подразделение, ограничивающее видимость) и логику откомандирований (`is_seconded`, `seconded_to`).
3. `Employee`: Модель сотрудника с профилем, которая привязывается к `User` через OneToOneField. В свою очередь, через штатную единицу (`StaffUnit`) `Employee` неявно привязан к `Division`.

В `UserRole` реализован метод `get_user_division()`, который ищет эффективную область видимости по приоритетам:
1. `seconded_to` (откомандирование).
2. `scope_division` (ручное переопределение в роли).
3. Автоматический вывод `User -> Employee -> StaffUnit -> Division`.

## 3. Current JWT and Session Setup
Текущий локальный JWT хранит в payload не только идентификатор пользователя (user_id), но и "упаковывает" множество авторизационных данных (claims) через `CustomTokenObtainPairSerializer`:
* `role` (напр., 'ROLE_4') и `role_name`.
* `scope_division_id`, `scope_division_name`, `scope_division_level`, `scope_type`, `scope_source`.
* Флаги доступа: `can_edit_statuses`, `is_admin`, `is_hr_admin`, `is_manager`, `is_observer`, `is_seconded`.
* `employee_id` и ФИО.

Эти данные активно используются Frontend-приложением для управления UI, но на Backend-слое (например, в `rbac.py` и views) DRF автоматически извлекает `request.user` из базы данных при верификации подписи JWT. Таким образом, `check_permission()` всё равно обращается к БД: `user.role_info.get_role_code()`.

## 4. How External JWT Should Map into Internal User Identity
При переходе на внешнего Identity Provider (Keycloak / OAuth2 / корпоративный SSO):
1. Внешний JWT не будет (и не должен) знать о сложной иерархии `divisions`, `StaffUnit` и специфичных флагах (`is_seconded`).
2. Внешний JWT должен содержать уникальный идентификатор пользователя (например, UUID из SSO, IIN сотрудника или email).
3. На стороне Backend необходимо реализовать Custom Authentication Class (например, наследованный от `JWTAuthentication`), который будет извлекать внешний `user_id` из токена, проверять подпись (через публичный ключ SSO), а затем динамически связывать его (на лету или с созданием) с внутренней моделью `auth.User` и её профилем `UserRole` / `Employee`.

## 5. Required Claims
Минимальный набор полей (claims), который должен предоставлять внешний SSO:
* `sub` (Subject / уникальный идентификатор пользователя).
* Опционально: `email`, `preferred_username` или IIN (ИИН), чтобы можно было найти или автоматически создать локальную учетку (User / Employee).
* (Архитектурное решение): Роли (roles) могут либо приходить из внешнего JWT (как массив), либо маппинг ролей останется полностью во внутренней базе `organization_management`, а SSO служит только для Аутентификации (Authentication), а не Авторизации (Authorization).

## 6. Error Handling Contract (401 / 403)
* **401 Unauthorized**: Должен возвращаться, если: токен отсутствует в заголовке `Authorization`, токен просрочен (expired), подпись невалидна, или токен отозван (blacklisted). Backend не должен пытаться обработать неаутентифицированный запрос, если он не публичный.
* **403 Forbidden**: Должен возвращаться, если токен валиден, но `request.user` не найден в локальной базе или метод `rbac.check_permission` возвращает `False` для запрашиваемого эндпоинта/объекта. В ответе 403 необходимо отдавать JSON: `{"detail": "У вас нет прав для выполнения этого действия"}`.

## 7. Risks
1. **Десинхронизация состояния**: Если SSO удалит пользователя, локальная база может об этом не знать (если не реализовать Webhook или проверку статуса).
2. **Толстый Payload локального JWT**: Фронтенд сейчас сильно завязан на то, что `scope_division_id` и флаги доступа лежат прямо в токене. При внедрении внешнего JWT эти поля исчезнут из токена. Потребуется отдельный эндпоинт (например, `/api/auth/me/`), который Фронтенд будет вызывать сразу после логина для получения профиля прав (Profile Context).
3. **Lazy Evaluation во Views**: Если Auth Middleware будет всегда делать JOIN всех моделей `UserRole` -> `Role` -> `Division` -> `Employee`, это может вызвать деградацию производительности. Нужно кеширование профиля пользователя или вынос авторизации в селекторы (PermissionService).

## 8. What Must Not Be Changed Yet
* Не менять локальный генератор `CustomTokenObtainPairSerializer` или настройки `SIMPLE_JWT`.
* Не менять `common/rbac.py` или `common/drf_permissions.py`.
* Не внедрять логику SSO / OIDC (Keycloak).
* Не менять структуру моделей `UserRole` и `Role`.

## 9. Recommended Implementation Plan
1. **Подготовка PermissionService (STORY-003)**: Инкапсулировать логику `rbac.py` и расчет `scope_division` в изолированный сервис, чтобы полностью отвязать Views от прямой работы с `user.role_info`.
2. **Создание `/api/auth/me/` (Profile API)**: Вынести генерацию "упакованных" claims из локального JWT (таких как `can_edit_statuses`, `scope_division_id`) в отдельный GET эндпоинт профиля. Обновить Frontend для получения профиля по API, а не из парсинга JWT.
3. **Внедрение External JWT**: После отвязки Фронтенда от "толстого" токена, заменить `SIMPLE_JWT` на `PyJWT` / `drf-oidc-auth`, настроив верификацию RSA-ключей (JWKS) и маппинг `sub` на локальный `User.id`.
