# Схема ссылок SmartQoldau

Одна схема для приложения (эпик E6, задача 23) и лендинга (эпик E10). Все
ссылки — на хосте `smartqoldau.kz` по `https`; всё остальное приложение не
разбирает и оставляет пользователя на главной.

| Ссылка | Маршрут приложения | Зачем |
|---|---|---|
| `https://smartqoldau.kz/e/{expertId}` | `/catalog/expert/{expertId}` | Карточка специалиста с кнопкой «Записаться» (БП-01 шаг 1: deeplink с предвыбранным экспертом) |
| `https://smartqoldau.kz/t/{topicSlug}` | `/topic?slug={topicSlug}` | Тема консультации с выбором формата |
| `https://smartqoldau.kz/sos` | `/emergency` | Экстренный вход (БП-02) |
| `https://smartqoldau.kz/c/{consultationId}` | `/session/{consultationId}` | Возврат в свою консультацию (в т.ч. из пуша) |

Разбор — единственной функцией `DeepLinks.resolve` / `DeepLinks.resolvePath`
(`app_client/lib/core/deep_links.dart`). Ею же пользуется обработчик пуша:
два разбора с разными правилами разошлись бы на первой новой ссылке.

Идентификаторы и slug'и допускаются только из набора `[A-Za-z0-9_-]`.
Ссылка — внешний ввод: `../` в пути роутера или пробелы в slug'е увели бы
навигацию куда угодно.

## Отложенный переход

Ссылка, открытая до восстановления сессии, применяется ПОСЛЕ того, как
`AuthController` вышел из `AuthUnknown`. Иначе редирект-гард уводит на
`/splash`, и цель ссылки теряется.

## Что обязан отдавать лендинг (входное условие эпика E10)

### Android — `https://smartqoldau.kz/.well-known/assetlinks.json`

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "kz.smartqoldau.app_client",
      "sha256_cert_fingerprints": ["<SHA-256 отпечаток релизного ключа>"]
    }
  }
]
```

Отдавать с `Content-Type: application/json`, без редиректов, по `https`.
Отпечаток берётся из релизного keystore: `keytool -list -v -keystore
<release.jks> -alias <alias>`.

### iOS — `https://smartqoldau.kz/.well-known/apple-app-site-association`

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "<TEAM_ID>.kz.smartqoldau.appClient",
        "paths": ["/e/*", "/t/*", "/sos", "/c/*"]
      }
    ]
  }
}
```

Без расширения `.json` в имени файла, `Content-Type: application/json`, без
редиректов.

## Как проверить

```bash
# Android, на запущенном эмуляторе
adb shell am start -a android.intent.action.VIEW \
  -d "https://smartqoldau.kz/e/<expertId>"

# iOS, на симуляторе
xcrun simctl openurl booted "https://smartqoldau.kz/sos"
```

Проверка на устройстве в окружении разработки 2026-08-23 не выполнялась:
Android-сборка недоступна (в системе нет JDK, только JRE).
