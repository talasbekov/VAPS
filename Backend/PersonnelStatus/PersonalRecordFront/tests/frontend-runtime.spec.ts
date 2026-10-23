import { test, expect, type Page } from "@playwright/test";

test.skip(!process.env.SMOKE_PASSWORD, "Set credentials for an isolated browser test account.");

async function signIn(page: Page, employee = false) {
  const csrf = await (await page.request.get("/api/auth/csrf/")).json();
  const response = await page.request.post("/api/auth/callback/credentials/", {
    form: {
      csrfToken: csrf.csrfToken,
      username: employee
        ? process.env.EMPLOYEE_TEST_USER ?? "role_employee"
        : process.env.SMOKE_USER ?? "admin",
      password: employee ? process.env.ROLE_ACCOUNTS_PASSWORD! : process.env.SMOKE_PASSWORD!,
      json: "true",
    },
  });
  expect(response.ok()).toBe(true);
  expect((await response.json()).url).not.toContain("error=");
}

const ratings = (results: unknown[] = [], enabled = true) => ({
  results,
  policy: null,
  capabilities: { operationalRatings: enabled, ratingConflicts: false },
  unavailableFactors: [],
  unavailableViews: [],
});

function dynamicsRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/ops/operational-rating-dynamics/") requests.push(request.url());
  });
  return requests;
}

test("empty ratings show an empty state without requesting a missing participant", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/ops/operational-ratings/", route => route.fulfill({ json: ratings() }));
  const requests = dynamicsRequests(page);
  await page.goto("/security-ops/ratings/");
  await expect(page.getByText("Участников рейтинга пока нет.", { exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  expect(requests).toEqual([]);
});

test("disabled ratings do not request dynamics", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/ops/operational-ratings/", route => route.fulfill({ json: ratings([], false) }));
  const requests = dynamicsRequests(page);
  await page.goto("/security-ops/ratings/");
  await expect(page.getByText(/Оперативный рейтинг пока недоступен/)).toBeVisible();
  await page.waitForTimeout(300);
  expect(requests).toEqual([]);
});

test("ratings with participants still load dynamics", async ({ page }) => {
  await signIn(page);
  const employee = {
    employeeId: "audit-participant", personnelId: null, safeLabel: "Участник проверки",
    aggregateRating: null, evaluationsCount: 0, periodStartsAt: null, periodEndsAt: null,
    calculationPolicyVersion: null, calculatedAt: "2026-10-06T00:00:00Z", dataState: "INSUFFICIENT_DATA",
  };
  await page.route("**/api/ops/operational-ratings/", route => route.fulfill({ json: ratings([employee]) }));
  await page.route("**/api/ops/operational-rating-dynamics/**", route => route.fulfill({ json: {
    employeeId: employee.employeeId, safeLabel: employee.safeLabel, points: [], boundaries: [],
    currentPolicy: null, currentPolicyHasClosedPeriods: false,
    capabilities: { operationalRatings: true }, employees: [employee],
  } }));
  const requests = dynamicsRequests(page);
  await page.goto("/security-ops/ratings/");
  await expect(page.getByText("Закрытых периодов ещё нет — строить график не по чему.", { exact: true })).toBeVisible();
  expect(requests.length).toBeGreaterThan(0);
});

const emptyObjects = {
  results: [], freshness: [],
  kpi: { total: 0, passportGreen: 0, passportYellow: 0, passportRed: 0, verificationOverdue: 0, neverPublished: 0 },
  freshnessPolicy: { version: "browser-test", verificationIntervalDays: 120, dueSoonPercent: 25 },
  unavailableKpi: [],
};

test("dynamics failures can be retried without exposing server details", async ({ page }) => {
  await signIn(page);
  const employee = {
    employeeId: "audit-participant", personnelId: null, safeLabel: "Участник проверки",
    aggregateRating: null, evaluationsCount: 0, periodStartsAt: null, periodEndsAt: null,
    calculationPolicyVersion: null, calculatedAt: "2026-10-06T00:00:00Z", dataState: "INSUFFICIENT_DATA",
  };
  await page.route("**/api/ops/operational-ratings/", route => route.fulfill({ json: ratings([employee]) }));
  let attempts = 0;
  let recovered = false;
  await page.route("**/api/ops/operational-rating-dynamics/**", route => {
    attempts += 1;
    return !recovered ? route.fulfill({ status: 503, json: {
      error_code: "INTERNAL_ERROR", message: "SQL SELECT private_rating_table failure", details: {}, request_id: null, timestamp: "2026-10-06T00:00:00Z",
    } }) : route.fulfill({ json: {
      employeeId: employee.employeeId, safeLabel: employee.safeLabel, points: [], boundaries: [],
      currentPolicy: null, currentPolicyHasClosedPeriods: false,
      capabilities: { operationalRatings: true }, employees: [employee],
    } });
  });
  await page.goto("/security-ops/ratings/");
  await expect(page.getByRole("alert").filter({ hasText: "Не удалось загрузить динамику рейтинга." })).toBeVisible();
  await expect(page.getByText("SQL SELECT private_rating_table failure", { exact: true })).toHaveCount(0);
  const attemptsBeforeRetry = attempts;
  recovered = true;
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByText("Закрытых периодов ещё нет — строить график не по чему.", { exact: true })).toBeVisible();
  expect(attempts).toBeGreaterThan(attemptsBeforeRetry);
});

