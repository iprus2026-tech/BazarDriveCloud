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
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }
  return config;
}
