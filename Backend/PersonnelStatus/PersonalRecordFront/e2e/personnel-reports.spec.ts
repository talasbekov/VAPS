import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { STAND_PASSWORD, STAND_USERNAME } from "./stand-credentials";

const LIVE = process.env.SMOKE_LIVE === "1";
const API = process.env.SMOKE_API ?? "http://127.0.0.1:8100";

function zipEntry(archive: Buffer, filename: string): string {
  let end = archive.length - 22;
  while (end >= Math.max(0, archive.length - 65_557) && archive.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("The export is not a ZIP workbook");
  let position = archive.readUInt32LE(end + 16);
  for (let entry = 0; entry < archive.readUInt16LE(end + 10); entry++) {
    const nameLength = archive.readUInt16LE(position + 28);
    const extraLength = archive.readUInt16LE(position + 30);
    const commentLength = archive.readUInt16LE(position + 32);
    const name = archive.subarray(position + 46, position + 46 + nameLength).toString("utf8");
    if (name === filename) {
      const method = archive.readUInt16LE(position + 10);
      const size = archive.readUInt32LE(position + 20);
      const local = archive.readUInt32LE(position + 42);
      const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
      const compressed = archive.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(compressed) : compressed).toString("utf8");
    }
    position += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Workbook entry ${filename} is missing`);
}

function csvRecords(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (character === ";" && !quoted) { row.push(value); value = ""; }
    else if ((character === "\r" || character === "\n") && !quoted) {
      row.push(value); rows.push(row); row = []; value = "";
      if (character === "\r" && text[index + 1] === "\n") index++;
    } else value += character;
  }
  if (value !== "" || row.length > 0) { row.push(value); rows.push(row); }
  return rows;
}

test("personnel reports show real scoped rows and download full exports", async ({ page }) => {
  test.skip(!LIVE, "requires a live isolated stand with SMOKE_LIVE=1");
  const token = await page.request.post(`${API}/api/token/`, {
    data: { username: STAND_USERNAME, password: STAND_PASSWORD },
  });
  expect(token.status()).toBe(200);
  const { access } = await token.json() as { access: string };
  const staffingResponse = await page.request.get(`${API}/api/reports/reports/staffing/`, {
    headers: { Authorization: `Bearer ${access}` },
  });
  expect(staffingResponse.status()).toBe(200);
  const staffing = await staffingResponse.json() as {
    count: number;
    rows: { staff_unit_id: number; employee_id: number | null; employee_name: string | null; division_id: number; division_name: string; position: string | null }[];
  };
  for (const row of staffing.rows.slice(0, 3)) {
    const source = await page.request.get(`${API}/api/staff_unit/staff-units/${row.staff_unit_id}/`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    expect(source.status(), "independent persisted staff unit").toBe(200);
    const unit = await source.json() as { id: number; division: { id: number }; position: { name: string } | null; employee: { id: number } | null };
    expect(unit.id).toBe(row.staff_unit_id);
    expect(unit.division.id).toBe(row.division_id);
    expect(unit.position?.name ?? null).toBe(row.position);
    expect(unit.employee?.id ?? null).toBe(row.employee_id);
  }
  const csrf = await page.request.get("/api/auth/csrf/");
  const { csrfToken } = await csrf.json() as { csrfToken: string };
  const login = await page.request.post("/api/auth/callback/credentials/", {
    form: { csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: "true" },
  });
  expect(login.status()).toBe(200);
  await page.goto("/reports/");
  const staffCard = page.getByRole("region", { name: "Штатное расписание" });
  const absenceCard = page.getByRole("region", { name: "Статистика отсутствий" });
  await expect(staffCard.getByRole("button", { name: "Показать штат" })).toBeEnabled();
  await staffCard.getByRole("button", { name: "Показать штат" }).click();
  await expect(staffCard.getByText(`Штат: ${staffing.count}`, { exact: false })).toBeVisible();
  if (staffing.rows.length > 0) {
    await expect(staffCard.getByRole("cell", { name: staffing.rows[0].employee_name || "—", exact: true }).first()).toBeVisible();
  }
  const excelDownload = page.waitForEvent("download");
  await staffCard.getByRole("button", { name: "Скачать Excel" }).click();
  const excel = await excelDownload;
  expect(excel.suggestedFilename()).toMatch(/\.xlsx$/);
  const excelBytes = await readFile((await excel.path())!);
  expect(excelBytes.subarray(0, 4).toString("hex")).toBe("504b0304");
  const workbookRows = await page.evaluate((xml) => {
    const document = new DOMParser().parseFromString(xml, "application/xml");
    if (document.querySelector("parsererror")) throw new Error("Invalid workbook XML");
    return [...document.querySelectorAll("sheetData > row")].map((row) =>
      [...row.querySelectorAll("c")].map((cell) => cell.querySelector("is")?.textContent ?? cell.querySelector("v")?.textContent ?? ""));
  }, zipEntry(excelBytes, "xl/worksheets/sheet1.xml"));
  expect(workbookRows.length).toBe(staffing.count + 1);
  expect(workbookRows.slice(1, staffing.rows.length + 1).map(row => Number(row[0]))).toEqual(staffing.rows.map(row => row.staff_unit_id));
  await expect(absenceCard.getByLabel("С", { exact: true })).toHaveValue(/\d{4}-\d{2}-\d{2}/);
  const loaded = page.waitForResponse((response) => response.url().includes("/api/reports/reports/absences/") && !response.url().includes("export="));
  await absenceCard.getByRole("button", { name: "Сформировать" }).click();
  const response = await loaded;
  expect(response.status()).toBe(200);
  const absences = await response.json() as { count: number; rows: { person_days: number; unique_people: number }[]; totals: { person_days: number; unique_people: number } };
  await expect(absenceCard.getByText(`Дней отсутствия: ${absences.totals.person_days}`, { exact: false })).toBeVisible();
  await expect(absenceCard.getByText(`Сотрудников: ${absences.totals.unique_people}`, { exact: false })).toBeVisible();
  const csvDownload = page.waitForEvent("download");
  await absenceCard.getByRole("button", { name: "Скачать CSV" }).click();
  const csv = await csvDownload;
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);
  const csvBytes = await readFile((await csv.path())!);
  expect(csvBytes.subarray(0, 3).toString("hex")).toBe("efbbbf");
  const records = csvRecords(csvBytes.toString("utf8").replace(/^\uFEFF/, ""));
  expect(records.length).toBe(absences.count + 1);
  expect(records[0].join(" ")).toContain("человеко-дни");
  expect(records.slice(1, absences.rows.length + 1).map(row => row.slice(3, 5))).toEqual(absences.rows.map(row => [String(row.person_days), String(row.unique_people)]));
  await absenceCard.getByLabel("С", { exact: true }).fill("2026-10-10");
  await absenceCard.getByLabel("По", { exact: true }).fill("2026-10-01");
  await expect(absenceCard.getByRole("button", { name: "Сформировать" })).toBeDisabled();
  await expect(absenceCard.getByRole("button", { name: "Скачать CSV" })).toBeDisabled();
  await expect(page.locator("main [data-slot='in-development']")).toHaveCount(0);
});

test("a real employee account cannot open personnel reports or export them", async ({ page }) => {
  test.skip(!LIVE, "requires the live copied stand");
  const password = process.env.REPORT_READER_PASSWORD ?? process.env.ROLE_ACCOUNTS_PASSWORD;
  expect(password, "existing employee account password must be configured").toBeTruthy();
  const username = process.env.REPORT_READER_USER ?? "role_employee";
  const token = await page.request.post(`${API}/api/token/`, { data: { username, password } });
  expect(token.status()).toBe(200);
  const { access } = await token.json() as { access: string };
  for (const endpoint of ["staffing/", "staffing/?export=xlsx", "absences/", "absences/?export=csv"]) {
    const response = await page.request.get(`${API}/api/reports/reports/${endpoint}`, { headers: { Authorization: `Bearer ${access}` } });
    expect(response.status(), "employee report access must remain closed").toBe(403);
  }
  const { csrfToken } = await (await page.request.get("/api/auth/csrf/")).json() as { csrfToken: string };
  expect((await page.request.post("/api/auth/callback/credentials/", { form: { csrfToken, username, password: password!, json: "true" } })).status()).toBe(200);
  await page.goto("/reports/");
  await expect(page.getByRole("heading", { name: "Доступ закрыт" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Сформировать" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Скачать Excel" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Штатное расписание" })).toHaveCount(0);
});
