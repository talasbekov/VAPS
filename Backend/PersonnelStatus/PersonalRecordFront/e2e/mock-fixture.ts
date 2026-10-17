import { test as base, expect } from '@playwright/test'

// Playwright 1.56 otherwise cannot route service-worker-owned passthroughs.
// Set before browser launch so the boundary also covers MSW's network fetches.
if (process.env.SMOKE_MOCK_APP) process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1'

// MSW answers its own requests before browser network routing. A mutation that
// reaches this route was not mocked and must never fall through to the backend.
export const test = base.extend<{ mockNetworkBoundary: void }>({
  mockNetworkBoundary: [async ({ context }, use) => {
    const unmockedWrites: string[] = []
    await context.route('**/api/**', async route => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || path.startsWith('/api/auth/')) {
        await route.continue()
        return
      }
      unmockedWrites.push(`${request.method()} ${path}`)
      await route.abort('blockedbyclient')
    })
    await use()
    expect(unmockedWrites, 'Mock mutations must be handled by MSW, never by the live API').toEqual([])
  }, { auto: true }],
})

export { expect }
