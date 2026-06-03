import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const errors = [];

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function walk(dir, exts) {
  const out = [];
  if (!exists(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'prototypes') continue;
      out.push(...walk(p, exts));
    } else if (exts.includes(path.extname(entry.name))) {
      out.push(p);
    }
  }
  return out;
}

const indexPath = path.join(root, 'public', 'index.html');
if (!exists(indexPath)) {
  errors.push('public/index.html not found');
} else {
  const html = fs.readFileSync(indexPath, 'utf8');
  if (/<script(?![^>]*\bsrc\b)[^>]*>[\s\S]*?<\/script>/i.test(html)) {
    errors.push('public/index.html contains inline <script>');
  }
  if (/<style[\s>]/i.test(html)) {
    errors.push('public/index.html contains <style> tag');
  }
  if (/\sstyle\s*=/i.test(html)) {
    errors.push('public/index.html contains style="" attribute');
  }
  if (/\son[a-z]+\s*=\s*["']/i.test(html)) {
    errors.push('public/index.html contains inline event handler (on*=)');
  }
}

const manifestPath = path.join(root, 'public', 'manifest.webmanifest');
if (exists(manifestPath)) {
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const key of ['name', 'start_url', 'display', 'theme_color', 'background_color', 'icons']) {
      if (!(key in m)) errors.push(`manifest.webmanifest missing field: ${key}`);
    }
    if (m.theme_color && m.theme_color.toUpperCase() !== '#FF6B35') {
      errors.push(`manifest.webmanifest theme_color expected #FF6B35, got ${m.theme_color}`);
    }
    if (m.background_color && m.background_color.toLowerCase() !== '#0a0a0c') {
      errors.push(`manifest.webmanifest background_color expected #0a0a0c, got ${m.background_color}`);
    }
  } catch (e) {
    errors.push('manifest.webmanifest is not valid JSON: ' + e.message);
  }
}

const swPath = path.join(root, 'public', 'sw.js');
if (exists(swPath)) {
  const sw = fs.readFileSync(swPath, 'utf8');
  const precacheMatch = sw.match(/PRECACHE\s*=\s*\[([\s\S]*?)\]/);
  if (precacheMatch && /prototypes\//.test(precacheMatch[1])) {
    errors.push('public/sw.js precache list must not contain prototype reference');
  }
}

