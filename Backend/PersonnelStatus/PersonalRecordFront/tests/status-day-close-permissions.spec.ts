import { expect, test, type Page } from "@playwright/test";
import type { DaySubmission } from "@/entities/daily-grid";

test.skip(!process.env.SMOKE_PASSWORD, "Use the existing isolated stand account.");
const DIVISIONS = "/api/ops/daily/divisions/";
const SUBMISSIONS = "/api/ops/daily/daily-submissions/";
const DAY = "2026-10-28";
const units = [
  { id: "9101", name: "Первое управление проверки", ancestors: ["Первый департамент"], division_type: "directorate", can_submit: true, can_correct: true },
  { id: "9102", name: "Второе управление проверки", ancestors: ["Второй департамент"], division_type: "directorate", can_submit: true, can_correct: true },
  { id: "9103", name: "Чужое управление проверки", ancestors: [], division_type: "directorate", can_submit: false, can_correct: false },
];
const submittedRow: DaySubmission = {
  id: 99101, division_id: "9101", business_date: DAY, version: 1, is_current: true,
  event: "CHANGED", submitted_by: "Автор сдачи", submitted_at: "2026-10-08T07:00:00Z",
  late: false, sent_at: null, sent_by: "", incomplete_reason: "",
};

async function signIn(page: Page) {
  const csrf = await (await page.request.get("/api/auth/csrf/")).json();
  const response = await page.request.post("/api/auth/callback/credentials/", {
    form: { csrfToken: csrf.csrfToken, username: process.env.SMOKE_USER ?? "admin", password: process.env.SMOKE_PASSWORD!, json: "true" },
  });
  expect(response.ok()).toBe(true);
  expect((await response.json()).url).not.toContain("error=");
}

async function metadata(page: Page, permissions: string[], rows = units, roles: unknown[] = []) {
  const reads: string[] = [];
  const writes: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith(SUBMISSIONS) && request.method() !== "GET") writes.push(request.method());
  });
  await page.route("**/api/operations/my-permissions/**", route => route.fulfill({ json: {
    permissions, global_permissions: permissions.includes("*") ? ["*"] : [], roles,
  } }));
  await page.route(`**${DIVISIONS}**`, route => route.fulfill({ json: { results: rows } }));
  await page.route(`**${SUBMISSIONS}**`, route => {
    if (route.request().method() !== "GET") {
      return route.abort();
    }
    reads.push(route.request().url());
    return route.fulfill({ json: { count: 0, results: [] } });
  });
  await page.route("**/api/operations/strength-report/**", route => route.fulfill({ json: {
    business_date: DAY, columns: ["IN_SERVICE"], column_labels: { IN_SERVICE: "В строю" },
    totals: { list_total: 2, attached: 0, columns: { IN_SERVICE: 2 } }, rows: [],
  } }));
  return { reads, writes };
}

