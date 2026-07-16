// @vitest-environment jsdom
// Story 10.5 — blob-скачивание вложений (Task 5/6): разбор Content-Disposition
// (filename* приоритетнее filename), fallback-имя, канал ошибок через
// parseErrorResponse (не-2xx → типизированный ApiError, сеть → NetworkError),
// blob → objectURL → <a download> → revoke.
import '@testing-library/jest-dom/vitest'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadAttachment, parseContentDispositionFilename } from './download'
import { ApiError, NetworkError } from './errors'
import { server } from './testing/server'

const ATTACHMENT_ID = 'aaaaaaaa-0000-0000-0000-00000000000a'
const DOWNLOAD_PATH = `*/api/documents/attachments/${ATTACHMENT_ID}/download/`
const DOCX_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// jsdom не реализует URL.createObjectURL/revokeObjectURL — стаб per-file.
const createObjectURL = vi.fn(() => 'blob:mock-url')
const revokeObjectURL = vi.fn()
URL.createObjectURL = createObjectURL
URL.revokeObjectURL = revokeObjectURL

/** Имена, с которыми кликнулись <a download> (jsdom не навигирует). */
let clickedDownloads: string[] = []

beforeEach(() => {
  clickedDownloads = []
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clickedDownloads.push(this.download)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function serveDownload(headers: Record<string, string>) {
  server.use(
    http.get(
      DOWNLOAD_PATH,
      () =>
        new HttpResponse('docx-bytes', {
          status: 200,
          headers: { 'Content-Type': DOCX_TYPE, ...headers },
        }),
    ),
  )
}

describe('parseContentDispositionFilename', () => {
  it('null / без filename → null', () => {
    expect(parseContentDispositionFilename(null)).toBeNull()
    expect(parseContentDispositionFilename('inline')).toBeNull()
    expect(parseContentDispositionFilename('attachment')).toBeNull()
  })

  it('filename="..." в кавычках', () => {
    expect(
      parseContentDispositionFilename('attachment; filename="report.docx"'),
    ).toBe('report.docx')
  })

  it('filename без кавычек', () => {
    expect(
      parseContentDispositionFilename('attachment; filename=report.docx'),
    ).toBe('report.docx')
  })

  it("filename*=utf-8'' с процент-кодированием (кириллица бэка) декодируется", () => {
    expect(
      parseContentDispositionFilename(
        "attachment; filename*=utf-8''%D1%80%D0%B0%D1%81%D1%85%D0%BE%D0%B4.docx",
      ),
    ).toBe('расход.docx')
  })

  it('filename* приоритетнее filename (порядок в заголовке не важен)', () => {
    expect(
      parseContentDispositionFilename(
        'attachment; filename="fallback.docx"; ' +
          "filename*=utf-8''%D1%80%D0%B0%D1%81%D1%85%D0%BE%D0%B4.docx",
      ),
    ).toBe('расход.docx')
  })

  it("filename* с language-tag (utf-8'ru'…) и смешанным регистром charset — RFC 5987", () => {
    expect(
      parseContentDispositionFilename(
        "attachment; filename*=utf-8'ru'%D1%80%D0%B0%D1%81%D1%85%D0%BE%D0%B4.docx",
      ),
    ).toBe('расход.docx')
    expect(
      parseContentDispositionFilename(
        "attachment; filename*=Utf-8''%D1%80%D0%B0%D1%81%D1%85%D0%BE%D0%B4.docx",
      ),
    ).toBe('расход.docx')
  })

  it('битое процент-кодирование filename* → null от этого канала, filename берётся', () => {
    expect(
      parseContentDispositionFilename(
        "attachment; filename=\"ok.docx\"; filename*=utf-8''%ZZ%GG",
      ),
    ).toBe('ok.docx')
  })
})

describe('downloadAttachment', () => {
  it('2xx: blob → objectURL → клик <a download> с именем из Content-Disposition → revoke', async () => {
    serveDownload({
      'Content-Disposition':
        "attachment; filename*=utf-8''%D1%80%D0%B0%D1%81%D1%85%D0%BE%D0%B4.docx",
    })
    await downloadAttachment(ATTACHMENT_ID, 'fallback.docx')

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(clickedDownloads).toEqual(['расход.docx'])
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('без Content-Disposition → переданное fallback-имя', async () => {
    serveDownload({})
    await downloadAttachment(ATTACHMENT_ID, 'расход_2026-07-08_исх-1.docx')

    expect(clickedDownloads).toEqual(['расход_2026-07-08_исх-1.docx'])
  })

  it('не-2xx → reject типизированным ApiError (parseErrorResponse), клика нет', async () => {
    server.use(
      http.get(DOWNLOAD_PATH, () =>
        HttpResponse.json(
          {
            error_code: 'ENTITY_NOT_FOUND',
            message: 'Вложение не найдено.',
            details: {},
            request_id: null,
            timestamp: '2026-07-16T09:00:00+05:00',
          },
          { status: 404 },
        ),
      ),
    )
    await expect(
      downloadAttachment(ATTACHMENT_ID, 'fallback.docx'),
    ).rejects.toMatchObject({ errorCode: 'ENTITY_NOT_FOUND', status: 404 })
    await expect(
      downloadAttachment(ATTACHMENT_ID, 'fallback.docx'),
    ).rejects.toBeInstanceOf(ApiError)
    expect(clickedDownloads).toEqual([])
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('обрыв сети (HTTP-ответа нет) → NetworkError, не вторичное исключение', async () => {
    server.use(http.get(DOWNLOAD_PATH, () => HttpResponse.error()))
    await expect(
      downloadAttachment(ATTACHMENT_ID, 'fallback.docx'),
    ).rejects.toBeInstanceOf(NetworkError)
    expect(clickedDownloads).toEqual([])
  })
})