test("missing passport policy is explained and retry reloads the registry", async ({ page }) => {
  await signIn(page);
  let attempts = 0;
  await page.route("**/api/ops/objects/", route => {
    attempts += 1;
    return attempts === 1 ? route.fulfill({ status: 422, json: {
      error_code: "VALIDATION_ERROR", message: "Политика актуальности паспорта не настроена.",
      details: { policy: ["Политика актуальности паспорта не настроена."] }, request_id: null, timestamp: "2026-10-06T00:00:00Z",
    } }) : route.fulfill({ json: emptyObjects });
  });
  await page.goto("/security-ops/objects/");
  await expect(page.getByRole("alert").filter({ hasText: "Политика актуальности паспорта не настроена." })).toBeVisible();
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByText("Объектов пока нет", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Поиск по реестру объектов", { exact: true })).toHaveCount(0);
  expect(attempts).toBe(2);
});

test("object server failures have a retry action and do not expose technical details", async ({ page }) => {
  await signIn(page);
  let attempts = 0;
  let recovered = false;
  await page.route("**/api/ops/objects/", route => {
    attempts += 1;
    return !recovered ? route.fulfill({ status: 503, json: {
      error_code: "INTERNAL_ERROR", message: "SQL SELECT private_table failure", details: {}, request_id: null, timestamp: "2026-10-06T00:00:00Z",
    } }) : route.fulfill({ json: emptyObjects });
  });
  await page.goto("/security-ops/objects/");
  await expect(page.getByRole("alert").filter({ hasText: "Не удалось загрузить реестр объектов." })).toBeVisible();
  await expect(page.getByText("SQL SELECT private_table failure", { exact: true })).toHaveCount(0);
  const attemptsBeforeRetry = attempts;
  recovered = true;
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByText("Объектов пока нет", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Поиск по реестру объектов", { exact: true })).toHaveCount(0);
  expect(attempts).toBeGreaterThan(attemptsBeforeRetry);
});

test("an account without access does not request protected registries", async ({ page }) => {
  test.skip(!process.env.ROLE_ACCOUNTS_PASSWORD, "Set the isolated employee account password.");
  await signIn(page, true);
  const requests: string[] = [];
  page.on("request", request => {
    if (["/api/ops/objects/", "/api/ops/operational-ratings/", "/api/ops/operational-rating-dynamics/"].includes(new URL(request.url()).pathname)) requests.push(request.url());
  });
  for (const route of ["/security-ops/objects/", "/security-ops/ratings/"]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: "Доступ закрыт", exact: true })).toBeVisible();
  }
  expect(requests).toEqual([]);
});
