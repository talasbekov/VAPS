const http = require('node:http');
const path = require('node:path');
const front = path.resolve(__dirname, '../PersonnelStatus/PersonalRecordFront');
const proxy = require(path.join(front, 'node_modules/next/dist/compiled/http-proxy')).createProxyServer({
  target: 'http://127.0.0.1:3346', changeOrigin: false,
});
proxy.on('error', (error, request, response) => {
  console.error('Local proxy error:', error.code || error.name);
  if (response && response.writeHead) { response.writeHead(502); response.end('Local portal unavailable'); }
  else if (response && response.destroy) response.destroy();
});
const server = http.createServer((request, response) => {
  const route = new URL(request.url, 'http://127.0.0.1:3345').pathname;
  proxy.web(request, response, route.startsWith('/media/employees/photos/')
    ? { target: 'http://127.0.0.1:18348', changeOrigin: false }
    : {});
});
server.on('upgrade', (request, socket, head) => {
  if (!request.url.startsWith('/ws/')) { socket.destroy(); return; }
  proxy.ws(request, socket, head, { target: 'ws://127.0.0.1:18345', changeOrigin: true });
});
server.listen(3345, '127.0.0.1', () => console.log('Local portal proxy ready at http://127.0.0.1:3345'));
