# docs/load_tests/locustfile.py
"""Locust load-test harness — accreditation system (Story 1.7 baseline).

⚠️ ПЕРЕД ПРОГОНОМ (иначе baseline будет НЕДОСТОВЕРНЫМ — все запросы будут
измерять редиректы/ошибки как «успех»):

1. **Секьюрные куки / SSL-redirect.** settings задаёт `CSRF_COOKIE_SECURE` и
   `SESSION_COOKIE_SECURE = True`, `SECURE_SSL_REDIRECT` по умолчанию True. По
   `http://` куки не сохраняются и SSL-redirect ломает поток → логин не проходит.
   Запускайте против **HTTPS**-стенда ИЛИ с тестовым settings-оверрайдом
   (`SECURE_SSL_REDIRECT=False`, `*_COOKIE_SECURE=False`).
2. **django-axes** (`AXES_FAILURE_LIMIT=10`) заблокирует единый тест-аккаунт с
   одного IP. Для нагрузки отключите axes на стенде ИЛИ заведите пул аккаунтов/IP.
3. **Ratelimit** на `POST /add_attendee/` = `20/h` на IP (`block=False` → 429).
   Чтобы замерить реальную производительность add_attendee — поднимите/снимите
   лимит на стенде.
4. Предварительно создайте: тест-аккаунт (`TEST_USER`/`TEST_PASS`), `Event` +
   `Request` (`TEST_REQUEST_ID`) и валидные FK (`SEX_ID`/`COUNTRY_ID`/`DOCTYPE_ID`).

Запуск:
    locust -f docs/load_tests/locustfile.py --host https://<стенд> \
        -u 3000 -r 100 --run-time 5m --headless \
        --csv=docs/load_test_baseline_$(date +%Y-%m-%d)
"""
import os
import random

from locust import HttpUser, between, task

TEST_REQUEST_ID = os.environ.get("TEST_REQUEST_ID", "1")
TEST_USER = os.environ.get("TEST_USER", "load_test_user")
TEST_PASS = os.environ.get("TEST_PASS", "load_test_pass")

# FK ids подготовленных тестовых данных (директории). Переопределяются через env.
SEX_ID = os.environ.get("SEX_ID", "1")
COUNTRY_ID = os.environ.get("COUNTRY_ID", "1")
DOCTYPE_ID = os.environ.get("DOCTYPE_ID", "1")


