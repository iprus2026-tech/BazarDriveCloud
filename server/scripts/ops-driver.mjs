#!/usr/bin/env node
// /server/scripts/ops-driver.mjs — operator command for driver enrollment decisions
// (BD-AUTH-POLICY-01B-A; docs/driver-role-grant-contract.md §1).
//
//   npm run ops:driver -- list
//   npm run ops:driver -- approve <phone|userId> [--reason "..."] [--by <operator>]
//   npm run ops:driver -- reject  <phone|userId> [--reason "..."] [--by <operator>]
//   npm run ops:driver -- revoke  <phone|userId> [--reason "..."] [--by <operator>]
//
// A thin adapter: argument parsing, a pg pool from DATABASE_URL and output. All lifecycle rules
// live in src/services/driver-enrollment/decisions.js, which a later bot or admin route reuses.
// Output carries the account id and a MASKED phone — never a token.
// Exit codes: 0 ok, 1 decision refused (nothing written), 2 usage error, 3 runtime error.
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

import { decideDriverEnrollment, DECISIONS } from '../src/services/driver-enrollment/decisions.js';
import { listPendingEnrollments, countPendingEnrollments } from '../src/repositories/driver_enrollments.js';

const LIST_LIMIT = 50;

// The list header always states the full pending count; when the display is capped it says so.
export function pendingHeader(total, shown) {
  return shown < total
    ? `pending driver applications: ${total} (showing the oldest ${shown})`
    : `pending driver applications: ${total}`;
}

const USAGE = `usage: npm run ops:driver -- list
       npm run ops:driver -- <approve|reject|revoke> <phone|userId> [--reason "..."] [--by <operator>]`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "+79000001004" -> "+7 900 ***-10-04"; other numbers keep the country/area head and last 4.
export function maskPhone(phone) {
  if (typeof phone !== 'string' || !phone) return '-';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('7')) {
    return `+7 ${digits.slice(1, 4)} ***-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
  }
  if (digits.length < 8) return '***';
  return `+${digits.slice(0, digits.length - 7)} ***${digits.slice(-4)}`;
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command === 'list') return rest.length === 0 ? { command } : { error: 'list takes no arguments' };
  if (!DECISIONS.includes(command)) return { error: `unknown command: ${command ?? '(none)'}` };
  const out = { command, target: null, reason: null, by: null };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--reason' || arg === '--by') {
      const value = rest[i + 1];
      // A missing operand must not swallow the next flag (`--by --reason x`) or pass empty.
      if (value === undefined || value.trim() === '' || value.startsWith('-')) {
        return { error: `${arg} needs a value` };
      }
      out[arg.slice(2)] = value;
      i++;
    } else if (arg.startsWith('--')) {
      return { error: `unknown option: ${arg}` };
    } else if (out.target === null) {
      out.target = arg;
    } else {
      return { error: `unexpected argument: ${arg}` };
    }
  }
  if (!out.target) return { error: `${command} needs a <phone|userId>` };
  return out;
}

function operatorLabel(by) {
  const name = String(by || os.userInfo().username || 'operator').trim().slice(0, 180);
  return `ops-cli:${name}`;
}

function createDb(pool) {
  return {
    query: (text, params) => pool.query(text, params),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

export async function run(argv, { env = process.env, out = console.log, err = console.error } = {}) {
  const args = parseArgs(argv);
  if (args.error) {
    err(args.error);
    err(USAGE);
    return 2;
  }
  if (!env.DATABASE_URL) {
    err('DATABASE_URL is required');
    return 2;
  }
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 });
  const db = createDb(pool);
  try {
    if (args.command === 'list') {
      const [rows, total] = await Promise.all([
        listPendingEnrollments(db, { limit: LIST_LIMIT }),
        countPendingEnrollments(db),
      ]);
      out(pendingHeader(total, rows.length));
      for (const row of rows) {
        out(`  ${row.user_id}  ${maskPhone(row.phone)}  requested ${new Date(row.requested_at).toISOString()}`);
      }
      return 0;
    }
    const target = UUID.test(args.target) ? { userId: args.target } : { phone: args.target };
    const result = await decideDriverEnrollment(db, {
      target, decision: args.command, decidedBy: operatorLabel(args.by), reason: args.reason,
    });
    const shown = target.phone ? maskPhone(target.phone) : target.userId;
    if (!result.ok) {
      err(`${args.command} refused for ${shown}: ${result.code} (nothing written)`);
      return 1;
    }
    out(`${args.command}: ${result.code}`);
    out(`  account ${result.userId}  ${shown}`);
    out(`  enrollment ${result.enrollment?.status ?? '-'}  roles [${result.roles.join(', ')}]`);
    return 0;
  } catch (e) {
    err(`ops:driver failed: ${e?.code ?? ''} ${e?.message ?? e}`.trim());
    return 3;
  } finally {
    await pool.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