test("submission controls name their purpose and keep the initial choice compact", async ({ page }) => {
  await signIn(page);
  const network = await metadata(page, ["*"]);
  await page.goto(`/statuses?businessDate=${DAY}&search=retained`);
  const region = page.getByRole("region", { name: "Сдача дня за управление", exact: true });
  await expect(region.getByRole("heading", { name: "Сдача расхода", exact: true })).toBeVisible();
  await expect(region.getByText("Подготовьте статусы → проверьте расход → сдайте день", { exact: true })).toBeVisible();
  await expect(region.getByText("Дата относится только к расходу и сдаче дня. Текущие статусы в таблице меняются с сегодняшнего дня.", { exact: true })).toBeVisible();
  await expect(region.getByLabel("Расход на дату", { exact: true }).and(region.locator('input[type="date"]'))).toHaveValue(DAY);
  const selector = region.getByLabel("Управление для сдачи дня", { exact: true });
  await expect(selector).toHaveValue("");
  await expect(region.getByRole("heading", { name: "Деловая дата", exact: true })).toHaveCount(0);
  await expect(region.getByRole("button", { name: "Сдать день", exact: true })).toHaveCount(0);
  const before = await region.boundingBox();
  expect(before!.height).toBeLessThan(220);
  await selector.selectOption("9102");
  await expect(region.getByRole("button", { name: "Сдать день", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("search")).toBe("retained");
  expect(new URL(page.url()).searchParams.get("businessDate")).toBe(DAY);
  expect(new URL(page.url()).searchParams.get("submitDivision")).toBe("9102");
  expect(network.writes).toEqual([]);
});

test("returning to server tomorrow retains the selected unit and other URL state", async ({ page }) => {
  await signIn(page);
  const network = await metadata(page, ["*"]);
  const tomorrow = "2026-10-09";
  await page.route("**/api/operations/tomorrow-block/**", route => route.fulfill({ json: {
    business_date: tomorrow, blocked: false, laggards: [],
  } }));
  await page.goto(`/statuses?businessDate=${DAY}&submitDivision=9102&search=retained`);
  const region = page.getByRole("region", { name: "Сдача дня за управление", exact: true });
  await expect(region.getByRole("button", { name: "Сдать день", exact: true })).toBeVisible();
  await region.getByRole("button", { name: "Вернуть завтра", exact: true }).click();
  await expect(region.getByLabel("Расход на дату", { exact: true }).and(region.locator('input[type="date"]'))).toHaveValue(tomorrow);
  await expect(region.getByLabel("Управление для сдачи дня", { exact: true })).toHaveValue("9102");
  expect(new URL(page.url()).searchParams.has("businessDate")).toBe(false);
  expect(new URL(page.url()).searchParams.get("submitDivision")).toBe("9102");
  expect(new URL(page.url()).searchParams.get("search")).toBe("retained");
  expect(network.writes).toEqual([]);
});

test("live admin chooses a server-authorized unit without receiving a chief role", async ({ page }) => {
  await signIn(page);
  const api = process.env.SMOKE_API!;
  const authenticated = await page.request.post(`${api}/api/token/`, {
    data: { username: process.env.SMOKE_USER ?? "admin", password: process.env.SMOKE_PASSWORD! },
  });
  expect(authenticated.ok()).toBe(true);
  const headers = { Authorization: `Bearer ${(await authenticated.json()).access}` };
  const permitted = await page.request.get(`${api}${DIVISIONS}?business_date=${DAY}`, { headers });
  expect(permitted.ok()).toBe(true);
  const options = (await permitted.json()).results.filter((row: typeof units[number]) => row.can_submit === true && row.division_type === "directorate");
  expect(options.length).toBeGreaterThan(1);
  expect(options.every((row: typeof units[number]) => row.can_correct === true)).toBe(true);
  await page.goto(`/statuses?businessDate=${DAY}`);
  const region = page.getByRole("region", { name: "Сдача дня за управление", exact: true });
  const selector = region.getByLabel("Управление для сдачи дня", { exact: true });
  await expect(selector).toBeVisible();
  await expect(selector).toHaveValue("");
  await expect(region.getByRole("button", { name: "Сдать день", exact: true })).toHaveCount(0);
  await expect(region.getByText(/область не назначена/)).toHaveCount(0);
  await selector.selectOption(options[0].id);
  await expect(region.getByRole("region", { name: "Расход на дату", exact: true })).toBeVisible();
  await expect(region.getByLabel("Числа расхода", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`submitDivision=${options[0].id}`));
});

test("custom scoped permission auto-selects only the unit allowed by the server", async ({ page }) => {
  await signIn(page);
  const network = await metadata(page, ["status.view", "daily_report.mark_update"], [units[0], { ...units[1], can_submit: false }, units[2]], [
    { code: "CUSTOM_DAY_OPERATOR", name: "Разрешённый оператор", scope_division_id: 9101, scope_division_name: units[0].name },
  ]);
  await page.goto(`/statuses?businessDate=${DAY}`);
  const region = page.getByRole("region", { name: "Сдача дня за управление", exact: true });
  await expect(region.getByLabel("Управление для сдачи дня", { exact: true })).toHaveValue(units[0].id);
  await expect(region.getByRole("button", { name: "Сдать день", exact: true })).toBeVisible();
  await expect(region.getByText(/Обратитесь к администратору/)).toHaveCount(0);
  await region.getByRole("button", { name: "Сдать день", exact: true }).click();
  await expect(region.getByText("Сдать расход за 28.10.2026? Сотрудников по списку: 2.", { exact: false })).toBeVisible();
  expect(network.reads.length).toBeGreaterThan(0);
  expect(network.reads.every(url => new URL(url).searchParams.get("division_id") === "9101")).toBe(true);
  expect(network.writes).toEqual([]);
});

test("a denied URL target never loads its submissions or silently switches units", async ({ page }) => {
  await signIn(page);
  const network = await metadata(page, ["status.view", "daily_report.mark_update"], [units[0], units[2]], [
    { code: "DIRECTORATE_HEAD", name: "Начальник", scope_division_id: 9103, scope_division_name: units[2].name },
  ]);
  await page.goto(`/statuses?businessDate=${DAY}&submitDivision=9103`);
  const region = page.getByRole("region", { name: "Сдача дня за управление", exact: true });
  await expect(region.getByText("Выбранное управление недоступно для сдачи дня. Выберите доступное управление.", { exact: true })).toBeVisible();
  await expect(region.getByRole("button", { name: "Сдать день", exact: true })).toHaveCount(0);
  expect(network.reads).toEqual([]);
  expect(network.writes).toEqual([]);
});

test("read-only status access does not mount day submission controls or read submission targets", async ({ page }) => {
  await signIn(page);
  await metadata(page, ["status.view"]);
  let targetReads = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === DIVISIONS) targetReads += 1; });
  await page.goto(`/statuses?businessDate=${DAY}`);
  await expect(page.getByRole("heading", { name: "Управление статусами", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Сдача дня за управление", exact: true })).toHaveCount(0);
  expect(targetReads).toBe(0);
});

test("failed target metadata does not reuse a URL scope or offer submission", async ({ page }) => {
  await signIn(page);
  const network = await metadata(page, ["*"]);
  await page.route(`**${DIVISIONS}**`, route => route.fulfill({ status: 403, json: { detail: "PERMISSION_DENIED" } }));
  await page.goto(`/statuses?businessDate=${DAY}&submitDivision=9101`);
  const region = page.getByRole("region", { name: "Сдача дня за управление", exact: true });
  await expect(region.getByText("Не удалось загрузить доступные управления.", { exact: true })).toBeVisible();
  await expect(region.getByRole("button", { name: "Сдать день", exact: true })).toHaveCount(0);
  expect(network.reads).toEqual([]);
});

test("changing the unit clears confirmation and changing the date rechecks its permission", async ({ page }) => {
  await signIn(page);
  const network = await metadata(page, ["*"]);
  let releaseReport!: () => void;
  const reportGate = new Promise<void>(resolve => { releaseReport = resolve; });
  await page.route("**/api/operations/strength-report/**", async route => {
    const target = new URL(route.request().url()).searchParams.get("division_id");
    if (target === "9102") await reportGate;
    await route.fulfill({ json: {
      business_date: DAY, columns: ["IN_SERVICE"], column_labels: { IN_SERVICE: "В строю" },
      totals: { list_total: target === "9102" ? 7 : 2, attached: 0, columns: { IN_SERVICE: 2 } }, rows: [],
    } });
  });
  await page.goto(`/statuses?businessDate=${DAY}&submitDivision=9101`);
  const region = page.getByRole("region", { name: "Сдача дня за управление", exact: true });
  await region.getByRole("button", { name: "Сдать день", exact: true }).click();
  await expect(region.getByText("Сдать расход за 28.10.2026? Сотрудников по списку: 2.", { exact: false })).toBeVisible();
  const targetRead = page.waitForRequest(request => request.url().includes("strength-report/") && new URL(request.url()).searchParams.get("division_id") === "9102");
  await region.getByLabel("Управление для сдачи дня", { exact: true }).selectOption("9102");
  await targetRead;
  await expect(region.getByText("Сдать расход за 28.10.2026? Сотрудников по списку: 2.", { exact: false })).toHaveCount(0);
  await expect(region.getByRole("button", { name: "Сдать день", exact: true })).toHaveCount(0);
  releaseReport();
  await region.getByRole("button", { name: "Сдать день", exact: true }).click();
  await expect(region.getByText("Сдать расход за 28.10.2026? Сотрудников по списку: 7.", { exact: false })).toBeVisible();
  await page.route(`**${DIVISIONS}**`, route => route.fulfill({ json: { results: [units[0], { ...units[1], can_submit: false }] } }));
  await region.locator("#status-business-date").fill("2026-10-29");
  await expect(region.getByText("Выбранное управление недоступно для сдачи дня. Выберите доступное управление.", { exact: true })).toBeVisible();
  await expect(region.getByText("Сдать расход за 28.10.2026? Сотрудников по списку: 7.", { exact: false })).toHaveCount(0);
  await expect(region.getByRole("button", { name: "Сдать день", exact: true })).toHaveCount(0);
  expect(network.reads.every(url => new URL(url).searchParams.get("business_date") !== "2026-10-29")).toBe(true);
  expect(network.writes).toEqual([]);
});

for (const canCorrect of [false, true]) {
  test(`correction permission ${canCorrect ? "allows" : "hides"} amendment controls on a submitted day`, async ({ page }) => {
    await signIn(page);
    const permissions = ["status.view", "daily_report.mark_update", ...(canCorrect ? ["daily_report.correct"] : [])];
    const network = await metadata(page, permissions, [{ ...units[0], can_correct: canCorrect }], [
      { code: "DIRECTORATE_HEAD", name: "Начальник", scope_division_id: 9101, scope_division_name: units[0].name },
    ]);
    await page.route(`**${SUBMISSIONS}**`, route => {
      if (route.request().method() !== "GET") return route.abort();
      return route.fulfill({ json: { count: 1, results: [submittedRow] } });
    });
    await page.goto(`/statuses?businessDate=${DAY}`);
    const region = page.getByRole("region", { name: "Сдача дня за управление", exact: true });
    await expect(region.getByText("День сдан: v1", { exact: false })).toBeVisible();
    if (canCorrect) {
      await region.getByRole("button", { name: "Исправить сдачу", exact: true }).click();
      await expect(region.getByRole("form", { name: "Исправление сдачи", exact: true })).toBeVisible();
    } else {
      await expect(region.getByRole("button", { name: "Исправить сдачу", exact: true })).toHaveCount(0);
      await expect(region.getByRole("form", { name: "Исправление сдачи", exact: true })).toHaveCount(0);
    }
    expect(network.writes).toEqual([]);
  });
}

test("aggregate correction permission cannot amend outside its canonical unit scope", async ({ page }) => {
  await signIn(page);
  const network = await metadata(page, ["status.view", "daily_report.mark_update", "daily_report.correct"], [{ ...units[0], can_correct: false }]);
  await page.route(`**${SUBMISSIONS}**`, route => route.request().method() !== "GET" ? route.abort() : route.fulfill({ json: { count: 1, results: [
    submittedRow,
  ] } }));
  await page.goto(`/statuses?businessDate=${DAY}`);
  const region = page.getByRole("region", { name: "Сдача дня за управление", exact: true });
  await expect(region.getByText("День сдан: v1", { exact: false })).toBeVisible();
  await expect(region.getByRole("button", { name: "Исправить сдачу", exact: true })).toHaveCount(0);
  expect(network.writes).toEqual([]);
});

test("correction scope revocation hides an already open form during metadata refresh", async ({ page }) => {
  await signIn(page);
  const network = await metadata(page, ["*"] , [units[0]]);
  await page.route(`**${SUBMISSIONS}**`, route => route.request().method() !== "GET" ? route.abort() : route.fulfill({ json: { count: 1, results: [
    submittedRow,
  ] } }));
  await page.goto(`/statuses?businessDate=${DAY}`);
  const region = page.getByRole("region", { name: "Сдача дня за управление", exact: true });
  await region.getByRole("button", { name: "Исправить сдачу", exact: true }).click();
  await expect(region.getByRole("form", { name: "Исправление сдачи", exact: true })).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${DIVISIONS}**`, async route => {
    await gate;
    await route.fulfill({ json: { results: [{ ...units[0], can_correct: false }] } });
  });
  const refreshing = page.waitForRequest(request => new URL(request.url()).pathname === DIVISIONS);
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await refreshing;
  await expect(region.getByRole("form", { name: "Исправление сдачи", exact: true })).toHaveCount(0);
  await expect(region.getByRole("button", { name: "Исправить сдачу", exact: true })).toHaveCount(0);
  release();
  await expect(region.getByText("День сдан: v1", { exact: false })).toBeVisible();
  await expect(region.getByRole("button", { name: "Исправить сдачу", exact: true })).toHaveCount(0);
  expect(network.writes).toEqual([]);
});
