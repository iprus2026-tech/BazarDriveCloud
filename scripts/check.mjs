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

for (const f of walk(path.join(root, 'public'), ['.js'])) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stderr ? e.stderr.toString() : e.message).slice(0, 400);
    errors.push(`Syntax error in ${path.relative(root, f)}\n${msg}`);
  }
}

if (errors.length) {
  console.error('CHECK FAILED:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('All checks passed.');
