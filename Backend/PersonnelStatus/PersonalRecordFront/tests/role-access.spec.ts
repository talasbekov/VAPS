import { expect, test, type APIRequestContext } from "@playwright/test";

async function headersFor(request: APIRequestContext, username: string) {
  const password = process.env.ROLE_ACCOUNTS_PASSWORD;
  if (!password) throw new Error("Set ROLE_ACCOUNTS_PASSWORD for the dedicated role test accounts.");
  const response = await request.post("/api/token/", { data: { username, password } });
  expect(response.status(), `Role test account ${username} must be available`).toBe(200);
  const { access } = await response.json();
  expect(access).toEqual(expect.any(String));
  return { Authorization: `Bearer ${access}` };
}

test("anonymous users cannot read dictionaries or accounts", async ({ request }) => {
  for (const path of ["/api/ops/dictionaries/", "/api/operations/accounts/"]) {
    const response = await request.get(path);
    expect([401, 403]).toContain(response.status());
  }
});

test("reference administrator reads dictionaries and cannot administer accounts", async ({ request }) => {
  const headers = await headersFor(request, process.env.REFERENCE_TEST_USER ?? "role_reference_admin");
  expect((await request.get("/api/ops/dictionaries/", { headers })).status()).toBe(200);
  expect((await request.get("/api/operations/accounts/", { headers })).status()).toBe(403);
});

test("employee cannot administer accounts or mutate dictionary values", async ({ request }) => {
  const headers = await headersFor(request, process.env.EMPLOYEE_TEST_USER ?? "role_employee");
  expect((await request.get("/api/operations/accounts/", { headers })).status()).toBe(403);
  // The nonexistent ID keeps this denial check from changing live records.
  expect((await request.delete("/api/ops/dictionaries/entries/0/", { headers })).status()).toBe(403);
});
