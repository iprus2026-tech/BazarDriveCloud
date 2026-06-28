// /server/src/config.js — env parse + validate, fail-fast on missing required values
// (ADR BD-DOCS-041). Phase 1: DATABASE_URL is the only hard requirement. ALLOWED_ORIGIN
// is required in production (it locks CORS to the GitHub Pages origin — the mirror of the
// client CSP connect-src change) but optional in dev/test, where CORS stays OFF
// (same-origin only). Redis / S3 / token-OTP knobs are parsed but DARK (no Phase-1
// consumer); token/OTP POLICY is deferred per BD-DOCS-032.

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';
  const port = Number.parseInt(env.PORT ?? '3000', 10);

  const config = {
    nodeEnv,
    isProd,
    port,
    host: env.HOST || '0.0.0.0',
    logLevel: env.LOG_LEVEL || (nodeEnv === 'test' ? 'silent' : 'info'),

    // --- ACTIVE (Phase 1) ---
    databaseUrl: env.DATABASE_URL || '',
    allowedOrigin: env.ALLOWED_ORIGIN || '',

    // --- AUTH (BD-DOCS-032; token/OTP POLICY deferred, so no baked lifetime/format) ---
    sessionSecret: env.SESSION_SECRET || '',
    otp: {
      ttlSeconds: Number.parseInt(env.OTP_TTL_SECONDS ?? '300', 10),
      length: Number.parseInt(env.OTP_LENGTH ?? '4', 10),
      // Coarse brute-force cap applied by the verify endpoint (R02); no schema threshold.
      maxAttempts: Number.parseInt(env.OTP_MAX_ATTEMPTS ?? '5', 10),
      // Dev-mode echoes the minted code in the request response instead of sending SMS (no
      // provider yet — BD-DOCS-032 open question). On by default outside production.
      devMode: env.OTP_DEV_MODE != null ? env.OTP_DEV_MODE === 'true' : !isProd,
    },
    session: {
      // 0 = no expiry modeled (auth_session.expires_at stays NULL); lifetime/refresh policy
      // deferred per BD-DOCS-032. A positive value is the issuer-supplied TTL (R02 reads it).
      ttlSeconds: Number.parseInt(env.SESSION_TTL_SECONDS ?? '0', 10),
    },

    // --- DARK (structured, no Phase-1 consumer — see ADR BD-DOCS-041) ---
    redisUrl: env.REDIS_URL || '',
    s3: {
      endpoint: env.S3_ENDPOINT || '',
      bucket: env.S3_BUCKET || '',
      accessKeyId: env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY || '',
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
  // 500. Bound both TTLs (mirrors the OTP_LENGTH 4..10 guard) so a fat-fingered env fails fast
  // at startup, not at runtime. OTP codes are short-lived (cap 1h); sessions may be long (cap
  // ~10y), well under the Date ceiling.
  if (!Number.isInteger(config.otp.ttlSeconds) || config.otp.ttlSeconds <= 0 || config.otp.ttlSeconds > 3600) {
    throw new Error(`Invalid OTP_TTL_SECONDS: ${env.OTP_TTL_SECONDS} — must be an integer 1..3600 (seconds)`);
  }
  if (!Number.isInteger(config.otp.maxAttempts) || config.otp.maxAttempts <= 0) {
    throw new Error(`Invalid OTP_MAX_ATTEMPTS: ${env.OTP_MAX_ATTEMPTS} — must be a positive integer`);
  }
  if (!Number.isInteger(config.session.ttlSeconds) || config.session.ttlSeconds < 0 || config.session.ttlSeconds > 315_360_000) {
    throw new Error(`Invalid SESSION_TTL_SECONDS: ${env.SESSION_TTL_SECONDS} — must be an integer 0..315360000 (seconds; 0 = no expiry)`);
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
