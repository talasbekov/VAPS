import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.skip(!process.env.SMOKE_PASSWORD, "Set SMOKE_PASSWORD for the local test account.");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator("#username").fill(process.env.SMOKE_USER ?? "admin");
  await page.locator("#password").fill(process.env.SMOKE_PASSWORD!);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.locator("#username")).not.toBeVisible({ timeout: 30_000 });
});

test("dictionary preserves input and supports both similarity decisions", async ({ page }) => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
  const code = `UITEST_${suffix}`;
  const name = `Проверка ${randomUUID()}`;
  const createdIds: string[] = [];
  try {
    await page.goto("/security-ops/dictionaries/RETURN_REASONS/");
    await expect(page.getByRole("columnheader", { name: "Последнее изменение" })).toBeVisible();
    await page.locator("#entry-code").fill(code);
    await page.getByRole("button", { name: "Добавить", exact: true }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.locator("#entry-code")).toHaveValue(code);
    await page.locator("#entry-label").fill(name);
    const created = page.waitForResponse((r) => r.url().includes("/RETURN_REASONS/entries/") && r.request().method() === "POST" && r.status() === 201);
    await page.getByRole("button", { name: "Добавить", exact: true }).click();
    createdIds.push((await (await created).json()).id);
    await expect(page.getByRole("row").filter({ hasText: code })).toBeVisible();
    await expect(page.locator("#entry-code")).toHaveValue("");
    await page.locator("#entry-code").fill(`${code}_SECOND`);
    await page.locator("#entry-label").fill(name.toUpperCase());
    await page.getByRole("button", { name: "Добавить", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Найдены похожие записи" })).toBeVisible();
    await page.getByRole("button", { name: "Использовать существующую", exact: true }).first().click();
    await expect(page.getByRole("dialog", { name: "Найдены похожие записи" })).not.toBeVisible();
    await expect(page.locator("#entry-code")).toHaveValue("");
    await expect(page.getByRole("row").filter({ hasText: `${code}_SECOND` })).toHaveCount(0);
    await page.locator("#entry-code").fill(`${code}_SECOND`);
    await page.locator("#entry-label").fill(name);
    await page.getByRole("button", { name: "Добавить", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Найдены похожие записи" })).toBeVisible();
    const confirmed = page.waitForResponse((r) => r.url().includes("/RETURN_REASONS/entries/") && r.request().method() === "POST" && r.status() === 201);
    await page.getByRole("button", { name: "Всё равно создать", exact: true }).click();
    createdIds.push((await (await confirmed).json()).id);
    await expect(page.getByRole("row").filter({ hasText: `${code}_SECOND` })).toBeVisible();
    await page.screenshot({ path: "test-results/uc-ref-adm/dictionary-review.png", fullPage: true });
  } finally {
    for (const createdId of createdIds) {
      const session = await (await page.request.get("/api/auth/session/")).json();
      const response = await page.request.delete(`/api/ops/dictionaries/entries/${createdId}/`, {
        headers: { Authorization: `Bearer ${session.user.accessToken}` },
      });
      expect(response.status()).toBe(204);
    }
  }
});

test("unified registry, geographic dictionaries and account employee picker", async ({ page }) => {
  await page.goto("/security-ops/dictionaries/");
  await page.getByRole("textbox", { name: "Поиск справочников" }).fill("страны");
  await expect(page.getByRole("link", { name: /^Страны/ })).toBeVisible();
  await page.getByRole("link", { name: /^Страны/ }).click();
  await expect(page.getByRole("columnheader", { name: "Наименование (KZ)" })).toBeVisible();
  await page.getByRole("button", { name: "Добавить запись", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Добавление", exact: true })).toBeVisible();
  await expect(page.locator("#geo-code")).toBeVisible();
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await page.goto("/security-ops/dictionaries/personnel/positions/");
  await expect(page.getByRole("columnheader", { name: "Ссылок", exact: true })).toBeVisible();
  await page.goto("/settings/users/");
  await page.getByRole("textbox", { name: "Поиск по учётным записям" }).fill(process.env.SMOKE_USER ?? "admin");
  await page.getByRole("button", { name: process.env.SMOKE_USER ?? "admin", exact: true }).click();
  await expect(page.locator("#account-employee")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Поиск сотрудника для учётной записи" })).toBeVisible();
  await page.screenshot({ path: "test-results/uc-ref-adm/account-link.png", fullPage: true });
});
