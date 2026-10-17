import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { uniqueBusinessDate } from './business-date'
import { createOwnEvent, standCall } from './prepare-events'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const PHOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')

function blankPdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(body)
  body += 'xref\n0 4\n0000000000 65535 f \n'
  offsets.slice(1).forEach((offset) => { body += `${String(offset).padStart(10, '0')} 00000 n \n` })
  body += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body)
}

async function signIn(page: Page, username: string, password: string): Promise<void> {
  const csrf = (await (await page.request.get(`${APP}/api/auth/csrf/`)).json()).csrfToken
  const signedIn = await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: { csrfToken: csrf, username, password, json: 'true' } })
  expect(signedIn.ok()).toBeTruthy()
}

test.describe('RECON material uploads', () => {
  test.skip(!LIVE, 'requires the isolated live stand with SMOKE_LIVE=1')

  test('checklist photo and object PDF persist, download exact bytes and remove independently', async ({ page, request, browser }) => {
    const readerUser = process.env.RECON_READER_USER
    const readerPassword = process.env.RECON_READER_PASSWORD
    if (!readerUser || !readerPassword) throw new Error('RECON_READER_USER and RECON_READER_PASSWORD must name the isolated event.view-only reader')
    const authenticated = await request.post(`${API}/api/token/`, { data: { username: STAND_USERNAME, password: STAND_PASSWORD } })
    expect(authenticated.ok()).toBeTruthy()
    const token = (await authenticated.json()).access as string
    const event = await createOwnEvent(standCall(token), token, { name: 'RECON materials lifecycle', businessDate: uniqueBusinessDate() })
    const visit = event.visitObjects[0]
    const checklistItem = visit.reconChecklist[0]
    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto(`${APP}/security-ops/events/${event.id}/`)
    const materials = page.getByRole('region', { name: 'Материалы рекогносцировки' })
    await expect(materials).toBeVisible()
    await materials.getByLabel('К чему прикрепить материал').selectOption(checklistItem.id)
    await materials.getByLabel('Файл материала').setInputFiles({ name: 'inspection-photo.png', mimeType: 'image/png', buffer: PHOTO })
    await materials.getByRole('button', { name: 'Загрузить', exact: true }).click()
    const photo = materials.locator('[data-slot="recon-material-row"]').filter({ hasText: 'inspection-photo.png' })
    await expect(photo).toContainText(checklistItem.label)
    await materials.getByLabel('К чему прикрепить материал').selectOption('')
    await materials.getByLabel('Файл материала').setInputFiles({ name: 'object-plan.pdf', mimeType: 'application/pdf', buffer: blankPdf() })
    await materials.getByRole('button', { name: 'Загрузить', exact: true }).click()
    const plan = materials.locator('[data-slot="recon-material-row"]').filter({ hasText: 'object-plan.pdf' })
    await expect(plan).toBeVisible()
    await page.reload()
    await expect(photo).toBeVisible()
    await expect(plan).toBeVisible()
    const downloadStarted = page.waitForEvent('download')
    await photo.getByRole('button', { name: 'Скачать' }).click()
    const download = await downloadStarted
    expect(download.suggestedFilename()).toBe('inspection-photo.png')
    const path = await download.path()
    expect(path).not.toBeNull()
    expect(await readFile(path!)).toEqual(PHOTO)
    const readerContext = await browser.newContext()
    try {
      const readerPage = await readerContext.newPage()
      await signIn(readerPage, readerUser, readerPassword)
      await readerPage.goto(`${APP}/security-ops/events/${event.id}/`)
      const readerMaterials = readerPage.getByRole('region', { name: 'Материалы рекогносцировки' })
      await expect(readerMaterials).toBeVisible()
      await expect(readerMaterials.getByRole('button', { name: 'Загрузить', exact: true })).toHaveCount(0)
      await expect(readerMaterials.getByRole('button', { name: 'Удалить' })).toHaveCount(0)
      const readerPlan = readerMaterials.locator('[data-slot="recon-material-row"]').filter({ hasText: 'object-plan.pdf' })
      await expect(readerPlan.getByRole('button', { name: 'Скачать' })).toBeEnabled()
      const readOnlyDownload = readerPage.waitForEvent('download')
      await readerPlan.getByRole('button', { name: 'Скачать' }).click()
      const readOnlyPath = await (await readOnlyDownload).path()
      expect(await readFile(readOnlyPath!)).toEqual(blankPdf())
    } finally {
      await readerContext.close()
    }
    await page.reload()
    await photo.getByRole('button', { name: 'Удалить' }).click()
    await expect(photo).toHaveCount(0)
    await expect(plan).toBeVisible()
    await page.reload()
    await expect(photo).toHaveCount(0)
    await expect(plan).toBeVisible()
  })
})
