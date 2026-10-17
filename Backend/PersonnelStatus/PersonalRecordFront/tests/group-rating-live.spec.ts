import { test, expect } from "@playwright/test";

// This test writes only to a separately provisioned, disposable test event.
test.skip(!process.env.GROUP_RATING_TEST_EVENT || !process.env.SMOKE_PASSWORD,
  "Provide an isolated group evaluation event and test credentials.");

test("collective evaluation saves through the real API and keeps its roster on correction", async ({ page }) => {
  const csrf = await (await page.request.get("/api/auth/csrf/")).json();
  const signedIn = await page.request.post("/api/auth/callback/credentials/", {
    form: { csrfToken: csrf.csrfToken, username: process.env.SMOKE_USER ?? "admin",
      password: process.env.SMOKE_PASSWORD!, json: "true" },
  });
  expect(signedIn.ok()).toBe(true);
  expect((await signedIn.json()).url).not.toContain("error=");
  const api = process.env.SMOKE_API ?? process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3300";
  const authenticated = await page.request.post(`${api}/api/token/`, {
    data: { username: process.env.SMOKE_USER ?? "admin", password: process.env.SMOKE_PASSWORD! },
  });
  expect(authenticated.ok()).toBe(true);
  const apiHeaders = { Authorization: `Bearer ${(await authenticated.json()).access}` };
  const event = process.env.GROUP_RATING_TEST_EVENT!;
  const workspaceResponse = await page.request.get(`${api}/api/ops/evaluation-workspace/?event=${encodeURIComponent(event)}`, { headers: apiHeaders });
  expect(workspaceResponse.ok()).toBe(true);
  const workspace = await workspaceResponse.json();
  const item = workspace.pending.find((entry: { targetGroupId: string | null }) => entry.targetGroupId !== null);
  expect(item, "Provision a pending group task in the isolated test event").toBeTruthy();
  await page.goto(`/security-ops/ratings/workspace?event=${encodeURIComponent(event)}`);
  await page.getByRole("button", { name: `Оценить: ${item.targetSafeLabel}`, exact: true }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Отправить оценку", exact: true }) });
  await expect(form.getByText("Плановый состав", { exact: true })).toBeVisible();
  await expect(form.getByText("Фактический состав", { exact: true })).toBeVisible();
  for (const member of item.groupSnapshot.actualMembers) {
    await expect(form.getByText(member.safeLabel, { exact: true }).first()).toBeVisible();
    expect(member.unitSafeLabel, "Canonical staffing must label the real roster").toBeTruthy();
    await expect(form.getByText(`· ${member.unitSafeLabel}`, { exact: true }).first()).toBeVisible();
  }
  await form.getByLabel("Оценка", { exact: true }).selectOption("9");
  await form.getByLabel("Основание", { exact: true }).selectOption("EXECUTION_OF_DUTIES");
  const submittedResponse = page.waitForResponse(response => response.url().includes(`/evaluation-work-items/${item.id}/submit/`) && response.request().method() === "POST");
  await form.getByRole("button", { name: "Отправить оценку", exact: true }).click();
  const submitted = await submittedResponse;
  expect(submitted.status()).toBe(201);
  const result = await submitted.json();
  expect(result.submitted.groupSnapshot).toEqual(item.groupSnapshot);
  await page.getByRole("tab", { name: "Отправленные мной", exact: true }).click();
  await page.getByRole("button", { name: `Открыть отправленную оценку: ${item.targetSafeLabel}`, exact: true }).click();
  await expect(page.getByText("Плановый состав", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Исправить оценку", exact: true }).click();
  await page.getByLabel("Новая оценка", { exact: true }).selectOption("10");
  await page.getByLabel("Причина исправления (обязательна)", { exact: true }).fill("Проверка коллективного результата на отдельном стенде");
  await page.getByRole("button", { name: "Показать изменения", exact: true }).click();
  const correctionResponse = page.waitForResponse(response => response.url().includes(`/evaluation-work-items/${item.id}/correct/`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Подтвердить исправление", exact: true }).click();
  const corrected = await correctionResponse;
  expect(corrected.status()).toBe(201);
  expect((await corrected.json()).submitted.groupSnapshot).toEqual(item.groupSnapshot);
  await page.reload();
  const detailResponse = await page.request.get(`${api}/api/ops/evaluation-work-items/${item.id}/detail/`, { headers: apiHeaders });
  expect(detailResponse.ok()).toBe(true);
  const detail = await detailResponse.json();
  expect(detail.submitted.score).toBe(10);
  expect(detail.submitted.groupSnapshot).toEqual(item.groupSnapshot);
  expect(detail.chain).toHaveLength(2);
  await page.goto(`/security-ops/ratings/evaluations?event=${encodeURIComponent(workspace.selectedEvent.number)}&direction=SENIOR_TO_GROUP&search=${encodeURIComponent(item.targetSafeLabel)}`);
  const collectiveRows = page.getByRole("row").filter({ hasText: item.targetSafeLabel });
  await expect(collectiveRows).toHaveCount(2);
  await expect(collectiveRows.first().getByText("Учитывается отдельно", { exact: true })).toBeVisible();
  await expect(collectiveRows.first().getByText("Коллективная запись", { exact: true })).toBeVisible();
  await expect(collectiveRows.first().getByText(item.targetSafeUnitLabel, { exact: true })).toBeVisible();
  await expect(collectiveRows.getByRole("link", { name: "Открыть агрегат", exact: true })).toHaveCount(0);
});