class AttendeeUser(HttpUser):
    """Оператор: аутентифицируется, смотрит дашборд, добавляет участников.

    Каждый запрос ЯВНО проверяет статус (`catch_response`): Locust сам фейлит
    только 5xx, поэтому без этого 302-на-логин, 403-CSRF, 200-error-page и
    429-ratelimit считались бы успешной латентностью и baseline был бы бессмысленным.
    """

    wait_time = between(1, 3)

    def _csrf(self):
        # Токен из session jar (а не из конкретного response — Django ставит
        # csrftoken-куку не на каждый ответ).
        return self.client.cookies.get("csrftoken", "")

    def _referer(self, path):
        return f"{self.host or ''}{path}"

    def on_start(self):
        """Аутентификация через Django session + ВЕРИФИКАЦИЯ установленной сессии."""
        self.authenticated = False
        self.client.get("/user_login/", name="/user_login/ [GET]")  # прогрев CSRF-куки
        with self.client.post(
            "/user_login/",
            data={
                "username": TEST_USER,
                "password": TEST_PASS,
                "csrfmiddlewaretoken": self._csrf(),
            },
            headers={"Referer": self._referer("/user_login/")},
            name="/user_login/ [POST]",
            allow_redirects=False,
            catch_response=True,
        ) as resp:
            # Успех у user_login view → 302 на /avmac/ или /application/.
            # Неверные креды → 200 с gov.html (ошибка). Поэтому 200 здесь = провал логина.
            location = resp.headers.get("Location", "")
            if resp.status_code in (301, 302) and "user_login" not in location:
                resp.success()
                self.authenticated = True
            else:
                resp.failure(
                    f"Login failed (status={resp.status_code}). Проверьте "
                    f"TEST_USER/TEST_PASS, secure-cookie/SSL settings, django-axes lockout."
                )

    def _checked_get(self, path, name, auth_required=False):
        with self.client.get(
            path, name=name, allow_redirects=False, catch_response=True
        ) as resp:
            if auth_required and resp.status_code in (301, 302):
                resp.failure(f"{name}: redirected (not authenticated)")
            elif resp.status_code == 200:
                resp.success()
            else:
                resp.failure(f"{name}: unexpected status {resp.status_code}")

    @task(5)
    def health_check(self):
        self._checked_get("/health/", "/health/")

    @task(3)
    def api_health_check(self):
        self._checked_get("/api/health/", "/api/health/")

    @task(2)
    def view_dashboard(self):
        self._checked_get("/application/", "/dashboard/", auth_required=True)

    @task(1)
    def add_attendee(self):
        """Самый тяжёлый сценарий. Меряет реальную вставку только если форма
        доступна и POST реально сохраняет (а не 200-error / 429 / 302-на-логин)."""
        form_ok = False
        with self.client.get(
            f"/add_attendee/{TEST_REQUEST_ID}/",
            name="/add_attendee/ [GET]",
            allow_redirects=False,
            catch_response=True,
        ) as resp:
            if resp.status_code == 200:
                resp.success()
                form_ok = True
            elif resp.status_code in (301, 302):
                resp.failure("add_attendee GET: redirected (not authenticated)")
            else:
                resp.failure(f"add_attendee GET: status {resp.status_code}")
        if not form_ok:
            return

        files = {
            "photo": ("photo.jpg", b"fake-photo-content" * 1000, "image/jpeg"),
            "doc_photo": ("doc.jpg", b"fake-doc-content" * 1000, "image/jpeg"),
        }
        data = {
            "req_id": TEST_REQUEST_ID,
            "last_name": f"TestLoad_{random.randint(1, 999999)}",
            "first_name": "Load",
            "patronymic": "Testing",
            "latin_name": "Load Testing",
            "iin": "".join(str(random.randint(0, 9)) for _ in range(12)),
            "dob": "1990-01-01",
            "sex": SEX_ID,
            "citizenship": COUNTRY_ID,
            "post": "Tester",
            "document_type": DOCTYPE_ID,
            "doc_series": "N",
            "doc_number": str(random.randint(10000000, 99999999)),
            "doc_date_start": "2020-01-01",
            "doc_date_end": "2030-01-01",
            "doc_issuer": "MVD",
            "visit_objects": "All",
            "category": "A",
            "csrfmiddlewaretoken": self._csrf(),
        }
        with self.client.post(
            f"/add_attendee/{TEST_REQUEST_ID}/",
            data=data,
            files=files,
            headers={"Referer": self._referer(f"/add_attendee/{TEST_REQUEST_ID}/")},
            name="/add_attendee/ [POST]",
            allow_redirects=False,
            catch_response=True,
        ) as resp:
            if resp.status_code == 429:
                resp.failure("add_attendee POST: 429 rate-limited (tune ratelimit for load test)")
            elif resp.status_code == 403:
                resp.failure("add_attendee POST: 403 CSRF/forbidden")
            elif resp.status_code == 302:
                resp.success()  # успешный сейв → redirect
            elif resp.status_code == 200:
                # 200 может быть страницей-ошибкой валидации/дубликата (не реальный сейв).
                body = resp.text.lower()
                if "error" in body or "не удалось" in body or "не авторизован" in body:
                    resp.failure("add_attendee POST: 200 error page (validation/dup, not a real save)")
                else:
                    resp.success()
            else:
                resp.failure(f"add_attendee POST: status {resp.status_code}")