const JS_INLINE_STYLE_PATTERNS = [
  { re: /style\s*=\s*["'`]/, label: 'style= attribute in template literal or string' },
  { re: /\.setAttribute\s*\(\s*['"`]style['"`]/, label: '.setAttribute("style", ...)' },
  { re: /\.style\.(?!cssText\s*=\s*''|cssText\s*=\s*"")/, label: '.style.<property> assignment' },
];

const srcDir = path.join(root, 'public', 'src');
for (const f of walk(srcDir, ['.js'])) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(root, f);
  for (const { re, label } of JS_INLINE_STYLE_PATTERNS) {
    if (re.test(src)) {
      errors.push(`${rel}: forbidden inline style pattern — ${label}`);
    }
  }
}


const activeRidePath = path.join(srcDir, 'screens', 'active_ride.js');
if (exists(activeRidePath)) {
  const activeRideSrc = fs.readFileSync(activeRidePath, 'utf8');
  if (!/const\s+latestHandedOffTripId\s*=\s*rawTripId\s*\?\s*null\s*:\s*findLatestHandedOffOrderTripId\(\)/.test(activeRideSrc)) {
    errors.push('active_ride.js driver branch must resolve latest handed-off order tripId before demo fallback');
  }
  if (!/const\s+tripId\s*=\s*rawTripId\s*\|\|\s*latestHandedOffTripId\s*\|\|\s*DEMO_ACTIVE_RIDE_ID/.test(activeRideSrc)) {
    errors.push('active_ride.js driver branch must prefer explicit tripId, then latest handed-off tripId, then demo fallback');
  }
  if (!/!hasValidStatusQuery\s*&&\s*!driverSnapshot\s*&&\s*!hasExplicitTripId\s*&&\s*!hasLatestHandedOffTripId/.test(activeRideSrc)) {
    errors.push('active_ride.js driver empty state must not render when a latest handed-off tripId exists');
  }
  if (!/updateTripStatus/.test(activeRideSrc) || !/function\s+syncCanonicalOrderStatus/.test(activeRideSrc)) {
    errors.push('active_ride.js driver lifecycle must sync canonical ride order status');
  }
  if (!/\[RIDE_STATUS\.NO_SHOW\]:\s*RIDE_STATUS\.CANCELED/.test(activeRideSrc)) {
    errors.push('active_ride.js must map NO_SHOW active rides to CANCELED canonical ride orders');
  }
  if (!/persistDriverRideStatus\(RIDE_STATUS\.IN_PROGRESS[,)]/.test(activeRideSrc)
      || !/persistDriverRideStatus\(RIDE_STATUS\.COMPLETED[,)]/.test(activeRideSrc)
      || !/persistDriver(?:RideStatus|Cancel)\(RIDE_STATUS\.CANCELED[,)]/.test(activeRideSrc)) {
    errors.push('active_ride.js driver lifecycle actions must persist and sync in-progress, completed, and canceled statuses');
  }
}

for (const f of walk(path.join(root, 'public'), ['.js'])) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stderr ? e.stderr.toString() : e.message).slice(0, 400);
    errors.push(`Syntax error in ${path.relative(root, f)}\n${msg}`);
  }
}

// BD-DRIVER-01 — static regression smoke for the driver-map role guard.
const driverMapGuardSmoke = path.join(root, 'scripts', 'smoke-driver-map-guard.mjs');
if (exists(driverMapGuardSmoke)) {
  try {
    execFileSync(process.execPath, [driverMapGuardSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-driver-map-guard.mjs failed\n${msg}`);
  }
}

// BD-DRIVER-02 — static regression smoke for the driver-map readiness gate.
const driverMapReadinessSmoke = path.join(root, 'scripts', 'smoke-driver-map-readiness.mjs');
if (exists(driverMapReadinessSmoke)) {
  try {
    execFileSync(process.execPath, [driverMapReadinessSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-driver-map-readiness.mjs failed\n${msg}`);
  }
}

// BD-DRIVER-DOCS-01 — behavioural smoke for the driver document readiness
// contract (registration docs vs shift docs). Guards against onboarding's
// 3 required docs being reported as documentsReady:false again.
const driverDocsReadinessSmoke = path.join(root, 'scripts', 'smoke-driver-docs-readiness.mjs');
if (exists(driverDocsReadinessSmoke)) {
  try {
    execFileSync(process.execPath, [driverDocsReadinessSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-driver-docs-readiness.mjs failed\n${msg}`);
  }
}

// BD-RIDE-P-12 — static regression smoke for the passenger active ride contract.
const passengerActiveRideSmoke = path.join(root, 'scripts', 'smoke-passenger-active-ride.mjs');
if (exists(passengerActiveRideSmoke)) {
  try {
    execFileSync(process.execPath, [passengerActiveRideSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-passenger-active-ride.mjs failed\n${msg}`);
  }
}

// BD-DRIVER-MAP-X-15 — static regression smoke for the DriverMap accept order
// handoff (CREATED → Принять → one active trip → driver active ride → passenger
// accepted-driver handoff, with no empty search after acceptance).
const driverMapAcceptHandoffSmoke = path.join(root, 'scripts', 'smoke-driver-map-accept-handoff.mjs');
if (exists(driverMapAcceptHandoffSmoke)) {
  try {
    execFileSync(process.execPath, [driverMapAcceptHandoffSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-driver-map-accept-handoff.mjs failed\n${msg}`);
  }
}

// BD-INBOX-03 — static regression smoke for the inbox screen contract.
const inboxSmoke = path.join(root, 'scripts', 'smoke-inbox.mjs');
if (exists(inboxSmoke)) {
  try {
    execFileSync(process.execPath, [inboxSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-inbox.mjs failed\n${msg}`);
  }
}

// Dispatcher routine — self-test the orchestrator so the routine itself
// stays in a working state under CI (no project mutation in --selftest mode).
const dispatcherSelftest = path.join(root, 'scripts', 'dispatcher.mjs');
if (exists(dispatcherSelftest)) {
  try {
    execFileSync(process.execPath, [dispatcherSelftest, '--selftest'], { stdio: 'pipe' });
  } catch (e) {
    const msg = ((e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : e.message)).slice(-400);
    errors.push(`dispatcher.mjs --selftest failed\n${msg}`);
  }
}

if (errors.length) {
  console.error('CHECK FAILED:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('All checks passed.');
