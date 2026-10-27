// /server/src/config.js — env parse + validate, fail-fast on missing required values
// (ADR BD-DOCS-041). Phase 1: DATABASE_URL is the only hard requirement. ALLOWED_ORIGIN
// is required in production (it locks CORS to the GitHub Pages origin — the mirror of the
// client CSP connect-src change) but optional in dev/test, where CORS stays OFF
// (same-origin only). Redis / S3 / token-OTP knobs are parsed but DARK (no Phase-1
// consumer); token/OTP POLICY is deferred per BD-DOCS-032.

// BD-RIDE-AUTHORITY-01B-C (docs/ride-state-receipt-authority-contract.md §3): the commission rate
// receipt amounts are derived with. Unset -> 12, the rate the shipped UI already shows.
export const DEFAULT_RECEIPT_COMMISSION_PERCENT = 12;

// A plain decimal string ("12", "12.5"); anything else (empty, "abc", "-1", "1e1") is NaN so the
// range guard below rejects it at startup.
function parseCommissionPercent(raw) {
  if (raw === undefined) return DEFAULT_RECEIPT_COMMISSION_PERCENT;
  const text = String(raw).trim();
  return /^\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
}

// A strict boolean env flag: unset -> false; only "true" / "false" are accepted, anything else
// is null so the caller fails fast instead of guessing.
function parseBooleanFlag(raw) {
  if (raw === undefined) return false;
  const text = String(raw).trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return null;
}

