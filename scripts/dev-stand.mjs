#!/usr/bin/env node
// BD-DEV-STAND-01 — local backend-ON QA stand. One command starts /server and two loopback
// origins of the real PWA: a passenger client and a driver client. Dev-only: never deployed, not
// a check.mjs smoke, and it changes nothing in public/, the CSP, the service worker or /server.
//
// Each client origin serves public/ as-is, except that index.html gets
//   <meta name="bd-api-base" content="<request origin>">
// (the committed, CSP-safe switch read by public/src/api_config.js), and /api/* is reverse-proxied
// to the local server. The API is therefore same-origin: CSP `connect-src 'self'` and an empty
// ALLOWED_ORIGIN need no change. Passenger and driver get separate origins on purpose — the auth
// token lives in localStorage, which is per origin, so two roles on one origin would share a session.
//
// Everything listens on 127.0.0.1 only; the server child is forced to HOST=127.0.0.1 whatever
// server/.env says. Behind a tunnel (cloudflared) the injected origin follows X-Forwarded-Proto /
// Cf-Visitor and the forwarded host, so the API base stays https and same-origin there too.
//
// Usage: node scripts/dev-stand.mjs [--api-port 3000] [--passenger-port 8080] [--driver-port 8081] [--no-server]

import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIND = '127.0.0.1';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(repoRoot, 'public');
const serverDir = path.join(repoRoot, 'server');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function fail(msg) {
  console.error(`FAIL dev-stand: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { apiPort: 3000, passengerPort: 8080, driverPort: 8081, server: true };
  const portFlags = { '--api-port': 'apiPort', '--passenger-port': 'passengerPort', '--driver-port': 'driverPort' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-server') opts.server = false;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (portFlags[arg]) {
      const n = Number(argv[i + 1]);
      if (!Number.isInteger(n) || n < 1 || n > 65535) fail(`${arg} needs a port number`);
      opts[portFlags[arg]] = n;
      i += 1;
    } else fail(`unknown argument ${arg} (see --help)`);
  }
  if (new Set([opts.apiPort, opts.passengerPort, opts.driverPort]).size !== 3) fail('ports must be distinct');
  return opts;
}

// The origin the browser used, so the injected API base is same-origin locally and behind a tunnel.
// The host is validated before it reaches the HTML attribute.
function requestOrigin(req, fallbackPort) {
  let cfScheme = '';
  try {
    cfScheme = JSON.parse(String(req.headers['cf-visitor'] || '{}')).scheme || '';
  } catch {
    // malformed Cf-Visitor — ignore
  }
  const proto = String(req.headers['x-forwarded-proto'] || cfScheme || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const safeProto = proto === 'https' ? 'https' : 'http';
  const safeHost = /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host) ? host : `${BIND}:${fallbackPort}`;
  return `${safeProto}://${safeHost}`;
}

// Hop-by-hop headers (RFC 9110 §7.6.1) are per-connection and must not cross the proxy; every
// header named by `Connection` is hop-by-hop too. `content-length` is kept; without
// `transfer-encoding` Node picks valid framing for the downstream leg itself.
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'transfer-encoding', 'upgrade', 'proxy-connection',
]);

function stripHopByHop(headers) {
  const named = String(headers.connection || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (HOP_BY_HOP.has(key) || named.includes(key)) continue;
    out[name] = value;
  }
  return out;
}

function proxyToApi(req, res, apiPort) {
  const headers = { ...stripHopByHop(req.headers), host: `${BIND}:${apiPort}` };
  const upstream = http.request(
    { hostname: BIND, port: apiPort, method: req.method, path: req.url, headers },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, stripHopByHop(upRes.headers));
      upRes.pipe(res);
      // Upstream died mid-stream: never append a JSON error to a partial body — cut the
      // downstream response so the client sees a truncated transfer, not a corrupt one.
      const cut = () => { if (!res.writableEnded) res.destroy(); };
      upRes.on('error', cut);
      upRes.on('close', () => { if (!upRes.complete) cut(); });
    },
  );
  upstream.on('error', (err) => {
    if (res.headersSent) {
      if (!res.writableEnded) res.destroy();
      return;
    }
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { code: 'DEV_STAND_API_DOWN', message: err.message } }));
  });
  // Client went away (during the request body or while the response streams): drop upstream.
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
  req.pipe(upstream);
}

