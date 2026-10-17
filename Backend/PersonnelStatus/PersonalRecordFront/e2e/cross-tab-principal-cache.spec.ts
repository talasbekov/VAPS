import { expect, test, type Page } from "@playwright/test";
import { STAND_PASSWORD, STAND_USERNAME } from "./stand-credentials";

test("another tab drops administrator statistics after a real scoped account switch", async ({ context, page, request }) => {
  test.skip(process.env.SMOKE_LIVE !== "1", "requires an isolated live stand");
  const password = process.env.ROLE_ACCOUNTS_PASSWORD;
  expect(password, "limited account credential must be supplied privately").toBeTruthy();
  const api = process.env.SMOKE_API!;
  const summaries = [];
  for (const [username, secret] of [[STAND_USERNAME, STAND_PASSWORD], ["role_directorate_head", password!]]) {
    const token = await request.post(`${api}/api/token/`, { data: { username, password: secret } });
    expect(token.status()).toBe(200);
    const { access } = await token.json();
    const stats = await request.get(`${api}/api/staff_unit/statistics/`, { headers: { Authorization: `Bearer ${access}` } });
    expect(stats.status()).toBe(200);
    summaries.push((await stats.json()).summary);
  }
  const [admin, scoped] = summaries;
  expect(admin.staff_units_count).toBeGreaterThan(scoped.staff_units_count);
  console.log(`Real scoped staffing totals: admin=${admin.staff_units_count}, directorate=${scoped.staff_units_count}`);
  const login = async (tab: Page, username: string, secret: string) => {
    await tab.locator("#username").fill(username);
    await tab.locator("#password").fill(secret);
    await tab.locator('button[type="submit"]').click();
    await expect(tab.getByRole("button", { name: "Меню пользователя" })).toBeVisible();
  };
  const staffingCard = () => page.locator('[data-slot="stat-card"]').filter({ has: page.getByText("Штатных единиц", { exact: true }) }).locator('[data-slot="stat-value"]');
  await page.addInitScript(() => {
    (window as any).__principalStorageEvents = 0;
    window.addEventListener("storage", (event) => {
      if (event.key === "nextauth.message") (window as any).__principalStorageEvents++;
    });
  });
  await page.goto("/");
  await login(page, STAND_USERNAME, STAND_PASSWORD);
  await page.goto("/organization/");
  await expect(staffingCard()).toHaveText(String(admin.staff_units_count), { timeout: 20_000 });
  console.log("Administrator statistics loaded in the first tab");
  const documentMarker = await page.evaluate(() => { (window as any).__principalCacheDocument = Math.random(); return (window as any).__principalCacheDocument; });
  const other = await context.newPage();
  await other.goto("/organization/");
  await other.getByRole("button", { name: "Меню пользователя" }).click();
  await other.getByRole("menuitem", { name: "Выйти" }).click();
  await expect(other.locator("#username")).toBeVisible();
  console.log("Real second-tab signout completed");
  await login(other, "role_directorate_head", password!);
  console.log("Real scoped second-tab signin completed");
  await page.bringToFront();
  await expect.poll(async () => {
    const response = await page.request.get("/api/auth/session");
    const session = await response.json();
    return session.user?.userData?.username;
  }).toBe("role_directorate_head");
  await expect(page.getByRole("button", { name: "Меню пользователя" })).toBeVisible();
  await page.getByRole("button", { name: "Меню пользователя" }).click();
  await expect(page.getByRole("menu").getByText("role_directorate_head", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => (window as any).__principalStorageEvents)).toBeGreaterThan(0);
  await expect(staffingCard()).toHaveText(String(scoped.staff_units_count), { timeout: 10_000 });
  expect(await page.evaluate(() => (window as any).__principalCacheDocument)).toBe(documentMarker);
});
