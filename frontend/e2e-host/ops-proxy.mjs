// Прозрачный префикс-прокси host-прогона (Этап M2): общие e2e-mock спеки ходят
// на корневые пути ('/security-events'), а SPA внутри PersonalRecordFront живёт
// на /ops/*. Прокси добавляет префикс ко всем НЕ-ассетным путям; ассеты Next и
// worker проходят как есть. Поднимается webServer-ом playwright.host.config.ts.
import http from 'node:http'

const UPSTREAM = { host: 'localhost', port: Number(process.env.UPSTREAM_PORT ?? 3107) }
const PROXY_PORT = Number(process.env.PROXY_PORT ?? 3108)
const PASSTHROUGH = /^\/(_next|__next|mockServiceWorker\.js|favicon|ops\/|ops$)/

const server = http.createServer((req, res) => {
  const path = PASSTHROUGH.test(req.url ?? '/') ? req.url : '/ops' + req.url
  const proxied = http.request(
    {
      ...UPSTREAM,
      path,
      method: req.method,
      headers: { ...req.headers, host: `localhost:${UPSTREAM.port}` },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    },
  )
  proxied.on('error', () => {
    res.writeHead(502)
    res.end('ops-proxy: upstream error')
  })
  req.pipe(proxied)
})

server.listen(PROXY_PORT, () => {
  console.log(`ops-proxy: ${PROXY_PORT} -> ${UPSTREAM.port}/ops`)
})