// A loopback bind address. The public profile listens only there: the tunnel daemon and the
// stand proxy reach the server locally, and nothing else can.
function isLoopbackHost(host) {
  if (host === 'localhost' || host === '::1') return true;
  // 127.0.0.0/8 with every octet a real 0..255 value (127.999.1.1 is not an address).
  const octets = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return octets !== null && octets.slice(1).every((octet) => Number(octet) <= 255);
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';
  const port = Number.parseInt(env.PORT ?? '3000', 10);
  // BD-STAND-PUBLIC-01 (#1124) — a stand reachable from the internet (a tunnel). The flag is
  // strictly true/false. Its defaults are safe: a loopback bind and OTP dev-mode off. The guards
  // below refuse startup on an explicitly dangerous value.
  const publicExposure = parseBooleanFlag(env.PUBLIC_EXPOSURE);

  const config = {
    nodeEnv,
    isProd,
    publicExposure,
    port,
    host: env.HOST || (publicExposure === true ? '127.0.0.1' : '0.0.0.0'),
    logLevel: env.LOG_LEVEL || (nodeEnv === 'test' ? 'silent' : 'info'),

    // --- ACTIVE (Phase 1) ---
    databaseUrl: env.DATABASE_URL || '',
    allowedOrigin: env.ALLOWED_ORIGIN || '',

    // --- AUTH (BD-DOCS-032; token/OTP POLICY deferred, so no baked lifetime/format) ---
    sessionSecret: env.SESSION_SECRET || '',
    otp: {
      ttlSeconds: Number.parseInt(env.OTP_TTL_SECONDS ?? '300', 10),
      // BD-AUTH-HARDEN-01 (#824): 6 digits by default (was 4).
      length: Number.parseInt(env.OTP_LENGTH ?? '6', 10),
      // Coarse brute-force cap applied by the verify endpoint (R02); no schema threshold.
      maxAttempts: Number.parseInt(env.OTP_MAX_ATTEMPTS ?? '5', 10),
      // BD-AUTH-HARDEN-01 (#824) — request/verify limits, counted from auth_otp over the last hour.
      // Always on from loadConfig: there is no env switch to turn them off. Only a hand-built
      // config without `limits` (the DB-gated tests) runs without them.
      limits: {
        // Pause before the same phone can get another code.
        resendSeconds: Number.parseInt(env.OTP_RESEND_SECONDS ?? '60', 10),
        // Codes per phone per hour.
        phoneRequestsPerHour: Number.parseInt(env.OTP_PHONE_REQUESTS_PER_HOUR ?? '5', 10),
        // Code requests per source address (req.ip) per hour.
        ipRequestsPerHour: Number.parseInt(env.OTP_IP_REQUESTS_PER_HOUR ?? '20', 10),
        // Failed checks per phone per hour, across all of its codes.
        phoneFailedVerifiesPerHour: Number.parseInt(env.OTP_PHONE_FAILED_VERIFIES_PER_HOUR ?? '10', 10),
      },
      // Dev-mode echoes the minted code in the request response instead of sending SMS (no
      // provider yet — BD-DOCS-032 open question). On by default only outside production and
      // outside the public profile.
      devMode: env.OTP_DEV_MODE != null ? env.OTP_DEV_MODE === 'true' : !isProd && publicExposure !== true,
    },
    session: {
      // 0 = no expiry modeled (auth_session.expires_at stays NULL); lifetime/refresh policy
      // deferred per BD-DOCS-032. A positive value is the issuer-supplied TTL (R02 reads it).
      ttlSeconds: Number.parseInt(env.SESSION_TTL_SECONDS ?? '0', 10),
    },
    // --- TELEGRAM (BD-AUTH-TELEGRAM-01, ADR BD-DOCS-052) — sign-in with Mini App initData ---
    // The bot token is read only from here (R10): never logged, echoed or returned. Empty = the
    // sign-in route answers 503 TELEGRAM_DISABLED and the rest of the server is unchanged (R11).
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN || '',
      // R6 — how old an initData auth_date may be.
      initDataMaxAgeSeconds: Number.parseInt(env.TELEGRAM_INITDATA_MAX_AGE_SECONDS ?? '600', 10),
      // R7 — a Telegram session's lifetime, independent of SESSION_TTL_SECONDS.
      sessionTtlSeconds: Number.parseInt(env.TELEGRAM_SESSION_TTL_SECONDS ?? '604800', 10),
    },
    // --- RECEIPTS (BD-RIDE-AUTHORITY-01B-C) — server-derived receipt amounts ---
    receipts: {
      commissionPercent: parseCommissionPercent(env.RECEIPT_COMMISSION_PERCENT),
    },
    // --- DRIVERS (BD-AUTH-POLICY-01B-A) — driver enrollment ---
    drivers: {
      // Local stand only: approve a driver application in the same transaction. Forbidden in
      // production (guard below), like OTP_DEV_MODE.
      enrollmentAutoApprove: parseBooleanFlag(env.DRIVER_ENROLLMENT_AUTO_APPROVE),
    },

    // --- DARK (structured, no Phase-1 consumer — see ADR BD-DOCS-041) ---
    redisUrl: env.REDIS_URL || '',
    s3: {
      endpoint: env.S3_ENDPOINT || '',
      bucket: env.S3_BUCKET || '',
      accessKeyId: env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY || '',
    },

    // --- WABA (BD-DOCS-051) — structured-but-dark; WABA_WEBHOOK_VERIFY_TOKEN consumed by the
    // live GET verification handler. All other fields have no Phase-1 consumer. No field is
    // required at startup; an absent verify token makes the GET handler return 403. ---
    waba: {
      id: env.WABA_ID || '',
      phoneNumberId: env.WABA_PHONE_NUMBER_ID || '',
      accessToken: env.WABA_ACCESS_TOKEN || '',
      webhookVerifyToken: env.WABA_WEBHOOK_VERIFY_TOKEN || '',
      appSecret: env.WABA_APP_SECRET || '',
    },
  };

  const missing = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (isProd && !config.allowedOrigin) missing.push('ALLOWED_ORIGIN');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }
  // OTP_LENGTH must be a small integer: generateOtpCode uses crypto.randomInt(0, 10**length),
  // which throws above Node's random ceiling (~2^48, so length >= 15 already overflows). Cap
  // to a sane OTP range at startup, rather than 500-ing every OTP request later (BD-DOCS-032).
  if (!Number.isInteger(config.otp.length) || config.otp.length < 4 || config.otp.length > 10) {
    throw new Error(`Invalid OTP_LENGTH: ${env.OTP_LENGTH} — must be an integer 4..10`);
  }
  // Range-guard the remaining OTP/session knobs the R02 verify/request paths consume. Besides
  // NaN/<=0 (a garbage env like OTP_TTL_SECONDS=abc parses to NaN and would flow into Date math
  // as NaN), an absurdly LARGE value (e.g. 1e20) passes Number.isInteger yet overflows
  // `new Date(Date.now() + ttl*1000)` to an Invalid Date that Postgres rejects — a per-request
  // 500. Bound every knob (mirrors the OTP_LENGTH 4..10 guard) so a fat-fingered env fails fast
  // at startup, not at runtime. OTP codes are short-lived (cap 1h); sessions may be long (cap
  // ~10y), well under the Date ceiling; and maxAttempts is capped so an absurd value can't
  // silently DISABLE the per-code brute-force lockout (the only live attempt cap — Codex #788).
  if (!Number.isInteger(config.otp.ttlSeconds) || config.otp.ttlSeconds <= 0 || config.otp.ttlSeconds > 3600) {
    throw new Error(`Invalid OTP_TTL_SECONDS: ${env.OTP_TTL_SECONDS} — must be an integer 1..3600 (seconds)`);
  }
  if (!Number.isInteger(config.otp.maxAttempts) || config.otp.maxAttempts <= 0 || config.otp.maxAttempts > 100) {
    throw new Error(`Invalid OTP_MAX_ATTEMPTS: ${env.OTP_MAX_ATTEMPTS} — must be an integer 1..100`);
  }
  // The limits are bounded like the knobs above, and none can be 0: a zero cap would refuse every
  // request, and there is deliberately no value that turns a cap off. Only the resend pause may be
  // 0 (no pause; the hourly caps still apply).
  const limitKnobs = [
    ['OTP_RESEND_SECONDS', config.otp.limits.resendSeconds, 0, 3600],
    ['OTP_PHONE_REQUESTS_PER_HOUR', config.otp.limits.phoneRequestsPerHour, 1, 1000],
    ['OTP_IP_REQUESTS_PER_HOUR', config.otp.limits.ipRequestsPerHour, 1, 100_000],
    ['OTP_PHONE_FAILED_VERIFIES_PER_HOUR', config.otp.limits.phoneFailedVerifiesPerHour, 1, 1000],
  ];
  for (const [name, value, min, max] of limitKnobs) {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`Invalid ${name}: ${env[name]} — must be an integer ${min}..${max}`);
    }
  }
  if (!Number.isInteger(config.session.ttlSeconds) || config.session.ttlSeconds < 0 || config.session.ttlSeconds > 315_360_000) {
    throw new Error(`Invalid SESSION_TTL_SECONDS: ${env.SESSION_TTL_SECONDS} — must be an integer 0..315360000 (seconds; 0 = no expiry)`);
  }
  // R10: the shape only (`<bot id>:<secret>`), and the message never contains the value.
  if (config.telegram.botToken && !/^\d{5,20}:[A-Za-z0-9_-]{30,64}$/.test(config.telegram.botToken)) {
    throw new Error('Invalid TELEGRAM_BOT_TOKEN: unexpected format (expected <bot id>:<secret>)');
  }
  if (!Number.isInteger(config.telegram.initDataMaxAgeSeconds)
      || config.telegram.initDataMaxAgeSeconds < 60 || config.telegram.initDataMaxAgeSeconds > 86_400) {
    throw new Error(`Invalid TELEGRAM_INITDATA_MAX_AGE_SECONDS: ${env.TELEGRAM_INITDATA_MAX_AGE_SECONDS} — must be an integer 60..86400 (seconds)`);
  }
  if (!Number.isInteger(config.telegram.sessionTtlSeconds)
      || config.telegram.sessionTtlSeconds < 300 || config.telegram.sessionTtlSeconds > 31_536_000) {
    throw new Error(`Invalid TELEGRAM_SESSION_TTL_SECONDS: ${env.TELEGRAM_SESSION_TTL_SECONDS} — must be an integer 300..31536000 (seconds)`);
  }
  const commissionPercent = config.receipts.commissionPercent;
  if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
    throw new Error(`Invalid RECEIPT_COMMISSION_PERCENT: ${env.RECEIPT_COMMISSION_PERCENT} — must be a number 0..100`);
  }
  // Production must never echo an OTP in an API response. Fail fast instead of silently
  // overriding an operator-supplied value so a staging/production misconfiguration is visible.
  if (isProd && config.otp.devMode) {
    throw new Error('Invalid OTP_DEV_MODE: true is forbidden when NODE_ENV=production');
  }
  if (config.drivers.enrollmentAutoApprove === null) {
    throw new Error(`Invalid DRIVER_ENROLLMENT_AUTO_APPROVE: ${env.DRIVER_ENROLLMENT_AUTO_APPROVE} — must be true or false`);
  }
  // Production must never self-approve driver grants; fail fast like OTP_DEV_MODE.
  if (isProd && config.drivers.enrollmentAutoApprove) {
    throw new Error('Invalid DRIVER_ENROLLMENT_AUTO_APPROVE: true is forbidden when NODE_ENV=production');
  }
  // BD-STAND-PUBLIC-01 (#1124): the public profile refuses every dev-only authority shortcut,
  // whatever NODE_ENV is. Without the flag nothing below applies, and development is unchanged.
  if (publicExposure === null) {
    throw new Error(`Invalid PUBLIC_EXPOSURE: ${env.PUBLIC_EXPOSURE} — must be true or false`);
  }
  if (publicExposure) {
    if (config.otp.devMode) {
      throw new Error('Invalid OTP_DEV_MODE: true is forbidden when PUBLIC_EXPOSURE=true (OTP is off on a public stand)');
    }
    if (config.drivers.enrollmentAutoApprove) {
      throw new Error('Invalid DRIVER_ENROLLMENT_AUTO_APPROVE: true is forbidden when PUBLIC_EXPOSURE=true');
    }
    if (config.session.ttlSeconds === 0) {
      throw new Error('Invalid SESSION_TTL_SECONDS: must be > 0 when PUBLIC_EXPOSURE=true (sessions must expire on a public stand)');
    }
    if (!isLoopbackHost(config.host)) {
      throw new Error(`Invalid HOST: ${config.host} — must be a loopback address when PUBLIC_EXPOSURE=true (the tunnel reaches the stand locally)`);
    }
  }
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }
  // ALLOWED_ORIGIN, when set, must be a single exact http(s) origin — never a wildcard.
  // @fastify/cors treats "*" (and arrays containing it) as allow-any-origin, which would
  // break the exact-origin/no-wildcard boundary (ADR BD-DOCS-041). Reject "*" and any
  // malformed origin here at startup, before cors.js ever passes the value to @fastify/cors.
  if (config.allowedOrigin && !isExactOrigin(config.allowedOrigin)) {
    throw new Error(
      `Invalid ALLOWED_ORIGIN: "${config.allowedOrigin}" — must be a single exact origin ` +
        'like https://host[:port] (no path or trailing slash); wildcard "*" is not allowed',
    );
  }
  return config;
}

// A valid ALLOWED_ORIGIN is exactly one http(s) origin with no path, query, or trailing
// slash — i.e. it round-trips through URL.origin. This rejects "*" (URL parse fails),
// "https://a.io,https://b.io", "https://host/path", "ftp://host", and bare hostnames.
function isExactOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value;
}