async function serveStatic(req, res, port) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://stand').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(publicDir, `.${rel}`);
  if (file !== publicDir && !file.startsWith(publicDir + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  let info;
  try {
    info = await stat(file);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
    return;
  }
  if (info.isDirectory()) {
    res.writeHead(302, { location: `${rel}/` }).end();
    return;
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const head = req.method === 'HEAD';
  if (file === path.join(publicDir, 'index.html')) {
    const html = (await readFile(file, 'utf8')).replace(
      /<meta charset="utf-8">/i,
      (m) => `${m}\n  <meta name="bd-api-base" content="${requestOrigin(req, port)}">`,
    );
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(head ? undefined : html);
    return;
  }
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
  res.end(head ? undefined : await readFile(file));
}

function startClient(label, port, apiPort) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/api' || req.url.startsWith('/api/')) {
        proxyToApi(req, res, apiPort);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      serveStatic(req, res, port).catch((err) => {
        if (!res.headersSent) res.writeHead(500);
        res.end(String(err));
      });
    });
    srv.once('error', (err) => reject(new Error(`${label} client on ${BIND}:${port}: ${err.message}`)));
    srv.listen(port, BIND, () => resolve(srv));
  });
}

function getJson(port, urlPath) {
  return new Promise((resolve) => {
    let done = false;
    const settle = (value) => { if (!done) { done = true; resolve(value); } };
    const req = http.get({ hostname: BIND, port, path: urlPath, timeout: 2000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch { /* not JSON */ }
        settle({ status: res.statusCode, json });
      });
      // Backend closed after the headers (or the 2 s timeout destroyed the request mid-body):
      // the response emits 'error' / closes incomplete — treat it like a failed probe, not a crash.
      res.on('error', () => settle({ status: 0, json: null }));
      res.on('close', () => { if (!res.complete) settle({ status: 0, json: null }); });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => settle({ status: 0, json: null }));
  });
}

// A child killed by a signal has exitCode === null and signalCode !== null — treat both as gone.
const childGone = (child) => Boolean(child) && (child.exitCode !== null || child.signalCode !== null);

async function waitForHealth(apiPort, child, isStopping, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isStopping() || childGone(child)) return false;
    const { status } = await getJson(apiPort, '/api/v1/health');
    if (status === 200) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node scripts/dev-stand.mjs [--api-port 3000] [--passenger-port 8080] [--driver-port 8081] [--no-server]');
    return;
  }

  let child = null;
  const clients = [];
  let stopping = false;
  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    for (const srv of clients) srv.close();
    if (child && child.exitCode === null) child.kill();
    process.exitCode = code;
  };
  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));

  if (opts.server) {
    if (process.env.REDIS_URL) {
      console.warn('dev-stand: WARNING: REDIS_URL is set in the environment; /server Phase 1 refuses to boot with it.');
    }
    child = spawn(process.execPath, ['--env-file-if-exists=.env', 'src/index.js'], {
      cwd: serverDir,
      env: { ...process.env, HOST: BIND, PORT: String(opts.apiPort) },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('exit', (code, signal) => {
      if (stopping) return;
      console.error(`dev-stand: server exited (${signal || code}) - stopping the stand.`);
      stop(code === 0 ? 0 : 1);
    });
  }

  if (!(await waitForHealth(opts.apiPort, child, () => stopping))) {
    if (stopping) return; // Ctrl+C during startup is a clean stop, not a failure
    stop(1);
    fail(`no healthy /api/v1/health on ${BIND}:${opts.apiPort}`
      + (opts.server ? ' (see the server output above)' : ' - start /server or drop --no-server'));
  }
  const ready = await getJson(opts.apiPort, '/api/v1/readyz');
  if (stopping) return;

  // Track each listener as soon as it is up; if a stop signal landed while listen() was in
  // flight, stop() could not see it in `clients` yet — close it here instead of leaking it.
  const track = (srv) => {
    clients.push(srv);
    if (stopping) srv.close();
    return srv;
  };
  try {
    track(await startClient('passenger', opts.passengerPort, opts.apiPort));
    if (stopping) return;
    track(await startClient('driver', opts.driverPort, opts.apiPort));
    if (stopping) return;
  } catch (err) {
    if (stopping) return;
    stop(1);
    fail(err.message);
  }

  const db = ready.json && ready.json.db ? ready.json.db : 'unknown';
  console.log([
    '',
    `dev-stand: API       http://${BIND}:${opts.apiPort}/api/v1  (readyz ${ready.status}, db: ${db})`,
    `dev-stand: passenger http://${BIND}:${opts.passengerPort}/`,
    `dev-stand: driver    http://${BIND}:${opts.driverPort}/#/welcome?smokeRole=driver`,
    'dev-stand: Ctrl+C stops everything.',
    '',
  ].join('\n'));
  if (ready.status !== 200) console.warn('dev-stand: WARNING: readyz is not 200; check DATABASE_URL and migrations.');
}

main().catch((err) => fail(err.stack || err.message));
