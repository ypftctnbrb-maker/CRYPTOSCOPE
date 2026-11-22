import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { fixture, instruments, restEndpoints, scenarios, wsPlan } from './fixtures.mjs';

const hostname = '127.0.0.1';
const files = new Map([
  ['/', ['page.html', 'text/html']], ['/style.css', ['style.css', 'text/css']],
  ...['ui', 'probe', 'fixtures', 'exports'].map(name => ['/' + name + '.mjs', [name + '.mjs', 'text/javascript']]),
]);

const json = (res, status, data) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
const listen = (server, port) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, hostname, () => resolve('http://' + hostname + ':' + server.address().port));
});

export async function startMock({ pagePort = 8780, apiPort = 8781, unitMs = 250 } = {}) {
  let pageOrigin, apiOrigin;
  const api = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const [, prefix, endpoint] = url.pathname.split('/');
    const scenario = url.searchParams.get('scenario');
    const instrument = url.searchParams.get('instrument');
    if (req.method !== 'GET' || prefix !== 'rest' || !restEndpoints.includes(endpoint) ||
        scenarios[scenario]?.transport !== 'rest' || !Object.hasOwn(instruments, instrument)) return json(res, 404, {});
    if (!['rest-451-no-cors', 'rest-no-cors', 'rest-opaque'].includes(scenario)) {
      res.setHeader('Access-Control-Allow-Origin', pageOrigin);
    }
    if (scenario === 'rest-timeout') return;
    if (scenario.startsWith('rest-451-')) return json(res, 451, { error: 'synthetic HTTP 451' });
    if (instrument === 'spot' && ['oi', 'funding'].includes(endpoint)) return json(res, 404, {});
    json(res, 200, fixture(endpoint));
  });

  const ws = new WebSocketServer({ noServer: true });
  api.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const scenario = url.searchParams.get('scenario');
    const attempt = url.searchParams.get('attempt');
    if (req.headers.origin !== pageOrigin || url.pathname !== '/ws' ||
        scenarios[scenario]?.transport !== 'ws' || !['initial', 'retry'].includes(attempt)) return socket.destroy();
    ws.handleUpgrade(req, socket, head, peer => {
      const timers = wsPlan(scenario, attempt).map(([tick, event]) => setTimeout(() => {
        if (event.drop) return peer.terminate();
        if (event.close) return peer.close(event.close, 'synthetic close');
        peer.send(JSON.stringify(event));
      }, tick * unitMs));
      if (['ws-normal', 'ws-no-trades', 'ws-no-ack'].includes(scenario)) {
        const heartbeat = setInterval(() => peer.send('{"kind":"heartbeat"}'), 5000);
        peer.once('close', () => clearInterval(heartbeat));
      }
      peer.once('close', () => timers.forEach(clearTimeout));
      peer.on('error', () => {});
    });
  });

  const page = createServer(async (req, res) => {
    if (req.url === '/config.json') return json(res, 200, { apiOrigin });
    const entry = files.get(req.url);
    if (!entry || req.method !== 'GET') return json(res, 404, {});
    try {
      const [file, type] = entry;
      const policy = "default-src 'self'; connect-src 'self' " + apiOrigin + ' ' + apiOrigin.replace('http:', 'ws:') +
        "; object-src 'none'; base-uri 'none'; form-action 'none'";
      const body = await readFile(new URL(file, import.meta.url));
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Content-Security-Policy': policy });
      res.end(body);
    } catch {
      json(res, 500, { error: 'fixture-file-unavailable' });
    }
  });
  const stopServer = server => new Promise(resolve => {
    if (!server.listening) return resolve();
    server.close(resolve);
    server.closeAllConnections();
  });
  const stop = async () => {
    for (const peer of ws.clients) peer.terminate();
    ws.close();
    await Promise.all([stopServer(page), stopServer(api)]);
  };
  try {
    apiOrigin = await listen(api, apiPort);
    pageOrigin = await listen(page, pagePort);
    return { pageOrigin, apiOrigin, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mock = await startMock();
  console.log('MOCK only:', mock.pageOrigin, 'API:', mock.apiOrigin);
}
