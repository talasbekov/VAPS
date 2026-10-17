import { expect, test, type Page } from "@playwright/test";

test.skip(!process.env.SMOKE_PASSWORD, "Use the existing isolated stand account.");

const request = {
  eventId: "focus-event", code: "ОМ-ПРОВЕРКА", title: "Проверка подбора сотрудников",
  businessDate: "2026-10-09", allocationId: "focus-request", departmentName: "Департамент",
  status: "NOTIFIED", dueAt: null,
  directorates: [{ divisionId: "9101", name: "Управление проверки", need: 3, assigned: 1, notifiedAt: null }],
};

async function prepare(page: Page, permissions = ["status.view", "status.manage"], requests = [request]) {
  const csrf = await (await page.request.get("/api/auth/csrf/")).json();
  const response = await page.request.post("/api/auth/callback/credentials/", {
    form: { csrfToken: csrf.csrfToken, username: process.env.SMOKE_USER ?? "admin", password: process.env.SMOKE_PASSWORD!, json: "true" },
  });
  expect(response.ok()).toBe(true);
  expect((await response.json()).url).not.toContain("error=");
  await page.route("**/api/operations/my-permissions/**", route => route.fulfill({ json: { permissions, status_manage_division_ids: permissions.includes("status.manage") ? null : [], roles: [] } }));
  await page.route("**/forces/directorate-requests/**", route => route.fulfill({ json: { results: requests } }));
  await page.route("**/forces/requests/focus-request/directorate/**", route => route.fulfill({ json: request }));
}

test("menu keeps request progress visible and opens employee selection with the keyboard", async ({ page }) => {
  await prepare(page);
  await page.goto("/statuses/");
  const banner = page.locator('[data-slot="forces-request-banner"]');
  await expect(banner).toContainText("ОМ-ПРОВЕРКА");
  await expect(banner.getByText("Выделено 1 из 3", { exact: true })).toBeVisible();
  const picker = banner.getByRole("button", { name: "Группы", exact: true });
  await expect(picker).toBeHidden();
  const disclosure = banner.locator("summary");
  await disclosure.focus();
  await page.keyboard.press("Enter");
  await expect(picker).toBeVisible();
  await expect(banner.getByText("Управление проверки:", { exact: true })).toBeVisible();
  await disclosure.click();
  await expect(picker).toBeHidden();
  await expect(banner.getByText("Выделено 1 из 3", { exact: true })).toBeVisible();
});

test("notification link opens request selection immediately", async ({ page }) => {
  await prepare(page);
  await page.goto("/statuses/?forcesRequest=focus-request");
  const banner = page.locator('[data-slot="forces-request-banner"]');
  await expect(banner.getByRole("button", { name: "Группы", exact: true })).toBeVisible();
  await expect(banner.getByRole("button", { name: "Отметьте сотрудников в таблице", exact: true })).toBeDisabled();
});

test("read-only request link retains the access explanation and no allocation controls", async ({ page }) => {
  await prepare(page, ["status.view"]);
  const reads: string[] = [];
  page.on("request", current => {
    const path = new URL(current.url()).pathname;
    // The roster legitimately reads campaign reserves under status.view.
    // The banner's request list and allocation details require status.manage.
    if (/\/forces\/(?:directorate-requests|requests)\//.test(path)) reads.push(current.url());
  });
  await page.goto("/statuses/?forcesRequest=focus-request");
  await expect(page.getByRole("region", { name: "Запрос на сбор сил недоступен", exact: true })).toBeVisible();
  await expect(page.getByText("Подбор сотрудников", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Массовое обновление", exact: true })).toHaveCount(0);
  expect(reads).toEqual([]);
});

test("no outstanding requests leave no empty selection disclosure", async ({ page }) => {
  await prepare(page, ["status.view", "status.manage"], []);
  const response = page.waitForResponse(current => new URL(current.url()).pathname.endsWith("/forces/directorate-requests/"));
  await page.goto("/statuses/");
  await response;
  await expect(page.getByRole("heading", { name: "Управление статусами", exact: true })).toBeVisible();
  await expect(page.getByText("Подбор сотрудников", { exact: true })).toHaveCount(0);
});

test("many requests use one compact selector and keep the chosen request explicit", async ({ page }) => {
  const requests = Array.from({ length: 24 }, (_, index) => ({
    ...request, allocationId: `focus-${index}`, code: `ОМ-${index + 1}`,
  }));
  await prepare(page, ["status.view", "status.manage"], requests);
  await page.route("**/forces/requests/*/directorate/**", route => {
    const selected = requests.find(row => route.request().url().includes(`/requests/${row.allocationId}/`));
    return route.fulfill({ json: selected });
  });
  await page.goto("/statuses/?businessDate=2026-10-28&search=retained");
  const chooser = page.locator('[data-slot="forces-request-chooser"]');
  const selector = page.getByRole("combobox", { name: "Запрос для подбора сотрудников", exact: true });
  await expect(selector).toHaveValue("");
  await expect(selector.locator("option")).toHaveCount(25);
  await expect(chooser.getByRole("button")).toHaveCount(0);
  expect((await chooser.boundingBox())!.height).toBeLessThan(180);
  await selector.selectOption("focus-17");
  const banner = page.locator('[data-slot="forces-request-banner"]');
  await expect(banner).toContainText("Запрос на ОМ-18");
  await expect(selector).toHaveValue("focus-17");
  await expect(banner.getByRole("button", { name: "Группы", exact: true })).toBeVisible();
  await selector.selectOption("focus-2");
  await expect(banner).toContainText("Запрос на ОМ-3");
  expect(new URL(page.url()).searchParams.get("businessDate")).toBe("2026-10-28");
  expect(new URL(page.url()).searchParams.get("search")).toBe("retained");
});
